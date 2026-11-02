/** Settings › My Work: the switches, their config keys (AlertsConfig.gs MYWORK_HIDE_KEYS) and how a cell reads. */
import type { HideParts } from '@/pages/features/mywork/myWorkModel'

/** SSA's parts, as the backend names them; each answer carries them (SsaProfiles.gs ssaDisplay_). */
export type SsaSwitchPart = 'ssa_updated' | 'ssa_county' | 'ssa_count' | 'ssa_role'

/** My Work's parts, My Inbox's Sources card, SSA's parts, Scheduling's hours column and Staff's source notes. */
export type SwitchPart = keyof HideParts | 'inbox_sources' | SsaSwitchPart | 'sched_hours' | 'record_notes' | 'client_activity'
  | 'client_group_titles' | 'staff_doc_counts' | 'family_details'
export type SwitchValues = Record<SwitchPart, boolean>

export const SWITCHES_OFF: SwitchValues = {
  header: false, source_notes: false, missing_row: false, completed: false, inbox_sources: false,
  ssa_updated: false, ssa_county: false, ssa_count: false, ssa_role: false, sched_hours: false, record_notes: false,
  client_activity: false, client_group_titles: false, staff_doc_counts: false, family_details: false,
}

export type SwitchPage = 'My Work' | 'My Inbox' | 'Every app' | 'SSA' | 'Scheduling' | 'Staff' | 'Clients'
  | 'Families & Guardians'

export const MY_WORK_SWITCHES: { part: SwitchPart; key: string; label: string; desc: string; page: SwitchPage }[] = [
  {
    part: 'header', key: 'mywork_hide_header', label: 'The black header', page: 'My Work',
    desc: 'The four figures at the top — Open actions, Overdue, Open requests, Sources unread — and the line under them.',
  },
  {
    part: 'source_notes', key: 'mywork_hide_source_notes', label: 'Source notes under the card titles', page: 'My Work',
    desc: 'The grey and amber lines, such as the background checks HR runs or when a copy was mirrored. A source that could not be read is still said.',
  },
  {
    part: 'missing_row', key: 'mywork_hide_missing_row', label: 'The “Nothing on file” row', page: 'My Work',
    desc: 'The folded “Nothing on file for N requirements” row in My Actions.',
  },
  {
    part: 'completed', key: 'mywork_hide_completed', label: 'Concluded requests', page: 'My Work',
    desc: 'Anything already concluded never reaches anyone else’s screen: resolved, closed, approved and past requests, and late calls, call-offs and incident reports about a day before today. Show resolved disappears.',
  },
  {
    part: 'inbox_sources', key: 'mywork_hide_inbox_sources', label: 'The Sources card in My Inbox', page: 'My Inbox',
    desc: 'The card under the alerts that says where they come from, what each source could tell and what is not on the platform yet. It never reaches anyone else’s screen; the alerts and their unread counts stay.',
  },
  {
    part: 'ssa_updated', key: 'mywork_hide_ssa_updated', label: 'Updated stamps — every app', page: 'Every app',
    desc: 'Every “Updated … ago” and “Read …” line in Locations, Clients, Staff, SSA, Families, Staff Candidates, Client Candidates, My Work, My Profile, My Calendar and My Inbox.',
  },
  {
    part: 'ssa_county', key: 'mywork_hide_ssa_county', label: 'SSA · County before the agency', page: 'SSA',
    desc: 'COUNTY / AGENCY shows the agency alone: “Stark County Board of DD”, not “FRAN County · Stark County Board of DD”.',
  },
  {
    part: 'ssa_count', key: 'mywork_hide_ssa_count', label: 'SSA · Associated clients count', page: 'SSA',
    desc: 'The line under Associated clients, such as “1 client whose record names this SSA.” The clients stay listed.',
  },
  {
    part: 'ssa_role', key: 'mywork_hide_ssa_role', label: 'SSA · Role on each client', page: 'SSA',
    desc: 'Each associated client shows its house alone: “47TH - ABD4708”, not “Service and Support Administrator · 47TH - ABD4708”.',
  },
  {
    part: 'sched_hours', key: 'mywork_hide_sched_hours', label: 'Scheduling · Hours column', page: 'Scheduling',
    desc: 'The Hrs (week) / Hrs (tab) column, the On shift hour totals and every hours figure in the shift panel. Everyone else sees the badges in its place: house manager, Medication Administration 1/2/3, team leader.',
  },
  {
    part: 'record_notes', key: 'mywork_hide_record_notes', label: 'Source notes — Staff', page: 'Staff',
    desc: 'The grey lines under a Staff section that name a missing source column or a source that could not answer, such as “the Employee Database Master has no column for sam, oig”. The “Part of this could not be read” warning stays.',
  },
  {
    part: 'staff_doc_counts', key: 'mywork_hide_staff_doc_counts', label: 'Staff · Documents count', page: 'Staff',
    desc: 'On a person’s Documents: the line under the title that counts them, such as “40 documents · 35 with a file · 2 missing”. Everyone else sees the table alone.',
  },
  {
    part: 'client_activity', key: 'mywork_hide_client_activity', label: 'Clients · Activity details', page: 'Clients',
    desc: 'On a client’s Activity: the three figures at the top — Records, Kinds of record, Last activity — and the Action column with its pencil. Everyone else sees the records alone, in Date, Type, Record, Details order.',
  },
  {
    part: 'client_group_titles', key: 'mywork_hide_client_group_titles', label: 'Clients · Client details titles',
    page: 'Clients',
    desc: 'On a client’s Client details: the titles over each group — Identity & eligibility, Home & house contacts, Guardian & SSA, Services, plans & consents, Day services & transportation, Financial & benefits. Everyone else sees the fields without them.',
  },
  {
    part: 'family_details', key: 'mywork_hide_family_details', label: 'Families & Guardians · details',
    page: 'Families & Guardians',
    desc: 'On a family member: the “Named in” line under Family Details, the count lines under Associated clients and Documents, the pencils beside them, and in Edit details its title, the sign-in notice, the line naming where the fields land, the name’s lock note and the guardianship papers. Everyone else sees the details and the clients without them.',
  },
]

