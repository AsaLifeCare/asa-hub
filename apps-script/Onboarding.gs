/**
 * ONBOARDING TRACKER — live adapter for the `onboarding` resource: every
 * candidate at the onboarding stage (plus the hired), with paperwork read
 * from `candidate_documents` (Files.gs).
 * The stage is DERIVED from evidence, never typed: drag/stage writes 405.
 * `uploaded` and `verified` are different states; `docsSummary` counts only
 * what a human actually verified.
 */

var ONB_STAGES = ['packet', 'background', 'documents', 'training', 'ready'];

/** The 12 checklist rows the app draws, in order — ids match the SPA's
 *  ONBOARDING_PACKET so both pipelines share one vocabulary. */
var ONB_CHECKLIST = [
  { id: 'new-hire-packet', label: 'New Hire Packet (offer, I-9, W-4, policies)', owner: 'HR', stage: 'packet', doc: 'dropbox_packet' },
  { id: 'questionnaire', label: 'New Hire Questionnaire', owner: 'Candidate', stage: 'packet', doc: '' },
  { id: 'background-check', label: 'Background Check (BCI/FBI)', owner: 'HR', stage: 'background', doc: 'background_check' },
  { id: 'dropbox-link', label: 'Dropbox folder link', owner: 'Auto', stage: 'documents', doc: '' },
  { id: 'drivers-license', label: "Driver's License / ID", owner: 'Candidate', stage: 'documents', doc: 'drivers_id' },
  { id: 'diploma', label: 'HS Diploma / GED', owner: 'Candidate', stage: 'documents', doc: 'hs_diploma' },
  { id: 'ss-card', label: 'SS Card / Birth Certificate', owner: 'Candidate', stage: 'documents', doc: 'ss_birth' },
  { id: 'dodd-cert', label: '8-Hr DODD Training Certificate', owner: 'Candidate', stage: 'training', doc: 'dodd_8hr' },
  { id: 'cpr-cert', label: 'CPR / First Aid Certificate', owner: 'Candidate', stage: 'training', doc: 'cpr_first_aid' },
  { id: 'med-cert', label: 'Med Delivery Certificate', owner: 'Candidate', stage: 'training', doc: 'med_del' },
  { id: 'training-assign', label: 'Training assigned (DODD orientation)', owner: 'HR', stage: 'training', doc: '' },
  { id: 'tutorials', label: 'Tutorials — asa. walkthrough', owner: 'Auto', stage: 'training', doc: '' }
];

/**
 * ACCESS WINDOW — the `onboarding` account gets a bounded stay, resolved most
 * specific first: per person, `access_from` / `access_until` on the onboarding
 * row; then Script Properties ONBOARDING_WINDOW_BEFORE_DAYS /
 * ONBOARDING_WINDOW_AFTER_DAYS around the day they entered onboarding; then
 * these defaults. Admin/manager are never limited by it. No anchor date = open.
 */
var ONBOARDING_TAB = 'entity_onboardings';
var ONBOARDING_WINDOW_BEFORE_DAYS = 0;
var ONBOARDING_WINDOW_AFTER_DAYS = 30;
var ONBOARDING_COLUMNS = ['candidate_id', 'CandidateName', 'starting_status',
                          'earliest_start_date', 'start_date', 'house',
                          'date_moved_to_onboarding', 'notes',
                          'created_at', 'updated_at', 'created_by', 'updated_by',
                          'access_from', 'access_until'];

/** The entity_onboardings tab, created with its header when missing. */
function onboardingSheet_() {
  var existed = !!hubTabSheet_(ONBOARDING_TAB);
  var sheet = hubTabEnsure_(ONBOARDING_TAB, ONBOARDING_COLUMNS);
  // rows are keyed BY COLUMN NAME, so a header narrower than the list above
  // hides those fields from every reader; widen a tab that was already there
  if (existed) ensureHeader_(sheet, ONBOARDING_COLUMNS);
  return sheet;
}

/** The person's onboarding row (normalized keys), or null. */
function onboardingRowFor_(cid) {
  onboardingSheet_();
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), ONBOARDING_TAB);
  var hit = null;
  for (var i = 0; i < rows.length; i++) if (str_(rows[i].candidateid) === cid) hit = rows[i];
  return hit;
}

/** A Script Property window edge in days, or the fallback when unusable. */
function onboardingWindowDays_(key, fallback) {
  var raw = hubProp_(key);
  var n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

/** Start or end of the given day, in the script's timezone. */
function onboardingDayBounds_(d, endOfDay) {
  var x = new Date(d.getTime());
  if (endOfDay) x.setHours(23, 59, 59, 999); else x.setHours(0, 0, 0, 0);
  return x;
}

/** { open, from, until, reason } for one onboarding row. */
function onboardingWindow_(ob) {
  if (!ob) return { open: true, from: '', until: '', reason: 'no onboarding row yet' };
  var from = str_(ob.accessfrom) ? new Date(str_(ob.accessfrom)) : null;
  var until = str_(ob.accessuntil) ? new Date(str_(ob.accessuntil)) : null;
  if ((from && isNaN(from.getTime())) || (until && isNaN(until.getTime()))) { from = null; until = null; }

  if (!from || !until) {
    var anchor = str_(ob.datemovedtoonboarding) ? new Date(str_(ob.datemovedtoonboarding)) : null;
    if (!anchor || isNaN(anchor.getTime())) {
      return { open: true, from: '', until: '', reason: 'no onboarding date' };
    }
    var before = onboardingWindowDays_('ONBOARDING_WINDOW_BEFORE_DAYS', ONBOARDING_WINDOW_BEFORE_DAYS);
    var after = onboardingWindowDays_('ONBOARDING_WINDOW_AFTER_DAYS', ONBOARDING_WINDOW_AFTER_DAYS);
    if (!from) {
      var f = new Date(anchor.getTime()); f.setDate(f.getDate() - before);
      from = onboardingDayBounds_(f, false);
    }
    if (!until) {
      var u = new Date(anchor.getTime()); u.setDate(u.getDate() + after);
      until = onboardingDayBounds_(u, true);
    }
  }
  var now = Date.now();
  var open = now >= from.getTime() && now <= until.getTime();
  return { open: open, from: from.toISOString(), until: until.toISOString(),
           reason: open ? '' : (now < from.getTime() ? 'not open yet' : 'window closed') };
}

/** Used by Files.gs to refuse uploads from a trainee outside their window. */
function onboardingWindowOpen_(cid) {
  return onboardingWindow_(onboardingRowFor_(cid)).open;
}

/**
 * WHO MAY NAME SOMEBODY ELSE. Identity arrives on user, which the server
 * built from the session token; an address or a name in the payload is a
 * CLAIM. Only three callers are entitled to make one: the machine on its
 * internal reads, a writer, and the shared onboarding seat, which exists
 * precisely because the account is not the person sitting at it. Everybody
 * else is answered about themselves.
 *
 * NOBODY LEGITIMATE IS SHUT OUT: there is no candidate role. A new hire
 * reaches this lane through the seat and is given an account of their own
 * only after graduation, so the only sessions this narrows are sessions
 * that were never the person they were naming.
 *
 * THE SEAT IS AN ACCOUNT, NOT A BADGE. Asking for role === 'onboarding'
 * would hand this power to the next person given that badge; the account is
 * declared in SEAT_FLOWS and that is what is asked.
 */
function obMayAddressOther_(user) {
  if (!user) return false;
  if (user.is_service) return true;
  if (typeof hubIsWriter_ === 'function' && hubIsWriter_(user)) return true;
  return typeof seatIsSeatAccount_ === 'function' && seatIsSeatAccount_(user);
}

/** Window state for the drawer band (admins also learn whether they may widen). */
HUB_POLICY.onboardingWindowGet = {
  file: 'Onboarding.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.onboardingWindowGet = function (payload, user) {
  var cid = str_(payload.candidate_id);
  if (!cid) return { status: 400, message: 'candidate_id is required' };
  // The window belongs to one person, and the payload is the only place the
  // candidate is named here, so there is nothing to fall back to: reading
  // somebody else's is a writer's business, or the seat's.
  if (!obMayAddressOther_(user) && cid !== str_(user.candidate_id)) return hubDenied_();
  var w = onboardingWindow_(onboardingRowFor_(cid));
  return { status: 200, data: {
    window_open: w.open, window_from: w.from, window_until: w.until, window_reason: w.reason,
    window_applies: !!(user && user.role === 'onboarding'),
    can_extend: hubIsWriter_(user)
  } };
};

/**
 * Move one edge of the window: `extend_days` pushes the end out,
 * `open_earlier_days` pulls the start back. Writing one edge pins the other,
 * so the stored pair is explicit from then on.
 */
HUB_POLICY.onboardingSetWindow = {
  file: 'Onboarding.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['onboarding'], emits: []
};
HUB_ACTIONS.onboardingSetWindow = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!cid) return { status: 400, message: 'candidate_id is required' };
  var ext = parseInt(payload.extend_days, 10);
  var earlier = parseInt(payload.open_earlier_days, 10);
  if ((isNaN(ext) || ext === 0) && (isNaN(earlier) || earlier === 0)) {
    return { status: 400, message: 'Send extend_days (later) or open_earlier_days (earlier).' };
  }
  var row = onboardingRowFor_(cid);
  if (!row) return { status: 404, message: 'No onboarding row for ' + cid + ' yet.' };
  var w = onboardingWindow_(row);
  if (!w.from || !w.until) return { status: 400, message: 'This person has no onboarding date to anchor a window to.' };

  var from = new Date(w.from), until = new Date(w.until);
  if (!isNaN(earlier) && earlier > 0) from.setDate(from.getDate() - earlier);
  if (!isNaN(ext) && ext > 0) until.setDate(until.getDate() + ext);

  hubSetFieldLastRow_(ONBOARDING_TAB, cid, {
    access_from: onboardingDayBounds_(from, false).toISOString(),
    access_until: onboardingDayBounds_(until, true).toISOString()
  }, user, false);
  hubSysLog_(user.email, 'onboarding_window', cid + ' ' + (earlier || 0) + 'd earlier / +' + (ext || 0) + 'd', { status: 200 });

  var fresh = onboardingWindow_(onboardingRowFor_(cid));
  return { status: 200, data: { window_open: fresh.open, window_from: fresh.from, window_until: fresh.until } };
};

