/** No address or SSN is mirrored: response_data carries both, and screens read this tab. */

var RECRUIT_TAB = 'recruitment_contracts';
var RECRUIT_CONFIG_TAB = 'recruitment_config';

var RECRUIT_CONFIG_KEYS = ['title_contains', 'status_signed', 'status_pending',
                           'status_declined', 'sync_minutes', 'max_pages', 'mirror_phone'];

function recruitCfgDefault_(key) {
  return bookText_('Strings', 'recruit.cfg.' + String(key || ''), '');
}

// keyed by envelope id, never by row: the sync re-sorts and clears the mirror every run
var RECRUIT_DOCS_TAB = 'recruitment_docs';

function recruitDocsSheet_() {
  return hubTabEnsure_(RECRUIT_DOCS_TAB,
    ['signature_request_id', 'doc_url', 'fetched_at', 'fetched_by']);
}

function recruitDocCached_(srid) {
  try {
    var values = recruitDocsSheet_().getDataRange().getValues();
    for (var r = values.length - 1; r >= 1; r--) {
      if (String(values[r][0]).trim() === srid) return String(values[r][1] || '').trim();
    }
  } catch (e) { }
  return '';
}

function recruitConfigSheet_() {
  var existed = !!hubTabSheet_(RECRUIT_CONFIG_TAB);
  var sheet = hubTabEnsure_(RECRUIT_CONFIG_TAB, ['key', 'value', 'what it does']);
  // seed a fresh tab only, and ask the sheet too: a transient probe failure would call a configured tab new
  if (!existed && sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, RECRUIT_CONFIG_KEYS.length, 3).setValues(
      RECRUIT_CONFIG_KEYS.map(function (k) {
        return [k, recruitCfgDefault_(k),
                bookText_('Strings', 'recruit.cfg.' + k + '.note', '')];
      }));
  }
  return sheet;
}

function recruitConfig_() {
  recruitConfigSheet_();
  var out = {};
  RECRUIT_CONFIG_KEYS.forEach(function (k) { out[k] = recruitCfgDefault_(k); });
  try {
    var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), RECRUIT_CONFIG_TAB);
    rows.forEach(function (r) {
      var v = str_(r.value);
      if (str_(r.key) && v) out[str_(r.key)] = v;
    });
  } catch (e) { }
  return out;
}

HUB_POLICY.recruitmentConfig = {
  file: 'Recruitment.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.recruitmentConfig = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  recruitConfigSheet_();
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), RECRUIT_CONFIG_TAB);
  var items = rows.filter(function (r) { return str_(r.key); }).map(function (r) {
    return { key: str_(r.key), value: str_(r.value), help: str_(r.whatitdoes) };
  });
  var key = hubProp_('DROPBOX_SIGN_API_KEY') || '';
  return { status: 200, data: { config: items, key_present: !!key } };
};

HUB_POLICY.recruitmentConfigSet = {
  file: 'Recruitment.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.recruitmentConfigSet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var key = str_(payload.key);
  if (!key) return { status: 400, message: bookText_('Strings', 'refuse.recruit.key_required', '') };
  var sheet = recruitConfigSheet_();
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === key) {
      sheet.getRange(r + 1, 2).setValue(str_(payload.value));
      hubSysLog_(user.email, 'recruitmentConfigSet', key, { status: 200 });
      return { status: 200, data: { key: key, value: str_(payload.value) } };
    }
  }
  sheet.appendRow([key, str_(payload.value), str_(payload.help)]);
  return { status: 200, data: { key: key, value: str_(payload.value), created: true } };
};
var RECRUIT_STATE_ABBR = { ohio: 'OH', pennsylvania: 'PA', 'west virginia': 'WV',
                           michigan: 'MI', indiana: 'IN', kentucky: 'KY', 'new york': 'NY' };

