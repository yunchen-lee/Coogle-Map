import fs from 'fs';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const ZOOM = 15;
const SPACING = 25;
const ANGLE = 29;
const START = { x: -73.9906, y: 40.7359 };
const COLORS = {
    water: [0.36, 0.78, 0.91],
    park: [0.42, 0.66, 0.23],
    building: [0.55, 0.55, 0.55],
    ground: [0.85, 0.85, 0.85],
    road: [0, 0, 0],
};
const SIZES = { water: 1, park: 1, building: 0.4, ground: 0.2, road: 0.2 };
const JITTER = { water: 0.5, park: 0.5, building: 0.1, ground: 0, road: 0.07 };
const ALPHAS = { water: 0.8, park: 0.8, building: 0.8, ground: 0.8, road: 0.8 };
const PARKS = ['park', 'grass', 'wood', 'pitch', 'cemetery', 'scrub'];
const ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street', 'street_limited'];
const ROAD_STEP = 8;

const res = await fetch(
    'https://nominatim.openstreetmap.org/search?q=Manhattan,New+York&format=geojson&polygon_geojson=1&limit=1', { headers: { 'User-Agent': 'pigeon-map' } }
);
const geom = (await res.json()).features[0].geometry;
const boundary = geom.coordinates
    .sort((a, b) => b[0].length - a[0].length)[0]
    .map((ring) => ring.map(([x, y]) => ({ x, y })));

const allPts = boundary.flat();
const lon0 = allPts.reduce((s, p) => s + p.x, 0) / allPts.length;
const lat0 = allPts.reduce((s, p) => s + p.y, 0) / allPts.length;
const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
const my = 110540;
const a = (ANGLE * Math.PI) / 180;

const toUV = (p) => {
    const ex = (p.x - lon0) * mx;
    const ny = (p.y - lat0) * my;
    return [ex * Math.cos(a) - ny * Math.sin(a), ex * Math.sin(a) + ny * Math.cos(a)];
};
const toLonLat = (u, v) => ({
    x: lon0 + (u * Math.cos(a) + v * Math.sin(a)) / mx,
    y: lat0 + (-u * Math.sin(a) + v * Math.cos(a)) / my,
});

const uvs = allPts.map(toUV);
const uMin = Math.min(...uvs.map((p) => p[0])),
    uMax = Math.max(...uvs.map((p) => p[0]));
const vMin = Math.min(...uvs.map((p) => p[1])),
    vMax = Math.max(...uvs.map((p) => p[1]));
const W = Math.ceil((uMax - uMin) / SPACING);
const H = Math.ceil((vMax - vMin) / SPACING);

function inside(px, py, rings) {
    let c = false;
    for (const r of rings)
        for (let i = 0, j = r.length - 1; i < r.length; j = i++)
            if ((r[i].y > py) !== (r[j].y > py) &&
                px < ((r[j].x - r[i].x) * (py - r[i].y)) / (r[j].y - r[i].y) + r[i].x) c = !c;
    return c;
}

const tileXY = ({ x, y }) => {
    const r = (y * Math.PI) / 180;
    return [
        ((x + 180) / 360) * 2 ** ZOOM,
        ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM,
    ];
};

const cells = [];
for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
        const u = uMin + (i + 0.5) * SPACING;
        const v = vMin + (j + 0.5) * SPACING;
        const ll = toLonLat(u, v);
        if (!inside(ll.x, ll.y, boundary)) continue;
        const [tx, ty] = tileXY(ll);
        cells.push({ i, j, key: `${Math.floor(tx)}/${Math.floor(ty)}`, px: (tx % 1) * 4096, py: (ty % 1) * 4096 });
    }
}

function polys(tile, name, filter = () => true) {
    const layer = tile.layers[name];
    if (!layer) return [];
    const out = [];
    for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || !filter(f.properties)) continue;
        const rings = f.loadGeometry();
        const pts = rings.flat();
        out.push({
            rings,
            minX: Math.min(...pts.map((p) => p.x)),
            maxX: Math.max(...pts.map((p) => p.x)),
            minY: Math.min(...pts.map((p) => p.y)),
            maxY: Math.max(...pts.map((p) => p.y)),
            height: f.properties.height || 0,
        });
    }
    return out;
}

