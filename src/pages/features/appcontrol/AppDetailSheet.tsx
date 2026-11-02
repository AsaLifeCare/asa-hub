// App Control's detail drawer — pressing an app shows 100% of what can be said about it.
// Everything the platform KNOWS about one app, in one right-side sheet: the manifest facts (version, source…
import { useState } from 'react'
import { useNavigate } from 'react-router'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import SchemaPreview from '@/components/shared/SchemaPreview'
import TintTile from '@/components/shared/TintTile'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { BADGE_ORDER } from '@/components/shared/RoleBadge'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { AppManifest } from '@/engine/types'
import type { CategoryDef } from '@/lib/categories'
import type { CategorySuggestion } from '@/lib/categorySuggest'

const DETAIL_BADGES = BADGE_ORDER.filter((b) => b !== 'MASTER')

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{children}</h4>
}

function FactChip({ on, children, title }: { on?: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        on ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-3',
      )}
    >
      {children}
    </span>
  )
}

export function AppDetailSheet({
  detail,
  rule,
  onClose,
}: {
  detail: {
    app: AppManifest
    currentId: string
    currentDef?: CategoryDef
    overridden: boolean
    suggestion: CategorySuggestion
    pending: boolean
  } | null
  /** The app's stored badge rule (drafts overlaid) — empty = the master's alone. */
  rule: string[]
  onClose: () => void
}) {
  const [tab, setTab] = useState('overview')
  const navigate = useNavigate()
  const app = detail?.app
  return (
    <Sheet open={detail !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-surface p-6 sm:max-w-[384px]">
        {app && detail && (
          <>
            <SheetHeader className="mb-4">
              <div className="flex items-center gap-3">
                <TintTile icon={app.icon} tint={app.accent} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="font-display text-[17px] font-bold text-text-1">{app.name}</SheetTitle>
                  <SheetDescription className="text-[12px] text-text-3">
                    v{app.version} · {detail.currentDef?.label ?? detail.currentId}
                    {' · '}
                    {app.source === 'sheet' ? 'Built in the studio' : 'Built into the platform'}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SegmentedTabs
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'schema', label: 'Schema' },
              ]}
              value={tab}
              onChange={setTab}
              className="mb-4"
            />
            {tab === 'overview' ? (
              <div className="space-y-5">
                {app.tagline && <p className="text-[13px] leading-5 text-text-2">{app.tagline}</p>}

                <div>
                  <SectionTitle>Status</SectionTitle>
                  <div className="flex flex-wrap gap-1.5">
                    <FactChip on={app.enabled !== false}>{app.enabled !== false ? 'Enabled' : 'Disabled'}</FactChip>
                    {app.unlisted && <FactChip title="Routes, but is not offered in the App Hub">Unlisted</FactChip>}
                    {app.isNew && <FactChip>New</FactChip>}
                    {app.interfaceless && <FactChip title="Runs with no screen of its own">Interfaceless</FactChip>}
                    {app.dragFocus && <FactChip title="Its records can be picked up into the tracker">Drag focus</FactChip>}
                    <FactChip title="The manifest id — what routes, rules and slices name">
                      <span className="font-mono normal-case">{app.id}</span>
                    </FactChip>
                  </div>
                </div>

                <div>
                  <SectionTitle>Access — the badge rule</SectionTitle>
                  {rule.length === 0 ? (
                    <p className="text-[12.5px] text-text-3">
                      No rule on the matrix — only the master sees this app.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {DETAIL_BADGES.map((b) => (
                        <FactChip key={b} on={rule.includes(b)} title={`${b}: ${rule.includes(b) ? 'reaches this app' : 'does not'}`}>
                          {b}
                        </FactChip>
                      ))}
                    </div>
                  )}
                  {Array.isArray(app.audience) && app.audience.length > 0 && (
                    <p className="mt-2 text-[11.5px] text-text-3">
                      Manifest audience: {app.audience.join(', ')}
                    </p>
                  )}
                </div>

                <div>
                  <SectionTitle>Category</SectionTitle>
                  <p className="text-[13px] text-text-1">
                    {detail.currentDef?.label ?? detail.currentId}
                    {detail.overridden && (
                      <span className="ml-2 rounded-full bg-tint-amber px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-amber">
                        override — manifest says {app.category}
                      </span>
                    )}
                  </p>
                  {detail.pending && (
                    <p className="mt-1 text-[12px] text-text-3">
                      Suggested: <b>{detail.suggestion.label}</b> at {Math.round(detail.suggestion.confidence * 100)}%
                      {detail.suggestion.reasons.length > 0 && <> — {detail.suggestion.reasons.join(' · ')}</>}
                    </p>
                  )}
                </div>

                <div>
                  <SectionTitle>Pages</SectionTitle>
                  <div className="divide-y divide-border rounded-md border border-border">
                    {app.pages.filter((p) => !(p.config as { hidden?: boolean } | undefined)?.hidden).map((p) => (
                      <div key={p.id} className="flex items-center gap-2.5 px-3 py-2.5">
                        <AppIcon name={p.icon ?? 'file'} size={15} className="shrink-0 text-text-3" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-text-1">{p.title}</span>
                          <span className="block text-[11px] text-text-3">
                            {p.type}
                            {p.dataSource?.resource ? ` · ${p.dataSource.resource}` : ''}
                            {p.dataSource?.action ? ` · ${p.dataSource.action}` : ''}
                          </span>
                        </span>
                        <button
                          onClick={() => { onClose(); navigate(`/app/${app.id}/${p.id}`) }}
                          className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft"
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {Array.isArray(app.notifications) && app.notifications.length > 0 && (
                  <div>
                    <SectionTitle>Notifications it emits</SectionTitle>
                    <ul className="space-y-1">
                      {app.notifications.map((n, i) => (
                        <li key={i} className="text-[12.5px] text-text-2">• {typeof n === 'string' ? n : JSON.stringify(n)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {app.settingsAnchor && (
                  <p className="text-[11.5px] text-text-3">
                    Settings anchor: <span className="font-mono">{app.settingsAnchor}</span>
                  </p>
                )}
              </div>
            ) : (
              <SchemaPreview schema={app} />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
