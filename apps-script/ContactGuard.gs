/** A staff phone or email may not enter the funnel; the test exemption is per field, never per card. */

// a code floor: the test line stays exempt even when the config tab is gone
var CG_TEST_PHONE_FLOOR = ['3309195558'];

// a code floor, not only a config default: an exemption that needs the tab right fails exactly when it is wrong
var CG_TEST_EMAIL_FLOOR = ['asatech*@asalifecare.com', 'asatechjk@gmail.com',
                           'silvajhonatanbrito@gmail.com'];

/** Institutional boxes identify NOBODY, exactly like a company line. */
var CG_SHARED_EMAIL_FLOOR = ['info@asalifecare.com', 'hr@asalifecare.com',
                             'admin@asalifecare.com', 'support@asalifecare.com'];

function cgDigits_(v) { return String(v == null ? '' : v).replace(/\D+/g, ''); }

/** The same loose key every dialer computes: the guard must never be stricter than whoever dials. */
function contactPhoneKey_(v) {
  var d = cgDigits_(v);
  if (d.length >= 11 && d.charAt(0) === '1') d = d.slice(1);
  d = d.slice(-10);
  return d.length === 10 ? d : '';
}

/** Gmail dots and +tags are one mailbox; exact equality alone is a hole. */
function contactEmailKeys_(v) {
  var e = String(v == null ? '' : v).trim().toLowerCase();
  if (e.indexOf('@') < 1) return [];
  var at = e.lastIndexOf('@');
  var local = e.slice(0, at), domain = e.slice(at + 1);
  if (!local || !domain || domain.indexOf('.') === -1) return [];
  var keys = [e];
  var plus = local.indexOf('+');
  var canon = plus > 0 ? local.slice(0, plus) : local;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    canon = canon.replace(/\./g, '');
    domain = 'gmail.com';
  }
  var alias = canon + '@' + domain;
  if (alias !== e && canon) keys.push(alias);
  return keys;
}

function cgCfgList_(key, floor) {
  var out = {};
  (floor || []).forEach(function (v) { out[v] = true; });
  try {
    String(hiringAlerts_()[key] || '').split(/[,;\n]+/).forEach(function (raw) {
      var v = String(raw || '').trim();
      if (v) out[v.toLowerCase()] = true;
    });
  } catch (e) {}
  return out;
}

function cgTestPhones_() {
  var out = {};
  CG_TEST_PHONE_FLOOR.forEach(function (v) { out[v] = true; });
  try {
    String(hiringAlerts_().staff_guard_test_phones || '').split(/[,;\n]+/).forEach(function (raw) {
      var k = contactPhoneKey_(raw);
      if (k) out[k] = true;
    });
  } catch (e) {}
  return out;
}

/** Supports one trailing wildcard: "asatech*@asalifecare.com". */
function cgTestEmails_(key) {
  var k = String(key || '').toLowerCase();
  if (!k) return false;
  var pats = [COMMS_OPERATOR_TEST_EMAIL].concat(CG_TEST_EMAIL_FLOOR);
  try {
    String(hiringAlerts_().staff_guard_test_emails || '').split(/[,;\n]+/).forEach(function (raw) {
      var v = String(raw || '').trim().toLowerCase();
      if (v) pats.push(v);
    });
  } catch (e) {}
  for (var i = 0; i < pats.length; i++) {
    var p = pats[i];
    if (!p) continue;
    if (p.indexOf('*') === -1) {
      if (p === k) return true;
      continue;
    }
    var rx = new RegExp('^' + p.split('*').map(function (s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('.*') + '$');
    if (rx.test(k)) return true;
  }
  return false;
}

function cgSharedEmails_() { return cgCfgList_('staff_guard_shared_emails', CG_SHARED_EMAIL_FLOOR); }

/** An allowlist of blocking statuses: status is free text, and a denylist would block every new kind of mess. */
function cgBlockStatuses_() {
  var out = {};
  var raw = '';
  try { raw = String(hiringAlerts_().staff_guard_block_statuses || ''); } catch (e) { raw = ''; }
  (raw || 'active, admin').split(/[,;\n]+/).forEach(function (s) {
    var v = String(s || '').trim().toLowerCase();
    if (v) out[v] = true;
  });
  return out;
}

/** Per lane: the anonymous form only warns, since a refusal there is invisible to whoever submits. */
function cgEnforces_(lane) {
  var key = lane === 'public' ? 'staff_guard_mode_public' : 'staff_guard_mode';
  var val = '';
  try { val = String(hiringAlerts_()[key] || '').trim().toLowerCase(); } catch (e) { val = ''; }
  // shadow by default: no screen sends staff_conflict_override yet, so enforcing would be a wall with no door
  if (!val) val = 'shadow';
  return val === 'enforce';
}

// users is read fresh per execution: nothing bumps its cache scope, so a cached read would miss a fresh hire
var CG_USERS_MEMO_ = null;

function cgUsersAll_() {
  if (CG_USERS_MEMO_) return CG_USERS_MEMO_;
  // not memoised on a throw: fail closed and ask again, never remember an empty roster
  CG_USERS_MEMO_ = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), USERS_TAB);
  return CG_USERS_MEMO_;
}

