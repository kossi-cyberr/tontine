import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../auth/otp.service';
import { encryptBuffer, decryptString } from '../common/crypto.util';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms.provider';
import type { PayoutAccountInput } from '../auth/auth.schemas';

const MAX_KYC_BYTES = 5 * 1024 * 1024;
const ALLOWED_KYC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

export interface UploadedDocument {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Signature binaire : le MIME déclaré par le client ne suffit pas. */
function detectDocumentType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /** Enregistre la pièce d'identité chiffrée (AES-256-GCM) sur disque. */
  async submitKyc(userId: string, file?: UploadedDocument) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Sélectionnez une pièce d’identité (JPEG, PNG ou PDF).',
      });
    }
    if (!ALLOWED_KYC_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: 'Formats acceptés : JPEG, PNG ou PDF.',
      });
    }
    if (file.size > MAX_KYC_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Le fichier ne doit pas dépasser 5 Mo.',
      });
    }

    const detected = detectDocumentType(file.buffer);
    if (!detected || detected !== file.mimetype) {
      throw new BadRequestException({
        code: 'FILE_CONTENT_INVALID',
        message: 'Le contenu du fichier ne correspond pas à un JPEG, PNG ou PDF valide.',
      });
    }

    const directory = join(process.cwd(), 'storage', 'kyc');
    await fs.mkdir(directory, { recursive: true });

    const filename = `${userId}-${randomUUID()}.enc`;
    const encrypted = encryptBuffer(file.buffer, this.config.get<string>('ENCRYPTION_KEY', ''));
    await fs.writeFile(join(directory, filename), encrypted);

    await this.prisma.users.update({
      where: { id: userId },
      data: { kyc: 'submitted', id_document_url: `kyc/${filename}` },
    });

    return {
      status: 'submitted',
      message: 'Votre pièce d’identité a été reçue et sera vérifiée par un administrateur.',
    };
  }

  async listPayoutAccounts(userId: string) {
    const accounts = await this.prisma.payout_accounts.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        type: true,
        account_number: true,
        holder_name: true,
        is_default: true,
        active_from: true,
        verified_at: true,
      },
    });

    return accounts.map((account) => ({
      ...account,
      active: account.active_from.getTime() <= Date.now(),
    }));
  }

  /**
   * Sans `otp_code`, envoie un OTP et ne crée rien.
   * Avec `otp_code`, vérifie le code puis crée le compte, actif après 24 h.
   */
  async createPayoutAccount(userId: string, input: PayoutAccountInput) {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { id: userId },
      select: { phone: true },
    });

    if (!input.otp_code) {
      const code = await this.otp.issue({
        userId,
        target: user.phone,
        purpose: 'payout_account',
      });
      await this.sms.send(
        user.phone,
        `Tontine : code ${code} pour ajouter votre compte de réception. Valable 10 minutes.`,
      );
      return {
        otp_required: true,
        message: 'Un code de confirmation vous a été envoyé par SMS.',
      };
    }

    await this.otp.check(user.phone, 'payout_account', input.otp_code);

    const existing = await this.prisma.payout_accounts.findFirst({
      where: {
        user_id: userId,
        type: input.type,
        account_number: input.account_number,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'PAYOUT_ACCOUNT_EXISTS',
        message: 'Ce compte de réception est déjà enregistré.',
      });
    }

    const count = await this.prisma.payout_accounts.count({ where: { user_id: userId } });
    const account = await this.prisma.payout_accounts.create({
      data: {
        user_id: userId,
        type: input.type,
        account_number: input.account_number,
        holder_name: input.holder_name,
        is_default: count === 0,
        // Le code OTP vient d'être vérifié : le compte est authentifié, mais
        // reste inutilisable pour un décaissement pendant 24 h.
        verified_at: new Date(),
        active_from: new Date(Date.now() + 24 * 3_600_000),
      },
      select: {
        id: true,
        type: true,
        account_number: true,
        holder_name: true,
        is_default: true,
        active_from: true,
      },
    });

    return {
      ...account,
      active: false,
      message: 'Compte ajouté. Il sera utilisable pour un décaissement après 24 heures.',
    };
  }

  /** Contrôle d'intégrité : le secret TOTP doit rester déchiffrable. */
  assertTotpSecretReadable(encrypted: string | null): void {
    if (encrypted) {
      decryptString(encrypted, this.config.get<string>('ENCRYPTION_KEY', ''));
    }
  }
}
