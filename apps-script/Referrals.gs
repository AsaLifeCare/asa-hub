// The fast lane to Onboarding is for the authenticated intake only; the public door never reaches Onboarding.
var REFERRAL_PLACEHOLDER_DOMAINS = [
  'example.com', 'example.org', 'example.net', 'mail.example', 'test.com',
  'test.test', 'email.com', 'none.com', 'noemail.com', 'no.com', 'na.com',
  'nomail.com', 'domain.com', 'sample.com'
];

function referralNamePart_(v) {
  var s = str_(v).trim();
  return s.length >= 2 && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]*$/.test(s);
}

// Shape only (a placeholder is refused, a plausible wrong number passes); every reason is returned at once.
function referralFastLaneCheck_(o) {
  var reasons = [];
  if (!/referral/i.test(str_(o.source))) {
    reasons.push('the source must be Referral');
  }
  if (!referralNamePart_(o.first) || !referralNamePart_(o.last)) {
    reasons.push('a full name — first and last, letters only');
  }
  var digits = str_(o.phone).replace(/\D/g, '').replace(/^1/, '');
  if (digits.length !== 10) {
    reasons.push('a complete 10-digit phone number');
  } else if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    reasons.push('a dialable phone number — that area code or prefix cannot exist');
  } else if (typeof SHARED_LINE_DIGITS !== 'undefined' && SHARED_LINE_DIGITS.indexOf(digits) !== -1) {
    reasons.push('a personal phone number — that is one of our own lines');
  }
  var email = str_(o.email).toLowerCase().trim();
  var domain = email.indexOf('@') > 0 ? email.slice(email.indexOf('@') + 1) : '';
  if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email) || email.indexOf('..') !== -1) {
    reasons.push('a valid email address');
  } else if (REFERRAL_PLACEHOLDER_DOMAINS.indexOf(domain) !== -1) {
    reasons.push('a real email address — ' + domain + ' is a placeholder');
  }
  // Without a referrer, "Referral" is a dropdown value anybody can pick to skip four stages.
  if (!referralNamePart_(o.referrer)) {
    reasons.push('the name of whoever referred them');
  }
  return { ok: reasons.length === 0, reasons: reasons };
}

var REFERRAL_STAGE_ORDER = ['new', 'phone-screen', 'interview', 'onboarding'];

// Skipped stages are recorded as Skipped, never Completed or Advance: nobody screened this person.
function referralScaffold_(o) {
  var placedIdx = REFERRAL_STAGE_ORDER.indexOf(o.stage);
  if (placedIdx <= 0) return [];
  var now = new Date().toISOString();
  var who = str_(o.user && o.user.email) || 'asa-hub';
  var why = 'Skipped at intake by ' + who + ' on ' + now.slice(0, 10) +
    (o.referrer ? ' — referred by ' + o.referrer : ' — referral fast lane') +
    '. This stage did not happen; the card was inserted at ' +
    (HUB_STAGE_TO_STATUS[o.stage] || o.stage) + '.';
  var done = [];

  if (placedIdx > 0) {
    try {
      hubAppendRow_(TALENT_RESUME_TAB, {
        candidate_id: o.cid, summary: why, decision_status: 'Skipped',
        created_at: now, updated_at: now, created_by: 'asa-hub:fast-lane:' + who
      });
      done.push('new');
    } catch (e1) { }
  }

  if (placedIdx > 1) {
    try {
      ensureHeader_(hubSheet_(TALENT_PHONE_TAB),
        ['candidate_id', 'screen_status', 'final_result', 'screen_date', 'screened_by', 'transcript_text', 'notes']);
      hubAppendRow_(TALENT_PHONE_TAB, {
        candidate_id: o.cid, screen_status: 'Skipped', final_result: 'Skipped',
        screen_date: now, screened_by: 'asa-hub:fast-lane:' + who,
        transcript_text: why, notes: why
      });
      done.push('phone-screen');
    } catch (e2) { }
  }

  // No recommendation is invented: it is what could put somebody in a house.
  if (placedIdx > 2) {
    try {
      ensureHeader_(hubSheet_(HUB_INTERVIEWS_TAB),
        ['candidate_id', 'candidate_name', 'status', 'recommendation', 'comments', 'created_at', 'created_by']);
      hubAppendRow_(HUB_INTERVIEWS_TAB, {
        candidate_id: o.cid, candidate_name: o.name, status: 'Skipped',
        recommendation: '', comments: why,
        created_at: now, created_by: 'asa-hub:fast-lane:' + who
      });
      done.push('interview');
    } catch (e3) { }
  }

  // Packet row minted unbound: the seat columns stay empty until someone sits at the screen.
  if (o.stage === 'onboarding') {
    try {
      var sheet = packetSheet_();
      var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h).trim(); });
      var seed = {
        CandidateId: o.cid,
        CandidateName: o.name,
        CandidateEmail: str_(o.email),
        source: 'hub:fast-lane' + (o.referrer ? ':' + o.referrer : ''),
        cloned_at: now, updated_by: 'asa-hub:' + who, updated_at: now
      };
      sheet.appendRow(hdr.map(function (h) { return seed.hasOwnProperty(h) ? seed[h] : ''; }));
      done.push('onboarding-packet');
    } catch (e4) { }
  }

  hubSysLog_(who, 'fast_lane_scaffold',
    o.cid + ' — ' + o.name + ' inserted at ' + o.stage + '; wrote: ' + (done.join(', ') || 'nothing'),
    { status: 200 });
  return done;
}

