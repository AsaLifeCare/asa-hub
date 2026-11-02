// ------------------------------------------------------------------ COMM CALLS — what the phone lines carried, in…
// WHAT THIS FILE IS.

// The declared houses' tabs.
var COMM_CALLS_TAB = 'comm_calls';
var COMM_WORK_ITEMS_TAB = 'comm_work_items';

// The call, in the clear.
var COMM_CALLS_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'call_id', 'call_at', 'line', 'direction', 'duration_sec', 'turns',
  'person_key', 'name', 'name_from', 'name_why', 'who_state',
  'read_state', 'read_at', 'model_via', 'items', 'prior_lane', 'seal_id',
  'source_at'
];

/** What the call was about — the classifier's three types, given a home. */
var COMM_WORK_ITEMS_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'call_id', 'item_no', 'work_type', 'category', 'urgency', 'occurred_on',
  'description',
  'concerns_person_key', 'concerns_name', 'name_from',
  'confidence', 'state', 'seal_id', 'source_call_at',
  'source_at'
];

// THE LINE THIS DOOR WILL NOT CROSS — refused on arrival, named in the log.
var COMM_CALLS_REFUSED = [
  'full_transcript', 'speaker_transcript', 'transcript',
  'summary', 'quote', 'description_of_request',
  'response', 'summary_of_incident', 'immediate_action_taken',
  'cause_and_contributing_factors', 'prevention_plan',
  'notes', 'note', 'reason', 'comments', 'raw', 'text', 'preview', 'excerpt',
  'client_name', 'client', 'consumers', 'num_consumers',
  'house', 'location_code', 'incident_location', 'location',
  'shift_code', 'address', 'latitude', 'longitude',
  'phone', 'caller_phone', 'requestor_phone', 'email'
];

// THE ONE LINE THAT TRAVELS.
var COMM_DESCRIPTION_CAP = 240;

// The four the classifier contract has.
var COMM_WORK_TYPES = ['DailyNote', 'Incident', 'Request', 'Screening'];

/** The daily-note and request vocabularies are the hotline prompt's own. */
var COMM_CAT_DAILY = ['daily_update', 'medical', 'behavior', 'meals',
                      'activities', 'sleep', 'hygiene', 'other'];
var COMM_CAT_REQUEST = ['Schedule - Call Off', 'Schedule - Change', 'Payroll',
                        'Supplies', 'Maintenance', 'HR', 'IT', 'Other'];
// The TEN BROAD ONES from the platform's incident-category entity table.
var COMM_CAT_INCIDENT = ['minor_issue_schedule_late_verbal_tension',
                         'medication_error_missed_dose',
                         'client_behavior_aggression',
                         'injury_accident_staff_or_client',
                         'hospitalization_er_visit',
                         'abuse_neglect_allegation',
                         'missing_client_wandering',
                         'vehicle_transportation_issue',
                         'environmental_facility_issue',
                         'post_incident_check'];
var COMM_URGENCY = ['Low', 'Medium', 'High'];

// THE SIX OUTCOMES A SCREENING CLOSES WITH — the FinalResult vocabulary of the words book's…
var COMM_CAT_SCREENING = ['advance', 'advance_pending', 'declined_pay',
                          'declined_schedule', 'incomplete', 'no_show'];

// How a call may have been read.
var COMM_READ_STATES = ['read', 'unread', 'unreadable'];

// Whose line it was, straight from `contactPhoneWho_`.
var COMM_WHO_STATES = ['sole', 'shared', 'unknown', 'unresolved'];

// Rows accepted per call.
var COMM_CALLS_INGEST_CAP = 500;
var COMM_WORK_ITEMS_INGEST_CAP = 2000;

/** When the lane last handed calls over, and how many rows the houses hold. */
var COMM_CALLS_FEED_STAMP = 'COMM_CALLS_FEED_AT';
var COMM_CALLS_FEED_ROWS = 'COMM_CALLS_FEED_ROWS';

// ================================================================== THE PURE HALF — no sheet, no clock…

// A value as the text these houses store.
function commCallsText_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