HUB_POLICY.recruitmentSync = {
  file: 'Recruitment.gs', lane: 'tool', store: 'external',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['candidates', 'onboarding'], emits: []
};
HUB_ACTIONS.recruitmentSync = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var key = hubProp_('DROPBOX_SIGN_API_KEY') || '';
  if (!key) {
    return { status: 503, message: bookText_('Strings', 'refuse.recruit.no_api_key', '') };
  }
  var cfg = recruitConfig_();
  var titleNeedle = str_(cfg.title_contains).toLowerCase();
  // fail closed: no needle would mirror every document in the account
  if (!titleNeedle) {
    return { status: 503, message: bookText_('Strings', 'refuse.recruit.no_filter', '') };
  }
  var maxPages = parseInt(cfg.max_pages, 10) || 10;
  var wantPhone = str_(cfg.mirror_phone).toLowerCase() !== 'no';
  var auth = { Authorization: 'Basic ' + Utilities.base64Encode(key + ':') };

  // the list lacks response_data: fields are carried from the mirror and only the missing fetched, under a budget
  var prevFields = {};
  var prevRow = {};
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), RECRUIT_TAB).forEach(function (r) {
      var sid = str_(r.signaturerequestid), fj = str_(r.fieldsjson);
      if (!sid) return;
      prevRow[sid] = r;
      if (fj && fj !== '{}') prevFields[sid] = fj;
    });
  } catch (ePrev) { prevFields = {}; prevRow = {}; }
  var fetchBudget = parseInt(cfg.field_fetch_per_run, 10) || 60;
  var fetchedNow = 0, fetchSkipped = 0, carriedNow = 0;
  var fetchFields_ = function (srid) {
    if (!srid) return null;
    if (fetchedNow >= fetchBudget) { fetchSkipped++; return null; }
    fetchedNow++;
    try {
      var r = UrlFetchApp.fetch('https://api.hellosign.com/v3/signature_request/' + srid,
        { headers: auth, muteHttpExceptions: true });
      if (r.getResponseCode() >= 400) return null;
      var one = JSON.parse(r.getContentText()) || {};
      return (one.signature_request && one.signature_request.response_data) || null;
    } catch (eOne) { return null; }
  };

  var rows = [];
  var page = 1;
  while (page <= maxPages) {
    var resp = UrlFetchApp.fetch(
      'https://api.hellosign.com/v3/signature_request/list?page=' + page + '&page_size=100',
      { headers: auth, muteHttpExceptions: true });
    if (resp.getResponseCode() >= 400) {
      return { status: 502, message: hiringRenderMail_(
        bookText_('Strings', 'refuse.recruit.list_failed', ''),
        { code: String(resp.getResponseCode()) }) };
    }
    var data = JSON.parse(resp.getContentText());
    (data.signature_requests || []).forEach(function (sr) {
      var title = str_(sr.title);
      // filter on original_title too: the sender can rewrite `title`
      var original = str_(sr.original_title) || title;
      if (titleNeedle && original.toLowerCase().indexOf(titleNeedle) === -1 &&
          title.toLowerCase().indexOf(titleNeedle) === -1) return;
      // the one who signed, not signatures[0]: the candidate is often not first
      var sigs = sr.signatures || [];
      var sig = null;
      for (var s = 0; s < sigs.length; s++) {
        if (str_(sigs[s].status_code) === 'signed') { sig = sigs[s]; break; }
      }
      var anySigned = !!sig;
      if (!sig) sig = sigs[0] || {};
      var signerEmails = sigs.map(function (x) {
        return str_(x.signer_email_address).toLowerCase();
      }).filter(String).join('|');
      var signedCount = sigs.filter(function (x) {
        return str_(x.status_code) === 'signed';
      }).length;
      var srid = str_(sr.signature_request_id);
      var absorb = function (list) {
        (list || []).forEach(function (f) {
          var n = str_(f.name).toLowerCase();
          var v = str_(f.value);
          if (v && fields[n] === undefined) fields[n] = v;
        });
      };
      var fields = {};
      absorb(sr.response_data);
      var carried = '';
      if (!Object.keys(fields).length) {
        if (prevFields[srid]) {
          carried = prevFields[srid];
          carriedNow++;
          try {
            var back = JSON.parse(carried) || {};
            for (var bk in back) if (fields[bk] === undefined) fields[bk] = back[bk];
          } catch (eBack) {
            fields = {};
            carried = '';
          }
        } else if (anySigned) {
          absorb(fetchFields_(srid));
        }
      }
      var phone = '';
      for (var k in fields) {
        if ((k.indexOf('phone') !== -1 || k.indexOf('cell') !== -1 || k.indexOf('mobile') !== -1) &&
            fields[k].replace(/\s/g, '').length >= 7) { phone = fields[k]; break; }
      }
      var st = fields.st || fields.state || '';
      if (st) st = RECRUIT_STATE_ABBR[st.toLowerCase()] || (st.length > 2 ? st.slice(0, 2).toUpperCase() : st.toUpperCase());
      var location = [fields.city || '', st].filter(String).join(', ');
      var status = sr.is_declined ? str_(cfg.status_declined)
        : (sr.is_complete || anySigned) ? str_(cfg.status_signed)
        : str_(cfg.status_pending);
      var day = function (ts) {
        return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '';
      };
      var formEmail = str_(fields.email) || str_(fields['email address']) ||
                      str_(sig.signer_email_address);
      var kept = {};
      var keptChars = 0;
      // every row is filtered, carried ones included: skipping them once left full SSNs in the mirror
      for (var fk in fields) {
        var fv = fields[fk];
        if (!fv) continue;
        var low = String(fv).toLowerCase();
        if (low === 'false' || low === 'off' || low === 'no' || low === 'unchecked') continue;
        if (keptChars > 6000) break;
        // fingerprint before redacting, gated on hubIsSsnAnswer_: "any nine digits" would match a shared routing number
        if (typeof hubSsnFingerprint_ === 'function' && !kept.ssn_fp &&
            typeof hubIsSsnAnswer_ === 'function' && hubIsSsnAnswer_(fk, fv)) {
          var fp = hubSsnFingerprint_(fv);
          if (fp) { kept.ssn_fp = fp; keptChars += 30; }
        }
        var safe = (typeof hubRedactAnswer_ === 'function')
          ? hubRedactAnswer_(fk, fv) : String(fv);
        if (safe === null) continue;
        kept[fk] = String(safe).slice(0, 200);
        keptChars += fk.length + kept[fk].length + 6;
      }
      rows.push([str_(sig.signer_name), formEmail.toLowerCase(), wantPhone ? phone : '', location,
                 day(sr.created_at), day(sig.signed_at), status,
                 str_(sr.signature_request_id), title,
                 original, signerEmails, sigs.length, signedCount,
                 JSON.stringify(kept)]);
    });
    var info = data.list_info || {};
    if (page >= (parseInt(info.num_pages, 10) || 1)) break;
    page++;
  }
  rows.sort(function (a, b) { return a[4] < b[4] ? 1 : a[4] > b[4] ? -1 : 0; });

  var sheet = hubSheet_(RECRUIT_TAB);
  var header = ['candidate', 'email', 'phone', 'location', 'applied', 'signed',
                'status', 'signature_request_id', 'title',
                'original_title', 'signer_emails', 'signer_count', 'signed_count',
                'fields_json'];
  var mirrored = 0, unfiled = 0;
  if (sheet.isRuntimeBacked) {
    // the runtime keeps no grid: clearContents would tombstone every row, so each envelope is upserted by id
    rows.forEach(function (line) {
      var sub = str_(line[7]);
      if (!sub) { unfiled++; return; }
      // only changed columns are written: re-filing every envelope each sweep runs out of time
      var prev = prevRow[sub] || null;
      var one = {}, changed = 0;
      header.forEach(function (h, i) {
        var was = prev ? prev[normKey_(h)] : null;
        var now = String(line[i] == null ? '' : line[i]);
        if (prev && String(was == null ? '' : was) === now) return;
        one[h] = now;
        changed++;
      });
      if (!changed) { mirrored++; return; }
      if (hiringLegacyWrite_(RECRUIT_TAB, sub, one, 'recruitment-sync')) mirrored++;
      else unfiled++;
    });
  } else {
    // widen first: clearContents never resizes, and a header past the last column throws
    if (sheet.getMaxColumns() < 14) sheet.insertColumnsAfter(sheet.getMaxColumns(), 14 - sheet.getMaxColumns());
    sheet.clearContents();
    var matrix = [header].concat(rows);
    sheet.getRange(1, 1, matrix.length, header.length).setValues(matrix);
    sheet.setFrozenRows(1);
    mirrored = rows.length;
  }
  CacheService.getScriptCache().remove('dyn_' + hubId_('HUB_DB_ID').slice(0, 8) + '_' + RECRUIT_TAB);
  var counts = { total: rows.length, mirrored: mirrored, unfiled: unfiled,
    fields_fetched: fetchedNow, fields_carried: carriedNow,
    fields_left_for_next_run: fetchSkipped,
    signed: rows.filter(function (r) { return r[6] === str_(cfg.status_signed); }).length,
    pending: rows.filter(function (r) { return r[6] === str_(cfg.status_pending); }).length,
    declined: rows.filter(function (r) { return r[6] === str_(cfg.status_declined); }).length };
  return { status: 200, data: counts };
};

