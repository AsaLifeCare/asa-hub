var COMPLIANCE_DOCS_TAB = 'cert_uploads';
var COMPLIANCE_DOCS_HEADER = ['id', 'person', 'cert', 'name', 'url', 'by', 'at',
  // APPEND ONLY: the reading of the paper, then the confirmation into the record.
  'file_id', 'req_id', 'read_state', 'read_kind', 'issued_on', 'expires_on', 'read_how',
  'read_confidence', 'read_why', 'read_at', 'read_v', 'confirmed_on', 'confirmed_by', 'confirmed_at',
  'read_tries', 'roster_id'];

// The categories whose rows the person files a paper for (server/my_profile.py UPLOADABLE).
var CERT_READ_UPLOADABLE = { training: true, documents: true };
var CERT_DOC_MAX_BYTES = 15 * 1024 * 1024;
// The only types a document is filed as and the eye answers: a PDF it frames, a picture it draws.
var CERT_DOC_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                       gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
var CERT_DOC_TYPE_WORDS = 'Images and PDFs only — a PDF, or a PNG, JPEG, GIF, WebP or HEIC picture.';
var CERT_READ_TRIES = 3;
var CERT_READ_SWEEP_PER_PASS = 3;
// A fresh upload is read by its own door first; the sweep takes only a reading that died.
var CERT_READ_WAIT_MS = 5 * 60 * 1000;
var CERT_READ_SWEEP_FLOOR_MS = 60000;
// The paper each requirement is: no entry means no kind is asked of it.
var CERT_READ_KINDS = {
  dodd: ['dodd_certification'], cpr: ['cpr_first_aid'],
  med1: ['med_admin_cert'], med2: ['med_admin_cert'], med3: ['med_admin_cert'],
  mandt: ['crisis_prevention'], driver_license: ['drivers_licence', 'state_id'],
  car_insurance: ['auto_insurance'],
  // its record keeps the paper's own date, so only an abstract's date is taken — never a licence's
  drive_abstract: ['driver_abstract'],
  // an identity paper the I-9 accepts; one that expires gives the record its expiry
  i9_type_1: ['drivers_licence', 'state_id', 'passport', 'work_authorization', 'ssn_card', 'birth_certificate'],
  i9_type_2: ['drivers_licence', 'state_id', 'passport', 'work_authorization', 'ssn_card', 'birth_certificate']
};
// Papers that report on another credential: their own date is the day the record was drawn, never the credential's.
var CERT_READ_REPORT_KINDS = { driver_abstract: true };
// Papers that never expire: on a record that keeps an expiry they are the right paper with no date to give.
var CERT_READ_NEVER_EXPIRES = { ssn_card: true, birth_certificate: true };
// A category line read off a medication certificate is the paper naming itself, worth what a filename's claim is.
var CERT_READ_LEVEL_SCORE = 6;
var CERT_READ_KIND_WORDS = {
  dodd_certification: 'DODD certificate', cpr_first_aid: 'CPR / First Aid card',
  med_admin_cert: 'medication administration certificate', crisis_prevention: 'crisis prevention certificate',
  drivers_licence: 'driver\'s license', state_id: 'state ID', auto_insurance: 'car insurance card',
  training_transcript: 'training record', diploma: 'diploma', ssn_card: 'Social Security card',
  birth_certificate: 'birth certificate', background_check: 'background check', tb_test: 'TB test',
  driver_abstract: 'driver\'s abstract', passport: 'passport', work_authorization: 'work authorization'
};
var CERT_READ_WORDS = {
  heic: 'This photo format cannot be read for a date — a JPG or PDF of the same paper can.',
  empty: 'No words could be read from this file.',
  someone: 'This paper names someone else.',
  noExpiry: 'No expiry date could be read from this file.',
  noIssued: 'No date of issue could be read from this file.',
  noRecordDay: 'This paper prints a licence\'s dates but not the day the record itself was drawn, so no date is ' +
               'taken from it.',
  noReq:'This document is not filed under a requirement a paper is read for, so no date is taken from it.',
  noFile: 'The ledger keeps no file for this document.',
  notYours: 'This document is not on your record.',
  bridged: 'Your account reaches your roster row only through an e-mail written on the roster, so your documents ' +
           'are not opened from this session — HR opens them, or an administrator gives your account the exact ' +
           'name on your roster row.',
  stray: 'The file behind this document is not in the compliance folder, so it is not shown here — HR opens it.',
  unshown: 'This file is not a PDF or a picture, so it is not shown here.',
  visit: 'Submitted documents are listed for their own person and the master only, not during a visit.'
};
var CERT_CONFIRM_WORDS = {
  master: 'Only the master confirms a date into the record.',
  med: 'Med Delivery dates are written by the MAIS registry check, not here.',
  mais: 'MAIS has no date column in the record.',
  undated: 'This requirement keeps no date in the record.',
  earlier: 'This document was filed for another roster row than the one this name finds now, so its date is not ' +
           'taken for this record.'
};
var CERT_UPLOAD_NOBODY = 'A document filed from the master\'s session names whose record it goes on — choose the ' +
                         'person first. Nothing was filed.';

function complianceDocsSheet_() {
  var existed = !!hubTabSheet_(COMPLIANCE_DOCS_TAB);
  var sheet = hubTabEnsure_(COMPLIANCE_DOCS_TAB, COMPLIANCE_DOCS_HEADER);
  if (existed) ensureHeader_(sheet, COMPLIANCE_DOCS_HEADER);
  return sheet;
}

/** One ledger row, placed by header name. */
function complianceDocsAppend_(record) {
  var sheet = complianceDocsSheet_();
  var header = headerOf_(sheet);
  sheet.appendRow(header.map(function (h) {
    var v = record[String(h).trim()];
    return v === undefined || v === null ? '' : v;
  }));
}

/** Writes `fields` onto the ledger row `id`, each adjacent run of columns in one call; false when no row has it. */
function complianceDocsPatch_(id, fields) {
  var sheet = complianceDocsSheet_();
  var values = sheet.getDataRange().getValues();
  var header = (values[0] || []).map(normKey_);
  var idCol = header.indexOf('id');
  if (idCol === -1) return false;
  var at = -1;
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][idCol]) === str_(id)) { at = r; break; }
  }
  if (at === -1) return false;
  var cells = [];
  for (var k in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    var c = header.indexOf(normKey_(k));
    if (c !== -1) cells.push({ c: c, v: fields[k] });
  }
  cells.sort(function (a, b) { return a.c - b.c; });
  for (var i = 0; i < cells.length;) {
    var run = [cells[i].v], start = cells[i].c;
    while (i + run.length < cells.length && cells[i + run.length].c === start + run.length) {
      run.push(cells[i + run.length].v);
    }
    sheet.getRange(at + 1, start + 1, 1, run.length).setValues([run]);
    i += run.length;
  }
  return true;
}

/** A calendar day kept as text, so the sheet never turns it into a date of its own. */
function complianceDocsDayCell_(iso) {
  return iso ? "'" + iso : '';
}

/** The day a cell holds, read back: 'YYYY-MM-DD' or ''. */
function complianceDocsDay_(v) {
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(str_(v));
  return m ? m[1] : '';
}

