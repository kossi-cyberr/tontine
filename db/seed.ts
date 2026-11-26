/**
 * Données de démonstration pour le développement local.
 * Idempotent : relançable sans erreur (upsert sur les clés uniques).
 *
 * Comptes créés (mot de passe commun : `Tontine2026!`) :
 *  - +237600000000  admin@tontine.local      super administrateur
 *  - +237677000001  president@tontine.local  président du groupe démo et Super Admin
 *  - +237677000002..010                      9 membres
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const PASSWORD = 'Tontine2026!';
const DEMO_INVITE_CODE = 'DEMO2026';

async function upsertUser(input: {
  phone: string;
  email: string;
  fullName: string;
  role: 'user' | 'super_admin';
}) {
  return prisma.users.upsert({
    where: { phone: input.phone },
    update: { full_name: input.fullName, platform_role: input.role },
    create: {
      phone: input.phone,
      email: input.email,
      full_name: input.fullName,
      password_hash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      platform_role: input.role,
      status: 'active',
      phone_verified_at: new Date(),
      email_verified_at: new Date(),
      kyc: 'verified',
    },
  });
}

async function main() {
  const admin = await upsertUser({
    phone: '+237600000000',
    email: 'admin@tontine.local',
    fullName: 'Admin Plateforme',
    role: 'super_admin',
  });

  const president = await upsertUser({
    phone: '+237677000001',
    email: 'president@tontine.local',
    fullName: 'Awa Ngo Bakang',
    role: 'super_admin',
  });

  const members = [];
  for (let i = 2; i <= 10; i += 1) {
    members.push(
      await upsertUser({
        phone: `+2376770000${String(i).padStart(2, '0')}`,
        email: `membre${i}@tontine.local`,
        fullName: `Membre Démo ${i}`,
        role: 'user',
      }),
    );
  }

  const group = await prisma.groups.upsert({
    where: { invite_code: DEMO_INVITE_CODE },
    update: {},
    create: {
      name: 'Tontine des amis de Douala',
      description: 'Groupe de démonstration (Phase 0).',
      rules_text: 'Cotisation mensuelle de 5 000 FCFA, ordre de passage tiré au sort.',
      contribution_amount: 5000,
      frequency: 'monthly',
      payment_deadline_days: 2,
      start_date: new Date('2026-01-05'),
      min_members: 10,
      max_members: 10,
      payout_rule: 'flexible',
      beneficiary_pays: true,
      platform_fee_type: 'percent',
      platform_fee_value: 150,
      order_mode: 'random',
      invite_code: DEMO_INVITE_CODE,
      status: 'recruiting',
      created_by: president.id,
    },
  });

  const roster = [
    { user: president, role: 'president' as const, position: 1 },
    ...members.map((user, index) => ({
      user,
      role: 'member' as const,
      position: index + 2,
    })),
  ];

  for (const entry of roster) {
    await prisma.group_members.upsert({
      where: { group_id_user_id: { group_id: group.id, user_id: entry.user.id } },
      update: { position: entry.position, role: entry.role },
      create: {
        group_id: group.id,
        user_id: entry.user.id,
        role: entry.role,
        status: 'active',
        position: entry.position,
        shares: 1,
        rules_accepted_at: new Date(),
        invited_by: president.id,
        approved_by: president.id,
        joined_at: new Date(),
      },
    });
  }

  await prisma.escrow_accounts.upsert({
    where: { group_id: group.id },
    update: {},
    create: { group_id: group.id, currency: 'XAF' },
  });

  console.log('Seed terminé :');
  console.log(`  super admin  ${admin.phone}`);
  console.log(`  président    ${president.phone}`);
  console.log(`  membres      ${members.length}`);
  console.log(`  groupe       ${group.name} (invite_code=${group.invite_code})`);
  console.log(`  mot de passe ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('Seed échoué :', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
