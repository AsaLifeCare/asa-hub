/** MAR errors and missing-medication reports through the generic route() and its place door (Auth.gs hubMarErrorsGate_): the Medications desk's audience reads them, only a writer changes one, the service identity keeps its read, and everybody else is refused before any row is touched. The rows and the place are stood in for. */
function stMarErrorsDoor_(out) {
  var keep = { session: HUB_SESSION_USER, svc: HUB_IS_SERVICE_REQ, world: HUB_WORLD_CTX, tenant: HUB_TENANT_CTX,
               member: HUB_MEMBER_CTX, dyn: hubDynamicResources_, builder: appBuilderRegisterResources_,
               list: listRows_, update: updateRowById_, create: createRow_, remove: deleteRowById_ };
  var touched = [];
  try {
    HUB_WORLD_CTX = null;
    HUB_TENANT_CTX = null;
    HUB_MEMBER_CTX = null;
    HUB_IS_SERVICE_REQ = false;
    hubDynamicResources_ = function () { return {}; };
    appBuilderRegisterResources_ = function () {};
    listRows_ = function (res) { touched.push('list:' + res); return []; };
    updateRowById_ = function (res, p) { touched.push('update:' + res); return { id: p.id }; };
    createRow_ = function (res) { touched.push('create:' + res); return { id: 'new' }; };
    deleteRowById_ = function (res) { touched.push('delete:' + res); return {}; };
    var who = function (role) { return { id: 'u-' + role, email: role + '@example.org', role: role, client_key: role === 'client' ? 'CK1' : '' }; };
    var answer = function (res, action, user) {
      HUB_SESSION_USER = user;
      try {
        var payload = action === 'list' ? {} : action === 'create' ? { problem: 'x' } : { id: 'r1' };
        var r = route(res, action, payload, user);
        return r && r.status === 403 && /medication error records/.test(String(r.message)) ? '403' : 'open';
      } catch (e) {
        return 'threw:' + (e && e.message);
      } finally { HUB_SESSION_USER = null; }
    };
    ['marErrors', 'missingMedications'].forEach(function (res) {
      touched = [];
      var refused = ['staff', 'client', 'onboarding', 'interviewer'].map(function (role) {
        return [answer(res, 'list', who(role)), answer(res, 'create', who(role))].join('/');
      });
      stEq_(out, 'mar errors door: ' + res + ' refuses staff, a client, a trainee and an interviewer, read or write',
            refused.join(','), '403/403,403/403,403/403,403/403');
      stEq_(out, 'mar errors door: ' + res + ' refused before any row is touched', touched.join(','), '');
      stEq_(out, 'mar errors door: ' + res + ' is read by an admin, a director and a manager',
            ['admin', 'director', 'manager'].map(function (role) { return answer(res, 'list', who(role)); }).join(','),
            'open,open,open');
      stEq_(out, 'mar errors door: ' + res + ' is not written by a director',
            [answer(res, 'create', who('director')), answer(res, 'update', who('director')),
             answer(res, 'delete', who('director'))].join(','), '403,403,403');
      stEq_(out, 'mar errors door: ' + res + ' is written by an admin and a manager',
            [answer(res, 'create', who('admin')), answer(res, 'create', who('manager'))].join(','), 'open,open');
      stEq_(out, 'mar errors door: ' + res + ' keeps the service identity\'s read (the study)',
            answer(res, 'list', { id: 'svc', role: 'admin', is_service: true }), 'open');
    });
    HUB_SESSION_USER = null;
    var bare = hubMarErrorsGate_('marErrors', 'list');
    stEq_(out, 'mar errors door: a request with no session is refused', bare ? String(bare.status) : 'open', '403');
    HUB_IS_SERVICE_REQ = true;
    stEq_(out, 'mar errors door: a service request passes', hubMarErrorsGate_('marErrors', 'list') ? '403' : 'open', 'open');
    HUB_IS_SERVICE_REQ = false;
    stEq_(out, 'mar errors door: another resource is not the MAR books',
          hubMarErrorsGate_('teamTasks', 'update') ? '403' : 'open', 'open');
    stAssert_(out, 'mar errors door: route()\'s place door asks it for every verb',
              stCode_(hubPlaceGate_).indexOf('hubMarErrorsGate_(resource, action)') !== -1, '');
  } finally {
    HUB_SESSION_USER = keep.session;
    HUB_IS_SERVICE_REQ = keep.svc;
    HUB_WORLD_CTX = keep.world;
    HUB_TENANT_CTX = keep.tenant;
    HUB_MEMBER_CTX = keep.member;
    hubDynamicResources_ = keep.dyn;
    appBuilderRegisterResources_ = keep.builder;
    listRows_ = keep.list;
    updateRowById_ = keep.update;
    createRow_ = keep.create;
    deleteRowById_ = keep.remove;
  }
}
