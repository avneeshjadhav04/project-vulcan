import { useState, useCallback } from 'react'
import axios from 'axios'
import { useErrorToast } from './ui/ErrorToast'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, X, FileText, Image, FileCode, FileSpreadsheet, File as FileIcon } from 'lucide-react'

export interface UploadedFile {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  extracted?: boolean
  extracted_text?: string
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
  getChatId: () => Promise<string>
  chatId?: string
  files: UploadedFile[]
  onFilesChange: (files: UploadedFile[]) => void
}

export default function FileUpload({ getChatId, chatId, files, onFilesChange }: FileUploadProps) {
  const showError = useErrorToast();
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const handleFiles = useCallback(async (fileList: FileList) => {
    if (!fileList.length) return
    setUploading(true)
    setUploadProgress(0)

    const formData = new FormData()
    for (const file of fileList) {
      if (file.size > 50 * 1024 * 1024) {
        showError(`File ${file.name} is too large. Max size is 50MB.`)
        continue
      }
      formData.append('file', file)
    }

    if (!Array.from(formData.keys()).length) {
      setUploading(false)
      return
    }

    try {
      const activeChatId = await getChatId()
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
      const res = await axios.post(`/api/chats/${activeChatId}/files`, formData, {
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        withCredentials: true,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            setUploadProgress(percentCompleted)
          }
        }
      })

      if (res.data.files) {
        onFilesChange([...files, ...res.data.files])
      }
    } catch (err: any) {
      showError(err?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }, [getChatId, files, onFilesChange])

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
      const activeChatId = await getChatId()
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
      const res = await fetch(`/api/chats/${activeChatId}/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
      })
      if (res.ok) {
        onFilesChange(files.filter(f => f.id !== fileId))
      }
    } catch (err: any) {
      showError(err?.message ?? 'Delete failed')
    }
  }, [getChatId, files, onFilesChange])

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
            className="absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-interactive bg-interactive/10"
          >
            <div className="text-center">
              <Paperclip className="mx-auto mb-2 h-6 w-6 text-interactive" />
              <p className="text-xs font-medium text-text-primary">Drop files here</p>
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
            className="mb-2 flex flex-wrap gap-1.5 overflow-hidden"
          >
            {files.map((file) => {
              const Icon = getFileIcon(file.mime_type)
              const isImage = file.mime_type.startsWith('image/')
              
              return (
                <motion.div
                  key={file.id}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="group relative flex items-center gap-1.5 overflow-hidden rounded-md border border-border-subtle bg-layer pr-1 shadow-sm"
                >
                  {isImage && chatId ? (
                    <div className="h-10 w-10 shrink-0 overflow-hidden bg-black/20">
                      <img 
                        src={`/api/chats/${chatId}/files/${file.id}`} 
                        alt={file.filename}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-black/10">
                      <Icon className="h-4 w-4 text-text-helper" />
                    </div>
                  )}
                  
                  <div className="flex flex-col py-1 pl-1 pr-2">
                    <span className="max-w-[120px] truncate text-[11px] font-medium text-text-secondary">{file.filename}</span>
                    <span className="text-[9px] text-text-helper">{formatSize(file.size_bytes)}</span>
                  </div>
                  
                  <button
                    onClick={() => removeFile(file.id)}
                    className="absolute right-1 top-1 hidden rounded bg-black/40 p-0.5 text-white backdrop-blur-sm transition-colors hover:bg-support-error group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload button & Progress */}
      <div className="relative flex items-center gap-1">
        <label className={`flex h-7 w-7 cursor-pointer items-center justify-center text-text-helper transition-colors hover:bg-layer-hover hover:text-text-primary ${uploading ? 'animate-pulse' : ''}`}>
          <Paperclip className="h-3.5 w-3.5" />
          <input
            type="file"
            multiple
            className="hidden"
            onChange={handleInputChange}
            disabled={uploading}
          />
        </label>
        <AnimatePresence>
          {uploading && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 w-48 rounded-md border border-white/10 bg-layer/90 p-2.5 shadow-lg backdrop-blur-md"
            >
              <div className="mb-1.5 flex justify-between text-[10px] font-medium text-text-primary">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 shadow-inner">
                <div
                  className="h-full bg-vibrant-gradient transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
