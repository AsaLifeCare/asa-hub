// MY INBOX · Alerts — one list of what concerns the person, grouped by the Ohio day, with every source's state…
// Whose alerts these are is the relay's decision (/hub-lanes/my-inbox).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CheckCheck, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { AlertRow, dayGroups } from '@/components/shared/AlertRow'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import FilterChips, { type ActiveFilter } from '@/components/shared/FilterChips'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import Skeleton from '@/components/shared/Skeleton'
import { useAuthStore } from '@/auth/useAuthStore'
import { useChatPresenceStore } from '@/lib/chatPresence'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { ReadStamp } from '@/components/FreshnessStamp'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import {
  FAMILY_CHIPS, MENTIONS_LINE, MESSAGES, TYPE_CHIPS, alertDay, alertWhen, asOfWords, chatAlert, chipsOf, choiceAfter,
  clearable, emptyWords, filterAlerts, listedItems, levelPill, lookFor, opensPanel,
  headLines, headPill, markable, marksMode, marksUnreadLine, notOnPlatform, readKeys, sentenceCase,
  sourceHeads, sourcesForUsersLine, sourcesHidden, tabLabels, typeOfChip, unreadKeys, withChat,
  type AlertItem, type InboxHead, type InboxTab, type MyInboxView, type Tone,
} from './myInboxModel'
import AlertPanel from './AlertPanel'
import { useMyInbox, type Chooser, type MyInboxState } from './useMyInbox'
import { useTestWarningsHidden, withoutTestWords } from '@/lib/myWorkHides'

/** Rows drawn before "Show older alerts". */
export const PAGE_ROWS = 30

const PILL_TONE: Record<Tone, string> = {
  good: 'bg-[var(--status-green-soft)] text-[var(--status-green)]',
  warning: 'bg-tint-amber text-tint-fg-amber',
  danger: 'bg-tint-pink text-danger',
  muted: 'bg-surface-2 text-text-2',
}
const LINE_TONE: Record<Tone, string> = {
  good: 'text-text-3',
  warning: 'text-[var(--warning)]',
  danger: 'text-[var(--danger)]',
  muted: 'text-text-3',
}
const QUIET_BUTTON = 'h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

/** Everything the Alerts view holds. An open member visit reads nothing: the door answers the session's own account. */
export function useMyInboxAlerts(person: string, onPerson: (uid: string) => void) {
  const signedIn = useAuthStore((s) => !!s.user)
  const acting = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const visiting = !!useEffectiveUser()?.visiting
  const inbox = useMyInbox(signedIn && !visiting, person)
  // a person the door refuses as out of scope, or as no such account, is let go
  const kept = choiceAfter(inbox.state, person)
  useEffect(() => {
    if (kept !== person) onPerson(kept)
  }, [kept, person, onPerson])
  const chatUnread = useChatPresenceStore((s) => s.unread)
  const chatLatest = useChatPresenceStore((s) => s.latest)
  // the chat is the signed-in person's own: never merged into a chosen person's alerts
  const chat = person ? null : chatAlert(chatUnread, chatLatest)
  return { visiting, acting, chat, ...inbox }
}

export default function AlertsView() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const person = new URLSearchParams(search).get('person') ?? ''
  const onPerson = useCallback(
    (uid: string) => navigate(`${pathname}${uid ? `?person=${encodeURIComponent(uid)}` : ''}`, { replace: true }),
    [navigate, pathname],
  )
  const a = useMyInboxAlerts(person, onPerson)
  const mode = marksMode(a.view, a.acting)
  // the alert whose panel is open; drawn from the answer as this tab has marked it
  const [panelId, setPanelId] = useState('')
  const panelItem = panelId ? (a.view?.items ?? []).find((it) => it.id === panelId) ?? null : null
  const open = (item: AlertItem) => {
    if (markable(item) && !item.read && mode.enabled) void a.markRead([item.id])
    if (opensPanel(item)) { setPanelId(item.id); return }
    if (item.link?.href) navigate(item.link.href)
  }
  return (
    <>
      <AlertsScreen
        state={a.state}
        view={a.view}
        chat={a.chat}
        chooser={a.chooser}
        person={person}
        acting={a.acting}
        onPerson={onPerson}
        onOpen={open}
        onMarkRead={(ids) => void a.markRead(ids)}
        onClear={(ids) => void a.clear(ids)}
        onRetry={() => void a.refresh()}
      />
      <AlertPanel item={panelItem} acting={a.acting} onClose={() => setPanelId('')}
        onAnswered={(item, said) => {
          void a.answered(item.id)
          toast({ type: 'success', title: 'Marked', body: said || 'Recorded.' })
        }} />
    </>
  )
}

