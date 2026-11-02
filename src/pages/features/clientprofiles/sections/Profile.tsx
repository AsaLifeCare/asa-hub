// Client Profile: the "Client details" card in six groups — identity, home, guardian and SSA, services and…
// An SSN or a card is drawn from the last four the answer sent; a security code, a PIN and an expiry only as "on…
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { FileText, Loader2, Phone } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { ActivePill } from '@/pages/features/locations/HouseSwitcher'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { AddressMapFrame } from '@/components/shared/AddressMap'
import { ohioToday } from '@/lib/ohio'
import { useClientGroupTitlesHidden } from '@/lib/stamps'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { staffHref } from '@/pages/features/staffprofiles/staffModel'
import { ssaHref } from '@/pages/features/ssaprofiles/ssaModel'
import {
  NEW_MEMBER, NOT_ON_FILE, PROFILE_GROUPS, addressOf, ageOf, cardMask, clientHref, dayLabel, houseHref, isNotApplicable, isSelfGuardian,
  mailHref, onFileMask, personHref, profileOf, readRefusal, shownValue, ssnMask, telHref, type AddressGroup, type ClientAsk, type Profile,
  type ProfileGroup, type RosterRow,
} from '../clientModel'
import { readDetails, readKey, useClientDocs, useClientRead, type ReadState } from '../useClientRead'
import { PencilButton, ReadLine, Row, linkCls } from '../ClientParts'
import { clientCan, useClientReader } from '../clientViewer'

export default function ProfileSection({ client, today, onAsk }: { client: RosterRow; today: string; onAsk: (ask: ClientAsk) => void }) {
  const profile = useClientRead(readKey('clientProfileDetails', client.client_key), () => readDetails(client.client_key), profileOf)
  const docs = useClientDocs()
  return (
    <ProfileView client={client} profile={profile} today={today} onAsk={onAsk} onRetry={profile.reload}
      opening={docs.opening} onDoc={(fileId, title) => docs.open(client.client_key, fileId, title)} />
  )
}

/** The plan opens in the platform's centred viewer. */
export type DocOpen = (fileId: string, title: string) => void

const none = <span className="text-text-3">{NOT_ON_FILE}</span>

// a cell that says n/a is drawn as Not Applicable, and never as a link
const text = (v: string): ReactNode => (v ? shownValue(v) : none)
const day = (v: string): ReactNode => (v ? dayLabel(v) || v : none)
const phone = (v: string): ReactNode =>
  (!v ? none : isNotApplicable(v) ? text(v) : <a href={telHref(v)} className={linkCls}>{formatPhoneDisplay(v)}</a>)
const email = (v: string): ReactNode => (!v ? none : isNotApplicable(v) ? text(v) : <a href={mailHref(v)} className={linkCls}>{v}</a>)
// in the card an address opens the one right panel on its group; in that panel it is the text over its map
const address = (v: string, open?: () => void): ReactNode =>
  (!v || isNotApplicable(v) ? text(v) : open
    ? <button type="button" onClick={open} data-address-link="" className={`${linkCls} text-left`}>{v}</button> : v)
const masked = (v: string | null): ReactNode => (v ? <span className="font-mono tracking-wide" data-masked="">{v}</span> : none)
/** `href`: the person's own profile (Staff, SSA) when the app holds one; else the people directory by id. */
const person = (name: string, id: string, subtitle: string, href = ''): ReactNode => {
  if (!name) return none
  if (isNotApplicable(name)) return text(name)
  const to = href || (id ? personHref(id) : '')
  return (
    <DragPerson name={name} id={id || undefined} type="staff" subtitle={subtitle}>
      {to ? <Link to={to} className={linkCls}>{name}</Link> : <span className="text-text-1">{name}</span>}
    </DragPerson>
  )
}
const hasEmail = (v: string): boolean => /\S+@\S+\.\S+/.test(v)

type Item = { label: string; value: ReactNode }

