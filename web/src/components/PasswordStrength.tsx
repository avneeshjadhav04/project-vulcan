export function PasswordStrength({ password }: { password: string }) {
  const getStrength = (pwd: string): number => {
    let score = 0
    if (pwd.length >= 6) score++
    if (pwd.length >= 10) score++
    if (/[A-Z]/.test(pwd)) score++
    if (/[0-9]/.test(pwd)) score++
    if (/[^A-Za-z0-9]/.test(pwd)) score++
    return score
  }

  const strength = getStrength(password)
  const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong']
  const colors = ['#fa4d56', '#f1c21b', '#78a9ff', '#42be65', '#42be65']

  if (!password) return null

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-0.5 flex-1 transition-all duration-200"
            style={{
              backgroundColor: i <= strength ? colors[strength - 1] : 'var(--color-layer-active)',
            }}
          />
        ))}
      </div>
      <p className="text-[10px] text-text-helper">
        Strength: <span style={{ color: colors[strength - 1] }}>{labels[strength - 1]}</span>
      </p>
    </div>
  )
}
