import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashCode, safeEqual } from '../common/crypto.util';

export const OTP_PURPOSES = [
  'register',
  'login',
  'reset',
  'activate',
  'payout_account',
  'payout_approval',
] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

const MAX_ATTEMPTS = 5;
const OTP_TTL_MINUTES: Record<string, number> = {
  register: 10,
  login: 10,
  reset: 10,
  payout_account: 10,
  payout_approval: 10,
};

interface IssueOptions {
  userId?: string | null;
  target: string;
  purpose: OtpPurpose;
  ttlMinutes?: number;
  /** Code imposé (activations, tests) au lieu d'un aléa. */
  code?: string;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get pepper(): string {
    return this.config.get<string>('ENCRYPTION_KEY', 'dev-pepper');
  }

  private get fixedCode(): string | undefined {
    return this.config.get<string>('OTP_FIXED_CODE') || undefined;
  }

  /** Émet un code OTP, le stocke haché et le renvoie pour l'envoi SMS. */
  async issue(options: IssueOptions): Promise<string> {
    const ttl = options.ttlMinutes ?? OTP_TTL_MINUTES[options.purpose] ?? 10;
    const code = options.code ?? this.fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.prisma.otp_codes.create({
      data: {
        user_id: options.userId ?? null,
        target: options.target,
        purpose: options.purpose,
        code_hash: hashCode(code, this.pepper),
        expires_at: new Date(Date.now() + ttl * 60_000),
      },
    });

    return code;
  }

  /**
   * Vérifie un code sans le consommer (le code reste utilisable jusqu'à son expiration).
   * Utilisé quand l'action finale valide elle-même le code.
   */
  async check(target: string, purpose: OtpPurpose, code: string): Promise<void> {
    const record = await this.prisma.otp_codes.findFirst({
      where: { target, purpose, used_at: null },
      orderBy: { created_at: 'desc' },
    });

    if (!record || record.expires_at.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'OTP_EXPIRED',
        message: 'Ce code est expiré. Demandez-en un nouveau.',
      });
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      throw new HttpException(
        {
          code: 'OTP_TOO_MANY_ATTEMPTS',
          message: 'Trop de tentatives sur ce code. Demandez-en un nouveau.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!safeEqual(record.code_hash, hashCode(code, this.pepper))) {
      const attempts = record.attempts + 1;
      await this.prisma.otp_codes.update({ where: { id: record.id }, data: { attempts } });
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'Code incorrect.',
        details: { attempts_left: Math.max(0, MAX_ATTEMPTS - attempts) },
      });
    }
  }

  /** Vérifie puis consomme le code (usage unique). */
  async consume(target: string, purpose: OtpPurpose, code: string): Promise<void> {
    await this.check(target, purpose, code);

    const updated = await this.prisma.otp_codes.updateMany({
      where: { target, purpose, used_at: null },
      data: { used_at: new Date() },
    });

    if (updated.count === 0) {
      throw new BadRequestException({
        code: 'OTP_ALREADY_USED',
        message: 'Ce code a déjà été utilisé.',
      });
    }
  }
}