// Every answer must literally occur in the text: a contact the text does not contain was invented.
function referralContactFind_(text) {
  var out = { email: '', phone: '' };
  var t = String(text || '');
  if (!t.replace(/\s+/g, '')) return out;
  var occurs = function (cand) {
    if (!cand) return false;
    if (String(cand).indexOf('@') !== -1) {
      return t.toLowerCase().indexOf(String(cand).toLowerCase()) !== -1;
    }
    var d = String(cand).replace(/\D/g, '');
    return d.length >= 10 && t.replace(/\D/g, '').indexOf(d) !== -1;
  };
  try {
    var parsed = hubParseResumeIdentity_(t);
    if (parsed && str_(parsed.email) && occurs(parsed.email)) out.email = str_(parsed.email).toLowerCase();
    if (parsed && str_(parsed.phone) && occurs(parsed.phone)) out.phone = str_(parsed.phone);
  } catch (eP) { }
  // A found address must never suppress the phone beside it.
  if (out.phone) return out;
  // Any phone-shaped run of 10-13 digits; the AI only reads last.
  try {
    var runRe = /\+?\d[\d\s().\/-]{7,}\d/g;
    var mm;
    while ((mm = runRe.exec(t)) !== null) {
      var dd = mm[0].replace(/\D/g, '');
      if (dd.length >= 10 && dd.length <= 13) { out.phone = mm[0].trim(); break; }
    }
  } catch (eRun) { }
  if (out.phone || out.email) return out;
  try {
    if (typeof screenAiChat_ === 'function') {
      var rtpl = bookText_('Prompts', 'ai_referral_contact', '')
        .split('{text}').join(t.slice(0, 12000));
      var chat = rtpl ? screenAiChat_(rtpl, 0, 'ai_referral_contact') : null;
      var obj = null;
      try { obj = JSON.parse(str_(chat && chat.content)); } catch (eJ) { obj = null; }
      if (chat && chat.ok && obj) {
        var em = str_(obj.email).toLowerCase(), ph = str_(obj.phone);
        if (em && em.indexOf('@') > 0 && occurs(em)) out.email = em;
        else if (ph && occurs(ph)) out.phone = ph;
      }
    }
  } catch (eA) { }
  return out;
}

