// HIRING SIMULATION CONFIG — every parameter of the rehearsal, configurable.
// IT IS A SIMULATION, so every parameter of it is a cell, never a constant: a rehearsal nobody can retune is a…

var HIRING_SIM_CFG_TAB = 'hiring_sim_config';
var HIRING_SIM_CFG_CACHE = 'hiring_sim_cfg_v1';

/** The attempt book. */
var HIRING_SIM_ASKS_TAB = 'hiring_sim_asks';
var HIRING_SIM_ASKS_HEADER = ['sim_ask_id', 'step', 'candidate_id', 'action', 'payload_json',
  'sent_count', 'max_attempts', 'interval_minutes', 'last_sent_at',
  'state', 'answered_at', 'answered_by', 'created_at'];

/** One AI verdict per team message, ever — this tab is the memory. */
var HIRING_SIM_AI_TAB = 'hiring_sim_ai';
var HIRING_SIM_AI_HEADER = ['message_id', 'verdict', 'names', 'via', 'seen_at'];

// THE DEFAULTS — the rehearsal's cast.
var HIRING_SIM_CFG_DEFAULTS = [
  { key: 'sim_mode', value: 'actors',
    note: 'actors = REAL sends to the configured actor mailboxes, real team in Cc — test mode ' +
          'should be OFF or it redirects everything to one tester. redirect = the old shape: ' +
          'test mode must be ON and every message goes to the single redirect address.' },
  { key: 'sim_candidate_email', value: 'asa-hub3@asaop.org',
    note: 'The fake candidate — the rehearsal card is created with this address, so every ' +
          'letter addressed to the candidate lands in this mailbox.' },
  { key: 'sim_candidate_phone', value: '+13309195558',
    note: 'The rehearsal card\'s phone (+1XXXXXXXXXX). Candidate SMS land here. The asatech ' +
          'line by default, so a reader sees what a candidate would receive.' },
  { key: 'sim_interviewer_name', value: '[TEST] Interviewer',
    note: 'The interviewer ACTOR\'s display name. A rehearsal card\'s interviewer ask goes to ' +
          'this actor and NEVER to the real badge holder — that routing is by the [TEST] name ' +
          'on the card, not by this cell.' },
  { key: 'sim_interviewer_email', value: 'asa-hub4@asaop.org',
    note: 'The interviewer actor\'s mailbox — the availability ask and the thank-you land here ' +
          'for rehearsal cards. Real candidates keep the INTERVIEWER badge resolution untouched.' },
  { key: 'sim_interviewer_phone', value: '',
    note: 'Optional. The interviewer actor\'s SMS number (+1XXXXXXXXXX). Blank = e-mail only, ' +
          'which is an ordinary interviewer since 2026-08-21.' },
  { key: 'sim_cc_emails',
    value: 'asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com',
    note: 'IN COPY ON EVERY CANDIDATE-FACING E-MAIL — the three ride in copy: the outreach, ' +
          'the call instruction, the scheduling link. Comma-separated; an address already in ' +
          'To is never doubled into Cc.' },
  { key: 'sim_watcher_emails', value: 'asatech@asalifecare.com',
    note: 'IN COPY ON TEAM LETTERS — asatech alone rides in copy. Team letters go ' +
          'To the deciders with THIS list in Cc — so all three read it, but To and Cc are ' +
          'never the same people twice.' },
  { key: 'sim_team_emails',
    value: 'asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com',
    note: 'WHO THE SIMULATION WRITES TO as "the team" — the ask, the shortlist, the decision. ' +
          'Blank falls back to hiring_team_emails. These are REAL addresses on purpose.' },
  { key: 'sim_decider_emails',
    value: 'arthur.torres@asalifecare.com, ty.bond@asalifecare.com',
    note: 'The two whose word starts the process (steps 2, 3 and 5): Arthur and Ty. Their ' +
          'replies are the ones the reader trusts; the thank-you and the "they said yes" go ' +
          'to them, with the copy list in Cc.' },
  { key: 'sim_team_sms',
    value: '+13309195559, +13309195558, +19377166410, +13309197779',
    note: 'The team\'s Quo numbers: Arthur (330) 919-5559 · asatech (330) 919-5558 · Ty Bond ' +
          '(937) 716-6410 and (330) 919-7779. Team SMS in the simulation go to these.' },
  { key: 'sim_decider_sms', value: '+13309195559, +19377166410',
    note: 'WHERE THE QUO NUDGES GO — one number per DECIDER (Arthur 5559, Ty 6410). The ' +
          'accepted notice and the decision nudge text THESE, not the whole team list ' +
          '(four numbers meant every notice arrived four times). ' +
          'Blank falls back to sim_team_sms.' },
  { key: 'sim_attempts', value: '1',
    note: 'HOW MANY TIMES a retryable send is tried until a reply arrives. The ' +
          'production intent is 5–7; it ships as 1 because these sends reach REAL mailboxes ' +
          'during the tests. Per-step overrides below win when filled.' },
  { key: 'sim_attempts_resume_request', value: '3',
    note: 'The referral ladder\'s FIRST rung: how many times the person themselves is ' +
          'written before the referrer is bothered. Ships at 3 — a human needs days, not ' +
          'sweep ticks; the ladder also waits the retry interval past the last send.' },
  { key: 'sim_retry_minutes_referral_relay', value: '120',
    note: 'Two hours between asks to the REFERRER for the candidate\'s contact: ' +
          'seven on the first day; a second seven starts the next Ohio morning.' },
  { key: 'sim_attempts_referral_relay', value: '7',
    note: 'The ladder\'s SECOND rung: how many times the referrer is asked before the ' +
          'discard (chapter d). Same quiet-interval law as above.' },
  { key: 'sim_retry_minutes', value: '30',
    note: 'Minutes between attempts — one ask every half hour. The sweep rides the service read ' +
          'traffic, so the real spacing is at least this and can be a few minutes more.' },
  { key: 'sim_attempts_manual_contact', value: '7',
    note: 'The Added Manually machine: how many times a hand-added ' +
          'candidate is written — both legs, text and letter — before the person who added ' +
          'them is bothered. The rule says seven.' },
  { key: 'sim_retry_minutes_manual_contact', value: '120',
    note: 'Minutes between the invitation tries. The rhythm is the ' +
          'same everywhere: seven times, one every two hours.' },
  // THE RUNG FOR THE PERSON WHO ANSWERED.
  { key: 'sim_attempts_manual_resume', value: '3',
    note: 'How many times a candidate who ANSWERED is asked for their résumé — text and ' +
          'letter — before the asking ends. Blank = these three (this step ships its own ' +
          'default). The folders are read first every time: a résumé already filed settles ' +
          'the ask instead of asking again.' },
  { key: 'sim_retry_minutes_manual_resume', value: '1440',
    note: 'Minutes between résumé asks — a day. Slower than the first contact on purpose: ' +
          'this person already answered, and a résumé takes longer to find than a reply. ' +
          'Blank = these 1440. Under 5 the platform IGNORES the cell.' },
  // THE THREE LADDERS THAT ASKED ONCE.
  { key: 'sim_attempts_interview_days', value: '7',
    note: 'How many times the interviewer is asked which days she can take — text AND letter ' +
          'each time — before the asking ends. It used to ask once: days_asked_at was ' +
          'written and read in one place in the whole tree, so an unopened link left the ' +
          'candidate\'s calendar unsent for good.' },
  { key: 'sim_retry_minutes_interview_days', value: '30',
    note: 'Half an hour between asks — one every half hour. Faster ' +
          'than the others on purpose: a candidate is waiting on the other side of it, and ' +
          'opening a link is a moment, not an errand. Blank = these 30.' },
  // THE LADDERS — all on the one rhythm: every 2 hours, 7 times.
  { key: 'sim_attempts_phone_collect', value: '7',
    note: 'E-mail-only candidate at New: how many times we ask BY LETTER for a phone ' +
          'number before the team is told collection failed.' },
  { key: 'sim_retry_minutes_phone_collect', value: '120',
    note: 'Two hours between phone-collection letters.' },
  { key: 'sim_attempts_phone_confirm', value: '7',
    note: 'The number arrived: how many times the confirmation text — the one asking the ' +
          'candidate to reply YES — is sent before the team is told the phone could not be confirmed.' },
  { key: 'sim_retry_minutes_phone_confirm', value: '120',
    note: 'Two hours between confirmation texts.' },
  { key: 'sim_attempts_interview_slots', value: '7',
    note: 'How many times the interviewer is asked for her slots — three on the first ' +
          'round, six when the candidate says none of them work.' },
  { key: 'sim_retry_minutes_interview_slots', value: '120',
    note: 'Two hours between slot asks.' },
  { key: 'sim_attempts_onboarding_finish', value: '7',
    note: 'Somebody began the onboarding and closed the tab: how many finish-your-' +
          'onboarding letters — each carrying the login link and password — before ' +
          'Arthur and Ty are told.' },
  { key: 'sim_retry_minutes_onboarding_finish', value: '120',
    note: 'Two hours between finish-your-onboarding letters.' },
  { key: 'sim_manual_armed_from', value: '',
    note: 'BLANK = the stamped arming date stands (the machine speaks only to cards born ' +
          'after it first ran, so a publish never surprises a standing board). An ISO date ' +
          'here OVERRIDES that stamp — 2026-08-01 means "speak to everybody at New created ' +
          'on or after the 1st of August". Written for the five real candidates who became ' +
          'permanently unreachable by accident of calendar, and who were also holding the ' +
          'release floor shut. Clearing the cell puts the original protection straight back.' },
  { key: 'sim_attempts_screen_call', value: '7',
    note: 'How many times somebody standing at Phone Screen is asked to call the ' +
          'evaluation line — text AND letter each time. The message existed and nothing ' +
          'ever sent it; three people had been waiting over a month.' },
  { key: 'sim_retry_minutes_screen_call', value: '120',
    note: 'Two hours between screening-call asks — the standing rhythm, with ' +
          'the message naming the two-day window. Under 5 the platform IGNORES the cell.' },
  { key: 'sim_attempts_packet_request', value: '7',
    note: 'How many times a new hire at Onboarding is asked for the signed New Hire ' +
          'packet — text AND letter each time. It used to ask once, on arrival, and never ' +
          'again: the sweep gated on packet_requested_at and wrote that stamp itself.' },
  { key: 'sim_retry_minutes_packet_request', value: '1440',
    note: 'A day between packet asks. Blank = these 1440. Under 5 the platform IGNORES it.' },
  { key: 'sim_attempts_ready_ask', value: '7',
    note: 'How many times the deciders are asked whether somebody who finished onboarding ' +
          'may move to Ready to Start. It used to be "asked once, ever".' },
  { key: 'sim_retry_minutes_ready_ask', value: '1440',
    note: 'A day between asks to the deciders. Blank = these 1440.' },
  { key: 'sim_test_candidate_ids', value: '',
    note: 'REHEARSAL CARDS BY ID, comma-separated, and they belong in the config rather ' +
          'than in code. A test card whose phone and address look real cannot be claimed by ' +
          'the predicate\'s rules, so its id is named — here, without touching code. ' +
          'Merged with the shipped list (the Jhonatan and Devona cards); production never ' +
          'texts these, the rehearsal machinery owns them, and the test-card archiver may ' +
          'sweep them after a quiet week.' },
  { key: 'sim_archive_test_days', value: '7',
    note: 'Days a REHEARSAL card may sit untouched on the board before it is archived ' +
          '— a test card may be removed, but only once it is more than 7 days old. ' +
          'It is the last touch that counts, not the birth, so a walk in progress is never ' +
          'swept out from under whoever is walking it. Only cards commsIsTestCandidate_ ' +
          'claims are touched. 0 switches the sweep off — and a rehearsal standing at New ' +
          'counts against the release floor exactly like a person.' },
  { key: 'sim_attempts_manual_adder', value: '2',
    note: 'The Added Manually machine\'s second rung: how many times whoever ADDED the card ' +
          'is asked — withdraw, or reach them yourself — before the silent discard.' },
  { key: 'sim_retry_minutes_manual_adder', value: '720',
    note: 'Minutes between the adder asks — twelve hours. A per-step clock: it wins over ' +
          'sim_retry_minutes for this step alone.' },
  { key: 'sim_attempts_director_docs', value: '3',
    note: 'The director fast lane: how many times Arthur and Ty are ' +
          'asked for the pieces a fast-laned Onboarding card still lacks — the resume ' +
          'and/or the CJIS report — before the asking ends. The folder watch keeps looking ' +
          'every pass either way, and a late file still closes the ask.' },
  { key: 'sim_retry_minutes_director_docs', value: '720',
    note: 'Minutes between the director-docs asks — twelve hours. A per-step clock: it ' +
          'wins over sim_retry_minutes for this step alone.' },
  { key: 'sim_talent_finish_minutes', value: '10',
    note: 'THE FINISHER — the card stands for a few minutes and then finalizes itself, ' +
          'automatically. How many minutes somebody who already works here stands at Ready to ' +
          'Start after crossing from the Talent Pipeline before the platform closes their ' +
          'record. It touches ONLY cards the crossing door marked — never anybody a person ' +
          'put at Ready by hand.' },
  { key: 'sim_talent_autocross_per_pass', value: '10',
    note: 'THE AUTOMATIC CROSSING — the crossing is a process the platform runs by itself. ' +
          'How many signed applications the platform may bring onto the board by itself in one ' +
          'pass. It exists so a bad day cannot mint a hundred cards before anybody notices; the ' +
          'rest wait for the next pass, minutes later. 0 turns the automatic crossing OFF and ' +
          'the queue in Actions goes back to being the only door.' },
  { key: 'sim_talent_autocross_backlog', value: 'no',
    note: 'Whether the automatic crossing may also take applications signed BEFORE it was ' +
          'armed — the 130 already waiting. "no" (the default) means only somebody who signs ' +
          'from now on comes in by itself, and the backlog stays a press in Actions, one name ' +
          'at a time. Say "yes" to let the machine work through the backlog too, at ' +
          'sim_talent_autocross_per_pass a pass.' },
  { key: 'sim_talent_autofill_new_floor', value: '2',
    note: 'THE FLOOR UNDER THE RELEASE — with nobody monitoring and fewer than 2 candidates ' +
          'standing at New, the first 3 in the queue are taken. When fewer ' +
          'than this many cards stand at New AND no person has moved a card for ' +
          'sim_talent_autofill_idle_hours, the platform brings in the queue\'s next few by ' +
          'itself. 0 turns it off and the release stays entirely a person\'s press.' },
  { key: 'sim_talent_autofill_take', value: '3',
    note: 'How many the platform starts when the board has run dry and nobody is watching. They ' +
          'come in through the SAME door a press uses, so the duplicate check, the contact guard ' +
          'and the landing are all re-asked.' },
  { key: 'sim_talent_autofill_idle_hours', value: '12',
    note: 'How many hours without a PERSON moving any card count as "nobody is monitoring". The ' +
          'evidence is log_status_history, which every status write appends to with its actor; a ' +
          'machine actor is not somebody watching, or the sweeps would keep each other awake and ' +
          'this would never fire.' },
  { key: 'sim_attempts_ready_parked', value: '4',
    note: 'THE PARKING MACHINE — seven days, and configurable. How ' +
          'many times the deciders are told that somebody has stood at Ready to Start with ' +
          'nobody scheduling them. The clock renews itself after each notice; this is what ' +
          'stops it renewing forever. The asking ends by itself the moment the card leaves ' +
          'Ready — it never waits for a reply.' },
  { key: 'sim_retry_minutes_ready_parked', value: '10080',
    note: 'THE SEVEN DAYS, in the minutes every other clock here is written in: 10080 = 7 × ' +
          '24 × 60. It is the whole parking length — the first notice goes when somebody has ' +
          'stood at Ready this long, and each notice pushes the next one out by the same. ' +
          'Change this ONE cell to change what "parked too long" means.' },
  { key: 'sim_attempts_ask', value: '',
    note: 'Attempts for step 0 (the "are we hiring?" ask). Blank = sim_attempts. The ' +
          'intended number for this one is 5.' },
  { key: 'sim_attempts_shortlist', value: '',
    note: 'Attempts for step 1 (the ranked shortlist). Blank = sim_attempts. The ' +
          'intended number for this one is 7.' },
  // "BLANK = sim_attempts" WAS TRUE UNTIL THIS STEP SHIPPED A DEFAULT .
  /**
 * SEVEN TIMES IN ONE DAY — the outreach is tried 7 times over 1 day.
   * The note below it already said the intended number was 7
   * while the cell shipped BLANK, so it fell to
   * the global 1 and the promise was never kept.
   *
   * It is a shipped DEFAULT rather than something to type in: the rule stands
   * on its own, so it is the platform's behaviour, not a knob anybody has to
   * remember. Anything typed into the cell still wins.
   *
   * ONE TRY IS WHAT CLOGS THE PIPE, not what floods it. The release is already
   * cadenced — three come in when New drops below two — so a candidate who
   * misses a single SMS keeps standing at New, New never falls under the
   * floor, and the whole queue stops behind them.
   */
  { key: 'sim_attempts_outreach', value: '7',
    note: 'Attempts for step 4 (the candidate outreach, SMS + e-mail). Seven, ' +
          'spread across one day by sim_retry_minutes_outreach. Blank = these ' +
          'seven (this step ships its own default) — NOT sim_attempts.' },
  { key: 'sim_retry_minutes_outreach', value: '205',
    note: 'The wait between outreach attempts. 7 x 205 minutes covers just under ' +
          'a day, which is what "seven times in one day" means when nobody is ' +
          'awake for all of it. Blank = these 205 (this step ships its own ' +
          'default) — NOT sim_retry_minutes. Under 5 the platform IGNORES the ' +
          'cell and falls back to the global.' },
  { key: 'sim_attempts_invite', value: '',
    note: 'Attempts for step 9 (the scheduling link). Blank = sim_attempts.' },
  { key: 'sim_quo_identify', value: 'yes',
    note: 'yes = every simulation SMS opens by saying WHO is writing and WHY — the ' +
          'identification comes first, then the purpose. The messages leave through the shared Quo line, and a ' +
          'text from an unnamed number is a text people delete.' },
  { key: 'sim_quo_intro', value: 'ASA LifeCare hiring (asa-hub platform) — {purpose}. ',
    note: 'The identification line itself. {purpose} is filled by the step that sends. ' +
          'Blank falls back to the shipped sentence.' },
  { key: 'sim_screen_line', value: '+13307544040',
    note: 'The interview evaluation line the candidate is told to CALL for the phone screen ' +
          '— the personal evaluation happens on our own interview number. The 4040 ' +
          'line is where the transcripts the automation watches come from.' },
  { key: 'sim_transcript_from', value: '',
    note: 'Step 8: which candidate\'s REAL transcript seeds the rehearsal phone screen ' +
          '(a CAN_ id). Blank = the newest completed screen with a transcript on file. ' +
          'A transcript is taken from the database so the call does not have to be made again ' +
          'every time.' },
 // THE WORDS LIVE IN THESE CELLS: the text of an e-mail or a message must be reachable, changeable and savable…
  { key: 'sim_text_ask_subject',
    note: 'Step 0 e-mail subject. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_ask_body',
    note: 'Step 0 body. The analyzed-pool count and the "reply to this message" line always ' +
          'ride along. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_outreach_sms',
    note: 'Step 4 SMS. THE ONLY NAME IN IT IS THE CANDIDATE\'S — ' +
          'the company speaks as the company. Placeholders: {first_name} {name} ' +
          '{recruiter}. The Quo identification line (sim_quo_intro) opens the text. Clear ' +
          'the cell to return to the shipped words.' },
  { key: 'sim_text_outreach_email_subject',
    note: 'Step 4 e-mail subject. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_outreach_email_body',
    note: 'Step 4 e-mail body. THE ONLY NAME IN IT IS THE CANDIDATE\'S ' +
          '— the company speaks as the company. Placeholders: {first_name} ' +
          '{name} {recruiter}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_accepted_body',
    note: 'Step 5 body (to the deciders). Placeholders: {name} {reply} {phone}. Clear the ' +
          'cell to return to the shipped words.' },
  { key: 'sim_text_screen_call_body',
    note: 'Step 5.2 body — the reply telling the candidate to call the evaluation line. ' +
          'Placeholders: {first_name} {name} {line}. Clear the cell to return to the shipped ' +
          'words.' },
  { key: 'sim_text_screen_call_subject',
    note: 'Step 5.2 e-mail subject. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_screen_call_sms',
    note: 'Step 5.2 SMS. Placeholders: {first_name} {name} {line}. Clear the cell to return ' +
          'to the shipped words.' },
  { key: 'sim_text_welcome_subject',
    note: 'The welcome letter\'s subject ("the pipeline is open", to the team). Clear the ' +
          'cell to return to the shipped words.' },
  { key: 'sim_text_welcome_body',
    note: 'The welcome letter\'s body. The who-can-open-it fact rides along. Clear the cell ' +
          'to return to the shipped words.' },
  { key: 'sim_text_shortlist_subject',
    note: 'Step 1 subject. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_shortlist_body',
    note: 'Step 1 INTRO — the words above the ranked table. The table, the criteria and ' +
          'the reply instruction always ride along. Clear the cell to return to the shipped ' +
          'words.' },
  { key: 'sim_text_thanks_subject',
    note: 'Step 3 subject. NO DSP name in the title — the name never goes at the top. ' +
          'Clear the cell to return to the shipped words.' },
  { key: 'sim_text_thanks_body',
    note: 'Step 3 body — the thank-you to the deciders. {about} = EVERY chosen name, joined ' +
          '(5 chosen, 5 in the letter). Placeholders: {who} {about}. Clear the cell to ' +
          'return to the shipped words.' },
  { key: 'sim_text_accepted_subject',
    note: 'Step 5 subject. Placeholder: {name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_accepted_sms',
    note: 'Step 5 Quo message to the team. Placeholders: {name} {phone}. The identification ' +
          'line opens it. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_resume_request_subject',
    note: 'Step 5.5 subject (the resume-and-phone ask). It OPENS WITH "REFERRAL -" because ' +
          'this lane exists for referred people. Clear the cell to ' +
          'return to the shipped words.' },
  { key: 'sim_text_resume_request_body',
    note: 'Step 5.5 body — the ask: a phone AND/OR a resume, plus ' +
          'their interest in a selection process. Placeholders: {first_name} {name} ' +
          '{referrer}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_referral_relay_subject',
    note: 'The referral ladder (b/c): the letter to WHOEVER REFERRED a person we could not ' +
          'reach. Placeholders: {name} {first_name} {referrer}. Clear the cell to return ' +
          'to the shipped words.' },
  { key: 'sim_text_referral_relay_body',
    note: 'The referrer-relay letter\'s body (sent when the indications book holds a ' +
          'referrer e-mail). Placeholders: {name} {first_name} {referrer}. Clear the ' +
          'cell to return to the shipped words.' },
  { key: 'sim_text_referral_relay_sms',
    note: 'The referrer-relay text (sent when the indications book holds a referrer ' +
          'phone). Placeholders: {name} {first_name} {referrer}. Clear the cell to ' +
          'return to the shipped words.' },
  { key: 'sim_text_referral_discard_subject',
    note: 'The ladder\'s end (d): the ONE letter to Arthur and Ty when nobody had a ' +
          'phone or a resume. Placeholder: {name}. Clear the cell to return to the ' +
          'shipped words.' },
  { key: 'sim_text_referral_discard_body',
    note: 'The discard letter\'s body (team only, ONCE per candidate ever — the book ' +
          'state is the guard). The fact rows (stage, reason, when) ride along. ' +
          'Placeholders: {name} {referrer}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_manual_contact_subject',
    note: 'The Added Manually machine\'s first contact: the letter ' +
          'subject. No referrer is named — a colleague gave us the name. Placeholders: ' +
          '{name} {first_name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_manual_contact_body',
    note: 'The manual first-contact letter\'s body. Referrer-less on purpose: the company ' +
          'speaks as the company. Placeholders: {name} {first_name}. Clear the cell to ' +
          'return to the shipped words.' },
  { key: 'sim_text_manual_contact_sms',
    note: 'The manual first-contact text. The Quo identification line (sim_quo_intro) opens ' +
          'it. Placeholders: {name} {first_name}. Clear the cell to return to the shipped ' +
          'words.' },
  { key: 'sim_text_manual_resume_sms',
    note: 'Sent BY TEXT the moment the hand-added candidate answers anything at all — the ' +
          'reply itself is the return; the resume is what we ask next. THE RETURN LAW: ' +
          'a thing someone sends us always arrives BY E-MAIL or ' +
          'lands in the two special folders — never as a text attachment. Placeholders: ' +
          '{name} {first_name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_manual_adder_subject',
    note: 'The letter to WHOEVER ADDED the card, after a week of tries went unanswered. ' +
          'Placeholders: {name} {adder}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_manual_adder_body',
    note: 'The adder letter\'s body — the two questions: withdraw, or reach them ' +
          'yourself (the screen line starts the phone screening). Placeholders: {name} ' +
          '{first_name} {adder} {data} {screen_line}. Clear the cell to return to the ' +
          'shipped words.' },
  { key: 'sim_text_manual_adder_sms',
    note: 'The adder text, rides with the letter when their users row holds a number. ' +
          'Placeholders: {name} {adder} {screen_line}. Clear the cell to return to the ' +
          'shipped words.' },
  { key: 'sim_text_director_docs_subject',
    note: 'The director fast lane\'s ask: the letter to Arthur and ' +
          'Ty when a card placed straight at Onboarding still lacks its pieces. ' +
          'Placeholders: {name} {missing}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_director_docs_body',
    note: 'The director-docs letter\'s body — it names exactly what is missing and both ' +
          'return paths, and is honest about the reply path (the platform has no ' +
          'attachment ingest: a person files an e-mailed file; the folder is instant). ' +
          'Placeholders: {name} {missing}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_director_docs_sms',
    note: 'The director-docs Quo text to the deciders, rides with the letter. On a ' +
          'rehearsal card it is narrated, never sent. Placeholders: {name} {missing}. ' +
          'Clear the cell to return to the shipped words.' },
  { key: 'sim_text_cjis_request_subject',
    note: 'Step 3 subject (the folder-aware ask to the deciders). Placeholder: {name}. ' +
          'Clear the cell to return to the shipped words.' },
  { key: 'sim_text_cjis_request_body',
    note: 'Step 3 body (the candidate may have sent it, or Arthur ' +
          'pulls it himself and loads a relevant folder). The candidate fact rows and ' +
          'the folder button always ride along. Placeholders: {name} {status}. Clear ' +
          'the cell to return to the shipped words.' },
  { key: 'sim_text_cjis_nudge_sms',
    note: 'Step 3 Quo/OpenPhone nudge to the deciders, sent TOGETHER with the e-mail ' +
          '("mensagem via open phone pedindo para ele tirar o CJIS e carregar"). ' +
          'Placeholder: {name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_screen_redo_subject',
    note: 'Step 11 LOOP subject (the call-again letter). Placeholder: {name}. Clear the ' +
          'cell to return to the shipped words.' },
  { key: 'sim_text_screen_redo_body',
    note: 'Step 11 LOOP body — sent when a call ends without its goodbye. Placeholders: ' +
          '{name} {first_name} {line}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_screen_redo_sms',
    note: 'Step 11 LOOP text message, rides with the letter. Placeholders: {name} {line}. ' +
          'Clear the cell to return to the shipped words.' },
  { key: 'sim_text_onboarding_sms',
    note: 'Chapter 23 — the login BY TEXT, beside the letter. Placeholders: {first_name} ' +
          '{email} {password}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_ready_ask_subject',
    note: 'Chapter 25 subject (the deciders are asked). Placeholder: {name}. Clear the ' +
          'cell to return to the shipped words.' },
  { key: 'sim_text_ready_ask_body',
    note: 'Chapter 25 letter. Placeholders: {name} {notes} {link} (the candidate\'s ' +
          'profile on the platform). Clear the cell to return to the shipped words.' },
  { key: 'sim_text_ready_ask_sms',
    note: 'Chapter 25 OpenPhone text, rides with the letter. Placeholders: {name} ' +
          '{link} (the profile link, when it should ride in the text too). Clear ' +
          'the cell to return to the shipped words.' },
  { key: 'sim_text_ready_parked_subject',
    note: 'The parking notice\'s subject (the deciders are TOLD, never asked). Placeholders: ' +
          '{name} {days} {since} (the day they arrived) {link}. Clear the cell to return to ' +
          'the shipped words.' },
  { key: 'sim_text_ready_parked_body',
    note: 'The parking letter. Placeholders: {name} {days} {since} {link}. It asks for ' +
          'nothing on purpose: the card leaving Ready is what ends the asking, and a ' +
          'question nobody must answer is a question people stop reading. Clear the cell ' +
          'to return to the shipped words.' },
  { key: 'sim_text_ready_parked_sms',
    note: 'The parking OpenPhone text, rides with the letter. Placeholders: {name} {days} ' +
          '{since} {link}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_interviewer_days_subject',
    note: 'The days-ask to the interviewer (before the candidate\'s calendar). ' +
          'Placeholders: {name} {interviewer}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_interviewer_days_body',
    note: 'The days-ask letter (e-mail leg). Placeholders: {name} {interviewer} {link}. ' +
          'Clear the cell to return to the shipped words.' },
  { key: 'sim_text_interviewer_days_sms',
    note: 'The days-ask OpenPhone text, rides with the letter. Placeholders: {name} ' +
          '{link}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_interview_done_subject',
    note: 'Step 19 subject (the deciders are told the interview HAPPENED). ' +
          'Placeholders: {name} {interviewer}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_interview_done_body',
    note: 'Step 19 body (interviewer, candidate, score, comments — ' +
          'we only inform; somebody decides). Placeholders: {name} {interviewer} {score} ' +
          '{recommendation} {comments}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_decision_ask_subject',
    note: 'Step 8.7 subject (the release ask). Placeholder: {name}. Clear the cell to ' +
          'return to the shipped words.' },
  { key: 'sim_text_decision_ask_body',
    note: 'Step 8.7 INTRO — the score fact, the reading and the ADVANCE/DECLINE instruction ' +
          'always ride along, because the sweep reads the reply for exactly those words. ' +
          'Placeholder: {name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_decision_ask_sms',
    note: 'Step 8.7 Quo nudge to the deciders. NO "ASA Hub:" prefix — the Quo intro line ' +
          'already says who is writing (with the prefix it read doubled). Placeholder: {name}. ' +
          'Clear the cell to return to the shipped words.' },
  { key: 'sim_text_discard_subject',
    note: 'Step 11 subject. Placeholder: {name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_discard_body',
    note: 'Step 11 INTRO — the fact rows (stage, reason, when, who) always ride along. ' +
          'Placeholder: {name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_onboarding_subject',
    note: 'Step 15 subject (the new hire\'s own login letter). Placeholders: {first_name} ' +
          '{name}. Clear the cell to return to the shipped words.' },
  { key: 'sim_text_onboarding_body',
    note: 'Step 15 WELCOME — the credentials, the honest password sentence and the ' +
          'first-steps list always ride along. Placeholders: {first_name} {name}. Clear the ' +
          'cell to return to the shipped words.' },
  { key: 'sim_auto_reply', value: 'on',
    note: 'THE ACTORS ANSWER BY THEMSELVES — the mock has to answer automatically. ' +
          'on = each send answers itself: the deciders\' yes and choice ' +
          '(the injector, preset texts), the candidate\'s YES (a REAL SMS from the actor ' +
          'line and a REAL e-mail from the actor mailbox when wired, the injector always), ' +
          'the slot pick (the real public door), the interviewer\'s YES, and the ADVANCE ' +
          'release. Runs ONLY while the fence (sim_outbound_guard) is on and only on ' +
          'rehearsal work. off = every reply is a button press.' },
  { key: 'sim_recruiter_name', value: '',
    note: 'Who the outreach letter says wants to talk ("X would like to talk with you"). ' +
          'A name typed here ALWAYS wins. Blank = whoever made the choice (the decider ' +
          'whose reply picked the candidates), then the first of the team list.' },
  { key: 'sim_outbound_guard', value: 'on',
    note: 'THE FENCE: while on, the hiring lane may write ONLY to ' +
          'the configured cast — the team (Ty, Arthur, the watcher), the actor mailboxes ' +
          '(asa-hubN@asaop.org) and the listed numbers. A real candidate\'s address, any ' +
          'outside e-mail or number, is refused OUT LOUD — even with test mode OFF. Set to ' +
          'off only when the lane goes production.' },
  { key: 'sim_subject_tag', value: '[TEST] ',
    note: 'Prefixed to every hiring letter\'s subject while non-blank and the test-mode ' +
          'redirect is OFF (the redirect stamps its own tag) — so a rehearsal that reaches a ' +
          'REAL mailbox still says what it is — the test title stays on. ' +
          'CLEAR THIS CELL when the lane goes production.' },
  { key: 'sim_pretend_ask_reply',
    value: 'Yes — we are hiring. Send me the five you would call first.',
    note: 'STEP 0\'s RETURN BUTTON: the decider\'s fake reply the composer starts with ' +
          '(a plain yes, we are hiring). Editable before sending; the machine reads whatever ' +
          'is actually sent.' },
  { key: 'sim_pretend_interest_reply',
    value: 'We like {names} — proceed with all of them.',
    note: 'Step 2\'s answer — the decider\'s reply to the shortlist. {names} = every listed ' +
          'winner (so the card is born with ALL of them), {top} = the first. OK, names, or ' +
          '"more options" all read. Editable; the auto-actor sends it by itself.' },
  { key: 'sim_pretend_outreach_reply', value: 'YES — I am interested. When can we talk?',
    note: 'Step 4.5\'s composer preset — the candidate\'s reply to the first contact. ' +
          'A yes starts the whole acceptance flow. Editable before sending.' },
  { key: 'sim_pretend_interviewer_reply', value: 'YES',
    note: 'Step 10\'s composer preset — the interviewer actor\'s answer. YES books it, NO ' +
          'asks for three times. Editable before sending.' }
];

