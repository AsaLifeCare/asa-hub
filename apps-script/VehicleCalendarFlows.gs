// TRANSPORTATION — THE FLOWS.
// A staff member's request, the directors' answer (first answer decides), the requester's withdraw, the directors'…

var VC_TICK_BUDGET_MS = 15000;
var VC_RETRY_MS = 600000;
var VC_TRIP_ID = /^VT[0-9A-F]{10}$/;
var VC_ITEM_ID = /^VI[0-9A-F]{10}$/;

/* ---- the quiet window and the clock's next look ---- */

function vcQuiet_(ms) {
  try { return typeof hubQuietAt_ === 'function' && !!hubQuietAt_(new Date(ms)); } catch (e) { return false; }
}

/** 08:00 Ohio on a day, read at noon UTC so a day the clocks move is not an hour out. */
function vcAt8_(iso) {
  var p = iso.split('-');
  var probe = Date.UTC(+p[0], +p[1] - 1, +p[2], 12);
  var hm = vcHm_(probe).split(':');
  return probe - ((Number(hm[0]) * 60 + Number(hm[1])) - 480) * 60000;
}

function vcNext8_(ms) {
  var today = vcDayOf_(ms);
  var at = vcAt8_(today);
  return at > ms ? at : vcAt8_(vcIsoAdd_(today, 1));
}

function vcDuePut_(ms, nowMs) {
  try {
    var ttl = Math.max(60, Math.min(21600, Math.ceil((ms - nowMs) / 1000) + 60));
    CacheService.getScriptCache().put(VC_DUE_KEY, String(Math.round(ms)), ttl);
  } catch (e) { /* an absent stamp is read as "look now" */ }
}

/** Brings the clock's next look forward to `ms` (never back). */
function vcDueLower_(ms) {
  try {
    var c = CacheService.getScriptCache();
    var cur = c.get(VC_DUE_KEY);
    if (cur === null || cur === undefined || cur === '' || Number(cur) > ms) c.put(VC_DUE_KEY, String(Math.round(ms)), 21600);
  } catch (e) { /* an absent stamp is read as "look now" */ }
}

/* ---- the one text door ---- */

// EVERY TEXT IS HANDED TO SMART COMMS.
function vcSay_(sit, uid, vars, key, name) {
  return smartTell_({ situation: sit, to: vcPhoneOf_(uid), vars: vars || {}, key: key, person: vcStr_(name),
                      lane: 'transportation', at_ms: vcNow_(), prune: true });
}

function vcLink_(path) {
  return (typeof mailPlatformUrl_ === 'function' ? mailPlatformUrl_() : '') + '/#' + path;
}

function vcTripLink_(tripId) { return '/app/vehicle-calendar/calendar?trip=' + tripId; }

/** A text owed by a trip: kept on its `told` until said (the quiet window keeps it for 08:00). */
function vcOwe_(told, entry) {
  told.owed = told.owed || [];
  if (told.owed.some(function (o) { return o.key === entry.key; })) return;
  told.owed.push(entry);
}

function vcOwed_(sit, bucket, trip, to, vars, whileState) {
  return { sit: sit, bucket: bucket, uid: vcStr_(to.uid), name: vcStr_(to.name), key: 'vc|' + sit + '|' + trip.id + '|' + to.uid,
           vars: vars, while: whileState || '' };
}

/** Says each owed text now; a stale one (the trip moved on) is recorded and not said. */
function vcSendOwed_(tripId, entries, tripState) {
  return (entries || []).map(function (o) {
    if (o.while && tripState && tripState !== o.while) {
      return { trip_id: tripId, entry: o, res: { state: 'stale', held: '', why: 'the trip moved on before it could be said' } };
    }
    var res;
    try { res = vcSay_(o.sit, o.uid, o.vars, o.key, o.name); }
    catch (e) { res = { state: 'failed', held: '', why: vcErr_(e) }; }
    return { trip_id: tripId, entry: o, res: res || { state: 'failed', why: 'no answer' } };
  });
}

/** One outcome onto a trip's `told`; a text the quiet window held stays owed for 08:00. */
function vcToldApply_(told, entry, res, atIso) {
  var bucket = entry.bucket || 'ask';
  told[bucket] = told[bucket] || {};
  told[bucket][entry.uid] = { state: vcStr_(res.state), held: vcStr_(res.held), why: vcText_(res.why, 200), at: atIso };
  if (res.held !== 'quiet') {
    told.owed = (told.owed || []).filter(function (o) { return o.key !== entry.key; });
  }
}

/** The outcomes, written onto the trips as they stand now; a busy lock leaves them owed for the clock. */
function vcToldRecord_(results, waitMs) {
  if (!results || !results.length) return 0;
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(waitMs === undefined ? 10000 : waitMs); } catch (e) { got = false; }
  if (!got) {
    try {
      hubSysLog_('asa-hub:transportation', 'transportation_told_unrecorded',
                 results.length + ' text outcome(s): the lock was busy; the clock says them again under the same key',
                 { status: 409 });
    } catch (eL) {}
    return 0;
  }
  vcMemoFresh_();
  var written = 0, quiet = false;
  try {
    var byId = {};
    vcRead_(VC_TABS.trips).forEach(function (t) { byId[t.id] = t; });
    var touched = {};
    var nowIso = vcNowIso_();
    results.forEach(function (r) {
      var t = byId[r.trip_id];
      if (!t) return;
      var told = vcJson_(t.told, {});
      vcToldApply_(told, r.entry, r.res, nowIso);
      if (r.res.held === 'quiet') quiet = true;
      t.told = JSON.stringify(told);
      touched[t.id] = t;
    });
    var rows = Object.keys(touched).map(function (k) { return touched[k]; });
    if (rows.length) vcUpsert_(VC_TABS.trips, rows);
    written = rows.length;
  } catch (e) {
    try { hubSysLog_('asa-hub:transportation', 'transportation_told_unrecorded', vcErr_(e), { status: 500 }); } catch (eL) {}
  } finally {
    try { vcSettle_(); } catch (eS) {}
    try { lock.releaseLock(); } catch (eR) {}
  }
  if (quiet) vcDueLower_(vcNext8_(vcNow_()));
  return written;
}

