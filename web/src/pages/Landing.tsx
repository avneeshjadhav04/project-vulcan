import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import {
  MessageSquare,
  Terminal,
  Shield,
  Zap,
  ChevronRight,
  Sparkles,
  Lock,
  Globe,
  Cpu,
} from 'lucide-react'

function AnimatedBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-1/2 -left-1/2 h-full w-full animate-pulse-glow rounded-full bg-accent/5 blur-[120px]" />
      <div className="absolute -bottom-1/2 -right-1/2 h-full w-full animate-pulse-glow rounded-full bg-accent/5 blur-[120px]" style={{ animationDelay: '1.5s' }} />
      <div className="absolute top-1/3 left-1/3 h-96 w-96 rounded-full bg-[#78a9ff]/5 blur-[100px]" />
    </div>
  )
}

function Nav() {
  const navigate = useNavigate()
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 glass-strong">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-accent">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-text-primary">Carbon AI</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/login')}
            className="px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate('/login')}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/20"
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
    <section className="relative flex min-h-screen items-center justify-center px-6 pt-20">
      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            Powered by NVIDIA NIM
          </div>
          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-text-primary md:text-7xl">
            Your Personal{' '}
            <span className="gradient-text">AI Assistant</span>
            <br />
            in the Cloud
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-text-secondary">
            A sleek, secure, and sandboxed AI platform. Chat with the latest models,
            execute terminal commands safely, and bring your own NVIDIA NIM key.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => navigate('/login')}
              className="group flex items-center gap-2 rounded bg-accent px-8 py-3 text-base font-medium text-white transition-all hover:bg-accent-hover hover:shadow-xl hover:shadow-accent/20"
            >
              Start Chatting
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="rounded border border-border bg-surface px-8 py-3 text-base font-medium text-text-primary transition-all hover:border-text-secondary hover:bg-surface-hover"
            >
              Learn More
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
          className="mt-20"
        >
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-xl border border-border glass glow-accent">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <div className="h-3 w-3 rounded-full bg-error/80" />
              <div className="h-3 w-3 rounded-full bg-[#f1c21b]/80" />
              <div className="h-3 w-3 rounded-full bg-success/80" />
              <span className="ml-2 text-xs text-text-secondary">Carbon AI Terminal</span>
            </div>
            <div className="p-6 font-mono text-sm">
              <div className="mb-2 text-text-secondary">$ carbon-ai --start</div>
              <div className="mb-2 text-success">✓ Connected to NVIDIA NIM API</div>
              <div className="mb-2 text-success">✓ Sandboxed terminal initialized</div>
              <div className="mb-2 text-success">✓ AES-256-GCM encryption active</div>
              <div className="mb-2 text-accent">→ Loading latest models...</div>
              <div className="text-text-secondary">
                <span className="inline-block h-4 w-2 animate-pulse bg-accent" />
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
      className="group rounded-xl border border-border bg-surface/50 p-6 transition-all hover:border-accent/50 hover:bg-surface hover:shadow-lg hover:shadow-accent/5"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors group-hover:bg-accent/20">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
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
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
            Everything You Need
          </h2>
          <p className="mx-auto max-w-xl text-text-secondary">
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
          className="relative overflow-hidden rounded-2xl border border-border glass glow-accent p-12 text-center"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent" />
          <div className="relative">
            <Zap className="mx-auto mb-6 h-12 w-12 text-accent" />
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-text-primary">
              Ready to Get Started?
            </h2>
            <p className="mx-auto mb-8 max-w-lg text-text-secondary">
              Deploy your own personal AI assistant in minutes. No complex setup, no hidden fees.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="group inline-flex items-center gap-2 rounded bg-accent px-8 py-3 text-base font-medium text-white transition-all hover:bg-accent-hover hover:shadow-xl hover:shadow-accent/20"
            >
              Launch Carbon AI
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-text-secondary">Carbon AI</span>
        </div>
        <p className="text-xs text-text-secondary">
          Built with Rust, React, and NVIDIA NIM. Open source on GitHub.
        </p>
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="relative min-h-screen bg-background">
      <AnimatedBackground />
      <Nav />
      <Hero />
      <Features />
      <CTASection />
      <Footer />
    </div>
  )
}