function complianceDocsIsDay_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str_(s));
  if (!m) return false;
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 &&
         d.getUTCDate() === Number(m[3]);
}

/** The Drive id of a ledger row's file: its own column, else the id inside an older row's link. */
function complianceDocsFileIdOf_(row) {
  var own = str_(row && (row.fileid || row.file_id));
  if (own) return own;
  var m = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(str_(row && row.url));
  return m ? m[1] : '';
}

/** An enabled catalogue row by its id; null when the catalogue holds none. */
function complianceDocsReq_(reqId) {
  var id = str_(reqId);
  if (!id) return null;
  var rows = requirementsAll_().rows || [];
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].req_id) === id && str_(rows[i].enabled).toLowerCase() === 'yes') return rows[i];
  }
  return null;
}

/** A ledger row's requirement: its req_id, else the one enabled catalogue row whose label its cert carries. */
function complianceDocsReqOf_(reqId, cert) {
  if (str_(reqId)) return complianceDocsReq_(reqId);
  var key = hubNameFold_(cert);
  if (!key) return null;
  var rows = requirementsAll_().rows || [];
  var hits = rows.filter(function (r) {
    return str_(r.enabled).toLowerCase() === 'yes' && hubNameFold_(r.label) === key;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Why a requirement takes no paper from its person, in server/my_profile.py upload_verdict's words; '' when it does. */
function complianceDocsReqShut_(req) {
  var category = str_(req && req.category).toLowerCase();
  if (CERT_READ_UPLOADABLE[category]) return '';
  return category === 'onboarding' ? 'HR files this form.' : 'HR records this one.';
}

/** Why the master cannot confirm a date for this requirement; '' when a date column takes it. */
function complianceDocsConfirmShut_(req) {
  if (!req) return CERT_READ_WORDS.noReq;
  var shut = complianceDocsReqShut_(req);
  if (shut) return shut;
  var id = str_(req.req_id), source = str_(req.date_source);
  if (/^med[123]$/.test(id) || /^med\s*\d/i.test(source)) return CERT_CONFIRM_WORDS.med;
  if (id === 'mais') return CERT_CONFIRM_WORDS.mais;
  if (!source) return CERT_CONFIRM_WORDS.undated;
  return '';
}

// What the date a requirement's record keeps is: 'expires' — an expiry column, or a credential's date the…
function complianceDocsDateRole_(req) {
  var source = str_(req && req.date_source);
  if (!source) return '';
  return (str_(req.credential) || /\bexp/i.test(source)) ? 'expires' : 'issued';
}

/** An open member visit: the session wears the visited account, which is neither that person nor the master. */
function complianceDocsVisit_(user) {
  return !!((user && user.visiting_member) || (typeof HUB_MEMBER_CTX !== 'undefined' && HUB_MEMBER_CTX));
}

// Whether a ledger row is the settled self's: filed under its roster name and, when the row carries the roster id…
function complianceDocsMine_(row, self) {
  if (!self || !self.key || hubNameFold_(row && row.person) !== self.key) return false;
  var stamped = complianceDocsRosterId_(row && row.rosterid);
  if (stamped) return stamped === complianceDocsRosterId_(self.id);
  // `by` is the platform's own stamp of the filing session (complianceDocsStore_), never a payload's
  if (self.mail && str_(row && row.by).trim().toLowerCase() === self.mail) return true;
  return complianceDocsFiledSince_(row, self) !== false;
}

/** An older (unstamped) row against the self's roster row: true when filed on or after the row was created, false before, null when either moment is unknown. */
function complianceDocsFiledSince_(row, self) {
  var since = Date.parse(str_(self && self.since)), at = Date.parse(str_(row && row.at));
  if (isNaN(since) || isNaN(at)) return null;
  return at >= since;
}

/** A type the ledger stores and the eye answers: one of CERT_DOC_TYPES', 'image/jpg' read as JPEG; '' otherwise. */
function complianceDocsTypeOk_(mime) {
  var m = str_(mime).toLowerCase().split(';')[0].trim();
  if (m === 'image/jpg' || m === 'image/pjpeg') m = 'image/jpeg';
  for (var k in CERT_DOC_TYPES) {
    if (Object.prototype.hasOwnProperty.call(CERT_DOC_TYPES, k) && CERT_DOC_TYPES[k] === m) return m;
  }
  return '';
}

/** The type a file name's extension gives, when it is one of CERT_DOC_TYPES; '' otherwise. */
function complianceDocsTypeByName_(name) {
  var m = /\.([A-Za-z0-9]{1,5})$/.exec(str_(name).trim());
  var t = m ? CERT_DOC_TYPES[m[1].toLowerCase()] : '';
  return typeof t === 'string' ? t : '';
}

/** A browser that could not name a file's type sends none, or the generic one. */
function complianceDocsTypeLoose_(mime) {
  var m = str_(mime).toLowerCase().split(';')[0].trim();
  return !m || m === 'application/octet-stream';
}

/** HEIC and HEIF are one picture format under two names. */
function complianceDocsSameType_(a, b) {
  var heif = function (t) { return t === 'image/heic' || t === 'image/heif'; };
  return a === b || (heif(a) && heif(b));
}

// The type a document is filed as — FAIL-CLOSED, one of CERT_DOC_TYPES or ''.
function complianceDocsFileType_(name, mime) {
  var loose = complianceDocsTypeLoose_(mime);
  var sent = complianceDocsTypeOk_(mime);
  if (!loose && !sent) return '';
  var byName = complianceDocsTypeByName_(name);
  if (byName && sent && !complianceDocsSameType_(byName, sent)) return '';
  return byName || sent;
}

/** The type the eye answers a stored file as: its own when it is one of CERT_DOC_TYPES; an older file stored with no type, by its name; '' otherwise. */
function complianceDocsShownType_(mime, name) {
  var own = complianceDocsTypeOk_(mime);
  if (own) return own;
  return complianceDocsTypeLoose_(mime) ? complianceDocsTypeByName_(name) : '';
}

function complianceDocsFolder_(cert) {
  return filesChildByName_(filesChildByName_(filesRoot_(), 'Compliance Docs'), cert);
}

/** FAIL-CLOSED: null = the ledger could not be read; [] = the tab is unborn and nothing was filed yet. */
function complianceDocsRows_() {
  var ss = null;
  try { ss = hubTabWorkbook_(COMPLIANCE_DOCS_TAB); } catch (eW) { return null; }
  if (!ss) return null;
  var rows = null;
  try { rows = readTabNormalized_(ss, COMPLIANCE_DOCS_TAB); }
  catch (eR) { return /tab missing/i.test(String((eR && eR.message) || eR)) ? [] : null; }
  return Array.isArray(rows) ? rows : null;
}

/** The staff roster the ledger's names come from — the same rows the certification matrix lists. */
function complianceDocsPeople_() {
  return withoutIspClients_(peopleMerged_(listRows_('people', {})));
}

/** Every account row, the caller's own included (Auth.gs usersAll_). */
function complianceDocsAccounts_() {
  return usersAll_();
}

/** Filing for somebody else: the real master, and the writers who already file documents for others (TableDocs.gs, Compliance.gs). */
function complianceDocsFilesForOthers_(user) {
  return hubIsRealMaster_(user) || !!hubIsWriter_(user);
}

function complianceDocsLive_(row) {
  var off = str_(row && row.active).toUpperCase();
  return off !== 'FALSE' && off !== '0' && off !== 'NO' && !str_(row && row.mergedinto);
}

function complianceDocsRosterId_(v) {
  return str_(v).replace(/^people:/, '').trim();
}

/** FAIL-CLOSED: a status off the on-staff list the contact merge links by (ContactsSync.gs contactsOnStaffStatuses_), blank included, is not on staff. */
function complianceDocsOnStaff_(row) {
  var onStaff = (typeof contactsOnStaffStatuses_ === 'function') ? contactsOnStaffStatuses_() : { active: true, admin: true };
  return onStaff[str_(row && row.status).trim().toLowerCase()] === true;
}

// A roster row's e-mails.
function complianceDocsRosterMails_(p) {
  var out = [];
  var take = function (e) {
    var k = str_(e).toLowerCase();
    if (k.indexOf('@') !== -1 && out.indexOf(k) === -1) out.push(k);
  };
  take(p && p.email);
  if (p && Array.isArray(p.emails)) p.emails.forEach(take);
  return out;
}

/** How the contact merge proved an account's link when it wrote it (ContactsSync.gs contactsMergePlan_): 'email' or 'name'; '' for a link that carries no proof. */
function complianceDocsLinkProof_(account) {
  var cs = null;
  try { cs = JSON.parse(str_(account && account.contactsources) || '{}'); } catch (eC) { cs = null; }
  var how = (cs && typeof cs === 'object' && !Array.isArray(cs)) ? str_(cs.people_id) : '';
  return (how === 'email' || how === 'name') ? how : '';
}

/** Whether the account chose its display name itself (Profile.gs profileUpdate, Invites.gs): such a name may have been taken before its roster row landed, so it proves nothing here. */
function complianceDocsSelfNamed_(account) {
  return str_(account && account.nameby).trim().toLowerCase() === 'self';
}

// The caller's own name on the ledger, from the account's own row and never the payload: the roster row the account…
function complianceDocsSelf_(user) {
  var out = { name: '', key: '', names: [], id: '', since: '', mail: '', bridged: false, found: '', why: '',
              status: 403 };
  if (!user || user.is_service) {
    out.why = 'Certificates are read and filed from a person\'s own session.';
    return out;
  }
  var accounts = null;
  try { accounts = complianceDocsAccounts_(); } catch (eA) { accounts = null; }
  if (!Array.isArray(accounts)) {
    out.status = 503;
    out.why = 'The accounts could not be read, so whose certificates these are could not be settled — ' +
              'try again in a minute.';
    return out;
  }
  var uid = str_(user.id), me = null;
  for (var a = 0; a < accounts.length; a++) {
    if (uid && str_((accounts[a] || {}).userid) === uid) { me = accounts[a]; break; }
  }
  if (!me || !complianceDocsLive_(me)) {
    out.why = 'Your account is not among the active accounts, so no certificate can be matched to you.';
    return out;
  }
  var rows = null;
  try { rows = complianceDocsPeople_(); } catch (eP) { rows = null; }
  if (!Array.isArray(rows) || !rows.length) {
    out.status = 503;
    out.why = 'The staff roster could not be read, so whose certificates these are could not be settled — ' +
              'try again in a minute.';
    return out;
  }
  var pick = null, byMail = [], linked = false, vouched = false;
  var shown = str_(me.displayname).trim(), shownKey = hubNameFold_(shown);
  var mail = str_(me.email).toLowerCase();
  var pid = complianceDocsRosterId_(me.peopleid);
  if (pid) {
    pick = rows.filter(function (p) { return complianceDocsRosterId_(p && p.id) === pid; })[0] || null;
    linked = !!pick;
  }
  if (linked) {
    vouched = !!complianceDocsLinkProof_(me);
    // a link with no proof stands only on the sign-in e-mail on its row — never on a name it could have taken
    var rowHasMail = mail.indexOf('@') !== -1 && complianceDocsRosterMails_(pick).indexOf(mail) !== -1;
    if (!vouched && !rowHasMail) {
      out.why = 'Your account is linked to a roster row by an older rule, and your sign-in e-mail is not on that ' +
                'row, so it is not taken as yours — an administrator puts your sign-in e-mail on your roster row.';
      return out;
    }
  }
  if (linked && shownKey && hubNameFold_(pick.name) !== shownKey &&
      rows.some(function (p) { return p !== pick && hubNameFold_(p && p.name) === shownKey; })) {
    out.why = 'Your account is linked to one row of the staff roster and your name is on another, so which ' +
              'record is yours cannot be settled — an administrator makes the two agree, so your account\'s name ' +
              'is the name on your roster row.';
    return out;
  }
  if (!pick) {
    if (mail.indexOf('@') !== -1) {
      byMail = rows.filter(function (p) { return complianceDocsRosterMails_(p).indexOf(mail) !== -1; });
    }
    var byName = shownKey ? rows.filter(function (p) { return hubNameFold_(p && p.name) === shownKey; }) : [];
    if (byMail.length === 1) {
      pick = byMail[0];
      // one written roster cell must not carry an account off the row its own name is on
      if (byName.length && hubNameFold_(pick.name) !== shownKey) {
        out.why = 'Your sign-in e-mail is on one row of the staff roster and your name is on another, so which ' +
                  'record is yours cannot be settled — an administrator corrects the e-mail on the roster or the ' +
                  'name on your account, so both point at your row.';
        return out;
      }
    } else {
      // several rows with the name are refused below
      pick = byName[0] || null;
      if (pick && complianceDocsSelfNamed_(me)) {
        out.why = 'Your name was chosen on your own account, and a name can be taken before its roster row exists, ' +
                  'so it is not taken as proof of which record is yours — an administrator sets the name on your ' +
                  'account, or puts your sign-in e-mail on your roster row.';
        return out;
      }
    }
  }
  if (!pick) {
    out.why = byMail.length > 1
      ? 'Your sign-in e-mail is on more than one row of the staff roster and your name is on none, so no ' +
        'certificate can be matched to you — an administrator gives your account the exact name on your roster row.'
      : !shown
        ? 'Your account has no name on file, so no certificate can be matched to you — an administrator sets the name.'
        : !shownKey
          ? 'Your name on file, "' + shown + '", has no letters a–z or digits, and certificates are matched to a ' +
            'person by those, so none can be matched to you.'
          : (pid ? 'The roster row your account is linked to is not on the staff roster'
                 : 'Your account is not linked to a roster row') +
            ' and your name is not on the staff roster, so no certificate can be matched to you — an administrator ' +
            'gives your account the exact name on your roster row, or puts your sign-in e-mail on it.';
    return out;
  }
  if (!vouched && !complianceDocsOnStaff_(pick)) {
    var word = str_(pick.status).trim();
    out.why = (word ? 'The staff roster row that matches your account is marked "' + word + '", not on staff'
                    : 'The staff roster row that matches your account carries no staff status') +
              ', so it may be someone no longer here — no certificate can be matched to you until your own row on ' +
              'the staff roster carries a staff status.';
    return out;
  }
  var key = hubNameFold_(pick.name);
  if (!key) {
    var rosterName = str_(pick.name).trim();
    out.why = rosterName
      ? 'Your roster row\'s name, "' + rosterName + '", has no letters a–z or digits, and certificates are matched ' +
        'to a person by those, so none can be matched to you.'
      : 'Your roster row has no name, so no certificate can be matched to you — an administrator sets the name on ' +
        'the roster.';
    return out;
  }
  var twins = rows.filter(function (p) { return hubNameFold_(p && p.name) === key; });
  if (twins.length > 1) {
    out.found = str_(pick.name);
    out.why = 'Two rows on the staff roster carry your name, so certificates filed under it cannot be told apart — ' +
              'an administrator merges the rows or gives one a distinguishing name.';
    return out;
  }
  var twinId = complianceDocsRosterId_(pick.id), twinMails = complianceDocsRosterMails_(pick);
  for (var j = 0; j < accounts.length; j++) {
    var o = accounts[j] || {};
    if (str_(o.userid) === uid || !complianceDocsLive_(o)) continue;
    var oPid = complianceDocsRosterId_(o.peopleid), oMail = str_(o.email).toLowerCase();
    if (hubNameFold_(o.displayname) === key || (oPid && oPid === twinId) ||
        (oMail && twinMails.indexOf(oMail) !== -1)) {
      out.found = str_(pick.name);
      out.why = 'Your name is shared with another account, so no certificate can be matched to you by name — ' +
                'an administrator settles which account is yours.';
      return out;
    }
  }
  out.name = str_(pick.name);
  out.key = key;
  out.id = twinId;
  // when the roster row was created (SheetDb.gs createdAt): an older ledger row filed before it is not this person's
  out.since = str_(pick.createdAt || pick.createdat || pick.created_at);
  out.mail = mail.indexOf('@') !== -1 ? mail.trim() : '';
  // not the account's own roster name, and no link the name proved: the row stands on a roster e-mail a writer typed
  out.bridged = !(shownKey === key && !complianceDocsSelfNamed_(me)) &&
                !(linked && complianceDocsLinkProof_(me) === 'name');
  out.names = shownKey && shownKey !== key ? [key, shownKey] : [key];
  out.status = 200;
  return out;
}

/** An unsettled caller's refusal, typed as their own scope; `self` only when the refused record was theirs. */
function complianceDocsRefusal_(self) {
  var env = { status: self.status, message: self.why, scope: 'own' };
  if (self.found) env.self = self.found;
  return env;
}

// The Staff answers (StaffProfiles.gs) that read the ledger or the Master dates, cached per person.
var CERT_STAFF_READS = ['staffProfileCompliance', 'staffProfileActions', 'staffProfileDocuments'];

/** A filing, a reading or a confirmation landed for `person`: the Staff app's cached answers for them are retired. */
function complianceDocsStaffBump_(person) {
  var key = hubNameFold_(person);
  if (!key || typeof staffProfilesBump_ !== 'function') return;
  CERT_STAFF_READS.forEach(function (action) {
    try { staffProfilesBump_(action, key); } catch (eB) { /* a cache never costs the write */ }
  });
}

/** The Employee Database row a name finds (Emp360.gs); throws when the Master cannot be read. */
function complianceDocsMasterRow_(name) {
  return emp360FindMasterRow_(name, '');
}

// The spelling a document filed for someone else is kept under, so it lands where that person's own list reads (the…
function complianceDocsFilingName_(asked) {
  var key = hubNameFold_(asked);
  if (!key) return { name: asked };
  var rows = null;
  try { rows = complianceDocsPeople_(); } catch (eP) { rows = null; }
  if (!Array.isArray(rows) || !rows.length) {
    return { error: { status: 503, message: 'The staff roster could not be read, so whose record this document ' +
             'belongs to could not be settled — try again in a minute. Nothing was filed.' } };
  }
  var same = rows.filter(function (p) { return hubNameFold_(p && p.name) === key; });
  if (same.length > 1) {
    return { error: { status: 409, message: 'Two rows on the staff roster carry "' + asked + '", so a document ' +
             'filed under it could not be told apart — an administrator merges the rows or gives one a ' +
             'distinguishing name. Nothing was filed.' } };
  }
  if (same.length === 1) return { name: str_(same[0].name), id: complianceDocsRosterId_(same[0].id) };
  var found = null;
  try { found = complianceDocsMasterRow_(asked); } catch (eM) {
    return { error: { status: 503, message: 'The Employee Database could not be read, so the roster row "' + asked +
             '" belongs to could not be found — try again in a minute. Nothing was filed.' } };
  }
  var eid = (found && found.row) ? str_(found.row.employee_id) : '';
  if (eid) {
    var byId = rows.filter(function (p) { return str_(p && p.employee_id) === eid; });
    if (byId.length === 1 && hubNameFold_(byId[0].name)) {
      return { name: str_(byId[0].name), id: complianceDocsRosterId_(byId[0].id) };
    }
  }
  return { name: asked };
}

function complianceDocsSharedFolder_() {
  return DriveApp.getFolderById(hubId_('COMPLIANCE_SHARED_FOLDER_ID'));
}

// The courtesy copy in the shared Staff Docs archive: never fatal, and never while test mode is on.
function complianceDocsSharedCopy_(blob) {
  var on = true;
  try { on = hubTestModeOn_(); } catch (eMode) { on = true; }
  if (on) return false;
  try {
    complianceDocsSharedFolder_().createFile(blob);
    return true;
  } catch (eShared) { return false; }
}

// Whether a filed paper waits for its reading: owed to a requirement a paper is read for, and filed outside a visit.
function complianceDocsReadWaits_(owed, user) {
  return !!owed && !complianceDocsReqShut_(owed) && !complianceDocsVisit_(user);
}

/** Decodes the file, lands it in Compliance Docs/<cert> as one of CERT_DOC_TYPES and records the ledger row, stamped with the roster id it was filed for when one is settled. */
function complianceDocsStore_(person, cert, name, mime, b64, user, req, rosterId) {
  var type = complianceDocsTypeOk_(mime);
  if (!type) return { status: 400, message: CERT_DOC_TYPE_WORDS + ' Nothing was filed.' };
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty.' };
  var blob = Utilities.newBlob(bytes, type, name);
  var file = complianceDocsFolder_(cert).createFile(blob);
  var fileId = file.getId();
  var url = 'https://drive.google.com/file/d/' + fileId + '/view';
  var shared = complianceDocsSharedCopy_(blob);
  var at = new Date().toISOString();
  var id = Utilities.getUuid();
  // a paper filed under a requirement it is read for waits for its reading; filing never waits on the catalogue
  var owed = req || null;
  if (!owed) {
    try { owed = complianceDocsReqOf_('', cert); } catch (eC) { owed = null; }
  }
  var readState = complianceDocsReadWaits_(owed, user) ? 'pending' : '';
  var reqId = owed ? str_(owed.req_id) : '';
  complianceDocsAppend_({
    id: id, person: hubCellSafe_(person), cert: hubCellSafe_(cert), name: hubCellSafe_(name), url: url,
    by: str_(user.email), at: at, file_id: fileId, req_id: reqId, read_state: readState,
    roster_id: hubCellSafe_(complianceDocsRosterId_(rosterId))
  });
  return { status: 200, data: {
    id: id, person: person, cert: cert, name: name, url: url,
    by: str_(user.email), at: at, shared: shared, req_id: reqId, read_state: readState
  } };
}

/** File one certificate document (image or PDF) — against the caller's own record unless the caller files for others. */
HUB_POLICY.certDocUpload = {
  file: 'ComplianceDocs.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { req_id: { type: 'string' } }
};
HUB_ACTIONS.certDocUpload = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var role = String(user.role);
  if (role !== 'admin' && role !== 'manager' && role !== 'staff') return hubDenied_();
  payload = payload || {};
  var cert = str_(payload.cert);
  // a requirement id names its own label and folder: the payload's text is not asked
  var req = null;
  if (str_(payload.req_id)) {
    req = complianceDocsReq_(payload.req_id);
    if (!req) return { status: 400, message: 'That requirement is not in the catalogue. Nothing was filed.' };
    var shut = complianceDocsReqShut_(req);
    if (shut) return { status: 400, message: shut + ' Nothing was filed.' };
    cert = str_(req.label);
  }
  if (!cert) return { status: 400, message: 'A certification is required.' };
  // a name with no letters or digits names nobody, and is taken as no name at all
  var asked = hubNameFold_(str_(payload.person)) ? str_(payload.person) : '';
  // the master's session always names whose record a paper goes on: never its own by default
  if (!asked && hubIsRealMaster_(user)) return { status: 400, message: CERT_UPLOAD_NOBODY };
  var person = '', rosterId = '';
  if (asked && complianceDocsFilesForOthers_(user)) {
    // a writer naming themselves in another spelling files where their own list reads
    var mine = complianceDocsSelf_(user);
    if (mine.key && mine.names.indexOf(hubNameFold_(asked)) !== -1) {
      person = mine.name;
      rosterId = mine.id;
    } else {
      // for someone else: under the roster's spelling, which is what their own list reads
      var filedAs = complianceDocsFilingName_(asked);
      if (filedAs.error) return filedAs.error;
      person = filedAs.name;
      rosterId = str_(filedAs.id);
    }
  } else {
    var self = complianceDocsSelf_(user);
    if (!self.key) return { status: self.status, message: self.why + ' Nothing was filed.' };
    // the roster name or the account's own display name; either way it is filed under the roster name
    if (asked && self.names.indexOf(hubNameFold_(asked)) === -1) {
      return { status: 403, message: 'A certificate is filed against your own record — "' + asked +
               '" is not the name this account is known by ("' + self.name + '"). Filing for someone else ' +
               'is for an administrator or a manager; if this is you, an administrator gives your account ' +
               'the exact name on your roster row. Nothing was filed.' };
    }
    person = self.name;
    rosterId = self.id;
  }
  var name = str_(payload.filename) || 'document';
  var mime = complianceDocsFileType_(name, payload.mime);
  if (!mime) return { status: 400, message: CERT_DOC_TYPE_WORDS + ' Nothing was filed.' };
  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'The file is required.' };
  // base64 carries 4/3 of the bytes: this is ~15MB decoded.
  if (b64.length > 21000000) {
    return { status: 400, message: 'The file is too large — up to 15MB.' };
  }
  var filed = complianceDocsStore_(person, cert, name, mime, b64, user, req, rosterId);
  if (filed && filed.status === 200) complianceDocsStaffBump_(person);
  return filed;
};

/** The certificate submissions ledger: every row for the real master, the caller's own rows for everyone else. A refusal carries the same `scope`, so a screen can tell a refusal about the caller from one about the ledger, and `self` when the refused record was the caller's own. */
HUB_POLICY.certUploadsList = {
  file: 'ComplianceDocs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: []
};
HUB_ACTIONS.certUploadsList = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var role = String(user.role);
  if (role !== 'admin' && role !== 'manager' && role !== 'staff') return hubDenied_();
  // an open visit is neither the person nor the master: it is answered no row, as the eye opens none
  if (complianceDocsVisit_(user)) return { status: 403, message: CERT_READ_WORDS.visit, scope: 'own' };
  var all = hubIsRealMaster_(user);
  var self = all ? null : complianceDocsSelf_(user);
  if (self && !self.key) return complianceDocsRefusal_(self);
  var rows = complianceDocsRows_();
  if (rows === null) {
    return { status: 503, message: 'The certificate submissions could not be read just now — nothing is listed ' +
             'rather than an empty list.', scope: all ? 'all' : 'own' };
  }
  var out = [];
  rows.forEach(function (r) {
    if (self && hubNameFold_(r.person) !== self.key) return;
    if (self && !complianceDocsMine_(r, self)) return;
    out.push(complianceDocsOut_(r));
  });
  return { status: 200, data: { uploads: out, scope: all ? 'all' : 'own', self: self ? self.name : '' } };
};

