// TIME RECONCILIATION — the point report against the planned roster.
// IDENTITY BY KEY: every name resolves through nameBest_ (Names.gs) against the `people` tab; no UNIQUE match =…

// ─── Configuration ───

// Threshold defaults.
var RECON_DEFAULTS = {
  gapMin: 5,               // a consumer without staff longer than this is a gap
  overlapMin: 45,          // concurrent staff on one consumer longer than this is an overlap
  missingCoveragePct: 15,  // a scheduled shift with less punch coverage than this is missing
  smartRunDays: 2          // how far back reconSmartSubjects_ offers runs to the sweep
};
var RECON_CONFIG_KEY = 'reconThresholds';

// Default punch source for reconImportLatest: the master sheet the legacy portal appended every cleaned report to…
function reconSourceDefault_() {
  return {
    mode: 'masterSheet',
    spreadsheetId: hubId_('RECON_SOURCE_ID'),
    punchesTab: 'Cleaned Location',
    staffMapTab: 'Staff Mapping',
    clientMapTab: 'Client to Location'
  };
}

// The estate's Calendar Master Index — the sheet whose cells LINK to the live house calendars (the same index the…
var RECON_FOLDER_PROP = 'HUB_FOLDER_RECON_ID';
var RECON_FOLDER_NAME = 'Recon Reports';
// The LEGACY portal's report archive, by ID from its own config — reconImportLatest reads from here in legacyFolder…
var RECON_MAX_TABS_PER_CALENDAR = 3;

var RECON_DAY_NAMES = { SAT: 1, SUN: 1, MON: 1, TUE: 1, TUES: 1, WED: 1, THU: 1, THUR: 1, FRI: 1 };
// Cells that mean "not working" — read off the live tabs, same set the slice builder uses (server/shift_slices.py).
var RECON_NOT_WORKING = {
  OFF: 1, 'R/O': 1, 'C/O': 1, RO: 1, 'R\\O': 1, 'R/0': 1, NCNS: 1, 'NO WORKSHOP': 1
};
/** Staff cells that are a place or an event, never a person. */
var RECON_NOT_STAFF = { OPEN: 1, NONE: 1, WORKSHOP: 1 };

var RECON_ERROR_STATUSES = ['Open', 'Excused', 'Covered', 'Verified', 'Flagged', 'Reviewed'];
var RECON_RUN_STATUSES = ['Review', 'Reviewed'];

// ─── Pure time helpers (no Google — the self-test runs these) ───

function reconPad2_(n) { return n < 10 ? '0' + n : String(n); }

/** Minutes-from-midnight → 'h:mm AM'. Minutes past 1440 wrap (overnight). */
function reconMinToTime_(min) {
  if (min === null || min === undefined || isNaN(min)) return '';
  var m = ((Math.round(min) % 1440) + 1440) % 1440;
  var h = Math.floor(m / 60);
  var ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + reconPad2_(m % 60) + ' ' + ap;
}

/** 'h:mm:ss AM' | 'h:mm AM' | 'HH:MM' → minutes from midnight, or null. */
function reconParseTimeMin_(timeStr) {
  var ts = String(timeStr == null ? '' : timeStr).trim();
  if (!ts) return null;
  var h, min, sec = 0, m;
  m = ts.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) m = ts.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    h = parseInt(m[1], 10); min = parseInt(m[2], 10);
    if (m[4]) sec = parseInt(m[3], 10);
    var p = m[m.length - 1].toUpperCase();
    if (p === 'PM' && h !== 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
  } else {
    m = ts.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    h = parseInt(m[1], 10); min = parseInt(m[2], 10);
  }
  if (h > 24 || min > 59) return null;
  return h * 60 + min + Math.round(sec / 60);
}

/** ISO 'yyyy-MM-dd' (also M/d/yyyy) → local-midnight Date, or null. Pure. */
function reconParseDate_(s) {
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  var str = String(s == null ? '' : s).trim();
  var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  return null;
}

/** Date → 'yyyy-MM-dd' using LOCAL getters (the script timezone in GAS). */
function reconDateIso_(d) {
  return d.getFullYear() + '-' + reconPad2_(d.getMonth() + 1) + '-' + reconPad2_(d.getDate());
}

/** An end at or before its start means the shift crosses midnight. */
function reconOvernight_(startMin, endMin) {
  return (endMin !== null && startMin !== null && endMin <= startMin) ? endMin + 1440 : endMin;
}

// ─── The calendar cell grammar (ported from server/shift_slices.py) ─── '*8A-8P' hours, every spelling · 'OFF'…

var RECON_T = '(\\d{1,2})(?::?(\\d{2}))?\\s*([AP])M?';
var RECON_T1 = '(\\d{1,2})(?::?(\\d{2}))?\\s*([AP])?M?';
var RECON_RANGE_RE = new RegExp('^\\*?\\s*' + RECON_T1 + '\\s*[-–]\\s*' + RECON_T +
                                '(?:\\s+[A-Za-z]{1,4})?\\s*$', 'i');

/** One segment → {startMin, endMin} (end past 1440 when overnight), or null. */
function reconParseRange_(segment) {
  var m = String(segment || '').trim().match(RECON_RANGE_RE);
  if (!m) return null;
  var h1 = parseInt(m[1], 10), m1 = m[2] ? parseInt(m[2], 10) : 0;
  var h2 = parseInt(m[4], 10), m2 = m[5] ? parseInt(m[5], 10) : 0;
  var ap1 = (m[3] || m[6] || '').toUpperCase();   // '230-10p': the first half borrows the second's AM/PM
  var ap2 = (m[6] || '').toUpperCase();
  var start = (h1 % 12) + (ap1 === 'P' ? 12 : 0) + m1 / 60;
  var end = (h2 % 12) + (ap2 === 'P' ? 12 : 0) + m2 / 60;
  if (!m[3] && start >= end) start = (((start - 12) % 24) + 24) % 24;
  if (end <= start) end += 24;
  return { startMin: Math.round(start * 60), endMin: Math.round(end * 60) };
}

// One calendar cell → null (blank) | { kind: 'off' | 'ro' } | { kind: 'hours', startMin, endMin, token } | { kind…
function reconClassifyCell_(raw) {
  var code = String(raw == null ? '' : raw).trim();
  if (!code) return null;
  var upper = code.toUpperCase();
  if (RECON_NOT_WORKING[upper]) return { kind: upper === 'OFF' ? 'off' : 'ro', token: '' };

  var segments = code.split(/\s*[><]\s*/);
  var range = null, token = '';
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i].trim();
    if (!seg) continue;
    if (RECON_NOT_WORKING[seg.toUpperCase()]) continue;
    var r = reconParseRange_(seg);
    if (r && !range) { range = r; continue; }
    if (!r && !token) token = seg;
  }
  if (range) return { kind: 'hours', startMin: range.startMin, endMin: range.endMin, token: token };
  if (token) return { kind: 'alias', token: token };
  return { kind: 'alias', token: code };   // a whole-cell token ("47TH", "ADMIN")
}

// ─── Identity by key ───

/** The roster every name is resolved against: the Hub's own people tab. */
function reconRoster_() {
  var rows = [];
  try { rows = listRows_('people', {}); } catch (e) { rows = []; }
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var name = str_(rows[i].name) ||
               (str_(rows[i].first_name) + ' ' + str_(rows[i].last_name)).trim();
    if (!name) continue;
    out.push({ id: str_(rows[i].id), name: name });
  }
  return out;
}

// One typed name → { ok:true, id, name, key } or { ok:false, reason:'no match'|'ambiguous', candidates?, key }.
function reconResolveName_(typed, roster) {
  var fallbackKey = 'name:' + nameTokens_(typed).core.join(' ');
  if (!nameNorm_(typed)) return { ok: false, reason: 'no match', key: 'name:' };
  var best = nameBest_(typed, roster, function (p) { return p.name; });
  if (!best.ok) {
    return { ok: false, reason: best.reason, candidates: best.candidates || [],
             score: best.score, key: fallbackKey };
  }
  return { ok: true, id: best.item.id, name: best.matched_name, key: best.item.id };
}

// ─── Consumer → house map ───

// The istHouses resource (clientName → house code, see Main.gs) is the map, keyed lowercase for case-insensitive…
function reconClientHouseMap_() {
  var rows = [];
  try { rows = listRows_('istHouses', {}); } catch (e) { rows = []; }
  var map = {};
  rows.forEach(function (r) {
    if (String(r.active || 'yes').toLowerCase() === 'no') return;
    var house = str_(r.house);
    if (!house) return;
    [r.clientName, r.houseName, r.house].forEach(function (v) {
      var k = str_(v).toLowerCase();
      if (k) map[k] = house;
    });
  });
  return map;
}

/** The first consumer on the punch that names a known client wins. */
function reconLocate_(consumers, clientMap) {
  var parts = String(consumers || '').split(',');
  for (var i = 0; i < parts.length; i++) {
    var con = parts[i].trim().toLowerCase();
    if (con && clientMap[con]) return clientMap[con];
  }
  return 'Not Found';
}

