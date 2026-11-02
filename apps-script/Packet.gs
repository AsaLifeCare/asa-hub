/** NEW HIRE PACKET — is the signed application on file? */

/** Additive columns on entity_candidates. Written raw, read normalised. */
var PACKET_COL_SRID = 'packet_srid';
var PACKET_COL_STATUS = 'packet_status';
var PACKET_COL_MATCHED_BY = 'packet_matched_by';
var PACKET_COL_CHECKED_AT = 'packet_checked_at';
var PACKET_COL_WAIVED_BY = 'packet_waived_by';
// The day the envelope was SIGNED, which is not the day we checked (the calendar carries the New Hire Package date…
var PACKET_COL_SIGNED_AT = 'packet_signed_at';

/** The Recruitment mirror (every Dropbox Sign envelope); [] when unreadable. */
function packetMirrorRows_() {
  try {
    return readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), RECRUIT_TAB);
  } catch (e) { return []; }
}

// THE APPLICATION FORM THEY SIGNED, absorbing Recruitment: the app is taken in and killed off, dissolved into our…
function applicationFor_(cand, rows, already) {
  if (!cand || !rows || !rows.length) return null;
  var hit = null;
  try {
    // REUSE THE MATCH THAT ALREADY HAPPENED (found live, and it was agonisingly slow).
    var srid = str_(already && already.srid);
    if (!srid) {
      var m = packetMatch_(cand, rows);
      srid = str_(m && m.srid);
    }
    if (srid) {
      for (var i = 0; i < rows.length; i++) {
        if (str_(rows[i].signaturerequestid) === srid) { hit = rows[i]; break; }
      }
    }
  } catch (e) { hit = null; }
  if (!hit) return null;
  return {
    srid: str_(hit.signaturerequestid),
    title: str_(hit.title),
    status: str_(hit.status),
    // Days, never stamps: these go on a timeline.
    appliedAt: (typeof talentIsoDay_ === 'function') ? talentIsoDay_(hit.applied) : str_(hit.applied),
    signedAt: (typeof talentIsoDay_ === 'function') ? talentIsoDay_(hit.signed) : str_(hit.signed)
  };
}

/** Which card owns which envelope — e-mail first, then phone. */
function packetMatch_(cand, rows) {
  var emailKeys = {};
  (typeof contactEmailKeys_ === 'function' ? contactEmailKeys_(str_(cand.email)) : [])
    .forEach(function (k) { if (!cgTestEmails_(k)) emailKeys[k] = true; });
  var phoneKey = typeof contactPhoneKey_ === 'function' ? contactPhoneKey_(str_(cand.phone)) : '';
  // A company line identifies nobody (SHARED_LINE_DIGITS).
  if (phoneKey && typeof SHARED_LINE_DIGITS !== 'undefined' &&
      SHARED_LINE_DIGITS.indexOf(phoneKey) !== -1) phoneKey = '';

  var hits = [];
  rows.forEach(function (r) {
    var by = '';
    if (Object.keys(emailKeys).length) {
      // signer_emails carries EVERY signatory: the candidate may not be first.
      var addrs = [str_(r.email)].concat(String(r.signeremails || '').split('|'));
      for (var i = 0; i < addrs.length && !by; i++) {
        (typeof contactEmailKeys_ === 'function' ? contactEmailKeys_(addrs[i]) : [])
          .forEach(function (k) { if (emailKeys[k]) by = 'email'; });
      }
    }
    // Phone only ever resolves a SIGNED envelope: the number is lifted from the form's response_data, which a…
    if (!by && phoneKey && typeof contactPhoneKey_ === 'function' &&
        contactPhoneKey_(r.phone) === phoneKey &&
        String(r.status || '').toLowerCase() === 'signed') by = 'phone';
    if (by) hits.push({ row: r, by: by });
  });

  // `signed` is spelled out even here, so every branch of packetState_ answers the same question with the same key…
  if (!hits.length) return { state: 'unknown', srid: '', by: '', signed: '' };
  if (hits.length > 1) {
    // Signed beats pending beats declined; ties go to the most recent.
    var rank = { signed: 3, pending: 2, declined: 1 };
    hits.sort(function (x, y) {
      var rx = rank[String(x.row.status || '').toLowerCase()] || 0;
      var ry = rank[String(y.row.status || '').toLowerCase()] || 0;
      return ry - rx || String(y.row.applied || '').localeCompare(String(x.row.applied || ''));
    });
  }
  var best = hits[0];
  var status = String(best.row.status || '').toLowerCase();
  return {
    state: status === 'signed' ? 'signed' : 'unsigned',
    srid: str_(best.row.signaturerequestid),
    by: best.by,
    // The day it was signed — a date is a fact, a green tick is only a colour.
    signed: str_(best.row.signed)
  };
}

// The day a packet on a settled card was signed.
function packetSettledSigned_(cand, rows) {
  var stored = str_(cand.packetsignedat);
  if (stored) return stored;
  var srid = str_(cand.packetsrid);
  // A hand-attached packet's srid is 'file:<drive id>' and matches nothing — that packet was never signed through…
  if (!srid || !rows) return '';
  var day = '';
  rows.forEach(function (r) {
    if (!day && str_(r.signaturerequestid) === srid) day = str_(r.signed);
  });
  return day;
}

/** The packet state of ONE card. */
function packetState_(candOrId, rows) {
  var cand = candOrId;
  if (typeof candOrId === 'string') {
    try { cand = hubEvidence_(candOrId).cand; } catch (e) { cand = null; }
  }
  if (!cand) return { state: 'unknown', srid: '', by: '', signed: '', reason: 'no candidate row' };

  // A hand-attached packet is the answer, full stop: the lane that settles the (common) case where no envelope can…
  var waived = str_(cand.packetwaivedby);
  if (waived) {
    return { state: 'waived', srid: str_(cand.packetsrid), by: 'manual', waived_by: waived,
             // Usually empty, and that is correct: somebody attesting that the packet is on file is not telling us…
             signed: packetSettledSigned_(cand, rows) };
  }

  // A signed envelope is terminal: once frozen it is never recomputed.
  var frozen = str_(cand.packetsrid);
  var known = str_(cand.packetstatus);
  if (frozen && known === 'signed') {
    return { state: 'signed', srid: frozen, by: str_(cand.packetmatchedby) || 'frozen',
             signed: packetSettledSigned_(cand, rows) };
  }
  // `rows` lets a sweep read the mirror ONCE per pass, not once per candidate.
  return packetMatch_(cand, rows || packetMirrorRows_());
}

/** THE HOLD — onboarding done, packet missing: amber at Onboarding. */
var PACKET_HOLD_MS = 24 * 60 * 60 * 1000;
var PACKET_COL_HOLD_SINCE = 'packet_hold_since';
var PACKET_COL_HOLD_UNTIL = 'packet_hold_until';

