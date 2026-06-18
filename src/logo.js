import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

// Parse SVG markup into 2D contours (one polyline per sub-path) + combined bounds.
// Manifold's NonZero fill rule turns these into a clean filled region with holes,
// even when a path overlaps itself.
export function parseSvg(svgText) {
  const data = new SVGLoader().parse(svgText);
  const contours = [];
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );
  for (const path of data.paths) {
    for (const sub of path.subPaths) {
      const pts = sub.getPoints(16);
      if (pts.length < 3) continue;
      const c = [];
      for (const p of pts) { box.expandByPoint(p); c.push([p.x, p.y]); }
      contours.push(c);
    }
  }
  if (!contours.length) throw new Error('No drawable paths found in this SVG.');
  return { contours, box };
}

// Footprint (mm) the logo will occupy, for default sizing / overflow warnings.
export function logoFootprint(box, widthMM) {
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const span = Math.max(dx, dy) || 1;
  const s = widthMM / span;
  return { w: dx * s, h: dy * s };
}
