// LIVE CHAT IN THE SHELL — one connection per tab, armed for a session App Control gives live chat, and only when…
// (An auth-store write that changes none of those arms nothing: a page load writes the store twice.) The connection…
import { useAuthStore } from '@/auth/useAuthStore'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { activeTenantId, useTenantStore } from '@/stores/useTenantStore'
import { LIVE_CHAT_ID, liveModeNow } from './access'
import { useChatLiveStore } from './store'
import type { LiveApi } from './connection'

/** What the connection is armed for; a change of any part is a new connection. */
export type LiveKey = { token: string; account: string; tenant: string }

export function liveKeyOf(state: { token: string | null; account: string; mode: string; tenant: string }): LiveKey | null {
  if (!state.token || !state.account || state.mode !== 'on') return null
  return { token: state.token, account: state.account, tenant: state.tenant }
}

export function sameKey(a: LiveKey | null, b: LiveKey | null): boolean {
  return a === b || (a !== null && b !== null && a.token === b.token && a.account === b.account && a.tenant === b.tenant)
}

const CAN_LIVE = typeof window !== 'undefined' && typeof WebSocket !== 'undefined'

let armedKey: LiveKey | null = null
let armedMode = ''
let api: LiveApi | null = null
let generation = 0
let scheduled = false

/** The running connection's calls, for My Inbox → Chat; null until it has loaded. */
export function liveApi(): LiveApi | null {
  return api
}

function wanted(): { key: LiveKey | null; mode: string } {
  const { token, user } = useAuthStore.getState()
  const mode = liveModeNow()
  return { key: liveKeyOf({ token, account: String(user?.id ?? ''), mode, tenant: activeTenantId() }), mode }
}

function arm(): void {
  scheduled = false
  const { key, mode } = wanted()
  if (sameKey(key, armedKey) && mode === armedMode) return
  const keepConnection = sameKey(key, armedKey)
  armedMode = mode
  if (keepConnection) return
  armedKey = key
  const mine = ++generation
  api?.stop()
  api = null
  useChatLiveStore.getState().reset(Boolean(key) && CAN_LIVE, key?.account ?? '')
  if (!key) return
  if (!CAN_LIVE) {
    useChatLiveStore.getState().setRefused('unavailable')
    return
  }
  import('./connection')
    .then((m) => {
      if (mine !== generation) return
      api = m.startLive(key)
    })
    .catch(() => {
      if (mine !== generation) return
      // the chunk could not load (a tab older than the served build): today's chat stands in
      useChatLiveStore.setState({ owns: false })
      useChatLiveStore.getState().setRefused('unavailable')
    })
}

function schedule(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(arm)
}

if (typeof window !== 'undefined') {
  schedule()
  useAuthStore.subscribe((s, prev) => {
    if (s.token !== prev.token || s.user?.id !== prev.user?.id || s.user?.isMaster !== prev.user?.isMaster
      || Boolean(s.beAnother?.acting) !== Boolean(prev.beAnother?.acting)) schedule()
  })
  useBadgeAccessStore.subscribe((s, prev) => {
    if (s.rules[LIVE_CHAT_ID] !== prev.rules[LIVE_CHAT_ID] || s.rules['my-inbox'] !== prev.rules['my-inbox']) schedule()
  })
  useTenantStore.subscribe((s, prev) => {
    if (s.currentTenantId !== prev.currentTenantId || s.homeTenantId !== prev.homeTenantId
      || s.tenantsLoaded !== prev.tenantsLoaded) schedule()
  })
}
