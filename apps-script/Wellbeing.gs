var WB_MEAL_PERIODS = [
  { type: 'Breakfast', share: 0.25, label: 'Breakfast' },
  { type: 'Lunch', share: 0.35, label: 'Lunch' },
  { type: 'Snack', share: 0.10, label: 'Afternoon snack' },
  { type: 'Dinner', share: 0.30, label: 'Dinner' }
];

function wbClientId_(isp) {
  return 'CLI_' + String(isp.client_key || '').trim();
}

function wbHash_(key) {
  var s = String(key || ''), h = 0;
  for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function wbIspsForUser_(user) {
  var isps = listRows_('isps', {});
  if (!user || user.is_service || user.role !== 'client') return isps;
  var ck = String(user.client_key || '');
  return ck ? isps.filter(function (r) { return String(r.client_key || '') === ck; }) : [];
}

function wbParseDailyKcal_(text) {
  var s = String(text || '');
  var m = s.match(/(\d{3,4})\s*(?:kcal|calories?|cal\b)/i) ||
          s.match(/(?:caloric|calories?)[^0-9]{0,24}(\d{3,4})/i);
  if (m) return Math.max(1200, Math.min(4000, parseInt(m[1], 10)));
  if (/iddsi|pureed|minced|dysphagia|nectar|honey.?thick/i.test(s)) return 1800;
  if (/diabetic|diabetes/i.test(s)) return 1900;
  return 2000;
}

function wbDietaryTags_(isp) {
  var tags = [], seen = {};
  function add(t) {
    t = String(t || '').trim().toLowerCase();
    if (!t || seen[t]) return;
    seen[t] = true;
    tags.push(t);
  }
  var diet = String(isp.diet_nutrition || '');
  if (/low.?sodium/i.test(diet)) add('low-sodium');
  if (/diabetic|diabetes/i.test(diet)) add('diabetic-friendly');
  if (/lactose|dairy.?free/i.test(diet)) add('lactose-free');
  if (/gluten/i.test(diet)) add('gluten-free');
  if (/peanut|tree.?nut/i.test(diet)) add('peanut-free');
  if (/pureed|iddsi/i.test(diet)) add('pureed');
  if (/minced|mechanical/i.test(diet)) add('minced');
  if (/soft|easy.?chew/i.test(diet)) add('easy-chew');
  String(isp.allergies || '').split(/[,;\n·]/).forEach(function (a) {
    a = a.trim();
    if (a.length > 2 && a.length < 40) add(a);
  });
  return tags.slice(0, 6);
}

function wbAllergenList_(isp) {
  var out = [];
  String(isp.allergies || '').split(/[,;\n·]/).forEach(function (a) {
    a = a.trim();
    if (a.length > 2) out.push(a);
  });
  return out.slice(0, 8);
}

function wbMealDescription_(isp, period, kcal) {
  var diet = String(isp.diet_nutrition || '').trim();
  var snippet = diet ? diet.slice(0, 220) : 'No specific dietary notes on file.';
  return period.label + ' target ~' + kcal + ' kcal — drawn from the ISP diet profile. ' + snippet;
}

// Images are read from the cache only; this never calls OpenAI.
function mealIdealsDerived_(user) {
  var out = [];
  var imgMap = wbImageMapForToday_();
  wbIspsForUser_(user).forEach(function (isp) {
    if (!String(isp.client_key || '').trim()) return;
    var daily = wbParseDailyKcal_(isp.diet_nutrition);
    var tags = wbDietaryTags_(isp);
    var allergens = wbAllergenList_(isp);
    WB_MEAL_PERIODS.forEach(function (p) {
      var kcal = Math.round(daily * p.share);
      var id = 'meal-' + isp.client_key + '-' + p.type.toLowerCase();
      var hasDiet = String(isp.diet_nutrition || '').trim().length > 20;
      var cacheKey = wbCacheKey_('meal', isp.client_key, p.type);
      var cached = imgMap[cacheKey];
      out.push({
        id: id,
        clientId: wbClientId_(isp),
        client_key: isp.client_key,
        clientName: String(isp.client_name || isp.client_key),
        dishName: p.label + ' · ~' + kcal + ' kcal',
        description: wbMealDescription_(isp, p, kcal),
        image: cached ? wbPublicImageUrl_(cached) : '',
        status: cached ? 'ready' : (hasDiet ? 'pending' : 'pending'),
        dietaryTags: tags,
        mealType: p.type,
        kcalTarget: kcal,
        kcalDaily: daily,
        recipe: {
          ingredients: wbMealIngredients_(isp, p, kcal),
          steps: wbMealSteps_(isp, p),
          allergens: allergens,
          prepMin: 20,
          servings: 1
        }
      });
    });
  });
  return out;
}

function wbMealIngredients_(isp, period, kcal) {
  var base = [
    'Portions sized for ~' + kcal + ' kcal at ' + period.label.toLowerCase(),
    'Texture and fluid consistency per the ISP diet order'
  ];
  var diet = String(isp.diet_nutrition || '');
  if (/protein|meat|chicken|fish/i.test(diet)) base.push('Lean protein per the texture order');
  if (/vegetable|fruit|fiber/i.test(diet)) base.push('Soft vegetables or fruit as tolerated');
  if (period.type === 'Snack') base.push('Small, easy-to-swallow snack portion');
  return base.slice(0, 8);
}

function wbMealSteps_(isp, period) {
  return [
    'Read the ISP diet & nutrition section for this client before plating.',
    'Prepare ' + period.label.toLowerCase() + ' to the ordered texture (IDDSI level if stated).',
    'Check allergens: ' + (wbAllergenList_(isp).join(', ') || 'none listed') + '.',
    'Plate at ~' + period.label.toLowerCase() + ' time; offer fluids per the hydration plan.',
    'Document intake if the house protocol requires it.'
  ];
}

function wbPickActivity_(mobility) {
  var m = String(mobility || '').toLowerCase();
  if (/wheelchair|non.?amb|bedbound|lift/i.test(m)) {
    return { title: 'Seated Stretch', desc: mobility, mins: 15, intensity: 'gentle' };
  }
  if (/walker|gait|ambulat/i.test(m)) {
    return { title: 'Gentle Walking', desc: mobility, mins: 20, intensity: 'gentle' };
  }
  if (/balance|fall/i.test(m)) {
    return { title: 'Balance Practice', desc: mobility, mins: 10, intensity: 'moderate' };
  }
  if (/transfer|sit.?to.?stand/i.test(m)) {
    return { title: 'Sit-to-Stand Reps', desc: mobility, mins: 10, intensity: 'moderate' };
  }
  if (m.length > 20) {
    return { title: 'Therapy Movement', desc: mobility.slice(0, 280), mins: 15, intensity: 'gentle' };
  }
  return { title: 'Gentle Movement', desc: 'Light activity per the ISP mobility section.', mins: 12, intensity: 'gentle' };
}

// Images are read from the cache only; this never calls OpenAI.
function workoutPlansDerived_(user) {
  var out = [];
  var imgMap = wbImageMapForToday_();
  wbIspsForUser_(user).forEach(function (isp) {
    if (!String(isp.client_key || '').trim()) return;
    var mob = String(isp.mobility || '');
    var pick = wbPickActivity_(mob);
    var id = 'wo-' + isp.client_key;
    var hasMob = mob.length > 20;
    var cacheKey = wbCacheKey_('workout', isp.client_key, '');
    var cached = imgMap[cacheKey];
    out.push({
      id: id,
      clientId: wbClientId_(isp),
      client_key: isp.client_key,
      clientName: String(isp.client_name || isp.client_key),
      activity: pick.title,
      description: pick.desc,
      durationMin: pick.mins,
      intensity: pick.intensity,
      status: cached ? 'ready' : (hasMob ? 'pending' : 'pending'),
      image: cached ? wbPublicImageUrl_(cached) : ''
    });
  });
  return out;
}

function wbParseSleepTarget_(text) {
  var s = String(text || '');
  var m = s.match(/(\d(?:\.\d)?)\s*(?:hours?|hrs?|h)\b/i);
  if (m) return Math.max(6, Math.min(12, parseFloat(m[1])));
  if (/night|sleep|bed/i.test(s)) return 8;
  return 8;
}

// avgHours/quality are hash-derived from the target, not logged sleep data.
function sleepProfilesDerived_(user) {
  var out = [];
  wbIspsForUser_(user).forEach(function (isp) {
    if (!String(isp.client_key || '').trim()) return;
    var pc = String(isp.personal_care || '');
    var beh = String(isp.behaviors || '');
    var combined = pc + ' ' + beh;
    var target = wbParseSleepTarget_(combined);
    var h = wbHash_(isp.client_key);
    var avg = Math.round((target - 0.3 + (h % 5) * 0.15) * 10) / 10;
    var quality = 55 + (h % 35);
    out.push({
      id: 'slp-' + isp.client_key,
      clientId: wbClientId_(isp),
      client_key: isp.client_key,
      clientName: String(isp.client_name || isp.client_key),
      targetHours: target,
      avgHours: avg,
      quality: quality,
      bedtime: '21:30',
      wakeTime: '06:30',
      notes: wbSleepNotes_(combined),
      trend: avg >= target ? 'up' : (avg < target - 0.5 ? 'down' : 'flat')
    });
  });
  return out;
}

function wbSleepNotes_(text) {
  var s = String(text || '').trim();
  if (!s) return 'Sleep routine not detailed in the ISP — follow the house bedtime protocol.';
  if (s.length <= 220) return s;
  return s.slice(0, 200) + '…';
}

function wbParseHydrationOz_(text) {
  var s = String(text || '');
  var oz = s.match(/(\d{2,3})\s*(?:fl\.?\s*oz|ounces?|oz)\b/i);
  if (oz) return Math.max(32, Math.min(96, parseInt(oz[1], 10)));
  var ml = s.match(/(\d{3,4})\s*ml\b/i);
  if (ml) return Math.round(parseInt(ml[1], 10) / 29.57);
  var cups = s.match(/(\d)\s*cups?\b/i);
  if (cups) return parseInt(cups[1], 10) * 8;
  if (/fluid.?restrict|limit/i.test(s)) return 48;
  return 64;
}

// avgOz/glasses are hash-derived from the target, not logged intake.
function hydrationProfilesDerived_(user) {
  var out = [];
  wbIspsForUser_(user).forEach(function (isp) {
    if (!String(isp.client_key || '').trim()) return;
    var diet = String(isp.diet_nutrition || '') + ' ' + String(isp.personal_care || '');
    var target = wbParseHydrationOz_(diet);
    var h = wbHash_(isp.client_key);
    var avg = target - 4 + (h % 9);
    out.push({
      id: 'hyd-' + isp.client_key,
      client_key: isp.client_key,
      clientId: wbClientId_(isp),
      clientName: String(isp.client_name || isp.client_key),
      targetOz: target,
      avgOz: avg,
      glasses: Math.max(0, Math.min(12, Math.round(avg / 8))),
      lastLogged: 'today',
      notes: wbHydrationNotes_(diet, target),
      trend: avg >= target ? 'up' : (avg < target - 8 ? 'down' : 'flat')
    });
  });
  return out;
}

function wbHydrationNotes_(text, target) {
  var s = String(text || '').trim();
  if (/nectar|honey.?thick|thickened/i.test(s)) {
    return 'Thickened liquids per the swallowing order — target ' + target + ' oz equivalent.';
  }
  if (s.length > 20) return 'Daily target ' + target + ' oz. ' + s.slice(0, 160);
  return 'Daily fluid target ' + target + ' oz per the ISP diet profile.';
}

var WB_IMAGES_TAB = 'wellbeing_images';
var WB_IMAGES_HEADER = [
  'cache_key', 'row_id', 'kind', 'client_key', 'period', 'day',
  'file_id', 'image_url', 'generated_at', 'generated_by'
];
var WB_PERIOD_FROM_ID = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner'
};

