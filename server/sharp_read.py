#!/usr/bin/env python3
"""THE BETTER EYE — deterministic, and only possible on this side.
THE QUESTION: what can Python do aggressively that Apps Script cannot."""
from __future__ import annotations

import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("hub.sharpread")

BUDGET_S = float(os.getenv("HUB_SHARP_BUDGET_S", "20"))
MARGIN = int(os.getenv("HUB_SHARP_MARGIN", "6"))   # clearly better, not a hair
MIN_SIDE = 1600          # below this a card is upscaled before anything else
MAX_SIDE = 4200          # above this Tesseract slows with nothing to show

# ── the words this platform already looks for ─────────────────────────────── Harvested from the engine's own file…
_VOCAB: dict[str, Any] | None = None
_VOCAB_FLOOR = {
    "labels": ["expiration date", "expires", "issue date", "issued", "renew by",
               "class completion date", "date completed", "valid until",
               "effective", "date of birth", "dob", "exp", "iss",
               "name", "certificate", "license", "licence", "registry no",
               "training center", "policy number", "social security",
               "certification", "completion"],
}


# the engine's words cut to plain words: a written \\s+ (two backslashes; the words hold one, so it never matches)
# becomes a space, then every \ ( ) ? : [ ] | goes
_WORD_SPACE = re.compile(r"\\\\s\+")
_WORD_MARKS = re.compile(r"[\\\\()?:\[\]|]")


def _vocab() -> dict[str, Any]:
    """The engine's own label words — its date-role and name-label words (digest_engine, the decoder in Python)."""
    global _VOCAB
    if _VOCAB is not None:
        return _VOCAB
    _VOCAB = {"labels": list(_VOCAB_FLOOR["labels"])}
    try:
        import digest_engine as DE  # noqa: PLC0415 — the decoder, loaded with the reader
        out: dict[str, None] = {}
        for k in DE.DIGEST_DATE_ROLE_WORDS:
            for w in DE.DIGEST_DATE_ROLE_WORDS[k]:
                out[DE.js_trim(_WORD_MARKS.sub("", _WORD_SPACE.sub(" ", str(w))))] = None
        for label in DE.DIGEST_NAME_LABELS:
            out[DE.js_trim(_WORD_MARKS.sub("", _WORD_SPACE.sub(" ", str(label))))] = None
        words = [w for w in out if len(w) > 2]
        _VOCAB["labels"] = sorted({w.lower() for w in words} | set(_VOCAB_FLOOR["labels"]))
        log.info("sharp_read: %d label words from the engine", len(_VOCAB["labels"]))
    except Exception as exc:  # noqa: BLE001 — the floor list still scores
        log.warning("sharp_read: engine vocabulary unreadable (%.90s)", str(exc))
    return _VOCAB


_DATE = re.compile(r"\b\d{1,2}[/\-.]\d{1,2}[/\-.](?:19|20)?\d{2}\b"
                   r"|\b\d{1,2}[/\-.](?:19|20)\d{2}\b"
                   r"|\b[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+(?:19|20)\d{2}\b")


def score(text: str) -> int:
    """HOW MUCH OF WHAT A PAPER SHOULD SAY IS IN THIS READING."""
    t = (text or "").lower()
    if not t.strip():
        return 0
    hits = sum(2 for w in _vocab()["labels"] if w in t)
    hits += 3 * min(8, len(set(_DATE.findall(text or ""))))
    letters = sum(1 for ch in t if ch.isalnum() or ch.isspace())
    clean = letters / max(1, len(t))
    if clean < 0.75:
        hits = int(hits * 0.5)          # a page of speckle is not a reading
    return hits


