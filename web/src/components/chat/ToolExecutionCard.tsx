import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Terminal, FileText, Globe, Search, Code, Download } from 'lucide-react'

interface ToolResult {
  tool_name: string
  tool_id: string
  command?: string
  stdout?: string
  stderr?: string
  status: string
  filename?: string
  query?: string
  results?: Array<{ title: string; url: string; snippet: string }>
  url?: string
  page_content?: string
  code?: string
  language?: string
}

export default function ToolExecutionCard({
  tool,
  chatId,
  defaultExpanded = false,
}: {
  tool: ToolResult
  chatId?: string
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isSuccess = tool.status === 'success' || tool.status === 'created' || tool.status === 'modified'
  const isError = tool.status === 'error'
  const isTerminal = tool.tool_name === 'execute_terminal_command'
  const isFile = tool.tool_name === 'create_file' || tool.tool_name === 'read_file' || tool.tool_name === 'modify_file'
  const isSearch = tool.tool_name === 'search_web'
  const isPython = tool.tool_name === 'execute_python'
  const isWebpage = tool.tool_name === 'fetch_webpage'

  const toolLabel = isTerminal ? tool.command
    : isFile ? tool.filename
    : isSearch ? tool.query
    : isPython ? 'Python Script'
    : isWebpage ? tool.url
    : tool.tool_name

  const ToolIcon = isTerminal ? Terminal
    : isFile ? FileText
    : isSearch ? Search
    : isPython ? Code
    : Globe

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 overflow-hidden border border-border-subtle bg-layer"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`flex h-5 w-5 shrink-0 items-center justify-center ${isError ? 'bg-support-error/10' : 'bg-support-success/10'}`}>
            {isError ? (
              <XCircle className="h-3 w-3 text-support-error" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-support-success" aria-hidden="true" />
            )}
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <ToolIcon className="h-3 w-3 text-text-helper shrink-0" aria-hidden="true" />
            <span className="truncate font-mono text-[11px] text-text-secondary">{toolLabel}</span>
          </div>
        </div>
        <span className="ml-2 shrink-0 text-[10px] font-semibold uppercase text-text-helper">
          {tool.tool_name.replace(/_/g, ' ')}
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-subtle">
              {isTerminal && (
                <>
                  {tool.stdout && (
                    <div className="px-3 py-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Output</p>
                      <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-text-secondary">
                        {tool.stdout}
                      </pre>
                    </div>
                  )}
                  {tool.stderr && (
                    <div className="px-3 py-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Stderr</p>
                      <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-support-error">
                        {tool.stderr}
                      </pre>
                    </div>
                  )}
                </>
              )}

              {isFile && (
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-helper">
                      {tool.tool_name === 'read_file' ? 'Content' : 'Status'}
                    </p>
                    {chatId && tool.filename && (tool.tool_name === 'create_file' || tool.tool_name === 'modify_file') && (
                      <a
                        href={`/api/chats/${chatId}/workspace/${tool.filename.split('/').pop()}`}
                        download={tool.filename.split('/').pop()}
                        className="flex items-center gap-1 rounded bg-interactive/10 px-2 py-0.5 text-[10px] font-medium text-interactive hover:bg-interactive hover:text-on-interactive transition-colors"
                      >
                        <Download className="h-3 w-3" />
                        Download File
                      </a>
                    )}
                  </div>
                  {tool.stdout && (
                    <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-text-secondary">
                      {tool.stdout}
                    </pre>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-semibold uppercase ${isSuccess ? 'text-support-success' : 'text-support-error'}`}>
                      {tool.status}
                    </span>
                  </div>
                </div>
              )}

              {isSearch && tool.results && tool.results.length > 0 && (
                <div className="px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Results</p>
                  <div className="space-y-1.5">
                    {tool.results.map((r, i) => (
                      <a
                        key={i}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-background p-2 transition-colors hover:bg-layer-hover"
                      >
                        <p className="text-[11px] font-medium text-link-primary">{r.title}</p>
                        {r.snippet && (
                          <p className="mt-0.5 text-[10px] text-text-helper line-clamp-2">{r.snippet}</p>
                        )}
                        <p className="mt-0.5 font-mono text-[10px] text-text-placeholder">{r.url}</p>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {isPython && (
                <>
                  {tool.code && (
                    <div className="px-3 py-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Script</p>
                      <pre className="max-h-48 overflow-auto bg-background p-2 font-mono text-[11px] text-text-secondary">
                        {tool.code}
                      </pre>
                    </div>
                  )}
                  {tool.stdout && (
                    <div className="px-3 py-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Output</p>
                      <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-text-secondary">
                        {tool.stdout}
                      </pre>
                    </div>
                  )}
                  {tool.stderr && (
                    <div className="px-3 py-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Stderr</p>
                      <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-support-error">
                        {tool.stderr}
                      </pre>
                    </div>
                  )}
                </>
              )}

              {isWebpage && tool.page_content && (
                <div className="px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-helper">Content</p>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap bg-background p-2 font-sans text-[11px] text-text-secondary">
                    {tool.page_content.length > 500 ? tool.page_content.substring(0, 500) + '...' : tool.page_content}
                  </pre>
                </div>
              )}

              {!isTerminal && !isFile && !isSearch && !isPython && !isWebpage && (
                <div className="px-3 py-2">
                  <pre className="max-h-96 overflow-auto bg-background p-2 font-mono text-[11px] text-text-secondary">
                    {JSON.stringify(tool, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
