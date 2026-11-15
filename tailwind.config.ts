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
        graphite: {
          950: '#0E0D0B',
          900: '#141210',
          800: '#1B1916',
          700: '#24211D',
          600: '#2F2B26',
        },
        accent: {
          DEFAULT: '#E07A4A',
          soft: 'rgb(224 122 74 / .14)',
        },
        ember: {
          DEFAULT: '#E07A4A',
          soft: 'rgb(224 122 74 / .14)',
        },
        sev: {
          critical: '#D06B5E',
          warning: '#CF9150',
          watch: '#BFAE62',
          normal: '#7E9F89',
        },
        space: {
          950: '#04070F',
          900: '#070B14',
          800: '#0B1222',
          700: '#111B33',
          600: '#1A2748',
        },
        modis: '#E08A55',
        viirs: '#6FA3D6',
        harmonized: '#CDAE52',
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
        panel: '0 1px 2px rgb(0 0 0 / .25), 0 8px 24px -12px rgb(0 0 0 / .35)',
      },
    },
  },
  plugins: [],
} satisfies Config;
