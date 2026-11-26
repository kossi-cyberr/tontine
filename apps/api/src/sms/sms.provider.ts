export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  /** Envoie un SMS. Les implémentations ne doivent jamais journaliser de secret. */
  send(to: string, message: string): Promise<void>;
}
