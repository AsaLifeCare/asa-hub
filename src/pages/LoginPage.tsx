// Login (route /login) — split-screen entry, outside the app Layout.
// Left: the platform's only intentionally-dark surface (.cortex-band navy, see index.css) carrying the "asa."…
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { Activity, ArrowLeft, ArrowRight, Loader2, Lock, Mail, Paperclip, Phone, Send, ShieldCheck, User, X } from 'lucide-react'
import AsaLogo from '@/components/shared/AsaLogo'
import SiteFooter from '@/components/shared/SiteFooter'
import Toasts from '@/components/shell/Toasts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ACCOUNT_BLOCKED, useAuthStore } from '@/auth/useAuthStore'
import { roleBadge } from '@/auth/types'
import { toast } from '@/stores/useToastStore'
import { fileToBase64, inferMime, humanSize, MAX_UPLOAD_BYTES } from '@/features/hiring/shared'
import { DEFAULT_EXEC_URL, useApiConfigStore } from '@/stores/useApiConfigStore'
import { FORGOT_ANSWER, askForTemporaryPassword } from '@/features/auth/passwordReset'
import { EASE_OUT_EXPO } from '@/engine/motion'

import { homeRouteFor } from '@/lib/homeRoute'
import { useMatrixLanded } from '@/lib/matrixLanded'
import { forgetReturn, returnPath } from '@/lib/returnTo'
import { cn } from '@/lib/utils'


// Day-of accounts (configurable): the label shown under the version and the email it fills in.
const QUICK_ACCOUNTS: { label: string; email: string; lane: string }[] = [
  // EMPTY ON PURPOSE: INTERVIEWER left (the HM types carry the pen on a normal login) and ONBOARDING left with it…
]

/** Quick-account label style — highlighted while its lane is armed. */
const cnLane = (active: boolean) =>
  'font-mono text-xs tracking-wide transition-colors duration-150 ' +
  (active ? 'text-primary-strong' : 'text-text-3 hover:text-primary-strong')

const FIELD =
  'h-11 w-full rounded-full border border-border bg-surface pl-10 pr-4 text-sm text-text-1 outline-none transition-colors duration-150 placeholder:text-text-3 focus:border-primary/60'

/** Pulsing accent dot (matches WelcomePage). */
function PulseDot() {
  return (
    <motion.span
      aria-hidden
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
    />
  )
}

/** Left brand panel — navy in both themes, hidden below lg. */
function BrandPanel() {
  return (
    <div className="cortex-band relative hidden flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
      {/* top-left: ASA + CORTEX overline */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
        className="flex items-center gap-2.5"
      >
        <Activity size={16} className="text-primary" />
        <span className="text-on-band-muted font-mono text-xs tracking-[0.3em]">ASA + CORTEX</span>
      </motion.div>

      {/* vertically centered wordmark */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.08, ease: EASE_OUT_EXPO }}
      >
        <AsaLogo size="xl" onDark withSubtitle />
      </motion.div>

      {/* bottom-left status */}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, delay: 0.2 }}
        className="text-on-band-muted flex items-center gap-2 font-mono text-xs tracking-[0.2em]"
      >
        <PulseDot /> SYSTEM ONLINE
      </motion.span>
    </div>
  )
}

// BLOCKED, SAID KINDLY: a deactivated account with the right password deserves the truth and a door — not the…
function BlockedCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
      className="rounded-[18px] border border-border bg-surface-2 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
          <Lock size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-text-1">This account is blocked</p>
          <p className="mt-1 text-[12px] leading-5 text-text-2">
            Your access to the Hub is currently deactivated. If you believe this is a
            mistake, our support team can help.
          </p>
          <a
            href="mailto:asa-hub@asaop.org"
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary-strong transition-colors hover:text-primary"
          >
            <Mail size={13} /> asa-hub@asaop.org
          </a>
        </div>
      </div>
    </motion.div>
  )
}

// THE REFERRAL WARNING: a referral with no phone and no e-mail — and none READABLE inside the resume — is asked for…
const REFERRAL_WARN_FALLBACK =
  'Thank you for thinking of {name}! To move forward, our team needs a way to ' +
  'reach them — a phone number or an e-mail address. Please add one of the two ' +
  'and press Send again.'

function ReferralNote({ text, tone }: { text: string; tone: 'warn' | 'known' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
      className="rounded-[18px] border border-border bg-surface-2 p-4"
    >
      <div className="flex items-start gap-3">
        <span className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full',
          tone === 'warn' ? 'bg-tint-amber text-tint-fg-amber' : 'bg-tint-mint text-tint-fg-mint',
        )}>
          {tone === 'warn' ? <Phone size={15} /> : <ShieldCheck size={15} />}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-text-1">
            {tone === 'warn' ? 'We need a way to reach them' : 'Already with us'}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-text-2">{text}</p>
        </div>
      </div>
    </motion.div>
  )
}

