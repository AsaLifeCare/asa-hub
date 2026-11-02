// THE FORM VIEW — the drawer's second face: two views, and clicking the other one brings up the form, carrying…
// A Google-Forms-shaped, full-width reading of the SAME candidate record the slide-over shows: identity card first…
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Link2, Loader2, Phone, RotateCcw, Upload, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SiteFooter from '@/components/shared/SiteFooter'
import { AppIcon } from '@/lib/icons'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { resolve, splitBullets } from '@/engine/templates/detail/utils'
import { STATUS_META } from './utils'
import { cn } from '@/lib/utils'
import type { ChecklistItem, Stage } from './types'

/** One detail field rendered as a form question: label above, answer in a box. */
function QuestionRow({ f, rec }: { f: any; rec: any }) {
  const resolved = resolve(rec, f.value)
  let value = f.fallback != null && rec && typeof f.value === 'string' && resolved === f.value ? f.fallback : resolved
  if (f.icon === 'phone' && typeof value === 'string' && value && value !== f.fallback) {
    value = formatPhoneDisplay(value)
  }
  const href = f.hrefField && rec?.[f.hrefField] ? `${f.hrefPrefix ?? ''}${rec[f.hrefField]}` : f.href
  const bullets = f.bullets ? splitBullets(resolved) : []
  return (
    <div>
      <div className="flex items-center gap-2">
        <AppIcon name={f.icon ?? 'circle'} size={14} className="shrink-0 text-text-3" />
        <p className="text-[13px] font-semibold text-text-1">{f.label}</p>
      </div>
      {f.bullets ? (
        <ul className="mt-1.5 space-y-1 rounded-md border border-border bg-bg px-3 py-2">
          {bullets.length === 0 && <li className="text-[13px] text-text-3">—</li>}
          {bullets.map((b, i) => (
            <li key={i} className="text-[13px] leading-[1.55] text-text-1">• {b}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 rounded-md border border-border bg-bg px-3 py-2">
          {href && value ? (
            <a
              href={href}
              {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="text-[13px] font-medium text-primary hover:text-primary-hover"
            >
              {String(value)}
            </a>
          ) : (
            <span className={cn('whitespace-pre-line text-[13px]', value == null || value === '' ? 'text-text-3' : 'text-text-1')}>
              {value == null || value === '' ? '—' : String(value)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** A Forms-style card: white sheet, rounded, its own breathing room. */
function FormCard({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      {title && <h2 className="text-[15px] font-bold text-text-1">{title}</h2>}
      {hint && <p className="mt-0.5 text-[12px] text-text-3">{hint}</p>}
      <div className={cn(title || hint ? 'mt-4' : undefined)}>{children}</div>
    </section>
  )
}

export function CandidateFormView({
  rec,
  detailConfig,
  stages,
  stageId,
  items,
  owedUploads,
  owedDecisions,
  nextStage,
  moveBlocked,
  missingLabels,
  rejectItem,
  onBack,
  onShareLink,
  onDecide,
  deciding,
  onMove,
  onReject,
  onUpload,
  onPull,
  pullingTranscript,
  onScreen,
  onScorecard,
}: {
  rec: any
  detailConfig: any
  stages: Stage[]
  stageId: string
  items: ChecklistItem[]
  owedUploads: ChecklistItem[]
  owedDecisions: ChecklistItem[]
  nextStage?: Stage
  moveBlocked: boolean
  missingLabels: string
  rejectItem?: ChecklistItem
  /** The small door back to the common context — the drawer as it always was. */
  onBack: () => void
  /** Mints the personal share link and copies it — writers only. */
  onShareLink?: () => void
  onDecide?: (item: ChecklistItem, value: 'Advance' | 'Decline') => void
  /** The candidate's decision while its answer is on the way (CandidatePanel). */
  deciding?: 'Advance' | 'Decline'
  onMove?: () => void
  /** Opens the drawer's own Decline confirm dialog — one dialog, two views. */
  onReject: () => void
  onUpload: (item: ChecklistItem) => void
  onPull?: (item: ChecklistItem) => void
  pullingTranscript?: boolean
  onScreen?: () => void
  onScorecard?: () => void
}) {
  const dp = detailConfig ?? {}
  const stage = stages.find((s) => s.id === stageId)
  const name = String(resolve(rec, dp.header?.title) ?? rec?.name ?? '')
  const subtitle = dp.header?.subtitle ? String(resolve(rec, dp.header.subtitle) ?? '') : ''
  const avatarSrc = typeof dp.header?.avatar === 'string' ? (rec?.[dp.header.avatar] as string | undefined) : undefined
  const fieldSections = (dp.sections ?? []).filter((s: any) => s.kind === 'fields')
  const timelineSections = (dp.sections ?? []).filter((s: any) => s.kind === 'timeline')
  const checklistByStage = stages
    .map((s) => ({ stage: s, rows: items.filter((i) => i.stage === s.id) }))
    .filter((g) => g.rows.length > 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-x-0 bottom-0 top-[calc(68px+var(--hub-strip-h,0px))] z-40 overflow-y-auto bg-surface-2"
    >
      <div className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-5">
        {/* the small button back to the common context — and the link out */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 shadow-1 transition-colors hover:bg-bg hover:text-text-1"
          >
            <ArrowLeft size={13} />
            Back to board
          </button>
          {onShareLink && (
            <button
              onClick={onShareLink}
              title="Mint this candidate's personal link and copy it — whoever opens it sees this form and can decide."
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] font-semibold text-primary shadow-1 transition-colors hover:bg-bg"
            >
              <Link2 size={13} />
              Copy share link
            </button>
          )}
        </div>

        <div className="space-y-4">
          {/* title card — the Forms accent strip carries the brand */}
          <section className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-1">
            <div className="h-2.5 bg-primary" />
            <div className="p-5 sm:p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">ASA LifeCare · Hiring</p>
              <h1 className="mt-1 text-[22px] font-bold leading-tight text-text-1">Candidate form</h1>
              <p className="mt-1 text-[13px] leading-[1.55] text-text-3">
                Everything the pipeline knows about this candidate, top to bottom. The decisions wait at the end —
                the same options the board offers.
              </p>
              <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
                <Avatar src={avatarSrc} name={name || 'Candidate'} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-bold text-text-1">{name || '—'}</p>
                  {subtitle && <p className="truncate text-[13px] text-text-3">{subtitle}</p>}
                </div>
                {stage && (
                  <span
                    className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold', TINT_BG[stage.tint], TINT_FG[stage.tint])}
                  >
                    {stage.label}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* snapshot — the drawer's stat grid, read the same way */}
          {Array.isArray(dp.stats) && dp.stats.length > 0 && (
            <FormCard title="Snapshot">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {dp.stats.map((st: any, i: number) => {
                  const v = resolve(rec, st.value)
                  return (
                    <div key={i} className="rounded-md border border-border bg-bg px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-text-3">
                        <AppIcon name={st.icon ?? 'circle'} size={12} />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.05em]">{st.label}</span>
                      </div>
                      <p className="mt-1 truncate text-[15px] font-bold text-text-1">
                        {v == null || v === '' ? '—' : String(v)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </FormCard>
          )}

          {/* every declared detail field, as form questions */}
          {fieldSections.map((s: any, i: number) => (
            <FormCard key={i} title={s.title}>
              <div className="space-y-4">
                {(s.fields ?? []).map((f: any, j: number) => (
                  <QuestionRow key={j} f={f} rec={rec} />
                ))}
              </div>
            </FormCard>
          ))}

          {/* the evidence trail — same entries the drawer's timeline shows */}
          {timelineSections.map((s: any, i: number) => {
            const entries: any[] = (s.entriesField ? rec?.[s.entriesField] : s.entries) ?? []
            return (
              <FormCard key={i} title={s.title}>
                {entries.length === 0 ? (
                  <p className="text-[12px] text-text-3">Nothing recorded yet.</p>
                ) : (
                  <div className="relative space-y-3 pl-4">
                    <span className="absolute left-[3px] top-1 h-full w-0 border-l-2 border-dashed border-border-strong" />
                    {entries.map((e: any, j: number) => (
                      <div key={j} className="relative">
                        <span
                          className="absolute -left-4 top-1.5 h-2 w-2 rounded-full border-2 border-surface"
                          style={{ background: TINT_VAR[(e.tint as TintName) ?? 'blue'] }}
                        />
                        <p className="text-[13px] leading-5 text-text-1">{e.text}</p>
                        <p className="text-[11px] text-text-3">{e.time}</p>
                      </div>
                    ))}
                  </div>
                )}
              </FormCard>
            )
          })}

          {/* the whole document checklist, grouped by stage */}
          {items.length > 0 && (
            <FormCard title="Document checklist" hint="Every stage's items — done, pending or still owed.">
              <div className="space-y-4">
                {checklistByStage.map(({ stage: s, rows }) => (
                  <div key={s.id}>
                    <p className={cn('mb-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold', TINT_BG[s.tint], TINT_FG[s.tint])}>
                      {s.label}
                    </p>
                    <div className="divide-y divide-border rounded-md border border-border bg-bg">
                      {rows.map((i) => {
                        const meta = STATUS_META[i.status]
                        const Icon = meta.icon
                        const owedHere = i.stage === stageId && (i.status === 'pending' || i.status === 'missing')
                        return (
                          <div key={i.id} className="flex items-center gap-2.5 px-3 py-2">
                            <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full', meta.bg, meta.fg)}>
                              <Icon size={12} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-text-1">{i.label}</p>
                              <p className="text-[11px] text-text-3">
                                {meta.tooltip}
                                {i.owner ? ` · ${i.owner}` : ''}
                              </p>
                            </div>
                            {owedHere && i.id === 'transcript' && onPull ? (
                              <button
                                onClick={() => onPull(i)}
                                disabled={pullingTranscript}
                                className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50"
                              >
                                <RotateCcw size={11} />
                                {pullingTranscript ? 'Pulling…' : 'Pull'}
                              </button>
                            ) : owedHere && !/decision$/.test(i.id) && !/^interview-/.test(i.id) ? (
                              <button
                                onClick={() => onUpload(i)}
                                className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-[11.5px] font-semibold text-on-primary hover:bg-primary-hover"
                              >
                                <Upload size={11} />
                                Upload
                              </button>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </FormCard>
          )}

          {/* THE END — the same choices the drawer offers, nothing new */}
          <FormCard title="Decision" hint="The call that moves this person on — or off the board.">
            <div className="space-y-3">
              {owedDecisions.length === 0 && owedUploads.length === 0 && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
                  <CheckCircle2 size={16} className="shrink-0 text-success" />
                  <p className="text-[13px] text-text-2">All clear at this stage.</p>
                </div>
              )}
              {owedDecisions.map((i) => (
                <div key={i.id} className="rounded-md border border-border bg-bg px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-text-1">{i.label}</p>
                  {onDecide ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => onDecide(i, 'Decline')}
                        disabled={!!deciding}
                        className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md border border-border bg-surface text-[12.5px] font-semibold text-danger hover:bg-tint-pink disabled:cursor-wait disabled:opacity-50"
                      >
                        {deciding === 'Decline' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Decline
                      </button>
                      <button
                        onClick={() => onDecide(i, 'Advance')}
                        disabled={!!deciding}
                        className="flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-primary text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-wait disabled:opacity-50"
                      >
                        {deciding === 'Advance' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Accept
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11.5px] italic text-text-3">Somebody with the pen decides this one.</p>
                  )}
                </div>
              ))}
              {(onMove || onDecide || onScreen || onScorecard) && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {onScreen && onDecide && stageId === 'phone-screen' && (
                    <button
                      onClick={onScreen}
                      className="flex h-9 min-w-[130px] flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 hover:bg-surface-2 active:scale-[0.98]"
                    >
                      <Phone size={14} />
                      Screen call
                    </button>
                  )}
                  {stageId === 'interview' && onScorecard && (
                    <button
                      onClick={onScorecard}
                      className="flex h-9 min-w-[130px] flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 hover:bg-surface-2 active:scale-[0.98]"
                    >
                      <ClipboardCheck size={14} />
                      Interview scorecard
                    </button>
                  )}
                  {onDecide && rejectItem && (
                    <button
                      onClick={onReject}
                      disabled={!!deciding}
                      className="flex h-9 min-w-[110px] flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[13px] font-semibold text-danger hover:bg-tint-pink active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
                    >
                      {deciding === 'Decline' && <Loader2 size={14} className="animate-spin" />}
                      Reject
                    </button>
                  )}
                  {onMove && (
                    <button
                      disabled={moveBlocked}
                      title={
                        !nextStage
                          ? 'Already at the final stage'
                          : missingLabels
                            ? `Stage gate — missing: ${missingLabels}`
                            : undefined
                      }
                      onClick={onMove}
                      className="flex h-9 min-w-[170px] flex-[2] items-center justify-center gap-1.5 rounded-md bg-primary text-[13px] font-semibold text-on-primary hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArrowRight size={15} />
                      {nextStage ? `Move to ${nextStage.label}` : 'Final stage'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </FormCard>

          <p className="pb-2 text-center text-[11px] text-text-3">ASA LifeCare — internal hiring form</p>
          {/* this view covers the shell and its footer, so it ends with its own */}
          <SiteFooter className="pt-0" />
        </div>
      </div>
    </motion.div>
  )
}
