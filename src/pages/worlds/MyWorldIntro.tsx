// THE WORLD'S OWN FIRST VISIT (the Release Users work).
// My World is the person's special space — their own tenant, at the same level as headquarters, where they build…
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Globe2, Home, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { useSeenOnce } from '@/lib/seenOnce'
import { useMemberStore } from '@/stores/useMemberStore'
import { useStanding } from '@/lib/standing'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

const SEEN_KEY = 'asa-myworld-intro-seen'

export type MyWorldIntroStep = {
  id: string
  icon: typeof Home
  tint: string
  title: string
  body: string
}

/** What a first arrival in one's own world needs to hear, in order. */
export const MYWORLD_INTRO_STEPS: MyWorldIntroStep[] = [
  {
    id: 'yours',
    icon: Home,
    tint: 'bg-tint-mint text-tint-fg-mint',
    title: 'This place is yours',
    body:
      'My World is a whole tenant of your own — at the same level as ASA LifeCare Ohio, with the ' +
      'same machinery, holding your own data. Not a folder inside the company: a place that ' +
      'is yours.',
  },
  {
    id: 'build',
    icon: Sparkles,
    tint: 'bg-tint-lavender text-tint-fg-lavender',
    title: 'You can build apps here',
    body:
      'Press CREATE AN APP and describe what you want in one sentence — the studio turns it into ' +
      'a working app with pages, columns and data, no code. Build for your own life: a tracker, ' +
      'a planner, a library, whatever you need.',
  },
  {
    id: 'update',
    icon: RefreshCw,
    tint: 'bg-tint-peach text-tint-fg-peach',
    title: 'UPDATE APPS keeps you current',
    body:
      'When the catalogue grows, press UPDATE APPS here on WORLD HOME — the newest apps load into ' +
      'your world. Nothing you built is touched: an app you made stays yours, and one you removed ' +
      'stays removed.',
  },
  {
    id: 'separate',
    icon: ShieldCheck,
    tint: 'bg-tint-blue text-tint-fg-blue',
    title: 'What you make here lives here',
    body:
      'Your apps and their data belong to your world, separate from the company’s ground. When ' +
      'you cross back to ASA LifeCare Ohio, everything there is exactly as you left it — the two ' +
      'places never mix.',
  },
]

export default function MyWorldIntro() {
  const user = useAuthStore((s) => s.user)
  const visiting = Boolean(useMemberStore((s) => s.currentMemberId))
  const standing = useStanding()
  const [i, setI] = useState(0)

  const uid = String(user?.id ?? '')
  // closed until the pull lands and read again when it does, so a released mark opens it (lib/seenOnce)
  const { seen, markSeen: finish } = useSeenOnce(SEEN_KEY, uid)
  // only the OWNER's own world, and never inside a visit — standing in somebody's world is not that person's first…
  const open = standing.mine && !visiting && !seen

  const steps = MYWORLD_INTRO_STEPS
  const step = steps[Math.min(i, steps.length - 1)]
  const last = i >= steps.length - 1

  if (!open || !step) return null
  const Icon = step.icon

  return (
    <AnimatePresence>
      <motion.div
        key="myworld-intro"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
        className="fixed inset-0 z-[190] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mw-intro-title"
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
          className="w-full max-w-[620px] rounded-lg border border-border bg-surface p-8 shadow-3"
        >
          <div className="mb-5 flex items-center gap-4">
            <span className={cn('grid h-14 w-14 shrink-0 place-items-center rounded-full', step.tint)}>
              <Icon size={26} />
            </span>
            <div className="min-w-0">
              <p id="mw-intro-title" className="font-display text-[24px] font-bold leading-[30px] text-text-1">
                {step.title}
              </p>
              <p className="text-[14px] text-text-3">
                <Globe2 size={13} className="mr-1 inline" />
                Welcome to your world · {i + 1} of {steps.length}
              </p>
            </div>
          </div>

          <p className="mb-6 text-[17px] leading-[28px] text-text-1">{step.body}</p>

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
              onClick={() => (i === 0 ? finish() : setI((n) => n - 1))}
              className="h-11 rounded-md px-4 text-[15px] font-semibold text-text-2 transition-colors hover:text-text-1"
            >
              {i === 0 ? 'Skip' : 'Back'}
            </button>
            <button
              type="button"
              onClick={() => (last ? finish() : setI((n) => n + 1))}
              className="flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-[15px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98]"
            >
              {last ? 'Make it yours' : 'Next'}
              <ArrowRight size={17} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
