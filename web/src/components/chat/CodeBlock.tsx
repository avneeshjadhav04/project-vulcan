import { useState, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import { codeToHtml } from 'shiki'
import DOMPurify from 'dompurify'
import { useThemeStore } from '../../stores/themeStore'

interface CodeBlockProps {
  children: string
  className?: string
}

export default function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [highlighted, setHighlighted] = useState('')
  const language = className?.replace('language-', '') || 'text'
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
  const shikiTheme = resolvedTheme === 'light' ? 'github-light' : 'github-dark'

  useEffect(() => {
    let cancelled = false
    codeToHtml(children, {
      lang: language === 'text' ? 'plaintext' : language,
      theme: shikiTheme,
    }).then((html) => {
      if (!cancelled) setHighlighted(html)
    }).catch(() => {
      if (!cancelled) setHighlighted(`<pre><code>${escapeHtml(children)}</code></pre>`)
    })
    return () => { cancelled = true }
  }, [children, language, shikiTheme])

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="my-3 overflow-hidden border border-border-subtle bg-background">
      <div className="flex items-center justify-between border-b border-border-subtle bg-layer px-3 py-1.5">
        <span className="text-[11px] font-mono text-text-helper">{language}</span>
        <button
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-helper transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-focus"
        >
          {copied ? <Check className="h-3 w-3 text-support-success" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div
        className="overflow-x-auto p-3 text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlighted || `<pre class="font-mono text-text-secondary">${escapeHtml(children)}</pre>`) }}
      />
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
