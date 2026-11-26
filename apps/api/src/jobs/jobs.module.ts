import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RoundsModule } from '../rounds/rounds.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { MaintenanceProcessor, MAINTENANCE_QUEUE } from './maintenance.processor';
import { JobsScheduler } from './jobs.scheduler';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL', 'redis://localhost:6379'),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
    RoundsModule,
    PayoutsModule,
  ],
  providers: [MaintenanceProcessor, JobsScheduler],
})
export class JobsModule {}
