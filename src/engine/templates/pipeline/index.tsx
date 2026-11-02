// `pipeline` template (page-types.md §3) — vertical funnel kanban.
// Stages stack downward (top = funnel entry) with a sticky scroll-spy rail, a funnel summary strip (counts +…
import { SummaryStrip } from '@/engine/templates/sheet/SummaryStrip'
import type { SummaryStripConfig } from '@/engine/templates/sheet/types'
import { unwiredAction } from '@/engine/templates/unwired'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePhases } from '@/stores/useFlowPhasesStore'
import { useNavigate } from 'react-router'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import { ohioDateTime, ohioDayYear } from '@/lib/ohio'
import { formatPhoneDisplay, formatPhoneE164 } from '@/lib/phoneFormat'
import PageHeader from '@/components/shared/PageHeader'
import StartOnboardingModal from '@/features/onboarding/StartOnboardingModal'
import AddCandidateModal from '@/features/hiring/AddCandidateModal'
import ResumeInboxModal from '@/features/hiring/ResumeInboxModal'
import CjisFolderModal from '@/features/hiring/CjisFolderModal'
import ResumeIntakeModal from '@/features/hiring/ResumeIntakeModal'
import InterviewScorecardModal from '@/features/hiring/InterviewScorecardModal'
import OnboardingDocsModal from '@/features/hiring/OnboardingDocsModal'
import ResumeUploadModal from '@/features/hiring/ResumeUploadModal'
import CjisUploadModal from '@/features/hiring/CjisUploadModal'
import ScreenFormModal from '@/features/hiring/ScreenFormModal'
import { gasAction, noteActionWrite } from '@/features/hiring/shared'
import { api, asBackground } from '@/lib/api'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { useAvatarPrefsStore } from '@/stores/useAvatarPrefsStore'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { AppIcon } from '@/lib/icons'
import { useCan } from '@/auth'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Permission } from '@/auth/types'
import { runConfigAction, type ConfigAction } from '@/engine/configActions'
import { roleCanUseAction, roleSignsOutAfter, SIGN_OUT_AFTER_DELAY_MS } from '@/lib/roleAccess'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { clearSeatLocally, releaseSeat } from '@/lib/seat'
import { docIdFor } from '@/lib/onboardingDocs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ChecklistItem, ChecklistStatus, Stage } from './types'
import { bandContainer } from './utils'
import { PipelineCard } from './PipelineCard'
import { StageBand } from './StageBand'
import { FunnelStrip } from './FunnelStrip'
import { CandidatePanel } from './CandidatePanel'
import { EditCandidateModal } from './EditCandidateModal'
import { SourceModal } from './SourceModal'
import { ManualScreenModal } from './ManualScreenModal'
import { ManualOnboardingModal } from './ManualOnboardingModal'
import { PacketAttachModal } from './PacketAttachModal'
import { exportPipelineCSV, exportPipelineExcel, exportPipelineText } from './exportCandidates'

// Write-ledger envelope from the /gas relay — the WRITE was accepted (queued for delivery, or executed with its…
const accepted = (d: any) => d && typeof d === 'object' && d.accepted === true

