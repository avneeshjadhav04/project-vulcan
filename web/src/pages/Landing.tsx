import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '../stores/authStore'
import {
  MessageSquare,
  Terminal,
  Shield,
  Zap,
  Sparkles,
  Lock,
  Globe,
  Cpu,
  ArrowRight,
  ChevronDown,
  MessageCircle,
  Github,
  LayoutTemplate,
  Folder,
} from 'lucide-react'

/* ─── Terminal primitives ─── */

function BlinkingCursor({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-[1.1em] w-[0.6em] translate-y-[0.05em] bg-interactive align-middle ${className}`}
      style={{ animation: 'cursor-blink 1.1s step-end infinite' }}
    />
  )
}

function StaticCursor({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-[1.1em] w-[0.6em] translate-y-[0.05em] bg-interactive align-middle ${className}`}
    />
  )
}

interface TypewriterProps {
  text: string
  speed?: number
  jitter?: number
  onDone?: () => void
  className?: string
  showCursor?: boolean
}

function Typewriter({ text, speed = 32, jitter = 12, onDone, className = '', showCursor = true }: TypewriterProps) {
  const [displayed, setDisplayed] = useState('')
  const [finished, setFinished] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    let i = 0
    let timeoutId: ReturnType<typeof setTimeout>

    const typeNext = () => {
      if (i >= text.length) {
        setFinished(true)
        onDone?.()
        return
      }
      i++
      setDisplayed(text.slice(0, i))
      const delay = speed + (Math.random() * jitter - jitter / 2)
      timeoutId = setTimeout(typeNext, Math.max(8, delay))
    }

    timeoutId = setTimeout(typeNext, 80)

    return () => clearTimeout(timeoutId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className={className}>
      {displayed}
      {showCursor && !finished && <StaticCursor />}
    </span>
  )
}

