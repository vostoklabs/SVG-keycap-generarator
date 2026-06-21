import * as THREE from 'three';

// Load a pre-converted keycap's meshes + metadata (see scripts/convert-keycap.mjs).
// The shell (walls + dished top) lives in the top-level positions/indices; the switch
// stem(s), when present, are merged into one separate body the app can recolour on its own.
// `url` selects which size to load; it defaults to the single-cap file for back-compat.
export async function loadKeycap(url = 'keycap.json') {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} not found — run \`npm run convert\` first.`);
  }
  const data = await res.json();

  const makeGeom = (body) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(body.positions, 3));
    geometry.setIndex(body.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return geometry;
  };

  const shellGeometry = makeGeom({ positions: data.positions, indices: data.indices });
  const stemGeometry = data.stem ? makeGeom(data.stem) : null;

  return { shellGeometry, stemGeometry, meta: data.meta };
}