/** What the texts did, in one sentence for the panel; '' when every one went out. */
function vcTextWords_(results) {
  var parts = [];
  var by = function (st) { return results.filter(function (r) { return r.res.state === st; }); };
  var test = results.filter(function (r) { return r.res.held === 'test_mode'; });
  var quiet = results.filter(function (r) { return r.res.held === 'quiet'; });
  if (test.length) parts.push('Test mode is on: the text' + (test.length === 1 ? ' was' : 's were') +
                              ' written to the rehearsal book — nobody was contacted.');
  if (quiet.length) parts.push('It is quiet hours: the text' + (quiet.length === 1 ? ' goes' : 's go') + ' out at 08:00.');
  by('no_phone').forEach(function (r) { parts.push(r.entry.name + ' has no number this platform may text.'); });
  if (by('off').length) parts.push('No text went out: ' + vcStr_(by('off')[0].res.why) + '.');
  by('failed').concat(by('refused')).forEach(function (r) {
    parts.push(r.entry.name + ' could not be texted (' + vcText_(r.res.why, 120) + ').');
  });
  results.filter(function (r) { return r.res.state === 'held' && r.res.held !== 'test_mode' && r.res.held !== 'quiet'; })
    .forEach(function (r) { parts.push('The text to ' + r.entry.name + ' was held (' + vcText_(r.res.why || r.res.held, 120) + ').'); });
  return parts.join(' ');
}

/* ---- My Work / My Inbox items ---- */

function vcFactsOf_(pairs) {
  var out = [];
  pairs.forEach(function (p) {
    if (out.length >= 12) return;
    var label = vcText_(p[0], 40), value = vcText_(p[1], 240);
    if (label && value) out.push({ label: label, value: value });
  });
  return out;
}

/** One row per recipient per trip per kind: a second telling of the same kind replaces the first. */
function vcInboxRow_(trip, box, kind, seat, to, title, body, facts, link) {
  return {
    id: 'VI' + vcSha10_(trip.id + '|' + box + '|' + kind + '|' + to.uid), trip_id: trip.id, box: box, kind: kind,
    seat: seat, to_uid: vcStr_(to.uid), to_email: vcStr_(to.email), to_name: vcStr_(to.name),
    title: vcText_(title, 200), body: vcText_(body, 300), facts: JSON.stringify(facts || []), date: trip.day,
    when: vcWhenWords_(trip.start_at, trip.end_at), state: box === 'work' ? 'waiting' : 'posted', answered_by: '',
    answered_at: '', note: '', link: link, test_mode: vcTestWord_(), created_at: vcNowIso_()
  };
}

/** The requester's My Inbox informative about their trip. */
function vcRequesterItem_(trip, title, body) {
  if (!vcStr_(trip.requested_by_uid)) return null;
  return vcInboxRow_(trip, 'inbox', 'info', 'requester',
                     { uid: trip.requested_by_uid, name: trip.requested_by_name, email: '' }, title, body, [],
                     vcTripLink_(trip.id));
}

function vcVehicleName_(vehicles, id) {
  var v = vcVehicleIndex_(vehicles)[id];
  return v ? vcStr_(v.name) : '';
}

/* ---- the rules a booking keeps ---- */

/** The accessible vehicles named in the refusal: 'choose the Van', 'choose the Van or the Bus'. */
function vcNotAccessible_(name, vehicles) {
  var ok = vehicles.filter(function (v) {
    return vcYes_(v.wheelchair_accessible) && vcAvailabilityOf_(v.availability) === 'available';
  }).map(function (v) { return 'the ' + vcStr_(v.name); });
  return 'The ' + name + ' is not wheelchair accessible — ' +
         (ok.length ? 'choose ' + ok.join(' or ') + '.' : 'no accessible vehicle is in service.');
}

// Why `trip` cannot hold `vehicleId` as a scheduled trip, or null: the vehicle's availability, wheelchair access, a…
function vcScheduleBlock_(trip, vehicleId, vehicles, trips) {
  if (!vehicleId) return { status: 400, message: 'Choose a vehicle to schedule the trip.', phrase: 'no vehicle was chosen', fix: 'vehicle' };
  var v = vcVehicleIndex_(vehicles)[vehicleId];
  if (!v) return { status: 400, message: 'Choose a vehicle.', phrase: 'the requested vehicle is no longer on the list', fix: 'vehicle' };
  var name = vcStr_(v.name), avail = vcAvailabilityOf_(v.availability);
  if (avail === 'maintenance') {
    return { status: 409, message: 'The ' + name + ' is in maintenance — choose another vehicle.',
             phrase: 'the ' + name + ' is in maintenance', fix: 'vehicle' };
  }
  if (avail === 'out_of_service') {
    return { status: 409, message: 'The ' + name + ' is out of service — choose another vehicle.',
             phrase: 'the ' + name + ' is out of service', fix: 'vehicle' };
  }
  if (vcYes_(trip.wheelchair_required) && !vcYes_(v.wheelchair_accessible)) {
    return { status: 400, message: vcNotAccessible_(name, vehicles), phrase: 'the ' + name + ' is not wheelchair accessible',
             fix: 'vehicle' };
  }
  var span = vcSpanOf_(trip);
  var hit = null;
  trips.forEach(function (o) {
    if (hit || o.id === trip.id || o.state !== 'scheduled' || o.vehicle_id !== vehicleId) return;
    if (vcOverlap_(span, vcSpanOf_(o))) hit = o;
  });
  if (hit) {
    return { status: 409, message: 'The ' + name + ' is booked ' + vcWhenWords_(hit.start_at, hit.end_at) +
                                   ' — choose another vehicle or time.',
             phrase: 'the ' + name + ' was booked by then', fix: 'vehicle' };
  }
  if (vcStr_(trip.driver_key)) {
    var drv = null;
    trips.forEach(function (o) {
      if (drv || o.id === trip.id || o.state !== 'scheduled' || o.driver_key !== trip.driver_key) return;
      if (vcOverlap_(span, vcSpanOf_(o))) drv = o;
    });
    if (drv) {
      var who = vcStr_(trip.driver_name) || 'The driver';
      return { status: 409, message: who + ' already drives the ' + (vcVehicleName_(vehicles, drv.vehicle_id) || 'other vehicle') +
                                     ' then (' + vcSpanWords_(drv.start_at, drv.end_at) + ').',
               phrase: who + ' already drives another trip then', fix: 'driver' };
    }
  }
  return null;
}

