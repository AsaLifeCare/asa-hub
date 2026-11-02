// App Studio — "Edit app" modal (admin-gated), opened from an App Hub card.
// Name / tagline / icon / accent / enabled → `appUpsert` (server row; for a BUILT-IN app id this creates an…
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import TintTile from '@/components/shared/TintTile'
import { gasAction, inputCls } from '@/features/hiring/shared'
import { AccentSelect, IconGridPicker, STUDIO_ACCENTS } from '@/features/studio/StudioFields'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { toast } from '@/stores/useToastStore'
import { useCan } from '@/auth/permissions'
import type { AppManifest, TintName } from '@/engine/types'

const labelCls = 'mb-1.5 block text-[12px] font-medium text-text-2'

export default function EditAppModal({
  app,
  onClose,
}: {
  /** App being edited; null keeps the modal closed. */
  app: AppManifest | null
  onClose: () => void
}) {
  const canManage = useCan('apps.manage')
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [icon, setIcon] = useState('table')
  const [accent, setAccent] = useState<TintName>('green')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // seed the form each time a card opens the modal
  useEffect(() => {
    if (!app) return
    setName(app.name)
    setTagline(app.tagline)
    setIcon(app.icon)
    setAccent(STUDIO_ACCENTS.includes(app.accent) ? app.accent : 'green')
    setEnabled(app.enabled)
    setSaving(false)
    setError('')
  }, [app])

  if (!canManage) return null

  const save = async () => {
    if (!app) return
    setSaving(true)
    setError('')
    const patch = { name: name.trim() || app.name, tagline: tagline.trim(), icon, accent, enabled }
    try {
      await gasAction('appUpsert', { id: app.id, ...patch })
      // apply to the live registry immediately (server row persists it)
      useRegistryStore.setState((s) => ({
        apps: s.apps.map((a) => (a.id === app.id ? { ...a, ...patch } : a)),
      }))
      toast({ type: 'success', title: `${patch.name} updated`, body: 'Changes are saved for everyone.' })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the app.')
      setSaving(false)
    }
  }

  // THERE IS NO REMOVE BUTTON HERE, AND THAT IS THE POINT.
  return (
    <Dialog open={app !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden bg-surface p-0 sm:max-w-[560px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">Edit app</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Rename, restyle or hide this app — for every member of the workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-4">
            <div>
              <span className={labelCls}>Preview</span>
              <TintTile icon={icon} tint={accent} size="xl" />
            </div>
            <div className="flex-1 space-y-3">
              <label className="block">
                <span className={labelCls}>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </label>
              <label className="block">
                <span className={labelCls}>Tagline</span>
                <input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="One line for the App Hub card"
                  className={inputCls}
                />
              </label>
            </div>
          </div>
          <IconGridPicker value={icon} onChange={setIcon} />
          <div>
            <span className={labelCls}>Accent</span>
            <AccentSelect value={accent} onChange={setAccent} />
          </div>
          <label className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <span>
              <span className="block text-[13px] font-medium text-text-1">Enabled</span>
              <span className="block text-[12px] text-text-3">Disabled apps stay in the App Hub but leave the sidebar.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" />
          </label>
          {error && <p className="text-[12px] font-medium text-danger">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