/** One ledger row as the doors answer it (a row read through readTabNormalized_), with the roster id it was filed for ('' on an older row) and the reading's kind in words ('' for a kind the words do not name). */
function complianceDocsOut_(r) {
  var conf = str_(r.readconfidence);
  var kind = str_(r.readkind);
  return {
    id: str_(r.id), person: str_(r.person), cert: str_(r.cert),
    name: str_(r.name), url: str_(r.url), by: str_(r.by), at: str_(r.at),
    roster_id: complianceDocsRosterId_(r.rosterid),
    file_id: complianceDocsFileIdOf_(r), req_id: str_(r.reqid),
    read_state: str_(r.readstate), read_kind: kind,
    read_kind_words: Object.prototype.hasOwnProperty.call(CERT_READ_KIND_WORDS, kind) ? CERT_READ_KIND_WORDS[kind] : '',
    issued_on: complianceDocsDay_(r.issuedon), expires_on: complianceDocsDay_(r.expireson),
    read_how: str_(r.readhow), read_confidence: conf === '' || isNaN(Number(conf)) ? null : Number(conf),
    read_why: str_(r.readwhy), read_at: str_(r.readat), read_v: str_(r.readv),
    confirmed_on: complianceDocsDay_(r.confirmedon), confirmed_by: str_(r.confirmedby),
    confirmed_at: str_(r.confirmedat)
  };
}

