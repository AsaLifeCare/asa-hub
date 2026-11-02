/**
 * A HOOK, MOUNTED BY REAL REACT. The hook runs inside a component that draws
 * nothing, rendered by react-dom's own client renderer under StrictMode — the
 * same double render the development build gives the platform — so state,
 * render-phase updates, unmounting and remounting are React's, not a copy of
 * them written for the test.
 *
 * Nothing is drawn, so the container is a stand-in with no children: the
 * renderer only ever asks it for its document and its event hooks.
 */
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const noop = () => {}

/** Also a root for a tree that draws no element of its own (a router whose routes only redirect). */
export function container(): Element {
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: document,
    childNodes: [],
    firstChild: null,
    lastChild: null,
    textContent: '',
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    removeChild: noop,
  } as unknown as Element
}

export type Mounted<P, R> = {
  /** what the hook returned on the latest render */
  readonly current: R
  /** render again with new props — the same component instance */
  rerender(props: P): void
  /** do something that updates state (a click's handler), and let React finish */
  run(fn: () => void): void
  /**
   * let the hook's own asynchronous work land — a read its effect started —
   * until `until` holds or a few dozen turns have passed
   */
  settle(until: () => boolean): Promise<void>
  unmount(): void
}

/** The props type is the hook's own — never narrowed to the first props given. */
export function mountHook<P, R>(hook: (props: P) => R, props: NoInfer<P>): Mounted<P, R> {
  let current: R | undefined
  let drawn = false
  function Probe({ p }: { p: P }) {
    current = hook(p)
    drawn = true
    return null
  }
  const root = createRoot(container())
  const draw = (p: P) => act(() => {
    root.render(createElement(StrictMode, null, createElement(Probe, { p })))
  })
  draw(props)
  if (!drawn) throw new Error('the hook never rendered')
  return {
    get current() { return current as R },
    rerender: draw,
    run(fn) { act(fn) },
    async settle(until) {
      // NOT inside an async act(): in a bundle, React's act cannot reach node's
      // `timers`, falls back to a MessageChannel per task and leaves the ports
      // open, so the test process never exits. Out here the update lands the
      // way it does in a browser — React's own scheduler — and the act
      // environment is off only while it does, so React does not warn about it.
      const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
      env.IS_REACT_ACT_ENVIRONMENT = false
      try {
        for (let turn = 0; turn < 50 && !until(); turn++) await new Promise((r) => setTimeout(r, 0))
      } finally {
        env.IS_REACT_ACT_ENVIRONMENT = true
      }
    },
    unmount() { act(() => root.unmount()) },
  }
}
