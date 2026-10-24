import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[2] / '2026_1018_p5_pigeonMap' / 'data'
OUT = Path(__file__).resolve().parent / 'output'
CELL = 150
RADIUS = 100
PARK_RADIUS = 200
SAME_PLACE = 50
SAMPLES = 3
MAX_COMMENTS = 20
SEED = 1
LON0, LAT0 = -73.97, 40.78
MX = 111320 * np.cos(np.radians(LAT0))
MY = 110540
SEASONS = {12: 'winter', 1: 'winter', 2: 'winter', 3: 'spring', 4: 'spring', 5: 'spring',
           6: 'summer', 7: 'summer', 8: 'summer', 9: 'fall', 10: 'fall', 11: 'fall'}


def to_grid(df):
    df['x'] = (df.lon - LON0) * MX
    df['y'] = (df.lat - LAT0) * MY
    df['gx'] = np.floor(df.x / CELL).astype(int)
    df['gy'] = np.floor(df.y / CELL).astype(int)
    return df


def norm(s):
    return s.str.lower().str.replace(r'[^a-z0-9]', '', regex=True)


def merge_same_point(df):
    g = df.groupby(['lon', 'lat'], sort=False)
    out = g.first()
    out['names'] = g['name'].agg(lambda s: list(dict.fromkeys(s.dropna())))
    out['name'] = out.names.map(lambda n: ' / '.join(n) if n else None)
    return out.reset_index()


def drop_same_name(df, ref):
    a = df[df.name.notna()].assign(key=norm(df.name)).reset_index()
    b = ref.assign(key=norm(ref.name))[['key', 'lon', 'lat']]
    m = a.merge(b, on='key', suffixes=('', '_r'))
    d = np.hypot((m.lon - m.lon_r) * MX, (m.lat - m.lat_r) * MY)
    return df.drop(index=m.loc[d < SAME_PLACE, 'index'].unique())


def load_complaints():
    cols = ['unique_key', 'created_date', 'descriptor', 'location_type', 'street_name',
            'borough', 'latitude', 'longitude']
    df = pd.concat([pd.read_csv(DATA / f, usecols=cols) for f in ['311_2020.csv', '311_2020-present.csv']])
    df = df[df.borough == 'MANHATTAN'].dropna(subset=['latitude', 'longitude'])
    df = df.drop_duplicates('unique_key').rename(columns={'latitude': 'lat', 'longitude': 'lon'})
    df['date'] = pd.to_datetime(df.created_date)
    return to_grid(df)


def load_features():
    raw = DATA / 'raw'
    out = {}

    df = pd.read_csv(raw / 'restaurants.csv')
    df = df[df.boro == 'Manhattan'].dropna(subset=['latitude'])
    out['restaurant'] = merge_same_point(pd.DataFrame({'name': df.dba.str.title(), 'detail': df.cuisine_description,
                                                       'lon': df.longitude, 'lat': df.latitude}))

    df = pd.read_csv(raw / 'litter_baskets.csv')
    df = df[df.borough == 'MANHATTAN'].dropna(subset=['latitude'])
    out['litter_basket'] = pd.DataFrame({'name': df.streetname1.str.title() + ' & ' + df.streetname2.str.title(),
                                         'detail': df.baskettype, 'lon': df.longitude, 'lat': df.latitude})

    df = pd.read_csv(raw / 'buildings_pluto.csv')
    df = df[df.borough == 'MN'].dropna(subset=['latitude'])
    out['building'] = pd.DataFrame({'name': '', 'detail': df.bldgclass, 'year': df.yearbuilt,
                                    'floors': df.numfloors, 'histdist': df.histdist, 'landmark': df.landmark,
                                    'lon': df.longitude, 'lat': df.latitude})

    df = pd.read_csv(raw / 'parks.csv')
    df = df[df.borough == 'M'].dropna(subset=['multipolygon'])
    rows = []
    for _, p in df.iterrows():
        for lon, lat in re.findall(r'(-?\d+\.\d+) (-?\d+\.\d+)', p.multipolygon):
            rows.append((p.signname, p.typecategory, float(lon), float(lat)))
    out['park'] = pd.DataFrame(rows, columns=['name', 'detail', 'lon', 'lat'])

    df = pd.read_csv(raw / 'osm_places.csv')
    df = df[(df.longitude > -74.03) & (df.longitude < -73.90) & (df.latitude > 40.68) & (df.latitude < 40.89)]
    osm = drop_same_name(pd.DataFrame({'name': df.name, 'detail': df.subcategory, 'cuisine': df.cuisine,
                                       'lon': df.longitude, 'lat': df.latitude}), out['restaurant'])
    out['osm'] = pd.concat([merge_same_point(osm[osm.name.notna()]), osm[osm.name.isna()]])

    df = pd.read_csv(raw / 'common_places.csv')
    df = df[df.boroughcode == 1].dropna(subset=['the_geom'])
    xy = df.the_geom.str.extract(r'POINT \((\S+) (\S+)\)').astype(float)
    out['place'] = merge_same_point(pd.DataFrame({'name': df.feature_name.str.title(), 'detail': df.facility_type,
                                                  'lon': xy[0], 'lat': xy[1]}).dropna(subset=['lon']))

    return {k: to_grid(v.reset_index(drop=True)) for k, v in out.items()}


