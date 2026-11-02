// Settings > Editions and the Locations doors that ask them: the master makes every edition, always; anybody else…
// The config tab, App Control's row, the house, the stores and the log are stood in for; the doors are the real…
function stEditions_(out) {
  var P = 'editions: ';
  var j = function (v) { return JSON.stringify(v); };
  var keep = {
    alerts: hiringAlerts_, gate: hubProfileAppGate_, house: locationsHouse_, masterCache: HUB_MASTER_EMAIL_CACHE,
    member: HUB_MEMBER_CTX, world: HUB_WORLD_CTX, users: usersAll_, set: HUB_ACTIONS.hiringAlertsSet, log: hubSysLog_,
    ensure: hubTabEnsure_, sheet: hubTabSheet_, holds: sheetDbGateHolds_, staffPart: locationsStaffPart_,
    client: clientProfilesClient_, live: cpEditLive_, edit: cpProfileEdit_, notes: locationsNotesSheet_,
    viewerMemo: HUB_VIEWER_MEMO, update: updateRowById_, create: createRow_, ovLive: cpOverrideLive_,
    ovWrite: cpOverrideWrite_
  };
  var master = { id: 'u-boss', email: HUB_MASTER_ACCOUNT, role: 'admin', display_name: 'Boss' };
  var ann = { id: 'u-ann', email: 'ann@example.org', role: 'staff', display_name: 'Ann Lee' };
  var bo = { id: 'u-bo', email: 'bo@example.org', role: 'manager', display_name: 'Bo Mgr' };
  var cli = { id: 'u-cli', email: 'cli@example.org', role: 'client', display_name: 'Cli Ent' };
  var stored = [];
  var cells = function () { var c = {}; c[EDITIONS_KEY] = j(stored); return c; };
  var shape = function (r) { return !!r && r.status === 404 && r.message === 'Unknown action.' && Object.keys(r).length === 2; };
  var reached = function (r) { return !!r && r.status === 418; };
  var houseAsked = 0;
  var call = function (a, payload, u) {
    try { return HUB_ACTIONS[a](payload, u) || {}; } catch (e) { return { threw: String((e && e.message) || e) }; }
  };
  try {
    HUB_MASTER_EMAIL_CACHE = null;
    HUB_MEMBER_CTX = null;
    HUB_WORLD_CTX = null;
    HUB_VIEWER_MEMO = null;
    hiringAlerts_ = function () { return cells(); };
    hubSysLog_ = function () { return true; };
    // Clients reads as 'all' unless a test narrows it to an SSA's own clients
    var cpScope = { kind: 'all', client_keys: [] };
    hubProfileAppGate_ = function (appId, u) {
      var open = (appId === LOCATION_APP_ID || appId === CP_APP_ID) && !!u && !u.is_service && u.role !== 'client';
      var kind = open ? (appId === CP_APP_ID ? cpScope.kind : 'all') : 'none';
      return { open: open, scope: { kind: kind, client_keys: appId === CP_APP_ID ? cpScope.client_keys : [],
                                     house_codes: [], ssa_keys: [], family_keys: [], why: '' } };
    };
    locationsHouse_ = function () { houseAsked++; return { refused: { status: 418, message: 'st: the house was asked' } }; };

    // ---- the catalogue and the stored list ----
    var ids = EDITIONS.map(function (e) { return e.id; });
    var locIds = EDITIONS.filter(function (e) { return e.app === 'locations'; }).map(function (e) { return e.id; });
    stAssert_(out, P + 'the seven Locations editions, the five of Clients, the nine of Staff, the two of SSA, the four of ' +
                   'Families, the three of Scheduling and the three of Transportation ship in the catalogue, each with a ' +
                   'plain description, grouped by app',
              ids.join() === 'locations.house,locations.staffRemove,locations.incidents,locations.documents,' +
                             'locations.notesAny,locations.clientsAdd,locations.assets,clients.profile,clients.care,' +
                             'clients.family,clients.medication,clients.transportation,staff.profile,staff.employment,' +
                             'staff.hr,staff.driving,staff.mais,staff.ist,staff.preferences,staff.notes,staff.notesEdit,' +
                             'ssa.profile,ssa.notes,family.profile,family.notes,family.calls,family.incidents,' +
                             'scheduling.calendar,scheduling.builder,scheduling.settings,transportation.trips,' +
                             'transportation.vehicles,transportation.settings' &&
              EDITIONS.every(function (e) { return e.description.length > 30; }) &&
              locIds.every(function (id) { return Object.keys(LOCATION_EDITION).some(function (k) { return LOCATION_EDITION[k] === id; }); }) &&
              hubEditionOf_('clients.profile').app === CP_APP_ID && hubEditionOf_('clients.profile').app_name === 'Clients' &&
              CP_EDITION_PROFILE === 'clients.profile' && CP_EDITION_CARE === 'clients.care' &&
              CP_EDITION_MEDS === 'clients.medication' && CP_EDITION_TRANSPORT === 'clients.transportation' &&
              ['clients.care', 'clients.medication', 'clients.transportation'].every(function (id) {
                return hubEditionOf_(id).app === CP_APP_ID && hubEditionOf_(id).app_name === 'Clients';
              }),
              j(ids));
    var parsed = hubEditionsParse_(j([{ id: 'locations.house', on: 'yes', people: [' u-a ', 'u-a', ''] },
                                      { id: 'locations.house', on: true, people: ['u-b'] },
                                      { id: 'nope.edition', on: true, people: ['u-c'] }, 'x', null]));
    stAssert_(out, P + 'the stored list keeps each known edition once, each person once, and a key is on only for a ' +
                   'plain true; an unknown edition is dropped',
              j(parsed) === j({ 'k:locations.house': { on: false, people: ['u-a'] } }), j(parsed));
    stAssert_(out, P + 'a blank, malformed or non-list cell opens nothing',
              j(hubEditionsParse_('')) === '{}' && j(hubEditionsParse_('{x')) === '{}' &&
              j(hubEditionsParse_('{"id":"locations.house"}')) === '{}' && j(hubEditionsParse_(null)) === '{}', '');

    // ---- who makes an edition ----
    stored = [];
    var masterAlways = ids.every(function (id) { return hubEditionAllows_(id, master); });
    hiringAlerts_ = function () { throw new Error('st: the config tab could not be opened'); };
    var masterUnreadable = ids.every(function (id) { return hubEditionAllows_(id, master); });
    var annUnreadable = hubEditionAllows_('locations.house', ann);
    hiringAlerts_ = function () { return cells(); };
    stAssert_(out, P + 'the master makes every edition with every key off, and while the config cannot be read; anybody ' +
                   'else then makes none (fail closed)',
              masterAlways && masterUnreadable && annUnreadable === false &&
              j(hubEditionsFor_(master, 'locations')) === j(locIds) &&
              j(hubEditionsFor_(master, CP_APP_ID)) ===
                '["clients.profile","clients.care","clients.family","clients.medication","clients.transportation"]', '');
    stored = [{ id: 'locations.incidents', on: false, people: ['u-ann'] }];
    var keyOff = hubEditionAllows_('locations.incidents', ann);
    stored = [{ id: 'locations.incidents', on: true, people: ['u-ann'] }, { id: 'locations.house', on: true, people: [] }];
    var keyOn = hubEditionAllows_('locations.incidents', ann);
    var others = [hubEditionAllows_('locations.house', ann), hubEditionAllows_('locations.incidents', bo),
                  hubEditionAllows_('locations.incidents', { id: 'u-ann', email: 'ann@example.org', role: 'client' }),
                  hubEditionAllows_('locations.incidents', { id: 'u-ann', email: 'ann@example.org', role: 'staff', visiting_member: 'm1' }),
                  hubEditionAllows_('locations.incidents', { id: 'u-ann', email: 'ann@example.org', role: 'staff', is_service: true }),
                  hubEditionAllows_('locations.incidents', null), hubEditionAllows_('nope.edition', ann),
                  hubEditionAllows_('nope.edition', master)];
    HUB_MEMBER_CTX = { memberId: 'm1', userId: 'u-ann', email: 'ann@example.org' };
    others.push(hubEditionAllows_('locations.incidents', ann));
    HUB_MEMBER_CTX = null;
    HUB_WORLD_CTX = { worldId: 'w1', ssId: 'x' };
    others.push(hubEditionAllows_('locations.incidents', ann));
    HUB_WORLD_CTX = null;
    stAssert_(out, P + 'the key off refuses even a listed person; on, the listed person makes that edition alone — never ' +
                   'another edition, an unlisted account, a client role, a visit, the service identity, an unknown ' +
                   'edition, or anybody inside a world',
              keyOff === false && keyOn === true && others.every(function (x) { return x === false; }) &&
              j(hubEditionsFor_(ann, 'locations')) === '["locations.incidents"]', j([keyOff, keyOn, others]));

    // ---- Settings > Editions: the master's alone ----
    usersAll_ = function () {
      return [{ userid: 'u-ann', email: 'ann@example.org', role: 'staff', displayname: 'Ann Lee' },
              { userid: 'u-bo', email: 'bo@example.org', role: 'manager', displayname: 'Bo Mgr' },
              { userid: 'u-cli', email: 'cli@example.org', role: 'client', displayname: 'Cli Ent' },
              { userid: 'u-boss', email: HUB_MASTER_ACCOUNT, role: 'admin', displayname: 'Boss' }];
    };
    var saves = [];
    HUB_ACTIONS.hiringAlertsSet = function (payload, u) { saves.push([payload.values, u && u.id]); return { status: 200, data: {} }; };
    var shut = [call('editionsGet', {}, ann), call('editionsGet', {}, bo), call('editionsGet', {}, cli),
                call('editionsGet', {}, { id: 'u-boss', email: HUB_MASTER_ACCOUNT, role: 'admin', visiting_member: 'm1' }),
                call('editionsGet', {}, { id: 'svc', email: HUB_MASTER_ACCOUNT, role: 'admin', is_service: true }),
                call('editionsSet', { editions: [] }, bo), call('editionsSet', { editions: [] }, ann)];
    stAssert_(out, P + 'anybody but the master — a listed person, an admin or manager, a client, a visit, the service ' +
                   'identity — gets the unadvertised 404 from both Settings doors, and nothing is saved',
              shut.every(shape) && saves.length === 0, j(shut));
    stored = [];
    var fresh = call('editionsGet', {}, master);
    stAssert_(out, P + 'the master reads every edition with its key off and nobody listed, as they ship',
              fresh.status === 200 && fresh.data.editions.length === EDITIONS.length && EDITIONS.length === 33 &&
              fresh.data.editions.every(function (e) { return e.on === false && e.people.length === 0 && !!e.description; }) &&
              fresh.data.malformed === false, j(fresh));
    var refusals = [
      call('editionsSet', { editions: [{ id: 'nope.edition', on: true, people: [] }] }, master),
      call('editionsSet', { editions: [{ id: 'locations.house', on: true, people: ['u-boss'] }] }, master),
      call('editionsSet', { editions: [{ id: 'locations.house', on: true, people: ['u-cli'] }] }, master),
      call('editionsSet', { editions: [{ id: 'locations.house', on: true, people: ['u-nobody'] }] }, master),
      call('editionsSet', { editions: [{ id: 'locations.house', on: true }, { id: 'locations.house', on: false }] }, master),
      call('editionsSet', { editions: 'all' }, master)
    ];
    stAssert_(out, P + 'a save naming an unknown edition, the master account, a client, an account that does not exist, ' +
                   'an edition twice, or no list is refused whole, before the config is written',
              refusals.every(function (r) { return r.status === 400; }) && saves.length === 0, j(refusals));
    var saved = call('editionsSet', { editions: [
      { id: 'locations.house', on: true, people: ['u-ann', 'u-ann', 'u-bo'] },
      { id: 'locations.documents', on: false, people: ['u-bo'] },
      { id: 'locations.incidents', on: false, people: [] }] }, master);
    var wrote = saves.length === 1 ? JSON.parse(saves[0][0][EDITIONS_KEY]) : null;
    stAssert_(out, P + 'the master\'s save goes through the config tab\'s own door as one cell: each edition with its key ' +
                   'and people once, an edition off with nobody left out, and the answer is what was stored',
              saved.status === 200 && saves.length === 1 && saves[0][1] === 'u-boss' &&
              j(wrote) === j([{ id: 'locations.house', on: true, people: ['u-ann', 'u-bo'] },
                              { id: 'locations.documents', on: false, people: ['u-bo'] }]) &&
              saved.data.editions[0].on === true && j(saved.data.editions[0].people) === '["u-ann","u-bo"]' &&
              saved.data.editions[3].on === false, j([saved, wrote]));

    // ---- every Locations door answers its own edition ----
    var DOORS = {
      locationHouseSave: 'locations.house', locationNoteAdd: 'locations.house', locationNoteState: 'locations.house',
      locationSupplyEntry: 'locations.house', locationSupplyEdit: 'locations.house', locationIstFile: 'locations.house',
      locationRepairFile: 'locations.house', locationRepairEdit: 'locations.house',
      locationStaffRemove: 'locations.staffRemove', locationIncidentFile: 'locations.incidents',
      locationIncidentEdit: 'locations.incidents', locationDocRemove: 'locations.documents',
      locationDocLink: 'locations.documents', locationDocUpload: 'locations.documents',
      locationNoteEdit: 'locations.notesAny', locationClientsAdd: 'locations.clientsAdd',
      locationAssetEdit: 'locations.assets', locationAssetAdd: 'locations.assets'
    };
    var ask = { house: 'ZZ9999', id: 'HN_1234567890', state: 'open' };
    var missing = LOCATION_ACTIONS.filter(function (a) { return HUB_POLICY[a].lane !== 'read' && a !== 'locationDocFile' && !DOORS[a]; });
    stored = [];
    houseAsked = 0;
    var unlisted = Object.keys(DOORS).filter(function (a) { return !shape(call(a, ask, ann)); });
    stAssert_(out, P + 'with no edition, a person App Control lets read Locations gets the 404 shape from every write ' +
                   'door, before the house is looked up',
              missing.length === 0 && unlisted.length === 0 && houseAsked === 0, j([missing, unlisted, houseAsked]));
    stored = ids.map(function (id) { return { id: id, on: false, people: ['u-ann'] }; });
    var offButListed = Object.keys(DOORS).filter(function (a) { return !shape(call(a, ask, ann)); });
    stAssert_(out, P + 'every key off refuses a person on every list, at every door, before the house is looked up',
              offButListed.length === 0 && houseAsked === 0, j(offButListed));
    var leaks = [];
    ids.forEach(function (id) {
      stored = [{ id: id, on: true, people: ['u-ann'] }];
      Object.keys(DOORS).forEach(function (a) {
        var r = call(a, ask, ann);
        var own = DOORS[a] === id || (a === 'locationNoteEdit' && id === 'locations.house');
        if (own ? !reached(r) : !shape(r)) leaks.push(id + ' ' + a + ' → ' + j(r));
      });
    });
    stAssert_(out, P + 'with one edition on and the person listed, exactly that edition\'s doors reach the house (a ' +
                   'note edit through the house edition too, for the writer\'s own note) and every other door is the 404',
              leaks.length === 0, leaks.slice(0, 4).join(' | '));
    stored = ids.map(function (id) { return { id: id, on: true, people: ['u-ann'] }; });
    var clientListed = Object.keys(DOORS).filter(function (a) { return !shape(call(a, ask, { id: 'u-ann', email: 'x', role: 'client' })); });
    stored = [];
    var masterReached = Object.keys(DOORS).filter(function (a) { return a !== 'locationNoteState'; })
      .filter(function (a) { return !reached(call(a, ask, master)); });
    stAssert_(out, P + 'the master reaches every door with every key off; a client role is refused even on every list',
              masterReached.length === 0 && clientListed.length === 0, j([masterReached, clientListed]));
    var scopeAnn = (function () { stored = [{ id: 'locations.documents', on: true, people: ['u-ann'] }];
                                  return call('locationScope', {}, ann); })();
    stAssert_(out, P + 'locationScope tells a listed person the editions they make, and no write of the master\'s',
              scopeAnn.status === 200 && j(scopeAnn.data.editions) === '["locations.documents"]' &&
              scopeAnn.data.writes === false, j(scopeAnn));

    // ---- a house to edit ----
    var ZZ = { code: 'ZZ9999', home: { code: 'ZZ9999', address: '9999 Test Ave NW', home_name: 'ZZ - ZZ9999' },
               homes: [{ code: 'ZZ9999', address: '9999 Test Ave NW' }, { code: 'QQ1000', address: '1000 Quiet Rd' }],
               all_clients: [
                 { client_key: 'kmarsh', name: 'Kenny Marsh', house: 'ZZ9999', home_address: '', status: 'active' },
                 { client_key: 'newbie', name: 'New Bie', house: '', home_address: '5 Elsewhere St', status: 'active' },
                 { client_key: 'far', name: 'Far Away', house: 'QQ1000', home_address: '', status: 'active' },
                 { client_key: 'byaddr', name: 'By Address', house: '', home_address: '1000 Quiet Rd', status: 'active' },
                 { client_key: 'gone', name: 'Gone Client', house: '', home_address: '', status: 'inactive' }],
               clients: [{ client_key: 'kmarsh', name: 'Kenny Marsh' }], homes_why: '', clients_why: '' };
    locationsHouse_ = function (raw) {
      houseAsked++;
      return String(raw || '').toUpperCase() === 'ZZ9999' ? ZZ : { refused: { status: 404, message: 'st: no house' } };
    };
    var touched = [];
    updateRowById_ = function (res) { touched.push('update ' + res); return {}; };
    createRow_ = function (res) { touched.push('create ' + res); return {}; };
    sheetDbGateHolds_ = function () { return null; };

    // ---- Associated clients: added, never taken off ----
    var edited = [];
    clientProfilesClient_ = function (key) { return { key: key, name: key, row: {}, archived: false }; };
    cpEditLive_ = function () { return { house: '' }; };
    cpProfileEdit_ = function (cctx, payload, u) {
      edited.push(cctx.key + ':' + j(payload.changes) + ':' + (u && u.id));
      return { status: 200, data: { written: ['house'], refused: [] } };
    };
    stored = [{ id: 'locations.clientsAdd', on: true, people: ['u-ann'] }];
    var removal = [call('locationClientsAdd', { house: 'ZZ9999', clients: ['newbie'], remove: ['kmarsh'] }, ann),
                   call('locationClientsAdd', { house: 'ZZ9999', clients: ['newbie'], removed: [] }, master)];
    stAssert_(out, P + 'Associated clients: a payload that asks to take any client off is refused whole — the master\'s ' +
                   'too — and no record is written',
              removal.every(function (r) { return r.status === 400 && /never taken off/.test(r.message); }) &&
              edited.length === 0, j(removal));
    var add = call('locationClientsAdd', { house: 'ZZ9999', clients: ['newbie', 'kmarsh', 'far', 'byaddr', 'gone', 'ghost'] }, ann);
    var why = {};
    ((add.data || {}).refused || []).forEach(function (r) { why[r.client_key] = r.why; });
    stAssert_(out, P + 'Associated clients: a current client placed in no house is added through Clients\' own edit; ' +
                   'the house\'s own client, a client of another house (by code or by street), an inactive client and ' +
                   'one not on file are each refused with why, and never written',
              add.status === 200 && j(add.data.added) === j([{ client_key: 'newbie', name: 'New Bie' }]) &&
              j(add.data.client_keys) === '["newbie"]' &&
              j(edited) === j(['newbie:' + j([{ field: 'house', value: 'ZZ9999', expected: '' }]) + ':u-ann']) &&
              /already a client of ZZ9999/.test(why.kmarsh) && /current client of QQ1000/.test(why.far) &&
              /current client of QQ1000/.test(why.byaddr) && /not a current client/.test(why.gone) &&
              /No client "ghost"/.test(why.ghost) && add.data.app === 'locations' &&
              j(add.data.slices) === '["clients"]' && j(add.data.mirror) === '["houses"]' &&
              add.data.steps.every(function (s) { return s.landed === true; }), j(add));
    edited = [];
    var none = call('locationClientsAdd', { house: 'ZZ9999', clients: ['kmarsh'] }, ann);
    stAssert_(out, P + 'Associated clients: a press that adds nobody says why and writes nothing',
              none.status === 409 && /already a client/.test(none.message) && edited.length === 0 && !none.data.steps,
              j(none));

    // ---- Staff: off the list, never off the record ----
    var offSheet = stLocSheet_([LOCATION_STAFF_OFF_HEADER.slice()]);
    var ensured = [];
    hubTabEnsure_ = function (tab, head) { ensured.push(tab); return tab === LOCATION_STAFF_OFF_TAB ? offSheet : null; };
    hubTabSheet_ = function (tab) { return tab === LOCATION_STAFF_OFF_TAB ? offSheet : null; };
    var part = { staff: [{ key: 'annlee', name: 'Ann Lee' }, { key: 'bobbytables', name: 'Bobby Tables' }], removed: [],
                 removed_why: '' };
    locationsStaffPart_ = function () { return part; };
    stored = [{ id: 'locations.staffRemove', on: true, people: ['u-ann'] }];
    touched = [];
    var gone = call('locationStaffRemove', { house: 'ZZ9999', staff: 'Bobby  Tables' }, ann);
    var notListed = call('locationStaffRemove', { house: 'ZZ9999', staff: 'Nobody Here' }, ann);
    var rows = offSheet.grid.slice(1);
    var srcText = stCode_(HUB_ACTIONS.locationStaffRemove);
    stAssert_(out, P + 'Staff: taking a person off appends one row ("off", who, when) to house_staff_off and touches no ' +
                   'other store — never a delete, never the staff record; a person not on the list is 404',
              gone.status === 200 && gone.data.staff.state === 'off' && rows.length === 1 &&
              rows[0][LOCATION_STAFF_OFF_HEADER.indexOf('staff_key')] === 'bobbytables' &&
              rows[0][LOCATION_STAFF_OFF_HEADER.indexOf('state')] === 'off' &&
              rows[0][LOCATION_STAFF_OFF_HEADER.indexOf('by')] === 'Ann Lee' &&
              notListed.status === 404 && touched.length === 0 && j(ensured) === j([LOCATION_STAFF_OFF_TAB]) &&
              !/deleteRow|deleteRowById_|clearContent|setTrashed|users|staffProfile/.test(srcText),
              j([gone, notListed, rows, touched]));
    var off = locationsStaffOff_('ZZ9999');
    part = { staff: [{ key: 'annlee', name: 'Ann Lee' }], removed: [{ key: 'bobbytables', name: 'Bobby Tables' }], removed_why: '' };
    var backAgain = call('locationStaffRemove', { house: 'ZZ9999', staff: 'Bobby Tables', back: true }, ann);
    var offAfter = locationsStaffOff_('ZZ9999');
    stAssert_(out, P + 'Staff: the last row for a person decides — taken off, then put back, they are listed again',
              !!off.bobbytables && backAgain.status === 200 && backAgain.data.staff.state === 'back' &&
              offSheet.grid.length === 3 && j(offAfter) === '{}', j([off, backAgain, offAfter]));

    // ---- House Notes: anyone's note is notesAny's ----
    var noteGrid = [LOCATION_NOTES_HEADER.slice(),
      LOCATION_NOTES_HEADER.map(function (h) { return { id: 'HN_mine', house: 'ZZ9999', details: 'mine', by: 'Ann Lee', state: 'open', priority: 'normal' }[h] || ''; }),
      LOCATION_NOTES_HEADER.map(function (h) { return { id: 'HN_them', house: 'ZZ9999', details: 'theirs', by: 'Bo Mgr', state: 'open', priority: 'normal' }[h] || ''; })];
    var noteSheet = stLocSheet_(noteGrid);
    locationsNotesSheet_ = function () { return noteSheet; };
    stored = [{ id: 'locations.house', on: true, people: ['u-ann'] }];
    var mine = call('locationNoteEdit', { house: 'ZZ9999', id: 'HN_mine', changes: [{ field: 'details', value: 'mine, edited', expected: 'mine' }] }, ann);
    var theirs = call('locationNoteEdit', { house: 'ZZ9999', id: 'HN_them', changes: [{ field: 'details', value: 'no', expected: 'theirs' }] }, ann);
    stored = [{ id: 'locations.notesAny', on: true, people: ['u-ann'] }];
    var anyone = call('locationNoteEdit', { house: 'ZZ9999', id: 'HN_them', changes: [{ field: 'details', value: 'theirs, edited', expected: 'theirs' }] }, ann);
    var det = LOCATION_NOTES_HEADER.indexOf('details');
    stAssert_(out, P + 'House Notes: the house edition edits its writer\'s own note and is refused anyone else\'s; ' +
                   'notesAny edits a note written by anyone, and the answer carries its steps',
              mine.status === 200 && theirs.status === 403 && anyone.status === 200 &&
              noteSheet.grid[1][det] === 'mine, edited' && noteSheet.grid[2][det] === 'theirs, edited' &&
              anyone.data.steps[0].id === 'sheet' && anyone.data.steps[1].id === 'cache' && anyone.data.app === 'locations',
              j([mine, theirs, anyone]));

    // ---- Clients: the profile pencil is clients.profile's ----
    edited = [];
    touched = [];
    var cpAsk = { client: 'kmarsh', changes: [{ field: 'outcome', value: 'Work', expected: '' }] };
    stored = [];
    var cpNone = [call('clientProfileSave', cpAsk, ann), call('clientProfileSave', cpAsk, bo)];
    stored = [{ id: 'clients.profile', on: false, people: ['u-ann'] }];
    var cpOff = call('clientProfileSave', cpAsk, ann);
    stored = locIds.map(function (id) { return { id: id, on: true, people: ['u-ann'] }; });
    var cpOthers = call('clientProfileSave', cpAsk, ann);
    stAssert_(out, P + 'Clients: without the profile edition, with its key off though listed, or with only the Locations ' +
                   'editions on, a person gets the 404 shape from the profile pencil and nothing is written',
              cpNone.every(shape) && shape(cpOff) && shape(cpOthers) && edited.length === 0,
              j([cpNone, cpOff, cpOthers, edited]));
    stored = [{ id: 'clients.profile', on: true, people: ['u-ann'] }];
    var cpOn = call('clientProfileSave', cpAsk, ann);
    var cpBo = call('clientProfileSave', cpAsk, bo);
    var cpCli = call('clientProfileSave', cpAsk, { id: 'u-ann', email: 'ann@example.org', role: 'client' });
    cpScope.kind = 'ssa';
    cpScope.client_keys = ['someone_else'];
    var cpNarrow = call('clientProfileSave', cpAsk, ann);
    cpScope.client_keys = ['kmarsh'];
    var cpOwnSsa = call('clientProfileSave', cpAsk, ann);
    cpScope.kind = 'guardian';
    var cpFamily = call('clientProfileSave', cpAsk, ann);
    cpScope.kind = 'all';
    cpScope.client_keys = [];
    stored = [];
    var cpMaster = call('clientProfileSave', cpAsk, master);
    stAssert_(out, P + 'Clients: key on and listed, the person reaches the profile edit, for a client their scope reads; ' +
                   'an unlisted manager, a client role, a reader whose scope lacks the client and a family member\'s own ' +
                   'view are the 404; the master reaches it with every key off',
              cpOn.status === 200 && cpOn.data.app === CP_APP_ID && cpOn.data.steps[0].id === 'sheet' &&
              cpOn.data.steps[1].id === 'cache' && j(cpOn.data.slices) === '["clients"]' &&
              j(cpOn.data.mirror) === '["houses"]' &&
              shape(cpBo) && shape(cpCli) && shape(cpNarrow) && cpOwnSsa.status === 200 &&
              shape(cpFamily) && cpMaster.status === 200 && edited.length === 3 &&
              edited[0] === 'kmarsh:' + j(cpAsk.changes) + ':u-ann' && edited[2] === 'kmarsh:' + j(cpAsk.changes) + ':u-boss',
              j([cpOn, cpBo, cpCli, cpNarrow, cpOwnSsa, cpFamily, cpMaster, edited]));
    cpProfileEdit_ = keep.edit;
    cpEditLive_ = function () { return { outcome: '', initials: '', house: '' }; };
    stored = [{ id: 'clients.profile', on: true, people: ['u-ann'] }];
    var cpLocked = call('clientProfileSave', { client: 'kmarsh', changes: ['ssn', 'tl_card', 'dc_exp', 'dc_security_code',
      'dc_pin', 'name', 'status', 'favorite'].map(function (f) { return { field: f, value: '1', expected: '' }; }) }, ann);
    var cpLegacy = call('clientProfileSave', { client: 'kmarsh', fields: { ssn: '900114544' } }, ann);
    var cpWhy = {};
    ((cpLocked.data || {}).refused || []).forEach(function (r) { cpWhy[r.field] = r.why; });
    stAssert_(out, P + 'Clients: a listed person is refused the SSN, the TL card, DC and PIN as protected, the name and the ' +
                   'status each with its reason and an unknown field, by either save shape; nothing is written',
              cpLocked.status === 200 && cpLocked.data.written.length === 0 && touched.length === 0 &&
              ['ssn', 'tl_card', 'dc_exp', 'dc_security_code', 'dc_pin'].every(function (f) { return cpWhy[f] === CP_EDIT_PROTECTED; }) &&
              cpWhy.name === CP_EDIT_LOCKED.name && cpWhy.status === CP_EDIT_LOCKED.status && /Not a field/.test(cpWhy.favorite) &&
              cpLegacy.status === 422, j([cpLocked, cpLegacy, touched]));

    // ---- Clients: a care row is clients.care's; a family member stays the master's ----
    var filed = [];
    cpOverrideLive_ = function (cctx, kind, tab, target) {
      var edit = kind === 'care' ? { record: target ? 'Morning routine' : '', text: target ? 'Brush teeth.' : '', removed: '' }
                                 : { name: 'Sam Support', relationship: '', phone: '', email: '', removed: '' };
      return { edit: edit, target: target, id: '' };
    };
    cpOverrideWrite_ = function (cctx, kind, tab, target, id, next, u) {
      filed.push([cctx.key, kind, tab, target, next.record || next.relationship, u && u.id].join(':'));
      return { id: 'CO_' + cctx.key + '_' + kind + '_st' };
    };
    var careAsk = { client: 'kmarsh', kind: 'care', tab: 'daily', target: 'isp_kmarsh_personal_care',
                    changes: [{ field: 'record', value: 'Morning care', expected: 'Morning routine' }] };
    var careNew = { client: 'kmarsh', kind: 'care', tab: 'goals', target: '', changes: [{ field: 'record', value: 'Swim', expected: '' }] };
    var famAsk = { client: 'kmarsh', kind: 'family', target: 'm1', changes: [{ field: 'relationship', value: 'SSA', expected: '' }] };
    stored = [];
    var careNone = [call('clientProfileOverride', careAsk, ann), call('clientProfileOverride', careAsk, bo)];
    stored = [{ id: 'clients.care', on: false, people: ['u-ann'] }];
    var careOff = call('clientProfileOverride', careAsk, ann);
    stored = [{ id: 'clients.profile', on: true, people: ['u-ann'] }];
    var careProfileOnly = call('clientProfileOverride', careAsk, ann);
    stAssert_(out, P + 'Clients: without the care edition, with its key off though listed, or with only the profile edition ' +
                   'on, a person gets the 404 shape from the care door and nothing is filed',
              careNone.every(shape) && shape(careOff) && shape(careProfileOnly) && filed.length === 0,
              j([careNone, careOff, careProfileOnly, filed]));
    stored = [{ id: 'clients.care', on: true, people: ['u-ann'] }];
    var careOn = call('clientProfileOverride', careAsk, ann);
    var careAdd = call('clientProfileOverride', careNew, ann);
    var careFam = call('clientProfileOverride', famAsk, ann);
    var careBo = call('clientProfileOverride', careAsk, bo);
    var carePlans = call('clientProfileOverride', { client: 'kmarsh', kind: 'care', tab: 'plans', target: '',
                                                    changes: [{ field: 'record', value: 'x', expected: '' }] }, ann);
    cpScope.kind = 'ssa';
    cpScope.client_keys = ['someone_else'];
    var careNarrow = call('clientProfileOverride', careAsk, ann);
    cpScope.client_keys = ['kmarsh'];
    var careOwnSsa = call('clientProfileOverride', careAsk, ann);
    cpScope.kind = 'guardian';
    var careFamily = call('clientProfileOverride', careAsk, ann);
    cpScope.kind = 'all';
    cpScope.client_keys = [];
    stored = [];
    var careMaster = call('clientProfileOverride', careAsk, master);
    var famMaster = call('clientProfileOverride', famAsk, master);
    stAssert_(out, P + 'Clients: key on and listed, the person corrects and adds a care row for a client their scope reads, ' +
                   'answered with the Apply strip\'s steps; a family member stays the master\'s, and an unlisted manager, a ' +
                   'reader whose scope lacks the client and a family member\'s own view are the 404; Care plans are refused; ' +
                   'the master reaches both with every key off',
              careOn.status === 200 && j(careOn.data.written) === '["record"]' && careOn.data.app === CP_APP_ID &&
              careOn.data.steps[0].id === 'sheet' && /client_overrides/.test(careOn.data.steps[0].words) &&
              careOn.data.steps[1].id === 'cache' && j(careOn.data.slices) === '[]' && j(careOn.data.mirror) === '[]' &&
              careAdd.status === 200 && shape(careFam) && shape(careBo) && carePlans.status === 400 &&
              shape(careNarrow) && careOwnSsa.status === 200 && shape(careFamily) &&
              careMaster.status === 200 && famMaster.status === 200 && !famMaster.data.steps &&
              j(filed) === j(['kmarsh:care:daily:isp_kmarsh_personal_care:Morning care:u-ann', 'kmarsh:care:goals::Swim:u-ann',
                              'kmarsh:care:daily:isp_kmarsh_personal_care:Morning care:u-ann',
                              'kmarsh:care:daily:isp_kmarsh_personal_care:Morning care:u-boss', 'kmarsh:family::m1:SSA:u-boss']),
              j([careOn, careAdd, careFam, careBo, carePlans, careNarrow, careOwnSsa, careFamily, careMaster, famMaster, filed]));

    // ---- Clients: a chart row is clients.medication's; the Medications app's writers keep their door ----
    var medSheet = stLocSheet_([
      ['Id - Auto', 'Client', 'PrescriptionName', 'Dosage', 'MedType', 'PRN', 'AdministrationTimes', 'Discountinued'],
      ['7', 'kmarsh', 'Med A', '5 mg', 'Tablet', 'Daily', '"0800"', ''], ['8', 'kmarsh', 'Med B', '', '', '', '', ''],
      ['9', 'other', 'Med C', '', '', '', '', '']]);
    medSheet.deleteRow = function (n) { medSheet.grid.splice(n - 1, 1); };
    var medRange = medSheet.getRange;
    medSheet.getRange = function (r, c, nr, nc) {
      var range = medRange(r, c, nr, nc);
      range.getValue = function () { return range.getValues()[0][0]; };
      return range;
    };
    hubTabSheet_ = function (tab) { return tab === MEDS_TAB ? medSheet : (tab === LOCATION_STAFF_OFF_TAB ? offSheet : null); };
    var medAsk = { client: 'kmarsh', id: '7', changes: [{ field: 'dose', value: '10 mg', expected: '5 mg' }] };
    var medOut = { client: 'kmarsh', id: '8' };
    var medNew = { client: 'Kenny Marsh', client_key: 'kmarsh', name: 'Med D', dose: '1 mg', times: '0900', route: 'Tablet',
                   prn: 'false' };
    var medAll = function (u) { return [call('emarMedUpdate', medAsk, u), call('emarMedDelete', medOut, u), call('emarMedAdd', medNew, u)]; };
    stored = [];
    var medNone = medAll(ann);
    stored = [{ id: 'clients.medication', on: false, people: ['u-ann'] }];
    var medOff = medAll(ann);
    stored = [{ id: 'clients.care', on: true, people: ['u-ann'] }, { id: 'clients.profile', on: true, people: ['u-ann'] }];
    var medOthers = medAll(ann);
    stAssert_(out, P + 'Clients: without the medication edition, with its key off though listed, or with only the care and ' +
                   'profile editions on, a person gets the 404 shape from the change, the removal and the add; the chart ' +
                   'is untouched',
              medNone.concat(medOff, medOthers).every(shape) && medSheet.grid.length === 4 && medSheet.grid[1][3] === '5 mg',
              j([medNone, medOff, medOthers, medSheet.grid]));
    stored = [{ id: 'clients.medication', on: true, people: ['u-ann'] }];
    var medOn = call('emarMedUpdate', medAsk, ann);
    var medTheirs = call('emarMedDelete', { client: 'kmarsh', id: '9' }, ann);
    var medNoClient = [call('emarMedDelete', { id: '8' }, ann), call('emarMedAdd', { client: 'Kenny Marsh', name: 'Med E' }, ann)];
    var medGone = call('emarMedDelete', medOut, ann);
    var medAdded = call('emarMedAdd', medNew, ann);
    var medBo = call('emarMedUpdate', medAsk, bo);
    var medBoApp = call('emarMedDelete', { id: '404' }, bo);
    var medCli = call('emarMedAdd', medNew, { id: 'u-ann', email: 'ann@example.org', role: 'client' });
    cpScope.kind = 'ssa';
    cpScope.client_keys = ['someone_else'];
    var medNarrow = call('emarMedDelete', { client: 'kmarsh', id: '7' }, ann);
    cpScope.kind = 'guardian';
    cpScope.client_keys = ['kmarsh'];
    var medFamily = call('emarMedDelete', { client: 'kmarsh', id: '7' }, ann);
    cpScope.kind = 'all';
    cpScope.client_keys = [];
    stored = [];
    var medMaster = call('emarMedUpdate', { client: 'kmarsh', id: '7',
                                            changes: [{ field: 'route', value: 'Capsule', expected: 'Tablet' }] }, master);
    var mg = medSheet.grid;
    stAssert_(out, P + 'Clients: key on and listed, the person changes, removes and adds a chart row of a client their scope ' +
                   'reads, each answered with the Apply strip\'s steps and the add filed under the client\'s own name; ' +
                   'another client\'s row is refused as moved, and a removal or an add naming no client is refused; an ' +
                   'unlisted manager is the 404 on the change and keeps the Medications app\'s own door, a client role, a ' +
                   'reader whose scope lacks the client and a family member\'s own view are the 404; the master changes ' +
                   'it with every key off',
              medOn.status === 200 && j(medOn.data.written) === '["dose"]' && medOn.data.app === CP_APP_ID &&
              /medications tab/.test(medOn.data.steps[0].words) && j(medOn.data.slices) === '[]' &&
              medTheirs.status === 409 && /has moved/.test(medTheirs.message) &&
              medNoClient.every(function (r) { return r.status === 400; }) &&
              medGone.status === 200 && medGone.data.removed === '8' && j(medGone.data.written) === '["removed"]' &&
              medGone.data.steps[1].id === 'cache' &&
              medAdded.status === 200 && medAdded.data.id === '10' && medAdded.data.steps[0].id === 'sheet' &&
              shape(medBo) && medBoApp.status === 404 && /No medicine/.test(medBoApp.message) &&
              shape(medCli) && shape(medNarrow) && shape(medFamily) &&
              medMaster.status === 200 && j(medMaster.data.written) === '["route"]' &&
              mg.length === 4 && mg[1][3] === '10 mg' && mg[1][4] === 'Capsule' && mg[2][0] === '9' &&
              mg[3][0] === '10' && mg[3][1] === 'kmarsh' && mg[3][2] === 'Med D',
              j([medOn, medTheirs, medNoClient, medGone, medAdded, medBo, medBoApp, medCli, medNarrow, medFamily, medMaster, mg]));

    // ---- Clients: a client's trip is clients.transportation's; the Transportation app's own gate stays its own ----
    var trGate = function (u, key) {
      var g = vcClientGate_(vcGate_(u), u, key === undefined ? 'kmarsh' : key);
      return { open: g.open, client: g.client || '', lent: !!g.lent, edit: g.can_edit };
    };
    var trShut = function (g) { return g.open === false && g.client === ''; };
    stored = [];
    var trNone = trGate(ann);
    stored = [{ id: 'clients.transportation', on: false, people: ['u-ann'] }];
    var trOff = trGate(ann);
    stored = [{ id: 'clients.medication', on: true, people: ['u-ann'] }, { id: 'clients.care', on: true, people: ['u-ann'] }];
    var trOthers = trGate(ann);
    stored = [{ id: 'clients.transportation', on: true, people: ['u-ann'] }];
    var trOn = trGate(ann);
    var trNoClient = trGate(ann, '');
    var trBo = trGate(bo);
    var trCli = trGate(cli);
    var trBoDoor = call('vehicleCalendarTripSave', { trip_id: 'VT0000000000', client: 'kmarsh', status: 'cancelled' }, bo);
    var trBoBoard = call('vehicleCalendarBoard', { client: 'kmarsh' }, bo);
    cpScope.kind = 'ssa';
    cpScope.client_keys = ['someone_else'];
    var trNarrow = trGate(ann);
    cpScope.kind = 'guardian';
    cpScope.client_keys = ['kmarsh'];
    var trFamily = trGate(ann);
    cpScope.kind = 'all';
    cpScope.client_keys = [];
    stored = [];
    var trMaster = trGate(master);
    // the lent gate looked the holder up among the staff: nothing of this test's accounts is kept for the next
    VC_MEMO = {};
    stAssert_(out, P + 'Clients: a trip opened from a client\'s page reaches the Transportation app\'s own panel for a ' +
                   'listed holder of clients.transportation with its key on, for that client alone; without it, with its ' +
                   'key off, with only the other Clients editions, for a manager or a client role, a reader whose scope ' +
                   'lacks the client and a family member\'s own view the app\'s gate stays shut (the 404 shape at its ' +
                   'board and its trip save); the master opens it with every key off',
              [trNone, trOff, trOthers, trNoClient, trBo, trCli, trNarrow, trFamily].every(trShut) &&
              trOn.open === true && trOn.client === 'kmarsh' && trOn.lent === true && trOn.edit === false &&
              shape(trBoDoor) && shape(trBoBoard) && trMaster.open === true && trMaster.client === 'kmarsh' &&
              stCode_(vcClientGate_).indexOf('CP_EDITION_TRANSPORT') !== -1,
              j([trNone, trOff, trOthers, trOn, trNoClient, trBo, trCli, trBoDoor, trBoBoard, trNarrow, trFamily, trMaster]));
    stored = [{ id: 'clients.profile', on: true, people: ['u-ann'] }, { id: 'locations.documents', on: true, people: ['u-ann'] }];
    var mineAnn = call('editionsMine', { app: CP_APP_ID }, ann);
    var mineAll = call('editionsMine', {}, ann);
    var mineBo = call('editionsMine', { app: CP_APP_ID }, bo);
    stored = [];
    var mineMaster = call('editionsMine', { app: CP_APP_ID }, master);
    stAssert_(out, P + 'editionsMine tells a person the editions they make (one app\'s when asked), ids only; the master ' +
                   'makes every one with every key off',
              j(mineAnn.data.editions) === '["clients.profile"]' && Object.keys(mineAnn.data).join() === 'editions' &&
              j(mineAll.data.editions) === '["locations.documents","clients.profile"]' &&
              j(mineBo.data.editions) === '[]' &&
              j(mineMaster.data.editions) ===
                '["clients.profile","clients.care","clients.family","clients.medication","clients.transportation"]',
              j([mineAnn, mineAll, mineBo, mineMaster]));
  } finally {
    hiringAlerts_ = keep.alerts;
    hubProfileAppGate_ = keep.gate;
    locationsHouse_ = keep.house;
    HUB_MASTER_EMAIL_CACHE = keep.masterCache;
    HUB_MEMBER_CTX = keep.member;
    HUB_WORLD_CTX = keep.world;
    usersAll_ = keep.users;
    HUB_ACTIONS.hiringAlertsSet = keep.set;
    hubSysLog_ = keep.log;
    hubTabEnsure_ = keep.ensure;
    hubTabSheet_ = keep.sheet;
    sheetDbGateHolds_ = keep.holds;
    locationsStaffPart_ = keep.staffPart;
    clientProfilesClient_ = keep.client;
    cpEditLive_ = keep.live;
    cpProfileEdit_ = keep.edit;
    locationsNotesSheet_ = keep.notes;
    HUB_VIEWER_MEMO = keep.viewerMemo;
    updateRowById_ = keep.update;
    createRow_ = keep.create;
    cpOverrideLive_ = keep.ovLive;
    cpOverrideWrite_ = keep.ovWrite;
  }
}
