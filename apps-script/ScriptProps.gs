// Script properties: which keys the code owns, what each is for, the two master doors, and the editor tools that drain the store.
// Values live in Props.gs; reading lives in SheetDb.gs (hubProp_ / hubId_).

// --- 1. Keys the code owns ---

// Load-bearing: hubProp_ reads the FILE first for any key not listed here, so a code-written key missing here freezes.
var SCRIPT_PROP_RUNTIME = [
  // minted once — a second one orphans every fingerprint already written
  'HUB_PII_SALT',
  'HUB_INTERVIEW_ASK_CURSOR', 'HUB_INBOUND_CURSOR', 'HUB_CALLOFFS_CURSOR',
  'FLOW_JUDGE_CURSOR', 'RUNTIME_JUDGE_CURSOR',
  'HIRING_POLICY_OVERLAY', 'HIRING_POLICY_DIRTY',
  'COMM_BINDINGS_COMPILED',
  'RESOLVER_MODE',
  'SHEETBOARD_ROOT_ID', 'TASK_PROJECT_FOLDER_ID',
  'FINANCE_RECEIPTS_FOLDER_ID', 'MARKETING_HUB_SHEET_ID',
  'AI_KEY_SWEEP_AT', 'AI_KEYS_RETIRED',
  'CONTACT_SWEEP_AT',
  'USERS_BULK_AT',
  'CONTACT_MERGE_AT', 'PEOPLE_SYNC_SOURCE_AT',
  'BEHAVIOR_SWEEP_AT',
  'HUB_LINE_DIRECTORY',
  'ISP_SECTIONS_TRIES'
];

// Set by a person (the CJIS filing folder), though the HUB_FOLDER_*_ID rule would call it code-owned.
var SCRIPT_PROP_CONFIG_ANYWAY = ['HUB_FOLDER_ORIGINAL_DOCS'];

function scriptPropIsRuntime_(key) {
  var k = String(key || '');
  if (!k) return false;
  if (SCRIPT_PROP_CONFIG_ANYWAY.indexOf(k) !== -1) return false;
  if (SCRIPT_PROP_RUNTIME.indexOf(k) !== -1) return true;
  return /^HUB_FOLDER_.*_ID$/.test(k) ||
         /^HUB_MARKETING_CACHE/.test(k) ||
         /^MARKETING_ANALYTICS/.test(k) ||
         /^_BUNDLE_/.test(k) ||
         /_CURSOR$/.test(k) || /_DIRTY$/.test(k);
}

// --- 2. What each key is for ---

