import { useNavigate } from 'react-router'
import SafeImg from '@/components/shared/SafeImg'

/** Empty state with line illustration + optional primary CTA (§11). */
export default function EmptyState({
  title = 'Nothing here yet',
  body,
  action,
}: {
  title?: string
  body?: string
  action?: { label: string; href?: string; onClick?: () => void }
}) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <SafeImg
        src="/assets/empty-state.svg"
        icon="inbox"
        shape="square"
        size="mb-5 h-[120px] w-[160px] opacity-80"
      />
      <h3 className="font-display text-[15px] font-semibold text-text-1">{title}</h3>
      {body && <p className="mt-1 max-w-[320px] text-[13px] leading-5 text-text-2">{body}</p>}
      {action && (
        <button
          onClick={() => (action.onClick ? action.onClick() : action.href && navigate(action.href))}
          className="mt-4 h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors duration-150 hover:bg-primary-hover active:scale-[0.98]"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
