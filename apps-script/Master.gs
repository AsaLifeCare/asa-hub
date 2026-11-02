// The master is the one account fixed in Auth.gs; every refusal here is 404, never 403.

/** Overview for the master role, locked to a single account whose profile carries more settings than any other user's. */
HUB_POLICY.masterOverview = {
  file: 'Master.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  // Admits admins so the handler runs; the handler answers 404 to every non-master.
  roles: ['admin'],
  invalidates: [], emits: []
};
HUB_ACTIONS.masterOverview = function (payload, user) {
  if (!user || user.is_service || String(user.role) !== 'admin') return hubDenied_();
  if (hubAwayTenant_()) return { status: 404, message: 'Unknown action.' };

  if (!hubIsMaster_(str_(user.email))) {
    return { status: 404, message: 'Unknown action: "masterOverview".' };
  }

  var sending = false;
  try { sending = (typeof rpcSendEnabled_ === 'function') && rpcSendEnabled_(); } catch (e1) {}
  var redirect = null;
  try { redirect = (typeof hubTestRedirect_ === 'function') ? hubTestRedirect_() : null; } catch (e2) {}

  // hub_sessions stores user_id, not email.
  var sessions = [];
  try {
    var emailById = {};
    usersAll_().forEach(function (u) { emailById[str_(u.userid)] = str_(u.email); });
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), SESSIONS_TAB).forEach(function (s) {
      var exp = new Date(str_(s.expiresat)).getTime();
      if (!isNaN(exp) && exp > Date.now()) {
        var who = emailById[str_(s.userid)] || str_(s.userid);
        // an acting session (BeAnother.gs) is the master, not its target signing in
        var real = str_(s.actingrealuserid);
        if (real) who = (emailById[real] || real) + ' — acting as ' + who;
        sessions.push({ email: who, last_seen: str_(s.lastseen) });
      }
    });
    sessions.sort(function (a, b) { return b.last_seen < a.last_seen ? -1 : 1; });
    if (sessions.length > 30) sessions = sessions.slice(0, 30);
  } catch (e3) { sessions = null; }   // null = unreadable, not "nobody"

  var armed = [];
  try {
    smartSituations_().forEach(function (s) {
      if (String(s.enabled).toLowerCase() === 'yes') {
        armed.push({ id: str_(s.id), to: str_(s.to), channels: str_(s.channels) });
      }
    });
  } catch (e4) { armed = null; }

  var admins = [];
  try {
    usersAll_().forEach(function (u) {
      if (str_(u.role) === 'admin' && !(typeof hubIsMasterRow_ === 'function' && hubIsMasterRow_(u))) {
        admins.push(str_(u.email));
      }
    });
  } catch (e5) { admins = null; }

  return { status: 200, data: {
    master: hubMasterEmail_(),
    transport: {
      sending: sending ? 'on' : 'off',
      test_mode: redirect ? 'on — redirecting to ' +
        [].concat(redirect.sms || [], redirect.emails || []).join(', ') : 'off — REAL recipients',
      kill_switch: 'Script Property HUB_RPC_SEND (off stops every send, any lane)'
    },
    sessions: sessions,
    armedSituations: armed,
    admins: admins
  } };
};
