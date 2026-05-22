/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Modern Dark Palette with vibrant accents
        background: '#09090b',
        layer: '#18181b',
        'layer-hover': '#27272a',
        'layer-active': '#3f3f46',
        'layer-selected': '#27272a',
        'border-subtle': '#27272a',
        'border-strong': '#3f3f46',
        'text-primary': '#fafafa',
        'text-secondary': '#a1a1aa',
        'text-placeholder': '#71717a',
        'text-helper': '#a1a1aa',
        'text-disabled': '#52525b',
        'icon-primary': '#fafafa',
        'icon-secondary': '#a1a1aa',
        'icon-disabled': '#52525b',
        interactive: '#3b82f6', // Blue
        'interactive-hover': '#2563eb',
        'link-primary': '#60a5fa',
        'link-hover': '#93c5fd',
        'support-error': '#ef4444',
        'support-success': '#22c55e',
        'support-warning': '#f97316', // Orange
        'support-info': '#3b82f6',
        focus: '#60a5fa',
      },
      fontFamily: {
        sans: ['"Inter"', 'sans-serif'],
        mono: ['"Fira Code"', 'monospace'],
      },
      borderRadius: {
        'carbon-sm': '0.375rem', // 6px
        'carbon': '0.5rem', // 8px
        'glass': '1rem', // 16px
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
        'vibrant-gradient': 'linear-gradient(135deg, #3b82f6 0%, #f97316 100%)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