/** How long the quiet phase lasts, from Settings. */
function packetHoldMs_() {
  var h = (typeof hubCfgInt_ === 'function') ? hubCfgInt_('packet_hold_hours', 24, 1, 336) : 24;
  return h * 60 * 60 * 1000;
}

/** Stamp the hold on a card that finished onboarding without the packet. */
function packetHoldStart_(cid, name, state, user) {
  // THE CLOCK STARTS ONCE: a card already held keeps its original deadline, or a second completion would silently…
  try {
    var existing = hubEvidence_(cid).cand;
    var open = existing ? str_(existing.packetholduntil) : '';
    if (open) return open;
  } catch (eRead) { /* unreadable — stamping a fresh hold is the safe answer */ }

  var now = new Date();
  var until = new Date(now.getTime() + packetHoldMs_()).toISOString();
  try {
    hubEnsureColumns_(TALENT_CANDIDATES_TAB, [PACKET_COL_HOLD_SINCE, PACKET_COL_HOLD_UNTIL]);
    var fields = {};
    fields[PACKET_COL_HOLD_SINCE] = now.toISOString();
    fields[PACKET_COL_HOLD_UNTIL] = until;
    hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, user || { email: 'asa-hub:packet-hold' }, false);
    hubBustTalentCache_();
  } catch (e) { /* the visit still finished; the sweep re-reads the state */ }
  hubSysLog_((user && user.email) || 'seat', 'packet_hold_start',
    cid + ' — ' + str_(name) + ' finished onboarding with the packet ' + str_(state) +
    '; held at Onboarding until ' + until, { status: 200 });
  return until;
}

/** Wipe the hold stamps. Never moves the card — see packetHoldRelease_. */
function packetHoldClear_(cid, user) {
  try {
    var fields = {};
    fields[PACKET_COL_HOLD_SINCE] = '';
    fields[PACKET_COL_HOLD_UNTIL] = '';
    hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, user || { email: 'asa-hub:packet-hold' }, false);
  } catch (e) { /* the move already happened; a stale stamp is cosmetic */ }
}

/** HOW LOUD IS THIS CARD — 'none' | 'amber' | 'red'. */
function hubCardUrgency_(cand) {
  if (!cand) return { level: 'none', why: '', source: '' };
  var out = { level: 'none', why: '', source: '' };

  // Amber: held at Onboarding without the packet.
  var hold = null;
  try { hold = packetHold_(cand); } catch (e) { hold = null; }
  if (hold) {
    out = { level: 'amber', source: 'packet-hold',
            why: 'onboarding finished and the signed New Hire packet is not on file' };
  }

  // AMBER ON ARRIVAL at the last column if anything is still owed.
  if (talentStage_(cand.status) === 'hired' && typeof hubBecomingStaffDone_ === 'function') {
    var done = null;
    try { done = hubBecomingStaffDone_(cand); } catch (eD) { done = null; }
    // A read that failed is not a debt: never invent amber from an unreadable tab.
    if (done && done.done === false && done.missing.length) {
      // Deliberately OVERWRITES a packet-hold amber: `arrival` is not the packet chip's sentence, so the board…
      out = { level: 'amber', source: 'arrival',
              why: 'still at the last step owing: ' + done.missing.join('; ') };
    }
  }

  // Red: an extension was granted and has since run out.
  var granted = str_(cand.onboardingaccessuntil);
  if (granted) {
    var g = new Date(granted).getTime();
    if (!isNaN(g) && Date.now() > g) {
      return { level: 'red', source: 'onboarding-extension',
               why: 'their onboarding was extended to ' + granted.slice(0, 10) +
                    ' and that has now passed' };
    }
  }
  if (typeof interviewFor_ === 'function' && talentStage_(cand.status) === 'interview') {
    try {
      var iv = interviewFor_(str_(cand.candidateid));
      // access_until is only ever written by interviewSetWindow — the button.
      var au = iv ? str_(iv.accessuntil) : '';
      if (au) {
        var a = new Date(au).getTime();
        if (!isNaN(a) && Date.now() > a) {
          return { level: 'red', source: 'interview-extension',
                   why: 'their interview access was extended to ' + au.slice(0, 10) +
                        ' and that has now passed' };
        }
      }
    } catch (eIv) { /* unreadable — never invent a red */ }
  }
  return out;
}

/** The hold as the screens read it. */
function packetHold_(cand) {
  var untilRaw = str_(cand && cand.packetholduntil);
  if (!untilRaw) return null;
  var until = new Date(untilRaw).getTime();
  if (isNaN(until)) return null;
  return {
    since: str_(cand.packetholdsince),
    until: untilRaw,
    // AMBER FROM THE FIRST MOMENT — hence the constant 'overdue'.
    phase: 'overdue',
    escalate: Date.now() >= until
  };
}

// The chip's words.
var PACKET_CHIP = {
  signed: 'Application signed',
  waived: 'Application on file',
  unsigned: 'Application not signed',
  ambiguous: 'Application — needs checking',
  unknown: 'Application not found'
};

/** The chip a card wears for a given packet state. */
function packetChip_(state) {
  return { state: state, label: PACKET_CHIP[state] || PACKET_CHIP.unknown };
}

/** THE COLUMNS HAVE TO EXIST BEFORE ANYTHING WRITES THEM (found ). */
function packetEnsureColumns_() {
  try {
    hubEnsureColumns_(TALENT_CANDIDATES_TAB, [
      PACKET_COL_SRID, PACKET_COL_STATUS, PACKET_COL_MATCHED_BY,
      PACKET_COL_CHECKED_AT, PACKET_COL_WAIVED_BY, PACKET_COL_SIGNED_AT
    ]);
  } catch (e) {
    // Loud: without the columns every packet write is discarded in silence and the caller is told it worked.
    hubSysLog_('asa-hub:packet', 'packet_columns_missing',
               String((e && e.message) || e), { status: 500 });
  }
}

/** Freeze the conclusion and HOW it was reached, so the board is not recomputed per read. */
function packetStamp_(cid, res, user) {
  if (!cid || !res) return;
  try {
    packetEnsureColumns_();
    var fields = {};
    fields[PACKET_COL_STATUS] = res.state;
    fields[PACKET_COL_CHECKED_AT] = new Date().toISOString();
    if (res.srid) fields[PACKET_COL_SRID] = res.srid;
    if (res.by) fields[PACKET_COL_MATCHED_BY] = res.by;
    // The one moment the signing day is in our hands.
    if (res.signed) fields[PACKET_COL_SIGNED_AT] = res.signed;
    hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, user || { email: 'asa-hub:packet' }, true);
  } catch (e) { /* the chip still shows; only the cache is lost */ }
}