/** Exposes the envelope, never fields_json. */
function recruitmentRoute_(action, payload, user) {
  if (!user || (!user.is_service && !hubIsWriter_(user))) {
    return { status: 403, message: bookText_('Strings', 'refuse.recruit.not_team', '') };
  }
  if (action !== 'list' && action !== 'get') {
    return { status: 405, message: bookText_('Strings', 'refuse.recruit.read_only', '') };
  }
  var rows = [];
  try {
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), RECRUIT_TAB).forEach(function (r) {
      var srid = str_(r.signaturerequestid);
      if (!srid) return;
      rows.push({
        id: srid,
        srid: srid,
        name: str_(r.candidate),
        email: str_(r.email),
        phone: str_(r.phone),
        location: str_(r.location),
        applied: str_(r.applied),
        signed: str_(r.signed),
        status: str_(r.status).toLowerCase(),
        title: str_(r.title),
        original_title: str_(r.originaltitle),
        signer_count: str_(r.signercount),
        signed_count: str_(r.signedcount)
      });
    });
  } catch (e) {
    // unreadable is not empty: "nobody applied" and "could not look" differ
    return { status: 503, message: hiringRenderMail_(
      bookText_('Strings', 'refuse.recruit.mirror_unreadable', ''),
      { error: String((e && e.message) || e) }) };
  }
  if (action === 'list') return { status: 200, data: rows };
  var id = str_(payload && payload.id);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].srid === id) return { status: 200, data: rows[i] };
  }
  return { status: 404, message: hiringRenderMail_(
    bookText_('Strings', 'refuse.recruit.no_application', ''), { id: id }) };
}

