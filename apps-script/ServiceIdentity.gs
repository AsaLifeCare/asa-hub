// ------------------------------------------------------------------ SERVICE IDENTITY — a machine that reads, and…
// It asks once per rebuild instead of once per person per screen, which is the whole point.

// Actions a machine may take.
var SERVICE_READ_ACTIONS = ['list', 'get', 'stamp', 'tabs', 'revs', 'resources',
 // ONE QUESTION INSTEAD OF SIX.
                            'hiringWhere',
                            // the matrix Registry table — switch, Last Read stamp, does-the-book-open — so flip day…
                            'hiringMatrixStatus',
                            // and a book judging one real subject: verdicts WITH the facts each rule asked…
                            'hiringMatrixEval',
                            // the JSON lane's READ half (Bundle.gs, C5).
                            'snapshotBundleLatest', 'snapshotBundlePlaces',
                            // the personal half of a place: one execution groups every owned row by its owner
                            'snapshotBundleOwned',
                            // the three Quo signing keys, so the relay can check a webhook signature this engine…
                            'quoWebhookKeys',
                            // the configuration every screen reads before it can paint, gathered once per cycle…
                            'configLane',
                            // WHOSE LINE A NUMBER IS (CommCalls.gs).
                            'commCallsWho',
                            // one house's Locations parts no slice may carry, held in the relay's memory behind its…
                            'locationPack',
                            // and one client's private and clinical parts, held the same way behind the same door…
                            'clientPack',
                            // and one SSA's overview, documents, activity and notes, held the same way behind the…
                            'ssaPack',
                            // and one family member's overview, documents, activity and notes, held the same way…
                            'familyPack',
                            // and the roster, every family member's overview and admin notes at once, held the same…
                            'familyIndexPack',
                            // and one candidate's sections, read from the Hiring app's own records, held the same…
                            'candidatePack',
                            // and one referral's sections, read from the Potential Clients app's own row, held the…
                            'clientCandidatePack',
                            // and one client's own view of Staff, held the same way and served to that client alone…
                            'staffClientPack',
                            // and one staff member's whole sections, held the same way behind the same door…
                            'staffPack'];

// THE NOT-A-READS THE SERVICE CLOCK MAY START.
var SERVICE_SWEEP_ACTIONS = ['staffAttendanceSweep', 'hotlineSweep', 'talentPipelineSync',
 // The hiring lane's own clock.
                             'hiringSweep',
 // The generic engine's clock: the rest books — everything that is not hiring's — get their condition verdicts…
                             'flowSweepNow',
                             'runtimeSweepNow',
                             'staffPerfRecompute', 'snapshotBundleBuild', 'snapshotBundleSweep',
                             'ispIntakeSweep', 'quoIngest',
 // THE FILE DIGESTER'S BELL (Digest.gs): relay rings every few minutes; the OCR, the verdicts and the Drive filing…
                             'digestSweep',
 // THE PLATFORM'S CONTACT LIST (ContactsSync.gs): the relay's hourly tick hands ops.employees over as ONE JSON and…
                             'peopleSyncFromPlatform',
                             // WHAT THE PLATFORM'S OWN LOG SAYS ABOUT EACH PERSON (Behavior.gs): the relay measures…
                             'behaviorSignalsIngest',
                             // WHAT THE GRAPH KNOWS ABOUT REACHING SOMEBODY (CommCortex.gs): the cortex lives…
                             'commRoutesIngest',
 // THE OBLIGATIONS SWEEP (CommRecord.gs): relay's hourly tick rings it; the six-hour window, the dial and the…
                             'commRecordSweep',
 // THE GATHER, ON DEMAND (GatherDatabase.gs): houses a lane mints are born in the platform account's Drive root…
                             'gatherDatabaseMove',
 // THE MAILBOX EAR (CommInbound.gs): e-mail has no door anybody knocks on, so the replies half of the answer back…
                             'commRepliesSweep',
                             // THE REPAIR PASS (CommRepair.gs): when the platform said something it later knows was…
                             'commRepairSweep',
                             // THE PUNCH RECORD (PsiPunches.gs): PsiAnywhere is the official time clock, and the…
                             'psiPunchesIngest',
                             // WHEN SOMEBODY CAN BE REACHED (CommWhen.gs): the window is computed in Python over…
                             'commWhenIngest',
                             // WHAT THE REPLIES TEACH (CommProposals.gs): the counter reads the pile nobody could…
                             'commProposalsIngest',
                             // WHAT THE PHONE LINES CARRIED (CommCalls.gs): seven months of transcripts read on the…
                             'commCallsIngest',
 // The phone-call lane's GAS half (CommCalls.gs): reads the transcripts inbox on the relay's bell and classifies…
                             'commCallsSweep',
 // THE PUNCH DOOR (StaffAlerts.gs).
                             'staffAttendancePunch',
                             // THE RELAY'S TEXT INBOX (Quo.gs): the messages webhook and the Quo pull are kept on…
                             'quoIngestBatch',
                             // RULE 13 (StaffAlerts.gs).
                             'staffShiftReminder',
                             // THE FULL PUNCH RECORD (PsiPunches.gs): every field of the punches, the client's half…
                             'psiPunchesFullIngest',
                             // event-rung (GUARDIAN_RELAY_EVENT_ACTIONS); appended so every pinned position holds
                             'openShiftCovered',            // CommOpenShiftCovered.gs
                             'recruitBookIngest', 'recruitTell', // CommRecruit.gs
                             'commMockWebIngest',           // CommMock.gs: held web notices
                             'callOffFromCalendar',         // CommCallOffForm.gs
                             'houseMedsIngest',             // HouseMeds.gs
                             // the punch board's first faults, handed to Support Requests (SupportDesk.gs), which…
                             'supportDeskPunch'];

