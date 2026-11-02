/** The catalogue wins for the cells it names; one refused row means nothing is written anywhere. */

// an identity, not content: a typo in a cell would file personal rows under another account
var EX_OWNER_EMAIL = 'asatech@asalifecare.com';

// the removal key: change it and every row already written is orphaned
var EX_PREFIX = 'EX_';

// readers that hide EX_ ids (travelTrips_), named so the verdict can prove the list is exact
var EX_HIDDEN_RESOURCES = ['travelTrips'];

// write order; `parent` catches a price with no item or an attempt with no skill before anything is written
var EX_CATALOGUE = [
  { kind: 'shop_item', tab: 'example_shop_items', resource: 'shopperItems',
    header: ['id', 'name', 'category', 'target_price', 'notes', 'status'] },
  { kind: 'shop_price', tab: 'example_shop_prices', resource: 'shopperPrices',
    header: ['id', 'item_id', 'estimate', 'title'], parent: 'shop_item' },
  { kind: 'skill', tab: 'example_skills', resource: 'learnSkills',
    header: ['id', 'name', 'area', 'description', 'active'] },
  { kind: 'attempt', tab: 'example_attempts', resource: 'learnAttempts',
    header: ['id', 'skill_id', 'at', 'correct', 'helped', 'note'], parent: 'skill' },
  { kind: 'trip', tab: 'example_trips', resource: 'travelTrips',
    header: ['id', 'destination', 'country', 'purpose', 'status', 'start_date',
             'end_date', 'traveller', 'reason', 'outcome', 'budget',
             'actual_cost', 'decided_at'] }
];

/** The honesty label Shopper.gs relies on: no cell may let an example pass for a price lookup. */
var EX_PRICE_SOURCE = 'example';
var EX_PRICE_MODEL = 'loaded example — not a price lookup';

var EX_CATALOGUE_CACHE_KEY = 'examples_catalogue_v1';

function exErr_(e) { return String((e && e.message) || e || 'no reason given'); }

function exCatalogueSheet_(tab) {
  return hubTabSheet_(tab);
}

/** Blank is not zero. */
function exNum_(value) {
  var raw = str_(value);
  if (raw === '') return null;
  var n = Number(raw.replace(/[,$\s]/g, ''));
  return isFinite(n) ? n : null;
}

function exIsDay_(text) { return /^\d{4}-\d{2}-\d{2}$/.test(text); }

function exIsInstant_(text) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text);
}

function exBool_(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  var v = str_(value).toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1') return 'true';
  if (v === 'false' || v === 'no' || v === '0') return 'false';
  return null;
}

function exRowName_(spec, row) {
  var id = str_(row.id);
  if (id) return spec.tab + ' · ' + id;
  var hint = str_(row.name) || str_(row.destination) || str_(row.title) ||
             str_(row.skill_id) || str_(row.item_id);
  return spec.tab + ' · a row with no id' + (hint ? ' (' + hint + ')' : '');
}

