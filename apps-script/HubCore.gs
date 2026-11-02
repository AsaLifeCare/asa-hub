/**
 * HubCore.gs — Hub actions: intake, uploads, legacy sync, user management.
 * Loads FIRST (push_apps_script.py:assert_load_order) so HUB_POLICY exists
 * before any other module extends it.
 */

/** Writer = admin or manager. */
function hubIsWriter_(user) {
  return user && (user.role === 'admin' || user.role === 'manager');
}

/** The 403 body for a non-writer. */
function hubDenied_() {
  return { status: 403, message: 'Requires an admin or manager account' };
}

/**
 * An account's contact cells, the fields present only, through `set(key, value)` on its row: phone, phones and
 * e-mails cleaned, deduped and capped in Profile.gs, the avatar, and the display name (an administrator's save vouches
 * for it). The sign-in email column is never touched here.
 */
function hubUserFieldsWrite_(payload, set) {
  if (payload.display_name !== undefined) {
    set('displayname', str_(payload.display_name));
    set('nameby', '');
  }
  if (payload.phone !== undefined) set('phone', str_(payload.phone).slice(0, 40));
  if (payload.phones !== undefined) {
    var phoneList = profileCleanPhones_(payload.phones);
    set('phones', JSON.stringify(phoneList));
    // keep the single-phone column truthful for everything that reads it
    if (payload.phone === undefined) set('phone', phoneList.length ? phoneList[0].number : '');
  }
  if (payload.emails !== undefined) set('emails', JSON.stringify(profileCleanEmails_(payload.emails)));
  if (payload.avatar !== undefined) set('avatar', str_(payload.avatar).slice(0, 500));
}

/**
 * Uploads folder, resolved BY ID through Files.gs, so renaming or moving the
 * tree in Drive is safe. The name lookup is only the pre-Files.gs fallback —
 * it silently picks the FIRST folder with that name.
 */
function hubUploadsFolder_() {
  if (typeof filesUploadsFolder_ === 'function') return filesUploadsFolder_();
  var it = DriveApp.getFoldersByName(UPLOADS_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(UPLOADS_FOLDER);
}

/**
 * PRIVATE DATA — redacted at the only place it enters, so nothing downstream
 * has to remember to. Bank account and routing numbers are dropped; the SSN
 * is dropped too (hubRedactAnswer_) and survives only as a salted
 * FINGERPRINT, because empdbFindRow_ joins on it and that strong key is what
 * lets it REFUSE when two rows fit instead of name-matching a stranger.
 * Measured : 180 of 192 mirrored rows carried a full SSN.
 */
var HUB_PII_SALT_PROP = 'HUB_PII_SALT';

/**
 * ▶ RUN ONCE, from the editor — deliberately the only door: a web-callable
 * setter would be an unauthenticated way to write secrets on an
 * ANYONE_ANONYMOUS web app. It generates the value itself and never returns
 * it, so the salt never lands in a chat, a commit or a terminal history.
 * ONE SHOT: if a salt exists it refuses — replacing it silently orphans every
 * fingerprint already written.
 */
function runCreatePiiSalt() {
  var have = String(hubProp_(HUB_PII_SALT_PROP) || '');
  if (have) {
    var msg = { created: false, why: 'a salt already exists (' + have.length + ' chars) — ' +
                'replacing it would orphan every fingerprint already written' };
    Logger.log(JSON.stringify(msg, null, 2));
    return msg;
  }
  // NOT Math.random() — it is not a random source and would make the
  // fingerprints guessable.
  var bytes = [];
  for (var i = 0; i < 4; i++) bytes = bytes.concat(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + ':' + new Date().getTime() + ':' + i, Utilities.Charset.UTF_8));
  var salt = Utilities.base64Encode(bytes).replace(/[^A-Za-z0-9]/g, '').slice(0, 44);
  hubPropSet_(HUB_PII_SALT_PROP, salt);
  hubSysLog_('asa-hub:bootstrap', 'pii_salt_created', salt.length + ' chars', { status: 200 });
  var out = { created: true, length: salt.length,
              note: 'The value is deliberately not returned. Nothing needs to read it.' };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** Nine digits, or ''. Accepts 123-45-6789, 123456789, and the mask. */
function hubSsnDigits_(v) {
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length === 9 ? d : '';
}

/**
 * The salt, created on first use UNDER A LOCK — this account runs ~30
 * executions at once and two different salts would silently orphan whichever
 * fingerprints were written first. WITHOUT A SALT THIS IS NOT PRIVACY (nine
 * digits brute-forces in seconds), so no salt = no fingerprint = the caller
 * degrades to the weak key. Returns '' rather than making a click wait.
 */
function hubPiiSalt_() {
  var salt = String(hubProp_(HUB_PII_SALT_PROP) || '');
  if (salt.length >= 16) return salt;

  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (eL) { lock = null; }
  if (!lock || !lock.tryLock(5000)) return '';
  try {
    // Re-read INSIDE the lock: another execution may have created it between
    // the read above and the lock being granted.
    salt = String(hubProp_(HUB_PII_SALT_PROP) || '');
    if (salt.length >= 16) return salt;
    var bytes = [];
    for (var i = 0; i < 4; i++) {
      bytes = bytes.concat(Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        Utilities.getUuid() + ':' + new Date().getTime() + ':' + i, Utilities.Charset.UTF_8));
    }
    salt = Utilities.base64Encode(bytes).replace(/[^A-Za-z0-9]/g, '').slice(0, 44);
    hubPropSet_(HUB_PII_SALT_PROP, salt);
    // The fact, never the value.
    try { hubSysLog_('asa-hub:bootstrap', 'pii_salt_created', salt.length + ' chars', { status: 200 }); }
    catch (eLog) { /* the salt exists either way */ }
    return salt;
  } catch (e2) {
    return '';
  } finally {
    try { lock.releaseLock(); } catch (e3) { /* released when the execution ends */ }
  }
}

/** Stable salted fingerprint of an SSN — '' when there is no usable salt. */
function hubSsnFingerprint_(v) {
  var d = hubSsnDigits_(v);
  if (!d) return '';
  var salt = hubPiiSalt_();
  if (salt.length < 16) return '';
  try {
    return Utilities.base64Encode(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, salt + ':' + d, Utilities.Charset.UTF_8)).slice(0, 22);
  } catch (e2) { return ''; }
}

/** •••-••-1234 — '' when the value is not an SSN at all. */
function hubSsnMask_(v) {
  var d = hubSsnDigits_(v);
  return d ? '•••-••-' + d.slice(-4) : '';
}

/** Phone DISPLAY: +13309197779. Non-US/short/garbage passes through. Never for sheet writes. */
function hubPhoneE164_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return s;
  var digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return s;
}

/** Bank account or routing number? Key first, then shape — a field named
 *  "caixa de texto NN" gives nothing away, so the value must convict alone. */
function hubIsBankField_(key, value) {
  var k = String(key || '').toLowerCase();
  if (/account.*number|number.*account|routing|aba number|bank account/.test(k)) return true;
  // A bare 8-17 digit run in a field whose name mentions a bank.
  if (/bank/.test(k) && /^\d{8,17}$/.test(String(value || '').replace(/\D/g, ''))) return true;
  return false;
}

/**
 * Is THIS answer, for certain, the SSN? DELIBERATELY STRICTER THAN THE
 * REDACTOR: dropping a non-SSN costs a ZIP+4 nobody reads, but fingerprinting
 * one turns empdbFindRow_'s strong key into an ABA routing number — identical
 * for everybody at the same bank, so it matches the WRONG person and says it
 * is sure. Shape convicts only in the SSN's own 3-2-4 grouping; bare nine
 * digits convict only when the field name says what they are.
 */
function hubIsSsnAnswer_(key, value) {
  var v = String(value == null ? '' : value).trim();
  var k = String(key || '').toLowerCase();
  if (hubIsBankField_(key, v)) return false;
  if (/zip|postal|routing|aba/.test(k)) return false;
  if (/^\d{3}-\d{2}-\d{4}$/.test(v)) return true;
  return /(^|[^a-z])ssn([^a-z]|$)|social security/.test(k) && !!hubSsnDigits_(v);
}

/** Redact ONE form answer — the value to keep, or null to drop the field. */
function hubRedactAnswer_(key, value) {
  var v = String(value == null ? '' : value);
  if (hubIsBankField_(key, v)) return null;
  var k = String(key || '').toLowerCase();
  // GREEDY ON PURPOSE — see hubIsSsnAnswer_ for why this one is not that one.
  // 'Textbox1' alone held 171 SSNs under a name that says nothing, so bare
  // nine digits under ANY key is dropped.
  var looksSsn = /^\d{3}-?\d{2}-?\d{4}$/.test(v.trim());
  var namedSsn = /(^|[^a-z])ssn([^a-z]|$)|social security/.test(k);
  // NOT COLLECTED AT ALL — dropped, not even masked. The only thing that needed it was the
  // join, which hubSsnFingerprint_ carries instead; the number stays in
  // Dropbox Sign and the estate's Master, its systems of record.
  if (looksSsn || (namedSsn && hubSsnDigits_(v))) return null;
  return v;
}
/**
 * The uploader becomes a viewer of their OWN file, and nobody else. These
 * files are admin-only, but obPacketUpload hands the URL
 * back to the NEW HIRE and three portal screens render it as a link. No
 * Google account = the add fails — and that refusal is
 * WRITTEN DOWN (hubGrantReader_) instead of returning a `false` every caller
 * drops: the person is holding a link that opens nothing, and somebody has
 * to be able to find out why. `outcome`, when passed, is filled with the
 * same facts so the door that hands out the URL can act on them.
 */
function hubShareWithUploader_(file, user, outcome) {
  var who = String((user && user.email) || '').trim();
  if (!who || who.indexOf('@') === -1) {
    // NOT A FAILURE, AND DELIBERATELY NOT LOGGED: three doors store a file
    // with no user at all (the referral probe, the signed packet). There is
    // nobody to let in, so there is nothing to report.
    if (outcome) { outcome.ok = false; outcome.skipped = true; outcome.reason = 'no address to grant'; }
    return false;
  }
  return hubGrantReader_(file, who, outcome);
}

/** Three tries, then the refusal is believed. The second and third exist only
 *  for the refusals Drive takes back on its own — a rate limit, a backend
 *  error — and cost nothing on the day the first one works. */
var HUB_SHARE_ATTEMPTS = 3;
var HUB_SHARE_RETRY_MS = 800;

/**
 * A READER, GRANTED IN SILENCE. DriveApp.addViewer makes Google
 * e-mail the person "shared a file with you: <name>" — and under test mode
 * that letter reached four admins who are not testers, outside every sink
 * this platform has, because Google sends it, not us. The Drive REST call
 * carries the switch DriveApp hides; the access is the same.
 *
 * SILENT TO GOOGLE, NOT SILENT TO US. Going back to addViewer
 * would put that letter back in four real inboxes, so this REST call stays
 * the only door on the platform — which made its own silence the problem:
 * every candidate upload, every task attachment and every recruitment PDF
 * runs through here, and a single 4xx meant the new hire held a link that
 * opened nothing, hubShareWithAdmins_ counted zero, and the only trace was a
 * `false` that all three call sites discard. So:
 *
 *   · a refusal Drive takes back on its own (rate limit, backend error, a
 *     call that never landed) is RETRIED before it is believed;
 *   · a refusal that stands is written to the system log naming WHO was not
 *     let in, WHICH file, and WHAT Google said — nothing here is recoverable
 *     by the caller, so the fix is a human granting the seat, and that human
 *     needs the address and the file id;
 *   · `outcome`, when passed, carries those same facts back to the caller.
 *
 * The access itself is unchanged, and so is the rule: the loud door — the
 * one that mails the person — is still not a fallback.
 */
/**
 * AND THE SWITCH REACHES THIS DOOR TOO, WHEN IT IS ASKED TO.
 *
 * Drive access cannot be un-granted by turning a switch back off, which is
 * exactly why this door needed a switch of its own: a rehearsal of an upload
 * lane used to hand real administrators a real document — the signed
 * application PDF among them, carrying an SSN — and nothing was written
 * anywhere to say it had happened.
 *
 * The gate `gate_drive_grant_reader` (SmartGate.gs) ARRIVES OFF, so this
 * function behaves as it did before the gate existed. Armed on the Desk, it holds whenever
 * the lane is holding, writes the row naming who would have been let in to
 * what, and answers `false` — the answer every one of the three call sites
 * already handles as "the seat was not granted". A situations tab that cannot
 * be read holds it too while the lane holds: nobody can say it is not armed.
 */
function hubGrantReader_(file, who, outcome) {
  var out = outcome || {};
  out.ok = false;
  out.email = String(who || '');
  out.code = 0;
  out.reason = '';
  out.attempts = 0;
  out.file_id = '';
  if (typeof hubGateHolds_ === 'function') {
    var fid = '';
    try { fid = String(file && file.getId ? file.getId() : ''); } catch (eI) { fid = ''; }
    var gate = hubGateHolds_('gate_drive_grant_reader', {
      to: String(who || ''), to_name: String(who || ''),
      subject: 'reader access on ' + (fid || 'a file'),
      body: 'reader access on file ' + (fid || 'unknown') + ' for ' + String(who || ''),
      purpose: 'a Drive grant this platform gated'
    });
    if (gate.held) {
      out.file_id = fid;
      out.reason = gate.why;
      out.held = true;
      return false;
    }
  }
  out.file_name = '';
  try { out.file_id = String(file.getId()); } catch (e0) {
    out.reason = 'the file could not be identified — ' + String((e0 && e0.message) || e0);
    hubShareRefused_(out);
    return false;
  }
  // Only for the log line: a file id is what a human needs, a name is what
  // they recognise. Never worth failing the grant over.
  try { out.file_name = String(file.getName()); } catch (eN) { out.file_name = ''; }

  var url = 'https://www.googleapis.com/drive/v3/files/' + out.file_id +
    '/permissions?sendNotificationEmail=false&supportsAllDrives=true';
  for (var attempt = 1; attempt <= HUB_SHARE_ATTEMPTS; attempt++) {
    out.attempts = attempt;
    var code = 0, body = '';
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ role: 'reader', type: 'user', emailAddress: who }),
        muteHttpExceptions: true
      });
      code = res.getResponseCode();
      body = String(res.getContentText() || '');
    } catch (e) {
      // The call never landed at all — a timeout or a DNS blip reads exactly
      // like a refusal from here, and it is the most retriable one there is.
      code = 0;
      body = String((e && e.message) || e);
    }
    out.code = code;
    if (code >= 200 && code < 300) { out.ok = true; return true; }
    out.reason = hubShareRefusalReason_(code, body);
    if (attempt >= HUB_SHARE_ATTEMPTS || !hubShareRefusalIsTransient_(code, body)) break;
    Utilities.sleep(HUB_SHARE_RETRY_MS * attempt);
  }
  hubShareRefused_(out);
  return false;
}

/** What Drive actually said, in a sentence a person can act on. */
function hubShareRefusalReason_(code, body) {
  var b = String(body || '');
  var msg = '';
  try {
    var j = JSON.parse(b);
    msg = String((j && j.error && (j.error.message ||
      (j.error.errors && j.error.errors[0] && j.error.errors[0].message))) || '');
  } catch (eP) { msg = ''; }
  if (!msg) msg = b.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (code === 0) return 'the call to Drive never landed — ' + (msg || 'no answer');
  // THE ONE REFUSAL THAT IS NOBODY'S OUTAGE, said plainly so the row does not
  // read like a breakage: Drive will not seat an address with no Google
  // account unless it may send its own letter, and that letter is the exact
  // thing this door exists to prevent.
  if (code === 400 && /no Google account|invalidSharingRequest/i.test(b)) {
    return 'HTTP 400 — that address has no Google account, and Drive will only seat ' +
           'one of those by sending its own "shared with you" letter';
  }
  return 'HTTP ' + code + (msg ? ' — ' + msg : '');
}

/** Is this refusal one Drive takes back on its own? */
function hubShareRefusalIsTransient_(code, body) {
  if (code === 0 || code === 429 || code >= 500) return true;
  // Drive spends its rate limits through 403 as well as 429.
  return code === 403 &&
    /rateLimit|userRateLimit|sharingRateLimit|backendError|internalError/i.test(String(body || ''));
}

/** The refusal, in the feed the admins already read. */
function hubShareRefused_(out) {
  try {
    var where = out.file_name
      ? '"' + out.file_name + '" (' + (out.file_id || 'no id') + ')'
      : (out.file_id || 'an unidentified file');
    hubSysLog_('asa-hub:drive', 'drive_share_failed',
               (out.email || 'nobody') + ' was NOT granted a reader seat on ' + where +
               ' — ' + (out.reason || 'no reason given') +
               (out.attempts > 1 ? ' (after ' + out.attempts + ' attempts)' : '') +
               '. The file is intact and the platform account still owns it; ' +
               'the seat has to be granted by hand in Drive.',
               { status: out.code >= 400 ? out.code : 500 });
  } catch (eL) { /* the grant already failed; the log must not take the lane down too */ }
}

/** Base64 payload → file in the uploads folder (max 15MB), shared with the
 *  admins and the uploader. Returns { id, url, shared } — `shared` says who
 *  was ACTUALLY let in, so a door that hands the URL back to a person can
 *  see, before it promises them a link, that the link opens for them. */
function hubDriveFileObj_(payload, defaultName, forceMime, user) {
  var b64 = String(payload.base64 || '');
  if (!b64) throw new Error('missing base64');
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('file empty or over 15MB');
  var name = str_(payload.filename) || defaultName;
  var mime = forceMime || str_(payload.mime_type) || 'application/octet-stream';
  var file = hubUploadsFolder_().createFile(Utilities.newBlob(bytes, mime, name));
  var toAdmins = hubShareWithAdmins_(file);
  var toUploader = {};
  hubShareWithUploader_(file, user, toUploader);
  var id = file.getId();
  return { id: id, url: 'https://drive.google.com/file/d/' + id + '/view', shared: {
    admins: toAdmins.shared, admins_total: toAdmins.total, admins_failed: toAdmins.failed,
    admins_held_why: String(toAdmins.held_why || ''),
    uploader: !!toUploader.ok, uploader_skipped: !!toUploader.skipped, uploader_held: !!toUploader.held,
    why: toUploader.ok ? '' : String(toUploader.reason || '')
  } };
}

/* ========================================================================
 * THE ASSET SPINE
 *
 * Twenty-one doors in this platform receive a file and put it in Drive, and
 * each one decodes, names, caps, files and shares it its own way. Not one
 * computes a content hash, so the same CPR card arriving through three lanes
 * becomes three unrelated rows with three verdicts, and no decision made
 * about a document can ever cite the exact bytes it was made about.
 *
 * This is a spine, not a rewrite. It owns FOUR things and refuses the rest:
 *
 *   1. write the bytes ONCE
 *   2. hash them
 *   3. mint a stable asset identity
 *   4. answer every caller with the same contract
 *
 * It NEVER resolves a folder, never names a file, never caps a size and
 * never decides sharing — those are five different numbers and a dozen
 * conventions ON PURPOSE, and each belongs to the door that has to live with
 * it. A door adopting the spine changes where its identity comes from and
 * nothing about where its bytes land.
 *
 * IDENTITY IS ALWAYS PRESENT AND NEVER LIES. When the bytes are hashed the
 * id is content-addressed, so the same paper through two doors carries one
 * id. When hashing is refused — a very large file, an engine that will not
 * do it — the id is MINTED instead and says so in `id_source`. An asset with
 * no identity is the thing the whole brief exists to prevent; an id that
 * claims to be a hash and is not would be worse.
 * ======================================================================== */

