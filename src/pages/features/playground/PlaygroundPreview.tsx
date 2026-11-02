// LIVE PREVIEW pane — renders the resolved page-type TEMPLATE directly with the admin's sample rows (PageRenderer…
// JSON edits debounce (400ms) into the preview.
import { Component, useEffect, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { AlertTriangle, Check, Clock } from 'lucide-react'
import Card from '@/components/shared/Card'
import TintTile from '@/components/shared/TintTile'
import { TEMPLATES, type TemplateProps } from '@/engine/PageRenderer'
import { cn } from '@/lib/utils'
import { applyRearrange, type RearrangeToggles } from './rearrange'
import { checkConfig, checkRows } from './validation'
import type { PageSchema, PageType, TintName } from '@/engine/types'

/* ---------- error boundary: a bad config shape can't take the studio down ---------- */

class PreviewBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (this.state.error) {
      return (
        <Card className="border-tint-pink">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-tint-fg-pink" />
            <div>
              <p className="text-[13px] font-semibold text-text-1">The preview crashed on this config</p>
              <p className="mt-1 font-mono text-[11px] leading-4 text-text-2">{this.state.error}</p>
              <p className="mt-2 text-[12px] text-text-3">
                The JSON parses, but the template expected a different shape — check keys like columns, stages,
                widgets or resources for this page type.
              </p>
            </div>
          </div>
        </Card>
      )
    }
    return this.props.children
  }
}

/* ---------- preview pane ---------- */

type Props = {
  name: string
  tagline: string
  icon: string
  accent: TintName
  pageType: PageType
  pageTitle: string
  configText: string
  rowsText: string
  toggles: RearrangeToggles
  resource: string
}

type Good = { config: Record<string, unknown>; rows: Record<string, unknown>[] }

export default function PlaygroundPreview({
  name, tagline, icon, accent, pageType, pageTitle, configText, rowsText, toggles, resource,
}: Props) {
  const [good, setGood] = useState<Good | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [debouncing, setDebouncing] = useState(false)

  // debounce 400ms → validate → swap the rendered config/rows (or hold last-good)
  useEffect(() => {
    setDebouncing(true)
    const t = setTimeout(() => {
      setDebouncing(false)
      const c = checkConfig(configText)
      const r = checkRows(rowsText)
      if (c.ok && r.ok) {
        setGood({ config: applyRearrange(c.config, toggles, pageType, resource), rows: r.rows })
        setWaiting(false)
      } else {
        setWaiting(true)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [configText, rowsText, toggles, pageType, resource])

  const schema: PageSchema = useMemo(
    () => ({
      id: 'preview',
      type: pageType,
      title: pageTitle || name || 'Preview',
      icon,
      dataSource: { resource },
      config: good?.config ?? {},
    }),
    [pageType, pageTitle, name, icon, resource, good],
  )

  const Template = TEMPLATES[pageType] as ComponentType<TemplateProps & { record?: any }>
  const resetKey = `${pageType}:${configText.length}:${rowsText.length}:${good ? 'ok' : 'none'}`

  return (
    <div className="flex flex-col gap-3">
      {/* identity chip — exactly how the hub card will introduce this app */}
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-3 rounded-lg border border-border bg-surface/90 px-3 py-2.5 shadow-1 backdrop-blur">
        <TintTile icon={icon} tint={accent} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold leading-4 text-text-1">{name || 'Untitled app'}</p>
          <p className="truncate text-[11px] leading-4 text-text-3">{tagline || 'No tagline yet'}</p>
        </div>
        <span className="hidden rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-3 sm:inline">
          {resource}
        </span>
        {debouncing ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-tint-blue px-2 py-0.5 text-[10px] font-bold text-tint-fg-blue">
            <Clock size={10} /> Typing…
          </span>
        ) : waiting ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[10px] font-bold text-tint-fg-amber">
            <AlertTriangle size={10} /> Waiting for valid JSON
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-tint-mint px-2 py-0.5 text-[10px] font-bold text-tint-fg-mint">
            <Check size={10} /> Live
          </span>
        )}
      </div>

      {/* the page itself */}
      <div className={cn('transition-opacity duration-150', waiting && 'opacity-80')}>
        {good ? (
          <PreviewBoundary resetKey={resetKey}>
            <Template
              key={pageType}
              config={good.config}
              data={good.rows}
              schema={schema}
              {...(pageType === 'detail' ? { record: good.rows[0] } : {})}
            />
          </PreviewBoundary>
        ) : (
          <Card>
            <p className="py-10 text-center text-[13px] text-text-2">
              Fix the JSON on the left — the page renders here as soon as both editors are valid.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
