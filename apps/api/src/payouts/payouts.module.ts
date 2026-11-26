import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [PrismaModule, LedgerModule, PaymentsModule, AuthModule, NotificationsModule],
  controllers: [PayoutsController, ReconciliationController],
  providers: [PayoutsService, ReconciliationService],
  exports: [PayoutsService, ReconciliationService],
})
export class PayoutsModule {}