/** Byte[] → lowercase hex. Apps Script hands back SIGNED bytes. */
function hubHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i] & 0xFF;
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}

/** Above this many bytes the digest is not attempted: SHA-256 over a 30MB
 *  Byte[] is not exercised anywhere in this platform, and an upload must
 *  never fail because identity was expensive. Honest about it either way. */
var HUB_ASSET_HASH_MAX_BYTES = 12 * 1024 * 1024;

/**
 * hubAssetPut_(bytes, name, mime, folder, opts)
 *
 *   bytes   Byte[] — ALREADY decoded and ALREADY capped by the door
 *   name    String — the stored Drive name the door already computed
 *   mime    String — the mime the door already resolved
 *   folder  Folder — the door's own folder; the spine never resolves one
 *   opts    { reuse_by: 'name'|'none', share: function (file) {} }
 *
 * → { asset_id, id_source, sha256, hash_note, file_id, file_url, file_name,
 *     mime_type, size_bytes, folder_id, reused }
 */
function hubAssetPut_(bytes, name, mime, folder, opts) {
  var o = opts || {};
  if (!bytes || !bytes.length) throw new Error('no bytes to store');
  if (!folder) throw new Error('the door must resolve its own folder');
  var storedName = String(name || 'file');
  var mimeType = String(mime || 'application/octet-stream');

  /* THE SAME UPLOAD TWICE IS ONE FILE. The door decides whether its naming is
     deterministic enough for this — FormFiles' upload_id is, a timestamped
     name is not — so reuse is opt-in and by the door's own name. */
  var reused = null;
  if (String(o.reuse_by || 'none') === 'name') {
    try {
      var already = folder.getFilesByName(storedName);
      if (already.hasNext()) reused = already.next();
    } catch (eR) { reused = null; }
  }

  var sha = '';
  var note = '';
  if (bytes.length > HUB_ASSET_HASH_MAX_BYTES) {
    note = 'over ' + Math.round(HUB_ASSET_HASH_MAX_BYTES / 1048576) + 'MB — not hashed';
  } else {
    try {
      sha = hubHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
    } catch (eH) {
      note = 'digest refused: ' + String(eH && eH.message || eH).slice(0, 80);
    }
  }

  var file = reused || folder.createFile(Utilities.newBlob(bytes, mimeType, storedName));
  if (!reused && typeof o.share === 'function') {
    try { o.share(file); } catch (eS) { /* sharing is the door's, and never fatal */ }
  }
  var id = file.getId();
  var assetId = sha ? ('AST_' + sha.slice(0, 32)) : ('AST_u' + id.slice(0, 24));
  /* THE IDENTITY RIDES ON THE FILE, NOT ON THE ANSWER. A form posts its
     handles back through the browser, so an identity carried that way would
     be whatever the page said it was. Drive's own description is written
     here, server-side, and read back at submit — the same fact, out of
     reach of the page that sent it. It also survives a rename and a move,
     which is the whole point of a stable asset id. */
  try {
    file.setDescription('asset:' + assetId + (sha ? ' sha256:' + sha : '') +
                        ' at:' + new Date().toISOString());
  } catch (eD) { /* a description that will not write costs nothing else */ }
  return {
    asset_id: assetId,
    id_source: sha ? 'content' : 'minted',
    sha256: sha,
    hash_note: note,
    file_id: id,
    file_url: 'https://drive.google.com/file/d/' + id + '/view',
    file_name: file.getName(),
    mime_type: mimeType,
    size_bytes: bytes.length,
    folder_id: (function () { try { return folder.getId(); } catch (eF) { return ''; } })(),
    reused: !!reused
  };
}

/**
 * The identity the spine stamped on a file, read back — or {} when the file
 * was not captured through the spine. Never throws: an unreadable
 * description means we simply do not know, which is a fact of its own.
 */
function hubAssetOf_(file) {
  var d = '';
  try { d = String(file.getDescription() || ''); } catch (e) { return {}; }
  var a = /asset:(AST_[A-Za-z0-9_]+)/.exec(d);
  var h = /sha256:([0-9a-f]{64})/.exec(d);
  if (!a && !h) return {};
  return { asset_id: a ? a[1] : '', sha256: h ? h[1] : '' };
}

/* ========================================================================
 * THE WORDS BOOK, FOR EVERYBODY
 *
 * The decoder's vocabulary moved out of code on 09-09 and the platform has
 * been better for it: a wrong word is a row somebody edits, live, instead of
 * a deploy. The same is true of every other list that GROWS — the statuses a
 * contact may wear, the roles, the mailboxes that are an office rather than a
 * person, the letters Smart Comms sends.
 *
 * FOUR LAWS, and they are the digest's, unchanged:
 *   1. the code keeps the FLOOR — an unreadable book never means an empty
 *      list, it means the compiled table answers and the log says so;
 *   2. a bad row is skipped and COUNTED, never guessed at;
 *   3. what was read rides with the answer, so a verdict can be judged;
 *   4. read once per execution, and cached ten minutes beyond that.
 * ======================================================================== */

var HUB_BOOK_CACHE_S = 600;
var HUB_BOOK_MEMO = {};

/** A tab of the words book as objects, or [] — never a throw. */
function hubBookRows_(tabName) {
  var key = String(tabName || '');
  if (!key) return [];
  if (Object.prototype.hasOwnProperty.call(HUB_BOOK_MEMO, key)) return HUB_BOOK_MEMO[key];
  var out = [];
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eC) { cache = null; }
  if (cache) {
    try {
      var hit = cache.get('hub_book_' + key);
      if (hit) { out = JSON.parse(hit); HUB_BOOK_MEMO[key] = out; return out; }
    } catch (eH) { /* a cache that cannot answer just means we read the book */ }
  }
  try {
    var id = String(hubId_('HUB_GENERIC_CONFIG_ID') || '');
    if (!id) { HUB_BOOK_MEMO[key] = []; return []; }
    var sh = ssOpen_(id).getSheetByName(key);
    if (!sh) { HUB_BOOK_MEMO[key] = []; return []; }
    var values = sh.getDataRange().getValues();
    if (values.length < 2) { HUB_BOOK_MEMO[key] = []; return []; }
    var head = values[0].map(function (h) {
      return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    });
    for (var r = 1; r < values.length; r++) {
      var row = {}, any = false;
      for (var c = 0; c < head.length; c++) {
        if (!head[c]) continue;
        var cell = values[r][c];
        row[head[c]] = (cell === null || cell === undefined) ? '' : cell;
        if (String(cell || '').trim()) any = true;
      }
      if (any) out.push(row);
    }
  } catch (e) { out = []; }
  if (cache) {
    try { cache.put('hub_book_' + key, JSON.stringify(out), HUB_BOOK_CACHE_S); }
    catch (eP) { /* re-read next execution */ }
  }
  HUB_BOOK_MEMO[key] = out;
  return out;
}

/** 'on' unless a row says otherwise — the same word the digest tabs use. */
function hubBookOn_(row) {
  var a = String((row && (row.active !== undefined ? row.active : row.enabled)) || 'on')
    .trim().toLowerCase();
  return a !== 'off' && a !== 'false' && a !== 'no' && a !== '0';
}

/**
 * A LIST OF WORDS FROM ONE COLUMN, or the code's own list.
 * `floor` is what ships compiled in; it answers whenever the book is silent,
 * and the caller never has to think about an empty vocabulary.
 */
function hubBookList_(tabName, column, floor) {
  var rows = hubBookRows_(tabName);
  var out = [], bad = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!hubBookOn_(rows[i])) continue;
    var w = String(rows[i][column] || '').trim();
    if (w) out.push(w.toLowerCase()); else bad++;
  }
  if (!out.length) return floor || [];
  if (bad) {
    try {
      hubSysLog_('asa-hub:book', 'book_bad_rows',
                 tabName + ' — ' + bad + ' row(s) skipped: the "' + column +
                 '" cell was empty', { status: 200 });
    } catch (eL) { /* the list still answers */ }
  }
  return out;
}

/**
 * A LIST OF ROWS FROM THE BOOK, MERGED OVER THE CODE'S OWN.
 *
 * Some lists are not words but records — a letter with its channels and its
 * recipients, a model request, a situation with its wording. The book may
 * CHANGE one (same id, new cells) and may ADD one (an id the code never had),
 * and what it does not mention keeps exactly what shipped. An id is required:
 * a row that names nothing cannot be merged with anything, so it is skipped
 * and counted rather than appended as an anonymous twin.
 */
function hubBookMerge_(tabName, seed, idKey) {
  var key = String(idKey || 'id');
  var rows = hubBookRows_(tabName);
  if (!rows.length) return seed || [];
  var out = [], at = {}, bad = 0;
  for (var i = 0; i < (seed || []).length; i++) {
    var copy = {};
    for (var k in seed[i]) {
      if (Object.prototype.hasOwnProperty.call(seed[i], k)) copy[k] = seed[i][k];
    }
    at[String(copy[key])] = out.length;
    out.push(copy);
  }
  for (var r = 0; r < rows.length; r++) {
    if (!hubBookOn_(rows[r])) {
      /* switching a row off REMOVES it — that is what off means for a record */
      var gone = String(rows[r][key] || '').trim();
      if (gone && at[gone] !== undefined) out[at[gone]] = null;
      continue;
    }
    var id = String(rows[r][key] || '').trim();
    if (!id) { bad++; continue; }
    var row = {};
    for (var c in rows[r]) {
      if (!Object.prototype.hasOwnProperty.call(rows[r], c)) continue;
      if (c === 'active' || c === 'notes') continue;
      var v = rows[r][c];
      /* AN EMPTY CELL IS NOT AN ERASURE. A book row names what it changes;
         everything it leaves blank keeps what the code shipped. */
      if (String(v === null || v === undefined ? '' : v).trim() === '') continue;
      row[c] = v;
    }
    if (at[id] !== undefined && out[at[id]]) {
      for (var f in row) {
        if (Object.prototype.hasOwnProperty.call(row, f)) out[at[id]][f] = row[f];
      }
    } else {
      row[key] = id;
      at[id] = out.length;
      out.push(row);
    }
  }
  var live = [];
  for (var o = 0; o < out.length; o++) if (out[o]) live.push(out[o]);
  if (bad) {
    try {
      hubSysLog_('asa-hub:book', 'book_bad_rows',
                 tabName + ' — ' + bad + ' row(s) skipped: no "' + key + '"',
                 { status: 200 });
    } catch (eL) { /* the list still answers */ }
  }
  return live;
}

/** One remembered piece of text, or the code's own. */
function hubBookText_(tabName, key, floor) {
  var rows = hubBookRows_(tabName);
  for (var i = 0; i < rows.length; i++) {
    if (!hubBookOn_(rows[i])) continue;
    if (String(rows[i].key || '').trim() !== String(key)) continue;
    var v = String(rows[i].value === null || rows[i].value === undefined
                   ? '' : rows[i].value);
    if (v.trim()) return v;
  }
  return floor;
}

/**
 * ADMINS ONLY. This was an unconditional
 * setSharing(ANYONE_WITH_LINK) for every file the six upload paths create —
 * signed packet, CJIS report, three résumé lanes, the PUBLIC referral form —
 * and the CJIS URL is persisted and mirrored, not ephemeral.
 * IT FAILS CLOSED: unreadable users tab or no usable admin = the file stays
 * private, never a link anyone can open.
 */
var HUB_ADMIN_VIEWERS_KEY = 'hub_admin_viewers_v1';

/** Admin addresses from the users tab, cached 10 min. A read failure yields
 *  [] on purpose — the caller then keeps the file private. */
function hubAdminEmails_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(HUB_ADMIN_VIEWERS_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) { cache = null; }
  var out = [];
  try {
    var values = hubSheet_(USERS_TAB).getDataRange().getValues();
    var hdr = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var iRole = hdr.indexOf('role'), iMail = hdr.indexOf('email');
    if (iRole !== -1 && iMail !== -1) {
      for (var r = 1; r < values.length; r++) {
        if (String(values[r][iRole] || '').trim().toLowerCase() !== 'admin') continue;
        var mail = String(values[r][iMail] || '').trim();
        if (mail && mail.indexOf('@') !== -1 && out.indexOf(mail) === -1) out.push(mail);
      }
    }
  } catch (e2) { out = []; }
  try { if (cache) cache.put(HUB_ADMIN_VIEWERS_KEY, JSON.stringify(out), 600); } catch (e3) { /* uncached */ }
  return out;
}

/** Add every admin as a viewer; logs and leaves the file private when none
 *  can be added. Returns { shared, total, failed } — a caller that promises
 *  somebody the file can tell an empty count from a full one. */
function hubShareWithAdmins_(file) {
  var admins = hubAdminEmails_();
  if (!admins.length) {
    hubSysLog_('asa-hub:drive', 'upload_private_no_admins',
               'no admin address resolved — the file stays private', { status: 200 });
    return { shared: 0, total: 0, failed: [] };
  }
  var shared = 0, failed = [], heldWhy = '';
  for (var i = 0; i < admins.length; i++) {
    // One address that cannot be added must not cost the others their access —
    // and each one that fails says so on its own row (hubGrantReader_), so a
    // partial count can still be read back to the address that caused it.
    var said = {};
    if (hubGrantReader_(file, admins[i], said)) shared++;
    else {
      failed.push(admins[i]);
      // a grant the gate held has its row in the mock outbox, not a drive_share_failed row
      if (said.held) heldWhy = String(said.reason || 'held by its gate');
    }
  }
  if (!shared) {
    // The count that used to be the ONLY sign anything went wrong. It stays,
    // because it means something the per-address rows do not: this file is now
    // visible to nobody at all but the platform account.
    hubSysLog_('asa-hub:drive', 'upload_private_share_failed',
               admins.length + ' admin(s) known, none could be added — the file is ' +
               'readable by nobody but the platform account; ' +
               (heldWhy ? 'the grants were HELD, each with its row in the mock outbox: ' + heldWhy
                        : 'each address has its own drive_share_failed row with the reason'),
               { status: 500 });
  }
  return { shared: shared, total: admins.length, failed: failed, held_why: heldWhy };
}

/** hubDriveFileObj_, URL only. */
function hubDriveFile_(payload, defaultName, forceMime, user) {
  return hubDriveFileObj_(payload, defaultName, forceMime, user).url;
}

/** A cell must hold DATA, never a live formula: a string leading with
 *  = + - or @ becomes executable in Sheets and the referral form is a PUBLIC
 *  door. The apostrophe stores it as text; getValues()
 *  returns the string without it. */
function hubCellSafe_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

/**
 * Make sure a column EXISTS before anything writes it: hubAppendRow_ matches
 * by header and silently drops what it cannot place (that is how `source` was
 * lost). Additive only — a column is appended, never moved, renamed, removed.
 */
function hubEnsureColumns_(tabName, names) {
  // A dissolved tab has no columns to widen: a fact carries its own name.
  if (typeof hiringTabDissolved_ === 'function' && hiringTabDissolved_(tabName)) return names;
  var sheet = hubSheet_(tabName);
  var hdr = headerOf_(sheet);
  var added = false;
  for (var i = 0; i < names.length; i++) {
    if (hdr.indexOf(names[i]) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(names[i]);
      hdr.push(names[i]);
      added = true;
    }
  }
  if (added) SpreadsheetApp.flush();
  return hdr;
}

/** Header-matched append into a Hub tab (row dict keyed by EXACT header). */
function hubAppendRow_(tabName, vals) {
  if (typeof hiringTabDissolved_ === 'function' && hiringTabDissolved_(tabName)) {
    var norm = {};
    for (var vk in vals) norm[String(vk).replace(/[^A-Za-z0-9]+/g, '').toLowerCase()] = vals[vk];
    var sub = hiringRowKey_(tabName, norm);
    if (sub && hiringLegacyWrite_(tabName, sub, vals, 'append')) return;
  }
  var sheet = hubSheet_(tabName);
  var hdr = headerOf_(sheet);
  sheet.appendRow(hdr.map(function (h) { return vals[h] !== undefined ? hubCellSafe_(vals[h]) : ''; }));
}

/** Drop the cached talent slice. */
function hubBustTalentCache_() {
  var c = CacheService.getScriptCache();
  c.remove(TALENT_CACHE_KEY);
  // Its answer is cached too — every trip to Apps Script costs five seconds before it reads a row — so
  // the one bust every write already calls has to drop both, or somebody
  // archived would keep showing on the board for ten minutes.
  try { if (typeof TALENT_ARCHIVE_CACHE_KEY !== 'undefined') c.remove(TALENT_ARCHIVE_CACHE_KEY); }
  catch (e) { /* the slice is dropped either way */ }
}

/**
 * The identity a candidate card cannot be opened without — and THE E-MAIL IS
 * NOT PART OF IT. The address is WANTED, never
 * demanded: people are typed in off a phone call, and refusing the card for a
 * missing e-mail loses the person, not the address.
 *
 * When one IS typed it still has to look like an address. A typo'd e-mail is
 * worse than a blank one — every letter to it is composed, sent, accepted by
 * nobody and never comes back.
 *
 * THE FAST LANE IS NOT RELAXED: referralFastLaneCheck_ (Referrals.gs) still
 * demands a real e-mail, because it skips four stages on the strength of what
 * was typed. A card with no e-mail simply lands at New and its
 * placement_reasons say exactly why it did not jump.
 *
 * Both doors that mint a row — hubIntake here and resumeIntakeCommit in
 * ResumeIntake.gs — ask this one function, so the rule cannot drift into two.
 *
 * While the e-mail was mandatory it was also the
 * thing that made a card findable: hubFindDuplicate_ matches on digits OR
 * address, and each arm short-circuits on an empty value. A card with 'n/a'
 * for a phone and nothing for an e-mail therefore matches NOTHING — the
 * duplicate door answers "no duplicate" without ever comparing, and the same
 * call mints another row every time it is made. Refusing the shape is what
 * keeps the person findable now that the address is optional.
 */
function hubIntakeIdentityCheck_(first, last, phone, email) {
  if (!first || !last || !phone) {
    return { ok: false, message: 'First name, last name and phone are all required.' };
  }
  if (phone.replace(/\D/g, '').length < 7) {
    return { ok: false, message: 'The phone needs at least 7 digits.' };
  }
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, message: 'The e-mail does not look like an address.' };
  }
  return { ok: true, message: '' };
}

/**
 * The resolver's routing table — action → how a request must travel. The
 * machinery is in Resolver.gs; the DECLARATION lives here because Apps Script
 * runs files in order and every module extends it with `HUB_POLICY.x = {...}`.
 * Declared in a file that loads later, the first extender throws at load and
 * every request gets Google's error page.
 * push_apps_script.py:assert_load_order refuses a file set that would.
 */
var HUB_POLICY = {};

// These eleven handlers are members of the HUB_ACTIONS literal below, so their
// declarations cannot sit above each one; they are grouped here in that order.

// lane: write — one card created, its id returned; no row loop to watch.
HUB_POLICY.hubIntake = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates', 'phoneScreens', 'onboarding'], emits: []
};

