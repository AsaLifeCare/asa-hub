/** Individual widgets (existing kinds, tint-aware): events / list / feed / actions (moved verbatim from DashboardTemplate.tsx). */
import { useNavigate } from 'react-router'
import { format, formatDistanceToNow } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { motion } from 'framer-motion'
import { staggerItem } from '@/engine/motion'
import Card, { CardHeader } from '@/components/shared/Card'
import TintTile from '@/components/shared/TintTile'
import { AvatarStack } from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { peopleByIds } from '@/lib/people-lookup'
import { cn } from '@/lib/utils'
import type { ActivityItem, TintName } from '@/engine/types'

export function EventsWidget({ w, tint }: { w: any; tint?: TintName }) {
  const navigate = useNavigate()
  return (
    <Card hover className="h-full" tint={tint}>
      {/* Today's date is the COMPANY's today — the
          events under it are Ohio shifts, not the reader's evening. */}
      <CardHeader title={`${w._title} · ${format(ohioWall(new Date()) as Date, 'EEE d')}`} />
      <div className="space-y-1">
        {(w.events ?? []).map((e: any, i: number) => (
          <motion.button
            key={i}
            variants={staggerItem}
            onClick={() => navigate('/app/schedule/week')}
            className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-2"
          >
            <span className="w-11 shrink-0 text-[12px] font-medium tabular-nums text-text-3">{e.time}</span>
            <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: TINT_VAR[e.tint as TintName] }} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">{e.title}</span>
            {/* every attendee face is its own drag source — AvatarStack wraps them */}
            {e.attendees && <AvatarStack people={peopleByIds(e.attendees)} max={3} />}
          </motion.button>
        ))}
      </div>
    </Card>
  )
}

export function ListWidget({ w, tint }: { w: any; tint?: TintName }) {
  const navigate = useNavigate()
  return (
    <Card hover className="h-full" tint={tint}>
      <CardHeader title={w._title} />
      {/* An empty list must say WHY it is empty — "Loading…" and "nothing
          today" look identical otherwise, and a reader takes the second
          one as the answer. */}
      {(w.items ?? []).length === 0 && w.empty && (
        <p className="px-2 py-1 text-[13px] text-text-2">{w.empty}</p>
      )}
      <div className="space-y-1">
        {(w.items ?? []).map((it: any, i: number) => (
          <motion.button
            key={i}
            variants={staggerItem}
            onClick={() => it.href && navigate(it.href)}
            className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-2"
          >
            {it.avatar ? (
              <AvatarStack people={[it.avatar]} max={1} size="sm" />
            ) : (
              <TintTile icon={it.icon ?? 'file'} tint={(it.tint ?? 'mint') as TintName} size="sm" />
            )}
            <span className="min-w-0 flex-1">
              {/* A row WITH an avatar is a person: the widget was configured
                  with an avatarField and its title is that person's name
                  (dashboard/utils.ts). Without one the row is a doc or a task,
                  and the title is a subject, not somebody. */}
              {it.avatar ? (
                <DragPerson name={it.avatar.name ?? ''} avatar={it.avatar.src} subtitle={it.meta} className="flex min-w-0">
                  <span className="clamp-1 block text-[13px] font-medium text-text-1">{it.title}</span>
                </DragPerson>
              ) : (
                <span className="clamp-1 block text-[13px] font-medium text-text-1">{it.title}</span>
              )}
              <span className="clamp-1 block text-[12px] text-text-3">{it.meta}</span>
            </span>
          </motion.button>
        ))}
      </div>
      {w.viewAllHref && (
        <button onClick={() => navigate(w.viewAllHref)} className="mt-2 px-2 text-[13px] font-medium text-primary hover:text-primary-hover">
          View all →
        </button>
      )}
    </Card>
  )
}

export function FeedWidget({ w, data, tint }: { w: any; data: ActivityItem[]; tint?: TintName }) {
  return (
    <Card hover className="h-full" tint={tint}>
      <CardHeader title={w._title} />
      <div className="relative space-y-4 pl-4">
        <span className="absolute bottom-2 left-[3px] top-2 w-[2px] rounded bg-surface-3" />
        {data.slice(0, 6).map((a) => (
          <motion.div key={a.id} variants={staggerItem} className="relative">
            <span
              className="absolute -left-4 top-1.5 h-2 w-2 rounded-full border-2 border-surface"
              style={{ background: TINT_VAR[a.tint] }}
            />
            <p className="text-[13px] leading-5 text-text-2">
              <DragPerson name={a.actorName} id={a.actorId} className="font-semibold text-text-1">
                {a.actorName}
              </DragPerson>{' '}
              {a.action}
            </p>
            <p className="text-[12px] text-text-3">{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</p>
          </motion.div>
        ))}
      </div>
    </Card>
  )
}

export function ActionsWidget({ w, tint }: { w: any; tint?: TintName }) {
  const navigate = useNavigate()
  return (
    <Card className="h-full" tint={tint}>
      <CardHeader title={w._title} />
      <div className="space-y-2">
        {(w.actions ?? []).map((a: any) => (
          <button
            key={a.label}
            onClick={() => a.href && navigate(a.href)}
            className={cn(
              'group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-all duration-150',
              TINT_BG[a.tint as TintName],
            )}
          >
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-surface/60 transition-transform duration-150 group-hover:translate-x-[3px]">
              <AppIcon name={a.icon} size={15} className={TINT_FG[a.tint as TintName]} />
            </span>
            <span className={cn('text-[13px] font-semibold', TINT_FG[a.tint as TintName])}>{a.label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