function exCleanRow_(spec, row, problems) {
  var where = exRowName_(spec, row);
  var id = str_(row.id);
  var before = problems.length;

  if (!id) {
    problems.push(where + ': the id cell is empty. Every example row is written under its own ' +
                  'id and removed by it — a row without one could never be taken away again.');
    return null;
  }
  if (id.indexOf(EX_PREFIX) !== 0) {
    problems.push(where + ': the id does not start with ' + EX_PREFIX + '. runRemoveExamples ' +
                  'finds the rows by that prefix and nothing else.');
    return null;
  }

  var out = { id: id };
  if (spec.kind === 'shop_item') {
    out.name = str_(row.name);
    out.category = str_(row.category);
    out.status = str_(row.status);
    out.notes = str_(row.notes);
    out.targetPrice = exNum_(row.target_price);
    if (!out.name) problems.push(where + ': name is empty.');
    if (SHOP_CATEGORIES.indexOf(out.category) === -1) {
      problems.push(where + ': category "' + out.category + '" is not one the screen knows. ' +
                    'Use one of: ' + SHOP_CATEGORIES.join(', ') + '.');
    }
    if (SHOP_STATUSES.indexOf(out.status) === -1) {
      problems.push(where + ': status "' + out.status + '" is not one the screen knows. ' +
                    'Use one of: ' + SHOP_STATUSES.join(', ') + '.');
    }
    if (out.targetPrice === null || out.targetPrice < 0) {
      problems.push(where + ': target_price must be a number.');
    }
  } else if (spec.kind === 'shop_price') {
    out.itemId = str_(row.item_id);
    out.title = str_(row.title);
    out.estimate = exNum_(row.estimate);
    if (!out.itemId) problems.push(where + ': item_id is empty — an estimate belongs to an item.');
    if (!out.title) problems.push(where + ': title is empty.');
    if (out.estimate === null || out.estimate <= 0) {
      problems.push(where + ': estimate must be a number above zero.');
    }
  } else if (spec.kind === 'skill') {
    out.name = str_(row.name);
    out.area = str_(row.area);
    out.description = str_(row.description);
    out.active = exBool_(row.active);
    if (!out.name) problems.push(where + ': name is empty.');
    if (!out.area) problems.push(where + ': area is empty.');
    if (out.active === null) problems.push(where + ': active must say true or false.');
  } else if (spec.kind === 'attempt') {
    out.skillId = str_(row.skill_id);
    out.at = str_(row.at);
    out.note = str_(row.note);
    out.correct = exBool_(row.correct);
    out.helped = exBool_(row.helped);
    if (!out.skillId) problems.push(where + ': skill_id is empty — an attempt is at a skill.');
    if (!out.at) problems.push(where + ': at is empty — an attempt happened at a moment.');
    else if (!exIsInstant_(out.at)) {
      problems.push(where + ': at reads "' + out.at + '", which is not a moment the screens can ' +
                    'read. Type an instant, 2026-08-06T14:00:00.000Z — a cell FORMATTED as a ' +
                    'date or a time comes back as whatever the book\'s clock made of it.');
    }
    if (out.correct === null) problems.push(where + ': correct must say true or false.');
    if (out.helped === null) problems.push(where + ': helped must say true or false.');
  } else if (spec.kind === 'trip') {
    out.destination = str_(row.destination);
    out.country = str_(row.country);
    out.purpose = str_(row.purpose);
    out.status = str_(row.status);
    out.startDate = str_(row.start_date);
    out.endDate = str_(row.end_date);
    out.traveller = str_(row.traveller);
    out.reason = str_(row.reason);
    out.outcome = str_(row.outcome);
    out.decidedAt = str_(row.decided_at);
    out.budget = exNum_(row.budget);
    out.actualCost = exNum_(row.actual_cost);
    if (!out.destination) problems.push(where + ': destination is empty.');
    if (TRIP_STATUSES.indexOf(out.status) === -1) {
      problems.push(where + ': status "' + out.status + '" is not one the screen knows. ' +
                    'Use one of: ' + TRIP_STATUSES.join(', ') + '.');
    }
    if (out.budget === null || out.budget < 0) {
      problems.push(where + ': budget must be a number — type 0 where nobody has said.');
    }
    if (out.actualCost === null || out.actualCost < 0) {
      problems.push(where + ': actual_cost must be a number — type 0 where nobody has said.');
    }
    ['startDate', 'endDate'].forEach(function (field) {
      var column = field === 'startDate' ? 'start_date' : 'end_date';
      if (out[field] && !exIsDay_(out[field])) {
        problems.push(where + ': ' + column + ' reads "' + out[field] + '", and a trip date is ' +
                      'YYYY-MM-DD — the same shape the Business Travel screen refuses anything ' +
                      'else in. Type it as text; a cell FORMATTED as a date comes back as an ' +
                      'instant carrying the book\'s clock.');
      }
    });
    if (out.decidedAt && !exIsInstant_(out.decidedAt)) {
      problems.push(where + ': decided_at reads "' + out.decidedAt + '", which is not a moment. ' +
                    'Type an instant, 2026-05-28T15:00:00.000Z, or leave it empty for a trip ' +
                    'nobody has decided.');
    }
  }

  return problems.length === before ? out : null;
}

