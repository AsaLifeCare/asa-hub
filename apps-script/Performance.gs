// Metrics are rows in perf_metrics, not code; a period with no entry shows as missing, never as zero.

var PERF_METRICS_TAB = 'perf_metrics';
var PERF_ENTRIES_TAB = 'perf_entries';
var PERF_REVIEWS_TAB = 'perf_reviews';

var PERF_METRICS_HEADER = ['metric_id', 'label', 'category', 'unit', 'direction', 'target',
                           'weight', 'period', 'source', 'active', 'notes',
                           'created_at', 'updated_at', 'updated_by'];
var PERF_ENTRIES_HEADER = ['entry_id', 'person_id', 'person_name', 'metric_id', 'period',
                           'value', 'note', 'source', 'recorded_at', 'recorded_by'];
var PERF_REVIEWS_HEADER = ['review_id', 'person_id', 'person_name', 'period', 'score',
                           'strengths', 'watch', 'comments', 'reviewer', 'created_at'];

var PERF_METRICS_SEED = [
  { metric_id: 'attendance', label: 'Attendance', category: 'Reliability', unit: '%', direction: 'higher', target: 95, weight: 3, period: 'monthly', source: 'manual', active: 'yes', notes: 'Shifts worked ÷ shifts scheduled.' },
  { metric_id: 'punctuality', label: 'On-time clock-in', category: 'Reliability', unit: '%', direction: 'higher', target: 95, weight: 2, period: 'monthly', source: 'manual', active: 'yes', notes: 'Clock-ins within the grace window.' },
  { metric_id: 'callouts', label: 'Call-offs', category: 'Reliability', unit: 'count', direction: 'lower', target: 1, weight: 2, period: 'monthly', source: 'manual', active: 'yes', notes: 'Shifts called off with less than 24h notice.' },
  { metric_id: 'documentation', label: 'Documentation on time', category: 'Quality', unit: '%', direction: 'higher', target: 98, weight: 3, period: 'monthly', source: 'manual', active: 'yes', notes: 'Service notes filed before the shift ended.' },
  { metric_id: 'incidents', label: 'Incidents reported late', category: 'Quality', unit: 'count', direction: 'lower', target: 0, weight: 3, period: 'monthly', source: 'manual', active: 'yes', notes: 'A late incident report is a compliance problem, not a scheduling one.' },
  { metric_id: 'training_current', label: 'Training current', category: 'Compliance', unit: '%', direction: 'higher', target: 100, weight: 3, period: 'monthly', source: 'documents', active: 'yes', notes: 'Required certificates on file and unexpired.' },
  { metric_id: 'client_feedback', label: 'Client / family feedback', category: 'Care', unit: 'score', direction: 'higher', target: 4.5, weight: 2, period: 'quarterly', source: 'manual', active: 'yes', notes: '1–5, from families and house managers.' }
];

// Not `perfSheet_`: StaffPerformance.gs owns that name in Apps Script's single global scope.
function perfEnsureSheet_(tab, header, seed) {
  var existed = !!hubTabSheet_(tab);
  var sheet = hubTabEnsure_(tab, header);
  if (!existed) {
    // Seed only an empty sheet: hubTabSheet_ also answers null on a transient failure.
    if (seed && seed.length && sheet.getLastRow() < 2) {
      var now = new Date().toISOString();
      var rows = seed.map(function (d) {
        return header.map(function (h) {
          if (h === 'created_at' || h === 'updated_at') return now;
          if (h === 'updated_by') return 'seed';
          return d[h] === undefined ? '' : d[h];
        });
      });
      sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    }
  } else {
    ensureHeader_(sheet, header);
  }
  return sheet;
}

function perfMetrics_() {
  perfEnsureSheet_(PERF_METRICS_TAB, PERF_METRICS_HEADER, PERF_METRICS_SEED);
  // Read through the same router the writer uses; a hard-wired HUB_DB reads another workbook.
  var rows = readTabNormalized_(hubTabWorkbook_(PERF_METRICS_TAB), PERF_METRICS_TAB);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var id = str_(rows[i].metricid);
    if (!id) continue;
    if (str_(rows[i].active).toLowerCase() === 'no') continue;
    out.push({
      metric_id: id,
      label: str_(rows[i].label) || id,
      category: str_(rows[i].category) || 'General',
      unit: str_(rows[i].unit) || '',
      direction: str_(rows[i].direction).toLowerCase() === 'lower' ? 'lower' : 'higher',
      target: Number(rows[i].target),
      weight: Number(rows[i].weight) || 1,
      period: str_(rows[i].period) || 'monthly',
      source: str_(rows[i].source) || 'manual',
      notes: str_(rows[i].notes)
    });
  }
  return out;
}

