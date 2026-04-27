import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
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
} from 'lucide-react'

function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-[#0f62fe] focus:px-4 focus:py-2 focus:text-sm focus:text-white focus:outline-none"
    >
      Skip to content
    </a>
  )
}

function Nav() {
  const navigate = useNavigate()
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#2a2a2a] bg-[#0f0f0f]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0f62fe]">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">Carbon AI</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#features" className="hidden text-sm text-[#c6c6c6] transition-colors hover:text-white md:block">
            Features
          </a>
          <a href="#terminal" className="hidden text-sm text-[#c6c6c6] transition-colors hover:text-white md:block">
            Terminal
          </a>
          <button
            onClick={() => navigate('/login')}
            className="text-sm font-medium text-[#c6c6c6] transition-colors hover:text-white"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate('/login')}
            className="rounded-lg bg-[#0f62fe] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#0353e9] hover:shadow-lg hover:shadow-[#0f62fe]/25"
          >
            Get Started
          </button>
        </div>
      </div>
    </nav>
  )
}

function Hero() {
  const navigate = useNavigate()
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 pt-24">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/4 h-[500px] w-[500px] rounded-full bg-[#0f62fe]/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full bg-[#78a9ff]/5 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-5xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#0f62fe]/30 bg-[#0f62fe]/10 px-4 py-2 text-xs font-semibold text-[#78a9ff]">
            <Sparkles className="h-3.5 w-3.5" />
            Powered by NVIDIA NIM
          </div>

          <h1 className="mb-6 text-5xl font-extrabold leading-[1.1] tracking-tight text-white md:text-7xl lg:text-8xl">
            Your Personal{' '}
            <span className="bg-gradient-to-r from-[#0f62fe] via-[#78a9ff] to-[#33b1ff] bg-clip-text text-transparent">
              AI Assistant
            </span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[#c6c6c6] md:text-xl">
            A sleek, secure, and sandboxed AI platform. Chat with the latest models,
            execute terminal commands safely, and bring your own NVIDIA NIM key.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => navigate('/login')}
              className="group flex items-center gap-2 rounded-xl bg-[#0f62fe] px-8 py-4 text-base font-semibold text-white transition-all hover:bg-[#0353e9] hover:shadow-xl hover:shadow-[#0f62fe]/30"
            >
              Start Chatting
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center gap-2 rounded-xl border border-[#393939] bg-[#1a1a1a] px-8 py-4 text-base font-semibold text-white transition-all hover:border-[#525252] hover:bg-[#222222]"
            >
              Learn More
            </button>
          </div>
        </motion.div>

        {/* Terminal Demo */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
          className="mt-16"
        >
          <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2 border-b border-[#2a2a2a] px-5 py-3">
              <div className="h-3 w-3 rounded-full bg-[#da1e28]" />
              <div className="h-3 w-3 rounded-full bg-[#f1c21b]" />
              <div className="h-3 w-3 rounded-full bg-[#24a148]" />
              <span className="ml-3 text-xs text-[#525252]">Carbon AI Terminal</span>
            </div>
            <div className="p-6 font-mono text-sm text-left">
              <div className="mb-1 text-[#525252]">$ carbon-ai --start</div>
              <div className="mb-1 text-[#24a148]">
                <span className="mr-2">✓</span>Connected to NVIDIA NIM API
              </div>
              <div className="mb-1 text-[#24a148]">
                <span className="mr-2">✓</span>Sandboxed terminal initialized
              </div>
              <div className="mb-1 text-[#24a148]">
                <span className="mr-2">✓</span>AES-256-GCM encryption active
              </div>
              <div className="mb-1 text-[#0f62fe]">
                <span className="mr-2">→</span>Loading latest models...
              </div>
              <div className="mt-2 text-[#525252]">
                <span className="inline-block h-4 w-2 animate-pulse bg-[#0f62fe]" />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function FeatureCard({ icon: Icon, title, description, delay }: { icon: any; title: string; description: string; delay: number }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-50px' })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay }}
      className="group rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-8 transition-all duration-300 hover:border-[#0f62fe]/50 hover:bg-[#1e1e1e] hover:shadow-xl hover:shadow-[#0f62fe]/5"
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-[#0f62fe]/10 text-[#0f62fe] transition-colors group-hover:bg-[#0f62fe]/20">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="mb-3 text-xl font-bold text-white">{title}</h3>
      <p className="leading-relaxed text-[#c6c6c6]">{description}</p>
    </motion.div>
  )
}

function Features() {
  const features = [
    {
      icon: MessageSquare,
      title: 'AI Chat',
      description: 'Real-time streaming chat with NVIDIA NIM models. Choose from the latest LLMs with a sleek, minimal interface.',
    },
    {
      icon: Terminal,
      title: 'Sandboxed Terminal',
      description: 'Execute commands safely inside nsjail with resource limits. No network, read-only filesystem, 512MB RAM cap.',
    },
    {
      icon: Lock,
      title: 'Bring Your Own Key',
      description: 'Your NVIDIA NIM API key is encrypted with AES-256-GCM and only decrypted in-memory during requests.',
    },
    {
      icon: Cpu,
      title: 'Model Selection',
      description: 'Dynamic dropdown with the latest available models fetched directly from NVIDIA NIM. Cached for performance.',
    },
    {
      icon: Shield,
      title: 'Admin Dashboard',
      description: 'Role-based access control with user management, terminal audit logs, and system monitoring.',
    },
    {
      icon: Globe,
      title: 'Carbon Aesthetic',
      description: 'Inspired by IBM Carbon Design System. Strict dark mode, IBM Plex typography, and zero visual clutter.',
    },
  ]

  return (
    <section id="features" className="relative px-6 py-32">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-20 text-center"
        >
          <h2 className="mb-4 text-4xl font-bold tracking-tight text-white md:text-5xl">
            Everything You Need
          </h2>
          <p className="mx-auto max-w-xl text-lg text-[#c6c6c6]">
            A complete AI assistant platform built for security, speed, and simplicity.
          </p>
        </motion.div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <FeatureCard key={f.title} {...f} delay={i * 0.1} />
          ))}
        </div>
      </div>
    </section>
  )
}

function TerminalDemo() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section id="terminal" className="relative px-6 py-32">
      <div className="mx-auto max-w-6xl">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="overflow-hidden rounded-3xl border border-[#2a2a2a] bg-[#0f0f0f]"
        >
          <div className="grid items-center lg:grid-cols-2">
            <div className="p-12">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#0f62fe]/30 bg-[#0f62fe]/10 px-4 py-2 text-xs font-semibold text-[#78a9ff]">
                <Terminal className="h-3.5 w-3.5" />
                Sandboxed Environment
              </div>
              <h2 className="mb-6 text-3xl font-bold tracking-tight text-white md:text-4xl">
                Execute Commands Safely
              </h2>
              <p className="mb-8 text-lg leading-relaxed text-[#c6c6c6]">
                Run terminal commands in a fully isolated sandbox. Every command is executed
                inside nsjail with strict resource limits — no network access, read-only filesystem,
                and automatic termination after 30 seconds.
              </p>
              <ul className="space-y-4">
                {[
                  'No network access for commands',
                  'Read-only root filesystem',
                  '512MB RAM limit per session',
                  '30 second CPU timeout',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-[#c6c6c6]">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#24a148]/20">
                      <Shield className="h-3.5 w-3.5 text-[#24a148]" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-[#2a2a2a] bg-[#0a0a0a] p-8 lg:border-t-0 lg:border-l">
              <div className="font-mono text-sm">
                <div className="mb-2 text-[#525252]">$ uname -a</div>
                <div className="mb-4 text-[#c6c6c6]">Linux sandbox 5.15.0 #1 SMP x86_64 GNU/Linux</div>
                <div className="mb-2 text-[#525252]">$ python3 -c "print('Hello from sandbox')"</div>
                <div className="mb-4 text-[#c6c6c6]">Hello from sandbox</div>
                <div className="mb-2 text-[#525252]">$ curl https://example.com</div>
                <div className="mb-4 text-[#da1e28]">curl: (6) Could not resolve host</div>
                <div className="mb-2 text-[#525252]">$ ls -la /</div>
                <div className="text-[#c6c6c6]">dr-xr-xr-x  18 root root 4096 Jan  1 00:00 .</div>
                <div className="text-[#c6c6c6]">dr-xr-xr-x  18 root root 4096 Jan  1 00:00 ..</div>
                <div className="text-[#c6c6c6]">drwxr-xr-x   2 root root 4096 Jan  1 00:00 bin</div>
                <div className="mt-4 text-[#0f62fe]">$ <span className="inline-block h-4 w-2 animate-pulse bg-[#0f62fe]" /></div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function CTASection() {
  const navigate = useNavigate()
  return (
    <section className="relative px-6 py-32">
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative overflow-hidden rounded-3xl border border-[#2a2a2a] bg-[#1a1a1a] p-12 text-center md:p-16"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[#0f62fe]/10 via-transparent to-transparent" />
          <div className="relative">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0f62fe]/10">
              <Zap className="h-8 w-8 text-[#0f62fe]" />
            </div>
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
              Ready to Get Started?
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-lg text-[#c6c6c6]">
              Deploy your own personal AI assistant in minutes. No complex setup, no hidden fees.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="group inline-flex items-center gap-2 rounded-xl bg-[#0f62fe] px-8 py-4 text-base font-semibold text-white transition-all hover:bg-[#0353e9] hover:shadow-xl hover:shadow-[#0f62fe]/30"
            >
              Launch Carbon AI
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-[#2a2a2a] px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#0f62fe]" />
          <span className="text-sm font-semibold text-white">Carbon AI</span>
        </div>
        <p className="text-sm text-[#525252]">
          Built with Rust, React, and NVIDIA NIM.
        </p>
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <SkipToContent />
      <Nav />
      <main id="main-content">
        <Hero />
        <Features />
        <TerminalDemo />
        <CTASection />
      </main>
      <Footer />
    </div>
  )
}
