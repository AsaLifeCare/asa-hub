// Never sends anything: what is owed becomes a row, exposed through requestSmartSubjects_.
var REQUESTS_TAB = 'staff_requests';

// On a live tab only blank header cells are ever named; never relabel a column.
var REQUESTS_HEADER = [
  'id', 'createdAt', 'updatedAt',
  'type', 'urgency', 'personId', 'personName', 'phone', 'email',
  'details', 'datesText',
  'dateFrom', 'dateTo', 'dateDays', 'calendarName', 'parseNote',
  'status', 'verdict', 'resolvedAt', 'resolvedBy', 'resolutionNote',
  'notifiedAt', 'notifyCount'
];

var REQUESTS_TYPES = [
  'Admin - Employee Details', 'Admin - Employee Verification Letters', 'Admin - Incident Reports',
  'Admin - Policy/Handbook Inquiry', 'Admin - Status Updates',
  'ADP - Direct Deposit', 'ADP - Pay Stubs', 'ADP - Request Access to ADP',
  'ADP - Tax/W-2', 'ADP - Update Information',
  'Finances - Mileage Reimbursement', 'Finances - Reimbursement',
  'Operations - Supplies', 'Operations - Technology',
  'PSI - Reset Password', 'PSI - Scheduling Help',
  'Safety - COVID/Illness', 'Safety - Injury Reports', 'Safety - Workers Comp',
  'Schedule - Call Off', 'Schedule - Shift Changes', 'Schedule - Time Off Request',
  'Other - General Requests'
];

var REQUESTS_TYPE_TIME_OFF = 'Schedule - Time Off Request';

// needs_dates: a time-off request whose dates could not be read.
var REQUESTS_STATUSES = ['open', 'needs_dates', 'resolved'];

var REQUESTS_VERDICTS = ['approved', 'denied', 'resolved'];

var REQUESTS_URGENCIES = ['high', 'mid', 'low'];

var REQUESTS_STALE_DAYS = 3;

// Roster labels that are not people; a request filed for one is refused.
var REQUESTS_NON_PEOPLE = ['OPEN', 'WORKSHOP', 'FAMILY', 'NURSE', 'LOCATION', 'NEW'];

var REQUESTS_PII_EXACT = ['date_of_birth', 'dob', 'birth_date', 'login', 'password',
                          'social_security', 'social_security_number'];

// Fed raw headers, so the key is normalised first; 'ssn' is a prefix block.
function requestsPiiBlocked_(key) {
  var k = String(key || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!k) return false;
  if (k.indexOf('ssn') !== -1) return true;
  return REQUESTS_PII_EXACT.indexOf(k) !== -1;
}

// Pure helpers — no Google calls, so the self-test can feed all of these.

var REQUESTS_MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function requestsMonthIdx_(name) {
  var key = String(name || '').slice(0, 3).toLowerCase();
  return REQUESTS_MONTHS.hasOwnProperty(key) ? REQUESTS_MONTHS[key] : -1;
}

// Never toISOString on a local date: local midnight through UTC walks a day backwards.
function requestsIso_(y, mo, d) {
  var mm = (mo + 1 < 10 ? '0' : '') + (mo + 1);
  var dd = (d < 10 ? '0' : '') + d;
  return String(y) + '-' + mm + '-' + dd;
}

function requestsIsoOfMs_(ms) {
  var d = new Date(ms);
  return requestsIso_(d.getFullYear(), d.getMonth(), d.getDate());
}

// The round-trip compare catches Date normalizing Feb 30 into March.
function requestsValidDay_(y, mo, d) {
  if (mo < 0 || d < 1) return false;
  var probe = new Date(y, mo, d);
  return probe.getFullYear() === y && probe.getMonth() === mo && probe.getDate() === d;
}

// Kept verbatim from the legacy: the vacation calendar files people by this short name.
function requestsCalendarName_(fullName) {
  var parts = String(fullName || '').trim().split(/[\s,]+/).filter(function (p) { return !!p; });
  if (!parts.length) return '';
  var first = parts[0].toUpperCase();
  if (parts.length <= 1) return first;
  return first + ' ' + parts[parts.length - 1].charAt(0).toUpperCase();
}

