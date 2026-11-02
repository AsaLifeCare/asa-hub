// WHO IS READING CLIENTS, and what the page offers them.
// Every answer is the server's (ClientProfiles.gs clientProfilesReader_): the master and every badge App Control…
import { createContext, useContext } from 'react'
import type { EditionId } from '@/lib/editions'
import { wornTypes } from '@/lib/badgeAccess'
import { effectiveUser } from '@/lib/effectiveUser'
import { useFeatureAllowed } from '@/lib/featureAccess'

/** The roster answer's `viewer`: '' when the roster came from the slices, which only a wide reader is served. */
export type ClientViewer = 'master' | 'all' | 'ssa' | 'client' | 'guardian' | ''

const VIEWERS: readonly ClientViewer[] = ['master', 'all', 'ssa', 'client', 'guardian']

export function viewerOf(v: unknown): ClientViewer {
  const s = String(v ?? '').trim().toLowerCase()
  return (VIEWERS as readonly string[]).includes(s) ? (s as ClientViewer) : ''
}

/** A client, an SSA or a family member: their own record, without the staff's notes or the office's parts. */
export const ownRecordOnly = (viewer: ClientViewer): boolean => viewer === 'client' || viewer === 'guardian' || viewer === 'ssa'

/** The sections, and the tabs inside a section, the doors refuse a client or a family member. */
export const OFFICE_TABS: readonly string[] = ['billing']
export const OFFICE_VIEWS: Readonly<Record<string, readonly string[]>> = {
  medication: ['refills'], transportation: ['vehicles'], administration: ['errors'],
}

export function shownTabs<T extends { id: string }>(tabs: readonly T[], viewer: ClientViewer): T[] {
  return ownRecordOnly(viewer) ? tabs.filter((t) => !OFFICE_TABS.includes(t.id)) : [...tabs]
}

export function shownViews<T extends { id: string }>(section: string, views: readonly T[], viewer: ClientViewer): T[] {
  const off = ownRecordOnly(viewer) ? OFFICE_VIEWS[section] ?? [] : []
  return views.filter((v) => !off.includes(v.id))
}

/** Who reads, whether the writes are theirs, the editions they make. A section drawn outside the page withholds nothing. */
export type ClientReader = { viewer: ClientViewer; mayWrite: boolean; editions?: readonly EditionId[] }

export const ClientReaderContext = createContext<ClientReader>({ viewer: '', mayWrite: true })

export const useClientReader = (): ClientReader => useContext(ClientReaderContext)

/** Does this reader make the edition? The master always; a listed holder its own; never a client's or a family's view. */
export function clientCan(r: ClientReader, edition: EditionId): boolean {
  if (ownRecordOnly(r.viewer)) return false
  return r.mayWrite || (r.editions ?? []).includes(edition)
}

/** This reader makes the edition (clientCan, from the page's context). */
export const useClientCan = (edition: EditionId): boolean => clientCan(useClientReader(), edition)

/** App Control's row for Clients › Transportation (lib/featureAccess), asked under the same id by the server
 *  (app/clients.py transport_open) for Calendar and History, and for the trips' board lent here. */
export const TRANSPORT_FEATURE = 'client-profiles.transportation'
/** The edition that lives in the tab (New trip): its holder keeps the tab, since an edition only ever adds people. */
export const TRANSPORT_EDITION: EditionId = 'clients.transportation'

/** Is Clients › Transportation offered? The master always; a badge the row names (`rowOpens`, featureAllowsWith); a
 *  holder of the tab's edition. A section drawn outside the page withholds nothing, as clientCan says. */
export const transportOffered = (r: ClientReader, rowOpens: boolean): boolean => rowOpens || clientCan(r, TRANSPORT_EDITION)

/** The tab an address names, when it is offered: a Transportation shut to this reader opens the client's profile. */
export const tabOffered = <T extends string>(tab: T, transport: boolean): T | 'profile' =>
  (tab === 'transportation' && !transport ? 'profile' : tab)

/** transportOffered for the signed-in person (useFeatureAllowed) and this reader. */
export function useTransportOffered(r: ClientReader): boolean {
  return transportOffered(r, useFeatureAllowed(TRANSPORT_FEATURE))
}

// An account the server may narrow — outside the master's own session, a client-role account or one wearing CLIENT…
export function narrowedReader(): boolean {
  const u = effectiveUser()
  if (!u || u.isMaster) return false
  return String(u.role ?? '').toLowerCase() === 'client' || wornTypes(u).some((t) => t === 'CLIENT' || t === 'FAMILY' || t === 'SSA')
}

export const NOT_OPEN = 'This part is not open to you.'

// "Unknown action." as words: to a signed-in account other than the master's own session it is a door shut to them…
export function unknownActionWords(error: string, notPublished: string): string | null {
  if (!/unknown action/i.test(error)) return null
  const u = effectiveUser()
  return u && !u.isMaster ? NOT_OPEN : notPublished
}
