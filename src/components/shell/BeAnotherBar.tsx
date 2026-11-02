// "ACTING AS <NAME> — BE BACK", on every screen, for as long as it is true.
// The master wearing another account sees exactly what that person sees — their apps, their sidebar, their Settings…
import { useEffect, useState } from 'react'
import { ArrowLeftCircle, Loader2, VenetianMask } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import type { BeAnotherActing, Role } from '@/auth/types'
import RoleBadge, { TypeBadges } from '@/components/shared/RoleBadge'
import { BE_ANOTHER_BAR_HEIGHT_PX, BE_ANOTHER_VAR } from '@/lib/hubStatus'
import { beBack, clockOf } from '@/lib/beAnother'

const TITLE_MARK = '[Acting] '

export default function BeAnotherBar() {
  const acting = useAuthStore((s) => s.beAnother?.acting ?? null)
  const [busy, setBusy] = useState(false)

  // the tab's own title says it too, so a row of tabs cannot hide it
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.title !== 'string') return
    const bare = document.title.startsWith(TITLE_MARK) ? document.title.slice(TITLE_MARK.length) : document.title
    document.title = acting ? TITLE_MARK + bare : bare
  }, [acting])

  if (!acting) return null
  return (
    <BeAnotherBarView
      acting={acting}
      busy={busy}
      onBack={() => {
        setBusy(true)
        void beBack().finally(() => setBusy(false))
      }}
    />
  )
}

/** The band itself, drawn from the acting block alone. */
export function BeAnotherBarView({ acting, busy, onBack }: {
  acting: BeAnotherActing
  busy: boolean
  onBack: () => void
}) {
  const name = acting.display_name || acting.email || 'another account'
  const role = (acting.role || 'staff') as Role
  return (
    <div
      role="status"
      aria-live="assertive"
      data-be-another-bar=""
      className="fixed inset-x-0 top-0 z-[10000] flex items-center justify-center gap-2 border-b border-black/20 bg-danger px-3 pt-safe text-[12px] font-medium leading-none text-white shadow-md print:hidden"
      style={{ height: `var(${BE_ANOTHER_VAR}, ${BE_ANOTHER_BAR_HEIGHT_PX}px)` }}
    >
      <VenetianMask size={14} aria-hidden className="shrink-0" />
      <span className="shrink-0 whitespace-nowrap">
        Acting as <b className="font-bold">{name}</b>
      </span>
      <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
        <RoleBadge user={{ role, isMaster: false }} size="xs" />
        <TypeBadges user={{ role, isMaster: false, types: acting.types }} size="xs" />
      </span>
      <span className="hidden min-w-0 truncate text-white/85 md:inline">
        you see exactly what they see · ends {clockOf(acting.local_until)}
      </span>
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="ml-1 inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-white px-2.5 text-[11.5px] font-bold text-danger transition-colors hover:bg-white/90 disabled:opacity-70"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowLeftCircle size={12} />}
        Be Back
      </button>
    </div>
  )
}
