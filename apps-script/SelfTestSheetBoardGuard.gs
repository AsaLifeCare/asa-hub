/** The task board opens only a workbook it made, and a card's workbook fields never ride the generic verbs. */
function stSheetBoardGuard_(out) {
  var keep = { folder: sheetBoardFolder_, drive: (typeof DriveApp !== 'undefined') ? DriveApp : undefined,
               away: hubAwayTenant_ };
  try {
    hubAwayTenant_ = function () { return false; };
    var created = { title: 'x', spreadsheet_id: 'HUB_DB_TYPED', spreadsheet_url: 'u', spreadsheet_name: 'n' };
    hubPlaceGate_('sheetTasks', 'create', created);
    var updated = { id: 'c1', spreadsheet_id: 'HUB_DB_TYPED' };
    hubPlaceGate_('sheetTasks', 'update', updated);
    stAssert_(out, 'sheet board: a typed workbook id never reaches a card through create or update',
              !('spreadsheet_id' in created) && !('spreadsheet_url' in created) && !('spreadsheet_name' in created) &&
              !('spreadsheet_id' in updated) && created.title === 'x', JSON.stringify([created, updated]));
    var other = { id: 'r1', spreadsheet_id: 'kept' };
    hubPlaceGate_('tasks', 'update', other);
    stAssert_(out, 'sheet board: other resources keep their own fields', other.spreadsheet_id === 'kept', '');

    var parentsOf = { MINE: ['F_ME'], PLATFORM: ['F_ROOT'] };
    sheetBoardFolder_ = function () { return { getId: function () { return 'F_ME'; } }; };
    DriveApp = {
      getFileById: function (id) {
        if (!parentsOf[id]) throw new Error('no such file');
        var list = parentsOf[id].slice();
        return { getParents: function () {
          return { hasNext: function () { return list.length > 0; },
                   next: function () { var f = list.shift(); return { getId: function () { return f; } }; } };
        } };
      }
    };
    var user = { id: 'U1', email: 'ann@example.org', role: 'staff' };
    stAssert_(out, 'sheet board: a workbook in the owner\'s board folder opens',
              sheetBoardOwnsFile_('MINE', user) === true, '');
    stAssert_(out, 'sheet board: a platform workbook typed into a card never opens',
              sheetBoardOwnsFile_('PLATFORM', user) === false, '');
    stAssert_(out, 'sheet board: a file Drive cannot read never opens (fail closed)',
              sheetBoardOwnsFile_('GONE', user) === false, '');
    sheetBoardFolder_ = function () { return null; };
    stAssert_(out, 'sheet board: no board folder means nothing opens',
              sheetBoardOwnsFile_('MINE', user) === false, '');
  } finally {
    sheetBoardFolder_ = keep.folder;
    DriveApp = keep.drive;
    hubAwayTenant_ = keep.away;
  }
}
