// Consent order: a refusal always wins; a grant permits only its own purpose; silence is decided by the `comm_silence` cell.
// The silence floor 'employment' permits the employment relationship's own purposes and refuses everything else.

var COMM_CONSENT_TAB = 'entity_comm_consent';

var COMM_EMPLOYMENT_PURPOSES = ['compliance.owed', 'shift', 'roster', 'safety'];

// A status outside these lists reads as unknown, never as permission.
var COMM_CONSENT_GRANTED = ['granted', 'opt_in', 'opted_in', 'yes'];
var COMM_CONSENT_REFUSED = ['revoked', 'withdrawn', 'opt_out', 'opted_out', 'no'];

function commConsentRowVerdict_(row, nowMs) {
  if (!row) return 'unknown';
  var status = String(row.status || '').trim().toLowerCase();
  if (COMM_CONSENT_REFUSED.indexOf(status) !== -1) return 'refused';
  if (COMM_CONSENT_GRANTED.indexOf(status) === -1) return 'unknown';
  var until = String(row.expires_at || '').trim();
  if (until) {
    var ms = Date.parse(until);
    if (!isNaN(ms) && ms < Number(nowMs)) return 'unknown';
  }
  var from = String(row.effective_at || '').trim();
  if (from) {
    var start = Date.parse(from);
    if (!isNaN(start) && start > Number(nowMs)) return 'unknown';
  }
  return 'granted';
}

function commConsentVerdict_(rows, refused, channel, purpose, nowMs) {
  var ch = String(channel || '').trim().toLowerCase();
  var why = String(purpose || '').trim().toLowerCase();

  // A refusal wins, and nothing below may overturn it.
  if (refused && (refused.all || refused[ch])) {
    return { ok: false, hard: true,
             why: 'this person asked us to stop' + (refused.all ? '' : ' on ' + ch) };
  }

  var live = (rows || []).filter(function (r) {
    return String(r.channel_type || '').trim().toLowerCase() === ch &&
           commConsentRowVerdict_(r, nowMs) === 'granted';
  });
  var exact = live.filter(function (r) {
    var p = String(r.purpose || '').trim().toLowerCase();
    return !p || p === why;
  });
  if (exact.length) {
    return { ok: true, why: 'granted for ' + ch + (why ? ' · ' + why : '') };
  }
  // A grant for another purpose falls to the silence rule, never to a refusal.
  var otherPurposes = live.map(function (r) { return String(r.purpose || '').trim().toLowerCase(); })
    .filter(function (p, i, a) { return p && a.indexOf(p) === i; });

  var seen = otherPurposes.length ? ' (granted for ' + otherPurposes.join(', ') + ', not for this)' : '';
  var rule = 'employment';
  try {
    if (typeof digestSetting_ === 'function') {
      rule = String(digestSetting_('comm_silence', 'employment') || 'employment');
    }
  } catch (e) { rule = 'employment'; }
  rule = rule.trim().toLowerCase();

  if (rule === 'allow') {
    return { ok: true, why: 'no record for this purpose' + seen + ', and the words book allows silence' };
  }
  if (rule === 'employment' && COMM_EMPLOYMENT_PURPOSES.indexOf(why) !== -1) {
    return { ok: true,
             why: 'no consent record for this purpose' + seen + '; permitted because ' + why +
                  ' is the employment relationship\'s own purpose, not marketing' };
  }
  return { ok: false, hard: false,
           why: 'no consent record for ' + ch +
                (why ? ' · ' + why : '') + seen + ' — silence is not permission' };
}

function commRouteFor_(rows, refused, purpose, channels, nowMs) {
  var tried = [];
  var list = channels && channels.length ? channels : ['sms', 'email', 'voice'];
  for (var i = 0; i < list.length; i++) {
    var v = commConsentVerdict_(rows, refused, list[i], purpose, nowMs);
    tried.push(list[i] + ': ' + v.why);
    if (v.ok) return { channel: list[i], ok: true, why: v.why, tried: tried };
  }
  return { channel: '', ok: false, why: 'no permitted route', tried: tried };
}

// --- The stated window: the hours a person told us, above every guess --- Stored in entity_comm_consent…

// Its own row, never written over one of the seeded grants.
var COMM_CONSENT_WINDOW_PREFIX = 'CMW_';

// No delete: a stated window is evidence.
var COMM_CONSENT_WINDOW_STATES = ['stated', 'superseded'];

// `anytime` and `days` hold no hours and are still real answers.
var COMM_CONSENT_WINDOW_KINDS = ['window', 'anytime', 'days'];