/** A problem anywhere means the load writes nothing anywhere. */
function exCatalogueBuild_() {
  var out = { kinds: {}, problems: [] };
  var read = {};
  var seen = {};
  var askedAgain = false;

  EX_CATALOGUE.forEach(function (spec) {
    out.kinds[spec.kind] = [];

    var sheet = null;
    try {
      sheet = exCatalogueSheet_(spec.tab);
      if (!sheet) {
        // the router answers from a 300 s depot copy: drop it once before calling a freshly minted house missing
        if (!askedAgain) { askedAgain = true; exDepotAgain_(); }
        sheet = exCatalogueSheet_(spec.tab);
      }
    } catch (eReach) {
      out.problems.push(spec.tab + ': the catalogue house did not answer — ' + exErr_(eReach));
      return;
    }
    if (!sheet) {
      out.problems.push(exWhyNoTab_(spec.tab));
      return;
    }

    // dates read true only in a book pinned to Etc/GMT: cells are read by their UTC components
    var zone = '';
    try { zone = str_(sheet.getParent().getSpreadsheetTimeZone()); } catch (eZone) { zone = ''; }
    if (zone && zone !== 'Etc/GMT') {
      out.problems.push(spec.tab + ': the catalogue book runs on ' + zone + ', and this reader ' +
                        'takes a cell\'s UTC components for the words somebody typed. On any ' +
                        'other clock a date typed by hand arrives hours away — far enough to ' +
                        'move a trip to the day before. tools/mint_examples_house.py pins the ' +
                        'book to Etc/GMT; re-running it is safe.');
      return;
    }

    var header = [], rows = [];
    try {
      header = headerOf_(sheet);
      rows = readAll_(sheet);
    } catch (eRead) {
      out.problems.push(spec.tab + ': the tab is there but could not be read — ' + exErr_(eRead));
      return;
    }

    var missing = spec.header.filter(function (h) { return header.indexOf(h) === -1; });
    if (missing.length) {
      out.problems.push(spec.tab + ': the header is missing ' + missing.join(', ') +
                        ' — this is not the shape the loader reads.');
      return;
    }

    read[spec.kind] = true;
    rows.forEach(function (row) {
      var clean = exCleanRow_(spec, row, out.problems);
      if (!clean) return;
      // keyed by '#' + id: a bare `constructor` or `__proto__` is truthy on any object
      if (Object.prototype.hasOwnProperty.call(seen, '#' + clean.id)) {
        out.problems.push(spec.tab + ' · ' + clean.id + ': that id is used twice. One id is ' +
                          'one row — the second would be skipped without a word.');
        return;
      }
      seen['#' + clean.id] = true;
      out.kinds[spec.kind].push(clean);
    });
  });

  EX_CATALOGUE.forEach(function (spec) {
    if (!spec.parent || !read[spec.kind] || !read[spec.parent]) return;
    var known = {};
    out.kinds[spec.parent].forEach(function (p) { known['#' + p.id] = true; });
    var column = spec.kind === 'shop_price' ? 'item_id' : 'skill_id';
    out.kinds[spec.kind].forEach(function (row) {
      var points = spec.kind === 'shop_price' ? row.itemId : row.skillId;
      if (Object.prototype.hasOwnProperty.call(known, '#' + points)) return;
      out.problems.push(spec.tab + ' · ' + row.id + ': ' + column + ' names "' + points +
                        '", which is not an id in ' + exTabFor_(spec.parent) + '.');
    });
  });

  return out;
}

/** Bypasses the switchboard cache and memo; for admin jobs that mint then read, never a request path. */
function exDepotAgain_() {
  try { switchboardForget_('props'); } catch (eProps) {}
  try { switchboardForget_('moved'); } catch (eMoved) {}
  try {
    if (typeof HOUSE_SHEET_MEMO !== 'undefined' && HOUSE_SHEET_MEMO) {
      for (var tab in HOUSE_SHEET_MEMO) {
        if (Object.prototype.hasOwnProperty.call(HOUSE_SHEET_MEMO, tab)) {
          delete HOUSE_SHEET_MEMO[tab];
        }
      }
    }
  } catch (eMemo) {}
}

function exWhyNoTab_(tab) {
  var pointer = '';
  try { pointer = str_(houseIdFor_(tab)); } catch (ePoint) { pointer = ''; }
  var moved = false;
  try { moved = !!houseMoved_(tab); } catch (eMoved) { moved = false; }

  if (pointer && moved) {
    return tab + ': the depot names a house for this tab (' + pointer + ') and the switch is on, ' +
           'and the book did not answer with the tab. Nothing is loaded until it does — the rows ' +
           'are not gone, the book is not open. Check it opens as the platform account and still ' +
           'carries a tab called ' + tab + '.';
  }
  if (pointer) {
    return tab + ': the depot names a house for this tab (' + pointer + ') but switchboard:moved.' +
           tab + ' does not say on, so nothing ever looks there. ' +
           'tools/mint_examples_house.py writes both, and running it again is safe.';
  }
  return tab + ': no tab of that name answers anywhere, and the depot names no house for it — ' +
         'asked past the 300 s switchboard copy, so this is the depot itself and not a stale ' +
         'picture of it. The catalogue is minted and declared by tools/mint_examples_house.py; ' +
         'until it exists, nothing is loaded.';
}