HUB_POLICY.resumeUpload = {
  file: 'HubCore.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};

HUB_POLICY.cjisUpload = {
  file: 'HubCore.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: ['candidates'], emits: []
};

HUB_POLICY.syncFromLegacy = {
  file: 'HubCore.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['candidates', 'phoneScreens'], emits: []
};

HUB_POLICY.usersList = {
  file: 'HubCore.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // manager is in the door only for the HM badge — the action body checks
  // the badge itself, a special release for house managers. Every WRITE
  // below stays admin.
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};

// lane: write — appends the account row and answers with the new id.
HUB_POLICY.userCreate = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};

HUB_POLICY.userDelete = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};

HUB_POLICY.usersArm = {
  file: 'HubCore.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};

HUB_POLICY.userUpdate = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};

HUB_POLICY.setDecision = {
  // 'tool' AND NOT 'write' IS THE TIER, DECLARED — hiringDiscard's reason,
  // and the reason Accept on the phone screen looked dead: the PRODUCT of a
  // decision is its answer (moved to Interview, declined, or refused and why).
  // On the write tier the relay's ledger answered the browser {accepted:true}
  // after eight seconds, the screen said "recorded", and the backend's refusal
  // was buried minutes later where the person who pressed never saw it.
  // Idempotent and stamped, so the tool tier's one receipt re-POST is safe.
  // Off the ledger, two presses no longer queue behind each other, so the
  // writer holds the candidate's claim (hubDecisionClaim_) instead.
  file: 'HubCore.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  // A DECISION CAN MOVE A CARD, AND A MOVE INTO ONBOARDING NOW WRITES A
  // LETTER: the new hire is told about the account
  // hubSetStatus_ mints for them. Declared here because the gate reads the
  // call graph, not the intention.
  invalidates: ['candidates', 'phoneScreens'], emits: ['emailSend']
};

HUB_POLICY.moveStage = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  // Entering onboarding mints the person's login AND sends it (Hired.gs,
 // ) — so a stage move can reach a person now, and says so.
  invalidates: ['candidates'], emits: ['emailSend']
};