// A catalogue, not a gate: an undescribed key still shows and still sets. `secret: true` is never echoed.
var SCRIPT_PROP_CATALOG = [
  { key: 'HUB_DB_ID', secret: false, what: 'The Hub database — the talent workbook and the config live here too.' },
  { key: 'HUB_APPS_BOOK_ID', secret: false,
    what: 'The apps workbook — the tabs that left HUB_DB (Shopper, Meals, Learning, Travel).' },
  { key: 'HUB_CARE_BOOK_ID', secret: false,
    what: 'The care workbook — the clinical tabs that left HUB_DB (batch C, 2026-09-02).' },
  { key: 'HUB_PREFS_ID', secret: false, what: 'The preferences workbook.' },
  { key: 'HUB_LOGS_ID', secret: false, what: 'The log workbook.' },
  { key: 'HUB_COMMS_ID', secret: false, what: 'The Smart Comms workbook.' },
  { key: 'HUB_DIRECTORY_ID', secret: false, what: 'The people directory workbook.' },
  { key: 'HUB_PLATFORM_FOLDER_ID', secret: false, what: 'The Drive folder everything else sits in.' },

  { key: 'HUB_LINE_DIRECTORY', secret: false,
    what: 'The last good copy of our own phone lines, as JSON — number, ' +
          'provider name, seats, humans, forward, and the derived shared ' +
          'verdict (LineDirectory.gs). The code writes it; clearing it makes ' +
          'the next execution ask the provider again. It holds no key and no ' +
          'personal number: only the lines the company owns.' },

  { key: 'ISP_SECTIONS_TRIES', secret: false,
    what: 'The client plans whose sections the digest pass could not file — a JSON map of client key to ' +
          '{ n, next, status }. The code writes it; a plan waits until `next` before it is read again. ' +
          'Emptying it lets every one be read on the next pass.' },

  { key: 'AI_KEY_SWEEP_AT', secret: false,
    what: 'When the weekly AI-key check last ran (epoch ms). The code writes it; ' +
          'clearing it makes the next sweep run immediately.' },
  { key: 'AI_KEYS_RETIRED', secret: false,
    what: 'The AI keys the weekly check quarantined — a JSON map of property ' +
          'name to { at, provider, why, key_masked }. Both the phone screen ' +
          'ladder and the stress test skip anything named here, which is what ' +
          '"removing" a key means when the value lives in the Props.gs file. ' +
          'Emptying this map puts every retired key back in service.' },

  { key: 'INTERVIEW_LINK_SECRET', secret: true,
    what: 'Signs the candidate scheduling link AND the registration invitation. ' +
          'Without it both refuse to mint a link at all.' },
  { key: 'ONBOARDING_USER_PASSWORD', secret: true,
    what: 'The first-time password every new hire account starts on.' },
  { key: 'FIRST_USER_PASSWORD', secret: true,
    what: 'The same value under its older name — either satisfies both doors.' },

  { key: 'PLATFORM_EMAIL', secret: false,
    what: 'The platform own mailbox — the address every automatic letter leaves from.' },
  { key: 'PLATFORM_EMAIL_PASSWORD', secret: true, what: 'Its password.' },
  { key: 'PLATFORM_EMAIL_2', secret: false, what: 'The second mailbox.' },
  { key: 'PLATFORM_EMAIL_PASSWORD_2', secret: true, what: 'Its password.' },
  { key: 'PLATFORM_EMAIL_3', secret: false, what: 'The third mailbox.' },
  { key: 'PLATFORM_EMAIL_PASSWORD_3', secret: true, what: 'Its password.' },
  { key: 'PLATFORM_EMAIL_4', secret: false, what: 'The fourth mailbox.' },
  { key: 'PLATFORM_EMAIL_PASSWORD_4', secret: true, what: 'Its password.' },
  { key: 'PLATFORM_EMAIL_5', secret: false, what: 'The fifth mailbox.' },
  { key: 'PLATFORM_EMAIL_PASSWORD_5', secret: true, what: 'Its password.' },

  { key: 'GROK_API_KEY', secret: true,
    what: 'The first Groq key — spelled with a K because that is what it has always ' +
          'been called; renaming it would silently unplug the phone screen.' },
  { key: 'GROQ_KEY1', secret: true, what: 'The second chance at the same model.' },
  { key: 'GROQ_KEY2', secret: true, what: 'The third.' },
  { key: 'GROQ_KEY3', secret: true, what: 'The fourth.' },
  { key: 'GROQ_KEY4', secret: true, what: 'The fifth.' },
  { key: 'GROQ_KEY5', secret: true, what: 'The sixth.' },
  { key: 'GROQ_KEY6', secret: true, what: 'The seventh (added 2026-09-07).' },
  { key: 'GROQ_MODEL', secret: false, what: 'Which Groq model, without touching code.' },
  { key: 'OPENAI_API_KEY', secret: true, what: 'The fallback provider.' },
  { key: 'OPENAI_MODEL', secret: false, what: 'Which OpenAI model.' },
  { key: 'HUB_ANALYZE_URL', secret: false,
    what: 'The platform own relay, the last rung under the providers.' },
  { key: 'OPENPHONE_API_KEY', secret: true,
    what: 'The SMS line. Without it every text is recorded and none is sent.' },

  { key: 'HUB_SERVICE_SECRET', secret: true,
    what: 'What the relay signs its reads with. Absent, the backend answers ' +
          '401 to everything and every slice goes stale.' },
  { key: 'HUB_MASTER_EMAIL', secret: false, what: 'Who owns the platform.' },
  { key: 'HUB_RPC_SEND', secret: false,
    what: 'The transport switch. Anything other than on/true/1 and the platform ' +
          'records every message without sending one.' },
  { key: 'STAFF_ALERT_TO', secret: false,
    what: 'No longer read: the attendance rows (staff_late_show, staff_no_call) are the only ' +
          'list, and a row that names nobody sends nothing.' },
  { key: 'HUB_FOLDER_ORIGINAL_DOCS', secret: false,
    what: 'The Drive folder id the CJIS copies are filed into.' },
  { key: 'HUB_VIEWER_RECENT_DAYS', secret: false,
    what: 'How many days back a shift or a punch at a house still shows that staff member to the ' +
          'house\'s client or family (ViewerScope.gs). A whole number from 1 to 366; blank means 30.' },
  { key: 'BROWSER_AUTOMATION_URL', secret: false, what: 'The browser worker.' },
  { key: 'BROWSER_AUTOMATION_BOT_SECRET', secret: true, what: 'What it is called with.' },
  { key: 'DROPBOX_SIGN_API_KEY', secret: true, what: 'The signature packets.' },
  { key: 'BRITTCO_PASSWORD', secret: true, what: 'The legacy system the scraper signs into.' },

  { key: 'ESTATE_CALLOFFS_ID', secret: false, what: 'The estate call-off tracker.' },
  { key: 'ESTATE_DR_ID', secret: false,
    what: 'The doctor roster AND the appointment archive — one book, two tabs.' },
  { key: 'ESTATE_REPAIRS_ID', secret: false, what: 'Repairs / work orders.' },
  { key: 'ESTATE_UI_ID', secret: false, what: 'UIs and MUIs.' },
  { key: 'ESTATE_NOTES_ID', secret: false, what: 'The hotline daily notes.' },
  { key: 'ESTATE_HR_ID', secret: false,
    what: 'The Employee HR Tracker — the Staff Issues app reads a mirror of it ' +
          'and appends new situations straight into its Master tab.' },
  { key: 'MARKETING_ESTATE_ID', secret: false,
    what: 'The competitor sheet Marketing copies from, once.' },
  { key: 'RECON_SOURCE_ID', secret: false,
    what: 'The punch master the legacy portal appended every cleaned report to.' },
  { key: 'LEGACY_CANDIDATE_DOCS_ROOT', secret: false,
    what: 'A root the legacy Staff Docs design named — read only by the editor probe.' },
  { key: 'LEGACY_ASA_ROOT', secret: false, what: 'The same, the other root.' },

  { key: 'HUB_PII_SALT', secret: true,
    what: 'What every de-identified value was hashed WITH. A second one orphans ' +
          'every fingerprint already written — the data is not corrupted, it ' +
          'simply stops being findable, and nothing reports an error.' }
];

