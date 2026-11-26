import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';
import { SmsModule } from '../sms/sms.module';
import { MeController } from '../me/me.controller';
import { MeService } from '../me/me.service';

@Module({
  imports: [
    SmsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, OtpService, TokensService, MeService],
  exports: [JwtModule, AuthService, OtpService, TokensService],
})
export class AuthModule {}