// THE MANUAL LANE — attach the packet by hand.
HUB_POLICY.packetWaive = {
  file: 'Packet.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  // the move it can trigger passes through onboarding, which sends the new hire their own login (Hired.gs)
  invalidates: ['candidates', 'onboarding'], emits: ['emailSend']
};
HUB_ACTIONS.packetWaive = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var note = str_(payload.note);
  if (note.length < 3) {
    return { status: 400, message: 'Say where the signed packet is — a note is required.' };
  }
  var fields = {};
  packetEnsureColumns_();
  fields[PACKET_COL_WAIVED_BY] = str_(user.email) + ' — ' + note.slice(0, 300);
  fields[PACKET_COL_STATUS] = 'waived';
  fields[PACKET_COL_CHECKED_AT] = new Date().toISOString();
  if (str_(payload.file_id)) fields[PACKET_COL_SRID] = 'file:' + str_(payload.file_id);
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, user, true);
  hubBustTalentCache_();
  hubSysLog_(user.email, 'packet_waive', cid + ' — ' + note.slice(0, 200), { status: 200 });
  // THE HOLD ENDS THE MOMENT THE DOCUMENT DOES: released now, not on the next sweep.
  var released = packetHoldRelease_(cid, user);
  return { status: 200, data: { candidate_id: cid, state: 'waived',
           released: released.released, stage: released.stage } };
};

// THE NEW HIRE UPLOADS THEIR OWN SIGNED PACKET, from the portal — this exception has to be open.
HUB_POLICY.obPacketUpload = {
  file: 'Packet.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: [],
  // the move it can trigger passes through onboarding, which sends the new hire their own login (Hired.gs)
  invalidates: ['candidates', 'onboarding'], emits: ['emailSend']
};
HUB_ACTIONS.obPacketUpload = function (payload, user) {
  if (!user) return hubDenied_();
  var found = packetFindRow_(str_(user.email), str_(user.candidate_id));
  if (!found) return { status: 404, message: 'You are not on the onboarding list yet.' };
  var fullName = obField_(found, 'FullName');
  if (!fullName) {
    return { status: 400, message: 'Give your full name in step 1 first — that is what opens your record.' };
  }
  // Resolved from the NAME, never the seat account (seatResolveCandidate_).
  var cid = '';
  try { cid = seatFindCandidateId_(fullName); } catch (eF) { cid = ''; }

  var stored = null;
  try {
    stored = hubDriveFileObj_({
      base64: payload.base64,
      filename: 'NewHirePacket - ' + fullName.slice(0, 60) + ' - signed',
      mime_type: str_(payload.mime_type)
    }, 'new-hire-packet.pdf', '');
  } catch (eUp) {
    return { status: 500, message: 'The file could not be saved — please try again.' };
  }

  // The document is on file even when we cannot join it to a card: losing a signed packet because two spreadsheets…
  obSetField_(found, 'updated_by', str_(user.email));
  obSetField_(found, 'updated_at', new Date().toISOString());
  if (!cid) {
    hubSysLog_(str_(user.email), 'packet_self_upload_unlinked',
      fullName + ' uploaded their signed packet, but no card matches that name — ' + stored.url,
      { status: 200 });
    return { status: 200, data: { state: 'unknown', file_url: stored.url, released: false,
             message: 'Your packet is saved. Your recruiter will file it against your record.' } };
  }

  var fields = {};
  packetEnsureColumns_();
  fields[PACKET_COL_WAIVED_BY] = fullName + ' — uploaded by the new hire in the portal';
  fields[PACKET_COL_STATUS] = 'waived';
  fields[PACKET_COL_CHECKED_AT] = new Date().toISOString();
  fields[PACKET_COL_SRID] = 'file:' + stored.id;
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, { email: str_(user.email) }, true);
  hubBustTalentCache_();
  hubSysLog_(str_(user.email), 'packet_self_upload',
    cid + ' — ' + fullName + ' uploaded their signed packet: ' + stored.url, { status: 200 });
  var released = packetHoldRelease_(cid, { email: str_(user.email) });
  return { status: 200, data: { state: 'waived', file_url: stored.url,
           released: released.released, candidate_id: cid } };
};

/** Let a held card go, if it is held. */
function packetHoldRelease_(cid, user) {
  var cand = null;
  try { cand = hubEvidence_(cid).cand; } catch (e) { cand = null; }
  if (!cand || !str_(cand.packetholduntil)) return { released: false, stage: '' };
  if (talentStage_(cand.status) !== 'onboarding') {
    // Held stamp on a card that moved on its own — clear it, move nothing.
    packetHoldClear_(cid, user);
    return { released: false, stage: talentStage_(cand.status) };
  }
  var moved = hubSetStatus_(cid, HUB_STAGE_TO_STATUS.hired, user);
  packetHoldClear_(cid, user);
  hubBustTalentCache_();
  hubSysLog_((user && user.email) || 'asa-hub:packet-hold', 'packet_hold_released',
    cid + ' — ' + str_(cand.candidatename) + ': packet attached by hand' +
    (moved ? ' — moved to Hired' : ' — the card was not on the board'), { status: 200 });
  return { released: moved, stage: moved ? 'hired' : 'onboarding' };
}

/** WHAT THE PACKET'S FIELDS ARE CALLED. */
var PACKET_FIELD_MAP = {
  'nome completo1': 'Employee Name', 'fullname1': 'Employee Name', 'fullname2': 'Employee Name',
  'fullname3': 'Employee Name', 'fullname4': 'Employee Name', 'fullname5': 'Employee Name',
  "employee's name": 'Employee Name', 'employee name': 'Employee Name', 'caixa de texto1': 'Employee Name',
  // 'textbox1' is NOT first name — see the note below.
  'first name': 'First Name', 'fisrt name': 'First Name',
  'last name': 'Last Name', 'sobrenome': 'Last Name', 'textbox2': 'Last Name',
  'nome1': 'First Name',
  'mi': 'Middle Initial', 'middle initial': 'Middle Initial',
  'ssn': 'SSN', 'ssn#': 'SSN', 'social security number': 'SSN', 'textbox5': 'SSN',
  'textbox53': 'Date of Birth', 'caixa de texto53': 'Date of Birth',
  'address': 'Address', 'street address': 'Address', "employee's address": 'Address',
  "employee's adress": 'Address', 'textbox3': 'Address',
  'city': 'City', 'city or town': 'City', 'textbox4': 'City',
  'state': 'State', 'st': 'State',
  'zip': 'Zip', 'zipcode': 'Zip', 'zip code': 'Zip',
  'phone': 'Phone', 'phone number': 'Phone', 'mobile phone': 'Phone', 'telephone number': 'Phone',
  'zip code': 'Zip', 'st': 'State',
  'email': 'Email', 'email address': 'Email',
  'caixa de texto58': 'Referral',
  'date of birth': 'Date of Birth',
  'home phone': 'Home Phone'
};

/** SIX ENTRIES OF THE 2025 DICTIONARY ARE WRONG (measured over 192 live envelopes). */