function referralScreenText_(rowId, fallback, name) {
  var text = fallback;
  try {
    // Through the router: a direct HUB_DB read finds nothing, the rows live in their own house.
    var rows = smartSituations_();
    for (var i = 0; i < rows.length; i++) {
      if (str_(rows[i].id) === rowId) {
        text = str_(rows[i].email_text) || str_(rows[i].emailtext) || fallback;
        break;
      }
    }
  } catch (e) { }
  return String(text).split('{name}').join(str_(name) || 'this person');
}

// Raw digits on purpose: hubFindDuplicate_ zeroes shared-line digits, and recognition needs the owner. Never creates.
function referralKnownByDigits_(digits) {
  var d = String(digits || '').replace(/\D/g, '').replace(/^1/, '');
  if (d.length < 10) return null;
  var same = function (v) {
    var pd = String(v == null ? '' : v).replace(/\D/g, '').replace(/^1/, '');
    return pd.length >= 10 && pd === d;
  };
  var hit = null;
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), TALENT_CANDIDATES_TAB).some(function (c) {
      if (str_(c.archived).toLowerCase() === 'true') return false;
      if (same(c.phone)) { hit = { name: str_(c.candidatename) }; return true; }
      return false;
    });
  } catch (e1) { }
  if (hit) return hit;
  try {
    usersAll_().some(function (u) {
      if (str_(u.mergedinto)) return false;
      if (same(u.phone)) { hit = { name: str_(u.displayname) }; return true; }
      var extras = String(u.phones || '').split(/[,;|]/);
      for (var i = 0; i < extras.length; i++) {
        if (same(extras[i])) { hit = { name: str_(u.displayname) }; return true; }
      }
      return false;
    });
  } catch (e2) { }
  if (hit) return hit;
  try {
    listRows_('people', {}).some(function (p) {
      if (same(p.phone)) { hit = { name: str_(p.name) }; return true; }
      return false;
    });
  } catch (e3) { }
  return hit;
}

function referralAlreadyKnownAnswer_(name, book) {
  hubSysLog_('referral:public', 'referral_duplicate', name, { status: 200 });
  // A book hiccup must never change what the public door answers.
  try {
    if (book) referralBookAppend_(book);
  } catch (eBook) { }
  return { status: 200, code: 'already_known',
           message: referralScreenText_(commSituationId_('referral.already_known', 'referral_already_known'),
             'Good news — {name} is already in our hiring records, and our ' +
             'team is on it. There is nothing you need to do: if anything is ' +
             'missing on their side, we will reach out to them directly. ' +
             'Thank you for looking out!', name),
           data: { received: true, already_known: true } };
}

function referralWarnText_(name) {
  return referralScreenText_(commSituationId_('referral.no_contact', 'referral_no_contact'),
    'Thank you for thinking of {name}! To move forward, our team needs a way ' +
    'to reach them — a phone number or an e-mail address. We read the resume ' +
    'you sent and could not find either one. Please add a number or an e-mail ' +
    'to the form and press Send again.', name);
}

// One row per knock, whatever the door answered; the door only appends, referralBookSet_ settles.
var REFERRAL_BOOK_TAB = 'entity_referrals';
var REFERRAL_BOOK_HEADER = ['referral_id', 'name', 'email', 'phone',
  'referrer_name', 'referrer_phone', 'referrer_email', 'resume_link',
  'candidate_id', 'state', 'state_detail', 'arrived_at', 'resolved_at',
  'created_by'];

function referralBookSheet_() {
  // Asked before the maker: text format only for a new tab, header widening only for an old one.
  var existed = !!hubTabSheet_(REFERRAL_BOOK_TAB);
  var sheet = hubTabEnsure_(REFERRAL_BOOK_TAB, REFERRAL_BOOK_HEADER);
  if (existed) {
    ensureHeader_(sheet, REFERRAL_BOOK_HEADER);
  } else {
    sheet.getRange(1, 1, sheet.getMaxRows(), REFERRAL_BOOK_HEADER.length).setNumberFormat('@');
  }
  return sheet;
}