// ─── The planned roster: reconLoadShifts_ ─── SOURCE DECISION: the estate's LIVE HOUSE CALENDARS, through the…

// Index sheet → [{ label, id }] of linked calendars, discovered from the cell hyperlinks (rich text), never typed…
function reconCalendarLinks_() {
  return cacheRead_('recon', 'calendarLinks', function () {
    var out = [], seen = {};
    try {
      var ss = ssOpen_(hubId_('RECON_INDEX_ID'));
      ss.getSheets().forEach(function (sh) {
        var rt = sh.getDataRange().getRichTextValues();
        for (var r = 0; r < rt.length; r++) {
          for (var c = 0; c < rt[r].length; c++) {
            var label = String(sh.getRange(r + 1, c + 1).getValue() || '').trim();
            var urls = [];
            var link = rt[r][c].getLinkUrl();
            if (link) urls.push(link);
            if (label) urls.push(label);   // a raw URL pasted as text also counts
            for (var u = 0; u < urls.length; u++) {
              var m = String(urls[u]).match(/\/d\/([a-zA-Z0-9_-]{20,})/);
              if (!m) continue;
              var id = m[1];
              if (id === hubId_('RECON_INDEX_ID') || seen[id]) continue;
              seen[id] = true;
              out.push({ label: label || id, id: id });
              break;
            }
          }
        }
      });
    } catch (e) {
      hubSysLog_('asa-hub:recon', 'recon_calendar_index_failed',
                 String((e && e.message) || e), { status: 500 });
    }
    return out;
  });
}

// House naming from the index labels themselves: 'CAN - 48TH (A) - ABD1547' gives code ABD1547 and short name '48TH…
function reconHouseAliases_(links) {
  var alias = {};
  links.forEach(function (l) {
    var code = '';
    var m = String(l.label).match(/([A-Z]+\d+)/);
    if (m) code = m[1];
    if (!code) {
      var parts = String(l.label).split(' - ');
      code = parts.length > 1 ? parts[parts.length - 1].trim() : String(l.label).trim();
    }
    if (!code) return;
    alias[code.toUpperCase()] = code;
    alias[String(l.label).toUpperCase()] = code;
    var seg = String(l.label).split(' - ');
    if (seg.length >= 2) alias[seg[1].trim().toUpperCase()] = code;   // '48TH (A)'
    l._code = code;
  });
  return alias;
}

// Locate the day/date header of a calendar tab: a day-names row within the first five, the date row directly under…
function reconCalendarLayout_(values) {
  var dateRow = -1;
  for (var i = 0; i < Math.min(5, values.length); i++) {
    var hits = 0;
    for (var c = 0; c < values[i].length; c++) {
      if (RECON_DAY_NAMES[String(values[i][c]).trim().toUpperCase()]) hits++;
    }
    if (hits >= 3 && i + 1 < values.length) { dateRow = i + 1; break; }
  }
  if (dateRow < 0) return null;
  var cols = {};
  for (var c2 = 3; c2 < values[dateRow].length; c2++) {
    var iso = reconCalendarDate_(values[dateRow][c2]);
    if (iso) cols[c2] = iso;
  }
  return { dateRow: dateRow, cols: cols };
}

// A date-row cell → 'yyyy-MM-dd'.
function reconCalendarDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return reconDateIso_(v);
  var m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return '';
  var month = parseInt(m[1], 10), day = parseInt(m[2], 10);
  var today = new Date();
  var cand = new Date(today.getFullYear(), month - 1, day);
  if ((cand - today) / 86400000 > 183) cand = new Date(today.getFullYear() - 1, month - 1, day);
  else if ((today - cand) / 86400000 > 183) cand = new Date(today.getFullYear() + 1, month - 1, day);
  return reconDateIso_(cand);
}

// The planned roster for [dateFrom, dateTo] ('yyyy-MM-dd'), one entry per worked cell.
function reconLoadShifts_(dateFrom, dateTo) {
  var roster = reconRoster_();
  var links = reconCalendarLinks_();
  var aliases = reconHouseAliases_(links);
  var out = [];

  links.forEach(function (link) {
    var house = link._code || link.label;
    var ss = null;
    try { ss = ssOpen_(link.id); }
    catch (e) {
      hubSysLog_('asa-hub:recon', 'recon_calendar_unreadable', link.label + ': ' +
                 String((e && e.message) || e), { status: 500 });
      return;
    }
    ss.getSheets().slice(0, RECON_MAX_TABS_PER_CALENDAR).forEach(function (sh) {
      var values = sh.getDataRange().getValues();
      if (values.length < 2) return;
      var layout = reconCalendarLayout_(values);
      if (!layout) return;
      for (var r = layout.dateRow + 1; r < values.length; r++) {
        var staff = String(values[r][1] == null ? '' : values[r][1]).trim();
        if (!staff || RECON_NOT_STAFF[staff.toUpperCase()]) continue;
        var who = null;
        for (var c in layout.cols) {
          if (!layout.cols.hasOwnProperty(c)) continue;
          var date = layout.cols[c];
          if (date < dateFrom || date > dateTo) continue;   // exact, after the loose read
          var cls = reconClassifyCell_(values[r][Number(c)]);
          if (!cls || cls.kind === 'off' || cls.kind === 'ro') continue;
          if (cls.kind !== 'hours') continue;   // an alias without hours cannot reconcile times
          var loc = house;
          if (cls.token) loc = aliases[String(cls.token).toUpperCase()] || cls.token;
          if (!who) who = reconResolveName_(staff, roster);
          out.push({
            date: date,
            location: loc,
            employeeId: who.ok ? who.id : '',
            employeeName: who.ok ? who.name : staff,
            matchKey: who.key,
            startMin: cls.startMin, endMin: cls.endMin,
            startTime: reconMinToTime_(cls.startMin),
            endTime: reconMinToTime_(cls.endMin),
            raw: String(values[r][Number(c)]).trim()
          });
        }
      }
    });
  });
  return out;
}

// ─── The five detectors (pure — self-tested below, no Google in here) ─── Punches and shifts arrive normalized: {…

function reconErr_(type, date, location, src, fields) {
  var e = {
    type: type, date: date, location: location,
    employeeId: src.employeeId || '', employeeName: src.employeeName || '',
    consumers: src.consumers || '', startTime: src.startTime || '',
    endTime: src.endTime || '', hours: src.hours || 0, detail: src.detail || ''
  };
  for (var k in (fields || {})) e[k] = fields[k];
  return e;
}

/** Duplicate entries: overlapping punches of the SAME person on one day. */
function reconDetectDupes_(punches) {
  var results = [];
  for (var i = 0; i < punches.length; i++) {
    for (var j = i + 1; j < punches.length; j++) {
      var a = punches[i], b = punches[j];
      if (a.date !== b.date || a.matchKey !== b.matchKey) continue;
      if (a.startMin === null || a.endMin === null || b.startMin === null || b.endMin === null) continue;
      var sA = a.startMin, eA = reconOvernight_(sA, a.endMin);
      var sB = b.startMin, eB = reconOvernight_(sB, b.endMin);
      if ((sA < eB && sB < eA) || (sA === sB && eA === eB)) {
        results.push(reconErr_('dupe', a.date, a.location, a, {
          detail: 'Overlapping entry: ' + b.startTime + ' - ' + b.endTime
        }));
      }
    }
  }
  return results;
}

/** Punches with no clock-out. */
function reconDetectNoEnd_(punches) {
  var results = [];
  for (var i = 0; i < punches.length; i++) {
    if (punches[i].endMin !== null) continue;
    results.push(reconErr_('noEnd', punches[i].date, punches[i].location, punches[i], {
      endTime: '', detail: 'Missing end time'
    }));
  }
  return results;
}

// Scheduled but not punched: coverage under cfg.missingCoveragePct.
function reconDetectMissing_(punches, shifts, cfg) {
  var reportDates = {}, reportLocations = {};
  punches.forEach(function (p) {
    if (p.date) reportDates[p.date] = true;
    if (p.location && p.location !== 'Not Found') reportLocations[p.location] = true;
  });
  var results = [];
  for (var i = 0; i < shifts.length; i++) {
    var s = shifts[i];
    if (!reportDates[s.date] || !reportLocations[s.location]) continue;
    var sStart = s.startMin, sEnd = reconOvernight_(s.startMin, s.endMin);
    var scheduledMin = sEnd - sStart;
    if (scheduledMin <= 0) continue;
    var covered = 0;
    for (var j = 0; j < punches.length; j++) {
      var p = punches[j];
      if (p.matchKey !== s.matchKey || p.date !== s.date || p.location !== s.location) continue;
      if (p.startMin === null || p.endMin === null) continue;
      var pEnd = reconOvernight_(p.startMin, p.endMin);
      var overlap = Math.min(sEnd, pEnd) - Math.max(sStart, p.startMin);
      if (overlap > 0) covered += overlap;
    }
    var pct = (covered / scheduledMin) * 100;
    if (pct < cfg.missingCoveragePct) {
      var missingHrs = Math.round(((scheduledMin - covered) / 60) * 100) / 100;
      results.push(reconErr_('missing', s.date, s.location, s, {
        hours: missingHrs,
        detail: 'Scheduled ' + s.startTime + '-' + s.endTime + ' (' + missingHrs.toFixed(1) + 'h missing)'
      }));
    }
  }
  return results;
}

