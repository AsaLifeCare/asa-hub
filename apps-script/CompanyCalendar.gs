// Serves only what no slice carries; staff birthdays leave the Master as MM-DD only.

HUB_POLICY.companyCalendar = {
  file: 'CompanyCalendar.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: { from: { required: true, type: 'string' }, to: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.companyCalendar = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  if (['admin', 'manager'].indexOf(str_(user.role)) === -1) return hubDenied_();
  var from = str_(payload.from), to = str_(payload.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { status: 400, message: 'from and to must be YYYY-MM-DD.' };
  }

  var out = { hiring: [], sends: [], staff_birthdays: [] };

  // Every source here is headquarters' history: a franchise gets an empty calendar.
  if (hubAwayTenant_()) return { status: 200, data: out };

  try {
    var hc = HUB_ACTIONS.hiringCalendarList({}, user);
    if (hc && hc.status === 200 && hc.data && hc.data.events) {
      hc.data.events.forEach(function (ev) {
        var d = str_(ev.date);
        if (d >= from && d <= to) out.hiring.push(ev);
      });
    }
  } catch (e1) { }

  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), SMART_LEDGER_TAB).forEach(function (s) {
      var at = str_(s.at);
      var d = at.slice(0, 10);
      if (d < from || d > to) return;
      out.sends.push({ date: d, at: at, situation: str_(s.situation),
                       person: str_(s.person), channel: str_(s.channel) });
    });
  } catch (e2) { }

  try {
    var sh = empdbSheet_();
    var values = sh.getDataRange().getValues();
    var cols = empdbColumnIndex_(values[0].map(String));
    var iName = cols['Employee Name'], iDob = cols['Date of Birth'];
    if (iName !== undefined && iDob !== undefined) {
      for (var r = 1; r < values.length; r++) {
        var nm = String(values[r][iName] || '').trim();
        if (!nm) continue;
        var md = companyCalendarMonthDay_(values[r][iDob]);
        if (md) out.staff_birthdays.push({ name: nm, md: md });
      }
    }
  } catch (e3) { }

  return { status: 200, data: out };
};

// Never re-parse a date here: a timezone shift would move the birthday.
function companyCalendarMonthDay_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  }
  var s = String(v == null ? '' : v).trim();
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return iso[2] + '-' + iso[3];
  var us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/.exec(s);
  if (us) return ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  return '';
}