// ------------------------------------------------------------------ the tab…

// Seeded additively UNDER THE LOCK — the hiring_alerts_config lesson applied from birth: a duplicate key costs…
function hiringSimCfgSheet_() {
  var sheet = hubTabEnsure_(HIRING_SIM_CFG_TAB, ['key', 'value', 'note']);
  // Once the tab is dissolved the seeding stops: a missing key is already served by simCfgVal_'s shipped floor…
  if (typeof hiringTabDissolved_ === 'function' &&
      hiringTabDissolved_(HIRING_SIM_CFG_TAB)) return sheet;
  var values = sheet.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0] || '').trim();
    if (k) have[k] = true;
  }
  var missing = HIRING_SIM_CFG_DEFAULTS.filter(function (d) { return !have[d.key]; });
  if (missing.length) {
    var lock = LockService.getScriptLock();
    var held = false;
    try { held = lock.tryLock(10000); } catch (eL) { held = false; }
    try {
      if (held) {
        var fresh = sheet.getDataRange().getValues();
        var now = {};
        for (var j = 1; j < fresh.length; j++) {
          var fk = String(fresh[j][0] || '').trim();
          if (fk) now[fk] = true;
        }
        missing = missing.filter(function (d) { return !now[d.key]; });
      } else {
        missing = [];   // a key missing for one pass beats a duplicate forever
      }
      missing.forEach(function (d) {
        // hubCellSafe_: a default starting with '+' — the phone lists — reads as a formula and the cell becomes…
        sheet.appendRow([d.key, hubCellSafe_(str_(d.value) || simTextDefault_(d.key)), d.note]);
      });
    } finally {
      if (held) { try { lock.releaseLock(); } catch (eR) { /* released at exit */ } }
    }
    try { CacheService.getScriptCache().remove(HIRING_SIM_CFG_CACHE); } catch (e) { /* rebuilt */ }
  }
  return sheet;
}