// The platform's own flattened name — `clientNameKey_`'s spelling, so a person keyed here is the same person keyed…
function commCallsKey_(v) {
  return String(v === null || v === undefined ? '' : v)
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Membership, on the flattened spelling, so 'Schedule-Call Off' and 'schedule - call off' are one word.
function commCallsOneOf_(list, want) {
  var key = commCallsKey_(want);
  for (var i = 0; i < list.length; i++) {
    if (commCallsKey_(list[i]) === key) return list[i];
  }
  return '';
}

// Which refused names this hand-over is carrying.
function commCallsCrossed_(rows) {
  var found = [], seen = {};
  (rows || []).forEach(function (row) {
    if (!row) return;
    Object.keys(row).forEach(function (k) {
      var key = commCallsKey_(k);
      for (var i = 0; i < COMM_CALLS_REFUSED.length; i++) {
        if (commCallsKey_(COMM_CALLS_REFUSED[i]) === key && !seen[k]) {
          seen[k] = true;
          found.push(k);
        }
      }
    });
  });
  return found;
}

// An ISO instant, or '' — never a guess.
function commCallsInstant_(v) {
  var s = commCallsText_(v).slice(0, 40);
  if (!s) return '';
  return isNaN(Date.parse(s)) ? '' : s;
}

// A count as text, or '' — MISSING IS NOT ZERO, and '' is how a cell that holds numbers says the platform does not…
function commCallsCount_(v) {
  var s = commCallsText_(v).replace(/[^\d]/g, '');
  return s;
}

// ONE HANDED-OVER CALL → the line the house stores, or null.
function commCallsClean_(row, at) {
  if (!row) return null;
  var callId = commCallsText_(row.call_id).slice(0, 60);
  if (!callId) return null;   // a call with no id can never be matched or patched
  var readState = commCallsText_(row.read_state).toLowerCase();
  if (COMM_READ_STATES.indexOf(readState) === -1) return null;
  var whoState = commCallsText_(row.who_state).toLowerCase();
  if (COMM_WHO_STATES.indexOf(whoState) === -1) whoState = 'unresolved';

  // A NAME ONLY WHERE ONE PERSON HOLDS THE LINE.
  var named = whoState === 'sole';
  var name = named ? commCallsText_(row.name).slice(0, 120) : '';
  return {
    id: 'CC_' + callId,
    call_id: callId,
    call_at: commCallsInstant_(row.call_at),
    line: commCallsText_(row.line).slice(0, 60),
    direction: commCallsText_(row.direction).toLowerCase().slice(0, 12) || 'unknown',
    duration_sec: commCallsCount_(row.duration_sec),
    turns: commCallsCount_(row.turns),
    person_key: name ? commCallsKey_(name) : '',
    name: name,
    // NEVER 'person'.
    name_from: named ? 'phone' : '',
    name_why: commCallsText_(row.name_why).slice(0, 300),
    who_state: whoState,
    read_state: readState,
    read_at: commCallsInstant_(row.read_at),
    model_via: commCallsText_(row.model_via).slice(0, 60),
    // AND HERE IS WHERE "MISSING IS NOT ZERO" IS ENFORCED rather than trusted: an unreadable call's count is…
    items: readState === 'unreadable' ? '' : commCallsCount_(row.items),
    prior_lane: commCallsText_(row.prior_lane).slice(0, 20),
    seal_id: commCallsText_(row.seal_id).slice(0, 80),
    source_at: commCallsText_(at).slice(0, 40)
  };
}

/** ONE HANDED-OVER WORK ITEM → the line the house stores, or null. */
function commWorkItemClean_(row, at) {
  if (!row) return null;
  var callId = commCallsText_(row.call_id).slice(0, 60);
  var itemNo = commCallsText_(row.item_no).replace(/[^\d]/g, '');
  if (!callId || !itemNo) return null;
  var workType = commCallsOneOf_(COMM_WORK_TYPES, row.work_type);
  if (!workType) return null;   // a type nothing understands is a row nobody reads

  var vocab = workType === 'DailyNote' ? COMM_CAT_DAILY
            : (workType === 'Request' ? COMM_CAT_REQUEST
            : (workType === 'Screening' ? COMM_CAT_SCREENING : COMM_CAT_INCIDENT));
  var fallback = workType === 'DailyNote' ? 'other'
               : (workType === 'Request' ? 'Other'
               : (workType === 'Screening' ? 'incomplete'
               : 'minor_issue_schedule_late_verbal_tension'));
  // THE CATEGORY IS COERCED, NEVER PASSED THROUGH.
  var category = commCallsOneOf_(vocab, row.category) || fallback;
  var urgency = commCallsOneOf_(COMM_URGENCY, row.urgency) ||
                (category === 'Schedule - Call Off' ? 'High' : 'Low');
  var occurred = commCallsText_(row.occurred_on).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred)) occurred = '';

  var named = commCallsText_(row.name_from) === 'phone';
  var name = named ? commCallsText_(row.concerns_name).slice(0, 120) : '';
  var confidence = commCallsText_(row.confidence).slice(0, 8);
  if (confidence && !/^(0(\.\d+)?|1(\.0+)?)$/.test(confidence)) confidence = '';
  // THE ONE LINE THAT TRAVELS — capped, flattened to a single line, and emptied when it would only repeat the…
  var description = commCallsText_(row.description).replace(/\s+/g, ' ').trim()
    .slice(0, COMM_DESCRIPTION_CAP);
  return {
    id: 'CW_' + callId + '_' + itemNo,
    call_id: callId,
    item_no: itemNo,
    work_type: workType,
    category: category,
    urgency: urgency,
    occurred_on: occurred,
    description: description,
    concerns_person_key: name ? commCallsKey_(name) : '',
    concerns_name: name,
    name_from: named ? 'phone' : '',
    confidence: confidence,
    state: commCallsText_(row.state).toLowerCase() === 'closed' ? 'closed' : 'open',
    seal_id: commCallsText_(row.seal_id).slice(0, 80),
    source_call_at: commCallsInstant_(row.source_call_at),
    source_at: commCallsText_(at).slice(0, 40)
  };
}

// ================================================================== THE SHEET HALF…

// IS THE HOUSE DECLARED — asked BEFORE anything is opened.
function commCallsDeclared_(tab) {
  try {
    return typeof houseIdFor_ === 'function' && !!houseIdFor_(tab);
  } catch (e) { return false; }
}

function commCallsSheet_() {
  return hubTabEnsure_(COMM_CALLS_TAB, COMM_CALLS_HEADER);
}

function commWorkItemsSheet_() {
  return hubTabEnsure_(COMM_WORK_ITEMS_TAB, COMM_WORK_ITEMS_HEADER);
}

/** The tab read once — header, values, and the rows as objects. */
function commCallsRead_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { header: [], values: [] };
  return { header: values[0].map(String), values: values };
}

// A block written as TEXT, always.
function commCallsWrite_(sheet, startRow, lines, width) {
  var range = sheet.getRange(startRow, 1, lines.length, width);
  range.setNumberFormat('@');
  range.setValues(lines);
}

