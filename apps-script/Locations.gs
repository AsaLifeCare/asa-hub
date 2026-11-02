// Locations: one house at a time.
// A read opens through App Control's row (hubProfileAppGate_) and is cut to the viewer's houses; every write is the…

var LOCATION_SUPPLY_ORDER_DAYS = 7;
var LOCATION_LEAD_DAYS = 92;
var LOCATION_NOTES_TAB = 'house_notes';
var LOCATION_NOTES_HEADER = ['id', 'house', 'client_key', 'priority', 'details', 'state', 'by', 'at',
                             'state_by', 'state_at'];
var LOCATION_NOTE_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
var LOCATION_NOTE_STATES = ['open', 'resolved'];
// A removed note stays on the tab; no read lists it.
var LOCATION_NOTE_EDIT_STATES = ['open', 'resolved', 'removed'];
var LOCATION_NOTE_EDIT_FIELDS = ['details', 'priority', 'client_key', 'state'];
var LOCATION_SUPPLY_EDIT_FIELDS = ['qty', 'category', 'note'];
// The registry columns the house panel writes; the code (abbreviation) is the join key and never one of them.
var LOCATION_HOUSE_FIELDS = ['home_name', 'address', 'region', 'telephone', 'manager_name', 'manager_phone',
                             'calendar_link', 'thumbnail_url'];
var LOCATION_HOUSE_PHONES = ['telephone', 'manager_phone'];
var LOCATION_HOUSE_LOCKED = {
  abbreviation: 'The house code is the key every app joins on; it is never edited.'
};
// A house photo uploaded from Locations, as the relay keeps it (server/house_images.py URL_RE).
var LOCATION_IMAGE_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/erp-lanes\/locations\/image\/([A-Z]{2,4}\d{3,6})\/\d{8}T\d{9}Z\.(jpg|png|webp)$/;
// The House Supplies inventory columns an asset edit or a new asset writes; the asset's house (its address) stays.
var LOCATION_ASSET_FIELDS = ['item', 'current_condition', 'est_expiration_year', 'cost_to_replace',
                             'replacement_frequency'];
var LOCATION_SUPPLY_TAB = 'houseSupplies';
var LOCATION_SUPPLY_HEADER = ['id', 'house', 'item', 'qty', 'needed_by', 'status',
                              'kind', 'category', 'on_hand_after', 'at', 'by', 'note'];
var LOCATION_SUPPLY_KINDS = ['count', 'delivery', 'par'];
var LOCATION_IST_FOLDER = 'IST';
var LOCATION_DOC_MAX_BYTES = 15 * 1024 * 1024;
// Same books the relay reads (server/house_slices.py); a script property overrides either.
var LOCATION_ENTITIES_PROP = 'HUB_CLIENT_ENTITIES_SHEET_ID';
var LOCATION_ENTITIES_FALLBACK = '1yIc3f9S9ZRlAJ3drUinFmm0gTflO-GUx0BVaFVYVopI';
var LOCATION_HOMES_TAB = 'entity_homes';
var LOCATION_COMMON_PROP = 'HUB_COMMON_DATA_SHEET_ID';
var LOCATION_COMMON_FALLBACK = '1-XgGNQMkHAlGQjqvhg3Ao89pO-8DJoqjIr9ggjAXprE';
var LOCATION_POLICIES_TAB = 'Company Policies';
var LOCATION_ACTIONS = ['locationScope', 'locationOverview', 'locationStaff', 'locationRepairs', 'locationIncidents',
                        'locationDocuments', 'locationSupplies', 'locationNotes', 'locationDocFile',
                        'locationNoteAdd', 'locationNoteState', 'locationSupplyEntry', 'locationIstFile',
                        'locationHouseSave', 'locationNoteEdit', 'locationSupplyEdit',
                        'locationStaffRemove', 'locationIncidentFile', 'locationIncidentEdit', 'locationRepairFile',
                        'locationRepairEdit', 'locationDocRemove', 'locationDocLink', 'locationDocUpload',
                        'locationClientsAdd', 'locationAssetEdit', 'locationAssetAdd'];
var LOCATION_APP_ID = 'locations';
// The edition each write door belongs to (Editions.gs EDITIONS).
var LOCATION_EDITION = { house: 'locations.house', staffRemove: 'locations.staffRemove',
                         incidents: 'locations.incidents', documents: 'locations.documents',
                         notesAny: 'locations.notesAny', clientsAdd: 'locations.clientsAdd',
                         assets: 'locations.assets' };
// The people taken off a house's Staff list: a row per change, the last for a person deciding; nothing is deleted.
var LOCATION_STAFF_OFF_TAB = 'house_staff_off';
var LOCATION_STAFF_OFF_HEADER = ['id', 'house', 'staff_key', 'name', 'state', 'by', 'at'];
// A house document removed here moves to this folder of the houses room, so it can be put back by hand.
var LOCATION_DOC_REMOVED_FOLDER = 'Removed from Locations';
var LOCATION_DOC_OFFICE_TYPES = {
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
// The estate columns an incident or a repair edit may write; when it was filed stays as filed.
var LOCATION_INCIDENT_EDIT_FIELDS = ['your_name', 'client_name', 'incident_category', 'incident_location',
  'incident_date', 'incident_time', 'incident_reported_date', 'incident_reported_time', 'employees_involved',
  'summary_of_incident', 'immediate_action_taken', 'cause_and_contributing_factors', 'prevention_plan'];
var LOCATION_REPAIR_EDIT_FIELDS = ['repair_type', 'urgency_level', 'please_describe_the_issue', 'status',
                                   'resolution_notes'];
// At most this many clients are added to a house in one press.
var LOCATION_CLIENTS_ADD_MAX = 20;
// The company documents a client or a family member is shown, folded (house_slices.CLIENT_POLICIES).
var LOCATION_CLIENT_POLICIES = ['billofrightser', 'muihandbook'];
// The relay's pack: the parts no slice may carry, each from its section's own builder, in one execution; last, each…
var LOCATION_PACK_PARTS = ['overview', 'staff', 'notes', 'supplies', 'guidebook', 'repairs', 'incidents',
                           'client_views'];
// Set only while locationPack runs, so the Calendar Archive and the punches are read once per pack.
var LOCATION_PACK_MEMO_ = null;
var LOCATION_OFFICE_TO_GOOGLE = {
  'application/msword': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'application/rtf': 'application/vnd.google-apps.document',
  'application/vnd.oasis.opendocument.text': 'application/vnd.google-apps.document',
  'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'application/vnd.google-apps.presentation'
};

/** FAIL-CLOSED: the writes' gate — the master in its own session, never a visit or a service call. */
function locationsGate_(user) {
  try { return !!hubIsRealMaster_(user); } catch (e) { return false; }
}

function locationsUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

/** FAIL-CLOSED: the reads' gate — App Control's row for Locations. The viewer's scope, or null when it is closed. */
function locationsViewer_(user) {
  var gate = null;
  try { gate = hubProfileAppGate_(LOCATION_APP_ID, user); } catch (e) { gate = null; }
  return gate && gate.open && gate.scope && gate.scope.kind !== 'none' ? gate.scope : null;
}

// A viewer held to the houses its scope names and, in each, to its own clients: no other client's name, incident…
function locationsNarrowed_(scope) {
  return !scope || (scope.kind !== 'master' && scope.kind !== 'all');
}

// A client or a family member, past the narrowing: no house notes, guidebook, staff policies, IST paper, or staff…
function locationsCut_(scope) {
  return !scope || scope.kind === 'client' || scope.kind === 'guardian';
}

// FAIL-CLOSED: a read's door — the gate, then a narrowed viewer's own houses only (any other code, well formed or…
function locationsReadDoor_(payload, user) {
  var scope = locationsViewer_(user);
  if (!scope) return { refused: locationsUnknown_() };
  if (locationsNarrowed_(scope) &&
      (scope.house_codes || []).indexOf(locationsHouseCode_(payload && payload.house) || '-') === -1) {
    return { refused: locationsUnknown_() };
  }
  var ctx = locationsHouse_(payload && payload.house);
  if (ctx.refused) return { refused: ctx.refused };
  return { ctx: ctx, scope: scope };
}

// FAIL-CLOSED: a write's door — the master in its own session, at any house; else a person the edition names while…
function locationsEditDoor_(payload, user, edition) {
  if (locationsGate_(user)) {
    var ctx = locationsHouse_(payload && payload.house);
    return ctx.refused ? { refused: ctx.refused } : { ctx: ctx, master: true };
  }
  var allowed = false;
  try { allowed = hubEditionAllows_(edition, user); } catch (e) { allowed = false; }
  if (!allowed) return { refused: locationsUnknown_() };
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return { refused: door.refused };
  if (locationsCut_(door.scope)) return { refused: locationsUnknown_() };
  return { ctx: door.ctx, master: false };
}

/** The editions this session makes at Locations: every one for the master, else what the keys and lists give it. */
function locationsEditions_(user) {
  if (locationsGate_(user)) return Object.keys(LOCATION_EDITION).map(function (k) { return LOCATION_EDITION[k]; });
  try { return hubEditionsFor_(user, LOCATION_APP_ID); } catch (e) { return []; }
}

// What a landed edit tells the screen: the places the server itself wrote (`steps`: the sheet, then the kept caches…
function locationsSteps_(sheet, caches, slices, mirror, where) {
  return { steps: [{ id: 'sheet', label: where || 'Sheet', landed: true, words: sheet },
                   { id: 'cache', label: 'Kept caches', landed: true, words: caches }],
           slices: slices || [], mirror: mirror || [], app: LOCATION_APP_ID };
}

/** `data` with the steps of a landed edit beside it. */
function locationsWithSteps_(data, steps) {
  var out = locationsCopy_(data);
  Object.keys(steps).forEach(function (k) { out[k] = steps[k]; });
  return out;
}

/** A shallow copy: a cut never touches the cached answer it starts from. */
function locationsCopy_(o) {
  var out = {};
  Object.keys(o || {}).forEach(function (k) { out[k] = o[k]; });
  return out;
}

/** The viewer's own clients among these (by client_key). */
function locationsMine_(list, scope) {
  var keys = (scope && scope.client_keys) || [];
  return (list || []).filter(function (c) { return !!c && keys.indexOf(String(c.client_key || '')) !== -1; });
}

function locationsToday_() {
  var now = (typeof hubQuietNow_ === 'function') ? hubQuietNow_() : new Date();
  try { return Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd'); }
  catch (e) { return now.toISOString().slice(0, 10); }
}

function locationsDayShift_(iso, days) {
  var t = Date.parse(String(iso || '') + 'T12:00:00Z');
  return isNaN(t) ? '' : new Date(t + Number(days || 0) * 86400000).toISOString().slice(0, 10);
}

/** The trailing house code of a label ("CAN - 47TH - ABD4708" → ABD4708); '' otherwise. */
function locationsCode_(v) {
  var m = /([A-Z]{2,4}\d{3,6})\s*$/.exec(String(v == null ? '' : v).trim().toUpperCase());
  return m ? m[1] : '';
}

/** A cell that is exactly a house code; '' otherwise. */
function locationsHouseCode_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return /^[A-Z]{2,4}\d{3,6}$/.test(s) ? s : '';
}

function locationsText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

function locationsCell_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v == null ? '' : v).trim();
}

/** A plain number or null; words and blanks are never 0. */
function locationsNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim().replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

function locationsFirstUrl_(v) {
  var m = /https?:\/\/[^\s\[\]]+/.exec(String(v || ''));
  return m ? m[0] : '';
}

/** A photo URL the relay keeps for this house (LOCATION_IMAGE_RE). */
function locationsHouseImage_(v, code) {
  var m = LOCATION_IMAGE_RE.exec(String(v || ''));
  return !!m && m[2] === code;
}

function locationsDriveId_(v) {
  var s = String(v || '');
  var m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  return m ? m[1] : '';
}

function locationsIsPerson_(name) {
  var n = String(name || '').trim();
  if (!n || !/[a-z]/i.test(n)) return false;
  try { return !istNotAPerson_(n); } catch (e) {
    return !/^(OPEN|NEW|FAMILY|LOCATION|NURSE|STAFF|TBD)$/i.test(n) && !/WORKSHOP/i.test(n);
  }
}

