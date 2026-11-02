// RELEASE USERS — the master's own door.
// Pick a person, see their situation in the sheet, and press Release: a LETTER and a TEXT naming their login and a…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, Building2, Eye, KeyRound, MailCheck, Megaphone, RotateCw, Search, Send, ShieldCheck, UserPlus,
} from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { activeWorldId } from '@/stores/useWorldStore'
import { withFollowedBadges } from '@/lib/badgeFollows'
import { askConfirm } from '@/stores/useDialogStore'
import { toast } from '@/stores/useToastStore'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import ReleaseUsersHero from './ReleaseUsersHero'
import { directoryReadOf, releaseFigures, type ReleaseDirectoryRow } from './releaseUsersModel'
import {
  announceAudience, announceView, blockedSentence, everybodyAlreadyTold, heldSentence, readReleaseRefusal,
  rearmFailedLine, releaseReportView, runAnnouncement, type AnnounceResult, type ReleaseResult,
} from './releaseReport'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { SUPPORT_CONTACT, TOUR_FINISH_LABEL, tourStepsFor, type TourStep } from '@/features/auth/tourSteps'
import { PLAYGROUND_INTRO_STEPS } from '@/pages/features/playground/PlaygroundIntro'
import { MYWORLD_INTRO_STEPS } from '@/pages/worlds/MyWorldIntro'

// the card's words for a failed rearm live with the other answers (releaseReport.ts)
export { rearmFailedLine }

type HubUserRow = ReleaseDirectoryRow

type ReleaseStatus = {
  user_id: string
  email: string
  display_name: string
  role: string
  types: string[]
  // TRUE FOR ANY BADGE THAT HEARS THE FRANCHISE STEP, not for one word.
  director: boolean
  active: boolean
  armed: boolean
  must_change: boolean
  last_login: string
  /** stamped by the last release; with last_login it says the password is THEIRS now */
  released_at?: string
  signed_in_before?: boolean
  /** null when their preference row does not parse — unknown, never "not seen" */
  marks: Record<string, boolean> | null
  marks_error?: string
  /** test mode read at the same moment as the person: on, off, or unknown */
  test_mode?: 'on' | 'off' | 'unknown'
  test_mode_error?: string
  /** true when the letter would reach nobody; `blocked_by` names why */
  sending_holds?: boolean
  blocked_by?: string
  hold_why?: string[]
  will_clear: string[]
}

// The answers' types and their sentences (held, blocked, the audience) live in releaseReport.ts, where each outcome…

/** One id per press: the one re-send a lost answer allows is the same letter, never a second. */
function newPressId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* falls through */ }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/* ------------------------- the sequence preview ------------------------- */

/** One step of any welcome sequence — every source already speaks this shape. */
type PreviewStep = { id: string; title: string; body: string; icon: TourStep['icon']; tint: string }

// The four sequences, each shown SEPARATELY: the regular user's walk, the director/admin one (the franchise step is…
type SequenceKind = 'regular' | 'director' | 'playground' | 'myworld'

const SEQUENCE_LABELS: Record<SequenceKind, { title: string; blurb: string }> = {
  regular: { title: 'Regular user', blurb: 'The password gate, then the full welcome tour — no franchise step.' },
  director: { title: 'Franchise badges', blurb: 'The same walk, with the Akron franchise step only some badges hear.' },
  playground: { title: 'Playground intro', blurb: 'The studio’s own first visit: describe, draft, pages, gallery, publish.' },
  myworld: { title: 'My World welcome', blurb: 'The world’s own first visit: your place, build apps, update apps, separate.' },
}

/** `director` is a legacy flag name — the badge printed is the person's own worn word, never "director". */
export function franchiseBadgeOf(status: { director: boolean; types?: string[] }): string {
  if (!status.director) return ''
  const worn = (status.types ?? []).map((t) => String(t).toUpperCase().trim())
  for (const rule of FRANCHISE_BADGES) {
    const named = worn.find((w) => withFollowedBadges([w]).includes(rule))
    if (named) return ` · ${named}`
  }
  return ` · ${FRANCHISE_BADGES[0]}`
}

// The badge the backend answers `director` for — the rule word, not the list of everybody the rule currently admits.
const FRANCHISE_BADGES = ['DIRECTOR']

const GATE_STEP: PreviewStep = {
  id: 'gate',
  title: 'First: the password gate',
  body:
    'They sign in with their email and the temporary password from the invite. The ' +
    'platform then refuses to go further until they choose a password of their own — the ' +
    'temporary one was a key for a single use.',
  icon: KeyRound,
  tint: 'bg-tint-blue text-tint-fg-blue',
}

