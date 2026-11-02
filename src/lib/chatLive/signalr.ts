// A SignalR client for the JSON hub protocol, as much of it as this chat speaks: negotiate (version 1), WebSockets…
// It keeps no reconnect of its own — ./connection owns that and asks for a new ticket for every start.

const RS = '\u001e'
const HANDSHAKE = JSON.stringify({ protocol: 'json', version: 1 }) + RS

export type HubState = 'disconnected' | 'connecting' | 'connected'
export type HubTransport = 'WebSockets' | 'ServerSentEvents'

type Frame = {
  type?: number
  invocationId?: string
  target?: string
  arguments?: unknown[]
  result?: unknown
  error?: string
}

interface Transport {
  send(text: string): Promise<void>
  close(): void
}

/** A refusal the hub answered as a HubException; `kind` is the word before its first colon. */
export class HubCallError extends Error {
  readonly kind: string

  constructor(raw: string) {
    const at = raw.indexOf('HubException: ')
    const text = at === -1 ? raw : raw.slice(at + 'HubException: '.length)
    const m = /^(reauth|revoked|refused|failed):\s*([\s\S]*)$/.exec(text)
    super(m ? m[2] : text)
    this.kind = m ? m[1] : 'failed'
  }
}

/** An HTTP answer that was not a yes: negotiate, or a send on the Server-Sent Events leg. */
export class HubHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Complete records out of what arrived so far, and what is left for the next piece. */
export function splitRecords(buffer: string): { records: string[]; rest: string } {
  const parts = buffer.split(RS)
  const rest = parts.pop() ?? ''
  return { records: parts.filter((p) => p.length > 0), rest }
}

export function record(frame: object): string {
  return JSON.stringify(frame) + RS
}

function absolute(url: string, scheme: 'ws' | 'http'): string {
  const u = new URL(url, window.location.href)
  if (scheme === 'ws') u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

async function negotiate(url: string, ticket: string): Promise<{ token: string; transports: HubTransport[] }> {
  const res = await fetch(`${url}/negotiate?negotiateVersion=1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ticket}`,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new HubHttpError(res.status, `the chat hub refused the connection (${res.status})`)
  const body = (await res.json()) as {
    error?: string
    connectionToken?: string
    connectionId?: string
    availableTransports?: { transport?: string }[]
  }
  if (body.error) throw new Error(body.error)
  const token = String(body.connectionToken || body.connectionId || '')
  if (!token) throw new Error('the chat hub gave no connection')
  const transports = (body.availableTransports ?? [])
    .map((t) => String(t.transport ?? ''))
    .filter((t): t is HubTransport => t === 'WebSockets' || t === 'ServerSentEvents')
  return { token, transports }
}

function openWebSocket(url: string, token: string, ticket: string, onText: (text: string) => void,
  onClose: (error?: Error) => void, timeoutMs: number): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const target = `${absolute(url, 'ws')}?id=${encodeURIComponent(token)}&access_token=${encodeURIComponent(ticket)}`
    let ws: WebSocket
    try {
      ws = new WebSocket(target)
    } catch (e) {
      reject(e instanceof Error ? e : new Error('the socket could not be opened'))
      return
    }
    let opened = false
    const timer = setTimeout(() => {
      if (opened) return
      try { ws.close() } catch { /* already gone */ }
      reject(new Error('the socket did not open'))
    }, timeoutMs)
    ws.onopen = () => {
      opened = true
      clearTimeout(timer)
      resolve({
        send: async (text) => {
          if (ws.readyState !== WebSocket.OPEN) throw new Error('the socket is not open')
          ws.send(text)
        },
        close: () => {
          try { ws.close() } catch { /* already gone */ }
        },
      })
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') onText(ev.data)
    }
    ws.onerror = () => {
      if (!opened) {
        clearTimeout(timer)
        reject(new Error('the socket failed to open'))
      }
    }
    ws.onclose = (ev) => {
      clearTimeout(timer)
      if (!opened) reject(new Error(`the socket closed before it opened (${ev.code})`))
      else onClose(ev.code === 1000 ? undefined : new Error(`the socket closed (${ev.code})`))
    }
  })
}

