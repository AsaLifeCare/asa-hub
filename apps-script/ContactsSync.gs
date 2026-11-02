// People rows are written by id and never deleted; clients are keyed by client_key and never matched by name.
var CONTACTS_PEOPLE_SOURCE = 'ops.employees';
var CONTACTS_LABEL = 'Platform';

// Stamped only on a fresh tab; an existing house is addressed by column name.
var CONTACTS_PEOPLE_HEADER = ['id', 'name', 'first_name', 'last_name', 'role', 'status',
  'email', 'phone', 'city', 'state', 'employee_id', 'start_date', 'end_date',
  'avatar', 'source', 'source_coverage', 'external_id', 'updated_at', 'guardian_for'];

// `avatar` and `guardian_for` are the Hub's own and never touched.
var CONTACTS_PEOPLE_FIELDS = ['name', 'first_name', 'last_name', 'role', 'status',
  'email', 'phone', 'city', 'state', 'employee_id', 'start_date', 'end_date',
  'source', 'source_coverage', 'external_id', 'updated_at'];

// The same seven Profile.gs lists, so the columns are created together.
var CONTACTS_USER_COLUMNS = ['people_id', 'employee_id', 'start_date', 'end_date',
                             'roster_status', 'contact_sources', 'contact_synced_at'];

var CONTACTS_BLANK_ONLY = { phone: true, title: true, employee_id: true, start_date: true, end_date: true };

var CONTACTS_MERGE_STAMP = 'CONTACT_MERGE_AT';
var CONTACTS_MERGE_HOURS = 2;
var CONTACTS_SOURCE_STAMP = 'PEOPLE_SYNC_SOURCE_AT';
var CONTACTS_MERGE_CAP = 120;

// The three lists live in the words book; the seed is the floor, never an empty vocabulary.
var CONTACTS_INSTITUTIONAL_SEED = ['info@', 'hr@', 'admin@', 'support@', 'office@', 'billing@',
                                   'noreply@', 'no-reply@', 'payroll@', 'contact@'];

function contactsInstitutional_() {
  return (typeof hubBookList_ === 'function')
    ? hubBookList_('Contacts Institutional', 'prefix', CONTACTS_INSTITUTIONAL_SEED)
    : CONTACTS_INSTITUTIONAL_SEED;
}

// The relay applies these gates too (server/contacts_slices.py); this door applies them again before writing.
var CONTACTS_FORM_WORDS = /ssn|social security|applica|street|zip|date of birth|\bdob\b|\[|\]|home phone|mobile phone|please explain|branch|position|signature|initial|last first|p\.?o\.? box|louisville|44641|http|www\.|\.com\b|@/i;
var CONTACTS_TEST_WORDS = /\btest\b|\bteste\b|\bprobe\b|\bdiag\b|\bsample\b|\bdummy\b|\bplaceholder\b/i;
var CONTACTS_STATUS_VOCAB_SEED = ['active', 'inactive', 'archived', 'pending', 'unknown', 'other', 'admin',
                                  'onboarding', 'on leave', 'offboarding', 'terminated', 'away', 'off'];

function contactsStatusVocab_() {
  return (typeof hubBookList_ === 'function')
    ? hubBookList_('Contacts Statuses', 'status', CONTACTS_STATUS_VOCAB_SEED)
    : CONTACTS_STATUS_VOCAB_SEED;
}
var CONTACTS_ROLE_VOCAB_SEED = ['staff', 'admin', 'administrator', 'manager', 'director', 'dsp',
  'direct support professional', 'direct support professional (dsp)', 'house manager', 'hm',
  'nurse', 'rn', 'lpn', 'qidp', 'supervisor', 'division supervisor', 'coordinator',
  'software engineer', 'hr', 'finances', 'quality', 'entity', 'guardian', 'client',
  'interviewer', 'onboarding'];