/** Resource router: list/get read; create/update/delete are refused (405),
 *  because the stage is derived from paperwork, not from moving a card. */
/** May this session read the onboarding rows LIVE? The slice's own roles
 *  (admin/director/manager/staff) plus the service identity that builds it.
 *  Trainees never read this RESOURCE — their portal speaks through the
 *  obFlow/packet actions, which carry their own gates. Pure. */
function onboardingLiveAllowed_(user) {
  if (!user) return false;
  if (user.is_service) return true;
  return ['admin', 'director', 'manager', 'staff'].indexOf(str_(user.role)) !== -1;
}

function onboardingRoute_(action, payload, user) {
 // The live door is gated like the slice (review ) — the rows
  // carry every new hire's document state and the client portals have no
  // business reading them.
  if (!onboardingLiveAllowed_(user)) {
    return { status: 403, message: 'Onboarding records are for the team.' };
  }
  switch (action) {
    case 'list':
      return { status: 200, data: onboardingRows_(user) };
    case 'get': {
      var id = payload && payload.id;
      var rows = onboardingRows_(user);
      for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return { status: 200, data: rows[i] };
      return { status: 404, message: 'No "onboarding" record with id "' + id + '".' };
    }
    case 'create':
      return { status: 405, message: 'A new hire enters onboarding by advancing in the Hiring pipeline — the interview scorecard is the gate.' };
    case 'update':
    case 'delete':
      return { status: 405, message: 'Onboarding stages are derived from the paperwork on file: upload or verify a document instead of moving the card.' };
    default:
      return { status: 400, message: 'Unknown action: "' + action + '". Valid actions: list, get.' };
  }
}

/** Latest (non-superseded) document row per candidate, keyed cid → doc_id. */
function onboardingDocIndex_() {
  var sheet = hubTabSheet_(DOCS_TAB);
  if (!sheet) return {};
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iCid = hdr.indexOf('candidate_id'), iDoc = hdr.indexOf('doc_id');
  var iStatus = hdr.indexOf('status'), iSup = hdr.indexOf('superseded_by');
  var iExp = hdr.indexOf('expires_on'), iUrl = hdr.indexOf('file_url');
  var out = {};
  for (var r = 1; r < values.length; r++) {
    var cid = String(values[r][iCid] || '').trim();
    if (!cid) continue;
    if (iSup !== -1 && String(values[r][iSup] || '').trim()) continue;
    (out[cid] = out[cid] || {})[String(values[r][iDoc] || '').trim()] = {
      status: String(values[r][iStatus] || '').trim(),
      expires_on: iExp === -1 ? '' : str_(values[r][iExp]),
      file_url: iUrl === -1 ? '' : str_(values[r][iUrl])
    };
  }
  return out;
}

/** Evidence → stage. Deterministic, and the reason drag is refused. */
function onboardingStageOf_(status, docs, startDate) {
  var have = function (id) {
    var d = docs[id];
    return !!d && (d.status === 'uploaded' || d.status === 'verified');
  };
  if (String(status).toLowerCase() === 'hired') return 'ready';
  var identity = have('drivers_id') && have('ss_birth');
  var training = have('dodd_8hr') && have('cpr_first_aid');
  if (identity && training && have('background_check') && str_(startDate)) return 'ready';
  if (identity && have('background_check')) return 'training';
  if (have('background_check')) return 'documents';
  if (have('dropbox_packet')) return 'background';
  return 'packet';
}

/** Tracker row → the credential the estate's Master tab calls it. */
var ONB_CERT_ROWS = { 'dodd-cert': 'dodd', 'cpr-cert': 'cpr', 'med-cert': 'med1' };

/**
 * The tracker's twelve rows. THIS APP NEVER MOVES ANYBODY (operator,
 * it only fills in and informs) — everything here is a reading.
 * `packet` is passed in rather than looked up (Packet.gs), so a whole board
 * costs ONE read of the mirror and the Hiring Pipeline cannot disagree with
 * this screen about who signed.
 */
function onboardingChecklist_(docs, stage, cjis, packet, certs) {
  var depth = ONB_STAGES.indexOf(stage);
  return ONB_CHECKLIST.map(function (row) {
    var status = 'pending';
    var label = row.label;
    if (row.doc) {
      var d = docs[row.doc];
      if (d && d.status === 'verified') status = 'done';
      else if (d && d.status === 'uploaded') status = 'auto';   // on file, not yet checked
      else if (d && d.status === 'returned') status = 'missing';
      else status = ONB_STAGES.indexOf(row.stage) <= depth ? 'missing' : 'pending';
      // The background check also closes on the CJIS result the recruiter
      // already recorded upstream — no need to re-upload the same report.
      if (row.id === 'background-check' && status !== 'done') {
        var c = String(cjis || '').toLowerCase();
        if (c === 'clear' || c === 'verified') status = 'done';
      }
      // THE PACKET ROW ANSWERS TO DROPBOX SIGN, not only to
      // `candidate_documents.dropbox_packet`. A signed envelope or a
      // hand-attached copy wins outright; 'unsigned' is the honest red;
      // 'unknown' NEVER downgrades what the upload lane already found.
      if (row.id === 'new-hire-packet' && packet) {
        if (packet.state === 'signed') { status = 'done'; label += ' — signed in Dropbox Sign'; }
        else if (packet.state === 'waived') { status = 'done'; label += ' — signed copy on file'; }
        else if (packet.state === 'unsigned') { status = 'missing'; label += ' — sent, not signed yet'; }
        else if (packet.state === 'ambiguous' && status !== 'done') { label += ' — more than one envelope matches'; }
        else if (status !== 'done' && status !== 'auto') { label += ' — no envelope found'; }
      }
      // THE CERTIFICATES ARE NOT IN THE ENVELOPE: DODD / CPR / med expiries
      // live on the estate's Master tab (Certs.gs), written by the OCR
      // script. A DATE decides; an ABSENT date says nothing and leaves the
      // upload-based status standing, and an upload on file is never
      // downgraded by an expired certificate.
      var credKey = ONB_CERT_ROWS[row.id];
      if (credKey && certs && certs[credKey] && status !== 'done') {
        var cred = certs[credKey];
        if (cred.status === 'valid') {
          status = 'done';
          label += cred.expires ? ' — valid to ' + cred.expires : ' — on file';
        } else if (cred.status === 'expiring') {
          status = 'done';
          label += ' — expires ' + (cred.expires || 'soon');
        } else if (cred.status === 'expired') {
          status = 'missing';
          label += ' — EXPIRED ' + (cred.expires || '');
        }
      }
    } else if (row.id === 'dropbox-link') {
      status = docs.__folder ? 'auto' : 'pending';
    }
    // `stage` MUST be returned: without it the detail panel files all twelve
    // rows under "Other".
    return { id: row.id, label: label, status: status, owner: row.owner, stage: row.stage };
  });
}

/** One row per candidate at the onboarding stage, plus the already hired. */
function onboardingRows_(user) {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var cands = readTabNormalized_(ss, TALENT_CANDIDATES_TAB);
  var analyses = readTabNormalized_(ss, TALENT_RESUME_TAB);
  var byCid = {};
  analyses.forEach(function (a) { if (str_(a.candidateid)) byCid[str_(a.candidateid)] = a; });

  var docIndex = onboardingDocIndex_();
  // The Dropbox Sign mirror, read ONCE for the whole board, not per person.
  var mirror = [];
  try { mirror = packetMirrorRows_(); } catch (eM) { mirror = []; }
  // The estate's DODD / CPR / med expiry dates (legacy OCR), read ONCE.
  var certPic = {};
  try { certPic = certPicture_() || {}; } catch (eC) { certPic = {}; }
  var onboardings = {};
  try {
    readTabNormalized_(ss, 'entity_onboardings').forEach(function (o) {
      if (str_(o.candidateid)) onboardings[str_(o.candidateid)] = o;
    });
  } catch (e) { /* tab not created yet */ }

  var out = [];
  cands.forEach(function (c) {
    var cid = str_(c.candidateid);
    if (!cid || TALENT_EXCLUDE_IDS.indexOf(cid) !== -1) return;
    if (str_(c.archived).toLowerCase() === 'true') return;
    var status = str_(c.status).toLowerCase();
    if (status !== 'onboarding' && status !== 'hired') return;

    var docs = docIndex[cid] || {};
    if (str_(c.docsfolderid)) docs.__folder = true;
    var ob = onboardings[cid] || {};
    var startDate = str_(ob.startdate);
    var stage = onboardingStageOf_(c.status, docs, startDate);
    var analysis = byCid[cid] || {};
    var packet = null;
    try { packet = packetState_(c, mirror); } catch (eP) { packet = null; }
    var myCerts = {};
    try {
      var ck = clientNameKey_(str_(c.candidatename));
      if (ck && certPic[ck]) myCerts = certPic[ck].certs || {};
    } catch (eK) { myCerts = {}; }
    var checklist = onboardingChecklist_(docs, stage, analysis.cjisstatus, packet, myCerts);

    var docRows = ONB_CHECKLIST.filter(function (r) { return r.doc; });
    var verified = docRows.filter(function (r) {
      return docs[r.doc] && docs[r.doc].status === 'verified';
    }).length;
    var onFile = docRows.filter(function (r) {
      return docs[r.doc] && (docs[r.doc].status === 'verified' || docs[r.doc].status === 'uploaded');
    }).length;

    var movedAt = str_(ob.datemovedtoonboarding) || str_(c.updatedat) || str_(c.createdat);
    out.push({
      id: cid,
      candidateId: cid,
      name: str_(c.candidatename) || cid,
      role: 'Direct Support Professional',
      avatar: '',
      stage: stage,
      house: str_(ob.house),
      email: str_(c.email),
      phone: str_(c.phone),
      address: [str_(c.city), str_(c.state)].filter(String).join(', '),
      manager: str_(ob.updatedby) || str_(c.assignedto),
      source: 'Hiring pipeline',
      appliedAt: hubDayLabel_(str_(c.createdat)),
      startDate: startDate ? hubDayLabel_(startDate) : '',
      daysInStage: onboardingDays_(movedAt),
      daysInOnboarding: onboardingDays_(movedAt),
      docsDone: onFile,
      docsVerified: verified,
      docsSummary: verified + ' of ' + docRows.length + ' verified',
      checklist: checklist,
      // The same chip the Hiring Pipeline draws, from the same reading.
      packet: (packet && typeof packetChip_ === 'function') ? packetChip_(packet.state) : null,
      packetSignedOn: (packet && packet.state === 'signed') ? str_(packet.signed) : '',
      packetHold: (typeof packetHold_ === 'function')
        ? (function () { try { return packetHold_(c); } catch (eH) { return null; } })()
        : null,
      notes: []
    });
  });
  return out;
}

