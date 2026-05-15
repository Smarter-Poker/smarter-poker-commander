/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@smarter-poker/commander-shared/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Commander brand palette
        'cmd-bg': '#18191A',
        'cmd-surface': '#242526',
        'cmd-border': '#3A3B3C',
        'cmd-text': '#E4E6EB',
        'cmd-muted': '#B0B3B8',
        'cmd-subtle': '#8A8D91',
        'cmd-accent': '#1877F2',
        'cmd-danger': '#F02849',
        'cmd-success': '#42B72A',
        'cmd-gold': '#F5A623',
        'cmd-cyan': '#22D3EE',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