// UPSERT BY ID — append what is new, patch what moved, touch nothing else.
function commCallsUpsert_(sheet, incoming, header, values) {
  var col = {};
  for (var h = 0; h < header.length; h++) col[String(header[h])] = h;
  if (col.id === undefined) return { error: 'the house lacks an "id" column' };

  var at = {};
  for (var r = 1; r < values.length; r++) {
    var id0 = commCallsText_(values[r][col.id]);
    if (id0 && at[id0] === undefined) at[id0] = r;
  }

  var now = new Date().toISOString();
  var out = { inserted: 0, updated: 0, unchanged: 0, appended: [], writes: 0 };
  var changed = {};
  incoming.forEach(function (item) {
    var id = commCallsText_(item.id);
    if (!id) return;
    var row = at[id];
    if (row === undefined) {
      var line = header.map(function () { return ''; });
      line[col.id] = id;
      if (col.createdAt !== undefined) line[col.createdAt] = now;
      if (col.updatedAt !== undefined) line[col.updatedAt] = now;
      Object.keys(item).forEach(function (k) {
        if (k === 'id' || col[k] === undefined) return;
        line[col[k]] = item[k];
      });
      out.appended.push(line);
      out.inserted++;
      // a key handed over twice in one payload patches its own new line rather than appending a second one
      at[id] = -(out.appended.length);
      return;
    }
    if (row < 0) {
      var pending = out.appended[-row - 1];
      Object.keys(item).forEach(function (k) {
        if (k === 'id' || k === 'createdAt' || col[k] === undefined) return;
        pending[col[k]] = item[k] === null || item[k] === undefined ? '' : item[k];
      });
      return;
    }
    var cur = values[row], touched = false;
    Object.keys(item).forEach(function (k) {
      /* THE DAY THIS CALL FIRST LANDED IS NOT THIS PASS'S TO FORGET */
      if (k === 'id' || k === 'createdAt' || col[k] === undefined) return;
      var v = item[k] === null || item[k] === undefined ? '' : item[k];
      if (commCallsText_(cur[col[k]]) !== commCallsText_(v)) { cur[col[k]] = v; touched = true; }
    });
    if (touched) {
      if (col.updatedAt !== undefined) cur[col.updatedAt] = now;
      changed[row] = true;
      out.updated++;
    } else out.unchanged++;
  });

  var idxs = [];
  for (var key in changed) {
    if (Object.prototype.hasOwnProperty.call(changed, key)) idxs.push(Number(key));
  }
  idxs.sort(function (a, b) { return a - b; });
  for (var i = 0; i < idxs.length;) {
    var start = idxs[i], end = start;
    while (i + 1 < idxs.length && idxs[i + 1] === end + 1) { i++; end = idxs[i]; }
    i++;
    var block = [];
    for (var rr = start; rr <= end; rr++) block.push(values[rr].slice(0, header.length));
    commCallsWrite_(sheet, start + 1, block, header.length);
    out.writes++;
  }
  if (out.appended.length) {
    var first = sheet.getLastRow() + 1;
    var need = first + out.appended.length - 1;
    /* setValues never grows the grid; a house minted short would throw */
    if (sheet.getMaxRows() < need) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
    commCallsWrite_(sheet, first, out.appended, header.length);
    out.writes++;
  }
  return out;
}

// ================================================================== THE DOORS…

// WHOSE LINE IS THIS — one question, asked of the platform's ONE resolver.
HUB_POLICY.commCallsWho = {
  file: 'CommCalls.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { phones: { required: true, type: 'array' } },
  roles: ['admin', 'manager'], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.commCallsWho = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || ['admin', 'manager'].indexOf(String(user.role)) === -1)) {
    return hubDenied_();
  }
  if (typeof contactPhoneWho_ !== 'function') {
    // SAID, NOT SWALLOWED.
    return { status: 503, message: 'the contact resolver is not available' };
  }
  var phones = (payload && payload.phones) || [];
  var rows = [], seen = {};
  for (var i = 0; i < phones.length && rows.length < 400; i++) {
    var raw = commCallsText_(phones[i]);
    if (!raw || seen[raw]) continue;
    seen[raw] = true;
    var who = contactPhoneWho_(raw);
    rows.push({
      phone: raw,
      state: String(who.state || 'unknown'),
      // THE NAME TRAVELS ONLY ON `sole`.
      name: String(who.name || ''),
      why: typeof contactWhoText_ === 'function' ? contactWhoText_(who) : String(who.why || '')
    });
  }
  return { status: 200, data: { rows: rows, asked: phones.length } };
};

