// Staff: one staff member at a time, open to whom App Control releases it (hubProfileAppGate_).
// A client or family viewer reads only the BASIC profile of the staff their houses see (a client: this week's…

var SP_ACTIONS = ['staffProfileRoster', 'staffProfileOverview', 'staffProfileShifts', 'staffProfileEmployment',
                  'staffProfileDocuments', 'staffProfileCompliance', 'staffProfileHr', 'staffProfileActions',
                  'staffProfileActivity', 'staffProfileNotes', 'staffProfileTexts', 'staffProfileTranscripts',
                  'staffProfileDocFile', 'staffProfileTranscript', 'staffProfileNoteAdd', 'staffProfileNoteState',
                  'staffProfileAssignTraining', 'staffProfileVisit', 'staffProfileEdit', 'staffProfileRename',
                  'staffProfileDrivingEdit', 'staffProfileMaisEdit', 'staffProfileIstEdit',
                  'staffProfilePreferences', 'staffProfilePreferencesSave', 'staffProfilePerformance',
                  'staffProfileHrIssueAdd'];
var SP_NOTES_TAB = 'staff_notes';
var SP_NOTES_HEADER = ['id', 'staff_key', 'staff_name', 'category', 'priority', 'details', 'state', 'by', 'at',
                       'state_by', 'state_at'];
var SP_NOTE_CATEGORIES = ['general', 'performance', 'training', 'scheduling', 'hr'];
var SP_NOTE_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
var SP_NOTE_STATES = ['open', 'resolved'];
var SP_VISITS_TAB = 'staff_profile_visits';
var SP_VISITS_HEADER = ['id', 'staff_key', 'staff_name', 'section', 'visitor_email', 'visitor_name', 'at'];
var SP_VISIT_SECTIONS = ['profile', 'calendar', 'preferences', 'employment', 'documents', 'compliance', 'performance', 'hr',
                         'pay', 'actions', 'activity'];
var SP_VISIT_QUIET_SECONDS = 1800;
var SP_TEXT_PAGE = 150;
var SP_TEXT_CAP = 3000;
var SP_ACTIVITY_DAYS = 365;
var SP_SHIFT_PAST_DAYS = 180;
var SP_CLIENT_DAYS = 92;
var SP_CURRENT_DAYS = 30;
var SP_GAP_DAYS = 30;
var SP_DOC_DEPTH = 3;
var SP_DOC_CAP = 200;
var SP_EVENTS_CAP = 60;
var SP_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var SP_FLOWS = { training: 'Training renewal', documents: 'Document renewal', onboarding: 'Onboarding paperwork',
                 ist: 'IST training', review: 'Certificate review', meddel: 'Med Del renewal' };
// The Med Del page's own phase words (MedDelPage.tsx PHASE_LABEL); a contract test keeps both equal.
var SP_MEDDEL_PHASES = { '1': 'Application', '2': 'Application received', '3': 'Relias training', '4': 'Skills day',
                         '5': 'MAIS check' };
var SP_US_STATES = ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
                    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP').split(' ');

// The Master is read by position inside two blocks: the scorecard before `Status`, the data from `Status` on.
var SP_MASTER_FIELDS = [
  { id: 'employee', block: 'score', headers: ['Employee', 'Employee Name'] },
  { id: 'status', block: 'data', headers: ['Status'] },
  { id: 'employee_id', block: 'data', headers: ['Employee ID', 'Employee #', 'Emp ID'] },
  { id: 'first_name', block: 'data', headers: ['First Name', 'First'] },
  { id: 'last_name', block: 'data', headers: ['Last Name', 'Last'] },
  { id: 'ssn_last4', block: 'data', headers: ['SSN (Last 4)', 'SSN Last 4'], secret: true },
  { id: 'ssn', block: 'data', headers: ['SSN#', 'SSN #', 'SSN'], secret: true },
  { id: 'dob', block: 'data', headers: ['Date of Birth', 'DOB', 'Birth Date'] },
  { id: 'address', block: 'data', headers: ['Address', 'Street Address'] },
  { id: 'city', block: 'data', headers: ['City'] },
  { id: 'state', block: 'data', headers: ['State', 'ST'] },
  { id: 'zip', block: 'data', headers: ['Zip', 'Zip Code', 'Zipcode'] },
  { id: 'phone', block: 'data', headers: ['Phone Number', 'Phone', 'Cell Phone'] },
  { id: 'email', block: 'data', headers: ['Email', 'Email Address', 'E-mail'] },
  { id: 'referral', block: 'data', headers: ['Referral', 'Referred By'] },
  { id: 'referral_paid', block: 'data', headers: ['Referral Paid?', 'Referral Paid'] },
  { id: 'start_doc', block: 'data', headers: ['Start Date(doc)'] },
  { id: 'start_first_day', block: 'data', headers: ['Start Date (first day)'] },
  { id: 'end_last_day', block: 'data', headers: ['End Date (last day)'] },
  { id: 'job_app_date', block: 'data', headers: ['Job App Date'] },
  { id: 'resume', block: 'data', headers: ['Resume'] },
  { id: 'attestation_date', block: 'data', headers: ['Attestation Date'] },
  { id: 'i9_date', block: 'data', headers: ['I-9 Date', 'I9 Date'] },
  { id: 'i9_completed', block: 'data', headers: ['I-9 Completed', 'I9 Completed'] },
  { id: 'i9_type_1', block: 'data', headers: ['I-9 Type 1'] },
  { id: 'i9_type_1_exp', block: 'data', headers: ['I-9 1 Exp Date'] },
  { id: 'i9_type_2', block: 'data', headers: ['I-9 Type 2'] },
  { id: 'i9_type_2_exp', block: 'data', headers: ['I-9 2 Exp Date'] },
  { id: 'w4_date', block: 'data', headers: ['W-4 Date', 'W4 Date'] },
  { id: 'hipaa_date', block: 'data', headers: ['HIPAA Form Date'] },
  { id: 'pay_auth_date', block: 'data', headers: ['Pay Auth Form Date'] },
  { id: 'hs_diploma', block: 'data', headers: ['HS Diploma'] },
  { id: 'driver', block: 'data', headers: ['Driver'] },
  { id: 'dl', block: 'data', headers: ['DL#', 'DL #', 'DL'], secret: true },
  { id: 'license_exp', block: 'data', headers: ['License Exp Date'] },
  { id: 'abstract_original', block: 'data', headers: ["Driver's Abstract (Original)"] },
  { id: 'abstract_latest', block: 'data', headers: ["Driver's Abstract (Latest)"] },
  { id: 'insurance_exp', block: 'data', headers: ['Insurance Exp Date'] },
  { id: 'sam', block: 'data', headers: ['SAM'] },
  { id: 'oig', block: 'data', headers: ['OIG'] },
  { id: 'abuser', block: 'data', headers: ['Abuser Registry', 'Abuser'] },
  { id: 'sex_offender', block: 'data', headers: ['Sex Offender'] },
  { id: 'offender', block: 'data', headers: ['Offender'] },
  { id: 'nurse_aide', block: 'data', headers: ['Nurse Aide'] },
  { id: 'exclusions', block: 'data', headers: ['Exclusions Database', 'Exclusions'] },
  { id: 'bci_fbi', block: 'data', headers: ['BCI/FBI', 'BCI / FBI'], secret: true },
  { id: 'bci_check_date', block: 'data', headers: ['BCI Check Date'] },
  { id: 'rapback_entry_date', block: 'data', headers: ['Rapback Entry Date'] },
  { id: 'flag_job_app', block: 'score', headers: ['Job App'] },
  { id: 'flag_attestation', block: 'score', headers: ['Attestation'] },
  { id: 'flag_i9', block: 'score', headers: ['i9 Form', 'I-9 Form', 'I9 Form'] },
  { id: 'flag_w4', block: 'score', headers: ['W4', 'W-4', 'W4 Form'] },
  { id: 'flag_hipaa', block: 'score', headers: ['HIPAA'] },
  { id: 'flag_pay_auth', block: 'score', headers: ['Pay Auth'] },
  { id: 'flag_hs_diploma', block: 'score', headers: ['HS Diploma'] },
  { id: 'flag_abstract', block: 'score', headers: ['Drive Abstract (last)', "Driver's Abstract"] },
  { id: 'flag_car_insurance', block: 'score', headers: ['Car Insurance'] },
  { id: 'flag_sam', block: 'score', headers: ['SAM'] },
  { id: 'flag_oig', block: 'score', headers: ['OIG'] },
  { id: 'flag_abuser', block: 'score', headers: ['Abuser', 'Abuser Registry'] },
  { id: 'flag_sex_offender', block: 'score', headers: ['Sex Offender'] },
  { id: 'flag_offender', block: 'score', headers: ['Offender'] },
  { id: 'flag_nurse_aide', block: 'score', headers: ['Nurse Aide'] },
  { id: 'flag_exclusions', block: 'score', headers: ['Exclusions', 'Exclusions Database'] },
  { id: 'flag_bci', block: 'score', headers: ['BCI'] },
  { id: 'flag_rapback', block: 'score', headers: ['Rapback'] }
];

// The papers the Master tracks; `kind` decides the status rule, `re` finds the paper's file.
var SP_PAPERS = [
  { id: 'job_app', title: 'Job application', category: 'hiring', date: 'job_app_date', flag: 'flag_job_app',
    kind: 'form', re: /job\s*app|application/i },
  { id: 'resume', title: 'Resume', category: 'hiring', kind: 'resume', re: /r[eé]sum[eé]|\bcv\b/i },
  { id: 'attestation', title: 'Employee attestation', category: 'hiring', date: 'attestation_date',
    flag: 'flag_attestation', kind: 'form', re: /attestation/i },
  { id: 'i9', title: 'Form I-9', category: 'work_authorization', date: 'i9_date', expires: 'i9_type_1_exp',
    flag: 'flag_i9', kind: 'verify', re: /\bi-?9\b/i },
  { id: 'w4', title: 'Form W-4', category: 'tax', date: 'w4_date', flag: 'flag_w4', kind: 'form', re: /\bw-?4\b/i },
  { id: 'hipaa', title: 'HIPAA form', category: 'hiring', date: 'hipaa_date', flag: 'flag_hipaa', kind: 'form',
    re: /hipaa/i },
  { id: 'pay_auth', title: 'Pay authorization form', category: 'tax', date: 'pay_auth_date', flag: 'flag_pay_auth',
    kind: 'form', re: /pay\s*auth|direct\s*deposit/i },
  { id: 'hs_diploma', title: 'HS diploma / GED', category: 'hiring', flag: 'flag_hs_diploma', kind: 'verify',
    re: /diploma|\bged\b|high\s*school|\bhs\s+transcript/i },
  { id: 'drivers_license', title: "Driver's license", category: 'driving', expires: 'license_exp', kind: 'record',
    driving: true, re: /driver'?s?\s*licen[sc]e|\boh\s*id\b|state\s*id/i },
  { id: 'car_insurance', title: 'Car insurance card', category: 'driving', expires: 'insurance_exp',
    flag: 'flag_car_insurance', kind: 'record', driving: true, re: /insurance/i },
  { id: 'drivers_abstract', title: "Driver's abstract", category: 'driving', date: 'abstract_latest',
    flag: 'flag_abstract', kind: 'record', driving: true, re: /abstract/i }
];

// HR screening lines: the data cell, its scorecard flag, and the label drawn.
var SP_SCREENS = [
  { id: 'sam', label: 'SAM database', cell: 'sam', flag: 'flag_sam' },
  { id: 'oig', label: 'OIG exclusions', cell: 'oig', flag: 'flag_oig' },
  { id: 'abuser', label: 'Abuser registry', cell: 'abuser', flag: 'flag_abuser' },
  { id: 'sex_offender', label: 'Sex offender registry', cell: 'sex_offender', flag: 'flag_sex_offender' },
  { id: 'offender', label: 'Offender registry', cell: 'offender', flag: 'flag_offender' },
  { id: 'nurse_aide', label: 'Nurse aide registry', cell: 'nurse_aide', flag: 'flag_nurse_aide' },
  { id: 'exclusions', label: 'Exclusions database', cell: 'exclusions', flag: 'flag_exclusions' }
];

// The fields the edit door writes, by section: a Master column (its SP_MASTER_FIELDS id) or the sign-in account.
var SP_EDIT_SECTIONS = {
  profile: ['first_name', 'last_name', 'status', 'phone', 'email', 'account_phones', 'account_emails', 'avatar', 'login_email'],
  employment: ['referral', 'referral_paid', 'job_app_date', 'resume', 'attestation_date', 'start_doc', 'start_first_day',
               'end_last_day', 'hs_diploma', 'driver'],
  hr: ['address', 'city', 'state', 'zip', 'w4_date', 'pay_auth_date', 'i9_date', 'i9_completed', 'i9_type_1', 'i9_type_1_exp',
       'i9_type_2', 'i9_type_2_exp', 'hipaa_date', 'license_exp', 'abstract_original', 'abstract_latest', 'insurance_exp',
       'sam', 'oig', 'abuser', 'sex_offender', 'offender', 'nurse_aide', 'exclusions', 'bci_check_date', 'rapback_entry_date']
};
var SP_EDIT_ACCOUNT = ['account_phones', 'account_emails', 'avatar', 'login_email'];
var SP_EDIT_RENAME = 'A rename re-keys the staff record (its link, notes and visits): it is filed through the rename door.';
var SP_EDIT_PROTECTED = 'Protected: edited only in the Employee Database\'s own forms.';
// Never written here, each with the reason the panel shows. People columns are rewritten by the contacts sync.
var SP_EDIT_LOCKED = {
  first_name: SP_EDIT_RENAME, last_name: SP_EDIT_RENAME, name: SP_EDIT_RENAME,
  employee_id: 'The payroll id: read-only here.',
  role: 'Comes from the employee roster sync, which would overwrite an edit made here.',
  ssn: SP_EDIT_PROTECTED, ssn_last4: SP_EDIT_PROTECTED, dob: SP_EDIT_PROTECTED, dl: SP_EDIT_PROTECTED,
  bci_fbi: SP_EDIT_PROTECTED
};
// The fields whose before/after the audit line may carry: dates, flags and words, never a contact or identity value.
var SP_EDIT_PLAIN = ['status', 'referral_paid', 'job_app_date', 'resume', 'attestation_date', 'start_doc', 'start_first_day',
                     'end_last_day', 'hs_diploma', 'driver', 'w4_date', 'pay_auth_date', 'i9_date', 'i9_completed',
                     'i9_type_1_exp', 'i9_type_2_exp', 'hipaa_date', 'license_exp', 'abstract_original', 'abstract_latest',
                     'insurance_exp', 'sam', 'oig', 'abuser', 'sex_offender', 'offender', 'nurse_aide', 'exclusions',
                     'bci_check_date', 'rapback_entry_date'];

var SP_APP_ID = 'staff-profiles';
var SP_BASIC_KINDS = ['client', 'guardian'];
var SP_WHOLE_KINDS = ['master', 'all', 'ssa'];
var SP_NO_STAFF = 'No staff member with that key.';

/** FAIL-CLOSED: { open, scope } — the real master, or a viewer whose badge App Control released Staff to. */
function staffProfilesGate_(user) {
  var g = null;
  try { g = hubProfileAppGate_(SP_APP_ID, user); } catch (e) { g = null; }
  return g && g.open === true && g.scope ? g : { open: false, scope: null };
}

/** A client or family viewer: the BASIC profile of the staff their houses see, nothing more. */
function spBasicGate_(gate) {
  return !!(gate && gate.open && gate.scope && SP_BASIC_KINDS.indexOf(gate.scope.kind) !== -1);
}

/** FAIL-CLOSED: the gate of a viewer who sees every staff member whole (the master, a released badge, an SSA); else null. */
function spWholeGate_(user) {
  var g = staffProfilesGate_(user);
  return g.open && SP_WHOLE_KINDS.indexOf(g.scope.kind) !== -1 ? g : null;
}

/** FAIL-CLOSED: the writes are the master's in its own session, never a visit or a service call. */
function staffProfilesMaster_(user) {
  try { return !!hubIsRealMaster_(user); } catch (e) { return false; }
}

/** The viewer's own staff key: the display-name fold the roster keys people by; '' for a service or a visit. */
function spSelfKey_(user) {
  if (!user || user.is_service || user.visiting_member) return '';
  if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX) return '';
  return hubNameFold_(user.display_name != null ? user.display_name : user.displayname);
}

// FAIL-CLOSED: who may assign training to `staffKey` — 'master', 'manager' (a badge worn ranks HM or above on…
function spTrainingAssigner_(user, staffKey) {
  if (!user || user.is_service || user.visiting_member) return '';
  if (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX) return '';
  if (staffProfilesMaster_(user)) return 'master';
  var worn = [];
  try { worn = userBadgesWornBy_(user) || []; } catch (e) { worn = []; }
  var floor = HUB_USER_TYPES.indexOf('HM');
  var ranked = floor !== -1 && worn.some(function (b) {
    var at = HUB_USER_TYPES.indexOf(String(b || '').toUpperCase());
    return at !== -1 && at <= floor;
  });
  if (ranked) return 'manager';
  var key = String(staffKey == null ? '' : staffKey).trim();
  var mine = spSelfKey_(user);
  return key && mine && key === mine ? 'self' : '';
}

function staffProfilesUnknown_() {
  return { status: 404, message: 'Unknown action.' };
}

// { keys, short }: the staff keys a narrowed viewer's houses see — a client the staff on this week's shifts there…
function spVisibleTo_(scope) {
  var got = null;
  var codes = (scope && scope.house_codes) || [];
  try {
    got = scope && scope.kind === 'client' ? hubStaffScheduledForHouses_(codes) : hubStaffVisibleForHouses_(codes);
  } catch (e) { got = null; }
  var keys = {};
  ((got && got.keys) || []).forEach(function (k) { if (k) keys[k] = true; });
  return { keys: keys, short: !got || !!got.why };
}

/** A narrowed viewer's staff member: 400 malformed, 404 outside the staff their houses see (as for no one), else the person. */
function spBasicPerson_(raw, scope) {
  var key = String(raw == null ? '' : raw).trim();
  if (!/^[a-z0-9]{3,80}$/.test(key)) return { refused: { status: 400, message: 'staff: a staff key.' } };
  if (!spVisibleTo_(scope).keys[key]) return { refused: { status: 404, message: SP_NO_STAFF } };
  return staffProfilesPerson_(key);
}

// ---- pure helpers ---------------------------------------------------------

function spWhy_(what, e) {
  return what + ' could not be read (' + String((e && e.message) || e).slice(0, 120) + ')';
}

function spText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}

/** A header as compared: case, runs of whitespace and the space before a parenthesis do not count. */
function spHead_(h) {
  return String(h == null ? '' : h).replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')');
}

/** A day as yyyy-MM-dd: a Date on its sheet's zone, a US or ISO date anywhere at the start; '' otherwise. */
function spDay_(v, tz) {
  if (v instanceof Date) {
    if (isNaN(v.getTime()) || v.getFullYear() < 1900) return '';
    try { return Utilities.formatDate(v, tz || 'America/New_York', 'yyyy-MM-dd'); }
    catch (e) { return v.toISOString().slice(0, 10); }
  }
  var s = String(v == null ? '' : v).trim();
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
  if (us) {
    var y = Number(us[3]);
    if (y < 100) y += 2000;
    return y + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  }
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : '';
}

/** The first date written anywhere in a cell ("Yes - m/d/yyyy" → that day); '' when none. */
function spDayIn_(v) {
  var s = String(v == null ? '' : v);
  var m = /(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(s) || /(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? spDay_(m[1]) : '';
}

function spTime_(v, tz) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    try { return Utilities.formatDate(v, tz || 'America/New_York', 'HH:mm'); } catch (e) { return ''; }
  }
  var s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    try { return Utilities.formatDate(d, 'America/New_York', 'HH:mm'); } catch (e2) { return s.slice(11, 16); }
  }
  return s.slice(0, 20);
}

function spInstant_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v == null ? '' : v).trim();
}

function spDaysBetween_(a, b) {
  var x = Date.parse(String(a || '') + 'T12:00:00Z'), y = Date.parse(String(b || '') + 'T12:00:00Z');
  return isNaN(x) || isNaN(y) ? 0 : Math.round((y - x) / 86400000);
}

function spWeekday_(iso) {
  var t = Date.parse(String(iso || '') + 'T12:00:00Z');
  return isNaN(t) ? '' : SP_WEEKDAYS[new Date(t).getUTCDay()];
}

/** Runs of `min` days or more with no day in `days` between the first and the last one present. */
function spGaps_(days, min) {
  var list = Object.keys(days || {}).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
  var out = [];
  for (var i = 1; i < list.length; i++) {
    if (spDaysBetween_(list[i - 1], list[i]) - 1 >= (min || SP_GAP_DAYS)) {
      out.push({ from: locationsDayShift_(list[i - 1], 1), to: locationsDayShift_(list[i], -1) });
    }
  }
  return out;
}

/** A phone as its last ten digits; '' when fewer. */
function spDigits10_(v) {
  var d = String(v == null ? '' : v).replace(/\D+/g, '');
  if (d.length >= 11 && d.charAt(0) === '1') d = d.slice(1);
  d = d.slice(-10);
  return d.length === 10 ? d : '';
}

/** Every phone number written in a cell ("+1330…, +1216…"), as last-ten digits. */
function spNumbers_(v) {
  var out = [];
  (String(v == null ? '' : v).match(/\+?\d[\d\s().-]{8,}\d/g) || []).forEach(function (m) {
    var d = spDigits10_(m);
    if (d && out.indexOf(d) === -1) out.push(d);
  });
  return out;
}

function spYesNo_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^(y|yes|true|x|1)$/.test(s)) return 'yes';
  if (/^(n|no|false|0)$/.test(s)) return 'no';
  return '';
}

function spIsNa_(v) {
  return /^(n\/?a|na|none|not applicable|not required|n-a)$/i.test(String(v == null ? '' : v).trim());
}

/** "•••-••-1842": the four digits of SSN (Last 4), else the last four of a nine-digit SSN#; '' otherwise. */
function spSsnMask_(last4Cell, ssnCell) {
  var four = typeof last4Cell === 'number' && isFinite(last4Cell) && last4Cell >= 0 && last4Cell < 10000
    ? ('000' + Math.round(last4Cell)).slice(-4) : String(last4Cell == null ? '' : last4Cell).replace(/\D/g, '');
  if (four.length === 4) return '•••-••-' + four;
  var all = '';
  try { all = String(hubSsnDigits_(ssnCell) || ''); } catch (e) { all = ''; }
  return all.length === 9 ? '•••-••-' + all.slice(-4) : '';
}

// "OH •••• 7731": a state and the last four digits.
function spLicenceMask_(dlCell, stateCell) {
  var raw = String(dlCell == null ? '' : dlCell).trim().toUpperCase();
  if (!raw || spIsNa_(raw) || /^(NO|NONE)$/.test(raw)) return '';
  var st = '', num = raw;
  var tok = /^([A-Z]{2})[\s\-:#.]+(.+)$/.exec(raw);
  if (tok && SP_US_STATES.indexOf(tok[1]) !== -1 && /[A-Z]/.test(tok[2]) && /\d/.test(tok[2])) {
    st = tok[1];
    num = tok[2];
  } else {
    var ms = String(stateCell == null ? '' : stateCell).trim().toUpperCase();
    if (SP_US_STATES.indexOf(ms) !== -1) st = ms;
  }
  var digits = num.replace(/\D/g, '');
  if (digits.length < 6) return 'On file';
  return (st ? st + ' ' : '') + '•••• ' + digits.slice(-4);
}

/** A BCI receipt as "BMT•••••147"; a date stays a date; anything else with a number in it is only "On file". */
function spBciMask_(cell, tz) {
  if (cell instanceof Date) return { ref: '', date: spDay_(cell, tz) };
  var s = String(cell == null ? '' : cell).trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return { ref: '', date: '' };
  var m = /^([A-Z]{2,4})(\d{6,})$/.exec(s);
  if (m) return { ref: m[1] + '•••••' + m[2].slice(-3), date: '' };
  var d = spDay_(cell);
  if (d) return { ref: '', date: d };
  return { ref: (s.replace(/\D/g, '').length >= 6 ? 'On file' : ''), date: '' };
}

function spMasterCell_(v, tz) {
  if (v instanceof Date) return spDay_(v, tz);
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  return spText_(v, 200);
}

// The Master's rows keyed by First + Last (the Employee cell when those are blank), masked.
function spMasterIndexFrom_(values, tz) {
  var out = { rows: {}, missing: [], status_col: false, cols: {} };
  var seen = {};
  var head = ((values && values[0]) || []).map(spHead_);
  var editIds = spEditMasterIds_();
  var iStatus = head.indexOf('status');
  out.status_col = iStatus !== -1;
  var col = {};
  SP_MASTER_FIELDS.forEach(function (f) {
    var lo = f.block === 'data' && iStatus !== -1 ? iStatus : 0;
    var hi = f.block === 'score' ? (iStatus === -1 ? 0 : iStatus) : head.length;
    for (var a = 0; a < f.headers.length && col[f.id] === undefined; a++) {
      var want = spHead_(f.headers[a]);
      for (var c = lo; c < hi; c++) {
        if (head[c] === want) { col[f.id] = c; break; }
      }
    }
    if (col[f.id] === undefined) out.missing.push(f.id);
  });
  // the edit door writes the exact column read here: its position and its header as written
  editIds.forEach(function (id) {
    if (col[id] !== undefined) out.cols[id] = { at: col[id], head: String(values[0][col[id]]) };
  });
  for (var r = 1; r < (values || []).length; r++) {
    var line = values[r] || [];
    var fields = {}, raw = {}, edit = {};
    // the raw cell as the door's witness reads it (emp360Cell_), never for a secret or protected field
    editIds.forEach(function (id) { if (out.cols[id]) edit[id] = emp360Cell_(line[out.cols[id].at], tz); });
    SP_MASTER_FIELDS.forEach(function (f) {
      var c = col[f.id];
      if (c === undefined) return;
      if (f.secret) { raw[f.id] = line[c]; return; }
      var s = spMasterCell_(line[c], tz);
      if (s) fields[f.id] = s;
    });
    fields.ssn_masked = spSsnMask_(raw.ssn_last4, raw.ssn);
    fields.license_masked = spLicenceMask_(raw.dl, fields.state);
    var bci = spBciMask_(raw.bci_fbi, tz);
    fields.bci_ref_masked = bci.ref;
    fields.bci_fbi_date = bci.date;
    raw = null;
    var name = spText_((fields.first_name || '') + ' ' + (fields.last_name || ''));
    if (!clientNameKey_(name)) name = fields.employee || '';
    var key = clientNameKey_(name);
    if (!key) continue;
    if (!spOwn_(seen, key)) seen[key] = [];
    seen[key].push({ key: key, name: name, ambiguous: false, fields: fields, edit: edit });
  }
  Object.keys(seen).forEach(function (k) {
    var rows = seen[k];
    var live = rows.length > 1 ? rows.filter(function (x) { return emp360StatusActive_(x.fields); }) : rows;
    out.rows[k] = live.length === 1 ? live[0] : { key: k, name: rows[0].name, ambiguous: true, fields: {} };
  });
  return out;
}

/** Masked Master rows, cached on the tab (only masked values are ever stored). Throws when the book cannot be read. */
function spMasterIndex_() {
  var id = String(empDbId_() || '');
  if (!id) throw new Error('CERT_SOURCE_ID is not set');
  var tab = emp360MasterTab_();
  return cacheRead_(cacheScopeSheet_(id, tab), 'sp_master_v3', function () {
    var ss = ssOpen_(id);
    var sheet = ss.getSheetByName(tab);
    if (!sheet) throw new Error('the Employee Database has no ' + tab + ' tab');
    var tz = '';
    try { tz = String(ss.getSpreadsheetTimeZone() || ''); } catch (eT) { tz = ''; }
    return spMasterIndexFrom_(sheet.getDataRange().getValues(), tz || 'America/New_York');
  });
}

/** The same fold the relay and the cert matrix use, over flags that may hold numbers or words. */
function spFlag_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var n = Number(s);
  if (!isNaN(n)) return n >= 1 ? '1' : (n > 0 ? '0.5' : '0');
  return s.toLowerCase();
}

/** A screening cell with its scorecard flag: a date is clear on that day; n/a; a word; blank reads the flag. */
function spScreenState_(cell, flag) {
  var s = String(cell == null ? '' : cell).trim();
  var d = spDay_(s);
  if (d) return { state: 'clear', date: d };
  if (s && spIsNa_(s)) return { state: 'na', date: '' };
  if (s && /^(clear|cleared|pass|passed|ok|yes|none found|no record|no records|not listed|negative)$/i.test(s)) {
    return { state: 'clear', date: '' };
  }
  if (s) return { state: 'pending', date: '' };
  var f = spFlag_(flag);
  if (f === '1' || f === '0.5') return { state: 'clear', date: '' };
  if (f === 'n/a' || f === 'na') return { state: 'na', date: '' };
  return { state: 'missing', date: '' };
}

