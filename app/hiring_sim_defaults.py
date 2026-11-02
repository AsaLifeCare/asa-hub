"""The hiring simulation's shipped cast and words (HiringSimConfig.gs HIRING_SIM_CFG_DEFAULTS, HiringSim.gs
HIRING_SIM_SAMPLE_TRANSCRIPT): every parameter of the rehearsal is a cell, and these are the cells' floors."""
from __future__ import annotations

# (key, shipped value — None when the words book's Strings tab holds it, note)
CFG_DEFAULTS: tuple[tuple[str, str | None, str], ...] = (
    ("sim_mode", "actors",
     "actors = REAL sends to the configured actor mailboxes, real team in Cc — test mode should be OFF or "
     "it redirects everything to one tester. redirect = the old shape: test mode must be ON and every "
     "message goes to the single redirect address."),
    ("sim_candidate_email", "asa-hub3@asaop.org",
     "The fake candidate — the rehearsal card is created with this address, so every letter addressed to "
     "the candidate lands in this mailbox."),
    ("sim_candidate_phone", "+13309195558",
     "The rehearsal card's phone (+1XXXXXXXXXX). Candidate SMS land here. The asatech line by default, so "
     "a reader sees what a candidate would receive."),
    ("sim_interviewer_name", "[TEST] Interviewer",
     "The interviewer ACTOR's display name. A rehearsal card's interviewer ask goes to this actor and "
     "NEVER to the real badge holder — that routing is by the [TEST] name on the card, not by this cell."),
    ("sim_interviewer_email", "asa-hub4@asaop.org",
     "The interviewer actor's mailbox — the availability ask and the thank-you land here for rehearsal "
     "cards. Real candidates keep the INTERVIEWER badge resolution untouched."),
    ("sim_interviewer_phone", "",
     "Optional. The interviewer actor's SMS number (+1XXXXXXXXXX). Blank = e-mail only, which is an "
     "ordinary interviewer since 2026-08-21."),
    ("sim_cc_emails", "asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com",
     "IN COPY ON EVERY CANDIDATE-FACING E-MAIL — the three ride in copy: the outreach, the call "
     "instruction, the scheduling link. Comma-separated; an address already in To is never doubled into "
     "Cc."),
    ("sim_watcher_emails", "asatech@asalifecare.com",
     "IN COPY ON TEAM LETTERS — asatech alone rides in copy. Team letters go To the deciders with THIS "
     "list in Cc — so all three read it, but To and Cc are never the same people twice."),
    ("sim_team_emails", "asatech@asalifecare.com, ty.bond@asalifecare.com, arthur.torres@asalifecare.com",
     "WHO THE SIMULATION WRITES TO as \"the team\" — the ask, the shortlist, the decision. Blank falls back "
     "to hiring_team_emails. These are REAL addresses on purpose."),
    ("sim_decider_emails", "arthur.torres@asalifecare.com, ty.bond@asalifecare.com",
     "The two whose word starts the process (steps 2, 3 and 5): Arthur and Ty. Their replies are the ones "
     "the reader trusts; the thank-you and the \"they said yes\" go to them, with the copy list in Cc."),
    ("sim_team_sms", "+13309195559, +13309195558, +19377166410, +13309197779",
     "The team's Quo numbers: Arthur (330) 919-5559 · asatech (330) 919-5558 · Ty Bond (937) 716-6410 and "
     "(330) 919-7779. Team SMS in the simulation go to these."),
    ("sim_decider_sms", "+13309195559, +19377166410",
     "WHERE THE QUO NUDGES GO — one number per DECIDER (Arthur 5559, Ty 6410). The accepted notice and "
     "the decision nudge text THESE, not the whole team list (four numbers meant every notice arrived "
     "four times). Blank falls back to sim_team_sms."),
    ("sim_attempts", "1",
     "HOW MANY TIMES a retryable send is tried until a reply arrives. The production intent is 5–7; it "
     "ships as 1 because these sends reach REAL mailboxes during the tests. Per-step overrides below win "
     "when filled."),
    ("sim_attempts_resume_request", "3",
     "The referral ladder's FIRST rung: how many times the person themselves is written before the "
     "referrer is bothered. Ships at 3 — a human needs days, not sweep ticks; the ladder also waits the "
     "retry interval past the last send."),
    ("sim_retry_minutes_referral_relay", "120",
     "Two hours between asks to the REFERRER for the candidate's contact: seven on the first day; a "
     "second seven starts the next Ohio morning."),
    ("sim_attempts_referral_relay", "7",
     "The ladder's SECOND rung: how many times the referrer is asked before the discard (chapter d). Same "
     "quiet-interval law as above."),
    ("sim_retry_minutes", "30",
     "Minutes between attempts — one ask every half hour. The sweep rides the service read traffic, so "
     "the real spacing is at least this and can be a few minutes more."),
    ("sim_attempts_manual_contact", "7",
     "The Added Manually machine: how many times a hand-added candidate is written — both legs, text and "
     "letter — before the person who added them is bothered. The rule says seven."),
    ("sim_retry_minutes_manual_contact", "120",
     "Minutes between the invitation tries. The rhythm is the same everywhere: seven times, one every two "
     "hours."),
    ("sim_attempts_manual_resume", "3",
     "How many times a candidate who ANSWERED is asked for their résumé — text and letter — before the "
     "asking ends. Blank = these three (this step ships its own default). The folders are read first "
     "every time: a résumé already filed settles the ask instead of asking again."),
    ("sim_retry_minutes_manual_resume", "1440",
     "Minutes between résumé asks — a day. Slower than the first contact on purpose: this person already "
     "answered, and a résumé takes longer to find than a reply. Blank = these 1440. Under 5 the platform "
     "IGNORES the cell."),
    ("sim_attempts_interview_days", "7",
     "How many times the interviewer is asked which days she can take — text AND letter each time — "
     "before the asking ends. It used to ask once: days_asked_at was written and read in one place in the "
     "whole tree, so an unopened link left the candidate's calendar unsent for good."),
    ("sim_retry_minutes_interview_days", "30",
     "Half an hour between asks — one every half hour. Faster than the others on purpose: a candidate is "
     "waiting on the other side of it, and opening a link is a moment, not an errand. Blank = these 30."),
    ("sim_attempts_phone_collect", "7",
     "E-mail-only candidate at New: how many times we ask BY LETTER for a phone number before the team is "
     "told collection failed."),
    ("sim_retry_minutes_phone_collect", "120",
     "Two hours between phone-collection letters."),
    ("sim_attempts_phone_confirm", "7",
     "The number arrived: how many times the confirmation text — the one asking the candidate to reply "
     "YES — is sent before the team is told the phone could not be confirmed."),
    ("sim_retry_minutes_phone_confirm", "120",
     "Two hours between confirmation texts."),
    ("sim_attempts_interview_slots", "7",
     "How many times the interviewer is asked for her slots — three on the first round, six when the "
     "candidate says none of them work."),
    ("sim_retry_minutes_interview_slots", "120",
     "Two hours between slot asks."),
    ("sim_attempts_onboarding_finish", "7",
     "Somebody began the onboarding and closed the tab: how many finish-your-onboarding letters — each "
     "carrying the login link and password — before Arthur and Ty are told."),
    ("sim_retry_minutes_onboarding_finish", "120",
     "Two hours between finish-your-onboarding letters."),
    ("sim_manual_armed_from", "",
     "BLANK = the stamped arming date stands (the machine speaks only to cards born after it first ran, "
     "so a publish never surprises a standing board). An ISO date here OVERRIDES that stamp — 2026-08-01 "
     "means \"speak to everybody at New created on or after the 1st of August\". Written for the five real "
     "candidates who became permanently unreachable by accident of calendar, and who were also holding "
     "the release floor shut. Clearing the cell puts the original protection straight back."),
    ("sim_attempts_screen_call", "7",
     "How many times somebody standing at Phone Screen is asked to call the evaluation line — text AND "
     "letter each time. The message existed and nothing ever sent it; three people had been waiting over "
     "a month."),
    ("sim_retry_minutes_screen_call", "120",
     "Two hours between screening-call asks — the standing rhythm, with the message naming the two-day "
     "window. Under 5 the platform IGNORES the cell."),
    ("sim_attempts_packet_request", "7",
     "How many times a new hire at Onboarding is asked for the signed New Hire packet — text AND letter "
     "each time. It used to ask once, on arrival, and never again: the sweep gated on packet_requested_at "
     "and wrote that stamp itself."),
    ("sim_retry_minutes_packet_request", "1440",
     "A day between packet asks. Blank = these 1440. Under 5 the platform IGNORES it."),
    ("sim_attempts_ready_ask", "7",
     "How many times the deciders are asked whether somebody who finished onboarding may move to Ready to "
     "Start. It used to be \"asked once, ever\"."),
    ("sim_retry_minutes_ready_ask", "1440",
     "A day between asks to the deciders. Blank = these 1440."),
    ("sim_test_candidate_ids", "",
     "REHEARSAL CARDS BY ID, comma-separated, and they belong in the config rather than in code. A test "
     "card whose phone and address look real cannot be claimed by the predicate's rules, so its id is "
     "named — here, without touching code. Merged with the shipped list (the Jhonatan and Devona cards); "
     "production never texts these, the rehearsal machinery owns them, and the test-card archiver may "
     "sweep them after a quiet week."),
    ("sim_archive_test_days", "7",
     "Days a REHEARSAL card may sit untouched on the board before it is archived — a test card may be "
     "removed, but only once it is more than 7 days old. It is the last touch that counts, not the birth, "
     "so a walk in progress is never swept out from under whoever is walking it. Only cards "
     "commsIsTestCandidate_ claims are touched. 0 switches the sweep off — and a rehearsal standing at "
     "New counts against the release floor exactly like a person."),
    ("sim_attempts_manual_adder", "2",
     "The Added Manually machine's second rung: how many times whoever ADDED the card is asked — "
     "withdraw, or reach them yourself — before the silent discard."),
    ("sim_retry_minutes_manual_adder", "720",
     "Minutes between the adder asks — twelve hours. A per-step clock: it wins over sim_retry_minutes for "
     "this step alone."),
    ("sim_attempts_director_docs", "3",
     "The director fast lane: how many times Arthur and Ty are asked for the pieces a fast-laned "
     "Onboarding card still lacks — the resume and/or the CJIS report — before the asking ends. The "
     "folder watch keeps looking every pass either way, and a late file still closes the ask."),
    ("sim_retry_minutes_director_docs", "720",
     "Minutes between the director-docs asks — twelve hours. A per-step clock: it wins over "
     "sim_retry_minutes for this step alone."),
    ("sim_talent_finish_minutes", "10",
     "THE FINISHER — the card stands for a few minutes and then finalizes itself, automatically. How many "
     "minutes somebody who already works here stands at Ready to Start after crossing from the Talent "
     "Pipeline before the platform closes their record. It touches ONLY cards the crossing door marked — "
     "never anybody a person put at Ready by hand."),
    ("sim_talent_autocross_per_pass", "10",
     "THE AUTOMATIC CROSSING — the crossing is a process the platform runs by itself. How many signed "
     "applications the platform may bring onto the board by itself in one pass. It exists so a bad day "
     "cannot mint a hundred cards before anybody notices; the rest wait for the next pass, minutes later. "
     "0 turns the automatic crossing OFF and the queue in Actions goes back to being the only door."),
    ("sim_talent_autocross_backlog", "no",
     "Whether the automatic crossing may also take applications signed BEFORE it was armed — the 130 "
     "already waiting. \"no\" (the default) means only somebody who signs from now on comes in by itself, "
     "and the backlog stays a press in Actions, one name at a time. Say \"yes\" to let the machine work "
     "through the backlog too, at sim_talent_autocross_per_pass a pass."),
    ("sim_talent_autofill_new_floor", "2",
     "THE FLOOR UNDER THE RELEASE — with nobody monitoring and fewer than 2 candidates standing at New, "
     "the first 3 in the queue are taken. When fewer than this many cards stand at New AND no person has "
     "moved a card for sim_talent_autofill_idle_hours, the platform brings in the queue's next few by "
     "itself. 0 turns it off and the release stays entirely a person's press."),
    ("sim_talent_autofill_take", "3",
     "How many the platform starts when the board has run dry and nobody is watching. They come in "
     "through the SAME door a press uses, so the duplicate check, the contact guard and the landing are "
     "all re-asked."),
    ("sim_talent_autofill_idle_hours", "12",
     "How many hours without a PERSON moving any card count as \"nobody is monitoring\". The evidence is "
     "log_status_history, which every status write appends to with its actor; a machine actor is not "
     "somebody watching, or the sweeps would keep each other awake and this would never fire."),
    ("sim_attempts_ready_parked", "4",
     "THE PARKING MACHINE — seven days, and configurable. How many times the deciders are told that "
     "somebody has stood at Ready to Start with nobody scheduling them. The clock renews itself after "
     "each notice; this is what stops it renewing forever. The asking ends by itself the moment the card "
     "leaves Ready — it never waits for a reply."),
    ("sim_retry_minutes_ready_parked", "10080",
     "THE SEVEN DAYS, in the minutes every other clock here is written in: 10080 = 7 × 24 × 60. It is the "
     "whole parking length — the first notice goes when somebody has stood at Ready this long, and each "
     "notice pushes the next one out by the same. Change this ONE cell to change what \"parked too long\" "
     "means."),
    ("sim_attempts_ask", "",
     "Attempts for step 0 (the \"are we hiring?\" ask). Blank = sim_attempts. The intended number for this "
     "one is 5."),
    ("sim_attempts_shortlist", "",
     "Attempts for step 1 (the ranked shortlist). Blank = sim_attempts. The intended number for this one "
     "is 7."),
    ("sim_attempts_outreach", "7",
     "Attempts for step 4 (the candidate outreach, SMS + e-mail). Seven, spread across one day by "
     "sim_retry_minutes_outreach. Blank = these seven (this step ships its own default) — NOT "
     "sim_attempts."),
    ("sim_retry_minutes_outreach", "205",
     "The wait between outreach attempts. 7 x 205 minutes covers just under a day, which is what \"seven "
     "times in one day\" means when nobody is awake for all of it. Blank = these 205 (this step ships its "
     "own default) — NOT sim_retry_minutes. Under 5 the platform IGNORES the cell and falls back to the "
     "global."),
    ("sim_attempts_invite", "",
     "Attempts for step 9 (the scheduling link). Blank = sim_attempts."),
    ("sim_quo_identify", "yes",
     "yes = every simulation SMS opens by saying WHO is writing and WHY — the identification comes first, "
     "then the purpose. The messages leave through the shared Quo line, and a text from an unnamed number "
     "is a text people delete."),
    ("sim_quo_intro", "ASA LifeCare hiring (asa-hub platform) — {purpose}. ",
     "The identification line itself. {purpose} is filled by the step that sends. Blank falls back to the "
     "shipped sentence."),
    ("sim_screen_line", "+13307544040",
     "The interview evaluation line the candidate is told to CALL for the phone screen — the personal "
     "evaluation happens on our own interview number. The 4040 line is where the transcripts the "
     "automation watches come from."),
    ("sim_transcript_from", "",
     "Step 8: which candidate's REAL transcript seeds the rehearsal phone screen (a CAN_ id). Blank = the "
     "newest completed screen with a transcript on file. A transcript is taken from the database so the "
     "call does not have to be made again every time."),
    ("sim_text_ask_subject", None,
     "Step 0 e-mail subject. Clear the cell to return to the shipped words."),
    ("sim_text_ask_body", None,
     "Step 0 body. The analyzed-pool count and the \"reply to this message\" line always ride along. Clear "
     "the cell to return to the shipped words."),
    ("sim_text_outreach_sms", None,
     "Step 4 SMS. THE ONLY NAME IN IT IS THE CANDIDATE'S — the company speaks as the company. "
     "Placeholders: {first_name} {name} {recruiter}. The Quo identification line (sim_quo_intro) opens "
     "the text. Clear the cell to return to the shipped words."),
    ("sim_text_outreach_email_subject", None,
     "Step 4 e-mail subject. Clear the cell to return to the shipped words."),
    ("sim_text_outreach_email_body", None,
     "Step 4 e-mail body. THE ONLY NAME IN IT IS THE CANDIDATE'S — the company speaks as the company. "
     "Placeholders: {first_name} {name} {recruiter}. Clear the cell to return to the shipped words."),
    ("sim_text_accepted_body", None,
     "Step 5 body (to the deciders). Placeholders: {name} {reply} {phone}. Clear the cell to return to "
     "the shipped words."),
    ("sim_text_screen_call_body", None,
     "Step 5.2 body — the reply telling the candidate to call the evaluation line. Placeholders: "
     "{first_name} {name} {line}. Clear the cell to return to the shipped words."),
    ("sim_text_screen_call_subject", None,
     "Step 5.2 e-mail subject. Clear the cell to return to the shipped words."),
    ("sim_text_screen_call_sms", None,
     "Step 5.2 SMS. Placeholders: {first_name} {name} {line}. Clear the cell to return to the shipped "
     "words."),
    ("sim_text_welcome_subject", None,
     "The welcome letter's subject (\"the pipeline is open\", to the team). Clear the cell to return to the "
     "shipped words."),
    ("sim_text_welcome_body", None,
     "The welcome letter's body. The who-can-open-it fact rides along. Clear the cell to return to the "
     "shipped words."),
    ("sim_text_shortlist_subject", None,
     "Step 1 subject. Clear the cell to return to the shipped words."),
    ("sim_text_shortlist_body", None,
     "Step 1 INTRO — the words above the ranked table. The table, the criteria and the reply instruction "
     "always ride along. Clear the cell to return to the shipped words."),
    ("sim_text_thanks_subject", None,
     "Step 3 subject. NO DSP name in the title — the name never goes at the top. Clear the cell to return "
     "to the shipped words."),
    ("sim_text_thanks_body", None,
     "Step 3 body — the thank-you to the deciders. {about} = EVERY chosen name, joined (5 chosen, 5 in "
     "the letter). Placeholders: {who} {about}. Clear the cell to return to the shipped words."),
    ("sim_text_accepted_subject", None,
     "Step 5 subject. Placeholder: {name}. Clear the cell to return to the shipped words."),
    ("sim_text_accepted_sms", None,
     "Step 5 Quo message to the team. Placeholders: {name} {phone}. The identification line opens it. "
     "Clear the cell to return to the shipped words."),
    ("sim_text_resume_request_subject", None,
     "Step 5.5 subject (the resume-and-phone ask). It OPENS WITH \"REFERRAL -\" because this lane exists "
     "for referred people. Clear the cell to return to the shipped words."),
    ("sim_text_resume_request_body", None,
     "Step 5.5 body — the ask: a phone AND/OR a resume, plus their interest in a selection process. "
     "Placeholders: {first_name} {name} {referrer}. Clear the cell to return to the shipped words."),
    ("sim_text_referral_relay_subject", None,
     "The referral ladder (b/c): the letter to WHOEVER REFERRED a person we could not reach. "
     "Placeholders: {name} {first_name} {referrer}. Clear the cell to return to the shipped words."),
    ("sim_text_referral_relay_body", None,
     "The referrer-relay letter's body (sent when the indications book holds a referrer e-mail). "
     "Placeholders: {name} {first_name} {referrer}. Clear the cell to return to the shipped words."),
    ("sim_text_referral_relay_sms", None,
     "The referrer-relay text (sent when the indications book holds a referrer phone). Placeholders: "
     "{name} {first_name} {referrer}. Clear the cell to return to the shipped words."),
    ("sim_text_referral_discard_subject", None,
     "The ladder's end (d): the ONE letter to Arthur and Ty when nobody had a phone or a resume. "
     "Placeholder: {name}. Clear the cell to return to the shipped words."),
    ("sim_text_referral_discard_body", None,
     "The discard letter's body (team only, ONCE per candidate ever — the book state is the guard). The "
     "fact rows (stage, reason, when) ride along. Placeholders: {name} {referrer}. Clear the cell to "
     "return to the shipped words."),
    ("sim_text_manual_contact_subject", None,
     "The Added Manually machine's first contact: the letter subject. No referrer is named — a colleague "
     "gave us the name. Placeholders: {name} {first_name}. Clear the cell to return to the shipped words."),
    ("sim_text_manual_contact_body", None,
     "The manual first-contact letter's body. Referrer-less on purpose: the company speaks as the "
     "company. Placeholders: {name} {first_name}. Clear the cell to return to the shipped words."),
    ("sim_text_manual_contact_sms", None,
     "The manual first-contact text. The Quo identification line (sim_quo_intro) opens it. Placeholders: "
     "{name} {first_name}. Clear the cell to return to the shipped words."),
    ("sim_text_manual_resume_sms", None,
     "Sent BY TEXT the moment the hand-added candidate answers anything at all — the reply itself is the "
     "return; the resume is what we ask next. THE RETURN LAW: a thing someone sends us always arrives BY "
     "E-MAIL or lands in the two special folders — never as a text attachment. Placeholders: {name} "
     "{first_name}. Clear the cell to return to the shipped words."),
    ("sim_text_manual_adder_subject", None,
     "The letter to WHOEVER ADDED the card, after a week of tries went unanswered. Placeholders: {name} "
     "{adder}. Clear the cell to return to the shipped words."),
    ("sim_text_manual_adder_body", None,
     "The adder letter's body — the two questions: withdraw, or reach them yourself (the screen line "
     "starts the phone screening). Placeholders: {name} {first_name} {adder} {data} {screen_line}. Clear "
     "the cell to return to the shipped words."),
    ("sim_text_manual_adder_sms", None,
     "The adder text, rides with the letter when their users row holds a number. Placeholders: {name} "
     "{adder} {screen_line}. Clear the cell to return to the shipped words."),
    ("sim_text_director_docs_subject", None,
     "The director fast lane's ask: the letter to Arthur and Ty when a card placed straight at Onboarding "
     "still lacks its pieces. Placeholders: {name} {missing}. Clear the cell to return to the shipped "
     "words."),
    ("sim_text_director_docs_body", None,
     "The director-docs letter's body — it names exactly what is missing and both return paths, and is "
     "honest about the reply path (the platform has no attachment ingest: a person files an e-mailed "
     "file; the folder is instant). Placeholders: {name} {missing}. Clear the cell to return to the "
     "shipped words."),
    ("sim_text_director_docs_sms", None,
     "The director-docs Quo text to the deciders, rides with the letter. On a rehearsal card it is "
     "narrated, never sent. Placeholders: {name} {missing}. Clear the cell to return to the shipped words."),
    ("sim_text_cjis_request_subject", None,
     "Step 3 subject (the folder-aware ask to the deciders). Placeholder: {name}. Clear the cell to "
     "return to the shipped words."),
    ("sim_text_cjis_request_body", None,
     "Step 3 body (the candidate may have sent it, or Arthur pulls it himself and loads a relevant "
     "folder). The candidate fact rows and the folder button always ride along. Placeholders: {name} "
     "{status}. Clear the cell to return to the shipped words."),
    ("sim_text_cjis_nudge_sms", None,
     "Step 3 Quo/OpenPhone nudge to the deciders, sent TOGETHER with the e-mail (\"mensagem via open phone "
     "pedindo para ele tirar o CJIS e carregar\"). Placeholder: {name}. Clear the cell to return to the "
     "shipped words."),
    ("sim_text_screen_redo_subject", None,
     "Step 11 LOOP subject (the call-again letter). Placeholder: {name}. Clear the cell to return to the "
     "shipped words."),
    ("sim_text_screen_redo_body", None,
     "Step 11 LOOP body — sent when a call ends without its goodbye. Placeholders: {name} {first_name} "
     "{line}. Clear the cell to return to the shipped words."),
    ("sim_text_screen_redo_sms", None,
     "Step 11 LOOP text message, rides with the letter. Placeholders: {name} {line}. Clear the cell to "
     "return to the shipped words."),
    ("sim_text_onboarding_sms", None,
     "Chapter 23 — the login BY TEXT, beside the letter. Placeholders: {first_name} {email} {password}. "
     "Clear the cell to return to the shipped words."),
    ("sim_text_ready_ask_subject", None,
     "Chapter 25 subject (the deciders are asked). Placeholder: {name}. Clear the cell to return to the "
     "shipped words."),
    ("sim_text_ready_ask_body", None,
     "Chapter 25 letter. Placeholders: {name} {notes} {link} (the candidate's profile on the platform). "
     "Clear the cell to return to the shipped words."),
    ("sim_text_ready_ask_sms", None,
     "Chapter 25 OpenPhone text, rides with the letter. Placeholders: {name} {link} (the profile link, "
     "when it should ride in the text too). Clear the cell to return to the shipped words."),
    ("sim_text_ready_parked_subject", None,
     "The parking notice's subject (the deciders are TOLD, never asked). Placeholders: {name} {days} "
     "{since} (the day they arrived) {link}. Clear the cell to return to the shipped words."),
    ("sim_text_ready_parked_body", None,
     "The parking letter. Placeholders: {name} {days} {since} {link}. It asks for nothing on purpose: the "
     "card leaving Ready is what ends the asking, and a question nobody must answer is a question people "
     "stop reading. Clear the cell to return to the shipped words."),
    ("sim_text_ready_parked_sms", None,
     "The parking OpenPhone text, rides with the letter. Placeholders: {name} {days} {since} {link}. "
     "Clear the cell to return to the shipped words."),
    ("sim_text_interviewer_days_subject", None,
     "The days-ask to the interviewer (before the candidate's calendar). Placeholders: {name} "
     "{interviewer}. Clear the cell to return to the shipped words."),
    ("sim_text_interviewer_days_body", None,
     "The days-ask letter (e-mail leg). Placeholders: {name} {interviewer} {link}. Clear the cell to "
     "return to the shipped words."),
    ("sim_text_interviewer_days_sms", None,
     "The days-ask OpenPhone text, rides with the letter. Placeholders: {name} {link}. Clear the cell to "
     "return to the shipped words."),
    ("sim_text_interview_done_subject", None,
     "Step 19 subject (the deciders are told the interview HAPPENED). Placeholders: {name} {interviewer}. "
     "Clear the cell to return to the shipped words."),
    ("sim_text_interview_done_body", None,
     "Step 19 body (interviewer, candidate, score, comments — we only inform; somebody decides). "
     "Placeholders: {name} {interviewer} {score} {recommendation} {comments}. Clear the cell to return to "
     "the shipped words."),
    ("sim_text_decision_ask_subject", None,
     "Step 8.7 subject (the release ask). Placeholder: {name}. Clear the cell to return to the shipped "
     "words."),
    ("sim_text_decision_ask_body", None,
     "Step 8.7 INTRO — the score fact, the reading and the ADVANCE/DECLINE instruction always ride along, "
     "because the sweep reads the reply for exactly those words. Placeholder: {name}. Clear the cell to "
     "return to the shipped words."),
    ("sim_text_decision_ask_sms", None,
     "Step 8.7 Quo nudge to the deciders. NO \"ASA Hub:\" prefix — the Quo intro line already says who is "
     "writing (with the prefix it read doubled). Placeholder: {name}. Clear the cell to return to the "
     "shipped words."),
    ("sim_text_discard_subject", None,
     "Step 11 subject. Placeholder: {name}. Clear the cell to return to the shipped words."),
    ("sim_text_discard_body", None,
     "Step 11 INTRO — the fact rows (stage, reason, when, who) always ride along. Placeholder: {name}. "
     "Clear the cell to return to the shipped words."),
    ("sim_text_onboarding_subject", None,
     "Step 15 subject (the new hire's own login letter). Placeholders: {first_name} {name}. Clear the "
     "cell to return to the shipped words."),
    ("sim_text_onboarding_body", None,
     "Step 15 WELCOME — the credentials, the honest password sentence and the first-steps list always "
     "ride along. Placeholders: {first_name} {name}. Clear the cell to return to the shipped words."),
    ("sim_auto_reply", "on",
     "THE ACTORS ANSWER BY THEMSELVES — the mock has to answer automatically. on = each send answers "
     "itself: the deciders' yes and choice (the injector, preset texts), the candidate's YES (a REAL SMS "
     "from the actor line and a REAL e-mail from the actor mailbox when wired, the injector always), the "
     "slot pick (the real public door), the interviewer's YES, and the ADVANCE release. Runs ONLY while "
     "the fence (sim_outbound_guard) is on and only on rehearsal work. off = every reply is a button "
     "press."),
    ("sim_recruiter_name", "",
     "Who the outreach letter says wants to talk (\"X would like to talk with you\"). A name typed here "
     "ALWAYS wins. Blank = whoever made the choice (the decider whose reply picked the candidates), then "
     "the first of the team list."),
    ("sim_outbound_guard", "on",
     "THE FENCE: while on, the hiring lane may write ONLY to the configured cast — the team (Ty, Arthur, "
     "the watcher), the actor mailboxes (asa-hubN@asaop.org) and the listed numbers. A real candidate's "
     "address, any outside e-mail or number, is refused OUT LOUD — even with test mode OFF. Set to off "
     "only when the lane goes production."),
    ("sim_subject_tag", "[TEST] ",
     "Prefixed to every hiring letter's subject while non-blank and the test-mode redirect is OFF (the "
     "redirect stamps its own tag) — so a rehearsal that reaches a REAL mailbox still says what it is — "
     "the test title stays on. CLEAR THIS CELL when the lane goes production."),
    ("sim_pretend_ask_reply", "Yes — we are hiring. Send me the five you would call first.",
     "STEP 0's RETURN BUTTON: the decider's fake reply the composer starts with (a plain yes, we are "
     "hiring). Editable before sending; the machine reads whatever is actually sent."),
    ("sim_pretend_interest_reply", "We like {names} — proceed with all of them.",
     "Step 2's answer — the decider's reply to the shortlist. {names} = every listed winner (so the card "
     "is born with ALL of them), {top} = the first. OK, names, or \"more options\" all read. Editable; the "
     "auto-actor sends it by itself."),
    ("sim_pretend_outreach_reply", "YES — I am interested. When can we talk?",
     "Step 4.5's composer preset — the candidate's reply to the first contact. A yes starts the whole "
     "acceptance flow. Editable before sending."),
    ("sim_pretend_interviewer_reply", "YES",
     "Step 10's composer preset — the interviewer actor's answer. YES books it, NO asks for three times. "
     "Editable before sending."),
)