// THE HAND-OVER.
HUB_POLICY.commCallsIngest = {
  file: 'CommCalls.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { calls: { required: false, type: 'array' },
            items: { required: false, type: 'array' },
            source_at: { required: false, type: 'string' } },
  roles: ['admin'], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.commCallsIngest = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  var calls = (payload && payload.calls) || [];
  var items = (payload && payload.items) || [];
  if (!calls.length && !items.length) {
    return { status: 200, data: { wrote: 0, converged: true, note: 'nothing was handed over' } };
  }

  // THE POINTER IS THE PERMISSION.
  if (!commCallsDeclared_(COMM_CALLS_TAB) || !commCallsDeclared_(COMM_WORK_ITEMS_TAB)) {
    return { status: 503,
             message: 'The comm_calls houses are not declared — run ' +
                      'tools/mint_comm_calls_house.py first. Nothing was written.' };
  }

  // one feed at a time: two passes reading the same tab would each decide a call is missing and each append it
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'The calls feed is already running.' };
  try {
    /* THE LINE, CHECKED BEFORE ANYTHING IS SHAPED. */
    var crossed = commCallsCrossed_(calls).concat(commCallsCrossed_(items));
    var at = commCallsInstant_(payload && payload.source_at) || new Date().toISOString();

    var cleanCalls = [], seenCalls = {}, refusedCalls = 0;
    for (var i = 0; i < calls.length && cleanCalls.length < COMM_CALLS_INGEST_CAP; i++) {
      var call = commCallsClean_(calls[i], at);
      if (!call || seenCalls[call.id]) { refusedCalls++; continue; }
      seenCalls[call.id] = true;
      cleanCalls.push(call);
    }
    var cleanItems = [], seenItems = {}, refusedItems = 0;
    for (var j = 0; j < items.length && cleanItems.length < COMM_WORK_ITEMS_INGEST_CAP; j++) {
      var item = commWorkItemClean_(items[j], at);
      if (!item || seenItems[item.id]) { refusedItems++; continue; }
      seenItems[item.id] = true;
      cleanItems.push(item);
    }
    var overflow = Math.max(0, calls.length - refusedCalls - cleanCalls.length) +
                   Math.max(0, items.length - refusedItems - cleanItems.length);
    if (!cleanCalls.length && !cleanItems.length) {
      return { status: 400, message: 'No usable row — a call needs an id and a read state.' };
    }

    var out = { calls: { inserted: 0, updated: 0, unchanged: 0, writes: 0 },
                items: { inserted: 0, updated: 0, unchanged: 0, writes: 0 } };
    var moved = 0, rows = 0;
    if (cleanCalls.length) {
      var cs = commCallsSheet_();
      var cr = commCallsRead_(cs);
      var ch = cr.header.length ? cr.header : ensureHeader_(cs, COMM_CALLS_HEADER);
      if (!cr.values.length) cr.values = [ch];
      var cres = commCallsUpsert_(cs, cleanCalls, ch, cr.values);
      if (cres.error) return { status: 400, message: cres.error };
      out.calls = { inserted: cres.inserted, updated: cres.updated,
                    unchanged: cres.unchanged, writes: cres.writes };
      moved += cres.inserted + cres.updated;
      rows = Math.max(0, cs.getLastRow() - 1);
      if (cres.inserted + cres.updated) { try { cacheBump_(cacheScope_(COMM_CALLS_TAB)); } catch (eB) {} }
    }
    if (cleanItems.length) {
      var ws = commWorkItemsSheet_();
      var wr = commCallsRead_(ws);
      var wh = wr.header.length ? wr.header : ensureHeader_(ws, COMM_WORK_ITEMS_HEADER);
      if (!wr.values.length) wr.values = [wh];
      var wres = commCallsUpsert_(ws, cleanItems, wh, wr.values);
      if (wres.error) return { status: 400, message: wres.error };
      out.items = { inserted: wres.inserted, updated: wres.updated,
                    unchanged: wres.unchanged, writes: wres.writes };
      moved += wres.inserted + wres.updated;
      if (wres.inserted + wres.updated) { try { cacheBump_(cacheScope_(COMM_WORK_ITEMS_TAB)); } catch (eB2) {} }
    }

    try {
      hubPropSet_(COMM_CALLS_FEED_STAMP, at);
      hubPropSet_(COMM_CALLS_FEED_ROWS, String(rows));
    } catch (eP) { /* the stamp is a convenience; the rows are the answer */ }

    try {
      if (crossed.length) {
        // LOUD, AND BY NAME ONLY.
        hubSysLog_('asa-hub:comm', 'comm_calls_columns_refused', crossed.join(', '),
                   { status: 200,
                     message: 'dropped at the door — the clear side carries facts, never words' });
      }
      if (moved || overflow) {
        hubSysLog_('asa-hub:comm', 'comm_calls_ingested',
                   out.calls.inserted + ' call(s) added, ' + out.calls.updated + ' patched · ' +
                   out.items.inserted + ' matter(s) added, ' + out.items.updated + ' patched · ' +
                   (out.calls.writes + out.items.writes) + ' write(s)' +
                   (refusedCalls + refusedItems ? ' · ' + (refusedCalls + refusedItems) +
                    ' row(s) refused' : '') +
                   (overflow ? ' · ' + overflow + ' past the cap, not seen' : ''),
                   { status: 200 });
      }
    } catch (eL) { /* the rows landed either way */ }

    return { status: 200, data: {
      received_calls: calls.length, received_items: items.length,
      kept_calls: cleanCalls.length, kept_items: cleanItems.length,
      refused: refusedCalls + refusedItems, overflow: overflow,
      calls: out.calls, items: out.items,
      converged: moved === 0, dropped_columns: crossed, at: at
    } };
  } finally {
    lock.releaseLock();
  }
};

// ================================================================== THE SCREEN'S DOORS — the viewer, the…

// THE WORDS OF ONE CALL, FOR THE PERSON WHO OWNS THE SEAL — clicking a call's row has to show the full transcript…
HUB_POLICY.commCallsTranscript = {
  file: 'CommCalls.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { call_id: { required: true, type: 'string' } },
  roles: ['admin'], service: false,
  invalidates: [], emits: []
};
HUB_ACTIONS.commCallsTranscript = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var want = commCallsText_(payload && payload.call_id).slice(0, 60);
  if (!want) return { status: 400, message: 'call_id is required' };
  return commCallsTranscriptRead_(want, user);
};

