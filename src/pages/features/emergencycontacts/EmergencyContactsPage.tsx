// EMERGENCY CONTACTS — the numbers a bad day dials, one tap away.
// A standalone directory: the 911 banner on top, then the contact lanes, kept in the Hub's database once the app runs
// on Python (the compiled lanes otherwise); the master and a holder of its edition change any lane or contact.
import { useMemo, useState } from 'react'
import { Pencil, Plus, Search, Siren } from 'lucide-react'
import Card from '@/components/shared/Card'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import DirectoryPanelHost, { type DirectoryPanel } from './EmergencyContactsForms'
import { useDirectory } from './emergencyContactsLane'
import { directoryOfRefusal, filterDirectory, noteShown, tel, type Directory } from './emergencyContactsModel'

const EDIT_BTN = 'grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface hover:text-primary'

/** The banner and the lanes, as drawn for a directory; the edit affordances only when it says this viewer may. */
export function DirectoryView({ directory, query, onQuery, onPanel }: {
  directory: Directory
  query: string
  onQuery: (q: string) => void
  onPanel?: (p: DirectoryPanel) => void
}) {
  const groups = useMemo(() => filterDirectory(directory, query), [directory, query])
  const edit = directory.canEdit && directory.source === 'python' && onPanel ? onPanel : null

  return (
    <div className="w-full space-y-5">
      <section className="overflow-hidden rounded-lg border border-tint-fg-pink/25 bg-tint-pink shadow-1">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-surface text-tint-fg-pink shadow-1">
            <Siren size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[18px] font-bold text-text-1">Immediate danger or a life-threatening emergency?</h2>
            <p className="mt-1 text-[13px] leading-5 text-text-2">Call 911 first. Once everyone is safe, notify the appropriate ASA supervisor.</p>
          </div>
          <a
            href="tel:911"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-[#9f1515] !bg-[#c62828] px-5 text-[14px] font-extrabold !text-white shadow-1 transition-all hover:scale-[1.02] hover:!bg-[#ad1f1f] active:scale-[0.98]"
          >
            Call 911
          </a>
        </div>
      </section>

      <section className="min-w-0 space-y-3" aria-labelledby="contact-directory-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="contact-directory-heading" className="font-display text-[18px] font-bold text-text-1">Contact directory</h2>
            <p className="mt-0.5 text-[12px] text-text-3">Choose the service or person you need.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {edit && (
              <button type="button" onClick={() => edit({ kind: 'new-group' })} data-add-lane=""
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 shadow-1 hover:bg-surface-2">
                <Plus size={14} aria-hidden="true" /> Add lane
              </button>
            )}
            <label className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-3 text-text-3 shadow-1 sm:w-[270px]">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">Search emergency contacts</span>
              <input
                type="search"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                placeholder="Search contacts…"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3"
              />
            </label>
          </div>
        </div>

        {groups.length > 0 ? (
          <div className="space-y-3">
            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`contact-lane-${group.id}`} data-lane={group.id} className="grid overflow-hidden rounded-lg border border-border bg-surface shadow-1 lg:grid-cols-[190px_minmax(0,1fr)]">
                <header className={cn('flex items-center gap-2.5 border-b border-border px-4 py-3 lg:border-b-0 lg:border-r', group.chip)}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface/70">
                    <AppIcon name={group.icon} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 id={`contact-lane-${group.id}`} className="text-[12px] font-bold uppercase tracking-[0.06em]">{group.label}</h3>
                  </div>
                  {edit && (
                    <button type="button" onClick={() => edit({ kind: 'group', id: group.id })} data-edit-lane={group.id}
                      aria-label={`Edit the ${group.label} lane`} className={EDIT_BTN}>
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                  )}
                </header>
                <div className="scroll-thin grid grid-flow-col auto-cols-[240px] divide-x divide-border/70 overflow-x-auto">
                  {group.contacts.map((contact) => (
                    <div key={contact.id} data-contact={contact.id} className="relative flex min-h-[78px] flex-col items-center justify-center px-4 py-2.5 text-center">
                      {edit && (
                        <button type="button" onClick={() => edit({ kind: 'contact', id: contact.id })} data-edit-contact={contact.id}
                          aria-label={`Edit ${contact.name}`} className={cn(EDIT_BTN, 'absolute right-1.5 top-1.5 h-6 w-6')}>
                          <Pencil size={12} aria-hidden="true" />
                        </button>
                      )}
                      <span className="block text-[13px] font-semibold leading-5 text-text-1">{contact.name}</span>
                      {noteShown(directory, group) && contact.note && <span className="block text-[11px] leading-4 text-text-3">{contact.note}</span>}
                      <a
                        href={tel(contact.phone)}
                        aria-label={`Call ${contact.name} at ${contact.phone}`}
                        className={cn(
                          'mt-1 inline-flex min-h-8 items-center rounded-md border px-2.5 text-[12px] font-semibold tabular-nums transition-colors',
                          contact.phone === '911'
                            ? 'border-[#9f1515] !bg-[#c62828] font-extrabold !text-white shadow-sm hover:border-[#891313] hover:!bg-[#ad1f1f]'
                            : 'border-primary/15 bg-primary/[0.06] text-text-1 hover:border-primary/35 hover:bg-primary/[0.1] hover:text-primary',
                        )}
                      >
                        {contact.phone}
                      </a>
                    </div>
                  ))}
                  {edit && !query.trim() && (
                    <button type="button" onClick={() => edit({ kind: 'new-contact', group: group.id })} data-add-contact={group.id}
                      className="flex min-h-[78px] flex-col items-center justify-center gap-1 px-4 py-2.5 text-[12px] font-semibold text-text-3 transition-colors hover:bg-surface-2 hover:text-primary">
                      <Plus size={15} aria-hidden="true" /> Add contact
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : !query.trim() ? (
          <Card className="py-12 text-center">
            <p className="text-[14px] font-semibold text-text-1" data-no-lanes="">The directory has no lanes yet.</p>
            {edit && (
              <button type="button" onClick={() => edit({ kind: 'new-group' })} className="mt-2 text-[12px] font-semibold text-primary hover:underline">
                Add a lane
              </button>
            )}
          </Card>
        ) : (
          <Card className="py-12 text-center">
            <p className="text-[14px] font-semibold text-text-1">No contacts match “{query}”</p>
            <button type="button" onClick={() => onQuery('')} className="mt-2 text-[12px] font-semibold text-primary hover:underline">
              Clear search
            </button>
          </Card>
        )}
      </section>
    </div>
  )
}

export default function EmergencyContactsPage() {
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<DirectoryPanel>(null)
  const { directory, absorb, adopt } = useDirectory()

  return (
    <>
      <DirectoryView directory={directory} query={query} onQuery={setQuery} onPanel={setPanel} />
      {directory.canEdit && directory.source === 'python' && (
        <DirectoryPanelHost panel={panel} directory={directory} onAnswer={absorb} onClose={() => setPanel(null)}
          onRefusal={(err) => { const d = directoryOfRefusal(err); if (d) adopt(d) }} />
      )}
    </>
  )
}
