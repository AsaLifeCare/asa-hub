// A TEMPORARY PASSWORD IS A KEY FOR ONE USE: the access system forces a password change after a sign-in with one…
// A temporary password arrives two ways.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Eye, EyeOff, Loader2, LogOut, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import AsaLogo from '@/components/shared/AsaLogo'
import SiteFooter from '@/components/shared/SiteFooter'
import { CHOOSE_PASSWORD_WHY, saveOwnPassword } from '@/features/auth/passwordReset'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

const inputCls =
  'h-10 w-full rounded-sm border border-border bg-surface pl-3 pr-10 text-[13.5px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

// How much of a password this is — LENGTH × VARIETY, the two things a person can see themselves while typing.
function scorePassword(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length
  if (pw.length >= 12 && variety >= 3) return 3
  if (pw.length >= 10 && variety >= 2) return 2
  return 1
}

/** Weak reads pink, fair amber, strong mint — the platform's own tints. */
const STRENGTH = [
  { label: '', bar: '', text: '' },
  { label: 'Weak', bar: 'bg-tint-fg-pink', text: 'text-tint-fg-pink' },
  { label: 'Fair', bar: 'bg-tint-fg-amber', text: 'text-tint-fg-amber' },
  { label: 'Strong', bar: 'bg-tint-fg-mint', text: 'text-tint-fg-mint' },
] as const

export default function MustChangePasswordGate() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  // wearing another account (Be Another): their password is theirs to choose, never set from here
  const acting = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pageRef = useRef<HTMLDivElement>(null)

  const score = useMemo(() => scorePassword(pw), [pw])
  const strength = STRENGTH[score]
  const matches = confirm.length > 0 && pw === confirm

  const open = Boolean(user?.mustChangePassword) && !acting

  // the shell under the page cannot be reached by keyboard or a screen reader while the page stands
  useEffect(() => {
    const page = pageRef.current
    if (!open || !page?.parentElement) return
    const covered = Array.from(page.parentElement.children).filter((el) => el !== page && !el.hasAttribute('inert'))
    covered.forEach((el) => el.setAttribute('inert', ''))
    return () => covered.forEach((el) => el.removeAttribute('inert'))
  }, [open])

  const submit = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    const got = await saveOwnPassword(pw, confirm)
    if (!got.ok) {
      setError(got.error)
      setBusy(false)
      return
    }
    toast({ type: 'success', title: 'Password set', body: 'This one is yours alone — the temporary password no longer opens your account.' })
  }

  // The gate lives mounted over every route, so it keeps its state after it closes — cleared once the exit…
  return (
    <AnimatePresence
      onExitComplete={() => { setPw(''); setConfirm(''); setShow(false); setBusy(false); setError('') }}
    >
      {open && (
        <motion.div
          ref={pageRef}
          key="must-change-password"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          className="fixed inset-0 z-[200] flex flex-col items-center overflow-y-auto bg-bg px-4"
        >
          <section aria-labelledby="must-change-title" className="my-auto w-full max-w-[440px] py-10">
            <div className="mb-6 flex justify-center"><AsaLogo /></div>
            <div className="rounded-[18px] border border-border bg-surface p-6 shadow-2">
              <div className="mb-4 flex items-center gap-3">
                {/* the mark of the thing being asked for — a round tinted tile,
                    the platform's own shape for "this is about a person" */}
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
                  <ShieldCheck size={22} />
                </span>
                <div className="min-w-0">
                  <h1 id="must-change-title" className="font-display text-[17px] font-bold leading-tight text-text-1">
                    Choose your password
                  </h1>
                  <p className="truncate text-[13px] font-medium text-text-2">{user?.name}</p>
                  <p className="truncate text-[12px] text-text-3">{user?.email}</p>
                </div>
              </div>

              <p className="mb-5 text-[12.5px] leading-5 text-text-2">{CHOOSE_PASSWORD_WHY}</p>

              <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
                <div className="space-y-3.5">
                  <label className="grid gap-1.5">
                    <span className="text-[12px] font-medium text-text-2">New password</span>
                    <div className="relative">
                      <input
                        type={show ? 'text' : 'password'} value={pw} autoFocus
                        autoComplete="new-password"
                        onChange={(e) => { setPw(e.target.value); setError('') }}
                        className={cn(inputCls, error && 'border-danger')}
                        placeholder="At least 8 characters"
                      />
                      <button
                        type="button"
                        aria-label={show ? 'Hide password' : 'Show password'}
                        onClick={() => setShow((v) => !v)}
                        className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                      >
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {/* the mirror: three segments filling as the password earns them */}
                    <div className="mt-0.5 flex items-center gap-2">
                      <div className="flex h-1 flex-1 gap-1">
                        {[1, 2, 3].map((seg) => (
                          <span
                            key={seg}
                            className={cn(
                              'h-1 flex-1 rounded-full transition-colors duration-300',
                              score >= seg ? strength.bar : 'bg-border',
                            )}
                          />
                        ))}
                      </div>
                      <span className={cn('w-[46px] text-right text-[11px] font-semibold', strength.text)}>
                        {strength.label}
                      </span>
                    </div>
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-[12px] font-medium text-text-2">Confirm</span>
                    <div className="relative">
                      <input
                        type={show ? 'text' : 'password'} value={confirm}
                        autoComplete="new-password"
                        onChange={(e) => { setConfirm(e.target.value); setError('') }}
                        className={cn(inputCls, error && 'border-danger', matches && 'border-tint-fg-mint')}
                        placeholder="Type it once more"
                      />
                      <AnimatePresence>
                        {matches && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.7 }}
                            transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                            className="absolute right-2.5 top-2.5 text-tint-fg-mint"
                          >
                            <Check size={17} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    {confirm.length > 0 && !matches && (
                      <span className="text-[11px] font-medium text-text-3">Both fields must match.</span>
                    )}
                  </label>

                  <AnimatePresence>
                    {error && (
                      <motion.p
                        role="alert"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                        className="text-[12px] font-medium text-danger"
                      >
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-[13.5px] font-semibold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.99] disabled:opacity-50"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {busy ? 'Saving…' : 'Save and continue'}
                </button>
              </form>
              {/* the only other honest way out — signing out leaves the demand
                  standing, so this page meets them again at the next sign-in */}
              <button
                type="button"
                onClick={() => logout()}
                className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <LogOut size={13} /> Sign out instead
              </button>
            </div>
          </section>
          {/* the shell's own footer is under the page: one footer landmark */}
          <SiteFooter as="p" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
