/**
 * Test de charge Phase 8 : 100 cotisations confirmées en parallèle sur un même tour.
 * Mesure le p95 et vérifie le grand livre.
 *
 * Usage : npm run load:payments
 * Prérequis : API locale démarrée, MOCK_PROVIDER_AUTO_CONFIRM=false recommandé.
 * Le grand livre étant append-only, les données de charge restent en base
 * (groupe « Charge … ») : utilisez une base de test dédiée pour les purger.
 */
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv();

const apiUrl = (process.env.API_URL ?? 'http://localhost:3051').replace(/\/$/, '');
const secret = process.env.MOCK_PROVIDER_WEBHOOK_SECRET ?? 'dev-mock-webhook-secret';
const MEMBERS = Number(process.env.LOAD_MEMBERS ?? 100);
const AMOUNT = 1000;
const today = new Date().toISOString().slice(0, 10);

const prisma = new PrismaClient();
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

function sign(body) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const target = new URL(`${apiUrl}/v1/webhooks/payments/mock`);
const transport = target.protocol === 'https:' ? https : http;
const agent = new transport.Agent({ keepAlive: true, maxSockets: MEMBERS });

function postWebhook(body, signature) {
  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Signature': signature,
        },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body: text.slice(0, 300) }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function seed() {
  const userIds = Array.from({ length: MEMBERS }, () => randomUUID());
  const groupId = randomUUID();
  const cycleId = randomUUID();
  const roundId = randomUUID();
  const escrowId = randomUUID();
  const memberIds = Array.from({ length: MEMBERS }, () => randomUUID());
  const contributionIds = Array.from({ length: MEMBERS }, () => randomUUID());
  const paymentIds = Array.from({ length: MEMBERS }, () => randomUUID());

  await prisma.users.createMany({
    data: userIds.map((id, index) => ({
      id,
      full_name: `Charge ${runId} ${index + 1}`,
      phone: `+2378${String(Date.now()).slice(-5)}${String(index).padStart(3, '0')}`,
      status: 'active',
      kyc: 'verified',
    })),
  });

  await prisma.groups.create({
    data: {
      id: groupId,
      name: `Charge ${runId}`,
      contribution_amount: BigInt(AMOUNT),
      frequency: 'monthly',
      start_date: new Date(`${today}T00:00:00.000Z`),
      min_members: MEMBERS,
      max_members: MEMBERS,
      invite_code: runId.slice(-8),
      status: 'active',
      created_by: userIds[0],
      launched_at: new Date(),
    },
  });

  await prisma.group_members.createMany({
    data: userIds.map((userId, index) => ({
      id: memberIds[index],
      group_id: groupId,
      user_id: userId,
      role: index === 0 ? 'president' : 'member',
      status: 'active',
      position: index + 1,
      joined_at: new Date(),
      rules_accepted_at: new Date(),
      approved_by: userIds[0],
    })),
  });

  await prisma.cycles.create({
    data: {
      id: cycleId,
      group_id: groupId,
      cycle_number: 1,
      start_date: new Date(`${today}T00:00:00.000Z`),
      status: 'running',
    },
  });

  await prisma.rounds.create({
    data: {
      id: roundId,
      cycle_id: cycleId,
      group_id: groupId,
      round_number: 1,
      beneficiary_member_id: memberIds[0],
      opens_on: new Date(`${today}T00:00:00.000Z`),
      due_date: new Date(`${today}T00:00:00.000Z`),
      payout_date: new Date(`${today}T00:00:00.000Z`),
      expected_amount: BigInt(MEMBERS * AMOUNT),
      status: 'collecting',
    },
  });

  await prisma.contributions.createMany({
    data: contributionIds.map((id, index) => ({
      id,
      round_id: roundId,
      member_id: memberIds[index],
      amount: BigInt(AMOUNT),
      due_date: new Date(`${today}T00:00:00.000Z`),
      status: 'pending',
    })),
  });

  await prisma.escrow_accounts.create({
    data: { id: escrowId, group_id: groupId, currency: 'XAF', balance_cached: 0n },
  });

  const references = paymentIds.map((id) => `LOAD-${runId}-${id}`);
  await prisma.payments.createMany({
    data: paymentIds.map((id, index) => ({
      id,
      contribution_id: contributionIds[index],
      user_id: userIds[index],
      provider: 'mock',
      provider_reference: references[index],
      method: 'mtn_momo',
      amount: BigInt(AMOUNT),
      status: 'initiated',
      idempotency_key: `load-${runId}-${index}`,
    })),
  });

  return {
    userIds,
    groupId,
    roundId,
    escrowId,
    paymentIds,
    references,
    eventIds: references.map((_, index) => `evt_load_${runId}_${index}`),
  };
}

async function main() {
  const data = await seed();
  let failure = null;

  try {
    const durations = [];
    const statuses = [];
    const errors = [];

    await Promise.all(
      data.references.map(async (providerReference, index) => {
        const payload = {
          event_id: data.eventIds[index],
          provider_reference: providerReference,
          status: 'confirmed',
          amount: AMOUNT,
        };
        const body = JSON.stringify(payload);
        const startedAt = performance.now();
        const response = await postWebhook(body, sign(body));
        durations.push(performance.now() - startedAt);
        statuses.push(response.status);
        if (response.status !== 200) {
          errors.push({ status: response.status, body: response.body });
        }
      }),
    );

    const [confirmedPayments, paidContributions, escrow, ledger, round] = await Promise.all([
      prisma.payments.count({ where: { id: { in: data.paymentIds }, status: 'confirmed' } }),
      prisma.contributions.count({ where: { round_id: data.roundId, status: 'paid' } }),
      prisma.escrow_accounts.findUniqueOrThrow({ where: { id: data.escrowId } }),
      prisma.ledger_entries.aggregate({
        where: { escrow_account_id: data.escrowId },
        _sum: { credit: true, debit: true },
      }),
      prisma.rounds.findUniqueOrThrow({ where: { id: data.roundId } }),
    ]);

    const ledgerTotal = Number((ledger._sum.credit ?? 0n) - (ledger._sum.debit ?? 0n));
    const cached = Number(escrow.balance_cached);
    const expected = MEMBERS * AMOUNT;
    const p95 = Math.round(percentile(durations, 0.95));

    failure = {
      httpErrors: statuses.filter((status) => status !== 200).length,
      confirmedPayments,
      paidContributions,
      ledgerTotal,
      cached,
      roundStatus: round.status,
      roundCollected: Number(round.collected_amount),
      p95,
    };

    const coherent =
      statuses.every((status) => status === 200) &&
      confirmedPayments === MEMBERS &&
      paidContributions === MEMBERS &&
      ledgerTotal === expected &&
      cached === expected &&
      Number(round.collected_amount) === expected &&
      round.status === 'ready';

    console.log(
      JSON.stringify(
        {
          members: MEMBERS,
          p50_ms: Math.round(percentile(durations, 0.5)),
          p95_ms: p95,
          max_ms: Math.round(Math.max(...durations)),
          ...failure,
          errors: errors.slice(0, 3),
          ledger_coherent: coherent,
          target_p95_ms: 2000,
        },
        null,
        2,
      ),
    );

    if (!coherent) failure = { ...failure, ledger_coherent: false };
    if (p95 >= 2000) failure = { ...failure, p95_over_target: true };
  } finally {
    console.log(`Données de charge conservées : groupe ${data.groupId} (${runId}).`);
  }

  agent.destroy();

  if (failure) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
