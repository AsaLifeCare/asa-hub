// ARE MY ASA.
// AND BOOKMARKS OFFERED TO THIS ACCOUNT — the session's own answer (authMe / authLogin `my_asa`), read off the…
import { useAuthStore } from '@/auth/useAuthStore'

export const MYASA_APP_ID = 'myasa'

/** Where an address that is not offered lands instead. */
export const MYASA_ELSEWHERE = '/app/my-work/actions'

type MyAsaFlags = { isMaster?: boolean; myAsa?: boolean } | null | undefined

export function myAsaOfferedTo(user: MyAsaFlags): boolean {
  return Boolean(user?.isMaster) || user?.myAsa !== false
}

/** The signed-in account's answer now, for code outside React. */
export function myAsaOffered(): boolean {
  return myAsaOfferedTo(useAuthStore.getState().user)
}

/** The same answer, reactive. */
export function useMyAsaOffered(): boolean {
  return useAuthStore((s) => myAsaOfferedTo(s.user))
}