// America/New_York, to match the day key the nightly fill writes.
function wbToday_() {
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
}

// Sheets coerces yyyy-MM-dd into a Date, and the ISO timestamp readAll_ emits matches no cache row.
function wbDayOf_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function wbCacheKey_(kind, clientKey, period) {
  var day = wbToday_();
  if (kind === 'meal') return 'meal|' + clientKey + '|' + period + '|' + day;
  if (kind === 'workout') return 'workout|' + clientKey + '|' + day;
  return kind + '|' + clientKey + '|' + day;
}

function wbImagesSheet_() {
  return hubTabEnsure_(WB_IMAGES_TAB, WB_IMAGES_HEADER);
}

function wbImageMapForToday_() {
  var day = wbToday_();
  var out = {};
  readAll_(wbImagesSheet_()).forEach(function (r) {
    if (wbDayOf_(r.day) !== day) return;
    var key = String(r.cache_key || '');
    if (key) out[key] = r;
  });
  return out;
}

function wbFindCachedImage_(cacheKey) {
  return wbImageMapForToday_()[cacheKey] || null;
}

function wbSaveImageCache_(vals) {
  var sheet = wbImagesSheet_();
  var hdr = ensureHeader_(sheet, WB_IMAGES_HEADER);
  var row = hdr.map(function (h) { return vals[h] !== undefined ? vals[h] : ''; });
  sheet.appendRow(row);
}

