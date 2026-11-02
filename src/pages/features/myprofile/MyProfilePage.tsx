// MY PROFILE · My Details, My Requirements, My Docs — one screen with a left rail over the three pages.
// Whose profile this is is the relay's decision (/hub-lanes/my-profile): the signed-in account's own, or any roster…
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { useShellHides } from '@/lib/myWorkHides'
import { Eye, FileText, GraduationCap, Pencil, Plus, RefreshCw, ScanText, ShieldCheck, User } from 'lucide-react'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import EmptyState from '@/components/shared/EmptyState'
import SidePanel from '@/components/shared/SidePanel'
import { TrainingRequestForm } from '@/pages/features/staffprofiles/StaffForms'
import { useAuthStore } from '@/auth/useAuthStore'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { ReadStamp } from '@/components/FreshnessStamp'
import { cn } from '@/lib/utils'
import { MY_PROFILE_APP_ID, MY_PROFILE_PAGES, MY_REQUIREMENTS_FEATURE, type MyProfilePageId } from '@/registry/apps-myprofile'
import { pageGateAllows } from '@/lib/pageGate'
import { useFeatureAllowed } from '@/lib/featureAccess'
import {
  CLIENT_CHOICE, DUE_TONE_CLASS, STATUS_PILL, choiceAfter, choiceLabel, choiceOf, dayWords, docType, docsEmpty, docsFor, fieldText,
  filedStatus, guardianTitle, isClientView, isGuardianView, isPhoneField, partLines, phoneHref, requirementsEmpty, sentence,
  uploadFor, versionFor, type Docs, type Field, type MyProfileView, type PersonEntry, type RequirementRow, type SourceLine,
  type UploadsState,
} from './myProfileModel'
import ProfileUploadSheet, { UPLOAD_AND_READ, type ProfileUploadAsk } from './ProfileUploadSheet'
import { chooserOf, useAddress, useMyProfile, useUploads, type Chooser, type MyProfileState } from './useMyProfile'
import VersionCard, { type VersionAsk } from './VersionCard'
import MyLoans from './MyLoans'
import AddressPanel from './AddressPanel'
import ContactPanel, { useAccountContacts } from './ContactPanel'
import { emailsBeside, phonesBeside, type AccountContacts, type ContactKind } from './contactModel'
import { ADDRESS_READING, addressAsk, addressField, addressPencil, type AddressState } from './addressModel'

export const VISIT_SENTENCE = "My Profile shows the signed-in account's own profile — close the visit to see it."

const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const MOBILE_LABEL = 'mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3 sm:hidden'
const ICON_BUTTON = 'inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--success)] text-primary ' +
  'transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:border-border disabled:text-text-3 disabled:opacity-60'
// the column templates are whole literals so the stylesheet keeps them
const REQ_COLS = 'sm:grid-cols-[130px_minmax(180px,2fr)_minmax(130px,1fr)_minmax(110px,0.8fr)_80px]'
const DOC_COLS = 'sm:grid-cols-[40px_minmax(200px,2fr)_minmax(120px,1fr)_minmax(120px,0.8fr)]'
const LINE_TONE = { danger: 'text-[var(--danger)]', warning: 'text-[var(--warning)]', muted: 'text-text-3' } as const
const PAGE_ICON = { details: User, requirements: ShieldCheck, docs: FileText } as const

const pageOf = (id: string): MyProfilePageId => (MY_PROFILE_PAGES.some((p) => p.id === id) ? id as MyProfilePageId : 'details')
const personQuery = (person: string) => (person ? `?person=${encodeURIComponent(person)}` : '')

/** Everything the page holds. An open member visit reads nothing: the door answers the session's own account. */
export function useMyProfilePage(person: string, onPerson: (key: string) => void) {
  const signedIn = useAuthStore((s) => !!s.user)
  // a client-role account has no staff ledger to read: its profile is its client's record
  const client = useAuthStore((s) => s.user?.role === 'client')
  const eff = useEffectiveUser()
  const visiting = !!eff?.visiting
  const { state, refresh, chooser } = useMyProfile(signedIn && !visiting, person)
  const { uploads, refreshUploads } = useUploads(signedIn && !visiting && !client)
  // the Address is the Employee Database's, on a staff profile only: the door decides whose from the session
  const ask = signedIn && !visiting && !client ? addressAsk(state.data) : null
  const { address, refreshAddress, savedAddress } = useAddress(ask)
  // a person the door refuses as out of scope, or as no roster row, is let go
  const kept = choiceAfter(state, person)
  useEffect(() => {
    if (kept !== person) onPerson(kept)
  }, [kept, person, onPerson])
  return { visiting, state, refresh, chooser, uploads, refreshUploads, ask, address, refreshAddress, savedAddress }
}

