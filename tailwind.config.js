/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ASA Hub design tokens (all CSS vars — flip automatically with [data-theme])
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        'border-strong': 'var(--border-strong)',
        'text-1': 'var(--text-1)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          strong: 'var(--primary-strong)',
          soft: 'var(--primary-soft)',
          foreground: 'var(--on-primary)',
        },
        'on-primary': 'var(--on-primary)',
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          text: 'var(--sidebar-text)',
        },
        'detail-hero': 'var(--detail-hero)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: {
          DEFAULT: 'var(--danger)',
          foreground: 'var(--on-primary)',
        },
        info: 'var(--info)',
        tint: {
          mint: 'var(--tint-mint)',
          peach: 'var(--tint-peach)',
          lavender: 'var(--tint-lavender)',
          pink: 'var(--tint-pink)',
          blue: 'var(--tint-blue)',
          amber: 'var(--tint-amber)',
          primary: 'var(--tint-primary)',
          danger: 'var(--tint-danger)',
          warning: 'var(--tint-warning)',
          info: 'var(--tint-info)',
          violet: 'var(--tint-violet)',
          slate: 'var(--tint-slate)',
        },
        'tint-fg': {
          mint: 'var(--tint-mint-fg)',
          peach: 'var(--tint-peach-fg)',
          lavender: 'var(--tint-lavender-fg)',
          pink: 'var(--tint-pink-fg)',
          blue: 'var(--tint-blue-fg)',
          amber: 'var(--tint-amber-fg)',
          primary: 'var(--tint-primary-fg)',
          danger: 'var(--tint-danger-fg)',
          warning: 'var(--tint-warning-fg)',
          info: 'var(--tint-info-fg)',
          violet: 'var(--tint-violet-fg)',
          slate: 'var(--tint-slate-fg)',
        },
        // shadcn/ui semantic aliases → design tokens
        background: 'var(--bg)',
        foreground: 'var(--text-1)',
        card: { DEFAULT: 'var(--surface)', foreground: 'var(--text-1)' },
        popover: { DEFAULT: 'var(--surface)', foreground: 'var(--text-1)' },
        secondary: { DEFAULT: 'var(--surface-2)', foreground: 'var(--text-1)' },
        muted: { DEFAULT: 'var(--surface-2)', foreground: 'var(--text-2)' },
        accent: { DEFAULT: 'var(--surface-2)', foreground: 'var(--text-1)' },
        destructive: { DEFAULT: 'var(--danger)', foreground: '#ffffff' },
        input: 'var(--border)',
        ring: 'var(--primary)',
      },
      // THE DESIGN KIT SAYS SYSTEM SANS, and it is why the mockups look the
      // way they do: they render in the reader's own interface face. Inter and
      // Manrope led the stack, so the product was set in a face the design
      // system does not use, which is most of the distance between the two.
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Inter', 'sans-serif'],
        display: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Manrope', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'Consolas', 'JetBrains Mono', 'monospace'],
      },
      // WEIGHT 500 IS THE CEILING — the kit states it twice, and the product
      // was carrying 2,124 uses of semibold and bold. Remapping here rather
      // than editing two thousand class names means one decision, one place,
      // and it can be undone the same way. `bold` keeps a single step of
      // emphasis at 600 for the eighteen places that genuinely contrast
      // against surrounding 500 — flattening those to 500 as well would erase
      // the distinction rather than soften it.
      fontWeight: {
        medium: '500',
        semibold: '500',
        bold: '600',
      },
      borderRadius: {
        sm: '10px',
        md: '14px',
        lg: '20px',
        xl: '24px',
        '2xl': '28px',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(.22,1,.36,1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