/** A copy of a read row with `fields` (header names) written over it, as the sheet will read them back. */
function complianceDocsWith_(row, fields) {
  var out = {};
  for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  for (var f in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, f)) continue;
    var v = fields[f];
    out[normKey_(f)] = typeof v === 'string' ? v.replace(/^'/, '') : v;
  }
  return out;
}

// Whose document a row is, before anything of it is read: the real master may open any row; anyone else only a row…
function complianceDocsOwnRow_(id, user) {
  if (complianceDocsVisit_(user)) return { refused: { status: 403, message: CERT_READ_WORDS.notYours } };
  var all = hubIsRealMaster_(user);
  var self = all ? null : complianceDocsSelf_(user);
  if (self && !self.key) return { refused: complianceDocsRefusal_(self) };
  var rows = complianceDocsRows_();
  if (rows === null) {
    return { refused: { status: 503, message: 'The certificate submissions could not be read just now — try again ' +
                        'in a minute.' } };
  }
  var want = str_(id), row = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].id) === want) { row = rows[i]; break; }
  }
  if (!row || (self && !complianceDocsMine_(row, self))) {
    return { refused: all ? { status: 404, message: 'No document with that id is on the ledger.' }
                          : { status: 403, message: CERT_READ_WORDS.notYours } };
  }
  return { row: row, self: self, all: all };
}

