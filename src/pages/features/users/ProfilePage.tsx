// THE STAFF PROFILE — v1: click a user in the Users app and the person opens.
// Modeled on the wireframe's entity profile — header (avatar, name, badges, contact) over an internal rail…
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  Activity as ActivityIcon, ArrowLeft, Car, CheckCircle2, ClipboardList, Clock,
  FileSpreadsheet, FileText, FolderOpen, GraduationCap, Image as ImageIcon,
  LifeBuoy, Loader2, Mail, MessageSquare, Phone, ShieldCheck, Stethoscope, User as UserIcon, X,
} from 'lucide-react'
import { TINT_BG, TINT_FG, TINT_PAIR } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { useShiftData } from '@/pages/features/shifts/useShiftData'
import { kindChipClasses } from '@/pages/features/shifts/shiftUi'
// the same Time switch the Shift Board's calendars answer to — one person, one choice, and this card is the same…
import { useClockTimes } from '@/pages/features/shifts/clockPref'
import { cellText } from '@/pages/features/shifts/cellClock'
// the platform's own client-name key (letters + digits) — the SAME reduction Clients.gs joins on, so a hand-fed…
import { nameKey } from '@/pages/features/clients/shared'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { BankGrid } from '@/components/shared/EditRecordModal'
import RoleBadge, { TypeBadges, badgeWord } from '@/components/shared/RoleBadge'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import { keepIfCurrent, keptGeneration, readKept } from '@/lib/kept'
import { openFile } from '@/stores/useFileViewerStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { ROLE_LABEL, type Role } from '@/auth/types'
import { toast } from '@/stores/useToastStore'
import { format } from 'date-fns'
import { ohioDay, ohioDayYear, ohioTime, ohioWall } from '@/lib/ohio'
import { formatPhoneDisplay, formatPhoneE164, formatPhoneList } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'

/** The account's Contacts edit — the Users section's own, loaded only when asked for. */
const ContactsDialog = lazy(() => import('@/pages/settings/UsersSection').then((m) => ({ default: m.ContactsDialog })))

const SECTIONS = [
  { id: 'information', label: 'Information', icon: UserIcon, tint: 'blue' },
  { id: 'documents', label: 'Documents', icon: FolderOpen, tint: 'mint' },
  { id: 'reports', label: 'Reports', icon: ClipboardList, tint: 'lavender' },
  { id: 'activity', label: 'Activity', icon: ActivityIcon, tint: 'amber' },
  { id: 'shifts', label: 'Shifts', icon: Clock, tint: 'pink' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

// THE PROFILE IS KEPT — stored rather than volatile, in local storage, because these reads matter too much to lose.
function ohioStamp(v?: string): string {
  if (!v) return ''
  const t = ohioTime(v)
  return t ? `${ohioDay(v)} · ${t}` : String(v)
}

/** A stored DAY on Ohio's clock (the mirrors serialize date cells as UTC stamps); free text passes through. */
function ohioDayText(v?: string): string {
  const raw = String(v ?? '').trim()
  if (!raw) return ''
  const d = ohioWall(raw)
  return d ? format(d, 'MMM d, yyyy') : raw
}

// keep/readKept moved to @/lib/kept — Staff Performance keeps its profiles the same way, and two copies of a…

/** Rotating pastel for the summary's highlight chips — life, house palette. */
const CHIP_TINTS: TintName[] = ['mint', 'blue', 'lavender', 'amber', 'pink']

type DocItem = { doc_id: string; label: string; status: string; file_url: string }
type LogEvent = { at: string; actor: string; action: string; area: string; summary: string }
type CandRow = { id: string; name: string; summary?: string; score?: number | null; resumeLink?: string; stage?: string }

// The usersList row fields this page reads (usersDirectory hands back untyped rows on purpose — the directory…
export type UserRow = {
  id?: string
  email?: string
  display_name?: string
  role?: string
  types?: string[]
  title?: string
  phone?: string
  phones?: { label?: string; number: string }[]
  /** the platform contact link (ContactsSync.gs) */
  people_id?: string
  roster_status?: string
  employee_id?: string
  start_date?: string
  end_date?: string
  contact_sources?: Record<string, string>
  contact_synced_at?: string
  emails?: string[]
  avatar?: string
  active?: boolean | string
  created_at?: string
  last_login?: string
  candidate_id?: string
  /** the CLIENT this account is (client logins) — set by clientUserCreate */
  client_key?: string
}

// Slightly squarer than the house 20px, still round-sided.
const field = 'rounded-[10px] border border-border bg-surface-2/40 px-3 py-2.5'
const CARD = 'rounded-md'

export default function StaffProfilePage() {
  const role = useAuthStore((s) => s.user?.role)
  const isMaster = useAuthStore((s) => s.user?.isMaster === true)
  const [params, setParams] = useSearchParams()
  const uid = params.get('u') ?? ''
  // ?contacts=1&add_email=…|add_phone=… opens the account's own Contacts with that value filled in (Support…
  const contactsAsk = useMemo(() => {
    if (params.get('contacts') !== '1') return null
    const email = (params.get('add_email') ?? '').trim()
    const phone = (params.get('add_phone') ?? '').trim()
    return email || phone ? { email, phone } : null
  }, [params])
  const closeContacts = useCallback(() => {
    setParams((p) => {
      const next = new URLSearchParams(p)
      next.delete('contacts')
      next.delete('add_email')
      next.delete('add_phone')
      return next
    }, { replace: true })
  }, [setParams])
  const navigate = useNavigate()
  // WHERE THE PERSON CAME FROM (state.from, set by whoever opened this profile — a coverage row's "Open profile"…
  const from = (useLocation().state as { from?: string } | null)?.from
  const [users, setUsers] = useState<UserRow[]>(() => (cachedUsers() ?? []) as UserRow[])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pickingPhoto, setPickingPhoto] = useState(false)
  const reload = useCallback(() => {
    fetchUsers({ force: true }).then((rows) => setUsers(rows as UserRow[])).catch(() => {})
  }, [])
  // THE DEEP PROFILE: every source, crossed — the roster, the certs, the shifts, the IST, their Drive folder, the…
  const [deep, setDeep] = useState<DeepProfile | null>(() => readKept<DeepProfile>(`asa:profile:${uid}`))
  // busy starts true only when there is nothing kept to show
  const [deepBusy, setDeepBusy] = useState(deep === null)
  // no sync setState in here — the mount effect calls it, and the lint law holds; the Refresh CLICK arms the…
  const loadDeep = useCallback((refresh?: boolean) => {
    if (!uid) return
    // a read still in flight at a sign-out or a crossing keeps nothing (lib/kept)
    const generation = keptGeneration()
    gasAction<DeepProfile>('userProfileDeep', refresh ? { user_id: uid, refresh: true } : { user_id: uid }, { timeoutMs: 120000 })
      .then((d) => { setDeep(d); keepIfCurrent(`asa:profile:${uid}`, d, generation) })
      .catch(() => { /* the kept copy stands; a failed refresh must not blank it */ })
      .finally(() => setDeepBusy(false))
  }, [uid])
  useEffect(() => { loadDeep() }, [loadDeep])

  useEffect(() => {
    let alive = true
    fetchUsers().then((rows) => { if (alive) { setUsers(rows as UserRow[]); setLoaded(true) } })
      .catch(() => setLoaded(true))
    return () => { alive = false }
  }, [])

  const me = useAuthStore((s) => s.user)
  // the session's own account answers from the auth answer when no list carries it
  const u = useMemo<UserRow | undefined>(() => users.find((x) => x.id === uid) ?? (me && me.id === uid
    ? { id: me.id, email: me.email, display_name: me.name, role: me.role, types: me.types, title: me.title,
        phone: me.phone, phones: me.phones, emails: me.emails, avatar: me.avatar, active: true }
    : undefined), [users, uid, me])

  // A CLIENT WITHOUT A USER ACCOUNT BELONGS ON THE CLIENT PROFILE — a client with no user profile is sent to the…
  const [clientChecked, setClientChecked] = useState(false)
  useEffect(() => {
    if (u || !loaded || !uid || clientChecked) return
    void api.list<{ id?: unknown }>('clients')
      .then((rows) => {
        if ((Array.isArray(rows) ? rows : []).some((r) => String(r.id ?? '') === uid)) {
          navigate(`/app/clients/unique?record=${encodeURIComponent(uid)}`, { replace: true })
        }
      })
      .catch(() => {})
      .finally(() => setClientChecked(true))
  }, [u, loaded, uid, clientChecked, navigate])

  if (role !== 'admin') return <Navigate to="/apps" replace />
  if (!uid) return <Navigate to="/app/users/accounts" replace />
  if (!u && loaded) {
    return (
      <div className="mx-auto max-w-[480px] pt-16 text-center">
        {clientChecked ? (
          <>
            <p className="text-[14px] font-semibold text-text-1">No account with that id.</p>
            <button onClick={() => navigate(from ?? '/app/users/accounts')} className="mt-3 text-[13px] font-semibold text-primary">{from ? 'Back' : 'Back to Users'}</button>
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Looking for the person…</p>
        )}
      </div>
    )
  }
  if (!u) {
    return <p className="flex items-center gap-2 py-10 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the account…</p>
  }

  return (
    <div>
      <button onClick={() => navigate(from ?? '/app/users/accounts')} className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-3 hover:text-text-1">
        <ArrowLeft size={13} /> {from ? 'Back' : 'Users'}
      </button>

      {/* ── the header — the wireframe's ent-hdr, our materials ── */}
      <Card className={cn(CARD, 'mb-4 flex flex-wrap items-center gap-4 p-4')}>
        {/* the initials tile is a DOOR: click it and
            pick a photo the platform already holds — the Image Bank */}
        {/* the wrapper carries the DRAG, the button keeps its click: one
            gesture picks the photo, the other sends the person to the tracker */}
        <DragPerson
          name={u.display_name || u.email || ''}
          id={u.id}
          type={u.client_key ? 'client' : 'staff'}
          avatar={u.avatar}
          subtitle={u.title}
          className="shrink-0"
        >
          {isMaster ? (
            <button
              onClick={() => setPickingPhoto(true)}
              title="Set their photo from the Image Bank"
              className="rounded-full transition-opacity hover:opacity-80"
            >
              <Avatar src={u.avatar ?? ''} name={u.display_name || u.email || '?'} size="lg" />
            </button>
          ) : (
            <Avatar src={u.avatar ?? ''} name={u.display_name || u.email || '?'} size="lg" />
          )}
        </DragPerson>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DragPerson
              name={u.display_name || u.email || ''}
              id={u.id}
              type={u.client_key ? 'client' : 'staff'}
              avatar={u.avatar}
              subtitle={u.title}
            >
              <h1 className="text-[18px] font-bold text-text-1">{u.display_name || u.email}</h1>
            </DragPerson>
            {/* The role chip only when the TYPE list does not already say the
                same word — a client account carries role "client" AND the
                CLIENT badge, and the header read CLIENT twice. */}
            {!(u.types ?? []).some((t) => String(t).toUpperCase().trim() === String(u.role ?? '').toUpperCase().trim()) && (
              <RoleBadge user={{ role: u.role as Role, isMaster: false }} size="xs" />
            )}
            <TypeBadges user={{ role: u.role as Role, isMaster: false, types: u.types }} size="xs" />
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
              String(u.active ?? 'true') !== 'false' ? 'bg-success/10 text-success' : 'bg-surface-3 text-text-3',
            )}>
              {String(u.active ?? 'true') !== 'false' ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-text-3">
            {u.title && <span>{u.title}</span>}
            {/* people carry SEVERAL e-mails and phones — every one shows,
                deduped, roster filling a blank account */}
            <span className="inline-flex items-center gap-1"><Mail size={11} /> {u.email}</span>
            {(u.emails ?? []).filter((e) => e && e !== u.email).map((e) => (
              <span key={e} className="inline-flex items-center gap-1"><Mail size={11} /> {e}</span>
            ))}
            {(() => {
              const nums: string[] = []
              // deduped on E.164, so '(330) 919-5558' and '+13309195558' read as the one number they are
              const push = (raw?: string) => {
                if (!raw) return
                const n = formatPhoneE164(raw)
                if (!nums.includes(n)) nums.push(n)
              }
              push(u.phone)
              ;(u.phones ?? []).forEach((p) => push(p.number))
              push(deep?.roster?.phone)
              return nums.map((n) => (
                <span key={n} className="inline-flex items-center gap-1"><Phone size={11} /> {formatPhoneDisplay(n)}</span>
              ))
            })()}
          </p>
          {/* a little life: what the crossed sources counted, at a glance */}
          {deep && (deep.certs?.length || deep.shifts?.count) ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {deep.certs && deep.certs.length > 0 && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', TINT_PAIR('mint'))}>
                  {deep.certs.length} certification{deep.certs.length === 1 ? '' : 's'}
                </span>
              )}
              {deep.shifts && deep.shifts.count > 0 && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', TINT_PAIR('blue'))}>
                  {deep.shifts.count} shift{deep.shifts.count === 1 ? '' : 's'}
                </span>
              )}
              {deep.ist && deep.ist.length > 0 && (
                <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', TINT_PAIR('lavender'))}>
                  {deep.ist.length} IST record{deep.ist.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          ) : null}
        </div>
        {isMaster && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
          >
            Edit profile
          </button>
        )}
      </Card>
      {editing && u && (
        <EditProfileDialog
          u={u}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false)
            reload()
            // The deep profile serves a 6-hour STORED copy — without the refresh flag a just-saved edit redraws as…
            setDeepBusy(true)
            loadDeep(true)
          }}
        />
      )}
      {contactsAsk && u && (
        <Suspense fallback={null}>
          <ContactsDialog
            user={u as never}
            add={contactsAsk}
            onClose={closeContacts}
            onDone={async () => {
              reload()
              setDeepBusy(true)
              loadDeep(true)
            }}
          />
        </Suspense>
      )}
      {pickingPhoto && u && (
        <PickPhotoDialog
          u={u}
          onClose={() => setPickingPhoto(false)}
          onDone={() => {
            setPickingPhoto(false)
            reload()
            // same staleness law as the profile edit — the new photo must not redraw from the 6-hour store
            setDeepBusy(true)
            loadDeep(true)
          }}
        />
      )}

      <ProfileSummaryCard deep={deep} busy={deepBusy} onRefresh={() => { setDeepBusy(true); loadDeep(true) }}
        className="mb-4" />

      <ProfileSections u={u} deep={deep} />
    </div>
  )
}