function requestsDateTokens_(s) {
  var found = [], m;
  var push = function (at, raw, y, mo, d, two) {
    found.push({ at: at, end: at + raw.length, raw: raw, y: y, mo: mo, d: d,
                 twoDigitYear: !!two });
  };

  var iso = /(\d{4})-(\d{1,2})-(\d{1,2})/g;
  while ((m = iso.exec(s)) !== null) {
    push(m.index, m[0], Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  // "March 25", "Mar 25th, 2026"
  var name1 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/gi;
  while ((m = name1.exec(s)) !== null) {
    push(m.index, m[0], m[3] ? Number(m[3]) : null, requestsMonthIdx_(m[1]), Number(m[2]));
  }

  // "25th of March", "25 March 2026"
  var name2 = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s*,?\s*(\d{4}))?\b/gi;
  while ((m = name2.exec(s)) !== null) {
    push(m.index, m[0], m[3] ? Number(m[3]) : null, requestsMonthIdx_(m[2]), Number(m[1]));
  }

  // MM/DD[/YY[YY]]; a two-digit year becomes 20xx and is said in the answer.
  var us = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = us.exec(s)) !== null) {
    var y = null, two = false;
    if (m[3]) {
      if (m[3].length === 3) continue;
      y = Number(m[3]);
      if (m[3].length === 2) { y = 2000 + y; two = true; }
    }
    push(m.index, m[0], y, Number(m[1]) - 1, Number(m[2]), two);
  }

  // Earliest start wins, then longest, so "March 25, 2026" stays one token.
  found.sort(function (a, b) { return a.at - b.at || b.end - a.end; });
  var out = [], lastEnd = -1;
  for (var i = 0; i < found.length; i++) {
    if (found[i].at < lastEnd) continue;
    out.push(found[i]);
    lastEnd = found[i].end;
  }
  return out;
}