/** Street key, unit and house number: "4060 Orchard Dale Dr NW, Apt B, Canton" → {4060orcharddaledrnw, b, 4060}. */
function locationsAddr_(v) {
  var s = String(v == null ? '' : v).toLowerCase();
  var m = /(?:^|[\s,(])(?:apt|apartment|unit|suite|ste)\b\.?\s*#?\s*([a-z0-9]+)\b/.exec(s) ||
          /#\s*([a-z0-9]+)\b/.exec(s);
  var street = s.replace(/\([^)]*\)/g, ' ');
  var cut = street.search(/(?:^|[\s,])(?:apt|apartment|unit|suite|ste)\b|#/);
  if (cut > 0) street = street.slice(0, cut);
  var num = /^\s*(\d{2,6})\b/.exec(street);
  return { key: hubAddrKey_(street), unit: m ? m[1] : '', num: num ? num[1] : '' };
}

/** Every address each house answers to: the registry's, and its clients' own. */
function locationsAddrIndex_(homes, clients) {
  var by = {};
  var add = function (code, value) {
    if (!code || !String(value || '').trim()) return;
    var a = locationsAddr_(value);
    if (a.key || a.num) by[code].push(a);
  };
  (homes || []).forEach(function (h) {
    if (!h || !h.code) return;
    by[h.code] = by[h.code] || [];
    add(h.code, h.address);
  });
  (clients || []).forEach(function (c) {
    var code = locationsHouseCode_(c && c.house);
    if (!code) return;
    by[code] = by[code] || [];
    add(code, c.home_address);
  });
  return by;
}

/** The one house an address names: street and unit exactly, else a house number (and unit) no other house shares. */
function locationsAddrOwner_(index, value) {
  var a = locationsAddr_(value);
  var none = { code: '', how: '' };
  var codes = Object.keys(index || {});
  var exact = codes.filter(function (c) {
    return index[c].some(function (x) { return !!a.key && x.key === a.key && x.unit === a.unit; });
  });
  if (exact.length === 1) return { code: exact[0], how: 'exact' };
  if (exact.length > 1 || !a.num) return none;
  var near = codes.filter(function (c) {
    return index[c].some(function (x) { return x.num === a.num && (!a.unit || x.unit === a.unit); });
  });
  return near.length === 1 ? { code: near[0], how: 'street_number' } : none;
}

function locationsClientCurrent_(c) {
  var s = String((c && c.status) || '').trim().toLowerCase();
  return !s || s === 'active';
}

// The one rule for a live client: not in the archive of old clients, and a status blank or 'active'.
function clientLive_(c) {
  if (!c) return false;
  var archived = c.archived === true || String(c.archived == null ? '' : c.archived).trim().toLowerCase() === 'true';
  return !archived && locationsClientCurrent_(c);
}

/** The house's current clients: its code on the client, else the registry street and unit exactly. */
function locationsClientsAt_(code, home, clients) {
  var homeAddr = home && home.address ? locationsAddr_(home.address) : null;
  return (clients || []).filter(function (c) {
    if (!locationsClientCurrent_(c)) return false;
    var hc = locationsHouseCode_(c.house);
    if (hc) return hc === code;
    if (!homeAddr || !homeAddr.key) return false;
    var a = locationsAddr_(c.home_address);
    return a.key === homeAddr.key && a.unit === homeAddr.unit;
  });
}

function locationsLocKey_(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A PSI place name that only ever carried one house code → that code (house_slices.psi_locations). */
function locationsPsiPlaces_(rows) {
  var seen = {};
  (rows || []).forEach(function (r) {
    var c = locationsCode_(r && r.house), w = locationsLocKey_(r && r.location_name);
    if (c && w) (seen[w] = seen[w] || {})[c] = true;
  });
  var out = {};
  Object.keys(seen).forEach(function (w) {
    var codes = Object.keys(seen[w]);
    if (codes.length === 1) out[w] = codes[0];
  });
  return out;
}

/** The ** rule per house code (hotlineManagersByHouse_): the latest anchor on or before today, and everyone current. */
function locationsManagers_(values, code, todayIso) {
  var by = {};
  try { by = hotlineManagersByHouse_(values || [], todayIso); } catch (e) { by = {}; }
  var best = null, current = [], seen = {};
  Object.keys(by).forEach(function (loc) {
    if (locationsCode_(loc) !== code) return;
    var a = by[loc].anchor;
    var rank = function (r) { return r && r.day && r.day <= todayIso ? r.day : ''; };
    if (a && (!best || rank(a) > rank(best))) best = a;
    (by[loc].current || []).forEach(function (r) {
      var k = clientNameKey_(r.name);
      if (k && !seen[k]) { seen[k] = true; current.push(r); }
    });
  });
  var shape = function (r) { return { name: String(r.name || ''), phone: String(r.phone || ''), day: String(r.day || '') }; };
  return { anchor: best ? shape(best) : null, current: current.map(shape) };
}

// Everyone on record at one house: Calendar Archive rows and PSI punches, folded by name, each first and latest day…
function locationsStaffMerge_(code, cal, psiRows, todayIso, hmKeys) {
  var people = {}, leads = {};
  var counts = { archive: 0, punches: 0 };
  var leadSince = locationsDayShift_(todayIso, -LOCATION_LEAD_DAYS);
  var note = function (name, day, source) {
    var k = clientNameKey_(name);
    if (!k) return;
    var p = people[k];
    if (!p) {
      p = people[k] = { name: name, name_day: day, first_day: day, first_source: source,
                        last_day: day, last_source: source, days: {}, sources: {} };
    }
    if (day < p.first_day || (day === p.first_day && source === 'punches')) {
      p.first_day = day; p.first_source = source;
    }
    if (day > p.last_day || (day === p.last_day && source === 'punches')) {
      p.last_day = day; p.last_source = source;
    }
    if (day >= p.name_day) { p.name = name; p.name_day = day; }
    p.days[day] = true;
    p.sources[source] = true;
    counts[source]++;
  };
  if (cal && cal.values) {
    var values = cal.values;
    var head = (values[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
    var col = function (name, fb) { var i = head.indexOf(name); return i === -1 ? fb : i; };
    var cLoc = col('location', 0), cName = col('employee', 1), cDes = col('designation', 2), cDate = col('date', 4);
    for (var r = 1; r < values.length; r++) {
      var line = values[r] || [];
      if (locationsCode_(line[cLoc]) !== code) continue;
      var day = commBroadcastDay_(line[cDate], cal.tz);
      if (!day || day > todayIso) continue;
      var name = locationsText_(line[cName]);
      if (!locationsIsPerson_(name)) continue;
      note(name, day, 'archive');
      if (String(line[cDes] || '').trim() === '***' && day >= leadSince) leads[clientNameKey_(name)] = true;
    }
  }
  if (psiRows) {
    var places = locationsPsiPlaces_(psiRows);
    psiRows.forEach(function (p) {
      var c = locationsCode_(p.house) || places[locationsLocKey_(p.location_name)] || '';
      if (c !== code) return;
      var day = commBroadcastDay_(p.date_iso, 'America/New_York') ||
                commBroadcastDay_(p.date_service, 'America/New_York');
      if (!day || day > todayIso) return;
      var who = locationsText_(p.employee) || locationsText_(String(p.firstname || '') + ' ' + String(p.lastname || ''));
      if (!locationsIsPerson_(who)) return;
      note(who, day, 'punches');
    });
  }
  var hm = hmKeys || {};
  var staff = Object.keys(people).map(function (k) {
    var p = people[k];
    return { key: k, name: p.name, first_day: p.first_day, first_source: p.first_source,
             last_day: p.last_day, last_source: p.last_source, shifts: Object.keys(p.days).length,
             sources: ['archive', 'punches'].filter(function (s) { return p.sources[s]; }),
             hm: !!hm[k], lead: !!leads[k] };
  });
  staff.sort(function (a, b) {
    if (a.last_day !== b.last_day) return a.last_day < b.last_day ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return { staff: staff, counts: counts };
}

/** The IST cell per staff key and client: rows at this house for its current clients. */
function locationsIstIndex_(istRows, code, clients) {
  var byName = {};
  (clients || []).forEach(function (c) { byName[clientNameKey_(c.name)] = c; });
  var out = {};
  (istRows || []).forEach(function (r) {
    if (locationsHouseCode_(r.house) !== code) return;
    var c = byName[clientNameKey_(r.clientName)];
    var sk = clientNameKey_(r.staffName);
    if (!c || !sk) return;
    var ck = String(c.client_key || clientNameKey_(c.name));
    (out[sk] = out[sk] || {});
    if (!out[sk][ck]) out[sk][ck] = r;
  });
  return out;
}

function locationsIstCell_(row, client) {
  var r = row || null;
  return {
    client: String(client.name || ''), client_key: String(client.client_key || ''),
    id: r ? locationsCell_(r.id) : '',
    status: r ? (locationsCell_(r.status).toLowerCase() || 'owed') : null,
    trainedAt: r ? locationsCell_(r.trainedAt) : '',
    docUrl: r ? locationsCell_(r.docUrl) : '', docFileId: r ? locationsCell_(r.docFileId) : '',
    docAt: r ? locationsCell_(r.docAt) : '', docBy: r ? locationsCell_(r.docBy) : ''
  };
}

function locationsStatusFold_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

function locationsWhen_(v) {
  var t = Date.parse(String(v || ''));
  return isNaN(t) ? 0 : t;
}

/** The house's repair requests: its own street, the unique street-number fallback, and every ALL row. */
function locationsRepairsFor_(rows, code, index) {
  var out = [];
  (rows || []).forEach(function (r) {
    var addr = locationsCell_(r.select_address_vehicle);
    var whole = /^all$/i.test(addr);
    var how = 'all';
    if (!whole) {
      var owner = locationsAddrOwner_(index, addr);
      if (owner.code !== code) return;
      how = owner.how;
    }
    var st = locationsStatusFold_(r.status);
    out.push({
      id: locationsCell_(r.id), timestamp: locationsCell_(r.timestamp),
      select_address_vehicle: addr, repair_type: locationsCell_(r.repair_type),
      urgency_level: locationsCell_(r.urgency_level),
      please_describe_the_issue: locationsCell_(r.please_describe_the_issue),
      status: locationsCell_(r.status), resolution_notes: locationsCell_(r.resolution_notes),
      whole_estate: whole, match: how,
      resolved: st === 'completed' || st === 'cancelled' || st === 'canceled'
    });
  });
  out.sort(function (a, b) { return locationsWhen_(b.timestamp) - locationsWhen_(a.timestamp); });
  return out;
}

/** incident_category holds several categories; only commas outside parentheses separate them. */
function locationsCategories_(v) {
  var clean = function (list) {
    return list.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(function (x) { return !!x; });
  };
  if (Array.isArray(v)) return clean(v);
  var s = String(v == null ? '' : v).trim();
  if (!s) return [];
  if (s.charAt(0) === '[') {
    try { var arr = JSON.parse(s); if (Array.isArray(arr)) return clean(arr); } catch (e) { /* text */ }
  }
  var out = [], depth = 0, cur = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return clean(out);
}

var LOCATION_INCIDENT_COLUMNS = ['timestamp', 'your_name', 'client_name', 'incident_category', 'incident_location',
  'incident_date', 'incident_time', 'incident_reported_date', 'incident_reported_time', 'employees_involved',
  'summary_of_incident', 'immediate_action_taken', 'cause_and_contributing_factors', 'prevention_plan'];

/** The incidents of the house's current clients, joined by clientNameKey_. */
function locationsIncidentsFor_(rows, clients) {
  var byKey = {};
  (clients || []).forEach(function (c) { byKey[clientNameKey_(c.name)] = c; });
  var out = [];
  (rows || []).forEach(function (r) {
    var c = byKey[clientNameKey_(r.client_name)];
    if (!c) return;
    var full = { id: locationsCell_(r.id) };
    LOCATION_INCIDENT_COLUMNS.forEach(function (k) { full[k] = locationsCell_(r[k]); });
    out.push({
      id: full.id, your_name: full.your_name, client_name: full.client_name,
      client_key: String(c.client_key || ''), incident_category: full.incident_category,
      categories: locationsCategories_(r.incident_category), incident_location: full.incident_location,
      incident_date: full.incident_date, incident_time: full.incident_time, row: full
    });
  });
  out.sort(function (a, b) {
    return (locationsWhen_(b.incident_date) - locationsWhen_(a.incident_date)) ||
           (locationsWhen_(b.row.timestamp) - locationsWhen_(a.row.timestamp));
  });
  return out;
}

// One consumable's figures.
function locationsSupplyItem_(entries, orderDays) {
  var list = (entries || []).slice().sort(function (a, b) { return String(a.at) < String(b.at) ? -1 : (String(a.at) > String(b.at) ? 1 : 0); });
  var last = function (pred) { for (var i = list.length - 1; i >= 0; i--) if (pred(list[i])) return list[i]; return null; };
  var par = last(function (e) { return e.kind === 'par'; });
  var d = last(function (e) { return e.kind === 'delivery'; });
  var latestCount = last(function (e) { return e.kind === 'count'; });
  var out = { in_stock: null, par: par ? par.qty : null, status: null, checked: '', consumption: null,
              rate_per_day: null, days_of_cover: null, last_delivery: null, measured: false };
  var current = null, checked = '';
  if (d) {
    out.last_delivery = { at: d.at, qty: d.qty, on_hand_after: d.on_hand_after };
    var base = d.on_hand_after;
    if (base === null || base === undefined) {
      var before = last(function (e) { return e.kind === 'count' && String(e.at) <= String(d.at); });
      base = before ? before.qty + d.qty : null;
    }
    var c = last(function (e) { return e.kind === 'count' && String(e.at) > String(d.at); });
    if (c) { current = c.qty; checked = c.at; }
    else if (base !== null) { current = base; checked = d.at; }
    if (c && base !== null) {
      out.consumption = base - c.qty;
      out.measured = true;
      var days = (locationsWhen_(c.at) - locationsWhen_(d.at)) / 86400000;
      if (days > 0) {
        var rate = out.consumption / days;
        out.rate_per_day = Math.round(rate * 100) / 100;
        if (rate > 0) out.days_of_cover = Math.round((c.qty / rate) * 10) / 10;
      }
    }
  } else if (latestCount) {
    current = latestCount.qty;
    checked = latestCount.at;
  }
  out.in_stock = current;
  out.checked = checked;
  if (current !== null) {
    var limit = Number(orderDays || LOCATION_SUPPLY_ORDER_DAYS);
    if (current <= 0 || (out.days_of_cover !== null && out.days_of_cover < limit)) out.status = 'order_now';
    else if (out.par !== null && current < out.par) out.status = 'low';
    else out.status = 'in_stock';
  }
  return out;
}

/** Ledger rows of one house → one line per item (folded name), newest category kept. */
function locationsSupplies_(rows, code, orderDays) {
  var items = {};
  (rows || []).forEach(function (r) {
    if (locationsHouseCode_(r.house) !== code) return;
    var kind = String(r.kind || '').trim().toLowerCase();
    if (LOCATION_SUPPLY_KINDS.indexOf(kind) === -1) return;
    var qty = locationsNum_(r.qty);
    var k = clientNameKey_(r.item);
    if (!k || qty === null) return;
    var at = locationsCell_(r.at);
    var it = items[k] = items[k] || { item: locationsText_(r.item), category: '', category_at: '', entries: [] };
    if (String(r.category || '').trim() && at >= it.category_at) { it.category = locationsText_(r.category); it.category_at = at; }
    it.entries.push({ id: locationsCell_(r.id), kind: kind, qty: qty, on_hand_after: locationsNum_(r.on_hand_after), at: at,
                      by: locationsText_(r.by), category: locationsText_(r.category), note: locationsText_(r.note) });
  });
  return Object.keys(items).map(function (k) {
    var it = items[k];
    var fig = locationsSupplyItem_(it.entries, orderDays);
    fig.item = it.item;
    fig.category = it.category;
    fig.entries = it.entries.slice().sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
    return fig;
  }).sort(function (a, b) { return a.item.localeCompare(b.item); });
}

// ---- the stores ----------------------------------------------------------

function locationsBookId_(prop, fallback) {
  var id = '';
  try { id = String(hubProp_(prop) || '').trim(); } catch (e) { id = ''; }
  return id || fallback;
}

/** A tab as objects keyed by its own header; Dates as ISO text. */
function locationsTabRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var head = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 }, empty = true;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      var v = locationsCell_(values[r][c]);
      if (v) empty = false;
      o[head[c]] = v;
    }
    if (!empty) rows.push(o);
  }
  return rows;
}

function locationsHomesScope_() {
  return cacheScopeSheet_(locationsBookId_(LOCATION_ENTITIES_PROP, LOCATION_ENTITIES_FALLBACK), LOCATION_HOMES_TAB);
}

/** A registry row's code: its abbreviation, else the code its name ends in. */
function locationsHomeCode_(abbreviation, homeName) {
  return locationsHouseCode_(abbreviation) || locationsCode_(homeName);
}

/** The house registry (entity_homes), one row per code; `edit` is each column as the house door witnesses it. */
function locationsHomes_() {
  var id = locationsBookId_(LOCATION_ENTITIES_PROP, LOCATION_ENTITIES_FALLBACK);
  return cacheRead_(locationsHomesScope_(), 'loc_homes_e', function () {
    var sheet = ssOpen_(id).getSheetByName(LOCATION_HOMES_TAB);
    if (!sheet) throw new Error('the registry has no ' + LOCATION_HOMES_TAB + ' tab');
    return locationsTabRows_(sheet).map(function (r) {
      var edit = {};
      LOCATION_HOUSE_FIELDS.concat(['abbreviation', 'thumbnail_url']).forEach(function (f) { edit[f] = locationsText_(r[f]); });
      return {
        code: locationsHomeCode_(r.abbreviation, r.home_name),
        home_name: locationsText_(r.home_name), address: locationsText_(r.address),
        region: locationsText_(r.region), telephone: locationsText_(r.telephone),
        manager_name: locationsText_(r.manager_name), manager_phone: locationsText_(r.manager_phone),
        calendar_link: locationsFirstUrl_(r.calendar_link), thumbnail_url: locationsFirstUrl_(r.thumbnail_url),
        edit: edit
      };
    }).filter(function (h) { return !!h.code; });
  });
}

/** The company policies (Common Data › Company Policies). Throws when the book cannot be read. */
function locationsPolicies_() {
  var id = locationsBookId_(LOCATION_COMMON_PROP, LOCATION_COMMON_FALLBACK);
  return cacheRead_(cacheScopeSheet_(id, LOCATION_POLICIES_TAB), 'loc_policies', function () {
    var sheet = ssOpen_(id).getSheetByName(LOCATION_POLICIES_TAB);
    if (!sheet) throw new Error('the common data book has no ' + LOCATION_POLICIES_TAB + ' tab');
    var out = [];
    locationsTabRows_(sheet).forEach(function (r) {
      var title = locationsText_(r.Title), url = locationsFirstUrl_(r.Link);
      if (title && url) out.push({ title: title, url: url, drive_id: locationsDriveId_(url) });
    });
    return out;
  });
}

/** clientsDerived_ narrowed to identity: never a clinical field. A row with no client_key keys by its folded name, as clientsDerived_ does. */
function locationsClientRows_() {
  return clientsDerived_(null).map(function (c) {
    return { client_key: String(c.client_key || '').trim() || clientNameKey_(c.name), name: locationsText_(c.name),
             house: locationsText_(c.house), home_address: locationsText_(c.home_address),
             status: locationsText_(c.status), isp_year: locationsText_(c.isp_year) };
  });
}

/** The house a request names: 400 for a malformed code, 404 for one neither the registry nor a client carries. */
function locationsHouse_(raw) {
  var code = locationsHouseCode_(raw);
  if (!code) return { refused: { status: 400, message: 'house: a house code, such as ABD1305.' } };
  var homes = null, homesWhy = '';
  try { homes = locationsHomes_(); } catch (eH) {
    homesWhy = 'the house registry could not be read (' + String((eH && eH.message) || eH).slice(0, 120) + ')';
  }
  var clients = [], clientsWhy = '';
  try { clients = locationsClientRows_(); } catch (eC) {
    clientsWhy = 'the clients could not be read (' + String((eC && eC.message) || eC).slice(0, 120) + ')';
  }
  var home = null;
  (homes || []).forEach(function (h) { if (!home && h.code === code) home = h; });
  var carried = clients.some(function (c) { return locationsHouseCode_(c.house) === code; });
  if (!home && !carried) {
    if (homes === null) return { refused: { status: 503, message: homesWhy + (clientsWhy ? '; ' + clientsWhy : '') + '.' } };
    return { refused: { status: 404, message: 'No house "' + code + '" is on the registry or on a client.' } };
  }
  return { code: code, home: home, homes: homes || [], homes_why: homesWhy, all_clients: clients,
           clients_why: clientsWhy, clients: locationsClientsAt_(code, home, clients) };
}

function locationsClientList_(ctx) {
  return ctx.clients.map(function (c) { return { client_key: c.client_key, name: c.name }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** Keyed loc_<action>_<code>; the name carries the versions of the tabs it reads, so their writes retire it. A degraded answer is never kept. */
function locationsCached_(action, code, depScopes, producer) {
  var scope = 'loc_' + action + '_' + code;
  var name = 'v1';
  (depScopes || []).forEach(function (s) {
    try { name += '_' + cacheVersion_(s); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

function locationsBump_(action, code) {
  cacheBump_('loc_' + action + '_' + code);
}

function locationsEstateScope_(resource) {
  var src = estateSource_(resource);
  return src ? cacheScopeSheet_(src.id, src.tab) : '';
}

function locationsIstRows_() {
  return listRows_('istRecords', {});
}

function locationsNotesSheet_(create) {
  return create ? hubTabEnsure_(LOCATION_NOTES_TAB, LOCATION_NOTES_HEADER) : hubTabSheet_(LOCATION_NOTES_TAB);
}

// Only the declared house; never a tab in HUB_DB.
function locationsSupplySheet_(write) {
  if (!houseMoved_(LOCATION_SUPPLY_TAB)) return null;
  return write ? hubTabEnsure_(LOCATION_SUPPLY_TAB, LOCATION_SUPPLY_HEADER) : hubTabSheet_(LOCATION_SUPPLY_TAB);
}

function locationsPackMemo_(name, read) {
  var memo = LOCATION_PACK_MEMO_;
  if (memo && memo.hasOwnProperty(name)) return memo[name];
  var got = read();
  if (memo) memo[name] = got;
  return got;
}

function locationsCalendar_() {
  return locationsPackMemo_('calendar', function () {
    try { return { cal: commBroadcastCalendarRows_(), why: '' }; }
    catch (e) { return { cal: null, why: 'the Calendar Archive could not be read (' + String((e && e.message) || e).slice(0, 120) + ')' }; }
  });
}

function locationsPunches_() {
  return locationsPackMemo_('punches', function () {
    try {
      var sheet = psiPunchesFullSheet_();
      if (!sheet) return { rows: null, why: 'the PSI punch house is not declared' };
      return { rows: psiPunchesRows_(sheet).rows, why: '' };
    } catch (e) {
      return { rows: null, why: 'the PSI punches could not be read (' + String((e && e.message) || e).slice(0, 120) + ')' };
    }
  });
}

/** The house's folder in the houses document room: the first subfolder (three levels down at most) naming the code. */
function locationsGuidebook_(code) {
  var found = docRoomFolder_('houses');
  if (!found.folder) return { guidebook: null, why: found.reason };
  var re = new RegExp('(^|[^A-Z0-9])' + code + '(?![0-9])');
  var queue = [{ f: found.folder, depth: 0 }], hit = null, looked = 0;
  while (queue.length && !hit && looked < 400) {
    var cur = queue.shift();
    var kids = cur.f.getFolders();
    while (kids.hasNext() && looked < 400) {
      var k = kids.next();
      looked++;
      if (re.test(String(k.getName()).toUpperCase())) { hit = k; break; }
      if (cur.depth < 2) queue.push({ f: k, depth: cur.depth + 1 });
    }
  }
  if (!hit) return { guidebook: null, why: 'no folder in the houses room names ' + code };
  var files = [];
  var take = function (it) {
    while (it.hasNext() && files.length < 100) {
      var f = it.next();
      var name = String(f.getName());
      files.push({ id: f.getId(), name: name, mime: String(f.getMimeType()),
                   modified_time: f.getLastUpdated().toISOString(), url: f.getUrl(), guide: /guide/i.test(name) });
    }
  };
  take(hit.getFiles());
  var subs = hit.getFolders();
  while (subs.hasNext() && files.length < 100) take(subs.next().getFiles());
  files.sort(function (a, b) { return (b.guide - a.guide) || a.name.localeCompare(b.name); });
  return { guidebook: { folder_id: hit.getId(), folder_name: String(hit.getName()), files: files }, why: '' };
}

// ---- reads ---------------------------------------------------------------

// Who is reading and how far: the scope's kind, whether the writes are theirs, the editions they make (Editions.gs…
HUB_POLICY.locationScope = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: {}
};
HUB_ACTIONS.locationScope = function (payload, user) {
  var scope = locationsViewer_(user);
  if (!scope) return locationsUnknown_();
  var cut = locationsCut_(scope);
  var data = { kind: scope.kind, writes: locationsGate_(user), editions: cut ? [] : locationsEditions_(user), cut: cut,
               houses: null, why: '' };
  if (!locationsNarrowed_(scope)) return { status: 200, data: data };
  var homes = [], clients = [], why = scope.why ? [scope.why] : [];
  try { homes = locationsHomes_() || []; } catch (eH) {
    why.push('The house registry could not be read (' + String((eH && eH.message) || eH).slice(0, 120) + ').');
  }
  try { clients = locationsClientRows_() || []; } catch (eC) {
    why.push('The clients could not be read (' + String((eC && eC.message) || eC).slice(0, 120) + ').');
  }
  data.houses = (scope.house_codes || []).map(function (code) {
    return locationsScopeHouse_(code, homes, clients, scope);
  });
  data.why = why.join(' ');
  return { status: 200, data: data };
};

/** One house as the switcher lists it to a viewer held to houses: the registry's row and its own clients there. */
function locationsScopeHouse_(code, homes, clients, scope) {
  var home = null;
  (homes || []).forEach(function (h) { if (!home && h.code === code) home = h; });
  var at = locationsClientsAt_(code, home, clients);
  var shown = locationsMine_(at, scope);
  var h = home || {};
  return { code: code, home_name: h.home_name || '', address: h.address || '', region: h.region || '',
           thumbnail_url: h.thumbnail_url || '', on_registry: !!home, client_count: at.length,
           clients: shown.map(function (c) { return { client_key: c.client_key, name: c.name }; })
                        .sort(function (a, b) { return a.name.localeCompare(b.name); }) };
}

/** Overview: the registry row (house phone, calendar link) and the ** rule's house manager with the calendar row's phone. */
HUB_POLICY.locationOverview = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.locationOverview = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  return { status: 200, data: locationsOverviewCut_(locationsOverviewPart_(door.ctx), door.scope) };
};

/** A narrowed viewer sees only their own clients among the house's. */
function locationsOverviewCut_(data, scope) {
  if (!locationsNarrowed_(scope)) return data;
  var out = locationsCopy_(data);
  out.clients = locationsMine_(data.clients, scope);
  return out;
}

function locationsOverviewPart_(ctx) {
  return locationsCached_('locationOverview', ctx.code, [locationsHomesScope_()], function () {
    var today = locationsToday_();
    var got = locationsCalendar_();
    var mg = got.cal ? locationsManagers_(got.cal.values, ctx.code, today) : { anchor: null, current: [] };
    var h = ctx.home || {};
    return {
      house: { code: ctx.code, home_name: h.home_name || '', address: h.address || '', region: h.region || '',
               phone: h.telephone || '', calendar_link: h.calendar_link || '', thumbnail_url: h.thumbnail_url || '',
               type: null, on_registry: !!ctx.home },
      edit: ctx.home ? (ctx.home.edit || null) : null,
      registry_why: ctx.home ? '' : (ctx.homes_why || 'the registry has no row for ' + ctx.code),
      manager: mg.anchor, managers: mg.current,
      manager_why: mg.anchor ? '' : (got.why || 'the Calendar Archive has no ** row for ' + ctx.code),
      registry_manager: { name: h.manager_name || '', phone: h.manager_phone || '' },
      clients: locationsClientList_(ctx),
      degraded: !got.cal || !!ctx.homes_why
    };
  });
}

/** Staff: everyone on record at the house — Calendar Archive and PSI punches, every date with its source — and an IST cell per current client. */
HUB_POLICY.locationStaff = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.locationStaff = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  return { status: 200, data: locationsStaffCut_(locationsStaffPart_(door.ctx), door.scope, door.ctx.code) };
};

// A narrowed viewer: the IST cells for its own clients alone.
function locationsStaffCut_(data, scope, code) {
  if (!locationsNarrowed_(scope)) return data;
  var cut = locationsCut_(scope);
  var seen = { keys: [], why: '' };
  if (cut) {
    try { seen = hubStaffVisibleForHouses_([code]); } catch (e) {
      seen = { keys: [], why: 'Who worked here could not be read (' + String((e && e.message) || e).slice(0, 120) + ').' };
    }
  }
  var shown = {}, mine = {};
  (seen.keys || []).forEach(function (k) { shown[k] = true; });
  (scope.client_keys || []).forEach(function (k) { mine[k] = true; });
  var out = locationsCopy_(data);
  out.clients = locationsMine_(data.clients, scope);
  out.removed = [];
  out.staff = (data.staff || []).filter(function (p) { return !cut || shown[p.key]; }).map(function (p) {
    var q = locationsCopy_(p);
    q.ist = (p.ist || []).filter(function (c) { return mine[c.client_key]; }).map(function (c) {
      if (!cut) return c;
      var x = locationsCopy_(c);
      x.docUrl = ''; x.docFileId = ''; x.docAt = ''; x.docBy = '';
      return x;
    });
    return q;
  });
  if (!cut) return out;
  out.visible_why = seen.why || '';
  if (seen.why) out.degraded = true;
  return out;
}

function locationsStaffPart_(ctx) {
  return locationsCached_('locationStaff', ctx.code, [cacheScope_('ist_records')], function () {
    var today = locationsToday_();
    var got = locationsCalendar_();
    var psi = locationsPunches_();
    var mg = got.cal ? locationsManagers_(got.cal.values, ctx.code, today) : { anchor: null, current: [] };
    var hmKeys = {};
    mg.current.forEach(function (r) { hmKeys[clientNameKey_(r.name)] = true; });
    if (mg.anchor) hmKeys[clientNameKey_(mg.anchor.name)] = true;
    var merged = locationsStaffMerge_(ctx.code, got.cal, psi.rows, today, hmKeys);
    var clients = locationsClientList_(ctx);
    var ist = {}, istWhy = '';
    try { ist = locationsIstIndex_(locationsIstRows_(), ctx.code, clients); }
    catch (eI) { istWhy = 'the IST records could not be read (' + String((eI && eI.message) || eI).slice(0, 120) + ')'; }
    // the people taken off this house: off the list, never off the record; unreadable, everybody stays listed
    var off = {}, offWhy = '';
    try { off = locationsStaffOff_(ctx.code); }
    catch (eO) { offWhy = 'who was taken off this house could not be read (' + String((eO && eO.message) || eO).slice(0, 120) + ')'; }
    var removed = [];
    merged.staff = merged.staff.filter(function (p) {
      if (!off[p.key]) return true;
      removed.push({ key: p.key, name: p.name, by: off[p.key].by, at: off[p.key].at });
      return false;
    });
    merged.staff.forEach(function (p) {
      var mine = ist[p.key] || {};
      p.ist = clients.map(function (c) { return locationsIstCell_(mine[String(c.client_key || clientNameKey_(c.name))], c); });
    });
    return {
      house: ctx.code, clients: clients, staff: merged.staff, ist_why: istWhy, removed: removed, removed_why: offWhy,
      sources: { archive: { readable: !!got.cal, why: got.why, rows: merged.counts.archive },
                 punches: { readable: !!psi.rows, why: psi.why, rows: merged.counts.punches } },
      degraded: !got.cal || !psi.rows || !!istWhy || !!offWhy
    };
  });
}

// The people taken off this house's Staff list: { staff key: the row that took them off }, the last row for a…
function locationsStaffOff_(code) {
  var sheet = hubTabSheet_(LOCATION_STAFF_OFF_TAB);
  if (!sheet) return {};
  var out = {};
  locationsTabRows_(sheet).forEach(function (r) {
    if (locationsHouseCode_(r.house) !== code) return;
    var k = clientNameKey_(r.staff_key || r.name);
    if (!k) return;
    if (String(r.state || '').trim().toLowerCase() === 'off') out[k] = { name: r.name || '', by: r.by || '', at: r.at || '' };
    else delete out[k];
  });
  return out;
}

/** House Repairs: the house's requests; resolved (Completed or Cancelled) ones only when asked. ALL rows ride in every house. */
HUB_POLICY.locationRepairs = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, resolved: {} }
};
HUB_ACTIONS.locationRepairs = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var all;
  try {
    all = locationsRepairsPart_(ctx);
  } catch (e) {
    return { status: 503, message: 'The repair requests could not be read just now (' +
             String((e && e.message) || e).slice(0, 120) + ').' };
  }
  var raw = payload && payload.resolved;
  var withResolved = raw === true || /^(true|1|yes|on)$/i.test(String(raw == null ? '' : raw));
  var rows = all.rows.filter(function (r) { return withResolved || !r.resolved; });
  var open = all.rows.filter(function (r) { return !r.resolved; }).length;
  return { status: 200, data: { house: ctx.code, resolved: withResolved, rows: rows,
                                open_count: open, resolved_count: all.rows.length - open } };
};

/** Every repair request of the house, resolved ones too: { rows }. Throws when the requests cannot be read. */
function locationsRepairsPart_(ctx) {
  return locationsCached_('locationRepairs', ctx.code, [locationsEstateScope_('workOrders'), locationsHomesScope_()], function () {
    var index = locationsAddrIndex_(ctx.homes, ctx.all_clients);
    return { rows: locationsRepairsFor_(estateRows_('workOrders'), ctx.code, index) };
  });
}

/** Incidents: every UI/MUI of the house's current clients — the six list columns and the whole row for the panel. */
HUB_POLICY.locationIncidents = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.locationIncidents = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  var data;
  try {
    data = locationsIncidentsPart_(door.ctx);
  } catch (e) {
    return { status: 503, message: 'The incidents could not be read just now (' +
             String((e && e.message) || e).slice(0, 120) + ').' };
  }
  return { status: 200, data: locationsIncidentsCut_(data, door.scope) };
};

/** Every incident of the house's current clients, uncut. Throws when the incidents cannot be read. */
function locationsIncidentsPart_(ctx) {
  return locationsCached_('locationIncidents', ctx.code, [locationsEstateScope_('uiIncidents')], function () {
    var clients = locationsClientList_(ctx);
    var rows = locationsIncidentsFor_(estateRows_('uiIncidents'), clients);
    var cats = {};
    rows.forEach(function (r) { r.categories.forEach(function (c) { cats[c] = true; }); });
    return { house: ctx.code, clients: clients, categories: Object.keys(cats).sort(), rows: rows };
  });
}

/** A narrowed viewer sees their own clients' incidents alone, and only those clients' categories. */
function locationsIncidentsCut_(data, scope) {
  if (!locationsNarrowed_(scope)) return data;
  var out = locationsCopy_(data);
  out.clients = locationsMine_(data.clients, scope);
  out.rows = locationsMine_(data.rows, scope);
  var cats = {};
  out.rows.forEach(function (r) { (r.categories || []).forEach(function (c) { cats[c] = true; }); });
  out.categories = Object.keys(cats).sort();
  return out;
}

/** Documents: each current client's ISP, the house guidebook folder, and the company policies. */
HUB_POLICY.locationDocuments = {
  file: 'Locations.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.locationDocuments = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  return { status: 200, data: locationsDocumentsCut_(locationsDocumentsPart_(door.ctx), door.scope) };
};

function locationsDocumentsPart_(ctx) {
  return locationsCached_('locationDocuments', ctx.code, [], function () { return locationsDocumentsBuild_(ctx); });
}

// A narrowed viewer: their own clients' ISPs.
function locationsDocumentsCut_(data, scope) {
  if (!locationsNarrowed_(scope)) return data;
  var out = locationsCopy_(data);
  out.isps = locationsMine_(data.isps, scope);
  if (!locationsCut_(scope)) return out;
  out.policies = (data.policies || []).filter(function (p) {
    return LOCATION_CLIENT_POLICIES.indexOf(clientNameKey_(p.title)) !== -1;
  });
  out.guidebook = null;
  out.guidebook_why = '';
  out.guidebook_withheld = true;
  return out;
}

/** The pack's guidebook: the Documents answer's own folder walk; the ISPs and policies are the slices'. */
function locationsGuidebookPart_(ctx) {
  var docs = locationsDocumentsPart_(ctx);
  return { house: ctx.code, guidebook: docs.guidebook, guidebook_why: docs.guidebook_why,
           degraded: !!docs.degraded };
}

function locationsDocumentsBuild_(ctx) {
  var isps = ctx.clients.map(function (c) {
    var doc = { id: '', name: '', url: '' };
    try { doc = ispDocFor_(c.name); } catch (e) { doc = { id: '', name: '', url: '' }; }
    return { client: c.name, client_key: c.client_key, isp_doc_url: doc.url || '', isp_doc_name: doc.name || '',
             isp_doc_id: doc.id || '', isp_year: c.isp_year || '' };
  }).sort(function (a, b) { return a.client.localeCompare(b.client); });
  var guide = { guidebook: null, why: '' };
  try { guide = locationsGuidebook_(ctx.code); }
  catch (eG) { guide = { guidebook: null, why: 'the houses room could not be read (' + String((eG && eG.message) || eG).slice(0, 120) + ')', failed: true }; }
  var policies = [], policiesWhy = '';
  try { policies = locationsPolicies_(); }
  catch (eP) { policiesWhy = 'the company policies could not be read (' + String((eP && eP.message) || eP).slice(0, 120) + ')'; }
  return { house: ctx.code, isps: isps, guidebook: guide.guidebook, guidebook_why: guide.why,
           policies: policies, policies_why: policiesWhy, degraded: !!guide.failed || !!policiesWhy };
}

/** House Supplies: the house's assets (houseInventory) and the consumables ledger with consumption since the last delivery. */
HUB_POLICY.locationSupplies = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.locationSupplies = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  return { status: 200, data: locationsSuppliesCut_(locationsSuppliesPart_(door.ctx), door.scope) };
};

/** A narrowed viewer sees the figures, never the ledger's lines (who recorded them, their notes). */
function locationsSuppliesCut_(data, scope) {
  if (!locationsNarrowed_(scope)) return data;
  var out = locationsCopy_(data);
  out.consumables = (data.consumables || []).map(function (c) {
    var x = locationsCopy_(c);
    x.entries = [];
    return x;
  });
  return out;
}

function locationsSuppliesPart_(ctx) {
  return locationsCached_('locationSupplies', ctx.code, [locationsEstateScope_('houseInventory'), locationsHomesScope_()],
                          function () {
    var index = locationsAddrIndex_(ctx.homes, ctx.all_clients);
    var assets = [], assetsWhy = '';
    try {
      estateRows_('houseInventory').forEach(function (r) {
        if (locationsAddrOwner_(index, r.address).code !== ctx.code) return;
        assets.push({ id: locationsCell_(r.id), item: locationsCell_(r.item), address: locationsCell_(r.address),
                      cost_to_replace: locationsCell_(r.cost_to_replace),
                      current_condition: locationsCell_(r.current_condition),
                      est_expiration_year: locationsCell_(r.est_expiration_year),
                      replacement_frequency: locationsCell_(r.replacement_frequency) });
      });
    } catch (eA) { assetsWhy = 'the House Inventory List could not be read (' + String((eA && eA.message) || eA).slice(0, 120) + ')'; }
    var consumables = [], ledgerWhy = '', ready = false;
    try {
      var sheet = locationsSupplySheet_(false);
      if (!sheet) ledgerWhy = 'the ' + LOCATION_SUPPLY_TAB + ' house is not declared';
      else {
        ready = true;
        consumables = locationsSupplies_(locationsTabRows_(sheet), ctx.code, LOCATION_SUPPLY_ORDER_DAYS);
      }
    } catch (eL) { ledgerWhy = 'the supplies ledger could not be read (' + String((eL && eL.message) || eL).slice(0, 120) + ')'; }
    return { house: ctx.code, assets: assets, assets_why: assetsWhy, ledger_ready: ready, ledger_why: ledgerWhy,
             consumables: consumables, order_days: LOCATION_SUPPLY_ORDER_DAYS,
             degraded: !!assetsWhy || (!!ledgerWhy && ready) };
  });
}

/** House Notes: every note filed for the house, newest first; nothing is ever deleted. Never a client's or family's. */
HUB_POLICY.locationNotes = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.locationNotes = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  if (locationsCut_(door.scope)) return locationsUnknown_();
  var ctx = door.ctx;
  var data;
  try { data = locationsNotesPart_(ctx); }
  catch (e) {
    return { status: 503, message: 'The house notes could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  return { status: 200, data: locationsNotesCut_(data, door.scope) };
};

/** A narrowed viewer: the house's own notes and the ones about its clients, never another client's. */
function locationsNotesCut_(data, scope) {
  if (!locationsNarrowed_(scope)) return data;
  var keys = (scope && scope.client_keys) || [];
  var out = locationsCopy_(data);
  out.notes = (data.notes || []).filter(function (n) {
    var k = String((n && n.client_key) || '');
    return !k || keys.indexOf(k) !== -1;
  });
  out.open_count = out.notes.filter(function (n) { return n.state === 'open'; }).length;
  return out;
}

/** Throws when the notes tab cannot be read. */
function locationsNotesPart_(ctx) {
  return locationsCached_('locationNotes', ctx.code, [], function () {
    var sheet = locationsNotesSheet_(false);
    var names = {};
    ctx.all_clients.forEach(function (c) { if (c.client_key) names[c.client_key] = c.name; });
    var notes = sheet ? locationsTabRows_(sheet).filter(function (r) {
      return locationsHouseCode_(r.house) === ctx.code && String(r.state || '').toLowerCase() !== 'removed';
    }).map(function (r) {
      return { id: r.id || '', house: ctx.code, client_key: r.client_key || '', client_name: names[r.client_key] || '',
               priority: r.priority || 'normal', details: r.details || '', state: r.state || 'open',
               by: r.by || '', at: r.at || '', state_by: r.state_by || '', state_at: r.state_at || '' };
    }) : [];
    notes.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
    return { house: ctx.code, exists: !!sheet, notes: notes, open_count: notes.filter(function (n) { return n.state === 'open'; }).length };
  });
}

// The relay's pack: every part of one house no slice may carry — overview, staff with IST, notes, supplies, the…
HUB_POLICY.locationPack = {
  file: 'Locations.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' } }
};
HUB_ACTIONS.locationPack = function (payload, user) {
  if (!user || !user.is_service) return locationsUnknown_();
  var ctx = locationsHouse_(payload && payload.house);
  if (ctx.refused) return ctx.refused;
  var build = { overview: locationsOverviewPart_, staff: locationsStaffPart_, notes: locationsNotesPart_,
                supplies: locationsSuppliesPart_, guidebook: locationsGuidebookPart_, repairs: locationsRepairsPart_,
                incidents: locationsIncidentsPart_, client_views: locationsClientViews_ };
  var parts = {}, status = {};
  var held = LOCATION_PACK_MEMO_;
  LOCATION_PACK_MEMO_ = {};
  try {
    LOCATION_PACK_PARTS.forEach(function (name) {
      try {
        parts[name] = build[name](ctx, parts);
        status[name] = { status: 200 };
      } catch (e) {
        status[name] = { status: 503, message: 'This part could not be read just now (' +
                         String((e && e.message) || e).slice(0, 120) + ').' };
      }
    });
  } finally { LOCATION_PACK_MEMO_ = held; }
  return { status: 200, data: { house: ctx.code, built_at: new Date().toISOString(), parts: parts,
                                part_status: status } };
};