// THE DEEP PROFILE, ON ITS OWN SO TWO SCREENS CAN HOLD IT.
export function useDeepProfile(uid: string) {
  const [deep, setDeep] = useState<DeepProfile | null>(() => readKept<DeepProfile>(`asa:profile:${uid}`))
  const [busy, setBusy] = useState(deep === null)
  const load = useCallback((refresh?: boolean) => {
    if (!uid) return
    const generation = keptGeneration()
    gasAction<DeepProfile>('userProfileDeep', refresh ? { user_id: uid, refresh: true } : { user_id: uid }, { timeoutMs: 120000 })
      .then((d) => { setDeep(d); keepIfCurrent(`asa:profile:${uid}`, d, generation) })
      .catch(() => { /* the kept copy stands; a failed refresh must not blank it */ })
      .finally(() => setBusy(false))
  }, [uid])
  useEffect(() => { load() }, [load])
  const refresh = useCallback(() => { setBusy(true); load(true) }, [load])
  return { deep, busy, refresh }
}

// THE SUMMARY CARD — the paragraph the platform composes over every source, its chips, and the line saying which…
export function ProfileSummaryCard({ deep, busy, onRefresh, className }: {
  deep: DeepProfile | null
  busy: boolean
  onRefresh: () => void
  className?: string
}) {
  return (
    <Card className={cn(CARD, 'p-4', className)}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[13.5px] font-bold text-text-1">Profile summary</p>
        {busy && <Loader2 size={13} className="animate-spin text-text-3" />}
        <button
          onClick={onRefresh}
          disabled={busy}
          className="ml-auto text-[11.5px] font-semibold text-primary disabled:opacity-40"
          title="Re-reads every source and re-writes the summary"
        >
          Refresh
        </button>
      </div>
      {deep?.summary ? (
        <>
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-text-2">{deep.summary}</p>
          {deep.highlights.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {deep.highlights.map((h, i) => (
                <span key={i} className={cn('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', TINT_PAIR(CHIP_TINTS[i % CHIP_TINTS.length]))}>{h}</span>
              ))}
            </div>
          )}
        </>
      ) : busy ? (
        <p className="text-[12.5px] text-text-3">Crossing every source — the roster, the certifications, the shifts, their documents…</p>
      ) : (
        <p className="text-[12.5px] italic text-text-3">No sources answered for this person yet.</p>
      )}
      {deep && (deep.sources.length > 0 || deep.unreadable.length > 0 || deep.stored_at) && (
        <p className="mt-2 border-t border-border/60 pt-2 text-[11px] text-text-3">
          {deep.stored_at && <span className="mr-2">On record since {ohioStamp(deep.stored_at)} · re-assembled after {6}h or on Refresh.</span>}
          {deep.sources.length > 0 && <>Sources: {deep.sources.join(' · ')}</>}
          {deep.unreadable.length > 0 && <span className="ml-2 text-warning">Unreadable: {deep.unreadable.join(' · ')}</span>}
        </p>
      )}
    </Card>
  )
}

// THE RAIL AND THE FIVE SECTIONS — Information, Documents, Reports, Activity, Shifts.
export function ProfileSections({ u, deep }: { u: UserRow; deep: DeepProfile | null }) {
  const [section, setSection] = useState<SectionId>('information')
  return (
    <div className="flex flex-wrap gap-4 md:flex-nowrap">
      <aside className="w-full shrink-0 md:w-44">
        <div className="rounded-md border border-border bg-surface p-1.5 md:sticky md:top-4">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] font-medium',
                  section === s.id ? 'bg-primary-soft text-primary' : 'text-text-2 hover:bg-surface-2',
                )}
              >
                <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-[8px]', TINT_BG[s.tint as TintName], TINT_FG[s.tint as TintName])}>
                  <Icon size={13} />
                </span>
                {s.label}
              </button>
            )
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {section === 'information' && <InformationSection u={u} deep={deep} />}
        {section === 'documents' && <DocumentsSection u={u} deep={deep} />}
        {section === 'reports' && <ReportsSection u={u} />}
        {section === 'activity' && <ActivitySection u={u} deep={deep} />}
        {section === 'shifts' && <ShiftsSection u={u} deep={deep} />}
      </div>
    </div>
  )
}

function Item({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className={field}>
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-text-3">{label}</p>
      <p className="mt-0.5 text-[13px] font-normal text-text-1">{value || <span className="text-text-3">Not on file</span>}</p>
    </div>
  )
}

