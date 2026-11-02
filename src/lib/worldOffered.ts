// IS THIS ACCOUNT OFFERED A WORLD AT ALL — the session's own answer (authMe / authLogin `my_world`), read off the…
// The master always is.
import { useAuthStore } from '@/auth/useAuthStore'

type WorldFlags = { isMaster?: boolean; myWorld?: boolean } | null | undefined

export function worldOfferedTo(user: WorldFlags): boolean {
  return Boolean(user?.isMaster || user?.myWorld)
}

/** The signed-in account's answer now, for code outside React. */
export function worldOffered(): boolean {
  return worldOfferedTo(useAuthStore.getState().user)
}

/** The same answer, reactive. */
export function useWorldOffered(): boolean {
  return useAuthStore((s) => worldOfferedTo(s.user))
}
