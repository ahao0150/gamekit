#!/usr/bin/env python3
"""Estimate nine-slice margins from RGBA alpha (corner solid start).
Writes mini-game-ui-v1 JSON. Manual override via --left/--top/--right/--bottom.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
from PIL import Image

def first_opaque_row(a, y0, y1, step, thresh=8):
    h, w = a.shape
    for y in range(y0, y1, step):
        if int(a[y].max()) >= thresh:
            return y
    return y0

def first_opaque_col(a, x0, x1, step, thresh=8):
    for x in range(x0, x1, step):
        if int(a[:, x].max()) >= thresh:
            return x
    return x0

def estimate(im: Image.Image):
    import numpy as np
    rgba = im.convert('RGBA')
    a = np.array(rgba)[:, :, 3]
    h, w = a.shape
    # bounding box of opaque
    ys, xs = (a >= 8).nonzero()
    if len(xs) == 0:
        return {'left': 0, 'top': 0, 'right': 0, 'bottom': 0}, (w, h)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    # inset from content bbox toward center until alpha profile flattens on edge strip
    # heuristic: 12% of min side, clamp 24..min(120, min(w,h)//3)
    base = max(24, min(120, min(w, h) // 5))
    L = min(base, (x1 - x0) // 3)
    R = L
    T = min(base, (y1 - y0) // 3)
    B = T
    return {'left': L, 'top': T, 'right': R, 'bottom': B}, (w, h)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('png')
    ap.add_argument('-o', '--out-json')
    ap.add_argument('--name', default=None)
    ap.add_argument('--left', type=int); ap.add_argument('--top', type=int)
    ap.add_argument('--right', type=int); ap.add_argument('--bottom', type=int)
    ap.add_argument('--passed', action='store_true')
    args = ap.parse_args()
    path = Path(args.png)
    im = Image.open(path)
    ns, (w, h) = estimate(im)
    for k in ('left', 'top', 'right', 'bottom'):
        v = getattr(args, k)
        if v is not None:
            ns[k] = v
    name = args.name or path.stem
    meta = {
        'schema': 'mini-game-ui-v1',
        'name': name,
        'asset': path.name,
        'imageSize': {'width': w, 'height': h},
        'nineSlice': ns,
        'measure': {
            'method': 'alpha-bbox-heuristic(+optional manual)',
            'passed': bool(args.passed),
        },
        'gamekitKey': f'ui/{name}' if not name.startswith('ui/') else name,
        'draw': 'nineSlice',
    }
    out = Path(args.out_json) if args.out_json else path.with_suffix('.json')
    out.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(meta, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
