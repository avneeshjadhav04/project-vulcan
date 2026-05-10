import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
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
} from 'lucide-react'

function Nav() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border-subtle bg-background">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <button onClick={() => navigate('/')} className="flex items-center gap-2">
          <img src="/VulcanLogo.png" alt="" className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight text-text-primary">Project Vulcan</span>
        </button>
        <div className="flex items-center gap-1">
          <a href="#features" className="hidden px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary md:block">
            Features
          </a>
          <a href="#terminal" className="hidden px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary md:block">
            Terminal
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

function Hero() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <section className="flex min-h-screen items-center justify-center px-6 pt-16">
      <div className="relative mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="mb-6 inline-flex items-center gap-2 border border-border-subtle bg-layer px-3 py-1.5 text-xs font-medium text-text-secondary">
            <Sparkles className="h-3 w-3" />
            Powered by NVIDIA NIM
          </div>

          <h1 className="mb-5 text-5xl font-light leading-tight tracking-tight text-text-primary md:text-7xl">
            Your Personal{' '}
            <span className="font-semibold text-interactive">AI Assistant</span>
          </h1>

          <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-text-secondary">
            A secure, self-hosted AI platform. Chat with the latest models,
            execute terminal commands safely, and bring your own NVIDIA NIM key.
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

        {/* Terminal Demo */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-14"
        >
          <div className="mx-auto max-w-xl overflow-hidden border border-border-subtle bg-background">
            <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
              <div className="h-2.5 w-2.5 rounded-full bg-support-error" />
              <div className="h-2.5 w-2.5 rounded-full bg-support-warning" />
              <div className="h-2.5 w-2.5 rounded-full bg-support-success" />
              <span className="ml-3 text-xs text-text-disabled">Project Vulcan Terminal</span>
            </div>
            <div className="p-5 font-mono text-left text-sm">
              <div className="mb-1 text-text-disabled">$ vulcan --start</div>
              <div className="mb-1 text-support-success">Connected to NVIDIA NIM API</div>
              <div className="mb-1 text-support-success">Sandboxed terminal initialized</div>
              <div className="mb-1 text-support-success">AES-256-GCM encryption active</div>
              <div className="mb-1 text-interactive">Loading latest models...</div>
              <div className="mt-2 inline-block h-4 w-2 bg-interactive" />
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
      initial={{ opacity: 0, y: 16 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.3, delay }}
      className="border border-border-subtle bg-layer p-6 transition-colors hover:border-border-strong"
    >
      <div className="mb-4 flex h-10 w-10 items-center justify-center border border-border-subtle bg-background text-interactive">
        <Icon className="h-5 w-5" />
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
      description: 'Real-time streaming chat with NVIDIA NIM models. Choose from the latest LLMs with a minimal interface.',
    },
    {
      icon: Terminal,
      title: 'Sandboxed Terminal',
      description: 'Execute commands safely inside an Ubuntu environment with proot filesystem isolation.',
    },
    {
      icon: Lock,
      title: 'Bring Your Own Key',
      description: 'Your NVIDIA NIM API key is encrypted with AES-256-GCM and only decrypted in-memory during requests.',
    },
    {
      icon: Cpu,
      title: 'Model Selection',
      description: 'Dynamic dropdown with the latest available models fetched directly from NVIDIA NIM.',
    },
    {
      icon: Shield,
      title: 'Admin Dashboard',
      description: 'Role-based access control with user management, terminal audit logs, and system monitoring.',
    },
    {
      icon: Globe,
      title: 'Dark Mode Aesthetic',
      description: 'Inspired by IBM Carbon Design System. Strict dark mode, clean typography, and zero visual clutter.',
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <FeatureCard key={f.title} {...f} delay={i * 0.05} />
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
    <section id="terminal" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4 }}
          className="overflow-hidden border border-border-subtle bg-background"
        >
          <div className="grid items-center lg:grid-cols-2">
            <div className="p-10">
              <div className="mb-4 inline-flex items-center gap-2 border border-border-subtle bg-layer px-3 py-1.5 text-xs font-medium text-text-secondary">
                <Terminal className="h-3.5 w-3.5" />
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
            <div className="border-t border-border-subtle bg-layer p-8 lg:border-t-0 lg:border-l">
              <div className="font-mono text-sm">
                <div className="mb-2 text-text-disabled">$ uname -a</div>
                <div className="mb-4 text-text-secondary">Linux sandbox 5.15.0 #1 SMP x86_64 GNU/Linux</div>
                <div className="mb-2 text-text-disabled">$ python3 -c "print('Hello from sandbox')"</div>
                <div className="mb-4 text-text-secondary">Hello from sandbox</div>
                <div className="mb-2 text-text-disabled">$ ls -la /</div>
                <div className="text-text-secondary">dr-xr-xr-x  18 root root 4096 Jan  1 00:00 .</div>
                <div className="text-text-secondary">dr-xr-xr-x  18 root root 4096 Jan  1 00:00 ..</div>
                <div className="text-text-secondary">drwxr-xr-x   2 root root 4096 Jan  1 00:00 bin</div>
                <div className="mt-4 text-interactive">$ <span className="inline-block h-4 w-2 bg-interactive" /></div>
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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="border border-border-subtle bg-layer p-10 text-center md:p-14"
        >
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center border border-border-subtle bg-background">
            <Zap className="h-6 w-6 text-interactive" />
          </div>
          <h2 className="mb-3 text-2xl font-light tracking-tight text-text-primary md:text-3xl">
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

function Footer() {
  return (
    <footer className="border-t border-border-subtle px-6 py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 md:flex-row">
        <div className="flex items-center gap-2">
          <img src="/VulcanLogo.png" alt="" className="h-4 w-4" />
          <span className="text-xs font-semibold text-text-primary">Project Vulcan</span>
        </div>
        <p className="text-xs text-text-disabled">
          Built with Rust, React, and NVIDIA NIM.
        </p>
      </div>
    </footer>
  )
}

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
