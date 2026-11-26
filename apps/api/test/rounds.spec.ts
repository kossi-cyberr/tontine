import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokensService } from '../src/auth/tokens.service';
import { RoundsService } from '../src/rounds/rounds.service';
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

describe('Tours et lancement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokensService;
  let rounds: RoundsService;
  let api: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokensService);
    rounds = app.get(RoundsService);
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

  it('tire, ordonne, lance le groupe puis expose le calendrier et des jobs idempotents', async () => {
    const today = dateOnly(new Date());
    const president = await createUser('Président Tours');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Tontine tours ${Date.now()}`,
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
      const member = await createUser(`Membre Tours ${index}`);
      const added = await api
        .post(`/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${president.token}`)
        .send({ full_name: `Membre Tours ${index}`, phone: member.phone })
        .expect(201);
      members.push({ ...member, memberId: added.body.member.id });
    }

    // Ordre incomplet : le lancement est refusé.
    const incomplete = await api
      .post(`/groups/${groupId}/launch`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(422);
    expect(incomplete.body.code).toBe('ORDER_INCOMPLETE');

    // Un membre simple ne peut ni tirer ni lancer.
    await api
      .post(`/groups/${groupId}/draw`)
      .set('Authorization', `Bearer ${members[0]!.token}`)
      .expect(403);
    await api
      .post(`/groups/${groupId}/launch`)
      .set('Authorization', `Bearer ${members[0]!.token}`)
      .expect(403);

    const drawn = await api
      .post(`/groups/${groupId}/draw`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(drawn.body.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(drawn.body.order).toHaveLength(10);
    expect(
      new Set(drawn.body.order.map((entry: { position: number }) => entry.position)).size,
    ).toBe(10);

    // Ordre manuel : inverse l'ordre tiré.
    const reversedIds = [...drawn.body.order].reverse().map((entry: { id: string }) => entry.id);
    await api
      .put(`/groups/${groupId}/order`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ member_ids: reversedIds.slice(0, 5) })
      .expect(400);
    await api
      .put(`/groups/${groupId}/order`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ member_ids: reversedIds })
      .expect(200);

    const launched = await api
      .post(`/groups/${groupId}/launch`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(launched.body.rounds_count).toBe(10);
    expect(launched.body.expected_amount).toBe(50_000);
    expect(launched.body.rounds).toHaveLength(10);
    expect(launched.body.rounds[0].beneficiary.id).toBe(reversedIds[0]);
    expect(launched.body.rounds[0].contributions_count).toBe(10);

    await api
      .post(`/groups/${groupId}/launch`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(409);

    // L'ordre et les membres sont verrouillés après lancement.
    const lockedOrder = await api
      .put(`/groups/${groupId}/order`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ member_ids: reversedIds })
      .expect(409);
    expect(lockedOrder.body.code).toBe('GROUP_LOCKED');

    await api
      .post(`/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: 'Trop tard', phone: nextPhone() })
      .expect(409);

    const calendar = await api
      .get(`/groups/${groupId}/rounds`)
      .set('Authorization', `Bearer ${members[0]!.token}`)
      .expect(200);
    expect(calendar.body).toHaveLength(10);
    expect(calendar.body.filter((round: { is_my_turn: boolean }) => round.is_my_turn)).toHaveLength(
      1,
    );

    const current = await api
      .get(`/groups/${groupId}/rounds/current`)
      .set('Authorization', `Bearer ${members[0]!.token}`)
      .expect(200);
    expect(current.body.round_number).toBe(1);
    expect(current.body.status).toBe('scheduled');

    const detail = await api
      .get(`/rounds/${current.body.id}`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(detail.body.contributions).toHaveLength(10);

    // Jobs : ouverture idempotente des tours arrivés à échéance.
    // Le job est global : d'autres tours dus peuvent exister dans la base de test.
    expect((await rounds.openDueRounds()).opened).toBeGreaterThanOrEqual(1);
    expect(await rounds.openDueRounds()).toEqual({ opened: 0 });

    // Jobs : passage en retard idempotent + pénalité fixe de 500 XAF.
    const yesterday = dateOnly(new Date(Date.now() - 86_400_000));
    await prisma.rounds.update({
      where: { id: current.body.id },
      data: { due_date: new Date(`${yesterday}T00:00:00.000Z`) },
    });
    await prisma.contributions.updateMany({
      where: { round_id: current.body.id },
      data: { due_date: new Date(`${yesterday}T00:00:00.000Z`) },
    });

    expect(await rounds.markLateContributions()).toEqual({ marked: 10 });
    expect(await rounds.markLateContributions()).toEqual({ marked: 0 });

    const late = await prisma.contributions.findMany({ where: { round_id: current.body.id } });
    expect(late.every((entry) => entry.status === 'late')).toBe(true);
    expect(late.every((entry) => Number(entry.penalty_amount) === 500)).toBe(true);
  }, 60_000);
});