/** Inline error banner shared by both form modes. */
function FormError({ error }: { error: string }) {
  return (
    <motion.p
      key={error}
      initial={{ opacity: 0, x: 0 }}
      animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }}
      transition={{ duration: 0.32 }}
      className="rounded-[14px] bg-tint-pink px-3.5 py-2.5 text-[12px] font-medium leading-5 text-tint-fg-pink"
    >
      {error}
    </motion.p>
  )
}

/** Normal mode — email + password sign-in. */
function SignInForm({ prefill }: { prefill?: { email: string; lane: string; label: string } }) {
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()
  /** a signed-out link's target (lib/returnTo), followed once */
  const back = returnPath(useLocation().state)

  // a quick-account tap remounts the form (keyed by lane in LoginPage) with the email already filled — no effect…
  const [identifier, setIdentifier] = useState(prefill?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const id = identifier.trim()
    if (!id) {
      setError('Enter your email.')
      return
    }
    if (!password) {
      setError('Enter your password.')
      return
    }
    setError(null)
    setBlocked(false)
    setBusy(true)
    const loginError = await login(id, password, prefill?.lane)
    setBusy(false)
    if (loginError === ACCOUNT_BLOCKED) {
      setBlocked(true)
      return
    }
    if (loginError) {
      setError(loginError)
      return
    }
    const signedIn = useAuthStore.getState().user
    forgetReturn()
    if (signedIn) {
      // the page goes on — a link's target first, else the role's home — once this sign-in's matrix has landed:
      // chosen here, before it, My Work read as shut and the login fell on the Overview
      toast({
        type: 'success',
        title: `Welcome back, ${signedIn.name.split(' ')[0]}`,
        body: `Signed in as ${roleBadge(signedIn).toLowerCase()}.`,
      })
      return
    }
    navigate(back ?? homeRouteFor(null), { replace: true })
  }

  return (
    <form onSubmit={submit} noValidate className="mt-7 space-y-4">
      {prefill && (
        <p className="rounded-full bg-primary-soft px-3 py-1.5 text-center font-mono text-[10px] tracking-[0.2em] text-primary-strong">
          {prefill.label} SIGN-IN
        </p>
      )}
      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">EMAIL</span>
        <span className="relative block">
          <User size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="email"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(null); setBlocked(false) }}
            placeholder="you@asalifecare.com"
            autoComplete="username"
            aria-label="Email"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">PASSWORD</span>
        <span className="relative block">
          <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); setBlocked(false) }}
            placeholder="Password"
            autoComplete="current-password"
            aria-label="Password"
            className={FIELD}
          />
        </span>
      </label>

      {/* decorative branch select — purely visual, no logic */}
      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">BRANCH</span>
        <Select defaultValue="asa-lifecare">
          <SelectTrigger
            aria-label="Branch"
            className="h-11 w-full rounded-full border-border bg-surface px-4 text-sm text-text-1 shadow-none"
          >
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asa-lifecare">ASA Lifecare</SelectItem>
          </SelectContent>
        </Select>
      </label>

      {blocked && <BlockedCard />}
      {error && <FormError error={error} />}

      <button
        type="submit"
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold tracking-[0.12em] text-on-primary transition-colors duration-150 hover:bg-primary-hover active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        SIGN IN
      </button>
    </form>
  )
}

