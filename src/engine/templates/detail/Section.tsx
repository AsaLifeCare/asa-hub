/** Section dispatcher + fields/chips/map/chart/list/timeline renderers
 *  (moved verbatim from DetailTemplate.tsx; calendar/tags live in their own files). */
import { unwiredAction } from '@/engine/templates/unwired'
import { motion } from 'framer-motion'
import { MapPin } from 'lucide-react'
import { Link } from 'react-router'
import Avatar, { AvatarStack } from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { AppIcon } from '@/lib/icons'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { ohioDayYear } from '@/lib/ohio'
import { ThemedAreaChart } from '@/components/shared/charts'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { staggerItem } from '@/engine/motion'
import type { TintName } from '@/engine/types'
import { isAddressKey, openAddressInPlatform } from '@/lib/maps'
import { openAttachment, parseAttachments } from '@/lib/taskAttachments'
import { resolve, splitBullets } from './utils'
import { CalendarSection } from './CalendarSection'
import { TagsSection } from './TagsSection'

// `multiline` field — a real paragraph instead of a one-line clamp.
function ParagraphRow({ f, record }: { f: any; record: any }) {
  const value = resolve(record, f.value)
  const text = value == null ? '' : String(value).trim()
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <AppIcon name={f.icon ?? 'circle'} size={14} className="shrink-0 text-text-3" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{f.label}</span>
      </div>
      <p className="whitespace-pre-line text-[13px] leading-[1.65] text-text-1">{text || (f.fallback ?? '—')}</p>
    </div>
  )
}

// `bullets` field — one line per item for values the source stored joined with " · " (strengths, gaps, risks).
function BulletsRow({ f, record }: { f: any; record: any }) {
  const items = splitBullets(resolve(record, f.value))
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <AppIcon name={f.icon ?? 'circle'} size={14} className="shrink-0 text-text-3" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{f.label}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-text-3">{f.fallback ?? 'Nothing recorded.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-[1.55] text-text-1">
              <span
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: TINT_VAR[(f.tint as TintName) ?? 'blue'] }}
              />
              <span className="min-w-0">{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FieldRow({ f, record }: { f: any; record: any }) {
  if (f.multiline) return <ParagraphRow f={f} record={record} />
  if (f.bullets) return <BulletsRow f={f} record={record} />
  const resolved = resolve(record, f.value)
  // `fallback`: shown while the record lacks the key (e.g. phone not set yet)
  let value = f.fallback != null && record && typeof f.value === 'string' && resolved === f.value ? f.fallback : resolved
  // A field wearing the phone icon shows the "(xxx) xxx-xxxx" spelling — display only: hrefs, matching and the…
  if (f.icon === 'phone' && typeof value === 'string' && value && value !== f.fallback) {
    value = formatPhoneDisplay(value)
  }
  const href = f.hrefField && record?.[f.hrefField] ? `${f.hrefPrefix ?? ''}${record[f.hrefField]}` : f.href
  // sheet-core: address-ish fields (address/location key or label) get a map-pin ghost link that opens Google Maps…
  const addressish =
    !href &&
    typeof value === 'string' &&
    value.trim().length > 0 &&
    (isAddressKey(String(f.value ?? '')) || isAddressKey(String(f.label ?? '')))
  // A FIELD THAT CARRIES A FACE IS A PERSON (said twice over: every name, on every page, goes to the tracker).
  const personName = String((f.avatarNameKey ? record?.[f.avatarNameKey] : undefined) ?? f.avatar?.name ?? '')
  const personAvatar = f.avatarNameKey && f.avatarKey ? record?.[f.avatarKey] : f.avatar?.src
  return (
    <div className="flex items-center gap-2.5">
      <AppIcon name={f.icon ?? 'circle'} size={16} className="shrink-0 text-text-3" />
      {/**
        * `truncate`, because `w-20 shrink-0` alone reserves 80px and then lets
        * a longer label PAINT STRAIGHT THROUGH the value to its right — the
        * overlap seen on screen (`packet_missing`
        * over `to: team · sms, email`, and an email address over its own
        * session count). A fixed width that does not clip is not a column.
        * `title` keeps the full text one hover away instead of losing it.
        */}
      <span className="w-20 shrink-0 truncate text-[12px] text-text-3" title={String(f.label ?? '')}>{f.label}</span>
      <DragPerson
        name={personName}
        avatar={typeof personAvatar === 'string' ? personAvatar : undefined}
        subtitle={f.label ? String(f.label) : undefined}
        className="min-w-0 items-center gap-2.5"
      >
        {f.avatarNameKey && record?.[f.avatarNameKey] && (
          <Avatar src={f.avatarKey ? record?.[f.avatarKey] : undefined} name={String(record[f.avatarNameKey])} size="xs" />
        )}
        {f.avatar?.name && <Avatar src={f.avatar.src} name={String(f.avatar.name)} size="xs" />}
        {href ? (
          <a
            href={href}
            {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="clamp-1 text-[13px] font-medium text-primary transition-colors hover:text-primary-hover"
          >
            {value}
          </a>
        ) : (
          <span className="clamp-1 text-[13px] font-medium text-text-1">
            {value == null || value === '' ? '—' : value}
          </span>
        )}
      </DragPerson>
      {addressish && (
        <button
          type="button"
          aria-label="Open the map"
          title="Open the map — inside the platform"
          onClick={(e) => { e.stopPropagation(); openAddressInPlatform(value) }}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-primary"
        >
          <MapPin size={12} />
        </button>
      )}
    </div>
  )
}

// `chips` section — titled chip collection from a string[] record field, with per-item tint (cycled or mapped) +…
function ChipsSection({ section, record }: { section: any; record: any }) {
  const items: string[] = (section.itemsField ? record?.[section.itemsField] : section.items) ?? []
  const cycle: TintName[] = section.tints ?? ['mint', 'blue', 'lavender', 'peach', 'amber', 'pink']
  return (
    <motion.section variants={staggerItem}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{section.title}</h3>
      {items.length === 0 ? (
        <p className="text-[12px] text-text-3">{section.emptyText ?? 'None recorded.'}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it, i) => {
            const tint = (section.tintBy?.[it] ?? cycle[i % cycle.length]) as TintName
            return (
              <span
                key={it}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-4"
                style={{ background: TINT_BG_VAR[tint], color: TINT_VAR[tint] }}
              >
                {section.icon && <AppIcon name={section.icon} size={12} />}
                {it}
              </span>
            )
          })}
        </div>
      )}
    </motion.section>
  )
}