var HUB_ACTIONS = {

  /** Add Candidate — creates the row in the Hub's OWN entity_candidates. */
  hubIntake: function (payload, user) {
    if (!hubIsWriter_(user)) return hubDenied_();
    var first = str_(payload.first_name), last = str_(payload.last_name);
    var phone = str_(payload.phone), email = str_(payload.email).toLowerCase();
    var identity = hubIntakeIdentityCheck_(first, last, phone, email);
    if (!identity.ok) return { status: 400, message: identity.message };
    // (The phone's shape is checked inside hubIntakeIdentityCheck_ above —
    // it used to be refused here, at this door alone, which left the resume
    // door minting cards nothing could dial or dedupe.)
    var digits = phone.replace(/\D/g, '').replace(/^1/, '');
    var dup = hubFindDuplicate_(digits, email);
    if (dup) {
      return { status: 409, message: 'A candidate with this phone or email already exists (' + dup.name + ' — ' + dup.id + ').' };
    }
    // A STAFF CONTACT DOES NOT OPEN A CARD. After the
    // duplicate check, before the row exists.
    var intakeName = (first + ' ' + last).trim();
    var guard = contactGuard_(phone, email, { name: intakeName, trusted: true });
    if (guard && guard.severity !== 'warn' && cgEnforces_('auth')) {
      if (guard.severity === 'unverified') {
        return { status: 503, message: contactGuardMessage_(guard) };
      }
      if (!cgOverrideAllowed_(user, payload)) {
        return { status: 409, message: contactGuardMessage_(guard), staff_conflict: true };
      }
      cgLogOverride_(user, payload, intakeName, guard);
    }
    // WHO SENT THEM — now written TWICE, on purpose.
    //
    // `referral_name` / `referral_phone` are the columns, and they are the future: a name in its
    // own cell can be searched, dialled and shown without parsing anything.
    //
    // The 'Referral — <who>' string inside `source` is the PAST, and it stays:
    // it is the convention the public door writes and the ONLY place the name
    // exists for the 20+ rows already in the sheet (talentReferrerFromSource_
    // reads them). Both must keep reading, so both keep being written.
    var source = str_(payload.source) || 'Direct';
    var referralName = str_(payload.referral_name);
    var referralPhone = str_(payload.referral_phone);
    // `referred_by` is the older key the referral form sends; either names the
    // same person, so a caller that knows only one of them still gets `source`.
    var referrer = str_(payload.referred_by) || referralName;
    if (/referral/i.test(source) && referrer) source = 'Referral — ' + referrer;

    // A REFERRAL MAY START AT ANY STAGE ON THE WAY UP — in some situations a
    // person has to start further along than the beginning.
    // The client OFFERS it; this decides where the card LANDS and reports it
    // back, so the screen shows the placement that happened. Hired is
    // deliberately NOT reachable — that door is finishing onboarding, never
    // typing somebody in.
    var placedAt = 'new';
    var placeReasons = [];
    var wanted = str_(payload.start_stage);
    if (wanted && wanted !== 'new') {
      if (REFERRAL_STAGE_ORDER.indexOf(wanted) === -1) {
        placeReasons = ['a stage a candidate can be inserted at — ' + REFERRAL_STAGE_ORDER.join(', ')];
      } else {
        var fast = referralFastLaneCheck_({
          source: str_(payload.source), first: first, last: last,
          phone: phone, email: email, referrer: referrer
        });
        if (fast.ok) placedAt = wanted;
        else placeReasons = fast.reasons;
      }
    }

    // The resume a referral arrives with — a file stored ahead by resumeStore
    // (so this POST stays small) or pasted text. Both end as a resume_link,
    // and a failure here costs the document, never the candidate.
    var resumeLink = str_(payload.resume_link);
    var resumeName = str_(payload.resume_filename);
    if (!resumeLink) {
      var pasted = String(payload.resume_text || '').slice(0, 20000);
      if (pasted.replace(/\s+/g, '')) {
        try {
          var rf = hubUploadsFolder_().createFile(
            'resume-' + intakeName.replace(/[^\w ]/g, '').slice(0, 40).trim() + '.txt',
            pasted, MimeType.PLAIN_TEXT);   // folder-inherited access only
          resumeLink = rf.getUrl();
          resumeName = rf.getName();
        } catch (eTxt) { resumeLink = ''; }
      }
    }

    var id = 'CAN_' + randomHex_(20).toUpperCase();
    var now = new Date().toISOString();
    // The two referral columns are minted here even for a Direct card: a header
    // that only appears the first time somebody is referred is a header half the
    // readers meet as `undefined`. talentNoNumberList and the Archive screen
    // have been reading these names since before anything wrote them.
    hubEnsureColumns_(TALENT_CANDIDATES_TAB,
                      ['source', 'resume_link', 'referral_name', 'referral_phone']);
    hubAppendRow_(TALENT_CANDIDATES_TAB, {
      candidate_id: id,
      candidate_name: intakeName,
      first_name: first,
      last_name: last,
      phone: phone,
      email: email,
      city: str_(payload.city),
      state: str_(payload.state),
      zip: str_(payload.zip),
      status: HUB_STAGE_TO_STATUS[placedAt] || 'New',
      source: source,
      referral_name: referralName,
      referral_phone: referralPhone,
      resume_link: resumeLink,
      created_at: now,
      updated_at: now,
      created_by: 'asa-hub:' + user.email
    });
    // The analysis stub is what turns "Resume" green on the checklist — the
    // same row resumeIntakeCommit writes.
    if (resumeLink) {
      hubAppendRow_(TALENT_RESUME_TAB, {
        candidate_id: id,
        summary: 'Resume on file (attached at intake) — ' + (resumeName || 'resume'),
        created_at: now, updated_at: now, created_by: 'asa-hub:' + user.email
      });
    }
    if (placedAt !== 'new') {
      // The jump is written where stage moves are read, and the skipped
      // stages get rows saying so — never a forged 'Completed'. See
      // referralScaffold_.
      hubEnsureColumns_(TALENT_CANDIDATES_TAB, ['fast_lane_at', 'fast_lane_by']);
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, id, {
        fast_lane_at: placedAt,
        fast_lane_by: str_(user.email) + ' at ' + now + (referrer ? ' — referred by ' + referrer : '')
      }, user, false);
      try { referralScaffold_({ cid: id, name: intakeName, email: email, stage: placedAt, referrer: referrer, user: user }); }
      catch (eSc) { /* the card stands; the scaffold is reported in the log */ }
      try { hubLogStatus_(id, intakeName, 'New', HUB_STAGE_TO_STATUS[placedAt] || placedAt, 'referral:direct:' + user.email); }
      catch (eLg) { /* audit only */ }
      hubSysLog_(user.email, 'intake_referral_fast_lane',
        intakeName + ' — inserted at ' + (HUB_STAGE_TO_STATUS[placedAt] || placedAt) + ' on ' +
        (referrer ? referrer + "'s" : 'a') + ' referral', { status: 200 });
    }
    // A packet attached during intake settles the card at birth. The verdict
    // rides along: a name that did not match is recorded as such, never
    // quietly accepted as clean.
    var pFile = str_(payload.packet_file_id);
    if (pFile) {
      hubSetFieldLastRow_(TALENT_CANDIDATES_TAB, id, {
        packet_waived_by: str_(user.email) + ' — attached at intake' +
          (str_(payload.packet_verdict) === 'match' ? ' (name verified)' :
           str_(payload.packet_verdict) === 'mismatch' ? ' (NAME DID NOT MATCH the document)' : ' (document unreadable)'),
        packet_status: 'waived',
        packet_srid: 'file:' + pFile,
        packet_checked_at: now
      }, user, false);
    }
    // PHONE SCREEN ALREADY DONE, said at creation:
    // card is born at Phone Screen with the call attested. It attests the CALL
    // and nothing else — no final_result is written, so the card waits for a
    // human's Advance or Decline.
    if (String(payload.phone_screen_done) === 'true') {
      var pName = intakeName, pPhone = phone;
      ensureHeader_(hubSheet_(TALENT_PHONE_TAB),
        ['candidate_id', 'screen_status', 'manual_screen', 'screen_date', 'screened_by', 'transcript_text', 'notes']);
      hubAppendRow_(TALENT_PHONE_TAB, {
        candidate_id: id,
        screen_status: 'Completed',
        manual_screen: 'true',
        screen_date: now,
        screened_by: 'asa-hub:intake-manual-screen:' + str_(user.email),
        transcript_text: 'MANUAL PHONE SCREEN — recorded at intake by ' + str_(user.email) +
          ' on ' + now + '. The call happened before this candidate existed on the board.' +
          (str_(payload.phone_screen_note) ? '\nNote: ' + str_(payload.phone_screen_note).slice(0, 1000) : ''),
        notes: str_(payload.phone_screen_note).slice(0, 1000)
      });
      // A LATER STAGE ALWAYS WINS: the screening row is kept either way, but
      // an attested call never drags a referral back to Phone Screen.
      if (placedAt === 'new') {
        hubSetStatus_(id, HUB_STAGE_TO_STATUS['phone-screen'], user);
        placedAt = 'phone-screen';
      }
      hubSysLog_(user.email, 'intake_phone_screen_done',
        pName + ' (' + pPhone + ') — call attested, card at ' +
        (placedAt === 'new' ? 'Phone Screen' : HUB_STAGE_TO_STATUS[placedAt]), { status: 200 });
    }
    // Restarting the flow with a test card's own phone/email wipes that
    // card's previous test screenings, so the same number can run the test
    // over and over.
    if (typeof commsIsOperatorCard_ === 'function' &&
        commsIsOperatorCard_({ phone: phone, email: email })) {
      try { commsPurgeOperatorScreens_(id, user); } catch (ePg) { /* never blocks intake */ }
    }
    hubBustTalentCache_();
    return { status: 200, data: {
      candidate_id: id, candidate_name: intakeName,
      // Where the card ACTUALLY landed, and why it is not where it was asked
      // to be — never a stage the sheet does not hold.
      placed_at: placedAt,
      placement_reasons: placeReasons,
      resume_on_file: !!resumeLink
    } };
  },

  /** Resume upload — Drive file + fill-blank resume_link on the candidate. */
  resumeUpload: function (payload, user) {
    if (!hubIsWriter_(user)) return hubDenied_();
    var cid = str_(payload.candidate_id);
    if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
    var url = hubDriveFile_(payload, 'resume.pdf', '', user);
    var sheet = hubSheet_(TALENT_CANDIDATES_TAB);
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var iId = hdr.indexOf('candidate_id'), iLink = hdr.indexOf('resume_link');
    var iUpd = hdr.indexOf('updated_at'), iBy = hdr.indexOf('updated_by');
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][iId]).trim() === cid) {
        if (!String(values[r][iLink] || '').trim()) {
          sheet.getRange(r + 1, iLink + 1).setValue(url);        // fill-blank only
        }
        if (iUpd !== -1) sheet.getRange(r + 1, iUpd + 1).setValue(new Date().toISOString());
        if (iBy !== -1) sheet.getRange(r + 1, iBy + 1).setValue('asa-hub:' + user.email);
        hubBustTalentCache_();
        // THE SCORECARD RIDES THE UPLOAD: best-effort,
        // never blocking — a dead AI leaves the score pending, not the hiring.
        try {
          if (typeof rubricEnsureForCandidate_ === 'function') {
            SpreadsheetApp.flush();
            rubricEnsureForCandidate_(cid, user, rubricFileId_(url));
          }
        } catch (eSc) { /* the nota can wait; the upload cannot */ }
        try {
          if (typeof journeyLog_ === 'function') {
            journeyLog_({ candidate_id: cid,
                          name: str_(values[r][hdr.indexOf('candidate_name')]),
                          step: 'resume_on_file', channel: 'record', ok: true,
                          detail: str_(user.email) + ' uploaded the resume',
                          ref: url, by: 'asa-hub:' + user.email });
          }
        } catch (eJ) { /* the file is filed either way */ }
        return { status: 200, data: { resume_link: url } };
      }
    }
    return { status: 404, message: 'No candidate "' + cid + '".' };
  },

  /** CJIS upload — Drive PDF + cjis_status/cjis_report_url on the LAST
   *  analysis row (append when the candidate has none). ENGINE VOCABULARY. */
  cjisUpload: function (payload, user) {
    if (!hubIsWriter_(user)) return hubDenied_();
    var cid = str_(payload.candidate_id);
    if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
    var status = str_(payload.status) || 'Clear';
    if (['Pending', 'Clear', 'Verified', 'Disqualified'].indexOf(status) === -1) {
      return { status: 400, message: 'invalid status — engine vocabulary is Pending/Clear/Verified/Disqualified' };
    }
    var name = str_(payload.filename) || 'cjis-report.pdf';
    if (name.toLowerCase().indexOf('cjis') !== 0) name = 'CJIS_' + name;
    var url = hubDriveFile_({ base64: payload.base64, filename: name }, 'cjis-report.pdf', 'application/pdf', user);

    var sheet = hubSheet_(TALENT_RESUME_TAB);
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(function (h) { return String(h).trim(); });
    var iId = hdr.indexOf('candidate_id');
    var iSt = hdr.indexOf('cjis_status'), iUrl = hdr.indexOf('cjis_report_url');
    var iUpd = hdr.indexOf('updated_at'), iBy = hdr.indexOf('updated_by');
    if (iId === -1 || iSt === -1 || iUrl === -1) {
      return { status: 500, message: 'entity_resume_analyses is missing the cjis columns' };
    }
    var target = 0;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][iId]).trim() === cid) target = r + 1;  // last match wins
    }
    if (target) {
      sheet.getRange(target, iSt + 1).setValue(status);
      sheet.getRange(target, iUrl + 1).setValue(url);
      if (iUpd !== -1) sheet.getRange(target, iUpd + 1).setValue(new Date().toISOString());
      if (iBy !== -1) sheet.getRange(target, iBy + 1).setValue('asa-hub:' + user.email);
    } else {
      var now = new Date().toISOString();
      hubAppendRow_(TALENT_RESUME_TAB, {
        candidate_id: cid, cjis_status: status, cjis_report_url: url,
        created_at: now, updated_at: now, created_by: 'asa-hub:' + user.email
      });
    }
    hubBustTalentCache_();
    try {
      if (typeof journeyLog_ === 'function') {
        journeyLog_({ candidate_id: cid, step: 'cjis_filed', channel: 'record', ok: true,
                      detail: str_(user.email) + ' uploaded the CJIS report (' + status + ') — the verdict is still a person’s',
                      ref: url, by: 'asa-hub:' + user.email });
      }
    } catch (eJ) { /* the file is filed either way */ }
    return { status: 200, data: { cjis_status: status, cjis_report_url: url } };
  },

  /** One-way legacy import (admin): upsert the 3 talent tabs from the old
   *  governed sheet into the Hub's own tabs by key column. Hub-only rows
   *  survive; legacy rows update in place or append. Google→Google only. */
  syncFromLegacy: function (payload, user) {
    if (!user || user.role !== 'admin') return hubDenied_();
    var legacy = ssOpen_(hubId_('LEGACY_TALENT_SHEET_ID'));
    var plan = [
      { tab: 'entity_candidates', keys: ['candidate_id'] },
      { tab: 'entity_resume_analyses', keys: ['resume_analysis_id', 'candidate_id'] },
      { tab: 'entity_phone_screens', keys: ['phone_screen_id', 'candidate_id'] }
      // (recruitment_contracts is NOT here — recruitmentSync mirrors the
      // Dropbox Sign API directly, not the legacy portal sheet.)
    ];
    var summary = {};
    plan.forEach(function (cfg) {
      var srcSS = cfg.sid ? ssOpen_(cfg.sid) : legacy;
      var src = srcSS.getSheetByName(cfg.srcTab || cfg.tab);
      // The import lands wherever the tab lives now — writing the copy in
      // HUB_DB would feed a tab whose readers moved on.
      var dst = hubTabSheet_(cfg.dstTab || cfg.tab);
      if (!src || !dst) { summary[cfg.dstTab || cfg.tab] = 'tab missing'; return; }
      var sVals = src.getDataRange().getValues();
      var dVals = dst.getDataRange().getValues();
      if (sVals.length < 1) { summary[cfg.dstTab || cfg.tab] = 'legacy empty'; return; }
      var sHdr = sVals[0].map(function (h) { return String(h).trim(); });
      var dHdr = dVals.length ? dVals[0].map(function (h) { return String(h).trim(); }) : [];
      // Destination header must cover the legacy header (append new cols).
      var missing = sHdr.filter(function (h) { return h && dHdr.indexOf(h) === -1; });
      if (missing.length) {
        dHdr = dHdr.concat(missing);
        dst.getRange(1, 1, 1, dHdr.length).setValues([dHdr]);
      }
      var keyOf = function (hdr, row) {
        for (var k = 0; k < cfg.keys.length; k++) {
          var idx = hdr.indexOf(cfg.keys[k]);
          if (idx !== -1 && String(row[idx] || '').trim()) {
            return cfg.keys[k] + '=' + String(row[idx]).trim();
          }
        }
        return '';
      };
      var index = {};  // key → destination row number
      for (var d = 1; d < dVals.length; d++) {
        var dk = keyOf(dHdr, dVals[d]);
        if (dk) index[dk] = d + 1;
      }
      var updated = 0, inserted = 0;
      for (var s = 1; s < sVals.length; s++) {
        var sk = keyOf(sHdr, sVals[s]);
        if (!sk) continue;
        var out = dHdr.map(function (h) {
          var si = sHdr.indexOf(h);
          return si === -1 ? '' : serialize_(sVals[s][si]);
        });
        if (index[sk]) {
          dst.getRange(index[sk], 1, 1, out.length).setValues([out]);
          updated++;
        } else {
          dst.appendRow(out);
          inserted++;
        }
      }
      summary[cfg.dstTab || cfg.tab] = { updated: updated, inserted: inserted };
    });
    hubBustTalentCache_();
    return { status: 200, data: summary };
  },

  /** User management (admin; READ also for a House-Manager-badged manager —
   *  the HM release: they need who is active and who is not,
   *  never the create/delete/arm doors, which all stay admin). */
  usersList: function (payload, user) {
    var isHm = !!user && String(user.role) === 'manager' &&
               userTypesFromRaw_(user.types).types.indexOf('HM') !== -1;
    if (!user || (user.role !== 'admin' && !isHm)) return hubDenied_();
    return { status: 200, data: usersAll_()
      // a row folded by the manual merge left the lists — its facts live on
      // the keeper; clear `merged_into` on the sheet to reverse
      .filter(function (u) { return !str_(u.mergedinto); })
      .filter(function (u) { return !hubIsMasterRow_(u); })
      /**
       * THE DIRECTORY BELONGS TO THE PLACE. This filter used to
       * live in the browser (usersDirectory.ts tenantScope_) where it failed
       * OPEN — every account crossed the wire and sat in sessionStorage,
       * which survives the reboot a tenant crossing performs. It is a
       * server truth now: away, an account answers only if it belongs
       * here (a blank home_tenant = headquarters, so today's 188 rows keep
       * exactly the reach they have).
       */
      .filter(function (u) { return tenantUserVisible_(u); })
      .map(function (u) {
        var pub = userPublic_(u);
        // the session's own answer (authMe), never a directory fact
        delete pub.my_world;
        pub.active = str_(u.active).toLowerCase() !== 'false';
        pub.created_at = str_(u.createdat);
        pub.last_login = str_(u.lastlogin);
        return pub;
      }) };
  },

  /**
   * Create an account (admin) — password salted per row, active at once.
   * No typed password: when the payload carries none, the account is armed with the workspace default
   * from FIRST_USER_PASSWORD (ONBOARDING_USER_PASSWORD honoured as the
   * same value's older name) — the same default userActivate hands out.
   */
  userCreate: function (payload, user) {
    if (!user || user.role !== 'admin') return hubDenied_();
    var email = str_(payload.email).toLowerCase();
    var name = str_(payload.display_name), pw = String(payload.password || '');
    var role = str_(payload.role) || 'staff';
    if (['admin', 'manager', 'staff', 'client', 'interviewer'].indexOf(role) === -1) {
      return { status: 400, message: 'role must be admin, manager, staff or client' };
    }
    if (!name || email.indexOf('@') === -1) {
      return { status: 400, message: 'Name and a valid email are required.' };
    }
    var defaulted = false;
    if (!pw) {
      pw = str_(hubProp_('FIRST_USER_PASSWORD')) ||
           str_(hubProp_('ONBOARDING_USER_PASSWORD'));
      if (!pw) {
        return { status: 500, message: 'Set the FIRST_USER_PASSWORD Script Property first — ' +
                 'new accounts are armed with that default.' };
      }
      defaulted = true;
    } else if (pw.length < 8) {
      return { status: 400, message: 'A typed password needs at least 8 characters.' };
    }
    if (userByEmail_(email)) return { status: 409, message: 'A user with this email already exists.' };
    /**
     * AND THE SAME PERSON UNDER A DIFFERENT ADDRESS . The e-mail
     * check above is not an identity check: it catches one account twice and
     * misses one human twice, which is how the roster's spelling variants
     * would have walked in here one at a time.
     *
     * An EXACT hit — the phone, the name, or the name without a middle initial
     * — is the same person and is refused outright. A NEAR one is a question,
     * so it is refused with BOTH names and can be overridden deliberately:
     * "Lisa T Bright" beside "Lisa B Bright" may well be two people, and only
     * a person can say so.
     */
    if (typeof userIdentityConflict_ === 'function') {
      var clash = userIdentityConflict_(name, email, str_(payload.phone));
      if (clash && clash.how === 'near' && payload.confirm_distinct !== true) {
        return { status: 409, message: '"' + name + '" looks like "' + clash.who + '" (' +
                 Math.round((clash.ratio || 0) * 100) + '% alike), who already has an account. ' +
                 'If they are different people, send confirm_distinct to create it anyway.' };
      }
      if (clash && clash.how !== 'near') {
        return { status: 409, message: '"' + clash.who + '" already has an account — matched by ' +
                 clash.how + '. Edit that account instead of making a second one.' };
      }
    }
    var salt = randomHex_(32);
    var uid = 'USR_' + randomHex_(12).toUpperCase();
    hubSheet_(USERS_TAB).appendRow([
      uid, email, name, role, salt, hashPassword_(pw, salt),
      'true', new Date().toISOString(), ''
    ]);
    // THE DEFAULT IS A KEY FOR ONE USE. The workspace default is identical on every account armed with
    // it, so it is a shared key, not a credential: the flag makes the platform
    // demand a private password before any screen opens. A password the admin
    // TYPED is left alone here — it is one pair of hands, not the shared one —
    // and authLogin still stamps it if that account has never signed in.
    if (defaulted) {
      try { userSetFields_(uid, { must_change: 'true' }); }
      catch (eM) { /* the door already opened; the first sign-in stamps it */ }
    }
    /**
     * AN ACCOUNT IS BORN WHERE IT WAS MADE. The row itself is central — identity is one truth for
     * the whole platform — but its MEMBERSHIP must name the place, or a
     * person created in the franchise reads as headquarters (blank = HQ) and
     * vanishes from the very screen that just created them.
     */
    if (hubAwayTenant_()) {
      try { userSetFields_(uid, { home_tenant: tenantStamp_() }); }
      catch (eT) { /* the account exists; the stamp can be set by hand */ }
    }
    return { status: 200, data: { id: uid, email: email, display_name: name, role: role } };
  },

  /**
   * Back to roster: deletes the ACCOUNT row only — the
   * person stays on the People roster / Clients directory. Refuses
   * self-deletion and the last admin.
   */
  userDelete: function (payload, user) {
    if (!user || user.role !== 'admin') return hubDenied_();
    var uid = str_(payload.user_id);
    if (!uid) return { status: 400, message: 'user_id is required.' };
    /**
     * AGAINST THE ACCOUNT AT THE KEYBOARD. `user.id` is the
     * VISITED person while a visit is open, so this guard inverted: it would
     * have refused deleting THEIR account and happily deleted the caller's
     * own. A guard about "yourself" reads the caller, always.
     */
    var meDel = (typeof HUB_CALLER !== 'undefined' && HUB_CALLER) ? str_(HUB_CALLER.id) : str_(user.id);
    if (uid === meDel) return { status: 400, message: 'You cannot delete your own account.' };
    var lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (e) {
      return { status: 503, message: 'Another update is in progress — try again.' };
    }
    try {
      var sheet = hubSheet_(USERS_TAB);
      var values = sheet.getDataRange().getValues();
      var hdr = values[0].map(normKey_);
      var iId = hdr.indexOf('userid'), iRole = hdr.indexOf('role'), iName = hdr.indexOf('displayname');
      var admins = 0;
      for (var q = 1; q < values.length; q++) {
        if (str_(values[q][iRole]) === 'admin') admins++;
      }
      for (var r = 1; r < values.length; r++) {
        if (str_(values[r][iId]) !== uid) continue;
        if (str_(values[r][iRole]) === 'admin' && admins <= 1) {
          return { status: 400, message: 'Refusing to delete the last admin account.' };
        }
        var who = str_(values[r][iName]) || uid;
        sheet.deleteRow(r + 1);
        hubSysLog_(user && user.email, 'userDelete', who + ' — account removed (person record untouched)', { status: 200 });
        return { status: 200, data: { id: uid, deleted: true } };
      }
      return { status: 404, message: 'No user "' + uid + '".' };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Arm several accounts at once — WITH THE SYSTEM DEFAULT 
   * The typed temporary password left with the flow:
   * every selected account turns active, an UNARMED one receives the
   * FIRST_USER_PASSWORD default (ONBOARDING_USER_PASSWORD honoured as the
   * same value's older name), and an account that already HAS a password
   * keeps it — the userActivate law, applied in batch.
   */
  usersArm: function (payload, user) {
    if (!user || user.role !== 'admin') return hubDenied_();
    var ids = (payload && payload.user_ids) || [];
    if (!Array.isArray(ids) || !ids.length) return { status: 400, message: 'user_ids: which accounts to arm.' };
    var pw = str_(hubProp_('FIRST_USER_PASSWORD')) ||
             str_(hubProp_('ONBOARDING_USER_PASSWORD'));
    if (!pw) {
      return { status: 500, message: 'Set the FIRST_USER_PASSWORD Script Property first — ' +
               'arming hands every unarmed account that default.' };
    }
    var lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (e) {
      return { status: 503, message: 'Another update is in progress — try again.' };
    }
    try {
      var sheet = hubSheet_(USERS_TAB);
      // must_change is an additive column — make sure it exists before the
      // header lookup, or the batch would arm accounts with nowhere to record
      // that the password they received is the shared one.
      ensureUserProfileColumns_();
      var values = sheet.getDataRange().getValues();
      var hdr = values[0].map(normKey_);
      var iId = hdr.indexOf('userid'), iSalt = hdr.indexOf('salt'),
          iHash = hdr.indexOf('passhash'), iActive = hdr.indexOf('active'),
          iMust = hdr.indexOf('mustchange');
      var armedN = 0, defaulted = 0, kept = 0;
      for (var r = 1; r < values.length; r++) {
        if (ids.indexOf(str_(values[r][iId])) === -1) continue;
        var armed = !!str_(values[r][iHash]);
        if (!armed) {
          var salt = randomHex_(32);
          sheet.getRange(r + 1, iSalt + 1).setValue(salt);
          sheet.getRange(r + 1, iHash + 1).setValue(hashPassword_(pw, salt));
          // THE DEFAULT IS A KEY FOR ONE USE. Only the rows that RECEIVE the shared
          // default are stamped — an account that kept its own password owes
          // nobody a change, and demanding one would be a lie.
          if (iMust !== -1) sheet.getRange(r + 1, iMust + 1).setValue('true');
          defaulted++;
        } else {
          kept++;   // their own password is never overwritten by a default
        }
        sheet.getRange(r + 1, iActive + 1).setValue('true');
        armedN++;
      }
      hubSysLog_(user && user.email, 'users_arm',
                 armedN + ' account(s) activated — ' + defaulted + ' with the default password, ' +
                 kept + ' keeping their own', { status: 200 });
      return { status: 200, data: { armed: armedN, defaulted: defaulted, kept: kept } };
    } finally {
      lock.releaseLock();
    }
  },

  /** Update one account (admin) — fields present in the payload only. */
  userUpdate: function (payload, user, token) {
    if (!user || user.role !== 'admin') return hubDenied_();
    var uid = str_(payload.user_id);
    // Serialize admin writes: perm_overrides is a full-cell replace, so
    // without the lock a slow older request can drop a newer override map.
    var lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (e) {
      return { status: 503, message: 'Another update is in progress — try again.' };
    }
    try {
    // Profile columns are additive — make sure they exist before header lookup.
    ensureUserProfileColumns_();
    var sheet = hubSheet_(USERS_TAB);
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iId = hdr.indexOf('userid');
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) !== uid) continue;
      /**
 * YOU MAY ONLY EDIT SOMEBODY WHO IS HERE (Tenant.gs).
       * The franchise's directory already answers with this place's people
       * alone, but the door must hold on its own — a screen is not a guard.
       */
      if (hubAwayTenant_()) {
        var rowObj = {};
        hdr.forEach(function (h, hi) { rowObj[h] = values[r][hi]; });
        if (!tenantUserVisible_(rowObj)) {
          return { status: 404, message: 'No user "' + uid + '".' };
        }
      }
      // the eye's denials are app access, the master's pen alone; resending the stored list (the capability save carries it) changes nothing
      if (payload.app_denials !== undefined && !appAccessMayEdit_(user) &&
          !appDenialsSame_(payload.app_denials, values[r][hdr.indexOf('appdenials')])) {
        return { status: 403, message: 'Per-person app access is the master\'s alone.' };
      }
      // asked before any field is written, so a refusal changes nothing
      if (payload.types !== undefined) {
        var grantBad = hubBadgeGrantRefused_(user, values[r][hdr.indexOf('types')], payload.types);
        if (grantBad) return grantBad;
      }
      var set = function (key, val) {
        var i = hdr.indexOf(key);
        if (i !== -1) sheet.getRange(r + 1, i + 1).setValue(val);
      };
      if (payload.display_name !== undefined) {
        set('displayname', str_(payload.display_name));
        // an administrator's save of the name vouches for it (ComplianceDocs.gs complianceDocsSelfNamed_)
        set('nameby', '');
      }
      if (payload.role !== undefined) {
        if (['admin', 'manager', 'staff', 'client', 'interviewer'].indexOf(str_(payload.role)) === -1) {
          return { status: 400, message: 'invalid role' };
        }
        set('role', str_(payload.role));
      }
      if (payload.active !== undefined) set('active', payload.active ? 'true' : 'false');
      // CONFIG surfaces only, never the platform: hidden from System users +
      // Per-person overrides, sign-in keeps working.
      if (payload.system_hidden !== undefined) set('systemhidden', payload.system_hidden ? 'true' : '');
      // system TYPE: whitelist or empty, never free
      // text — other screens trust this label as data.
      if (payload.system_type !== undefined) {
        var st = str_(payload.system_type).toUpperCase();
        if (st && SYSTEM_USER_TYPES.indexOf(st) === -1) {
          return { status: 400, message: 'system_type must be one of: ' + SYSTEM_USER_TYPES.join(', ') + ' (or empty).' };
        }
        set('systemtype', st);
      }
      // The TYPE BADGES: validated list, several
      // allowed. Granting HM or INTERVIEWER ALSO grants the scorecard pen
      // (hiring.interview) in the same stroke, so the door (policy gate)
      // and the room (interviewCanRecord_) agree — the grant shows in
      // Settings -> Access control like any other, one truth.
      if (payload.types !== undefined) {
        var tv = userTypesFromRaw_(payload.types);
        if (tv.bad.length) {
          return { status: 400, message: 'Unknown type: ' + tv.bad.join(', ') +
                   '. Types are: ' + HUB_USER_TYPES.join(', ') + '.' };
        }
        set('types', tv.types.join(', '));
        if (userTypesCanInterview_(tv.types)) {
          var iOv = hdr.indexOf('permoverrides');
          if (iOv !== -1) {
            var ovNow = {};
            try { ovNow = JSON.parse(str_(values[r][iOv]) || '{}') || {}; } catch (eOv) { ovNow = {}; }
            if (ovNow['hiring.interview'] !== true) {
              ovNow['hiring.interview'] = true;
              sheet.getRange(r + 1, iOv + 1).setValue(JSON.stringify(ovNow));
            }
          }
        }
      }
      /**
       * WHERE THIS ACCOUNT LIVES.
       *
       * `home_tenant` decides which place a session lands in when the
       * envelope names none — it is what closed the cold-boot hole — and
       * until now nothing could write it but the stamp an account gets when
       * it is BORN inside a franchise. Every other case was a cell somebody
       * had to type, which is not a mechanism, it is a chore with a lockout
       * at the end of it.
       *
       * Both columns are additive and blank means headquarters, so clearing
       * them is always allowed and always safe. tenantPlaceableGate_ refuses
       * the two ways this goes wrong: a place the caller cannot stand in
       * themselves, and an id that does not exist — the second is the
       * dangerous one, because the account would resolve into a place with no
       * rows and meet a 404 on every screen with nothing to explain it.
       */
      if (payload.home_tenant !== undefined || payload.tenants !== undefined) {
        var wantPlaces = [];
        if (payload.home_tenant !== undefined) wantPlaces.push(str_(payload.home_tenant));
        var extraList = [];
        if (payload.tenants !== undefined) {
          var rawExtra = payload.tenants;
          extraList = (rawExtra && rawExtra.join ? rawExtra : String(rawExtra || '').split(','))
            .map(function (t) { return String(t || '').trim(); })
            .filter(function (t) { return !!t; });
          wantPlaces = wantPlaces.concat(extraList);
        }
        var placeBad = tenantPlaceableGate_(wantPlaces, user);
        if (placeBad) return placeBad;
        if (payload.home_tenant !== undefined) set('hometenant', str_(payload.home_tenant));
        if (payload.tenants !== undefined) set('tenants', extraList.join(', '));
      }
      /**
       * WHICH PERSON A CLIENT LOGIN IS.
       * `client_key` is what narrows a client-role account to their own
       * record — the directory, the plan and the three wellbeing screens all
       * answer an empty key with an empty list, by the standing rule.
       * It was set in exactly ONE place, `clientUserCreate`, which
       * only runs when the account is born FROM a client row. An account that
       * arrived any other way — invited onto the platform, created by hand —
       * had no door to this column at all, so it was linked to nobody and
       * every one of those screens was empty with nothing on it to say why.
       *
       * Admin-only like the rest of this handler, and blank is always allowed:
       * clearing it unlinks the account, which is the same shape as every
       * other additive column here. Never inferred from a name or an e-mail —
       * a standing law, and the reason this is typed rather than
       * guessed.
       */
      if (payload.client_key !== undefined) set('clientkey', str_(payload.client_key).slice(0, 120));
      if (payload.title !== undefined) set('title', str_(payload.title).slice(0, 120));
      hubUserFieldsWrite_(payload, set);
      if (payload.perm_overrides !== undefined) {
        set('permoverrides', JSON.stringify(payload.perm_overrides || {}));
      }
      // THE MASTER'S EYE: apps taken away from THIS
      // person on top of their badge — an id list, never a grant. Narrowing
      // only: an id here can only remove what the matrix gave.
      if (payload.app_denials !== undefined) {
        set('appdenials', JSON.stringify(appDenialsNormalize_(payload.app_denials)));
      }
      if (payload.password !== undefined) {
        var pw = String(payload.password || '');
        if (pw.length < 8) return { status: 400, message: 'password must be at least 8 characters' };
        var salt = randomHex_(32);
        set('salt', salt);
        set('passhash', hashPassword_(pw, salt));
 // a password chosen by a hand retires the one-use default
        set('mustchange', '');
      }
      // Editing your OWN row must reflect immediately — drop this session's
      // cache entry so the next authMe re-reads the sheet. OTHER users
      // re-validate within the 6h cache TTL or at next login; a deactivation
      // that must be instant needs their hub_sessions rows deleted by hand.
      /**
       * THE SESSION AT THE KEYBOARD. `user.id` is the VISITED
       * person while a visit is open, so this busted the wrong cache entry:
       * the caller kept a stale profile and the visited person's session was
       * dropped for an edit that was not theirs.
       */
      if (token && uid === ((typeof HUB_CALLER !== 'undefined' && HUB_CALLER) ? str_(HUB_CALLER.id) : str_(user.id))) {
        try { CacheService.getScriptCache().remove('sess_' + sha256Hex_(String(token))); } catch (e) { /* best effort */ }
      }
      // the deep-profile store must not outlive the edit - stale it so
      // every reader's next userProfileDeep rebuilds fresh
      try {
        if (typeof profileStoreStale_ === 'function') profileStoreStale_(uid);
      } catch (eS) { /* the store heals on its own 6h clock */ }
      return { status: 200, data: { ok: true } };
    }
    return { status: 404, message: 'No user "' + uid + '".' };
    } finally {
      lock.releaseLock();
    }
  },

  /** Decision checkpoints — THE SIGNED-IN DOOR. The work is hubSetDecision_'s;
   *  this door alone lets the decider's own Accept attest the phone screen
   *  (the share link and the simulator ride the same writer without it). */
  setDecision: function (payload, user) {
    return hubSetDecision_(payload, user, { attest: true });
  },

  /** Gated stage move — the GAS revalidates the cloned gate table before
   *  writing; the button in the UI is convenience, this is the enforcement. */
  moveStage: function (payload, user) {
    if (!hubIsWriter_(user)) return hubDenied_();
    var cid = str_(payload.candidate_id);
    if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
    var ev = hubEvidence_(cid);
    if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
    var gate = hubGate_(ev);
    var to = str_(payload.to_stage);
    if (!gate.to) return { status: 400, message: 'Already at the final stage.' };
    if (to !== gate.to) {
      // SAY WHERE THEY ARE, not what the rule is: a wrong target almost
      // always means the move ALREADY LANDED and the screen has not caught up
      // (the slice rebuilds in minutes). Stating the rule made people press
      var atLabel = HUB_STAGE_TO_STATUS[gate.from] || gate.from;
      var toLabel = HUB_STAGE_TO_STATUS[gate.to] || gate.to;
      return { status: 400, already_at: gate.from,
               message: str_(ev.cand.candidatename) + ' is already at ' + atLabel +
                        ' — reload to see it. From here the next step is ' + toLabel + '.' };
    }
    if (!gate.ok) {
      return { status: 409, message: 'Stage gate not passed — missing: ' + gate.reasons.join(', ') + '.' };
    }
    hubSetStatus_(cid, HUB_STAGE_TO_STATUS[to] || to, user);
    hubBustTalentCache_();
    return { status: 200, data: { candidate_id: cid, stage: to } };
  }
};