// The house parts a client's own view is cut from.
var LOCATION_VIEW_SOURCES = ['overview', 'staff', 'incidents'];

// { <client key>: view } for each current client of the house whose own scope is this house alone: its scope…
function locationsClientViews_(ctx, parts) {
  var missing = LOCATION_VIEW_SOURCES.filter(function (n) { return !parts || !parts[n]; });
  if (missing.length) throw new Error('not cut: ' + missing.join(', ') + ' did not answer');
  if (ctx.homes_why || ctx.clients_why) throw new Error('not cut: ' + (ctx.homes_why || ctx.clients_why));
  var docs = locationsDocumentsPart_(ctx);
  var out = {};
  ctx.clients.forEach(function (c) {
    var key = String(c.client_key || '');
    if (!key || out[key]) return;
    if (hubViewerHousesFrom_([key], ctx.all_clients, ctx.homes).join() !== ctx.code) return;
    var scope = { kind: 'client', client_keys: [key], house_codes: [ctx.code], ssa_keys: [], family_keys: [], why: '' };
    out[key] = {
      scope: { kind: 'client', writes: false, editions: [], cut: true,
               houses: [locationsScopeHouse_(ctx.code, ctx.homes, ctx.all_clients, scope)], why: '' },
      overview: locationsOverviewCut_(parts.overview, scope),
      staff: locationsStaffCut_(parts.staff, scope, ctx.code),
      incidents: locationsIncidentsCut_(parts.incidents, scope),
      documents: locationsDocumentsCut_(docs, scope)
    };
  });
  return out;
}

