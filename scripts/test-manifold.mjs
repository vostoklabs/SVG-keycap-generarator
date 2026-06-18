import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ManifoldModule from 'manifold-3d';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(root, 'public/keycap.json')));

const wasm = await ManifoldModule();
wasm.setup();
const { Manifold, Mesh } = wasm;

function weldPositions(geom, tol = 1e-3) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', geom.getAttribute('position').clone());
  if (geom.index) p.setIndex(geom.index.clone());
  return mergeVertices(p, tol);
}

function toManifold(geom) {
  const g = weldPositions(geom);
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.getAttribute('position').array),
    triVerts: new Uint32Array(g.getIndex().array),
  });
  return Manifold.ofMesh(mesh);
}

function check(mesh, label, q = 1e3) {
  const pos = mesh.vertProperties, idx = mesh.triVerts;
  const id = new Map(), vid = [];
  for (let i = 0; i < pos.length; i += 3) {
    const k = `${Math.round(pos[i] * q)},${Math.round(pos[i + 1] * q)},${Math.round(pos[i + 2] * q)}`;
    if (!id.has(k)) id.set(k, id.size);
    vid[i / 3] = id.get(k);
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
  console.log(`${label}: tris=${idx.length / 3} boundary=${b} nonManifold=${nm}`);
}

const cap = new THREE.BufferGeometry();
cap.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
cap.setIndex(data.indices);
const capM = toManifold(cap);
console.log('cap genus:', capM.genus(), 'volume:', capM.volume().toFixed(1));

const top = data.meta.topZ;
const [cx, cy] = data.meta.center;

function carve(toolGeom, label) {
  const out = capM.subtract(toManifold(toolGeom));
  check(out.getMesh(), label);
}

const box = new THREE.BoxGeometry(6, 6, 1);
box.translate(cx, cy, top + 0.02 - 0.5);
carve(box, 'cap - box(eps .02)');

const cyl = new THREE.CylinderGeometry(3, 3, 1, 64);
cyl.rotateX(Math.PI / 2);
cyl.translate(cx, cy, top + 0.02 - 0.5);
carve(cyl, 'cap - cyl       ');
