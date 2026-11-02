/** Filing an incident or a repair: who may, what they send, and whose row it is. The sheet is stood in for. */
function stEstateFiling_(out) {
  var keep = { derived: clientsDerived_, sheet: estateSheet_ };
  var opened = 0;
  var person = function (role, extra) {
    var u = { id: 'u1', email: role + '@example.org', display_name: 'Pat ' + role, role: role };
    for (var k in (extra || {})) u[k] = extra[k];
    return u;
  };
  var reached = function (answer) { return !!answer && answer.status === 500 && /could not be opened/.test(answer.message); };
  try {
    clientsDerived_ = function () {
      return [{ client_key: 'nw1', name: 'Nakita Wade', home_address: '4045 Guilford Ave NW, Apt A' },
              { client_key: 'sb1', name: 'Sarina Bunting', home_address: '4045 Guilford Ave NW, Apt B' },
              { client_key: 'nh1', name: 'Nora Homeless', home_address: '' }];
    };
    // the gate is passed when the route goes on to open the sheet
    estateSheet_ = function () { opened++; return null; };

    var staff = person('staff');
    var sent = { client_name: 'Sarina Bunting', incident_category: 'Fall', summary_of_incident: 'Slipped.',
                 your_name: 'Somebody Else', bogus: 'x' };
    stAssert_(out, 'filing: staff file an incident, and the route goes on to the sheet',
              reached(estateRoute_('uiIncidents', 'create', sent, staff)), '');
    stAssert_(out, 'filing: a staff filer is the reporter, names any client, and sends only the form\'s columns',
              sent.your_name === 'Pat staff' && sent.client_name === 'Sarina Bunting' && !('bogus' in sent),
              JSON.stringify(sent));
    var repair = { select_address_vehicle: '1711 48th St NW', repair_type: 'Plumbing', urgency_level: '3',
                   please_describe_the_issue: 'Leak.', status: 'Done', resolution_notes: 'Fixed.' };
    stAssert_(out, 'filing: staff file a repair for any house, without the coordinator\'s columns',
              reached(estateRoute_('workOrders', 'create', repair, staff)) &&
              repair.select_address_vehicle === '1711 48th St NW' && !('status' in repair) &&
              !('resolution_notes' in repair), JSON.stringify(repair));

    var before = opened;
    stEq_(out, 'filing: staff still may not edit a repair', estateRoute_('workOrders', 'update', { id: 'r5' }, staff).status, 403);
    stEq_(out, 'filing: staff still may not remove an incident', estateRoute_('uiIncidents', 'delete', { id: 'r5' }, staff).status, 403);
    stEq_(out, 'filing: filing is only incidents and repairs', estateRoute_('drAppointments', 'create', {}, staff).status, 403);
    stEq_(out, 'filing: a new hire in onboarding does not file', estateRoute_('uiIncidents', 'create', {}, person('onboarding')).status, 403);
    stEq_(out, 'filing: an interviewer does not file', estateRoute_('workOrders', 'create', {}, person('interviewer')).status, 403);
    stEq_(out, 'filing: a service caller does not file',
          estateRoute_('workOrders', 'create', {}, person('staff', { is_service: true })).status, 403);

    var client = person('client', { client_key: 'nw1' });
    var mine = { client_name: 'Sarina Bunting', incident_category: 'Fall', summary_of_incident: 'Slipped.' };
    stAssert_(out, 'filing: a client files an incident, always about themselves',
              reached(estateRoute_('uiIncidents', 'create', mine, client)) && mine.client_name === 'Nakita Wade' &&
              mine.your_name === 'Pat client', JSON.stringify(mine));
    var theirs = { select_address_vehicle: '1711 48th St NW', repair_type: 'Door', status: 'Done' };
    stAssert_(out, 'filing: a client\'s repair is for their own street, whatever was sent',
              reached(estateRoute_('workOrders', 'create', theirs, client)) &&
              theirs.select_address_vehicle === '4045 Guilford Ave NW, Apt A' && !('status' in theirs),
              JSON.stringify(theirs));
    var spelled = { select_address_vehicle: '4045 Guilford Ave NW, Apt A, Canton', repair_type: 'Door' };
    stAssert_(out, 'filing: the house page\'s spelling of their own street is kept',
              reached(estateRoute_('workOrders', 'create', spelled, client)) &&
              spelled.select_address_vehicle === '4045 Guilford Ave NW, Apt A, Canton', JSON.stringify(spelled));

    var shut = opened;
    stEq_(out, 'filing: a client with no key files nothing',
          estateRoute_('uiIncidents', 'create', {}, person('client')).status, 404);
    stEq_(out, 'filing: a client not on file files nothing',
          estateRoute_('uiIncidents', 'create', {}, person('client', { client_key: 'zz9' })).status, 404);
    stEq_(out, 'filing: a client with no street on file files no repair',
          estateRoute_('workOrders', 'create', { repair_type: 'Door' }, person('client', { client_key: 'nh1' })).status, 404);
    stEq_(out, 'filing: a client still may not edit or remove',
          [estateRoute_('uiIncidents', 'update', { id: 'r5' }, client).status,
           estateRoute_('workOrders', 'delete', { id: 'r5' }, client).status].join(), '403,403');
    stEq_(out, 'filing: nothing refused ever reached the sheet', opened, shut);
    stAssert_(out, 'filing: nothing refused before the clients ever reached the sheet', before === 2, String(before));

    var admin = { status: 'In Progress', resolution_notes: 'Ordered.', repair_type: 'Door', bogus: 'x' };
    stAssert_(out, 'filing: an admin\'s create is untouched — the coordinator\'s columns stay',
              reached(estateRoute_('workOrders', 'create', admin, person('admin'))) && admin.status === 'In Progress' &&
              admin.bogus === 'x', JSON.stringify(admin));
  } finally {
    clientsDerived_ = keep.derived;
    estateSheet_ = keep.sheet;
  }
}
