// SETTINGS > EDITIONS — the delicate edits, each with its key and the people who may make it.
// An edition is one edit ability of an app (EDITIONS: its id, the app, what it lets a person change).
var EDITIONS_KEY = 'mywork_editions';

/** Editions are made by employees: the roles a list may name. */
var EDITION_ROLES = ['admin', 'manager', 'staff'];

/** How many people one edition's list may hold. */
var EDITION_MAX_PEOPLE = 100;

/** Every edition the platform has, in the order Settings lists them. */
var EDITIONS = [
  { id: 'locations.house', app: 'locations', app_name: 'Locations', label: 'House — every section',
    description: 'Edit every section of a house: House Details (the registry row), House Notes (a new note, resolve ' +
                 'or reopen one), House Supplies (counts, deliveries and corrections), House Repairs (a new request ' +
                 'and its edits) and IST papers. It also corrects what was on hand after a supplies delivery and ' +
                 'removes a mistaken supplies entry (its row stays on the ledger; no list shows it). Those two work ' +
                 'while Locations runs on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'locations.staffRemove', app: 'locations', app_name: 'Locations', label: 'Staff — take a person off',
    description: 'Take a person off a house\'s Staff list. Their staff record, their shifts and the house\'s history ' +
                 'stay exactly as they are; the person can be put back.' },
  { id: 'locations.incidents', app: 'locations', app_name: 'Locations', label: 'Incidents — open and edit',
    description: 'Open a new incident for one of the house\'s clients, and edit an incident\'s report.' },
  { id: 'locations.documents', app: 'locations', app_name: 'Locations', label: 'Documents — add and remove',
    description: 'Remove any of the house\'s own documents, add one from a Google Drive link, or upload one from ' +
                 'outside the platform.' },
  { id: 'locations.notesAny', app: 'locations', app_name: 'Locations', label: 'House Notes — anyone\'s note',
    description: 'Edit and save a house note written by anyone, or remove it.' },
  { id: 'locations.clientsAdd', app: 'locations', app_name: 'Locations', label: 'Associated clients — add',
    description: 'Add more clients to a house. The house\'s current clients are never taken off.' },
  { id: 'locations.assets', app: 'locations', app_name: 'Locations', label: 'House assets — add and edit',
    description: 'Add an asset to a house, or edit one (item, condition, replaced or expires, cost to replace, how ' +
                 'often), on the House Supplies inventory. An asset stays at its house and is never removed here.' },
  { id: 'clients.profile', app: 'client-profiles', app_name: 'Clients', label: 'Client profile — the details',
    description: 'Edit a client\'s profile: the details the master edits today (contact, house, initials, ISP signed ' +
                 'date…). Protected fields stay locked (the SSN, the card and its codes), and the name and the status ' +
                 'are not part of it.' },
  { id: 'clients.care', app: 'client-profiles', app_name: 'Clients', label: 'Care — daily care, health, goals and home',
    description: 'Edit, hide or add a client\'s care record in Care & Support (Daily care, Health & behavior, Personal ' +
                 'goals, Home & equipment), kept in the Hub over the plan. Care plans, the care team and the family ' +
                 'members are not part of it.' },
  { id: 'clients.family', app: 'client-profiles', app_name: 'Clients', label: 'Family members — correct, hide or add',
    description: 'Correct a family member the plan names in Client Profile › Family members (name, relationship, ' +
                 'phone, e-mail), hide one from the profile, or add one the plan leaves out, kept in the Hub over the ' +
                 'plan\'s important people: the plan itself is never changed, and a family member\'s own record across ' +
                 'their clients stays with Families. Works while Clients runs on Python; the change is kept in the ' +
                 'Hub\'s database, not on a sheet.' },
  { id: 'clients.medication', app: 'client-profiles', app_name: 'Clients',
    label: 'Medication — add, change or remove a medication',
    description: 'Add a medication to a client\'s eMAR chart, change one (name, dose, times, type, frequency, ' +
                 'discontinued) or take one off the chart, in Medication › Medications. Administration and Refills ' +
                 'are not part of it.' },
  { id: 'clients.transportation', app: 'client-profiles', app_name: 'Clients',
    label: 'Transportation — change or cancel a client\'s trip',
    description: 'Open a client\'s trip from Clients › Transportation in the Transportation app\'s own trip panel and ' +
                 'change it (time, vehicle, driver, staff, type, purpose, destination, details) or cancel it. A ' +
                 'waiting request is still approved or declined by the directors, and the trip stays with its client.' },
  { id: 'staff.profile', app: 'staff-profiles', app_name: 'Staff', label: 'Staff Details — contacts and address',
    description: 'Edit a staff member\'s phone and e-mail, their account phones, contact e-mails and photo (Staff Details), ' +
                 'and their street address, city, state and zip (HR Admin\'s own panel). The name, the status and the ' +
                 'sign-in e-mail stay the master\'s; the SSN, the date of birth and the licence number are never edited ' +
                 'here. Works while Staff runs on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'staff.employment', app: 'staff-profiles', app_name: 'Staff', label: 'Employment — hiring, dates and qualifications',
    description: 'Edit Employment: the referral and whether it was paid, the job application and attestation dates, the ' +
                 'resume, the start and end dates, the high school diploma and Driver. Works while Staff runs on ' +
                 'Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'staff.hr', app: 'staff-profiles', app_name: 'Staff', label: 'HR Admin — forms, work authorization and screening',
    description: 'Edit HR Admin from its own panel: the W-4, pay authorization and HIPAA dates, the I-9 and its documents, ' +
                 'the licence, abstract and insurance dates, every screening line, the BCI check and Rapback dates. The SSN, ' +
                 'the date of birth, the licence number and the BCI receipt stay locked. HR Admin is read from the sheet, so ' +
                 'a change shows there once the sync carries it. Works while Staff runs on Python; the change is kept in ' +
                 'the Hub\'s database, not on a sheet.' },
  { id: 'staff.driving', app: 'staff-profiles', app_name: 'Staff', label: 'Driver — the driving record',
    description: 'Edit the driving record\'s facts (driver, points, licence and insurance expiry, the abstracts) and the ' +
                 'licence standing. The licence number is never edited here. Works while Staff runs on Python; the ' +
                 'change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'staff.mais', app: 'staff-profiles', app_name: 'Staff', label: 'Med Del (MAIS) — a Cat level\'s line',
    description: 'Edit the status, effective and expiry of a staff member\'s latest MAIS line; a newer line from the ' +
                 'registry check shows instead once it arrives. Works while Staff runs on Python; the change is kept in ' +
                 'the Hub\'s database, not on a sheet.' },
  { id: 'staff.ist', app: 'staff-profiles', app_name: 'Staff', label: 'IST — a training record',
    description: 'Edit an IST record of a staff member: owed or trained, the due day and the trained day. Which client and ' +
                 'house it pairs stays as Settings › IST maps it. Works while Staff runs on Python; the change is kept ' +
                 'in the Hub\'s database, not on a sheet.' },
  { id: 'staff.preferences', app: 'staff-profiles', app_name: 'Staff', label: 'Preferences — shifts, days, places and allergies',
    description: 'Save a staff member\'s preferences: preferred shifts, open-shift pickup, weekend work, unavailable days and ' +
                 'locations, allergies and the note. The imported shifts text stays as it came. Works while Staff runs ' +
                 'on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'staff.notes', app: 'staff-profiles', app_name: 'Staff', label: 'Staff notes — add, resolve or reopen',
    description: 'File a staff note on a person, and resolve or reopen any staff note. A note\'s text is never rewritten. ' +
                 'Works while Staff runs on Python; the note is kept in the Hub\'s database, not on a sheet.' },
  { id: 'staff.notesEdit', app: 'staff-profiles', app_name: 'Staff', label: 'Staff notes — edit a note',
    description: 'Edit any staff note\'s category, priority and text, from the Staff notes panel or Performance › Notes. ' +
                 'Who filed it and when stay as filed, and a note is never removed here (resolve it instead). Works ' +
                 'while Staff runs on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'ssa.profile', app: 'ssa-profiles', app_name: 'SSA', label: 'SSA Details — contacts, agency and office address',
    description: 'Edit an SSA\'s details from SSA › Overview: the phone and e-mail, on every current client record that ' +
                 'names the SSA, and the agency and office address, kept on the SSA\'s own record (a blank agency goes ' +
                 'back to the one the e-mail\'s domain names). The name and the county stay on each client\'s record, in ' +
                 'Clients. Works while SSA runs on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'ssa.notes', app: 'ssa-profiles', app_name: 'SSA', label: 'Admin notes — add a note',
    description: 'File an admin note about an SSA, from the Overview or the Actions menu; it shows in the SSA\'s notes ' +
                 'and Activity. A note is never edited or removed here. Works while SSA runs on Python; the change is ' +
                 'kept in the Hub\'s database, not on a sheet.' },
  { id: 'family.profile', app: 'family-profiles', app_name: 'Families', label: 'Family member — the details',
    description: 'Edit a family member\'s details in Families: phone, email, address and photo link, and, for each client ' +
                 'whose own record names them, the relationship and the guardianship papers, on every client record ' +
                 'that names the member and on their people-directory row. The name is not part of it (a new name ' +
                 're-keys the member and moves their notes), and a sign-in is never changed here. Works while Families ' +
                 'runs on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'family.notes', app: 'family-profiles', app_name: 'Families', label: 'Admin notes — add, edit or remove a note',
    description: 'File an admin note about a family member from the Overview or the Actions menu, and change the text ' +
                 'of any note on file or remove it (a removed note leaves the notes and the Activity). Works while ' +
                 'Families runs on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'family.calls', app: 'family-profiles', app_name: 'Families', label: 'Calls — schedule, change or cancel a call',
    description: 'Schedule a call with a family member about one of their clients, and change a call filed from ' +
                 'Families (its day, priority, state and details) or cancel it, from the family member\'s Activity. ' +
                 'No message is sent; a cancelled call stays on its board in Done, labelled Cancelled, and the Task ' +
                 'Board shows a change once the sync carries it to its sheet (within about 10 minutes). Works while ' +
                 'Families runs on Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'family.incidents', app: 'family-profiles', app_name: 'Families', label: 'Incidents — file one from Families',
    description: 'File a new incident for one of a family member\'s clients from Families (Clients\' own incident form) ' +
                 'and tie it to the family member, so it shows in their Activity. Works while Families runs on Python; ' +
                 'the tie is kept in the Hub\'s database, not on a sheet.' },
  { id: 'scheduling.calendar', app: 'scheduling', app_name: 'Scheduling',
    label: 'House Calendars — shifts and people',
    description: 'Edit any house\'s calendar from House Calendars and Staff Calendars: add, change or delete a shift and ' +
                 'its note, give an OPEN shift to somebody, put somebody on a house, and undo your own last change ' +
                 'there. Cancelling a request that waits on a shift, a training\'s hours, placing somebody new to a ' +
                 'house or against their Staff Preferences, a call-off and a swap stay with the house manager, the ' +
                 'directors and the master. Works while Scheduling runs on Python; the change is kept in the Hub\'s ' +
                 'database, not on a sheet.' },
  { id: 'scheduling.builder', app: 'scheduling', app_name: 'Scheduling',
    label: 'Builder — draft, approve and publish',
    description: 'Build any house\'s next weeks in the Builder: save the draft, approve its pattern check and publish ' +
                 'it into the house\'s calendar, with the period its last weeks need. The Builder screen is still ' +
                 'released in App Control. Works while Scheduling runs on Python; the change is kept in the Hub\'s ' +
                 'database, not on a sheet.' },
  { id: 'scheduling.settings', app: 'scheduling', app_name: 'Scheduling',
    label: 'Settings — notice, waits and the cycle',
    description: 'Change the Scheduling settings: the minutes before everyone is texted after a call-off, the days of ' +
                 'notice for Request Off and Time off, the days in a period and the days before a period ends. Who ' +
                 'the directors are, the seed, the copy forward and the time off import stay the master\'s, and the ' +
                 'requests Apps Script answers read a new value once the Hub\'s sync carries it to the sheet (within ' +
                 'about ten minutes). Works while Scheduling runs on Python; the change is kept in the Hub\'s ' +
                 'database, not on a sheet.' },
  { id: 'transportation.trips', app: 'vehicle-calendar', app_name: 'Transportation',
    label: 'Trips — details, assignment and status',
    description: 'Change any trip in Transportation\'s trip panel (time, vehicle, driver, staff, client, trip type, ' +
                 'purpose, destination, details, wheelchair and the assignment note) and set it to Scheduled, Needs ' +
                 'assignment or Cancelled. A request still waiting is approved or declined by the directors, and a trip ' +
                 'somebody asked for is cancelled by the directors, who text them. Works while Transportation runs on ' +
                 'Python; the change is kept in the Hub\'s database, not on a sheet.' },
  { id: 'transportation.vehicles', app: 'vehicle-calendar', app_name: 'Transportation',
    label: 'Vehicles — add and edit a vehicle',
    description: 'Add a vehicle, or edit one (name, description, seats, wheelchair accessible, availability and its ' +
                 'note) in Transportation › Vehicles. A vehicle sent to maintenance or out of service hands its scheduled ' +
                 'trips back to Needs assignment. Works while Transportation runs on Python; the change is kept in the ' +
                 'Hub\'s database, not on a sheet.' },
  { id: 'transportation.settings', app: 'vehicle-calendar', app_name: 'Transportation',
    label: 'Setup — the trip types',
    description: 'Change the trip types a request and a trip choose from, in Transportation › Setup. Who approves (the ' +
                 'directors), the text numbers, the seed and the Van Calendar import stay the master\'s. Works while ' +
                 'Transportation runs on Python; the change is kept in the Hub\'s database, not on a sheet.' }
];

