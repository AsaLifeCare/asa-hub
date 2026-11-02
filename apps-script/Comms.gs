// COMMS — our own rolling 7-day mirror of the phone system + transcript pull.
// Source is the Quo Sync mirror ("New Transcripts"), READ-ONLY to us, always.

/** Quo Sync mirror ("New Transcripts", owner ty.bond) — READ ONLY, sync source. */
var COMMS_WINDOW_DAYS = 7;
/** The AI screening assistant's line (calls land here); 5558 = validation caller. */
var COMMS_SCREEN_BOT_LINE = '3307544040';

// A second screening line was investigated and NOT adopted: over 7 days none of the busier lines' calls matched…

/** The lines a screening can happen on (a list, so it can grow). */
var COMMS_SCREEN_LINES = [COMMS_SCREEN_BOT_LINE];

// How many screenings one safety-net run analyses.
var COMMS_ANALYZE_CAP = 3;
// The wall the analyse loop checks BETWEEN screenings, so no run of the 15-minute trigger dies with a report half…
var COMMS_ANALYZE_BUDGET_MS = 150000;

/** True when these digits are one of our screening lines. */
function commsIsScreenLine_(digits) {
  return COMMS_SCREEN_LINES.indexOf(String(digits || '')) !== -1;
}

// Who did the screening.
function commsScreenedBy_(quoDigits, teamMembers) {
  if (String(quoDigits) === COMMS_SCREEN_BOT_LINE) return 'asa-hub:auto-collect';
  var parts = str_(teamMembers).split(/[,;]/).map(function (s) { return s.trim(); })
                               .filter(function (s) { return !!s; });
  if (!parts.length) return 'recruiter call';
  // ONE MEMBER ON THE CALL, OR NO NAME AT ALL.
  if (parts.length > 1) return 'recruiter call — ' + parts.join(' + ');
  return 'recruiter call — ' + (commsPersonForLine_(parts[0]) || parts[0]);
}

// A team member's NAME from the number their calls come in under: Team Member(s) in the mirror holds a phone…
var COMMS_LINE_NAMES_CACHE = null;
function commsPersonForLine_(numberOrName) {
  var digits = commsDigits_(numberOrName).slice(-10);
  if (!digits) return '';
  if (!COMMS_LINE_NAMES_CACHE) {
    COMMS_LINE_NAMES_CACHE = {};
    try {
      readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB).forEach(function (u) {
        var name = str_(u.displayname);
        if (!name) return;
        var list = [str_(u.phone)].concat(String(u.phones || '').split(/[,;|]/));
        for (var i = 0; i < list.length; i++) {
          var d = commsDigits_(list[i]).slice(-10);
          // A shared company line belongs to the company, not to a person.
          if (d && !COMMS_LINE_NAMES_CACHE[d] && !commsSharedLine_(d)) {
            COMMS_LINE_NAMES_CACHE[d] = name;
          }
        }
      });
    } catch (e) { /* no users tab reachable — the directory still answers */ }
  }
  if (COMMS_LINE_NAMES_CACHE[digits]) return COMMS_LINE_NAMES_CACHE[digits];
  try { return hubLinePersonForCall_(digits); } catch (eD) { return ''; }
}

// DOES THIS NUMBER NAME NOBODY — one question, asked in one place, so the seven readers below cannot drift from…
function commsSharedLine_(digits) {
  var d = String(digits || '');
  if (!d) return false;
  try { return hubLineSharedForIdentity_(d); }
  catch (e) { return SHARED_LINE_DIGITS.indexOf(d) !== -1; }
}

// A Quo Number cell that is not a phone number, REPAIRED where it can be.
function commsLineFromRaw_(raw) {
  var v = str_(raw);
  if (!v) return '';
  try {
    var row = hubLineRow_(v);
    return row ? row.digits : '';
  } catch (e) { return ''; }
}

// IS THIS CELL A PROVIDER LINE ID — asked BEFORE any attempt to resolve it, and that order is the whole finding.
function commsIsProviderLineId_(raw) {
  var v = str_(raw);
  if (!v) return false;
  try { return hubLineIsProviderId_(v); }
  catch (e) { return /^PN[A-Za-z0-9]{6,}$/.test(v); }
}

// What the directory could tell us this pass, in one sentence a report can print beside a count.
function commsLineDirectoryState_() {
  try {
    var dir = hubLines_();
    return (dir.ok ? 'read from ' : 'COULD NOT BE READ — answering from ') +
           str_(dir.source) + (dir.stale ? ' (stale)' : '') +
           (dir.why ? ' · ' + str_(dir.why) : '');
  } catch (e) { return 'COULD NOT BE READ — ' + String((e && e.message) || e); }
}

// IS THIS ONE OF OUR OWN LINES — the (C) question, and a WIDER one than commsSharedLine_ on purpose.
function commsLineOurs_(digits) {
  var d = String(digits || '');
  if (!d) return false;
  try {
    if (hubLineOurs_(d)) return true;
  } catch (e) { /* the declaration below still answers */ }
  return SHARED_LINE_DIGITS.indexOf(d) !== -1;
}

// How a line prints in a report: number, provider name, role, and whether it names anybody.
function commsLineLabel_(key) {
  var k = str_(key);
  if (!/^\d{10}$/.test(k)) return k;
  try { return hubLineLabel_(k); } catch (e) { return k; }
}
var COMMS_CELL_CAP = 45000;      // Sheets hard cell limit is 50k chars
var COMMS_TAIL_ROWS = 300;       // Quo Transcripts tail scanned per sync
var COMMS_SUMMARIES_PER_RUN = 12;

var COMMS_T_COLS = ['Call ID', 'Transcript Created', 'Duration (sec)', 'Quo Number',
                    'Participant(s)', 'Team Member(s)', 'Direction', '# Turns',
                    'Full Transcript', 'Speaker Transcript', 'Status'];
var COMMS_M_COLS = ['Message ID', 'Message Created', 'Status', 'Quo Number',
                    'External Participant(s)', 'Team Member', 'Direction',
                    'Message Type', 'Body', 'Attachment URLs', 'Conversation ID'];
var COMMS_S_COLS = ['call_id', 'created', 'quo_number', 'participants', 'direction',
                    'duration_sec', 'summary', 'model', 'summarized_at'];

/** Parse a date-ish cell; null when unreadable. */
function commsWhen_(s) {
  var d = new Date(String(s || '').trim());
  return isNaN(d.getTime()) ? null : d;
}

/** Truncate a value to the Sheets cell cap, marking it when cut. */
function commsCap_(v) {
  v = String(v == null ? '' : v);
  return v.length > COMMS_CELL_CAP ? v.slice(0, COMMS_CELL_CAP) + '\n[truncated]' : v;
}

/** A tab of OUR Comms spreadsheet; throws when it is missing. */
function commsSheet_(name) {
  var sheet = ssOpen_(hubId_('HUB_COMMS_ID')).getSheetByName(name);
  if (!sheet) throw new Error('Comms tab missing: ' + name);
  return sheet;
}

/** Rebuild one Comms tab: header + rows (full window replace). */
function commsRewrite_(name, header, rows) {
  var sheet = commsSheet_(name);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
}

