import {
  canTransition,
  computePayoutAmounts,
  isEligibleForPayout,
  type PayoutEligibilityInput,
} from '../src/payouts/payout-rules';

function input(overrides: Partial<PayoutEligibilityInput> = {}): PayoutEligibilityInput {
  return {
    round: {
      status: 'ready',
      collected_amount: 30_000,
      expected_amount: 30_000,
      payout_date: new Date('2026-01-10T00:00:00.000Z'),
    },
    beneficiaryStatus: 'active',
    account: {
      verified_at: new Date('2025-12-30T00:00:00.000Z'),
      active_from: new Date('2025-12-31T00:00:00.000Z'),
    },
    guaranteeAvailable: 0,
    hasActivePayout: false,
    allowPartial: false,
    rule: 'strict',
    now: new Date('2026-01-11T09:00:00.000Z'),
    ...overrides,
  };
}

describe('Éligibilité au décaissement (§8.3)', () => {
  it('accepte un tour strictement collecté, sans condition de date', () => {
    const result = isEligibleForPayout(input({ now: new Date('2026-01-01T00:00:00.000Z') }));
    expect(result.eligible).toBe(true);
    expect(result.gross_amount).toBe(30_000);
    expect(result.reasons).toEqual([]);
  });

  it('refuse une collecte partielle en règle stricte', () => {
    const result = isEligibleForPayout(
      input({
        round: {
          status: 'collecting',
          collected_amount: 20_000,
          expected_amount: 30_000,
          payout_date: new Date('2026-01-10T00:00:00.000Z'),
        },
      }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('COLLECTION_INCOMPLETE');
  });

  it('règle souple : exige la date de décaissement', () => {
    const result = isEligibleForPayout(
      input({ rule: 'flexible', now: new Date('2026-01-09T23:00:00.000Z') }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('PAYOUT_DATE_NOT_REACHED');
  });

  it('règle souple : comble le manque avec la caisse de garantie', () => {
    const result = isEligibleForPayout(
      input({
        rule: 'flexible',
        round: {
          status: 'collecting',
          collected_amount: 25_000,
          expected_amount: 30_000,
          payout_date: new Date('2026-01-10T00:00:00.000Z'),
        },
        guaranteeAvailable: 8_000,
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.guarantee_used).toBe(5_000);
    expect(result.gross_amount).toBe(30_000);
  });

  it('règle souple : garantie insuffisante sans accord de versement partiel', () => {
    const result = isEligibleForPayout(
      input({
        rule: 'flexible',
        round: {
          status: 'collecting',
          collected_amount: 25_000,
          expected_amount: 30_000,
          payout_date: new Date('2026-01-10T00:00:00.000Z'),
        },
        guaranteeAvailable: 1_000,
      }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('COLLECTION_INCOMPLETE');
  });

  it('règle souple : accepte un versement partiel explicitement autorisé', () => {
    const result = isEligibleForPayout(
      input({
        rule: 'flexible',
        allowPartial: true,
        round: {
          status: 'collecting',
          collected_amount: 20_000,
          expected_amount: 30_000,
          payout_date: new Date('2026-01-10T00:00:00.000Z'),
        },
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.gross_amount).toBe(20_000);
  });

  it('refuse un compte de réception récent, non vérifié, absent ou un bénéficiaire inactif', () => {
    const recent = isEligibleForPayout(
      input({
        account: {
          verified_at: new Date('2026-01-09T00:00:00.000Z'),
          active_from: new Date('2026-01-12T00:00:00.000Z'),
        },
      }),
    );
    expect(recent.reasons).toContain('DESTINATION_ACCOUNT_TOO_RECENT');

    const unverified = isEligibleForPayout(
      input({
        account: { verified_at: null, active_from: new Date('2026-01-02T00:00:00.000Z') },
      }),
    );
    expect(unverified.reasons).toContain('DESTINATION_ACCOUNT_UNVERIFIED');

    expect(isEligibleForPayout(input({ account: null })).reasons).toContain(
      'DESTINATION_ACCOUNT_REQUIRED',
    );
    expect(isEligibleForPayout(input({ beneficiaryStatus: 'suspended' })).reasons).toContain(
      'BENEFICIARY_INACTIVE',
    );
  });

  it('refuse un second décaissement actif et un tour non éligible', () => {
    const result = isEligibleForPayout(
      input({ hasActivePayout: true, round: { ...input().round, status: 'scheduled' } }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['PAYOUT_ALREADY_ACTIVE', 'ROUND_NOT_ELIGIBLE']),
    );
  });
});

describe('Montants du décaissement (§8.1)', () => {
  it('calcule des frais fixes en entiers', () => {
    expect(computePayoutAmounts(50_000, 'fixed', 1_000, 0)).toEqual({
      gross_amount: 50_000,
      platform_fee: 1_000,
      provider_fee: 0,
      net_amount: 49_000,
    });
  });

  it('arrondit les pourcentages à l’unité inférieure (centièmes de %)', () => {
    // 1,5 % de 33 333 = 499,995 -> 499
    expect(computePayoutAmounts(33_333, 'percent', 150, 0)).toEqual({
      gross_amount: 33_333,
      platform_fee: 499,
      provider_fee: 0,
      net_amount: 32_834,
    });
  });

  it('plafonne les frais pour ne jamais produire un net négatif', () => {
    const result = computePayoutAmounts(1_000, 'fixed', 2_000, 500);
    expect(result.net_amount).toBe(0);
    expect(result.platform_fee).toBe(500);
    expect(result.provider_fee).toBe(500);
  });
});

describe('Machine à états', () => {
  it('autorise et refuse les transitions prévues', () => {
    expect(canTransition('payout', 'pending_approval', 'approved')).toBe(true);
    expect(canTransition('payout', 'processing', 'success')).toBe(true);
    expect(canTransition('payout', 'success', 'processing')).toBe(false);
    expect(canTransition('round', 'ready', 'paid_out')).toBe(true);
    expect(canTransition('round', 'paid_out', 'ready')).toBe(false);
    expect(canTransition('round', 'failed', 'ready')).toBe(true);
  });
});
