// THE COMPANY NOTICES AS SITUATIONS (NoticeSituations.gs), pinned.
// The situations reader is stood in for and put back in a `finally`; nothing here reaches a book.

/** One situation per notice kind, every one off, their switches carried to the relay. */
function stRepNoticeSituations_(out) {
  var keep = { sits: smartSituations_, memo: HUB_NOTICE_MEMO };
  try {
    var seeds = hubNoticeSeeds_();
    var others = {};
    SMART_EXTRA_SITUATIONS_SEED.concat(hubGateSeeds_(), hubAuthSeeds_(), hubLetterSeeds_(),
                                       hubDisabledLetterSeeds_(), hubLaneSeeds_())
      .forEach(function (s) { others[s.id] = true; });
    var ids = {};
    seeds.forEach(function (s) { ids[s.id] = true; });
    stAssert_(out, 'notices: one situation per notice kind, every one OFF, a letter of the relay\'s web ' +
                   'door with blank word cells and an id no other seed uses',
              seeds.length === HUB_NOTICE_KINDS.length && Object.keys(ids).length === seeds.length &&
              seeds.every(function (s) {
                return s.enabled === 'no' && s.kind === HUB_LETTER_KIND && s.channels === 'web' &&
                       s.id.indexOf(HUB_NOTICE_PREFIX) === 0 && !others[s.id] &&
                       !s.sms_text && !s.email_subject && !s.email_text;
              }), String(seeds.length));
    stAssert_(out, 'notices: the seeds are planted with the other families, and the config lane carries ' +
                   'their switches beside the gates — an unreadable tab as unreadable, never as a map',
              String(smartExtraSituations_).indexOf('hubNoticeSeeds_()') !== -1 &&
              String(HUB_ACTIONS.configLane).indexOf('notice_situations_unreadable') !== -1 &&
              String(HUB_ACTIONS.configLane).indexOf('hubNoticeSituationsRead_()') !== -1, '');

    HUB_NOTICE_MEMO = null;
    smartSituations_ = function () { return []; };
    var absent = hubNoticeSituationsRead_();
    HUB_NOTICE_MEMO = null;
    smartSituations_ = function () { throw new Error('the situations tab did not answer'); };
    var down = hubNoticeSituationsRead_();
    HUB_NOTICE_MEMO = null;
    smartSituations_ = function () {
      return [{ id: 'web_notice_call_off', enabled: 'yes' }, { id: 'web_notice_open_shift', enabled: 'no' }];
    };
    var some = hubNoticeSituationsRead_();
    var again = hubNoticeSituationsRead_();
    stAssert_(out, 'notices: a row not planted yet is off, an unreadable tab is unreadable with an empty ' +
                   'map, a switched-on row is on — read once per execution',
              absent.unreadable === '' && absent.map.web_notice_call_off === false &&
              down.unreadable !== '' && Object.keys(down.map).length === 0 &&
              some.map.web_notice_call_off === true && some.map.web_notice_open_shift === false &&
              some.map.web_notice_late_call === false && again === some,
              JSON.stringify([absent.unreadable, down.unreadable, some.map.web_notice_call_off]));
  } finally {
    smartSituations_ = keep.sits;
    HUB_NOTICE_MEMO = keep.memo;
  }
}