// The request's refusals, in their order, over what it is handed (fresh vehicles and trips under the lock, the…
function vcRequestCheck_(f, c) {
  var vehicles = c.vehicles, trips = c.trips;
  var v = vcVehicleIndex_(vehicles)[f.vehicle_id];
  if (!f.vehicle_id || !v) return vcRefuse_(400, 'Choose a vehicle.');
  if (!c.people || !c.people.readable) {
    return vcRefuse_(503, 'The staff list could not be read just now (' + vcStr_(c.people && c.people.why) + ').');
  }
  var staff = c.people.byKey[f.staff_key];
  if (!f.staff_key || !staff) return vcRefuse_(400, 'Choose a staff member.');
  if (!f.trip_type || (c.settings.trip_types || []).indexOf(f.trip_type) === -1) return vcRefuse_(400, 'Choose a trip type.');
  var s = vcWallToMs_(f.start);
  if (!s.ms) return vcRefuse_(400, s.message === 'Choose a date and a time.' ? 'Choose a start date and time.' : s.message);
  var e = vcWallToMs_(f.end);
  if (!e.ms) return vcRefuse_(400, e.message === 'Choose a date and a time.' ? 'Choose an end date and time.' : e.message);
  if (e.ms <= s.ms) return vcRefuse_(400, 'The end must be after the start.');
  if (e.ms - s.ms > VC_MAX_SPAN_MS) return vcRefuse_(400, 'A reservation can be at most 14 days.');
  if (s.ms < c.now - VC_LATE_MS) return vcRefuse_(400, 'That start has already passed.');
  var name = vcStr_(v.name), avail = vcAvailabilityOf_(v.availability);
  if (avail === 'maintenance') return vcRefuse_(409, 'The ' + name + ' is in maintenance — choose another vehicle.');
  if (avail === 'out_of_service') return vcRefuse_(409, 'The ' + name + ' is out of service — choose another vehicle.');
  if (f.wheelchair_required && !vcYes_(v.wheelchair_accessible)) return vcRefuse_(400, vcNotAccessible_(name, vehicles));
  var span = { s: s.ms, e: e.ms };
  var booked = null, pending = null, mine = null;
  trips.forEach(function (t) {
    var sp = vcSpanOf_(t);
    if (!vcOverlap_(span, sp)) return;
    if (!booked && t.state === 'scheduled' && t.vehicle_id === v.id) booked = t;
    if (!pending && t.state === 'requested' && t.requested_vehicle_id === v.id) pending = t;
    if (!mine && (t.state === 'scheduled' || t.state === 'requested') &&
        (t.staff_key === staff.key || t.driver_key === staff.key)) mine = t;
  });
  if (booked) {
    return vcRefuse_(409, 'The ' + name + ' is booked ' + vcWhenWords_(booked.start_at, booked.end_at) +
                          ' — choose another vehicle or time.');
  }
  if (mine) {
    var other = vcVehicleName_(vehicles, mine.state === 'scheduled' ? mine.vehicle_id : mine.requested_vehicle_id) || 'a vehicle';
    return vcRefuse_(409, staff.name + ' already has a trip then (' + other + ', ' + vcSpanWords_(mine.start_at, mine.end_at) + ').');
  }
  var client = null;
  if (f.client_key) {
    if (!c.clients || !c.clients.readable) {
      return vcRefuse_(503, 'The client list could not be read just now (' + vcStr_(c.clients && c.clients.why) + ').');
    }
    (c.clients.rows || []).forEach(function (x) { if (x.key === f.client_key) client = x; });
    if (!client) return vcRefuse_(400, 'Choose a client from the list.');
  }
  if (String(f.details || '').length > 1000) return vcRefuse_(400, 'Trip details can be at most 1000 characters.');
  var warnings = [];
  if (pending) warnings.push('Another request for the ' + name + ' is waiting for the same time — the first one approved gets it.');
  return { ok: true, vehicle: v, staff: staff, client: client, s: s.ms, e: e.ms, warnings: warnings };
}