/** Fails closed and never stores a build that threw. */
function staffContactIndex_() {
  var idx = { phones: {}, emails: {}, ok: true };
  var blockSt = cgBlockStatuses_();
  var testPh = cgTestPhones_(), sharedMail = cgSharedEmails_();

  var add = function (name, active, src, cid, phone, email) {
    var who = { name: String(name || '').trim() || 'a staff record',
                active: !!active, src: src, cid: String(cid || '') };
    var pk = contactPhoneKey_(phone);
    // the filters that exempt an incoming contact apply here too, or every graduated test hire poisons the index
    if (pk && SHARED_LINE_DIGITS.indexOf(pk) === -1 && !testPh[pk]) {
      (idx.phones[pk] = idx.phones[pk] || []).push(who);
    }
    contactEmailKeys_(email).forEach(function (k) {
      if (cgTestEmails_(k) || sharedMail[k]) return;
      (idx.emails[k] = idx.emails[k] || []).push(who);
    });
  };

  // peopleMerged_ is required: some staff contacts live only in the merged phones[]/emails[] arrays
  try {
    peopleMerged_(listRows_('people', {})).forEach(function (p) {
      var act = blockSt[String(p.status || '').trim().toLowerCase()] === true;
      add(p.name, act, 'people', '', p.phone, p.email);
      (p.phones || []).forEach(function (v) { add(p.name, act, 'people', '', v, ''); });
      (p.emails || []).forEach(function (v) { add(p.name, act, 'people', '', '', v); });
    });
  } catch (e) { idx.ok = false; }

  // users is the freshest surface: a new hire's account lands here, never in people
  try {
    cgUsersAll_().forEach(function (u) {
      var role = str_(u.role).toLowerCase();
      if (role === 'client' || role === 'onboarding' || role === 'interviewer') return;
      if (str_(u.systemtype)) return;
      var act = str_(u.active).toLowerCase() === 'true';
      var cid = str_(u.candidateid);
      add(str_(u.displayname), act, 'users', cid, u.phone, u.email);
      (profileParsePhones_(u.phones) || []).forEach(function (v) {
        add(str_(u.displayname), act, 'users', cid, (v && (v.number || v.value)) || v, '');
      });
      (profileParseEmails_(u.emails) || []).forEach(function (v) {
        add(str_(u.displayname), act, 'users', cid, '', (v && (v.value || v.email)) || v);
      });
    });
  } catch (e2) { idx.ok = false; }

  if (!idx.ok) hubSysLog_('asa-hub:guard', 'staff_index_failed', '', { status: 500 });
  return idx;
}

/** '[test]' counts only for a trusted (signed-in) caller: anyone could type it on the public form. */
function cgIsRehearsal_(opts) {
  if (!opts || !opts.trusted) return false;
  return String(opts.name || '').trim().toLowerCase().indexOf('[test]') === 0;
}