function exTabFor_(kind) {
  for (var i = 0; i < EX_CATALOGUE.length; i++) {
    if (EX_CATALOGUE[i].kind === kind) return EX_CATALOGUE[i].tab;
  }
  return String(kind || '');
}

// only a clean read is cached: a cached outage would hide the fix for a minute
var EX_CATALOGUE_MEMO = null;

function exCatalogue_() {
  if (EX_CATALOGUE_MEMO) return EX_CATALOGUE_MEMO;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (eCache) { cache = null; }
  if (cache) {
    var hit = null;
    try { hit = cache.get(EX_CATALOGUE_CACHE_KEY); } catch (eGet) { hit = null; }
    if (hit) {
      try { EX_CATALOGUE_MEMO = JSON.parse(hit); return EX_CATALOGUE_MEMO; }
      catch (eParse) {}
    }
  }
  var built = exCatalogueBuild_();
  if (cache && !built.problems.length) {
    try { cache.put(EX_CATALOGUE_CACHE_KEY, JSON.stringify(built), 60); }
    catch (ePut) {}
  }
  EX_CATALOGUE_MEMO = built;
  return built;
}

function exCatalogueBump_() {
  EX_CATALOGUE_MEMO = null;
  try { CacheService.getScriptCache().remove(EX_CATALOGUE_CACHE_KEY); }
  catch (e) {}
}

function exOwnerId_() {
  var users = usersAll_();
  for (var i = 0; i < users.length; i++) {
    if (str_(users[i].email).toLowerCase() === EX_OWNER_EMAIL) return str_(users[i].userid);
  }
  return '';
}

/** The sheet itself, never listRows_'s cache: appends and deletes are decided from it. Throws when unreadable. */
function exDestinationRows_(resource) {
  return readAll_(sheetFor_(resource));
}

function exSameValue_(a, b) {
  var left = (a === null || a === undefined) ? '' : a;
  var right = (b === null || b === undefined) ? '' : b;
  if (typeof left === 'number' || typeof right === 'number') {
    var nl = Number(left), nr = Number(right);
    if (isFinite(nl) && isFinite(nr) && String(left).trim() !== '' && String(right).trim() !== '') {
      return nl === nr;
    }
  }
  return String(left) === String(right);
}

/** `untouched` fields are neither compared nor rewritten; createRow_/updateRowById_ error envelopes count as refusals. */
function exWrite_(resource, records, report, trouble, untouched) {
  var keep = untouched || [];
  var have = {};
  try {
    exDestinationRows_(resource).forEach(function (row) {
      var id = str_(row.id);
      if (id) have['#' + id] = row;
    });
  } catch (eRead) {
    report.push(resource + ': NOT WRITTEN — the destination could not be read');
    trouble.push(resource + ': the destination could not be read — ' + exErr_(eRead) +
                 '. None of its ' + records.length + ' rows were written.');
    return;
  }

  var wrote = 0, updated = 0, same = 0;
  records.forEach(function (rec) {
    var old = Object.prototype.hasOwnProperty.call(have, '#' + rec.id) ? have['#' + rec.id] : null;
    if (!old) {
      var made = createRow_(resource, rec);
      if (made && made.error) {
        trouble.push(resource + ' · ' + rec.id + ': ' + str_(made.error.message));
        return;
      }
      wrote++;
      return;
    }

    var patch = { id: rec.id };
    var changed = [];
    Object.keys(rec).forEach(function (field) {
      if (field === 'id' || keep.indexOf(field) !== -1) return;
      if (exSameValue_(old[field], rec[field])) return;
      changed.push(field);
      patch[field] = rec[field];
    });
    if (!changed.length) { same++; return; }

    var done = updateRowById_(resource, patch);
    if (done && done.error) {
      trouble.push(resource + ' · ' + rec.id + ': ' + str_(done.error.message));
      return;
    }
    updated++;
  });

  report.push(resource + ': ' + wrote + ' written, ' + updated + ' updated, ' + same + ' unchanged');
}

