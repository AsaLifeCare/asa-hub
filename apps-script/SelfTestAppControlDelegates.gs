/** A sheet held in memory, enough of one for App Control's doors: read whole, a row set, appended, deleted, cleared. */
function stAcSheet_(rows) {
  var data = rows.map(function (r) { return r.slice(); });
  var width = data[0].length;
  var blank = function () { var b = []; for (var i = 0; i < width; i++) b.push(''); return b; };
  var at = function (r) { while (data.length < r) data.push(blank()); return data[r - 1]; };
  return {
    data: data,
    getDataRange: function () {
      return { getValues: function () { return data.map(function (r) { return r.slice(); }); } };
    },
    getRange: function (r, c, nr, nc) {
      var rows = nr || 1, cols = nc || 1;
      return {
        setValues: function (vals) {
          for (var i = 0; i < vals.length; i++) {
            var row = at(r + i);
            for (var j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j];
          }
        },
        setValue: function (v) { at(r)[c - 1] = v; },
        clearContent: function () {
          for (var i = 0; i < rows; i++) {
            var row = at(r + i);
            for (var j = 0; j < cols; j++) row[c - 1 + j] = '';
          }
        }
      };
    },
    appendRow: function (row) { data.push(row.slice()); },
    deleteRow: function (n) { data.splice(n - 1, 1); },
    getLastRow: function () { return data.length; },
    getMaxRows: function () { return data.length; },
    insertRowsAfter: function (after, n) { for (var i = 0; i < n; i++) data.push(blank()); }
  };
}

