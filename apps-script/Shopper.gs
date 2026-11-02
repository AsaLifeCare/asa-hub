// Model prices are only ever `estimate`, never `price`, and no URL is stored: none of it was looked up.
var SHOP_CATEGORIES = ['Household', 'Electronics', 'Clothing', 'Health', 'Kitchen',
                       'Tools', 'Baby & Kids', 'Gift', 'Other'];

var SHOP_STATUSES = ['watching', 'bought', 'dropped'];

// `roles: []` is safe here only because the rows are ownedBy: nobody reaches another person's list.
function shopMayUse_(user) {
  return !!(user && !user.is_service && str_(user.id));
}

function shopState_(user) {
  var me = str_(user.id);
  var items = listRows_('shopperItems', {}).filter(function (r) {
    return str_(r.ownerId) === me;
  });
  var prices = listRows_('shopperPrices', {}).filter(function (r) {
    return str_(r.ownerId) === me;
  });

  var byItem = {};
  prices.forEach(function (p) {
    var k = str_(p.itemId);
    if (!byItem[k]) byItem[k] = [];
    byItem[k].push({
      id: str_(p.id), source: str_(p.source), estimate: finNum_(p.estimate),
      title: str_(p.title), model: str_(p.model), foundAt: str_(p.foundAt)
    });
  });

  return items.map(function (r) {
    var list = (byItem[str_(r.id)] || []).sort(function (a, b) { return a.estimate - b.estimate; });
    var target = finNum_(r.targetPrice);
    var best = list.length ? list[0].estimate : 0;
    return {
      id: str_(r.id), name: str_(r.name), category: str_(r.category),
      targetPrice: target, notes: str_(r.notes),
      status: str_(r.status) || 'watching',
      estimates: list,
      bestEstimate: best,
      worthChecking: !!(target > 0 && best > 0 && best <= target),
      checkedAt: list.length ? list[0].foundAt : str_(r.checkedAt),
      paidPrice: finNum_(r.paidPrice) || 0,
      paidVendor: str_(r.paidVendor),
      boughtAt: str_(r.boughtAt)
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

HUB_POLICY.shopList = {
  file: 'Shopper.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.shopList = function (payload, user) {
  if (!shopMayUse_(user)) return hubDenied_();
  return { status: 200, data: { items: shopState_(user), categories: shopCategories_() } };
};

HUB_POLICY.shopSave = {
  file: 'Shopper.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.shopSave = function (payload, user) {
  if (!shopMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var name = str_(p.name).trim();
  if (!name) return { status: 400, message: 'What is it you want to buy?' };
  var category = shopCategories_().indexOf(str_(p.category)) === -1 ? 'Other' : str_(p.category);
  var status = SHOP_STATUSES.indexOf(str_(p.status)) === -1 ? 'watching' : str_(p.status);
  var target = finNum_(p.targetPrice);
  if (target < 0) return { status: 400, message: 'A target price cannot be negative.' };

  var fields = { name: name, category: category, targetPrice: target,
                 notes: str_(p.notes), status: status };
  // What was actually paid; never mixed into `estimate`.
  var paid = finNum_(p.paidPrice);
  if (paid > 0) fields.paidPrice = paid;
  if (str_(p.paidVendor)) fields.paidVendor = str_(p.paidVendor).slice(0, 80);
  if (status === 'bought') fields.boughtAt = new Date().toISOString();
  // The resource gate stamps the owner on create and update.
  if (str_(p.id)) {
    var row = updateRowById_('shopperItems', Object.assign({ id: str_(p.id) }, fields));
    if (row.error) return row.error;
    return { status: 200, data: { id: str_(p.id) } };
  }
  var made = createRow_('shopperItems', fields);
  if (sheetDbRefused_(made)) return sheetDbRefused_(made);
  return { status: 200, data: { id: str_(made.id) } };
};

HUB_POLICY.shopRemove = {
  file: 'Shopper.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.shopRemove = function (payload, user) {
  if (!shopMayUse_(user)) return hubDenied_();
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which item?' };
  listRows_('shopperPrices', {}).forEach(function (r) {
    if (str_(r.itemId) === id && str_(r.ownerId) === str_(user.id)) {
      deleteRowById_('shopperPrices', str_(r.id));
    }
  });
  var out = deleteRowById_('shopperItems', id);
  return out.error ? out.error : { status: 200, data: { removed: true } };
};

/** Ask what an item roughly costs, through the platform's own provider ladder. */
HUB_POLICY.shopEstimate = {
  file: 'Shopper.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.shopEstimate = function (payload, user) {
  if (!shopMayUse_(user)) return hubDenied_();
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which item?' };
  var row = requireRow_('shopperItems', id);
  if (row.error) return row.error;
  if (str_(row.ownerId) !== str_(user.id)) return { status: 404, message: 'No such item.' };
  if (typeof screenAiChat_ !== 'function') {
    return { status: 503, message: 'No model provider is configured.' };
  }

  var ask = 'Someone wants to buy: "' + str_(row.name) + '"' +
            (str_(row.category) ? ' (category: ' + str_(row.category) + ')' : '') +
            (str_(row.notes) ? '. Notes: ' + str_(row.notes) : '') + '.\n\n' +
            'From general knowledge, give TYPICAL US retail price points — not live listings, ' +
            'and do NOT invent URLs. Reply with JSON only:\n' +
            '{"estimates":[{"source":"<retailer or tier, e.g. big-box / online marketplace>",' +
            '"estimate":<number>,"title":"<typical product>"}],' +
            '"advice":"<3 sentences: what to look for, and how to buy it well>"}';

  var res = null;
  try { res = screenAiChat_(ask, 0.2, 'ai_shopper_estimate'); } catch (e) { res = null; }
  if (!res || !res.ok) return { status: 502, message: 'No provider answered.' };
  var parsed = null;
  try { parsed = JSON.parse(res.content); } catch (e) { parsed = null; }
  if (!parsed || !parsed.estimates || !parsed.estimates.length) {
    return { status: 502, message: 'The answer could not be read as prices.' };
  }

  // Replace, never accumulate: old and new estimates side by side cannot be told apart.
  listRows_('shopperPrices', {}).forEach(function (r) {
    if (str_(r.itemId) === id && str_(r.ownerId) === str_(user.id)) {
      deleteRowById_('shopperPrices', str_(r.id));
    }
  });

  var now = new Date().toISOString();
  var kept = 0;
  parsed.estimates.slice(0, 6).forEach(function (e) {
    var n = finNum_(e.estimate);
    if (!(n > 0)) return;
    // only an estimate that landed is counted as kept
    if (sheetDbRefused_(createRow_('shopperPrices', {
      itemId: id, source: str_(e.source), estimate: n, title: str_(e.title),
      model: str_(res.via), foundAt: now
    }))) return;
    kept++;
  });

  updateRowById_('shopperItems', { id: id, checkedAt: now });
  hubSysLog_(str_(user.email), 'shopEstimate', str_(row.name),
             { status: 200, message: kept + ' estimate(s) via ' + str_(res.via) });
  return { status: 200, data: { kept: kept, via: str_(res.via),
                                advice: str_(parsed.advice), items: shopState_(user) } };
};

// Subject `self`: the message goes to the list's owner only; the row's `to` is ignored.
function shopSmartSubjects_() {
  var byOwner = {};
  var items = listRows_('shopperItems', {});
  var prices = listRows_('shopperPrices', {});
  var best = {};
  prices.forEach(function (p) {
    var k = str_(p.itemId);
    var n = finNum_(p.estimate);
    if (n > 0 && (!best[k] || n < best[k])) best[k] = n;
  });
  items.forEach(function (r) {
    if (str_(r.status) && str_(r.status) !== 'watching') return;
    var target = finNum_(r.targetPrice);
    var b = best[str_(r.id)] || 0;
    if (!(target > 0 && b > 0 && b <= target)) return;
    var owner = str_(r.ownerId);
    if (!owner) return;
    if (!byOwner[owner]) byOwner[owner] = { ownerId: owner, name: '', count: 0, first: '', best: 0 };
    var o = byOwner[owner];
    o.count++;
    if (!o.first) { o.first = str_(r.name); o.best = b; }
  });
  return Object.keys(byOwner).map(function (k) {
    var o = byOwner[k];
    var u = shopUserById_(o.ownerId);
    o.name = u ? (str_(u.displayname) || str_(u.email)) : o.ownerId;
    o.email = u ? str_(u.email) : '';
    o.phone = u ? str_(u.phone) : '';
    o.bestText = '$' + o.best.toFixed(2);
    return o;
  });
}

function shopUserById_(id) {
  var hit = null;
  try {
    usersAll_().forEach(function (u) { if (str_(u.userid) === str_(id)) hit = u; });
  } catch (e) { hit = null; }
  return hit;
}

// Real invoice prices from the procurement catalog; shown beside estimates, never in the same column.
HUB_POLICY.shopPurchases = {
  file: 'Shopper.gs', lane: 'read', store: 'external',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.shopPurchases = function (payload, user) {
  if (!user || user.is_service ||
      ['admin', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  var r = staffRelayPost_('/shopper/purchases', {});
  if (!r || r.status !== 200) {
    return { status: 502, message: 'The purchase record did not answer: ' +
             str_(r && r.message).slice(0, 120) };
  }
  return { status: 200, data: r.data || { purchases: [] } };
};

// Built-in categories are a floor, and a category still in use cannot be removed.
HUB_POLICY.shopSettingsSet = {
  file: 'Shopper.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.shopSettingsSet = function (payload, user) {
  if (!user || user.is_service || user.role !== 'admin') return hubDenied_();
  var wanted = [];
  ((payload && payload.categories) || []).forEach(function (v) {
    var t = String(v).trim();
    if (t && wanted.indexOf(t) === -1) wanted.push(t);
  });
  var lost = SHOP_CATEGORIES.filter(function (c) { return wanted.indexOf(c) === -1; });
  if (lost.length) {
    return { status: 400, message: 'These are built in and cannot be removed: ' + lost.join(', ') + '.' };
  }
  var inUse = {};
  listRows_('shopperItems', {}).forEach(function (r) {
    var c = str_(r.category);
    if (c) inUse[c] = (inUse[c] || 0) + 1;
  });
  var orphaned = Object.keys(inUse).filter(function (c) { return wanted.indexOf(c) === -1; });
  if (orphaned.length) {
    return { status: 409, message: 'Still in use: ' +
             orphaned.map(function (c) { return c + ' (' + inUse[c] + ')'; }).join(', ') + '.' };
  }
  var extra = wanted.filter(function (c) { return SHOP_CATEGORIES.indexOf(c) === -1; });
  var row = null;
  listRows_('financeConfig', {}).forEach(function (r) { if (str_(r.key) === 'shopCategories') row = r; });
  var wroteCat = row ? updateRowById_('financeConfig', { id: row.id, value: extra.join('|') })
                     : createRow_('financeConfig', { key: 'shopCategories', value: extra.join('|') });
  if (sheetDbRefused_(wroteCat)) return sheetDbRefused_(wroteCat);
  return { status: 200, data: { categories: shopCategories_() } };
};

function shopCategories_() {
  var list = SHOP_CATEGORIES.slice();
  listRows_('financeConfig', {}).forEach(function (r) {
    if (str_(r.key) !== 'shopCategories') return;
    String(r.value || '').split('|').forEach(function (v) {
      var t = String(v).trim();
      if (t && list.indexOf(t) === -1) list.push(t);
    });
  });
  return list;
}
