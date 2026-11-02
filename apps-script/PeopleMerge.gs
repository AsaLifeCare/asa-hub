// A merge is a lens written in people_types; the mirrored `people` tab is never edited.

var PEOPLE_TYPES_TAB = 'people_types';
var PEOPLE_MERGE_CACHE_KEY = 'people_merge_map_v1';

function peopleMergeDecided_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'merge' || s === 'merged' || s === 'same' || s === 'duplicate';
}

function peopleMergeMap_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(PEOPLE_MERGE_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {}

  var map = {};
  try {
    var sheet = hubTabSheet_(PEOPLE_TYPES_TAB);
    if (sheet) {
      var values = sheet.getDataRange().getValues();
      var hdr = values[0].map(function (h) { return String(h).trim(); });
      var iId = hdr.indexOf('person_id');
      var iDup = hdr.indexOf('duplicate_of');
      var iDec = hdr.indexOf('decision');
      if (iId !== -1 && iDup !== -1 && iDec !== -1) {
        for (var r = 1; r < values.length; r++) {
          if (!peopleMergeDecided_(values[r][iDec])) continue;
          var alias = String(values[r][iId] || '').trim();
          // duplicate_of reads "Name (PPL_id)"; only the bracketed id is trusted.
          var m = String(values[r][iDup] || '').match(/\(([^)]+)\)\s*$/);
          var primary = m ? m[1].trim() : '';
          if (alias && primary && alias !== primary) map[alias] = primary;
        }
      }
    }
  } catch (e) {
    return {};
  }

  // A→B plus B→A keeps one direction, or folding each into the other shows neither.
  Object.keys(map).forEach(function (alias) {
    var target = map[alias];
    if (map[target] === alias) {
      if (String(alias) < String(target)) delete map[alias];
      else delete map[target];
    }
  });

  // Follow chains to the kept record, bounded so a decision cycle cannot loop forever.
  Object.keys(map).forEach(function (alias) {
    var seenIds = {}, target = map[alias], hops = 0;
    while (map[target] && !seenIds[target] && hops++ < 5) {
      seenIds[target] = true;
      target = map[target];
    }
    map[alias] = target;
  });

  try { cache.put(PEOPLE_MERGE_CACHE_KEY, JSON.stringify(map), 300); } catch (e2) {}
  return map;
}

function peoplePhoneKey_(v) {
  var digits = String(v == null ? '' : v).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function peopleCollect_(target, field, value, seenKey) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return;
  var list = target[field] || [];
  var key = seenKey ? seenKey(raw) : raw.toLowerCase();
  if (!key) return;
  for (var i = 0; i < list.length; i++) {
    if ((seenKey ? seenKey(list[i]) : String(list[i]).toLowerCase()) === key) return;
  }
  list.push(raw);
  target[field] = list;
}

function peopleMerged_(rows) {
  var map = peopleMergeMap_();
  if (!rows || !rows.length) return rows;
  var aliases = Object.keys(map);
  if (!aliases.length) return rows;

  var byId = {};
  rows.forEach(function (row) { if (row && row.id) byId[String(row.id)] = row; });

  var out = [];
  rows.forEach(function (row) {
    var id = String((row && row.id) || '');
    var primaryId = map[id];
    if (!primaryId) { out.push(row); return; }
    var primary = byId[primaryId];
    if (!primary) { out.push(row); return; }
    primary.merged_from = (primary.merged_from ? primary.merged_from + '; ' : '') +
                          (row.name || id) + ' (' + id + ')';
    peopleCollect_(primary, 'phones', primary.phone, peoplePhoneKey_);
    peopleCollect_(primary, 'emails', primary.email);
    peopleCollect_(primary, 'phones', row.phone, peoplePhoneKey_);
    peopleCollect_(primary, 'emails', row.email);
    peopleCollect_(primary, 'also_known_as', row.name);
  });
  return out;
}

function debugPeopleMerges() {
  var map = peopleMergeMap_();
  var n = Object.keys(map).length;
  Logger.log(n ? JSON.stringify(map, null, 2) : 'nothing merged — no signed decisions in ' + PEOPLE_TYPES_TAB);
  return map;
}

function peopleTypeOf_(role) {
  var s = String(role || '').toLowerCase();
  if (!s) return '';
  if (s.indexOf('dsp') !== -1 || s.indexOf('direct support') !== -1) return 'DSP';
  if (s.indexOf('client') !== -1) return 'Client';
  return 'Staff';
}

