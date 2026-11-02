"""THE DECODER'S PAPER READING, IN PYTHON — apps-script/Digest.gs digestPaperFromText_ and everything it calls, with
ComplianceDocs.gs certReadVocab_, translated function by function so the same words give the same reading.

Strings inside the engine are held the way JavaScript holds them, one item per UTF-16 code unit (a character outside
the Basic Multilingual Plane is its surrogate pair), so every length, slice and regular expression counts as the
JavaScript does; what the public functions return is plain text again. Regular expressions are written in the
JavaScript source's own syntax and translated once (`_rx`): \\s is the JavaScript whitespace set, \\d \\w \\b are
ASCII, `.` stops at every line terminator, `$` is the end of the input, and a case-insensitive match folds as
JavaScript's non-unicode Canonicalize does. Stdlib only; nothing here runs JavaScript."""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

VERSION = '2026-09-14.2'
SCAN_CAP = 120000

# ── the JavaScript string layer ───────────────────────────────────────────────────────────────────────────────────

_WS = ''.join(chr(cp) for cp in [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, *range(0x2000, 0x200b),
                                  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff])
_ASTRAL = re.compile('[\U00010000-\U0010ffff]')
_SURROGATE = re.compile('[\ud800-\udfff]')
_PROTO = frozenset(['constructor', '__proto__', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
                    'toString', 'valueOf', 'toLocaleString', '__defineGetter__', '__defineSetter__',
                    '__lookupGetter__', '__lookupSetter__'])
_DASHES = {cp: '-' for cp in list(range(0x2010, 0x2016)) + [0x2212, 0x00ad]}


def _pair(m: re.Match) -> str:
    cp = ord(m.group(0)) - 0x10000
    return chr(0xD800 + (cp >> 10)) + chr(0xDC00 + (cp & 0x3FF))


def to_u16(s: str) -> str:
    """A string as JavaScript holds it: one item per UTF-16 code unit."""
    return s if _ASTRAL.search(s) is None else _ASTRAL.sub(_pair, s)


def from_u16(s: str) -> str:
    """Plain text again: each surrogate pair one character, a lone surrogate kept as it is."""
    if _SURROGATE.search(s) is None:
        return s
    return s.encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'surrogatepass')


def _out(v: Any) -> Any:
    """What JSON.stringify would carry: plain text, and a whole number as an integer."""
    if isinstance(v, str):
        return from_u16(v)
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, float):
        if v != v or v in (math.inf, -math.inf):
            return None
        if v.is_integer() and abs(v) < 2 ** 53:
            return int(v)
        return v
    if isinstance(v, dict):
        return {(from_u16(k) if isinstance(k, str) else k): _out(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_out(x) for x in v]
    return v


def js_trim(s: str) -> str:
    """String.prototype.trim."""
    return s.strip(_WS)


def js_lower(s: str) -> str:
    """String.prototype.toLowerCase."""
    if _SURROGATE.search(s) is None:
        return s.lower()
    return to_u16(from_u16(s).lower())


def js_upper(s: str) -> str:
    """String.prototype.toUpperCase."""
    if _SURROGATE.search(s) is None:
        return s.upper()
    return to_u16(from_u16(s).upper())


def _truthy(v: Any) -> bool:
    if v is None or v is False:
        return False
    if isinstance(v, str):
        return v != ''
    if isinstance(v, (int, float)):
        return v == v and v != 0
    return True


def _or(a: Any, b: Any) -> Any:
    return a if _truthy(a) else b


def _has(obj: dict, key: str) -> bool:
    """obj[key] read as JavaScript reads a plain object: Object.prototype's own names answer too."""
    return _truthy(obj.get(key)) or key in _PROTO


def js_num_str(x: Any) -> str:
    """Number.prototype.toString."""
    if isinstance(x, bool):
        return 'true' if x else 'false'
    if isinstance(x, int) and abs(x) < 10 ** 21:
        return str(x)
    x = float(x)
    if x != x:
        return 'NaN'
    if x == math.inf:
        return 'Infinity'
    if x == -math.inf:
        return '-Infinity'
    if x == 0:
        return '0'
    sign = '-' if x < 0 else ''
    t = Decimal(repr(abs(x))).as_tuple()
    digits = ''.join(str(d) for d in t.digits)
    exp = t.exponent
    stripped = digits.rstrip('0')
    exp += len(digits) - len(stripped)
    digits = stripped.lstrip('0') or '0'
    k = len(digits)
    n = exp + k
    if k <= n <= 21:
        return sign + digits + '0' * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + '.' + digits[n:]
    if -6 < n <= 0:
        return sign + '0.' + '0' * (-n) + digits
    e = n - 1
    es = ('+' if e >= 0 else '-') + str(abs(e))
    return sign + (digits + 'e' + es if k == 1 else digits[0] + '.' + digits[1:] + 'e' + es)


def js_string(v: Any) -> str:
    """String(v)."""
    if isinstance(v, str):
        return v
    if v is None:
        return 'undefined'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return js_num_str(v)
    if isinstance(v, (list, tuple)):
        return ','.join('' if x is None else js_string(x) for x in v)
    return '[object Object]'


def _str_(v: Any) -> str:
    """str_: '' for null and undefined, else the trimmed text."""
    return '' if v is None else js_trim(js_string(v))


_NUM_DEC = re.compile(r'[+-]?(?:Infinity|[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)\Z')
_NUM_RADIX = re.compile(r'0([xXoObB])([0-9A-Za-z]+)\Z')


def js_number(v: Any) -> float:
    """Number(v)."""
    if v is None:
        return math.nan
    if v is True:
        return 1.0
    if v is False:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, (list, tuple)):
        return js_number(js_string(v))
    if not isinstance(v, str):
        return math.nan
    t = js_trim(v)
    if t == '':
        return 0.0
    m = _NUM_RADIX.match(t)
    if m:
        try:
            return float(int(m.group(2), {'x': 16, 'o': 8, 'b': 2}[m.group(1).lower()]))
        except ValueError:
            return math.nan
    if _NUM_DEC.match(t):
        return float(t)
    return math.nan


def _jsnum(x: float) -> Any:
    return int(x) if x == x and x not in (math.inf, -math.inf) and x == int(x) and abs(x) < 2 ** 53 else x


def _last_day(y: int, mo: int) -> int:
    """new Date(Date.UTC(y, mo, 0)).getUTCDate() for a month 1-12."""
    if 0 <= y <= 99:
        y += 1900
    if mo == 2:
        return 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28
    return 30 if mo in (4, 6, 9, 11) else 31


# ── the JavaScript regular expression, translated ─────────────────────────────────────────────────────────────────

def _esc(cp: int) -> str:
    return '\\u%04x' % cp if cp < 0x10000 else '\\U%08x' % cp


_WS_POINTS = sorted(ord(c) for c in _WS)
_WS_CLASS = ''.join(_esc(cp) for cp in _WS_POINTS)


def _complement(points: list[int]) -> str:
    out, lo = [], 0
    for cp in points:
        if cp > lo:
            out.append(_esc(lo) + ('-' + _esc(cp - 1) if cp - 1 > lo else ''))
        lo = cp + 1
    out.append(_esc(lo) + '-' + _esc(0x10FFFF))
    return ''.join(out)


_NOT_WS_CLASS = _complement(_WS_POINTS)
_LINE_END = '\\n\\r\\u2028\\u2029'
_QUANT = re.compile(r'\{[0-9]+(?:,[0-9]*)?\}')
_HEX2 = re.compile(r'[0-9A-Fa-f]{2}')
_HEX4 = re.compile(r'[0-9A-Fa-f]{4}')
_CANON: dict[str, list[str]] | None = None


def _canon(ch: str) -> str:
    u = ch.upper()
    if len(u) != 1:
        return ch
    if ord(ch) >= 128 and ord(u) < 128:
        return ch
    return u


def _case_set(ch: str) -> list[str]:
    """The characters a case-insensitive JavaScript pattern character matches (Canonicalize, no u flag)."""
    global _CANON
    if ch.lower() == ch and ch.upper() == ch:
        return [ch]
    if _CANON is None:
        table: dict[str, list[str]] = {}
        for cp in range(0x10000):
            if 0xD800 <= cp <= 0xDFFF:
                continue
            c = chr(cp)
            table.setdefault(_canon(c), []).append(c)
        _CANON = table
    return _CANON.get(_canon(ch), [ch])


def _lit(ch: str, icase: bool) -> str:
    if icase and ord(ch) > 127:
        same = _case_set(ch)
        if len(same) > 1:
            return '[' + ''.join(_esc(ord(c)) for c in same) + ']'
    if ch in '.^$*+?{}[]\\|()':
        return '\\' + ch
    if ord(ch) < 32 or ord(ch) > 126:
        return _esc(ord(ch))
    return ch


def _cls_lit(ch: str, icase: bool, alone: bool) -> str:
    if icase and alone and ord(ch) > 127:
        same = _case_set(ch)
        if len(same) > 1:
            return ''.join(_esc(ord(c)) for c in same)
    return ch if ch.isascii() and ch.isalnum() else _esc(ord(ch))


def _escape(src: str, i: int, in_class: bool) -> tuple[str, Any]:
    """One escape at src[i] ('\\'): ('raw', text) for a class or set, or ('char', ch) for one character."""
    n = len(src)
    if i + 1 >= n:
        return 'char', '\\'
    d = src[i + 1]
    if d == 's':
        return 'raw', (_WS_CLASS if in_class else '[' + _WS_CLASS + ']')
    if d == 'S':
        return 'raw', (_NOT_WS_CLASS if in_class else '[^' + _WS_CLASS + ']')
    if d in 'dDwW':
        return 'raw', '\\' + d
    if d == 'b':
        return ('char', '\x08') if in_class else ('raw', '\\b')
    if d == 'B':
        return ('char', 'B') if in_class else ('raw', '\\B')
    if d in 'nrtfv':
        return 'char', {'n': '\n', 'r': '\r', 't': '\t', 'f': '\x0c', 'v': '\x0b'}[d]
    if d == '0' and not (i + 2 < n and src[i + 2].isdigit()):
        return 'char', '\x00'
    if d.isdigit() and not in_class:
        return 'raw', '\\' + d
    if d == 'x' and _HEX2.fullmatch(src, i + 2, i + 4):
        return 'char4', chr(int(src[i + 2:i + 4], 16))
    if d == 'u' and _HEX4.fullmatch(src, i + 2, i + 6):
        return 'char6', chr(int(src[i + 2:i + 6], 16))
    if d == 'c' and i + 2 < n and src[i + 2].isascii() and src[i + 2].isalpha():
        return 'char3', chr(ord(src[i + 2]) % 32)
    return 'char', d


_STEP = {'char': 2, 'raw': 2, 'char3': 3, 'char4': 4, 'char6': 6}


def _klass(src: str, i: int, icase: bool) -> tuple[str, int]:
    n = len(src)
    j = i + 1
    neg = j < n and src[j] == '^'
    if neg:
        j += 1
    items: list[tuple[str, str]] = []          # ('raw' | 'char' | 'dash', text)
    while j < n and src[j] != ']':
        c = src[j]
        if c == '\\':
            kind, got = _escape(src, j, True)
            j += _STEP[kind]
            items.append(('raw', got) if kind == 'raw' else ('char', got))
        elif c == '-':
            items.append(('dash', '-'))
            j += 1
        else:
            items.append(('char', c))
            j += 1
    j += 1
    if not items:
        return ('[\\x00-\\U0010ffff]' if neg else '(?!)'), j
    # a dash between two single characters is a range; anywhere else it is itself
    ranged = [False] * len(items)
    k = 1
    while k < len(items) - 1:
        if (items[k][0] == 'dash' and items[k - 1][0] == 'char' and items[k + 1][0] == 'char' and
                not ranged[k - 1]):
            ranged[k - 1] = ranged[k] = ranged[k + 1] = True
            k += 2
        else:
            k += 1
    body = []
    for k, (kind, got) in enumerate(items):
        if kind == 'char':
            body.append(_cls_lit(got, icase, not ranged[k]))
        elif kind == 'dash':
            body.append('-' if ranged[k] else '\\-')
        else:
            body.append(got)
    return '[' + ('^' if neg else '') + ''.join(body) + ']', j


def _translate(src: str, icase: bool, multi: bool) -> str:
    out: list[str] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '\\':
            kind, got = _escape(src, i, False)
            i += _STEP[kind]
            out.append(got if kind == 'raw' else _lit(got, icase))
        elif c == '[':
            got, i = _klass(src, i, icase)
            out.append(got)
        elif c == '.':
            out.append('[^' + _LINE_END + ']')
            i += 1
        elif c == '$':
            out.append('(?![^' + _LINE_END + '])' if multi else '\\Z')
            i += 1
        elif c == '^':
            out.append('(?<![^' + _LINE_END + '])' if multi else '^')
            i += 1
        elif c == '(':
            if src.startswith('(?<', i) and not src.startswith('(?<=', i) and not src.startswith('(?<!', i):
                out.append('(?P<')
                i += 3
            else:
                out.append('(')
                i += 1
        elif c == '{':
            m = _QUANT.match(src, i)
            if m:
                out.append(m.group(0))
                i = m.end()
            else:
                out.append('\\{')
                i += 1
        elif c == '}':
            out.append('\\}')
            i += 1
        elif c in '*+?|)':
            out.append(c)
            i += 1
        else:
            out.append(_lit(c, icase))
            i += 1
    return ''.join(out)


