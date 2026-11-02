// SCHEDULING — the screens beside the house calendars.
// STAFF CALENDARS: one person's shifts (or every open shift) across every house, cut from the cached board exactly…

var SCHED_VIEW_ACTIONS = ['schedulingStaffShifts', 'schedulingTimeOffList'];
var SCHED_VIEW_STAFF_FEATURE = 'scheduling.staffCalendars';
var SCHED_VIEW_TIMEOFF_FEATURE = 'scheduling.timeOffRequests';
var SCHED_VIEW_ASKS_KEY = 'sched_asks3:';
var SCHED_VIEW_RESIDENTS_KEY = 'sched_residents1';
var SCHED_VIEW_VIA_STAFF = 'staff';
var SCHED_VIEW_ASK_KINDS = { time_off: 1, request_off: 1 };
var SCHED_VIEW_ASK_STATES = { waiting: 1, approved: 1, approved_future: 1 };

/** The Scheduling gate and the screen's own release: the real master always, anyone else once App Control names a badge. */
function schedViewGate_(user, feature) {
  var ctx = schedGate_(user);
  if (!ctx.open || ctx.is_master) return ctx;
  var got = null;
  try { got = hubProfileAppGate_(feature, user); } catch (e) { got = null; }
  if (!got || !got.open) ctx.open = false;
  return ctx;
}

/** Staff's Calendar section: a viewer Staff shows every staff member whole reads anyone's shifts; else closed. */
function schedViewStaffGate_(user) {
  var whole = null;
  try { whole = spWholeGate_(user); } catch (e) { whole = null; }
  return schedCtxFor_(user, whole);
}

/** Each house's current clients by name, as Locations lists them; null when a source cannot be read. */
function schedViewResidents_() {
  var hit = null;
  try { hit = JSON.parse(CacheService.getScriptCache().get(SCHED_VIEW_RESIDENTS_KEY) || 'null'); } catch (e) { hit = null; }
  if (hit) return hit;
  var out = {};
  try {
    var homes = {};
    (locationsHomes_() || []).forEach(function (h) { if (h.code) homes[h.code] = h; });
    var clients = locationsClientRows_();
    clients.forEach(function (c) { var hc = locationsHouseCode_(c.house); if (hc && !homes[hc]) homes[hc] = null; });
    Object.keys(homes).forEach(function (code) {
      var names = locationsClientsAt_(code, homes[code], clients).map(function (c) { return c.name; }).filter(String);
      if (names.length) out[code] = names.sort();
    });
  } catch (eR) { return null; }
  try { CacheService.getScriptCache().put(SCHED_VIEW_RESIDENTS_KEY, JSON.stringify(out), SCHED_BADGES_TTL); } catch (eP) {}
  return out;
}

/** The houses this viewer edits, by the rows the base was built from. */
function schedViewEdits_(base, ctx) {
  var out = {};
  (base.houses || []).forEach(function (h) { if (schedBaseEditor_(base, ctx, h.code)) out[h.code] = true; });
  return out;
}

/** The current period and every later one. */
function schedViewPeriods_() {
  var current = schedCurrentPeriod_();
  var later = schedSettings_().periods.filter(function (p) { return p.first >= current.first; });
  return later.length ? later : [current];
}

function schedViewShiftOrder_(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  var sa = a.start === undefined ? 99 : a.start, sb = b.start === undefined ? 99 : b.start;
  if (sa !== sb) return sa - sb;
  return a.house_code < b.house_code ? -1 : (a.house_code > b.house_code ? 1 : 0);
}