function referralBookAppend_(fields) {
  var f = fields || {};
  var id = str_(f.referral_id) || ('REF_' + randomHex_(8).toUpperCase());
  referralBookSheet_();
  hubAppendRow_(REFERRAL_BOOK_TAB, {
    referral_id: id,
    name: str_(f.name),
    email: str_(f.email),
    phone: str_(f.phone),
    referrer_name: str_(f.referrer_name),
    referrer_phone: str_(f.referrer_phone),
    referrer_email: str_(f.referrer_email),
    resume_link: str_(f.resume_link),
    candidate_id: str_(f.candidate_id),
    state: str_(f.state) || 'received',
    state_detail: str_(f.state_detail).slice(0, 500),
    arrived_at: str_(f.arrived_at) || new Date().toISOString(),
    resolved_at: '',
    created_by: str_(f.created_by) || 'referral:public'
  });
  return id;
}

// candidate_id first, then referral_id; a live row wins so a duplicate knock never takes the ladder's flips.
function referralBookSet_(key, fields) {
  var k = str_(key);
  if (!k) return false;
  var f = fields || {};
  var sheet = referralBookSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;
  var hdr = values[0].map(normKey_);
  var iCid = hdr.indexOf('candidateid'), iRef = hdr.indexOf('referralid');
  var iState = hdr.indexOf('state');
  var LIVE = { received: 1, contacting: 1, asking_referrer: 1 };
  var hit = -1, hitLive = -1, r;
  for (r = 1; r < values.length; r++) {
    if (iCid !== -1 && str_(values[r][iCid]) === k) {
      hit = r;
      if (iState !== -1 && LIVE[str_(values[r][iState])]) hitLive = r;
    }
  }
  if (hitLive !== -1) hit = hitLive;
  if (hit === -1) {
    for (r = 1; r < values.length; r++) {
      if (iRef !== -1 && str_(values[r][iRef]) === k) hit = r;
    }
  }
  if (hit === -1) return false;
  var writes = {};
  Object.keys(f).forEach(function (col) {
    writes[col] = col === 'state_detail' ? str_(f[col]).slice(0, 500) : str_(f[col]);
  });
  var state = str_(f.state);
  if ((state === 'resolved' || state === 'discarded') && !str_(writes.resolved_at)) {
    writes.resolved_at = new Date().toISOString();
  }
  Object.keys(writes).forEach(function (col) {
    var i = hdr.indexOf(normKey_(col));
    if (i !== -1) sheet.getRange(hit + 1, i + 1).setValue(writes[col]);
  });
  return true;
}