// No year is guessed silently (see `assumed`); a reversed range is refused, never reordered.
function requestsParseDates_(text, todayMs) {
  var s = String(text || '').replace(/\s+/g, ' ').trim();
  var quote = s.length > 90 ? s.slice(0, 90) + '...' : s;
  if (!s) return { error: 'There is no text to read dates from.' };

  var now = new Date(typeof todayMs === 'number' ? todayMs : Date.now());
  var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  var tokens = requestsDateTokens_(s);

  // The unit lookahead keeps "I need 3 days" from reading as a range.
  if (tokens.length === 1) {
    var rest = s.slice(tokens[0].end);
    var cont = rest.match(/^\s*(?:to|through|thru|until|till|and|[-–—])\s*(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:day|week|hour|month|year)s?\b)/i);
    if (cont) {
      var endDay = Number(cont[1]);
      if (endDay <= tokens[0].d) {
        return { error: 'The range in "' + quote + '" reads as ending on day ' + endDay +
                 ', before it starts (' + tokens[0].raw + ') — write both dates in full.' };
      }
      tokens.push({ at: tokens[0].end, end: tokens[0].end, y: tokens[0].y,
                    mo: tokens[0].mo, d: endDay, twoDigitYear: tokens[0].twoDigitYear,
                    raw: '"' + cont[1] + '" (read against ' + tokens[0].raw + ')' });
    }
  }

  if (!tokens.length) {
    if (/\b\d{1,2}(st|nd|rd|th)\b/i.test(s)) {
      return { error: '"' + quote + '" names a day but never a month — the month has to be ' +
               'written, because guessing it was the old parser\'s favourite mistake.' };
    }
    return { error: 'No calendar date could be read in "' + quote + '" — a real date is ' +
             'needed (for example: March 25 to March 27).' };
  }
  if (tokens.length > 2) {
    return { error: tokens.length + ' dates were read in "' + quote + '" — a request needs ' +
             'one start and one end, and which two those are was not guessed.' };
  }

  var assumed = [];

  var resolve = function (tok, notBeforeMs) {
    if (tok.y !== null) {
      if (!requestsValidDay_(tok.y, tok.mo, tok.d)) {
        return { error: '"' + tok.raw + '" is not a real calendar day.' };
      }
      if (tok.twoDigitYear) {
        assumed.push('the two-digit year in ' + tok.raw + ' was read as ' + tok.y);
      }
      return { ms: new Date(tok.y, tok.mo, tok.d).getTime() };
    }
    var startY = new Date(notBeforeMs).getFullYear();
    for (var y = startY; y <= startY + 8; y++) {
      if (!requestsValidDay_(y, tok.mo, tok.d)) continue;
      var ms = new Date(y, tok.mo, tok.d).getTime();
      if (ms >= notBeforeMs) {
        assumed.push('no year written in ' + tok.raw + ' — read as ' +
                     requestsIso_(y, tok.mo, tok.d) + ', the next such day');
        return { ms: ms };
      }
    }
    return { error: '"' + tok.raw + '" never lands on a real calendar day.' };
  };

  var tokFrom = tokens[0];
  var tokTo = tokens.length === 2 ? tokens[1] : null;

  // With only the end dated, the end's year is the sentence's year.
  var from;
  if (tokFrom.y === null && tokTo && tokTo.y !== null) {
    if (!requestsValidDay_(tokTo.y, tokFrom.mo, tokFrom.d)) {
      return { error: '"' + tokFrom.raw + '" is not a real calendar day in ' + tokTo.y + '.' };
    }
    from = { ms: new Date(tokTo.y, tokFrom.mo, tokFrom.d).getTime() };
    assumed.push('the start\'s year was taken from the end date (' + tokTo.y + ')');
  } else {
    from = resolve(tokFrom, todayStart);
  }
  if (from.error) return { error: from.error };

  var to = tokTo ? resolve(tokTo, from.ms) : { ms: from.ms };
  if (to.error) return { error: to.error };

  if (to.ms < from.ms) {
    return { error: 'The range in "' + quote + '" ends (' + requestsIsoOfMs_(to.ms) +
             ') before it starts (' + requestsIsoOfMs_(from.ms) + ').' };
  }

  var days = Math.round((to.ms - from.ms) / 86400000) + 1;

  // An assumed-year wrap into next year is believed only when short (Dec 30 to Jan 2).
  if (tokTo && tokTo.y === null &&
      new Date(to.ms).getFullYear() > new Date(from.ms).getFullYear() && days > 45) {
    return { error: 'Read literally, "' + quote + '" would be ' + days + ' days ending in the ' +
             'following year — more likely a reversed range than a vacation. Write the years out.' };
  }
  if (days > 370) {
    return { error: '"' + quote + '" spans ' + days + ' days (' + requestsIsoOfMs_(from.ms) +
             ' to ' + requestsIsoOfMs_(to.ms) + ') — more likely a misread year than time off.' };
  }

  return { from: requestsIsoOfMs_(from.ms), to: requestsIsoOfMs_(to.ms),
           days: days, assumed: assumed.join('; ') };
}

function requestsMs_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var ms = Date.parse(s);
  return isNaN(ms) ? null : ms;
}

function requestsAgeDays_(thenMs, nowMs) {
  return Math.floor((nowMs - thenMs) / 86400000);
}

