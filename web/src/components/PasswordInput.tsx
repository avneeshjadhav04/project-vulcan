import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'

export function PasswordInput({
  value,
  onChange,
  placeholder,
  label,
  required,
  minLength,
  showToggle = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label?: string
  required?: boolean
  minLength?: number
  showToggle?: boolean
}) {
  const [show, setShow] = useState(false)

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="text-xs font-normal text-text-helper">{label}</label>
      )}
      <div className="relative flex items-center border border-border-subtle bg-layer transition-colors focus-within:border-focus focus-within:ring-1 focus-within:ring-focus">
        <Lock className="absolute left-3 h-4 w-4 text-text-disabled" />
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent py-3 pl-10 pr-10 text-sm text-text-primary outline-none placeholder:text-text-placeholder"
          placeholder={placeholder || '••••••••'}
          required={required}
          minLength={minLength}
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 p-1 text-text-disabled transition-colors hover:text-text-primary"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  )
}