// Consumer without staff for more than cfg.gapMin, per consumer per day.
function reconDetectGaps_(punches, shifts, missing, cfg) {
  var byConsumer = {};
  punches.forEach(function (p) {
    if (!p.consumers || p.startMin === null || p.endMin === null || p.location === 'Not Found') return;
    String(p.consumers).split(',').forEach(function (con) {
      con = con.trim();
      if (!con) return;
      if (!byConsumer[con]) byConsumer[con] = [];
      byConsumer[con].push({
        date: p.date, location: p.location,
        start: p.startMin, end: reconOvernight_(p.startMin, p.endMin)
      });
    });
  });

  var missingByDayLoc = {};
  (missing || []).forEach(function (m) {
    var k = m.date + '|' + m.location;
    if (!missingByDayLoc[k]) missingByDayLoc[k] = [];
    missingByDayLoc[k].push(m.employeeName);
  });

  var gaps = [], folded = [];
  for (var consumer in byConsumer) {
    var sched = byConsumer[consumer].sort(function (a, b) { return a.start - b.start; });
    for (var d = 0; d < sched.length - 1; d++) {
      var curr = sched[d], next = sched[d + 1];
      if (curr.date !== next.date) continue;
      var gapMin = next.start - curr.end;
      if (gapMin <= cfg.gapMin) continue;
      var gapHrs = Math.round((gapMin / 60) * 100) / 100;
      var gapStart = curr.end, gapEnd = next.start;

      var attributed = '', attributedId = '', bestPct = 0;
      for (var si = 0; si < shifts.length; si++) {
        var sh = shifts[si];
        if (sh.date !== curr.date || sh.location !== curr.location) continue;
        var shEnd = reconOvernight_(sh.startMin, sh.endMin);
        var ov = Math.min(gapEnd, shEnd) - Math.max(gapStart, sh.startMin);
        if (ov <= 0) continue;
        var pct = ov / gapMin;
        if (pct >= 0.70 && pct > bestPct) {
          bestPct = pct; attributed = sh.employeeName; attributedId = sh.employeeId;
        }
      }

      var linked = missingByDayLoc[curr.date + '|' + curr.location] || [];
      var entry = reconErr_('gap', curr.date, curr.location, {
        employeeId: attributedId,
        employeeName: attributed || (consumer + ' (consumer)'),
        consumers: consumer,
        startTime: reconMinToTime_(gapStart), endTime: reconMinToTime_(gapEnd),
        hours: gapHrs
      }, {});
      var parts = [gapHrs.toFixed(1) + 'h gap in coverage'];
      if (attributed) parts.push('attributed: ' + attributed);
      if (linked.length) parts.push('missing shift: ' + linked.join(', '));
      entry.detail = parts.join(' · ');

      if (linked.length) folded.push(entry); else gaps.push(entry);
    }
  }

  // A folded gap moves its context into the missing error's detail.
  var foldNotes = {};
  folded.forEach(function (g) {
    var k = g.date + '|' + g.location;
    if (!foldNotes[k]) foldNotes[k] = [];
    foldNotes[k].push(g.hours + 'h gap (' + g.consumers + ')');
  });
  (missing || []).forEach(function (m) {
    var notes = foldNotes[m.date + '|' + m.location];
    if (notes) m.detail += ' · consumer gaps: ' + notes.join(', ');
  });

  return { gaps: gaps, folded: folded };
}

// Two or more staff on the SAME consumer longer than cfg.overlapMin — sweep-line over the day, counting distinct…
function reconDetectOverlaps_(punches, cfg) {
  var byConsumerDate = {};
  punches.forEach(function (p) {
    if (!p.consumers || p.startMin === null || p.endMin === null) return;
    String(p.consumers).split(',').forEach(function (con) {
      con = con.trim();
      if (!con) return;
      var k = con + '|' + p.date;
      if (!byConsumerDate[k]) byConsumerDate[k] = { consumer: con, date: p.date, location: p.location, entries: [] };
      byConsumerDate[k].entries.push({
        name: p.employeeName, start: p.startMin, end: reconOvernight_(p.startMin, p.endMin)
      });
    });
  });

  var results = [], suppressed = 0;
  for (var k in byConsumerDate) {
    var group = byConsumerDate[k];
    if (group.entries.length < 2) continue;
    var events = [];
    group.entries.forEach(function (e) {
      events.push({ time: e.start, delta: 1, emp: e.name });
      events.push({ time: e.end, delta: -1, emp: e.name });
    });
    events.sort(function (a, b) { return a.time - b.time || a.delta - b.delta; });

    var active = {}, currentStart = null, currentEmps = null;
    var close = function (rangeEnd) {
      var dur = rangeEnd - currentStart;
      if (dur > cfg.overlapMin) {
        results.push(reconErr_('overlap', group.date, group.location, {
          employeeName: currentEmps.join(', '),
          consumers: group.consumer,
          startTime: reconMinToTime_(currentStart), endTime: reconMinToTime_(rangeEnd),
          hours: Math.round((dur / 60) * 100) / 100
        }, {
          detail: (dur / 60).toFixed(1) + 'h overstaffed (' + currentEmps.length +
                  ' employees vs 1 expected) ' + reconMinToTime_(currentStart) +
                  ' – ' + reconMinToTime_(rangeEnd)
        }));
      } else if (dur > 0) {
        suppressed++;
      }
    };

    for (var ev = 0; ev < events.length; ev++) {
      var e = events[ev];
      if (e.delta === 1) active[e.emp] = (active[e.emp] || 0) + 1;
      else {
        active[e.emp] = (active[e.emp] || 1) - 1;
        if (active[e.emp] <= 0) delete active[e.emp];
      }
      var emps = [];
      for (var ae in active) emps.push(ae);
      var nextTime = (ev + 1 < events.length) ? events[ev + 1].time : e.time;
      if (emps.length > 1 && e.time < nextTime) {
        if (currentStart === null) { currentStart = e.time; currentEmps = emps.sort(); }
      } else if (currentStart !== null) {
        close(e.time);
        currentStart = null; currentEmps = null;
      }
    }
    if (currentStart !== null) close(events[events.length - 1].time);
  }
  return { overlaps: results, suppressed: suppressed };
}

/** All five classes over one punch set × one roster. Pure. */
function reconDetectAll_(punches, shifts, cfg) {
  var dupe = reconDetectDupes_(punches);
  var noEnd = reconDetectNoEnd_(punches);
  var missing = reconDetectMissing_(punches, shifts, cfg);
  var g = reconDetectGaps_(punches, shifts, missing, cfg);
  var o = reconDetectOverlaps_(punches, cfg);
  return {
    missing: missing, noEnd: noEnd, dupe: dupe, gap: g.gaps, overlap: o.overlaps,
    suppressed: g.folded.length + o.suppressed
  };
}

// ─── Config, folders, upload plumbing (runtime — these touch Google) ───

/** Defaults overridden by the reconThresholds row in finance_config. */
function reconConfig_() {
  var out = {};
  for (var k in RECON_DEFAULTS) out[k] = RECON_DEFAULTS[k];
  out.source = {};
  var reconDefault = reconSourceDefault_();
  for (var sk in reconDefault) out.source[sk] = reconDefault[sk];
  try {
    listRows_('financeConfig', {}).forEach(function (r) {
      if (str_(r.key) !== RECON_CONFIG_KEY) return;
      var saved = null;
      try { saved = JSON.parse(str_(r.value) || '{}'); }
      catch (e) {
        if (typeof hubSysLog_ === 'function') {
          hubSysLog_('asa-hub:recon', 'recon_config_bad_json',
                     'the reconThresholds row is not valid JSON — the defaults are in force',
                     { status: 500 });
        }
        saved = null;
      }
      if (!saved) return;
      for (var key in RECON_DEFAULTS) {
        var n = Number(saved[key]);
        if (!isNaN(n) && n > 0) out[key] = n;
      }
      if (saved.source && typeof saved.source === 'object') {
        for (var sk2 in RECON_SOURCE_DEFAULT) {
          var sv = String(saved.source[sk2] == null ? '' : saved.source[sk2]).trim();
          if (sv) out.source[sk2] = sv;
        }
      }
    });
  } catch (e) { /* the defaults stand */ }
  return out;
}

// The recon archive folder: by the ID saved in Script Properties; the name is only the first-run creation, inside…
function reconReportsFolder_() {
  return filesBranch_(RECON_FOLDER_NAME, RECON_FOLDER_PROP);
}