/** Several screens as one line: all n/a is n/a, any missing is missing, any pending is pending, else clear on the latest day. */
function spScreenJoin_(list) {
  var real = list.filter(function (x) { return x.state !== 'na'; });
  if (!real.length) return { state: 'na', date: '' };
  var worst = real.some(function (x) { return x.state === 'missing'; }) ? 'missing'
    : (real.some(function (x) { return x.state === 'pending'; }) ? 'pending' : 'clear');
  var date = '';
  real.forEach(function (x) { if (x.date && x.date > date) date = x.date; });
  return { state: worst, date: worst === 'clear' ? date : '' };
}

function spNotStaff_(p) {
  if (!p) return true;
  if (String(p.guardian_for || '').trim()) return true;
  if (/^PPL_guardian_/.test(String(p.id || ''))) return true;
  var role = String(p.role || '').trim().toLowerCase();
  return role === 'guardian' || role === 'entity' || role === 'client';
}

function spPhonesOf_(p) {
  var out = [];
  [p && p.phone].concat((p && Array.isArray(p.phones)) ? p.phones : []).forEach(function (v) {
    var d = spDigits10_(v);
    if (d && out.indexOf(d) === -1) out.push(d);
  });
  return out;
}

function spStatusOf_(p, mf) {
  var r = String((p && p.status) || '').trim().toLowerCase();
  var m = String((mf && mf.status) || '').trim().toLowerCase();
  if (r === 'active' || m === 'yes' || m === 'active') return 'active';
  if (/^(pending|onboarding|hired)$/.test(r) || m === 'hired' || m === 'pending') return 'pending';
  if (m === 'other') return 'other';
  if (/^(inactive|terminated|former|resigned|separated)$/.test(r) || /^(no|inactive|terminated)$/.test(m)) return 'inactive';
  return 'other';
}

/** Last guard on every answer: an SSN shape (3-2-4 with dashes, spaces or dots) or a bare nine-digit run never leaves. */
var SP_SCRUB_KEYS = { id: true, file_id: true, doc_id: true, call_id: true, user_id: true, roster_id: true,
                      employee_id: true, with: true };
function spScrub_(v, key) {
  if (key && SP_SCRUB_KEYS[key]) return v;
  if (typeof v === 'string') {
    return v.replace(/(^|\D)\d{3}[\s.-]\d{2}[\s.-]\d{4}(?=\D|$)/g, '$1[withheld]')
            .replace(/(^|\D)\d{9}(?=\D|$)/g, '$1[withheld]');
  }
  if (typeof v === 'number') {
    return String(Math.abs(Math.round(v))).length === 9 && Math.round(v) === v ? null : v;
  }
  if (Array.isArray(v)) return v.map(function (x) { return spScrub_(x); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = spScrub_(v[k], k); });
    return out;
  }
  return v;
}

// ---- the stores -----------------------------------------------------------

/** People rows that are staff: no guardian, entity or client row, keyed by folded name; phones by digits. */
function spRosterIndex_() {
  var rows = peopleMerged_(listRows_('people', {})) || [];
  try { rows = withoutIspClients_(rows) || rows; } catch (eW) { /* the client list below still narrows */ }
  var clientKeys = {};
  try {
    clientsDerived_(null).forEach(function (c) { var k = clientNameKey_(c.name); if (k) clientKeys[k] = true; });
  } catch (eC) { clientKeys = {}; }
  var byKey = {}, phones = {};
  rows.forEach(function (p) {
    if (spNotStaff_(p)) return;
    var name = spText_(p.name) || spText_(String(p.first_name || '') + ' ' + String(p.last_name || ''));
    var k = clientNameKey_(name);
    if (!k || clientKeys[k]) return;
    (byKey[k] = byKey[k] || []).push(p);
    spPhonesOf_(p).forEach(function (d) { (phones[d] = phones[d] || {})[k] = true; });
  });
  return { byKey: byKey, phones: phones };
}

/** The platform account a staff member signs in with: by e-mail first, else the one account carrying the name. */
function spAccountFor_(key, emails) {
  var want = {};
  (emails || []).forEach(function (e) { var s = String(e || '').trim().toLowerCase(); if (s) want[s] = true; });
  var byMail = null, byName = [];
  usersAll_().forEach(function (u) {
    if (str_(u.mergedinto) || str_(u.clientkey)) return;
    var em = str_(u.email).toLowerCase();
    if (!byMail && em && want[em]) byMail = u;
    if (clientNameKey_(str_(u.displayname)) === key) byName.push(u);
  });
  var pick = byMail || (byName.length === 1 ? byName[0] : null);
  return { account: pick ? spAccountRow_(pick) : null, candidate_id: pick ? str_(pick.candidateid) : '',
           why: !pick && byName.length > 1 ? 'two accounts carry this name, so neither is shown' : '' };
}

/** The account fields this app may hold; a credential column is never copied. */
function spAccountRow_(u) {
  var phones = [];
  try {
    phones = profileCleanPhones_(profileParsePhones_(u.phones)).map(function (p) { return { label: p.label, value: p.number }; });
  } catch (eP) { phones = []; }
  var emails = [];
  try { emails = profileCleanEmails_(u.emails); } catch (eE) { emails = []; }
  return { user_id: str_(u.userid), email: str_(u.email), role: str_(u.role) || 'staff',
           active: str_(u.active).toLowerCase() !== 'false', last_login: str_(u.lastlogin),
           created_at: str_(u.createdat), phone: str_(u.phone), phones: phones, emails: emails, avatar: str_(u.avatar) };
}

/** The staff member a request names: 400 malformed, 404 unknown, 409 two records, 503 when the sources cannot say. */
function staffProfilesPerson_(raw) {
  var key = String(raw == null ? '' : raw).trim();
  if (!/^[a-z0-9]{3,80}$/.test(key)) return { refused: { status: 400, message: 'staff: a staff key.' } };
  var roster = null, rosterWhy = '';
  try { roster = spRosterIndex_(); } catch (eR) { rosterWhy = spWhy_('the People roster', eR); }
  var hits = roster ? (roster.byKey[key] || []) : [];
  if (hits.length > 1) {
    return { refused: { status: 409, message: 'Two staff records share this name — resolve them in People first.' } };
  }
  var mi = null, masterWhy = '';
  try { mi = spMasterIndex_(); } catch (eM) { masterWhy = spWhy_('the Employee Database Master', eM); }
  var m = mi ? (mi.rows[key] || null) : null;
  var master = m && !m.ambiguous ? m : null;
  if (m && m.ambiguous) masterWhy = 'two Master rows share this name, so neither is read';
  if (!hits.length && !master) {
    if (!roster || !mi) {
      return { refused: { status: 503, message: 'The staff sources could not be read just now (' +
               [rosterWhy, masterWhy].filter(String).join('; ') + ') — nothing is said about this key.' } };
    }
    if (m && m.ambiguous) {
      return { refused: { status: 409, message: 'Two Master rows share this name — resolve them in the Employee Database first.' } };
    }
    return { refused: { status: 404, message: SP_NO_STAFF } };
  }
  var p = hits[0] || null;
  var mf = master ? master.fields : null;
  var name = (p && (spText_(p.name) || spText_(String(p.first_name || '') + ' ' + String(p.last_name || '')))) ||
             (master && master.name) || key;
  var parts = name.split(' ');
  var emails = [p && p.email, mf && mf.email].concat((p && Array.isArray(p.emails)) ? p.emails : []);
  var acct = { account: null, candidate_id: '', why: '' };
  try { acct = spAccountFor_(key, emails); } catch (eA) { acct.why = spWhy_('the accounts', eA); }
  return {
    key: key, name: name,
    first_name: spText_((p && p.first_name) || (mf && mf.first_name) || parts[0]),
    last_name: spText_((p && p.last_name) || (mf && mf.last_name) || parts.slice(1).join(' ')),
    people: p, roster_why: rosterWhy, master: mf, master_why: masterWhy,
    master_missing: mi ? mi.missing : [], master_read: !!mi,
    master_edit: master ? (master.edit || {}) : null, master_cols: (mi && mi.cols) || {},
    account: acct.account, account_why: acct.why, candidate_id: acct.candidate_id,
    phones_shared: roster ? roster.phones : {}, status: spStatusOf_(p, mf)
  };
}

/** Clients narrowed to identity: never a clinical field. */
function spClientRows_() {
  return clientsDerived_(null).map(function (c) {
    return { client_key: String(c.client_key || '').trim() || clientNameKey_(c.name), client_id: String(c.id || ''),
             name: spText_(c.name), house: spText_(c.house || c.houseName), home_address: spText_(c.home_address),
             status: spText_(c.status), avatar: String(c.avatar || '') };
  });
}

function spIstRows_() {
  return listRows_('istRecords', {});
}

/** Image Bank photos titled with a house code, first one kept. */
function spHousePhotos_() {
  var out = {};
  try {
    listRows_('photos', {}).forEach(function (r) {
      if (String(r.hidden || '').toLowerCase() === 'true') return;
      var code = locationsHouseCode_(r.title);
      if (code && !out[code] && String(r.src || '')) out[code] = String(r.src);
    });
  } catch (e) { out = {}; }
  return out;
}

function spNotesSheet_(create) {
  return create ? hubTabEnsure_(SP_NOTES_TAB, SP_NOTES_HEADER) : hubTabSheet_(SP_NOTES_TAB);
}

function spVisitsSheet_(create) {
  return create ? hubTabEnsure_(SP_VISITS_TAB, SP_VISITS_HEADER) : hubTabSheet_(SP_VISITS_TAB);
}

/** A tab of ours as rows for one staff key; [] while the tab is unborn. */
function spOwnRows_(sheet, key) {
  if (!sheet) return [];
  return locationsTabRows_(sheet).filter(function (r) { return String(r.staff_key || '') === key; });
}

/** Named columns of a tab, each read on its own; a header not there reads as blanks. */
function spReadColumns_(sheet, spec) {
  var last = sheet.getLastRow();
  var width = Math.max(1, sheet.getLastColumn());
  var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var n = Math.max(0, last - 1);
  var out = { n: n, cols: {}, found: {} };
  Object.keys(spec).forEach(function (id) {
    var names = spec[id].names || [];
    var at = -1;
    for (var i = 0; i < names.length && at === -1; i++) at = head.indexOf(names[i]);
    if (at === -1 && spec[id].at !== undefined && spec[id].at < head.length) at = spec[id].at;
    out.found[id] = at !== -1;
    if (at === -1 || !n) { out.cols[id] = []; return; }
    out.cols[id] = sheet.getRange(2, at + 1, n, 1).getValues().map(function (row) { return row[0]; });
  });
  return out;
}

// ---- caching --------------------------------------------------------------

/** Keyed sp_<action>_<key>; the name carries the part and the versions of what it reads. A degraded answer is never kept. */
function staffProfilesCached_(action, key, part, depScopes, producer) {
  var scope = 'sp_' + action + '_' + key;
  var name = 'v1_' + String(part || 'all');
  (depScopes || []).forEach(function (s) {
    if (!s) return;
    try { name += '_' + cacheVersion_(s); } catch (e) { name += '_x'; }
  });
  var value = cacheRead_(scope, name, producer);
  if (value && value.degraded) cacheBump_(scope);
  return value;
}

function staffProfilesBump_(action, key) {
  cacheBump_('sp_' + action + '_' + key);
}

function spIstScope_() {
  try { return cacheScope_('ist_records'); } catch (e) { return ''; }
}

function spIncidentsScope_() {
  try { return locationsEstateScope_('uiIncidents'); } catch (e) { return ''; }
}

