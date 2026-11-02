// TEAM BOARD — the whole company's work, on one wall.
// The KANBAN shows everybody's tasks to everybody, in a design as polished as the tools this kind of board is…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Ban, CalendarDays, Check, FolderKanban, Loader2, Maximize2, Minimize2,
  Plus, Search, StickyNote, Trash2, X,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import UploadImageModal, { type UploadedImage } from '@/components/shared/UploadImageModal'
import { useAuthStore } from '@/auth/useAuthStore'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { ohioDay, ohioToday } from '@/lib/ohio'
import { useDraftGuard } from '@/lib/useDraftGuard'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

type ColumnId = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled'
type Priority = 'high' | 'medium' | 'low'

type TeamTask = {
  id: string
  title?: string
  description?: string
  priority?: Priority | string
  client?: string
  assignee?: string
  // the GESTOR: picked from the platform's people, never typed — the select below only offers directory names.
  manager?: string
  /** the project this card belongs to — a `techProjects` (Technology app) row id. */
  projectId?: string
  /** JSON list of CardAttachment — images, text files, Google Sheets links. */
  attachments?: string
  // THE NOTE — the essential thing the kanban item was missing: a note that opens, expands and is fully editable in…
  note?: string
  dueDate?: string
  labels?: string
  column?: ColumnId | string
  createdBy?: string
  createdAt?: string
  completedAt?: string
  cancelledAt?: string
}

// A PROJECT — the TECHNOLOGY APP'S OWN ROW.
type PortfolioProject = {
  id: string
  name?: string
  category?: string
  status?: string
  blurb?: string
  owner?: string
}

// The project statuses that still take new cards — the portfolio's own vocabulary (live, operational, in_use…
const projectOpen = (p: PortfolioProject) => String(p.status ?? '').toLowerCase() !== 'archived'

// THE GESTORES — the three people who may hold that role.
const GESTOR_NAMES = ['Ty Bond', 'Lisa B Bright', 'Wellington']
function gestorOptions(people: string[]): string[] {
  const hits = GESTOR_NAMES.map((g) => {
    const gl = g.toLowerCase()
    return people.find((p) => {
      const pl = p.toLowerCase()
      return pl === gl || pl.startsWith(gl + ' ') || pl.includes(gl)
    }) ?? g
  })
  return [...new Set(hits)]
}

const COLUMNS: { id: ColumnId; label: string; tint: TintName; hint: string }[] = [
  { id: 'backlog', label: 'Backlog', tint: 'lavender', hint: 'Worth doing, not yet started' },
  { id: 'todo', label: 'To do', tint: 'blue', hint: 'Picked up this week' },
  { id: 'in-progress', label: 'In progress', tint: 'amber', hint: 'Somebody is on it now' },
  { id: 'review', label: 'Review', tint: 'peach', hint: 'Done, waiting on a second pair of eyes' },
]

const PRIORITY: Record<Priority, { label: string; chip: string; dot: string }> = {
  high: { label: 'High', chip: 'bg-tint-pink text-tint-fg-pink', dot: 'bg-tint-fg-pink' },
  medium: { label: 'Medium', chip: 'bg-tint-amber text-tint-fg-amber', dot: 'bg-tint-fg-amber' },
  low: { label: 'Low', chip: 'bg-tint-mint text-tint-fg-mint', dot: 'bg-tint-fg-mint' },
}

const COLUMN_TINT: Record<ColumnId, string> = {
  backlog: 'bg-tint-lavender text-tint-fg-lavender',
  todo: 'bg-tint-blue text-tint-fg-blue',
  'in-progress': 'bg-tint-amber text-tint-fg-amber',
  review: 'bg-tint-peach text-tint-fg-peach',
  done: 'bg-tint-mint text-tint-fg-mint',
  cancelled: 'bg-surface-3 text-text-2',
}

const REFRESH_MS = 60_000