/** Whole days since an ISO timestamp; 0 when absent or unreadable. */
function onboardingDays_(iso) {
  if (!iso) return 0;
  var t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

/**
 * Step 1 — the New Hire Packet: six forms the new hire signs, each a pair of
 * columns (the state, and the Drive file that proves it).
 * The portal's sheet was CLONED into our own `onboarding_packet` tab keeping
 * the SAME column names; the old portal is untouched, never read live.
 * A TRUE with no file id is a claim nobody can check — it never shows green.
 */

var PACKET_TAB = 'onboarding_packet';

var PACKET_ITEMS = [
  { id: 'job_app',     label: 'Job Application',    col: 'JobApp',       file: 'JobAppFileId' },
  { id: 'attestation', label: 'Attestation',        col: 'Attestation',  file: 'AttestationFileId' },
  { id: 'i9',          label: 'I-9 Form',           col: 'I9Form',       file: 'I9FormFileId' },
  { id: 'w4',          label: 'W-4 Form',           col: 'W4Form',       file: 'W4FormFileId' },
  { id: 'hipaa',       label: 'HIPAA Form',         col: 'HIPAAForm',    file: 'HIPAAFormFileId' },
  { id: 'pay_auth',    label: 'Pay Authorization',  col: 'PayAuthForm',  file: 'PayAuthFormFileId' }
];

/** Columns the Hub owns on top of the portal's own, created on demand:
 *  additive only — nothing the portal knows about is renamed or moved. */
var PACKET_OWN_COLUMNS = ['FullName', 'PacketAcknowledged', 'DocumentsComplete',
                          'HubEmail', 'HubCandidateId', 'GradCandidateId',
                          // every column obStepDone can write MUST be here:
                          // obSetField_ silently no-ops on a missing column
 // (review )
                          'BackgroundCheck', 'CompleteTraining',
                          'QuestionnaireComplete', 'TutorialsComplete',
                          'CompletedAt', 'ReleasedAt', 'ReleasedBy',
                          'source', 'cloned_at', 'updated_by', 'updated_at'];

/** The onboarding_packet tab. Throws when missing — it is never created here. */
function packetSheet_() {
  var sheet = hubTabSheet_(PACKET_TAB);
  if (!sheet) throw new Error('The onboarding_packet tab is missing.');
  ensureHeader_(sheet, PACKET_OWN_COLUMNS);
  return sheet;
}

/** TRUE / true / yes / Y all mean signed — the sheet has been touched by hand. */
function packetTruthy_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

/**
 * Find this person's packet row. Email is the join the two systems share and is
 * tried first; the portal's own id is the fallback. Returns null rather than
 * inventing a row — "not invited yet" is a real state the screen must show.
 */
function packetFindRow_(email, candidateId, opts) {
  var sheet = packetSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var mail = String(email || '').trim().toLowerCase();
  var cid = String(candidateId || '').trim();

  // CandidateEmail/CandidateId are the portal's own; HubEmail/HubCandidateId
  // are OURS, because the seat account (onboarding@asalifecare.com) is not the
  // personal address somebody applied under. Linking in a column we own leaves
  // the portal's fields exactly as they were.
  var cols = [
    { i: hdr.indexOf('CandidateEmail'), want: mail, lower: true },
    { i: hdr.indexOf('HubEmail'), want: mail, lower: true },
    { i: hdr.indexOf('CandidateId'), want: cid, lower: false },
    { i: hdr.indexOf('HubCandidateId'), want: cid, lower: false },
    // Stamped by the seat release at completion (Seat.gs). HubCandidateId is
    // cleared when the visit ends, so this is the only key that outlives it.
    { i: hdr.indexOf('GradCandidateId'), want: cid, lower: false }
  ];
 // TEST CONTACTS ARE NOT IDENTITY (operator): every test
  // candidate shares these addresses, so an email match would hand a new test
  // hire the LAST one's finished packet. For these addresses ONLY the exact
  // candidate ids may match; real people's addresses are unaffected.
 // The simulation actor mailboxes (asa-hubN@asaop.org) joined
  // the list the day the rehearsal got a mailbox per actor.
  if (/^asatech[0-9]*@asalifecare\.com$/.test(mail) ||
      /^asa-hub[0-9]*@asaop\.org$/.test(mail) ||
      mail === 'silvajhonatanbrito@gmail.com') {
    cols[0].want = '';
    cols[1].want = '';
  }
  // A FINISHED ROW IS AN ARCHIVE — for EVERY key and EVERYONE. Without this a
  // walk-up visitor matches a stranger's closed row and inherits six green
 // steps (system log ).
  //
  // ONLY CompletedAt ARCHIVES. NOT ReleasedAt: ReleasedAt is written on every
  // release including "Not you? → hand it over" (Seat.gs), so treating it as
  // an archive strands a half-finished packet the moment the seat changes
  // hands. Seat.gs stamps CompletedAt only when the visit actually FINISHED.
  //
  // The graduation sweep is the one caller that legitimately wants the
  // archive (joining on GradCandidateId), so it asks for it explicitly.
  var wantArchive = !!(opts && opts.includeFinished);
  var iCompleted = hdr.indexOf('CompletedAt');
  var isArchived = function (row) {
    if (wantArchive) return false;
    return iCompleted !== -1 &&
           !!String(row[iCompleted] == null ? '' : row[iCompleted]).trim();
  };
  for (var r = 1; r < values.length; r++) {
    if (isArchived(values[r])) continue;
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      if (col.i === -1 || !col.want) continue;
      var cell = String(values[r][col.i] == null ? '' : values[r][col.i]).trim();
      if (col.lower) cell = cell.toLowerCase();
      if (cell !== col.want) continue;
      return { sheet: sheet, hdr: hdr, row: r + 1, values: values[r] };
    }
  }
  return null;
}

/**
 * CLAIMING THE SEAT: `onboarding@asalifecare.com` is a seat, not a person
 * (Seat.gs), so the full name typed in step 1 is what claims a record for it.
 * Matching is tolerant (Names.gs); the safety is the refusal — two near-equal
 * fits claim NOTHING, because the wrong claim files one person's documents
 * under another person's name.
 */
function packetRowsByName_(name, seatEmail) {
  var sheet = packetSheet_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iName = hdr.indexOf('CandidateName');
  var iFull = hdr.indexOf('FullName');
  var iHeld = hdr.indexOf('HubEmail');
  var iDone = hdr.indexOf('CompletedAt');
  var mine = String(seatEmail || '').trim().toLowerCase();

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    // A visit that FINISHED is not claimable — by anyone, under any name:
    // "John Smith Jr" would otherwise inherit "John Smith Sr"'s finished row
 // and re-fire the hiring hook on the wrong card.
    // FINISHED, not merely RELEASED: a handover stamps ReleasedAt without
    // CompletedAt, and someone who stepped away mid-visit must be able to
    // claim their own row back (see packetFindRow_).
    if (iDone !== -1 && String(values[r][iDone] == null ? '' : values[r][iDone]).trim()) continue;
    // Rows another seat holds are out of reach: two people onboarding on two
    // laptops must never write to one record.
    var held = iHeld === -1 ? '' : String(values[r][iHeld] || '').trim().toLowerCase();
    if (held && held !== mine) continue;
    // the name they gave us beats the label the portal imported
    var label = (iFull !== -1 ? String(values[r][iFull] || '').trim() : '') ||
                (iName !== -1 ? String(values[r][iName] || '').trim() : '');
    if (!nameNorm_(label)) continue;
    rows.push({ sheet: sheet, hdr: hdr, row: r + 1, values: values[r], label: label });
  }
  return nameBest_(name, rows, function (x) { return x.label; });
}

/** A new hire nobody pre-registered still has to be able to start. */
function packetCreateRow_(name, user) {
  var sheet = packetSheet_();
  var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var now = new Date().toISOString();
  var seed = {
    CandidateId: 'OB-' + Date.now(),
    // CandidateEmail stays empty ON PURPOSE: guessing the address they applied
    // under would break the join to the old portal.
    CandidateName: name,
    FullName: name,
    HubEmail: String((user && user.email) || '').trim().toLowerCase(),
    HubCandidateId: String((user && user.candidate_id) || '').trim(),
    source: 'hub:self-serve',
    cloned_at: now,
    updated_by: String((user && user.email) || ''),
    updated_at: now
  };
  sheet.appendRow(hdr.map(function (h) { return seed.hasOwnProperty(h) ? seed[h] : ''; }));
  return seed.CandidateId;
}

