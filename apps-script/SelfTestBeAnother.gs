// BE ANOTHER — the master wears another account, and nobody else can.
// Driven through the real doPost, sessionUser_, authRoute_, hubPolicyGate_ and hubSysLog_ over a sessions tab and…

function stBaSheet_(grid) {
  var width = function () { return grid[0].length; };
  var pad = function (r) { var x = r.slice(); while (x.length < width()) x.push(''); return x; };
  return {
    getDataRange: function () { return { getValues: function () { return grid.map(pad); } }; },
    getLastColumn: function () { return width(); },
    getRange: function (row, col, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) out.push(pad(grid[row - 1 + i]).slice(col - 1, col - 1 + nc));
          return out;
        },
        setValues: function (vals) {
          for (var i = 0; i < vals.length; i++) {
            for (var j = 0; j < vals[i].length; j++) {
              while (grid[row - 1 + i].length < col + j) grid[row - 1 + i].push('');
              grid[row - 1 + i][col - 1 + j] = vals[i][j];
            }
          }
        },
        setValue: function (v) {
          while (grid[row - 1].length < col) grid[row - 1].push('');
          grid[row - 1][col - 1] = v;
        }
      };
    },
    appendRow: function (row) { grid.push(row.slice()); },
    deleteRow: function (n) { grid.splice(n - 1, 1); }
  };
}

/** A script cache held in memory, remembering the TTL each entry was put with. */
function stBaCache_() {
  var store = {}, ttls = {};
  var api = {
    get: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    put: function (k, v, ttl) { store[k] = String(v); ttls[k] = ttl; },
    remove: function (k) { delete store[k]; delete ttls[k]; },
    ttlOf: function (k) { return Object.prototype.hasOwnProperty.call(ttls, k) ? ttls[k] : null; }
  };
  return { getScriptCache: function () { return api; }, getUserCache: function () { return api; },
           getDocumentCache: function () { return api; }, api: api };
}