export function AlertsScreen({
  state, view, chat, chooser, person, acting, onPerson, onOpen, onMarkRead, onClear, onRetry,
  initialTab = 'all', initialType = '', initialSelect = false,
}: {
  state: MyInboxState
  /** the answer as this tab has marked it */
  view: MyInboxView | null
  chat: AlertItem | null
  chooser: Chooser | null
  person: string
  acting: boolean
  onPerson: (uid: string) => void
  onOpen: (item: AlertItem) => void
  onMarkRead: (ids: string[]) => void
  onClear: (ids: string[]) => void
  onRetry: () => void
  initialTab?: InboxTab
  initialType?: string
  initialSelect?: boolean
}) {
  const [pickedTab, setTab] = useState<string>(initialTab)
  const [typeFilters, setTypeFilters] = useState<ActiveFilter[]>(() => {
    const chip = TYPE_CHIPS.find((c) => c.type === initialType) ?? FAMILY_CHIPS.find((c) => c.type === initialType)
    return chip ? [{ key: 'type', label: 'Type', value: chip.label }] : []
  })
  const [selectMode, setSelectMode] = useState(initialSelect)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(PAGE_ROWS)
  // Settings › My Work hides every test mode warning from anyone but the master: an item's "Test mode" part too
  const noTest = useTestWarningsHidden()

  const chosen = !!person
  // a chosen person has no Mentions: the chat is only ever the signed-in person's
  const tab = chosen && pickedTab === 'mentions' ? 'all' : pickedTab
  const items = useMemo(() => withChat(listedItems(view), chosen ? null : chat), [view, chat, chosen])
  const picked = typeFilters[0] ? typeOfChip(typeFilters[0].value) : ''
  const type = chosen && picked === MESSAGES ? '' : picked
  const filtered = useMemo(() => filterAlerts(items, tab, type), [items, tab, type])
  const groups = useMemo(() => dayGroups(filtered.slice(0, visible), (it) => alertDay(it.at)), [filtered, visible])
  const mode = marksMode(view, acting)
  const unread = items.filter((it) => !it.read).length
  const toMark = unreadKeys(items)
  const toClear = readKeys(items)
  // the chooser is the answer's own when one is drawn; while a read runs, the session's last mass answer's
  const bar = chooser
  const who = chosen ? (view?.subject.name || bar?.people?.find((p) => p.uid === person)?.label || '') : ''
  const tabs = tabLabels(items).filter((t) => !(chosen && t.id === 'mentions'))

  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  if (state.status === 'refused') {
    return (
      <div className="w-full pb-16">
        <EmptyState title={state.reason === 'visit' ? 'My Inbox' : 'My Inbox is not open here'} body={state.error} />
      </div>
    )
  }

  const unreadLine = marksUnreadLine(view)
  return (
    <div className="w-full pb-16">
      {bar && <PersonBar chooser={bar} person={person} who={who} onPerson={onPerson} />}
      {view?.scope.why && <p className="mb-3 text-[12px] text-text-3">{view.scope.why}</p>}
      {view?.subject.key_why && (
        <p className="mb-3 text-[12px] text-[var(--warning)]">{sentenceCase(view.subject.key_why)}</p>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[20px] font-bold leading-7 text-text-1">
          {who ? `Alerts · ${who}` : 'Alerts'}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {unread > 0 && (
            <span data-unread-pill className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-on-primary">
              {unread} unread
            </span>
          )}
          {mode.show && (
            <button
              type="button"
              data-mark-all
              onClick={() => onMarkRead(toMark)}
              disabled={!mode.enabled || toMark.length === 0}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCheck size={14} /> Mark all as read
            </button>
          )}
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-2 mb-3 flex flex-wrap items-center gap-2 bg-bg/85 px-2 py-3 backdrop-blur">
        <SegmentedTabs tabs={tabs} value={tab} onChange={setTab} />
        <FilterChips
          filters={[{ key: 'type', label: 'Type', options: chipsOf(view).filter((c) => !(chosen && c.type === MESSAGES)).map((c) => c.label) }]}
          active={typeFilters}
          onAdd={(f) => setTypeFilters([f])}
          onRemove={() => setTypeFilters([])}
        />
        {mode.show && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              data-select
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              disabled={!mode.enabled}
              className={cn(QUIET_BUTTON, selectMode && 'bg-surface-3 text-text-1')}
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
            <button
              type="button"
              data-clear-read
              onClick={() => onClear(toClear)}
              disabled={!mode.enabled || toClear.length === 0}
              className={QUIET_BUTTON}
            >
              Clear read
            </button>
          </div>
        )}
      </div>

      {mode.line && <p data-marks-line className="mb-3 text-[12px] text-text-3">{mode.line}</p>}
      {tab === 'mentions' && <p data-mentions-line className="mb-3 text-[12px] text-text-3">{MENTIONS_LINE}</p>}
      {unreadLine && <p className="mb-3 text-[12px] text-[var(--warning)]">{unreadLine}</p>}
      {view?.capped && <p className="mb-3 text-[12px] text-[var(--warning)]">{sentenceCase(view.capped)}</p>}
      {view && state.status === 'failed' && (
        <p role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--warning)]">
          The last refresh failed: {state.error || 'no answer'}. What is shown is from the read before.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      )}

      {!view ? (
        <ReadLine state={state} chosen={chosen} onRetry={onRetry} />
      ) : filtered.length === 0 ? (
        <Card padded={false}>
          <p data-empty className="px-6 py-10 text-center text-[13px] leading-5 text-text-2">
            {emptyWords(view, tab, type, chosen)}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.label}</h3>
              <Card padded={false} className="divide-y divide-border overflow-hidden">
                {g.rows.map((it) => {
                  const look = lookFor(it)
                  const own = markable(it) && mode.enabled
                  return (
                    <div key={it.id} data-alert={it.id} data-type={it.type}>
                      <AlertRow
                        icon={look.icon}
                        tint={look.tint}
                        title={it.title}
                        body={noTest && it.body ? withoutTestWords(it.body) : it.body}
                        when={alertWhen(it.at)}
                        read={it.read}
                        flag={it.flag}
                        level={it.level}
                        pill={levelPill(it)}
                        canOpen={!!it.link?.href}
                        openLabel={it.link?.label || 'Open'}
                        selectMode={selectMode && markable(it)}
                        selected={selected.has(it.id)}
                        selectLabel="Select alert"
                        onSelect={(on) => toggle(it.id, on)}
                        onOpen={() => onOpen(it)}
                        onMarkRead={own ? () => onMarkRead([it.id]) : undefined}
                        onDelete={own && clearable(it) ? () => onClear([it.id]) : undefined}
                        deleteLabel="Clear"
                      />
                    </div>
                  )
                })}
              </Card>
            </section>
          ))}
          {visible < filtered.length && (
            <div className="flex justify-center">
              <button type="button" onClick={() => setVisible((v) => v + PAGE_ROWS)} className={QUIET_BUTTON}>
                Show older alerts
              </button>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {selectMode && selected.size > 0 && mode.enabled && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="sticky bottom-4 z-10 mt-4 flex justify-center"
          >
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 shadow-2">
              <span className="px-2 text-[12px] font-medium text-text-2">{selected.size} selected</span>
              <button
                type="button"
                onClick={() => { onMarkRead([...selected]); exitSelect() }}
                className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <Check size={13} /> Mark read
              </button>
              <button
                type="button"
                onClick={() => { onClear(items.filter((it) => selected.has(it.id) && clearable(it)).map((it) => it.id)); exitSelect() }}
                className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-semibold text-danger transition-colors hover:bg-tint-pink"
              >
                <Trash2 size={13} /> Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {view && !sourcesHidden(view) && <SourcesCard view={view} />}
      {view && (state.readAt > 0 || state.kept) && (
        <ReadStamp at={state.readAt} kept={state.kept} />
      )}
    </div>
  )
}

/** Before the first answer: reading, or the read that failed — never an empty inbox. */
function ReadLine({ state, chosen, onRetry }: { state: MyInboxState; chosen: boolean; onRetry: () => void }) {
  if (state.status === 'failed') {
    return (
      <Card>
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger)]">
          My Inbox could not be read: {state.error || 'no answer'}. Nothing is listed rather than an empty inbox.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      </Card>
    )
  }
  return (
    <div className="space-y-4" aria-label={chosen ? 'Reading this person’s alerts' : 'Reading your alerts'}>
      <p className="flex items-center gap-2 text-[12.5px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> {chosen ? 'Reading this person’s alerts…' : 'Reading your alerts…'}
      </p>
      <Card padded={false} className="divide-y divide-border">
        {[0, 1, 2].map((r) => (
          <div key={r} className="flex items-center gap-3 px-5 py-4">
            <Skeleton className="h-9 w-9 rounded-[10px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

function RetryButton({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <button type="button" onClick={onRetry} disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
      <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Try again
    </button>
  )
}

/** The master's chooser: their own alerts, or any active account's, read-only. Drawn only from a mass answer. */
export function PersonBar({ chooser, person, who, onPerson }: {
  chooser: Chooser
  person: string
  who: string
  onPerson: (uid: string) => void
}) {
  const people = chooser.people ?? []
  const listed = !person || people.some((p) => p.uid === person)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="text-[12.5px] font-semibold text-text-2" htmlFor="my-inbox-person">Person</label>
      <select id="my-inbox-person" value={person} onChange={(e) => onPerson(e.target.value)}
        className="h-9 max-w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary">
        <option value="">Your own alerts</option>
        {!listed && <option value={person}>{who || 'The person chosen'}</option>}
        {people.map((p) => (
          <option key={p.uid} value={p.uid}>{p.role ? `${p.label} · ${p.role}` : p.label}</option>
        ))}
      </select>
      {chooser.people === null && (
        <span className="w-full text-[12px] text-[var(--warning)]">
          Nobody can be chosen: {sentenceCase(chooser.people_why) || 'the accounts could not be read.'}
        </span>
      )}
    </div>
  )
}

// Every source with its state: what could not be read, what is held or shut, and what the platform cannot tell yet.
export function SourcesCard({ view }: { view: MyInboxView }) {
  const heads = sourceHeads(view)
  const missing = notOnPlatform(view)
  const forUsers = sourcesForUsersLine(view)
  return (
    <section aria-label="Sources" className="mt-6 rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">Sources</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-text-3">Where these alerts come from, and what each one could tell.</p>
      {forUsers && <p data-for-users className="mb-3 text-[12px] leading-[1.5] text-text-3">{forUsers}</p>}
      <ul className="divide-y divide-border">
        {heads.map((h) => <SourceRow key={h.key} h={h} />)}
      </ul>
      {missing.length > 0 && (
        <>
          <h3 className="mb-1 mt-5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Not on the platform yet</h3>
          <ul className="divide-y divide-border">
            {missing.map((h) => <SourceRow key={h.key} h={h} />)}
          </ul>
        </>
      )}
    </section>
  )
}

function SourceRow({ h }: { h: InboxHead }) {
  const pill = headPill(h)
  const lines = headLines(h)
  const asOf = h.state === 'ready' ? asOfWords(h.as_of) : ''
  return (
    <li data-source={h.key} data-state={h.state} className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-text-1">
          {h.label}
          {asOf && <span className="ml-2 text-[11.5px] font-normal text-text-3">{asOf}</span>}
        </span>
        <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', PILL_TONE[pill.tone])}>
          {pill.text}
        </span>
      </div>
      {lines.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {lines.map((l) => <li key={l.key} className={cn('text-[12px] leading-[1.5]', LINE_TONE[l.tone])}>{l.text}</li>)}
        </ul>
      )}
    </li>
  )
}