function scriptPropSpec_(key) {
  var want = String(key || '').trim();
  for (var i = 0; i < SCRIPT_PROP_CATALOG.length; i++) {
    if (SCRIPT_PROP_CATALOG[i].key === want) return SCRIPT_PROP_CATALOG[i];
  }
  return null;
}

function scriptPropIsSecret_(key) {
  var spec = scriptPropSpec_(key);
  if (spec) return !!spec.secret;
  return /SECRET|PASSWORD|_KEY$|API_KEY|TOKEN|SALT/.test(String(key || ''));
}

// Never set through the door: these decide who may use it. Props.gs may still hold them.
var SCRIPT_PROP_NEVER = ['HUB_SERVICE_SECRET', 'HUB_MASTER_EMAIL', 'HUB_PII_SALT'];

// The file is read first, so this decides where a change would take effect.
function scriptPropInFile_(key) {
  try {
    var v = hubPropsFile_()[String(key)];
    return v !== undefined && String(v) !== '';
  } catch (e) { return false; }
}

function scriptPropTail_(value) {
  var v = String(value || '');
  if (v.length < 12) return v ? '••••' : '';
  return '…' + v.slice(-4);
}

function scriptPropEveryKey_() {
  var seen = {}, out = [];
  var add = function (k) {
    var kk = String(k || '');
    if (!kk || seen[kk]) return;
    seen[kk] = true; out.push(kk);
  };
  try { var f = hubPropsFile_(); for (var a in f) add(a); } catch (e1) {}
  try { var s = hubPropsStore_(); for (var b in s) add(b); } catch (e2) {}
  for (var i = 0; i < SCRIPT_PROP_CATALOG.length; i++) add(SCRIPT_PROP_CATALOG[i].key);
  for (var j = 0; j < SCRIPT_PROP_RUNTIME.length; j++) add(SCRIPT_PROP_RUNTIME[j]);
  out.sort();
  return out;
}

