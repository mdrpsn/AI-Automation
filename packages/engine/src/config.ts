import type { EngineConfig, Weights } from './types.js';

export type PresetName = 'competitive' | 'balanced' | 'social';

interface Preset {
  spreadCap: number;
  weights: Weights;
}

/**
 * Three presets and one slider (the cap). Six interacting weight sliders is a
 * tuning trap for someone standing on a court holding a paddle.
 */
export const PRESETS: Readonly<Record<PresetName, Preset>> = {
  competitive: {
    spreadCap: 0.4,
    weights: { spread: 3.0, imbalance: 3.0, intraGap: 2.0, repeat: 1.0, priority: 2.0 },
  },
  balanced: {
    spreadCap: 0.6,
    weights: { spread: 2.0, imbalance: 2.0, intraGap: 1.0, repeat: 2.0, priority: 3.0 },
  },
  social: {
    spreadCap: 1.0,
    weights: { spread: 1.0, imbalance: 1.0, intraGap: 0.5, repeat: 4.0, priority: 5.0 },
  },
};

export const DEFAULT_CONFIG: EngineConfig = {
  ...PRESETS.balanced,
  maxWaitRotations: 2.0,
  waitWeight: 1.0,
  deficitWeight: 1.0,
  defaultRotationSeconds: 780,
  exactPoolLimit: 30,
  restarts: 5,
  stretchThreshold: 0.4,
};

export function configFromPreset(
  preset: PresetName,
  overrides: Partial<EngineConfig> = {},
): EngineConfig {
  return { ...DEFAULT_CONFIG, ...PRESETS[preset], ...overrides };
}