_RX: dict[tuple[str, bool, bool], re.Pattern] = {}


def _rx(src: str, flags: str = '') -> re.Pattern:
    """new RegExp(src, flags), compiled once."""
    key = (src, 'i' in flags, 'm' in flags)
    got = _RX.get(key)
    if got is None:
        if len(_RX) > 20000:
            _RX.clear()
        got = re.compile(_translate(src, key[1], key[2]), re.ASCII | (re.IGNORECASE if key[1] else 0))
        _RX[key] = got
    return got


# ── the seed tables (Digest.gs) ───────────────────────────────────────────────────────────────────────────────────

DIGEST_CATEGORIES = [
    ['medical',
     ['mars', 'medication', 'med document', 'prescription', 'pharmacy', 'controlled drug', 'physician', 'diagnosis',
      'immunization', 'tuberculin', 'ppd test', 'tb test', 'mantoux']],
    ['receipt_invoice',
     ['receipt', 'invoice', 'purchase', 'order total', 'subtotal', 'amount due', 'payment', 'billed']],
    ['identity',
     ['social security', 'ssn', 'passport', "driver's license", 'drivers license', "driver's licence",
      'driver license', 'operator license', 'state id', 'state identification', 'birth certificate', 'medicaid']],
    ['certification_training',
     ['certificate', 'certification', 'training', 'cpr', 'first aid', 'bls', 'aed', 'recertification', 'completion',
      'course']],
    ['insurance',
     ['insurance card', 'auto insurance', 'policy number', 'coverage period', 'insured', 'liability limits']],
    ['care_plan', ['individual service plan', 'isp ', 'amfm', 'care plan', 'behavior support', 'person-centered']],
    ['incident', ['incident', 'mui', 'unusual incident', 'injury report']],
    ['legal',
     ['agreement', 'contract', 'consent', 'authorization', 'waiver', 'policy', 'court', 'background check',
      'criminal records check', 'bci&i', 'fingerprint']],
    ['timesheet', ['timesheet', 'time sheet', 'clock in', 'hours worked', 'pay period']],
]

DIGEST_VOCAB_TABS = {'kinds': 'Digest Kinds', 'categories': 'Digest Categories', 'expects': 'Digest Expects',
                     'labels': 'Digest Labels', 'issuers': 'Digest Issuers', 'drawers': 'Digest Drawers',
                     'zip': 'Digest Zip', 'settings': 'Digest Settings', 'types': 'Form File Types',
                     'answers': 'Digest Answer Facts', 'credentials': 'Digest Credentials'}

DIGEST_TYPE_NEVER = {'exe': 1, 'msi': 1, 'bat': 1, 'cmd': 1, 'com': 1, 'scr': 1, 'sh': 1, 'bash': 1, 'zsh': 1,
                     'ps1': 1, 'psm1': 1, 'vbs': 1, 'jar': 1, 'apk': 1, 'app': 1, 'dll': 1, 'so': 1, 'dylib': 1,
                     'deb': 1, 'rpm': 1, 'pkg': 1, 'dmg': 1}

DIGEST_CREDENTIALS = [
    ['dodd_certification', 'dodd_8hr', 'dodd', 'dodd_8hr', 'yes'],
    ['cpr_first_aid', 'cpr_first_aid', 'cpr', 'cpr', 'yes'],
    ['med_admin_cert', 'med_del', '', 'med_del', 'yes'],
    ['drivers_licence', 'drivers_id', '', 'drivers_license', 'yes'],
    ['state_id', 'drivers_id', '', 'drivers_license', 'yes'],
    ['ssn_card', 'ss_birth', '', 'ss_birth', 'no'],
    ['birth_certificate', 'ss_birth', '', 'ss_birth', 'no'],
    ['diploma', 'hs_diploma', '', 'hs_diploma', 'no'],
    ['background_check', 'background_check', '', 'background_check', 'no'],
    ['auto_insurance', 'car_insurance', '', 'car_insurance', 'yes'],
]

DIGEST_DOC_KINDS = [
    ['dnr',
     'medical',
     ['do not resuscitate', 'dnr comfort care', 'dnrcc', 'dnr order', 'do-not-resuscitate'],
     {'file': ['dnr']}],
    ['cpr_first_aid',
     'certification_training',
     ['cpr', 'first aid', 'bls', 'basic life support', 'aed certification', 'heartsaver', 'cpr aed',
      'adult first aid'],
     {'file': ['cpr', 'firstaid', 'bls', 'aed', 'heartsaver']}],
    ['crisis_prevention',
     'certification_training',
     ['cpi', 'crisis prevention', 'mandt', 'handle with care', 'de-escalation', 'the mandt system']],
    ['med_admin_cert',
     'certification_training',
     ['medication administration certification', 'category 1 medication', 'delegated nursing', 'med cert']],
    ['dodd_certification',
     'certification_training',
     ['dodd certification', 'provider certification', 'certification number ci', 'direct support professional', 'dsp',
      'oac 5123', 'orc 5123', 'initial certification', 'nadsp'],
     {'file': ['dodd', 'dsp']}],
    ['training_transcript',
     'certification_training',
     ['training record', 'course completion', 'continuing education', 'ceu', 'in-service',
      'this certificate is proudly presented to', 'for completing', 'the following topics are covered in this module',
      'total seat time', 'annual training', 'additional annual training', 'skills development']],
    ['diploma',
     'certification_training',
     ['diploma', 'ged certificate', 'associate of', 'bachelor of', 'transcript',
      'has completed the prescribed requirements for graduation',
      'satisfactorily completed all requirements for graduation', 'board of education',
      'west african examinations council', 'waecdirect', 'wassce', 'waec', 'senior high school',
      'course of study recommended by the state'],
     {'file': ['diploma', 'hsdiploma', 'ged', 'highschool', 'wassce', 'waec']}],
    ['mar', 'medical', ['medication administration record', 'mar sheet', 'mars'], {'file': ['mar', 'mars']}],
    ['prescription',
     'medical',
     ['prescription', 'refills', 'dispense as written', 'sig:', 'rx #'],
     {'file': ['prescription', 'rx']}],
    ['physician_order',
     'medical',
     ["physician's order", 'physician order', 'provider order', 'signed order', 'plan of care order'],
     {'file': ['physician orders', 'physican orders', 'orders']}],
    ['lab_result',
     'medical',
     ['laboratory report', 'lab result', 'reference range', 'specimen', 'hemoglobin', 'a1c']],
    ['tb_test',
     'medical',
     ['tuberculin', 'ppd', 'mantoux', 'tb test', 'tb skin test', 'quantiferon'],
     {'file': ['tb', 'ppd', 'mantoux']}],
    ['immunization',
     'medical',
     ['immunization', 'vaccination record', 'vaccine', 'influenza', 'covid-19 vaccin'],
     {'file': ['vax', 'vaccine', 'covid', 'flu', 'immunization']}],
    ['physical_exam',
     'medical',
     ['physical examination', 'history and physical', 'annual physical', 'fit for duty'],
     {'file': ['physical']}],
    ['drug_screen', 'medical', ['drug screen', 'urinalysis', 'panel drug test', 'negative dilute']],
    ['therapy_eval',
     'medical',
     ['physical therapy', 'occupational therapy', 'speech therapy', 'pt evaluation', 'ot evaluation', 'slp']],
    ['nursing_assessment',
     'medical',
     ['nursing assessment', 'rn assessment', 'skilled nursing', 'nursing delegation']],
    ['seizure_protocol', 'medical', ['seizure protocol', 'seizure action plan', 'rescue medication']],
    ['dietary_plan',
     'medical',
     ['dietary order', 'nutrition plan', 'texture modified', 'thickened liquid', 'dysphagia']],
    ['discharge_summary', 'medical', ['discharge summary', 'hospital discharge', 'after visit summary']],
    ['appointment_summary',
     'medical',
     ['visit summary', 'appointment summary', 'follow-up appointment', 'office visit note', 'office note',
      'progress note', 'clinical note', 'result type:', 'after visit summary', 'visit note'],
     {'file': ['visitsummary', 'officenote', 'visitnote']}],
    ['dental_vision', 'medical', ['dental exam', 'dentist', 'optometry', 'vision exam', 'audiology']],
    ['isp',
     'care_plan',
     ['individual service plan', 'person-centered plan', 'isp effective', 'outcomes and supports',
      'service and support administrator', 'oisp', 'service plan', 'ohio individual service plan',
      'outcome and support', 'ssa signature'],
     {'file': ['isp', 'oisp', 'serviceplan']}],
    ['behavior_plan',
     'care_plan',
     ['behavior support plan', 'behavior plan', 'functional behavior', 'bsp'],
     {'file': ['bsp', 'behavior', 'behavior assessment', 'behavior support']}],
    ['amfm', 'care_plan', ['amfm', 'acuity assessment', 'assessment matrix'], {'file': ['amfm']}],
    ['iep', 'care_plan', ['individualized education', 'iep team']],
    ['mui', 'incident', ['major unusual incident', 'mui report', 'mui number'], {'file': ['mui']}],
    ['unusual_incident',
     'incident',
     ['unusual incident', 'ui report', 'mui reporting form'],
     {'file': ['ui', 'mui reporting', 'reporting form']}],
    ['restraint_report', 'incident', ['restraint', 'seclusion', 'physical intervention']],
    ['incident_followup', 'incident', ['root cause', 'corrective action', 'incident follow-up']],
    ['drivers_licence',
     'identity',
     ['driver license', "driver's license", 'driver licence', 'operator license', 'dl no', 'class d']],
    ['state_id', 'identity', ['state identification', 'identification card']],
    ['driver_abstract',
     'legal',
     ['driving record', 'driver abstract', "driver's abstract", 'driver record', 'unofficial 2-year driving record',
      'license status as of', 'mvr report', 'abstract of driving record'],
     {'file': ['abstract', 'mvr', 'drivingrecord']}],
    ['ssn_card', 'identity', ['social security card', 'social security number'], {'file': ['ssn', 'socialsecurity']}],
    ['birth_certificate',
     'identity',
     ['certificate of live birth', 'birth certificate', 'certificate of birth', 'state file number',
      'registrar of vital statistics', 'place of birth'],
     {'file': ['birthcertificate', 'birthcert']}],
    ['passport', 'identity', ['passport no', 'united states of america passport']],
    ['work_authorization',
     'identity',
     ['employment eligibility verification', 'i-9', 'permanent resident', 'work authorization'],
     {'file': ['i9', 'i-9']}],
    ['medicaid_card', 'identity', ['medicaid', 'managed care plan', 'medical card'], {'file': ['medicaid']}],
    ['medicare_card', 'identity', ['medicare'], {'file': ['medicare']}],
    ['auto_insurance',
     'insurance',
     ['auto insurance', 'insurance identification card', 'policy number', 'coverage period', 'liability limits']],
    ['liability_insurance', 'insurance', ['general liability', 'certificate of insurance', 'acord']],
    ['health_insurance', 'insurance', ['subscriber id', 'group number', 'health plan member']],
    ['background_check',
     'legal',
     ['cjis', 'bci', 'fbi', 'background check', 'criminal records check', 'bureau of criminal', 'records check',
      'fingerprint', 'webcheck', 'rap back', 'court record'],
     {'file': ['cjis', 'bci', 'fbi', 'bg', 'background']}],
    ['guardianship',
     'legal',
     ['guardianship', 'guardian of the person', 'probate court'],
     {'file': ['guardianship', 'probate']}],
    ['court_order', 'legal', ['court order', 'judgment entry', 'case no']],
    ['consent_release',
     'legal',
     ['authorization to release', 'release of information', 'hipaa', 'photo release', 'consent form'],
     {'file': ['consent', 'consent form', 'release form']}],
    ['lease',
     'legal',
     ['lease agreement', 'landlord', 'rent due', 'tenancy', 'security deposit', 'monthly rent'],
     {'file': ['lease', 'apartment lease']}],
    ['timesheet',
     'timesheet',
     ['timesheet', 'time sheet', 'hours worked', 'pay period', 'clock in'],
     {'file': ['timesheet', 'hours']}],
    ['paystub',
     'timesheet',
     ['pay stub', 'earnings statement', 'gross pay', 'net pay', 'ytd'],
     {'file': ['paystub', 'pay stub']}],
    ['tax_form',
     'timesheet',
     ['w-2', 'wage and tax statement', '1099', 'w-4', 'withholding certificate', 'it-4'],
     {'file': ['w2', 'w4', 'w-2', 'w-4', '1099', 'it4']}],
    ['bank_statement',
     'receipt_invoice',
     ['bank statement', 'beginning balance', 'ending balance', 'statement of account'],
     {'file': ['true link', 'link statement', 'statement', 'activity']}],
    ['benefit_letter',
     'receipt_invoice',
     ['social security administration', 'benefit verification', 'award letter', 'supplemental nutrition assistance',
      'snap benefits', 'job and family services', 'food assistance', 'notice of approval', 'benefits notice',
      'ssi payment', 'ssdi', 'food bank', 'commodity supplemental food program', 'csfp'],
     {'file': ['snap', 'jfs', 'foodbank']}],
    ['utility_bill',
     'receipt_invoice',
     ['service address', 'electric bill', 'water bill', 'gas bill', 'amount of your bill']],
    ['fire_drill', 'other', ['fire drill', 'evacuation drill', 'drill log']],
    ['inspection', 'other', ['inspection report', 'fire marshal', 'health department', 'safety inspection']],
    ['vehicle',
     'other',
     ['vehicle registration', 'odometer reading', 'certificate of title', 'vehicle identification number',
      'license plate'],
     {'file': ['vehicle', 'title', 'registration']}],
    ['application_resume',
     'other',
     ['employment application', 'work history', 'curriculum vitae', 'resume', 'professional summary',
      'work experience', 'employment history', 'skills', 'references available', 'career objective', 'education'],
     {'file': ['resume', 'cv', 'application']}],
    ['reference_check', 'other', ['reference check', 'professional reference', 'employment verification']],
    ['offer_letter', 'other', ['offer of employment', 'offer letter', 'rate of pay', 'start date of']],
    ['appointment_form',
     'medical',
     ['medical appointment form', 'have the provider fill out', 'appointment form', 'bring this form',
      'orders if applicable'],
     {'file': ['appointmentform', 'appointment']}],
    ['tracking_sheet',
     'medical',
     ['tracking sheet', 'weight tracker', 'blood sugar log', 'bathroom tracker', 'daily weight', 'blood sugar',
      'bowel movement', 'sleep log', 'seizure log', 'vitals log', 'intake and output', 'u/bm'],
     {'file': ['trackingsheet', 'trackingsheets', 'tracker', 'bloodsugar']}],
    ['packing_slip',
     'medical',
     ['packing slip', 'delivery route', 'nursing station', 'medication label', 'shipping tote', 'deliver to'],
     {'file': ['packingslip', 'packing']}],
    ['self_admin_assessment',
     'medical',
     ['self administration assessment', 'self-administration assessment', 'self administration of medication',
      'self-administer', 'self admin assessment'],
     {'file': ['selfadmin', 'selfadministration']}],
    ['missing_medication',
     'medical',
     ['missing medication notification', 'missing medication', 'pink slip', 'the following medications are not',
      'not included in this delivery', 'medications are not included'],
     {'file': ['pinkslip', 'missingmedication', 'missingmed']}],
    ['insurance_eob',
     'insurance',
     ['explanation of benefits', 'this is not a bill', 'dual complete', 'unitedhealthcare', 'hmo-pos',
      'summary of benefits', 'claims paid'],
     {'file': ['unitedhealthcare', 'eob', 'uhc']}],
    ['summary_of_services',
     'care_plan',
     ['summary of services and updates', 'summary of services & updates'],
     {'file': ['summaryofservices']}],
    ['prior_authorization',
     'care_plan',
     ['your request for prior authorization', 'request for prior authorization', 'prior authorization has been',
      'prior authorization request form'],
     {'file': ['priorauthor', 'priorauth']}],
    ['privacy_notice',
     'legal',
     ['notice of privacy practices', 'how medical information about you', 'may be used and disclosed', 'hipaa'],
     {'file': ['privacypractices', 'privacynotice']}],
    ['daily_checklist',
     'other',
     ['daily checklist', 'shift checklist', 'house checklist', 'chore list'],
     {'file': ['dailychecklist', 'checklist']}],
    ['hospice_note',
     'medical',
     ['hospice nurse notes', 'hospice notes', 'hospice visit note', 'crossroads hospice', 'hospice aide visit',
      'hospice fax'],
     {'file': ['hospicenotes', 'hospicenurse', 'hospicenote']}],
    ['daily_report',
     'other',
     ['daily report', 'shift report', 'shift notes', 'daily notes', 'end of shift'],
     {'file': ['dailyreport', 'daily-report', 'shiftreport']}],
    ['funds_ledger',
     'receipt_invoice',
     ['date of transaction', 'transaction type', 'transaction category', 'amount of transaction',
      'description of transaction', 'funds ledger', 'personal funds', 'individual funds record', 'individual funds',
      'waiver recipient'],
     {'file': ['transactions', 'fundsledger', 'spending']}],
    ['medication_list',
     'medical',
     ['medication list', 'current medications', 'active medications', 'medication reconciliation',
      'list of medications'],
     {'file': ['medicationlist', 'medlist']}],
    ['receipt',
     'receipt_invoice',
     ['receipt', 'amount due', 'subtotal', 'total paid', 'change due'],
     {'w': 0.5, 'file': ['receipt', 'amazon']}],
    ['invoice', 'receipt_invoice', ['invoice', 'bill to', 'remit to'], {'w': 0.5}],
    ['certificate',
     'certification_training',
     ['certificate of completion', 'certificate', 'certification'],
     {'w': 0.4}],
    ['agreement', 'legal', ['agreement', 'contract', 'waiver', 'acknowledgment'], {'w': 0.3}],
]