function requestsSheet_() {
  var sheet = hubTabEnsure_(REQUESTS_TAB, REQUESTS_HEADER);
  var width = Math.max(1, sheet.getLastColumn());
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  if (!hdr[0]) {
    sheet.getRange(1, 1, 1, REQUESTS_HEADER.length).setValues([REQUESTS_HEADER]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var missing = REQUESTS_HEADER.filter(function (h) { return hdr.indexOf(h) === -1; });
  if (missing.length) {
    if (sheet.getMaxColumns() < hdr.length + missing.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(),
        hdr.length + missing.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function requestsReadRows_() {
  var sheet = requestsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var width = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, last, width).getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = { _row: r + 1 };
    for (var c = 0; c < hdr.length; c++) {
      if (!hdr[c]) continue;
      if (requestsPiiBlocked_(hdr[c])) continue;
      var v = values[r][c];
      // cellText_ reads UTC components: right only on a UTC book (an estate sheet needs estateCell_).
      if (v instanceof Date) v = cellText_(v);
      row[hdr[c]] = String(v == null ? '' : v);
    }
    if (!row.id) continue;
    out.push(row);
  }
  return out;
}

function requestsAppendRow_(record) {
  var sheet = requestsSheet_();
  var width = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  sheet.appendRow(hdr.map(function (h) { return record[h] !== undefined ? record[h] : ''; }));
  try { if (typeof cacheBump_ === 'function') cacheBump_(REQUESTS_TAB); } catch (eB) { /* slow read at worst */ }
}

// Re-finds the row by id at write time so a stale row number cannot overwrite a stranger.
function requestsPatchRow_(id, patch) {
  var sheet = requestsSheet_();
  var width = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idCol = hdr.indexOf('id');
  var last = sheet.getLastRow();
  if (idCol === -1 || last < 2) {
    return { error: { status: 500, message: 'The staff_requests tab is not initialised.' } };
  }
  var ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
  var rowNum = 0;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) { rowNum = i + 2; break; }
  }
  if (!rowNum) return { error: { status: 404, message: 'No staff request with id "' + id + '".' } };

  var line = sheet.getRange(rowNum, 1, 1, width).getValues()[0];
  var merged = {};
  for (var c = 0; c < hdr.length; c++) {
    if (!hdr[c]) continue;
    // Untouched columns are written back, so the Date rule above matters even more here.
    var cv = line[c];
    if (cv instanceof Date) cv = cellText_(cv);
    merged[hdr[c]] = String(cv == null ? '' : cv);
  }
  for (var k in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    if (k === 'id' || k === 'createdAt') continue;
    if (requestsPiiBlocked_(k)) continue;
    merged[k] = String(patch[k] == null ? '' : patch[k]);
  }
  merged.updatedAt = new Date().toISOString();

  sheet.getRange(rowNum, 1, 1, width)
    .setValues([hdr.map(function (h) { return merged[h] !== undefined ? merged[h] : ''; })]);
  try { if (typeof cacheBump_ === 'function') cacheBump_(REQUESTS_TAB); } catch (eB) { /* */ }
  return merged;
}

// Identity by key, never a loose name; an empty roster is a broken read (503), not an empty staff.
function requestsPerson_(personId) {
  if (!personId) {
    return { error: { status: 400, message: 'A personId (roster) is required — never a loose name.' } };
  }
  var people;
  try {
    people = listRows_('people', {});
    if (typeof peopleMerged_ === 'function') people = peopleMerged_(people);
    if (typeof withoutIspClients_ === 'function') people = withoutIspClients_(people);
  } catch (e) {
    return { error: { status: 503, message: 'The people roster could not be read (' +
      String((e && e.message) || e) + ') — who is asking cannot be resolved, so nothing was recorded.' } };
  }
  if (!people.length) {
    return { error: { status: 503, message: 'The people roster answered with nobody at all — ' +
      'that is a broken read, not proof this person does not exist. Nothing was recorded.' } };
  }
  var hit = null;
  for (var i = 0; i < people.length; i++) {
    if (String(people[i].id) === String(personId)) { hit = people[i]; break; }
  }
  if (!hit) return { error: { status: 404, message: 'No person "' + personId + '" in the roster.' } };

  var name = str_(hit.name);
  var up = name.toUpperCase();
  if (REQUESTS_NON_PEOPLE.indexOf(up) !== -1 || up.indexOf('WORKSHOP') !== -1) {
    return { error: { status: 422, message: '"' + name + '" is a roster label, not a person — ' +
      'a request cannot be filed for it.' } };
  }
  return { person: { id: str_(hit.id), name: name, phone: str_(hit.phone), email: str_(hit.email) } };
}

HUB_POLICY.requestsList = {
  file: 'Requests.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { status: { type: 'string' } }
};
HUB_ACTIONS.requestsList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var status = str_(payload.status).toLowerCase();
  if (status && REQUESTS_STATUSES.indexOf(status) === -1) {
    return { status: 400, message: 'Unknown status "' + status + '". Valid: ' +
             REQUESTS_STATUSES.join(', ') + '.' };
  }

  var rows;
  try { rows = requestsReadRows_(); }
  catch (e) {
    return { status: 503, message: 'The staff_requests tab could not be read (' +
             String((e && e.message) || e) + ') — the queue is unavailable, not empty.' };
  }
  // An empty read is true here: only this module writes the tab.

  var now = Date.now();
  var counts = { open: 0, needs_dates: 0, resolved: 0, stale: 0 };
  rows.forEach(function (r) {
    var st = String(r.status || '');
    if (counts[st] !== undefined) counts[st]++;
    if (st !== 'resolved') {
      var ms = requestsMs_(r.createdAt);
      if (ms !== null && requestsAgeDays_(ms, now) >= REQUESTS_STALE_DAYS) counts.stale++;
    }
  });

  var list = rows.filter(function (r) {
    return !status || String(r.status) === status;
  });
  // createdAt are this module's own ISO stamps, so string compare orders them.
  var rank = { high: 0, mid: 1, low: 2 };
  list.sort(function (a, b) {
    var ra = a.status !== 'resolved' ? 0 : 1;
    var rb = b.status !== 'resolved' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    var ua = rank[String(a.urgency)] !== undefined ? rank[String(a.urgency)] : 3;
    var ub = rank[String(b.urgency)] !== undefined ? rank[String(b.urgency)] : 3;
    if (ua !== ub) return ua - ub;
    return String(a.createdAt) < String(b.createdAt) ? -1 : 1;
  });

  return { status: 200, data: {
    requests: list.slice(0, 500).map(function (r) {
      var out = {};
      for (var k in r) { if (k !== '_row') out[k] = r[k]; }
      return out;
    }),
    counts: counts,
    types: REQUESTS_TYPES,          // the screen submits with these, verbatim
    staleDays: REQUESTS_STALE_DAYS
  } };
};

