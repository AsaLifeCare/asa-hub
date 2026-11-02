var MAIL_LOG_TAB = 'mail';
var MAIL_LOG_HEADER = ['id', 'at', 'direction', 'account', 'address', 'box',
                       'from', 'to', 'cc', 'subject', 'preview', 'lane',
                       'reason', 'receipt', 'message_key', 'collected_at'];

// The ledger keeps the envelope and a capped plain-text preview, never bodies.
var MAIL_LOG_PREVIEW_CHARS = 300;

// The relay caps a box read at 100.
var MAIL_LOG_PER_BOX = 50;

// A rehearsal is read from the subject tag, not the lane; deciders go in Cc, never To.
function mailIsRehearsalSubject_(subject) {
  var s = String(subject || '');
  if (/^\s*\[TEST\]/i.test(s)) return true;
  var tag = '';
  try { tag = (typeof simCfgVal_ === 'function') ? str_(simCfgVal_('sim_subject_tag')) : ''; }
  catch (e) { tag = ''; }
  return !!tag && s.indexOf(tag) === 0;
}

function mailAlsoTellDeciders_(subject, to, cc) {
  var out = String(cc || '');
  try {
    if (!mailIsRehearsalSubject_(subject)) return out;
    var deciders = (typeof simCfgList_ === 'function') ? simCfgList_('sim_decider_emails') : [];
    if (!deciders.length) return out;
    var already = (String(to || '') + ',' + out).toLowerCase();
    var add = deciders.filter(function (a) {
      return a && already.indexOf(String(a).toLowerCase()) === -1;
    });
    if (!add.length) return out;
    return out ? out + ', ' + add.join(', ') : add.join(', ');
  } catch (e) { return out; }        // never blocks the letter
}

