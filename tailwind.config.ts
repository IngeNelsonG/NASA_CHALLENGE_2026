import type { Config } from 'tailwindcss';

// Layout language: a warm cream page with dark, rounded "windows" (hero, explorer) and dark data cards.
// Text and line colours are CSS variables so the same utility classes work on both surfaces:
// see the scopes in src/index.css (:root = dark surface, .section = cream surface).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: '#EFE5D7',
          deep: '#E2D5C2',
        },
        coal: '#171411',
        ember: '#F2703A',
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
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          dim: 'rgb(var(--ink-dim) / <alpha-value>)',
          mute: 'rgb(var(--ink-mute) / <alpha-value>)',
        },
        line: 'rgb(var(--line) / calc(<alpha-value> * var(--line-a)))',
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
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