// One document of the house, as bytes for the platform's own viewer: a PDF or a picture as itself, a Google or…
HUB_POLICY.locationDocFile = {
  file: 'Locations.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, id: { type: 'string' } }
};
HUB_ACTIONS.locationDocFile = function (payload, user) {
  var door = locationsReadDoor_(payload, user);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var id = locationsText_(payload && payload.id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'id: a Drive file id.' };
  if (!locationsDocKnown_(ctx, id, door.scope)) return { status: 404, message: 'This house names no such document.' };
  var got;
  try { got = locationsDocBytes_(id); }
  catch (e) {
    var gone = /not found|no item|does not exist|trashed/i.test(String((e && e.message) || e));
    return gone ? { status: 404, message: 'The file is no longer in the drive.' }
                : { status: 503, message: 'The document could not be opened just now — try again in a minute.' };
  }
  if (got.refused) return got.refused;
  return { status: 200, data: { id: id, name: got.name, mime: got.mime, size: got.size, exported: got.exported, b64: got.b64 } };
};

// A file the viewer's own Documents answer names, or (not for a client or a family member) an IST paper at the…
function locationsDocKnown_(ctx, id, scope) {
  var docs = locationsDocumentsCut_(locationsDocumentsPart_(ctx), scope);
  if (docs.isps.some(function (d) { return d.isp_doc_id === id; })) return true;
  if (docs.guidebook && docs.guidebook.files.some(function (f) { return f.id === id; })) return true;
  if (docs.policies.some(function (p) { return p.drive_id === id; })) return true;
  if (locationsCut_(scope)) return false;
  var mine = null;
  if (locationsNarrowed_(scope)) {
    mine = {};
    locationsMine_(ctx.clients, scope).forEach(function (c) { mine[clientNameKey_(c.name)] = true; });
  }
  try {
    return locationsIstRows_().some(function (r) {
      return locationsHouseCode_(r.house) === ctx.code && locationsCell_(r.docFileId) === id &&
             (!mine || !!mine[clientNameKey_(r.clientName)]);
    });
  } catch (e) { return false; }
}