/** The edition by its id; null for an id the platform does not have. */
function hubEditionOf_(id) {
  var want = String(id == null ? '' : id).trim();
  for (var i = 0; i < EDITIONS.length; i++) if (EDITIONS[i].id === want) return EDITIONS[i];
  return null;
}

// FAIL-CLOSED: the stored list as { 'k:<id>': { on, people } }, each known edition once; a cell that is blank…
function hubEditionsParse_(raw) {
  var out = {};
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return out;
  var list;
  try { list = JSON.parse(text); } catch (e) { return out; }
  if (!Array.isArray(list)) return out;
  list.forEach(function (e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return;
    var ed = hubEditionOf_(e.id);
    if (!ed || out['k:' + ed.id]) return;
    var people = [];
    (Array.isArray(e.people) ? e.people : []).forEach(function (p) {
      var id = String(p == null ? '' : p).trim().slice(0, 80);
      if (id && people.indexOf(id) === -1 && people.length < EDITION_MAX_PEOPLE) people.push(id);
    });
    out['k:' + ed.id] = { on: e.on === true, people: people };
  });
  return out;
}

/** FAIL-CLOSED: the list as the config tab holds it; a tab that cannot be read opens nothing. */
function hubEditionsRead_() {
  var cfg;
  try { cfg = hiringAlerts_() || {}; } catch (e) { return {}; }
  return hubEditionsParse_(cfg[EDITIONS_KEY]);
}

