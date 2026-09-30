const c = (n) => `rgb(var(--${n}) / <alpha-value>)`
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/renderer/index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './src/renderer/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        surface: c('surface'),
        surface2: c('surface2'),
        outline: c('outline'),
        fg: c('fg'),
        muted: c('muted'),
        primary: c('primary'),
        success: c('success'),
        warning: c('warning'),
        danger: c('danger'),
        bubble: c('bubble')
      },
      borderRadius: { card: '18px' },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.06)',
        glow: '0 0 0 3px rgb(var(--primary) / 0.25)'
      }
    }
  },
  plugins: []
}
