// Family Home — the portal's front door (kill list 9: the intranet blocker).
// A mother signs in and reads HER family member's care instructions in words a person uses at the kitchen table…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Apple,
  CalendarDays,
  HeartHandshake,
  Link2,
  MessagesSquare,
  Pill,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Sun,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import { api } from '@/lib/api'
import { useAuthStore } from '@/auth/useAuthStore'
import { type ClientRow, longDay } from '@/pages/features/clients/shared'
import { TINT_BG, TINT_FG, type ExtendedTintName } from '@/lib/tints'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------ the sections, in plain language…

// The five care categories the plans carry, re-titled for the people the plans are about.
const CARE_SECTIONS: { key: keyof ClientRow; title: string; icon: typeof Sun; tint: ExtendedTintName }[] = [
  { key: 'care_daily_living', title: 'Daily routine', icon: Sun, tint: 'amber' },
  { key: 'care_safety', title: 'Staying safe', icon: ShieldCheck, tint: 'mint' },
  { key: 'care_communication', title: 'How we communicate', icon: MessagesSquare, tint: 'blue' },
  { key: 'care_behavioral', title: 'Behavior support', icon: HeartHandshake, tint: 'lavender' },
  { key: 'care_nutrition', title: 'Food & nutrition', icon: Apple, tint: 'peach' },
]

// ------------------------------------------------------------------ pieces…

/** Body prose, with the plan's own blank lines kept as paragraph breaks. */
function Prose({ value }: { value?: string }) {
  const v = String(value ?? '').trim()
  if (!v) return null
  return (
    <div className="space-y-3">
      {v.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="whitespace-pre-line text-[14px] leading-6 text-text-2">{para.trim()}</p>
      ))}
    </div>
  )
}

// The quiet admission: the plan says nothing here.
function Absent({ name }: { name: string }) {
  return (
    <p className="text-[13.5px] leading-5 text-text-3">
      Nothing about this is written in {name}&apos;s service plan yet — the office can always tell you more.
    </p>
  )
}

function SectionCard({
  title,
  icon: Icon,
  tint,
  children,
}: {
  title: string
  icon: typeof Sun
  tint: ExtendedTintName
  children: React.ReactNode
}) {
  return (
    <Card className="space-y-3">
      <p className="flex items-center gap-2.5 text-[15px] font-semibold text-text-1">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', TINT_BG[tint], TINT_FG[tint])}>
          <Icon size={16} />
        </span>
        {title}
      </p>
      {children}
    </Card>
  )
}

