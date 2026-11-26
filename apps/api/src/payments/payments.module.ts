import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER } from './payment-provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RealPaymentProvider } from './real-payment.provider';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [PrismaModule, LedgerModule, NotificationsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('PAYMENT_PROVIDER') === 'real'
          ? new RealPaymentProvider(config)
          : new MockPaymentProvider(config),
    },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
