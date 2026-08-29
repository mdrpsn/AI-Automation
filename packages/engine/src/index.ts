export * from './types.js';
export { DEFAULT_CONFIG, PRESETS, configFromPreset } from './config.js';
export type { PresetName } from './config.js';
export { fillCourts } from './select.js';
export {
  bestSplit,
  matchCost,
  pairCost,
  spreadCost,
  buildHardConstraints,
  makeCostCache,
  TEAM_SPLITS,
} from './cost.js';
export type { CostCache, CostContext, Foursome, Lineup, HardConstraints } from './cost.js';
export { buildPairHistory, EMPTY_PAIR_HISTORY } from './history.js';
export type { PairHistory } from './history.js';
export {
  WAIT_ROTATION_CAP,
  availablePlayers,
  clamp,
  computeFairShare,
  estimateRotationSeconds,
  findStarving,
  makePriorityContext,
  priority,
  rawWaitRotations,
  waitRotations,
} from './priority.js';
export type { PriorityContext } from './priority.js';
export { explainMatch } from './explain.js';
export {
  DEFAULT_RATING_CONFIG,
  actualScore,
  expectedScore,
  ratingDelta,
  settleSession,
} from './rating.js';
export type {
  MatchResult,
  PendingRating,
  RatingConfig,
  RatingDelta,
  RatingEvidence,
  Settlement,
} from './rating.js';
export { hashString, makeRng } from './rng.js';
export type { Rng } from './rng.js';

export const ENGINE_VERSION = '0.1.0';