// --- 3. The two doors ---

/** Every script property key the platform knows about and where it is read from, never its value. */
HUB_POLICY.scriptPropStatus = {
  file: 'ScriptProps.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'instant',
  roles: ['admin'],
  invalidates: [], emits: []
};
// `where`: file (edit Props.gs), store (not moved yet), both (store copy prunable), unset.
HUB_ACTIONS.scriptPropStatus = function (payload, user) {
  if (!user || user.is_service || !hubIsMaster_(str_(user.email))) {
    return { status: 404, message: 'Unknown action.' };
  }
  var file = {}, store = {};
  try { file = hubPropsFile_() || {}; } catch (e1) { file = {}; }
  try { store = hubPropsStore_() || {}; } catch (e2) { store = {}; }

  var rows = scriptPropEveryKey_().map(function (key) {
    var spec = scriptPropSpec_(key);
    var owned = scriptPropIsRuntime_(key);
    var inFile = !!(file[key] !== undefined && String(file[key]) !== '');
    var inStore = !!String(store[key] || '');
    var where = inFile && inStore ? 'both' : (inFile ? 'file' : (inStore ? 'store' : 'unset'));
    var v = hubProp_(key);
    var secret = scriptPropIsSecret_(key);
    return {
      key: key,
      what: spec ? spec.what : '',
      described: !!spec,
      secret: secret,
      owner: owned ? 'code' : 'config',
      set: !!v,
      where: where,
      in_file: inFile,
      in_store: inStore,
      preview: v ? (secret ? scriptPropTail_(v) : v) : ''
    };
  });

  var counts = { total: rows.length, file: 0, store: 0, both: 0, unset: 0, code_owned: 0 };
  rows.forEach(function (r) {
    counts[r.where] = (counts[r.where] || 0) + 1;
    if (r.owner === 'code') counts.code_owned++;
  });
  var stillOnlyInStore = rows.filter(function (r) {
    return r.where === 'store' && r.owner === 'config';
  }).map(function (r) { return r.key; });

  return { status: 200, data: {
    properties: rows, never: SCRIPT_PROP_NEVER, counts: counts,
    still_only_in_store: stillOnlyInStore,
    store_can_be_emptied: stillOnlyInStore.length === 0
  } };
};

