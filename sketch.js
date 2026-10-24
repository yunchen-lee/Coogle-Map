const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl');

const MAX_PIGEONS = 64;

const vs = `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform mat4 uMvp;
uniform vec2 uMouse;
uniform vec2 uPigeons[${MAX_PIGEONS}];
uniform int uPigeonCount;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 p = vec3(aPos.xy, aPos.z * 0.3);
  float rnd = fract(sin(dot(aPos.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float k = mix(0.4, 1.5, rnd);

  vec2 diff = p.xy - uMouse;
  float radius = 2.5;
  float push = 1.0 - smoothstep(0.0, radius, length(diff));
  vec2 offset = normalize(diff) * push * radius * k;
  float shrink = push;

  float pigeonRadius = 1.5;
  for (int i = 0; i < ${MAX_PIGEONS}; i++) {
    if (i >= uPigeonCount) break;
    vec2 d = p.xy - uPigeons[i];
    float pp = 1.0 - smoothstep(0.0, pigeonRadius, length(d));
    offset += normalize(d) * pp * pigeonRadius * k;
    shrink = max(shrink, pp);
  }
  p.xy += offset;

  gl_Position = uMvp * vec4(p, 1.0);
  gl_PointSize = 1200.0 * aSize * (1.0 - shrink * 0.5) / gl_Position.w;
  vColor = aColor;
  vAlpha = aAlpha;
}
`;

const fs = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
}

const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(program);
gl.useProgram(program);

const uMvp = gl.getUniformLocation(program, 'uMvp');
const uMouse = gl.getUniformLocation(program, 'uMouse');
const uPigeons = gl.getUniformLocation(program, 'uPigeons');
const uPigeonCount = gl.getUniformLocation(program, 'uPigeonCount');