/** Rebuild the 7-day window (transcripts, messages, summaries) + auto-collect. */
HUB_POLICY.commsSync = {
  file: 'Comms.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.commsSync = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cutoff = new Date(Date.now() - COMMS_WINDOW_DAYS * 86400000);
  var quo = ssOpen_(hubId_('QUO_SYNC_SHEET_ID'));

  // ---- transcripts window (tail scan of the Quo Transcripts tab) ----
  var src = quo.getSheetByName('Transcripts');
  if (!src) return { status: 502, message: bookText_('Strings', 'refuse.comms.no_transcripts_tab', '') };
  var lastRow = src.getLastRow(), lastCol = src.getLastColumn();
  var hdr = src.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h); });
  var idx = COMMS_T_COLS.map(function (c) { return hdr.indexOf(c); });
  var iWhen = hdr.indexOf('Transcript Created');
  var start = Math.max(2, lastRow - COMMS_TAIL_ROWS + 1);
  var values = lastRow >= 2 ? src.getRange(start, 1, lastRow - start + 1, lastCol).getValues() : [];
  var tRows = [];
  var windowTruncated = false;
  for (var r = 0; r < values.length; r++) {
    var when = commsWhen_(values[r][iWhen]);
    if (!when || when.getTime() < cutoff.getTime()) continue;
    tRows.push(idx.map(function (i) { return i === -1 ? '' : commsCap_(values[r][i]); }));
  }
  // no silent caps: if the OLDEST tail row is still inside the window, the tail was too short to cover 7 full days.
  if (values.length === COMMS_TAIL_ROWS) {
    var oldestWhen = commsWhen_(values[0][iWhen]);
    if (oldestWhen && oldestWhen.getTime() >= cutoff.getTime()) windowTruncated = true;
  }

  // ---- webhook log (messages + participant backfill source) ----
  var logSheet = quo.getSheetByName('Webhook Log');
  var log = (logSheet && logSheet.getLastRow() >= 2)
    ? logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 5).getValues() : [];

  // Participant backfill: an empty Participant(s) is recovered from the webhook dialogue (entries WITHOUT userId).
  var need = {};
  tRows.forEach(function (row) { if (!String(row[4]).trim()) need[String(row[0])] = true; });
  for (var b = log.length - 1; b >= 0; b--) {
    var bid = String(log[b][3] || '');
    if (!need[bid] || String(log[b][1]) !== 'call.transcript.completed') continue;
    try {
      var pObj = JSON.parse(String(log[b][4] || '')).data.object;
      var ext = {};
      (pObj.dialogue || []).forEach(function (d) {
        if (d && d.identifier && !d.userId) ext[String(d.identifier)] = true;
      });
      var extList = Object.keys(ext);
      if (extList.length) {
        tRows.forEach(function (row) {
          if (String(row[0]) === bid && !String(row[4]).trim()) row[4] = extList.join(', ');
        });
      }
      need[bid] = false;
    } catch (e) { /* skip */ }
  }
  commsRewrite_('transcripts', COMMS_T_COLS, tRows);

  // ---- messages window (extracted from Webhook Log payloads) ----
  var mRows = [];
  if (log.length) {
    var byId = {};
    for (var l = 0; l < log.length; l++) {
      var type = String(log[l][1] || '');
      if (type !== 'message.received' && type !== 'message.delivered') continue;
      var o;
      try { o = JSON.parse(String(log[l][4] || '')).data.object; } catch (e) { continue; }
      var mWhen = commsWhen_(o.createdAt);
      if (!mWhen || mWhen.getTime() < cutoff.getTime()) continue;
      var out = String(o.direction) === 'outgoing';
      byId[String(o.id || '')] = [
        String(o.id || ''), String(o.createdAt || ''), String(o.status || ''),
        out ? String(o.from || '') : String(o.to || ''),
        out ? String(o.to || '') : String(o.from || ''),
        String(o.userId || ''), String(o.direction || ''),
        (o.media && o.media.length) ? 'mms' : 'sms', commsCap_(o.body || ''),
        (o.media || []).map(function (m) { return m && m.url ? m.url : String(m); }).join(' | '),
        String(o.conversationId || '')
      ];
    }
    for (var k in byId) mRows.push(byId[k]);
    mRows.sort(function (a, b) { return String(a[1]).localeCompare(String(b[1])); });
  }
  commsRewrite_('messages', COMMS_M_COLS, mRows);

  // ---- summaries: incremental AI derivation over OUR transcripts ---- THREE OUTCOMES, NOT ONE NUMBER: queued…
  var summarized = 0, pending = 0, blocked = 0, blockedWhy = '';
  var sumSheet = commsSheet_('summaries');
  if (sumSheet.getLastRow() < 1) {
    sumSheet.getRange(1, 1, 1, COMMS_S_COLS.length).setValues([COMMS_S_COLS]);
  }
  var have = {};
  readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'summaries').forEach(function (s) {
    if (str_(s.callid)) have[str_(s.callid)] = true;
  });
  for (var t = tRows.length - 1; t >= 0; t--) {  // newest calls first
    var callId = String(tRows[t][0]);
    var text = String(tRows[t][9] || tRows[t][8] || '');  // speaker || full
    if (!callId || have[callId] || !text) continue;
    // NO KEY GATE: a missing OPENAI_API_KEY is only the first provider being unavailable — screenAiChat_ asks the…
    if (summarized >= COMMS_SUMMARIES_PER_RUN) { pending++; continue; }
    // Once the provider refused it refuses the rest of this run — carrying on would burn the six-minute budget.
    if (blocked && blockedWhy.indexOf('refused') !== -1) { blocked++; continue; }
    try {
      var stpl = bookText_('Prompts', 'ai_message_rewrite', '');
      var chatS = stpl
        ? screenAiChat_(stpl.split('{text}').join(text.slice(0, 11000)), 0.2, 'ai_message_rewrite')
        : { ok: false, error: 'prompt_cell_empty' };
      if (!chatS.ok) {
        blocked++;
        if (!blockedWhy) {
          blockedWhy = 'no model answered: ' + str_(chatS.error).slice(0, 160);
        }
        continue;
      }
      var summary = '';
      try { summary = str_((JSON.parse(chatS.content) || {}).summary); } catch (eJ) { summary = ''; }
      if (!summary) summary = str_(chatS.content).slice(0, 900);
      if (!summary) { blocked++; if (!blockedWhy) blockedWhy = 'the model answered nothing'; continue; }
      sumSheet.appendRow([callId, String(tRows[t][1]), String(tRows[t][3]), String(tRows[t][4]),
                          String(tRows[t][6]), String(tRows[t][2]), summary,
                          str_(chatS.via) || 'model', new Date().toISOString()]);
      have[callId] = true;
      summarized++;
    } catch (e) {
      blocked++;
      if (!blockedWhy) blockedWhy = 'the summary call threw: ' + String((e && e.message) || e).slice(0, 160);
    }
  }

  // THE RULE: every call INTO the 4040 screening line whose caller matches a DSP at the Phone Screen stage IS the…
  var collected = commsAutoCollectScreens_(user);

  return { status: 200, data: {
    transcripts: tRows.length, messages: mRows.length,
    summarized: summarized,
    summaries_pending: pending,      // waiting for the next run — will happen
    summaries_blocked: blocked,      // will NOT happen until someone acts
    summaries_blocked_why: blockedWhy,
    screens_collected: collected.collected, screens_analyzed: collected.analyzed,
    // the third number: screenings this pass knew about and did not reach.
    screens_pending: collected.pending,
    window_days: COMMS_WINDOW_DAYS,
    // Each clause is a book row; the code only decides WHICH ones are true.
    note: (blocked ? hiringRenderMail_(bookText_('Strings', 'comms.note.blocked', ''),
                                       { n: String(blocked), why: str_(blockedWhy) }) + ' ' : '') +
          (collected.collected ? hiringRenderMail_(bookText_('Strings', 'comms.note.collected', ''),
                                                   { n: String(collected.collected) }) + ' ' : '') +
          (windowTruncated ? bookText_('Strings', 'comms.note.truncated', '') + ' ' : '') +
          (mRows.length === 0 ? bookText_('Strings', 'comms.note.no_messages', '') : '')
  } };
};

