// Same person + same day is one absence, whichever door reported it first.

var CALLOFF_FORM_TAB = 'cloneCallOffs';

var CALLOFF_FORM_EVERY_S = 600;

var CALLOFF_FORM_BACK_DAYS = 3;

var CALLOFF_FORM_MAX_PER_PASS = 5;

// Underscores fold to spaces so the house's `late_show` matches the form's words.
function callOffFormKind_(word) {
  var w = String(word || '').trim().toLowerCase().replace(/_/g, ' ');
  if (!w) return '';
  if (w.indexOf('call off') !== -1 || w.indexOf('call-off') !== -1) return 'call_off';
  if (w.indexOf('late') !== -1) return 'late_show';
  if (w.indexOf('no show') !== -1 || w.indexOf('no call') !== -1 || w.indexOf('ncns') !== -1) {
    return 'no_call';
  }
  return 'other';
}

function callOffFormCell_(row, names) {
  for (var i = 0; i < names.length; i++) {
    var v = row[names[i]];
    if (v !== undefined && String(v).trim()) return String(v).trim();
  }
  return '';
}

function callOffFormDay_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  // Keep an ISO day as-is: Date.parse reads it as UTC midnight, the evening before in Ohio.
  var iso = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(raw);
  if (iso) return iso[1];
  var t = Date.parse(raw);
  if (!isNaN(t)) {
    try { return Utilities.formatDate(new Date(t), 'America/New_York', 'yyyy-MM-dd'); }
    catch (e) { return new Date(t).toISOString().slice(0, 10); }
  }
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? m[0] : '';
}

// A null `told` is an unreadable ledger: hand nothing over, since the door's own read fails open.
function callOffFormUntold_(rows, sid, told) {
  if (!told) return [];
  return rows.filter(function (r) {
    var day = String((r && r.day) || '');
    var names = [String((r && r.person) || '')];
    if (typeof clientNameKey_ === 'function') names.push(clientNameKey_(r && r.person));
    for (var i = 0; i < names.length; i++) {
      if (!names[i]) continue;
      var key = (typeof smartLedgerKey_ === 'function')
        ? smartLedgerKey_(sid, names[i], day) : (sid + '|' + names[i] + '|' + day);
      if (told[key]) return false;
    }
    return true;
  });
}