HUB_POLICY.requestSubmit = {
  file: 'Requests.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['staffRequests'],
  emits: [],
  params: {
    type: { type: 'string', required: true },
    personId: { type: 'string', required: true },
    details: { type: 'string', required: true },
    dates: { type: 'string' }, urgency: { type: 'string' }
  }
};
HUB_ACTIONS.requestSubmit = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};

  var type = str_(payload.type);
  if (REQUESTS_TYPES.indexOf(type) === -1) {
    return { status: 400, message: 'Unknown request type "' + type + '" — the queue speaks the ' +
             'Work Queue\'s own ' + REQUESTS_TYPES.length + ' types (requestsList returns the list).' };
  }

  var who = requestsPerson_(str_(payload.personId));
  if (who.error) return who.error;

  var details = str_(payload.details).replace(/^\s+|\s+$/g, '');
  if (!details) {
    return { status: 400, message: 'A request needs a description — an empty row is work for nobody.' };
  }

  var urgency = str_(payload.urgency).toLowerCase() || 'low';
  if (REQUESTS_URGENCIES.indexOf(urgency) === -1) {
    return { status: 400, message: 'Unknown urgency "' + urgency + '". Valid: ' +
             REQUESTS_URGENCIES.join(', ') + ' (the legacy sheet\'s own vocabulary).' };
  }

  var datesText = str_(payload.dates).replace(/^\s+|\s+$/g, '');
  var isTimeOff = type === REQUESTS_TYPE_TIME_OFF;

  var parsed = null;
  var parseSource = datesText || (isTimeOff ? details : '');
  if (parseSource) parsed = requestsParseDates_(parseSource);

  var now = new Date().toISOString();
  var record = {
    id: 'rq_' + Utilities.getUuid().slice(0, 12),
    createdAt: now, updatedAt: now,
    type: type, urgency: urgency,
    personId: who.person.id, personName: who.person.name,
    phone: who.person.phone, email: who.person.email,
    details: hubCellSafe_(details), datesText: hubCellSafe_(datesText),
    dateFrom: '', dateTo: '', dateDays: '', calendarName: '', parseNote: '',
    status: 'open', verdict: '', resolvedAt: '', resolvedBy: '', resolutionNote: '',
    notifiedAt: '', notifyCount: '0'
  };

  if (parsed) {
    if (parsed.error) {
      record.parseNote = parsed.error;
      if (isTimeOff) {
        record.status = 'needs_dates';
      }
      // Any other type: the date was incidental — the note says what could not be read and the request stands on…
    } else {
      record.dateFrom = parsed.from;
      record.dateTo = parsed.to;
      record.dateDays = String(parsed.days);
      record.parseNote = parsed.assumed;
      if (isTimeOff) {
        // Derived once here so a later mirror never re-derives it differently.
        record.calendarName = requestsCalendarName_(who.person.name);
      }
    }
  }

  try { requestsAppendRow_(record); }
  catch (e) {
    return { status: 503, message: 'The staff_requests tab could not be written (' +
             String((e && e.message) || e) + ') — the request was NOT recorded.' };
  }

  hubSysLog_(str_(user.email), 'requestSubmit', who.person.name,
             { status: 200, message: type + (record.status === 'needs_dates' ? ' (needs dates)' : '') });
  return { status: 200, data: {
    id: record.id, status: record.status,
    dateFrom: record.dateFrom, dateTo: record.dateTo,
    dateDays: record.dateDays, calendarName: record.calendarName,
    parseNote: record.parseNote
  } };
};