/** FAIL-CLOSED: an edition answers at home alone — never inside a world or from a place away from home. */
function hubEditionAtHome_() {
  try {
    if (typeof HUB_WORLD_CTX !== 'undefined' && HUB_WORLD_CTX) return false;
    if (typeof hubAwayTenant_ === 'function' && hubAwayTenant_()) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// FAIL-CLOSED: may this session make the edition?
function hubEditionAllows_(id, user) {
  try {
    var ed = hubEditionOf_(id);
    if (!ed) return false;
    if (hubIsRealMaster_(user)) return true;
    if (!user || user.is_service === true || user.visiting_member) return false;
    if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX) return false;
    if (!hubEditionAtHome_()) return false;
    if (EDITION_ROLES.indexOf(String(user.role || '').trim().toLowerCase()) === -1) return false;
    var uid = String(user.id || '').trim();
    if (!uid) return false;
    var held = hubEditionsRead_()['k:' + ed.id];
    return !!held && held.on === true && held.people.indexOf(uid) !== -1;
  } catch (e) {
    return false;
  }
}

/** The editions of one app this session may make, in catalogue order: every one for the master. */
function hubEditionsFor_(user, app) {
  return EDITIONS.filter(function (e) { return e.app === app && hubEditionAllows_(e.id, user); })
    .map(function (e) { return e.id; });
}

/** The catalogue with each edition's key and list, as Settings > Editions draws it. */
function hubEditionsView_(stored) {
  return EDITIONS.map(function (e) {
    var held = stored['k:' + e.id] || { on: false, people: [] };
    return { id: e.id, app: e.app, app_name: e.app_name, label: e.label, description: e.description,
             on: held.on === true, people: held.people.slice() };
  });
}

/** The editions this session makes (of one app when `app` names it): ids only, never a list or a key. */
HUB_POLICY.editionsMine = {
  file: 'Editions.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  params: { app: { type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.editionsMine = function (payload, user) {
  var app = String((payload && payload.app) || '').trim();
  return { status: 200, data: { editions: EDITIONS.filter(function (e) {
    return (!app || e.app === app) && hubEditionAllows_(e.id, user);
  }).map(function (e) { return e.id; }) } };
};

/** The master's own read of every edition, its key and its people. Everybody else gets the unadvertised 404. */
HUB_POLICY.editionsGet = {
  file: 'Editions.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.editionsGet = function (payload, user) {
  if (!hubIsRealMaster_(user)) return { status: 404, message: 'Unknown action.' };
  var cfg;
  try { cfg = hiringAlerts_() || {}; } catch (e) {
    // never answered as "nobody": a list saved over one nobody read would replace it
    return { status: 503, message: 'The platform config could not be read, so the editions are not shown. Try again.' };
  }
  var raw = String(cfg[EDITIONS_KEY] == null ? '' : cfg[EDITIONS_KEY]).trim();
  var malformed = false;
  if (raw) {
    try { malformed = !Array.isArray(JSON.parse(raw)); } catch (eP) { malformed = true; }
  }
  return { status: 200, data: { editions: hubEditionsView_(hubEditionsParse_(raw)), malformed: malformed } };
};

// The master saves every edition at once: its key and its people.
HUB_POLICY.editionsSet = {
  file: 'Editions.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { editions: { required: true, type: 'array' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.editionsSet = function (payload, user) {
  if (!hubIsRealMaster_(user)) return { status: 404, message: 'Unknown action.' };
  var sent = payload && payload.editions;
  if (!Array.isArray(sent)) return { status: 400, message: 'editions: every edition, its key and its people.' };
  var byId = {};
  usersAll_().forEach(function (u) {
    var uid = str_(u.userid);
    if (uid) byId['k:' + uid] = u;
  });
  var out = [], seen = {};
  for (var i = 0; i < sent.length; i++) {
    var e = (sent[i] && typeof sent[i] === 'object') ? sent[i] : {};
    var ed = hubEditionOf_(e.id);
    if (!ed) return { status: 400, message: 'No edition "' + str_(e.id).slice(0, 80) + '". Nothing was saved.' };
    if (seen['k:' + ed.id]) return { status: 400, message: ed.label + ' is named twice. Nothing was saved.' };
    seen['k:' + ed.id] = true;
    var people = Array.isArray(e.people) ? e.people : [];
    if (people.length > EDITION_MAX_PEOPLE) {
      return { status: 400, message: 'At most ' + EDITION_MAX_PEOPLE + ' people on one edition. Nothing was saved.' };
    }
    var ids = [];
    for (var p = 0; p < people.length; p++) {
      var id = str_(people[p]).slice(0, 80);
      if (!id) return { status: 400, message: 'Every person on ' + ed.label + ' is an account. Nothing was saved.' };
      if (ids.indexOf(id) !== -1) continue;
      var row = byId['k:' + id];
      if (!row) return { status: 400, message: 'No account "' + id + '". Nothing was saved.' };
      var name = str_(row.displayname) || str_(row.email) || id;
      if (hubIsMaster_(str_(row.email))) {
        return { status: 400, message: 'The master account holds every edition; it is never put on a list. ' +
                 'Nothing was saved.' };
      }
      var role = (str_(row.role) || 'staff').toLowerCase();
      if (EDITION_ROLES.indexOf(role) === -1) {
        return { status: 400, message: 'Editions are for employees only (admin, manager or staff); ' + name +
                 ' is ' + role + '. Nothing was saved.' };
      }
      ids.push(id);
    }
    out.push({ id: ed.id, on: e.on === true, people: ids });
  }
  var kept = out.filter(function (x) { return x.on || x.people.length; });
  var values = {};
  values[EDITIONS_KEY] = kept.length ? JSON.stringify(kept) : '';
  var saved = HUB_ACTIONS.hiringAlertsSet({ values: values }, user);
  if (!saved || saved.status !== 200) return saved || { status: 500, message: 'The config door gave no answer.' };
  try {
    hubSysLog_(str_(user.email), 'editions_set', kept.filter(function (x) { return x.on; }).length +
               ' edition(s) on, ' + kept.length + ' with a list', { status: 200 });
  } catch (eG) {}
  return { status: 200, data: { editions: hubEditionsView_(hubEditionsParse_(values[EDITIONS_KEY])), malformed: false } };
};