// Settings > App Control access: an account the master lists sees exactly the apps on its list inside App Control…
function stAppControlDelegates_(out) {
  var keep = { alerts: hiringAlerts_, log: hubSysLog_, badge: appBadgeSheet_, config: configBadgeSheet_,
               tenant: appTenantSheet_, read: readTabNormalized_, ss: ssOpen_, id: hubId_, bump: cacheBump_,
               announce: appReleaseAutoAnnounce_, lock: LockService, member: HUB_MEMBER_CTX,
               tenantCtx: HUB_TENANT_CTX, worldCtx: HUB_WORLD_CTX,
               masterCache: HUB_MASTER_EMAIL_CACHE, users: usersAll_, testState: hubTestModeState_,
               gates: hubGatesArmedRead_, notices: hubNoticeSituationsRead_, rules: hubProfileAppRules_,
               actions: {} };
  var KEPT_ACTIONS = ['hiringAlertsSet', 'hiringViewsPolicy', 'clientViewsPolicy', 'potClientsViewsPolicy',
                      'appShelfGet', 'userMenuLinksList', 'appsBuilt'];
  KEPT_ACTIONS.forEach(function (a) { keep.actions[a] = HUB_ACTIONS[a]; });

  var master = { id: 'u-boss', email: 'boss@example.org', role: 'admin' };
  var dee = { id: 'u-dee', email: 'dee@example.org', role: 'manager', types: ['DIRECTOR'] };
  var max = { id: 'u-max', email: 'max@example.org', role: 'staff', types: [] };
  var adm = { id: 'u-adm', email: 'adm@example.org', role: 'admin', types: ['DIRECTOR'] };
  var stf = { id: 'u-stf', email: 'stf@example.org', role: 'staff', types: [] };
  var cli = { id: 'u-cli', email: 'cli@example.org', role: 'client', types: [] };
  var svc = { id: 'SVC_ST', email: 'selftest@service.local', role: 'manager', is_service: true };
  var LIST = [
    { id: 'u-dee', apps: ['scheduling'], may_change: false },
    { id: 'u-max', apps: ['scheduling', 'st-hidden', 'app-control', 'chat.liveChat'], may_change: true },
    { id: 'u-cli', apps: ['scheduling'], may_change: true },
    { id: 'u-boss', apps: ['chat'], may_change: true }
  ];
  var cells = { mywork_appcontrol_delegates: JSON.stringify(LIST), mywork_hide_apps: 'st-hidden' };
  var badge, tenant, config, logged, announced, metas = [], configSaves;
  var fresh = function () {
    badge = stAcSheet_([
      ['app_id', 'badges', 'updated_at', 'updated_by'],
      ['scheduling', 'STAFF', '', 'seed'],
      ['scheduling.builder', 'DIRECTOR', '', 'seed'],
      ['chat', 'STAFF, ADMIN', '', 'seed'],
      ['st-hidden', 'STAFF', '', 'seed'],
      ['time-recon', 'ADMIN', '', 'seed']
    ]);
    tenant = stAcSheet_([['app_id', 'tenants', 'updated_at', 'updated_by'], ['time-recon', 'hq', '', 'seed']]);
    config = stAcSheet_([['section_id', 'badges', 'updated_at', 'updated_by'], ['recon', 'ADMIN', '', 'seed']]);
    logged = [];
    announced = [];
  };
  var rowOf = function (sheet, id) {
    for (var i = 1; i < sheet.data.length; i++) if (String(sheet.data[i][0]) === id) return sheet.data[i];
    return null;
  };
  var snapshot = function () { return JSON.stringify([badge.data, tenant.data, config.data]); };
  var call = function (action, payload, user) {
    try { return HUB_ACTIONS[action](payload, user) || {}; }
    catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  try {
    HUB_MASTER_EMAIL_CACHE = 'boss@example.org';
    HUB_MEMBER_CTX = null;
    fresh();
    hiringAlerts_ = function () { return cells; };
    hubSysLog_ = function (who, kind, text) { logged.push(String(who) + '|' + kind + '|' + text); return true; };
    appBadgeSheet_ = function () { return badge; };
    appTenantSheet_ = function () { return tenant; };
    configBadgeSheet_ = function () { return config; };
    ssOpen_ = function () { return {}; };
    hubId_ = function () { return 'st-book'; };
    cacheBump_ = function () {};
    appReleaseAutoAnnounce_ = function (added, meta) {
      announced.push(JSON.stringify(added));
      metas.push(JSON.stringify(meta));
      return {};
    };
    HUB_TENANT_CTX = null;
    HUB_WORLD_CTX = null;
    LockService = { getScriptLock: function () {
      return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} };
    } };
    readTabNormalized_ = function (ss, tab) {
      var sheet = tab === APP_BADGE_TAB ? badge : tab === APP_TENANT_TAB ? tenant : tab === CONFIG_BADGE_TAB ? config : null;
      if (!sheet) return [];
      var hdr = sheet.data[0].map(normKey_);
      return sheet.data.slice(1)
        .filter(function (r) { return r.some(function (c) { return String(c) !== ''; }); })
        .map(function (r) { var o = {}; hdr.forEach(function (h, i) { o[h] = r[i]; }); return o; });
    };
    // the matrix as the profile apps' cached reader answers it, read from the tab held here — never the real cache
    hubProfileAppRules_ = function () {
      var rules = {};
      readTabNormalized_(null, APP_BADGE_TAB).forEach(function (r) {
        var id = str_(r.appid);
        if (id) rules[id] = userTypesFromRaw_(r.badges).types;
      });
      return { rules: rules, tenants: {} };
    };

    // ---- the list as stored ----
    var parsed = hubAcDelegatesParse_(JSON.stringify([
      { id: ' u-a ', apps: ['x', 'x', 'app-control', 'x.feature', ''], may_change: 'yes' },
      { id: 'u-a', apps: ['y'], may_change: true }, { apps: ['z'] }, 'u-b', null
    ]));
    stAssert_(out, 'app control access: the stored list keeps each account once, drops App Control itself, a ' +
                   'control id and a blank app, and May change is on only for a plain true',
              JSON.stringify(parsed) === JSON.stringify([{ id: 'u-a', apps: ['x'], may_change: false }]),
              JSON.stringify(parsed));
    stAssert_(out, 'app control access: a blank, malformed or non-list cell shares App Control with nobody',
              hubAcDelegatesParse_('').length === 0 && hubAcDelegatesParse_('{not json').length === 0 &&
              hubAcDelegatesParse_('{"id":"u-a"}').length === 0 && hubAcDelegatesParse_(null).length === 0, '');

    // ---- who holds a delegation ----
    var gDee = hubAcDelegateFor_(dee), gMax = hubAcDelegateFor_(max);
    stAssert_(out, 'app control access: a listed manager and a listed staff member each hold their own list, ' +
                   'App Control itself and a control id never on it',
              !!gDee && JSON.stringify(gDee.apps) === '["scheduling"]' && gDee.may_change === false &&
              !!gMax && JSON.stringify(gMax.apps) === '["scheduling","st-hidden"]' && gMax.may_change === true,
              JSON.stringify([gDee, gMax]));
    var held = [hubAcDelegateFor_(adm), hubAcDelegateFor_(stf), hubAcDelegateFor_(cli), hubAcDelegateFor_(master),
                hubAcDelegateFor_(svc), hubAcDelegateFor_(null),
                hubAcDelegateFor_({ id: 'u-dee', email: 'dee@example.org', role: 'manager', visiting_member: 'mem_1' })];
    HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-dee', email: 'dee@example.org' };
    held.push(hubAcDelegateFor_(dee));
    HUB_MEMBER_CTX = null;
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    held.push(hubAcDelegateFor_(dee));
    hiringAlerts_ = function () { return cells; };
    stAssert_(out, 'app control access: nobody else holds one — an admin or staff not listed, a listed client, the ' +
                   'master on the list, the service identity, a visit wearing a listed account, an open visit, and ' +
                   'anybody while the config cannot be read (fail closed)',
              held.every(function (g) { return g === null; }), JSON.stringify(held));
    stAssert_(out, 'app control access: the session\'s auth answer carries the delegation for a listed account ' +
                   'alone',
              JSON.stringify(hubAcDelegatePublic_(dee)) === '{"apps":["scheduling"],"may_change":false}' &&
              hubAcDelegatePublic_(adm) === null && hubAcDelegatePublic_(master) === null,
              JSON.stringify([hubAcDelegatePublic_(dee), hubAcDelegatePublic_(adm)]));

    // ---- non-delegate 404 ----
    var reads404 = [call('appControlDelegateGet', {}, adm), call('appControlDelegateGet', {}, stf),
                    call('appControlDelegateGet', {}, master), call('appControlDelegateGet', {}, cli),
                    call('appControlDelegateGet', {}, svc)];
    stAssert_(out, 'app control access: the delegate read answers the unadvertised 404 to an admin, staff, the ' +
                   'master, a listed client and the service identity — never a row',
              reads404.every(function (r) { return r.status === 404 && r.message === 'Unknown action.' && !r.data; }),
              JSON.stringify(reads404));
    configSaves = [];
    HUB_ACTIONS.hiringAlertsSet = function (payload, user) {
      configSaves.push({ who: user && user.email, values: payload && payload.values });
      return { status: 200, data: { saved: 1 } };
    };
    var settings404 = [call('appControlDelegatesGet', {}, adm), call('appControlDelegatesGet', {}, dee),
                       call('appControlDelegatesGet', {}, max), call('appControlDelegatesSet', { delegates: [] }, adm),
                       call('appControlDelegatesSet', { delegates: [] }, max),
                       call('appControlDelegatesGet', {},
                            { id: 'u-boss', email: 'boss@example.org', role: 'admin', visiting_member: 'mem_1' })];
    stAssert_(out, 'app control access: Settings > App Control access answers 404 to anybody but the master — a ' +
                   'delegate, another admin and a visit to the master — and no save reaches the config tab',
              settings404.every(function (r) { return r.status === 404; }) && configSaves.length === 0,
              JSON.stringify(settings404) + ' saves=' + configSaves.length);

    // ---- the delegate sees only the list ----
    var rDee = call('appControlDelegateGet', {}, dee);
    var rMax = call('appControlDelegateGet', {}, max);
    var keys = function (r) { return Object.keys((r.data && r.data.rules) || {}).sort().join(','); };
    var deeText = JSON.stringify(rDee);
    stAssert_(out, 'app control access: a delegate is handed its apps\' rows and their controls\' rows, as the ' +
                   'master\'s matrix holds them — no other app, no tenant half, no settings section, no other delegate',
              rDee.status === 200 && keys(rDee) === 'scheduling,scheduling.builder' &&
              rDee.data.rules.scheduling.join(',') === 'STAFF' && rDee.data.rules['scheduling.builder'].join(',') === 'DIRECTOR' &&
              JSON.stringify(rDee.data.apps) === '["scheduling"]' && rDee.data.may_change === false &&
              ['chat', 'time-recon', 'st-hidden', 'u-max', 'tenant', 'recon', 'hq'].every(function (w) {
                return deeText.indexOf(w) === -1;
              }), deeText);
    var mine = HUB_ACTIONS.appBadgeAccessGet({}, dee);
    stAssert_(out, 'app control access: an app hidden from everyone else stays hidden from a delegate it was not ' +
                   'listed for — in its own matrix and in App Control — and reaches the one it was listed for',
              mine.status === 200 && !('st-hidden' in mine.data.rules) && deeText.indexOf('st-hidden') === -1 &&
              rMax.status === 200 && keys(rMax) === 'scheduling,scheduling.builder,st-hidden' &&
              JSON.stringify(rMax).indexOf('chat') === -1,
              JSON.stringify([mine.data && Object.keys(mine.data.rules), rMax]));

    // ---- view only refuses writes ----
    var before = snapshot();
    var viewOnly = [call('appBadgeAccessSet', { app_id: 'scheduling', badges: ['STAFF', 'MANAGER'] }, dee),
                    call('appBadgeAccessSet', { app_id: 'scheduling.builder', badges: [] }, dee),
                    call('appAccessSetBulk', { rules: { scheduling: ['STAFF', 'MANAGER'] } }, dee)];
    stAssert_(out, 'app control access: with May change off every write is refused, the single door and the bulk ' +
                   'Apply alike, before a cell is touched',
              viewOnly.every(function (r) { return r.status === 403 && /to view/.test(r.message); }) &&
              snapshot() === before && announced.length === 0, JSON.stringify(viewOnly));

    // ---- may change: inside the list ----
    var inside = call('appBadgeAccessSet', { app_id: 'scheduling', badges: ['STAFF', 'MANAGER'] }, max);
    var schedRow = rowOf(badge, 'scheduling');
    var insideLog = logged.filter(function (l) { return l.indexOf('app_badge_access_set') !== -1; }).pop() || '';
    stAssert_(out, 'app control access: with May change on a delegate writes its own app\'s row, signed with its ' +
                   'own e-mail on the row and in the log, which says it came through App Control access',
              inside.status === 200 && !!schedRow && /MANAGER/.test(String(schedRow[1])) && /STAFF/.test(String(schedRow[1])) &&
              schedRow[3] === 'max@example.org' && insideLog.indexOf('max@example.org|') === 0 &&
              insideLog.indexOf('(App Control access)') !== -1,
              JSON.stringify([inside, schedRow, insideLog]));
    var feature = call('appBadgeAccessSet', { app_id: 'scheduling.builder', badges: ['DIRECTOR', 'HM'] }, max);
    var hidden = call('appBadgeAccessSet', { app_id: 'st-hidden', badges: ['STAFF', 'MANAGER'] }, max);
    stAssert_(out, 'app control access: a control inside a listed app and a hidden app on the list are the ' +
                   'delegate\'s to write too',
              feature.status === 200 && /HM/.test(String(rowOf(badge, 'scheduling.builder')[1])) &&
              hidden.status === 200 && /MANAGER/.test(String(rowOf(badge, 'st-hidden')[1])),
              JSON.stringify([feature, hidden]));

    // ---- may change: refused outside it ----
    before = snapshot();
    var outside = [call('appBadgeAccessSet', { app_id: 'chat', badges: ['STAFF'] }, max),
                   call('appBadgeAccessSet', { app_id: 'chat.liveChat', badges: ['STAFF'] }, max),
                   call('appBadgeAccessSet', { app_id: 'app-control', badges: [] }, max),
                   call('appBadgeAccessSet', { app_id: 'time-recon', badges: [] }, max),
                   call('appAccessSetBulk', { rules: { scheduling: ['STAFF'], chat: ['STAFF'] } }, max),
                   call('appAccessSetBulk', { rules: { scheduling: ['STAFF'] }, tenants: { scheduling: ['hq'] } }, max),
                   call('appAccessSetBulk', { rules: { scheduling: ['STAFF'] }, sections: { recon: [] } }, max)];
    var tenantDoor = call('appTenantAccessSet', { app_id: 'scheduling', tenants: ['hq'] }, max);
    stAssert_(out, 'app control access: outside the list a delegate is refused whole — another app, a control of ' +
                   'another app, App Control itself, an Apply naming one app too many, a tenant row and a settings ' +
                   'section — and the tenant door stays the master\'s; not a cell moves',
              outside.every(function (r) { return r.status === 403; }) && tenantDoor.status === 404 &&
              snapshot() === before, JSON.stringify(outside.concat([tenantDoor])));
    // ---- at home alone ----
    var awayAnswers = [];
    [{ tenant: { tenantId: 'st-ohio' }, world: null }, { tenant: null, world: { worldId: 'wld_st', ssId: 'st-world' } }]
      .forEach(function (place) {
        HUB_TENANT_CTX = place.tenant;
        HUB_WORLD_CTX = place.world;
        try {
          awayAnswers.push(call('appBadgeAccessSet', { app_id: 'scheduling', badges: ['STAFF'] }, max));
          awayAnswers.push(call('appAccessSetBulk', { rules: { scheduling: ['STAFF'] } }, max));
          awayAnswers.push(call('appControlDelegateGet', {}, max));
        } finally {
          HUB_TENANT_CTX = null;
          HUB_WORLD_CTX = null;
        }
      });
    stAssert_(out, 'app control access: away from home and inside a world a delegate\'s read and both write doors ' +
                   'answer the unadvertised 404, and not a cell moves',
              awayAnswers.length === 6 &&
              awayAnswers.every(function (r) { return r.status === 404 && r.message === 'Unknown action.' && !r.data; }) &&
              snapshot() === before, JSON.stringify(awayAnswers));

    // ---- the release letter's words ----
    metas = [];
    var lure = { name: 'Scheduling', tagline: 'Shifts\nand more', whole: true, since: '2000-01-01T00:00:00Z' };
    var oneMeta = call('appBadgeAccessSet', { app_id: 'scheduling', badges: ['STAFF', 'MANAGER', 'HM'], app_meta: lure }, max);
    var bulkMeta = call('appAccessSetBulk', { rules: { scheduling: ['STAFF', 'MANAGER', 'HM', 'ADMIN'] },
                                             app_meta: { scheduling: lure, chat: { name: 'Chat', whole: true } } }, max);
    stAssert_(out, 'app control access: a delegate\'s grant lands and Apps Script announces nothing itself — the ' +
                   'release is told to Python by the relay, with the app\'s name and tagline alone',
              oneMeta.status === 200 && bulkMeta.status === 200 && metas.length === 0,
              JSON.stringify([oneMeta, bulkMeta, metas]));

    var bulk = call('appAccessSetBulk', { rules: { scheduling: ['STAFF'], 'scheduling.builder': ['DIRECTOR'] } }, max);
    var echo = (bulk.data && bulk.data.badges) || {};
    stAssert_(out, 'app control access: a delegate\'s Apply inside its list lands, every other row kept verbatim, ' +
                   'and its echo holds its own apps\' rows alone',
              bulk.status === 200 && rowOf(badge, 'scheduling')[1] === 'STAFF' && rowOf(badge, 'scheduling')[3] === 'max@example.org' &&
              rowOf(badge, 'chat')[1] === 'STAFF, ADMIN' && rowOf(badge, 'time-recon')[1] === 'ADMIN' &&
              Object.keys(echo).sort().join(',') === 'scheduling,scheduling.builder,st-hidden' &&
              JSON.stringify(bulk.data.tenants) === '{}' && JSON.stringify(bulk.data.sections) === '{}',
              JSON.stringify(bulk));

    // ---- everybody else as before ----
    var adminWrites = [call('appBadgeAccessSet', { app_id: 'chat', badges: [] }, adm),
                       call('appAccessSetBulk', { rules: { chat: [] } }, adm)];
    var staffWrites = [call('appBadgeAccessSet', { app_id: 'chat', badges: [] }, stf),
                       call('appAccessSetBulk', { sections: { recon: [] } }, stf),
                       call('appBadgeAccessSet', { app_id: 'scheduling', badges: [] }, cli)];
    stAssert_(out, 'app control access: an admin nobody listed still hears the unadvertised 404, and an account ' +
                   'that is not an admin still hears "This action is for admin." — the listed client included',
              adminWrites.every(function (r) { return r.status === 404 && r.message === 'Unknown action.'; }) &&
              staffWrites.every(function (r) { return r.status === 403 && r.message === 'This action is for admin.'; }),
              JSON.stringify(adminWrites.concat(staffWrites)));
    logged = [];
    metas = [];
    var mWrite = call('appBadgeAccessSet', { app_id: 'chat', badges: ['STAFF'] }, master);
    var mMeta = { chat: { name: 'Chat', tagline: 'Talk', whole: true } };
    var mBulk = call('appAccessSetBulk', { rules: { chat: ['STAFF', 'ADMIN'] }, tenants: { chat: ['hq'] },
                                          app_meta: mMeta }, master);
    var mEcho = (mBulk.data && mBulk.data.badges) || {};
    stAssert_(out, 'app control access: the master is unchanged — every app, the tenant half, the whole echo, no ' +
                   'release letter from Apps Script (Python\'s), and no delegation for the master account though the ' +
                   'list names it',
              mWrite.status === 200 && mBulk.status === 200 && 'time-recon' in mEcho && 'chat' in mEcho &&
              'st-hidden' in mEcho && mBulk.data.tenants.chat === 'hq' && rowOf(tenant, 'chat') !== null &&
              logged.every(function (l) { return l.indexOf('(App Control access)') === -1; }) &&
              metas.length === 0 && hubAcDelegateFor_(master) === null,
              JSON.stringify([mWrite, mBulk, logged, metas]));

    // ---- the master's Settings ----
    usersAll_ = function () {
      return [
        { userid: 'u-boss', email: 'boss@example.org', role: 'admin', displayname: 'Boss' },
        { userid: 'u-dee', email: 'dee@example.org', role: 'manager', displayname: 'Dee' },
        { userid: 'u-max', email: 'max@example.org', role: 'staff', displayname: 'Max' },
        { userid: 'u-cli', email: 'cli@example.org', role: 'client', displayname: 'Cli' }
      ];
    };
    var list = call('appControlDelegatesGet', {}, master);
    stAssert_(out, 'app control access: the master reads the list as stored, App Control itself and a control id ' +
                   'already gone from it',
              list.status === 200 && list.data.delegates.length === 4 && list.data.malformed === false &&
              JSON.stringify(list.data.delegates[1].apps) === '["scheduling","st-hidden"]', JSON.stringify(list));
    configSaves = [];
    var refusedSaves = [
      call('appControlDelegatesSet', { delegates: [{ id: 'u-boss', apps: ['chat'] }] }, master),
      call('appControlDelegatesSet', { delegates: [{ id: 'u-cli', apps: ['chat'] }] }, master),
      call('appControlDelegatesSet', { delegates: [{ id: 'u-nobody', apps: ['chat'] }] }, master),
      call('appControlDelegatesSet', { delegates: [{ id: 'u-dee', apps: ['chat', 'app-control'] }] }, master),
      call('appControlDelegatesSet', { delegates: [{ id: 'u-dee', apps: ['scheduling.builder'] }] }, master),
      call('appControlDelegatesSet', { delegates: [{ id: 'u-dee', apps: [] }] }, master),
      call('appControlDelegatesSet', { delegates: [{ id: 'u-dee', apps: ['chat'] }, { id: 'u-dee', apps: ['x'] }] }, master)
    ];
    stAssert_(out, 'app control access: the master\'s save refuses the master account, a client, an unknown ' +
                   'account, App Control itself, a control id, an empty list of apps and a person twice — whole, ' +
                   'before the config tab is asked',
              refusedSaves.every(function (r) { return r.status === 400; }) && configSaves.length === 0,
              JSON.stringify(refusedSaves));
    var saved = call('appControlDelegatesSet', { delegates: [
      { id: 'u-dee', apps: ['scheduling', 'scheduling', ' time-recon '], may_change: true },
      { id: 'u-max', apps: ['chat'], may_change: 'yes' }
    ] }, master);
    var wrote = configSaves.length === 1 ? configSaves[0].values : {};
    stAssert_(out, 'app control access: the master\'s save writes the list once, through the config tab\'s own ' +
                   'door, each app once and May change on only when switched on',
              saved.status === 200 && configSaves.length === 1 && configSaves[0].who === 'boss@example.org' &&
              wrote.mywork_appcontrol_delegates === JSON.stringify([
                { id: 'u-dee', apps: ['scheduling', 'time-recon'], may_change: true },
                { id: 'u-max', apps: ['chat'], may_change: false }]),
              JSON.stringify([saved, configSaves]));

    // ---- the relay's early answer ----
    ['hiringViewsPolicy', 'clientViewsPolicy', 'potClientsViewsPolicy', 'appShelfGet', 'userMenuLinksList',
     'appsBuilt'].forEach(function (a) { HUB_ACTIONS[a] = function () { return { status: 403 }; }; });
    hubTestModeState_ = function () { return { on: false, explicit: false, unrecognized: '' }; };
    hubGatesArmedRead_ = function () { return { map: {} }; };
    hubNoticeSituationsRead_ = function () { return { map: {} }; };
    var laneOf = function (u) { var r = HUB_ACTIONS.configLane({}, u); return (r && r.data) || {}; };
    var lSvc = laneOf(svc), lMax = laneOf(max), lAdm = laneOf(adm);
    stAssert_(out, 'app control access: the config lane hands the relay the accounts whose May change is on, and ' +
                   'hands the list to no other caller',
              Array.isArray(lSvc.app_control_writers) && lSvc.app_control_writers.indexOf('u-max') !== -1 &&
              lSvc.app_control_writers.indexOf('u-dee') === -1 &&
              !('app_control_writers' in lMax) && !('app_control_writers' in lAdm),
              JSON.stringify([lSvc.app_control_writers, lMax.app_control_writers]));
  } finally {
    hiringAlerts_ = keep.alerts; hubSysLog_ = keep.log; appBadgeSheet_ = keep.badge; configBadgeSheet_ = keep.config;
    appTenantSheet_ = keep.tenant; readTabNormalized_ = keep.read; ssOpen_ = keep.ss; hubId_ = keep.id;
    cacheBump_ = keep.bump; appReleaseAutoAnnounce_ = keep.announce; LockService = keep.lock;
    HUB_MEMBER_CTX = keep.member; HUB_MASTER_EMAIL_CACHE = keep.masterCache; usersAll_ = keep.users;
    HUB_TENANT_CTX = keep.tenantCtx; HUB_WORLD_CTX = keep.worldCtx;
    hubTestModeState_ = keep.testState; hubGatesArmedRead_ = keep.gates; hubNoticeSituationsRead_ = keep.notices;
    hubProfileAppRules_ = keep.rules;
    KEPT_ACTIONS.forEach(function (a) { HUB_ACTIONS[a] = keep.actions[a]; });
  }
}