// The upload as rows: CSV parsed directly; XLS/XLSX converted through a throwaway Sheet copy (Drive v3 REST, the…
function reconReadReportRows_(bytes, filename, archiveFileId) {
  var isCsv = /\.csv$/i.test(filename);
  if (isCsv) {
    var text = Utilities.newBlob(bytes).getDataAsString();
    return { rows: Utilities.parseCsv(text), reportTz: '' };
  }
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var copy = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + archiveFileId + '/copy',
    { method: 'post', contentType: 'application/json', headers: auth,
      payload: JSON.stringify({ mimeType: 'application/vnd.google-apps.spreadsheet',
                                name: '_recon_tmp_' + Date.now() }),
      muteHttpExceptions: true });
  var copyId = '';
  try { copyId = JSON.parse(copy.getContentText()).id || ''; } catch (e) { copyId = ''; }
  if (!copyId) throw new Error('Could not convert the report to a Sheet (Drive copy failed)');
  try {
    var ss = ssOpen_(copyId);
    var tz = ss.getSpreadsheetTimeZone();
    var values = ss.getSheets()[0].getDataRange().getValues();
    return { rows: values, reportTz: tz };
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + copyId,
                      { method: 'delete', headers: auth, muteHttpExceptions: true });
  }
}

// A time cell off the converted report → 'hh:mm:ss AM'.
function reconReportTime_(val, reportTz) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) {
    var tz = reportTz || 'UTC';
    return Utilities.formatDate(val, tz, 'hh:mm:ss a');
  }
  if (typeof val === 'number' && val >= 0 && val < 1) {
    var totalSec = Math.round(val * 86400);
    var h = Math.floor(totalSec / 3600);
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + reconPad2_(Math.floor((totalSec % 3600) / 60)) + ':' +
           reconPad2_(totalSec % 60) + ' ' + ap;
  }
  return String(val).trim();
}

// Location Report rows → cleaned punches.
function reconCleanReportRows_(rawRows, reportTz, clientMap) {
  var cleaned = [];
  for (var i = 0; i < rawRows.length; i++) {
    var row = rawRows[i];
    var dateVal = row[1];
    if (!dateVal) continue;
    var d = (dateVal instanceof Date) ? dateVal : reconParseDate_(dateVal);
    if (!d || isNaN(d.getTime()) || d.getFullYear() < 2020) continue;

    var employeeRaw = row[13] ? String(row[13]).trim() : '';
    if (!employeeRaw) continue;
    if (employeeRaw.length > 9) employeeRaw = employeeRaw.substring(9).trim();

    var startTime = reconReportTime_(row[23], reportTz);
    var endTime = reconReportTime_(row[26], reportTz);
    var totalHours = typeof row[32] === 'number' ? row[32] : parseFloat(row[32]) || 0;
    var consumers = row[40] ? String(row[40]).trim() : '';

    cleaned.push({
      date: reconDateIso_(d),
      employeeRaw: employeeRaw,
      workCode: row[18] ? String(row[18]) : '',
      startTime: startTime,
      endTime: endTime,
      startMin: reconParseTimeMin_(startTime),
      endMin: reconParseTimeMin_(endTime),
      hours: Math.round(totalHours * 100) / 100,
      consumers: consumers,
      location: reconLocate_(consumers, clientMap)
    });
  }
  return cleaned;
}

// ─── The master sheet source (pure — self-tested) ───

// A time cell off the master tabs → 'h:mm:ss AM'.
function reconCellTime_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    var h = v.getUTCHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + reconPad2_(v.getUTCMinutes()) + ':' + reconPad2_(v.getUTCSeconds()) + ' ' + ap;
  }
  if (typeof v === 'number' && v >= 0 && v < 1) {
    var totalSec = Math.round(v * 86400);
    var hh = Math.floor(totalSec / 3600), ap2 = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12; if (hh === 0) hh = 12;
    return hh + ':' + reconPad2_(Math.floor((totalSec % 3600) / 60)) + ':' +
           reconPad2_(totalSec % 60) + ' ' + ap2;
  }
  return String(v).trim();
}

// `Cleaned Location` rows → cleaned punches.
function reconMasterRows_(values, clientMap) {
  if (!values || values.length < 2) return [];
  var head = values[0].map(function (h) {
    return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
  });
  var col = function (name) { return head.indexOf(name); };
  var cDate = col('dateofservice'), cEmp = col('employee'), cWork = col('workcode'),
      cStart = col('starttime'), cEnd = col('endtime'), cHours = col('totalhours'),
      cCons = col('consumers'), cLoc = col('location');
  if (cDate < 0 || cEmp < 0) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var d = reconParseDate_(row[cDate]);
    if (!d || d.getFullYear() < 2020) continue;
    var emp = String(row[cEmp] == null ? '' : row[cEmp]).trim();
    if (!emp) continue;
    var startTime = cStart >= 0 ? reconCellTime_(row[cStart]) : '';
    var endTime = cEnd >= 0 ? reconCellTime_(row[cEnd]) : '';
    var totalHours = cHours >= 0
      ? (typeof row[cHours] === 'number' ? row[cHours] : parseFloat(row[cHours]) || 0) : 0;
    var consumers = cCons >= 0 ? String(row[cCons] == null ? '' : row[cCons]).trim() : '';
    var ownLoc = cLoc >= 0 ? String(row[cLoc] == null ? '' : row[cLoc]).trim() : '';
    out.push({
      date: reconDateIso_(d),
      employeeRaw: emp,
      workCode: cWork >= 0 ? String(row[cWork] == null ? '' : row[cWork]) : '',
      startTime: startTime,
      endTime: endTime,
      startMin: reconParseTimeMin_(startTime),
      endMin: reconParseTimeMin_(endTime),
      hours: Math.round(totalHours * 100) / 100,
      consumers: consumers,
      location: ownLoc || reconLocate_(consumers, clientMap),
      sourceKey: String(i + 1)
    });
  }
  return out;
}

// `Client to Location` rows → {consumer lowercase → house}.
function reconMasterClientMap_(values) {
  var map = {};
  (values || []).forEach(function (row, ri) {
    if (ri === 0) return;   // the header pair: Consumers, Location
    var con = String(row[0] == null ? '' : row[0]).trim().toLowerCase();
    var loc = String(row[1] == null ? '' : row[1]).trim();
    if (!con || !loc || loc.toLowerCase() === 'none') return;
    map[con] = loc;
  });
  return map;
}

// `Staff Mapping` is pairs of pairs side by side: [cal, sys, cal, sys, …], with a header row naming the columns.
function reconStaffMapPairs_(values) {
  var pairs = [];
  (values || []).forEach(function (row) {
    for (var c = 0; c + 1 < row.length; c += 2) {
      var cal = String(row[c] == null ? '' : row[c]).trim();
      var sys = String(row[c + 1] == null ? '' : row[c + 1]).trim();
      if (!cal || !sys) continue;
      if (/^employee\s/i.test(cal) || /^employee\s/i.test(sys)) continue;   // header cells
      pairs.push({ cal: cal, sys: sys });
    }
  });
  return pairs;
}

// Pairs → a BIDIRECTIONAL name map, keyed by normalized spelling both ways (calendar spelling and system 'Last…
function reconStaffMap_(pairs) {
  var byCal = {}, bySys = {};
  (pairs || []).forEach(function (p) {
    var ck = nameNorm_(p.cal), sk = nameNorm_(p.sys);
    if (ck) byCal[ck] = p.sys;
    if (sk) bySys[sk] = p.cal;
  });
  return { byCal: byCal, bySys: bySys };
}

// The sheet's spelling → the mapped spelling, either direction.
function reconTranslateName_(name, map) {
  if (!map) return name;
  var k = nameNorm_(name);
  return map.byCal[k] || map.bySys[k] || name;
}

// Import idempotency by sourceKey: rows already stored are skipped, new ones import.
function reconFilterNew_(cleaned, existingKeys) {
  var fresh = [], skipped = 0;
  (cleaned || []).forEach(function (c) {
    if (c.sourceKey && existingKeys[c.sourceKey]) { skipped++; return; }
    fresh.push(c);
  });
  return { fresh: fresh, skipped: skipped };
}

// A stored punch row → the detector's shape.
function reconPunchForDetect_(row) {
  var raw = str_(row.employeeRaw);
  var key = str_(row.employeeId) || ('name:' + nameTokens_(raw).core.join(' '));
  return {
    date: str_(row.date),
    matchKey: key,
    employeeId: str_(row.employeeId),
    employeeName: str_(row.employeeName) || raw,
    location: str_(row.location),
    startMin: reconParseTimeMin_(row.start),
    endMin: reconParseTimeMin_(row.end),
    startTime: str_(row.start),
    endTime: str_(row.end),
    consumers: str_(row.consumers),
    hours: Number(row.totalHours) || 0
  };
}