// REFERRALS: no login — anyone at the access screen can send a person in, and that person lands straight on the…
function ReferralForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [referrerName, setReferrerName] = useState('')
  const [referrerPhone, setReferrerPhone] = useState('')
  const [referrerEmail, setReferrerEmail] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'warn' | 'known' } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const digits = phone.replace(/\D/g, '')
    if (!name.trim()) {
      setError('Enter the person’s name.')
      return
    }
    setNote(null)
    if (digits.length < 10 && !email.includes('@')) {
      // NO typed contact.
      if (!file && !resumeText.trim()) {
        setNote({ text: REFERRAL_WARN_FALLBACK.split('{name}').join(name.trim() || 'this person'), tone: 'warn' })
        return
      }
    }
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setError(`The resume is too large (${humanSize(file.size)}) — up to 15MB.`)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        resume_text: pasteOpen ? resumeText : '',
      }
      // the referrer's own details ride only when typed (all optional)
      if (referrerName.trim()) payload.referrer = referrerName.trim()
      if (referrerPhone.trim()) payload.referrer_phone = referrerPhone.trim()
      if (referrerEmail.trim()) payload.referrer_email = referrerEmail.trim()
      if (file) {
        payload.file_base64 = await fileToBase64(file)
        payload.file_name = file.name
        payload.mime = inferMime(file)
      }
      // PUBLIC on purpose: no token EVER rides this request — a stale session in the browser must not turn a…
      const url = useApiConfigStore.getState().execUrl || DEFAULT_EXEC_URL
      const post = async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: 'body=' + encodeURIComponent(JSON.stringify({ action: 'referralSubmit', payload })),
        })
        return (await res.json()) as { status: number; message?: string; code?: string }
      }
      let env: { status: number; message?: string; code?: string }
      try {
        env = await post()
      } catch {
        await new Promise((r) => setTimeout(r, 400))
        env = await post()
      }
      // no contact found anywhere — the WARNING, in the sheet's own words
      if (env.code === 'no_contact') {
        setNote({ text: env.message || REFERRAL_WARN_FALLBACK.split('{name}').join(name.trim() || 'this person'), tone: 'warn' })
        return
      }
      // the person is ALREADY in the records — good news, said as such
      if (env.code === 'already_known') {
        setNote({ text: env.message || 'They are already in our hiring records — our team is on it.', tone: 'known' })
        return
      }
      if (env.status >= 400) throw new Error(env.message || `Error ${env.status}`)
      toast({
        type: 'success',
        title: 'Referral received',
        body: `Thank you — ${name.trim().split(' ')[0]} is in our hiring pipeline.`,
      })
      onDone()   // the screen returns to its initial formation
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(msg.startsWith('Unknown action')
        ? 'Referrals open after the next platform update — please try again soon.'
        : msg || 'Could not send the referral. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">FULL NAME</span>
        <span className="relative block">
          <User size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            placeholder="Who are you referring?"
            aria-label="Full name"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">PHONE</span>
        <span className="relative block">
          <Phone size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); setNote(null) }}
            placeholder="+1 (330) 555-0100"
            aria-label="Phone"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">EMAIL</span>
        <span className="relative block">
          <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); setNote(null) }}
            placeholder="their@email.com"
            aria-label="Email"
            className={FIELD}
          />
        </span>
      </label>
      <p className="text-[11px] leading-4 text-text-3">Name plus a phone number or an email is enough.</p>

      {/* the REFERRER's own details: all optional — used only
          when the person can't be reached and we need to ask the referrer. */}
      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">YOUR NAME</span>
        <span className="relative block">
          <User size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={referrerName}
            onChange={(e) => { setReferrerName(e.target.value); setError(null) }}
            placeholder="Your name"
            aria-label="Your name"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">YOUR PHONE</span>
        <span className="relative block">
          <Phone size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="tel"
            value={referrerPhone}
            onChange={(e) => { setReferrerPhone(e.target.value); setError(null) }}
            placeholder="+1 (330) 555-0100"
            aria-label="Your phone"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">YOUR EMAIL</span>
        <span className="relative block">
          <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="email"
            value={referrerEmail}
            onChange={(e) => { setReferrerEmail(e.target.value); setError(null) }}
            placeholder="you@email.com"
            aria-label="Your email"
            className={FIELD}
          />
        </span>
      </label>
      <p className="text-[11px] leading-4 text-text-3">Optional — if we cannot reach them, we may ask you for their phone or resume.</p>

      {/* optional resume — attach OR paste, both light-touch */}
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) { setFile(f); setPasteOpen(false); setError(null); setNote(null) }
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12px] font-semibold text-text-2 transition-colors hover:border-primary/60 hover:text-text-1"
        >
          <Paperclip size={13} /> {file ? file.name : 'Attach resume'}
        </button>
        {file ? (
          <button type="button" aria-label="Remove the resume" onClick={() => setFile(null)}
            className="grid h-8 w-8 place-items-center rounded-full text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1">
            <X size={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12px] font-semibold text-text-2 transition-colors hover:border-primary/60 hover:text-text-1"
          >
            {pasteOpen ? 'Hide pasted resume' : 'Paste resume'}
          </button>
        )}
      </div>
      {pasteOpen && !file && (
        <textarea
          value={resumeText}
          onChange={(e) => { setResumeText(e.target.value); setNote(null) }}
          rows={5}
          placeholder="Paste the resume text here (optional)"
          aria-label="Pasted resume"
          className="w-full rounded-[14px] border border-border bg-surface px-4 py-3 text-sm text-text-1 outline-none transition-colors duration-150 placeholder:text-text-3 focus:border-primary/60"
        />
      )}

      {note && <ReferralNote text={note.text} tone={note.tone} />}
      {error && <FormError error={error} />}

      <button
        type="submit"
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold tracking-[0.12em] text-on-primary transition-colors duration-150 hover:bg-primary-hover active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        SEND
      </button>
    </form>
  )
}

