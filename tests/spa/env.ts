/**
 * THE BROWSER A SPA TEST RUNS IN — only as much of one as the modules under
 * test touch while they load, and as much as React needs to mount a component
 * that draws nothing. tools/test-spa.mjs injects this file into every bundle,
 * so it runs before any module under test does.
 *
 * Deliberately small. The screens' own modules are bundled as they ship; what
 * is faked here is the ground they stand on — storage, a window, a document
 * with no elements in it — never a module's decisions.
 */

class MemoryStorage {
  private items = new Map<string, string>()
  get length(): number { return this.items.size }
  key(i: number): string | null { return [...this.items.keys()][i] ?? null }
  getItem(k: string): string | null { return this.items.has(k) ? (this.items.get(k) as string) : null }
  setItem(k: string, v: string): void { this.items.set(k, String(v)) }
  removeItem(k: string): void { this.items.delete(k) }
  clear(): void { this.items.clear() }
}

const noop = () => {}

function install(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

install('localStorage', new MemoryStorage())
install('sessionStorage', new MemoryStorage())
install('window', globalThis)
install('document', {
  nodeType: 9,
  visibilityState: 'visible',
  hidden: false,
  activeElement: null,
  defaultView: globalThis,
  addEventListener: noop,
  removeEventListener: noop,
})
install('matchMedia', () => ({
  matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop,
}))
// react-dom asks whether the focused element is an iframe before each commit
install('HTMLIFrameElement', class {})
// React's act() only flushes where the environment says it is a test
install('IS_REACT_ACT_ENVIRONMENT', true)

export {}
