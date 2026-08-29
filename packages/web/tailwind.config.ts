import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deliberately high-contrast: this gets used outdoors in sunlight.
        ink: { DEFAULT: '#0b1220', soft: '#334155', faint: '#64748b' },
        surface: { DEFAULT: '#ffffff', sunk: '#f1f5f9', line: '#cbd5e1' },
        go: { DEFAULT: '#047857', soft: '#d1fae5' },
        warn: { DEFAULT: '#b45309', soft: '#fef3c7' },
        stop: { DEFAULT: '#b91c1c', soft: '#fee2e2' },
        accent: { DEFAULT: '#1d4ed8', soft: '#dbeafe' },
      },
    },
  },
  plugins: [],
} satisfies Config;