// One call's words, the best copy of the two inboxes, the read logged with who asked.
function commCallsTranscriptRead_(want, user) {
  // THE WORDS CAN LIVE IN TWO INBOXES, and the door owes the screen both: `quo_transcripts` is the tab OUR webhook…
  var tabs = [];
  try { tabs.push(hubTabSheet_('quo_transcripts')); } catch (eT1) {}
  try {
    var hotId = str_(hubProp_('HOTLINE_TRANSCRIPTS_ID') || '');
    if (hotId) tabs.push(SpreadsheetApp.openById(hotId).getSheetByName('Transcripts'));
  } catch (eT2) {}
  // THE BEST COPY, NOT THE FIRST ONE (measured live on a real call): the same call can sit in both inboxes, and one…
  var best = null;
  for (var t = 0; t < tabs.length; t++) {
    if (!tabs[t]) continue;
    var rows = readAll_(tabs[t]);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var id = str_(row.call_id || row['Call ID']);
      if (id !== want) continue;
      var full = str_(row.full_transcript || row['Full Transcript']);
      var spoken = str_(row.speaker_transcript || row['Speaker Transcript']);
      var score = spoken.length * 2 + full.length;   // the dialogue counts double
      if (!best || score > best.score) {
        best = { row: row, full: full, spoken: spoken, score: score };
      }
    }
  }
  if (best) {
    var row = best.row, full = best.full, spoken = best.spoken;
    try {
      hubSysLog_('asa-hub:comm', 'comm_calls_transcript_read',
                 want + ' read by ' + str_((user && (user.email || user.user_id)) || 'admin'),
                 { status: 200 });
    } catch (eL) {}
    // Each field in both inboxes' spellings: the Hub's own rows say event_at, team_members and duration_s, and…
    return { status: 200, data: {
      call_id: want,
      at: str_(row.event_timestamp || row['Event Timestamp'] || row.transcript_created || row.event_at ||
               row.received_at || row['Received At']),
      line: str_(row.team_member_s || row['Team Member(s)'] || row.team_members),
      direction: str_(row.direction || row['Direction']),
      duration_sec: str_(row.duration_sec || row['Duration (sec)'] || row.duration_s),
      full_transcript: full,
      speaker_transcript: spoken,
      // MISSING IS NOT ZERO, said on the answer rather than by an empty cell: an inbox row with no words is a call…
      has_words: !!(full || spoken)
    } };
  }
  return { status: 404, message: 'no transcript on file for that call' };
}

// WHO MIGHT HAVE CALLED — the candidates, never the verdict.
var COMM_LINE_ROLE_WORDS = {
  '3307544040': 'Manager',
  '3309195558': 'Software Specialist',
  '3309195559': 'Administration',
  '3309197595': 'HR-Administration',
  '3309197779': 'Director',
  '9377166410': 'Director'
};
var COMM_CANDIDATES_CAP = 8;

HUB_POLICY.commCallsCandidates = {
  file: 'CommCalls.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { call_id: { required: false, type: 'string' } },
  roles: ['admin'], service: false,
  invalidates: [], emits: []
};
HUB_ACTIONS.commCallsCandidates = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var want = commCallsText_(payload && payload.call_id).slice(0, 60);
  var caller10 = '', lineDigits = '';
  if (want) {
    try {
      var crows = readAll_(commCallsSheet_());
      for (var ci = 0; ci < crows.length; ci++) {
        if (str_(crows[ci].call_id) === want) {
          caller10 = str_(crows[ci].participant_s || '').replace(/\D/g, '').slice(-10);
          lineDigits = str_(crows[ci].line || '').replace(/\D/g, '');
          break;
        }
      }
    } catch (eC) {}
  }
  var lineRole = '';
  for (var ld in COMM_LINE_ROLE_WORDS) {
    if (COMM_LINE_ROLE_WORDS.hasOwnProperty(ld) && lineDigits.indexOf(ld) !== -1) {
      lineRole = COMM_LINE_ROLE_WORDS[ld];
      break;
    }
  }

  var people = [];
  try { people = readAll_(hubTabSheet_('people')); } catch (eP) { people = []; }
  var active = [];
  for (var i = 0; i < people.length; i++) {
    var p = people[i];
    var status = str_(p.status).toLowerCase();
    if (status !== 'active' && status !== 'admin') continue;
    var name = str_(p.name || (str_(p.first_name) + ' ' + str_(p.last_name)).trim());
    if (!name) continue;
    active.push({ name: name, role: str_(p.role),
                  digits: str_(p.phone).replace(/\D/g, '').slice(-10) });
  }

  /* rung 3, first, because it is cheap: who was named on this line before. */
  var seenOnLine = {};
  if (lineDigits && want) {
    try {
      var all = readAll_(commCallsSheet_());
      for (var hi = 0; hi < all.length; hi++) {
        var h = all[hi];
        if (str_(h.call_id) === want) continue;
        var hd = str_(h.line || '').replace(/\D/g, '');
        if (!hd || lineDigits.indexOf(hd.slice(-10)) === -1) continue;
        var hn = str_(h.name);
        if (hn) seenOnLine[commCallsKey_(hn)] = (seenOnLine[commCallsKey_(hn)] || 0) + 1;
      }
    } catch (eH) {}
  }

  // RUNG 0 — THE NAME THE CALLER SAID, MATCHED AGAINST THE ROSTER: near matches of a person's name count too, and…
  var heard = {};
  if (want) {
    try {
      var tw2 = HUB_ACTIONS.commCallsTranscript({ call_id: want }, user);
      var spoken = (tw2 && tw2.status === 200) ? str_(tw2.data.speaker_transcript || tw2.data.full_transcript) : '';
      var company = {};
      str_(tw2 && tw2.data && tw2.data.line).replace(/\D/g, ' ').split(' ').forEach(function (d) {
        if (d.length >= 10) company[d.slice(-10)] = true;
      });
      var turns = spoken.split('\n').slice(0, 8);
      for (var ti = 0; ti < turns.length; ti++) {
        var tm = turns[ti].match(/\+?1?(\d{10})/);
        if (tm && company[tm[1]]) continue;   // the agent's own turns
        var wordsHeard = turns[ti].replace(/^\S+\s+[^:]*:\s*/, '').split(/[^A-Za-z]+/);
        for (var wi = 0; wi < wordsHeard.length; wi++) {
          var w = wordsHeard[wi];
          if (w.length >= 4 && /^[A-Z]/.test(w)) heard[w.toLowerCase()] = true;
        }
      }
    } catch (eT) { /* no words, no heard names — the other rungs still answer */ }
  }

  var out = [];
  for (var a = 0; a < active.length; a++) {
    var c = active[a];
    var match = !!(caller10 && c.digits && c.digits === caller10);
    var roleHit = !!(lineRole && str_(c.role).toLowerCase().indexOf(lineRole.toLowerCase()) !== -1);
    var before = seenOnLine[commCallsKey_(c.name)] || 0;
    var heardHit = false;
    var parts = str_(c.name).toLowerCase().split(/[^a-z]+/);
    for (var pi = 0; pi < parts.length && !heardHit; pi++) {
      for (var hw in heard) {
        if (heard.hasOwnProperty(hw) && parts[pi].length >= 4 &&
            (parts[pi].indexOf(hw) === 0 || hw.indexOf(parts[pi]) === 0)) { heardHit = true; break; }
      }
    }
    if (!match && !roleHit && !before && !heardHit) continue;
    out.push({ name: c.name, role: c.role, phone4: c.digits ? c.digits.slice(-4) : '',
               person_key: commCallsKey_(c.name), match: match, heard: heardHit,
               hint: match ? 'the number is theirs'
                     : (heardHit ? 'a name like theirs was said on the call'
                     : (roleHit ? 'holds the role this line answers to'
                     : 'named on ' + before + ' previous call(s) on this line')) });
  }
  out.sort(function (x, y) {
    if (x.match !== y.match) return x.match ? -1 : 1;
    if (!!x.heard !== !!y.heard) return x.heard ? -1 : 1;
    return (seenOnLine[commCallsKey_(y.name)] || 0) - (seenOnLine[commCallsKey_(x.name)] || 0);
  });

  // RUNG 4 — STILL LOST, ASK THE MODEL, BOUNDED BY THE ROSTER.
  var suggested = [];
  if (!out.length && want && typeof screenAiChat_ === 'function') {
    var words = '';
    try {
      var tw = HUB_ACTIONS.commCallsTranscript({ call_id: want }, user);
      if (tw && tw.status === 200) words = str_(tw.data.full_transcript).slice(0, 3000);
    } catch (eW) { words = ''; }
    if (words) {
      var roster = active.map(function (c) { return c.name; }).join(', ');
      var ask = 'A phone call arrived at a company line. The active staff are: ' + roster + '.\n' +
        'From the transcript alone, name up to 5 people FROM THAT LIST who could plausibly be the caller. ' +
        'Answer STRICT JSON only: {"names": ["..."]}. Use only names spelled exactly as in the list. ' +
        'If the transcript gives no useful signal, answer {"names": []}.\n\nTranscript:\n' + words;
      try {
        var chat = screenAiChat_(ask, 0, 'comm_calls_candidates');
        if (chat && chat.ok && chat.content) {
          var parsed = JSON.parse(String(chat.content).replace(/^[^{\[]*/, '').replace(/[^}\]]*$/, ''));
          var names = (parsed && parsed.names) || [];
          for (var n = 0; n < names.length; n++) {
            for (var a2 = 0; a2 < active.length; a2++) {
              if (commCallsKey_(active[a2].name) === commCallsKey_(names[n])) {
                suggested.push({ name: active[a2].name, role: active[a2].role,
                  phone4: active[a2].digits ? active[a2].digits.slice(-4) : '',
                  person_key: commCallsKey_(active[a2].name), match: false,
                  suggested: true, hint: 'the model\'s reading of the words — a suggestion, never a verdict' });
              }
            }
          }
        }
      } catch (eG) { /* a model that will not answer leaves an empty ladder, never a guess */ }
    }
  }

  return { status: 200, data: {
    candidates: out.concat(suggested).slice(0, COMM_CANDIDATES_CAP),
    active: active.length,
    line_role: lineRole
  } };
};