HUB_POLICY.schedulingStaffShifts = {
  file: 'SchedulingViews.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { person: { type: 'string' }, via: { type: 'string' } }
};
// { person } is a person key, 'open', or '' for the viewer.
HUB_ACTIONS.schedulingStaffShifts = function (payload, user) {
  var viaStaff = schedStr_(payload && payload.via) === SCHED_VIEW_VIA_STAFF;
  var ctx = viaStaff ? schedViewStaffGate_(user) : schedViewGate_(user, SCHED_VIEW_STAFF_FEATURE);
  if (!ctx.open) return schedClosed_();
  try {
    var asked = schedStr_(payload && payload.person);
    var open = !viaStaff && asked.toLowerCase() === 'open';
    var key = open ? '' : (viaStaff ? asked : (asked || ctx.key));
    if (viaStaff && !/^[a-z0-9]{3,80}$/.test(key)) return schedRefuse_(400, 'person: a staff key.');
    var periods = schedViewPeriods_();
    var first = schedBoardBase_(periods[0]);
    var edits = schedViewEdits_(first, ctx);
    var anyone = !!(viaStaff || ctx.is_master || ctx.is_director || Object.keys(edits).length);
    if (!open && !key) {
      return schedRefuse_(400, 'Your account is not matched to one person on the calendar — choose Open.');
    }
    if (!open && key !== ctx.key && !anyone) {
      return schedRefuse_(403, 'You can see your own shifts and the open ones.');
    }
    var today = schedToday_();
    var shifts = [];
    periods.forEach(function (p) {
      var cut = schedCut_(schedBoardBase_(p), ctx, null, null);
      Object.keys(cut.grids).forEach(function (code) {
        var g = cut.grids[code];
        g.rows.forEach(function (r) {
          if (open ? r.kind !== 'open' : (r.kind !== 'person' || r.key !== key)) return;
          r.cells.forEach(function (c, i) {
            var iso = g.cols[i] && g.cols[i].iso;
            if (!c || !c.text || !iso || c.kind === 'off') return;
            if (open && (iso < today || c.state === 'taken')) return;
            var s = { period_id: p.id, house_code: code, row_id: r.row_id, date: iso, text: c.text, kind: c.kind,
                      state: c.state };
            if (c.start !== undefined) { s.start = c.start; s.end = c.end; }
            if (c.hours !== undefined) s.hours = c.hours;
            if (c.flow) s.flow = c.flow;
            if (c.time_off) s.time_off = c.time_off;
            var b = r.badges;
            if (b && (b.hm || b.lead || b.med)) s.badges = b;
            shifts.push(s);
          });
        });
      });
    });
    shifts.sort(schedViewShiftOrder_);
    var name = '';
    (first.people || []).forEach(function (p) { if (p.key === key) name = p.name; });
    var data = {
      ok: true, today: today, person: open ? 'open' : key, name: open ? 'Open' : (name || key), anyone: anyone,
      periods: periods.map(function (p) { return { id: p.id, first: p.first, last: p.last }; }), shifts: shifts
    };
    if (viaStaff) {
      var residents = schedViewResidents_();
      var codes = {};
      shifts.forEach(function (s) { codes[s.house_code] = true; });
      data.houses = (first.houses || []).filter(function (h) { return codes[h.code]; }).map(function (h) {
        return { code: h.code, short: h.short || h.code, location: h.location || '',
                 clients: residents ? (residents[h.code] || []) : null };
      });
    }
    return { status: 200, data: data };
  } catch (e) {
    return schedUnreadable_(e);
  }
};

/** The shifts each person's row holds, every house, keyed by row id. */
function schedViewHeldIndex_(cells) {
  var out = {};
  (cells || []).forEach(function (c) {
    if (!/^P:/.test(schedStr_(c.row_id)) || !schedFlowHolds_(c)) return;
    (out[c.row_id] = out[c.row_id] || []).push(c);
  });
  return out;
}

/** The shifts a person holds from `from` to `to`, in day order. */
function schedViewHolds_(held, personKey, from, to) {
  return (held['P:' + schedStr_(personKey)] || []).filter(function (c) {
    return c.date >= from && c.date <= to;
  }).sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return Number(a.start_min) - Number(b.start_min);
  }).map(function (c) {
    return { date: c.date, house_code: c.house_code, house_label: schedHouseLabel_(c.house_code), text: c.text };
  });
}