/**
 * ONE DECISION PER CANDIDATE AT A TIME.
 *
 * Accept was pressed twice in the same second, and again four seconds
 * apart: nothing on the screen said the first press was running. On the write
 * lane the relay's queue put the second press behind the first. On the tool
 * lane both reach the script together, each execution reads its own copy of
 * the rows, both find the screen unrecorded, both attest it, both move the card
 * and both book a visit — and a Decline pressed twice mails the owners twice.
 *
 * So every door that decides somebody's run — this one, the interviewer's
 * scorecard (interviewSave) and the sweep's decline net (hiringTerminalEndsRun_)
 * — holds a claim on the candidate while it reads, decides and writes. The
 * claim is the hotline's shape (hotlineClaim_): the platform's one script lock
 * is held for a heartbeat, only so the look-and-leave is atomic, and the claim
 * itself lives in the script cache longer than any execution can run, so a
 * crashed one frees the candidate by itself. A second press finds it held and
 * is told so on the screen that pressed; nothing is written twice.
 */
var HUB_DECISION_CLAIM_TTL_S = 420;
var HUB_DECISION_HELD = {};

function hubDecisionClaimKey_(cid) {
  return 'hub:decision:' + str_(cid);
}

/** 'claimed' (this execution owns it) | 'busy' | 'lock' | 'cache'. */
function hubDecisionClaim_(cid, waitMs) {
  var key = hubDecisionClaimKey_(cid);
  // a door already holding it in THIS execution does not claim it again: the
  // nested caller is somebody else's decision arriving mid-way, and it waits
  if (HUB_DECISION_HELD[key]) return 'busy';
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (eL) { lock = null; }
  if (!lock) return 'lock';
  try { if (!lock.tryLock(waitMs || 10000)) return 'lock'; } catch (eT) { return 'lock'; }
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return 'busy';
    var token = String(new Date().getTime()) + ':' + Math.random().toString(36).slice(2, 10);
    cache.put(key, token, HUB_DECISION_CLAIM_TTL_S);
    HUB_DECISION_HELD[key] = token;
    return 'claimed';
  } catch (eC) {
    return 'cache';
  } finally {
    try { lock.releaseLock(); } catch (eR) { /* the execution ending releases it */ }
  }
}

/** Let go of a claim THIS execution holds — never somebody else's. */
function hubDecisionRelease_(cid) {
  var key = hubDecisionClaimKey_(cid);
  var mine = HUB_DECISION_HELD[key];
  delete HUB_DECISION_HELD[key];
  if (!mine) return;
  try {
    var cache = CacheService.getScriptCache();
    if (String(cache.get(key) || '') === mine) cache.remove(key);
  } catch (e) { /* it expires after HUB_DECISION_CLAIM_TTL_S */ }
}

/** What a press is told when the claim was not granted — never a silence. */
function hubDecisionRefusal_(state) {
  if (state === 'busy') {
    return { status: 409, busy: true,
             message: 'A decision for this candidate is already being recorded — its answer is on the ' +
                      'way. Nothing was written twice; the card follows in a moment.' };
  }
  return { status: 503, message: 'The platform is busy and this decision was not written. ' +
                                 'Try again in a moment.' };
}

/**
 * THE ROWS AS THEY ARE NOW. Every reader in one execution shares one copy of a
 * dissolved tab (HIRING_LEGACY_MEMO) and one copy of the runtime's Facts, and
 * across executions a rebuilt tab small enough to cache is served for five
 * minutes. A door that decides somebody's run reads under its claim, and it
 * must read what the LAST decision wrote, not what this execution — or a
 * neighbour's cache — saw before it.
 */
function hubEvidenceFresh_(cid) {
  if (typeof hiringLegacyForget_ === 'function') {
    hiringLegacyForget_([TALENT_CANDIDATES_TAB, TALENT_RESUME_TAB, TALENT_PHONE_TAB, HUB_INTERVIEWS_TAB]);
  }
  return hubEvidence_(cid);
}

/** The checkpoints this writer answers. The interview's recommendation is not
 *  one: it is signed on the scorecard (interviewSave), with the interviewer's
 *  name, score and comments, and a bare Decline here would end a run nobody
 *  signed. */
var HUB_DECISION_CHECKPOINTS = ['resume-decision', 'advance-decision'];

/**
 * Decision checkpoints (the Hub's cloned gate evidence): resume-decision →
 * decision_status on the analysis row; advance-decision → final_result on the
 * phone-screen row. Decline moves the candidate to Not Hiring. Vocabulary is
 * the engine's — Advance/Decline exactly.
 *
 * ONE WRITER, THREE DOORS: the signed-in board (HUB_ACTIONS.setDecision), the
 * shared candidate link (candFormSubmitPub_) and the simulator. `how.attest` is
 * true only on the first: a decider's own Accept may attest a phone screen
 * nothing recorded, and a link — whose only identity is its token — or a
 * machine may not sign that legal record for anybody.
 */
function hubSetDecision_(payload, user, how) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var p = payload || {};
  var cid = str_(p.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  var checkpoint = str_(p.checkpoint);
  var value = str_(p.value);
  if (['Advance', 'Decline'].indexOf(value) === -1) {
    return { status: 400, message: 'decision must be Advance or Decline' };
  }
  if (checkpoint === 'interview-recommendation') {
    return { status: 400, message: 'The interview recommendation is signed on the interviewer\'s scorecard — ' +
                                   'open the Scorecard to record it. Nothing was written.' };
  }
  if (HUB_DECISION_CHECKPOINTS.indexOf(checkpoint) === -1) {
    return { status: 400, message: 'unknown checkpoint "' + checkpoint + '"' };
  }
  var claim = hubDecisionClaim_(cid);
  if (claim !== 'claimed') return hubDecisionRefusal_(claim);
  try {
    return hubSetDecisionHeld_(cid, checkpoint, value, user, how || {});
  } finally {
    hubDecisionRelease_(cid);
  }
}

/** The decision itself, under the candidate's claim (hubSetDecision_). */
function hubSetDecisionHeld_(cid, checkpoint, value, user, how) {
  var ev = hubEvidenceFresh_(cid);
  if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
  var who = str_(ev.cand.candidatename) || cid;

  // A PRESS THAT ARRIVES AFTER THE RUN ENDED: the Decline is already true and
  // says so without a second letter; anything else is told where the person is
  // instead of being written over a closed record.
  if (str_(ev.cand.status).toLowerCase() === 'not hiring') {
    if (value === 'Decline') {
      return { status: 200, data: { value: value, declined: true, already: true, gate_passed: false,
               to_stage: null, missing: [], moved_to: null } };
    }
    return { status: 409, message: who + ' has already left the process (Not Hiring) — reload to see it. ' +
                                   'Nothing was written.' };
  }
  // THE PHONE SCREEN IS DECIDED AT THE PHONE SCREEN. A second Accept that lands
  // after the first moved the card, or a stale card still drawn in that column,
  // used to rewrite the screen's record and answer "still at this stage" about
  // somebody already at Interview. Ending a run from a later stage is the
  // scorecard's or Discard's act, never this one's.
  if (checkpoint === 'advance-decision') {
    var at = talentStage_(ev.cand.status);
    if (at !== 'phone-screen') {
      var atLabel = HUB_STAGE_TO_STATUS[at] || str_(ev.cand.status) || 'another stage';
      var later = TALENT_STAGE_ORDER.indexOf(at) > TALENT_STAGE_ORDER.indexOf('phone-screen');
      return { status: 409, already_at: at || null,
               message: who + ' is ' + (later ? 'already' : 'still') + ' at ' + atLabel + ' — ' +
                        (later ? 'the phone screen was decided' : 'the phone screen is not open yet') +
                        '. Reload to see it. Nothing was written.' };
    }
  }

  if (checkpoint === 'resume-decision') {
    // THIS REFUSAL IS GONE, AND ON PURPOSE. CJIS left it on the RESUME followed. A
    // recruiter who screened somebody by voice has the evidence; the
    // document may never arrive. The checklist square still says the resume
    // is owed — that is where the fact belongs, not in front of a decision
    // a human already made.
    hubSetFieldLastRow_(TALENT_RESUME_TAB, cid, { decision_status: value }, user, true);
  } else {
    /**
     * THE ACCEPT THAT FOUND NO CALL ON THE RECORD. Pressing Accept on the
     * Phone Screen to move a candidate to the next phase did not work.
     *
     * This door refused 409 "No phone screen recorded" to every candidate the
     * automated line never reached — nine of the ten people standing at Phone
     * Screen, most of them after seven unanswered invitations to call — and 409
     * "Advance requires the phone screen to be Completed" to the rest. The
     * press rode the write ledger, the ledger answered the browser "recorded",
     * and the refusal was buried minutes later where nobody was looking.
     *
     * A decider pressing Accept on the signed-in board IS attesting the screen
     * — the same attestation the Manual screen button signs
     * (screenManualAttestFields_, the ONE definition, same roles), so the press
     * does both in one act, the way the resume decision stopped demanding the
     * document. Evidence the line captured stays; only blanks are filled. The
     * shared link and the simulator sign for nobody (`how.attest` is theirs to
     * lack), so they keep the old answer. Decline needs no call on the record
     * at all: it is the decision to end the run, and a row is made to carry it.
     */
    var sNow = ev.screen || {};
    var psFields = { final_result: value };
    var unscreened = value === 'Advance' && str_(sNow.screenstatus).toLowerCase() !== 'completed';
    if (unscreened && !how.attest) {
      return { status: 409, message: ev.screen
        ? 'Advance requires the phone screen to be Completed.'
        : 'No phone screen recorded for this candidate yet.' };
    }
    if (unscreened) {
      ensureHeader_(hubSheet_(TALENT_PHONE_TAB), SCREEN_MANUAL_COLUMNS);
      var attest = screenManualAttestFields_(sNow, user, new Date().toISOString());
      for (var ka in attest) psFields[ka] = attest[ka];
    }
    if (!hubSetFieldLastRow_(TALENT_PHONE_TAB, cid, psFields, user, true)) {
      return { status: 500, message: 'The decision could not be written on the phone screen record.' };
    }
    if (unscreened) {
      hubSysLog_(user && user.email, 'screen_manual_complete',
                 cid + ' — attested by the Accept on the advance decision', { status: 200 });
    }
  }

  var declined = value === 'Decline';
  if (declined) {
    hubSetStatus_(cid, 'Not Hiring', user);
    // THE ARCHIVE AND THE NOTICE — one
    // implementation, shared with the interview decline and the discard
    // button, so a candidate cannot leave the process in silence from any
    // of the four doors that end a run.
    if (typeof hiringArchiveAndTell_ === 'function') {
      hiringArchiveAndTell_(cid, (checkpoint === 'advance-decision'
        ? 'Declined after the phone screen'
        : 'Resume declined') + ' by ' + str_(user && user.email), user, '');
    }
  }
  hubBustTalentCache_();
  var gate = hubGate_(hubEvidence_(cid));
  // The rule: every phone-screen step green → the candidate
  // JUMPS to Interview, with the visit scheduled from the date agreed on
  // the call.
  var movedTo = null;
  if (!declined && checkpoint === 'advance-decision' && value === 'Advance' &&
      gate.ok && gate.to === 'interview') {
    var ev3 = hubEvidence_(cid);
    hubSetStatus_(cid, HUB_STAGE_TO_STATUS['interview'], user);
    hubScheduleInterview_(cid, ev3.cand,
      str_(ev3.screen && ev3.screen.bestinpersondaytime), user);
    hubBustTalentCache_();
    movedTo = 'interview';
  }
  return { status: 200, data: { value: value, declined: declined,
           gate_passed: !declined && gate.ok, to_stage: gate.to,
           missing: gate.reasons, moved_to: movedTo } };
}

/** Hub gate engine — the cloned transition rules. */

var HUB_STAGE_TO_STATUS = {
  'new': 'New',
  'phone-screen': 'Phone Screen',
  'interview': 'In Person',      // legacy vocabulary → sync/cutover compatible
  'onboarding': 'Onboarding',
  'hired': 'Hired',
  // ABSENT here: this map is what the platform WRITES, and nothing should
  // write that status again. talentStage_ still READS it, so cards already
  // carrying it land here instead of vanishing.
  // ABSENT here, like `internal-docs` before it: this map is what the
  // platform WRITES, and nothing writes that status any more. talentStage_
  // still READS it, so cards already carrying it land in Hired.
  'ready': 'Ready to Start'
};

/** Latest evidence rows for one candidate from the Hub's own tabs. */
function hubEvidence_(cid) {
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var cand = null, analysis = null, screen = null;
  readTabNormalized_(ss, TALENT_CANDIDATES_TAB).forEach(function (c) {
    if (str_(c.candidateid) === cid) cand = c;
  });
  readTabNormalized_(ss, TALENT_RESUME_TAB).forEach(function (a) {
    if (str_(a.candidateid) === cid) analysis = a;   // last row wins
  });
  readTabNormalized_(ss, TALENT_PHONE_TAB).forEach(function (s) {
    if (str_(s.candidateid) === cid) screen = s;     // last row wins
  });
  return { cand: cand, analysis: analysis || {}, screen: screen };
}

/**
 * CJIS cleared — ONE definition, used by the gate that decides and by the
 * checklist that draws. They had drifted (the checklist asked for the status
 * alone, the gate also for the attached report), so a card showed three
 * greens and still refused to move with nothing named to fix.
 */
/** A call that reached its own goodbye. The farewell in the tail is the
 * proof the conversation ENDED rather than dropped: a call is complete only
 *  when it reaches its "good day" or "goodbye" — ONE
 *  implementation for the borrow, the watcher and the redo loop. */
function hubCallComplete_(text) {
  var tail = String(text || '').slice(-500).toLowerCase();
  // The farewell PATTERN is a cell (Strings: words.goodbye.regex) — the one
  // regex-in-a-cell in this lane, because the phrases nest ("have a great
  // day"). An empty or broken cell reads every call as CUT, which is loud
  // (the redo loop fires) rather than silent — and the compiled shadow
  // answers before that can happen in an outage.
  var src = bookText_('Strings', 'words.goodbye.regex', '');
  if (!src) return false;
  try { return new RegExp(src).test(tail); } catch (e) { return false; }
}

function hubCjisCleared_(a) {
  var st = str_(a && a.cjisstatus).toLowerCase();
  return (st === 'clear' || st === 'verified') && !!str_(a && a.cjisreporturl);
}

/**
 * THE DAY, WHERE THE COMPANY IS. The manifest was America/Sao_Paulo until
 * (every day boundary hit 19:00-20:00 the previous evening
 * Ohio — likely the scorecard refusal); it now says
 * America/New_York, superseding HANDOFF-urgency-utc.md §4. This function
 * stays PINNED regardless: the zone is a decision, never a discovery, and
 * a lagging live manifest must not move a single hiring window.
 */
function hiringTimeZone_() {
  try {
    var tz = str_((typeof hiringAlerts_ === 'function' ? hiringAlerts_() : {}).hiring_timezone);
    if (tz) return tz;
  } catch (e) { /* the default below is the answer */ }
  return 'America/New_York';
}

/** The ISO instant of a day's edge, built from the parts. PURE on purpose, so
 *  the off-by-one is testable outside Apps Script. */
function hubTzEdgeIso_(ymd, offset, endOfDay) {
  var off = String(offset || '');
  // 'Z' from formatDate is '-0400'; ISO wants '-04:00'.
  var norm = /^[+-]\d{4}$/.test(off) ? off.slice(0, 3) + ':' + off.slice(3) : off;
  return String(ymd) + (endOfDay ? 'T23:59:59.999' : 'T00:00:00.000') + norm;
}

/** Start or end of the day that `d` falls on, IN THE COMPANY'S TIMEZONE. */
function hubTzDayEdge_(d, endOfDay) {
  try {
    var tz = hiringTimeZone_();
    var ymd = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    var off = Utilities.formatDate(d, tz, 'Z');
    var out = new Date(hubTzEdgeIso_(ymd, off, endOfDay));
    // A date that would not parse is worse than the old behaviour.
    if (!isNaN(out.getTime())) return out;
  } catch (e) { /* fall through */ }
  var fb = new Date(d.getTime());
  if (endOfDay) fb.setHours(23, 59, 59, 999); else fb.setHours(0, 0, 0, 0);
  return fb;
}

/** The weekday `d` falls on where the company is — 0 = Sunday. */
function hubTzWeekday_(d) {
  try {
    var n = parseInt(Utilities.formatDate(d, hiringTimeZone_(), 'u'), 10);  // 1=Mon..7=Sun
    if (!isNaN(n)) return n === 7 ? 0 : n;
  } catch (e) { /* fall through */ }
  return d.getDay();
}

/**
 * DID THIS PERSON ACTUALLY ONBOARD? — { ok, how, q, t, unreadable }. Two
 * answers count: 'portal' (the visit wrote the flags) and 'manual' (somebody
 * attested it on the card, with a name and a time). DOCUMENTS ARE
 * DELIBERATELY NOT PART OF THIS — uploads are legitimately late and the Hired
 * alert already chases them. Same two packet flags the graduation sweep reads
 * (Hired.gs): one definition, never a second copy.
 */
