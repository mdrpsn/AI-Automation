/**
 * Self check-in: a player scans the QR, types their name and taps a skill
 * level, and lands in a tray for the organizer to accept.
 *
 * Everything here is pure so the rules can be tested directly. They matter more
 * than they look: this is the one place in the app where a stranger's input
 * reaches the matching engine, and a wrong rating wrecks that player's first
 * game.
 */

/** Matches the tap-scale in the organizer's own check-in panel. */
export const RATING_STEPS = [2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5, 5.0] as const;

export const MIN_RATING: number = RATING_STEPS[0];
export const MAX_RATING: number = RATING_STEPS[RATING_STEPS.length - 1]!;

export const MAX_NAME_LENGTH = 40;
/** Beyond this many people waiting to be accepted, something has gone wrong. */
export const MAX_PENDING = 80;

export interface CheckInRequest {
  name: string;
  rating: number;
  duprId?: string;
}

export interface PendingCheckIn extends CheckInRequest {
  id: string;
  submittedAt: number;
}

export type CheckInError =
  | 'name_required'
  | 'name_too_long'
  | 'rating_invalid'
  | 'dupr_required'
  | 'dupr_invalid'
  | 'too_many_pending'
  | 'closed';

export const CHECK_IN_MESSAGES: Record<CheckInError, string> = {
  name_required: 'Please enter your name.',
  name_too_long: 'That name is too long.',
  rating_invalid: 'Please choose a skill level.',
  dupr_required: 'This session needs your DUPR ID.',
  dupr_invalid: 'That does not look like a DUPR ID.',
  too_many_pending: 'Too many people are waiting to be checked in. Please see the organizer.',
  closed: 'Check-in is closed for this session.',
};

/** Control characters only arrive from pasted junk or an injection attempt. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Collapse whitespace and strip control characters. Names are rendered as text
 * everywhere, so this is tidiness rather than the security boundary.
 */
export function normalizeName(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * DUPR ids are short alphanumeric codes. We cannot verify one without partner
 * API access, so this only rejects input that is obviously not an id — being
 * stricter would turn away valid players over a format guess.
 */
export function normalizeDuprId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
}

export function isPlausibleDuprId(id: string): boolean {
  return /^[A-Z0-9]{4,12}$/.test(id);
}

function nearestStep(rating: number): number {
  let best = RATING_STEPS[0] as number;
  for (const step of RATING_STEPS) {
    if (Math.abs(step - rating) < Math.abs(best - rating)) best = step;
  }
  return best;
}

export interface ValidationContext {
  open: boolean;
  duprRequired: boolean;
  pendingCount: number;
}

export type ValidationResult =
  | { ok: true; value: CheckInRequest }
  | { ok: false; error: CheckInError };

export function validateCheckIn(
  input: { name?: unknown; rating?: unknown; duprId?: unknown },
  ctx: ValidationContext,
): ValidationResult {
  if (!ctx.open) return { ok: false, error: 'closed' };
  if (ctx.pendingCount >= MAX_PENDING) return { ok: false, error: 'too_many_pending' };

  const rawName = typeof input.name === 'string' ? input.name : '';
  if (rawName.length > MAX_NAME_LENGTH * 8) return { ok: false, error: 'name_too_long' };

  const name = normalizeName(rawName);
  if (name.length === 0) return { ok: false, error: 'name_required' };

  const rating = typeof input.rating === 'number' ? input.rating : Number.NaN;
  if (!Number.isFinite(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    return { ok: false, error: 'rating_invalid' };
  }

  const dupr = typeof input.duprId === 'string' ? normalizeDuprId(input.duprId) : '';
  if (ctx.duprRequired) {
    if (dupr.length === 0) return { ok: false, error: 'dupr_required' };
    if (!isPlausibleDuprId(dupr)) return { ok: false, error: 'dupr_invalid' };
  } else if (dupr.length > 0 && !isPlausibleDuprId(dupr)) {
    return { ok: false, error: 'dupr_invalid' };
  }

  return {
    ok: true,
    value: {
      name,
      // Snap to the scale the organizer uses, so a hand-crafted request cannot
      // introduce ratings that exist nowhere else in the app.
      rating: nearestStep(rating),
      ...(dupr.length > 0 ? { duprId: dupr } : {}),
    },
  };
}

/** Same person, near enough, for warning the organizer about a duplicate. */
export function looksLikeSamePerson(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  return key(a).length > 0 && key(a) === key(b);
}
