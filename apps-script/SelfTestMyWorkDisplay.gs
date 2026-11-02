/** Settings > My Work: the master's own session alone saves the switches, and the config lane carries them. */
function stMyWorkDisplay_(out) {
  var keep = { sheet: hiringAlertsSheet_, log: hubSysLog_, alerts: hiringAlerts_, member: HUB_MEMBER_CTX,
               masterCache: HUB_MASTER_EMAIL_CACHE, catalog: hiringAlertsCatalog_, testState: hubTestModeState_,
               shared: hubTestSharedWarning_, scorecard: interviewWhoCanRecord_, gates: hubGatesArmedRead_,
               notices: hubNoticeSituationsRead_, actions: {} };
  var LANE_PARTS = ['hiringViewsPolicy', 'clientViewsPolicy', 'potClientsViewsPolicy', 'appShelfGet',
                    'userMenuLinksList', 'appsBuilt'];
  LANE_PARTS.forEach(function (a) { keep.actions[a] = HUB_ACTIONS[a]; });
  var sheetAsked = 0;
  var logged = [];
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var admin = { email: 'admin@example.org', role: 'admin' };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    hubSysLog_ = function (who, kind, text) { logged.push(kind + ': ' + text); return true; };
    hiringAlertsSheet_ = function () { sheetAsked++; throw new Error('st: the tab is not opened here'); };
    var tries = function (values, user) {
      try { return HUB_ACTIONS.hiringAlertsSet({ values: values }, user); }
      catch (e) { return { threw: String((e && e.message) || e) }; }
    };

    var plain = tries({ mywork_hide_completed: 'yes' }, admin);
    var mixed = tries({ mywork_hide_header: 'yes', interview_scorecard_emails: 'x@example.org' }, admin);
    var visit = tries({ mywork_hide_header: 'yes' },
                      { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' });
    HUB_MEMBER_CTX = { memberId: 'mem_st', userId: 'u-boss', email: HUB_MASTER_ACCOUNT };
    var inVisit = tries({ mywork_hide_header: 'yes' }, master);
    HUB_MEMBER_CTX = null;
    // acting as someone: the session's account is the other person's
    var acting = tries({ mywork_hide_source_notes: 'yes' }, { email: 'ann@example.org', role: 'staff' });
    var actingAdmin = tries({ mywork_hide_source_notes: 'yes' }, { email: 'dee@example.org', role: 'admin' });
    var inboxAdmin = tries({ mywork_hide_inbox_sources: 'yes' }, admin);
    var ssaAdmin = tries({ mywork_hide_ssa_updated: 'no', mywork_hide_ssa_county: 'no', mywork_hide_ssa_count: 'no',
                           mywork_hide_ssa_role: 'no' }, admin);
    var ssaVisit = tries({ mywork_hide_ssa_role: 'no' },
                         { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' });
    var ssaActing = tries({ mywork_hide_ssa_county: 'no' }, { email: 'dee@example.org', role: 'admin' });
    var schedAdmin = tries({ mywork_hide_sched_hours: 'no' }, admin);
    var schedVisit = tries({ mywork_hide_sched_hours: 'no' },
                           { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' });
    var schedActing = tries({ mywork_hide_sched_hours: 'no' }, { email: 'dee@example.org', role: 'admin' });
    stAssert_(out, 'my work display: an admin that is not the master, a visit to the master and an acting session ' +
                   'are refused before a cell is touched, a mixed save whole',
              plain.status === 403 && mixed.status === 403 && visit.status === 403 && inVisit.status === 403 &&
              actingAdmin.status === 403 && !!acting.status && acting.status !== 200 && sheetAsked === 0 &&
              String(plain.message).indexOf('mywork_hide_completed') !== -1,
              JSON.stringify([plain, mixed, visit, inVisit, acting, actingAdmin]) + ' sheet=' + sheetAsked);
    stAssert_(out, 'my work display: the My Inbox Sources switch is the master\'s alone too — another admin is ' +
                   'refused before a cell is touched',
              inboxAdmin.status === 403 && sheetAsked === 0 &&
              String(inboxAdmin.message).indexOf('mywork_hide_inbox_sources') !== -1,
              JSON.stringify(inboxAdmin) + ' sheet=' + sheetAsked);
    stAssert_(out, 'my work display: the four SSA switches are the master\'s alone too — another admin, a visit to the ' +
                   'master and an acting session are refused, every key named, before a cell is touched',
              ssaAdmin.status === 403 && ssaVisit.status === 403 && ssaActing.status === 403 && sheetAsked === 0 &&
              ['mywork_hide_ssa_updated', 'mywork_hide_ssa_county', 'mywork_hide_ssa_count', 'mywork_hide_ssa_role']
                .every(function (k) { return String(ssaAdmin.message).indexOf(k) !== -1; }),
              JSON.stringify([ssaAdmin, ssaVisit, ssaActing]) + ' sheet=' + sheetAsked);
    stAssert_(out, 'my work display: the Scheduling hours switch is the master\'s alone too — another admin, a visit ' +
                   'to the master and an acting session are refused, the key named, before a cell is touched',
              schedAdmin.status === 403 && schedVisit.status === 403 && schedActing.status === 403 &&
              sheetAsked === 0 && String(schedAdmin.message).indexOf('mywork_hide_sched_hours') !== -1,
              JSON.stringify([schedAdmin, schedVisit, schedActing]) + ' sheet=' + sheetAsked);
    stAssert_(out, 'my work display: the refusal is logged as refused keys, and says nothing else',
              logged.length >= 4 && logged.every(function (l) {
                return l.indexOf('hiring_alerts_refused: my work display keys refused: mywork_') === 0;
              }), JSON.stringify(logged));

    var keepMaster = hubIsRealMaster_;
    var thrown = null;
    try {
      hubIsRealMaster_ = function () { throw new Error('the check could not answer'); };
      thrown = tries({ mywork_hide_header: 'yes' }, master);
    } finally {
      hubIsRealMaster_ = keepMaster;
    }
    stAssert_(out, 'my work display: a master check that throws refuses (fail closed)',
              !!thrown && thrown.status === 403 && sheetAsked === 0, JSON.stringify(thrown));

    var mine = tries({ mywork_hide_header: 'yes', mywork_hide_completed: 'yes', mywork_hide_inbox_sources: 'yes',
                       mywork_hide_ssa_role: 'no' }, master);
    var other = tries({ interview_scorecard_emails: 'x@example.org' }, admin);
    stAssert_(out, 'my work display: the master\'s own session reaches the save, and every other key stays on the ' +
                   'admin gate',
              sheetAsked === 2 && !(mine && mine.status === 403) && !(other && other.status === 403),
              JSON.stringify([mine, other]) + ' sheet=' + sheetAsked);

    // the catalogue as the shipped copy answers it, so a key with no cell reads as its shipped default
    hiringAlertsCatalog_ = function () { return hiringAlertsCatalogMerge_({ read: true, rows: [], refused: [] }); };
    hiringAlerts_ = function () {
      return { mywork_hide_header: 'yes', mywork_hide_source_notes: ' ON ', mywork_hide_missing_row: 'maybe' };
    };
    var read = hubMyWorkHideRead_();
    stAssert_(out, 'my work display: the lane reads yes as hide, anything not plainly yes as shown, and a key with ' +
                   'no row as its default — shown for My Work and My Inbox, hidden for the four SSA parts and ' +
                   'the Scheduling hours',
              read.header === true && read.source_notes === true && read.missing_row === false &&
              read.completed === false && read.inbox_sources === false && read.ssa_updated === true &&
              read.ssa_county === true && read.ssa_count === true && read.ssa_role === true &&
              read.sched_hours === true && read.record_notes === true && Object.keys(read).length === 11,
              JSON.stringify(read));
    hiringAlerts_ = function () {
      return { mywork_hide_ssa_county: 'no', mywork_hide_ssa_role: ' Yes ', mywork_hide_ssa_count: '' };
    };
    var ssaCells = hubMyWorkHideRead_();
    stAssert_(out, 'my work display: an SSA part\'s own cell wins over its default — no or an empty cell shows it, yes ' +
                   'hides it — and a part with no cell stays hidden',
              ssaCells.ssa_county === false && ssaCells.ssa_count === false && ssaCells.ssa_role === true &&
              ssaCells.ssa_updated === true && ssaCells.header === false, JSON.stringify(ssaCells));
    hiringAlerts_ = function () { return {}; };
    hiringAlertsCatalog_ = function () {
      return hiringAlertsCatalogMerge_({ read: true, refused: [],
        rows: [{ key: 'mywork_hide_ssa_count', group: 'mywork', value: 'no', note: 'n' },
               { key: 'mywork_hide_header', group: 'mywork', value: 'yes', note: 'n' }] });
    };
    var sheetDefaults = hubMyWorkHideRead_();
    hiringAlertsCatalog_ = function () { throw new Error('st: the catalogue could not be read'); };
    var shippedDefaults = hubMyWorkHideRead_();
    stAssert_(out, 'my work display: the default is the catalogue sheet\'s, as Settings shows it; a catalogue that ' +
                   'throws falls to the shipped copy, and still answers',
              sheetDefaults.ssa_count === false && sheetDefaults.header === true && sheetDefaults.ssa_role === true &&
              shippedDefaults.ssa_count === true && shippedDefaults.header === false &&
              shippedDefaults.ssa_updated === true, JSON.stringify([sheetDefaults, shippedDefaults]));
    hiringAlertsCatalog_ = function () { return hiringAlertsCatalogMerge_({ read: true, rows: [], refused: [] }); };
    hiringAlerts_ = function () { return { mywork_hide_inbox_sources: ' Yes ' }; };
    var inboxRead = hubMyWorkHideRead_();
    stAssert_(out, 'my work display: the My Inbox Sources switch is read as its own part, inbox_sources, and ' +
                   'hides nothing else',
              inboxRead.inbox_sources === true && inboxRead.header === false && inboxRead.source_notes === false &&
              inboxRead.missing_row === false && inboxRead.completed === false, JSON.stringify(inboxRead));
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    var failed = null;
    try { hubMyWorkHideRead_(); } catch (eR) { failed = String((eR && eR.message) || eR); }
    stAssert_(out, 'my work display: a tab that cannot be read throws, so the lane says unreadable instead of ' +
                   'answering nothing hidden', failed === 'the config tab could not be opened', String(failed));

    var keepAlerts = hiringAlerts_;
    var schedAs = function (cfg) {
      hiringAlerts_ = function () { if (cfg === 'throw') throw new Error('the config tab could not be opened'); return cfg; };
      return hubSchedHoursHidden_();
    };
    var schedRead = [];
    try {
      schedRead = [schedAs('throw'), schedAs({}), schedAs({ mywork_hide_sched_hours: ' No ' }),
                   schedAs({ mywork_hide_sched_hours: 'yes' }), schedAs({ mywork_hide_sched_hours: '' }),
                   schedAs({ mywork_hide_sched_hours: 'hide' }), schedAs({ mywork_hide_sched_hours: 'off' })];
    } finally {
      hiringAlerts_ = keepAlerts;
    }
    stAssert_(out, 'my work display: the Scheduling hours hide unless the switch plainly says shown — a read that ' +
                   'throws hides, a missing key hides (as it ships), a blank cell or an unknown word hides; only ' +
                   'a plain no or off shows (fail closed)',
              JSON.stringify(schedRead) === '[true,true,false,true,true,true,false]', JSON.stringify(schedRead));

    var lane = stCode_(HUB_ACTIONS.configLane);
    stAssert_(out, 'my work display: the config lane carries the switches, and an unreadable read travels as its own key',
              lane.indexOf('out.my_work_hide = hubMyWorkHideRead_()') !== -1 &&
              lane.indexOf('out.my_work_hide_unreadable') !== -1, '');

    // the config lane, called by each kind of caller; every other part of it is stubbed to refuse
    LANE_PARTS.forEach(function (a) { HUB_ACTIONS[a] = function () { return { status: 403 }; }; });
    hubTestModeState_ = function () { return { on: false, explicit: false, unrecognized: '' }; };
    hubGatesArmedRead_ = function () { return { map: {} }; };
    hubNoticeSituationsRead_ = function () { return { map: {} }; };
    hiringAlerts_ = function () { return { mywork_hide_completed: 'yes', mywork_hide_inbox_sources: 'yes' }; };
    var svc = { id: 'SVC_ST', email: 'selftest@service.local', role: 'manager', is_service: true };
    var laneOf = function (user) {
      var r = HUB_ACTIONS.configLane({}, user);
      return (r && r.data) || {};
    };
    var withBlock = function (d) {
      return !!d.my_work_hide && d.my_work_hide.completed === true && d.my_work_hide.inbox_sources === true &&
             d.my_work_hide.header === false && d.my_work_hide.ssa_updated === true &&
             d.my_work_hide.ssa_county === true && d.my_work_hide.ssa_count === true &&
             d.my_work_hide.ssa_role === true && d.my_work_hide.sched_hours === true &&
             !('my_work_hide_unreadable' in d);
    };
    var without = function (d) { return !('my_work_hide' in d) && !('my_work_hide_unreadable' in d); };
    var gotSvc = laneOf(svc);
    var gotMaster = laneOf(master);
    var gotAdmin = laneOf(admin);
    var gotStaff = laneOf({ email: 'ann@example.org', role: 'staff' });
    var gotVisit = laneOf({ email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' });
    stAssert_(out, 'my work display: the config lane hands the switches — the four SSA parts at their default among ' +
                   'them — to the relay\'s service identity and the master\'s own session, and to no other caller',
              withBlock(gotSvc) && withBlock(gotMaster) && without(gotAdmin) && without(gotStaff) && without(gotVisit),
              JSON.stringify([gotSvc.my_work_hide, gotMaster.my_work_hide, gotAdmin.my_work_hide,
                              gotStaff.my_work_hide, gotVisit.my_work_hide]));
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    var brokenSvc = laneOf(svc);
    var brokenAdmin = laneOf(admin);
    stAssert_(out, 'my work display: an unreadable read reaches the relay as its own key, and no other caller ' +
                   'sees it or its reason',
              String(brokenSvc.my_work_hide_unreadable).indexOf('could not be opened') !== -1 &&
              !('my_work_hide' in brokenSvc) && without(brokenAdmin), JSON.stringify(brokenAdmin));
    var keepMaster2 = hubIsRealMaster_;
    try {
      hubIsRealMaster_ = function () { throw new Error('the check could not answer'); };
      stAssert_(out, 'my work display: a master check that throws hands the lane block to nobody but the service',
                hubMyWorkHideLaneFor_(master) === false && hubMyWorkHideLaneFor_(svc) === true, '');
    } finally {
      hubIsRealMaster_ = keepMaster2;
    }

    // hiringAlertsGet: the switches' rows reach the master's own session alone
    hiringAlerts_ = function () { return { mywork_hide_header: 'yes', interview_scorecard_emails: 'x@example.org' }; };
    hubTestSharedWarning_ = function () { return ''; };
    interviewWhoCanRecord_ = function () { return null; };
    hiringAlertsCatalog_ = function () {
      return { ok: false, read: true, source: 'sheet', tab: 'st', sheet_keys: 1, doubled: 0,
               rows: [{ key: 'interview_scorecard_emails', group: 'access', value: '', note: 'n' },
                      { key: 'mywork_hide_header', group: 'mywork', value: 'no', note: '' },
                      { key: 'mywork_hide_completed', group: 'mywork', value: 'no', note: '' }],
               shipped_only: ['mywork_hide_header', 'mywork_hide_completed', 'st_other_key'],
               repaired: ['mywork_hide_completed: group "x" is not one the platform draws'], refused: [],
               message: '' };
    };
    var getAs = function (user) {
      var r = HUB_ACTIONS.hiringAlertsGet({}, user);
      return (r && r.data) || {};
    };
    var asAdmin = getAs(admin);
    var asMaster = getAs(master);
    var asVisit = getAs({ email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' });
    var keysOf = function (d) { return (d.rows || []).map(function (r) { return r.key; }).join(','); };
    stAssert_(out, 'my work display: another admin\'s hiringAlertsGet carries no switch, no value and no key name; ' +
                   'the master\'s own session reads them',
              keysOf(asAdmin) === 'interview_scorecard_emails' && JSON.stringify(asAdmin).indexOf('mywork_') === -1 &&
              asAdmin.catalogue.keys === 1 && asAdmin.catalogue.shipped_only.join(',') === 'st_other_key' &&
              keysOf(asVisit) === 'interview_scorecard_emails' && JSON.stringify(asVisit).indexOf('mywork_') === -1 &&
              keysOf(asMaster) === 'interview_scorecard_emails,mywork_hide_header,mywork_hide_completed' &&
              asMaster.rows[1].value === 'yes' && asMaster.catalogue.repaired.length === 1,
              JSON.stringify([keysOf(asAdmin), asAdmin.catalogue, keysOf(asMaster)]));
    hiringAlertsCatalog_ = keep.catalog;

    // the catalogue's notice, which every admin reads, never counts or names the switches
    var ship = HIRING_ALERTS_CATALOG_SHIPPED.filter(function (d) { return !hubMyWorkHideKey_(d.key); });
    var asRow = function (d) { return { key: d.key, group: d.group, value: d.value, note: 'n' }; };
    var onlyMine = hiringAlertsCatalogMerge_({ read: true, rows: ship.map(asRow), refused: [] });
    var mixedMerge = hiringAlertsCatalogMerge_({
      read: true, refused: [],
      rows: ship.slice(1).map(asRow).concat([{ key: 'mywork_hide_header', group: 'nope', value: 'no', note: 'n' }]) });
    stAssert_(out, 'my work display: the catalogue notice never counts or names the switches, and still names any ' +
                   'other key the sheet lacks',
              onlyMine.message === '' &&
              // the six apps / world / My asa.
              onlyMine.shipped_only.length === Object.keys(MYWORK_HIDE_KEYS).length + Object.keys(MYWORK_AUTO_KEYS).length + 8 &&
              mixedMerge.message.indexOf('mywork_') === -1 && mixedMerge.message.indexOf(ship[0].key) !== -1 &&
              mixedMerge.message.indexOf('1 key(s)') === 0 && mixedMerge.repaired.length === 1,
              JSON.stringify([onlyMine.message, mixedMerge.message]));

    var shipped = {};
    HIRING_ALERTS_CATALOG_SHIPPED.forEach(function (d) { shipped[d.key] = d; });
    var missing = [];
    for (var part in MYWORK_HIDE_KEYS) {
      if (!MYWORK_HIDE_KEYS.hasOwnProperty(part)) continue;
      var d = shipped[MYWORK_HIDE_KEYS[part]];
      var want = /^(ssa_|sched_|record_)/.test(part) ? 'yes' : 'no';
      if (!d || d.group !== 'mywork' || d.value !== want) missing.push(MYWORK_HIDE_KEYS[part]);
    }
    stAssert_(out, 'my work display: every switch ships in the catalogue under mywork — My Work\'s and the My Inbox ' +
                   'Sources card shown by default, the four SSA parts and the Scheduling hours hidden by default',
              missing.length === 0 && HIRING_ALERTS_CATALOG_GROUPS.indexOf('mywork') !== -1 &&
              Object.keys(MYWORK_HIDE_KEYS).length === 11 &&
              MYWORK_HIDE_KEYS.sched_hours === 'mywork_hide_sched_hours' &&
              MYWORK_HIDE_KEYS.record_notes === 'mywork_hide_record_notes' &&
              MYWORK_HIDE_KEYS.inbox_sources === 'mywork_hide_inbox_sources' &&
              MYWORK_HIDE_KEYS.ssa_updated === 'mywork_hide_ssa_updated' &&
              MYWORK_HIDE_KEYS.ssa_county === 'mywork_hide_ssa_county' &&
              MYWORK_HIDE_KEYS.ssa_count === 'mywork_hide_ssa_count' &&
              MYWORK_HIDE_KEYS.ssa_role === 'mywork_hide_ssa_role', missing.join(', '));

    // SSA's own answers carry its four parts to every session, the same for every caller
    var keepRead = hubMyWorkHideRead_;
    try {
      hubMyWorkHideRead_ = function () {
        return { header: true, inbox_sources: true, ssa_updated: true, ssa_county: false, ssa_count: true,
                 ssa_role: true };
      };
      var shown = ssaShown_({ status: 200, data: { notes: [] } });
      var refused = ssaShown_({ status: 404, message: 'Unknown action.' });
      hubMyWorkHideRead_ = function () { throw new Error('the config tab could not be opened'); };
      var unread = ssaShown_({ status: 200, data: { notes: [] } });
      stAssert_(out, 'my work display: an SSA answer carries display.hidden with its four parts alone, a refusal is ' +
                     'untouched, and switches that cannot be read put no display on it (nothing hidden)',
                JSON.stringify(shown) === JSON.stringify({ status: 200, data: { notes: [], display: { hidden:
                  { updated: true, county: false, count: true, role: true } } } }) &&
                JSON.stringify(refused) === JSON.stringify({ status: 404, message: 'Unknown action.' }) &&
                JSON.stringify(unread) === JSON.stringify({ status: 200, data: { notes: [] } }),
                JSON.stringify([shown, refused, unread]));
    } finally {
      hubMyWorkHideRead_ = keepRead;
    }
    var overviewDoor = stCode_(ssaOverviewDoor_), notesDoor = stCode_(ssaNotesDoor_);
    stAssert_(out, 'my work display: the SSA overview and notes doors — the relay\'s pack reads the same doors — put ' +
                   'the display on after the cut and the cache; documents and activity carry none',
              overviewDoor.indexOf('return ssaShown_(ssaCutAnswer_(ssaServe_(') !== -1 &&
              notesDoor.indexOf('return ssaShown_(ssaServe_(\'ssaProfileNotes\'') !== -1 &&
              stCode_(ssaDocumentsDoor_).indexOf('ssaShown_') === -1 &&
              stCode_(ssaActivityDoor_).indexOf('ssaShown_') === -1 &&
              stCode_(ssaPackDoors_).indexOf('ssaOverviewDoor_(ask)') !== -1 &&
              stCode_(ssaPackDoors_).indexOf('ssaNotesDoor_(ask)') !== -1, '');
  } finally {
    hiringAlertsSheet_ = keep.sheet; hubSysLog_ = keep.log; hiringAlerts_ = keep.alerts;
    HUB_MEMBER_CTX = keep.member; HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    hiringAlertsCatalog_ = keep.catalog; hubTestModeState_ = keep.testState; hubTestSharedWarning_ = keep.shared;
    interviewWhoCanRecord_ = keep.scorecard; hubGatesArmedRead_ = keep.gates; hubNoticeSituationsRead_ = keep.notices;
    LANE_PARTS.forEach(function (a) { HUB_ACTIONS[a] = keep.actions[a]; });
  }
  stMyWorkApps_(out);
  stMyWorld_(out);
  stMyAsa_(out);
}

function stMyAsa_(out) {
  var keep = { sheet: hiringAlertsSheet_, log: hubSysLog_, alerts: hiringAlerts_, member: HUB_MEMBER_CTX,
               caller: HUB_CALLER, masterCache: HUB_MASTER_EMAIL_CACHE };
  var master = { id: 'u-boss', email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var admin = { id: 'u-adm', email: 'admin@example.org', role: 'admin' };
  var bob = { id: 'u-bob', email: 'bob@example.org', role: 'staff' };
  var ann = { id: 'u-ann', email: 'ann@example.org', role: 'staff' };
  var annVisit = { id: 'u-ann', email: 'ann@example.org', role: 'staff', visiting_member: 'mem_1' };
  var bobVisited = { id: 'u-bob', email: 'bob@example.org', role: 'staff', visiting_member: 'mem_9', acting_for: 'u-bob' };
  var masterVisit = { id: 'u-boss', email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' };
  var svc = { id: 'SVC_ST', email: 'selftest@service.local', role: 'manager', is_service: true };
  var cells = { mywork_hide_myasa: ' Yes ', mywork_hide_myasa_seen: ' u-ann , u-ann ' };
  var saved = 0;
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_CALLER = null;
    hubSysLog_ = function () { return true; };
    hiringAlertsSheet_ = function () { saved++; throw new Error('st: the tab is not opened here'); };

    hiringAlerts_ = function () { return cells; };
    var readOn = hubMyAsaHideOn_(), readSeen = hubMyAsaSeenRead_();
    hiringAlerts_ = function () { return { mywork_hide_myasa: 'maybe' }; };
    var maybe = hubMyAsaHideOn_();
    hiringAlerts_ = function () { return {}; };
    var blank = hubMyAsaHideOn_();
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    var unreadOn = hubMyAsaHideOn_(), unreadSeen = hubMyAsaSeenRead_(), unreadBob = hubMyAsaHiddenFor_(bob);
    stAssert_(out, 'my asa: the switch reads a plain yes as on and anything else — an unknown word, no cell, a tab ' +
                   'that cannot be read — as the shipped no; the seen list reads as its ids, once each, and an ' +
                   'unreadable cell lists none; an unreadable switch keeps My asa. from nobody (fail open)',
              readOn === true && JSON.stringify(readSeen) === '["u-ann"]' && maybe === false && blank === false &&
              unreadOn === false && unreadSeen.length === 0 && unreadBob === false,
              JSON.stringify([readOn, readSeen, maybe, blank, unreadOn, unreadSeen, unreadBob]));
    hiringAlerts_ = function () { return cells; };

    var hid = function (u) { return hubMyAsaHiddenFor_(u); };
    var verdicts = [hid(bob), hid(admin), hid(annVisit), hid(masterVisit), hid(ann), hid(master), hid(svc)];
    HUB_MEMBER_CTX = { memberId: 'mem_9', userId: 'u-bob', email: 'bob@example.org', scope: 'work_world' };
    HUB_CALLER = master;
    var bossInBob = hid(bobVisited);
    HUB_CALLER = ann;
    var annInBob = hid(bobVisited);
    HUB_MEMBER_CTX = null;
    HUB_CALLER = null;
    hiringAlerts_ = function () { return { mywork_hide_myasa: 'no', mywork_hide_myasa_seen: 'u-ann' }; };
    var off = [hid(bob), hid(admin), hid(annVisit)];
    hiringAlerts_ = function () { return cells; };
    stAssert_(out, 'my asa: kept from staff, another admin, a visit wearing a seen id and a visit to the master; ' +
                   'never from a seen account, the master\'s own session or the relay; inside a visit the account ' +
                   'at the keyboard decides; with the switch off nobody loses it',
              JSON.stringify(verdicts) === '[true,true,true,true,false,false,false]' && bossInBob === false &&
              annInBob === false && JSON.stringify(off) === '[false,false,false]',
              JSON.stringify([verdicts, bossInBob, annInBob, off]));

    var authSrc = stCode_(authRoute_);
    stAssert_(out, 'my asa: authLogin and authMe hand each session its own my_asa and nothing else of the switch; ' +
                   'the users directory and the config lane carry none of it',
              authSrc.indexOf('freshUser.my_asa = !hubMyAsaHiddenFor_(freshUser)') !== -1 &&
              authSrc.indexOf('me.my_asa = !hubMyAsaHiddenFor_(me)') !== -1 &&
              authSrc.indexOf('mywork_hide_myasa') === -1 && authSrc.indexOf('hubMyAsaSeenRead_') === -1 &&
              stCode_(userPublic_).indexOf('my_asa') === -1 &&
              stCode_(HUB_ACTIONS.configLane).indexOf('MyAsa') === -1, '');

    var tries = function (values, user) {
      try { return HUB_ACTIONS.hiringAlertsSet({ values: values }, user); }
      catch (e) { return { threw: String((e && e.message) || e) }; }
    };
    var before = saved;
    var byAdmin = tries({ mywork_hide_myasa: 'yes' }, admin);
    var byVisit = tries({ mywork_hide_myasa_seen: 'u-adm' }, masterVisit);
    var byAnn = tries({ mywork_hide_myasa: 'no' }, ann);
    var byBoss = tries({ mywork_hide_myasa: 'yes', mywork_hide_myasa_seen: 'u-ann' }, master);
    stAssert_(out, 'my asa: another admin, a visit to the master and staff are refused before a cell is touched; ' +
                   'the master\'s own session reaches the save',
              byAdmin.status === 403 && byVisit.status === 403 && !!byAnn.status && byAnn.status !== 200 &&
              saved === before + 1 && !(byBoss && byBoss.status === 403),
              JSON.stringify([byAdmin, byVisit, byAnn, byBoss]) + ' saved=' + (saved - before));

    var shipped = {};
    HIRING_ALERTS_CATALOG_SHIPPED.forEach(function (d) { shipped[d.key] = d; });
    var sw = shipped[MYWORK_MYASA_KEY], seen = shipped[MYWORK_MYASA_SEEN_KEY];
    stAssert_(out, 'my asa: both keys ship in the catalogue under mywork — the switch as no, the list empty — and ' +
                   'neither is a My Work display switch',
              MYWORK_MYASA_KEY === 'mywork_hide_myasa' && MYWORK_MYASA_SEEN_KEY === 'mywork_hide_myasa_seen' &&
              !!sw && sw.group === 'mywork' && sw.value === 'no' && !!seen && seen.group === 'mywork' &&
              seen.value === '' && Object.keys(MYWORK_HIDE_KEYS).every(function (p) {
                return MYWORK_HIDE_KEYS[p] !== MYWORK_MYASA_KEY && MYWORK_HIDE_KEYS[p] !== MYWORK_MYASA_SEEN_KEY;
              }), JSON.stringify([sw, seen]));
  } finally {
    hiringAlertsSheet_ = keep.sheet; hubSysLog_ = keep.log; hiringAlerts_ = keep.alerts;
    HUB_MEMBER_CTX = keep.member; HUB_CALLER = keep.caller; HUB_MASTER_EMAIL_CACHE = keep.masterCache;
  }
}

/** Settings > My Work's app list: every caller but the master's own session is handed App Control without it. */
function stMyWorkApps_(out) {
  var keep = { sheet: hiringAlertsSheet_, log: hubSysLog_, alerts: hiringAlerts_, member: HUB_MEMBER_CTX,
               masterCache: HUB_MASTER_EMAIL_CACHE, read: readTabNormalized_, ss: ssOpen_, id: hubId_,
               book: hubTabWorkbook_, badge: appBadgeSheet_, config: configBadgeSheet_, tenant: appTenantSheet_,
               shelf: appShelfSheet_, rules: hubProfileAppRules_, scopeFor: hubViewerScopeFor_,
               situation: appReleaseSituationNow_,
               props: (typeof hubPropsCheck_ === 'function') ? hubPropsCheck_ : null,
               actions: {} };
  var BOOT_PARTS = ['prefsGet', 'tenantsList', 'platformMembersList'];
  BOOT_PARTS.forEach(function (a) { keep.actions[a] = HUB_ACTIONS[a]; });
  var CUT = 'st-quiet', OPEN = 'st-open';
  var master = { email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var admin = { email: 'admin@example.org', role: 'admin' };
  var staff = { id: 'u-ann', email: 'ann@example.org', role: 'staff', types: ['STAFF'] };
  var visit = { email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' };
  var svc = { id: 'SVC_ST', email: 'selftest@service.local', role: 'manager', is_service: true };
  var tabs = {};
  tabs[APP_BADGE_TAB] = [{ appid: CUT, badges: 'STAFF' }, { appid: OPEN, badges: 'STAFF' }];
  tabs[APP_TENANT_TAB] = [{ appid: CUT, tenants: 'hq' }, { appid: OPEN, tenants: 'hq' }];
  tabs[CONFIG_BADGE_TAB] = [];
  tabs[APP_SECTIONS_TAB] = [{ sectionid: 'sec-a', label: 'A', position: 1 }];
  tabs[APP_PLACEMENT_TAB] = [{ appid: CUT, sectionid: 'sec-a', position: 1 },
                             { appid: OPEN, sectionid: 'sec-a', position: 2 }];
  var saved = 0;
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    hubSysLog_ = function () { return true; };
    hiringAlertsSheet_ = function () { saved++; throw new Error('st: the tab is not opened here'); };
    readTabNormalized_ = function (ss, tab) { return (tabs[tab] || []).slice(); };
    ssOpen_ = function () { return {}; };
    hubId_ = function () { return 'st-book'; };
    hubTabWorkbook_ = function () { return {}; };
    appBadgeSheet_ = function () { return {}; };
    configBadgeSheet_ = function () { return {}; };
    appTenantSheet_ = function () { return {}; };
    appShelfSheet_ = function () { return {}; };
    if (keep.props) hubPropsCheck_ = function () {};
    BOOT_PARTS.forEach(function (a) { HUB_ACTIONS[a] = function () { return { status: 403 }; }; });
    var cells = { mywork_hide_apps: ' ' + CUT + ', ' + CUT + ' ' };
    hiringAlerts_ = function () { return cells; };

    var read = hubMyWorkAppsRead_();
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    var unread = hubMyWorkAppsRead_();
    hiringAlerts_ = function () { return {}; };
    var blank = hubMyWorkAppsRead_();
    stAssert_(out, 'my work apps: the cell reads as its ids, once each; a tab that cannot be read and a missing cell ' +
                   'list none (fail open)',
              JSON.stringify(read) === JSON.stringify([CUT]) && unread.length === 0 && blank.length === 0,
              JSON.stringify([read, unread, blank]));
    hiringAlerts_ = function () { return cells; };

    var matrixOf = function (user) { var r = HUB_ACTIONS.appBadgeAccessGet({}, user); return (r && r.data) || {}; };
    var mStaff = matrixOf(staff), mAdmin = matrixOf(admin), mVisit = matrixOf(visit);
    var mMaster = matrixOf(master), mSvc = matrixOf(svc);
    var cutOut = function (d) {
      return !!d.rules && !!d.tenantRules && !(CUT in d.rules) && !(CUT in d.tenantRules) &&
             d.rules[OPEN].join(',') === 'STAFF' && d.tenantRules[OPEN].join(',') === 'hq' &&
             JSON.stringify(d).indexOf(CUT) === -1;
    };
    var whole = function (d) {
      return !!d.rules && d.rules[CUT].join(',') === 'STAFF' && d.tenantRules[CUT].join(',') === 'hq' &&
             d.rules[OPEN].join(',') === 'STAFF';
    };
    stAssert_(out, 'my work apps: the matrix staff, another admin and a visit to the master are handed has no badge ' +
                   'or tenant row for a listed app, and never its id; the master\'s own session and the relay read ' +
                   'it whole',
              cutOut(mStaff) && cutOut(mAdmin) && cutOut(mVisit) && whole(mMaster) && whole(mSvc),
              JSON.stringify([mStaff, mMaster]));

    var boot = HUB_ACTIONS.hubBoot({}, staff, 'tok-st');
    var bootMaster = HUB_ACTIONS.hubBoot({}, master, 'tok-boss');
    stAssert_(out, 'my work apps: the boot hands staff the cut matrix and the master the whole one',
              !!boot && boot.status === 200 && cutOut(boot.data.access || {}) &&
              JSON.stringify(boot.data).indexOf(CUT) === -1 && whole(bootMaster.data.access || {}),
              JSON.stringify(boot));

    var shelfOf = function (user) { var r = HUB_ACTIONS.appShelfGet({}, user); return (r && r.data) || {}; };
    var sStaff = shelfOf(staff), sMaster = shelfOf(master), sSvc = shelfOf(svc);
    stAssert_(out, 'my work apps: staff\'s shelf has no placement for a listed app; the master\'s and the relay\'s do',
              !!sStaff.placement && !(CUT in sStaff.placement) && sStaff.placement[OPEN] === 'sec-a' &&
              sStaff.order['sec-a'].join(',') === OPEN && JSON.stringify(sStaff).indexOf(CUT) === -1 &&
              sMaster.placement[CUT] === 'sec-a' && sMaster.order['sec-a'].join(',') === CUT + ',' + OPEN &&
              sSvc.placement[CUT] === 'sec-a', JSON.stringify([sStaff, sMaster]));

    hubProfileAppRules_ = function () {
      var rules = {}, tenants = {};
      rules[CUT] = ['STAFF']; rules[OPEN] = ['STAFF'];
      return { rules: rules, tenants: tenants };
    };
    hubViewerScopeFor_ = function () { return hubViewerScopeOf_('all'); };
    var gStaff = hubProfileAppGate_(CUT, staff), gOpen = hubProfileAppGate_(OPEN, staff);
    var gMaster = hubProfileAppGate_(CUT, master);
    stAssert_(out, 'my work apps: the profile gate shuts a listed app for staff with the sentence an unreleased app ' +
                   'gets, opens the others, and opens it for the master',
              gStaff.open === false &&
              gStaff.scope.why === 'No badge is written for this app in App Control, so it is the master\'s alone.' &&
              gOpen.open === true && gMaster.open === true && JSON.stringify(gStaff).indexOf(CUT) === -1,
              JSON.stringify([gStaff, gOpen, gMaster]));
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    var gUnread = hubProfileAppGate_(CUT, staff);
    var mUnread = matrixOf(staff);
    stAssert_(out, 'my work apps: a list that cannot be read cuts nothing — the gate and the matrix answer as App ' +
                   'Control has them (fail open)', gUnread.open === true && whole(mUnread),
              JSON.stringify([gUnread, mUnread]));
    hiringAlerts_ = function () { return cells; };

    var seenCells = { mywork_hide_apps: CUT, mywork_hide_apps_seen: ' u-ann , u-ann ' };
    hiringAlerts_ = function () { return seenCells; };
    var bob = { id: 'u-bob', email: 'bob@example.org', role: 'staff', types: ['STAFF'] };
    var annVisit = { id: 'u-ann', email: 'ann@example.org', role: 'staff', types: ['STAFF'], visiting_member: 'mem_1' };
    var mSeen = matrixOf(staff), mBob = matrixOf(bob), mAnnVisit = matrixOf(annVisit);
    var gSeen = hubProfileAppGate_(CUT, staff), gBob = hubProfileAppGate_(CUT, bob);
    var lSeenSvc = (HUB_ACTIONS.configLane({}, svc) || {}).data || {};
    var lSeenStaff = (HUB_ACTIONS.configLane({}, staff) || {}).data || {};
    stAssert_(out, 'my work apps: an account on the seen list is handed App Control whole and opens the listed app; ' +
                   'another account and a visit carrying the seen id stay cut; the lane carries the seen list to the ' +
                   'relay alone, never to the seen account',
              whole(mSeen) && gSeen.open === true && cutOut(mBob) && gBob.open === false && cutOut(mAnnVisit) &&
              JSON.stringify(lSeenSvc.my_work_apps_seen) === JSON.stringify(['u-ann']) &&
              !('my_work_apps_seen' in lSeenStaff) && !('my_work_apps' in lSeenStaff) &&
              JSON.stringify(lSeenStaff).indexOf('u-ann') === -1,
              JSON.stringify([mSeen, gSeen, mBob, lSeenSvc.my_work_apps_seen, lSeenStaff]));
    hiringAlerts_ = function () { return cells; };

    var tries = function (values, user) {
      try { return HUB_ACTIONS.hiringAlertsSet({ values: values }, user); }
      catch (e) { return { threw: String((e && e.message) || e) }; }
    };
    var before = saved;
    var refusedAdmin = tries({ mywork_hide_apps: CUT }, admin);
    var refusedVisit = tries({ mywork_hide_apps: CUT }, visit);
    var refusedStaff = tries({ mywork_hide_apps: CUT }, staff);
    var mine = tries({ mywork_hide_apps: CUT }, master);
    stAssert_(out, 'my work apps: another admin, a visit to the master and staff are refused before a cell is ' +
                   'touched, and the refusal never carries an app id; the master\'s own session reaches the save',
              refusedAdmin.status === 403 && refusedVisit.status === 403 && !!refusedStaff.status &&
              refusedStaff.status !== 200 && JSON.stringify([refusedAdmin, refusedVisit]).indexOf(CUT) === -1 &&
              saved === before + 1 && !(mine && mine.status === 403),
              JSON.stringify([refusedAdmin, refusedVisit, refusedStaff, mine]) + ' saved=' + (saved - before));

    var sitAsked = 0;
    appReleaseSituationNow_ = function () { sitAsked++; return { state: 'off', why: 'st: switched off here' }; };
    var quietRelease = appReleaseAutoAnnounce_({ 'st-quiet': ['STAFF'] }, {});
    var openRelease = appReleaseAutoAnnounce_({ 'st-open': ['STAFF'] }, {});
    stAssert_(out, 'my work apps: a badge granted on a listed app announces it to nobody; another app still asks',
              JSON.stringify(quietRelease) === '{}' && !!openRelease['st-open'] && sitAsked === 1,
              JSON.stringify([quietRelease, openRelease]) + ' asked=' + sitAsked);

    var laneOf = function (user) { var r = HUB_ACTIONS.configLane({}, user); return (r && r.data) || {}; };
    var lSvc = laneOf(svc), lMaster = laneOf(master), lAdmin = laneOf(admin), lStaff = laneOf(staff);
    stAssert_(out, 'my work apps: the config lane carries the list to the relay and the master\'s own session ' +
                   'alone; anybody else\'s lane carries neither the key nor an id',
              JSON.stringify(lSvc.my_work_apps) === JSON.stringify([CUT]) &&
              JSON.stringify(lMaster.my_work_apps) === JSON.stringify([CUT]) &&
              !('my_work_apps' in lAdmin) && !('my_work_apps' in lStaff) &&
              JSON.stringify(lAdmin).indexOf(CUT) === -1 && JSON.stringify(lStaff).indexOf(CUT) === -1,
              JSON.stringify([lSvc.my_work_apps, lAdmin, lStaff]));
  } finally {
    hiringAlertsSheet_ = keep.sheet; hubSysLog_ = keep.log; hiringAlerts_ = keep.alerts;
    HUB_MEMBER_CTX = keep.member; HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    readTabNormalized_ = keep.read; ssOpen_ = keep.ss; hubId_ = keep.id; hubTabWorkbook_ = keep.book;
    appBadgeSheet_ = keep.badge; configBadgeSheet_ = keep.config; appTenantSheet_ = keep.tenant;
    appShelfSheet_ = keep.shelf; hubProfileAppRules_ = keep.rules; hubViewerScopeFor_ = keep.scopeFor;
    appReleaseSituationNow_ = keep.situation;
    if (keep.props) hubPropsCheck_ = keep.props;
    BOOT_PARTS.forEach(function (a) { HUB_ACTIONS[a] = keep.actions[a]; });
  }
}

// Settings > My Work's world switch: every account but the master's own session and the seen list is answered as…
function stMyWorld_(out) {
  var keep = { sheet: hiringAlertsSheet_, log: hubSysLog_, alerts: hiringAlerts_, member: HUB_MEMBER_CTX,
               caller: HUB_CALLER, masterCache: HUB_MASTER_EMAIL_CACHE, rowFor: worldRowFor_, rows: worldRows_,
               users: usersAll_, memberRows: HUB_MEMBERS_ROWS, membersSheet: membersSheet_,
               testState: hubTestModeState_, gates: hubGatesArmedRead_, notices: hubNoticeSituationsRead_,
               actions: {} };
  var LANE_PARTS = ['hiringViewsPolicy', 'clientViewsPolicy', 'potClientsViewsPolicy', 'appShelfGet',
                    'userMenuLinksList', 'appsBuilt'];
  LANE_PARTS.forEach(function (a) { keep.actions[a] = HUB_ACTIONS[a]; });
  var master = { id: 'u-boss', email: HUB_MASTER_ACCOUNT, role: 'admin' };
  var admin = { id: 'u-adm', email: 'admin@example.org', role: 'admin' };
  var bob = { id: 'u-bob', email: 'bob@example.org', role: 'staff' };
  var ann = { id: 'u-ann', email: 'ann@example.org', role: 'staff' };
  var annVisit = { id: 'u-ann', email: 'ann@example.org', role: 'staff', visiting_member: 'mem_1' };
  var bobVisited = { id: 'u-bob', email: 'bob@example.org', role: 'staff', visiting_member: 'mem_9', acting_for: 'u-bob' };
  var masterVisit = { id: 'u-boss', email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'mem_1' };
  var svc = { id: 'SVC_ST', email: 'selftest@service.local', role: 'manager', is_service: true };
  var interviewer = { id: 'u-int', email: 'int@example.org', role: 'interviewer' };
  var worldOf = function (uid, wid, sid) {
    return { world_id: wid, owner_user_id: uid, owner_email: '', name: wid, spreadsheet_id: sid, created_at: '',
             defaults_version: WORLD_DEFAULTS_VERSION };
  };
  var worlds = { 'u-boss': worldOf('u-boss', 'wld_boss', 'SS_BOSS'), 'u-ann': worldOf('u-ann', 'wld_ann', 'SS_ANN'),
                 'u-bob': worldOf('u-bob', 'wld_bob', 'SS_BOB') };
  var cells = { mywork_hide_world: ' Yes ', mywork_hide_world_seen: ' u-ann , u-ann ' };
  var registryAsked = 0, saved = 0, sheetOpened = 0;
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_CALLER = null;
    hubSysLog_ = function () { return true; };
    hiringAlertsSheet_ = function () { saved++; throw new Error('st: the tab is not opened here'); };
    worldRowFor_ = function (u) { registryAsked++; return worlds[String(u && u.id)] || null; };
    worldRows_ = function () {
      registryAsked++;
      return Object.keys(worlds).map(function (k) { return worlds[k]; });
    };

    hiringAlerts_ = function () { return cells; };
    var readOn = hubMyWorldHideOn_(), readSeen = hubMyWorldSeenRead_();
    hiringAlerts_ = function () { return { mywork_hide_world: 'maybe' }; };
    var maybe = hubMyWorldHideOn_();
    hiringAlerts_ = function () { return {}; };
    var blank = hubMyWorldHideOn_();
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    var unreadOn = hubMyWorldHideOn_(), unreadSeen = hubMyWorldSeenRead_(), unreadBob = hubMyWorldHiddenFor_(bob);
    stAssert_(out, 'my world: the switch reads a plain yes as on and anything else — an unknown word, no cell, a tab ' +
                   'that cannot be read — as the shipped no; the seen list reads as its ids, once each, and an ' +
                   'unreadable cell lists none; an unreadable switch keeps nobody\'s world (fail open)',
              readOn === true && JSON.stringify(readSeen) === '["u-ann"]' && maybe === false && blank === false &&
              unreadOn === false && unreadSeen.length === 0 && unreadBob === false,
              JSON.stringify([readOn, readSeen, maybe, blank, unreadOn, unreadSeen, unreadBob]));
    hiringAlerts_ = function () { return cells; };

    var hid = function (u) { return hubMyWorldHiddenFor_(u); };
    var verdicts = [hid(bob), hid(admin), hid(annVisit), hid(masterVisit), hid(ann), hid(master), hid(svc)];
    HUB_MEMBER_CTX = { memberId: 'mem_9', userId: 'u-bob', email: 'bob@example.org', scope: 'work_world' };
    HUB_CALLER = master;
    var bossInBob = hid(bobVisited);
    var bossInBobCtx = worldContext_('wld_bob', bobVisited);
    HUB_CALLER = bob;
    var bobWearingAnn = hid(annVisit);
    HUB_CALLER = ann;
    var annInBob = hid(bobVisited);
    HUB_MEMBER_CTX = null;
    HUB_CALLER = null;
    stAssert_(out, 'my world: kept from staff, another admin, a visit wearing a seen id and a visit to the master; ' +
                   'never from a seen account, the master\'s own session or the relay; inside a visit the account ' +
                   'at the keyboard decides — the master\'s visit opens the world it visits, so does a seen ' +
                   'account\'s, anybody else\'s does not',
              JSON.stringify(verdicts) === '[true,true,true,true,false,false,false]' && bossInBob === false &&
              !!bossInBobCtx && bossInBobCtx.worldId === 'wld_bob' && bobWearingAnn === true && annInBob === false,
              JSON.stringify([verdicts, bossInBob, bossInBobCtx, bobWearingAnn, annInBob]));

    var asked = registryAsked;
    var bobGet = HUB_ACTIONS.worldGet({}, bob);
    var bobEnsure = HUB_ACTIONS.worldEnsure({}, bob);
    var payloads = { worldAppUpsert: { app: { id: 'Bad Id!', name: 'X', pages: [] } },
                     worldAppInstallDefault: { app_id: 'st-none' } };
    var differs = ['worldEnsure', 'worldAppsList', 'worldAppUpsert', 'worldAppDelete', 'worldAppsSeedDefaults',
                   'worldAppInstallDefault'].filter(function (a) {
      var p = payloads[a] || {};
      return JSON.stringify(HUB_ACTIONS[a](p, bob)) !== JSON.stringify(HUB_ACTIONS[a](p, interviewer));
    });
    var bobCtx = worldContext_('wld_bob', bob);
    var bobAsked = registryAsked - asked;
    var unknown = worldResolve_([], 'wld_bob', { id: 'u-nobody' });
    stAssert_(out, 'my world: staff it is kept from has no world — worldGet answers none — and every world door ' +
                   'answers exactly what an interviewer is answered, before the payload is read; their world id ' +
                   'answers as an unknown world; the registry is never read for them and no answer names a switch ' +
                   'or a list',
              bobGet.status === 200 && !!bobGet.data && bobGet.data.world === null &&
              bobEnsure.status === 403 && bobEnsure.message === worldDenied_().message && differs.length === 0 &&
              JSON.stringify(bobCtx) === JSON.stringify(unknown) && bobAsked === 0 &&
              !/mywork|hidden|seen|switch|master|list/i.test(JSON.stringify([bobGet, bobEnsure, bobCtx])),
              JSON.stringify([bobGet, bobEnsure, differs, bobCtx, bobAsked]));

    var bossGet = HUB_ACTIONS.worldGet({}, master);
    var bossEnsure = HUB_ACTIONS.worldEnsure({}, master);
    var annGet = HUB_ACTIONS.worldGet({}, ann);
    var annEnsure = HUB_ACTIONS.worldEnsure({}, ann);
    var annCtx = worldContext_('wld_ann', ann);
    stAssert_(out, 'my world: the master\'s own session and a seen account keep their worlds — worldGet, worldEnsure ' +
                   'and the world envelope answer as they always did',
              bossGet.status === 200 && bossGet.data.world.world_id === 'wld_boss' &&
              bossEnsure.status === 200 && bossEnsure.data.created === false &&
              annGet.status === 200 && annGet.data.world.world_id === 'wld_ann' && annEnsure.status === 200 &&
              !!annCtx && annCtx.worldId === 'wld_ann' && annCtx.ssId === 'SS_ANN',
              JSON.stringify([bossGet, bossEnsure, annGet, annEnsure, annCtx]));

    hiringAlerts_ = function () { return { mywork_hide_world: 'no', mywork_hide_world_seen: 'u-ann' }; };
    var offGet = HUB_ACTIONS.worldGet({}, bob);
    var offEnsure = HUB_ACTIONS.worldEnsure({}, bob);
    var offCtx = worldContext_('wld_bob', bob);
    stAssert_(out, 'my world: with the switch off every account keeps its world, as it shipped',
              offGet.status === 200 && offGet.data.world.world_id === 'wld_bob' && offEnsure.status === 200 &&
              !!offCtx && offCtx.worldId === 'wld_bob' && hid(admin) === false,
              JSON.stringify([offGet, offEnsure, offCtx]));
    hiringAlerts_ = function () { return cells; };

    HUB_MEMBERS_ROWS = [
      { memberid: 'mem_1', owneruserid: 'u-adm', memberuserid: 'u-ann', status: 'active', scope: 'work_world' },
      { memberid: 'mem_2', owneruserid: 'u-boss', memberuserid: 'u-ann', status: 'active', scope: 'work_world' },
      { memberid: 'mem_3', owneruserid: 'u-boss', memberuserid: 'u-bob', status: 'active', scope: 'work_world' }];
    usersAll_ = function () { return []; };
    membersSheet_ = function () { sheetOpened++; throw new Error('st: the tab is not opened here'); };
    var rosterOf = function (u) {
      var r = HUB_ACTIONS.platformMembersList({}, u);
      return (r && r.data && r.data.members) || [];
    };
    var mineOf = function (u) {
      var r = HUB_ACTIONS.platformMemberMine({}, u);
      return (r && r.data && r.data.platforms) || [];
    };
    var rAdmin = rosterOf(admin), rBoss = rosterOf(master), mBob = mineOf(bob), mAnn = mineOf(ann);
    var doorBob = HUB_ACTIONS.myWorldAccessList({}, bob), doorAnn = HUB_ACTIONS.myWorldAccessList({}, ann);
    var closeBob = HUB_ACTIONS.myWorldAccessSet({ member_id: 'mem_3', open: false }, bob);
    stAssert_(out, 'my world: an admin it is kept from is handed no member\'s world id while the master is; staff it ' +
                   'is kept from read their link as work alone, list no world door and close none, before the tab ' +
                   'is opened; a seen account reads its links as they are',
              rAdmin.length === 1 && rAdmin[0].world_id === '' && rBoss.length === 2 &&
              rBoss.every(function (m) { return !!m.world_id; }) &&
              mBob.length === 1 && mBob[0].scope === 'work' && mAnn.length === 2 &&
              mAnn.every(function (p) { return p.scope === 'work_world'; }) &&
              doorBob.status === 200 && doorBob.data.rows.length === 0 &&
              doorAnn.status === 200 && doorAnn.data.rows.length === 2 &&
              closeBob.status === 404 && closeBob.message === 'Not found.' && sheetOpened === 0,
              JSON.stringify([rAdmin, rBoss, mBob, mAnn, doorBob, closeBob]) + ' sheet=' + sheetOpened);

    var authSrc = stCode_(authRoute_);
    stAssert_(out, 'my world: authLogin and authMe hand each session its own my_world beside the stamps; the users ' +
                   'directory carries none, so no row can be set against it; userPublic_ keeps its literal',
              authSrc.indexOf('freshUser.my_world = !hubMyWorldHiddenFor_(freshUser)') !== -1 &&
              authSrc.indexOf('me.my_world = !hubMyWorldHiddenFor_(me)') !== -1 &&
              stCode_(HUB_ACTIONS.usersList).indexOf('delete pub.my_world') !== -1 &&
              stCode_(userPublic_).indexOf('my_world: true') !== -1, '');

    LANE_PARTS.forEach(function (a) { HUB_ACTIONS[a] = function () { return { status: 403 }; }; });
    hubTestModeState_ = function () { return { on: false, explicit: false, unrecognized: '' }; };
    hubGatesArmedRead_ = function () { return { map: {} }; };
    hubNoticeSituationsRead_ = function () { return { map: {} }; };
    var laneOf = function (u) { var r = HUB_ACTIONS.configLane({}, u); return (r && r.data) || {}; };
    var lSvc = laneOf(svc), lBoss = laneOf(master), lAdmin = laneOf(admin), lAnn = laneOf(ann), lBob = laneOf(bob);
    var lVisit = laneOf(masterVisit);
    var bare = function (d) {
      return !('my_world_hide' in d) && !('my_world_seen' in d) && JSON.stringify(d).indexOf('u-ann') === -1;
    };
    hiringAlerts_ = function () { throw new Error('the config tab could not be opened'); };
    var lBroken = laneOf(svc);
    hiringAlerts_ = function () { return cells; };
    stAssert_(out, 'my world: the config lane carries the switch and the seen list to the relay and the master\'s own ' +
                   'session alone — never to another admin, staff, a seen account or a visit to the master; an ' +
                   'unreadable cell travels as off and an empty list',
              lSvc.my_world_hide === true && JSON.stringify(lSvc.my_world_seen) === '["u-ann"]' &&
              lBoss.my_world_hide === true && JSON.stringify(lBoss.my_world_seen) === '["u-ann"]' &&
              bare(lAdmin) && bare(lAnn) && bare(lBob) && bare(lVisit) &&
              lBroken.my_world_hide === false && JSON.stringify(lBroken.my_world_seen) === '[]',
              JSON.stringify([lSvc.my_world_hide, lSvc.my_world_seen, lAdmin.my_world_hide, lAnn.my_world_seen,
                              lBroken.my_world_hide]));

    var tries = function (values, user) {
      try { return HUB_ACTIONS.hiringAlertsSet({ values: values }, user); }
      catch (e) { return { threw: String((e && e.message) || e) }; }
    };
    var before = saved;
    var byAdmin = tries({ mywork_hide_world: 'yes' }, admin);
    var byVisit = tries({ mywork_hide_world_seen: 'u-adm' }, masterVisit);
    var byAnn = tries({ mywork_hide_world: 'no' }, ann);
    var byBoss = tries({ mywork_hide_world: 'yes', mywork_hide_world_seen: 'u-ann' }, master);
    stAssert_(out, 'my world: another admin, a visit to the master and staff are refused before a cell is touched; ' +
                   'the master\'s own session reaches the save',
              byAdmin.status === 403 && byVisit.status === 403 && !!byAnn.status && byAnn.status !== 200 &&
              saved === before + 1 && !(byBoss && byBoss.status === 403),
              JSON.stringify([byAdmin, byVisit, byAnn, byBoss]) + ' saved=' + (saved - before));

    var shipped = {};
    HIRING_ALERTS_CATALOG_SHIPPED.forEach(function (d) { shipped[d.key] = d; });
    var sw = shipped[MYWORK_WORLD_KEY], seen = shipped[MYWORK_WORLD_SEEN_KEY];
    stAssert_(out, 'my world: both keys ship in the catalogue under mywork — the switch as no, the list empty — and ' +
                   'neither is a My Work display switch',
              MYWORK_WORLD_KEY === 'mywork_hide_world' && MYWORK_WORLD_SEEN_KEY === 'mywork_hide_world_seen' &&
              !!sw && sw.group === 'mywork' && sw.value === 'no' && !!seen && seen.group === 'mywork' &&
              seen.value === '' && Object.keys(MYWORK_HIDE_KEYS).every(function (p) {
                return MYWORK_HIDE_KEYS[p] !== MYWORK_WORLD_KEY && MYWORK_HIDE_KEYS[p] !== MYWORK_WORLD_SEEN_KEY;
              }), JSON.stringify([sw, seen]));
  } finally {
    hiringAlertsSheet_ = keep.sheet; hubSysLog_ = keep.log; hiringAlerts_ = keep.alerts;
    HUB_MEMBER_CTX = keep.member; HUB_CALLER = keep.caller; HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    worldRowFor_ = keep.rowFor; worldRows_ = keep.rows; usersAll_ = keep.users; HUB_MEMBERS_ROWS = keep.memberRows;
    membersSheet_ = keep.membersSheet; hubTestModeState_ = keep.testState; hubGatesArmedRead_ = keep.gates;
    hubNoticeSituationsRead_ = keep.notices;
    LANE_PARTS.forEach(function (a) { HUB_ACTIONS[a] = keep.actions[a]; });
  }
}