function hubOnboardingDone_(cand) {
  if (str_(cand && cand.manualonboarding).toLowerCase() === 'true') {
    return { ok: true, how: 'manual', q: true, t: true };
  }
  var packet = null;
  try {
    packet = packetFindRow_(str_(cand && cand.email), str_(cand && cand.candidateid),
                            { includeFinished: true });
  } catch (e) {
    // OUR failure to read a spreadsheet, not their failure to onboard — so it
    // opens rather than closes.
    return { ok: true, how: 'unreadable', unreadable: true };
  }
  if (!packet) return { ok: false, how: '', q: false, t: false };
  var q = packetTruthy_(obField_(packet, 'QuestionnaireComplete'));
  var t = packetTruthy_(obField_(packet, 'TutorialsComplete'));
  return { ok: q && t, how: (q && t) ? 'portal' : '', q: q, t: t };
}

/**
 * The gate table, cloned from the old world's client-side rules — with the two
 * checks that STOPPED BLOCKING written out of it, because a table that still
 * names them reads as the law five minutes after the code stopped enforcing it:
 *   new → phone-screen    resume decision Advance   (the resume itself left on
 *, CJIS; both stayed as
 *                         checklist squares that inform and never gate)
 *   phone-screen → interview   screen Completed + final_result Advance
 *   interview → onboarding     scorecard + interviewer recommendation Advance
 *   onboarding → hired         CLOSED — the Manual onboarding button only
 */
function hubGate_(ev) {
  if (!ev.cand) return { from: null, to: null, ok: false, reasons: ['candidate not found'] };
  return hubGateFor_(ev, talentStage_(ev.cand.status));
}

/** One rung of the ladder, on demand (2026-08-24): the simulator draws the
 *  WHOLE ladder from these, so every check lives exactly once. The matrix
 *  ride wraps every caller: shadow compares, on serves, off costs nothing. */
function hubGateFor_(ev, stage) {
  return hiringGateRide_(ev, hubGateCode_(ev, stage));
}

function hubGateCode_(ev, stage) {
  if (!ev.cand) return { from: null, to: null, ok: false, reasons: ['candidate not found'] };
  var a = ev.analysis;

  if (stage === 'new') {
    var reasons = [];
    // CJIS is NON-BLOCKING, and what it still owes goes in the checklist
    // square: somebody uploads the report to
    // the docs folder whenever it comes back, the platform collects it, and
    // the CHECKLIST SQUARE (talentChecklist_'s 'cjis' item) says what is
    // still owed — but the ladder never waits for it.
    //
    // THE RESUME ITSELF JOINED IT — a resume is not a required item of every
    // hiring process. Same shape, same
    // reason: talentChecklist_'s 'resume' square still reads `missing` and
    // says so on every card, and the ladder stopped waiting. What is left
    // here is the one thing a PERSON does — the decision.
    if (str_(a.decisionstatus).toLowerCase() !== 'advance') reasons.push('resume decision Advance');
    return { from: 'new', to: 'phone-screen', ok: reasons.length === 0, reasons: reasons };
  }

  if (stage === 'phone-screen') {
    var r2 = [];
    var s = ev.screen || {};
    if (str_(s.screenstatus).toLowerCase() !== 'completed') r2.push('screen Completed');
    if (str_(s.finalresult).toLowerCase() !== 'advance') r2.push('advance decision Advance');
    return { from: 'phone-screen', to: 'interview', ok: r2.length === 0, reasons: r2 };
  }

  // In person → onboarding: the INTERVIEWER's scorecard is the evidence — no
  // scorecard, no move.
  if (stage === 'interview') {
    var r3 = [];
    var iv = interviewFor_(str_(ev.cand.candidateid));
    // SHORT, because the STEP IS THE INSTRUCTION — the step itself is the
    // warning of what to do. The second branch stays
    // specific: a decision was made, it just was not Advance, and nothing on
    // the board says what it reads.
    if (!interviewScored_(iv)) r3.push('interview scorecard (score + comments)');
    else if (str_(iv.recommendation).toLowerCase() !== 'advance') {
      r3.push('interviewer recommendation Advance — it reads "' + str_(iv.recommendation) + '"');
    }
    return { from: 'interview', to: 'onboarding', ok: r3.length === 0, reasons: r3 };
  }

  // Onboarding → Hired IS CLOSED HERE — the button only: the move passes
  // through Manual onboarding and nowhere else.
  // Manual onboarding records who attested and when; a drag records nothing,
  // and one drag took a card to Hired with no visit, no
  // questionnaire and no tutorials. Closing it costs nothing:
  // onboardingManualComplete is the ONLY code path that writes Hired.
  //
  // NOT gated on the signed packet — the mapped process is unchanged by it.
  // The packet holds at GRADUATION instead (Hired.gs): the
  // person becomes staff on time and the card stays on the board in amber
  // until it lands — refusing the move would only hide them.
  if (stage === 'onboarding') {
    var ob = hubOnboardingDone_(ev.cand);
    var lack = [];
    if (!ob.q) lack.push('the New Hire Questionnaire');
    if (!ob.t) lack.push('the New Hire Tutorials');
    return { from: 'onboarding', to: 'hired', ok: false, reasons: [
      'Onboarding is completed with the "Manual onboarding" button on the card, never by '
      + 'dragging — the button records who says it was done and when, and a drag records '
      + 'nothing'
      + (lack.length ? '. Still outstanding on the portal: ' + lack.join(' and ') : '')
    ] };
  }

 // Hired -> Ready to start: the GRADUATION is the gate ( merge).
  // A drag may not put somebody in the manager's queue while the account,
  // the password or the Employee Database is still owed — the sweep moves
  // the card itself the moment all three are done.
  if (stage === 'hired') {
    var g5 = [];
    if (!str_(ev.cand.hiredcompleteat)) {
      g5.push('the graduation has not finished (hired_complete_at is empty)');
    } else if (typeof hubBecomingStaffDone_ === 'function') {
      var gs = hubBecomingStaffDone_(ev.cand);
      if (!gs.done) g5 = g5.concat(gs.missing || ['graduation checklist open']);
    }
    return { from: 'hired', to: 'ready', ok: g5.length === 0, reasons: g5 };
  }

 // READY TO START's exit is the SCHEDULE ITSELF (chapter 22):
  // the person stays here until they are FOUND with a schedule on the Shift
  // Board — the watch (readyToStartSweepMaybe_) then releases them by
  // itself. Nothing here is a press; the reason names the watch.
  if (stage === 'ready') {
    return { from: 'ready', to: 'working', ok: false, reasons: [
      'a schedule on the Shift Board — the watch releases them from Ready to Start ' +
      'by itself the moment they appear there'
    ] };
  }

  var idx = TALENT_STAGE_ORDER.indexOf(stage);
  var next = idx >= 0 && idx < TALENT_STAGE_ORDER.length - 1 ? TALENT_STAGE_ORDER[idx + 1] : null;
  return { from: stage, to: next, ok: !!next, reasons: next ? [] : ['final stage'] };
}

/** Set fields on the candidate's LAST row of a tab (append when allowed). */
function hubSetFieldLastRow_(tabName, cid, fields, user, appendIfMissing) {
  // A dissolved tab is answered by the runtime, so it must be WRITTEN there
  // too — otherwise the update lands in a sheet nobody reads any more.
  if (typeof hiringTabDissolved_ === 'function' && hiringTabDissolved_(tabName) &&
      hiringLegacyWrite_(tabName, cid, fields, user && user.email)) {
    return true;
  }
  var sheet = hubSheet_(tabName);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('candidate_id');
  var target = 0;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() === cid) target = r + 1;
  }
  if (target) {
    for (var k in fields) {
      var i = hdr.indexOf(k);
      if (i !== -1) sheet.getRange(target, i + 1).setValue(fields[k]);
    }
    var iU = hdr.indexOf('updated_at');
    if (iU !== -1) sheet.getRange(target, iU + 1).setValue(new Date().toISOString());
    var iB = hdr.indexOf('updated_by');
    if (iB !== -1) sheet.getRange(target, iB + 1).setValue('asa-hub:' + user.email);
    return true;
  }
  if (!appendIfMissing) return false;
  var now = new Date().toISOString();
  var vals = { candidate_id: cid, created_at: now, updated_at: now,
               created_by: 'asa-hub:' + user.email };
  for (var k2 in fields) vals[k2] = fields[k2];
  hubAppendRow_(tabName, vals);
  return true;
}

/** Status write on the candidate row + append to log_status_history. */
function hubSetStatus_(cid, newStatus, user) {
  var sheet = hubSheet_(TALENT_CANDIDATES_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('candidate_id'), iSt = hdr.indexOf('status');
  var iName = hdr.indexOf('candidate_name');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() !== cid) continue;
    var from = String(values[r][iSt] || '');
    sheet.getRange(r + 1, iSt + 1).setValue(newStatus);
    var iU = hdr.indexOf('updated_at');
    if (iU !== -1) sheet.getRange(r + 1, iU + 1).setValue(new Date().toISOString());
    var iB = hdr.indexOf('updated_by');
    if (iB !== -1) sheet.getRange(r + 1, iB + 1).setValue('asa-hub:' + user.email);
    hubLogStatus_(cid, String(values[r][iName] || ''), from, newStatus, user.email);
    // Entering ONBOARDING creates the person's own login — every path in
    // (drag, decision, sweep) passes through
    // this write, so the hook lives here once. Never blocks the move.
    // WHO MOVED IT decides whether the login may go inside the quiet window:
    // a person's own click, yes; a machine writer, no — it waits for 08:00
    // (Hired.gs onboardingByPerson_).
    try {
      if (typeof onboardingEnsureUser_ === 'function' &&
          talentStage_(newStatus) === 'onboarding') {
        onboardingEnsureUser_(cid, {
          by_person: (typeof onboardingByPerson_ === 'function') && onboardingByPerson_(user)
        });
      }
    } catch (eOU) {
      try { hubSysLog_('asa-hub:auto-onboard-user', 'onboarding_user_create_failed',
                       cid + ' — ' + String((eOU && eOU.message) || eOU), { status: 500 }); } catch (eL) {}
    }
    // THE UNIVERSAL CALENDAR HEARS THE ONBOARDING:
    // entering posts the account-issued day; leaving onboarding forward
    // posts the completion. Best-effort — the calendar may run an hour or
    // two behind the sweeps; the move may not.
    try {
      hubOnboardingCalendarNote_(cid, String(values[r][iName] || ''), from, newStatus);
    } catch (eCal) { /* the calendar catches up; the move never waits */ }
    return true;
  }
  return false;
}

/**
 * One row on the `events` tab per onboarding milestone — the universal
 * calendar (Schedule) reads that tab. Deterministic ids make the write
 * idempotent: a candidate bounced in and out of onboarding twice still
 * carries ONE started and ONE completed event, restamped never.
 */
function hubOnboardingCalendarNote_(cid, name, fromStatus, newStatus) {
  var stFrom = talentStage_(fromStatus), stTo = talentStage_(newStatus);
  var entered = stTo === 'onboarding' && stFrom !== 'onboarding';
  var completed = stFrom === 'onboarding' && stTo && stTo !== 'onboarding';
  if (!entered && !completed) return;
  var evId = (entered ? 'ev-onb-in-' : 'ev-onb-out-') + cid;
  var ss = ssOpen_(hubId_('HUB_DB_ID'));
  var have = false;
  try {
    readTabNormalized_(ss, 'events').forEach(function (ev) {
      if (str_(ev.id) === evId) have = true;
    });
  } catch (eR) { /* no events tab yet — the append below creates the row */ }
  if (have) return;
  hubAppendRow_('events', {
    id: evId,
    title: entered ? 'Onboarding started — ' + name + ' (account issued)'
                   : 'Onboarding completed — ' + name,
    personId: cid, personName: name,
    date: new Date().toISOString().slice(0, 10),
    start: entered ? '09:00' : '17:00',
    durationMin: 30, type: 'onboarding', attendees: '[]',
    notes: 'hiring pipeline · ' + (entered ? 'entered onboarding' : 'onboarding finished'),
    readOnly: 'TRUE'
  });
  // THE SAME SCOPE THE READER COMPUTES. A bare 'events' is only right at
  // headquarters: away from it cacheScope_ prefixes the place, so this bump
  // retired a key nobody was reading.
  try { cacheBump_(cacheScope_(EVENTS_TAB)); } catch (eB) { /* the slice turns on its own clock */ }
}

var HUB_INTERVIEWS_TAB = 'entity_in_person_interviews';

/** One open in-person interview per candidate, scheduled from the date the
 *  call agreed on (empty date → 'To Schedule'). Tab created on first use. */
function hubScheduleInterview_(cid, cand, when, user) {
  // An empty grid here reads as "nobody is scheduled" and this very function
  // would book them all a second time — so the tab is only ever made at the
  // address that actually answers for it.
  var sheet = hubTabEnsure_(HUB_INTERVIEWS_TAB,
    ['interview_id', 'candidate_id', 'candidate_name', 'scheduled_for',
     'source', 'status', 'created_at', 'created_by']);
  var values = sheet.getDataRange().getValues();
  var hdr0 = values[0].map(normKey_);
  var iCid = hdr0.indexOf('candidateid');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iCid]) === cid) return false;   // already scheduled
  }
  sheet.appendRow(['INT_' + randomHex_(10).toUpperCase(), cid,
    str_(cand && cand.candidatename), str_(when), 'phone-screen',
    str_(when) ? 'Scheduled' : 'To Schedule',
    new Date().toISOString(), 'asa-hub:' + (user && user.email ? user.email : 'system')]);
  return true;
}

/** Append one row to log_status_history (tab created on first use). */
function hubLogStatus_(cid, name, from, to, actor) {
  // A re-delivered decision re-runs the status write; from===to is that echo,
 // not a transition — no history row (review ).
  if (str_(from) === str_(to)) return;
  var sheet = hubTabEnsure_('log_status_history',
    ['timestamp', 'candidate_id', 'candidate_name', 'from_status', 'to_status', 'actor']);
  sheet.appendRow([new Date().toISOString(), cid, name, from, to, actor]);
}

/** Editor convenience: run the legacy import by hand (▶ Run in the editor). */
function runSyncFromLegacy() {
  var out = HUB_ACTIONS.syncFromLegacy({}, { role: 'admin', email: 'editor' });
  Logger.log(JSON.stringify(out));
  return out;
}

/**
 * ONE CLICK TO SYSTEM USERS: activating an account
 * never asks for a typed password — an unarmed one receives THE DEFAULT
 * from the FIRST_USER_PASSWORD Script Property (ONBOARDING_USER_PASSWORD
 * is honoured as the same value's older name); an account that already
 * HAS a password is only switched active — their own password is never
 * overwritten by a default.
 */
HUB_POLICY.userActivate = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  params: { user_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.userActivate = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var uid = str_(payload.user_id);
  var sheet = hubSheet_(USERS_TAB);
  // must_change is an additive column — created before the header lookup so
  // the default handed out below always has somewhere to be recorded.
  ensureUserProfileColumns_();
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid'), iSalt = hdr.indexOf('salt');
  var iHash = hdr.indexOf('passhash'), iActive = hdr.indexOf('active');
  var iMust = hdr.indexOf('mustchange');
  for (var r = values.length - 1; r >= 1; r--) {
    if (str_(values[r][iId]) !== uid) continue;
    var armed = !!str_(values[r][iHash]);
    var defaulted = false;
    if (!armed) {
      var pw = str_(hubProp_('FIRST_USER_PASSWORD')) ||
               str_(hubProp_('ONBOARDING_USER_PASSWORD'));
      if (!pw) {
        return { status: 500, message: 'Set the FIRST_USER_PASSWORD Script Property first — ' +
                 'activation hands every unarmed account that default.' };
      }
      var salt = randomHex_(32);
      sheet.getRange(r + 1, iSalt + 1).setValue(salt);
      sheet.getRange(r + 1, iHash + 1).setValue(hashPassword_(pw, salt));
      // THE DEFAULT IS A KEY FOR ONE USE — after the first login the person
      // is required to change the password. Only this
      // branch stamps: an account reactivated with its OWN password walks
      // straight in, exactly as it did yesterday.
      if (iMust !== -1) sheet.getRange(r + 1, iMust + 1).setValue('true');
      defaulted = true;
    }
    sheet.getRange(r + 1, iActive + 1).setValue('true');
    try {
      hubSysLog_(str_(user.email), 'user_activate',
                 uid + (defaulted ? ' — default password set, active' : ' — reactivated, own password kept'),
                 { status: 200 });
    } catch (eL) {}
    return { status: 200, data: { activated: true, defaulted: defaulted } };
  }
  return { status: 404, message: 'No user "' + uid + '".' };
};

/**
 * THE CENTRAL TAB LEARNS THE NUMBERS. The phone numbers are on the platform
 * already and the central tab was not being populated with them. The person's phone
 * often lives on the roster or the candidate row while the users tab is
 * blank. This fills the BLANKS — roster row with EXACTLY that name
 * (unique-match-only, the standing join law), then the candidate row matched
 * by sign-in e-mail. A number somebody typed is NEVER overwritten.
 */
