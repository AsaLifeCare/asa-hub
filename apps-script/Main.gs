/**
 * ASA Hub API — SELF-CONTAINED 
 */
/** True while the CURRENT execution belongs to the service identity.
 *  Housekeeping rides only these reads, so humans never pay for it. */
var HUB_IS_SERVICE_REQ = false;

/**
 * The action this execution is running, set once by the dispatcher below.
 *
 * It exists so a thing deep inside a handler can ask which conversation it is
 * part of without every caller in between passing it down — the opt-out brake
 * reads it (OptOut.gs) to tell a suppression about hiring from one about
 * staff. Anything that runs without a dispatch — a trigger, a sweep, an
 * editor run — leaves it empty, and empty is read as "unknown", which is
 * always the careful answer.
 */
var HUB_ACTION_NOW = '';
/** The active USER WORLD for the CURRENT execution — null means company.
 *  Set per request in doPost (World.gs resolves it), reset at the top. */
var HUB_WORLD_CTX = null;
/** The active TENANT for the CURRENT execution — null means headquarters.
 *  Set per request in doPost (Tenant.gs resolves it), reset at the top.
 *  Unlike a world it NEVER short-circuits route(): every adapter and guard
 *  keeps running, and the tenant only narrows which rows answer. */
var HUB_TENANT_CTX = null;
/** The PLATFORM MEMBER this execution is visiting — null means nobody.
 *  A person, not a place: their badge, their access and the work owned by
 *  them. READ ONLY; every write keeps the signed-in account (Members.gs). */
var HUB_MEMBER_CTX = null;
/** The relay's write id for the write running now ('' for none): a chat send names its row by it (Chat.gs). */
var HUB_WRITE_ID = '';

/**
 * ACTIONS A VISIT DOES NOT APPLY TO (found live).
 *
 * A member visit rewrites the session user with the visited person's badge,
 * and hubPolicyGate_ runs on that rewritten user BEFORE the handler does. For
 * almost everything that is exactly right — it is what stops a visit widening
 * anybody. For the handful below it is asking the wrong person: these are
 * facts about WHO IS SIGNED IN, not about whose work is on screen.
 *
 * The cost of getting it wrong was not subtle. Entering a member refused
 * platformMembersList on a staff role, so every member card left the stack —
 * including the one that leads back out — and tenantsList answered with the
 * visited person's reach, so the franchise chip went with them. A reload
 * returned to the visit, already empty, which is why it looked permanent.
 * Fixing it inside the handlers was not enough: the door refused before the
 * room got a say.
 */
var HUB_CALLER_OWN_ACTIONS = [
  // the roster of my platform, and every door that changes it
  'platformMembersList', 'platformMemberAsk', 'platformMemberAuthorize',
  'platformMemberRemove', 'platformMemberCheck', 'platformMemberSweep',
  // which places I may stand in — the stack is drawn from this
  'tenantsList',
  // my own world, and the door only I may close on it
  'worldGet', 'worldEnsure', 'myWorldAccessList', 'myWorldAccessSet',
  /**
 * MY OWN NAME, FACE AND PASSWORD (found, after the identity
   * flipped). profileUpdate writes `userSetFields_(user.id, fields)` and
   * `fields` can carry `pass_hash` — so with the session wearing the visited
   * person's identity, opening your own profile during a visit and pressing
   * save would have written your name, your photo and YOUR NEW PASSWORD onto
   * THEIR account row. That is not "a write lands in the environment you are
   * standing in": a profile is not environment data, it is who is signed in,
   * and this is the category this list exists for.
   */
  'profileUpdate',
  // the other side of the link: which platforms I am on, and leaving one.
  // Asked of a rewritten user these would answer for the person being visited,
  // which is the owner's action wearing the wrong face.
  'platformMemberMine', 'platformMemberLeave'
];

function hubCallerOwnAction_(action) {
  return HUB_CALLER_OWN_ACTIONS.indexOf(String(action || '')) !== -1;
}

/**
 * The account holding the session, kept whole across a member visit. A visit
 * rewrites `user` with the visited person's badge on purpose; anything that
 * asks WHO IS SIGNED IN — rather than "what may be seen right now" — reads
 * this instead. Null when nobody is being visited, which is every request.
 */
var HUB_CALLER = null;
/** Legacy governed talent sheet — READ ONLY, only by syncFromLegacy(). */
/** Legacy onboarding portal (Dropbox Sign marks) — READ ONLY, sync source. */
var USERS_TAB = 'users';
var SESSIONS_TAB = 'hub_sessions';
var SESSION_DAYS = 30;
var UPLOADS_FOLDER = 'ASA Hub Uploads';

/**
 * REMOVED PROP_SPREADSHEET_ID and SPREADSHEET_TITLE.
 *
 * They named the workbook this backend created for itself before HUB_DB
 * existed — six empty tabs the generic verbs would have filled — and the
 * property that pointed at it was never uncommented in Props.gs. The
 * comment above them said "kept for older helpers"; there were none, in
 * any file. A constant nothing reads is a name somebody will one day
 * follow to a workbook holding nothing.
 */

/**
 * One tab per resource. `readOnly: true` means create/delete return 405;
 * list/get/update still work.
 */