// `map` section (ops-flows, additive) — keyless Google Maps embed of a record address field (or a static `address`)…
function MapSection({ section, record }: { section: any; record: any }) {
  const address = String((section.addressField ? record?.[section.addressField] : section.address) ?? '')
  if (!address) return null
  return (
    <motion.section variants={staggerItem}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{section.title}</h3>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <iframe
          src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
          title={section.title ?? 'Map preview'}
          loading="lazy"
          className="h-[220px] w-full border-0"
        />
        <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-text-3">
          <AppIcon name="map-pin" size={11} />
          <span className="clamp-1">{address}</span>
        </div>
      </div>
    </motion.section>
  )
}

// Images and PDFs on a card — the record's attachments JSON, each row opening in the platform viewer.
function AttachmentsSection({ section, record }: { section: any; record: any }) {
  const list = parseAttachments(record?.[section.itemsField ?? 'attachments'])
  if (list.length === 0) return null
  return (
    <motion.section variants={staggerItem}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{section.title}</h3>
      <div className="space-y-1">
        {list.map((a) => (
          <button
            key={a.id || a.url}
            type="button"
            onClick={() => void openAttachment(a)}
            className="flex w-full items-center gap-2.5 rounded-sm px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2"
            title="Open in the viewer"
          >
            <AppIcon name={a.mime?.startsWith('image/') ? 'image' : 'file-text'} size={14} className="shrink-0 text-text-3" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-primary">{a.name}</span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-text-3">{ohioDayYear(a.at ?? '')}</span>
          </button>
        ))}
      </div>
    </motion.section>
  )
}

// `image` section (shifts, additive) — one photo from a record field.
function ImageSection({ section, record }: { section: any; record: any }) {
  const src = String((section.srcField ? record?.[section.srcField] : section.src) ?? '').trim()
  if (!src) return null
  const alt = String((section.altField ? record?.[section.altField] : section.alt) ?? section.title ?? 'Photo')
  return (
    <motion.section variants={staggerItem}>
      {section.title && (
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{section.title}</h3>
      )}
      <img src={src} alt={alt} className="h-[220px] w-full rounded-md border border-border object-cover" />
    </motion.section>
  )
}