/** One read's answer: 503 names the source when the build throws. */
function spServe_(action, ctx, part, deps, what, build) {
  try {
    var data = staffProfilesCached_(action, ctx.key, part, deps, function () { return spScrub_(build()); });
    return { status: 200, data: data };
  } catch (e) {
    return { status: 503, message: what + ' could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

// ---- what the edit door reads back ------------------------------------------

/** Every Master field some section edits. */
function spEditMasterIds_() {
  var out = [];
  Object.keys(SP_EDIT_SECTIONS).forEach(function (s) {
    SP_EDIT_SECTIONS[s].forEach(function (f) { if (SP_EDIT_ACCOUNT.indexOf(f) === -1 && out.indexOf(f) === -1) out.push(f); });
  });
  return out;
}

/** An account's contact fields as one line each: the text the panel edits and the witness compares. */
function spAccountEditRaw_(a) {
  return {
    account_phones: (a.phones || []).map(function (p) { return p.label + ': ' + p.value; }).join(', '),
    account_emails: (a.emails || []).join(', '),
    avatar: String(a.avatar || ''),
    login_email: String(a.email || '')
  };
}

/** { field: raw } for what a section edits, as the door's witness reads it; a field with no store is left out. */
function spEditRaw_(ctx, section) {
  var out = {};
  var acct = ctx.account ? spAccountEditRaw_(ctx.account) : null;
  (SP_EDIT_SECTIONS[section] || []).forEach(function (f) {
    if (SP_EDIT_ACCOUNT.indexOf(f) !== -1) {
      if (acct) out[f] = acct[f];
      else if (f === 'avatar' && ctx.people && ctx.people.id) out[f] = String(ctx.people.avatar || '');
      return;
    }
    if (ctx.master_edit && spOwn_(ctx.master_edit, f)) out[f] = ctx.master_edit[f];
  });
  return out;
}

/** A read's answer with the raw values its section edits, for the master alone; never cached. */
function spWithEdit_(res, ctx, user, section) {
  if (!res || res.status !== 200 || !staffProfilesMaster_(user)) return res;
  var data = {};
  Object.keys(res.data || {}).forEach(function (k) { data[k] = res.data[k]; });
  data.edit = spScrub_(spEditRaw_(ctx, section));
  return { status: 200, data: data };
}

// ---- the roster -----------------------------------------------------------

function spRosterBuild_(withInactive) {
  var why = [];
  var roster = null, mi = null;
  try { roster = spRosterIndex_(); } catch (eR) { why.push(spWhy_('the People roster', eR)); }
  try { mi = spMasterIndex_(); } catch (eM) { why.push(spWhy_('the Employee Database Master', eM)); }
  if (!roster && !mi) throw new Error(why.join('; '));
  var byMail = {}, byName = {};
  try {
    usersAll_().forEach(function (u) {
      if (str_(u.mergedinto) || str_(u.clientkey)) return;
      var em = str_(u.email).toLowerCase();
      if (em && !byMail[em]) byMail[em] = u;
      var k = clientNameKey_(str_(u.displayname));
      if (k) (byName[k] = byName[k] || []).push(u);
    });
  } catch (eU) { why.push(spWhy_('the accounts', eU)); }
  var photos = {};
  try { photos = clientPhotoIndex_(); } catch (eP) { photos = {}; }
  var istAvatar = {};
  try {
    spIstRows_().forEach(function (r) {
      var k = clientNameKey_(r.staffName);
      if (k && !istAvatar[k] && String(r.avatar || '')) istAvatar[k] = String(r.avatar);
    });
  } catch (eI) { istAvatar = {}; }
  var keys = {};
  if (roster) Object.keys(roster.byKey).forEach(function (k) { keys[k] = true; });
  if (mi) Object.keys(mi.rows).forEach(function (k) { keys[k] = true; });
  var staff = [], counts = { active: 0, inactive: 0, ambiguous: 0 };
  Object.keys(keys).forEach(function (k) {
    var rows = roster ? (roster.byKey[k] || []) : [];
    var m = mi ? mi.rows[k] : null;
    var mf = m && !m.ambiguous ? m.fields : null;
    var ambiguous = rows.length > 1 || (!rows.length && !!m && m.ambiguous);
    var p = rows.length === 1 ? rows[0] : null;
    var name = (p && spText_(p.name)) || (m && m.name) || (rows[0] && spText_(rows[0].name)) || k;
    var status = ambiguous ? 'other' : spStatusOf_(p, mf);
    if (ambiguous) counts.ambiguous++;
    if (status === 'inactive') counts.inactive++; else counts.active++;
    if (status === 'inactive' && !withInactive) return;
    var acct = null;
    [p && p.email, mf && mf.email].forEach(function (e) {
      var em = String(e || '').trim().toLowerCase();
      if (!acct && em && byMail[em]) acct = byMail[em];
    });
    if (!acct && byName[k] && byName[k].length === 1) acct = byName[k][0];
    var parts = name.split(' ');
    var row = {
      key: k, name: name,
      first_name: spText_((p && p.first_name) || (mf && mf.first_name) || parts[0]),
      last_name: spText_((p && p.last_name) || (mf && mf.last_name) || parts.slice(1).join(' ')),
      status: status, role: spText_((p && p.role) || (acct && acct.role) || ''),
      avatar: (acct && str_(acct.avatar)) || (p && String(p.avatar || '')) || photos[k] || istAvatar[k] || '',
      employee_id: (mf && mf.employee_id) || (p && String(p.employee_id || '')) || ''
    };
    if (ambiguous) row.ambiguous = true;
    staff.push(row);
  });
  staff.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { staff: staff, counts: counts, why: why.join('; '), degraded: why.length > 0 };
}

/** The whole roster as `view` 'full'; a narrowed viewer's as 'basic': the staff their houses see, name, photo and role. */
function spRosterFor_(data, gate) {
  if (!spBasicGate_(gate)) {
    var whole = {};
    Object.keys(data || {}).forEach(function (k) { whole[k] = data[k]; });
    whole.view = 'full';
    return whole;
  }
  var seen = spVisibleTo_(gate.scope);
  var counts = { active: 0, inactive: 0, ambiguous: 0 };
  var staff = ((data && data.staff) || []).filter(function (r) { return seen.keys[r.key]; }).map(function (r) {
    if (r.ambiguous) counts.ambiguous++;
    if (r.status === 'inactive') counts.inactive++; else counts.active++;
    var o = { key: r.key, name: r.name, first_name: r.first_name, last_name: r.last_name, status: r.status, role: r.role,
              avatar: r.avatar };
    if (r.ambiguous) o.ambiguous = true;
    return o;
  });
  var short = seen.short || !!(data && data.degraded);
  return { staff: staff, counts: counts, view: 'basic', degraded: short,
           why: short ? 'Not every record of who works at your house could be read just now, so this list may be short.' : '' };
}

HUB_POLICY.staffProfileRoster = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { show_inactive: {} }
};
/** The switcher: every staff member from People and the Employee Database Master; inactive ones only when asked. */
HUB_ACTIONS.staffProfileRoster = function (payload, user) {
  var gate = staffProfilesGate_(user);
  if (!gate.open) return staffProfilesUnknown_();
  var raw = payload && payload.show_inactive;
  var withInactive = raw === true || /^(true|1|yes|on)$/i.test(String(raw == null ? '' : raw));
  var res = spRosterAnswer_(gate, withInactive);
  // who may assign training here: anyone ('any'), or only the viewer's own record (self_key)
  if (res.status === 200 && res.data && !spBasicGate_(gate)) {
    res.data.may = { assign: spTrainingAssigner_(user, '') ? 'any' : '', self_key: spSelfKey_(user) };
  }
  return res;
};

/** The switcher's answer for this gate: the roster as spRosterFor_ cuts it, or a 503 naming why. */
function spRosterAnswer_(gate, withInactive) {
  try {
    var data = staffProfilesCached_('staffProfileRoster', 'all', withInactive ? 'inactive' : 'active', [], function () {
      return spScrub_(spRosterBuild_(withInactive));
    });
    return { status: 200, data: spRosterFor_(data, gate) };
  } catch (e) {
    return { status: 503, message: 'The staff list could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
}

// ---- shifts ---------------------------------------------------------------

/** One person's days: Calendar Archive rows and PSI punches filtered by the folded name; the client names on the punches ride along. */
function spShiftsBuild_(ctx) {
  var today = locationsToday_();
  var since = locationsDayShift_(today, -SP_SHIFT_PAST_DAYS);
  var leadSince = locationsDayShift_(today, -SP_CLIENT_DAYS);
  var got = locationsCalendar_();
  var psi = locationsPunches_();
  var hmCodes = {};
  try {
    var mgr = hubCalendarManagers_() || {};
    (mgr[hubNameFold_(ctx.name)] || []).forEach(function (loc) { var c = locationsCode_(loc); if (c) hmCodes[c] = true; });
  } catch (eH) { hmCodes = {}; }
  var houses = {}, days = {}, upcoming = [], consumers = {}, archiveDays = {};
  var counts = { archive: 0, punches: 0 };
  var house = function (code) {
    return houses[code] = houses[code] || { code: code, days: {}, first_day: '', last_day: '', hm: !!hmCodes[code],
                                            lead: false, upcoming: false };
  };
  var mark = function (code, day) {
    var h = house(code);
    h.days[day] = true;
    if (!h.first_day || day < h.first_day) h.first_day = day;
    if (!h.last_day || day > h.last_day) h.last_day = day;
  };
  if (got.cal && got.cal.values) {
    var values = got.cal.values, tz = got.cal.tz;
    var head = (values[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
    var col = function (names, fb) {
      for (var i = 0; i < names.length; i++) { var at = head.indexOf(names[i]); if (at !== -1) return at; }
      return fb;
    };
    var cLoc = col(['location'], 0), cName = col(['employee'], 1), cDes = col(['designation'], 2), cDate = col(['date'], 4);
    var cStart = col(['start time', 'start', 'shift start', 'time in', 'shift'], -1);
    var cEnd = col(['end time', 'end', 'shift end', 'time out'], -1);
    for (var r = 1; r < values.length; r++) {
      var line = values[r] || [];
      var day = commBroadcastDay_(line[cDate], tz);
      if (day) archiveDays[day] = true;
      if (clientNameKey_(line[cName]) !== ctx.key || !day) continue;
      var code = locationsCode_(line[cLoc]);
      if (!code) continue;
      var des = String(line[cDes] || '').trim();
      var start = cStart === -1 ? '' : spTime_(line[cStart], tz), end = cEnd === -1 ? '' : spTime_(line[cEnd], tz);
      counts.archive++;
      if (day > today) {
        house(code).upcoming = true;
        upcoming.push({ date: day, house: code, start: start, end: end });
        continue;
      }
      mark(code, day);
      if (des === '***' && day >= leadSince) house(code).lead = true;
      if (day >= since) {
        var k1 = day + '|' + code;
        var e1 = days[k1] || (days[k1] = { date: day, house: code, start: start, end: end, designation: '', source: 'archive' });
        if (des === '**') e1.designation = 'hm';
        else if (des === '***' && !e1.designation) e1.designation = 'lead';
      }
    }
  }
  if (psi.rows) {
    var places = locationsPsiPlaces_(psi.rows);
    psi.rows.forEach(function (p) {
      var who = spText_(p.employee) || spText_(String(p.firstname || '') + ' ' + String(p.lastname || ''));
      if (clientNameKey_(who) !== ctx.key) return;
      var code = locationsCode_(p.house) || places[locationsLocKey_(p.location_name)] || '';
      var day = commBroadcastDay_(p.date_iso, 'America/New_York') || commBroadcastDay_(p.date_service, 'America/New_York');
      if (!code || !day || day > today) return;
      counts.punches++;
      mark(code, day);
      [p.consumer_1, p.consumer_2, p.consumer_3].forEach(function (c) { var n = spText_(c, 120); if (n) consumers[n] = true; });
      if (day < since) return;
      var k2 = day + '|' + code;
      var start = spTime_(p.start_time), end = spTime_(p.end_time);
      var e2 = days[k2];
      if (!e2) { days[k2] = { date: day, house: code, start: start, end: end, designation: '', source: 'punches' }; return; }
      var firstPunch = e2.source !== 'punches';
      e2.source = 'punches';
      if (start && (firstPunch || !e2.start || start < e2.start)) e2.start = start;
      if (end && (firstPunch || !e2.end || end > e2.end)) e2.end = end;
    });
  }
  var homes = {}, homesWhy = '';
  try { (locationsHomes_() || []).forEach(function (h) { homes[h.code] = h; }); }
  catch (eHm) { homesWhy = spWhy_('the house registry', eHm); }
  var photos = spHousePhotos_();
  var recent = locationsDayShift_(today, -SP_CURRENT_DAYS);
  var houseList = Object.keys(houses).map(function (code) {
    var h = houses[code], home = homes[code] || {};
    return { code: code, home_name: home.home_name || '', address: home.address || '',
             // a photo uploaded from Locations comes before the Image Bank's
             photo: (locationsHouseImage_(home.thumbnail_url, code) ? home.thumbnail_url : '') || photos[code] ||
                    home.thumbnail_url || '', current: h.upcoming || (!!h.last_day && h.last_day >= recent),
             days: Object.keys(h.days).length, first_day: h.first_day, last_day: h.last_day, hm: h.hm, lead: h.lead };
  }).sort(function (a, b) {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.last_day === b.last_day ? a.code.localeCompare(b.code) : (a.last_day < b.last_day ? 1 : -1);
  });
  upcoming.sort(function (a, b) { return a.date === b.date ? a.house.localeCompare(b.house) : (a.date < b.date ? -1 : 1); });
  var pat = {};
  upcoming.forEach(function (u) {
    var k = u.house + '|' + u.start + '|' + u.end;
    var g = pat[k] || (pat[k] = { house: u.house, weekdays: {}, start: u.start, end: u.end, from: u.date, to: u.date });
    g.weekdays[spWeekday_(u.date)] = true;
    if (u.date > g.to) g.to = u.date;
  });
  var order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var patterns = Object.keys(pat).map(function (k) {
    var g = pat[k];
    return { house: g.house, weekdays: order.filter(function (d) { return g.weekdays[d]; }), start: g.start, end: g.end,
             from: g.from, to: g.to };
  }).sort(function (a, b) { return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0); });
  var dayList = Object.keys(days).map(function (k) { return days[k]; }).sort(function (a, b) {
    return a.date === b.date ? a.house.localeCompare(b.house) : (a.date < b.date ? 1 : -1);
  });
  var why = [got.why, psi.why, homesWhy].filter(String);
  return {
    shifts: {
      houses: houseList, days: dayList, upcoming: upcoming, patterns: patterns,
      sources: { archive: { readable: !!got.cal, why: got.why || '', rows: counts.archive },
                 punches: { readable: !!psi.rows, why: psi.why || '', rows: counts.punches } },
      gaps: spGaps_(archiveDays, SP_GAP_DAYS), why: why.join('; '), degraded: !got.cal || !psi.rows
    },
    consumers: Object.keys(consumers), degraded: !got.cal || !psi.rows
  };
}

function spShiftFacts_(ctx) {
  return staffProfilesCached_('staffProfileShifts', ctx.key, 'facts', [], function () {
    return spScrub_(spShiftsBuild_(ctx));
  });
}

HUB_POLICY.staffProfileShifts = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Where they worked: every house with first and last day, the last months day by day, and what is scheduled ahead. */
HUB_ACTIONS.staffProfileShifts = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  try { return { status: 200, data: spShiftFacts_(ctx).shifts }; }
  catch (e) {
    return { status: 503, message: 'The shifts could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
};

// ---- overview -------------------------------------------------------------

/** Every phone and e-mail on its own line: the account's, then People's, then the Master's; one per number or address. */
function spContacts_(ctx) {
  var phones = [], emails = [], seenP = {}, seenE = {};
  var addP = function (label, value) {
    var v = spText_(value, 40);
    var k = spDigits10_(v) || v.replace(/\D/g, '');
    if (!v || !k || seenP[k]) return;
    seenP[k] = true;
    phones.push({ label: spText_(label, 24) || 'Phone', value: v });
  };
  var addE = function (label, value) {
    var v = spText_(value, 120);
    var k = v.toLowerCase();
    if (!v || v.indexOf('@') === -1 || seenE[k]) return;
    seenE[k] = true;
    emails.push({ label: label, value: v });
  };
  var a = ctx.account, p = ctx.people, m = ctx.master;
  if (a) {
    (a.phones || []).forEach(function (x) { addP(x.label, x.value); });
    addP('Phone', a.phone);
    addE('Sign-in', a.email);
    (a.emails || []).forEach(function (e) { addE('Email', e); });
  }
  if (p) {
    addP('Phone', p.phone);
    ((Array.isArray(p.phones)) ? p.phones : []).forEach(function (x) { addP('Phone', x); });
    addE('Email', p.email);
    ((Array.isArray(p.emails)) ? p.emails : []).forEach(function (e) { addE('Email', e); });
  }
  if (m) {
    addP('Phone', m.phone);
    addE('Email', m.email);
  }
  return { phones: phones, emails: emails };
}

function spIstMine_(ctx) {
  return spIstRows_().filter(function (r) { return clientNameKey_(r.staffName) === ctx.key; });
}

function spIstCell_(r, clientByKey) {
  var c = clientByKey[clientNameKey_(r.clientName)] || null;
  var st = locationsCell_(r.status).toLowerCase();
  return { id: locationsCell_(r.id), client_key: c ? c.client_key : '', client_name: spText_(r.clientName),
           house: locationsHouseCode_(r.house) || spText_(r.house), status: st === 'done' ? 'done' : 'owed',
           due: spDay_(locationsCell_(r.dueDate)), trained_at: spDay_(locationsCell_(r.trainedAt)),
           doc_id: locationsCell_(r.docFileId) || null };
}

// ---- driving and MAIS -----------------------------------------------------

var SP_DRIVER_TAB = 'employee driver';
var SP_DRIVER_COMPLIANCE_TAB = 'Driver Compliance';
// The only columns a driving tab keeps. SSN# and Date of Birth are never kept; the DL # is masked where it is read.
var SP_DRIVER_FIELDS = [
  { id: 'employee', headers: ['Employee'] },
  { id: 'first_name', headers: ['First Name'] },
  { id: 'last_name', headers: ['Last Name'] },
  { id: 'driver', headers: ['Driver'] },
  { id: 'dl', headers: ['DL #', 'DL#'] },
  { id: 'points', headers: ['Points'] },
  { id: 'license_exp', headers: ['License Exp Date'] },
  { id: 'abstract_original', headers: ["Driver's Abstract (Original)"] },
  { id: 'abstract_latest', headers: ["Driver's Abstract (Latest)", 'Drivers Abstract Latest'] },
  { id: 'insurance_exp', headers: ['Insurance Exp Date', 'Insurance Expiration'] }
];
// The MAIS scrape's columns read beside ist_cert_source_fields; DD ID only tells two registry records apart.
var SP_MAIS_SEARCH = 'search_first+search_last';
var SP_MAIS_EFFECTIVE = 'effective|effective_date';
var SP_MAIS_ID = 'dd_id';
var SP_MAIS_STAMP = 'timestamp';

/** A date cell as a day; words that are not a whole date ("9/23") are kept as written; blank, n/a or a bad Date is ''. */
function spDayOrWords_(v, tz) {
  var d = spDay_(v, tz);
  return (d || v instanceof Date || spIsNa_(v)) ? d : spText_(v, 40);
}

/** The pill state of a day on the Staff Compliance clock; words that are not a day, or no clock, say nothing. */
function spDayState_(day, today, windowDays) {
  return today && /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? spDateState_(day, windowDays, today) : '';
}

/** A Points cell: a number, or null with the cell's own words ("CANT CHECK"); blank or n/a is null with none. */
function spPoints_(v) {
  if (typeof v === 'number') return { n: isFinite(v) ? v : null, note: '' };
  var s = spText_(v, 40);
  if (!s || spIsNa_(s)) return { n: null, note: '' };
  return /^\d+(\.\d+)?$/.test(s) ? { n: Number(s), note: '' } : { n: null, note: s };
}

/** The Driver cell as a fact: blank says nothing, No or n/a is not a driver, any other word is a driver on file. */
function spDriverYes_(word) {
  var s = spText_(word);
  if (!s) return null;
  return /^(no|none|not a driver)$/i.test(s) || spIsNa_(s) ? false : true;
}

/** A licence's standing word, as written, with the state the pill reads and the tab that said it. */
function spStanding_(word, source) {
  var w = spText_(word, 60);
  var s = w.toLowerCase();
  var state = /suspend|fail|reinstat|revok|expir|cancel|invalid|denied|restrict/.test(s) ? 'invalid'
    : (/^(yes|valid|active|current|ok)$/.test(s) ? 'valid' : (/^(no|none)$/.test(s) || spIsNa_(w) ? 'none' : 'other'));
  return { word: w, state: state, source: source };
}

// A driving tab keyed by the folded Employee cell and by First + Last.
function spDriverIndexFrom_(values, tz) {
  var out = { rows: {}, missing: [] };
  var head = ((values && values[0]) || []).map(spHead_);
  var col = {};
  SP_DRIVER_FIELDS.forEach(function (f) {
    for (var a = 0; a < f.headers.length && col[f.id] === undefined; a++) {
      var at = head.indexOf(spHead_(f.headers[a]));
      if (at !== -1) col[f.id] = at;
    }
    if (col[f.id] === undefined) out.missing.push(f.id);
  });
  var cell = function (line, id) { return col[id] === undefined ? '' : line[col[id]]; };
  for (var r = 1; r < (values || []).length; r++) {
    var line = values[r] || [];
    var pts = spPoints_(cell(line, 'points'));
    var fields = {
      driver: spText_(cell(line, 'driver'), 60), dl_last4: spLicenceMask_(cell(line, 'dl'), ''), points: pts.n,
      points_note: pts.note, license_exp: spDayOrWords_(cell(line, 'license_exp'), tz),
      abstract_original: spDayOrWords_(cell(line, 'abstract_original'), tz),
      abstract_latest: spDayOrWords_(cell(line, 'abstract_latest'), tz), insurance_exp: spDayOrWords_(cell(line, 'insurance_exp'), tz)
    };
    var said = fields.driver || fields.dl_last4 || fields.points !== null || fields.points_note ||
               fields.license_exp || fields.abstract_original || fields.abstract_latest || fields.insurance_exp;
    if (!said) continue;
    var keys = [];
    [spText_(String(cell(line, 'first_name') || '') + ' ' + String(cell(line, 'last_name') || '')), spText_(cell(line, 'employee'))]
      .forEach(function (n) { var k = clientNameKey_(n); if (k && keys.indexOf(k) === -1) keys.push(k); });
    keys.forEach(function (k) {
      out.rows[k] = spOwn_(out.rows, k) ? { ambiguous: true, fields: {} } : { ambiguous: false, fields: fields, row: r };
    });
  }
  out.cols = col;
  return out;
}

/** A driving tab's masked index, cached on the tab. Throws when the book or the tab cannot be read. */
function spDriverIndex_(tab) {
  var id = String(empDbId_() || '');
  if (!id) throw new Error('CERT_SOURCE_ID is not set');
  return cacheRead_(cacheScopeSheet_(id, tab), 'sp_driver_v1', function () {
    var ss = ssOpen_(id);
    var sheet = ss.getSheetByName(tab);
    if (!sheet) throw new Error('the Employee Database has no ' + tab + ' tab');
    var tz = '';
    try { tz = String(ss.getSpreadsheetTimeZone() || ''); } catch (eT) { tz = ''; }
    return spDriverIndexFrom_(sheet.getDataRange().getValues(), tz || 'America/New_York');
  });
}

// The person's driving record from two reads ({ index, why }): employee driver for the facts, Driver Compliance for…
function spDrivingFrom_(key, main, comp, today, windowDays) {
  var out = { found: false, ambiguous: false, driver: null, driver_word: '', driver_standing: null, points: null,
              points_note: '', license_expires: '', license_state: '', abstract_original: '', abstract_latest: '',
              insurance_expires: '', insurance_state: '', license_standing: null, standing_ambiguous: false, dl_last4: '',
              source: '', unread: [], why: '', degraded: false };
  var why = [];
  var unread = function (tab, line) { why.push(line); out.unread.push(tab); out.degraded = true; return null; };
  var pick = function (read, tab, matter) {
    if (!read || !read.index) return unread(tab, (read && read.why) || 'the ' + tab + ' tab could not be read');
    var missing = read.index.missing || [];
    if (missing.indexOf('employee') !== -1 && (missing.indexOf('first_name') !== -1 || missing.indexOf('last_name') !== -1)) {
      return unread(tab, 'the ' + tab + ' tab has no Employee or First and Last Name column, so no row can be matched');
    }
    var gone = missing.filter(function (id) { return matter.indexOf(id) !== -1; });
    if (gone.length) why.push('the ' + tab + ' tab has no column for ' + gone.join(', '));
    var hit = spOwn_(read.index.rows, key);
    if (hit && hit.ambiguous) { why.push('two rows of the ' + tab + ' tab carry this name, so neither is read'); return 'ambiguous'; }
    return hit ? hit.fields : null;
  };
  var m = pick(main, SP_DRIVER_TAB, ['driver', 'dl', 'points', 'license_exp', 'abstract_original', 'abstract_latest',
                                     'insurance_exp']);
  var c = pick(comp, SP_DRIVER_COMPLIANCE_TAB, ['driver']);
  if (m === 'ambiguous') { out.ambiguous = true; m = null; }
  if (c === 'ambiguous') { out.standing_ambiguous = true; c = null; }
  var row = out.ambiguous ? null : (m || c);
  if (row) {
    out.found = true;
    out.source = m ? SP_DRIVER_TAB : SP_DRIVER_COMPLIANCE_TAB;
    out.driver_word = row.driver || '';
    out.driver = spDriverYes_(row.driver);
    out.points = row.points === undefined ? null : row.points;
    out.points_note = row.points_note || '';
    out.license_expires = row.license_exp || '';
    out.abstract_original = row.abstract_original || '';
    out.abstract_latest = row.abstract_latest || '';
    out.insurance_expires = row.insurance_exp || '';
    out.dl_last4 = row.dl_last4 || '';
  }
  if (!out.ambiguous) {
    var own = m && m.driver && !/^(yes|no)$/i.test(m.driver) && !spIsNa_(m.driver) ? spStanding_(m.driver, SP_DRIVER_TAB) : null;
    if (c && c.driver) {
      out.license_standing = spStanding_(c.driver, SP_DRIVER_COMPLIANCE_TAB);
      if (own && own.word.toLowerCase() !== out.license_standing.word.toLowerCase()) out.driver_standing = own;
    } else {
      out.license_standing = own;
    }
  }
  out.license_state = spDayState_(out.license_expires, today, windowDays);
  out.insurance_state = spDayState_(out.insurance_expires, today, windowDays);
  out.why = why.filter(String).join('; ');
  return out;
}

function spDrivingPart_(key, today, windowDays) {
  var read = function (tab) {
    try { return { index: spDriverIndex_(tab), why: '' }; }
    catch (e) { return { index: null, why: spWhy_('the ' + tab + ' tab', e) }; }
  };
  return spDrivingFrom_(key, read(SP_DRIVER_TAB), read(SP_DRIVER_COMPLIANCE_TAB), today, windowDays);
}

/** A MAIS cell as a day: an instant certReadTab_ wrote is read on the Ohio clock; a US or ISO date as written. */
function spMaisDay_(v) {
  var s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return spDay_(d, 'America/New_York');
  }
  return spDay_(s);
}

/** "Cat - III" ranks 3: its trailing roman or arabic number; 99 when it has none. */
function spMaisRank_(level) {
  var m = /(?:^|[\s\-])([ivx]+|\d+)\s*$/i.exec(String(level == null ? '' : level).trim());
  if (!m) return 99;
  if (/^\d+$/.test(m[1])) return Number(m[1]);
  var val = { i: 1, v: 5, x: 10 }, s = m[1].toLowerCase(), n = 0;
  for (var i = 0; i < s.length; i++) {
    var cur = val[s.charAt(i)], next = val[s.charAt(i + 1)] || 0;
    n += cur < next ? -cur : cur;
  }
  return n;
}

function spCmp_(a, b) {
  a = String(a || ''); b = String(b || '');
  return a < b ? -1 : (a > b ? 1 : 0);
}

/** Whether the scrape's row carries a certFieldOf_ spec's columns: one `|` alternative with every `+` part a header. */
function spMaisHas_(row, spec) {
  return String(spec || '').split('|').some(function (alt) {
    return alt.split('+').every(function (c) { return Object.prototype.hasOwnProperty.call(row || {}, String(c).trim()); });
  });
}

// The person's MAIS certifications from the scrape's rows (certReadTab_'s shape): matched by the registry's Name…
function spMaisSpecs_() {
  return { name: certSourceField_('mais.name') || 'name', status: certSourceField_('mais.status') || 'status',
           expires: certSourceField_('mais.expires') || 'expiration', level: certSourceField_('mais.category') || 'cert_type' };
}

function spMaisFrom_(rows, key, today, windowDays) {
  var F = spMaisSpecs_();
  var out = { certs: [], history: 0, matched_by: '', ambiguous: false, source: '', why: '', degraded: false };
  var first = (rows || [])[0];
  if (first) {
    var lacks = function (spec) { return !spMaisHas_(first, spec); };
    var gone = [], blind = false;
    if (lacks(F.name) && lacks(SP_MAIS_SEARCH)) { gone.push(F.name + ' or ' + SP_MAIS_SEARCH); blind = true; }
    if (lacks(SP_MAIS_ID)) { gone.push(SP_MAIS_ID); blind = true; }
    if (lacks(F.status)) { gone.push(F.status); blind = true; }
    [F.level, F.expires, SP_MAIS_EFFECTIVE].forEach(function (spec) { if (lacks(spec)) gone.push(spec); });
    if (gone.length) {
      out.why = 'the MAIS scrape has no column for ' + gone.join(', ') + (blind ? ', so no certification is shown' : '');
      out.degraded = true;
      if (blind) return out;
    }
  }
  var byName = [], bySearch = [];
  (rows || []).forEach(function (r) {
    var viaName = clientNameKey_(certFieldOf_(r, F.name)) === key;
    if (!viaName && clientNameKey_(certFieldOf_(r, SP_MAIS_SEARCH)) !== key) return;
    var word = certFieldOf_(r, F.status);
    var state = certStateOf_('ist_cert_mais_statuses', word, 'expired');
    if (state === 'skip') return;
    (viaName ? byName : bySearch).push({
      level: spText_(certFieldOf_(r, F.level), 40), effective: spMaisDay_(certFieldOf_(r, SP_MAIS_EFFECTIVE)),
      expires: spMaisDay_(certFieldOf_(r, F.expires)), certified: state === 'certified', word: spText_(word, 60),
      id: certFieldOf_(r, SP_MAIS_ID), stamp: certFieldOf_(r, SP_MAIS_STAMP), row: r._row });
  });
  var idsOf = function (list) {
    var o = {};
    list.forEach(function (x) { if (x.id) o['i:' + x.id] = true; });
    return o;
  };
  var nameIds = idsOf(byName), searchIds = idsOf(bySearch);
  // another person's registry name can fold to this key: it stands only when this person's own search found that record
  if (byName.length && Object.keys(searchIds).length &&
      !Object.keys(nameIds).some(function (k) { return !!spOwn_(searchIds, k); })) {
    out.ambiguous = true;
    out.why = [out.why, 'the registry name and the searched name point at different DODD records, so none is shown']
      .filter(String).join('; ');
    return out;
  }
  var mine = byName.length ? byName : bySearch;
  out.matched_by = byName.length ? 'name' : (bySearch.length ? 'search' : '');
  var n = Object.keys(byName.length ? nameIds : searchIds).length;
  if (n > 1) {
    out.ambiguous = true;
    out.why = [out.why, n + ' DODD registry records (different DD IDs) carry this name, so none is shown'].filter(String).join('; ');
    return out;
  }
  var groups = {}, order = [];
  mine.forEach(function (x) {
    var g = 'l:' + x.level;
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(x);
  });
  out.certs = order.map(function (g) {
    var seen = {};
    var list = groups[g].slice().sort(function (a, b) {
      return spCmp_(b.expires, a.expires) || spCmp_(b.effective, a.effective) || spCmp_(b.stamp, a.stamp);
    }).filter(function (x) {
      // the same record scraped again is one record, and its newest scrape speaks
      var k = 'r:' + x.id + '|' + x.effective + '|' + x.expires;
      if (spOwn_(seen, k)) return false;
      seen[k] = true;
      return true;
    });
    var top = list[0];
    var expired = !top.certified || (!!top.expires && top.expires < today);
    var cert = { level: top.level || 'Not stated', effective: top.effective, expires: top.expires,
                 status: top.certified ? 'certified' : 'expired', word: top.word, expired: expired,
                 due_soon: !expired && spDayState_(top.expires, today, windowDays) === 'due_soon', older: list.length - 1 };
    // the edit door's live read numbers its rows; a cached read never carries one
    if (top.row !== undefined) cert.row = top.row;
    return cert;
  }).sort(function (a, b) { return (spMaisRank_(a.level) - spMaisRank_(b.level)) || spCmp_(a.level, b.level); });
  out.history = out.certs.reduce(function (sum, c) { return sum + c.older; }, 0);
  return out;
}

function spMaisPart_(key, today, windowDays) {
  var tab = '', rows = null;
  try {
    tab = certSourceTab_('mais');
    rows = certReadTab_(tab);
  } catch (e) {
    return { certs: [], history: 0, matched_by: '', ambiguous: false, source: tab,
             why: spWhy_('the ' + (tab || 'MAIS') + ' tab', e), degraded: true };
  }
  var out = spMaisFrom_(rows, key, today, windowDays);
  out.source = tab;
  // certReadTab_ reads a missing or renamed tab as no rows: that is unread, never "no MAIS record"
  if (!(rows || []).length) { out.why = 'the ' + tab + ' tab read no rows (missing, renamed or empty)'; out.degraded = true; }
  return out;
}

function spOverviewBuild_(ctx) {
  var why = [ctx.roster_why, ctx.master_why, ctx.account_why].filter(String);
  var degraded = !!ctx.roster_why || (!ctx.master_read);
  var m = ctx.master || {}, p = ctx.people || {}, a = ctx.account || {};
  var facts = null;
  try { facts = spShiftFacts_(ctx); } catch (eS) { why.push(spWhy_('the shifts', eS)); degraded = true; }
  var shifts = facts ? facts.shifts : { houses: [], why: '' };
  if (facts && facts.degraded) degraded = true;
  var clientRows = null;
  try { clientRows = spClientRows_(); } catch (eC) { why.push(spWhy_('the clients', eC)); degraded = true; }
  var clientByKey = {};
  (clientRows || []).forEach(function (c) { var k = clientNameKey_(c.name); if (k && !clientByKey[k]) clientByKey[k] = c; });
  var ist = [], istRows = [];
  try { istRows = spIstMine_(ctx); } catch (eI) { why.push(spWhy_('the IST records', eI)); degraded = true; }
  ist = istRows.map(function (r) { return spIstCell_(r, clientByKey); })
    .sort(function (x, y) { return x.client_name.localeCompare(y.client_name); });
  var clients = {}, unknown = 0;
  var add = function (name, via) {
    var c = clientByKey[clientNameKey_(name)];
    if (!c) { if (clientRows) unknown++; return; }
    var o = clients[c.client_key] || (clients[c.client_key] = {
      client_key: c.client_key, client_id: c.client_id, name: c.name, avatar: c.avatar, house: c.house, via: [] });
    if (o.via.indexOf(via) === -1) o.via.push(via);
  };
  istRows.forEach(function (r) { add(r.clientName, 'ist'); });
  (facts ? facts.consumers : []).forEach(function (n) { add(n, 'punches'); });
  if (clientRows) {
    var recentDay = locationsDayShift_(locationsToday_(), -SP_CLIENT_DAYS);
    var homes = {};
    try { (locationsHomes_() || []).forEach(function (h) { homes[h.code] = h; }); } catch (eH) { homes = {}; }
    (shifts.houses || []).forEach(function (h) {
      if (!(h.current || (h.last_day && h.last_day >= recentDay))) return;
      locationsClientsAt_(h.code, homes[h.code] || null, clientRows).forEach(function (c) { add(c.name, 'house'); });
    });
  }
  if (unknown) why.push(unknown + ' client name(s) on the IST records or punches match no client record');
  var notesOpen = 0;
  try {
    notesOpen = spOwnRows_(spNotesSheet_(false), ctx.key).filter(function (n) { return (n.state || 'open') === 'open'; }).length;
  } catch (eN) { why.push(spWhy_('the staff notes', eN)); }
  var contacts = spContacts_(ctx);
  var empId = m.employee_id || '', empSrc = empId ? 'master' : '';
  if (!empId && p.employee_id) { empId = String(p.employee_id); empSrc = 'roster'; }
  var photos = {};
  try { photos = clientPhotoIndex_(); } catch (eP) { photos = {}; }
  var today = locationsToday_(), windowDays = 60;
  try { windowDays = certExpiringDays_(); } catch (eW) { windowDays = 60; }
  var driving = spDrivingPart_(ctx.key, today, windowDays);
  var medDel = spMaisPart_(ctx.key, today, windowDays);
  // each card says what it could not read; the page's banner only points at it
  if (driving.degraded) { why.push('the driving record is not read in full (see Driver)'); degraded = true; }
  if (medDel.degraded) { why.push('the MAIS record is not read in full (see Med Del (MAIS))'); degraded = true; }
  return {
    person: {
      key: ctx.key, name: ctx.name, first_name: ctx.first_name, last_name: ctx.last_name,
      employee_id: empId, employee_id_source: empSrc, roster_id: String(p.id || ''),
      role: spText_(p.role || a.role || ''), status: ctx.status,
      start_date: spDay_(m.start_first_day) || spDay_(m.start_doc) || spDay_(p.start_date),
      end_date: spDay_(m.end_last_day) || spDay_(p.end_date),
      avatar: a.avatar || String(p.avatar || '') || photos[ctx.key] || '',
      phones: contacts.phones, emails: contacts.emails
    },
    clients: Object.keys(clients).map(function (k) { return clients[k]; })
      .sort(function (x, y) { return x.name.localeCompare(y.name); }),
    houses: shifts.houses || [], ist: ist, notes_open: notesOpen, driving: driving, med_del: medDel,
    why: why.concat(shifts.why ? [shifts.why] : []).join('; '), degraded: degraded
  };
}

// BASIC, for a client or family viewer: name, photo, role or title, and the ISTs that train this person on the…
function spBasicBuild_(ctx, scope) {
  var p = ctx.people || {}, a = ctx.account || {};
  var photos = {};
  try { photos = clientPhotoIndex_(); } catch (eP) { photos = {}; }
  var mine = {};
  ((scope && scope.client_keys) || []).forEach(function (k) { if (k) mine[k] = true; });
  var ist = [], degraded = false;
  try {
    var clientByKey = {};
    spClientRows_().forEach(function (c) { var k = clientNameKey_(c.name); if (k && !clientByKey[k]) clientByKey[k] = c; });
    ist = spIstMine_(ctx).map(function (r) { return spIstCell_(r, clientByKey); })
      .filter(function (x) { return !!x.client_key && mine[x.client_key] === true; })
      .map(function (x) {
        return { id: x.id, client_key: x.client_key, client_name: x.client_name, house: x.house, status: x.status,
                 due: x.due, trained_at: x.trained_at };
      })
      .sort(function (x, y) { return x.client_name.localeCompare(y.client_name); });
  } catch (eI) { ist = []; degraded = true; }
  return {
    person: { key: ctx.key, name: ctx.name, first_name: ctx.first_name, last_name: ctx.last_name,
              role: spText_(p.role || a.role || ''), status: ctx.status,
              avatar: a.avatar || String(p.avatar || '') || photos[ctx.key] || '' },
    ist: ist, view: 'basic',
    why: degraded ? 'The trainings could not be read just now.' : '', degraded: degraded
  };
}

HUB_POLICY.staffProfileOverview = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Staff Profile: details with every phone and e-mail, the clients and houses they work with, their ISTs and open notes, the driving record and the MAIS certifications. */
HUB_ACTIONS.staffProfileOverview = function (payload, user) {
  var gate = staffProfilesGate_(user);
  if (!gate.open) return staffProfilesUnknown_();
  if (spBasicGate_(gate)) return spBasicAnswer_(payload && payload.staff, gate.scope);
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  return spWithEdit_(spServe_('staffProfileOverview', ctx, 'all', [spIstScope_()], 'The staff profile', function () {
    return spOverviewBuild_(ctx);
  }), ctx, user, 'profile');
};

/** A client or family viewer's Staff Profile answer for one staff key: the BASIC profile, or the refusal. */
function spBasicAnswer_(raw, scope) {
  var busy = { status: 503, message: 'The staff profile could not be read just now — try again in a minute.' };
  var seen = spBasicPerson_(raw, scope);
  // what the sources failed on is the team's to read, never this viewer's
  if (seen.refused) return seen.refused.status === 503 ? busy : seen.refused;
  try { return { status: 200, data: spScrub_(spBasicBuild_(seen, scope)) }; }
  catch (eB) { return busy; }
}

// ---- the relay's pack for a client ----------------------------------------

// Past this the pack starts no further profile, so it always answers inside the execution limit.
var SP_CLIENT_PACK_BUDGET_MS = 240000;

HUB_POLICY.staffClientPack = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { client: { type: 'string' } }
};
// The relay's pack for one client's own view of Staff: the roster and each BASIC profile, each the answer the Staff…
HUB_ACTIONS.staffClientPack = function (payload, user) {
  if (!user || !user.is_service) return staffProfilesUnknown_();
  var key = String(payload && payload.client != null ? payload.client : '').trim();
  if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(key)) return { status: 400, message: 'client: a client key.' };
  var started = Date.now();
  var heldLoc = LOCATION_PACK_MEMO_, heldClients = CLIENTS_DERIVED_MEMO_;
  LOCATION_PACK_MEMO_ = {};
  CLIENTS_DERIVED_MEMO_ = {};
  try {
    var gate = { open: true, scope: hubViewerClientScope_('client', { client_key: key }) };
    var week = hubStaffScheduledForHouses_(gate.scope.house_codes).week;
    var parts = {}, status = {};
    var take = function (name, got) {
      if (got && got.status === 200 && got.data !== undefined && got.data !== null) {
        parts[name] = got.data;
        status[name] = { status: 200 };
      } else {
        status[name] = { status: Number(got && got.status) || 503,
                         message: String((got && got.message) || 'This part did not answer.').slice(0, 200) };
      }
    };
    take('roster', spRosterAnswer_(gate, false));
    ((parts.roster && parts.roster.staff) || []).forEach(function (r) {
      var k = String((r && r.key) || '');
      if (r.ambiguous || !/^[a-z0-9]{3,80}$/.test(k)) return;
      if (Date.now() - started > SP_CLIENT_PACK_BUDGET_MS) {
        status['profile_' + k] = { status: 503, message: 'This part was not gathered in this pack; it is read on its own.' };
        return;
      }
      take('profile_' + k, spBasicAnswer_(k, gate.scope));
    });
    return { status: 200, data: { client: key, week: week, built_at: new Date(started).toISOString(), parts: parts,
                                  part_status: status } };
  } finally {
    LOCATION_PACK_MEMO_ = heldLoc;
    CLIENTS_DERIVED_MEMO_ = heldClients;
  }
};

// ---- the relay's pack for one staff member --------------------------------

// The audited reads (HR, Performance) and the words of calls and texts are never packed: each is read on its own.
var SP_PACK_PARTS = ['overview', 'edit_profile', 'notes', 'actions', 'activity', 'preferences', 'shifts', 'compliance',
                     'documents', 'employment', 'edit_employment'];

/** Each part exactly as its section door answers a whole viewer; `edit_*` the raw values the master's panels open on. */
function spPackDoors_(ctx) {
  var safe = function (what, fn) {
    try { return { status: 200, data: fn() }; }
    catch (e) { return { status: 503, message: what + ' could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' }; }
  };
  return {
    overview: function () {
      return spServe_('staffProfileOverview', ctx, 'all', [spIstScope_()], 'The staff profile', function () { return spOverviewBuild_(ctx); });
    },
    edit_profile: function () { return { status: 200, data: spScrub_(spEditRaw_(ctx, 'profile')) }; },
    notes: function () {
      return spServe_('staffProfileNotes', ctx, 'all', [], 'The staff notes', function () { return spNotesBuild_(ctx); });
    },
    actions: function () {
      return spServe_('staffProfileActions', ctx, 'all', [spIstScope_(), spMedDelScope_()], 'The pending items', function () {
        return spActionsBuild_(ctx);
      });
    },
    activity: function () {
      return spServe_('staffProfileActivity', ctx, 'all', [spIstScope_(), spIncidentsScope_()], 'The activity', function () {
        return spActivityBuild_(ctx);
      });
    },
    preferences: function () {
      spPrefsShareMaybe_();
      return spServe_('staffProfilePreferences', ctx, 'all', [spPrefsHomesScope_()], 'The preferences', function () {
        return spPrefsBuild_(ctx);
      });
    },
    shifts: function () { return safe('The shifts', function () { return spShiftFacts_(ctx).shifts; }); },
    compliance: function () {
      return spServe_('staffProfileCompliance', ctx, 'all', [spMedDelScope_()], 'The compliance record', function () {
        return spComplianceBuild_(ctx);
      });
    },
    documents: function () { return safe('The documents', function () { return spDocuments_(ctx); }); },
    employment: function () {
      return spServe_('staffProfileEmployment', ctx, 'all', [spIstScope_()], 'The employment record', function () {
        return spEmploymentBuild_(ctx);
      });
    },
    edit_employment: function () { return { status: 200, data: spScrub_(spEditRaw_(ctx, 'employment')) }; }
  };
}

HUB_POLICY.staffPack = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
// The relay's pack for one staff member: every whole section a viewer App Control releases Staff to reads, each its…
HUB_ACTIONS.staffPack = function (payload, user) {
  if (!user || !user.is_service) return staffProfilesUnknown_();
  var started = Date.now();
  var heldLoc = LOCATION_PACK_MEMO_, heldClients = CLIENTS_DERIVED_MEMO_;
  LOCATION_PACK_MEMO_ = {};
  CLIENTS_DERIVED_MEMO_ = {};
  try {
    var ctx = staffProfilesPerson_(payload && payload.staff);
    if (ctx.refused) return ctx.refused;
    var doors = spPackDoors_(ctx);
    var parts = {}, status = {};
    SP_PACK_PARTS.forEach(function (name) {
      if (Date.now() - started > SP_CLIENT_PACK_BUDGET_MS) {
        status[name] = { status: 503, message: 'This part was not gathered in this pack; it is read on its own.' };
        return;
      }
      var got;
      try { got = doors[name](); }
      catch (e) { got = { status: 503, message: 'This part could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' }; }
      if (got && got.status === 200 && got.data !== undefined && got.data !== null) {
        parts[name] = got.data;
        status[name] = { status: 200 };
      } else {
        status[name] = { status: Number(got && got.status) || 503,
                         message: String((got && got.message) || 'This part did not answer.').slice(0, 200) };
      }
    });
    return { status: 200, data: { staff: ctx.key, built_at: new Date(started).toISOString(), parts: parts,
                                  part_status: status } };
  } finally {
    LOCATION_PACK_MEMO_ = heldLoc;
    CLIENTS_DERIVED_MEMO_ = heldClients;
  }
};

// ---- documents ------------------------------------------------------------

function spDocCategory_(title, folder) {
  var f = String(folder || '').toLowerCase();
  if (/background/.test(f)) return 'background';
  if (/medical/.test(f)) return 'medical';
  if (/driv/.test(f)) return 'driving';
  if (/training/.test(f)) return 'training';
  var t = String(title || '').toLowerCase();
  if (/\bi-?9\b|social security|ss card|birth cert|passport|work auth/.test(t)) return 'work_authorization';
  if (/\bw-?4\b|pay\s*auth|direct deposit|tax/.test(t)) return 'tax';
  if (/driver|licen[sc]e|insurance|abstract|\boh id\b|state id/.test(t)) return 'driving';
  if (/bci|fbi|background|rapback|\bsam\b|\boig\b|registry|exclusion/.test(t)) return 'background';
  if (/\btb\b|physical|medical|immuni|vaccin|health/.test(t)) return 'medical';
  if (/dodd|cpr|first aid|med ?del|mandt|money|training|certificat|\bist\b|mais/.test(t)) return 'training';
  if (/r[eé]sum[eé]|application|attestation|hipaa|diploma|\bged\b|offer|hire/.test(t)) return 'hiring';
  return 'other';
}

/** The name as whole words in a title: "Ann Lee" is in "Ann Lee - I9.pdf", never in "Joann Lee" or "Ann Leeds". */
function spNameIn_(name, title) {
  var words = String(name == null ? '' : name).toLowerCase().trim().split(/\s+/).filter(String);
  if (!words.length) return false;
  var body = words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('\\s+');
  return new RegExp('(^|[^a-z0-9])' + body + '(?![a-z0-9])').test(String(title == null ? '' : title).toLowerCase());
}

/** The person's Drive folder in the staff documents room, three levels down, and the deep profile's folder. */
function spDriveDocs_(ctx) {
  var out = { files: [], why: [], failed: false };
  var walk = function (folder, top, depth) {
    var it = folder.getFiles();
    while (it.hasNext() && out.files.length < SP_DOC_CAP) {
      var f = it.next();
      out.files.push({ file_id: String(f.getId()), title: String(f.getName()), mime: String(f.getMimeType()),
                       date: spDay_(f.getLastUpdated()), folder: top, source: 'drive' });
    }
    if (depth >= SP_DOC_DEPTH) return;
    var subs = folder.getFolders();
    while (subs.hasNext() && out.files.length < SP_DOC_CAP) {
      var s = subs.next();
      walk(s, top || String(s.getName()), depth + 1);
    }
  };
  var idx = null;
  try { idx = userDocsIndex_(); } catch (eI) { idx = null; }
  if (!idx || idx.unreadable) {
    out.failed = true;
    out.why.push('the staff documents room could not be read');
  } else {
    var hit = idx.folders ? idx.folders[ctx.key] : null;
    if (hit && hit.ambiguous) out.why.push('two folders in the staff documents room carry this name, so neither is read');
    else if (hit) {
      try { walk(DriveApp.getFolderById(hit.id), '', 0); }
      catch (eW) { out.failed = true; out.why.push(spWhy_('the staff documents folder', eW)); }
    }
  }
  if (ctx.name.length >= 5) {
    try {
      userDocsLooseAll_().forEach(function (f) {
        if (!spNameIn_(ctx.name, f.name)) return;
        out.files.push({ file_id: String(f.id), title: String(f.name), mime: String(f.mime || ''), date: spDay_(f.updated),
                         folder: '', source: 'drive' });
      });
    } catch (eL) { out.why.push(spWhy_('the loose staff documents', eL)); }
  }
  try {
    var deep = profileDriveIndex_();
    var d = deep && deep.folders ? deep.folders[ctx.key] : null;
    if (d && !d.ambiguous) {
      profileDriveFiles_(d.id).forEach(function (f) {
        out.files.push({ file_id: String(f.id), title: String(f.name), mime: String(f.mime || ''), date: spDay_(f.updated),
                         folder: '', source: 'drive' });
      });
    }
  } catch (eD) { out.why.push(spWhy_('the compliance folders', eD)); }
  return out;
}

/** Candidate documents filed during hiring, read-only (never the catalog seed). */
function spHiringDocs_(candidateId) {
  if (!candidateId) return [];
  var sheet = hubTabSheet_(DOCS_TAB);
  if (!sheet) return [];
  var latest = {};
  locationsTabRows_(sheet).forEach(function (r) {
    if (String(r.candidate_id || '') !== candidateId || String(r.superseded_by || '')) return;
    latest[String(r.doc_id || r.doc_row_id || '')] = r;
  });
  return Object.keys(latest).map(function (k) {
    var r = latest[k];
    var fid = String(r.file_id || '') || locationsDriveId_(r.file_url);
    return { file_id: fid, title: spText_(r.doc_label || r.file_name || r.doc_id), mime: String(r.mime_type || ''),
             date: spDay_(r.issued_on) || spDay_(r.uploaded_at), expires: spDay_(r.expires_on), folder: '',
             source: 'hiring', confirmed: String(r.status || '').toLowerCase() === 'verified' };
  }).filter(function (f) { return !!f.file_id; });
}

function spCandidateResume_(candidateId) {
  if (!candidateId) return '';
  var link = '';
  readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (!link && str_(c.candidateid) === candidateId) link = str_(c.resumelink);
  });
  return locationsDriveId_(link);
}

/** Every paper of the person: Drive, the upload form and its archive, uploads, hiring, IST papers and the Master's own rows. */
function spDocumentsBuild_(ctx) {
  var why = [], degraded = false;
  var files = [], byId = {};
  var put = function (f) {
    if (!f.file_id || !/^[A-Za-z0-9_-]{10,}$/.test(f.file_id)) return;
    var had = byId[f.file_id];
    if (had) {
      if (f.confirmed) had.confirmed = true;
      if (f.expires && !had.expires) had.expires = f.expires;
      if (f.date && !had.date) had.date = f.date;
      return;
    }
    byId[f.file_id] = f;
    files.push(f);
  };
  var drive = spDriveDocs_(ctx);
  drive.files.forEach(put);
  why = why.concat(drive.why);
  if (drive.failed) degraded = true;
  try {
    var sd = staffDocsFor_(ctx.name);
    ((sd && sd.docs) || []).forEach(function (d) {
      put({ file_id: String(d.fileId || '') || locationsDriveId_(d.link), title: spText_(d.type) || 'Document',
            mime: '', date: spDay_(d.certified), expires: spDay_(d.expires), folder: '',
            source: d.from === 'archive' ? 'archive' : 'form' });
    });
  } catch (eF) { why.push(spWhy_('the staff documentation form', eF)); degraded = true; }
  var uploads = null;
  try { uploads = complianceDocsRows_(); } catch (eU) { uploads = null; }
  if (uploads === null) { why.push('the uploads ledger could not be read'); degraded = true; }
  (uploads || []).forEach(function (r) {
    if (hubNameFold_(r.person) !== ctx.key) return;
    var o = complianceDocsOut_(r);
    var label = '';
    try { label = certLabel_(o.req_id || o.cert); } catch (eL) { label = ''; }
    put({ file_id: o.file_id, title: spText_(label || o.name || o.cert) || 'Document', mime: '',
          date: o.issued_on || spDay_(o.at), expires: o.expires_on, folder: '', source: 'upload',
          confirmed: !!o.confirmed_at });
  });
  try { spHiringDocs_(ctx.candidate_id).forEach(put); }
  catch (eH) { why.push(spWhy_('the hiring documents', eH)); degraded = true; }
  try {
    spIstMine_(ctx).forEach(function (r) {
      var fid = locationsCell_(r.docFileId);
      if (fid) put({ file_id: fid, title: 'IST — ' + spText_(r.clientName), mime: '', date: spDay_(locationsCell_(r.docAt)),
                     expires: '', folder: 'Training', source: 'upload' });
    });
  } catch (eI) { why.push(spWhy_('the IST papers', eI)); degraded = true; }
  var envelope = null;
  try {
    var who = { email: (ctx.account && ctx.account.email) || (ctx.people && ctx.people.email) || (ctx.master && ctx.master.email) || '',
                phone: (ctx.people && ctx.people.phone) || (ctx.master && ctx.master.phone) || '' };
    if (who.email || who.phone) envelope = applicationFor_(who, packetMirrorRows_(), null);
  } catch (eE) { envelope = null; }
  files.sort(function (a, b) { return String(b.date || '') < String(a.date || '') ? -1 : (String(b.date || '') > String(a.date || '') ? 1 : 0); });
  var used = {}, docs = [];
  var m = ctx.master;
  var driverNa = !!m && (/^(no|none)$/i.test(String(m.driver || '')) || spIsNa_(m.driver));
  if (m) {
    var paperCols = [];
    SP_PAPERS.forEach(function (paper) {
      [paper.date, paper.expires, paper.flag].forEach(function (c) { if (c) paperCols.push(c); });
    });
    why.push(spMissingWhy_(ctx, paperCols));
    SP_PAPERS.forEach(function (paper) {
      if (paper.driving && driverNa) return;
      var file = null;
      for (var i = 0; i < files.length && !file; i++) {
        if (!used[files[i].file_id] && paper.re.test(files[i].title)) file = files[i];
      }
      if (file) used[file.file_id] = true;
      var date = paper.date ? spDay_(m[paper.date]) : '';
      var expires = paper.expires ? spDay_(m[paper.expires]) : '';
      var flag = paper.flag ? spFlag_(m[paper.flag]) : '';
      var status = 'missing';
      if (paper.kind === 'form') {
        if (flag === '0.5' || (flag === '0' && date)) status = 'partial';
        else if (date && flag !== '0') status = 'signed';
        else if (file) status = 'on_file';
        if (paper.id === 'job_app' && envelope && String(envelope.status).toLowerCase() === 'signed' && status !== 'partial') {
          status = 'signed';
          date = date || String(envelope.signedAt || '');
        }
      } else if (paper.kind === 'verify') {
        var none = paper.id === 'hs_diploma' && /^no\b/i.test(String(m.hs_diploma || ''));
        if (!none && flag === '1') status = 'verified';
        else if (!none && flag === '0.5') status = 'partial';
        else if (file) status = 'on_file';
        else if (!none && date) status = 'signed';
      } else if (paper.kind === 'resume') {
        if (file || spYesNo_(m.resume) === 'yes') status = 'on_file';
      } else {
        if (flag === '0.5') status = 'partial';
        else if (file || expires || date) status = 'on_file';
      }
      if (file && file.confirmed) status = 'verified';
      docs.push({ id: file ? file.file_id : 'master:' + paper.id, file_id: file ? file.file_id : null, title: paper.title,
                  category: paper.category, date: date || (file ? file.date || '' : ''),
                  expires: expires || (file ? file.expires || '' : ''), status: status,
                  source: file ? file.source : 'master', mime: file ? file.mime || '' : '' });
    });
  } else {
    why.push(ctx.master_why || 'this person has no row in the Employee Database Master');
    if (!ctx.master_read) degraded = true;
  }
  files.forEach(function (f) {
    if (used[f.file_id]) return;
    docs.push({ id: f.file_id, file_id: f.file_id, title: f.title, category: spDocCategory_(f.title, f.folder),
                date: f.date || '', expires: f.expires || '', status: f.confirmed ? 'verified' : 'on_file',
                source: f.source, mime: f.mime || '' });
  });
  var withFile = docs.filter(function (d) { return !!d.file_id; }).length;
  return { docs: docs,
           counts: { total: docs.length, with_file: withFile,
                     missing: docs.filter(function (d) { return d.status === 'missing'; }).length },
           why: why.filter(String).join('; '), degraded: degraded };
}

function spDocuments_(ctx) {
  return staffProfilesCached_('staffProfileDocuments', ctx.key, 'all', [spIstScope_()], function () {
    return spScrub_(spDocumentsBuild_(ctx));
  });
}

HUB_POLICY.staffProfileDocuments = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Documents: every paper the platform holds for the person, each with its category, dates and status. */
HUB_ACTIONS.staffProfileDocuments = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  try { return { status: 200, data: spDocuments_(ctx) }; }
  catch (e) {
    return { status: 503, message: 'The documents could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
};

// ---- employment -----------------------------------------------------------

function spEmploymentBuild_(ctx) {
  var m = ctx.master || {};
  var why = [];
  if (!ctx.master) why.push(ctx.master_why || 'this person has no row in the Employee Database Master');
  why.push(spMissingWhy_(ctx, ['referral', 'referral_paid', 'job_app_date', 'resume', 'attestation_date', 'start_doc',
    'start_first_day', 'end_last_day', 'hs_diploma', 'flag_hs_diploma', 'driver']));
  var docs = null;
  try { docs = spDocuments_(ctx); } catch (eD) { why.push(spWhy_('the documents', eD)); }
  var find = function (id) {
    var hit = null;
    ((docs && docs.docs) || []).forEach(function (d) { if (!hit && d.id === id) hit = d; });
    if (hit) return hit;
    ((docs && docs.docs) || []).forEach(function (d) {
      if (!hit && d.file_id && SP_PAPERS.some(function (p) { return p.id === id && p.re.test(d.title); })) hit = d;
    });
    return hit;
  };
  var resume = find('resume');
  var resumeId = resume && resume.file_id ? resume.file_id : null;
  if (!resumeId && ctx.candidate_id) {
    try { resumeId = spCandidateResume_(ctx.candidate_id) || null; }
    catch (eC) { why.push(spWhy_('the candidate record', eC)); }
  }
  var hs = find('hs_diploma');
  var paid = String(m.referral_paid || '');
  var paidDay = spDay_(paid) || spDayIn_(paid);
  var paidFlag = paidDay ? 'yes' : spYesNo_(paid.split(/[\s,;-]+/)[0]);
  var driver = spText_(m.driver);
  return {
    hiring: { referral: spText_(m.referral), referral_paid: paidDay || (paidFlag ? '' : spText_(paid)),
              referral_paid_flag: paidFlag, job_app_date: spDay_(m.job_app_date),
              resume: { flag: spYesNo_(m.resume), doc_id: resumeId }, attestation_date: spDay_(m.attestation_date) },
    dates: { start_doc: spDay_(m.start_doc), start_first_day: spDay_(m.start_first_day), end_last_day: spDay_(m.end_last_day) },
    qualifications: {
      hs_diploma: { value: spText_(m.hs_diploma), flag: spFlag_(m.flag_hs_diploma),
                    doc_id: hs && hs.file_id ? hs.file_id : null, doc_date: hs ? hs.date || '' : '' },
      driver: { value: driver, approved: /^yes$/i.test(driver) }
    },
    on_master: !!ctx.master, why: why.filter(String).join('; '), degraded: !ctx.master_read
  };
}

HUB_POLICY.staffProfileEmployment = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Employment: hiring, the employment dates and the qualifications, as the Employee Database Master holds them. */
HUB_ACTIONS.staffProfileEmployment = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  return spWithEdit_(spServe_('staffProfileEmployment', ctx, 'all', [spIstScope_()], 'The employment record', function () {
    return spEmploymentBuild_(ctx);
  }), ctx, user, 'employment');
};

// ---- compliance -----------------------------------------------------------

function spDateState_(expires, windowDays, today) {
  if (!expires) return 'no_date';
  if (expires < today) return 'expired';
  if (spDaysBetween_(today, expires) <= windowDays) return 'due_soon';
  return 'current';
}

function spMedDelScope_() {
  return MEDDEL_TAB;
}

/** A Med Del level as its course key: "Med 1" is med1. */
function spMedDelCourse_(level) {
  var s = String(level == null ? '' : level).toLowerCase();
  var d = /(\d)/.exec(s);
  return /med/.test(s) && d ? 'med' + d[1] : s.replace(/[^a-z0-9]/g, '');
}

/** The person's active Med Del renewals (meddel_flows) by course, read without ever making the tab. */
function spMedDelFlows_(key) {
  var out = {};
  var sheet = hubTabSheet_(MEDDEL_TAB);
  if (!sheet) return out;
  locationsTabRows_(sheet).forEach(function (f) {
    if (String(f.nameKey || '') !== key || String(f.overallStatus || '').toLowerCase() !== 'active') return;
    var course = spMedDelCourse_(f.medLevel);
    if (!course) return;
    var phase = String(Number(f.phase) || 1);
    out[course] = { flow_id: spText_(f.id, 40), level: spText_(f.medLevel, 30), phase: phase,
                    phase_label: SP_MEDDEL_PHASES[phase] || '', cert_expires: spDay_(f.certExpDate) };
  });
  return out;
}

function spMedDelPhase_(f) {
  return 'Phase ' + f.phase + (f.phase_label ? ' · ' + f.phase_label : '');
}

/** The Trainings Status tracker's own Status word per course for this person; certPicture_ keeps only expiring or expired. */
function spTrackerWords_(key) {
  var keys = certTrainingKeys_();
  var col = { name: certSourceField_('trainings.name'), course: certSourceField_('trainings.course'),
              status: certSourceField_('trainings.status') };
  var out = {};
  certReadTab_(certSourceTab_('trainings')).forEach(function (r) {
    if (clientNameKey_(certFieldOf_(r, col.name)) !== key) return;
    var course = spOwn_(keys, certFieldOf_(r, col.course).toLowerCase().trim());
    var word = spText_(certFieldOf_(r, col.status), 60);
    if (course && word) out[course] = word;
  });
  return out;
}

function spOwn_(o, k) {
  return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null;
}

/** The enabled requirements a course or credential files under: by req_id, and by the credential they name. */
function spReqCatalog_() {
  var out = { byId: {}, byCredential: {} };
  (requirementsAll_().rows || []).forEach(function (r) {
    if (str_(r.enabled).toLowerCase() !== 'yes') return;
    var id = str_(r.req_id), cred = str_(r.credential);
    if (id && !spOwn_(out.byId, id)) out.byId[id] = r;
    if (cred) out.byCredential[cred] = (spOwn_(out.byCredential, cred) || []).concat([r]);
  });
  return out;
}

// Where a course's paper files and its date lands: the requirement (its own req_id, else the one naming it as its…
function spFilingOf_(catalog, id) {
  var req = catalog ? spOwn_(catalog.byId, id) : null;
  if (!req && catalog) {
    var named = spOwn_(catalog.byCredential, id) || [];
    req = named.length === 1 ? named[0] : null;
  }
  if (!req) return { req_id: '', master_header: '', date_role: '', files: false, confirm_why: '' };
  return { req_id: str_(req.req_id), master_header: str_(req.date_source), date_role: complianceDocsDateRole_(req),
           files: !complianceDocsReqShut_(req), confirm_why: complianceDocsConfirmShut_(req) };
}

// The newest papers filed for a course and not yet confirmed into the record, offered to continue from.
var SP_PAPERS_SHOWN = 10;
var SP_PAPER_FIELDS = ['id', 'person', 'cert', 'name', 'at', 'req_id', 'read_state', 'read_kind', 'read_kind_words',
                       'issued_on', 'expires_on', 'read_confidence', 'read_why'];

/** One such paper as the certificate doors answer it (complianceDocsOut_), narrowed: never its link or its file. */
function spPaperOut_(r) {
  var full = complianceDocsOut_(r), out = {};
  SP_PAPER_FIELDS.forEach(function (k) { out[k] = full[k]; });
  return out;
}

function spComplianceBuild_(ctx) {
  var why = [], degraded = false;
  var today = locationsToday_();
  var windowDays = 60;
  try { windowDays = certExpiringDays_(); } catch (eW) { windowDays = 60; }
  var picture = null;
  try { picture = certPicture_(); } catch (eP) { why.push(spWhy_('the certifications', eP)); degraded = true; }
  var words = {};
  try { words = spTrackerWords_(ctx.key) || {}; }
  catch (eT) { why.push(spWhy_('the Trainings Status tracker', eT)); degraded = true; }
  var renewals = {};
  try { renewals = spMedDelFlows_(ctx.key) || {}; }
  catch (eF) { why.push(spWhy_('the Med Del renewals', eF)); degraded = true; }
  var known = !!(picture && picture[ctx.key]);
  var mine = known ? picture[ctx.key].certs || {} : {};
  var review = {}, papers = [];
  var uploads = null;
  try { uploads = complianceDocsRows_(); } catch (eU) { uploads = null; }
  if (uploads === null) { why.push('the uploads ledger could not be read'); degraded = true; }
  (uploads || []).forEach(function (r) {
    if (hubNameFold_(r.person) !== ctx.key || str_(r.confirmedat)) return;
    [str_(r.reqid), str_(r.cert)].forEach(function (k) { if (k) review[k] = true; });
    if (str_(r.id) && str_(r.reqid)) papers.push(spPaperOut_(r));
  });
  papers.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  var courses = [];
  try { courses = certMatrixColumns_(); } catch (eC) { courses = ['dodd', 'cpr', 'med1', 'med2', 'med3', 'mais', 'money', 'mandt']; }
  var catalog = null;
  // an unread catalogue files no course: said, and never kept as an empty catalogue
  try { catalog = spReqCatalog_(); } catch (eQ) { why.push(spWhy_('the requirements catalogue', eQ)); degraded = true; }
  var training = courses.map(function (k) {
    var label = k;
    try { label = certLabel_(k); } catch (eL) { label = k; }
    var cell = Object.prototype.hasOwnProperty.call(mine, k) ? mine[k] : null;
    var expires = cell ? spDay_(cell.expires) : '';
    // A person the sources know with no dated row for the course is "no date", never current by derivation.
    var state = known ? 'no_date' : 'not_on_file';
    if (cell) {
      var st = String(cell.status || '').toLowerCase();
      if (st === 'expired') state = 'expired';
      else if (!expires) state = 'no_date';
      else state = st === 'expiring' ? 'due_soon' : spDateState_(expires, windowDays, today);
    }
    var renewal = spOwn_(renewals, k);
    // A running renewal speaks for a course with no date; a date keeps its own pill and the renewal is its sub-line.
    if (renewal && (state === 'no_date' || state === 'not_on_file')) state = 'renewal_assigned';
    if (review[k] && state !== 'current') state = 'in_review';
    return { id: k, label: label, expires: expires, state: state,
             source: state === 'in_review' ? 'upload' : (cell ? 'employee_database' : (renewal ? 'meddel_flows' : '')),
             tracker_word: spOwn_(words, k) || '',
             renewal: renewal ? { phase: renewal.phase, phase_label: renewal.phase_label, level: renewal.level } : null,
             filing: spFilingOf_(catalog, k) };
  });
  var m = ctx.master;
  if (!m) { why.push(ctx.master_why || 'this person has no row in the Employee Database Master'); if (!ctx.master_read) degraded = true; }
  why.push(spMissingWhy_(ctx, ['driver', 'license_exp', 'insurance_exp', 'sam', 'oig', 'abuser', 'sex_offender', 'offender',
    'nurse_aide', 'exclusions', 'bci_check_date', 'rapback_entry_date']));
  var mf = m || {};
  var driverNa = /^(no|none)$/i.test(String(mf.driver || '')) || spIsNa_(mf.driver);
  var cred = function (id, label, exp) {
    var e = spDay_(mf[exp]);
    var state = !m ? 'not_on_file' : (e ? spDateState_(e, windowDays, today) : (driverNa ? 'na' : 'not_on_file'));
    return { id: id, label: label, expires: e, state: state, note: driverNa && !e ? 'Not a driver on the Employee Database' : '',
             filing: spFilingOf_(catalog, id) };
  };
  var credentials = [
    cred('driver_license', "Driver's license", 'license_exp'),
    cred('car_insurance', 'Auto insurance', 'insurance_exp'),
    { id: 'nurse_aide', label: 'Nurse Aide / STNA', expires: '', state: 'na',
      note: 'No STNA licence source is on the platform; the Nurse Aide columns of the Employee Database are the registry ' +
            'check shown under Screening.', filing: spFilingOf_(catalog, 'nurse_aide') }
  ];
  var sc = function (id) { var d = SP_SCREENS.filter(function (s) { return s.id === id; })[0]; return spScreenState_(mf[d.cell], mf[d.flag]); };
  var federal = spScreenJoin_([sc('sam'), sc('oig')]);
  var registries = spScreenJoin_([sc('abuser'), sc('sex_offender'), sc('offender'), sc('nurse_aide'), sc('exclusions')]);
  var bci = spBciState_(mf);
  var screening = [
    { id: 'federal', label: 'Federal exclusions (SAM + OIG)', state: m ? federal.state : 'missing', date: federal.date },
    { id: 'state_registries', label: 'State registries', state: m ? registries.state : 'missing', date: registries.date },
    { id: 'bci_fbi', label: 'BCI / FBI', state: m ? bci.state : 'missing', date: bci.date,
      rapback_date: spDay_(mf.rapback_entry_date) }
  ];
  return { training: training, credentials: credentials, screening: screening, window_days: windowDays,
           papers: papers.slice(0, SP_PAPERS_SHOWN), why: why.filter(String).join('; '), degraded: degraded };
}

function spBciState_(mf) {
  var d = spDay_(mf.bci_check_date) || String(mf.bci_fbi_date || '');
  if (d) return { state: 'clear', date: d };
  if (mf.bci_ref_masked) return { state: 'pending', date: '' };
  var f = spFlag_(mf.flag_bci);
  if (f === '1' || f === '0.5') return { state: 'clear', date: '' };
  return { state: 'missing', date: '' };
}

HUB_POLICY.staffProfileCompliance = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Compliance: every course current or not with its running renewal and tracker word, the driving credentials and the screening summary. */
HUB_ACTIONS.staffProfileCompliance = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  return spServe_('staffProfileCompliance', ctx, 'all', [spMedDelScope_()], 'The compliance record', function () {
    return spComplianceBuild_(ctx);
  });
};

