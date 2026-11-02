// THE PLAYGROUND MANUAL — in English, plain enough for a ten-year-old reader, covering every mode, practical, and…
// PRACTICAL means task-first: a recipe that ends in a published app, then goal → exact clicks, then symptom → fix…
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorldOffered } from '@/lib/worldOffered'

/* ── tiny local grammar ── */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`pg-man-${id}`} className="mt-7 scroll-mt-2 first:mt-0">
      <h3 className="mb-2 text-[15px] font-bold text-text-1">{title}</h3>
      <div className="space-y-1.5 text-[12.5px] leading-5 text-text-2">{children}</div>
    </section>
  )
}

/** A button name, drawn the way the screen draws it. */
function B({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11.5px] font-semibold text-text-1">{children}</span>
}

/** One goal → the clicks. The whole manual wants to be this table. */
function Task({ goal, children }: { goal: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border/50 py-2 first:border-0">
      <span className="text-[12.5px] font-semibold text-text-1">{goal}</span>
      <span className="min-w-0 text-[12.5px] leading-5 text-text-2">{children}</span>
    </div>
  )
}

function Fix({ when, children }: { when: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border/50 py-2 first:border-0">
      <span className="text-[12.5px] font-semibold text-tint-fg-amber">{when}</span>
      <span className="min-w-0 text-[12.5px] leading-5 text-text-2">{children}</span>
    </div>
  )
}

/** A word and what it means here — the two-column glossary row. */
function Word({ w, children }: { w: string; children: React.ReactNode }) {
  return (
    <p><span className="font-semibold text-text-1">{w}</span> — {children}</p>
  )
}

/** The jump-bar entries, in reading order. */
const TOC = [
  ['start', 'Start here'],
  ['tour', 'The studio'],
  ['tasks', 'How do I…'],
  ['types', 'Page types'],
  ['ai', 'The AI draft'],
  ['gallery', 'The Gallery'],
  ['data', 'Your data'],
  ['words', 'Words'],
  ['limits', 'Limits'],
  ['fix', 'Fix it'],
] as const

