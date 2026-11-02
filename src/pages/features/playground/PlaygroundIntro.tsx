// THE PLAYGROUND'S OWN FIRST VISIT (the Release Users work).
// The studio is the most powerful page on the platform and the one a new admin is least prepared for: five ideas…
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, FileJson, GalleryThumbnails, Layers, Rocket, Sparkles } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { useSeenOnce } from '@/lib/seenOnce'
import { useMemberStore } from '@/stores/useMemberStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

const SEEN_KEY = 'asa-playground-intro-seen'

export type IntroStep = {
  id: string
  icon: typeof Sparkles
  tint: string
  title: string
  body: string
}

/** What a first visit needs to know, in the order the eye meets it. */
export const PLAYGROUND_INTRO_STEPS: IntroStep[] = [
  {
    id: 'describe',
    icon: Sparkles,
    tint: 'bg-tint-lavender text-tint-fg-lavender',
    title: 'Describe your app, in one sentence',
    body:
      'Write what you need in plain words and press GENERATE DRAFT. The model designs the name, ' +
      'the pages and the sample data — and a deterministic standard pass cleans its answer ' +
      '(sizes, colors, matching columns) before you ever see it. No model available? Your ' +
      'keywords still become a solid local draft.',
  },
  {
    id: 'draft-not-publish',
    icon: Rocket,
    tint: 'bg-tint-mint text-tint-fg-mint',
    title: 'A draft is not a publish',
    body:
      'Everything arrives as an UNSAVED DRAFT in the editor below. Read it, change anything, ' +
      'discard it and try again — nothing reaches the App Hub until you press PUBLISH APP. ' +
      'An app the AI made is an app you reviewed.',
  },
  {
    id: 'pages',
    icon: Layers,
    tint: 'bg-tint-blue text-tint-fg-blue',
    title: 'Pages, config and sample data',
    body:
      'An app is a list of PAGES (a table, a board, a dashboard…). Each page has a CONFIG — ' +
      'how it looks and behaves — and SAMPLE DATA, the rows you see while designing. Edit ' +
      'visually, or open ADVANCED (JSON) for the raw truth. "Generate rows" refills believable ' +
      'sample data from your config.',
  },
  {
    id: 'gallery',
    icon: GalleryThumbnails,
    tint: 'bg-tint-amber text-tint-fg-amber',
    title: 'Gallery and Import — start from something',
    body:
      'GALLERY holds ready-made apps (maintenance log, shift swaps, visitor book…) — Install ' +
      'loads one as a draft you reshape. IMPORT brings a bundle file, or a whole spreadsheet, ' +
      'and assembles the app around your real columns.',
  },
  {
    id: 'publish',
    icon: FileJson,
    tint: 'bg-tint-peach text-tint-fg-peach',
    title: 'Publish makes it real',
    body:
      'PUBLISH APP (admins) creates the app in the App Hub with its own live data tabs — the ' +
      'sample rows stay behind as preview. From then on, edits in the app are real records, ' +
      'and republishing from here never touches them.',
  },
]

export default function PlaygroundIntro() {
  const user = useAuthStore((s) => s.user)
  const visiting = Boolean(useMemberStore((s) => s.currentMemberId))
  const [i, setI] = useState(0)

  const uid = String(user?.id ?? '')
  // closed until the pull lands and read again when it does, so a released mark opens it (lib/seenOnce)
  const { seen, markSeen: finish } = useSeenOnce(SEEN_KEY, uid)
  const open = !visiting && !seen

  const steps = PLAYGROUND_INTRO_STEPS
  const step = steps[Math.min(i, steps.length - 1)]
  const last = i >= steps.length - 1

  if (!open || !step) return null
  const Icon = step.icon

  return (
    <AnimatePresence>
      <motion.div
        key="playground-intro"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
        className="fixed inset-0 z-[190] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pg-intro-title"
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
              <p id="pg-intro-title" className="font-display text-[24px] font-bold leading-[30px] text-text-1">
                {step.title}
              </p>
              <p className="text-[14px] text-text-3">The studio, in five ideas · {i + 1} of {steps.length}</p>
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
              {last ? 'Start building' : 'Next'}
              <ArrowRight size={17} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
