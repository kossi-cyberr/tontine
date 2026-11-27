import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokensService } from '../src/auth/tokens.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

delete process.env.HTTP_PROXY;

let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  return `+2377${String(Date.now()).slice(-6)}${String(phoneCounter).padStart(2, '0')}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('Cycles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokensService;
  let api: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokensService);
    api = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(
    fullName: string,
  ): Promise<{ id: string; token: string; phone: string }> {
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
    return { id: user.id, token: pair.access_token, phone };
  }

  async function createLaunchedGroup() {
    const today = dateOnly(new Date());
    const president = await createUser('Président Cycles');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Tontine cycles ${Date.now()}`,
        contribution_amount: 5000,
        frequency: 'monthly',
        start_date: today,
        min_members: 10,
        max_members: 10,
        late_fee_type: 'fixed',
        late_fee_value: 500,
      })
      .expect(201);
    const groupId = created.body.id as string;

    const members: { id: string; token: string; memberId: string }[] = [];
    for (let index = 0; index < 9; index += 1) {
      const member = await createUser(`Membre Cycles ${index}`);
      const added = await api
        .post(`/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${president.token}`)
        .send({ full_name: `Membre Cycles ${index}`, phone: member.phone })
        .expect(201);
      members.push({ ...member, memberId: added.body.member.id });
    }

    await api
      .post(`/groups/${groupId}/draw`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    await api
      .post(`/groups/${groupId}/launch`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);

    return { groupId, president, members };
  }

  it('refuse une clôture incomplète, clôture le cycle puis ouvre le suivant', async () => {
    const { groupId, president, members } = await createLaunchedGroup();

    const initial = await api
      .get(`/groups/${groupId}/cycles`)
      .set('Authorization', `Bearer ${members[0]!.token}`)
      .expect(200);
    expect(initial.body).toHaveLength(1);
    expect(initial.body[0]).toMatchObject({
      cycle_number: 1,
      status: 'running',
      rounds_count: 10,
      settled_rounds: 0,
    });

    // Un membre simple ne peut pas clôturer.
    await api
      .post(`/groups/${groupId}/cycles/close`)
      .set('Authorization', `Bearer ${members[0]!.token}`)
      .expect(403);

    // Impossible d'ouvrir le cycle suivant tant que le cycle 1 tourne.
    const premature = await api
      .post(`/groups/${groupId}/cycles`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({})
      .expect(409);
    expect(premature.body.code).toBe('PREVIOUS_CYCLE_NOT_CLOSED');

    // Tours non réglés : clôture refusée.
    const unsettled = await api
      .post(`/groups/${groupId}/cycles/close`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(422);
    expect(unsettled.body.code).toBe('ROUNDS_NOT_SETTLED');
    expect(unsettled.body.details.rounds).toHaveLength(10);

    // Tous les tours sont décaissés, mais le séquestre contient encore de l'argent.
    await prisma.rounds.updateMany({
      where: { group_id: groupId },
      data: { status: 'paid_out', closed_at: new Date() },
    });
    await prisma.escrow_accounts.update({
      where: { group_id: groupId },
      data: { balance_cached: 5000n },
    });

    const escrowNotEmpty = await api
      .post(`/groups/${groupId}/cycles/close`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(422);
    expect(escrowNotEmpty.body.code).toBe('ESCROW_NOT_EMPTY');

    // Séquestre vidé : la clôture passe.
    await prisma.escrow_accounts.update({
      where: { group_id: groupId },
      data: { balance_cached: 0n },
    });

    const closed = await api
      .post(`/groups/${groupId}/cycles/close`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(closed.body.cycle).toMatchObject({
      cycle_number: 1,
      status: 'completed',
      rounds_count: 10,
      settled_rounds: 10,
    });
    expect(closed.body.next_cycle_number).toBe(2);

    const completedGroup = await prisma.groups.findUniqueOrThrow({ where: { id: groupId } });
    expect(completedGroup.status).toBe('completed');

    const alreadyClosed = await api
      .post(`/groups/${groupId}/cycles/close`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(409);
    expect(alreadyClosed.body.code).toBe('NO_RUNNING_CYCLE');

    // Une date de début antérieure à la fin du cycle précédent est refusée.
    const tooEarly = await api
      .post(`/groups/${groupId}/cycles`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ start_date: dateOnly(new Date()) })
      .expect(422);
    expect(tooEarly.body.code).toBe('START_DATE_BEFORE_PREVIOUS_END');

    // Ouverture par défaut : le lendemain de la fin du cycle 1.
    const opened = await api
      .post(`/groups/${groupId}/cycles`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({})
      .expect(201);
    expect(opened.body.cycle).toMatchObject({
      cycle_number: 2,
      status: 'running',
      rounds_count: 10,
      settled_rounds: 0,
    });
    expect(opened.body.expected_amount).toBe(50_000);
    expect(opened.body.order).toHaveLength(10);
    expect(opened.body.rounds).toHaveLength(10);

    const activeGroup = await prisma.groups.findUniqueOrThrow({ where: { id: groupId } });
    expect(activeGroup.status).toBe('active');

    const cycles = await api
      .get(`/groups/${groupId}/cycles`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(cycles.body.map((cycle: { status: string }) => cycle.status)).toEqual([
      'completed',
      'running',
    ]);

    const calendar = await api
      .get(`/groups/${groupId}/rounds`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(calendar.body).toHaveLength(10);
    expect(new Set(calendar.body.map((round: { cycle_id: string }) => round.cycle_id)).size).toBe(
      1,
    );
    expect(calendar.body[0].cycle_id).toBe(opened.body.cycle.id);
    expect(calendar.body.map((round: { round_number: number }) => round.round_number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);

    const stillRunning = await api
      .post(`/groups/${groupId}/cycles`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({})
      .expect(409);
    expect(stillRunning.body.code).toBe('PREVIOUS_CYCLE_NOT_CLOSED');

    // Cycle 2 réglé puis cycle 3 avec un nouveau tirage.
    await prisma.rounds.updateMany({
      where: { group_id: groupId, cycle_id: opened.body.cycle.id },
      data: { status: 'paid_out', closed_at: new Date() },
    });
    await api
      .post(`/groups/${groupId}/cycles/close`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);

    const redrawn = await api
      .post(`/groups/${groupId}/cycles`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ redraw: true })
      .expect(201);
    expect(redrawn.body.cycle).toMatchObject({
      cycle_number: 3,
      status: 'running',
      rounds_count: 10,
    });
    expect(redrawn.body.cycle.draw_seed).toMatch(/^[0-9a-f]{64}$/);
    expect(redrawn.body.order).toHaveLength(10);
    expect(
      new Set(redrawn.body.order.map((entry: { position: number }) => entry.position)).size,
    ).toBe(10);
  }, 90_000);
});
