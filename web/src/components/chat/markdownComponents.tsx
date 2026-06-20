import CodeBlock from './CodeBlock'

import { Code, ExternalLink } from 'lucide-react'
import { useArtifactStore } from '../../stores/artifactStore'

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all rounded-sm bg-layer px-1 py-0.5 font-mono text-sm text-text-secondary">
      {children}
    </code>
  )
}

export function ArtifactCard({ title, type, content }: { title: string, type: string, content: string }) {
  const { setActiveArtifact } = useArtifactStore()
  
  return (
    <div className="my-3 overflow-hidden rounded-md border border-border-subtle bg-layer/50">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-interactive" />
          <div>
            <div className="text-sm font-medium text-text-primary">{title}</div>
            <div className="text-[10px] text-text-helper uppercase tracking-wider">{type}</div>
          </div>
        </div>
        <button
          onClick={() => setActiveArtifact({ id: Math.random().toString(), title, type, content })}
          className="flex items-center gap-1 rounded bg-interactive px-3 py-1.5 text-xs font-medium text-on-interactive transition-colors hover:bg-interactive-hover shadow-sm"
        >
          <ExternalLink className="h-3 w-3" />
          View Artifact
        </button>
      </div>
      <div className="bg-layer px-4 py-2 text-xs text-text-secondary">
        Artifact generated. Click view to open in the side panel.
      </div>
    </div>
  )
}

// Extract artifacts from raw markdown string before rendering
export function extractArtifacts(content: string): Array<{title: string, type: string, content: string}> {
  const artifacts: Array<{title: string, type: string, content: string}> = []
  const pattern = /```(\w+)\s+artifact="([^"]+)"\n([\s\S]*?)```/g
  let match
  while ((match = pattern.exec(content)) !== null) {
    artifacts.push({
      type: match[1],
      title: match[2],
      content: match[3].trimEnd()
    })
  }
  return artifacts
}

// Strip artifact blocks from markdown so they don't render as code blocks too
export function stripArtifacts(content: string): string {
  return content.replace(/```(\w+)\s+artifact="([^"]+)"\n([\s\S]*?)```/g, '')
}

export const markdownComponents = {
  code({ children, className }: any) {
    const isInline = !className
    if (isInline) {
      return <InlineCode>{children}</InlineCode>
    }
    return <CodeBlock className={className}>{String(children)}</CodeBlock>
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="mb-2 list-disc pl-5 space-y-0.5">{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="mb-2 list-decimal pl-5 space-y-0.5">{children}</ol>
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="leading-relaxed">{children}</li>
  },
  h1({ children }: { children?: React.ReactNode }) {
    return <h1 className="mb-2 text-base font-semibold text-text-primary">{children}</h1>
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2 className="mb-2 text-sm font-semibold text-text-primary">{children}</h2>
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3 className="mb-1 text-xs font-semibold text-text-primary">{children}</h3>
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote className="mb-2 border-l-2 border-interactive pl-3 italic text-text-secondary">
        {children}
      </blockquote>
    )
  },
  a({ children, href }: { children?: React.ReactNode; href?: string }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link-primary underline underline-offset-2 transition-colors hover:text-link-hover"
      >
        {children}
      </a>
    )
  },
  img({ src, alt }: { src?: string; alt?: string }) {
    return (
      <img
        src={src}
        alt={alt || ''}
        loading="lazy"
        className="my-2 max-w-full rounded-sm border border-border-subtle"
      />
    )
  },
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className="mb-2 overflow-x-auto border border-border-subtle">
        <table className="w-full text-sm">{children}</table>
      </div>
    )
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead className="bg-layer">{children}</thead>
  },
  th({ children }: { children?: React.ReactNode }) {
    return <th className="border-b border-border-subtle px-3 py-2 text-left text-[11px] font-semibold text-text-secondary">{children}</th>
  },
  td({ children }: { children?: React.ReactNode }) {
    return <td className="border-b border-border-subtle px-3 py-2 text-text-secondary">{children}</td>
  },
  hr() {
    return <hr className="my-3 border-border-subtle" />
  },
}