// ---- HR -------------------------------------------------------------------

/** The Master columns this build could not find, said rather than drawn as blanks. */
function spMissingWhy_(ctx, ids) {
  var gone = (ctx.master_missing || []).filter(function (id) { return ids.indexOf(id) !== -1; });
  return gone.length ? 'the Employee Database Master has no column for ' + gone.join(', ') : '';
}

function spHrBuild_(ctx) {
  var m = ctx.master || {};
  var why = [];
  if (!ctx.master) why.push(ctx.master_why || 'this person has no row in the Employee Database Master');
  why.push(spMissingWhy_(ctx, ['ssn', 'ssn_last4', 'dob', 'address', 'city', 'state', 'zip', 'w4_date', 'pay_auth_date',
    'i9_date', 'i9_completed', 'i9_type_1', 'i9_type_1_exp', 'i9_type_2', 'i9_type_2_exp', 'hipaa_date', 'driver', 'dl',
    'license_exp', 'abstract_original', 'abstract_latest', 'insurance_exp', 'sam', 'oig', 'abuser', 'sex_offender',
    'offender', 'nurse_aide', 'exclusions', 'bci_fbi', 'bci_check_date', 'rapback_entry_date']));
  var driver = spText_(m.driver);
  var screening = SP_SCREENS.map(function (s) {
    var st = spScreenState_(m[s.cell], m[s.flag]);
    return { id: s.id, label: s.label, state: ctx.master ? st.state : 'missing', date: st.date };
  });
  var bci = spBciState_(m);
  screening.push({ id: 'bci_fbi', label: 'BCI / FBI', state: ctx.master ? bci.state : 'missing', date: bci.date,
                   ref_masked: m.bci_ref_masked || '' });
  return {
    personal: { ssn_masked: m.ssn_masked || '', dob: spDay_(m.dob), address: spText_(m.address), city: spText_(m.city),
                state: spText_(m.state), zip: spText_(m.zip), w4_date: spDay_(m.w4_date), pay_auth_date: spDay_(m.pay_auth_date) },
    work_auth: { i9_date: spDay_(m.i9_date), i9_completed: spText_(m.i9_completed), i9_type_1: spText_(m.i9_type_1),
                 i9_type_1_exp: spDay_(m.i9_type_1_exp) || (spIsNa_(m.i9_type_1_exp) ? 'n/a' : ''),
                 i9_type_2: spText_(m.i9_type_2),
                 i9_type_2_exp: spDay_(m.i9_type_2_exp) || (spIsNa_(m.i9_type_2_exp) ? 'n/a' : ''),
                 hipaa_date: spDay_(m.hipaa_date) },
    driver: { driver: driver, approved: /^yes$/i.test(driver), license_masked: m.license_masked || '',
              license_exp: spDay_(m.license_exp), abstract_original: spDay_(m.abstract_original) || spText_(m.abstract_original),
              abstract_latest: spDay_(m.abstract_latest) || spText_(m.abstract_latest), insurance_exp: spDay_(m.insurance_exp) },
    screening: screening,
    bci_check_date: spDay_(m.bci_check_date), rapback_entry_date: spDay_(m.rapback_entry_date),
    why: why.filter(String).join('; '), degraded: !ctx.master_read
  };
}

