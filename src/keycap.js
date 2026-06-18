import * as THREE from 'three';

// Load the pre-converted keycap mesh + metadata (see scripts/convert-keycap.mjs).
export async function loadKeycap() {
  const res = await fetch('keycap.json');
  if (!res.ok) {
    throw new Error('keycap.json not found — run `npm run convert` first.');
  }
  const data = await res.json();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  return { geometry, meta: data.meta };
}
