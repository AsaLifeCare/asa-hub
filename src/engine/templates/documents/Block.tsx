/** Reader body typography — one renderer per DocBlock kind (moved verbatim from DocumentsTemplate.tsx). */
import { Check, Info } from 'lucide-react'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { DocBlock } from '@/engine/types'

export function Block({ b }: { b: DocBlock }) {
  switch (b.kind) {
    case 'h2':
      return (
        <h2 id={b.id} className="scroll-mt-24 pt-8 font-display text-[20px] font-bold leading-7 text-text-1">
          {b.text}
        </h2>
      )
    case 'h3':
      return (
        <h3 id={b.id} className="scroll-mt-24 pt-4 font-display text-[16px] font-semibold leading-6 text-text-1">
          {b.text}
        </h3>
      )
    case 'p':
      return <p className="text-[15px] leading-[26px] text-text-1">{b.text}</p>
    case 'callout':
      return (
        <div
          className={cn('flex gap-3 rounded-md border-l-[3px] p-4', TINT_BG[b.tint])}
          style={{ borderColor: TINT_VAR[b.tint] }}
        >
          <Info size={16} className={cn('mt-0.5 shrink-0', TINT_FG[b.tint])} />
          <p className="text-[14px] leading-6 text-text-1">{b.text}</p>
        </div>
      )
    case 'code':
      return (
        <pre className="scroll-thin overflow-auto rounded-md bg-surface-2 p-4 font-mono text-[13px] leading-[22px] text-text-2">
          {b.text}
        </pre>
      )
    default: {
      // defensive kinds for future content (quote / list / divider)
      const any = b as { kind: string; text?: string; items?: string[] }
      if (any.kind === 'quote') {
        return (
          <blockquote className="border-l-2 border-primary pl-4 text-[15px] italic leading-[26px] text-text-2">
            {any.text}
          </blockquote>
        )
      }
      if (any.kind === 'list' && Array.isArray(any.items)) {
        return (
          <ul className="space-y-2.5">
            {any.items.map((it, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[15px] leading-[26px] text-text-1">
                <Check size={15} className="mt-1.5 shrink-0 text-primary" />
                {it}
              </li>
            ))}
          </ul>
        )
      }
      if (any.kind === 'divider') {
        return (
          <div className="flex items-center gap-3 py-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="h-1 w-1 rounded-full bg-border-strong" />
            <span className="h-px flex-1 bg-border" />
          </div>
        )
      }
      return null
    }
  }
}