function peopleMergePending_() {
  var sheet = hubTabSheet_(PEOPLE_TYPES_TAB);
  if (!sheet) return { error: { status: 404, message: 'No ' + PEOPLE_TYPES_TAB + ' tab.' } };
  var values = sheet.getDataRange().getValues();
  var hdr = values[0].map(function (h) { return String(h).trim(); });
  var col = {
    id: hdr.indexOf('person_id'), dup: hdr.indexOf('duplicate_of'),
    dec: hdr.indexOf('decision'), score: hdr.indexOf('duplicate_score'),
    email: hdr.indexOf('email'), by: hdr.indexOf('decided_by'), at: hdr.indexOf('decided_at')
  };
  if (col.id === -1 || col.dup === -1 || col.dec === -1) {
    return { error: { status: 400, message: PEOPLE_TYPES_TAB + ' is missing person_id/duplicate_of/decision.' } };
  }
  var out = [];
  var rowById = {}, takenAlias = {}, dupTarget = {}, byAliasIdx = {};
  for (var r = 1; r < values.length; r++) {
    var pid = String(values[r][col.id] || '').trim();
    if (pid && rowById[pid] === undefined) rowById[pid] = r + 1;
    var dup = String(values[r][col.dup] || '').trim();
    var dec = String(values[r][col.dec] || '').trim();
    if (!dup) continue;
    takenAlias[pid] = true;
    var m = dup.match(/\(([^)]+)\)\s*$/);
    var target = m ? m[1].trim() : '';
    if (target) dupTarget[pid] = target;
    if (dec) continue;
    var entry = {
      row: r + 1,
      alias_id: pid,
      primary_id: target,
      types_email: col.email === -1 ? '' : String(values[r][col.email] || '').trim(),
      score: col.score === -1 ? '' : String(values[r][col.score] || '').trim()
    };
    // The types pass appends a row per fingerprint change: keep only the newest per alias.
    if (byAliasIdx[pid] !== undefined) out[byAliasIdx[pid]] = entry;
    else { byAliasIdx[pid] = out.length; out.push(entry); }
  }
  return { sheet: sheet, col: col, pending: out, rowById: rowById, takenAlias: takenAlias, dupTarget: dupTarget };
}

function peopleSystemIdentity_() {
  var names = {}, emails = {};
  try {
    directorsAll_().forEach(function (d) {
      var n = String(d.name || d.displayname || '').trim().toLowerCase();
      if (n) names[n] = true;
    });
  } catch (e) {}
  try {
    usersAll_().forEach(function (u) {
      var role = str_(u.role).toLowerCase();
      if (role === 'staff' || role === 'client') return;
      var n = str_(u.displayname).trim().toLowerCase();
      if (n) names[n] = true;
      var em = str_(u.email).trim().toLowerCase();
      if (em) emails[em] = true;
    });
  } catch (e2) {}
  return { names: names, emails: emails };
}

