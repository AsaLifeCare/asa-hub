var LANE_MIRRORS = {
  uiIncidents:  { prop: 'HUB_HOUSE_UIINCIDENTS_ID',  keep: 100 },
  supportQueue: { prop: 'HUB_HOUSE_SUPPORTQUEUE_ID', keep: 500 },
  dailyNotes:   { prop: 'HUB_HOUSE_DAILYNOTES_ID',   keep: 500 },
  cloneCallOffs: { prop: 'HUB_HOUSE_CLONECALLOFFS_ID', keep: 1000,
                   source: { prop: 'ESTATE_CALLOFFS_ID', tab: 'Master' } }
};

// The relay reads a house from this tab and no other.
var LANE_MIRROR_TAB = 'Data';

var LANE_MIRROR_EVERY_S = 600;

// Once per execution per resource, so a filing pass that writes twice rewrites once.
var LANE_MIRROR_DONE = {};

// setValues() executes a string leading with = + - or @, so text cells are stored as text: a copy never computes.
function laneMirrorSafeRows_(rows) {
  if (typeof hubCellSafe_ !== 'function') return rows;
  for (var r = 0; r < rows.length; r++) {
    var line = rows[r];
    if (!line) continue;
    for (var c = 0; c < line.length; c++) {
      if (typeof line[c] === 'string') line[c] = hubCellSafe_(line[c]);
    }
  }
  return rows;
}

// Never throws: a screen's convenience may not cost a filing.
function laneMirrorOne_(resource) {
  var out = { resource: String(resource || ''), rows: 0, state: 'skipped', why: '' };
  var spec = LANE_MIRRORS[out.resource];
  if (!spec) { out.why = 'no mirror is declared for this resource'; return out; }
  if (LANE_MIRROR_DONE[out.resource]) { out.state = 'already'; return out; }

  var src = null;
  if (spec.source && spec.source.prop) {
    // A clone names its own source; an estate-map entry for it would put that book back in front of a screen.
    try {
      src = { id: String(hubId_(spec.source.prop) || ''), tab: String(spec.source.tab || ''),
              prop: spec.source.prop };
    } catch (eOwn) { src = null; }
  } else {
    try { src = (typeof estateSource_ === 'function') ? estateSource_(out.resource) : null; }
    catch (eS) { src = null; }
  }
  if (!src || !src.id) { out.why = 'the estate source for this resource is not declared'; return out; }

  var houseId = '';
  try { houseId = String(hubId_(spec.prop) || ''); } catch (eH) { houseId = ''; }
  if (!houseId) { out.why = spec.prop + ' is not in the depot — the house is not declared'; return out; }

  var values = null;
  try {
    var from = ssOpen_(src.id).getSheetByName(src.tab);
    if (!from) { out.why = 'the estate book has no tab called "' + src.tab + '"'; return out; }
    values = from.getDataRange().getValues();
  } catch (eR) {
    out.state = 'unread';
    out.why = 'the estate book could not be read: ' + String((eR && eR.message) || eR);
    return out;
  }
  if (!values || values.length < 2) {
    // Never copy an emptiness: a header-only source leaves the standing mirror untouched.
    out.state = 'empty_source';
    out.why = 'the estate book answered with no rows — the house was left as it stands';
    return out;
  }

  var header = values[0];
  var body = values.slice(1);
  var kept = body.length > spec.keep ? body.slice(body.length - spec.keep) : body;

  try {
    var house = ssOpen_(houseId);
    var dest = house.getSheetByName(LANE_MIRROR_TAB);
    if (!dest) {
      // A missing Data tab is reported, never created here: shaping a house is the mint's job.
      out.state = 'no_house_tab';
      out.why = 'the house has no "' + LANE_MIRROR_TAB + '" tab — mint it before it can be mirrored';
      return out;
    }
    var need = kept.length + 1;
    if (dest.getMaxRows() < need) dest.insertRowsAfter(dest.getMaxRows(), need - dest.getMaxRows());
    if (dest.getMaxColumns() < header.length) {
      dest.insertColumnsAfter(dest.getMaxColumns(), header.length - dest.getMaxColumns());
    }
    // Rewritten whole every pass: the estate books carry no key this side can trust for appending.
    dest.clearContents();
    dest.getRange(1, 1, 1, header.length).setValues(laneMirrorSafeRows_([header]));
    if (kept.length) dest.getRange(2, 1, kept.length, header.length).setValues(laneMirrorSafeRows_(kept));
    dest.setFrozenRows(1);
    out.rows = kept.length;
    out.state = 'mirrored';
    out.why = (body.length > kept.length)
      ? ('the newest ' + kept.length + ' of ' + body.length + ' rows')
      : (kept.length + ' row(s), the whole book');
  } catch (eW) {
    out.state = 'unwritten';
    out.why = 'the house could not be written: ' + String((eW && eW.message) || eW);
    return out;
  }

  LANE_MIRROR_DONE[out.resource] = true;
  try {
    hubSysLog_('asa-hub:lanemirror', 'lane_mirrored',
               out.resource + ': ' + out.why, { status: 200 });
  } catch (eL) { /* the answer is the caller's copy */ }
  return out;
}

// The houses are kept by Python (app/lane_mirror*.py): after a filing and on the relay's clock.
function laneMirrorAfterFiling_(resources) {
  return [];
}

function laneMirrorSweepMaybe_() {
  return { skipped: 'python' };
}

// Only Apps Script owns the houses and can share them, so the relay's grant runs from the editor after minting.
var LANE_MIRROR_READERS = ['living-brain@asalifecare-jarvis.iam.gserviceaccount.com'];

function runShareLaneHouses() {
  var out = [];
  for (var resource in LANE_MIRRORS) {
    if (!LANE_MIRRORS.hasOwnProperty(resource)) continue;
    var line = { resource: resource, id: '', shared: [], why: '' };
    try {
      line.id = String(hubId_(LANE_MIRRORS[resource].prop) || '');
      if (!line.id) { line.why = 'the house is not declared in the depot'; out.push(line); continue; }
      var file = DriveApp.getFileById(line.id);
      LANE_MIRROR_READERS.forEach(function (who) {
        try {
          file.addEditor(who);
          line.shared.push(who);
        } catch (eOne) {
          line.why += (line.why ? ' · ' : '') + who + ': ' + String((eOne && eOne.message) || eOne);
        }
      });
    } catch (e) {
      line.why = String((e && e.message) || e);
    }
    out.push(line);
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function runLaneMirrorNow() {
  LANE_MIRROR_DONE = {};
  var out = [];
  for (var resource in LANE_MIRRORS) {
    if (LANE_MIRRORS.hasOwnProperty(resource)) out.push(laneMirrorOne_(resource));
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