// The Smart Comms subject: recent runs with something to report.
function reconSmartSubjects_() {
  var cfg = reconConfig_();
  var cutoff = Date.now() - cfg.smartRunDays * 86400000;
  var rows = [];
  try { rows = listRows_('recon_runs', {}); } catch (e) { rows = []; }
  return rows.filter(function (r) {
    var t = new Date(str_(r.createdAt)).getTime();
    return !isNaN(t) && t >= cutoff && (Number(r.total) || 0) > 0;
  }).map(function (r) {
    return { id: str_(r.id), name: 'recon run ' + str_(r.id).slice(0, 8),
             total: str_(r.total), missing: str_(r.missing), noEnd: str_(r.noEnd),
             dupe: str_(r.dupe), gap: str_(r.gap), overlap: str_(r.overlap),
             period: str_(r.dateFrom) + ' – ' + str_(r.dateTo) };
  });
}

// ─── Actions ───

HUB_POLICY.reconUploadReport = {
  file: 'Recon.gs', lane: 'write', store: 'sheet',
  // MINUTES: an XLS becomes a throwaway Sheet and hundreds of rows land one createRow_ at a time.
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { filename: { type: 'string', required: true },
            contentBase64: { type: 'string', required: true } }
};
HUB_ACTIONS.reconUploadReport = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};

  var b64 = String(payload.contentBase64 || '');
  if (!b64) return { status: 400, message: 'No file attached' };
  var bytes;
  try { bytes = Utilities.base64Decode(b64); }
  catch (e) { return { status: 400, message: 'The file is not valid base64' }; }
  if (!bytes.length) return { status: 400, message: 'The file is empty' };
  if (bytes.length > 15 * 1024 * 1024) return { status: 400, message: 'The file is over 15MB' };

  var filename = String(payload.filename || 'location-report').trim();
  var mime = /\.csv$/i.test(filename) ? 'text/csv' : 'application/vnd.ms-excel';

  // Archive the original first, by saved folder ID, never a loose name.
  var fileId = '';
  try {
    var stamp = Utilities.formatDate(new Date(), hiringTimeZone_(), 'yyyy-MM-dd_HHmmss');
    var archived = reconReportsFolder_().createFile(Utilities.newBlob(bytes, mime, stamp + ' — ' + filename));
    fileId = archived.getId();
  } catch (eA) {
    return { status: 502, message: 'Could not archive the report: ' + String((eA && eA.message) || eA) };
  }

  var parsed;
  try {
    parsed = reconReadReportRows_(bytes, filename, fileId);
  } catch (eP) {
    return { status: 400, message: 'Could not parse the report: ' + String((eP && eP.message) || eP) };
  }

  var clientMap = reconClientHouseMap_();
  var roster = reconRoster_();
  var cleaned = reconCleanReportRows_(parsed.rows, parsed.reportTz, clientMap);
  if (!cleaned.length) return { status: 400, message: 'No punch rows found in that report' };

  var by = 'asa-hub:' + str_(user && user.email);
  var stored = reconStorePunches_(cleaned, roster, fileId, by);
  if (reconStoreRefusal_(stored)) return reconStoreRefusal_(stored);

  hubSysLog_(user && user.email, 'recon_upload',
             stored.entries + ' punches, ' + stored.unmapped.length + ' unmapped, file ' + fileId,
             { status: 200 });
  return { status: 200, data: {
    entries: stored.entries,
    locations: stored.locations,
    unmapped: stored.unmapped,
    period: stored.period,
    fileId: fileId
  } };
};

// The shared tail of upload and import: resolve every cleaned punch against the roster, write the rows, report what…
function reconStorePunches_(cleaned, roster, sourceFileId, by, opts) {
  var nameMap = opts && opts.nameMap;
  var locations = {}, unmapped = [], from = '', to = '';
  // `entries` counts rows that landed; the first refused write stops the store and is answered.
  var written = 0, refused = null;
  cleaned.forEach(function (c) {
    if (refused) return;
    var translated = nameMap ? reconTranslateName_(c.employeeRaw, nameMap) : c.employeeRaw;
    var who = reconResolveName_(translated, roster);
    if (!who.ok && translated !== c.employeeRaw) {
      var untranslated = reconResolveName_(c.employeeRaw, roster);
      if (untranslated.ok) who = untranslated;
    }
    if (!who.ok) {
      unmapped.push({ employeeRaw: c.employeeRaw, reason: who.reason,
                      candidates: who.candidates || [] });
    }
    if (c.location !== 'Not Found') locations[c.location] = true;
    if (!from || c.date < from) from = c.date;
    if (!to || c.date > to) to = c.date;
    var rec = {
      date: c.date,
      employeeRaw: c.employeeRaw,
      employeeId: who.ok ? who.id : '',          // the resolved key, or nobody
      employeeName: who.ok ? who.name : c.employeeRaw,
      workCode: c.workCode,
      start: c.startTime,
      end: c.endTime,
      totalHours: c.hours,
      consumers: c.consumers,
      location: c.location,
      sourceFile: c.sourceFile || sourceFileId,
      uploadedBy: by
    };
    if (c.sourceKey) rec.sourceKey = c.sourceKey;   // import idempotency key
    refused = sheetDbRefused_(createRow_('time_punches', rec));
    if (!refused) written++;
  });
  var locs = [];
  for (var l in locations) locs.push(l);
  return { entries: written, locations: locs.sort(), unmapped: unmapped,
           period: { from: from, to: to }, refused: refused };
}

/** The answer an import gives when its store was refused part-way. */
function reconStoreRefusal_(stored) {
  var r = stored && stored.refused;
  return r ? { status: r.status, message: r.message + ' — ' + stored.entries +
               ' punch(es) were stored before the refusal; the rest were not.' } : null;
}

// The idempotency question for an import, over rows already read: has this source file been stored before, and over…
function reconFindImport_(rows, fileId) {
  var from = '', to = '', count = 0;
  (rows || []).forEach(function (r) {
    if (str_(r.sourceFile) !== fileId) return;
    count++;
    var d = str_(r.date);
    if (d && (!from || d < from)) from = d;
    if (d && (!to || d > to)) to = d;
  });
  return { found: count > 0, entries: count, period: { from: from, to: to } };
}

HUB_POLICY.reconRun = {
  file: 'Recon.gs', lane: 'write', store: 'sheet',
  // MINUTES: the planned roster means opening every house calendar linked off the estate's index — real reads, not…
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [],
  // The handler never sends: the Smart Comms situation `recon_errors_found` (seeded OFF) owns wording, recipients…
  emits: ['teamAlert'],
  emits_via: 'smart-comms',
  params: { dateFrom: { type: 'string' }, dateTo: { type: 'string' } }
};
HUB_ACTIONS.reconRun = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var cfg = reconConfig_();

  var rows = [];
  try { rows = listRows_('time_punches', {}); } catch (e) { rows = []; }
  var punches = rows.map(reconPunchForDetect_).filter(function (p) { return p.date; });
  if (!punches.length) return { status: 400, message: 'No punches on file — upload a report first' };

  var dateFrom = str_(payload.dateFrom), dateTo = str_(payload.dateTo);
  if (!dateFrom || !dateTo) {
    var min = '', max = '';
    punches.forEach(function (p) {
      if (!min || p.date < min) min = p.date;
      if (!max || p.date > max) max = p.date;
    });
    dateFrom = dateFrom || min;
    dateTo = dateTo || max;
  }
  punches = punches.filter(function (p) { return p.date >= dateFrom && p.date <= dateTo; });

  var shifts = reconLoadShifts_(dateFrom, dateTo);
  var found = reconDetectAll_(punches, shifts, cfg);
  var total = found.missing.length + found.noEnd.length + found.dupe.length +
              found.gap.length + found.overlap.length;

  var by = 'asa-hub:' + str_(user && user.email);
  var run = createRow_('recon_runs', {
    dateFrom: dateFrom, dateTo: dateTo,
    missing: found.missing.length, noEnd: found.noEnd.length, dupe: found.dupe.length,
    gap: found.gap.length, overlap: found.overlap.length, total: total,
    suppressed: found.suppressed,
    status: 'Review', createdBy: by
  });
  if (sheetDbRefused_(run)) return sheetDbRefused_(run);

  var all = [].concat(found.missing, found.noEnd, found.dupe, found.gap, found.overlap);
  var errRefused = null, errWritten = 0;
  all.forEach(function (e) {
    if (errRefused) return;
    errRefused = sheetDbRefused_(createRow_('recon_errors', {
      runId: run.id,
      type: e.type, date: e.date, location: e.location,
      employeeId: e.employeeId, employeeName: e.employeeName,
      consumers: e.consumers, startTime: e.startTime, endTime: e.endTime,
      hours: e.hours, detail: e.detail,
      status: 'Open', note: '', resolvedBy: '', resolvedAt: ''
    }));
    if (!errRefused) errWritten++;
  });
  if (errRefused) {
    return { status: errRefused.status, message: errRefused.message + ' — the run ' + run.id + ' and ' +
             errWritten + ' of its ' + all.length + ' error row(s) were written before the refusal.' };
  }

  // Never a direct send: the sweep finds this run through reconSmartSubjects_ and reports it if the situation is on.
  if (total > 0 && typeof smartEventSweep_ === 'function') {
    try { smartEventSweep_({}); }
    catch (eS) {
      hubSysLog_('asa-hub:recon', 'recon_sweep_failed', String((eS && eS.message) || eS), { status: 500 });
    }
  }

  hubSysLog_(user && user.email, 'recon_run',
             run.id + ': ' + total + ' errors (' + found.suppressed + ' suppressed)', { status: 200 });
  return { status: 200, data: {
    runId: run.id,
    counts: { missing: found.missing.length, noEnd: found.noEnd.length,
              dupe: found.dupe.length, gap: found.gap.length, overlap: found.overlap.length },
    suppressed: found.suppressed
  } };
};

