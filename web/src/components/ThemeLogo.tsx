import { useThemeStore } from '../stores/themeStore'

interface ThemeLogoProps {
  className?: string
  alt?: string
}

export default function ThemeLogo({ className = 'h-10 w-10', alt = 'Project Vulcan' }: ThemeLogoProps) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
  return (
    <img
      src={resolvedTheme === 'light' ? '/VulcanLogoInverted.png' : '/VulcanLogo.png'}
      alt={alt}
      className={className}
    />
  )
}
