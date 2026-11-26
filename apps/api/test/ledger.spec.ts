/**
 * Preuve que le grand livre est append-only : INSERT accepté,
 * UPDATE et DELETE refusés par le trigger `trg_ledger_no_update`.
 *
 * Tout le jeu de données est créé dans une transaction annulée en fin de test,
 * afin de ne rien laisser dans la base (les lignes du ledger ne pouvant être supprimées).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class RollbackFixture extends Error {}

describe('ledger_entries (append-only)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("refuse UPDATE et DELETE mais accepte l'INSERT", async () => {
    const suffix = Date.now().toString(36);

    await expect(
      prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            full_name: 'Test Ledger',
            phone: `+2376999${suffix.slice(-5)}`,
            email: `ledger-${suffix}@test.local`,
          },
        });

        const group = await tx.groups.create({
          data: {
            name: `Test ledger ${suffix}`,
            contribution_amount: 5000,
            frequency: 'monthly',
            start_date: new Date('2026-01-05'),
            invite_code: `T${suffix.slice(-10)}`.toUpperCase(),
            created_by: user.id,
          },
        });

        const escrow = await tx.escrow_accounts.create({
          data: { group_id: group.id, currency: 'XAF' },
        });

        const entry = await tx.ledger_entries.create({
          data: {
            escrow_account_id: escrow.id,
            type: 'contribution',
            credit: 5000n,
            description: 'Cotisation de test',
          },
        });
        expect(entry.credit).toBe(5000n);

        await tx.$executeRawUnsafe('SAVEPOINT sp_update');
        await expect(
          tx.ledger_entries.update({ where: { id: entry.id }, data: { credit: 6000n } }),
        ).rejects.toThrow(/append-only/);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_update');

        await tx.$executeRawUnsafe('SAVEPOINT sp_delete');
        await expect(tx.ledger_entries.delete({ where: { id: entry.id } })).rejects.toThrow(
          /append-only/,
        );
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_delete');

        // La ligne est toujours intacte après les tentatives.
        const stillThere = await tx.ledger_entries.findUniqueOrThrow({ where: { id: entry.id } });
        expect(stillThere.credit).toBe(5000n);

        throw new RollbackFixture('rollback volontaire du jeu de test');
      }),
    ).rejects.toThrow(RollbackFixture);
  });
});
