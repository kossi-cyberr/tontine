import { base32Decode, base32Encode, totpCode, verifyTotp } from '../src/common/totp';

// Vecteurs RFC 6238 (SHA-1) pour la graine "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('encode/décode le base32 de façon symétrique', () => {
    const raw = Buffer.from('12345678901234567890');
    expect(base32Decode(base32Encode(raw))).toEqual(raw);
  });

  it('produit les codes de référence RFC 6238', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpCode(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('accepte une période de tolérance et refuse un mauvais code', () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, '000000', now)).toBe(false);
  });
});