DIGEST_MONTH_WORDS = {'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3, 'apr': 4, 'april': 4,
                      'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'sept': 9,
                      'september': 9, 'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12}

DIGEST_DATE_ROLE_WORDS = {
    'born': [r'date\s+of\s+birth', r'birth\s*date', r'd\.?o\.?b\.?', r'born(?:\s+on)?'],
    'expires': [r'expires?(?:\s+on)?', r'expiration(?:\s+date)?', r'expiry(?:\s+date)?',
                r'exp\b', r'valid\s+(?:through|thru|until|to)', r'good\s+(?:through|thru|until)',
                r'renew(?:al)?\s+(?:by|date|on)', r'recertification\s+due',
                r'coverage\s+ends(?:\s+on)?', r'period\s+ends(?:\s+on)?', r'ends\s+on'],
    'issued': [r'issued?(?:\s+on)?', r'issue\s+date', r'date\s+of\s+issue', r'(?:4a\s*)?iss\b',
               r'class\s+completion\s+date', r'completion\s+date', r'date\s+completed',
               r'completed(?:\s+on)?', r'bci\s+completion\s+date', r'date\s+processed',
               r'date\s+of\s+search', r'search\s+date', r'valid\s+from',
               r'licen[sc]e\s+status\s+as\s+of', r'status\s+as\s+of', r'as\s+of',
               r'date\s+printed', r'report\s+date',
               r'effective(?:\s+date)?(?:\s+from)?', r'coverage\s+begins(?:\s+on)?',
               r'date\s+signed', r'date\s+(?:record\s+)?filed(?:\s+by\s+registrar)?',
               r'course\s+date', r'date\s+of\s+(?:course|class)'],
}

DIGEST_DATE_TOKEN = (r'(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:19|20)?\d{2}(?![0-9])'
                     r'|(?:19|20)\d{2}-\d{2}-\d{2}'
                     r'|\d{1,2}[\/\-.](?:19|20)\d{2}(?![0-9\/\-.])'
                     r'|[A-Za-z]{3,9}\.?,?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}'
                     r'|[A-Za-z]{3,9}\.?,?\s+(?:19|20)\d{2}'
                     r'|\d{1,2}(?:st|nd|rd|th)?\s+day\s+of\s+[A-Za-z]{3,9},?\s+(?:19|20)\d{2})')

DIGEST_RENEWAL_FLOOR = {'dodd_8hr': 12, 'cpr_first_aid': 24, 'med_del': 12, 'car_insurance': 12}

DIGEST_SINGLE_DATE_KINDS = {'dodd_certification': 1, 'diploma': 1, 'cpr_first_aid': 1, 'med_admin_cert': 1,
                            'crisis_prevention': 1, 'training_transcript': 1, 'ssn_card': 1, 'background_check': 1,
                            'packing_slip': 1, 'missing_medication': 1, 'tracking_sheet': 1, 'appointment_form': 1,
                            'self_admin_assessment': 1, 'benefit_letter': 1, 'insurance_eob': 1, 'daily_checklist': 1,
                            'daily_report': 1}

DIGEST_NAME_STOPWORDS = {'isp': 1, 'mar': 1, 'mars': 1, 'cpr': 1, 'cjis': 1, 'bci': 1, 'fbi': 1, 'tb': 1, 'id': 1,
                         'copy': 1, 'scan': 1, 'final': 1, 'signed': 1, 'form': 1, 'doc': 1, 'document': 1,
                         'report': 1, 'plan': 1, 'card': 1, 'cert': 1, 'certificate': 1, 'licence': 1, 'license': 1,
                         'insurance': 1, 'receipt': 1, 'invoice': 1, 'new': 1, 'updated': 1, 'asa': 1, 'lifecare': 1,
                         'dawn': 1, 'brighter': 1, 'pdf': 1, 'jpg': 1, 'png': 1, 'docx': 1, 'test': 1, 'tests': 1,
                         'result': 1, 'results': 1, 'screen': 1, 'screening': 1, 'wassce': 1, 'waec': 1,
                         'abstract': 1, 'mvr': 1, 'bmv': 1, 'dodd': 1, 'meddel': 1, 'check': 1, 'checks': 1,
                         'record': 1, 'records': 1, 'front': 1, 'back': 1, 'side': 1, 'dl': 1, 'ss': 1, 'ssn': 1,
                         'w2': 1, 'w4': 1, 'i9': 1, 'ppd': 1, 'mui': 1, 'ui': 1, 'ohio': 1, 'state': 1, 'county': 1,
                         'current': 1, 'expired': 1, 'renewal': 1, 'upload': 1, 'file': 1, 'files': 1, 'photo': 1,
                         'image': 1, 'img': 1, 'scanned': 1, 'video': 1, 'clip': 1, 'recording': 1, 'tracking': 1,
                         'time': 1, 'psi': 1, 'database': 1, 'roster': 1, 'master': 1, 'list': 1, 'export': 1,
                         'backup': 1, 'reports': 1, 'client': 1, 'clients': 1, 'staff': 1, 'data': 1, 'assessment': 1,
                         'assessments': 1, 'evaluation': 1, 'review': 1, 'summary': 1, 'note': 1, 'notes': 1,
                         'update': 1, 'annual': 1, 'quarterly': 1, 'monthly': 1, 'addendum': 1, 'revised': 1,
                         'draft': 1, 'packet': 1, 'packets': 1}

DIGEST_NAME_LABELS = [
    r'name\s+of\s+(?:employee|participant|individual|client|patient|staff)',
    r'employee\s+name', r'staff\s+member', r'participant\s+name',
    r"individual\s*(?:'s)?\s+name", r'client\s+name', r'patient\s+name',
    r'applicant\s+name', r'resident\s+name', r'student\s+name',
    r'candidate\s+name', r'printed\s+name', r'full\s+name',
    'employee', 'participant', 'individual', 'client', 'patient', 'applicant',
    'resident', 'candidate', 'name',
]

DIGEST_NAME_VALUE = r"([A-Z][A-Za-z'\-]{1,20}(?:\s+[A-Z][A-Za-z'\.\-]{1,20}){1,2})"

DIGEST_ISSUERS = ['american heart association', 'american red cross', 'red cross', 'national safety council',
                  'ohio department of developmental disabilities', 'department of developmental disabilities', 'dodd',
                  'bureau of motor vehicles', 'bmv', 'ohio attorney general', 'bureau of criminal investigation',
                  'federal bureau of investigation', 'ohio department of health', 'asa lifecare', 'a brighter dawn']

DIGEST_REPORT_DATE_WORDS = [
    r'licen[sc]e\s+status\s+as\s+of', r'status\s+as\s+of', r'record\s+as\s+of', r'as\s+of',
    r'record\s+date', r'date\s+of\s+record', r'report\s+date', r'date\s+of\s+report', r'date\s+printed',
    r'printed\s+on', r'run\s+date',
]

DIGEST_EXPECTS = [
    ['cpr_first_aid', ['person', 'expires_on'], ['issued_on', 'issuer', 'number']],
    ['dodd_certification', ['person', 'issued_on'], ['expires_on', 'number', 'program']],
    ['med_admin_cert', ['person', 'expires_on'], ['issued_on', 'level', 'number']],
    ['crisis_prevention', ['person'], ['issued_on', 'expires_on']],
    ['diploma', ['person'], ['issued_on', 'issuer']],
    ['training_transcript', ['person'], ['issued_on']],
    ['drivers_licence', ['person', 'expires_on'], ['issued_on', 'born_on', 'number']],
    ['state_id', ['person', 'expires_on'], ['issued_on', 'born_on', 'number']],
    ['ssn_card', ['person'], ['issued_on', 'number']],
    ['birth_certificate', ['person', 'born_on'], ['issuer', 'number']],
    ['background_check', ['person'], ['issued_on', 'issuer', 'check_result']],
    ['driver_abstract', ['person'], ['issued_on']],
    ['auto_insurance', ['expires_on'], ['person', 'issued_on', 'number']],
    ['tb_test', ['person'], ['issued_on']],
    ['isp', ['person'], ['issued_on', 'expires_on']],
    ['mar', ['person'], ['issued_on']],
    ['dnr', ['person'], ['issued_on', 'issuer']],
    ['paystub', [], ['person', 'issued_on']],
    ['timesheet', [], ['person', 'issued_on']],
]

DIGEST_PERSON_KINDS = {'cpr_first_aid': 1, 'crisis_prevention': 1, 'med_admin_cert': 1, 'training_transcript': 1,
                       'diploma': 1, 'dodd_certification': 1, 'mar': 1, 'prescription': 1, 'physician_order': 1,
                       'lab_result': 1, 'tb_test': 1, 'immunization': 1, 'physical_exam': 1, 'drug_screen': 1,
                       'therapy_eval': 1, 'nursing_assessment': 1, 'seizure_protocol': 1, 'dietary_plan': 1,
                       'discharge_summary': 1, 'appointment_summary': 1, 'dental_vision': 1, 'isp': 1,
                       'behavior_plan': 1, 'amfm': 1, 'iep': 1, 'mui': 1, 'unusual_incident': 1,
                       'restraint_report': 1, 'drivers_licence': 1, 'state_id': 1, 'ssn_card': 1,
                       'birth_certificate': 1, 'passport': 1, 'work_authorization': 1, 'medicaid_card': 1,
                       'medicare_card': 1, 'health_insurance': 1, 'auto_insurance': 1, 'background_check': 1,
                       'guardianship': 1, 'consent_release': 1, 'timesheet': 1, 'paystub': 1, 'tax_form': 1,
                       'benefit_letter': 1, 'application_resume': 1, 'reference_check': 1, 'offer_letter': 1}

DIGEST_HOUSE_KINDS = {'fire_drill': 1, 'inspection': 1, 'lease': 1, 'utility_bill': 1}

DIGEST_COMPANY_KINDS = {'liability_insurance': 1, 'bank_statement': 1, 'invoice': 1}

_FWD = '^([^0-9A-Za-z]{0,12})' + DIGEST_DATE_TOKEN
_BACK = DIGEST_DATE_TOKEN + '([^0-9A-Za-z]{0,4}(?:[A-Za-z]{2,10}[^0-9A-Za-z]{0,3})?)$'
_RANGE = (r'(?:effective|valid|coverage|period|term)\s*(?:dates?)?\s*(?:from|:)?\s*' + DIGEST_DATE_TOKEN +
          r'\s*(?:to|through|thru|until|-|–)\s*' + DIGEST_DATE_TOKEN)
_ROW_WORDS = [(w, role) for role in DIGEST_DATE_ROLE_WORDS if role != 'born' for w in DIGEST_DATE_ROLE_WORDS[role]]
_ANY_LABEL = '(' + ')|('.join(w for w, _ in _ROW_WORDS) + ')'
_NAME = r"([A-Za-z][A-Za-z'’\-]{1,24}(?:[^\S\n]+[A-Za-z][A-Za-z'’.\-]{0,24}){1,3})"
_CAPS = r"(^|[-'’ ])([a-z])"


# ── the words book (digestVocab_) ─────────────────────────────────────────────────────────────────────────────────

def _tab(rows: dict | None, tab: str) -> list[dict]:
    """digestVocabRows_, answering from the rows handed in."""
    if not rows or not isinstance(rows, dict):
        return []
    got = rows.get(tab)
    if not got:
        return []
    out = []
    for r in got:
        out.append({k: (to_u16(v) if isinstance(v, str) else v) for k, v in r.items()} if isinstance(r, dict) else r)
    return out


def _vocab_on(row: dict) -> bool:
    """digestVocabOn_."""
    a = js_lower(js_string(_or(row.get('active') if row else None, 'on')))
    return a != 'off' and a != 'false' and a != 'no' and a != '0'


def _vocab_list(cell: Any) -> list[str]:
    """digestVocabList_: 'a, b | c' → ['a','b','c']."""
    return [x for x in (js_lower(js_trim(p)) for p in re.split('[,|]', js_string(_or(cell, '')))) if x]


def _order(row: dict) -> float:
    n = js_number(row.get('order'))
    return n if _truthy(n) else 0


def _cell(row: dict, key: str, fallback: str = '') -> str:
    return js_trim(js_string(_or(row.get(key), fallback)))


def book(rows: dict[str, list[dict[str, str]]] | None) -> dict:
    """digestVocab_ over digestVocabRows_(tab) = rows.get(tab, []); None reads as a book that answered nothing."""
    v: dict[str, Any] = {'kinds': [], 'categories': [], 'labels': [], 'issuers': [], 'orgs': [], 'drawers': [],
                         'bad': 0, 'source': 'seed', 'v': 'seed'}

    for k in _tab(rows, DIGEST_VOCAB_TABS['kinds']):
        if not _vocab_on(k):
            continue
        needles = _vocab_list(k.get('needles'))
        if not _cell(k, 'kind') or not needles:
            v['bad'] += 1
            continue
        opts: dict[str, Any] = {}
        files = _vocab_list(k.get('file_hints'))
        if files:
            opts['file'] = files
        w = js_number(k.get('weight'))
        if w == w and 0 < w <= 5 and w != 1:
            opts['w'] = _jsnum(w)
        v['kinds'].append([js_trim(js_string(k.get('kind'))), _cell(k, 'category'), needles, opts])

    for cat in sorted(_tab(rows, DIGEST_VOCAB_TABS['categories']), key=_order):
        if not _vocab_on(cat):
            continue
        cn = _vocab_list(cat.get('needles'))
        if not _cell(cat, 'category') or not cn:
            v['bad'] += 1
            continue
        v['categories'].append([js_trim(js_string(cat.get('category'))), cn])

    for lab_row in sorted(_tab(rows, DIGEST_VOCAB_TABS['labels']), key=_order):
        if not _vocab_on(lab_row):
            continue
        lab = _cell(lab_row, 'label')
        if lab:
            v['labels'].append(lab)
        else:
            v['bad'] += 1

    for iss in _tab(rows, DIGEST_VOCAB_TABS['issuers']):
        if not _vocab_on(iss):
            continue
        nm = js_lower(_cell(iss, 'name'))
        if not nm:
            v['bad'] += 1
            continue
        v['issuers'].append(nm)
        org = js_lower(js_string(_or(iss.get('is_organisation'), 'yes')))
        if org != 'no' and org != 'false' and org != 'off':
            v['orgs'].append(nm)

    for dr in _tab(rows, DIGEST_VOCAB_TABS['drawers']):
        if not _vocab_on(dr):
            continue
        pre = js_lower(_cell(dr, 'drawer_prefix'))
        dc = _cell(dr, 'category')
        if pre and dc:
            v['drawers'].append([pre, dc])
        else:
            v['bad'] += 1

    v['zip'] = {}
    for z in _tab(rows, DIGEST_VOCAB_TABS['zip']):
        if not _vocab_on(z):
            continue
        ze = re.sub(r'^\.', '', js_lower(js_trim(js_string(_or(_or(z.get('ext'), z.get('extension')), '')))))
        if ze:
            if ze != '__proto__':
                v['zip'][ze] = 1
        else:
            v['bad'] += 1

    v['settings'] = {}
    for st in _tab(rows, DIGEST_VOCAB_TABS['settings']):
        if not _vocab_on(st):
            continue
        sk = js_lower(_cell(st, 'key'))
        raw = js_trim(js_string('' if st.get('value') is None else st.get('value')))
        sv = js_number(raw)
        if sk and raw != '' and sv == sv:
            if sk != '__proto__':
                v['settings'][sk] = _jsnum(sv)
        elif sk and raw != '':
            if sk != '__proto__':
                v['settings'][sk] = raw
        elif not sk:
            v['bad'] += 1

    v['expects'] = []
    for ex in _tab(rows, DIGEST_VOCAB_TABS['expects']):
        if not _vocab_on(ex):
            continue
        ex_k = _cell(ex, 'doc_kind')
        if not ex_k:
            v['bad'] += 1
            continue
        v['expects'].append([ex_k, _vocab_list(ex.get('must')), _vocab_list(ex.get('may'))])

    v['credentials'] = []
    for cr in _tab(rows, DIGEST_VOCAB_TABS['credentials']):
        if not _vocab_on(cr):
            continue
        cr_k = _cell(cr, 'doc_kind')
        if not cr_k:
            v['bad'] += 1
            continue
        v['credentials'].append([cr_k, _cell(cr, 'doc_id'), _cell(cr, 'credential'), _cell(cr, 'requirement'),
                                 _cell(cr, 'expires')])

    v['answers'] = []
    for af in sorted(_tab(rows, DIGEST_VOCAB_TABS['answers']), key=_order):
        if not _vocab_on(af):
            continue
        af_f = _cell(af, 'fact')
        af_n = _vocab_list(af.get('needles'))
        if not af_f or not af_n:
            v['bad'] += 1
            continue
        v['answers'].append([af_f, af_n])

    v['types'] = {}
    for ty in _tab(rows, DIGEST_VOCAB_TABS['types']):
        if not _vocab_on(ty):
            continue
        te = re.sub(r'^\.', '', js_lower(_cell(ty, 'ext')))
        tm = _cell(ty, 'mime')
        if not te or not tm or _has(DIGEST_TYPE_NEVER, te):
            v['bad'] += 1
            continue
        v['types'][te] = tm

    read = (len(v['kinds']) + len(v['categories']) + len(v['labels']) + len(v['issuers']) + len(v['drawers']) +
            len(v['answers']) + len(v['credentials']) + len(v['zip']) + len(v['settings']) + len(v['types']))
    if read:
        v['source'] = 'book'
        v['v'] = ('b' + str(len(v['kinds'])) + '.' + str(len(v['categories'])) + '.' + str(len(v['labels'])) + '.' +
                  str(len(v['issuers'])) + '.' + str(len(v['drawers'])) + '.' + str(len(v['zip'])) + '.' +
                  str(len(v['types'])))
    return v


_SEED: dict | None = None


def _book_or_seed(bk: dict | None) -> dict:
    """A book handed in, or the one a words book that answered nothing gives."""
    global _SEED
    if bk is not None:
        return bk
    if _SEED is None:
        _SEED = book(None)
    return _SEED


def _kinds(bk: dict) -> list:
    """digestKinds_."""
    return bk['kinds'] if bk.get('kinds') else DIGEST_DOC_KINDS


def _categories_table(bk: dict) -> list:
    """digestCategoriesTable_."""
    return bk['categories'] if bk.get('categories') else DIGEST_CATEGORIES


def _labels(bk: dict) -> list:
    """digestLabels_."""
    return bk['labels'] if bk.get('labels') else DIGEST_NAME_LABELS


def _issuers(bk: dict) -> list:
    """digestIssuers_."""
    return bk['issuers'] if bk.get('issuers') else DIGEST_ISSUERS


def _org_names(bk: dict) -> list:
    """digestOrgNames_."""
    return bk['orgs'] if bk.get('orgs') else DIGEST_ISSUERS


def _credentials(bk: dict) -> list:
    """digestCredentials_."""
    return bk['credentials'] if bk.get('credentials') else DIGEST_CREDENTIALS


def setting(bk: dict, key: str, fallback: Any, lo: Any = None, hi: Any = None) -> Any:
    """digestSetting_: a number from the book, clamped by the code that has to live with it."""
    got = (_book_or_seed(bk).get('settings') or {}).get(js_lower(js_string(key)))
    if isinstance(fallback, str):
        return fallback if (got is None or js_trim(js_string(got)) == '') else js_trim(js_string(got))
    if got is None or js_number(got) != js_number(got):
        return fallback
    n = js_number(got)
    if lo is not None and n < lo:
        return fallback
    if hi is not None and n > hi:
        return fallback
    return _jsnum(n)


def _credential_for(doc_kind: Any, bk: dict) -> dict | None:
    """digestCredentialFor_."""
    k = js_trim(js_string(_or(doc_kind, '')))
    if not k:
        return None
    for row in _credentials(bk):
        if row[0] == k:
            return {'doc_kind': k, 'doc_id': row[1], 'credential': row[2], 'requirement': row[3],
                    'expires': js_lower(js_string(_or(row[4] if len(row) > 4 else None, ''))) == 'yes'}
    return None


def cert_book(bk: dict, expect: list[str] | None) -> dict:
    """certReadVocab_ (ComplianceDocs.gs): the words book as a certificate is read by."""
    bk = _book_or_seed(bk)
    v = dict(bk)
    if bk.get('credentials'):
        rows = []
        for row in bk['credentials']:
            if _str_(row[4] if len(row) > 4 else None):
                rows.append(row)
                continue
            seed = next((s for s in DIGEST_CREDENTIALS if s[0] == _str_(row[0] if row else None)), None)
            rows.append([row[0], row[1], row[2], row[3], seed[4]] if seed else row)
        v['credentials'] = rows
    if bk.get('kinds'):
        ks = list(bk['kinds'])
        for kind in (expect or []):
            seed = next((s for s in DIGEST_DOC_KINDS if s[0] == kind), None)
            if seed is None:
                continue
            for i in range(len(ks)):
                if ks[i][0] != kind:
                    continue
                needles = list(ks[i][2] or [])
                for nd in seed[2]:
                    if nd not in needles:
                        needles.append(nd)
                ks[i] = [ks[i][0], ks[i][1], needles, ks[i][3] if len(ks[i]) > 3 else None]
                break
            else:
                ks.append(seed)
        v['kinds'] = ks
    return v


# ── the reading ───────────────────────────────────────────────────────────────────────────────────────────────────

def _category(filename: str, text: str, bk: dict) -> dict:
    """digestCategory_: the lexicon, first hit wins (the model seam is shut)."""
    hay = js_lower(js_string(filename) + ' ' + js_string(text)[:4000])
    for row in _categories_table(bk):
        for needle in row[1]:
            if needle in hay:
                return {'category': row[0], 'source': 'lexicon'}
    return {'category': 'other', 'source': 'none'}


def _dates(filename: str, text: str) -> list[str]:
    """digestDates_."""
    return _dates_in(js_string(filename) + '\n' + js_string(text)[:SCAN_CAP])


def _dates_in(s: str) -> list[str]:
    """digestDatesIn_: every date in a piece of text, ISO, sorted, at most twelve."""
    out: dict[str, int] = {}

    def put(y: int, mo: int, d: int) -> None:
        if mo < 1 or mo > 12 or y < 1900 or y > 2100:
            return
        if d < 1 or d > 31:
            return
        out[str(y) + '-' + ('0' + str(mo))[-2:] + '-' + ('0' + str(d))[-2:]] = 1

    for m in _rx(r'\b(\d{1,2})[\/_\-.](\d{1,2})[\/_\-.]((?:19|20)\d{2}|\d{2})\b', 'g').finditer(s):
        put(2000 + int(m.group(3)) if len(m.group(3)) == 2 else int(m.group(3)), int(m.group(1)), int(m.group(2)))
    for m in _rx(r'\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b', 'g').finditer(s):
        out[m.group(1) + '-' + m.group(2) + '-' + m.group(3)] = 1
    for m in _rx(r'(^|[^0-9\/\-.])(\d{1,2})[\/\-.](20\d{2})(?![0-9\/\-.])', 'g').finditer(s):
        mo3, y3 = int(m.group(2)), int(m.group(3))
        if 1 <= mo3 <= 12:
            put(y3, mo3, _last_day(y3, mo3))
    for m in _rx(r'\b([A-Za-z]{3,9})\.?[\s,\-]+(?:(\d{1,2})(?:st|nd|rd|th)?[\s,\-]+)?((?:19|20)\d{2})\b',
                 'g').finditer(s):
        mo4 = DIGEST_MONTH_WORDS.get(js_lower(m.group(1)))
        if not mo4:
            continue
        y4 = int(m.group(3))
        put(y4, mo4, int(m.group(2)) if m.group(2) else _last_day(y4, mo4))
    return sorted(out)[:12]


def plain_dashes(s: Any) -> str:
    """digestPlainDashes_."""
    return js_string(_or(s, '')).translate(_DASHES)


def _doc_kind(filename: Any, text: Any, bk: dict) -> dict:
    """digestDocKind_: { kind, category, alt, score } — scored, not first-hit-wins."""
    name = plain_dashes(js_lower(js_string(_or(filename, ''))))
    words = ' ' + js_trim(_rx('[^a-z0-9]+', 'g').sub(' ', name)) + ' '
    tight = _rx('[^a-z0-9]+', 'g').sub('', name)
    body = plain_dashes(js_lower(js_string(_or(text, ''))[:SCAN_CAP]))
    head = body[:2000]
    lead = body[:300]
    body_weight = 0.5 if len(body) > 20000 else 1
    best = second = spoke = None
    has_other = _rx('[^a-z0-9]')
    all_word = _rx('^[a-z0-9]+$')
    for row in _kinds(bk):
        needles = row[2]
        opts = row[3] if len(row) > 3 and _truthy(row[3]) else {}
        score: Any = 0
        matched = 0
        name_hit = False
        lead_hit = False
        for needle in needles:
            seen = False
            if needle in name:
                score += 5
                seen = True
                name_hit = True
            if needle in head:
                score += 3
                seen = True
            if len(needle) >= 8 and needle in lead:
                lead_hit = True
            at, hits = body.find(needle), 0
            while at != -1 and hits < 3:
                hits += 1
                at = body.find(needle, at + len(needle))
            score += hits * body_weight
            if hits:
                seen = True
            if seen:
                matched += 1
        for hint in (opts.get('file') or []):
            hint = js_string(hint)
            found = (hint in name) if has_other.search(hint) else ((' ' + hint + ' ') in words)
            if not found and len(hint) >= 7 and all_word.search(hint):
                found = hint in tight
            if found:
                score += 6
                name_hit = True
        if matched > 1:
            score += (matched - 1) * 3
        if 'w' in opts:
            score = score * (0 if opts['w'] is None else opts['w'])
        if not _truthy(score):
            continue
        entry = {'kind': row[0], 'category': row[1], 'score': score, 'named': name_hit, 'lead': lead_hit}
        if best is None or score > best['score'] or (score == best['score'] and name_hit and not best['named']):
            second = best
            best = entry
        elif second is None or score > second['score']:
            second = entry
        if lead_hit and (spoke is None or score > spoke['score']):
            spoke = entry
    if best is None:
        return {'kind': '', 'category': '', 'alt': ''}
    if (spoke is not None and spoke is not best and not best['lead'] and not best['named'] and
            spoke['score'] >= best['score'] * 0.75):
        second = best
        best = spoke
    return {'kind': best['kind'], 'category': best['category'],
            'alt': js_string(second['kind']) + ':' + js_num_str(second['score']) if second else '',
            'score': best['score']}


def _month_end(raw: Any) -> str:
    """digestMonthEnd_: "7/2028" → the month's last day."""
    m = _rx(r'^(\d{1,2})[\/\-.]((?:20)?\d{2})$').search(js_trim(js_string(_or(raw, ''))))
    if not m:
        return ''
    mo = int(m.group(1))
    y = 2000 + int(m.group(2)) if len(m.group(2)) == 2 else int(m.group(2))
    if mo < 1 or mo > 12 or y < 2000 or y > 2100:
        return ''
    last = _last_day(y, mo)
    return str(y) + '-' + ('0' + str(mo))[-2:] + '-' + ('0' + str(last))[-2:]


def _one_date(raw: Any) -> str:
    """digestOneDate_: one date string, US or ISO, into ISO — or '' rather than a wrong day."""
    s = js_trim(js_string(_or(raw, '')))
    if _rx(r'^(?:19|20)\d{2}-\d{2}-\d{2}$').search(s):
        return s
    m = _rx(r'^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]((?:19|20)?\d{2})$').search(s)
    if not m:
        return ''
    y = 2000 + int(m.group(3)) if len(m.group(3)) == 2 else int(m.group(3))
    mo, d = int(m.group(1)), int(m.group(2))
    if mo < 1 or mo > 12 or d < 1 or d > 31 or y < 1900 or y > 2100:
        return ''
    return str(y) + '-' + ('0' + str(mo))[-2:] + '-' + ('0' + str(d))[-2:]


def _any_date(raw: Any) -> str:
    """digestAnyDate_: one printed date, whatever its shape, as ISO — '' when it is not one."""
    s = js_trim(_rx(r'\s+', 'g').sub(' ', js_string(_or(raw, ''))))
    if not s:
        return ''
    iso = _one_date(s)
    if iso:
        return iso
    m = _rx(r'^(\d{1,2})[\/\-.]((?:19|20)\d{2})$').search(s)
    if m:
        return _month_end(s)
    m = _rx(r'^([A-Za-z]{3,9})\.?,?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?((?:19|20)\d{2})$').search(s)
    if m:
        mo = DIGEST_MONTH_WORDS.get(js_lower(m.group(1)))
        if not mo:
            return ''
        y = int(m.group(3))
        d = int(m.group(2)) if m.group(2) else _last_day(y, mo)
        if d < 1 or d > 31:
            return ''
        return str(y) + '-' + ('0' + str(mo))[-2:] + '-' + ('0' + str(d))[-2:]
    m = _rx(r'^(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]{3,9}),?\s+((?:19|20)\d{2})$', 'i').search(s)
    if m:
        mo2 = DIGEST_MONTH_WORDS.get(js_lower(m.group(2)))
        if not mo2:
            return ''
        return m.group(3) + '-' + ('0' + str(mo2))[-2:] + '-' + ('0' + str(int(m.group(1))))[-2:]
    return ''


def _date_row_pairs(s: str) -> dict[str, str]:
    """digestDateRowPairs_: a caption row above a value row."""
    out: dict[str, str] = {}
    lines = s.split('\n')
    role_of = [role for _, role in _ROW_WORDS]
    any_label = _rx(_ANY_LABEL, 'gi')
    any_date = _rx(DIGEST_DATE_TOKEN, 'g')
    groups = len(_ROW_WORDS)
    for i, cap in enumerate(lines):
        if not cap or len(cap) > 160:
            continue
        if any_date.search(cap):
            continue
        labels = []
        for m in any_label.finditer(cap):
            for g in range(1, groups + 1):
                if m.group(g) is not None:
                    labels.append(role_of[g - 1])
                    break
        if not labels:
            continue
        j = i + 1
        while j < len(lines) and j <= i + 2:
            val = lines[j]
            j += 1
            if not val or not js_trim(val):
                continue
            if any_label.search(val):
                break
            dates = []
            for d in any_date.finditer(val):
                iso = _any_date(d.group(1))
                if iso:
                    dates.append(iso)
            if not dates:
                continue
            if len(dates) != len(labels):
                break
            for k in range(len(labels)):
                if not out.get(labels[k]):
                    out[labels[k]] = dates[k]
            break
    return out


def _date_roles(text: Any) -> dict:
    """digestDateRoles_: ISSUED and EXPIRES (and born), when the document itself says which is which."""
    s = js_string(_or(text, ''))[:SCAN_CAP].replace('\r', '\n')
    found: dict[str, Any] = {'issued': '', 'expires': '', 'born': '', 'how': {}}
    used: dict[str, str] = {}

    def take(role: str, iso: str, how: str) -> bool:
        if not iso or found[role] or used.get(iso):
            return False
        found[role] = iso
        found['how'][role] = how
        used[iso] = role
        return True

    rng = _rx(_RANGE, 'i').search(s)
    if rng:
        take('issued', _any_date(rng.group(1)), 'range')
        take('expires', _any_date(rng.group(2)), 'range')
    rows = _date_row_pairs(s)
    fwd_re = _rx(_FWD, 'i')
    back_re = _rx(_BACK, 'i')
    for role in ('born', 'expires', 'issued'):
        if rows.get(role):
            take(role, rows[role], 'row')
        if found[role]:
            continue
        best = None
        for word in DIGEST_DATE_ROLE_WORDS[role]:
            for m in _rx(word, 'gi').finditer(s):
                at = m.start()
                end = at + len(m.group(0))
                fwd = fwd_re.search(s[end:end + 48])
                if fwd:
                    iso_f = _any_date(fwd.group(2))
                    if iso_f and not used.get(iso_f):
                        dist = len(fwd.group(1)) - (1 if ':' in fwd.group(1) else 0)
                        if best is None or dist < best['dist']:
                            best = {'iso': iso_f, 'dist': dist, 'how': 'forward'}
                back = back_re.search(s[max(0, at - 48):at])
                if back:
                    iso_b = _any_date(back.group(1))
                    if iso_b and not used.get(iso_b):
                        dist_b = len(back.group(2)) + 1
                        if best is None or dist_b < best['dist']:
                            best = {'iso': iso_b, 'dist': dist_b, 'how': 'backward'}
        if best:
            take(role, best['iso'], best['how'])
    if found['issued'] and found['expires'] and found['expires'] < found['issued']:
        found['how']['conflict'] = found['expires'] + ' before ' + found['issued']
        found['expires'] = ''
    return found


def _add_months(iso: Any, months: Any) -> str:
    """digestAddMonths_: ISO + months, the day clamped to the month it lands in."""
    m = _rx(r'^(\d{4})-(\d{2})-(\d{2})$').search(js_string(_or(iso, '')))
    if not m or not _truthy(months):
        return ''
    y, mo, d = int(m.group(1)), int(m.group(2)) - 1 + int(months), int(m.group(3))
    y += mo // 12
    mo = mo % 12
    last = _last_day(y, mo + 1)
    if d > last:
        d = last
    return str(y) + '-' + ('0' + str(mo + 1))[-2:] + '-' + ('0' + str(d))[-2:]


def _renewal_months(doc_id: Any) -> int:
    """digestRenewalMonths_ where no files catalog is loaded: the floor answers."""
    key = js_string(_or(doc_id, ''))
    if not key:
        return 0
    return DIGEST_RENEWAL_FLOOR.get(key) or 0


def _utc_today() -> str:
    """new Date().toISOString().slice(0, 10)."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _roles_finish(doc_kind: str, roles: dict, dates: list, today: Any, bk: dict, clock: str | None = None) -> dict:
    """digestRolesFinish_: the dates a paper means when its labels did not survive the scan; `clock` stands in
    for new Date() when today is not given."""
    how = roles.get('how')
    out = {'issued': _or(roles.get('issued'), ''), 'expires': _or(roles.get('expires'), ''),
           'born': _or(roles.get('born'), ''), 'how': how if how is not None else {}, 'source': ''}
    if out['expires']:
        out['source'] = 'paper'
    now = js_string(today) if _truthy(today) else (clock or _utc_today())
    cred = _credential_for(doc_kind, bk)
    clean: list[str] = []
    for d in (dates or []):
        if not d or d == out['born'] or d < '1990-01-01':
            continue
        if d not in clean:
            clean.append(d)
    clean.sort()
    if not out['issued'] and not out['expires'] and len(clean) == 2 and cred and cred['expires']:
        out['issued'] = clean[0]
        out['expires'] = clean[1]
        out['how']['issued'] = 'pair'
        out['how']['expires'] = 'pair'
        out['source'] = 'pair'
    if not out['issued'] and not out['expires'] and len(clean) == 1 and _has(DIGEST_SINGLE_DATE_KINDS, doc_kind):
        if clean[0] <= now:
            out['issued'] = clean[0]
            out['how']['issued'] = 'single'
        elif cred and cred['expires']:
            out['expires'] = clean[0]
            out['how']['expires'] = 'single'
            out['source'] = 'single'
    if not out['expires'] and out['issued'] and cred and cred['expires']:
        months = _renewal_months(cred['doc_id'])
        if months:
            got = _add_months(out['issued'], months)
            if got:
                out['expires'] = got
                out['how']['expires'] = 'derived'
                out['source'] = 'derived:' + js_num_str(months) + 'm'
    return out


def _roman(v: Any) -> str:
    """digestRoman_."""
    t = js_lower(js_string(_or(v, '')))
    if t == 'i':
        return '1'
    if t == 'ii':
        return '2'
    if t == 'iii':
        return '3'
    return t if _rx(r'^[123]$').search(t) else ''


def _cert_grid(text: Any) -> list[dict]:
    """digestCertGrid_: the certification grid — one paper, several credentials."""
    s = js_string(_or(text, ''))[:SCAN_CAP].replace('\r', '\n')
    row_re = _rx(r'cat(?:egory)?\s*[\-–]?\s*(i{1,3}|[123])\b[^0-9A-Za-z]{0,6}'
                 r'([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})[^0-9A-Za-z]{0,6}'
                 r'([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})', 'i')
    st_re = _rx('(certified|expired|revoked|pending|active)', 'i')
    out: list[dict] = []
    for line in s.split('\n'):
        if len(out) >= 16:
            break
        m = row_re.search(line)
        if not m:
            continue
        level = _roman(m.group(1))
        if not level:
            continue
        st = st_re.search(line)
        out.append({'level': level, 'effective': _one_date(m.group(2)), 'expires': _one_date(m.group(3)),
                    'status': js_lower(st.group(1)) if st else ''})
    return out


def _med_level(text: Any) -> str:
    """digestMedLevel_: which category of medication administration."""
    live: list[str] = []
    for row in _cert_grid(text):
        if row['status'] == 'certified' and row['level'] not in live:
            live.append(row['level'])
    if live:
        live.sort()
        return ','.join(live)
    s = js_string(_or(text, ''))[:SCAN_CAP]
    m = _rx(r'\bcat(?:egory)?\s*[\-–:]?\s*(1|2|3|i{1,3})\b', 'i').search(s)
    return _roman(m.group(1)) if m else ''


def _check_result(text: Any) -> dict:
    """digestCheckResult_: what a background check said — clear, records, or nothing readable."""
    s = js_lower(js_string(_or(text, ''))[:SCAN_CAP])
    is_bci = _rx(r'\bbci\b|bureau\s+of\s+criminal\s+investigation|webcheck').search(s) is not None
    is_fbi = _rx(r'\bfbi\b|federal\s+bureau\s+of\s+investigation|identity\s+history\s+summary').search(s) is not None
    agency = ('BCI' if is_bci else '') + (('/FBI' if is_bci else 'FBI') if is_fbi else '')
    result = ''
    if _rx(r'no\s+(?:bci\s+|fbi\s+)?(?:convictions?|criminal\s+record|record|arrest\s+record|prior\s+arrest)'
           r'|no\s+record\s+found|not\s+found|no\s+results|no\s+disqualifying|no\s+matching|none\s+found'
           r'|is\s+clear|cleared').search(s):
        result = 'clear'
    elif _rx(r'convictions?\s+on\s+file|record\s+found|criminal\s+history\s+(?:record\s+)?(?:follows|attached)'
             r'|disqualifying\s+offen[cs]e').search(s):
        result = 'records'
    return {'agency': agency, 'result': result}


def _redact(text: Any, doc_kind: Any) -> dict:
    """digestRedact_: a secret is never stored in the clear."""
    last4: list[str] = []
    s = js_string(_or(text, ''))

    def mask(m: re.Match) -> str:
        c = m.group(3)
        if c not in last4:
            last4.append(c)
        return '***-**-' + c

    s = _rx(r'\b(\d{3})[\s\-.](\d{2})[\s\-.](\d{4})\b', 'g').sub(mask, s)
    says = _rx(r'social\s*security|this\s+number\s+has\s+been\s+established', 'i').search(s[:4000]) is not None
    if says or js_string(_or(doc_kind, '')) == 'ssn_card':
        s = _rx(r'\b(\d{3})[\s\-.](\d{3})[\s\-.](\d{4})\b', 'g').sub(mask, s)
        s = _rx(r'\b(\d{3})[\s\-.]?(\d{2})[\s\-.]?(\d{4})\b', 'g').sub(mask, s)
    return {'text': s, 'ssn_last4': last4}


def _is_organisation(name: Any, bk: dict) -> bool:
    """digestIsOrganisation_: an organisation is not a member of staff."""
    n = js_trim(_rx(r'\s+', 'g').sub(' ', js_lower(js_string(_or(name, '')))))
    if not n:
        return True
    for org in _org_names(bk):
        if n == org or org in n:
            return True
    return _rx(r'\b(llc|inc|incorporated|corp|company|services|solutions|agency|center|centre|clinic|hospital'
               r'|pharmacy|department|bureau|association|foundation|university|college|school|county|state of)\b'
               ).search(n) is not None


def _roster(roster: dict | None, bk: dict) -> list[dict]:
    """The DIGEST_ROSTER digestWhoIs_ fills from listRows_('people') and listRows_('clients')."""
    out: list[dict] = []
    src = roster or {}
    for row in (src.get('people') or []):
        if not isinstance(row, dict):
            break
        sd = _rx(r'\s+', 'g').sub(' ', js_trim(to_u16(js_string(_or(row.get('name'), '')))))
        sid = to_u16(_str_(row.get('id')))
        if sid and ' ' in sd and not _is_organisation(sd, bk):
            out.append({'id': 'people:' + sid, 'name': js_lower(sd), 'display': sd, 'kind': 'staff'})
    for row in (src.get('clients') or []):
        if not isinstance(row, dict):
            break
        cd = _rx(r'\s+', 'g').sub(' ', js_trim(to_u16(js_string(_or(row.get('name'), '')))))
        ck = js_trim(to_u16(js_string(_or(row.get('client_key'), '')))) or to_u16(_str_(row.get('id')))
        if ck and ' ' in cd:
            out.append({'id': 'client:' + ck, 'name': js_lower(cd), 'display': cd, 'kind': 'client'})
    return out


def _who_is(text: Any, filename: Any, people: list[dict]) -> dict | None:
    """digestWhoIs_: whose document it is — the one roster entry the words name, or nobody."""
    if not people:
        return None
    hay = ' ' + _rx('[^a-z0-9]+', 'g').sub(' ', _rx("['’\\-]", 'g').sub('', js_lower(
        js_string(_or(filename, '')) + ' ' + js_string(text)[:SCAN_CAP]))) + ' '
    hit = None
    for r in people:
        needle = ' ' + _rx('[^a-z0-9]+', 'g').sub(' ', _rx("['’\\-]", 'g').sub('', r['name'])) + ' '
        if needle not in hay:
            parts = js_trim(needle).split(' ')
            if len(parts) != 2:
                continue
            if not _rx(' ' + parts[0] + ' (?:[a-z0-9]+ ){0,2}' + parts[1] + ' ').search(hay):
                continue
        if hit is not None and hit['id'] != r['id']:
            return None
        hit = r
    return hit


def _name_cut(after: Any) -> str:
    """digestNameCut_: a value stops where the field stops."""
    seg = js_string(_or(after, ''))
    stop = _rx(r'[.,;:|\n\r]|\s{2,}').search(seg)
    if stop:
        seg = seg[:stop.start()]
    m = _rx(r'^\s*"?' + DIGEST_NAME_VALUE).search(seg)
    if not m:
        return ''
    words = js_trim(_rx(r'\s+', 'g').sub(' ', m.group(1))).split(' ')
    while len(words) > 2:
        tail = words[-1]
        if len(tail) <= 4 and tail == js_upper(tail):
            words.pop()
            continue
        if _has(DIGEST_NAME_STOPWORDS, js_lower(tail)):
            words.pop()
            continue
        break
    if len(words) < 2:
        return ''
    if _has(DIGEST_NAME_STOPWORDS, js_lower(words[0])):
        return ''
    return ' '.join(words)


def _recase(w: str) -> str:
    return _rx(_CAPS, 'g').sub(lambda m: m.group(1) + js_upper(m.group(2)), js_lower(w))


def _name_from_phrase(text: Any, kind: Any) -> str:
    """digestNameFromPhrase_: the name a certificate prints without a label."""
    s = js_string(_or(text, ''))[:20000].replace('\r', '\n')

    def clean(raw: Any) -> str:
        words = js_trim(_rx(r'\s+', 'g').sub(' ', js_string(_or(raw, '')))).split(' ')
        out: list[str] = []
        i = 0
        while i < len(words) and len(out) < 4:
            w = _rx(r"^[^A-Za-z]+|[^A-Za-z.'’\-]+$", 'g').sub('', words[i])
            i += 1
            if not w or _has(DIGEST_NAME_STOPWORDS, js_lower(w)):
                break
            if _rx(r'^(has|have|having|is|was|signature|date|dob|born|sex|address|the)$', 'i').search(w):
                break
            if len(w) > 1 and w == js_upper(w):
                w = _recase(w)
            out.append(w)
        return ' '.join(out) if len(out) >= 2 else ''

    after = [r"this\s+(?:is\s+to\s+)?certif(?:y|ies)\s+that", r"this\s+number\s+has\s+been\s+established\s+for",
             r"this\s+certificate\s+is\s+proudly\s+presented\s+to",
             r"this\s+diploma\s+is\s+hereby\s+awarded\s+to",
             r"certificate\s+of\s+completion",
             r"awarded\s+to", r"presented\s+to", r"conferred\s+upon", r"is\s+hereby\s+granted\s+to"]
    if kind == 'birth_certificate':
        after = [r"child'?s?\s+name(?:\s*\([^)]*\))?", r"name\s+of\s+child", r"(?:^|\n)\s*name\b(?!\s+of\b)"] + after
    for a in after:
        m = _rx(a + r"[^A-Za-z\n]{0,4}\n?\s*" + _NAME, 'i').search(s)
        if m:
            got = clean(m.group(1))
            if got:
                return got
    before = _rx(r'([^\n]{3,60})\n+\s*(?:has|have|having)\s+(?:successfully\s+|satisfactorily\s+)?'
                 r'(?:completed|demonstrated|satisfied)', 'i').search(s)
    if before:
        got2 = clean(before.group(1))
        if got2 and not _rx(r'\d').search(before.group(1)):
            return got2
    dodd = _rx(_NAME + r"\s*[-–]\s*DD\d{8}").search(s)
    if dodd:
        got3 = clean(dodd.group(1))
        if got3:
            return got3
    return ''


def _name_from_text(text: Any, kind: Any, bk: dict) -> str:
    """digestNameFromText_: the name printed inside the document, found by the label in front of it."""
    s = js_string(_or(text, ''))[:20000]
    phrase = _name_from_phrase(s, kind)
    if phrase:
        return phrase
    flip = _rx(r"\b(?:name|Name|NAME)\s*[:\-]\s*([A-Z][A-Za-z'’\-]{1,24})\s*,\s*"
               r"([A-Z][A-Za-z'’.\-]{1,24}(?:[^\S\n]+[A-Z][A-Za-z'’.\-]{0,24})?)").search(s)
    if flip:
        last_w, first_w = flip.group(1), js_trim(_rx(r'\s+', 'g').sub(' ', flip.group(2)))

        def case_it(w: str) -> str:
            return _recase(w) if len(w) > 1 and w == js_upper(w) else w

        if (not _has(DIGEST_NAME_STOPWORDS, js_lower(last_w)) and
                not _has(DIGEST_NAME_STOPWORDS, js_lower(first_w.split(' ')[0]))):
            return ' '.join(case_it(x) for x in first_w.split(' ')) + ' ' + case_it(last_w)
    last = _rx(r"""last\s*name\s*[:\-]?\s*"?([A-Z][A-Za-z'\-]{1,24})""", 'i').search(s)
    first = _rx(r"""first\s*name\s*[:\-]?\s*"?([A-Z][A-Za-z'\-]{1,24})""", 'i').search(s)
    if last and first:
        pair = first.group(1) + ' ' + last.group(1)
        if (not _has(DIGEST_NAME_STOPWORDS, js_lower(first.group(1))) and
                not _has(DIGEST_NAME_STOPWORDS, js_lower(last.group(1)))):
            return pair
    for label in _labels(bk):
        at = _rx(js_string(label) + r'\s*[:\-]\s*', 'i').search(s)
        if not at:
            continue
        got = _name_cut(s[at.start() + len(at.group(0)):])
        if got:
            return got
    return ''