/** One centred, worded answer — the three "nothing to draw" states share it. */
function WordedCard({ icon: Icon, title, body }: { icon: typeof Sun; title: string; body: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[560px] pt-10">
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
          <Icon size={22} />
        </span>
        <h2 className="font-display text-[17px] font-bold text-text-1">{title}</h2>
        <p className="max-w-[420px] text-[13px] leading-5 text-text-2">{body}</p>
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ updates — the family collection of the care…

type CareDocRow = {
  id?: string
  title?: string
  excerpt?: string
  collection?: string
  updatedAt?: string
}

// The office's letters home.
function UpdatesSection() {
  const [rows, setRows] = useState<CareDocRow[] | null>(null)

  useEffect(() => {
    let alive = true
    api
      .list<CareDocRow>('careDocs')
      .then((r) => { if (alive) setRows(r ?? []) })
      .catch(() => { if (alive) setRows(null) })
    return () => { alive = false }
  }, [])

  const mine = useMemo(
    () =>
      (rows ?? [])
        .filter((d) => String(d.collection ?? '') === 'family')
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
        .slice(0, 3),
    [rows],
  )
  if (!mine.length) return null

  return (
    <Card className="space-y-3">
      <p className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold text-text-1">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue">
            <CalendarDays size={16} />
          </span>
          Updates from the house
        </span>
        <Link to="/app/family/updates" className="text-[13px] font-semibold text-primary hover:underline">
          All updates
        </Link>
      </p>
      <div className="divide-y divide-border">
        {mine.map((d, i) => (
          <div key={String(d.id ?? i)} className="py-2.5 first:pt-0 last:pb-0">
            <p className="text-[14px] font-semibold text-text-1">{d.title || 'Update'}</p>
            {d.updatedAt ? <p className="mt-0.5 text-[12.5px] text-text-3">{longDay(d.updatedAt)}</p> : null}
            {d.excerpt ? <p className="mt-1 text-[13px] leading-5 text-text-2">{d.excerpt}</p> : null}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ the page…

export default function FamilyHomePage() {
  const user = useAuthStore((s) => s.user)
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await api.list<ClientRow>('clients'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The record could not be read.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // THE KEY PICKS THE ROW.
  const clientKey = String(user?.clientKey ?? '').trim()
  const client = useMemo(
    () => (clientKey ? rows.find((r) => String(r.client_key ?? '').trim() === clientKey) ?? null : null),
    [rows, clientKey],
  )

  // A staff account has no business here — the audience and the badge matrix refuse it before this renders; if one…
  if (user && user.role !== 'client') {
    return (
      <WordedCard
        icon={ShieldAlert}
        title="The Family app is for family accounts"
        body={
          <>
            You are signed in as staff, so this page has nothing to show you — the same care instructions live on the
            person&apos;s chart in{' '}
            <Link to="/app/clients/record" className="font-semibold text-primary hover:underline">
              Client Care → Record
            </Link>
            .
          </>
        }
      />
    )
  }

  if (loading && !rows.length) return <p className="text-[14px] text-text-3">Loading…</p>

  if (error && !rows.length) {
    return (
      <div className="space-y-3">
        <WordedCard icon={ShieldAlert} title="We couldn't read the record" body={error} />
        <div className="text-center">
          <button
            onClick={() => void load()}
            className="rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-text-2 hover:bg-surface-2"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  // NO KEY, NO PERSON — and never a guess.
  if (!clientKey) {
    return (
      <WordedCard
        icon={Link2}
        title="Your account isn't linked to a family member yet"
        body="Ask the office and we will connect your sign-in to your family member's record. Until then this page
          shows nothing — showing the wrong person's care is the one mistake this screen is never allowed to make."
      />
    )
  }

  if (!client) {
    return (
      <WordedCard
        icon={Link2}
        title="We can't find the record this account points to"
        body="Your account is linked, but no service plan on file carries that link. The office can sort this out in
          a minute — nothing is wrong on your side."
      />
    )
  }

  const firstName = String(user?.name ?? '').trim().split(/\s+/)[0] || 'there'

  return (
    <div className="space-y-4">
      {/* the person this is all about */}
      <Card className="flex flex-wrap items-center gap-4">
        <Avatar src={client.avatar ?? ''} name={client.name} size="lg" ring eager />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] text-text-3">Hello, {firstName} — this is</p>
          <h1 className="truncate font-display text-[26px] font-bold leading-8 text-text-1">{client.name}</h1>
          <p className="truncate text-[13.5px] text-text-3">
            {client.supervisionShort || 'Supervision not recorded'}
          </p>
        </div>
      </Card>

      {client.summary ? (
        <SectionCard title={`About ${client.name.split(/\s+/)[0]}`} icon={HeartHandshake} tint="pink">
          <Prose value={client.summary} />
        </SectionCard>
      ) : null}

      {CARE_SECTIONS.map((s) => {
        const value = String(client[s.key] ?? '').trim()
        return (
          <SectionCard key={s.key as string} title={s.title} icon={s.icon} tint={s.tint}>
            {value ? <Prose value={value} /> : <Absent name={client.name.split(/\s+/)[0]} />}
          </SectionCard>
        )
      })}

      <SectionCard title="Health — allergies & diagnoses" icon={Stethoscope} tint="pink">
        {client.allergies_text || client.diagnoses_text ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-[13px] font-semibold text-text-2">Allergies</p>
              {client.allergies_text ? <Prose value={client.allergies_text} /> : <Absent name={client.name.split(/\s+/)[0]} />}
            </div>
            <div>
              <p className="mb-1 text-[13px] font-semibold text-text-2">Core diagnoses</p>
              {client.diagnoses_text ? <Prose value={client.diagnoses_text} /> : <Absent name={client.name.split(/\s+/)[0]} />}
            </div>
          </div>
        ) : (
          <Absent name={client.name.split(/\s+/)[0]} />
        )}
      </SectionCard>

      <SectionCard title="Medications" icon={Pill} tint="blue">
        {client.medications_text ? <Prose value={client.medications_text} /> : <Absent name={client.name.split(/\s+/)[0]} />}
      </SectionCard>

      {/* The three sections the old portal listed that no ISP column holds
          (ClientRecordPage measures the same absence): admitted as a note,
          never drawn as blank panes. */}
      <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-5 text-text-3">
        Only what the service plan covers is shown. A general routine, community involvement and finances are not part
        of a service plan and are held nowhere this platform can read — the office can always answer those directly.
      </p>

      <UpdatesSection />
    </div>
  )
}