HUB_POLICY.requestResolve = {
  file: 'Requests.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['staffRequests'],
  emits: [],
  params: {
    id: { type: 'string', required: true },
    verdict: { type: 'string', required: true },
    note: { type: 'string' }
  }
};
HUB_ACTIONS.requestResolve = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var id = str_(payload.id);
  if (!id) return { status: 400, message: 'Which request?' };

  var verdict = str_(payload.verdict).toLowerCase();
  if (REQUESTS_VERDICTS.indexOf(verdict) === -1) {
    return { status: 400, message: 'Unknown verdict "' + verdict + '". Valid: ' +
             REQUESTS_VERDICTS.join(', ') + '.' };
  }

  var rows;
  try { rows = requestsReadRows_(); }
  catch (e) {
    return { status: 503, message: 'The staff_requests tab could not be read (' +
             String((e && e.message) || e) + ') — nothing was resolved.' };
  }
  var row = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === id) { row = rows[i]; break; }
  }
  if (!row) return { status: 404, message: 'No staff request with id "' + id + '".' };

  if (String(row.status) === 'resolved') {
    if (String(row.verdict) === verdict) {
      return { status: 200, data: { id: id, verdict: verdict, already: true } };
    }
    return { status: 409, message: 'That request is already resolved as "' + row.verdict +
             '" — a second, different verdict is a conversation, not an overwrite.' };
  }

  var patched = requestsPatchRow_(id, {
    status: 'resolved', verdict: verdict,
    resolvedAt: new Date().toISOString(),
    resolvedBy: str_(user.email),
    resolutionNote: hubCellSafe_(str_(payload.note))
  });
  if (patched.error) return patched.error;

  hubSysLog_(str_(user.email), 'requestResolve',
             str_(row.personName) + ': ' + str_(row.type),
             { status: 200, message: verdict });
  return { status: 200, data: { id: id, verdict: verdict, personName: str_(row.personName) } };
};

// Nothing is seeded to send; `instance` (id#notifyCount) makes each chase a new ledger instance.
function requestSmartSubjects_() {
  var now = Date.now();
  var rows;
  try { rows = requestsReadRows_(); }
  catch (e) { return []; }
  var out = [];
  rows.forEach(function (r) {
    if (String(r.status) === 'resolved') return;
    var ms = requestsMs_(r.createdAt);
    if (ms === null) return;
    var age = requestsAgeDays_(ms, now);
    if (age < REQUESTS_STALE_DAYS) return;
    out.push({
      id: str_(r.id),
      name: str_(r.personName),
      phone: str_(r.phone),
      email: str_(r.email),
      type: str_(r.type),
      status: str_(r.status),
      submitted: String(r.createdAt).slice(0, 10),   // ISO stamp — slice is safe
      ageDays: String(age),
      needsDates: String(r.status) === 'needs_dates' ? 'yes' : '',
      parseNote: str_(r.parseNote),
      details: str_(r.details).slice(0, 140),
      instance: str_(r.id) + '#' + (parseInt(r.notifyCount, 10) || 0)
    });
  });
  return out;
}

