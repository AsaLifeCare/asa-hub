// Live miniature preview of the platform for Settings → Appearance radio cards.
// Drawn with divs + tokens; `variant` pins which token set the miniature uses ("split" renders a diagonal…
import './theme-preview.css'

function Mini() {
  return (
    <div className="flex h-full w-full overflow-hidden rounded-[8px] border border-border bg-bg">
      {/* mini sidebar (always dark, brand constant) */}
      <div className="w-[28%] shrink-0 bg-sidebar p-1.5">
        <div className="mb-1.5 h-1.5 w-2/3 rounded-full bg-white/25" />
        <div className="mb-1 h-1 w-full rounded-full bg-white/10" />
        <div className="mb-1 h-1 w-4/5 rounded-full bg-primary" />
        <div className="mb-1 h-1 w-full rounded-full bg-white/10" />
        <div className="h-1 w-3/5 rounded-full bg-white/10" />
      </div>
      {/* mini content: 2 stat cards + chart card */}
      <div className="min-w-0 flex-1 p-1.5">
        <div className="mb-1 flex gap-1">
          <div className="h-4 flex-1 rounded-[4px] border border-border bg-surface p-0.5">
            <div className="h-1 w-2/3 rounded-full bg-surface-3" />
          </div>
          <div className="h-4 flex-1 rounded-[4px] border border-border bg-surface p-0.5">
            <div className="h-1 w-1/2 rounded-full bg-tint-mint" />
          </div>
        </div>
        <div className="rounded-[4px] border border-border bg-surface p-1">
          <svg viewBox="0 0 60 14" preserveAspectRatio="none" className="h-3.5 w-full">
            <polyline
              points="0,11 10,8 20,9.5 30,5 40,6.5 50,2.5 60,4"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}

export default function ThemeMiniPreview({ variant }: { variant: 'light' | 'dark' | 'split' }) {
  if (variant === 'split') {
    return (
      <div className="relative h-full w-full">
        <div className="absolute inset-0" data-preview-theme="light">
          <Mini />
        </div>
        <div className="absolute inset-0 [clip-path:polygon(0_0,100%_0,0_100%)]" data-theme="dark">
          <Mini />
        </div>
      </div>
    )
  }
  return (
    <div
      className="h-full w-full"
      {...(variant === 'dark' ? { 'data-theme': 'dark' } : { 'data-preview-theme': 'light' })}
    >
      <Mini />
    </div>
  )
}