function vcNamesWords_(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

/* ---- the request ---- */

HUB_POLICY.vehicleCalendarRequest = {
  file: 'VehicleCalendarFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { vehicle_id: { type: 'string' }, staff_key: { type: 'string' }, start: { type: 'string' },
            end: { type: 'string' }, client_key: { type: 'string' }, trip_type: { type: 'string' },
            details: { type: 'string' }, wheelchair_required: { type: 'boolean' } }
};
/** A staff member asks for a vehicle: the directors get it in My Work and by text; the first answer decides. */
HUB_ACTIONS.vehicleCalendarRequest = function (payload, user) {
  var g = vcGate_(user);
  if (!g.open) return vcClosed_();
  if (g.visiting) return vcRefuse_(403, VC_VISITING_SENTENCE);
  var p = payload || {};
  var form = {
    vehicle_id: vcText_(p.vehicle_id, 20), staff_key: vcText_(p.staff_key, 120), start: vcStr_(p.start),
    end: vcStr_(p.end), client_key: vcText_(p.client_key, 120), trip_type: vcText_(p.trip_type, 60),
    details: String(p.details == null ? '' : p.details).trim(),
    wheelchair_required: p.wheelchair_required === true || vcYes_(p.wheelchair_required)
  };
  var said = null, owed = [], tripId = '';
  try {
    var st = vcSettings_();
    if (!st.directors_readable) {
      return vcRefuse_(503, 'Nobody is set to approve vehicle requests: ' + (vcStr_(st.directors_why) || 'the list is empty.'));
    }
    var people = vcPeople_();
    var clients = form.client_key ? vcClients_() : null;
    var requesterPhone = vcAccountPhones_(vcAccount_(g.uid))[0] || '';
    var done = vcLock_(function () {
      var vehicles = vcRead_(VC_TABS.vehicles), trips = vcRead_(VC_TABS.trips);
      var ok = vcRequestCheck_(form, { vehicles: vehicles, trips: trips, people: people, clients: clients, settings: st,
                                       now: vcNow_() });
      if (ok.status) return ok;
      var askable = st.directors.filter(function (d) { return d.uid !== g.uid; });
      if (!askable.length) return vcRefuse_(409, 'Nobody else can approve this request.');
      var nowIso = vcNowIso_();
      var trip = {
        id: vcNewId_('VT'), state: 'requested', vehicle_id: '', requested_vehicle_id: ok.vehicle.id,
        start_at: vcIso_(ok.s), end_at: vcIso_(ok.e), day: vcDayOf_(ok.s), end_known: 'yes',
        wheelchair_required: vcWord_(form.wheelchair_required), trip_type: form.trip_type, purpose: form.trip_type,
        destination: '', details: vcStr_(form.details), client_key: ok.client ? ok.client.key : '',
        client_name: ok.client ? ok.client.name : '', staff_key: ok.staff.key, staff_uid: ok.staff.uid,
        staff_name: ok.staff.name, driver_key: ok.staff.key, driver_uid: ok.staff.uid, driver_name: ok.staff.name,
        requested_by_uid: g.uid, requested_by_name: g.name, decided_by_uid: '', decided_by_name: '', decided_at: '',
        decision_note: '', assign_note: '', appointment_ref: '', source: 'platform', source_ref: '', told: '{}',
        test_mode: vcTestWord_(), created_at: nowIso, created_by: g.uid, updated_at: nowIso, updated_by: g.uid
      };
      var vname = vcStr_(ok.vehicle.name);
      var when = vcWhenWords_(trip.start_at, trip.end_at);
      var facts = vcFactsOf_([
        ['Requested by', g.name + (requesterPhone ? ' · ' + vcPhoneWords_(requesterPhone) : '')], ['Vehicle', vname],
        ['When', when], ['Staff', ok.staff.name], ['Client', trip.client_name], ['Trip type', trip.trip_type],
        ['Wheelchair-accessible vehicle', form.wheelchair_required ? 'Yes' : 'No'], ['Details', trip.details]
      ]);
      var items = askable.map(function (d) {
        return vcInboxRow_(trip, 'work', 'approval', 'director', d, 'Vehicle request — ' + g.name,
                           vname + ' · ' + when + ' · ' + trip.trip_type, facts, '/app/my-work');
      });
      var vars = { requester: g.name, requester_phone: requesterPhone ? vcPhoneWords_(requesterPhone) : '',
                   vehicle: vname, when: vcWhenWords_(trip.start_at, trip.end_at, true), staff: ok.staff.name,
                   client: trip.client_name, trip_type: trip.trip_type,
                   wheelchair: form.wheelchair_required ? 'Yes' : 'No', details: vcText_(trip.details, 140),
                   link: vcLink_('/app/my-work') };
      var told = {};
      askable.forEach(function (d) { vcOwe_(told, vcOwed_('transport_request_ask', 'ask', trip, d, vars, 'requested')); });
      trip.told = JSON.stringify(told);
      vcUpsert_(VC_TABS.trips, [trip]);
      vcUpsert_(VC_TABS.inbox, items);
      vcAppend_(VC_TABS.log, [vcLogRow_(g, trip.id, ok.vehicle.id, 'request', '', {
        state: 'requested', vehicle: vname, start_at: trip.start_at, end_at: trip.end_at }, '')]);
      vcDueLower_(vcNow_() + VC_RETRY_MS);
      return { trip: trip, owed: told.owed, warnings: ok.warnings, askable: askable };
    });
    if (!done || done.status) return done || vcFail_('no answer from the lock');
    tripId = done.trip.id;
    owed = done.owed;
    said = 'Requested. ' + vcNamesWords_(done.askable.map(function (d) { return d.name; })) +
           (done.askable.length === 1 ? ' has it.' : ' have it — the first answer decides.');
    var results = vcSendOwed_(tripId, owed, 'requested');
    vcToldRecord_(results);
    var words = vcTextWords_(results);
    var warnings = done.warnings.slice();
    if (words) warnings.push(words);
    try { hubSysLog_(vcStr_(user && user.email), 'vehicleCalendarRequest', tripId, { status: 200 }); } catch (eL) {}
    return vcAnswerAfter_(g, { said: said, trip_id: tripId, warnings: warnings });
  } catch (e) {
    return vcFail_(e);
  }
};

/* ---- the answer: gated by the SEAT, never by the app ---- */

HUB_POLICY.vehicleCalendarAnswer = {
  file: 'VehicleCalendarFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { item_id: { type: 'string' }, word: { type: 'string' }, note: { type: 'string' } }
};
// A director's approve or decline from My Work (or the app's trip panel): the session's own account must be the…
HUB_ACTIONS.vehicleCalendarAnswer = function (payload, user) {
  var p = payload || {};
  var got = vcAnswerItem_(user, p.item_id, p.word, p.note);
  if (!got || got.status !== 200) return got;
  var g = vcGate_(user);
  if (g.open && !g.visiting) {
    try { got.data.board = vcBoard_(g); }
    catch (e) { got.data.reread = 'Answered — but the calendar could not be read back just now; refresh to see it.'; }
  }
  return got;
};

/** The one answer door: HUB_ACTIONS.vehicleCalendarAnswer and Support Requests (vcSupportDecide_) both call it. */
function vcAnswerItem_(user, itemId, word, note) {
  var id = vcText_(itemId, 20);
  if (!VC_ITEM_ID.test(id)) return vcRefuse_(400, 'Unknown item.');
  if (vcVisiting_(user)) return vcRefuse_(403, 'Answer from your own account — not while visiting someone else.');
  var me = hubActingUserId_(user);
  if (!me) return vcRefuse_(403, 'Answer from your own account — not while visiting someone else.');
  var w = vcStr_(word).toLowerCase();
  if (w !== 'approve' && w !== 'decline') return vcRefuse_(400, 'Answer with approve or decline.');
  var n = String(note == null ? '' : note).trim();
  if (n.length > 500) return vcRefuse_(400, 'A note can be at most 500 characters.');
  var name = vcUserName_(user);
  var master = false;
  try { master = !!hubIsRealMaster_(user); } catch (eM) { master = false; }
  try {
    var out = vcLock_(function () { return vcAnswerLocked_(id, w, vcText_(n, 500), me, name, master); });
    if (!out || out.status) return out || vcFail_('no answer from the lock');
    if (out.changed === false) {
      return { status: 200, data: { ok: true, changed: false, said: out.said, state: out.state, trip_id: out.trip_id } };
    }
    var said = out.said;
    if (out.owed && out.owed.length) {
      var results = vcSendOwed_(out.trip_id, out.owed, '');
      vcToldRecord_(results);
      var words = vcTextWords_(results);
      if (words) said += ' ' + words;
    }
    try { hubSysLog_(vcStr_(user && user.email), 'vehicleCalendarAnswer', id + ' ' + w, { status: 200 }); } catch (eL) {}
    return { status: 200, data: { ok: true, changed: true, said: said, state: out.state, trip_state: out.trip_state,
                                  trip_id: out.trip_id } };
  } catch (e) {
    return vcFail_(e);
  }
}

