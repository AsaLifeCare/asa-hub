// WHO GETS LIVE CHAT.
// App Control id `my-inbox.liveChat` ships with no row, so by the badge law it is the master's alone until it is…
import { useAuthStore } from '@/auth/useAuthStore'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { MY_INBOX_APP_ID } from '@/registry/apps-myinbox'
import type { Refusal } from './model'

/** namespaced as every in-page gate is (tools/check-client-contract featureKeyCheck), and asked as an app id */
export const LIVE_CHAT_ID = 'my-inbox.liveChat'

/** off: today's chat · on: the live hub · acting: a switched session, which reads the person's chat and writes nothing */
export type LiveMode = 'off' | 'on' | 'acting'

type SessionUser = { isMaster?: boolean; types?: string[]; derivedTypes?: string[]; role?: string; appDenials?: string[] }

export function liveModeWith(user: SessionUser | null | undefined, rules: Record<string, string[]>,
  acting: boolean): LiveMode {
  if (!user) return 'off'
  // only the master can wear another account, and the master is never without live chat
  if (acting) return 'acting'
  if (!badgeAllowsApp(LIVE_CHAT_ID, user, rules)) return 'off'
  if (!badgeAllowsApp(MY_INBOX_APP_ID, user, rules)) return 'off'
  return 'on'
}

// Which chat a screen draws: the live one, or today's chat — for everyone App Control has not given it, for a…
export function chatKindOf(mode: LiveMode, refused: Refusal | null): 'live' | 'today' {
  if (mode !== 'on' || refused === 'access' || refused === 'unavailable') return 'today'
  return 'live'
}

/** The Chat app's own conversation page, which a live session is sent from to My Inbox (ChatPage). */
export const CHAT_APP_ROUTE = '/app/chat/messages'
/** My Inbox's chat. */
export const INBOX_CHAT_ROUTE = `/app/${MY_INBOX_APP_ID}/chat`

// Where a link to the Chat app's conversation (a chat toast's, a "Message <person>" button's) lands for a session…
export function chatAppFallback(canOpen: (route: string) => boolean, search: string): string | null {
  if (canOpen(CHAT_APP_ROUTE) || !canOpen(INBOX_CHAT_ROUTE)) return null
  return `${INBOX_CHAT_ROUTE}${search}`
}

// Where a link to My Inbox's chat (a chat push's) lands for a session My Inbox does not open to: the same…
export function inboxChatFallback(mode: LiveMode, canOpen: (route: string) => boolean, search: string): string | null {
  if (mode === 'on' || canOpen(INBOX_CHAT_ROUTE) || !canOpen(CHAT_APP_ROUTE)) return null
  return `${CHAT_APP_ROUTE}${search}`
}

export function liveModeNow(): LiveMode {
  const { user, beAnother } = useAuthStore.getState()
  return liveModeWith(user, useBadgeAccessStore.getState().rules, Boolean(beAnother?.acting))
}

export function useLiveMode(): LiveMode {
  const user = useAuthStore((s) => s.user)
  const acting = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const rules = useBadgeAccessStore((s) => s.rules)
  return liveModeWith(user, rules, acting)
}
