// Settings › My Work's stamps switch: every "Updated … ago" / "Read …" line is hidden from every session but the…
// The switch rides the session user (Auth.gs `stamps_hidden`); a visit or an acting session is not the master's own.
import { useSyncExternalStore } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import { effectiveUser } from '@/lib/effectiveUser'
import { useMemberStore } from '@/stores/useMemberStore'

/** Absent reads as hidden, as the switch ships. */
export function stampsHiddenFor(switchOn: boolean | undefined, ownMaster: boolean): boolean {
  return !ownMaster && switchOn !== false
}

const hiddenNow = () =>
  stampsHiddenFor(useAuthStore.getState().user?.stampsHidden, effectiveUser()?.isMaster === true)

const subscribe = (onChange: () => void) => {
  const offAuth = useAuthStore.subscribe(onChange)
  const offMember = useMemberStore.subscribe(onChange)
  return () => { offAuth(); offMember() }
}

/** The live state on the server render too, so a drawn page never disagrees with the store. */
export function useStampsHidden(): boolean {
  return useSyncExternalStore(subscribe, hiddenNow, hiddenNow)
}

const notesHiddenNow = () =>
  stampsHiddenFor(useAuthStore.getState().user?.recordNotesHidden, effectiveUser()?.isMaster === true)

/** Settings › My Work's Staff source-notes switch (Auth.gs `record_notes_hidden`), read the same way as the stamps. */
export function useRecordNotesHidden(): boolean {
  return useSyncExternalStore(subscribe, notesHiddenNow, notesHiddenNow)
}

const clientActivityHiddenNow = () =>
  stampsHiddenFor(useAuthStore.getState().user?.clientActivityHidden, effectiveUser()?.isMaster === true)

/** Settings › My Work's Clients switch (`client_activity_hidden`): a client's Activity without its three figures and
 * its Action column for everyone but the master, read the same way as the stamps. */
export function useClientActivityHidden(): boolean {
  return useSyncExternalStore(subscribe, clientActivityHiddenNow, clientActivityHiddenNow)
}

const clientGroupTitlesHiddenNow = () =>
  stampsHiddenFor(useAuthStore.getState().user?.clientGroupTitlesHidden, effectiveUser()?.isMaster === true)

/** Settings › My Work's Clients switch (`client_group_titles_hidden`): a client's Client details without the titles
 * over its groups for everyone but the master, read the same way as the stamps. */
export function useClientGroupTitlesHidden(): boolean {
  return useSyncExternalStore(subscribe, clientGroupTitlesHiddenNow, clientGroupTitlesHiddenNow)
}

const staffDocCountsHiddenNow = () =>
  stampsHiddenFor(useAuthStore.getState().user?.staffDocCountsHidden, effectiveUser()?.isMaster === true)

/** Settings › My Work's Staff switch (`staff_doc_counts_hidden`): a person's Documents without the line counting them
 * for everyone but the master, read the same way as the stamps. */
export function useStaffDocCountsHidden(): boolean {
  return useSyncExternalStore(subscribe, staffDocCountsHiddenNow, staffDocCountsHiddenNow)
}

const familyDetailsHiddenNow = () =>
  stampsHiddenFor(useAuthStore.getState().user?.familyDetailsHidden, effectiveUser()?.isMaster === true)

/** Settings › My Work's Families & Guardians switch (`family_details_hidden`): the details' source line, the counts
 * under Associated clients and Documents, their side pencils and the edit panel's notices, for everyone but the master. */
export function useFamilyDetailsHidden(): boolean {
  return useSyncExternalStore(subscribe, familyDetailsHiddenNow, familyDetailsHiddenNow)
}
