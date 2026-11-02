// "My profile" side sheet — the signed-in user's own details, editable in place: name, job title, phone and avatar…
// Email and role are identity/admin facts and stay read-only here.
import { useEffect, useState } from 'react'
import { ArrowUp, Briefcase, Mail, Phone, Plus, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import SafeImg from '@/components/shared/SafeImg'
import { PhotoField } from '@/components/shared/EditRecordModal'
import { mapBackendUser, useAuthStore, type BackendUser } from '@/auth/useAuthStore'
import { HighestBadge } from '@/components/shared/RoleBadge'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { useProfileSheetStore } from '@/stores/useProfileSheetStore'
import { gasAction } from '@/features/hiring/shared'
import { currentPlaceKey } from '@/lib/placeKey'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export default function ProfileSheet() {
  const open = useProfileSheetStore((s) => s.open)
  const setOpen = useProfileSheetStore((s) => s.setOpen)
  const user = useAuthStore((s) => s.user)
  const applyUser = useAuthStore((s) => s.applyUser)
  const driver = useApiConfigStore((s) => s.driver)
  // wearing another account (Be Another): their record is shown, never edited from here
  const actingAs = useAuthStore((s) => {
    const a = s.beAnother?.acting
    return a ? (a.display_name || a.email || 'another account') : ''
  })

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  // labelled list; the first entry is the one everything else shows
  const [phones, setPhones] = useState<{ label: string; number: string }[]>([])
  // extra contact e-mails — the sign-in one is identity
  const [emails, setEmails] = useState<string[]>([])
  // Did THIS sheet session touch the list?
  const [emailsTouched, setEmailsTouched] = useState(false)
  const [avatar, setAvatar] = useState('')
  // The picker hides behind the person's own avatar — it is shown ONLY on a click on the avatar itself — except…
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  // re-prefill from the store every time the sheet opens - and when away from home, let the PLACE's own row dress…
  useEffect(() => {
    if (!open || !user) return
    const place = currentPlaceKey()
    if (place && driver === 'apps-script') {
      void gasAction<{ profile: { display_name?: string; title?: string; avatar?: string } | null }>('placeProfileGet', { place })
        .then((r) => {
          if (!r?.profile) return
          if (r.profile.display_name) setName(r.profile.display_name)
          if (r.profile.title) setTitle(r.profile.title)
          if (r.profile.avatar) { setAvatar(r.profile.avatar); setPicking(false) }
        })
        .catch(() => { /* pre-publish backend - the home profile stands */ })
    }
    setName(user.name)
    setTitle(user.title)
    setPhones(
      user.phones?.length
        ? user.phones.map((p) => ({ ...p }))
        : user.phone
          ? [{ label: 'Mobile', number: user.phone }]
          : [{ label: 'Mobile', number: '' }],
    )
    setEmails(user.emails?.length ? [...user.emails] : [])
    setEmailsTouched(false)
    setAvatar(user.avatar)
    setPicking(!user.avatar)
  }, [open, user])

  if (!user) return null

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast({ type: 'warning', title: 'Name required', body: 'Your name cannot be empty.' })
      return
    }
    const cleanPhones = phones
      .map((p) => ({ label: p.label.trim() || 'Phone', number: p.number.trim() }))
      .filter((p) => p.number)
    // A blank line is just an unfinished "Add another e-mail" and goes quietly.
    const cleanEmails = emails.map((e) => e.trim()).filter(Boolean)
    const notAddresses = cleanEmails.filter((e) => !e.includes('@'))
    if (emailsTouched && notAddresses.length) {
      toast({
        type: 'warning',
        title: 'Check the e-mail addresses',
        body: `"${notAddresses[0]}" is not an e-mail address — fix it or remove the line, then save.`,
      })
      return
    }
    const patch: {
      name: string
      title: string
      phone: string
      phones: { label: string; number: string }[]
      avatar: string
      emails?: string[]
    } = {
      name: trimmed,
      title: title.trim(),
      phone: cleanPhones[0]?.number ?? '',
      phones: cleanPhones,
      avatar: avatar.trim(),
    }
    // Untouched list → the key never travels, and the backend leaves the column exactly as whoever wrote it last…
    if (emailsTouched) patch.emails = cleanEmails
    setSaving(true)
    try {
      if (driver === 'apps-script') {
        // away from home the identity fields ride the PLACE's row; the account fields stay account-wide…
        const place = currentPlaceKey()
        const { user: bu } = await gasAction<{ user: BackendUser | null }>('profileUpdate', {
          display_name: patch.name,
          title: patch.title,
          phones: patch.phones,
          ...(emailsTouched ? { emails: patch.emails } : {}),
          avatar: patch.avatar,
          ...(place ? { place } : {}),
        })
        const fresh = bu ? mapBackendUser(bu) : null
        // in a place, the auth store keeps the HOME identity - only account fields travel back into it
        applyUser(
          fresh
            ? place
              ? { phone: fresh.phone, phones: fresh.phones, emails: fresh.emails }
              : { name: fresh.name, title: fresh.title, phone: fresh.phone, phones: fresh.phones, emails: fresh.emails, avatar: fresh.avatar }
            : place ? { phone: patch.phone, phones: patch.phones } : patch,
        )
        toast({ type: 'success', title: 'Profile saved', body: 'Your details were updated.' })
      } else {
        applyUser(patch)
        toast({ type: 'success', title: 'Profile saved', body: 'Seeded dev driver — kept in this browser only.' })
      }
      setOpen(false)
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not save your profile',
        body: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex w-full flex-col bg-surface sm:w-[384px]">
        <SheetHeader>
          <SheetTitle className="font-display">My profile</SheetTitle>
        </SheetHeader>

        <div className="scroll-thin mt-1 flex-1 space-y-5 overflow-y-auto px-4 pb-2">
          {/* identity strip — the avatar itself is the door to the picker */}
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              aria-label="Change my avatar"
              title="Change my avatar"
              className="shrink-0 rounded-full transition-transform duration-150 hover:scale-[1.04]"
            >
              <SafeImg src={avatar || null} name={name || user.name} size={64} className="border border-border" />
            </button>
            <div className="min-w-0">
              <p className="clamp-1 text-[15px] font-semibold text-text-1">{name || user.name}</p>
              <HighestBadge user={user} size="sm" className="mt-1" />
            </div>
          </div>

          {/* avatar picker — only after a click on the avatar (or when none
              is set yet); a defined avatar keeps the sheet quiet */}
          {picking && (
            <label className="grid gap-1.5">
              <span className="text-[12px] font-medium text-text-2">Avatar</span>
              <PhotoField value={avatar} onChange={setAvatar} name={name || user.name} />
            </label>
          )}

          {/* editable fields */}
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">
              Name <span className="text-danger">*</span>
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
          {/* One person, several numbers. The first is the one the rest of the
              platform shows, so it can be reordered rather than retyped. */}
          <div className="grid gap-1.5">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-2">
              <Phone size={12} className="text-text-3" /> Phone numbers
            </span>
            <div className="grid gap-2">
              {phones.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    aria-label={`Label for phone ${i + 1}`}
                    value={p.label}
                    onChange={(e) =>
                      setPhones((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Mobile"
                    list="asa-phone-labels"
                    className={cn(inputCls, 'w-[104px] shrink-0')}
                  />
                  <input
                    aria-label={`Phone number ${i + 1}`}
                    value={p.number}
                    onChange={(e) =>
                      setPhones((list) => list.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))
                    }
                    placeholder="+1 (614) 555-0100"
                    className={inputCls}
                  />
                  {i > 0 && (
                    <button
                      type="button"
                      aria-label={`Make ${p.label || 'this number'} the main one`}
                      title="Make this the main number"
                      onClick={() =>
                        setPhones((list) => [list[i], ...list.filter((_, j) => j !== i)])
                      }
                      className="grid h-9 w-8 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-primary"
                    >
                      <ArrowUp size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove phone ${i + 1}`}
                    title="Remove"
                    onClick={() => setPhones((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [{ label: 'Mobile', number: '' }]))}
                    className="grid h-9 w-8 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-danger"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <datalist id="asa-phone-labels">
              {['Mobile', 'Work', 'Home', 'On-call', 'Emergency', 'Platform', 'Other'].map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => setPhones((list) => [...list, { label: '', number: '' }])}
              disabled={phones.length >= 8}
              className="mt-0.5 flex h-8 w-fit items-center gap-1.5 rounded-sm border border-dashed border-border px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              <Plus size={13} /> Add another number
            </button>
            <span className="text-[11px] text-text-3">The first number is the one shown everywhere else.</span>
          </div>
          <label className="grid gap-1.5">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-2">
              <Briefcase size={12} className="text-text-3" /> Job title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Operations Director"
              className={inputCls}
            />
          </label>

          {/* EXTRA e-mails — it has to be possible to add more addresses:
              ways to reach the person, like the
              phone list; the sign-in address below never moves from here */}
          <div className="grid gap-1.5">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-2">
              <Mail size={12} className="text-text-3" /> Other e-mails
            </span>
            <div className="grid gap-2">
              {emails.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    aria-label={`E-mail ${i + 1}`}
                    value={e}
                    onChange={(ev) => {
                      setEmailsTouched(true)
                      setEmails((list) => list.map((x, j) => (j === i ? ev.target.value : x)))
                    }}
                    placeholder="name@example.com"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    aria-label={`Remove e-mail ${i + 1}`}
                    title="Remove"
                    onClick={() => {
                      setEmailsTouched(true)
                      setEmails((list) => list.filter((_, j) => j !== i))
                    }}
                    className="grid h-9 w-8 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-danger"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {/* An empty line is not an edit yet — the list counts as touched
                  when something is actually typed or removed, so opening the
                  sheet and clicking here changes nothing on the sheet. */}
              <button
                type="button"
                onClick={() => setEmails((list) => [...list, ''])}
                disabled={emails.length >= 8}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary disabled:opacity-40"
              >
                <Plus size={13} /> Add another e-mail
              </button>
            </div>
          </div>

          {/* read-only identity */}
          <div className="rounded-md border border-border bg-surface-2/60 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[12px] text-text-2">
              <Mail size={12} className="shrink-0 text-text-3" />
              <span className="clamp-1">{user.email}</span>
            </p>
            <p className="mt-1 text-[11px] leading-4 text-text-3">
              Sign-in e-mail — managed by an admin in Settings → Users.
            </p>
          </div>
        </div>

        {actingAs && (
          <p className="mx-4 mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-text-2">
            Read-only while acting as {actingAs} — their name, photo, phones, e-mails and password stay theirs.
          </p>
        )}
        <div className="mt-2 flex shrink-0 gap-2 border-t border-border p-4">
          <button
            onClick={() => setOpen(false)}
            className="h-9 flex-1 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || Boolean(actingAs)}
            className={cn(
              'h-9 flex-1 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]',
              (saving || actingAs) && 'opacity-50',
            )}
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