// Auto-collect over our own window, newest-first: a screening-line call whose caller is a candidate at the…
function commsAutoCollectScreens_(user) {
  var out = { collected: 0, analyzed: 0, pending: 0 };
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts');
  if (!rows.length) return out;
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var doneCalls = {}, hasScreen = {}, screenWhen = {}, resetFloor = {}, holdCids = {};
  // callId → the candidate whose screen row carries it and still has NO score.
  var unscored = {};
  readTabNormalized_(db, TALENT_PHONE_TAB).forEach(function (s) {
    var cid0 = str_(s.candidateid);
    if (str_(s.transcriptcallid)) doneCalls[str_(s.transcriptcallid)] = true;
    // last row carrying a call id wins — that is the row hubSetFieldLastRow_ writes
    if (cid0 && str_(s.transcriptcallid)) {
      if (str_(s.screenscore)) delete unscored[str_(s.transcriptcallid)];
      else unscored[str_(s.transcriptcallid)] = cid0;
    }
    if (cid0 && (str_(s.transcripttext) || str_(s.transcriptcallid) ||
                 str_(s.screenstatus).toLowerCase() === 'completed')) hasScreen[cid0] = true;
    // when the screening ON the row happened — a test card only moves FORWARD
    var w0 = commsWhen_(str_(s.transcriptcreated) || str_(s.screendate));
    if (cid0 && w0) screenWhen[cid0] = Math.max(screenWhen[cid0] || 0, w0.getTime());
    // Use The Last stamp — calls older than the press never attach, even if they land in the mirror late
    var rf0 = commsWhen_(str_(s.uselastresetat));
    if (cid0 && rf0) resetFloor[cid0] = Math.max(resetFloor[cid0] || 0, rf0.getTime());
    // Force Error hold: card frozen for inspection — no automatic lane touches it until Use The Last clears the…
    if (cid0 && str_(s.errorhold).toLowerCase() === 'true') holdCids[cid0] = true;
  });
  var ignored = commsIgnoredCalls_();
  var history = commsHistoryRows_(), floors = {};
  var byPhone = {}, testCand = null;
  readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (talentStage_(c.status) !== 'phone-screen') return;
    // ONE predicate for both lanes; several test cards → the NEWEST wins
    if (commsIsTestCandidate_(c)) {
      if (!testCand || commsCardWhenMs_(c) >= commsCardWhenMs_(testCand)) testCand = c;
      return;
    }
    var p = commsDigits_(c.phone).slice(-10);
    if (!p) return;
    // a company line on file identifies NOBODY
    if (SHARED_LINE_DIGITS.indexOf(p) !== -1) return;
    byPhone[p] = c;
  });
  var toAnalyze = [], debt = [], debtSeen = {}, attachedRun = {};
  for (var i = rows.length - 1; i >= 0; i--) {
    var t = rows[i];
    var quoD = commsDigits_(t.quonumber).slice(-10);
    // Only a line in COMMS_SCREEN_LINES can carry a screening.
    if (!commsIsScreenLine_(quoD)) continue;
    var callId = str_(t.callid);
    if (!callId || ignored[callId]) continue;
    if (doneCalls[callId]) {
      // ATTACHED BUT NEVER JUDGED.
      var owed = unscored[callId];
      if (owed && !holdCids[owed] && !debtSeen[owed]) { debtSeen[owed] = true; debt.push(owed); }
      continue;
    }
    var partD = commsDigits_(t.participants).slice(-10);
    var cand = (partD && SHARED_LINE_DIGITS.indexOf(partD) === -1) ? (byPhone[partD] || null)
             : testCand;
    if (!cand) continue;
    var cid = str_(cand.candidateid);
    var isTestCand = commsIsTestCandidate_(cand);
    if (attachedRun[cid]) continue;
    if (holdCids[cid]) continue;   // Force Error hold — frozen for inspection
    // a REAL candidate's screening is never overwritten; a TEST card is — every new call replaces the last (the…
    if (hasScreen[cid] && !isTestCand) continue;
    // MONOTONIC: a test card only moves forward to a NEWER call
    if (isTestCand && screenWhen[cid]) {
      var wPush = commsWhen_(t.transcriptcreated);
      if (!wPush || wPush.getTime() <= screenWhen[cid]) continue;
    }
    // same time guard as the live lane: only a call placed AFTER they reached the Phone Screen step can be their…
    if (floors[cid] === undefined) {
      floors[cid] = commsCallFloorMs_(cid, history);
      // a fresh test card never inherits a call older than itself, nor one older than the last Use The Last press
      if (isTestCand) floors[cid] = Math.max(floors[cid] || 0, commsTestCardFloorMs_(cand), resetFloor[cid] || 0);
    }
    var tWhen = commsWhen_(t.transcriptcreated);
    if (floors[cid] && (!tWhen || tWhen.getTime() < floors[cid])) continue;
    var text = str_(t.speakertranscript) || str_(t.fulltranscript);
    if (!text) continue;
    if (!commsScreenUsable_(t.durationsec, text).ok) continue;   // hung-up call
    ensureHeader_(hubSheet_(TALENT_PHONE_TAB),
      ['transcript_text', 'transcript_call_id', 'transcript_created', 'transcript_pulled_at']);
    var fields = {
      screen_date: str_(t.transcriptcreated),
      screen_status: 'Completed',
      transcript_text: commsCap_(text),
      transcript_call_id: callId,
      transcript_created: str_(t.transcriptcreated),
      transcript_pulled_at: new Date().toISOString(),
      screened_by: commsScreenedBy_(quoD, t.teammembers),
      phone_screen_id: 'PS_' + randomHex_(16).toUpperCase()
    };
    var overwriting = isTestCand && hasScreen[cid];
    if (overwriting) {
      // fresh run, fresh verdict — the previous test's score/report must go
      fields.screen_score = ''; fields.qualification = ''; fields.phone_screen_report_url = '';
      fields.final_result = ''; fields.best_in_person_day_time = '';
    }
    var summary = commsSummaryFor_(callId);
    // fill-blank ONLY for real rows — an overwritten test card takes the NEW summary outright (the old notes are…
    var existingNotes = str_(hubEvidence_(cid).screen && hubEvidence_(cid).screen.notes);
    if (summary && str_(summary.summary) && (overwriting || !existingNotes)) {
      fields.notes = 'Summary: ' + str_(summary.summary);
    } else if (overwriting) {
      fields.notes = '';
    }
    hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, fields, user, true);
    hasScreen[cid] = true;
    attachedRun[cid] = true;
    doneCalls[callId] = true;
    out.collected++;
    toAnalyze.push(cid);
  }
  if (out.collected) hubBustTalentCache_();

  // THE DEBT, AND WHY THREE PER RUN USED TO MEAN "THE REST NEVER" —.
  var order = debt.filter(function (c) { return toAnalyze.indexOf(c) === -1; }).sort();
  var cursor = 0;
  try { cursor = parseInt(hubProp_('COMMS_SCREEN_ANALYZE_CURSOR') || '0', 10) || 0; }
  catch (eC) { cursor = 0; }
  if (cursor >= order.length) cursor = 0;
  var rotated = order.length ? order.slice(cursor).concat(order.slice(0, cursor)) : [];

  var done = 0, examined = 0;
  // The wall goes at the TOP of the loop: one analysis is an AI call plus a Drive document, and a screening…
  var deadline = Date.now() + COMMS_ANALYZE_BUDGET_MS;
  // NO KEY GATE HERE EITHER: screenAnalyze decides for itself and screenAiChat_ treats a missing key as the first…
  function analyzeOne(cid) {
    done++;
    try {
      var env = HUB_ACTIONS.screenAnalyze({ candidate_id: cid }, user);
      if (env && env.status === 200) { out.analyzed++; return; }
      hubSysLog_('asa-hub:screen', 'screen_analyze_refused',
                 cid + ' — ' + (env ? env.status + ': ' + str_(env.message) : 'no envelope'),
                 { status: 502 });
    } catch (e) {
      hubSysLog_('asa-hub:screen', 'screen_analyze_threw',
                 cid + ' — ' + String((e && e.message) || e).slice(0, 200), { status: 500 });
    }
  }
  for (var a = 0; a < toAnalyze.length && done < COMMS_ANALYZE_CAP; a++) {
    if (Date.now() > deadline) break;
    analyzeOne(toAnalyze[a]);
  }
  for (var q = 0; q < rotated.length && done < COMMS_ANALYZE_CAP; q++) {
    if (Date.now() > deadline) break;
    examined++;
    analyzeOne(rotated[q]);
  }
  if (order.length) {
    try { hubPropSet_('COMMS_SCREEN_ANALYZE_CURSOR', String((cursor + examined) % order.length)); }
    catch (eS) { /* a cursor that cannot be saved costs a repeat, never a lost screening */ }
  }
  // What this pass still owes — collected and analyzed were two independent numbers and nobody ever subtracted them.
  out.pending = Math.max(0, (toAnalyze.length + order.length) - done);
  return out;
}

/** Editor convenience (▶ Run). */
function runCommsSync() {
  var out = HUB_ACTIONS.commsSync({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out.data || out));
  return out;
}

/** Time-trigger handler: the collection is Python's now (app/screening* commsSyncSweep, the relay's clock), so the
 *  trigger still installed answers without doing anything. */
function commsAutoSync() {
  return { status: 200, data: { moved: 'python' } };
}

