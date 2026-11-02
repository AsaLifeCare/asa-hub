// REGISTRATION — the public page an invitation opens, at the end of the lane that sends invitation e-mails and…
// PUBLIC BY DESIGN, like the interview scheduler: it authenticates by the single-use HMAC token in its own URL…
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import AsaLogo from '@/components/shared/AsaLogo'
import SiteFooter from '@/components/shared/SiteFooter'

type Ctx = { name: string; email: string }

function tokenFromUrl(): string {
  // HashRouter: the query lives INSIDE the fragment (#/register?t=…), so window.location.search is empty here…
  const hash = window.location.hash || ''
  const q = hash.indexOf('?')
  if (q === -1) return ''
  return new URLSearchParams(hash.slice(q + 1)).get('t') ?? ''
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const [token] = useState(tokenFromUrl)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) { setError('This link is incomplete. Ask for a new invitation.'); setLoading(false); return }
    let alive = true
    void gasAction<Ctx>('inviteContext', { t: token })
      .then((r) => { if (!alive) return; setCtx(r); setName(r?.name ?? '') })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'This invitation could not be read.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  const submit = async () => {
    if (pw.length < 8) { setError('Your password needs at least 8 characters.'); return }
    if (pw !== pw2) { setError('The two passwords do not match.'); return }
    setError(''); setSaving(true)
    try {
      const r = await gasAction<{ token: string; user: { id: string; email: string; display_name: string; role: string } }>(
        'inviteRegister', { t: token, password: pw, display_name: name.trim() },
      )
      // Straight in: they proved who they are by holding the link and choosing the password, and a second challenge…
      if (r?.token) {
        useAuthStore.getState().adoptSession(r.token, r.user)
        setDone(true)
        window.setTimeout(() => { window.location.hash = '#/apps'; window.location.reload() }, 900)
        return
      }
      setDone(true)
      window.setTimeout(() => navigate('/login', { replace: true }), 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The account could not be created.')
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
              <Loader2 size={15} className="animate-spin" /> Reading your invitation…
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 size={28} className="text-tint-fg-mint" />
              <p className="text-[15px] font-semibold text-text-1">Your account is ready</p>
              <p className="text-[13px] text-text-3">Taking you in…</p>
            </div>
          ) : !ctx ? (
            <div className="py-4 text-center">
              <p className="mb-1 text-[15px] font-semibold text-text-1">This invitation cannot be opened</p>
              <p className="text-[13px] text-text-3">{error || 'Ask for a new one.'}</p>
            </div>
          ) : (
            <>
              <h1 className="text-[19px] font-semibold text-text-1">Create your account</h1>
              <p className="mb-5 mt-1 text-[13px] text-text-3">
                You were invited as <span className="font-medium text-text-2">{ctx.email}</span>. Choose a
                password of your own — nobody else sets one for you.
              </p>

              <label className="mb-1 block text-[12px] font-semibold text-text-2">Your name</label>
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                className="mb-3 h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-text-1 outline-none focus:border-primary"
              />

              <label className="mb-1 block text-[12px] font-semibold text-text-2">Password</label>
              <input
                type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder="at least 8 characters"
                className="mb-3 h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
              />

              <label className="mb-1 block text-[12px] font-semibold text-text-2">Repeat it</label>
              <input
                type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
                className="mb-4 h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-text-1 outline-none focus:border-primary"
              />

              {error && <p className="mb-3 text-[12.5px] text-tint-fg-pink">{error}</p>}

              <button
                onClick={() => void submit()} disabled={saving}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[14px] font-semibold text-white disabled:opacity-50"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                Create my account
              </button>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[11.5px] text-text-3">
          The link is personal to you and can be used once.
        </p>
      </div>
      <SiteFooter />
    </div>
  )
}
