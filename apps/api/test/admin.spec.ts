import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokensService } from '../src/auth/tokens.service';
import { RoundsService } from '../src/rounds/rounds.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { signMockWebhook } from '../src/payments/mock-payment.provider';

delete process.env.HTTP_PROXY;

let webhookSecret = '';
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  return `+2376${String(Date.now()).slice(-5)}${String(phoneCounter).padStart(3, '0')}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface TestUser {
  id: string;
  phone: string;
  token: string;
}

describe('Back-office, litiges et audit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokensService;
  let rounds: RoundsService;
  let api: ReturnType<typeof request>;
  let admin: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    webhookSecret = app.get(ConfigService).get<string>('MOCK_PROVIDER_WEBHOOK_SECRET', '');
    tokens = app.get(TokensService);
    rounds = app.get(RoundsService);
    api = request(app.getHttpServer());

    await prisma.platform_settings.update({
      where: { key: 'group_limits' },
      data: { value: { min: 3, max: 100 } },
    });

    admin = await createUser('Super Admin Test', 'super_admin');
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
    kyc: 'none' | 'submitted' | 'verified' = 'verified',
  ): Promise<TestUser> {
    const phone = nextPhone();
    const user = await prisma.users.create({
      data: {
        full_name: fullName,
        phone,
        password_hash: await argon2.hash('Password123', { type: argon2.argon2id }),
        status: 'active',
        kyc,
        platform_role: platformRole,
      },
    });
    const pair = await tokens.issuePair(user);
    return { id: user.id, phone, token: pair.access_token };
  }

  async function createGroup() {
    const today = dateOnly(new Date());
    const president = await createUser('Président Admin Test');
    const memberA = await createUser('Membre Admin A');
    const memberB = await createUser('Membre Admin B');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Tontine admin ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        contribution_amount: 1000,
        frequency: 'monthly',
        start_date: today,
        min_members: 3,
        max_members: 3,
        late_fee_type: 'fixed',
        late_fee_value: 500,
      })
      .expect(201);
    const groupId = created.body.id as string;

    for (const user of [memberA, memberB]) {
      await api
        .post(`/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${president.token}`)
        .send({ full_name: user.phone, phone: user.phone, role: 'member' })
        .expect(201);
    }
    for (const user of [president, memberA, memberB]) {
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
    await rounds.openDueRounds();

    const round = await prisma.rounds.findFirstOrThrow({
      where: { group_id: groupId },
      orderBy: { round_number: 'asc' },
    });
    const members = await prisma.group_members.findMany({
      where: { group_id: groupId, status: 'active' },
      orderBy: { joined_at: 'asc' },
    });

    return { groupId, president, memberA, memberB, round, members };
  }

  async function contributionOf(groupId: string, roundId: string, user: TestUser) {
    const membership = await prisma.group_members.findFirstOrThrow({
      where: { group_id: groupId, user_id: user.id },
    });
    return prisma.contributions.findFirstOrThrow({
      where: { round_id: roundId, member_id: membership.id },
    });
  }

  async function pay(groupId: string, roundId: string, user: TestUser, amount = 1000) {
    const contribution = await contributionOf(groupId, roundId, user);
    const initiated = await api
      .post(`/contributions/${contribution.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', `admin-pay-${contribution.id}-${Date.now()}`)
      .send({ method: 'mtn_momo', payer_number: user.phone })
      .expect(202);

    const body = {
      event_id: `evt_admin_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      provider_reference: initiated.body.provider_reference as string,
      status: 'confirmed',
      amount,
    };
    await api
      .post('/webhooks/payments/mock')
      .set('X-Signature', signMockWebhook(JSON.stringify(body), webhookSecret))
      .send(body)
      .expect(200);
  }

  it('réserve /admin/* au Super Admin', async () => {
    const user = await createUser('Utilisateur Simple');
    await api.get('/admin/stats').set('Authorization', `Bearer ${user.token}`).expect(403);
    await api.get('/admin/users').set('Authorization', `Bearer ${user.token}`).expect(403);
    await api.get('/admin/stats').expect(401);
    await api.get('/admin/stats').set('Authorization', `Bearer ${admin.token}`).expect(200);
    const logs = await api
      .get('/admin/audit-logs')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(Array.isArray(logs.body.items)).toBe(true);
  }, 60_000);

  it('valide ou rejette un KYC avec motif et trace la décision', async () => {
    const user = await createUser('Candidat KYC', 'user', 'submitted');

    await api
      .patch(`/admin/users/${user.id}/kyc`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'rejected' })
      .expect(400);

    await api
      .patch(`/admin/users/${user.id}/kyc`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'verified' })
      .expect(200);

    const updated = await prisma.users.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.kyc).toBe('verified');

    const audit = await prisma.audit_logs.findFirst({
      where: { action: 'kyc.verify', entity_id: user.id },
      orderBy: { id: 'desc' },
    });
    expect(audit?.actor_id).toBe(admin.id);
    expect(audit?.ip).not.toBeNull();

    const notification = await prisma.notifications.findFirst({
      where: { user_id: user.id, template: 'kyc_verified', channel: 'in_app' },
    });
    expect(notification).not.toBeNull();

    // Un dossier non soumis ne peut pas être validé deux fois.
    await api
      .patch(`/admin/users/${user.id}/kyc`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'rejected', reason: 'Document illisible' })
      .expect(409);
  }, 60_000);

  it('modifie les paramètres globaux et refuse les clés inconnues', async () => {
    const settings = await api
      .get('/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(Array.isArray(settings.body)).toBe(true);

    await api
      .patch('/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ settings: [{ key: 'clé_inventée', value: 1 }] })
      .expect(400);

    await api
      .patch('/admin/settings')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ settings: [{ key: 'group_limits', value: { min: 3, max: 100 } }] })
      .expect(200);

    const row = await prisma.platform_settings.findUniqueOrThrow({
      where: { key: 'group_limits' },
    });
    expect(row.updated_by).toBe(admin.id);

    const audit = await prisma.audit_logs.findFirst({
      where: { action: 'settings.update' },
      orderBy: { id: 'desc' },
    });
    expect(audit).not.toBeNull();
  }, 60_000);

  it('gère un litige avec pièces jointes et décision motivée', async () => {
    const { groupId, memberA } = await createGroup();

    const opened = await api
      .post('/disputes')
      .set('Authorization', `Bearer ${memberA.token}`)
      .send({
        group_id: groupId,
        subject: 'Cotisation débitée deux fois',
        description: 'Mon compte a été débité deux fois pour le même tour.',
        attachments: ['https://example.com/recu.pdf'],
      })
      .expect(201);
    expect(opened.body.attachments).toHaveLength(1);
    expect(opened.body.status).toBe('open');

    await api
      .patch(`/disputes/${opened.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'resolved' })
      .expect(400);

    await api
      .patch(`/disputes/${opened.body.id}`)
      .set('Authorization', `Bearer ${memberA.token}`)
      .send({ status: 'resolved', resolution: 'Je veux décider moi-même.' })
      .expect(403);

    const resolved = await api
      .patch(`/disputes/${opened.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'resolved', resolution: 'Remboursement du doublon effectué.' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolved_by).toBe(admin.id);

    const mine = await api
      .get('/disputes')
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);
    expect(mine.body.items[0].status).toBe('resolved');

    const audit = await prisma.audit_logs.findFirst({
      where: { action: 'dispute.resolved', entity_id: opened.body.id },
    });
    expect(audit).not.toBeNull();
  }, 90_000);

  it('annule un tour par écritures inverses et garde le ledger cohérent', async () => {
    const { groupId, memberA, round } = await createGroup();

    await prisma.contributions.updateMany({
      where: { round_id: round.id },
      data: { due_date: new Date(`${dateOnly(new Date(Date.now() - 86_400_000))}T00:00:00.000Z`) },
    });
    await rounds.markLateContributions();
    await pay(groupId, round.id, memberA, 1500);

    const escrowBefore = await prisma.escrow_accounts.findUniqueOrThrow({
      where: { group_id: groupId },
    });
    expect(Number(escrowBefore.balance_cached)).toBe(1000);
    expect(Number(escrowBefore.guarantee_balance)).toBe(500);

    const cancelled = await api
      .post(`/admin/rounds/${round.id}/cancel`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: 'Fraude confirmée sur ce tour' })
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.refunded_amount).toBe(1500);

    const escrowAfter = await prisma.escrow_accounts.findUniqueOrThrow({
      where: { group_id: groupId },
    });
    expect(Number(escrowAfter.balance_cached)).toBe(0);
    expect(Number(escrowAfter.guarantee_balance)).toBe(0);

    const totals = await prisma.ledger_entries.aggregate({
      where: { escrow_account_id: escrowAfter.id },
      _sum: { credit: true, debit: true },
    });
    expect(Number((totals._sum.credit ?? 0n) - (totals._sum.debit ?? 0n))).toBe(0);

    const refund = await prisma.ledger_entries.findFirst({
      where: { escrow_account_id: escrowAfter.id, type: 'refund' },
    });
    expect(Number(refund?.debit)).toBe(1000);

    const roundAfter = await prisma.rounds.findUniqueOrThrow({ where: { id: round.id } });
    expect(roundAfter.status).toBe('cancelled');

    const contribution = await prisma.contributions.findFirstOrThrow({
      where: { round_id: round.id, status: 'refunded' },
    });
    expect(Number(contribution.penalty_amount)).toBe(0);

    const payment = await prisma.payments.findFirstOrThrow({
      where: { contribution_id: contribution.id },
    });
    expect(payment.status).toBe('refunded');

    const audit = await prisma.audit_logs.findFirst({
      where: { action: 'round.cancel', entity_id: round.id },
    });
    expect(audit).not.toBeNull();
  }, 90_000);

  it('remplace un membre en reprenant position, dettes et cotisations futures', async () => {
    const { groupId, president, memberB, round, members } = await createGroup();
    const replacement = await createUser('Membre Remplaçant');

    const target = members.find((member) => member.user_id === memberB.id)!;

    await prisma.member_debts.create({
      data: { member_id: target.id, round_id: round.id, amount: 500n, status: 'open' },
    });

    await api
      .post(`/groups/${groupId}/members/${target.id}/replace`)
      .set('Authorization', `Bearer ${memberB.token}`)
      .send({ phone: replacement.phone })
      .expect(403);

    const result = await api
      .post(`/groups/${groupId}/members/${target.id}/replace`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ phone: replacement.phone })
      .expect(200);

    expect(result.body.member.user_id).toBe(replacement.id);
    expect(result.body.member.position).toBe(target.position);
    expect(result.body.transferred.debts).toBe(1);

    const old = await prisma.group_members.findUniqueOrThrow({ where: { id: target.id } });
    expect(old.status).toBe('left');
    expect(old.position).toBeNull();

    const debt = await prisma.member_debts.findFirstOrThrow({
      where: { member_id: result.body.member.id },
    });
    expect(Number(debt.amount)).toBe(500);

    const future = await prisma.contributions.findFirst({
      where: { member_id: result.body.member.id },
    });
    expect(future).not.toBeNull();

    // Le remplaçant ne peut pas se remplacer lui-même.
    await api
      .post(`/groups/${groupId}/members/${result.body.member.id}/replace`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ phone: replacement.phone })
      .expect(400);
  }, 90_000);
});