/** The whole config as {key: value}, cached 60s. */
function hiringSimCfg_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(HIRING_SIM_CFG_CACHE);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* re-read */ }
  var values = hiringSimCfgSheet_().getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) cfg[key] = String(values[i][1] == null ? '' : values[i][1]);
  }
  try { cache.put(HIRING_SIM_CFG_CACHE, JSON.stringify(cfg), 60); } catch (e2) { /* uncached */ }
  return cfg;
}

/** One value, with the shipped default as the floor. */
function simCfgVal_(key) {
  var cfg = hiringSimCfg_();
  var v = str_(cfg[key]);
  if (v) return v;
  for (var i = 0; i < HIRING_SIM_CFG_DEFAULTS.length; i++) {
    if (HIRING_SIM_CFG_DEFAULTS[i].key === key) {
      return str_(HIRING_SIM_CFG_DEFAULTS[i].value) || simTextDefault_(key);
    }
  }
  return '';
}

// The shipped words of a sim_text_* row.
function simTextDefault_(key) {
  var k = String(key || '');
  if (k.indexOf('sim_text_') !== 0) return '';
  return bookText_('Strings', 'sim.text.' + k.slice(9), '');
}

/** A comma list out of a config cell. */
function simCfgList_(key) {
  return simCfgVal_(key).split(/[,;\n]+/)
    .map(function (s) { return s.trim(); }).filter(String);
}

// ------------------------------------------------------------------ the resolved cast…

// Everything the simulation needs to address a message, in one shape.
function hiringSimActors_() {
  var teamEmails = simCfgList_('sim_team_emails');
  if (!teamEmails.length) {
    try { teamEmails = hiringTeamRecipients_().emails || []; } catch (e) { teamEmails = []; }
  }
  var deciders = simCfgList_('sim_decider_emails')
    .filter(function (x) { return x.indexOf('@') !== -1; });
  if (!deciders.length) deciders = teamEmails.slice(0, 2);
  return {
    mode: simCfgVal_('sim_mode').toLowerCase() === 'redirect' ? 'redirect' : 'actors',
    screen_line: simCfgVal_('sim_screen_line'),
    watcher_emails: simCfgList_('sim_watcher_emails')
      .filter(function (x) { return x.indexOf('@') !== -1; }),
    candidate_email: simCfgVal_('sim_candidate_email'),
 // simSendablePhone_, NOT packetSendableNumber_: the cast rides the company's own SHARED lines on purpose, and the…
    candidate_phone: simSendablePhone_(simCfgVal_('sim_candidate_phone')),
    interviewer_name: simCfgVal_('sim_interviewer_name'),
    interviewer_email: simCfgVal_('sim_interviewer_email'),
    interviewer_phone: simSendablePhone_(simCfgVal_('sim_interviewer_phone')),
    cc_emails: simCfgList_('sim_cc_emails').filter(function (x) { return x.indexOf('@') !== -1; }),
    team_emails: teamEmails,
    decider_emails: deciders,
    team_sms: simCfgList_('sim_team_sms')
      .map(function (n) { return simSendablePhone_(n); })
      .filter(String),
 // One number per decider — the nudge lane ("4 vezes").
    decider_sms: simCfgList_('sim_decider_sms')
      .map(function (n) { return simSendablePhone_(n); })
      .filter(String)
  };
}

// The copy list for one send, WITHOUT doubling anybody already addressed.
function simCcFor_(to) {
  var have = {};
  String(to || '').split(/[,;\n]+/).forEach(function (x) {
    var k = x.trim().toLowerCase();
    if (k) have[k] = true;
  });
  return hiringSimActors_().cc_emails.filter(function (x) {
    return !have[x.toLowerCase()];
  }).join(', ');
}

// WHERE A TEAM LETTER GOES: all three receive it, with asatech alone in copy.
function simTeamAddress_() {
  var a = hiringSimActors_();
  var to = a.decider_emails.join(', ');
  var have = {};
  a.decider_emails.forEach(function (x) { have[x.toLowerCase()] = true; });
  var cc = a.watcher_emails.filter(function (x) { return !have[x.toLowerCase()]; }).join(', ');
  return { to: to, cc: cc };
}

/** Is this card (or candidate id) a rehearsal the simulation owns? */
function simIsRehearsalCid_(cid) {
  if (!cid) return false;
  try {
    var cand = hubEvidence_(str_(cid)).cand;
    return !!(cand && typeof packetIsRehearsal_ === 'function' && packetIsRehearsal_(cand));
  } catch (e) { return false; }
}

/** Attempts + interval for one step: per-step override, then the global. */
function simAttemptsFor_(stepId) {
  var per = parseInt(simCfgVal_('sim_attempts_' + String(stepId || '')), 10);
  var all = parseInt(simCfgVal_('sim_attempts'), 10);
 // The interval has per-step cells too: 'sim_retry_minutes_' + step wins over the global, so one machine can wait…
  var perMin = parseInt(simCfgVal_('sim_retry_minutes_' + String(stepId || '')), 10);
  var minutes = parseInt(simCfgVal_('sim_retry_minutes'), 10);
  var attempts = !isNaN(per) && per > 0 ? per : (!isNaN(all) && all > 0 ? all : 1);
  return { attempts: Math.min(attempts, 50),
           minutes: (!isNaN(perMin) && perMin >= 5) ? perMin
             : ((!isNaN(minutes) && minutes >= 5) ? minutes : 30) };
}

// The identification line a simulation SMS opens with — who is writing first, then why.
function simQuoIntro_(purpose) {
  if (simCfgVal_('sim_quo_identify').toLowerCase() !== 'yes') return '';
  var tpl = simCfgVal_('sim_quo_intro') ||
    'ASA LifeCare hiring (asa-hub platform) — {purpose}. ';
  return tpl.replace(/\{purpose\}/g, str_(purpose) || 'about your hiring process');
}

// ------------------------------------------------------------------ WHICH SITUATION ROW A SENDER SPEAKS THROUGH…

// THE BINDING TAB.
var COMM_BINDINGS_TAB = 'Smart Comms';
var COMM_BINDINGS_CACHE = 'hiring_comm_bindings_v2';
var COMM_BINDINGS_COMPILED_KEY = 'COMM_BINDINGS_COMPILED';
var COMM_BINDINGS_KEY_COL = 'Config ID';
var COMM_BINDINGS_VAL_COL = 'Smart Comms Situation ID';
var COMM_BINDINGS_FB_COL = 'Current Fallback';

var COMM_BINDINGS_DEFAULTS = [
  { key: 'hiring.welcome', value: 'hiring_welcome',
    note: 'hiringWelcomeSend — the welcome press.' },
  { key: 'hiring.ask', value: 'hiring_ask',
    note: 'hiringAskSend — the are-we-hiring ask to the deciders.' },
  { key: 'hiring.shortlist', value: 'hiring_shortlist',
    note: 'hiringShortlistCore_ — the ranked shortlist to the deciders.' },
  { key: 'hiring.outreach', value: 'hiring_outreach',
    note: 'hiringOutreachSms / hiringOutreachSend — the store-lane outreach.' },
  { key: 'hiring.first_contact', value: 'hiring_first_contact',
    note: 'manualContactSend + the manual ladder + hiringWhere.' },
  { key: 'hiring.resume.request', value: 'hiring_resume_request',
    note: 'hiringResumeRequestSend — the resume-and-phone ask to a referred person.' },
  { key: 'hiring.cjis.request', value: 'hiring_cjis_request',
    note: 'hiringCjisRequestSend — CJIS asked from the team, folder-first.' },
  { key: 'hiring.cjis.missing_at_interview', value: 'hiring_cjis_gate',
    note: 'interviewSave — the CJIS gate ask after Advance.' },
  { key: 'hiring.decision.request', value: 'hiring_decision_ask',
    note: 'hiringDecisionAskCore_ — the deciders asked to release.' },
  { key: 'hiring.screen.invitation', value: 'hiring_screen_call',
    note: 'hiringScreenCallSend + screenCallSweepMaybe_ — call the 4040.' },
  { key: 'hiring.screen.redo', value: 'hiring_screen_redo',
    note: 'screenRedoSweepMaybe_ — a cut call asked for one more try.' },
  { key: 'hiring.screen.report_ready', value: 'hiring_screen_report',
    note: 'screenReportAndAdvance_ — the AI report to the team.' },
  { key: 'hiring.date_accepted', value: 'hiring_date_accepted',
    note: 'hubDateAcceptedEscalate_ — a candidate accepted a date.' },
  { key: 'hiring.phone.collect', value: 'hiring_phone_collect',
    note: 'hiringPhoneCollectAsk — the e-mail-only phone ask ladder.' },
  { key: 'hiring.phone.confirm', value: 'hiring_phone_confirm',
    note: 'hiringPhoneConfirmSend — the confirm SMS after a number lands.' },
  { key: 'hiring.contact_failed', value: 'hiring_contact_failed',
    note: 'manualContactScanRun_ — the exhaustion notice to the team.' },
  { key: 'hiring.unreachable_archived', value: 'hiring_unreachable_archived',
    note: 'unreachableArchiveSweepMaybe_ + the mail preview gallery.' },
  { key: 'hiring.referral.contact', value: 'hiring_referral_contact',
    note: 'the referral relay words (simText_ stem referral_relay).' },
  { key: 'hiring.interview.days_request', value: 'interview_days_ask',
    note: 'interviewDaysAskSend — which days can the interviewer take.' },
  { key: 'hiring.interview.slots_request', value: 'interview_slots_ask',
    note: 'interviewSlotsAsk — the slot ask to the interviewer.' },
  { key: 'hiring.interview.invitation', value: 'interview_invite',
    note: 'interviewInviteSend — the invite link.' },
  { key: 'hiring.interview.supervisor_request', value: 'interview_supervisor_ask',
    note: 'interviewSupervisorAsk_ — the pick put to the supervisor.' },
  { key: 'hiring.interview.supervisor_slots', value: 'interview_supervisor_slots_request',
    note: 'interviewSlotsRequest_ — supervisor said NO, ask for slots.' },
  { key: 'hiring.interview.slots_offer', value: 'interview_slots_offer',
    note: 'interviewSlotsOffer_ — the slots offered to the candidate.' },
  { key: 'hiring.interview.candidate_confirmed', value: 'interview_candidate_confirmed',
    note: 'interviewAskConfirm_ — the booking confirmed to the candidate.' },
  { key: 'hiring.interview.confirmed', value: 'interview_confirmed',
    note: 'interviewSupervisorTell_ — the supervisor\'s receipt.' },
  { key: 'hiring.interview.scorecard_report', value: 'hiring_scorecard_report',
    note: 'interviewSave — the scorecard letter to the team.' },
  { key: 'hiring.packet.request', value: 'hiring_packet_request',
    note: 'packetRequestSweep_ + rpcPacketSituation_ — one row, both channels.' },
  { key: 'hiring.event.scheduled', value: 'hiring_event_scheduled',
    note: 'hiringEventNotify_ — a schedule told to the candidate.' },
  { key: 'hiring.onboarding.finish_request', value: 'hiring_onboarding_finish',
    note: 'hiringOnboardingFinishAsk + onboardingFinishSweepMaybe_.' },
  { key: 'hiring.screen.day_reminder', value: 'hiring_screen_day_reminder',
    note: 'recruitTell (CommRecruit.gs) — the morning of an in-person screen on the recruiters\' book.' },
  { key: 'hiring.onboarding.start', value: 'hiring_onboarding_start',
    note: 'recruitTell (CommRecruit.gs) — a candidate on the recruiters\' book passed the screen.' },
  { key: 'hiring.bci.howto', value: 'hiring_bci_howto',
    note: 'recruitTell (CommRecruit.gs) — the True Hire how-to for a new hire whose BCI is not done.' },
  { key: 'hiring.onboarding.stalled', value: 'hiring_onboarding_stalled',
    note: 'onboardingFinishSweepMaybe_ — the ladder exhausted, team told.' },
  { key: 'hiring.hired.complete', value: 'hiring_hired_complete',
    note: 'hubHiredSweep_ — nothing missing at Hired.' },
  { key: 'hiring.hired.missing', value: 'hiring_hired_missing',
    note: 'hubHiredSweep_ — the missing list at Hired.' },
  { key: 'hiring.hired.congratulations', value: 'hiring_hired_congrats',
    note: 'hiredCongratsMaybe_ — the congratulation to the new hire.' },
  { key: 'hiring.ready.notification', value: 'hiring_ready_to_start',
    note: 'hubBecomingStaffSweep_ — the ready-to-start notice.' },
  { key: 'referral.no_contact', value: 'referral_no_contact',
    note: 'referralWarnText_ — login-page copy, never a send.' },
  { key: 'referral.already_known', value: 'referral_already_known',
    note: 'referralAlreadyKnownAnswer_ — login-page copy, never a send.' },
 // The second and third apps on the model — two more SIMPLE apps, same model, same generic sheet.
  { key: 'staff.late_show', value: 'staff_late_show',
    note: 'staffAlertRecipients_ — the daily Late Show alert: switch + recipients row.' },
  { key: 'staff.no_call', value: 'staff_no_call',
    note: 'staffAlertRecipients_ — the No Show No Call alert: switch + recipients row.' },
  { key: 'recon.punch_reminder', value: 'recon_punch_reminder',
    note: 'reconReminderSituationOn_ — the gate only; the sweep fires the row by its own event cell.' }
];