// AN ADMIN NAMES THE CALLER — a person's decision, written as one: whoever works out whose message it is picks the…
HUB_POLICY.commCallsAttribute = {
  file: 'CommCalls.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  params: { call_id: { required: true, type: 'string' },
            name: { required: true, type: 'string' } },
  roles: ['admin'], service: false,
  invalidates: [], emits: []
};
HUB_ACTIONS.commCallsAttribute = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var callId = commCallsText_(payload && payload.call_id).slice(0, 60);
  var name = commCallsText_(payload && payload.name).slice(0, 120);
  if (!callId || !name) return { status: 400, message: 'call_id and name are required' };
  if (!commCallsDeclared_(COMM_CALLS_TAB) || !commCallsDeclared_(COMM_WORK_ITEMS_TAB)) {
    return { status: 503, message: 'The comm_calls houses are not declared.' };
  }
  var who = str_(user.email || user.user_id || 'admin');
  var at = new Date().toISOString();
  var why = 'chosen by ' + who + ' at ' + at;
  var key = commCallsKey_(name);

  function patchRow_(sheet, id, fields) {
    var idx = findRowIndex_(sheet, id);
    if (idx < 0) return false;
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h); });
    var row = sheet.getRange(idx, 1, 1, header.length).getValues()[0];
    for (var f in fields) {
      if (!fields.hasOwnProperty(f)) continue;
      var col = header.indexOf(f);
      if (col >= 0) row[col] = fields[f];
    }
    sheet.getRange(idx, 1, 1, header.length).setValues([row]);
    return true;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'another write is in flight' };
  try {
    var callPatched = patchRow_(commCallsSheet_(), 'CC_' + callId, {
      name: name, person_key: key, name_from: 'manual', name_why: why, updatedAt: at
    });
    if (!callPatched) return { status: 404, message: 'no call row for that call_id' };
    var itemsPatched = 0;
    var ws = commWorkItemsSheet_();
    var wrows = readAll_(ws);
    for (var i = 0; i < wrows.length; i++) {
      if (str_(wrows[i].call_id) !== callId) continue;
      if (patchRow_(ws, str_(wrows[i].id), {
        concerns_name: name, concerns_person_key: key, name_from: 'manual', updatedAt: at
      })) itemsPatched++;
    }
    try { cacheBump_(cacheScope_(COMM_CALLS_TAB)); } catch (eB) {}
    try { cacheBump_(cacheScope_(COMM_WORK_ITEMS_TAB)); } catch (eB2) {}
    try {
      hubSysLog_('asa-hub:comm', 'comm_calls_attributed',
                 callId + ' named ' + name + ' by ' + who, { status: 200 });
    } catch (eL) {}
    return { status: 200, data: { call_id: callId, name: name, name_from: 'manual',
                                  items_patched: itemsPatched, at: at } };
  } finally {
    lock.releaseLock();
  }
};