/**
 * Bind this seat to whoever just typed their name. Rows held by ANOTHER seat
 * are skipped; an ambiguous name claims nothing and answers 409.
 */
function packetClaim_(name, user) {
  var mail = String((user && user.email) || '').trim().toLowerCase();
  var cid = String((user && user.candidate_id) || '').trim();

  var best = packetRowsByName_(name, mail);

  if (!best.ok && best.reason === 'ambiguous') {
    return { status: 409, message: 'That name is close to more than one record (' +
      best.candidates.join(' and ') + '). Ask your recruiter to open your onboarding — ' +
      'we will not guess which one is you.' };
  }

  if (best.ok) {
    obSetField_(best.item, 'HubEmail', mail);
    obSetField_(best.item, 'HubCandidateId', cid);
    hubSysLog_(mail, 'onboarding_claim',
      name + ' → ' + best.matched_name + ' (' + Math.round(best.score * 100) + '%)', { status: 200 });
  } else {
    // Nobody close enough — the normal path, not an error: most new hires were
    // never in the cloned rows, so they get their own record.
    var newId = packetCreateRow_(name, user);
    hubSysLog_(mail, 'onboarding_claim', name + ' → new record ' + newId, { status: 200 });
  }

  var found = packetFindRow_(mail, cid);
  if (!found) return { status: 500, message: 'The record was written but could not be read back — try again.' };
  return { status: 200, found: found };
}

/** The six packet forms for one person: state, file link, and how many signed. */
HUB_POLICY.packetState = {
  file: 'Onboarding.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.packetState = function (payload, user) {
  if (!user) return hubDenied_();
  // The payload may name a different person only for callers entitled to.
  var mayAddr = obMayAddressOther_(user);
  var email = (mayAddr && str_(payload.email)) || str_(user.email);
  var cid = (mayAddr && str_(payload.candidate_id)) || str_(user.candidate_id);
  var found = packetFindRow_(email, cid);

  var items = PACKET_ITEMS.map(function (it) {
    if (!found) return { id: it.id, label: it.label, status: 'missing', file_url: '' };
    var i = found.hdr.indexOf(it.col);
    var f = found.hdr.indexOf(it.file);
    var signed = i !== -1 && packetTruthy_(found.values[i]);
    var fileId = f === -1 ? '' : String(found.values[f] || '').trim();
    return {
      id: it.id,
      label: it.label,
      // signed with nothing attached is a claim nobody can check
      status: signed ? (fileId ? 'signed' : 'claimed') : 'missing',
      file_url: fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : ''
    };
  });

  var done = 0;
  for (var i = 0; i < items.length; i++) if (items[i].status === 'signed') done++;

  return {
    status: 200,
    data: {
      found: Boolean(found),
      candidate_name: found ? String(found.values[found.hdr.indexOf('CandidateName')] || '') : '',
      items: items,
      done: done,
      total: items.length
    }
  };
};

/**
 * Attach a signed form. It lands in the person's own folder — the same one
 * step 3 uses, so a new hire has ONE folder — and the file id is written
 * before the signed flag, so a crash leaves "no file", never "signed, file
 * missing".
 */
HUB_POLICY.packetUpload = {
  file: 'Onboarding.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: ['onboarding'], emits: []
};
HUB_ACTIONS.packetUpload = function (payload, user) {
  if (!user) return hubDenied_();
  var itemId = str_(payload.item_id);
  var item = null;
  for (var i = 0; i < PACKET_ITEMS.length; i++) if (PACKET_ITEMS[i].id === itemId) item = PACKET_ITEMS[i];
  if (!item) return { status: 400, message: 'Unknown packet form: ' + itemId };

  // The payload may name a different person only for callers entitled to.
  var mayAddr = obMayAddressOther_(user);
  var email = (mayAddr && str_(payload.email)) || str_(user.email);
  var cid = (mayAddr && str_(payload.candidate_id)) || str_(user.candidate_id);
  var found = packetFindRow_(email, cid);
  if (!found) return { status: 404, message: 'No onboarding row for this person yet — they have not been invited.' };

  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'No file attached' };
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty' };
  if (bytes.length > 15 * 1024 * 1024) return { status: 400, message: 'The file is over 15MB' };

  var folder = filesCandidateFolder_(cid || email);
  var today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  var original = str_(payload.filename) || (item.id + '.pdf');
  var mime = str_(payload.mime_type) || 'application/octet-stream';
  // No setSharing(): a signed I-9 inherits the folder, like every other
  // identity document here.
  var file = folder.folder.createFile(Utilities.newBlob(bytes, mime, item.id + '__' + today + '__' + original));

  var iFile = found.hdr.indexOf(item.file);
  var iCol = found.hdr.indexOf(item.col);
  if (iFile !== -1) found.sheet.getRange(found.row, iFile + 1).setValue(file.getId());
  if (iCol !== -1) found.sheet.getRange(found.row, iCol + 1).setValue('TRUE');
  var iUpd = found.hdr.indexOf('updated_by');
  var iAt = found.hdr.indexOf('updated_at');
  if (iUpd !== -1) found.sheet.getRange(found.row, iUpd + 1).setValue((user && user.email) || '');
  if (iAt !== -1) found.sheet.getRange(found.row, iAt + 1).setValue(new Date().toISOString());

  hubSysLog_(user && user.email, 'packet_upload', item.label, { status: 200 });
  return HUB_ACTIONS.packetState({ email: email, candidate_id: cid }, user);
};

/**
 * The six steps. WHY THE NAME IS ASKED FIRST: it is crossed against the Staff
 * Documentation Portal form (338 people, 1,709 uploads), so anything already
 * sent shows as done and only the gaps are asked for.
 * ID_DOCS maps each document to the FORM's own vocabulary ("High School
 * Diploma" is filed there as "HS Diploma / Transcripts / GED"); a rename on
 * either side is one edit here, never a silent miss.
 */

var PRIOR_DOCS_TAB = 'Responses';

/**
 * "Pending Documents" is not our storage, it is a reviewer's INBOX: the upload
 * goes here once and our sheet records the id — one file, one place.
 * The folder's own naming convention: `<Name> - <Document type> - <expiry
 * YYYYMMDD>`, the type in the FORM's vocabulary ("Drivers License / OH ID"),
 * the expiry omitted when there is none.
 */

/**
 * Where an upload lands. Script Property `ONBOARDING_DOCS_TARGET` = 'live'
 * sends it to the reviewer's Pending Documents; anything else — INCLUDING
 * unset, the safe default — sends it to a test folder, so a test file never
 * reaches somebody's inbox.
 */
function obDocsTarget_() {
  var mode = String(hubProp_('ONBOARDING_DOCS_TARGET') || '').trim().toLowerCase();
  if (mode === 'live') {
    return { folder: DriveApp.getFolderById(hubId_('PENDING_DOCS_FOLDER_ID')), live: true, where: 'Pending Documents' };
  }
  return { folder: filesChildByName_(filesRoot_(), 'Pending Documents (test)'), live: false, where: 'Pending Documents (test)' };
}

/** YYYY-MM-DD (or anything Date can read) → 20261022; '' when absent. */
function obStampDate_(v) {
  var s = String(v || '').trim();
  if (!s) return '';
  var d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'UTC', 'yyyyMMdd');
}

/**
 * `cat` IS THE PLATFORM'S OWN DOC ID (DOC_CATALOG_DEFAULT, Files.gs), and it
 * had to be added because these were THREE vocabularies pretending to be one:
 * this list's `id`, the form's `prior`, and the catalogue's `doc_id`. The
 * catalogue is what `candidate_documents` is keyed on, and that tab is what
 * employeeDbFill reads — so without `cat` a document handed in here could not
 * be seen by the thing that fills the Employee Database.
 *
 * SS CARD AND MED DEL WERE MISSING ENTIRELY (measured 268 and 116
 * submissions in the form). Anyone who had already sent either was asked for it
 * again, and the three Master columns they answer — I-9 Type 2, I-9 2 Exp Date
 * and Med 1 Exp Date — could only ever be filled by a fresh upload.
 *
 * The last two have no tracker column of their own, and they do not need one:
 * `obCanonicalHave_` reads the platform's document record, so "done" no longer
 * depends on a column existing in that sheet.
 */
var ID_DOCS = [
  { id: 'drivers_license', label: "Driver's License", cat: 'drivers_id',
    col: 'DLID', file: 'DLIDFileId', prior: 'Drivers License / OH ID' },
  { id: 'car_insurance', label: 'Car Insurance Card', cat: 'car_insurance',
    col: 'CarInsurance', file: 'CarInsuranceFileId', prior: 'Car Insurance Card' },
  { id: 'hs_diploma', label: 'High School Diploma', cat: 'hs_diploma',
    col: 'HSDiploma', file: 'HSDiplomaFileId', prior: 'HS Diploma / Transcripts / GED' },
  { id: 'cpr', label: 'CPR Certification', cat: 'cpr_first_aid',
    col: 'CertCPRFirstAid', file: 'CertCPRFirstAidFileId', prior: 'CPR / 1st Aid Certificate' },
  { id: 'dodd_8hr', label: '8 Hour DODD Training Certificate', cat: 'dodd_8hr',
    col: 'EightHrTrain', file: 'EightHrTrainFileId', prior: 'DODD Training Certificate' },
  { id: 'ss_birth', label: 'Social Security Card / Birth Certificate', cat: 'ss_birth',
    col: 'SSBirth', file: 'SSBirthFileId', prior: 'Social Security Card / Birth Certificate' },
  { id: 'med_del', label: 'Med Delegation Certificate', cat: 'med_del',
    col: 'MedDel', file: 'MedDelFileId', prior: 'Med Del Cert' }
];

