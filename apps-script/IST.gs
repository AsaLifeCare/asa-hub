// IST — in-service training records, one per employee × client.
// Ohio requires a house manager to train a certified employee ON THAT CLIENT before they work together; a missing…

// THE TWO WORDS THE ROWS THEMSELVES CARRY.
var IST_STATUS_OWED = 'owed';
var IST_STATUS_DONE = 'done';

// Is this roster cell a coverage label rather than a person?
function istNotAPerson_(name) {
  var up = String(name || '').trim().toUpperCase();
  if (!up) return true;
  var exact = istCfgList_('ist_non_person_names');
  for (var i = 0; i < exact.length; i++) {
    if (up === String(exact[i]).trim().toUpperCase()) return true;
  }
  var inside = istCfgList_('ist_non_person_contains');
  for (var j = 0; j < inside.length; j++) {
    var needle = String(inside[j]).trim().toUpperCase();
    if (needle && up.indexOf(needle) !== -1) return true;
  }
  return false;
}

/** The word written on a row whose house left the map. */
function istStaleMarker_() {
  return istCfgText_('ist_stale_marker');
}

// House → client map, read from the `ist_houses` tab — NEVER hardcoded — it may never be hardcoded.
function istHouseMap_() {
  var rows = [];
  try { rows = listRows_('istHouses', {}); } catch (e) { rows = []; }
  var byHouse = {};
  rows.forEach(function (r) {
    if (String(r.active || 'yes').toLowerCase() === 'no') return;
    var house = str_(r.house);
    var client = str_(r.clientName);
    if (!house || !client) return;
    if (!byHouse[house]) byHouse[house] = [];
    byHouse[house].push(client);
  });
  return byHouse;
}

// Houses the roster actually uses, from the shift slice.
function istHouseAliases_() {
  var alias = {};
  try {
    listRows_('shiftMatrix', {}).forEach(function (r) {
      var code = str_(r.houseId), name = str_(r.houseName);
      if (!code) return;
      alias[code] = code;
      if (name) alias[name] = code;
    });
  } catch (e) { /* slice not built — the map alone still stands */ }
  return alias;
}

// Who works where, from the roster.
function istStaffByHouse_() {
  var out = null;
  var shifts = [];
  try { shifts = listRows_('shifts', {}); } catch (e) { return null; }
  var lookback = istCfgInt_('ist_roster_lookback_days');
  var floor = lookback > 0 ? new Date(Date.now() - lookback * 86400000).toISOString().slice(0, 10) : '';
  out = {};
  shifts.forEach(function (s) {
    var staff = str_(s.staff);
    var house = str_(s.house);
    var date = str_(s.date).slice(0, 10);
    if (!staff || !house || !date) return;
    if (floor && date < floor) return;
    // a coverage label is not a person — the same lists tools/rebuild_ist.py uses
    if (istNotAPerson_(staff)) return;
    if (!out[house]) out[house] = {};
    var at = out[house][staff];
    if (!at) { out[house][staff] = { first: date, last: date }; return; }
    if (date < at.first) at.first = date;
    if (date > at.last) at.last = date;
  });
  return out;
}