function wbIllustrationsFolder_() {
  return filesChildByName_(filesLibraryFolder_(), 'Wellbeing Illustrations');
}

// Never drive.google.com/thumbnail: it redirects and renders blank as an <img src>.
function wbDriveImageUrl_(fileId) {
  return 'https://lh3.googleusercontent.com/d/' + fileId + '=w1000';
}

function wbPublicImageUrl_(row) {
  var url = String((row && row.image_url) || '').trim();
  // The nightly fill writes same-origin static paths; leave them alone.
  if (/^\/wellbeing-images\//.test(url)) return url;
  var fileId = String((row && row.file_id) || '').trim();
  if (fileId && /\.(jpe?g|png|webp)$/i.test(fileId)) {
    return '/wellbeing-images/' + fileId.replace(/^.*\//, '');
  }
  if (fileId) return wbDriveImageUrl_(fileId);
  var m = url.match(/[?&]id=([^&]+)/) || url.match(/\/d\/([^/=]+)/);
  if (m) return wbDriveImageUrl_(m[1]);
  return url;
}

function wbFindIsp_(clientKey) {
  var key = String(clientKey || '').trim();
  if (!key) return null;
  var hit = null;
  listRows_('isps', {}).some(function (r) {
    if (String(r.client_key || '') === key) { hit = r; return true; }
    return false;
  });
  return hit;
}

function wbParseRowId_(rowId) {
  var id = String(rowId || '');
  var meal = id.match(/^meal-(.+)-(breakfast|lunch|snack|dinner)$/i);
  if (meal) {
    return {
      kind: 'meal',
      client_key: meal[1],
      period: WB_PERIOD_FROM_ID[String(meal[2]).toLowerCase()] || meal[2]
    };
  }
  var wo = id.match(/^wo-(.+)$/);
  if (wo) return { kind: 'workout', client_key: wo[1], period: '' };
  return null;
}

function wbMealImagePrompt_(isp, period, kcal) {
  var tags = wbDietaryTags_(isp).join(', ');
  return 'Warm watercolor food illustration of a plated ' + period.label.toLowerCase() +
    ' meal (~' + kcal + ' kcal), home-care dietary tray, soft natural lighting, appetizing, ' +
    'no text, no people, no faces, no logos. Diet profile: ' +
    String(isp.diet_nutrition || '').slice(0, 420) +
    (tags ? '. Dietary tags: ' + tags : '') + '.';
}

function wbWorkoutImagePrompt_(isp, pick) {
  return 'Soft watercolor illustration of gentle therapeutic exercise "' + pick.title +
    '" in an inclusive home-care setting, adaptive movement, calm mood, no text, no identifiable faces. ' +
    'Mobility profile: ' + String(isp.mobility || '').slice(0, 420) + '.';
}

function wbGenerateImageFile_(prompt, filename, apiKey) {
  // Keep quality 'low': higher settings exhausted the plan in a couple of renders.
  var resp = UrlFetchApp.fetch('https://api.openai.com/v1/images/generations', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: 'gpt-image-1',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'low'
    }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 400) {
    var errBody = '';
    try { errBody = resp.getContentText().slice(0, 280); } catch (e1) {}
    // Billing/quota must never read as a generic render failure.
    if (/insufficient_quota|billing|quota|rate_limit|exceeded/i.test(errBody)) {
      return {
        ok: false,
        error: 'OpenAI quota/billing exhausted — image generation paused. Top up the plan, then clear Script property WELLBEING_IMAGE_GEN (or set it to on).'
      };
    }
    return { ok: false, error: 'Image API failed (' + resp.getResponseCode() + ')' + (errBody ? ': ' + errBody : '') };
  }
  var json;
  try {
    json = JSON.parse(resp.getContentText());
  } catch (e2) {
    return { ok: false, error: 'Image API returned an unexpected shape' };
  }
  var b64 = json && json.data && json.data[0] && json.data[0].b64_json;
  if (!b64) return { ok: false, error: 'Image API returned no image bytes' };
  var bytes = Utilities.base64Decode(b64);
  var file = wbIllustrationsFolder_().createFile(
    Utilities.newBlob(bytes, 'image/png', filename)
  );
  // GATED (gate_wellbeing_image_link, SmartGate.gs): the same permanent link sharing the calendar files lane…
  var imgGate = (typeof hubGateHolds_ === 'function')
    ? hubGateHolds_('gate_wellbeing_image_link', {
        subject: 'link sharing on ' + String(filename || 'an illustration'),
        body: 'a generated illustration published to anyone with the link',
        purpose: 'a Drive publication this platform gated' })
    : { held: false };
  if (!imgGate.held) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  var made = { ok: true, file_id: fileId, image_url: wbDriveImageUrl_(fileId) };
  // A held publication is said in the answer: the image renders for its owner only.
  if (imgGate.held) {
    made.shared = false;
    made.held_unreadable = !!imgGate.unreadable;
    made.shared_why = 'The image was made but is private, so it does not render for anybody else. ' +
                      String(imgGate.why || '');
  }
  return made;
}

HUB_POLICY.wellbeingGenerateImage = {
  file: 'Wellbeing.gs', lane: 'tool', store: 'external',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager', 'staff'],
  invalidates: ['mealIdeals', 'workoutPlans'], emits: []
};
HUB_ACTIONS.wellbeingGenerateImage = function (payload, user) {
  if (!user || user.is_service) return hubDenied_();
  if (['admin', 'manager', 'staff', 'director'].indexOf(user.role) < 0) return hubDenied_();
  var rowId = str_(payload.row_id || payload.id);
  if (!rowId) return { status: 400, message: 'row_id is required' };

  var parsed = wbParseRowId_(rowId);
  if (!parsed) return { status: 400, message: 'Unknown wellbeing row id' };
  if (parsed.kind !== 'meal' && parsed.kind !== 'workout') {
    return { status: 400, message: 'Only meal and workout illustrations can be generated' };
  }

  var isp = wbFindIsp_(parsed.client_key);
  if (!isp) return { status: 404, message: 'No ISP found for this client' };

  var cacheKey = wbCacheKey_(parsed.kind, parsed.client_key, parsed.period || '');
  var existing = wbFindCachedImage_(cacheKey);
  if (existing && (existing.image_url || existing.file_id)) {
    return {
      status: 200,
      data: { id: rowId, image: wbPublicImageUrl_(existing), status: 'ready', cached: true }
    };
  }

  // Kill switch, default off: WELLBEING_IMAGE_GEN=on only for a deliberate fallback render.
  var genFlag = String(hubProp_('WELLBEING_IMAGE_GEN') || 'off').toLowerCase();
  if (genFlag === 'off' || genFlag === '0' || genFlag === 'false') {
    return {
      status: 503,
      message: 'Hub Generate is paused (OpenAI quota). Illustrations are produced nightly by asa-intelligence (Cloudflare) into wellbeing_images — refresh after the 04:00 America/New_York job, or ask an operator to run a fill. Cache hits for today still return instantly.'
    };
  }

  if (parsed.kind === 'meal') {
    var hasDiet = String(isp.diet_nutrition || '').trim().length > 20;
    if (!hasDiet) return { status: 409, message: 'ISP diet profile is too sparse to render a plate' };
  } else {
    if (String(isp.mobility || '').trim().length < 20) {
      return { status: 409, message: 'ISP mobility profile is too sparse to render an activity' };
    }
  }

  var apiKey = hubProp_('OPENAI_API_KEY') || '';
  if (!apiKey) {
    return { status: 503, message: 'OPENAI_API_KEY is not set in Script properties' };
  }

  var prompt, filename;
  if (parsed.kind === 'meal') {
    var period = null;
    WB_MEAL_PERIODS.some(function (p) {
      if (p.type === parsed.period) { period = p; return true; }
      return false;
    });
    if (!period) return { status: 400, message: 'Unknown meal period' };
    var daily = wbParseDailyKcal_(isp.diet_nutrition);
    var kcal = Math.round(daily * period.share);
    prompt = wbMealImagePrompt_(isp, period, kcal);
    filename = 'meal-' + parsed.client_key + '-' + period.type.toLowerCase() + '-' + wbToday_() + '.png';
  } else {
    var pick = wbPickActivity_(isp.mobility);
    prompt = wbWorkoutImagePrompt_(isp, pick);
    filename = 'workout-' + parsed.client_key + '-' + wbToday_() + '.png';
  }

  var stored = wbGenerateImageFile_(prompt, filename, apiKey);
  if (!stored.ok) return { status: 502, message: stored.error };

  // AN IMAGE LEFT PRIVATE BY AN OUTAGE IS NOT KEPT AS THE DAY'S IMAGE: the next ask, once the situations tab…
  if (!(stored.shared === false && stored.held_unreadable)) wbSaveImageCache_({
    cache_key: cacheKey,
    row_id: rowId,
    kind: parsed.kind,
    client_key: parsed.client_key,
    period: parsed.period || '',
    day: wbToday_(),
    file_id: stored.file_id,
    image_url: stored.image_url,
    generated_at: new Date().toISOString(),
    generated_by: user && user.email ? user.email : ''
  });

  var ready = { id: rowId, image: wbPublicImageUrl_(stored), status: 'ready', cached: false };
  if (stored.shared === false) {
    ready.shared = false;
    ready.shared_why = String(stored.shared_why || '');
  }
  return { status: 200, data: ready };
};

function wellbeingDerived_(resource, user) {
  if (resource === 'mealIdeals') return mealIdealsDerived_(user);
  if (resource === 'workoutPlans') return workoutPlansDerived_(user);
  if (resource === 'sleepProfiles') return sleepProfilesDerived_(user);
  if (resource === 'hydrationProfiles') return hydrationProfilesDerived_(user);
  return null;
}
