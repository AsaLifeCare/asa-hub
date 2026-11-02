// SETTINGS > MY WORK — the Support Requests automations.
// Each part runs only while its switch reads plainly on.
var MYWORK_AUTO_KEYS = { late_show: 'mywork_auto_sr_late_show', no_call: 'mywork_auto_sr_no_call_no_show',
                         punch: 'mywork_auto_sr_punch_missing', incident: 'mywork_auto_sr_incident',
                         general: 'mywork_auto_sr_general_requests', vehicle: 'mywork_auto_sr_vehicle',
                         payroll: 'mywork_auto_sr_payroll', adp_update: 'mywork_auto_sr_adp_update',
                         time_off: 'mywork_auto_sr_time_off' };

/** The switches as booleans; a key with no cell reads as its catalogue default. Throws when the tab cannot be read. */
function hubMyWorkAutoRead_() {
  var cfg = hiringAlerts_() || {};
  var shipped = hubMyWorkHideDefaults_();
  var out = {};
  for (var part in MYWORK_AUTO_KEYS) {
    if (!MYWORK_AUTO_KEYS.hasOwnProperty(part)) continue;
    var key = MYWORK_AUTO_KEYS[part];
    var raw = cfg[key] !== undefined ? cfg[key] : shipped['k:' + key];
    var v = String(raw == null ? '' : raw).trim().toLowerCase();
    out[part] = v === 'yes' || v === 'on' || v === 'true' || v === '1';
  }
  return out;
}

/** FAIL-CLOSED: a throw, a blank, an unknown word or an unknown part reads as off. */
function hubMyWorkAutoOn_(part) {
  try { return hubMyWorkAutoRead_()[part] === true; } catch (e) { return false; }
}