function runLoadExamples() {
  var owner = exOwnerId_();
  if (!owner) {
    throw new Error(EX_OWNER_EMAIL + ' is not in the users tab — refusing to write ' +
                    'personal rows that would belong to nobody.');
  }

  // the tabs as they stand: a minute-old copy would load what was just changed away
  exCatalogueBump_();
  var catalogue = exCatalogue_();
  if (catalogue.problems.length) {
    var why = 'The examples catalogue was refused — NOTHING was written:\n  · ' +
              catalogue.problems.join('\n  · ');
    Logger.log(why);
    throw new Error(why);
  }

  var report = [];
  var trouble = [];

  exWrite_('shopperItems', catalogue.kinds.shop_item.map(function (i) {
    return { id: i.id, ownerId: owner, name: i.name, category: i.category,
             targetPrice: i.targetPrice, notes: i.notes, status: i.status };
  }), report, trouble);

  // foundAt is stamped at write time; comparing it would update every price on every run
  exWrite_('shopperPrices', catalogue.kinds.shop_price.map(function (p) {
    return { id: p.id, ownerId: owner, itemId: p.itemId, estimate: p.estimate, title: p.title,
             source: EX_PRICE_SOURCE, model: EX_PRICE_MODEL,
             foundAt: new Date().toISOString() };
  }), report, trouble, ['foundAt']);

  exWrite_('learnSkills', catalogue.kinds.skill.map(function (s) {
    return { id: s.id, name: s.name, area: s.area, description: s.description, active: s.active };
  }), report, trouble);

  exWrite_('learnAttempts', catalogue.kinds.attempt.map(function (a) {
    return { id: a.id, ownerId: owner, skillId: a.skillId, at: a.at,
             correct: a.correct, helped: a.helped, note: a.note };
  }), report, trouble);

  exWrite_('travelTrips', catalogue.kinds.trip.map(function (t) {
    return { id: t.id, destination: t.destination, country: t.country, purpose: t.purpose,
             status: t.status, startDate: t.startDate, endDate: t.endDate,
             traveller: t.traveller, requestedBy: EX_OWNER_EMAIL, reason: t.reason,
             outcome: t.outcome, budget: t.budget, actualCost: t.actualCost,
             decidedBy: t.decidedAt ? EX_OWNER_EMAIL : '', decidedAt: t.decidedAt };
  }), report, trouble);

  Logger.log(report.join('\n'));
  if (trouble.length) {
    var refusedWhy = 'The examples load ended with rows the platform refused:\n  · ' +
                     trouble.join('\n  · ') + '\n\nWhat DID land:\n  · ' + report.join('\n  · ');
    Logger.log(refusedWhy);
    throw new Error(refusedWhy);
  }
  return report;
}

/** Never reads the catalogue, so a deleted house cannot strand rows; a refusal is not a removal. */
function runRemoveExamples() {
  var resources = ['shopperPrices', 'shopperItems', 'learnAttempts', 'learnSkills', 'travelTrips'];
  var report = [];
  var trouble = [];

  resources.forEach(function (resource) {
    var rows = null;
    try { rows = exDestinationRows_(resource); }
    catch (eRead) {
      report.push(resource + ': NOT READ — nothing was removed from it');
      trouble.push(resource + ': the rows could not be read — ' + exErr_(eRead) +
                   '. Whatever it holds is still there.');
      return;
    }

    var gone = 0, refused = [];
    rows.forEach(function (r) {
      var id = str_(r.id);
      if (id.indexOf(EX_PREFIX) !== 0) return;
      var done = null;
      try { done = deleteRowById_(resource, id); }
      catch (eDel) { refused.push(id + ': ' + exErr_(eDel)); return; }
      if (done && done.error) { refused.push(id + ': ' + str_(done.error.message)); return; }
      gone++;
    });

    report.push(resource + ': ' + gone + ' removed' +
                (refused.length ? ', ' + refused.length + ' the tab would not delete' : ''));
    refused.forEach(function (line) { trouble.push(resource + ' · ' + line); });
  });

  Logger.log(report.join('\n'));
  if (trouble.length) {
    var why = 'The examples removal left rows behind:\n  · ' + trouble.join('\n  · ') +
              '\n\nWhat DID go:\n  · ' + report.join('\n  · ') +
              '\n\nRunning it again is safe — it takes away whatever is still there.';
    Logger.log(why);
    throw new Error(why);
  }
  return report;
}
