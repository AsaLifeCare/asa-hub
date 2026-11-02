// The Chat app — My Inbox's chat (InboxChat) under the app's own header: the live chat where App Control gives it,
// today's chat everywhere else, read and written by the Hub's Python chat (app/chat.py) either way.
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { PageRefreshTick } from '@/lib/pageRefresh'
import { CLIENT_CHAT_SUBTITLE, InboxChat } from '@/pages/features/myinbox/MyInboxPage'

export const CHAT_APP_SUBTITLE = 'The people on the platform, and what they said.'
export const CHAT_VISIT_SENTENCE = "Chat shows the signed-in account's own conversations — close the visit to see them."

export default function ChatAppPage() {
  const eff = useEffectiveUser()
  const [tick, setTick] = useState(0)
  return (
    <div className="w-full">
      <PageHeader
        title="Chat"
        subtitle={eff?.role === 'client' ? CLIENT_CHAT_SUBTITLE : CHAT_APP_SUBTITLE}
        actions={
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            aria-label="Refresh"
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            <RefreshCw size={14} /> <span className="max-sm:hidden">Refresh</span>
          </button>
        }
      />
      <PageRefreshTick.Provider value={tick}>
        {eff?.visiting
          ? <div className="w-full pb-16"><EmptyState title="Chat" body={CHAT_VISIT_SENTENCE} /></div>
          : <InboxChat />}
      </PageRefreshTick.Provider>
    </div>
  )
}
