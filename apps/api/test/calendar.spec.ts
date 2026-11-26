import {
  computeLatePenalty,
  expectedRoundAmount,
  generateDrawSeed,
  generateSchedule,
  seededShuffle,
} from '../src/rounds/calendar';

function days(entries: { opens_on: Date; due_date: Date; payout_date: Date }[]): string[] {
  return entries.map((entry) => entry.opens_on.toISOString().slice(0, 10));
}

describe('Calendrier des tours (§8.5)', () => {
  it('génère un calendrier hebdomadaire et les échéances', () => {
    const schedule = generateSchedule('2026-01-05', 'weekly', 3, 2);

    expect(days(schedule)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(schedule[0]!.due_date.toISOString().slice(0, 10)).toBe('2026-01-07');
    expect(schedule[0]!.payout_date.toISOString().slice(0, 10)).toBe('2026-01-08');
  });

  it('génère un calendrier bimensuel de 14 jours', () => {
    const schedule = generateSchedule(new Date(Date.UTC(2026, 0, 5)), 'biweekly', 3, 3);

    expect(days(schedule)).toEqual(['2026-01-05', '2026-01-19', '2026-02-02']);
    expect(schedule[1]!.due_date.toISOString().slice(0, 10)).toBe('2026-01-22');
  });

  it('gère la fin de mois en calendrier mensuel', () => {
    const schedule = generateSchedule('2026-01-31', 'monthly', 4, 2);

    expect(days(schedule)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('gère le 29 février des années bissextiles', () => {
    const schedule = generateSchedule('2028-01-31', 'monthly', 2, 2);
    expect(days(schedule)).toEqual(['2028-01-31', '2028-02-29']);
  });
});

describe('Tirage au sort (§8.4)', () => {
  const members = Array.from({ length: 10 }, (_, index) => `membre-${index + 1}`);

  it('génère une graine de 32 octets en hexadécimal', () => {
    const seed = generateDrawSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(generateDrawSeed()).not.toBe(seed);
  });

  it('est reproductible avec la même graine', () => {
    const seed = 'a'.repeat(64);
    const first = seededShuffle(members, seed);
    const second = seededShuffle(members, seed);

    expect(first).toEqual(second);
    expect([...first].sort()).toEqual([...members].sort());
    expect(first).not.toEqual(members);
  });

  it('change d’ordre avec une autre graine', () => {
    const first = seededShuffle(members, 'b'.repeat(64));
    const second = seededShuffle(members, 'c'.repeat(64));
    expect(first).not.toEqual(second);
  });

  it('refuse une graine invalide', () => {
    expect(() => seededShuffle(members, 'trop-court')).toThrow();
  });
});

describe('Montants et pénalités (§8.1, §8.2)', () => {
  it('calcule le montant attendu selon la règle du bénéficiaire', () => {
    expect(expectedRoundAmount(10, 5000, true)).toBe(50_000);
    expect(expectedRoundAmount(10, 5000, false)).toBe(45_000);
  });

  it('calcule une pénalité fixe et en centièmes de pour cent', () => {
    expect(computeLatePenalty(5000, 'fixed', 500)).toBe(500);
    expect(computeLatePenalty(5000, 'percent', 100)).toBe(50);
    expect(computeLatePenalty(5000, 'percent', 10_000)).toBe(5000);
    expect(computeLatePenalty(3333, 'percent', 250)).toBe(83);
  });
});
