#!/usr/bin/env node
/*!
 * ETS2 2D | tools/export-godot.mjs
 * Exports Moldova road network edges into godot/data/roads.json as a flat array [x1, y1, x2, y2, width].
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const MAP_JSON = path.join(ROOT, 'data', 'moldova-map.json');
const OUT_DIR = path.join(ROOT, 'godot', 'data');
const OUT_FILE = path.join(OUT_DIR, 'roads.json');

function getEdgeLanes(edge) {
  if (!edge) return 2;
  const rc = edge.roadClass || '';
  if (rc.endsWith('_link')) return 1;
  let lanes = 2;
  if (edge.oneway) {
    if (edge.lanes && edge.lanes > 0) lanes = edge.lanes;
    else if (rc === 'motorway' || rc === 'trunk' || rc === 'primary') lanes = 2;
    else lanes = 1;
  } else {
    if (edge.lanes && edge.lanes > 0) lanes = edge.lanes;
    else lanes = 2;
  }
  return Math.min(3, Math.max(1, lanes));
}

function getRoadWidth(edge) {
  const rc = edge.roadClass || '';
  if (rc.endsWith('_link')) return 36;
  const lanes = getEdgeLanes(edge);
  const hasShoulder = rc === 'motorway' || rc === 'trunk' || rc === 'primary' || rc === 'secondary';
  const shoulder = hasShoulder ? 10 : 0;
  return lanes * 36 + shoulder * 2;
}

function exportGodotRoads() {
  console.log('[export-godot] Reading', MAP_JSON, '...');
  const mapData = JSON.parse(fs.readFileSync(MAP_JSON, 'utf8'));

  const segments = [];
  for (const edge of mapData.edges) {
    if (!edge.points || edge.points.length < 2) continue;
    const width = getRoadWidth(edge);
    const pts = edge.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      segments.push([
        Math.round(p1[0]),
        Math.round(p1[1]),
        Math.round(p2[0]),
        Math.round(p2[1]),
        width
      ]);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(segments), 'utf8');

  const stat = fs.statSync(OUT_FILE);
  console.log(`[export-godot] Exported ${segments.length} road segments to ${path.relative(ROOT, OUT_FILE)} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}

exportGodotRoads();
