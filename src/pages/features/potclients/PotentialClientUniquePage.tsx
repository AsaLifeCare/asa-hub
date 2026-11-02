// POTENTIAL CLIENT — UNIQUE VIEW, built to resemble the clients' own UNIQUE profile.
// One referral, read the way a client's Unique profile reads: identity on the left, the substance in the middle…
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ohioDateTime, ohioWall } from '@/lib/ohio'
import { Link, useSearchParams } from 'react-router'
import {
  ArrowLeft, ArrowUpRight, Banknote, CalendarClock, HeartPulse, Loader2, Mail, MapPin,
  Megaphone, Phone, Repeat, Search, Sparkles, Stethoscope, User as UserIcon,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import PageHeader from '@/components/shared/PageHeader'
import ProfileGrid from '@/components/shared/ProfileGrid'
import { api } from '@/lib/api'
import type { FocusType } from '@/stores/useContextStore'
import { gasAction } from '@/features/hiring/shared'
import { TINT_PAIR } from '@/lib/tints'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'
import { candidateHref } from '@/pages/features/clientcandidates/candidateModel'
import { OPEN_IN_CANDIDATES, useCandidatesOpen } from '@/pages/features/clientcandidates/candidateLink'
import ReferralsHero from './ReferralsHero'
import { useReferralAnalysis } from './useReferralAnalysis'

type LeadRow = {
  id: string
  referral_id: string
  client_name: string
  client_age: string
  client_gender: string
  diagnosis: string
  frequency: string
  description: string
  postal_code: string
  phone: string
  email: string
  funding_source: string
  expiration_date: string
  ai_rating: string
  ai_notes: string
  sms_sent: string
  source: string
  scraped_at: string
  stage: string
  owner: string
  next_step: string
  notes: string
}

const STAGE_TINT: Record<string, TintName> = { new: 'blue', read: 'lavender' }

function ratingTint(r: string): TintName {
  const n = Number(r)
  if (!Number.isFinite(n) || !String(r ?? '').trim()) return 'amber'
  if (n >= 8) return 'mint'
  if (n >= 5) return 'amber'
  return 'blue'
}

/** Uppercase section label with the primary dot — the Unique pattern. */
function SectionHead({ label }: { label: string }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 border-b border-border pb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {label}
    </p>
  )
}

// label · value — an empty value says so out loud.
function Row({ label, value, href, person }: {
  label: string
  value?: string
  href?: string
  person?: { name?: string; type?: FocusType; id?: string; subtitle?: string }
}) {
  const v = String(value ?? '').trim()
  const personName = String(person?.name ?? '').trim()
  const body = v ? (
    href ? <a href={href} className="min-w-0 break-words font-medium text-primary">{v}</a>
         : <span className="min-w-0 break-words font-medium text-text-1">{v}</span>
  ) : (
    <span className="italic text-text-3">Not on file</span>
  )
  return (
    <p className="flex items-baseline gap-2 py-0.5 text-[13px] leading-5">
      <span className="w-24 shrink-0 text-text-3">{label}</span>
      {v && personName ? (
        // items-baseline overrides the wrapper's centring: this row aligns on the baseline, and a centred flex box…
        <DragPerson
          name={personName}
          id={person?.id}
          type={person?.type ?? 'client'}
          subtitle={person?.subtitle}
          className="min-w-0 items-baseline"
        >
          {body}
        </DragPerson>
      ) : (
        body
      )}
    </p>
  )
}

function Chip({ label, tint }: { label: string; tint: TintName }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold capitalize', TINT_PAIR(tint))}>
      {label}
    </span>
  )
}

/** Multiline prose block; empty is honest. */
function Prose({ text, empty }: { text?: string; empty: string }) {
  const t = String(text ?? '').trim()
  if (!t) return <p className="text-[13px] italic leading-5 text-text-3">{empty}</p>
  return (
    <div className="space-y-2">
      {t.split(/\n{2,}|\n/).filter(Boolean).map((p, i) => (
        <p key={i} className="text-[13px] leading-[1.6] text-text-2">{p}</p>
      ))}
    </div>
  )
}

function expiryBits(iso: string): { text: string; past: boolean } {
  const s = String(iso ?? '').trim()
  if (!s) return { text: '', past: false }
  // A day-only value parses at LOCAL NOON — bare new Date('yyyy-mm-dd') is UTC midnight and reads one day early in…
  const d = ohioWall(s)
  if (!d) return { text: s, past: false }
  const now = ohioWall(new Date()) as Date
  return {
    text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    past: d.getTime() < now.getTime(),
  }
}