// THE RAW HEADER ROW — deliberately NOT headerOf_.
function commBindingsHeaderRaw_(sheet) {
  var width = sheet.getLastColumn();
  if (width < 1) return [];
  return sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return String(h == null ? '' : h).trim(); });
}

// THE READER READS AND NOTHING ELSE — the law every read-lane reader keeps.
function commBindings_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(COMM_BINDINGS_CACHE);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* re-read */ }
  var map = {};
  try {
    var sheet = ssOpen_(hubId_('HUB_GENERIC_CONFIG_ID'))
      .getSheetByName(COMM_BINDINGS_TAB);
    if (sheet) {
      var hdr = commBindingsHeaderRaw_(sheet);
      var iKey = hdr.indexOf(COMM_BINDINGS_KEY_COL);
      var iVal = hdr.indexOf(COMM_BINDINGS_VAL_COL);
      if (iKey !== -1 && iVal !== -1) {
        var values = sheet.getDataRange().getValues();
        for (var i = 1; i < values.length; i++) {
          var key = String(values[i][iKey] || '').trim();
          if (key) map[key] = String(values[i][iVal] == null ? '' : values[i][iVal]).trim();
        }
      }
    }
  } catch (eRd) { map = null; }                   // unreadable book — the compiled copy answers
  if (map === null || !Object.keys(map).length) {
 // THE SMALL, FAST COPY — a second format, small and quick to read.
    try {
      var baked = hubProp_(COMM_BINDINGS_COMPILED_KEY);
      if (baked) map = JSON.parse(baked);
    } catch (eBk) { /* floors below */ }
    if (map === null || typeof map !== 'object') map = {};
  }
  try { cache.put(COMM_BINDINGS_CACHE, JSON.stringify(map), 60); } catch (e2) { /* uncached */ }
  return map;
}

// THE SEEDER — write lane ONLY (pressed by hiringSweep, the one machine entry).
function commBindingsSeedMaybe_() {
  // SAME LESSON, SAME DAY: this opened the words book and walked its bindings on every sweep, and at a…
  try {
    var seedCache = CacheService.getScriptCache();
    if (seedCache.get('comm_bindings_seeded')) return;
    seedCache.put('comm_bindings_seeded', '1', 600);
  } catch (eG) { /* seed */ }
  var sheet = null;
  try {
    var ss = ssOpen_(hubId_('HUB_GENERIC_CONFIG_ID'));
    sheet = ss.getSheetByName(COMM_BINDINGS_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(COMM_BINDINGS_TAB);
      sheet.getRange(1, 1, 1, 5).setValues([[COMM_BINDINGS_KEY_COL,
        COMM_BINDINGS_VAL_COL, 'Status', COMM_BINDINGS_FB_COL,
        'Complete Smart Comms Config']]);
      sheet.setFrozenRows(1);
    }
  } catch (eOpen) { return; }                     // no book, no seeding — floors carry the day
  // The bindings the tab lacks or holds blank are seeded by Python now (app/comm_bindings*, rung by the relay's clock);
  // a kept edit cannot make a tab, so a missing one is still made above.
  return;
  var hdr = commBindingsHeaderRaw_(sheet);
  var iKey = hdr.indexOf(COMM_BINDINGS_KEY_COL);
  var iVal = hdr.indexOf(COMM_BINDINGS_VAL_COL);
  var iFb = hdr.indexOf(COMM_BINDINGS_FB_COL);
  if (iKey === -1 || iVal === -1) return;         // not the shape we know — touch nothing
  var values;
  try { values = sheet.getDataRange().getValues(); } catch (eV) { return; }
  var have = {};                                  // key -> { row (1-based), val }
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][iKey] || '').trim();
    if (k) have[k] = { row: i + 1, val: String(values[i][iVal] || '').trim() };
  }
  var work = COMM_BINDINGS_DEFAULTS.filter(function (d) {
    return !have[d.key] || !have[d.key].val;
  });
  if (!work.length) return;
  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(10000); } catch (eL) { held = false; }
  try {
    if (held) {
      var fresh = sheet.getDataRange().getValues();
      var now = {};
      for (var j = 1; j < fresh.length; j++) {
        var fk = String(fresh[j][iKey] || '').trim();
        if (fk) now[fk] = { row: j + 1, val: String(fresh[j][iVal] || '').trim() };
      }
      work.forEach(function (d) {
        try {
          var h = now[d.key];
          if (h && h.val) return;                 // somebody filled it meanwhile
          if (h) {                                // row exists, Situation ID blank
            sheet.getRange(h.row, iVal + 1).setValue(d.value);
          } else {
            var row = [];
            for (var c = 0; c < hdr.length; c++) row.push('');
            row[iKey] = d.key;
            row[iVal] = d.value;
            if (iFb !== -1) row[iFb] = d.value;
            sheet.appendRow(row);
          }
        } catch (eW) { /* one refused write must not stop the rest, or the reader */ }
      });
    }
    // no lock: a key missing for one pass beats a duplicate forever
  } finally {
    if (held) { try { lock.releaseLock(); } catch (eR) { /* released at exit */ } }
  }
  try { CacheService.getScriptCache().remove(COMM_BINDINGS_CACHE); } catch (e) { /* rebuilt */ }
  commBindingsCompileMaybe_(sheet);
}

// The book baked into a Script Property — the small, fast copy the reader falls to when the book itself cannot…
function commBindingsCompileMaybe_(sheet) {
  try {
    var hdr = commBindingsHeaderRaw_(sheet);
    var iKey = hdr.indexOf(COMM_BINDINGS_KEY_COL);
    var iVal = hdr.indexOf(COMM_BINDINGS_VAL_COL);
    if (iKey === -1 || iVal === -1) return;
    var values = sheet.getDataRange().getValues();
    var map = {};
    for (var i = 1; i < values.length; i++) {
      var key = String(values[i][iKey] || '').trim();
      if (key) map[key] = String(values[i][iVal] == null ? '' : values[i][iVal]).trim();
    }
    if (Object.keys(map).length) hubPropSet_(COMM_BINDINGS_COMPILED_KEY, JSON.stringify(map));
  } catch (eC) { /* the previous compile keeps answering */ }
}

// ------------------------------------------------------------------ THE BOOK'S TEXT TABS — prompts, steps and…

// One kv tab of the generic config book, as {key: value} — the same raw- header, read-only discipline as…
function hiringWordsBookId_() {
  try {
    var v = String(hubProp_('HUB_WORDS_BOOK_ID') || '').trim();
    if (v) return v;
  } catch (e) { /* depot */ }
  return hubId_('HUB_GENERIC_CONFIG_ID');
}

function bookKv_(tabName) {
  var cacheKey = 'hub_book_kv_v1_' + String(tabName || '');
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* re-read */ }
  var map = bookKvReadSheet_(tabName);
  if (map === null || !Object.keys(map).length) {
 // ZERO STRINGS IN CODE: the words live ONLY the book, so the anti-mute floor cannot be a literal any more — it is…
    map = bookKvCompiled_(tabName) || {};
  }
  try { cache.put(cacheKey, JSON.stringify(map), 300); } catch (e2) { /* uncached */ }
  return map;
}

// One kv tab read straight off the book — pure read, no create, no write, no lock; null when the book, the tab or…
function bookKvReadSheet_(tabName) {
  try {
    var sheet = ssOpen_(hiringWordsBookId_()).getSheetByName(String(tabName || ''));
    if (!sheet) return null;
    var hdr = commBindingsHeaderRaw_(sheet);
    var iKey = hdr.indexOf('key');
    var iVal = hdr.indexOf('value');
    if (iKey === -1 || iVal === -1) return null;
    var values = sheet.getDataRange().getValues();
    var map = {};
    for (var i = 1; i < values.length; i++) {
      var key = String(values[i][iKey] || '').trim();
      if (key && key.charAt(0) !== '#') {
        map[key] = String(values[i][iVal] == null ? '' : values[i][iVal]);
      }
    }
    return map;
  } catch (e) { return null; }
}

// The book's text tabs, baked into the chunked property shadow by the sweep — the anti-mute floor now that no words…
var BOOK_TEXT_TABS = ['Prompts', 'Steps', 'Strings'];

// THE NAME SAID MAYBE AND THE CODE SAID ALWAYS.
var BOOK_KV_BAKE_EVERY_S = 600;
function bookKvCompileAllMaybe_() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('book_kv_baked')) return;
    cache.put('book_kv_baked', '1', BOOK_KV_BAKE_EVERY_S);
  } catch (eG) { /* an unreadable cache bakes, never skips */ }
  BOOK_TEXT_TABS.forEach(function (tab) {
    var m = bookKvReadSheet_(tab);
    if (m && Object.keys(m).length) bookKvCompile_(tab, m);
  });
}

/** The chunked compiled copy of one text tab, or null when never baked. */
function bookKvCompiled_(tabName) {
  try {
    var head = hubProp_('BOOK_KV_' + String(tabName || '').replace(/\W+/g, '_').toUpperCase());
    if (!head) return null;
    var meta = JSON.parse(head);
    var joined = '';
    for (var n = 0; n < (meta.chunks || 0); n++) {
      joined += String(hubProp_(meta.key + '_' + n) || '');
    }
    return joined ? JSON.parse(joined) : null;
  } catch (e) { return null; }
}

/** Bake one text tab into chunked Script Properties — the sweep's job. */
function bookKvCompile_(tabName, map) {
  try {
    var base = 'BOOK_KV_' + String(tabName || '').replace(/\W+/g, '_').toUpperCase();
    var body = JSON.stringify(map || {});
    var SIZE = 8000;
    var chunks = Math.ceil(body.length / SIZE) || 1;
    for (var n = 0; n < chunks; n++) {
      hubPropSet_(base + '_CH_' + n, body.substr(n * SIZE, SIZE));
    }
    hubPropSet_(base, JSON.stringify({ key: base + '_CH', chunks: chunks, at: new Date().toISOString() }));
  } catch (e) { /* the previous bake keeps answering */ }
}

// One text out of a book tab, with the shipped floor — a cell overrides, an emptied or missing cell falls back, and…
function bookText_(tabName, key, floor) {
  try {
    var v = bookKv_(tabName)[String(key || '')];
    return (v != null && String(v) !== '') ? String(v) : String(floor == null ? '' : floor);
  } catch (e) { return String(floor == null ? '' : floor); }
}

/** A comma list out of a Strings cell (the reply-word lists live there). */
function bookWordList_(key) {
  return bookText_('Strings', key, '').split(/[,;\n]+/)
    .map(function (s) { return s.trim(); }).filter(String);
}

// The list compiled to a regex — shape 'start' anchors at the head of the reply, anything else matches the words…
function bookWordsRegex_(key, shape) {
  var parts = bookWordList_(key).map(function (w) {
    return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  if (!parts.length) return null;
  var body = '(' + parts.join('|') + ')';
  try {
    return new RegExp(shape === 'start' ? '^' + body + '\\b' : '\\b' + body + '\\b', 'i');
  } catch (e) { return null; }
}

// Seed one kv tab of the book from a shipped table — write lane ONLY (pressed by hiringSweep beside the bindings…
function bookKvSeedMaybe_(tabName, defaults) {
  var sheet = null;
  try {
    var ss = ssOpen_(hiringWordsBookId_());
    sheet = ss.getSheetByName(String(tabName || ''));
    if (!sheet) {
      sheet = ss.insertSheet(String(tabName || ''));
      sheet.getRange(1, 1, 1, 3).setValues([['key', 'value', 'note']]);
      sheet.setFrozenRows(1);
    }
  } catch (eOpen) { return; }
  var hdr = commBindingsHeaderRaw_(sheet);
  var iKey = hdr.indexOf('key');
  var iVal = hdr.indexOf('value');
  var iNote = hdr.indexOf('note');
  if (iKey === -1 || iVal === -1) return;
  var values;
  try { values = sheet.getDataRange().getValues(); } catch (eV) { return; }
  var have = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][iKey] || '').trim();
    if (k) have[k] = { row: i + 1, val: String(values[i][iVal] || '').trim() };
  }
  var work = (defaults || []).filter(function (d) {
    return !have[d.key] || !have[d.key].val;
  });
  if (!work.length) return;
  var lock = LockService.getScriptLock();
  var held = false;
  try { held = lock.tryLock(10000); } catch (eL) { held = false; }
  try {
    if (held) {
      var fresh = sheet.getDataRange().getValues();
      var now = {};
      for (var j = 1; j < fresh.length; j++) {
        var fk = String(fresh[j][iKey] || '').trim();
        if (fk) now[fk] = { row: j + 1, val: String(fresh[j][iVal] || '').trim() };
      }
      work.forEach(function (d) {
        try {
          var h = now[d.key];
          if (h && h.val) return;
          if (h) {
            sheet.getRange(h.row, iVal + 1).setValue(d.value);
          } else {
            var row = [];
            for (var c = 0; c < hdr.length; c++) row.push('');
            row[iKey] = d.key;
            row[iVal] = d.value;
            if (iNote !== -1 && d.note) row[iNote] = d.note;
            sheet.appendRow(row);
          }
        } catch (eW) { /* one refused write must not stop the rest */ }
      });
    }
  } finally {
    if (held) { try { lock.releaseLock(); } catch (eR) { /* released at exit */ } }
  }
  try { CacheService.getScriptCache().remove('hub_book_kv_v1_' + String(tabName || '')); } catch (e) { /* rebuilt */ }
}

