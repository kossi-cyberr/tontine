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
  return `+2377${String(Date.now()).slice(-5)}${String(phoneCounter).padStart(3, '0')}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface TestUser {
  id: string;
  phone: string;
  token: string;
}

describe('Notifications, rappels et tableaux de bord (e2e)', () => {
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

  async function createUser(fullName: string): Promise<TestUser> {
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

  async function createGroup(
    options: {
      lateFeeType?: 'fixed' | 'percent';
      lateFeeValue?: number;
    } = {},
  ) {
    const today = dateOnly(new Date());
    const president = await createUser('Président Notifications');
    const memberA = await createUser('Membre Notifications A');
    const memberB = await createUser('Membre Notifications B');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Tontine notifications ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        contribution_amount: 1000,
        frequency: 'monthly',
        start_date: today,
        min_members: 3,
        max_members: 3,
        late_fee_type: options.lateFeeType ?? 'fixed',
        late_fee_value: options.lateFeeValue ?? 500,
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

    return { groupId, president, memberA, memberB, round, users: [president, memberA, memberB] };
  }

  async function contributionOf(groupId: string, roundId: string, user: TestUser) {
    const membership = await prisma.group_members.findFirstOrThrow({
      where: { group_id: groupId, user_id: user.id },
    });
    return prisma.contributions.findFirstOrThrow({
      where: { round_id: roundId, member_id: membership.id },
    });
  }

  async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await probe();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Élément attendu introuvable avant expiration.');
  }

  async function pay(groupId: string, roundId: string, user: TestUser, amount = 1000) {
    const contribution = await contributionOf(groupId, roundId, user);
    const initiated = await api
      .post(`/contributions/${contribution.id}/pay`)
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', `pay-notif-${contribution.id}-${Date.now()}`)
      .send({ method: 'mtn_momo', payer_number: user.phone })
      .expect(202);

    const body = {
      event_id: `evt_notif_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
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

  it('rappelle uniquement les non-payeurs, sans doublon, et alimente le centre de notifications', async () => {
    const { groupId, president, memberA, users, round } = await createGroup();

    await prisma.rounds.update({
      where: { id: round.id },
      data: {
        due_date: new Date(`${dateOnly(new Date(Date.now() + 3 * 86_400_000))}T00:00:00.000Z`),
      },
    });

    const first = await rounds.sendRoundReminders();
    expect(first.sent).toBeGreaterThanOrEqual(3);

    const ourReminders = await prisma.notifications.count({
      where: {
        channel: 'in_app',
        template: 'reminder_j3',
        user_id: { in: users.map((user) => user.id) },
      },
    });
    expect(ourReminders).toBe(3);

    const second = await rounds.sendRoundReminders();
    expect(second.sent).toBe(0);

    await pay(groupId, round.id, memberA);

    const manual = await api
      .post(`/groups/${groupId}/reminders`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(manual.body.sent).toBe(2);

    const manualForPayer = await prisma.notifications.count({
      where: {
        user_id: memberA.id,
        template: 'reminder_manual',
        channel: 'in_app',
      },
    });
    expect(manualForPayer).toBe(0);

    const paymentNotification = await waitFor(() =>
      prisma.notifications.findFirst({
        where: { user_id: memberA.id, template: 'payment_received', channel: 'in_app' },
      }),
    );
    expect(paymentNotification).not.toBeNull();

    const center = await api
      .get('/me/notifications')
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);
    expect(center.body.length).toBeGreaterThanOrEqual(2);

    const countBefore = await api
      .get('/me/notifications/count')
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);
    expect(countBefore.body.unread).toBeGreaterThanOrEqual(2);

    const target = center.body.find(
      (item: { template: string }) => item.template === 'payment_received',
    );
    await api
      .post(`/me/notifications/${target.id as string}/read`)
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);

    const countAfter = await api
      .get('/me/notifications/count')
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);
    expect(countAfter.body.unread).toBe(countBefore.body.unread - 1);

    await api
      .post('/me/notifications/read-all')
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);
    const countZero = await api
      .get('/me/notifications/count')
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);
    expect(countZero.body.unread).toBe(0);

    // Les relances manuelles sont réservées aux gestionnaires.
    await api
      .post(`/groups/${groupId}/reminders`)
      .set('Authorization', `Bearer ${users[2]!.token}`)
      .expect(403);
  }, 90_000);

  it('applique les pénalités, crédite la garantie et garde le grand livre cohérent', async () => {
    const { groupId, memberA, users, round } = await createGroup({
      lateFeeType: 'fixed',
      lateFeeValue: 500,
    });

    const yesterday = new Date(Date.now() - 86_400_000);
    await prisma.contributions.updateMany({
      where: { round_id: round.id },
      data: { due_date: new Date(`${dateOnly(yesterday)}T00:00:00.000Z`) },
    });

    await rounds.markLateContributions();

    const late = await prisma.contributions.findMany({ where: { round_id: round.id } });
    expect(late.every((entry) => entry.status === 'late')).toBe(true);
    expect(late.every((entry) => Number(entry.penalty_amount) === 500)).toBe(true);

    const lateNotifications = await prisma.notifications.count({
      where: { channel: 'in_app', template: 'contribution_late' },
    });
    expect(lateNotifications).toBeGreaterThanOrEqual(3);

    await pay(groupId, round.id, memberA, 1500);

    const escrow = await prisma.escrow_accounts.findUniqueOrThrow({
      where: { group_id: groupId },
    });
    expect(Number(escrow.balance_cached)).toBe(1000);
    expect(Number(escrow.guarantee_balance)).toBe(500);

    const escrowView = await api
      .get(`/groups/${groupId}/escrow`)
      .set('Authorization', `Bearer ${users[1]!.token}`)
      .expect(200);
    expect(escrowView.body.balance).toBe(1000);
    expect(escrowView.body.guarantee_balance).toBe(500);
    expect(escrowView.body.consistent).toBe(true);

    const ledger = await api
      .get(`/groups/${groupId}/ledger`)
      .set('Authorization', `Bearer ${users[1]!.token}`)
      .expect(200);
    const penaltyEntry = ledger.body.find((entry: { type: string }) => entry.type === 'penalty');
    expect(penaltyEntry.credit).toBe(500);
  }, 90_000);

  it('expose les tableaux de bord et exporte le relevé CSV', async () => {
    const { groupId, president, memberA, users, round } = await createGroup();
    await pay(groupId, round.id, memberA);

    const dashboard = await api
      .get(`/groups/${groupId}/dashboard`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(dashboard.body.stats.total_contributions).toBe(3);
    expect(dashboard.body.stats.paid_count).toBe(1);
    expect(dashboard.body.stats.payment_rate).toBe(33);
    expect(dashboard.body.stats.escrow_balance).toBe(1000);
    expect(dashboard.body.current_round.round_number).toBe(1);
    expect(dashboard.body.my_member.role).toBe('president');

    const mine = await api
      .get('/me/dashboard')
      .set('Authorization', `Bearer ${memberA.token}`)
      .expect(200);
    expect(mine.body.groups_count).toBeGreaterThanOrEqual(1);
    expect(mine.body.total_paid).toBeGreaterThanOrEqual(1000);

    const statement = await api
      .get(`/groups/${groupId}/statement.csv`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(statement.headers['content-type']).toContain('text/csv');
    expect(statement.text).toContain('"Tour";"Beneficiaire"');
    expect(statement.text).toContain('"Cotisation"');
    expect(statement.text).toContain('Membre Notifications A');

    const outsider = await createUser('Intrus Notifications');
    await api
      .get(`/groups/${groupId}/dashboard`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
    await api
      .get(`/groups/${groupId}/statement.csv`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);

    // Les membres non gestionnaires ne peuvent pas relancer.
    await api
      .post(`/groups/${groupId}/reminders`)
      .set('Authorization', `Bearer ${users[2]!.token}`)
      .expect(403);
  }, 90_000);
});