function usersPhoneFill_(maxWrites) {
  var sheet = hubSheet_(USERS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iName = hdr.indexOf('displayname'), iPhone = hdr.indexOf('phone');
  var iEmail = hdr.indexOf('email');
  if (iPhone === -1) return { filled: 0, examined: 0, reason: 'users tab has no phone column' };
  // roster by exact name key — a key seen twice is ambiguous and SKIPPED
  var roster = {};
  try {
    listRows_('people', {}).forEach(function (p) {
      var k = '';
      try { k = clientNameKey_(str_(p.name)); } catch (e) { k = ''; }
      if (!k) return;
      roster[k] = Object.prototype.hasOwnProperty.call(roster, k)
        ? { ambiguous: true } : { phone: str_(p.phone) };
    });
  } catch (eR) { roster = {}; }
  var byEmail = {};
  try {
    readTabNormalized_(ssOpen_(TALENT_SHEET_ID), TALENT_CANDIDATES_TAB).forEach(function (c) {
      var em = str_(c.email).toLowerCase();
      if (em && str_(c.phone)) byEmail[em] = str_(c.phone);
    });
  } catch (eC) { byEmail = {}; }
  var filled = 0, cap = maxWrites || 100;
  for (var r = 1; r < values.length && filled < cap; r++) {
    if (str_(values[r][iPhone])) continue;   // fill-blank ONLY
    var phone = '';
    var k2 = '';
    try { k2 = clientNameKey_(str_(values[r][iName])); } catch (e2) { k2 = ''; }
    var hit = k2 ? roster[k2] : null;
    if (hit && !hit.ambiguous && str_(hit.phone)) phone = str_(hit.phone);
    if (!phone && iEmail !== -1) phone = str_(byEmail[str_(values[r][iEmail]).toLowerCase()]);
    if (!phone) continue;
    sheet.getRange(r + 1, iPhone + 1).setValue(phone);
    filled++;
  }
  return { filled: filled, examined: values.length - 1 };
}

// lane: tool — a capped fill-blank pass; running it twice changes nothing.
HUB_POLICY.usersPhoneBackfill = {
  file: 'HubCore.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersPhoneBackfill = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var out = usersPhoneFill_(100);
  try {
    hubSysLog_(str_(user.email), 'users_phone_backfill',
               out.filled + ' phone(s) filled from the roster/candidates', { status: 200 });
  } catch (eL) {}
  return { status: 200, data: out };
};

/**
 * QUO ENRICH — the phone provider's API is walked for the active users, to
 * collect more information about them. The phone system's
 * contact book fills the central tab — READ-ONLY toward Quo (GET /contacts,
 * never a message), and disciplined here: matching is BY KEY (the account's
 * e-mails and its numbers, last-10 digits, 7-digit floor), every write
 * passes Profile.gs' cleaners, extras APPEND with dedup, the single phone
 * column fills blanks only, the sign-in e-mail is never touched, a merged
 * row is never enriched. Idempotent: a second run finds nothing new.
 */
HUB_POLICY.usersQuoEnrich = {
  file: 'HubCore.gs', lane: 'tool', store: 'external',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.usersQuoEnrich = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var out = usersQuoEnrichCore_(100);
  if (out === null) return { status: 400, message: 'Set OPENPHONE_API_KEY in Script Properties first.' };
  if (out.error) return { status: 502, message: out.error };
  try {
    hubSysLog_(str_(user.email), 'users_quo_enrich',
               out.updated + ' account(s) enriched from ' + out.contacts + ' Quo contact(s): ' +
               out.phonesAdded + ' phone(s), ' + out.emailsAdded + ' e-mail(s)', { status: 200 });
  } catch (eL) {}
  return { status: 200, data: out };
};

/** The enrich itself — shared by the button and the 6h clock. Returns null
 *  when no API key is set, {error} when Quo answered nothing, else counts. */
function usersQuoEnrichCore_(cap) {
  var apiKey = hubProp_(SCRAPER_OPENPHONE_PROP);
  if (!apiKey) return null;
  try { ensureUserProfileColumns_(); } catch (eC) { /* additive; a missing column would only skip writes */ }

  var digits10 = function (v) { return String(v || '').replace(/\D+/g, '').slice(-10); };

  // The whole book, paginated — throttled like the host's own sync (0.3s
  // between pages avoids the 403), page-capped so a runaway book ends.
  var contacts = [], pageToken = '', pages = 0, fetchNote = '';
  while (pages < 80) {
    var url = 'https://api.openphone.com/v1/contacts?maxResults=50' +
              (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var resp;
    try {
      resp = UrlFetchApp.fetch(url, { headers: { Authorization: apiKey }, muteHttpExceptions: true });
    } catch (eF) { fetchNote = 'transport: ' + String((eF && eF.message) || eF); break; }
    if (resp.getResponseCode() !== 200) { fetchNote = 'HTTP ' + resp.getResponseCode(); break; }
    var body;
    try { body = JSON.parse(resp.getContentText()); } catch (eP) { fetchNote = 'unparseable page'; break; }
    (body.data || []).forEach(function (c) { contacts.push(c); });
    pages++;
    pageToken = str_(body.nextPageToken);
    if (!pageToken) break;
    Utilities.sleep(300);
  }
  if (!contacts.length) {
    return { error: 'Quo answered no contacts (' + (fetchNote || 'empty book') +
      ') — nothing was written.' };
  }

  var byEmail = {}, byDigits = {};
  contacts.forEach(function (c) {
    var df = (c && c.defaultFields) || {};
    (df.emails || []).forEach(function (e) {
      var k = str_(e && e.value).trim().toLowerCase();
      if (k) (byEmail[k] = byEmail[k] || []).push(c);
    });
    (df.phoneNumbers || []).forEach(function (p) {
      var d = digits10(p && p.value);
      if (d.length < 7) return;               // a fragment, not a phone
      (byDigits[d] = byDigits[d] || []).push(c);
    });
  });

  var out = { examined: 0, matched: 0, updated: 0, phonesAdded: 0, emailsAdded: 0,
              pages: pages, contacts: contacts.length, note: fetchNote };
  cap = cap || 100;
  usersAll_().forEach(function (row) {
    if (out.updated >= cap) return;
    if (str_(row.mergedinto)) return;                        // folded rows never enriched
    if (str_(row.active).toLowerCase() === 'false') return;  // active users only (the ask)
    out.examined++;

    var signIn = str_(row.email).trim().toLowerCase();
    var mine = {};
    var claim = function (c) { if (c && c.id) mine[c.id] = c; };
    if (signIn) (byEmail[signIn] || []).forEach(claim);
    profileParseEmails_(row.emails).forEach(function (e) {
      (byEmail[str_(e).trim().toLowerCase()] || []).forEach(claim);
    });
    var ownDigits = {};
    var takeOwn = function (v) { var d = digits10(v); if (d.length >= 7) ownDigits[d] = true; };
    takeOwn(row.phone);
    profileParsePhones_(row.phones).forEach(function (p) { takeOwn(p && p.number); });
    Object.keys(ownDigits).forEach(function (d) { (byDigits[d] || []).forEach(claim); });

    var ids = Object.keys(mine);
    if (!ids.length) return;
    out.matched++;

    var phones = profileParsePhones_(row.phones);
    var have = {};
    phones.forEach(function (p) { have[digits10(p && p.number)] = true; });
    have[digits10(row.phone)] = true;
    var emails = profileParseEmails_(row.emails);
    var haveEm = {};
    emails.forEach(function (e) { haveEm[str_(e).trim().toLowerCase()] = true; });

    var added = 0, addedEm = 0;
    ids.forEach(function (cid) {
      var df = (mine[cid] && mine[cid].defaultFields) || {};
      (df.phoneNumbers || []).forEach(function (p) {
        var num = str_(p && p.value).trim();
        var d = digits10(num);
        if (!num || d.length < 7 || have[d]) return;
        have[d] = true;
        phones.push({ label: str_(p && p.name).slice(0, 24) || 'Quo', number: num });
        added++;
      });
      (df.emails || []).forEach(function (e) {
        var em = str_(e && e.value).trim();
        var k = em.toLowerCase();
        // the sign-in column is IDENTITY, not contact info — never mirrored
        if (!em || em.indexOf('@') === -1 || k === signIn || haveEm[k]) return;
        haveEm[k] = true;
        emails.push(em);
        addedEm++;
      });
    });
    if (!added && !addedEm) return;   // nothing new, nothing written

    var fields = {};
    var cleanP = profileCleanPhones_(phones);
    var cleanE = profileCleanEmails_(emails);
    if (added) fields.phones = JSON.stringify(cleanP);
    if (addedEm) fields.emails = JSON.stringify(cleanE);
    if (!str_(row.phone) && cleanP.length) fields.phone = cleanP[0].number;  // fill-blank ONLY
    if (userSetFields_(str_(row.userid), fields)) {
      out.updated++;
      out.phonesAdded += added;
      out.emailsAdded += addedEm;
    }
  });
  return out;
}

/**
 * THE CONTACT CLOCK. Quo Enrich and Fill phones have to happen
 * automatically, as a user's updates happen. A time trigger — its own
 * execution, because the Quo walk is
 * minutes by nature and must never ride inside somebody's read. Every 2
 * hours, because six is too long a wait: the roster/candidate
 * phone fill, then the Quo book. ~12 walks a day is ~720 fetches against a
 * 20k/day quota — light. The buttons stay for the moment somebody cannot
 * wait; both lanes are idempotent, so the clock and the hand never fight.
 */
/**
 * THE STAMP THAT MAKES ANY CADENCE POSSIBLE — a schedule of, say, every
 * three hours.
 *
 * ScriptApp's everyHours() accepts 1, 2, 4, 6, 8 and 12 — THREE IS NOT ONE OF
 * THEM, and there is no way to ask the trigger API for it. So the trigger
 * fires HOURLY and the work decides: it runs when the configured hours have
 * passed since the last real pass, and returns immediately otherwise.
 *
 * The cost of the extra ticks is a property read and a comparison — the same
 * shape as every *SweepMaybe_ in this platform, and the reason those exist.
 * The interval is never SHORTER than configured; it lands on the first hourly
 * tick after the window opens.
 */
var CONTACT_SWEEP_STAMP = 'CONTACT_SWEEP_AT';

function contactSweepDue_() {
  var hours = contactSweepHours_();
  var last = 0;
  try { last = Number(hubProp_(CONTACT_SWEEP_STAMP) || 0) || 0; } catch (e) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) < hours * 3600000) return false;
  // The stamp goes down FIRST: a pass that throws halfway must not re-enter on
  // the very next tick and spend the Quo walk again.
  try { hubPropSet_(CONTACT_SWEEP_STAMP, String(now)); } catch (eS) { /* the clock still turns */ }
  return true;
}

/**
 * THE ACCOUNT PASSES, ON THEIR OWN CLOCK — both of them run every two hours.
 *
 * They ride the SAME hourly tick as the contact clock and keep their OWN
 * window, because the two answer different questions and must be tunable
 * apart. No second trigger to install: one tick, two gates.
 *
 * They are safe to run unattended for one reason, and it is the reason the
 * identity gate exists — neither pass can create an account for somebody who
 * already has one, and a name that merely LOOKS like an existing person is
 * reported, never acted on.
 */
var USERS_BULK_STAMP = 'USERS_BULK_AT';
var USERS_BULK_HOURS = 2;

function usersBulkDue_() {
  var last = 0;
  try { last = Number(hubProp_(USERS_BULK_STAMP) || 0) || 0; } catch (e) { last = 0; }
  var now = new Date().getTime();
  if (last && (now - last) < USERS_BULK_HOURS * 3600000) return false;
  // Stamp first: a pass that throws halfway must not re-enter next tick.
  try { hubPropSet_(USERS_BULK_STAMP, String(now)); } catch (eS) { /* the clock still turns */ }
  return true;
}

/** Both account passes, once every USERS_BULK_HOURS. Silent when they make
 *  nothing — a log line per tick would bury the ones that matter. */
function usersBulkAutoSweep_() {
  if (!usersBulkDue_()) return;
  var who = { role: 'admin', email: 'asa-hub:auto-users', is_service: false };
  ['usersFromPeople', 'usersFromSigned'].forEach(function (action) {
    try {
      var r = HUB_ACTIONS[action]({}, who);
      var d = (r && r.data) || {};
      if (d.created || d.near) {
        hubSysLog_('trigger', action,
                   (d.created || 0) + ' created, ' + (d.already || 0) + ' already, ' +
                   (d.near || 0) + ' look like existing people' +
                   ((d.near_named && d.near_named.length) ? ': ' + d.near_named.slice(0, 6).join(' · ') : ''),
                   { status: 200 });
      }
    } catch (e) {
      hubSysLog_('trigger', action + '_error', String((e && e.message) || e), { status: 500 });
    }
  });
}

function contactAutoSweep() {
  // THE REPAIR PASS IS NOT RUNG HERE, AND THAT IS DELIBERATE.
  //
  // It was, once — first on this tick, ahead of the compliance rehearsal
  // below, for the right reason: a correction drained behind sixty-four
  // compliance intents inherits their ninety-second budget and their cursor,
  // so `repair`'s right to skip the pacing gap buys nothing. The reason was
  // right and the clock was wrong. THIS FUNCTION IS A TIME TRIGGER THAT HAS
  // NEVER BEEN INSTALLED: no `contactAutoSweep` row exists under the `trigger`
  // actor in the whole log, while commsSync — the trigger that IS installed —
  // has thousands. So the pass never ran, for the same reason the comms lane
  // never ran before it escaped.
  //
  // The relay rings `commRepairSweep` instead, on the loop that actually
  // ticks (_comm_repair_tick in server/snapshot_service.py), and it rings it
  // BEFORE commRecordSweep so the order survives the move. One clock, and it
  // is not this one — putting the call back would give the lane two, and the
  // shared stamp would hide the double rather than settle it.
  // The account passes keep their own window on this same tick.
  try { usersBulkAutoSweep_(); } catch (eU) {
    hubSysLog_('trigger', 'users_bulk_sweep_error', String((eU && eU.message) || eU), { status: 500 });
  }
  // THE PLATFORM CONTACTS MERGE rides the same tick behind its own window
 // (ContactsSync.gs): the roster rows the platform refreshed
  // reach the accounts — blank-only, plural contexts, the durable link.
  try { if (typeof contactsMergeAutoSweep_ === 'function') contactsMergeAutoSweep_(); } catch (eM) {
    hubSysLog_('trigger', 'users_contact_merge_error', String((eM && eM.message) || eM), { status: 500 });
  }
  // The behaviour readings' 6h pass is Python's (app/behavior*), rung by the relay's clock.
  // AND THE COMMS LANE, behind its own 6h window (CommRecord.gs). It refuses
  // to run at all while the dial is off (test mode unreadable — the dial
  // follows test mode, CommIntent.gs commDialRead_), and at `record` it works out who
  // would be contacted, about what, through which route and why — and writes
  // that down without contacting anybody. At `send` the same pass hands each
  // cleared intent to the transport through `commRecordSend_`, which is the
  // lane's ONE door to a person and the door the repair pass uses too.
  // THIS CALL IS DEAD WOOD for as long as the trigger stays uninstalled: the
  // relay is what actually rings `commRecordSweep`. If somebody ever installs
  // contactAutoSweep, this line comes out first — the engine's six-hour stamp
  // would refuse the second caller silently, and a double nobody can see is
  // worse than one nobody has.
  try { if (typeof commRecordSweepMaybe_ === 'function') commRecordSweepMaybe_(); } catch (eC) {
    hubSysLog_('trigger', 'comm_record_error', String((eC && eC.message) || eC), { status: 500 });
  }
  if (!contactSweepDue_()) return;
  try {
    var f = usersPhoneFill_(100);
    if (f.filled) {
      hubSysLog_('trigger', 'users_phone_fill',
                 f.filled + ' phone(s) filled from the roster/candidates', { status: 200 });
    }
  } catch (eF) {
    hubSysLog_('trigger', 'users_phone_fill_error', String((eF && eF.message) || eF), { status: 500 });
  }
  try {
    var q = usersQuoEnrichCore_(100);
    if (q === null) return;   // no API key — the button says it loudly; the clock stays quiet
    if (q.error) {
      hubSysLog_('trigger', 'users_quo_enrich_error', q.error, { status: 502 });
    } else if (q.updated) {
      hubSysLog_('trigger', 'users_quo_enrich',
                 q.updated + ' account(s) enriched from ' + q.contacts + ' Quo contact(s): ' +
                 q.phonesAdded + ' phone(s), ' + q.emailsAdded + ' e-mail(s)', { status: 200 });
    }
  } catch (eQ) {
    hubSysLog_('trigger', 'users_quo_enrich_error', String((eQ && eQ.message) || eQ), { status: 500 });
  }
}

/** The clock's cadence, from the `contact_sweep_hours` config row — changed
 *  in Settings at any time, 2 hours by default. Only the hours the trigger
 *  API accepts; anything else falls back to 2. */
function contactSweepHours_() {
  var h = 2;
  try { h = parseInt(str_(hiringAlerts_().contact_sweep_hours), 10); } catch (e) { h = 2; }
  // ANY WHOLE NUMBER OF HOURS NOW, because the gate above decides and the
  // trigger merely ticks. Bounded so a typo cannot silence the clock for a
  // month or beat the platform once a minute.
  if (!(h >= 1) || h > 24) h = 2;
  return h;
}

/** Installs the contact clock at the configured cadence — safe to re-run,
 *  an existing trigger is replaced, never duplicated. Runs from the editor
 *  (▶ Run) or through the `contactSweepInstall` action in Settings. */
function installContactSweepTrigger() {
  var hours = contactSweepHours_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'contactAutoSweep') ScriptApp.deleteTrigger(t);
  });
  // HOURLY TICK, the configured window inside. everyHours() cannot express 3,
  // and asking it for the nearest legal value would silently give somebody 2
  // or 4 when they typed 3.
  ScriptApp.newTrigger('contactAutoSweep').timeBased().everyHours(1).create();
  Logger.log('contactAutoSweep: hourly tick, acting every ' + hours +
             ' hours (phones fill + Quo enrich).');
  return hours;
}

// lane: tool — reinstalls the contact clock at the configured cadence; the
// Settings card calls it after saving contact_sweep_hours. Idempotent:
// replace-never-duplicate.
HUB_POLICY.contactSweepInstall = {
  file: 'HubCore.gs', lane: 'tool', store: 'external',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.contactSweepInstall = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var hours;
  try { hours = installContactSweepTrigger(); }
  catch (e) {
    return { status: 500, message: 'The trigger could not be installed (' +
      String((e && e.message) || e) + ') — run installContactSweepTrigger in the editor once.' };
  }
  try {
    hubSysLog_(str_(user.email), 'contact_sweep_install',
               'contact clock installed — every ' + hours + 'h', { status: 200 });
  } catch (eL) {}
  return { status: 200, data: { installed: true, hours: hours } };
};

/**
 * MERGE BY THE HUMAN'S HAND. Two rows may carry the very same name and the
 * automatic Merge will still not fold them: it folds only what it can PROVE
 * is one person; this one folds what the ADMIN says is one person — the
 * selected rows, into the keeper. The folded accounts' sign-in e-mail and
 * every phone/extra e-mail are GATHERED onto the keeper (people carry many
 * of both); candidate link and types fill blanks; NOTHING IS DELETED — a
 * folded row is stamped `merged_into` + deactivated, and every list skips
 * it. Reversible on the sheet by clearing the stamp.
 */
