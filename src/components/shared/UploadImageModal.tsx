// UploadImageModal — pick an image and have it FIT the slot it is going into.
// The old "Add photo" asked for a URL, which assumes the picture is already somewhere on the internet.
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { gasAction } from '@/features/hiring/shared'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export type UploadedImage = { src: string; title: string; kind: string; fileName: string }

/** Cover-crop `file` to `ratio` (w/h) and return a JPEG data URL + base64. */
async function cropToAspect(file: File, ratio: number, maxWidth = 1400): Promise<{ dataUrl: string; base64: string }> {
  const bitmap = await createImageBitmap(file)
  const srcRatio = bitmap.width / bitmap.height
  // take the biggest centred rectangle of the source that has the target ratio
  const sw = srcRatio > ratio ? bitmap.height * ratio : bitmap.width
  const sh = srcRatio > ratio ? bitmap.height : bitmap.width / ratio
  const sx = (bitmap.width - sw) / 2
  const sy = (bitmap.height - sh) / 2
  const outW = Math.min(maxWidth, Math.round(sw))
  const outH = Math.round(outW / ratio)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable in this browser')
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) }
}

export default function UploadImageModal({
  open,
  onOpenChange,
  ratio,
  slotLabel,
  kinds,
  defaultKind,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** width / height of the tile this image will fill */
  ratio: number
  /** where it is going — becomes part of the stored name ("Houses & scenes") */
  slotLabel: string
  kinds?: { value: string; label: string }[]
  defaultKind?: string
  onUploaded: (img: UploadedImage) => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [preview, setPreview] = useState<{ dataUrl: string; base64: string; name: string } | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState(defaultKind ?? kinds?.[0]?.value ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setTitle('')
      setBusy(false)
    }
  }, [open])

  const choose = async (file?: File) => {
    if (!file) return
    if (!/^image\//.test(file.type)) {
      toast({ type: 'warning', title: 'That is not an image', body: 'Pick a JPG, PNG or WebP.' })
      return
    }
    try {
      const { dataUrl, base64 } = await cropToAspect(file, ratio)
      setPreview({ dataUrl, base64, name: file.name })
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))
    } catch (err) {
      toast({ type: 'danger', title: 'Could not read that image', body: err instanceof Error ? err.message : 'Try another file.' })
    }
  }

  const submit = async () => {
    if (!preview || busy) return
    if (useApiConfigStore.getState().driver !== 'apps-script') {
      toast({ type: 'warning', title: 'Upload needs the live backend', body: 'Switch the data source to the live backend first.' })
      return
    }
    setBusy(true)
    try {
      const named = `${slotLabel} — ${title.trim() || preview.name}`.replace(/[\\/:*?"<>|]+/g, '-')
      const res = await gasAction<{ file_url: string; file_id: string }>('libraryUpload', {
        base64: preview.base64,
        filename: `${named}.jpg`,
        mime_type: 'image/jpeg',
      })
      onUploaded({
        src: `https://drive.google.com/thumbnail?id=${res.file_id}&sz=w1400`,
        title: title.trim() || preview.name,
        kind,
        fileName: named,
      })
      onOpenChange(false)
    } catch (err) {
      toast({ type: 'danger', title: 'Upload failed', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Upload an image</DialogTitle>
          <DialogDescription>
            It is cropped to the shape of the tile it will fill, and filed under {slotLabel}.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            void choose(f)
          }}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={cn(
            'group relative w-full overflow-hidden rounded-lg border-2 border-dashed border-border bg-surface-2 transition-colors hover:border-primary/50',
          )}
          style={{ aspectRatio: String(ratio) }}
        >
          {preview ? (
            <img src={preview.dataUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center gap-1 text-text-3">
              <ImagePlus size={22} />
              <span className="text-[12px] font-semibold">Choose an image</span>
              <span className="text-[11px]">it will be cropped to this frame</span>
            </span>
          )}
        </button>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-text-2">Title</span>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Maple House — front" />
          </label>
          {kinds && kinds.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Where it belongs</span>
              <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!preview || busy}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload size={14} /> {busy ? 'Uploading…' : 'Add to the bank'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
