import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type ledger_type } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LedgerMovement {
  escrowAccountId: string;
  roundId?: string | null;
  amount: bigint;
  referenceTable?: string | null;
  referenceId?: string | null;
  description?: string | null;
}

export interface LedgerBalance {
  ledger_balance: number;
  cached_balance: number;
  guarantee_balance: number;
  currency: string;
  consistent: boolean;
}

/**
 * Seule porte d'entrée pour écrire dans le grand livre.
 * Toutes les méthodes d'écriture exigent une transaction Prisma : une
 * confirmation de paiement est atomique (paiement, cotisation, ledger, tour,
 * séquestre) ou n'a aucun effet.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  private assertAmount(amount: bigint): void {
    if (amount <= 0n) {
      throw new BadRequestException({
        code: 'INVALID_LEDGER_AMOUNT',
        message: 'Un mouvement du grand livre doit être strictement positif.',
      });
    }
  }

  private async write(
    tx: Prisma.TransactionClient,
    type: ledger_type,
    movement: LedgerMovement,
    side: 'credit' | 'debit',
  ) {
    this.assertAmount(movement.amount);
    return tx.ledger_entries.create({
      data: {
        escrow_account_id: movement.escrowAccountId,
        round_id: movement.roundId ?? null,
        type,
        debit: side === 'debit' ? movement.amount : 0n,
        credit: side === 'credit' ? movement.amount : 0n,
        reference_table: movement.referenceTable ?? null,
        reference_id: movement.referenceId ?? null,
        description: movement.description ?? null,
      },
    });
  }

  /** Crédit d'une cotisation encaissée (montant de base, hors pénalité). */
  creditContribution(tx: Prisma.TransactionClient, movement: LedgerMovement) {
    return this.write(tx, 'contribution', movement, 'credit');
  }

  /** Crédit d'une pénalité de retard, versée à la caisse de garantie. */
  creditPenalty(tx: Prisma.TransactionClient, movement: LedgerMovement) {
    return this.write(tx, 'penalty', movement, 'credit');
  }

  /** Débit du net versé au bénéficiaire. */
  debitPayout(tx: Prisma.TransactionClient, movement: LedgerMovement) {
    return this.write(tx, 'payout', movement, 'debit');
  }

  /** Débit des frais retenus par la plateforme sur un décaissement. */
  debitPlatformFee(tx: Prisma.TransactionClient, movement: LedgerMovement) {
    return this.write(tx, 'platform_fee', movement, 'debit');
  }

  /** Débit des frais opérateur payés à l'agrégateur. */
  debitProviderFee(tx: Prisma.TransactionClient, movement: LedgerMovement) {
    return this.write(tx, 'provider_fee', movement, 'debit');
  }

  /** Remboursement d'une cotisation encaissée (annulation d'un tour). */
  refundContribution(tx: Prisma.TransactionClient, movement: LedgerMovement) {
    return this.write(tx, 'refund', movement, 'debit');
  }

  /** Écriture corrective : jamais de modification d'une ligne existante. */
  recordAdjustment(
    tx: Prisma.TransactionClient,
    movement: LedgerMovement,
    side: 'credit' | 'debit',
  ) {
    return this.write(tx, 'adjustment', movement, side);
  }

  /**
   * Solde recalculé depuis les écritures, comparé au cache `balance_cached`.
   * Un écart est anormal : il est journalisé pour investigation.
   */
  async getBalance(escrowAccountId: string): Promise<LedgerBalance> {
    const escrow = await this.prisma.escrow_accounts.findUnique({
      where: { id: escrowAccountId },
    });
    if (!escrow) {
      throw new BadRequestException({
        code: 'ESCROW_NOT_FOUND',
        message: 'Compte séquestre introuvable.',
      });
    }

    const totals = await this.prisma.ledger_entries.aggregate({
      where: { escrow_account_id: escrowAccountId },
      _sum: { credit: true, debit: true },
    });

    const ledgerBalance = Number((totals._sum.credit ?? 0n) - (totals._sum.debit ?? 0n));
    const cachedBalance = Number(escrow.balance_cached);
    const guaranteeBalance = Number(escrow.guarantee_balance);
    // Invariant comptable : le grand livre = fonds des tours + caisse de garantie.
    const consistent = ledgerBalance === cachedBalance + guaranteeBalance;

    if (!consistent) {
      this.logger.error(
        `Écart de séquestre détecté (${escrowAccountId}) : ledger=${ledgerBalance}, cache=${cachedBalance}, garantie=${guaranteeBalance}`,
      );
    }

    return {
      ledger_balance: ledgerBalance,
      cached_balance: cachedBalance,
      guarantee_balance: guaranteeBalance,
      currency: escrow.currency.trim(),
      consistent,
    };
  }
}