function vcAnswerLocked_(itemId, word, note, me, name, master) {
  var nowIso = vcNowIso_();
  var inbox = vcRead_(VC_TABS.inbox);
  var item = null;
  inbox.forEach(function (r) { if (r.id === itemId) item = r; });
  if (!item || item.box !== 'work') return vcRefuse_(404, 'This request is not on the calendar any more.');
  // the master is an eligible decider on every director seat, the answer recorded as the master's
  if (vcStr_(item.to_uid) !== me && !(master && vcStr_(item.seat) === 'director')) {
    return vcRefuse_(403, 'This one is waiting on ' + (vcStr_(item.to_name) || 'someone else') + '.');
  }
  var trips = vcRead_(VC_TABS.trips);
  var trip = null;
  trips.forEach(function (t) { if (t.id === item.trip_id) trip = t; });
  if (!trip) return vcRefuse_(404, 'The request behind this item is gone.');
  if (vcStr_(trip.requested_by_uid) === me) return vcRefuse_(403, 'Nobody answers their own request.');
  if (item.state !== 'waiting' || trip.state !== 'requested') {
    var gone = item.state === 'closed' || trip.state === 'cancelled';
    if (item.state === 'waiting') {
      item.state = gone ? 'closed' : 'superseded';
      item.answered_by = gone ? vcStr_(trip.requested_by_name) : vcStr_(trip.decided_by_name);
      item.answered_at = nowIso;
      vcUpsert_(VC_TABS.inbox, [item]);
    }
    return { changed: false, trip_id: trip.id, state: item.state,
             said: gone ? 'The request was withdrawn.'
                        : 'Already answered by ' + (vcStr_(item.answered_by) || vcStr_(trip.decided_by_name) || 'someone') + '.' };
  }
  var vehicles = vcRead_(VC_TABS.vehicles);
  var vname = vcVehicleName_(vehicles, trip.requested_vehicle_id) || 'vehicle';
  var when = vcWhenWords_(trip.start_at, trip.end_at);
  var was = { state: trip.state, vehicle_id: trip.vehicle_id };
  var said, title, body, result;
  if (word === 'approve') {
    var block = vcScheduleBlock_(trip, trip.requested_vehicle_id, vehicles, trips);
    if (!block) {
      trip.state = 'scheduled';
      trip.vehicle_id = trip.requested_vehicle_id;
      trip.assign_note = '';
      said = 'Approved. The trip is on the calendar with the ' + vname + '.';
      body = vname + ' · ' + when + '. Approved by ' + name + '.';
      result = 'approved';
    } else {
      trip.state = 'needs_assignment';
      trip.vehicle_id = '';
      trip.assign_note = 'Approved, but ' + block.phrase + ' — choose a ' + (block.fix === 'driver' ? 'driver' : 'vehicle') + '.';
      said = 'Approved, but ' + block.phrase + ' — the trip waits in Needs assignment.';
      body = vname + ' · ' + when + '. Approved by ' + name + '. A vehicle will be assigned.';
      result = 'approved - a vehicle will be assigned';
    }
    title = 'Your vehicle request was approved';
  } else {
    trip.state = 'declined';
    trip.vehicle_id = '';
    said = 'Declined.' + (vcStr_(trip.requested_by_name) ? ' ' + trip.requested_by_name + ' is told.' : '');
    title = 'Your vehicle request was declined';
    body = vname + ' · ' + when + '. Declined by ' + name + '.' + (note ? ' Note: ' + note : '');
    result = 'declined';
  }
  trip.decided_by_uid = me;
  trip.decided_by_name = name;
  trip.decided_at = nowIso;
  trip.decision_note = note;
  trip.updated_at = nowIso;
  trip.updated_by = me;
  var owed = [];
  if (vcStr_(trip.requested_by_uid)) {
    var told = vcJson_(trip.told, {});
    var entry = vcOwed_('transport_request_decided', 'decided', trip,
                        { uid: trip.requested_by_uid, name: trip.requested_by_name }, {
                          vehicle: vname, when: vcWhenWords_(trip.start_at, trip.end_at, true), result: result, by: name,
                          note: note, link: vcLink_(vcTripLink_(trip.id)) }, '');
    vcOwe_(told, entry);
    told.owed = (told.owed || []).filter(function (o) { return o.bucket !== 'ask'; });
    trip.told = JSON.stringify(told);
    owed.push(entry);
  }
  vcUpsert_(VC_TABS.trips, [trip]);
  item.state = word === 'approve' ? 'approved' : 'declined';
  item.answered_by = name;
  item.answered_at = nowIso;
  item.note = note;
  var settle = [item];
  inbox.forEach(function (r) {
    if (r.id === item.id || r.trip_id !== trip.id || r.box !== 'work' || r.state !== 'waiting') return;
    r.state = 'superseded';
    r.answered_by = name;
    r.answered_at = nowIso;
    settle.push(r);
  });
  var info = vcRequesterItem_(trip, title, body);
  if (info) settle.push(info);
  vcUpsert_(VC_TABS.inbox, settle);
  vcAppend_(VC_TABS.log, [vcLogRow_({ uid: me, name: name }, trip.id, trip.requested_vehicle_id, 'answer', was,
                                    { answer: item.state, state: trip.state, vehicle_id: trip.vehicle_id }, note)]);
  if (owed.length) vcDueLower_(vcNow_() + VC_RETRY_MS);
  return { changed: true, said: said, state: item.state, trip_state: trip.state, trip_id: trip.id, owed: owed };
}

/* ---- the requester withdraws ---- */

