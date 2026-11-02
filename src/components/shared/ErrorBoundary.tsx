// One broken screen must not take the platform down with it.
// React unmounts the ENTIRE tree when a render throws and nothing catches it — which is why one Settings card…
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

type Props = {
  children: ReactNode
  /** what broke, in a reader's words — "Settings", "the pipeline" */
  label?: string
}
type State = { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is where a developer looks; the card is where the person on the screen looks.
    console.error(`[${this.props.label ?? 'screen'}] crashed:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="mx-auto my-6 max-w-lg rounded-xl border border-border bg-surface p-5 text-center">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-[10px] bg-tint-danger">
          <TriangleAlert size={18} className="text-tint-fg-danger" />
        </span>
        <h2 className="mt-3 font-display text-[15.5px] font-bold text-text-1">
          {this.props.label ? `${this.props.label} hit a problem` : 'This screen hit a problem'}
        </h2>
        <p className="mt-1.5 text-[13px] leading-5 text-text-2">
          The rest of the platform is fine. {error.message}
        </p>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-4 h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
        >
          Try again
        </button>
      </div>
    )
  }
}
