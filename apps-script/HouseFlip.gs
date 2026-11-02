// A tab is flipped only when both the depot pointer and an explicit `moved.<tab>` yes stand; every failure falls back to HUB_DB.
function houseMoved_(tabName) {
  var tab = String(tabName || '');
  if (!tab) return false;
  try {
    var kv = switchboardValues_('moved');
    if (!switchboardOn_(kv[tab])) return false;
  } catch (e) { return false; }
  return !!houseIdFor_(tabName);
}

function houseIdFor_(tabName) {
  try {
    if (typeof flowHouseId_ === 'function') return flowHouseId_(tabName);
    return String(hubProp_('HUB_HOUSE_' + String(tabName || '').toUpperCase() + '_ID') || '').trim();
  } catch (e) { return ''; }
}

var HOUSE_DATA_TAB = 'Data';

var HOUSE_SHEET_MEMO = {};
function houseSheetFor_(tabName) {
  var tab = String(tabName || '');
  if (!tab) return null;
  if (tab in HOUSE_SHEET_MEMO) return HOUSE_SHEET_MEMO[tab];
  var out = null;
  try {
    if (houseMoved_(tab)) {
      var id = houseIdFor_(tab);
      var book = id ? ssOpen_(id) : null;
      // Old tab name first, so houses can be renamed to `Data` one at a time.
      var sheet = book ? (book.getSheetByName(tab) || book.getSheetByName(HOUSE_DATA_TAB)) : null;
      out = sheet || null;
    }
  } catch (e) { out = null; }
  HOUSE_SHEET_MEMO[tab] = out;
  return out;
}
