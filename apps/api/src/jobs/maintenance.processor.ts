import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PayoutsService } from '../payouts/payouts.service';
import { ReconciliationService } from '../payouts/reconciliation.service';
import { RoundsService } from '../rounds/rounds.service';

export const MAINTENANCE_QUEUE = 'maintenance';

@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly rounds: RoundsService,
    private readonly payouts: PayoutsService,
    private readonly reconciliation: ReconciliationService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'open_rounds': {
        const result = await this.rounds.openDueRounds();
        this.logger.log(`open_rounds : ${result.opened} tour(s) ouvert(s)`);
        return result;
      }
      case 'mark_late': {
        const result = await this.rounds.markLateContributions();
        this.logger.log(`mark_late : ${result.marked} cotisation(s) en retard`);
        return result;
      }
      case 'send_reminders': {
        const result = await this.rounds.sendRoundReminders();
        this.logger.log(`send_reminders : ${result.sent} rappel(s) envoyé(s)`);
        return result;
      }
      case 'process_payouts': {
        const result = await this.payouts.processEligiblePayouts();
        this.logger.log(
          `process_payouts : ${result.created} décaissement(s) préparé(s), ${result.skipped} ignoré(s)`,
        );
        return result;
      }
      case 'retry_failed_payouts': {
        const result = await this.payouts.retryFailedPayouts();
        this.logger.log(
          `retry_failed_payouts : ${result.retried} relance(s), ${result.succeeded} réussie(s)`,
        );
        return result;
      }
      case 'reconcile': {
        const result = await this.reconciliation.run();
        this.logger.log(`reconcile : ${result.status} (écart ${result.difference} XAF)`);
        return result;
      }
      default:
        throw new Error(`Job inconnu : ${job.name}`);
    }
  }
}
