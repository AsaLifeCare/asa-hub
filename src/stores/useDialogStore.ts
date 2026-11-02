// Ask-the-person dialogs — the platform's replacement for window.confirm and window.prompt.
// WHY A STORE AND NOT A COMPONENT.
import { create } from 'zustand'

export type DialogTone = 'primary' | 'danger'

export type ConfirmSpec = {
  title: string
  /** The plain sentence. Say what will happen, not "are you sure?". */
  body?: string
  /** A second line for the consequence — rendered as a warning strip. */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

export type PromptSpec = ConfirmSpec & {
  /** Label above the field. */
  label?: string
  placeholder?: string
  defaultValue?: string
  /** Confirm stays disabled until something is typed. */
  required?: boolean
  multiline?: boolean
  // `date` uses the native picker, whose value is a plain 'YYYY-MM-DD' string — no Date is ever constructed, so no…
  inputType?: 'text' | 'date'
}

type Pending =
  | ({ kind: 'confirm'; id: number; resolve: (v: boolean) => void } & ConfirmSpec)
  | ({ kind: 'prompt'; id: number; resolve: (v: string | null) => void } & PromptSpec)

type DialogState = {
  pending: Pending | null
  close: () => void
}

let seq = 0

export const useDialogStore = create<DialogState>((set) => ({
  pending: null,
  close: () => set({ pending: null }),
}))

/** True when confirmed, false when cancelled or dismissed. Never throws. */
export function askConfirm(spec: ConfirmSpec): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const prev = useDialogStore.getState().pending
    // A question already on screen is answered "no" rather than replaced — dropping its promise would hang the…
    if (prev?.kind === 'confirm') prev.resolve(false)
    else if (prev) prev.resolve(null)
    useDialogStore.setState({ pending: { kind: 'confirm', id: ++seq, resolve, ...spec } })
  })
}

/** The typed text, or null when cancelled. '' is a real answer. */
export function askPrompt(spec: PromptSpec): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const prev = useDialogStore.getState().pending
    if (prev?.kind === 'confirm') prev.resolve(false)
    else if (prev) prev.resolve(null)
    useDialogStore.setState({ pending: { kind: 'prompt', id: ++seq, resolve, ...spec } })
  })
}
