var CAND_FORM_LINK_BASE = 'https://asamylife.asalifecare.com/candidate.html?t=';

// The 'candform.' prefix keeps these tokens disjoint from interview links sharing the secret.
function candFormSig_(cid) {
  var secret = interviewLinkSecret_();
  if (!secret) return '';
  var bytes = Utilities.computeHmacSha256Signature('candform.' + cid, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function candFormTokenFor_(cid) {
  var sig = candFormSig_(cid);
  return sig ? cid + '.' + sig : '';
}

function candFormCidByToken_(t) {
  var raw = String(t || '');
  var dot = raw.indexOf('.');
  if (dot < 1) return null;
  var cid = raw.slice(0, dot), sig = raw.slice(dot + 1);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return null;
  if (!interviewSigEqual_(sig, candFormSig_(cid))) return null;
  return cid;
}

// Every failure gets this same answer, so the page cannot probe which ids exist.
function candFormGone_() {
  return { status: 404, message: 'This link is not valid or no longer active.' };
}

function candFormShareUser_() {
  return { email: 'shared-form-link', name: 'Shared form link', role: 'manager' };
}

/** Mint the signed share link to one candidate's form; the link is the authorisation, so minting it takes a writer. */
HUB_POLICY.candShareLink = {
  file: 'CandidateForm.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.candShareLink = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var token = candFormTokenFor_(cid);
  if (!token) {
    return { status: 409, message: 'Set the INTERVIEW_LINK_SECRET Script Property first — there is no link to mint.' };
  }
  var ev = hubEvidence_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  return { status: 200, data: { url: CAND_FORM_LINK_BASE + token } };
};

// Public doors: Main.gs answers them before any session check; they must never get a HUB_POLICY row.

// Picked fields only, so a column added to the slice never leaks through a minted link.
function candFormContextPub_(payload) {
  var cid = candFormCidByToken_(payload && payload.t);
  if (!cid) return candFormGone_();
  var rec = null;
  try {
    talentCandidatesRead_().forEach(function (r) {
      if (str_(r.id) === cid) rec = r;
    });
  } catch (e) { rec = null; }
  if (!rec) return candFormGone_();
  var gate = { ok: false, to: '', missing: [] };
  try {
    var g = hubGate_(hubEvidence_(cid));
    gate = { ok: !!g.ok, to: str_(g.to), missing: g.reasons || [] };
  } catch (eG) { /* the record still draws; only the Move button dims */ }
  return { status: 200, data: {
    candidate: {
      id: str_(rec.id), name: str_(rec.name), role: str_(rec.role),
      stage: str_(rec.stage), source: str_(rec.source),
      appliedAt: str_(rec.appliedAt), daysInStage: rec.daysInStage,
      score: rec.score, email: str_(rec.email), phone: str_(rec.phone),
      city: str_(rec.city), state: str_(rec.state),
      resumeLink: str_(rec.resumeLink), resumeFileLabel: str_(rec.resumeFileLabel),
      summary: str_(rec.summary),
      summaryTimeline: rec.summaryTimeline || [],
      checklist: rec.checklist || [],
      screenDate: str_(rec.screenDate), screenResult: str_(rec.screenResult),
      owner: str_(rec.owner)
    },
    gate: gate
  } };
}

function candFormSubmitPub_(payload) {
  var cid = candFormCidByToken_(payload && payload.t);
  if (!cid) return candFormGone_();
  var kind = str_(payload && payload.kind);
  if (kind === 'decision') {
    var checkpoint = str_(payload.checkpoint);
    if (['resume-decision', 'advance-decision'].indexOf(checkpoint) === -1) {
      return { status: 400, message: 'unknown checkpoint' };
    }
    var value = str_(payload.value);
    if (['Advance', 'Decline'].indexOf(value) === -1) {
      return { status: 400, message: 'decision must be Advance or Decline' };
    }
    // No attestation: a link-only identity signs no phone screen, so Advance still needs it Completed.
    return hubSetDecision_(
      { candidate_id: cid, checkpoint: checkpoint, value: value }, candFormShareUser_());
  }
  if (kind === 'move') {
    return HUB_ACTIONS.moveStage(
      { candidate_id: cid, to_stage: str_(payload.to_stage) }, candFormShareUser_());
  }
  return { status: 400, message: 'unknown kind' };
}
