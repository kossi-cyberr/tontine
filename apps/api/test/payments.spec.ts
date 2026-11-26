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
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { signMockWebhook } from '../src/payments/mock-payment.provider';

delete process.env.HTTP_PROXY;

let webhookSecret = '';
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  return `+2378${String(Date.now()).slice(-5)}${String(phoneCounter).padStart(3, '0')}`;
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

describe('Paiements, séquestre et webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokensService;
  let rounds: RoundsService;
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
    api = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(fullName: string) {
    const phone = nextPhone();
    const user = await prisma.users.create({
      data: {
        full_name: fullName,
        phone,
        password_hash: await argon2.hash('Password123', { type: argon2.argon2id }),
        status: 'active',
        kyc: 'verified',
      },
    });
    const pair = await tokens.issuePair(user);
    return { id: user.id, phone, token: pair.access_token };
  }

  it('encaisse une cotisation atomiquement, une seule fois, et sécurise les accès', async () => {
    const today = dateOnly(new Date());
    const president = await createUser('Président Paiement');
    const member = await createUser('Membre Payeur');
    const outsider = await createUser('Intrus Paiement');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Tontine paiements ${Date.now()}`,
        contribution_amount: 5000,
        frequency: 'monthly',
        start_date: today,
        min_members: 10,
        max_members: 10,
      })
      .expect(201);
    const groupId = created.body.id as string;

    const added = await api
      .post(`/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: member.phone, phone: member.phone })
      .expect(201);
    const memberRowId = added.body.member.id as string;

    const others: { id: string; token: string; phone: string }[] = [];
    for (let index = 0; index < 8; index += 1) {
      const other = await createUser(`Membre Paiement ${index}`);
      await api
        .post(`/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${president.token}`)
        .send({ full_name: `Membre Paiement ${index}`, phone: other.phone })
        .expect(201);
      others.push(other);
    }

    await api
      .post(`/groups/${groupId}/accept-rules`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);

    await api
      .post(`/groups/${groupId}/draw`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    await api
      .post(`/groups/${groupId}/launch`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(await rounds.openDueRounds()).toEqual({ opened: 1 });

    const firstRound = await prisma.rounds.findFirstOrThrow({
      where: { group_id: groupId },
      orderBy: { round_number: 'asc' },
    });
    const memberContribution = await prisma.contributions.findFirstOrThrow({
      where: { round_id: firstRound.id, member_id: memberRowId },
    });
    const presidentMembership = await prisma.group_members.findFirstOrThrow({
      where: { group_id: groupId, user_id: president.id },
    });
    const presidentContribution = await prisma.contributions.findFirstOrThrow({
      where: { round_id: firstRound.id, member_id: presidentMembership.id },
    });

    // Règlement non accepté et clé d'idempotence absente.
    await api
      .post(`/contributions/${memberContribution.id}/pay`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ method: 'mtn_momo', payer_number: member.phone })
      .expect(400);

    const keyOne = `pay-${Date.now()}-one`;
    const noRules = await api
      .post(`/contributions/${memberContribution.id}/pay`)
      .set('Authorization', `Bearer ${member.token}`)
      .set('Idempotency-Key', keyOne)
      .send({ method: 'mtn_momo', payer_number: member.phone })
      .expect(422);
    expect(noRules.body.code).toBe('RULES_NOT_ACCEPTED');

    await api
      .post(`/groups/${groupId}/accept-rules`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    // Un membre ne paie pas la cotisation d'un autre ; un intrus n'a aucun accès.
    await api
      .post(`/contributions/${presidentContribution.id}/pay`)
      .set('Authorization', `Bearer ${member.token}`)
      .set('Idempotency-Key', `pay-${Date.now()}-wrong-owner`)
      .send({ method: 'mtn_momo', payer_number: member.phone })
      .expect(403);

    await api
      .post(`/contributions/${memberContribution.id}/pay`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .set('Idempotency-Key', `pay-${Date.now()}-outsider`)
      .send({ method: 'mtn_momo', payer_number: outsider.phone })
      .expect(403);

    const initiated = await api
      .post(`/contributions/${memberContribution.id}/pay`)
      .set('Authorization', `Bearer ${member.token}`)
      .set('Idempotency-Key', keyOne)
      .send({ method: 'mtn_momo', payer_number: member.phone })
      .expect(202);
    expect(initiated.body.status).toBe('pending');
    expect(initiated.body.amount).toBe(5000);
    const paymentId = initiated.body.id as string;
    const providerReference = initiated.body.provider_reference as string;

    // Rejeu de la même clé : même paiement, aucune nouvelle collecte.
    const replay = await api
      .post(`/contributions/${memberContribution.id}/pay`)
      .set('Authorization', `Bearer ${member.token}`)
      .set('Idempotency-Key', keyOne)
      .send({ method: 'mtn_momo', payer_number: member.phone })
      .expect(202);
    expect(replay.body.id).toBe(paymentId);
    expect(replay.body.reused).toBe(true);
    expect(await prisma.payments.count({ where: { contribution_id: memberContribution.id } })).toBe(
      1,
    );

    // Nouvelle clé pendant un paiement en cours : refusée.
    const inProgress = await api
      .post(`/contributions/${memberContribution.id}/pay`)
      .set('Authorization', `Bearer ${member.token}`)
      .set('Idempotency-Key', `pay-${Date.now()}-second`)
      .send({ method: 'mtn_momo', payer_number: member.phone })
      .expect(409);
    expect(inProgress.body.code).toBe('PAYMENT_IN_PROGRESS');

    await api
      .get(`/payments/${paymentId}`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    await api
      .get(`/payments/${paymentId}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);

    const webhookBody = {
      event_id: `evt_${Date.now()}_ok`,
      provider_reference: providerReference,
      status: 'confirmed',
      amount: 5000,
    };
    const serialized = JSON.stringify(webhookBody);

    // Signature invalide : rejetée, rien n'est enregistré.
    await api
      .post('/webhooks/payments/mock')
      .set('X-Signature', 'deadbeef')
      .send(webhookBody)
      .expect(401);

    // Montant incohérent : refusé, paiement toujours en attente.
    const wrongAmount = { ...webhookBody, event_id: `evt_${Date.now()}_wrong`, amount: 1 };
    const wrongSerialized = JSON.stringify(wrongAmount);
    await api
      .post('/webhooks/payments/mock')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signMockWebhook(wrongSerialized, webhookSecret))
      .send(wrongSerialized)
      .expect(400);
    expect((await prisma.payments.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'pending',
    );
    expect(await prisma.webhook_events.count({ where: { event_id: wrongAmount.event_id } })).toBe(
      0,
    );

    const confirmed = await api
      .post('/webhooks/payments/mock')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signMockWebhook(serialized, webhookSecret))
      .send(serialized)
      .expect(200);
    expect(confirmed.body.payment_status).toBe('confirmed');

    // Le même webhook trois fois, puis un nouvel événement pour le même paiement.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const duplicate = await api
        .post('/webhooks/payments/mock')
        .set('X-Signature', signMockWebhook(serialized, webhookSecret))
        .send(webhookBody)
        .expect(200);
      expect(duplicate.body.duplicate).toBe(true);
    }
    const secondEvent = {
      ...webhookBody,
      event_id: `evt_${Date.now()}_again`,
    };
    const already = await api
      .post('/webhooks/payments/mock')
      .set('X-Signature', signMockWebhook(JSON.stringify(secondEvent), webhookSecret))
      .send(secondEvent)
      .expect(200);
    expect(already.body.ignored).toBe('ALREADY_CONFIRMED');

    const storedPayment = await prisma.payments.findUniqueOrThrow({ where: { id: paymentId } });
    expect(storedPayment.status).toBe('confirmed');
    expect(storedPayment.receipt_number).toMatch(/^REC-\d{8}-[A-F0-9]{8}$/);
    expect(
      (await prisma.contributions.findUniqueOrThrow({ where: { id: memberContribution.id } }))
        .status,
    ).toBe('paid');

    const afterFirst = await prisma.rounds.findUniqueOrThrow({ where: { id: firstRound.id } });
    expect(afterFirst.status).toBe('collecting');
    expect(Number(afterFirst.collected_amount)).toBe(5000);
    expect(
      await prisma.ledger_entries.count({
        where: {
          escrow_account_id: (
            await prisma.escrow_accounts.findUniqueOrThrow({
              where: { group_id: groupId },
            })
          ).id,
        },
      }),
    ).toBe(1);

    // Reçu PDF, interdit aux non-membres, indisponible avant confirmation.
    await api
      .get(`/payments/${paymentId}/receipt`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
    const receipt = await api
      .get(`/payments/${paymentId}/receipt`)
      .set('Authorization', `Bearer ${member.token}`)
      .buffer(true)
      .parse(binaryParser as never)
      .expect(200);
    expect(receipt.headers['content-type']).toContain('application/pdf');
    expect((receipt.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const history = await api
      .get('/me/payments')
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].id).toBe(paymentId);

    // Échec simulé puis nouvelle tentative avec une nouvelle clé.
    await api
      .post(`/groups/${groupId}/accept-rules`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    const failed = await api
      .post(`/contributions/${presidentContribution.id}/pay`)
      .set('Authorization', `Bearer ${president.token}`)
      .set('Idempotency-Key', `pay-${Date.now()}-failed`)
      .send({ method: 'orange_money', payer_number: '+23769990000' })
      .expect(202);
    expect(failed.body.status).toBe('failed');

    const retry = await api
      .post(`/contributions/${presidentContribution.id}/pay`)
      .set('Authorization', `Bearer ${president.token}`)
      .set('Idempotency-Key', `pay-${Date.now()}-retry`)
      .send({ method: 'orange_money', payer_number: president.phone })
      .expect(202);
    expect(retry.body.status).toBe('pending');

    await api
      .get(`/payments/${retry.body.id}/receipt`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(409);

    const presidentWebhook = {
      event_id: `evt_${Date.now()}_president`,
      provider_reference: retry.body.provider_reference,
      status: 'confirmed',
      amount: 5000,
    };
    await api
      .post('/webhooks/payments/mock')
      .set('X-Signature', signMockWebhook(JSON.stringify(presidentWebhook), webhookSecret))
      .send(presidentWebhook)
      .expect(200);

    // Les huit autres membres paient : le tour passe à « prêt » à 100 %.
    for (const [index, other] of others.entries()) {
      const otherMembership = await prisma.group_members.findFirstOrThrow({
        where: { group_id: groupId, user_id: other.id },
      });
      const otherContribution = await prisma.contributions.findFirstOrThrow({
        where: { round_id: firstRound.id, member_id: otherMembership.id },
      });
      await api
        .post(`/groups/${groupId}/accept-rules`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);
      const otherPayment = await api
        .post(`/contributions/${otherContribution.id}/pay`)
        .set('Authorization', `Bearer ${other.token}`)
        .set('Idempotency-Key', `pay-${Date.now()}-other-${index}`)
        .send({ method: 'mtn_momo', payer_number: other.phone })
        .expect(202);
      const otherWebhook = {
        event_id: `evt_${Date.now()}_other_${index}`,
        provider_reference: otherPayment.body.provider_reference,
        status: 'confirmed',
        amount: 5000,
      };
      await api
        .post('/webhooks/payments/mock')
        .set('X-Signature', signMockWebhook(JSON.stringify(otherWebhook), webhookSecret))
        .send(otherWebhook)
        .expect(200);
    }

    const readyRound = await prisma.rounds.findUniqueOrThrow({ where: { id: firstRound.id } });
    expect(readyRound.status).toBe('ready');
    expect(Number(readyRound.collected_amount)).toBe(50_000);

    const escrow = await api
      .get(`/groups/${groupId}/escrow`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(escrow.body.balance).toBe(50_000);
    expect(escrow.body.guarantee_balance).toBe(0);
    expect(escrow.body.consistent).toBe(true);

    await api
      .get(`/groups/${groupId}/escrow`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);

    const ledger = await api
      .get(`/groups/${groupId}/ledger`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(ledger.body).toHaveLength(10);
    expect(ledger.body.every((entry: { debit: number }) => entry.debit === 0)).toBe(true);
    expect(
      ledger.body.reduce((total: number, entry: { credit: number }) => total + entry.credit, 0),
    ).toBe(50_000);

    await api
      .get(`/groups/${groupId}/ledger`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);

    // Deux clics simultanés avec des clés différentes sur un tour ouvert :
    // une seule collecte est créée, l'autre requête est refusée.
    const secondRound = await prisma.rounds.findFirstOrThrow({
      where: { group_id: groupId, round_number: 2 },
    });
    await prisma.rounds.update({
      where: { id: secondRound.id },
      data: { status: 'open', opens_on: new Date(`${today}T00:00:00.000Z`) },
    });
    const secondContribution = await prisma.contributions.findFirstOrThrow({
      where: { round_id: secondRound.id, member_id: memberRowId },
    });

    const [firstAttempt, secondAttempt] = await Promise.all([
      api
        .post(`/contributions/${secondContribution.id}/pay`)
        .set('Authorization', `Bearer ${member.token}`)
        .set('Idempotency-Key', `pay-${Date.now()}-race-a`)
        .send({ method: 'mtn_momo', payer_number: member.phone }),
      api
        .post(`/contributions/${secondContribution.id}/pay`)
        .set('Authorization', `Bearer ${member.token}`)
        .set('Idempotency-Key', `pay-${Date.now()}-race-b`)
        .send({ method: 'mtn_momo', payer_number: member.phone }),
    ]);
    expect([firstAttempt.status, secondAttempt.status].sort()).toEqual([202, 409]);
    expect(
      await prisma.payments.count({
        where: { contribution_id: secondContribution.id, status: { in: ['initiated', 'pending'] } },
      }),
    ).toBe(1);

    // Deux webhooks distincts pour le même paiement, en parallèle : une seule écriture.
    const pendingAttempt = firstAttempt.status === 202 ? firstAttempt : secondAttempt;
    const pendingPayment = pendingAttempt.body as {
      id: string;
      provider_reference: string;
    };
    const raceEvents = [
      {
        event_id: `evt_${Date.now()}_race_a`,
        provider_reference: pendingPayment.provider_reference,
        status: 'confirmed',
        amount: 5000,
      },
      {
        event_id: `evt_${Date.now()}_race_b`,
        provider_reference: pendingPayment.provider_reference,
        status: 'confirmed',
        amount: 5000,
      },
    ];
    const webhookResults = await Promise.all(
      raceEvents.map((event) =>
        api
          .post('/webhooks/payments/mock')
          .set('Content-Type', 'application/json')
          .set('X-Signature', signMockWebhook(JSON.stringify(event), webhookSecret))
          .send(JSON.stringify(event)),
      ),
    );
    expect(webhookResults.every((response) => response.status === 200)).toBe(true);
    expect(
      await prisma.ledger_entries.count({
        where: { reference_id: pendingPayment.id, type: 'contribution' },
      }),
    ).toBe(1);
    expect(
      Number(
        (await prisma.rounds.findUniqueOrThrow({ where: { id: secondRound.id } })).collected_amount,
      ),
    ).toBe(5000);
  }, 90_000);
});
