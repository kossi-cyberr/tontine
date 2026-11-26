import { createHmac, randomBytes } from 'node:crypto';

export type RoundFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface ScheduleEntry {
  opens_on: Date;
  due_date: Date;
  payout_date: Date;
}

/** Ramène une date (ou chaîne AAAA-MM-JJ) à minuit UTC. */
export function toUtcDate(value: Date | string): Date {
  if (typeof value === 'string') {
    const [year = 0, month = 1, day = 1] = value.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Ajoute des mois calendaires en bornant le jour à la fin du mois cible. */
export function addMonthsClampedUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function periodStep(frequency: RoundFrequency): { days?: number; months?: number } {
  if (frequency === 'weekly') return { days: 7 };
  if (frequency === 'biweekly') return { days: 14 };
  return { months: 1 };
}

export function shiftByPeriod(date: Date, frequency: RoundFrequency, periods = 1): Date {
  const step = periodStep(frequency);
  if (step.days) return addDaysUtc(date, step.days * periods);
  return addMonthsClampedUtc(date, (step.months ?? 1) * periods);
}

/**
 * Calendrier §8.5 : pour chaque tour i, ouverture = début + (i-1) périodes,
 * échéance = ouverture + délai, décaissement = échéance + 1 jour.
 */
export function generateSchedule(
  startDate: Date | string,
  frequency: RoundFrequency,
  count: number,
  paymentDeadlineDays: number,
): ScheduleEntry[] {
  const start = toUtcDate(startDate);
  const entries: ScheduleEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    const opensOn = shiftByPeriod(start, frequency, index);
    const dueDate = addDaysUtc(opensOn, paymentDeadlineDays);
    entries.push({
      opens_on: opensOn,
      due_date: dueDate,
      payout_date: addDaysUtc(dueDate, 1),
    });
  }

  return entries;
}

/** Graine CSPRNG de 32 octets, sérialisée en hexadécimal. */
export function generateDrawSeed(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Mélange Fisher-Yates déterministe : même graine ⇒ même ordre.
 * Le flux pseudo-aléatoire est dérivé par HMAC-SHA256(seed, compteur).
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error('La graine doit être un hexadécimal de 64 caractères (32 octets).');
  }

  const result = [...items];
  let counter = 0;
  let pool = Buffer.alloc(0);

  const nextUint32 = (): number => {
    if (pool.length < 4) {
      const digest = createHmac('sha256', Buffer.from(seed, 'hex')).update(`${counter}`).digest();
      counter += 1;
      pool = Buffer.concat([pool, digest]);
    }
    const value = pool.readUInt32BE(0);
    pool = pool.subarray(4);
    return value;
  };

  for (let index = result.length - 1; index > 0; index -= 1) {
    const upper = index + 1;
    const limit = Math.floor(0x1_0000_0000 / upper) * upper;
    let value = nextUint32();
    while (value >= limit) value = nextUint32();
    const swapIndex = value % upper;
    const temporary = result[index]!;
    result[index] = result[swapIndex]!;
    result[swapIndex] = temporary;
  }

  return result;
}

/** §8.1 : N × cotisation si le bénéficiaire cotise, sinon (N - 1) × cotisation. */
export function expectedRoundAmount(
  participantCount: number,
  contributionAmount: number,
  beneficiaryPays: boolean,
): number {
  const payers = beneficiaryPays ? participantCount : Math.max(0, participantCount - 1);
  return payers * contributionAmount;
}

/** §8.2 : la valeur en pourcentage est exprimée en centièmes de pour cent. */
export function computeLatePenalty(
  contributionAmount: number,
  type: 'fixed' | 'percent',
  value: number,
): number {
  if (type === 'fixed') return Math.max(0, Math.trunc(value));
  return Math.max(0, Math.floor((contributionAmount * value) / 10_000));
}