const hits = (list, px, py) =>
    list.filter((p) => px >= p.minX && px <= p.maxX && py >= p.minY && py <= p.maxY && inside(px, py, p.rings));

async function loadTile(key) {
    const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${ZOOM}/${key}.mvt?access_token=${process.env.MAPBOX_TOKEN}`;
    const tile = new VectorTile(new Pbf(new Uint8Array(await (await fetch(url)).arrayBuffer())));
    return [key, {
        water: polys(tile, 'water'),
        parks: polys(tile, 'landuse', (p) => PARKS.includes(p.class)),
        buildings: polys(tile, 'building'),
        roads: lines(tile, 'road', (p) => ROADS.includes(p.class) && p.structure !== 'tunnel'),
    }];
}

function lines(tile, name, filter) {
    const layer = tile.layers[name];
    if (!layer) return [];
    const out = [];
    for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type === 2 && filter(f.properties)) out.push(...f.loadGeometry());
    }
    return out;
}

const tileToLonLat = (key, px, py) => {
    const [x, y] = key.split('/').map(Number);
    const n = 2 ** ZOOM;
    return {
        x: ((x + px / 4096) / n) * 360 - 180,
        y: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / 4096)) / n))) * 180) / Math.PI,
    };
};

const toGrid = (ll) => {
    const [u, v] = toUV(ll);
    return [(u - uMin) / SPACING - 0.5 - W / 2, (v - vMin) / SPACING - 0.5 - H / 2];
};

function pushPoint(x, y, z, kind) {
    data.push(
        x, y, z,
        ...COLORS[kind],
        SIZES[kind] + (Math.random() * 2 - 1) * JITTER[kind],
        ALPHAS[kind]
    );
}

const keys = [...new Set(cells.map((c) => c.key))];
const tiles = new Map(await Promise.all(keys.map(loadTile)));

const data = [];
for (const { i, j, key, px, py }
    of cells) {
    const t = tiles.get(key);
    let kind = 'ground';
    let height = 0;

    const b = hits(t.buildings, px, py);
    if (b.length) {
        kind = 'building';
        height = Math.max(...b.map((p) => p.height));
    } else if (hits(t.water, px, py).length) kind = 'water';
    else if (hits(t.parks, px, py).length) kind = 'park';

    pushPoint(i - W / 2, j - H / 2, height / SPACING, kind);
}

for (const [key, t] of tiles) {
    for (const line of t.roads) {
        for (let k = 1; k < line.length; k++) {
            const a = line[k - 1];
            const b = line[k];
            const [ax, ay] = toGrid(tileToLonLat(key, a.x, a.y));
            const [bx, by] = toGrid(tileToLonLat(key, b.x, b.y));
            const n = Math.ceil((Math.hypot(bx - ax, by - ay) * SPACING) / ROAD_STEP);
            for (let s = 0; s < n; s++) {
                const px = a.x + ((b.x - a.x) * s) / n;
                const py = a.y + ((b.y - a.y) * s) / n;
                if (px < 0 || px >= 4096 || py < 0 || py >= 4096) continue;
                const ll = tileToLonLat(key, px, py);
                if (!inside(ll.x, ll.y, boundary)) continue;
                const [gx, gy] = toGrid(ll);
                pushPoint(gx, gy, 0, 'road');
            }
        }
    }
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/points.bin', Buffer.from(new Float32Array(data).buffer));

const [su, sv] = toUV(START);
fs.writeFileSync('data/meta.json', JSON.stringify({
    startX: (su - uMin) / SPACING - 0.5 - W / 2,
    startY: (sv - vMin) / SPACING - 0.5 - H / 2,
    lon0, lat0, mx, my, angle: ANGLE, uMin, vMin, W, H, spacing: SPACING,
}));
console.log(`${keys.length} tiles, ${data.length / 8} points, ${W}x${H}`);