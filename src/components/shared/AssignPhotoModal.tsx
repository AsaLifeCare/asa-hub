// "Assign photo to…" modal (Image Bank).
// Searchable picker across one or more person-like resources (staff + clients); picking a target writes the photo…
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import SafeImg, { tintForName } from '@/components/shared/SafeImg'
import SearchInput from '@/components/shared/SearchInput'
import { AppIcon } from '@/lib/icons'
import { api } from '@/lib/api'
import { useCan } from '@/auth/permissions'
import type { Permission } from '@/auth/types'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export type AssignTarget = {
  resource: string
  label: string
  nameKey?: string // default 'name'
  subtitleKey?: string
  avatarKey?: string // record key receiving the photo src — default 'avatar'
}

export type AssignSpec = {
  perm: Permission
  targets: AssignTarget[]
}

type Candidate = {
  id: string
  name: string
  subtitle?: string
  avatar?: string
  target: AssignTarget
}

export default function AssignPhotoModal({
  open,
  onOpenChange,
  photo,
  spec,
  onAssigned,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  photo: any // { id, title, src, assignedTo }
  spec: AssignSpec
  onAssigned?: (patch: { assignedTo: string | null }) => void
}) {
  const allowed = useCan(spec.perm)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState<Candidate[]>([])

  useEffect(() => {
    if (!open) return
    setQ('')
    setLoading(true)
    Promise.all(
      spec.targets.map(async (t) => {
        try {
          const rows = await api.list(t.resource)
          return rows.map(
            (r: any): Candidate => ({
              id: String(r.id),
              name: String(r[t.nameKey ?? 'name'] ?? r.id),
              subtitle: t.subtitleKey ? String(r[t.subtitleKey] ?? '') : undefined,
              avatar: r.avatar,
              target: t,
            }),
          )
        } catch {
          return []
        }
      }),
    )
      .then((lists) => setPeople(lists.flat()))
      .finally(() => setLoading(false))
  }, [open, spec.targets])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return people
    return people.filter((p) => `${p.name} ${p.subtitle ?? ''} ${p.target.label}`.toLowerCase().includes(needle))
  }, [people, q])

  const assign = async (p: Candidate) => {
    if (!allowed) {
      toast({ type: 'warning', title: 'Not allowed', body: `Requires ${spec.perm} — ask an admin.` })
      return
    }
    setBusy(true)
    try {
      await api.update(p.target.resource, p.id, { [p.target.avatarKey ?? 'avatar']: photo.src })
      await api.update('photos', String(photo.id), { assignedTo: p.name })
      onAssigned?.({ assignedTo: p.name })
      toast({ type: 'success', title: `Photo assigned to ${p.name}`, body: `${photo.title ?? 'Photo'} is now ${p.name}'s profile picture.` })
      onOpenChange(false)
    } catch {
      toast({ type: 'danger', title: 'Could not assign photo', body: 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const unassign = async () => {
    if (!allowed) {
      toast({ type: 'warning', title: 'Not allowed', body: `Requires ${spec.perm} — ask an admin.` })
      return
    }
    setBusy(true)
    try {
      await api.update('photos', String(photo.id), { assignedTo: null })
      onAssigned?.({ assignedTo: null })
      toast({ type: 'success', title: 'Photo unassigned', body: `${photo.title ?? 'Photo'} is back in the bank.` })
      onOpenChange(false)
    } catch {
      toast({ type: 'danger', title: 'Could not unassign photo', body: 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">Assign photo to…</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Set this photo as the profile picture of a staff member or client.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
          <SafeImg
            src={photo?.src}
            icon="image"
            tint={tintForName(String(photo?.title ?? 'photo'))}
            shape="square"
            size={48}
            className="rounded-sm border border-border"
          />
          <div className="min-w-0">
            <div className="clamp-1 text-[13px] font-semibold text-text-1">{photo?.title ?? 'Photo'}</div>
            <div className="clamp-1 text-[12px] text-text-3">
              {/* `assignedTo` holds the person's NAME (assign() writes p.name),
                  so it is a face for the tracker — the sentence around it is
                  not, hence the split. `inline` keeps it in the clamped line. */}
              {photo?.assignedTo ? (
                <>
                  Currently assigned to{' '}
                  <DragPerson name={String(photo.assignedTo)} className="inline align-baseline">
                    {String(photo.assignedTo)}
                  </DragPerson>
                </>
              ) : (
                'Not assigned yet'
              )}
            </div>
          </div>
          {photo?.assignedTo && (
            <button
              onClick={unassign}
              disabled={busy}
              className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-3 disabled:opacity-50"
            >
              <AppIcon name="x" size={13} /> Unassign
            </button>
          )}
        </div>

        <SearchInput value={q} onChange={setQ} placeholder="Search staff or clients…" />

        <div className="scroll-thin -mx-1 max-h-[280px] space-y-0.5 overflow-y-auto px-1">
          {loading ? (
            <p className="py-6 text-center text-[13px] text-text-3">Loading people…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-text-3">No one matches “{q.trim()}”.</p>
          ) : (
            filtered.map((p) => (
              <button
                key={`${p.target.resource}-${p.id}`}
                onClick={() => assign(p)}
                disabled={busy}
                className={cn(
                  'flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50',
                )}
              >
                <Avatar src={p.avatar} name={p.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13px] font-medium text-text-1">{p.name}</span>
                  {p.subtitle && <span className="clamp-1 block text-[11px] text-text-3">{p.subtitle}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-3">
                  {p.target.label.replace(/s$/, '')}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