function TerminalWindow({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`overflow-hidden rounded-glass border border-border-strong bg-layer/50 backdrop-blur-md shadow-2xl ${className}`}
      style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.05), 0 25px 50px -12px rgba(0,0,0,0.5)' }}
    >
      <div className="flex items-center gap-2 border-b border-white/5 bg-layer-hover/50 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-[#ff5f56]" />
          <div className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
          <div className="h-3 w-3 rounded-full bg-[#27c93f]" />
        </div>
        <span className="ml-3 text-[11px] font-medium tracking-wide text-text-secondary uppercase">
          {title}
        </span>
      </div>
      <div className="relative">
        {/* subtle scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
          }}
        />
        {children}
      </div>
    </div>
  )
}

/* ─── Nav ─── */

function Nav() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/60 backdrop-blur-xl transition-all">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <button onClick={() => navigate('/')} className="flex items-center gap-2">
          <img src="/VulcanLogo.png" alt="" className="h-10 w-10 drop-shadow-md" />
          <span className="text-sm font-semibold tracking-tight text-text-primary">Project Vulcan</span>
        </button>
        <div className="flex items-center gap-1">
          <a href="#features" className="hidden px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary md:block">
            Features
          </a>
          <a href="#terminal" className="hidden px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary md:block">
            Terminal
          </a>
          <a
            href="https://github.com/avneeshjadhav04/project-vulcan"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
            aria-label="GitHub"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          {isAuthenticated ? (
            <button
              onClick={() => navigate('/chat')}
              className="ml-2 carbon-btn-primary"
            >
              <MessageCircle className="h-4 w-4" />
              Go to Chat
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate('/login')}
                className="px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Sign in
              </button>
              <button
                onClick={() => navigate('/login?signup=1')}
                className="ml-2 carbon-btn-primary"
              >
                Get Started
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}

/* ─── Hero ─── */

interface BootLine {
  text: string
  color: string
  speed?: number
}

function HeroTerminal() {
  const [visibleCount, setVisibleCount] = useState(0)
  const [allDone, setAllDone] = useState(false)

  const lines: BootLine[] = [
    { text: '$ vulcan --start', color: 'text-text-disabled', speed: 28 },
    { text: '[ OK ] Loading configuration...', color: 'text-text-secondary', speed: 22 },
    { text: '[ OK ] Initializing SQLite database', color: 'text-text-secondary', speed: 22 },
    { text: '[ OK ] Connected to AI providers', color: 'text-support-success', speed: 24 },
    { text: '[ OK ] Sandboxed terminal initialized', color: 'text-support-success', speed: 24 },
    { text: '[ OK ] AES-256-GCM encryption active', color: 'text-support-success', speed: 24 },
    { text: 'Loading available models...', color: 'text-interactive', speed: 30 },
    { text: '  nvidia/llama-3.1-8b-instruct      ready', color: 'text-text-secondary', speed: 18 },
    { text: '  openai/gpt-4o-mini                ready', color: 'text-text-secondary', speed: 18 },
    { text: '  groq/llama-3.3-70b-versatile      ready', color: 'text-text-secondary', speed: 18 },
    { text: '', color: 'text-text-secondary', speed: 10 },
    { text: 'Project Vulcan is ready.', color: 'text-support-success', speed: 26 },
  ]

  const handleLineDone = useCallback(() => {
    setVisibleCount((c) => {
      const next = c + 1
      if (next >= lines.length) {
        setTimeout(() => setAllDone(true), 400)
      }
      return next
    })
  }, [lines.length])

  return (
    <TerminalWindow title="vulcan — bash">
      <div className="h-[240px] overflow-y-auto p-5 font-mono text-left text-[13px] leading-relaxed">
        {lines.slice(0, visibleCount + 1).map((line, i) => (
          <div key={i} className={`mb-0.5 ${line.color}`}>
            {i === visibleCount ? (
              <Typewriter
                text={line.text}
                speed={line.speed ?? 28}
                jitter={10}
                onDone={handleLineDone}
                showCursor
              />
            ) : (
              line.text
            )}
          </div>
        ))}
        {allDone && (
          <div className="mt-1 text-interactive">
            $<BlinkingCursor />
          </div>
        )}
      </div>
    </TerminalWindow>
  )
}

function Hero() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 pt-24">
      {/* Background glow effects */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-interactive/20 opacity-50 blur-[120px] mix-blend-screen" />
      <div className="pointer-events-none absolute right-0 top-0 -z-10 h-[400px] w-[600px] rounded-full bg-interactive/20 opacity-40 blur-[100px] mix-blend-screen" />
      
      <div className="relative mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-text-secondary backdrop-blur-md transition-colors hover:bg-white/10">
            <Sparkles className="h-3.5 w-3.5 text-interactive" />
            <span className="text-interactive">Multi-Provider AI Platform</span>
          </div>

          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-text-primary md:text-7xl">
            Your Personal{' '}
            <span className="bg-vibrant-gradient bg-clip-text text-transparent">AI Assistant</span>
          </h1>

          <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-text-secondary">
            A secure, self-hosted AI platform. Chat with the latest models from
            NVIDIA NIM, OpenAI, Groq, and more. Execute terminal commands safely,
            generate full codebases, and instantly preview web apps in a built-in interactive workspace.
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            {isAuthenticated ? (
              <button
                onClick={() => navigate('/chat')}
                className="carbon-btn-primary"
              >
                <MessageCircle className="h-4 w-4" />
                Go to Chat
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => navigate('/login?signup=1')}
                className="carbon-btn-primary"
              >
                Start Chatting
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="carbon-btn-secondary"
            >
              Learn More
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-14"
        >
          <HeroTerminal />
        </motion.div>
      </div>
    </section>
  )
}

/* ─── Features ─── */

function FeatureCard({ icon: Icon, title, description, delay }: { icon: any; title: string; description: string; delay: number }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-50px' })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className="group relative overflow-hidden rounded-glass border border-white/5 bg-layer/40 p-8 backdrop-blur-md transition-all hover:border-interactive/30 hover:bg-layer/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-interactive/10"
    >
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-carbon bg-vibrant-gradient text-white shadow-lg">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-sm font-semibold text-text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
    </motion.div>
  )
}