export default function PlaygroundManual({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bodyRef = useRef<HTMLElement | null>(null)
  const worldOn = useWorldOffered()

  // Esc closes — but only while open, so the listener costs nothing otherwise.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const jump = (id: string) => {
    bodyRef.current?.querySelector(`#pg-man-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <aside
      ref={bodyRef}
      role="complementary"
      aria-label="Playground manual"
      aria-hidden={!open}
      className={cn(
        'scroll-thin fixed bottom-0 right-0 top-[calc(68px+var(--hub-strip-h,0px))] z-40 w-full overflow-y-auto sm:w-[384px]',
        'border-l border-border bg-surface p-5 shadow-3 transition-transform duration-200',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[19px] font-bold text-text-1">How to use the Playground</h2>
            <p className="mt-0.5 text-[13px] text-text-2">
              Build your own app here, no code needed. Keep this open while you work — the studio stays clickable.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2"
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>

        {/* ── the jump-bar: a manual this size is looked up, not read ── */}
        <div className="sticky top-0 z-[1] -mx-1 mt-3 flex flex-wrap gap-1 border-b border-border bg-surface px-1 py-2">
          {TOC.map(([id, label]) => (
            <button
              key={id}
              onClick={() => jump(id)}
              className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── the recipe: from nothing to a live app ── */}
        <div id="pg-man-start" className="mt-4 scroll-mt-2 rounded-xl bg-detail-hero p-5">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/50">Your first app, in five steps</p>
          <ol className="mt-2 space-y-2 text-[13px] leading-5 text-white/85">
            <li><span className="font-bold text-white">1.</span> Type what you want in the top box — one sentence, like <em>“A fleet tracker with vehicles, mileage logs and a maintenance checklist”</em> — and press <span className="font-semibold text-white">Generate draft</span>. Wait 30–90 seconds. The whole app arrives at once: name, pages, settings, example rows.</li>
            <li><span className="font-bold text-white">2.</span> No ideas, or the button is gray? Press <span className="font-semibold text-white">Gallery</span> and hit <span className="font-semibold text-white">Install</span> on one of the fifteen ready-made apps instead. It loads as a draft, exactly like a generated one.</li>
            <li><span className="font-bold text-white">3.</span> Look at the <span className="font-semibold text-white">Live preview</span> on the right. It redraws about half a second after every change you make.</li>
            <li><span className="font-bold text-white">4.</span> Fix what you don’t like: the name and color in <span className="font-semibold text-white">App identity</span>, the tables and columns in <span className="font-semibold text-white">Page schema</span>, the example rows in <span className="font-semibold text-white">Sample data</span>, the switches in <span className="font-semibold text-white">Rearrange controls</span>.</li>
            <li><span className="font-bold text-white">5.</span> Press <span className="font-semibold text-white">Publish app</span>. Done — your app gets a tile in the App Hub, a place in the sidebar under its category, and a ⌘K entry. People can open it and use it with real data.</li>
          </ol>
          <p className="mt-3 border-t border-white/15 pt-2.5 text-[12.5px] text-white/60">
            The one rule: <span className="font-semibold text-white/85">nothing is real until you press Publish.</span>{' '}
            Before that it’s a draft only you can see — you can’t break anything by trying things.
          </p>
        </div>

        {/* ── the studio tour ── */}
        <Section id="tour" title="The studio, card by card">
          <p>The screen is two columns. The right one is always the <B>Live preview</B>. The left one stacks the cards you work in, top to bottom:</p>
          <Word w="Describe your app">the sentence box and <B>Generate draft</B> / <B>Discard</B>. The starting point.</Word>
          <Word w="App identity">how the app introduces itself — <B>Name</B>, <B>Tagline</B>, <B>Icon</B>, <B>Accent tint</B> (its color), <B>Category</B> (its shelf), and the <B>Audience</B> boxes (who sees it).</Word>
          <Word w="Pages">the list of pages. Click one to select it — everything below follows the selected page. <B>Add page</B>, arrows to reorder, <B>X</B> to remove. The first page is where the app opens.</Word>
          <Word w="Page schema">the selected page’s shape: its type (the 11 cards), its <B>Page title</B>, its <B>Data source</B>, its <B>Config</B> (Visual or JSON), and its buttons (the Actions builder).</Word>
          <Word w="Sample data">the example rows that make the preview look alive, in an editable grid — with <B>Generate rows</B> and the <B>Image bank</B>.</Word>
          <Word w="Rearrange controls">four switches deciding what people may do on the published page.</Word>
          <Word w="Feeding this page from an automation">a fold-out card for the curious: it names your page’s spreadsheet tab and hands you a copy-paste script snippet for writing rows into it from automations.</Word>
          <Word w="My playground apps">every app this browser has built — edit, duplicate, export, open or delete each one. A green <B>server</B> badge means it’s live for everyone; gray <B>local</B> means this browser only.</Word>
          <p className="text-text-3">The first time anyone opens the Playground, a five-step welcome tour shows once (“The studio, in five ideas”). This manual is the version you can come back to whenever you want.</p>
        </Section>

        {/* ── goal → clicks ── */}
        <Section id="tasks" title="What do you want to do?">
          <div>
            <Task goal="Start over">Press <B>Discard</B>. The studio empties so you can try a new sentence. Published apps are never touched by it.</Task>
            <Task goal="Add a page">In <B>Pages</B> press <B>Add page</B> — an app holds up to 12, which is the server’s ceiling, not a suggestion. Use the arrows to reorder; the first page is the front door.</Task>
            <Task goal="Change what a page is">Select the page, then pick another card under <B>Page type</B>. The studio only replaces settings you haven’t touched — your own typing is kept.</Task>
            <Task goal="Change table columns">Page schema → <B>Visual</B> → the Columns builder: add, rename, and give each column a kind — text, avatar+text, chip, chips, date, number, progress, image, doc. You can also map values to colors (“Value → tint”), make columns sortable, and set widths.</Task>
            <Task goal="Change stages / widgets / sections">Same place, different builder per type: Pipeline and Board get a Stages builder, Dashboard gets a Widgets builder, Detail gets stats and sections, Schedule gets resources and event types, Documents gets collections, Videos gets channels.</Task>
            <Task goal="Use real platform data">In <B>Data source</B> choose <B>Existing resource</B> and search — your page then reads live data the platform already has (people, shifts…). The studio probes one live row and tells you how your columns match; a warning never blocks publishing.</Task>
            <Task goal="Keep the app’s own data">Leave <B>Data source</B> on <B>New tab</B> — publishing creates a brand-new spreadsheet tab just for this page, seeded once with your sample rows.</Task>
            <Task goal="Make example rows">In <B>Sample data</B> press <B>Generate rows</B> — rows shaped to fit your columns. Or <B>Add row</B> and type your own; a new field name + <B>Field</B> adds a column to every row. Every row needs its own unique <span className="font-mono text-[11.5px]">id</span> text — that’s the number-one validation error.</Task>
            <Task goal="Put pictures in rows">Any picture-ish cell (avatar, photo, image, cover…) gets a small button — pick from the <B>Image bank</B> instead of hunting for URLs.</Task>
            <Task goal="Let people add or edit rows">In <B>Rearrange controls</B> switch on <B>Allow create records</B> and <B>Allow inline edit</B> — the studio builds the forms from your columns automatically. <B>Allow export</B> (CSV/Excel menu) and <B>Allow row ordering</B> (drag) live there too.</Task>
            <Task goal="Add buttons to rows or headers">Page schema → Actions builder → <B>Add action</B>. Six kinds, as the menu names them: <em>Patch — update row fields</em>, <em>Call — run a hub action</em>, <em>Link — open a URL</em>, <em>Create — add a row</em>, <em>Delete — remove this row</em>, <em>Navigate — go to another app page</em>. Values can use <span className="font-mono text-[11.5px]">{'{row.key}'}</span> and <span className="font-mono text-[11.5px]">{'{today}'}</span>. You can add a “show when” condition and your own confirm text; header buttons never offer Patch or Delete because there is no row under them. Anything marked <B>reaches people</B> really contacts someone and always asks first. Delete always asks too.</Task>
            <Task goal="Choose who sees the app">In <B>App identity</B>, the <B>Audience</B> boxes. Careful — it’s backwards from what you’d guess: <em>no boxes ticked = everyone sees it</em>. Ticking roles (admin, manager, staff, client) narrows it to just those roles.</Task>
            <Task goal="Publish it">Press <B>Publish app</B>. The studio checks every page first; if something’s off, it jumps you straight to the page that needs fixing and says what’s wrong.</Task>
            <Task goal="Change it after publishing">In <B>My playground apps</B> press the pencil (<em>Edit in studio</em>), make your changes, press <B>Publish changes</B>. Same app, same address, version bumped. Real rows people typed are never touched.</Task>
            <Task goal="Feed it from an automation">Open the fold-out card <B>Feeding this page from an automation</B> — it shows your page’s tab name and a ready-made script snippet with a copy button. Rows written into that tab show up on the next read.</Task>
            <Task goal="Give it to someone">Press <B>Export as JSON bundle</B> — you get an <span className="font-mono text-[11.5px]">asa-app-*.json</span> file. They press <B>Import</B> → <B>Load into studio</B> and publish their own copy, with its own tabs.</Task>
            <Task goal="Copy it">Press <B>Duplicate</B> — a local “…copy” appears with fresh tabs of its own once published.</Task>
            <Task goal="Remove it">The trash button in <B>My playground apps</B>. <span className="font-semibold text-tint-fg-pink">It does not ask first</span> — the app leaves the hub, sidebar and ⌘K immediately. Its data tabs stay on the spreadsheet untouched: destroying data is a human decision, made on the sheet, never a button.</Task>
          </div>
        </Section>

        {/* ── the one real decision: the page type ── */}
        <Section id="types" title="The 11 page types (pick per page)">
          <div className="grid gap-y-1">
            {([
              ['Sheet', 'a table you can search and sort — the workhorse; up to 6 columns look best'],
              ['Dashboard', 'tiles, charts and lists on one board — up to 6 widgets'],
              ['Pipeline', 'a funnel — things move through 3–5 stages, top to bottom'],
              ['Board', 'kanban columns side by side — same stages idea, horizontal'],
              ['Documents', 'a small library with a full-screen reader'],
              ['Videos', 'a media shelf that remembers watch progress'],
              ['Schedule', 'a week / month calendar with resources and event types'],
              ['Detail', 'one record shown big, like a profile — stats and sections'],
              ['Gallery', 'a photo grid with a lightbox (the page type, not the button)'],
              ['Checklist', 'walk through it and tick things off — “required” is yes/no'],
              ['Timeline', 'events in time order, grouped by day'],
            ] as const).map(([name, what]) => (
              <p key={name}><span className="font-semibold text-text-1">{name}</span> — {what}</p>
            ))}
          </div>
          <p className="text-text-3">Mixing types is the point: a Dashboard first page, a Sheet behind it, a Checklist for the routine — that’s a normal app here.</p>
        </Section>

        {/* ── the AI lane, honestly ── */}
        <Section id="ai" title="How “Generate draft” really works">
          <p>Your sentence goes to the server, where a model designs the whole app — pages, settings and example rows — and sends it back <em>in one piece</em>. That’s why the wait is 30–90 seconds with nothing “streaming in”: the progress lines (“Brief sent…”, “The model is designing pages…”, “Still writing…”) are honest status, not the answer leaking out.</p>
          <p>When it lands, three things happen:</p>
          <p>• The studio is <em>replaced</em> with the new draft (it asks first if you had unsaved work: <em>“Replace the current draft with the generated one?”</em>).</p>
          <p>• A tidy-up pass brings the draft up to platform rules and lists every change it made in the amber <em>“The model adjusted N things”</em> block — nothing is changed silently.</p>
          <p>• A small note says which model answered (<em>“generated via …”</em>), and the fold-out <em>“The last ask, as it went”</em> keeps the full play-by-play if you’re curious.</p>
          <p>If no model answers at all, the studio builds a simpler draft from your keywords right in the browser — the toast says <em>“No model answered — drafted locally”</em>. Same sentence, same local draft, every time: the helpers are repeatable on purpose.</p>
        </Section>

        {/* ── the gallery, by name ── */}
        <Section id="gallery" title="The Gallery’s fifteen ready-made apps">
          <p>Press <B>Gallery</B> → <B>Install</B> on any of these. Each installs as a fresh draft — look it over, make it yours, publish:</p>
          <div className="grid gap-y-1">
            {([
              ['House Supplies', 'stock levels, par levels and reorder flags for every house'],
              ['Maintenance Log', 'report, track and close house repairs'],
              ['Incident Log', 'log an incident in under a minute, review them together'],
              ['Fridge Temps', 'twice a day, every unit, written down'],
              ['Cleaning Rota', 'every job named, claimed and closed'],
              ['Grocery Runs', 'what each house needs, who is getting it'],
              ['Client Outings', 'plan trips, drives and appointments for the residents'],
              ['Staff Training', 'short videos and photo guides for everyday care tasks'],
              ['Shift Swaps', 'post a shift you cannot cover, claim one you can'],
              ['Visitor Log', 'who is in the house, visiting whom, right now'],
              ['Key Register', 'every key and fob, accounted for'],
              ['Vehicle Checks', 'every van checked before its first run'],
              ['Purchase Requests', 'from “we need it” to “it arrived”, one board'],
              ['Meeting Notes', 'staff meeting minutes and decisions, searchable'],
              ['Policy Library', 'the reading room: policies, procedures and guidance'],
            ] as const).map(([name, what]) => (
              <p key={name}><span className="font-semibold text-text-1">{name}</span> — {what}</p>
            ))}
          </div>
        </Section>

        {/* ── where the data lives ── */}
        <Section id="data" title="Where your app and its data actually live">
          <p>When you publish, the server writes two kinds of things into the big spreadsheet:</p>
          <p>• <span className="font-semibold text-text-1">The recipe</span> — one row per page in a tab called <span className="font-mono text-[11.5px]">app_builder</span>: the app’s name, colors, audience, and each page’s settings. That’s how every browser can draw your app exactly like the built-in ones.</p>
          <p>• <span className="font-semibold text-text-1">The data</span> — one tab per page (named <span className="font-mono text-[11.5px]">pg_…</span> after your app), with <span className="font-mono text-[11.5px]">id</span> plus your columns as the header. Your sample rows are poured in once, when the tab is born. From then on the rows belong to the people using the app.</p>
          <p>Three consequences worth knowing:</p>
          <p>• Editing sample data later changes the <em>preview</em>, never the live tab — republishing doesn’t reseed.</p>
          <p>• You (or an automation) can type rows straight into the <span className="font-mono text-[11.5px]">pg_…</span> tab on the sheet — they’re live on the next read. The fold-out card gives you a script snippet for exactly that.</p>
          <p>• Deleting the app removes the recipe, never the data tabs. They stay on the sheet until a person removes them by hand.</p>
          <p>A page bound to an <B>Existing resource</B> is different: it never gets its own tab — it reads the platform’s live data, and its sample rows exist only for the preview.</p>
        </Section>

        {/* ── words ── */}
        <Section id="words" title="Words you’ll bump into">
          <div className="grid gap-y-1">
            <Word w="Draft">your work in the studio. Only you see it. Free to break.</Word>
            <Word w="Publish">the moment the draft becomes a real app for other people.</Word>
            <Word w="Config">a page’s settings. <B>Visual</B> and <B>Advanced (JSON)</B> are two faces of the same text.</Word>
            <Word w="JSON">the bracket-y text behind Visual mode. Green chip “Valid JSON” = fine; pink chip = fix it in Advanced.</Word>
            <Word w="Resource">a named pile of data the platform serves — people, shifts, your app’s own tab.</Word>
            <Word w="Tab">one sheet of the big spreadsheet. Your app’s pages get tabs named <span className="font-mono text-[11.5px]">pg_…</span></Word>
            <Word w="id">every row’s own name-tag. Must exist, must be text, must be unique per row.</Word>
            <Word w="Audience">who may see the app. Empty = everyone; ticked roles = only them.</Word>
            <Word w="Key vs Label">the key is the row field’s real name (<span className="font-mono text-[11.5px]">due_date</span>); the label is what people read (“Due date”).</Word>
            <Word w="Bind">pointing a page at an existing resource instead of its own new tab.</Word>
            <Word w="Widget">one tile on a Dashboard page — a stat, a chart, a list.</Word>
            <Word w="Stage">one column of a Board, or one step of a Pipeline’s funnel.</Word>
          </div>
        </Section>

        {/* ── limits ── */}
        <Section id="limits" title="The server’s hard limits (so the numbers don’t surprise you)">
          <p>• <span className="font-semibold text-text-1">12 pages</span> per app · <span className="font-semibold text-text-1">200 rows</span> seeded per tab · tab names up to <span className="font-semibold text-text-1">48 characters</span> (a very long app name trips this — shorten the name) · config JSON up to <span className="font-semibold text-text-1">8000 characters</span> per page.</p>
          <p>• Generated drafts are tidied to platform rules — at most 6 table columns, 4 stat tiles, 6 dashboard widgets, 3–5 stages, 5–8 sample rows. Every adjustment is listed in the amber “The model adjusted N things” block, so nothing changes silently.</p>
          <p>• Action ids <span className="font-mono text-[11.5px]">edit / delete / share / assign / view</span> are reserved words — a custom action with one of those names runs the built-in behavior instead.</p>
          <p>• <B>Generate draft</B> is admin-only on the server; publishing to the whole company is too.{worldOn && ' Builders without that power publish to their own world instead — the app is theirs alone.'}</p>
        </Section>

        {/* ── symptom → fix ── */}
        <Section id="fix" title="Something looks wrong?">
          <div>
            <Fix when="Generate draft is gray">That button asks the model on the server, and it’s for admins. Use <B>Gallery</B>, <B>Import</B>, or build by hand — those always work.</Fix>
            <Fix when="It’s taking forever">The model really takes 30–90 seconds and the app arrives all at once — the counter is normal, nothing is stuck. If no model answers, a simpler draft is built from your keywords automatically (“No model answered — drafted locally”).</Fix>
            <Fix when="“The model adjusted N things”">Not an error. The studio tidies drafts to the limits above and lists every change. Read it, dismiss it.</Fix>
            <Fix when="“Visual mode needs valid JSON”">The raw text behind the visual controls is broken. Switch to <B>Advanced (JSON)</B> — the error names the line — fix it, and Visual comes back. Visual never rewrites your broken text behind your back.</Fix>
            <Fix when="Publish refused my rows">Almost always the id rule: every sample row needs its own unique text <span className="font-mono text-[11.5px]">id</span>. The studio jumps to the page and says which one.</Fix>
            <Fix when="“Name too long” on publish">The app’s name becomes its tab names, and tabs cap at 48 characters. Shorten the name and publish again.</Fix>
            <Fix when="My new rows don’t show on the live app">Sample rows fill the app’s tab <em>once</em>, on the very first publish. After that the rows belong to the people using the app — republishing never rewrites them. On an <B>Existing resource</B> page, sample rows are preview-only, always.</Fix>
            <Fix when="No edit form on the published page">Switch on <B>Allow inline edit</B> (and <B>Allow create records</B>) in Rearrange controls, then <B>Publish changes</B>. If the switches are already on, know that the built forms start admin-only — that’s the safe default.</Fix>
            <Fix when="The grid hides some of my fields">The Sample data grid shows the first 8 fields; the rest are safe and editable in <B>Advanced (JSON)</B> — the notice under the grid says exactly that.</Fix>
            <Fix when="My app isn’t on my other computer">The <B>My playground apps</B> list is this browser’s notebook. The <em>published</em> app is live for everyone — only the draft list stays here.</Fix>
            <Fix when="Badge says “local”, not “server”">The server couldn’t be reached when you published, so the app works in this browser only. Publish again later and it lands for everyone.</Fix>
            <Fix when="“Another publish is writing…”">Two publishes can’t write at the same time — the server locks for a few seconds. Wait a moment and press publish again.</Fix>
            <Fix when="I renamed it but the id kept the old name">By design: renaming while editing never renames the app’s id or its tabs — links and data stay stable. Only a brand-new app takes its id from its name.</Fix>
            <Fix when="Delete “didn’t stick”">If the toast said <em>“Deleted locally; the server copy resisted”</em>, the server rows survived and the app returns on reload. Delete again when the server answers.</Fix>
            <Fix when="Same sentence, same app again">On purpose. The helpers are repeatable — retrying doesn’t roll dice. Change the sentence to change the draft.</Fix>
            <Fix when="Two things called “Gallery”">The top-bar <B>Gallery</B> button is the store of ready-made apps. The page type “Gallery” is a photo grid. Different things, same word.</Fix>
          </div>
        </Section>

        <div className="mt-7 border-t border-border pt-3 text-[12px] text-text-3">
          Short version: describe it or install one, watch the preview, fix what you don’t like, press{' '}
          <span className="font-semibold text-text-2">Publish app</span>. Drafts are free. Published apps can
          always be edited again — or removed.
        </div>
      </div>
    </aside>
  )
}