/** The one roster row a ledger name folds to; '' when none or two; null when the roster cannot be read. */
function complianceDocsSubjectRow_(person) {
  var key = hubNameFold_(person);
  if (!key) return '';
  var rows = null;
  try { rows = complianceDocsPeople_(); } catch (eP) { rows = null; }
  if (!Array.isArray(rows) || !rows.length) return null;
  var same = rows.filter(function (p) { return hubNameFold_(p && p.name) === key; });
  return same.length === 1 ? same[0] : '';
}

/** The roster id a ledger name is filed under: the one roster row it folds to; '' when none or two; null when the roster cannot be read. */
function complianceDocsSubjectId_(person) {
  var row = complianceDocsSubjectRow_(person);
  return row === null ? null : (row ? complianceDocsRosterId_(row.id) : '');
}

/** The roster id a row's paper is anchored to: the caller's own, else the id the row was filed for, else the one roster row its name folds to; null when the roster cannot be read. */
function complianceDocsSubjectOf_(row, subjectId) {
  if (subjectId !== undefined && subjectId !== null) return subjectId;
  return complianceDocsRosterId_(row && row.rosterid) || complianceDocsSubjectId_(row && row.person);
}

function complianceDocsDriveFile_(fileId) {
  return DriveApp.getFileById(fileId);
}

