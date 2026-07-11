/** Paizo reports duplicate credit with this leading note text. */
const ALREADY_PLAYED_NOTE = /^\s*player has already played/i;

/** True when a session must be omitted because Paizo marks it as already played. */
export function isAlreadyPlayedSessionNote(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && ALREADY_PLAYED_NOTE.test(notes);
}