// ================================================================== THE GAS-NATIVE READ — the webhook classifies…

// ONE TRANSCRIPT IN, FACTS IN THE HOUSES, SECONDS LATER — the rule is that Apps Script itself collects the webhook…
function commCallsClassifyNow_(record) {
  var callId = str_(record.call_id).slice(0, 60);
  var words = str_(record.full_transcript);
  if (!callId || !words) return { ok: false, why: 'no call_id or no words' };
  if (!commCallsDeclared_(COMM_CALLS_TAB) || !commCallsDeclared_(COMM_WORK_ITEMS_TAB)) {
    return { ok: false, why: 'houses not declared' };
  }
  var at = new Date().toISOString();
  var callAt = str_(record.event_at || record.transcript_created || record.received_at || at);
  var reportingDay = callAt.slice(0, 10);

  var ask =
    'You process voicemail and call transcripts from the employee support phone lines of a ' +
    'company running group homes for adults with developmental disabilities in Ohio. Direct ' +
    'support professionals call these lines to leave daily notes about clients, report ' +
    'incidents, ask for help, and call off shifts.\n\n' +
    'Read the transcript and emit ONE work item PER DISTINCT MATTER as NDJSON — one JSON ' +
    'object per line, nothing else. No markdown, no commentary, no array, no wrapper object.\n\n' +
    'RULES THAT OUTRANK EVERYTHING:\n' +
    '- Use ONLY what the transcript says. Never invent a name, a date, a client or an event.\n' +
    '- NEVER write a person\'s name into any field. The platform establishes who called from ' +
    'the phone number, not from the words.\n' +
    '- Dates: resolve relative words ("today", "tomorrow") against reporting date ' + reportingDay + '. ' +
    'Format yyyy-MM-dd.\n' +
    '- One call often carries several matters — a daily note AND a call off is two lines.\n' +
    '- A matter that fits nothing is a Request with category "Other".\n' +
    '- If the transcript carries no work matter at all, emit nothing. A greeting, a beep, ' +
    'a wrong number, a machine message and a hang-up are not work matters.\n' +
    '- NEVER write a summary longer than the transcript you were given.\n\n' +
    'Every object carries exactly these keys:\n' +
    '  work_type   one of: DailyNote | Incident | Request | Screening\n' +
    '  category    for DailyNote, one of: ' + COMM_CAT_DAILY.join(', ') + '\n' +
    '              for Request, one of: ' + COMM_CAT_REQUEST.join(', ') + '\n' +
    '              for Incident, one of: ' + COMM_CAT_INCIDENT.join(', ') + '\n' +
    '              for Screening, one of: ' + COMM_CAT_SCREENING.join(', ') + '\n' +
    '  urgency     Low | Medium | High. A call off is always High.\n' +
    '  occurred_on yyyy-MM-dd, the day the matter is about\n' +
    '  confidence  0.0 to 1.0, your own\n' +
    '  summary     what the matter is, in the caller\'s meaning, complete\n\n' +
    'A shift call off is ALWAYS work_type "Request", category "Schedule - Call Off", ' +
    'urgency "High", and the summary names the shift date and the reason given.\n' +
    'A hiring phone-screening call — the agency\'s screening assistant interviewing a ' +
    'candidate — is ONE Screening item for the whole call, never one per question.\n' +
    'Use the category words EXACTLY as spelled above. A category not on the list is refused.\n\n' +
    'Transcript:\n' + words.slice(0, 24000);

  var answer = null;
  try {
    answer = screenAiChat_(ask, 0, 'comm_calls_live');
  } catch (eAsk) {
    return { ok: false, why: 'model threw: ' + str_(eAsk && eAsk.message).slice(0, 120) };
  }
  if (!answer || !answer.ok) {
    return { ok: false, why: 'model refused: ' + str_(answer && answer.error).slice(0, 160) };
  }
  var content = String(answer.content || '').trim();

  // NDJSON, ONE OBJECT PER MATTER — parsed tolerantly, and a SUMMARY LONGER THAN THE CALL is invention, refused…
  var items = [];
  if (content) {
    var lines = content.split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line || line.charAt(0) !== '{') continue;
      try {
        var obj = JSON.parse(line);
        var summary = str_(obj.summary);
        if (!summary || summary.length > words.length) continue;
        items.push(obj);
      } catch (eLine) { /* a broken line is skipped, never guessed at */ }
    }
  }

  // WHO CALLED, FROM THE NUMBER — the one resolver the platform has, so the screen and every other lane agree.
  var verdict = { state: 'unresolved', name: '', why: 'no ten-digit caller number on the row' };
  try {
    var digits = str_(record.participants).replace(/\D/g, '').slice(-10);
    if (digits && typeof contactPhoneWho_ === 'function') {
      var got = contactPhoneWho_(digits);
      if (got && got.state) verdict = { state: str_(got.state), name: str_(got.name), why: str_(got.why) };
    }
  } catch (eWho) { /* unresolved stands — never a guess */ }
  var named = verdict.state === 'sole';

  var callRow = {
    call_id: callId,
    call_at: callAt,
    line: str_(record.team_members),
    direction: str_(record.direction).toLowerCase() || 'unknown',
    // ONE NUMBER, WHATEVER SHAPE IT ARRIVED IN: the webhook's duration is a float of seconds (58.148563 measured…
    duration_sec: str_(Math.round(Number(record.duration_s) || 0) || ''),
    turns: str_(record.turns).replace(/[^\d]/g, ''),
    person_key: named ? commCallsKey_(verdict.name) : '',
    name: named ? verdict.name : '',
    name_from: named ? 'phone' : '',
    name_why: verdict.why,
    who_state: verdict.state,
    read_state: 'read',
    read_at: at,
    model_via: 'gas:' + str_(answer.via || 'ladder'),
    items: String(items.length),
    prior_lane: '',
    seal_id: callId,
    source_call_at: callAt
  };
  var itemRows = [];
  for (var n = 0; n < items.length; n++) {
    var it = items[n];
    itemRows.push({
      call_id: callId,
      item_no: String(n + 1),
      work_type: str_(it.work_type),
      category: str_(it.category),
      urgency: str_(it.urgency),
      occurred_on: str_(it.occurred_on),
 // THE ONE LINE THAT TRAVELS (the standing rule): the summary the contract asked for IS the description, one line…
      description: str_(it.summary).replace(/\s+/g, ' ').trim().slice(0, COMM_DESCRIPTION_CAP),
      confidence: str_(it.confidence),
      state: 'open',
      seal_id: callId + ':' + (n + 1),
      source_call_at: callAt
    });
  }

  // THROUGH THE ONE DOOR, with the feed's own identity: the cleaners, the line-refusals, the lock, the upsert and…
  var out = HUB_ACTIONS.commCallsIngest(
    { calls: [callRow], items: itemRows, source_at: at },
    { is_service: true, role: 'admin' });
  return { ok: out && out.status === 200, via: callRow.model_via,
           items: items.length, who: verdict.state, door: out && out.status };
}