const modelVs = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uMvp;
uniform vec3 uOffset;
uniform float uAngle;
uniform float uScale;
varying vec3 vColor;
void main() {
  vec3 a = aPos * uScale;
  float c = cos(uAngle);
  float s = sin(uAngle);
  vec2 xy = vec2(a.x * c - a.y * s, a.x * s + a.y * c) + uOffset.xy;
  gl_Position = uMvp * vec4(xy, a.z + uOffset.z, 1.0);
  vColor = aColor;
}
`;

const modelFs = `
precision mediump float;
uniform float uAlpha;
uniform vec3 uTint;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor * uTint, uAlpha);
}
`;

const modelProgram = gl.createProgram();
gl.attachShader(modelProgram, compile(gl.VERTEX_SHADER, modelVs));
gl.attachShader(modelProgram, compile(gl.FRAGMENT_SHADER, modelFs));
gl.linkProgram(modelProgram);
const uModelMvp = gl.getUniformLocation(modelProgram, 'uMvp');
const uOffset = gl.getUniformLocation(modelProgram, 'uOffset');
const uAngle = gl.getUniformLocation(modelProgram, 'uAngle');
const uScale = gl.getUniformLocation(modelProgram, 'uScale');
const uAlpha = gl.getUniformLocation(modelProgram, 'uAlpha');
const uTint = gl.getUniformLocation(modelProgram, 'uTint');

const PIN_RADIUS = 1.5;
const PIN_HEIGHT = 3.5;
const PIN_HOLE = 0.6;
const PIN_THICKNESS = 0.25;
const PIN_LIFT = 1;
const PIN_SPIN = 1;
const LABEL_LIFT = 1;
const LANDMARK_SCALE = 0.5;
const HOTSPOT_SCALE = 0.85;
const LANDMARK_COLOR = '#000000';
const landmarks = [];
let pinBuffer;
let pinCount = 0;

function buildPin() {
    const R = PIN_RADIUS,
        H = PIN_HEIGHT,
        T = PIN_THICKNESS,
        N = 64;
    const sinB = R / H;
    const tanB = sinB / Math.sqrt(1 - sinB * sinB);
    const inside = (x, z) =>
        x * x + (z - H) * (z - H) <= R * R || (z >= 0 && z <= H - R * sinB && Math.abs(x) <= z * tanB);
    const ring = [];
    for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const dx = Math.cos(a),
            dz = Math.sin(a);
        let lo = 0,
            hi = R + H;
        for (let k = 0; k < 30; k++) {
            const t = (lo + hi) / 2;
            if (inside(t * dx, H + t * dz)) lo = t;
            else hi = t;
        }
        ring.push({ ox: lo * dx, oz: H + lo * dz, ix: PIN_HOLE * dx, iz: H + PIN_HOLE * dz });
    }
    const out = [];
    const v = (x, y, z, s) => out.push(x, y, z, s, s, s);
    const quad = (a, b, c, d, s) => {
        v(...a, s);
        v(...b, s);
        v(...c, s);
        v(...a, s);
        v(...c, s);
        v(...d, s);
    };
    for (let i = 0; i < N; i++) {
        const p = ring[i],
            q = ring[i + 1];
        for (const y of[-T, T]) {
            quad([p.ix, y, p.iz], [p.ox, y, p.oz], [q.ox, y, q.oz], [q.ix, y, q.iz], 1);
        }
        quad([p.ox, -T, p.oz], [p.ox, T, p.oz], [q.ox, T, q.oz], [q.ox, -T, q.oz], 0.7);
        quad([p.ix, -T, p.iz], [p.ix, T, p.iz], [q.ix, T, q.iz], [q.ix, -T, q.iz], 0.5);
    }
    pinCount = out.length / 6;
    pinBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pinBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
}
buildPin();

const ARROW_RANGE = 1000;
const ARROW_RING = 16;
const MAX_ARROWS = 2;
const ARROW_MIN_SCALE = 0.75;
let arrowBuffer;
let arrowCount = 0;

function buildArrow() {
    const T = 0.3;
    const tri = [
        [1.2, 0],
        [-0.6, 0.8],
        [-0.6, -0.8]
    ];
    const out = [];
    const v = (x, y, z, s) => out.push(x, y, z, s, s, s);
    for (const [z, s] of[[T, 1], [0, 0.6]]) {
        for (const [x, y] of tri) v(x, y, z, s);
    }
    for (let i = 0; i < 3; i++) {
        const [ax, ay] = tri[i];
        const [bx, by] = tri[(i + 1) % 3];
        v(ax, ay, 0, 0.75);
        v(bx, by, 0, 0.75);
        v(bx, by, T, 0.75);
        v(ax, ay, 0, 0.75);
        v(bx, by, T, 0.75);
        v(ax, ay, T, 0.75);
    }
    arrowCount = out.length / 6;
    arrowBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, arrowBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
}
buildArrow();

function addLandmark(l, small) {
    const [x, y] = lonLatToGrid(l.lon, l.lat);
    const color = l.color || LANDMARK_COLOR;
    const el = document.createElement('div');
    el.className = small ? 'landmark small' : 'landmark';
    el.style.color = color;
    el.innerHTML = '<div class="landmark-name"></div><div class="landmark-desc"></div>';
    el.querySelector('.landmark-name').textContent = l.name;
    el.querySelector('.landmark-desc').textContent = l.description || '';
    document.body.appendChild(el);
    const tint = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
    const scale = small ? LANDMARK_SCALE : l.rank === 1 ? 1 : HOTSPOT_SCALE;
    landmarks.push({...l, x, y, el, tint, scale });
}

const PIGEON_SCALE = 10;
const PIGEON_SPEED = 0.6;
const PIGEON_RANGE = 2;
const STEP_RATE = 3;
const STEP_LIFT = 0.08;
const PIGEON_SIZE_JITTER = 0.1;
const PICK_RADIUS = 40;
const HOVER_GROW = 0.3;
const SELECT_DURATION = 10;
const TYPE_SPEED = 20;
const SPAWN_RADIUS = 24;
const DESPAWN_RADIUS = 28;
const FADE_START = 16;
const MAX_VISIBLE_PIGEONS = 150;
const DOTS_NEAREST = 4;
const CELL_SPREAD = 4;
const MAX_PER_CELL = 8;
const FLOCK_RADIUS = 1.5;
const MARKER_COLORS = {
    restaurant: '#e4572e',
    cafe: '#b5651d',
    bakery: '#b5651d',
    deli: '#b5651d',
    fast_food: '#e4572e',
    park: '#3a8f3a',
    landmark: '#7b4fbf',
    old_building: '#4a6fd1',
    place: '#2a9d8f',
};
const MARKER_LABELS = {
    landmark: 'Landmark',
    old_building: 'Old building',
};
const pigeons = [];
const activeCells = new Map();
let cells = [];
let spawnTimer = 0;
let markers = [];
let markerOwner = null;
let meta;
let hovered = null;
let selected = null;
let selectedTimer = 0;

function lonLatToGrid(lon, lat) {
    const a = (meta.angle * Math.PI) / 180;
    const ex = (lon - meta.lon0) * meta.mx;
    const ny = (lat - meta.lat0) * meta.my;
    const u = ex * Math.cos(a) - ny * Math.sin(a);
    const v = ex * Math.sin(a) + ny * Math.cos(a);
    return [
        (u - meta.uMin) / meta.spacing - 0.5 - meta.W / 2,
        (v - meta.vMin) / meta.spacing - 0.5 - meta.H / 2,
    ];
}

const commentOf = (p) => p.cell.comments[p.ci];

function showMarkers(p) {
    for (const m of markers) m.el.remove();
    markers = [];
    markerOwner = p;
    if (!p) return;
    for (const fid of commentOf(p).uses) {
        const f = p.cell.features[fid];
        if (!f) continue;
        const el = document.createElement('div');
        el.className = 'marker';
        el.style.color = MARKER_COLORS[f.type] || '#555';
        const label = f.name || MARKER_LABELS[f.type] || f.type;
        el.innerHTML = '<span class="marker-label"></span><span class="marker-x">×</span>';
        el.querySelector('.marker-label').textContent = f.year ? `${label} (${f.year})` : label;
        document.body.appendChild(el);
        const [x, y] = lonLatToGrid(f.lon, f.lat);
        markers.push({ el, x, y });
    }
}

const pigeonsPerCell = (cell) => Math.min(MAX_PER_CELL, cell.comments.length);

const distToCenter = (x, y) => Math.hypot(x - panX, y - panY);

function updateSpawns() {
    for (const [id, a] of activeCells) {
        if (distToCenter(a.cell.gx, a.cell.gy) < DESPAWN_RADIUS) continue;
        if (a.pigeons.includes(selected)) continue;
        for (const p of a.pigeons) p.leaving = true;
        activeCells.delete(id);
    }
    let total = pigeons.filter((p) => !p.leaving).length;
    const candidates = cells
        .filter((c) => !activeCells.has(c.id) && distToCenter(c.gx, c.gy) < SPAWN_RADIUS)
        .sort((a, b) => distToCenter(a.gx, a.gy) - distToCenter(b.gx, b.gy));
    for (const c of candidates) {
        const k = pigeonsPerCell(c);
        if (total + k > MAX_VISIBLE_PIGEONS) break;
        const fx = c.gx + (Math.random() - 0.5) * CELL_SPREAD;
        const fy = c.gy + (Math.random() - 0.5) * CELL_SPREAD;
        const list = [];
        for (let i = 0; i < k; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * FLOCK_RADIUS;
            const p = addPigeon(fx + Math.cos(a) * r, fy + Math.sin(a) * r, c);
            p.homeX = fx;
            p.homeY = fy;
            list.push(p);
        }
        activeCells.set(c.id, { cell: c, pigeons: list });
        total += k;
    }
}

function nextComment(cell) {
    if (!cell.bag || !cell.bag.length) {
        const bag = cell.comments.map((_, i) => i);
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        if (bag.length > 1 && bag[bag.length - 1] === cell.last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
        cell.bag = bag;
    }
    cell.last = cell.bag.pop();
    return cell.last;
}

function select(p) {
    if (selected) selected.typed = 0;
    selected = p;
    selectedTimer = SELECT_DURATION;
    if (!p) return;
    p.ci = nextComment(p.cell);
    p.personaEl.textContent = `${commentOf(p).persona} · ${p.cell.count} pigeons reviewed this spot`;
}

function addPigeon(x, y, cell) {
    const el = document.createElement('div');
    el.className = 'bubble';
    el.innerHTML = '<div class="bubble-box"><span class="bubble-dots"><i></i><i></i><i></i></span><span class="bubble-persona"></span><span class="bubble-text"></span></div>';
    document.body.appendChild(el);

    const p = {
        el,
        textEl: el.querySelector('.bubble-text'),
        personaEl: el.querySelector('.bubble-persona'),
        cell,
        ci: 0,
        fade: 0,
        edge: 1,
        leaving: false,
        typed: 0,
        dots: false,
        dotsTimer: Math.random() * 5,
        x,
        y,
        homeX: x,
        homeY: y,
        angle: Math.random() * Math.PI * 2,
        targetAngle: 0,
        walking: false,
        timer: Math.random() * 2,
        phase: 0,
        lift: 0,
        scale: 1 + (Math.random() * 2 - 1) * PIGEON_SIZE_JITTER,
        hover: 0,
    };
    pigeons.push(p);
    return p;
}

function updatePigeon(p, dt) {
    p.hover += ((p === hovered || p === selected ? 1 : 0) - p.hover) * 0.2;
    p.fade += ((p.leaving ? 0 : 1) - p.fade) * 0.05;
    const d = distToCenter(p.x, p.y);
    p.edge = 1 - Math.min(1, Math.max(0, (d - FADE_START) / (SPAWN_RADIUS - FADE_START)));

    p.dotsTimer -= dt;
    if (p.dotsTimer <= 0) {
        p.dots = !p.dots;
        p.dotsTimer = p.dots ? 2 + Math.random() * 3 : 3 + Math.random() * 8;
    }
    p.typed = p === selected ? p.typed + dt * TYPE_SPEED : 0;

    p.timer -= dt;
    if (p.timer <= 0) {
        p.walking = !p.walking;
        p.timer = p.walking ? 1 + Math.random() * 2 : 0.5 + Math.random() * 2;
        p.targetAngle = p.angle + (Math.random() - 0.5) * 2;
        const dx = p.homeX - p.x;
        const dy = p.homeY - p.y;
        if (Math.hypot(dx, dy) > PIGEON_RANGE) p.targetAngle = Math.atan2(dx, -dy);
    }
    if (!p.walking) {
        p.phase = 0;
        p.lift = 0;
        return;
    }
    p.phase += dt * STEP_RATE;
    const step = Math.max(0, Math.sin(p.phase * Math.PI * 2));
    p.lift = step * STEP_LIFT;
    p.angle += (p.targetAngle - p.angle) * 0.1;
    p.x += Math.sin(p.angle) * PIGEON_SPEED * dt * step * 3;
    p.y -= Math.cos(p.angle) * PIGEON_SPEED * dt * step * 3;
}

let pointBuffer;
let modelBuffer;
let modelCount = 0;
let pointCount = 0;
let yaw = 0;
let pitch = -0.7;
let dist = 40;
let panX = 0;
let panY = 0;
let targetX = 0;
let targetY = 0;
let mvp;
let screenX = window.innerWidth / 2;
let screenY = window.innerHeight / 2;
let hoverX = 0;
let hoverY = 0;

fetch('data/meta.json')
    .then((r) => r.json())
    .then((m) => {
        meta = m;
        panX = targetX = meta.startX;
        panY = targetY = meta.startY;
        fetch('data/hotspots.json')
            .then((r) => r.json())
            .then((list) => list.forEach((l) => addLandmark(l, false)));
        fetch('data/landmarks.json')
            .then((r) => r.json())
            .then((list) => list.forEach((l) => addLandmark(l, true)));
        return fetch('data/pigeons.json').then((r) => r.json());
    })
    .then((data) => {
        cells = data.map((c) => {
            const [gx, gy] = lonLatToGrid(c.lon, c.lat);
            return {...c, gx, gy };
        });
        updateSpawns();
        return fetch('grounded-pigeon.obj')
            .then((r) => r.text())
            .then((text) => {
                const verts = [];
                const tris = [];
                for (const line of text.split('\n')) {
                    const t = line.trim().split(/\s+/);
                    if (t[0] === 'v') verts.push(t.slice(1).map(Number));
                    if (t[0] === 'f') {
                        for (const f of t.slice(1)) {
                            const [x, y, z, r, g, b] = verts[parseInt(f) - 1];
                            tris.push(x * PIGEON_SCALE, -z * PIGEON_SCALE, y * PIGEON_SCALE, r, g, b);
                        }
                    }
                }
                modelCount = tris.length / 6;
                modelBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tris), gl.STATIC_DRAW);
            });
    });

function useAttribs(prog, buffer, stride, list) {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
    for (const [name, size, offset] of list) {
        const loc = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
}

fetch('data/points.bin')
    .then((r) => r.arrayBuffer())
    .then((buf) => {
        const data = new Float32Array(buf);

        const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
        const PALETTES = {
            water: ['#63b5e1', '#43add1', '#6bc2dd', '#1b8eb7'],
            park: ['#6aa83a', '#8bb84a', '#5a9a30', '#9ac45a', '#4f8f2a'],
        };

        for (let i = 0; i < data.length; i += 8) {
            const r = data[i + 3];
            const g = data[i + 4];
            let kind = null;
            if (r.toFixed(2) === '0.36') kind = 'water';
            if (r.toFixed(2) === '0.42' && g.toFixed(2) === '0.66') kind = 'park';
            if (!kind) continue;

            const p = PALETTES[kind];
            const c = hex(p[Math.floor(Math.random() * p.length)]);
            data[i + 3] = c[0];
            data[i + 4] = c[1];
            data[i + 5] = c[2];
        }


        pointCount = data.length / 8;

        pointBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    });

function mul(a, b) {
    const out = new Array(16).fill(0);
    for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++)
            for (let k = 0; k < 4; k++)
                out[i * 4 + j] += a[k * 4 + j] * b[i * 4 + k];
    return out;
}

function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0,
    ];
}

function rotX(t) {
    const c = Math.cos(t),
        s = Math.sin(t);
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function rotZ(t) {
    const c = Math.cos(t),
        s = Math.sin(t);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function translate(x, y, z) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function invert(m) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32;
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    return [
        (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
        (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
        (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
        (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
        (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
        (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
        (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
        (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
    ];
}

function unproject(m, x, y, z) {
    const v = [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
    return [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
}

function groundAt(sx, sy) {
    const inv = invert(mvp);
    const x = (sx / canvas.clientWidth) * 2 - 1;
    const y = 1 - (sy / canvas.clientHeight) * 2;
    const near = unproject(inv, x, y, -1);
    const far = unproject(inv, x, y, 1);
    const t = -near[2] / (far[2] - near[2]);
    return [near[0] + (far[0] - near[0]) * t, near[1] + (far[1] - near[1]) * t];
}

function onScreen(x, y, z) {
    const c = [0, 1, 3].map((r) => mvp[r] * x + mvp[4 + r] * y + mvp[8 + r] * z + mvp[12 + r]);
    return c[2] > 0 && Math.abs(c[0] / c[2]) <= 1 && Math.abs(c[1] / c[2]) <= 1;
}

function inFront(x, y, z) {
    return mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15] > 0;
}

function toScreen(x, y, z) {
    const [nx, ny] = unproject(mvp, x, y, z);
    return [(nx + 1) / 2 * canvas.clientWidth, (1 - ny) / 2 * canvas.clientHeight];
}

function pigeonAt(sx, sy) {
    let best = null;
    let bestD = PICK_RADIUS;
    for (const p of pigeons) {
        if (p.leaving || p.fade * p.edge < 0.3) continue;
        const [px, py] = toScreen(p.x, p.y, PIGEON_SCALE * 0.1 * p.scale);
        const d = Math.hypot(px - sx, py - sy);
        if (d < bestD) {
            best = p;
            bestD = d;
        }
    }
    return best;
}

function pick(e) {
    select(pigeonAt(e.clientX, e.clientY));
    if (!selected)[targetX, targetY] = groundAt(e.clientX, e.clientY);
}

let dragging = false;
let moved = 0;
const SOUND_FILE = 'pigeon.mp3';
const MAX_VOICES = 6;
const NEAR_INNER = 8;
const NEAR_OUTER = 30;
const PRESENCE_COUNT = 10;
const MAX_VOLUME = 0.8;
const FAR_VOLUME = 0.4;
const SWELL_DEPTH = 0.8;
const PAN_DEPTH = 0.7;
let audioCtx;
let master;
const voices = [];

function lfo(freq, depth, param) {
    const osc = audioCtx.createOscillator();
    osc.frequency.value = freq;
    const amp = audioCtx.createGain();
    amp.gain.value = depth;
    osc.connect(amp).connect(param);
    osc.start(audioCtx.currentTime + Math.random() / freq);
}

function startAudio() {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    master = audioCtx.createGain();
    master.gain.value = 0;
    master.connect(audioCtx.destination);
    fetch(SOUND_FILE)
        .then((r) => r.arrayBuffer())
        .then((b) => audioCtx.decodeAudioData(b))
        .then((buf) => {
            for (let i = 0; i < MAX_VOICES; i++) {
                const src = audioCtx.createBufferSource();
                src.buffer = buf;
                src.loop = true;
                src.playbackRate.value = 0.9 + Math.random() * 0.2;
                const swell = audioCtx.createGain();
                swell.gain.value = 1 - SWELL_DEPTH / 2;
                const level = audioCtx.createGain();
                level.gain.value = 0;
                const pan = audioCtx.createStereoPanner();
                pan.pan.value = 0;
                src.connect(swell).connect(level).connect(pan).connect(master);
                if (i > 0) {
                    lfo(0.05 + Math.random() * 0.1, SWELL_DEPTH / 2, swell.gain);
                    lfo(0.03 + Math.random() * 0.07, PAN_DEPTH, pan.pan);
                } else {
                    swell.gain.value = 1;
                }
                src.start(0, Math.random() * buf.duration);
                voices.push(level);
            }
        });
}

function landmarkProximity() {
    let best = 0;
    for (const l of landmarks) {
        const d = distToCenter(l.x, l.y);
        best = Math.max(best, 1 - Math.min(1, Math.max(0, (d - NEAR_INNER) / (NEAR_OUTER - NEAR_INNER))));
    }
    return best;
}

function updateSound() {
    if (!voices.length) return;
    const count = pigeons.reduce((s, p) => s + p.fade * p.edge, 0);
    const presence = Math.min(1, count / PRESENCE_COUNT);
    const near = landmarkProximity();
    const gains = voices.map((_, i) => {
        if (i === 0) return 1;
        if (i < 4) return near;
        return Math.max(0, (near - 0.5) * 2);
    });
    const norm = 1 / Math.sqrt(gains.reduce((s, g) => s + g * g, 0));
    const t = audioCtx.currentTime;
    voices.forEach((g, i) => g.gain.setTargetAtTime(gains[i] * norm, t, 0.8));
    const volume = MAX_VOLUME * presence * (FAR_VOLUME + (1 - FAR_VOLUME) * near);
    master.gain.setTargetAtTime(volume, t, 0.8);
}

canvas.addEventListener('mousedown', () => {
    startAudio();
    dragging = true;
    moved = 0;
});
window.addEventListener('mouseup', (e) => {
    if (dragging && moved < 5) pick(e);
    dragging = false;
});
window.addEventListener('mousemove', (e) => {
    screenX = e.clientX;
    screenY = e.clientY;
    if (!dragging) return;
    moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    yaw += e.movementX * 0.01;
    // pitch = Math.min(0, Math.max(-Math.PI, pitch + e.movementY * 0.01));
    pitch = Math.min(-0.3, Math.max(-1, pitch + e.movementY * 0.002));
});
// canvas.addEventListener('wheel', (e) => {
//     e.preventDefault();
//     dist = Math.min(5000, Math.max(20, dist * (1 + e.deltaY * 0.001)));
// }, { passive: false });

let lastTime = performance.now();

function frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    selectedTimer -= dt;
    if (selected && selectedTimer <= 0) select(null);
    spawnTimer -= dt;
    if (spawnTimer <= 0 && cells.length) {
        updateSpawns();
        spawnTimer = 0.5;
        updateSound();
    }
    for (const p of pigeons) updatePigeon(p, dt);
    for (let i = pigeons.length - 1; i >= 0; i--) {
        const p = pigeons[i];
        if (!p.leaving || p.fade > 0.01) continue;
        p.el.remove();
        pigeons.splice(i, 1);
        if (hovered === p) hovered = null;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.clearColor(1, 1, 1, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const proj = perspective(Math.PI / 4, canvas.width / canvas.height, 1, 20000);
    if (selected) {
        targetX = selected.x;
        targetY = selected.y;
    }
    panX += (targetX - panX) * 0.03;
    panY += (targetY - panY) * 0.03;

    mvp = mul(proj, mul(translate(0, 0, -dist), mul(rotX(pitch), mul(rotZ(yaw), translate(-panX, -panY, 0)))));

    hovered = dragging ? null : pigeonAt(screenX, screenY);
    canvas.style.cursor = hovered ? 'pointer' : '';

    const byDistance = pigeons
        .filter((p) => !p.leaving)
        .sort((a, b) => distToCenter(a.x, a.y) - distToCenter(b.x, b.y));
    const nearest = new Set(byDistance.slice(0, DOTS_NEAREST));

    for (const p of pigeons) {
        const head = PIGEON_SCALE * 0.22 * p.scale * (1 + HOVER_GROW * p.hover) + p.lift;
        const [sx, sy] = toScreen(p.x, p.y, head);
        p.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
        p.el.style.opacity = p.fade * p.edge;
        p.el.classList.toggle('open', p === selected);
        p.el.classList.toggle('dots', !selected && p.dots && nearest.has(p));
        p.textEl.textContent = p === selected ? commentOf(p).text.slice(0, Math.floor(p.typed)) : '';
    }

    if (selected !== markerOwner) showMarkers(selected);
    for (const m of markers) {
        const [sx, sy] = toScreen(m.x, m.y, 0);
        m.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }

    if (modelCount) {
        useAttribs(modelProgram, modelBuffer, 24, [
            ['aPos', 3, 0],
            ['aColor', 3, 12]
        ]);
        gl.uniformMatrix4fv(uModelMvp, false, new Float32Array(mvp));
        gl.uniform3f(uTint, 1, 1, 1);
        for (const p of pigeons) {
            gl.uniform3f(uOffset, p.x, p.y, p.lift);
            gl.uniform1f(uAngle, p.angle);
            gl.uniform1f(uScale, p.scale * (1 + HOVER_GROW * p.hover));
            gl.uniform1f(uAlpha, p.fade * p.edge);
            gl.drawArrays(gl.TRIANGLES, 0, modelCount);
        }
    }

    const bob = PIN_LIFT + Math.sin(now / 500) * 0.2;
    if (landmarks.length) {
        useAttribs(modelProgram, pinBuffer, 24, [
            ['aPos', 3, 0],
            ['aColor', 3, 12]
        ]);
        gl.uniformMatrix4fv(uModelMvp, false, new Float32Array(mvp));
        gl.uniform1f(uAlpha, 1);
        gl.uniform1f(uAngle, (now / 1000) * PIN_SPIN);
        for (const l of landmarks) {
            gl.uniform1f(uScale, l.scale);
            gl.uniform3f(uOffset, l.x, l.y, bob * l.scale);
            gl.uniform3f(uTint, ...l.tint);
            gl.drawArrays(gl.TRIANGLES, 0, pinCount);
        }
    }
    for (const l of landmarks) {
        const z = (bob + PIN_HEIGHT + PIN_RADIUS + LABEL_LIFT) * l.scale;
        l.el.style.display = inFront(l.x, l.y, z) ? '' : 'none';
        const [sx, sy] = toScreen(l.x, l.y, z);
        l.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }

    const arrows = landmarks
        .filter((l) => distToCenter(l.x, l.y) < ARROW_RANGE)
        .filter((l) => !onScreen(l.x, l.y, (PIN_LIFT + PIN_HEIGHT * 0.5) * l.scale))
        .sort((a, b) => distToCenter(a.x, a.y) - distToCenter(b.x, b.y))
        .slice(0, MAX_ARROWS);
    if (arrows.length) {
        useAttribs(modelProgram, arrowBuffer, 24, [
            ['aPos', 3, 0],
            ['aColor', 3, 12]
        ]);
        gl.uniformMatrix4fv(uModelMvp, false, new Float32Array(mvp));
        gl.uniform1f(uAlpha, 1);
        const ring = ARROW_RING + Math.sin(now / 300) * 0.5;
        for (const l of arrows) {
            const a = Math.atan2(l.y - panY, l.x - panX);
            gl.uniform1f(uAngle, a);
            gl.uniform1f(uScale, Math.max(ARROW_MIN_SCALE, l.scale));
            gl.uniform3f(uOffset, panX + Math.cos(a) * ring, panY + Math.sin(a) * ring, 0.3);
            gl.uniform3f(uTint, ...l.tint);
            gl.drawArrays(gl.TRIANGLES, 0, arrowCount);
        }
    }

    const [mouseX, mouseY] = groundAt(screenX, screenY);
    hoverX += (mouseX - hoverX) * 0.05;
    hoverY += (mouseY - hoverY) * 0.05;

    if (pointCount) {
        useAttribs(program, pointBuffer, 32, [
            ['aPos', 3, 0],
            ['aColor', 3, 12],
            ['aSize', 1, 24],
            ['aAlpha', 1, 28]
        ]);
        gl.uniformMatrix4fv(uMvp, false, new Float32Array(mvp));
        gl.uniform2f(uMouse, hoverX, hoverY);
        const pigeonXY = new Float32Array(MAX_PIGEONS * 2);
        byDistance.slice(0, MAX_PIGEONS).forEach((p, i) => pigeonXY.set([p.x, p.y], i * 2));
        gl.uniform2fv(uPigeons, pigeonXY);
        gl.uniform1i(uPigeonCount, Math.min(byDistance.length, MAX_PIGEONS));
        gl.depthMask(false);
        gl.drawArrays(gl.POINTS, 0, pointCount);
    }
    requestAnimationFrame(frame);
}
frame();
const infoOverlay = document.getElementById('info-overlay');
document.getElementById('info-btn').addEventListener('click', () => infoOverlay.classList.add('open'));
document.getElementById('info-close').addEventListener('click', () => infoOverlay.classList.remove('open'));
infoOverlay.addEventListener('click', (e) => {
    if (e.target === infoOverlay) infoOverlay.classList.remove('open');
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') infoOverlay.classList.remove('open');
});
