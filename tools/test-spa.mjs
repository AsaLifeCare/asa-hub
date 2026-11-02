#!/usr/bin/env node
/**
 * THE SPA'S REGRESSION TESTS — node's own test runner over the real modules.
 *
 * WHY THIS EXISTS. Every other verdict in `npm run check` reads the SPA's
 * source for shapes (one door, isolation, widths, contracts) or tests the
 * relay; nothing ran a screen's own logic. The Daily notes pager shipped with
 * its page number lost whenever the accordion unmounted the section, and no
 * test could have said so. This is the harness that can, with nothing
 * installed for it:
 *
 *   - every tests/spa/*.test.ts(x) is TYPE-CHECKED against the source it
 *     imports (tsc, tests/spa/tsconfig.json), so a test cannot drift from the
 *     signatures it claims to hold;
 *   - then BUNDLED with esbuild — '@/…' resolved to src/, Vite's
 *     `import.meta.env` defined, tests/spa/env.ts injected ahead of every
 *     module (storage, a window, an empty document) — into a temporary folder
 *     outside the tree;
 *   - and RUN with `node --test`. Hooks are mounted by react-dom's real client
 *     renderer (tests/spa/react-host.ts), so state, unmounting and remounting
 *     are React's own; a SCREEN is drawn whole by react-dom/server, so a test
 *     can hold the component itself to what its hooks promise — a hook that
 *     keeps the page proves nothing if the screen stops calling it.
 *
 * Nothing about the modules under test is reimplemented or mocked. A screen
 * that reads over the network is answered at `fetch`, the ground it stands on,
 * with the door's own envelope.
 *
 *   npm run test:spa
 *   node tools/test-spa.mjs pager        (only the files whose name holds "pager")
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'tests/spa')
const only = process.argv[2] ?? ''

const tests = readdirSync(dir)
  .filter((f) => /\.test\.tsx?$/.test(f) && f.includes(only))
  .sort()
  .map((f) => resolve(dir, f))

if (!tests.length) {
  console.error(`test:spa — no tests/spa/*.test.ts${only ? ` matching "${only}"` : ''}`)
  process.exit(1)
}

/* ---------- the types, before anything runs ------------------------------ */
const tsc = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(dir, 'tsconfig.json')],
  { cwd: root, stdio: 'inherit' },
)
if (tsc.status !== 0) {
  console.error('test:spa — the tests do not type-check against the source; nothing was run')
  process.exit(1)
}

/* ---------- the bundles, outside the tree -------------------------------- */
const out = mkdtempSync(join(tmpdir(), 'asa-spa-tests-'))
let status = 1
try {
  await build({
    entryPoints: tests,
    outdir: out,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    jsx: 'automatic',
    inject: [resolve(dir, 'env.ts')],
    // react-dom/server's node build is CommonJS that requires node's own
    // modules (stream, util); an ES bundle has no `require` to hand it
    banner: { js: "import { createRequire as spaCreateRequire } from 'node:module'; const require = spaCreateRequire(import.meta.url);" },
    alias: { '@': resolve(root, 'src') },
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': JSON.stringify({ DEV: false, PROD: true, MODE: 'test', BASE_URL: './', SSR: false }),
    },
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.webp': 'empty' },
    logLevel: 'error',
  })
  const bundles = tests.map((t) => join(out, basename(t).replace(/\.tsx?$/, '.mjs')))
  // the bundles run from a temporary folder: SPA_ROOT is where a test finds
  // the source it reads as text (the chart pages' hold on the Daily place)
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...bundles], {
    stdio: 'inherit',
    env: { ...process.env, SPA_ROOT: root },
  })
  status = run.status ?? 1
} finally {
  rmSync(out, { recursive: true, force: true })
}
process.exit(status)