function perfAttainment_(metric, value) {
  var t = Number(metric.target);
  var v = Number(value);
  if (isNaN(v)) return null;
  if (isNaN(t) || t === 0) {
    if (metric.direction === 'lower') return v <= 0 ? 100 : Math.max(0, 100 - v * 20);
    return v > 0 ? 100 : 0;
  }
  if (metric.direction === 'lower') {
    if (v <= t) return 100;
    return Math.max(0, Math.round(100 * (t / v)));
  }
  return Math.max(0, Math.min(150, Math.round((v / t) * 100)));
}

function perfEntries_(period) {
  perfEnsureSheet_(PERF_ENTRIES_TAB, PERF_ENTRIES_HEADER, null);
  var rows = readTabNormalized_(hubTabWorkbook_(PERF_ENTRIES_TAB), PERF_ENTRIES_TAB);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!str_(rows[i].personid) || !str_(rows[i].metricid)) continue;
    if (period && str_(rows[i].period) !== period) continue;
    out.push({
      person_id: str_(rows[i].personid),
      person_name: str_(rows[i].personname),
      metric_id: str_(rows[i].metricid),
      period: str_(rows[i].period),
      value: rows[i].value === '' ? null : Number(rows[i].value),
      note: str_(rows[i].note),
      source: str_(rows[i].source),
      recorded_at: str_(rows[i].recordedat),
      recorded_by: str_(rows[i].recordedby)
    });
  }
  return out;
}

function perfCurrentPeriod_() {
  var tz = typeof hubSheetTz_ === 'function' ? hubSheetTz_() : 'America/New_York';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM');
}

/** One card per person with a weighted score; `coverage` shows how many metrics it rests on. */
HUB_POLICY.perfBoard = {
  file: 'Performance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Never `[]`: that means any signed-in session, client and onboarding accounts included.
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.perfBoard = function (payload, user) {
  // Checked here too: the declared roles can be edited from a spreadsheet overlay.
  if (!user || (String(user.role) !== 'admin' && String(user.role) !== 'manager')) {
    return hubDenied_();
  }
  var period = str_(payload && payload.period) || perfCurrentPeriod_();
  var metrics = perfMetrics_();
  var entries = perfEntries_(period);

  var byPerson = {};
  entries.forEach(function (e) {
    var p = byPerson[e.person_id] || (byPerson[e.person_id] = { person_id: e.person_id, person_name: e.person_name, values: {} });
    if (!p.person_name && e.person_name) p.person_name = e.person_name;
    p.values[e.metric_id] = e;
  });

  var people = [];
  for (var pid in byPerson) {
    var p = byPerson[pid];
    var scored = 0, weight = 0, present = 0;
    var cells = metrics.map(function (m) {
      var e = p.values[m.metric_id];
      var att = e && e.value !== null ? perfAttainment_(m, e.value) : null;
      if (att !== null) { scored += att * m.weight; weight += m.weight; present++; }
      return {
        metric_id: m.metric_id, label: m.label, category: m.category, unit: m.unit,
        target: m.target, direction: m.direction, weight: m.weight,
        value: e ? e.value : null, note: e ? e.note : '',
        attainment: att,
        status: att === null ? 'missing' : (att >= 100 ? 'on-target' : att >= 85 ? 'near' : 'below')
      };
    });
    people.push({
      person_id: p.person_id,
      person_name: p.person_name || p.person_id,
      score: weight ? Math.round(scored / weight) : null,
      coverage: metrics.length ? Math.round((present / metrics.length) * 100) : 0,
      measured: present,
      metric_count: metrics.length,
      cells: cells
    });
  }
  people.sort(function (a, b) { return (b.score === null ? -1 : b.score) - (a.score === null ? -1 : a.score); });

  return { status: 200, data: { period: period, metrics: metrics, people: people } };
};

/** Metric definitions, for the settings screen. */
HUB_POLICY.perfMetricsList = {
  file: 'Performance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.perfMetricsList = function (payload, user) {
  if (!user) return { status: 401, message: 'Sign in first' };
  return { status: 200, data: { metrics: perfMetrics_() } };
};

/** Create or edit a metric. */
HUB_POLICY.perfMetricUpsert = {
  file: 'Performance.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.perfMetricUpsert = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var label = str_(payload.label);
  var id = str_(payload.metric_id) || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!id || !label) return { status: 400, message: 'A metric needs an id and a label' };
  var sheet = perfEnsureSheet_(PERF_METRICS_TAB, PERF_METRICS_HEADER, PERF_METRICS_SEED);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('metric_id');
  var now = new Date().toISOString();
  var fields = {
    metric_id: id, label: label,
    category: str_(payload.category) || 'General',
    unit: str_(payload.unit), direction: str_(payload.direction) === 'lower' ? 'lower' : 'higher',
    target: payload.target === undefined ? '' : Number(payload.target),
    weight: Number(payload.weight) || 1,
    period: str_(payload.period) || 'monthly',
    source: str_(payload.source) || 'manual',
    active: str_(payload.active) || 'yes',
    notes: str_(payload.notes),
    updated_at: now, updated_by: 'asa-hub:' + user.email
  };
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() === id) {
      for (var k in fields) {
        var i = hdr.indexOf(k);
        if (i !== -1) sheet.getRange(r + 1, i + 1).setValue(fields[k]);
      }
      hubSysLog_(user.email, 'perfMetricUpsert', id, { status: 200 });
      return { status: 200, data: { metric_id: id, updated: true } };
    }
  }
  fields.created_at = now;
  hubAppendRow_(PERF_METRICS_TAB, fields);
  hubSysLog_(user.email, 'perfMetricUpsert', id, { status: 200 });
  return { status: 200, data: { metric_id: id, created: true } };
};

