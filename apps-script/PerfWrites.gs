var PERF_ABSENCE_KINDS = ['absence', 'late', 'no-show', 'left-early', 'excused'];
var PERF_INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];

HUB_POLICY.staffPerfAbsenceAdd = {
  file: 'PerfWrites.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  params: { emp_id: { required: true, type: 'string' },
            date: { required: true, type: 'string' } },
  roles: ['admin', 'manager'],
  invalidates: ['staffPerfBoard'], emits: []
};
HUB_ACTIONS.staffPerfAbsenceAdd = function (payload, user) {
  if (!perfIsManager_(user)) return hubDenied_();
  var empId = str_(payload && payload.emp_id);
  var date = str_(payload && payload.date).slice(0, 10);
  var kind = str_(payload && payload.kind).toLowerCase() || 'absence';
  var notes = str_(payload && payload.notes).slice(0, 500);
  if (!empId || !date) return { status: 400, message: 'emp_id and date are required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 400, message: 'date: YYYY-MM-DD.' };
  if (PERF_ABSENCE_KINDS.indexOf(kind) === -1) {
    return { status: 400, message: 'kind: one of ' + PERF_ABSENCE_KINDS.join(', ') };
  }
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var staff = perfReadSoft_(db, PERF_TABS.staff).filter(function (s) {
    return str_(s.empid) === empId;
  })[0];
  if (!staff) return { status: 404, message: 'No staff row "' + empId + '".' };
  // Values must follow the tab's own header order.
  perfSheet_(PERF_TABS.attendance).appendRow([
    empId, str_(staff.name), date, kind, notes,
    str_(user.email), 'hub:' + str_(user.email), new Date().toISOString()
  ]);
  // Without the dirty mark the board only rebuilds at the six-hour floor.
  staffPerfBoardDirty_();
  hubSysLog_(str_(user.email), 'staff_perf_absence_add', empId + ' — ' + kind + ' ' + date, { status: 200 });
  return { status: 200, data: { ok: true, emp_id: empId, date: date, kind: kind } };
};

HUB_POLICY.staffPerfIncidentAdd = {
  file: 'PerfWrites.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  params: { emp_id: { required: true, type: 'string' },
            summary: { required: true, type: 'string' } },
  roles: ['admin', 'manager'],
  invalidates: ['staffPerfBoard'], emits: []
};
HUB_ACTIONS.staffPerfIncidentAdd = function (payload, user) {
  if (!perfIsManager_(user)) return hubDenied_();
  var empId = str_(payload && payload.emp_id);
  var summary = str_(payload && payload.summary).slice(0, 800);
  if (!empId || !summary) return { status: 400, message: 'emp_id and summary are required.' };
  var severity = str_(payload && payload.severity).toLowerCase() || 'low';
  if (PERF_INCIDENT_SEVERITIES.indexOf(severity) === -1) {
    return { status: 400, message: 'severity: one of ' + PERF_INCIDENT_SEVERITIES.join(', ') };
  }
  var date = str_(payload && payload.date).slice(0, 10) ||
             new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 400, message: 'date: YYYY-MM-DD.' };
  var db = ssOpen_(hubId_('HUB_DB_ID'));
  var staff = perfReadSoft_(db, PERF_TABS.staff).filter(function (s) {
    return str_(s.empid) === empId;
  })[0];
  if (!staff) return { status: 404, message: 'No staff row "' + empId + '".' };
  // Values must follow the tab's own header order.
  perfSheet_(PERF_TABS.incidents).appendRow([
    empId, str_(staff.name), str_(payload && payload.type).slice(0, 60) || 'incident',
    severity, date, str_(payload && payload.category).slice(0, 60),
    summary, str_(payload && payload.action_taken).slice(0, 500),
    str_(user.email), 'open', 'hub:' + str_(user.email), new Date().toISOString()
  ]);
  staffPerfBoardDirty_();
  hubSysLog_(str_(user.email), 'staff_perf_incident_add', empId + ' — ' + severity, { status: 200 });
  return { status: 200, data: { ok: true, emp_id: empId, severity: severity, date: date } };
};
