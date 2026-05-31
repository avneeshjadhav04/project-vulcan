import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Folder, File, ChevronRight, ChevronDown, X, ArrowLeft, Download, Code, Globe, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'

interface WorkspaceFile {
  name: string
  path: string
  is_dir: boolean
  children?: WorkspaceFile[]
}

function FileTreeNode({ node, depth = 0, onSelect }: { node: WorkspaceFile, depth?: number, onSelect: (path: string, isDir: boolean) => void }) {
  const [expanded, setExpanded] = useState(false)
  
  const handleClick = () => {
    if (node.is_dir) {
      setExpanded(!expanded)
    }
    onSelect(node.path, node.is_dir)
  }

  return (
    <div>
      <div 
        className="flex items-center gap-1.5 px-2 py-1 hover:bg-interactive/10 cursor-pointer rounded text-xs text-text-secondary hover:text-text-primary transition-colors"
        style={{ paddingLeft: `${(depth * 12) + 8}px` }}
        onClick={handleClick}
      >
        {node.is_dir ? (
          <span className="flex items-center gap-1">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Folder className="w-3.5 h-3.5 text-interactive" />
          </span>
        ) : (
          <span className="flex items-center gap-1 ml-4">
            <File className="w-3.5 h-3.5" />
          </span>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      
      {node.is_dir && expanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function WorkspacePanel({ onClose, isMobile }: { onClose: () => void; isMobile?: boolean }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')

  const [autoRefresh] = useState(true)
  const { data: fileTree, isLoading, refetch: refetchWorkspace } = useQuery({
    queryKey: ['workspace'],
    queryFn: async () => {
      const res = await api.get(`/workspace`)
      return res.data.files as WorkspaceFile[]
    },
    refetchInterval: autoRefresh ? 10000 : false, // Poll every 10 seconds when enabled
    staleTime: 5000,
  })

  const { data: fileContent, isLoading: isContentLoading } = useQuery({
    queryKey: ['workspace_file', selectedFile],
    queryFn: async () => {
      if (!selectedFile) return null
      const res = await api.get(`/workspace/${selectedFile}?inline=true`)
      return res.data as string
    },
    enabled: !!selectedFile && viewMode === 'code',
  })

  const isHtml = selectedFile?.endsWith('.html') || selectedFile?.endsWith('.htm')

  return (
    <motion.div 
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: isMobile ? '100%' : 400, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className={`h-full border-l border-border-subtle bg-layer flex flex-col overflow-hidden shrink-0 ${isMobile ? 'absolute right-0 top-0 z-40' : ''}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-background">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          {selectedFile ? (
            <button onClick={() => setSelectedFile(null)} className="hover:bg-interactive/10 p-1 rounded transition-colors text-text-secondary hover:text-text-primary">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <Folder className="w-4 h-4 text-interactive" />
          )}
          {selectedFile ? selectedFile.split('/').pop() : 'Workspace Files'}
        </h3>
        <div className="flex items-center gap-1">
          {!selectedFile && (
            <button
              onClick={() => refetchWorkspace()}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors"
              title="Refresh workspace"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          {selectedFile && (
            <a
              href={`/api/workspace/${selectedFile}`}
              download={selectedFile.split('/').pop()}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors"
              title="Download File"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!selectedFile ? (
          <div className="p-2">
            {isLoading ? (
              <div className="p-4 text-xs text-text-secondary animate-pulse">Loading workspace...</div>
            ) : fileTree?.length === 0 ? (
              <div className="p-4 text-xs text-text-secondary text-center mt-10">
                Workspace is empty.
                <br />Ask the AI to generate some files!
              </div>
            ) : (
              fileTree?.map(node => (
                <FileTreeNode 
                  key={node.path} 
                  node={node} 
                  onSelect={(path, isDir) => {
                    if (!isDir) {
                      setSelectedFile(path)
                      setViewMode(path.endsWith('.html') ? 'preview' : 'code')
                    }
                  }} 
                />
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {isHtml && (
              <div className="flex items-center gap-2 px-3 py-2 bg-background border-b border-border-subtle">
                <button 
                  onClick={() => setViewMode('preview')}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1.5 ${viewMode === 'preview' ? 'bg-interactive text-white' : 'text-text-secondary hover:bg-interactive/10'}`}
                >
                  <Globe className="w-3.5 h-3.5" /> Preview
                </button>
                <button 
                  onClick={() => setViewMode('code')}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1.5 ${viewMode === 'code' ? 'bg-interactive text-white' : 'text-text-secondary hover:bg-interactive/10'}`}
                >
                  <Code className="w-3.5 h-3.5" /> Code
                </button>
              </div>
            )}
            
            <div className="flex-1 overflow-auto bg-background">
              {viewMode === 'preview' ? (
                <iframe 
                  src={`/api/workspace/${selectedFile}`}
                  className="w-full h-full border-none bg-white"
                  title="Live Preview"
                  sandbox="allow-scripts allow-forms allow-same-origin"
                />
              ) : (
                <div className="p-4 h-full">
                  {isContentLoading ? (
                    <div className="animate-pulse h-full bg-surface-elevated/50 rounded" />
                  ) : (
                    <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all">
                      {fileContent}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