function locationsDocBytes_(id) {
  var file = DriveApp.getFileById(id);
  if (file.isTrashed()) return { refused: { status: 404, message: 'The file is in the trash.' } };
  var name = String(file.getName());
  var mime = String(file.getMimeType());
  var blob = null, exported = false;
  if (mime.indexOf('application/vnd.google-apps.') === 0) {
    blob = file.getAs('application/pdf');
    exported = true;
  } else if (LOCATION_OFFICE_TO_GOOGLE[mime]) {
    blob = locationsOfficePdf_(id, LOCATION_OFFICE_TO_GOOGLE[mime]);
    if (!blob) return { refused: { status: 415, message: 'This document could not be turned into a PDF here.' } };
    exported = true;
  } else {
    var shown = complianceDocsShownType_(mime, name);
    if (!shown) return { refused: { status: 415, message: 'Only PDFs, pictures and documents are shown here.' } };
    if (Number(file.getSize()) > LOCATION_DOC_MAX_BYTES) {
      return { refused: { status: 400, message: 'This file is larger than 15MB, so it is not shown here.' } };
    }
    blob = file.getBlob();
    mime = shown;
  }
  var bytes = blob.getBytes();
  if (bytes.length > LOCATION_DOC_MAX_BYTES) {
    return { refused: { status: 400, message: 'This file is larger than 15MB, so it is not shown here.' } };
  }
  return { name: name, mime: exported ? 'application/pdf' : mime, size: bytes.length, exported: exported,
           b64: Utilities.base64Encode(bytes) };
}

/** An Office file as PDF: a converted copy, exported, then trashed (Books.gs's conversion). */
function locationsOfficePdf_(id, target) {
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var copy = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/copy?supportsAllDrives=true',
    { method: 'post', contentType: 'application/json', headers: auth, muteHttpExceptions: true,
      payload: JSON.stringify({ mimeType: target, name: 'locations-preview-tmp' }) });
  if (copy.getResponseCode() >= 400) return null;
  var tmp = JSON.parse(copy.getContentText()).id;
  var blob = null;
  try {
    var exp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + tmp +
      '/export?mimeType=application%2Fpdf', { headers: auth, muteHttpExceptions: true });
    if (exp.getResponseCode() < 400) blob = exp.getBlob();
  } finally {
    try { DriveApp.getFileById(tmp).setTrashed(true); } catch (eT) { /* the copy stays; nothing reads it */ }
  }
  return blob;
}

// ---- writes --------------------------------------------------------------

function locationsLock_() {
  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(20000); } catch (e) { held = false; }
  return held ? lock : null;
}

function locationsWho_(user) {
  return str_(user && user.display_name) || str_(user && user.email);
}

function locationsAppend_(sheet, header, rec) {
  var head = ensureHeader_(sheet, header);
  sheet.appendRow(head.map(function (h) {
    var v = rec[h];
    return hubCellSafe_(v === undefined || v === null ? '' : (typeof v === 'number' ? v : String(v)));
  }));
}

/** The row id the relay minted for its overlay (the prefix and a v4 uuid); '' for anything else. */
function locationsMinted_(v, prefix) {
  var s = String(v == null ? '' : v).trim();
  return s.indexOf(prefix) === 0 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.slice(prefix.length)) ? s : '';
}

/** A row of the tab already carries this id: the minted write landed before. */
function locationsIdTaken_(sheet, header, id) {
  var head = ensureHeader_(sheet, header);
  var at = head.indexOf('id');
  if (at === -1) return false;
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) if (String(values[r][at] || '').trim() === id) return true;
  return false;
}

/** File a house note: priority, details and an optional current client; the filer is the session. */
HUB_POLICY.locationNoteAdd = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, client_key: { type: 'string' }, priority: { type: 'string' },
            details: { type: 'string' } }
};
HUB_ACTIONS.locationNoteAdd = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var details = String((payload && payload.details) || '').trim().slice(0, 4000);
  if (!details) return { status: 400, message: 'details: what the note says.' };
  var priority = locationsText_(payload && payload.priority).toLowerCase() || 'normal';
  if (LOCATION_NOTE_PRIORITIES.indexOf(priority) === -1) {
    return { status: 400, message: 'priority: one of ' + LOCATION_NOTE_PRIORITIES.join(', ') + '.' };
  }
  var clientKey = locationsText_(payload && payload.client_key, 120);
  if (clientKey && !ctx.clients.some(function (c) { return c.client_key === clientKey; })) {
    return { status: 400, message: 'client_key: not a current client of ' + ctx.code + '.' };
  }
  var held = sheetDbGateHolds_(LOCATION_NOTES_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var minted = locationsMinted_(payload && payload.id, 'HN_');
  var note, filed = false;
  try {
    var sheet;
    try { sheet = locationsNotesSheet_(true); }
    catch (eS) { return { status: 503, message: 'The house notes store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    filed = !!minted && locationsIdTaken_(sheet, LOCATION_NOTES_HEADER, minted);
    note = { id: minted || ('HN_' + Utilities.getUuid()), house: ctx.code, client_key: clientKey, priority: priority,
             details: details, state: 'open', by: locationsWho_(user), at: new Date().toISOString(),
             state_by: '', state_at: '' };
    if (!filed) locationsAppend_(sheet, LOCATION_NOTES_HEADER, note);
  } finally { lock.releaseLock(); }
  if (filed) return { status: 200, data: { note: note, already: true } };
  locationsBump_('locationNotes', ctx.code);
  hubSysLog_(str_(user.email), 'locationNoteAdd', ctx.code, { status: 200 });
  note.client_name = '';
  ctx.clients.forEach(function (c) { if (c.client_key === clientKey) note.client_name = c.name; });
  return { status: 200, data: locationsWithSteps_({ note: note },
    locationsSteps_('A new row on ' + LOCATION_NOTES_TAB + '.', 'The house\'s notes, read again.')) };
};

// Open or resolve a house note; the house, when sent, is the witness the row must still carry.
HUB_POLICY.locationNoteState = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { id: { type: 'string' }, state: { type: 'string' }, house: { type: 'string' } }
};
HUB_ACTIONS.locationNoteState = function (payload, user) {
  if (!locationsGate_(user)) {
    var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
    if (door.refused) return door.refused;
  }
  var id = locationsText_(payload && payload.id, 80);
  var state = locationsText_(payload && payload.state).toLowerCase();
  if (!id) return { status: 400, message: 'id: which note.' };
  if (LOCATION_NOTE_STATES.indexOf(state) === -1) return { status: 400, message: 'state: open or resolved.' };
  var witness = payload && payload.house !== undefined && payload.house !== null && payload.house !== ''
    ? locationsHouseCode_(payload.house) || '?' : '';
  var held = sheetDbGateHolds_(LOCATION_NOTES_TAB, 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var out;
  try {
    var sheet = locationsNotesSheet_(false);
    if (!sheet) return { status: 404, message: 'No house note "' + id + '".' };
    var head = ensureHeader_(sheet, LOCATION_NOTES_HEADER);
    var values = sheet.getDataRange().getValues();
    var at = -1;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][head.indexOf('id')] || '').trim() === id) { at = r; break; }
    }
    if (at === -1) return { status: 404, message: 'No house note "' + id + '".' };
    var house = locationsHouseCode_(values[at][head.indexOf('house')]);
    if (witness && witness !== house) {
      return { status: 409, message: 'That note has moved since it was opened — reload the house.' };
    }
    var stamp = new Date().toISOString();
    // Three cells only: a row read back loses the quote that keeps its text from being a formula.
    sheet.getRange(at + 1, head.indexOf('state') + 1).setValue(state);
    sheet.getRange(at + 1, head.indexOf('state_by') + 1).setValue(hubCellSafe_(locationsWho_(user)));
    sheet.getRange(at + 1, head.indexOf('state_at') + 1).setValue(stamp);
    out = { id: id, house: house, state: state, state_by: locationsWho_(user), state_at: stamp };
  } finally { lock.releaseLock(); }
  locationsBump_('locationNotes', out.house);
  hubSysLog_(str_(user.email), 'locationNoteState', out.house, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ note: out },
    locationsSteps_('The note\'s state on ' + LOCATION_NOTES_TAB + '.', 'The house\'s notes, read again.')) };
};

