// ConversationModal — read a conversation the way it happened.
// A call transcript in a table cell is 4,000 characters clipped to three words.
import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, Phone, Share2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { share } from '@/stores/useShareStore'
import { cn } from '@/lib/utils'
import { ohioDateTime } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import Skeleton from '@/components/shared/Skeleton'
import type { ResourceName } from '@/engine/types'

export type ConversationConfig = {
  titleKey?: string
  subtitleKey?: string
  bodyKey?: string
  plainKey?: string
  meKey?: string
  summaryKey?: string
  metaKeys?: string[]
  /** turn line format; defaults to "[0:00] speaker: text" */
  turnPattern?: string
  // Where the turns come from when this row does not carry them.
  presentation?: 'side' | 'modal'
  join?: {
    resource: string
    matchKey: string
    targetKey: string
    mode?: 'row' | 'rows'
    speakerKey?: string
    textKey?: string
    timeKey?: string
  }
}

export type Turn = { time?: string; speaker: string; text: string }

/** Default: `[0:00] +13305551234: what they said` */
const DEFAULT_TURN = /^\s*(?:\[([^\]]+)\]\s*)?([^:]{1,60}?)\s*:\s*(.*)$/

// Parse a speaker transcript into turns.
export function parseTurns(body: string, pattern?: string): Turn[] {
  const re = pattern ? new RegExp(pattern) : DEFAULT_TURN
  const turns: Turn[] = []
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(re)
    if (!m) {
      // an unparseable line still belongs to whoever was talking
      if (turns.length) turns[turns.length - 1].text += ` ${line}`
      else turns.push({ speaker: '', text: line })
      continue
    }
    const [, time, speaker, text] = m
    const last = turns[turns.length - 1]
    if (last && last.speaker === speaker) last.text += ` ${text}`
    else turns.push({ time, speaker: (speaker ?? '').trim(), text: (text ?? '').trim() })
  }
  return turns.filter((t) => t.text)
}

// A stamp a machine wrote, read by a person: "Apr 29, 2026, 8:35 PM" — in Ohio wall-clock whoever is reading.
function prettyWhen(v: string): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  return ohioDateTime(s) || s
}

