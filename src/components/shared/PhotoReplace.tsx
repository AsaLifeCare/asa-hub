// A PERSON'S PHOTO, REPLACED FROM THEIR PAGE — Clients, Staff, SSA, Families and both candidate apps, as Locations does
// for a house. The picture is kept on the platform's server (server/person_photos.py) and named as the record's photo by
// its app (app/photos.py): every read of that app draws it from then on. The master always; anyone else as the app's
// details edition names them.
import { useEffect, useState, type ReactNode } from 'react'
import { Camera, Check, Loader2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import SafeImg from '@/components/shared/SafeImg'
import { FileDropZone, SelectedFileCard, fileToBase64 } from '@/features/hiring/shared'
import { post } from '@/pages/features/shifts/laneFetch'
import { cn } from '@/lib/utils'

/** The server folder each app keeps its people's photos in (person_photos.APPS). */
export type PhotoFolder = 'clients' | 'staff' | 'ssa' | 'families' | 'staff-candidates' | 'client-candidates'

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
export const PHOTO_HINT = 'JPEG, PNG or WebP · up to 5 MB.'

/** Why a picked picture is not taken as the photo; '' when it is (the server reads its bytes again). */
export function photoProblem(file: { name: string; size: number; type: string }): string {
  const t = String(file.type || '').toLowerCase()
  const named = /\.(jpe?g|png|webp)$/i.test(file.name.trim())
  if (!(['image/jpeg', 'image/png', 'image/webp'].includes(t) || (!t && named))) return `Not a photo the page takes — ${PHOTO_HINT}`
  if (file.size <= 0) return 'The picture is empty.'
  if (file.size > PHOTO_MAX_BYTES) return 'The picture is larger than 5 MB.'
  return ''
}

/** What the record's app answered once the photo was named. */
export type KeptPersonPhoto = { app: string; key: string; photo: string }

/** One picture kept on the server for the record and named as its photo. */
export const keepPersonPhoto = (folder: PhotoFolder, key: string, file: { name: string; mime: string; b64: string }) =>
  post<KeptPersonPhoto>(`/hub-lanes/photos/${folder}/${encodeURIComponent(key)}`, file)

/** The photo; with `onReplace`, a press on it opens the panel that uploads another in its place. */
export function ReplaceablePhoto({ name, onReplace, round = true, children }: {
  name: string
  onReplace?: () => void
  round?: boolean
  children: ReactNode
}) {
  if (!onReplace) return <>{children}</>
  const shape = round ? 'rounded-full' : 'rounded-xl'
  return (
    <button type="button" onClick={onReplace} data-person-photo="" aria-label={`Replace ${name}'s photo`}
      title="Replace the photo" className={cn('group relative outline-none focus-visible:ring-2 focus-visible:ring-primary', shape)}>
      {children}
      <span className={cn('pointer-events-none absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100', shape)}>
        <Camera size={18} />
      </span>
    </button>
  )
}

type Phase = { at: 'idle' } | { at: 'running' } | { at: 'done' } | { at: 'failed'; why: string }

/** The side panel: the photo now, the one picked, and the press that replaces it. */
export function PhotoReplacePanel({ open, onClose, folder, recordKey, name, current, round = true, onDone }: {
  open: boolean
  onClose: () => void
  folder: PhotoFolder
  recordKey: string
  name: string
  current: string
  round?: boolean
  /** the new photo's path, once the app named it */
  onDone: (photo: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState('')
  const [preview, setPreview] = useState('')
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })
  useEffect(() => {
    if (!open) {
      setFile(null)
      setProblem('')
      setPhase({ at: 'idle' })
    }
  }, [open, recordKey])
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const pick = (f: File) => {
    const why = photoProblem({ name: f.name, size: f.size, type: f.type })
    setProblem(why)
    setFile(why ? null : f)
  }
  const replace = async () => {
    if (!file || phase.at === 'running') return
    setPhase({ at: 'running' })
    try {
      const kept = await keepPersonPhoto(folder, recordKey, { name: file.name, mime: file.type, b64: await fileToBase64(file) })
      setPhase({ at: 'done' })
      onDone(kept.photo)
    } catch (e) {
      setPhase({ at: 'failed', why: e instanceof Error && e.message ? e.message : 'The photo could not be saved just now.' })
    }
  }
  const frame = round ? 'rounded-full' : 'rounded-xl'
  return (
    <SidePanel open={open} onClose={onClose} label="Photo" title={`Replace ${name}'s photo`}>
      <div className="grid min-w-0 gap-4 pt-1" data-person-photo-panel={folder}>
        <div className="grid grid-cols-2 gap-3">
          <figure className="grid justify-items-center gap-1.5">
            <SafeImg src={current} name={name} shape={round ? 'round' : 'square'} size="h-28 w-28 text-[28px]" alt={`${name} now`} />
            <figcaption className="text-[11.5px] text-text-3">Now</figcaption>
          </figure>
          <figure className="grid justify-items-center gap-1.5">
            {preview
              ? <img src={preview} alt="The new photo" data-photo-preview="" className={cn('h-28 w-28 object-cover', frame)} />
              : <div className={cn('grid h-28 w-28 place-items-center border border-dashed border-border text-center text-[11.5px] text-text-3', frame)}>No picture chosen</div>}
            <figcaption className="text-[11.5px] text-text-3">New</figcaption>
          </figure>
        </div>
        {phase.at === 'done' ? (
          <div className="grid gap-3">
            <p className="flex items-center gap-2 rounded-md bg-tint-mint px-3 py-2 text-[12.5px] text-tint-fg-mint" data-photo-done="">
              <Check size={14} /> {name}&rsquo;s photo is replaced wherever the app shows it.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={SECONDARY}>Close</button>
            </div>
          </div>
        ) : (
          <>
            {phase.at !== 'running' && (file
              ? <SelectedFileCard file={file} onRemove={() => setFile(null)} />
              : <FileDropZone accept={PHOTO_ACCEPT} hint={PHOTO_HINT} onFile={pick} />)}
            {problem && <p className="text-[12.5px] text-danger">{problem}</p>}
            {phase.at === 'failed' && <p className="text-[12.5px] text-danger" data-photo-failed="">{phase.why}</p>}
            <p className="text-[12px] leading-5 text-text-3">
              The picture is kept on the platform&rsquo;s server and replaces {name}&rsquo;s photo wherever the app shows it.
              The photo it replaces stays on file.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
              <button type="button" onClick={onClose} className={SECONDARY}>Cancel</button>
              <button type="button" onClick={replace} disabled={!file || phase.at === 'running'} data-photo-apply=""
                className={cn(PRIMARY, 'bg-primary hover:bg-primary-hover')}>
                {phase.at === 'running' && <Loader2 size={14} className="animate-spin" />}
                {phase.at === 'failed' ? 'Try again' : 'Replace photo'}
              </button>
            </div>
          </>
        )}
      </div>
    </SidePanel>
  )
}

const SECONDARY = 'inline-flex h-10 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text-1 hover:bg-surface-2'
const PRIMARY = 'inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40'

/** The photos this page named itself, drawn at once while the app's reads catch up: record key → path. */
export function useFreshPhotos(): [Record<string, string>, (key: string, photo: string) => void] {
  const [fresh, setFresh] = useState<Record<string, string>>({})
  return [fresh, (key, photo) => setFresh((f) => ({ ...f, [key]: photo }))]
}
