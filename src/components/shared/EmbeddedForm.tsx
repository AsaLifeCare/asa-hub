// THE MASK, INSIDE THE APP — the form is needed to be inserted in the middle of the code, wearing the same mask.
// `public/form.html` is the mask a stranger sees: a link, no session, one page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Paperclip, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import { gasAction, inputCls } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { cn } from '@/lib/utils'

export type EmbeddedFormField = {
  key: string
  label: string
  kind?: string
  required?: string | boolean
  help?: string
  options?: string[]
  /** the scale's anchor words, drawn at the ends as Google draws them */
  left?: string
  right?: string
  /** 'star' turns a scale into a rating */
  style?: string
  /** extensions a file question accepts, without the dot */
  accept?: string[]
}

type Definition = {
  slug: string
  title: string
  intro: string
  fields: EmbeddedFormField[]
  thank_you: string
  asks_contact: boolean
}

/** One picked file: 'up' in the air, 'ok' stored, 'err' refused. */
type Entry = {
  file_id?: string
  file_name: string
  mime_type?: string
  size_bytes?: number
  status: 'up' | 'ok' | 'err'
  error?: string
  raw?: File
  /** minted per picked file: the same key twice stores the same file once */
  upload_id: string
}

// One key per picked file.
function uploadKey(): string {
  try {
    const a = new Uint8Array(8)
    crypto.getRandomValues(a)
    return 'up_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return 'up_' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10)
  }
}

// The cap the door enforces (FORM_FILE_MAX_BYTES) — refused here too so a 20MB mistake does not travel the wire to…
const MAX_BYTES = 30 * 1024 * 1024

const isRequired = (f: EmbeddedFormField) =>
  f.required === true || String(f.required) === 'true'

// HOW MUCH ROOM AN ANSWER NEEDS — asked of the DEFINITION, never of a setting — a form has to be insertable in…
const FULL_WIDTH_KINDS = new Set(['long', 'file', 'heading'])

function spansFull(f: EmbeddedFormField): boolean {
  const kind = String(f.kind || 'text')
  if (FULL_WIDTH_KINDS.has(kind)) return true
  const opts = f.options ?? []
  if (kind === 'choice' || kind === 'multi') {
    return opts.length > 3 || opts.some((o) => String(o).length > 14)
  }
  if (kind === 'scale') return opts.length > 5 || !!(f.left || f.right)
  return false
}