function commConsentWindowClock_(v) {
  var s = String(v || '').trim();
  if (!s) return '';
  var m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return '';
  var h = Number(m[1]), mi = Number(m[2]);
  if (isNaN(h) || isNaN(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return '';
  return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
}

// status 'window_stated' is deliberately not a grant: commConsentRowVerdict_ reads it as unknown.
function commConsentWindowRow_(personKey, personName, claim, said, source, messageId, nowIso) {
  var key = String(personKey || '').trim().toLowerCase();
  var c = claim || {};
  return {
    id: COMM_CONSENT_WINDOW_PREFIX + ((typeof commRecordId_ === 'function')
      ? commRecordId_(key + '|window') : key),
    entity_name: String(personName || ''),
    entity_type: 'employee',
    person_key: key,
    channel_type: '',
    purpose: (typeof COMM_WINDOW_ASK_PURPOSE !== 'undefined') ? COMM_WINDOW_ASK_PURPOSE : 'contact.window',
    status: 'window_stated',
    source: String(source || ''),
    window_state: 'stated',
    window_kind: String(c.kind || ''),
    window_from: commConsentWindowClock_(c.from),
    window_to: commConsentWindowClock_(c.to),
    window_days: String(c.days || ''),
    window_said_at: String(nowIso || ''),
    window_source: String(source || ''),
    window_words: String(said || '').slice(0, 500),
    window_read_as: String(c.read_as || ''),
    window_message: String(messageId || ''),
    window_superseded_at: '',
    window_superseded_by: ''
  };
}

// Newest window_said_at wins; read by header name, so a store without the columns answers null.
function commConsentWindowLive_(rows) {
  var list = rows || [], best = null, bestAt = '';
  for (var i = 0; i < list.length; i++) {
    var r = list[i] || {};
    var state = String(r.window_state || '').trim().toLowerCase();
    if (state === 'superseded') continue;
    var kind = String(r.window_kind || '').trim().toLowerCase();
    var from = commConsentWindowClock_(r.window_from);
    var to = commConsentWindowClock_(r.window_to);
    var days = String(r.window_days || '').trim();
    // A row with every window column blank is not an answer.
    if (!kind && !from && !to && !days) continue;
    var at = String(r.window_said_at || r.updatedAt || '');
    if (!best || at > bestAt) { best = r; bestAt = at; }
  }
  if (!best) return null;
  return {
    kind: String(best.window_kind || 'window'),
    from: commConsentWindowClock_(best.window_from),
    to: commConsentWindowClock_(best.window_to),
    days: String(best.window_days || ''),
    said_at: String(best.window_said_at || ''),
    source: String(best.window_source || best.source || ''),
    words: String(best.window_words || ''),
    read_as: String(best.window_read_as || ''),
    stated: true,
    row_id: String(best.id || '')
  };
}

function commConsentHasWindow_(personKey) {
  return !!commConsentWindowFor_(personKey);
}

// Null when the store is unreadable too: an unreadable store must never stop the asking.
function commConsentWindowFor_(personKey) {
  var key = String(personKey || '').trim().toLowerCase();
  if (!key) return null;
  var mine = [];
  try {
    var all = (typeof commRecordConsentRows_ === 'function') ? commRecordConsentRows_() : null;
    if (all) mine = all[key] || [];
  } catch (e) { return null; }
  if (!mine.length) return null;
  return commConsentWindowLive_(mine);
}

// A later answer supersedes, the earlier one stays; on failure the caller must show the sentence to a person.
function commConsentWindowSave_(personKey, personName, claim, said, source, messageId, nowIso) {
  var key = String(personKey || '').trim().toLowerCase();
  if (!key) return { ok: false, why: 'no person key — a window belongs to somebody or to nobody' };
  if (!String(personName || '').trim()) {
    // The store is keyed by entity_name (clientNameKey_); a row without one is never found again.
    return { ok: false, why: 'the People house holds no name for this person, and the consent store is keyed by name' };
  }
  if (COMM_CONSENT_WINDOW_KINDS.indexOf(String((claim && claim.kind) || '')) === -1) {
    return { ok: false, why: 'not a kind of answer this store may hold: ' + String((claim && claim.kind) || 'nothing') };
  }
  var row = commConsentWindowRow_(key, personName, claim, said, source, messageId, nowIso);

  // The live row's id derives from the person, so the prior answer is copied to its own row first.
  var superseded = 0;
  try {
    var prior = commConsentWindowFor_(key);
    if (prior && prior.row_id) {
      var wasSame = prior.kind === row.window_kind && prior.from === row.window_from &&
                    prior.to === row.window_to && prior.days === row.window_days;
      if (!wasSame) {
        var keep = commConsentWindowRow_(key, personName,
          { kind: prior.kind, from: prior.from, to: prior.to, days: prior.days, read_as: prior.read_as },
          prior.words, prior.source, '', prior.said_at);
        // Keyed by when it was said (else the supersession time), so every past answer keeps its own row.
        keep.id = COMM_CONSENT_WINDOW_PREFIX + ((typeof commRecordId_ === 'function')
          ? commRecordId_(key + '|window|' + String(prior.said_at || nowIso || '')) : key + 'old');
        keep.window_state = 'superseded';
        keep.window_said_at = String(prior.said_at || '');
        keep.window_superseded_at = String(nowIso || '');
        keep.window_superseded_by = row.id;
        commRecordUpsert_(COMM_CONSENT_TAB, keep);
        superseded = 1;
      }
    }
  } catch (eS) {}

  try {
    commRecordUpsert_(COMM_CONSENT_TAB, row);
  } catch (eW) {
    return { ok: false, why: 'the consent store did not accept the row: ' +
                             String((eW && eW.message) || eW).slice(0, 120) };
  }

  // Not stored until it reads back: commRecordUpsert_ is silent when the house is gone.
  try { SpreadsheetApp.flush(); } catch (eF) {}
  var back = null;
  try { back = commConsentWindowFor_(key); } catch (eR) { back = null; }
  if (!back || String(back.row_id || '') !== row.id) {
    return { ok: false, superseded: superseded,
             why: 'the row did not read back out of ' + COMM_CONSENT_TAB +
                  ' — the store took nothing, so nothing may be treated as stored' };
  }
  return { ok: true, id: row.id, superseded: superseded,
           why: 'stored as ' + (row.window_kind || 'window') +
                (row.window_from || row.window_to
                  ? ' ' + (row.window_from || '(open)') + '-' + (row.window_to || '(open)') : '') +
                (row.window_days ? ' · ' + row.window_days : '') };
}

// Reachable window → quiet hours (its complement), each end separately: stated, then deduced, then the floor.
function commConsentWindowQuiet_(live, floorFrom, floorTo) {
  if (!live || !live.stated) return null;
  var quietFrom = Number(floorFrom), quietTo = Number(floorTo);
  if (isNaN(quietFrom) || isNaN(quietTo)) return null;

  var start = commConsentWindowClock_(live.from);
  var end = commConsentWindowClock_(live.to);
  var reachFrom = quietTo, reachTo = quietFrom;
  var parts = [];

  if (start) {
    var sh = Number(start.slice(0, 2)), sm = Number(start.slice(3, 5));
    reachFrom = (sm > 0) ? ((sh + 1) % 24) : sh;
    parts.push('reachable from ' + start +
               (sm > 0 ? ' (rounded to ' + reachFrom + ':00 — the planner compares whole hours and it ' +
                         'rounds away from their window, never into it)' : ''));
  }
  if (end) {
    reachTo = Number(end.slice(0, 2));
    parts.push('and not after ' + end +
               (Number(end.slice(3, 5)) > 0 ? ' (rounded back to ' + reachTo + ':00, the same way)' : ''));
  }
  if (!parts.length) {
    parts.push(live.kind === 'anytime'
      ? 'they said any time is fine, which restricts nothing — the platform\'s own hours still stand'
      : 'they stated no hours, so the platform\'s own hours still stand');
  }

  if (reachFrom === reachTo) reachTo = (reachFrom + 1) % 24;
  return { from: reachTo, to: reachFrom,
           why: 'THE PERSON SAID SO ("' + String(live.words || '').slice(0, 80) + '"' +
                (live.source ? ', ' + live.source : '') + ') — ' + parts.join('; ') +
                '. A stated window outranks anything deduced.' };
}

// 0 = Sunday, as commWindowVerdict_ numbers days; a blank window_days means every day.
function commConsentWindowDayOk_(live, localDay) {
  if (!live || !live.days) return true;
  if (localDay === '' || localDay === null || localDay === undefined) return true;
  var d = Number(localDay);
  if (isNaN(d)) return true;
  var days = String(live.days).trim().toLowerCase();
  var weekend = (d === 0 || d === 6);
  if (days === 'sat,sun') return weekend;
  if (days === 'mon-fri') return !weekend;
  return true;
}