/** File one number for one person in one period (idempotent per triple). */
HUB_POLICY.perfEntrySave = {
  file: 'Performance.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.perfEntrySave = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var pid = str_(payload.person_id), mid = str_(payload.metric_id);
  var period = str_(payload.period) || perfCurrentPeriod_();
  if (!pid || !mid) return { status: 400, message: 'person_id and metric_id are required' };
  if (payload.value === '' || payload.value === null || payload.value === undefined) {
    return { status: 400, message: 'A value is required — leave the metric unfiled instead of writing a zero.' };
  }
  var sheet = perfEnsureSheet_(PERF_ENTRIES_TAB, PERF_ENTRIES_HEADER, null);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iP = hdr.indexOf('person_id'), iM = hdr.indexOf('metric_id'), iPer = hdr.indexOf('period');
  var now = new Date().toISOString();
  var fields = {
    person_id: pid, person_name: str_(payload.person_name), metric_id: mid, period: period,
    value: Number(payload.value), note: str_(payload.note),
    source: str_(payload.source) || 'manual', recorded_at: now, recorded_by: 'asa-hub:' + user.email
  };
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iP]).trim() === pid && String(values[r][iM]).trim() === mid &&
        String(values[r][iPer]).trim() === period) {
      for (var k in fields) {
        var i = hdr.indexOf(k);
        if (i !== -1) sheet.getRange(r + 1, i + 1).setValue(fields[k]);
      }
      return { status: 200, data: { updated: true } };
    }
  }
  fields.entry_id = 'PFE_' + randomHex_(14).toUpperCase();
  hubAppendRow_(PERF_ENTRIES_TAB, fields);
  return { status: 200, data: { created: true } };
};

HUB_POLICY.perfReviewSave = {
  file: 'Performance.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.perfReviewSave = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var pid = str_(payload.person_id);
  if (!pid) return { status: 400, message: 'person_id is required' };
  perfEnsureSheet_(PERF_REVIEWS_TAB, PERF_REVIEWS_HEADER, null);
  hubAppendRow_(PERF_REVIEWS_TAB, {
    review_id: 'PFR_' + randomHex_(14).toUpperCase(),
    person_id: pid, person_name: str_(payload.person_name),
    period: str_(payload.period) || perfCurrentPeriod_(),
    score: payload.score === undefined ? '' : Number(payload.score),
    strengths: str_(payload.strengths), watch: str_(payload.watch),
    comments: str_(payload.comments),
    reviewer: str_(payload.reviewer) || 'asa-hub:' + user.email,
    created_at: new Date().toISOString()
  });
  hubSysLog_(user.email, 'perfReviewSave', pid, { status: 200 });
  return { status: 200, data: { saved: true } };
};

HUB_POLICY.perfReviewsList = {
  file: 'Performance.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.perfReviewsList = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  perfEnsureSheet_(PERF_REVIEWS_TAB, PERF_REVIEWS_HEADER, null);
  var rows = readTabNormalized_(hubTabWorkbook_(PERF_REVIEWS_TAB), PERF_REVIEWS_TAB);
  var pid = str_(payload && payload.person_id);
  var out = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    if (pid && str_(rows[i].personid) !== pid) continue;
    out.push({
      person_id: str_(rows[i].personid), person_name: str_(rows[i].personname),
      period: str_(rows[i].period), score: rows[i].score === '' ? null : Number(rows[i].score),
      strengths: str_(rows[i].strengths), watch: str_(rows[i].watch),
      comments: str_(rows[i].comments), reviewer: str_(rows[i].reviewer),
      created_at: str_(rows[i].createdat), when: hubWhenLabel_(str_(rows[i].createdat))
    });
  }
  return { status: 200, data: { reviews: out } };
};