// The situation row a purpose speaks through: the book's answer, with the shipped id as the floor — a binding…
function commSituationId_(key, shippedId) {
  var shipped = String(shippedId || '');
  try {
    var v = String(commBindings_()[String(key || '')] || '').trim();
    if (!v || v === shipped) return shipped ? shipped : v;
    var known = null;
    try {
      smartSituations_().forEach(function (r) { if (str_(r.id) === v) known = r; });
    } catch (eS) { return v; }                    // situations unreadable — trust the cell
    if (known) return v;
    try {
      hubSysLog_('asa-hub:comm-bindings', 'binding_dangling',
                 String(key || '') + ' -> "' + v + '" names no Smart Comms row — using "' +
                 shipped + '"', { status: 200 });
    } catch (eLg) { /* the floor still answers */ }
    return shipped;
  } catch (e) { return shipped; }
}

// WHICH SMART COMMS ROW OWNS EACH MESSAGE KEY.
var SIM_TEXT_ROW_OWNER = {
  welcome: 'hiring_welcome', ask: 'hiring_ask', shortlist: 'hiring_shortlist',
  outreach: 'hiring_outreach', cjis_request: 'hiring_cjis_request',
  decision_ask: 'hiring_decision_ask', manual_contact: 'hiring_first_contact',
  screen_call: 'hiring_screen_call', screen_redo: 'hiring_screen_redo',
  referral_relay: 'hiring_referral_contact', resume_request: 'hiring_resume_request'
};

var SIM_TEXT_ROW_KEY = {
  welcome: 'hiring.welcome', ask: 'hiring.ask', shortlist: 'hiring.shortlist',
  outreach: 'hiring.outreach', cjis_request: 'hiring.cjis.request',
  decision_ask: 'hiring.decision.request', manual_contact: 'hiring.first_contact',
  screen_call: 'hiring.screen.invitation', screen_redo: 'hiring.screen.redo',
  referral_relay: 'hiring.referral.contact', resume_request: 'hiring.resume.request'
};

function simTextRowValue_(key) {
  var k = String(key || '');
  var field = '';
  var stem = '';
  if (/_email_subject$/.test(k)) { field = 'email_subject'; stem = k.replace(/_email_subject$/, ''); }
  else if (/_subject$/.test(k)) { field = 'email_subject'; stem = k.replace(/_subject$/, ''); }
  else if (/_email_body$/.test(k)) { field = 'email_text'; stem = k.replace(/_email_body$/, ''); }
  else if (/_body$/.test(k)) { field = 'email_text'; stem = k.replace(/_body$/, ''); }
  else if (/_sms$/.test(k)) { field = 'sms_text'; stem = k.replace(/_sms$/, ''); }
  else return '';
  var sitId = commSituationId_(SIM_TEXT_ROW_KEY[stem], SIM_TEXT_ROW_OWNER[stem]);
  if (!sitId) return '';
  try {
    var hit = null;
    smartSituations_().forEach(function (r) { if (str_(r.id) === sitId) hit = r; });
    return hit ? str_(hit[field]) : '';
  } catch (e) { return ''; }                      // an unreadable screen never mutes a send
}

// A message's words: the Smart Comms ROW first, then the config cell, then the shipped fallback — never silence.
function simText_(key, fallback) {
  var row = simTextRowValue_(key);
  if (row) return row;
  var v = simCfgVal_('sim_text_' + String(key || ''));
  return v || String(fallback || '');
}

// THE TITLE KEEPS SAYING TEST.
function simTagSubject_(subject) {
  var s = String(subject || '');
  var tag = simCfgVal_('sim_subject_tag');
  if (!tag) return s;
  try {
    if (typeof hubTestModeState_ === 'function' && hubTestModeState_().on) return s;
  } catch (e) { /* an unreadable config never blocks a send */ }
  if (s.indexOf(tag) === 0 || s.indexOf('[TEST]') === 0) return s;
  // The sheet trims a trailing space off the cell, so the seam gets one back.
  return tag + (/\s$/.test(tag) ? '' : ' ') + s;
}

// THE FENCE.
function simOutboundGuard_() {
  return simCfgVal_('sim_outbound_guard').toLowerCase() !== 'off';
}

// THE CAST'S OWN LINES ARE SENDABLE (the root of the card that would not be born): the actor candidate rides the…
function simSendablePhone_(raw) {
  var to = (typeof packetSendableNumber_ === 'function')
    ? packetSendableNumber_(raw) : String(raw || '');
  if (to) return to;
  var d = String(raw || '').replace(/\D/g, '').replace(/^1/, '');
  if (d.length !== 10) return '';
  if (simOutboundGuard_() && simOutboundOneAllowed_('+1' + d)) return '+1' + d;
  return '';
}

// ------------------------------------------------------------------ THE ACTORS ANSWER BY THEMSELVES: the mock…

function simAutoReplyOn_() {
  return simCfgVal_('sim_auto_reply').toLowerCase() !== 'off' && simOutboundGuard_();
}

/** Where an actor's reply is addressed — the platform's own mailbox. */
function simPlatformAddress_() {
  var v = '';
  try { v = str_(hubProp_('PLATFORM_EMAIL')); } catch (e) { v = ''; }
  return v || 'asa-hub@asaop.org';
}

// EVERY ACTOR SAYS WHO IT IS — an automatic answer ALWAYS states which actor it is speaking as, so the first line…
function simActorIdLine_(role, address) {
  return 'I am the SIMULATION acting as ' + String(role || 'an actor') +
         (address ? ' <' + address + '>' : '') + '.';
}

// A REAL letter from an actor's mailbox when its PLATFORM_EMAIL pair is wired — '' otherwise, and the caller says…
function simActorMailOut_(fromActor, subject, text, role) {
  if (!fromActor) return '';
  try {
    var r = platformMailOut_(simPlatformAddress_(), '[SIM] ' + String(subject || ''),
      simActorIdLine_(role, fromActor) + '\n\n' + String(text || ''), '', fromActor, '');
    if (r && r.sent) return 'real mail from ' + fromActor;
  } catch (eMail) { /* the injector still answers */ }
  return '';
}

// A REAL SMS from the actor's line to the Automations line, through the provider's API — both numbers are the…
function simActorSmsOut_(fromPhone, body, role) {
  var d = String(fromPhone || '').replace(/\D/g, '').replace(/^1/, '');
  if (d.length !== 10) return '';
  // TEST MODE ON SENDS NOTHING, THIS LINE INCLUDED.
  var testOn = true;
  try { testOn = (typeof hubRehearsalToSheet_ === 'function') ? !!hubRehearsalToSheet_() : true; }
  catch (eT) {
    if (typeof hubSwitchUnreadable_ === 'function') hubSwitchUnreadable_('simActorSmsOut_', eT);
    testOn = true;
  }
  if (testOn) {
    try {
      if (typeof hubRehearsalSend_ === 'function') {
        hubRehearsalSend_('smsSend', { channel: 'sms', to: '+1' + d, subject: '',
          body: '[SIM - ' + String(role || 'actor') + '] ' + String(body || ''),
          reason: 'hiring simulation: an actor\'s text' });
      }
    } catch (eR) { /* nothing was sent either way */ }
    return '';
  }
  var apiKey = hubProp_(typeof SCRAPER_OPENPHONE_PROP !== 'undefined'
    ? SCRAPER_OPENPHONE_PROP : 'OPENPHONE_API_KEY');
  if (!apiKey) return '';
  var line = (typeof rpcSenderLine_ === 'function') ? rpcSenderLine_(apiKey) : null;
  if (!line || line.error || !line.from) return '';
  try {
    var res = UrlFetchApp.fetch('https://api.openphone.com/v1/messages', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: apiKey },
      payload: JSON.stringify({
        content: '[SIM - ' + String(role || 'actor') + '] ' + String(body || ''),
        from: '+1' + d, to: [line.from]
      }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return 'real SMS from +1' + d;
  } catch (eS) { /* the injector still answers */ }
  return '';
}

/** {names}/{top} substituted from the CURRENT shortlist. */
function simPresetText_(presetKey) {
  var text = simCfgVal_(presetKey);
  if (!text) return '';
  var names = simShortlistNames_().map(function (l) { return l.name; });
  return text.replace(/\{names\}/g, names.join(', ')).replace(/\{top\}/g, names[0] || '');
}

// The DECIDERS' auto-answer (steps 0 and 2): the preset text travels the same rule-then-model reader a typed reply…
function simAutoTeamReply_(presetKey) {
  if (!simAutoReplyOn_()) return null;
  var text = simPresetText_(presetKey);
  if (!text) return null;
  var listed = simShortlistNames_();
  var listedNames = listed.map(function (l) { return l.name; });
  var actors = hiringSimActors_();
  var from = (actors.decider_emails[0] || 'a decider') + ' (sim auto — acting as the decider)';
  var mid = 'sim:auto:' + randomHex_(8);
  var verdict = simInterestVerdictRule_(text);
  var names = [];
  if (!verdict) {
    var ai = simInterestClassifyAi_(text, listedNames);
    if (!ai) return { acted: '', error: 'no_reader',
                      note: 'no model would read the auto reply — press the composer instead' };
    verdict = ai.verdict;
    names = ai.names.filter(function (n) {
      return listedNames.some(function (l) { return l.toLowerCase() === String(n).toLowerCase(); });
    });
  }
  var acted = simInterestAct_(verdict, names, from, mid, listed);
  return { read_as: verdict, names: names, acted: acted.acted,
           card: acted.card || '', card_error: acted.card_error || '' };
}

// The CANDIDATE's auto-answer (step 4.5): a real SMS from the actor line and a real letter from the actor mailbox…
function simAutoOutreachReply_(cid, user) {
  if (!simAutoReplyOn_()) return null;
  if (!simIsRehearsalCid_(cid)) return null;
  var ev;
  try { ev = hubEvidence_(cid); } catch (e) { return null; }
  if (!ev || !ev.cand) return null;
  var text = simPresetText_('sim_pretend_outreach_reply') || 'YES - I am interested.';
  var actors = hiringSimActors_();
  var lanes = [];
  var sms = simActorSmsOut_(actors.candidate_phone, text, 'the candidate');
  if (sms) lanes.push(sms);
  var mail = simActorMailOut_(actors.candidate_email,
    'Re: A Direct Support Professional opportunity - YES', text, 'the candidate');
  if (mail) lanes.push(mail);
  try {
    hubAppendRow_(INBOUND_TAB, {
      message_id: 'SIMAUTO_' + randomHex_(10).toUpperCase(),
      received_at: new Date().toISOString(),
      from_number: str_(ev.cand.phone),
      from_key: str_(ev.cand.phone).replace(/\D/g, '').slice(-10),
      candidate_id: cid,
      person_name: str_(ev.cand.candidatename),
      body: text, intent: 'reply', our_number: '',
      recorded_at: new Date().toISOString()
    });
    lanes.push('the injector row');
  } catch (eRow) {
    return { answered: false, lanes: lanes, error: 'the inbound row could not be filed' };
  }
  var scanned = null;
  try { scanned = hiringOutreachReplyScan_(cid, user); } catch (eS) { scanned = null; }
  journeyLog_({ candidate_id: cid, name: str_(ev.cand.candidatename), step: 'outreach_reply',
                channel: sms ? 'sms' : 'email', ok: true, rehearsal: true,
                detail: 'the candidate actor answered BY ITSELF - ' + lanes.join(' + '),
                by: 'asa-hub:sim-auto' });
  return { answered: true, lanes: lanes, scanned: scanned };
}

// The CANDIDATE's auto-pick (step 9): the next really-free slot, through the REAL public door with the real signed…
function simAutoPick_(cid) {
  if (!simAutoReplyOn_()) return null;
  if (!simIsRehearsalCid_(cid)) return null;
  var ask = (typeof interviewAskOpenFor_ === 'function') ? interviewAskOpenFor_(cid) : null;
  if (!ask) return null;
  var token = interviewTokenFor_(str_(ask.askid), cid);
  if (!token) return { picked: false, reason: 'no_link_secret' };
  var taken = interviewTakenSlots_();
 // the candidate MATCHES the interviewer's days: a stored allowed list narrows the pick to her open days, like the…
  var allowed = (typeof interviewAllowedDays_ === 'function') ? interviewAllowedDays_(ask) : [];
  var slot = null;
  simPretendSlots_().forEach(function (s2) {
    if (slot) return;
    if (allowed.length && allowed.indexOf(s2.date) === -1) return;
    if (taken.indexOf(s2.date + 'T' + s2.time) === -1) slot = s2;
  });
  if (!slot) return { picked: false, reason: 'no_free_slot' };
  var env = interviewSlotSubmitPub_({ t: token, date: slot.date, time: slot.time });
  var ok = Number(env && env.status) === 200;
  journeyLog_({ candidate_id: cid, name: str_(ask.candidatename), step: 'schedule_invite',
                channel: 'web', ok: ok, rehearsal: true,
                detail: ok
                  ? 'the candidate actor picked ' + slot.date + ' ' + slot.time +
                    ' BY ITSELF (the real public door)'
                  : 'the actor tried to pick and the door refused: ' + str_(env && env.message),
                by: 'asa-hub:sim-auto' });
  return { picked: ok, slot: slot };
}

// The INTERVIEWER actor's auto-YES (step 10) — rehearsal asks only, plus a real letter from the actor mailbox when…
function simAutoInterviewerYes_() {
  if (!simAutoReplyOn_()) return null;
  var today = (typeof interviewTodayText_ === 'function') ? interviewTodayText_() : '';
  var mid = 'sim:auto:' + randomHex_(8);
  var acted = false;
  try { acted = !!interviewAskApply_('yes', null, mid, today, true); } catch (eA) { acted = false; }
  var actors = hiringSimActors_();
  var lane = simActorMailOut_(actors.interviewer_email, 'Re: interview - YES',
    simCfgVal_('sim_pretend_interviewer_reply') || 'YES', 'the interviewer');
  journeyLog_({ candidate_id: '', name: actors.interviewer_name, step: 'interviewer_ask',
                channel: 'email', ok: acted, rehearsal: true,
                detail: 'the interviewer actor answered YES BY ITSELF' +
                        (lane ? ' - ' + lane : ' (the injector)'),
                by: 'asa-hub:sim-auto' });
  return { acted: acted };
}

// The DECIDERS' auto-ADVANCE (step 8.7) — the same checkpoint door a human press uses releases the rehearsal to…
function simAutoDecisionAdvance_(cid) {
  if (!simAutoReplyOn_()) return null;
  if (!simIsRehearsalCid_(cid)) return null;
 // THE ACTOR FOLLOWS THE ANALYSIS: an auto ADVANCE over a score-0 Not Qualified screen was the wrong message — a…
  var verdictVal = 'Advance', why = 'no analysis readable - defaulted to Advance';
  try {
    var evD = hubEvidence_(cid);
    var sD = (evD && evD.screen) || {};
    var q = str_(sD.qualification).toLowerCase();
    var sc = Number(str_(sD.screenscore).replace(/[^0-9.]/g, ''));
    if (q.indexOf('not') === 0 || (!isNaN(sc) && sc > 0 && sc < 5) ||
        (!isNaN(sc) && sc === 0 && str_(sD.screenscore) !== '')) {
      verdictVal = 'Decline';
    }
    why = 'the analysis read "' + (str_(sD.qualification) || 'unscored') + '" (score ' +
          (str_(sD.screenscore) || '-') + ')';
  } catch (eEv) { /* the default stands, and says so */ }
  var env = null;
  try {
    // the board's writer without the signed-in door's attestation: a machine signs no phone screen, so its Advance…
    env = hubSetDecision_(
      { candidate_id: cid, checkpoint: 'advance-decision', value: verdictVal },
      { role: 'manager', email: 'hiring-sim-auto@service.local', id: 'SVC_HIRING_SIM' });
  } catch (eD) { env = null; }
  var ok = !!(env && Number(env.status) === 200);
  var whoD = hiringSimActors_().decider_emails.join(', ');
  journeyLog_({ candidate_id: cid, name: '', step: 'decision_ask', channel: 'email',
                ok: ok, rehearsal: true,
                detail: ok
                  ? 'SIM acting as the deciders (' + whoD + '): ' + verdictVal.toUpperCase() +
                    ' - ' + why
                  : 'the auto ' + verdictVal.toUpperCase() + ' was refused: ' +
                    str_(env && env.message) + ' - ' + why,
                by: 'asa-hub:sim-auto' });
  return { decided: verdictVal, ok: ok, why: why };
}

// ------------------------------------------------------------------ STEP 5.4 — THE WHOLE EVALUATION IN ONE PRESS…

HUB_POLICY.hiringSimScreenEvaluate = {
  file: 'HiringSimConfig.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'minutes',
  roles: ['admin', 'manager'],
  params: { candidate_id: { required: true, type: 'string' } },
  invalidates: ['candidates'], emits: ['emailSend', 'smsSend']
};
HUB_ACTIONS.hiringSimScreenEvaluate = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var cid = str_(payload && payload.candidate_id);
  if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
  if (!simIsRehearsalCid_(cid)) {
    return { status: 409, message: 'The one-press evaluation runs on REHEARSAL cards only — ' +
             'a real candidate goes through the real doors (8 · 8.3 · 8.7).' };
  }
  var out = { transcript: null, analysis: null, decision_ask: null };

  // 1 — A REAL TRANSCRIPT, BORROWED (marked as borrowed on the card).
  var seed = HUB_ACTIONS.hiringSimTranscriptSeed({ candidate_id: cid }, user);
  out.transcript = (seed && seed.data) || null;
  if (!seed || Number(seed.status) !== 200) {
    out.stopped_at = 'transcript';
    out.error = str_(seed && seed.message) || 'the transcript seed refused';
    return { status: 200, data: out };
  }

  // 2 — THE SAME ANALYZER THE REAL LANE RUNS: the AI report, the screen details, the score.
  var ana = HUB_ACTIONS.screenAnalyze({ candidate_id: cid }, user);
  out.analysis = (ana && ana.data) || null;
  if (!ana || Number(ana.status) !== 200) {
    out.stopped_at = 'analysis';
    out.error = str_(ana && ana.message) || 'the analyzer refused';
    return { status: 200, data: out };
  }

  // 3 — THE ASK: e-mail + Quo to Arthur and Ty — do we continue with this candidate, or remove them from the…
  var ask = hiringDecisionAskCore_({ candidate_id: cid }, user);
  out.decision_ask = (ask && ask.data) || { error: str_(ask && ask.message) || 'the ask refused' };

  journeyLog_({ candidate_id: cid, name: '', step: 'phone_screen', channel: 'record',
                ok: true, rehearsal: true,
                title: 'The evaluation ran end to end',
                detail: 'borrowed transcript → AI report + screen details + score → the ' +
                        'continue-or-remove ask to the deciders — one press (step 5.4)',
                by: str_(user && user.email) });
  return { status: 200, data: out };
};

