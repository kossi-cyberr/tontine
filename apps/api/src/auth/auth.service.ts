import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { OtpPurpose, OtpService } from './otp.service';
import { TokenContext, TokenPair, TokensService } from './tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms.provider';
import { hashToken, randomToken, decryptString, encryptString } from '../common/crypto.util';
import { generateTotpSecret, totpOtpauthUrl, verifyTotp } from '../common/totp';
import type {
  ActivateInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from './auth.schemas';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ACTIVATION_TTL_DAYS = 7;

/** Hachage factice pour égaliser le temps de réponse quand le compte n'existe pas. */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$+IOlJ5Rgw/RgNVo43Tw4yw$U1ZOBpQ68663ERxo5HL9UA42TqH43QEXSMwAz5bQprw';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  private normalizeIdentifier(identifier: string): string {
    const value = identifier.trim();
    return value.startsWith('+') ? value.replace(/\s+/g, '') : value.toLowerCase();
  }

  async register(
    input: RegisterInput,
    context: TokenContext = {},
  ): Promise<TokenPair & { message: string }> {
    const existing = await this.prisma.users.findFirst({
      where: {
        OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])],
      },
      select: { phone: true },
    });

    if (existing) {
      throw new ConflictException({
        code: existing.phone === input.phone ? 'PHONE_TAKEN' : 'EMAIL_TAKEN',
        message:
          existing.phone === input.phone
            ? 'Ce numéro de téléphone est déjà utilisé.'
            : 'Cette adresse email est déjà utilisée.',
      });
    }

    const user = await this.prisma.users.create({
      data: {
        full_name: input.full_name,
        phone: input.phone,
        email: input.email ?? null,
        password_hash: await this.hashPassword(input.password),
        status: 'active',
      },
      select: { id: true, phone: true, platform_role: true },
    });

    const tokens = await this.tokens.issuePair(user, context);
    return { ...tokens, message: 'Compte créé. Vous êtes connecté.' };
  }

  async verifyOtp(target: string, purpose: OtpPurpose, code: string): Promise<{ message: string }> {
    const normalized = this.normalizeIdentifier(target);

    if (purpose === 'reset' || purpose === 'payout_account' || purpose === 'payout_approval') {
      await this.otp.check(normalized, purpose, code);
      return { message: 'Code valide.' };
    }

    throw new BadRequestException({
      code: 'UNSUPPORTED_OTP_PURPOSE',
      message: 'Cette vérification n’est pas disponible.',
    });
  }

  /** Jeton d'activation à usage unique (7 jours) pour les comptes créés par un président. */
  async createActivationToken(user: { id: string; phone: string }): Promise<string> {
    const token = randomToken(32);
    await this.prisma.otp_codes.create({
      data: {
        user_id: user.id,
        target: user.phone,
        purpose: 'activate',
        code_hash: hashToken(token),
        expires_at: new Date(Date.now() + ACTIVATION_TTL_DAYS * 86_400_000),
      },
    });
    return token;
  }

  /** Envoie le lien d'activation (7 jours) à un membre créé par un président. */
  async sendActivationLink(user: { id: string; phone: string }): Promise<void> {
    const token = await this.createActivationToken(user);
    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3050');
    await this.sms.send(
      user.phone,
      `Tontine : activez votre compte et choisissez votre mot de passe ici : ${baseUrl}/activation?token=${token} (valable 7 jours).`,
    );
  }

  async activate(input: ActivateInput): Promise<{ message: string }> {
    const row = await this.prisma.otp_codes.findFirst({
      where: {
        purpose: 'activate',
        code_hash: hashToken(input.token),
        used_at: null,
        expires_at: { gt: new Date() },
      },
    });

    if (!row?.user_id) {
      throw new BadRequestException({
        code: 'ACTIVATION_TOKEN_INVALID',
        message: 'Ce lien d’activation est invalide ou expiré.',
      });
    }

    const user = await this.prisma.users.findUnique({
      where: { id: row.user_id },
      select: { id: true, phone: true },
    });
    if (!user) {
      throw new BadRequestException({
        code: 'ACTIVATION_TOKEN_INVALID',
        message: 'Ce lien d’activation est invalide ou expiré.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { id: user.id },
        data: {
          password_hash: await this.hashPassword(input.password),
          status: 'active',
          phone_verified_at: new Date(),
        },
      }),
      this.prisma.otp_codes.update({ where: { id: row.id }, data: { used_at: new Date() } }),
      this.prisma.group_members.updateMany({
        where: { user_id: user.id, status: 'invited' },
        data: { status: 'active', joined_at: new Date() },
      }),
    ]);

    return { message: 'Compte activé. Vous pouvez vous connecter.' };
  }

  async login(input: LoginInput, context: TokenContext): Promise<TokenPair> {
    const identifier = this.normalizeIdentifier(input.identifier);

    const user = await this.prisma.users.findFirst({
      where: { OR: [{ phone: identifier }, { email: identifier }] },
    });

    if (!user) {
      await argon2.verify(DUMMY_HASH, input.password);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiant ou mot de passe incorrect.',
      });
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw new HttpException(
        {
          code: 'ACCOUNT_LOCKED',
          message: 'Compte verrouillé temporairement après plusieurs échecs. Réessayez plus tard.',
          details: { locked_until: user.locked_until.toISOString() },
        },
        423,
      );
    }

    const passwordOk = await argon2.verify(user.password_hash ?? DUMMY_HASH, input.password);

    if (!passwordOk) {
      const failed = user.failed_logins + 1;

      if (failed >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        await this.prisma.users.update({
          where: { id: user.id },
          data: { failed_logins: 0, locked_until: lockedUntil },
        });
        throw new HttpException(
          {
            code: 'ACCOUNT_LOCKED',
            message: `Trop de tentatives. Compte verrouillé pendant ${LOCK_MINUTES} minutes.`,
            details: { locked_until: lockedUntil.toISOString() },
          },
          423,
        );
      }

      await this.prisma.users.update({
        where: { id: user.id },
        data: { failed_logins: failed },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiant ou mot de passe incorrect.',
        details: { attempts_left: MAX_FAILED_LOGINS - failed },
      });
    }

    if (user.status === 'pending') {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVATED',
        message: 'Activez votre compte avec le code reçu par SMS.',
      });
    }
    if (user.status !== 'active') {
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Ce compte est suspendu ou fermé. Contactez l’assistance.',
      });
    }

    if (user.two_fa_enabled) {
      if (!input.totp_code) {
        throw new UnauthorizedException({
          code: 'TOTP_REQUIRED',
          message: 'Saisissez le code de votre application d’authentification.',
        });
      }

      const secret = user.two_fa_secret
        ? decryptString(user.two_fa_secret, this.config.get<string>('ENCRYPTION_KEY', ''))
        : null;

      if (!secret || !verifyTotp(secret, input.totp_code)) {
        throw new UnauthorizedException({
          code: 'TOTP_INVALID',
          message: 'Code de double authentification invalide.',
        });
      }
    }

    await this.prisma.users.update({
      where: { id: user.id },
      data: { failed_logins: 0, locked_until: null },
    });

    return this.tokens.issuePair(user, context);
  }

  async refresh(refreshToken: string, context: TokenContext): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, context);
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.tokens.revokeToken(refreshToken);
      return;
    }
    await this.tokens.revokeAll(userId);
  }

  async forgotPassword(identifier: string): Promise<{ message: string }> {
    // Réponse volontairement identique que le compte existe ou non.
    const normalized = this.normalizeIdentifier(identifier);
    const user = await this.prisma.users.findFirst({
      where: { OR: [{ phone: normalized }, { email: normalized }] },
      select: { id: true, phone: true, status: true },
    });

    if (user && user.status === 'active') {
      const code = await this.otp.issue({
        userId: user.id,
        target: user.phone,
        purpose: 'reset',
      });
      await this.sms.send(
        user.phone,
        `Tontine : code de réinitialisation ${code}. Valable 10 minutes.`,
      );
    }

    return {
      message:
        'Si un compte correspond à ces informations, un code de réinitialisation a été envoyé.',
    };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const normalized = this.normalizeIdentifier(input.identifier);
    const user = await this.prisma.users.findFirst({
      where: { OR: [{ phone: normalized }, { email: normalized }] },
      select: { id: true, phone: true },
    });

    if (!user) {
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'Code incorrect.' });
    }

    await this.otp.consume(user.phone, 'reset', input.code);

    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        password_hash: await this.hashPassword(input.new_password),
        failed_logins: 0,
        locked_until: null,
      },
    });
    await this.tokens.revokeAll(user.id);

    return { message: 'Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.' };
  }

  async enableTwoFactor(userId: string): Promise<{ secret: string; otpauth_url: string }> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, phone: true },
    });

    const secret = generateTotpSecret();
    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        two_fa_secret: encryptString(secret, this.config.get<string>('ENCRYPTION_KEY', '')),
        two_fa_enabled: true,
      },
    });

    return { secret, otpauth_url: totpOtpauthUrl(secret, user.phone) };
  }

  async getProfile(userId: string) {
    return this.prisma.users.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        full_name: true,
        phone: true,
        email: true,
        platform_role: true,
        kyc: true,
        two_fa_enabled: true,
        status: true,
        created_at: true,
      },
    });
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    try {
      return await this.prisma.users.update({
        where: { id: userId },
        data: {
          ...(input.full_name !== undefined ? { full_name: input.full_name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
        },
        select: {
          id: true,
          full_name: true,
          phone: true,
          email: true,
          kyc: true,
          two_fa_enabled: true,
        },
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'Cette adresse email est déjà utilisée.',
        });
      }
      throw error;
    }
  }
}
