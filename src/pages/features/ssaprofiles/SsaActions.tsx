// Share and Actions on the top bar.
// Actions is an anchored menu in three groups — SSA actions (Add note, a mode of the one right panel, offered to a…
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ChevronDown, Copy, Pencil, Phone, Plus, Share2, type LucideIcon } from 'lucide-react'
import { usePanelEscape } from '@/components/shared/SidePanel'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { actionGroups, type MenuItem, type SsaAsk, type SsaClient, type SsaDetails } from './ssaModel'

const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'
const ITEM = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'

const ICON: Record<MenuItem['id'], LucideIcon> = { note: Plus, edit: Pencil, 'copy-email': Copy, call: Phone, 'open-client': ArrowRight }

export default function SsaActions({ details, clients, write, edit = false, onAsk }: {
  /** the SSA's e-mail and phone: the overview's once read, the roster's before; null while neither is */
  details: Pick<SsaDetails, 'email' | 'phone'> | null
  clients: SsaClient[] | null
  /** the master in its own session or a holder of the notes edition: Add note is offered */
  write: boolean
  /** the master or a holder of the edition: Edit details is offered */
  edit?: boolean
  onAsk: (ask: SsaAsk) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  usePanelEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    // pinned right even when it wraps under the switcher, so the right-anchored menu opens inward on a phone
    <div className="ml-auto flex items-center gap-2">
      <button type="button" onClick={() => onAsk({ kind: 'share' })} aria-label="Share this SSA" data-share=""
        className={cn(BAR_BTN, 'w-11 justify-center px-0')}>
        <Share2 size={16} />
      </button>
      <div ref={box} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={BAR_BTN}
          data-actions="">
          Actions <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-40 mt-2 w-[260px] rounded-[14px] border border-border bg-surface py-1.5 shadow-3">
            <ActionsMenu details={details} clients={clients} write={write} edit={edit} onDone={() => setOpen(false)}
              onPick={(ask) => { setOpen(false); onAsk(ask) }} />
          </div>
        )}
      </div>
    </div>
  )
}

async function copyEmail(email: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(email)
    toast({ type: 'success', title: 'E-mail copied', body: email })
  } catch {
    toast({ type: 'danger', title: 'Not copied', body: 'The browser did not allow the copy.' })
  }
}

export function ActionsMenu({ details, clients, write, edit = false, onPick, onDone }: {
  details: Pick<SsaDetails, 'email' | 'phone'> | null
  clients: SsaClient[] | null
  write: boolean
  edit?: boolean
  onPick: (ask: SsaAsk) => void
  onDone: () => void
}) {
  return (
    <div role="menu" aria-label="Actions" data-actions-menu="">
      {actionGroups(details, clients, write, edit).map((g, i) => (
        <div key={g.label} className={cn(i > 0 && 'mt-1 border-t border-border pt-1')} data-group={g.label}>
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-3">{g.label}</p>
          {g.items.map((it) => {
            const Icon = ICON[it.id]
            const inner = <><Icon size={14} className="text-text-3" /> {it.label}</>
            if (it.id === 'note' || it.id === 'edit') {
              return (
                <button key={it.id} type="button" role="menuitem" onClick={() => onPick(it.ask)} data-action={it.id} className={ITEM}>
                  {inner}
                </button>
              )
            }
            if (it.why) {
              return (
                <button key={it.id} type="button" role="menuitem" disabled title={it.why} aria-disabled data-action={it.id} className={ITEM}>
                  {inner}
                </button>
              )
            }
            if (it.id === 'copy-email') {
              return (
                <button key={it.id} type="button" role="menuitem" data-action={it.id} className={ITEM}
                  onClick={() => { onDone(); void copyEmail(it.value) }}>
                  {inner}
                </button>
              )
            }
            if (it.id === 'call') {
              return <a key={it.id} role="menuitem" href={it.href} onClick={onDone} data-action={it.id} className={ITEM}>{inner}</a>
            }
            return <Link key={it.id} role="menuitem" to={it.href} onClick={onDone} data-action={it.id} className={ITEM}>{inner}</Link>
          })}
        </div>
      ))}
    </div>
  )
}
