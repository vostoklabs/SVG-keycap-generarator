// Convert the keycap STEP file to an indexed mesh + metadata the web app loads.
// Run with: npm run convert   (re-run if you swap in a different keycap .stp)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import occtimportjs from 'occt-import-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- locate the .stp file (first one in the project root) ---
const stepName =
  process.argv[2] ||
  readdirSync(root).find((f) => /\.(stp|step)$/i.test(f));
if (!stepName) {
  console.error('No .stp/.step file found in project root.');
  process.exit(1);
}
const stepPath = join(root, stepName);
console.log(`Reading ${stepName} ...`);

const occt = await occtimportjs();
const buf = new Uint8Array(readFileSync(stepPath));

// Fine tessellation so the dished top reads as smooth (chordal error 0.04 mm).
const result = occt.ReadStepFile(buf, {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.04,
  angularDeflection: 0.2,
});

if (!result || !result.success || !result.meshes?.length) {
  console.error('STEP import failed.');
  process.exit(1);
}

// --- merge every shell/face mesh into one indexed buffer ---
const positions = [];
const indices = [];
let vertexOffset = 0;
for (const mesh of result.meshes) {
  const p = mesh.attributes.position.array;
  for (let i = 0; i < p.length; i++) positions.push(p[i]);
  const idx = mesh.index.array;
  for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
  vertexOffset += p.length / 3;
}

// --- bounding box + top-surface metadata (units = mm, Z up) ---
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    const v = positions[i + a];
    if (v < min[a]) min[a] = v;
    if (v > max[a]) max[a] = v;
  }
}
const centerX = (min[0] + max[0]) / 2;
const centerY = (min[1] + max[1]) / 2;
const topZ = max[2];

// Top-rim opening: lateral extent of vertices within 1.2 mm of the very top.
// Lowest point of the dish (near the lateral centre): the seat for preview.
let rimMinX = Infinity, rimMaxX = -Infinity, rimMinY = Infinity, rimMaxY = -Infinity;
let dishBottomZ = topZ;
const halfX = (max[0] - min[0]) / 2;
const halfY = (max[1] - min[1]) / 2;
for (let i = 0; i < positions.length; i += 3) {
  const x = positions[i], y = positions[i + 1], z = positions[i + 2];
  if (z >= topZ - 1.2) {
    if (x < rimMinX) rimMinX = x; if (x > rimMaxX) rimMaxX = x;
    if (y < rimMinY) rimMinY = y; if (y > rimMaxY) rimMaxY = y;
  }
  // central 40% of the cap, upper half in Z -> find the dish's lowest point
  if (Math.abs(x - centerX) < halfX * 0.4 && Math.abs(y - centerY) < halfY * 0.4 && z > (min[2] + max[2]) / 2) {
    if (z < dishBottomZ) dishBottomZ = z;
  }
}

const meta = {
  generatedFrom: stepName,
  generatedAt: new Date().toISOString(),
  triangles: indices.length / 3,
  vertices: positions.length / 3,
  bbox: { min, max },
  center: [centerX, centerY],
  topZ,                 // highest point of the cap (rim of the dish)
  dishBottomZ,          // lowest point of the dished top (seat for the logo preview)
  topExtent: [rimMaxX - rimMinX, rimMaxY - rimMinY], // usable opening of the top dish
};

const round = (n) => Math.round(n * 1e4) / 1e4;
const out = {
  meta,
  positions: positions.map(round),
  indices,
};

const outPath = join(root, 'public', 'keycap.json');
writeFileSync(outPath, JSON.stringify(out));
console.log('Wrote public/keycap.json');
console.log(JSON.stringify(meta, null, 2));
