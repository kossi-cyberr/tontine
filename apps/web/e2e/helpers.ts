import { createHmac, randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3051';
export const OTP_CODE = process.env.E2E_OTP_CODE ?? '123456';
export const PASSWORD = 'Tontine2026!';

export interface TestUser {
  phone: string;
  access_token: string;
  refresh_token: string;
}

let sequence = 0;

export function uniquePhone(): string {
  sequence = (sequence + 1) % 100;
  return `+2376${String(Date.now()).slice(-6)}${String(sequence).padStart(2, '0')}`;
}

async function ensureOk(response: Awaited<ReturnType<APIRequestContext['post']>>, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} a échoué (HTTP ${response.status()}) : ${await response.text()}`);
  }
  return response;
}

export async function registerUser(
  request: APIRequestContext,
  fullName: string,
): Promise<TestUser> {
  const phone = uniquePhone();

  await ensureOk(
    await request.post(`${API_URL}/v1/auth/register`, {
      data: { full_name: fullName, phone, password: PASSWORD },
    }),
    `Inscription ${phone}`,
  );

  await ensureOk(
    await request.post(`${API_URL}/v1/auth/verify-otp`, {
      data: { target: phone, purpose: 'register', code: OTP_CODE },
    }),
    `Vérification OTP ${phone}`,
  );

  const login = await ensureOk(
    await request.post(`${API_URL}/v1/auth/login`, {
      data: { identifier: phone, password: PASSWORD },
    }),
    `Connexion ${phone}`,
  );
  const tokens = (await login.json()) as { access_token: string; refresh_token: string };

  return { phone, ...tokens };
}

export async function seedSession(page: Page, user: TestUser): Promise<void> {
  await page.addInitScript(
    (tokens) => {
      window.localStorage.setItem('tontine.access_token', tokens.access_token);
      window.localStorage.setItem('tontine.refresh_token', tokens.refresh_token);
    },
    { access_token: user.access_token, refresh_token: user.refresh_token },
  );
}

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.access_token}` };
}

export interface ApiGroup {
  id: string;
  invite_code: string;
  name: string;
}

export async function createGroup(
  request: APIRequestContext,
  president: TestUser,
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<ApiGroup> {
  const response = await ensureOk(
    await request.post(`${API_URL}/v1/groups`, {
      headers: auth(president),
      data: {
        name,
        contribution_amount: 5000,
        frequency: 'monthly',
        start_date: new Date().toISOString().slice(0, 10),
        min_members: 10,
        max_members: 10,
        payout_rule: 'flexible',
        beneficiary_pays: true,
        payment_deadline_days: 2,
        late_fee_type: 'fixed',
        late_fee_value: 0,
        platform_fee_type: 'percent',
        platform_fee_value: 0,
        order_mode: 'random',
        dual_approval_threshold: null,
        ...overrides,
      },
    }),
    `Création du groupe ${name}`,
  );
  return (await response.json()) as ApiGroup;
}

export async function joinGroup(
  request: APIRequestContext,
  member: TestUser,
  inviteCode: string,
): Promise<void> {
  await ensureOk(
    await request.post(`${API_URL}/v1/groups/join`, {
      headers: auth(member),
      data: { invite_code: inviteCode },
    }),
    `Demande d’adhésion ${member.phone}`,
  );
}

export async function approveMember(
  request: APIRequestContext,
  president: TestUser,
  groupId: string,
  memberPhone: string,
): Promise<void> {
  const list = await ensureOk(
    await request.get(`${API_URL}/v1/groups/${groupId}/members`, {
      headers: auth(president),
    }),
    'Liste des membres',
  );
  const members = (await list.json()) as { id: string; phone: string }[];
  const member = members.find((entry) => entry.phone === memberPhone);
  if (!member) throw new Error(`Membre ${memberPhone} introuvable dans le groupe.`);

  await ensureOk(
    await request.post(`${API_URL}/v1/groups/${groupId}/members/${member.id}/approve`, {
      headers: auth(president),
    }),
    `Validation ${memberPhone}`,
  );
}

export async function acceptRules(
  request: APIRequestContext,
  member: TestUser,
  groupId: string,
): Promise<void> {
  await ensureOk(
    await request.post(`${API_URL}/v1/groups/${groupId}/accept-rules`, {
      headers: auth(member),
    }),
    `Acceptation du règlement ${member.phone}`,
  );
}

export async function launchGroup(
  request: APIRequestContext,
  president: TestUser,
  groupId: string,
): Promise<void> {
  await ensureOk(
    await request.post(`${API_URL}/v1/groups/${groupId}/draw`, { headers: auth(president) }),
    'Tirage au sort',
  );
  await ensureOk(
    await request.post(`${API_URL}/v1/groups/${groupId}/launch`, { headers: auth(president) }),
    'Lancement du groupe',
  );
}

/**
 * Le job d’ouverture des tours passe toutes les 15 minutes. Pour un test local déterministe,
 * le tour 1 est ouvert directement en base : le paiement et sa confirmation restent, eux,
 * exécutés par l’API réelle.
 */
export async function openFirstRound(groupId: string): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.rounds.updateMany({
      where: { group_id: groupId, round_number: 1 },
      data: { status: 'open' },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** Construit un groupe lancé de 10 membres et renvoie le membre qui paiera via l’UI. */
export async function createLaunchedGroup(
  request: APIRequestContext,
): Promise<{ groupId: string; member: TestUser }> {
  const president = await registerUser(request, 'Président E2E');
  const group = await createGroup(request, president, `Tontine E2E ${Date.now()}`);

  const members: TestUser[] = [];
  for (let index = 0; index < 9; index += 1) {
    const member = await registerUser(request, `Membre E2E ${index + 1}`);
    await joinGroup(request, member, group.invite_code);
    await approveMember(request, president, group.id, member.phone);
    await acceptRules(request, member, group.id);
    members.push(member);
  }

  await launchGroup(request, president, group.id);
  await openFirstRound(group.id);

  return { groupId: group.id, member: members[0]! };
}

/** Envoie le webhook signé du fournisseur mock, comme le ferait l’agrégateur. */
export async function confirmMockPayment(
  request: APIRequestContext,
  providerReference: string,
  amount: number,
): Promise<void> {
  const secret = process.env.MOCK_PROVIDER_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('MOCK_PROVIDER_WEBHOOK_SECRET est absent du .env : webhook mock impossible.');
  }

  const body = JSON.stringify({
    event_id: `evt_${randomUUID()}`,
    provider_reference: providerReference,
    status: 'confirmed',
    amount,
    occurred_at: new Date().toISOString(),
  });
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  await ensureOk(
    await request.post(`${API_URL}/v1/webhooks/payments/mock`, {
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
      data: body,
    }),
    'Webhook de confirmation mock',
  );
}
