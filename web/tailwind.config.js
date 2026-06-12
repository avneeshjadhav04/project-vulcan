/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        layer: 'var(--color-layer)',
        'layer-hover': 'var(--color-layer-hover)',
        'layer-active': 'var(--color-layer-active)',
        'layer-selected': 'var(--color-layer-selected)',
        'border-subtle': 'var(--color-border-subtle)',
        'border-strong': 'var(--color-border-strong)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-placeholder': 'var(--color-text-placeholder)',
        'text-helper': 'var(--color-text-helper)',
        'text-disabled': 'var(--color-text-disabled)',
        'icon-primary': 'var(--color-icon-primary)',
        'icon-secondary': 'var(--color-icon-secondary)',
        'icon-disabled': 'var(--color-icon-disabled)',
        interactive: 'var(--color-interactive)',
        'interactive-hover': 'var(--color-interactive-hover)',
        'link-primary': 'var(--color-link-primary)',
        'link-hover': 'var(--color-link-hover)',
        'support-error': 'var(--color-support-error)',
        'support-success': 'var(--color-support-success)',
        'support-warning': 'var(--color-support-warning)',
        'support-info': 'var(--color-support-info)',
        focus: 'var(--color-focus)',
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
        'glass-gradient': 'var(--glass-gradient)',
        'vibrant-gradient': 'var(--vibrant-gradient)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
