// IS THERE TYPED WORK ON SCREEN THAT A RELOAD WOULD LOSE?
// Asked before this tab reloads because a person clicked for it (the strip at the top, lib/hubStatus).

const liveDrafts = new Set<object>()

/** A registered surface's own word: `who` is on screen, dirty or not. */
export function markLiveDraft(who: object, dirty: boolean): void {
  if (dirty) liveDrafts.add(who)
  else liveDrafts.delete(who)
}

type Field = {
  tagName?: unknown
  type?: unknown
  value?: unknown
  isContentEditable?: boolean
  textContent?: string | null
  isConnected?: boolean
}

/** Inputs whose content is nobody's work: a search box, a toggle, a picker. */
const NOT_WORK: ReadonlySet<string> = new Set([
  'search', 'checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'hidden', 'image',
])

function isTextField(el: unknown): el is Field {
  if (!el || typeof el !== 'object') return false
  const f = el as Field
  if (f.tagName === 'TEXTAREA') return true
  if (f.tagName === 'INPUT') return !NOT_WORK.has(String(f.type || 'text').toLowerCase())
  return f.isContentEditable === true
}

function holdsText(f: Field): boolean {
  const text = typeof f.value === 'string' ? f.value : f.isContentEditable ? f.textContent : ''
  return String(text ?? '').trim() !== ''
}

const typed = new Set<Field>()

/** A field was typed into (the page's own `input` events). */
export function noteTyping(target: unknown): void {
  if (!isTextField(target)) return
  typed.add(target)
  if (typed.size > 200) for (const f of typed) if (!f.isConnected) typed.delete(f)
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('input', (e) => noteTyping(e.target), true)
}

export function typedWorkOnScreen(): boolean {
  if (liveDrafts.size > 0) return true
  for (const f of typed) {
    if (!f.isConnected) {
      typed.delete(f)
      continue
    }
    if (holdsText(f)) return true
  }
  return false
}