/** SSNs are read out of the packet and must never leave it in the clear. */
function packetRedact_(label, value) {
  if (label !== 'SSN') return value;
  var d = String(value).replace(/\D/g, '');
  return d.length >= 4 ? '•••-••-' + d.slice(-4) : '•••';
}

/** The envelope's answers under names a person recognises. */
function packetAnswers_(fields) {
  var out = {}, raw = {};
  for (var k in fields) {
    var label = PACKET_FIELD_MAP[String(k).toLowerCase()];
    if (label) { if (out[label] === undefined) out[label] = packetRedact_(label, fields[k]); }
    else raw[k] = fields[k];
  }
  return { named: out, unnamed: raw };
}

// WHAT IS INSIDE THE PACKET — the answers, not just the signature: the CPR / MED DEL / DODD declarations are on…
HUB_POLICY.packetFields = {
  file: 'Packet.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.packetFields = function (payload, user) {
  if (!user || String(user.role) !== 'admin') return hubDenied_();
  var rows = packetMirrorRows_();
  var parse = function (r) {
    try { return JSON.parse(str_(r.fieldsjson) || '{}') || {}; } catch (e) { return {}; }
  };

  var cid = str_(payload.candidate_id);
  if (cid) {
    var cand = null;
    try { cand = hubEvidence_(cid).cand; } catch (e) { cand = null; }
    if (!cand) return { status: 404, message: 'No candidate "' + cid + '".' };
    var res = packetMatch_(cand, rows);
    if (!res.srid) {
      return { status: 200, data: { state: res.state, srid: '', matched_by: '', fields: {},
               message: 'No envelope matched this person, so there are no answers to read.' } };
    }
    var hit = null;
    rows.forEach(function (r) { if (str_(r.signaturerequestid) === res.srid) hit = r; });
    return { status: 200, data: {
      state: res.state, srid: res.srid, matched_by: res.by,
      title: hit ? str_(hit.title) : '', signed: hit ? str_(hit.signed) : '',
      // Under names a person recognises, with the SSN masked.
      answers: hit ? packetAnswers_(parse(hit)) : { named: {}, unnamed: {} }
    } };
  }

  // The map, sorted by how many envelopes carry each field.
  var counts = {}, sample = {}, envelopes = 0;
  rows.forEach(function (r) {
    var f = parse(r);
    var keys = Object.keys(f);
    if (!keys.length) return;
    envelopes++;
    keys.forEach(function (k) {
      counts[k] = (counts[k] || 0) + 1;
      if (sample[k] === undefined) sample[k] = String(f[k]).slice(0, 60);
    });
  });
  var list = Object.keys(counts).map(function (k) {
    var known = PACKET_FIELD_MAP[String(k).toLowerCase()] || '';
    return { field: k, means: known, envelopes: counts[k],
             example: known ? packetRedact_(known, sample[k]) : sample[k] };
  }).sort(function (a, b) { return b.envelopes - a.envelopes; });
  // A zero has to say WHICH zero it is: the column was never written (the mirror predates it), or it is there and…
  var hasColumn = rows.length > 0 && rows[0].hasOwnProperty('fieldsjson');
  return { status: 200, data: {
    mirror_rows: rows.length,
    envelopes_with_answers: envelopes,
    has_fields_column: hasColumn,
    diagnosis: envelopes ? '' : (hasColumn
      ? 'The column is there and empty — the answers are fetched one envelope at a time, ' +
        'up to a budget per sync. Run the sync again until fields_left_for_next_run is 0.'
      : 'This mirror was built before fields_json existed — run a recruitment sync.'),
    fields: list.slice(0, 400)
  } };
};