// Resolved through HUB_TAB_HOME into the Apps book; never a new tab in HUB_DB.
function mailLogSheet_() {
  var sheet = hubTabEnsure_(MAIL_LOG_TAB, MAIL_LOG_HEADER);
  // An existing tab can still lack its header (a lost write); repair it.
  if (sheet.getLastColumn() === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, MAIL_LOG_HEADER.length).setValues([MAIL_LOG_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Appends by header name, never by position.
function mailLogAppend_(rec) {
  var sheet = mailLogSheet_();
  var lastCol = sheet.getLastColumn();
  var header = lastCol
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(function (h) { return String(h).trim(); })
    : MAIL_LOG_HEADER.slice();
  var line = header.map(function (h) {
    return hubCellSafe_(rec[h] === undefined || rec[h] === null ? '' : String(rec[h]));
  });
  sheet.appendRow(line);
}

function mailLogPreview_(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAIL_LOG_PREVIEW_CHARS);
}

// Never throws: a delivered letter must not be reported failed because the sheet was busy.
function mailLogOut_(rec) {
  try {
    mailLogAppend_({
      id: 'ML_' + randomHex_(10).toUpperCase(),
      at: new Date().toISOString(),
      direction: 'out',
      account: str_(rec && rec.account) || '1',
      address: str_(rec && rec.address),
      box: 'sent',
      from: str_(rec && rec.address),
      to: str_(rec && rec.to),
      cc: str_(rec && rec.cc),
      subject: str_(rec && rec.subject),
      preview: mailLogPreview_(rec && rec.body),
      lane: str_(rec && rec.lane) || 'platform',
      reason: str_(rec && rec.reason),
      receipt: str_(rec && rec.receipt),
      message_key: str_(rec && rec.send_id),
      collected_at: ''
    });
  } catch (e) {}
}

function mailLogSeenKeys_() {
  var seen = {};
  try {
    var sheet = mailLogSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return seen;
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var col = header.indexOf('message_key');
    if (col === -1) return seen;
    var values = sheet.getRange(2, col + 1, last - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var k = String(values[i][0] || '').trim();
      if (k) seen[k] = true;
    }
  } catch (e) { return seen; }
  return seen;
}

// Scoped by mailbox and box: one message in two boxes is two facts, not a duplicate.
function mailLogKey_(accountId, box, msg) {
  var id = str_(msg && (msg.id || msg.uid || msg.message_id));
  if (id) return accountId + '/' + box + '/' + id;
  return accountId + '/' + box + '/' +
         str_(msg && msg.date) + '/' + str_(msg && msg.from_addr) + '/' +
         str_(msg && msg.subject).slice(0, 80);
}

// A mailbox the relay refuses is reported, never skipped silently.
function mailLogCollect_(perBox) {
  var limit = Math.min(parseInt(perBox, 10) || MAIL_LOG_PER_BOX, 100);
  var accounts = (typeof platformMailAccounts_ === 'function') ? platformMailAccounts_() : [];
  if (!accounts.length) {
    return { collected: 0, accounts: 0, errors: ['no mailbox is configured'] };
  }
  var seen = mailLogSeenKeys_();
  var collected = 0, scanned = 0;
  var errors = [];
  var nowIso = new Date().toISOString();
  for (var a = 0; a < accounts.length; a++) {
    var acct = accounts[a];
    var boxes = ['', 'sent'];         // '' is the inbox
    for (var b = 0; b < boxes.length; b++) {
      var box = boxes[b];
      var r;
      try {
        r = platformMailPost_('/mail/inbox', { limit: limit, mailbox: box }, acct.id);
      } catch (eF) {
        errors.push(acct.user + '/' + (box || 'inbox') + ': ' +
                    String((eF && eF.message) || eF).slice(0, 80));
        continue;
      }
      if (!r || r.status !== 200) {
        errors.push(acct.user + '/' + (box || 'inbox') + ': ' +
                    String((r && r.message) || 'no answer').slice(0, 80));
        continue;
      }
      var threads = (r.data && r.data.threads) || [];
      for (var t = 0; t < threads.length; t++) {
        var msg = threads[t];
        scanned++;
        var key = mailLogKey_(acct.id, box || 'inbox', msg);
        if (seen[key]) continue;
        seen[key] = true;
        // A SENT LETTER'S WORDS ARE NOT COPIED AGAIN.
        var sentBox = box === 'sent';
        try {
          mailLogAppend_({
            id: 'ML_' + randomHex_(10).toUpperCase(),
            at: str_(msg.date),
            direction: box === 'sent' ? 'out' : 'in',
            account: acct.id,
            address: acct.user,
            box: box || 'inbox',
            from: str_(msg.from_addr),
            to: str_(msg.to_addr) || (box === 'sent' ? '' : acct.user),
            cc: str_(msg.cc_addr),
            subject: str_(msg.subject),
            preview: sentBox ? '' : mailLogPreview_(msg.snippet || msg.preview || msg.body),
            lane: 'mailbox',
            reason: sentBox ? 'sent box: the words are on the transport\'s own row' : '',
            receipt: str_(msg.unread) === 'true' || msg.unread === true ? 'unread' : '',
            message_key: key,
            collected_at: nowIso
          });
          collected++;
        } catch (eW) {
          errors.push(acct.user + '/' + (box || 'inbox') + ': write failed');
          break;
        }
      }
    }
  }
  return { collected: collected, scanned: scanned,
           accounts: accounts.length, errors: errors };
}

var MAIL_LOG_SWEEP_CACHE = 'mail_log_collect_ran';
var MAIL_LOG_SWEEP_SECONDS = 1800;

function mailLogCollectSweep_() {
  var cache = CacheService.getScriptCache();
  try { if (cache.get(MAIL_LOG_SWEEP_CACHE)) return; }
  catch (eC) {}
  try { cache.put(MAIL_LOG_SWEEP_CACHE, '1', MAIL_LOG_SWEEP_SECONDS); }
  catch (eP) {}
  var out = mailLogCollect_(MAIL_LOG_PER_BOX);
  if (out.collected || (out.errors && out.errors.length)) {
    hubSysLog_('auto-mail-log', 'mail_log_collect',
               out.collected + ' new of ' + (out.scanned || 0) + ' scanned across ' +
               out.accounts + ' mailbox(es)' +
               (out.errors && out.errors.length ? ' · refused: ' + out.errors.join(' | ') : ''),
               { status: (out.errors && out.errors.length) ? 502 : 200 });
  }
}

function runMailLogCollect() {
  var out = mailLogCollect_(MAIL_LOG_PER_BOX);
  Logger.log(JSON.stringify(out));
  return out;
}

/** Collect the mail log on demand: the screen's button, on the same lane as the sweep. */
HUB_POLICY.mailLogCollect = {
  file: 'MailLog.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'minutes',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.mailLogCollect = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var out = mailLogCollect_(payload && payload.limit);
  hubSysLog_(str_(user && user.email), 'mail_log_collect_manual',
             out.collected + ' new message(s)', { status: 200 });
  return { status: 200, data: out };
};