// Run ONCE in the editor (▶ Run): installs BOTH triggers (safe to re-run).
function installCommsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'commsAutoSync' || fn === 'commsOnQuoChange') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('commsAutoSync').timeBased().everyMinutes(15).create();
  var push = 'NOT installed';
  try {
    ScriptApp.newTrigger('commsOnQuoChange').forSpreadsheet(hubId_('QUO_SYNC_SHEET_ID')).onChange().create();
    push = 'installed';
  } catch (err) {
    push = 'NOT installed (' + (err && err.message ? err.message : err) +
           ') — the 15-minute safety net still collects calls.';
  }
  Logger.log('commsAutoSync: every 15 min. Push onChange: ' + push);
  return push;
}

/** Digits only, from any phone-ish value. */
function commsDigits_(s) { return String(s || '').replace(/\D+/g, ''); }

// TIME GUARD: while a call is in progress NO transcript row exists yet, so matching the newest row in the tail…
var COMMS_STAGE_GRACE_MS = 300000;   // 5 min

// QUALITY BAR (an 11-second call was once captured as a full screening): a hung-up call still gets a transcript…
var COMMS_MIN_SCREEN_SEC = 60;

// The validation lane needs an EXPLICIT target: legacy imports carry company lines too, so a REAL person must never…
var COMMS_TEST_CANDIDATE_IDS = ['CAN_CFEA7CE713095581517B',
  // `Jhonatan` — a declared TEST card, alongside `Line Up`.
  'CAN_7DF46D98345D8F032F02',
  // `Devona Johnson` — a declared TEST card.
  'CAN_FCBBC0985BF468A0FD55'];

// A STANDING RULE: a candidate CARD carrying the test phone (+1 330 919-5558, the Automations line) OR the test…
var COMMS_OPERATOR_TEST_LINE = '3309195558';
var COMMS_OPERATOR_TEST_EMAIL = 'asatech@asalifecare.com';

/** True for the platform's own test line. */
function commsIsOperatorLine_(v) {
  return commsDigits_(v).slice(-10) === COMMS_OPERATOR_TEST_LINE;
}

/** A card bound to the test identity (that line or that e-mail). */
function commsIsOperatorCard_(c) {
  if (!c) return false;
  if (commsIsOperatorLine_(c.phone)) return true;
  return str_(c.email).toLowerCase() === COMMS_OPERATOR_TEST_EMAIL;
}

/** The ONE predicate every lane uses to tell a test card from a real one. */
function commsIsTestCandidate_(c) {
  if (!c) return false;
  if (COMMS_TEST_CANDIDATE_IDS.indexOf(str_(c.candidateid)) !== -1) return true;
  // …and the configured list, a cell (sim_test_candidate_ids) — ids move faster than publishes during testing.
  try {
    if (typeof simCfgList_ === 'function' &&
        simCfgList_('sim_test_candidate_ids').indexOf(str_(c.candidateid)) !== -1) return true;
  } catch (e) { /* an unreadable cell never widens OR narrows the floor */ }
  if (str_(c.candidatename).toLowerCase().indexOf('[test]') === 0) return true;
 // The simulation actor mailboxes: a card holding one platform-owned asa-hubN@asaop.org addresses is a rehearsal…
  if (/^asa-hub[0-9]*@asaop\.org$/.test(str_(c.email).toLowerCase())) return true;
  return commsIsOperatorCard_(c);
}

/** created_at (falling back to updated_at) as ms — 0 when unreadable. */
function commsCardWhenMs_(c) {
  var d = new Date(str_(c && c.createdat) || str_(c && c.updatedat));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// A fresh test card never inherits a call older than itself: it must not open already complete.
function commsTestCardFloorMs_(c) {
  return commsCardWhenMs_(c) || 0;
}

// Fresh run on the test identity = the OLD test screenings go, by standing rule.
function commsPurgeOperatorScreens_(keepCid, user) {
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var opCards = {};
  readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    var cid = str_(c.candidateid);
    if (!cid || cid === str_(keepCid)) return;
    if (commsIsOperatorCard_(c)) opCards[cid] = true;
  });
  if (!Object.keys(opCards).length) return 0;
  var sheet = (typeof runtimeSheetFor_ === 'function' && runtimeSheetFor_(TALENT_PHONE_TAB)) ||
              db.getSheetByName(TALENT_PHONE_TAB);
  if (!sheet) return 0;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) { return 0; }
  try {
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return 0;
    var hdr = values[0].map(normKey_);
    var iCid = hdr.indexOf('candidateid');
    var iCall = hdr.indexOf('transcriptcallid');
    if (iCid === -1) return 0;
    var ignTab = null;
    try { ignTab = ssOpen_(hubId_('HUB_COMMS_ID')).getSheetByName('ignored_calls'); } catch (eT) { /* optional */ }
    var removed = 0;
    for (var r = values.length - 1; r >= 1; r--) {
      if (!opCards[str_(values[r][iCid])]) continue;
      var freedCall = iCall === -1 ? '' : str_(values[r][iCall]);
      if (freedCall && ignTab) {
        try { ignTab.appendRow([freedCall, 'test-lane reset by ' + str_(user && user.email), new Date().toISOString()]); } catch (eA) { /* best effort */ }
      }
      sheet.deleteRow(r + 1);
      removed++;
    }
    if (removed) {
      hubBustTalentCache_();
      hubSysLog_(user && user.email, 'test_lane_reset',
        removed + ' old test screening(s) on the test identity cleared', { status: 200 });
    }
    return removed;
  } finally {
    lock.releaseLock();
  }
}

/** Was this call a real screening (long enough, both sides speaking)? */
function commsScreenUsable_(durationSec, text) {
  var secs = Number(durationSec) || 0;
  var speakers = {}, n = 0;
  var re = /\]\s*([^:\n]{3,40}):/g, m;
  while ((m = re.exec(String(text || ''))) !== null) speakers[m[1].trim()] = true;
  for (var k in speakers) n++;
  // Speaker-labelled transcript: demand both sides.
  var bothSides = n === 0 ? true : n >= 2;
  return { ok: secs >= COMMS_MIN_SCREEN_SEC && bothSides, secs: secs, speakers: n };
}

// Calls retired by hand — tab `ignored_calls` (call_id, reason, added_at) in OUR Comms spreadsheet.
var COMMS_IGNORED_TAB = 'ignored_calls';

/** Retired call ids as a map. */
function commsIgnoredCalls_() {
  // Read FRESH every time — this is an operator lever; a cached copy kept attaching a just-ignored call for minutes.
  var map = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), COMMS_IGNORED_TAB)
      .forEach(function (r) { var id = str_(r.callid); if (id) map[id] = true; });
  } catch (e) { /* tab not created yet */ }
  return map;
}

/** log_status_history rows (empty when the tab does not exist yet). */
function commsHistoryRows_() {
  try {
    return readTabNormalized_(hubTabWorkbook_('log_status_history'), 'log_status_history');
  } catch (e) {
    return [];   // tab not created yet — no floor, legacy behaviour
  }
}

/** Millisecond floor for a candidate's screening call (0 = no floor). */
function commsCallFloorMs_(cid, history) {
  var when = null;
  for (var i = 0; i < history.length; i++) {
    if (str_(history[i].candidateid) !== cid) continue;
    if (str_(history[i].tostatus).toLowerCase() !== 'phone screen') continue;
    var d = new Date(str_(history[i].timestamp));
    if (!isNaN(d.getTime())) when = d;      // latest entry into the stage wins
  }
  return when ? when.getTime() - COMMS_STAGE_GRACE_MS : 0;
}

/** Latest summary row for a call id (or null). */
function commsSummaryFor_(callId) {
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'summaries');
  for (var i = rows.length - 1; i >= 0; i--) {
    if (str_(rows[i].callid) === String(callId)) return rows[i];
  }
  return null;
}

// REAL-TIME lane — PUSH, NEVER polling (both rules: the recruiter must see the outcome while the candidate is still…

var SCREEN_READY_TTL = 120;    // 2 min — the drawer polls every 20s

/** Cache key holding a candidate's parked screening result. */
function screenReadyKey_(cid) { return 'scr_' + cid; }

/** Park a finished screening result for the drawer's watch tick. */
function screenReadyPut_(cid, data) {
  try {
    CacheService.getScriptCache().put(screenReadyKey_(cid), JSON.stringify(data), SCREEN_READY_TTL);
  } catch (e) { /* cache full/oversized — the drawer's deep tick still finds it */ }
}