/** One address or number against the cast. */
function simOutboundOneAllowed_(d) {
  d = String(d || '').trim().toLowerCase();
  if (!d) return true;
  if (d.indexOf('@') !== -1) {
    if (/^asa-hub[0-9]*@asaop\.org$/.test(d)) return true;
    var lists = ['sim_candidate_email', 'sim_interviewer_email', 'sim_cc_emails',
                 'sim_watcher_emails', 'sim_team_emails', 'sim_decider_emails'];
    for (var i = 0; i < lists.length; i++) {
      var hit = simCfgList_(lists[i]).some(function (a) {
        return a.toLowerCase() === d;
      });
      if (hit) return true;
    }
    return false;
  }
  var digits = d.replace(/[^0-9]/g, '');
  if (!digits) return false;
  var nums = simCfgList_('sim_team_sms')
    .concat([simCfgVal_('sim_candidate_phone'), simCfgVal_('sim_interviewer_phone')]);
  return nums.some(function (n) {
    var nd = String(n || '').replace(/[^0-9]/g, '');
    return nd && (nd === digits || ('1' + nd) === digits || nd === ('1' + digits));
  });
}

// A destination (possibly a comma list) against the fence.
function simOutboundAllowed_(dest) {
  if (!simOutboundGuard_()) return { ok: true };
  // THE REDIRECT IS A STRONGER FENCE THAN THE CAST.
  var redir = null;
  try { redir = (typeof hubTestRedirect_ === 'function') ? hubTestRedirect_() : null; }
  catch (eR) { redir = null; }                    // unreadable config = no bypass
  var parts = String(dest || '').split(/[,;\n]+/)
    .map(function (s) { return s.trim(); }).filter(String);
  for (var i = 0; i < parts.length; i++) {
    if (simOutboundOneAllowed_(parts[i])) continue;
    var isMail = parts[i].indexOf('@') !== -1;
    var carried = !!(redir && (isMail ? (redir.emails || []).length
                                      : (redir.sms || []).length));
    if (carried) continue;                        // the transport replaces it
    return {
      ok: false,
      reason: isMail ? 'outside_address_blocked' : 'outside_number_blocked',
      detail: parts[i] + ' is not on the cast — the fence (sim_outbound_guard) refuses ' +
              'every ' + (isMail ? 'address' : 'number') + ' outside the configured team ' +
              'and actors' + (redir
                ? ', and test mode has no tester listed for ' +
                  (isMail ? 'e-mail' : 'SMS') + ' to redirect it to'
                : ', test mode being off — switch test mode on and the rehearsal ' +
                  'reaches the testers instead of being refused')
    };
  }
  return { ok: true };
}

// IS THIS RUNG DUE, AND HAS IT RUN OUT?
function simLadderDue_(step, cid) {
  var cfg = simAttemptsFor_(step);
  var row = null;
  try {
    simAskRows_().forEach(function (r) {
      if (str_(r.step) !== str_(step)) return;
      if (str_(r.candidateid) !== str_(cid)) return;
      row = r;                                    // the last one wins
    });
  } catch (e) {
    return { due: false, sent: 0, of: cfg.attempts, why: 'the ask book could not be read' };
  }
  if (!row) return { due: true, sent: 0, of: cfg.attempts, why: 'never asked' };
  var sent = parseInt(str_(row.sentcount), 10) || 0;
  var max = parseInt(str_(row.maxattempts), 10) || cfg.attempts;
  if (str_(row.state) === 'answered') {
    return { due: false, sent: sent, of: max, why: 'they answered' };
  }
  if (sent >= max) {
    return { due: false, sent: sent, of: max, why: 'the asking ended — ' + sent + ' of ' + max };
  }
  var mins = parseInt(str_(row.intervalminutes), 10) || cfg.minutes;
  var last = new Date(str_(row.lastsentat) || str_(row.createdat)).getTime();
  if (!isNaN(last) && (Date.now() - last) < mins * 60000) {
    return { due: false, sent: sent, of: max, why: 'not yet — one every ' + mins + ' minutes' };
  }
  return { due: true, sent: sent, of: max, why: 'due' };
}

// WHO ELSE MAY ANSWER FOR A CARD WHILE THE REDIRECT IS LIVE — the answer comes back from the 5558, not from the…
function simTesterKeys_() {
  var out = { digits: [], emails: [] };
  var redir = null;
  try { redir = (typeof hubTestRedirect_ === 'function') ? hubTestRedirect_() : null; }
  catch (e) { redir = null; }
  if (!redir) return out;
  (redir.sms || []).forEach(function (n) {
    var d = String(n || '').replace(/\D/g, '').replace(/^1/, '').slice(-10);
    if (d.length === 10 && out.digits.indexOf(d) === -1) out.digits.push(d);
  });
  (redir.emails || []).forEach(function (a) {
    var e = String(a || '').trim().toLowerCase();
    if (e.indexOf('@') !== -1 && out.emails.indexOf(e) === -1) out.emails.push(e);
  });
  return out;
}

// ------------------------------------------------------------------ the attempt book…

function simAskSheet_() {
  var existed = !!hubTabSheet_(HIRING_SIM_ASKS_TAB);
  var sheet = hubTabEnsure_(HIRING_SIM_ASKS_TAB, HIRING_SIM_ASKS_HEADER);
  if (!existed) {
    // every column is text: an id and a phone must not be read as numbers
    sheet.getRange(1, 1, sheet.getMaxRows(), HIRING_SIM_ASKS_HEADER.length).setNumberFormat('@');
  } else if (!sheet.isRuntimeBacked) {
    // NOT ON THE RUNTIME: the shim rebuilds its header from the facts each call, and widening it shifts the columns…
    ensureHeader_(sheet, HIRING_SIM_ASKS_HEADER);
  }
  return sheet;
}

function simAskRows_() {
  try {
    simAskSheet_();
    return readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), HIRING_SIM_ASKS_TAB);
  } catch (e) { return []; }
}

// Register (or bump) the attempt row for one retryable send.
function simTrackSend_(step, cid, action, payload) {
  try {
    var cfg = simAttemptsFor_(step);
    var sheet = simAskSheet_();
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iStep = hdr.indexOf('step'), iCid = hdr.indexOf('candidateid');
    var iState = hdr.indexOf('state'), iCount = hdr.indexOf('sentcount');
    var iLast = hdr.indexOf('lastsentat');
    var now = new Date().toISOString();
    for (var r = values.length - 1; r >= 1; r--) {
      if (str_(values[r][iStep]) !== str_(step)) continue;
      if (str_(values[r][iCid]) !== str_(cid || '')) continue;
      if (str_(values[r][iState]) !== 'open') break;
      var n = parseInt(str_(values[r][iCount]), 10) || 0;
      sheet.getRange(r + 1, iCount + 1).setValue(String(n + 1));
      sheet.getRange(r + 1, iLast + 1).setValue(now);
      return { id: str_(values[r][hdr.indexOf('simaskid')]), attempt: n + 1, of: cfg.attempts };
    }
    var id = 'SIMASK_' + randomHex_(8).toUpperCase();
    var row = {
      sim_ask_id: id, step: str_(step), candidate_id: str_(cid || ''),
      action: str_(action),
      payload_json: JSON.stringify(payload || {}).slice(0, 4000),
      sent_count: '1', max_attempts: String(cfg.attempts),
      interval_minutes: String(cfg.minutes), last_sent_at: now,
      state: 'open', answered_at: '', answered_by: '', created_at: now
    };
    hubAppendRow_(HIRING_SIM_ASKS_TAB, row);
    return { id: id, attempt: 1, of: cfg.attempts };
  } catch (e) {
    // The send already happened; a lost book entry costs a retry, not a message.
    try { hubSysLog_('asa-hub:sim', 'sim_track_failed', str_(step) + ': ' +
                     String((e && e.message) || e), { status: 500 }); } catch (e2) {}
    return { id: '', attempt: 0, of: 0 };
  }
}

/** Close the open asks of the named steps — a reply arrived. */
function simAskAnswer_(steps, by, cid) {
  try {
    var sheet = simAskSheet_();
    var values = sheet.getDataRange().getValues();
    var hdr = values[0].map(normKey_);
    var iStep = hdr.indexOf('step'), iState = hdr.indexOf('state');
    var iCid = hdr.indexOf('candidateid');
    var iAt = hdr.indexOf('answeredat'), iBy = hdr.indexOf('answeredby');
    var now = new Date().toISOString();
    var closed = 0;
    for (var r = 1; r < values.length; r++) {
      // An answer closes the ask in EITHER live state: the ready ear reads open AND exhausted (the designed…
      var st = str_(values[r][iState]);
      if (st !== 'open' && st !== 'exhausted') continue;
      if (steps.indexOf(str_(values[r][iStep])) === -1) continue;
      if (cid && str_(values[r][iCid]) && str_(values[r][iCid]) !== str_(cid)) continue;
      sheet.getRange(r + 1, iState + 1).setValue('answered');
      sheet.getRange(r + 1, iAt + 1).setValue(now);
      sheet.getRange(r + 1, iBy + 1).setValue(str_(by).slice(0, 120));
      closed++;
    }
    return closed;
  } catch (e) { return 0; }
}