/** Whether a file sits where the store files every document, Compliance Docs/<cert> (complianceDocsFolder_). */
function complianceDocsFiledHere_(file) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    var up = parents.next().getParents();
    while (up.hasNext()) {
      if (str_(up.next().getName()) === 'Compliance Docs') return true;
    }
  }
  return false;
}

// The bytes of one Compliance Docs file, as the deploying account that owns it reads them — only a file the eye may…
function complianceDocsFileRead_(fileId) {
  var file = complianceDocsDriveFile_(fileId);
  if (!complianceDocsFiledHere_(file)) return { stray: true };
  var size = Number(file.getSize()) || 0;
  var name = str_(file.getName()), stored = str_(file.getMimeType());
  var mime = complianceDocsShownType_(stored, name);
  if (!mime) return { name: name, mime: stored, size: size, unshown: true };
  if (size > CERT_DOC_MAX_BYTES) return { name: name, mime: mime, size: size, tooBig: true };
  return { name: name, mime: mime, size: size, b64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

// The document itself, for the eye: the caller's own record only, the master's any, and never to an account that…
HUB_POLICY.certDocFile = {
  file: 'ComplianceDocs.gs', lane: 'tool', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { id: { required: true, type: 'string' } }
};
HUB_ACTIONS.certDocFile = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var role = String(user.role);
  if (role !== 'admin' && role !== 'manager' && role !== 'staff') return hubDenied_();
  var got = complianceDocsOwnRow_((payload || {}).id, user);
  if (got.refused) return got.refused;
  if (got.self && got.self.bridged) return { status: 403, message: CERT_READ_WORDS.bridged };
  var fileId = complianceDocsFileIdOf_(got.row);
  if (!fileId) return { status: 404, message: CERT_READ_WORDS.noFile };
  var file = null;
  try { file = complianceDocsFileRead_(fileId); }
  catch (eF) {
    var gone = /not found|no item|does not exist|trashed/i.test(String((eF && eF.message) || eF));
    return gone ? { status: 404, message: 'The file behind this document is no longer in the drive.' }
                : { status: 503, message: 'The document could not be opened just now — try again in a minute.' };
  }
  if (file.stray) return { status: 404, message: CERT_READ_WORDS.stray };
  var shown = file.unshown ? '' : complianceDocsTypeOk_(file.mime);
  if (!shown) return { status: 415, message: CERT_READ_WORDS.unshown };
  if (file.tooBig) return { status: 400, message: 'This file is larger than 15MB, so it is not shown here.' };
  return { status: 200, data: { id: str_(got.row.id), name: file.name || str_(got.row.name), mime: shown,
                                size: file.size, b64: file.b64 } };
};

function certReadA_(w) {
  return (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
}

function certReadKindWords_(kind) {
  var k = str_(kind);
  return certReadA_(CERT_READ_KIND_WORDS[k] || k.replace(/_/g, ' '));
}

// Whether a paper's reading stands for its requirement — pure.
function certReadVerdict_(req, paper, subjectId) {
  var p = paper || {};
  var reqId = str_(req && req.req_id);
  var label = str_(req && req.label) || reqId || 'this requirement';
  var role = complianceDocsDateRole_(req);
  var out = { state: 'unread', kind: str_(p.kind), issued_on: complianceDocsDay_(p.issued_on),
              expires_on: complianceDocsDay_(p.expires_on), how: str_(p.expires_source),
              confidence: 0, why: '', who: '', person_source: '' };
  var credentialDays = false;
  if (role === 'issued') {
    out.expires_on = '';
    out.how = 'issued' + (str_(p.how && p.how.issued) ? ':' + str_(p.how.issued) : '');
    if (CERT_READ_REPORT_KINDS[out.kind] === true) {
      var drawn = complianceDocsDay_(p.report_on);
      if (drawn) {
        out.issued_on = drawn;
        out.how = 'issued:report';
      } else {
        // its issue day may be the licence's: never kept as the record's
        credentialDays = !!complianceDocsDay_(p.expires_on) || p.licence_dated === true;
        if (credentialDays) out.issued_on = '';
      }
    }
  }
  var refuse = function (why) { out.why = why; return out; };
  if (p.state === 'heic') return refuse(CERT_READ_WORDS.heic);
  if (p.state !== 'read' || !Number(p.chars)) return refuse(CERT_READ_WORDS.empty);
  var kinds = CERT_READ_KINDS[reqId] || null;
  if (kinds) {
    if (!out.kind) {
      return refuse('What this paper is could not be told from its words, so it is not taken as ' +
                    certReadA_(label) + '.');
    }
    if (kinds.indexOf(out.kind) === -1) {
      return refuse('This reads as ' + certReadKindWords_(out.kind) + ', not ' + certReadA_(label) + '.');
    }
  }
  var med = /^med([123])$/.exec(reqId);
  var levels = med && str_(p.level) ? str_(p.level).split(',') : [];
  if (med && levels.length && levels.indexOf(med[1]) === -1) {
    return refuse('This reads as a Category ' + levels.join(' and ') + ' medication certificate, not ' +
                  certReadA_(label) + '.');
  }
  // a medication certificate's own category line, read and matching the row, is the paper naming itself
  var kindScore = Number(p.kind_score || 0) + (med && levels.length ? CERT_READ_LEVEL_SCORE : 0);
  if (kinds && kindScore < 10) {
    return refuse('This reads only faintly as ' + certReadA_(label) + ', so its dates are not taken.');
  }
  if (med) {
    if (!levels.length) {
      return refuse('The category on this medication certificate could not be read, so it is not taken as ' +
                    certReadA_(label) + '.');
    }
    // a grid's own line for this category, never the latest line of another
    var best = null;
    (p.grid || []).forEach(function (g) {
      if (g && g.status === 'certified' && str_(g.level) === med[1] && (!best || str_(g.expires) > str_(best.expires))) best = g;
    });
    if (best && complianceDocsDay_(best.expires)) {
      out.expires_on = complianceDocsDay_(best.expires);
      out.issued_on = complianceDocsDay_(best.effective) || out.issued_on;
      out.how = 'grid';
    }
  }
  // ids compared bare: the decoder writes a staff id as people:<roster id>, a client as client:<key>
  var who = str_(p.who);
  var subject = str_(subjectId).replace(/^(people:)+/, '');
  var whoId = /^people:/.test(who) ? who.replace(/^(people:)+/, '') : '';
  if (who && (!subject || whoId !== subject)) return refuse(CERT_READ_WORDS.someone);
  if (subject) {
    out.who = 'people:' + subject;
    out.person_source = who ? 'document' : 'ledger';
  }
  if (role === 'expires') {
    if (CERT_READ_NEVER_EXPIRES[out.kind] === true) {
      // whatever reads as an expiry on it is not its own
      out.expires_on = '';
      var paperWords = certReadKindWords_(out.kind);
      return refuse(paperWords.charAt(0).toUpperCase() + paperWords.slice(1) + ' carries no expiry, so it gives ' +
                    'this record no date — HR confirms the date.');
    }
    if (!out.expires_on) return refuse(CERT_READ_WORDS.noExpiry);
    // an expiry worked out from the issue day stands only on the requirement's own kind and its renewal rule
    if (/^derived/.test(out.how) && !(kinds && kinds.indexOf(out.kind) !== -1)) return refuse(CERT_READ_WORDS.noExpiry);
  } else if (role === 'issued') {
    if (credentialDays) return refuse(CERT_READ_WORDS.noRecordDay);
    if (!out.issued_on) return refuse(CERT_READ_WORDS.noIssued);
  }
  var facts = {};
  var src = p.facts || {};
  for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) facts[k] = src[k];
  facts.who = out.who;
  facts.person_source = out.person_source;
  facts.issued_on = out.issued_on;
  facts.expires_on = out.expires_on;
  out.confidence = digestConfidence_(facts);
  var floor = digestSetting_('distribute_confidence', 85, 50, 100);
  if (out.confidence < floor) {
    return refuse('The reading was not sure enough to take its dates (' + out.confidence + ' of the ' + floor +
                  ' needed).');
  }
  out.state = 'read';
  return out;
}

// The words book as a certificate is read by — pure over the book.
function certReadVocab_(book, expect) {
  var v = {};
  for (var key in book) if (Object.prototype.hasOwnProperty.call(book, key)) v[key] = book[key];
  if (book.credentials && book.credentials.length) {
    v.credentials = book.credentials.map(function (row) {
      if (str_(row[4])) return row;
      var seed = DIGEST_CREDENTIALS.filter(function (s) { return s[0] === str_(row[0]); })[0];
      return seed ? [row[0], row[1], row[2], row[3], seed[4]] : row;
    });
  }
  if (book.kinds && book.kinds.length) {
    var kinds = book.kinds.slice();
    (expect || []).forEach(function (kind) {
      var seed = DIGEST_DOC_KINDS.filter(function (s) { return s[0] === kind; })[0];
      if (!seed) return;
      for (var i = 0; i < kinds.length; i++) {
        if (kinds[i][0] !== kind) continue;
        var needles = (kinds[i][2] || []).slice();
        seed[2].forEach(function (n) { if (needles.indexOf(n) === -1) needles.push(n); });
        kinds[i] = [kinds[i][0], kinds[i][1], needles, kinds[i][3]];
        return;
      }
      kinds.push(seed);
    });
    v.kinds = kinds;
  }
  return v;
}

/** Runs `read` over the certificate read's view of the words book, and puts the book back whatever happens. */
function certReadWithVocab_(expect, read) {
  var book = digestVocab_();
  DIGEST_VOCAB = certReadVocab_(book, expect);
  try { return read(); } finally { DIGEST_VOCAB = book; }
}

// Reads one ledger row's paper and writes the verdict onto that row only — never staff_clearance, the engine's…
function complianceDocsReadRow_(row, subjectId) {
  var id = str_(row.id);
  var before = Number(str_(row.readtries)) || 0;
  var tries = before + 1;
  var now = new Date().toISOString();
  var spent = function (n) {
    return { state: 'unread', why: 'The file could not be read after ' + n + ' tries — HR confirms the date from ' +
                                   'the document.' };
  };
  var req = null, reqRead = true;
  try { req = complianceDocsReqOf_(row.reqid, row.cert); } catch (eQ) { reqRead = false; }
  var fileId = complianceDocsFileIdOf_(row);
  // the decoder's version is kept as text, like the days: the sheet never reads it as a date
  var fields = { req_id: req ? str_(req.req_id) : str_(row.reqid), read_at: now, read_tries: tries,
                 read_v: "'" + DIGEST_VERSION };
  var verdict = null;
  if (before >= CERT_READ_TRIES) {
    fields.read_tries = before;
    verdict = spent(before);
  } else if (reqRead && (!req || complianceDocsReqShut_(req))) {
    verdict = { state: 'unread', why: CERT_READ_WORDS.noReq };
  } else if (!fileId) {
    verdict = { state: 'unread', why: CERT_READ_WORDS.noFile };
  }
  if (!verdict) {
    if (!complianceDocsPatch_(id, { read_state: 'pending', read_at: now, read_tries: tries })) {
      return { status: 404, message: 'No document with that id is on the ledger.' };
    }
    var paper = null;
    var expect = CERT_READ_KINDS[str_(req && req.req_id)] || [];
    if (reqRead) {
      // a file outside the compliance folder is never read, as the eye never shows it; a lookup that failed reads again
      var here = null;
      try { here = complianceDocsFiledHere_(complianceDocsDriveFile_(fileId)); } catch (eH) { here = null; }
      if (here === false) {
        verdict = { state: 'unread', why: CERT_READ_WORDS.stray };
      } else if (here) {
        try { paper = certReadWithVocab_(expect, function () { return digestReadPaper_(fileId, '', str_(row.name)); }); }
        catch (eP) { paper = { state: 'error', why: String((eP && eP.message) || eP) }; }
      }
    }
    if (paper && paper.state !== 'error') {
      try {
        var subject = complianceDocsSubjectOf_(row, subjectId);
        if (subject !== null) {
          verdict = certReadWithVocab_(expect, function () { return certReadVerdict_(req, paper, subject); });
        }
      } catch (eV) { verdict = null; }
    }
    if (!verdict) {
      if (tries < CERT_READ_TRIES) {
        var wait = { read_why: 'The file could not be read just now — it is read again within minutes.' };
        complianceDocsPatch_(id, wait);
        return { status: 200, data: complianceDocsOut_(complianceDocsWith_(row, {
          read_state: 'pending', read_at: now, read_tries: tries, read_why: wait.read_why })) };
      }
      verdict = spent(tries);
    }
  }
  fields.read_state = verdict.state;
  fields.read_kind = str_(verdict.kind);
  fields.issued_on = complianceDocsDayCell_(complianceDocsDay_(verdict.issued_on));
  fields.expires_on = complianceDocsDayCell_(complianceDocsDay_(verdict.expires_on));
  fields.read_how = str_(verdict.how);
  fields.read_confidence = verdict.confidence ? Number(verdict.confidence) : '';
  fields.read_why = str_(verdict.why);
  if (!complianceDocsPatch_(id, fields)) return { status: 404, message: 'No document with that id is on the ledger.' };
  complianceDocsStaffBump_(row.person);
  return { status: 200, data: complianceDocsOut_(complianceDocsWith_(row, fields)) };
}

// Reads the dates on an uploaded paper with the decoder, and keeps the reading on the ledger row.
HUB_POLICY.certDocRead = {
  file: 'ComplianceDocs.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager', 'staff'],
  invalidates: [], emits: [],
  params: { id: { required: true, type: 'string' } }
};
HUB_ACTIONS.certDocRead = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  var role = String(user.role);
  if (role !== 'admin' && role !== 'manager' && role !== 'staff') return hubDenied_();
  var got = complianceDocsOwnRow_((payload || {}).id, user);
  if (got.refused) return got.refused;
  var state = str_(got.row.readstate);
  if (state === 'read' || state === 'unread') return { status: 200, data: complianceDocsOut_(got.row) };
  try {
    return complianceDocsReadRow_(got.row, got.self ? got.self.id : undefined);
  } catch (eR) {
    return { status: 503, message: 'The reading could not be kept on the ledger just now — the document is read ' +
             'again within minutes.' };
  }
};

