/** Paizo reports duplicate credit with this leading note text. */
const ALREADY_PLAYED_NOTE = /^\s*player has already played/i;

/** True when Paizo marks a row as duplicate credit that earns no XP. */
export function isAlreadyPlayedSessionNote(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && ALREADY_PLAYED_NOTE.test(notes);
}
