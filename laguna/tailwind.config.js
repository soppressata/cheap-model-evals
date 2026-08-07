/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        // Warm neon amber + cool cyan accent palette (glassmorphism).
        amber: {
          300: '#fbc94b',
          400: '#fb9233',
          500: '#f59e0b',
          glow: '#ff7d00',
        },
        cyan: {
          300: '#38bdf8',
          400: '#38b2f5',
          500: '#06b6d4',
          glow: '#00f0ff',
        },
        paper: {
          50: '#faf7f4',
          100: '#f2efe9',
          200: '#e6e0d3',
        },
      },
      fontFamily: {
        // Crisp sans-serif for the glass UI.
        body: ['ui-sans', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        // Neon glow accents.
        neon: '0 0 8px theme(colors.amber.glow), 0 0 16px theme(colors.cyan.glow)',
        neonCyan: '0 0 8px theme(colors.cyan.glow), 0 0 16px theme(colors.cyan.glow)',
      },
    },
  },
  plugins: [],
};
