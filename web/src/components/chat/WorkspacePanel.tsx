import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  Folder,
  File,
  ChevronRight,
  X,
  ArrowLeft,
  Download,
  Code,
  Globe,
  RefreshCw,
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Save,
  Check,
  Upload,
  Loader2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface WorkspaceFile {
  name: string
  path: string
  is_dir: boolean
  children?: WorkspaceFile[]
}

function getDirectoryContents(tree: WorkspaceFile[], path: string): WorkspaceFile[] {
  if (!path) return tree
  const parts = path.split('/').filter(Boolean)
  let current = tree
  for (const part of parts) {
    const node = current.find((n) => n.name === part && n.is_dir)
    if (!node || !node.children) return []
    current = node.children
  }
  return current
}

export default function WorkspacePanel({
  onClose,
  isMobile,
  width,
}: {
  onClose: () => void
  isMobile?: boolean
  width?: number
}) {
  const [currentPath, setCurrentPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [isCreating, setIsCreating] = useState<'folder' | 'file' | null>(null)
  const [createName, setCreateName] = useState('')
  const [renamingItem, setRenamingItem] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  // Upload state
  const [isUploading, setIsUploading] = useState(false)
  const [isReadingFolder, setIsReadingFolder] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [overwriteConflicts, setOverwriteConflicts] = useState<string[] | null>(null)
  const [pendingFiles, setPendingFiles] = useState<{ file: File; relativePath: string }[] | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // ─── File System Entry Helpers ───

  interface FileWithPath {
    file: File
    relativePath: string
  }

  const readFileEntry = (entry: FileSystemFileEntry, relativePath: string): Promise<FileWithPath> => {
    return new Promise((resolve, reject) => {
      entry.file((file) => resolve({ file, relativePath }), reject)
    })
  }

  const readDirectoryEntry = async (
    entry: FileSystemDirectoryEntry,
    basePath: string = ''
  ): Promise<FileWithPath[]> => {
    const files: FileWithPath[] = []
    const reader = entry.createReader()

    const readEntries = (): Promise<FileSystemEntry[]> => {
      return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject)
      })
    }

    let entries: FileSystemEntry[]
    do {
      entries = await readEntries()
      for (const child of entries) {
        if (child.name.startsWith('.')) continue // Skip hidden files
        const childPath = basePath ? `${basePath}/${child.name}` : child.name
        if (child.isDirectory) {
          const childFiles = await readDirectoryEntry(child as FileSystemDirectoryEntry, childPath)
          files.push(...childFiles)
        } else {
          const fileWithPath = await readFileEntry(child as FileSystemFileEntry, childPath)
          files.push(fileWithPath)
        }
      }
    } while (entries.length > 0)

    return files
  }

  const queryClient = useQueryClient()
  const [autoRefresh] = useState(true)

  const {
    data: fileTree,
    isLoading,
    refetch: refetchWorkspace,
  } = useQuery({
    queryKey: ['workspace'],
    queryFn: async () => {
      const res = await api.get(`/workspace`)
      return res.data.files as WorkspaceFile[]
    },
    refetchInterval: autoRefresh ? 10000 : false,
    staleTime: 5000,
  })

  const { data: fileContent, isLoading: isContentLoading } = useQuery({
    queryKey: ['workspace_file', selectedFile],
    queryFn: async () => {
      if (!selectedFile) return null
      const res = await api.get(`/workspace/${selectedFile}?inline=true`)
      return res.data as string
    },
    enabled: !!selectedFile && viewMode === 'code' && !isEditing,
  })

  const currentItems = fileTree ? getDirectoryContents(fileTree, currentPath) : []

  const isHtml = selectedFile?.endsWith('.html') || selectedFile?.endsWith('.htm')

  useEffect(() => {
    if (isEditing && fileContent !== null && fileContent !== undefined) {
      setEditContent(fileContent)
    }
  }, [isEditing, fileContent])

  const handleCreate = async () => {
    if (!createName.trim()) return
    const fullPath = currentPath ? `${currentPath}/${createName.trim()}` : createName.trim()
    try {
      if (isCreating === 'folder') {
        await api.post('/workspace/folder', { path: fullPath })
      } else {
        await api.post('/workspace/file', { path: fullPath })
      }
      setCreateName('')
      setIsCreating(null)
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    } catch (e) {
      console.error('Failed to create:', e)
    }
  }

  const handleSave = async () => {
    if (!selectedFile) return
    try {
      await api.put(`/workspace/${selectedFile}`, { content: editContent })
      setIsEditing(false)
      queryClient.invalidateQueries({ queryKey: ['workspace_file', selectedFile] })
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    } catch (e) {
      console.error('Failed to save:', e)
    }
  }

  const handleRename = async (oldPath: string) => {
    if (!renameName.trim()) return
    const lastSlash = oldPath.lastIndexOf('/')
    const parent = lastSlash > 0 ? oldPath.slice(0, lastSlash) : ''
    const newPath = parent ? `${parent}/${renameName.trim()}` : renameName.trim()
    try {
      await api.patch(`/workspace/${oldPath}`, { new_path: newPath })
      setRenamingItem(null)
      setRenameName('')
      if (currentPath === oldPath) {
        setCurrentPath(newPath)
      }
      if (selectedFile === oldPath) {
        setSelectedFile(newPath)
      }
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    } catch (e) {
      console.error('Failed to rename:', e)
    }
  }

  const handleDelete = async (path: string) => {
    try {
      await api.delete(`/workspace/${path}`)
      setDeleteConfirming(null)
      if (selectedFile === path) {
        setSelectedFile(null)
      }
      if (currentPath === path || currentPath.startsWith(`${path}/`)) {
        const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        setCurrentPath(parentPath)
      }
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    } catch (e) {
      console.error('Failed to delete:', e)
    }
  }

  // ─── Upload Logic ───

  const handleUpload = useCallback(async (files: FileWithPath[], overwrite = false) => {
    if (!files || files.length === 0) return
    setIsUploading(true)

    const formData = new FormData()
    for (const { file, relativePath } of files) {
      formData.append('file', file, relativePath)
    }

    try {
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
      const res = await fetch(
        `/api/workspace/upload?path=${encodeURIComponent(currentPath)}&overwrite=${overwrite}`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
          credentials: 'include',
          body: formData,
        }
      )

      if (res.status === 409) {
        const data = await res.json()
        setOverwriteConflicts(data.conflicts || [])
        setPendingFiles(files)
        setIsUploading(false)
        return
      }

      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`)
      }

      queryClient.invalidateQueries({ queryKey: ['workspace'] })
    } catch (e: any) {
      console.error('Upload failed:', e)
      alert(e.message || 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }, [currentPath, queryClient])

  const confirmOverwrite = useCallback(() => {
    if (pendingFiles) {
      handleUpload(pendingFiles, true)
      setOverwriteConflicts(null)
      setPendingFiles(null)
    }
  }, [pendingFiles, handleUpload])

  const cancelOverwrite = useCallback(() => {
    setOverwriteConflicts(null)
    setPendingFiles(null)
  }, [])

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files: FileWithPath[] = Array.from(e.target.files).map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }))
      handleUpload(files)
    }
    e.target.value = '' // Reset input
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const items = e.dataTransfer.items
    if (!items || items.length === 0) return

    setIsReadingFolder(true)
    const allFiles: FileWithPath[] = []

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const entry = item.webkitGetAsEntry?.()
        if (!entry) {
          // Fallback to regular file if entry API not available
          const file = item.getAsFile()
          if (file) allFiles.push({ file, relativePath: file.name })
          continue
        }

        if (entry.isDirectory) {
          // Pass entry.name as basePath so the folder itself is included
          const files = await readDirectoryEntry(entry as FileSystemDirectoryEntry, entry.name)
          allFiles.push(...files)
        } else if (entry.isFile) {
          const fileWithPath = await readFileEntry(entry as FileSystemFileEntry, entry.name)
          allFiles.push(fileWithPath)
        }
      }

      if (allFiles.length > 0) {
        handleUpload(allFiles)
      }
    } catch (err) {
      console.error('Failed to read dropped items:', err)
      alert('Failed to read dropped folder. Try using the upload button instead.')
    } finally {
      setIsReadingFolder(false)
    }
  }

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: isMobile ? '100%' : width || 400, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className={`h-full border-l border-border-subtle bg-layer flex flex-col overflow-hidden shrink-0 ${
        isMobile ? 'absolute right-0 top-0 z-40' : ''
      }`}
      style={{ width: isMobile ? '100%' : width || 400 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-background">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          {selectedFile ? (
            <button
              onClick={() => {
                setSelectedFile(null)
                setIsEditing(false)
              }}
              className="hover:bg-interactive/10 p-1 rounded transition-colors text-text-secondary hover:text-text-primary"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <Folder className="w-4 h-4 text-interactive" />
          )}
          {selectedFile ? selectedFile.split('/').pop() : 'Workspace Files'}
        </h3>
        <div className="flex items-center gap-1">
          {!selectedFile && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors disabled:opacity-50"
                title="Upload Files"
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                disabled={isUploading}
                className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors disabled:opacity-50"
                title="Upload Folder"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsCreating('folder')
                  setCreateName('')
                }}
                className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors"
                title="New Folder"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsCreating('file')
                  setCreateName('')
                }}
                className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors"
                title="New File"
              >
                <FilePlus className="w-4 h-4" />
              </button>
              <button
                onClick={() => refetchWorkspace()}
                className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors"
                title="Refresh workspace"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}
          {selectedFile && !isEditing && (
            <button
              onClick={() => {
                setViewMode('code')
                setIsEditing(true)
                setEditContent(fileContent || '')
              }}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors"
              title="Edit File"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {selectedFile && isEditing && (
            <button
              onClick={handleSave}
              className="p-1.5 text-interactive hover:bg-interactive/10 rounded transition-colors"
              title="Save File"
            >
              <Save className="w-4 h-4" />
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
          <button
            onClick={onClose}
            className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        {...({ webkitdirectory: '', directory: '' } as any)}
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto relative">
        {!selectedFile ? (
          <div
            className={`p-2 h-full ${isDragOver ? 'bg-interactive/5' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Drag overlay */}
            <AnimatePresence>
              {isDragOver && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/90 border-2 border-dashed border-interactive/50 m-2 rounded-lg"
                >
                  <Upload className="w-8 h-8 text-interactive mb-2" />
                  <p className="text-sm font-medium text-text-primary">Drop files to upload</p>
                  <p className="text-xs text-text-secondary mt-1">
                    Files will be uploaded to {currentPath || 'workspace root'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Upload progress */}
            {isUploading && (
              <div className="mb-2 px-2 py-1.5 bg-interactive/10 rounded flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-interactive" />
                <span className="text-xs text-text-secondary">Uploading...</span>
              </div>
            )}

            {/* Reading folder contents */}
            {isReadingFolder && (
              <div className="mb-2 px-2 py-1.5 bg-interactive/10 rounded flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-interactive" />
                <span className="text-xs text-text-secondary">Reading folder contents...</span>
              </div>
            )}

            {/* Overwrite confirmation */}
            <AnimatePresence>
              {overwriteConflicts && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-2 border border-support-warning/30 bg-support-warning/10 rounded overflow-hidden"
                >
                  <div className="px-3 py-2">
                    <p className="text-xs font-medium text-support-warning">
                      Some files already exist
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {overwriteConflicts.map((conflict) => (
                        <li key={conflict} className="text-[11px] text-text-secondary">
                          {conflict}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={confirmOverwrite}
                        className="px-2 py-1 text-[11px] bg-support-warning text-white rounded hover:opacity-90 transition-opacity"
                      >
                        Replace All
                      </button>
                      <button
                        onClick={cancelOverwrite}
                        className="px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-elevated rounded transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Breadcrumb */}
            {currentPath && (
              <div className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary mb-1">
                <button
                  onClick={() => setCurrentPath('')}
                  className="hover:text-text-primary transition-colors"
                >
                  Workspace
                </button>
                {currentPath.split('/').map((part, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChevronRight className="w-3 h-3" />
                    <button
                      onClick={() =>
                        setCurrentPath(currentPath.split('/').slice(0, i + 1).join('/'))
                      }
                      className="hover:text-text-primary transition-colors"
                    >
                      {part}
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Create input */}
            {isCreating && (
              <div className="flex items-center gap-2 px-2 py-1 mb-1">
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') {
                      setIsCreating(null)
                      setCreateName('')
                    }
                  }}
                  placeholder={isCreating === 'folder' ? 'Folder name...' : 'File name...'}
                  className="flex-1 text-xs bg-background border border-border-subtle rounded px-2 py-1 text-text-primary focus:outline-none focus:border-interactive"
                  autoFocus
                />
                <button
                  onClick={handleCreate}
                  className="p-1 text-interactive hover:bg-interactive/10 rounded transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setIsCreating(null)
                    setCreateName('')
                  }}
                  className="p-1 text-text-secondary hover:bg-surface-elevated rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* File list */}
            {isLoading ? (
              <div className="p-4 text-xs text-text-secondary animate-pulse">
                Loading workspace...
              </div>
            ) : currentItems.length === 0 ? (
              <div className="p-4 text-xs text-text-secondary text-center mt-10">
                {currentPath ? 'Folder is empty.' : 'Workspace is empty.'}
                <br />
                Ask the AI to generate some files or create one above!
              </div>
            ) : (
              currentItems.map((node) => (
                <div
                  key={node.path}
                  className="group flex items-center gap-1.5 px-2 py-1 hover:bg-interactive/10 cursor-pointer rounded text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  {node.is_dir ? (
                    <Folder className="w-3.5 h-3.5 text-interactive shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 shrink-0" />
                  )}

                  {renamingItem === node.path ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <input
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(node.path)
                          if (e.key === 'Escape') {
                            setRenamingItem(null)
                            setRenameName('')
                          }
                        }}
                        className="flex-1 text-xs bg-background border border-border-subtle rounded px-1 py-0.5 text-text-primary focus:outline-none focus:border-interactive min-w-0"
                        autoFocus
                      />
                      <button
                        onClick={() => handleRename(node.path)}
                        className="p-0.5 text-interactive hover:bg-interactive/10 rounded transition-colors"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          setRenamingItem(null)
                          setRenameName('')
                        }}
                        className="p-0.5 text-text-secondary hover:bg-surface-elevated rounded transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      className="truncate flex-1 min-w-0"
                      onClick={() =>
                        node.is_dir ? setCurrentPath(node.path) : setSelectedFile(node.path)
                      }
                    >
                      {node.name}
                    </span>
                  )}

                  {renamingItem !== node.path && deleteConfirming !== node.path && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingItem(node.path)
                          setRenameName(node.name)
                        }}
                        className="p-1 text-text-secondary hover:text-text-primary hover:bg-interactive/10 rounded transition-colors"
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteConfirming(node.path)
                        }}
                        className="p-1 text-text-secondary hover:text-support-error hover:bg-support-error/10 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {deleteConfirming === node.path && (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-support-error">Delete?</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(node.path)
                        }}
                        className="p-0.5 text-support-error hover:bg-support-error/10 rounded transition-colors"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteConfirming(null)
                        }}
                        className="p-0.5 text-text-secondary hover:bg-surface-elevated rounded transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {isHtml && !isEditing && (
              <div className="flex items-center gap-2 px-3 py-2 bg-background border-b border-border-subtle">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1.5 ${
                    viewMode === 'preview'
                      ? 'bg-interactive text-white'
                      : 'text-text-secondary hover:bg-interactive/10'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" /> Preview
                </button>
                <button
                  onClick={() => setViewMode('code')}
                  className={`text-xs px-2 py-1 rounded flex items-center gap-1.5 ${
                    viewMode === 'code'
                      ? 'bg-interactive text-white'
                      : 'text-text-secondary hover:bg-interactive/10'
                  }`}
                >
                  <Code className="w-3.5 h-3.5" /> Code
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto bg-background">
              {isEditing ? (
                <div className="p-2 h-full flex flex-col">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="flex-1 w-full text-xs font-mono bg-background border border-border-subtle rounded p-2 text-text-primary focus:outline-none focus:border-interactive resize-none"
                    spellCheck={false}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1 text-xs text-text-secondary hover:bg-surface-elevated rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-3 py-1 text-xs bg-interactive text-white hover:opacity-90 rounded transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : viewMode === 'preview' ? (
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