// The only unauthenticated write on the platform.
function referralSubmit_(payload) {
  // Set only by our own probe below; from the caller it is a link anybody could plant on a card.
  if (payload) delete payload.__stored_file_url;
  // 30 an hour platform-wide: generous for people, a wall for scripts.
  try {
    var thrCache = CacheService.getScriptCache();
    var thrCount = Number(thrCache.get('referral_hour_count') || '0');
    if (thrCount >= 30) {
      return { status: 429, message: 'Too many referrals right now — please try again later.' };
    }
    thrCache.put('referral_hour_count', String(thrCount + 1), 3600);
  } catch (eThr) { }
  var name = str_(payload && payload.name).slice(0, 120);
  var phone = str_(payload && payload.phone).slice(0, 40);
  var email = str_(payload && payload.email).toLowerCase().slice(0, 160);
  var referrer = str_(payload && payload.referrer).slice(0, 120);
  // A malformed referrer contact is recorded as nothing: this door only ever refuses a name.
  var referrerPhone = str_(payload && payload.referrer_phone).slice(0, 40);
  if (referrerPhone.replace(/\D/g, '').length < 10) referrerPhone = '';
  var referrerEmail = str_(payload && payload.referrer_email).toLowerCase().slice(0, 160);
  if (!(referrerEmail.indexOf('@') > 0 &&
        referrerEmail.lastIndexOf('.') > referrerEmail.indexOf('@'))) {
    referrerEmail = '';
  }
  var resumeText = String((payload && payload.resume_text) || '').slice(0, 20000);

  if (!name || name.replace(/\s+/g, '').length < 2) {
    return { status: 400, message: 'The name is required.' };
  }
  // Reads the live vars, so a contact dug out of the resume below is the one written.
  var bookRow = function (extra) {
    var f = {
      name: name.trim(), email: email, phone: phone,
      referrer_name: referrer, referrer_phone: referrerPhone,
      referrer_email: referrerEmail,
      resume_link: str_(payload && payload.__stored_file_url)
    };
    for (var k in extra) f[k] = extra[k];
    return f;
  };
  var digits = phone.replace(/\D/g, '');
  var hasPhone = digits.length >= 10;
  // Our own lines create nobody, but may still recognize somebody already known.
  var sharedDigits = '';
  if (hasPhone && typeof SHARED_LINE_DIGITS !== 'undefined' &&
      SHARED_LINE_DIGITS.indexOf(digits.slice(-10)) !== -1) {
    sharedDigits = digits;
    hasPhone = false;
    phone = '';
  }
  var hasEmail = email.indexOf('@') > 0 && email.lastIndexOf('.') > email.indexOf('@');
  if (!hasPhone && !hasEmail) {
    // Search the resume before refusing; an attached file is stored once here and reused below.
    var searchText = resumeText;
    if (!searchText.replace(/\s+/g, '') && payload && payload.file_base64) {
      try {
        var probe = hubDriveFileObj_({
          base64: payload.file_base64,
          filename: str_(payload.file_name) || 'referral-resume.pdf',
          mime_type: str_(payload.mime)
        }, 'referral-resume.pdf', '');
        payload.__stored_file_url = probe.url;
        searchText = hubExtractResumeText_(probe.id);
      } catch (eProbe) { searchText = ''; }
    }
    var foundContact = referralContactFind_(searchText);
    if (foundContact.email) {
      email = foundContact.email;
      hasEmail = true;
    } else if (foundContact.phone) {
      phone = foundContact.phone;
      digits = phone.replace(/\D/g, '');
      hasPhone = digits.length >= 10;
      if (hasPhone && typeof SHARED_LINE_DIGITS !== 'undefined' &&
          SHARED_LINE_DIGITS.indexOf(digits.slice(-10)) !== -1) {
        sharedDigits = digits;
        hasPhone = false;
        phone = '';
      }
    }
    if (!hasPhone && !hasEmail) {
      var known = sharedDigits ? referralKnownByDigits_(sharedDigits) : null;
      if (known) {
        return referralAlreadyKnownAnswer_(name, bookRow({
          state: 'already_known',
          state_detail: 'one of our own lines recognized ' + str_(known.name)
        }));
      }
      try {
        referralBookAppend_(bookRow({
          state: 'no_contact',
          state_detail: 'no phone or e-mail anywhere — the form, the resume, the readers'
        }));
      } catch (eBookNC) { }
      return { status: 422, code: 'no_contact', message: referralWarnText_(name) };
    }
  }

  var dup = null;
  try {
    // '' matches nothing: hubFindDuplicate_ guards each key on truthiness.
    dup = hubFindDuplicate_(hasPhone ? digits.replace(/^1/, '') : '',
                            hasEmail ? email : '');
  } catch (eDup) { dup = null; }
  if (dup) {
    return referralAlreadyKnownAnswer_(name, bookRow({
      state: 'already_known', candidate_id: str_(dup.id),
      state_detail: 'already in the pipeline as ' + str_(dup.name)
    }));
  }

  // trusted:false: anyone can type '[test]'. Warn-only by default: a refusal here is invisible to the submitter.
  var refGuard = null;
  try {
    refGuard = contactGuard_(hasPhone ? phone : '', hasEmail ? email : '',
                             { name: name, trusted: false });
  } catch (eG) { refGuard = null; }
  if (refGuard && refGuard.severity === 'block' && cgEnforces_('public')) {
    hubSysLog_('referral:public', 'referral_staff_conflict',
      name + ' — refused: ' + contactGuardMessage_(refGuard), { status: 409 });
    try {
      referralBookAppend_(bookRow({
        state: 'refused_guard',
        state_detail: contactGuardMessage_(refGuard)
      }));
    } catch (eBookRG) { }
    return { status: 200, data: { received: true } };
  }
  if (refGuard && refGuard.severity !== 'unverified') {
    // Shadow mode still logs, or there is nothing to measure before enforcing.
    hubSysLog_('referral:public', 'referral_staff_conflict',
      name + ' — ' + refGuard.severity + ' (not enforced): ' + contactGuardMessage_(refGuard),
      { status: 200 });
  }

  var link = '';
  try {
    if (payload && payload.__stored_file_url) {
      link = payload.__stored_file_url;
    } else if (payload && payload.file_base64) {
      // The form sends file_base64/file_name/mime; the helper reads base64/filename/mime_type.
      link = hubDriveFile_({
        base64: payload.file_base64,
        filename: str_(payload.file_name) || 'referral-resume.pdf',
        mime_type: str_(payload.mime)
      }, 'referral-resume.pdf', '');
    } else if (resumeText.replace(/\s+/g, '')) {
      var f = hubUploadsFolder_().createFile(
        'referral-' + name.replace(/[^\w ]/g, '').slice(0, 40).trim() + '.txt',
        resumeText, MimeType.PLAIN_TEXT);
      // Folder-inherited access only: a public form must not mint world-readable links.
      link = f.getUrl();
    }
  } catch (eFile) { link = ''; }

  var parts = name.trim().split(/\s+/);
  var id = 'CAN_' + randomHex_(20).toUpperCase();
  var now = new Date().toISOString();
  // A real phone and no resume starts at Phone Screen: the screener collects CV and CJIS on the call.
  var status = (hasPhone && !link) ? 'Phone Screen' : 'New';
  // Without these columns the header match drops the referrer and the resume link.
  try { hubEnsureColumns_(TALENT_CANDIDATES_TAB, ['source', 'resume_link']); } catch (eCol) { }
  hubAppendRow_(TALENT_CANDIDATES_TAB, {
    candidate_id: id,
    candidate_name: name.trim(),
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' '),
    phone: phone,
    email: hasEmail ? email : '',
    status: status,
    source: referrer ? 'Referral — ' + referrer : 'Referral',
    resume_link: link,
    created_at: now,
    updated_at: now,
    created_by: 'referral:public'
  });
  if (status === 'Phone Screen') {
    try { hubLogStatus_(id, name.trim(), 'New', 'Phone Screen', 'referral:fast-lane'); } catch (eLg) { }
  }
  // 'contacting' is what tells the ask machine this person is theirs to chase.
  var refBookId = '';
  var machineOn = !hasPhone;
  try {
    refBookId = referralBookAppend_(bookRow({
      candidate_id: id,
      email: hasEmail ? email : '',
      state: machineOn ? 'contacting' : 'received',
      state_detail: machineOn
        ? 'e-mail only — the ask machine takes them'
        : 'full contact — straight into the pipeline at ' + status,
      resume_link: link
    }));
  } catch (eBookOK) { }
  if (typeof journeyLog_ === 'function') {
    journeyLog_({
      candidate_id: id, name: name.trim(), step: 'referral_arrives',
      title: 'A referral arrived through the public door',
      channel: 'system', ref: refBookId, by: 'referral:public',
      detail: 'book row ' + (refBookId || '(unwritten)') + ' — ' + (machineOn
        ? 'e-mail only — the ask machine takes them'
        : 'full contact — straight into the pipeline')
    });
  }
  hubBustTalentCache_();
  hubSysLog_('referral:public', 'referral_received',
    id + ' — ' + name + (link ? ' (resume attached)' : ''), { status: 200 });
  return { status: 200, data: { received: true } };
}