// Scan the TAIL of the live phone sheet and attach any call belonging to a candidate at the phone-screen stage…
function commsCollectFromQuoTail_(user, tailRows, onlyCid) {
  var src = ssOpen_(hubId_('QUO_SYNC_SHEET_ID')).getSheetByName('Transcripts');
  if (!src || src.getLastRow() < 2) return 0;
  var lastRow = src.getLastRow(), lastCol = src.getLastColumn();
  var hdr = src.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h); });
  var iId = hdr.indexOf('Call ID'), iWhen = hdr.indexOf('Transcript Created');
  var iQuo = hdr.indexOf('Quo Number'), iPart = hdr.indexOf('Participant(s)');
  var iFull = hdr.indexOf('Full Transcript'), iSpk = hdr.indexOf('Speaker Transcript');
  var iDur = hdr.indexOf('Duration (sec)');
  var start = Math.max(2, lastRow - tailRows + 1);
  var vals = src.getRange(start, 1, lastRow - start + 1, lastCol).getValues();

  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var doneCalls = {}, hasScreen = {}, screenWhen = {}, resetFloor = {}, holdCids = {};
  readTabNormalized_(db, TALENT_PHONE_TAB).forEach(function (s) {
    var c0 = str_(s.candidateid);
    if (str_(s.transcriptcallid)) doneCalls[str_(s.transcriptcallid)] = true;
    // a screening the recruiter ran by hand counts too — never overwrite it
    if (c0 && (str_(s.transcripttext) || str_(s.transcriptcallid) ||
               str_(s.screenstatus).toLowerCase() === 'completed')) hasScreen[c0] = true;
    var w0 = commsWhen_(str_(s.transcriptcreated) || str_(s.screendate));
    if (c0 && w0) screenWhen[c0] = Math.max(screenWhen[c0] || 0, w0.getTime());
    // Use The Last floor — calls older than the press never attach
    var rf0 = commsWhen_(str_(s.uselastresetat));
    if (c0 && rf0) resetFloor[c0] = Math.max(resetFloor[c0] || 0, rf0.getTime());
    // Force Error hold — frozen for inspection until Use The Last
    if (c0 && str_(s.errorhold).toLowerCase() === 'true') holdCids[c0] = true;
  });
  var ignored = commsIgnoredCalls_();
  var history = commsHistoryRows_(), floors = {};
  var byPhone = {}, testCand = null;
  readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (talentStage_(c.status) !== 'phone-screen') return;
    if (onlyCid && str_(c.candidateid) !== onlyCid) return;
    // several test cards → the NEWEST wins, deterministically
    if (commsIsTestCandidate_(c)) {
      if (!testCand || commsCardWhenMs_(c) >= commsCardWhenMs_(testCand)) testCand = c;
      return;
    }
    var p = commsDigits_(c.phone).slice(-10);
    if (!p) return;
    // a company line on file identifies NOBODY (legacy imports carry them)
    if (SHARED_LINE_DIGITS.indexOf(p) !== -1) return;
    byPhone[p] = c;
  });
  var attached = 0, attachedRun = {};
  for (var r = vals.length - 1; r >= 0; r--) {
    var callId = str_(vals[r][iId]);
    if (!callId || doneCalls[callId] || ignored[callId]) continue;
    var quoD = commsDigits_(vals[r][iQuo]).slice(-10);
    // A company line that is NOT a screening line must never be attached.
    if (!commsIsScreenLine_(quoD)) continue;
    var partD = commsDigits_(vals[r][iPart]).slice(-10);
    var cand = null;
    if (partD && SHARED_LINE_DIGITS.indexOf(partD) === -1) {
      cand = byPhone[partD] || null;         // real candidate calling 4040
    } else {
      cand = testCand;                       // 5558 = the test line
    }
    if (!cand) continue;
    var cid = str_(cand.candidateid);
    var isTestCand = commsIsTestCandidate_(cand);
    if (attachedRun[cid]) continue;
    if (holdCids[cid]) continue;   // Force Error hold — frozen for inspection
    // a REAL screening is never overwritten; a test card is
    if (hasScreen[cid] && !isTestCand) continue;
    // MONOTONIC: a test card only moves forward to a NEWER call
    if (isTestCand && screenWhen[cid]) {
      var wLive = commsWhen_(vals[r][iWhen]);
      if (!wLive || wLive.getTime() <= screenWhen[cid]) continue;
    }
    // the screening call must be NEWER than their arrival at the stage
    if (floors[cid] === undefined) {
      floors[cid] = commsCallFloorMs_(cid, history);
      // never a call older than the card itself or than the last reset press
      if (isTestCand) floors[cid] = Math.max(floors[cid] || 0, commsTestCardFloorMs_(cand), resetFloor[cid] || 0);
    }
    var callWhen = commsWhen_(vals[r][iWhen]);
    if (floors[cid] && (!callWhen || callWhen.getTime() < floors[cid])) continue;
    var text = str_(vals[r][iSpk]) || str_(vals[r][iFull]);
    if (!text) continue;
    // a hung-up call is not a screening — keep listening for the real one
    if (!commsScreenUsable_(iDur === -1 ? 0 : vals[r][iDur], text).ok) continue;

    ensureHeader_(hubSheet_(TALENT_PHONE_TAB),
      ['transcript_text', 'transcript_call_id', 'transcript_created', 'transcript_pulled_at']);
    var liveFields = {
      screen_date: str_(vals[r][iWhen]),
      screen_status: 'Completed',
      transcript_text: commsCap_(text),
      transcript_call_id: callId,
      transcript_created: str_(vals[r][iWhen]),
      transcript_pulled_at: new Date().toISOString(),
      screened_by: 'asa-hub:auto-collect',
      // a row without an id is invisible to the legacy upsert and gets shadowed by a later import — always stamp one
      phone_screen_id: 'PS_' + randomHex_(16).toUpperCase()
    };
    if (isTestCand && hasScreen[cid]) {
      // fresh run, fresh verdict — the previous test's result must go
      liveFields.screen_score = ''; liveFields.qualification = '';
      liveFields.phone_screen_report_url = ''; liveFields.final_result = '';
      liveFields.notes = ''; liveFields.best_in_person_day_time = '';
    }
    hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, liveFields, user, true);
    hasScreen[cid] = true;
    attachedRun[cid] = true;
    doneCalls[callId] = true;
    attached++;
    hubBustTalentCache_();

    // Analyze immediately — the recruiter is watching the drawer — and LOG every failure: this call is internal…
    var analysis = null;
    try {
      var env = HUB_ACTIONS.screenAnalyze({ candidate_id: cid }, user);
      if (env && env.status === 200) {
        analysis = env.data;
      } else {
        hubSysLog_('asa-hub:screen', 'screen_analyze_refused',
                   cid + ' — ' + (env ? env.status + ': ' + str_(env.message) : 'no envelope'),
                   { status: 502 });
      }
    } catch (e) {
      hubSysLog_('asa-hub:screen', 'screen_analyze_threw',
                 cid + ' — ' + String((e && e.message) || e).slice(0, 200), { status: 500 });
    }
    var after = hubEvidence_(cid).screen || {};
    screenReadyPut_(cid, {
      state: 'ready', call_id: callId, created: str_(vals[r][iWhen]), chars: text.length,
      // the client must not green the AI-report checkpoint when no report exists
      analyzed: !!(analysis || str_(after.phonescreenreporturl)),
      qualification: analysis ? analysis.qualification : str_(after.qualification),
      score: analysis ? analysis.score : str_(after.screenscore),
      summary: analysis ? str_(analysis.summary) : '',
      report_url: analysis ? analysis.report_url : str_(after.phonescreenreporturl),
      best_in_person_day_time: str_(after.bestinpersondaytime)
    });
  }
  return attached;
}

/** onChange handler on the phone sheet: a screen's call is collected by Python now (app/screening* screenCollectSweep,
 *  the relay's fast beat), so the trigger still installed answers without doing anything. */
function commsOnQuoChange(e) {
  return { status: 200, data: { moved: 'python' } };
}