var RESOURCES = {
  people:        { sheet: 'people',        readOnly: false },
  // THE SITUATIONS TAB, NAMED SO THE BUILDER WRITES A FILE FOR IT.
  // The desk asked the door three times per visit and had no file to fall back
  // on, because a resource nobody names here is held `unrouted`: the builder
  // skips it, no slice is written, and the deposit's own cut answers 403
  // withheld rather than rows. Naming it is the whole fix — the emitter
  // re-derives the mode on every build and the relay re-reads on every call,
  // so nothing else has to change and nobody has to remember.
  // READ ONLY. The desk edits this tab through smartCommsSet, which resolves
  // the workbook itself; a writable route here would be a second way in.
  smartCommsDesk: { sheet: 'smart_comms', readOnly: true  },
  // The window a person may be asked in. Two screens read it as a flat file —
  // the When page and the Words page — and there has never been a file, nor an
  // action of that name: the router answered "Unknown action" and each mount
  // paid a real execution to be told no.
  commWhen:      { sheet: 'comm_when',    readOnly: true  },
  // The send ledger the Activity screen reads, and the delegation flows.
  // These two have real tabs; the seven still unrouted are served by ACTIONS
  // and have no tab at all, so a sheet route for them would point at nothing
  // and draw an empty screen instead of raising.
  smartCommsActivity: { sheet: 'smart_comms_sent', readOnly: true },
  medDelFlows:   { sheet: 'meddel_flows', readOnly: true  },
  // The punch record. PsiPunchesPage documents its own fast path in a header
  // comment — "a flat slice of the same rows, zero Apps Script" — and then had
  // no file to read, because the resource was not in the manifest at all. It
  // paid a door read with a 120-second timeout on every mount instead.
  psiPunches:    { sheet: 'psi_punches', readOnly: true  },
  // THE SEALED LANE'S TWO HOUSES, NAMED SO THE DEPOSIT CARRIES THEM
 // (operator: "tem um JSON que roda com todas as infos e
  // atualiza as páginas — faça uso dele"). They were left out when the only
  // doors were the ingest and the resolver, because a sheet route beside an
  // action can swap a source silently. That reason is gone: the screen's
  // read is a LIST, no action answers one, and the deposit is the fast JSON
  // this lane was built for — 0.355s and 17MB against a whole-file download,
  // refreshed by the lane that already runs. READ ONLY, like the desk above:
  // the houses are written by commCallsIngest alone, and a writable route
  // here would be a second way in.
  commCalls:     { sheet: 'comm_calls',      readOnly: true  },
  commWorkItems: { sheet: 'comm_work_items', readOnly: true  },
  // commRoutes, commProposals and commReach stay out on purpose: they are
  // served by actions, and a sheet route for them would draw an empty screen
  // rather than raise — the failure this whole day was about.
  // Intercepted by talentRoute_ and never read from this tab — kept for discovery.
  candidates:    { sheet: 'candidates',    readOnly: false },
  // Intercepted by talentPoolRoute_ (TalentPipeline.gs) and never read from a
  // tab of this name: it is the legacy roster joined to its scores, served so
  // the snapshot builder can slice it.
  talentPool:    { sheet: 'talentPool',    readOnly: true  },
  // The envelope book — the application forms, mirrored from Dropbox Sign.
  // Intercepted by recruitmentRoute_ (Recruitment.gs), which drops the form
  // ANSWERS and serves the envelope only. Declared here for one reason: the
  // slice list is the registry, and a book nobody names is a book the builder
  // never writes a JSON for — which is exactly why the nine unfinished
 // applications had nowhere to appear.
  recruitment:   { sheet: 'recruitment_contracts', readOnly: true },
  // The asking rhythm, joined to what the asks in flight are ACTUALLY running
  // on. Intercepted by flowCadencesRoute_ (FlowAdmin.gs); no tab of this name
  // exists — it is the config cells crossed with the ask book.
  hiringCadences: { sheet: 'hiringCadences', readOnly: true },
  documents:     { sheet: 'documents',     readOnly: false },
  // Pulled from Drive by policiesImport (Policies.gs): Drive writes, this is a copy.
  policies:      { sheet: 'policies',      readOnly: true  },
  // Split from policies on purpose: contact lists are the management team's
  // personal mobile numbers, not day-one reading.
  contactLists:  { sheet: 'contactLists',  readOnly: true  },
  videos:        { sheet: 'videos',        readOnly: false },
  /**
   * THE NUMBERS A SHIFT DIALS. The Suggestions app carried a list of phone
   * numbers that is not a franchise's to hold, so every number belongs in the
   * settings as configuration.
   *
   * They were a constant in the SPA — Stark County's emergency lines and
   * ASA's own team — which is headquarters' truth compiled into every place.
   * As a RESOURCE they inherit the place law for free: a blank tenant cell
   * is headquarters, so Ohio keeps its list and a franchise opens EMPTY and
   * fills with the numbers its own shifts dial.
   */
  helpfulContacts: { sheet: 'helpful_contacts', readOnly: false },
  events:        { sheet: 'events',        readOnly: false },
  notifications: { sheet: 'notifications', readOnly: true  , clientOpen: true},
  apps:          { sheet: 'apps',          readOnly: true  , clientOpen: true},
  activity:      { sheet: 'activity',      readOnly: false , clientOpen: true},
  // Pushed from the frontend's "Send to backend". Tab created on first write.
  questionnaireResponses: { sheet: 'questionnaireResponses', readOnly: false },
  // Pushed from the "Potential Clients" app. Tab created on first write.
  potentialClients: { sheet: 'potentialClients', readOnly: false },
  // Imported from the estate by tools/*.py — real rows, not links.
  photos:           { sheet: 'photos',             readOnly: false , clientScoped: true},
  projects:         { sheet: 'projects',           readOnly: false },
  projectWorkItems: { sheet: 'project_work_items', readOnly: false },
  // Real service plans (clinical — the app gates the audience).
  isps:             { sheet: 'isps',                readOnly: false , clientScoped: true},
  // Routed, and first in line: every "Demo data" screen gets a
  // Hub-owned tab, created empty on first touch. FILLING them is a separate
  // step per app, and the source sheet is confirmed before it runs.
  audits:            { sheet: 'audits',            readOnly: false },
  callOffs:          { sheet: 'callOffs',          readOnly: false },
  certMatrix:        { sheet: 'certMatrix',        readOnly: false },
  clients:           { sheet: 'clients',           readOnly: false , clientScoped: true},
  diseases:          { sheet: 'diseases',          readOnly: false },
  drAppointments:    { sheet: 'drAppointments',    readOnly: false , clientScoped: true},
  equipment:         { sheet: 'equipment',         readOnly: false },
  expenseReports:    { sheet: 'expenseReports',    readOnly: false },
  fleetVehicles:     { sheet: 'fleetVehicles',     readOnly: false },
  hydrationProfiles: { sheet: 'hydrationProfiles', readOnly: false , clientScoped: true},
  inventoryItems:    { sheet: 'inventoryItems',    readOnly: false },
  leads:             { sheet: 'leads',             readOnly: false },
  mealIdeals:        { sheet: 'mealIdeals',        readOnly: false , clientScoped: true},
  mealPlans:         { sheet: 'mealPlans',         readOnly: false , clientScoped: true},
  mileageLogs:       { sheet: 'mileageLogs',       readOnly: false },
  policyAcks:        { sheet: 'policyAcks',        readOnly: false },
  questionnaires:    { sheet: 'questionnaires',    readOnly: false },
  routes:            { sheet: 'routes',            readOnly: false },
  shiftCards:        { sheet: 'shiftCards',        readOnly: false },
  shiftMatrix:       { sheet: 'shiftMatrix',       readOnly: false , clientScoped: true, clientByHouse: ['houseId','houseName','house','houseCode']},
  shiftTimeline:     { sheet: 'shiftTimeline',     readOnly: false , clientScoped: true, clientByHouse: ['houseCode','houseId','houseName','house']},
  shifts:            { sheet: 'shifts',            readOnly: false , clientScoped: true, clientByHouse: ['houseCode','house','houseId','houseName']},
  sleepProfiles:     { sheet: 'sleepProfiles',     readOnly: false , clientScoped: true},
  staffCerts:        { sheet: 'staffCerts',        readOnly: false },
  /**
   * INDIVIDUAL STORAGE — one board per person, shared with nobody
   * `ownedBy` is a declaration read by the one gate, not a router special case.
   * `ownerFallback` covers rows written before that column existed.
   */
  /**
 * TASK BOARD SHEET (operator) — the same personal board, with a
   * SPREADSHEET where the notes box is. Declared exactly like `tasks`: the
   * rows are one person's and nobody else's, stamped from the context by
   * hubOwnedGate_. The three spreadsheet columns are what the card remembers
   * about the file SheetBoard.gs made for it.
   */
  sheetTasks:        { sheet: 'sheet_tasks',        readOnly: false,
                       ownedBy: 'ownerId', ownerFallback: 'assigneeId',
                       clientOpen: true,
                       stampWhen: { field: 'column', equals: 'done',
                                    stamp: 'completedAt', clearOnLeave: true } },
  tasks:             { sheet: 'tasks',             readOnly: false,
                       ownedBy: 'ownerId', ownerFallback: 'assigneeId',
                       // Server stamps completedAt when column becomes done, and
                       // clears it when a card is dragged back out of Done.
                       stampWhen: { field: 'column', equals: 'done',
                                    stamp: 'completedAt', clearOnLeave: true } , clientOpen: true},
  /**
   * THE CLIENT LEDGER — registered as resources so writes go through
   * createRow_/updateRowById_ and keep the read cache, version bump, id and
   * timestamp stamping, and the resolver's invalidation. Not readOnly; the
   * generic router is closed to them by gating in the finance handlers.
   */
  financeTransactions: { sheet: 'finance_transactions', readOnly: false , clientScoped: true},
  financeBalances:     { sheet: 'finance_balances',     readOnly: false , clientScoped: true},
  // The ledger's editable vocabulary — funds, categories, exempt reasons. A tab,
 // so adding one is a save and not a deploy (operator).
  financeConfig:       { sheet: 'finance_config',       readOnly: false },
  /**
 * SMART SHOPPER and MEAL TRACKER — migrated, all PERSONAL:
   * `ownedBy` on every one, same gate as `tasks`, and all are in
   * NEVER_SNAPSHOT (a slice is one static file served to every session).
   * The meal LOG folds the original Meals/Water/Supplements tabs into one,
   * keyed by `kind`.
   */
  shopperItems:        { sheet: 'shopper_items',        readOnly: false, ownedBy: 'ownerId' },
  shopperPrices:       { sheet: 'shopper_prices',       readOnly: false, ownedBy: 'ownerId' },
  mealProfile:         { sheet: 'meal_profile',         readOnly: false, ownedBy: 'ownerId' },
  mealLog:             { sheet: 'meal_log',             readOnly: false, ownedBy: 'ownerId' },
  /**
 * MY WEEK (operator: "faça o app My week completamente editavel
   * para adicionar lembretes e eventos"). A row is one personal reminder or
   * event on one day — `ownedBy` like every personal surface, NEVER_SNAPSHOT
   * on the SPA side. The shifts on the same card stay READ-ONLY roster rows;
   * this table holds only what the person writes for themselves.
   */
  weekItems:           { sheet: 'week_items',           readOnly: false, ownedBy: 'ownerId' , clientOpen: true},
  /**
 * LEARNING and BUSINESS TRAVEL — migrated. `learnAttempts` is
   * per-person (a practice record is theirs); `learnSkills` is the
   * organisation's list, admin-written. `travelTrips` is shared on purpose —
   * gated admin+manager at the action, not per-person at the row.
   */
  learnSkills:         { sheet: 'learn_skills',         readOnly: false },
  learnAttempts:       { sheet: 'learn_attempts',       readOnly: false, ownedBy: 'ownerId' },
  travelTrips:         { sheet: 'travel_trips',         readOnly: false },
  /**
   * ONE ROW PER SYNC RUN. The action writes what happened instead of sending;
   * Smart Comms reports runs nobody has been told about.
   */
  truelinkRuns:        { sheet: 'truelink_runs',        readOnly: false },

  // IST — the training obligation per employee × client, and the house map the
  // join stands on. `istHouses` is a tab, not a constant, because it is edited
  // the day a client moves house.
  istRecords:          { sheet: 'ist_records',           readOnly: false,
                         // The server stamps the training date; dragged back to
                         // owed, the date goes with it.
                         // The literal, NOT IST_STATUS_DONE: this table is a
                         // top-level value and IST.gs loads after Main.gs.
                         stampWhen: { field: 'status', equals: 'done',
                                      stamp: 'trainedAt', clearOnLeave: true } , clientScoped: true},
  istHouses:           { sheet: 'ist_houses',            readOnly: false , clientScoped: true},

  // TIME RECONCILIATION (Recon.gs) — durable records (an error is resolved,
  // never deleted) and LIVE reads, never slices: they belong in NEVER_SNAPSHOT
  // on the client side. Keys keep the contract's snake_case tab names so the
  // two sides cannot drift apart.
  time_punches:        { sheet: 'time_punches',          readOnly: false },
  recon_runs:          { sheet: 'recon_runs',            readOnly: false },
  recon_errors:        { sheet: 'recon_errors',          readOnly: false },

  /* AN INCIDENT IS NEVER DELETED FROM HERE (operator, package 2: "block
     delete of uiIncidents in the Hub — read + append"). These rows are the
     agency's record of a UI or an MUI: the county's own clock runs on them,
     and a row that can be removed from a screen is a record nobody can
     defend. Appending and correcting stay open — a report is written under
     pressure and gets corrected — but the delete verb answers 405 with the
     reason, rather than quietly succeeding on the one book where "gone" is
     the worst possible answer. */
  uiIncidents:       { sheet: 'uiIncidents',       readOnly: false , clientScoped: true, noDelete: true},
  visits:            { sheet: 'visits',            readOnly: false , clientScoped: true},
  workOrders:        { sheet: 'workOrders',        readOnly: false , clientScoped: true, clientByAddress: 'select_address_vehicle'},
  workoutPlans:      { sheet: 'workoutPlans',      readOnly: false , clientScoped: true},

  /**
 * THE LAST SIX SCREENS THAT WERE STILL BEING INVENTED (operator:
   * "todos os MOCK's devem morrer e as funcionalidades devem entrar").
   *
 * The routing gave every "Demo data" screen a Hub-owned tab and
   * these six were left behind — so the browser asked, this file answered
   * "Unknown resource", and the SPA quietly served its seeded dataset instead.
   * A caregiver opening Incidents or the MAR read fabricated clinical rows
   * that looked exactly like records. The client half of that door is shut
   * (lib/api.ts answers empty now); these are the tabs that make the apps
   * WORK rather than merely stop lying — created empty on first touch, and
   * filled by the people using them.
   *
   * Read gating is below in `route`, with the policies/contactLists rule:
   * clinical rows are employees-only, and the claims are money.
   */
  incidents:         { sheet: 'incidents',         readOnly: false , clientScoped: true},
  marEntries:        { sheet: 'mar_entries',       readOnly: false , clientScoped: true},
  medications:       { sheet: 'medications',       readOnly: false , clientScoped: true},
  /**
 * THE MEDICINE CABINET, WITH NOBODY'S NAME ON IT (operator:
   * *"um setup de software para revisao e adicao de novos medicamentos mas
   * SEM CLIENTES VINCULADOS"*).
   *
   * NOT clientScoped, and that is the whole design rather than an omission:
   * a catalogue entry is a MEDICINE — its strengths, its forms, whether it is
   * controlled, what the label says — and knowing that Sucralfate exists tells
   * you nothing about who takes it. The chart above is where a person meets a
   * medicine, and it is narrowed to them; this is the vocabulary the chart
   * draws from, and narrowing it would only mean nobody could read the
   * cabinet without being one of the people in it.
   *
   * 189 medicines, harvested once from every sheet that named one — the
   * chart, the med-pass log, the controlled register and the training
   * records: 4,423 mentions collapsed by name. Every one arrives
   * `unreviewed`, because an automated harvest is a draft and a person has
   * not read it yet.
   */
  medCatalog:        { sheet: 'med_catalog',       readOnly: false },
  /**
 * THE DETACHABLE FORMS (Forms.gs). Registered so the storage
   * layer can find their tabs, and GATED BELOW to admins and managers — the
   * `forms` tab holds the TOKEN that is the key to every public link, and a
   * resource anybody signed in could list is a resource that hands those out.
   * The public half never touches this router: it is answered before the
   * session gate and can only ever write.
   */
  forms:             { sheet: 'forms',             readOnly: false },
  formSubmissions:   { sheet: 'form_submissions',  readOnly: false },
  /* ONE ROW PER QUESTION A PERSON ANSWERED. The answers lived in
     a JSON cell and their cross-check in a JSON cell inside another one, so
     "whose typed expiry disagrees with their card" was a parse of two houses.
     Typed per shape: a date is a date, a dropdown is a choice, text is text. */
  formAnswers:       { sheet: 'form_answers',      readOnly: false },
  /** One row per file a form carried (FormFiles.gs). The
   *  digest worker fills the digest_* columns from the relay; digest_text
   *  can hold identity/medical words, so the resource is NEVER_SNAPSHOT
   *  on the browser side and gated below with its family. */
  formFiles:         { sheet: 'form_files',        readOnly: false },
  /**
 * WHAT THE PHONES SAID (Quo.gs). Registered so the storage
   * layer can find their tabs; gated below with the forms, because a call
   * transcript is a recording of somebody's voice written down and a text is
   * their words.
   */
  quoTranscripts:    { sheet: 'quo_transcripts',   readOnly: false },
  quoMessages:       { sheet: 'quo_messages',      readOnly: false },
  /**
   * QUO WRITES ITS OWN SUMMARY OF A CALL — a paragraph of what happened, plus
   * Next Steps and Jobs — and posts it as its own event. The hotline's book
   * has been collecting them since February and this platform had nowhere to
   * put one, so the most useful thing Quo sends was the one thing nobody here
 * could read.
   */
  quoSummaries:      { sheet: 'quo_summaries',     readOnly: false },
  /**
 * WHAT THE CLIENT FOLDER HELD. Three workbooks the platform
   * read nothing from, each about a named person, each brought in whole:
   *
   *   client_notes         the call log kept one tab per client's INITIALS —
   *                        AC, BM, NW — which is how the company writes people
   *                        down and is not how anything here looks them up.
   *   mar_errors           2,084 medication-administration errors going back
   *                        to 2023: the accumulated MASTER and the monthly
   *                        working sheets, in one shape.
   *   missing_medications  75 reports of a medicine about to run out.
   *
   * clientScoped, all three: each row is about one person, and each carries
   * `client_key`, so the same narrowing that governs a chart governs these.
   */
  clientNotes:       { sheet: 'client_notes',      readOnly: false , clientScoped: true},
  marErrors:         { sheet: 'mar_errors',        readOnly: false , clientScoped: true},
  missingMedications:{ sheet: 'missing_medications', readOnly: false , clientScoped: true},
  /**
 * THE DOCUMENTS THEMSELVES — an INDEX, never a copy. Seventy-
   * eight files sat in the client folder that nothing here could point at: the
   * MUI reports written one document per incident, and the medication delivery
   * receipts. They are narrative, they are large, and they are already
   * somewhere; what was missing was a chart able to say "her MUI report is
   * HERE". So this holds the name, the date, the link and — where the file
   * name says so — whose it is. Twenty-nine of the seventy-eight name a
   * person; the rest are a house's delivery receipts and form templates, and
   * an empty client_key is the honest answer for those rather than a guess.
   */
  clientFiles:       { sheet: 'client_files',      readOnly: false , clientScoped: true},
  medDeliveries:     { sheet: 'med_deliveries',    readOnly: false , clientScoped: true},
  careDocs:          { sheet: 'care_docs',         readOnly: false , clientScoped: true},
  billingClaims:     { sheet: 'billing_claims',    readOnly: false , clientScoped: true},

  /**
 * THE TEAM BOARD (operator: *"o KANBAN aparece as tasks de todos
   * para todo mundo"*).
   *
   * DELIBERATELY NOT `tasks`. That one is the PERSONAL board and carries
   * `ownedBy` — a person's own rows and only ever theirs, no role widens it,
   * which is the whole promise of that board: no sharing of the data.
   * A shared board is the opposite promise, so it is a second table rather
   * than a flag on the first: there is no way to write "everyone sees this"
   * onto a resource whose entire contract is that nobody else does.
   *
   * Same completion stamp as the personal board: the server writes
   * `completedAt` when a card reaches Done and clears it when one is dragged
   * back out, so "finished on" is never a browser's opinion.
   */
  teamTasks:         { sheet: 'team_tasks',        readOnly: false,
                       stampWhen: [
                         { field: 'column', equals: 'done',
                           stamp: 'completedAt', clearOnLeave: true },
                         { field: 'column', equals: 'cancelled',
                           stamp: 'cancelledAt', clearOnLeave: true }
                       ] },

  /**
 * OPERATIONAL REMINDERS — asaintelligence's Operations → Reminders
   * desk, which was a mock. Shared like the Kanban: everyone who can open
   * the app sees the same list. Access Control is the door; this gate only
   * refuses clients and trainees at the data.
   */
  reminders:         { sheet: 'reminders',         readOnly: false,
                       stampWhen: { field: 'status', equals: 'done',
                                    stamp: 'completedAt', clearOnLeave: true } },

  /**
 * THE BOARD'S PROJECTS (operator: "a lista de Projects no Kanban
   * para que eles possam ser vinculados as tarefas, de um ID para cada um").
   * A row is a project — its human-readable id (PRJ-1…), name, tint, status —
   * and a card points at one through its `projectId` field. Same audience as
   * the board itself: the company's work, employees only (gated in route with
   * teamTasks below).
   */
  teamProjects:      { sheet: 'team_projects',     readOnly: false },

  /**
   * THE LIBRARY (Books.gs). Rows describe a publication — its licence and its
   * source above all — and the file itself lives in the platform's Drive
   * folder. Readable by everyone: a library staff cannot open is a shelf.
   * Written by the two admin doors in Books.gs; the generic verbs stay open so
   * a librarian can correct a summary without a deploy.
   */
  books:             { sheet: 'books',             readOnly: false },

  /**
 * THE WIDGET BANK (operator: "um banco de widgets, para ser
   * utilizado dentro da plataforma"). A row is an indicator SPEC — which
   * resource, which narrowing, which label — never data: the number is
   * counted by the reader's own session, under the reader's own access.
   * Everyone reads the bank; admins and managers curate it (gated in route).
   */
  widgets:           { sheet: 'widgets',           readOnly: false , clientOpen: true}
};

