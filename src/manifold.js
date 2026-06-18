import * as THREE from 'three';
import ManifoldModule from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { weldPositions } from './meshUtils.js';

let api = null;

// Load the Manifold WASM once. `locateFile` points Emscripten at the asset Vite serves.
export async function initManifold() {
  if (api) return api;
  const wasm = await ManifoldModule({ locateFile: () => wasmUrl });
  wasm.setup();
  api = wasm;
  return api;
}

// three geometry -> Manifold solid (must be welded/watertight first).
export function geomToManifold(geom) {
  const g = weldPositions(geom);
  const { Manifold, Mesh } = api;
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: new Float32Array(g.getAttribute('position').array),
    triVerts: new Uint32Array(g.getIndex().array),
  });
  return Manifold.ofMesh(mesh);
}

// Manifold solid -> three geometry. Copies out of WASM memory so it survives delete().
export function manifoldToGeom(man) {
  const m = man.getMesh();
  const np = m.numProp;
  const vp = m.vertProperties;
  const pos = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    pos[i * 3] = vp[i * np];
    pos[i * 3 + 1] = vp[i * np + 1];
    pos[i * 3 + 2] = vp[i * np + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  g.computeVertexNormals();
  return g;
}

// 2D contours -> vertical prism spanning bottomZ .. bottomZ + height.
// NonZero fill matches SVG and cleanly unions any self-overlapping paths.
export function extrudePrism(contours, bottomZ, height) {
  const { CrossSection } = api;
  const cs = new CrossSection(contours, 'NonZero');
  const solid = cs.extrude(height).translate([0, 0, bottomZ]);
  cs.delete();
  return solid;
}