// Rebuild — recompute who owes an IST and MERGE into the table, never replace: `trainedAt`, `notifiedAt` and…
HUB_POLICY.istRebuild = {
  file: 'IST.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.istRebuild = function (payload, user) {
  if (!user || user.is_service || ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }

  var byHouse = istHouseMap_();
  if (!Object.keys(byHouse).length) {
    // REFUSE.
    return { status: 503, message:
      'The house → client map (tab ist_houses) is empty, so there is nothing to ' +
      'compute against. Fill it from the roster and the client entities with ' +
      'tools/import_ist_houses.py, or type the rows by hand — one per house per ' +
      'client. Building the table without it would say nobody owes an IST.' };
  }

  var alias = istHouseAliases_();
  var clientsByName = {};
  clientsDerived_(user).forEach(function (c) {
    var k = clientNameKey_(c.name);
    if (k) clientsByName[k] = c;
  });

  var staffByHouse = istStaffByHouse_();
  if (staffByHouse === null) {
    // The roster did not answer.
    return { status: 503, message:
      'The roster could not be read, so nobody can be paired with a client right now. ' +
      'Nothing was changed. Try again once the shift slice is back.' };
  }

  // Third state: a read that SUCCEEDS and returns NOTHING.
  if (!Object.keys(staffByHouse).length) {
    return { status: 503, message:
      'The roster is not readable from here — the shifts tab in this spreadsheet is empty ' +
      'by design, because the real roster lives in Postgres and is served to the browser as ' +
      'a slice. Pairing therefore happens in tools/rebuild_ist.py, which reads the roster ' +
      'where it actually is. Run that, then reload this screen. ' +
      'NOTHING was changed and no row was removed.' };
  }

  var people = {};
  try {
    withoutIspClients_(peopleMerged_(listRows_('people', {}))).forEach(function (p) {
      var k = clientNameKey_(p.name);
      if (k) people[k] = p;
    });
  } catch (eP) { people = {}; }

  var certs = {};
  try { certs = certPicture_(); } catch (eC) { certs = {}; }

  // Everything already in the table, by its pair key.
  var existing = {};
  listRows_('istRecords', {}).forEach(function (r) {
    existing[istPairKey_(r.staffName, r.clientName)] = r;
  });

  // Fold everyone rostered onto the house CODE — a shift is filed under whichever name the manager typed, so both…
  var staffByCode = {};
  for (var rawHouse in staffByHouse) {
    if (!Object.prototype.hasOwnProperty.call(staffByHouse, rawHouse)) continue;
    var code = alias[rawHouse] || rawHouse;
    if (!staffByCode[code]) staffByCode[code] = {};
    var here = staffByHouse[rawHouse];
    for (var sName in here) {
      if (!Object.prototype.hasOwnProperty.call(here, sName)) continue;
      var was = staffByCode[code][sName];
      if (!was) { staffByCode[code][sName] = { first: here[sName].first, last: here[sName].last }; continue; }
      if (here[sName].first < was.first) was.first = here[sName].first;
      if (here[sName].last > was.last) was.last = here[sName].last;
    }
  }

  // a pair exists only if they worked there on or after the client arrived (ist_pair_requires_overlap)
  var needOverlap = istCfgYes_('ist_pair_requires_overlap');
  var added = 0, kept = 0, noOverlap = 0, noHouse = [], unplaced = [];
  for (var houseCode in byHouse) {
    if (!Object.prototype.hasOwnProperty.call(byHouse, houseCode)) continue;
    var staffHere = staffByCode[houseCode] || {};
    var clientsHere = [];
    byHouse[houseCode].forEach(function (nm) {
      var hit = clientsByName[clientNameKey_(nm)];
      // A mapped name no client answers to is REPORTED, never turned into a row against a person who may not exist.
      if (hit) clientsHere.push(hit); else unplaced.push(nm + ' (in ist_houses, not a client here)');
    });
    if (!clientsHere.length) continue;
    if (!Object.keys(staffHere).length) { noHouse.push(houseCode); continue; }

    for (var staffName in staffHere) {
      if (!Object.prototype.hasOwnProperty.call(staffHere, staffName)) continue;
      var firstShift = staffHere[staffName].first;
      var lastShift = staffHere[staffName].last;
      var pk = clientNameKey_(staffName);
      var person = people[pk] || null;
      var certState = istCertNote_(certs, pk);

      for (var i = 0; i < clientsHere.length; i++) {
        var client = clientsHere[i];
        var key = istPairKey_(staffName, client.name);
        if (existing[key]) { kept++; continue; }
        var arrived = str_(client.start_date).slice(0, 10);
        if (needOverlap && arrived && lastShift < arrived) { noOverlap++; continue; }

        var istRefused = sheetDbRefused_(createRow_('istRecords', {
          staffName: staffName,
          staffEmail: person ? str_(person.email) : '',
          staffPhone: person ? str_(person.phone) : '',
          avatar: person ? str_(person.avatar) : '',
          clientName: str_(client.name),
          house: houseCode,
          // LATEST of the dates: a training dated before the client lived there proves nothing.
          dueDate: istLatestDate_([firstShift, str_(client.start_date)]),
          status: IST_STATUS_OWED,
          certNote: certState,
          trainedAt: '', trainedBy: '',
          notifiedAt: '', notifyCount: '0', remindRequested: ''
        }));
        if (istRefused) {
          return { status: istRefused.status, message: istRefused.message + ' — ' + added +
                   ' training row(s) were added before the refusal; the rebuild stopped there.' };
        }
        added++;
      }
    }
  }

  // A house that left the map does NOT take its rows with it — the fallback for the case where a house is…
  var stale = [];
  var staleMark = istStaleMarker_();
  listRows_('istRecords', {}).forEach(function (r) {
    var house = str_(r.house);
    var known = house && byHouse[house];
    // only the stale mark writes houseStatus, so any word there is a mark — an older word included
    var mark = str_(r.houseStatus);
    if (!known && mark !== staleMark) {
      updateRowById_('istRecords', { id: str_(r.id), houseStatus: staleMark });
      if (!mark) stale.push(str_(r.staffName) + ' · ' + str_(r.clientName) + ' @ ' + (house || '—'));
    } else if (known && mark) {
      updateRowById_('istRecords', { id: str_(r.id), houseStatus: '' });
    }
  });

  hubSysLog_(str_(user.email), 'istRebuild', '',
             { status: 200, message: added + ' new, ' + kept + ' kept, ' + stale.length + ' stale' +
                                     ' (settings: ' + istConfigSource_() + ')' });
  return { status: 200, data: {
    added: added, kept: kept, neverOverlapped: noOverlap,
    // WHICH CONFIGURATION THIS RUN OBEYED — sheet · last known · shipped.
    configSource: istConfigSource_(),
    rowsWhoseHouseLeftTheMap: stale,
    // NAMED, not counted — these are the two ways this table goes quietly incomplete, and a number alone would let…
    clientsWithoutAHouse: unplaced,
    housesWithNobodyRostered: noHouse
  } };
};