HUB_POLICY.vehicleCalendarWithdraw = {
  file: 'VehicleCalendarFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { trip_id: { type: 'string' } }
};
/** The requester takes back a request nobody answered yet; the waiting items close; nobody is texted. */
HUB_ACTIONS.vehicleCalendarWithdraw = function (payload, user) {
  var g = vcGate_(user);
  if (!g.open) return vcClosed_();
  if (g.visiting) return vcRefuse_(403, VC_VISITING_SENTENCE);
  var tripId = vcText_((payload || {}).trip_id, 20);
  if (!VC_TRIP_ID.test(tripId)) return vcRefuse_(400, 'Which request? The trip id is missing.');
  try {
    var done = vcLock_(function () {
      var trip = null;
      vcRead_(VC_TABS.trips).forEach(function (t) { if (t.id === tripId) trip = t; });
      if (!trip) return vcRefuse_(404, 'That request is not on the calendar any more.');
      if (!g.uid || vcStr_(trip.requested_by_uid) !== g.uid) return vcRefuse_(403, 'Only the person who asked can withdraw it.');
      if (trip.state !== 'requested') {
        return vcRefuse_(409, 'This request is no longer waiting (' + vcTripWord_(trip, vcNow_()).word + ').');
      }
      var nowIso = vcNowIso_();
      trip.state = 'cancelled';
      trip.vehicle_id = '';
      trip.updated_at = nowIso;
      trip.updated_by = g.uid;
      var told = vcJson_(trip.told, {});
      told.owed = (told.owed || []).filter(function (o) { return o.bucket !== 'ask'; });
      trip.told = JSON.stringify(told);
      vcUpsert_(VC_TABS.trips, [trip]);
      var closed = vcRead_(VC_TABS.inbox).filter(function (r) {
        return r.trip_id === trip.id && r.box === 'work' && r.state === 'waiting';
      });
      closed.forEach(function (r) { r.state = 'closed'; r.answered_by = g.name; r.answered_at = nowIso; });
      if (closed.length) vcUpsert_(VC_TABS.inbox, closed);
      vcAppend_(VC_TABS.log, [vcLogRow_(g, trip.id, trip.requested_vehicle_id, 'withdraw', { state: 'requested' },
                                        { state: 'cancelled' }, '')]);
      return { said: 'Withdrawn.', trip_id: trip.id };
    });
    return vcAnswerAfter_(g, done);
  } catch (e) {
    return vcFail_(e);
  }
};

/* ---- the directors' trip panel: details, vehicle, driver, status ---- */

function vcHas_(p, k) { return Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined && p[k] !== null; }