// The exact modals of one sequence, in order — every step rendered from the SAME source the platform itself reads…
function previewSteps(kind: SequenceKind): PreviewStep[] {
  switch (kind) {
    case 'regular':
      return [GATE_STEP, ...tourStepsFor({ types: [], role: 'staff' })]
    case 'director':
      return [GATE_STEP, ...tourStepsFor({ types: ['DIRECTOR'], role: 'admin' })]
    case 'playground':
      return PLAYGROUND_INTRO_STEPS
    case 'myworld':
      return MYWORLD_INTRO_STEPS
  }
}

function SequencePreview({ kind, onClose }: {
  kind: SequenceKind | null
  onClose: () => void
}) {
  const steps = useMemo(() => (kind ? previewSteps(kind) : []), [kind])
  const [i, setI] = useState(0)
  // a new sequence starts from its first step
  const shown = Math.min(i, Math.max(steps.length - 1, 0))
  const step = kind ? steps[shown] : null
  const last = shown >= steps.length - 1

  const back = () => {
    if (!kind || shown === 0) {
      onClose()
    } else {
      setI((n) => n - 1)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="fixed inset-0 z-[190] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
        className="w-full max-w-[640px] rounded-lg border border-border bg-surface p-8 shadow-3"
        onClick={(e) => e.stopPropagation()}
      >
        {kind && step && (
          <>
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-3">
              {SEQUENCE_LABELS[kind].title} · {shown + 1} of {steps.length}
            </div>
            <div className="mb-5 flex items-center gap-4">
              <span className={cn('grid h-14 w-14 shrink-0 place-items-center rounded-full', step.tint)}>
                <step.icon size={26} />
              </span>
              <p className="font-display text-[24px] font-bold leading-[30px] text-text-1">{step.title}</p>
            </div>
            <p className="mb-6 text-[17px] leading-[28px] text-text-1">{step.body}</p>
            <div className="mb-6 flex gap-2">
              {steps.map((_, n) => (
                <span key={n} className={cn('h-1.5 flex-1 rounded-full transition-colors', n <= shown ? 'bg-primary' : 'bg-surface-2')} />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={back}
                className="h-11 rounded-md px-4 text-[15px] font-semibold text-text-2 transition-colors hover:text-text-1"
              >
                {shown === 0 ? 'Close' : 'Back'}
              </button>
              <button
                type="button"
                onClick={() => (last ? onClose() : setI((n) => n + 1))}
                className="flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-[15px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98]"
              >
                {last ? 'Done' : 'Next'}
                <ArrowRight size={17} />
              </button>
            </div>
            {last && (kind === 'regular' || kind === 'director') && (
              <p className="mt-4 text-center text-[13px] text-text-3">
                The real tour ends with “{TOUR_FINISH_LABEL}”. Questions and bugs: {SUPPORT_CONTACT}
              </p>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

/* ------------------------- the reads the page makes ------------------------- */

const errorWords = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e ?? '')) || 'the read did not come back'

/** The directory as this screen last heard it: a failed read is never an empty place. */
export type ReleaseDirectory = {
  users: HubUserRow[]
  state: 'reading' | 'ready' | 'failed'
  why: string
  retry: () => void
  /** the row of an account this screen just rearmed, so the header counts the roster as it is now */
  markRearmed: (uid: string) => void
}

// THE SHARED DIRECTORY, AND WHETHER IT ANSWERED.
export function useReleaseDirectory(enabled: boolean, secondChanceMs = 4000): ReleaseDirectory {
  const [users, setUsers] = useState<HubUserRow[]>([])
  const [read, setRead] = useState<{ state: ReleaseDirectory['state']; why: string }>({ state: 'reading', why: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const seed = cachedUsers()
    if (seed?.length) setUsers(seed as HubUserRow[])
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (n: number): void => {
      fetchUsers({ force: n > 0 || attempt > 0 })
        .then((rows) => {
          if (!alive) return
          setUsers(rows as HubUserRow[])
          setRead({ state: 'ready', why: '' })
        })
        .catch((e) => {
          if (!alive) return
          if (n === 0) {
            timer = setTimeout(() => load(1), secondChanceMs)
            return
          }
          setRead({ state: 'failed', why: errorWords(e) })
        })
    }
    load(0)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [enabled, attempt, secondChanceMs])

  const retry = useCallback(() => {
    setRead({ state: 'reading', why: '' })
    setAttempt((n) => n + 1)
  }, [])

  const markRearmed = useCallback((uid: string) => {
    setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, armed: true, active: true, last_login: '' } : u)))
  }, [])

  return { users, state: read.state, why: read.why, retry, markRearmed }
}

/** The line under the picker — a count only for a directory that answered. */
export function directoryCountLine(n: number, state: ReleaseDirectory['state']): string {
  if (state === 'ready') return `${n} people in this place's directory`
  if (state === 'failed') {
    return n ? `${n} people in the last list this tab read — the directory did not answer`
      : '— people (the directory did not answer)'
  }
  return n ? `${n} people in the last list this tab read — refreshing`
    : '— people (the directory has not answered yet)'
}

/** One person's situation, as read for the person picked NOW. */
export type SituationRead = {
  status: ReleaseStatus | null
  reading: boolean
  failed: string
  retry: () => void
  /** re-read after a release; throws for the caller to say so */
  refresh: (userId: string) => Promise<void>
}

// THE SITUATION OF THE PERSON ON SCREEN, NEVER OF THE ONE BEFORE.
export function usePersonSituation(selectedId: string): SituationRead {
  const [read, setRead] = useState<{ id: string; status: ReleaseStatus | null; failed: string }>(
    { id: '', status: null, failed: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!selectedId) return
    let alive = true
    gasAction<ReleaseStatus>('releaseUserStatus', { user_id: selectedId })
      .then((s) => { if (alive) setRead({ id: selectedId, status: s, failed: '' }) })
      .catch((e) => { if (alive) setRead({ id: selectedId, status: null, failed: errorWords(e) }) })
    return () => { alive = false }
  }, [selectedId, attempt])

  const retry = useCallback(() => {
    setRead({ id: '', status: null, failed: '' })
    setAttempt((n) => n + 1)
  }, [])

  const refresh = useCallback(async (userId: string): Promise<void> => {
    const fresh = await gasAction<ReleaseStatus>('releaseUserStatus', { user_id: userId })
    setRead((cur) => (cur.id === userId ? { id: userId, status: fresh, failed: '' } : cur))
  }, [])

  const mine = Boolean(selectedId) && read.id === selectedId
  return {
    status: mine ? read.status : null,
    reading: Boolean(selectedId) && (!mine || (!read.status && !read.failed)),
    failed: mine ? read.failed : '',
    retry,
    refresh,
  }
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
    >
      <RotateCw size={13} /> Try again
    </button>
  )
}

/** The person picker: the directory, what the query narrows it to, and what the read said. */
export function PersonPicker({ directory, query, onQuery, selectedId, onPick, locked = false }: {
  directory: Pick<ReleaseDirectory, 'users' | 'state' | 'why' | 'retry'>
  query: string
  onQuery: (q: string) => void
  selectedId: string
  onPick: (id: string) => void
  /** true while a release runs: its answer belongs to the person it was pressed for */
  locked?: boolean
}) {
  const { users } = directory
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const withMail = users.filter((u) => u.email.includes('@'))
    if (!q) return withMail
    return withMail.filter((u) =>
      u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, query])

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3">
        <Search size={15} className="text-text-3" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Find a person by name or email…"
          className="h-10 w-full bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3"
        />
      </div>
      {directory.state === 'failed' && users.length > 0 && (
        <div className="mb-3 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12.5px] leading-[19px] text-text-1">
          The directory did not answer, so this is the last list this tab read: {directory.why}
          <div><RetryButton onClick={directory.retry} /></div>
        </div>
      )}
      <div className="max-h-[520px] space-y-1 overflow-y-auto">
        {filtered.map((u) => (
          <button
            key={u.id}
            onClick={() => onPick(u.id)}
            disabled={locked}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              selectedId === u.id ? 'border-primary bg-tint-blue' : 'border-transparent hover:bg-surface-2',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-text-1">{u.display_name || u.email}</span>
              <span className="block truncate text-[12px] text-text-3">{u.email}</span>
            </span>
            {!u.armed && <span className="shrink-0 rounded-sm bg-tint-amber px-1.5 py-0.5 text-[11px] font-semibold text-tint-fg-amber">unarmed</span>}
          </button>
        ))}
        {!filtered.length && (
          <div className="px-2 py-6 text-center text-[13px] text-text-3">
            {users.length
              ? 'Nobody matches.'
              : directory.state === 'failed'
                ? (
                  <>
                    <p>— the directory could not be read: {directory.why}</p>
                    <RetryButton onClick={directory.retry} />
                  </>
                )
                : directory.state === 'reading'
                  ? 'Reading the directory…'
                  : 'The directory answered nobody for this place.'}
          </div>
        )}
      </div>
      <p className="mt-2 px-1 text-[12px] text-text-3">
        {directoryCountLine(users.length, directory.state)}
      </p>
    </div>
  )
}

/** The right-hand panel before a situation is on screen: nobody picked, being read, or unreadable. */
export function SituationPlaceholder({ selectedId, situation }: { selectedId: string; situation: SituationRead }) {
  if (situation.status) return null
  return (
    <div className="grid min-h-[300px] place-items-center rounded-lg border border-dashed border-border p-10 text-center">
      <div>
        {!selectedId ? (
          <>
            <UserPlus size={28} className="mx-auto mb-3 text-text-3" />
            <p className="text-[15px] text-text-2">Pick a person on the left to see their situation in the sheet — and what a Release will clear.</p>
          </>
        ) : situation.failed ? (
          <>
            <AlertTriangle size={28} className="mx-auto mb-3 text-danger" />
            <p className="text-[15px] text-text-1">Their situation could not be read — {situation.failed}</p>
            <p className="mt-1 text-[13px] text-text-3">Nothing about this person is shown until it can be, and no Release can be pressed for them.</p>
            <RetryButton onClick={situation.retry} />
          </>
        ) : (
          <p className="text-[15px] text-text-2">Reading their situation…</p>
        )}
      </div>
    </div>
  )
}

// THE CARD AFTER A PRESS, IN THE ANSWER'S OWN WORDS (releaseReportView).
export function ReleaseReportCard({ report }: { report: ReleaseResult }) {
  const view = releaseReportView(report)
  const rearmFailed = report.outcome === 'rearm_failed'
  return (
    <div
      className={cn(
        'rounded-md border p-4',
        view.tone === 'mint'
          ? 'border-tint-mint bg-tint-mint'
          : view.tone === 'danger' ? 'border-danger/40 bg-danger/10' : 'border-tint-amber bg-tint-amber',
      )}
    >
      <p className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-text-1">
        {rearmFailed ? <AlertTriangle size={16} className="shrink-0 text-danger" />
          : report.emailed ? <MailCheck size={16} /> : <ShieldCheck size={16} />}
        {view.headline}
      </p>
      {/* a rearm that did not reach them without the master choosing it:
          the older backend's 502, drawn as the lockout it is */}
      {view.lockedOut && !report.released_anyway && (
        <p className="mb-2 text-[13px] font-semibold leading-[22px] text-tint-fg-amber">
          The account is rearmed and nobody was told the new password — their old
          password no longer works, so until they are handed the new one they cannot sign in.
        </p>
      )}
      {/* A LETTER CARRYING A PASSWORD IS A LETTER THAT MATTERS: a
          rearm nobody was told about is a person who cannot sign
          in, and that is not a footnote. */}
      {report.released_anyway && (
        <p className="mb-2 text-[13px] font-semibold leading-[22px] text-tint-fg-amber">
          You chose to rearm although the invite could not reach them. The account is
          rearmed and nobody was told the new password — they get back in with Forgot
          password on the sign-in page, which sends them a temporary one.
        </p>
      )}
      {rearmFailed && report.emailed && (
        <p className="mb-2 text-[13px] font-semibold leading-[22px] text-danger">
          The invite already reached them, and the temporary password it names does not work until a
          Release succeeds.
        </p>
      )}
      {rearmFailed && report.rearm_error && (
        <p className="mb-2 text-[13px] leading-[22px] text-text-2">What the write said: {report.rearm_error}</p>
      )}
      <ul className="list-disc space-y-0.5 pl-5 text-[13px] leading-[22px] text-text-1">
        {rearmFailed
          ? <li>{rearmFailedLine(report.restored)}</li>
          : report.cleared.length
            ? report.cleared.map((c) => <li key={c}>{c}</li>)
            : <li>nothing was changed on the account</li>}
      </ul>
      {/* AFTER THE REARM, WHAT DID NOT FINISH. The release stands;
          these are the parts to check by hand — a session that may
          still be live, marks that may still say "seen". */}
      {!!report.warnings?.length && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] font-semibold leading-[22px] text-tint-fg-amber">
          {report.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {!report.blocked_by && !rearmFailed && report.sessions_ended === null && (
        <p className="mt-2 text-[13px] leading-[22px] text-text-2">
          Sessions ended: — the sessions tab could not be read, so how many were ended is unknown.
        </p>
      )}
      {/* What the two lines below describe is the MESSAGE, and only
          what the answer actually carried. A leg that could not run
          says why; an answer that said nothing prints nothing rather
          than a reassuring blank. */}
      {!!report.legs?.length && (
        <p className="mt-2 text-[13px] leading-[22px] text-text-2">
          Legs: {report.legs.join(' · ')}
        </p>
      )}
      {!!report.why?.length && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-[22px] text-text-2">
          {report.why.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------- the page ------------------------------- */

export default function ReleaseUsersPage() {
  const user = useAuthStore((s) => s.user)
  const currentTenantId = useTenantStore((s) => s.currentTenantId)
  const homeTenantId = useTenantStore((s) => s.homeTenantId)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  // THE DIRECTORY READ SAYS WHAT IT DID.
  const directory = useReleaseDirectory(Boolean(user?.isMaster))
  const situation = usePersonSituation(selectedId)
  const status = situation.status
  const [busy, setBusy] = useState(false)
  /** kept under the person it is about: an answer that lands after the picker moved is never drawn under somebody else */
  const [report, setReport] = useState<{ userId: string; result: ReleaseResult } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewKind, setPreviewKind] = useState<SequenceKind | null>(null)
  // ---- announce an app release ----
  const registryApps = useRegistryStore((s) => s.apps)
  const [annApp, setAnnApp] = useState('')
  const [annObjective, setAnnObjective] = useState('')
  const [annBusy, setAnnBusy] = useState(false)
  const [annReport, setAnnReport] = useState<AnnounceResult | null>(null)

  const appChoices = useMemo(
    () => registryApps
      .filter((a) => a.enabled !== false)
      .slice()
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    [registryApps],
  )

  // THE DIRECTORY BELONGS TO THE PLACE — usersList narrows server-side to the tenant you are standing in.
  const awayFromHome = Boolean(activeWorldId()) ||
    (Boolean(homeTenantId) && currentTenantId !== homeTenantId)

  // the header reads the same directory as the picker, in the same words
  const dirRead = useMemo(
    () => directoryReadOf(directory.state, directory.users.length, directory.why),
    [directory.state, directory.users.length, directory.why],
  )
  const figures = useMemo(
    () => releaseFigures({ users: directory.users, read: dirRead, announceable: appChoices.length, awayFromHome }),
    [directory.users, dirRead, appChoices.length, awayFromHome],
  )

  // EVERY HOOK IS ABOVE THIS LINE.
  if (!user?.isMaster) {
    return (
      <div className="mx-auto max-w-[520px] pt-16">
        <EmptyState
          title="Release Users is the master's tool"
          body="This screen re-arms accounts for the full first-login experience and sends the invite — only the master may use it."
          action={{ label: 'Browse the App Hub', href: '/apps' }}
        />
      </div>
    )
  }

  /** A new person starts with no report — the last one was about somebody else. */
  const pick = (id: string): void => {
    if (id !== selectedId) setReport(null)
    setSelectedId(id)
  }

  /** The card after a press: armed, gate and marks may have changed, so the facts a second press is confirmed against are re-read. */
  const refreshStatus = async (userId: string, failedTitle = 'Released, but the card could not be re-read'): Promise<void> => {
    try {
      await situation.refresh(userId)
    } catch (e) {
      toast({ type: 'warning', title: failedTitle, body: String(e) })
    }
  }

  // ONE PRESS, AND THE ANSWER IS SAID AS ITSELF.
  const doRelease = async (anyway: boolean): Promise<void> => {
    if (!status) return
    const userId = status.user_id
    const payload = anyway
      ? { user_id: userId, anyway: true, press_id: newPressId() }
      : { user_id: userId, press_id: newPressId() }
    try {
      const res = await gasAction<ReleaseResult>('releaseUser', payload, { retry: false })
      directory.markRearmed(userId)
      setReport({ userId, result: res })
      // A 200 means the account WAS rearmed; the toast is only about the message.
      toast({
        type: res.emailed ? (res.warnings?.length ? 'warning' : 'success') : 'warning',
        title: res.emailed
          ? 'Released — invite sent'
          : 'Rearmed — nobody was told the password',
        body: res.emailed
          ? `${status.display_name} gets the full first-login experience on the next sign-in.` +
            (res.warnings?.length ? ` But: ${res.warnings[0]}.` : '')
          : `${status.display_name} has a new temporary password now and was NOT told it: ` +
            (res.held ? `${heldSentence(res.held_reason)}.` : (res.why?.[0] ?? 'nothing left the platform.')),
      })
      await refreshStatus(userId)
    } catch (e) {
      // THE ENVELOPE SURVIVES THE THROW (gasAction) — a refusal that carries the facts must be drawn as those…
      const refusal = readReleaseRefusal(e)
      if (refusal.kind === 'blocked') {
        const data = refusal.report
        setReport({ userId, result: data })
        const go = await askConfirm({
          title: 'The invite could not reach them',
          body:
            `${blockedSentence(data.blocked_by)}, so the letter naming the temporary password cannot ` +
            `reach ${status.display_name}. Nothing has been changed — their own password still ` +
            'works. Fix that and press Release again — or rearm the account anyway, knowing ' +
            'their current password stops working immediately, nobody is told the new one, and ' +
            'they get back in with Forgot password on the sign-in page.',
          confirmLabel: 'Rearm anyway — they will use Forgot password',
          tone: 'danger',
        })
        if (go) await doRelease(true)
        return
      }
      // A REARMED ACCOUNT IS NOT A FAILED RELEASE.
      if (refusal.kind === 'rearmed') {
        directory.markRearmed(userId)
        setReport({ userId, result: refusal.report })
        toast({
          type: 'warning',
          title: 'Rearmed, but nothing could be sent',
          body: refusal.report.why?.[0] ?? (e instanceof Error ? e.message : String(e)),
        })
        await refreshStatus(userId)
        return
      }
      if (refusal.kind === 'rearm_failed') {
        // a rearm that failed says whether every cell was put back — drawn, never guessed
        setReport({ userId, result: refusal.report })
        toast({ type: 'danger', title: 'The release failed', body: refusal.message })
        // it may have left cells behind — the card says what the row holds now
        await refreshStatus(userId, 'The rearm failed, and the card could not be re-read')
        return
      }
      toast({ type: 'danger', title: 'The release failed', body: refusal.message })
    }
  }

  const release = async () => {
    if (!status || busy) return
    // AN ACCOUNT THAT HAS SIGNED IN HAS A PASSWORD OF ITS OWN, and this takes it away.
    const ownPassword = status.signed_in_before || (status.armed && !status.must_change)
    if (
      !(await askConfirm({
        title: `Release ${status.display_name}?`,
        body:
          'The letter naming their login and a fresh temporary password is sent first; only once ' +
          'it has left is the password reset, the change-password gate armed, the last-login ' +
          'record and the welcome marks cleared and every open session ended. Their next sign-in ' +
          'gets the full first-login experience.' +
          (ownPassword
            ? ` ${status.display_name} has signed in before, so the password they chose STOPS WORKING the moment the letter leaves.`
            : '') +
          (status.active ? '' : ' This account is blocked — a release reactivates it.') +
          (status.sending_holds
            ? ` Right now ${blockedSentence(status.blocked_by)} — ` +
              (status.blocked_by === 'opted_out' ? 'unless the text reaches them, ' : '') +
              'the release will be refused and you will be asked again.'
            : (status.test_mode === 'on'
              ? ' Test mode is on: the letter still leaves, because it is a sign-in letter; the text waits for test mode.'
              : '')),
        confirmLabel: 'Release and send the invite',
        tone: ownPassword ? 'danger' : 'primary',
      }))
    ) {
      return
    }
    setBusy(true)
    try {
      await doRelease(false)
    } finally {
      setBusy(false)
    }
  }

  /** The letter run — pages through the backend's time budget until done (releaseReport.ts). */
  const runAnnounce = (title: string, again: boolean): Promise<AnnounceResult> =>
    runAnnouncement(
      (payload) => gasAction<AnnounceResult>('appReleaseAnnounce', payload),
      { app_id: annApp, title, objective: annObjective.trim(), again },
    )

  const announce = async () => {
    if (!annApp || annBusy) return
    const app = appChoices.find((a) => a.id === annApp)
    const title = app?.name || annApp
    if (
      !(await askConfirm({
        title: `Announce ${title}?`,
        body:
          'One text and one letter per person you have released, crossed with access first: only ' +
          'people whose badges open this app are written to, each address once, and nobody a ' +
          'letter already reached hears about it again. It goes through Smart Comms like every ' +
          'other message on this platform, so test mode governs it — while test mode is on, the ' +
          'words are written where you can read them and nobody is contacted. Inside the quiet ' +
          'window it waits for the morning.',
        confirmLabel: 'Send the announcement',
        tone: 'primary',
      }))
    ) {
      return
    }
    setAnnBusy(true)
    setAnnReport(null)
    // THE RE-SEND TO EVERYBODY, asked only when every person it addresses was already told — a press never refuses…
    const resendToAll = async (lead: string) => {
      const resend = await askConfirm({
        title: 'Everybody it addresses was already told',
        body: `${lead} Sending once more writes to every released person whose badges open it, including everybody it already reached.`,
        confirmLabel: 'Send once more',
        tone: 'danger',
      })
      if (!resend) return
      try {
        const out = await runAnnounce(title, true)
        setAnnReport(out)
        const view = announceView(out, true)
        toast({ type: view.toast, title: view.title, body: announceAudience(out, title) })
      } catch (e2) {
        toast({ type: 'danger', title: 'The announcement failed', body: String(e2) })
      }
    }
    try {
      const out = await runAnnounce(title, false)
      setAnnReport(out)
      // Each count in its own words, and a run that stopped before the end of the roster is a warning, never…
      const view = announceView(out)
      toast({ type: view.toast, title: view.title, body: announceAudience(out, title) })
      if (everybodyAlreadyTold(out)) {
        await resendToAll(`Every one of the ${out.eligible} released person/people it addresses was already told about ${title}.`)
      }
    } catch (e) {
      const msg = String(e)
      // an older backend refused a stamped app instead of writing to those not yet told
      if (msg.includes('already announced')) {
        await resendToAll(msg.replace(/^.*Error:\s*/, ''))
      } else {
        toast({ type: 'danger', title: 'The announcement failed', body: msg })
      }
    } finally {
      setAnnBusy(false)
    }
  }

  const flag = (ok: boolean, yes: string, no: string) => (
    <span className={cn('rounded-sm px-2 py-0.5 text-[12px] font-semibold', ok ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-3')}>
      {ok ? yes : no}
    </span>
  )

  return (
    <div className="w-full">
      <PageHeader
        title="Release Users"
        subtitle="Pick a person, rearm their first login, send the invite."
        actions={
          <>
            {(Object.keys(SEQUENCE_LABELS) as SequenceKind[]).map((k) => (
              <button
                key={k}
                onClick={() => { setPreviewKind(k); setPreviewOpen(true) }}
                title={SEQUENCE_LABELS[k].blurb}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <Eye size={14} /> {SEQUENCE_LABELS[k].title}
              </button>
            ))}
          </>
        }
      />

      {/* ── the black header: this screen's own figures, past the master gate ── */}
      <ReleaseUsersHero
        figures={figures}
        loading={directory.state === 'reading'}
        failed={directory.state === 'failed'}
        onRetry={directory.retry}
      />

      {awayFromHome && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-tint-amber bg-tint-amber p-4">
          <Building2 size={18} className="mt-0.5 shrink-0 text-tint-fg-amber" />
          <div>
            <p className="text-[14px] font-semibold text-text-1">You are away from headquarters</p>
            <p className="text-[13px] leading-[22px] text-text-2">
              The directory belongs to the place you are standing in — here it answers only the people of
              this place (likely just you), so the picker looks empty without anything being broken.
              Cross back to ASA LifeCare Ohio to release someone from the company roster.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ---- the person picker ---- */}
        <PersonPicker
          directory={directory}
          query={query}
          onQuery={setQuery}
          selectedId={selectedId}
          onPick={pick}
          locked={busy}
        />

        {/* ---- the situation + the release ---- */}
        <div className="space-y-4">
          <SituationPlaceholder selectedId={selectedId} situation={situation} />

          {status && (
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[20px] font-bold text-text-1">{status.display_name}</p>
                  <p className="text-[13px] text-text-3">{status.email} · {status.role}{franchiseBadgeOf(status)}</p>
                </div>
                <button
                  onClick={release}
                  disabled={busy}
                  className="flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                >
                  <Send size={15} /> {busy ? 'Releasing…' : 'Release'}
                </button>
              </div>

              {/* THE BRAKE IS SAID BEFORE THE BUTTON, NOT INSIDE THE
                  CONFIRMATION. The invite is the only way this person learns
                  the password the press is about to give them; a warning read
                  after the decision is made is not a warning. */}
              {status.sending_holds && (
                <div className="mb-4 flex items-start gap-3 rounded-md border border-tint-amber bg-tint-amber p-3">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0 text-tint-fg-amber" />
                  <div className="text-[13px] leading-[21px] text-text-1">
                    <p>
                      <strong>The letter cannot reach them right now:</strong>{' '}
                      {blockedSentence(status.blocked_by)}.{' '}
                      {status.blocked_by === 'opted_out'
                        ? 'A release goes ahead only if the text reaches them instead; otherwise it is refused'
                        : 'A release is refused while that stands'}{' '}
                      and nothing on the account changes — fix it, or rearm anyway and hand the password
                      over yourself.
                    </p>
                    {!!status.hold_why?.length && (
                      <p className="mt-1 text-text-2">{status.hold_why.join(' · ')}</p>
                    )}
                  </div>
                </div>
              )}
              {!status.sending_holds && status.test_mode === 'on' && (
                <div className="mb-4 flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
                  <MailCheck size={16} className="mt-0.5 shrink-0 text-text-2" />
                  <p className="text-[13px] leading-[21px] text-text-1">
                    <strong>Test mode is on.</strong> The letter still leaves — it is a sign-in letter,
                    and a person locked out cannot be helped by a letter in a mockup. The text waits for
                    test mode like every other message.
                  </p>
                </div>
              )}

              <div className="mb-4 flex flex-wrap gap-2">
                {flag(status.active, 'active', 'inactive — Release reactivates')}
                {flag(status.armed, 'has a password', 'no password yet')}
                {flag(status.must_change, 'gate armed', 'gate not armed')}
                {status.marks ? (
                  <>
                    {flag(status.marks['asa-tour-seen'], 'tour seen', 'tour not seen')}
                    {flag(status.marks['asa-playground-intro-seen'], 'intro seen', 'intro not seen')}
                    {flag(status.marks['asa-myworld-intro-seen'], 'world welcome seen', 'world welcome not seen')}
                  </>
                ) : (
                  <span className="rounded-sm bg-tint-amber px-2 py-0.5 text-[12px] font-semibold text-tint-fg-amber">
                    welcome marks: — {status.marks_error || 'could not be read'}
                  </span>
                )}
                <span className="rounded-sm bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-text-3">
                  last login: {status.last_login ? new Date(status.last_login).toLocaleDateString() : 'never'}
                </span>
              </div>

              <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">Release will clear</p>
              <ul className="mb-4 list-disc space-y-1 pl-5 text-[14px] leading-[24px] text-text-1">
                {status.will_clear.map((w) => <li key={w}>{w}</li>)}
              </ul>

              {report && report.userId === status.user_id && <ReleaseReportCard report={report.result} />}
            </div>
          )}
        </div>
      </div>

      {/* ---- announce an app release ---- */}
      <div className="mt-4 rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <Megaphone size={16} className="text-text-2" />
          <p className="font-display text-[17px] font-bold text-text-1">Announce an app release</p>
        </div>
        <p className="mb-4 text-[13px] leading-[22px] text-text-2">
          One letter per person you have released — crossed with access first: only people whose
          badges open the app receive it, their own denials respected, each address once, and
          nobody a letter already reached is written to again. Badge holders you have not released
          are counted, not written to.
        </p>
        <div className="grid gap-3 md:grid-cols-[240px_1fr_auto]">
          <select
            value={annApp}
            onChange={(e) => {
              const id = e.target.value
              setAnnApp(id)
              // the app's own tagline seeds the objective — but never over words the master typed by hand
              const m = appChoices.find((a) => a.id === id)
              setAnnObjective((cur) =>
                !cur.trim() || appChoices.some((a) => a.tagline === cur) ? (m?.tagline ?? '') : cur)
            }}
            className="h-10 rounded-md border border-border bg-surface-2 px-3 text-[14px] text-text-1 outline-none"
          >
            <option value="">Pick the app…</option>
            {appChoices.map((a) => (
              <option key={a.id} value={a.id}>{a.name || a.id}</option>
            ))}
          </select>
          <textarea
            value={annObjective}
            onChange={(e) => setAnnObjective(e.target.value)}
            rows={2}
            placeholder="Objective — e.g. bring all forms to inside of the platform and digest them and also the data, easy functionality"
            className="min-h-[40px] rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] leading-[22px] text-text-1 outline-none placeholder:text-text-3"
          />
          <button
            onClick={announce}
            disabled={!annApp || annBusy}
            className="flex h-10 items-center gap-2 self-start rounded-md bg-primary px-5 text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            <Send size={15} /> {annBusy ? 'Sending…' : 'Send the announcement'}
          </button>
        </div>
        {annApp && (
          /* never quote the subject here — the `app_release_announced` row owns the words */
          <p className="mt-2 text-[12px] text-text-3">
            The words come from Smart Comms → the <strong>app_release_announced</strong> situation.
            Edit them there and the next announcement uses them — no publish.
          </p>
        )}
        {annReport && (() => {
          // WHAT LEFT, WHAT WAS HELD — BY WHICH BRAKE — AND WHAT WAS REFUSED are separate numbers.
          const view = announceView(annReport)
          return (
          <div
            className={cn(
              'mt-3 rounded-md border p-4',
              view.tone === 'mint'
                ? 'border-tint-mint bg-tint-mint'
                : view.tone === 'info'
                  ? 'border-tint-blue bg-tint-blue'
                  : 'border-tint-amber bg-tint-amber',
            )}
          >
            <p className="flex items-center gap-2 text-[14px] font-semibold text-text-1">
              <MailCheck size={16} className="shrink-0" />
              {view.title}
            </p>
            <p className="mt-1 text-[13px] leading-[22px] text-text-1">{view.parts.join(' · ')}</p>
            <p className="mt-1 text-[13px] leading-[22px] text-text-2">
              {announceAudience(annReport, annReport.title)}
            </p>
          </div>
          )
        })()}
      </div>

      <AnimatePresence>
        {previewOpen && (
          <SequencePreview
            kind={previewKind}
            onClose={() => { setPreviewOpen(false); setPreviewKind(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