/** Editor convenience: see the packet's field map (▶ Run in the editor). */
function runPacketFieldMap() {
  var out = HUB_ACTIONS.packetFields({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* ------------------------------------------- before the card exists */

// Is there already a signed packet for THIS PERSON — asked while the intake form is still being typed, before a…
HUB_POLICY.packetProbe = {
  file: 'Packet.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.packetProbe = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var name = (str_(payload.first_name) + ' ' + str_(payload.last_name)).trim() || str_(payload.name);
  var probe = { email: str_(payload.email), phone: str_(payload.phone), candidatename: name };
  var res;
  try { res = packetMatch_(probe, packetMirrorRows_()); }
  catch (e) { return { status: 200, data: { state: 'unknown', reason: 'mirror unreadable' } }; }
  return { status: 200, data: {
    state: res.state, srid: res.srid, matched_by: res.by,
    label: PACKET_CHIP[res.state] || PACKET_CHIP.unknown
  } };
};

// FIND IT OURSELVES — by name, and a PERSON says which one it is.
HUB_POLICY.packetFind = {
  file: 'Packet.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.packetFind = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  var cand = null;
  if (cid) {
    try { cand = hubEvidence_(cid).cand; } catch (eC) { cand = null; }
  }
  var query = str_(payload.query) ||
              (cand ? str_(cand.candidatename) : '');
  if (!query && !cand) {
    return { status: 400, message: 'Give a name to search for, or a candidate_id.' };
  }
  var rows;
  try { rows = packetMirrorRows_(); }
  catch (eM) { return { status: 502, message: 'The contracts mirror could not be read.' }; }

  // The strong answer first, from the SAME function the sweep uses: a search that disagreed with the matcher would…
  var strong = null;
  if (cand) {
    try {
      var m = packetMatch_(cand, rows);
      if (m.state !== 'unknown') {
        strong = { srid: m.srid, state: m.state, matched_by: m.by, signed: str_(m.signed) };
      }
    } catch (eS) { strong = null; }
  }

  // Which envelopes are already spoken for: offering a bound one invites the exact collision this exists to avoid.
  var taken = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB)
      .forEach(function (c) {
        var s = str_(c.packetsrid);
        if (s && str_(c.candidateid) !== cid) taken[s] = str_(c.candidatename) || str_(c.candidateid);
      });
  } catch (eT) { /* an unreadable tab must not hide the search; the bind re-checks */ }

  var qt = nameTokens_(query).core;
  var out = [];
  if (qt.length) {
    rows.forEach(function (r) {
      var ct = nameTokens_(str_(r.candidate)).core;
      if (!ct.length) return;
      var hit = 0;
      qt.forEach(function (t) { if (ct.indexOf(t) !== -1) hit++; });
      // TWO PARTS OF THE NAME, not one: one matching token is "every John".
      var enough = qt.length === 1 ? hit === 1 : hit >= 2;
      if (!enough) return;
      var srid = str_(r.signaturerequestid);
      out.push({
        srid: srid,
        name_on_envelope: str_(r.candidate),
        email: str_(r.email),
        status: String(r.status || '').toLowerCase(),
        applied: str_(r.applied), signed: str_(r.signed),
        title: str_(r.title),
        found_by: 'name',
        name_parts_matched: hit + ' of ' + qt.length,
        already_bound_to: taken[srid] || ''
      });
    });
  }
  // Signed first, then most recent — the one being looked for is the completed one.
  out.sort(function (a, b) {
    var rank = { signed: 3, pending: 2, declined: 1 };
    return (rank[b.status] || 0) - (rank[a.status] || 0) ||
           String(b.applied).localeCompare(String(a.applied));
  });

  return { status: 200, data: {
    candidate_id: cid,
    searched_for: query,
    strong: strong,
    by_name: out.slice(0, 25),
    total_by_name: out.length,
    note: strong
      ? 'This card already resolves to an envelope by ' + strong.matched_by +
        ' — the name results are alternatives, not confirmations.'
      : 'Found by NAME only. A name is not proof: check the e-mail and the date ' +
        'before binding one, because two people can share a name and only one of ' +
        'them signed this.'
  } };
};

// BIND the envelope a person chose — and record that a person chose it.
HUB_POLICY.packetBind = {
  file: 'Packet.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  // the move it can trigger passes through onboarding, which sends the new hire their own login (Hired.gs)
  invalidates: ['candidates', 'onboarding'], emits: ['emailSend']
};
HUB_ACTIONS.packetBind = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var srid = str_(payload.srid);
  if (!srid) return { status: 400, message: 'Which envelope? An srid is required.' };

  // THE ENVELOPE HAS TO EXIST: a typed or stale srid would freeze packetState_ on a signature nobody can open…
  var rows;
  try { rows = packetMirrorRows_(); }
  catch (eM) { return { status: 502, message: 'The contracts mirror could not be read — nothing was changed.' }; }
  var env = null;
  rows.forEach(function (r) { if (str_(r.signaturerequestid) === srid) env = r; });
  if (!env) {
    return { status: 404, message: 'No envelope ' + srid + ' in the contracts mirror. ' +
             'Run the recruitment sync if it was signed in the last few minutes.' };
  }

  // ONE ENVELOPE, ONE CARD.
  var clash = '';
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB)
      .forEach(function (c) {
        if (str_(c.packetsrid) === srid && str_(c.candidateid) !== cid) {
          clash = str_(c.candidatename) || str_(c.candidateid);
        }
      });
  } catch (eC) { /* checked again by nobody — so a read failure must not pass silently */
    return { status: 502, message: 'The candidate tab could not be read, so it is not ' +
             'possible to tell whether this envelope belongs to somebody else. Nothing was changed.' };
  }
  if (clash) {
    return { status: 409, message: 'That envelope is already bound to ' + clash +
             '. Unbind it there first — one signature cannot be two people\'s.' };
  }

  var status = String(env.status || '').toLowerCase();
  var fields = {};
  packetEnsureColumns_();
  fields[PACKET_COL_SRID] = srid;
  fields[PACKET_COL_STATUS] = status === 'signed' ? 'signed' : 'unsigned';
  fields[PACKET_COL_MATCHED_BY] = 'confirmed by ' + str_(user.email) +
    (str_(payload.note) ? ' — ' + str_(payload.note).slice(0, 200) : '');
  fields[PACKET_COL_CHECKED_AT] = new Date().toISOString();
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, user, true);
  hubBustTalentCache_();
  hubSysLog_(user.email, 'packet_bind',
             cid + ' → ' + srid + ' (' + status + ', envelope names "' +
             str_(env.candidate) + '")', { status: 200 });

  // BINDING AN UNSIGNED ENVELOPE RELEASES NOBODY — it records WHICH signature we are waiting for.
  var released = { released: false, stage: '' };
  if (status === 'signed') {
    try { released = packetHoldRelease_(cid, user); } catch (eR) { released = { released: false, stage: '' }; }
  }
  return { status: 200, data: {
    candidate_id: cid, srid: srid, state: fields[PACKET_COL_STATUS],
    name_on_envelope: str_(env.candidate),
    released: released.released, stage: released.stage,
    message: status === 'signed'
      ? 'Bound and released — the signed packet is on file.'
      : 'Bound. The envelope is ' + status + ', so the card stays held until it is signed.'
  } };
};

// IS THIS PERSON ALREADY KNOWN — and did their phone screen already happen?
HUB_POLICY.screenProbe = {
  file: 'Packet.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.screenProbe = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var name = (str_(payload.first_name) + ' ' + str_(payload.last_name)).trim() || str_(payload.name);
  var phoneKey = typeof contactPhoneKey_ === 'function' ? contactPhoneKey_(str_(payload.phone)) : '';
  var emailKeys = {};
  (typeof contactEmailKeys_ === 'function' ? contactEmailKeys_(str_(payload.email)) : [])
    .forEach(function (k) { emailKeys[k] = true; });

  var out = { recognised: false, matched_by: '', screen_exists: false,
              screen_status: '', candidate_id: '', candidate_name: '' };

  // An existing screening row is the strongest answer: the call is on file.
  try {
    var ss = ssOpen_(hubId_('HUB_DB_ID'));
    var cands = readTabNormalized_(ss, TALENT_CANDIDATES_TAB);
    var screens = {};
    readTabNormalized_(ss, TALENT_PHONE_TAB).forEach(function (s) {
      var c = str_(s.candidateid);
      if (c) screens[c] = s;
    });
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (str_(c.archived).toLowerCase() === 'true') continue;
      var hit = '';
      if (phoneKey && typeof contactPhoneKey_ === 'function' &&
          contactPhoneKey_(c.phone) === phoneKey &&
          (typeof SHARED_LINE_DIGITS === 'undefined' || SHARED_LINE_DIGITS.indexOf(phoneKey) === -1)) hit = 'phone';
      if (!hit && Object.keys(emailKeys).length) {
        (typeof contactEmailKeys_ === 'function' ? contactEmailKeys_(c.email) : [])
          .forEach(function (k) { if (emailKeys[k]) hit = 'email'; });
      }
      if (!hit && name && typeof nameNorm_ === 'function' &&
          nameNorm_(c.candidatename) && nameNorm_(c.candidatename) === nameNorm_(name)) hit = 'name';
      if (!hit) continue;
      out.recognised = true;
      out.matched_by = hit;
      out.candidate_id = str_(c.candidateid);
      out.candidate_name = str_(c.candidatename);
      var sc = screens[out.candidate_id];
      if (sc) {
        out.screen_exists = true;
        out.screen_status = str_(sc.screenstatus);
      }
      break;
    }
  } catch (e) { /* unknown is a fine answer */ }

  // The New Hire envelope also counts as recognising them.
  if (!out.recognised) {
    try {
      var pk = packetMatch_({ email: str_(payload.email), phone: str_(payload.phone), candidatename: name },
                            packetMirrorRows_());
      if (pk && pk.state !== 'unknown') { out.recognised = true; out.matched_by = 'new-hire-packet'; }
    } catch (e2) { /* leave it false */ }
  }

  // The floor for trusting the recruiter instead: a real name and a phone.
  out.may_attest = !!(name && name.split(/\s+/).length >= 2 && phoneKey);
  return { status: 200, data: out };
};