def _name_from_pairs(pairs: list[dict] | None) -> str:
    """digestNameFromPairs_."""
    want = ['name', 'full_name', 'client', 'client_name', 'employee', 'employee_name', 'participant', 'individual',
            'student', 'staff', 'patient', 'member']
    for w in want:
        for p in (pairs or []):
            if js_string(p.get('k')) != w:
                continue
            v = js_trim(js_string(_or(p.get('v'), '')))
            if _rx(r"^[A-Za-z][A-Za-z '.\-]{3,48}$").search(v) and len(v.split(' ')) <= 4:
                return _rx(r'\s+', 'g').sub(' ', v)
    return ''


def _pairs(text: Any) -> list[dict]:
    """digestPairs_: every labelled fact on the page."""
    s = js_string(_or(text, ''))[:SCAN_CAP].replace('\r', '\n')
    marks: list[dict] = []
    for m in _rx(r"(^|[\n\s])([A-Z][A-Za-z .'\/&#-]{1,32}?)\s*:\s*", 'g').finditer(s):
        if len(marks) >= 60:
            break
        marks.append({'key': js_trim(m.group(2)), 'start': m.start() + len(m.group(1)), 'from': m.end()})
    out: list[dict] = []
    seen: dict[str, int] = {}
    ws = _rx(r'\s+', 'g')
    for i, mark in enumerate(marks):
        if len(out) >= 25:
            break
        end = marks[i + 1]['start'] if i + 1 < len(marks) else len(s)
        val = js_trim(ws.sub(' ', s[mark['from']:end]))
        if not val or len(val) > 160 or not _rx('[A-Za-z0-9]').search(val):
            continue
        key = _rx(r'^_+|_+$', 'g').sub('', _rx('[^a-z0-9]+', 'g').sub('_', js_lower(mark['key'])))[:40]
        if not key or _has(seen, key):
            continue
        seen[key] = 1
        out.append({'k': key, 'v': val})
    return out


