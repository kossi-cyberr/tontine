import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ledger_type } from '@prisma/client';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Types du grand livre adossés à des mouvements réels chez l'agrégateur.
 * Les frais plateforme restent chez la plateforme : ils ne figurent pas dans
 * le rapport du prestataire et sont donc exclus de la comparaison.
 */
const PROVIDER_BACKED_TYPES: ledger_type[] = [
  'contribution',
  'penalty',
  'payout',
  'provider_fee',
  'refund',
];

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  /** Les rapports du mock sont en mémoire : la comparaison démarre au boot. */
  private readonly startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async run(now = new Date()) {
    const report = await this.provider.report(this.startedAt);

    const rows = await this.prisma.ledger_entries.groupBy({
      by: ['type'],
      where: {
        type: { in: PROVIDER_BACKED_TYPES },
        created_at: { gte: this.startedAt },
      },
      _sum: { credit: true, debit: true },
    });

    const byType: Record<string, number> = {};
    let ledgerTotal = 0;
    for (const row of rows) {
      const value = Number((row._sum.credit ?? 0n) - (row._sum.debit ?? 0n));
      byType[row.type] = value;
      ledgerTotal += value;
    }

    const providerTotal = report.total_in - report.total_out;
    const difference = ledgerTotal - providerTotal;
    const status = difference === 0 ? 'ok' : 'mismatch';

    const reconciliation = await this.prisma.reconciliations.upsert({
      where: { run_date: utcDay(now) },
      create: {
        run_date: utcDay(now),
        ledger_total: BigInt(ledgerTotal),
        provider_total: BigInt(providerTotal),
        difference: BigInt(difference),
        status,
        details: {
          since: this.startedAt.toISOString(),
          provider_in: report.total_in,
          provider_out: report.total_out,
          provider_generated_at: report.generated_at,
          by_type: byType,
        },
      },
      update: {
        ledger_total: BigInt(ledgerTotal),
        provider_total: BigInt(providerTotal),
        difference: BigInt(difference),
        status,
        details: {
          since: this.startedAt.toISOString(),
          provider_in: report.total_in,
          provider_out: report.total_out,
          provider_generated_at: report.generated_at,
          by_type: byType,
        },
      },
    });

    if (status === 'mismatch') {
      this.logger.error(
        `ALERTE RÉCONCILIATION : écart de ${difference} XAF entre le grand livre (${ledgerTotal}) et l’agrégateur (${providerTotal}).`,
      );
    } else {
      this.logger.log(`Réconciliation OK : ${ledgerTotal} XAF de part et d’autre.`);
    }

    return this.serialize(reconciliation);
  }

  async list() {
    const rows = await this.prisma.reconciliations.findMany({
      orderBy: { run_date: 'desc' },
      take: 60,
    });
    return rows.map((row) => this.serialize(row));
  }

  private serialize(row: {
    id: string;
    run_date: Date;
    ledger_total: bigint;
    provider_total: bigint;
    difference: bigint;
    status: string;
    details: unknown;
    created_at: Date;
  }) {
    return {
      id: row.id,
      run_date: row.run_date.toISOString().slice(0, 10),
      ledger_total: Number(row.ledger_total),
      provider_total: Number(row.provider_total),
      difference: Number(row.difference),
      status: row.status,
      details: row.details,
      created_at: row.created_at.toISOString(),
    };
  }
}
