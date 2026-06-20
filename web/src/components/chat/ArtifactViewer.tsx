import { useArtifactStore } from '../../stores/artifactStore'
import { useThemeStore } from '../../stores/themeStore'
import { PanelRightClose, Code } from 'lucide-react'
import { motion } from 'framer-motion'
import { useState, useEffect, useMemo } from 'react'

export default function ArtifactViewer() {
  const { activeArtifact, isOpen, closeArtifact } = useArtifactStore()
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
  const isLight = resolvedTheme === 'light'

  // Prevent scroll on body when artifact is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'auto'
    }
    return () => {
      document.body.style.overflow = 'auto'
    }
  }, [isOpen])

  if (!isOpen || !activeArtifact) return null

  const isHtml = activeArtifact.type === 'html' || activeArtifact.type === 'xml' || activeArtifact.type === 'svg'

  // Safe HTML rendering for the iframe - follow app theme when no preview available
  const htmlContent = useMemo(() => {
    if (isHtml) return activeArtifact.content
    const fg = isLight ? '#1f2937' : '#f4f4f4'
    const bg = isLight ? '#f8f9fb' : '#0f1115'
    return `<html><body style="font-family: sans-serif; color: ${fg}; background: ${bg}; padding: 20px;">
        <h2>Preview not supported for ${activeArtifact.type} yet.</h2>
        <p>Switch to Code view to see the raw artifact content.</p>
       </body></html>`
  }, [isHtml, activeArtifact.content, activeArtifact.type, isLight])

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 500, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className="flex h-full shrink-0 flex-col border-l border-border-subtle bg-layer/30 backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-border-subtle bg-layer px-4 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <Code className="h-4 w-4 shrink-0 text-interactive" />
          <span className="truncate text-sm font-semibold text-text-primary">
            {activeArtifact.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-2 flex rounded-md border border-border-subtle bg-background p-0.5">
            <button
              onClick={() => setViewMode('preview')}
              className={`rounded-sm px-2 py-1 text-[11px] font-medium transition-colors ${
                viewMode === 'preview' ? 'bg-layer text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setViewMode('code')}
              className={`rounded-sm px-2 py-1 text-[11px] font-medium transition-colors ${
                viewMode === 'code' ? 'bg-layer text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Code
            </button>
          </div>
          <button
            onClick={closeArtifact}
            className="p-1.5 text-text-disabled transition-colors hover:text-text-primary"
            aria-label="Close artifact"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-background">
        {viewMode === 'preview' ? (
          <iframe
            title={activeArtifact.title}
            srcDoc={htmlContent}
            sandbox="allow-scripts"
            className="h-full w-full border-none bg-background"
          />
        ) : (
          <div className="h-full overflow-auto bg-background p-4">
            <pre className="font-mono text-xs text-text-secondary">
              {activeArtifact.content}
            </pre>
          </div>
        )}
      </div>
    </motion.div>
  )
}