/** The cached record plus the account as read this call: the access doors change it without knowing the staff key. */
function spHrWithAccount_(data, ctx) {
  var out = {};
  Object.keys(data || {}).forEach(function (k) { out[k] = data[k]; });
  var a = ctx.account;
  var live = spScrub_({
    account: a ? { user_id: a.user_id, login: a.email, role: a.role, active: a.active, last_login: a.last_login,
                   created_at: a.created_at } : null,
    account_why: a ? '' : (ctx.account_why || 'no platform account carries this person\'s e-mail or name')
  });
  out.account = live.account;
  out.account_why = live.account_why;
  return out;
}

HUB_POLICY.staffProfileHr = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** HR Admin: the restricted record, masked where it is read; every view is a line in the audit history. */
HUB_ACTIONS.staffProfileHr = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var res = spServe_('staffProfileHr', ctx, 'all', [], 'The HR record', function () { return spHrBuild_(ctx); });
  if (res.status !== 200) return res;
  hubSysLog_(str_(user.email), 'staffProfileHr', ctx.key, { status: 200 });
  staffProfilesBump_('staffProfileActivity', ctx.key);
  return spWithEdit_({ status: 200, data: spHrWithAccount_(res.data, ctx) }, ctx, user, 'hr');
};

// ---- actions --------------------------------------------------------------

function spActionsBuild_(ctx) {
  var why = [], degraded = false;
  var items = [];
  var catalog = {};
  try { requirementsAll_().rows.forEach(function (r) { catalog[str_(r.req_id)] = r; }); }
  catch (eC) { why.push(spWhy_('the requirements catalogue', eC)); }
  var uploads = null;
  try { uploads = complianceDocsRows_(); } catch (eU) { uploads = null; }
  if (uploads === null) { why.push('the uploads ledger could not be read'); degraded = true; }
  var mineUp = (uploads || []).filter(function (r) { return hubNameFold_(r.person) === ctx.key; })
    .map(function (r) { return complianceDocsOut_(r); });
  var docFor = function (reqId) {
    var hit = null;
    mineUp.forEach(function (u) { if (u.file_id && (u.req_id === reqId || u.cert === reqId) && (!hit || u.at > hit.at)) hit = u; });
    return hit;
  };
  var renewals = {};
  try { renewals = spMedDelFlows_(ctx.key) || {}; }
  catch (eF) { why.push(spWhy_('the Med Del renewals', eF)); degraded = true; }
  var placed = {};
  var got = null;
  try { got = reqStatesListValues_(0); } catch (eR) { got = null; }
  if (!got) { why.push('the requirement states could not be read'); degraded = true; }
  else {
    reqStatesListFrom_(got.hdr, got.values, { limit: 100000, key: ctx.key }).forEach(function (r) {
      var req = catalog[r.req_id] || {};
      var cat = str_(req.category).toLowerCase();
      if (['training', 'documents', 'onboarding'].indexOf(cat) === -1) return;
      var st = str_(r.state).toLowerCase();
      if (['expired', 'expiring', 'missing'].indexOf(st) === -1) return;
      var days = parseInt(r.days_left, 10);
      var phase = st === 'expired' ? 'Expired'
        : (st === 'expiring' ? (isNaN(days) ? 'Expiring' : 'Expires in ' + days + ' day' + (days === 1 ? '' : 's')) : 'Not on file');
      // A course with a running Med Del renewal is that flow at its phase, one row.
      var course = str_(req.credential) || r.req_id;
      var flow = spOwn_(renewals, course);
      if (flow) placed[course] = true;
      var doc = docFor(r.req_id);
      items.push({ id: 'req:' + r.req_id, status: st === 'expiring' ? 'due_soon' : 'needs_attention',
                   item: spText_(req.label) || r.req_id, date: spDay_(r.expires),
                   flow: flow ? SP_FLOWS.meddel : SP_FLOWS[cat], phase: flow ? spMedDelPhase_(flow) : phase,
                   action: doc ? { kind: 'doc', doc_id: doc.file_id } : { kind: 'none' } });
    });
  }
  Object.keys(renewals).forEach(function (course) {
    if (placed[course]) return;
    var f = renewals[course];
    var label = '';
    try { label = certLabel_(course); } catch (eL) { label = ''; }
    var doc = docFor(course);
    items.push({ id: 'meddel:' + (f.flow_id || course),
                 status: f.cert_expires && f.cert_expires < locationsToday_() ? 'needs_attention' : 'due_soon',
                 item: spText_(label && label !== course ? label : f.level) || course, date: f.cert_expires,
                 flow: SP_FLOWS.meddel, phase: spMedDelPhase_(f),
                 action: doc ? { kind: 'doc', doc_id: doc.file_id } : { kind: 'none' } });
  });
  try {
    spIstMine_(ctx).forEach(function (r) {
      if (locationsCell_(r.status).toLowerCase() === 'done') return;
      var due = spDay_(locationsCell_(r.dueDate));
      items.push({ id: 'ist:' + locationsCell_(r.id), status: due && due < locationsToday_() ? 'needs_attention' : 'due_soon',
                   item: 'IST — ' + spText_(r.clientName), date: due, flow: SP_FLOWS.ist,
                   phase: 'Owed' + (due ? ' · due ' + due : ''),
                   action: { kind: 'none', house: locationsHouseCode_(r.house) || '' } });
    });
  } catch (eI) { why.push(spWhy_('the IST records', eI)); degraded = true; }
  mineUp.forEach(function (u) {
    if (u.confirmed_at) return;
    var label = '';
    try { label = certLabel_(u.req_id || u.cert); } catch (eL) { label = ''; }
    items.push({ id: 'upload:' + u.id, status: 'in_review', item: spText_(label || u.name || u.cert) || 'Document',
                 date: spDay_(u.at), flow: SP_FLOWS.review, phase: 'In review',
                 action: u.file_id ? { kind: 'doc', doc_id: u.file_id } : { kind: 'none' } });
  });
  var rank = { needs_attention: 0, due_soon: 1, in_review: 2 };
  items.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || String(a.date).localeCompare(String(b.date)); });
  var counts = { needs_attention: 0, due_soon: 0, in_review: 0 };
  items.forEach(function (i) { counts[i.status]++; });
  return { items: items, counts: counts, why: why.filter(String).join('; '), degraded: degraded };
}

HUB_POLICY.staffProfileActions = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Actions: what the person still owes the team — renewals and their Med Del phase, onboarding papers, ISTs and papers waiting for review. */
HUB_ACTIONS.staffProfileActions = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  return spServe_('staffProfileActions', ctx, 'all', [spIstScope_(), spMedDelScope_()], 'The pending items', function () {
    return spActionsBuild_(ctx);
  });
};

// ---- activity -------------------------------------------------------------

/** Rows of the events trail whose subject is this key, found by the cell and never by a full read; newest first. */
function spEventsFor_(key) {
  var sheet = hubTabSheet_(EVENTS_TAB);
  if (!sheet) return [];
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var width = Math.max(EVENTS_HEADER.length, sheet.getLastColumn());
  var head = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var at = function (name, fb) { var i = head.indexOf(name); return i === -1 ? fb : i; };
  var iKey = at('subject_key', 4);
  var column = sheet.getRange(2, iKey + 1, last - 1, 1);
  var rows = [];
  if (typeof column.createTextFinder === 'function') {
    (column.createTextFinder(key).matchCase(true).matchEntireCell(true).findAll() || []).forEach(function (c) {
      rows.push(c.getRow());
    });
  } else {
    column.getValues().forEach(function (v, i) { if (String(v[0] || '').trim() === key) rows.push(i + 2); });
  }
  rows.sort(function (a, b) { return b - a; });
  return rows.slice(0, SP_EVENTS_CAP).map(function (r) {
    var v = sheet.getRange(r, 1, 1, width).getValues()[0];
    var payload = {};
    try { payload = JSON.parse(String(v[at('payload', 6)] || '{}')) || {}; } catch (eJ) { payload = {}; }
    return { type: String(v[at('type', 1)] || ''), actor: String(v[at('actor', 2)] || ''),
             at: spInstant_(v[at('at', 8)]), payload: payload };
  });
}

function spActivityBuild_(ctx) {
  var why = [], degraded = false;
  var since = locationsDayShift_(locationsToday_(), -SP_ACTIVITY_DAYS);
  var events = [];
  var add = function (at, kind, title, detail, by) {
    var s = spInstant_(at);
    if (!s || s.slice(0, 10) < since) return;
    events.push({ at: s, kind: kind, title: title, detail: detail || '', by: by || '' });
  };
  var visits = [];
  try {
    spOwnRows_(spVisitsSheet_(false), ctx.key).forEach(function (v) {
      visits.push({ at: String(v.at || ''), visitor: String(v.visitor_name || v.visitor_email || ''), section: String(v.section || '') });
      add(v.at, 'visit', 'Profile visited', String(v.section || ''), String(v.visitor_name || v.visitor_email || ''));
    });
  } catch (eV) { why.push(spWhy_('the profile visits', eV)); }
  visits.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  try {
    spOwnRows_(spNotesSheet_(false), ctx.key).forEach(function (n) {
      add(n.at, 'note', 'Note added' + (n.category ? ' — ' + n.category : ''), spText_(n.details, 140), n.by);
    });
  } catch (eN) { why.push(spWhy_('the staff notes', eN)); }
  try {
    spIstMine_(ctx).forEach(function (r) {
      var where = (locationsHouseCode_(r.house) || spText_(r.house));
      add(locationsCell_(r.createdAt), 'ist_assigned', 'IST assigned — ' + spText_(r.clientName), where, '');
      if (locationsCell_(r.trainedAt)) add(locationsCell_(r.trainedAt), 'ist_done', 'IST done — ' + spText_(r.clientName), where, spText_(r.trainedBy));
      if (locationsCell_(r.docAt)) add(locationsCell_(r.docAt), 'upload', 'Training document added — IST ' + spText_(r.clientName), where, spText_(r.docBy));
    });
  } catch (eI) { why.push(spWhy_('the IST records', eI)); degraded = true; }
  var catalog = {};
  try { requirementsAll_().rows.forEach(function (r) { catalog[str_(r.req_id)] = str_(r.label); }); } catch (eC) { catalog = {}; }
  try {
    spEventsFor_(ctx.key).forEach(function (e) {
      if (e.type === 'requirement_state_changed') {
        var p = e.payload || {};
        add(e.at, 'requirement', (catalog[p.req_id] || p.req_id || 'Requirement') + ': ' + (p.prev_state || 'new') + ' → ' + (p.state || ''),
            p.expires ? 'expires ' + p.expires : '', '');
      } else if (e.type === 'staffProfileHr') {
        add(e.at, 'hr_view', 'HR record viewed', '', e.actor);
      }
    });
  } catch (eE) { why.push(spWhy_('the events trail', eE)); }
  var uploads = null;
  try { uploads = complianceDocsRows_(); } catch (eU) { uploads = null; }
  if (uploads === null) { why.push('the uploads ledger could not be read'); degraded = true; }
  (uploads || []).forEach(function (r) {
    if (hubNameFold_(r.person) !== ctx.key) return;
    var o = complianceDocsOut_(r);
    var label = '';
    try { label = certLabel_(o.req_id || o.cert); } catch (eL) { label = ''; }
    add(o.at, 'upload', 'Document uploaded — ' + (label || o.cert || 'document'), '', o.by);
    if (o.confirmed_at) add(o.confirmed_at, 'upload_confirmed', 'Document confirmed — ' + (label || o.cert || 'document'), '', o.confirmed_by);
  });
  try {
    estateRows_('uiIncidents').forEach(function (r) {
      var named = emp360NameHit_(r.employees_involved, ctx.name);
      var reporter = clientNameKey_(r.your_name) === ctx.key;
      if (!named && !reporter) return;
      var when = spDay_(r.incident_date) || spDay_(r.timestamp);
      var cats = locationsCategories_(r.incident_category);
      add(when || r.timestamp, 'incident', 'Incident' + (cats.length ? ' — ' + cats.join(', ') : ''),
          named ? 'named in the report' : 'filed the report', '');
    });
  } catch (eX) { why.push(spWhy_('the incidents', eX)); degraded = true; }
  try {
    var facts = spShiftFacts_(ctx);
    (facts.shifts.patterns || []).forEach(function (p) {
      var hours = p.start || p.end ? ' · ' + [p.start, p.end].filter(String).join('–') : '';
      add(p.from, 'scheduled', 'Scheduled — ' + p.house + ' · ' + p.weekdays.join(', ') + hours,
          p.from === p.to ? p.from : p.from + ' to ' + p.to, '');
    });
  } catch (eS) { why.push(spWhy_('the schedule', eS)); }
  events.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  return { events: events, visits: visits.slice(0, 200), visits_total: visits.length,
           why: why.filter(String).join('; '), degraded: degraded };
}

HUB_POLICY.staffProfileActivity = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Activity: the timeline of the last year, and who visited the profile. */
HUB_ACTIONS.staffProfileActivity = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  return spServe_('staffProfileActivity', ctx, 'all', [spIstScope_(), spIncidentsScope_()], 'The activity', function () {
    return spActivityBuild_(ctx);
  });
};

// ---- notes ----------------------------------------------------------------

function spNotesBuild_(ctx) {
  var why = [];
  var notes = spOwnRows_(spNotesSheet_(false), ctx.key).map(function (r) {
    return { id: String(r.id || ''), category: String(r.category || 'general'), priority: String(r.priority || 'normal'),
             details: String(r.details || ''), state: String(r.state || 'open'), by: String(r.by || ''),
             at: String(r.at || ''), state_by: String(r.state_by || ''), state_at: String(r.state_at || '') };
  });
  notes.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  var earlier = [];
  try {
    perfReadSoft_(ssOpen_(hubId_('HUB_DB_ID')), PERF_TABS.notes).forEach(function (r) {
      if (str_(r.category) !== 'Manager note' || clientNameKey_(str_(r.name)) !== ctx.key) return;
      earlier.push({ at: str_(r.createdat), by: str_(r.src).replace(/^hub:/, ''), details: str_(r.text) });
    });
  } catch (eP) { why.push(spWhy_('the earlier manager notes', eP)); }
  earlier.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  return { notes: notes, earlier: earlier, why: why.join('; ') };
}

HUB_POLICY.staffProfileNotes = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Staff notes, newest first, and the manager notes written before this app. */
HUB_ACTIONS.staffProfileNotes = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  return spServe_('staffProfileNotes', ctx, 'all', [], 'The staff notes', function () { return spNotesBuild_(ctx); });
};

// ---- performance ----------------------------------------------------------

var SP_PERF_DAYS = 90;
// minutes past the scheduled start a first punch may land before the shift is tardy
var SP_PERF_TARDY_MIN = 5;
var SP_PERF_MANDATORY = ['cpr', 'dodd'];
var SP_PERF_SCOPES = { med1: 'Medication', med2: 'Medication', med3: 'Medication', mais: 'Medication',
                       money: 'Funds management', mandt: 'Crisis prevention' };
var SP_PERF_WEIGHTS = { attendance: 40, mandatory: 30, documentation: 30 };
var SP_PERF_FORMULA = 'Score = 40% attendance reliability + 30% mandatory training compliance + 30% documentation on ' +
  'time, over the parts with data. Attendance reliability is on-time starts over scheduled shifts worked, called out or ' +
  'missed with no call. Documentation is on-time records over expected records. Value-add training is shown ' +
  'separately and never lowers the score. HR matters are never scored.';
var SP_PERF_HOLDING = ['', 'scheduled', 'swap_in', 'taken', 'training'];
var SP_PERF_AWAY = { requested_off: 'Requested off', time_off: 'Time off' };
var SP_PERF_ROWS_CAP = 200;
var SP_HR_SEVERITIES = ['Coaching', 'Verbal warning', 'Written warning', 'Final warning'];
var SP_HR_CATEGORIES = ['Conflict', 'Dress code', 'Attendance', 'Conduct', 'Documentation', 'Other compliance'];
var SP_HR_UNDER_REVIEW = 'Under review';

/** Minutes after midnight of a clock written 08:00, 8:00 AM or 8a; null when it is none. */
function spMinutes_(v) {
  var m = /^(\d{1,2})(?::(\d{2}))?\s*(a|p)?/.exec(String(v == null ? '' : v).trim().toLowerCase());
  if (!m) return null;
  var h = Number(m[1]), mm = Number(m[2] || 0);
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  return h > 23 || mm > 59 ? null : h * 60 + mm;
}

function spClock_(min) {
  if (min === null || min === undefined || String(min).trim() === '' || isNaN(Number(min))) return '';
  var n = ((Math.round(Number(min)) % 1440) + 1440) % 1440;
  return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2);
}

function spTrue_(v) {
  return v === true || /^(true|1|yes|y)$/i.test(String(v == null ? '' : v).trim());
}

