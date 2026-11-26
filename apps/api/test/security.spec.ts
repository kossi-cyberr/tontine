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
  return `+2375${String(Date.now()).slice(-5)}${String(phoneCounter).padStart(3, '0')}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

interface TestUser {
  id: string;
  phone: string;
  token: string;
}

describe('Durcissement sécurité (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokensService;
  let api: ReturnType<typeof request>;
  let admin: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokensService);
    api = request(app.getHttpServer());

    await prisma.platform_settings.update({
      where: { key: 'group_limits' },
      data: { value: { min: 3, max: 100 } },
    });

    admin = await createUser('Admin Sécurité', 'super_admin');
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

  it('réserve le relevé CSV aux gestionnaires du groupe', async () => {
    const president = await createUser('Président Sécurité');
    const member = await createUser('Membre Sécurité');
    const other = await createUser('Autre Sécurité');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Sécurité ${Date.now()}`,
        contribution_amount: 1000,
        frequency: 'monthly',
        start_date: dateOnly(new Date()),
        min_members: 3,
        max_members: 3,
      })
      .expect(201);
    const groupId = created.body.id as string;

    for (const user of [member, other]) {
      await api
        .post(`/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${president.token}`)
        .send({ full_name: user.phone, phone: user.phone, role: 'member' })
        .expect(201);
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

    await api
      .get(`/groups/${groupId}/statement.csv`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(403);

    const statement = await api
      .get(`/groups/${groupId}/statement.csv`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(statement.headers['content-type']).toContain('text/csv');
    // Les numéros commençant par « + » sont neutralisés pour Excel.
    expect(statement.text).toContain('"\'+237');

    await api
      .get(`/groups/${groupId}/statement.csv`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
  }, 60_000);

  it('cache les litiges aux membres en attente et leur refuse l’ouverture', async () => {
    const president = await createUser('Président Litige');
    const member = await createUser('Membre Litige');
    const pending = await createUser('Candidat Litige');

    const created = await api
      .post('/groups')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        name: `Litige ${Date.now()}`,
        contribution_amount: 1000,
        frequency: 'monthly',
        start_date: dateOnly(new Date()),
        min_members: 3,
        max_members: 3,
      })
      .expect(201);
    const groupId = created.body.id as string;

    await api
      .post(`/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${president.token}`)
      .send({ full_name: member.phone, phone: member.phone, role: 'member' })
      .expect(201);

    await api
      .post('/groups/join')
      .set('Authorization', `Bearer ${pending.token}`)
      .send({ invite_code: created.body.invite_code })
      .expect(202);

    await api
      .post('/disputes')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        group_id: groupId,
        subject: 'Pièce jointe dangereuse',
        description: 'Une URL javascript ne doit jamais être acceptée.',
        attachments: ['javascript:alert(1)'],
      })
      .expect(400);

    const dispute = await api
      .post('/disputes')
      .set('Authorization', `Bearer ${president.token}`)
      .send({
        group_id: groupId,
        subject: 'Tour suspendu sans explication',
        description: 'Le tour courant est bloqué depuis deux jours sans décision.',
        attachments: [],
      })
      .expect(201);

    const visible = await api
      .get('/disputes')
      .set('Authorization', `Bearer ${pending.token}`)
      .expect(200);
    expect(visible.body.items.some((item: { id: string }) => item.id === dispute.body.id)).toBe(
      false,
    );

    await api
      .post('/disputes')
      .set('Authorization', `Bearer ${pending.token}`)
      .send({
        group_id: groupId,
        subject: 'Je veux contester',
        description: 'Je ne suis pas encore membre mais je veux ouvrir un litige.',
        attachments: [],
      })
      .expect(403);
  }, 60_000);

  it('rejette un fichier KYC dont le contenu ne correspond pas au type déclaré', async () => {
    const user = await createUser('Candidat KYC Sécurité');

    await api
      .post('/me/kyc')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('document', VALID_PNG, { filename: 'piece.png', contentType: 'image/png' })
      .expect(202);

    const fake = await api
      .post('/me/kyc')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('document', Buffer.from('ceci nest pas une image'), {
        filename: 'faux.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(fake.body.code).toBe('FILE_CONTENT_INVALID');

    // La limite de 5 appels/minute protège l’envoi massif de fichiers.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await api
        .post('/me/kyc')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('document', Buffer.from('faux'), {
          filename: 'faux.png',
          contentType: 'image/png',
        })
        .expect(400);
    }
    await api
      .post('/me/kyc')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('document', VALID_PNG, { filename: 'piece.png', contentType: 'image/png' })
      .expect(429);
  }, 60_000);

  it('ignore un X-Forwarded-For forgé dans le journal d’audit', async () => {
    const candidate = await createUser('KYC Audit', 'user', 'submitted');

    await api
      .patch(`/admin/users/${candidate.id}/kyc`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ decision: 'verified' })
      .expect(200);

    const audit = await prisma.audit_logs.findFirst({
      where: { action: 'kyc.verify', entity_id: candidate.id },
      orderBy: { id: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.ip).not.toBe('203.0.113.7');
  }, 60_000);
});