# ── the passes, each a fixed transform ──────────────────────────────────────
def _prep(img, how: str):
    import cv2
    import numpy as np

    def gray(a):
        return cv2.cvtColor(a, cv2.COLOR_BGR2GRAY) if a.ndim == 3 else a

    if how == "plain":
        return img
    if how == "big":
        h, w = img.shape[:2]
        f = min(3.0, max(1.0, MIN_SIDE / max(1, min(h, w))))
        if f <= 1.01:
            return None                  # already big: this pass adds nothing
        return cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_LANCZOS4)
    if how == "flat":
        g = gray(img)
        g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)
        return cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                     cv2.THRESH_BINARY, 31, 15)
    if how == "deskew":
        g = gray(img)
        inv = cv2.bitwise_not(g)
        _, bw = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        pts = cv2.findNonZero(bw)
        if pts is None or len(pts) < 50:
            return None
        angle = cv2.minAreaRect(pts)[-1]
        angle = angle + 90 if angle < -45 else angle
        if abs(angle) < 0.4 or abs(angle) > 30:
            return None                  # already straight, or not text at all
        h, w = g.shape[:2]
        m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC,
                              borderMode=cv2.BORDER_REPLICATE)
    if how == "card":
        # A CARD PHOTOGRAPHED ON A TABLE is a quadrilateral in a picture of a table.
        g = gray(img)
        g = cv2.GaussianBlur(g, (5, 5), 0)
        edges = cv2.Canny(g, 40, 140)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
        cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return None
        page = img.shape[0] * img.shape[1]
        best = None
        for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:6]:
            area = cv2.contourArea(c)
            if area < page * 0.18 or area > page * 0.97:
                continue
            quad = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
            if len(quad) == 4:
                best = quad.reshape(4, 2).astype("float32")
                break
        if best is None:
            return None
        s = best.sum(axis=1)
        d = np.diff(best, axis=1)
        src = np.array([best[np.argmin(s)], best[np.argmin(d)],
                        best[np.argmax(s)], best[np.argmax(d)]], dtype="float32")
        wA = np.linalg.norm(src[2] - src[3])
        wB = np.linalg.norm(src[1] - src[0])
        hA = np.linalg.norm(src[1] - src[2])
        hB = np.linalg.norm(src[0] - src[3])
        W, H = int(max(wA, wB)), int(max(hA, hB))
        if W < 300 or H < 200:
            return None
        f = min(3.0, max(1.0, MIN_SIDE / max(1, min(W, H))))
        W, H = min(MAX_SIDE, int(W * f)), min(MAX_SIDE, int(H * f))
        dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], dtype="float32")
        return cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (W, H))
    return None


PASSES = ["plain", "big", "flat", "card", "deskew"]
PSMS = ["--oem 3 --psm 6", "--oem 3 --psm 4", "--oem 3 --psm 11"]