/** An instant's Ohio day; a bare day as written. */
function spOhioDay_(v) {
  var s = String(v == null ? '' : v).trim();
  if (v instanceof Date || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    var d = v instanceof Date ? v : new Date(s);
    if (!isNaN(d.getTime())) {
      try { return Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd'); } catch (e) { /* falls to the text */ }
    }
  }
  return spDay_(v);
}

/** Scheduled shifts against the punches, the call-off book and Scheduling's call-offs, newest first. */
function spPerfAttendance_(ctx, since, today) {
  var why = [], src = { schedule: false, scheduling: false, punches: false, calloffs: false };
  var shifts = {}, perDay = {}, away = [], told = {}, punches = {}, punchDays = {}, entries = [];
  var add = function (day, code, start, end, source) {
    var k = day + '|' + code;
    if (shifts[k] && shifts[k].source === 'Scheduling' && source !== 'Scheduling') return;
    if (!shifts[k]) perDay[day] = (perDay[day] || 0) + 1;
    shifts[k] = { date: day, house: code, start: start, end: end, source: source };
  };
  var tell = function (day, e) { (told[day] = told[day] || []).push(e); };
  var got = locationsCalendar_();
  if (got.cal && got.cal.values) {
    src.schedule = true;
    var values = got.cal.values, tz = got.cal.tz;
    var head = (values[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
    var col = function (names, fb) {
      for (var i = 0; i < names.length; i++) { var at = head.indexOf(names[i]); if (at !== -1) return at; }
      return fb;
    };
    var cLoc = col(['location'], 0), cName = col(['employee'], 1), cDate = col(['date'], 4);
    var cStart = col(['start time', 'start', 'shift start', 'time in', 'shift'], -1);
    var cEnd = col(['end time', 'end', 'shift end', 'time out'], -1);
    for (var r = 1; r < values.length; r++) {
      var line = values[r] || [];
      if (clientNameKey_(line[cName]) !== ctx.key) continue;
      var day = commBroadcastDay_(line[cDate], tz);
      var code = locationsCode_(line[cLoc]);
      if (!day || day < since || day >= today || !code) continue;
      add(day, code, cStart === -1 ? '' : spClock_(spMinutes_(spTime_(line[cStart], tz))),
          cEnd === -1 ? '' : spClock_(spMinutes_(spTime_(line[cEnd], tz))), 'Calendar Archive');
    }
  } else if (got.why) why.push(got.why);
  try {
    var mine = {};
    schedRead_(SCHED_TABS.rows).forEach(function (row) { if (row.person_key === ctx.key) mine[row.house_code + '|' + row.row_id] = true; });
    schedRead_(SCHED_TABS.cells).forEach(function (c) {
      if (!mine[c.house_code + '|' + c.row_id] || !c.date || c.date < since || c.date >= today) return;
      var code = locationsCode_(c.house_code) || c.house_code;
      var timed = String(c.start_min).trim() !== '' && c.kind !== 'off' && c.kind !== 'ro';
      if (timed && SP_PERF_HOLDING.indexOf(c.state) !== -1) add(c.date, code, spClock_(c.start_min), spClock_(c.end_min), 'Scheduling');
      else if (SP_PERF_AWAY[c.state] || c.kind === 'ro') {
        away.push({ date: c.date, house: code, words: SP_PERF_AWAY[c.state] || 'Requested off' });
      } else if (c.state === 'called_off') tell(c.date, { kind: 'call_off', at: '', note: '', source: 'Scheduling' });
    });
    schedRead_(SCHED_TABS.flows).forEach(function (f) {
      if (f.kind !== 'call_off' || f.person_key !== ctx.key || !f.date || f.date < since || f.date > today) return;
      tell(f.date, { kind: 'call_off', at: spInstant_(f.created_at), note: spText_(f.reason, 160), source: 'Scheduling' });
    });
    src.scheduling = true;
  } catch (eS) { why.push(spWhy_('the Scheduling board', eS)); }
  var psi = locationsPunches_();
  if (psi.rows) {
    src.punches = true;
    var places = locationsPsiPlaces_(psi.rows);
    psi.rows.forEach(function (p) {
      var who = spText_(p.employee) || spText_(String(p.firstname || '') + ' ' + String(p.lastname || ''));
      if (clientNameKey_(who) !== ctx.key) return;
      var day = commBroadcastDay_(p.date_iso, 'America/New_York') || commBroadcastDay_(p.date_service, 'America/New_York');
      if (!day || day < since || day > today) return;
      var code = locationsCode_(p.house) || places[locationsLocKey_(p.location_name)] || '';
      var s = spMinutes_(spTime_(p.start_time)), e = spMinutes_(spTime_(p.end_time));
      entries.push({ date: day, house: code, start: s, end: e, submitted: spOhioDay_(p.submit_date),
                     returned: !!spText_(p.rejected_user) || !!spText_(p.rejected_time),
                     noted: spTrue_(p.consumer_1_has_note) || spTrue_(p.consumer_2_has_note) || spTrue_(p.consumer_3_has_note) });
      var k = day + '|' + code;
      var pp = punches[k];
      if (!pp) { pp = punches[k] = { start: null, end: null }; (punchDays[day] = punchDays[day] || []).push(k); }
      if (s !== null && (pp.start === null || s < pp.start)) pp.start = s;
      if (e !== null && (pp.end === null || e > pp.end)) pp.end = e;
    });
  } else if (psi.why) why.push(psi.why);
  try {
    (listRows_('callOffs', {}) || []).forEach(function (r) {
      if (!emp360NameHit_(r.employee_name, ctx.name)) return;
      var kind = commCallOffKindOf_(r.type);
      var day = spDay_(r.date) || spOhioDay_(r.timestamp);
      if (!kind || !day || day < since || day > today) return;
      tell(day, { kind: kind, at: spInstant_(r.timestamp), late: spText_(r.how_late, 40), note: spText_(r.notes, 160),
                  source: 'Call-off book' });
    });
    src.calloffs = true;
  } catch (eC) { why.push(spWhy_('the call-off book', eC)); }

  var rows = [], used = {};
  var take = function (day, kind) {
    var hit = (told[day] || []).filter(function (e) { return e.kind === kind; })[0] || null;
    if (hit) used[day + '|' + kind] = true;
    return hit;
  };
  var rowOf = function (date, house, start, end, source) {
    return { date: date, house: house, status: '', scheduled_start: start || '', scheduled_end: end || '', actual_start: '',
             actual_end: '', notice: '', excused: '', details: '', source: source };
  };
  Object.keys(shifts).forEach(function (k) {
    var s = shifts[k];
    var row = rowOf(s.date, s.house, s.start, s.end, s.source);
    var p = punches[k] || (perDay[s.date] === 1 && (punchDays[s.date] || []).length === 1 ? punches[punchDays[s.date][0]] : null);
    if (p) {
      row.actual_start = spClock_(p.start);
      row.actual_end = spClock_(p.end);
      row.source += ' · PSI punches';
      var late = spMinutes_(s.start) === null || p.start === null ? null : p.start - spMinutes_(s.start);
      var shown = take(s.date, 'late_show'), home = take(s.date, 'sent_home');
      if (late !== null && late > SP_PERF_TARDY_MIN) { row.status = 'tardy'; row.details = late + ' minutes after the scheduled start'; }
      else if (shown) { row.status = 'tardy'; row.details = shown.late ? 'Late by ' + shown.late : 'Late show reported'; row.source += ' · ' + shown.source; }
      else if (home) { row.status = 'sent_home'; row.details = home.note || 'Sent home'; row.source += ' · ' + home.source; }
      else row.status = late === null ? 'worked' : 'present';
    } else {
      var co = take(s.date, 'call_off'), ns = co ? null : take(s.date, 'no_show'), ls = co || ns ? null : take(s.date, 'late_show');
      var ev = co || ns || ls;
      row.status = co ? 'call_out' : (ns ? 'ncns' : (ls ? 'tardy' : 'no_punch'));
      if (ev) {
        row.notice = ev.kind === 'late_show' ? '' : ev.at;
        row.details = ev.kind === 'late_show' ? (ev.late ? 'Late by ' + ev.late : 'Late show reported') : ev.note;
        row.source += ' · ' + ev.source;
      } else row.details = 'No punch on record for this shift';
    }
    rows.push(row);
  });
  var STATUS_OF = { call_off: 'call_out', no_show: 'ncns', late_show: 'tardy', sent_home: 'sent_home' };
  Object.keys(told).forEach(function (day) {
    (told[day] || []).forEach(function (e) {
      if (used[day + '|' + e.kind]) return;
      used[day + '|' + e.kind] = true;
      var row = rowOf(day, '', '', '', e.source);
      row.status = STATUS_OF[e.kind];
      row.notice = e.kind === 'call_off' || e.kind === 'no_show' ? e.at : '';
      row.details = e.kind === 'late_show' ? (e.late ? 'Late by ' + e.late : 'Late show reported') : e.note;
      rows.push(row);
    });
  });
  away.forEach(function (a) {
    var row = rowOf(a.date, a.house, '', '', 'Scheduling');
    row.status = 'time_off';
    row.details = a.words;
    rows.push(row);
  });
  rows.sort(function (a, b) { return a.date === b.date ? a.house.localeCompare(b.house) : (a.date < b.date ? 1 : -1); });
  var n = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
  var counts = { present: n('present'), worked: n('worked'), tardy: n('tardy'), call_outs: n('call_out'), ncns: n('ncns'),
                 other: n('time_off') + n('sent_home'), no_punch: n('no_punch'), scheduled: Object.keys(shifts).length };
  var base = counts.present + counts.tardy + counts.call_outs + counts.ncns;
  return { connected: src, counts: counts, reliability: base ? Math.round(counts.present * 100 / base) : null,
           tardy_minutes: SP_PERF_TARDY_MIN, rows: rows.slice(0, SP_PERF_ROWS_CAP), entries: entries,
           why: why.filter(String).join('; ') };
}

function spPerfArea_(id, label, source, connected, c, why) {
  var onTime = Math.max(0, c.complete - c.late);
  return { id: id, label: label, source: source, connected: connected, expected: c.expected, complete: c.complete,
           late: c.late, missing: c.missing, on_time: onTime, rate: connected && c.expected ? Math.round(onTime * 100 / c.expected) : null,
           why: why || '' };
}

/** Daily notes per worked day, the punches as records, and the incident reports the person filed. */
function spPerfDocumentation_(ctx, since, today, att) {
  var exceptions = [];
  var flag = function (date, area, status, source, details) {
    exceptions.push({ date: date, area: area, status: status, source: source, details: details });
  };
  var punchesRead = att.connected.punches;
  var worked = {};
  att.entries.forEach(function (e) {
    if (e.date >= today) return;
    worked[e.date] = worked[e.date] || { noted: false };
    if (e.noted) worked[e.date].noted = true;
  });
  var hot = {}, hotWhy = '';
  try {
    estateRows_('dailyNotes').forEach(function (r) {
      if (!emp360NameHit_(r.dsp_name, ctx.name)) return;
      var day = spDay_(r.reporting_date) || spOhioDay_(r.timestamp);
      if (!day || day < since || day > today) return;
      var filed = spOhioDay_(r.timestamp) || day;
      var h = hot[day] || (hot[day] = { onTime: false, late: false });
      if (filed > day) h.late = true; else h.onTime = true;
    });
  } catch (eN) { hotWhy = spWhy_('the Employee Hotline daily notes', eN); }
  var dn = { expected: 0, complete: 0, late: 0, missing: 0 };
  if (punchesRead) {
    Object.keys(worked).sort().forEach(function (day) {
      dn.expected++;
      var h = hot[day];
      if (worked[day].noted || (h && h.onTime)) dn.complete++;
      else if (h && h.late) { dn.complete++; dn.late++; flag(day, 'daily_notes', 'late', 'Employee Hotline', 'The daily note was filed on a later day.'); }
      else { dn.missing++; flag(day, 'daily_notes', 'missing', 'PSI / Employee Hotline', 'No daily note found for a day with punches.'); }
    });
  }
  var tt = { expected: 0, complete: 0, late: 0, missing: 0 };
  att.entries.forEach(function (e) {
    if (e.date >= today) return;
    tt.expected++;
    if (e.start === null || e.end === null) {
      tt.missing++;
      flag(e.date, 'time_tracking', 'missing', 'PSI punches', e.start === null ? 'The entry has no clock-in.' : 'The entry has no clock-out.');
      return;
    }
    if (e.returned) { tt.missing++; flag(e.date, 'time_tracking', 'returned', 'PSI punches', 'The entry was returned by a reviewer.'); return; }
    tt.complete++;
    if (e.submitted && spDaysBetween_(e.date, e.submitted) > 1) {
      tt.late++;
      flag(e.date, 'time_tracking', 'late', 'PSI punches', 'Submitted ' + spDaysBetween_(e.date, e.submitted) + ' days after the shift.');
    }
  });
  var inc = { expected: 0, complete: 0, late: 0, missing: 0 }, incWhy = '', incRead = false;
  try {
    estateRows_('uiIncidents').forEach(function (r) {
      if (clientNameKey_(r.your_name) !== ctx.key) return;
      var day = spDay_(r.incident_date) || spOhioDay_(r.timestamp);
      if (!day || day < since || day > today) return;
      inc.expected++;
      if (!spText_(r.summary_of_incident) || !spText_(r.immediate_action_taken)) {
        inc.missing++;
        flag(day, 'incidents', 'incomplete', 'Incident reports', 'The summary or the immediate action taken is blank.');
        return;
      }
      inc.complete++;
      var filed = spDay_(r.incident_reported_date) || spOhioDay_(r.timestamp);
      var gap = filed ? spDaysBetween_(day, filed) : 0;
      if (gap > 1) { inc.late++; flag(day, 'incidents', 'late', 'Incident reports', 'Filed ' + gap + ' days after the incident.'); }
    });
    incRead = true;
  } catch (eI) { incWhy = spWhy_('the incident reports', eI); }
  exceptions.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  var noPunches = punchesRead ? '' : 'the PSI punches could not be read';
  var areas = [
    spPerfArea_('daily_notes', 'Daily notes', 'PSI / Employee Hotline', punchesRead, dn, [noPunches, hotWhy].filter(String).join('; ')),
    spPerfArea_('time_tracking', 'Time tracking', 'PSI punches', punchesRead, tt, noPunches),
    spPerfArea_('incidents', 'Incident documentation', 'Incident reports', incRead, inc, incWhy)
  ];
  var exp = 0, ok = 0;
  areas.forEach(function (a) { if (a.connected) { exp += a.expected; ok += a.on_time; } });
  return { areas: areas, exceptions: exceptions.slice(0, SP_PERF_ROWS_CAP), rate: exp ? Math.round(ok * 100 / exp) : null };
}

/** Mandatory (CPR, DODD) and value-add courses from the compliance record, the ISTs, and open training requests. */
function spPerfTraining_(ctx, notes, today) {
  var why = '', comp = null;
  try {
    comp = staffProfilesCached_('staffProfileCompliance', ctx.key, 'all', [spMedDelScope_()], function () {
      return spScrub_(spComplianceBuild_(ctx));
    });
  } catch (e) { why = spWhy_('the compliance record', e); }
  var courses = (comp && comp.training) || [];
  var line = function (t, scope) {
    return { id: t.id, label: t.label, scope: scope, state: t.state, completed: '', expires: t.expires || '',
             provider: '', note: t.tracker_word || (t.renewal ? 'Renewal: ' + (t.renewal.phase_label || 'phase ' + t.renewal.phase) : '') };
  };
  var mandatory = SP_PERF_MANDATORY.map(function (id) {
    var t = courses.filter(function (c) { return c.id === id; })[0];
    return t ? line(t, 'Organization') : { id: id, label: id.toUpperCase(), scope: 'Organization', state: comp ? 'not_on_file' : 'unread',
                                           completed: '', expires: '', provider: '', note: '' };
  });
  var valueAdd = courses.filter(function (c) {
    return SP_PERF_MANDATORY.indexOf(c.id) === -1 && c.state !== 'not_on_file' && c.state !== 'no_date';
  }).map(function (c) { return line(c, SP_PERF_SCOPES[c.id] || 'Role development'); });
  var istWhy = '';
  try {
    spIstMine_(ctx).forEach(function (r) {
      var done = locationsCell_(r.status).toLowerCase() === 'done';
      var house = locationsHouseCode_(r.house) || spText_(r.house);
      var due = spDay_(locationsCell_(r.dueDate));
      valueAdd.push({ id: 'ist_' + locationsCell_(r.id), label: 'IST · ' + spText_(r.clientName), scope: 'Client / IST' + (house ? ' · ' + house : ''),
                      state: done ? 'current' : (due && due < today ? 'overdue' : 'owed'), completed: done ? spDay_(locationsCell_(r.trainedAt)) : '',
                      expires: done ? '' : due, provider: done ? spText_(r.trainedBy, 80) : '', note: '' });
    });
  } catch (eI) { istWhy = spWhy_('the IST records', eI); }
  var current = function (list) { return list.filter(function (t) { return t.state === 'current'; }).length; };
  var areas = {};
  valueAdd.forEach(function (t) { if (t.state === 'current') areas[t.scope.split(' · ')[0]] = true; });
  var requests = (notes || []).filter(function (n) { return n.category === 'training' && n.state === 'open'; }).map(function (n) {
    return { id: n.id, priority: n.priority, details: n.details, by: n.by, at: n.at, self: hubNameFold_(n.by) === ctx.key };
  });
  var mCur = current(mandatory);
  return { mandatory: mandatory, value_add: valueAdd, requests: requests, window_days: (comp && comp.window_days) || null,
           mandatory_current: mCur, mandatory_pct: comp ? Math.round(mCur * 100 / mandatory.length) : null,
           value_add_current: current(valueAdd), value_add_areas: Object.keys(areas).length,
           connected: !!comp, why: [why, istWhy].filter(String).join('; ') };
}

/** One HR tracker row as the conduct history draws it; Category/Severity and Next review lines are read back out. */
function spHrIssueOut_(r, tz) {
  var meta = {}, body = [], follow = [], review = '';
  String(r.situation == null ? '' : r.situation).split(/\r?\n/).forEach(function (l) {
    var t = l.trim();
    var m = /^(category|severity):\s*(.+)$/i.exec(t);
    if (m) meta[m[1].toLowerCase()] = m[2].trim(); else if (t) body.push(t);
  });
  String(r.follow_up == null ? '' : r.follow_up).split(/\r?\n/).forEach(function (l) {
    var t = l.trim();
    var m = /^next review:\s*(.+)$/i.exec(t);
    if (m) review = spDay_(m[1]) || m[1].trim(); else if (t) follow.push(t);
  });
  var result = String(r.result == null ? '' : r.result).trim();
  var under = /^under review\b/i.test(result);
  var first = body[0] || '';
  var long = first.length > 140;
  return { date: spDay_(r.date, tz), title: long ? first.slice(0, 137) + '…' : (first || 'HR record'),
           description: (long ? [first] : []).concat(body.slice(1)).join('\n'), category: meta.category || '',
           severity: meta.severity || '', decision: spText_(r.disciplinary_action, 60), action: follow.join('\n'),
           outcome: under ? '' : result, next_review: review, termination: spText_(r.termination_summary, 600),
           status: under ? 'under_review' : (result ? 'resolved' : 'open') };
}

/** The HR tracker's rows naming the person, newest first. */
function spPerfHr_(ctx) {
  var handle = null;
  try { handle = staffIssueSheet_(); } catch (e) { return { connected: false, why: spWhy_('the HR tracker', e), rows: [], open: 0 }; }
  if (!handle || handle.why) return { connected: false, why: (handle && handle.why) || 'the HR tracker could not be opened', rows: [], open: 0 };
  var rows = [];
  var last = handle.sheet.getLastRow();
  if (last >= 2) {
    var tz = 'America/New_York';
    try { tz = handle.sheet.getParent().getSpreadsheetTimeZone(); } catch (eZ) { tz = 'America/New_York'; }
    handle.sheet.getRange(2, 1, last - 1, handle.keys.length).getValues().forEach(function (v) {
      var r = {};
      handle.keys.forEach(function (k, c) { if (k) r[k] = v[c]; });
      if (emp360NameHit_(r.employees_involved, ctx.name)) rows.push(spHrIssueOut_(r, tz));
    });
  }
  rows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  return { connected: true, why: '', rows: rows.slice(0, 60),
           open: rows.filter(function (r) { return r.status !== 'resolved'; }).length };
}

function spPerfBuild_(ctx) {
  var today = locationsToday_();
  var since = locationsDayShift_(today, -SP_PERF_DAYS);
  var att = spPerfAttendance_(ctx, since, today);
  var doc = spPerfDocumentation_(ctx, since, today, att);
  var notes = [], notesWhy = '';
  try {
    notes = (staffProfilesCached_('staffProfileNotes', ctx.key, 'all', [], function () { return spScrub_(spNotesBuild_(ctx)); }) || {}).notes || [];
  } catch (eN) { notesWhy = spWhy_('the staff notes', eN); }
  var training = spPerfTraining_(ctx, notes, today);
  var hr = spPerfHr_(ctx);

  var parts = [];
  if (att.reliability !== null) parts.push({ id: 'attendance', label: 'Attendance reliability', value: att.reliability, weight: SP_PERF_WEIGHTS.attendance });
  if (training.mandatory_pct !== null) parts.push({ id: 'mandatory', label: 'Mandatory training compliance', value: training.mandatory_pct, weight: SP_PERF_WEIGHTS.mandatory });
  if (doc.rate !== null) parts.push({ id: 'documentation', label: 'Documentation on time', value: doc.rate, weight: SP_PERF_WEIGHTS.documentation });
  var wsum = 0, vsum = 0;
  parts.forEach(function (p) { wsum += p.weight; vsum += p.value * p.weight; });

  var needs = [];
  var need = function (title, area, status, date, tone) { needs.push({ title: title, area: area, status: status, date: date || '', tone: tone }); };
  training.mandatory.concat(training.value_add).forEach(function (t) {
    var area = SP_PERF_MANDATORY.indexOf(t.id) !== -1 ? 'Mandatory training' : 'Value-add training';
    if (t.state === 'expired' || t.state === 'overdue') need(t.label, area, t.state === 'expired' ? 'Expired' : 'Overdue', t.expires, 'danger');
    else if (t.state === 'due_soon') need(t.label, area, 'Due soon', t.expires, 'amber');
    else if (area === 'Mandatory training' && (t.state === 'not_on_file' || t.state === 'no_date')) need(t.label, area, 'Not on file', '', 'amber');
  });
  training.requests.forEach(function (q) { need(spText_(q.details, 80), 'Training request', 'Open', spOhioDay_(q.at), 'blue'); });
  hr.rows.filter(function (r) { return r.status !== 'resolved'; }).forEach(function (r) {
    need(r.title, 'HR & conduct', r.status === 'under_review' ? 'Under review' : 'Open', r.date, 'amber');
  });
  att.rows.filter(function (r) { return r.status === 'ncns'; }).forEach(function (r) { need('No call / no show', 'Attendance', 'Recorded', r.date, 'danger'); });
  var AREA_WORDS = { daily_notes: 'Daily notes', time_tracking: 'Time tracking', incidents: 'Incident documentation' };
  doc.exceptions.slice(0, 3).forEach(function (x) {
    need(AREA_WORDS[x.area] || x.area, 'Documentation', x.status.charAt(0).toUpperCase() + x.status.slice(1), x.date, 'amber');
  });

  var activity = [];
  var act = function (at, kind, title, detail) { if (at) activity.push({ at: at, kind: kind, title: title, detail: detail || '' }); };
  notes.forEach(function (n) { act(n.at, 'note', n.category === 'training' ? 'Training requested' : 'Note added', [n.by, spText_(n.details, 160)].filter(String).join(' · ')); });
  var ATT_WORDS = { tardy: 'Tardy recorded', call_out: 'Call-out recorded', ncns: 'No call / no show', sent_home: 'Sent home', time_off: 'Time off' };
  att.rows.forEach(function (r) { if (ATT_WORDS[r.status]) act(r.date, 'attendance', ATT_WORDS[r.status], [r.house, r.details].filter(String).join(' · ')); });
  doc.exceptions.forEach(function (x) { act(x.date, 'documentation', (AREA_WORDS[x.area] || x.area) + ' · ' + x.status, x.details); });
  hr.rows.forEach(function (r) { act(r.date, 'hr', r.title, [r.category, r.status === 'under_review' ? 'Under review' : (r.status === 'resolved' ? 'Resolved' : 'Open')].filter(String).join(' · ')); });
  training.value_add.forEach(function (t) { if (t.completed) act(t.completed, 'training', t.label + ' completed', t.provider); });
  activity.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });

  var why = [att.why, training.why, hr.why, notesWhy].filter(String);
  return {
    window_days: SP_PERF_DAYS, since: since, today: today, built_at: new Date().toISOString(),
    score: { value: wsum ? Math.round(vsum / wsum) : null, parts: parts, formula: SP_PERF_FORMULA },
    attendance: { connected: att.connected, counts: att.counts, reliability: att.reliability, tardy_minutes: att.tardy_minutes,
                  rows: att.rows },
    training: training, documentation: doc, hr: hr, needs: needs.slice(0, 12), activity: activity.slice(0, 20),
    why: why.join('; '), degraded: !att.connected.punches || (!att.connected.schedule && !att.connected.scheduling)
  };
}

/** The reads this answer is built from: a write that retires one of them retires it too. */
function spPerfDeps_(key) {
  return ['sp_staffProfileCompliance_' + key, 'sp_staffProfileNotes_' + key, 'sp_staffProfileOverview_' + key,
          spIstScope_(), spIncidentsScope_(), spMedDelScope_()];
}

HUB_POLICY.staffProfilePerformance = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Performance: attendance, training, documentation and HR over the last 90 days, and the score with its formula. */
HUB_ACTIONS.staffProfilePerformance = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  // read again at least hourly: the punches, the books and the HR tracker change outside the platform
  var hour = 'h' + Utilities.formatDate(new Date(), 'America/New_York', 'yyyyMMddHH');
  var res = spServe_('staffProfilePerformance', ctx, hour, spPerfDeps_(ctx.key), 'The performance record', function () {
    return spPerfBuild_(ctx);
  });
  if (res.status === 200) hubSysLog_(str_(user.email), 'staffProfilePerformance', ctx.key, { status: 200 });
  return res;
};

HUB_POLICY.staffProfileHrIssueAdd = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' }, date: { type: 'string' }, severity: { type: 'string' }, category: { type: 'string' },
            summary: { type: 'string' }, details: { type: 'string' }, action: { type: 'string' },
            next_review: { type: 'string' } }
};
/** New HR issue: one row on the HR tracker (the Staff Issues book), Under review until HR writes its result. */
HUB_ACTIONS.staffProfileHrIssueAdd = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var p = payload || {};
  var day = spText_(p.date, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { status: 400, message: 'date: the incident day as yyyy-MM-dd.' };
  if (day > locationsToday_()) return { status: 400, message: 'date: the day it happened, never a later one.' };
  var pick = function (list, raw) {
    var want = spText_(raw).toLowerCase();
    return list.filter(function (x) { return x.toLowerCase() === want; })[0] || '';
  };
  var severity = pick(SP_HR_SEVERITIES, p.severity);
  if (!severity) return { status: 400, message: 'severity: one of ' + SP_HR_SEVERITIES.join(', ') + '.' };
  var category = pick(SP_HR_CATEGORIES, p.category);
  if (!category) return { status: 400, message: 'category: one of ' + SP_HR_CATEGORIES.join(', ') + '.' };
  var summary = spText_(p.summary);
  if (!summary) return { status: 400, message: 'summary: one line naming the concern.' };
  if (summary.length > 200) return { status: 400, message: 'summary: up to 200 characters.' };
  var details = String(p.details || '').trim();
  if (!details) return { status: 400, message: 'details: what was reported.' };
  if (details.length > 4000) return { status: 400, message: 'details: up to 4000 characters.' };
  var action = String(p.action || '').trim();
  if (action.length > 2000) return { status: 400, message: 'action: up to 2000 characters.' };
  var review = spText_(p.next_review, 20);
  if (review && !/^\d{4}-\d{2}-\d{2}$/.test(review)) return { status: 400, message: 'next_review: a day as yyyy-MM-dd.' };
  var res = HUB_ACTIONS.staffIssueAdd({
    date: day, employees_involved: ctx.name,
    situation: [summary, details, 'Category: ' + category, 'Severity: ' + severity].join('\n'),
    follow_up: [action, review ? 'Next review: ' + review : ''].filter(String).join('\n'),
    result: SP_HR_UNDER_REVIEW
  }, user);
  if (res && res.status === 200) staffProfilesBump_('staffProfilePerformance', ctx.key);
  return res;
};

// ---- texts and calls ------------------------------------------------------

/** The person's phones that name them alone: one another roster row or a company line also carries is dropped. */
function spOwnPhones_(ctx) {
  var mine = {}, shared = 0;
  spContacts_(ctx).phones.forEach(function (p) {
    var d = spDigits10_(p.value);
    if (!d || mine[d]) return;
    var others = Object.keys((ctx.phones_shared || {})[d] || {}).filter(function (k) { return k !== ctx.key; });
    var ours = false;
    try { ours = !!hubLineOurs_(d); } catch (e) { ours = false; }
    if (others.length || ours) { shared++; return; }
    mine[d] = true;
  });
  return { mine: mine, shared: shared };
}

function spLineOf_(id, quo) {
  var row = null;
  try { row = (quo ? hubLineRow_(quo) : null) || (id ? hubLineRow_(id) : null); } catch (e) { row = null; }
  var digits = /^\d{10}$/.test(id) ? id : '';
  return { label: row ? (row.name || row.e164) : (digits ? '+1' + digits : String(id || 'Unknown line')),
           owner: row && !row.shared && row.humans === 1 ? String(row.owner || '') : '' };
}

function spTextsFacts_(ctx) {
  var own = spOwnPhones_(ctx);
  var list = Object.keys(own.mine);
  var why = [];
  if (own.shared) why.push(own.shared + ' phone number(s) on this record also belong to someone else or to a company line, so texts to them are not attributed');
  if (!list.length) why.push('no phone number on this record names this person alone');
  var sheet = null;
  try { sheet = hubTabSheet_('quo_messages'); } catch (eS) { sheet = null; }
  if (!sheet) {
    return { counterparts: [], messages: [], coverage: { from: '', to: '', gaps: [] }, phones_matched: list.length,
             why: why.concat(['the texts house could not be opened']).join('; '), degraded: true };
  }
  var cols = spReadColumns_(sheet, {
    id: { names: ['message_id'] }, created: { names: ['message_created'] }, event: { names: ['event_at'] },
    received: { names: ['received_at'] }, dir: { names: ['direction'] }, from: { names: ['from_number'] },
    to: { names: ['to_number'] }, body: { names: ['body'] }, quo: { names: ['quo_number'] }
  });
  var c = cols.cols;
  var allDays = {}, lines = {}, msgs = [];
  for (var i = 0; i < cols.n; i++) {
    var at = spInstant_(c.created[i]) || spInstant_(c.event[i]) || spInstant_(c.received[i]);
    var day = spDay_(at);
    if (day) allDays[day] = true;
    if (!list.length) continue;
    var dir = String(c.dir[i] || '').trim().toLowerCase();
    var incoming = dir === 'incoming' || dir === 'inbound';
    var side = spNumbers_(incoming ? c.from[i] : c.to[i]);
    if (!side.some(function (d) { return own.mine[d]; })) continue;
    var line = spNumbers_(incoming ? c.to[i] : c.from[i]).filter(function (d) { return !own.mine[d]; })[0] ||
               String(c.quo[i] || '').trim() || 'unknown';
    var l = lines[line] || (lines[line] = { id: line, quo: String(c.quo[i] || '').trim(), count: 0, first_at: at, last_at: at });
    l.count++;
    if (at && (!l.first_at || at < l.first_at)) l.first_at = at;
    if (at && (!l.last_at || at > l.last_at)) l.last_at = at;
    msgs.push({ id: String(c.id[i] || ('row' + (i + 2))), at: at, dir: incoming ? 'in' : 'out',
                body: String(c.body[i] == null ? '' : c.body[i]).slice(0, 2000), line: line });
  }
  msgs.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  var counterparts = Object.keys(lines).map(function (k) {
    var l = lines[k], who = spLineOf_(k, l.quo);
    return { id: k, label: who.label, owner: who.owner, count: l.count, first_at: l.first_at, last_at: l.last_at };
  }).sort(function (a, b) { return a.last_at < b.last_at ? 1 : (a.last_at > b.last_at ? -1 : 0); });
  var owners = {};
  counterparts.forEach(function (x) { owners[x.id] = x.owner; });
  var days = Object.keys(allDays).sort();
  return {
    counterparts: counterparts,
    messages: msgs.slice(0, SP_TEXT_CAP).map(function (m) {
      return { id: m.id, at: m.at, dir: m.dir, body: m.body, by: m.dir === 'in' ? ctx.name : owners[m.line] || '', line: m.line };
    }),
    coverage: { from: days[0] || '', to: days[days.length - 1] || '', gaps: spGaps_(allDays, SP_GAP_DAYS) },
    phones_matched: list.length, why: why.join('; '), degraded: false
  };
}

HUB_POLICY.staffProfileTexts = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' }, with: { type: 'string' }, before: { type: 'string' } }
};
/** Texts: one conversation per company line, newest first, a page at a time; the gaps in the texts house are named. */
HUB_ACTIONS.staffProfileTexts = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var facts;
  try {
    facts = staffProfilesCached_('staffProfileTexts', ctx.key, 'all', [], function () { return spScrub_(spTextsFacts_(ctx)); });
  } catch (e) {
    return { status: 503, message: 'The texts could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
  var want = spText_(payload && payload.with, 60);
  var ids = facts.counterparts.map(function (x) { return x.id; });
  var withId = ids.indexOf(want) !== -1 ? want : (ids[0] || '');
  var before = spText_(payload && payload.before, 40);
  var thread = facts.messages.filter(function (m) { return m.line === withId && (!before || m.at < before); });
  var page = thread.slice(0, SP_TEXT_PAGE).map(function (m) { return { id: m.id, at: m.at, dir: m.dir, body: m.body, by: m.by }; });
  return { status: 200, data: { counterparts: facts.counterparts, with: withId, messages: page,
                                more: thread.length > SP_TEXT_PAGE, coverage: facts.coverage,
                                phones_matched: facts.phones_matched, why: facts.why, degraded: !!facts.degraded } };
};

function spTranscriptsBuild_(ctx) {
  var own = spOwnPhones_(ctx);
  var why = [], degraded = false;
  if (own.shared) why.push(own.shared + ' phone number(s) on this record also belong to someone else or to a company line, so calls from them are not attributed');
  var calls = {};
  var take = function (id, rec) {
    if (!id) return;
    var c = calls[id] || (calls[id] = { call_id: id, at: '', secs: '', direction: '', line: '', turns: '', kind: '', categories: [] });
    Object.keys(rec).forEach(function (k) { if (!c[k] && rec[k] !== '' && rec[k] !== null && rec[k] !== undefined) c[k] = rec[k]; });
  };
  var hotDays = {};
  var hot = null;
  try {
    var hotId = String(hubId_('HOTLINE_TRANSCRIPTS_ID') || '');
    if (hotId) hot = ssOpen_(hotId).getSheetByName(HOTLINE_TRANSCRIPTS_TAB);
  } catch (eH) { hot = null; }
  if (!hot) { why.push('the hotline transcripts book could not be opened'); degraded = true; }
  else {
    var hc = spReadColumns_(hot, {
      id: { names: ['Call ID'], at: HOTLINE_COLS.CALL_ID }, created: { names: ['Transcript Created'], at: 1 },
      event: { names: ['Event Timestamp'], at: HOTLINE_COLS.EVENT_TS }, secs: { names: ['Duration (sec)'], at: 3 },
      who: { names: ['Participant(s)'], at: HOTLINE_COLS.PARTICIPANTS }, team: { names: ['Team Member(s)'], at: HOTLINE_COLS.TEAM },
      dir: { names: ['Direction'] }, turns: { names: ['# Turns'], at: 8 }
    });
    var h = hc.cols;
    for (var i = 0; i < hc.n; i++) {
      var at = spInstant_(h.event[i]) || spInstant_(h.created[i]);
      var day = spDay_(at);
      if (day) hotDays[day] = true;
      if (!spNumbers_(h.who[i]).some(function (d) { return own.mine[d]; })) continue;
      var team = spNumbers_(h.team[i])[0];
      take(String(h.id[i] || '').trim(), { at: at, secs: String(h.secs[i] == null ? '' : h.secs[i]),
             direction: String(h.dir[i] || '').toLowerCase(), line: team ? '+1' + team : '', turns: String(h.turns[i] == null ? '' : h.turns[i]) });
    }
  }
  try {
    var qt = hubTabSheet_('quo_transcripts');
    if (qt) {
      var qc = spReadColumns_(qt, {
        id: { names: ['call_id'] }, created: { names: ['transcript_created'] }, event: { names: ['event_at'] },
        secs: { names: ['duration_s'] }, dir: { names: ['direction'] }, turns: { names: ['turns'] },
        who: { names: ['participants'] }, team: { names: ['team_members'] }
      });
      var q = qc.cols;
      for (var j = 0; j < qc.n; j++) {
        if (!spNumbers_(q.who[j]).some(function (d) { return own.mine[d]; })) continue;
        var qteam = spNumbers_(q.team[j])[0];
        take(String(q.id[j] || '').trim(), { at: spInstant_(q.created[j]) || spInstant_(q.event[j]),
               secs: String(q.secs[j] == null ? '' : q.secs[j]), direction: String(q.dir[j] || '').toLowerCase(),
               line: qteam ? '+1' + qteam : '', turns: String(q.turns[j] == null ? '' : q.turns[j]) });
      }
    }
  } catch (eQ) { why.push(spWhy_('the transcripts house', eQ)); degraded = true; }
  try {
    var cs = hubTabSheet_(COMM_CALLS_TAB);
    if (cs) {
      var cc = spReadColumns_(cs, {
        id: { names: ['call_id'] }, at: { names: ['call_at'] }, line: { names: ['line'] }, dir: { names: ['direction'] },
        secs: { names: ['duration_sec'] }, turns: { names: ['turns'] }, person: { names: ['person_key'] }
      });
      var k = cc.cols;
      for (var n = 0; n < cc.n; n++) {
        if (hubNameFold_(k.person[n]) !== ctx.key) continue;
        var cl = spNumbers_(k.line[n])[0];
        take(String(k.id[n] || '').trim(), { at: spInstant_(k.at[n]), secs: String(k.secs[n] == null ? '' : k.secs[n]),
               direction: String(k.dir[n] || '').toLowerCase(), line: cl ? '+1' + cl : '', turns: String(k.turns[n] == null ? '' : k.turns[n]) });
      }
    }
  } catch (eC) { why.push(spWhy_('the calls house', eC)); degraded = true; }
  try {
    var ws = hubTabSheet_(COMM_WORK_ITEMS_TAB);
    if (ws && Object.keys(calls).length) {
      var wc = spReadColumns_(ws, { id: { names: ['call_id'] }, type: { names: ['work_type'] }, cat: { names: ['category'] } });
      var w = wc.cols;
      for (var x = 0; x < wc.n; x++) {
        var call = calls[String(w.id[x] || '').trim()];
        if (!call) continue;
        var type = spText_(w.type[x], 40), cat = spText_(w.cat[x], 80);
        if (type && !call.kind) call.kind = type;
        if (cat && call.categories.indexOf(cat) === -1) call.categories.push(cat);
      }
    }
  } catch (eW) { why.push(spWhy_('the call work items', eW)); }
  var list = Object.keys(calls).map(function (id) {
    var c = calls[id];
    if (!c.categories.length && c.kind) c.categories = [c.kind];
    return c;
  }).sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  var catCount = {};
  list.forEach(function (c) { c.categories.forEach(function (cat) { catCount[cat] = (catCount[cat] || 0) + 1; }); });
  return { calls: list,
           categories: Object.keys(catCount).sort().map(function (name) { return { name: name, count: catCount[name] }; }),
           gaps: spGaps_(hotDays, SP_GAP_DAYS), why: why.join('; '), degraded: degraded };
}

function spTranscripts_(ctx) {
  return staffProfilesCached_('staffProfileTranscripts', ctx.key, 'all', [], function () {
    return spScrub_(spTranscriptsBuild_(ctx));
  });
}

HUB_POLICY.staffProfileTranscripts = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Transcripts: the person's calls by date and category — metadata only; the words open one call at a time. */
HUB_ACTIONS.staffProfileTranscripts = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  try { return { status: 200, data: spTranscripts_(ctx) }; }
  catch (e) {
    return { status: 503, message: 'The calls could not be read just now (' + String((e && e.message) || e).slice(0, 120) + ').' };
  }
};

// ---- tools ----------------------------------------------------------------

function spDocKnown_(ctx, id) {
  var docs = spDocuments_(ctx);
  if ((docs.docs || []).some(function (d) { return d.file_id === id; })) return true;
  var emp = staffProfilesCached_('staffProfileEmployment', ctx.key, 'all', [spIstScope_()], function () {
    return spScrub_(spEmploymentBuild_(ctx));
  });
  return (emp.hiring && emp.hiring.resume && emp.hiring.resume.doc_id === id) ||
         (emp.qualifications && emp.qualifications.hs_diploma && emp.qualifications.hs_diploma.doc_id === id);
}