HUB_POLICY.userMergeManual = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  params: { keep_id: { required: true, type: 'string' } },
  invalidates: [], emits: []
};
HUB_ACTIONS.userMergeManual = function (payload, user) {
  if (!user || user.is_service || str_(user.role) !== 'admin') return hubDenied_();
  var keepId = str_(payload.keep_id);
  var foldIds = (Array.isArray(payload.fold_ids) ? payload.fold_ids : [])
    .map(function (x) { return str_(x); })
    .filter(function (x) { return x && x !== keepId; });
  if (!foldIds.length) return { status: 400, message: 'Pick at least one row to fold.' };

  var sheet = hubSheet_(USERS_TAB);
  ensureUserProfileColumns_();
  ensureHeader_(sheet, ['merged_into']);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var col = {};
  ['userid', 'email', 'displayname', 'phone', 'phones', 'emails', 'candidateid',
   'types', 'title', 'active', 'mergedinto'].forEach(function (k) { col[k] = hdr.indexOf(k); });

  var keepRow = 0, folds = [];
  for (var r = 1; r < values.length; r++) {
    var id = str_(values[r][col.userid]);
    if (id === keepId) keepRow = r;
    else if (foldIds.indexOf(id) !== -1) folds.push(r);
  }
  if (!keepRow) return { status: 404, message: 'No user "' + keepId + '".' };
  if (folds.length !== foldIds.length) return { status: 404, message: 'A selected row no longer exists.' };

  var cell = function (row, key) { return str_(values[row][col[key]]); };
  var listCell = function (row, key) {
    var raw = cell(row, key);
    try { var p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) {}
    return raw ? raw.split(/[,;|\n]+/).map(function (x) { return x.trim(); }).filter(String) : [];
  };

  // gather: the keeper's own facts first, the folds' behind them
  var emails = listCell(keepRow, 'emails');
  var phones = listCell(keepRow, 'phones');
  var keepEmail = cell(keepRow, 'email').toLowerCase();
  var candidateId = cell(keepRow, 'candidateid');
  var types = cell(keepRow, 'types');
  var title = cell(keepRow, 'title');
  var phone = cell(keepRow, 'phone');
  folds.forEach(function (fr) {
    var fe = cell(fr, 'email').toLowerCase();
    if (fe && fe !== keepEmail && emails.map(function (x) { return String(x).toLowerCase(); }).indexOf(fe) === -1) emails.push(fe);
    listCell(fr, 'emails').forEach(function (x) {
      var lx = String(x).toLowerCase();
      if (lx && lx !== keepEmail && emails.map(function (y) { return String(y).toLowerCase(); }).indexOf(lx) === -1) emails.push(x);
    });
    var fp = cell(fr, 'phone');
    var foldPhones = listCell(fr, 'phones');
    if (fp) foldPhones.push({ label: 'Phone', number: fp });
    foldPhones.forEach(function (p) {
      var num = str_(p && (p.number || p));
      if (!num) return;
      var have = phones.some(function (q) { return str_(q && (q.number || q)) === num; }) || num === phone;
      if (!have) phones.push(p && p.number ? p : { label: 'Phone', number: num });
    });
    if (!candidateId) candidateId = cell(fr, 'candidateid');
    if (!types) types = cell(fr, 'types');
    if (!title) title = cell(fr, 'title');
    if (!phone) { phone = fp; }
  });
  // a fold may not carry a master-granted badge onto the keeper for anyone else
  var mergeGrantBad = hubBadgeGrantRefused_(user, cell(keepRow, 'types'), types);
  if (mergeGrantBad) return mergeGrantBad;

  var setCell = function (row, key, val) {
    if (col[key] !== -1) sheet.getRange(row + 1, col[key] + 1).setValue(val);
  };
  setCell(keepRow, 'emails', JSON.stringify(profileCleanEmails_(emails)));
  setCell(keepRow, 'phones', JSON.stringify(profileCleanPhones_(phones)));
  if (candidateId) setCell(keepRow, 'candidateid', candidateId);
  if (types) setCell(keepRow, 'types', types);
  if (title) setCell(keepRow, 'title', title);
  if (phone) setCell(keepRow, 'phone', phone);
  folds.forEach(function (fr) {
    setCell(fr, 'mergedinto', keepId);
    setCell(fr, 'active', 'false');
  });
  try {
    hubSysLog_(str_(user.email), 'user_merge_manual',
               keepId + ' ← ' + foldIds.join(', ') + ' (' + cell(keepRow, 'displayname') + ')',
               { status: 200 });
  } catch (eL) {}
  return { status: 200, data: { kept: keepId, folded: foldIds.length } };
};

/* ====================================================================== *
 * THE INVITATION
 *
 * One letter, sent on purpose — not a side effect of creating an account. An
 * invitation that left automatically at creation would reach people whose
 * rows were still being prepared, and this platform creates accounts
 * long before it means to hand them out.
 *
 * WHAT IT WILL AND WILL NOT SAY. An account still on the shared default gets
 * the default printed, beside the sentence that it is not private and will be
 * taken away at the first sign-in. An account that already carries its own
 * password gets the SAME letter with no password in it: printing a default
 * that no longer opens the door would send somebody to a screen that refuses
 * them.
 *
 * A LOGIN THAT IS NOT AN ADDRESS CANNOT BE WRITTEN TO. Client and guardian
 * accounts may sign in with phone digits (clientUserCreate); those rows are
 * reported back as skipped, by name, rather than counted as sent.
 *
 * IT IS THE INVITATION. The letter hands a person the way into an account,
 * so it claims the `invitation` kind of the authentication letters
 * (HUB_AUTH_LETTERS, Rpc.gs) on its e-mail leg: delivered while the lane
 * holds, its outbox row saying so, and silent altogether while the
 * invitation's situation (auth_invitation) is off or unreadable — the one
 * switch that stops every invitation. Its words are a login and a first
 * password, not a registration link, so they live in their own row
 * (user_account_invite), whose switch arrives off like every new message.
 * The text leg claims nothing: test mode and the sending switch hold it,
 * and a first password is never texted to a shared line.
 *
 * THE ANSWER SAYS WHAT HAPPENED, per account: sent (a leg left), held (a
 * brake kept every leg back), already (the same text left earlier) or
 * refused (the sentence says why); and for the whole press, off or held
 * when a switch stopped it before anybody was written to.
 * ====================================================================== */

/** Send an existing account its way in (sign-in and first password) as the invitation; the answer says sent, held or refused per account. */
HUB_POLICY.userInvite = {
  file: 'HubCore.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin'],
  params: { user_ids: { required: true, type: 'array' } },
  invalidates: [], emits: ['emailSend']
};
HUB_ACTIONS.userInvite = function (payload, user) {
  if (!user || str_(user.role) !== 'admin') return hubDenied_();
  if (user.is_service) return { status: 403, message: 'A service session does not invite people.' };
  var ids = Array.isArray(payload && payload.user_ids) ? payload.user_ids : [];
  if (!ids.length) return { status: 400, message: 'user_ids: at least one account.' };
  if (ids.length > 50) return { status: 400, message: 'Fifty invitations at a time is the cap.' };

  var defaultPw = str_(hubProp_('FIRST_USER_PASSWORD')) ||
                  str_(hubProp_('ONBOARDING_USER_PASSWORD'));

  /* Both switches, asked once, before anybody is written to: the
     invitation's (auth_invitation) and this letter's own row. */
  var inviteGate = userInviteGate_();
  if (!inviteGate.on) {
    hubSysLog_(str_(user.email), 'user_invite_situation', inviteGate.why,
               { status: inviteGate.state === 'held' ? 502 : 200 });
    return { status: 200, data: { state: inviteGate.state, situation: inviteGate.situation,
                                  planted: inviteGate.planted,
                                  why: 'Nobody was invited: ' + inviteGate.why + '.',
                                  sent: [], held: [], skipped: [] } };
  }
  var sitRow = inviteGate.row;

  var sheet = hubSheet_(USERS_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('userid'), iEmail = hdr.indexOf('email');
  var iName = hdr.indexOf('displayname'), iHash = hdr.indexOf('passhash');
  var iMust = hdr.indexOf('mustchange'), iActive = hdr.indexOf('active');
  var iLast = hdr.indexOf('lastlogin');
  // the number the text leg uses, when the account carries one beside its login
  var iPhone = hdr.indexOf('phone');

  var sent = [], held = [], skipped = [];
  for (var n = 0; n < ids.length; n++) {
    var uid = str_(ids[n]);
    var row = -1;
    for (var r = 1; r < values.length; r++) {
      if (str_(values[r][iId]) === uid) { row = r; break; }
    }
    if (row === -1) { skipped.push({ id: uid, why: 'no such account' }); continue; }
    var email = str_(values[row][iEmail]);
    var who = str_(values[row][iName]) || email;
    // A digits login is a login, not a mailbox.
    // A number is a way to reach somebody — the phone leg lives below, after
    // the shared-default question is answered. This only refuses an account
    // that has NEITHER a usable address NOR a textable number.
    if (email.indexOf('@') === -1 &&
        !(typeof packetSendableNumber_ === 'function' && packetSendableNumber_(email))) {
      skipped.push({ id: uid, name: who, why: 'no address, and the number cannot be texted' });
      continue;
    }
    if (iActive !== -1 && str_(values[row][iActive]).toLowerCase() !== 'true') {
      skipped.push({ id: uid, name: who, why: 'the account is not active yet' });
      continue;
    }
    // Still on the shared default? The stamp says so, and so does an account
    // that has never signed in and has no password of its own.
    var onDefault = (iMust !== -1 && str_(values[row][iMust]).toLowerCase() === 'true') ||
                    (iHash !== -1 && !str_(values[row][iHash])) ||
                    (iLast !== -1 && !str_(values[row][iLast]));
    if (onDefault && !defaultPw) {
      skipped.push({ id: uid, name: who, why: 'FIRST_USER_PASSWORD is not set on this project' });
      continue;
    }
    /**
     * THE LETTER AND THE TEXT
     *
     * This action had ONE channel and refused everybody else — "signs in with
     * a number, not an address", which read as a fact about the platform and
     * was really a limit of this function. Both legs run now, exactly as the
     * onboarding account has done since it existed (Hired.gs): the letter
     * carries the detail, the text carries the short version, and a person
     * hears one thing however they were let in.
     *
     * The invitation counts as SENT if EITHER leaves now. It is HELD when a
     * brake kept every leg back, and a refusal only when nothing reached them
     * and no brake is the reason.
     */
    var pw = onDefault ? defaultPw : '';
    var legs = [];
    var inviter = str_(user.display_name || user.name);
    var url = mailPlatformUrl_();
    var chans = (typeof smartList_ === 'function') ? smartList_(sitRow.channels) : [];
    var vars = { first_name: who.split(' ')[0], name: who, login: email, url: url,
                 inviter: inviter, by_inviter: inviter ? ' — ' + inviter + ' set it up for you' : '',
                 password_line: pw ? ' — first-time password: ' + pw + ' (you will choose your own at sign-in).' : '.' };
    /* THE PASSWORD NEVER REACHES A BOOK: held for the call (any length) and
       named as `withhold` on both legs (hubSecretScrub_, hubWithhold_). */
    if (pw && typeof hubSecretsHold_ === 'function') hubSecretsHold_([pw]);
    try {
      if (email.indexOf('@') !== -1 && chans.indexOf('email') !== -1 && str_(sitRow.email_text)) {
        var letter = userInviteLetter_(sitRow, vars, email, pw, url);
        /* THE LETTER CLAIMS THE INVITATION: test mode and the sending switch
           do not hold it, a person's opt-out still does. A sign-in letter
           asked for now, so the quiet window does not hold it either. */
        var res;
        try {
          res = rpcCall_('emailSend', {
            to: email, subject: letter.subject, body: letter.text, html: letter.html,
            reason: 'smart comms: ' + USER_INVITE_SITUATION, withhold: pw ? [pw] : '',
            auth_letter: USER_INVITE_AUTH_KIND
          }, { quiet_exempt: 'sign_in' });
        } catch (eM) { res = { ok: false, error: String((eM && eM.message) || eM) }; }
        legs.push(userInviteLeg_('email', 'the letter', res));
      }

      // The number the account itself carries, or the login when the login IS one.
      var rawNum = (iPhone !== -1 ? str_(values[row][iPhone]) : '') ||
                   (email.indexOf('@') === -1 ? email : '');
      var toNum = (typeof packetSendableNumber_ === 'function') ? packetSendableNumber_(rawNum) : '';
      /* A FIRST PASSWORD IS NEVER TEXTED TO A SHARED LINE, as the release invite refuses it
         (commReleaseSharedLine_). FAIL-CLOSED: without the reader the line is not assumed private. */
      var canAskShared = typeof commReleaseSharedLine_ === 'function';
      var sharedLine = !!(toNum && pw && (!canAskShared || commReleaseSharedLine_(toNum)));
      if (sharedLine && chans.indexOf('sms') !== -1 && str_(sitRow.sms_text)) {
        legs.push({ channel: 'sms', state: 'refused',
                    why: 'the text refused: ' + (canAskShared
                      ? 'that number is a shared line — a first-time password is not texted there'
                      : 'whether that number is a shared line could not be asked — a first-time password is not texted blind') });
      } else if (toNum && chans.indexOf('sms') !== -1 && str_(sitRow.sms_text)) {
        var smsBody = (typeof smartRender_ === 'function') ? smartRender_(sitRow.sms_text, vars) : str_(sitRow.sms_text);
        // One key per account: a re-press must not text somebody twice. A text claims nothing.
        var rSms;
        try {
          rSms = rpcCall_('smsSend', { to: toNum, body: smsBody,
            reason: 'smart comms: ' + USER_INVITE_SITUATION, withhold: pw ? [pw] : ''
          }, { idempotency_key: 'invite_sms_' + uid, quiet_exempt: 'sign_in' });
        } catch (eS) { rSms = { ok: false, error: String((eS && eS.message) || eS) }; }
        legs.push(userInviteLeg_('sms', 'the text', rSms));
      }
    } finally {
      if (pw && typeof hubSecretsRelease_ === 'function') hubSecretsRelease_();
    }

    var outcome = userInviteOutcome_(legs);
    var why = legs.filter(function (l) { return l.state !== 'sent'; })
                  .map(function (l) { return l.why; }).join(' · ');
    var entry = { id: uid, name: who, email: email, state: outcome, with_password: !!onDefault,
                  via: legs.filter(function (l) { return l.state === 'sent'; })
                           .map(function (l) { return l.channel; }).join('+'),
                  why: why };
    if (outcome === 'sent') {
      sent.push(entry);
      // Ledger only when something really left, so a held press stays one that can be pressed again.
      if (typeof smartRecord_ === 'function' && typeof smartLedgerKey_ === 'function') {
        try {
          smartRecord_(smartLedgerKey_(USER_INVITE_SITUATION, email || uid, new Date().toISOString().slice(0, 10)),
                       USER_INVITE_SITUATION, who, '', entry.via || 'email');
        } catch (eR) { /* the letter left; its ledger line is not worth a second send */ }
      }
    } else if (outcome === 'held' || outcome === 'already') {
      held.push(entry);
    } else {
      entry.why = why || ('the situation ' + USER_INVITE_SITUATION + ' writes no letter or text ' +
                          'this account can receive');
      skipped.push(entry);
    }
  }
  // One word for the press when every account came out the same, else `mixed`; each list says its own.
  var states = sent.concat(held, skipped).map(function (e) { return e.state || 'refused'; });
  var state = states.every(function (s) { return s === states[0]; }) ? (states[0] || 'refused') : 'mixed';
  try {
    hubSysLog_(str_(user.email), 'user_invite',
               sent.length + ' invitation(s) sent, ' + held.length + ' held, ' + skipped.length + ' refused',
               { status: 200 });
  } catch (eL) {}
  return { status: 200, data: { state: state, situation: USER_INVITE_SITUATION, why: '',
                                sent: sent, held: held, skipped: skipped } };
};

/** The authentication-letter kind the account invitation claims on its e-mail leg (HUB_AUTH_LETTERS). */
var USER_INVITE_AUTH_KIND = 'invitation';

/**
 * MAY THE ACCOUNT INVITATION GO AT ALL? — { on, row, state, situation, planted, why }.
 * The invitation's switch first (auth_invitation stops every invitation),
 * then this letter's own row. FAIL-CLOSED: an unreadable switch, or a reader
 * missing from a partial push, holds the press and says so. `planted` is
 * false only for an `off` whose row is not in the situations tab yet, and
 * null while the tab could not be read.
 */
function userInviteGate_() {
  var kind;
  try {
    kind = (typeof hubAuthLetterAllowed_ === 'function')
      ? hubAuthLetterAllowed_(USER_INVITE_AUTH_KIND)
      : { on: false, unreadable: true, why: 'the authentication letters\' switch is not in this build' };
  } catch (e) {
    kind = { on: false, unreadable: true, why: String((e && e.message) || e) };
  }
  var sid = (typeof hubAuthSituationId_ === 'function')
    ? hubAuthSituationId_(USER_INVITE_AUTH_KIND) : 'auth_invitation';
  if (!kind || !kind.on) {
    // A missing auth row is a yes (hubAuthLetterAllowed_), so an `off` here is a planted row switched off.
    return kind && !kind.unreadable
      ? { on: false, row: null, state: 'off', situation: sid, planted: true,
          why: 'the invitation situation (' + sid + ') is switched off in Smart Comms, and it stops every ' +
               'invitation, this one too' }
      : { on: false, row: null, state: 'held', situation: sid, planted: null,
          why: 'the invitation situation (' + sid + ') could not be read, so the invitation is held — an ' +
               'unreadable switch is never a yes; asked again once the tab answers, it leaves' };
  }
  var own = (typeof hubSituationGate_ === 'function')
    ? hubSituationGate_(USER_INVITE_SITUATION)
    : { on: false, row: null, unreadable: true,
        why: 'the Smart Comms situations are not in this build — nothing was sent' };
  if (!own.on) {
    return { on: false, row: null, state: own.unreadable ? 'held' : 'off', situation: USER_INVITE_SITUATION,
             planted: own.unreadable ? null : !!own.row, why: String(own.why || '') };
  }
  return { on: true, row: own.row, state: '', situation: USER_INVITE_SITUATION, planted: true, why: '' };
}

/**
 * ONE LEG'S ANSWER IN THE INVITE'S WORDS — { channel, state, why }.
 * sent: it left to the person. already: this exact message left earlier and
 * was not sent again. held: a brake kept it (test mode, the sending switch,
 * the quiet window), named. refused: the person's opt-out, or the door said no.
 */
function userInviteLeg_(channel, label, r) {
  if (r && r.ok && r.sent && !r.redirected) return { channel: channel, state: 'sent', why: '' };
  if (r && r.deduplicated) {
    return { channel: channel, state: 'already', why: label + ': the same message already went out — not sent again' };
  }
  if (r && r.ok && !r.sent && str_(r.reason) === 'opted_out') {
    return { channel: channel, state: 'refused', why: label + ' refused: the person asked us to stop' };
  }
  if (r && r.ok && (r.redirected || r.gated || r.rehearsed || r.recorded_to || r.quiet || !r.sent)) {
    var brake = (typeof commReleaseHeldReason_ === 'function') ? commReleaseHeldReason_(r) : '';
    return { channel: channel, state: 'held',
             why: label + ' held' + (brake ? ' (' + brake + ')' : '') + ': ' +
                  str_(r.detail || r.reason || (r.redirected ? 'test mode redirected it' : 'a brake')) };
  }
  return { channel: channel, state: 'refused',
           why: label + ' refused: ' + (str_(r && (r.error || r.detail)) || 'the send door refused it') };
}

/** An account's outcome from its legs: any sent is sent, then held, then already, else refused. */
function userInviteOutcome_(legs) {
  var has = function (s) { return (legs || []).some(function (l) { return l.state === s; }); };
  if (has('sent')) return 'sent';
  if (has('held')) return 'held';
  if (has('already')) return 'already';
  return 'refused';
}

/** The Smart Comms situation the account invitation speaks through (SmartGate.gs hubDisabledLetterSeeds_). */
var USER_INVITE_SITUATION = 'user_account_invite';

/** The invitation letter in the row's words; the sign-in and the password ride as facts. */
function userInviteLetter_(row, vars, login, pw, url) {
  var render = function (t) {
    return (typeof smartRender_ === 'function') ? smartRender_(String(t || ''), vars) : String(t || '');
  };
  var subject = render(row.email_subject) || 'Your ASA LifeCare account';
  var body = render(row.email_text);
  var blocks = (typeof commReleaseBlocks_ === 'function') ? commReleaseBlocks_(body) : [mailPara_(mailEsc_(body))];
  blocks.push(mailFact_('Your sign-in', login, true));
  if (pw) {
    blocks.push(mailFact_('First-time password', pw, true));
    blocks.push(mailPara_('<strong>This password is not yours and is not private.</strong> It is the one ' +
      'every new account starts on, so the platform asks you to choose your own the moment you sign in.'));
  }
  var text = body + '\n\nSign-in: ' + login +
             (pw ? '\nFirst-time password: ' + pw + ' (not private — you choose your own at sign-in)' : '') +
             '\n' + url;
  var html = mailShell_({ title: subject, preheader: 'Your account is ready to use.', blocks: blocks,
                          cta: url ? { href: url, label: 'Open the platform' } : null });
  return { subject: subject, text: text, html: html };
}