// The installed trigger's handler: the sync is Python's now (app/talent_recruitment* recruitmentSyncSweep, the relay's
// clock), so the trigger still installed answers without doing anything.
function runRecruitmentSync() {
  return { status: 200, data: { moved: 'python' } };
}

/** One signed PDF on demand, filed in Drive and cached: the first click downloads, every later one reuses the link. */
HUB_POLICY.recruitmentDoc = {
  file: 'Recruitment.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.recruitmentDoc = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var srid = str_(payload.signature_request_id);
  if (!srid) return { status: 400, message: bookText_('Strings', 'refuse.recruit.srid_required', '') };

  var sheet = hubSheet_(RECRUIT_TAB);
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var iId = hdr.indexOf('signature_request_id');
  var rowN = 0;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][iId]).trim() === srid) { rowN = r + 1; break; }
  }
  if (!rowN) return { status: 404, message: hiringRenderMail_(
    bookText_('Strings', 'refuse.recruit.no_application', ''), { id: srid }) };
  var cachedUrl = recruitDocCached_(srid);
  if (cachedUrl) return { status: 200, data: { doc_url: cachedUrl } };

  var key = hubProp_('DROPBOX_SIGN_API_KEY') || '';
  if (!key) {
    return { status: 503, message: bookText_('Strings', 'refuse.recruit.no_api_key', '') };
  }
  var resp = UrlFetchApp.fetch(
    'https://api.hellosign.com/v3/signature_request/files/' + srid + '?file_type=pdf',
    { headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':') },
      muteHttpExceptions: true });
  if (resp.getResponseCode() >= 400) {
    return { status: 502, message: hiringRenderMail_(
      bookText_('Strings', 'refuse.recruit.pdf_failed', ''),
      { code: String(resp.getResponseCode()) }) };
  }
  var folder = hubUploadsFolder_();
  var file = folder.createFile(resp.getBlob().setName('application-' + srid.slice(0, 12) + '.pdf'));
  // never ANYONE_WITH_LINK: the PDF holds the SSN and address, and a link already out cannot be revoked
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (eShare) {}
  var who = str_(user && user.email);
  if (who) {
    try { hubGrantReader_(file, who); } catch (eView) {}
  }
  var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';

  try {
    var docTab = recruitDocsSheet_();
    docTab.appendRow([srid, url, new Date().toISOString(), who]);
  } catch (eTab) { }
  return { status: 200, data: { doc_url: url } };
};