HUB_POLICY.staffProfileDocFile = {
  file: 'StaffProfiles.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' }, id: { type: 'string' } }
};
/** One of the person's documents as bytes for the platform's own viewer; only a file their Documents or Employment name. */
HUB_ACTIONS.staffProfileDocFile = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var id = spText_(payload && payload.id, 120);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { status: 400, message: 'id: a Drive file id.' };
  var known = false;
  try { known = spDocKnown_(ctx, id); }
  catch (eK) { return { status: 503, message: 'The documents could not be read just now — try again in a minute.' }; }
  if (!known) return { status: 404, message: 'This staff member names no such document.' };
  var got;
  try { got = locationsDocBytes_(id); }
  catch (e) {
    var gone = /not found|no item|does not exist|trashed/i.test(String((e && e.message) || e));
    return gone ? { status: 404, message: 'The file is no longer in the drive.' }
                : { status: 503, message: 'The document could not be opened just now — try again in a minute.' };
  }
  if (got.refused) return got.refused;
  return { status: 200, data: { id: id, name: got.name, mime: got.mime, size: got.size, exported: got.exported, b64: got.b64 } };
};

HUB_POLICY.staffProfileTranscript = {
  file: 'StaffProfiles.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' }, call_id: { type: 'string' } }
};
/** The words of one of the person's calls, the transcript door's reader (its best copy and its read log) past this gate. */
HUB_ACTIONS.staffProfileTranscript = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var callId = spText_(payload && payload.call_id, 60);
  if (!callId) return { status: 400, message: 'call_id: which call.' };
  var list;
  try { list = spTranscripts_(ctx).calls || []; }
  catch (e) { return { status: 503, message: 'The calls could not be read just now — try again in a minute.' }; }
  if (!list.some(function (c) { return c.call_id === callId; })) return { status: 404, message: 'This staff member has no such call.' };
  return commCallsTranscriptRead_(callId, user);
};

HUB_POLICY.staffProfileAssignTraining = {
  file: 'StaffProfiles.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' }, house: { type: 'string' }, due_date: { type: 'string' },
            priority: { type: 'string' }, details: { type: 'string' } }
};
// Assign Training, by a manager (HM and above), the master or the person themselves: with `details`, a training…
HUB_ACTIONS.staffProfileAssignTraining = function (payload, user) {
  if (!spTrainingAssigner_(user, payload && payload.staff)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  if (!spText_(payload && payload.house)) return spTrainingRequest_(payload, user, ctx);
  if (spTrainingAssigner_(user, ctx.key) === 'self') return { status: 403, message: 'An IST at a house is assigned by a manager.' };
  var due = spText_(payload && payload.due_date, 20);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { status: 400, message: 'due_date: a day as yyyy-MM-dd.' };
  var hx = locationsHouse_(payload && payload.house);
  if (hx.refused) return hx.refused;
  var clients = [], unplaced = [];
  var mapped = [];
  try { mapped = istHouseMap_()[hx.code] || []; } catch (eM) { mapped = []; }
  if (mapped.length) {
    // A mapped name no client answers to is reported, never turned into a row (istRebuild's rule).
    mapped.forEach(function (nm) {
      var hit = null;
      (hx.all_clients || []).forEach(function (c) { if (!hit && clientNameKey_(c.name) === clientNameKey_(nm)) hit = c; });
      if (hit) clients.push(hit); else unplaced.push(spText_(nm));
    });
  } else {
    clients = hx.clients || [];
  }
  if (!clients.length) {
    return { status: 409, message: hx.code + ' has no clients mapped — set them in Settings → IST first.' +
             (unplaced.length ? ' (' + unplaced.length + ' mapped name(s) match no client record.)' : '') };
  }
  var held = sheetDbGateHolds_('istRecords', 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var created = [], already = [];
  try {
    var have = {};
    spIstRows_().forEach(function (r) { have[istPairKey_(r.staffName, r.clientName)] = r; });
    var certNote = '';
    try { certNote = istCertNote_(certPicture_(), ctx.key); }
    catch (eC) { try { certNote = istCertNote_({}, ctx.key); } catch (eC2) { certNote = ''; } }
    var p = ctx.people || {}, a = ctx.account || {}, m = ctx.master || {};
    var today = locationsToday_();
    for (var i = 0; i < clients.length; i++) {
      var c = clients[i];
      var was = have[istPairKey_(ctx.name, c.name)];
      if (was) {
        already.push({ client_name: spText_(c.name), status: locationsCell_(was.status).toLowerCase() || 'owed',
                       house: locationsHouseCode_(was.house) || spText_(was.house) });
        continue;
      }
      var rec = {
        staffName: ctx.name, staffEmail: String(p.email || a.email || m.email || ''),
        staffPhone: String(p.phone || a.phone || m.phone || ''), avatar: String(a.avatar || p.avatar || ''),
        clientName: spText_(c.name), house: hx.code,
        dueDate: due || istLatestDate_([today, String(c.start_date || '')]),
        status: IST_STATUS_OWED, certNote: certNote,
        trainedAt: '', trainedBy: '', notifiedAt: '', notifyCount: '0', remindRequested: ''
      };
      var made = createRow_('istRecords', rec);
      var refused = sheetDbRefused_(made);
      if (refused) {
        return { status: refused.status, message: refused.message + ' — ' + created.length +
                 ' training row(s) were added before the refusal.' };
      }
      created.push({ id: String(made.id || ''), client_name: rec.clientName, due: rec.dueDate });
    }
  } finally { lock.releaseLock(); }
  ['staffProfileOverview', 'staffProfileActions', 'staffProfileActivity', 'staffProfileDocuments', 'staffProfileEmployment']
    .forEach(function (a2) { staffProfilesBump_(a2, ctx.key); });
  locationsBump_('locationStaff', hx.code);
  hubSysLog_(str_(user.email), 'staffProfileAssignTraining', ctx.key,
             { status: 200, message: created.length + ' new at ' + hx.code + ', ' + already.length + ' already' });
  return { status: 200, data: { house: hx.code, created: created, already: already, unplaced: unplaced } };
};

/** A training request: a 'training' note on the person, open until it is resolved. */
function spTrainingRequest_(payload, user, ctx) {
  var details = String((payload && payload.details) || '').trim();
  if (!details) return { status: 400, message: 'details: the training and its instructions.' };
  if (details.length > 4000) return { status: 400, message: 'details: up to 4000 characters.' };
  var priority = spText_(payload && payload.priority).toLowerCase() || 'normal';
  if (SP_NOTE_PRIORITIES.indexOf(priority) === -1) {
    return { status: 400, message: 'priority: one of ' + SP_NOTE_PRIORITIES.join(', ') + '.' };
  }
  var held = sheetDbGateHolds_(SP_NOTES_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var note;
  try {
    var sheet;
    try { sheet = spNotesSheet_(true); }
    catch (eS) { return { status: 503, message: 'The staff notes store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    note = { id: 'SN_' + Utilities.getUuid(), staff_key: ctx.key, staff_name: ctx.name, category: 'training',
             priority: priority, details: details, state: 'open', by: locationsWho_(user), at: new Date().toISOString(),
             state_by: '', state_at: '' };
    locationsAppend_(sheet, SP_NOTES_HEADER, note);
  } finally { lock.releaseLock(); }
  ['staffProfileNotes', 'staffProfileActivity', 'staffProfileOverview', 'staffProfilePerformance']
    .forEach(function (a) { staffProfilesBump_(a, ctx.key); });
  hubSysLog_(str_(user.email), 'staffProfileAssignTraining', ctx.key, { status: 200, message: 'training request' });
  return { status: 200, data: { note: note } };
}

// ---- writes ---------------------------------------------------------------

HUB_POLICY.staffProfileNoteAdd = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' }, category: { type: 'string' }, priority: { type: 'string' },
            details: { type: 'string' } }
};
/** File a staff note: category, priority and details; the filer and the time are the session's. */
HUB_ACTIONS.staffProfileNoteAdd = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var details = String((payload && payload.details) || '').trim();
  if (!details) return { status: 400, message: 'details: what the note says.' };
  if (details.length > 4000) return { status: 400, message: 'details: up to 4000 characters.' };
  var category = spText_(payload && payload.category).toLowerCase() || 'general';
  if (SP_NOTE_CATEGORIES.indexOf(category) === -1) {
    return { status: 400, message: 'category: one of ' + SP_NOTE_CATEGORIES.join(', ') + '.' };
  }
  var priority = spText_(payload && payload.priority).toLowerCase() || 'normal';
  if (SP_NOTE_PRIORITIES.indexOf(priority) === -1) {
    return { status: 400, message: 'priority: one of ' + SP_NOTE_PRIORITIES.join(', ') + '.' };
  }
  var held = sheetDbGateHolds_(SP_NOTES_TAB, 'create');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var note;
  try {
    var sheet;
    try { sheet = spNotesSheet_(true); }
    catch (eS) { return { status: 503, message: 'The staff notes store is not set up (' + String((eS && eS.message) || eS).slice(0, 120) + ').' }; }
    note = { id: 'SN_' + Utilities.getUuid(), staff_key: ctx.key, staff_name: ctx.name, category: category,
             priority: priority, details: details, state: 'open', by: locationsWho_(user), at: new Date().toISOString(),
             state_by: '', state_at: '' };
    locationsAppend_(sheet, SP_NOTES_HEADER, note);
  } finally { lock.releaseLock(); }
  ['staffProfileNotes', 'staffProfileActivity', 'staffProfileOverview'].forEach(function (a) { staffProfilesBump_(a, ctx.key); });
  hubSysLog_(str_(user.email), 'staffProfileNoteAdd', ctx.key, { status: 200 });
  return { status: 200, data: { note: note } };
};

HUB_POLICY.staffProfileNoteState = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { id: { type: 'string' }, state: { type: 'string' }, staff: { type: 'string' } }
};
/** Open or resolve a staff note; the staff key sent is the witness the row must still carry. */
HUB_ACTIONS.staffProfileNoteState = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var id = spText_(payload && payload.id, 80);
  var state = spText_(payload && payload.state).toLowerCase();
  var witness = String((payload && payload.staff) || '').trim();
  if (!id) return { status: 400, message: 'id: which note.' };
  if (SP_NOTE_STATES.indexOf(state) === -1) return { status: 400, message: 'state: open or resolved.' };
  if (!/^[a-z0-9]{3,80}$/.test(witness)) return { status: 400, message: 'staff: a staff key.' };
  var held = sheetDbGateHolds_(SP_NOTES_TAB, 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var out;
  try {
    var sheet = spNotesSheet_(false);
    if (!sheet) return { status: 404, message: 'No staff note "' + id + '".' };
    var head = ensureHeader_(sheet, SP_NOTES_HEADER);
    var values = sheet.getDataRange().getValues();
    var at = -1;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][head.indexOf('id')] || '').trim() === id) { at = r; break; }
    }
    if (at === -1) return { status: 404, message: 'No staff note "' + id + '".' };
    var key = String(values[at][head.indexOf('staff_key')] || '').trim();
    if (key !== witness) return { status: 409, message: 'That note belongs to another staff member — reload the profile.' };
    var stamp = new Date().toISOString();
    // Three cells only: a row read back loses the quote that keeps its text from being a formula.
    sheet.getRange(at + 1, head.indexOf('state') + 1).setValue(state);
    sheet.getRange(at + 1, head.indexOf('state_by') + 1).setValue(hubCellSafe_(locationsWho_(user)));
    sheet.getRange(at + 1, head.indexOf('state_at') + 1).setValue(stamp);
    out = { id: id, staff_key: key, state: state, state_by: locationsWho_(user), state_at: stamp };
  } finally { lock.releaseLock(); }
  ['staffProfileNotes', 'staffProfileActivity', 'staffProfileOverview'].forEach(function (a) { staffProfilesBump_(a, out.staff_key); });
  hubSysLog_(str_(user.email), 'staffProfileNoteState', out.staff_key, { status: 200 });
  return { status: 200, data: { note: out } };
};

HUB_POLICY.staffProfileVisit = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  // a section opened changes the Activity alone: every other read of the app stays as it was
  touches: ['staffProfileActivity'],
  params: { staff: { type: 'string' }, section: { type: 'string' } }
};
/** Who visited the profile: one row per visitor, person and section in a quiet window; never logged elsewhere. */
HUB_ACTIONS.staffProfileVisit = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  // An acting session, a visit or the service identity is never recorded.
  var acting = false;
  try { acting = !!beAnotherActive_(); } catch (eB) { acting = true; }
  if (acting || !user || user.visiting_member || user.is_service ||
      (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX)) {
    return { status: 200, data: { recorded: false } };
  }
  var section = spText_(payload && payload.section).toLowerCase();
  if (SP_VISIT_SECTIONS.indexOf(section) === -1) {
    return { status: 400, message: 'section: one of ' + SP_VISIT_SECTIONS.join(', ') + '.' };
  }
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var email = str_(user.email).toLowerCase();
  var quietKey = 'spv_' + clientNameKey_(email) + '_' + ctx.key + '_' + section;
  var cache = null;
  try { cache = CacheService.getScriptCache(); if (cache.get(quietKey)) return { status: 200, data: { recorded: false } }; }
  catch (eC) { cache = null; }
  if (sheetDbGateHolds_(SP_VISITS_TAB, 'create')) {
    // held once per window, like a recorded visit: the funnel's own held note is never repeated per section open
    try { if (cache) cache.put(quietKey, '1', SP_VISIT_QUIET_SECONDS); } catch (eQ) { /* the next open asks again */ }
    return { status: 200, data: { recorded: false } };
  }
  try {
    var sheet = spVisitsSheet_(true);
    locationsAppend_(sheet, SP_VISITS_HEADER, {
      id: 'SV_' + Utilities.getUuid(), staff_key: ctx.key, staff_name: ctx.name, section: section,
      visitor_email: email, visitor_name: locationsWho_(user), at: new Date().toISOString()
    });
  } catch (eW) {
    return { status: 503, message: 'The visit could not be recorded (' + String((eW && eW.message) || eW).slice(0, 120) + ').' };
  }
  try { if (cache) cache.put(quietKey, '1', SP_VISIT_QUIET_SECONDS); } catch (eP) { /* the next visit writes again */ }
  staffProfilesBump_('staffProfileActivity', ctx.key);
  return { status: 200, data: { recorded: true } };
};

// ---- the record edit -------------------------------------------------------

/** Why a field is not written for this person; '' when its store can take it. */
function spEditRefusal_(ctx, field) {
  if (spOwn_(SP_EDIT_LOCKED, field)) return SP_EDIT_LOCKED[field];
  var known = Object.keys(SP_EDIT_SECTIONS).some(function (s) { return SP_EDIT_SECTIONS[s].indexOf(field) !== -1; });
  if (!known) return 'Not a field this app edits.';
  if (SP_EDIT_ACCOUNT.indexOf(field) !== -1) {
    if (ctx.account) return '';
    if (field === 'avatar' && ctx.people && ctx.people.id) return '';
    return ctx.account_why || 'No platform account is matched to this person.';
  }
  if (!ctx.master) return ctx.master_why || 'No Employee Database row is read for this person.';
  if (!ctx.master_cols[field]) return 'The Employee Database has no column for this field.';
  if (!ctx.master.employee_id && !(ctx.people && ctx.people.id)) {
    return 'Neither an Employee ID nor a People row points at this person\'s Employee Database row.';
  }
  return '';
}

/** The sign-in account's edits on its own row, under the script lock: each witnessed by the live cells, then written. */
function spAccountEdit_(uid, list, confirmLogin) {
  var res = { written: [], refused: [], stale: {} };
  var refuseAll = function (why) { list.forEach(function (c) { res.refused.push({ field: c.field, why: why }); }); return res; };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (eL) { return refuseAll('Another update is in progress — try again.'); }
  try {
    ensureUserProfileColumns_();
    var sheet = hubSheet_(USERS_TAB);
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('userid');
    var r = -1;
    for (var i = 1; i < values.length && r === -1; i++) if (str_(values[i][iId]) === uid) r = i;
    if (r === -1) return refuseAll('The account was not found.');
    var cell = function (k) { var c = hdr.indexOf(k); return c === -1 ? '' : values[r][c]; };
    var set = function (k, v) { var c = hdr.indexOf(k); if (c !== -1) sheet.getRange(r + 1, c + 1).setValue(v); };
    var live = spAccountEditRaw_({
      phones: profileCleanPhones_(profileParsePhones_(cell('phones'))).map(function (p) { return { label: p.label, value: p.number }; }),
      emails: profileCleanEmails_(cell('emails')), avatar: str_(cell('avatar')), email: str_(cell('email'))
    });
    list.forEach(function (c) {
      var stale = hubEditWitness_(c.field, c.expected, live[c.field]);
      if (stale) { res.stale[c.field] = stale.data.current; return; }
      var refuse = function (why) { res.refused.push({ field: c.field, why: why }); };
      if (c.field === 'login_email') {
        var mail = c.value.toLowerCase();
        if (!confirmLogin) return refuse('The sign-in e-mail changes only with its confirmation ticked.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return refuse('Not an e-mail address.');
        var taken = usersAll_().some(function (u) {
          return str_(u.userid) !== uid && !str_(u.mergedinto) && str_(u.email).toLowerCase() === mail;
        });
        if (taken) return refuse('Another account signs in with that e-mail.');
        set('email', mail);
      } else if (c.field === 'avatar') {
        if (c.value && !/^https:\/\//i.test(c.value)) return refuse('A photo is an https:// link.');
        hubUserFieldsWrite_({ avatar: c.value }, set);
      } else if (c.field === 'account_phones') {
        hubUserFieldsWrite_({ phones: profileParsePhones_(c.value) }, set);
      } else {
        hubUserFieldsWrite_({ emails: c.value }, set);
      }
      res.written.push({ field: c.field, before: c.expected, after: c.value });
    });
  } finally {
    lock.releaseLock();
  }
  if (res.written.length) {
    try { usersRowsBump_(); } catch (eU) { /* a fresh execution reads the tab again */ }
    try { if (typeof profileStoreStale_ === 'function') profileStoreStale_(uid); } catch (eS) { /* heals on its own clock */ }
  }
  return res;
}

HUB_POLICY.staffProfileEdit = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { key: { type: 'string' }, changes: { type: 'array' }, confirm_login_email: { type: 'boolean' } }
};
// Edit the record: each changed field goes to the store that owns it — an Employee Database Master column, or the…
HUB_ACTIONS.staffProfileEdit = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.key);
  if (ctx.refused) return ctx.refused;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var written = [], refused = [], stale = {}, account = [];
  asked.changes.forEach(function (c) {
    var why = spEditRefusal_(ctx, c.field);
    if (why) { refused.push({ field: c.field, why: why }); return; }
    if (SP_EDIT_ACCOUNT.indexOf(c.field) !== -1) { account.push(c); return; }
    var col = ctx.master_cols[c.field];
    var at = ctx.master.employee_id ? { employeeId: ctx.master.employee_id } : { personId: String(ctx.people.id) };
    var r = emp360WriteCell_({ employeeId: at.employeeId, personId: at.personId, field: col.head, value: c.value,
                               expected: c.expected }, user, true, col.at);
    if (r && r.status === 200) written.push({ field: c.field, before: c.expected, after: c.value });
    else if (r && r.status === 409 && r.data && r.data.current !== undefined) stale[c.field] = String(r.data.current);
    else refused.push({ field: c.field, why: String((r && r.message) || 'Not written.') });
  });
  if (account.length && ctx.account) {
    var a = spAccountEdit_(ctx.account.user_id, account, payload.confirm_login_email === true);
    written = written.concat(a.written);
    refused = refused.concat(a.refused);
    Object.keys(a.stale).forEach(function (f) { stale[f] = a.stale[f]; });
  }
  // the photo is the Hub's own People column too: the contacts sync never rewrites it
  var photo = account.filter(function (c) { return c.field === 'avatar'; })[0];
  var photoDone = written.some(function (w) { return w.field === 'avatar'; });
  if (photo && ctx.people && ctx.people.id && (photoDone || !ctx.account)) {
    var held = ctx.account ? null : hubEditWitness_('avatar', photo.expected, String(ctx.people.avatar || ''));
    if (held) stale.avatar = held.data.current;
    else if (photo.value && !/^https:\/\//i.test(photo.value)) refused.push({ field: 'avatar', why: 'A photo is an https:// link.' });
    else {
      var up = null;
      try { up = updateRowById_('people', { id: String(ctx.people.id), avatar: photo.value }); }
      catch (eP) { up = { error: { message: String((eP && eP.message) || eP) } }; }
      if (up && up.error) refused.push({ field: 'avatar', why: 'The People row was not updated (' + String(up.error.message || '') + ').' });
      else if (!photoDone) written.push({ field: 'avatar', before: photo.expected, after: photo.value });
    }
  }
  if (written.length) {
    ['staffProfileOverview', 'staffProfileEmployment', 'staffProfileHr', 'staffProfileActions'].forEach(function (a) {
      staffProfilesBump_(a, ctx.key);
    });
    staffProfilesBump_('staffProfileRoster', 'all');
    hubEditLog_(user, 'staffProfileEdit', ctx.key, written, SP_EDIT_PLAIN);
  }
  var data = { written: written.map(function (w) { return w.field; }), refused: refused };
  if (Object.keys(stale).length) {
    data.current = stale;
    return { status: 409, data: data,
             message: written.length ? 'Some fields changed since the panel was opened — reloaded; the others were saved.'
                                     : 'Changed since the panel was opened — reloaded, nothing was written.' };
  }
  return { status: 200, data: data };
};

/** A door's answer: the reads it touched made stale, one audit line, and a 409 carrying what a stale field holds now. */
function spEditAnswer_(user, action, key, written, refused, stale, plain, reads) {
  if (written.length) {
    reads.forEach(function (a) { staffProfilesBump_(a, key); });
    hubEditLog_(user, action, key, written, plain);
  }
  var data = { written: written.map(function (w) { return w.field; }), refused: refused };
  if (Object.keys(stale).length) {
    data.current = stale;
    return { status: 409, data: data,
             message: written.length ? 'Some fields changed since the panel was opened — reloaded; the others were saved.'
                                     : 'Changed since the panel was opened — reloaded, nothing was written.' };
  }
  return { status: 200, data: data };
}

function spEditLock_() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (eL) { return null; }
  return lock;
}

// ---- the own address (My Profile → My Info) ----------------------------------

// The Master columns a person keeps up to date on their own record; these two doors read and write nothing else.
var SP_ADDRESS_FIELDS = ['address', 'city', 'state', 'zip'];
var SP_ADDRESS_APP = 'my-profile';
var SP_ADDRESS_WORDS = {
  session: 'An address is read and changed from a person\'s own session.',
  visit: 'Your address is read and changed from your own session, not inside a visit.',
  gate: 'My Profile is not open to this account in App Control, so no address is read or changed here.',
  others: 'Only your own address is read or changed here.',
  bridged: 'Your account reaches your roster row only through an e-mail written on the roster, so your address is not ' +
           'shown or changed from this session — HR updates it, or an administrator gives your account the exact name ' +
           'on your roster row.',
  untold: 'Your staff record could not be told apart from another, so your address is not shown or changed here — HR ' +
          'can settle which record is yours.',
  only: 'Only the street address, city, state and zip are changed here.',
  blank: 'A blank value is not saved here — HR clears it.',
  address: 'A street address: up to 120 characters, with a letter in it.',
  city: 'A city name: letters, spaces, periods, apostrophes and hyphens.',
  state: 'A two-letter US state, such as OH.',
  zip: 'A 5-digit zip, or ZIP+4 (12345-6789).'
};

/** Why a value is not taken for an address field ('' when it is): never blank, the state as its two capitals. */
function spAddressBad_(field, value) {
  var v = String(value == null ? '' : value);
  if (!v.trim()) return SP_ADDRESS_WORDS.blank;
  if (field === 'address') return v.length <= 120 && /[A-Za-z]/.test(v) && !/[\r\n\t]/.test(v) ? '' : SP_ADDRESS_WORDS.address;
  if (field === 'city') return /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'’-]{0,59}$/.test(v) ? '' : SP_ADDRESS_WORDS.city;
  if (field === 'state') return /^[A-Z]{2}$/.test(v) && SP_US_STATES.indexOf(v) !== -1 ? '' : SP_ADDRESS_WORDS.state;
  if (field === 'zip') return /^\d{5}(-\d{4})?$/.test(v) ? '' : SP_ADDRESS_WORDS.zip;
  return SP_ADDRESS_WORDS.only;
}

// Whose address a call reads or writes — FAIL-CLOSED, decided from the session alone: the staff key the real master…
function spAddressSubject_(payload, user) {
  if (!user || user.is_service) return { refused: { status: 403, message: SP_ADDRESS_WORDS.session } };
  if (complianceDocsVisit_(user)) return { refused: { status: 403, message: SP_ADDRESS_WORDS.visit } };
  var g = null;
  try { g = hubProfileAppGate_(SP_ADDRESS_APP, user); } catch (eG) { g = null; }
  if (!g || g.open !== true) return { refused: { status: 403, message: SP_ADDRESS_WORDS.gate } };
  var asked = String((payload && payload.key) == null ? '' : payload.key).trim();
  if (asked) {
    if (!staffProfilesMaster_(user)) return { refused: { status: 403, message: SP_ADDRESS_WORDS.others } };
    var chosen = staffProfilesPerson_(asked);
    return chosen.refused ? { refused: chosen.refused } : { ctx: chosen, own: false };
  }
  var self = complianceDocsSelf_(user);
  if (!self.key) return { refused: { status: self.status, message: self.why } };
  if (self.bridged) return { refused: { status: 403, message: SP_ADDRESS_WORDS.bridged } };
  var ctx = staffProfilesPerson_(self.key);
  if (ctx.refused) return { refused: ctx.refused };
  // the staff record read must be the very roster row the ledger settled
  if (!ctx.people || complianceDocsRosterId_(ctx.people.id) !== self.id) {
    return { refused: { status: 409, message: SP_ADDRESS_WORDS.untold } };
  }
  return { ctx: ctx, own: true };
}

/** The address as the Master keeps it, the raw cells a save is witnessed by, and why a field may not be changed. */
function spAddressAnswer_(ctx, own) {
  var m = ctx.master || {}, raw = ctx.master_edit || {};
  var address = {}, edit = {}, locked = {};
  SP_ADDRESS_FIELDS.forEach(function (f) {
    address[f] = spText_(m[f], 200);
    if (Object.prototype.hasOwnProperty.call(raw, f)) edit[f] = String(raw[f] == null ? '' : raw[f]);
    var why = spEditRefusal_(ctx, f);
    if (why) locked[f] = why;
  });
  var open = SP_ADDRESS_FIELDS.filter(function (f) { return !locked[f] && Object.prototype.hasOwnProperty.call(edit, f); });
  var shut = SP_ADDRESS_FIELDS.map(function (f) { return locked[f]; }).filter(String)[0] || '';
  return { staff_key: ctx.key, name: ctx.name, own: own, read: !!ctx.master, address: address, edit: edit, locked: locked,
           allowed: open.length > 0, why: open.length ? '' : (shut || 'The Employee Database has no address column.') };
}

HUB_POLICY.staffProfileAddress = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { key: { type: 'string' } }
};
// My Profile's address: the Employee Database Master's street, city, state and zip on the caller's own staff…
HUB_ACTIONS.staffProfileAddress = function (payload, user) {
  var who = spAddressSubject_(payload, user);
  if (who.refused) return who.refused;
  if (!who.own) hubSysLog_(str_(user.email), 'staffProfileAddress', who.ctx.key, { status: 200 });
  return { status: 200, data: spScrub_(spAddressAnswer_(who.ctx, who.own)) };
};

HUB_POLICY.staffProfileAddressEdit = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { key: { type: 'string' }, changes: { type: 'array' } }
};
// Change the address on the Employee Database Master — street, city, state and zip only, each only while it still…
HUB_ACTIONS.staffProfileAddressEdit = function (payload, user) {
  var who = spAddressSubject_(payload, user);
  if (who.refused) return who.refused;
  var ctx = who.ctx;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var written = [], refused = [], stale = {};
  asked.changes.forEach(function (c) {
    if (SP_ADDRESS_FIELDS.indexOf(c.field) === -1) { refused.push({ field: c.field, why: SP_ADDRESS_WORDS.only }); return; }
    var value = c.field === 'state' ? c.value.toUpperCase() : c.value;
    var why = spAddressBad_(c.field, value) || spEditRefusal_(ctx, c.field);
    if (why) { refused.push({ field: c.field, why: why }); return; }
    var col = ctx.master_cols[c.field];
    var at = ctx.master.employee_id ? { employeeId: ctx.master.employee_id } : { personId: String(ctx.people.id) };
    var r = emp360WriteCell_({ employeeId: at.employeeId, personId: at.personId, field: col.head, value: value,
                               expected: c.expected }, user, true, col.at);
    if (r && r.status === 200) written.push({ field: c.field, before: c.expected, after: value });
    else if (r && r.status === 409 && r.data && r.data.current !== undefined) stale[c.field] = String(r.data.current);
    else refused.push({ field: c.field, why: String((r && r.message) || 'Not written.') });
  });
  var res = spEditAnswer_(user, 'staffProfileAddressEdit', ctx.key, written, refused, stale, [], ['staffProfileHr']);
  res.data.staff_key = ctx.key;
  return res;
};

// ---- the rename -------------------------------------------------------------

var SP_RENAME_FIELDS = ['first_name', 'last_name'];

