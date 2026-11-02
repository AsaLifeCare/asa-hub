// PASSWORD RESET — the public page the forgot-password e-mail opens — the e-mail carries a link where the new…
// PUBLIC BY DESIGN, like RegisterPage: it authenticates by the single-use token in its own URL, never by a session…
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import AsaLogo from '@/components/shared/AsaLogo'
import SiteFooter from '@/components/shared/SiteFooter'

type Ctx = { email: string }

function tokenFromUrl(): string {
  // HashRouter: the query lives INSIDE the fragment (#/reset?t=…).
  const hash = window.location.hash || ''
  const q = hash.indexOf('?')
  if (q === -1) return ''
  return new URLSearchParams(hash.slice(q + 1)).get('t') ?? ''
}

export default function ResetPage() {
  const navigate = useNavigate()
  const [token] = useState(tokenFromUrl)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) { setError('This link is incomplete. Use Forgot password on the sign-in page — it sends a temporary password.'); setLoading(false); return }
    let alive = true
    void gasAction<Ctx>('authResetContext', { t: token })
      .then((r) => { if (alive) setCtx(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'This link could not be read.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  const submit = async () => {
    if (pw.length < 8) { setError('Your password needs at least 8 characters.'); return }
    if (pw !== pw2) { setError('The two passwords do not match.'); return }
    setError(''); setSaving(true)
    try {
      await gasAction('authResetSubmit', { t: token, password: pw })
      // the link is dead from this moment — the sign-in with the new password is the only door left, which is…
      setDone(true)
      window.setTimeout(() => navigate('/login', { replace: true }), 1400)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The password could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  // the page owns its scroll (body overflow is hidden for the app shell), so a tall card is never clipped and the…
  return (
    <div className="flex h-dvh flex-col items-center overflow-y-auto bg-bg px-4">
      <div className="my-auto w-full max-w-[420px] py-10">
        <div className="mb-6 flex justify-center"><AsaLogo /></div>

        <div className="rounded-[18px] border border-border bg-surface p-6 shadow-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-text-3">
              <Loader2 size={15} className="animate-spin" /> Reading your link…
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 size={28} className="text-tint-fg-mint" />
              <p className="text-[15px] font-semibold text-text-1">Password saved</p>
              <p className="text-[13px] text-text-3">The link is now used up. Taking you to sign in…</p>
            </div>
          ) : !ctx ? (
            <div className="py-4 text-center">
              <p className="mb-1 text-[15px] font-semibold text-text-1">This link cannot be opened</p>
              <p className="text-[13px] text-text-3">{error || 'It was already used or it expired. Use Forgot password on the sign-in page — it sends a temporary password.'}</p>
            </div>
          ) : (
            <>
              <h1 className="text-[19px] font-semibold text-text-1">Choose a new password</h1>
              <p className="mb-5 mt-1 text-[13px] text-text-3">
                For <span className="font-medium text-text-2">{ctx.email}</span>. The link works once —
                the moment you save, it dies and your new password is the only key.
              </p>

              <label className="mb-1 block text-[12px] font-semibold text-text-2">New password</label>
              <input
                type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder="at least 8 characters" autoComplete="new-password"
                className="mb-3 h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-text-1 outline-none focus:border-primary"
              />
              <label className="mb-1 block text-[12px] font-semibold text-text-2">Repeat it</label>
              <input
                type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
                className="mb-4 h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-text-1 outline-none focus:border-primary"
              />

              {error && <p className="mb-3 text-[12.5px] font-medium text-danger">{error}</p>}

              <button
                type="button" onClick={() => void submit()} disabled={saving}
                className="h-10 w-full rounded-[10px] bg-primary text-[14px] font-semibold text-white transition-opacity disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save the new password'}
              </button>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
