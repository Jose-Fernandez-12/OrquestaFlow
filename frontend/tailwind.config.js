/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#fafafa',
        surface: '#ffffff',
        fg: '#111111',
        muted: '#6b6b6b',
        border: '#e5e5e5',
        accent: {
          DEFAULT: '#2f6feb',
          hover: 'color-mix(in oklab, #2f6feb, black 8%)',
          active: 'color-mix(in oklab, #2f6feb, black 14%)',
          on: '#ffffff',
          light: 'color-mix(in oklab, #2f6feb, transparent 90%)',
        },
        success: '#17a34a',
        warn: '#eab308',
        danger: '#dc2626',
      },
      fontFamily: {
        display: ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
        body: ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'xs': '12px',
        'sm': '14px',
        'base': '16px',
        'lg': '20px',
        'xl': '24px',
        '2xl': '32px',
        '3xl': '48px',
        '4xl': '64px',
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '12': '48px',
        '20': '80px',
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'pill': '9999px',
      },
      boxShadow: {
        'flat': 'none',
        'ring': '0 0 0 1px #e5e5e5',
        'raised': '0 2px 8px color-mix(in oklab, #111111, transparent 92%)',
        'focus': '0 0 0 3px color-mix(in oklab, #2f6feb, transparent 70%)',
      },
      transitionDuration: {
        'fast': '150ms',
        'base': '200ms',
      },
      transitionTimingFunction: {
        'standard': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      maxWidth: {
        'container': '1200px',
      },
      lineHeight: {
        'body': '1.5',
        'tight': '1.2',
      },
      letterSpacing: {
        'display': '-0.01em',
        'caps': '0.06em',
      },
    },
  },
  plugins: [],
}