/**
 * The catalogue ids this person already has a document row for.
 *
 * WHY IT EXISTS: a portal upload used to be recorded ONLY as a tracker column
 * and a Drive file. `candidate_documents` — the platform's document record, and
 * the one employeeDbFill reads — never heard about it, so every certificate a
 * new hire handed in here was invisible to the thing that fills the Employee
 * Database. Reading it here also means a document type needs no column in the
 * tracker sheet to be marked done.
 */
function obCanonicalHave_(cid) {
  var have = {};
  if (!cid) return have;
  try {
    var mine = (onboardingDocIndex_() || {})[cid] || {};
    for (var k in mine) {
      if (!Object.prototype.hasOwnProperty.call(mine, k)) continue;
      var st = String(mine[k].status || '');
      if (st === 'uploaded' || st === 'verified') have[k] = mine[k];
    }
  } catch (e) { /* the tracker column still answers */ }
  return have;
}

/**
 * Record a portal upload where the platform keeps documents.
 *
 * NEVER THROWS AND NEVER BLOCKS: the person's file is already saved and their
 * step already marked. A bookkeeping row that fails must not cost them the
 * upload — it costs the Employee Database a field, and that is recoverable.
 */
function obRecordCanonical_(doc, cid, personName, file, expiresIso, user) {
  if (!doc || !doc.cat || !cid) return;
  try {
    var cat = null;
    var list = (typeof filesCatalog_ === 'function') ? filesCatalog_() : DOC_CATALOG_DEFAULT;
    for (var i = 0; i < list.length; i++) if (str_(list[i].doc_id) === doc.cat) cat = list[i];
    var now = new Date().toISOString();
    hubAppendRow_(DOCS_TAB, {
      doc_row_id: 'DOC_' + randomHex_(16).toUpperCase(),
      candidate_id: cid, candidate_name: str_(personName),
      doc_id: doc.cat, doc_label: str_(cat && cat.label) || doc.label,
      status: 'uploaded', review_status: 'pending',
      file_id: file.getId(),
      file_url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      file_name: file.getName(), mime_type: file.getMimeType(),
      size_bytes: file.getSize(),
      issued_on: '', expires_on: str_(expiresIso),
      uploaded_by: 'asa-hub:onboarding:' + str_(user && user.email),
      uploaded_at: now, verified_by: '', verified_at: '', superseded_by: '',
      notes: 'handed in through the onboarding portal'
    });
  } catch (e) {
    hubSysLog_('asa-hub:onboarding', 'canonical_doc_record_failed',
               str_(doc.cat) + ': ' + String((e && e.message) || e), { status: 500 });
  }
}

/**
 * The staff document archive — the folder the estate reads (StaffDocs.gs).
 * A new hire's upload has to land there too, or the archive knows every
 * document except the ones this platform collected. Same naming convention the
 * form's own uploader uses: `<Name> - <Document type> - <expiry YYYYMMDD>`.
 * Copying, never moving: Pending Documents is the reviewer's inbox and stays.
 */
function obArchiveCopy_(file, name) {
  if (typeof staffDocsFolderId_ !== 'function') return '';
  try {
    return String(file.makeCopy(name, DriveApp.getFolderById(staffDocsFolderId_())).getId());
  } catch (e) {
    hubSysLog_('asa-hub:onboarding', 'archive_copy_failed',
               name + ': ' + String((e && e.message) || e), { status: 500 });
    return '';
  }
}

/** Names are typed by people: case, extra spaces and punctuation mean nothing. */
function obNormName_(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What this person already sent through the old form. The name match is
 * tolerant (Names.gs): names are collapsed to one entry per person, the best
 * must be clearly ahead of the runner-up, and two close names find NOTHING
 * rather than hand over the wrong person's documents.
 * Returns the matched name too — it is shown, so a fuzzy match is correctable.
 */
function obPriorSubmissions_(fullName) {
  var empty = { docs: {}, matched_name: '', score: 0, ambiguous: null };
  if (!nameNorm_(fullName)) return empty;

  // The heaviest read in the portal (another whole spreadsheet + fuzzy match)
 // and it runs on EVERY obFlow — operator, far too slow.
  // The legacy form barely moves, so 5 minutes of cache per name is invisible.
  var cache = CacheService.getScriptCache();
  var cacheKey = 'ob_prior_' + nameNorm_(fullName).slice(0, 80);
  var hit = cache.get(cacheKey);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* fall through to the read */ }
  }

  var rows;
  try {
    rows = ssOpen_(hubId_('PRIOR_DOCS_SHEET_ID')).getSheetByName(PRIOR_DOCS_TAB).getDataRange().getValues();
  } catch (e) {
    return empty;   // no access, or the form moved — the step works without the head start
  }
  if (!rows || rows.length < 2) return empty;

  var hdr = rows[0].map(function (h) { return String(h).trim(); });
  var iName = hdr.indexOf('Your Name');
  var iDoc = hdr.indexOf('Select Document');
  var iUrl = -1, iExp = -1, iCert = -1;
  for (var h = 0; h < hdr.length; h++) {
    if (hdr[h].indexOf('Upload your document') === 0) iUrl = h;
    if (hdr[h] === 'Date of Expiration') iExp = h;
    if (hdr[h] === 'Date of Certification') iCert = h;
  }
  if (iName === -1 || iDoc === -1) return empty;

  // One entry per person, not per submission: scoring 1,709 rows would let
  // whoever filed the most documents win on volume alone.
  var people = [], seen = {};
  for (var r = 1; r < rows.length; r++) {
    var raw = String(rows[r][iName] || '').trim();
    var key = nameTokens_(raw).core.join(' ');
    if (!key) continue;
    if (!seen[key]) { seen[key] = { name: raw, key: key, rows: [] }; people.push(seen[key]); }
    seen[key].rows.push(r);
  }

  var best = nameBest_(fullName, people, function (p) { return p.name; });
  if (!best.ok) {
    var miss = { docs: {}, matched_name: '', score: best.score || 0,
                 ambiguous: best.reason === 'ambiguous' ? best.candidates : null };
    try { cache.put(cacheKey, JSON.stringify(miss), 300); } catch (eC) { /* too big — served uncached */ }
    return miss;
  }

  // One person can be filed under two spellings ("Dinell chine" / "Dinell
  // Johnson chine"), so everything matching the winner as strongly as the
  // winner matched the query belongs to them.
  var claimed = [];
  people.forEach(function (p) {
    if (p.key === best.item.key || nameScore_(best.matched_name, p.name) >= NAME_MATCH_MIN) {
      claimed = claimed.concat(p.rows);
    }
  });

  var byPrior = {};
  claimed.forEach(function (r) {
    var doc = String(rows[r][iDoc] || '').trim();
    if (!doc) return;
    var entry = {
      url: iUrl === -1 ? '' : String(rows[r][iUrl] || '').trim(),
      submitted: String(rows[r][0] || ''),
      expires: iExp === -1 ? '' : String(rows[r][iExp] || ''),
      certified: iCert === -1 ? '' : String(rows[r][iCert] || ''),
      name: String(rows[r][iName] || '').trim()
    };
    // keep the most recent submission of each document type
    if (!byPrior[doc] || String(entry.submitted) > String(byPrior[doc].submitted)) byPrior[doc] = entry;
  });
  var out = { docs: byPrior, matched_name: best.matched_name, score: best.score, ambiguous: null };
  try { cache.put(cacheKey, JSON.stringify(out), 300); } catch (eC) { /* too big — served uncached */ }
  return out;
}

/**
 * Is ANYBODY at the onboarding stage right now? Existence only, no name or any
 * other parameter (operator). When nobody is, the seat is closed:
 * the portal says why and signs the visitor out.
 */
function obStageHasCandidates_() {
  // Cached for a minute: obFlow runs on every portal action and must not add a
  // candidates-tab read to each one.
  var cache = CacheService.getScriptCache();
  var hit = cache.get('ob_stage_open');
  if (hit !== null) return hit === '1';
  var open = false;
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB);
  for (var i = 0; i < rows.length; i++) {
    var c = rows[i];
    if (!str_(c.candidateid)) continue;
    if (str_(c.archived).toLowerCase() === 'true') continue;
    if (talentStage_(c.status) === 'onboarding') { open = true; break; }
  }
  cache.put('ob_stage_open', open ? '1' : '0', 60);
  return open;
}

/**
 * THE ONBOARDING WINDOW — its own days and its own date, separate from the
 * interview's (operator,; a missed window needs the team's
 * extension). It closes a door on a new hire, so:
 *   - NO DATE MEANS OPEN (a referral inserted straight into Onboarding).
 *   - THE EXTENSION OUTRANKS THE WINDOW: `onboarding_access_until` wins.
 *   - CLOSED IS NEVER A BLANK WALL: the refusal carries the date and says to
 *     ask the team.
 *   - THE DEFAULT TAIL IS LONG: seven days, not the interview's two.
 */
var OB_WINDOW_BEFORE_DEFAULT = 1;
var OB_WINDOW_AFTER_DEFAULT = 7;
var OB_COL_SCHEDULED = 'onboarding_scheduled_for';
var OB_COL_ACCESS_UNTIL = 'onboarding_access_until';

/** A configured window edge in days (0-365), or the fallback. */
function obWindowDays_(key, fallback) {
  var v = (typeof hubCfgInt_ === 'function') ? hubCfgInt_(key, null, 0, 365) : null;
  return (v === null || v === undefined) ? fallback : v;
}

/** This candidate's onboarding window: { open, from, until, reason,
 *  anchored_on }. Fails OPEN whenever there is nothing to anchor to. */