// THE RETRY PASS.
function hiringSimRetryRun_() {
  var out = { open: 0, resent: 0, exhausted: 0, answered: 0, scanned: null };

  // First the ears, then the mouth: a reply already in the mailbox must stop a retry that would go out this same…
  try { out.scanned = hiringInterestScanRun_(); } catch (eS) { out.scanned = { error: String((eS && eS.message) || eS) }; }
  // the CJIS ear: a decider's yes fills the dot, a no closes the ask
  try { if (typeof cjisAskScanRun_ === 'function') out.cjis = cjisAskScanRun_(); } catch (eCj) {}
  // the referral ear: a phone in the person's (or the referrer's) reply settles the ask
  try { if (typeof referralContactScanRun_ === 'function') out.referral = referralContactScanRun_(); } catch (eRf) {}
  // the manual ear: a hand-added candidate's (or their adder's) answer settles the asks
  try { if (typeof manualContactScanRun_ === 'function') out.manual = manualContactScanRun_(); } catch (eMn) {}

  var rows = simAskRows_().filter(function (r) { return str_(r.state) === 'open'; });
  out.open = rows.length;
  if (!rows.length) return out;

  var actor = { role: 'manager', email: 'hiring-sim-retry@service.local', id: 'SVC_HIRING_SIM' };
  var now = Date.now();
  rows.forEach(function (r) {
    var step = str_(r.step);
    // The invite answers itself: the interview ask machine moved past 'invited'.
    if (step === 'invite') {
      try {
        var ask = (typeof interviewAskOpenFor_ === 'function')
          ? interviewAskOpenFor_(str_(r.candidateid)) : null;
        var st = ask ? str_(ask.state) : '';
        if (st && st !== 'invited') {
          simAskAnswer_(['invite'], 'the candidate picked (' + st + ')', str_(r.candidateid));
          out.answered++;
          return;
        }
      } catch (eI) { /* the retry below still respects the clock */ }
    }
    var count = parseInt(str_(r.sentcount), 10) || 0;
    var maxA = parseInt(str_(r.maxattempts), 10) || 1;
    var mins = parseInt(str_(r.intervalminutes), 10) || 30;
    if (count >= maxA) {
      // Exhausted: close it out loud, once.
      try {
        var sheet = simAskSheet_();
        var values = sheet.getDataRange().getValues();
        var hdr = values[0].map(normKey_);
        var iId = hdr.indexOf('simaskid'), iState = hdr.indexOf('state');
        for (var x = 1; x < values.length; x++) {
          if (str_(values[x][iId]) !== str_(r.simaskid)) continue;
          sheet.getRange(x + 1, iState + 1).setValue('exhausted');
          break;
        }
        journeyLog_({ candidate_id: str_(r.candidateid), name: '', step: 'sim_retry',
                      title: 'The asking ended without a reply',
                      channel: 'sim', ok: false,
                      detail: step + ' — ' + count + ' attempt(s) made, none answered',
                      by: 'asa-hub:sim-retry' });
      } catch (eX) { /* the state stays open; the next pass tries again */ }
      out.exhausted++;
      return;
    }
    var last = new Date(str_(r.lastsentat)).getTime();
    if (!isNaN(last) && now - last < mins * 60000) return;   // not yet
    var action = str_(r.action);
    var payload = {};
    try { payload = JSON.parse(str_(r.payloadjson) || '{}') || {}; } catch (eP) { payload = {}; }
    var env = null;
    try {
      // The shortlist resend goes to the CORE (the emits gate follows this textual path to the sender); everything…
      if (action === 'hiringShortlistSend') env = hiringShortlistCore_(payload, actor);
      else if (typeof HUB_ACTIONS[action] === 'function') env = HUB_ACTIONS[action](payload, actor);
      else return;
    } catch (eA) { env = null; }
    // 200 IS NOT "SENT" — as a live test showed.
    var envData = (env && env.data) || {};
    var okCall = !!(env && Number(env.status) === 200);
    var reallySent = (envData.sent === undefined) ? okCall : !!envData.sent;
    var whyNot = str_(envData.reason || envData.detail || (env && env.message));
    journeyLog_({ candidate_id: str_(r.candidateid), name: '', step: 'sim_retry',
                  title: reallySent ? 'Asked again — no reply yet'
                                    : 'The re-ask did not go out',
                  channel: 'sim', ok: reallySent,
                  detail: reallySent
                    ? (step + ' — attempt ' + (count + 1) + ' of ' + maxA)
                    : (step + ' — still on attempt ' + count + ' of ' + maxA +
                       ' (' + (whyNot || 'nothing was sent') + ')'),
                  by: 'asa-hub:sim-retry' });
    if (reallySent) out.resent++;
  });
  return out;
}

// ------------------------------------------------------------------ step 2 — the team's reply, read…

// The names the last shortlist carried, off the journey — the record the letter itself wrote, one line per named…
function simShortlistNames_() {
  var names = [], ids = {};
  try {
    (journeyFor_('') || []).forEach(function (l) {
      if (l.step !== 'shortlist') return;
      if (!l.name) return;
      if (!ids[l.name.toLowerCase()]) {
        ids[l.name.toLowerCase()] = true;
        names.push({ name: l.name, candidate_id: l.candidate_id });
      }
    });
  } catch (e) { return []; }
  return names;
}

/** Whole-message OK, the opt-out grammar: partial phrases go to the model. */
function simInterestVerdictRule_(body) {
  var s = String(body || '').trim().toLowerCase().replace(/[!.\s]+$/, '');
  if (/^(ok|okay|yes|sim|go ahead|proceed|pode seguir|aprovado|approved)$/.test(s)) return 'ok';
  return '';
}

/** ONE model look per message. Names must come from the shortlist. */
function simInterestClassifyAi_(text, names) {
  if (typeof screenAiChat_ !== 'function') return null;
  var ask = bookText_('Prompts', 'ai_interest_reply', '')
    .split('{names}').join(names.length ? names.join('; ')
      : bookText_('Prompts', 'ai_interest_reply_none', ''))
    .split('{message}').join(String(text || '').slice(0, 1500));
  var res = null;
  try { res = ask ? screenAiChat_(ask, 0.1, 'ai_interest_reply') : null; } catch (e) { res = null; }
  if (!res || !res.ok) return null;
  var parsed = null;
  try { parsed = JSON.parse(str_(res.content)); } catch (e2) { parsed = null; }
  if (!parsed) return null;
  var v = str_(parsed.verdict).toLowerCase();
  if (['ok', 'selected', 'more', 'other'].indexOf(v) === -1) return null;
  var got = Array.isArray(parsed.names) ? parsed.names.map(String) : [];
  return { verdict: v, names: got, via: str_(res.via) || 'ai' };
}

// Read the deciders' replies out of the platform mailbox and act on the verdict — the tpAuthSweepRun_ shape: sender…
function hiringInterestScanRun_() {
  var out = { read: 0, judged: 0, acted: '', names: [] };
  if (typeof platformMailPost_ !== 'function') return out;

  var actors = hiringSimActors_();
  var allowed = actors.decider_emails.concat(actors.team_emails)
    .map(function (e) { return String(e).toLowerCase(); });
  if (!allowed.length) return out;

  var inbox = platformMailPost_('/mail/inbox', { limit: 30 });
  if (!inbox || inbox.status !== 200) {
    out.error = 'mailbox: ' + str_(inbox && inbox.message);
    return out;
  }
  var threads = (inbox.data && inbox.data.threads) || [];

  var judged = {};
  var aiSheet = null;
  try {
    aiSheet = hubTabEnsure_(HIRING_SIM_AI_TAB, HIRING_SIM_AI_HEADER);
    readTabNormalized_(ssOpen_(hubId_('HUB_DB_ID')), HIRING_SIM_AI_TAB).forEach(function (r) {
      if (str_(r.messageid)) judged[str_(r.messageid)] = str_(r.verdict);
    });
  } catch (eJ) { return out; }

  var listed = simShortlistNames_();
  var listedNames = listed.map(function (n) { return n.name; });

  for (var i = 0; i < threads.length; i++) {
    var t = threads[i] || {};
    var from = str_(t.from_addr).toLowerCase();
    var isDecider = false;
    for (var a = 0; a < allowed.length; a++) {
      if (allowed[a] && from.indexOf(allowed[a]) !== -1) { isDecider = true; break; }
    }
    if (!isDecider) continue;
    out.read++;
    var mid = 'sim:' + str_(t.id || (str_(t.date) + '|' + str_(t.subject)));
    if (judged[mid] !== undefined) continue;
    var body = str_(t.snippet);
    if (!body) continue;

    var verdict = simInterestVerdictRule_(body);
    var names = [], via = 'rule';
    if (!verdict) {
      var ai = simInterestClassifyAi_(body, listedNames);
      if (!ai) continue;                       // no provider — next pass retries
      verdict = ai.verdict;
      via = ai.via;
      // the anti-invention gate: only names on the shortlist survive
      names = ai.names.filter(function (n) {
        return listedNames.some(function (l) { return l.toLowerCase() === String(n).toLowerCase(); });
      });
    }
    aiSheet.appendRow([mid, verdict, names.join('; '), via, new Date().toISOString()]);
    judged[mid] = verdict;
    out.judged++;

    var acted = simInterestAct_(verdict, names, from, mid, listed);
    if (acted.acted) { out.acted = acted.acted; out.names = names; }
    // 'other' is remembered and moves nothing
  }
  return out;
}

// WHAT A TEAM VERDICT DOES — one implementation, reached by the real reply scan AND by the pretend button — a press…
function simInterestAct_(verdict, names, from, mid, listed) {
  var out = { acted: '' };
  if (!listed) listed = simShortlistNames_();
  if (verdict === 'ok' || verdict === 'selected') {
    simAskAnswer_(['ask', 'shortlist'], from, '');
    out.acted = verdict;
    journeyLog_({ candidate_id: '', name: names.join(', '), step: 'interest',
                  title: verdict === 'ok'
                    ? 'The team said to proceed'
                    : 'The team chose who to proceed with',
                  channel: 'email', to: '', ok: true,
                  detail: verdict === 'ok'
                    ? (listed.length
                        ? 'reply from ' + from + ' — start with the shortlist as sent'
                        : 'reply from ' + from + ' — hiring is open; the shortlist is the next step')
                    : 'reply from ' + from + ' — chosen: ' + (names.join(', ') || '(no listed name matched)'),
                  ref: mid, by: from });
    // and each chosen candidate's own card says so
    names.forEach(function (n) {
      var hit = null;
      listed.forEach(function (l) { if (l.name.toLowerCase() === String(n).toLowerCase()) hit = l; });
      if (hit) {
        journeyLog_({ candidate_id: hit.candidate_id, name: hit.name, step: 'interest',
                      channel: 'email', ok: true,
                      detail: 'named by ' + from + ' as somebody to proceed with',
                      ref: mid, by: from });
      }
    });
    // SIM-ONLY, stays behind when the lane ports: THE CARD IS BORN FROM THE CHOICE: the rehearsal card is filled in…
    if (verdict === 'selected' && names.length) {
      try {
        var card = (typeof hiringSimCard_ === 'function') ? hiringSimCard_() : null;
        if (!card && typeof HUB_ACTIONS !== 'undefined' && HUB_ACTIONS.hiringSimSeed) {
 // ALL the chosen names ride on the card: five chosen means five on the card, even though the code will only e-mail…
          var seeded = HUB_ACTIONS.hiringSimSeed(
            { name: names.join(', ') },
            { role: 'manager', email: 'hiring-sim-scan@service.local', id: 'SVC_HIRING_SIM' });
          if (seeded && Number(seeded.status) === 200 && seeded.data && seeded.data.created) {
            out.card = str_(seeded.data.candidate_id);
            journeyLog_({ candidate_id: out.card, name: str_(seeded.data.name),
                          step: 'interest', channel: '', ok: true,
                          detail: 'the rehearsal card was born from the choice — ' +
                                  names.length + ' name(s) on it, the actor mailboxes ' +
                                  'behind it: ' + names.join(', '),
                          ref: mid, by: from });
          } else {
 // A REFUSED BIRTH SPEAKS (the first cut swallowed it and left an unchanged panel on screen).
            out.card_error = str_(seeded && seeded.message) ||
              ('the seed answered ' + String(seeded && seeded.status));
            journeyLog_({ candidate_id: '', name: names.join(', '), step: 'interest',
                          channel: '', ok: false,
                          detail: 'the choice could NOT mint the rehearsal card — ' +
                                  out.card_error,
                          ref: mid, by: from });
          }
        }
      } catch (eSeed) {
        out.card_error = 'the seed threw: ' + String((eSeed && eSeed.message) || eSeed);
      }
    }
  } else if (verdict === 'more') {
    out.acted = 'more';
    // The next five from the ranking window, never the same five again.
    var excl = listed.map(function (l) { return l.candidate_id; }).filter(String);
    var env = null;
    try {
      env = hiringShortlistCore_(
        // no_auto: the auto decider must not answer the letter its own "more" just asked for — one voice per round.
        { limit: 5, exclude_ids: excl, no_auto: true },
        { role: 'manager', email: 'hiring-sim-scan@service.local', id: 'SVC_HIRING_SIM' });
    } catch (eM) { env = null; }
    journeyLog_({ candidate_id: '', name: '', step: 'interest',
                  title: 'The team asked for more options',
                  channel: 'email', ok: !!(env && Number(env.status) === 200),
                  detail: 'reply from ' + from + ' — sent the next 5 from the ranking window',
                  ref: mid, by: from });
  }
  return out;
}

// Three valid future weekday slots at the company hours — what the pretend interviewer proposes when nobody typed…
function simPretendSlots_() {
  var out = [], d = new Date();
  var times = ['10:00', '14:00', '17:00'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  while (out.length < 3) {
    d.setDate(d.getDate() + 1);
    var dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
               time: times[out.length] });
  }
  return out;
}

// Rider on the machine pass — service reads only, 15-min throttle.
function hiringSimSweepMaybe_() {
  if (typeof HUB_IS_SERVICE_REQ === 'undefined' || !HUB_IS_SERVICE_REQ) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('hiring_sim_sweep_ran')) return;
  cache.put('hiring_sim_sweep_ran', '1', 900);
  try { hiringSimRetryRun_(); }
  catch (e) {
    hubSysLog_('auto-hiring-sim', 'hiring_sim_sweep_error',
               String((e && e.message) || e), { status: 500 });
  }
}

// ------------------------------------------------------------------ the doors…

HUB_POLICY.hiringSimConfigGet = {
  file: 'HiringSimConfig.gs', lane: 'read', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
// Every row with its note and default, plus the resolved cast — the screen shows what will actually be addressed…
HUB_ACTIONS.hiringSimConfigGet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  try { hiringSimCfgSheet_(); } catch (eSeed) { /* defaults still answer */ }
  var cfg = hiringSimCfg_();
  return { status: 200, data: {
    rows: HIRING_SIM_CFG_DEFAULTS.map(function (d) {
      var v = cfg[d.key] !== undefined ? String(cfg[d.key]) : '';
      var dv = str_(d.value) || simTextDefault_(d.key);
      return { key: d.key, value: v !== '' ? v : dv,
               note: d.note, default_value: dv };
    }),
    actors: hiringSimActors_(),
    attempts: {
      ask: simAttemptsFor_('ask'), shortlist: simAttemptsFor_('shortlist'),
      outreach: simAttemptsFor_('outreach'), invite: simAttemptsFor_('invite')
    },
    asks: simAskRows_().map(function (r) {
      return { id: str_(r.simaskid), step: str_(r.step), candidate_id: str_(r.candidateid),
               sent: str_(r.sentcount), max: str_(r.maxattempts),
               interval_minutes: str_(r.intervalminutes),
               last_sent_at: str_(r.lastsentat), state: str_(r.state),
               answered_by: str_(r.answeredby) };
    })
  } };
};

HUB_POLICY.hiringSimConfigSet = {
  file: 'HiringSimConfig.gs', lane: 'write', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: []
};
// Save edited cells.
HUB_ACTIONS.hiringSimConfigSet = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var values = (payload && payload.values) || {};
  var known = {};
  HIRING_SIM_CFG_DEFAULTS.forEach(function (d) { known[d.key] = true; });
  var unknown = [];
  for (var uk in values) { if (values.hasOwnProperty(uk) && !known[uk]) unknown.push(uk); }
  if (unknown.length) {
    return { status: 400, message: 'This backend version does not know: ' + unknown.join(', ') +
             ' — publish the latest Apps Script version and save again.' };
  }
  var sheet = hiringSimCfgSheet_();
  var data = sheet.getDataRange().getValues();
  var changed = 0;
  for (var key in values) {
    if (!values.hasOwnProperty(key) || !known[key]) continue;
    var v = String(values[key] == null ? '' : values[key]);
    var found = false;
    // EVERY row with this key, not the first — the duplicate-key lesson.
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0]).trim() === key) {
        sheet.getRange(r + 1, 2).setValue(hubCellSafe_(v));
        found = true;
      }
    }
    if (!found) {
      var def = null;
      HIRING_SIM_CFG_DEFAULTS.forEach(function (d) { if (d.key === key) def = d; });
      sheet.appendRow([key, hubCellSafe_(v), def ? def.note : '']);
    }
    changed++;
  }
  try { CacheService.getScriptCache().remove(HIRING_SIM_CFG_CACHE); } catch (e) { /* 60s */ }
  hubSysLog_(str_(user && user.email), 'hiring_sim_config_set', changed + ' key(s)', { status: 200 });
  return { status: 200, data: { saved: changed, actors: hiringSimActors_() } };
};

