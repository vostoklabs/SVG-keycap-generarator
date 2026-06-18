import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Weld coincident vertices by POSITION ONLY.
 *
 * The keycap tessellation (and three's ExtrudeGeometry) store per-face vertices with
 * per-face normals/uvs, so the stock mergeVertices won't fuse shared edges — the seams
 * differ in normal/uv. Stripping to position first lets us recover a watertight,
 * manifold solid, which is what CSG and the 3MF need. 1e-3 mm matches the tessellator's
 * precision without over-welding real detail.
 */
export function weldPositions(geom, tol = 1e-3) {
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', geom.getAttribute('position').clone());
  if (geom.index) p.setIndex(geom.index.clone());
  return mergeVertices(p, tol);
}