def _numbers(text: Any) -> list[dict]:
    """digestNumbers_: the numbers a document IS — certificate, licence, policy, card, record."""
    s = js_string(_or(text, ''))[:SCAN_CAP]
    out: list[dict] = []
    seen: dict[str, int] = {}
    year = _rx(r'^(19|20)\d{2}$')
    for m in _rx(r'\b(certificate|cert|licen[cs]e|policy|card|member|account|authentication|employee|badge|registry'
                 r'|dl|id)\b\s*(?:no\.?|number|#|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,20})\b', 'gi').finditer(s):
        if len(out) >= 8:
            break
        label = js_lower(m.group(1))
        value = js_upper(m.group(2))
        if year.search(value):
            continue
        key = label + ':' + value
        if _has(seen, key):
            continue
        seen[key] = 1
        out.append({'k': label, 'v': value})
    return out


def _issuer(text: Any, bk: dict) -> str:
    """digestIssuer_: who issued it — a known name, else the letterhead line that shouts."""
    s = js_string(_or(text, ''))[:4000]
    low = js_lower(s)
    for known in _issuers(bk):
        at = low.find(known)
        if at != -1:
            return s[at:at + len(known)]
    ws = _rx(r'\s+', 'g')
    for n, line in enumerate(_rx(r'\n+').split(s)):
        if n >= 6:
            break
        line = js_trim(ws.sub(' ', line))
        if len(line) < 4 or len(line) > 60:
            continue
        letters = _rx('[^A-Za-z]', 'g').sub('', line)
        if len(letters) >= 4 and letters == js_upper(letters):
            return line
    return ''