function contactsRoleVocab_() {
  return (typeof hubBookList_ === 'function')
    ? hubBookList_('Contacts Roles', 'role', CONTACTS_ROLE_VOCAB_SEED)
    : CONTACTS_ROLE_VOCAB_SEED;
}
var CONTACTS_ROLE_FREE = /^[a-z][a-z /&\-().]{1,39}$/;
var CONTACTS_EMAIL = /^[a-z0-9._%+\-']+@[a-z0-9.\-]+\.[a-z]{2,}$/;
var CONTACTS_NAME_TOKEN = /^[a-z][a-z'\-.]*$/;

function contactsFold_(v) {
  var s = contactsStr_(v).replace(/\s+/g, ' ');
  try { s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { }
  return s.toLowerCase();
}

function contactsNameClean_(v) {
  var s = contactsStr_(v).replace(/\s+/g, ' ');
  if (!s || s.length > 60) return '';
  if (CONTACTS_FORM_WORDS.test(s) || CONTACTS_TEST_WORDS.test(s) || /\d/.test(s)) return '';
  var tokens = contactsFold_(s).split(' ');
  if (tokens.length < 2 || tokens.length > 5) return '';
  for (var i = 0; i < tokens.length; i++) if (!CONTACTS_NAME_TOKEN.test(tokens[i])) return '';
  return s;
}

function contactsNamePartClean_(v) {
  var s = contactsStr_(v).replace(/\s+/g, ' ');
  if (!s || CONTACTS_FORM_WORDS.test(s) || /\d/.test(s)) return '';
  var tokens = contactsFold_(s).split(' ');
  if (tokens.length < 1 || tokens.length > 3) return '';
  for (var i = 0; i < tokens.length; i++) if (!CONTACTS_NAME_TOKEN.test(tokens[i])) return '';
  return s;
}

function contactsStatusClean_(v) {
  var s = contactsFold_(v);
  if (!s || s === 'active test') return '';
  return contactsStatusVocab_().indexOf(s) !== -1 ? s : '';
}

function contactsEmailClean_(v) {
  var s = contactsFold_(v);
  if (!s || !CONTACTS_EMAIL.test(s)) return '';
  if (CONTACTS_TEST_WORDS.test(s.split('@')[0])) return '';
  return s;
}

// Shared company lines identify nobody; the loop also refuses a suffix match (a badly typed company number).
function contactsPhoneDigits_(v) {
  var d = contactsStr_(v).replace(/\D+/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  if (d.length !== 10) return '';
  if (d.charAt(0) === '0' || d.charAt(0) === '1') return '';
  var distinct = {};
  for (var i = 0; i < d.length; i++) distinct[d.charAt(i)] = true;
  if (Object.keys(distinct).length < 3) return '';
  try {
    if (typeof hubLineSharedForIdentity_ === 'function' && hubLineSharedForIdentity_(d)) return '';
  } catch (eL) { }
  if (typeof SHARED_LINE_DIGITS !== 'undefined' && SHARED_LINE_DIGITS) {
    var shared = Array.isArray(SHARED_LINE_DIGITS) ? SHARED_LINE_DIGITS : Object.keys(SHARED_LINE_DIGITS);
    for (var s = 0; s < shared.length; s++) {
      var sd = String(shared[s]).replace(/\D+/g, '');
      if (sd && (sd === d || (sd.length >= 7 && d.slice(-sd.length) === sd))) return '';
    }
  }
  return d;
}

function contactsPhoneClean_(v) {
  var d = contactsPhoneDigits_(v);
  return d ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : '';
}

function contactsDateClean_(v) {
  if (v instanceof Date) {
    var y0 = v.getUTCFullYear();
    return (y0 >= 1940 && y0 <= 2100) ? contactsStr_(v) : '';
  }
  var s = contactsStr_(v);
  if (!s) return '';
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  var y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return '';
    mo = +m[1]; d = +m[2]; y = +m[3];
    if (m[3].length === 2) y += (y < 50 ? 2000 : 1900);
  }
  if (y < 1940 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}

function contactsIdClean_(v) {
  var s = contactsStr_(v);
  return (s && /^[A-Za-z0-9][A-Za-z0-9\-_.]{0,19}$/.test(s) && !CONTACTS_FORM_WORDS.test(s)) ? s : '';
}

function contactsCityClean_(v) {
  var s = contactsStr_(v).replace(/\s+/g, ' ');
  return (s && /^[A-Za-z][A-Za-z .'\-]{1,39}$/.test(contactsFold_(s)) && !CONTACTS_FORM_WORDS.test(s)) ? s : '';
}

function contactsStateClean_(v) {
  var s = contactsStr_(v).replace(/\s+/g, ' ');
  if (!s || CONTACTS_FORM_WORDS.test(s)) return '';
  var f = contactsFold_(s);
  if (/^[a-z]{2}$/.test(f)) return s.toUpperCase();
  return /^[a-z][a-z ]{2,29}$/.test(f) ? s : '';
}

function contactsRowClean_(r) {
  if (!r || typeof r !== 'object') return null;
  var name = contactsNameClean_(r.name);
  if (!name) return null;
  return {
    id: contactsStr_(r.id).slice(0, 40),
    name: name,
    first_name: contactsNamePartClean_(r.first_name),
    last_name: contactsNamePartClean_(r.last_name),
    role: contactsRoleClean_(r.role, null),
    status: contactsStatusClean_(r.status),
    email: contactsEmailClean_(r.email),
    phone: contactsPhoneClean_(r.phone),
    city: contactsCityClean_(r.city),
    state: contactsStateClean_(r.state),
    employee_id: contactsIdClean_(r.employee_id),
    start_date: contactsDateClean_(r.start_date),
    end_date: contactsDateClean_(r.end_date),
    source: CONTACTS_PEOPLE_SOURCE,
    source_coverage: contactsStr_(r.source_coverage).replace(/[^a-z0-9,_\- ]/gi, '').slice(0, 80),
    external_id: contactsStr_(r.external_id).slice(0, 80),
    updated_at: contactsStr_(r.updated_at).slice(0, 40)
  };
}

/* ---- Pure half: no sheet, no clock ---- */

function contactsStr_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    var y = v.getUTCFullYear(), m = v.getUTCMonth() + 1, d = v.getUTCDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  return String(v).trim();
}

// An ERP-provenance role is trusted; anything else must be vocabulary or short plain words.
function contactsRoleClean_(role, provenance) {
  var r = contactsStr_(role).replace(/\s+/g, ' ');
  if (!r) return '';
  if (provenance && String(provenance.role || '') === 'erp' && !CONTACTS_FORM_WORDS.test(r)) return r.slice(0, 80);
  var low = contactsFold_(r);
  if (contactsRoleVocab_().indexOf(low) !== -1) return r;
  if (CONTACTS_FORM_WORDS.test(r) || /\d/.test(r) || !CONTACTS_ROLE_FREE.test(low)) return '';
  if (low.split(' ').length > 5) return '';
  return r;
}

function contactsEmailKey_(v) {
  var k = contactsStr_(v).toLowerCase();
  if (!k || k.indexOf('@') === -1) return '';
  var inst = contactsInstitutional_();
  for (var i = 0; i < inst.length; i++) {
    if (k.indexOf(inst[i]) === 0) return '';
  }
  return k;
}

function contactsPhonesOf_(row) {
  var out = [];
  var one = contactsStr_(row && row.phone);
  if (one) out.push(one);
  profileParsePhones_(row && row.phones).forEach(function (p) {
    var n = contactsStr_(p && p.number);
    if (n) out.push(n);
  });
  return out;
}

function contactsEmailsOf_(row) {
  var out = [];
  var one = contactsStr_(row && row.email);
  if (one) out.push(one);
  profileParseEmails_(row && row.emails).forEach(function (e) {
    var v = contactsStr_(e);
    if (v) out.push(v);
  });
  return out;
}

// Another lane's row, or a row the payload omits, is left alone: this adds and refreshes, never removes.
function contactsPeopleReconcile_(header, grid, rows) {
  var col = {};
  for (var h = 0; h < header.length; h++) col[String(header[h])] = h;
  var need = ['id', 'source'].concat(CONTACTS_PEOPLE_FIELDS);
  for (var n = 0; n < need.length; n++) {
    if (col[need[n]] === undefined) return { error: 'The People house lacks the column "' + need[n] + '".' };
  }
  var byId = {};
  for (var i = 0; i < grid.length; i++) {
    var id0 = contactsStr_(grid[i][col.id]);
    if (id0 && byId[id0] === undefined) byId[id0] = i;
  }
  var out = { changed: {}, appended: [], updated: 0, inserted: 0, unchanged: 0, foreign: 0, unnamed: 0,
              refused: 0, refused_named: [] };
  (rows || []).forEach(function (raw) {
    var r = contactsRowClean_(raw);
    if (!r) {
      var rawName = contactsStr_(raw && raw.name).slice(0, 40);
      if (!rawName) { out.unnamed++; return; }
      out.refused++;
      if (out.refused_named.length < 40) out.refused_named.push(rawName);
      return;
    }
    var id = contactsStr_(r.id);
    if (!id) { out.unnamed++; return; }
    var at = byId[id];
    if (at === undefined) {
      var line = header.map(function () { return ''; });
      line[col.id] = id;
      CONTACTS_PEOPLE_FIELDS.forEach(function (f) { line[col[f]] = contactsStr_(r[f]); });
      line[col.source] = CONTACTS_PEOPLE_SOURCE;
      out.appended.push(line);
      out.inserted++;
      return;
    }
    var cur = grid[at];
    var owner = contactsStr_(cur[col.source]);
    if (owner && owner !== CONTACTS_PEOPLE_SOURCE) { out.foreign++; return; }
    var touched = false;
    CONTACTS_PEOPLE_FIELDS.forEach(function (f) {
      var v = f === 'source' ? CONTACTS_PEOPLE_SOURCE : contactsStr_(r[f]);
      if (contactsStr_(cur[col[f]]) !== v) { cur[col[f]] = v; touched = true; }
    });
    if (touched) { out.changed[at] = true; out.updated++; } else out.unchanged++;
  });
  return out;
}

/** The roster row an account's own writing points at — a profile e-mail, a phone, the name without its middle — worded for an administrator; '' when none points at exactly one. */
function contactsMergeHint_(u, uname, byEmail, byPhone, byNoMiddle, dup) {
  var mails = profileParseEmails_(u.emails).map(contactsEmailKey_);
  for (var m = 0; m < mails.length; m++) {
    if (mails[m] && !dup.email[mails[m]] && byEmail[mails[m]]) return byEmail[mails[m]].name + ' (by a profile e-mail)';
  }
  var phones = contactsPhonesOf_(u).map(bulkPhoneKey_);
  for (var k = 0; k < phones.length; k++) {
    if (phones[k] && !dup.phone[phones[k]] && byPhone[phones[k]]) return byPhone[phones[k]].name + ' (by a phone)';
  }
  var nm = bulkNameKeyNoMiddle_(uname);
  if (nm && !dup.nomid[nm] && byNoMiddle[nm]) return byNoMiddle[nm].name + ' (by the name without its middle)';
  return '';
}

/** The on-staff statuses the merge links to (ContactGuard.gs cgBlockStatuses_, default active/admin), read by the sheet half so the plan stays pure. */
function contactsOnStaffStatuses_() {
  var s = {};
  try { s = (typeof cgBlockStatuses_ === 'function') ? cgBlockStatuses_() : {}; } catch (eS) { s = {}; }
  return Object.keys(s).length ? s : { active: true, admin: true };
}

/** What proves an account is a roster row, from what the account cannot set itself: 'email' when the row carries its sign-in address, 'name' when the row is its exact name, carries no other personal address, and the name is not one the account chose itself (Profile.gs profileUpdate, Invites.gs); '' otherwise. */
function contactsLinkProof_(u, p) {
  var signIn = contactsEmailKey_(u && u.email);
  var rowMails = contactsEmailsOf_(p).map(contactsEmailKey_).filter(String);
  if (signIn && rowMails.indexOf(signIn) !== -1) return 'email';
  if (str_(u && u.nameby).trim().toLowerCase() === 'self') return '';
  var nk = bulkNameKey_(str_(u && u.displayname));
  if (nk && nk === bulkNameKey_(p && p.name) && !rowMails.length) return 'name';
  return '';
}

// Link, sign-in e-mail, exact roster name; a key two roster people share is ambiguous, a near name only reported.
function contactsMergePlan_(users, people, now, onStaff) {
  var staff = (onStaff && typeof onStaff === 'object' && Object.keys(onStaff).length) ? onStaff : { active: true, admin: true };
  var isOnStaff = function (p) { return staff[contactsStr_(p && p.status).toLowerCase()] === true; };
  var byId = {}, byEmail = {}, byPhone = {}, byName = {}, byNoMiddle = {}, byNameAll = {};
  var dup = { email: {}, phone: {}, name: {}, nomid: {} };
  var claim = function (map, dupMap, key, p) {
    if (!key) return;
    if (map[key] && contactsStr_(map[key].id) !== contactsStr_(p.id)) { dupMap[key] = true; return; }
    map[key] = p;
  };
  (people || []).forEach(function (p) {
    var id = contactsStr_(p && p.id);
    if (!id || !contactsStr_(p.name)) return;
    byId[id] = p;
    contactsEmailsOf_(p).forEach(function (e) { claim(byEmail, dup.email, contactsEmailKey_(e), p); });
    contactsPhonesOf_(p).forEach(function (ph) { claim(byPhone, dup.phone, bulkPhoneKey_(ph), p); });
    claim(byName, dup.name, bulkNameKey_(p.name), p);
    claim(byNoMiddle, dup.nomid, bulkNameKeyNoMiddle_(p.name), p);
    var nk0 = bulkNameKey_(p.name);
    if (nk0) (byNameAll[nk0] = byNameAll[nk0] || []).push(p);
  });
  var names = Object.keys(byName).map(function (k) { return { key: k, name: byName[k].name }; });

  var out = { plan: [], near: [], confirm: [], ambiguous: [], unmatched: [], examined: 0,
              skipped_merged: 0, skipped_client: 0, unchanged: 0, garbage_roles: 0,
              matched_by: { link: 0, email: 0, phone: 0, name: 0 } };

  // the roster rows accounts already stand on; a merged-away account stands nowhere
  var rowKey = function (v) { return contactsStr_(v).replace(/^people:/, '').trim(); };
  var standing = {};
  (users || []).forEach(function (u) {
    if (str_(u.mergedinto)) return;
    var at = rowKey(u.peopleid);
    if (at && byId[at]) (standing[at] = standing[at] || []).push(str_(u.userid));
  });
  var standsElsewhere = function (rowId, uid) {
    return (standing[rowKey(rowId)] || []).some(function (x) { return x !== uid; });
  };
  var offStaff = function (p) {
    var st = contactsStr_(p.status);
    return st ? 'the roster row is marked "' + st + '", not on staff' : 'the roster row carries no staff status';
  };

  var found = [];
  (users || []).forEach(function (u) {
    var uname = str_(u.displayname);
    if (str_(u.mergedinto)) { out.skipped_merged++; return; }
    if (str_(u.role) === 'client' || str_(u.clientkey)) { out.skipped_client++; return; }
    out.examined++;

    var p = null, how = '', amb = '', proof = '';
    var uid = str_(u.userid);
    var sources = {};
    try { sources = JSON.parse(str_(u.contactsources) || '{}') || {}; } catch (eS) { sources = {}; }
    if (typeof sources !== 'object' || Array.isArray(sources)) sources = {};
    var linked = str_(u.peopleid);
    if (linked && byId[linked]) {
      p = byId[linked]; how = 'link';
      var recorded = str_(sources.people_id);
      if (recorded !== 'email' && recorded !== 'name') {
        // a link written before proofs were recorded stands only on the sign-in e-mail: the name may have come from the link
        proof = contactsLinkProof_(u, p) === 'email' ? 'email' : '';
        var why = !proof ? 'its sign-in e-mail is not on the row'
          : !isOnStaff(p) ? offStaff(p)
            : standsElsewhere(p.id, uid) ? 'another account is linked to the row' : '';
        if (why) { out.confirm.push(uname + ' ~ ' + p.name + ' (linked by an older rule: ' + why + ')'); return; }
      }
    }
    if (!p) {
      var signIn = contactsEmailKey_(u.email), bySign = null;
      if (signIn && dup.email[signIn]) amb = 'e-mail shared by several roster people';
      else if (signIn && byEmail[signIn]) bySign = byEmail[signIn];
      var sameName = byNameAll[bulkNameKey_(uname)] || [];
      if (!amb && bySign) {
        var agrees = !sameName.length || sameName.some(function (r) { return contactsStr_(r.id) === contactsStr_(bySign.id); });
        if (agrees) { p = bySign; how = 'email'; }
        else amb = 'sign-in e-mail on one roster row and name on another';
      } else if (!amb && sameName.length === 1) {
        p = sameName[0]; how = 'name';
      } else if (!amb && sameName.length > 1) {
        amb = 'name shared by several roster people';
      }
      if (p && !amb) {
        // a name can be taken before its row lands: alone, it links only a row with no other address, never a self-chosen name
        if (how === 'name' && !contactsLinkProof_(u, p)) {
          out.confirm.push(uname + ' ~ ' + p.name + (str_(u.nameby).trim().toLowerCase() === 'self'
            ? ' (the account chose that name itself)' : ' (the roster row carries another e-mail)'));
          return;
        }
        if (!isOnStaff(p)) { out.confirm.push(uname + ' ~ ' + p.name + ' (' + offStaff(p) + ')'); return; }
        if (standsElsewhere(p.id, uid)) amb = 'roster row already linked to another account';
      }
    }
    if (amb) { out.ambiguous.push(uname + ' (' + amb + ')'); return; }
    if (!p) {
      var hint = contactsMergeHint_(u, uname, byEmail, byPhone, byNoMiddle, dup);
      if (hint) { out.confirm.push(uname + ' ~ ' + hint); return; }
    }
    if (!p) {
      var best = null, bestR = 0, key0 = bulkNameKey_(uname);
      if (key0) {
        for (var i = 0; i < names.length; i++) {
          var r = bulkNameRatio_(key0, names[i].key);
          if (r > bestR) { bestR = r; best = names[i].name; }
        }
      }
      if (best && bestR >= BULK_NEAR_RATIO) out.near.push(uname + ' ~ ' + best + ' (' + Math.round(bestR * 100) + '%)');
      else out.unmatched.push(uname);
      return;
    }
    found.push({ u: u, uname: uname, p: p, how: how, proof: proof, sources: sources });
  });

  // one roster row that several accounts would newly stand on is none of theirs
  var fresh = {};
  found.forEach(function (f) {
    if (f.how !== 'link') fresh[rowKey(f.p.id)] = (fresh[rowKey(f.p.id)] || 0) + 1;
  });
  found.forEach(function (f) {
    var u = f.u, uname = f.uname, p = f.p, how = f.how, sources = f.sources;
    if (how !== 'link' && fresh[rowKey(p.id)] > 1) {
      out.ambiguous.push(uname + ' (roster row several accounts point at)');
      return;
    }
    out.matched_by[how]++;

    var set = {}, phonesAdd = [], emailsAdd = [];
    var coverage = contactsStr_(p.source_coverage);
    var from = 'platform' + (coverage ? ':' + coverage : '');

    // Always linked, so the next pass matches by id, never by name — and what proved the link is kept with it.
    if (str_(u.peopleid) !== contactsStr_(p.id)) set.people_id = contactsStr_(p.id);
    var proven = how === 'link' ? f.proof : how;
    var stamped = !!proven && str_(sources.people_id) !== proven;
    if (stamped) sources.people_id = proven;

    // Blank-only, each through its gate: older roster rows predate the filter.
    var title = contactsRoleClean_(p.role, null);
    if (contactsStr_(p.role) && !title) out.garbage_roles++;
    var wants = { title: title, employee_id: contactsIdClean_(p.employee_id),
                  start_date: contactsDateClean_(p.start_date), end_date: contactsDateClean_(p.end_date) };
    Object.keys(wants).forEach(function (f) {
      if (!wants[f]) return;
      if (str_(u[normKey_(f)])) return;
      set[f] = wants[f];
      sources[f] = from;
    });

    // Informative only: it never flips `active`.
    var status = contactsStatusClean_(p.status);
    if (status && str_(u.rosterstatus) !== status) set.roster_status = status;

    // A different number is appended as context, never a correction.
    var have = {};
    contactsPhonesOf_(u).forEach(function (n) { var d = bulkPhoneKey_(n); if (d) have[d] = true; });
    var count = profileParsePhones_(u.phones).length;
    var platformPhones = [];
    contactsPhonesOf_(p).forEach(function (n) {
      var clean = contactsPhoneClean_(n);
      if (clean) platformPhones.push(clean);
    });
    platformPhones.forEach(function (n) {
      var d = bulkPhoneKey_(n);
      if (!d || have[d] || count + phonesAdd.length >= 8) return;
      have[d] = true;
      phonesAdd.push({ label: CONTACTS_LABEL, number: n });
    });
    if (!str_(u.phone) && platformPhones.length) {
      set.phone = platformPhones[0];
      sources.phone = from;
    }
    // The sign-in address is never written; other addresses go beside it.
    var login = str_(u.email).toLowerCase();
    var haveEm = {};
    if (login) haveEm[login] = true;
    profileParseEmails_(u.emails).forEach(function (e) { haveEm[str_(e).toLowerCase()] = true; });
    var emCount = profileParseEmails_(u.emails).length;
    contactsEmailsOf_(p).forEach(function (e) {
      var v = contactsEmailClean_(e);
      if (!v || haveEm[v] || emCount + emailsAdd.length >= 8) return;
      haveEm[v] = true;
      emailsAdd.push(v);
    });
    if (phonesAdd.length) sources.phones = from;
    if (emailsAdd.length) sources.emails = from;

    if (!Object.keys(set).length && !phonesAdd.length && !emailsAdd.length && !stamped) { out.unchanged++; return; }
    set.contact_sources = JSON.stringify(sources);
    set.contact_synced_at = now;
    out.plan.push({ user_id: str_(u.userid), name: uname, matched_by: how,
                    people_id: contactsStr_(p.id), person: contactsStr_(p.name),
                    set: set, phones_add: phonesAdd, emails_add: emailsAdd });
  });
  return out;
}

/* ---- Sheet half ---- */

function contactsMergeInputs_() {
  var users = usersAll_();
  var people = withoutIspClients_(peopleMerged_(listRows_('people', {})));
  return { users: users, people: people, onStaff: contactsOnStaffStatuses_() };
}

function contactsSourceEnabled_() {
  var sheet = null;
  try { sheet = hubTabSheet_('roster_sources'); } catch (e) { sheet = null; }
  if (!sheet) return true;
  try {
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return true;
    var hdr = values[0].map(normKey_);
    var iKey = hdr.indexOf('key'), iOn = hdr.indexOf('enabled');
    if (iKey === -1 || iOn === -1) return true;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iKey]) !== 'ops_employees') continue;
      var on = str_(values[r][iOn]).toLowerCase();
      return !(on === 'no' || on === 'false' || on === 'off' || on === '0');
    }
  } catch (e2) { return true; }
  return true;
}

// Re-checked against the row as it is now, so an older plan cannot overwrite a fresh edit.
function contactsMergeApply_(plan, cap) {
  ensureUserProfileColumns_();
  var sheet = hubSheet_(USERS_TAB);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { touched: 0, cells: 0, phonesAdded: 0, emailsAdded: 0, missing: [], remaining: plan.length };
  var hdr = values[0].map(normKey_);
  var colOf = function (k) { return hdr.indexOf(normKey_(k)); };
  var iId = colOf('user_id');
  var rowByUid = {};
  for (var r = 1; r < values.length; r++) {
    var uid = str_(values[r][iId]);
    if (uid && rowByUid[uid] === undefined) rowByUid[uid] = r;
  }
  var owned = CONTACTS_USER_COLUMNS.map(colOf);
  var lo = Math.min.apply(null, owned), hi = Math.max.apply(null, owned);
  var block = owned.indexOf(-1) === -1 && (hi - lo + 1) === owned.length;

  var out = { touched: 0, cells: 0, phonesAdded: 0, emailsAdded: 0, missing: [], remaining: 0 };
  var todo = plan.slice(0, cap);
  out.remaining = Math.max(0, plan.length - todo.length);
  todo.forEach(function (item) {
    var at = rowByUid[item.user_id];
    if (at === undefined) { out.missing.push(item.name); return; }
    var line = values[at];
    var fields = {};

    if (item.phones_add.length && colOf('phones') !== -1) {
      var list = profileParsePhones_(line[colOf('phones')]);
      var have = {};
      list.forEach(function (p) { var d = bulkPhoneKey_(p && p.number); if (d) have[d] = true; });
      var d0 = bulkPhoneKey_(line[colOf('phone')]);
      if (d0) have[d0] = true;
      var added = 0;
      item.phones_add.forEach(function (p) {
        var d = bulkPhoneKey_(p.number);
        if (!d || have[d] || list.length >= 8) return;
        have[d] = true;
        list.push({ label: CONTACTS_LABEL, number: p.number });
        added++;
      });
      if (added) {
        var cleanP = profileCleanPhones_(list);
        fields.phones = JSON.stringify(cleanP);
        out.phonesAdded += added;
        if (!str_(line[colOf('phone')]) && cleanP.length) fields.phone = cleanP[0].number;
      }
    }
    if (item.emails_add.length && colOf('emails') !== -1) {
      var mails = profileParseEmails_(line[colOf('emails')]);
      var haveEm = {};
      mails.forEach(function (e) { haveEm[str_(e).toLowerCase()] = true; });
      var login = str_(line[colOf('email')]).toLowerCase();
      if (login) haveEm[login] = true;
      var addedEm = 0;
      item.emails_add.forEach(function (e) {
        var kk = str_(e).toLowerCase();
        if (!kk || haveEm[kk] || mails.length >= 8) return;
        haveEm[kk] = true;
        mails.push(e);
        addedEm++;
      });
      if (addedEm) { fields.emails = JSON.stringify(profileCleanEmails_(mails)); out.emailsAdded += addedEm; }
    }
    Object.keys(item.set || {}).forEach(function (k) {
      if (colOf(k) === -1) return;
      if (CONTACTS_BLANK_ONLY[k] && str_(line[colOf(k)])) return;
      if (fields[k] !== undefined) return;
      fields[k] = item.set[k];
    });
    var keys = Object.keys(fields);
    if (!keys.length) return;

    if (block) {
      var seg = [];
      for (var c = lo; c <= hi; c++) {
        var name = hdr[c];
        var patched = null;
        keys.forEach(function (k) { if (normKey_(k) === name) patched = k; });
        seg.push(patched !== null ? fields[patched] : line[c]);
      }
      sheet.getRange(at + 1, lo + 1, 1, seg.length).setValues([seg]);
      out.cells += keys.filter(function (k) { var i = colOf(k); return i >= lo && i <= hi; }).length;
      keys.forEach(function (k) {
        var i = colOf(k);
        if (i >= lo && i <= hi) return;
        sheet.getRange(at + 1, i + 1).setValue(fields[k]);
        out.cells++;
      });
    } else {
      keys.forEach(function (k) { sheet.getRange(at + 1, colOf(k) + 1).setValue(fields[k]); out.cells++; });
    }
    keys.forEach(function (k) { line[colOf(k)] = fields[k]; });
    out.touched++;
    try { if (typeof profileStoreStale_ === 'function') profileStoreStale_(item.user_id); } catch (eP) {}
  });
  return out;
}

function contactsMergeSentence_(planned, applied) {
  return applied.touched + ' account(s) updated of ' + planned.plan.length + ' planned (' +
    applied.cells + ' cell(s), ' + applied.phonesAdded + ' phone(s) and ' + applied.emailsAdded +
    ' e-mail(s) kept as context), ' + planned.examined + ' examined, ' +
    planned.ambiguous.length + ' ambiguous, ' + planned.confirm.length + ' left for an administrator to confirm, ' +
    planned.near.length + ' look like roster people, ' +
    planned.unmatched.length + ' without a roster row, ' + planned.skipped_client + ' client(s) left as they are' +
    (applied.remaining ? ', ' + applied.remaining + ' left for the next pass' : '') +
    (planned.garbage_roles ? ', ' + planned.garbage_roles + ' polluted role(s) refused' : '');
}

/* ---- Doors ---- */

// Must stay named in SERVICE_SWEEP_ACTIONS: a machine write not named there does not exist.
HUB_POLICY.peopleSyncFromPlatform = {
  file: 'ContactsSync.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { rows: { required: true, type: 'array' } },
  invalidates: ['people'], emits: []
};
HUB_ACTIONS.peopleSyncFromPlatform = function (payload, user) {
  var isMachine = !!(user && user.is_service);
  if (!isMachine && (!user || str_(user.role) !== 'admin')) return hubDenied_();
  var rows = payload && payload.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { status: 400, message: 'No rows — the roster is left as it is.' };
  }
  var actor = isMachine ? 'asa-hub:contacts' : str_(user.email);
  if (!contactsSourceEnabled_()) {
    return { status: 200, data: { skipped: 'ops_employees is switched off in roster_sources', received: rows.length } };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'The roster sync is already running.' };
  try {
    var sheet;
    try { sheet = hubSheet_('people'); }
    catch (eS) { return { status: 503, message: 'The People house did not answer — nothing was written.' }; }
    var header = ensureHeader_(sheet, CONTACTS_PEOPLE_HEADER);
    var values = sheet.getDataRange().getValues();
    var grid = values.slice(1);
    var rec = contactsPeopleReconcile_(header, grid, rows);
    if (rec.error) return { status: 400, message: rec.error };
    var idxs = Object.keys(rec.changed).map(Number).sort(function (a, b) { return a - b; });
    var writes = 0;
    for (var i = 0; i < idxs.length;) {
      var start = idxs[i], end = start;
      while (i + 1 < idxs.length && idxs[i + 1] === end + 1) { i++; end = idxs[i]; }
      i++;
      var lines = [];
      for (var r = start; r <= end; r++) lines.push(grid[r].slice(0, header.length));
      sheet.getRange(start + 2, 1, lines.length, header.length).setValues(lines);
      writes++;
    }
    if (rec.appended.length) { bulkAppendRows_(sheet, rec.appended, header.length); writes++; }
    try { cacheBump_(cacheScope_('people')); } catch (eB) {}
    var sourceAt = str_(payload.source_at);
    if (sourceAt) { try { hubPropSet_(CONTACTS_SOURCE_STAMP, sourceAt); } catch (eP) {} }
    var summary = rec.updated + ' roster row(s) refreshed, ' + rec.inserted + ' added, ' + rec.unchanged +
      ' unchanged, ' + rec.foreign + ' owned by another lane, ' + rec.refused + ' refused by the filter, ' +
      rec.unnamed + ' unnamed — ' + writes + ' write(s)' + (sourceAt ? ', platform list as of ' + sourceAt : '') +
      (rec.refused_named.length ? ' · refused: ' + rec.refused_named.slice(0, 8).join(' · ') : '');
    if (rec.updated || rec.inserted || rec.refused) {
      try { hubSysLog_(actor, 'people_sync_platform', summary, { status: 200 }); } catch (eL) {}
    }
    return { status: 200, data: { updated: rec.updated, inserted: rec.inserted, unchanged: rec.unchanged,
                                  foreign: rec.foreign, unnamed: rec.unnamed, refused: rec.refused,
                                  refused_named: rec.refused_named, writes: writes,
                                  received: rows.length, source_at: sourceAt } };
  } finally {
    lock.releaseLock();
  }
};