async function openServerSentEvents(url: string, token: string, ticket: string, onText: (text: string) => void,
  onClose: (error?: Error) => void, timeoutMs: number): Promise<Transport> {
  const endpoint = `${absolute(url, 'http')}?id=${encodeURIComponent(token)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(endpoint, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${ticket}` },
      cache: 'no-store',
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok || !res.body) {
    ctrl.abort()
    throw new HubHttpError(res.status, `the chat hub refused the stream (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  void (async () => {
    let buf = ''
    let data: string[] = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          let line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.endsWith('\r')) line = line.slice(0, -1)
          if (line === '') {
            if (data.length) onText(data.join('\n'))
            data = []
          } else if (line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''))
          }
          nl = buf.indexOf('\n')
        }
      }
      onClose(ctrl.signal.aborted ? undefined : new Error('the stream ended'))
    } catch (e) {
      onClose(ctrl.signal.aborted ? undefined : e instanceof Error ? e : new Error('the stream broke'))
    }
  })()
  return {
    // each record is its own POST: two sends typed in a row must reach the hub in that order
    send: oneAtATime(async (text) => {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ticket}`, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: text,
        cache: 'no-store',
      })
      if (!r.ok) throw new HubHttpError(r.status, `the chat hub refused a message (${r.status})`)
    }),
    close: () => ctrl.abort(),
  }
}

/** One call at a time, in the order they were made; a refused one is its caller's, and the next still goes. */
export function oneAtATime(post: (text: string) => Promise<void>): (text: string) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return (text) => {
    const run = tail.then(() => post(text))
    tail = run.catch(() => { /* said to its own caller */ })
    return run
  }
}

export type HubClientOptions = {
  url: string
  /** a fresh ticket for this start */
  ticket: () => Promise<string>
  transports?: HubTransport[]
  /** the server's KeepAliveInterval is 15 s and its ClientTimeoutInterval 150 s */
  pingMs?: number
  serverTimeoutMs?: number
  openMs?: number
}

export class HubClient {
  state: HubState = 'disconnected'
  transport: HubTransport | '' = ''
  /** after a connection that was up has gone, however it went; not after a start that failed */
  onclose: ((error?: Error) => void) | null = null

  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private next = 1
  private conn: Transport | null = null
  private buffer = ''
  private handshaken = false
  private handshake: { resolve: () => void; reject: (e: Error) => void } | null = null
  private lastSent = 0
  private lastHeard = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private done = false
  private readonly opts: HubClientOptions

  constructor(opts: HubClientOptions) {
    this.opts = opts
  }

  /** A server-to-client call by name (case does not matter, as in SignalR); returns the undo. */
  on(method: string, fn: (...args: unknown[]) => void): () => void {
    const key = method.toLowerCase()
    const set = this.handlers.get(key) ?? new Set()
    set.add(fn)
    this.handlers.set(key, set)
    return () => set.delete(fn)
  }

  async start(): Promise<void> {
    if (this.state !== 'disconnected' || this.done) throw new Error('a hub client starts once')
    this.state = 'connecting'
    const openMs = this.opts.openMs ?? 15_000
    try {
      const ticket = await this.opts.ticket()
      const wanted = this.opts.transports ?? ['WebSockets', 'ServerSentEvents']
      let last: unknown = null
      for (const kind of wanted) {
        if (kind === 'WebSockets' && typeof WebSocket === 'undefined') continue
        const offer = await negotiate(this.opts.url, ticket)
        if (!offer.transports.includes(kind)) continue
        try {
          const onText = (text: string) => this.receive(text)
          const onClose = (error?: Error) => this.teardown(error, true)
          this.conn = kind === 'WebSockets'
            ? await openWebSocket(this.opts.url, offer.token, ticket, onText, onClose, openMs)
            : await openServerSentEvents(this.opts.url, offer.token, ticket, onText, onClose, openMs)
          this.transport = kind
          break
        } catch (e) {
          last = e
        }
      }
      if (!this.conn) throw last instanceof Error ? last : new Error('no way to reach the chat hub')
      await this.shake(openMs)
      this.state = 'connected'
      this.lastHeard = this.lastSent = Date.now()
      this.timer = setInterval(() => this.tick(), 1_000)
    } catch (e) {
      this.teardown(e instanceof Error ? e : new Error(String(e)), false)
      throw e
    }
  }

  invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.state !== 'connected' || !this.conn) return Promise.reject(new Error('the chat is not connected'))
    const id = String(this.next++)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.write({ type: 1, invocationId: id, target: method, arguments: args }).catch((e: unknown) => {
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error('the message did not leave'))
      })
    })
  }

  async stop(): Promise<void> {
    if (this.state === 'connected') {
      try { await this.write({ type: 7 }) } catch { /* going anyway */ }
    }
    this.teardown(undefined, true)
  }

  private shake(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handshake = null
        reject(new Error('the chat hub did not answer the handshake'))
      }, timeoutMs)
      this.handshake = {
        resolve: () => { clearTimeout(timer); resolve() },
        reject: (e) => { clearTimeout(timer); reject(e) },
      }
      this.lastSent = Date.now()
      this.conn!.send(HANDSHAKE).catch((e: unknown) => this.handshake?.reject(e instanceof Error ? e : new Error('handshake')))
    })
  }

  private async write(frame: object): Promise<void> {
    if (!this.conn) throw new Error('the chat is not connected')
    this.lastSent = Date.now()
    await this.conn.send(record(frame))
  }

  private receive(text: string): void {
    this.lastHeard = Date.now()
    // a hidden tab's timers wake once a minute; a frame's arrival is not held back, so the keepalive rides it
    if (this.state === 'connected' && this.lastHeard - this.lastSent >= (this.opts.pingMs ?? 15_000)) {
      void this.write({ type: 6 }).catch(() => { /* the next frame or tick decides */ })
    }
    const { records, rest } = splitRecords(this.buffer + text)
    this.buffer = rest
    for (const raw of records) {
      let frame: Frame
      try {
        frame = JSON.parse(raw) as Frame
      } catch {
        this.teardown(new Error('the chat hub sent something unreadable'), true)
        return
      }
      if (!this.handshaken) {
        this.handshaken = true
        const h = this.handshake
        this.handshake = null
        if (typeof frame.error === 'string' && frame.error) {
          h?.reject(new Error(frame.error))
          return
        }
        h?.resolve()
        continue
      }
      this.dispatch(frame)
    }
  }

  private dispatch(frame: Frame): void {
    switch (frame.type) {
      case 1: {
        const fns = this.handlers.get(String(frame.target ?? '').toLowerCase())
        for (const fn of [...(fns ?? [])]) {
          try { fn(...(frame.arguments ?? [])) } catch { /* a listener's fault stays its own */ }
        }
        return
      }
      case 3: {
        const id = String(frame.invocationId ?? '')
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        if (frame.error) p.reject(new HubCallError(frame.error))
        else p.resolve(frame.result)
        return
      }
      case 7:
        this.teardown(frame.error ? new Error(frame.error) : undefined, true)
        return
      default:
        // 6 is the server's ping; the rest this chat never uses
        return
    }
  }

  private tick(): void {
    const now = Date.now()
    if (now - this.lastHeard > (this.opts.serverTimeoutMs ?? 30_000)) {
      this.teardown(new Error('the chat hub went quiet'), true)
      return
    }
    if (now - this.lastSent >= (this.opts.pingMs ?? 15_000)) {
      void this.write({ type: 6 }).catch(() => { /* the next tick decides */ })
    }
  }

  private teardown(error: Error | undefined, notify: boolean): void {
    if (this.done) return
    this.done = true
    const was = this.state
    this.state = 'disconnected'
    clearInterval(this.timer)
    const conn = this.conn
    this.conn = null
    try { conn?.close() } catch { /* already gone */ }
    const why = error ?? new Error('the chat connection closed')
    for (const p of this.pending.values()) p.reject(why)
    this.pending.clear()
    this.handshake?.reject(why)
    this.handshake = null
    if (notify && was === 'connected') this.onclose?.(error)
  }
}
