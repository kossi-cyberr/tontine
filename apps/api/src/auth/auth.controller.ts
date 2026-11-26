import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import {
  activateSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyOtpSchema,
  type ActivateInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type UpdateProfileInput,
} from './auth.schemas';

@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/register')
  @RateLimit(30, 60_000)
  @ApiOperation({ summary: 'Inscription avec envoi d’un OTP SMS' })
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Public()
  @Post('auth/verify-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit(60, 60_000)
  @ApiOperation({ summary: 'Vérifier un code OTP' })
  verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema))
    body: {
      target: string;
      purpose: 'register' | 'reset' | 'payout_account';
      code: string;
    },
  ) {
    return this.auth.verifyOtp(body.target, body.purpose, body.code);
  }

  @Public()
  @Post('auth/activate')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  @ApiOperation({ summary: 'Activer un compte créé par un président' })
  activate(@Body(new ZodValidationPipe(activateSchema)) body: ActivateInput) {
    return this.auth.activate(body);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(50, 60_000)
  @ApiOperation({ summary: 'Connexion par téléphone ou email' })
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Req() request: Request) {
    return this.auth.login(body, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit(50, 60_000)
  @ApiOperation({ summary: 'Renouveler le jeton d’accès' })
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: { refresh_token: string },
    @Req() request: Request,
  ) {
    return this.auth.refresh(body.refresh_token, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnexion (révoque le refresh token)' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(logoutSchema)) body: { refresh_token?: string },
  ): Promise<void> {
    await this.auth.logout(user.id, body.refresh_token);
  }

  @Public()
  @Post('auth/forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(20, 60_000)
  @ApiOperation({ summary: 'Demande de réinitialisation du mot de passe' })
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: { identifier: string }) {
    return this.auth.forgotPassword(body.identifier);
  }

  @Public()
  @Post('auth/reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  @ApiOperation({ summary: 'Définir un nouveau mot de passe' })
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    return this.auth.resetPassword(body);
  }

  @Post('auth/2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activer la double authentification TOTP' })
  enableTwoFactor(@CurrentUser() user: AuthUser) {
    return this.auth.enableTwoFactor(user.id);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mon profil' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.getProfile(user.id);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Modifier mon profil' })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.auth.updateProfile(user.id, body);
  }
}
