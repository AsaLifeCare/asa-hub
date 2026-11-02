// My asa.
// — the signed-in user's personal space (route /app/myasa/home, mounted via CUSTOM_PAGES in AppRoutePage once the…
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ohioLongDay } from '@/lib/ohio'
import { ArrowDown, ArrowRight, ArrowUp, Bookmark, Briefcase, Mail, Pencil, Phone, Plus, RotateCcw, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import Card, { CardHeader } from '@/components/shared/Card'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import RoleBadge, { HighestBadge } from '@/components/shared/RoleBadge'
import { gasAction } from '@/features/hiring/shared'
import { buildProfilePanel, contactEmails, contactPhones, type MasterOverview } from '@/features/profile/profilePanel'
import { useBookmarksStore } from '@/stores/useBookmarksStore'
import { useProfileSheetStore } from '@/stores/useProfileSheetStore'
import { TINT_PAIR } from '@/lib/tints'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import BankPickerModal from './BankPickerModal'
import MyAsaHero from './MyAsaHero'
import MyCertsCard, { CERTS_NO_NAME, useMyCerts } from './MyCertsCard'
import IndicatorCard from './IndicatorCard'
import MyWeekCard from './MyWeekCard'
import NewIndicatorModal from './NewIndicatorModal'
import NotificationApps from './NotificationApps'
import { BUILTIN_LABEL, EMPLOYEE_ONLY_CARDS, MASTER_ONLY_CARDS, loadLayout, resetLayout, saveLayout, type BuiltInCard, type MyAsaLayout } from './layout'

export default function MyAsaPage() {
  // `person` is who the page is about (the visited one); `account` only keeps this browser's card layout, and a visit writes nothing.
  const account = useAuthStore((s) => s.user)
  const visitId = useMemberStore((s) => s.currentMemberId)
  const visitName = useMemberStore((s) => s.memberName)
  const visitRole = useMemberStore((s) => s.memberRole)
  const visitAvatar = useMemberStore((s) => s.memberAvatar)
  const visitEmail = useMemberStore((s) => s.memberEmail)
  const visitTitle = useMemberStore((s) => s.memberTitle)
  const visitTypes = useMemberStore((s) => s.memberTypes)
  const visiting = Boolean(visitId)
  const user = useMemo(() => (
    visiting && account
      ? { ...account, id: visitId, name: visitName, email: visitEmail,
          emails: [], avatar: visitAvatar, title: visitTitle,
          role: (visitRole || 'staff') as typeof account.role,
          types: visitTypes, phone: '', phones: [], isMaster: false }
      : account
  ), [account, visiting, visitId, visitName, visitEmail, visitAvatar, visitTitle, visitRole, visitTypes])
  // `user` above is already the VISITED person while a visit is open, which is the identity this page is drawn for…
  const hideForClient = (id: BuiltInCard) =>
    String(user?.role ?? '') === 'client' && EMPLOYEE_ONLY_CARDS.includes(id)
  const bookmarks = useBookmarksStore((s) => s.bookmarks)
  const openProfile = useProfileSheetStore((s) => s.setOpen)

  // This page belongs to whoever is looking at it: cards can be removed, reordered, and indicators added.
  const userId = account?.id ?? 'anon'

  // THE PLATFORM'S VITAL SIGNS, for the one account that owns them.
  const [overview, setOverview] = useState<MasterOverview | null>(null)
  useEffect(() => {
    let alive = true
    if (user?.role !== 'admin') { setOverview(null); return }
    void gasAction<MasterOverview>('masterOverview', {})
      .then((o) => { if (alive) setOverview(o ?? null) })
      .catch(() => { if (alive) setOverview(null) })
    return () => { alive = false }
  }, [user?.role, user?.id])

  const isMaster = Boolean(overview) || Boolean(user?.isMaster)

  const [layout, setLayout] = useState<MyAsaLayout>(() => loadLayout(userId))
  // never editing inside somebody else's corner, whatever the last state was
  const [editingRaw, setEditing] = useState(false)
  const editing = editingRaw && !visiting
  const [addOpen, setAddOpen] = useState(false)
  const [bankOpen, setBankOpen] = useState(false)
  /** The card being dragged and the slot under the pointer — edit mode only. */
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  useEffect(() => setLayout(loadLayout(userId)), [userId])
  const persist = (next: MyAsaLayout) => {
    setLayout(next)
    saveLayout(userId, next)
  }
  const moveCard = (i: number, dir: -1 | 1) => {
    const cards = [...layout.cards]
    const j = i + dir
    if (j < 0 || j >= cards.length) return
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
    persist({ ...layout, cards })
  }
  const removeCard = (i: number) => {
    const card = layout.cards[i]
    // THE ONE CARD THAT STAYS — My profile is the one card that cannot be removed.
    if (card.kind === 'builtin' && card.id === 'profile') return
    const cards = layout.cards.filter((_, k) => k !== i)
    const hidden = card.kind === 'builtin' ? [...new Set([...layout.hidden, card.id])] : layout.hidden
    persist({ cards, hidden })
  }
  /** Drop the dragged card into the slot — the whole list re-flows. */
  const dropCard = (to: number) => {
    if (dragFrom === null || dragFrom === to) { setDragFrom(null); setDragOver(null); return }
    const cards = [...layout.cards]
    const [moved] = cards.splice(dragFrom, 1)
    cards.splice(to, 0, moved)
    setDragFrom(null)
    setDragOver(null)
    persist({ ...layout, cards })
  }
  const restore = (id: BuiltInCard) =>
    persist({ cards: [...layout.cards, { id, kind: 'builtin' }], hidden: layout.hidden.filter((h) => h !== id) })

  const firstName = user?.name.split(' ')[0] ?? 'there'

  // EVERY ADDRESS, EVERY NUMBER — the My Asa profile card was not showing all of a person's e-mails and phone…
  const emails = useMemo(() => (user ? contactEmails(user) : []), [user])
  // A person's numbers, and NOTHING ELSE.
  const phones = useMemo(() => (user ? contactPhones(user) : []), [user])


  // MY CERTIFICATIONS — the real staffCerts sheet, for the person this page is drawn for.
  const { certs: myCerts, read: certsRead, reason: certsReason, retry: retryCerts } = useMyCerts(
    String(user?.id ?? ''),
    String(user?.name ?? ''),
  )

  // The master card's contents come from the SAME builder the right-hand detail panel uses (`buildProfilePanel`)…
  const masterSections = useMemo(() => {
    if (!user || !isMaster) return []
    const { record, config } = buildProfilePanel({ user, installedCount: 0, overview })
    const sections = (config.sections ?? []) as { kind: string; title?: string; fields?: { icon?: string; label: string; value: string }[] }[]
    return sections
      .filter((s) => String(s.title ?? '').toLowerCase().startsWith('master') || ['Armed situations', 'Signed in now', 'Admins'].some((t) => String(s.title ?? '').startsWith(t)))
      .map((s) => ({
        title: s.title ?? '',
        rows: (s.fields ?? []).map((f) => ({ label: f.label, value: String(record[f.value] ?? '—') })),
      }))
  }, [user, isMaster, overview])

  /** Every card this page can show, by id — the layout decides which. */
  const CARDS: Record<BuiltInCard, ReactNode> = {
    master: (
      <Card>
        <CardHeader
          title="Platform"
          sub="What only this account sees — read-only, from the server on every open"
          extra={<RoleBadge user={user ? { ...user, isMaster: true } : null} />}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {masterSections.map((s) => (
            <div key={s.title}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{s.title}</p>
              <div className="space-y-1.5">
                {s.rows.map((r, i) => (
                  <div key={i} className="text-[13px] leading-[1.5]">
                    <span className="text-text-3">{r.label}</span>
                    <span className="ml-1.5 break-words text-text-1">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    ),
    profile: (
        <Card>
          <CardHeader
            title="My profile"
            sub="Who you are inside asa.."
            extra={
              <button
                onClick={() => openProfile(true)}
                aria-label="Edit my profile"
                title="Edit my profile"
                className="grid h-8 w-8 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <Pencil size={14} />
              </button>
            }
          />
          <div className="flex items-center gap-4">
            <button
              onClick={() => openProfile(true)}
              aria-label="Change my avatar"
              title="Change my avatar"
              className="rounded-full transition-transform duration-150 hover:scale-[1.04]"
            >
              {/* `user` is the VISITED person while a visit is open, so this
                  face and name are very often somebody else's — draggable. */}
              <DragPerson name={user?.name ?? ''} id={user?.id} avatar={user?.avatar || undefined} subtitle={user?.title || undefined}>
                <Avatar src={user?.avatar ?? ''} name={user?.name ?? 'Guest'} size="xl" />
              </DragPerson>
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DragPerson name={user?.name ?? ''} id={user?.id} avatar={user?.avatar || undefined} subtitle={user?.title || undefined}>
                  <p className="text-[15px] font-semibold text-text-1">{user?.name ?? 'Guest'}</p>
                </DragPerson>
                {/* the server's answer counts as proof of master even when the
                    published backend does not send `is_master` yet; only the
                    HIGHEST badge shows here */}
                <HighestBadge user={user ? { ...user, isMaster } : null} size="sm" />
              </div>
            </div>
          </div>
          {/* contact block — title sits BELOW the phone numbers.
              THE EXTRAS STACK UNDER THE PRIMARY, at the same type scale and
              under the same icon: this card is a summary, and a second column
              of addresses would make it a directory. One of each renders the
              three rows it always rendered. */}
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <div className="flex items-start gap-2.5 text-[13px] text-text-2">
              <Mail size={14} className="mt-[3px] shrink-0 text-text-3" />
              <div className="min-w-0 space-y-1">
                {emails.length === 0 && <p>—</p>}
                {emails.map((e) => (
                  <p key={e} className="clamp-1">{e}</p>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-[13px] text-text-2">
              <Phone size={14} className="mt-[3px] shrink-0 text-text-3" />
              {/* a visit carries no number list: unread, never "no phone" */}
              {visiting ? (
                <p className="text-text-3">— not read for a visit</p>
              ) : phones.length === 0 ? (
                <button onClick={() => openProfile(true)} className="text-text-3 underline-offset-2 hover:underline">
                  Add your phone
                </button>
              ) : (
                <div className="min-w-0 space-y-1">
                  {phones.map((p) => (
                    <p key={p.number} className="clamp-1">
                      {formatPhoneDisplay(p.number)}
                      {/* the label only when there is a choice to make: one
                          number needs no name, several do — which to try
                          depends on why you are calling */}
                      {phones.length > 1 && <span className="text-text-3"> · {p.label}</span>}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <p className="flex items-center gap-2.5 text-[13px] text-text-2">
              <Briefcase size={14} className="shrink-0 text-text-3" />
              {user?.title || (
                <button onClick={() => openProfile(true)} className="text-text-3 underline-offset-2 hover:underline">
                  Add your job title
                </button>
              )}
            </p>
          </div>
        </Card>
    ),
    // FULLY EDITABLE — real roster chips + the person's own reminders and events, in its own component.
    week: <MyWeekCard userName={String(user?.name ?? '')} />,
    certifications: <MyCertsCard certs={myCerts} read={certsRead} reason={certsReason} onRetry={retryCerts} visiting={visiting} />,
    bookmarks: (
        <Card className="lg:col-span-2">
          <CardHeader
            title="My bookmarks"
            sub={bookmarks.length ? `${bookmarks.length} saved for later` : 'Nothing saved yet.'}
            extra={<Bookmark size={16} className="text-text-3" />}
          />
          {bookmarks.length === 0 ? (
            <p className="text-[13px] leading-5 text-text-3">
              Tap the bookmark icon on any person, document, video or page and it lands here.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {bookmarks.slice(0, 8).map((b) => (
                <Link
                  key={b.id}
                  to={b.href}
                  className="group flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-[8px]',
                      TINT_PAIR(b.tint),
                    )}
                  >
                    <Bookmark size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Only a bookmarked PERSON is draggable — a document, a
                        video or a page has a title, not a name. An empty name
                        makes DragPerson render its child untouched. */}
                    <DragPerson
                      name={b.type === 'person' || b.type === 'candidate' ? b.title : ''}
                      id={b.refId}
                      avatar={b.avatar}
                      subtitle={b.subtitle}
                      className="block min-w-0"
                    >
                      <span className="clamp-1 block text-[13px] font-medium text-text-1">{b.title}</span>
                    </DragPerson>
                    {b.subtitle && <span className="clamp-1 block text-[11px] text-text-3">{b.subtitle}</span>}
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-text-3 transition-transform duration-150 group-hover:translate-x-[2px]" />
                </Link>
              ))}
            </div>
          )}
          {bookmarks.length > 0 && (
            <Link
              to="/bookmarks"
              className="group/link mt-4 flex items-center gap-1 border-t border-border pt-3 text-[13px] font-semibold text-primary-strong transition-colors hover:text-primary"
            >
              All bookmarks
              <ArrowRight size={14} className="transition-transform duration-150 group-hover/link:translate-x-[3px]" />
            </Link>
          )}
        </Card>
    ),
  }

  /** The cards the grid draws: the master card rides outside it, and a client's corner has no certifications. */
  const gridCards = layout.cards.filter((c) => c.kind === 'indicator' || (!MASTER_ONLY_CARDS.includes(c.id) && !hideForClient(c.id)))

  return (
    <div className="w-full">
      {/* the platform's black header, over this person's own numbers — on a
          visit, only the figures read for the visited person */}
      <MyAsaHero
        figures={{
          certs: myCerts.length,
          expiring: myCerts.filter((c) => c.status === 'expiring').length,
          expired: myCerts.filter((c) => c.status === 'expired').length,
          bookmarks: bookmarks.length,
          // what the page draws: the grid, and the master card beside it
          cards: gridCards.length + (isMaster ? 1 : 0),
          emails: emails.length,
          phones: phones.length,
        }}
        certsRead={certsRead}
        certsReason={certsReason}
        certsShown={!hideForClient('certifications')}
        who={user?.name ?? ''}
        visiting={visiting}
        onRetry={certsReason === CERTS_NO_NAME ? undefined : retryCerts}
      />

      {/* greeting */}
      <div className="mb-6">
        <h1 className="font-display text-[28px] font-extrabold leading-9 tracking-[-0.015em] text-text-1">
          {visiting ? `${firstName}'s asa.` : `Your asa., ${firstName}`}
        </h1>
        <p className="mt-1 text-[13px] text-text-2">
          {/* the greeting's "today" is Ohio's today, for every viewer */}
          {visiting
            ? `${user?.name || 'Their'}'s personal corner — you are visiting, and nothing here is yours to change.`
            : `Your personal corner of the workspace — ${ohioLongDay(new Date())}.`}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!visiting && <button
            onClick={() => setEditing((e) => !e)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold transition-colors',
              editing ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-1 hover:bg-surface-2',
            )}
          >
            <Pencil size={13} /> {editing ? 'Done' : 'Edit my page'}
          </button>}
          {editing && (
            <>
              <button
                onClick={() => setAddOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <Plus size={13} /> Add an indicator
              </button>
              {/* THE INGEST DOOR — widgets can be taken in from here: the
                  bank's curated rows, one press each */}
              <button
                onClick={() => setBankOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <Plus size={13} /> From the bank
              </button>
              {/* the master card is never offered here — it is not a choice */}
              {layout.hidden.filter((h) => !MASTER_ONLY_CARDS.includes(h) && !hideForClient(h)).map((h) => (
                <button
                  key={h}
                  onClick={() => restore(h)}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Plus size={12} /> {BUILTIN_LABEL[h]}
                </button>
              ))}
              <button
                onClick={() => persist(resetLayout(userId))}
                className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold text-text-3 transition-colors hover:text-text-1"
              >
                <RotateCcw size={12} /> Reset
              </button>
            </>
          )}
        </div>
      </div>

      {/* THE INSTANCES YOU OWN THAT HAVE NO SCREEN.
          A notification app is still an app — installable, uninstallable,
          yours — but it has nothing to draw, so without this it would exist
          only as a row in a spreadsheet and a tile that goes nowhere. Here it
          is something you can see you have, and clicking it opens the only
          thing it actually is: its configuration. */}
      {/* THE SEND ACTIVITY IS AN ADMINISTRATIVE VIEW — it was showing for
          everyone — badge-gated like the star and the grid,
          and absent means the old behaviour for a backend not publishing it */}
      {user?.smartCommsWidget !== false && <NotificationApps />}

      <NewIndicatorModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={(spec) => persist({ ...layout, cards: [...layout.cards, spec] })}
      />
      <BankPickerModal
        open={bankOpen}
        onOpenChange={setBankOpen}
        userId={userId}
        onTaken={() => setLayout(loadLayout(userId))}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {gridCards.map((c, i) => (
          <div
            key={c.id}
            // DRAGGING IS THE GESTURE — items move from one side to the other; edit mode only, so a card cannot fly…
            draggable={editing}
            onDragStart={() => setDragFrom(i)}
            onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
            onDragOver={(e) => { if (editing) { e.preventDefault(); setDragOver(i) } }}
            onDrop={(e) => { e.preventDefault(); dropCard(i) }}
            className={cn(
              'relative',
              editing && 'cursor-grab active:cursor-grabbing',
              dragFrom === i && 'opacity-40',
              dragOver === i && dragFrom !== null && dragFrom !== i && 'rounded-lg ring-2 ring-primary ring-offset-2',
            )}
          >
            {editing && (
              <div className="absolute -top-2 right-2 z-10 flex gap-1 rounded-md border border-border bg-surface p-1 shadow-2">
                <button onClick={() => moveCard(i, -1)} disabled={i === 0} aria-label="Move up"
                  className="grid h-6 w-6 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30">
                  <ArrowUp size={12} />
                </button>
                <button onClick={() => moveCard(i, 1)} disabled={i === layout.cards.length - 1} aria-label="Move down"
                  className="grid h-6 w-6 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30">
                  <ArrowDown size={12} />
                </button>
                {!(c.kind === 'builtin' && c.id === 'profile') && (
                  <button onClick={() => removeCard(i)} aria-label="Remove from my page" title="Remove from my page"
                    className="grid h-6 w-6 place-items-center rounded-sm text-danger hover:bg-tint-pink">
                    <X size={13} />
                  </button>
                )}
              </div>
            )}
            {c.kind === 'indicator' ? <IndicatorCard spec={c} /> : CARDS[c.id]}
          </div>
        ))}
        {/* Rendered OUTSIDE the stored layout on purpose: it is not a card
            anybody chose, it cannot be added, and it appears only while the
            server is still answering `masterOverview` to this account. */}
        {isMaster && <div className="relative lg:col-span-2">{CARDS.master}</div>}

        {layout.cards.length === 0 && (
          <Card className="lg:col-span-2">
            <p className="py-6 text-center text-[13px] text-text-3">
              Your page is empty — exactly as you left it. Use “Edit my page” to put something back.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