function peopleNameKey_(v) {
  return String(v || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function peopleIsSystem_(identity, pairNames, pairEmails, roles) {
  for (var i = 0; i < roles.length; i++) {
    if (String(roles[i] || '').toLowerCase() === 'entity') return true;
  }
  for (var j = 0; j < pairEmails.length; j++) {
    var em = String(pairEmails[j] || '').trim().toLowerCase();
    if (em && identity.emails[em]) return true;
  }
  var sysNames = Object.keys(identity.names);
  for (var k = 0; k < pairNames.length; k++) {
    // Must be the collision key, or the apostrophe variants slip past the system door.
    var name = peopleFoldKey_(pairNames[k]);
    if (!name) continue;
    for (var s = 0; s < sysNames.length; s++) {
      var sys = peopleFoldKey_(sysNames[s]);
      if (sys && (name === sys || name.indexOf(sys) === 0 || sys.indexOf(name) === 0)) return true;
    }
  }
  return false;
}

function peopleFoldKey_(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function peopleRichness_(row) {
  var score = 0;
  ['email', 'phone', 'role', 'first_name', 'avatar', 'start_date'].forEach(function (f) {
    if (String(row[f] || '').trim()) score++;
  });
  if (String(row.status || '').toLowerCase() === 'active') score += 2;
  return score;
}

function peoplePairInfo_(alias, primary, extra, identity) {
  var have = {};
  have[String(primary.email || '').toLowerCase()] = true;
  var addEmails = [];
  [alias.email, extra.types_email].forEach(function (e) {
    var k = String(e || '').trim().toLowerCase();
    if (k && !have[k]) { have[k] = true; addEmails.push(String(e).trim()); }
  });
  var addPhones = [];
  if (peoplePhoneKey_(alias.phone) &&
      peoplePhoneKey_(alias.phone) !== peoplePhoneKey_(primary.phone)) {
    addPhones.push(String(alias.phone).trim());
  }
  // The sign-in email is only ever the survivor's own.
  var email = String(primary.email || '').trim();
  var aliasEmail = String(alias.email || '').trim().toLowerCase();
  var primaryEmail = email.toLowerCase();
  // Differing emails or phones suggest two humans: the pair is never pre-checked.
  var conflict = Boolean(
    (aliasEmail && primaryEmail && aliasEmail !== primaryEmail) ||
    (peoplePhoneKey_(alias.phone) && peoplePhoneKey_(primary.phone) &&
     peoplePhoneKey_(alias.phone) !== peoplePhoneKey_(primary.phone))
  );
  return {
    alias_id: String(alias.id), alias_name: String(alias.name || alias.id),
    primary_id: String(primary.id), primary_name: String(primary.name || primary.id),
    add_emails: addEmails, add_phones: addPhones,
    person_type: peopleTypeOf_(primary.role) || peopleTypeOf_(alias.role),
    system: peopleIsSystem_(identity,
      [alias.name, primary.name], [alias.email, primary.email, extra.types_email],
      [alias.role, primary.role]),
    detected: Boolean(extra.detected),
    conflict: conflict,
    score: extra.score || '',
    user_email: email,
    already_user: email ? Boolean(userByEmail_(primaryEmail)) : false
  };
}

// Different names sharing a line are never folded automatically; company lines identify nobody.
function peopleSharedGroups_(people, takenAlias) {
  var lines = (typeof SHARED_LINE_DIGITS !== 'undefined') ? SHARED_LINE_DIGITS : [];
  var byEmail = {}, byPhone = {};
  people.forEach(function (p) {
    if (!p || !p.id || takenAlias[String(p.id)]) return;
    var em = String(p.email || '').trim().toLowerCase();
    if (em) (byEmail[em] = byEmail[em] || []).push(p);
    var ph = peoplePhoneKey_(p.phone);
    if (ph.length === 10 && lines.indexOf(ph) === -1) (byPhone[ph] = byPhone[ph] || []).push(p);
  });
  var shared = [];
  [[byEmail, 'email'], [byPhone, 'phone']].forEach(function (idx) {
    Object.keys(idx[0]).forEach(function (k) {
      var group = idx[0][k];
      if (group.length < 2) return;
      var keys = {};
      group.forEach(function (p) { keys[peopleFoldKey_(p.name)] = true; });
      if (Object.keys(keys).length < 2) return;
      shared.push({
        via: idx[1], value: k,
        people: group.map(function (p) { return { id: String(p.id), name: String(p.name || p.id) }; })
      });
    });
  });
  return shared;
}

/** Preview every fold an admin could sign: suggested pairs, detected pairs and shared lines; nothing is written. */
HUB_POLICY.peopleMergePreview = {
  file: 'PeopleMerge.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.peopleMergePreview = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var src = peopleMergePending_();
  if (src.error) return src.error;
  var scope = String((payload && payload.scope) || '');
  var identity = peopleSystemIdentity_();

  var people = listRows_('people', {});          // raw: the lens must not hide the rows being judged
  var byId = {};
  people.forEach(function (p) { if (p && p.id) byId[String(p.id)] = p; });

  var pairs = [];
  src.pending.forEach(function (s) {
    var alias = byId[s.alias_id], primary = byId[s.primary_id];
    if (!alias || !primary) return;
    var pair = peoplePairInfo_(alias, primary, s, identity);
    if (scope === 'system' && !pair.system) return;
    pairs.push(pair);
  });

  var keyIdx = {};
  people.forEach(function (p) {
    if (!p || !p.id || src.takenAlias[String(p.id)]) return;
    var k = peopleFoldKey_(p.name);
    if (!k) return;
    (keyIdx[k] = keyIdx[k] || []).push(p);
  });
  Object.keys(keyIdx).forEach(function (k) {
    var group = keyIdx[k];
    if (group.length < 2) return;
    group.sort(function (a, b) {
      var d = peopleRichness_(b) - peopleRichness_(a);
      return d !== 0 ? d : (String(a.id) < String(b.id) ? -1 : 1);
    });
    var primary = group[0];
    group.slice(1).forEach(function (alias) {
      var pair = peoplePairInfo_(alias, primary, { detected: true }, identity);
      if (scope === 'system' && !pair.system) return;
      pairs.push(pair);
    });
  });

  var shared = peopleSharedGroups_(people, src.takenAlias);
  if (scope === 'system') {
    shared = shared.filter(function (g) {
      for (var i = 0; i < g.people.length; i++) {
        if (peopleIsSystem_(identity, [g.people[i].name], [], [])) return true;
      }
      return false;
    });
  }
  return { status: 200, data: { pairs: pairs, shared: shared } };
};

/** Sign the confirmed folds, then mint a Users row per survivor; admin only, serialised by a script lock. */
HUB_POLICY.peopleMergeApply = {
  file: 'PeopleMerge.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin'],
  invalidates: ['people'], emits: []
};
HUB_ACTIONS.peopleMergeApply = function (payload, user) {
  if (!user || user.role !== 'admin') return hubDenied_();
  var suggested = (payload && (payload.suggested || payload.alias_ids)) || [];
  var detected = (payload && payload.detected) || [];
  var households = (payload && payload.households) || [];
  if (!Array.isArray(suggested)) suggested = [];
  if (!Array.isArray(detected)) detected = [];
  if (!Array.isArray(households)) households = [];
  if (!suggested.length && !detected.length && !households.length) {
    return { status: 400, message: 'suggested, detected and/or households: which folds to sign.' };
  }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) {
    return { status: 503, message: 'Another merge is being applied — try again.' };
  }
  try {
    var src = peopleMergePending_();
    if (src.error) return src.error;
    var byAlias = {};
    src.pending.forEach(function (s) { byAlias[s.alias_id] = s; });

    var people = listRows_('people', {});
    var byId = {};
    people.forEach(function (p) { if (p && p.id) byId[String(p.id)] = p; });

    // Every fold is re-derived here; one whose reverse is already recorded is refused.
    var now = new Date().toISOString();
    var signed = [], refused = [];
    var signCells = function (rowNum) {
      src.sheet.getRange(rowNum, src.col.dec + 1).setValue('merge');
      if (src.col.by !== -1) src.sheet.getRange(rowNum, src.col.by + 1).setValue(String(user.email || 'admin'));
      if (src.col.at !== -1) src.sheet.getRange(rowNum, src.col.at + 1).setValue(now);
    };
    suggested.forEach(function (d) {
      var aliasId = String((d && d.alias_id) || d || '');
      var sentPrimary = String((d && d.primary_id) || '');
      var s = byAlias[aliasId];
      if (!s) return;
      if (sentPrimary && s.primary_id !== sentPrimary) {
        refused.push(aliasId + ' (the suggestion changed while the modal was open)');
        return;
      }
      if (src.dupTarget[s.primary_id] === s.alias_id) {
        refused.push(aliasId + ' (reverse fold already recorded)');
        return;
      }
      signCells(s.row);
      src.dupTarget[s.alias_id] = s.primary_id;
      signed.push(s);
    });
    detected.forEach(function (d) {
      var alias = byId[String((d && d.alias_id) || '')];
      var primary = byId[String((d && d.primary_id) || '')];
      if (!alias || !primary || String(alias.id) === String(primary.id)) return;
      if (!peopleFoldKey_(alias.name) ||
          peopleFoldKey_(alias.name) !== peopleFoldKey_(primary.name)) return;
      if (src.takenAlias[String(alias.id)]) return;
      if (src.dupTarget[String(primary.id)] === String(alias.id)) {
        refused.push(String(alias.id) + ' (reverse fold already recorded)');
        return;
      }
      var dupText = String(primary.name || primary.id) + ' (' + primary.id + ')';
      var rowNum = src.rowById[String(alias.id)];
      if (rowNum) {
        src.sheet.getRange(rowNum, src.col.dup + 1).setValue(dupText);
        signCells(rowNum);
      } else {
        var line = [];
        for (var c = 0; c < src.sheet.getLastColumn(); c++) line.push('');
        line[src.col.id] = String(alias.id);
        line[src.col.dup] = dupText;
        line[src.col.dec] = 'merge';
        if (src.col.by !== -1) line[src.col.by] = String(user.email || 'admin');
        if (src.col.at !== -1) line[src.col.at] = now;
        src.sheet.appendRow(line);
      }
      src.takenAlias[String(alias.id)] = true;
      src.dupTarget[String(alias.id)] = String(primary.id);
      signed.push({ alias_id: String(alias.id), primary_id: String(primary.id), types_email: '' });
    });
    households.forEach(function (h) {
      var via = String((h && h.via) || '');
      var val = String((h && h.value) || '').trim().toLowerCase();
      var ids = (h && h.ids) || [];
      if (!Array.isArray(ids) || ids.length < 2 || !val) return;
      if (via !== 'email' && via !== 'phone') return;
      var lines = (typeof SHARED_LINE_DIGITS !== 'undefined') ? SHARED_LINE_DIGITS : [];
      if (via === 'phone' && lines.indexOf(val) !== -1) return;
      var group = [], seenHere = {};
      ids.forEach(function (rawId) {
        var p = byId[String(rawId || '')];
        if (!p || seenHere[String(p.id)]) return;
        seenHere[String(p.id)] = true;
        if (src.takenAlias[String(p.id)]) return;
        var still = via === 'email'
          ? String(p.email || '').trim().toLowerCase() === val
          : peoplePhoneKey_(p.phone) === val;
        if (!still) {
          refused.push(String(p.id) + ' (no longer shares that ' + via + ')');
          return;
        }
        group.push(p);
      });
      if (group.length < 2) return;
      group.sort(function (a, b) {
        var d = peopleRichness_(b) - peopleRichness_(a);
        return d !== 0 ? d : (String(a.id) < String(b.id) ? -1 : 1);
      });
      var primary = group[0];
      group.slice(1).forEach(function (alias) {
        if (src.dupTarget[String(primary.id)] === String(alias.id)) {
          refused.push(String(alias.id) + ' (reverse fold already recorded)');
          return;
        }
        var dupText = String(primary.name || primary.id) + ' (' + primary.id + ')';
        var rowNum = src.rowById[String(alias.id)];
        if (rowNum) {
          src.sheet.getRange(rowNum, src.col.dup + 1).setValue(dupText);
          signCells(rowNum);
        } else {
          var line = [];
          for (var c = 0; c < src.sheet.getLastColumn(); c++) line.push('');
          line[src.col.id] = String(alias.id);
          line[src.col.dup] = dupText;
          line[src.col.dec] = 'merge';
          if (src.col.by !== -1) line[src.col.by] = String(user.email || 'admin');
          if (src.col.at !== -1) line[src.col.at] = now;
          src.sheet.appendRow(line);
        }
        src.takenAlias[String(alias.id)] = true;
        src.dupTarget[String(alias.id)] = String(primary.id);
        signed.push({ alias_id: String(alias.id), primary_id: String(primary.id), types_email: '' });
      });
    });
    if (!signed.length) {
      return { status: 409, message: 'Nothing left to sign — those folds are gone, already decided or refused: ' +
        (refused.join('; ') || 'none pending') };
    }

    try { CacheService.getScriptCache().remove(PEOPLE_MERGE_CACHE_KEY); } catch (e1) {}
    try { cacheBump_(RESOURCES['people'].sheet); } catch (e2) {}

    ensureUserProfileColumns_();
    var usersSheet = hubSheet_(USERS_TAB);
    var uHdr = usersSheet.getDataRange().getValues()[0].map(normKey_);
    var uCol = {};
    ['userid', 'email', 'displayname', 'role', 'salt', 'passhash', 'active', 'createdat', 'lastlogin', 'title']
      .forEach(function (k) { uCol[k] = uHdr.indexOf(k); });
    var created = [], skipped = [], seen = {};
    signed.forEach(function (s) {
      // Follow to the final survivor; a middle link must never be given an account.
      var target = s.primary_id, hops = 0, walked = {};
      while (src.dupTarget[target] && !walked[target] && hops++ < 5) {
        walked[target] = true;
        target = src.dupTarget[target];
      }
      if (seen[target]) return;
      seen[target] = true;
      var primary = byId[target];
      if (!primary) return;
      var name = String(primary.name || s.primary_id);
      var ptype = peopleTypeOf_(primary.role);
      if (ptype === 'Client') {
        skipped.push(name + ' (client — create the account by hand with the client role)');
        return;
      }
      var email = String(primary.email || '').trim().toLowerCase();
      if (!email || email.indexOf('@') === -1) { skipped.push(name + ' (no email on the surviving record)'); return; }
      if (userByEmail_(email)) { skipped.push(name + ' (already a user)'); return; }
      // One appendRow with everything: a later getLastRow() write can hit another admin's row. No password.
      var line = [];
      for (var c2 = 0; c2 < uHdr.length; c2++) line.push('');
      line[uCol.userid] = 'USR_' + randomHex_(12).toUpperCase();
      line[uCol.email] = email;
      line[uCol.displayname] = name;
      line[uCol.role] = 'staff';
      line[uCol.active] = 'true';
      line[uCol.createdat] = now;
      if (uCol.title !== -1) line[uCol.title] = ptype || 'Staff';
      usersSheet.appendRow(line);
      created.push(name);
    });

    hubSysLog_(user && user.email, 'people_merge',
      signed.length + ' fold(s) signed, ' + created.length + ' user(s) created', { status: 200 });
    return { status: 200, data: { merged: signed.length, users_created: created, skipped: skipped, refused: refused } };
  } finally {
    lock.releaseLock();
  }
};