/** When the DB spreadsheet last changed, ISO — the freshness probe's answer. */
function serviceDbStamp_() {
  return DriveApp.getFileById(hubId_('HUB_DB_ID')).getLastUpdated().toISOString();
}

// The role the service reads as.
var SERVICE_ROLE = 'manager';

// Compare without leaking length through timing.
function serviceSecretMatches_(given) {
  var expected = String(hubProp_('HUB_SERVICE_SECRET') || '');
  var got = String(given || '');
  // Unset property = the identity does not exist.
  if (expected.length < 20 || !got) return false;
  if (expected.length !== got.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= (expected.charCodeAt(i) ^ got.charCodeAt(i));
  }
  return diff === 0;
}

// The user object the router works with, for a machine.
function serviceUser_() {
  return {
    id: 'SVC_SNAPSHOT',
    email: 'snapshot@service.local',
    name: 'Snapshot builder',
    role: SERVICE_ROLE,
    is_service: true
  };
}

// Resolve a request that presents a service secret instead of a token.
function serviceIdentityFor_(body, action) {
  var secret = body && body.service_secret;
  if (!secret) return null;
  if (!serviceSecretMatches_(secret)) {
    hubSysLog_('snapshot@service.local', 'service_auth_failed', String(action || ''), { status: 401 });
    return null;
  }
  if (SERVICE_READ_ACTIONS.indexOf(String(action)) === -1 &&
      SERVICE_SWEEP_ACTIONS.indexOf(String(action)) === -1) {
    // The refusal is logged loudly: a machine trying to write is either a bug worth finding or a secret in the…
    hubSysLog_('snapshot@service.local', 'service_write_refused', String(action || ''), { status: 403 });
    return { refused: true };
  }
  return { user: serviceUser_() };
}

/** Editor helper: is the identity configured, without revealing the value. */
function debugServiceIdentity() {
  var v = String(hubProp_('HUB_SERVICE_SECRET') || '');
  var out = v.length >= 20
    ? 'configured (' + v.length + ' chars) — reads as ' + SERVICE_ROLE
    : (v ? 'set but too short (' + v.length + ' chars, needs 20+) — treated as absent' : 'not configured');
  Logger.log(out);
  return out;
}