export function Section({ section, record }: { section: any; record: any }) {
  if (section.kind === 'chips') return <ChipsSection section={section} record={record} />
  if (section.kind === 'image') return <ImageSection section={section} record={record} />
  if (section.kind === 'calendar') return <CalendarSection section={section} record={record} />
  if (section.kind === 'tags') return <TagsSection section={section} record={record} />
  if (section.kind === 'map') return <MapSection section={section} record={record} />
  if (section.kind === 'attachments') return <AttachmentsSection section={section} record={record} />
  const timelineEntries = section.entriesField ? (record?.[section.entriesField] ?? []) : section.entries
  // ops-flows (additive): list sections may pull items from a record field (itemsField) and plain strings are…
  const rawList = section.kind === 'list' ? (section.itemsField ? (record?.[section.itemsField] ?? []) : section.items) : []
  const listItems = (rawList as any[]).map((it) => (typeof it === 'string' ? { title: it } : it))
  return (
    <motion.section variants={staggerItem}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{section.title}</h3>
      {section.kind === 'fields' && (
        <div className="space-y-2.5">
          {section.fields.map((f: any, i: number) => (
            <FieldRow key={i} f={f} record={record} />
          ))}
        </div>
      )}
      {section.kind === 'chart' && (
        <div className="relative rounded-md border border-border bg-surface p-2">
          {section.chart.showLast && section.chart.points?.length > 0 && (
            <span className="absolute right-3 top-3 z-10 inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary-strong">
              {section.chart.points[section.chart.points.length - 1]}
              {section.chart.suffix ?? ''}
            </span>
          )}
          <ThemedAreaChart
            series={[{ name: section.title, points: section.chart.points, color: section.chart.tint }]}
            height={section.chart.height ?? 120}
          />
        </div>
      )}
      {section.kind === 'list' && (
        <div className="space-y-1">
          {listItems.length === 0 && <p className="text-[12px] text-text-3">No items.</p>}
          {listItems.map((it: any, i: number) => (
            <div key={i} className="flex items-center gap-2.5 rounded-sm px-1.5 py-1.5 transition-colors hover:bg-surface-2">
              {it.avatar ? (
                <AvatarStack people={[it.avatar]} max={1} size="xs" />
              ) : (
                it.icon && <AppIcon name={it.icon} size={14} className="text-text-3" />
              )}
              {/* `it.avatar` is what makes a list row a PERSON rather than a
                  thing (schedule/event-detail.ts builds attendees exactly so).
                  The face is already a handle — AvatarStack wraps each one —
                  but the NAME beside it was inert, and the name is what the
                  hand goes for. Icon-only rows fall through untouched. */}
              <DragPerson
                name={it.avatar ? String(it.avatar.name ?? it.title ?? '') : ''}
                avatar={it.avatar?.src}
                className="min-w-0 flex-1"
              >
                {it.href ? (
                  <Link to={it.href} className="clamp-1 flex-1 text-[13px] font-medium text-primary transition-colors hover:text-primary-hover">
                    {it.title}
                  </Link>
                ) : (
                  <span className="clamp-1 flex-1 text-[13px] font-medium text-text-1">{it.title}</span>
                )}
              </DragPerson>
              {it.meta && <span className="text-[11px] text-text-3">{it.meta}</span>}
              {it.href && <AppIcon name="arrow-up-right" size={12} className="shrink-0 text-text-3" />}
              {it.actionLabel && (
                <button
                  onClick={() => unwiredAction(it.actionLabel)}
                  className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft"
                >
                  {it.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {section.kind === 'timeline' && (
        <div className="relative space-y-3 pl-4">
          <motion.span
            initial={{ height: 0 }}
            animate={{ height: '100%' }}
            transition={{ duration: 0.4 }}
            className="absolute left-[3px] top-1 w-0 border-l-2 border-dashed border-border-strong"
          />
          {(timelineEntries ?? []).map((e: any, i: number) => (
            <div key={i} className="relative">
              <span className="absolute -left-4 top-1.5 h-2 w-2 rounded-full border-2 border-surface" style={{ background: TINT_VAR[e.tint as TintName] }} />
              <p className="text-[13px] leading-5 text-text-1">{e.text}</p>
              <p className="text-[11px] text-text-3">{e.time}</p>
            </div>
          ))}
        </div>
      )}
    </motion.section>
  )
}
