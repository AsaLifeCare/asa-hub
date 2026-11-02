import { Check, ExternalLink, Loader2, Play, TestTube2, X } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { OPEN_RED } from '@/pages/features/shifts/houseCalTypes'
import {
  previewBlock, readablyOff, runLabel, testWord, type PAction, type PreviewItem, type TestSwitch,
} from '@/lib/productionActions'
import { ActionLink } from './ActionCard'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{title}</h4>
      {children}
    </section>
  )
}

export function ModeLine({ sw, item, system }: { sw: TestSwitch | null | undefined; item: PreviewItem | null; system: string }) {
  const word = testWord(sw)
  const scriptSaysOn = !!item && item.mode === 'rehearse' && word === 'off'
  return (
    <div>
      {word === 'off' ? (
        <p className={cn('rounded-md px-3 py-2 text-[12.5px] font-semibold', OPEN_RED, 'hover:bg-[#8b0000]')}>
          Test mode is OFF — this writes to {system || 'the real system'}.
        </p>
      ) : (
        <p className="rounded-md bg-tint-lavender px-3 py-2 text-[12.5px] font-semibold text-tint-fg-lavender">
          {word === 'on' ? 'Test mode is ON' : 'Test mode could not be read, so it counts as on'} — this writes a mock row
          in CommMock and touches nothing.
        </p>
      )}
      {scriptSaysOn && (
        <p className="mt-1.5 text-[12px] text-tint-fg-amber">
          The platform still reads test mode as on, so a run now would only rehearse.
        </p>
      )}
    </div>
  )
}

export function steps(how: string): string[] {
  return String(how ?? '').split(/\.\s+(?=[A-Z])|;\s+/).map((s) => s.trim()).filter(Boolean)
}

export function PreviewBody({ action, item, loading, error, sw, busy, onRun }: {
  action: PAction
  item: PreviewItem | null
  loading: boolean
  error: string
  sw: TestSwitch | null | undefined
  busy: boolean
  onRun: () => void
}) {
  const auto = action.kind === 'automatic'
  const block = item ? previewBlock(item) : loading ? 'Reading the target…' : error || 'Preview it first.'
  const reason = !item && error ? '' : block
  const label = runLabel(sw)
  const p = (action.params_obj ?? {}) as Record<string, unknown>
  const how = steps(action.how)
  if (!auto) {
    return (
      <>
        <Section title="How">
          {how.length ? (
            <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-[1.5] text-text-2">
              {how.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          ) : (
            <p className="text-[12.5px] text-text-3">No steps are written yet — add them in Edit.</p>
          )}
        </Section>
        {action.requires && (
          <Section title="Requires"><p className="text-[12.5px] text-tint-fg-amber">{action.requires}</p></Section>
        )}
        {action.link && (
          <Section title="Where">
            <ActionLink href={action.link} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline">
              <ExternalLink size={13} /> {action.link}
            </ActionLink>
          </Section>
        )}
      </>
    )
  }
  return (
    <>
      <ModeLine sw={sw} item={item} system={action.system} />
      {loading && (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-text-2">
          <Loader2 size={14} className="animate-spin" /> Reading the target — nothing is written by a preview.
        </p>
      )}
      {error && !loading && <p className="mt-4 text-[12.5px] text-tint-fg-danger">{error}</p>}
      {item && (
        <>
          <Section title="Target">
            <p className="text-[13px] font-semibold text-text-1">{item.target || '—'}</p>
            {(item.words ?? []).map((w) => <p key={w} className="mt-1 text-[12.5px] leading-[1.5] text-text-2">{w}</p>)}
          </Section>
          {action.handler === 'banner' && typeof p.text === 'string' && (
            <Section title="The text as it will look">
              <div className="overflow-x-auto rounded-md border border-border">
                <p className="whitespace-nowrap px-3 py-2 text-[13px]"
                  style={{ background: String(p.background || '#8B0000'), color: String(p.color || '#FFFFFF'),
                           fontWeight: p.bold === false ? 400 : 700 }}>
                  {p.text}
                </p>
              </div>
            </Section>
          )}
          {(item.invariants ?? []).length > 0 && (
            <Section title="Checks">
              <ul className="space-y-1.5">
                {(item.invariants ?? []).map((c) => (
                  <li key={c.id} className="flex gap-2 text-[12.5px] leading-[1.45]">
                    {c.ok ? <Check size={14} className="mt-0.5 shrink-0 text-tint-fg-mint" />
                      : <X size={14} className="mt-0.5 shrink-0 text-tint-fg-danger" />}
                    <span className={c.ok ? 'text-text-2' : 'font-semibold text-tint-fg-danger'}>
                      <span className="mr-1 font-stat text-text-3">{c.id}</span>{c.words}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(item.problems ?? []).length > 0 && (item.invariants ?? []).length === 0 && (
            <Section title="Why it cannot run">
              {item.problems.map((w) => <p key={w} className="text-[12.5px] text-tint-fg-danger">{w}</p>)}
            </Section>
          )}
          {(item.untouched ?? []).length > 0 && (
            <Section title="Untouched">
              {(item.untouched ?? []).map((w) => <p key={w} className="mt-1 text-[12.5px] leading-[1.5] text-text-2">{w}</p>)}
            </Section>
          )}
        </>
      )}
      <div className="mt-6 border-t border-border pt-4">
        <button type="button" onClick={onRun} disabled={busy || !!block}
          className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13px] font-semibold disabled:opacity-40',
            readablyOff(sw) ? OPEN_RED : 'bg-primary text-on-primary hover:bg-primary-hover')}>
          {readablyOff(sw) ? <Play size={14} /> : <TestTube2 size={14} />} {label}
        </button>
        {reason && <p className="mt-2 text-[12px] text-text-3">{reason}</p>}
      </div>
    </>
  )
}

export default function PreviewSheet({ action, item, loading, error, sw, busy, onClose, onRun }: {
  action: PAction | null
  item: PreviewItem | null
  loading: boolean
  error: string
  sw: TestSwitch | null | undefined
  busy: boolean
  onClose: () => void
  onRun: () => void
}) {
  return (
    <Sheet open={action !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-surface p-6 sm:max-w-[384px]">
        {action && (
          <>
            <SheetHeader className="mb-3">
              <SheetTitle className="font-display text-[17px] font-bold text-text-1">
                #{action.number} {action.title}
              </SheetTitle>
              <SheetDescription className="text-[12px] text-text-3">{action.system}</SheetDescription>
            </SheetHeader>
            <PreviewBody action={action} item={item} loading={loading} error={error} sw={sw} busy={busy} onRun={onRun} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