/** First-run mode — create the initial admin account (authBootstrap). */
function BootstrapForm() {
  const bootstrapAdmin = useAuthStore((s) => s.bootstrapAdmin)
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const clearError = () => setError(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) {
      setError('Enter a display name.')
      return
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    if (!password) {
      setError('Enter a password.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setError(null)
    setBusy(true)
    const err = await bootstrapAdmin(name.trim(), email.trim(), password)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    const signedIn = useAuthStore.getState().user
    toast({
      type: 'success',
      title: `Welcome, ${(signedIn?.name ?? name.trim()).split(' ')[0]}`,
      body: 'Admin account created — you are signed in.',
    })
    navigate(homeRouteFor(signedIn?.role), { replace: true })
  }

  return (
    <form onSubmit={submit} noValidate className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">DISPLAY NAME</span>
        <span className="relative block">
          <User size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); clearError() }}
            placeholder="Alex Morgan"
            autoComplete="name"
            aria-label="Display name"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">EMAIL</span>
        <span className="relative block">
          <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearError() }}
            placeholder="you@asalifecare.com"
            autoComplete="email"
            aria-label="Email"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">PASSWORD</span>
        <span className="relative block">
          <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearError() }}
            placeholder="Password"
            autoComplete="new-password"
            aria-label="Password"
            className={FIELD}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] tracking-[0.25em] text-text-3">CONFIRM PASSWORD</span>
        <span className="relative block">
          <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); clearError() }}
            placeholder="Repeat the password"
            autoComplete="new-password"
            aria-label="Confirm password"
            className={FIELD}
          />
        </span>
      </label>

      {error && <FormError error={error} />}

      <button
        type="submit"
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold tracking-[0.12em] text-on-primary transition-colors duration-150 hover:bg-primary-hover active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
        CREATE ADMIN
      </button>
    </form>
  )
}


// FORGOT PASSWORD: the same no-session post the referral form uses — a stale token must never turn a locked-out…
function ForgotForm({ onDone }: { onDone: () => void }) {
  const [ident, setIdent] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ident.trim() || busy) return
    setBusy(true)
    await askForTemporaryPassword(ident)
    setBusy(false)
    setSent(true)
  }
  if (sent) {
    return (
      <div className="mt-6 rounded-[12px] border border-border bg-bg p-4">
        <p className="text-[13.5px] font-semibold text-text-1">Check your e-mail or your phone</p>
        <p className="mt-1 text-[12.5px] leading-5 text-text-3">{FORGOT_ANSWER}</p>
        <button type="button" onClick={onDone} className="mt-3 text-[12.5px] font-semibold text-primary">
          Back to sign in
        </button>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="mt-6">
      <label htmlFor="forgot-ident" className="mb-1 block text-[12px] font-semibold text-text-2">
        Your e-mail or sign-in
      </label>
      <input
        id="forgot-ident" type="text" value={ident} onChange={(e) => setIdent(e.target.value)}
        placeholder="you@asalifecare.com" autoFocus autoComplete="username"
        className="mb-3 h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-text-1 outline-none focus:border-primary"
      />
      <button
        type="submit" disabled={busy || !ident.trim()}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold tracking-[0.08em] text-on-primary transition-colors duration-150 hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : null}
        SEND A TEMPORARY PASSWORD
      </button>
    </form>
  )
}

/** Signed in, the landing page not chosen yet: this sign-in's matrix is on its way (lib/matrixLanded). */
function LandingWait() {
  return (
    <div className="grid h-dvh place-items-center bg-bg" aria-busy="true" aria-label="Signing in" data-landing-wait="">
      <Toasts />
      <Loader2 size={22} className="animate-spin text-primary" />
    </div>
  )
}

