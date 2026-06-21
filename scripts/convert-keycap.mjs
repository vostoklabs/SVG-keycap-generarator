// Convert the keycap STEP files to indexed meshes + metadata the web app loads.
// Run with: npm run convert   (re-run whenever you add/replace a .stp in the folder)
//
// Each STEP is expected to hold the cap SHELL (walls + dished top, hollow underneath)
// plus one or more switch STEMs. Shell and stems are emitted as separate bodies so the
// app can recolour the stem(s) on their own (shine-through mode). The shell goes in the
// top-level positions/indices (back-compat with the dev test scripts); the stem(s) merge
// into `stem`. A single-solid STEP still works — everything becomes the shell, no stem.
//
// Every .stp/.step in `Step files of keycaps/` becomes one public/keycaps/<id>.json, and
// a public/keycaps/index.json manifest lists them (id, label, file) for the size dropdown.
// public/keycap.json is also written as the default unit so the dev scripts keep working.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import occtimportjs from 'occt-import-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const stepDir = join(root, 'Step files of keycaps');
const outDir = join(root, 'public', 'keycaps');

// --- locate the .stp/.step files ---
let stepFiles;
try {
  stepFiles = readdirSync(stepDir).filter((f) => /\.(stp|step)$/i.test(f));
} catch {
  console.error(`Folder not found: ${stepDir}`);
  process.exit(1);
}
if (!stepFiles.length) {
  console.error(`No .stp/.step files in ${stepDir}`);
  process.exit(1);
}

// Derive a unit, a friendly label, a URL-safe id and a sort key from the file name.
// Examples: "1 u" -> 1u · "1,25 u" -> 1.25u · "2 u, 3 stems" -> 2u (3 stems) ·
//           "6,5 u spacebar" -> 6.5u Spacebar
function parseKeycapName(file) {
  const base = basename(file).replace(/\.(stp|step)$/i, '');
  // Leading number uses comma as the decimal separator ("1,25 u").
  const m = base.match(/^\s*(\d+(?:,\d+)?)\s*u/i);
  const unit = m ? parseFloat(m[1].replace(',', '.')) : 0;
  const unitStr = m ? m[1].replace(',', '.') : '?';

  const isSpacebar = /spacebar/i.test(base);
  const stemMatch = base.match(/(\d+)\s*stems?/i);
  const stemCount = stemMatch ? parseInt(stemMatch[1], 10) : 0;

  let label = `${unitStr}u`;
  if (isSpacebar) label += ' Spacebar';
  else if (stemCount) label += ` (${stemCount} stem${stemCount === 1 ? '' : 's'})`;

  let id = `${unitStr.replace('.', '_')}u`;
  if (isSpacebar) id += '-spacebar';
  else if (stemCount) id += `-${stemCount}stem`;

  return { id, label, unit, isSpacebar, stemCount };
}

const bboxOf = (positions) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
};

const mergeBodies = (bodies) => {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const b of bodies) {
    for (const v of b.positions) positions.push(v);
    for (const i of b.indices) indices.push(i + offset);
    offset += b.positions.length / 3;
  }
  return { positions, indices };
};

const round = (n) => Math.round(n * 1e4) / 1e4;

const occt = await occtimportjs();