HUB_POLICY.reconRuns = {
  file: 'Recon.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.reconRuns = function (payload, user) {
  if (!user) return hubDenied_();
  var rows = [];
  try { rows = listRows_('recon_runs', {}); } catch (e) { rows = []; }
  rows.sort(function (a, b) { return str_(b.createdAt) < str_(a.createdAt) ? -1 : 1; });
  return { status: 200, data: { runs: rows.slice(0, 20) } };
};

HUB_POLICY.reconErrors = {
  file: 'Recon.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: [],
  params: { runId: { type: 'string' }, status: { type: 'string' } }
};
HUB_ACTIONS.reconErrors = function (payload, user) {
  if (!user) return hubDenied_();
  payload = payload || {};
  var runId = str_(payload.runId);
  if (!runId) {
    var runs = [];
    try { runs = listRows_('recon_runs', {}); } catch (e) { runs = []; }
    runs.sort(function (a, b) { return str_(b.createdAt) < str_(a.createdAt) ? -1 : 1; });
    runId = runs.length ? str_(runs[0].id) : '';
  }
  if (!runId) return { status: 200, data: { runId: '', errors: [] } };
  var status = str_(payload.status) || 'Open';
  var rows = [];
  try { rows = listRows_('recon_errors', {}); } catch (e2) { rows = []; }
  var errors = rows.filter(function (r) {
    if (str_(r.runId) !== runId) return false;
    if (status.toLowerCase() === 'all') return true;
    return str_(r.status) === status;
  }).map(reconHealStamps_);
  return { status: 200, data: { runId: runId, errors: errors } };
};

// Heal the 1899 stamps written into recon_errors before cellText_ existed.
function reconHealStamps_(row) {
  var out = {}, k;
  for (k in row) {
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  }
  out.startTime = reconStoredTime_(out.startTime);
  out.endTime = reconStoredTime_(out.endTime);
  out.date = reconStoredDay_(out.date);
  return out;
}

/** '1899-12-30T21:30:00.000Z' → '9:30:00 PM'. Anything else passes through. */
function reconStoredTime_(v) {
  var s = str_(v);
  var m = /^18\d\d-\d\d-\d\dT(\d\d):(\d\d):(\d\d)/.exec(s);
  if (!m) return s;
  var h = Number(m[1]), ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + m[2] + ':' + m[3] + ' ' + ap;
}

/** '' → ''. Anything else passes through. */
function reconStoredDay_(v) {
  var s = str_(v);
  var m = /^(\d{4}-\d{2}-\d{2})T00:00:00/.exec(s);
  return m ? m[1] : s;
}

HUB_POLICY.reconErrorResolve = {
  file: 'Recon.gs', lane: 'write', store: 'sheet',
  // The row is the memory: resolving twice to the same state writes the same row, which is what idempotent means…
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { errorId: { type: 'string', required: true },
            status: { type: 'string', required: true },
            note: { type: 'string' } }
};
HUB_ACTIONS.reconErrorResolve = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var status = str_(payload.status);
  if (RECON_ERROR_STATUSES.indexOf(status) === -1) {
    return { status: 400, message: 'status must be one of ' + RECON_ERROR_STATUSES.join(', ') };
  }
  // A durable record: the error is resolved, never deleted.
  var patch = { id: str_(payload.errorId), status: status };
  if (status === 'Open') {
    patch.resolvedBy = ''; patch.resolvedAt = '';
  } else {
    patch.resolvedBy = 'asa-hub:' + str_(user && user.email);
    patch.resolvedAt = new Date().toISOString();
  }
  if (payload.note !== undefined && payload.note !== null && String(payload.note) !== '') {
    patch.note = String(payload.note);
  }
  var out = updateRowById_('recon_errors', patch);
  if (out && out.error) return out.error;
  hubSysLog_(user && user.email, 'recon_error_resolve',
             str_(payload.errorId) + ' → ' + status, { status: 200 });
  return { status: 200, data: { error: out } };
};

HUB_POLICY.reconRunClose = {
  file: 'Recon.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { runId: { type: 'string', required: true },
            status: { type: 'string', required: true } }
};
HUB_ACTIONS.reconRunClose = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var status = str_(payload.status);
  if (RECON_RUN_STATUSES.indexOf(status) === -1) {
    return { status: 400, message: 'status must be one of ' + RECON_RUN_STATUSES.join(', ') };
  }
  var out = updateRowById_('recon_runs', { id: str_(payload.runId), status: status });
  if (out && out.error) return out.error;
  hubSysLog_(user && user.email, 'recon_run_close', str_(payload.runId) + ' → ' + status, { status: 200 });
  return { status: 200, data: { run: out } };
};

HUB_POLICY.reconShiftsForDate = {
  file: 'Recon.gs', lane: 'read', store: 'sheet',
  // Opens the house calendars for one day — the same reads reconRun makes.
  idempotent: true, cost: 'minutes',
  roles: [],
  invalidates: [], emits: [],
  params: { date: { type: 'string', required: true },
            location: { type: 'string', required: true } }
};
HUB_ACTIONS.reconShiftsForDate = function (payload, user) {
  if (!user) return hubDenied_();
  payload = payload || {};
  var date = str_(payload.date), location = str_(payload.location);
  var rows = [];
  try { rows = listRows_('time_punches', {}); } catch (e) { rows = []; }
  var punches = rows.map(reconPunchForDetect_).filter(function (p) {
    return p.date === date && p.location === location;
  }).map(function (p) {
    return { employeeId: p.employeeId, employeeName: p.employeeName,
             startTime: p.startTime, endTime: p.endTime,
             hours: p.hours, consumers: p.consumers };
  });
  var shifts = reconLoadShifts_(date, date).filter(function (s) {
    return s.location === location;
  }).map(function (s) {
    return { employeeId: s.employeeId, employeeName: s.employeeName,
             startTime: s.startTime, endTime: s.endTime, raw: s.raw };
  });
  return { status: 200, data: { date: date, location: location,
                                shifts: shifts, punches: punches } };
};

HUB_POLICY.reconAiSuggest = {
  file: 'Recon.gs', lane: 'tool', store: 'external',
  // Display-only: the suggestion is never written back as a resolution.
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { errorId: { type: 'string', required: true } }
};
HUB_ACTIONS.reconAiSuggest = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  if (typeof screenAiChat_ !== 'function') {
    return { status: 502, message: 'AI is not available in this build' };
  }
  var errRow = null;
  try { errRow = requireRow_('recon_errors', str_(payload.errorId)); }
  catch (e) { errRow = null; }
  if (!errRow || errRow.error) return { status: 404, message: 'No recon error with that id' };

  // The model PROPOSES; the resolution stays a human write through reconErrorResolve.
  var prompt =
    'You are helping a home-care agency operations manager reconcile a time report ' +
    'against the planned roster. Suggest in 1-2 plain factual sentences how to resolve ' +
    'this discrepancy (what to check, who to confirm with, or the likely explanation). ' +
    'Do not invent facts beyond the record. Answer with JSON: {"suggestion": "..."}\n\n' +
    'Error type: ' + str_(errRow.type) + '\n' +
    'Date: ' + reconStoredDay_(errRow.date) + '\n' +
    'Location: ' + str_(errRow.location) + '\n' +
    'Employee: ' + str_(errRow.employeeName) + '\n' +
    'Consumers: ' + str_(errRow.consumers) + '\n' +
    'Start: ' + reconStoredTime_(errRow.startTime) + '  End: ' + reconStoredTime_(errRow.endTime) +
    '  Hours: ' + str_(errRow.hours) + '\n' +
    'Detail: ' + str_(errRow.detail);
  var chat = null;
  try { chat = screenAiChat_(prompt, 0.2, 'ai_recon_day'); } catch (e2) { chat = null; }
  if (!chat || !chat.ok) {
    return { status: 502, message: 'AI suggestion failed: ' + str_(chat && chat.error || 'no provider') };
  }
  var suggestion = '';
  try { suggestion = str_(JSON.parse(chat.content).suggestion); }
  catch (e3) { suggestion = str_(chat.content); }
  if (!suggestion) return { status: 502, message: 'AI returned an empty suggestion' };
  return { status: 200, data: { suggestion: suggestion } };
};