export default function PipelineTemplate({ config, data, schema }: TemplateProps) {
  // THE HIRING BOARD OBEYS FLOW ADMIN; EVERY OTHER BOARD DOES NOT.
  const phases = usePhases()
  const stages = useMemo(() => {
    const declared = (config.stages ?? []) as Stage[]
    if (schema.dataSource?.resource !== 'candidates') return declared
    return declared.map((s) => {
      const label = phases.label[s.id]
      const tint = phases.tint[s.id]
      return label || tint ? { ...s, label: label || s.label, tint: tint || s.tint } : s
    })
  }, [config.stages, schema.dataSource?.resource, phases])
  const stageField = config.stageField as string
  // WHICH COLUMN A ROW BELONGS IN, when the stored field is not the answer A board keys on one column of the row…
  const summaryStrip = config.summaryStrip as SummaryStripConfig | undefined
  const stageFrom = config.stageFrom as ((row: any) => string) | undefined
  const stageOf = useCallback(
    (rec: any) => String((stageFrom ? stageFrom(rec) : rec?.[stageField]) ?? ''),
    [stageFrom, stageField],
  )
  const fields = config.cardFields as any
  const checklistKey = fields?.checklist?.key as string | undefined
  const canEdit = useCan('hiring.edit')
  // Manual "Date accepted" — its own configurable access (Settings → Access control → Hiring), independent of…
  const isAdmin = useCan('apps.manage')
  const [editDetailsOpen, setEditDetailsOpen] = useState(false)
  const [usingLast, setUsingLast] = useState(false)
  // the interviewer records the scorecard; recruiters/admins may too which header controls this role may even see…
  const role = useAuthStore((s) => s.user?.role)
  // The scorecard belongs to the interviewer's own login — `canEdit` is gone from here on purpose.
  const userTypes = useAuthStore((st) => st.user?.types)
  const canScoreInterview = useCan('hiring.interview') || role === 'interviewer' ||
    (userTypes ?? []).some((t) => t === 'HM' || t === 'INTERVIEWER')
  // The master may LOOK at the scorecard (the modal turns read-only from the server's can_record) — never lent to a…
  const isMaster = useEffectiveIsMaster()
  const showPrimary = roleCanUseAction(role, 'primary')
  const showSecondary = roleCanUseAction(role, 'secondary')
  const showFilter = roleCanUseAction(role, 'filter')
  // one-shot session: signing the scorecard is the whole visit for the day-of interviewer, so the shell signs them…
  const signOutAfterScorecard = roleSignsOutAfter(role, 'interview-scorecard')
  const userId = useAuthStore((s) => s.user?.id)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  // Live board: creates/uploads go through the Hub actions (modals below); stage moves and the remaining…
  const liveReadOnly = useApiConfigStore((s) => s.driver) === 'apps-script'
  const readOnlyToast = () =>
    toast({
      type: 'info',
      title: 'Not writable yet',
      body: 'Stage moves and decision checkpoints arrive in an upcoming build.',
    })
  const openDetail = useDetailPanelStore((s) => s.openDetail)
  const [records, setRecords] = useState<any[]>(data)

  // The board FOLLOWS the turnover: a fresher `data` prop (a new slice landed and PageRenderer re-served) replaces…
  useEffect(() => {
    setRecords(data)
  }, [data])

  // Use The Last — the test loop (admin only): a PURE reset of THIS card's screening.
  const useTheLast = async () => {
    if (!panelRec || usingLast) return
    setUsingLast(true)
    try {
      const r = await gasAction<{ reset: boolean; retired: number; message?: string }>(
        'screenUseLast', { candidate_id: String(panelRec.id) },
      )
      const key = checklistKey ?? 'checklist'
      const resetIds = new Set(['transcript', 'ai-report', 'screen-details', 'advance-decision'])
      const next = ((panelRec[key] ?? []) as ChecklistItem[]).map((i) =>
        resetIds.has(i.id) ? { ...i, status: 'pending' as ChecklistStatus, meta: '' } : i,
      )
      patchLocal(panelRec.id, { [key]: next })
      toast({ type: 'info', title: 'Screening reset', body: r.message ?? 'Make a fresh call on the line — it attaches on its own.' })
    } catch (err) {
      toast({ type: 'danger', title: 'Use The Last failed', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setUsingLast(false)
    }
  }

  // Force Error — the mock twin: fills the test card's screening EXCEPT the advance decision, fires the REAL error…
  const [forcingError, setForcingError] = useState(false)
  const [manualScreenOpen, setManualScreenOpen] = useState(false)
  const [manualOnboardingOpen, setManualOnboardingOpen] = useState(false)
  const [attachPacketOpen, setAttachPacketOpen] = useState(false)
  const forceError = async () => {
    if (!panelRec || forcingError) return
    setForcingError(true)
    try {
      const r = await gasAction<{ forced: boolean; alerted: boolean; message?: string }>(
        'screenForceError', { candidate_id: String(panelRec.id) },
      )
      const key = checklistKey ?? 'checklist'
      const next = ((panelRec[key] ?? []) as ChecklistItem[]).map((i) => {
        if (i.id === 'transcript' || i.id === 'ai-report' || i.id === 'screen-details')
          return { ...i, status: 'done' as ChecklistStatus }
        if (i.id === 'advance-decision')
          return { ...i, status: 'pending' as ChecklistStatus, meta: '' }
        return i
      })
      patchLocal(panelRec.id, { [key]: next })
      if (accepted(r)) {
        // Write-ledger envelope: the force is in (queued or the receipt was lost) — alerted/message never arrived…
        void refetchRec(String(panelRec.id))
        toast({ type: 'warning', title: 'Error lane fired', body: 'Accepted — the card follows the sheet.' })
        return
      }
      toast({
        type: r.alerted ? 'warning' : 'danger',
        title: r.alerted ? 'Error lane fired — team alerted' : 'Populated, but the alert could not send',
        body: r.message,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'Force Error failed', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setForcingError(false)
    }
  }
  const [panelRec, setPanelRec] = useState<any | null>(null)
  // onboarding-v2: `primaryAction.modal === 'start-onboarding'` opens the Start Onboarding Manual modal instead of…
  const [manualOpen, setManualOpen] = useState(false)
  // hiring-v3: real Add Candidate + live resume/CJIS upload modals (talent intake endpoints); all other live writes…
  const [addOpen, setAddOpen] = useState(false)
  // The stage + opens the same form WITH the New Hire packet field.
  const [addWithPacket, setAddWithPacket] = useState(false)
  // …and remembers WHICH band it was, so the placement can match the click.
  const [addStage, setAddStage] = useState<string | undefined>(undefined)
  const [resumeIntakeOpen, setResumeIntakeOpen] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false)
  /** The FOLDER, not the per-candidate upload — `cjisOpen` below is that one. */
  const [cjisFolderOpen, setCjisFolderOpen] = useState(false)
  const [resumeOpen, setResumeOpen] = useState(false)
  const [cjisOpen, setCjisOpen] = useState(false)
  const [screenOpen, setScreenOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draggingStageId, setDraggingStageId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sortDesc, setSortDesc] = useState<Set<string>>(new Set())
  const [sortAlpha, setSortAlpha] = useState<Set<string>>(new Set())
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeStage, setActiveStage] = useState<string>(stages[0]?.id ?? '')
  const [announcement, setAnnouncement] = useState('')
  const prevRef = useRef<any[]>(data)

  // Card row actions — the frozen ConfigAction vocabulary (config.rowActions), rendered on each card through the…
  const rowActions = useMemo(() => (config.rowActions ?? []) as ConfigAction[], [config.rowActions])
  const authUser = useAuthStore((s) => s.user)
  const authCan = useAuthStore((s) => s.can)
  const canDoAction = (perm?: string) => !perm || authCan(authUser, perm as Permission)
  const runCardAction = (a: ConfigAction, rec: Record<string, unknown>) =>
    void runConfigAction(a, rec, { resource: schema.dataSource.resource })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // press-and-hold to drag cards on touch, so page scrolling stays free
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  // Per-user icon-avatar overrides (drawer TilePicker) — applied to the view only; the underlying records (mock or…
  const avatarPrefs = useAvatarPrefsStore((s) => s.prefs)
  const setAvatarPref = useAvatarPrefsStore((s) => s.setAvatar)
  const avatarKey = fields?.avatar as string | undefined
  const viewRecords = useMemo(() => {
    if (!avatarKey) return records
    return records.map((r) => {
      const p = avatarPrefs[r.id]
      return p ? { ...r, [avatarKey]: `icon:${p.icon}:${p.tint}` } : r
    })
  }, [records, avatarPrefs, avatarKey])

  const headerFilter = config.headerFilter as { key: string; label: string; options: string[] } | undefined

  // WHAT A TYPED WORD IS COMPARED AGAINST.
  const matchesQuery = useCallback(
    (rec: any, needle: string) => {
      const phone = rec?.phone ?? rec?.mobile
      const stageLabel = stages.find((s) => s.id === stageOf(rec))?.label
      return [
        fields?.title ? rec?.[fields.title] : undefined,
        fields?.subtitle ? rec?.[fields.subtitle] : undefined,
        rec?.name,
        rec?.email,
        rec?.city,
        phone,
        phone ? formatPhoneE164(String(phone)) : undefined,
        phone ? formatPhoneDisplay(phone) : undefined,
        stageLabel,
      ].some((v) => v != null && v !== '' && String(v).toLowerCase().includes(needle))
    },
    [fields, stages, stageOf],
  )

  // ONE NARROWING FOR THE WHOLE BOARD — typing filters by ONLY what is on the hiring screen.
  const filtered = useMemo(() => {
    const byRole = roleFilter && headerFilter
      ? viewRecords.filter((r) => String(r[headerFilter.key]) === roleFilter)
      : viewRecords
    const needle = query.trim().toLowerCase()
    if (!needle) return byRole
    return byRole.filter((r) => matchesQuery(r, needle))
  }, [viewRecords, roleFilter, headerFilter, query, matchesQuery])

  const byStage = useMemo(() => {
    const map = new Map<string, any[]>()
    stages.forEach((s) => map.set(s.id, []))
    filtered.forEach((r) => map.get(stageOf(r))?.push(r))
    return map
  }, [filtered, stages, stageOf])

  // A STAGE WITH NO MATCH LEAVES THE SCREEN WHILE SOMETHING IS TYPED — the lines that do not match the person…
  const searching = query.trim().length > 0
  const visibleStages = useMemo(
    () => (searching ? stages.filter((s) => (byStage.get(s.id)?.length ?? 0) > 0) : stages),
    [searching, stages, byStage],
  )

  // keep the open detail panel in sync with optimistic record updates (viewRecords so avatar-pref changes reflect…
  useEffect(() => {
    if (!panelRec) return
    const fresh = viewRecords.find((r) => r.id === panelRec.id)
    if (fresh && fresh !== panelRec) setPanelRec(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRecords])

  // scroll-spy: highlight the rail dot of the stage in the viewport
  useEffect(() => {
    const scroller = document.getElementById('main-scroll')
    if (!scroller) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveStage(e.target.id.replace('stage-', ''))
        }
      },
      { root: scroller, rootMargin: '-92px 0px -60% 0px', threshold: 0 },
    )
    stages.forEach((s) => {
      const el = document.getElementById(`stage-${s.id}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [stages])

  // Stage move = stage field + reset aging + checklist growth: items from `config.checklistPlan[target]` are…
  const buildMovePatch = (rec: any, targetStageId: string): { patch: Record<string, any>; added: number } => {
    const plan: any[] = (config.checklistPlan as any)?.[targetStageId] ?? []
    const completes: string[] = (config.advanceCompletes as string[]) ?? []
    const patch: Record<string, any> = { [stageField]: targetStageId, daysInStage: 0 }
    const cur: ChecklistItem[] = Array.isArray(rec.checklist) ? rec.checklist : []
    const existing = new Set(cur.map((i) => i.id))
    const additions: ChecklistItem[] = plan
      .filter((p) => !existing.has(p.id))
      .map((p) => ({ id: p.id, label: p.label, owner: p.owner, status: p.status ?? 'pending', stage: targetStageId, upload: p.upload }))
    if (cur.length > 0 || additions.length > 0) {
      const grown = cur.map((i) =>
        completes.includes(i.id) && i.status !== 'auto' && i.status !== 'done' ? { ...i, status: 'done' as ChecklistStatus } : i,
      )
      patch.checklist = [...grown, ...additions]
    }
    return { patch, added: additions.length }
  }

  /** Optimistic local patch + persist (no rollback — used for non-drag edits). */
  const patchRecord = (id: string, patch: Record<string, any>) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    api.update(schema.dataSource.resource, id, patch).catch(() => {
      toast({ type: 'danger', title: 'Update failed', body: 'Could not save changes.' })
    })
  }

  // LOCAL-ONLY patch — no api.update: the live candidates resource rejects writes (governed sheet + work engine are…
  const patchLocal = (id: string, patch: Record<string, any>) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  // Re-read ONE candidate from the server and swap the record in place — the same replace the screening watch does…
  const refetchRec = async (id: string) => {
    try {
      const fresh = await api.get<any>('candidates', String(id))
      if (!fresh) return
      setRecords((rs) => rs.map((r) => (String(r.id) === String(id) ? fresh : r)))
      setPanelRec((p: any) => (p && String(p.id) === String(id) ? fresh : p))
    } catch {
      /* keep what we have — the sheet re-sync confirms it */
    }
  }

  // ONE live move for every control that moves somebody.
  const adoptAlreadyAt = (rec: any, err: unknown): boolean => {
    const at = (err as { envelope?: { already_at?: unknown } })?.envelope?.already_at
    const stageId = typeof at === 'string' ? at : ''
    if (!stageId || !stages.some((s) => s.id === stageId)) return false
    const label = stages.find((s) => s.id === stageId)?.label ?? stageId
    if (stageOf(rec) !== stageId) {
      patchLocal(rec.id, { [stageField]: stageId })
      noteWrite('candidates')
    }
    setAnnouncement(`${rec[fields.title]} is at ${label}`)
    toast({
      type: 'info',
      title: `${rec[fields.title]} is already at ${label}`,
      body: 'The board was behind — it has been corrected.',
    })
    return true
  }

  const liveMove = async (rec: any, targetId: string, targetLabel: string) => {
    try {
      const res = await gasAction<any>('moveStage', { candidate_id: rec.id, to_stage: targetId })
      if (accepted(res)) {
        // Queued: the gate was never evaluated, so painting the move as done would lie if the server later refuses.
        await refetchRec(String(rec.id))
        toast({ type: 'success', title: 'Move recorded', body: 'The board follows the sheet.' })
        return
      }
      const { patch } = buildMovePatch(rec, targetId)
      patchLocal(rec.id, patch)
      noteWrite('candidates', { id: String(rec.id), row: { ...rec, ...patch } })
      setAnnouncement(`${rec[fields.title]} moved to ${targetLabel}`)
      toast({ type: 'success', title: `${rec[fields.title]} → ${targetLabel}` })
    } catch (err) {
      if (adoptAlreadyAt(rec, err)) return
      toast({ type: 'danger', title: 'Move blocked', body: err instanceof Error ? err.message : 'Try again.' })
    }
  }

  /** Card menu "Move to next stage" — advance + grow checklist (gated). */
  const advanceRec = (rec: any) => {
    const idx = stages.findIndex((s) => s.id === stageOf(rec))
    const target = stages[idx + 1]
    if (!target) {
      toast({ type: 'info', title: 'Already at the final stage', body: `${rec[fields.title]} is in ${stages[idx]?.label ?? 'the last stage'}.` })
      return
    }
    if (!canEdit) {
      toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
      return
    }
    if (liveReadOnly) {
      void liveMove(rec, target.id, target.label)
      return
    }
    const { patch, added } = buildMovePatch(rec, target.id)
    patchRecord(rec.id, patch)
    setAnnouncement(`${rec[fields.title]} moved to ${target.label}`)
    toast({
      type: 'success',
      title: `${rec[fields.title]} → ${target.label}`,
      body: added ? `Checklist grew by ${added} item${added === 1 ? '' : 's'} — see the detail panel.` : undefined,
    })
  }

  // Detail-panel "Upload" ghost button.
  const uploadItem = (item: ChecklistItem) => {
    // Onboarding paperwork — the same checklist ids in both pipelines (this board's onboarding stage and the…
    if (liveReadOnly && docIdFor(item.id)) {
      if (!canEdit) {
        toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
        return
      }
      if (!panelRec) return
      setDocsOpen(true)
      return
    }
    if (liveReadOnly && (item.id === 'resume' || item.id === 'cjis')) {
      if (!canEdit) {
        toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
        return
      }
      if (!panelRec) return
      if (item.id === 'resume') setResumeOpen(true)
      else setCjisOpen(true)
      return
    }
    if (liveReadOnly) {
      readOnlyToast()
      return
    }
    if (!canEdit || !panelRec) return
    const key = checklistKey ?? 'checklist'
    const next = (panelRec[key] ?? []).map((i: ChecklistItem) => (i.id === item.id ? { ...i, status: 'done' as ChecklistStatus } : i))
    patchRecord(panelRec.id, { [key]: next })
    toast({ type: 'success', title: `${item.label} uploaded`, body: `${panelRec[fields.title]} · document checklist updated.` })
  }

  // Decision checkpoints (resume-decision / advance-decision) — the Hub's cloned gate evidence.
  const extendOnboarding = async () => {
    if (!panelRec) return
    try {
      const res = await gasAction<{ until?: string }>('onboardingExtend', {
        candidate_id: panelRec.id,
        days: 7,
      })
      noteActionWrite('onboardingExtend')
      toast({
        type: 'success',
        title: 'Onboarding reopened',
        body: res?.until
          ? `They can finish in the portal until ${ohioDayYear(String(res.until))}.`
          : 'They can finish in the portal again.',
      })
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not extend',
        body: err instanceof Error ? err.message : 'Try again.',
      })
    }
  }

  // The shareable form link: minted server-side (a personal HMAC — CandidateForm.gs), copied to the clipboard.
  const shareFormLink = async () => {
    if (!panelRec) return
    try {
      const res = await gasAction<{ url: string }>('candShareLink', { candidate_id: panelRec.id })
      const url = String(res?.url ?? '')
      if (!url) throw new Error('The link did not arrive.')
      try {
        await navigator.clipboard.writeText(url)
        toast({ type: 'success', title: 'Share link copied', body: 'Anyone with it sees this candidate and can decide.' })
      } catch {
        // No clipboard (permissions, http) — the link still reaches the hand.
        toast({ type: 'info', title: 'Share link', body: url })
      }
    } catch (err) {
      toast({ type: 'danger', title: 'Could not mint the link', body: err instanceof Error ? err.message : 'Try again.' })
    }
  }

  // ONE PRESS PER CANDIDATE IN FLIGHT.
  const decidingRef = useRef<Record<string, true>>({})
  const [deciding, setDeciding] = useState<Record<string, 'Advance' | 'Decline'>>({})

  // true when the backend took the decision, false when it refused — the panel's form keeps its field open on false…
  const decideCheckpoint = async (item: ChecklistItem, value: 'Advance' | 'Decline'): Promise<boolean> => {
    if (!panelRec) return false
    const rec = panelRec
    const recId = String(rec.id)
    if (decidingRef.current[recId]) {
      toast({ type: 'info', title: 'Still recording the last press',
              body: `${rec[fields.title]}'s decision is on its way — one press is enough.` })
      return false
    }
    decidingRef.current[recId] = true
    setDeciding((d) => ({ ...d, [recId]: value }))
    try {
      const res = await gasAction<{
        value: string
        declined: boolean
        gate_passed: boolean
        to_stage?: string
        missing?: string[]
        /** Set when the server ALSO moved the candidate (green gate). */
        moved_to?: string | null
      }>('setDecision', { candidate_id: rec.id, checkpoint: item.id, value })
      if (accepted(res)) {
        // The relay's "still running" envelope: the decision was delivered but declined / gate_passed / moved_to…
        await refetchRec(String(rec.id))
        toast({ type: 'info', title: `${item.label}: ${value}`,
                body: 'Sent — the platform is still answering; the card follows the sheet.' })
        return true
      }
      if (res.declined) {
        setRecords((rs) => rs.filter((r) => r.id !== rec.id))
        setPanelRec(null)
        // Without this the declined person RESURRECTS on any reload inside the slice window (review).
        noteWrite('candidates', { id: String(rec.id), removed: true })
        toast({ type: 'info', title: `${rec[fields.title]} declined`, body: 'Moved to Not Hiring — off the board.' })
        return true
      }
      const key = checklistKey ?? 'checklist'
      const next = ((rec[key] ?? []) as ChecklistItem[]).map((i) =>
        i.id === item.id ? { ...i, status: 'done' as ChecklistStatus } : i,
      )
      // The server may have MOVED the candidate as part of this decision (phone screen fully green → Interview…
      if (res.moved_to) {
        const target = stages.find((s) => s.id === res.moved_to)
        const { patch } = buildMovePatch(rec, res.moved_to)
        patchLocal(rec.id, { ...patch, [key]: next })
        noteWrite('candidates', { id: String(rec.id), row: { ...rec, ...patch, [key]: next } })
        setAnnouncement(`${rec[fields.title]} moved to ${target?.label ?? res.moved_to}`)
        toast({
          type: 'success',
          title: `${rec[fields.title]} → ${target?.label ?? res.moved_to}`,
          body: 'Phone screen complete — the in-person interview is scheduled.',
        })
        return true
      }
      patchLocal(rec.id, { [key]: next })
      noteWrite('candidates', { id: String(rec.id), row: { ...rec, [key]: next } })
      // An Advance that did not open the gate says WHY, on the screen of the person who pressed — a green "Advance"…
      toast(
        res.gate_passed
          ? { type: 'success', title: 'Gate passed', body: 'Move to the next stage is unlocked.' }
          : value === 'Advance'
            ? { type: 'warning', title: `${item.label}: Advance recorded`,
                body: `Still at this stage — missing: ${(res.missing ?? []).join(', ') || 'a step the gate names'}.` }
            : { type: 'success', title: `${item.label}: ${value}` },
      )
      return true
    } catch (err) {
      // "Already at Interview": the first press landed and this screen is behind — the card follows the server…
      if (adoptAlreadyAt(rec, err)) return false
      // Another press for this person is still being recorded (another tab, another recruiter): not a failure, and…
      if ((err as { envelope?: { busy?: unknown } })?.envelope?.busy) {
        toast({ type: 'info', title: 'Already being recorded',
                body: err instanceof Error ? err.message : 'Another decision for this person is on its way.' })
        void refetchRec(recId)
        return false
      }
      toast({ type: 'danger', title: 'Decision failed', body: err instanceof Error ? err.message : 'Try again.' })
      return false
    } finally {
      delete decidingRef.current[recId]
      setDeciding((d) => {
        const next = { ...d }
        delete next[recId]
        return next
      })
    }
  }

  // REAL-TIME screening watch.
  const [liveScreen, setLiveScreen] = useState<
    | { state: 'waiting' }
    | { state: 'ready'; qualification?: string; score?: string | number; summary?: string; best?: string }
    | null
  >(null)
  const panelStage = panelRec ? stageOf(panelRec) : undefined
  const panelId = panelRec?.id
  // A captured result banner must die with its candidate — it used to survive into the NEXT card opened (review).
  useEffect(() => {
    setLiveScreen(null)
  }, [panelId])
  const checklistItems = (panelRec?.[checklistKey ?? 'checklist'] ?? []) as ChecklistItem[]
  const transcriptDone = checklistItems.some((i) => i.id === 'transcript' && i.status !== 'pending')

  useEffect(() => {
    if (!liveReadOnly || !canEdit || !panelId || panelStage !== 'phone-screen' || transcriptDone) {
      // Do NOT wipe a result the recruiter is reading: capturing a call greens the transcript checkpoint, which…
      setLiveScreen((prev) => (prev?.state === 'ready' && transcriptDone ? prev : null))
      return
    }
    let alive = true
    let ticks = 0
    setLiveScreen({ state: 'waiting' })
    const tick = async () => {
      // deep = a real (bounded) scan: first tick, then every 3 minutes
      const deep = ticks === 0 || ticks % 9 === 0
      ticks += 1
      try {
        const res = await gasAction<{
          state: string
          qualification?: string
          score?: string | number
          summary?: string
          analyzed?: boolean
          best_in_person_day_time?: string
        }>('screenWatch', { candidate_id: panelId, deep }, { timeoutMs: 60000 })
        if (!alive) return
        if (res.state !== 'ready') {
          // A deep tick is sheet truth.
          if (deep) {
            try {
              const fresh = await asBackground(() => api.get<any>('candidates', String(panelId)))
              if (!alive || !fresh) return
              setRecords((rs) => rs.map((r) => (String(r.id) === String(panelId) ? fresh : r)))
              setPanelRec((p: any) => (p && String(p.id) === String(panelId) ? fresh : p))
            } catch {
              /* keep what we have — the next deep tick retries */
            }
          }
          return
        }
        setLiveScreen({
          state: 'ready',
          qualification: res.qualification,
          score: res.score,
          summary: res.summary,
          best: res.best_in_person_day_time,
        })
        // green the phone-screen checkpoints in place — the AI report only when the server actually produced one…
        const key = checklistKey ?? 'checklist'
        const applyGreens = (items: ChecklistItem[]) =>
          items.map((i) =>
            i.id === 'transcript'
              ? { ...i, status: 'auto' as ChecklistStatus }
              : i.id === 'ai-report' && res.analyzed !== false
                ? { ...i, status: 'auto' as ChecklistStatus }
                : i.id === 'screen-details'
                  ? { ...i, status: 'done' as ChecklistStatus }
                  : i,
          )
        setRecords((rs) =>
          rs.map((r) =>
            String(r.id) === String(panelId) ? { ...r, [key]: applyGreens((r[key] ?? []) as ChecklistItem[]) } : r,
          ),
        )
        setPanelRec((p: any) =>
          p && String(p.id) === String(panelId) ? { ...p, [key]: applyGreens((p[key] ?? []) as ChecklistItem[]) } : p,
        )
        toast({
          type: 'success',
          title: 'Screening call captured',
          body: `${res.qualification ?? 'Analyzed'}${res.score !== undefined && res.score !== '' ? ` · ${res.score}/10` : ''}${res.best_in_person_day_time ? ` · in-person ${res.best_in_person_day_time}` : ''}`,
        })
      } catch {
        /* transient — the next tick retries */
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 20000)
    // a screening call does not run for 15 minutes — stop watching then (reopening the drawer starts a fresh watch)
    const stop = setTimeout(() => {
      alive = false
      clearInterval(id)
      setLiveScreen(null)
    }, 900000)
    return () => {
      alive = false
      clearInterval(id)
      clearTimeout(stop)
    }
  }, [liveReadOnly, canEdit, panelId, panelStage, transcriptDone, checklistKey])

  // Transcript checkpoint "Pull call" — fetches the candidate's latest real call from the Hub's own Comms sheet…
  const [pullingTranscript, setPullingTranscript] = useState(false)
  // interviewer's in-person scorecard (interview stage)
  const [scorecardOpen, setScorecardOpen] = useState(false)
  // onboarding paperwork (documents + certificates), shared with the tracker
  const [docsOpen, setDocsOpen] = useState(false)
  // One-shot account: the scorecard is recorded, the modal animates out and the session ends — no interview-room…
  const endInterviewerSession = () => {
    setPanelRec(null) // the drawer closes now, not after the delay
    window.setTimeout(() => {
      // while the token is still good: release, then sign out
      void releaseSeat({ flow: 'interview', userId, completed: true }).finally(() => {
        logout()
        // second wipe on purpose — anything the board re-cached between the release and the sign-out goes with it
        clearSeatLocally(userId)
        toast({
          type: 'info',
          title: 'Signed out',
          body: 'Your scorecard was recorded — thanks for running the interview.',
        })
        navigate('/', { replace: true })
      })
    }, SIGN_OUT_AFTER_DELAY_MS)
  }
  const pullTranscript = async (item: ChecklistItem) => {
    if (!panelRec) return
    const rec = panelRec
    setPullingTranscript(true)
    try {
      const res = await gasAction<{ created?: string; chars?: number; has_summary?: boolean }>(
        'screenPullTranscript',
        { candidate_id: rec.id },
        { timeoutMs: 45000 },
      )
      const key = checklistKey ?? 'checklist'
      const next = ((rec[key] ?? []) as ChecklistItem[]).map((i) =>
        i.id === item.id ? { ...i, status: 'auto' as ChecklistStatus } : i,
      )
      patchLocal(rec.id, { [key]: next })
      toast({
        type: 'success',
        title: 'Transcript on file',
        body: `Latest call pulled${res.created ? ` · ${ohioDateTime(String(res.created))}` : ''}${res.chars ? ` · ${res.chars} chars` : ''}${res.has_summary ? ' · summary attached' : ''}. AI analysis will use it.`,
      })
    } catch (err) {
      toast({ type: 'danger', title: 'No transcript pulled', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setPullingTranscript(false)
    }
  }

  /** Drawer "Move to next stage" — the GAS enforces the cloned stage gate. */
  const moveToNext = async () => {
    if (!panelRec) return
    const rec = panelRec
    const idx = stages.findIndex((s) => s.id === stageOf(rec))
    const target = stages[idx + 1]
    if (!target) return
    try {
      const res = await gasAction<any>('moveStage', { candidate_id: rec.id, to_stage: target.id })
      if (accepted(res)) {
        // Queued: the GATE was never validated — painting the move as done would lie if the server later refuses…
        await refetchRec(String(rec.id))
        toast({ type: 'success', title: 'Move recorded', body: 'The board follows the sheet.' })
        return
      }
      const { patch } = buildMovePatch(rec, target.id)
      patchLocal(rec.id, patch)
      noteWrite('candidates', { id: String(rec.id), row: { ...rec, ...patch } })
      setAnnouncement(`${rec[fields.title]} moved to ${target.label}`)
      toast({ type: 'success', title: `${rec[fields.title]} → ${target.label}` })
    } catch (err) {
      if (adoptAlreadyAt(rec, err)) return
      toast({ type: 'danger', title: 'Move blocked', body: err instanceof Error ? err.message : 'Try again.' })
    }
  }

  // Name/avatar → the candidate's full profile page.
  const profileLinked = liveReadOnly && schema.dataSource.resource === 'candidates'
  const openProfile = (rec: any) =>
    navigate('/app/hiring/candidate?id=' + encodeURIComponent(String(rec.candidateId ?? rec.id)))

  // The source chip → WHO IS BEHIND IT: clicking Direct shows the modal with the details of whoever made that…
  const sourceChipLinked = schema.dataSource.resource === 'candidates'
  const [sourceChip, setSourceChip] = useState<{ rec: any; tag: string } | null>(null)

  // THE LAST GESTURE — "Start activities" (moved onto this board so the Flow board can be deleted).
  const [starting, setStarting] = useState('')
  const startLinked = sourceChipLinked && canEdit
  const startActivities = async (rec: any) => {
    setStarting(String(rec.id))
    try {
      await gasAction('hiredStart', { candidate_id: rec.id })
      toast({ type: 'success', title: `${rec[fields.title] ?? 'They'} started`, body: 'The card left the board — they are in Users from here.' })
      // the row is gone from the slice now; the board must re-read rather than keep drawing a card the sheet no…
      invalidate('candidates')
      noteWrite('candidates')
    } catch (e) {
      toast({ type: 'danger', title: 'Not started', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setStarting('')
    }
  }

  /** Records with a checklist open in the pipeline-owned slide-over; others fall back to the global DetailPanel. */
  const openCard = (rec: any) => {
    if (checklistKey && Array.isArray(rec[checklistKey])) {
      setPanelRec(rec)
    } else if (config.detailPanel) {
      openDetail({ config: config.detailPanel as Record<string, unknown>, record: rec })
    }
  }

  const onDragStart = (e: DragStartEvent) => {
    prevRef.current = records
    setActiveId(String(e.active.id))
    setDraggingStageId((e.active.data.current as any)?.stageId ?? null)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    setDraggingStageId(null)
    const target = e.over?.id ? String(e.over.id) : null
    if (!target || !stages.some((s) => s.id === target)) return
    const id = String(e.active.id)
    const rec = records.find((r) => r.id === id)
    if (!rec || rec[stageField] === target) return
    if (!canEdit) {
      toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin', body: 'You can browse the pipeline, but only recruiters can move candidates.' })
      return
    }
    if (liveReadOnly) {
      void liveMove(rec, target, stages.find((s2) => s2.id === target)?.label ?? target)
      return
    }
    const stageLabel = stages.find((s) => s.id === target)?.label ?? target
    const { patch, added } = buildMovePatch(rec, target)
    // optimistic update
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setAnnouncement(`${rec[fields.title]} moved to ${stageLabel}`)
    toast({
      type: 'success',
      title: `${rec[fields.title]} moved to ${stageLabel}`,
      body: added ? `Checklist grew by ${added} item${added === 1 ? '' : 's'}.` : undefined,
    })
    api.update(schema.dataSource.resource, id, patch).catch(() => setRecords(prevRef.current))
  }

  const activeRec = activeId ? viewRecords.find((r) => r.id === activeId) : null
  const emptyText = (config.stageEmptyText as string) ?? 'Nothing here yet — drag a card in.'

  return (
    <div className="w-full">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <PageHeader
        title={config.title ?? schema.title}
        subtitle={`${records.length} ${(config.entity as string) ?? 'records'} · ${stages.length} stages`}
        // set by whoever MOUNTS this board as a view of their own page — see PageHeader's `inset`
        inset={config.headerInsetRight === true}
        actions={
          <>
            {showSecondary && (config.secondaryActions ?? []).map((a: any) =>
              // Export is real: everyone on the board, where they are and what is known about them.
              a.id === 'export' ? (
                <DropdownMenu key="export">
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]">
                      {a.icon && <AppIcon name={a.icon} size={15} />}
                      {a.label}
                      <ChevronDown size={14} className="text-text-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        exportPipelineExcel(filtered, stages, stageField)
                        toast({ type: 'success', title: 'Exported', body: `${filtered.length} candidate(s) — Excel` })
                      }}
                    >
                      Excel (.xls)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        exportPipelineCSV(filtered, stages, stageField)
                        toast({ type: 'success', title: 'Exported', body: `${filtered.length} candidate(s) — CSV` })
                      }}
                    >
                      CSV (.csv)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        exportPipelineText(filtered, stages, stageField)
                        toast({ type: 'success', title: 'Exported', body: `${filtered.length} candidate(s) — text` })
                      }}
                    >
                      Text (.txt)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  key={a.id ?? a.label}
                  onClick={() => unwiredAction(a.toast ?? a.label)}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
                >
                  {a.icon && <AppIcon name={a.icon} size={15} />}
                  {a.label}
                </button>
              ),
            )}
            {/* The search box sits beside the header filter and wears the
                same shell, because they do the same job to the same list —
                and it is shown to whoever may see that filter at all: the
                role map (roleAccess) already decides who opens this board to
                narrow it and who opens it to sign one scorecard. */}
            {showFilter && (
              <label className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 focus-within:border-border-strong">
                <Search size={14} className="shrink-0 text-text-3" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, phone, phase…"
                  aria-label="Search this board"
                  className="w-44 bg-transparent text-[13px] font-medium text-text-1 outline-none placeholder:font-normal placeholder:text-text-3"
                />
              </label>
            )}
            {showFilter && headerFilter && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2">
                    {roleFilter ?? headerFilter.label}
                    <ChevronDown size={14} className="text-text-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[320px] overflow-y-auto">
                  <DropdownMenuItem onClick={() => setRoleFilter(null)}>
                    <span className="flex-1">{headerFilter.label}</span>
                    {!roleFilter && <Check size={14} className="text-primary" />}
                  </DropdownMenuItem>
                  {headerFilter.options.map((opt) => (
                    <DropdownMenuItem key={opt} onClick={() => setRoleFilter(opt)}>
                      <span className="flex-1">{opt}</span>
                      {roleFilter === opt && <Check size={14} className="text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* resume-first intake: drop a resume, the candidate opens itself
                in New (candidates board, live driver only) */}
            {showSecondary && schema.dataSource.resource === 'candidates' && liveReadOnly && (
              <button
                onClick={() => {
                  if (!canEdit) {
                    toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
                    return
                  }
                  setResumeIntakeOpen(true)
                }}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
              >
                <AppIcon name="file-up" size={15} />
                From resume
              </button>
            )}
            {/* The Drive folder recruiting drops CVs into. A button, never a
                sweep: nothing imports itself. */}
            {showSecondary && schema.dataSource.resource === 'candidates' && liveReadOnly && (
              <button
                onClick={() => {
                  if (!canEdit) {
                    toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
                    return
                  }
                  setInboxOpen(true)
                }}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
              >
                <AppIcon name="inbox" size={15} />
                Resume inbox
              </button>
            )}
            {/* The background reports somebody files outside this platform.
                Same shape as the résumé inbox: scan, look, then attach.

                AND THE SAME GUARDS, WHICH IT WAS MISSING: this
                button asked only whether the person could edit, so it drew
                itself on every other board built from this template — the
                Onboarding Tracker, House Work Orders, the Potential Clients
                Funnel — where a CJIS folder means nothing, and pressing it
                invalidated the CANDIDATES slice from a board that is not
                about candidates. */}
            {showSecondary && schema.dataSource.resource === 'candidates' && liveReadOnly && canEdit && (
              <button
                onClick={() => setCjisFolderOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
              >
                <AppIcon name="shield-check" size={15} />
                CJIS folder
              </button>
            )}
            {showPrimary && config.primaryAction && (
              <button
                disabled={config.primaryAction.modal === 'start-onboarding' && !canEdit}
                title={
                  config.primaryAction.modal === 'start-onboarding' && !canEdit
                    ? 'Requires hiring.edit — ask an admin'
                    : undefined
                }
                onClick={() => {
                  if (config.primaryAction.modal === 'start-onboarding') {
                    setManualOpen(true)
                    return
                  }
                  // hiring-v3: the real Add Candidate modal (candidates board only — other pipelines keep their…
                  if (schema.dataSource.resource === 'candidates') {
                    if (!canEdit) {
                      toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
                      return
                    }
                    setAddWithPacket(false)
                    setAddStage(undefined)
                    setAddOpen(true)
                    return
                  }
                  unwiredAction(config.primaryAction.toast ?? config.primaryAction.label)
                }}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {config.primaryAction.icon && <AppIcon name={config.primaryAction.icon} size={15} />}
                {config.primaryAction.label}
              </button>
            )}
          </>
        }
      />

      {/**
        * THE NUMBERS THAT DECIDE, ABOVE THE FUNNEL. The board
        * already counts what is in each column; a page can now also declare a
        * strip of computed figures, the same shape and the same component the
        * sheet template uses — one implementation, so the two cannot drift.
        *
        * It is fed the FILTERED rows, not the raw ones: a strip that ignored
        * the header filter would answer a question nobody asked.
        */}
      {summaryStrip && <SummaryStrip summaryStrip={summaryStrip} data={filtered} />}

      {/* The strip counts the FILTERED rows for the reason written just
          above, and while a search is on it also drops the stages the board
          itself dropped — the tiles beside it narrow with the filter and go
          back to normal afterwards, because a
          tile answering for a line that is no longer on screen is the same
          question nobody asked. It is handed the WHOLE stage list even then,
          so the conversions it shows are still measured stage to stage. */}
      {config.showSummary && (!searching || visibleStages.length > 0) && (
        <FunnelStrip stages={stages} byStage={byStage} footer={(config.summary as any)?.footer} hideEmpty={searching} />
      )}

      {/* the gap only exists while the rail does — with it gone the board
          takes the width back */}
      <div className={config.showRail !== false ? 'flex gap-6' : 'flex'}>
        {/* funnel rail (sticky, scroll-spy) */}
        {config.showRail !== false && (
          <div className="sticky top-[92px] hidden h-fit w-14 shrink-0 flex-col items-center py-2 xl:flex">
            {/* The rail jumps to bands; while a search is on, the bands that
                matched nothing are not there to jump to. */}
            {visibleStages.map((s, i) => (
              <button
                key={s.id}
                onClick={() => document.getElementById(`stage-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="group relative flex flex-col items-center"
                aria-label={`Jump to ${s.label}`}
                title={s.label}
              >
                {i > 0 && (
                  <motion.span
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.5, delay: 0.1 + i * 0.08, ease: EASE_OUT_EXPO }}
                    className="h-10 origin-top bg-border"
                    style={{ width: Math.max(2, 10 - i * 2) }}
                  />
                )}
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.24, delay: 0.15 + i * 0.08, ease: EASE_OUT_EXPO }}
                  className="h-3 w-3 rounded-full transition-transform duration-150 group-hover:scale-125"
                  style={{
                    background: TINT_VAR[s.tint],
                    boxShadow: activeStage === s.id ? '0 0 0 2px var(--surface), 0 0 0 4px var(--primary)' : '0 0 0 2px var(--surface)',
                  }}
                />
                <span className="mt-1 text-[10px] font-semibold tabular-nums text-text-3">{byStage.get(s.id)?.length ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setDraggingStageId(null) }}>
          <AnimatePresence mode="wait" initial={false}>
            {/* The typed word is deliberately NOT part of this key: picking a
                filter is one decision and deserves the cross-fade, whereas
                re-keying on every keystroke would tear the board down and
                build it again between two letters. */}
            <motion.div
              key={roleFilter ?? 'all'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full"
            >
              <motion.div variants={bandContainer} initial="hidden" animate="show" className="space-y-0">
                {/* A search that hides every band still owes an answer — the
                    same dashed line a stage uses to say it is empty, because
                    a board that meets a typed name with a blank page reads
                    as broken rather than as empty-handed. */}
                {searching && visibleStages.length === 0 && (
                  <div className="rounded-md border border-dashed border-border-strong px-4 py-12 text-center">
                    <p className="text-[13px] font-semibold text-text-2">Nothing on this board matches “{query.trim()}”.</p>
                    <p className="mt-1 text-[12px] text-text-3">Clear the search and every stage comes back.</p>
                  </div>
                )}
                {visibleStages.map((s, i) => (
                  <div key={s.id}>
                    {i > 0 && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, delay: 0.4 + i * 0.08 }}
                        className="ml-[27px] block h-6 w-0 border-l-2 border-dashed border-border-strong"
                        aria-hidden
                      />
                    )}
                    <StageBand
                      stage={s}
                      stages={stages}
                      cards={byStage.get(s.id) ?? []}
                      fields={fields}
                      canEdit={canEdit}
                      clickable={Boolean(config.detailPanel)}
                      onOpen={openCard}
                      onAdvance={advanceRec}
                      // The stages a candidate can actually be created into.
                      canInsert={
                        schema.dataSource.resource !== 'candidates' ||
                        ['new', 'phone-screen', 'interview', 'onboarding'].includes(String(s.id))
                      }
                      onAdd={
                        schema.dataSource.resource === 'candidates'
                          ? () => {
                              if (!canEdit) {
                                toast({ type: 'warning', title: 'Requires hiring.edit — ask an admin' })
                                return
                              }
                              setAddWithPacket(true)
                              // Which band was pressed.
                              setAddStage(s.id)
                              setAddOpen(true)
                            }
                          : undefined
                      }
                      collapsed={collapsed.has(s.id)}
                      onToggleCollapse={() =>
                        setCollapsed((c) => {
                          const n = new Set(c)
                          if (n.has(s.id)) {
                            n.delete(s.id)
                          } else {
                            n.add(s.id)
                          }
                          return n
                        })
                      }
                      sortDesc={sortDesc.has(s.id)}
                      onToggleSort={() =>
                        setSortDesc((c) => {
                          const n = new Set(c)
                          if (n.has(s.id)) {
                            n.delete(s.id)
                          } else {
                            n.add(s.id)
                          }
                          return n
                        })
                      }
                      sortAlpha={sortAlpha.has(s.id)}
                      onToggleAlpha={() =>
                        setSortAlpha((c) => {
                          const n = new Set(c)
                          if (n.has(s.id)) {
                            n.delete(s.id)
                          } else {
                            n.add(s.id)
                          }
                          return n
                        })
                      }
                      draggingStageId={draggingStageId}
                      emptyText={emptyText}
                      rowActions={rowActions}
                      onAction={runCardAction}
                      canDo={canDoAction}
                      onPerson={profileLinked ? openProfile : undefined}
                      onSource={sourceChipLinked ? (rec, tag) => setSourceChip({ rec, tag }) : undefined}
                      onStart={startLinked ? startActivities : undefined}
                      startingId={starting}
                    />
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </AnimatePresence>
          <DragOverlay dropAnimation={{ duration: 0.26, easing: 'cubic-bezier(.22,1,.36,1)' }}>
            {activeRec && (
              <motion.div initial={{ scale: 1.02, rotate: 0.5 }} animate={{ scale: 1.02, rotate: 0.5 }} className="shadow-3">
                <PipelineCard
                  rec={activeRec}
                  fields={fields}
                  tint={stages.find((s) => s.id === activeRec[stageField])?.tint ?? 'blue'}
                  celebrate={stages.find((s) => s.id === activeRec[stageField])?.celebrate}
                  stageId={activeRec[stageField]}
                />
              </motion.div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <CandidatePanel
        rec={panelRec}
        onClose={() => setPanelRec(null)}
        detailConfig={config.detailPanel}
        stages={stages}
        stageField={stageField}
        schema={schema}
        canEdit={canEdit}
        onUpload={uploadItem}
        onEditDetails={liveReadOnly && isAdmin && panelRec ? () => setEditDetailsOpen(true) : undefined}
        onUseLast={liveReadOnly && isAdmin && panelRec ? () => void useTheLast() : undefined}
        usingLast={usingLast}
        onForceError={liveReadOnly && isAdmin && panelRec ? () => void forceError() : undefined}
        forcingError={forcingError}
        onManualScreen={liveReadOnly && canEdit && panelRec && panelStage === 'phone-screen' ? () => setManualScreenOpen(true) : undefined}
        onManualOnboarding={liveReadOnly && canEdit && panelRec && panelStage === 'onboarding' ? () => setManualOnboardingOpen(true) : undefined}
        onExtendOnboarding={liveReadOnly && canEdit && panelRec && panelStage === 'onboarding' ? () => void extendOnboarding() : undefined}
        onAttachPacket={liveReadOnly && canEdit && panelRec ? () => setAttachPacketOpen(true) : undefined}
        onAvatarChange={panelRec ? (pref) => setAvatarPref(panelRec.id, pref) : undefined}
        onDecide={liveReadOnly && canEdit ? decideCheckpoint : undefined}
        deciding={panelRec ? deciding[String(panelRec.id)] : undefined}
        onScreen={liveReadOnly && canEdit ? () => setScreenOpen(true) : undefined}
        onMove={liveReadOnly && canEdit ? moveToNext : undefined}
        onPull={liveReadOnly && canEdit ? pullTranscript : undefined}
        pullingTranscript={pullingTranscript}
        liveScreen={liveScreen}
        onPerson={profileLinked && panelRec ? () => openProfile(panelRec) : undefined}
        onShareLink={liveReadOnly && canEdit && panelRec ? () => void shareFormLink() : undefined}
        // the master may press it too — the modal itself goes read-only from the server's can_record, so looking is…
        onScorecard={liveReadOnly && (canScoreInterview || isMaster) ? () => setScorecardOpen(true) : undefined}
        canScoreInterview={liveReadOnly}
      />

      {/* The chip's own panel. It is NOT tied to the open drawer: somebody
          reads a source straight off the board, and the card behind it stays
          exactly where it was. */}
      {sourceChip && (
        <SourceModal
          open={Boolean(sourceChip)}
          onOpenChange={(o) => !o && setSourceChip(null)}
          rec={sourceChip.rec}
          candidateName={String(sourceChip.rec?.[fields.title] ?? '')}
          source={sourceChip.tag}
          tint={fields.tags?.tintBy?.[sourceChip.tag] ?? 'blue'}
        />
      )}

      {liveReadOnly && isAdmin && panelRec && editDetailsOpen && (
        <EditCandidateModal
          open={editDetailsOpen}
          onOpenChange={setEditDetailsOpen}
          rec={panelRec}
          onSaved={(patch) => {
            patchLocal(panelRec.id, patch)
            noteWrite('candidates', { id: String(panelRec.id), row: { ...panelRec, ...patch } })
          }}
        />
      )}

      {liveReadOnly && canEdit && panelRec && manualScreenOpen && (
        <ManualScreenModal
          open={manualScreenOpen}
          onOpenChange={setManualScreenOpen}
          candidateId={String(panelRec.id)}
          candidateName={String(panelRec[fields.title] ?? 'candidate')}
          onCompleted={() => {
            // The server does NOT move them any more — it used to approve every time, without waiting for the…
            const items = ((panelRec[checklistKey ?? 'checklist'] ?? []) as ChecklistItem[]).map(
              (i) =>
                i.stage === 'phone-screen' && i.id !== 'advance-decision'
                  ? { ...i, status: 'done' as ChecklistStatus }
                  : i,
            )
            patchLocal(panelRec.id, { checklist: items })
            noteWrite(schema.dataSource.resource, { id: String(panelRec.id), row: { ...panelRec, checklist: items } })
          }}
        />
      )}

      {liveReadOnly && canEdit && panelRec && attachPacketOpen && (
        <PacketAttachModal
          open={attachPacketOpen}
          onOpenChange={setAttachPacketOpen}
          candidateId={String(panelRec.id)}
          candidateName={String(panelRec[fields.title] ?? 'candidate')}
          onCompleted={() => {
            // The chip is derived server-side, so the truth arrives with the next slice.
            patchLocal(panelRec.id, { packet: { state: 'waived', label: 'New Hire on file' } })
          }}
        />
      )}

      {liveReadOnly && canEdit && panelRec && manualOnboardingOpen && (
        <ManualOnboardingModal
          open={manualOnboardingOpen}
          onOpenChange={setManualOnboardingOpen}
          candidateId={String(panelRec.id)}
          candidateName={String(panelRec[fields.title] ?? 'candidate')}
          onCompleted={(res) => {
            // PAINT WHAT THE SERVER DID, NOT WHAT THE BUTTON MEANT.
            const held = res?.held === true
            const base = (panelRec[checklistKey ?? 'checklist'] ?? []) as ChecklistItem[]
            const settle = (list: ChecklistItem[]) =>
              list.map((i) =>
                i.stage === 'onboarding' && i.id !== 'new-hire-packet'
                  ? { ...i, status: 'done' as ChecklistStatus }
                  : i,
              )
            if (held) {
              // Everything they did is recorded; the card does NOT move — it waits here for the packet.
              const items = settle(base)
              patchLocal(panelRec.id, { checklist: items })
              noteWrite(schema.dataSource.resource, { id: String(panelRec.id), row: { ...panelRec, checklist: items } })
              return
            }
            const { patch } = buildMovePatch(panelRec, 'hired')
            const items = settle((patch.checklist ?? base) as ChecklistItem[])
            patchLocal(panelRec.id, { ...patch, checklist: items })
            noteWrite(schema.dataSource.resource, { id: String(panelRec.id), row: { ...panelRec, ...patch, checklist: items } })
          }}
        />
      )}

      {/* onboarding paperwork — files land in the candidate's Drive folder,
          the checklist rows here follow whatever the sheet says */}
      {liveReadOnly && panelRec && (
        <OnboardingDocsModal
          open={docsOpen}
          onOpenChange={setDocsOpen}
          candidateId={String(panelRec.candidateId ?? panelRec.id)}
          candidateName={String(panelRec[fields.title] ?? 'candidate')}
          onChanged={(state) => {
            const key = checklistKey ?? 'checklist'
            const byDoc = new Map(state.items.map((i) => [i.doc_id, i.status]))
            const next = ((panelRec[key] ?? []) as ChecklistItem[]).map((i) => {
              const docId = docIdFor(i.id)
              const st = docId ? byDoc.get(docId) : undefined
              if (!st) return i
              return {
                ...i,
                status: (st === 'verified' || st === 'uploaded' ? 'done' : 'missing') as ChecklistStatus,
              }
            })
            patchLocal(panelRec.id, { [key]: next })
          }}
        />
      )}

      {/* in-person interview scorecard — the gate for Move to Onboarding */}
      {liveReadOnly && panelRec && (
        <InterviewScorecardModal
          open={scorecardOpen}
          onOpenChange={setScorecardOpen}
          candidateId={String(panelRec.id)}
          candidateName={String(panelRec[fields.title] ?? 'candidate')}
          onSaved={(res) => {
            // Still being recorded: nothing is known to be written, so the card is re-read rather than painted with…
            if (res.pending) {
              void refetchRec(String(panelRec.id))
              return
            }
            // the scorecard is signed — end the one-shot visit
            if (signOutAfterScorecard) endInterviewerSession()
            if (res.declined) {
              // A Decline leaves the hiring page — the backend already moved them to Not Hiring; here the card goes…
              setRecords((rs) => rs.filter((r) => String(r.id) !== String(panelRec.id)))
              noteWrite(schema.dataSource.resource, { id: String(panelRec.id), removed: true })
              setPanelRec(null)
              return
            }
            const key = checklistKey ?? 'checklist'
            const greens = (items: ChecklistItem[]) =>
              items.map((i) =>
                i.id === 'interview-scorecard'
                  ? { ...i, status: 'done' as ChecklistStatus }
                  : i.id === 'interview-recommendation' && res.recommendation === 'Advance'
                    ? { ...i, status: 'done' as ChecklistStatus }
                    : i,
              )
            if (res.advanced) {
              // A positive ends the stage on its own: the server already moved them — the board follows to…
              const { patch } = buildMovePatch(panelRec, 'onboarding')
              const items = greens((patch.checklist ?? panelRec[key] ?? []) as ChecklistItem[])
              patchLocal(panelRec.id, { ...patch, checklist: items })
              noteWrite(schema.dataSource.resource, { id: String(panelRec.id), row: { ...panelRec, ...patch, checklist: items } })
              return
            }
            patchLocal(panelRec.id, { [key]: greens((panelRec[key] ?? []) as ChecklistItem[]) })
          }}
        />
      )}

      {/* onboarding-v2: Start Onboarding Manual modal (opt-in via
          primaryAction.modal); created hires are prepended to the board. */}
      {config.primaryAction?.modal === 'start-onboarding' && (
        <StartOnboardingModal
          open={manualOpen}
          onOpenChange={setManualOpen}
          onCreated={(row) => setRecords((rs) => [row, ...rs])}
        />
      )}

      {/* hiring-v3: real Add Candidate modal (Hiring Pipeline / candidates
          board only); created candidates are prepended to the board. */}
      {schema.dataSource.resource === 'candidates' && (
        <AddCandidateModal
          open={addOpen}
          onOpenChange={setAddOpen}
          withPacket={addWithPacket}
          stage={addStage}
          onCreated={(rec) => setRecords((rs) => [rec, ...rs])}
        />
      )}

      {/* resume-first intake — file in, candidate out (New) */}
      {schema.dataSource.resource === 'candidates' && (
        <ResumeIntakeModal
          open={resumeIntakeOpen}
          onOpenChange={setResumeIntakeOpen}
          onCreated={(rec) => setRecords((rs) => [rec, ...rs])}
        />
      )}

      {/* hiring-v3: live resume/CJIS uploads for the open candidate. The
          talent endpoints persist server-side; the board is patched LOCALLY
          only (the live resource rejects api.update). */}
      {/* The Drive inbox. Imported cards land in New server-side, so the board
          is told to re-read rather than patched from a guess.

          BOTH ARE CANDIDATE DOORS AND ARE MOUNTED AS SUCH: they
          used to be rendered on every board this template draws, closed but
          present, while their siblings above ask whose board this is first.
          A shut door on the wrong wall is still a door — and both of these,
          on closing, invalidate the candidates slice. */}
      {schema.dataSource.resource === 'candidates' && (
        <>
          <CjisFolderModal
            open={cjisFolderOpen}
            onOpenChange={setCjisFolderOpen}
            onAttached={() => { invalidate('candidates'); noteWrite('candidates') }}
          />
          <ResumeInboxModal
            open={inboxOpen}
            onOpenChange={setInboxOpen}
            onImported={() => { invalidate('candidates'); noteWrite('candidates') }}
          />
        </>
      )}
      <ResumeUploadModal
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        candidate={panelRec}
        onUploaded={(resumeLink) => {
          if (!panelRec) return
          const key = checklistKey ?? 'checklist'
          const next = ((panelRec[key] ?? []) as ChecklistItem[]).map((i) =>
            i.id === 'resume' ? { ...i, status: 'done' as ChecklistStatus } : i,
          )
          patchLocal(panelRec.id, { resumeLink, resumeFileLabel: 'Open resume', [key]: next })
        }}
      />
      {/* phone-screening form — the GAS persists; the board patches its
          checklist LOCALLY only (screen-details / ai-report). 'date-accepted'
          was removed: the candidate picks their own interview
          time now, so the board no longer asks for a date read off a call. */}
      <ScreenFormModal
        open={screenOpen}
        onOpenChange={setScreenOpen}
        candidate={panelRec}
        onSaved={({ screenStatus, hasReport }) => {
          if (!panelRec) return
          const key = checklistKey ?? 'checklist'
          const next = ((panelRec[key] ?? []) as ChecklistItem[]).map((i) => {
            if (i.id === 'screen-details')
              return { ...i, status: (screenStatus === 'Completed' ? 'done' : 'pending') as ChecklistStatus }
            if (i.id === 'ai-report' && hasReport) return { ...i, status: 'auto' as ChecklistStatus }
            return i
          })
          patchLocal(panelRec.id, { [key]: next })
        }}
      />
      <CjisUploadModal
        open={cjisOpen}
        onOpenChange={setCjisOpen}
        candidate={panelRec}
        onUploaded={(status) => {
          if (!panelRec) return
          const key = checklistKey ?? 'checklist'
          const done = status === 'Clear' || status === 'Verified'
          const next = ((panelRec[key] ?? []) as ChecklistItem[]).map((i) =>
            i.id === 'cjis' ? { ...i, status: (done ? 'done' : 'pending') as ChecklistStatus } : i,
          )
          patchLocal(panelRec.id, { [key]: next })
        }}
      />
    </div>
  )
}