function obOnboardingWindow_(cand) {
  if (!cand) return { open: true, reason: 'no card', anchored_on: '' };

  // The team's answer to "I missed it" — an explicit grant, and it wins.
  var granted = str_(cand[normKey_(OB_COL_ACCESS_UNTIL)] || cand.onboardingaccessuntil);
  if (granted) {
    var g = new Date(granted);
    if (!isNaN(g.getTime())) {
      var openG = Date.now() <= g.getTime();
      return { open: openG, from: '', until: g.toISOString(),
               anchored_on: 'extension',
               reason: openG ? '' : 'the extension ran out on ' + granted.slice(0, 10) };
    }
  }

  // The onboarding's own date, or the in-person visit it belongs to. READ, not
  // stamped: there are several ways into this stage, and a stamp written on
  // one of them is a stamp missing from the others.
  var sched = str_(cand[normKey_(OB_COL_SCHEDULED)] || cand.onboardingscheduledfor);
  var anchor = sched ? 'onboarding date' : '';
  if (!sched && typeof interviewFor_ === 'function') {
    try {
      var iv = interviewFor_(str_(cand.candidateid));
      sched = iv ? str_(iv.scheduledfor) : '';
      if (sched) anchor = 'the in-person visit';
    } catch (e) { sched = ''; }
  }
  if (!sched) return { open: true, reason: 'no onboarding date to anchor to', anchored_on: '' };

  var d = new Date(sched);
  if (isNaN(d.getTime())) {
    return { open: true, reason: 'the onboarding date could not be read', anchored_on: '' };
  }
  var before = obWindowDays_('onboarding_window_before_days', OB_WINDOW_BEFORE_DEFAULT);
  var after = obWindowDays_('onboarding_window_after_days', OB_WINDOW_AFTER_DEFAULT);
  // Day edges in the COMPANY's timezone (hubTzDayEdge_): with setHours the
  // window opened and closed on the evening before it should.
  var fromRaw = new Date(d.getTime()); fromRaw.setDate(fromRaw.getDate() - before);
  var untilRaw = new Date(d.getTime()); untilRaw.setDate(untilRaw.getDate() + after);
  var from = (typeof hubTzDayEdge_ === 'function') ? hubTzDayEdge_(fromRaw, false)
    : (function () { var x = new Date(fromRaw.getTime()); x.setHours(0, 0, 0, 0); return x; })();
  var until = (typeof hubTzDayEdge_ === 'function') ? hubTzDayEdge_(untilRaw, true)
    : (function () { var x = new Date(untilRaw.getTime()); x.setHours(23, 59, 59, 999); return x; })();
  var now = Date.now();
  var open = now >= from.getTime() && now <= until.getTime();
  return {
    open: open, from: from.toISOString(), until: until.toISOString(),
    anchored_on: anchor,
    reason: open ? ''
      : (now < from.getTime()
          ? 'your onboarding opens on ' + from.toISOString().slice(0, 10)
          : 'your onboarding closed on ' + until.toISOString().slice(0, 10) +
            ' — ask the hiring team to extend it and you can carry on')
  };
}

/**
 * The team's answer when somebody misses their window. A DATE, NOT A FLAG:
 * "open again" with no end is a door nobody closes. Default seven days.
 */
HUB_POLICY.onboardingExtend = {
  file: 'Onboarding.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'onboarding'], emits: []
};
HUB_ACTIONS.onboardingExtend = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };

  var until;
  if (str_(payload.until)) {
    until = new Date(str_(payload.until));
    if (isNaN(until.getTime())) return { status: 400, message: 'until must be a date.' };
  } else {
    var days = parseInt(payload.days, 10);
    if (isNaN(days) || days < 1 || days > 90) days = OB_WINDOW_AFTER_DEFAULT;
    until = new Date(Date.now() + days * 86400000);
  }
  until.setHours(23, 59, 59, 999);

  var fields = {};
  fields[OB_COL_ACCESS_UNTIL] = until.toISOString();
  hubEnsureColumns_(TALENT_CANDIDATES_TAB, [OB_COL_SCHEDULED, OB_COL_ACCESS_UNTIL]);
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, fields, user, true);
  hubBustTalentCache_();
  try { CacheService.getScriptCache().remove('ob_stage_open'); } catch (e) { /* 60s TTL */ }
  hubSysLog_(user.email, 'onboarding_extend',
             cid + ' — ' + str_(ev.cand.candidatename) + ' may onboard until ' +
             until.toISOString().slice(0, 10), { status: 200 });
  return { status: 200, data: { candidate_id: cid, until: until.toISOString() } };
};

/**
 * MANUAL ONBOARDING — "Onboarding by email", the human lane (operator,
 * ): one press attests somebody was walked through the packet.
 * Flags are filled only WHERE BLANK: whatever the portal already captured is
 * evidence and stays. `manual_onboarding` lands on the CANDIDATE row, so the
 * graduation sweep reads the arrival as complete.
 */
HUB_POLICY.onboardingManualComplete = {
  file: 'Onboarding.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  // the move it can trigger passes through onboarding, which sends the
 // new hire their own login (Hired.gs)
  invalidates: ['candidates', 'onboarding'], emits: ['emailSend']
};
HUB_ACTIONS.onboardingManualComplete = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  if (talentStage_(ev.cand.status) !== 'onboarding') {
    return { status: 409, message: 'Manual onboarding applies to candidates AT the Onboarding stage.' };
  }
  var now = new Date().toISOString();
  // WHAT WAS TRUE BEFORE THIS PRESS, read before a single blank is filled:
  // this button is the only way past Onboarding, so it is pressed both for a
  // finished portal visit and for an e-mail walkthrough, and once the flags
  // are filled the two are indistinguishable.
  var portalDone = false;
  try { portalDone = hubOnboardingDone_(ev.cand).how === 'portal'; } catch (eD) { portalDone = false; }
  // The packet record when the person half-used the portal: blanks filled,
  // nothing overwritten, GradCandidateId stamped so the row stays findable.
  try {
    var packet = packetFindRow_(str_(ev.cand.email), cid);
    if (packet) {
      ['PacketAcknowledged', 'BackgroundCheck', 'DocumentsComplete',
       'CompleteTraining', 'QuestionnaireComplete', 'TutorialsComplete'].forEach(function (col) {
        if (!packetTruthy_(obField_(packet, col))) obSetField_(packet, col, 'TRUE');
      });
      if (!str_(obField_(packet, 'CompletedAt'))) obSetField_(packet, 'CompletedAt', now);
      if (!str_(obField_(packet, 'GradCandidateId'))) obSetField_(packet, 'GradCandidateId', cid);
      obSetField_(packet, 'updated_by', 'asa-hub:manual-onboarding:' + str_(user.email));
      obSetField_(packet, 'updated_at', now);
    }
  } catch (ePk) { /* no packet row — the candidate-row marker below carries the truth */ }
  ensureHeader_(hubSheet_(TALENT_CANDIDATES_TAB),
                ['manual_onboarding', 'manual_onboarding_by', 'manual_onboarding_method']);
  var manualNotes = str_(payload.notes).slice(0, 2000);
  hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, cid, {
    manual_onboarding: 'true',
    // A column, NOT a phrase parsed back out of the line above: the sweep
    // branches on this, and branching on a substring of a human sentence
    // breaks the day somebody adds a note.
    manual_onboarding_method: portalDone ? 'portal' : 'attested',
    manual_onboarding_by: 'asa-hub:' + str_(user.email) + ' at ' + now +
      (portalDone ? ' — confirmed a portal visit that was already complete'
                  : ' — attested (walked through by e-mail)') +
      (manualNotes ? ' — ' + manualNotes : '')
  }, user, false);
 // THE SAME PACKET RULE AS THE PORTAL (operator): with the packet
  // they go to Hired; without it the card is HELD here — quiet for a day,
  // amber after that — until the sweep or a hand-attached copy releases them.
  var pk = { state: 'unknown' };
  try { pk = packetState_(cid) || pk; } catch (ePs) { /* held; the sweep re-reads */ }
  var onFile = pk.state === 'signed' || pk.state === 'waived';
  if (!onFile) {
    var until = packetHoldStart_(cid, str_(ev.cand.candidatename), pk.state, user);
    hubBustTalentCache_();
    hubSysLog_(user && user.email, 'onboarding_manual_complete',
      cid + ' — manual onboarding (by email); held at Onboarding, packet ' + pk.state, { status: 200 });
    return { status: 200, data: { completed: true, moved: false, stage: 'onboarding',
             held: true, hold_until: until, packet_state: pk.state } };
  }
  hubSetStatus_(cid, HUB_STAGE_TO_STATUS['hired'], user);
  packetHoldClear_(cid, user);
  hubBustTalentCache_();
  hubSysLog_(user && user.email, 'onboarding_manual_complete',
    cid + ' — manual onboarding (by email); moved to Hired', { status: 200 });
  return { status: 200, data: { completed: true, moved: true, stage: 'hired', packet_state: pk.state } };
};

/** Read a field from this person's row, '' when the row or column is absent. */
function obField_(found, name) {
  if (!found) return '';
  var i = found.hdr.indexOf(name);
  return i === -1 ? '' : String(found.values[i] == null ? '' : found.values[i]).trim();
}

/** Write a field. SILENTLY no-ops when the column is absent — see
 *  PACKET_OWN_COLUMNS. */
function obSetField_(found, name, value) {
  var i = found.hdr.indexOf(name);
  if (i !== -1) found.sheet.getRange(found.row, i + 1).setValue(value);
}

/**
 * The whole flow in one read: the six steps, what each is waiting on, and why
 * it is locked — never a dead button with no reason.
 */