function stBeAnother_(out) {
  var keep = {
    master: HUB_MASTER_EMAIL_CACHE, sheet: hubSheet_, users: usersAll_, json: jsonOut_, log: logsSheet_,
    event: eventAppend_, door: hiringDoorRefusal_, prop: hubProp_, alerts: hiringAlerts_, chat: chatSheet_,
    tenants: HUB_TENANT_ROWS, ba: HUB_BE_ANOTHER, refused: BE_ANOTHER_REFUSED, profile: HUB_ACTIONS.profileUpdate,
    defer: HUB_LOG_DEFER, member: HUB_MEMBER_CTX, caller: HUB_CALLER, tenant: HUB_TENANT_CTX,
    mail: PLATFORM_MAIL_BADGES_CACHE, cacheSvc: CacheService, lockSvc: LockService, open: ssOpen_,
    worldRow: worldRowFor_, worldEnsure: HUB_ACTIONS.worldEnsure, calBadges: hubCalendarBadges_,
    memberCtx: memberContext_, journey: journeyLog_, evidence: hubEvidence_, gate: hubPolicyGate_
  };
  var run = randomHex_(16);
  var named = {};
  // every fixture token is minted per run: nothing a reader of this file could present
  var T = function (name) {
    if (!named[name]) named[name] = 'st-ba-' + name + '-' + run;
    return named[name];
  };
  var h = function (t) { return sha256Hex_(t); };
  var iso = function (ms) { return new Date(ms).toISOString(); };
  var now = Date.now();
  var users = [
    { userid: 'U_BOSS', email: 'boss@example.org', displayname: 'Boss', role: 'admin', active: 'true', types: '' },
    { userid: 'U_ADA', email: 'ada@example.org', displayname: 'Ada', role: 'admin', active: 'true', types: 'DIRECTOR' },
    { userid: 'U_SAM', email: 'sam@example.org', displayname: 'Sam', role: 'staff', active: 'true', types: 'HM',
      ismaster: 'true', master: 'true' },
    { userid: 'U_CORA', email: 'cora@example.org', displayname: 'Cora', role: 'client', active: 'true',
      types: 'CLIENT', clientkey: 'CL-7' },
    { userid: 'U_FRAN', email: 'fran@example.org', displayname: 'Fran', role: 'staff', active: 'true', types: 'STAFF',
      hometenant: 'T1', tenants: 'T2' },
    { userid: 'U_OLD', email: 'old@example.org', displayname: 'Old', role: 'staff', active: 'true', mergedinto: 'U_SAM' },
    { userid: 'U_BOB', email: 'bob@example.org', displayname: 'Bob', role: 'staff', active: 'false' }
  ];
  var TB = T('boss'), TA = T('ada'), TS = T('sam'), TBO = T('boss-old');
  var grid = [['token_hash', 'user_id', 'created_at', 'expires_at', 'last_seen'],
              [h(TB), 'U_BOSS', iso(now), iso(now + 30 * 86400000), iso(now)],
              [h(TA), 'U_ADA', iso(now), iso(now + 30 * 86400000), iso(now)],
              [h(TS), 'U_SAM', iso(now), iso(now + 30 * 86400000), iso(now)],
              [h(TBO), 'U_BOSS', iso(now - 86400000), iso(now - 1000), iso(now - 86400000)]];
  var logged = [];
  var minted = [];
  var post = function (body) { return doPost({ postData: { contents: JSON.stringify(body) } }); };
  var rowsFor = function (col, val) {
    var hdr = grid[0].map(normKey_), i = hdr.indexOf(normKey_(col));
    return grid.slice(1).filter(function (r) { return i !== -1 && String(r[i] || '') === val; });
  };
  var col = function (row, name) { return row[grid[0].map(normKey_).indexOf(normKey_(name))]; };
  var fake = stBaCache_();
  var cache = fake.api;
  try {
    // off the live project first: nothing below may reach the shared cache, the script lock or a book
    CacheService = fake;
    LockService = { getScriptLock: function () {
      return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} };
    } };
    ssOpen_ = function () { throw new Error('the be another self-test opens no book'); };
    worldRowFor_ = function () { return null; };
    HUB_ACTIONS.worldEnsure = function (p, u) { minted.push(str_(u && u.id)); return { status: 200, data: {} }; };
    hubCalendarBadges_ = function () { return []; };
    HUB_MASTER_EMAIL_CACHE = 'boss@example.org';
    hubSheet_ = function (name) {
      if (name === SESSIONS_TAB) return stBaSheet_(grid);
      throw new Error('the self-test holds no tab named ' + name);
    };
    usersAll_ = function () { return users; };
    jsonOut_ = function (env) { return env; };
    logsSheet_ = function () { return { appendRow: function (row) { logged.push(row); } }; };
    eventAppend_ = function () { return true; };
    hiringDoorRefusal_ = function () { return null; };
    HUB_LOG_DEFER = null;
    stAssert_(out, 'be another: the section runs off the live project — the cache and the lock are in memory and ' +
                   'every fixture token is random for this run',
              CacheService === fake && CacheService.getScriptCache() === cache && TB.indexOf(run) !== -1 &&
              run.length === 16 && TB !== TA, TB);

    // ── 1. nobody but the master: 404 from every door, and nothing written ──
    var before = grid.length;
    [TS, TA].forEach(function (tok) {
      var who = tok === TS ? 'staff' : 'an admin who is not the master';
      var list = post({ token: tok, action: 'beAnotherList', payload: {} });
      var start = post({ token: tok, action: 'beAnotherStart', payload: { id: 'U_CORA' } });
      var bare = post({ token: tok, action: 'beAnotherStart', payload: {} });
      var odd = post({ token: tok, action: 'beAnotherStart', payload: { id: 42 } });
      var stop = post({ token: tok, action: 'beAnotherStop', payload: {} });
      stAssert_(out, 'be another: ' + who + ' gets 404 from List, Start (with an id, without one, with a number) ' +
                     'and Stop — never a 400 that admits the action exists',
                list.status === 404 && start.status === 404 && bare.status === 404 && odd.status === 404 &&
                stop.status === 404,
                JSON.stringify([list, start, bare, odd, stop]));
    });
    stEq_(out, 'be another: no session row was written for them', grid.length, before);
    // a non-master visiting the master's own account through the member axis is still not the master
    memberContext_ = function () {
      return { userId: 'U_BOSS', email: 'boss@example.org', name: 'Boss', role: 'admin', types: [],
               memberId: 'M_BOSS' };
    };
    var visitList = post({ token: TS, member: 'M_BOSS', action: 'beAnotherList', payload: {} });
    var visitStart = post({ token: TS, member: 'M_BOSS', action: 'beAnotherStart', payload: { id: 'U_CORA' } });
    memberContext_ = keep.memberCtx;
    stAssert_(out, 'be another: staff visiting the master\'s account (user.email becomes the master\'s) gets 404 ' +
                   'from List and Start, and nothing is written',
              visitList.status === 404 && visitStart.status === 404 && grid.length === before,
              JSON.stringify([visitList, visitStart]));

    // ── 2. a forged flag does nothing ───────────────────────────────────────
    var forged = post({ token: TS, action: 'beAnotherStart', acting_as: 'U_CORA', is_master: true,
                        be_another: { acting: { id: 'U_CORA' } }, real_user: 'U_BOSS',
                        payload: { id: 'U_CORA', is_master: true, acting_as: 'U_CORA', be_another: true,
                                   real_user: 'U_BOSS' } });
    stAssert_(out, 'be another: envelope and payload fields claiming the master or an acting identity do nothing',
              forged.status === 404 && grid.length === before, JSON.stringify(forged));
    hubProp_ = function () { return 'sam@example.org'; };
    hiringAlerts_ = function () {
      return { be_another_badges: 'STAFF,HM,ADMIN', master_badges: 'STAFF,HM', franchise_view_badges: 'STAFF' };
    };
    var viaProps = post({ token: TS, action: 'beAnotherList', payload: {} });
    var viaAdmin = post({ token: TA, action: 'beAnotherStart', payload: { id: 'U_CORA' } });
    stAssert_(out, 'be another: a Script Property naming them and a badge CSV granting it do nothing — the ' +
                   'master is the constant in code; and a users cell reading is_master is never read',
              viaProps.status === 404 && viaAdmin.status === 404 && grid.length === before,
              JSON.stringify([viaProps, viaAdmin]));
    hubProp_ = keep.prop;
    hiringAlerts_ = keep.alerts;
    var samMe = sessionUser_(TS);
    stAssert_(out, 'be another: the staff session still resolves as itself, never the master',
              samMe && samMe.id === 'U_SAM' && samMe.is_master === false && HUB_BE_ANOTHER === null,
              JSON.stringify(samMe));

    // hand-written child rows: dead unless the parent is a live session of the hardcoded master
    grid[0] = grid[0].concat(['acting_real_user_id', 'parent_token_hash']);
    var forge = function (name, target, real, parentTok, exp, created) {
      grid.push([h(T(name)), target, created === undefined ? iso(now) : created, iso(exp || now + 3600000), iso(now),
                 real, h(parentTok)]);
    };
    forge('forge-nonmaster', 'U_CORA', 'U_ADA', TA);
    forge('forge-gone', 'U_CORA', 'U_BOSS', T('no-such-token'));
    forge('forge-expired', 'U_CORA', 'U_BOSS', TBO);
    forge('forge-mismatch', 'U_CORA', 'U_BOSS', TA);
    forge('forge-master-target', 'U_BOSS', 'U_BOSS', TB);
    forge('forge-self-expired', 'U_CORA', 'U_BOSS', TB, now - 1000);
    forge('forge-merged-target', 'U_OLD', 'U_BOSS', TB);
    forge('forge-blocked-target', 'U_BOB', 'U_BOSS', TB);
    forge('forge-parent', 'U_SAM', 'U_BOSS', TB);
    forge('forge-grandchild', 'U_CORA', 'U_BOSS', T('forge-parent'));
    // a slide that landed on the row by index stretched expires_at; created_at still counts the two hours
    forge('forge-slid', 'U_CORA', 'U_BOSS', TB, now + 30 * 86400000, iso(now - 3 * 3600000));
    forge('forge-no-created', 'U_CORA', 'U_BOSS', TB, now + 3600000, '');
    var dead = ['forge-nonmaster', 'forge-gone', 'forge-expired', 'forge-mismatch', 'forge-master-target',
                'forge-self-expired', 'forge-merged-target', 'forge-blocked-target', 'forge-grandchild',
                'forge-slid', 'forge-no-created']
      .filter(function (t) { return sessionUser_(T(t)) !== null || HUB_BE_ANOTHER !== null; });
    stAssert_(out, 'be another: a hand-written child resolves to nobody — a non-master parent, a parent gone, ' +
                   'expired or of another account, the master as target, a merged or blocked target, its own ' +
                   'clock run out, a child parented by a child, a clock stretched past created_at + 2h, and no ' +
                   'created_at at all',
              dead.length === 0, dead.join(', '));
    forge('forge-capped', 'U_CORA', 'U_BOSS', TB, now + 30 * 86400000, iso(now));
    var capped = sessionUser_(T('forge-capped'));
    var cappedUntil = HUB_BE_ANOTHER ? new Date(HUB_BE_ANOTHER.until).getTime() : 0;
    stAssert_(out, 'be another: a live child whose expires_at reads 30 days still ends two hours after it was made',
              capped && capped.id === 'U_CORA' && cappedUntil > now && cappedUntil <= now + BE_ANOTHER_TTL_MS + 5000,
              String(HUB_BE_ANOTHER && HUB_BE_ANOTHER.until));
    var cachedFor = cache.ttlOf('sess_' + h(T('forge-capped')));
    stAssert_(out, 'be another: a resolved child stays in the cache a minute at most — the lag of a parent row ' +
                   'deleted by hand, or an account blocked',
              cachedFor !== null && cachedFor > 0 && cachedFor <= 60, String(cachedFor));
    // the parent row goes by a path that ends no child: the cache still answers until the entry lapses
    var parentAt = -1;
    for (var pr = 1; pr < grid.length; pr++) { if (grid[pr][0] === h(TB)) parentAt = pr; }
    var parentRow = grid.splice(parentAt, 1)[0];
    var whileCached = sessionUser_(T('forge-capped'));
    cache.remove('sess_' + h(T('forge-capped')));
    var afterLapse = sessionUser_(T('forge-capped'));
    grid.splice(parentAt, 0, parentRow);
    stAssert_(out, 'be another: a parent deleted by hand ends its child when the cached minute lapses — the sheet ' +
                   'then says nobody',
              whileCached && whileCached.id === 'U_CORA' && afterLapse === null && HUB_BE_ANOTHER === null,
              JSON.stringify([whileCached && whileCached.id, afterLapse]));
    var sheetBackup = grid.slice();

    // ── 3. the master's start writes one correct child row ──────────────────
    grid.length = 0;
    sheetBackup.slice(0, 5).forEach(function (r) { grid.push(r); });
    grid[0] = ['token_hash', 'user_id', 'created_at', 'expires_at', 'last_seen'];
    var masterBare = post({ token: TB, action: 'beAnotherStart', payload: {} });
    stAssert_(out, 'be another: the master without an id is asked to pick one (400), and nothing is written',
              masterBare.status === 400 && grid.length === 5, JSON.stringify(masterBare));
    var startAt = Date.now();
    var started = post({ token: TB, action: 'beAnotherStart', payload: { id: 'U_CORA' } });
    var child = started && started.data ? String(started.data.token || '') : '';
    var kids = rowsFor('parent_token_hash', h(TB));
    var kid = kids[0] || [];
    var exp = new Date(String(col(kid, 'expires_at') || '')).getTime();
    stAssert_(out, 'be another: the master starts it — the answer carries the child token, the target and both ' +
                   'identities',
              started.status === 200 && child.length >= 32 && started.data.user.id === 'U_CORA' &&
              started.data.be_another.real.id === 'U_BOSS' && started.data.be_another.acting.id === 'U_CORA' &&
              started.data.user.is_master === false && started.data.user.mail_reader === false,
              JSON.stringify(started));
    stAssert_(out, 'be another: the sessions tab grew its two columns and one child row naming the target, the ' +
                   'master and the master\'s own token',
              grid[0].indexOf('acting_real_user_id') !== -1 && grid[0].indexOf('parent_token_hash') !== -1 &&
              kids.length === 1 && col(kid, 'user_id') === 'U_CORA' && col(kid, 'acting_real_user_id') === 'U_BOSS' &&
              col(kid, 'token_hash') === sha256Hex_(child) && !!col(kid, 'created_at'),
              JSON.stringify(grid));
    stAssert_(out, 'be another: the child lives two hours at most, and never past the master\'s own session',
              exp > startAt && exp <= startAt + BE_ANOTHER_TTL_MS + 5000 && exp <= now + 30 * 86400000,
              String(col(kid, 'expires_at')));
    var masterRow = rowsFor('token_hash', h(TB))[0] || [];
    stEq_(out, 'be another: the master\'s own row is untouched', col(masterRow, 'user_id'), 'U_BOSS');

    // ── 4. the acting identity answers everywhere ───────────────────────────
    var me = sessionUser_(child);
    stAssert_(out, 'be another: the child session IS the target — id, e-mail, name, role, badges and client key; ' +
                   'never the master, never the platform mailbox',
              me && me.id === 'U_CORA' && me.email === 'cora@example.org' && me.display_name === 'Cora' &&
              me.role === 'client' && me.types.join() === 'CLIENT' && me.client_key === 'CL-7' &&
              me.is_master === false && me.mail_reader === false,
              JSON.stringify(me));
    stAssert_(out, 'be another: the acting context names both identities for this request',
              HUB_BE_ANOTHER && HUB_BE_ANOTHER.real.email === 'boss@example.org' &&
              HUB_BE_ANOTHER.target.id === 'U_CORA' && HUB_BE_ANOTHER.th === sha256Hex_(child),
              JSON.stringify(HUB_BE_ANOTHER));
    stEq_(out, 'be another: "mine" is the target\'s (hubActingUserId_)', hubActingUserId_(me), 'U_CORA');
    var cached = sessionUser_(child);
    stAssert_(out, 'be another: the cached child answers the same, and sets the acting context again',
              cached && cached.id === 'U_CORA' && HUB_BE_ANOTHER && HUB_BE_ANOTHER.target.id === 'U_CORA',
              JSON.stringify(cached));
    var meEnv = post({ token: child, action: 'authMe' });
    stAssert_(out, 'be another: authMe answers the target, with the acting block naming the real master',
              meEnv.status === 200 && meEnv.data.user.id === 'U_CORA' && meEnv.data.user.is_master === false &&
              meEnv.data.be_another && meEnv.data.be_another.real.email === 'boss@example.org' &&
              meEnv.data.be_another.acting && meEnv.data.be_another.acting.id === 'U_CORA' &&
              meEnv.data.be_another.acting.expires_in_ms > 0,
              JSON.stringify(meEnv));
    stAssert_(out, 'be another: the acting authMe mints no workbook for the target (worldEnsure never asked)',
              minted.indexOf('U_CORA') === -1, minted.join());
    var bossEnv = post({ token: TB, action: 'authMe' });
    var samEnv = post({ token: TS, action: 'authMe' });
    var adaEnv = post({ token: TA, action: 'authMe' });
    stAssert_(out, 'be another: the plain master gets the block with nobody worn; staff and a non-master admin ' +
                   'get no key at all',
              bossEnv.data.be_another && bossEnv.data.be_another.acting === null &&
              bossEnv.data.be_another.real.id === 'U_BOSS' &&
              !('be_another' in samEnv.data) && !('be_another' in adaEnv.data),
              JSON.stringify([bossEnv.data.be_another, samEnv.data.be_another, adaEnv.data.be_another]));
    stAssert_(out, 'be another: …and their own authMe still asks for their workbook — the stand-in is the one ' +
                   'answering, so the acting check above is not vacuous',
              minted.indexOf('U_BOSS') !== -1 && minted.indexOf('U_SAM') !== -1, minted.join());
    var nested = post({ token: child, action: 'beAnotherStart', payload: { id: 'U_SAM' } });
    var nestedList = post({ token: child, action: 'beAnotherList', payload: {} });
    stAssert_(out, 'be another: from inside, starting or listing again is refused (409, said as acting)',
              nested.status === 409 && nested.code === 'be_another_refused' && nestedList.status === 409 &&
              String(nested.message).indexOf('Not while acting as Cora') === 0 &&
              rowsFor('acting_real_user_id', 'U_BOSS').length === 1,
              JSON.stringify([nested, nestedList]));

    // the target's places answer, not the master's
    var fran = post({ token: TB, action: 'beAnotherStart', payload: { id: 'U_FRAN' } });
    var franTok = fran && fran.data ? String(fran.data.token || '') : '';
    var franMe = sessionUser_(franTok);
    // set after the post: doPost empties the per-execution memo
    HUB_TENANT_ROWS = [{ tenantid: 'HQ', type: 'hq', status: '' }, { tenantid: 'T1', type: 'franchise', status: '' },
                       { tenantid: 'T2', type: 'franchise', status: '' }];
    var franCtx = franMe ? tenantContext_('', franMe) : null;
    stAssert_(out, 'be another: a franchise target stands in their own place (tenantContext_), and a second ' +
                   'start from the same master session ended the first child',
              franMe && franMe.home_tenant === 'T1' && franMe.tenants.join() === 'T1,T2' &&
              franCtx && franCtx.tenantId === 'T1' && sessionUser_(child) === null &&
              rowsFor('acting_real_user_id', 'U_BOSS').length === 1,
              JSON.stringify([franMe && franMe.tenants, franCtx]));
    var tellingLines = function () {
      return logged.filter(function (r) {
        return /^beAnother/.test(String(r[2])) || /\(as /.test(String(r[1])) ||
               /act(ing)? as|another account|Be Back/i.test(String(r[3]) + ' ' + String(r[5]) + ' ' + String(r[9]));
      });
    };
    stAssert_(out, 'be another: a start that replaces a child leaves no log line',
              tellingLines().length === 0, JSON.stringify(tellingLines().slice(0, 2)));
    var franStop = post({ token: franTok, action: 'beAnotherStop', payload: {} });
    stAssert_(out, 'be another: Be Back answers where the target stands (it is tenant-safe)',
              franStop.status === 200 && tenantActionAllowed_('beAnotherStop') &&
              !tenantActionAllowed_('beAnotherStart') && !tenantActionAllowed_('beAnotherList'),
              JSON.stringify(franStop));
    HUB_TENANT_CTX = null;

    // the platform mailbox stays with the real sign-in, even for a target who reads it
    PLATFORM_MAIL_BADGES_CACHE = ['DIRECTOR'];
    cache.remove('sess_' + h(TA));
    var adaOwn = sessionUser_(TA);
    var asAda = post({ token: TB, action: 'beAnotherStart', payload: { id: 'U_ADA' } });
    var adaTok = asAda && asAda.data ? String(asAda.data.token || '') : '';
    var adaActing = sessionUser_(adaTok);
    stAssert_(out, 'be another: a target who reads the platform mailbox does not while worn — in the start ' +
                   'answer and in every resolution after it',
              adaOwn && adaOwn.mail_reader === true && asAda.status === 200 && asAda.data.user.mail_reader === false &&
              adaActing && adaActing.id === 'U_ADA' && adaActing.mail_reader === false,
              JSON.stringify([adaOwn && adaOwn.mail_reader, asAda.data && asAda.data.user.mail_reader,
                              adaActing && adaActing.mail_reader]));
    post({ token: adaTok, action: 'beAnotherStop', payload: {} });
    PLATFORM_MAIL_BADGES_CACHE = keep.mail;

    // ── 5. refused while acting, and only while acting ──────────────────────
    var again = post({ token: TB, action: 'beAnotherStart', payload: { id: 'U_CORA' } });
    child = again && again.data ? String(again.data.token || '') : '';
    var undeclared = [];
    for (var k in BE_ANOTHER_REFUSED) {
      if (!BE_ANOTHER_REFUSED.hasOwnProperty(k)) continue;
      if (typeof HUB_ACTIONS[k] !== 'function' || !HUB_POLICY[k]) undeclared.push(k);
    }
    for (var kr in BE_ANOTHER_REFUSED_RESOURCES) {
      if (BE_ANOTHER_REFUSED_RESOURCES.hasOwnProperty(kr) && !RESOURCES[kr]) undeclared.push(kr + ' (resource)');
    }
    stAssert_(out, 'be another: every refused name is a declared action or resource — a typo would refuse nothing',
              undeclared.length === 0, undeclared.join(', '));
    var cora = sessionUser_(child);
    var notRefused = [];
    for (var k2 in BE_ANOTHER_REFUSED) {
      if (!BE_ANOTHER_REFUSED.hasOwnProperty(k2)) continue;
      var g = hubPolicyGate_(k2, {}, cora);
      if (!g || g.status !== 409 || g.code !== 'be_another_refused') notRefused.push(k2);
    }
    stAssert_(out, 'be another: while acting, every one of them is refused with 409 at the policy door',
              notRefused.length === 0, notRefused.join(', '));
    var sigs = [];
    for (var k4 in BE_ANOTHER_REFUSED_RESOURCES) {
      if (!BE_ANOTHER_REFUSED_RESOURCES.hasOwnProperty(k4)) continue;
      ['create', 'update', 'delete'].forEach(function (verb) {
        var pg = hubPlaceGate_(k4, verb, { id: 'row-1' });
        if (!pg || pg.status !== 409 || pg.code !== 'be_another_refused') sigs.push(k4 + '.' + verb);
      });
      if (hubPlaceGate_(k4, 'list', {}) !== null) sigs.push(k4 + '.list refused');
    }
    stAssert_(out, 'be another: their signatures on the generic lane (policy acknowledgements, medication ' +
                   'records) are refused at route()\'s place door; reading them is not',
              sigs.length === 0 && hubPlaceGate_('teamTasks', 'create', {}) === null &&
              stCode_(route).indexOf('hubPlaceGate_(') !== -1, sigs.join(', '));
    stEq_(out, 'be another: Be Back passes the door for a client target', hubPolicyGate_('beAnotherStop', {}, cora), null);
    hiringDoorRefusal_ = function () { return { status: 403, message: 'closed by the book' }; };
    stEq_(out, 'be another: …even when a book\'s Actions tab closes every door',
          hubPolicyGate_('beAnotherStop', {}, cora), null);
    hiringDoorRefusal_ = function () { return null; };
    BE_ANOTHER_REFUSED = null;
    var failClosed = hubPolicyGate_('usersList', {}, cora);
    BE_ANOTHER_REFUSED = keep.refused;
    stAssert_(out, 'be another: FAIL-CLOSED — a gate that cannot decide while acting refuses',
              failClosed && failClosed.status === 409, JSON.stringify(failClosed));
    var ran = 0;
    HUB_ACTIONS.profileUpdate = function () { ran++; return { status: 200, data: {} }; };
    var pw = post({ token: child, action: 'profileUpdate', payload: { password: 'new-secret-1', display_name: 'X' } });
    HUB_ACTIONS.profileUpdate = keep.profile;
    stAssert_(out, 'be another: through doPost, a password change is refused before the handler runs',
              pw.status === 409 && ran === 0, JSON.stringify(pw));
    // a move into Onboarding while acting mints no login: the sweep does, as the machine
    var asked = 0, journeyed = [];
    hubEvidence_ = function () { asked++; return { cand: null }; };
    journeyLog_ = function (o) { journeyed.push(o); };
    sessionUser_(child);
    var mintActing = onboardingEnsureUser_('C_ST_BA', { by_person: true });
    HUB_BE_ANOTHER = null;
    var mintOwn = onboardingEnsureUser_('C_ST_BA', { by_person: true });
    hubEvidence_ = keep.evidence;
    journeyLog_ = keep.journey;
    stAssert_(out, 'be another: while acting, entering Onboarding mints no login (left to the sweep, nothing on ' +
                   'the journey); not acting, the same call goes on to the evidence as before',
              mintActing && mintActing.made === false && /sweep/.test(mintActing.why) && journeyed.length === 0 &&
              mintOwn && mintOwn.why === 'no candidate' && asked === 1,
              JSON.stringify([mintActing, mintOwn, asked, journeyed.length]));
    var openWhenNot = [];
    for (var k3 in BE_ANOTHER_REFUSED) {
      if (BE_ANOTHER_REFUSED.hasOwnProperty(k3) && beAnotherPolicyGate_(k3) !== null) openWhenNot.push(k3);
    }
    for (var k5 in BE_ANOTHER_REFUSED_RESOURCES) {
      if (BE_ANOTHER_REFUSED_RESOURCES.hasOwnProperty(k5) && beAnotherResourceGate_(k5, 'create') !== null) {
        openWhenNot.push(k5 + ' (resource)');
      }
    }
    stAssert_(out, 'be another: not acting, the lists refuse nothing', openWhenNot.length === 0, openWhenNot.join(', '));

    // ── 6. no log line: not the start, not a refusal, not anything done inside ──
    var cora = logged.filter(function (r) { return /cora@example\.org/.test(String(r[1])); });
    stAssert_(out, 'be another: nothing about the switch, and nothing done inside it, reaches the system log',
              tellingLines().length === 0 && cora.length === 0,
              JSON.stringify(tellingLines().concat(cora).slice(0, 3)));
    stAssert_(out, 'be another: the log vocabulary carries no word for it',
              LOG_VOCAB.every(function (v) {
                return !/^beAnother/.test(String(v.key)) && !/another account|Be Back/i.test(String(v.verb));
              }), '');

    // ── 10. no presence stamped while acting ────────────────────────────────
    var stamped = 0;
    chatSheet_ = function () {
      stamped++;
      return { getDataRange: function () { return { getValues: function () { return [['user_id', 'name', 'seen_at']]; } }; },
               appendRow: function () {} };
    };
    sessionUser_(child);
    chatTouchPresence_('U_CORA', 'Cora');
    var whileActing = stamped;
    sessionUser_(TS);
    chatTouchPresence_('U_SAM', 'Sam');
    stAssert_(out, 'be another: presence is never stamped while acting (the target is not here); a normal session ' +
                   'stamps as before',
              whileActing === 0 && stamped === 1, 'acting ' + whileActing + ', normal ' + stamped);
    chatSheet_ = keep.chat;

    // ── 7. Be Back ──────────────────────────────────────────────────────────
    var stop = post({ token: child, action: 'beAnotherStop', payload: {} });
    stAssert_(out, 'be another: Be Back ends the child — the row and its cache entry are gone, and no line is logged',
              stop.status === 200 && rowsFor('token_hash', sha256Hex_(child)).length === 0 &&
              cache.get('sess_' + sha256Hex_(child)) === null && tellingLines().length === 0,
              JSON.stringify(stop));
    var afterChild = sessionUser_(child);
    var afterBoss = sessionUser_(TB);
    stAssert_(out, 'be another: after Be Back the child is nobody and the master is the master, acting as nobody',
              afterChild === null && afterBoss && afterBoss.id === 'U_BOSS' && afterBoss.is_master === true &&
              HUB_BE_ANOTHER === null,
              JSON.stringify(afterBoss));
    var third = post({ token: TB, action: 'beAnotherStart', payload: { id: 'U_SAM' } });
    var samChild = third && third.data ? String(third.data.token || '') : '';
    var linesBefore = logged.length;
    sessionDestroy_(TB);
    var afterSignOut = logged.slice(linesBefore).filter(function (r) { return /sam@example\.org|\(as /.test(String(r[1])); });
    stAssert_(out, 'be another: signing the master out ends the acting session with it, and logs nothing about it',
              sessionUser_(samChild) === null && rowsFor('acting_real_user_id', 'U_BOSS').length === 0 &&
              afterSignOut.length === 0 && tellingLines().length === 0,
              JSON.stringify([grid, afterSignOut]));
    HUB_BE_ANOTHER = { real: { id: 'U_ADA', email: 'ada@example.org' }, target: { id: 'U_CORA' }, th: sha256Hex_('x') };
    var forgedStop = HUB_ACTIONS.beAnotherStop({}, { id: 'U_CORA', email: 'cora@example.org' }, 'x');
    stEq_(out, 'be another: a Be Back whose real account is not the master is an unknown action', forgedStop.status, 404);
    HUB_BE_ANOTHER = null;

    // ── 8. a stale or foreign cached wrapper ────────────────────────────────
    var pub = { id: 'U_CORA', email: 'cora@example.org', role: 'client' };
    cache.put('sess_' + h(T('stale-child')), JSON.stringify({ be: 1, user: pub, real: { email: 'boss@example.org' },
                                                              target: { id: 'U_CORA' }, until: iso(now - 1000) }), 60);
    cache.put('sess_' + h(T('foreign-child')), JSON.stringify({ be: 1, user: pub, real: { email: 'ada@example.org' },
                                                                target: { id: 'U_CORA' }, until: iso(now + 60000) }), 60);
    stAssert_(out, 'be another: a cached child past its clock, or whose real account is not the master, is ' +
                   'refused and forgotten',
              sessionUser_(T('stale-child')) === null && sessionUser_(T('foreign-child')) === null &&
              cache.get('sess_' + h(T('stale-child'))) === null && HUB_BE_ANOTHER === null, '');

    // ── 9. nothing survives a warm start ────────────────────────────────────
    HUB_BE_ANOTHER = { real: { email: 'boss@example.org' }, target: { id: 'U_CORA', email: 'cora@example.org' } };
    var samAfter = post({ token: TS, action: 'authMe' });
    stAssert_(out, 'be another: a context left by a warm start is gone by the next request — no global and no ' +
                   'be_another key for a non-master',
              samAfter.status === 200 && !('be_another' in samAfter.data) && HUB_BE_ANOTHER === null,
              JSON.stringify(samAfter.data));
    HUB_BE_ANOTHER = { real: { email: 'boss@example.org' }, target: { id: 'U_CORA' } };
    hubPropsBoot_();
    stEq_(out, 'be another: the first call of doPost and doGet (hubPropsBoot_) resets it', HUB_BE_ANOTHER, null);
    var midReset = [];
    for (var a in HUB_ACTIONS) {
      if (HUB_ACTIONS.hasOwnProperty(a) && typeof HUB_ACTIONS[a] === 'function' &&
          stCode_(HUB_ACTIONS[a]).indexOf('hubPropsBoot_(') !== -1) midReset.push(a);
    }
    stAssert_(out, 'be another: no handler calls the resetting boot mid-request (they call hubPropsCheck_)',
              midReset.length === 0 && stCode_(hubHiredSweepMaybe_).indexOf('hubPropsBoot_(') === -1,
              midReset.join(', '));

    // ── 13. never half-built ────────────────────────────────────────────────
    var wholeNow = beAnotherWired_();
    hubPolicyGate_ = function () { return null; };
    var half = beAnotherWired_();
    var gridAt = grid.length;
    var halfStart = post({ token: sessionCreate_('U_BOSS'), action: 'beAnotherStart', payload: { id: 'U_CORA' } });
    hubPolicyGate_ = keep.gate;
    stAssert_(out, 'be another: this build is whole; a build missing a half (the refusals in Resolver.gs) names ' +
                   'it and starts nothing',
              wholeNow === '' && /Resolver\.gs/.test(half) && halfStart.status === 503 &&
              /not whole/.test(String(halfStart.message)) && grid.length === gridAt + 1 &&
              rowsFor('acting_real_user_id', 'U_BOSS').length === 0,
              JSON.stringify([wholeNow, half, halfStart]));
  } finally {
    CacheService = keep.cacheSvc; LockService = keep.lockSvc; ssOpen_ = keep.open; worldRowFor_ = keep.worldRow;
    HUB_ACTIONS.worldEnsure = keep.worldEnsure; hubCalendarBadges_ = keep.calBadges; memberContext_ = keep.memberCtx;
    journeyLog_ = keep.journey; hubEvidence_ = keep.evidence; hubPolicyGate_ = keep.gate;
    HUB_MASTER_EMAIL_CACHE = keep.master; hubSheet_ = keep.sheet; usersAll_ = keep.users; jsonOut_ = keep.json;
    logsSheet_ = keep.log; eventAppend_ = keep.event; hiringDoorRefusal_ = keep.door; hubProp_ = keep.prop;
    hiringAlerts_ = keep.alerts; chatSheet_ = keep.chat; HUB_TENANT_ROWS = keep.tenants; HUB_BE_ANOTHER = keep.ba;
    BE_ANOTHER_REFUSED = keep.refused; HUB_ACTIONS.profileUpdate = keep.profile; HUB_LOG_DEFER = keep.defer;
    HUB_MEMBER_CTX = keep.member; HUB_CALLER = keep.caller; HUB_TENANT_CTX = keep.tenant;
    PLATFORM_MAIL_BADGES_CACHE = keep.mail;
    // the per-execution memos doPost empties: anything read against the stand-ins is forgotten
    HUB_USERS_ROWS = null; HUB_MEMBERS_ROWS = null; HUB_MEMBERS_OWNER = null;
    HUB_CANDIDATE_BY_EMAIL = null; HUB_INVITE_ROWS = null;
  }
  // read as source, after every stand-in above is put back: the real helpers are the ones walked
  stBaSourceChecks_(out);
}

