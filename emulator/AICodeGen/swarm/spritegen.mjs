// spritegen.mjs — bake STAR SWARM sprites into 6502 .byte tables.
//
// Each sprite is authored here as ASCII art ('#' = lit pixel, anything else =
// blank) and emitted as:  .byte H, W, then H rows of 2 bytes (a 16-bit mask,
// leftmost pixel = bit 15 / high-byte bit 7).  draw_sprite in swarm.s walks the
// mask left-to-right with a 16-bit left shift, so this left-aligned packing is
// exactly what it expects.
//
// All art here is original to this project.
//
//   node emulator/AICodeGen/swarm/spritegen.mjs        # print the .byte tables
//   node emulator/AICodeGen/swarm/spritegen.mjs --art  # also echo the art back

const art = (rows) => rows;

// ---- player cannon (15 wide): trapezoid base + central barrel -------------
const CANNON = art([
  ".......#.......",
  "......###......",
  "......###......",
  "...#########...",
  ".#############.",
  "###############",
  "###############",
  "###############",
]);

// ---- three alien ranks, two animation frames each (12 wide) ---------------
// Rank A — small "moth" (top rows, worth most)
const A0 = art([
  ".....##.....",
  "....####....",
  "..########..",
  ".##.####.##.",
  "############",
  "..#.####.#..",
  ".#..#..#..#.",
  "..#......#..",
]);
const A1 = art([
  ".....##.....",
  "....####....",
  "..########..",
  ".##.####.##.",
  "############",
  "..#.####.#..",
  ".#........#.",
  "#..#....#..#",
]);

// Rank B — mid "crab"
const B0 = art([
  "..#......#..",
  "...#....#...",
  "..########..",
  ".##.##.##.#.",
  "############",
  "#.########.#",
  "#.#......#.#",
  "...##..##...",
]);
const B1 = art([
  "..#......#..",
  "#..#....#..#",
  "#.########.#",
  "##.####.##.#",
  "############",
  ".##########.",
  "..#......#..",
  ".#........#.",
]);

// Rank C — big "beetle" (bottom rows, worth least)
const C0 = art([
  "....####....",
  ".##########.",
  "############",
  "###.##.####.",
  "############",
  "...######...",
  "..##.##.##..",
  ".##......##.",
]);
const C1 = art([
  "....####....",
  ".##########.",
  "############",
  "###.##.####.",
  "############",
  "..#.####.#..",
  ".#.######.#.",
  "#.#......#.#",
]);

// ---- mystery saucer (16 wide) ---------------------------------------------
const UFO = art([
  ".....######.....",
  "...##########...",
  "..############..",
  ".##############.",
  "################",
  ".##.##.##.##.##.",
  "...##......##...",
]);

// ---- projectiles ----------------------------------------------------------
const SHOT = art([         // player shot: a 1x4 streak
  "#",
  "#",
  "#",
  "#",
]);
const BOMB = art([         // alien bomb: a 3x5 zigzag
  ".#.",
  "##.",
  ".#.",
  ".##",
  ".#.",
]);

// ---- destructible shield / bunker (14 wide): solid dome, arch cut below -----
const BUNKER = art([
  "..##########..",
  ".############.",
  "##############",
  "##############",
  "##############",
  "##############",
  "#####....#####",
  "####......####",
  "####......####",
  "###........###",
]);

const SPRITES = [
  ["SPR_CANNON", CANNON, 15],
  ["SPR_A0", A0, 12], ["SPR_A1", A1, 12],
  ["SPR_B0", B0, 12], ["SPR_B1", B1, 12],
  ["SPR_C0", C0, 12], ["SPR_C1", C1, 12],
  ["SPR_UFO", UFO, 16],
  ["SPR_SHOT", SHOT, 1],
  ["SPR_BOMB", BOMB, 3],
  ["SPR_BUNKER", BUNKER, 14],
];

function encode(name, rows, W) {
  const H = rows.length;
  const out = [H, W];
  for (const r of rows) {
    if (r.length > W) throw new Error(`${name}: row "${r}" wider than W=${W}`);
    let mask = 0;
    for (let c = 0; c < W; c++) {
      if (r[c] === "#") mask |= 1 << (15 - c);
    }
    out.push((mask >> 8) & 0xff, mask & 0xff);
  }
  return out;
}

const echoArt = process.argv.includes("--art");
let lines = [];
lines.push("; ==== generated sprites (spritegen.mjs) — original art ====");
for (const [name, rows, W] of SPRITES) {
  const bytes = encode(name, rows, W);
  if (echoArt) {
    console.error(`; ${name} ${W}x${rows.length}`);
    for (const r of rows) console.error("; " + r.replace(/[^#]/g, ".").padEnd(W, "."));
  }
  lines.push(`${name}:`);
  lines.push("        .byte " + bytes.join(","));
}
console.log(lines.join("\n"));