type PanelAsk = { kind: 'card'; card: VersionAsk } | { kind: 'upload'; upload: ProfileUploadAsk } | { kind: 'address' }
  | { kind: 'contact'; contact: ContactKind }

// The one right panel: the eye's card, an upload, the address or a new e-mail or phone, never two.
export function useProfilePanel(page: MyProfilePageId, person: string) {
  const here = `${page}|${person}`
  const [slot, setSlot] = useState<{ here: string; ask: PanelAsk | null }>({ here, ask: null })
  // let go, not hidden: coming back to the page or person never reopens it
  if (slot.here !== here) setSlot({ here, ask: null })
  const ask = slot.here === here ? slot.ask : null
  const onView = useCallback((card: VersionAsk) => setSlot({ here, ask: { kind: 'card', card } }), [here])
  const onUpload = useCallback((upload: ProfileUploadAsk) => setSlot({ here, ask: { kind: 'upload', upload } }), [here])
  const onAddress = useCallback(() => setSlot({ here, ask: { kind: 'address' } }), [here])
  const onContact = useCallback((contact: ContactKind) => setSlot({ here, ask: { kind: 'contact', contact } }), [here])
  const onClose = useCallback(() => setSlot({ here, ask: null }), [here])
  return {
    card: ask?.kind === 'card' ? ask.card : null,
    upload: ask?.kind === 'upload' ? ask.upload : null,
    address: ask?.kind === 'address',
    contact: ask?.kind === 'contact' ? ask.contact : null,
    onView, onUpload, onAddress, onContact, onClose,
  }
}

export default function MyProfilePage() {
  const { pageId = '' } = useParams()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  // My Docs is the master's alone while Settings › My Work hides it, and My Requirements while App Control's row does
  // not name this person: the page opens on My Details instead
  const hides = useShellHides()
  const requirements = useFeatureAllowed(MY_REQUIREMENTS_FEATURE)
  const shut = (pageId === 'docs' && hides.profile_docs) || (pageId === 'requirements' && !requirements)
  const page = pageOf(shut ? 'details' : pageId)
  useSectionCrumb(MY_PROFILE_PAGES.find((p) => p.id === page)?.title)
  const person = new URLSearchParams(search).get('person') ?? ''
  const onPerson = useCallback((key: string) => navigate(`${pathname}${personQuery(key)}`, { replace: true }),
    [navigate, pathname])
  const { visiting, state, refresh, chooser, uploads, refreshUploads, ...addr } = useMyProfilePage(person, onPerson)
  const { ask, address, refreshAddress, savedAddress } = addr
  const { card, upload, address: addressOpen, contact, onView, onUpload, onAddress, onContact, onClose } = useProfilePanel(page, person)
  const [training, setTraining] = useState(false)
  const self = trainingSelf(state.data)
  const contacts = useAccountContacts()
  const reread = useCallback(() => { void refreshAddress(true) }, [refreshAddress])
  if (visiting) return <VisitNotice />
  return (
    <>
      <MyProfileScreen page={page} state={state} uploads={uploads} person={person} onPerson={onPerson} chooser={chooser}
        onRetry={() => { void refresh(); void refreshUploads(); void refreshAddress() }}
        onUpload={(u) => { setTraining(false); onUpload(u) }} onView={(c) => { setTraining(false); onView(c) }}
        onTraining={self ? () => { onClose(); setTraining(true) } : undefined}
        address={address} onAddress={() => { setTraining(false); onAddress() }}
        contacts={self ? contacts : null} onContact={self ? (k) => { setTraining(false); onContact(k) } : undefined} />
      <ContactPanel kind={page === 'details' && self ? contact : null} onClose={onClose} />
      <ProfileUploadSheet ask={upload} onClose={onClose} onFiled={() => void refreshUploads()} />
      <VersionCard ask={card} view={state.data} uploads={uploads} onClose={onClose}
        onConfirmed={() => void refreshUploads()} />
      <AddressPanel open={addressOpen && page === 'details'} ask={ask} own={!!state.data?.person.own}
        name={state.data?.person.name ?? ''} address={address} onClose={onClose} onReread={reread}
        onSaved={(next) => { savedAddress(next); reread() }} />
      <SidePanel open={training && !!self} onClose={() => setTraining(false)} label="Assign Training" title="Request training">
        {training && self && (
          <TrainingRequestForm key={self.key} staffKey={self.key} name={self.name} who="Yourself" onDone={() => setTraining(false)} />
        )}
      </SidePanel>
    </>
  )
}

