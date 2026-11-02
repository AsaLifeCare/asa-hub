/** Order is load-bearing: world, tenant book, dissolved, moved, homed, then HUB_DB. */
function hubTabWorkbook_(tabName) {
  var tab = String(tabName || '');

  if (typeof HUB_WORLD_CTX !== 'undefined' && HUB_WORLD_CTX) {
    return ssOpen_(HUB_WORLD_CTX.ssId);
  }

  // serving a tenant's non-central tabs from headquarters would leak its rows
  if (!hubTabIsCentral_(tab)) {
    var sid = '';
    try { sid = tenantSpreadsheetId_(); } catch (eT) { sid = ''; }
    if (sid) return ssOpen_(sid);
  }

  try {
    if (typeof hiringTabDissolved_ === 'function' && hiringTabDissolved_(tab)) return null;
  } catch (eD) {}

  try {
    if (typeof houseMoved_ === 'function' && houseMoved_(tab)) {
      var houseId = houseIdFor_(tab);
      if (houseId) return ssOpen_(houseId);
    }
  } catch (eH) {}

  try {
    var home = hubTabHomeId_(tab);
    if (home) return ssOpen_(home);
  } catch (eB) {}

  return ssOpen_(hubId_('HUB_DB_ID'));
}

/** The `Data` fallback name is honoured only when this workbook is the tab's declared house. */
function hubHouseTabIn_(ss, tabName) {
  if (!ss) return null;
  var tab = String(tabName || '');
  var sheet = null;
  try { sheet = ss.getSheetByName(tab); } catch (eByName) { sheet = null; }
  if (sheet) return sheet;
  try {
    var houseId = (typeof houseIdFor_ === 'function') ? houseIdFor_(tab) : '';
    if (houseId && String(ss.getId()) === String(houseId)) {
      return ss.getSheetByName(HOUSE_DATA_TAB) || null;
    }
  } catch (eHouse) {}
  return null;
}


/** Null means no tab where it should be — not an empty one. */
function hubTabSheet_(tabName) {
  var tab = String(tabName || '');
  if (!tab) return null;
  try {
    if (typeof runtimeSheetFor_ === 'function') {
      var shim = runtimeSheetFor_(tab);
      if (shim) return shim;
    }
  } catch (eR) {}
  try {
    return hubHouseTabIn_(hubTabWorkbook_(tab), tab);
  } catch (eS) { return null; }
}

/** The only place allowed to create a tab; throws rather than re-create one declared gone. */
function hubTabEnsure_(tabName, header) {
  var tab = String(tabName || '');
  if (!tab) throw new Error('hubTabEnsure_: a tab name is required.');

  try {
    if (typeof runtimeSheetFor_ === 'function') {
      var shim = runtimeSheetFor_(tab);
      if (shim) return shim;
    }
  } catch (eR) {}

  var ss = hubTabWorkbook_(tab);
  if (!ss) {
    throw new Error('hubTabEnsure_: "' + tab + '" is dissolved and the runtime did not answer.');
  }

  var sheet = hubHouseTabIn_(ss, tab);
  if (sheet) return sheet;

  if (hubTabDeclaredGone_(tab) && !hubTabBornHere_(ss, tab)) {
    throw new Error('hubTabEnsure_: "' + tab + '" is declared moved or dissolved and its ' +
                    'new address did not answer — refusing to re-create it.');
  }

  sheet = ss.insertSheet(tab);
  var cols = (header && header.length) ? header : ['id', 'createdAt', 'updatedAt'];
  sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  sheet.setFrozenRows(1);
  return sheet;
}

/** A born-home tab (HUB_TAB_BORN_HOME) may be made only in the book its HUB_TAB_HOME property names — never HUB_DB. */
function hubTabBornHere_(ss, tabName) {
  var tab = String(tabName || '');
  if (!ss || typeof HUB_TAB_BORN_HOME === 'undefined' || HUB_TAB_BORN_HOME.indexOf(tab) === -1) return false;
  var home = '';
  try { home = hubTabHomeId_(tab); } catch (eH) { home = ''; }
  if (!home) return false;
  try { return String(ss.getId()) === String(home); } catch (eI) { return false; }
}

/** Code-held declarations still answer when the depot is unreadable; this only ever refuses creation. */
function hubTabDeclaredGone_(tabName) {
  var tab = String(tabName || '');
  if (!tab) return false;

  try {
    if (typeof HIRING_DISSOLVABLE_TABS !== 'undefined' &&
        HIRING_DISSOLVABLE_TABS.indexOf(tab) !== -1) return true;
  } catch (eL) {}
  // membership alone refuses: a failed book open would otherwise fall through to HUB_DB
  try {
    if (typeof HUB_TAB_HOME !== 'undefined' &&
        Object.prototype.hasOwnProperty.call(HUB_TAB_HOME, tab)) return true;
  } catch (eB) {}
  try {
    if (typeof houseIdFor_ === 'function' && houseIdFor_(tab)) return true;
  } catch (eP) {}
  try {
    if (typeof houseMoved_ === 'function' && houseMoved_(tab)) return true;
  } catch (eM) {}
  try {
    if (typeof hiringTabDissolved_ === 'function' && hiringTabDissolved_(tab)) return true;
  } catch (eS) {}
  return false;
}

/** A tab with both a book route and a house pointer has no single address. */
function hubTabAddressConflicts_() {
  var out = [];
  try {
    Object.keys(HUB_TAB_HOME).forEach(function (tab) {
      var id = '';
      try { id = houseIdFor_(tab); } catch (e) {}
      if (id) out.push(tab);
    });
  } catch (eC) {}
  return out;
}