// Name check on an attached packet — guards the wrong person's packet.
var PACKET_LABEL_STOP = /\b(MI|SSN|Social|Email|Address|Street|City|ST|State|Zip|Home|Mobile|Phone|Date|Signature|Signed|Middle|Initial|First|Last|Name)\b/i;

/** One name out of an OCR'd line, cut at the next label. '' if implausible. */
function packetCleanName_(v) {
  var s = String(v || '').replace(/\s+/g, ' ').trim();
  var stop = s.search(PACKET_LABEL_STOP);
  if (stop > 0) s = s.slice(0, stop).trim();
  s = s.replace(/[^A-Za-z .'\-]/g, '').replace(/\s+/g, ' ').trim();
  // A name is one to four words. Anything longer is a sentence we misread.
  var words = s.split(' ').filter(Boolean);
  if (!words.length || words.length > 4) return '';
  return words.join(' ');
}

/** Every name the document's labels offer, best candidates first. */
function packetNamesFromText_(text) {
  var s = String(text || '');
  var out = [];
  var push = function (v) { var c = packetCleanName_(v); if (c) out.push(c); };
  var pats = [
    /(?:Employee|Applicant|Candidate)\s*Name\s*[:\-]?\s*([^\n\r]{2,60})/i,
    /First\s*Name\s*[:\-]?\s*([^\n\r]{2,40})[\s\S]{0,80}?Last\s*Name\s*[:\-]?\s*([^\n\r]{2,40})/i,
    /Last\s*Name\s*[:\-]?\s*([^\n\r]{2,40})[\s\S]{0,80}?First\s*Name\s*[:\-]?\s*([^\n\r]{2,40})/i,
    /Print(?:ed)?\s*Name\s*[:\-]?\s*([^\n\r]{2,60})/i
  ];
  pats.forEach(function (rx) {
    var m = s.match(rx);
    if (!m) return;
    if (m.length >= 3) {
      var a = packetCleanName_(m[1]), b = packetCleanName_(m[2]);
      // Label order differs between forms — offer both readings, let the name matcher decide.
      if (a && b) { out.push(a + ' ' + b); out.push(b + ' ' + a); }
      else { push(m[1]); push(m[2]); }
    } else {
      push(m[1]);
    }
  });
  return out;
}

// lane: tool — it uploads the file and OCRs it for the name check; a person waits on that verdict.
HUB_POLICY.packetAttach = {
  file: 'Packet.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.packetAttach = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var expected = str_(payload.name);
  if (!expected) return { status: 400, message: 'Whose packet is this? A name is required.' };
  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'No file attached.' };
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (eB) { return { status: 400, message: 'The file could not be read.' }; }
  if (!bytes.length) return { status: 400, message: 'The file is empty.' };
  if (bytes.length > 15 * 1024 * 1024) return { status: 400, message: 'The file is over 15MB.' };

  var target;
  try { target = obDocsTarget_(); }
  catch (eT) { return { status: 502, message: 'The documents folder could not be opened — nothing was saved.' }; }
  var file = target.folder.createFile(Utilities.newBlob(
    bytes, str_(payload.mime_type) || 'application/pdf',
    expected + ' - New Hire Packet' + (str_(payload.filename).slice(-4).indexOf('.') === 0 ? str_(payload.filename).slice(-4) : '.pdf')));

  // Read it, then compare. Failure to read is 'unreadable', never 'wrong'.
  var verdict = 'unreadable', found = '';
  try {
    var text = (typeof clearanceOcrText_ === 'function') ? clearanceOcrText_(file.getId()) : '';
    if (text) {
      // Strongest signal first: does the expected name appear at all, normalised the way the platform matches…
      var hay = nameNorm_(text.replace(/\s+/g, ' '));
      var needle = nameNorm_(expected);
      if (needle && hay.indexOf(needle) !== -1) { verdict = 'match'; found = expected; }
      else {
        var names = packetNamesFromText_(text);
        var best = names.length ? nameBest_(expected, names.map(function (n) { return { n: n }; }),
                                            function (x) { return x.n; }) : { ok: false };
        if (best.ok) { verdict = 'match'; found = best.item.n; }
        else if (names.length) { verdict = 'mismatch'; found = names[0]; }
        else verdict = 'unreadable';
      }
    }
  } catch (eO) { verdict = 'unreadable'; }

  hubSysLog_(user.email, 'packet_attach',
    expected + ' — ' + verdict + (found && verdict === 'mismatch' ? ' (document reads "' + found + '")' : ''),
    { status: 200 });
  return { status: 200, data: {
    file_id: file.getId(), verdict: verdict, name_in_document: found,
    where: target.where,
    message: verdict === 'match' ? 'The document names ' + expected + '.'
      : verdict === 'mismatch' ? 'The document appears to name "' + found + '", not ' + expected + '. Attach it anyway if you know it is right.'
      : 'The document could not be read automatically — nothing was checked.'
  } };
};

// Undo it — an attestation given by mistake has to be retractable.
HUB_POLICY.packetUnwaive = {
  file: 'Packet.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  // Same columns as packetWaive, so the same slices go stale: a Tracker still showing a retracted attestation…
  invalidates: ['candidates', 'onboarding'], emits: []
};
HUB_ACTIONS.packetUnwaive = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var fields = {};
  packetEnsureColumns_();
  fields[PACKET_COL_WAIVED_BY] = '';
  fields[PACKET_COL_STATUS] = '';
  fields[PACKET_COL_SRID] = '';
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, user, true);
  hubBustTalentCache_();
  hubSysLog_(user.email, 'packet_unwaive', cid, { status: 200 });
  return { status: 200, data: { candidate_id: cid, state: 'recheck' } };
};

/** THE ENTRY DOOR, AND THE VOICE THE HOLD NEVER HAD. */
var PACKET_COL_REQUESTED_AT = 'packet_requested_at';
var PACKET_COL_AMBER_ALERTED = 'packet_amber_alerted_at';
// The SECOND message: the day ran out and the packet is still not here.
var PACKET_COL_OVERDUE_ALERTED = 'packet_overdue_alerted_at';
// RED: a granted extension expired.
var PACKET_COL_RED_ALERTED = 'packet_red_alerted_at';

/** WHO HEARS ABOUT AN AMBER CARD, when nobody has said otherwise. */
var PACKET_AMBER_SMS_FLOOR = [
  '+13309195559',   // Arthur Torres
  '+13309197779',   // Ty Bond
  '+13309195558'    // Asatech — the platform's own line
];

