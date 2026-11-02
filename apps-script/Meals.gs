// Meal tracker: one mealLog keyed by kind; the day's totals are computed, never stored.

var MEAL_KINDS = ['meal', 'water', 'supplement'];
var MEAL_TIMES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

var MEAL_MACROS = ['calories', 'protein', 'carbs', 'fat', 'fiber'];

function mealMayUse_(user) {
  return !!(user && !user.is_service && str_(user.id));
}

// Platform timezone, never toISOString(): UTC is already tomorrow late in the evening.
function mealToday_() {
  return Utilities.formatDate(new Date(), hiringTimeZone_(), 'yyyy-MM-dd');
}

function mealProfileOf_(user) {
  var me = str_(user.id);
  var hit = null;
  listRows_('mealProfile', {}).forEach(function (r) {
    if (str_(r.ownerId) === me) hit = r;
  });
  if (!hit) {
    var seed = { goalCalories: 2000, goalProtein: 0, goalCarbs: 0, goalFat: 0, goalFiber: 0, goalWaterOz: 64 };
    hit = createRow_('mealProfile', seed);
    // A refused write is not a profile: the goals still read, with no row behind them.
    if (sheetDbRefused_(hit)) { seed.id = ''; hit = seed; }
  }
  var out = { id: str_(hit.id) };
  MEAL_MACROS.forEach(function (m) {
    out['goal' + m.charAt(0).toUpperCase() + m.slice(1)] =
      finNum_(hit['goal' + m.charAt(0).toUpperCase() + m.slice(1)]);
  });
  out.goalWaterOz = finNum_(hit.goalWaterOz);
  return out;
}

function mealDay_(user, day) {
  var me = str_(user.id);
  var rows = listRows_('mealLog', {}).filter(function (r) {
    return str_(r.ownerId) === me && str_(r.day) === day;
  });
  var totals = { waterOz: 0 };
  MEAL_MACROS.forEach(function (m) { totals[m] = 0; });

  var entries = rows.map(function (r) {
    var kind = str_(r.kind) || 'meal';
    if (kind === 'water') {
      totals.waterOz += finNum_(r.amountOz);
    } else if (kind === 'meal') {
      MEAL_MACROS.forEach(function (m) { totals[m] += finNum_(r[m]); });
    }
    var e = { id: str_(r.id), kind: kind, day: str_(r.day), at: str_(r.at),
              description: str_(r.description), mealTime: str_(r.mealTime),
              amountOz: finNum_(r.amountOz), notes: str_(r.notes) };
    MEAL_MACROS.forEach(function (m) { e[m] = finNum_(r[m]); });
    return e;
  }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

  return { day: day, entries: entries, totals: totals, profile: mealProfileOf_(user) };
}

HUB_POLICY.mealDay = {
  file: 'Meals.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],           // per-person: see shopMayUse_ for why this is empty
  invalidates: [], emits: []
};
HUB_ACTIONS.mealDay = function (payload, user) {
  if (!mealMayUse_(user)) return hubDenied_();
  var day = str_(payload && payload.day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = mealToday_();
  return { status: 200, data: Object.assign(mealDay_(user, day),
                                            { kinds: MEAL_KINDS, times: MEAL_TIMES }) };
};

HUB_POLICY.mealLogAdd = {
  file: 'Meals.gs', lane: 'write', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.mealLogAdd = function (payload, user) {
  if (!mealMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var kind = MEAL_KINDS.indexOf(str_(p.kind)) === -1 ? 'meal' : str_(p.kind);
  var day = str_(p.day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = mealToday_();

  var row = { kind: kind, day: day, at: new Date().toISOString(),
              description: str_(p.description), notes: str_(p.notes) };

  if (kind === 'water') {
    var oz = finNum_(p.amountOz);
    if (!(oz > 0)) return { status: 400, message: 'How much did you drink?' };
    row.amountOz = oz;
  } else {
    if (!str_(p.description).trim()) return { status: 400, message: 'What did you have?' };
    if (kind === 'meal') {
      row.mealTime = MEAL_TIMES.indexOf(str_(p.mealTime)) === -1 ? 'Snack' : str_(p.mealTime);
      MEAL_MACROS.forEach(function (m) {
        var n = finNum_(p[m]);
        row[m] = n < 0 ? 0 : n;
      });
    }
  }

  var made = createRow_('mealLog', row);
  if (sheetDbRefused_(made)) return sheetDbRefused_(made);
  return { status: 200, data: Object.assign(mealDay_(user, day), { added: str_(made.id) }) };
};

HUB_POLICY.mealLogRemove = {
  file: 'Meals.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.mealLogRemove = function (payload, user) {
  if (!mealMayUse_(user)) return hubDenied_();
  var id = str_(payload && payload.id);
  if (!id) return { status: 400, message: 'Which entry?' };
  var out = deleteRowById_('mealLog', id);
  if (out.error) return out.error;
  var day = str_(payload && payload.day) || mealToday_();
  return { status: 200, data: mealDay_(user, day) };
};

HUB_POLICY.mealGoalsSet = {
  file: 'Meals.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: [],
  invalidates: [], emits: []
};
HUB_ACTIONS.mealGoalsSet = function (payload, user) {
  if (!mealMayUse_(user)) return hubDenied_();
  var p = payload || {};
  var prof = mealProfileOf_(user);
  var patch = { id: prof.id };
  MEAL_MACROS.forEach(function (m) {
    var key = 'goal' + m.charAt(0).toUpperCase() + m.slice(1);
    if (p[key] !== undefined) {
      var n = finNum_(p[key]);
      patch[key] = n < 0 ? 0 : n;
    }
  });
  if (p.goalWaterOz !== undefined) {
    var w = finNum_(p.goalWaterOz);
    patch.goalWaterOz = w < 0 ? 0 : w;
  }
  var row = updateRowById_('mealProfile', patch);
  if (row.error) return row.error;
  return { status: 200, data: mealProfileOf_(user) };
};
