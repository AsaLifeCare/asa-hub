// One row per answered question, typed per shape; `fact` is the join key across forms.

var FORM_ANSWERS_RES = 'formAnswers';

function formAnswerDate_(raw) {
  var s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]((?:20)?\d{2})$/.exec(s);
  if (!m) return '';
  var y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  var mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

// Best effort: an answer that fails to file must never cost the submission.
function formAnswersAppend_(form, submissionId, answers, who) {
  var fields = formFields_(form) || [];
  var slug = str_(form && form.slug);
  var wrote = 0;
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i] || {};
    var kind = String(f.kind || 'text');
    if (kind === 'heading') continue;
    var key = str_(f.key);
    if (!key) continue;
    var raw = answers ? answers[key] : '';
    // File answers (lists of Drive ids) have their own ledger.
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'object') continue;
    var value = String(raw).trim();
    if (!value || value.charAt(0) === '[' || value.charAt(0) === '{') continue;

    var row = {
      form_slug: slug,
      submission_id: str_(submissionId),
      field_key: key,
      field_label: str_(f.label) || key,
      field_kind: kind,
      fact: (typeof digestAnswerFactOf_ === 'function')
        ? digestAnswerFactOf_(key, f.label, f.fact) : str_(f.fact),
      answer_text: '', answer_date: '', answer_choice: '', answer_number: '',
      answered_by: str_(who && who.email) || str_(who && who.name),
      subject_kind: '', subject_key: '', subject_name: '',
      file_id: '', asset_id: '', doc_kind: '',
      found: '', agree: '', note: '', checked_at: '', decoder_v: ''
    };
    var iso = formAnswerDate_(value);
    if (kind === 'date' || (iso && String(row.fact).indexOf('_on') !== -1)) {
      row.answer_date = iso;
      if (!iso) row.answer_text = value.slice(0, 500);
    } else if (kind === 'choice' || kind === 'multi' || kind === 'select') {
      row.answer_choice = value.slice(0, 500);
    } else if (kind === 'number' && String(Number(value)) === value) {
      row.answer_number = value;
    } else {
      row.answer_text = value.slice(0, 2000);
      if (iso) row.answer_date = iso;
    }
    try {
      var got = createRow_(FORM_ANSWERS_RES, row);
      if (!(got && got.error)) wrote++;
      else {
        hubSysLog_('asa-hub:forms', 'form_answer_row_failed',
          slug + ':' + key + ' — ' +
          String((got.error && got.error.message) || got.error).slice(0, 140),
          { status: 500 });
      }
    } catch (e) {
      try {
        hubSysLog_('asa-hub:forms', 'form_answer_row_failed',
          slug + ':' + key + ' — ' + String(e && e.message || e).slice(0, 140),
          { status: 500 });
      } catch (eL) {}
    }
  }
  return wrote;
}

function formAnswersCheck_(submissionId, items, ctx) {
  var sub = str_(submissionId);
  if (!sub || !items || !items.length) return 0;
  var rows = [];
  try { rows = listRows_(FORM_ANSWERS_RES, {}) || []; } catch (e) { return 0; }
  var byKey = {};
  for (var r = 0; r < rows.length; r++) {
    if (str_(rows[r].submission_id) !== sub) continue;
    byKey[str_(rows[r].field_key)] = rows[r];
  }
  var touched = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var row = byKey[str_(it.key)];
    if (!row) continue;
    var patch = {
      id: str_(row.id),
      found: str_(it.found),
      agree: str_(it.agree),
      note: str_(it.note),
      doc_kind: str_(ctx && ctx.doc_kind),
      file_id: str_(ctx && ctx.file_id),
      asset_id: str_(ctx && ctx.asset_id),
      subject_kind: str_(ctx && ctx.subject_kind),
      subject_key: str_(ctx && ctx.subject_key),
      subject_name: str_(ctx && ctx.subject_name),
      checked_at: new Date().toISOString(),
      decoder_v: str_(ctx && ctx.decoder_v)
    };
    try {
      var got = updateRowById_(FORM_ANSWERS_RES, patch);
      if (!(got && got.error)) touched++;
    } catch (eU) { /* the next decode of this file writes it again */ }
  }
  return touched;
}
