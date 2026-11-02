/**
 * EVERY PAGE ENDS WITH THE COPYRIGHT LINE (components/shared/SiteFooter, the
 * shell in components/Layout, the public pages the router serves outside it).
 *
 * tools/check-footer.mjs finds the page roots and holds their source to the
 * rule; this file draws them whole and reads what a person would read:
 *   · the last words on each public page are the copyright line, in a
 *     <footer>, and nothing is drawn after it;
 *   · in the signed-in shell the line closes the scrolling area, after the
 *     screen's own last row — never before it, never outside it;
 *   · the line is in the flow, never pinned over the content.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import SiteFooter, { COPYRIGHT } from '@/components/shared/SiteFooter'
import WelcomePage from '@/pages/WelcomePage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import ResetPage from '@/pages/ResetPage'
import InterviewSchedulerPage from '@/pages/InterviewSchedulerPage'

/** The pages animate in, and the animation asks the window for a resize
 *  listener; the token pages read their link from the address, where a
 *  HashRouter keeps it. The test window is deliberately bare
 *  (tests/spa/env.ts), so each render lends it those and takes them back. */
function draw(path: string, page: ReactNode): string {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener, location: g.location }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  g.location = { hash: `#${path}`, search: '', pathname: '/', href: `https://hub.test/#${path}` }
  try {
    return renderToString(<MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>)
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
    g.location = held.location
  }
}

/** The words a reader sees, in order. */
function words(html: string): string[] {
  return html
    .replace(/<!-- -->/g, '')
    .split(/<[^>]+>/)
    .map((t) => t.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim())
    .filter(Boolean)
}

describe('the copyright line', () => {
  it('reads exactly as asked, in a footer that stays in the flow', () => {
    assert.equal(COPYRIGHT, '© 2026 Asa LifeCare. All rights reserved.')
    const html = renderToString(<SiteFooter />)
    assert.match(html, /^<footer class="[^"]*">© 2026 Asa LifeCare\. All rights reserved\.<\/footer>$/)
    assert.doesNotMatch(html, /\b(fixed|absolute|sticky)\b/)
  })

  const pages: [string, string, ReactNode][] = [
    ['welcome', '/', <WelcomePage />],
    ['sign-in', '/login', <LoginPage />],
    ['registration', '/register?t=x', <RegisterPage />],
    ['password reset', '/reset?t=x', <ResetPage />],
    ['interview calendar', '/app/calendario/interview?t=x', <InterviewSchedulerPage />],
  ]
  for (const [name, path, page] of pages) {
    it(`is the last thing on the ${name} page`, () => {
      const html = draw(path, page)
      const said = words(html)
      assert.equal(said[said.length - 1], COPYRIGHT)
      assert.equal(said.filter((w) => w === COPYRIGHT).length, 1)
      // nothing but the page's own closing tags after the footer
      const tail = html.slice(html.lastIndexOf('</footer>') + '</footer>'.length)
      assert.match(tail, /^(<\/[a-z]+>)*$/)
    })
  }

  it('joins a page footer that is already there, so the page keeps one footer landmark', () => {
    const html = draw('/', <WelcomePage />)
    assert.equal(html.match(/<footer\b/g)?.length, 1)
    assert.match(renderToString(<SiteFooter as="p" />), /^<p class="[^"]*">© 2026 Asa LifeCare\. All rights reserved\.<\/p>$/)
  })

  /* The shell is not drawn here: it loads the whole app, whose modules wire
     themselves to a real window at import. Its order — after the screen,
     inside the scrolling area, nothing after it — is held by check-footer. */
  it('the shell draws it after the screen, inside the scrolling area', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/Layout.tsx'), 'utf8')
    const main = src.slice(src.indexOf('<main id={MAIN_SCROLL_ID}'), src.indexOf('</main>'))
    assert.ok(main.indexOf('<Outlet />') < main.indexOf('<SiteFooter'))
    assert.ok(main.indexOf('<SiteFooter') < main.lastIndexOf('</motion.div>'))
  })
})
