import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import * as argon2 from 'argon2';
import type { Readable } from 'node:stream';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokensService } from '../src/auth/tokens.service';
import { RoundsService } from '../src/rounds/rounds.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { ReconciliationService } from '../src/payouts/reconciliation.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { signMockWebhook } from '../src/payments/mock-payment.provider';

delete process.env.HTTP_PROXY;

let webhookSecret = '';
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  return `+2379${String(Date.now()).slice(-5)}${String(phoneCounter).padStart(3, '0')}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function binaryParser(
  response: Readable,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

interface TestUser {
  id: string;
  phone: string;
  token: string;
}

describe('Décaissement, OTP et réconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokensService;
  let rounds: RoundsService;
  let payouts: PayoutsService;
  let reconciliation: ReconciliationService;
  let api: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    webhookSecret = app.get(ConfigService).get<string>('MOCK_PROVIDER_WEBHOOK_SECRET', '');
    tokens = app.get(TokensService);
    rounds = app.get(RoundsService);
    payouts = app.get(PayoutsService);
    reconciliation = app.get(ReconciliationService);
    api = request(app.getHttpServer());

    // Groupes de 3 membres pour garder le test rapide ; la limite est rétablie après.
    await prisma.platform_settings.update({
      where: { key: 'group_limits' },
      data: { value: { min: 3, max: 100 } },
    });
  });

  afterAll(async () => {
    await prisma.platform_settings.update({
      where: { key: 'group_limits' },
      data: { value: { min: 10, max: 100 } },
    });
    await app.close();
  });

  async function createUser(
    fullName: string,
    platformRole: 'user' | 'super_admin' = 'user',
  ): Promise<TestUser> {
    const phone = nextPhone();
    const user = await prisma.users.create({
      data: {
        full_name: fullName,
        phone,
        password_hash: await argon2.hash('Password123', { type: argon2.argon2id }),
        status: 'active',
        kyc: 'verified',
        platform_role: platformRole,
      },
    });
    const pair = await tokens.issuePair(user);
    return { id: user.id, phone, token: pair.access_token };
  }

  async function createLaunchedGroup(rule: 'strict' | 'flexible') {
    const today = dateOnly(new Date());
    const president = await createUser('Président Décaissement');
    const treasurer = await createUser('Trésorier Décaissement');
    const member = await createUser('Membre Décaissement');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Tontine décaissement ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        contribution_amount: 1000,
        frequency: 'monthly',
        start_date: today,
        min_members: 3,
        max_members: 3,
        payout_rule: rule,
        beneficiary_pays: true,
      })
      .expect(201);
    const groupId = created.body.id as string;

    await api
      .post(`/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: treasurer.phone, phone: treasurer.phone, role: 'treasurer' })
      .expect(201);
    await api
      .post(`/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: member.phone, phone: member.phone, role: 'member' })
      .expect(201);

    for (const user of [president, treasurer, member]) {
      await api
        .post(`/groups/${groupId}/accept-rules`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
    }

    await api
      .post(`/groups/${groupId}/draw`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);

    await api
      .post(`/groups/${groupId}/launch`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect((await rounds.openDueRounds()).opened).toBeGreaterThanOrEqual(1);

    const round = await prisma.rounds.findFirstOrThrow({
      where: { group_id: groupId },
      orderBy: { round_number: 'asc' },
    });
    const beneficiaryMembership = await prisma.group_members.findUniqueOrThrow({
      where: { id: round.beneficiary_member_id },
    });

    const users: TestUser[] = [president, treasurer, member];
    const beneficiary = users.find((user) => user.id === beneficiaryMembership.user_id);
    if (!beneficiary) throw new Error('Bénéficiaire introuvable parmi les membres du test.');

    await prisma.rounds.update({
      where: { id: round.id },
      data: { payout_date: new Date(`${today}T00:00:00.000Z`) },
    });

    return { groupId, president, treasurer, member, users, beneficiary, round };
  }

  async function addPayoutAccount(user: TestUser, accountNumber: string) {
    await api
      .post('/me/payout-accounts')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ type: 'mtn_momo', account_number: accountNumber, holder_name: user.phone })
      .expect(201);

    const created = await api
      .post('/me/payout-accounts')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        type: 'mtn_momo',
        account_number: accountNumber,
        holder_name: user.phone,
        otp_code: '000000',
      })
      .expect(201);

    return created.body.id as string;
  }

  async function payContribution(groupId: string, roundId: string, user: TestUser) {
    const membership = await prisma.group_members.findFirstOrThrow({
      where: { group_id: groupId, user_id: user.id },
    });
    const contribution = await prisma.contributions.findFirstOrThrow({
      where: { round_id: roundId, member_id: membership.id },
    });

    const initiated = await api
      .post(`/contributions/${contribution.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', `pay-${contribution.id}-${Date.now()}`)
      .send({ method: 'mtn_momo', payer_number: user.phone })
      .expect(202);

    const body = {
      event_id: `evt_payout_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      provider_reference: initiated.body.provider_reference as string,
      status: 'confirmed',
      amount: 1000,
    };
    await api
      .post('/webhooks/payments/mock')
      .set('X-Signature', signMockWebhook(JSON.stringify(body), webhookSecret))
      .send(body)
      .expect(200);
  }

  it('refuse un tour partiel, exige l’OTP, interdit l’auto-approbation et exécute le décaissement', async () => {
    const { groupId, president, treasurer, users, beneficiary, round } =
      await createLaunchedGroup('flexible');
    await addPayoutAccount(beneficiary, '+23769990011');

    // Seules deux cotisations sur trois sont encaissées.
    for (const user of users) {
      if (user.id === beneficiary.id) continue;
      await payContribution(groupId, round.id, user);
    }

    const tooRecent = await api
      .post(`/rounds/${round.id}/payout/request`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({})
      .expect(422);
    expect(tooRecent.body.code).toBe('PAYOUT_NOT_ELIGIBLE');
    expect(tooRecent.body.details.reasons).toContain('DESTINATION_ACCOUNT_TOO_RECENT');

    await prisma.payout_accounts.updateMany({
      where: { user_id: beneficiary.id },
      data: { active_from: new Date(Date.now() - 3_600_000) },
    });

    const incomplete = await api
      .post(`/rounds/${round.id}/payout/request`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({})
      .expect(422);
    expect(incomplete.body.code).toBe('PAYOUT_NOT_ELIGIBLE');
    expect(incomplete.body.details.reasons).toContain('COLLECTION_INCOMPLETE');

    const requested = await api
      .post(`/rounds/${round.id}/payout/request`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ allow_partial: true })
      .expect(202);
    expect(requested.body.status).toBe('pending_approval');
    expect(requested.body.gross_amount).toBe(2000);
    expect(requested.body.net_amount).toBe(2000);
    expect(requested.body.requested_by).toBe(president.id);

    const replay = await api
      .post(`/rounds/${round.id}/payout/request`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ allow_partial: true })
      .expect(202);
    expect(replay.body.id).toBe(requested.body.id);
    expect(replay.body.reused).toBe(true);

    const selfApproval = await api
      .post(`/rounds/${round.id}/payout/approve`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({})
      .expect(403);
    expect(selfApproval.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    await api
      .post(`/rounds/${round.id}/payout/approve`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({})
      .expect(200);

    const executed = await api
      .post(`/rounds/${round.id}/payout/approve`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({ otp_code: '000000' })
      .expect(200);
    expect(executed.body.status).toBe('success');
    expect(executed.body.net_amount).toBe(2000);

    const storedRound = await prisma.rounds.findUniqueOrThrow({ where: { id: round.id } });
    expect(storedRound.status).toBe('paid_out');

    const payoutRows = await prisma.payouts.findMany({
      where: { round_id: round.id, status: 'success' },
    });
    expect(payoutRows).toHaveLength(1);

    const escrow = await prisma.escrow_accounts.findUniqueOrThrow({
      where: { group_id: groupId },
    });
    expect(Number(escrow.balance_cached)).toBe(0);
    const ledger = await api
      .get(`/groups/${groupId}/ledger`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(
      ledger.body
        .filter((entry: { type: string }) => entry.type === 'payout')
        .reduce((total: number, entry: { debit: number }) => total + entry.debit, 0),
    ).toBe(2000);

    const state = await api
      .get(`/rounds/${round.id}/payout`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(state.body.payout.id).toBe(requested.body.id);
    expect(state.body.eligibility.eligible).toBe(false);

    const receipt = await api
      .get(`/payouts/${requested.body.id}/receipt`)
      .set('Authorization', `Bearer ${president.token}`)
      .buffer(true)
      .parse(binaryParser as never)
      .expect(200);
    expect(receipt.headers['content-type']).toContain('application/pdf');
    expect((receipt.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 90_000);

  it('prépare une seule fois le décaissement, échoue puis réussit à la relance', async () => {
    const { groupId, president, users, beneficiary, round } = await createLaunchedGroup('strict');

    await addPayoutAccount(beneficiary, '+23769995555');
    await prisma.payout_accounts.updateMany({
      where: { user_id: beneficiary.id },
      data: { active_from: new Date(Date.now() - 3_600_000) },
    });
    for (const user of users) {
      await payContribution(groupId, round.id, user);
    }

    const readyRound = await prisma.rounds.findUniqueOrThrow({ where: { id: round.id } });
    expect(readyRound.status).toBe('ready');
    expect(Number(readyRound.collected_amount)).toBe(3000);

    const firstJob = await payouts.processEligiblePayouts();
    expect(firstJob.created).toBeGreaterThanOrEqual(1);
    const secondJob = await payouts.processEligiblePayouts();
    expect(secondJob.created).toBe(0);
    expect(await prisma.payouts.count({ where: { round_id: round.id } })).toBe(1);

    const payout = await prisma.payouts.findFirstOrThrow({ where: { round_id: round.id } });
    expect(payout.status).toBe('pending_approval');
    expect(payout.requested_by).toBeNull();

    await api
      .post(`/rounds/${round.id}/payout/approve`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({})
      .expect(200);

    const failed = await api
      .post(`/rounds/${round.id}/payout/approve`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ otp_code: '000000' })
      .expect(200);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.attempts).toBe(1);
    expect(failed.body.retryable).toBe(true);

    const retried = await payouts.retryFailedPayouts();
    expect(retried.retried).toBeGreaterThanOrEqual(1);
    expect(retried.succeeded).toBeGreaterThanOrEqual(1);

    const succeeded = await prisma.payouts.findFirstOrThrow({ where: { round_id: round.id } });
    expect(succeeded.status).toBe('success');
    expect(succeeded.attempts).toBe(2);
    expect(await prisma.payouts.count({ where: { round_id: round.id } })).toBe(1);
    expect((await prisma.rounds.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'paid_out',
    );

    const receipt = await api
      .get(`/payouts/${succeeded.id}/receipt`)
      .set('Authorization', `Bearer ${president.token}`)
      .buffer(true)
      .parse(binaryParser as never)
      .expect(200);
    expect((receipt.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 90_000);

  it('réconcilie le grand livre avec le rapport du fournisseur et détecte un écart', async () => {
    const admin = await createUser('Super Admin Réconciliation', 'super_admin');

    const healthy = await reconciliation.run();
    expect(healthy.status).toBe('ok');
    expect(healthy.difference).toBe(0);

    const escrow = await prisma.escrow_accounts.findFirstOrThrow({
      where: { ledger_entries: { some: { type: 'contribution' } } },
    });

    // Écriture corrective présente au grand livre mais absente chez l'agrégateur.
    await prisma.ledger_entries.create({
      data: {
        escrow_account_id: escrow.id,
        type: 'refund',
        credit: 1000n,
        description: 'Écart de test',
      },
    });

    const mismatch = await api
      .post('/admin/reconciliation/run')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(mismatch.body.status).toBe('mismatch');
    expect(mismatch.body.difference).toBe(1000);

    const list = await api
      .get('/admin/reconciliation')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(list.body[0].status).toBe('mismatch');
  }, 30_000);
});