/** Why the new key is someone else's ('' while it is free): a People row, a Master row or another account carries it. */
function spRenameTaken_(ctx, newKey) {
  if ((spRosterIndex_().byKey[newKey] || []).length || spOwn_(spMasterIndex_().rows, newKey)) {
    return 'Another staff record already carries that name — nothing was renamed.';
  }
  var mine = ctx.account ? ctx.account.user_id : '';
  var other = usersAll_().some(function (u) {
    return !str_(u.mergedinto) && !str_(u.clientkey) && str_(u.userid) !== mine && clientNameKey_(str_(u.displayname)) === newKey;
  });
  return other ? 'Another account already carries that name — nothing was renamed.' : '';
}

/** The account's display name, under the caller's lock. */
function spRenameAccount_(uid, name) {
  ensureUserProfileColumns_();
  var sheet = hubSheet_(USERS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid');
  var at = -1;
  for (var r = 1; r < values.length && at === -1; r++) if (str_(values[r][iId]) === uid) at = r;
  if (at === -1) return false;
  hubUserFieldsWrite_({ display_name: name }, function (k, v) {
    var c = hdr.indexOf(k);
    if (c !== -1) sheet.getRange(at + 1, c + 1).setValue(hubCellSafe_(v));
  });
  return true;
}

/** A tab of ours: the rows carrying the old key take the new key and name, under the caller's lock. */
function spRekeyRows_(sheet, header, oldKey, newKey, newName) {
  if (!sheet) return 0;
  var head = ensureHeader_(sheet, header);
  var iKey = head.indexOf('staff_key'), iName = head.indexOf('staff_name');
  var n = sheet.getLastRow() - 1;
  if (n < 1 || iKey === -1) return 0;
  var moved = 0;
  sheet.getRange(2, iKey + 1, n, 1).getValues().forEach(function (k, i) {
    if (String(k[0] == null ? '' : k[0]).trim() !== oldKey) return;
    sheet.getRange(i + 2, iKey + 1).setValue(newKey);
    if (iName !== -1) sheet.getRange(i + 2, iName + 1).setValue(hubCellSafe_(newName));
    moved++;
  });
  return moved;
}

HUB_POLICY.staffProfileRename = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { key: { type: 'string' }, changes: { type: 'array' } }
};
// Rename the staff member: First and Last Name on the Employee Database Master row (each witnessed), the sign-in…
HUB_ACTIONS.staffProfileRename = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.key);
  if (ctx.refused) return ctx.refused;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var refused = [], names = {}, order = [];
  asked.changes.forEach(function (c) {
    if (SP_RENAME_FIELDS.indexOf(c.field) === -1) refused.push({ field: c.field, why: 'Not a field the rename edits.' });
    else { names[c.field] = c; order.push(c.field); }
  });
  if (!order.length) return { status: 400, message: 'changes: first_name or last_name.' };
  if (!ctx.master) return { status: 409, message: ctx.master_why || 'No Employee Database row is read for this person — the name is kept there.' };
  if (!ctx.master.employee_id) {
    return { status: 409, message: 'The Employee Database row carries no Employee ID — a rename is written only to a row its id points at.' };
  }
  var cols = ctx.master_cols || {};
  if (!cols.first_name || !cols.last_name) return { status: 409, message: 'The Employee Database has no First Name or Last Name column.' };
  var raw = ctx.master_edit || {};
  var first = spText_(names.first_name ? names.first_name.value : raw.first_name, 80);
  var last = spText_(names.last_name ? names.last_name.value : raw.last_name, 80);
  var newName = spText_(first + ' ' + last);
  var newKey = clientNameKey_(newName);
  if (!first || !last || !/^[a-z0-9]{3,80}$/.test(newKey)) return { status: 400, message: 'A first and a last name are required.' };
  var held = sheetDbGateHolds_(SP_NOTES_TAB, 'update') || sheetDbGateHolds_(SP_VISITS_TAB, 'update');
  if (held) return held.error;
  if (newKey !== ctx.key) {
    var taken = '';
    try { taken = spRenameTaken_(ctx, newKey); }
    catch (eT) { return { status: 503, message: 'Whether the new name is free could not be read just now — nothing was renamed.' }; }
    if (taken) return { status: 409, message: taken };
  }
  var lock = spEditLock_();
  if (!lock) return { status: 503, message: 'Another update is in progress — try again.' };
  var written = [], stale = {}, moved = { notes: 0, visits: 0 };
  var cell = function (f, value, expected) {
    return emp360WriteCell_({ employeeId: ctx.master.employee_id, field: cols[f].head, value: value, expected: expected },
                            user, true, cols[f].at, true);
  };
  try {
    for (var i = 0; i < order.length; i++) {
      var c = names[order[i]];
      var r = cell(c.field, c.value, c.expected);
      if (r && r.status === 200) { written.push({ field: c.field, before: c.expected, after: c.value }); continue; }
      if (r && r.status === 409 && r.data && r.data.current !== undefined) stale[c.field] = String(r.data.current);
      else refused.push({ field: c.field, why: String((r && r.message) || 'Not written.') });
      break;
    }
    if (written.length < order.length) {
      // half a name is never left behind
      written.forEach(function (w) { cell(w.field, w.before, w.after); });
      written = [];
    } else {
      if (ctx.account) spRenameAccount_(ctx.account.user_id, newName);
      if (newKey !== ctx.key) {
        moved.notes = spRekeyRows_(spNotesSheet_(false), SP_NOTES_HEADER, ctx.key, newKey, newName);
        moved.visits = spRekeyRows_(spVisitsSheet_(false), SP_VISITS_HEADER, ctx.key, newKey, newName);
        try { moved.preferences = spRekeyRows_(spPrefsSheet_(), SP_PREFS_HEADER, ctx.key, newKey, newName); }
        catch (eP) { moved.preferences = 0; }
        cacheBump_(SP_PREFS_INDEX_SCOPE);
      }
    }
  } finally { lock.releaseLock(); }
  if (written.length) {
    try { usersRowsBump_(); } catch (eU) { /* a fresh execution reads the tab again */ }
    try { if (ctx.account && typeof profileStoreStale_ === 'function') profileStoreStale_(ctx.account.user_id); }
    catch (eS) { /* heals on its own clock */ }
    SP_ACTIONS.slice(0, 12).concat(['staffProfilePreferences'])
      .forEach(function (a) { staffProfilesBump_(a, ctx.key); staffProfilesBump_(a, newKey); });
    staffProfilesBump_('staffProfileRoster', 'all');
  }
  var res = spEditAnswer_(user, 'staffProfileRename', ctx.key + ' → ' + newKey, written, refused, stale, [], []);
  if (written.length) {
    res.data.key = newKey;
    res.data.name = newName;
    res.data.moved = moved;
  }
  return res;
};

// ---- the driving record ----------------------------------------------------

// The driving tabs' cells the door writes, by field: the tab and its SP_DRIVER_FIELDS id. The licence number never.
var SP_DRIVING_EDIT = {
  driver: { tab: SP_DRIVER_TAB, id: 'driver' }, points: { tab: SP_DRIVER_TAB, id: 'points' },
  license_exp: { tab: SP_DRIVER_TAB, id: 'license_exp' }, abstract_original: { tab: SP_DRIVER_TAB, id: 'abstract_original' },
  abstract_latest: { tab: SP_DRIVER_TAB, id: 'abstract_latest' }, insurance_exp: { tab: SP_DRIVER_TAB, id: 'insurance_exp' },
  standing: { tab: SP_DRIVER_COMPLIANCE_TAB, id: 'driver' }
};
var SP_DRIVING_PLAIN = ['driver', 'points', 'license_exp', 'abstract_original', 'abstract_latest', 'insurance_exp', 'standing'];

/** A driving cell as the read shows it: the witness the panel sends back. */
function spDrivingShown_(fields, id) {
  if (id === 'points') return fields.points !== null && fields.points !== undefined ? String(fields.points) : String(fields.points_note || '');
  return String(fields[id] == null ? '' : fields[id]);
}

HUB_POLICY.staffProfileDrivingEdit = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { key: { type: 'string' }, changes: { type: 'array' } }
};
// Edit the driving record: the employee driver tab's facts and the Driver Compliance tab's standing word, each on…
HUB_ACTIONS.staffProfileDrivingEdit = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.key);
  if (ctx.refused) return ctx.refused;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var written = [], refused = [], stale = {}, byTab = {};
  asked.changes.forEach(function (c) {
    if (c.field === 'dl') return refused.push({ field: c.field, why: SP_EDIT_PROTECTED });
    if (!spOwn_(SP_DRIVING_EDIT, c.field)) return refused.push({ field: c.field, why: 'Not a field the driving record edits.' });
    var tab = SP_DRIVING_EDIT[c.field].tab;
    (byTab[tab] = byTab[tab] || []).push(c);
  });
  var tabs = Object.keys(byTab);
  if (tabs.length) {
    var bookId = String(empDbId_() || '');
    var lock = spEditLock_();
    if (!lock) return { status: 503, message: 'Another update is in progress — try again.' };
    try {
      var ss = bookId ? ssOpen_(bookId) : null;
      var tz = '';
      try { tz = ss ? String(ss.getSpreadsheetTimeZone() || '') : ''; } catch (eZ) { tz = ''; }
      tabs.forEach(function (tab) {
        var list = byTab[tab];
        var refuseAll = function (why) { list.forEach(function (c) { refused.push({ field: c.field, why: why }); }); };
        var sheet = ss ? ss.getSheetByName(tab) : null;
        if (!sheet) return refuseAll('The Employee Database has no ' + tab + ' tab.');
        var idx = spDriverIndexFrom_(sheet.getDataRange().getValues(), tz || 'America/New_York');
        var hit = spOwn_(idx.rows, ctx.key) ? idx.rows[ctx.key] : null;
        if (!hit) return refuseAll('No row of the ' + tab + ' tab names this person.');
        if (hit.ambiguous) return refuseAll('Two rows of the ' + tab + ' tab carry this name, so neither is written.');
        list.forEach(function (c) {
          var id = SP_DRIVING_EDIT[c.field].id;
          var col = idx.cols[id];
          if (col === undefined) return refused.push({ field: c.field, why: 'The ' + tab + ' tab has no column for this field.' });
          var was = hubEditWitness_(c.field, c.expected, spDrivingShown_(hit.fields, id));
          if (was) { stale[c.field] = was.data.current; return; }
          var target = sheet.getRange(hit.row + 1, col + 1);
          if (target.getFormula()) return refused.push({ field: c.field, why: 'That cell computes itself from other columns.' });
          target.setValue(hubCellSafe_(c.value));
          written.push({ field: c.field, before: c.expected, after: c.value });
        });
        cacheBump_(cacheScopeSheet_(bookId, tab));
      });
    } finally { lock.releaseLock(); }
  }
  return spEditAnswer_(user, 'staffProfileDrivingEdit', ctx.key, written, refused, stale, SP_DRIVING_PLAIN,
                       ['staffProfileOverview', 'staffProfileCompliance']);
};

// ---- the MAIS record ---------------------------------------------------------

// The MAIS line's cells the door writes, by field: the spec the read takes it from. DD ID and DOB never.
var SP_MAIS_EDIT = { status: 'status', effective: 'effective', expires: 'expires' };

/** The one column a spec reads on this row: the first alternative holding a value, else the first the header has; -1 when it joins columns. */
function spMaisColumn_(keys, line, spec, tz) {
  var first = -1;
  var alts = String(spec || '').split('|');
  for (var a = 0; a < alts.length; a++) {
    var parts = alts[a].split('+').map(function (s) { return String(s).trim(); });
    var cols = parts.map(function (p) { return keys.indexOf(p); });
    var holds = cols.some(function (c) { return c !== -1 && String(estateCell_(line[c], tz)).trim(); });
    if (holds) return parts.length > 1 ? -1 : cols[0];
    if (first === -1 && parts.length === 1 && cols[0] !== -1) first = cols[0];
  }
  return first;
}

HUB_POLICY.staffProfileMaisEdit = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { key: { type: 'string' }, level: { type: 'string' }, changes: { type: 'array' } }
};
// Edit a MAIS line: the Status word and the Effective and Expiration days of the latest record the profile shows…
HUB_ACTIONS.staffProfileMaisEdit = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.key);
  if (ctx.refused) return ctx.refused;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var level = spText_(payload && payload.level, 40);
  if (!level) return { status: 400, message: 'level: which Cat level.' };
  var written = [], refused = [], stale = {}, list = [];
  asked.changes.forEach(function (c) {
    if (!spOwn_(SP_MAIS_EDIT, c.field)) refused.push({ field: c.field, why: 'Not a field the MAIS line edits.' });
    else list.push(c);
  });
  if (list.length) {
    var bookId = String(hubId_('CERT_SOURCE_ID') || '');
    var tab = certSourceTab_('mais');
    var lock = spEditLock_();
    if (!lock) return { status: 503, message: 'Another update is in progress — try again.' };
    try {
      var refuseAll = function (why) { list.forEach(function (c) { refused.push({ field: c.field, why: why }); }); };
      var ss = bookId ? ssOpen_(bookId) : null;
      var sheet = ss ? ss.getSheetByName(tab) : null;
      if (!sheet) refuseAll('The book has no ' + tab + ' tab.');
      else {
        var tz = ss.getSpreadsheetTimeZone();
        var values = sheet.getDataRange().getValues();
        var keys = (values[0] || []).map(estateKey_);
        var rows = [];
        for (var i = 1; i < values.length; i++) {
          var row = { _row: i }, empty = true;
          for (var k = 0; k < keys.length; k++) {
            if (!keys[k]) continue;
            var v = estateCell_(values[i][k], tz);
            if (v) empty = false;
            row[keys[k]] = v;
          }
          if (!empty) rows.push(row);
        }
        var mais = spMaisFrom_(rows, ctx.key, locationsToday_(), 0);
        var cert = mais.ambiguous ? null : mais.certs.filter(function (x) { return x.level === level; })[0];
        if (mais.ambiguous) refuseAll(mais.why || 'The MAIS record is ambiguous, so nothing is written.');
        else if (!cert || cert.row === undefined) refuseAll('No MAIS line of that Cat level names this person.');
        else {
          var F = spMaisSpecs_();
          var spec = { status: F.status, effective: SP_MAIS_EFFECTIVE, expires: F.expires };
          var shown = { status: cert.word, effective: cert.effective, expires: cert.expires };
          list.forEach(function (c) {
            var col = spMaisColumn_(keys, values[cert.row], spec[c.field], tz);
            if (col === -1) return refused.push({ field: c.field, why: 'The MAIS tab has no single column for this field.' });
            var was = hubEditWitness_(c.field, c.expected, shown[c.field]);
            if (was) { stale[c.field] = was.data.current; return; }
            var target = sheet.getRange(cert.row + 1, col + 1);
            if (target.getFormula()) return refused.push({ field: c.field, why: 'That cell computes itself from other columns.' });
            target.setValue(hubCellSafe_(c.value));
            written.push({ field: c.field, before: c.expected, after: c.value });
          });
          if (written.length) cacheBump_(cacheScopeSheet_(bookId, tab));
        }
      }
    } finally { lock.releaseLock(); }
  }
  return spEditAnswer_(user, 'staffProfileMaisEdit', ctx.key, written, refused, stale, ['status', 'effective', 'expires'],
                       ['staffProfileOverview', 'staffProfileCompliance']);
};

// ---- an IST record -----------------------------------------------------------

// The IST record's columns the door writes, by field.
var SP_IST_EDIT = { status: 'status', due: 'dueDate', trained_at: 'trainedAt' };

HUB_POLICY.staffProfileIstEdit = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { key: { type: 'string' }, id: { type: 'string' }, changes: { type: 'array' } }
};
// Edit an IST record of this person: owed or done, the due day and the trained day, through the istRecords update…
HUB_ACTIONS.staffProfileIstEdit = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.key);
  if (ctx.refused) return ctx.refused;
  var asked = hubEditChanges_(payload);
  if (asked.refused) return asked.refused;
  var id = spText_(payload && payload.id, 120);
  if (!id) return { status: 400, message: 'id: which IST record.' };
  var written = [], refused = [], stale = {}, list = [];
  asked.changes.forEach(function (c) {
    if (!spOwn_(SP_IST_EDIT, c.field)) return refused.push({ field: c.field, why: 'Not a field the IST record edits.' });
    if (c.field === 'status' && [IST_STATUS_OWED, IST_STATUS_DONE].indexOf(c.value) === -1) {
      return refused.push({ field: c.field, why: 'Owed or done.' });
    }
    if (c.field !== 'status' && c.value && !spDay_(c.value)) return refused.push({ field: c.field, why: 'A date.' });
    list.push(c);
  });
  if (list.length) {
    var held = sheetDbGateHolds_('istRecords', 'update');
    if (held) return held.error;
    var lock = locationsLock_();
    if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
    try {
      var rec = requireRow_('istRecords', id);
      if (!rec || rec.error) return { status: 404, message: 'No IST record "' + id + '".' };
      if (clientNameKey_(rec.staffName) !== ctx.key) {
        return { status: 409, message: 'That IST record names another staff member — reload the profile.' };
      }
      var shown = spIstCell_(rec, {});
      var patch = { id: id }, ready = [];
      list.forEach(function (c) {
        var was = hubEditWitness_(c.field, c.expected, shown[c.field]);
        if (was) { stale[c.field] = was.data.current; return; }
        patch[SP_IST_EDIT[c.field]] = c.value;
        ready.push({ field: c.field, before: c.expected, after: c.value });
      });
      if (ready.length) {
        var res = updateRowById_('istRecords', patch);
        var bad = sheetDbRefused_(res);
        if (bad) ready.forEach(function (w) { refused.push({ field: w.field, why: String(bad.message || 'Not written.') }); });
        else written = ready;
      }
    } finally { lock.releaseLock(); }
  }
  return spEditAnswer_(user, 'staffProfileIstEdit', ctx.key, written, refused, stale, ['status', 'due', 'trained_at'],
                       ['staffProfileOverview', 'staffProfileCompliance']);
};

// ---- preferences ------------------------------------------------------------

// One row per staff member in its own ASA Data house (one Data tab); the lists ride as JSON.
var SP_PREFS_TAB = 'staff_prefs';
var SP_PREFS_HEADER = ['staff_key', 'staff_name', 'person_id', 'employee_id', 'shifts', 'unavailable_days',
                       'unavailable_locations', 'other_locations', 'allergies', 'allergy_other', 'updated_at',
                       'updated_by', 'pickup', 'weekend_work', 'note', 'shifts_note'];
var SP_PREF_SHIFTS = ['morning', 'afternoon', 'nights'];
var SP_PREF_PICKUP = ['yes', 'no'];
var SP_PREF_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
var SP_PREF_ALLERGIES = ['cats', 'dogs', 'birds', 'dust', 'mold', 'fragrances', 'other'];
var SP_PREF_OTHER_MAX = 20;
var SP_PREFS_UNSET = 'Staff preferences are not set up yet.';

/** The house's Data tab; null while it is not set up (no pointer, or moved.staff_prefs not on). */
function spPrefsSheet_() {
  if (!houseMoved_(SP_PREFS_TAB)) return null;
  return hubTabEnsure_(SP_PREFS_TAB, SP_PREFS_HEADER);
}

function spPrefsHomesScope_() {
  try { return locationsHomesScope_(); } catch (e) { return ''; }
}

function spPrefsJson_(v) {
  try { return JSON.parse(String(v == null ? '' : v) || 'null'); } catch (e) { return null; }
}

function spPrefsStamp_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v == null ? '' : v).trim();
}

/** The words a list allows, once each, in the list's own order. */
function spPrefsPick_(list, allowed) {
  var have = {};
  (Array.isArray(list) ? list : []).forEach(function (x) { have[String(x == null ? '' : x).trim().toLowerCase()] = true; });
  return allowed.filter(function (a) { return have[a]; });
}

/** Preferences in their one shape, whatever was sent or stored. */
function spPrefsClean_(raw) {
  var p = raw && typeof raw === 'object' ? raw : {};
  var days = p.unavailable_days && typeof p.unavailable_days === 'object' ? p.unavailable_days : {};
  var codes = {}, others = [], seen = {};
  (Array.isArray(p.unavailable_locations) ? p.unavailable_locations : []).forEach(function (c) {
    var code = locationsHouseCode_(c);
    if (code) codes[code] = true;
  });
  (Array.isArray(p.other_locations) ? p.other_locations : []).forEach(function (x) {
    var s = spText_(x, 80);
    if (!s || seen[s.toLowerCase()] || others.length >= SP_PREF_OTHER_MAX) return;
    seen[s.toLowerCase()] = true;
    others.push(s);
  });
  var allergies = spPrefsPick_(p.allergies, SP_PREF_ALLERGIES);
  var pickup = spText_(p.pickup).toLowerCase();
  return {
    shifts: spPrefsPick_(p.shifts, SP_PREF_SHIFTS),
    unavailable_days: { a: spPrefsPick_(days.a, SP_PREF_DAYS), b: spPrefsPick_(days.b, SP_PREF_DAYS) },
    unavailable_locations: Object.keys(codes).sort(),
    other_locations: others,
    allergies: allergies,
    allergy_other: allergies.indexOf('other') !== -1 ? spText_(p.allergy_other, 200) : '',
    pickup: SP_PREF_PICKUP.indexOf(pickup) !== -1 ? pickup : '',
    weekend_work: spText_(p.weekend_work, 200),
    note: spText_(p.note, 500),
    shifts_note: spText_(p.shifts_note, 200)
  };
}

function spPrefsOf_(r) {
  if (!r) return spPrefsClean_({});
  return spPrefsClean_({
    shifts: spPrefsJson_(r.shifts), unavailable_days: spPrefsJson_(r.unavailable_days),
    unavailable_locations: spPrefsJson_(r.unavailable_locations), other_locations: spPrefsJson_(r.other_locations),
    allergies: spPrefsJson_(r.allergies), allergy_other: r.allergy_other, pickup: r.pickup,
    weekend_work: r.weekend_work, note: r.note, shifts_note: r.shifts_note
  });
}

/** { sheet, at, rec }: the house's tab (null while not set up) and the staff key's row (at 0, rec null for none). */
function spPrefsFind_(key) {
  var sheet = spPrefsSheet_();
  if (!sheet) return { sheet: null, at: 0, rec: null };
  var hit = null;
  locationsTabRows_(sheet).forEach(function (r) { if (!hit && String(r.staff_key || '').trim() === key) hit = r; });
  return { sheet: sheet, at: hit ? hit._row : 0, rec: hit };
}

var SP_PREFS_INDEX_SCOPE = 'sp_prefs_index';

/** What placements read, for every staff key, in one cached read; the save bumps it. {} while not set up. */
function spPrefsIndex_() {
  return cacheRead_(SP_PREFS_INDEX_SCOPE, 'v1', function () {
    var out = {};
    var sheet = spPrefsSheet_();
    if (!sheet) return out;
    locationsTabRows_(sheet).forEach(function (r) {
      var k = String(r.staff_key || '').trim();
      if (!k) return;
      var p = spPrefsOf_(r);
      if (!p.unavailable_locations.length && !p.unavailable_days.a.length && !p.unavailable_days.b.length) return;
      out[k] = { houses: p.unavailable_locations, days: p.unavailable_days };
    });
    return out;
  });
}

function spPrefsBuild_(ctx) {
  var why = [], houses = [];
  try {
    houses = locationsHomes_().map(function (h) { return { code: h.code, name: h.home_name || h.code }; });
    houses.sort(function (a, b) { return a.name.localeCompare(b.name); });
  } catch (eH) { why.push(spWhy_('the house registry', eH)); }
  var found;
  try { found = spPrefsFind_(ctx.key); }
  catch (eS) { return { ready: false, houses: houses, why: spWhy_('the staff preferences house', eS), degraded: true }; }
  // not set up: never kept, so the house answers as soon as it is minted
  if (!found.sheet) return { ready: false, houses: houses, why: SP_PREFS_UNSET, degraded: true };
  var rec = found.rec;
  return { ready: true, houses: houses, prefs: spPrefsOf_(rec),
           updated_at: rec ? spPrefsStamp_(rec.updated_at) : '', updated_by: rec ? String(rec.updated_by || '') : '',
           why: why.join('; '), degraded: why.length > 0 };
}

HUB_POLICY.staffProfilePreferences = {
  file: 'StaffProfiles.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'director', 'manager', 'staff', 'client', 'onboarding', 'interviewer'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' } }
};
/** Preferences: preferred shifts, open-shift pickup, weekend work, unavailable days (Week A and B), unavailable locations, allergies and a note, with the houses. */
HUB_ACTIONS.staffProfilePreferences = function (payload, user) {
  if (!spWholeGate_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  spPrefsShareMaybe_();
  return spServe_('staffProfilePreferences', ctx, 'all', [spPrefsHomesScope_()], 'The preferences',
                  function () { return spPrefsBuild_(ctx); });
};

HUB_POLICY.staffProfilePreferencesSave = {
  file: 'StaffProfiles.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: [],
  params: { staff: { type: 'string' }, prefs: { type: 'object' }, expected: { type: 'string' } }
};
// Save the preferences whole, only while the row still carries the updated_at the section was opened on ('' for…
HUB_ACTIONS.staffProfilePreferencesSave = function (payload, user) {
  if (!staffProfilesMaster_(user)) return staffProfilesUnknown_();
  var ctx = staffProfilesPerson_(payload && payload.staff);
  if (ctx.refused) return ctx.refused;
  var raw = payload && payload.prefs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 400, message: 'prefs: the preferences.' };
  var expected = String((payload && payload.expected) || '').trim();
  var next = spPrefsClean_(raw);
  var held = sheetDbGateHolds_(SP_PREFS_TAB, 'update');
  if (held) return held.error;
  var lock = locationsLock_();
  if (!lock) return { status: 409, message: 'Another write is in progress — try again in a moment.' };
  var who = locationsWho_(user), stamp = new Date().toISOString(), before;
  try {
    var found;
    try { found = spPrefsFind_(ctx.key); }
    catch (eS) { return { status: 503, message: spWhy_('The staff preferences house', eS) + '.' }; }
    if (!found.sheet) return { status: 503, message: SP_PREFS_UNSET };
    var was = found.rec ? spPrefsStamp_(found.rec.updated_at) : '';
    if (was !== expected) {
      return { status: 409, message: 'Changed since the section was opened — reloaded, nothing was written.',
               data: { current: { prefs: spPrefsOf_(found.rec), updated_at: was,
                                  updated_by: found.rec ? String(found.rec.updated_by || '') : '' } } };
    }
    before = spPrefsOf_(found.rec);
    // shifts_note is the imported text: read-only, the stored cell stands
    next.shifts_note = before.shifts_note;
    var rec = { staff_key: ctx.key, staff_name: ctx.name, person_id: String((ctx.people && ctx.people.id) || ''),
                employee_id: String((ctx.master && ctx.master.employee_id) || ''),
                shifts: JSON.stringify(next.shifts), unavailable_days: JSON.stringify(next.unavailable_days),
                unavailable_locations: JSON.stringify(next.unavailable_locations),
                other_locations: JSON.stringify(next.other_locations), allergies: JSON.stringify(next.allergies),
                allergy_other: next.allergy_other, pickup: next.pickup, weekend_work: next.weekend_work,
                note: next.note, updated_at: stamp, updated_by: who };
    if (found.at) {
      var head = ensureHeader_(found.sheet, SP_PREFS_HEADER);
      found.sheet.getRange(found.at, 1, 1, head.length).setValues([head.map(function (h) {
        if (Object.prototype.hasOwnProperty.call(rec, h)) return hubCellSafe_(String(rec[h]));
        var v = found.rec[h];
        return hubCellSafe_(v === undefined || v === null ? '' : v);
      })]);
    } else {
      locationsAppend_(found.sheet, SP_PREFS_HEADER, rec);
    }
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  staffProfilesBump_('staffProfilePreferences', ctx.key);
  cacheBump_(SP_PREFS_INDEX_SCOPE);
  var written = Object.keys(next).filter(function (f) { return JSON.stringify(next[f]) !== JSON.stringify(before[f]); })
    .map(function (f) { return { field: f }; });
  hubEditLog_(user, 'staffProfilePreferencesSave', ctx.key, written, []);
  spPrefsShareMaybe_();
  return { status: 200, data: { prefs: next, updated_at: stamp, updated_by: who } };
};

/** The mirror reads the house only once it is a reader: granted here, once, from the first save (as sched_inbox). */
var SP_PREFS_SHARED_PROP = 'HUB_STAFF_PREFS_SHARED';
function spPrefsShareMaybe_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(SP_PREFS_SHARED_PROP)) return;
    var cache = CacheService.getScriptCache();
    if (cache.get('sp_prefs_share_try')) return;
    cache.put('sp_prefs_share_try', '1', 600);
    var id = String(houseIdFor_(SP_PREFS_TAB) || '');
    if (!id || typeof hubGrantReader_ !== 'function') return;
    var file = { getId: function () { return id; }, getName: function () { return SP_PREFS_TAB; } };
    var said = {};
    if (hubGrantReader_(file, SCHED_INBOX_READER, said)) props.setProperty(SP_PREFS_SHARED_PROP, id);
  } catch (e) { /* the next save tries again */ }
}