/** One stable key per employee×client pair. */
function istPairKey_(staff, client) {
  return (clientNameKey_(staff) || '') + '|' + (clientNameKey_(client) || '');
}

/** The latest of a set of dates, as ISO day. Blanks are ignored. */
function istLatestDate_(list) {
  var best = '';
  (list || []).forEach(function (d) {
    var s = String(d || '').slice(0, 10);
    if (!s) return;
    if (!best || s > best) best = s;
  });
  return best;
}

// WHICH CERTIFICATION THE ROW REPORTS ON, and what it is called — resolved together, because they are one statement.
var IST_GATE_WARNED = false;

function istGateCertification_() {
  var shippedKey = istConfigDefault_('ist_gate_certification');
  var shippedName = istConfigDefault_('ist_gate_certification_label');
  var key = istCfgText_('ist_gate_certification');
  var refused = '';
  try { refused = istConfigProblems_()['ist_gate_certification'] || ''; } catch (eP) { refused = ''; }
  var known = {};
  try {
    if (typeof certKeys_ === 'function') {
      certKeys_().forEach(function (k) { known[String(k)] = true; });
    }
  } catch (e) { known = {}; }
  // An unreadable catalogue is not a wrong key: with nothing to check against, the cell is taken at its word rather…
  if (refused || !key || (Object.keys(known).length &&
                          !Object.prototype.hasOwnProperty.call(known, key))) {
    if ((refused || key) && !IST_GATE_WARNED) {
      IST_GATE_WARNED = true;
      try {
        hubSysLog_('asa-hub:ist', 'ist_gate_certification_unknown',
                   (refused || ('"' + key + '" is not a course in ist_cert_labels')) +
                   ' — reporting on ' + shippedKey + ' instead; nobody was marked uncertified',
                   { status: 200 });
      } catch (eLg) { /* the fallback matters more than the note */ }
    }
    return { key: shippedKey, label: shippedName, fellBack: true };
  }
  return { key: key, label: istCfgText_('ist_gate_certification_label'), fellBack: false };
}

