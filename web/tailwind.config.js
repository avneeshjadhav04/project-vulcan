/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Carbon Gray 100 (Dark) Palette
        background: '#161616',
        layer: '#262626',
        'layer-hover': '#353535',
        'layer-active': '#525252',
        'layer-selected': '#393939',
        'border-subtle': '#393939',
        'border-strong': '#525252',
        'text-primary': '#f4f4f4',
        'text-secondary': '#c6c6c6',
        'text-placeholder': '#6f6f6f',
        'text-helper': '#8d8d8d',
        'text-disabled': '#525252',
        'icon-primary': '#f4f4f4',
        'icon-secondary': '#c6c6c6',
        'icon-disabled': '#525252',
        interactive: '#0f62fe',
        'interactive-hover': '#0353e9',
        'link-primary': '#78a9ff',
        'link-hover': '#a6c8ff',
        'support-error': '#fa4d56',
        'support-success': '#42be65',
        'support-warning': '#f1c21b',
        'support-info': '#4589ff',
        focus: '#ffffff',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        'carbon-sm': '2px',
        'carbon': '4px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