// Tessellate one STEP file and return { out, meta } ready to serialise.
function convertStep(stepPath, stepFile) {
  const buf = new Uint8Array(readFileSync(stepPath));

  // Fine tessellation so the dished top reads as smooth (chordal error 0.04 mm).
  const result = occt.ReadStepFile(buf, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: 0.04,
    angularDeflection: 0.2,
  });
  if (!result || !result.success || !result.meshes?.length) {
    throw new Error(`STEP import failed for ${stepFile}`);
  }

  const bodies = result.meshes.map((mesh) => ({
    positions: Array.from(mesh.attributes.position.array),
    indices: Array.from(mesh.index.array),
  }));

  // Classify bodies by XY footprint. The shell dwarfs every stem, so anything under a
  // quarter of the largest footprint is a stem (robust for 1 stem, N stems, spacebars).
  const ranked = bodies.map((b) => {
    const bb = bboxOf(b.positions);
    return { b, fp: (bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]) };
  });
  const maxFp = Math.max(...ranked.map((r) => r.fp));
  const stemParts = ranked.filter((r) => r.fp < maxFp * 0.25);
  const shellParts = ranked.filter((r) => r.fp >= maxFp * 0.25);

  const hasStem = stemParts.length > 0;
  const shell = mergeBodies(shellParts.map((e) => e.b));
  const stem = hasStem ? mergeBodies(stemParts.map((e) => e.b)) : null;
  console.log(
    `  ${bodies.length} bodies · ${stemParts.length} stem${stemParts.length === 1 ? '' : 's'}` +
      ` (${stemParts.map((e) => e.fp.toFixed(0)).join('+') || '—'} mm²)` +
      ` · shell ${shellParts.map((e) => e.fp.toFixed(0)).join('+')} mm²`
  );

  // --- bounding box + top-surface metadata from the SHELL (units = mm, Z up) ---
  const { min, max } = bboxOf(shell.positions);
  const centerX = (min[0] + max[0]) / 2;
  const centerY = (min[1] + max[1]) / 2;
  const topZ = max[2];

  // Top-rim opening: lateral extent of vertices within 1.2 mm of the very top.
  // Lowest point of the dish (near the lateral centre): the seat for preview.
  let rimMinX = Infinity, rimMaxX = -Infinity, rimMinY = Infinity, rimMaxY = -Infinity;
  let dishBottomZ = topZ;
  const halfX = (max[0] - min[0]) / 2;
  const halfY = (max[1] - min[1]) / 2;
  const P = shell.positions;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (z >= topZ - 1.2) {
      if (x < rimMinX) rimMinX = x; if (x > rimMaxX) rimMaxX = x;
      if (y < rimMinY) rimMinY = y; if (y > rimMaxY) rimMaxY = y;
    }
    // central 40% of the cap, upper half in Z -> find the dish's lowest point
    if (Math.abs(x - centerX) < halfX * 0.4 && Math.abs(y - centerY) < halfY * 0.4 && z > (min[2] + max[2]) / 2) {
      if (z < dishBottomZ) dishBottomZ = z;
    }
  }

  const totalTris = (shell.indices.length + (stem?.indices.length || 0)) / 3;
  const totalVerts = (shell.positions.length + (stem?.positions.length || 0)) / 3;

  const meta = {
    generatedFrom: stepFile,
    generatedAt: new Date().toISOString(),
    triangles: totalTris,
    vertices: totalVerts,
    bbox: { min, max },          // shell bounds
    center: [centerX, centerY],
    topZ,                 // highest point of the cap (rim of the dish)
    dishBottomZ,          // lowest point of the dished top (seat for the logo preview)
    topExtent: [rimMaxX - rimMinX, rimMaxY - rimMinY], // usable opening of the top dish
    hasStem,
    stemBbox: stem ? bboxOf(stem.positions) : null,
  };

  const out = {
    meta,
    positions: shell.positions.map(round),  // shell (top-level = back-compat with dev scripts)
    indices: shell.indices,
  };
  if (stem) {
    out.stem = { positions: stem.positions.map(round), indices: stem.indices };
  }
  return { out, meta };
}

mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const stepFile of stepFiles) {
  const info = parseKeycapName(stepFile);
  console.log(`Reading ${stepFile}  ->  ${info.id} ("${info.label}")`);
  const { out } = convertStep(join(stepDir, stepFile), stepFile);
  writeFileSync(join(outDir, `${info.id}.json`), JSON.stringify(out));
  manifest.push({ ...info, file: `keycaps/${info.id}.json`, out });
}

// Order the dropdown: by unit, then plain < stem-count variants < spacebar.
manifest.sort((a, b) =>
  a.unit - b.unit ||
  Number(a.isSpacebar) - Number(b.isSpacebar) ||
  a.stemCount - b.stemCount
);

// Default = the 1u cap if present, else the first entry.
const defaultEntry = manifest.find((e) => e.id === '1u') || manifest[0];

const index = {
  default: defaultEntry.id,
  keycaps: manifest.map(({ id, label, file, unit }) => ({ id, label, file, unit })),
};
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

// Keep public/keycap.json as the default unit (dev scripts + back-compat).
writeFileSync(join(root, 'public', 'keycap.json'), JSON.stringify(defaultEntry.out));

console.log(`\nWrote ${manifest.length} keycaps to public/keycaps/ + index.json`);
console.log(`Default: ${defaultEntry.id} (also public/keycap.json)`);
