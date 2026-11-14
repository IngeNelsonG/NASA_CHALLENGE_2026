import type { Config } from 'tailwindcss';

// Brand tokens follow the NASA Space Apps brand guide palette (verify hex values
// against the current guide at spaceappschallenge.org/brand before submitting).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#04070F',
          900: '#070B14',
          800: '#0B1222',
          700: '#111B33',
          600: '#1A2748',
        },
        brand: {
          deep: '#07173F',
          electric: '#0042A6',
          neon: '#0960E1',
          yonder: '#2E96F5',
          yellow: '#EAFE07',
        },
        modis: '#F57C2E',
        viirs: '#3FA9F5',
        harmonized: '#E3B62F',
        ink: {
          DEFAULT: '#E8EDF7',
          dim: '#A9B4CC',
          mute: '#7C89A6',
        },
        line: 'rgba(148,170,220,0.18)',
      },
      fontFamily: {
        display: ['"Fira Sans"', 'system-ui', 'sans-serif'],
        sans: ['Overpass', 'system-ui', 'sans-serif'],
        mono: ['"Overpass Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
} satisfies Config;