function fmtSize(n?: number): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${Math.round(n / 1024)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result ?? '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

// slug + token out of whatever the caller had: the finished link the Forms screen shows, or the two parts on their…
function addressOf(url?: string, slug?: string, token?: string) {
  if (slug && token) return { slug, token }
  if (!url) return { slug: slug ?? '', token: token ?? '' }
  try {
    const u = new URL(url, window.location.origin)
    return {
      slug: slug || u.searchParams.get('f') || '',
      token: token || u.searchParams.get('t') || '',
    }
  } catch {
    return { slug: slug ?? '', token: token ?? '' }
  }
}

export type FieldBinding = {
  /** a file picked here goes to the host's door, never to the form's store */
  onFile?: (file: File) => Promise<void> | void
  /** an option chosen here performs the host's act */
  onChoose?: (value: string) => Promise<void> | void
  /** the host is working — the control says so and refuses a second press */
  busy?: boolean
  /** the host settled it; the control steps aside rather than inviting a repeat */
  done?: string
}

export default function EmbeddedForm({
  url,
  slug: slugProp,
  token: tokenProp,
  showTitle = true,
  density = 'comfortable',
  showSend = true,
  maxHeight,
  bindings,
  className,
  onFiled,
}: {
  /** the public link exactly as the Forms screen shows it */
  url?: string
  slug?: string
  token?: string
  /** false when the page around it already names the form */
  showTitle?: boolean
  // `compact` is the MINIATURE: two questions to a row where the answer is small, smaller type, no card around each…
  density?: 'comfortable' | 'compact'
  // The Send button, which a host may not want — SEND is not always needed either.
  showSend?: boolean
  // a height budget with its own scroll, so the form is a PIECE of the screen around it and never steals that…
  maxHeight?: number
  // WHAT A FIELD DOES INSTEAD OF BEING RECORDED: the OUTPUT of "As a form" must equal the output of "As items"…
  bindings?: Record<string, FieldBinding>
  className?: string
  /** runs after the answer is filed */
  onFiled?: (thankYou: string) => void
}) {
  const { slug, token } = useMemo(
    () => addressOf(url, slugProp, tokenProp), [url, slugProp, tokenProp])

  const me = useAuthStore((s) => s.user)
  const [def, setDef] = useState<Definition | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, Entry[]>>({})
  const [who, setWho] = useState({ name: '', email: '', phone: '' })
  const [loadErr, setLoadErr] = useState('')
  const [sendErr, setSendErr] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState('')
  /** the live files map, for handlers that fire while state is in flight */
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => {
    let alive = true
    setDef(null)
    setLoadErr('')
    if (!slug || !token) {
      setLoadErr('This form is missing part of its address.')
      return
    }
    void (async () => {
      try {
        const d = await gasAction<Definition>('formPublicGet', { f: slug, t: token })
        if (!alive) return
        setDef(d)
        setWho({
          name: String(me?.name ?? ''),
          email: String(me?.email ?? ''),
          phone: String(me?.phone ?? ''),
        })
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : 'This form did not open.')
      }
    })()
    return () => { alive = false }
  }, [slug, token, me?.name, me?.email, me?.phone])

  const setValue = useCallback((key: string, v: string) => {
    setValues((old) => ({ ...old, [key]: v }))
  }, [])

  /** multi keeps the mask's own shape: the picked options, comma-joined. */
  const toggleMulti = useCallback((key: string, option: string) => {
    setValues((old) => {
      const picked = (old[key] ? old[key].split(', ') : []).filter(Boolean)
      const next = picked.includes(option)
        ? picked.filter((p) => p !== option)
        : [...picked, option]
      return { ...old, [key]: next.join(', ') }
    })
  }, [])

  const patchEntry = useCallback((key: string, at: number, patch: Partial<Entry>) => {
    setFiles((old) => {
      const list = [...(old[key] ?? [])]
      if (!list[at]) return old
      list[at] = { ...list[at], ...patch }
      return { ...old, [key]: list }
    })
  }, [])

  const uploadOne = useCallback(async (key: string, at: number, raw: File,
    uploadId: string) => {
    patchEntry(key, at, { status: 'up', error: '' })
    try {
      const b64 = await fileToB64(raw)
      const store = () => gasAction<{
        file_id: string; file_url: string; file_name: string
        mime_type: string; size_bytes: number
      }>('formPublicFileStore',
        { f: slug, t: token, key, filename: raw.name, base64: b64,
          upload_id: uploadId },
        { timeoutMs: 280_000 })
      // GOOGLE'S INTERSTITIAL IS NOT A REFUSAL (seen live).
      let stored
      try {
        stored = await store()
      } catch (blip) {
        // the key makes the repeat safe, so "saved, receipt lost" is worth one more ask — it returns the handle the…
        if (!/interstitial|unreachable|confirmation was lost|try again/i.test(
          blip instanceof Error ? blip.message : '')) throw blip
        await new Promise((r) => setTimeout(r, 1200))
        stored = await store()
      }
      patchEntry(key, at, {
        status: 'ok',
        file_id: stored.file_id,
        mime_type: stored.mime_type,
        size_bytes: stored.size_bytes,
      })
    } catch (e) {
      patchEntry(key, at, {
        status: 'err',
        error: e instanceof Error ? e.message : 'That did not upload.',
      })
    }
  }, [patchEntry, slug, token])

  const take = useCallback((key: string, picked: FileList | null) => {
    const list = Array.from(picked ?? [])
    if (!list.length) return
    const start = (filesRef.current[key] ?? []).length
    const entries: Entry[] = list.map((raw) => raw.size > MAX_BYTES
      ? { file_name: raw.name, size_bytes: raw.size, status: 'err', upload_id: uploadKey(),
          error: `${fmtSize(raw.size)} — 30 MB is the ceiling per file.` }
      : { file_name: raw.name, size_bytes: raw.size, status: 'up', raw,
          upload_id: uploadKey() })
    setFiles((old) => ({ ...old, [key]: [...(old[key] ?? []), ...entries] }))
    entries.forEach((entry, n) => {
      if (entry.raw) void uploadOne(key, start + n, entry.raw, entry.upload_id)
    })
  }, [uploadOne])

  const drop = useCallback((key: string, e: React.DragEvent) => {
    e.preventDefault()
    take(key, e.dataTransfer?.files ?? null)
  }, [take])

  const uploading = useMemo(
    () => Object.values(files).some((list) => list.some((f) => f.status === 'up')),
    [files])

  const send = useCallback(async () => {
    if (!def || sending || uploading) return
    setSendErr('')
    const answers: Record<string, unknown> = {}
    const missing: string[] = []
    for (const f of def.fields) {
      if (String(f.kind) === 'heading') continue
      if (String(f.kind) === 'file') {
        const handles = (files[f.key] ?? [])
          .filter((h) => h.status === 'ok' && h.file_id)
          .map((h) => ({ file_id: h.file_id, file_name: h.file_name,
                         mime_type: h.mime_type, size_bytes: h.size_bytes }))
        if (handles.length) answers[f.key] = handles
        if (isRequired(f) && !handles.length) missing.push(f.label || f.key)
        continue
      }
      const v = (values[f.key] ?? '').trim()
      if (v) answers[f.key] = v
      if (isRequired(f) && !v) missing.push(f.label || f.key)
    }
    if (missing.length) {
      setSendErr(`Still needed: ${missing.join(', ')}.`)
      return
    }
    setSending(true)
    try {
      // AN IN-APP UPLOAD KNOWS WHO PRESSED THE BUTTON.
      const sender = def.asks_contact ? who : {
        name: String(me?.name ?? ''),
        email: String(me?.email ?? ''),
        phone: '',
      }
      const filed = await gasAction<{ filed: boolean; thank_you: string }>(
        'formPublicSubmit',
        { f: slug, t: token, answers, ...sender },
        { timeoutMs: 280_000 })
      const thanks = filed?.thank_you || 'Thank you — this has reached the team.'
      setDone(thanks)
      onFiled?.(thanks)
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'That did not send.')
    } finally {
      setSending(false)
    }
  }, [def, files, me?.email, me?.name, onFiled, sending, slug, token, uploading, values, who])

  if (loadErr) {
    return (
      <Card className={className}>
        <p className="text-[13px] font-medium text-text-1">This form is not available.</p>
        <p className="mt-1 text-[12px] text-text-3">{loadErr}</p>
      </Card>
    )
  }
  if (!def) {
    return (
      <Card className={cn('flex items-center gap-2', className)}>
        <Loader2 size={14} className="animate-spin text-text-3" />
        <span className="text-[12px] text-text-3">Opening the form…</span>
      </Card>
    )
  }
  if (done) {
    return (
      <Card className={cn('flex items-start gap-3', className)}>
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-[13px] font-semibold text-text-1">{def.title}</p>
          <p className="mt-1 text-[12px] text-text-2">{done}</p>
        </div>
      </Card>
    )
  }

  const compact = density === 'compact'
  // one place decides the size of everything, so a miniature cannot end up half-miniature the day a field kind is…
  const inp = compact
    ? 'h-8 w-full rounded-sm border border-border bg-surface px-2.5 text-[12px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
    : inputCls
  const labelCls = compact
    ? 'mb-1 block text-[11px] font-medium text-text-2'
    : 'mb-1.5 block text-[12px] font-medium text-text-2'
  const helpCls = compact
    ? 'mb-1 block text-[10.5px] text-text-3'
    : 'mb-1.5 block text-[11px] text-text-3'
  // EVERY OPTION THE SAME WIDTH — buttons of one size help a great deal.
  const chipCls = compact
    ? 'min-h-7 px-2 py-1 text-[11px] leading-tight'
    : 'min-h-8 px-3 py-1.5 text-[12px] leading-tight'
  const optionRow = compact
    ? 'grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-1.5'
    : 'grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2'

  return (
    <div
      className={cn('flex flex-col', compact ? 'gap-2' : 'gap-3',
        maxHeight ? 'scroll-thin overflow-y-auto pr-1' : '', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {showTitle && (def.title || def.intro) && (
        <div>
          {def.title && (
            <h2 className={cn('font-semibold text-text-1', compact ? 'text-[13px]' : 'text-[15px]')}>
              {def.title}
            </h2>
          )}
          {def.intro && (
            <p className={cn('mt-1 text-text-2', compact ? 'text-[11px]' : 'text-[12px]')}>{def.intro}</p>
          )}
        </div>
      )}

      {def.asks_contact && (
        <Card className={cn('grid sm:grid-cols-3', compact ? 'gap-2 py-3' : 'gap-3')}>
          <label className="block">
            <span className={labelCls}>Your name</span>
            <input className={inp} value={who.name}
              onChange={(e) => setWho((w) => ({ ...w, name: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>E-mail</span>
            <input className={inp} type="email" value={who.email}
              onChange={(e) => setWho((w) => ({ ...w, email: e.target.value }))} />
          </label>
          <label className="block">
            <span className={labelCls}>Phone</span>
            <input className={inp} type="tel" value={who.phone}
              onChange={(e) => setWho((w) => ({ ...w, phone: e.target.value }))} />
          </label>
        </Card>
      )}

      {/*
        THE GRID COUNTS ITS OWN COLUMNS. `grid-cols-2` was a lie
        the moment this went somewhere narrow: the candidate drawer is 384px
        with p-4, so 352px of content, and two columns there are 168px each —
        too little for a date, let alone a drop zone. auto-fit with a minimum
        lets the CSS decide: one column in the drawer, two on a Forms card,
        three in a wide page section, with nobody passing a number.

        Full-width kinds use col-span-full — `grid-column: 1 / -1` — and not a
        span of 2, because a span of 2 in a one-column grid creates a phantom
        second column and the whole layout shifts.
      */}
      <div className={cn(compact
        ? 'grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-2'
        : 'flex flex-col gap-3')}>
      {def.fields.map((f, i) => {
        const kind = String(f.kind || 'text')
        const key = f.key || `q_${i}`

        if (kind === 'heading') {
          // In miniature a section is a RULE with words on it, not a block: it has to divide the grid without…
          return (
            <div key={key} className={cn(compact ? 'col-span-full flex items-baseline gap-2 pt-1' : 'pt-2')}>
              {f.label && (
                <h3 className={cn('shrink-0 font-semibold text-text-1',
                  compact ? 'text-[11.5px]' : 'text-[13px]')}>{f.label}</h3>
              )}
              {f.help && (
                <p className={cn('min-w-0 text-text-3', compact ? 'truncate text-[10.5px]' : 'mt-0.5 text-[12px]')}>
                  {f.help}
                </p>
              )}
              {compact && <span className="h-px min-w-4 flex-1 bg-border" />}
            </div>
          )
        }

        // A typed question's help is the words INSIDE the box, as the mask draws it; kinds with no placeholder keep…
        const bound = bindings ? bindings[key] : undefined
        const asPlaceholder = ['text', 'long', 'number', 'email', 'phone'].includes(kind)
        const head = (
          <>
            <span className={labelCls}>
              {f.label}
              {isRequired(f) && <span className="ml-0.5 text-danger">*</span>}
            </span>
            {f.help && !asPlaceholder && <span className={helpCls}>{f.help}</span>}
          </>
        )
        const options = f.options ?? []

        let body: React.ReactNode
        if (kind === 'long') {
          body = (
            <textarea
              className={cn(inp, compact ? 'h-16 py-1.5 leading-snug' : 'h-24 py-2 leading-snug')}
              placeholder={asPlaceholder ? f.help : undefined}
              value={values[key] ?? ''}
              onChange={(e) => setValue(key, e.target.value)} />
          )
        } else if (kind === 'scale') {
          const star = String(f.style || '') === 'star'
          const picked = Number(values[key] || 0)
          body = (
            <div className="flex flex-wrap items-center gap-2">
              {f.left && <span className="text-[11px] text-text-3">{f.left}</span>}
              <div className="flex items-center gap-1">
                {options.map((o) => {
                  const on = star ? Number(o) <= picked : values[key] === o
                  return (
                    <button key={o} type="button" onClick={() => setValue(key, o)}
                      aria-pressed={values[key] === o}
                      className={cn(
                        'grid place-items-center rounded-md border transition-colors',
                        compact ? 'h-7 min-w-7 px-1.5 text-[11px]' : 'h-8 min-w-8 px-2 text-[12px]',
                        on
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
                      {star ? (on ? '★' : '☆') : o}
                    </button>
                  )
                })}
              </div>
              {f.right && <span className="text-[11px] text-text-3">{f.right}</span>}
            </div>
          )
        } else if (kind === 'choice' || kind === 'yes_no') {
          const list = kind === 'yes_no' ? ['Yes', 'No'] : options
          body = bound?.done ? (
            <p className="text-[11.5px] font-medium text-emerald-600">{bound.done}</p>
          ) : (
            <div className={optionRow}>
              {list.map((o) => (
                <button key={o} type="button"
                  disabled={!!bound?.busy}
                  onClick={() => (bound?.onChoose ? void bound.onChoose(o) : setValue(key, o))}
                  aria-pressed={values[key] === o}
                  className={cn(
                    'grid place-items-center rounded-md border text-center transition-colors', chipCls,
                    values[key] === o
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
                  {o}
                </button>
              ))}
            </div>
          )
        } else if (kind === 'multi') {
          const picked = (values[key] ? values[key].split(', ') : []).filter(Boolean)
          body = (
            <div className={optionRow}>
              {options.map((o) => (
                <button key={o} type="button" onClick={() => toggleMulti(key, o)}
                  aria-pressed={picked.includes(o)}
                  className={cn(
                    'grid place-items-center rounded-md border text-center transition-colors', chipCls,
                    picked.includes(o)
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
                  {o}
                </button>
              ))}
            </div>
          )
        } else if (kind === 'file') {
          const list = files[key] ?? []
          const accept = (f.accept ?? []).map((a) => `.${a}`).join(',')
          body = (
            <div>
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  if (!bound?.onFile) { drop(key, e); return }
                  e.preventDefault()
                  const picked = e.dataTransfer?.files
                  if (picked && picked[0]) void bound.onFile(picked[0])
                }}
                className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-md border',
                  'border-dashed border-border bg-surface-2 text-center transition-colors',
                  'hover:border-primary hover:bg-primary/5',
                  compact ? 'h-9 px-3' : 'flex-col gap-1 px-4 py-6')}>
                <Paperclip size={compact ? 13 : 16} className="shrink-0 text-text-3" />
                <span className={compact ? 'text-[11px] text-text-2' : 'text-[12px] text-text-2'}>
                  {bound?.done ? bound.done
                    : bound?.busy ? 'Filing…'
                    : compact ? 'Drop or choose a file' : 'Drop files here, or click to choose'}
                </span>
                {!compact && <span className="text-[11px] text-text-3">Up to 30 MB each</span>}
                <input type="file" multiple={!bound?.onFile} className="hidden"
                  accept={accept || undefined}
                  onChange={(e) => {
                    const picked = e.target.files
                    if (bound?.onFile) { if (picked && picked[0]) void bound.onFile(picked[0]) }
                    else take(key, picked)
                    e.target.value = ''
                  }} />
              </label>
              {list.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {list.map((h, n) => (
                    <div key={`${h.file_name}-${n}`}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px]',
                        h.status === 'err'
                          ? 'border-danger/40 bg-danger/5'
                          : 'border-border bg-surface')}>
                      {h.status === 'up' && <Loader2 size={12} className="animate-spin text-text-3" />}
                      {h.status === 'ok' && <CheckCircle2 size={12} className="text-emerald-500" />}
                      <span className="min-w-0 flex-1 truncate text-text-1">{h.file_name}</span>
                      {h.size_bytes ? (
                        <span className="shrink-0 text-[11px] text-text-3">{fmtSize(h.size_bytes)}</span>
                      ) : null}
                      {h.status === 'err' && (
                        <>
                          <span className="shrink-0 text-[11px] text-danger">{h.error}</span>
                          {h.raw && (
                            <button type="button"
                              onClick={() => { if (h.raw) void uploadOne(key, n, h.raw, h.upload_id) }}
                              className="shrink-0 rounded px-1.5 text-[11px] font-medium text-primary hover:underline">
                              Try again
                            </button>
                          )}
                        </>
                      )}
                      <button type="button" aria-label={`Remove ${h.file_name}`}
                        onClick={() => setFiles((old) => ({
                          ...old, [key]: (old[key] ?? []).filter((_, at) => at !== n),
                        }))}
                        className="shrink-0 rounded p-0.5 text-text-3 hover:text-danger">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        } else {
          const type = kind === 'number' ? 'number' : kind === 'date' ? 'date'
            : kind === 'time' ? 'time' : kind === 'email' ? 'email'
              : kind === 'phone' ? 'tel' : 'text'
          body = (
            <input className={inp} type={type}
              placeholder={asPlaceholder ? f.help : undefined}
              value={values[key] ?? ''}
              onChange={(e) => setValue(key, e.target.value)} />
          )
        }

        // COMFORTABLE keeps the card per question, which is what makes the full-page mask read like the Google…
        if (compact) {
          return (
            <label key={key} className={cn('block min-w-0', spansFull(f) ? 'col-span-full' : '')}>
              {head}{body}
            </label>
          )
        }
        return (
          <Card key={key} className="py-4">
            <label className="block">{head}{body}</label>
          </Card>
        )
      })}
      </div>

      {sendErr && <p className="text-[12px] font-medium text-danger">{sendErr}</p>}

      {showSend ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => void send()}
            disabled={sending || uploading}
            className={cn('rounded-md bg-primary font-semibold text-on-primary transition-colors',
              'hover:bg-primary-hover disabled:opacity-40',
              compact ? 'h-8 px-3 text-[12px]' : 'h-9 px-4 text-[13px]')}>
            {uploading ? 'Uploading…' : sending ? 'Sending…' : 'Send'}
          </button>
          {uploading && (
            <span className="text-[11px] text-text-3">
              Files are still uploading — Send opens when they land.
            </span>
          )}
        </div>
      ) : uploading ? (
        // The host hid Send, but a file in the air is still worth saying out loud: whatever files the answer must…
        <span className="text-[11px] text-text-3">Uploading…</span>
      ) : null}
    </div>
  )
}