/** Every time-off and Request Off ask still standing, as nobody's eyes change it; held under the board's version. */
function schedViewAsks_() {
  var v = schedVersion_();
  var cacheKey = v ? SCHED_VIEW_ASKS_KEY + v : '';
  var hit = cacheKey ? schedCacheGet_(cacheKey) : null;
  if (hit) return hit;
  var homes = {};
  schedRead_(SCHED_TABS.rows).forEach(function (r) {
    if (r.row_kind !== 'person' || !r.person_key || r.active === 'no') return;
    if (!homes[r.person_key]) homes[r.person_key] = [];
    if (homes[r.person_key].indexOf(r.house_code) === -1) homes[r.person_key].push(r.house_code);
  });
  var items = {};
  schedRead_(SCHED_TABS.inbox).forEach(function (i) {
    if (i.box !== 'work' || i.state !== 'waiting' || !i.flow_id) return;
    if (!items[i.flow_id]) items[i.flow_id] = [];
    items[i.flow_id].push({ id: i.id, to_uid: i.to_uid, seat: i.seat, title: i.title, body: i.body,
                            test_mode: i.test_mode, created_at: i.created_at });
  });
  var held = schedViewHeldIndex_(schedRead_(SCHED_TABS.cells));
  var dirNames = {};
  try { schedFlowDirectors_().list.forEach(function (d) { dirNames[d.uid] = d.name; }); } catch (eD) { dirNames = {}; }
  var asks = [];
  schedRead_(SCHED_TABS.flows).forEach(function (f) {
    if (!SCHED_VIEW_ASK_KINDS[f.kind] || !SCHED_VIEW_ASK_STATES[f.state] || !schedIsoValid_(f.date)) return;
    var to = f.kind === 'time_off' && schedIsoValid_(f.date_to) && f.date_to >= f.date ? f.date_to : f.date;
    var seats = schedJson_(f.seats, []);
    seats = Array.isArray(seats) ? seats : [];
    var decided = null;
    seats.forEach(function (s) {
      if (s && s.seat === 'director' && s.state === 'approved') decided = s;
    });
    var log = schedJson_(f.outreach_log, {}) || {};
    var codes = f.kind === 'request_off' ? [f.house_code] : (homes[f.person_key] || []);
    var carried = f.source === SCHED_TO_SOURCE;
    asks.push({
      id: f.id, kind: f.kind, state: f.state, person: f.person, person_key: f.person_key, person_uid: f.person_uid,
      house_code: f.kind === 'request_off' ? f.house_code : '',
      house_label: f.kind === 'request_off' && f.house_code ? schedHouseLabel_(f.house_code) : '',
      homes: codes,
      houses: codes.filter(Boolean).map(function (c) { return { code: c, label: schedHouseLabel_(c) }; }),
      from: f.date, to: to, days: schedDayIndex_(to) - schedDayIndex_(f.date) + 1,
      shift_text: f.kind === 'request_off' ? f.shift_text : '',
      reason: f.kind === 'request_off' ? f.note : f.reason, requested_at: f.created_at,
      filed_by: carried ? '' : (f.created_by && f.created_by === f.person_uid ? f.person : (dirNames[f.created_by] || '')),
      filed_via: carried ? 'Carried over from the Time Off app' + (f.source_ref ? ' (' + f.source_ref + ')' : '')
        : f.source_ref === 'my-calendar' ? 'From My Calendar' : 'On the platform',
      decided_by: decided ? schedStr_(decided.by) : schedStr_(f.closed_by),
      decided_at: decided ? schedStr_(decided.at) : schedStr_(f.closed_at),
      seats: seats.filter(function (s) { return s && s.seat; }).map(function (s) {
        return { seat: schedStr_(s.seat), state: schedStr_(s.state), by: schedStr_(s.by), at: schedStr_(s.at),
                 note: schedStr_(s.note), why: schedStr_(s.why),
                 asked: (Array.isArray(s.to) ? s.to : []).map(function (t) { return schedStr_(t && t.name); }).filter(Boolean) };
      }),
      holds: schedViewHolds_(held, f.person_key, f.date, to),
      applied: (Array.isArray(log.applied) ? log.applied : []).map(function (x) {
        return { date: schedStr_(x && x.date), house_label: schedHouseLabel_(schedStr_(x && x.house)) };
      }),
      future_days: Array.isArray(log.future) ? log.future.length : 0,
      test_mode: f.test_mode, items: items[f.id] || []
    });
  });
  if (cacheKey) schedCachePut_(cacheKey, asks);
  return asks;
}