const priorityOf = (t: TeamTask): Priority => {
  const p = String(t.priority ?? 'medium').toLowerCase()
  return p === 'high' || p === 'low' ? p : 'medium'
}
const columnOf = (t: TeamTask): ColumnId => {
  const c = String(t.column ?? 'backlog').toLowerCase().replace(/[\s_]+/g, '-')
  return (COLUMNS.some((x) => x.id === c) || c === 'done' || c === 'cancelled') ? (c as ColumnId) : 'backlog'
}
const labelsOf = (t: TeamTask): string[] =>
  String(t.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// A due date, read on the COMPANY's clock — "today" and "overdue" depend on which day it is where the work happens…
function dueMeta(raw?: string): { text: string; tone: 'past' | 'today' | 'soon' | 'none' } {
  const v = String(raw ?? '').trim()
  if (!v) return { text: '', tone: 'none' }
  const day = v.slice(0, 10)
  const today = ohioToday()
  if (day < today) return { text: ohioDay(day), tone: 'past' }
  if (day === today) return { text: 'Today', tone: 'today' }
  return { text: ohioDay(day), tone: 'soon' }
}

type CardAttachment = { kind: 'image' | 'file' | 'sheet'; url: string; name: string }

// Attachments ride the card as a JSON list on the teamTasks row — images, text files and Google Sheets links on…
function attachmentsOf(t: { attachments?: unknown }): CardAttachment[] {
  try {
    const raw = String(t.attachments ?? '')
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((a) => a && typeof a.url === 'string') : []
  } catch { return [] }
}

type Draft = {
  title: string
  description: string
  priority: Priority
  client: string
  assignee: string
  manager: string
  projectId: string
  dueDate: string
  labels: string
  column: ColumnId
  attachments: string
}

const emptyDraft = (column: ColumnId = 'backlog'): Draft => ({
  title: '', description: '', priority: 'medium', client: '', assignee: '',
  manager: '', projectId: '', dueDate: '', labels: '', column,
  attachments: '',
})


export default function TeamBoardPage() {
  const me = useAuthStore((s) => s.user)
  const myName = String(me?.name ?? '')
  const [tasks, setTasks] = useState<TeamTask[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [people, setPeople] = useState<string[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<ColumnId | null>(null)
  const [open, setOpen] = useState<TeamTask | null>(null)
  const [composing, setComposing] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState<null | 'done' | 'cancelled'>(null)
  const [projects, setProjects] = useState<PortfolioProject[]>([])
  const [imgOpen, setImgOpen] = useState(false)
  const [sheetUrl, setSheetUrl] = useState('')
  // 'wall' is the kanban; 'projects' is the FULL-SCREEN portfolio view — a narrow drawer made the app feel thin; a…
  const [view, setView] = useState<'wall' | 'projects'>('wall')
  const [projectFilter, setProjectFilter] = useState<string>('')
  const reqRef = useRef(0)

  // Unsaved-work reminder (the post-it sliver): a NEW card is dirty once any typed field holds text; an EDIT is…
  const composerDirty =
    composing !== null &&
    (open?.id
      ? JSON.stringify(composing) !==
        JSON.stringify({
          title: open.title ?? '', description: open.description ?? '',
          priority: priorityOf(open), client: open.client ?? '',
          assignee: open.assignee ?? '', manager: open.manager ?? '',
          projectId: String(open.projectId ?? ''),
          dueDate: String(open.dueDate ?? '').slice(0, 10),
          labels: open.labels ?? '', column: columnOf(open),
          attachments: String(open.attachments ?? ''),
        })
      : [
          composing.title, composing.description, composing.client, composing.assignee,
          composing.manager, composing.projectId, composing.dueDate, composing.labels,
        ].some((v) => v.trim() !== ''))
  useDraftGuard({ id: 'kanban-task', label: 'An unsent Kanban card', dirty: composerDirty })

  // ---------------- the note ---------------- Open = reading it.
  const [noteEditing, setNoteEditing] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteBig, setNoteBig] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const openNote = String(open?.note ?? '')
  useDraftGuard({
    id: 'kanban-note',
    label: 'An unsaved Kanban note',
    dirty: noteEditing && noteDraft !== openNote,
  })
  // A different card is a different note: never carry one person's unsaved paragraph onto the next card that opens.
  const openId = open ? String(open.id) : ''
  useEffect(() => {
    setNoteEditing(false)
    setNoteBig(false)
    setNoteDraft('')
  }, [openId])

  // ONE write, and the board is right before Google answers is NOT what this does — a note is the one thing that…
  const saveNote = useCallback(async () => {
    if (!open) return
    const id = String(open.id)
    const value = noteDraft
    setNoteSaving(true)
    try {
      await api.update('teamTasks', id, { note: value })
      setTasks((prev) => prev.map((t) => (String(t.id) === id ? { ...t, note: value } : t)))
      setOpen((prev) => (prev && String(prev.id) === id ? { ...prev, note: value } : prev))
      setNoteEditing(false)
      toast({ type: 'success', title: value.trim() ? 'Note saved' : 'Note cleared' })
    } catch (e) {
      toast({ type: 'danger', title: 'The note was not saved', body: e instanceof Error ? e.message : 'Try again — nothing was lost.' })
    } finally {
      setNoteSaving(false)
    }
  }, [open, noteDraft])

  const load = useCallback(async () => {
    const seq = ++reqRef.current
    try {
      const [rows, projs] = await Promise.all([
        api.list<TeamTask>('teamTasks'),
        // the TECHNOLOGY APP's project rows — the resolver's contract, not a board-own table (was 'projects' until…
        api.list<PortfolioProject>('techProjects').catch(() => [] as PortfolioProject[]),
      ])
      if (seq !== reqRef.current) return
      setTasks(Array.isArray(rows) ? rows : [])
      setProjects(Array.isArray(projs) ? projs : [])
    } catch {
      /* the next read answers; a board that shouts on every blink is unusable */
    } finally {
      if (seq === reqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const seed = cachedUsers()
    const names = (rows: Record<string, unknown>[]) =>
      [...new Set(rows.map((r) => String(r.display_name ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    if (seed) setPeople(names(seed))
    else fetchUsers().then((rows) => setPeople(names(rows))).catch(() => {})
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    const wake = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [load])

  const projectById = useMemo(() => {
    const m = new Map<string, PortfolioProject>()
    projects.forEach((p) => m.set(String(p.id), p))
    return m
  }, [projects])
  const activeProjects = useMemo(
    () => projects.filter(projectOpen)
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))),
    [projects],
  )

  const query = q.trim().toLowerCase()
  const visible = useMemo(() => tasks.filter((t) => {
    if (mineOnly && String(t.assignee ?? '') !== myName) return false
    if (projectFilter && String(t.projectId ?? '') !== projectFilter) return false
    if (!query) return true
    return [t.title, t.client, t.assignee, t.manager, t.labels, t.description]
      .some((v) => String(v ?? '').toLowerCase().includes(query))
  }), [tasks, query, mineOnly, myName, projectFilter])

  const inColumn = (id: ColumnId) => visible.filter((t) => columnOf(t) === id)
  const done = useMemo(() => visible.filter((t) => columnOf(t) === 'done')
    .sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''))), [visible])
  // The other archive — a cancelled card goes into the cancelled box, beside Done, never a fifth column.
  const cancelled = useMemo(() => visible.filter((t) => columnOf(t) === 'cancelled')
    .sort((a, b) => String(b.cancelledAt ?? '').localeCompare(String(a.cancelledAt ?? ''))), [visible])

  /* ---------------- writes ---------------- */

  const move = async (task: TeamTask, column: ColumnId) => {
    if (columnOf(task) === column) return
    const before = tasks
    // The card lands where it was dropped, immediately — a board that waits a second and a half for Google before…
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, column } : t)))
    try {
      await api.update('teamTasks', String(task.id), { column })
      void load()
    } catch (e) {
      setTasks(before)
      toast({ type: 'danger', title: 'The card went back', body: e instanceof Error ? e.message : 'The move was not saved.' })
    }
  }

  /** Append one attachment to the draft's JSON list. */
  const addAttachment = (a: CardAttachment) => {
    if (!composing) return
    const next = [...attachmentsOf(composing), a]
    setComposing({ ...composing, attachments: JSON.stringify(next) })
  }

  /** A text file rides the same libraryUpload door the images use. */
  const attachTextFile = async (f: File) => {
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
        r.onerror = () => reject(new Error('could not read the file'))
        r.readAsDataURL(f)
      })
      const res = await gasAction<{ file_id: string }>('libraryUpload', {
        base64, filename: f.name.replace(/[\\/:*?"<>|]+/g, '-'), mime_type: f.type || 'text/plain',
      })
      addAttachment({ kind: 'file', url: `https://drive.google.com/file/d/${res.file_id}/view`, name: f.name })
    } catch (e) {
      toast({ type: 'danger', title: 'Upload failed', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  /** A Google Sheets link is a reference, not an upload. */
  const attachSheet = () => {
    const url = sheetUrl.trim()
    if (!/^https?:\/\/\S+$/.test(url)) {
      toast({ type: 'warning', title: 'Paste the full link', body: 'It should start with https:// — the sheet\'s Share → Copy link.' })
      return
    }
    addAttachment({ kind: 'sheet', url, name: url.replace(/^https?:\/\//, '').split('/').slice(0, 4).join('/') })
    setSheetUrl('')
  }

  const save = async () => {
    if (!composing || saving) return
    const title = composing.title.trim()
    if (!title) {
      toast({ type: 'warning', title: 'A card needs a title', body: 'Say what has to be done.' })
      return
    }
    // every task hangs on a project, and that project is shown prominently
    if (!composing.projectId) {
      toast({ type: 'warning', title: 'A card needs a project', body: 'Pick the project this task belongs to.' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        title,
        description: composing.description.trim(),
        priority: composing.priority,
        client: composing.client.trim(),
        assignee: composing.assignee.trim(),
        manager: composing.manager,
        projectId: composing.projectId,
        dueDate: composing.dueDate,
        labels: composing.labels.trim(),
        column: composing.column,
        attachments: composing.attachments,
      }
      // THE SAVE DOES NOT RE-READ THE BOARD — creating or editing an activity was slow.
      if (open?.id) {
        const id = String(open.id)
        await api.update('teamTasks', id, payload)
        setTasks((prev) => prev.map((t) => (String(t.id) === id ? { ...t, ...payload } : t)))
      } else {
        const created = await api.create<TeamTask>('teamTasks', { ...payload, createdBy: myName })
        // The id is minted by the server.
        if (created && created.id) setTasks((prev) => [created, ...prev])
        else void load()
      }
      setComposing(null)
      setOpen(null)
      toast({ type: 'success', title: open?.id ? 'Card saved' : 'Card added to the board' })
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (task: TeamTask) => {
    const ok = await askConfirm({
      title: 'Delete this card?',
      body: `"${task.title ?? 'Untitled'}" disappears from everybody's board. Finished work belongs in Done, not in the bin.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    const before = tasks
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    setOpen(null)
    try {
      await api.remove('teamTasks', String(task.id))
    } catch (e) {
      setTasks(before)
      toast({ type: 'danger', title: 'Not deleted', body: e instanceof Error ? e.message : 'The card is still there.' })
    }
  }

  /* ---------------- the wall ---------------- */

  // fits the viewport: the chrome, 2.5rem for the shell's copyright line, and the strip at the top while it is up
  return (
    <div className="flex h-[calc(100dvh-140px-2.5rem-var(--hub-strip-h,0px))] min-h-[460px] flex-col">
      <PageHeader
        title="Kanban"
        subtitle="Everyone's work, one wall. Drag a card to move it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search cards…"
                className="h-9 w-[190px] bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
            </div>
            <button
              onClick={() => setMineOnly((v) => !v)}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-semibold transition-colors',
                mineOnly
                  ? 'border-primary bg-primary-soft text-primary-strong'
                  : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              <Avatar name={myName || '?'} size="xs" /> Mine
            </button>
            <button
              onClick={() => setView((v) => (v === 'projects' ? 'wall' : 'projects'))}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-semibold transition-colors',
                view === 'projects' || projectFilter
                  ? 'border-primary bg-primary-soft text-primary-strong'
                  : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
              title="The portfolio, full screen — progress, timelines and every work item"
            >
              <FolderKanban size={14} />
              {projectFilter
                ? (projectById.get(projectFilter)?.name?.slice(0, 18) || 'Project')
                : 'Projects'}
              {projectFilter ? (
                <X
                  size={12}
                  onClick={(e) => { e.stopPropagation(); setProjectFilter('') }}
                  aria-label="Clear project filter"
                />
              ) : (
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{activeProjects.length}</span>
              )}
            </button>
            <button
              onClick={() => setArchiveOpen('done')}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              <Archive size={14} /> Done
              <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{done.length}</span>
            </button>
            <button
              onClick={() => setArchiveOpen('cancelled')}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              <Ban size={14} /> Cancelled
              <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums">{cancelled.length}</span>
            </button>
            <button
              onClick={() => { setOpen(null); setComposing(emptyDraft()) }}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              <Plus size={15} /> New card
            </button>
          </div>
        }
      />

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the board…
        </p>
      ) : view === 'projects' ? (
        <ProjectsView
          projects={projects}
          tasks={tasks}
          onBack={() => setView('wall')}
          onFocus={(id) => { setProjectFilter(id); setView('wall') }}
        />
      ) : (
        <div className="scroll-thin mt-4 flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => {
            const cards = inColumn(col.id)
            return (
              <section
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.id) }}
                onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault()
                  setOverCol(null)
                  const task = tasks.find((t) => String(t.id) === (dragId ?? ''))
                  setDragId(null)
                  if (task) void move(task, col.id)
                }}
                className={cn(
                  'flex w-[300px] shrink-0 flex-col rounded-lg border bg-surface-2/60 transition-colors',
                  overCol === col.id ? 'border-primary bg-primary-soft/40' : 'border-border',
                )}
              >
                <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', COLUMN_TINT[col.id])}>
                    {col.label}
                  </span>
                  <span className="text-[11.5px] tabular-nums text-text-3">{cards.length}</span>
                  <button
                    onClick={() => { setOpen(null); setComposing(emptyDraft(col.id)) }}
                    aria-label={`New card in ${col.label}`}
                    title={`New card in ${col.label}`}
                    className="ml-auto grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                  >
                    <Plus size={14} />
                  </button>
                </header>

                <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {cards.length === 0 && (
                    <p className="px-1 py-6 text-center text-[12px] leading-5 text-text-3">{col.hint}</p>
                  )}
                  {cards.map((t) => {
                    const p = PRIORITY[priorityOf(t)]
                    const due = dueMeta(t.dueDate)
                    const labels = labelsOf(t)
                    return (
                      <article
                        key={t.id}
                        draggable
                        onDragStart={() => setDragId(String(t.id))}
                        onDragEnd={() => { setDragId(null); setOverCol(null) }}
                        onClick={() => { setOpen(t); setComposing(null) }}
                        className={cn(
                          'cursor-pointer rounded-md border border-border bg-surface p-2.5 shadow-1 transition-all hover:border-border-strong hover:shadow-2',
                          dragId === String(t.id) && 'opacity-40',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className={cn('mt-[5px] h-2 w-2 shrink-0 rounded-full', p.dot)} title={`${p.label} priority`} />
                          <p className="min-w-0 flex-1 text-[13px] font-semibold leading-5 text-text-1">{t.title || 'Untitled'}</p>
                        </div>
                        {/* THE CARD ITSELF IS THE DRAG SOURCE for the column
                            move, so a name dragged out of it would ALSO set
                            dragId and land the card in whatever column the
                            person was dropped on. dragstart fires on the
                            source node only, so this listener runs solely for
                            the draggable names below — never for a drag begun
                            on the card. */}
                        {(t.client || t.projectId || labels.length > 0) && (
                          <div
                            onDragStart={(e) => e.stopPropagation()}
                            className="mt-1.5 flex flex-wrap items-center gap-1 pl-4"
                          >
                            {t.projectId && projectById.get(String(t.projectId)) && (
                              <span
                                className="clamp-1 max-w-[180px] rounded-md border border-tint-blue bg-tint-blue px-2 py-0.5 text-[11.5px] font-bold text-tint-fg-blue"
                                title={projectById.get(String(t.projectId))?.blurb || projectById.get(String(t.projectId))?.name}
                              >
                                {projectById.get(String(t.projectId))?.name || 'Project'}
                              </span>
                            )}
                            {t.client && (
                              <span className="rounded-full bg-tint-pink px-1.5 py-px text-[10.5px] font-semibold text-tint-fg-pink">
                                <DragPerson name={t.client} type="client" subtitle={t.title || undefined}>
                                  {t.client}
                                </DragPerson>
                              </span>
                            )}
                            {labels.map((l) => (
                              <span key={l} className="rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-medium text-text-2">
                                {l}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* same reason as the chips row above: the person's
                            dragstart must not reach the card's own */}
                        <div onDragStart={(e) => e.stopPropagation()} className="mt-2 flex items-center gap-2 pl-4">
                          {t.assignee ? (
                            <span className="flex min-w-0 items-center gap-1.5" title={t.assignee}>
                              <DragPerson
                                name={t.assignee}
                                subtitle={t.client || t.title || undefined}
                                className="min-w-0 items-center gap-1.5"
                              >
                                <Avatar name={t.assignee} size="xs" />
                                <span className="clamp-1 text-[11.5px] text-text-2">{t.assignee}</span>
                              </DragPerson>
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-text-3">Unassigned</span>
                          )}
                          {/* A card carrying a note says so on the wall —
                              otherwise the writing is only found by whoever
                              already knew to look. */}
                          {String(t.note ?? '').trim() && (
                            <span className="shrink-0 text-text-3" title="This card has a note">
                              <StickyNote size={12} />
                            </span>
                          )}
                          {due.text && (
                            <span
                              className={cn(
                                'ml-auto flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-semibold',
                                due.tone === 'past' ? 'bg-tint-pink text-tint-fg-pink'
                                  : due.tone === 'today' ? 'bg-tint-amber text-tint-fg-amber'
                                    : 'bg-surface-2 text-text-3',
                              )}
                            >
                              <CalendarDays size={10} /> {due.text}
                            </span>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ---- the card, in a drawer so the wall stays on screen ---- */}
      {open && !composing && (
        <Drawer onClose={() => setOpen(null)}>
          <header className="flex items-start gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-bold leading-6 text-text-1">{open.title || 'Untitled'}</h2>
              <p className="mt-0.5 text-[11.5px] text-text-3">
                {open.createdBy
                  ? <>Added by <DragPerson name={open.createdBy} subtitle={open.title || undefined}>{open.createdBy}</DragPerson></>
                  : 'Added on the board'}
                {open.completedAt ? ` · finished ${ohioDay(open.completedAt)}` : ''}
                {open.cancelledAt ? ` · cancelled ${ohioDay(open.cancelledAt)}` : ''}
              </p>
            </div>
            <button onClick={() => setOpen(null)} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
              <X size={15} />
            </button>
          </header>
          <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {open.description && (
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-text-2">{open.description}</p>
            )}

            {/* THE NOTE — the card's own page. Open it, expand it, write in
                it, save it: none of that opens the edit form, because a note
                is not a field on a form, it is the reason the card exists. */}
            <section className="rounded-[12px] border border-border bg-surface-2/40">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <StickyNote size={13} className="shrink-0 text-text-3" />
                <p className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Note</p>
                <button
                  onClick={() => setNoteBig((v) => !v)}
                  title={noteBig ? 'Shrink the note' : 'Expand the note'}
                  aria-label={noteBig ? 'Shrink the note' : 'Expand the note'}
                  className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                >
                  {noteBig ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
                {!noteEditing && (
                  <button
                    onClick={() => { setNoteDraft(openNote); setNoteEditing(true) }}
                    className="h-7 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                  >
                    {openNote.trim() ? 'Edit note' : 'Write a note'}
                  </button>
                )}
              </div>
              <div className="px-3 py-2.5">
                {noteEditing ? (
                  <>
                    <textarea
                      autoFocus
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Everything that does not fit on the tile — what was tried, what was said, what comes next."
                      className={cn(
                        'scroll-thin w-full resize-none rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] leading-5 text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary',
                        noteBig ? 'h-[58vh]' : 'h-40',
                      )}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => void saveNote()}
                        disabled={noteSaving || noteDraft === openNote}
                        className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                      >
                        {noteSaving && <Loader2 size={13} className="animate-spin" />}
                        Save note
                      </button>
                      <button
                        onClick={() => { setNoteEditing(false); setNoteDraft(openNote) }}
                        disabled={noteSaving}
                        className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      {noteDraft !== openNote && (
                        <span className="text-[11.5px] text-text-3">Unsaved</span>
                      )}
                    </div>
                  </>
                ) : openNote.trim() ? (
                  <p
                    onClick={() => { setNoteDraft(openNote); setNoteEditing(true) }}
                    className={cn(
                      'scroll-thin cursor-text whitespace-pre-wrap text-[13px] leading-5 text-text-1',
                      noteBig ? 'max-h-[58vh] overflow-y-auto' : 'max-h-40 overflow-y-auto',
                    )}
                  >
                    {openNote}
                  </p>
                ) : (
                  <p className="text-[12.5px] leading-5 text-text-3">
                    Nothing written yet. A note stays with the card — everyone who opens it reads the same one.
                  </p>
                )}
              </div>
            </section>

            <dl className="grid grid-cols-2 gap-3 text-[12.5px]">
              <Fact label="Column">{COLUMNS.find((c) => c.id === columnOf(open))?.label ?? 'Done'}</Fact>
              <Fact label="Priority">
                <span className={cn('rounded-full px-1.5 py-px text-[11px] font-semibold', PRIORITY[priorityOf(open)].chip)}>
                  {PRIORITY[priorityOf(open)].label}
                </span>
              </Fact>
              {/* an empty name renders the children untouched, so 'Unassigned'
                  and '—' stay plain text */}
              <Fact label="Assignee">
                <DragPerson name={open.assignee ?? ''} subtitle={open.title || undefined}>
                  {open.assignee || 'Unassigned'}
                </DragPerson>
              </Fact>
              <Fact label="Gestor">
                <DragPerson name={open.manager ?? ''} subtitle={open.title || undefined}>
                  {open.manager || '—'}
                </DragPerson>
              </Fact>
              <Fact label="Due">{dueMeta(open.dueDate).text || '—'}</Fact>
              {open.projectId && projectById.get(String(open.projectId)) && (
                <Fact label="Project">{projectById.get(String(open.projectId))?.name ?? ''}</Fact>
              )}
              {open.client && (
                <Fact label="Client">
                  <DragPerson name={open.client} type="client" subtitle={open.title || undefined}>
                    {open.client}
                  </DragPerson>
                </Fact>
              )}
              {labelsOf(open).length > 0 && <Fact label="Labels">{labelsOf(open).join(', ')}</Fact>}
            </dl>
            {attachmentsOf(open).length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Attachments</p>
                <div className="flex flex-wrap gap-2">
                  {attachmentsOf(open).map((a, i) => (
                    <a
                      key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 rounded-md border border-border px-2 py-1 transition-colors hover:bg-surface-2"
                    >
                      {a.kind === 'image'
                        ? <img src={a.url} alt={a.name} className="h-10 w-16 rounded-sm object-cover" />
                        : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-tint-blue text-[10px] font-bold text-tint-fg-blue">{a.kind === 'sheet' ? 'GS' : 'TXT'}</span>}
                      <span className="max-w-[180px] truncate text-[12px] font-semibold text-text-1">{a.name || a.url}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Move to</p>
              <div className="flex flex-wrap gap-1.5">
                {[...COLUMNS,
                  { id: 'done' as ColumnId, label: 'Done', tint: 'mint' as TintName, hint: '' },
                  { id: 'cancelled' as ColumnId, label: 'Cancelled', tint: 'lavender' as TintName, hint: '' }].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => void move(open, c.id)}
                    disabled={columnOf(open) === c.id}
                    className={cn(
                      'h-8 rounded-md border px-2.5 text-[12px] font-semibold transition-colors',
                      columnOf(open) === c.id
                        ? 'border-primary bg-primary-soft text-primary-strong'
                        : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
            <button
              onClick={() => setComposing({
                title: open.title ?? '', description: open.description ?? '',
                priority: priorityOf(open), client: open.client ?? '',
                assignee: open.assignee ?? '', manager: open.manager ?? '',
                projectId: String(open.projectId ?? ''),
                dueDate: String(open.dueDate ?? '').slice(0, 10),
                labels: open.labels ?? '', column: columnOf(open),
                attachments: String(open.attachments ?? ''),
              })}
              className="h-9 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              Edit
            </button>
            <button
              onClick={() => void remove(open)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-danger"
            >
              <Trash2 size={14} /> Delete
            </button>
          </footer>
        </Drawer>
      )}

      {/* ---- the form, same drawer ---- */}
      {composing && (
        <Drawer onClose={() => setComposing(null)}>
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 className="flex-1 text-[15px] font-bold text-text-1">{open?.id ? 'Edit card' : 'New card'}</h2>
            <button onClick={() => setComposing(null)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
              <X size={15} />
            </button>
          </header>
          <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <Field label="Title" required>
              <input
                autoFocus
                value={composing.title}
                onChange={(e) => setComposing({ ...composing, title: e.target.value })}
                placeholder="e.g. Reprint the Maple house fire drill log"
                className={inputCls}
              />
            </Field>
            <Field label="Detail">
              <textarea
                value={composing.description}
                onChange={(e) => setComposing({ ...composing, description: e.target.value })}
                rows={4}
                placeholder="What has to happen, and anything the next person needs to know."
                className={cn(inputCls, 'h-auto resize-y py-2 leading-5')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assignee">
                <input
                  list="team-board-people"
                  value={composing.assignee}
                  onChange={(e) => setComposing({ ...composing, assignee: e.target.value })}
                  placeholder="Anyone on the platform"
                  className={inputCls}
                />
                <datalist id="team-board-people">
                  {people.map((p) => <option key={p} value={p} />)}
                </datalist>
              </Field>
              <Field label="Due">
                <input
                  type="date"
                  value={composing.dueDate}
                  onChange={(e) => setComposing({ ...composing, dueDate: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority">
                <div className="flex gap-1">
                  {(['high', 'medium', 'low'] as Priority[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setComposing({ ...composing, priority: p })}
                      className={cn(
                        'h-9 flex-1 rounded-md border text-[12px] font-semibold transition-colors',
                        composing.priority === p
                          ? 'border-primary bg-primary-soft text-primary-strong'
                          : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                      )}
                    >
                      {PRIORITY[p].label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Column">
                <select
                  value={composing.column}
                  onChange={(e) => setComposing({ ...composing, column: e.target.value as ColumnId })}
                  className={inputCls}
                >
                  {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* THE GESTOR IS PICKED, NEVER TYPED — they have to exist in
                  the system, so the field is a select over the platform's
                  own people. */}
              <Field label="Gestor">
                <select
                  value={composing.manager}
                  onChange={(e) => setComposing({ ...composing, manager: e.target.value })}
                  className={inputCls}
                >
                  <option value="">No gestor</option>
                  {gestorOptions(people).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Project">
                <select
                  value={composing.projectId}
                  onChange={(e) => setComposing({ ...composing, projectId: e.target.value })}
                  className={inputCls}
                >
                  <option value="">No project</option>
                  {activeProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client">
                <input
                  value={composing.client}
                  onChange={(e) => setComposing({ ...composing, client: e.target.value })}
                  placeholder="Optional"
                  className={inputCls}
                />
              </Field>
              <Field label="Labels">
                <input
                  value={composing.labels}
                  onChange={(e) => setComposing({ ...composing, labels: e.target.value })}
                  placeholder="comma, separated"
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Attachments — images, text files, Google Sheets">
              <div className="space-y-2">
                {attachmentsOf(composing).map((a, i) => (
                  <div key={`${a.url}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                    {a.kind === 'image'
                      ? <img src={a.url} alt="" className="h-8 w-12 rounded-sm object-cover" />
                      : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-tint-blue text-[10px] font-bold text-tint-fg-blue">{a.kind === 'sheet' ? 'GS' : 'TXT'}</span>}
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text-1">{a.name || a.url}</span>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => {
                        const next = attachmentsOf(composing).filter((_, k) => k !== i)
                        setComposing({ ...composing, attachments: JSON.stringify(next) })
                      }}
                      className="shrink-0 rounded-sm px-1.5 text-[13px] text-text-3 hover:text-tint-fg-pink"
                    >×</button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setImgOpen(true)}
                    className="h-8 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 hover:bg-surface-2"
                  >+ Image</button>
                  <label className="flex h-8 cursor-pointer items-center rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 hover:bg-surface-2">
                    + Text file
                    <input
                      type="file" accept=".txt,.md,.csv,.log,text/plain" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachTextFile(f); e.target.value = '' }}
                    />
                  </label>
                  <input
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="Google Sheets link…"
                    className="h-8 min-w-[160px] flex-1 rounded-md border border-border bg-surface px-2 text-[12px] text-text-1 outline-none placeholder:text-text-3"
                  />
                  <button
                    type="button"
                    onClick={attachSheet}
                    className="h-8 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 hover:bg-surface-2"
                  >+ Sheet</button>
                </div>
              </div>
            </Field>
          </div>
          <UploadImageModal
            open={imgOpen}
            onOpenChange={setImgOpen}
            ratio={16 / 9}
            slotLabel="Kanban card"
            kinds={[{ value: 'attachment', label: 'Attachment' }]}
            defaultKind="attachment"
            onUploaded={(img: UploadedImage) => addAttachment({ kind: 'image', url: img.src, name: img.title })}
          />
          <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {open?.id ? 'Save changes' : 'Add to board'}
            </button>
            <button
              onClick={() => setComposing(null)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
          </footer>
        </Drawer>
      )}

      {/* ---- the two boxes: finished work, and work called off ---- */}
      {archiveOpen && (
        <Drawer onClose={() => setArchiveOpen(null)}>
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 className="flex-1 text-[15px] font-bold text-text-1">
              {archiveOpen === 'done' ? `Done · ${done.length}` : `Cancelled · ${cancelled.length}`}
            </h2>
            <button onClick={() => setArchiveOpen(null)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
              <X size={15} />
            </button>
          </header>
          <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
            {(archiveOpen === 'done' ? done : cancelled).length === 0 ? (
              <EmptyState
                title={archiveOpen === 'done' ? 'Nothing finished yet' : 'Nothing cancelled'}
                body={archiveOpen === 'done'
                  ? 'Cards dragged to Done are kept here, newest first.'
                  : 'A card moved to Cancelled is kept here — called off, not deleted.'}
              />
            ) : (archiveOpen === 'done' ? done : cancelled).map((t) => (
              <button
                key={t.id}
                onClick={() => { setArchiveOpen(null); setOpen(t) }}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-surface p-2.5 text-left transition-colors hover:bg-surface-2"
              >
                {archiveOpen === 'done'
                  ? <Check size={14} className="shrink-0 text-tint-fg-mint" />
                  : <Ban size={14} className="shrink-0 text-text-3" />}
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13px] font-semibold text-text-1">{t.title || 'Untitled'}</span>
                  <span className="text-[11.5px] text-text-3">
                    <DragPerson name={t.assignee ?? ''} subtitle={t.title || undefined}>
                      {t.assignee || 'Unassigned'}
                    </DragPerson>
                    {archiveOpen === 'done'
                      ? (t.completedAt ? ` · ${ohioDay(t.completedAt)}` : '')
                      : (t.cancelledAt ? ` · ${ohioDay(t.cancelledAt)}` : '')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Drawer>
      )}
    </div>
  )
}

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-3">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</dt>
      <dd className="mt-0.5 text-[12.5px] text-text-1">{children}</dd>
    </div>
  )
}

// THE PROJECTS VIEW — full screen, because the app read as thin without it.
const PROJECT_STATUS_CHIP: Record<string, string> = {
  live: 'bg-tint-mint text-tint-fg-mint',
  operational: 'bg-tint-mint text-tint-fg-mint',
  in_use: 'bg-tint-blue text-tint-fg-blue',
  experimental: 'bg-tint-amber text-tint-fg-amber',
  framework: 'bg-tint-lavender text-tint-fg-lavender',
  early: 'bg-tint-peach text-tint-fg-peach',
  archived: 'bg-surface-3 text-text-3',
  unassessed: 'bg-surface-2 text-text-3',
}

type WorkItem = {
  id: string
  project?: string
  phase?: string
  workstream?: string
  title?: string
  outcome?: string
  priority?: string
  status?: string
  owner?: string
}

/** the work-item statuses folded into four honest buckets */
function wiBucket(status?: string): 'done' | 'doing' | 'blocked' | 'open' {
  const s = String(status ?? '').toLowerCase()
  if (/done|complete|shipped|closed/.test(s)) return 'done'
  if (/progress|doing|active|wip/.test(s)) return 'doing'
  if (/block|hold|stuck|risk/.test(s)) return 'blocked'
  return 'open'
}
const WI_BUCKET_META = {
  doing: { label: 'In motion', chip: 'bg-tint-amber text-tint-fg-amber' },
  open: { label: 'Open', chip: 'bg-tint-blue text-tint-fg-blue' },
  blocked: { label: 'Blocked', chip: 'bg-tint-pink text-tint-fg-pink' },
  done: { label: 'Done', chip: 'bg-tint-mint text-tint-fg-mint' },
} as const

function ProjectsView({ projects, tasks, onBack, onFocus }: {
  projects: PortfolioProject[]
  tasks: TeamTask[]
  onBack: () => void
  onFocus: (projectId: string) => void
}) {
  const [workItems, setWorkItems] = useState<WorkItem[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  // the 463 unread rows, loaded ONCE per view entry, failure = honest absence
  useEffect(() => {
    let alive = true
    api.list<WorkItem>('projectWorkItems')
      .then((r) => { if (alive) setWorkItems(Array.isArray(r) ? r : []) })
      .catch(() => { if (alive) setWorkItems([]) })
    return () => { alive = false }
  }, [])

  const cardsOf = (p: PortfolioProject) =>
    tasks.filter((t) => String(t.projectId ?? '') === String(p.id))
  const itemsOf = (p: PortfolioProject) => {
    const name = String(p.name ?? '').trim().toLowerCase()
    const id = String(p.id)
    return (workItems ?? []).filter((w) => {
      const wp = String(w.project ?? '').trim().toLowerCase()
      return wp && (wp === name || wp === id.toLowerCase())
    })
  }

  const sorted = [...projects].sort((a, b) =>
    ((cardsOf(b).length + itemsOf(b).length) - (cardsOf(a).length + itemsOf(a).length)) ||
    String(a.name ?? '').localeCompare(String(b.name ?? '')))
  const busy = sorted.filter((p) => cardsOf(p).length + itemsOf(p).length > 0)
  const listed = showAll ? sorted : (busy.length ? busy : sorted.slice(0, 12))

  return (
    <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-4 scroll-thin">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onBack}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2"
        >
          <X size={13} /> Back to the wall
        </button>
        <span className="text-[12.5px] text-text-3">
          {projects.length} project{projects.length === 1 ? '' : 's'} on the portfolio
          {workItems !== null && ` · ${workItems.length} work items on file`}
        </span>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="The portfolio is empty"
          body="Projects live in the Technology app; a card links to one from its edit form and everything reads here."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {listed.map((p) => {
            const cards = cardsOf(p)
            const items = itemsOf(p)
            const done = cards.filter((t) => columnOf(t) === 'done').length
            const cancelled = cards.filter((t) => columnOf(t) === 'cancelled').length
            const moving = cards.length - done - cancelled
            const pct = cards.length > 0 ? Math.round((done / cards.length) * 100) : 0
            const wiDone = items.filter((w) => wiBucket(w.status) === 'done').length
            const isOpen = expanded === String(p.id)
            return (
              <div key={p.id} className={cn('rounded-lg border border-border bg-surface p-4 shadow-1', isOpen && 'lg:col-span-2')}>
                <div className="flex items-start gap-2.5">
                  <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', PROJECT_STATUS_CHIP[String(p.status ?? '').toLowerCase()] ?? 'bg-surface-2 text-text-3')}>
                    <FolderKanban size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-text-1">{p.name || 'Unnamed'}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                        PROJECT_STATUS_CHIP[String(p.status ?? '').toLowerCase()] ?? 'bg-surface-2 text-text-3')}>
                        {String(p.status ?? '—').replace(/_/g, ' ')}
                      </span>
                      {p.category && <span className="text-[10.5px] uppercase tracking-wide text-text-3">{p.category}</span>}
                      {p.owner && (
                        <span className="ml-auto flex items-center gap-1 text-[11.5px] text-text-3">
                          {/* the OWNER is the person; p.id is the project's id, not theirs */}
                          <DragPerson name={String(p.owner)} subtitle={String(p.name ?? '') || undefined} className="items-center gap-1">
                            <Avatar name={String(p.owner)} size="xs" /> {p.owner}
                          </DragPerson>
                        </span>
                      )}
                    </div>
                    {p.blurb && <p className={cn('mt-1 text-[12.5px] leading-5 text-text-3', !isOpen && 'clamp-2')}>{p.blurb}</p>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-text-3">
                  <span>{cards.length} board card{cards.length === 1 ? '' : 's'}{moving ? ` · ${moving} moving` : ''}</span>
                  {workItems !== null && <span>{items.length} work item{items.length === 1 ? '' : 's'}{wiDone ? ` · ${wiDone} done` : ''}</span>}
                </div>
                {cards.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-tint-fg-mint transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-text-3">{done}/{cards.length} done{cancelled ? ` · ${cancelled} cancelled` : ''}</span>
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  {cards.length > 0 && (
                    <button onClick={() => onFocus(String(p.id))} className="text-[12px] font-semibold text-primary hover:underline">
                      Focus the wall on it
                    </button>
                  )}
                  {(cards.length > 0 || items.length > 0) && (
                    <button onClick={() => setExpanded(isOpen ? null : String(p.id))} className="text-[12px] font-semibold text-text-3 hover:text-text-1">
                      {isOpen ? 'Collapse' : 'Open — timeline & work items'}
                    </button>
                  )}
                </div>

                {isOpen && cards.length > 0 && <ProjectTimeline cards={cards} />}
                {isOpen && items.length > 0 && (
                  <div className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2 xl:grid-cols-4">
                    {(['doing', 'open', 'blocked', 'done'] as const).map((b) => {
                      const bucket = items.filter((w) => wiBucket(w.status) === b)
                      if (!bucket.length) return null
                      const meta = WI_BUCKET_META[b]
                      return (
                        <div key={b} className="min-w-0 rounded-md border border-border bg-surface-2/50 p-2">
                          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-text-3">
                            <span className={cn('rounded-full px-1.5 py-px text-[10px]', meta.chip)}>{meta.label}</span>
                            <span className="tabular-nums">{bucket.length}</span>
                          </p>
                          <div className="max-h-[240px] space-y-1 overflow-y-auto pr-1 scroll-thin">
                            {bucket.map((w) => (
                              <div key={w.id} className="rounded border border-border bg-surface px-2 py-1.5">
                                <p className="clamp-2 text-[11.5px] font-semibold leading-4 text-text-1">{w.title || 'Untitled'}</p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-text-3">
                                  {w.phase && <span>{w.phase}</span>}
                                  {w.workstream && <span>{w.workstream}</span>}
                                  {w.owner && (
                                    <span>
                                      <DragPerson name={w.owner} subtitle={w.project || w.workstream || undefined}>
                                        {w.owner}
                                      </DragPerson>
                                    </span>
                                  )}
                                  {w.priority && <span className="uppercase">{w.priority}</span>}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {!showAll && sorted.length > listed.length && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 w-full py-1 text-center text-[12px] font-semibold text-text-3 hover:text-text-1"
        >
          Show the whole portfolio ({sorted.length})
        </button>
      )}
    </div>
  )
}

// THE TIMELINE.
function ProjectTimeline({ cards }: { cards: TeamTask[] }) {
  const dayMs = 86_400_000
  const parse = (v?: string) => {
    const t = Date.parse(String(v ?? ''))
    return Number.isNaN(t) ? null : t
  }
  const rows = cards.map((t) => {
    const start = parse(t.createdAt) ?? parse(t.dueDate)
    const end = parse(t.completedAt) ?? parse(t.dueDate) ?? (start !== null ? start + dayMs : null)
    return { t, start, end }
  })
  const dated = rows.filter((r) => r.start !== null && r.end !== null) as { t: TeamTask; start: number; end: number }[]
  const undated = rows.filter((r) => r.start === null || r.end === null).map((r) => r.t)
  if (!dated.length) {
    return <p className="mt-2 text-[11.5px] italic text-text-3">No dated cards — give them due dates and the timeline draws itself.</p>
  }
  const min = Math.min(...dated.map((r) => r.start))
  const max = Math.max(...dated.map((r) => Math.max(r.end, r.start + dayMs)), min + dayMs)
  const span = max - min
  const pctOf = (v: number) => Math.max(0, Math.min(100, ((v - min) / span) * 100))
  const today = Date.now()
  const todayPct = today >= min && today <= max ? pctOf(today) : null

  return (
    <div className="relative mt-3 space-y-1 border-t border-border/60 pt-2">
      {todayPct !== null && (
        <div
          className="pointer-events-none absolute bottom-0 top-2 w-px bg-tint-fg-pink/60"
          style={{ left: `calc(${todayPct}% )` }}
          title="Today"
        />
      )}
      {dated
        .sort((a, b) => a.start - b.start)
        .map(({ t, start, end }) => (
          <div key={t.id} className="flex items-center gap-2">
            <span className="clamp-1 w-[132px] shrink-0 text-[11px] leading-4 text-text-2" title={t.title}>
              {t.title || 'Untitled'}
            </span>
            <div className="relative h-3 min-w-0 flex-1 rounded-full bg-surface-2">
              <div
                className={cn('absolute inset-y-0 rounded-full', COLUMN_TINT[columnOf(t)])}
                style={{
                  left: `${pctOf(start)}%`,
                  width: `${Math.max(2.5, pctOf(Math.max(end, start + dayMs)) - pctOf(start))}%`,
                }}
                title={`${ohioDay(new Date(start).toISOString())} → ${ohioDay(new Date(end).toISOString())}`}
              />
            </div>
            <span className="w-[54px] shrink-0 text-right text-[10.5px] tabular-nums text-text-3">
              {t.dueDate ? ohioDay(String(t.dueDate)) : t.completedAt ? ohioDay(String(t.completedAt)) : ''}
            </span>
          </div>
        ))}
      {undated.length > 0 && (
        <p className="pt-1 text-[10.5px] text-text-3">{undated.length} undated card{undated.length === 1 ? '' : 's'} not drawn.</p>
      )}
    </div>
  )
}

// A DRAWER, NOT A MODAL.
function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col border-l border-border bg-surface shadow-3 sm:w-[384px]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
