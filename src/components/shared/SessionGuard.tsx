// THE CURTAIN FOR A SWAPPED SESSION — a message sent to a colleague simply disappeared: a second sign-in in the…
// The chat beat carries the session's real identity (chatPing → `me`), the presence store holds the mismatch, and…
import { RefreshCw, UserRound } from 'lucide-react'
import SiteFooter from '@/components/shared/SiteFooter'
import { useChatPresenceStore } from '@/lib/chatPresence'

export default function SessionGuard() {
  const name = useChatPresenceStore((s) => s.mismatchName)
  if (!name) return null
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center overflow-y-auto bg-bg/95 px-6 pt-6">
      <div className="my-auto w-full max-w-md rounded-xl border border-warning/40 bg-surface p-6 text-center shadow-xl">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-warning/10 text-warning">
          <UserRound size={22} />
        </div>
        <h1 className="text-[17px] font-bold text-text-1">
          This tab is now signed in as {name}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-2">
          Somebody signed in on another tab of this browser, and the session under
          this one changed with it. The screen below still shows the previous
          person — reload to continue as <b>{name}</b>, or use a different
          browser (or a private window) to keep two people signed in at once.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-[13.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
        >
          <RefreshCw size={15} /> Reload as {name}
        </button>
      </div>
      <SiteFooter />
    </div>
  )
}