def _report_date(text: Any) -> str:
    """digestReportDate_: the date a report-date label names, read forward, the nearest one."""
    s = js_string(_or(text, ''))[:SCAN_CAP].replace('\r', '\n')
    best = None
    fwd_re = _rx(_FWD, 'i')
    for word in DIGEST_REPORT_DATE_WORDS:
        for m in _rx(r'\b' + word + r'\b', 'gi').finditer(s):
            end = m.start() + len(m.group(0))
            fwd = fwd_re.search(s[end:end + 48])
            if fwd:
                iso = _any_date(fwd.group(2))
                dist = len(fwd.group(1)) - (1 if ':' in fwd.group(1) else 0)
                if iso and (best is None or dist < best['dist']):
                    best = {'iso': iso, 'dist': dist}
    return best['iso'] if best else ''


def _paper(text: Any, name: Any, today: Any, bk: dict, roster: dict | None) -> dict:
    """digestPaperFromText_, over strings held as JavaScript holds them."""
    t = js_trim(_rx(r'\n{3,}', 'g').sub('\n\n', to_u16(js_string(_or(text, '')))))
    n = to_u16(js_string(_or(name, 'file')))
    out: dict[str, Any] = {'state': 'read' if t else 'empty', 'chars': len(t), 'kind': '', 'kind_score': 0,
                           'kind_alt': '', 'issued_on': '', 'expires_on': '', 'expires_source': '', 'how': {},
                           'level': '', 'grid': [], 'report_on': '', 'licence_dated': False,
                           'who': '', 'person_seen': '', 'facts': {}, 'v': VERSION}
    if not t:
        return out
    kind_got = _doc_kind(n, t, bk)
    if kind_got['kind'] != 'med_admin_cert' and len(_cert_grid(t)) >= 2:
        kind_got = {'kind': 'med_admin_cert', 'category': 'certification_training',
                    'alt': js_string(kind_got['kind']) + ':' + js_num_str(_or(kind_got.get('score'), 0)), 'score': 20}
    cat = _category(n, t, bk)
    doc_kind = _or(kind_got['kind'], '')
    chosen = _or(kind_got['category'], cat['category'])
    dates = _dates(n, t)
    secret = _redact(t, doc_kind)
    t = secret['text']
    roles = _date_roles(t)
    level = _med_level(t) if doc_kind == 'med_admin_cert' else ''
    grid = _cert_grid(t) if doc_kind == 'med_admin_cert' else []
    for row in grid:
        if row['status'] == 'certified' and row['expires'] > js_string(_or(roles['expires'], '')):
            roles['expires'] = row['expires']
            roles['issued'] = _or(roles['issued'], row['effective'])
            roles['how']['expires'] = 'grid'
    fin = _roles_finish(doc_kind, roles, dates, _or(today, ''), bk)
    pairs = _pairs(t)
    numbers = _numbers(t)
    for last4 in secret['ssn_last4']:
        numbers.append({'k': 'ssn_last4', 'v': last4})
    people = _roster(roster, bk)
    who_got = _who_is(t, n, people)
    who = who_got['id'] if who_got else ''
    seen = _or(_name_from_text(t, doc_kind, bk), '') or _name_from_pairs(pairs)
    if not who and seen:
        second = _who_is(seen, '', people)
        if second:
            who = second['id']
    out['kind'] = doc_kind
    out['kind_score'] = _or(kind_got.get('score'), 0)
    out['kind_alt'] = _or(kind_got.get('alt'), '')
    out['issued_on'] = fin['issued']
    out['expires_on'] = fin['expires']
    out['expires_source'] = fin['source']
    out['how'] = fin['how']
    out['level'] = level
    out['grid'] = grid
    out['report_on'] = _report_date(t)
    out['licence_dated'] = _rx(r'\blicen[sc]e\s+(?:issue|iss\b|expir|exp\b)', 'i').search(t) is not None
    out['who'] = who
    out['person_seen'] = seen or ''
    out['facts'] = {
        'doc_kind': doc_kind, 'category': chosen,
        'category_source': 'doc_kind' if _truthy(kind_got['category']) else cat['source'],
        'issued_on': fin['issued'], 'expires_on': fin['expires'], 'issuer': _issuer(t, bk),
        'dates': dates, 'pairs': pairs, 'numbers': numbers,
        'kind_score': _or(kind_got.get('score'), 0), 'chars': len(t),
    }
    return out


