import path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"
import { readdirSync, readFileSync } from "fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

/**
 * The build's own stamp, read by the master's versions box (Settings › Profile): the commit, when it was built, and
 * the fingerprint of the back-end code it was built with — sha256 over every top-level *.py of app/ and of server/,
 * by name, as app/main.py and server/snapshot_service.py fingerprint the code they run.
 */
function codeStamp(dir: string): string {
  const h = createHash("sha256")
  try {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".py")).sort()) {
      h.update(name + "\n")
      h.update(readFileSync(path.join(dir, name)))
      h.update("\n")
    }
  } catch {
    return ""
  }
  return h.digest("hex").slice(0, 12)
}

/** git's answer here; else the deploy's HUB_BUILD_* (a tree exported with `git archive` carries no .git). */
function gitOr(cmd: string, env: string): string {
  try {
    return execSync(cmd, { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    return (process.env[env] || "").trim()
  }
}

/**
 * The software version: the commit, its number (the commits on the line up to it, so every release counts up) and
 * the branch it was built from — anything but main is a dev build.
 */
function buildStamp(): string {
  const commit = gitOr("git rev-parse --short=8 HEAD", "HUB_BUILD_COMMIT")
  const number = gitOr("git rev-list --count HEAD", "HUB_BUILD_NUMBER")
  const branch = gitOr("git rev-parse --abbrev-ref HEAD", "HUB_BUILD_BRANCH")
  return JSON.stringify({ commit, number, branch, at: new Date().toISOString(),
                          python: codeStamp(path.join(__dirname, "app")),
                          relay: codeStamp(path.join(__dirname, "server")) })
}

/**
 * Libraries grouped into vendor chunks that outlive a release: the app's own
 * code changes every deploy, these only when a dependency does, so a returning
 * browser keeps them from the one-year /assets cache. A vendor chunk imports
 * only other vendor chunks, never the app's (its hash would follow every
 * release). Anything unlisted is placed by Rollup beside the code that uses it.
 */
const VENDOR_CHUNKS: Record<string, RegExp> = {
  'vendor-react': /^(react|react-dom|scheduler|react-router|cookie|set-cookie-parser|zustand|use-sync-external-store|react-is|prop-types)$/,
  'vendor-icons': /^lucide-react$/,
  'vendor-motion': /^(framer-motion|motion-dom|motion-utils)$/,
  'vendor-ui': /^(@radix-ui\/.+|@floating-ui\/.+|cmdk|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|get-nonce|tslib|clsx|tailwind-merge|class-variance-authority)$/,
  'vendor-charts': /^(recharts|recharts-scale|react-smooth|victory-vendor|d3-.+|internmap|decimal\.js-light|lodash|eventemitter3|fast-equals|tiny-invariant)$/,
  'vendor-dnd': /^@dnd-kit\/.+$/,
  'vendor-date': /^date-fns$/,
}

function vendorChunk(id: string): string | undefined {
  // the CommonJS interop helpers every CJS library above needs
  if (id.includes('commonjsHelpers')) return 'vendor-react'
  const at = id.lastIndexOf('/node_modules/')
  if (at < 0) return undefined
  const parts = id.slice(at + '/node_modules/'.length).split('/')
  const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  for (const [chunk, re] of Object.entries(VENDOR_CHUNKS)) if (re.test(pkg)) return chunk
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  define: {
    "import.meta.env.VITE_HUB_BUILD": JSON.stringify(buildStamp()),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
        // the served bundle is found by `index-<hash>.js` (server/snapshot_service.py,
        // lib/chatPresence): only the entry may carry that name
        entryFileNames: 'assets/index-[hash].js',
        chunkFileNames: (chunk) => (/index$/i.test(chunk.name) ? 'assets/chunk-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
