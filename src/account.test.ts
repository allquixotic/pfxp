import { describe, expect, test } from 'bun:test';

import {
  canonicalizePaizoEmail,
  createPaizoAccountIdentity,
  isPaizoAccountIdentity,
} from './account';

describe('Paizo account identity', () => {
  test('folds case and removes pasted whitespace', () => {
    expect(canonicalizePaizoEmail('  Sean. Example\n@GMAIL.COM\t')).toBe('sean.example@gmail.com');
    expect(createPaizoAccountIdentity(' USER@Example.COM ')).toEqual({
      key: 'user@example.com',
      email: 'user@example.com',
    });
  });

  test('preserves plus aliases as distinct accounts', () => {
    expect(canonicalizePaizoEmail('smcnam+hello@gmail.com')).not.toBe(
      canonicalizePaizoEmail('smcnam+something@gmail.com'),
    );
  });

  test('validates canonical identities', () => {
    expect(isPaizoAccountIdentity({ key: 'user@example.com', email: 'user@example.com' })).toBe(true);
    expect(isPaizoAccountIdentity({ key: 'USER@example.com', email: 'user@example.com' })).toBe(false);
  });
});
