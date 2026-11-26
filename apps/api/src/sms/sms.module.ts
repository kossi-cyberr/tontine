import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider, RealSmsProvider } from './console-sms.provider';
import { SMS_PROVIDER } from './sms.provider';

@Global()
@Module({
  providers: [
    ConsoleSmsProvider,
    RealSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, ConsoleSmsProvider, RealSmsProvider],
      useFactory: (
        config: ConfigService,
        consoleProvider: ConsoleSmsProvider,
        realProvider: RealSmsProvider,
      ) => (config.get<string>('SMS_PROVIDER') === 'real' ? realProvider : consoleProvider),
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
