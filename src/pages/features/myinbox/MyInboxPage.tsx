// MY INBOX · Alerts and Chat — one screen under one header: Refresh, then the page switch (Alerts | Chat · n).
// Alerts are the relay's (/hub-lanes/my-inbox), which decides whose they are; the chat is always the signed-in…
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useSectionCrumb } from '@/lib/sectionCrumb'
import { useShellHides } from '@/lib/myWorkHides'
import { RefreshCw } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import PageSwitchMenu, { type SwitchItem } from '@/components/shared/PageSwitchMenu'
import { useChatPresenceStore } from '@/lib/chatPresence'
import { chatKindOf, useLiveMode } from '@/lib/chatLive/access'
import { useChatLiveStore } from '@/lib/chatLive/store'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { PageRefreshTick } from '@/lib/pageRefresh'
import ChatPage from '@/pages/features/chat/ChatPage'
import ChatLiveView from '@/pages/features/chat/live/ChatLiveView'
import { MY_INBOX_APP_ID, MY_INBOX_PAGES, type MyInboxPageId } from '@/registry/apps-myinbox'
import AlertsView from './AlertsView'

export const VISIT_SENTENCE = "My Inbox shows the signed-in account's own alerts and chat — close the visit to see them."

const SUBTITLE: Record<MyInboxPageId, string> = {
  alerts: 'What concerns you, from every source that can tell — newest first',
  chat: 'The people on the platform, and what they said.',
}

/** A client-role account (a client or a guardian) talks to its care team; the alerts line is everyone's. */
export const CLIENT_CHAT_SUBTITLE = 'Your care team'

export function subtitleOf(page: MyInboxPageId, client = false): string {
  return client && page === 'chat' ? CLIENT_CHAT_SUBTITLE : SUBTITLE[page]
}

export const viewOf = (pageId: string): MyInboxPageId => (pageId === 'chat' ? 'chat' : 'alerts')

/** The switch's two views; Chat carries its unread count. */
export function switchItems(chatUnread: number): SwitchItem[] {
  const n = Math.max(0, Math.floor(Number(chatUnread) || 0))
  return [
    { id: 'alerts', title: 'Alerts' },
    { id: 'chat', title: n > 0 ? `Chat · ${n}` : 'Chat' },
  ]
}

export function MyInboxHeader({ page, chatUnread, onRefresh, onPick, client = false }: {
  page: MyInboxPageId
  chatUnread: number
  onRefresh: () => void
  onPick: (id: string) => void
  /** a client-role account: the chat is its care team */
  client?: boolean
}) {
  // the Alerts line under the title is the master's alone while Settings › My Work hides it
  const hides = useShellHides()
  return (
    <PageHeader
      title="My Inbox"
      subtitle={page === 'alerts' && hides.inbox_alerts_subtitle ? undefined : subtitleOf(page, client)}
      actions={
        <>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh"
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            <RefreshCw size={14} /> <span className="max-sm:hidden">Refresh</span>
          </button>
          <PageSwitchMenu
            items={switchItems(chatUnread)}
            current={page}
            onPick={onPick}
            label="Go to another view of My Inbox"
          />
        </>
      }
    />
  )
}

export default function MyInboxPage() {
  const { pageId = '' } = useParams()
  const page = viewOf(pageId)
  useSectionCrumb(MY_INBOX_PAGES.find((p) => p.id === page)?.title)
  const navigate = useNavigate()
  const eff = useEffectiveUser()
  const visiting = !!eff?.visiting
  const unread = useChatPresenceStore((s) => s.unread)
  const [tick, setTick] = useState(0)
  return (
    <div className="w-full">
      <MyInboxHeader
        page={page}
        client={eff?.role === 'client'}
        // inside a visit nothing of the chat is counted here
        chatUnread={visiting ? 0 : unread}
        onRefresh={() => setTick((t) => t + 1)}
        onPick={(id) => { if (id !== page) navigate(`/app/${MY_INBOX_APP_ID}/${id}`) }}
      />
      <PageRefreshTick.Provider value={tick}>
        {visiting ? <VisitNotice /> : page === 'chat' ? <InboxChat /> : <AlertsView />}
      </PageRefreshTick.Provider>
    </div>
  )
}

/** The live chat (lib/chatLive/access chatKindOf), or today's chat — read-only in a switched session. */
export function InboxChat() {
  const mode = useLiveMode()
  const refused = useChatLiveStore((s) => s.refused)
  return chatKindOf(mode, refused) === 'live' ? <ChatLiveView mode={mode} /> : <ChatPage embedded />
}

export function VisitNotice() {
  return (
    <div className="w-full pb-16">
      <EmptyState title="My Inbox" body={VISIT_SENTENCE} />
    </div>
  )
}