function RailAction({ icon, title, desc, to, href }: { icon: ReactNode; title: string; desc: string; to?: string; href?: string }) {
  const body = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-text-2">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-text-1">{title}</span>
        <span className="block break-words text-[11.5px] leading-4 text-text-3">{desc}</span>
      </span>
    </>
  )
  const cls = 'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2'
  if (to) return <Link to={to} className={cls}>{body}</Link>
  return <a href={href} className={cls}>{body}</a>
}

export default function PotentialClientUniquePage() {
  const [params] = useSearchParams()
  const rid = params.get('record') ?? ''
  const [rows, setRows] = useState<LeadRow[] | null>(null)
  // A LIST THAT COULD NOT BE READ IS NOT AN EMPTY LIST.
  const [failed, setFailed] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // the ids this tab already reported open — a ref, because reporting is a side effect and the shown stage is…
  const reported = useRef<Set<string>>(new Set())
  // the header's figures: the app's one analysis, the same one Compare draws
  const referrals = useReferralAnalysis()
  // the same referral in Client Candidates, for whoever that app is open to (its master until it is released)
  const clientCandidates = useCandidatesOpen()

  useEffect(() => {
    api.list<LeadRow>('potentialClients')
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((err) => setFailed(String((err as Error)?.message ?? err ?? '') || 'The read did not answer.'))
  }, [])

  const rec = useMemo(() => (rows ?? []).find((r) => String(r.id) === rid) ?? null, [rows, rid])
  const alertWentOut = (r: LeadRow) => ['true', 'yes', '1'].includes(String(r.sms_sent ?? '').trim().toLowerCase())

  // report the open — same rules, same backend door as the pipeline drawer
  useEffect(() => {
    if (!rec) return
    if (alertWentOut(rec) && String(rec.stage ?? '').trim().toLowerCase() === 'new' && !reported.current.has(rec.id)) {
      reported.current.add(rec.id)
      void gasAction('leadOpened', { ids: [String(rec.id)] }).catch(() => { /* the 60s turnover corrects */ })
    }
  }, [rec])

  /* ---------- picker (no record chosen) ---------- */
  if (!rec) {
    const list = (rows ?? []).filter((r) => {
      const needle = q.trim().toLowerCase()
      if (!needle) return true
      return `${r.client_name} ${r.postal_code} ${r.diagnosis}`.toLowerCase().includes(needle)
    })
    return (
      <div className="w-full space-y-4 px-4 py-6 sm:px-6">
        <ReferralsHero read={referrals.read} on="unique" onRetry={referrals.retry} />
        <PageHeader
          title="Potential Clients — Unique"
          subtitle="Pick a referral to read it like a profile."
          actions={
            <Link to="/app/potential-clients/pipeline" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2">
              <ArrowLeft size={13} /> Pipeline
            </Link>
          }
        />
        <div className="relative max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search names, ZIPs or diagnoses…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
          />
        </div>
        {failed ? (
          <Card className="p-8 text-center text-[13px] text-text-3">
            The referrals could not be read, so this list is unknown — not empty. {failed}
          </Card>
        ) : rows === null ? (
          <p className="flex items-center gap-2 py-8 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the pipeline…</p>
        ) : list.length === 0 ? (
          <Card className="p-8 text-center text-[13px] italic text-text-3">No referrals match.</Card>
        ) : (
          // THE WINDOW IS THE PAGE — it was not using the whole screen, and it now expands across the page.
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {list.map((r) => (
              <Link key={r.id} to={`/app/potential-clients/unique?record=${encodeURIComponent(r.id)}`}>
                {/* WHAT SURVIVES A NARROW CARD — at that width, only the
                    initials, the name and "new"; the number goes, and comes
                    back as the card widens.

                    Four facts were competing for one row. From `xl` the grid
                    packs four and five cards across, which leaves the middle
                    column about seventy pixels: the name truncated to nothing
                    and "ZIP 44647" collided with the rating — on screen it
                    read "ZI| 9", which is not information, it is damage.

                    Widening the card was not available: the ruling above is
                    that a wide monitor earns MORE cards, never fatter ones. So
                    the card sheds instead. Packed, it keeps the three things
                    that identify and sort a lead — the round initials, the
                    name, the stage. The ZIP and the rating come back the
                    moment the grid drops to three across, and the profile
                    behind the card never stopped carrying both. */}
                <Card className="flex items-center gap-3 p-3.5 transition-shadow hover:shadow-2">
                  {/* initials AND name travel together: the lead is one person,
                      and the card's own gap-3 is reproduced on the wrapper so
                      the row does not move */}
                  <DragPerson
                    name={r.client_name}
                    id={r.id}
                    type="client"
                    subtitle={r.postal_code ? `ZIP ${r.postal_code}` : r.referral_id}
                    className="min-w-0 flex-1 gap-3"
                  >
                    <Avatar src="" name={r.client_name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-text-1">{r.client_name || '—'}</span>
                      <span className="block truncate text-[11.5px] text-text-3 xl:hidden">ZIP {r.postal_code || '—'}</span>
                    </span>
                  </DragPerson>
                  {String(r.ai_rating ?? '').trim() && (
                    <span className="shrink-0 xl:hidden">
                      <Chip label={String(r.ai_rating)} tint={ratingTint(r.ai_rating)} />
                    </span>
                  )}
                  <Chip label={r.stage || '—'} tint={STAGE_TINT[r.stage] ?? 'blue'} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  /* ---------- the profile ---------- */
  const exp = expiryBits(rec.expiration_date)
  const alertSent = alertWentOut(rec)
  // derived, like the engine's optimistic stamp: an opened, alerted lead reads `read` — the server applies its own…
  const rawStage = String(rec.stage ?? '').trim()
  const stage = alertSent && rawStage.toLowerCase() === 'new' ? 'read' : rawStage

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6">
      <ReferralsHero read={referrals.read} on="unique" record={rec} onRetry={referrals.retry} />
      <div className="flex items-center justify-between">
        <Link to="/app/potential-clients/pipeline" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-2 hover:text-text-1">
          <ArrowLeft size={14} /> Pipeline
        </Link>
        <span className="flex flex-wrap items-center justify-end gap-3">
          {clientCandidates && (
            <Link to={candidateHref(String(rec.id))} data-open-client-candidates=""
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
              {OPEN_IN_CANDIDATES} <ArrowUpRight size={13} />
            </Link>
          )}
          <Link to="/app/potential-clients/unique" className="text-[12.5px] font-semibold text-primary">All referrals</Link>
        </span>
      </div>

      <ProfileGrid
        className="gap-y-4"
        slotClassName="space-y-4"
        head={
          <Card className="p-4 text-center">
            {/* `block`, not the wrapper's default inline-flex: this card is
                text-center and a flex box would stop centring the name */}
            <DragPerson
              name={rec.client_name}
              id={rec.id}
              type="client"
              subtitle={rec.referral_id ? `Referral ${rec.referral_id}` : rec.postal_code}
              className="block"
            >
              <div className="flex justify-center">
                <Avatar src="" name={rec.client_name} size="xl" />
              </div>
              <p className="mt-2 text-[15.5px] font-bold text-text-1">{rec.client_name || '—'}</p>
            </DragPerson>
            <p className="text-[11.5px] text-text-3">{rec.referral_id ? `Referral ${rec.referral_id}` : 'No referral number'}</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <Chip label={stage || '—'} tint={STAGE_TINT[stage] ?? 'blue'} />
              {String(rec.ai_rating ?? '').trim()
                ? <Chip label={`Rated ${rec.ai_rating}`} tint={ratingTint(rec.ai_rating)} />
                : <Chip label="Not yet rated" tint="amber" />}
              {alertSent && <Chip label="Alert sent" tint="mint" />}
            </div>
          </Card>
        }
        rail={
          <>
            <Card className="p-2.5">
              <p className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-text-3">Quick actions</p>
              {rec.phone && <RailAction icon={<Phone size={15} />} title="Call them" desc={formatPhoneDisplay(rec.phone)} href={`tel:${String(rec.phone).replace(/\D/g, '')}`} />}
              {rec.email && <RailAction icon={<Mail size={15} />} title="E-mail them" desc={rec.email} href={`mailto:${rec.email}`} />}
              <RailAction icon={<UserIcon size={15} />} title="Open the pipeline" desc="Back to the table" to="/app/potential-clients/pipeline" />
            </Card>
            <Card className="p-4">
              <SectionHead label="Provenance" />
              <Row label="Source" value={rec.source} />
              <p className="flex items-baseline gap-2 py-0.5 text-[13px] leading-5">
                <span className="w-24 shrink-0 text-text-3">Scraped</span>
                <span className="font-medium text-text-1">{ohioDateTime(String(rec.scraped_at ?? '')) || <span className="italic text-text-3">Not on file</span>}</span>
              </p>
              <div className="flex items-baseline gap-2 py-0.5 text-[13px]">
                <span className="w-24 shrink-0 text-text-3">Alert</span>
                {alertSent
                  ? <span className="inline-flex items-center gap-1 font-medium text-text-1"><Megaphone size={12} className="text-text-3" /> SMS sent</span>
                  : <span className="italic text-text-3">Not sent</span>}
              </div>
              <p className="flex items-baseline gap-2 py-0.5 text-[13px]">
                <span className="w-24 shrink-0 text-text-3">Funding</span>
                {String(rec.funding_source ?? '').trim()
                  ? <span className="inline-flex items-center gap-1 font-medium text-text-1"><Banknote size={12} className="text-text-3" /> {rec.funding_source}</span>
                  : <span className="italic text-text-3">Not on file</span>}
              </p>
            </Card>
            {exp.text && (
              <Card className={cn('flex items-center gap-2.5 p-3.5', exp.past && 'border-danger/40')}>
                <CalendarClock size={16} className={exp.past ? 'text-danger' : 'text-text-3'} />
                <p className="text-[12px] leading-4 text-text-2">
                  {exp.past ? 'The referral window has closed.' : `Referral window open until ${exp.text}.`}
                </p>
              </Card>
            )}
            <p className="px-1 text-center text-[10.5px] leading-4 text-text-3">
              <MapPin size={10} className="mr-1 inline" />
              A referral card carries only what the county portal gave — no guardian, house or plan yet.
            </p>
          </>
        }
        story={
          <>
            <Card className="p-4">
              <SectionHead label="Why this rating" />
              <div className="flex items-start gap-2.5">
                <Sparkles size={15} className="mt-0.5 shrink-0 text-tint-fg-lavender" />
                <div className="min-w-0 flex-1">
                  <Prose text={rec.ai_notes} empty="Not rated yet — run Rate on Settings → Lead Scraper." />
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <SectionHead label="Care needed" />
              <div className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <Stethoscope size={15} className="mt-0.5 shrink-0 text-text-3" />
                  <div className="min-w-0 flex-1"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-3">Diagnosis</p><Prose text={rec.diagnosis} empty="Not on file" /></div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Repeat size={15} className="mt-0.5 shrink-0 text-text-3" />
                  <div className="min-w-0 flex-1"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-3">Frequency</p><Prose text={rec.frequency} empty="Not on file" /></div>
                </div>
                <div className="flex items-start gap-2.5">
                  <HeartPulse size={15} className="mt-0.5 shrink-0 text-text-3" />
                  <div className="min-w-0 flex-1"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-3">Service needed</p><Prose text={rec.description} empty="Not on file" /></div>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <SectionHead label="Follow-up" />
              <Row label="Owner" value={rec.owner} person={{ name: rec.owner, type: 'staff', subtitle: 'Referral owner' }} />
              <Row label="Next step" value={rec.next_step} />
              <div className="mt-1.5">
                <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-text-3">Notes</p>
                <Prose text={rec.notes} empty="Nothing noted yet." />
              </div>
            </Card>
          </>
        }
        details={
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
            <Card className="p-4">
              <SectionHead label="Referral details" />
              <Row label="Age" value={rec.client_age} />
              <Row label="Sex" value={rec.client_gender} />
              <Row label="ZIP" value={rec.postal_code} />
              <p className="flex items-baseline gap-2 py-0.5 text-[13px] leading-5">
                <span className="w-24 shrink-0 text-text-3">Expires</span>
                {exp.text ? (
                  <span className={cn('font-medium', exp.past ? 'text-danger' : 'text-text-1')}>
                    {exp.text}{exp.past && ' · window closed'}
                  </span>
                ) : (
                  <span className="italic text-text-3">Not on file</span>
                )}
              </p>
            </Card>
            <Card className="p-4">
              <SectionHead label="Reaching them" />
              <Row label="Phone" value={rec.phone ? formatPhoneDisplay(rec.phone) : undefined} href={rec.phone ? `tel:${String(rec.phone).replace(/\D/g, '')}` : undefined} />
              <Row label="E-mail" value={rec.email} href={rec.email ? `mailto:${rec.email}` : undefined} />
            </Card>
          </div>
        }
      />
    </div>
  )
}
