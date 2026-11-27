import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { totpCode } from '../src/common/totp';

delete process.env.HTTP_PROXY;

const PASSWORD = 'Password123';
const OTP = '000000';

function phone(): string {
  return `+2376${randomBytes(4).readUInt32BE(0).toString().padStart(8, '0').slice(0, 8)}`;
}

describe('Authentification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let api: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    api = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser(overrides: { email?: string } = {}) {
    const target = phone();
    const response = await api
      .post('/auth/register')
      .send({ full_name: 'Test Auth', phone: target, password: PASSWORD, ...overrides })
      .expect(201);
    expect(response.body.access_token).toBeTruthy();
    expect(response.body.refresh_token).toBeTruthy();
    return target;
  }

  async function activeUser() {
    return registerUser();
  }

  it('inscrit un compte actif sans OTP et ouvre une session', async () => {
    const target = await activeUser();
    const user = await prisma.users.findUniqueOrThrow({ where: { phone: target } });
    expect(user.status).toBe('active');

    await api.post('/auth/login').send({ identifier: target, password: PASSWORD }).expect(200);
  });

  it('refuse un numéro déjà inscrit', async () => {
    const target = await registerUser();
    const response = await api
      .post('/auth/register')
      .send({ full_name: 'Doublon', phone: target, password: PASSWORD })
      .expect(409);
    expect(response.body.code).toBe('PHONE_TAKEN');
  });

  it('refuse un OTP de réinitialisation expiré', async () => {
    const target = await activeUser();
    await api.post('/auth/forgot-password').send({ identifier: target }).expect(202);
    await prisma.otp_codes.updateMany({
      where: { target, purpose: 'reset' },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    const response = await api
      .post('/auth/reset-password')
      .send({ identifier: target, code: OTP, new_password: 'NouveauPass123' })
      .expect(400);
    expect(response.body.code).toBe('OTP_EXPIRED');
  });

  it('refuse la réutilisation d’un OTP de réinitialisation', async () => {
    const target = await activeUser();
    await api.post('/auth/forgot-password').send({ identifier: target }).expect(202);
    await api
      .post('/auth/reset-password')
      .send({ identifier: target, code: OTP, new_password: 'NouveauPass123' })
      .expect(200);

    const response = await api
      .post('/auth/reset-password')
      .send({ identifier: target, code: OTP, new_password: 'AutrePass123' })
      .expect(400);
    expect(['OTP_ALREADY_USED', 'OTP_EXPIRED']).toContain(response.body.code);
  });

  it('bloque après 5 tentatives sur un OTP de réinitialisation', async () => {
    const target = await activeUser();
    await api.post('/auth/forgot-password').send({ identifier: target }).expect(202);

    for (let i = 0; i < 5; i += 1) {
      await api
        .post('/auth/reset-password')
        .send({ identifier: target, code: '111111', new_password: 'NouveauPass123' })
        .expect(400);
    }
    const response = await api
      .post('/auth/reset-password')
      .send({ identifier: target, code: '111111', new_password: 'NouveauPass123' })
      .expect(429);
    expect(response.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('verrouille le compte après 5 mots de passe erronés', async () => {
    const target = await activeUser();

    for (let i = 0; i < 4; i += 1) {
      await api
        .post('/auth/login')
        .send({ identifier: target, password: 'WrongPass123' })
        .expect(401);
    }
    await api
      .post('/auth/login')
      .send({ identifier: target, password: 'WrongPass123' })
      .expect(423);

    const blocked = await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD })
      .expect(423);
    expect(blocked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('émet des jetons et refuse un refresh token révoqué', async () => {
    const target = await activeUser();
    const login = await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD })
      .expect(200);

    expect(login.body.access_token).toBeTruthy();
    expect(login.body.refresh_token).toBeTruthy();
    expect(login.body.expires_in).toBe(900);

    const refreshed = await api
      .post('/auth/refresh')
      .send({ refresh_token: login.body.refresh_token })
      .expect(200);
    expect(refreshed.body.refresh_token).not.toBe(login.body.refresh_token);

    // L'ancien refresh token a été révoqué par la rotation.
    await api.post('/auth/refresh').send({ refresh_token: login.body.refresh_token }).expect(401);
  });

  it('renvoie la même réponse au mot de passe oublié, compte existant ou non', async () => {
    const target = await activeUser();
    const known = await api.post('/auth/forgot-password').send({ identifier: target }).expect(202);
    const unknown = await api
      .post('/auth/forgot-password')
      .send({ identifier: phone() })
      .expect(202);

    expect(known.body).toEqual(unknown.body);

    const otp = await prisma.otp_codes.findFirst({
      where: { target, purpose: 'reset', used_at: null },
    });
    expect(otp).not.toBeNull();
  });

  it('réinitialise le mot de passe avec un OTP et révoque les sessions', async () => {
    const target = await activeUser();
    await api.post('/auth/forgot-password').send({ identifier: target }).expect(202);

    await api
      .post('/auth/reset-password')
      .send({ identifier: target, code: OTP, new_password: 'NouveauPass123' })
      .expect(200);

    await api.post('/auth/login').send({ identifier: target, password: PASSWORD }).expect(401);
    await api
      .post('/auth/login')
      .send({ identifier: target, password: 'NouveauPass123' })
      .expect(200);
  });

  it('refuse l’accès sans jeton et l’accepte avec un jeton valide', async () => {
    await api.get('/me').expect(401);

    const target = await activeUser();
    const login = await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD })
      .expect(200);

    const me = await api
      .get('/me')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(200);
    expect(me.body.phone).toBe(target);
    expect(me.body.password_hash).toBeUndefined();
  });

  it('active un compte créé par un président via un lien à usage unique', async () => {
    const target = await registerUser();
    const user = await prisma.users.findUniqueOrThrow({ where: { phone: target } });
    const token = await auth.createActivationToken({ id: user.id, phone: user.phone });

    await api.post('/auth/activate').send({ token, password: 'ActivePass123' }).expect(200);
    await api
      .post('/auth/login')
      .send({ identifier: target, password: 'ActivePass123' })
      .expect(200);

    await api.post('/auth/activate').send({ token, password: 'ActivePass123' }).expect(400);
  });

  it('active la 2FA et l’exige à la connexion', async () => {
    const target = await activeUser();
    const login = await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD })
      .expect(200);

    const enabled = await api
      .post('/auth/2fa/enable')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(200);
    expect(enabled.body.secret).toBeTruthy();
    expect(enabled.body.otpauth_url).toContain('otpauth://totp/');

    const required = await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD })
      .expect(401);
    expect(required.body.code).toBe('TOTP_REQUIRED');

    await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD, totp_code: '000000' })
      .expect(401);

    const valid = await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD, totp_code: totpCode(enabled.body.secret) })
      .expect(200);
    expect(valid.body.access_token).toBeTruthy();
  });

  it('ajoute un compte de réception après OTP, actif seulement après 24 h', async () => {
    const target = await activeUser();
    const login = await api
      .post('/auth/login')
      .send({ identifier: target, password: PASSWORD })
      .expect(200);
    const token = `Bearer ${login.body.access_token}`;

    const challenge = await api
      .post('/me/payout-accounts')
      .set('Authorization', token)
      .send({ type: 'mtn_momo', account_number: '699000000', holder_name: 'Test Auth' })
      .expect(201);
    expect(challenge.body.otp_required).toBe(true);

    const created = await api
      .post('/me/payout-accounts')
      .set('Authorization', token)
      .send({
        type: 'mtn_momo',
        account_number: '699000000',
        holder_name: 'Test Auth',
        otp_code: OTP,
      })
      .expect(201);
    expect(created.body.active).toBe(false);
    const delay = new Date(created.body.active_from).getTime() - Date.now();
    expect(delay).toBeGreaterThan(23 * 3_600_000);

    const list = await api.get('/me/payout-accounts').set('Authorization', token).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].is_default).toBe(true);
  });
});