/** The signed-in staff member's own profile: who a training request is for; null for a client, a guardian or another's. */
export function trainingSelf(view: MyProfileView | null): { key: string; name: string } | null {
  if (!view || !view.person.own || !view.person.key || isClientView(view) || isGuardianView(view)) return null
  return { key: view.person.key, name: view.person.name }
}

export function VisitNotice() {
  return (
    <div className="w-full pb-16">
      <EmptyState title="My Profile" body={VISIT_SENTENCE} />
    </div>
  )
}

export function MyProfileScreen({ page, state, uploads, person, onPerson, onRetry, onUpload, onView, chooser = null, onTraining,
  address, onAddress, contacts, onContact }: {
  /** the signed-in account's e-mails and phones, drawn under My Info's own; on one's own staff profile only */
  contacts?: AccountContacts | null
  /** opens the panel that adds an e-mail or a phone to one's own account; the "+" is drawn only with it */
  onContact?: (kind: ContactKind) => void
  page: MyProfilePageId
  state: MyProfileState
  uploads: UploadsState
  person: string
  onPerson: (key: string) => void
  onRetry: () => void
  onUpload: (ask: ProfileUploadAsk) => void
  onView: (ask: VersionAsk) => void
  /** the person list to draw while no answer is held for the person chosen (the session's last mass answer's) */
  chooser?: Chooser | null
  /** opens the training request for the signed-in staff member's own record */
  onTraining?: () => void
  /** the Address as the Employee Database keeps it (staffProfileAddress) */
  address?: AddressState
  /** opens the address panel; the pencil is drawn only with it */
  onAddress?: () => void
}) {
  const view = state.data
  if (state.status === 'refused') {
    return (
      <div className="w-full pb-16">
        <EmptyState title={state.reason === 'visit' ? 'My Profile' : 'My Profile is not open here'} body={state.error} />
      </div>
    )
  }
  const docs = docsFor(view, uploads)
  // an answer decides whether the chooser is drawn; with none yet, the session's last mass answer does
  const bar: Chooser | null = view ? chooserOf(view) : chooser
  return (
    <div className="w-full pb-16">
      {bar && <PersonBar chooser={bar} person={person} onPerson={onPerson} onRetry={onRetry} busy={state.refreshing} />}
      {view?.scope.why && <p className="mb-3 text-[12px] text-text-3">{view.scope.why}</p>}
      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <ProfileNav page={page} person={person} />
        <div className="min-w-0">
          {!view && <ReadLine state={state} person={person} onRetry={onRetry} />}
          {view && state.status === 'failed' && (
            <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--warning)]">
              The last refresh failed: {state.error || 'no answer'}. What is shown is from the read before.
              <RetryButton onRetry={onRetry} busy={state.refreshing} />
            </p>
          )}
          {view && onTraining && (
            <div className="mb-3 flex justify-end">
              <button type="button" onClick={onTraining} data-request-training=""
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                <GraduationCap size={14} /> Request training
              </button>
            </div>
          )}
          {view && page === 'details' && <DetailsCard view={view} address={address} onAddress={onAddress} contacts={contacts}
            onContact={onContact} />}
          {view && page === 'details' && view.person.own && !isClientView(view) && !isGuardianView(view) && <MyLoans />}
          {view && page === 'requirements' && <RequirementsCard view={view} docs={docs} onUpload={onUpload} onView={onView} />}
          {view && page === 'docs' && <DocsCard view={view} docs={docs} onView={onView} />}
          {view && (state.readAt > 0 || state.kept) && (
            <ReadStamp at={state.readAt} kept={state.kept} />
          )}
        </div>
      </div>
    </div>
  )
}

