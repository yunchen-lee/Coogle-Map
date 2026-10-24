import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / 'output'
KEEP = ['type', 'name', 'lon', 'lat', 'year', 'cuisine', 'category']

cells = {c['id']: c for c in json.loads((OUT / 'cells.json').read_text(encoding='utf-8'))}
comments = {}
for line in (OUT / 'comments.jsonl').read_text(encoding='utf-8').splitlines():
    if line.strip():
        r = json.loads(line)
        comments[r['id']] = r['comments']

pigeons = []
for cid, cs in comments.items():
    c = cells[cid]
    used = {u for x in cs for u in x['uses']}
    pigeons.append({
        'id': cid,
        'lon': c['lon'],
        'lat': c['lat'],
        'count': c['count'],
        'comments': [{'text': x['text'], 'persona': x['persona'], 'uses': x['uses']} for x in cs],
        'features': {f['fid']: {k: f[k] for k in KEEP if k in f} for f in c['features'] if f['fid'] in used},
    })

(ROOT / 'data' / 'pigeons.json').write_text(json.dumps(pigeons, ensure_ascii=False), encoding='utf-8')
print(f'{len(pigeons)} cells, {sum(len(p["comments"]) for p in pigeons)} comments')