// The papers whose own reading died: a few per digest pass, oldest first, on what the pass's budget leaves.
function certDocReadSweep_(left) {
  var rows = complianceDocsRows_();
  if (!rows || !rows.length) return 0;
  var now = new Date().getTime();
  var due = rows.filter(function (r) {
    if (str_(r.readstate) !== 'pending') return false;
    var last = Date.parse(str_(r.readat) || str_(r.at));
    return isNaN(last) || now - last >= CERT_READ_WAIT_MS;
  });
  due.sort(function (a, b) { return str_(a.at) < str_(b.at) ? -1 : 1; });
  var n = 0;
  for (var i = 0; i < due.length && n < CERT_READ_SWEEP_PER_PASS; i++) {
    if (typeof left === 'function' && left() < CERT_READ_SWEEP_FLOOR_MS) break;
    try { complianceDocsReadRow_(due[i]); } catch (eS) { /* counted on the row; the next pass tries again */ }
    n++;
  }
  return n;
}

// The row, its requirement and the Master cell a confirmation would write, for the master.
function complianceDocsConfirmTarget_(payload) {
  var rows = complianceDocsRows_();
  if (rows === null) {
    return { refused: { status: 503, message: 'The certificate submissions could not be read just now — nothing ' +
                        'was written.' } };
  }
  var want = str_(payload && payload.id), row = null;
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].id) === want) { row = rows[i]; break; }
  }
  if (!row) return { refused: { status: 404, message: 'No document with that id is on the ledger.' } };
  var req = null;
  try { req = complianceDocsReqOf_(row.reqid, row.cert); } catch (eQ) {
    return { refused: { status: 503, message: 'The requirements catalogue could not be read just now — nothing was ' +
                        'written.' } };
  }
  var stamped = complianceDocsRosterId_(row.rosterid), other = '', employeeId = '';
  if (stamped) {
    var found = complianceDocsSubjectRow_(row.person);
    if (found === null) {
      return { refused: { status: 503, message: 'The staff roster could not be read just now — nothing was written.' } };
    }
    if (!found || complianceDocsRosterId_(found.id) !== stamped) other = CERT_CONFIRM_WORDS.earlier;
    else employeeId = str_(found.employee_id);
  }
  return { row: row, req: req, shut: complianceDocsConfirmShut_(req) || other, employee_id: employeeId };
}

