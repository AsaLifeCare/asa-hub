// The shell's notice intake (from lib/chatPresence): stream frames, the beat's newest id, and a reopened stream…
// Who hears what is server/web_notices.py's.
import { useNotificationStore } from '@/stores/useNotificationStore'
import { asServerNotice } from '@/lib/noticesApi'
import { osPermission } from '@/lib/osNotify'

/** A frame off the chat stream whose kind is `notice`. */
export function onNoticeFrame(raw: unknown): void {
  const n = asServerNotice(raw)
  if (!n) return
  const store = useNotificationStore.getState()
  // a paused bell reads whole instead of trusting one frame
  if (store.paused) {
    void store.fetchAll({ force: true })
    return
  }
  store.absorb([n], { announce: true })
}

/** A paused bell re-asks this often; ending the hold does not move the beat's id. */
export const PAUSED_RECHECK_MS = 60_000

/** The beat's newest notice id; `null` means not looked yet, so nothing is asked. */
export function onBeatSeq(seq: number | null | undefined, nowMs = Date.now()): void {
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return
  const store = useNotificationStore.getState()
  if (!store.loaded) {
    void store.fetchAll({ force: true })
    return
  }
  if (store.paused) {
    if (seq > store.seq || nowMs - store.readAt >= PAUSED_RECHECK_MS) void store.fetchAll({ force: true })
    return
  }
  if (seq > store.seq) void store.refreshInbox()
}

/** A hidden tab with its stream down still reads new notices when OS notices are allowed. */
export function onHiddenBeat(streamLive: boolean): void {
  if (streamLive || osPermission() !== 'granted') return
  const store = useNotificationStore.getState()
  if (store.loaded) void store.refreshInbox()
}

/** The chat stream just (re)opened: read what was pushed into the gap. */
export function onStreamOpened(): void {
  const store = useNotificationStore.getState()
  if (store.loaded) void store.refreshInbox()
}

let sessionToken: string | null | undefined

/** The tab's session changed: nothing the last person was told stays on screen. */
export function onSession(token: string | null): void {
  if (token === sessionToken) return
  const first = sessionToken === undefined
  sessionToken = token
  if (first) return
  const store = useNotificationStore.getState()
  store.reset()
  if (token) void store.fetchAll({ force: true })
}