// Drawer watch tick.
HUB_POLICY.screenWatch = {
  file: 'Comms.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.screenWatch = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };

  // CHEAP tick: the parked result only.
  if (!payload.deep) {
    var hit = CacheService.getScriptCache().get(screenReadyKey_(cid));
    if (hit) {
      try { return { status: 200, data: JSON.parse(hit) }; } catch (e) { /* fall through */ }
    }
    return { status: 200, data: { state: 'waiting' } };
  }

  // deep tick (bounded): scan the tail for THIS candidate only
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (talentStage_(ev.cand.status) !== 'phone-screen') {
    return { status: 200, data: { state: 'not-screening' } };
  }
  var s = ev.screen || {};
  var isTestWatch = commsIsTestCandidate_(ev.cand);
  if ((str_(s.transcripttext) || str_(s.transcripturl)) && !isTestWatch) {
    var ready = { state: 'ready', already: true,
      qualification: str_(s.qualification), score: str_(s.screenscore),
      summary: '', report_url: str_(s.phonescreenreporturl),
      analyzed: !!str_(s.phonescreenreporturl),
      best_in_person_day_time: str_(s.bestinpersondaytime) };
    screenReadyPut_(cid, ready);
    return { status: 200, data: ready };
  }
  // A TEST card always re-scans (a NEWER call may replace the last one — the test loop)…
  commsCollectFromQuoTail_(user, 25, cid);
  var after = CacheService.getScriptCache().get(screenReadyKey_(cid));
  if (after) {
    try { return { status: 200, data: JSON.parse(after) }; } catch (e) { /* ignore */ }
  }
  // …and when nothing NEW landed, the CURRENT screening is re-parked, not evicted — the drawer must keep showing…
  if (isTestWatch) {
    var s2 = hubEvidence_(cid).screen || {};
    if (str_(s2.transcripttext) || str_(s2.transcripturl)) {
      var readyKeep = { state: 'ready', already: true,
        qualification: str_(s2.qualification), score: str_(s2.screenscore),
        summary: '', report_url: str_(s2.phonescreenreporturl),
        analyzed: !!str_(s2.phonescreenreporturl),
        best_in_person_day_time: str_(s2.bestinpersondaytime) };
      screenReadyPut_(cid, readyKeep);
      return { status: 200, data: readyKeep };
    }
  }
  // Deep tick proved there is no screening evidence — drop any stale flag (e.g. the screen row was wiped to re-run…
  try { CacheService.getScriptCache().remove(screenReadyKey_(cid)); } catch (e) { /* fine */ }
  return { status: 200, data: { state: 'waiting' } };
};

/** Pull a candidate's screening call from OUR transcripts tab onto their row. */
HUB_POLICY.screenPullTranscript = {
  file: 'Comms.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.screenPullTranscript = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (str_(ev.screen && ev.screen.errorhold).toLowerCase() === 'true') {
    return { status: 409, message: bookText_('Strings', 'refuse.comms.error_hold', '') };
  }

  var phone = commsDigits_(ev.cand.phone);
  if (phone.length >= 11 && phone.charAt(0) === '1') phone = phone.slice(1);
  phone = phone.slice(-10);
  if (phone.length < 10) {
    return { status: 409, message: bookText_('Strings', 'refuse.comms.no_phone', '') };
  }

  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts');
  var ignoredPull = commsIgnoredCalls_();
  rows = rows.filter(function (r) { return !ignoredPull[str_(r.callid)]; });
  var isTest = commsIsTestCandidate_(ev.cand);
  if (!isTest && SHARED_LINE_DIGITS.indexOf(phone) !== -1) {
    // A company line identifies NOBODY and only an explicit test candidate uses the validation lane — removing this…
    return { status: 409, message: bookText_('Strings', 'refuse.comms.company_line', '') };
  }

  // A fresh TEST card starts EMPTY: only a call placed after the card was created qualifies; a Use The Last press…
  var testFloorMs = isTest ? commsTestCardFloorMs_(ev.cand) : 0;
  if (isTest) {
    var resetAt = commsWhen_(str_(ev.screen && ev.screen.uselastresetat));
    if (resetAt) testFloorMs = Math.max(testFloorMs, resetAt.getTime());
  }
  // Walk newest-first and keep going until a USABLE call turns up: a short call-back after a real screening must…
  var hit = null, skipped = 0, lastBad = null, tooOld = 0;
  for (var r = rows.length - 1; r >= 0 && !hit; r--) {
    var quoD = commsDigits_(rows[r].quonumber).slice(-10);
    if (!commsIsScreenLine_(quoD)) continue;   // screenings live on our screen line
    var partD = commsDigits_(rows[r].participants).slice(-10);
    var mine = isTest
      ? (partD === '' || SHARED_LINE_DIGITS.indexOf(partD) !== -1)   // validation call
      : (commsDigits_(rows[r].participants).indexOf(phone) !== -1);
    if (!mine) continue;
    if (testFloorMs) {
      var wPull = commsWhen_(rows[r].transcriptcreated);
      if (!wPull || wPull.getTime() < testFloorMs) { tooOld++; continue; }
    }
    var body = str_(rows[r].speakertranscript) || str_(rows[r].fulltranscript);
    if (!body) continue;
    var q = commsScreenUsable_(rows[r].durationsec, body);
    if (!q.ok) { skipped++; lastBad = q; continue; }   // hung-up call, look further back
    hit = rows[r];
  }
  if (!hit) {
    if (lastBad) {
      return { status: 409, message: hiringRenderMail_(
        bookText_('Strings', 'refuse.comms.calls_too_short', ''), {
          // The seam supplies the space: a sheet trims a trailing one off a cell.
          which: bookText_('Strings', skipped === 1
            ? 'refuse.comms.short.only' : 'refuse.comms.short.latest', '') + ' ',
          secs: String(lastBad.secs),
          assistant: lastBad.speakers === 1
            ? ' ' + bookText_('Strings', 'refuse.comms.short.assistant_only', '') : ''
        }) };
    }
    if (tooOld) {
      return { status: 404, message: hiringRenderMail_(
        bookText_('Strings', 'refuse.comms.none_since_card', ''), { older: String(tooOld) }) };
    }
    return { status: 404, message: bookText_('Strings', 'refuse.comms.none_in_window', '') };
  }
  var text = str_(hit.speakertranscript) || str_(hit.fulltranscript);

  var own = hubSheet_(TALENT_PHONE_TAB);
  ensureHeader_(own, ['transcript_text', 'transcript_call_id', 'transcript_created', 'transcript_pulled_at']);
  var fields = {
    transcript_text: commsCap_(text),
    transcript_call_id: str_(hit.callid),
    transcript_created: str_(hit.transcriptcreated),
    transcript_pulled_at: new Date().toISOString()
  };
  var pullOverwriting = isTest && str_(ev.screen && ev.screen.transcriptcallid) &&
    str_(ev.screen.transcriptcallid) !== str_(hit.callid);
  if (pullOverwriting) {
    // a re-pulled test card takes the NEW call whole — no stale verdict
    fields.screen_date = str_(hit.transcriptcreated);
    fields.screen_status = 'Completed';
    fields.screen_score = ''; fields.qualification = '';
    fields.phone_screen_report_url = ''; fields.final_result = '';
    fields.notes = ''; fields.best_in_person_day_time = '';
  }
  // Fill-blank the notes with the call summary when we already derived one.
  var summary = commsSummaryFor_(str_(hit.callid));
  if (summary && str_(summary.summary) && (pullOverwriting || !str_(ev.screen && ev.screen.notes))) {
    fields.notes = 'Summary: ' + str_(summary.summary);
  }
  hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, fields, user, true);
  hubBustTalentCache_();
  return { status: 200, data: {
    found: true, call_id: str_(hit.callid), created: str_(hit.transcriptcreated),
    duration_sec: str_(hit.durationsec), turns: str_(hit.turns),
    chars: text.length, has_summary: !!summary,
    preview: text.slice(0, 300)
  } };
};

// USE THE LAST — the test loop, by design.
var COMMS_OPERATOR_LINE_DIGITS = '3309195558';

