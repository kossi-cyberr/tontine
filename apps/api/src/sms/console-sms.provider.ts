import { Injectable, Logger } from '@nestjs/common';
import type { SmsProvider } from './sms.provider';

/** Implémentation de développement : écrit le SMS dans les journaux de l'API. */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsDev');

  async send(to: string, message: string): Promise<void> {
    this.logger.log(`SMS vers ${to} : ${message}`);
  }
}

/**
 * Squelette d'un fournisseur réel (agrégateur SMS camerounais).
 * Les identifiants doivent venir de l'environnement, jamais du code.
 */
@Injectable()
export class RealSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsReal');

  async send(to: string, message: string): Promise<void> {
    this.logger.warn(`Fournisseur SMS réel non configuré (destinataire ${to}) : ${message}`);
    throw new Error('Aucun fournisseur SMS réel configuré');
  }
}