def near(buckets, empty, cx, cy, gx, gy, radius):
    r = int(np.ceil(radius / CELL))
    parts = [buckets[k] for i in range(-r, r + 1) for j in range(-r, r + 1)
             if (k := (gx + i, gy + j)) in buckets]
    if not parts:
        return empty
    d = pd.concat(parts)
    d = d.assign(dist=np.hypot(d.x - cx, d.y - cy))
    return d[d.dist <= radius].sort_values('dist')


def clean(v):
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [clean(x) for x in v]
    if isinstance(v, float) and np.isnan(v):
        return None
    return v


def comment_count(n):
    return int(min(MAX_COMMENTS, max(1, round(1 + 2 * np.log2(n)))))


def build():
    complaints = load_complaints()
    features = load_features()
    buckets = {k: dict(tuple(df.groupby(['gx', 'gy']))) for k, df in features.items()}
    empties = {k: df.iloc[0:0].assign(dist=0.0) for k, df in features.items()}
    rng = np.random.default_rng(SEED)

    cells = []
    for (gx, gy), g in complaints.groupby(['gx', 'gy']):
        cx, cy = (gx + 0.5) * CELL, (gy + 0.5) * CELL
        cell_id = f'c{gx}_{gy}'
        found = {k: near(buckets[k], empties[k], cx, cy, gx, gy, PARK_RADIUS if k == 'park' else RADIUS)
                 for k in features}
        feats = []

        seen = set()

        def add(kind, row, **extra):
            name = '' if pd.isna(row['name']) else str(row['name'])
            key = re.sub(r'[^a-z0-9]', '', name.lower())
            if key and key in seen:
                return
            seen.add(key)
            names = row.get('names')
            if isinstance(names, list) and len(names) > 1:
                extra['names'] = names
            feats.append({'fid': f'{cell_id}-{len(feats)}', 'type': kind,
                          'name': name,
                          'lon': round(float(row.lon), 6), 'lat': round(float(row.lat), 6),
                          'dist_m': int(row.dist), **extra})

        def sample(df, n=SAMPLES):
            return df.sample(min(n, len(df)), random_state=rng) if len(df) else df

        rest = found['restaurant']
        for _, r in sample(rest).iterrows():
            add('restaurant', r, cuisine=r.detail)

        park = found['park'].drop_duplicates('name')
        if len(park):
            add('park', park.iloc[0], category=park.iloc[0].detail)

        osm = found['osm']
        for _, r in sample(osm[osm.name.notna()]).iterrows():
            add(r.detail, r)

        bld = found['building']
        if len(bld):
            oldest = bld.sort_values('year').iloc[0]
            add('old_building', oldest, year=int(oldest.year), floors=float(oldest.floors))
        for _, r in bld[bld.landmark.notna()].head(2).iterrows():
            add('landmark', r, year=int(r.year))

        for _, r in sample(found['place'], 2).iterrows():
            add('place', r)

        months = g.date.dt.month.map(SEASONS).value_counts()
        cells.append({
            'id': cell_id,
            'lon': round(LON0 + cx / MX, 6),
            'lat': round(LAT0 + cy / MY, 6),
            'count': int(len(g)),
            'comments_to_generate': comment_count(len(g)),
            'complaints': {
                'waste': int((g.descriptor == 'Pigeon Waste').sum()),
                'odor': int((g.descriptor == 'Pigeon Odor').sum()),
                'first_year': int(g.date.dt.year.min()),
                'last_year': int(g.date.dt.year.max()),
                'seasons': {s: int(months.get(s, 0)) for s in ['spring', 'summer', 'fall', 'winter']},
                'location_types': g.location_type.value_counts().head(2).to_dict(),
                'streets': g.street_name.dropna().str.title().value_counts().head(3).index.tolist(),
            },
            'surroundings': {
                'restaurants': int(len(rest)),
                'top_cuisines': rest.detail.value_counts().head(3).index.tolist(),
                'litter_baskets': int(len(found['litter_basket'])),
                'buildings': int(len(bld)),
                'median_year_built': int(bld.year.median()) if len(bld) else None,
                'max_floors': float(bld.floors.max()) if len(bld) else None,
                'historic_districts': bld.histdist.dropna().unique()[:2].tolist(),
                'osm_counts': osm.detail.value_counts().to_dict(),
            },
            'features': feats,
        })
    return cells