def _load(path: str):
    import cv2
    import numpy as np
    data = np.fromfile(path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        # OpenCV DOES NOT KNOW HEIC.
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
            from PIL import Image, ImageOps
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                img = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
        except Exception as exc:  # noqa: BLE001 — an unreadable image is a verdict
            log.debug("sharp_read: %s not decodable (%.60s)", path, str(exc))
            return None
    if img is None:
        return None
    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:                     # a 12MP photo is 12MP of grain
        f = MAX_SIDE / max(h, w)
        img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    return img


def wants_for(missing: list[str]) -> list[Any]:
    """WHAT A PASS MUST FIND FOR THE SPENDING TO HAVE BEEN WORTH IT."""
    out = []
    for m in missing or []:
        if m == "expires_on":
            out.append(re.compile(r"(expir\w*|renew\s+by|valid\s+(?:until|through|thru))"
                                  r"[^0-9A-Za-z]{0,16}\d|\d[^0-9A-Za-z]{0,16}(expir\w*|renew\s+by)", re.I))
        elif m == "issued_on":
            out.append(re.compile(r"(issue\w*|completion|completed|effective)"
                                  r"[^0-9A-Za-z]{0,16}\d|\d[^0-9A-Za-z]{0,16}(issue\w*|completion)", re.I))
        elif m == "born_on":
            out.append(re.compile(r"(d\.?o\.?b\.?|date\s+of\s+birth)[^0-9A-Za-z]{0,16}\d", re.I))
        elif m == "person":
            out.append(re.compile(r"[A-Z][a-z]+\s+[A-Z][a-z]+"))
        elif m == "number":
            out.append(re.compile(r"\b[A-Z0-9]{5,}\b"))
    return out


def read_image(path: str, floor_text: str = "", wants: list[Any] | None = None) -> dict[str, Any]:
    """Every pass, in order, until one FINDS WHAT WAS MISSING or the budget is spent."""
    """(cont.) THE STOP RULE IS A MARGIN, NOT A GUESS AT THE ANSWER. The first
    cut asked each pass whether it carried an expiry label beside a date, and
    on JaVon's card the pass that DID produce both dates answered no — the
    words sit three lines apart. A proxy for the verdict is not the verdict.
    So the cheap rule here is only "clearly better than what we already had",
    by MARGIN points, and the expensive, exact judgement — did this actually
    fill a hole — is made once, afterwards, by the decoder itself.
    """
    floor_score = score(floor_text or "")
    def pays(t: str, sc: int) -> bool:
        if sc < floor_score + MARGIN:
            return False
        return not wants or all(w.search(t or "") for w in wants)

    began = time.monotonic()
    best = {"text": floor_text or "", "pass": "floor",
            "score": score(floor_text or ""), "psm": "", "paid": False}
    tried = [{"pass": "floor", "score": best["score"], "chars": len(best["text"])}]
    try:
        import pytesseract
        from PIL import Image
    except Exception as exc:  # noqa: BLE001
        log.warning("sharp_read: no tesseract (%.60s)", str(exc))
        best["tried"] = tried
        return best
    img = _load(path)
    if img is None:
        best["tried"] = tried
        return best
    import cv2
    for how in PASSES:
        if time.monotonic() - began > BUDGET_S or best.get("paid"):
            break
        try:
            prepared = _prep(img, how)
        except Exception as exc:  # noqa: BLE001 — a pass that throws is a pass that is skipped
            log.debug("sharp_read: %s failed (%.60s)", how, str(exc))
            continue
        if prepared is None:
            continue
        rgb = cv2.cvtColor(prepared, cv2.COLOR_GRAY2RGB) if prepared.ndim == 2 \
            else cv2.cvtColor(prepared, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        for psm in PSMS:
            if time.monotonic() - began > BUDGET_S:
                break
            try:
                got = pytesseract.image_to_string(pil, config=psm) or ""
            except Exception as exc:  # noqa: BLE001
                log.debug("sharp_read: tesseract %s/%s failed (%.60s)", how, psm, str(exc))
                continue
            sc = score(got)
            paid = pays(got, sc)
            tried.append({"pass": how, "psm": psm[-1], "score": sc,
                          "chars": len(got), "paid": paid})
            if paid or sc > best["score"]:
                best = {"text": got, "pass": how, "score": sc,
                        "psm": psm[-1], "paid": paid}
            if paid:
                break
    best["tried"] = tried
    best["seconds"] = round(time.monotonic() - began, 1)
    return best


def read_pdf_page_images(path: str, floor_text: str = "", pages: int = 3,
                         wants: list[Any] | None = None) -> dict[str, Any]:
    """A PDF that is a PHOTOGRAPH of paper carries no text layer at all."""
    began = time.monotonic()
    best = {"text": floor_text or "", "pass": "floor",
            "score": score(floor_text or ""), "psm": "", "tried": []}
    try:
        import pdf_gate
    except Exception:  # noqa: BLE001
        return best
    out = []
 # THROUGH THE GATE: MuPDF is not thread-safe across documents and this estate opens PDFs from ten modules.
    try:
        ctx = pdf_gate.pdf_document(path)
    except Exception:  # noqa: BLE001
        return best
    with ctx as doc:
        for n in range(min(pages, doc.page_count)):
            if time.monotonic() - began > BUDGET_S:
                break
            pix = doc.load_page(n).get_pixmap(dpi=300)
            tmp = f"/tmp/sharp_p{n}_{os.getpid()}.png"
            pix.save(tmp)
            try:
                got = read_image(tmp, "", wants)
                out.append(got["text"])
                best["tried"] += [dict(t, page=n + 1) for t in got.get("tried", [])]
            finally:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
    joined = "\n".join(t for t in out if t).strip()
    if score(joined) > best["score"]:
        best.update({"text": joined, "pass": "rendered", "score": score(joined)})
    best["seconds"] = round(time.monotonic() - began, 1)
    return best


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    for path in sys.argv[1:]:
        low = path.lower()
        got = read_pdf_page_images(path) if low.endswith(".pdf") else read_image(path)
        print(f"\n=== {Path(path).name}")
        for t in got.get("tried", []):
            print(f"    {t.get('pass','?'):<8} psm {t.get('psm','-')}  "
                  f"score {t.get('score',0):>4}  {t.get('chars',0):>6} chars")
        print(f"  WINNER: {got['pass']} psm {got.get('psm','-')} "
              f"score {got['score']} in {got.get('seconds','?')}s")
        print("  " + (got["text"] or "")[:400].replace("\n", "\n  "))


if __name__ == "__main__":
    main()