function contactGuard_(phone, email, opts) {
  if (cgIsRehearsal_(opts)) return null;
  var self = String((opts && opts.self_candidate_id) || '');
  var idx = staffContactIndex_();
  if (!idx.ok) return { severity: 'unverified', hits: [] };

  var pk = contactPhoneKey_(phone);
  if (pk && (SHARED_LINE_DIGITS.indexOf(pk) !== -1 || cgTestPhones_()[pk])) pk = '';
  var eks = contactEmailKeys_(email).filter(function (k) {
    return !cgTestEmails_(k) && !cgSharedEmails_()[k];
  });

  var keep = function (list) {
    return (list || []).filter(function (p) { return !(self && p.cid === self); });
  };

  var hits = [];
  if (pk && keep(idx.phones[pk]).length) hits.push({ via: 'phone', people: keep(idx.phones[pk]) });
  var seen = {}, mailHit = null;
  eks.forEach(function (k) {
    keep(idx.emails[k]).forEach(function (p) {
      var sig = p.src + '|' + p.name;
      if (seen[sig]) return;
      seen[sig] = true;
      if (!mailHit) { mailHit = { via: 'email', people: [] }; hits.push(mailHit); }
      mailHit.people.push(p);
    });
  });
  if (!hits.length) return null;

  var blocking = hits.some(function (h) {
    return h.people.some(function (p) { return p.active; });
  });
  return { severity: blocking ? 'block' : 'warn', hits: hits };
}

/** Never asserts identity: a shared line does not prove who someone is. */
function contactGuardMessage_(g) {
  if (!g) return '';
  if (g.severity === 'unverified') {
    return 'Could not verify the staff roster right now — please try again.';
  }
  var parts = (g.hits || []).map(function (h) {
    var names = h.people.map(function (p) { return p.name; })
      .filter(function (n, i, arr) { return arr.indexOf(n) === i; });
    var who = names.slice(0, 3).join(', ') + (names.length > 3 ? ' and others' : '');
    return (h.via === 'phone' ? 'That phone number' : 'That e-mail address') +
           ' is already on the staff roster (' + who + ')';
  });
  return parts.join('; ') + '. An admin or manager can override with a reason.';
}

/* CALLER NAMES — stricter than the guard: shared and test lines answer unknown, never a name */

// compared flattened to letters, so case and punctuation never make a new placeholder
var CG_NO_NAME_WORDS = ['undetermined', 'unknown', 'unclear', 'anonymous', 'caller',
                        'notspecified', 'notspecifiedintranscript', 'nonamegiven',
                        'namenotgiven', 'nonameprovided', 'notgiven', 'na', 'none', 'nobody'];

function contactNameMissing_(name) {
  var n = String(name == null ? '' : name).toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return true;
  return CG_NO_NAME_WORDS.indexOf(n) !== -1;
}

/** Shared counts every person on a line, active or not; active never gates a name. */
function contactWhoDecide_(rows) {
  var people = [], seen = {};
  (rows || []).forEach(function (p) {
    var nm = String((p && p.name) || '').trim();
    var k = nm.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!nm || !k) return;
    if (seen[k]) { if (p && p.active) seen[k].active = true; return; }
    seen[k] = { name: nm, active: !!(p && p.active), src: String((p && p.src) || '') };
    people.push(seen[k]);
  });
  if (!people.length) return { state: 'unknown', name: '', people: [] };
  if (people.length > 1) return { state: 'shared', name: '', people: people };
  return { state: 'sole', name: people[0].name, people: people };
}

// held for this execution only; a failed build is never stored
var CG_WHO_INDEX_ = null;
var CG_WHO_MEMO_ = null;