/** The switches as the section draws them: My Work's and My Inbox's, then SSA's, Scheduling's and Staff's under their headings. */
export const SWITCH_GROUPS: { heading: string; switches: typeof MY_WORK_SWITCHES }[] = [
  { heading: '', switches: MY_WORK_SWITCHES.filter((s) => !['SSA', 'Scheduling', 'Staff', 'Clients', 'Families & Guardians'].includes(s.page)) },
  { heading: 'SSA', switches: MY_WORK_SWITCHES.filter((s) => s.page === 'SSA') },
  { heading: 'Scheduling', switches: MY_WORK_SWITCHES.filter((s) => s.page === 'Scheduling') },
  { heading: 'Staff', switches: MY_WORK_SWITCHES.filter((s) => s.page === 'Staff') },
  { heading: 'Clients', switches: MY_WORK_SWITCHES.filter((s) => s.page === 'Clients') },
  { heading: 'Families & Guardians', switches: MY_WORK_SWITCHES.filter((s) => s.page === 'Families & Guardians') },
]

/** SSA's answers carry the switches; the relay's held copy of an SSA follows when it is filled again. */
export const SSA_LANDS = 'Everyone else sees it in SSA as each SSA is read again, within about an hour.'

/** The stamps and Staff source-notes switches ride the session: they land as each account's Hub next opens or reloads. */
export const STAMPS_LANDS = 'Everyone else sees it the next time their Hub opens or reloads.'

/** Scheduling's answers carry the hours switch: it lands on the next read of a house. */
export const SCHED_LANDS = 'Everyone else sees it in Scheduling the next time a house is read.'

// Scheduling's hours column: the master's own session always sees it; everyone else sees it only when the switch…
export function schedHoursHiddenFor(master: boolean, hidden: boolean | undefined): boolean {
  return !master && hidden !== false
}

/** Only a plain yes hides — the same reading the backend gives the cell. */
export function hideWord(value: string | undefined): boolean {
  return ['yes', 'on', 'true', '1'].includes(String(value ?? '').trim().toLowerCase())
}

/** The parts that fail closed (AlertsConfig.gs MYWORK_HIDE_FAIL_CLOSED): only a plain no shows what they hide. */
export const FAIL_CLOSED_PARTS: ReadonlySet<SwitchPart> = new Set<SwitchPart>(['sched_hours'])

/** A switch's cell as the backend reads it for that part: a fail-closed part hides on a blank or an unknown word. */
export function hideWordFor(part: SwitchPart, value: string | undefined): boolean {
  if (!FAIL_CLOSED_PARTS.has(part)) return hideWord(value)
  return !['no', 'off', 'false', '0'].includes(String(value ?? '').trim().toLowerCase())
}