/** Install the refresh trigger from `sync_minutes`; 0 means manual only. */
HUB_POLICY.recruitmentInstallTrigger = {
  file: 'Recruitment.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.recruitmentInstallTrigger = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var minutes = parseInt(recruitConfig_().sync_minutes, 10);
  if (isNaN(minutes)) minutes = 60;

  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runRecruitmentSync') { ScriptApp.deleteTrigger(t); removed++; }
  });
  if (minutes <= 0) {
    return { status: 200, data: { installed: false, removed: removed,
      note: bookText_('Strings', 'recruit.trigger.manual_only', '') } };
  }
  var builder = ScriptApp.newTrigger('runRecruitmentSync').timeBased();
  if (minutes < 60) {
    var allowed = [1, 5, 10, 15, 30];
    var snap = allowed.reduce(function (best, n) {
      return Math.abs(n - minutes) < Math.abs(best - minutes) ? n : best;
    }, 30);
    builder.everyMinutes(snap).create();
    return { status: 200, data: { installed: true, every_minutes: snap, removed: removed } };
  }
  var hours = Math.max(1, Math.round(minutes / 60));
  builder.everyHours(hours).create();
  return { status: 200, data: { installed: true, every_hours: hours, removed: removed } };
};

/** The only automatic caller of recruitmentSync; without it a signed envelope is never seen. */
function recruitSyncAutoSweep_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('recruit_sync_ran')) return;
  // ~20h: one run a day, and a pass lost to a quota retries the same day
  cache.put('recruit_sync_ran', '1', 72000);

  var key = '';
  try { key = hubProp_('DROPBOX_SIGN_API_KEY') || ''; }
  catch (eK) { key = ''; }
  if (!key) {
    hubSysLog_('auto-recruit-sync', 'recruit_sync_no_key',
               bookText_('Strings', 'recruit.log.no_key', ''), { status: 503 });
    return;
  }

  try {
    var res = HUB_ACTIONS.recruitmentSync({}, { email: 'auto-recruit-sync', role: 'admin' });
    var d = (res && res.data) || {};
    hubSysLog_('auto-recruit-sync', 'recruit_sync_auto',
               res && res.status === 200
                 ? hiringRenderMail_(bookText_('Strings', 'recruit.log.ran', ''), {
                     total: str_(d.total), signed: str_(d.signed),
                     left: d.fields_left_for_next_run
                       ? ' · ' + hiringRenderMail_(
                           bookText_('Strings', 'recruit.log.left', ''),
                           { left: str_(d.fields_left_for_next_run) })
                       : '' })
                 : hiringRenderMail_(bookText_('Strings', 'recruit.log.refused', ''),
                                     { why: str_(res && res.message) }),
               { status: (res && res.status) || 500 });
  } catch (e) {
    hubSysLog_('auto-recruit-sync', 'recruit_sync_auto_failed',
               String((e && e.message) || e), { status: 500 });
  }
}
