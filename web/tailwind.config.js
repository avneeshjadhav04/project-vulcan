/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#161616',
        surface: '#262626',
        'surface-hover': '#353535',
        border: '#393939',
        'text-primary': '#f4f4f4',
        'text-secondary': '#c6c6c6',
        accent: '#0f62fe',
        'accent-hover': '#0353e9',
        success: '#24a148',
        error: '#da1e28',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