HUB_POLICY.vehicleCalendarTripSave = {
  file: 'VehicleCalendarFlows.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: ['smsSend'],
  params: { trip_id: { type: 'string' }, status: { type: 'string' }, vehicle_id: { type: 'string' },
            staff_key: { type: 'string' }, driver_key: { type: 'string' }, start: { type: 'string' },
            end: { type: 'string' }, wheelchair_required: { type: 'boolean' }, trip_type: { type: 'string' },
            purpose: { type: 'string' }, destination: { type: 'string' }, details: { type: 'string' },
            client_key: { type: 'string' }, note: { type: 'string' }, client: { type: 'string' } }
};
// The directors' "Trip details & assignment": edit a trip, schedule it on a vehicle and driver that are free (never…
HUB_ACTIONS.vehicleCalendarTripSave = function (payload, user) {
  var p = payload || {};
  // `client`: opened from that client's page (vcClientGate_), so only that client's trip is changed
  var g = vcClientGate_(vcGate_(user), user, vcText_(p.client, 120));
  if (!g.open) return vcClosed_();
  if (g.visiting) return vcRefuse_(403, VC_VISITING_SENTENCE);
  if (!g.can_edit && !g.client) return vcRefuse_(403, 'Only the directors assign trips.');
  if (!g.can_edit && vcHas_(p, 'client_key') && vcText_(p.client_key, 120) !== g.client) {
    return vcRefuse_(403, 'A trip changed from a client\'s page stays with that client.');
  }
  var tripId = vcText_(p.trip_id, 20);
  if (!VC_TRIP_ID.test(tripId)) return vcRefuse_(400, 'Which trip? The trip id is missing.');
  var status = vcStr_(p.status);
  if (status && ['scheduled', 'needs_assignment', 'cancelled'].indexOf(status) === -1) {
    return vcRefuse_(400, 'A trip is set to Scheduled, Needs assignment or Cancelled.');
  }
  var lens = { purpose: 200, destination: 300, details: 1000, note: 500 };
  for (var k in lens) {
    if (vcHas_(p, k) && String(p[k]).length > lens[k]) {
      return vcRefuse_(400, k.charAt(0).toUpperCase() + k.slice(1) + ' can be at most ' + lens[k] + ' characters.');
    }
  }
  try {
    var st = vcSettings_();
    var needPeople = vcHas_(p, 'staff_key') || vcHas_(p, 'driver_key');
    var people = needPeople ? vcPeople_() : null;
    if (needPeople && !people.readable) return vcRefuse_(503, 'The staff list could not be read just now (' + people.why + ').');
    var clientKey = vcHas_(p, 'client_key') ? vcText_(p.client_key, 120) : null;
    var clients = clientKey ? vcClients_() : null;
    if (clients && !clients.readable) return vcRefuse_(503, 'The client list could not be read just now (' + clients.why + ').');
    var before = null;
    vcRows_().trips.forEach(function (t) { if (t.id === tripId) before = t; });
    var driverKeys = [vcText_(p.driver_key, 120), before ? before.driver_key : ''].filter(String);
    var drivers = driverKeys.length ? vcDrivers_(driverKeys) : { readable: false, map: {} };
    var done = vcLock_(function () {
      var trips = vcRead_(VC_TABS.trips), vehicles = vcRead_(VC_TABS.vehicles);
      var vById = vcVehicleIndex_(vehicles);
      var t = null;
      trips.forEach(function (x) { if (x.id === tripId) t = x; });
      if (!t) return vcRefuse_(404, 'That trip is not on the calendar any more.');
      if (g.client && t.client_key !== g.client) {
        return vcRefuse_(409, 'This trip is not this client\'s any more (it has moved) — nothing was changed.');
      }
      if (t.state === 'declined' || t.state === 'cancelled') {
        return vcRefuse_(409, 'This trip was ' + t.state + ' — nothing to change.');
      }
      if (t.state === 'requested' && status) {
        return vcRefuse_(400, 'A waiting request is approved or declined by the directors — not set here.');
      }
      var was = vcCopy_(t);
      var warnings = [];
      var vehicleId = null;
      if (vcHas_(p, 'vehicle_id')) {
        vehicleId = vcText_(p.vehicle_id, 20);
        if (vehicleId && !vById[vehicleId]) return vcRefuse_(400, 'Choose a vehicle.');
        if (vehicleId) t.requested_vehicle_id = vehicleId;
      }
      if (vcHas_(p, 'staff_key')) {
        var sp = people.byKey[vcText_(p.staff_key, 120)];
        if (!sp) return vcRefuse_(400, 'Choose a staff member.');
        t.staff_key = sp.key; t.staff_uid = sp.uid; t.staff_name = sp.name;
      }
      if (vcHas_(p, 'driver_key')) {
        var dk = vcText_(p.driver_key, 120);
        var dp = dk ? people.byKey[dk] : null;
        if (dk && !dp) return vcRefuse_(400, 'Choose a driver.');
        t.driver_key = dp ? dp.key : ''; t.driver_uid = dp ? dp.uid : ''; t.driver_name = dp ? dp.name : '';
      }
      if (vcStr_(p.start) || vcStr_(p.end)) {
        var s = vcStr_(p.start) ? vcWallToMs_(p.start) : { ms: vcMs_(t.start_at) };
        if (!s.ms) return vcRefuse_(400, s.message === 'Choose a date and a time.' ? 'Choose a pickup date and time.' : s.message);
        var e = vcStr_(p.end) ? vcWallToMs_(p.end) : { ms: vcMs_(t.end_at) };
        if (!e.ms) return vcRefuse_(400, e.message === 'Choose a date and a time.' ? 'Choose a return date and time.' : e.message);
        if (e.ms <= s.ms) return vcRefuse_(400, 'The end must be after the start.');
        if (e.ms - s.ms > VC_MAX_SPAN_MS) return vcRefuse_(400, 'A reservation can be at most 14 days.');
        t.start_at = vcIso_(s.ms); t.end_at = vcIso_(e.ms); t.day = vcDayOf_(s.ms);
        if (vcStr_(p.end)) t.end_known = 'yes';
      }
      if (vcHas_(p, 'wheelchair_required')) t.wheelchair_required = vcWord_(p.wheelchair_required === true || vcYes_(p.wheelchair_required));
      if (vcHas_(p, 'trip_type')) {
        var tt = vcText_(p.trip_type, 60);
        if (tt && (st.trip_types || []).indexOf(tt) === -1 && tt !== t.trip_type) return vcRefuse_(400, 'Choose a trip type.');
        t.trip_type = tt;
      }
      if (vcHas_(p, 'purpose')) t.purpose = vcText_(p.purpose, 200);
      if (vcHas_(p, 'destination')) t.destination = vcText_(p.destination, 300);
      if (vcHas_(p, 'details')) t.details = String(p.details).trim();
      if (clientKey !== null) {
        var cl = null;
        if (clientKey) (clients.rows || []).forEach(function (x) { if (x.key === clientKey) cl = x; });
        if (clientKey && !cl) return vcRefuse_(400, 'Choose a client from the list.');
        t.client_key = cl ? cl.key : ''; t.client_name = cl ? cl.name : '';
      }
      var note = vcHas_(p, 'note') ? vcText_(p.note, 500) : null;
      var target = status || t.state;
      var said = 'Saved.', via = 'assign', owed = [];
      var nowIso = vcNowIso_();
      if (target === 'scheduled') {
        var vid = vehicleId !== null && vehicleId ? vehicleId : (t.vehicle_id || t.requested_vehicle_id);
        var block = vcScheduleBlock_(t, vid, vehicles, trips);
        if (block) return vcRefuse_(block.status, block.message);
        if (vcStr_(t.driver_key)) {
          var dw = (drivers.map || {})[t.driver_key];
          if (dw && dw.may_drive === false) {
            return vcRefuse_(409, (vcStr_(t.driver_name) || 'The driver') + ' is not cleared to drive (Employee Database).');
          }
          if (!dw || dw.may_drive === null) {
            warnings.push((vcStr_(t.driver_name) || 'The driver') + '\'s driving record could not be confirmed in the ' +
                          'Employee Database — check it before the trip.');
          }
        } else {
          warnings.push('No driver is set for this trip.');
        }
        t.state = 'scheduled';
        t.vehicle_id = vid;
        t.assign_note = note !== null ? note : (was.state === 'scheduled' ? t.assign_note : '');
        said = 'Saved. The trip is scheduled with the ' + vcVehicleName_(vehicles, vid) + '.';
      } else if (target === 'needs_assignment') {
        t.state = 'needs_assignment';
        t.vehicle_id = '';
        if (note !== null) t.assign_note = note;
        else if (was.state !== 'needs_assignment') t.assign_note = 'Returned to Needs assignment by ' + g.name + '.';
        said = was.state === 'needs_assignment' ? 'Saved.' : 'Saved. The trip is back in Needs assignment.';
      } else if (target === 'cancelled') {
        t.state = 'cancelled';
        t.vehicle_id = '';
        if (note !== null) t.assign_note = note;
        via = 'cancel';
        var vname = vcVehicleName_(vehicles, was.vehicle_id || t.requested_vehicle_id) || 'vehicle';
        var info = vcRequesterItem_(t, 'Your trip was cancelled', vname + ' · ' + vcWhenWords_(t.start_at, t.end_at) +
                                    '. Cancelled by ' + g.name + '.');
        if (info) vcUpsert_(VC_TABS.inbox, [info]);
        if (vcStr_(t.requested_by_uid)) {
          var told = vcJson_(t.told, {});
          var entry = vcOwed_('transport_trip_cancelled', 'cancelled', t, { uid: t.requested_by_uid, name: t.requested_by_name },
                              { vehicle: vname, when: vcWhenWords_(t.start_at, t.end_at, true), by: g.name, note: note || '' },
                              'cancelled');
          vcOwe_(told, entry);
          t.told = JSON.stringify(told);
          owed.push(entry);
        }
        said = 'Cancelled.' + (vcStr_(t.requested_by_name) && vcStr_(t.requested_by_uid) ? ' ' + t.requested_by_name + ' is told.' : '');
      } else if (note !== null) {
        t.assign_note = note;
      }
      var fields = ['state', 'vehicle_id', 'requested_vehicle_id', 'start_at', 'end_at', 'wheelchair_required', 'trip_type',
                    'purpose', 'destination', 'details', 'client_key', 'staff_key', 'driver_key', 'assign_note'];
      var a = {}, b = {};
      fields.forEach(function (f) { if (vcStr_(was[f]) !== vcStr_(t[f])) { a[f] = was[f]; b[f] = t[f]; } });
      if (!Object.keys(b).length) return { said: 'Nothing changed.', trip_id: t.id, warnings: warnings, fields: [] };
      t.updated_at = nowIso;
      t.updated_by = g.uid;
      vcUpsert_(VC_TABS.trips, [t]);
      vcAppend_(VC_TABS.log, [vcLogRow_(g, t.id, t.vehicle_id || t.requested_vehicle_id, via, a, b, note || '')]);
      if (owed.length) vcDueLower_(vcNow_() + VC_RETRY_MS);
      return { said: said, trip_id: t.id, warnings: warnings, owed: owed, fields: Object.keys(b) };
    });
    if (!done || done.status) return done || vcFail_('no answer from the lock');
    if (done.owed && done.owed.length) {
      var results = vcSendOwed_(done.trip_id, done.owed, 'cancelled');
      vcToldRecord_(results);
      var words = vcTextWords_(results);
      if (words) done.warnings.push(words);
    }
    delete done.owed;
    try { hubSysLog_(vcStr_(user && user.email), 'vehicleCalendarTripSave', done.trip_id, { status: 200 }); } catch (eL) {}
    var fields = done.fields || [];
    delete done.fields;
    var got = vcAnswerAfter_(g, done);
    if (!g.client || !got || got.status !== 200) return got;
    // from a client's page: the fields the trip's row took, and the Apply strip's words
    got.data.written = fields;
    return typeof cpEditSteps_ === 'function' ? cpEditSteps_(got, 'transport') : got;
  } catch (e) {
    return vcFail_(e);
  }
};