function stBaSourceChecks_(out) {
  // ── 11. drift guard: a writer of sessions, passwords or access must be named ──
  var marks = ['hashPassword_(', 'userSetFields_(', 'SESSIONS_TAB', 'sessionCreate_(', 'sessionDestroy_(',
               'APP_BADGE_TAB', 'appBadgeSheet_(', 'APP_TENANT_TAB', 'appTenantSheet_(', 'CONFIG_BADGE_TAB',
               'configBadgeSheet_(', 'appdenials'];
  var hitsIn = function (src) { return marks.filter(function (m) { return src.indexOf(m) !== -1; }); };
  var srcMemo = {};
  var helperSrc = function (name) {
    if (Object.prototype.hasOwnProperty.call(srcMemo, name)) return srcMemo[name];
    var fn = null;
    // a helper is a global named like one — the same lookup the actions lock uses
    if (/^[A-Za-z_$][\w$]*_$/.test(name)) {
      try { fn = eval(name); } catch (eE) { fn = null; }
    }
    srcMemo[name] = typeof fn === 'function' ? stCode_(fn) : '';
    return srcMemo[name];
  };
  var callsIn = function (src) {
    var re = /(^|[^.\w'"])([A-Za-z_$][\w$]*_)\s*\(/g, m, seen = {}, names = [];
    while ((m = re.exec(src))) {
      if (!seen[m[2]]) { seen[m[2]] = 1; names.push(m[2]); }
    }
    return names;
  };
  var unnamed = [];
  for (var w in HUB_ACTIONS) {
    if (!HUB_ACTIONS.hasOwnProperty(w) || typeof HUB_ACTIONS[w] !== 'function') continue;
    if (BE_ANOTHER_REFUSED.hasOwnProperty(w)) continue;
    if (BE_ANOTHER_ALLOWED_WRITERS.hasOwnProperty(w) && String(BE_ANOTHER_ALLOWED_WRITERS[w]).length > 10) continue;
    var own = stCode_(HUB_ACTIONS[w]);
    var hit = hitsIn(own);
    if (hit.length) { unnamed.push(w + ' (' + hit.join(', ') + ')'); continue; }
    // three calls deep: a helper that asks beAnotherActive_() guards itself, a named one says why
    var frontier = callsIn(own), visited = {};
    for (var depth = 1; depth <= 3 && frontier.length; depth++) {
      var next = [];
      for (var f = 0; f < frontier.length; f++) {
        var hn = frontier[f];
        if (visited[hn]) continue;
        visited[hn] = 1;
        var hs = helperSrc(hn);
        if (!hs || hs.indexOf('beAnotherActive_(') !== -1) continue;
        if (BE_ANOTHER_ALLOWED_HELPERS.hasOwnProperty(hn) && String(BE_ANOTHER_ALLOWED_HELPERS[hn]).length > 10) continue;
        var hh = hitsIn(hs);
        if (hh.length) { unnamed.push(w + ' → ' + hn + ' (' + hh.join(', ') + ')'); continue; }
        next = next.concat(callsIn(hs));
      }
      frontier = next;
    }
  }
  stAssert_(out, 'be another: every handler that writes sessions, passwords or access — itself or up to three ' +
                 'helpers deep — is refused while acting, guards itself, or is allowed with a reason',
            unnamed.length === 0, unnamed.join('; '));
  stAssert_(out, 'be another: the onboarding mint is one of the guarded helpers the guard walks past',
            stCode_(onboardingEnsureUser_).indexOf('beAnotherActive_(') !== -1 &&
            stCode_(onboardingEnsureUser_).indexOf('hashPassword_(') !== -1, '');

  // ── 12. the gate reads the constant and nothing else ────────────────────
  var gateSrc = [beAnotherMayStart_, beAnotherResolveRow_, beAnotherFromCache_, beAnotherPolicyGate_,
                 beAnotherResourceGate_, HUB_ACTIONS.beAnotherList, HUB_ACTIONS.beAnotherStart,
                 HUB_ACTIONS.beAnotherStop, hubMasterEmail_].map(stCode_).join('\n');
  var leaks = ['hubProp_', 'hiringAlerts_', 'PropertiesService', 'badgeAccess', 'BadgeAccess', 'overrides',
               'is_master', 'ismaster', 'app_badge_access', 'hubGrantedFeatureOn_', 'hubShellFeatureOn_']
    .filter(function (m) { return gateSrc.indexOf(m) !== -1; });
  stAssert_(out, 'be another: who may start, resolve and end it is asked of hubIsMaster_ alone — no property, ' +
                 'config, badge, override or user flag is read',
            leaks.length === 0 && stCode_(beAnotherMayStart_).indexOf('hubIsMaster_(') !== -1 &&
            stCode_(beAnotherResolveRow_).indexOf('hubIsMaster_(') !== -1 &&
            HUB_MASTER_ACCOUNT === 'asatech@asalifecare.com',
            leaks.join(', '));
  stAssert_(out, 'be another: the policies leave the handler as the only gate — Be Back must work for a client, ' +
                 'and Start declares no params the door would answer 400 for',
            HUB_POLICY.beAnotherStop.roles.length === 0 && HUB_POLICY.beAnotherStart.roles.length === 0 &&
            HUB_POLICY.beAnotherList.roles.length === 0 && HUB_POLICY.beAnotherStart.lane === 'tool' &&
            HUB_POLICY.beAnotherStop.lane === 'tool' && !HUB_POLICY.beAnotherStart.params, '');
}