/** The clinical tabs above, gated together in `route` — employees only. */
/* clientFiles joined them: it stopped being a list of file names
 * the day the decoder began writing digest_text into it — the OCR'd words
 * of MARS sheets, ISPs, MUIs and identity documents. Same bar as careDocs. */
var HUB_CLINICAL_TABS = ['incidents', 'marEntries', 'medications', 'medDeliveries',
                         'careDocs', 'clientFiles'];

/** HTTP entry points */

/**
 * GET — serves the SPA when no resource/action is given; refuses data reads.
 */
function doGet(e) {
  try { if (typeof hubPropsBoot_ === 'function') hubPropsBoot_(); } catch (eB) {}
  var p = (e && e.parameter) || {};
  // A bare GET serves the SPA itself — one /exec for page + API, same origin,
  // therefore zero CORS.
  if (!p.resource && !p.action) {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('ASA Hub')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // Data over GET is gone: query strings would leak session tokens into
  // logs/history. Everything data goes through doPost with {token, ...}.
  return jsonOut_({ status: 401, message: 'Authentication required — POST {token, resource, action, payload}.' });
}

/**
 * POST — JSON body routing: { resource, action, payload }. Query params are
 * accepted as a fallback so a POST can be addressed entirely via the URL.
 */
function doPost(e) {
  // THE PROPERTIES COME FIRST, BEFORE ANYTHING READS AN ID — the file map is
  // built here rather than on whichever screen happens to ask first.
  // IT PLANTS NOTHING any more: hubProp_ reads Props.gs directly, so seeding
  // the store would only re-fill the thing that was emptied on purpose.
  // What is left is a check: no HUB_DB_ID anywhere means every screen opens
  // blank, and this is where that gets said out loud instead of nowhere.
  try { if (typeof hubPropsBoot_ === 'function') hubPropsBoot_(); } catch (eB) {}
  // Execution globals survive rare warm starts (the HUB_IS_SERVICE_REQ
  // precedent) — a stale world here would aim a read at somebody's workbook,
  // and a stale tenant would answer one company with another's rows.
  HUB_WORLD_CTX = null;
  HUB_TENANT_CTX = null;
  // per-execution memos (Members.gs) — the same warm-start rule: a list kept
  // from the previous request would answer for the wrong moment
  HUB_MEMBER_CTX = null;
  HUB_CALLER = null;
  HUB_WRITE_ID = '';
  HUB_MEMBERS_ROWS = null;
  HUB_MEMBERS_OWNER = null;
  HUB_TENANT_ROWS = null;
  HUB_USERS_ROWS = null;
  HUB_CANDIDATE_BY_EMAIL = null;
  HUB_INVITE_ROWS = null;
  // Body arrives as raw JSON (text/plain) or as form field `body=<json>` — the
  // lane Google's anonymous-POST interstitial never intercepts; the SPA uses it.
  var body = {};
  var raw = (e && e.postData && e.postData.contents) || '';
  try {
    body = JSON.parse(raw);
  } catch (err) {
    var alt = (e && e.parameter && e.parameter.body) || '';
    try {
      body = JSON.parse(alt);
    } catch (err2) {
      return jsonOut_({ status: 400, message: 'Invalid body. Send {"token","resource","action","payload"} as JSON or as a form field "body".' });
    }
  }
  var action = String(body.action || '');
  var payload = body.payload || {};

  /**
   * THE THREE RESET DOORS ARE NOT AUTH ROUTER ACTIONS, and the order of these
   * two branches is the whole difference between a flow that works and one
   * that answers `Unknown auth action` for ever. They are named `auth*`
   * because they belong to signing in, and this generic branch used to catch
   * all three before the branch that owns them (below) could see them:
   * `authRoute_` has no case for them, so every forgot-password ask since the
   * flow was written was refused, the reset tab was never even created, and
   * nobody could tell from the outside — the door answers the same generic
   * yes whatever happens, which is exactly what makes a silent refusal
   * invisible. Found when one person's password had to be reset and nothing
   * happened. A new public door named `auth…` belongs in this list too.
   */
  var PASSWORD_RESET_DOORS = ['authForgot', 'authResetContext', 'authResetSubmit'];

  // Auth actions carry no session yet (or manage it themselves).
  if (action.indexOf('auth') === 0 && PASSWORD_RESET_DOORS.indexOf(action) === -1) {
    var authEnv;
    try {
      authEnv = authRoute_(action, payload, body.token);
    } catch (err) {
      authEnv = { status: 500, message: 'Internal error: ' + (err && err.message ? err.message : String(err)) };
    }
    if (action !== 'authMe' && action !== 'authStatus') {
      hubSysLog_(str_(payload.identifier || payload.email), action, '', authEnv);
    }
    return jsonOut_(authEnv);
  }

 // PUBLIC REFERRAL (operator): the access screen's no-login form —
  // the ONLY unauthenticated write, narrow and validated (Referrals.gs). It
  // answers before the session gate on purpose.
  if (action === 'referralSubmit') {
    var refEnv;
    try {
      refEnv = referralSubmit_(payload);
    } catch (errRef) {
      refEnv = { status: 500, message: 'Internal error: ' + (errRef && errRef.message ? errRef.message : String(errRef)) };
    }
    return jsonOut_(refEnv);
  }

 // PUBLIC INTERVIEW SCHEDULER (operator item 4): the invite
  // link's two doors, beside referralSubmit on purpose — no session; the
  // HMAC token in the payload is the identity, and it opens ONE ask only
  // (InterviewFlow.gs: shape-checked, constant-time compare, rate-limited).
  /**
 * PUBLIC REGISTRATION (Invites.gs): the invitation's two doors,
   * beside the interview scheduler for the same reason — no session exists
   * yet, and the HMAC token in the payload IS the identity. `inviteRegister`
   * is the one door on the platform that CREATES an account without a signed-in
   * admin, which is exactly why it is single-use, expiring and locked.
   */
  if (action === 'inviteContext' || action === 'inviteRegister') {
    var invEnv;
    try {
      invEnv = action === 'inviteContext'
        ? inviteContextPub_(payload)
        : inviteRegisterPub_(payload);
    } catch (errInv) {
      invEnv = { status: 500, message: 'Internal error: ' + (errInv && errInv.message ? errInv.message : String(errInv)) };
    }
    return jsonOut_(invEnv);
  }

  /**
 * FORGOT PASSWORD (PasswordReset.gs): the locked-out person's
   * three doors, beside the invitation's for the same reason — no session
   * can exist, the single-use token IS the identity, and authForgot answers
   * the same generic yes whatever the truth so who exists never leaks.
   */
  if (action === 'authForgot' || action === 'authResetContext' || action === 'authResetSubmit') {
    var prEnv;
    try {
      prEnv = action === 'authForgot'
        ? authForgotPub_(payload)
        : action === 'authResetContext'
          ? authResetContextPub_(payload)
          : authResetSubmitPub_(payload);
    } catch (errPr) {
      // the forgot door answers its one generic yes even here, so a failure never tells who exists
      prEnv = action === 'authForgot'
        ? { status: 200, data: { sent: true } }
        : { status: 500, message: 'Internal error: ' + (errPr && errPr.message ? errPr.message : String(errPr)) };
    }
    return jsonOut_(prEnv);
  }

  /**
   * THE DETACHABLE FORMS — answered here, BEFORE the session gate, for the
   * same reason the interview page is: the person filling one in is a
   * contractor, a family member or somebody on their own phone, and they have
   * no account. Everything that protects them lives inside Forms.gs — the
   * token, the closed state, the throttle — and the door is one way: it can
   * write an answer and can never read one.
   */
  /**
 * QUO KNOCKS WITH ITS OWN SHAPE, not with ours (Quo.gs). A
   * webhook carries no token and never will, so it is recognised by what it
   * IS — a `type` and a `data` and none of this platform's own fields — and
   * answered here, before the session gate, like every other public door.
   */
  if (typeof quoIsWebhookBody_ === 'function' && quoIsWebhookBody_(body)) {
    var qEnv;
    try { qEnv = quoWebhookPub_(body); }
    catch (errQ) {
      // NEVER 500 AT A WEBHOOK: the sender retries, and a retry storm on a
      // backend that runs one execution at a time is an outage.
      qEnv = { status: 200, data: { kind: 'error' } };
    }
    return jsonOut_(qEnv);
  }

  if (action === 'formPublicGet' || action === 'formPublicSubmit' ||
      action === 'formPublicFileStore' || action === 'formPublicFileSession') {
    var fmEnv;
    try {
      fmEnv = action === 'formPublicGet' ? formPublicGetPub_(payload)
        : action === 'formPublicFileStore' ? formPublicFileStorePub_(payload)
 /* the resumable lane for what the envelope cannot carry */
        : action === 'formPublicFileSession' ? formPublicFileSessionPub_(payload)
        : formPublicSubmitPub_(payload);
    } catch (errFm) {
      fmEnv = { status: 500, message: 'Internal error: ' + (errFm && errFm.message ? errFm.message : String(errFm)) };
    }
    return jsonOut_(fmEnv);
  }

  if (action === 'interviewSlotContext' || action === 'interviewSlotSubmit' ||
      action === 'interviewDaysSubmit' || action === 'interviewSlotsSubmit') {
    var ivEnv;
    try {
      ivEnv = action === 'interviewSlotContext'
        ? interviewSlotContextPub_(payload)
        : action === 'interviewDaysSubmit'
          ? interviewDaysSubmitPub_(payload)
          : action === 'interviewSlotsSubmit'
            ? interviewSlotsSubmitPub_(payload)
            : interviewSlotSubmitPub_(payload);
    } catch (errIv) {
      ivEnv = { status: 500, message: 'Internal error: ' + (errIv && errIv.message ? errIv.message : String(errIv)) };
    }
    return jsonOut_(ivEnv);
  }

  // The shareable candidate form (candidate.html) — the token is the
  // identity, the HMAC is the gate; everything else lives in CandidateForm.gs.
  if (action === 'candFormContext' || action === 'candFormSubmit') {
    var cfEnv;
    try {
      cfEnv = action === 'candFormContext'
        ? candFormContextPub_(payload)
        : candFormSubmitPub_(payload);
    } catch (errCf) {
      cfEnv = { status: 500, message: 'Internal error: ' + (errCf && errCf.message ? errCf.message : String(errCf)) };
    }
    return jsonOut_(cfEnv);
  }

  // Everything else requires a live session — or the service identity, which may
  // ONLY read (ServiceIdentity.gs). Checked first: a request carrying a service
  // secret is never a person's.
  var svc = serviceIdentityFor_(body, action);
  if (svc && svc.refused) {
    return jsonOut_({ status: 403, message: 'The service identity may only read.' });
  }
  var user = svc ? svc.user : sessionUser_(body.token);
  if (!user) {
    return jsonOut_({ status: 401, message: 'Authentication required.' });
  }
  // Housekeeping rides ONLY the machine's reads: a person's click must never pay
  // for sweeps it did not ask for (that latency helped saturate the account,
 // ). The builder passes every few minutes.
  HUB_IS_SERVICE_REQ = !!(user && user.is_service);
  // …and WHICH action, for the same reason: something deep inside a handler
  // may need to know which conversation it is part of (OptOut.gs).
  HUB_ACTION_NOW = String(action || '');

  /**
   * WHERE THIS SESSION IS STANDING, settled in one place and in one order:
   * TENANT, then MEMBER, then WORLD. The order is load-bearing — the tenant
   * needs the caller's own account row (a member visit rewrites `user`), and
   * the world needs the member context (an authorised BOTH visit opens its
   * owner's workbook), so any other order silently kills one of the three.
   *
   * TENANTS (Tenant.gs): the place narrows what answers, for NAMED ACTIONS
   * TOO — that is the whole difference from the world lane, and the reason
   * System Logs, chat, Users and the Kanban were serving headquarters' rows
   * to the franchise. Never for the service identity, which stands nowhere.
   * Standing at headquarters changes nothing anywhere.
   */
  var tctx = tenantContext_(body.tenant, user);
  if (tctx && tctx.error) return jsonOut_(tctx.error);
  HUB_TENANT_CTX = tctx;

  /**
   * PLATFORM MEMBERS (Members.gs): `member` on the envelope visits a PERSON
   * the owner was authorised to bring in. They arrive as what they already
   * are — the visited account's own role and badges decide what answers, so
   * the visit can never widen the owner's reach, only narrow it to somebody
   * else's. The work owned by them travels with them; writes never do.
   */
  if (str_(body.member)) {
    var mctx = memberContext_(body.member, user);
    if (mctx && mctx.error) return jsonOut_(mctx.error);
    if (mctx) {
      HUB_MEMBER_CTX = mctx;
      /**
       * WHO IS ACTUALLY SIGNED IN, kept before the visit rewrites them (found
 * live, entering a member made the FRANCHISE VANISH
       * places stack, and a reload put the session straight back inside the
       * visit, so it looked gone for good).
       *
       * A visit narrows what answers — correctly, that is its whole point —
       * but the DIRECTORY OF PLACES is not something the visited person has an
       * opinion about. It belongs to the account holding the session: which
       * places THEY may stand in does not change because they are looking at
       * somebody else's work. Reading it off the rewritten user asked the
       * wrong person and got the wrong answer.
       */
      HUB_CALLER = user;
      /**
       * THEIR badge, THEIR limits — but never MORE than the visitor's own
 * (audit). Visiting a director used to hand the visitor
       * director-gated reads; the clamp takes the weaker of the two, and when
       * it bites the visitor keeps their own badges, because the visited
       * person's types are what earned the wider role.
       */
      var mRole = memberClampRole_(user.role, mctx.role);
      /**
       * THE SESSION BECOMES THEM FOR THE LENGTH OF THE READ. One person's
       * data was reaching another's screen once a second account existed,
       * and that is what this closes.
       *
       * This kept the CALLER's id, email and name and rewrote only the role
       * and the badges. The reason was sound — every write must stay in the
       * signed-in account's name — but the consequence was that "mine" went
       * on meaning the owner everywhere: this backend has 300+ handlers and
       * every one of them answers "my rows" from `user.id`. One generic verb
       * called hubActingUserId_. Nothing else did, and nothing was going to:
       * a convention that must be remembered in three hundred places is not a
       * rule, it is a hope. The platform was correct while there was one real
       * account and started leaking the moment there were two.
       *
       * So the polarity flips. The identity IS the visited person, which makes
       * every read correct at once and needs no sweep of three hundred
       * handlers — the fix nobody would finish.
       *
 * AND THE WRITES FOLLOW IT (operator: "VISITA ESCREVE NO SEU
       * PROPRIO AMBIENTE"). A visit exists so a workspace can be OPERATED. The
       * isolation is not a ban on writing: it is that the owner stamp comes
       * from the CONTEXT and never from the payload (hubOwnedGate_), and the
       * context is now theirs — so a row written inside their environment
       * lands in THEIR environment, by the same mechanism that already keeps
       * any two people's rows apart. A write landing in the VISITOR's
       * environment is now impossible rather than merely not intended.
       *
       * The signed-in account is not lost: HUB_CALLER holds it whole, the
       * eleven HUB_CALLER_OWN_ACTIONS are answered from it, and the system log
       * records it — so the audit trail still names who was actually at the
       * keyboard.
       */
      user = { id: mctx.userId, email: mctx.email, display_name: mctx.name,
               role: mRole,
               types: memberClampTypes_(user.types, mctx.types),
               // the place columns travel: the tenant is already resolved, and
               // anything downstream that asks must not read a visit as a move
               home_tenant: user.home_tenant, tenants: user.tenants,
               is_service: false,
               visiting_member: mctx.memberId, acting_for: mctx.userId };
    }
  }

  /**
   * USER WORLDS (World.gs) LAST, because a world may belong to the person
 * being visited (audit: "`work_world` is dead"). worldContext_
   * resolved BEFORE the member did, so the branch in worldResolve_ that lets
   * an authorised BOTH visit open its owner's workbook could never see a
   * context — `work_world` behaved exactly like `work`. An optional `world`
   * re-points the GENERIC verbs; named actions never follow it. A world
   * outranks a tenant when both are named: my world inside my franchise is
   * still my world, and a world is nobody's company ground.
   */
  if (str_(body.world) && !HUB_ACTIONS[action] &&
      ['list', 'get', 'create', 'update', 'delete'].indexOf(action) !== -1) {
    var wctx = worldContext_(body.world, user);
    if (wctx && wctx.error) return jsonOut_(wctx.error);
    HUB_WORLD_CTX = wctx;
    if (HUB_WORLD_CTX) HUB_TENANT_CTX = null;
  }

  // The builder's freshness probe: when did the DB spreadsheet last change? One
  // cheap execution per rebuild keeps sheet-mode slices honestly "current".
  if (action === 'stamp' && user.is_service) {
    return jsonOut_({ status: 200, data: { db_last_updated: serviceDbStamp_() } });
  }
  // Bulk catch-up read: several tabs in one execution, service identity only.
  if (action === 'tabs' && user.is_service) {
    return jsonOut_(bulkTabsRead_(body.payload || body));
  }
  // Cheap per-tab fingerprints — one row each, so the builder can find WHICH tab
  // moved before paying to read any of them (BulkRead.gs).
  if (action === 'revs' && user.is_service) {
    return jsonOut_(bulkTabsRevs_(body.payload || body));
  }
  // Several SHAPED resources in one execution — the adapter tail was eleven
  // executions per rebuild and the source of every build failure.
  if (action === 'resources' && user.is_service) {
    return jsonOut_(bulkResourcesRead_(body.payload || body, user));
  }

 // EXACTLY-ONCE: the relay stamps writes with a write_id. Seen
  // before = already executed — answer the recorded receipt instead of running
  // twice (the interstitial pages made every retry a gamble).
  var writeId = str_(body.write_id);
  HUB_WRITE_ID = writeId;
  var widCache = writeId ? CacheService.getScriptCache() : null;
  if (widCache) {
    var seen = widCache.get('wid_' + writeId);
    if (seen) {
      try { return jsonOut_(JSON.parse(seen)); }
      catch (eW) { return jsonOut_({ status: 200, data: { accepted: true, deduplicated: true } }); }
    }
  }
  var env;
  if (HUB_ACTIONS[action]) {
 // THE RESOLVER'S DOOR: the declaration beside each handler says
    // who may call it. In 'audit' mode it refuses nothing — an undeclared action
    // is counted, not blocked. See Resolver.gs.
    /**
     * DEFAULT DENY AWAY FROM HOME. Every app had the same fault and none of
     * them was isolated.
     *
     * Closing leaks one screen at a time could never isolate anything:
     * ~290 named actions read headquarters directly, and each one fixed
     * left the rest serving Ohio. So the law inverts. Away from home an
     * action runs only if it is DECLARED safe there — either because it
     * narrows by place itself, or because it carries identity and config
     * with no company rows in it. Everything else is Unknown action, the
     * same 404 the platform gives for a name it does not have.
     *
     * A refusal is visible and fixable in one line; a leak is neither.
     * At home this gate does not exist — Ohio is untouched.
     */
    if (hubAwayTenant_() && !tenantActionAllowed_(action)) {
      return jsonOut_({ status: 404, message: 'Unknown action.' });
    }
    // A visit narrows what may be SEEN; it does not change who is asking.
    var actor = user;
    if (HUB_MEMBER_CTX && HUB_CALLER && hubCallerOwnAction_(action)) actor = HUB_CALLER;
    var gate = null;
    try { gate = hubPolicyGate_(action, payload, actor); }
    catch (eGate) { gate = null; }   // the door must never be the outage
    if (gate) {
      hubSysLog_(user.email, action, str_(payload.candidate_id || payload.id || ''), gate);
      return jsonOut_(gate);
    }
    try {
      // Third arg: the raw session token — only profileUpdate uses it (to bust
      // its own session-cache entry); every other action ignores it.
      env = HUB_ACTIONS[action](payload, actor, body.token);
    } catch (err) {
      env = { status: 500, message: 'Internal error: ' + (err && err.message ? err.message : String(err)) };
    }
  } else if (!body.resource && action && ['list', 'get', 'create', 'update', 'delete'].indexOf(action) === -1) {
    // An unknown action must say THAT: without this branch it fell through to
 // the resource router as "Unknown resource: undefined" (three
    // screens looked broken because the deployment was two pushes behind).
    env = { status: 404, message: 'Unknown action: "' + action + '". ' +
            'If this action is new, the Apps Script may not have been published yet — ' +
            'Implantar → Gerenciar implantações → Nova versão.' };
    hubSysLog_(user.email, action, '', env);
    return jsonOut_(env);
  } else {
    var out = respond_(body.resource, action, payload, user);
    // Data reads are noise; log only data MUTATIONS below.
    if (action === 'list' || action === 'get') return out;
    hubSysLog_(user.email, body.resource + '.' + action, str_(payload.id), null);
    return out;
  }

  // Every hub action lands in the system log (reads excluded above).
  hubSysLog_(user.email, action,
    str_(payload.candidate_id || payload.id || payload.tab || ''), env);
  // The receipt half of exactly-once: remember what this write answered (6h —
  // retries happen within minutes) so its retry gets THIS envelope.
  if (widCache && env && Number(env.status) < 500) {
    try { widCache.put('wid_' + writeId, JSON.stringify(env).slice(0, 90000), 21600); }
    catch (eWid) { /* receipt too big or cache down — retry risk as before */ }
  }
  return jsonOut_(env);
}

/**
 * NOTE on doOptions / CORS: Apps Script cannot handle preflight (OPTIONS) —
 * doGet/doPost are the only routed entry points. The frontend therefore always
 * sends "simple requests" (GET with query params, or POST with Content-Type:
 * text/plain), so no doOptions handler is required or possible.
 */

/** Wraps route_ in a top-level try/catch so the API always answers with the
 *  JSON envelope, never an HTML error page the frontend could not parse. */
function respond_(resource, action, payload, user) {
  try {
    return jsonOut_(route(resource, action, payload || {}, user));
  } catch (err) {
    return jsonOut_({
      status: 500,
      message: 'Internal error: ' + (err && err.message ? err.message : String(err))
    });
  }
}

/** Serializes the envelope and returns it with the JSON mime type. */
function jsonOut_(envelope) {
  return ContentService
    .createTextOutput(JSON.stringify(envelope))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Router */

/**
 * Who a row on a per-person resource belongs to. The fallback is read ONLY when
 * the declared column is blank, so a stamped row can never be re-attributed.
 */
function hubOwnerOf_(row, cfg) {
  var own = str_(row ? row[cfg.ownedBy] : '');
  if (own) return own;
  return cfg.ownerFallback ? str_(row ? row[cfg.ownerFallback] : '') : '';
}

/**
 * The declared stamp. Reads the row as it IS and the patch as it will be, so a
 * patch that does not touch the watched field leaves the stamp alone — editing
 * a done card's title must not re-date its completion.
 */
function hubStampWhen_(cfg, row, payload) {
  // One rule or several: the team board stamps completedAt AND cancelledAt,
 // each watching the same field for a different value.
  var rules = cfg.stampWhen;
  if (!rules) return;
  if (!Array.isArray(rules)) rules = [rules];
  for (var i = 0; i < rules.length; i++) {
    var w = rules[i];
    if (!w || payload[w.field] === undefined) continue;
    var was = str_(row[w.field]);
    var now = str_(payload[w.field]);
    if (was === now) continue;
    if (now === w.equals) payload[w.stamp] = new Date().toISOString();
    else if (w.clearOnLeave && was === w.equals) payload[w.stamp] = '';
  }
}

/**
 * THE ONE GATE FOR A PER-PERSON RESOURCE. Returns an error to refuse, null to
 * proceed; `list` is settled in the router (rows do not exist yet here).
 *
 * A refusal is 404, NEVER 403 — a 403 tells the asker the card exists and that
 * somebody else has it, and on a personal board the titles are the content.
 * A SERVICE identity owns nothing and reads nothing, which is why these
 * resources are also in NEVER_SNAPSHOT (src/lib/snapshot.ts): the two
 * declarations have to agree.
 */
/**
 * WHAT A CLIENT MAY SEE — themselves, and nothing else, in EVERY app.
 *
 * THE RULE: a client may see only themselves in Clients, and only their own
 * ISP in the ISP app. They may never see another's, because it is
 * confidential — so every app filters by the client, whatever the app.
 *
 * WHAT WAS THERE. Six hand-written narrowings — the directory, the plan and
 * the four wellbeing derivations — each written the day somebody noticed. A
 * client account reaches nineteen apps, and every other resource behind them
 * answered in full: the doctor's appointments, the incidents, the medications,
 * the MAR entries, the care documents. Six filters is not a rule, it is a list
 * of the times we remembered.
 *
 * SO IT IS DECLARED, LIKE OWNERSHIP AND PLACE. `ownedBy` taught the shape:
 * the resource says what it is, and ONE gate reads that on every verb. Three
 * words, and the third is the one that matters:
 *
 *   clientScoped   rows belong to a person we care for — narrow to theirs
 *   clientOpen     nothing here is about a client — pass through
 *   (neither)      REFUSED. A client sees nothing.
 *
 * FAIL CLOSED, and that is the whole point of doing it this way. A resource
 * added tomorrow, by anybody, is invisible to a client until somebody decides
 * out loud which of the two it is. The alternative — narrow what we listed,
 * pass the rest — is the design that just leaked six ways, and the leak is
 * silent by construction: nobody sees the row that should not have been there.
 *
 * NO KEY, NO ROWS. An account whose `client_key` is empty names nobody, so it
 * matches nothing — the rule dictated, unchanged: identity is never
 * guessed from a name or an e-mail.
 *
 * THE SERVICE IDENTITY IS EXEMPT because it builds the slices, and a slice is
 * a company file that no client is served (EMPLOYEE_ONLY_SLICES, and
 * check-live-state.py fails on any that names a client).
 */
/**
 * THE SAME RULE, ON EVERY ADAPTER (operator: "Dr Appointments
 * vazou os dados de todo mundo. UI Reports vazou de todo mundo").
 *
 * The gate below runs in route()'s own switch — and five resources never reach
 * it. `estateRoute_`, `talentRoute_`, `directorsRoute_`, `onboardingRoute_`,
 * `certsRoute_` and the studio's `dynRoute_` are EARLY RETURNS above it: they
 * answer from another spreadsheet entirely and hand the envelope straight
 * back. So a client account read every doctor's appointment and every UI in
 * the estate, with the gate sitting one screen further down doing nothing.
 *
 * This is the identical shape the audit found in `get` — "the
 * two derived branches returned before the guard the sheet-row branch obeys" —
 * which is the whole argument for narrowing the ANSWER rather than the branch:
 * an adapter added tomorrow is wrapped by the same call, and check-isolation
 * fails the build if one is not.
 */
function hubClientNarrowAnswer_(resource, action, user, answer) {
  if (!answer || answer.status !== 200) return answer;
  if (str_(user && user.role) !== 'client' || (user && user.is_service)) return answer;
  var cfg = (typeof RESOURCES !== 'undefined' && RESOURCES[resource]) || {};
  var key = hubClientKeyOf_(user);
  if (action === 'list') {
    var rows = answer.data;
    if (!rows || !rows.length) return answer;
    return { status: 200, data: hubClientNarrowList_(resource, cfg, rows, key) };
  }
  if (action === 'get') {
    var no = hubClientRowGate_(resource, cfg, answer.data, key);
    // 404, never 403 — "not yours" and "not here" must read alike, or the
    // refusal itself confirms the row exists
    if (no) return { status: 404, message: 'No row "' + resource + '" here.' };
    return answer;
  }
  // create / update / delete on an adapter: an undeclared resource is not a
  // client's to touch, and a declared one only their own row.
  if (cfg.clientOpen) return answer;
  if (!cfg.clientScoped || !key) return { status: 404, message: 'No "' + resource + '" record here.' };
  return answer;
}

function hubClientKeyOf_(user) {
  if (!user || user.is_service) return '';
  if (str_(user.role) !== 'client') return '';
  return str_(user.client_key);
}

/** House numbers, street words and nothing else — "4708 Meadowlane Dr NW" and
 *  "4708 Meadowlane Dr NW, Canton, OH 44709" are the same house. */
function hubAddrKey_(v) {
  return String(v || '').split(',')[0].toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * WHO THIS CLIENT IS, in every spelling the platform uses for them.
 *
 * Three, and each one is how some tab happens to write it down:
 *   key       the client_key column — the plan, the directory, the wellbeing rows
 *   names     the normalised name — the estate's forms reference a person by name
 *   addrs     their house — House Repair files a job against an ADDRESS, never
 * a person (operator: "precisa ser só a House repair da
 *             casa dela")
 *
 * Read from the platform's own merge (`clientsDerived_` with no user, so it is
 * not narrowed by the very rule this feeds) rather than from a second copy of
 * the joining logic — the same argument that keeps SECTION_APP in one place.
 */
function hubClientIdentity_(key) {
  var out = { key: key, names: {}, addrs: {}, houses: {} };
  out.names[key] = true;
  try {
    clientsDerived_(null).forEach(function (r) {
      if (str_(r.client_key) !== key) return;
      var n = clientNameKey_(str_(r.name));
      if (n) out.names[n] = true;
      var a = hubAddrKey_(r.home_address);
      if (a && a.length >= 6) out.addrs[a] = true;
 // THE HOUSE THEY LIVE IN, as the roster spells it (operator:
      // "Shifts & Coverage ... deve ser filtrado só pro cliente logado").
      // A shift names a HOUSE, never a person — 'ABD4708', 'BM4060', 'EC4048'
      // — and the number in it is the street number of the address. Measured
      // before it was trusted: it resolves 15 of the 23 clients on file. The
      // other eight see NOTHING rather than everything, which is the only safe
      // direction for a join that does not always land.
      var num = String(str_(r.home_address).match(/^\s*(\d{2,6})/) ? RegExp.$1 : '');
      if (num) out.houses[num] = true;
    });
  } catch (e) {
    // the derivation is unavailable (no plans yet): the key alone still
    // identifies, and identifying LESS is the safe direction
    try {
      listRows_('isps', {}).forEach(function (r) {
        if (str_(r.client_key) !== key) return;
        var n2 = clientNameKey_(str_(r.client_name));
        if (n2) out.names[n2] = true;
      });
    } catch (e2) { /* nothing to add */ }
  }
  return out;
}

/**
 * Does this row name this client? Conservative on purpose: a row with no
 * client-bearing field at all does NOT match, so a resource declared
 * clientScoped by mistake shows nothing rather than everything.
 */
function hubRowIsClients_(row, cfg, id) {
  if (!row) return false;
  /**
   * A HOUSE, not a person. House Repair, and anything else filed against an
   * address, declares the column — never matched generically, because the
   * estate's own rows carry OTHER addresses too (a doctor's surgery sits in
   * `address` on every appointment, and matching that would hand a client
   * every visit to their clinic).
   */
  /**
   * A HOUSE CODE. Declared, never generic: the roster's own columns are the
   * only place these codes appear, and matching a bare number anywhere else
   * would join on a coincidence.
   */
  if (cfg && cfg.clientByHouse) {
    for (var hi = 0; hi < cfg.clientByHouse.length; hi++) {
      var hv = str_(row[cfg.clientByHouse[hi]]);
      if (!hv) continue;
      for (var nk in id.houses) {
        if (new RegExp('(^|\\D)' + nk + '(\\D|$)').test(hv)) return true;
      }
    }
    return false;
  }
  if (cfg && cfg.clientByAddress) {
    var a = hubAddrKey_(row[cfg.clientByAddress]);
    return !!a && !!id.addrs[a];
  }
  var want = cfg && cfg.clientBy;
  if (want) {
    var v = str_(row[want]);
    return !!v && (v === id.key || !!id.names[clientNameKey_(v)]);
  }
  // The generic reading — every field whose NAME speaks about a client. The
  // derived resources (appointments, incidents, the wellbeing screens) each
  // spell it differently: client, client_key, clientId, clientName.
  var hit = false;
  for (var k in row) {
    if (!row.hasOwnProperty(k)) continue;
    if (String(k).toLowerCase().indexOf('client') === -1) continue;
    var val = str_(row[k]);
    if (!val) continue;
    if (val === id.key || val === 'CLI_' + id.key) { hit = true; break; }
    if (id.names[clientNameKey_(val)]) { hit = true; break; }
  }
  // The id the client resources mint for themselves — CLI_<client_key>.
  if (!hit && str_(row.id) === 'CLI_' + id.key) hit = true;
  return hit;
}

/** LIST: the rows that are theirs. Never called for anybody but a client. */
function hubClientNarrowList_(resource, cfg, rows, key) {
  if (!cfg || cfg.clientOpen) return rows;
  if (!cfg.clientScoped) return [];        // undeclared = refused
  if (!key) return [];                     // named nobody = matches nobody
  var id = hubClientIdentity_(key);
  return (rows || []).filter(function (r) { return hubRowIsClients_(r, cfg, id); });
}

/** GET / UPDATE / DELETE: a single row, answered 404 unless it is theirs — the
 *  same shape hubOwnedGate_ uses, because a "no" that says "not yours" is a
 *  yes to whoever is guessing ids. */
function hubClientRowGate_(resource, cfg, row, key) {
  if (!cfg || cfg.clientOpen) return null;
  if (!cfg.clientScoped || !key) {
    return { status: 404, message: 'No "' + resource + '" record here.' };
  }
  if (!hubRowIsClients_(row, cfg, hubClientIdentity_(key))) {
    return { status: 404, message: 'No "' + resource + '" record here.' };
  }
  return null;
}

function hubOwnedGate_(resource, cfg, action, payload, user) {
  var me = str_(user && !user.is_service ? user.id : '');
  if (!me) {
    // Nothing personal is readable without a person. Not an error for `list`
    // (an empty board is truthful); a refusal for everything else.
    return action === 'list' ? null
      : { status: 404, message: 'No "' + resource + '" record with id "' + str_(payload && payload.id) + '".' };
  }

  if (action === 'create') {
    // Stamped SERVER-SIDE and unconditionally. A client that sends an ownerId
    // is not trusted with it — that field is the whole isolation.
    payload[cfg.ownedBy] = me;
    return null;
  }

  if (action === 'get' || action === 'update' || action === 'delete') {
    var id = str_(payload && payload.id);
    if (!id) return null;  // the verb's own validation says this better
    var row = requireRow_(resource, id);
    if (row.error) return row.error;
    if (hubOwnerOf_(row, cfg) !== me) {
      return { status: 404, message: 'No "' + resource + '" record with id "' + id + '".' };
    }
    // An update may not hand a row to somebody else, or take one.
    if (action === 'update') payload[cfg.ownedBy] = me;
    if (action === 'update' && cfg.stampWhen) hubStampWhen_(cfg, row, payload);
  }
  return null;
}

/**
 * route(resource, action, payload, user) → envelope.
 *   resource — a RESOURCES key (404 otherwise), unless a live adapter claims it
 *   action   — list | get | create | update | delete (400 otherwise)
 *   user     — the session's public user (role checks in live adapters)
 */
function route(resource, action, payload, user) {
  // USER WORLDS: an active world skips every adapter, guard and gate below —
  // the workbook boundary IS the isolation (World.gs).
  if (HUB_WORLD_CTX) return worldRoute_(resource, action, payload, user);
  /**
   * THE PLACE IS SETTLED BEFORE THE ADAPTERS, because the adapters RETURN
   * (Tenant.gs HUB_PLACE_ADAPTERS). Each one reads an external workbook that
   * belongs to headquarters, so away from home the resource does not exist —
   * and an adapter added tomorrow is refused away by omission rather than
   * leaking by default.
   */
  var adapterPlace = hubAdapterPlaceGate_(resource);
  if (adapterPlace) return adapterPlace;
  // Live talent adapter: `candidates` is served read-only from the Hub's own
  // imported talent tabs (stage moves live in HUB_ACTIONS, not here). The
  // user rides along so talentRoute_ can gate the live door by the slice's
 // own roles (review ).
  if (resource === 'candidates') return hubClientNarrowAnswer_(resource, action, user, talentRoute_(action, payload, user));
  // The legacy talent roster, as a RESOURCE so the builder can slice it —
  // the Talents view and the Analysis read the JSON, not the sheets.
  if (resource === 'talentPool' && typeof talentPoolRoute_ === 'function') {
    return hubClientNarrowAnswer_(resource, action, user, talentPoolRoute_(action, payload, user));
  }
  // The application book, envelope-only (the answers never leave the mirror).
  if (resource === 'recruitment' && typeof recruitmentRoute_ === 'function') {
    return hubClientNarrowAnswer_(resource, action, user, recruitmentRoute_(action, payload, user));
  }
  // The asking rhythm, and the drift between the cells and the asks in flight.
  if (resource === 'hiringCadences' && typeof flowCadencesRoute_ === 'function') {
    return hubClientNarrowAnswer_(resource, action, user, flowCadencesRoute_(action, payload, user));
  }
  // The staff performance BOARD for the snapshot builder — the precomputed
  // perf_board rows behind the admin+manager slice; the per-person record
 // stays live-only (StaffPerformance.gs).
  if (resource === 'staffPerfBoard' && typeof staffPerfBoardRoute_ === 'function') {
    return hubClientNarrowAnswer_(resource, action, user, staffPerfBoardRoute_(action, user));
  }
  // Live directors adapter: own Directory spreadsheet, role-gated writes.
  if (resource === 'directors') return hubClientNarrowAnswer_(resource, action, user, directorsRoute_(action, payload, user));
  // Live onboarding tracker: real hires, stage derived from the paperwork.
  if (resource === 'onboarding') return hubClientNarrowAnswer_(resource, action, user, onboardingRoute_(action, payload, user));
  // Estate data apps — read-only mirrors (Estate.gs). The estate stays the
  // single writer.
  if (typeof ESTATE_SOURCES !== 'undefined' && ESTATE_SOURCES[resource]) {
    return hubClientNarrowAnswer_(resource, action, user, estateRoute_(resource, action, payload, user));
  }
  // Certifications are DERIVED from the estate's employee tracker at read time
  // (Certs.gs) — the routed tabs of the same names stay untouched.
  if ((resource === 'certMatrix' || resource === 'staffCerts') &&
      typeof certsRoute_ !== 'undefined') {
    return hubClientNarrowAnswer_(resource, action, user, certsRoute_(resource, action));
  }
  // Studio-imported resources (hub_resources tab) — read-only external sheets.
  var dyn = hubDynamicResources_()[resource];
  // An import belongs to the place that made it — blank means headquarters,
  // which is every row that exists today, so a franchise sees none of them.
  if (dyn && !tenantRowVisible_(dyn.tenant)) {
    return { status: 404, message: 'Unknown resource: "' + resource + '".' };
  }
  if (dyn) {
    // The imported System logs carries actor emails and every action on the
    // platform; the built-in admin-only screen was retired in its favor
 // and the audit trail must not widen to staff in the exchange.
    if (resource === 'x_system_logs' && !hubIsWriter_(user)) {
      return { status: 403, message: 'System logs are for admins and managers.' };
    }
    return hubClientNarrowAnswer_(resource, action, user, dynRoute_(dyn, action, payload));
  }
  // Apps defined in the app_builder sheet own real tabs — register them here or
  // every read on them answers "Unknown resource".
  appBuilderRegisterResources_();
  // The generic router has no per-role ACL, so a resource that must not be read
  // by a trainee or a client portal says so HERE — the slice gate covers the
  // file, not the live door behind it.
  if (resource === 'contactLists' && user && !user.is_service &&
      (user.role === 'client' || user.role === 'onboarding')) {
    return { status: 403, message: 'The contact list is for employees.' };
  }
  // Policies are internal operating procedure — a trainee reads them on day
  // one, a client portal never does.
  if (resource === 'policies' && user && !user.is_service && user.role === 'client') {
    return { status: 403, message: 'The policies are internal to the company.' };
  }
  // IST rows carry a staff phone, a staff email and the client they have not
  // been trained on, and the generic CRUD route is reachable by ANY signed-in
  // session. The app manifest gates the SCREEN; only this gates the DATA.
  // (Named guard on purpose: a general `roles` field on RESOURCES is its own
 // change, still owed to the finance tables — noted.)
  if ((resource === 'istRecords' || resource === 'istHouses') &&
      user && !user.is_service && ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return { status: 403, message: 'The IST records are for admins and managers.' };
  }
  /**
 * THE CLINICAL TABS (routed ) — an incident report, a medication
   * pass, a delivery, a behaviour plan. Employees read them on shift, which is
   * the same audience the service plans already have; a client portal and a
   * trainee do not. Same shape as the two guards above: named, and at the
   * DATA, because the manifest only gates the screen.
   */
  /**
 * A CLIENT NOW READS THEIR OWN (operator: "Incidents quebrou —
   * The backend refused this request"), and a trainee still reads none.
   *
 * The blanket refusal was written, when a client account could
   * only ever have been handed the WHOLE tab — there was no rule that could
   * give somebody their own incident and nobody else's, so refusing the lot
   * was the only honest answer. There is one now: the resource is declared
   * clientScoped and hubClientNarrowList_ narrows it to the rows that name
   * them. The reason for the 403 was the absence of the narrowing, so the 403
   * goes where the narrowing arrives.
   *
   * A TRAINEE IS UNCHANGED. `onboarding` names no client, so there is nothing
   * to narrow TO — a new hire reading care records is exactly what this guard
   * was for, and it still refuses them.
   *
   * A client account with no `client_key` also still sees nothing: it names
   * nobody, and the gate answers an empty list rather than the tab.
   */
  if (HUB_CLINICAL_TABS.indexOf(resource) !== -1 && user && !user.is_service &&
      (user.role === 'onboarding' ||
       (user.role === 'client' && !(RESOURCES[resource] && RESOURCES[resource].clientScoped)))) {
    return { status: 403, message: 'These records are for employees on shift.' };
  }
  // Claims are money — the same line the finance ledger stands behind.
  if (resource === 'billingClaims' && user && !user.is_service &&
      ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return { status: 403, message: 'Billing claims are for admins and managers.' };
  }
  // The forms and what people sent through them. The definition row carries
  // the token that IS the key to a public link, and an answer is somebody's
  // report about a house or a person. Both are the same bar as the claims.
  if ((resource === 'forms' || resource === 'formSubmissions' ||
       resource === 'formFiles' ||
       resource === 'quoTranscripts' || resource === 'quoMessages' ||
       resource === 'quoSummaries') &&
      user && !user.is_service &&
      ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return { status: 403, message: 'These are for admins and managers.' };
  }
  // The widget bank is read by everyone and CURATED by the people who answer
  // for what a number on somebody's page claims to be.
  if (resource === 'widgets' && user && !user.is_service &&
      action !== 'list' && action !== 'get' &&
      ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return { status: 403, message: 'The widget bank is curated by admins and managers.' };
  }
  // The team board is the company's work, visible to everyone who does it —
  // and to nobody who does not. A client portal and a trainee's allow-list
  // both stop at the screen; this stops at the data. Projects ride the same
  // line: they exist only to group the board's cards.
  if ((resource === 'teamTasks' || resource === 'teamProjects') && user && !user.is_service &&
      (user.role === 'client' || user.role === 'onboarding')) {
    return { status: 403, message: 'The team board is for employees.' };
  }
  if (resource === 'reminders' && user && !user.is_service &&
      (user.role === 'client' || user.role === 'onboarding')) {
    return { status: 403, message: 'Reminders are for employees.' };
  }

  var cfg = RESOURCES[resource];
  if (!cfg) {
    return { status: 404, message: 'Unknown resource: "' + resource + '". ' +
      'Valid resources: ' + Object.keys(RESOURCES).join(', ') + '.' };
  }

  // Per-person resources are settled here, once, for every verb — see `ownedBy`
  // on the RESOURCES entry.
  if (cfg.ownedBy) {
    var owned = hubOwnedGate_(resource, cfg, action, payload, user);
    if (owned) return owned;
  }

  // THE PLACE, settled the same way and in the same breath (Tenant.gs): the
  // column is stripped from the payload and written from the context, and a
  // row of another place is refused before any verb touches it. `list` is
  // settled in the router below — rows do not exist yet here.
  var placed = hubPlaceGate_(resource, action, payload);
  if (placed) return placed;

  /**
 * A CLIENT MAY NOT WRITE SOMEBODY ELSE'S ROW EITHER (operator).
   *
   * `list` and `get` are settled in the router below — the rows do not exist
   * yet here — but update and delete name a row by id, and an id is a guess
   * away. Same door, same 404: "not yours" and "not here" must read alike, or
   * the refusal itself confirms the row exists.
   *
   * CREATE is deliberately untouched: a client filing their own note writes it
   * in their own environment, stamped by hubOwnedGate_ where the resource is
   * owned — the law settled this morning, and a ban is not the isolation.
   */
  var ckW = hubClientKeyOf_(user);
  if (str_(user && user.role) === 'client' && !(user && user.is_service) &&
      (action === 'update' || action === 'delete')) {
    if (!cfg.clientOpen) {
      var mine = requireRow_(resource, str_(payload && payload.id));
      if (mine.error) return mine.error;
      var no = hubClientRowGate_(resource, cfg, mine, ckW);
      if (no) return no;
    }
  }

  switch (action) {
    case 'list': {
      // People: the merge lens folds the roster's duplicates (PeopleMerge.gs —
      // a lens, and a removable one), then the clients guard drops anyone the
      // ISPs identify as a person we care FOR — the staff directory must never
      // hold a client, today or after any roster resync (Clients.gs, dictated
 // ).
      var wbDerived = wellbeingDerived_(resource, user);
      var rows = resource === 'people'
        ? withoutIspClients_(peopleMerged_(listRows_(resource, payload)))
        : resource === 'clients'
          ? clientsDerived_(user)
          : wbDerived !== null
            ? wbDerived
            : listRows_(resource, payload);
 // ISP rule (dictated ): DSPs and above read every client's
      // plan; a signed-in CLIENT reads exactly their own. The link is the
      // client_key column on the users tab — no key, no rows. Identity is never
      // guessed from a name or an email.
      if (resource === 'isps' && user && user.role === 'client' && !user.is_service) {
        var ck = String(user.client_key || '');
        rows = ck ? rows.filter(function (r) { return String(r.client_key || '') === ck; }) : [];
      }
      // Per-person resources: your rows, and only ever yours. No role widens
      // this — an admin has their own board, not everybody's (operator: "sem
      // compartilhamento dos dados"). A service identity gets none.
      if (cfg.ownedBy) {
        // the visited member's own rows when standing in one, otherwise the
        // caller's (Members.gs hubActingUserId_) — this is what "bring the
        // person with them" means for a Kanban card or a note
        var meL = hubActingUserId_(user);
        rows = meL ? rows.filter(function (r) { return hubOwnerOf_(r, cfg) === meL; }) : [];
      }
      /**
       * AND A CLIENT SEES ONLY THEMSELVES, in every resource (operator,
 * ). Declared on the resource, read by ONE gate, refused
       * omission — see hubClientNarrowList_. It runs AFTER the six older
       * narrowings above, which it agrees with: their rows already carry the
       * client_key it matches on, so this confirms rather than re-filters.
       */
      var ckL = hubClientKeyOf_(user);
      if (str_(user && user.role) === 'client' && !(user && user.is_service)) {
        rows = hubClientNarrowList_(resource, cfg, rows, ckL);
      }
      /**
 * THE PLACE NARROWS LAST (Tenant.gs, the Kanban showed
       * headquarters' cards in the franchise, and the drag wrote them back).
       * One filter, every generic resource — and because a blank `tenant`
       * cell means headquarters, a franchise opens EMPTY and fills with
       * what is made there. That is starting from scratch, finally true of
       * the data and not only of the app tiles.
       * At home `tenantRowVisible_` returns true for everything, so this
       * line is invisible to Ohio.
       */
      if (hubAwayTenant_()) {
        rows = rows.filter(function (r) { return tenantRowVisible_(r && r.tenant); });
      }
      return { status: 200, data: rows };
    }

    case 'get': {
      /**
 * EVERY DOOR PASSES THE SAME CHECK (audit: "`get`
       * clients/wellbeing answers ABOVE the place guard").
       *
       * The two derived branches returned before the guard the sheet-row
       * branch obeys, so the single-row door handed over exactly what the
       * list had just hidden — and the ids are guessable by construction
       * (`CLI_<client_key>`, `meal-<client_key>-<kind>`). The payload carries
       * date of birth, guardian, diagnoses, medications, funding, supervision
       * level and the plan's own link. So the row is FOUND first, wherever it
       * comes from, and the place is settled once for all three sources.
       */
      var wantId = String(payload.id);
      var missing = { status: 404, message: 'No row "' + payload.id + '" in ' + resource + '.' };
      var got = null, settled = false;

      // Derived clients have no sheet row — answer from the same derivation the
      // list serves, with the same per-client gate baked in.
      if (resource === 'clients') {
        var cRows = clientsDerived_(user).filter(function (r) { return String(r.id) === wantId; });
        if (cRows.length) { got = cRows[0]; settled = true; }
      }
      if (!settled) {
        var wbRows = wellbeingDerived_(resource, user);
        if (wbRows !== null) {
          var hit = wbRows.filter(function (r) { return String(r.id) === wantId; });
          got = hit.length ? hit[0] : null;
          settled = true;   // a derived resource never falls through to a tab
        }
      }
      if (!settled) {
        var row = requireRow_(resource, payload.id);
        if (row.error) return row.error;
        got = row;
      }
      if (!got) return missing;
      // a row of another place does not exist here — 404, never 403. A derived
      // row carries no place column, and blank means headquarters, which is
      // exactly how the list already treats it.
      if (!tenantRowVisible_(got && got.tenant)) return missing;
      // Same ISP rule on the single-row door.
      if (resource === 'isps' && user && user.role === 'client' && !user.is_service &&
          String(got.client_key || '') !== String(user.client_key || '')) {
        return { status: 404, message: 'No row "' + payload.id + '" in isps.' };
      }
      /**
 * AND THE SAME RULE ON EVERY OTHER DOOR (operator).
       *
       * The list was narrowed and this one was not, for sixty-odd resources —
       * and the ids are guessable by construction ('CLI_' + key, 'meal-' +
 * key + '-lunch'), which the audit already said out loud
       * about clients and wellbeing. A door that answers what the list hid is
       * not a smaller hole, it is the same hole with a URL.
       */
      var ckG = hubClientKeyOf_(user);
      if (str_(user && user.role) === 'client' && !(user && user.is_service)) {
        var refused = hubClientRowGate_(resource, cfg, got, ckG);
        if (refused) return missing;
      }
      return { status: 200, data: got };
    }

    case 'create': {
      if (cfg.readOnly) return methodNotAllowed_(resource, action);
      // the place was stamped by hubPlaceGate_ above, from the context
      var created = createRow_(resource, payload);
      return { status: 200, data: created };
    }

    case 'update': {
      // Read-only blocked create and delete but not update, and the `apps` tab
      // is merged into EVERY session's registry by initDynamicApps — any
      // signed-in token could rename an app or switch one off for the whole
      // workspace. Admin-only here; appUpsert was decoration while this stood
      // open.
      if (cfg.readOnly && !(user && user.role === 'admin')) return hubDenied_();
      // The declared stamp, for SHARED resources. It used to run only inside
      // hubOwnedGate_, so teamTasks declared completedAt and nothing ever
      // wrote it — a config the self-test read as done while no card was ever
 // dated (found ). Owned resources stamped in the gate above;
      // running it there and here would date a completion twice.
      if (cfg.stampWhen && !cfg.ownedBy) {
        var stampRow = requireRow_(resource, str_(payload && payload.id));
        if (!stampRow.error) hubStampWhen_(cfg, stampRow, payload);
      }
      var updated = updateRowById_(resource, payload);
      return updated.error ? updated.error : { status: 200, data: updated };
    }

    case 'delete': {
      if (cfg.readOnly) return methodNotAllowed_(resource, action);
      /* AND A BOOK THAT MAY BE WRITTEN BUT NEVER EMPTIED. `noDelete` is
         declared beside the resource, so the law is read where the resource
         is described rather than as a name in a list somewhere else. It
         refuses ADMINS TOO: the record exists to be defended by somebody who
         was not in the room, and an exception for the person most likely to
         be asked to remove a row is not an exception, it is the hole. */
      if (cfg.noDelete) {
        return { status: 405, message: 'Rows of "' + resource + '" are never deleted here — ' +
          'this book is the record somebody may have to defend months from now. ' +
          'Correct the row instead; a correction keeps the history and a delete does not.' };
      }
      // the place was checked by hubPlaceGate_ above
      var removed = deleteRowById_(resource, payload.id);
      return removed.error ? removed.error : { status: 200, data: { id: payload.id, deleted: true } };
    }

    default:
      return { status: 400, message: 'Unknown action: "' + action + '". ' +
        'Valid actions: list, get, create, update, delete.' };
  }
}

/** 405 for a verb a read-only resource does not accept. */
function methodNotAllowed_(resource, action) {
  return { status: 405, message: 'Action "' + action + '" is not allowed on resource "' +
    resource + '" (read/update-only).' };
}
