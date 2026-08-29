/**
 * The engine contract.
 *
 * Everything here is plain data. The engine never touches the network, the DOM,
 * the clock, or a database — `now` is always passed in. Given an identical
 * Snapshot it must produce byte-identical output.
 */

export type PlayerId = string;
export type CourtId = string;

/** Where a checked-in player stands right now. */
export type PlayerStatus =
  /** In the queue, available to be picked. */
  | 'waiting'
  /** On court in an active match. Never selectable. */
  | 'playing'
  /** Taking a break. Not selectable; paused time does not count toward fair share. */
  | 'paused'
  /** Gone home. Never selectable. */
  | 'left';

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Skill rating on the native 2.0–5.5 scale. */
  rating: number;
  status: PlayerStatus;

  /**
   * Epoch ms from which the current wait is measured:
   * max(joinedAt, lastGameEndedAt, unpausedAt).
   */
  availableSince: number;
  /**
   * Seconds this player has actually been present and available, excluding
   * paused time. Drives fair-share expectations, so a late arrival is not
   * owed the same number of games as someone there since the start.
   */
  presentSeconds: number;

  gamesPlayed: number;
  courtSeconds: number;

  /**
   * Banked credit for having played below their level. Raises priority so the
   * same accommodating strong player is not drafted down every round.
   */
  stretchCredit: number;

  /** Players this person should not be put on court with, in either team. */
  avoid?: readonly PlayerId[];
}

/** A completed or in-progress match, used for repeat-pairing history. */
export interface MatchRecord {
  id: string;
  /** Monotonic within a session. Drives recency decay. */
  seq: number;
  teamA: readonly [PlayerId, PlayerId];
  teamB: readonly [PlayerId, PlayerId];
  startedAt: number;
  /** Null while the match is still being played. */
  endedAt: number | null;
}

export interface CourtState {
  id: CourtId;
  label: string;
  /** Only 'open' courts are filled. */
  status: 'open' | 'in_use' | 'closed';
}

export interface Weights {
  spread: number;
  imbalance: number;
  intraGap: number;
  repeat: number;
  priority: number;
}

export interface EngineConfig {
  /** Target maximum rating spread within a match. A steep hinge, not a hard limit. */
  spreadCap: number;
  weights: Weights;

  /**
   * A player waiting this many rotations is treated as starving and becomes a
   * must-include, as long as there is room for all such players.
   */
  maxWaitRotations: number;

  /** Relative pull of raw wait vs. cumulative games deficit inside priority(). */
  waitWeight: number;
  deficitWeight: number;

  /** Seconds. Seeded estimate of a game's length before any have completed. */
  defaultRotationSeconds: number;

  /** Exact enumeration is used at or below this pool size for a single court. */
  exactPoolLimit: number;
  /** Restarts for the heuristic solver. Deterministic seeds. */
  restarts: number;
  /** Playing more than this far below your own rating banks stretch credit. */
  stretchThreshold: number;
}

/** Organizer overrides. The engine fills around these; it never refuses them. */
export interface Overrides {
  /** Must be placed somewhere this round, if at all possible. */
  pinned?: readonly PlayerId[];
  /** Must not be selected at all. */
  excluded?: readonly PlayerId[];
  /** Players already dropped onto a specific court by hand. */
  lockedSlots?: Readonly<Record<CourtId, readonly PlayerId[]>>;
  /** Pairs that must partner each other (couples, coach + student). */
  mustPairWith?: readonly (readonly [PlayerId, PlayerId])[];
}

export interface Snapshot {
  now: number;
  players: readonly PlayerState[];
  courts: readonly CourtState[];
  /** Completed matches this session, for repeat-pairing history. */
  history: readonly MatchRecord[];
  config: EngineConfig;
  overrides?: Overrides;
  /**
   * Observed rotation length in seconds (EWMA of recent match durations).
   * Omit to let the engine derive it from `history`.
   */
  rotationSeconds?: number;
}

export interface ProposedMatch {
  courtId: CourtId;
  teamA: readonly [PlayerId, PlayerId];
  teamB: readonly [PlayerId, PlayerId];
  /** Total cost of this match under the configured weights. Lower is better. */
  cost: number;
  /** Component breakdown, for debugging and the explanation string. */
  breakdown: CostBreakdown;
  /** Human-readable justification shown to the organizer. */
  explanation: string;
  /** True when the match exceeds the spread cap — surfaced in the UI. */
  isStretch: boolean;
}

export interface CostBreakdown {
  spread: number;
  imbalance: number;
  intraGap: number;
  repeat: number;
  hard: number;
  /** Already negated: this is the reward subtracted from total cost. */
  priority: number;
  total: number;
  /** Raw rating spread, in rating points. */
  rawSpread: number;
  /** Raw |avgA - avgB|, in rating points. */
  rawImbalance: number;
  /** Raw worst within-team gap, in rating points. */
  rawIntraGap: number;
}

/** Why no match (or fewer than requested) could be produced. */
export type EngineReason =
  | 'ok'
  | 'no_open_courts'
  | 'not_enough_players'
  | 'all_excluded';

export interface EngineResult {
  matches: readonly ProposedMatch[];
  reason: EngineReason;
  /** Players left on the bench this round, in priority order (highest first). */
  benched: readonly PlayerId[];
  /** Available players who have now waited past `maxWaitRotations`. */
  starving: readonly PlayerId[];
  /** Rotation length actually used, in seconds. */
  rotationSeconds: number;
  /** Wall time spent solving, in ms. Reported for the latency invariant. */
  solveMs: number;
}