function profileItems(p: Profile, client: RosterRow, today: string, onDoc: DocOpen, opening: string,
  onAddress?: (group: AddressGroup) => void): Record<ProfileGroup, Item[]> {
  const age = ageOf(p.client.dob, p.client.age, today)
  const houseCode = p.home.house_code
  const houseName = p.home.house_label || client.house
  const at = (group: AddressGroup) => (onAddress ? () => onAddress(group) : undefined)
  // a client who is their own guardian: the guardian's e-mail is the client's own, and the guardian's number is 0
  const self = isSelfGuardian(p.guardian.name)
  const selfEmail = p.client.email || client.self_email || (hasEmail(p.guardian.email) ? p.guardian.email : '')
  return {
    identity: [
      { label: 'Client', value: <Link to={clientHref(client.client_key)} className={linkCls}>{p.client.name || client.name}</Link> },
      { label: 'Status', value: <ActivePill active={(p.client.status || client.status) === 'active'} /> },
      { label: 'Client #', value: text(p.client.client_number) },
      { label: 'Initials', value: text(p.client.initials) },
      { label: 'Birthdate', value: day(p.client.dob) },
      { label: 'Age', value: age === null ? none : String(age) },
      { label: 'SSN', value: masked(ssnMask(p.identity)) },
      { label: 'Medicaid #', value: text(p.identity.medicaid_id) },
    ],
    home: [
      { label: 'House', value: houseCode ? <Link to={houseHref(houseCode)} className={linkCls}>{houseName || houseCode}</Link> : text(houseName) },
      { label: 'Address', value: address(p.home.home_address, at('home')) },
      { label: 'House Manager', value: person(p.home.house_manager, '', 'House manager', staffHref(p.home.house_manager)) },
      { label: 'House Manager #', value: phone(p.home.house_manager_phone) },
      { label: 'House Manager Email', value: email(p.home.house_manager_email) },
    ],
    guardian: [
      { label: 'Guardian', value: person(p.guardian.name, p.guardian.person_id, 'Guardian') },
      { label: 'Guardian Relationship', value: text(p.guardian.relationship) },
      { label: 'Guardian Email', value: email(self ? selfEmail : p.guardian.email) },
      { label: 'Guardian Address', value: address(p.guardian.address, at('guardian')) },
      { label: 'Guardian #', value: self ? <span data-self-phone="">0</span> : phone(p.guardian.phone) },
      { label: 'SSA', value: person(p.guardian.ssa_name, p.guardian.ssa_person_id, 'SSA', ssaHref(p.guardian.ssa_name)) },
      { label: 'SSA Email', value: email(p.guardian.ssa_email) },
      { label: 'SSA #', value: phone(p.guardian.ssa_phone) },
    ],
    services: [
      { label: 'Outcome', value: text(p.services.outcome) },
      { label: 'AMA', value: day(p.services.ama_date) },
      {
        label: 'ISP',
        value: p.services.isp_file_id ? (
          <button type="button" data-isp="" onClick={() => onDoc(p.services.isp_file_id, `ISP ${p.services.isp_year}`.trim())}
            disabled={opening.endsWith(`|${p.services.isp_file_id}`)} aria-busy={opening.endsWith(`|${p.services.isp_file_id}`) || undefined}
            className={`${linkCls} inline-flex items-center gap-1 disabled:opacity-60`}>
            {opening.endsWith(`|${p.services.isp_file_id}`) ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            {' '}{p.services.isp_year || 'Open the plan'}
          </button>
        ) : text(p.services.isp_year),
      },
      { label: 'Start Date', value: day(p.services.start_date) },
      { label: 'Self-Admin Assessment', value: text(p.services.self_admin_assessment) },
      { label: 'Self-Admin Expiration Date', value: day(p.services.self_admin_expires) },
      { label: 'Media Release', value: text(p.services.media_release) },
      { label: 'Medical Supply', value: text(p.services.medical_supply) },
      { label: 'True Link Consent Form', value: text(p.services.truelink_consent) },
      { label: 'Guardianship Papers?', value: text(p.services.guardianship_papers) },
    ],
    day: [
      { label: 'Workshop', value: text(p.day.workshop) },
      { label: 'Workshop Phone', value: phone(p.day.workshop_phone) },
      { label: 'Workshop Address', value: address(p.day.workshop_address, at('day')) },
      { label: 'Transportation', value: text(p.day.transportation) },
      { label: 'Transportation - Phone', value: phone(p.day.transportation_phone) },
    ],
    financial: [
      { label: 'Payee Rep', value: text(p.financial.payee_rep) },
      { label: 'Payee Rep #', value: phone(p.financial.payee_rep_phone) },
      { label: 'Payee Rep Email', value: email(p.financial.payee_rep_email) },
      { label: 'TL Debit Card Number', value: masked(cardMask(p.financial.tl_card_last4)) },
      { label: 'DC Exp Date', value: masked(onFileMask(p.financial.dc_exp_on_file, '••/••')) },
      { label: 'DC Security Code', value: masked(onFileMask(p.financial.dc_security_code_on_file, '•••')) },
      { label: 'DC PIN #', value: masked(onFileMask(p.financial.dc_pin_on_file, '••••')) },
      { label: 'Food Stamp', value: text(p.financial.food_stamp) },
      { label: 'Spending Limit', value: text(p.financial.spending_limit) },
    ],
  }
}

/** The address panel (ClientPanel): whose it is, the group's details as the card draws them, then the map. */
export function ProfileAddressBody({ client, group }: { client: RosterRow; group: AddressGroup }) {
  const profile = useClientRead(readKey('clientProfileDetails', client.client_key), () => readDetails(client.client_key), profileOf)
  if (!profile.data) {
    return <div className="grid gap-3 pt-1"><ReadLine state={profile} what="the client details" onRetry={profile.reload} /></div>
  }
  return <ProfileAddressView client={client} profile={profile.data} group={group} today={ohioToday()} />
}

export function ProfileAddressView({ client, profile: p, group, today }: { client: RosterRow; profile: Profile; group: AddressGroup; today: string }) {
  const { address: on, whose } = addressOf(p, client, group)
  const items = profileItems(p, client, today, () => {}, '')[group]
  return (
    <div className="grid gap-4 pt-1" data-address-panel={group}>
      <span className="text-[14px] font-semibold text-text-1">{shownValue(whose)}</span>
      <dl className="grid gap-3">
        {items.map((it) => <Row key={it.label} label={it.label}>{it.value}</Row>)}
      </dl>
      {on && !isNotApplicable(on) && <span data-record-map=""><AddressMapFrame address={on} height={240} /></span>}
    </div>
  )
}

export function ProfileView({ client, profile, today, onAsk, onRetry, onDoc = () => {}, opening = '' }: {
  client: RosterRow
  profile: ReadState<Profile>
  today: string
  onAsk: (ask: ClientAsk) => void
  onRetry: () => void
  onDoc?: DocOpen
  opening?: string
}) {
  const p = profile.data
  const items = p ? profileItems(p, client, today, onDoc, opening, (group) => onAsk({ kind: 'address', group })) : null
  const reader = useClientReader()
  const edits = clientCan(reader, 'clients.profile')
  // the master's, or a holder's of the family members edition (Settings › Editions)
  const family = clientCan(reader, 'clients.family')
  // Settings › My Work: the titles over the groups, the master's alone unless released
  const bare = useClientGroupTitlesHidden()
  return (
    <div className="grid gap-5">
      <SectionCard title="Client details"
        extra={p && edits ? <PencilButton label="Edit client details" onClick={() => onAsk({ kind: 'edit-profile' })} /> : null}>
        <ReadLine state={profile} what="the client details" onRetry={onRetry} />
        {p?.degraded && (
          <p className="mb-3 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber" data-degraded="">
            Part of this record could not be read{p.why ? `: ${readRefusal(p.why)}` : '.'}
          </p>
        )}
        {items && (
          <div className="grid gap-6" data-client-details="">
            {PROFILE_GROUPS.map((g) => (
              <div key={g.id} data-group={g.id}>
                {!bare && (
                  <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-2">{g.label}</h3>
                )}
                <dl className="grid sm:grid-cols-2 sm:gap-x-8">
                  {items[g.id].map((it) => (
                    <div key={it.label} className="border-b border-border py-3" data-field={it.label}>
                      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{it.label}</dt>
                      <dd className="mt-1 break-words text-[13.5px] leading-5 text-text-1">{it.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Family members"
        extra={p && family ? <PencilButton label="Add a family member" onClick={() => onAsk({ kind: 'family-edit', id: NEW_MEMBER })} /> : null}>
        {p && p.family.length === 0 && <p className="text-[13px] text-text-3">The plan names no family member.</p>}
        {!p && <ReadLine state={profile} what="the family members" onRetry={onRetry} />}
        {p && p.family.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-family="">
            {p.family.map((f) => (
              <li key={`${f.name}|${f.relationship}`} className="flex items-center gap-3 rounded-[14px] border border-border p-3" data-member={f.name}>
                <Avatar src={f.avatar} name={f.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <DragPerson name={f.name} id={f.person_id || undefined} type="staff" subtitle={f.relationship}>
                    {f.person_id ? <Link to={personHref(f.person_id)} className={`${linkCls} text-[13.5px] font-semibold`}>{f.name}</Link>
                      : <span className="text-[13.5px] font-semibold text-text-1">{f.name}</span>}
                  </DragPerson>
                  {f.relationship && <p className="text-[12px] text-text-3">{shownValue(f.relationship)}</p>}
                  {f.phone && !isNotApplicable(f.phone) && (
                    <a href={telHref(f.phone)} className={`${linkCls} mt-0.5 inline-flex items-center gap-1 text-[12.5px]`}>
                      <Phone size={12} /> {formatPhoneDisplay(f.phone)}
                    </a>
                  )}
                </div>
                {family && f.key && (
                  <PencilButton label={`Edit ${f.name}`} onClick={() => onAsk({ kind: 'family-edit', id: f.key ?? '' })} />
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
