import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, X, FileText, Image, FileCode, FileSpreadsheet, File as FileIcon } from 'lucide-react'

export interface UploadedFile {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  extracted?: boolean
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return Image
  if (mimeType.includes('pdf')) return FileText
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv') || mimeType.includes('excel')) return FileSpreadsheet
  if (mimeType.includes('code') || mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('text')) return FileCode
  return FileIcon
}

interface FileUploadProps {
  chatId: string
  files: UploadedFile[]
  onFilesChange: (files: UploadedFile[]) => void
}

export default function FileUpload({ chatId, files, onFilesChange }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  const handleFiles = useCallback(async (fileList: FileList) => {
    if (!fileList.length) return
    setUploading(true)

    const formData = new FormData()
    for (const file of fileList) {
      formData.append('file', file)
    }

    try {
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
      const res = await fetch(`/api/chats/${chatId}/files`, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        body: formData,
        credentials: 'include',
      })

      if (!res.ok) throw new Error('Upload failed')

      const data = await res.json()
      if (data.files) {
        onFilesChange([...files, ...data.files])
      }
    } catch (err) {
      console.error('Upload error:', err)
    } finally {
      setUploading(false)
    }
  }, [chatId, files, onFilesChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files)
    }
  }, [handleFiles])

  const removeFile = useCallback(async (fileId: string) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        onFilesChange(files.filter(f => f.id !== fileId))
      }
    } catch (err) {
      console.error('Delete error:', err)
    }
  }, [chatId, files, onFilesChange])

  return (
    <div className="relative">
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#0f62fe] bg-[#0f62fe]/10 backdrop-blur-sm"
          >
            <div className="text-center">
              <Paperclip className="mx-auto mb-2 h-8 w-8 text-[#0f62fe]" />
              <p className="text-sm font-medium text-white">Drop files here</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File list */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mb-2 flex flex-wrap gap-2 overflow-hidden"
          >
            {files.map((file) => {
              const Icon = getFileIcon(file.mime_type)
              return (
                <motion.div
                  key={file.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5"
                >
                  <Icon className="h-3.5 w-3.5 text-[#525252]" />
                  <span className="max-w-[120px] truncate text-[11px] text-[#c6c6c6]">{file.filename}</span>
                  <span className="text-[10px] text-[#525252]">{formatSize(file.size_bytes)}</span>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="ml-1 rounded p-0.5 text-[#525252] transition-colors hover:bg-[#2a2a2a] hover:text-[#da1e28]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload button */}
      <div className="flex items-center gap-1">
        <label className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[#525252] transition-all hover:bg-[#2a2a2a] hover:text-white ${uploading ? 'animate-pulse' : ''}`}>
          <Paperclip className="h-4 w-4" />
          <input
            type="file"
            multiple
            className="hidden"
            onChange={handleInputChange}
            disabled={uploading}
          />
        </label>
      </div>
    </div>
  )
}