def coverage(cells):
    n = len(cells)
    counts = np.array([c['count'] for c in cells])
    has = lambda f: sum(1 for c in cells if f(c))
    lines = [
        f'cells: {n}  (grid {CELL} m, search radius {RADIUS} m, park radius {PARK_RADIUS} m)',
        f'complaints: {counts.sum()}  per cell: median {int(np.median(counts))}, max {counts.max()}',
        f'cells with 1-2 / 3-10 / 11-50 / 50+ complaints: '
        f'{(counts <= 2).sum()} / {((counts > 2) & (counts <= 10)).sum()} / '
        f'{((counts > 10) & (counts <= 50)).sum()} / {(counts > 50).sum()}',
        f'comments to generate: {sum(c["comments_to_generate"] for c in cells)}',
        '',
        'cells that have at least one ...',
    ]
    checks = {
        'restaurant': lambda c: c['surroundings']['restaurants'] > 0,
        'litter basket': lambda c: c['surroundings']['litter_baskets'] > 0,
        'building (PLUTO)': lambda c: c['surroundings']['buildings'] > 0,
        'historic district': lambda c: len(c['surroundings']['historic_districts']) > 0,
        'landmark': lambda c: any(f['type'] == 'landmark' for f in c['features']),
        'park within 200 m': lambda c: any(f['type'] == 'park' for f in c['features']),
        'bench (OSM)': lambda c: c['surroundings']['osm_counts'].get('bench', 0) > 0,
        'cafe / bakery / deli (OSM)': lambda c: any(c['surroundings']['osm_counts'].get(k, 0) > 0
                                                     for k in ['cafe', 'bakery', 'deli']),
        'named place (CommonPlace)': lambda c: any(f['type'] == 'place' for f in c['features']),
    }
    for name, f in checks.items():
        k = has(f)
        lines.append(f'  {name:28s} {k:5d}  ({k / n:5.1%})')
    feats = [len(c['features']) for c in cells]
    lines += ['', f'features with coordinates per cell: median {int(np.median(feats))}, '
                  f'min {min(feats)}, cells with 0: {feats.count(0)}']
    return '\n'.join(lines)


PROMPT = '''請只根據下面提供的資料寫，不要編造資料裡沒有的地點或事實，不要寫出門牌地址。

地點資料（JSON）：
{facts}

請寫 {n} 則評論。

回傳 JSON，格式如下，uses 填這則評論用到的 features 的 fid：
{{"comments": [{{"text": "...", "persona": "...", "uses": ["fid", ...]}}]}}
'''


def prompt_samples(cells):
    top = sorted(cells, key=lambda c: -c['count'])[:2]
    mid = [c for c in cells if 3 <= c['count'] <= 10][:1]
    low = [c for c in cells if c['count'] <= 2][:1]
    out = []
    for c in top + mid + low:
        facts = {k: v for k, v in c.items() if k != 'comments_to_generate'}
        out.append(f'## {c["id"]}  ({c["count"]} complaints)\n\n```\n'
                   + PROMPT.format(facts=json.dumps(facts, ensure_ascii=False, indent=2),
                                   n=c['comments_to_generate'])
                   + '```\n')
    return '\n'.join(out)


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    cells = clean(build())
    (OUT / 'cells.json').write_text(json.dumps(cells, ensure_ascii=False, indent=1, allow_nan=False), encoding='utf-8')
    report = coverage(cells)
    (OUT / 'coverage.txt').write_text(report, encoding='utf-8')
    (OUT / 'prompt_samples.md').write_text(prompt_samples(cells), encoding='utf-8')
    with open(OUT / 'prompts.jsonl', 'w', encoding='utf-8') as f:
        for c in cells:
            facts = {k: v for k, v in c.items() if k != 'comments_to_generate'}
            prompt = PROMPT.format(facts=json.dumps(facts, ensure_ascii=False, indent=2), n=c['comments_to_generate'])
            f.write(json.dumps({'id': c['id'], 'n': c['comments_to_generate'], 'prompt': prompt},
                               ensure_ascii=False) + '\n')
    print(report)