/** Set or clear one script property in the store. */
HUB_POLICY.scriptPropSet = {
  file: 'ScriptProps.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'instant',
  roles: ['admin'],
  params: { key: { required: true, type: 'string' },
            value: { required: false, type: 'string' } },
  invalidates: [], emits: []
};
// 'tool', never 'write': the write lane queues the body on the relay disk, and this body can be a password.
HUB_ACTIONS.scriptPropSet = function (payload, user) {
  if (!user || user.is_service || !hubIsMaster_(str_(user.email))) {
    return { status: 404, message: 'Unknown action.' };
  }
  var key = str_(payload && payload.key).trim();
  var value = String((payload && payload.value) == null ? '' : payload.value);
  if (!key) return { status: 400, message: 'Which property?' };

  if (SCRIPT_PROP_NEVER.indexOf(key) !== -1) {
    return { status: 403, message:
      key + ' is never written from a screen — it decides who may use this door. Edit Props.gs.' };
  }

  var props;
  try { props = PropertiesService.getScriptProperties(); }
  catch (e) { return { status: 500, message: 'the property store did not answer: ' +
                       String((e && e.message) || e) }; }

  if (!value.trim()) {
    var had = '';
    try { had = String(props.getProperty(key) || ''); } catch (eG) { had = ''; }
    if (!had) {
      return { status: 200, data: { key: key, cleared: false,
               note: 'The store did not hold it, so there was nothing to clear.' } };
    }
    if (!scriptPropInFile_(key) && !scriptPropIsRuntime_(key)) {
      return { status: 409, message:
        key + ' is only in the store — clearing it would simply lose the value. ' +
        'Put it in Props.gs first, publish, then clear.' };
    }
    try { props.deleteProperty(key); } catch (eD) {
      return { status: 500, message: 'could not clear it: ' + String((eD && eD.message) || eD) };
    }
    try { HUB_ID_CACHE = null; } catch (eC) {}
    try { hubSysLog_(str_(user.email), 'script_prop_cleared',
                     key + ' removed from the store', { status: 200 }); } catch (eL) {}
    return { status: 200, data: { key: key, cleared: true,
             note: scriptPropIsRuntime_(key)
               ? 'The code owns this one and will write it again when it needs it.'
               : 'Props.gs holds it — it is read from the file now.' } };
  }

  if (scriptPropInFile_(key) && !scriptPropIsRuntime_(key)) {
    return { status: 409, message:
      key + ' lives in Props.gs, and the file is read before the store — writing here would ' +
      'change nothing. Edit the file: it IS the value.' };
  }
  var replaced = false;
  try {
    replaced = !!String(props.getProperty(key) || '');
    props.setProperty(key, value);
  } catch (eS) {
    return { status: 500, message: 'could not write it: ' + String((eS && eS.message) || eS) };
  }
  try { HUB_ID_CACHE = null; } catch (eC2) {}
  try {
    hubSysLog_(str_(user.email), 'script_prop_set',
               key + (replaced ? ' (replaced)' : ' (set for the first time)'), { status: 200 });
  } catch (eL2) {}

  return { status: 200, data: {
    key: key, set: true, replaced: replaced,
    described: !!scriptPropSpec_(key),
    owner: scriptPropIsRuntime_(key) ? 'code' : 'config',
    preview: scriptPropIsSecret_(key) ? scriptPropTail_(value) : value,
    note: scriptPropIsRuntime_(key)
      ? 'The code owns this key and may overwrite it on its next run.'
      : 'Set in the store. Move it into Props.gs when you can — the store is being drained.'
  } };
};

// --- 4. Editor tools ---