/** What the contact merge would do — every account named, nothing written. */
HUB_POLICY.usersContactMergePreview = {
  file: 'ContactsSync.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersContactMergePreview = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var inputs;
  try { inputs = contactsMergeInputs_(); }
  catch (eR) { return { status: 503, message: 'The roster or the accounts could not be read.' }; }
  var planned = contactsMergePlan_(inputs.users, inputs.people, new Date().toISOString(), inputs.onStaff);
  return { status: 200, data: {
    examined: planned.examined, planned: planned.plan.length, unchanged: planned.unchanged,
    matched_by: planned.matched_by,
    skipped_merged: planned.skipped_merged, skipped_client: planned.skipped_client,
    garbage_roles: planned.garbage_roles,
    near: planned.near.length, near_named: planned.near.slice(0, 80),
    confirm: planned.confirm.length, confirm_named: planned.confirm.slice(0, 80),
    ambiguous: planned.ambiguous.length, ambiguous_named: planned.ambiguous.slice(0, 80),
    unmatched: planned.unmatched.length, unmatched_named: planned.unmatched.slice(0, 80),
    people: inputs.people.length,
    source_at: str_(hubProp_(CONTACTS_SOURCE_STAMP)),
    plan: planned.plan.slice(0, 300).map(function (it) {
      return { user_id: it.user_id, name: it.name, matched_by: it.matched_by, person: it.person,
               fills: Object.keys(it.set).filter(function (k) {
                 return k !== 'contact_sources' && k !== 'contact_synced_at';
               }),
               phones_add: it.phones_add.length, emails_add: it.emails_add.length };
    })
  } };
};