function Features() {
  const features = [
    {
      icon: MessageSquare,
      title: 'AI Chat',
      description: 'Real-time streaming chat with SSE, smooth handoff, syntax highlighting, and live typing indicators.',
    },
    {
      icon: Terminal,
      title: 'Sandboxed Terminal',
      description: 'Execute commands safely inside an Ubuntu environment with proot filesystem isolation.',
    },
    {
      icon: Lock,
      title: 'Bring Your Own Key',
      description: 'Your API keys are encrypted with AES-256-GCM and only decrypted in-memory during requests.',
    },
    {
      icon: Cpu,
      title: 'Multi-Provider Support',
      description: 'Connect NVIDIA NIM, OpenAI, Groq, or any OpenAI-compatible provider. Switch models on the fly.',
    },
    {
      icon: Shield,
      title: 'Secure by Default',
      description: 'Self-hosted with SQLite, WAL mode, CSRF protection, and JWT-based authentication.',
    },
    {
      icon: Globe,
      title: 'Dark Mode Aesthetic',
      description: 'Inspired by IBM Carbon Design System. Strict dark mode, clean typography, and zero visual clutter.',
    },
    {
      icon: LayoutTemplate,
      title: 'Live Web Previews',
      description: 'Watch the AI build applications and instantly preview the generated HTML/JS inside a sandboxed iframe.',
    },
    {
      icon: Folder,
      title: 'Workspace File Explorer',
      description: 'Browse, download, and view the code of files generated by the AI using the sleek, built-in code viewer.',
    },
  ]

  return (
    <section id="features" className="px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mb-16 text-center"
        >
          <h2 className="mb-3 text-3xl font-light tracking-tight text-text-primary md:text-4xl">
            Everything You Need
          </h2>
          <p className="mx-auto max-w-lg text-base text-text-secondary">
            A complete AI assistant platform built for security, speed, and simplicity.
          </p>
        </motion.div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <FeatureCard key={f.title} {...f} delay={i * 0.05} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── Terminal Demo ─── */

interface CommandStep {
  prompt: string
  output: string[]
  processing?: boolean
}

function TerminalDemo() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [phase, setPhase] = useState<'idle' | 'typing' | 'processing' | 'output' | 'done'>('idle')
  const [currentStep, setCurrentStep] = useState(0)

  const commands: CommandStep[] = [
    {
      prompt: '$ uname -a',
      output: ['Linux sandbox 5.15.0-generic #1 SMP x86_64 GNU/Linux'],
    },
    {
      prompt: '$ python3 -c "print(\'Hello from sandbox\')"',
      output: ['Hello from sandbox'],
    },
    {
      prompt: '$ ls -la /workspace',
      output: [
        'total 24',
        'drwxr-xr-x  4 vulcan vulcan 4096 May 10 14:32 .',
        'drwxr-xr-x 18 root   root   4096 Jan  1 00:00 ..',
        '-rw-r--r--  1 vulcan vulcan  220 May 10 14:30 .bashrc',
        'drwxr-xr-x  2 vulcan vulcan 4096 May 10 14:31 .cache',
        '-rw-r--r--  1 vulcan vulcan  12K May 10 14:32 data.json',
      ],
    },
  ]

  useEffect(() => {
    if (!isInView || phase !== 'idle') return
    setPhase('typing')
  }, [isInView, phase])

  const handleTypeDone = useCallback(() => {
    setPhase('processing')
    setTimeout(() => {
      setPhase('output')
    }, 500)
  }, [])

  const handleOutputDone = useCallback(() => {
    if (currentStep + 1 < commands.length) {
      setTimeout(() => {
        setCurrentStep((s) => s + 1)
        setPhase('typing')
      }, 800)
    } else {
      setTimeout(() => {
        setPhase('done')
      }, 600)
    }
  }, [currentStep, commands.length])

  return (
    <section id="terminal" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="overflow-hidden rounded-glass border border-white/5 bg-layer/40 backdrop-blur-md shadow-2xl"
        >
          <div className="grid items-center lg:grid-cols-2">
            <div className="p-10 lg:p-14">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-text-secondary">
                <Terminal className="h-4 w-4 text-interactive" />
                Sandboxed Environment
              </div>
              <h2 className="mb-4 text-2xl font-light tracking-tight text-text-primary md:text-3xl">
                Execute Commands Safely
              </h2>
              <p className="mb-6 text-base leading-relaxed text-text-secondary">
                Run terminal commands in an isolated Ubuntu environment. Every command is executed
                within a proot filesystem — no privileges required.
              </p>
              <ul className="space-y-3">
                {[
                  'Filesystem isolation via proot',
                  'Ubuntu 24.04 LTS base environment',
                  '60-second timeout per command',
                  '4 concurrent command limit',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-text-secondary">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center border border-border-subtle bg-layer">
                      <Shield className="h-3 w-3 text-support-success" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-white/5 bg-layer/20 p-8 lg:border-t-0 lg:border-l lg:p-12">
              <TerminalWindow title="sandbox — bash" className="border border-white/10 shadow-none">
                <div className="h-[320px] overflow-y-auto p-5 font-mono text-[13px] leading-relaxed">
                  {commands.slice(0, currentStep).map((cmd, i) => (
                    <div key={i} className="mb-3">
                      <div className="mb-1 text-text-disabled">{cmd.prompt}</div>
                      {cmd.output.map((line, j) => (
                        <motion.div
                          key={j}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.15, delay: j * 0.04 }}
                          className="text-text-secondary"
                        >
                          {line}
                        </motion.div>
                      ))}
                    </div>
                  ))}

                  {phase === 'typing' && currentStep < commands.length && (
                    <div className="mb-1 text-text-disabled">
                      <Typewriter
                        text={commands[currentStep].prompt}
                        speed={28}
                        jitter={12}
                        onDone={handleTypeDone}
                        showCursor
                      />
                    </div>
                  )}

                  {phase === 'processing' && currentStep < commands.length && (
                    <div className="mb-1 text-text-disabled">
                      {commands[currentStep].prompt}
                      <span className="inline-block h-[1.1em] w-[0.6em] translate-y-[0.05em] bg-interactive align-middle" />
                    </div>
                  )}

                  <AnimatePresence>
                    {phase === 'output' && currentStep < commands.length && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onAnimationComplete={handleOutputDone}
                      >
                        {commands[currentStep].output.map((line, j) => (
                          <motion.div
                            key={j}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.15, delay: j * 0.05 }}
                            className="text-text-secondary"
                          >
                            {line}
                          </motion.div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {phase === 'done' && (
                    <div className="mt-1 text-interactive">
                      $<BlinkingCursor />
                    </div>
                  )}
                </div>
              </TerminalWindow>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

/* ─── CTA ─── */

function CTASection() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-4xl relative">
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-interactive/10 blur-[80px] mix-blend-screen" />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="rounded-glass border border-white/5 bg-layer/60 backdrop-blur-xl p-12 text-center shadow-2xl md:p-20"
        >
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-carbon bg-vibrant-gradient text-white shadow-lg">
            <Zap className="h-8 w-8" />
          </div>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
            {isAuthenticated ? 'Welcome Back' : 'Ready to Get Started?'}
          </h2>
          <p className="mx-auto mb-6 max-w-md text-base text-text-secondary">
            {isAuthenticated
              ? 'Jump back into your conversations and continue where you left off.'
              : 'Deploy your own personal AI assistant in minutes. No complex setup, no hidden fees.'}
          </p>
          {isAuthenticated ? (
            <button
              onClick={() => navigate('/chat')}
              className="carbon-btn-primary"
            >
              <MessageCircle className="h-4 w-4" />
              Go to Chat
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => navigate('/login?signup=1')}
              className="carbon-btn-primary"
            >
              Launch Project Vulcan
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </motion.div>
      </div>
    </section>
  )
}

/* ─── Footer ─── */

function Footer() {
  return (
    <footer className="border-t border-white/5 bg-background/80 backdrop-blur-md px-6 py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
        <div className="flex items-center gap-3">
          <img src="/VulcanLogo.png" alt="" className="h-10 w-10 opacity-80 transition-opacity hover:opacity-100" />
          <span className="text-xs font-semibold text-text-primary">Project Vulcan</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/avneeshjadhav04/project-vulcan"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <Github className="h-3.5 w-3.5" />
            View on GitHub
          </a>
          <p className="text-xs text-text-disabled">
            Built with Rust, React, and multi-provider AI.
          </p>
        </div>
      </div>
    </footer>
  )
}

/* ─── Main ─── */

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-text-primary">
      <Nav />
      <main>
        <Hero />
        <Features />
        <TerminalDemo />
        <CTASection />
      </main>
      <Footer />
    </div>
  )
}