// Mirrors the parser in SheetDb.gs — change one and change the other.
function scriptPropEsc_(v) {
  return String(v == null ? '' : v)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function scriptPropLine_(key, value, commented) {
  var body = "scriptProperties.setProperty('" + key + "', '" + scriptPropEsc_(value) + "');";
  return commented
    ? "    // " + body + "   // ← fill in and uncomment"
    : "    " + body;
}

// Prints secrets into the execution log. Code-owned keys print commented: uncommented, a cursor never advances.
function runExportScriptProps() {
  var all = {};
  try { all = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { all = {}; }
  var file = hubPropsFile_();

  var moving = [], owned = [], already = [];
  Object.keys(all).sort().forEach(function (k) {
    if (scriptPropIsRuntime_(k)) { owned.push(k); return; }
    if (file[k] !== undefined && String(file[k]) === String(all[k])) { already.push(k); return; }
    moving.push(k);
  });
  var known = [];
  SCRIPT_PROP_CATALOG.forEach(function (spec) {
    if (scriptPropIsRuntime_(spec.key)) return;
    if (all[spec.key] !== undefined) return;
    if (file[spec.key] !== undefined) return;
    known.push(spec.key);
  });
  known.sort();

  var out = [];
  moving.forEach(function (k) { out.push(scriptPropLine_(k, all[k], false)); });
  if (owned.length) {
    out.push('');
    out.push('    // the code writes these — a seed only, and only while the store is empty');
    owned.forEach(function (k) { out.push(scriptPropLine_(k, all[k], true)); });
  }
  if (known.length) {
    out.push('');
    out.push('    // known to the platform, nobody has set them');
    known.forEach(function (k) { out.push(scriptPropLine_(k, '', true)); });
  }

  Logger.log('---- paste inside propertieService() in Props.gs ----');
  Logger.log(out.join('\n'));
  Logger.log('---- end ----');
  Logger.log('');
  Logger.log(moving.length + ' value(s) still to move; ' + already.length +
             ' already match the file; ' + owned.length + ' the code owns; ' +
             known.length + ' known and unset.');
  Logger.log('Paste, save, PUBLISH — then runPruneScriptProps() to take the ' +
             'moved ones out of the store.');
  return { to_move: moving.length, already_in_file: already.length,
           code_owned: owned.length, empty: known.length };
}

function runCountScriptProps() {
  var all = {};
  try { all = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { all = {}; }
  var file = hubPropsFile_();
  var keys = Object.keys(all).sort();
  var inFile = 0, owned = 0, onlyStore = [];
  keys.forEach(function (k) {
    if (scriptPropIsRuntime_(k)) { owned++; return; }
    if (scriptPropInFile_(k)) { inFile++; return; }
    onlyStore.push(k);
  });
  Logger.log(keys.length + ' propert(ies) in the store; ' +
             Object.keys(file).length + ' value(s) in Props.gs.');
  Logger.log(inFile + ' of the store is a copy of the file and can go.');
  Logger.log(owned + ' the code owns and must stay.');
  Logger.log(onlyStore.length + ' exist ONLY in the store — these are what is left to move:');
  Logger.log('  ' + (onlyStore.join('\n  ') || '(none — the store can be emptied)'));
  return { store: keys.length, file: Object.keys(file).length,
           duplicated: inFile, code_owned: owned, only_in_store: onlyStore.length };
}

// Deletes only keys the file holds with the SAME value; dry run unless passed `true`.
function runPruneScriptProps(reallyDelete) {
  var file = hubPropsFile_();
  if (!file || !Object.keys(file).length) {
    Logger.log('REFUSED: Props.gs holds nothing. Run runExportScriptProps() first.');
    return { error: 'empty file' };
  }
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties() || {};
  var same = [], keep = [];
  Object.keys(all).forEach(function (k) {
    if (scriptPropIsRuntime_(k)) { keep.push(k + ' (the code owns it)'); return; }
    if (file[k] === undefined) { keep.push(k + ' (not in the file)'); return; }
    if (String(file[k]) !== String(all[k])) { keep.push(k + ' (the file says something else)'); return; }
    same.push(k);
  });

  if (reallyDelete !== true) {
    Logger.log('DRY RUN — nothing was deleted.');
    Logger.log('would delete ' + same.length + ': ' + same.join(', '));
    Logger.log('');
    Logger.log('kept (' + keep.length + '):');
    Logger.log('  ' + keep.join('\n  '));
    Logger.log('');
    Logger.log('When that reads right: runPruneScriptProps(true)');
    return { would_delete: same.length, kept: keep.length };
  }

  var gone = 0, failed = [];
  same.forEach(function (k) {
    try { props.deleteProperty(k); gone++; } catch (e) { failed.push(k); }
  });
  HUB_ID_CACHE = null;
  try {
    hubSysLog_(hubMasterEmail_(), 'script_props_pruned',
               gone + ' propert(ies) removed from the store — the file holds them now',
               { status: 200 });
  } catch (eL) {}
  Logger.log('deleted ' + gone + (failed.length ? '; failed: ' + failed.join(', ') : '') +
             '. The store now holds ' + Object.keys(props.getProperties()).length + '.');
  return { deleted: gone, failed: failed.length };
}

function runAllPropsToCode() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties() || {};
  var keys = Object.keys(all).sort();

  var out = [], owned = [];
  keys.forEach(function (k) {
    if (scriptPropIsRuntime_(k)) { owned.push(k); return; }
    out.push(scriptPropLine_(k, all[k], false));
  });
  if (owned.length) {
    out.push('');
    out.push('    // ═══ THE CODE WRITES THESE. Leave them commented: uncommented, ');
    out.push('    // ═══ each becomes a value the platform can never move again.');
    owned.forEach(function (k) {
      out.push('    // ' + "scriptProperties.setProperty('" + k + "', '" +
               scriptPropEsc_(all[k]) + "');   // the code owns it");
    });
  }

  Logger.log('---- paste inside propertieService() in Props.gs ----');
  Logger.log(out.join('\n'));
  Logger.log('---- end ----');
  Logger.log('');
  Logger.log(keys.length + ' propert(ies) read. ' + (keys.length - owned.length) +
             ' are safe in the file.');
  if (owned.length) {
    Logger.log(owned.length + ' are printed COMMENTED because the code writes them: ' +
               owned.join(', '));
  }
  Logger.log('');
  Logger.log('Paste, save, publish. Then runWipeScriptProps() for a dry run.');
  return { total: keys.length, safe: keys.length - owned.length, code_owned: owned.length };
}

// Dry run unless `true`; HUB_PII_SALT goes only with a second `true` (a new salt orphans every hash).
function runWipeScriptProps(reallyDelete, includeSalt) {
  var file = hubPropsFile_();
  if (!file || !Object.keys(file).length) {
    Logger.log('REFUSED: Props.gs holds nothing. Run runAllPropsToCode() first.');
    return { error: 'empty file' };
  }
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties() || {};
  var going = [], held = [];
  Object.keys(all).sort().forEach(function (k) {
    if (k === 'HUB_PII_SALT' && includeSalt !== true) {
      held.push(k + ' (the salt — pass a second true to include it)');
      return;
    }
    if (scriptPropInFile_(k)) { going.push(k); return; }
    if (scriptPropIsRuntime_(k)) { going.push(k); return; }
    held.push(k + ' (NOT in the file — it would simply be lost)');
  });

  if (reallyDelete !== true) {
    Logger.log('DRY RUN — nothing was deleted.');
    Logger.log('would delete ' + going.length + ': ' + going.join(', '));
    Logger.log('');
    Logger.log('held back (' + held.length + '):');
    Logger.log('  ' + (held.join('\n  ') || '(nothing)'));
    Logger.log('');
    Logger.log('When that reads right: runWipeScriptProps(true)');
    return { would_delete: going.length, held: held.length };
  }

  var gone = 0, failed = [];
  going.forEach(function (k) {
    try { props.deleteProperty(k); gone++; } catch (e) { failed.push(k); }
  });
  HUB_ID_CACHE = null;
  try {
    hubSysLog_(hubMasterEmail_(), 'script_props_wiped',
               gone + ' propert(ies) deleted — the code holds them now', { status: 200 });
  } catch (eL) {}
  var left = Object.keys(props.getProperties() || {});
  Logger.log('deleted ' + gone + (failed.length ? '; failed: ' + failed.join(', ') : '') + '.');
  Logger.log(left.length + ' left in the store: ' + (left.join(', ') || '(empty)'));
  return { deleted: gone, left: left.length };
}