export default function LoginPage() {
  const user = useAuthStore((s) => s.user)
  const needsBootstrap = useAuthStore((s) => s.needsBootstrap)

  // null = still asking the backend whether any user exists (first run check)
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  const [prefill, setPrefill] = useState<{ email: string; lane: string; label: string } | undefined>(undefined)
  // REFERRALS: the login card swaps into the no-login referral form; a successful send (or the footer toggle)…
  const [referral, setReferral] = useState(false)
  // FORGOT: the card swaps into the temporary-password form, below referrals
  const [forgot, setForgot] = useState(false)

  useEffect(() => {
    let cancelled = false
    void needsBootstrap().then((v) => {
      if (!cancelled) setFirstRun(v)
    })
    return () => {
      cancelled = true
    }
  }, [needsBootstrap])

  // signed in on /login: a kept link's target once, else home — read when the page opens, since it is forgotten at
  // the sign-in and the landing waits for this sign-in's matrix (lib/matrixLanded)
  const location = useLocation()
  const [back] = useState(() => returnPath(location.state))
  const landed = useMatrixLanded()
  useEffect(() => { if (user) forgetReturn() }, [user])
  if (user && !landed) return <LandingWait />
  if (user) return <Navigate to={back ?? homeRouteFor(user.role)} replace />

  return (
    <div className="grid h-dvh overflow-y-auto bg-bg lg:grid-cols-2 lg:overflow-hidden">
      {/* toasts also render outside the shell (e.g. the session-expired
          danger toast fired during sign-out) */}
      <Toasts />
      <BrandPanel />

      {/* right panel — the form, centred in the room above the footer */}
      <div className="flex min-h-dvh flex-col items-center overflow-y-auto px-6 lg:min-h-0">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
          className="my-auto w-full max-w-sm py-10"
        >
          {/* condensed brand on mobile (left panel hidden <lg) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Activity size={15} className="text-primary" />
            <span className="font-mono text-xs tracking-[0.3em] text-text-3">ASA + CORTEX</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-tint-mint text-tint-fg-mint">
              <Activity size={19} />
            </span>
            <span className="font-mono text-xs tracking-[0.3em] text-text-3">
              {firstRun ? 'FIRST RUN' : referral ? 'REFERRALS' : 'ACCESS'}
            </span>
          </div>

          <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight text-text-1">
            {firstRun ? 'Create the first admin' : referral ? 'Refer someone' : 'System Access'}
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-text-2">
            {firstRun
              ? 'This Hub has no users yet — set up the admin account to get started.'
              : forgot
                ? 'Locked out? We send a temporary password to the e-mail on your account, or by text to its phone, and you choose your own after signing in.'
                : referral
                  ? 'Know somebody great? Send them in — no account needed.'
                  : 'Sign in with your Hub account.'}
          </p>

          {firstRun === null ? (
            <div className="mt-7 grid h-40 place-items-center">
              <Loader2 size={18} className="animate-spin text-primary" />
            </div>
          ) : firstRun ? (
            <BootstrapForm />
          ) : forgot ? (
            <ForgotForm onDone={() => setForgot(false)} />
          ) : referral ? (
            <ReferralForm onDone={() => setReferral(false)} />
          ) : (
            <SignInForm key={prefill?.lane ?? 'plain'} prefill={prefill} />
          )}

          <p className="mt-6 text-[12px] leading-5 text-text-3">
            Sessions are stored on this device — you stay signed in on this browser until you sign out.
          </p>

          {/* FORGOT rides the same line as Back to home; referrals and the
              version id live BELOW it. */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-[13px] font-semibold text-text-2 transition-colors duration-150 hover:text-primary-strong"
            >
              <ArrowLeft size={14} /> Back to home
            </Link>
            <button
              type="button"
              onClick={() => { setPrefill(undefined); setReferral(false); setForgot((v) => !v) }}
              title="Get a temporary password"
              // THE SAME LETTERS AS ITS NEIGHBOUR.
              className={`text-[13px] font-semibold transition-colors duration-150 ${
                forgot ? 'text-primary-strong' : 'text-text-2 hover:text-primary-strong'
              }`}
            >
              Forgot password?
            </button>
          </div>

          <div className="mt-4 flex items-end justify-between gap-3">
            <span className="font-mono text-xs text-text-3">v0.4.0</span>
            <div className="flex flex-col items-end gap-1">
              {/* Day-of accounts: one tap fills the email, the person types
                  their own password. Add a lane in QUICK_ACCOUNTS. */}
              {QUICK_ACCOUNTS.map((acc) => (
                <button
                  key={acc.label}
                  type="button"
                  onClick={() => { setReferral(false); setPrefill({ email: acc.email, lane: acc.lane, label: acc.label }) }}
                  title={`Sign in as ${acc.email}`}
                  className={cnLane(prefill?.lane === acc.lane)}
                >
                  {acc.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setPrefill(undefined); setForgot(false); setReferral((v) => !v) }}
                title="Refer someone — no login needed"
                className={cnLane(referral)}
              >
                REFERRALS
              </button>
            </div>
          </div>
        </motion.div>
        <SiteFooter />
      </div>
    </div>
  )
}