HUB_POLICY.reconImportLatest = {
  file: 'Recon.gs', lane: 'write', store: 'sheet',
  // The source (master sheet or legacy Drive folder — the `source` block of the reconThresholds row chooses) is…
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { fileId: { type: 'string' } }
};
HUB_ACTIONS.reconImportLatest = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};
  var cfg = reconConfig_();
  if (String(cfg.source.mode).toLowerCase() === 'legacyfolder') {
    return reconImportLegacyFolder_(payload, user);
  }
  return reconImportMasterSheet_(payload, user, cfg);
};

// MASTER SHEET MODE — read rows from the MASTER TIME RECONCILIATION workbook, no upload parsing.
function reconImportMasterSheet_(payload, user, cfg) {
  var src = cfg.source;

  // Opened BY ID, and honest when the account cannot see it — a silent empty import would read as "no new punches".
  var ss = null;
  try { ss = ssOpen_(src.spreadsheetId); }
  catch (eS) { ss = null; }
  if (!ss) {
    return { status: 502, message: 'The master reconciliation workbook is not accessible by its ID (' +
      src.spreadsheetId + ') from this account — check the ID and the sharing.' };
  }
  var sh = ss.getSheetByName(src.punchesTab);
  if (!sh) {
    return { status: 502, message: 'The "' + src.punchesTab +
      '" tab is missing from the master reconciliation workbook' };
  }

  // Client map: the workbook's own Client → Location first (its 'None' names no house and is skipped), the estate's…
  var clientMap = reconClientHouseMap_();
  var cmTab = ss.getSheetByName(src.clientMapTab);
  if (cmTab) {
    var masterMap = reconMasterClientMap_(cmTab.getDataRange().getValues());
    for (var cm in masterMap) clientMap[cm] = masterMap[cm];
  }

  // Staff Mapping: calendar spelling ↔ system spelling, both directions.
  var staffMap = null;
  var smTab = ss.getSheetByName(src.staffMapTab);
  if (smTab) {
    staffMap = reconStaffMap_(reconStaffMapPairs_(smTab.getDataRange().getValues()));
  }

  var cleaned = reconMasterRows_(sh.getDataRange().getValues(), clientMap);
  if (!cleaned.length) {
    return { status: 400, message: 'No punch rows found in the "' + src.punchesTab + '" tab' };
  }

  var sourceFile = 'master:' + src.punchesTab;
  var rows = [];
  try { rows = listRows_('time_punches', {}); } catch (eL) { rows = []; }
  var existingKeys = {};
  rows.forEach(function (r) {
    if (str_(r.sourceFile) === sourceFile && str_(r.sourceKey)) {
      existingKeys[str_(r.sourceKey)] = true;
    }
  });
  var prior = reconFindImport_(rows, sourceFile);
  var split = reconFilterNew_(cleaned, existingKeys);

  var source = {
    fileId: src.spreadsheetId,
    name: 'MASTER TIME RECONCILIATION — ' + src.punchesTab,
    modifiedTime: new Date().toISOString()
  };
  if (!split.fresh.length) {
    return { status: 200, data: {
      alreadyImported: true,
      source: source,
      entries: 0,
      locations: [],
      unmapped: [],
      period: prior.period,
      fileId: src.spreadsheetId
    } };
  }

  var by = 'asa-hub:import-latest:' + str_(user && user.email);
  var roster = reconRoster_();
  var stored = reconStorePunches_(split.fresh, roster, sourceFile, by, { nameMap: staffMap });
  if (reconStoreRefusal_(stored)) return reconStoreRefusal_(stored);

  hubSysLog_(user && user.email, 'recon_import_master',
             stored.entries + ' punches (' + split.skipped + ' already on file), ' +
             stored.unmapped.length + ' unmapped', { status: 200 });
  return { status: 200, data: {
    alreadyImported: false,
    source: source,
    entries: stored.entries,
    locations: stored.locations,
    unmapped: stored.unmapped,
    period: stored.period,
    fileId: src.spreadsheetId
  } };
}

// LEGACY FOLDER MODE — the behaviour this action shipped with: the newest file of the legacy portal's report…
function reconImportLegacyFolder_(payload, user) {

  // Opened BY ID; if the account cannot see it, say so — a silent empty import would read as "no new reports".
  var folder = null;
  try { folder = DriveApp.getFolderById(hubId_('RECON_LEGACY_FOLDER_ID')); }
  catch (eF) { folder = null; }
  if (!folder) {
    return { status: 502, message: 'The legacy report archive is not accessible by its folder ID (' +
      hubId_('RECON_LEGACY_FOLDER_ID') + ') from this account — check the ID and the sharing.' };
  }

  // The target: a named file, or the freshest one in the folder.
  var file = null;
  var wanted = str_(payload.fileId);
  if (wanted) {
    try {
      var cand = DriveApp.getFileById(wanted);
      if (cand && !cand.isTrashed()) file = cand;
    } catch (eW) { file = null; }
    if (!file) return { status: 404, message: 'No accessible report file with id ' + wanted };
  } else {
    var it = folder.getFiles();
    var bestStamp = 0;
    while (it.hasNext()) {
      var f = it.next();
      var stamp = f.getLastUpdated().getTime();
      if (!file || stamp > bestStamp) { file = f; bestStamp = stamp; }
    }
    if (!file) return { status: 404, message: 'The legacy report archive is empty' };
  }

  var source = {
    fileId: file.getId(),
    name: file.getName(),
    modifiedTime: file.getLastUpdated().toISOString()
  };

  // IDEMPOTENCY: this file already stored is an answer, not a re-write.
  var rows = [];
  try { rows = listRows_('time_punches', {}); } catch (eL) { rows = []; }
  var prior = reconFindImport_(rows, source.fileId);
  if (prior.found) {
    return { status: 200, data: {
      alreadyImported: true,
      source: source,
      entries: 0,
      locations: [],
      unmapped: [],
      period: prior.period,
      fileId: source.fileId
    } };
  }

  // EXACTLY the upload's pipeline, minus the re-archive: sourceFile points at the legacy original, so there is no…
  var bytes;
  try { bytes = file.getBlob().getBytes(); }
  catch (eB) {
    return { status: 502, message: 'Could not download the report file: ' + String((eB && eB.message) || eB) };
  }
  var parsed;
  try {
    parsed = reconReadReportRows_(bytes, source.name, source.fileId);
  } catch (eP) {
    return { status: 400, message: 'Could not parse the report: ' + String((eP && eP.message) || eP) };
  }

  var clientMap = reconClientHouseMap_();
  var roster = reconRoster_();
  var cleaned = reconCleanReportRows_(parsed.rows, parsed.reportTz, clientMap);
  if (!cleaned.length) return { status: 400, message: 'No punch rows found in that report' };

  var by = 'asa-hub:import-latest:' + str_(user && user.email);
  var stored = reconStorePunches_(cleaned, roster, source.fileId, by);
  if (reconStoreRefusal_(stored)) return reconStoreRefusal_(stored);

  hubSysLog_(user && user.email, 'recon_import_latest',
             stored.entries + ' punches, ' + stored.unmapped.length + ' unmapped, file ' + source.fileId,
             { status: 200 });
  return { status: 200, data: {
    alreadyImported: false,
    source: source,
    entries: stored.entries,
    locations: stored.locations,
    unmapped: stored.unmapped,
    period: stored.period,
    fileId: source.fileId
  } };
};


// ─── Punch reminders (Smart Comms situation recon_punch_reminder) ───

// '(***) ***-5558' — the last four digits and nothing else.
function reconMaskPhone_(phone) {
  var digits = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (digits.length < 4) return '(***) ***-****';
  return '(***) ***-' + digits.slice(-4);
}

// The refusal decision for a reminder, pure so the self-test can prove it.
function reconReminderRefusal_(errRow, phone) {
  if (!errRow) return 'not found';
  var t = str_(errRow.type);
  if (t !== 'missing' && t !== 'noEnd') return 'type';
  if (!str_(errRow.employeeId)) return 'no phone';
  if (!phone) return 'no phone';
  return '';
}

/** One person row by id, for the phone the roster carries. */
function reconPersonById_(id) {
  var rows = [];
  try { rows = listRows_('people', {}); } catch (e) { rows = []; }
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].id) === id) return rows[i];
  }
  return null;
}

// Is the recon_punch_reminder situation switched on?
function reconReminderSituationOn_() {
  try {
    var sid = (typeof commSituationId_ === 'function')
      ? commSituationId_('recon.punch_reminder', 'recon_punch_reminder')
      : 'recon_punch_reminder';
    var sits = smartSituations_();
    for (var i = 0; i < sits.length; i++) {
      if (String(sits[i].id) === sid) return smartOn_(sits[i].enabled);
    }
  } catch (e) { /* fall through to OFF */ }
  return false;
}

