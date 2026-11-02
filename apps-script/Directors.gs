// Stored as: focus_areas " | "-separated; bio JSON array of paragraphs; career JSON array of {time,text,tint}.
var DIRECTORS_TAB = 'directors';
var DIRECTORS_CACHE_KEY = 'hub_directors_v1';

var DIRECTOR_BIO_LABELS = ['Background', 'Leadership', 'Today'];
var DIRECTOR_BIO_TINTS = ['lavender', 'blue', 'mint'];

function directorsSheet_() {
  var sheet = ssOpen_(hubId_('HUB_DIRECTORY_ID')).getSheetByName(DIRECTORS_TAB);
  if (!sheet) throw new Error('Directory tab missing: ' + DIRECTORS_TAB);
  return sheet;
}

function directorsBustCache_() {
  try { CacheService.getScriptCache().remove(DIRECTORS_CACHE_KEY); } catch (e) {}
}

function directorPublic_(u) {
  var bio = [];
  try { bio = JSON.parse(str_(u.bio) || '[]'); } catch (e) { bio = str_(u.bio) ? [str_(u.bio)] : []; }
  if (!Array.isArray(bio)) bio = [String(bio)];
  var career = [];
  try { career = JSON.parse(str_(u.career) || '[]'); } catch (e) { career = []; }
  if (!Array.isArray(career)) career = [];
  var avatar = str_(u.avatar);
  return {
    id: str_(u.id), name: str_(u.name), title: str_(u.title),
    avatar: avatar, photo: avatar,
    email: str_(u.email), phone: str_(u.phone), office: str_(u.office),
    status: str_(u.status) || 'active',
    tenure: str_(u.tenure), tenureYears: Number(u.tenureyears) || 0,
    focusAreas: str_(u.focusareas).split('|').map(function (s) { return s.trim(); }).filter(Boolean),
    bio: bio,
    bioEntries: bio.map(function (text, i) {
      return { time: DIRECTOR_BIO_LABELS[i] || ('Part ' + (i + 1)), text: String(text),
               tint: DIRECTOR_BIO_TINTS[i % DIRECTOR_BIO_TINTS.length] };
    }),
    career: career,
    directReports: Number(u.directreports) || 0,
    housesOverseen: Number(u.housesoverseen) || 0
  };
}

function directorsAll_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(DIRECTORS_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var rows = readTabNormalized_(ssOpen_(hubId_('HUB_DIRECTORY_ID')), DIRECTORS_TAB)
    .map(directorPublic_)
    .filter(function (d) { return d.id && d.name; });
  try { cache.put(DIRECTORS_CACHE_KEY, JSON.stringify(rows), 60); } catch (e) { /* row set too big for cache — fine */ }
  return rows;
}

function directorFields_(payload) {
  var f = {};
  if (payload.name !== undefined) f.name = str_(payload.name);
  if (payload.title !== undefined) f.title = str_(payload.title);
  var av = payload.avatar !== undefined ? payload.avatar : payload.photo;
  if (av !== undefined) f.avatar = str_(av).slice(0, 500);
  if (payload.email !== undefined) f.email = str_(payload.email);
  if (payload.phone !== undefined) f.phone = str_(payload.phone);
  if (payload.office !== undefined) f.office = str_(payload.office);
  if (payload.status !== undefined) f.status = str_(payload.status) || 'active';
  if (payload.tenure !== undefined) f.tenure = str_(payload.tenure);
  if (payload.tenureYears !== undefined) f.tenure_years = Number(payload.tenureYears) || 0;
  if (payload.focusAreas !== undefined) {
    var fa = payload.focusAreas;
    if (typeof fa === 'string') fa = fa.split(/[|,]/);
    f.focus_areas = (fa || []).map(function (s) { return str_(s).trim(); }).filter(Boolean).join(' | ');
  }
  if (payload.bio !== undefined) {
    var bio = payload.bio;
    if (typeof bio === 'string') {
      bio = bio.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    f.bio = JSON.stringify(Array.isArray(bio) ? bio : []);
  }
  if (payload.career !== undefined) f.career = JSON.stringify(Array.isArray(payload.career) ? payload.career : []);
  if (payload.directReports !== undefined) f.direct_reports = Number(payload.directReports) || 0;
  if (payload.housesOverseen !== undefined) f.houses_overseen = Number(payload.housesOverseen) || 0;
  return f;
}

function directorFindRow_(sheet, id) {
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(normKey_);
  var iId = hdr.indexOf('id');
  for (var r = 1; r < values.length; r++) {
    if (str_(values[r][iId]) === str_(id)) return { rowIndex: r + 1, hdr: hdr };
  }
  return null;
}

function directorById_(id) {
  var all = directorsAll_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === str_(id)) return all[i];
  }
  return null;
}

