"""Image library thumbnails under thumbs/. Run:  python tools/make_thumbs.py <library-dir> [--force]"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageOps

MAX_EDGE = 480
QUALITY = 78
SOURCE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def is_source(path: Path, thumbs: Path) -> bool:
    if thumbs in path.parents:
        return False
    # some library files are literally named "x.jpeg (no extension)"
    return path.is_file() and (
        path.suffix.lower() in SOURCE_SUFFIXES or "(no extension)" in path.name
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = Path(sys.argv[1])
    force = "--force" in sys.argv
    thumbs = root / "thumbs"

    made = skipped = failed = 0
    saved_before = saved_after = 0

    for src in sorted(root.rglob("*")):
        if not is_source(src, thumbs):
            continue
        out = thumbs / src.relative_to(root).with_suffix(".webp")
        if out.exists() and not force and out.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        try:
            with Image.open(src) as im:
                im = ImageOps.exif_transpose(im)
                im.thumbnail((MAX_EDGE, MAX_EDGE))
                out.parent.mkdir(parents=True, exist_ok=True)
                im.convert("RGB").save(out, "WEBP", quality=QUALITY, method=4)
            saved_before += src.stat().st_size
            saved_after += out.stat().st_size
            made += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {src.relative_to(root)}: {exc}")
            failed += 1

    mb = 1024 * 1024
    print(f"thumbs: {made} made, {skipped} already current, {failed} unreadable")
    if made:
        print(f"        {saved_before / mb:.1f} MB → {saved_after / mb:.1f} MB "
              f"({saved_after / saved_before * 100:.1f}% of the originals)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