/** The floor in force RIGHT NOW: the configured one, or the shipped one when that row says nothing. */
function packetAmberFloor_() {
  try {
    var cfg = hiringAlerts_();
    var typed = String((cfg && cfg.escalation_floor_sms) || '')
      .split(/[,;\n]+/)
      .map(function (s) { return s.trim(); })
      // ONLY REAL NUMBERS COUNT.
      .filter(function (s) { return s && String(s).replace(/\D/g, '').length >= 10; });
    if (typed.length) return typed;
  } catch (e) { /* the shipped floor below is exactly the answer for this */ }
  return PACKET_AMBER_SMS_FLOOR.slice();
}

// The configured recipients, with the floor unioned in.
function packetAmberRecipients_() {
  var out = packetAmberFloor_();
  var seen = {};
  out.forEach(function (n) { seen[String(n).replace(/\D/g, '').slice(-10)] = true; });
  try {
    var cfg = hubAlertRecipients_();
    (cfg.sms || []).forEach(function (n) {
      var k = String(n).replace(/\D/g, '').slice(-10);
      if (k && !seen[k]) { seen[k] = true; out.push(n); }
    });
  } catch (e) { /* no config — the floor still stands, which is the point */ }
  return out;
}

// A number we may actually text: real, ten digits, and not one of ours.
function packetSendableNumber_(raw) {
  var d = String(raw || '').replace(/\D/g, '').replace(/^1/, '');
  if (d.length !== 10) return '';
  if (typeof SHARED_LINE_DIGITS !== 'undefined' && SHARED_LINE_DIGITS.indexOf(d) !== -1) return '';
  return '+1' + d;
}

// A number we may send an INTERNAL COPY to — the opposite question, and the reason a copy list built from our own…
function packetTeamCopyNumber_(raw) {
  var d = String(raw || '').replace(/\D/g, '').replace(/^1/, '');
  if (d.length !== 10) return '';
  var from = '';
  try {
    if (typeof COMMS_OPERATOR_LINE_DIGITS !== 'undefined') from = String(COMMS_OPERATOR_LINE_DIGITS);
  } catch (e) { from = ''; }
  if (from && d === from.replace(/\D/g, '').replace(/^1/, '')) return '';
  return '+1' + d;
}

/** IS THIS CARD A REHEARSAL? */
function packetIsRehearsal_(c) {
  if (!c) return false;
  if (typeof commsIsTestCandidate_ === 'function') {
    try { if (commsIsTestCandidate_(c)) return true; } catch (e) { /* fall through */ }
  }
  if (str_(c.candidatename).toLowerCase().indexOf('[test]') === 0) return true;
  var d = str_(c.phone).replace(/\D/g, '').slice(-10);
  if (typeof COMMS_OPERATOR_TEST_LINE !== 'undefined' && d === COMMS_OPERATOR_TEST_LINE) return true;
  if (typeof COMMS_OPERATOR_TEST_EMAIL !== 'undefined' &&
      str_(c.email).toLowerCase() === COMMS_OPERATOR_TEST_EMAIL) return true;
  return false;
}

// The rehearsal target, from the alerts config.
var PACKET_REHEARSAL_KEY = 'packet_rehearsal_number';

/** WHERE A REHEARSAL'S MESSAGE GOES. */
function packetRehearsalNumber_() {
  try {
    var raw = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {})[PACKET_REHEARSAL_KEY]);
    if (!raw) return '';
    var d = raw.replace(/\D/g, '').replace(/^1/, '');
    return d.length === 10 ? '+1' + d : '';
  } catch (e) { return ''; }
}

