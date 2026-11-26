import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokensService } from '../src/auth/tokens.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

delete process.env.HTTP_PROXY;

const PASSWORD = 'Password123';
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  const stamp = String(Date.now()).slice(-6);
  return `+2376${stamp}${String(phoneCounter).padStart(2, '0')}`;
}

describe('Groupes et membres (e2e)', () => {
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

  async function createActiveUser(
    fullName = 'Membre Test',
  ): Promise<{ id: string; token: string; phone: string }> {
    const phone = nextPhone();
    const user = await prisma.users.create({
      data: {
        full_name: fullName,
        phone,
        password_hash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        status: 'active',
        kyc: 'verified',
      },
    });
    const pair = await tokens.issuePair(user);
    return { id: user.id, token: pair.access_token, phone };
  }

  async function createGroup(token: string, overrides: Record<string, unknown> = {}) {
    const response = await api
      .post('/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Tontine test ${Date.now()}`,
        contribution_amount: 5000,
        frequency: 'monthly',
        start_date: '2027-06-01',
        min_members: 10,
        max_members: 10,
        ...overrides,
      })
      .expect(201);

    return response.body as {
      id: string;
      invite_code: string;
      my_role: string;
      members_count: number;
      contribution_amount: number;
      status: string;
    };
  }

  it('crée un groupe, le créateur devient président et il apparaît dans ses groupes', async () => {
    const president = await createActiveUser('Président Test');
    const group = await createGroup(president.token);

    expect(group.my_role).toBe('president');
    expect(group.members_count).toBe(1);
    expect(group.invite_code).toHaveLength(8);
    expect(group.status).toBe('recruiting');

    const list = await api
      .get('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(group.id);
  });

  it('refuse l’accès au groupe à un non-membre', async () => {
    const president = await createActiveUser();
    const outsider = await createActiveUser();
    const group = await createGroup(president.token);

    await api
      .get(`/groups/${group.id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });

  it('crée un membre et interdit l’ajout au trésorier ou au membre simple', async () => {
    const president = await createActiveUser();
    const member = await createActiveUser('Trésorier Test');
    const group = await createGroup(president.token);

    const added = await api
      .post(`/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: 'Nouveau Membre', phone: '+237690000001', role: 'treasurer' })
      .expect(201);

    expect(added.body.member.role).toBe('treasurer');
    expect(added.body.activation_sent).toBe(true);

    // Le membre test n'appartient pas encore au groupe.
    await api
      .post(`/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ full_name: 'Intrus', phone: '+237690000002' })
      .expect(403);
  });

  it('valide une demande d’adhésion par code, refuse les doublons et respecte les rôles', async () => {
    const president = await createActiveUser();
    const candidate = await createActiveUser('Candidat');
    const group = await createGroup(president.token);

    await api
      .post('/groups/join')
      .set('Authorization', `Bearer ${candidate.token}`)
      .send({ invite_code: group.invite_code })
      .expect(202);

    await api
      .post('/groups/join')
      .set('Authorization', `Bearer ${candidate.token}`)
      .send({ invite_code: group.invite_code })
      .expect(409);

    const members = await api
      .get(`/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    const pending = members.body.find((m: { status: string }) => m.status === 'pending');
    expect(pending).toBeTruthy();

    // Un membre simple ne peut pas valider.
    await api
      .post(`/groups/${group.id}/members/${pending.id}/approve`)
      .set('Authorization', `Bearer ${candidate.token}`)
      .expect(403);

    const approved = await api
      .post(`/groups/${group.id}/members/${pending.id}/approve`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(approved.body.status).toBe('active');

    const role = await api
      .patch(`/groups/${group.id}/members/${pending.id}/role`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ role: 'treasurer' })
      .expect(200);
    expect(role.body.role).toBe('treasurer');

    // Le membre ne peut pas modifier les rôles.
    await api
      .patch(`/groups/${group.id}/members/${pending.id}/role`)
      .set('Authorization', `Bearer ${candidate.token}`)
      .send({ role: 'member' })
      .expect(403);
  });

  it('refuse au président de changer son propre rôle', async () => {
    const president = await createActiveUser();
    const group = await createGroup(president.token);

    const members = await api
      .get(`/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    const self = members.body[0];

    await api
      .patch(`/groups/${group.id}/members/${self.id}/role`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ role: 'member' })
      .expect(403);
  });

  it('suspend un membre, qui perd alors l’accès au groupe', async () => {
    const president = await createActiveUser();
    const member = await createActiveUser('À suspendre');
    const group = await createGroup(president.token);

    const added = await api
      .post(`/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: 'À suspendre', phone: member.phone })
      .expect(201);
    expect(added.body.member.status).toBe('active');

    await api
      .post(`/groups/${group.id}/members/${added.body.member.id}/suspend`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);

    await api.get(`/groups/${group.id}`).set('Authorization', `Bearer ${member.token}`).expect(403);
  });

  it('respecte la limite de membres du groupe', async () => {
    const president = await createActiveUser();
    const group = await createGroup(president.token);

    for (let index = 0; index < 9; index += 1) {
      await api
        .post(`/groups/${group.id}/members`)
        .set('Authorization', `Bearer ${president.token}`)
        .send({ full_name: `Membre ${index}`, phone: nextPhone() })
        .expect(201);
    }

    const full = await api
      .post(`/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: 'Trop de monde', phone: nextPhone() })
      .expect(422);
    expect(full.body.code).toBe('MEMBER_LIMIT_REACHED');
  });

  it('fige les règles financières après lancement mais autorise la description', async () => {
    const president = await createActiveUser();
    const group = await createGroup(president.token);

    await prisma.groups.update({
      where: { id: group.id },
      data: { launched_at: new Date(), status: 'active' },
    });

    const locked = await api
      .patch(`/groups/${group.id}`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ contribution_amount: 10_000 })
      .expect(409);
    expect(locked.body.code).toBe('GROUP_LOCKED');

    const allowed = await api
      .patch(`/groups/${group.id}`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ description: 'Description mise à jour' })
      .expect(200);
    expect(allowed.body.description).toBe('Description mise à jour');
  });

  it('importe un CSV avec rapport ligne par ligne', async () => {
    const president = await createActiveUser();
    const group = await createGroup(president.token);
    const duplicatePhone = nextPhone();

    const stamp = Date.now();
    const csv = [
      'full_name,phone,email',
      `Premier Importé,${duplicatePhone},premier-${stamp}@test.local`,
      `Doublon Interne,${duplicatePhone},doublon-${stamp}@test.local`,
      'Téléphone Invalide,12345,',
    ].join('\n');

    const report = await api
      .post(`/groups/${group.id}/members/import`)
      .set('Authorization', `Bearer ${president.token}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'membres.csv')
      .expect(200);

    expect(report.body.created).toBe(1);
    expect(report.body.skipped).toBe(1);
    expect(report.body.errors).toHaveLength(1);
    expect(report.body.errors[0].line).toBe(4);
  });

  it('applique les limites plateforme et permet d’accepter le règlement', async () => {
    const president = await createActiveUser();
    const group = await createGroup(president.token);

    await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: 'Trop petit groupe',
        contribution_amount: 5000,
        frequency: 'monthly',
        start_date: '2027-06-01',
        min_members: 5,
        max_members: 10,
      })
      .expect(422);

    const accepted = await api
      .post(`/groups/${group.id}/accept-rules`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(accepted.body.rules_accepted_at).toBeTruthy();
  });
});