HUB_POLICY.obFlow = {
  file: 'Onboarding.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.obFlow = function (payload, user) {
  if (!user) return hubDenied_();
  // The payload may name a different person only for callers entitled to.
  var mayAddr = obMayAddressOther_(user);
  var email = (mayAddr && str_(payload.email)) || str_(user.email);
  var cid = (mayAddr && str_(payload.candidate_id)) || str_(user.candidate_id);
  var found = packetFindRow_(email, cid);

  // ONLY what the person typed — never fall back to CandidateName: an imported
  // label made step 1 hide its field and search under a name nobody gave.
  var fullName = obField_(found, 'FullName');
  var prior = fullName ? obPriorSubmissions_(fullName) : { docs: {}, matched_name: '', ambiguous: null };
  var priorDocs = prior.docs || {};

  // The platform's own document record counts as sent — see obCanonicalHave_.
  var onRecord = obCanonicalHave_(str_(obField_(found, 'GradCandidateId')));

  var docs = ID_DOCS.map(function (d) {
    var mine = obField_(found, d.file);
    var signed = packetTruthy_(obField_(found, d.col));
    var early = priorDocs[d.prior];
    var kept = d.cat ? onRecord[d.cat] : null;
    if (!mine && kept) {
      return { id: d.id, label: d.label, status: 'uploaded', source: 'you sent this here',
               file_url: str_(kept.file_url), expires: str_(kept.expires_on) };
    }
    if (mine) {
      return { id: d.id, label: d.label, status: 'uploaded', source: 'you sent this here',
               file_url: 'https://drive.google.com/file/d/' + mine + '/view' };
    }
    if (early && early.url) {
      return { id: d.id, label: d.label, status: 'on_file', source: 'already on file',
               file_url: early.url, submitted: early.submitted, expires: early.expires, certified: early.certified };
    }
    // marked done in the sheet with nothing attached — a claim, not a document
    if (signed) return { id: d.id, label: d.label, status: 'claimed', source: 'marked done, no copy attached', file_url: '' };
    return { id: d.id, label: d.label, status: 'missing', source: '', file_url: '' };
  });

  var docsDone = 0;
  for (var i = 0; i < docs.length; i++) if (docs[i].status === 'uploaded' || docs[i].status === 'on_file') docsDone++;

  var opened = {};
  try { opened = JSON.parse(obField_(found, 'Notes_opened') || '{}'); } catch (e) { opened = {}; }

 // STEP 1 SHOWS THE PACKET IN RED WHEN IT IS MISSING (operator).
  // Resolved from the NAME THEY TYPED, never from the account: the seat's
  // candidate id belongs to the furniture (see seatResolveCandidate_).
  var packet = { state: 'unknown', on_file: false };
  // THE WINDOW IS PER PERSON, resolved from that same typed name, and it FAILS
  // OPEN: anything unreadable here lets the visitor carry on.
  var window = { open: true, reason: '', until: '', anchored_on: '' };
  if (fullName) {
    try {
      var pcid = seatFindCandidateId_(fullName);
      if (pcid) {
        var pres = packetState_(pcid) || {};
        packet = {
          state: str_(pres.state) || 'unknown',
          on_file: pres.state === 'signed' || pres.state === 'waived'
        };
        try {
          var wcand = hubEvidence_(pcid).cand;
          if (wcand) window = obOnboardingWindow_(wcand);
        } catch (eW) { /* open, as above */ }
      }
    } catch (ePk) { /* unknown — the screen says "we could not check", never "missing" */ }
  }

  return {
    status: 200,
    data: {
      found: Boolean(found),
      /** signed | waived | unsigned | ambiguous | unknown */
      packet_state: packet.state,
      packet_on_file: packet.on_file,
      // false = the seat is CLOSED (nobody at the onboarding stage): the portal
      // shows the closed-seat notice and signs the visitor out.
      stage_open: obStageHasCandidates_(),
      // The person's own window, separate from the seat. `window_reason` is
      // written to be read BY THE NEW HIRE: it names the date and says to ask
      // the team.
      window_open: window.open !== false,
      window_until: str_(window.until),
      window_reason: str_(window.reason),
      window_anchored_on: str_(window.anchored_on),
      full_name: fullName,
      packet_acknowledged: packetTruthy_(obField_(found, 'PacketAcknowledged')),
      background_done: packetTruthy_(obField_(found, 'BackgroundCheck')),
      documents_done: packetTruthy_(obField_(found, 'DocumentsComplete')),
      training_done: packetTruthy_(obField_(found, 'CompleteTraining')),
      questionnaire_done: packetTruthy_(obField_(found, 'QuestionnaireComplete')),
      tutorials_done: packetTruthy_(obField_(found, 'TutorialsComplete')),
      docs: docs,
      docs_done: docsDone,
      docs_total: docs.length,
      prior_count: Object.keys(priorDocs).length,
      /** the name we searched under — shown, so a fuzzy match is correctable */
      matched_name: prior.matched_name || '',
      /** two people are too close to tell apart — say so instead of guessing */
      name_ambiguous: prior.ambiguous || null
    }
  };
};

/** Step 1: the name unlocks the step, and is what the document match uses. */
HUB_POLICY.obSetName = {
  file: 'Onboarding.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: ['onboarding'], emits: []
};
HUB_ACTIONS.obSetName = function (payload, user) {
  if (!user) return hubDenied_();
  // THE ENTRY GATE, server-side: an empty onboarding stage refuses the visit
  // here. The browser's disabled button is a rendering detail, not the rule.
  if (!obStageHasCandidates_()) {
    return { status: 409, message: 'No candidate is at the onboarding phase of the process right now — this seat is closed.' };
  }
  var name = str_(payload.full_name).slice(0, 120).trim();
  if (name.split(/\s+/).length < 2) {
    return { status: 400, message: 'Please give your first and last name — that is how we find documents you already sent.' };
  }
  var found = packetFindRow_(str_(user.email), str_(user.candidate_id));
  if (!found) {
    // CLAIMING A RECORD BY NAME IS THE SEAT'S POWER, not a parameter. Without
    // this, any signed-in account could type a candidate's name, bind that
    // person's onboarding row to its own session, and walk the rest of the
    // lane: the packet upload resolves the card from the same name and ends
    // in Hired.gs, which sends the login letter for the card it moved.
    if (!obMayAddressOther_(user)) {
      return { status: 403, message: 'Your account is not on the onboarding list.' };
    }
    // The seat is free (nobody bound, or the last visit was released), so the
    // name just typed claims a record — see packetClaim_.
    var claim = packetClaim_(name, user);
    if (claim.status !== 200) return { status: claim.status, message: claim.message };
    found = claim.found;
  }
  obSetField_(found, 'FullName', name);
  obSetField_(found, 'updated_by', (user && user.email) || '');
  obSetField_(found, 'updated_at', new Date().toISOString());
  hubSysLog_(user && user.email, 'onboarding_name', name, { status: 200 });
  return HUB_ACTIONS.obFlow({}, user);
};

/** Mark a step done. The screen decides when the button is offered; this
 *  refuses the two that must not be faked from a console. */
HUB_POLICY.obStepDone = {
  file: 'Onboarding.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: ['onboarding'], emits: []
};
HUB_ACTIONS.obStepDone = function (payload, user) {
  if (!user) return hubDenied_();
  var map = {
    packet: 'PacketAcknowledged',
    background: 'BackgroundCheck',
    // Every step the screen can mark MUST be a column: "documents done" once
    // lived only in the browser, so a shared seat handed the tick to the next
    // person.
    documents: 'DocumentsComplete',
    training: 'CompleteTraining',
    questionnaire: 'QuestionnaireComplete',
    tutorials: 'TutorialsComplete'
  };
  var col = map[str_(payload.step)];
  if (!col) return { status: 400, message: 'Unknown step: ' + str_(payload.step) };
  var found = packetFindRow_(str_(user.email), str_(user.candidate_id));
  if (!found) return { status: 404, message: 'You are not on the onboarding list yet.' };
  // Checked on EVERY step, not just the first: the name is what opens the
  // record, and without it there is nothing to write a step onto.
  if (!obField_(found, 'FullName')) {
    return { status: 400, message: 'Give your full name in step 1 first — that is what opens your record.' };
  }
  obSetField_(found, col, payload.done === false ? 'FALSE' : 'TRUE');
  obSetField_(found, 'updated_by', (user && user.email) || '');
  obSetField_(found, 'updated_at', new Date().toISOString());
  hubSysLog_(user && user.email, 'onboarding_step', str_(payload.step), { status: 200 });
  return HUB_ACTIONS.obFlow({}, user);
};

/** Step 3 upload — same folder as everything else this person sends. */
HUB_POLICY.obDocUpload = {
  file: 'Onboarding.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: ['onboarding', 'certMatrix'], emits: []
};
HUB_ACTIONS.obDocUpload = function (payload, user) {
  if (!user) return hubDenied_();
  var docId = str_(payload.doc_id);
  var doc = null;
  for (var i = 0; i < ID_DOCS.length; i++) if (ID_DOCS[i].id === docId) doc = ID_DOCS[i];
  if (!doc) return { status: 400, message: 'Unknown document: ' + docId };

  var found = packetFindRow_(str_(user.email), str_(user.candidate_id));
  if (!found) return { status: 404, message: 'You are not on the onboarding list yet.' };
  // The file is named after the person, for a reviewer sorting by name.
  if (!obField_(found, 'FullName')) {
    return { status: 400, message: 'Give your full name in step 1 first — your documents are filed under it.' };
  }

  var b64 = String(payload.base64 || '');
  if (!b64) return { status: 400, message: 'No file attached' };
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) return { status: 400, message: 'The file is empty' };
  if (bytes.length > 15 * 1024 * 1024) return { status: 400, message: 'The file is over 15MB' };

  // Named and filed the way the review folder already works.
  var who = obField_(found, 'FullName') || str_(user.email);
  var stamp = obStampDate_(payload.expires);
  var ext = '';
  var original = str_(payload.filename) || '';
  var dot = original.lastIndexOf('.');
  if (dot > 0) ext = original.substring(dot);
  var name = who + ' - ' + doc.prior + (stamp ? ' - ' + stamp : '') + ext;

  var target;
  try {
    target = obDocsTarget_();
  } catch (e) {
    return { status: 502, message: 'The documents folder could not be opened — nothing was saved.' };
  }
  var file = target.folder.createFile(
    Utilities.newBlob(bytes, str_(payload.mime_type) || 'application/octet-stream', name));

  // file first, then the flag: a crash between them leaves "not done" rather
  // than "done, file missing"
  obSetField_(found, doc.file, file.getId());
  obSetField_(found, doc.col, 'TRUE');
  obSetField_(found, 'updated_by', (user && user.email) || '');
  obSetField_(found, 'updated_at', new Date().toISOString());

  // A CERTIFICATE HANDED OVER HERE HAS TO REACH THE COMPLIANCE MATRIX
 // (operator). It records POSSESSION, not validity — the matrix
  // shows `submitted` until a human verifies it — and it NEVER blocks the
  // upload: a failed registration must not cost the person their document.
  if (typeof clearanceRecordUpload_ === 'function') {
    clearanceRecordUpload_(doc.id, who, str_(user.candidate_id) || obField_(found, 'GradCandidateId'),
                           file.getId(), stamp, user);
  }

  // AND WHERE THE PLATFORM KEEPS DOCUMENTS. Until now a portal upload existed
  // only as a tracker column and a Drive file, so employeeDbFill — which reads
  // candidate_documents — could not see a single certificate a new hire sent.
  var cidNow = str_(user.candidate_id) || str_(obField_(found, 'GradCandidateId'));
  obRecordCanonical_(doc, cidNow, who, file, str_(payload.expires), user);

  // AND IN THE ESTATE'S ARCHIVE: a document uploaded during onboarding is
  // copied into the same folder the archive keeps.
  // Only once it is really live: a rehearsal must not reach the real archive.
  if (target.live) obArchiveCopy_(file, name);

  hubSysLog_(user && user.email, 'onboarding_doc', doc.label + ' → ' + target.where, { status: 200 });
  return HUB_ACTIONS.obFlow({}, user);
};

