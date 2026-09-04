/**
 * Seam for a real DUPR rating lookup.
 *
 * DUPR's API is partner-gated: a club needs credentials from their account
 * manager before ratings can be fetched by id. Until those exist, a typed DUPR
 * id is an identity string — useful for recognising the same person across
 * sessions, and for the organizer to verify by hand — and NOT a rating.
 *
 * The app never pretends otherwise. A player still taps their own skill level,
 * and any rating that came from a person rather than from DUPR is flagged as
 * self-reported so the organizer knows what they are looking at.
 *
 * To switch this on: implement `DuprLookup` against the partner API, read the
 * credentials from a server-only env var, and pass it to `setDuprLookup`.
 * Nothing else in the app has to change — accepted check-ins would simply
 * arrive with a verified rating instead of a claimed one.
 */

export interface DuprRating {
  duprId: string;
  /** Doubles rating, on the same 2.0-5.5 scale the engine uses. */
  doubles: number | null;
  /** False while DUPR still considers the rating provisional. */
  reliable: boolean;
}

export interface DuprLookup {
  readonly available: boolean;
  /** Null when the id is unknown or no credentials are configured. */
  fetchRating(duprId: string): Promise<DuprRating | null>;
}

export const unavailableDuprLookup: DuprLookup = {
  available: false,
  async fetchRating() {
    return null;
  },
};

let active: DuprLookup = unavailableDuprLookup;

export function setDuprLookup(lookup: DuprLookup): void {
  active = lookup;
}

export function getDuprLookup(): DuprLookup {
  return active;
}