// ISO-shaped values render as a plain day ("Mon D, YYYY") — judged by SHAPE and sliced, never parsed through Date…
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dayText(v?: string): string | undefined {
  if (!v) return v
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return v
  const month = MONTHS_SHORT[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : v
}

function InformationSection({ u, deep }: { u: UserRow; deep: DeepProfile | null }) {
  const house = u.client_key ? deep?.house : undefined
  return (
    <Card className={cn(CARD, 'p-4')}>
      {/* THE HOUSE SQUARE — a small square carrying the house, its name, its
          photo and its address: the
          ist_houses join, the plan's own address, the Image Bank scene whose
          title is the house code. Nothing here is guessed. */}
      {house && (house.name || house.code || house.address) && (
        <div className="mb-4 flex items-center gap-3.5 rounded-[12px] border border-border bg-surface-2/40 p-3">
          {house.photo ? (
            <img src={house.photo} alt={house.name || house.code || 'House'} className="h-16 w-20 shrink-0 rounded-md border border-border object-cover" />
          ) : (
            <span className="grid h-16 w-20 shrink-0 place-items-center rounded-md bg-tint-blue text-[15px] font-bold text-tint-fg-blue">
              {(house.name || house.code || '?').slice(0, 4)}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-text-1">{house.name || house.code || 'House'}</p>
            {house.code && house.name && <p className="text-[11px] uppercase tracking-wide text-text-3">{house.code}</p>}
            <p className="mt-0.5 text-[12.5px] text-text-2">
              {house.address || <span className="italic text-text-3">Address not on file</span>}
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <Item
          label="Name"
          value={
            u.display_name ? (
              <DragPerson
                name={u.display_name}
                id={u.id}
                type={u.client_key ? 'client' : 'staff'}
                avatar={u.avatar}
                subtitle={u.title}
              >
                {u.display_name}
              </DragPerson>
            ) : undefined
          }
        />
        <Item label="Sign-in e-mail" value={u.email} />
        <Item label="Role" value={ROLE_LABEL[u.role as Role] ?? u.role} />
        <Item label="Badges" value={(u.types ?? []).join(', ')} />
        <Item label="Job title" value={u.title} />
        {/* the account row may have no phone while the roster does — the
            person HAS a number, so the field says it. The source cell keeps
            its spelling. */}
        {(() => {
          const n = u.phone || u.phones?.[0]?.number || deep?.roster?.phone
          return <Item label="Phone" value={n ? formatPhoneDisplay(n) : undefined} />
        })()}
        {(u.phones ?? []).slice(1).map((p) => (
          <Item key={p.number} label={p.label || 'Phone'} value={formatPhoneDisplay(p.number)} />
        ))}
        {(u.emails ?? []).map((e, i) => (
          <Item key={e} label={`E-mail ${i + 2}`} value={e} />
        ))}
        <Item label="Created" value={dayText(u.created_at)} />
        <Item label="Last sign-in" value={u.last_login ? ohioStamp(u.last_login) : undefined} />
        <Item label="Account" value={String(u.active ?? 'true') !== 'false' ? 'Active' : 'Inactive'} />
        {/* WHAT THE PLATFORM KNOWS (ContactsSync.gs): the roster
            status is information beside the account flag, never over it; the
            employment facts were filled blank-only and each names its source
            in the label, the way the roster items below always have. */}
        {u.roster_status && <Item label="Roster status (platform)" value={u.roster_status} />}
        {u.employee_id && <Item label={`Employee ID${u.contact_sources?.employee_id ? ' (platform)' : ''}`} value={u.employee_id} />}
        {u.start_date && <Item label={`Start date${u.contact_sources?.start_date ? ' (platform)' : ''}`} value={ohioDayText(u.start_date)} />}
        {u.end_date && <Item label={`End date${u.contact_sources?.end_date ? ' (platform)' : ''}`} value={ohioDayText(u.end_date)} />}
        {u.contact_synced_at && (
          <Item label="Platform contacts" value={`linked${u.people_id ? ` to ${u.people_id}` : ''} · synced ${ohioStamp(u.contact_synced_at)}`} />
        )}
        {/* only when the roster says something DIFFERENT — the fallback above
            already covers the blank-account case, twice would be noise */}
        {deep?.roster?.phone && u.phone &&
          formatPhoneE164(u.phone) !== formatPhoneE164(deep.roster.phone) && (
          <Item label="Phone (roster)" value={formatPhoneDisplay(deep.roster.phone)} />
        )}
        {deep?.roster?.department && <Item label="Department (roster)" value={deep.roster.department} />}
        {deep?.roster?.location && <Item label="Location (roster)" value={deep.roster.location} />}
        {deep?.shifts && (
          <Item
            label="Shifts"
            value={`${deep.shifts.count} on the roster · ${deep.shifts.houses.join(', ')}${deep.shifts.last ? ` · last ${dayText(deep.shifts.last)}` : ''}`}
          />
        )}
      </div>
      {deep?.certs && deep.certs.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Certifications (estate)</p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {deep.certs.map((c) => <Item key={c.cert} label={c.cert} value={dayText(c.date)} />)}
          </div>
        </div>
      )}
      {deep?.ist && deep.ist.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-text-3">IST records</p>
          <div className="space-y-1">
            {deep.ist.map((r, i) => (
              <p key={i} className="text-[12.5px] text-text-2">
                {/* the line names a CLIENT — only that word is the person, the
                    house and the status ride along as plain text */}
                <DragPerson name={r.client} id={r.client} type="client" subtitle={r.house || 'IST'}>
                  {r.client}
                </DragPerson>
                {r.house ? ` · ${r.house}` : ''} — <span className={r.status === 'done' ? 'text-success' : 'text-warning'}>{r.status || 'owed'}</span>{r.due ? ` · due ${dayText(r.due)}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ---- THE DOCUMENT FOLDER — every user's documents available on their own profile.

type DriveDoc = { id: string; name: string; url: string; mime: string; updated: string }
type UserDocs = {
  name: string
  folder: { id: string; name: string; url: string } | null
  groups: { name: string; files: DriveDoc[] }[]
  loose: DriveDoc[]
  ambiguous: boolean
  root_unreadable: boolean
}

const CATEGORY_ICON: Record<string, typeof FileText> = {
  'Background Checks': ShieldCheck,
  Medical: Stethoscope,
  Driving: Car,
  Training: GraduationCap,
  Other: FolderOpen,
  Records: ClipboardList,
}

function mimeIcon(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon
  if (mime.includes('spreadsheet') || mime.includes('excel')) return FileSpreadsheet
  return FileText
}

// A readable label: extension dropped, the person's own name unstuttered — "Latiana Cooper - CPR Certificate.jpeg"…
function docLabel(name: string, person: string) {
  let s = name.replace(/\.(pdf|jpe?g|png|webp|docx?|xlsx?|gif|heic)$/i, '')
  const p = person.trim()
  if (p.length >= 5) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig')
    s = s.replace(re, '').replace(/^[\s\-–_]+|[\s\-–_]+$/g, '').replace(/\s{2,}/g, ' ')
  }
  return s || name
}

function CategoryCard({ name, files, person }: { name: string; files: DriveDoc[]; person: string }) {
  const Icon = CATEGORY_ICON[name] ?? FolderOpen
  return (
    <Card className={cn(CARD, 'p-0')}>
      <p className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
          <Icon size={13} />
        </span>
        <span className="text-[13px] font-bold text-text-1">{name}</span>
        <span className="ml-auto text-[11.5px] font-semibold tabular-nums text-text-3">{files.length}</span>
      </p>
      <div className="divide-y divide-border/60">
        {files.map((f) => {
          const MIcon = mimeIcon(f.mime)
          return (
            <button
              key={f.id}
              onClick={() => openFile({ url: f.url, title: `${person} — ${docLabel(f.name, person)}`, icon: 'file-text' })}
              title={f.name}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <MIcon size={14} className="shrink-0 text-text-3" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text-1">{docLabel(f.name, person)}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-text-3">{dayText(f.updated)}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// Everything on file for the person: their document folder (categories + loose HR records), the deep profile's…
function DocumentsSection({ u, deep }: { u: UserRow; deep: DeepProfile | null }) {
  if (u.client_key) return <ClientDocumentsSection deep={deep} />
  return <StaffDocumentsSection u={u} deep={deep} />
}

// A CLIENT ACCOUNT'S DOCUMENTS ARE THE PLAN — ONLY the ISP for now — documents carries only the ISP for the moment…
function ClientDocumentsSection({ deep }: { deep: DeepProfile | null }) {
  {
    const isp = deep?.files?.[0]
    return (
      <div className="space-y-3">
        {isp?.url ? (
          <Card className={cn(CARD, 'p-0')}>
            <button
              onClick={() => openFile({ url: isp.url, title: isp.name, subtitle: isp.updated || 'Individual Service Plan', icon: 'clipboard-list' })}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-lavender text-tint-fg-lavender"><FileText size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-text-1">{isp.name}</span>
                <span className="block text-[11.5px] text-text-3">{isp.updated || 'ISP'} · opens in the platform viewer</span>
              </span>
            </button>
          </Card>
        ) : (
          <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No ISP document matched this client's name in the ISP folder.</Card>
        )}
        <p className="text-[11.5px] text-text-3">A client account carries the plan alone for now — other document kinds arrive later.</p>
      </div>
    )
  }
}

function StaffDocumentsSection({ u, deep }: { u: UserRow; deep: DeepProfile | null }) {
  const person = u.display_name || u.email || ''
  const [items, setItems] = useState<DocItem[] | null | 'none'>(u.candidate_id ? null : 'none')
  useEffect(() => {
    if (!u.candidate_id) return
    gasAction<{ items: DocItem[] }>('docList', { candidate_id: u.candidate_id })
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems('none'))
  }, [u.candidate_id])
  const [docs, setDocs] = useState<UserDocs | null | 'error'>(() => readKept<UserDocs>(`asa:profile:docs:${u.id}`))
  useEffect(() => {
    const generation = keptGeneration()
    gasAction<UserDocs>('userDriveDocs', { user_id: u.id })
      .then((d) => { setDocs(d); keepIfCurrent(`asa:profile:docs:${u.id}`, d, generation) })
      .catch(() => setDocs((prev) => prev ?? 'error'))
  }, [u.id])

  const driveBlock = deep?.files && deep.files.length > 0 && (
    <Card className={cn(CARD, 'p-0')}>
      <p className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">
        Drive folder
        {deep.folder && (
          <a href={deep.folder.url} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-semibold text-primary">
            {deep.folder.name}
          </a>
        )}
        <span className="ml-auto text-[11.5px] font-semibold text-text-3">{deep.files.length} files</span>
      </p>
      <div className="divide-y divide-border/60">
        {deep.files.map((f) => (
          <div key={f.id} className="flex items-center gap-2.5 px-3 py-2">
            <FileText size={14} className="shrink-0 text-text-3" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{f.name}</span>
            <span className="text-[11px] text-text-3">{f.updated}</span>
            <button
              onClick={() => openFile({ url: f.url, title: f.name, icon: 'file-text' })}
              className="text-[12px] font-semibold text-primary"
            >
              View
            </button>
          </div>
        ))}
      </div>
    </Card>
  )

  const folderCount = docs && docs !== 'error'
    ? docs.groups.reduce((n, g) => n + g.files.length, 0) + docs.loose.length
    : 0
  const folderBlock = (
    <>
      {docs === null && (
        <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
          <Loader2 size={15} className="animate-spin" /> Reading the document folder…
        </p>
      )}
      {docs && docs !== 'error' && (docs.groups.length > 0 || docs.loose.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <p className="text-[13px] font-bold text-text-1">Document folder</p>
            {docs.folder && (
              <a href={docs.folder.url} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-semibold text-primary hover:underline">
                Open in Drive
              </a>
            )}
            <span className="ml-auto text-[11.5px] font-semibold tabular-nums text-text-3">
              {folderCount} {folderCount === 1 ? 'file' : 'files'}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {docs.groups.map((g) => (
              <CategoryCard key={g.name} name={g.name} files={g.files} person={person} />
            ))}
            {docs.loose.length > 0 && <CategoryCard name="Records" files={docs.loose} person={person} />}
          </div>
        </div>
      )}
      {docs && docs !== 'error' && docs.folder && docs.groups.length === 0 && docs.loose.length === 0 && (
        <Card className={cn(CARD, 'p-4 text-[12.5px] italic text-text-3')}>
          Their folder exists but holds no files yet —{' '}
          <a href={docs.folder.url} target="_blank" rel="noopener noreferrer" className="not-italic font-semibold text-primary">
            open it in Drive
          </a>.
        </Card>
      )}
    </>
  )

  const hiringEmpty = items === 'none'
  const folderEmpty = docs !== null && (docs === 'error' || (!docs.folder && docs.loose.length === 0))
  if (hiringEmpty && folderEmpty && !driveBlock) {
    return <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No documents on file for this person yet.</Card>
  }
  if (items === 'none') {
    return (
      <div className="space-y-3">
        {folderBlock}
        {driveBlock}
      </div>
    )
  }
  if (items === null) {
    return (
      <div className="space-y-3">
        {folderBlock}
        {driveBlock}
        <p className="flex items-center gap-2 py-4 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the hiring documents…</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
    {folderBlock}
    {driveBlock}
    <Card className={cn(CARD, 'p-0')}>
      <p className="border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">Hiring documents</p>
      <div className="divide-y divide-border/60">
        {items.map((d) => {
          const on = d.status === 'uploaded' || d.status === 'verified'
          return (
            <div key={d.doc_id} className="flex items-center gap-2.5 px-3 py-2.5">
              {on ? <CheckCircle2 size={15} className="shrink-0 text-success" />
                : d.status === 'returned' ? <X size={15} className="shrink-0 text-danger" />
                  : <Clock size={15} className="shrink-0 text-text-3" />}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{d.label}</span>
              <span className="text-[11.5px] text-text-3">{d.status || 'missing'}</span>
              {on && d.file_url && (
                <button
                  onClick={() => openFile({ url: d.file_url, title: `${u.display_name || u.email || 'Document'} — ${d.label}`, icon: 'file-text' })}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
                >
                  <FileText size={12} /> View
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Card>
    </div>
  )
}

// ---- THE RUBRIC MATRIX ON THE PROFILE — reports carry the résumé analysis, under the same prompt the scorecard…

type RubricAnalysis = {
  composite: number | null
  ratings: { skills: number | null; certs: number | null; experience: number | null; job_history: number | null }
  red_flags: { short_tenure: boolean; no_certs: boolean; stale_experience: boolean }
  total_years_caregiving: string
  avg_tenure_per_job: string
  months_since_last_experience: string
  highest_responsibility: string
  schedule_availability: string
  num_dsp_agencies: string
  consistency_in_field: string
  setting_balance: string
  care_experience: string
  listed_certifications: string
  languages: string
  summary: string
  analyzed_at: string
}

/** Four segments, one per rubric point — colour says how good, not just how much. */
function RatingBar({ label, v }: { label: string; v: number | null }) {
  const n = v ?? 0
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-24 shrink-0 text-[11.5px] font-semibold text-text-3">{label}</span>
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              i < n ? (n >= 3 ? 'bg-primary' : n >= 2 ? 'bg-warning' : 'bg-danger') : 'bg-surface-3',
            )}
          />
        ))}
      </div>
      <span className="w-8 shrink-0 text-right text-[11.5px] font-bold tabular-nums text-text-1">{v ?? '—'}/4</span>
    </div>
  )
}

const RED_FLAG_LABEL: Record<string, string> = {
  short_tenure: 'Short tenure',
  no_certs: 'No certifications',
  stale_experience: 'Stale experience',
}

// The hiring evaluations, while the candidate row still exists.
function ReportsSection({ u }: { u: UserRow }) {
  if (u.client_key) {
    return <Card className={cn(CARD, 'p-8 text-center text-[13px] italic text-text-3')}>Nothing here yet — client reports arrive later, by design.</Card>
  }
  return <StaffReportsSection u={u} />
}

function StaffReportsSection({ u }: { u: UserRow }) {
  const [cand, setCand] = useState<CandRow | null | 'none'>(u.candidate_id ? null : 'none')
  const [an, setAn] = useState<RubricAnalysis | null>(() => readKept<RubricAnalysis>(`asa:profile:report:${u.id}`))
  useEffect(() => {
    if (!u.candidate_id) return
    const generation = keptGeneration()
    api.list<CandRow>('candidates')
      .then((rows) => setCand(rows.find((r) => r.id === u.candidate_id) ?? 'none'))
      .catch(() => setCand('none'))
    gasAction<{ found: boolean; analysis?: RubricAnalysis }>('resumeAnalysisGet', { candidate_id: u.candidate_id })
      .then((d) => { if (d.found && d.analysis) { setAn(d.analysis); keepIfCurrent(`asa:profile:report:${u.id}`, d.analysis, generation) } })
      .catch(() => { /* the kept copy stands */ })
  }, [u.candidate_id, u.id])
  if (cand === 'none' && !an) {
    return <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No hiring reports — the account is not linked to a candidate on the board.</Card>
  }
  if (cand === null && !an) {
    return <p className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the reports…</p>
  }
  const c = cand !== null && cand !== 'none' ? cand : null
  const flags = an ? (Object.keys(an.red_flags) as (keyof RubricAnalysis['red_flags'])[]).filter((k) => an.red_flags[k]) : []
  return (
    <div className="space-y-3">
      <Card className={cn(CARD, 'p-4')}>
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <p className="text-[13px] font-bold text-text-1">Resume analysis</p>
          {an?.composite != null && (
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-[12px] font-bold tabular-nums',
                an.composite >= 7 ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger',
              )}
              title="The scorecard's composite — same rubric, same arithmetic. Never blocks the process."
            >
              Scorecard {an.composite}
            </span>
          )}
          {an?.analyzed_at && <span className="text-[11px] text-text-3">analyzed {dayText(an.analyzed_at)}</span>}
          {c?.resumeLink && (
            <button
              onClick={() => openFile({ url: c.resumeLink!, title: `${c.name} — resume`, icon: 'file-text' })}
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
            >
              <FileText size={12} /> Open resume
            </button>
          )}
        </div>
        {an ? (
          <>
            <div className="grid grid-cols-1 gap-x-8 gap-y-2 lg:grid-cols-2">
              <RatingBar label="Skills" v={an.ratings.skills} />
              <RatingBar label="Certifications" v={an.ratings.certs} />
              <RatingBar label="Experience" v={an.ratings.experience} />
              <RatingBar label="Job history" v={an.ratings.job_history} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {flags.length > 0 ? (
                flags.map((k) => (
                  <span key={k} className="rounded-full bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger">
                    ⚑ {RED_FLAG_LABEL[k]}
                  </span>
                ))
              ) : (
                <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', TINT_PAIR('mint'))}>No red flags</span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Years caregiving" value={an.total_years_caregiving} />
              <Item label="Avg tenure per job" value={an.avg_tenure_per_job} />
              <Item label="Months since last exp." value={an.months_since_last_experience} />
              <Item label="Highest responsibility" value={an.highest_responsibility} />
              <Item label="Availability" value={an.schedule_availability} />
              <Item label="DSP agencies" value={an.num_dsp_agencies} />
              <Item label="Consistency in field" value={an.consistency_in_field} />
              <Item label="Setting balance" value={an.setting_balance} />
              <Item label="Languages" value={an.languages} />
            </div>
            {an.care_experience && (
              <p className="mt-3 text-[12.5px] leading-5 text-text-2"><span className="font-semibold text-text-1">Care experience:</span> {an.care_experience}</p>
            )}
            {an.listed_certifications && (
              <p className="mt-1 text-[12.5px] leading-5 text-text-2"><span className="font-semibold text-text-1">Certifications listed:</span> {an.listed_certifications}</p>
            )}
            {an.summary && (
              <p className="mt-3 border-t border-border/60 pt-3 text-[12.5px] leading-5 text-text-2">{an.summary}</p>
            )}
          </>
        ) : c?.summary?.trim() ? (
          <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-text-2">{c.summary}</p>
        ) : (
          <p className="text-[12.5px] italic text-text-3">No scored analysis on file — the Scorecard button on their hiring card runs one when a resume exists.</p>
        )}
      </Card>
    </div>
  )
}

export type DeepProfile = {
  name: string
  sources: string[]
  unreadable: string[]
  roster?: { name: string; email: string; phone: string; role: string; department: string; location: string }
  certs?: { cert: string; date: string }[]
  shifts?: { count: number; houses: string[]; first: string; last: string }
  ist?: { client: string; house: string; status: string; due: string }[]
  folder?: { name: string; url: string }
  files?: { name: string; id: string; url: string; mime: string; updated: string }[]
  snippets?: { file: string; text: string }[]
  summary: string
  highlights: string[]
  ai_via: string
  stored_at?: string
  /** the client's house (client accounts): ist_houses join + plan address + bank scene */
  house?: { code?: string; name?: string; address?: string; photo?: string }
  // the client this account belongs to — NOT the account holder: an SSA or FAMILY login carries its own…
  client_key?: string
  // the CLIENT's own name, when the deep payload names it.
  client_name?: string
}

type Conversations = {
  messages: { at: string; body: string; intent: string }[]
  transcript: { url: string; text: string; at: string } | null
  sends: { situation: string; channel: string; at: string }[]
}

// What this person did — and what the platform has HEARD from them: inbound messages, the screen transcript, every…

type UserComms = {
  transcripts: { call_id: string; at: string; secs: string; turns: string; line: string; participant: string; direction: string; status: string; as: string }[]
  messages: { id: string; at: string; direction: string; type: string; status: string; body: string; with_number: string; as: string }[]
  summaries: { call_id: string; at: string; direction: string; secs: string; summary: string }[]
  window_days: number
  numbers: number
}

// ---- SUPPORT ON THE PROFILE — the Support Request app's requests, listed on the User/Staff profile.

type SupportReqs = {
  requests: {
    id: string; at: string; type: string; urgency: string; status: string
    verdict: string; resolvedAt: string; resolvedBy: string; note: string
    details: string; dates: string; from: string; to: string; days: string; as: string
  }[]
  counts: { open: number; needs_dates: number; resolved: number }
  total: number
}

// The queue's own urgency tints (RequestsPage), kept identical here.
const REQ_URGENCY_TINT: Record<string, string> = {
  high: 'bg-tint-pink text-tint-fg-pink',
  mid: 'bg-tint-amber text-tint-fg-amber',
  low: 'bg-surface-2 text-text-3',
}

/** Status chip: a resolved row wears its verdict, an open one its state. */
function reqStatusChip(r: SupportReqs['requests'][number]): [string, string] {
  if (r.status === 'resolved') {
    if (r.verdict === 'approved') return [TINT_PAIR('mint'), 'approved']
    if (r.verdict === 'denied') return [TINT_PAIR('danger'), 'denied']
    return [TINT_PAIR('slate'), 'resolved']
  }
  if (r.status === 'needs_dates') return [TINT_PAIR('blue'), 'needs dates']
  return [TINT_PAIR('amber'), 'open']
}

function DirectionChip({ d }: { d: string }) {
  const inbound = d.toLowerCase().startsWith('in')
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', inbound ? TINT_PAIR('blue') : TINT_PAIR('lavender'))}>
      {inbound ? 'Incoming' : 'Outgoing'}
    </span>
  )
}

// ---- CLIENT EVENTS — Activity carries every piece of information about the client: Dr Appointments, Call Offs…

type DrApptRow = {
  id: string; status?: string; client?: string; clientName?: string; client_name?: string
  dr_name?: string; specialist?: string; next_visit?: string
}
type UiIncidentRow = {
  id: string; client_name?: string; client?: string; clientName?: string
  incident_category?: string; incident_location?: string; incident_date?: string; incident_time?: string
}
type CoRow = { id: string; employee_name?: string; date?: string; type?: string; how_late?: string }
type WoRow = { id: string; status?: string; timestamp?: string; select_address_vehicle?: string; repair_type?: string; urgency_level?: string }
type ClientNameRow = { id?: string; name?: string; client_key?: string }

// `accountId` rides along only so the account holder's chip drags with a real id — the client's events are keyed by…
function ClientEventsCard({ clientKey, deepName, accountName, accountId }: { clientKey: string; deepName?: string; accountName?: string; accountId?: string }) {
  const [drAppts, setDrAppts] = useState<DrApptRow[] | null>(null)
  const [incidents, setIncidents] = useState<UiIncidentRow[] | null>(null)
  const [callOffs, setCallOffs] = useState<CoRow[] | null>(null)
  const [repairs, setRepairs] = useState<WoRow[] | null>(null)
  // null = still resolving; '' = the client record did not answer
  const [clientName, setClientName] = useState<string | null>(deepName?.trim() || null)
  useEffect(() => {
    api.list<DrApptRow>('drAppointments').then((r) => setDrAppts(r ?? [])).catch(() => setDrAppts([]))
    api.list<UiIncidentRow>('uiIncidents').then((r) => setIncidents(r ?? [])).catch(() => setIncidents([]))
    api.list<CoRow>('callOffs').then((r) => setCallOffs(r ?? [])).catch(() => setCallOffs([]))
    api.list<WoRow>('workOrders').then((r) => setRepairs(r ?? [])).catch(() => setRepairs([]))
  }, [])
  useEffect(() => {
    if (deepName?.trim()) return
    let alive = true
    api.list<ClientNameRow>('clients')
      .then((rows) => {
        if (!alive) return
        const k = String(clientKey).trim()
        const hit = (rows ?? []).find((c) => String(c.client_key ?? '').trim() === k)
          ?? (rows ?? []).find((c) => String(c.id ?? '').trim() === k)
        setClientName(String(hit?.name ?? '').trim())
      })
      .catch(() => { if (alive) setClientName('') })
    return () => { alive = false }
  }, [clientKey, deepName])
  const key = nameKey(clientName ?? '')
  const mine = <T,>(rows: T[] | null, pick: (r: T) => string | undefined) =>
    key ? (rows ?? []).filter((r) => nameKey(pick(r)) === key) : []
  const myAppts = mine(drAppts, (r) => r.client ?? r.clientName ?? r.client_name)
  const myIncidents = mine(incidents, (r) => r.client_name ?? r.client ?? r.clientName)
  // `main` takes nodes: the call-off line names a STAFF MEMBER inside it, and that name has to arrive already…
  const row = (k: string, main: React.ReactNode, sub?: string) => (
    <div key={k} className="flex items-baseline gap-2.5 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-2">{main}</span>
      {sub && <span className="shrink-0 text-[11px] tabular-nums text-text-3">{sub}</span>}
    </div>
  )
  const group = (title: string, body: React.ReactNode, note?: string) => (
    <div>
      <p className="border-b border-border px-3 py-2 text-[12.5px] font-bold text-text-1">{title}</p>
      <div className="divide-y divide-border/60">{body}</div>
      {note && <p className="border-t border-border/60 px-3 py-1.5 text-[10.5px] text-text-3">{note}</p>}
    </div>
  )
  const empty = (what: string) => <p className="px-3 py-2 text-[12px] italic text-text-3">{what}</p>
  // Whose events these are, said at the top — on an SSA or FAMILY page the name above the card is theirs and the name…
  const heading = clientName === null
    ? 'Reading the client record…'
    : clientName
      ? (
        <span>
          Client events —{' '}
          <DragPerson name={clientName} id={clientKey} type="client" subtitle="Client">
            {clientName}
          </DragPerson>
        </span>
      )
      : 'Client events'
  // resolved, and still no usable key — the join is impossible, not empty
  const unmatchable = clientName !== null && !key
  // the name-matched groups cannot run without a name: say WHY, never sit there looking like a client with no…
  const noName = `The client record behind this account (key ${clientKey}) did not answer, so nothing can be matched by name.`
  return (
    <Card className={cn(CARD, 'p-0')}>
      <p className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">
        {heading}
        {clientName && accountName && nameKey(accountName) !== key && (
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', TINT_PAIR('blue'))}>
            this account signs in as{' '}
            <DragPerson name={accountName} id={accountId} type="staff" subtitle="Account holder">
              {accountName}
            </DragPerson>
          </span>
        )}
      </p>
      {group('Dr appointments', unmatchable ? empty(noName) : myAppts.length
        ? myAppts.slice(0, 10).map((a) => row(a.id, `${a.dr_name || a.specialist || 'Doctor'}${a.status ? ` · ${a.status}` : ''}`, ohioDayText(a.next_visit)))
        : drAppts === null || clientName === null ? empty('Reading the appointments…') : empty('No appointment names this client.'))}
      {group('UI reports', unmatchable ? empty(noName) : myIncidents.length
        ? myIncidents.slice(0, 10).map((u2) => row(u2.id, `${u2.incident_category || 'Incident'}${u2.incident_location ? ` · ${u2.incident_location}` : ''}`, `${ohioDayText(u2.incident_date)}${u2.incident_time ? ` ${u2.incident_time}` : ''}`.trim()))
        : incidents === null || clientName === null ? empty('Reading the UI reports…') : empty('No UI report names this client.'))}
      {group('Recent call offs', (callOffs ?? []).length
        ? (callOffs ?? []).slice(-10).reverse().map((c) => row(c.id, (
            <>
              {c.type || 'Call Off'} ·{' '}
              <DragPerson name={c.employee_name ?? ''} id={c.employee_name} type="staff" subtitle="Called off">
                {c.employee_name ?? ''}
              </DragPerson>
            </>
          ), ohioDayText(c.date)))
        : empty('No call offs on record.'),
        'The call-off sheet carries no client column — these are the latest across all houses.')}
      {group('House repairs', (repairs ?? []).length
        ? (repairs ?? []).slice(-10).reverse().map((w) => row(w.id, `${w.repair_type || 'Repair'}${w.select_address_vehicle ? ` · ${w.select_address_vehicle}` : ''}${w.status ? ` · ${w.status}` : ''}`, w.urgency_level ? `urgency ${w.urgency_level}` : undefined))
        : empty('No repairs on record.'),
        'The repair sheet carries no client column — these are the latest across all houses.')}
    </Card>
  )
}

const ACT_TABS = [
  { id: 'log', label: 'Activity', icon: ActivityIcon },
  { id: 'transcripts', label: 'Transcripts', icon: Phone },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'summaries', label: 'Summaries', icon: FileText },
  { id: 'support', label: 'Support', icon: LifeBuoy },
] as const
type ActTab = (typeof ACT_TABS)[number]['id']

function ActivitySection({ u, deep }: { u: UserRow; deep: DeepProfile | null }) {
  const [tab, setTab] = useState<ActTab>('log')
  const [events, setEvents] = useState<LogEvent[] | null>(null)
  const [conv, setConv] = useState<Conversations | null>(null)
  const [comms, setComms] = useState<UserComms | null>(() => readKept<UserComms>(`asa:profile:comms:${u.id}`))
  const [support, setSupport] = useState<SupportReqs | null>(() => readKept<SupportReqs>(`asa:profile:support:${u.id}`))
  const navigate = useNavigate()
  const load = useCallback(() => {
    const generation = keptGeneration()
    gasAction<{ events: LogEvent[] }>('logsList', { actor: u.email ?? '', limit: 30 })
      .then((d) => setEvents(d.events ?? []))
      .catch(() => setEvents([]))
    if (u.candidate_id) {
      gasAction<Conversations>('userConversations', { candidate_id: u.candidate_id })
        .then(setConv)
        .catch(() => setConv(null))
    }
    gasAction<UserComms>('userComms', { user_id: u.id })
      .then((d) => { setComms(d); keepIfCurrent(`asa:profile:comms:${u.id}`, d, generation) })
      .catch(() => { /* the kept copy stands */ })
    gasAction<SupportReqs>('userSupportRequests', { user_id: u.id })
      .then((d) => { setSupport(d); keepIfCurrent(`asa:profile:support:${u.id}`, d, generation) })
      .catch(() => { /* the kept copy stands */ })
  }, [u.email, u.candidate_id, u.id])
  useEffect(() => { load() }, [load])

  const counts: Record<ActTab, number | null> = {
    log: events?.length ?? null,
    transcripts: comms?.transcripts.length ?? null,
    messages: comms?.messages.length ?? null,
    summaries: comms?.summaries.length ?? null,
    support: support?.total ?? null,
  }

  const pills = (
    <div className="flex flex-wrap gap-1.5">
      {ACT_TABS.map((t) => {
        const Icon = t.icon
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold',
              tab === t.id ? 'border-primary/40 bg-primary-soft text-primary' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
            )}
          >
            <Icon size={12} /> {t.label}
            {counts[t.id] != null && (
              <span className={cn('rounded-full px-1.5 text-[10.5px] font-bold tabular-nums', tab === t.id ? 'bg-primary/15' : 'bg-surface-3 text-text-3')}>
                {counts[t.id]}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  if (tab === 'transcripts') {
    return (
      <div className="space-y-3">
        {pills}
        {comms === null ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the call mirror…</p>
        ) : comms.transcripts.length === 0 ? (
          <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No calls with their numbers inside the mirror's {comms.window_days}-day window.</Card>
        ) : (
          <Card className={cn(CARD, 'p-0')}>
            <div className="divide-y divide-border/60">
              {comms.transcripts.map((t) => (
                <div key={t.call_id + t.at} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="w-[118px] shrink-0 text-[11.5px] tabular-nums text-text-3">{ohioStamp(t.at)}</span>
                  <DirectionChip d={t.direction} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-2">
                    {t.as === 'team' ? 'On their line' : formatPhoneList(t.participant) || '—'}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-text-3">{t.secs}s · {t.turns} turns</span>
                  {t.status && <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">{t.status}</span>}
                </div>
              ))}
            </div>
            <p className="border-t border-border/60 px-3 py-2 text-[11px] text-text-3">The mirror keeps a rolling {comms.window_days}-day window of calls.</p>
          </Card>
        )}
      </div>
    )
  }
  if (tab === 'messages') {
    return (
      <div className="space-y-3">
        {pills}
        {comms === null ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the message mirror…</p>
        ) : comms.messages.length === 0 ? (
          <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No messages with their numbers inside the mirror's {comms.window_days}-day window.</Card>
        ) : (
          <Card className={cn(CARD, 'p-0')}>
            <div className="divide-y divide-border/60">
              {comms.messages.map((m) => (
                <div key={m.id + m.at} className="flex items-start gap-2.5 px-3 py-2">
                  <span className="w-[118px] shrink-0 text-[11.5px] tabular-nums text-text-3">{ohioStamp(m.at)}</span>
                  <DirectionChip d={m.direction} />
                  <span className="min-w-0 flex-1 text-[12.5px] leading-5 text-text-2">{m.body || <span className="italic text-text-3">({m.type} with no text)</span>}</span>
                  {m.as === 'named' && (
                    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold', TINT_PAIR('amber'))} title="Matched by their name inside the text, not by number">
                      named
                    </span>
                  )}
                  {m.type === 'mms' && <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">mms</span>}
                </div>
              ))}
            </div>
            <p className="border-t border-border/60 px-3 py-2 text-[11px] text-text-3">
              The mirror keeps {comms.window_days} days; older messages come from the raw webhook log, matched by their numbers or their name in the text.
            </p>
          </Card>
        )}
      </div>
    )
  }
  if (tab === 'summaries') {
    return (
      <div className="space-y-3">
        {pills}
        {comms === null ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the summaries…</p>
        ) : comms.summaries.length === 0 ? (
          <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No call summaries carry their numbers yet.</Card>
        ) : (
          <div className="space-y-2.5">
            {comms.summaries.map((s) => (
              <Card key={s.call_id + s.at} className={cn(CARD, 'p-3.5')}>
                <div className="mb-1 flex items-center gap-2">
                  <DirectionChip d={s.direction} />
                  <span className="text-[11.5px] tabular-nums text-text-3">{ohioStamp(s.at)}</span>
                  {s.secs && <span className="ml-auto text-[11px] tabular-nums text-text-3">{s.secs}s</span>}
                </div>
                <p className="text-[12.5px] leading-5 text-text-2">{s.summary}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (tab === 'support') {
    return (
      <div className="space-y-3">
        {pills}
        {support === null ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the support queue…</p>
        ) : support.requests.length === 0 ? (
          <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No support requests from this person yet.</Card>
        ) : (
          <Card className={cn(CARD, 'p-0')}>
            <div className="divide-y divide-border/60">
              {support.requests.map((r) => {
                const [statusTint, statusLabel] = reqStatusChip(r)
                return (
                  <div key={r.id} className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="w-[118px] shrink-0 text-[11.5px] tabular-nums text-text-3">{ohioStamp(r.at)}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-1">{r.type || '—'}</span>
                      {r.urgency && (
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', REQ_URGENCY_TINT[r.urgency] ?? 'bg-surface-2 text-text-3')}>{r.urgency}</span>
                      )}
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', statusTint)}>{statusLabel}</span>
                      {r.as === 'named' && (
                        <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold', TINT_PAIR('amber'))} title="A legacy row with no id, e-mail or number — matched by their exact name">
                          named
                        </span>
                      )}
                    </div>
                    {r.details && <p className="mt-1 line-clamp-2 pl-[130px] text-[12px] leading-4 text-text-2">{r.details}</p>}
                    {(r.from || r.dates) && (
                      <p className="mt-0.5 pl-[130px] text-[11.5px] tabular-nums text-text-3">
                        {r.from && r.to ? `${r.from} → ${r.to}${r.days ? ` · ${r.days} day${r.days === '1' ? '' : 's'}` : ''}` : r.dates}
                      </p>
                    )}
                    {r.status === 'resolved' && (r.resolvedBy || r.note) && (
                      <p className="mt-0.5 pl-[130px] text-[11.5px] text-text-3">
                        {r.resolvedBy ? (
                          <>
                            by{' '}
                            <DragPerson name={r.resolvedBy} id={r.resolvedBy} type="staff" subtitle="Resolved the request">
                              {r.resolvedBy}
                            </DragPerson>
                          </>
                        ) : null}
                        {r.resolvedBy && r.note ? ' — ' : ''}{r.note}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="flex items-center border-t border-border/60 px-3 py-2 text-[11px] text-text-3">
              The Support Requests Queue owns these rows{support.total > support.requests.length ? ` · showing ${support.requests.length} of ${support.total}` : ''}.
              <button onClick={() => navigate('/app/support-requests/queue')} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
                <LifeBuoy size={12} /> Open Support Requests Queue
              </button>
            </p>
          </Card>
        )}
      </div>
    )
  }

  if (events === null) {
    return (
      <div className="space-y-3">
        {pills}
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the log…</p>
      </div>
    )
  }
  const hasConv = !!conv && (conv.messages.length > 0 || conv.transcript || conv.sends.length > 0)
  return (
    <div className="space-y-3">
      {pills}
      {hasConv && (
        <Card className={cn(CARD, 'p-0')}>
          <p className="border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">Conversations</p>
          {conv!.transcript && (
            <div className="border-b border-border/60 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <p className="text-[12.5px] font-semibold text-text-1">Phone screen transcript</p>
                {conv!.transcript.at && <span className="text-[11px] text-text-3">{ohioDayYear(conv!.transcript.at)}</span>}
                {conv!.transcript.url && (
                  <button
                    onClick={() => openFile({ url: conv!.transcript!.url, title: 'Phone screen transcript', icon: 'file-text' })}
                    className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
                  >
                    <FileText size={12} /> Open
                  </button>
                )}
              </div>
              {conv!.transcript.text && (
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12px] leading-4 text-text-2">{conv!.transcript.text}</p>
              )}
            </div>
          )}
          {conv!.messages.map((m, i) => (
            <div key={`m${i}`} className="flex items-start gap-2.5 border-b border-border/60 px-3 py-2 last:border-0">
              <span className="w-[118px] shrink-0 text-[11.5px] tabular-nums text-text-3">{ohioStamp(m.at)}</span>
              <span className="min-w-0 flex-1 text-[12.5px] text-text-2">{m.body}</span>
              <span className="rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">they wrote</span>
            </div>
          ))}
          {conv!.sends.map((sd, i) => (
            <div key={`s${i}`} className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2 last:border-0">
              <span className="w-[118px] shrink-0 text-[11.5px] tabular-nums text-text-3">{ohioStamp(sd.at)}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-2">{sd.situation}</span>
              <span className="rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">we sent · {sd.channel}</span>
            </div>
          ))}
        </Card>
      )}
      {/* the CLIENT's events, keyed by the client — a guardian account's own
          display name never named anybody on these sheets */}
      {u.client_key && (
        <ClientEventsCard
          clientKey={u.client_key}
          deepName={deep?.client_name}
          accountName={u.display_name ?? ''}
          accountId={u.id}
        />
      )}
      {events.length === 0 ? (
        <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>Nothing on the platform log for this person yet.</Card>
      ) : (
        <Card className={cn(CARD, 'p-0')}>
          <p className="border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">Platform log</p>
          <div className="divide-y divide-border/60">
            {events.map((e, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                <span className="w-[118px] shrink-0 text-[11.5px] tabular-nums text-text-3">{ohioStamp(e.at)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-2">{e.summary || e.action}</span>
                {e.area && <span className="rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">{e.area}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}


// ---- SHIFTS ON THE PROFILE — IF there are active shifts, they are shown in this format.

// ---- THE HOUSE'S ROSTER, ON THE CLIENT'S PAGE — the shifts of this client's house and which user is working them…

type HouseShiftRow = { id: string; staff?: string; house?: string; date?: string; start?: string; end?: string; status?: string }

function ClientHouseShifts({ house }: { house?: { code?: string; name?: string } }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<HouseShiftRow[] | null>(null)
  const [users, setUsers] = useState<UserRow[]>(() => (cachedUsers() as UserRow[] | null) ?? [])
  useEffect(() => {
    api.list<HouseShiftRow>('shifts').then((r) => setRows(r ?? [])).catch(() => setRows([]))
    if (!users.length) void fetchUsers().then((r) => setUsers(r as UserRow[])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one fetch per mount
  }, [])
  const hKey = String(house?.name || house?.code || '').trim().toUpperCase()
  if (!hKey) {
    return <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No house is linked to this client yet — the IST join found nothing.</Card>
  }
  if (rows === null) {
    return <p className="flex items-center gap-2 py-6 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the roster…</p>
  }
  const mine = rows.filter((r) => String(r.house ?? '').trim().toUpperCase() === hKey)
  if (!mine.length) {
    return <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No rostered shifts for {house?.name || hKey} inside the slice's window.</Card>
  }
  // The roster's week turns over in OHIO, not on the reader's phone — dayMs() below already builds naive local-noon…
  const today = ohioWall(new Date()) as Date; today.setHours(0, 0, 0, 0)
  const dayMs = (d?: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ''))
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : NaN
  }
  // THIS WEEK IS THE QUESTION — the shifts of the employee attending this client THIS week were what was missing.
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay())
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
  const inWeek = (d?: string) => {
    const t = dayMs(d)
    return Number.isFinite(t) && t >= weekStart.getTime() && t <= weekEnd.getTime()
  }
  const week = mine.filter((r) => inWeek(r.date)).sort((a, b) => dayMs(a.date) - dayMs(b.date))
  const upcoming = mine.filter((r) => dayMs(r.date) >= today.getTime() && !inWeek(r.date)).sort((a, b) => dayMs(a.date) - dayMs(b.date))
  const past = mine.filter((r) => dayMs(r.date) < today.getTime() && !inWeek(r.date)).sort((a, b) => dayMs(b.date) - dayMs(a.date)).slice(0, 10)
  // who is on this week, once each — the answer to "who is with them"
  const whoThisWeek: string[] = []
  week.forEach((r) => {
    const n = String(r.staff ?? '').trim()
    if (n && !whoThisWeek.includes(n)) whoThisWeek.push(n)
  })
  const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weekDayOf = (d?: string) => {
    const t = dayMs(d)
    return Number.isFinite(t) ? DAY_LABEL[new Date(t).getDay()] : ''
  }
  // exact-unique account match by display name — the standing join law
  const accountFor = (staff?: string): UserRow | undefined => {
    const k = String(staff ?? '').trim().toLowerCase()
    if (!k) return undefined
    const hits = users.filter((x) => String(x.display_name ?? '').trim().toLowerCase() === k)
    return hits.length === 1 ? hits[0] : undefined
  }
  const StaffName = ({ staff }: { staff?: string }) => {
    const acct = accountFor(staff)
    const body = acct ? (
      <button
        onClick={() => navigate(`/app/users/profile?u=${encodeURIComponent(String(acct.id))}`)}
        className="min-w-0 truncate text-left text-[12.5px] font-semibold text-primary hover:underline"
        title={`Open ${staff}'s profile`}
      >
        {staff}
      </button>
    ) : (
      <span className="min-w-0 truncate text-[12.5px] font-medium text-text-1">{staff || '—'}</span>
    )
    // ONE wrap serves both branches and both call sites: the rostered person is the same person whether or not the…
    return (
      <DragPerson
        name={staff ?? ''}
        id={acct?.id}
        type="staff"
        avatar={acct?.avatar}
        subtitle={acct?.title}
        className="min-w-0"
      >
        {body}
      </DragPerson>
    )
  }
  const line = (r: HouseShiftRow) => (
    <div key={r.id} className="flex items-center gap-2.5 px-3 py-2">
      <span className="w-[88px] shrink-0 text-[11.5px] tabular-nums text-text-3">{String(r.date ?? '').slice(0, 10)}</span>
      <StaffName staff={r.staff} />
      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-text-3">
        {r.start && r.end ? `${r.start}–${r.end}` : ''}
      </span>
      {r.status && <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">{r.status}</span>}
    </div>
  )
  return (
    <div className="space-y-3">
      {/* THE WEEK FIRST — who is with this person right now */}
      <Card className={cn(CARD, 'p-0')}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <p className="text-[13px] font-bold text-text-1">
            This week at {house?.name || hKey}
          </p>
          <span className="text-[11.5px] tabular-nums text-text-3">
            {/* weekStart/weekEnd are already Ohio days on a naive carrier —
                sending them through toISOString() would convert them a SECOND
                time and label the week a day early. */}
            {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
          </span>
          {whoThisWeek.length > 0 && (
            <span className="ml-auto rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-text-3">
              {whoThisWeek.length} {whoThisWeek.length === 1 ? 'person' : 'people'}
            </span>
          )}
        </div>
        {week.length ? (
          <div className="divide-y divide-border/60">
            {week.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="w-[64px] shrink-0 text-[11.5px] font-semibold text-text-2">
                  {weekDayOf(r.date)} <span className="font-normal tabular-nums text-text-3">{String(r.date ?? '').slice(8, 10)}</span>
                </span>
                <StaffName staff={r.staff} />
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-text-3">
                  {r.start && r.end ? `${r.start}–${r.end}` : ''}
                </span>
                {r.status && <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold text-text-3">{r.status}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-3 text-[12.5px] italic text-text-3">Nobody is rostered at this house this week.</p>
        )}
      </Card>
      <Card className={cn(CARD, 'p-0')}>
        <p className="border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">
          Working at {house?.name || hKey} — later
        </p>
        {upcoming.length ? (
          <div className="divide-y divide-border/60">{upcoming.map(line)}</div>
        ) : (
          <p className="px-3 py-3 text-[12.5px] italic text-text-3">Nothing rostered beyond this week inside the slice's window.</p>
        )}
      </Card>
      {past.length > 0 && (
        <Card className={cn(CARD, 'p-0')}>
          <p className="border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">Recently worked here</p>
          <div className="divide-y divide-border/60">{past.map(line)}</div>
        </Card>
      )}
      <p className="text-[11px] text-text-3">A name in colour opens that person's profile — names matching more than one account stay plain, never guessed.</p>
    </div>
  )
}

// A CLIENT's shifts are their HOUSE's shifts — branched before the staff body's hooks mount (rules-of-hooks).
function ShiftsSection({ u, deep }: { u: UserRow; deep: DeepProfile | null }) {
  if (u.client_key) return <ClientHouseShifts house={deep?.house} />
  return <StaffShiftsSection u={u} />
}

function StaffShiftsSection({ u }: { u: UserRow }) {
  const { cards } = useShiftData()
  const navigate = useNavigate()
  // the week chips are too narrow for a spelled range and keep the code; the tooltip and the next-shift line follow…
  const clock = useClockTimes()
  const key = (u.display_name ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const card = key ? (cards ?? []).find((c) => c.personName.toLowerCase().replace(/[^a-z]/g, '') === key) ?? null : null
  if (cards === null) {
    return <p className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the roster…</p>
  }
  if (!card) {
    return <Card className={cn(CARD, 'p-6 text-center text-[13px] italic text-text-3')}>No active shifts on the roster for this person.</Card>
  }
  const worked = card.week.filter((w) => w.kind !== 'off' && w.kind !== 'ro').length
  const overflow = Math.max(0, card.totalShifts - worked)
  return (
    <Card className={cn(CARD, 'p-4')}>
      <div className="flex items-center gap-3">
        {/* portrait and name travel together — the row's own gap-3 is repeated
            on the wrapper so the trailing button keeps its place */}
        <DragPerson
          name={card.personName}
          id={card.personId}
          type="staff"
          avatar={card.avatar}
          subtitle={`${card.totalShifts} shifts · ${card.houseCount} houses`}
          className="min-w-0 items-center gap-3"
        >
          <Avatar src={card.avatar} name={card.personName} size="md" className="h-11 w-11 text-[15px]" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-text-1">{card.personName}</p>
            <p className="text-[12px] text-text-3">{card.totalShifts} shifts · {card.houseCount} houses</p>
          </div>
        </DragPerson>
        <button
          onClick={() => navigate(`/app/calendarbuilder/cards?profile=${card.id}`)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2"
        >
          Open Shift Cards
        </button>
      </div>
      <div className="mt-3.5 flex items-end gap-1">
        {card.week.map((w) => (
          <div key={w.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-text-3">{w.day}</span>
            <span
              className={cn(
                'w-full truncate rounded-sm px-0.5 py-1 text-center font-mono text-[9.5px] font-semibold leading-3',
                kindChipClasses(w.kind),
              )}
              title={`${w.day} · ${cellText(w.code, clock)}`}
            >
              {w.code}
            </span>
          </div>
        ))}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className="text-[9px] text-transparent">·</span>
          <span className="rounded-sm bg-surface-2 px-1 py-1 font-mono text-[9.5px] font-semibold leading-3 text-text-2">
            +{overflow}
          </span>
        </div>
      </div>
      <p className="mt-3 border-t border-border pt-2.5 font-mono text-[11px] text-text-3">
        next: {card.next.date} · {cellText(card.next.code, clock)} · {card.next.houseCode}
      </p>
    </Card>
  )
}

// The initials tile is a door: pick a photo the platform already holds — the same Image Bank grid the record editor…
function PickPhotoDialog({ u, onClose, onDone }: { u: UserRow; onClose: () => void; onDone: () => void }) {
  const [src, setSrc] = useState(u.avatar ?? '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await gasAction('userUpdate', { user_id: u.id, avatar: src })
      toast({ type: 'success', title: src ? 'Photo set' : 'Photo removed', body: u.display_name || u.email })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-2" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text-1">Their photo</h2>
          <button onClick={onClose} className="text-text-3 hover:text-text-1"><X size={16} /></button>
        </div>
        <p className="mb-2 text-[12px] text-text-3">Pick from the platform's Image Bank — the photos already on record.</p>
        <BankGrid value={src} onChange={setSrc} />
        <div className="mt-4 flex items-center justify-end gap-2">
          {u.avatar && (
            <button
              onClick={() => setSrc('')}
              className="mr-auto rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
            >
              Back to initials
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || src === (u.avatar ?? '')}
            className="rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-bold text-on-primary disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the master's hand — every field, the switch…

const EDIT_ROLES: Role[] = ['admin', 'manager', 'staff', 'client', 'interviewer']
const EDIT_TYPES = ['ADMIN', 'ADMINISTRATOR', 'PLATFORMLEAD', 'DIRECTOR', 'SUPERVISOR', 'TEAMLEAD', 'MANAGER', 'HM',
                    'STAFF', 'INTERVIEWER', 'ONBOARDING', 'ENTITY', 'FAMILY', 'CLIENT', 'SSA']
const inputCls = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-1 outline-none focus:border-primary'

// Master-only: every field, activation, and the password — set, reset, or replace — through the declared userUpdate.
function EditProfileDialog({ u, onClose, onDone }: { u: UserRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(u.display_name ?? '')
  const [title, setTitle] = useState(u.title ?? '')
  const [roleV, setRoleV] = useState(u.role ?? 'staff')
  const [types, setTypes] = useState<string[]>(u.types ?? [])
  const [phones, setPhones] = useState<{ label?: string; number: string }[]>(
    u.phones?.length ? u.phones : u.phone ? [{ label: 'Phone', number: u.phone }] : [],
  )
  const [emails, setEmails] = useState<string[]>(u.emails ?? [])
  const [active, setActive] = useState(String(u.active ?? 'true') !== 'false')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        user_id: u.id,
        display_name: name.trim(),
        title: title.trim(),
        types,
        phone: phones[0]?.number?.trim() ?? '',
        phones: phones.filter((p) => p.number.trim()),
        emails: emails.map((e) => e.trim()).filter(Boolean),
        active,
      }
      // role `onboarding` is refused by the backend on purpose — graduation owns that transition; every other role…
      if (roleV !== u.role && roleV !== 'onboarding') payload.role = roleV
      if (password.trim()) payload.password = password.trim()
      await gasAction('userUpdate', payload)
      toast({ type: 'success', title: 'Profile saved', body: password.trim() ? 'Password set.' : undefined })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-2" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text-1">Edit profile</h2>
          <button onClick={onClose} className="text-text-3 hover:text-text-1"><X size={16} /></button>
        </div>
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" className={inputCls} />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" className={inputCls} />
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Access role (one)</p>
            <select value={roleV} onChange={(e) => setRoleV(e.target.value)} className={inputCls} disabled={u.role === 'onboarding'}>
              {u.role === 'onboarding' && <option value="onboarding">Onboarding (graduation moves them out)</option>}
              {EDIT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Badges (several allowed — HM + INTERVIEWER carry the scorecard)</p>
            <div className="flex flex-wrap gap-1.5">
              {EDIT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypes((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold',
                    types.includes(t)
                      ? 'border-primary bg-primary-soft text-primary-strong'
                      : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                  )}
                >
                  {/* the TOKEN is ticked and saved; the reader sees the
                      word as the company says it (RoleBadge badgeWord) */}
                  {badgeWord(t)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Phones</p>
            {phones.map((p, i) => (
              <div key={i} className="mb-1.5 flex gap-1.5">
                <input value={p.label ?? ''} onChange={(e) => setPhones((ps) => ps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Label" className={cn(inputCls, 'w-28')} />
                <input value={p.number} onChange={(e) => setPhones((ps) => ps.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} placeholder="+1 (330) …" className={inputCls} />
                <button onClick={() => setPhones((ps) => ps.filter((_, j) => j !== i))} className="shrink-0 text-text-3 hover:text-danger"><X size={14} /></button>
              </div>
            ))}
            <button onClick={() => setPhones((ps) => [...ps, { label: '', number: '' }])} className="text-[12px] font-semibold text-primary">+ Add phone</button>
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Extra e-mails (sign-in e-mail never changes here)</p>
            {emails.map((e0, i) => (
              <div key={i} className="mb-1.5 flex gap-1.5">
                <input value={e0} onChange={(e) => setEmails((es) => es.map((x, j) => (j === i ? e.target.value : x)))} placeholder="name@email.com" className={inputCls} />
                <button onClick={() => setEmails((es) => es.filter((_, j) => j !== i))} className="shrink-0 text-text-3 hover:text-danger"><X size={14} /></button>
              </div>
            ))}
            <button onClick={() => setEmails((es) => [...es, ''])} className="text-[12px] font-semibold text-primary">+ Add e-mail</button>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <div>
              <p className="text-[13px] font-semibold text-text-1">Account active</p>
              <p className="text-[11.5px] text-text-3">Off = they cannot sign in; nothing is deleted.</p>
            </div>
            <button
              onClick={() => setActive((v) => !v)}
              className={cn('h-5 w-9 rounded-full p-0.5 transition-colors', active ? 'bg-primary' : 'bg-surface-3')}
            >
              <span className={cn('block h-4 w-4 rounded-full bg-surface transition-transform', active && 'translate-x-4')} />
            </button>
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-text-3">Set / reset password (leave empty to keep)</p>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" placeholder="New password" className={inputCls} autoComplete="off" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2">Cancel</button>
          <button
            onClick={() => void save()}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-on-primary disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