HUB_POLICY.hiringInterestScan = {
  file: 'HiringSimConfig.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: ['emailSend']
};
// Read the deciders' replies NOW — the simulator's step 2 button.
HUB_ACTIONS.hiringInterestScan = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var out;
  try { out = hiringInterestScanRun_(); }
  catch (e) { return { status: 500, message: String((e && e.message) || e) }; }
  return { status: 200, data: out || {} };
};

HUB_POLICY.hiringSimPretendReply = {
  file: 'HiringSimConfig.gs', lane: 'tool', store: 'sheet',
  idempotent: false, cost: 'seconds',
  roles: ['admin', 'manager'],
  params: {
    channel: { required: true, type: 'string' },
    text: { required: false, type: 'string' },
    from: { required: false, type: 'string' },
    candidate_id: { required: false, type: 'string' }
  },
  invalidates: ['candidates'], emits: ['emailSend', 'smsSend']
};
// THE PRETEND REPLY.
HUB_ACTIONS.hiringSimPretendReply = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var p = payload || {};
  var channel = str_(p.channel).toLowerCase();
  var text = str_(p.text);
  var actors = hiringSimActors_();
  var mid = 'sim:pretend:' + randomHex_(8);

  if (channel === 'team') {
    if (!text) return { status: 400, message: 'Type the reply you are pretending — the machine reads the words.' };
    // {names}/{top} write themselves from the current shortlist, so a preset can choose the winners without knowing…
    var subNames = simShortlistNames_().map(function (l) { return l.name; });
    text = text.replace(/\{names\}/g, subNames.join(', ')).replace(/\{top\}/g, subNames[0] || '');
    var from = str_(p.from) || (actors.decider_emails[0] || '');
    var listed = simShortlistNames_();
    var listedNames = listed.map(function (l) { return l.name; });
    var verdict = simInterestVerdictRule_(text);
    var names = [], via = 'rule:pretend';
    if (!verdict) {
      var ai = simInterestClassifyAi_(text, listedNames);
      if (!ai) {
        return { status: 502, message: 'No model would read the message — try again, or write a plain OK.' };
      }
      verdict = ai.verdict;
      via = str_(ai.via) + ':pretend';
      names = ai.names.filter(function (n) {
        return listedNames.some(function (l) { return l.toLowerCase() === String(n).toLowerCase(); });
      });
    }
    try {
      var aiSheet = hubTabSheet_(HIRING_SIM_AI_TAB);
      if (aiSheet) aiSheet.appendRow([mid, verdict, names.join('; '), via, new Date().toISOString()]);
    } catch (eMemo) { /* the verdict still acts; only the memo is lost */ }
    var acted = simInterestAct_(verdict, names, from + ' (pretend)', mid, listed);
    return { status: 200, data: { read_as: verdict, names: names, via: via,
             acted: acted.acted || 'nothing — the message decided nothing',
             from: from, pretend: true } };
  }

  if (channel === 'candidate') {
    var cid = str_(p.candidate_id);
    if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid)) return { status: 400, message: 'invalid candidate_id' };
    if (!simIsRehearsalCid_(cid)) {
      return { status: 409, message: 'Pretend replies land on REHEARSAL cards only — this one is a real person.' };
    }
    var ev = hubEvidence_(cid);
    if (!ev.cand) return { status: 404, message: 'No candidate "' + cid + '".' };
    var body = text || 'YES — I want to participate in the selection process.';
    // Filed EXACTLY like a real inbound message, then read by the same scan.
    try {
      inboundSheet_();
      hubAppendRow_(INBOUND_TAB, {
        message_id: 'SIMMSG_' + randomHex_(10).toUpperCase(),
        received_at: new Date().toISOString(),
        from_number: str_(ev.cand.phone),
        from_key: str_(ev.cand.phone).replace(/\D/g, '').slice(-10),
        candidate_id: cid,
        person_name: str_(ev.cand.candidatename),
        body: body,
        intent: 'reply',
        our_number: '',
        recorded_at: new Date().toISOString()
      });
    } catch (eIn) {
      return { status: 500, message: 'The inbound row could not be filed: ' + String((eIn && eIn.message) || eIn) };
    }
    hubBustTalentCache_();
    var scanned = hiringOutreachReplyScan_(cid, user);
    return { status: 200, data: { pretend: true, filed: true, read: scanned,
             note: scanned.matched
               ? 'the reply was filed and READ — the acceptance flow ran'
               : 'the reply was filed; the scan did not read it as a yes: "' + body.slice(0, 60) + '"' } };
  }

  if (channel === 'pick') {
    var cid2 = str_(p.candidate_id);
    if (!/^CAN_[A-Za-z0-9]{6,}$/.test(cid2)) return { status: 400, message: 'invalid candidate_id' };
    if (!simIsRehearsalCid_(cid2)) {
      return { status: 409, message: 'Pretend picks land on REHEARSAL cards only.' };
    }
    var ask = (typeof interviewAskOpenFor_ === 'function') ? interviewAskOpenFor_(cid2) : null;
    if (!ask) return { status: 409, message: 'No open scheduling ask — send the invite (step 9) first.' };
    var token = interviewTokenFor_(str_(ask.askid), cid2);
    if (!token) return { status: 409, message: 'INTERVIEW_LINK_SECRET is not set — there is no link to press.' };
    // A slot that is really free, chosen the way the page would.
    var taken = interviewTakenSlots_();
    var slot = null;
    simPretendSlots_().forEach(function (s2) {
      if (!slot && taken.indexOf(s2.date + 'T' + s2.time) === -1) slot = s2;
    });
    if (!slot) return { status: 409, message: 'Every generated slot is taken — pick one on the page itself.' };
    // THE REAL PUBLIC DOOR, real token and all: what is rehearsed is the door.
    var env = interviewSlotSubmitPub_({ t: token, date: slot.date, time: slot.time });
    return { status: 200, data: { pretend: true, picked: slot,
             door: env && env.status, message: str_(env && env.message),
             note: Number(env && env.status) === 200
               ? 'the pick went through the real public door — the interviewer ask fired'
               : 'the public door refused: ' + str_(env && env.message) } };
  }

  if (channel === 'interviewer') {
    if (!text) return { status: 400, message: 'Type the reply you are pretending — the machine reads the words.' };
    var today = interviewTodayText_();
    var verdict2 = interviewReplyVerdict_(text);
    var slots = null, via2 = 'rule:pretend';
    if (!verdict2) {
      var ai2 = interviewAskClassifyAi_(text, today);
      if (!ai2) {
        return { status: 502, message: 'No model would read the message — try again, or write a plain YES or NO.' };
      }
      verdict2 = ai2.verdict;
      slots = ai2.slots || null;
      via2 = str_(ai2.via) + ':pretend';
    }
    try {
      interviewAskAiSheet_().appendRow([mid, verdict2, slots ? JSON.stringify(slots) : '',
                                        via2, new Date().toISOString()]);
    } catch (eM2) { /* the verdict still acts */ }
    // REHEARSAL ASKS ONLY — the pretend interviewer can never book a real candidate's meeting.
    var acted2 = interviewAskApply_(verdict2, slots, mid, today, true);
    return { status: 200, data: { pretend: true, read_as: verdict2, via: via2,
             slots: slots, acted: acted2,
             note: acted2
               ? 'the verdict acted on the waiting rehearsal ask'
               : 'nothing was waiting for that verdict — check the exchange state on the right' } };
  }

  return { status: 400, message: 'channel must be team, candidate, pick or interviewer.' };
};

HUB_POLICY.hiringSimRetryNow = {
  file: 'HiringSimConfig.gs', lane: 'tool', store: 'sheet',
  idempotent: true, cost: 'seconds',
  roles: ['admin', 'manager'],
  invalidates: [], emits: ['emailSend', 'smsSend']
};
// Run the retry pass on demand — reads replies first, then re-sends what is due.
HUB_ACTIONS.hiringSimRetryNow = function (payload, user) {
  if (!hubIsWriter_(user)) return hubDenied_();
  var out;
  try { out = hiringSimRetryRun_(); }
  catch (e) { return { status: 500, message: String((e && e.message) || e) }; }
  return { status: 200, data: out || {} };
};

/** ▶ Run the retry pass from the editor. */
function runHiringSimRetry() {
  var out = hiringSimRetryRun_();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ------------------------------------------------------------------ STEP 3 OF THE PIPELINE TAB — the SIM as ARTHUR…

// One small text file into a Drive folder (multipart, shared-drive aware — the same REST style the watcher reads…
function simCjisDropFile_(folderId, filename, text) {
  var boundary = 'simcjis' + randomHex_(8);
  var meta = { name: filename, parents: [folderId], mimeType: 'text/plain' };
  var body = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
    text + '\r\n' +
    '--' + boundary + '--';
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    { method: 'post', contentType: 'multipart/related; boundary=' + boundary,
      payload: body, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true });
  return res.getResponseCode() < 300;
}

// The drop itself — a MANUAL press.
function simCjisDropAct_(cid, user) {
  if (!simIsRehearsalCid_(cid)) return null;
  var ev;
  try { ev = hubEvidence_(cid); } catch (e) { return null; }
  if (!ev || !ev.cand) return null;
  var name = str_(ev.cand.candidatename);
  var folder = (typeof cjisFolderId_ === 'function') ? cjisFolderId_() : '';
  if (!folder) {
    journeyLog_({ candidate_id: cid, name: name, step: 'cjis_request', channel: 'folder',
                  ok: false, rehearsal: true, by: 'asa-hub:sim-auto',
                  detail: 'SIM acting as Arthur: NO designated folder is set (HUB_FOLDER_ORIGINAL_DOCS / COMPLIANCE_SHARED_FOLDER_ID / CJIS_FOLDER_ID) — nothing to drop into' });
    return { dropped: false, error: 'no_folder' };
  }
  var stamp = Utilities.formatDate(new Date(), 'Etc/GMT', 'yyyyMMdd');
  var filename = name + ' - CJIS Report (SIM) - ' + stamp + '.txt';
  var text = '[SIM] Rehearsal background report.\n' +
    'I am the SIMULATION acting as Arthur (the extractor). This file was placed in the ' +
    'designated documents folder by the rehearsal so the REAL folder watcher can find, ' +
    'match and attach it.\n' +
    'Candidate: ' + name + '\n' +
    'Not a real record. The teardown removes it.';
  var ok = simCjisDropFile_(folder, filename, text);
  try { CacheService.getScriptCache().remove(CJIS_CACHE_KEY); } catch (eC) {}
 // THE RIGHT RETURN, OR THE GATE DOES NOT PASS: the collector marks 'On file' on purpose — the CLEAR verdict is a…
  if (ok) {
    try {
      hubSetFieldLastRow_(TALENT_RESUME_TAB, cid, { cjis_status: 'Clear' }, user, true);
      hubBustTalentCache_();
    } catch (eV) { /* the file is in the folder either way; the journey says so */ }
  }
  journeyLog_({ candidate_id: cid, name: name, step: 'cjis_request', channel: 'folder',
                ok: ok, rehearsal: true, by: 'asa-hub:sim-auto',
                detail: ok
                  ? 'SIM acting as Arthur: put "' + filename + '" in the designated docs folder AND marked the reading Clear — the folder watch (next step) collects the file and the gate reads Clear + report'
                  : 'SIM acting as Arthur: Drive refused the file drop — the folder may be read-only to the platform account' });
  return { dropped: ok, file: ok ? filename : '', verdict: ok ? 'Clear' : '' };
}

// The teardown's half: every "(SIM)" file leaves the folder with the rehearsal.
function simCjisCleanup_() {
  var folder = (typeof cjisFolderId_ === 'function') ? cjisFolderId_() : '';
  if (!folder) return 0;
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var removed = 0;
  try {
    var url = 'https://www.googleapis.com/drive/v3/files?' +
      'q=' + encodeURIComponent("'" + folder + "' in parents and trashed=false and name contains '(SIM)'") +
      '&fields=' + encodeURIComponent('files(id,name)') +
      '&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true';
    var res = UrlFetchApp.fetch(url, { headers: auth, muteHttpExceptions: true });
    if (res.getResponseCode() >= 400) return 0;
    var files = (JSON.parse(res.getContentText()).files || []);
    files.forEach(function (f) {
      var r = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + f.id + '?supportsAllDrives=true',
        { method: 'patch', contentType: 'application/json',
          payload: JSON.stringify({ trashed: true }), headers: auth,
          muteHttpExceptions: true });
      if (r.getResponseCode() < 300) removed++;
    });
    if (removed) { try { CacheService.getScriptCache().remove(CJIS_CACHE_KEY); } catch (eC) {} }
  } catch (e) { /* the teardown never fails over a folder */ }
  return removed;
}

// The rehearsal's Arthur ANSWERS THE ASK BY ITSELF (auto on, fence on) — no button, the same law as every other…
function simAutoCjisAnswer_(cid, user) {
  if (!simAutoReplyOn_()) return null;
  if (!simIsRehearsalCid_(cid)) return null;
  var actors = hiringSimActors_();
  var from = (actors.decider_sms && actors.decider_sms[0]) || '';
  try {
    hubAppendRow_(INBOUND_TAB, {
      message_id: 'SIMAUTO_' + randomHex_(10).toUpperCase(),
      received_at: new Date().toISOString(),
      from_number: from,
      from_key: String(from).replace(/\D/g, '').slice(-10),
      candidate_id: cid,
      person_name: 'SIM acting as Arthur',
      body: 'Yes — the candidate sent it to me. (I am the SIMULATION acting as Arthur.)',
      intent: 'reply', our_number: '', recorded_at: new Date().toISOString()
    });
  } catch (eRow) { return { answered: false, error: 'the inbound row could not be filed' }; }
  var drop = null;
  try { drop = simCjisDropAct_(cid, user); } catch (eD) { drop = null; }
  var heard = null;
  try { if (typeof cjisAskScanRun_ === 'function') heard = cjisAskScanRun_(); } catch (eH) { heard = null; }
  return { answered: true, drop: drop, heard: heard };
}

// The INTERVIEWER actor chooses days BY ITSELF (rehearsal + auto, step "interviewer_days"): the next weekdays…
function simAutoInterviewerDays_(cid, askId) {
  if (!simAutoReplyOn_()) return null;
  if (!simIsRehearsalCid_(cid)) return null;
  var days = [];
  var d = new Date();
  var guard = 0;
  while (days.length < 4 && guard < 14) {
    d.setDate(d.getDate() + 1); guard++;
    var dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    days.push(Utilities.formatDate(d, 'Etc/GMT', 'yyyy-MM-dd'));
  }
  var skipped = days.splice(1, 1);   // the second weekday stays blocked on purpose
  var env = null;
  try { env = interviewDaysSubmitPub_({ t: interviewDaysTokenFor_(askId), days: days }); }
  catch (e) { env = null; }
  var ok = !!(env && Number(env.status) === 200);
  var actors = hiringSimActors_();
  journeyLog_({ candidate_id: cid, name: actors.interviewer_name, step: 'interviewer_days',
                channel: 'web', ok: ok, rehearsal: true,
                detail: ok
                  ? 'the interviewer actor chose ' + days.join(', ') + ' BY ITSELF (the real ' +
                    'public door) — ' + skipped.join(', ') + ' left out on purpose so the gray ' +
                    'shows; the candidate\'s calendar went out with the choice'
                  : 'the actor tried to choose days and the door refused: ' + str_(env && env.message),
                by: 'asa-hub:sim-auto' });
  return { chose: ok ? days : [], blocked_example: skipped };
}
