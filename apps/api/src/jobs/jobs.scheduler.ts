import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MAINTENANCE_QUEUE } from './maintenance.processor';

@Injectable()
export class JobsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'open_rounds',
        { pattern: '*/15 * * * *', tz: 'Africa/Douala' },
        { name: 'open_rounds', data: {} },
      );
      await this.queue.upsertJobScheduler(
        'mark_late',
        { pattern: '5 0 * * *', tz: 'Africa/Douala' },
        { name: 'mark_late', data: {} },
      );
      await this.queue.upsertJobScheduler(
        'send_reminders',
        { pattern: '0 8 * * *', tz: 'Africa/Douala' },
        { name: 'send_reminders', data: {} },
      );
      await this.queue.upsertJobScheduler(
        'process_payouts',
        { pattern: '*/10 * * * *', tz: 'Africa/Douala' },
        { name: 'process_payouts', data: {} },
      );
      await this.queue.upsertJobScheduler(
        'retry_failed_payouts',
        { pattern: '*/30 * * * *', tz: 'Africa/Douala' },
        { name: 'retry_failed_payouts', data: {} },
      );
      await this.queue.upsertJobScheduler(
        'reconcile',
        { pattern: '0 2 * * *', tz: 'Africa/Douala' },
        { name: 'reconcile', data: {} },
      );
      this.logger.log(
        'Jobs planifiés : open_rounds, mark_late, send_reminders, process_payouts, retry_failed_payouts, reconcile.',
      );
    } catch (error) {
      this.logger.warn(
        `Planification des jobs impossible (Redis indisponible ?) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