function callOffFormSweep_(opts) {
  opts = opts || {};
  var out = { rows: 0, acted: 0, duplicates: 0, listed: {}, old: 0, capped: 0,
              unnamed: 0, why: [] };
  var rows = [];
  try {
    rows = (typeof commBoardRows_ === 'function') ? (commBoardRows_(CALLOFF_FORM_TAB) || []) : [];
  } catch (e) {
    out.why.push('the clone house could not be read: ' + String((e && e.message) || e));
    return out;
  }
  out.rows = rows.length;
  if (!rows.length) return out;

  var known = {};
  try {
    var house = (typeof commCallOffRows_ === 'function') ? commCallOffRows_() : {};
    for (var id in house) {
      if (!house.hasOwnProperty(id)) continue;
      // A late show is not an absence and must not swallow a real call-off that day; every other kind counts.
      if (callOffFormKind_(house[id].kind) === 'late_show') continue;
      var k = String(house[id].person_key || '').trim().toLowerCase();
      var d = callOffFormDay_(house[id].shift_date);
      if (k && d) known[k + '|' + d] = true;
    }
  } catch (eK) {
    out.why.push('the call-off house could not be read — nothing was acted on');
    return out;
  }

  var floorMs = Date.now() - CALLOFF_FORM_BACK_DAYS * 86400000;
  var attendance = { late: [], no_call: [] };

  rows.forEach(function (r) {
    var kind = callOffFormKind_(callOffFormCell_(r, ['type', 'calloff_type', 'kind']));
    if (!kind) return;
    if (kind !== 'call_off') {
      out.listed[kind] = (out.listed[kind] || 0) + 1;
      // The ledger key (person, day, kind) keeps mailbox, punch clock and form from telling it three times.
      if (kind === 'late_show' || kind === 'no_call') {
        var who = callOffFormCell_(r, ['employeename', 'employee_name', 'employee', 'name']);
        var when = callOffFormDay_(callOffFormCell_(r, ['date', 'shift_date', 'absent_on']));
        var whenMs = when ? Date.parse(when + 'T12:00:00') : NaN;
        if (who && when && !(!isNaN(whenMs) && whenMs < floorMs)) {
          attendance[kind === 'no_call' ? 'no_call' : 'late'].push({
            person: who, day: when, shift_at: when,
            house: '', shift_code: '',
            when: callOffFormCell_(r, ['howlate', 'how_late']) ||
                  (kind === 'no_call' ? 'no call, no show' : 'late'),
            // Without a report the letter would claim nobody reported the absence.
            report: callOffFormCell_(r, ['notesincludereasonandhowmuchadvancednotice', 'notes', 'reason']) ||
                    'Reported on the call-off form; no further words were typed.',
            source: 'form'
          });
        }
      }
      return;
    }
    var person = callOffFormCell_(r, ['employeename', 'employee_name', 'employee', 'name']);
    if (!person) { out.unnamed++; return; }
    var day = callOffFormDay_(callOffFormCell_(r, ['date', 'shift_date', 'absent_on']));
    var stamp = callOffFormCell_(r, ['timestamp', 'createdat', 'created_at']);
    if (!day) { out.unnamed++; return; }
    var dayMs = Date.parse(day + 'T12:00:00');
    if (!isNaN(dayMs) && dayMs < floorMs) { out.old++; return; }

    var key = (typeof clientNameKey_ === 'function' ? clientNameKey_(person) : person.toLowerCase())
      + '|' + day;
    if (known[key]) { out.duplicates++; return; }

    // The cap counts sends; only call-offs send, so attendance rows are never held back by it.
    if (out.acted >= CALLOFF_FORM_MAX_PER_PASS) { out.capped++; return; }

    // Keyed on the form's own row so a re-mirror never fires twice.
    var instance = 'form:' + (stamp || day) + ':' + String(person).slice(0, 24);
    var said = null;
    try {
      said = commCallOffRecorded_({
        employee_name: person,
        name_from: 'person',
        type: 'Call Off',
        date: day,
        notes: callOffFormCell_(r, ['notesincludereasonandhowmuchadvancednotice', 'notes', 'reason'])
      }, instance, 'form', {
        // The reason goes to the directors only, never into the URGENT OPEN SHIFT to everyone.
        reason: callOffFormCell_(r, ['notesincludereasonandhowmuchadvancednotice', 'notes', 'reason'])
      });
    } catch (eR) {
      out.why.push(person + ': ' + String((eR && eR.message) || eR));
      return;
    }
    out.acted++;
    known[key] = true;
    if (said && said.why) out.why.push(person + ' (' + day + '): ' + String(said.why).slice(0, 120));
  });

  if (attendance.late.length || attendance.no_call.length) {
    if (typeof HUB_ACTIONS === 'undefined' || !HUB_ACTIONS.staffAttendancePunch) {
      out.why.push('the attendance door is not loaded — the late/no-show rows were listed only');
    } else {
      // Ask the ledger before cutting the handful, or the same oldest rows are handed over forever.
      var told = null;
      try {
        told = (typeof smartAlreadySent_ === 'function') ? smartAlreadySent_() : {};
      } catch (eT) {
        told = null;
        out.why.push('the ledger could not be read — no late/no-show row was ' +
                     'handed over; they wait in the clone house for the next pass');
      }
      try {
        var said = HUB_ACTIONS.staffAttendancePunch({
          late: callOffFormUntold_(attendance.late, 'staff_late_show', told)
                  .slice(0, CALLOFF_FORM_MAX_PER_PASS),
          no_call: callOffFormUntold_(attendance.no_call, 'staff_no_call', told)
                  .slice(0, CALLOFF_FORM_MAX_PER_PASS)
        });
        out.attendance = (said && said.data) ? said.data : null;
      } catch (eA) {
        out.why.push('the attendance door threw: ' + String((eA && eA.message) || eA));
      }
    }
  }

  try {
    hubSysLog_('asa-hub:calloffform', 'calloff_form_cross',
               out.rows + ' form row(s) · ' + out.acted + ' acted · ' + out.duplicates +
               ' already known · ' + JSON.stringify(out.listed) + ' listed only · ' +
               out.old + ' older than ' + CALLOFF_FORM_BACK_DAYS + ' days' +
               (out.capped ? ' · ' + out.capped + ' over the cap, next pass' : ''),
               { status: 200 });
  } catch (eL) {}
  return out;
}

// Calendar Builder call-offs: keyed on the pool ref so nothing is filed twice.
var CALLOFF_CAL_MAX = 4;
var CALLOFF_CAL_SOURCE = 'calendar';
var CALLOFF_CAL_REF = /^SP[0-9A-F]{10}$/;

// A reading that throws counts as test mode.
function callOffCalTestMode_() {
  try { return !!hubTestModeOn_(); } catch (e) { return true; }
}

function callOffCalUsDay_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? (Number(m[2]) + '/' + Number(m[3]) + '/' + m[1]) : String(iso || '');
}

function callOffCalTrackerRow_(p) {
  return {
    timestamp: new Date().toISOString(),
    employee_name: String(p.employee_name || ''),
    date: callOffCalUsDay_(p.date),
    type: 'Call Off',
    notes: String(p.reason || ''),
    your_name: 'Calendar Builder' + (p.marked_by ? ' (' + String(p.marked_by) + ')' : ''),
    call_id: String(p.instance || ''),
    name_from: 'person'
  };
}

