// THE CONTACT PANEL of My Info — one more e-mail or phone on the signed-in account, at the standard width, never a…
// It writes through profileUpdate, the account's own door, so sign-in reads the new e-mail at once.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { gasAction } from '@/features/hiring/shared'
import { mapBackendUser, useAuthStore, type BackendUser } from '@/auth/useAuthStore'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { toast } from '@/stores/useToastStore'
import {
  CONTACT_TITLE, CONTACT_WORDS, contactPayload, contactRefusal, emailFreeOf, emailKey, type AccountContacts, type ContactKind,
} from './contactModel'

export const CONTACT_PANEL_LABEL = 'My Info'

/** The signed-in account's e-mails and phones, as the session holds them. */
export function useAccountContacts(): AccountContacts | null {
  const u = useAuthStore((s) => s.user)
  if (!u) return null
  return { email: u.email ?? '', emails: u.emails ?? [], phone: u.phone ?? '', phones: u.phones ?? [] }
}

export default function ContactPanel({ kind, onClose }: { kind: ContactKind | null; onClose: () => void }) {
  return (
    <SidePanel open={kind !== null} onClose={onClose} label={CONTACT_PANEL_LABEL} title={kind ? CONTACT_TITLE[kind] : ''}>
      {kind && <ContactForm key={kind} kind={kind} onClose={onClose} />}
    </SidePanel>
  )
}

function ContactForm({ kind, onClose }: { kind: ContactKind; onClose: () => void }) {
  const account = useAccountContacts()
  const applyUser = useAuthStore((s) => s.applyUser)
  const [value, setValue] = useState('')
  const [tried, setTried] = useState(false)
  const [taken, setTaken] = useState('')
  const [busy, setBusy] = useState(false)
  if (!account) return null
  const refusal = contactRefusal(kind, value, account) || taken

  const save = async () => {
    setTried(true)
    if (refusal) return
    setBusy(true)
    try {
      // an e-mail another account holds signs neither in: asked of the accounts first, and an unanswered check adds nothing
      if (kind === 'email') {
        const check = emailFreeOf(await gasAction<unknown>('myProfileEmailFree', { email: emailKey(value) }))
        if (!check.free) {
          setTaken(check.why)
          return
        }
      }
      const sent = contactPayload(kind, value, account)
      const got = await gasAction<{ user?: BackendUser | null }>('profileUpdate', sent, { retry: false })
      const fresh = got?.user ? mapBackendUser(got.user) : null
      // a receipt carries no account: the lists sent are drawn until the next sign-in check reads them back
      if (fresh) applyUser({ phone: fresh.phone, phones: fresh.phones, emails: fresh.emails })
      else if (kind === 'email') applyUser({ emails: sent.emails as string[] })
      else {
        const phones = sent.phones as { label: string; number: string }[]
        applyUser({ phones, phone: phones[0]?.number ?? '' })
      }
      toast({ type: 'success', title: kind === 'email' ? 'E-mail added' : 'Phone added',
        body: kind === 'email' ? `You can now sign in with ${value.trim()} too.` : value.trim() })
      onClose()
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-contact-panel={kind}>
      <p className="text-[12.5px] leading-[1.55] text-text-2">{CONTACT_WORDS[kind]}</p>
      <Field label={kind === 'email' ? 'New e-mail' : 'New phone'} required>
        <input value={value} disabled={busy} autoFocus inputMode={kind === 'email' ? 'email' : 'tel'}
          type={kind === 'email' ? 'email' : 'tel'} maxLength={kind === 'email' ? 120 : 40}
          placeholder={kind === 'email' ? 'name@example.com' : '(555) 555-0100'} className={inputCls} data-field={kind}
          onChange={(e) => { setValue(kind === 'email' ? e.target.value.toLowerCase() : e.target.value); setTried(false); setTaken('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }} />
      </Field>
      {tried && refusal && <p role="alert" className="text-[12.5px] text-[var(--danger)]">{refusal}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} disabled={busy}
          className="inline-flex h-9 items-center rounded-full border border-border px-4 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2">
          Cancel
        </button>
        <button type="button" onClick={() => void save()} disabled={busy || !value.trim()} data-save-contact=""
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />} {kind === 'email' ? 'Add e-mail' : 'Add phone'}
        </button>
      </div>
    </div>
  )
}