/** { state:'sole'|'shared'|'unknown', name, people:[{name,active,src}], via, why } */
function contactPhoneWho_(phone) {
  var key = contactPhoneKey_(phone);
  if (!key) {
    return { state: 'unknown', name: '', people: [], via: '',
             why: 'no ten-digit number to ask with' };
  }
  if (SHARED_LINE_DIGITS.indexOf(key) !== -1 || cgTestPhones_()[key]) {
    return { state: 'unknown', name: '', people: [], via: '',
             why: 'a company or test line — the number many people call from names none of them' };
  }
  if (!CG_WHO_MEMO_) CG_WHO_MEMO_ = {};
  if (CG_WHO_MEMO_[key]) return CG_WHO_MEMO_[key];

  var idx = CG_WHO_INDEX_ || staffContactIndex_();
  if (!idx.ok) {
    return { state: 'unknown', name: '', people: [], via: '',
             why: 'the staff roster could not be read — nobody is named off a roster we did not see' };
  }
  CG_WHO_INDEX_ = idx;

  var ans = contactWhoDecide_(idx.phones[key]);
  ans.via = ans.state === 'unknown' ? '' : 'phone';
  ans.why = ans.state === 'sole'
    ? 'one person on the staff roster holds this line'
    : (ans.state === 'shared'
        ? ans.people.length + ' people on the staff roster hold this line — it names none of them'
        : 'the number is not on the staff roster');
  CG_WHO_MEMO_[key] = ans;
  return ans;
}

/** Fills a blank, never overrides a stated name; with nothing learned the cell comes back unchanged and `from` empty. */
function contactNameFill_(name, phone) {
  var stated = String(name == null ? '' : name).trim();
  if (!contactNameMissing_(stated)) return { name: stated, from: 'person', who: null };
  var who = contactPhoneWho_(phone);
  if (who.state === 'sole') return { name: who.name, from: 'phone', who: who };
  return { name: stated, from: '', who: who };
}

function contactWhoText_(who) {
  if (!who) return '';
  if (who.state === 'sole') {
    return 'Named from the caller ID: ' + who.name +
           ' — one person on the staff roster holds this line.';
  }
  if (who.state === 'shared') {
    var names = who.people.map(function (p) { return p.name; });
    return 'Not named from the caller ID: ' + names.length +
           ' people on the staff roster hold this line (' +
           names.slice(0, 3).join(', ') + (names.length > 3 ? ' and others' : '') +
           '). A shared line names nobody.';
  }
  return 'Not named from the caller ID — ' +
         String(who.why || 'the number is not on the staff roster') + '.';
}

/** Admin or manager, with a required reason, and never on the public form. */
function cgOverrideAllowed_(user, payload) {
  if (!hubIsWriter_(user)) return false;
  var role = str_(user && user.role).toLowerCase();
  if (role !== 'admin' && role !== 'manager') return false;
  return str_(payload && payload.staff_conflict_override).length > 3;
}

function cgLogOverride_(user, payload, name, guard) {
  hubSysLog_(user && user.email, 'staff_guard_override',
    name + ' — ' + (guard ? guard.severity : '?') + ': ' +
    str_(payload && payload.staff_conflict_override).slice(0, 300),
    { status: 200 });
}

/** The rule is an invariant: a clean card can collide later, when its person is hired. */
HUB_POLICY.staffGuardScan = {
  file: 'ContactGuard.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.staffGuardScan = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var rows = [];
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB)
      .forEach(function (c) {
        if (str_(c.archived).toLowerCase() === 'true') return;
        var cid = str_(c.candidateid);
        if (!cid) return;
        var g = contactGuard_(c.phone, c.email,
          { self_candidate_id: cid, name: str_(c.candidatename), trusted: true });
        if (!g || g.severity === 'unverified') return;
        rows.push({
          candidate_id: cid,
          name: str_(c.candidatename),
          stage: talentStage_(c.status),
          severity: g.severity,
          why: contactGuardMessage_(g)
        });
      });
  } catch (e) {
    return { status: 500, message: 'Could not read the pipeline: ' + (e && e.message ? e.message : e) };
  }
  hubSysLog_(user && user.email, 'staff_guard_scan', rows.length + ' card(s) in conflict', { status: 200 });
  return { status: 200, data: { total: rows.length, rows: rows } };
};

function debugContactGuard() {
  var idx = staffContactIndex_();
  var out = {
    ok: idx.ok,
    phone_keys: Object.keys(idx.phones).length,
    email_keys: Object.keys(idx.emails).length,
    mode_signed_in: cgEnforces_('auth') ? 'enforce' : 'shadow',
    mode_public: cgEnforces_('public') ? 'enforce' : 'shadow',
    block_statuses: Object.keys(cgBlockStatuses_()),
    test_phones: Object.keys(cgTestPhones_())
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