function callOffCalMockRow_(p, tracker) {
  var now = new Date();
  var tz = 'America/New_York';
  var body = ['Type: Call Off', 'Employee: ' + tracker.employee_name, 'Shift date: ' + tracker.date,
              'House: ' + String(p.house || '(not named)'), 'Shift: ' + String(p.shift || ''),
              'Reported by: ' + tracker.your_name, 'Notes: ' + (tracker.notes || '(none)')].join('\n');
  return {
    id: 'web_' + sha256Hex_('callofftracker|' + tracker.call_id).slice(0, 20),
    at: now.toISOString(),
    day: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    hour: Utilities.formatDate(now, tz, 'HH:mm'),
    pass_id: '', seq: 1,
    situation: 'call_off_tracker_row',
    purpose: 'Call Off Tracker row · Calendar Builder · ' + String(p.house || ''),
    method: 'callOffsRow', send_at: '',
    person_name: tracker.employee_name,
    to_masked: 'Call Off Tracker', audience: 1,
    channel: 'tracker_row',
    subject: 'Call Off — ' + tracker.employee_name + ' (' + tracker.date + ')',
    body: body.slice(0, 4000), body_chars: body.length,
    result: 'held', held_by: 'held: test mode',
    reason: 'test mode holds every write of a call-off — the tracker row is written here, ' +
            'not to the Call Off Tracker',
    dial: '', test_mode: 'on', send_switch: '',
    ledger_key: 'callofftracker|' + tracker.call_id, tenant: ''
  };
}

function callOffCalTracker_(p, held) {
  var row = callOffCalTrackerRow_(p);
  if (held) {
    commMockWebWrite_([callOffCalMockRow_(p, row)]);
    return 'held: test mode';
  }
  var rows = listRows_('callOffs', {}) || [];
  for (var i = 0; i < rows.length; i++) {
    if (String((rows[i] || {}).call_id || '') === row.call_id) return 'already';
  }
  var made = createRow_('callOffs', row);
  if (made && made.error) throw new Error(made.error.message || 'the tracker refused the row');
  return 'written';
}

function callOffCalFile_(p, held) {
  var out = { instance: String((p && p.instance) || ''), ok: false, recorded: false,
              tracker: '', test_mode: !!held, why: '' };
  if (!CALLOFF_CAL_REF.test(out.instance)) { out.why = 'not a pool ref'; return out; }
  if (!String(p.employee_name || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) {
    out.why = 'a call-off needs the person and the shift day';
    return out;
  }
  try {
    out.tracker = callOffCalTracker_(p, held);
  } catch (eT) {
    out.why = 'the tracker row could not be written: ' + String((eT && eT.message) || eT);
    return out;
  }
  var manager = String(p.manager_name || '').trim();
  var phone = String(p.manager_phone || '').trim();
  if (manager && phone) {
    try { manager += ' ' + hubPhoneE164_(phone); } catch (eP) {}
  }
  // The reason travels in `place`, never in `facts`: directors only.
  var said = commCallOffRecorded_({
    employee_name: String(p.employee_name || ''),
    name_from: 'person',
    type: 'Call Off',
    date: String(p.date || '')
  }, out.instance, CALLOFF_CAL_SOURCE, {
    manager: manager,
    house: String(p.house || ''),
    reason: String(p.reason || ''),
    shift_day: String(p.date || ''),
    shift_start: String(p.shift_start || '')
  });
  out.recorded = !!(said && said.recorded);
  out.ok = out.recorded;
  out.state = String((said && said.state) || '');
  out.said = Number((said && said.said) || 0);
  out.others_sent = Number((said && said.others_sent) || 0);
  out.rehearsed_rows = Number((said && said.rehearsed_rows) || 0);
  var all = (said && said.others && said.others.everyone) || null;
  out.urgent = all ? {
    state: String(all.state || ''),
    sent: Number(all.sent) || 0,
    redirected: Number(all.redirected) || 0,
    resolved: Number(all.resolved) || 0,
    rehearsal_rows: Number(all.rehearsal_rows) || 0,
    why: String(all.why || '').slice(0, 300)
  } : null;
  if (said && said.why) out.why = String(said.why).slice(0, 300);
  return out;
}

HUB_POLICY.callOffFromCalendar = {
  file: 'CommCallOffForm.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: ['callOffs'],
  emits: ['smsSend', 'emailSend']
};
HUB_ACTIONS.callOffFromCalendar = function (payload, user) {
  if (!user || (!user.is_service && String(user.role) !== 'admin')) return hubDenied_();
  var rows = ((payload || {}).rows || []);
  if (!Array.isArray(rows)) return { status: 400, message: 'rows: a list of call-offs' };
  var held = callOffCalTestMode_();
  var out = rows.slice(0, CALLOFF_CAL_MAX).map(function (p) { return callOffCalFile_(p || {}, held); });
  try {
    hubSysLog_('asa-hub:calloffcal', 'calloff_calendar_filed',
               out.length + ' Calendar Builder call-off(s) · ' +
               out.filter(function (o) { return o.ok; }).length + ' filed' +
               (held ? ' · test mode: the tracker row went to the mock outbox' : ''),
               { status: 200 });
  } catch (eL) {}
  return { status: 200, data: { rows: out, test_mode: held } };
};

// The crossing is Python's (app/call_off_form_sweep*.py), rung by the relay's clock.
function callOffFormSweepMaybe_() {
  return { skipped: 'python' };
}

function runCallOffFormCross() {
  var out = callOffFormSweep_({});
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