# ── the ledger lane's verdict (server/engine_verdict.py's runner over Digest.gs) ──────────────────────────────────

_INDEX = re.compile(r'(?:0|[1-9][0-9]*)\Z')


def _js_keys(d: dict) -> list:
    """for (k in obj): array-index keys first, ascending, then the rest as inserted."""
    idx = [k for k in d if isinstance(k, str) and _INDEX.match(k) and int(k) < 4294967295]
    if not idx:
        return list(d)
    return sorted(idx, key=int) + [k for k in d if k not in set(idx)]


def _json(v: Any) -> str:
    """JSON.stringify."""
    s = json.dumps(_out(v), ensure_ascii=False, separators=(',', ':'))
    return _SURROGATE.sub(lambda m: '\\u%04x' % ord(m.group(0)), s)


def _name_from_title(filename: Any) -> str:
    """digestNameFromTitle_: two or three capitalised words in the file's name; a name does not span a dash."""
    base = _rx(r'\(\d+\)', 'g').sub(' ', _rx(r'\.[a-z0-9]{2,5}$', 'i').sub('', js_string(_or(filename, '')), count=1))
    for part in _rx(r'[\-–—|]+').split(_rx('_+', 'g').sub(' ', base)):
        seg = js_trim(_rx(r'\s+', 'g').sub(' ', _rx(r'\d+', 'g').sub(' ', part)))
        if not seg:
            continue
        words = seg.split(' ')
        run: list[str] = []
        best: list[str] = []
        for i in range(len(words) + 1):
            w = words[i] if i < len(words) else ''
            clean = _rx("[^A-Za-z']", 'g').sub('', w)
            ok = (len(clean) > 1 and _rx('^[A-Z]').search(clean) is not None and
                  not _has(DIGEST_NAME_STOPWORDS, js_lower(clean)))
            if ok:
                run.append(clean)
            else:
                if len(run) >= 2 and len(run) > len(best):
                    best = run[:]
                run = []
        if len(best) >= 2:
            return ' '.join(best[:3])
    return ''


def _ids(text: Any) -> list[str]:
    """digestIds_: anchors are ids, never names."""
    s = js_string(text)[:SCAN_CAP]
    out: dict[str, int] = {}
    for m in _rx(r'\b(?:CL|USR|CAN|FRM|SUB)_[A-Za-z0-9]{4,24}\b', 'g').finditer(s):
        out[m.group(0)] = 1
    for m in _rx(r'\bDODD\s*(?:ID|#|No\.?|Number)?\s*[:\-]?\s*(\d{5,12})\b', 'gi').finditer(s):
        out['DODD:' + m.group(1)] = 1
    return list(out)[:12]


def _houses(roster: dict | None) -> list[dict]:
    """digestHouses_: the house codes and addresses of listRows_('istHouses')."""
    out: list[dict] = []
    try:
        for row in ((roster or {}).get('istHouses') or []):
            if not isinstance(row, dict):
                continue
            code = ''
            addr = ''
            for k in _js_keys(row):
                key = js_lower(to_u16(js_string(k)))
                val = to_u16(_str_(row[k]))
                if not val:
                    continue
                if (not code and _rx(r'(^|_)(house|code|house_code|id)$').search(key) and
                        _rx(r'^[A-Z]{2,3}\d{3,6}$').search(val)):
                    code = val
                if not addr and 'address' in key:
                    addr = val
            if not code:
                for k2 in _js_keys(row):
                    m2 = _rx(r'\b([A-Z]{2,3}\d{3,6})\b').search(to_u16(_str_(row[k2])))
                    if m2:
                        code = m2.group(1)
                        break
            if code:
                out.append({'code': code, 'addr': addr})
    except Exception:  # noqa: BLE001 — the registry is a lookup, never a requirement
        out = []
    return out


def _mentions(text: Any, filename: Any, subject_id: Any, people: list[dict], roster: dict | None) -> list[str]:
    """digestMentions_: what the file cites — as anchors, never names."""
    hay = ' ' + _rx('[^a-z0-9]+', 'g').sub(' ', js_lower(js_string(_or(filename, '')) + ' ' +
                                                         js_string(_or(text, ''))[:SCAN_CAP])) + ' '
    out: list[str] = []
    for house in _houses(roster):
        code = js_string(house['code'])
        digits = _rx('^[A-Za-z]+').sub('', code, count=1)
        by_code = (' ' + js_lower(code) + ' ') in hay
        by_addr = bool(digits) and _rx(r'\b' + digits + r'\s+\d{1,3}(st|nd|rd|th)\s+'
                                       r'(st|street|ave|avenue|rd|road|nw|ne|sw|se)\b').search(hay) is not None
        if (by_code or by_addr) and ('house:' + code) not in out:
            out.append('house:' + code)
    for r in people:
        if len(out) >= 12:
            break
        needle = ' ' + _rx('[^a-z0-9]+', 'g').sub(' ', r['name']) + ' '
        if needle not in hay:
            continue
        if r['id'] == subject_id:
            continue
        if r['id'] not in out:
            out.append(r['id'])
    return out[:12]