/**
 * Take a wrongly attached document back. The file goes to the BIN, never
 * erased — a mistaken removal has to be recoverable. Only what the Hub itself
 * filed can be removed; a submission from the old form is not ours to touch.
 */
HUB_POLICY.obDocRemove = {
  file: 'Onboarding.gs', lane: 'write', store: 'drive',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: ['onboarding'], emits: []
};
HUB_ACTIONS.obDocRemove = function (payload, user) {
  if (!user) return hubDenied_();
  var docId = str_(payload.doc_id);
  var doc = null;
  for (var i = 0; i < ID_DOCS.length; i++) if (ID_DOCS[i].id === docId) doc = ID_DOCS[i];
  if (!doc) return { status: 400, message: 'Unknown document: ' + docId };

  var found = packetFindRow_(str_(user.email), str_(user.candidate_id));
  if (!found) return { status: 404, message: 'You are not on the onboarding list yet.' };

  var fileId = obField_(found, doc.file);
  if (!fileId) return { status: 400, message: 'There is nothing here that we filed for you.' };

  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    // the row is cleared anyway: a pointer we cannot reach keeps the step
    // looking done
  }
  obSetField_(found, doc.file, '');
  obSetField_(found, doc.col, '');
  obSetField_(found, 'updated_by', (user && user.email) || '');
  obSetField_(found, 'updated_at', new Date().toISOString());

  hubSysLog_(user && user.email, 'onboarding_doc_removed', doc.label, { status: 200 });
  return HUB_ACTIONS.obFlow({}, user);
};

/** The onboarding report: one row per finished visit. Nothing here sends —
 *  Smart Comms sweeps the rows. Written from seatRelease's `finishing`
 *  branch, which already guards against stamping a visit twice. */
var OB_REPORT_TAB = 'onboarding_reports';

/** Full header before any append: columns are mapped BY NAME, so an unnamed
 *  column is invisible platform-wide even with data in the cell. */
var OB_REPORT_HEADER = ['id', 'createdAt', 'candidate_id', 'full_name', 'phone', 'email',
                        'step1_packet', 'step2_background', 'step3_documents',
                        'step4_training', 'step5_questionnaire', 'step6_tutorials',
                        'report_text'];

/** The onboarding_reports tab, created with its header when missing. */
function obReportSheet_() {
  var existed = !!hubTabSheet_(OB_REPORT_TAB);
  var sheet = hubTabEnsure_(OB_REPORT_TAB, OB_REPORT_HEADER);
  // an older report tab is narrower than the header above; widen it, because
  // the append maps BY NAME and drops whatever it cannot place
  if (existed) ensureHeader_(sheet, OB_REPORT_HEADER);
  return sheet;
}

/** The six report lines. Steps 5 and 6 come from the browser (the record only
 *  stores yes/no); absent, they read "Not reported", never a zero. */
function obReportLines_(found, payload) {
  var packetOnFile = false;
  try {
    var cid = str_(obField_(found, 'CandidateId'));
    if (cid) {
      var pk = packetState_(cid) || {};
      packetOnFile = (pk.state === 'signed' || pk.state === 'waived');
    }
  } catch (ePk) { packetOnFile = false; }

  // Missing documents BY NAME. Two ways to be on file — uploaded here, or
  // matched from an earlier submission — and both count; a `claimed` row
  // (ticked, nothing attached) does not.
  var priorDocs = {};
  try {
    var who = str_(obField_(found, 'FullName'));
    if (who) priorDocs = (obPriorSubmissions_(who) || {}).docs || {};
  } catch (ePr) { priorDocs = {}; }

  var missing = [];
  var onRecordM = obCanonicalHave_(str_(obField_(found, 'GradCandidateId')));
  ID_DOCS.forEach(function (d) {
    if (str_(obField_(found, d.file))) return;                    // uploaded here
    if (d.cat && onRecordM[d.cat]) return;                        // on the platform's record
    var early = priorDocs[d.prior];
    if (early && early.url) return;                               // already on file
    missing.push(d.label);
  });

  var qAns = payload && payload.questionnaire_answered;
  var qTot = payload && payload.questionnaire_total;
  var tSeen = payload && payload.tutorials_seen;
  var tTot = payload && payload.tutorials_total;
  var haveQ = (qAns !== undefined && qAns !== null && qTot);
  var haveT = (tSeen !== undefined && tSeen !== null && tTot);

  return {
    step1: packetOnFile ? 'Delivered' : 'Not Delivered',
    step2: packetTruthy_(obField_(found, 'BackgroundCheck')) ? 'Done' : 'Not Done',
    step3: missing.length === 0 ? 'Done' : ('Missing ' + missing.join(', ')),
    step4: packetTruthy_(obField_(found, 'CompleteTraining'))
      ? 'Person Check as Done' : 'Not Done',
    step5: haveQ ? ('Answer ' + qAns + ' from ' + qTot) : 'Not reported',
    step6: haveT
      ? (Number(tSeen) >= Number(tTot) ? ('See the ' + tTot + ' videos.')
                                       : ('Saw ' + tSeen + ' of ' + tTot + ' videos.'))
      : 'Not reported'
  };
}

/** Write the report for a finished visit. Returns the row id, or '' — never
 *  throws: a failed report must not cost somebody their onboarding. */
function obReportWrite_(info, user, payload) {
  try {
    var cid = str_(info && info.candidate_id);
    var found = packetFindRow_(str_(user && user.email), cid);
    if (!found) return '';

    var name = str_(obField_(found, 'FullName')) || str_(info && info.name) ||
               str_(obField_(found, 'CandidateName'));
    var phone = str_(obField_(found, 'Phone')) || str_(obField_(found, 'CandidatePhone'));
    var email = str_(obField_(found, 'CandidateEmail'));
    // Contact details fall back to the CANDIDATE row: the report has to be
    // actionable without opening the platform (operator).
    if ((!phone || !email) && cid) {
      try {
        var cand = hubEvidence_(cid).cand;
        if (cand) {
          if (!phone) phone = str_(cand.phone);
          if (!email) email = str_(cand.email);
        }
      } catch (eC) { /* the name alone still makes a usable report */ }
    }

    var L = obReportLines_(found, payload);
    var text =
      'Onboarding Report' + (name ? ' - ' + name : '') + '\n' +
      'Step 1 - New Hire Packet - ' + L.step1 + '\n' +
      'Step 2 - Background Check - ' + L.step2 + '\n' +
      'Step 3 - Upload Documents - ' + L.step3 + '\n' +
      'Step 4 - Complete Training - ' + L.step4 + '\n' +
      'Step 5 - Questionnaire - ' + L.step5 + '\n' +
      'Step 6 - New Hire Tutorials - ' + L.step6;

    var id = 'OBR_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
    var sheet = obReportSheet_();
    var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var row = {
      id: id, createdAt: new Date().toISOString(), candidate_id: cid,
      full_name: name, phone: phone, email: email,
      step1_packet: L.step1, step2_background: L.step2, step3_documents: L.step3,
      step4_training: L.step4, step5_questionnaire: L.step5, step6_tutorials: L.step6,
      report_text: text
    };
    sheet.appendRow(hdr.map(function (h) { return row.hasOwnProperty(h) ? row[h] : ''; }));
    return id;
  } catch (e) {
    hubSysLog_(user && user.email, 'onboarding_report_failed',
               String((e && e.message) || e), { status: 500 });
    return '';
  }
}

/** Rows for the Smart Comms sweep. The ledger (keyed on row id) decides what
 *  was already sent — swept, never fired by the action that wrote it. */
function obReportSubjects_() {
  try {
    var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), OB_REPORT_TAB);
    return rows.map(function (r) {
      return {
        id: str_(r.id), instance: str_(r.createdat),
        name: str_(r.fullname), phone: str_(r.phone), email: str_(r.email),
        step1: str_(r.step1packet), step2: str_(r.step2background),
        step3: str_(r.step3documents), step4: str_(r.step4training),
        step5: str_(r.step5questionnaire), step6: str_(r.step6tutorials),
        report: str_(r.reporttext)
      };
    }).filter(function (r) { return r.id; });
  } catch (e) { return []; }
}
