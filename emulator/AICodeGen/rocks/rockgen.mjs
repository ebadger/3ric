// rockgen.mjs — precompute all ROCK STORM geometry tables as 6502 .byte lines.
// Only the ship rotates, and the assembler has no multiply, so we bake every
// rotated silhouette / heading / rock polygon here and paste the output into
// rocks.s.  All shapes are original.
const NANG = 32;
const b = (v) => (((Math.round(v) % 256) + 256) % 256);        // signed -> byte
const row = (name, arr) => `${name}:\n        .byte ` + arr.map(b).join(",");

// ---- ship silhouette in ship space, nose pointing +x (original arrowhead) ----
const SHIP = [ [7,0], [-5,-4], [-2,0], [-5,4] ];   // 4 verts, drawn as a loop
const NV = SHIP.length;

// ---- thrust flame in ship space: a small triangle poking out the tail,
//      opposite the nose (original).  Drawn only while the engine is firing. ----
const FLAME = [ [-4,-2], [-9,0], [-4,2] ];         // 3 verts, drawn as a loop
const FNV = FLAME.length;

const shpx = [], shpy = [], nosex = [], nosey = [];
const flamex = [], flamey = [];
const accx = [], accy = [], bvxl = [], bvxh = [], bvyl = [], bvyh = [];
const ACC = 40;        // thrust accel, 8.8 fraction units (~0.156 px/frame^2)
const BSPD = 4.2;      // bullet speed px/frame

for (let a = 0; a < NANG; a++) {
  const th = a * 2 * Math.PI / NANG;
  const c = Math.cos(th), s = Math.sin(th);
  for (let v = 0; v < NV; v++) {
    const [x, y] = SHIP[v];
    shpx.push(x * c - y * s);
    shpy.push(x * s + y * c);
  }
  // nose = rotated first vertex
  nosex.push(SHIP[0][0] * c - SHIP[0][1] * s);
  nosey.push(SHIP[0][0] * s + SHIP[0][1] * c);
  // thrust flame vertices (rotated with the ship)
  for (let v = 0; v < FNV; v++) {
    const [x, y] = FLAME[v];
    flamex.push(x * c - y * s);
    flamey.push(x * s + y * c);
  }
  // thrust accel (8.8 fraction, signed byte)
  accx.push(c * ACC);
  accy.push(s * ACC);
  // bullet velocity, signed 16-bit 8.8
  const vx = Math.round(c * BSPD * 256), vy = Math.round(s * BSPD * 256);
  bvxl.push(vx & 255); bvxh.push((vx >> 8) & 255);
  bvyl.push(vy & 255); bvyh.push((vy >> 8) & 255);
}

// ---- rocks: 3 lumpy octagons x 3 sizes (original shapes) --------------------
const RJIT = [
  [1.00,0.70,1.00,0.75,1.00,0.70,0.95,0.80],
  [0.80,1.00,0.72,1.00,0.82,1.00,0.70,1.00],
  [1.00,0.85,0.68,0.92,1.00,0.75,0.90,0.70],
];
const RSIZE = [5, 10, 17];        // small, med, large radius
const RN = 8;                     // verts per rock
const rockx = [], rocky = [];
for (let sh = 0; sh < RJIT.length; sh++)
  for (let sz = 0; sz < RSIZE.length; sz++)
    for (let k = 0; k < RN; k++) {
      const th = k * 2 * Math.PI / RN + (sh * 0.15);
      const r = RSIZE[sz] * RJIT[sh][k];
      rockx.push(r * Math.cos(th));
      rocky.push(r * Math.sin(th));
    }

// ---- rock drift velocities: 16 directions, slow drift (signed 8.8) ----------
const dvxl = [], dvxh = [], dvyl = [], dvyh = [];
const NDRIFT = 16;
const DSPD = 0.6;                 // rock drift speed, px/frame
for (let d = 0; d < NDRIFT; d++) {
  const th = d * 2 * Math.PI / NDRIFT + 0.19;  // offset so none are axis-aligned
  const vx = Math.round(Math.cos(th) * DSPD * 256);
  const vy = Math.round(Math.sin(th) * DSPD * 256);
  dvxl.push(vx & 255); dvxh.push((vx >> 8) & 255);
  dvyl.push(vy & 255); dvyh.push((vy >> 8) & 255);
}

const out = [];
out.push("; ==== generated geometry (rockgen.mjs) — original shapes ====");
out.push(`; NANG=${NANG}, ship verts=${NV}, rock shapes=${RJIT.length}, sizes=${RSIZE.join("/")}`);
out.push(row("SHPX", shpx));
out.push(row("SHPY", shpy));
out.push(row("NOSEX", nosex));
out.push(row("NOSEY", nosey));
out.push(row("FLAMEX", flamex));
out.push(row("FLAMEY", flamey));
out.push(row("ACCX", accx));
out.push(row("ACCY", accy));
out.push(row("BVXL", bvxl));
out.push(row("BVXH", bvxh));
out.push(row("BVYL", bvyl));
out.push(row("BVYH", bvyh));
out.push(row("ROCKX", rockx));
out.push(row("ROCKY", rocky));
out.push(row("DVXL", dvxl));
out.push(row("DVXH", dvxh));
out.push(row("DVYL", dvyl));
out.push(row("DVYH", dvyh));
console.log(out.join("\n"));

// echo a few sanity values as comments to stderr
const near = (x) => Math.abs(x) < 0.5 ? 0 : Math.round(x);
console.error("sanity: nose@0 =", near(nosex[0]), near(nosey[0]),
              "| nose@8(90) =", near(nosex[8]), near(nosey[8]),
              "| acc@0 =", Math.round(accx[0]), Math.round(accy[0]),
              "| bvel@0 =", bvxl[0]|(bvxh[0]<<8));