def _same_name(a: Any, b: Any) -> bool:
    """digestSameName_: two spellings of one person — case, punctuation and "Last, First" aside."""
    def norm(x: Any) -> str:
        low = _rx('[^a-z ]+', 'g').sub(' ', js_lower(js_string(_or(x, ''))))
        t = js_trim(_rx(r'\s+', 'g').sub(' ', low)).split(' ')
        t.sort()
        return ' '.join(t)
    na, nb = norm(a), norm(b)
    return bool(na) and na == nb


def _person_check(person: str, seen: str, people: list[dict]) -> dict:
    """digestPersonCheck_: the paper may correct the row — after a valid extraction."""
    if not seen:
        return {'person': person, 'who': '', 'agree': '', 'seen': ''}
    if not person:
        return {'person': seen, 'who': '', 'agree': '', 'seen': seen}
    if _same_name(person, seen):
        return {'person': person, 'who': '', 'agree': 'yes', 'seen': seen}
    known = _who_is(seen, '', people)
    if known:
        return {'person': _or(known['display'], seen), 'who': known['id'], 'agree': 'corrected', 'seen': seen}
    return {'person': person, 'who': '', 'agree': 'no', 'seen': seen}


def _subject(who: dict | None, person: str, doc_kind: str, text: Any, filename: Any) -> dict:
    """digestSubject_: what the file is about, as a type and a name."""
    if who:
        return {'type': who['kind'], 'subject': _or(_or(who['display'], person), '')}
    hay = js_string(_or(filename, '')) + ' ' + js_string(_or(text, ''))[:8000]
    house = _rx(r'\b([A-Z]{2,3}\d{3,6})\b').search(hay)
    if house and _has(DIGEST_HOUSE_KINDS, doc_kind):
        return {'type': 'house', 'subject': house.group(1)}
    if doc_kind == 'vehicle':
        vin = _rx(r'\b([A-HJ-NPR-Z0-9]{17})\b').search(hay)
        return {'type': 'vehicle', 'subject': vin.group(1) if vin else ''}
    if _has(DIGEST_COMPANY_KINDS, doc_kind):
        return {'type': 'company', 'subject': ''}
    if person and _has(DIGEST_PERSON_KINDS, doc_kind):
        return {'type': 'person', 'subject': person}
    if house:
        return {'type': 'house', 'subject': house.group(1)}
    return {'type': '', 'subject': ''}


def _expects(doc_kind: Any, bk: dict) -> dict | None:
    """digestExpects_: what to look for once you know what it is."""
    table = bk['expects'] if bk.get('expects') else DIGEST_EXPECTS
    k = js_string(_or(doc_kind, ''))
    for row in table:
        if row[0] == k:
            return {'must': row[1] if _truthy(row[1]) else [],
                    'may': (row[2] if len(row) > 2 and _truthy(row[2]) else [])}
    return None


def _missing(doc_kind: Any, facts: dict, bk: dict) -> list[str]:
    """digestMissing_: what this paper owed and did not give."""
    want = _expects(doc_kind, bk)
    if not want:
        return []
    out = []
    for f in want['must']:
        if f not in facts and f in _PROTO:
            continue
        if not js_trim(js_string(_or(facts.get(f), ''))):
            out.append(f)
    return out


def _program(text: Any) -> str:
    """digestProgram_: which DODD training a certificate of completion is for."""
    s = js_lower(js_string(_or(text, ''))[:4000])
    if _rx(r'8\s*[- ]?\s*hour\s+(?:\d{4}\s+)?annual\s+training|annual\s+training').search(s):
        return 'dodd_8hr'
    if _rx(r'training\s+for\s+new\s+direct\s+support|initial\s+training|initial\s+certification').search(s):
        return 'dodd_initial'
    return ''


def _confidence(f: dict, bk: dict) -> Any:
    """digestConfidence_: how sure the platform is — a count of what was found."""
    score: Any = 0
    chars = js_number(_or(f.get('chars'), 0))
    if chars >= 400:
        score += 30
    elif chars >= 80:
        score += 18
    elif chars > 0:
        score += 8
    if js_number(_or(f.get('kind_score'), 0)) >= 20:
        score += 8
    if _truthy(f.get('who')) and (f.get('person_source') in ('roster', 'ledger', 'document') or
                                  f.get('person_agree') == 'yes'):
        score += 5
    if _truthy(f.get('doc_kind')):
        score += 25
    if _truthy(f.get('category')) and f.get('category') != 'other':
        score += 15 if f.get('category_source') in ('drawer', 'doc_kind') else 8
    if _truthy(f.get('expires_on')) or _truthy(f.get('issued_on')):
        score += 12
    elif f.get('dates') is not None and len(f['dates']):
        score += 5
    if _truthy(f.get('who')):
        score += 10
    if f.get('numbers') is not None and len(f['numbers']):
        score += 5
    if f.get('pairs') is not None and len(f['pairs']) >= 3:
        score += 5
    if _truthy(f.get('issuer')):
        score += 3
    wants = _credential_for(f.get('doc_kind'), bk)
    if wants and wants['expires'] and not js_trim(js_string(_or(f.get('expires_on'), ''))):
        score = min(score, setting(bk, 'no_expiry_ceiling', 60, 0, 84))
    if _truthy(f.get('answers_yes')):
        score += min(12, 6 * js_number(f['answers_yes']))
    return max(0, min(100, score))


def _verdict(name: Any, text: Any, roster: dict | None, vocab: dict | None, clock: str) -> dict:
    """What server/engine_verdict.py's runner printed for one file's words, over strings held as JavaScript does."""
    bk = book(vocab) if vocab is not None else _book_or_seed(None)
    nm = to_u16(js_string(_or(name, '')))
    t = to_u16(js_string(_or(text, '')))
    kind = _doc_kind(nm, t, bk)
    secret = _redact(t, kind['kind'])
    t = secret['text']
    dates = _dates(nm, t)
    roles = _roles_finish(kind['kind'], _date_roles(t), dates, '', bk, clock)
    pairs = _pairs(t)
    people = _roster(roster, bk)
    who_got = _who_is(t, nm, people)
    who = who_got['id'] if who_got else ''
    person = _or(who_got['display'], '') if who_got else ''
    source = 'roster' if person else ''
    printed = None
    if not person:
        person = _or(_name_from_title(nm), '')
        source = 'title' if person else ''
    if not person:
        printed = _or(_or(_name_from_text(t, None, bk), _name_from_pairs(pairs)), '')
        person = printed
        source = 'field' if person else ''
    if (person and source == 'title' and not _has(DIGEST_PERSON_KINDS, kind['kind']) and
            js_lower(person) not in js_lower(t)):
        person = ''
        source = ''
    seen = printed if printed is not None else _or(_or(_name_from_text(t, None, bk), _name_from_pairs(pairs)), '')
    checked = _person_check(person, seen, people)
    if checked['agree'] == 'corrected':
        person = checked['person']
        who = checked['who']
        source = 'document'
    subject = _subject(who_got, person, kind['kind'], t, nm)
    issuer = _issuer(t, bk)
    numbers = _numbers(t)
    ids = _ids(t)
    if who:
        ids.insert(0, who)
    facts = {'doc_kind': kind['kind'], 'category': kind['category'], 'category_source': 'doc_kind',
             'issued_on': roles['issued'], 'expires_on': roles['expires'], 'issuer': issuer,
             'who': who, 'person': person, 'person_source': source, 'person_agree': _or(checked['agree'], ''),
             'dates': dates, 'pairs': pairs, 'numbers': numbers,
             'kind_score': _or(kind.get('score'), 0), 'chars': len(t)}
    confidence = _confidence(facts, bk)
    expired = ('yes' if roles['expires'] < clock else 'no') if roles['expires'] else ''
    v_name = vocab.get('__v') if isinstance(vocab, dict) else None
    return {
        'doc_kind': _or(kind['kind'], ''), 'digest_category': _or(kind['category'], 'other'),
        'digest_dates': _json(dates),
        'digest_names': _json(ids[:12]),
        'digest_text_chars': js_num_str(len(t)),
        'person': person, 'person_id': who,
        'subject_type': subject['type'], 'subject': subject['subject'],
        'person_seen': _or(checked['seen'], ''), 'person_agree': _or(checked['agree'], ''),
        'mentions': _json(_mentions(t, nm, who, people, roster)),
        'issued_on': roles['issued'], 'expires_on': roles['expires'],
        'confidence': js_num_str(confidence),
        'meta': {'confidence': confidence, 'category_source': 'doc_kind',
                 'doc_kind': kind['kind'], 'kind_score': _or(kind.get('score'), 0),
                 'kind_alt': _or(kind.get('alt'), ''),
                 'issuer': issuer, 'issued_on': roles['issued'], 'expires_on': roles['expires'],
                 'expired': expired, 'who': who, 'person_source': source,
                 'person_seen': _or(checked['seen'], ''), 'person_agree': _or(checked['agree'], ''),
                 'v': VERSION, 'vocab_v': _or(v_name, 'book') if vocab is not None else 'seed',
                 'vocab_from': 'book' if vocab is not None else 'seed',
                 'expires_source': _or(roles['source'], ''),
                 'date_how': roles['how'] if roles['how'] is not None else {},
                 'missing': _missing(kind['kind'], {'person': person, 'expires_on': roles['expires'],
                                                    'issued_on': roles['issued'], 'born_on': roles['born'],
                                                    'issuer': issuer, 'number': 'yes' if numbers else ''}, bk),
                 'born_on': _or(roles['born'], ''),
                 'level': _med_level(t) if kind['kind'] == 'med_admin_cert' else '',
                 'program': _program(t) if kind['kind'] == 'dodd_certification' else '',
                 'ssn_last4': secret['ssn_last4'],
                 'pairs': pairs, 'numbers': numbers, 'lane': 'python'},
    }


# ── the public doors ──────────────────────────────────────────────────────────────────────────────────────────────

def paper_from_text(text: str, name: str, today: str, book: dict | None, roster: dict | None = None) -> dict:
    """digestPaperFromText_: the reading of a paper's words — pure over the text, the name, the day and the book."""
    return _out(_paper(text, name, today, _book_or_seed(book), roster))


def verdict(name: str, text: str, roster: dict | None = None, vocab_rows: dict | None = None,
            today_utc: str | None = None) -> dict:
    """The ledger lane's verdict on one file's words, exactly as server/engine_verdict.py's runner over Digest.gs
    printed it: the words book is the rows handed in (else the seed tables), the roster answers listRows_, and
    `today_utc` (YYYY-MM-DD) is the day new Date() would have said in UTC."""
    vocab = vocab_rows if _truthy(vocab_rows) else None
    clock = js_string(today_utc) if today_utc else _utc_today()
    return _out(_verdict(name, text, roster or {}, vocab, clock))


def kinds(book: dict | None) -> list:
    """digestKinds_."""
    return _out(_kinds(_book_or_seed(book)))


def redact(text: str, doc_kind: str, book: dict | None = None) -> dict:
    """digestRedact_ (the book plays no part in it)."""
    return _out(_redact(to_u16(js_string(_or(text, ''))), doc_kind))


def check_result(text: str, book: dict | None = None) -> dict:
    """digestCheckResult_ (the book plays no part in it)."""
    return _out(_check_result(to_u16(js_string(_or(text, '')))))


def credential_for(kind: str, book: dict | None) -> dict | None:
    """digestCredentialFor_: the obligation row for a decoded kind, or None — never a guess."""
    return _out(_credential_for(kind, _book_or_seed(book)))


def cert_reading(text: str, name: str, today: str, expect: list[str] | None, vocab_rows: dict | None,
                 roster: dict | None) -> dict:
    """The certificate lane's reading: digestPaperFromText_ under certReadVocab_, and the book's dials it needs."""
    bk = cert_book(book(vocab_rows), expect or [])
    p = _paper(_or(text, ''), _or(name, 'file'), _or(today, ''), bk, roster)
    wants = _credential_for(p['kind'], bk)
    f = p['facts'] or {}

    def count(v: Any) -> int:
        return len(v) if isinstance(v, list) else 0

    return _out({
        'paper': {'state': p['state'], 'chars': p['chars'], 'kind': p['kind'], 'kind_score': p['kind_score'],
                  'kind_alt': p['kind_alt'], 'issued_on': p['issued_on'], 'expires_on': p['expires_on'],
                  'expires_source': p['expires_source'], 'how': p['how'] or {}, 'level': p['level'],
                  'grid': p['grid'] or [], 'report_on': p['report_on'], 'licence_dated': p['licence_dated'] is True,
                  'who': p['who'], 'v': p['v'],
                  'facts': {'doc_kind': _or(f.get('doc_kind'), ''), 'category': _or(f.get('category'), ''),
                            'category_source': _or(f.get('category_source'), ''),
                            'issuer': 1 if _truthy(f.get('issuer')) else 0, 'dates': count(f.get('dates')),
                            'pairs': count(f.get('pairs')), 'numbers': count(f.get('numbers')),
                            'kind_score': _or(f.get('kind_score'), 0), 'chars': _or(f.get('chars'), 0)}},
        'wants_expiry': bool(wants and wants['expires']),
        'no_expiry_ceiling': setting(bk, 'no_expiry_ceiling', 60, 0, 84),
        'floor': setting(bk, 'distribute_confidence', 85, 50, 100),
        'v': VERSION,
    })