// The Smart Comms staff subject for punch reminders: errors a human queued (reminderQueuedAt stamped) that a person…
function reconReminderSubjects_() {
  var rows = [];
  try { rows = listRows_('recon_errors', {}); } catch (e) { rows = []; }
  return rows.filter(function (r) {
    return str_(r.reminderQueuedAt) &&
           (str_(r.type) === 'missing' || str_(r.type) === 'noEnd');
  }).map(function (r) {
    return {
      id: str_(r.id),
      name: str_(r.employeeName),
      phone: str_(r.reminderPhone),
      email: '',
      reminderQueuedAt: str_(r.reminderQueuedAt),
      date: str_(r.date),
      location: str_(r.location),
      hours: str_(r.hours),
      what: str_(r.type) === 'noEnd' ? 'no clock-out' : 'no punch'
    };
  });
}

HUB_POLICY.reconErrorRemind = {
  file: 'Recon.gs', lane: 'write', store: 'sheet',
  // NOT idempotent at the door: each re-remind stamps a fresh reminderQueuedAt, and the Smart Comms ledger keys on…
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [],
  // The handler never sends: it queues the reminder on the error row and the Smart Comms event sweep texts the…
  emits: ['smsSend'],
  emits_via: 'smart-comms',
  params: { errorId: { type: 'string', required: true } }
};
HUB_ACTIONS.reconErrorRemind = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  payload = payload || {};

  var errRow = null;
  try { errRow = requireRow_('recon_errors', str_(payload.errorId)); }
  catch (e) { errRow = null; }
  if (!errRow || errRow.error) return { status: 404, message: 'No recon error with that id' };

  var phone = '';
  if (str_(errRow.employeeId)) {
    var person = reconPersonById_(str_(errRow.employeeId));
    if (person) phone = str_(person.phone);
  }
  var refusal = reconReminderRefusal_(errRow, phone);
  if (refusal === 'type') {
    return { status: 422, message: 'Only missing and noEnd errors go to the person — ' +
             'managers fix overlaps, people fix punches' };
  }
  if (refusal === 'no phone') {
    return { status: 422, message: 'No phone on file — resolve the identity first' };
  }

  // Seeded OFF means OFF: explain, never pretend.
  if (!reconReminderSituationOn_()) {
    return { status: 200, data: { reminded: false, reason: 'situation disabled' } };
  }

  // The stamp is a QUEUE RECEIPT, not a delivery: SMS asked ≠ SMS delivered.
  var out = updateRowById_('recon_errors', {
    id: str_(errRow.id),
    reminderQueuedAt: new Date().toISOString(),
    reminderQueuedBy: 'asa-hub:' + str_(user && user.email),
    reminderPhone: phone
  });
  if (out && out.error) return out.error;

  if (typeof smartEventSweep_ === 'function') {
    try { smartEventSweep_({}); }
    catch (eS) {
      hubSysLog_('asa-hub:recon', 'recon_remind_sweep_failed',
                 String((eS && eS.message) || eS), { status: 500 });
    }
  }

  hubSysLog_(user && user.email, 'recon_error_remind',
             str_(errRow.id) + ' → ' + reconMaskPhone_(phone), { status: 200 });
  return { status: 200, data: { reminded: true, to: reconMaskPhone_(phone) } };
};


// THE AUTOMATIC LANE.
function reconAutoSweep_() {
  var cfg = reconConfig_();
  if (String(cfg.auto || 'on').toLowerCase() === 'off') return;

  var cache = CacheService.getScriptCache();
  if (cache.get('recon_auto_ran')) return;
  // ~20h: one run a day, but a missed pass (quota, lock) retries the same day.
  cache.put('recon_auto_ran', '1', 72000);

  var actor = { email: 'auto-recon-sweep', role: 'admin' };
  var imp = null;
  try { imp = HUB_ACTIONS.reconImportLatest({}, actor); }
  catch (eI) {
    hubSysLog_('auto-recon', 'recon_auto_import_failed',
               String((eI && eI.message) || eI), { status: 500 });
    return;
  }
  var d = (imp && imp.data) || {};
  // Both import modes answer `entries` (rows stored); older shapes said `imported`.
  var brought = Number(d.entries || d.imported || d.punches || 0);
  if (imp && imp.status !== 200) {
    hubSysLog_('auto-recon', 'recon_auto_import_refused',
               String(imp.message || imp.status), { status: imp.status || 500 });
    return;
  }
  if (!brought) {
    // Nothing new is still SAID: a silent automation looks like a dead one.
    hubSysLog_('auto-recon', 'recon_auto_import', 'nothing new at the source', { status: 200 });
    return;
  }

  try {
    var run = HUB_ACTIONS.reconRun({}, actor);
    hubSysLog_('auto-recon', 'recon_auto_run',
               brought + ' punch(es) imported, run ' +
               (run && run.status === 200 ? 'completed' : 'refused: ' + str_(run && run.message)),
               { status: (run && run.status) || 500 });
  } catch (eR) {
    hubSysLog_('auto-recon', 'recon_auto_run_failed',
               String((eR && eR.message) || eR), { status: 500 });
  }
}


// CONFIGURATION THROUGH THE SCREEN, NOT THROUGH A SPREADSHEET.
HUB_POLICY.reconConfigGet = {
  file: 'Recon.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.reconConfigGet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cfg = reconConfig_();
  return { status: 200, data: {
    gapMin: cfg.gapMin,
    overlapMin: cfg.overlapMin,
    missingCoveragePct: cfg.missingCoveragePct,
    smartRunDays: cfg.smartRunDays,
    auto: String(cfg.auto || 'on'),
    source: {
      mode: str_(cfg.source.mode),
      spreadsheetId: str_(cfg.source.spreadsheetId),
      punchesTab: str_(cfg.source.punchesTab),
      staffMapTab: str_(cfg.source.staffMapTab),
      clientMapTab: str_(cfg.source.clientMapTab)
    },
    // Meanings ship from here, so the screen can never drift from the detector.
    meanings: {
      gapMin: 'a consumer without staff longer than this many minutes is a coverage gap',
      overlapMin: 'concurrent staff on one consumer longer than this many minutes is double coverage',
      missingCoveragePct: 'a scheduled shift with less punch coverage than this percent is missing coverage',
      smartRunDays: 'how many days back the Smart Comms sweep may report runs from',
      auto: 'on = import the newest punches and run once a day, riding the machine reads'
    }
  } };
};

HUB_POLICY.reconConfigSet = {
  file: 'Recon.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.reconConfigSet = function (payload, user) {
  if (!user || user.is_service || String(user.role) !== 'admin') return hubDenied_();
  var p = payload || {};
  var cfg = reconConfig_();

  // NUMBERS ARE CHECKED HERE, not trusted from a form: a zero-minute overlap threshold flags every handover, a 500%…
  function num(name, lo, hi, cur) {
    if (p[name] === undefined) return cur;
    var v = parseInt(p[name], 10);
    if (isNaN(v) || v < lo || v > hi) {
      throw new Error(name + ' must be a whole number between ' + lo + ' and ' + hi + '.');
    }
    return v;
  }
  var next;
  try {
    next = {
      gapMin: num('gapMin', 1, 240, cfg.gapMin),
      overlapMin: num('overlapMin', 1, 480, cfg.overlapMin),
      missingCoveragePct: num('missingCoveragePct', 1, 100, cfg.missingCoveragePct),
      smartRunDays: num('smartRunDays', 1, 30, cfg.smartRunDays)
    };
  } catch (eV) {
    return { status: 400, message: String(eV.message || eV) };
  }
  if (p.auto !== undefined) {
    next.auto = String(p.auto).toLowerCase() === 'off' ? 'off' : 'on';
  } else if (cfg.auto) { next.auto = cfg.auto; }

  // THE SOURCE IS DELIBERATELY NOT EDITABLE FROM THE SCREEN: pointing the import at the wrong workbook is the one…
  next.source = cfg.source;

  var row = null;
  try {
    listRows_('financeConfig', {}).forEach(function (r) {
      if (str_(r.key) === RECON_CONFIG_KEY) row = r;
    });
  } catch (eL) { row = null; }
  var wroteCfg = row ? updateRowById_('financeConfig', { id: str_(row.id), value: JSON.stringify(next) })
                     : createRow_('financeConfig', { key: RECON_CONFIG_KEY, value: JSON.stringify(next) });
  if (sheetDbRefused_(wroteCfg)) return sheetDbRefused_(wroteCfg);

  hubSysLog_(str_(user.email), 'reconConfigSet', '',
             { status: 200, message: JSON.stringify(next).slice(0, 150) });
  return { status: 200, data: { saved: true, config: next,
    message: 'In force on the next run — no deploy, no sheet.' } };
};