/** What the record holds now for a filed document — the witness the confirmation is checked against. Master only. */
HUB_POLICY.certUploadRecord = {
  file: 'ComplianceDocs.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: [],
  params: { id: { required: true, type: 'string' } }
};
HUB_ACTIONS.certUploadRecord = function (payload, user) {
  if (!hubIsRealMaster_(user)) return { status: 403, message: CERT_CONFIRM_WORDS.master };
  var t = complianceDocsConfirmTarget_(payload);
  if (t.refused) return t.refused;
  var source = t.req ? str_(t.req.date_source) : '';
  var data = { id: str_(t.row.id), person: str_(t.row.person), req_id: t.req ? str_(t.req.req_id) : '',
               date_source: source, date_role: complianceDocsDateRole_(t.req), record: '', record_why: '',
               confirm: { allowed: false, why: t.shut } };
  if (t.shut) return { status: 200, data: data };
  var now = complianceMasterNow_(str_(t.row.person), source, t.employee_id);
  if (!now.ok) {
    data.record_why = 'The record could not be read for this person: ' + now.why + '.';
    data.confirm.why = data.record_why;
    return { status: 200, data: data };
  }
  data.record = now.value;
  data.confirm = { allowed: true, why: '' };
  return { status: 200, data: data };
};

// The master confirms a filed document's date into the Employee Database Master — the one way an upload reaches the…
HUB_POLICY.certUploadConfirm = {
  file: 'ComplianceDocs.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: ['certMatrix', 'staffCerts'], emits: [],
  params: { id: { required: true, type: 'string' }, date: { required: true, type: 'string' },
            expected: { type: 'string' } }
};
HUB_ACTIONS.certUploadConfirm = function (payload, user) {
  if (!hubIsRealMaster_(user)) return { status: 403, message: CERT_CONFIRM_WORDS.master };
  payload = payload || {};
  var date = str_(payload.date);
  if (!complianceDocsIsDay_(date)) return { status: 400, message: 'The date must be a calendar day (YYYY-MM-DD).' };
  var t = complianceDocsConfirmTarget_(payload);
  if (t.refused) return t.refused;
  if (t.shut) return { status: 409, message: t.shut + ' Nothing was written.' };
  var person = str_(t.row.person), source = str_(t.req.date_source);
  var now = complianceMasterNow_(person, source, t.employee_id);
  if (!now.ok) {
    return { status: /could not be read/.test(now.why) ? 503 : 409,
             message: 'The record could not be matched: ' + now.why + ' — nothing was written.' };
  }
  var expected = str_(payload.expected);
  if (now.value !== expected) {
    return { status: 409, message: 'The record now holds "' + (now.value || 'nothing') + '", not what was shown — ' +
             'nothing was written.', data: { current: now.value } };
  }
  var wrote = complianceWriteMasterDate_(person, source, date, expected, user, t.employee_id);
  if (!wrote.ok) return { status: 409, message: 'The record was not written: ' + str_(wrote.why) + '.' };
  complianceDocsStaffBump_(person);
  var at = new Date().toISOString();
  var stamped = false;
  try {
    stamped = complianceDocsPatch_(str_(t.row.id), { confirmed_on: complianceDocsDayCell_(date),
                                                     confirmed_by: str_(user.email), confirmed_at: at });
  } catch (eS) { stamped = false; }
  return { status: 200, data: {
    id: str_(t.row.id), req_id: str_(t.req.req_id), date_source: source,
    confirmed_on: date, confirmed_by: str_(user.email), confirmed_at: at, ledger_stamped: !!stamped,
    message: 'The record now holds ' + date + '; the status follows at the next check.' +
             (stamped ? '' : ' The ledger row could not be stamped as confirmed.')
  } };
};
