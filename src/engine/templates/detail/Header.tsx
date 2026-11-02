// Dark navy hero: avatar, title/subtitle, status chip, bookmark, icon actions.
// When the panel was opened from a row the engine recognised as a PERSON, the hero itself is a drag source for the…
import { unwiredAction } from '@/engine/templates/unwired'
import { motion } from 'framer-motion'
import Avatar from '@/components/shared/Avatar'
import BookmarkButton from '@/components/shared/BookmarkButton'
import DragPerson from '@/components/shared/DragPerson'
import type { Focus } from '@/stores/useContextStore'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { staggerItem } from '@/engine/motion'
import { composeEmail } from '@/stores/useEmailComposeStore'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'
import { resolve } from './utils'

export function Header({ header, record, focus }: { header: any; record: any; focus?: Focus }) {
  const title = resolve(record, header.title) ?? 'Detail'
  const subtitle = resolve(record, header.subtitle)
  // header.avatar: record key with a photo url, or the literal "initials" (renders the initials fallback with no…
  const avatar = header.avatar === 'initials' ? '' : resolve(record, header.avatar)
  const showAvatar = header.avatar === 'initials' || avatar != null
  // header.onTitleClick (optional): the name/avatar lead somewhere bigger — the hiring panel passes its…
  const onTitleClick =
    typeof header.onTitleClick === 'function' ? (header.onTitleClick as () => void) : undefined
  let chip = header.statusChip
  if (chip?.field && record) {
    const v = record[chip.field]
    chip = { label: chip.label ?? chip.labelBy?.[String(v)] ?? String(v), tint: chip.tintBy?.[String(v)] ?? 'blue' }
  }
  const bm = header.bookmark
  return (
    <div className="rounded-lg bg-detail-hero p-5">
      <motion.div
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
        initial="hidden"
        animate="show"
        className="flex items-start gap-4"
      >
        <DragPerson
          name={focus?.name ?? ''}
          id={focus?.id}
          type={focus?.type}
          avatar={focus?.avatar}
          subtitle={focus?.subtitle}
          className="flex min-w-0 flex-1 items-start gap-4"
        >
          {showAvatar && (
            <motion.div
              variants={staggerItem}
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.15 }}
              onClick={onTitleClick}
              className={onTitleClick ? 'cursor-pointer' : undefined}
            >
              <Avatar src={typeof avatar === 'string' && avatar ? avatar : undefined} name={String(title)} size="xl" ring />
            </motion.div>
          )}
          <div className="min-w-0 flex-1 pt-1">
            <motion.h2
              variants={staggerItem}
              onClick={onTitleClick}
              className={cn(
                'clamp-1 font-display text-[17px] font-bold leading-6 text-white',
                onTitleClick && 'cursor-pointer hover:underline',
              )}
            >
              {title}
            </motion.h2>
            {subtitle && (
              <motion.p variants={staggerItem} className="clamp-1 mt-0.5 text-[13px] text-white/60">
                {subtitle}
              </motion.p>
            )}
            {chip && (
              <motion.span
                variants={staggerItem}
                className={cn('mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', TINT_BG[chip.tint as TintName], TINT_FG[chip.tint as TintName])}
              >
                {chip.label}
              </motion.span>
            )}
          </div>
        </DragPerson>
        {bm && record && (
          <motion.div variants={staggerItem} className="shrink-0">
            <BookmarkButton
              size="lg"
              className="bg-white/10 hover:bg-white/20"
              bookmark={{
                type: bm.type ?? 'person',
                refId: String(record[bm.refIdField ?? 'id'] ?? ''),
                title: String(resolve(record, bm.titleField ?? 'name') ?? ''),
                subtitle: bm.subtitleField ? String(resolve(record, bm.subtitleField) ?? '') : undefined,
                avatar: bm.avatarField ? String(resolve(record, bm.avatarField) ?? '') : undefined,
                tint: bm.tint ?? 'blue',
                href: String(bm.href ?? '/').replace(':id', String(record[bm.refIdField ?? 'id'] ?? '')),
              }}
            />
          </motion.div>
        )}
      </motion.div>
      {header.actions && (
        <div className="mt-4 flex gap-2">
          {header.actions.map((a: any, i: number) => {
            // The mail icon is REAL: it opens the platform's own composer with the record's name as the subject…
            const onClick = a.icon === 'mail'
              ? () => composeEmail({ subject: String(resolve(record, header.title ?? 'name') ?? ''), source: 'Details' })
              : () => unwiredAction(a.toast ?? a.label)
            // `return` alone on its own line took a semicolon from the parser and this whole row rendered NOTHING…
            return a.iconOnly ? (
              <button
                key={i}
                aria-label={a.label}
                title={a.label}
                onClick={onClick}
                className="grid h-9 w-9 place-items-center rounded-sm bg-white/10 text-white transition-colors duration-150 hover:bg-white/20"
              >
                <AppIcon name={a.icon} size={16} />
              </button>
            ) : (
              <button
                key={i}
                onClick={onClick}
                className="flex h-8 items-center gap-1.5 rounded-sm bg-white/10 px-3 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-white/20"
              >
                <AppIcon name={a.icon} size={13} /> {a.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