// What the gate certification says — a NOTE, never a blocker.
function istCertNote_(certs, personKey) {
  var gate = istGateCertification_();
  var certKey = gate.key;
  var name = gate.label;
  var none = istCfgText_('ist_note_no_certification').replace(/\{cert\}/g, name);

  var known = certs[personKey];
  if (!known || !known.certs) return none;
  var held = known.certs[certKey];
  if (!held || !held.expires) return none;
  var ms = certDateMs_(held.expires);
  if (ms === null) {
    return istCfgText_('ist_note_unreadable')
      .replace(/\{cert\}/g, name).replace(/\{value\}/g, str_(held.expires));
  }
  if (ms < Date.now()) {
    return istCfgText_('ist_note_expired')
      .replace(/\{cert\}/g, name).replace(/\{date\}/g, String(held.expires).slice(0, 10));
  }
  return '';
}

// Ask for another notice — the manual re-send: a notice can always be sent again by hand, from the table.
HUB_POLICY.istRemind = {
  file: 'IST.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.istRemind = function (payload, user) {
  if (!user || user.is_service || ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which row?' };

  var row = null;
  listRows_('istRecords', {}).forEach(function (r) { if (str_(r.id) === id) row = r; });
  if (!row) return { status: 404, message: 'No IST row with that id.' };
  // a completed IST past ist_valid_days is owed again, so it may be chased
  if (String(row.status || '').toLowerCase() === IST_STATUS_DONE && !istLapsed_(row.trainedAt)) {
    return { status: 400, message: str_(row.staffName) + ' is already recorded as trained on ' +
             str_(row.clientName) + ' — there is nothing to chase.' };
  }

  updateRowById_('istRecords', { id: id, remindRequested: new Date().toISOString() });
  hubSysLog_(str_(user.email), 'istRemind', str_(row.staffName),
             { status: 200, message: 'another notice requested for ' + str_(row.clientName) });

  return { status: 200, data: {
    queued: true,
    who: str_(row.staffName),
    message: 'Queued. Smart Comms sends it on the next sweep — with the wording and ' +
             'the recipients from the ist_due row, and nothing at all if that situation is off.'
  } };
};

// Subjects for the Smart Comms sweep: owed ISTs never told, or asked to be told again, and completed ones past…
function istSmartSubjects_() {
  var out = [];
  var repeats = istNoticeRepeats_();
  var today = istOhioToday_();
  listRows_('istRecords', {}).forEach(function (r) {
    var status = String(r.status || '').toLowerCase();
    // a completed IST past ist_valid_days is owed again: told once per lapse, its own ledger instance
    var lapsed = (status === IST_STATUS_DONE || !!str_(r.trainedAt)) && istLapsed_(r.trainedAt, today);
    if (status !== IST_STATUS_OWED && !lapsed) return;
    var count = parseInt(r.notifyCount, 10) || 0;
    var asked = str_(r.remindRequested);
    // never told → tell; told → only when asked again, unless ist_notice_repeats hands it to the row's pacing
    if (!lapsed && count > 0 && !asked && !repeats) return;
    out.push({
      id: str_(r.id),
      name: str_(r.staffName),
      phone: str_(r.staffPhone),
      email: str_(r.staffEmail),
      client: str_(r.clientName),
      house: str_(r.house),
      due: str_(r.dueDate),
      certNote: str_(r.certNote),
      instance: str_(r.id) + '#' + (asked ? asked.slice(0, 16)
        : lapsed ? 'lapsed-' + str_(r.trainedAt).slice(0, 10) : 'first')
    });
  });
  return out;
}

/** A told row goes back to the sweep only when `ist_notice_repeats` is yes and the ist_due row's pacing repeats. */
function istNoticeRepeats_() {
  if (!istCfgYes_('ist_notice_repeats')) return false;
  try {
    var rows = (typeof smartSituations_ === 'function') ? smartSituations_() : [];
    for (var i = 0; i < rows.length; i++) {
      if (str_(rows[i].id) !== 'ist_due') continue;
      var maxA = parseInt(rows[i].max_attempts, 10);
      var days = (typeof SMART_FREQUENCIES !== 'undefined')
        ? SMART_FREQUENCIES[String(rows[i].frequency || 'once').trim().toLowerCase()] : 0;
      return !isNaN(maxA) && maxA > 1 && !!days;
    }
  } catch (e) { /* unreadable: told once, as always */ }
  return false;
}

// Stamp a row after Smart Comms really reached the person.
function istMarkNotified_(id) {
  var row = null;
  listRows_('istRecords', {}).forEach(function (r) { if (str_(r.id) === str_(id)) row = r; });
  if (!row) return;
  updateRowById_('istRecords', {
    id: str_(id),
    notifiedAt: new Date().toISOString(),
    notifyCount: String((parseInt(row.notifyCount, 10) || 0) + 1),
    remindRequested: ''
  });
}


// What Settings → IST shows: the map plus its two silences — a rostered house with nobody mapped to it, and a…
HUB_POLICY.istHouseState = {
  file: 'IST.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.istHouseState = function (payload, user) {
  if (!user || user.is_service || ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }

  var rows = [];
  try { rows = listRows_('istHouses', {}); } catch (e) { rows = []; }

  var mappedHouses = {}, mappedClients = {};
  rows.forEach(function (r) {
    if (String(r.active || 'yes').toLowerCase() === 'no') return;
    if (str_(r.house)) mappedHouses[str_(r.house)] = true;
    var ck = clientNameKey_(r.clientName);
    if (ck) mappedClients[ck] = true;
  });

  // The houses the roster really uses right now, code and short name.
  var roster = {}, rosterFailed = false;
  try {
    listRows_('shiftMatrix', {}).forEach(function (r) {
      var code = str_(r.houseId);
      if (code) roster[code] = str_(r.houseName) || code;
    });
  } catch (eR) { rosterFailed = true; }

  var housesWithoutClients = [];
  for (var code in roster) {
    if (!Object.prototype.hasOwnProperty.call(roster, code)) continue;
    if (!mappedHouses[code]) housesWithoutClients.push({ house: code, houseName: roster[code] });
  }

  var clientsWithoutHouse = [];
  try {
    clientsDerived_(user).forEach(function (c) {
      if (!mappedClients[clientNameKey_(c.name)]) clientsWithoutHouse.push(str_(c.name));
    });
  } catch (eC) { /* missing client list speaks for itself */ }

  return { status: 200, data: {
    rows: rows.map(function (r) {
      return { id: str_(r.id), house: str_(r.house), houseName: str_(r.houseName),
               clientName: str_(r.clientName), active: String(r.active || 'yes'),
               source: str_(r.source) };
    }),
    rosterHouses: Object.keys(roster).map(function (c) { return { house: c, houseName: roster[c] }; }),
    // Stated, not shown as an empty list: a failed read and an empty roster look identical on screen and mean…
    rosterUnreadable: rosterFailed,
    // The lane's own settings are NOT reported here on purpose: istConfigGet is their one door, and the Settings…
    housesWithoutClients: housesWithoutClients,
    clientsWithoutHouse: clientsWithoutHouse
  } };
};


// Write a house+client pair — through the resolver, NOT generic CRUD, so these rules are the server's and no caller…
HUB_POLICY.istHouseSet = {
  file: 'IST.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.istHouseSet = function (payload, user) {
  if (!user || user.is_service || ['admin', 'manager'].indexOf(String(user.role)) === -1) {
    return hubDenied_();
  }
  var p = payload || {};
  var id = str_(p.id);

  // EDIT / TOGGLE / REMOVE — an existing row.
  if (id) {
    var found = null;
    listRows_('istHouses', {}).forEach(function (r) { if (str_(r.id) === id) found = r; });
    if (!found) return { status: 404, message: 'No house mapping with that id.' };

    if (p.remove === true) {
      // Removing a mapping fixes a lookup; the IST rows behind it STAY and the next rebuild marks them, never…
      deleteRowById_('istHouses', id);
      hubSysLog_(str_(user.email), 'istHouseSet', str_(found.house),
                 { status: 200, message: 'removed ' + str_(found.clientName) });
      return { status: 200, data: { id: id, removed: true,
        message: 'Removed. The IST rows behind it are kept and marked on the next rebuild.' } };
    }

    // Correct the house code or short name.
    if (p.house !== undefined || p.houseName !== undefined) {
      var patch = { id: id };
      if (p.house !== undefined) {
        var newHouse = str_(p.house).trim();
        if (!newHouse) return { status: 400, message: 'A house code cannot be blank.' };
        patch.house = newHouse;
      }
      if (p.houseName !== undefined) patch.houseName = str_(p.houseName).trim();
      updateRowById_('istHouses', patch);
      hubSysLog_(str_(user.email), 'istHouseSet', str_(patch.house || found.house),
                 { status: 200, message: 'edited ' + str_(found.clientName) });
      return { status: 200, data: { id: id, message: 'Saved. Counted on the next rebuild.' } };
    }

    var next = String(p.active || '').toLowerCase() === 'no' ? 'no' : 'yes';
    updateRowById_('istHouses', { id: id, active: next });
    hubSysLog_(str_(user.email), 'istHouseSet', str_(found.house),
               { status: 200, message: str_(found.clientName) + ' → ' + next });
    return { status: 200, data: { id: id, active: next,
      message: next === 'no'
        ? 'Switched off. The IST rows behind this pair are kept and marked on the next rebuild.'
        : 'Switched on. Counted on the next rebuild.' } };
  }

  // CREATE — a new pair.
  var house = str_(p.house).trim();
  var clientName = str_(p.clientName).trim();
  if (!house || !clientName) return { status: 400, message: 'A house code and a client are both required.' };

  var known = null;
  clientsDerived_(user).forEach(function (c) {
    if (clientNameKey_(c.name) === clientNameKey_(clientName)) known = c;
  });
  if (!known) {
    return { status: 400, message: 'No client here answers to "' + clientName + '". ' +
             'Use the name the platform knows them by — a name nothing matches would become a ' +
             'row that never produces the training it is supposed to.' };
  }

  var clash = false;
  listRows_('istHouses', {}).forEach(function (r) {
    if (str_(r.house).toLowerCase() === house.toLowerCase() &&
        clientNameKey_(r.clientName) === clientNameKey_(clientName)) clash = true;
  });
  if (clash) {
    return { status: 409, message: str_(known.name) + ' is already mapped to ' + house + '.' };
  }

  var row = createRow_('istHouses', {
    house: house,
    houseName: str_(p.houseName).trim(),
    // The platform's spelling, not the typist's — one name downstream.
    clientName: str_(known.name),
    active: 'yes',
    source: 'typed in Settings'
  });
  if (sheetDbRefused_(row)) return sheetDbRefused_(row);
  hubSysLog_(str_(user.email), 'istHouseSet', house,
             { status: 200, message: 'mapped ' + str_(known.name) });
  return { status: 200, data: { id: str_(row.id), clientName: str_(known.name) } };
};
