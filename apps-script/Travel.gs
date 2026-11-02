// Business travel: typed budget and actual cost per trip; deliberately no price or deal scanner.

// 'declined' (we said no) and 'cancelled' (it fell apart) are different histories.
var TRIP_STATUSES = ['proposed', 'approved', 'booked', 'completed', 'cancelled', 'declined'];
var TRIP_PURPOSES = ['Client visit', 'Conference', 'Training', 'Audit', 'Recruiting', 'Other'];

function travelMayUse_(user) {
  if (!user || user.is_service) return false;
  return user.role === 'admin' || user.role === 'manager';
}

function travelMayDecide_(user) {
  if (!user || user.is_service) return false;
  return user.role === 'admin' || user.role === 'manager';
}

function travelNum_(v) { return finNum_(v); }

function travelTrips_() {
  // EX_ ids are the loader's demo rows.
  return listRows_('travelTrips', {}).filter(function (r) {
    return String(r.id).indexOf('EX_') !== 0;
  }).map(function (r) {
    var budget = travelNum_(r.budget);
    var actual = travelNum_(r.actualCost);
    return {
      id: str_(r.id), destination: str_(r.destination), country: str_(r.country),
      purpose: str_(r.purpose), status: str_(r.status) || 'proposed',
      startDate: str_(r.startDate), endDate: str_(r.endDate),
      traveller: str_(r.traveller), requestedBy: str_(r.requestedBy),
      reason: str_(r.reason), outcome: str_(r.outcome),
      decisionNote: str_(r.decisionNote),
      travellerEmail: str_(r.travellerEmail),
      budget: budget, actualCost: actual,
      // null until both exist: zero against zero means nobody has said.
      variance: (budget > 0 && actual > 0) ? actual - budget : null,
      decidedBy: str_(r.decidedBy), decidedAt: str_(r.decidedAt)
    };
  }).sort(function (a, b) {
    return String(b.startDate || '').localeCompare(String(a.startDate || ''));
  });
}

HUB_POLICY.travelList = {
  file: 'Travel.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
// Reimbursement requests, shown beside the typed numbers as evidence, never instead of them.
function travelEvidence_() {
  var out = [];
  try {
    readTabNormalized_(hubTabWorkbook_('staff_requests'), 'staff_requests').forEach(function (r) {
      if (!/reimbursement/i.test(str_(r.type))) return;
      out.push({ id: str_(r.id), type: str_(r.type), person: str_(r.personname),
                 from: str_(r.datefrom), to: str_(r.dateto),
                 details: str_(r.details).slice(0, 160), status: str_(r.status),
                 at: str_(r.createdat) });
    });
  } catch (e) {}
  return out.slice(-40).reverse();
}

HUB_ACTIONS.travelList = function (payload, user) {
  if (!travelMayUse_(user)) return hubDenied_();
  return { status: 200, data: { trips: travelTrips_(), statuses: TRIP_STATUSES,
                                purposes: TRIP_PURPOSES,
                                evidence: travelEvidence_() } };
};

HUB_POLICY.travelSave = {
  file: 'Travel.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.travelSave = function (payload, user) {
  if (!travelMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var destination = str_(p.destination).trim();
  if (!destination) return { status: 400, message: 'Where to?' };
  if (!str_(p.reason).trim()) {
    return { status: 400, message: 'Why is this trip needed? One line is enough.' };
  }
  var status = TRIP_STATUSES.indexOf(str_(p.status)) === -1 ? 'proposed' : str_(p.status);
  var purpose = TRIP_PURPOSES.indexOf(str_(p.purpose)) === -1 ? 'Other' : str_(p.purpose);

  var start = str_(p.startDate), end = str_(p.endDate);
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return { status: 400, message: 'The start date must be YYYY-MM-DD.' };
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return { status: 400, message: 'The end date must be YYYY-MM-DD.' };
  if (start && end && end < start) return { status: 400, message: 'The trip ends before it starts.' };

  var fields = {
    destination: destination, country: str_(p.country).trim(), purpose: purpose,
    status: status, startDate: start, endDate: end,
    traveller: str_(p.traveller).trim(),
    travellerEmail: str_(p.travellerEmail).trim().toLowerCase(),
    reason: str_(p.reason).trim(),
    outcome: str_(p.outcome).trim(),
    budget: travelNum_(p.budget), actualCost: travelNum_(p.actualCost)
  };

  if (str_(p.id)) {
    var row = updateRowById_('travelTrips', Object.assign({ id: str_(p.id) }, fields));
    if (row.error) return row.error;
    hubSysLog_(str_(user.email), 'travelSave', destination, { status: 200, message: 'edit' });
    return { status: 200, data: { id: str_(p.id), trips: travelTrips_() } };
  }
  fields.requestedBy = str_(user.display_name) || str_(user.email);
  var made = createRow_('travelTrips', fields);
  if (sheetDbRefused_(made)) return sheetDbRefused_(made);
  hubSysLog_(str_(user.email), 'travelSave', destination, { status: 200, message: status });
  return { status: 200, data: { id: str_(made.id), trips: travelTrips_() } };
};

/** Approve or decline a trip; kept apart from travelSave so every decision carries a name. */
HUB_POLICY.travelDecide = {
  file: 'Travel.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.travelDecide = function (payload, user) {
  if (!travelMayDecide_(user)) return hubDenied_();
  var id = str_(payload && payload.id);
  var status = str_(payload && payload.status);
  if (!id) return { status: 400, message: 'Which trip?' };
  if (['approved', 'declined', 'cancelled', 'booked'].indexOf(status) === -1) {
    return { status: 400, message: 'A decision is approved, declined, cancelled or booked.' };
  }
  var row = requireRow_('travelTrips', id);
  if (row.error) return row.error;
  if (status === 'booked' && ['approved', 'booked'].indexOf(str_(row.status)) === -1) {
    return { status: 400, message: 'Only an approved trip can be marked booked.' };
  }

  updateRowById_('travelTrips', {
    id: id,
    status: status,
    decidedBy: str_(user.display_name) || str_(user.email),
    decidedAt: new Date().toISOString(),
    // Own column: writing it into `outcome` would destroy the trip's report.
    decisionNote: str_(payload.note) || str_(row.decisionNote)
  });
  hubSysLog_(str_(user.email), 'travelDecide', str_(row.destination),
             { status: 200, message: status });
  return { status: 200, data: { trips: travelTrips_() } };
};

// Ended trips with no outcome: the subjects Smart Comms sweeps for `travel_outcome_missing`.
function travelSmartSubjects_() {
  var out = [];
  var now = Date.now();
  travelTrips_().forEach(function (t) {
    if (t.status !== 'completed' && t.status !== 'booked') return;
    if (str_(t.outcome)) return;
    if (!t.endDate) return;
    var ended = new Date(t.endDate + 'T12:00:00').getTime();
    if (isNaN(ended) || ended > now) return;
    var days = Math.floor((now - ended) / 86400000);
    if (days < 3) return;
    var email = str_(t.travellerEmail);
    var phone = '';
    try {
      usersAll_().forEach(function (u) {
        var uname = str_(u.displayname).toLowerCase();
        if (!email && uname && uname === str_(t.traveller).toLowerCase()) email = str_(u.email).toLowerCase();
        if (email && str_(u.email).toLowerCase() === email) phone = str_(u.phone);
      });
    } catch (eU) {}
    out.push({
      id: t.id, name: str_(t.traveller) || str_(t.requestedBy),
      email: email, phone: phone,
      destination: t.destination, days: String(days), endDate: t.endDate
    });
  });
  return out;
}
