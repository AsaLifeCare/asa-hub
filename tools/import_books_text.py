"""Harvest every book source into the books_text tab; runs inside asa-hub-snapshot."""
import json, os, re, sys, urllib.request, urllib.parse

import httpx
import fitz  # PyMuPDF

HUB_DB = '1SGC3fDFJsraqLXzHgUGRARe5n_IkguyBsTD4bze36ts'
TOKEN = os.environ['GS_TOKEN']
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

def sheets(method, path, body=None):
    req = urllib.request.Request(
        'https://sheets.googleapis.com/v4/spreadsheets/' + HUB_DB + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'},
        method=method)
    return json.load(urllib.request.urlopen(req))

def strip_html(html):
    s = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<nav[\s\S]*?</nav>'
               r'|<header[\s\S]*?</header>|<footer[\s\S]*?</footer>|<aside[\s\S]*?</aside>'
               r'|<!--[\s\S]*?-->', ' ', html, flags=re.I)
    # JATS XML: tables, reference lists and xref citation markers are noise as prose.
    s = re.sub(r'<table-wrap[\s\S]*?</table-wrap>|<ref-list[\s\S]*?</ref-list>'
               r'|<xref[\s\S]*?</xref>', ' ', s, flags=re.I)
    s = re.sub(r'</(p|div|h[1-6]|li|tr|blockquote|section|article|sec|title|abstract)>', '\n\n', s, flags=re.I)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    for a, b in [('&nbsp;', ' '), ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                 ('&quot;', '"'), ('&#39;', "'"), ('&rsquo;', "'"), ('&ldquo;', '"'), ('&rdquo;', '"')]:
        s = s.replace(a, b)
    return re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), s)

def paragraphs(text):
    t = text.replace('\r', '')
    parts = re.split(r'\n{2,}', t)
    if len(parts) < 4 and len(t) > 4000:
        out, cur = [], ''
        for ln in t.split('\n'):
            ln = ln.strip()
            if not ln:
                if cur: out.append(cur); cur = ''
                continue
            cur = (cur + ' ' + ln).strip()
            if re.search(r'[.!?:]$', ln) and len(cur) > 300:
                out.append(cur); cur = ''
        if cur: out.append(cur)
        parts = out
    res, total = [], 0
    for p in parts:
        p = re.sub(r'\s+', ' ', p).strip()
        if len(p) < 3: continue
        p = p[:2000]
        total += len(p)
        res.append(p)
        if total > 120000 or len(res) >= 600:
            res.append('… (the text continues at the source)')
            break
    return res

def fetch(url):
    with httpx.Client(follow_redirects=True, timeout=60.0,
                      headers={'User-Agent': UA, 'Accept': '*/*',
                               'Accept-Language': 'en-US,en;q=0.9'}) as c:
        r = c.get(url)
        r.raise_for_status()
        return r

def harvest_one(url):
    r = fetch(url)
    ctype = r.headers.get('content-type', '').lower()
    if 'pdf' in ctype or url.lower().endswith('.pdf'):
        doc = fitz.open(stream=r.content, filetype='pdf')
        text = '\n\n'.join(page.get_text() for page in doc)
        doc.close()
        return paragraphs(text), 'pdf'
    return paragraphs(strip_html(r.text)), 'page'

def harvest(url, home=''):
    # The source, then the landing page; never an external reader proxy.
    tries = [u for u in [url, home if home != url else ''] if u]
    last = None
    for u in tries:
        try:
            paras, via = harvest_one(u)
            if len(paras) >= 3:
                return paras, via
            last = RuntimeError('only %d paragraphs' % len(paras))
        except Exception as e:
            last = e
    raise last if last else RuntimeError('no source to try')

def main():
    # A book with >=3 stored rows is never touched: some were printed by hand and cannot be re-fetched.
    have = {}
    try:
        got = sheets('GET', '/values/' + urllib.parse.quote('books_text!A1:A100000'))
        for r in got.get('values', [])[1:]:
            if r and r[0]:
                have[r[0]] = have.get(r[0], 0) + 1
    except Exception:
        pass
    grid = sheets('GET', '/values/' + urllib.parse.quote('books!A1:Z400'))
    rows = grid.get('values', [])
    hdr = rows[0]
    idx = {h: i for i, h in enumerate(hdr)}
    out_rows = []
    ok = fail = skipped = 0
    for row in rows[1:]:
        def cell(name):
            i = idx.get(name)
            return row[i] if i is not None and i < len(row) else ''
        bid, title = cell('id'), cell('title')
        url = cell('source') or cell('home')
        if not bid or not url: continue
        if have.get(bid, 0) >= 3:
            skipped += 1
            continue
        if have.get(bid, 0):
            print(f'  SKIP {title[:60]} — {have[bid]} partial rows present; clear them first')
            skipped += 1
            continue
        try:
            paras, via = harvest(url, cell('home'))
            if not paras: raise RuntimeError('no readable text')
            for n, p in enumerate(paras):
                out_rows.append([bid, title, via, str(n), p[:8000]])
            ok += 1
            print(f'  OK  {title[:60]} — {len(paras)} paragraphs ({via})')
        except Exception as e:
            fail += 1
            print(f'  FAIL {title[:60]} — {str(e)[:90]}')
    # Append only: never clear, never rewrite.
    meta = sheets('GET', '?fields=sheets.properties.title')
    titles = [sh['properties']['title'] for sh in meta['sheets']]
    if 'books_text' not in titles:
        sheets('POST', ':batchUpdate', {'requests': [{'addSheet': {'properties': {'title': 'books_text'}}}]})
        sheets('PUT', '/values/' + urllib.parse.quote('books_text!A1') + '?valueInputOption=RAW',
               {'values': [['bookId', 'title', 'via', 'ord', 'text']]})
    if out_rows:
        sheets('POST', '/values/' + urllib.parse.quote('books_text!A1') + ':append?valueInputOption=RAW',
               {'values': out_rows})
    print(f'DONE: {ok} harvested, {fail} failed, {skipped} already stored, {len(out_rows)} paragraph rows appended')

if __name__ == '__main__':
    main()