// Must match the SPA's people.edit gate.
function directorsCanWrite_(user) {
  if (!user) return false;
  var ov = user.overrides || {};
  if (ov['people.edit'] === true) return true;
  if (ov['people.edit'] === false) return false;
  return ['admin', 'manager'].indexOf(str_(user.role)) !== -1;
}

function directorsRoute_(action, payload, user) {
  payload = payload || {};
  switch (action) {
    case 'list':
      return { status: 200, data: directorsAll_() };

    case 'get': {
      var d = directorById_(payload.id);
      return d ? { status: 200, data: d }
               : { status: 404, message: 'No director "' + str_(payload.id) + '".' };
    }

    case 'create': {
      if (!directorsCanWrite_(user)) {
        return { status: 403, message: 'Directors can only be edited by admins and managers.' };
      }
      var fields = directorFields_(payload);
      if (!fields.name) return { status: 400, message: 'Name is required.' };
      var sheet = directorsSheet_();
      var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normKey_);
      var now = new Date().toISOString();
      var id = 'dir-' + randomHex_(6);
      var byKey = { id: id, status: fields.status || 'active',
                    created_at: now, updated_at: now, updated_by: 'asa-hub:' + user.email };
      for (var k in fields) byKey[k] = fields[k];
      var row = hdr.map(function (h) {
        for (var key in byKey) { if (normKey_(key) === h) return byKey[key]; }
        return '';
      });
      sheet.appendRow(row);
      directorsBustCache_();
      return { status: 200, data: directorById_(id) };
    }

    case 'update': {
      if (!directorsCanWrite_(user)) {
        return { status: 403, message: 'Directors can only be edited by admins and managers.' };
      }
      var sheet2 = directorsSheet_();
      var hit = directorFindRow_(sheet2, payload.id);
      if (!hit) return { status: 404, message: 'No director "' + str_(payload.id) + '".' };
      var fields2 = directorFields_(payload);
      fields2.updated_at = new Date().toISOString();
      fields2.updated_by = 'asa-hub:' + user.email;
      for (var k2 in fields2) {
        var i = hit.hdr.indexOf(normKey_(k2));
        if (i !== -1) sheet2.getRange(hit.rowIndex, i + 1).setValue(fields2[k2]);
      }
      directorsBustCache_();
      return { status: 200, data: directorById_(payload.id) };
    }

    case 'delete': {
      if (!directorsCanWrite_(user)) {
        return { status: 403, message: 'Directors can only be edited by admins and managers.' };
      }
      var sheet3 = directorsSheet_();
      var hit3 = directorFindRow_(sheet3, payload.id);
      if (!hit3) return { status: 404, message: 'No director "' + str_(payload.id) + '".' };
      sheet3.deleteRow(hit3.rowIndex);
      directorsBustCache_();
      return { status: 200, data: { id: str_(payload.id), deleted: true } };
    }

    default:
      return { status: 400, message: 'Unknown action: "' + action + '". ' +
        'Valid actions: list, get, create, update, delete.' };
  }
}