/** One line on the house's supplies ledger: a count, a delivery or a par level. */
HUB_POLICY.locationSupplyEntry = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, item: { type: 'string' }, category: { type: 'string' },
            kind: { type: 'string' }, qty: {}, on_hand_after: {}, note: { type: 'string' } }
};
HUB_ACTIONS.locationSupplyEntry = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var item = locationsText_(payload && payload.item, 120);
  if (!item) return { status: 400, message: 'item: what is counted or delivered.' };
  var kind = locationsText_(payload && payload.kind).toLowerCase();
  if (LOCATION_SUPPLY_KINDS.indexOf(kind) === -1) {
    return { status: 400, message: 'kind: one of ' + LOCATION_SUPPLY_KINDS.join(', ') + '.' };
  }
  var qty = locationsNum_(payload && payload.qty);
  if (qty === null || qty < 0) return { status: 400, message: 'qty: a number, zero or more.' };
  var after = null;
  var rawAfter = payload && payload.on_hand_after;
  if (kind === 'delivery' && rawAfter !== undefined && rawAfter !== null && rawAfter !== '') {
    after = locationsNum_(rawAfter);
    if (after === null || after < 0) return { status: 400, message: 'on_hand_after: a number, zero or more.' };
  }
  var held = sheetDbGateHolds_(LOCATION_SUPPLY_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var minted = locationsMinted_(payload && payload.id, 'LS_');
  var rec, filed = false;
  try {
    var sheet;
    try { sheet = locationsSupplySheet_(true); } catch (eS) { sheet = null; }
    if (!sheet) return { status: 503, message: 'The supplies ledger is not set up: the ' + LOCATION_SUPPLY_TAB + ' house is not declared.' };
    filed = !!minted && locationsIdTaken_(sheet, LOCATION_SUPPLY_HEADER, minted);
    rec = { id: minted || ('LS_' + Utilities.getUuid()), house: ctx.code, item: item, qty: qty, needed_by: '', status: '',
            kind: kind, category: locationsText_(payload && payload.category, 60),
            on_hand_after: after === null ? '' : after, at: new Date().toISOString(), by: locationsWho_(user),
            note: locationsText_(payload && payload.note, 500) };
    if (!filed) locationsAppend_(sheet, LOCATION_SUPPLY_HEADER, rec);
  } finally { lock.releaseLock(); }
  if (filed) return { status: 200, data: { entry: rec, already: true } };
  locationsBump_('locationSupplies', ctx.code);
  hubSysLog_(str_(user.email), 'locationSupplyEntry', ctx.code, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ entry: rec },
    locationsSteps_('A new line on ' + LOCATION_SUPPLY_TAB + '.', 'The house\'s supplies, read again.')) };
};

// The edit doors' answer (RecordEdit.gs): 409 carrying what the record holds now when a witness went stale; the…
function locationsEditAnswer_(written, refused, stale, steps) {
  var data = { written: written.map(function (w) { return w.field; }), refused: refused };
  if (written.length && steps) data = locationsWithSteps_(data, steps);
  if (!Object.keys(stale).length) return { status: 200, data: data };
  data.current = stale;
  return { status: 409, data: data,
           message: written.length ? 'Some fields changed since the panel was opened — reloaded; the others were saved.'
                                   : 'Changed since the panel was opened — reloaded, nothing was written.' };
}

function locationsBusy_() {
  return { status: 409, message: 'Another write is in progress — try again in a moment.' };
}

/** Edit the house's registry row, found by its code; the name it was opened on is the row's witness. */
HUB_POLICY.locationHouseSave = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, home_name: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.locationHouseSave = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  if (!ctx.home) return { status: 404, message: 'The registry has no row for ' + ctx.code + '.' };
  if (payload.home_name === undefined || payload.home_name === null) {
    return { status: 400, message: 'home_name: the house name the panel was opened on.' };
  }
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var written = [], refused = [], stale = {};
  try {
    var sheet = null;
    try { sheet = ssOpen_(locationsBookId_(LOCATION_ENTITIES_PROP, LOCATION_ENTITIES_FALLBACK)).getSheetByName(LOCATION_HOMES_TAB); }
    catch (eS) { sheet = null; }
    if (!sheet) return { status: 503, message: 'The house registry could not be opened.' };
    var values = sheet.getDataRange().getValues();
    var head = (values[0] || []).map(function (h) { return String(h == null ? '' : h).trim(); });
    var cellAt = function (r, name) { var i = head.indexOf(name); return i === -1 ? '' : locationsText_(locationsCell_(values[r][i])); };
    var at = -1;
    for (var r = 1; r < values.length && at === -1; r++) {
      if (locationsHomeCode_(cellAt(r, 'abbreviation'), cellAt(r, 'home_name')) === ctx.code) at = r;
    }
    if (at === -1) return { status: 404, message: 'The registry has no row for ' + ctx.code + '.' };
    if (cellAt(at, 'home_name') !== locationsText_(payload.home_name)) {
      return { status: 409, message: 'That house row has changed since it was opened — reload the house.' };
    }
    var byAbbreviation = !!locationsHouseCode_(cellAt(at, 'abbreviation'));
    asked.changes.forEach(function (c) {
      var refuse = function (why) { refused.push({ field: c.field, why: why }); };
      if (LOCATION_HOUSE_LOCKED[c.field]) return refuse(LOCATION_HOUSE_LOCKED[c.field]);
      if (LOCATION_HOUSE_FIELDS.indexOf(c.field) === -1) return refuse('Not a field of the house registry.');
      var col = head.indexOf(c.field);
      if (col === -1) return refuse('The registry has no ' + c.field + ' column, and none is added.');
      var before = cellAt(at, c.field);
      var moved = hubEditWitness_(c.field, c.expected, before);
      if (moved) { stale[c.field] = moved.data.current; return; }
      var value = c.value.slice(0, 500);
      if (LOCATION_HOUSE_PHONES.indexOf(c.field) !== -1 && value) {
        var d = contactPhoneKey_(value);
        if (!d) return refuse('A phone number has 10 digits.');
        value = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
      }
      if (c.field === 'home_name') {
        if (!value) return refuse('A house keeps a name.');
        if (!byAbbreviation && locationsCode_(value) !== ctx.code) {
          return refuse('This row has no abbreviation, so its name must still end in ' + ctx.code + '.');
        }
      }
      if (c.field === 'calendar_link' && value && !/^https:\/\//i.test(value)) return refuse('A link is an https:// address.');
      if (c.field === 'thumbnail_url' && !locationsHouseImage_(value, ctx.code)) {
        return refuse('A house photo is one uploaded from Locations for ' + ctx.code + '.');
      }
      sheet.getRange(at + 1, col + 1).setValue(hubCellSafe_(value));
      written.push({ field: c.field, before: before, after: value });
    });
  } finally { lock.releaseLock(); }
  if (written.length) {
    cacheBump_(locationsHomesScope_());
    locationsBump_('locationOverview', ctx.code);
    hubEditLog_(user, 'locationHouseSave', ctx.code, written, LOCATION_HOUSE_FIELDS);
  }
  return locationsEditAnswer_(written, refused, stale,
    locationsSteps_(written.length + ' cell(s) of the house\'s row on ' + LOCATION_HOMES_TAB + '.',
                    'The registry and the house\'s overview, read again.', [], ['houses']));
};

// Edit a house note — details, priority, client, state; a removed note stays on the tab and leaves every list.
HUB_POLICY.locationNoteEdit = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, id: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.locationNoteEdit = function (payload, user) {
  var anyone = locationsGate_(user) || hubEditionAllows_(LOCATION_EDITION.notesAny, user);
  var door = locationsEditDoor_(payload, user, anyone ? LOCATION_EDITION.notesAny : LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ownOnly = !anyone;
  var ctx = door.ctx;
  var id = locationsText_(payload.id, 80);
  if (!id) return { status: 400, message: 'id: which note.' };
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var gate = sheetDbGateHolds_(LOCATION_NOTES_TAB, 'update');
  if (gate) return gate.error;
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var written = [], refused = [], stale = {};
  try {
    var sheet = locationsNotesSheet_(false);
    if (!sheet) return { status: 404, message: 'No house note "' + id + '".' };
    var head = ensureHeader_(sheet, LOCATION_NOTES_HEADER);
    var values = sheet.getDataRange().getValues();
    var at = -1;
    for (var r = 1; r < values.length && at === -1; r++) {
      if (String(values[r][head.indexOf('id')] || '').trim() === id) at = r;
    }
    if (at === -1) return { status: 404, message: 'No house note "' + id + '".' };
    if (locationsHouseCode_(values[at][head.indexOf('house')]) !== ctx.code) {
      return { status: 409, message: 'That note has moved since it was opened — reload the house.' };
    }
    if (ownOnly && locationsCell_(values[at][head.indexOf('by')]) !== locationsWho_(user)) {
      return { status: 403, message: 'Somebody else wrote this note. Editing anyone\'s note is its own edition, and ' +
               'it is not yours. Nothing was written.' };
    }
    var folded = { priority: 'normal', state: 'open' };
    var live = function (f) {
      var v = locationsCell_(values[at][head.indexOf(f)]);
      return folded[f] ? (v.toLowerCase() || folded[f]) : v;
    };
    var put = function (f, v) { sheet.getRange(at + 1, head.indexOf(f) + 1).setValue(hubCellSafe_(v)); };
    asked.changes.forEach(function (c) {
      var refuse = function (why) { refused.push({ field: c.field, why: why }); };
      if (LOCATION_NOTE_EDIT_FIELDS.indexOf(c.field) === -1) return refuse('Not a field of a house note.');
      var before = live(c.field);
      var moved = hubEditWitness_(c.field, folded[c.field] ? c.expected.toLowerCase() : c.expected, before);
      if (moved) { stale[c.field] = moved.data.current; return; }
      var value = folded[c.field] ? c.value.toLowerCase() : c.value;
      if (c.field === 'details') {
        if (!value) return refuse('A note says something; remove the note instead.');
        value = value.slice(0, 4000);
      }
      if (c.field === 'priority' && LOCATION_NOTE_PRIORITIES.indexOf(value) === -1) {
        return refuse('One of ' + LOCATION_NOTE_PRIORITIES.join(', ') + '.');
      }
      if (c.field === 'state' && LOCATION_NOTE_EDIT_STATES.indexOf(value) === -1) {
        return refuse('One of ' + LOCATION_NOTE_EDIT_STATES.join(', ') + '.');
      }
      if (c.field === 'client_key' && value && !ctx.clients.some(function (x) { return x.client_key === value; })) {
        return refuse('Not a current client of ' + ctx.code + '.');
      }
      put(c.field, value);
      if (c.field === 'state') {
        put('state_by', locationsWho_(user));
        put('state_at', new Date().toISOString());
      }
      written.push({ field: c.field, before: before, after: value });
    });
  } finally { lock.releaseLock(); }
  if (written.length) {
    locationsBump_('locationNotes', ctx.code);
    hubEditLog_(user, 'locationNoteEdit', ctx.code + ' ' + id, written, ['priority', 'state']);
  }
  return locationsEditAnswer_(written, refused, stale,
    locationsSteps_(written.length + ' cell(s) of the note\'s row on ' + LOCATION_NOTES_TAB + '.',
                    'The house\'s notes, read again.'));
};

/** Correct one supplies ledger entry by id — its quantity, category or note; the item, kind and time stay. */
HUB_POLICY.locationSupplyEdit = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, id: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.locationSupplyEdit = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var id = locationsText_(payload.id, 80);
  if (!id) return { status: 400, message: 'id: which entry.' };
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var gate = sheetDbGateHolds_(LOCATION_SUPPLY_TAB, 'update');
  if (gate) return gate.error;
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var written = [], refused = [], stale = {};
  try {
    var sheet = null;
    try { sheet = locationsSupplySheet_(false); } catch (eS) { sheet = null; }
    if (!sheet) return { status: 503, message: 'The supplies ledger is not set up: the ' + LOCATION_SUPPLY_TAB + ' house is not declared.' };
    var head = ensureHeader_(sheet, LOCATION_SUPPLY_HEADER);
    var values = sheet.getDataRange().getValues();
    var at = -1;
    for (var r = 1; r < values.length && at === -1; r++) {
      if (String(values[r][head.indexOf('id')] || '').trim() === id) at = r;
    }
    if (at === -1) return { status: 404, message: 'No supplies entry "' + id + '".' };
    if (locationsHouseCode_(values[at][head.indexOf('house')]) !== ctx.code) {
      return { status: 409, message: 'That entry has moved since it was opened — reload the house.' };
    }
    var live = function (f) {
      var v = values[at][head.indexOf(f)];
      if (f === 'qty') { var n = locationsNum_(v); return n === null ? locationsCell_(v) : String(n); }
      return locationsText_(locationsCell_(v));
    };
    asked.changes.forEach(function (c) {
      var refuse = function (why) { refused.push({ field: c.field, why: why }); };
      if (LOCATION_SUPPLY_EDIT_FIELDS.indexOf(c.field) === -1) return refuse('An entry\'s item, kind and time stay as recorded.');
      var before = live(c.field);
      var moved = hubEditWitness_(c.field, c.expected, before);
      if (moved) { stale[c.field] = moved.data.current; return; }
      var value = c.value;
      if (c.field === 'qty') {
        value = locationsNum_(c.value);
        if (value === null || value < 0) return refuse('A number, zero or more.');
      } else {
        value = locationsText_(value, c.field === 'category' ? 60 : 500);
      }
      sheet.getRange(at + 1, head.indexOf(c.field) + 1).setValue(hubCellSafe_(value));
      written.push({ field: c.field, before: before, after: String(value) });
    });
  } finally { lock.releaseLock(); }
  if (written.length) {
    locationsBump_('locationSupplies', ctx.code);
    hubEditLog_(user, 'locationSupplyEdit', ctx.code + ' ' + id, written, LOCATION_SUPPLY_EDIT_FIELDS);
  }
  return locationsEditAnswer_(written, refused, stale,
    locationsSteps_(written.length + ' cell(s) of the entry on ' + LOCATION_SUPPLY_TAB + '.',
                    'The house\'s supplies, read again.'));
};