/** Apply the contact merge, signed by an admin — all planned accounts, or the ones named. */
HUB_POLICY.usersContactMergeApply = {
  file: 'ContactsSync.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersContactMergeApply = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { status: 409, message: 'The merge is already running — check the platform log for its counts.' };
  try {
    var inputs;
    try { inputs = contactsMergeInputs_(); }
    catch (eR) { return { status: 503, message: 'The roster or the accounts could not be read — nothing was written.' }; }
    var planned = contactsMergePlan_(inputs.users, inputs.people, new Date().toISOString(), inputs.onStaff);
    var only = payload && Array.isArray(payload.user_ids) ? payload.user_ids.map(String) : null;
    var plan = only ? planned.plan.filter(function (it) { return only.indexOf(it.user_id) !== -1; }) : planned.plan;
    var applied = contactsMergeApply_(plan, CONTACTS_MERGE_CAP);
    try { hubSysLog_(str_(user.email), 'users_contact_merge', contactsMergeSentence_(planned, applied), { status: 200 }); } catch (eL) {}
    return { status: 200, data: { touched: applied.touched, cells: applied.cells,
                                  phones_added: applied.phonesAdded, emails_added: applied.emailsAdded,
                                  remaining: applied.remaining, missing: applied.missing,
                                  planned: plan.length, examined: planned.examined,
                                  near: planned.near.length, near_named: planned.near.slice(0, 80),
                                  confirm: planned.confirm.length, confirm_named: planned.confirm.slice(0, 80),
                                  ambiguous: planned.ambiguous.length, ambiguous_named: planned.ambiguous.slice(0, 80),
                                  skipped_client: planned.skipped_client, garbage_roles: planned.garbage_roles } };
  } finally {
    lock.releaseLock();
  }
};

// Stamped before the pass, so a pass that throws does not re-enter next tick.
function contactsMergeDue_() {
  var last = 0;
  try { last = Number(hubProp_(CONTACTS_MERGE_STAMP) || 0) || 0; } catch (e) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) < CONTACTS_MERGE_HOURS * 3600000) return false;
  try { hubPropSet_(CONTACTS_MERGE_STAMP, String(now)); } catch (eS) { }
  return true;
}

function contactsMergeAutoSweep_() {
  if (!contactsMergeDue_()) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var inputs = contactsMergeInputs_();
    var planned = contactsMergePlan_(inputs.users, inputs.people, new Date().toISOString(), inputs.onStaff);
    if (!planned.plan.length) return;
    var applied = contactsMergeApply_(planned.plan, CONTACTS_MERGE_CAP);
    if (applied.touched) {
      hubSysLog_('asa-hub:contacts', 'users_contact_merge', contactsMergeSentence_(planned, applied), { status: 200 });
    }
  } finally {
    lock.releaseLock();
  }
}
