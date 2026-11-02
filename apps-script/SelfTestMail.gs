function stMail_(out) {
  var user = { id: 'u1', email: 'selftest@asa', role: 'admin', types: 'DIRECTOR', is_service: false };
  var svc = { email: 'snapshot@service.local', role: 'admin', is_service: true };

  // Every swapped collaborator is restored at the end so no later section inherits a stub.
  var heldCanRead = platformMailCanRead_;
  var heldOwnBox = platformMailOwnBox_;
  var heldPost = platformMailPost_;
  var heldPostOwn = platformMailPostOwn_;
  var posted = [];
  try {
    platformMailCanRead_ = function (u) { return !!u && !u.is_service; };
    platformMailOwnBox_ = function () { return 'me@asaop.org'; };
    platformMailPost_ = function (path, extra, account) {
      posted.push({ lane: 'platform', path: path, extra: extra, account: account });
      return { status: 200, data: { echoed: true } };
    };
    platformMailPostOwn_ = function (path, extra, account) {
      posted.push({ lane: 'own', path: path, extra: extra, account: account });
      return { status: 200, data: { echoed: true } };
    };

    var r = HUB_ACTIONS.platformMailMessage({ id: 'x' }, svc);
    stAssert_(out, 'mail: the service identity is refused on the message door',
              r.status === 404, 'a machine reading mail is a secret in the wrong hands');
    platformMailCanRead_ = function () { return false; };
    r = HUB_ACTIONS.platformMailMessage({ id: 'x' }, user);
    stAssert_(out, 'mail: a non-reader gets the same 404 the inbox gives',
              r.status === 404 && r.message === 'Unknown action.',
              '"forbidden" would advertise there is a mailbox to be forbidden from');
    platformMailCanRead_ = function (u) { return !!u && !u.is_service; };
    platformMailOwnBox_ = function () { return ''; };
    r = HUB_ACTIONS.platformMailMessage({ id: 'x', account: 'mine' }, user);
    stAssert_(out, 'mail: "mine" with no minted box says so with a 409',
              r.status === 409, String(r.message));
    platformMailOwnBox_ = function () { return 'me@asaop.org'; };

    posted.length = 0;
    r = HUB_ACTIONS.platformMailMessage({ id: '<m@x>', mailbox: 'sent', hint: 'Roster', account: '2' }, user);
    stAssert_(out, 'mail: the message door passes id, mailbox and hint to the relay',
              r.status === 200 && posted.length === 1 && posted[0].path === '/mail/message' &&
              posted[0].extra.id === '<m@x>' && posted[0].extra.mailbox === 'sent' &&
              posted[0].extra.hint === 'Roster' && posted[0].account === '2',
              JSON.stringify(posted));
    posted.length = 0;
    r = HUB_ACTIONS.platformMailMessage({ id: '<m@x>', account: 'mine' }, user);
    stAssert_(out, 'mail: "mine" rides the OWN-credentials lane, by address',
              r.status === 200 && posted[0].lane === 'own' && posted[0].account === 'me@asaop.org');
    r = HUB_ACTIONS.platformMailMessage({}, user);
    stAssert_(out, 'mail: a message with no id is refused before any network', r.status === 400);

    posted.length = 0;
    r = HUB_ACTIONS.platformMailAttachment({ id: '<m@x>', part: 3 }, user);
    stAssert_(out, 'mail: the attachment door names the part',
              r.status === 200 && posted[0].path === '/mail/attachment' && posted[0].extra.part === 3);
    r = HUB_ACTIONS.platformMailAttachment({ id: '<m@x>' }, user);
    stAssert_(out, 'mail: an attachment with no part is refused', r.status === 400);
    r = HUB_ACTIONS.platformMailAttachment({ id: '<m@x>', part: -1 }, user);
    stAssert_(out, 'mail: a negative part is refused', r.status === 400);

    posted.length = 0;
    r = HUB_ACTIONS.platformMailMark({ items: [{ id: 'a' }, { id: 'b', hint: 'h' }], seen: false }, user);
    stAssert_(out, 'mail: mark carries the batch and maps seen:false to the wire',
              r.status === 200 && posted[0].path === '/mail/mark' &&
              posted[0].extra.items.length === 2 && posted[0].extra.seen === 'no',
              JSON.stringify(posted));
    posted.length = 0;
    r = HUB_ACTIONS.platformMailMark({ items: [{ id: 'a' }] }, user);
    stAssert_(out, 'mail: seen defaults to yes — opening a message is the common case',
              r.status === 200 && posted[0].extra.seen === 'yes');
    r = HUB_ACTIONS.platformMailMark({ items: [] }, user);
    stAssert_(out, 'mail: marking nothing is a 400, not an empty success', r.status === 400);

    posted.length = 0;
    r = HUB_ACTIONS.platformMailMove({ id: '<m@x>', hint: 'Roster', folder: 'Archive' }, user);
    stAssert_(out, 'mail: Archive moves through the watcher\'s own filing door',
              r.status === 200 && posted[0].path === '/mail/file' &&
              posted[0].extra.folder === 'Archive' && posted[0].extra.items[0].id === '<m@x>',
              JSON.stringify(posted));
    r = HUB_ACTIONS.platformMailMove({ id: '<m@x>', folder: 'Drafts' }, user);
    stAssert_(out, 'mail: only Archive and Trash may be named — anything else is refused HERE',
              r.status === 400,
              'the relay holds the shape a second time, but the first no must not be a round trip');
    r = HUB_ACTIONS.platformMailMove({ folder: 'Trash' }, user);
    stAssert_(out, 'mail: a move with no id is refused', r.status === 400);

    var src = '';
    try { src = stCode_(HUB_ACTIONS.platformMailMove); } catch (eC) { src = ''; }
    stAssert_(out, 'mail: the move lands in the system log — a mailbox mutation leaves a trail',
              src.indexOf('hubSysLog_') !== -1,
              'moving somebody\'s mail with no record is how mail "disappears"');

    // Everything that could touch the real world is swapped, so this runs safely in the live editor.
    var heldMaster = hubIsMaster_;
    var heldVerify = platformMailVerify_;
    var heldAccounts = platformMailAccounts_;
    var heldInFile = scriptPropInFile_;
    var heldPropSet = hubPropSet_;
    var wrote = {};
    try {
      hubIsMaster_ = function () { return true; };
      platformMailVerify_ = function () { return { ok: true, message: '' }; };
      platformMailAccounts_ = function () {
        return [{ id: '1', user: 'voice@asaop.org', password: 'x' }];
      };
      scriptPropInFile_ = function () { return false; };
      hubPropSet_ = function (k, v) { wrote[k] = String(v); return true; };

      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'a@b.c', password: 'p' }, svc);
      stAssert_(out, 'mail add: the service identity is refused with the anonymous 404',
                r.status === 404, 'a machine wiring mailboxes is a machine holding passwords');
      hubIsMaster_ = function () { return false; };
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'a@b.c', password: 'p' }, user);
      stAssert_(out, 'mail add: a non-master admin gets the same anonymous 404',
                r.status === 404, String(r.message));
      hubIsMaster_ = function () { return true; };
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'not-an-address', password: 'p' }, user);
      stAssert_(out, 'mail add: an address without @ is refused before anything runs',
                r.status === 400, String(r.message));
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'a@b.c', password: '' }, user);
      stAssert_(out, 'mail add: a pair without its password is refused',
                r.status === 400, String(r.message));
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'VOICE@asaop.org', password: 'p' }, user);
      stAssert_(out, 'mail add: an already-wired address 409s, case-blind',
                r.status === 409, String(r.message));
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'a@b.c', password: 'p', slot: '1' }, user);
      stAssert_(out, 'mail add: slot 1 — the platform\'s own voice — is never writable here',
                r.status === 400, String(r.message));
      scriptPropInFile_ = function () { return true; };
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'a@b.c', password: 'p' }, user);
      stAssert_(out, 'mail add: a Props.gs-shadowed slot 409s naming its exact lines',
                r.status === 409 && String(r.message).indexOf('PLATFORM_EMAIL_2') !== -1,
                'a store write under a live file line changes nothing the reader sees');
      scriptPropInFile_ = function () { return false; };
      platformMailVerify_ = function () { return { ok: false, message: 'LOGIN failed' }; };
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'a@b.c', password: 'wrong' }, user);
      stAssert_(out, 'mail add: a refused login is a 502 and NOTHING is stored',
                r.status === 502 && Object.keys(wrote).length === 0,
                JSON.stringify(wrote));
      platformMailVerify_ = function () { return { ok: true, message: '' }; };
      r = HUB_ACTIONS.platformMailAccountAdd({ address: 'new@asaop.org', password: 'sekr3t' }, user);
      stAssert_(out, 'mail add: success wires the first free slot with BOTH halves',
                r.status === 200 && r.data && r.data.id === '2' &&
                wrote.PLATFORM_EMAIL_2 === 'new@asaop.org' &&
                wrote.PLATFORM_EMAIL_PASSWORD_2 === 'sekr3t',
                JSON.stringify(wrote));
      stAssert_(out, 'mail add: the answer never echoes the password',
                JSON.stringify(r).indexOf('sekr3t') === -1,
                'the pair rides in, the address rides out');
    } finally {
      hubIsMaster_ = heldMaster;
      platformMailVerify_ = heldVerify;
      platformMailAccounts_ = heldAccounts;
      scriptPropInFile_ = heldInFile;
      hubPropSet_ = heldPropSet;
    }
  } finally {
    platformMailCanRead_ = heldCanRead;
    platformMailOwnBox_ = heldOwnBox;
    platformMailPost_ = heldPost;
    platformMailPostOwn_ = heldPostOwn;
  }
}
