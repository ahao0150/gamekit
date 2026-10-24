#!/usr/bin/env python3
import argparse, json
from pathlib import Path
from PIL import Image
ap = argparse.ArgumentParser()
ap.add_argument('png'); ap.add_argument('-o'); ap.add_argument('--name')
ap.add_argument('--cap', type=int, default=63); ap.add_argument('--mid', type=int, default=8)
ap.add_argument('--passed', action='store_true')
a = ap.parse_args()
p = Path(a.png); im = Image.open(p); w, h = im.size
name = a.name or p.stem
ok = (w, h) == (336, 126)
meta = {
  'schema': 'mini-game-ui-v1',
  'name': name,
  'asset': p.name,
  'imageSize': {'width': w, 'height': h},
  'capsule': {'w': 336, 'h': 126, 'cap': a.cap, 'mid': a.mid},
  'measure': {
    'method': 'size-check-vs-DEFAULT_CAPSULE',
    'passed': bool(a.passed and ok),
    'sizeMatch': ok,
  },
  'gamekitKey': f'ui/{name}',
  'draw': 'capsule',
}
out = Path(a.o) if a.o else p.with_suffix('.json')
out.write_text(json.dumps(meta, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(meta, indent=2)); raise SystemExit(0 if ok else 1)
