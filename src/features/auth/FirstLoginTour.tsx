// THE FIRST TIME SOMEBODY OPENS THIS PLATFORM.
// It runs immediately after the password gate, which is the one moment a person is guaranteed to be paying…
import { useMemo, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { onPrefsSettled, prefsSettled } from '@/lib/prefsSync'
import { useMemberStore } from '@/stores/useMemberStore'
import { crossHome } from '@/lib/crossPlace'
import { useTenantStore } from '@/stores/useTenantStore'
import { activeWorldId } from '@/stores/useWorldStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { TOUR_FINISH_LABEL, tourStepsFor, type TourStep } from './tourSteps'

const SEEN_KEY = 'asa-tour-seen'

// Who has been told the tour, as a set of user ids.
function seenIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const list = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

// Keyed to the sign-in (a hash of the token, never the token): a reboot clears sessionStorage and would reopen the tour.
const SESSION_KEY = 'asa-tour-done-session'

function sessionMark(uid: string): string {
  let token = ''
  try { token = String(JSON.parse(localStorage.getItem('asa-auth') ?? '{}')?.state?.token ?? '') } catch { token = '' }
  let h = 5381
  for (let i = 0; i < token.length; i++) h = ((h * 33) ^ token.charCodeAt(i)) >>> 0
  return `${uid}:${h.toString(36)}`
}

function doneThisSession(uid: string): boolean {
  try { return localStorage.getItem(SESSION_KEY) === sessionMark(uid) } catch { return false }
}

function markSession(uid: string): void {
  try { localStorage.setItem(SESSION_KEY, sessionMark(uid)) } catch { /* the tour repeats once — harmless */ }
}

function markSeen(uid: string, skip: boolean): void {
  if (!uid || skip) return
  try {
    const next = [...new Set([...seenIds(), uid])].slice(-40)
    localStorage.setItem(SEEN_KEY, JSON.stringify(next))
    void import('@/lib/prefsSync').then((m) => m.schedulePrefsPush())
  } catch {
    /* storage unavailable — they see it once more, which is the harmless way to fail */
  }
}

type Step = TourStep

// WHO HEARS ABOUT AKRON — the rule and the steps themselves live in `./tourSteps` (single source, shared with the…

export default function FirstLoginTour() {
  const user = useAuthStore((s) => s.user)
  const visiting = Boolean(useMemberStore((s) => s.currentMemberId))
  // wearing another account (Be Another) is not their first sign-in, and their tour mark stays theirs
  const acting = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const [i, setI] = useState(0)
  // Only a press closes this — openness is DERIVED from who is signed in and what the shelf remembers, never…
  const [dismissed, setDismissed] = useState('')

  const uid = String(user?.id ?? '')
  // The master sees the tour on every sign-in, on purpose; `markSeen` never records it.
  const debugAlways = user?.isMaster === true
  // READ AGAIN WHEN THE PULL LANDS.
  const settled = useSyncExternalStore(onPrefsSettled, prefsSettled, () => false)
  const alreadySeen = useMemo(
    () => {
      if (!uid) return true
      // the session mark stops the finishing reboot from reopening the tour
      if (doneThisSession(uid)) return true
      return debugAlways ? false : seenIds().includes(uid)
    },
    // `dismissed` and `settled` are read only to re-run this
    [uid, debugAlways, dismissed, settled],
  )
  // the password gate owns the screen until it is satisfied — this waits
  const open = Boolean(uid) && !user?.mustChangePassword && !visiting && !acting &&
               !alreadySeen && dismissed !== uid

  const steps = useMemo<Step[]>(() => tourStepsFor(user), [user])

  const step = steps[Math.min(i, steps.length - 1)]
  const last = i >= steps.length - 1

  const finish = (goHome: boolean) => {
    markSeen(uid, debugAlways)
    markSession(uid)
    setDismissed(uid)
    // reboot only when it moves somebody; the marks above must be written before any reload
    if (!goHome) return
    const { currentTenantId, homeTenantId } = useTenantStore.getState()
    const elsewhere = Boolean(activeWorldId()) || visiting ||
                      (Boolean(homeTenantId) && currentTenantId !== homeTenantId)
    if (elsewhere) crossHome('Opening ASA LifeCare Ohio')
  }

  if (!open || !step) return null
  const Icon = step.icon

  return (
    <AnimatePresence>
      <motion.div
        key="first-login-tour"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
        className="fixed inset-0 z-[190] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
          className="w-full max-w-[640px] rounded-lg border border-border bg-surface p-8 shadow-3"
        >
          <div className="mb-5 flex items-center gap-4">
            <span className={cn('grid h-16 w-16 shrink-0 place-items-center rounded-full', step.tint)}>
              <Icon size={30} />
            </span>
            <div className="min-w-0">
              <p id="tour-title" className="font-display text-[26px] font-bold leading-[32px] text-text-1">
                {step.title}
              </p>
              <p className="truncate text-[15px] text-text-3">
                Welcome, {String(user?.name ?? '').split(' ')[0]} · {i + 1} of {steps.length}
              </p>
            </div>
          </div>

          <p className="mb-6 text-[19px] leading-[31px] text-text-1">{step.body}</p>

          {/* where you are in it — a row of marks, not a number to read */}
          <div className="mb-6 flex gap-2">
            {steps.map((s, n) => (
              <span
                key={s.id}
                className={cn('h-1.5 flex-1 rounded-full transition-colors',
                  n <= i ? 'bg-primary' : 'bg-surface-2')}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => (i === 0 ? finish(false) : setI((n) => n - 1))}
              className="h-12 rounded-md px-4 text-[16px] font-semibold text-text-2 transition-colors hover:text-text-1"
            >
              {i === 0 ? 'Skip' : 'Back'}
            </button>
            <button
              type="button"
              onClick={() => (last ? finish(true) : setI((n) => n + 1))}
              className="flex h-12 items-center gap-2 rounded-md bg-primary px-6 text-[16px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98]"
            >
              {last ? TOUR_FINISH_LABEL : 'Next'}
              <ArrowRight size={18} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
