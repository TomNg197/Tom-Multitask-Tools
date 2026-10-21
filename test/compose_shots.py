# /usr/bin/python3 test/compose_shots.py (needs Pillow) <dir>: paste each <scene>.view.png into <scene>.ui.png at the view bounds -> <scene>.png
import json, os, sys
from PIL import Image
d = sys.argv[1]
shots = json.load(open(os.path.join(d, 'shots.json')))
for name, b in shots.items():
    img = Image.open(os.path.join(d, name + '.ui.png')).convert('RGB')
    if b:
        v = Image.open(os.path.join(d, name + '.view.png')).convert('RGB')
        sx = img.width / 1320.0   # capturePage is in device pixels; content size is 1320 wide
        v = v.resize((round(b['width'] * sx), round(b['height'] * sx)))
        img.paste(v, (round(b['x'] * sx), round(b['y'] * sx)))
    img.save(os.path.join(d, name + '.png'))
    for ext in ('.ui.png', '.view.png'):
        try: os.remove(os.path.join(d, name + ext))
        except FileNotFoundError: pass
print('composed', len(shots))