# the last-resort sample call: the comms window rolls 7 days; the caller's number is masked
SAMPLE_TRANSCRIPT = (
    "[0:00] +13307544040: Hi there. This is Asa Life Care's phone screening assistant. I just need five "
    "minutes to go over your background and qualifications. If everything lines up, we'll schedule an in "
    "person meeting next. Does that sound good?\n"
    "[0:12] +1XXXXXXXXXX: Yes.\n"
    "[0:14] +13307544040: Great. Can you tell me your first and last name, please?\n"
    "[0:17] +1XXXXXXXXXX: Tiana Brooks.\n"
    "[0:20] +13307544040: Thanks, Anna. I'll begin with the phone screening. Have you worked as a DSP "
    "before?\n"
    "[0:25] +1XXXXXXXXXX: No.\n"
    "[0:27] +13307544040: Got it. Many clients need full personal care. Are you comfortable assisting with "
    "toileting and bathing? That's great, Sienna. Are you looking for full time, part time, or occasional "
    "shifts when available?\n"
    "[0:42] +1XXXXXXXXXX: Yes. Part time.\n"
    "[0:45] +13307544040: Which days and times would you be available?\n"
    "[0:50] +1XXXXXXXXXX: Mornings and afternoons.\n"
    "[0:53] +13307544040: We're currently hiring for afternoon shifts from 2PM to 10PM and midnight shifts "
    "from 09:30PM to 8AM. We don't have morning shifts available right now. Would afternoons, midnights, or "
    "both work for you?\n"
    "[1:05] +1XXXXXXXXXX: Afternoons.\n"
    "[1:08] +13307544040: Afternoons work. All staff are required to work every other weekend on twelve hour "
    "shifts from 8AM to 8PM or 8PM to 8AM. Does that work for you?\n"
    "[1:18] +1XXXXXXXXXX: Yes.\n"
    "[1:20] +13307544040: Wonderful. Do you have your eight hour DODD certification?\n"
    "[1:25] +1XXXXXXXXXX: No.\n"
    "[1:26] +13307544040: No problem. We'll send you a link to complete it online. Do you have CPR and first "
    "aid?\n"
    "[1:31] +1XXXXXXXXXX: Yes.\n"
    "[1:34] +13307544040: That's okay. We can help get you certified after the in person interview. Are you "
    "currently med administration certified?\n"
    "[1:40] +1XXXXXXXXXX: No.\n"
    "[1:42] +13307544040: That's fine. We can help you get certified once you start. Afternoon shifts start "
    "at sixteen dollars per hour and midnight shifts at $15 per hour. Meddell adds an extra 50 cents per "
    "hour.\n"
    "[1:52] +1XXXXXXXXXX: Yes.\n"
    "[1:53] +13307544040: Do these rates work for you? Awesome. We have a strict attendance policy. Do you "
    "have a valid driver's license?\n"
    "[2:02] +1XXXXXXXXXX: Yes.\n"
    "[2:04] +13307544040: Awesome. Do you also have a vehicle? And if so, do you have insurance on that "
    "vehicle?\n"
    "[2:10] +1XXXXXXXXXX: I have a vehicle. I don't have insurance.\n"
    "[2:14] +13307544040: That's no problem. We just like to know staff can make it to work on time. Some "
    "clients do have physical behaviors. Have you worked with or are you comfortable working with aggressive "
    "clients?\n"
    "[2:24] +1XXXXXXXXXX: Not comfortable.\n"
    "[2:27] +13307544040: That's okay. We can make a note of that. Are you comfortable working with male and "
    "female clients?\n"
    "[2:32] +1XXXXXXXXXX: Yes.\n"
    "[2:34] +13307544040: We are required to conduct a standard state background check. Is there anything "
    "you'd like to disclose before we proceed?\n"
    "[2:41] +1XXXXXXXXXX: No.\n"
    "[2:42] +13307544040: If we decide to proceed with an in person interview, what day and time works best "
    "to meet one of our house managers?\n"
    "[2:50] +1XXXXXXXXXX: I'm flexible.\n"
    "[2:54] +13307544040: Got it. Since you are flexible, how does this coming Tuesday at two in the "
    "afternoon sound for a meeting at 1305 49th Street Northwest in Canton?\n"
    "[3:04] +1XXXXXXXXXX: What time?\n"
    "[3:07] +13307544040: Two in the afternoon.\n"
    "[3:10] +1XXXXXXXXXX: I'll need a later time.\n"
    "[3:13] +13307544040: How about four in the afternoon on Tuesday?\n"
    "[3:17] +1XXXXXXXXXX: That will work.\n"
    "[3:19] +13307544040: Thanks for speaking with me today, Sayana. I'll share your information with our "
    "hiring team, and we'll follow-up on next steps soon. Have a great rest of your day."
)