export function ReadLine({ state, person, onRetry }: { state: MyProfileState; person: string; onRetry: () => void }) {
  if (state.status === 'failed') {
    return (
      <section className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger)]">
          My Profile could not be read: {state.error || 'no answer'}. Nothing is shown rather than a blank profile.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <p className="text-[12.5px] text-text-3">
        {!person ? 'Reading your profile…' : person.startsWith(CLIENT_CHOICE) ? 'Reading this client’s profile…' : 'Reading this person’s profile…'}
      </p>
    </section>
  )
}

/** The pages the rail offers: a page gated from this person (Requirements and Docs from a client or a guardian,
 *  Requirements from a badge App Control's row does not name) is not offered, nor My Docs while Settings hides it. */
export function useRailPages(): (typeof MY_PROFILE_PAGES)[number][] {
  const eff = useEffectiveUser()
  const hides = useShellHides()
  const requirements = useFeatureAllowed(MY_REQUIREMENTS_FEATURE)
  return MY_PROFILE_PAGES.filter((p) => (!eff || (pageGateAllows(p.gate, eff) && (p.feature !== MY_REQUIREMENTS_FEATURE ||
    requirements))) && !(p.id === 'docs' && hides.profile_docs))
}

export function ProfileNav({ page, person }: { page: MyProfilePageId; person: string }) {
  const pages = useRailPages()
  return (
    <nav aria-label="My Profile" className="rounded-[20px] border border-border bg-surface p-2 shadow-1">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {pages.map((p) => {
          const Icon = PAGE_ICON[p.id]
          const on = p.id === page
          return (
            <li key={p.id} className="shrink-0">
              <Link to={`/app/${MY_PROFILE_APP_ID}/${p.id}${personQuery(person)}`} aria-current={on ? 'page' : undefined}
                className={cn('flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-[13px] transition-colors',
                  on ? 'bg-primary/10 font-medium text-primary' : 'text-text-2 hover:bg-surface-2 hover:text-text-1')}>
                <Icon size={16} strokeWidth={1.8} /> {p.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The master's chooser: their own profile, any roster row's, or any client's. Drawn only from a mass answer. */
export function PersonBar({ chooser, person, onPerson, onRetry, busy }: {
  chooser: Chooser
  person: string
  onPerson: (key: string) => void
  onRetry: () => void
  busy: boolean
}) {
  const staff = chooser.people.filter((p) => p.kind !== 'client')
  const clients = chooser.people.filter((p) => p.kind === 'client')
  const option = (p: PersonEntry) => <option key={choiceOf(p)} value={choiceOf(p)}>{choiceLabel(p)}</option>
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="text-[12.5px] font-semibold text-text-2" htmlFor="my-profile-person">Person</label>
      <select id="my-profile-person" value={person} onChange={(e) => onPerson(e.target.value)}
        className="h-9 max-w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary">
        <option value="">Your own profile</option>
        {clients.length === 0 && staff.map(option)}
        {clients.length > 0 && staff.length > 0 && <optgroup label="Staff">{staff.map(option)}</optgroup>}
        {clients.length > 0 && <optgroup label="Clients">{clients.map(option)}</optgroup>}
      </select>
      <RetryButton onRetry={onRetry} busy={busy} label="Refresh" />
      {chooser.people_why && (
        <span className="w-full text-[12px] text-[var(--warning)]">
          No staff member can be chosen: {chooser.people_why}.
        </span>
      )}
      {chooser.clients_why && (
        <span className="w-full text-[12px] text-[var(--warning)]">
          No client can be chosen: {chooser.clients_why}.
        </span>
      )}
      {!chooser.clients_why && chooser.clients_note && (
        <span className="w-full text-[12px] text-text-3">{sentence(chooser.clients_note)}</span>
      )}
    </div>
  )
}

function RetryButton({ onRetry, busy, label = 'Try again' }: { onRetry: () => void; busy: boolean; label?: string }) {
  return (
    <button type="button" onClick={onRetry} disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
      <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {label}
    </button>
  )
}

function Card({ title, lines, empty, children }: { title: string; lines: SourceLine[]; empty?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <h2 className="mb-3 font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
      {lines.length > 0 && (
        <ul className="mb-3 space-y-1">
          {lines.map((l) => <li key={l.key} className={cn('text-[12px] leading-[1.5]', LINE_TONE[l.tone])}>{l.text}</li>)}
        </ul>
      )}
      <div className="overflow-x-auto">{children}</div>
      {empty && <p className="py-6 text-center text-[13px] text-text-3">{empty}</p>}
    </section>
  )
}

const titleFor = (view: MyProfileView, own: string, part: string) =>
  view.person.own ? own : `${part} · ${view.person.name || (isClientView(view) ? 'this client' : 'this person')}`

/** The em-dash law: a blank value is the dash and its sentence. */
function Dash({ why }: { why: string }) {
  return (
    <span className="text-[12.5px] text-text-2" title={why}>
      —<span className="block text-[11px] leading-[1.4] text-text-3">{why}</span>
    </span>
  )
}

export function DetailsCard({ view, address, onAddress, contacts, onContact }: {
  view: MyProfileView
  /** the Address as the Employee Database keeps it: drawn over the roster's city and state once it holds a part */
  address?: AddressState
  /** opens the address panel; with none, no pencil is drawn */
  onAddress?: () => void
  /** the signed-in account's e-mails and phones: each one the field does not already show is listed under it */
  contacts?: AccountContacts | null
  /** opens the panel that adds an e-mail or a phone; with none, no "+" is drawn */
  onContact?: (kind: ContactKind) => void
}) {
  const d = view.details
  const client = isClientView(view)
  const guardian = isGuardianView(view)
  const whose = guardian ? guardianTitle(view).replace(/ info$/, '')
    : view.person.own ? 'Your' : client ? 'This client’s' : 'This person’s'
  const lines: SourceLine[] = [
    ...(d.state === 'unreadable'
      ? [{ key: 'unread', tone: 'danger' as const, text: `${whose} details could not be read: ${d.why}.` }]
      : []),
    ...d.notes.map((n, i) => ({ key: `n${i}`, tone: 'muted' as const, text: sentence(n) })),
    ...(view.person.notes ?? []).map((n, i) => ({ key: `p${i}`, tone: 'muted' as const, text: sentence(n) })),
  ]
  const pencil = onAddress ? addressPencil(view, address) : null
  const edit = pencil?.show && onAddress ? <AddressPencil pencil={pencil} onAddress={onAddress} /> : null
  const card = (
    <Card title={guardian ? guardianTitle(view) : titleFor(view, 'My Info', client ? 'Client info' : 'Info')} lines={lines}>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        {d.fields.map((f) => {
          if (f.key === 'address' && !client && !guardian) {
            return <FieldCell key={f.key} field={addressField(f, address)} edit={edit}
              why={pencil && !pencil.allowed && pencil.why !== ADDRESS_READING ? pencil.why : ''} />
          }
          const kind: ContactKind | null = f.key === 'email' ? 'email' : f.key === 'phone' ? 'phone' : null
          if (kind && !client && !guardian && (contacts || onContact)) {
            const more = !contacts ? [] : kind === 'email' ? emailsBeside(contacts, f.value) : phonesBeside(contacts, f.value)
            return <FieldCell key={f.key} field={f} more={more} moreKind={kind}
              edit={onContact ? <ContactPlus kind={kind} onContact={onContact} /> : undefined} />
          }
          return <FieldCell key={f.key} field={f} />
        })}
      </dl>
    </Card>
  )
  if (!guardian) return card
  return (
    <div className="grid gap-5">
      <AccountCard view={view} />
      {card}
    </div>
  )
}

const ACCOUNT_BLANK = 'Not on your account.'

/** A guardian's own account, first: whose sign-in this is, and whom it is guardian of. */
export function AccountCard({ view }: { view: MyProfileView }) {
  const a = view.person.account
  const field = (key: string, label: string, value: string, why = ACCOUNT_BLANK): Field =>
    ({ key, label, value: String(value ?? ''), why, note: '' })
  return (
    <Card title="Your account" lines={[]}>
      <dl className="grid gap-x-6 sm:grid-cols-2" data-account="">
        <FieldCell field={field('account_name', 'Name', a?.name ?? '')} />
        <FieldCell field={field('account_email', 'Sign-in', a?.email ?? '')} />
        <FieldCell field={field('account_phone', 'Phone', a?.phone ?? '')} />
        <FieldCell field={field('guardian_of', 'Guardian of', a?.guardian_of ?? '',
          'No client record tied to this account could be read.')} />
      </dl>
    </Card>
  )
}

function FieldCell({ field, edit, why, more = [], moreKind }: {
  field: Field
  /** the field's pencil, beside its label */
  edit?: ReactNode
  /** why the pencil is shut, under the value */
  why?: string
  /** the account's other e-mails or phones, one line each under the value */
  more?: string[]
  moreKind?: ContactKind
}) {
  const text = fieldText(field)
  const tel = isPhoneField(field.key) ? phoneHref(field.value) : ''
  return (
    <div className="min-w-0 border-b border-border py-3" data-field={field.key}>
      <dt className={cn(HEAD, edit && 'flex min-h-7 items-center justify-between gap-2')}>{field.label}{edit}</dt>
      <dd className="mt-1 break-words text-[13.5px] leading-[1.5] text-text-1">
        {!text && !more.length && <Dash why={field.why} />}
        {text && tel && <a href={tel} className="text-primary hover:underline">{text}</a>}
        {text && !tel && text}
        {text && field.note && <span className="block text-[11px] leading-[1.4] text-text-3">{field.note}</span>}
        {more.map((m) => (moreKind === 'phone'
          ? <a key={m} href={phoneHref(m)} className="block text-primary hover:underline" data-more-phone="">{formatPhoneDisplay(m)}</a>
          : <span key={m} className="block" data-more-email="">{m}</span>))}
        {moreKind === 'email' && more.length > 0 && (
          <span className="block text-[11px] leading-[1.4] text-text-3">Each of these signs you in.</span>
        )}
        {why && <span className="block text-[11px] leading-[1.4] text-text-3" data-address-why="">{why}</span>}
      </dd>
    </div>
  )
}

/** The "+" on My Info's Email or Phone: one more on one's own account. */
function ContactPlus({ kind, onContact }: { kind: ContactKind; onContact: (kind: ContactKind) => void }) {
  const label = kind === 'email' ? 'Add an e-mail' : 'Add a phone'
  return (
    <button type="button" onClick={() => onContact(kind)} data-add-contact={kind} aria-label={label} title={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md normal-case tracking-normal text-text-3 transition-colors hover:bg-primary-soft hover:text-primary">
      <Plus size={14} />
    </button>
  )
}

/** The pencil on My Info's Address: shut, with the door's reason, where no part may be changed. */
function AddressPencil({ pencil, onAddress }: { pencil: { allowed: boolean; why: string }; onAddress: () => void }) {
  return (
    <button type="button" disabled={!pencil.allowed} onClick={() => { if (pencil.allowed) onAddress() }} data-edit-address=""
      aria-label={pencil.allowed ? 'Edit the address' : `Edit the address — ${pencil.why}`}
      title={pencil.allowed ? 'Edit the address' : pencil.why}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md normal-case tracking-normal text-text-3 transition-colors hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-3">
      <Pencil size={13} />
    </button>
  )
}

export function RequirementsCard({ view, docs, onUpload, onView }: {
  view: MyProfileView
  docs: Docs
  onUpload: (ask: ProfileUploadAsk) => void
  onView: (ask: VersionAsk) => void
}) {
  const r = view.requirements
  const lines = partLines('Requirements', r)
  if (docs.note && docs.tone) lines.push({ key: 'docs', tone: docs.tone, text: docs.note })
  const filedAs = r.rows.find((row) => row.file_as)?.file_as
  if (!view.person.own && filedAs) {
    lines.push({ key: 'upload', tone: 'muted', text: `A version uploaded here is filed under ${filedAs}’s record.` })
  }
  return (
    <Card title={titleFor(view, 'My Requirements', 'Requirements')} lines={lines} empty={requirementsEmpty(view)}>
      {r.rows.length > 0 && (
        <div className="min-w-0">
          <div className={cn('hidden gap-4 border-b border-border pb-2 sm:grid', REQ_COLS, HEAD)}>
            <span>Status</span><span>Requirement</span><span>Category</span><span>Due date</span><span>Version</span>
          </div>
          {r.rows.map((row) => (
            <RequirementLine key={row.id} row={row} view={view} docs={docs} onUpload={onUpload} onView={onView} />
          ))}
        </div>
      )}
    </Card>
  )
}

function RequirementLine({ row, view, docs, onUpload, onView }: {
  row: RequirementRow
  view: MyProfileView
  docs: Docs
  onUpload: (ask: ProfileUploadAsk) => void
  onView: (ask: VersionAsk) => void
}) {
  const { on, window: win } = view.requirements
  const own = view.person.own
  const version = docs.landed ? versionFor(row, docs.rows) : null
  // D1: a read paper's date stands in for the record's until the master confirms it; the totals stay the engine's
  const shown = filedStatus(row, version, on, win, own)
  const upload = uploadFor(row, docs)
  return (
    <div className={cn('grid grid-cols-1 gap-2 border-b border-border py-3 sm:items-center sm:gap-4', REQ_COLS)} data-row={row.id}>
      <div>
        <span className={MOBILE_LABEL}>Status</span>
        <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_PILL[shown.status.class])}
          data-status={shown.status.class}>
          {shown.status.word}
        </span>
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Requirement</span>
        <span className="text-[13px] font-medium text-text-1">{row.requirement}</span>
        {shown.sub && <span className="block text-[11px] leading-[1.4] text-text-3" data-filed={row.id}>{shown.sub}</span>}
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Category</span>
        {row.category ? <span className="text-[12.5px] text-text-2">{row.category}</span> : <Dash why={row.category_why} />}
      </div>
      <div>
        <span className={MOBILE_LABEL}>Due date</span>
        {shown.due ? (
          <span data-due={row.id}
            className={cn('text-[12.5px] font-medium', shown.due_tone ? DUE_TONE_CLASS[shown.due_tone] : 'text-text-2')}>
            {dayWords(shown.due)}
          </span>
        ) : <Dash why={row.due_why} />}
      </div>
      <div>
        <span className={MOBILE_LABEL}>Version</span>
        <div className="flex items-center gap-2">
          <button type="button" className={ICON_BUTTON} data-view={row.id}
            aria-label={`View the current version of ${row.requirement}`} title="Current version"
            onClick={() => onView({ kind: 'requirement', id: row.id })}>
            <Eye size={15} strokeWidth={1.8} />
          </button>
          <button type="button" className={ICON_BUTTON} disabled={!upload.allowed} data-upload={row.id}
            aria-label={upload.allowed ? `${UPLOAD_AND_READ}: ${row.requirement}` : `${UPLOAD_AND_READ} — ${upload.why}`}
            title={upload.allowed ? UPLOAD_AND_READ : upload.why}
            onClick={() => upload.allowed && onUpload({ row, own, on, window: win })}>
            <ScanText size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function DocsCard({ view, docs, onView }: {
  view: MyProfileView
  docs: Docs
  onView: (ask: VersionAsk) => void
}) {
  const lines: SourceLine[] = docs.note && docs.tone ? [{ key: 'docs', tone: docs.tone, text: docs.note }] : []
  const reading = !docs.landed && !docs.note
  return (
    <Card title={titleFor(view, 'My Docs', 'Docs')} lines={lines} empty={docsEmpty(view, docs)}>
      {reading && <p className="py-2 text-[12.5px] text-text-3">Reading the submitted documents…</p>}
      {docs.rows.length > 0 && (
        <div className="min-w-0">
          <div className={cn('hidden gap-4 border-b border-border pb-2 sm:grid', DOC_COLS, HEAD)}>
            <span /><span>Document</span><span>Doc type</span><span>Upload date</span>
          </div>
          {docs.rows.map((doc) => {
            const title = doc.cert || doc.name || 'A document'
            const day = dayWords(doc.at)
            return (
              <div key={doc.id || `${doc.cert}-${doc.at}`} data-doc={doc.id}
                className={cn('grid grid-cols-1 gap-2 border-b border-border py-3 sm:items-center sm:gap-4', DOC_COLS)}>
                <div>
                  <button type="button" className={ICON_BUTTON} data-view-doc={doc.id} aria-label={`View ${title}`} title={`View ${title}`}
                    onClick={() => onView({ kind: 'doc', id: doc.id })}>
                    <Eye size={15} strokeWidth={1.8} />
                  </button>
                </div>
                <div className="min-w-0">
                  <span className={MOBILE_LABEL}>Document</span>
                  <span className="text-[13px] font-medium text-text-1">{title}</span>
                  {doc.name && doc.name !== title && <span className="block break-all text-[11.5px] text-text-3">{doc.name}</span>}
                </div>
                <div className="min-w-0">
                  <span className={MOBILE_LABEL}>Doc type</span>
                  <span className="text-[12.5px] text-text-2">{docType(doc, view.requirements.rows)}</span>
                </div>
                <div>
                  <span className={MOBILE_LABEL}>Upload date</span>
                  {day ? <span className="text-[12.5px] text-text-2">{day}</span> : <Dash why="The ledger keeps no readable date for it." />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