HUB_POLICY.screenUseLast = {
  file: 'Comms.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};
HUB_ACTIONS.screenUseLast = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: bookText_('Strings', 'refuse.candidate_id', '') };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: hiringRenderMail_(bookText_('Strings', 'refuse.no_candidate', ''), { id: cid }) };
  if (talentStage_(ev.cand.status) !== 'phone-screen') {
    return { status: 409, message: bookText_('Strings', 'refuse.use_last.stage', '') };
  }
 // TEST CARDS ONLY (review ): this button retires every call the line — on a real applicant that is destruction…
  if (!commsIsTestCandidate_(ev.cand)) {
    return { status: 403, message: bookText_('Strings', 'refuse.use_last.test_only', '') };
  }

  // 1.
  var nowIso = new Date().toISOString();
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts');
  var ignored = commsIgnoredCalls_();
  var retire = [];
  for (var r = 0; r < rows.length; r++) {
    var rCallId = str_(rows[r].callid);
    if (!rCallId || ignored[rCallId]) continue;
    if (commsDigits_(rows[r].quonumber).slice(-10) !== COMMS_SCREEN_BOT_LINE) continue;
    var part = commsDigits_(rows[r].participants);
    var partD = part.slice(-10);
    // TEST calls only: line-to-line, the test number, or a company line.
    var his = partD === '' || part.indexOf(COMMS_OPERATOR_LINE_DIGITS) !== -1 ||
              SHARED_LINE_DIGITS.indexOf(partD) !== -1;
    if (his) retire.push(rCallId);
  }
  // The attached call id is retired even if the mirror window no longer holds it (7-day tail) — it must never come…
  var oldCallId = str_(ev.screen && ev.screen.transcriptcallid);
  if (oldCallId && !ignored[oldCallId] && retire.indexOf(oldCallId) === -1) retire.push(oldCallId);
  if (retire.length) {
    try {
      var ignTab = ssOpen_(hubId_('HUB_COMMS_ID')).getSheetByName('ignored_calls');
      if (ignTab) {
        // appendRow per id (atomic) — a ranged batch write could land on a row another writer appends at the same…
        retire.forEach(function (id) {
          ignTab.appendRow([id, 'use-the-last reset by ' + str_(user.email), nowIso]);
        });
      }
    } catch (eIgn) { /* best effort — the reset floor below still blocks them */ }
  }

  // 2.
  ensureHeader_(hubSheet_(TALENT_PHONE_TAB), ['use_last_reset_at', 'error_hold', 'date_accepted_alert_at']);
  hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, {
    screen_status: '', screen_date: '',
    transcript_text: '', transcript_call_id: '', transcript_created: '', transcript_pulled_at: '',
    screen_score: '', qualification: '', phone_screen_report_url: '',
    final_result: '', notes: '', best_in_person_day_time: '',
    // Use The Last is the ONE door out of the Force Error held state
    error_hold: '', date_accepted_alert_at: '',
    use_last_reset_at: nowIso
  }, user, true);
  try { CacheService.getScriptCache().remove(screenReadyKey_(cid)); } catch (e) { /* stale flag dies with TTL */ }
  hubBustTalentCache_();
  hubSysLog_(user && user.email, 'screen_use_last',
    cid + ' — ' + hiringRenderMail_(bookText_('Strings', 'use_last.logged', ''),
                                    { retired: String(retire.length) }), { status: 200 });
  return { status: 200, data: { reset: true, retired: retire.length,
    message: bookText_('Strings', 'use_last.said', '') } };
};

// ▶ WHO IS ACTUALLY DOING THE PHONE SCREENS — reads the same mirror rows the collect lane walks, writes nothing.
function runScreenLineProbe() {
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts');
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var byPhone = {}, waiting = 0;
  readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (talentStage_(c.status) !== 'phone-screen') return;
    waiting++;
    var p = commsDigits_(c.phone).slice(-10);
    if (!p || SHARED_LINE_DIGITS.indexOf(p) !== -1) return;
    byPhone[p] = str_(c.candidatename) || str_(c.candidateid);
  });
  var lines = {};
  // THE CALLS THAT CARRY NO LINE ARE COUNTED, NEVER SWEPT INTO ONE BUCKET.
  var noLine = { calls: 0, empty: 0, unresolved: 0, by_provider_id: {}, repaired: 0,
                 directory: commsLineDirectoryState_() };
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i];
    var quoRaw = str_(t.quonumber);
    var quo = commsDigits_(quoRaw).slice(-10);
    if (quo.length !== 10) {
      noLine.calls++;
      var isId = commsIsProviderLineId_(quoRaw);
      var fixed = isId ? commsLineFromRaw_(quoRaw) : '';
      if (fixed) {
        noLine.repaired++;
        noLine.by_provider_id[quoRaw] = (noLine.by_provider_id[quoRaw] || 0) + 1;
        quo = fixed;
      } else if (isId) {
        noLine.unresolved++;
        noLine.by_provider_id[quoRaw] = (noLine.by_provider_id[quoRaw] || 0) + 1;
        quo = '(a provider line id the directory could not resolve)';
      } else {
        noLine.empty++;
        quo = '(no line on the row)';
      }
    }
    var L = lines[quo] || (lines[quo] = { calls: 0, with_transcript: 0, usable: 0,
                                          matches_waiting: 0, who: {}, matched: [] });
    L.calls++;
    var who = str_(t.teammembers).split(/[,;]/)[0].trim();
    if (who) L.who[who] = (L.who[who] || 0) + 1;
    var text = str_(t.speakertranscript) || str_(t.fulltranscript);
    if (!text) continue;
    L.with_transcript++;
    if (!commsScreenUsable_(t.durationsec, text).ok) continue;
    L.usable++;
    var part = commsDigits_(t.participants).slice(-10);
    if (part && byPhone[part]) {
      L.matches_waiting++;
      if (L.matched.length < 8) L.matched.push(byPhone[part] + ' · ' + str_(t.transcriptcreated).slice(0, 10));
    }
  }
  // EVERY LINE NAMED, NOT TWO.
  var named = {};
  Object.keys(lines).forEach(function (k) { named[commsLineLabel_(k)] = lines[k]; });
  var out = { window_days: COMMS_WINDOW_DAYS, transcript_rows: rows.length,
              candidates_at_phone_screen: waiting, by_line: named,
              calls_with_no_line: noLine,
              screening_lines: COMMS_SCREEN_LINES };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ▶ WHICH LINE IS WHICH — asks OpenPhone for the line NAMES and the people on them and prints that beside our call…
function runOpenPhoneLines() {
  var key = hubProp_(SCRAPER_OPENPHONE_PROP);
  if (!key) { Logger.log('No OPENPHONE_API_KEY in Script Properties.'); return { ok: false }; }

  var res;
  try {
    res = UrlFetchApp.fetch('https://api.openphone.com/v1/phone-numbers',
      { headers: { Authorization: key }, muteHttpExceptions: true });
  } catch (e) {
    Logger.log('OpenPhone unreachable: ' + e);
    return { ok: false, error: String(e) };
  }
  if (res.getResponseCode() !== 200) {
    Logger.log('OpenPhone answered ' + res.getResponseCode() + ' — the key may be revoked or lack scope.');
    return { ok: false, status: res.getResponseCode() };
  }

  // Call counts from OUR mirror, so name and volume are read side by side.
  var counts = {}, countsRead = true, countsWhy = '';
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts').forEach(function (t) {
      var d = commsDigits_(t.quonumber).slice(-10);
      if (d) counts[d] = (counts[d] || 0) + 1;
    });
  } catch (eC) {
    countsRead = false;
    countsWhy = 'the comms mirror could not be read: ' + String((eC && eC.message) || eC);
  }

  var lines = [];
  ((JSON.parse(res.getContentText()) || {}).data || []).forEach(function (p) {
    var digits = commsDigits_(p.number).slice(-10);
    var who = (p.users || []).map(function (u) {
      return ((str_(u.firstName) + ' ' + str_(u.lastName)).trim() || str_(u.email));
    }).filter(String);
    lines.push({
      number: str_(p.number),
      name: str_(p.name),
      people: who,
      calls_7d: countsRead ? (counts[digits] || 0) : null,
      is_screening_line: commsIsScreenLine_(digits)
    });
  });
  lines.sort(function (a, b) { return (b.calls_7d || 0) - (a.calls_7d || 0); });
  var out = { ok: true, lines: lines, screening_lines: COMMS_SCREEN_LINES,
              calls_counted: countsRead,
              calls_why: countsRead ? '' : countsWhy };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// >> THE BIG CROSS — every call in the mirror against everyone we know (candidate roster at any stage, staff…