// ================================================================== THE SWEEP — the old processor's own shape, for…

// READ THE INBOX ON A CLOCK, CLASSIFY WHAT IS NEW — the shape is copied straight from the app that already does it.
var COMM_SWEEP_NEWEST_ROWS = 40;

function commCallsSweep_() {
  if (!commCallsDeclared_(COMM_CALLS_TAB) || !commCallsDeclared_(COMM_WORK_ITEMS_TAB)) {
    return { status: 503, message: 'The comm_calls houses are not declared.' };
  }
  var sheet = null;
  try {
    sheet = ssOpen_(hubId_('HOTLINE_TRANSCRIPTS_ID')).getSheetByName('Transcripts');
  } catch (eOpen) { sheet = null; }
  if (!sheet) return { status: 503, message: 'the transcripts inbox is not reachable' };

  /* The calls already read, keyed once for the whole pass. */
  var known = {};
  try {
    var have = readAll_(commCallsSheet_());
    for (var k = 0; k < have.length; k++) {
      var cid = str_(have[k].call_id);
      if (cid) known[cid] = true;
    }
  } catch (eKnown) { /* an unreadable house reads as "nothing known" — the upsert dedups */ }

  var rows = readAll_(sheet);
  var done = 0, classified = 0, failed = 0, items = 0, skipped = 0;
  var failures = [];
  for (var i = rows.length - 1; i >= 0 && done < COMM_SWEEP_NEWEST_ROWS; i--) {
    var row = rows[i];
    var callId = str_(row['Call ID']).slice(0, 60);
    if (!callId) continue;
    done++;
    if (known[callId]) { skipped++; continue; }
    // THE CALLER'S NUMBER, ASKED FOR EVERYWHERE — the search is by phone number.
    var participants = str_(row['Participant(s)']);
    if (!participants.replace(/\D/g, '')) {
      var own = {};
      str_(row['Team Member(s)']).replace(/\D/g, ' ').split(' ').forEach(function (d) {
        if (d.length >= 10) own[d.slice(-10)] = true;
      });
      var spoken = str_(row['Speaker Transcript']);
      var seenNums = {};
      (spoken.match(/\+?1?\d{10}(?=:)/g) || []).forEach(function (num) {
        var d = num.replace(/\D/g, '').slice(-10);
        if (!own[d] && !seenNums[d]) { seenNums[d] = true; participants = (participants ? participants + ', ' : '') + '+1' + d; }
      });
    }
    var got = null;
    try {
      got = commCallsClassifyNow_({
        call_id: callId,
        event_at: str_(row['Event Timestamp'] || row['Transcript Created'] || row['Received At']),
        duration_s: row['Duration (sec)'],
        direction: row['Direction'],
        turns: row['# Turns'],
        full_transcript: str_(row['Full Transcript']),
        speaker_transcript: str_(row['Speaker Transcript']),
        team_members: str_(row['Team Member(s)']),
        participants: participants
      });
    } catch (eOne) {
      got = { ok: false, why: 'threw: ' + str_(eOne && eOne.message).slice(0, 120) };
    }
    if (got && got.ok) { classified++; items += (got.items || 0); }
    else {
      failed++;
      failures.push(callId.slice(0, 12) + ': ' + str_(got && got.why).slice(0, 80));
    }
  }
  try {
    hubSysLog_('asa-hub:comm', 'comm_calls_sweep',
               classified + ' classified · ' + failed + ' failed · ' + skipped + ' already read',
               { status: 200 });
  } catch (eL) {}
  return { status: 200, data: {
    looked_at: done, classified: classified, items: items,
    already_read: skipped, failed: failed, failures: failures.slice(0, 5)
  } };
}

HUB_POLICY.commCallsSweep = {
  file: 'CommCalls.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  params: {},
  roles: ['admin'], service: true,
  invalidates: [], emits: []
};
HUB_ACTIONS.commCallsSweep = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || String(user.role) !== 'admin')) return hubDenied_();
  return commCallsSweep_();
};
