// Stock remaining is the pharmacy's own column, never a local decrement; never sliced (client names).
/** The medication stock per house, derived from the pharmacy's dispensing reports and read through the relay. */
HUB_POLICY.inventoryPharmacy = {
  file: 'Inventory.gs', lane: 'read', store: 'external',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.inventoryPharmacy = function (payload, user) {
  if (!user || user.is_service ||
      ['admin', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  var r = staffRelayPost_('/inventory/meds', {});
  if (!r || r.status !== 200) {
    return { status: 502, message: 'The pharmacy record did not answer: ' +
             String(r && r.message).slice(0, 120) };
  }
  return { status: 200, data: r.data || { houses: [] } };
};

// Must stay under the screen's 60s client timeout (InventorySuppliesPage.tsx).
var INV_SUPPLIES_WALK_MS = 40000;

/** Supplies read from the company's own Finances folder in Drive: the invoice and purchase documents, grouped by the folder they sit in. */
HUB_POLICY.inventorySupplies = {
  file: 'Inventory.gs', lane: 'read', store: 'drive',
  idempotent: true, cost: 'minutes',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.inventorySupplies = function (payload, user) {
  if (!user || user.is_service ||
      ['admin', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  var cacheKey = 'inv_supplies_v2';
  try {
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return { status: 200, data: JSON.parse(hit) };
  } catch (eC) { }
  var root;
  try {
    root = DriveApp.getFolderById(hubId_('SUPPLIES_DRIVE_ROOT_ID'));
  } catch (e) {
    return { status: 503, message: 'The Finances folder is not shared with the platform account yet — share it and this screen fills itself.' };
  }
  var items = [];
  var cats = {};
  var totalSpend = 0;
  var walk = function (folder, catName) {
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var name = file.getName();
      var amt = name.match(/\$?\s?([0-9][0-9,]*\.[0-9]{2})/);
      var amount = amt ? Number(amt[1].replace(/,/g, '')) : null;
      var dt = name.match(/(\d{4}[._-]\d{1,2}[._-]\d{1,2})|(\d{1,2}[._\/]\d{1,2}[._\/]\d{2,4})/);
      var updated = '';
      try { updated = file.getLastUpdated().toISOString(); } catch (eU) { updated = ''; }
      if (amount) totalSpend += amount;
      var c = cats[catName] = cats[catName] || { category: catName, count: 0, spend: 0, last: '' };
      c.count++; if (amount) c.spend += amount;
      if (updated > c.last) c.last = updated;
      if (items.length < 500) {
        items.push({ id: file.getId(), name: name, vendor: '', category: catName,
                     kind: 'Document', invoice_no: '', amount: amount,
                     doc_date: dt ? dt[0] : '', link: file.getUrl(), updated_at: updated });
      }
    }
  };
  walk(root, 'General');
  // Every folder is walked (a partial total lies); the deadline is checked before a folder opens, never inside one.
  var deadline = Date.now() + INV_SUPPLIES_WALK_MS;
  var subs = root.getFolders();
  var seen = 0, walked = 0, missed = [];
  while (subs.hasNext()) {
    var sub = subs.next();
    seen++;
    if (Date.now() > deadline) {
      if (missed.length < 50) { try { missed.push(sub.getName()); } catch (eN) { } }
      continue;
    }
    walked++;
    walk(sub, sub.getName());
  }
  invSuppliesManualRows_().forEach(function (m) {
    if (m.amount) totalSpend += m.amount;
    var mc = cats[m.category] = cats[m.category] ||
      { category: m.category, count: 0, spend: 0, last: '' };
    mc.count++; if (m.amount) mc.spend += m.amount;
    if (m.updated_at > mc.last) mc.last = m.updated_at;
    items.push(m);
  });
  items.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
  var out = {
    items: items,
    categories: Object.keys(cats).map(function (k) { return cats[k]; })
      .sort(function (a, b) { return b.count - a.count; }),
    vendors: [],
    purchase_count: items.length,
    total_spend: Math.round(totalSpend * 100) / 100,
    folders_seen: seen,
    folders_walked: walked,
    not_walked: seen - walked,
    not_walked_names: missed,
    complete: seen === walked
  };
  if (!out.complete) {
    try {
      hubSysLog_('inventory', 'supplies_walk_incomplete',
                 out.not_walked + ' of ' + seen + ' Finances subfolder(s) went unread: ' +
                 missed.slice(0, 8).join(', '));
    } catch (eL) { }
  }
  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(out), out.complete ? 21600 : 1800);
  } catch (eP) { }
  return { status: 200, data: out };
};

var INV_SUPPLIES_MANUAL_TAB = 'inventory_supplies_manual';
var INV_SUPPLIES_MANUAL_HEADER = ['id', 'name', 'vendor', 'category', 'kind',
                                  'invoice_no', 'amount', 'doc_date', 'link', 'by', 'at'];

function invSuppliesManualSheet_() {
  var existed = !!hubTabSheet_(INV_SUPPLIES_MANUAL_TAB);
  var sheet = hubTabEnsure_(INV_SUPPLIES_MANUAL_TAB, INV_SUPPLIES_MANUAL_HEADER);
  if (existed) ensureHeader_(sheet, INV_SUPPLIES_MANUAL_HEADER);
  return sheet;
}

function invSuppliesManualRows_() {
  var out = [];
  try {
    readTabNormalized_(hubTabWorkbook_(INV_SUPPLIES_MANUAL_TAB), INV_SUPPLIES_MANUAL_TAB).forEach(function (r) {
      var amount = str_(r.amount) === '' ? null : Number(r.amount);
      if (amount !== null && isNaN(amount)) amount = null;
      out.push({ id: str_(r.id), name: str_(r.name), vendor: str_(r.vendor),
                 category: str_(r.category) || 'General',
                 kind: str_(r.kind) || 'Manual entry',
                 invoice_no: str_(r.invoiceno), amount: amount,
                 doc_date: str_(r.docdate), link: str_(r.link),
                 updated_at: str_(r.at) });
    });
  } catch (e) { }
  return out;
}

HUB_POLICY.inventorySupplyAdd = {
  file: 'Inventory.gs', lane: 'tool', store: 'drive',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
HUB_ACTIONS.inventorySupplyAdd = function (payload, user) {
  if (!user || user.is_service ||
      ['admin', 'manager'].indexOf(String(user.role)) === -1) return hubDenied_();
  var name = str_(payload.name);
  if (!name) return { status: 400, message: 'A name is required.' };
  var vendor = str_(payload.vendor);
  var category = str_(payload.category) || 'General';
  var kind = str_(payload.kind) || 'Manual entry';
  var invoiceNo = str_(payload.invoice_no);
  var amount = str_(payload.amount) === '' ? null : Number(payload.amount);
  if (amount !== null && (isNaN(amount) || amount < 0)) {
    return { status: 400, message: 'The amount must be a number.' };
  }
  var docDate = str_(payload.doc_date);
  var link = '';
  var b64 = String(payload.base64 || '');
  if (b64) {
    var fname = str_(payload.filename) || 'document';
    var mime = str_(payload.mime).toLowerCase();
    var okMime = mime.indexOf('image/') === 0 || mime === 'application/pdf';
    var okExt = /\.(png|jpe?g|webp|gif|heic|pdf)$/i.test(fname);
    if (!okMime && !okExt) return { status: 400, message: 'Images and PDFs only.' };
    if (b64.length > 21000000) {
      return { status: 400, message: 'The file is too large — up to 15MB.' };
    }
    var bytes = Utilities.base64Decode(b64);
    if (!bytes.length) return { status: 400, message: 'The file is empty.' };
    var blob = Utilities.newBlob(bytes, mime || 'application/octet-stream', fname);
    // Our Drive holds the record; the Finances copy below is a courtesy that may fail.
    var file = filesChildByName_(filesChildByName_(filesRoot_(), 'Supplies Docs'), category)
      .createFile(blob);
    link = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    try {
      var fin = DriveApp.getFolderById(hubId_('SUPPLIES_DRIVE_ROOT_ID'));
      var it = fin.getFoldersByName(category);
      (it.hasNext() ? it.next() : fin).createFile(blob);
    } catch (eShared) { }
  }
  var at = new Date().toISOString();
  var id = Utilities.getUuid();
  invSuppliesManualSheet_().appendRow([id, name, vendor, category, kind, invoiceNo,
                                       amount === null ? '' : amount, docDate, link,
                                       str_(user.email), at]);
  try { CacheService.getScriptCache().remove('inv_supplies_v2'); } catch (eC) { }
  var env = { status: 200, data: {
    id: id, name: name, vendor: vendor, category: category, kind: kind,
    invoice_no: invoiceNo, amount: amount, doc_date: docDate, link: link,
    by: str_(user.email), at: at, updated_at: at
  } };
  hubSysLog_(user && user.email, 'inventorySupplyAdd', name, env);
  return env;
};
