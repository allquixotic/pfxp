export interface PaizoAccountIdentity {
  /** Canonical, case-insensitive storage and API key. */
  key: string;
  /** Canonical email shown in account and run pickers. */
  email: string;
}

/**
 * Canonicalize Paizo account email identity without collapsing `+` aliases.
 * Paizo accounts are case-insensitive for this app; all Unicode whitespace is
 * removed so pasted or accidentally spaced addresses resolve to one account.
 */
export function canonicalizePaizoEmail(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s/gu, '')
    .toLocaleLowerCase('en-US');
}

export function createPaizoAccountIdentity(value: string): PaizoAccountIdentity {
  const email = canonicalizePaizoEmail(value);
  return { key: email, email };
}

export function isPaizoAccountIdentity(value: unknown): value is PaizoAccountIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.email !== 'string' || typeof candidate.key !== 'string') return false;
  const canonical = canonicalizePaizoEmail(candidate.email);
  return canonical.length > 0 && candidate.key === canonical;
}