/** Ask, once, for the packet. */
function packetRequestSweep_() {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var rows = readTabNormalized_(ss, TALENT_CANDIDATES_TAB).filter(function (c) {
    var id = str_(c.candidateid);
    if (!id || (typeof TALENT_EXCLUDE_IDS !== 'undefined' && TALENT_EXCLUDE_IDS.indexOf(id) !== -1)) return false;
    if (str_(c.archived).toLowerCase() === 'true') return false;
    return talentStage_(c.status) === 'onboarding';
  });
  if (!rows.length) return { asked: 0, alerted: 0, skipped: 0 };

  var mirror = packetMirrorRows_();
  var asked = 0, alerted = 0, skipped = 0, wouldAsk = [], wouldAlert = [];

  // THE SWITCH IS THE SITUATION ROW (hiring_packet_request, Smart Comms ) — texts + enabled moved from…
  var askSit = (typeof smartSituationOn_ === 'function')
    ? smartSituationOn_(commSituationId_('hiring.packet.request', 'hiring_packet_request')) : null;
  if (!askSit) {
    hubSysLog_('auto-packet-request', 'packet_request_situation_off',
               'hiring_packet_request is OFF — nobody is asked this pass', { status: 200 });
  }

  rows.forEach(function (c) {
    var cid = str_(c.candidateid), name = str_(c.candidatename);
    var state = null;
    try { state = packetState_(c, mirror); } catch (e) { skipped++; return; }
    // Already have it — nothing to ask for, and the hold sweep will move them.
    if (state && (state.state === 'signed' || state.state === 'waived')) return;

    // 1.
    var pkDue = (typeof simLadderDue_ === 'function')
      ? simLadderDue_('packet_request', cid) : { due: !str_(c.packetrequestedat) };
    if (pkDue.due && askSit) {
      // A REHEARSAL NEVER REACHES THE PERSON ON THE CARD: it goes to the nominated rehearsal number, or nowhere at…
      var rehearsal = packetIsRehearsal_(c);
      var to = rehearsal ? packetRehearsalNumber_() : packetSendableNumber_(c.phone);

      // ONE CHANNEL, THE OTHER, OR BOTH — decided PER CHANNEL.
      var mailTo = str_(c.email);
      if (mailTo.indexOf('@') === -1) mailTo = '';
      if (rehearsal && mailTo && !(typeof hubTestRedirect_ === 'function' && hubTestRedirect_())) {
        hubSysLog_('auto-packet-request', 'packet_request_rehearsal_email_skipped',
                   cid + ' — ' + name + ': a rehearsal only e-mails while test mode is on, ' +
                   'so it cannot reach the address on the card', { status: 200 });
        mailTo = '';
      }
      if (rehearsal && !to && !mailTo) {
        skipped++;
        hubSysLog_('auto-packet-request', 'packet_request_rehearsal_no_target',
                   cid + ' — ' + name + ': set ' + PACKET_REHEARSAL_KEY +
                   ' in Settings, or switch test mode on, to receive rehearsals',
                   { status: 200 });
        return;
      }
      if (!to && !mailTo) {
        skipped++;
        // Said out loud: a person we cannot reach sits in amber forever.
        hubSysLog_('auto-packet-request', 'packet_request_no_contact',
                   cid + ' — ' + name + ': no number we can text and no e-mail address',
                   { status: 200 });
      } else {
        var res = to ? rpcCall_('packetRequest',
          { candidate_id: cid,
            // THE MARKER GOES IN THE BODY, NOT IN THE NAME: rpcPacketMessage_ greets with the first WORD of the…
            name: name, rehearsal_for: rehearsal ? name : '',
            to: to },
          { idempotency_key: 'packet_request_' + cid }) : null;

        // AND BY E-MAIL — send on BOTH channels.
        var mres = null;
        if (mailTo) {
          var mail = rpcPacketEmail_({ name: name, rehearsal_for: rehearsal ? name : '' });
          mres = rpcCall_('emailSend',
            { to: mailTo, subject: mail.subject, body: mail.body,
              // the designed letter (packetRequestEmail_) — the words inside it are the situation row's, so editing…
              html: mail.html,
              reason: bookText_('Strings', 'ledger.packet.request', '') },
            { idempotency_key: 'packet_request_mail_' + cid });
        }

 // STAMP ONLY WHAT ACTUALLY WENT OUT (review).
        var went = [], failed = [], gated = false, rehearsed = [];
        var judge = function (label, r) {
          if (!r) return;
          // A MESSAGE THAT WENT TO A TESTER IS NOT A MESSAGE TO THIS PERSON: test mode swaps the destination inside…
          if (r.redirected) { rehearsed.push(label); return; }

          // A DEDUPLICATED CALL DID GO OUT — same request inside the receipt window with the row unstamped.
          if (r.deduplicated) { went.push(label + ' (already sent)'); return; }
          if (r.ok && r.sent) { went.push(label); return; }
          if (r.ok && r.gated) { gated = true; return; }
          failed.push(label + ': ' + str_(r.error));
        };
        judge('sms', res);
        judge('email', mres);

        if (went.length) {
          // THE STAMP IS THE MEMORY and is written AFTER the send.
          try {
            var fields = {};
            fields[PACKET_COL_REQUESTED_AT] = new Date().toISOString();
            hubEnsureColumns_(TALENT_CANDIDATES_TAB, [PACKET_COL_REQUESTED_AT]);
            hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, { email: 'auto-packet-request' }, true);
          } catch (eStamp) {
            hubSysLog_('auto-packet-request', 'packet_request_stamp_lost',
                       cid + ' — ' + name + ': the request WAS SENT by ' + went.join(' + ') +
                       ' but the row could not be stamped (' +
                       String((eStamp && eStamp.message) || eStamp) +
                       '). Stamp packet_requested_at by hand or they may be asked twice.',
                       { status: 500 });
          }
 // AND THE RUNG IS COUNTED.
          try { simTrackSend_('packet_request', cid, '', { candidate_id: cid }); } catch (eBk) {}
          asked++;
          hubSysLog_('auto-packet-request', 'packet_requested',
                     cid + ' — ' + name + ' by ' + went.join(' + ') +
                     ' (try ' + (pkDue.sent + 1) + ' of ' + pkDue.of + ')' +
                     (failed.length ? ' — ' + failed.join('; ') + ' did NOT go' : ''),
                     { status: 200 });
        } else if (rehearsed.length) {
          // Said out loud: "nothing happened" and "it went to the testers and was deliberately not recorded" look…
          hubSysLog_('auto-packet-request', 'packet_request_test_only',
                     cid + ' — ' + name + ': ' + rehearsed.join(' + ') +
                     ' reached the TESTERS, so the row was NOT stamped — this ' +
                     'person has not been asked', { status: 200 });
        } else if (gated) {
          // Nothing sent, nothing stamped: the next pass tries again and the message itself is left in the log, to…
          wouldAsk.push(name);
          hubSysLog_('auto-packet-request', 'packet_request_would_send',
                     cid + ' — ' + name + ': ' + str_((res || mres).reason), { status: 200 });
        } else {
          skipped++;
          // The CODE, not the provider's sentence: a validation error quotes the number it rejected, and this log…
          hubSysLog_('auto-packet-request', 'packet_request_failed',
                     cid + ' — ' + name + ': ' + failed.join('; '), { status: 502 });
        }
      }
    }

    // 2. the amber, given a voice
    var hold = null;
    try { hold = packetHold_(c); } catch (e2) { hold = null; }
    // THE ESCALATIONS LEFT THIS FUNCTION — they belong to smart comms and the resolver.
  });

  if (asked || alerted) hubBustTalentCache_();
  return { asked: asked, alerted: alerted, skipped: skipped,
           recorded_not_sent: { asked: wouldAsk, alerted: wouldAlert } };
}

/** THE SWEEP, WITH A FRONT DOOR IN THE PROTOCOL. */
HUB_POLICY.packetRequestRun = {
  file: 'Packet.gs', lane: 'write', store: 'sheet',
  idempotent: true,              // the row stamp is the memory, not the call
  cost: 'seconds',
  roles: ['admin'],
  invalidates: ['candidates'],
  emits: ['packetRequest', 'emailSend', 'teamAlert']
};
HUB_ACTIONS.packetRequestRun = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var out = packetRequestSweep_();
  hubSysLog_(user && user.email, 'packet_request_run',
             'asked ' + out.asked + ', alerted ' + out.alerted + ', skipped ' + out.skipped,
             { status: 200 });
  return { status: 200, data: out };
};

/** > What WOULD be asked and told, changing nothing at all. */
function runPacketRequestPreview() {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var mirror = packetMirrorRows_();
  var out = { at_onboarding: 0, would_ask: [], would_alert: [], unreachable: [], already: [] };
  readTabNormalized_(ss, TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (talentStage_(c.status) !== 'onboarding') return;
    if (str_(c.archived).toLowerCase() === 'true') return;
    out.at_onboarding++;
    var name = str_(c.candidatename) || str_(c.candidateid);
    var st = null;
    try { st = packetState_(c, mirror); } catch (e) { st = null; }
    if (st && (st.state === 'signed' || st.state === 'waived')) { out.already.push(name); return; }
    // THE PREVIEW HAS TO AGREE WITH THE SWEEP, per channel: a preview that under-reports who will be contacted is…
    var pTo = packetSendableNumber_(c.phone);
    var pMail = str_(c.email).indexOf('@') !== -1 ? str_(c.email) : '';
    if (str_(c.packetrequestedat)) out.already.push(name + ' (already asked)');
    else if (!pTo && !pMail) out.unreachable.push(name + ' — no usable number and no e-mail');
    else out.would_ask.push(name + ' — by ' + [pTo ? 'sms' : '', pMail ? 'email' : ''].filter(String).join(' + '));
    var h = null;
    try { h = packetHold_(c); } catch (e2) { h = null; }
    if (h && h.escalate === true && !str_(c.packetamberalertedat)) out.would_alert.push(name);
  });
  out.sending = rpcSendEnabled_()
    ? 'ON — these would really be sent'
    : 'off — none of THESE leave. Note: the Hired and Date-Accepted team alerts ' +
      'are older than this switch and still fire.';
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