/** File an IST paper for a staff member × client pair at the house (the certificate door's types and 15MB cap). */
HUB_POLICY.locationIstFile = {
  file: 'Locations.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, staff: { type: 'string' }, client: { type: 'string' }, file: {} }
};
HUB_ACTIONS.locationIstFile = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var staff = locationsText_(payload && payload.staff, 120);
  var clientName = locationsText_(payload && payload.client, 120);
  if (!staff || !clientName) return { status: 400, message: 'staff and client are required.' };
  var client = null;
  ctx.clients.forEach(function (c) {
    if (!client && (clientNameKey_(c.name) === clientNameKey_(clientName) || c.client_key === clientName)) client = c;
  });
  if (!client) return { status: 400, message: 'client: not a current client of ' + ctx.code + '.' };
  var f = (payload && payload.file && typeof payload.file === 'object') ? payload.file : (payload || {});
  var fname = locationsText_(f.filename || f.name, 180) || 'ist-paper';
  var b64 = String(f.base64 || f.b64 || f.data || (typeof payload.file === 'string' ? payload.file : '') || '')
    .replace(/^data:[^,]*,/, '');
  var mime = complianceDocsFileType_(fname, f.mime || f.type);
  if (!mime) return { status: 400, message: CERT_DOC_TYPE_WORDS + ' Nothing was filed.' };
  if (!b64) return { status: 400, message: 'The file is required.' };
  if (b64.length > 21000000) return { status: 400, message: 'The file is too large — up to 15MB.' };
  var held = sheetDbGateHolds_('istRecords', 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var cell;
  try {
    var pair = istPairKey_(staff, client.name);
    var row = null;
    locationsIstRows_().forEach(function (r) {
      if (!row && istPairKey_(r.staffName, r.clientName) === pair && locationsHouseCode_(r.house) === ctx.code) row = r;
    });
    if (!row) return { status: 404, message: 'No IST record pairs ' + staff + ' with ' + client.name + ' at ' + ctx.code + '.' };
    var bytes = Utilities.base64Decode(b64);
    if (!bytes.length) return { status: 400, message: 'The file is empty.' };
    var name = ('IST - ' + staff + ' - ' + client.name + ' - ' + fname).slice(0, 200);
    var file = complianceDocsFolder_(LOCATION_IST_FOLDER).createFile(Utilities.newBlob(bytes, mime, name));
    var patch = { id: str_(row.id), docUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
                  docFileId: file.getId(), docAt: new Date().toISOString(), docBy: hubCellSafe_(locationsWho_(user)) };
    var res = updateRowById_('istRecords', patch);
    var refused = sheetDbRefused_(res);
    if (refused) return refused;
    cell = locationsIstCell_(res, client);
  } finally { lock.releaseLock(); }
  locationsBump_('locationStaff', ctx.code);
  locationsBump_('locationDocuments', ctx.code);
  hubSysLog_(str_(user.email), 'locationIstFile', ctx.code, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ ist: cell },
    locationsSteps_('The paper in Drive and its IST record.', 'The house\'s staff and documents, read again.', [], [],
                    'Drive and sheet')) };
};

// ---- the editions' own doors ---------------------------------------------

// Take a person off the house's Staff list, or put them back (`back`).
HUB_POLICY.locationStaffRemove = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, staff: { type: 'string' }, back: {} }
};
HUB_ACTIONS.locationStaffRemove = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.staffRemove);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var name = locationsText_(payload && payload.staff, 120);
  var key = clientNameKey_(name);
  if (!key) return { status: 400, message: 'staff: who is taken off the house.' };
  var back = payload.back === true;
  var part;
  try { part = locationsStaffPart_(ctx); }
  catch (e) {
    return { status: 503, message: 'The house\'s staff could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  if (part.removed_why) {
    return { status: 503, message: 'Who was taken off ' + ctx.code + ' could not be read, so nothing was written.' };
  }
  var listed = null;
  ((back ? part.removed : part.staff) || []).forEach(function (p) { if (!listed && p.key === key) listed = p; });
  if (!listed) {
    return { status: 404, message: back ? name + ' was not taken off ' + ctx.code + '.'
                                        : name + ' is not on ' + ctx.code + '\'s Staff list.' };
  }
  var held = sheetDbGateHolds_(LOCATION_STAFF_OFF_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var rec;
  try {
    var sheet;
    try { sheet = hubTabEnsure_(LOCATION_STAFF_OFF_TAB, LOCATION_STAFF_OFF_HEADER); }
    catch (eS) { return { status: 503, message: 'The Staff list\'s store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    rec = { id: 'HS_' + Utilities.getUuid(), house: ctx.code, staff_key: key, name: listed.name,
            state: back ? 'back' : 'off', by: locationsWho_(user), at: new Date().toISOString() };
    locationsAppend_(sheet, LOCATION_STAFF_OFF_HEADER, rec);
  } finally { lock.releaseLock(); }
  locationsBump_('locationStaff', ctx.code);
  hubSysLog_(str_(user.email), 'locationStaffRemove', ctx.code + ' ' + rec.state, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ house: ctx.code, staff: { key: key, name: rec.name, state: rec.state } },
    locationsSteps_('A row on ' + LOCATION_STAFF_OFF_TAB + '; the staff record is untouched.',
                    'The house\'s staff, read again.')) };
};

// An estate row's edit for a door that has already decided who writes — Estate.gs's header-bound, row-verified…
function locationsEstateEdit_(resource, id, changes, fields, belongs, check) {
  var rowNum = estateRowNum_(id);
  if (!rowNum) return { answer: { status: 400, message: 'id: a row id like "r42".' } };
  var held = sheetDbGateHolds_(resource, 'update');
  if (held) return { answer: held.error };
  var src = estateSource_(resource);
  var handle = null;
  try { handle = src ? estateSheet_(resource) : null; } catch (eH) { handle = null; }
  if (!handle) return { answer: { status: 503, message: 'The "' + resource + '" sheet could not be opened.' } };
  var lock = locationsLock_();
  if (!lock) return { answer: locationsBusy_() };
  var written = [], refused = [], stale = {};
  try {
    var row = estateReadRow_(handle, rowNum);
    if (!row) return { answer: { status: 404, message: 'No row "' + id + '" in ' + resource + '.' } };
    if (!belongs(row)) {
      return { answer: { status: 409, message: 'That row has moved since it was opened — reload the house.' } };
    }
    changes.forEach(function (c) {
      var refuse = function (why) { refused.push({ field: c.field, why: why }); };
      if (fields.indexOf(c.field) === -1) return refuse('Not a field edited here.');
      var col = handle.keys.indexOf(c.field);
      if (col === -1) return refuse('The sheet has no ' + c.field + ' column, and none is added.');
      var before = String(row[c.field] == null ? '' : row[c.field]);
      if (locationsText_(c.expected) !== locationsText_(before)) { stale[c.field] = before; return; }
      var why = check ? check(c.field, c.value) : '';
      if (why) return refuse(why);
      var value = c.value.slice(0, 4000);
      handle.sheet.getRange(rowNum, col + 1).setValue(hubCellSafe_(value));
      written.push({ field: c.field, before: before, after: value });
    });
    if (written.length) cacheBump_(cacheScopeSheet_(src.id, src.tab));
  } finally { lock.releaseLock(); }
  return { written: written, refused: refused, stale: stale };
}

/** The house's current client a name folds to; null when it names none of them. */
function locationsHouseClient_(ctx, name) {
  var k = clientNameKey_(name);
  var hit = null;
  ctx.clients.forEach(function (c) { if (!hit && k && clientNameKey_(c.name) === k) hit = c; });
  return hit;
}

/** The fields a filing sends, as the estate's form columns for `resource` keep them (Estate.gs ESTATE_FILE_COLUMNS). */
function locationsFilingRow_(resource, sent) {
  var rec = {};
  ESTATE_FILE_COLUMNS[resource].forEach(function (k) {
    if (sent[k] !== undefined && sent[k] !== null && typeof sent[k] !== 'object') rec[k] = String(sent[k]).slice(0, 4000);
  });
  if (!rec.timestamp) rec.timestamp = new Date().toISOString();
  return rec;
}

/** Open a new incident for one of the house's current clients, through the estate's own create (UIs and MUIs). */
HUB_POLICY.locationIncidentFile = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, row: {} }
};
HUB_ACTIONS.locationIncidentFile = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.incidents);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var sent = payload && payload.row;
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return { status: 400, message: 'row: the incident\'s fields.' };
  var client = locationsHouseClient_(ctx, sent.client_name);
  if (!client) return { status: 400, message: 'client_name: one of ' + ctx.code + '\'s current clients.' };
  var rec = locationsFilingRow_('uiIncidents', sent);
  if (!locationsText_(rec.incident_category)) return { status: 400, message: 'incident_category: what kind of incident.' };
  rec.client_name = client.name;
  rec.your_name = locationsText_(rec.your_name, 120) || locationsWho_(user);
  var res = estateRoute_('uiIncidents', 'create', rec, user);
  if (!res || res.status !== 200) return res || { status: 500, message: 'The incidents sheet gave no answer.' };
  locationsBump_('locationIncidents', ctx.code);
  hubSysLog_(str_(user.email), 'locationIncidentFile', ctx.code, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ house: ctx.code, incident: res.data },
    locationsSteps_('A new row on the estate\'s UIs and MUIs sheet.',
                    'The incidents sheet\'s kept copy and the house\'s incidents, read again.', ['uiIncidents'])) };
};

/** Edit an incident of the house's clients, field by field; when it was filed stays as filed. */
HUB_POLICY.locationIncidentEdit = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, id: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.locationIncidentEdit = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.incidents);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var got = locationsEstateEdit_('uiIncidents', payload.id, asked.changes, LOCATION_INCIDENT_EDIT_FIELDS,
    function (row) { return !!locationsHouseClient_(ctx, row.client_name); },
    function (field, value) {
      return field === 'client_name' && !locationsHouseClient_(ctx, value) ? 'Not a current client of ' + ctx.code + '.' : '';
    });
  if (got.answer) return got.answer;
  if (got.written.length) {
    locationsBump_('locationIncidents', ctx.code);
    hubEditLog_(user, 'locationIncidentEdit', ctx.code + ' ' + locationsText_(payload.id, 20), got.written, []);
  }
  return locationsEditAnswer_(got.written, got.refused, got.stale,
    locationsSteps_(got.written.length + ' cell(s) of the incident\'s row on the UIs and MUIs sheet.',
                    'The incidents sheet\'s kept copy and the house\'s incidents, read again.', ['uiIncidents']));
};

/** Is this repair request the house's: its own street, the unique street-number fallback, or an ALL row? */
function locationsRepairAt_(ctx, row) {
  return locationsRepairsFor_([row], ctx.code, locationsAddrIndex_(ctx.homes, ctx.all_clients)).length === 1;
}

/** File a repair request for the house's own street, through the estate's own create (House Repair Requests). */
HUB_POLICY.locationRepairFile = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, row: {} }
};
HUB_ACTIONS.locationRepairFile = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var sent = payload && payload.row;
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return { status: 400, message: 'row: the request\'s fields.' };
  var rec = locationsFilingRow_('workOrders', sent);
  var street = locationsText_(rec.select_address_vehicle, 200);
  if (!street) return { status: 400, message: 'select_address_vehicle: the house\'s street.' };
  if (locationsAddrOwner_(locationsAddrIndex_(ctx.homes, ctx.all_clients), street).code !== ctx.code) {
    return { status: 400, message: 'That street is not ' + ctx.code + '\'s; a repair is filed from its own house.' };
  }
  if (!locationsText_(rec.repair_type)) return { status: 400, message: 'repair_type: what needs repairing.' };
  var res = estateRoute_('workOrders', 'create', rec, user);
  if (!res || res.status !== 200) return res || { status: 500, message: 'The repairs sheet gave no answer.' };
  locationsBump_('locationRepairs', ctx.code);
  hubSysLog_(str_(user.email), 'locationRepairFile', ctx.code, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ house: ctx.code, repair: res.data },
    locationsSteps_('A new row on the estate\'s Repairs sheet.',
                    'The repairs sheet\'s kept copy and the house\'s repairs, read again.', ['workOrders'])) };
};

/** Edit a repair request of the house, field by field; its street and when it was filed stay. */
HUB_POLICY.locationRepairEdit = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, id: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.locationRepairEdit = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.house);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var got = locationsEstateEdit_('workOrders', payload.id, asked.changes, LOCATION_REPAIR_EDIT_FIELDS,
    function (row) { return locationsRepairAt_(ctx, row); }, null);
  if (got.answer) return got.answer;
  if (got.written.length) {
    locationsBump_('locationRepairs', ctx.code);
    hubEditLog_(user, 'locationRepairEdit', ctx.code + ' ' + locationsText_(payload.id, 20), got.written,
                ['status', 'urgency_level']);
  }
  return locationsEditAnswer_(got.written, got.refused, got.stale,
    locationsSteps_(got.written.length + ' cell(s) of the request\'s row on the Repairs sheet.',
                    'The repairs sheet\'s kept copy and the house\'s repairs, read again.', ['workOrders']));
};

/** Is this House Inventory row the house's: its address is one the house answers to (the Supplies read's rule). */
function locationsAssetAt_(ctx, row) {
  return locationsAddrOwner_(locationsAddrIndex_(ctx.homes, ctx.all_clients), row.address).code === ctx.code;
}

/** Edit one of the house's assets on House Supplies' own inventory (House Inventory List), field by field. */
HUB_POLICY.locationAssetEdit = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, id: { type: 'string' }, changes: { type: 'array' } }
};
HUB_ACTIONS.locationAssetEdit = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.assets);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var got = locationsEstateEdit_('houseInventory', payload.id, asked.changes, LOCATION_ASSET_FIELDS,
    function (row) { return locationsAssetAt_(ctx, row); },
    function (field, value) { return field === 'item' && !locationsText_(value) ? 'An asset keeps its name.' : ''; });
  if (got.answer) return got.answer;
  if (got.written.length) {
    locationsBump_('locationSupplies', ctx.code);
    hubEditLog_(user, 'locationAssetEdit', ctx.code + ' ' + locationsText_(payload.id, 20), got.written,
                LOCATION_ASSET_FIELDS);
  }
  return locationsEditAnswer_(got.written, got.refused, got.stale,
    locationsSteps_(got.written.length + ' cell(s) of the asset\'s row on the House Inventory List.',
                    'The inventory\'s kept copy and the house\'s supplies, read again.'));
};