// Matched by exact keys (roster id, e-mails, numbers); the full-name key only for legacy rows, never a contains…
HUB_POLICY.userSupportRequests = {
  file: 'Requests.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { user_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.userSupportRequests = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var uid = str_(payload && payload.user_id);
  if (!uid) return { status: 400, message: 'user_id is required' };
  var found = tenantUserRow_(uid);
  if (found.error) return found.error;
  var row = found.row;

  var nameKey = '';
  try { nameKey = clientNameKey_(str_(row.displayname)); } catch (eN) { nameKey = ''; }

  var emails = {};
  var takeEmail = function (e) {
    var k = str_(e).trim().toLowerCase();
    if (k && k.indexOf('@') !== -1) emails[k] = true;
  };
  takeEmail(row.email);
  profileParseEmails_(row.emails).forEach(takeEmail);

  var digits = {};
  var take = function (p) {
    var d = commsDigits_(p).slice(-10);
    if (d.length >= 7) digits[d] = true;
  };
  take(str_(row.phone));
  profileParsePhones_(row.phones).forEach(function (p) { take(p && p.number); });

  var rosterId = '';
  try {
    if (nameKey) {
      var matches = [];
      listRows_('people', {}).forEach(function (p) {
        var pk = '';
        try { pk = clientNameKey_(str_(p.name)); } catch (eK) { pk = ''; }
        if (pk && pk === nameKey) matches.push(p);
      });
      // unique-match-only: two rows with the name = no roster lane at all
      if (matches.length === 1) { rosterId = str_(matches[0].id); take(str_(matches[0].phone)); }
    }
  } catch (eR) { /* no roster — the other keys still answer */ }
  try {
    var cid = str_(row.candidateid);
    if (cid) {
      readTabNormalized_(ssOpen_(TALENT_SHEET_ID), TALENT_CANDIDATES_TAB).forEach(function (c) {
        if (str_(c.candidateid) === cid) { take(str_(c.phone)); takeEmail(c.email); }
      });
    }
  } catch (eC) { /* no candidate row */ }

  var dList = Object.keys(digits);
  var phoneHit = function (cell) {
    if (!dList.length) return false;
    var s = commsDigits_(cell);
    if (!s) return false;
    for (var i = 0; i < dList.length; i++) { if (s.indexOf(dList[i]) !== -1) return true; }
    return false;
  };

  var rows;
  try { rows = requestsReadRows_(); }
  catch (e) {
    return { status: 503, message: 'The staff_requests tab could not be read (' +
      String((e && e.message) || e) + ') — the queue is unavailable, not empty.' };
  }

  var out = { requests: [], counts: { open: 0, needs_dates: 0, resolved: 0 }, total: 0 };
  rows.forEach(function (r) {
    var as = '';
    if (rosterId && String(r.personId) === rosterId) as = 'roster';
    else if (str_(r.email).trim() && emails[str_(r.email).trim().toLowerCase()]) as = 'email';
    else if (phoneHit(r.phone)) as = 'phone';
    else if (nameKey) {
      var rk = '';
      try { rk = clientNameKey_(str_(r.personName)); } catch (eK2) { rk = ''; }
      if (rk && rk === nameKey) as = 'named';
    }
    if (!as) return;
    if (out.counts.hasOwnProperty(str_(r.status))) out.counts[str_(r.status)]++;
    out.requests.push({
      id: str_(r.id), at: str_(r.createdAt), type: str_(r.type),
      urgency: str_(r.urgency), status: str_(r.status), verdict: str_(r.verdict),
      resolvedAt: str_(r.resolvedAt), resolvedBy: str_(r.resolvedBy),
      note: str_(r.resolutionNote).slice(0, 400),
      details: str_(r.details).slice(0, 400),
      dates: str_(r.datesText), from: str_(r.dateFrom), to: str_(r.dateTo),
      days: str_(r.dateDays), as: as
    });
  });
  out.requests.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  out.total = out.requests.length;
  out.requests = out.requests.slice(0, 100);
  return { status: 200, data: out };
};

// Only after a real delivery, never from a screen: the count means delivered, not tried.
function requestsMarkNotified_(id) {
  var rows;
  try { rows = requestsReadRows_(); }
  catch (e) { return; }
  var row = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) { row = rows[i]; break; }
  }
  if (!row) return;
  requestsPatchRow_(id, {
    notifiedAt: new Date().toISOString(),
    notifyCount: String((parseInt(row.notifyCount, 10) || 0) + 1)
  });
}
