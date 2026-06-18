// Standalone CSG debugging: load the cap, try subtractions, report watertightness.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(root, 'public/keycap.json')));

function weldPositions(geom, tol = 1e-3) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', geom.getAttribute('position').clone());
  if (geom.index) p.setIndex(geom.index.clone());
  return mergeVertices(p, tol);
}

function check(geom, label, q = 1e3) {
  const pos = geom.getAttribute('position');
  const idx = geom.index ? geom.index.array : [...Array(pos.count).keys()];
  const id = new Map(), vid = [];
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    if (!id.has(k)) id.set(k, id.size);
    vid[i] = id.get(k);
  }
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const v = [vid[idx[t]], vid[idx[t + 1]], vid[idx[t + 2]]];
    for (let e = 0; e < 3; e++) {
      const A = v[e], B = v[(e + 1) % 3];
      const k = A < B ? `${A}_${B}` : `${B}_${A}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let b = 0, nm = 0;
  for (const c of edges.values()) { if (c === 1) b++; else if (c !== 2) nm++; }
  console.log(`${label}: tris=${idx.length / 3} welded=${id.size} boundary=${b} nonManifold=${nm}`);
  return { b, nm };
}

const cap = new THREE.BufferGeometry();
cap.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
cap.setIndex(data.indices);

const capW = weldPositions(cap);
capW.computeVertexNormals();
check(cap, 'cap raw    ');
check(capW, 'cap welded ');

function carve(toolGeom, label) {
  const ev = new Evaluator();
  ev.useGroups = false;
  ev.attributes = ['position', 'normal'];
  const a = new Brush(capW);
  a.updateMatrixWorld();
  const tg = weldPositions(toolGeom); tg.computeVertexNormals();
  const b = new Brush(tg);
  b.updateMatrixWorld();
  const out = ev.evaluate(a, b, SUBTRACTION);
  check(out.geometry, label);
}

const top = data.meta.topZ;
const [cx, cy] = data.meta.center;

// 1) plain box poking 0.02mm above the flat top
const box = new THREE.BoxGeometry(6, 6, 1);
box.translate(cx, cy, top + 0.02 - 0.5);
carve(box, 'cap - box(eps .02)');

// 2) box poking 2mm above the top (no near-coplanar faces)
const box2 = new THREE.BoxGeometry(6, 6, 2.5);
box2.translate(cx, cy, top + 2 - 1.25);
carve(box2, 'cap - box(proud 2) ');

// 3) cylinder poking 2mm above (rounded cut)
const cyl = new THREE.CylinderGeometry(3, 3, 2.5, 48);
cyl.rotateX(Math.PI / 2);
cyl.translate(cx, cy, top + 2 - 1.25);
carve(cyl, 'cap - cyl(proud 2) ');