/** Add an asset to House Supplies' own inventory at the house's registry street; nothing is ever removed here. */
HUB_POLICY.locationAssetAdd = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, row: {} }
};
HUB_ACTIONS.locationAssetAdd = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.assets);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var sent = payload && payload.row;
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return { status: 400, message: 'row: the asset\'s fields.' };
  var rec = { address: locationsText_(ctx.home && ctx.home.address, 200) };
  if (!rec.address) return { status: 409, message: 'The registry holds no street for ' + ctx.code + ', so no asset is placed there.' };
  LOCATION_ASSET_FIELDS.forEach(function (f) { rec[f] = locationsText_(sent[f], 500); });
  if (!rec.item) return { status: 400, message: 'item: what the asset is.' };
  var held = sheetDbGateHolds_('houseInventory', 'create');
  if (held) return held.error;
  var handle = null;
  try { handle = estateSheet_('houseInventory'); } catch (eH) { handle = null; }
  if (!handle || handle.keys.indexOf('item') === -1 || handle.keys.indexOf('address') === -1) {
    return { status: 503, message: 'The House Inventory List could not be opened.' };
  }
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var row;
  try {
    handle.sheet.appendRow(handle.keys.map(function (k) { return k && rec[k] !== undefined ? hubCellSafe_(rec[k]) : ''; }));
    row = estateReadRow_(handle, handle.sheet.getLastRow());
    cacheBump_(locationsEstateScope_('houseInventory'));
  } finally { lock.releaseLock(); }
  locationsBump_('locationSupplies', ctx.code);
  hubSysLog_(str_(user.email), 'locationAssetAdd', ctx.code, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ house: ctx.code, asset: row },
    locationsSteps_('A new row on the House Inventory List.', 'The inventory\'s kept copy and the house\'s supplies, read again.')) };
};

var LOCATION_DOC_TYPE_WORDS = 'A PDF, a picture (PNG, JPEG, GIF, WebP or HEIC), or a Word, Excel or PowerPoint file.';

// The type a house document is filed as: an image or a PDF (the certificate door's), or an Office file; ''…
function locationsDocType_(name, mime) {
  var t = complianceDocsFileType_(name, mime);
  if (t) return t;
  var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '').trim());
  var office = m ? (LOCATION_DOC_OFFICE_TYPES[m[1].toLowerCase()] || '') : '';
  if (!office) return '';
  var sent = String(mime || '').toLowerCase().split(';')[0].trim();
  return !sent || sent === 'application/octet-stream' || sent === office ? office : '';
}

// The house's own folder in the houses room — the one the guidebook walk finds — made there when `make` and none…
function locationsHouseFolder_(ctx, make) {
  var found;
  try { found = locationsGuidebook_(ctx.code); }
  catch (e) {
    return { refused: { status: 503, message: 'The houses room could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' } };
  }
  try {
    if (found.guidebook) return { folder: DriveApp.getFolderById(found.guidebook.folder_id), files: found.guidebook.files };
    if (!make) return { refused: { status: 404, message: 'No folder in the houses room names ' + ctx.code + '.' }, files: [] };
    var room = docRoomFolder_('houses');
    if (!room.folder) return { refused: { status: 503, message: room.reason } };
    var title = locationsText_(ctx.home && ctx.home.home_name) || ctx.code;
    var name = locationsCode_(title) === ctx.code ? title : title + ' - ' + ctx.code;
    return { folder: room.folder.createFolder(name), files: [], made: true };
  } catch (eF) {
    return { refused: locationsDriveRefusal_(eF, 'Opening the house\'s folder') };
  }
}

/** The folder of this name inside `parent`, made when there is none. */
function locationsChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** A Drive failure as the door says it. */
function locationsDriveRefusal_(e, doing) {
  var said = String((e && e.message) || e);
  if (/not found|no item|does not exist|access|permission/i.test(said)) {
    return { status: 404, message: 'The platform cannot open that document — check the link, or share it with the ' +
             'platform account.' };
  }
  return { status: 503, message: doing + ' did not finish just now (' + said.slice(0, 120) + '). Try again.' };
}

// Remove one of the house's own documents (its folder in the houses room): the file moves to the room's "Removed…
HUB_POLICY.locationDocRemove = {
  file: 'Locations.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, id: { type: 'string' } }
};
HUB_ACTIONS.locationDocRemove = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.documents);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var id = locationsText_(payload && payload.id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'id: a Drive file id.' };
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var removed;
  try {
    var found = locationsHouseFolder_(ctx, false);
    if (found.refused && found.refused.status === 503) return found.refused;
    if (!(found.files || []).some(function (f) { return f.id === id; })) {
      var docs = locationsDocumentsPart_(ctx);
      if ((docs.isps || []).some(function (d) { return d.isp_doc_id === id; })) {
        return { status: 409, message: 'An ISP is the client\'s own plan; it changes in Clients and is never removed ' +
                 'from a house here.' };
      }
      if ((docs.policies || []).some(function (p) { return p.drive_id === id; })) {
        return { status: 409, message: 'A company document applies to every location; it changes in Common Data and ' +
                 'is never removed from one house.' };
      }
      return { status: 404, message: 'This house names no such document of its own.' };
    }
    var room = docRoomFolder_('houses');
    if (!room.folder) return { status: 503, message: room.reason };
    try {
      var file = DriveApp.getFileById(id);
      removed = { id: id, name: String(file.getName()) };
      file.moveTo(locationsChildFolder_(room.folder, LOCATION_DOC_REMOVED_FOLDER));
    } catch (eM) { return locationsDriveRefusal_(eM, 'Moving the document'); }
  } finally { lock.releaseLock(); }
  locationsBump_('locationDocuments', ctx.code);
  hubSysLog_(str_(user.email), 'locationDocRemove', ctx.code + ' ' + id, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ house: ctx.code, removed: removed },
    locationsSteps_('The file moved to "' + LOCATION_DOC_REMOVED_FOLDER + '" in the houses room.',
                    'The house\'s documents, read again.', [], [], 'Drive')) };
};

// Add a document from a Google Drive link: a copy is filed in the house's own folder (made in the houses room when…
HUB_POLICY.locationDocLink = {
  file: 'Locations.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, url: { type: 'string' } }
};
HUB_ACTIONS.locationDocLink = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.documents);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var url = String((payload && payload.url) || '').trim().slice(0, 500);
  if (/\/folders\//.test(url)) return { status: 400, message: 'That link is a folder; a document is one file.' };
  var id = locationsDriveId_(url) || (/^[A-Za-z0-9_-]{20,}$/.test(url) ? url : '');
  if (!id) return { status: 400, message: 'url: a Google Drive link to the document.' };
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var added;
  try {
    var src;
    try { src = DriveApp.getFileById(id); if (src.isTrashed()) return { status: 404, message: 'That document is in the trash.' }; }
    catch (eO) { return locationsDriveRefusal_(eO, 'Opening the document'); }
    var found = locationsHouseFolder_(ctx, true);
    if (found.refused) return found.refused;
    try {
      var name = String(src.getName()).slice(0, 200);
      var copy = src.makeCopy(name, found.folder);
      added = { id: copy.getId(), name: name, folder_made: found.made === true };
    } catch (eC) { return locationsDriveRefusal_(eC, 'Copying the document'); }
  } finally { lock.releaseLock(); }
  locationsBump_('locationDocuments', ctx.code);
  hubSysLog_(str_(user.email), 'locationDocLink', ctx.code + ' ' + added.id, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ house: ctx.code, added: added },
    locationsSteps_('A copy filed in the house\'s folder, owned by the platform; the original stays where it is.',
                    'The house\'s documents, read again.', [], [], 'Drive')) };
};

/** Upload a document from outside the platform into the house's own folder (images, PDFs and Office files, 15MB). */
HUB_POLICY.locationDocUpload = {
  file: 'Locations.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, file: {} }
};
HUB_ACTIONS.locationDocUpload = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.documents);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var f = (payload && payload.file && typeof payload.file === 'object') ? payload.file : {};
  var fname = locationsText_(f.name || f.filename, 180);
  var mime = locationsDocType_(fname, f.mime || f.type);
  if (!mime) return { status: 400, message: LOCATION_DOC_TYPE_WORDS + ' Nothing was filed.' };
  var b64 = String(f.b64 || f.base64 || '').replace(/^data:[^,]*,/, '');
  if (!b64) return { status: 400, message: 'The file is required.' };
  if (b64.length > 21000000) return { status: 400, message: 'The file is too large — up to 15MB.' };
  var lock = locationsLock_();
  if (!lock) return locationsBusy_();
  var added;
  try {
    var bytes = Utilities.base64Decode(b64);
    if (!bytes.length) return { status: 400, message: 'The file is empty.' };
    var found = locationsHouseFolder_(ctx, true);
    if (found.refused) return found.refused;
    try {
      var file = found.folder.createFile(Utilities.newBlob(bytes, mime, fname || 'House document'));
      added = { id: file.getId(), name: String(file.getName()), folder_made: found.made === true };
    } catch (eC) { return locationsDriveRefusal_(eC, 'Filing the document'); }
  } finally { lock.releaseLock(); }
  locationsBump_('locationDocuments', ctx.code);
  hubSysLog_(str_(user.email), 'locationDocUpload', ctx.code + ' ' + added.id, { status: 200 });
  return { status: 200, data: locationsWithSteps_({ house: ctx.code, added: added },
    locationsSteps_('The file filed in the house\'s folder, owned by the platform.',
                    'The house\'s documents, read again.', [], [], 'Drive')) };
};

// The house a client is a current client of now: its code (or a label ending in one), else the registry street and…
function locationsClientHouseNow_(c, homes) {
  if (!locationsClientCurrent_(c)) return '';
  var hc = locationsHouseCode_(c.house) || locationsCode_(c.house);
  if (hc) return hc;
  var a = locationsAddr_(c.home_address);
  if (!a.key) return '';
  var at = '';
  (homes || []).forEach(function (h) {
    if (at || !h || !h.address) return;
    var ha = locationsAddr_(h.address);
    if (ha.key === a.key && ha.unit === a.unit) at = h.code;
  });
  return at;
}

// Add clients to the house — never take one off.
HUB_POLICY.locationClientsAdd = {
  file: 'Locations.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { house: { type: 'string' }, clients: { type: 'array' } }
};
HUB_ACTIONS.locationClientsAdd = function (payload, user) {
  var door = locationsEditDoor_(payload, user, LOCATION_EDITION.clientsAdd);
  if (door.refused) return door.refused;
  var ctx = door.ctx;
  var p = payload || {};
  if (['remove', 'removed', 'drop', 'off'].some(function (k) { return p[k] !== undefined && p[k] !== null; })) {
    return { status: 400, message: 'A house\'s current clients are never taken off here. Nothing was written.' };
  }
  var asked = Array.isArray(p.clients) ? p.clients : null;
  if (!asked || !asked.length) return { status: 400, message: 'clients: one or more clients to add.' };
  if (asked.length > LOCATION_CLIENTS_ADD_MAX) {
    return { status: 400, message: 'At most ' + LOCATION_CLIENTS_ADD_MAX + ' clients at once. Nothing was written.' };
  }
  if (ctx.clients_why || ctx.homes_why) {
    return { status: 503, message: 'The clients or the house registry could not be read just now, so nothing was written.' };
  }
  var keys = [];
  asked.forEach(function (k) {
    var s = locationsText_(typeof k === 'object' ? '' : k, 120);
    if (s && keys.indexOf(s) === -1) keys.push(s);
  });
  if (!keys.length) return { status: 400, message: 'clients: one or more clients to add.' };
  var added = [], refused = [];
  keys.forEach(function (key) {
    var refuse = function (why) { refused.push({ client_key: key, why: why }); };
    var c = null;
    ctx.all_clients.forEach(function (x) { if (!c && x.client_key === key) c = x; });
    if (!c) return refuse('No client "' + key + '" is on file.');
    if (!locationsClientCurrent_(c)) return refuse(c.name + ' is not a current client; an inactive client is not placed in a house here.');
    var now = ctx.clients.some(function (x) { return x.client_key === key; }) ? ctx.code : locationsClientHouseNow_(c, ctx.homes);
    if (now === ctx.code) return refuse(c.name + ' is already a client of ' + ctx.code + '.');
    if (now) return refuse(c.name + ' is a current client of ' + now + '; a client is never taken off a house here.');
    var cctx = clientProfilesClient_(key);
    if (cctx.refused) return refuse(cctx.refused.message);
    if (cctx.archived) return refuse(c.name + ' is in the archive of old clients.');
    var live = cpEditLive_(cctx);
    if (live.refused) return refuse(live.refused.message);
    var got = cpProfileEdit_(cctx, { changes: [{ field: 'house', value: ctx.code,
                                                 expected: String(live.house == null ? '' : live.house) }] }, user);
    var said = (got && got.data) || {};
    if (got && got.status === 200 && (said.written || []).indexOf('house') !== -1) {
      added.push({ client_key: key, name: c.name });
      return;
    }
    refuse((said.refused || []).map(function (r) { return r.why; }).join(' ') || (got && got.message) ||
           'The client\'s record was not written.');
  });
  var data = { house: ctx.code, added: added, refused: refused, client_keys: added.map(function (a) { return a.client_key; }) };
  if (!added.length) {
    return { status: 409, data: data, message: (refused.length ? refused[0].why + ' ' : '') + 'Nothing was written.' };
  }
  ['locationOverview', 'locationStaff', 'locationIncidents', 'locationDocuments'].forEach(function (a) {
    locationsBump_(a, ctx.code);
  });
  hubSysLog_(str_(user.email), 'locationClientsAdd', ctx.code + ': ' + added.length + ' added', { status: 200 });
  return { status: 200, data: locationsWithSteps_(data,
    locationsSteps_('The house on ' + added.length + ' client record(s): the Hub clients tab and the Asa Client Database ' +
                    'Master.', 'The house\'s overview, staff, incidents and documents, read again.', ['clients'],
                    ['houses'])) };
};
