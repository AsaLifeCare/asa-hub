// Share and Actions on the top bar.
// Actions is an anchored menu in three groups — Candidate actions (Add note and Update stage, modes of the one…
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ChevronDown, Copy, GitBranch, ListOrdered, Phone, Plus, Share2, Users, type LucideIcon } from 'lucide-react'
import { usePanelEscape } from '@/components/shared/SidePanel'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { READ_ONLY, actionGroups, type CandidateAsk, type CandidateDetails, type CandidateTab, type MenuItem, type Reach } from './candidateModel'

const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'
const ITEM = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'

const ICON: Record<MenuItem['id'], LucideIcon> = {
  note: Plus, stage: ListOrdered, 'copy-email': Copy, call: Phone, pipeline: Users, hiring: GitBranch,
}

export default function CandidateActions({ candidate, details, onAsk, onTab, reach = READ_ONLY }: {
  candidate: string
  /** the candidate's e-mail and phone: the overview's once read, the roster's before; null while neither is */
  details: Pick<CandidateDetails, 'email' | 'phone'> | null
  onAsk: (ask: CandidateAsk) => void
  onTab: (tab: CandidateTab) => void
  /** what this reader may do: the writes are the master's, a narrowed reader has no contact line */
  reach?: Reach
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
      <button type="button" onClick={() => onAsk({ kind: 'share' })} aria-label="Share this candidate" data-share=""
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
            <ActionsMenu candidate={candidate} details={details} reach={reach} onDone={() => setOpen(false)}
              onPick={(ask) => { setOpen(false); onAsk(ask) }}
              onTab={(tab) => { setOpen(false); onTab(tab) }} />
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

export function ActionsMenu({ candidate, details, onPick, onTab, onDone, reach = READ_ONLY }: {
  candidate: string
  details: Pick<CandidateDetails, 'email' | 'phone'> | null
  onPick: (ask: CandidateAsk) => void
  onTab: (tab: CandidateTab) => void
  reach?: Reach
  onDone: () => void
}) {
  return (
    <div role="menu" aria-label="Actions" data-actions-menu="">
      {actionGroups(candidate, details, reach).map((g, i) => (
        <div key={g.label} className={cn(i > 0 && 'mt-1 border-t border-border pt-1')} data-group={g.label}>
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-3">{g.label}</p>
          {g.items.map((it) => {
            const Icon = ICON[it.id]
            const inner = <><Icon size={14} className="text-text-3" /> {it.label}</>
            switch (it.id) {
              case 'note': case 'stage':
                return (
                  <button key={it.id} type="button" role="menuitem" onClick={() => onPick(it.ask)} data-action={it.id} className={ITEM}>
                    {inner}
                  </button>
                )
              case 'pipeline':
                return (
                  <button key={it.id} type="button" role="menuitem" onClick={() => onTab(it.tab)} data-action={it.id} className={ITEM}>
                    {inner}
                  </button>
                )
              case 'hiring':
                return (
                  <Link key={it.id} role="menuitem" to={it.href} onClick={onDone} data-action={it.id} className={ITEM}>
                    {inner} <ArrowRight size={13} className="ml-auto text-text-3" />
                  </Link>
                )
              case 'copy-email': case 'call':
                if (it.why) {
                  return (
                    <button key={it.id} type="button" role="menuitem" disabled title={it.why} aria-disabled data-action={it.id} className={ITEM}>
                      {inner}
                    </button>
                  )
                }
                return it.id === 'copy-email' ? (
                  <button key={it.id} type="button" role="menuitem" data-action={it.id} className={ITEM}
                    onClick={() => { onDone(); void copyEmail(it.value) }}>
                    {inner}
                  </button>
                ) : <a key={it.id} role="menuitem" href={it.href} onClick={onDone} data-action={it.id} className={ITEM}>{inner}</a>
            }
          })}
        </div>
      ))}
    </div>
  )
}
