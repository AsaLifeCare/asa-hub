// `detail` template (page-types.md §7) — profile/record panel content.
// Dark navy hero (both themes) with icon actions, 2×2 stat mini-cards with count-up values, stacked sections…
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { TemplateProps } from '@/engine/PageRenderer'
import { staggerContainer, staggerItem } from '@/engine/motion'
import { type EditSpec } from '@/components/shared/EditRecordModal'
import { Header } from './Header'
import { StatGrid } from './StatGrid'
import { Section } from './Section'
import { Footer } from './Footer'
import { NotesField, type NotesFieldSpec } from './NotesField'
import { SheetField, type SheetFieldSpec } from './SheetField'
import { shareFromPanel } from './utils'

export default function DetailTemplate({ config, record, schema }: TemplateProps & { record?: any }) {
  // inline-edit overlay: saved rows replace the panel record until it remounts
  const [patched, setPatched] = useState<any>(null)
  useEffect(() => setPatched(null), [record?.id])
  const effectiveRecord = patched ?? record
  const editSpec = config.editForm as EditSpec | undefined
  // resource for footer config actions: an explicit `config.resource` wins (the sheet injects it when opening the…
  const resource = (config.resource as string | undefined) ?? (schema?.dataSource?.resource as string | undefined)
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
      {config.header && (
        <motion.div variants={staggerItem}>
          {/* `focusAction` is set by the sheet when it opened this panel from a
              row it recognised as a person — it makes the hero draggable. */}
          <Header header={config.header} record={effectiveRecord} focus={config.focusAction as any} />
        </motion.div>
      )}
      {config.stats && <StatGrid stats={config.stats} record={effectiveRecord} />}
      {(config.sections ?? []).map((s: any, i: number) => (
        <Section key={i} section={s} record={effectiveRecord} />
      ))}
      {/* THE SHEET BOARD'S BODY. Same slot, same law as the notes
          field: it is declared by the page, it writes through the platform's
          own door, and the panel shows what came back rather than what it
          hoped for. A page declares one or the other, never both — a card
          whose body is a file has nothing to type into. */}
      {config.sheetField && effectiveRecord?.id && (
        <motion.div variants={staggerItem}>
          <SheetField
            spec={config.sheetField as SheetFieldSpec}
            record={effectiveRecord}
            onSaved={(row) => setPatched(row)}
          />
        </motion.div>
      )}
      {config.notesField && effectiveRecord?.id && (
        <motion.div variants={staggerItem}>
          <NotesField
            spec={config.notesField as NotesFieldSpec}
            record={effectiveRecord}
            onSaved={(row) => setPatched(row)}
          />
        </motion.div>
      )}
      {config.footer && (
        <Footer
          // Both shapes stand: the legacy bare button array, and the studio's `{ buttons: [...] }` object (which…
          buttons={Array.isArray(config.footer) ? config.footer : (config.footer as any).buttons ?? []}
          editSpec={editSpec}
          record={effectiveRecord}
          resource={resource}
          onSaved={(row) => setPatched(row)}
          shareInfo={shareFromPanel(config, effectiveRecord)}
        />
      )}
    </motion.div>
  )
}