/** The viewer's cut: the master and the directors see every ask, a house manager those of their houses, anyone their own. */
function schedViewAsksCut_(asks, ctx, edits, past, today) {
  var all = !!(ctx.is_master || ctx.is_director);
  var pending = [], approved = [], hidden = 0;
  asks.forEach(function (a) {
    var own = !!((ctx.key && a.person_key === ctx.key) || (ctx.uid && a.person_uid === ctx.uid));
    var theirs = (a.homes || []).some(function (c) { return edits[c]; });
    if (!all && !own && !theirs) return;
    var ended = a.to < today;
    if (a.state !== 'waiting' && ended && !past) { hidden++; return; }
    var o = { id: a.id, kind: a.kind, state: a.state, person: a.person, house_code: a.house_code,
              house_label: a.house_label, from: a.from, to: a.to, days: a.days, shift_text: a.shift_text,
              requested_at: a.requested_at, decided_by: a.decided_by, decided_at: a.decided_at, own: own, ended: ended,
              houses: a.houses || [], filed_by: a.filed_by || '', filed_via: a.filed_via || '', holds: a.holds || [],
              applied: a.applied || [], future_days: a.future_days || 0 };
    // a director's words with the answer travel where the reason does
    o.seats = (a.seats || []).map(function (s) {
      return { seat: s.seat, state: s.state, by: s.by, at: s.at, why: s.why, asked: s.asked || [],
               note: (all || own) ? s.note : '' };
    });
    if (all || own) o.reason = a.reason;
    // the master stands in on a director seat when no seat is the master's own
    var seat = (a.state === 'waiting' && !own && ctx.uid)
      ? ((a.items || []).filter(function (i) { return i.to_uid === ctx.uid; })[0] ||
         (ctx.is_master ? (a.items || []).filter(function (i) { return i.seat === 'director'; })[0] : null)) : null;
    if (seat) {
      o.item = { id: seat.id, title: seat.title, body: seat.body, test_mode: seat.test_mode, created_at: seat.created_at };
    }
    (a.state === 'waiting' ? pending : approved).push(o);
  });
  pending.sort(function (a, b) { return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0); });
  approved.sort(function (a, b) {
    if (a.ended !== b.ended) return a.ended ? 1 : -1;
    if (a.from === b.from) return 0;
    return (a.from < b.from) === !a.ended ? -1 : 1;
  });
  return { pending: pending, approved: approved, past_hidden: hidden, sees_all: all };
}

HUB_POLICY.schedulingTimeOffList = {
  file: 'SchedulingViews.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { past: { type: 'boolean' } }
};
// { pending, approved, past_hidden, sees_all }: the asks waiting on a director, and the approved ones (those that…
HUB_ACTIONS.schedulingTimeOffList = function (payload, user) {
  var ctx = schedViewGate_(user, SCHED_VIEW_TIMEOFF_FEATURE);
  if (!ctx.open) return schedClosed_();
  try {
    var past = !!(payload && (payload.past === true || payload.past === 'true'));
    var today = schedToday_();
    var edits = schedViewEdits_(schedBoardBase_(schedCurrentPeriod_()), ctx);
    var cut = schedViewAsksCut_(schedViewAsks_(), ctx, edits, past, today);
    return { status: 200, data: {
      ok: true, today: today, past: past, pending: cut.pending, approved: cut.approved, past_hidden: cut.past_hidden,
      sees_all: cut.sees_all, test_mode: schedTestMode_()
    } };
  } catch (e) {
    return schedUnreadable_(e);
  }
};