export default function ConversationModal({
  row,
  config,
  onClose,
}: {
  row: Record<string, any>
  config: ConversationConfig
  onClose: () => void
}) {
  const [joined, setJoined] = useState<Record<string, any> | null>(null)
  const [joinedRows, setJoinedRows] = useState<Record<string, any>[]>([])
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // A summary row knows the call it summarises but not what was said.
  useEffect(() => {
    const j = config.join
    if (!j) return
    const key = String(row?.[j.matchKey] ?? '').trim()
    if (!key) {
      setNotFound(true)
      return
    }
    let alive = true
    setLoading(true)
    api
      // the screen shows the newest few; a THREAD needs all of them, so the modal asks past the screen cap rather…
      .list(j.resource as ResourceName, { limit: 5000 } as never)
      .then((rows: any[]) => {
        if (!alive) return
        const matches = rows.filter((r) => String(r?.[j.targetKey] ?? '').trim() === key)
        if (j.mode === 'rows') {
          setJoinedRows(matches)
          setNotFound(matches.length === 0)
        } else {
          setJoined(matches[0] ?? null)
          setNotFound(matches.length === 0)
        }
      })
      .catch(() => alive && setNotFound(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [row, config.join])

  const source = joined ?? row
  const turns = useMemo(() => {
    // a thread: one row per message, in the order they were sent
    const j = config.join
    if (j?.mode === 'rows' && joinedRows.length > 0) {
      return joinedRows
        .map((r) => ({
          time: j.timeKey ? String(r?.[j.timeKey] ?? '') : undefined,
          speaker: j.speakerKey ? String(r?.[j.speakerKey] ?? '') : '',
          text: String(r?.[j.textKey ?? 'Body'] ?? '').trim(),
        }))
        .filter((t) => t.text)
        .sort((a, b) => new Date(a.time ?? 0).getTime() - new Date(b.time ?? 0).getTime())
    }
    const body = config.bodyKey ? String(source?.[config.bodyKey] ?? '') : ''
    if (body.trim()) return parseTurns(body, config.turnPattern)
    const plain = config.plainKey ? String(source?.[config.plainKey] ?? '') : ''
    return plain.trim() ? [{ speaker: '', text: plain.trim() }] : []
  }, [source, joinedRows, config.join, config.bodyKey, config.plainKey, config.turnPattern])

  const me = config.meKey ? String(row?.[config.meKey] ?? '').trim() : ''
  const title = config.titleKey ? formatPhoneDisplay(String(row?.[config.titleKey] ?? '')) : 'Conversation'
  const subtitle = config.subtitleKey ? prettyWhen(String(row?.[config.subtitleKey] ?? '')) : ''
  const summary = config.summaryKey ? String(row?.[config.summaryKey] ?? '').trim() : ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const asText = [
    title,
    subtitle,
    summary && `\n${summary}`,
    '',
    ...turns.map((t) => `${t.time ? `[${t.time}] ` : ''}${formatPhoneDisplay(t.speaker)}: ${t.text}`),
  ]
    .filter(Boolean)
    .join('\n')

  const side = config.presentation !== 'modal'

  return (
    <div
      className={cn(
        'fixed inset-0 z-[70] flex bg-black/55 backdrop-blur-[2px]',
        side ? 'justify-end' : 'items-center justify-center p-3 md:p-8',
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          'flex flex-col overflow-hidden border-border bg-surface shadow-2xl',
          side
            ? 'h-full w-full animate-in slide-in-from-right border-l duration-200 sm:w-[384px]'
            : 'h-full max-h-[900px] w-full max-w-[860px] rounded-lg border',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-blue text-tint-fg-blue">
            <Phone size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="clamp-1 font-display text-[14px] font-semibold text-text-1">{title}</p>
            {subtitle && <p className="clamp-1 text-[11px] text-text-3">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => share({ title: `Conversation — ${title}`, subtitle, text: asText, icon: 'phone' })}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            <Share2 size={14} /> <span className="max-sm:hidden">Share</span>
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <X size={17} />
          </button>
        </header>

        {(config.metaKeys?.length || summary) && (
          <div className="shrink-0 space-y-2 border-b border-border bg-surface-2 px-4 py-3">
            {config.metaKeys && config.metaKeys.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {config.metaKeys.map((k) => {
                  const v = String(row?.[k] ?? '').trim()
                  if (!v) return null
                  return (
                    <span key={k} className="text-[11.5px] text-text-2">
                      <span className="text-text-3">{k}: </span>
                      <span className="font-semibold">{v}</span>
                    </span>
                  )
                })}
              </div>
            )}
            {summary && <p className="text-[12.5px] leading-[1.6] text-text-1">{summary}</p>}
          </div>
        )}

        <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {loading && (
            <>
              <Skeleton className="h-12 w-2/3 rounded-lg" />
              <Skeleton className="ml-auto h-12 w-1/2 rounded-lg" />
              <Skeleton className="h-16 w-3/4 rounded-lg" />
            </>
          )}
          {!loading && turns.length === 0 && (
            <p className="py-10 text-center text-[13px] text-text-3">
              {notFound
                ? 'No transcript was recorded for this call.'
                : 'This row carries no conversation text.'}
            </p>
          )}
          {!loading &&
            turns.map((t, i) => {
              const mine = Boolean(me) && t.speaker === me
              return (
                <div key={i} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn(side ? 'max-w-[88%]' : 'max-w-[76%]', mine && 'text-right')}>
                    {(t.speaker || t.time) && (
                      <p className="mb-0.5 px-1 text-[10.5px] text-text-3">
                        {t.speaker && <span className="font-semibold">{formatPhoneDisplay(t.speaker)}</span>}
                        {t.speaker && t.time && ' · '}
                        {t.time}
                      </p>
                    )}
                    <p
                      className={cn(
                        'inline-block rounded-lg px-3 py-2 text-left text-[13px] leading-[1.55]',
                        mine ? 'bg-primary text-on-primary' : 'bg-surface-2 text-text-1',
                      )}
                    >
                      {t.text}
                    </p>
                  </div>
                </div>
              )
            })}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2 text-[11.5px] text-text-3">
          <MessageSquare size={12} />
          {turns.length > 0
            ? `${turns.length} exchange${turns.length === 1 ? '' : 's'} — consecutive lines from one speaker are read together`
            : 'Nothing recorded'}
        </footer>
      </div>
    </div>
  )
}