function runBigCross() {
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var calls = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts');

  // --- who we know, by last-10 digits -------------------------------------
  var cand = {}, candCount = 0;
  readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    var d = commsDigits_(c.phone).slice(-10);
    if (!d || SHARED_LINE_DIGITS.indexOf(d) !== -1) return;
    candCount++;
    cand[d] = { id: str_(c.candidateid),
                name: str_(c.candidatename) || (str_(c.firstname) + ' ' + str_(c.lastname)).trim(),
                stage: talentStage_(c.status) || str_(c.status) };
  });
  var staff = {};
  try {
    readTabNormalized_(db, 'people').forEach(function (p) {
      var d = commsDigits_(p.phone).slice(-10);
      if (d && SHARED_LINE_DIGITS.indexOf(d) === -1 && !cand[d]) staff[d] = str_(p.name) || str_(p.fullname);
    });
  } catch (eP) { /* no people tab — the classification just has one fewer bucket */ }
  var hasScreen = {};
  readTabNormalized_(db, TALENT_PHONE_TAB).forEach(function (s2) {
    var cid = str_(s2.candidateid);
    if (cid && (str_(s2.transcripttext) || str_(s2.transcriptcallid) ||
                str_(s2.screenstatus).toLowerCase() === 'completed')) hasScreen[cid] = true;
  });

  // --- the cross ----------------------------------------------------------
  var byLine = {}, perCand = {}, missed = {};
  // Same three facts as the probe: a row carrying a provider line id is repaired, one carrying an id the directory…
  var noLine = { calls: 0, empty: 0, unresolved: 0, by_provider_id: {}, repaired: 0,
                 directory: commsLineDirectoryState_() };
  for (var i = 0; i < calls.length; i++) {
    var t = calls[i];
    var lineRaw = str_(t.quonumber);
    var line = commsDigits_(lineRaw).slice(-10);
    if (line.length !== 10) {
      noLine.calls++;
      var lineIsId = commsIsProviderLineId_(lineRaw);
      var lineFixed = lineIsId ? commsLineFromRaw_(lineRaw) : '';
      if (lineFixed) {
        noLine.repaired++;
        noLine.by_provider_id[lineRaw] = (noLine.by_provider_id[lineRaw] || 0) + 1;
        line = lineFixed;
      } else if (lineIsId) {
        noLine.unresolved++;
        noLine.by_provider_id[lineRaw] = (noLine.by_provider_id[lineRaw] || 0) + 1;
        line = '(a provider line id the directory could not resolve)';
      } else {
        noLine.empty++;
        line = '(no line on the row)';
      }
    }
    var L = byLine[line] || (byLine[line] = { calls: 0, to_candidate: 0, to_staff: 0,
                                              to_our_line: 0, to_unknown: 0, usable: 0,
                                              is_screening_line: commsIsScreenLine_(line),
                                              candidates: [] });
    L.calls++;
    var text = str_(t.speakertranscript) || str_(t.fulltranscript);
    if (text && commsScreenUsable_(t.durationsec, text).ok) L.usable++;
    var other = commsDigits_(t.participants).slice(-10);
    // The other party being one of OUR OWN lines is line-to-line traffic, not an unidentified person.
    if (!other) { L.to_unknown++; continue; }
    if (commsLineOurs_(other)) { L.to_our_line++; continue; }
    var c = cand[other];
    if (!c) { if (staff[other]) L.to_staff++; else L.to_unknown++; continue; }

    L.to_candidate++;
    if (L.candidates.indexOf(c.name) === -1 && L.candidates.length < 12) L.candidates.push(c.name);
    var when = str_(t.transcriptcreated).slice(0, 10);
    var K = perCand[c.id] || (perCand[c.id] = { name: c.name, stage: c.stage, calls: 0,
                                                lines: {}, first: when, last: when,
                                                has_screen: !!hasScreen[c.id] });
    K.calls++;
    K.lines[line] = (K.lines[line] || 0) + 1;
    if (when < K.first) K.first = when;
    if (when > K.last) K.last = when;
    // A conversation that happened, on a card that does not know it did.
    if (!hasScreen[c.id] && text && commsScreenUsable_(t.durationsec, text).ok) {
      missed[c.id] = { name: c.name, stage: c.stage, line: line, when: when };
    }
  }

  var lines = Object.keys(byLine).sort(function (a, b) { return byLine[b].to_candidate - byLine[a].to_candidate; });
  var ranked = {};
  lines.forEach(function (k) {
    var L = byLine[k];
    // The number that decides: of the calls this line placed to somebody we could identify, how many were to a…
    var known = L.to_candidate + L.to_staff;
    L.candidate_share = known ? Math.round(100 * L.to_candidate / known) + '%' : 'n/a';
    ranked[commsLineLabel_(k) + (L.is_screening_line ? '  <= screening line today' : '')] = L;
  });

  var missedList = [];
  for (var m in missed) if (missed.hasOwnProperty(m)) missedList.push(missed[m]);

  var out = {
    window_days: COMMS_WINDOW_DAYS,
    calls_in_mirror: calls.length,
    candidates_with_a_phone: candCount,
    staff_with_a_phone: Object.keys(staff).length,
    by_line: ranked,
    calls_with_no_line: noLine,
    conversations_the_pipeline_missed: missedList,
    per_candidate: perCand,
    screening_lines_today: COMMS_SCREEN_LINES
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// >> WHO CALLED THE SCREENING LINE AND IS NOBODY WE KNOW — lost intake is invisible by construction: a person who…
function runUnknownCallers(allLines) {
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var calls = readTabNormalized_(ssOpen_(hubId_('HUB_COMMS_ID')), 'transcripts');

  var known = {};
  readTabNormalized_(db, TALENT_CANDIDATES_TAB).forEach(function (c) {
    var d = commsDigits_(c.phone).slice(-10);
    if (d) known[d] = 'candidato: ' + (str_(c.candidatename) || str_(c.candidateid));
  });
  try {
    readTabNormalized_(db, 'people').forEach(function (pp) {
      var d = commsDigits_(pp.phone).slice(-10);
      if (d && !known[d]) known[d] = 'equipe: ' + (str_(pp.name) || str_(pp.fullname));
    });
  } catch (eP) { /* no directory */ }
  try {
    readTabNormalized_(db, SCRAPER_LEADS_TAB).forEach(function (l) {
      var d = commsDigits_(l.phone).slice(-10);
      if (d && !known[d]) known[d] = 'cliente potencial: ' + str_(l.name);
    });
  } catch (eL) { /* no leads */ }

  var byNumber = {};
  for (var i = 0; i < calls.length; i++) {
    var t = calls[i];
    var line = commsDigits_(t.quonumber).slice(-10);
    if (!allLines && !commsIsScreenLine_(line)) continue;
    var other = commsDigits_(t.participants).slice(-10);
    // No external party: a line-to-line call, not a lost applicant.
    if (!other) continue;
    if (commsLineOurs_(other)) continue;
    if (known[other]) continue;

    var text = str_(t.speakertranscript) || str_(t.fulltranscript);
    var usable = text ? commsScreenUsable_(t.durationsec, text).ok : false;
    var rec = byNumber[other] || (byNumber[other] = {
      number: '+1' + other, calls: 0, usable: 0, lines: {},
      first: '', last: '', longest_sec: 0, opening: ''
    });
    rec.calls++;
    if (usable) rec.usable++;
    rec.lines[line] = (rec.lines[line] || 0) + 1;
    var when = str_(t.transcriptcreated).slice(0, 16);
    if (!rec.first || when < rec.first) rec.first = when;
    if (when > rec.last) rec.last = when;
    var secs = parseInt(str_(t.durationsec), 10) || 0;
    // Keep the opening of the LONGEST call — a hang-up says nothing.
    if (secs > rec.longest_sec) {
      rec.longest_sec = secs;
      rec.opening = text ? text.replace(/\s+/g, ' ').slice(0, 220) : '(sem transcricao)';
    }
  }

  var list = [];
  for (var k in byNumber) if (byNumber.hasOwnProperty(k)) list.push(byNumber[k]);
  list.sort(function (a, b) { return b.longest_sec - a.longest_sec; });

  var out = {
    window_days: COMMS_WINDOW_DAYS,
    scope: allLines ? 'todas as linhas' : 'apenas linhas de screening',
    screening_lines: COMMS_SCREEN_LINES,
    unknown_numbers: list.length,
    with_a_usable_call: list.filter(function (r) { return r.usable > 0; }).length,
    callers: list
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