/* ---- the clock ---- */

// Called from hiringSweep on every ring.
function vcClockTick_() {
  var nowMs = vcNow_();
  try {
    var due = CacheService.getScriptCache().get(VC_DUE_KEY);
    if (due !== null && due !== undefined && due !== '' && Number(due) > nowMs) return { ran: false, due: Number(due) };
  } catch (e) { return { ran: false, why: 'the cache could not be read' }; }
  if (vcQuiet_(nowMs)) { vcDuePut_(vcNext8_(nowMs), nowMs); return { ran: false, why: 'quiet hours' }; }
  var started = Date.now();
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(0); } catch (eL) { got = false; }
  if (!got) return { ran: false, why: 'the lock is busy' };
  var owed = [];
  try {
    vcMemoFresh_();
    vcRead_(VC_TABS.trips).forEach(function (t) {
      var told = vcJson_(t.told, {});
      if ((told.owed || []).length) owed.push({ id: t.id, state: t.state, owed: told.owed });
    });
  } catch (e2) {
    vcDuePut_(nowMs + VC_RETRY_MS, nowMs);
    return { ran: false, why: vcErr_(e2) };
  } finally {
    try { lock.releaseLock(); } catch (eR) {}
  }
  if (!owed.length) { vcDuePut_(nowMs + 21600000, nowMs); return { ran: true, said: 0 }; }
  var results = [], left = 0;
  owed.forEach(function (o) {
    if (Date.now() - started > VC_TICK_BUDGET_MS) { left += o.owed.length; return; }
    results = results.concat(vcSendOwed_(o.id, o.owed, o.state));
  });
  var written = vcToldRecord_(results, 5000);
  var quiet = results.some(function (r) { return r.res.held === 'quiet'; });
  vcDuePut_(left || !written ? nowMs + VC_RETRY_MS : (quiet ? vcNext8_(nowMs) : nowMs + 21600000), nowMs);
  return { ran: true, said: results.length, left: left, recorded: written };
}

/* ---- Support Requests decides through the same door ---- */

/** approve / deny on a vehicle request from the Support Requests queue: the viewer's own waiting item, answered here. */
function vcSupportDecide_(ref, verdict, note, user) {
  var id = vcText_(ref, 20);
  if (!VC_TRIP_ID.test(id)) return vcRefuse_(404, 'That request is not on the queue any more.');
  var word = { approve: 'approve', deny: 'decline' }[vcStr_(verdict).toLowerCase()];
  if (!word) return vcRefuse_(400, 'A vehicle request is approved or declined.');
  if (vcVisiting_(user)) return vcRefuse_(403, 'Answer from your own account — not while visiting someone else.');
  var me = hubActingUserId_(user);
  var inbox;
  try { inbox = vcRead_(VC_TABS.inbox); } catch (e) { return vcFail_(e); }
  var items = inbox.filter(function (r) { return r.trip_id === id && r.box === 'work'; });
  if (!items.length) return vcRefuse_(404, 'That request is not on the queue any more.');
  var waiting = items.filter(function (r) { return r.state === 'waiting'; });
  var master = false;
  try { master = !!hubIsRealMaster_(user); } catch (eM) { master = false; }
  // the master stands in on a director seat; vcAnswerItem_ judges it
  var mine = waiting.filter(function (r) { return me && r.to_uid === me; })[0] ||
             (master ? waiting.filter(function (r) { return vcStr_(r.seat) === 'director'; })[0] : null) || null;
  if (!mine) {
    if (waiting.length) {
      return vcRefuse_(403, 'This one is waiting on ' + waiting.map(function (r) { return r.to_name; }).join(', ') + '.');
    }
    var answered = items.filter(function (r) { return r.state === 'approved' || r.state === 'declined'; })[0];
    return { status: 200, data: { ok: true, changed: false, state: answered ? answered.state : 'closed',
                                  said: answered ? 'Already answered by ' + answered.answered_by + '.' : 'The request was withdrawn.' } };
  }
  var got = vcAnswerItem_(user, mine.id, word, note);
  if (!got || got.status !== 200) return got;
  return { status: 200, data: { ok: true, changed: got.data.changed, said: got.data.said, state: got.data.state } };
}
