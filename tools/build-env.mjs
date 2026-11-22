#!/usr/bin/env node
/*!
 * ETS2 2D | tools/build-env.mjs
 * Generates spatial 8192-unit environment chunk tiles (land, water, rail, buildings) from OpenStreetMap PBF.
 *
 * Data Source: OpenStreetMap contributors (Geofabrik moldova-latest.osm.pbf)
 * License: Open Database License (ODbL)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import parseOSM from 'osm-pbf-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PBF_PATH = path.join(DATA_DIR, 'moldova-latest.osm.pbf');
const TILES_DIR = path.join(DATA_DIR, 'env-tiles');
const INDEX_PATH = path.join(DATA_DIR, 'env-index.json');

const PBF_URL = 'https://download.geofabrik.de/europe/moldova-latest.osm.pbf';

// ==============================================================
// 1. PROJECTION & CONSTANTS (Reused from build-map.mjs)
// ==============================================================
export const ORIGIN_LON = 28.8353;
export const ORIGIN_LAT = 47.0105;
export const LAT0_RAD = (ORIGIN_LAT * Math.PI) / 180;
export const R = 6371000; // Earth radius in meters
export const MAP_SCALE = 1.25; // 1:8 scale (1 real meter = 1.25 px/units)
export const CHUNK_SIZE = 8192; // World units per chunk axis

export function project(lon, lat, scale = MAP_SCALE) {
  const x = 1200 + (lon - ORIGIN_LON) * (Math.PI / 180) * R * Math.cos(LAT0_RAD) * scale;
  const y = 3000 - (lat - ORIGIN_LAT) * (Math.PI / 180) * R * scale;
  return [Math.round(x), Math.round(y)];
}

// ==============================================================
// 2. ENVIRONMENT TYPES & CLASSIFICATIONS
// ==============================================================
export const LAND_TYPES = [
  'farmland',
  'vineyard',
  'orchard',
  'meadow',
  'forest',
  'residential',
  'industrial',
  'commercial',
  'retail',
  'cemetery',
  'wood',
  'water',
  'scrub'
];

const LANDUSE_SET = new Set([
  'farmland',
  'vineyard',
  'orchard',
  'meadow',
  'forest',
  'residential',
  'industrial',
  'commercial',
  'retail',
  'cemetery'
]);

const NATURAL_SET = new Set(['wood', 'water', 'scrub']);
const WATERWAY_SET = new Set(['river', 'stream', 'canal']);

// ==============================================================
// 3. DOUGLAS-PEUCKER SIMPLIFICATION (Flat coordinates)
// ==============================================================
export function douglasPeuckerFlat(coords, tolerance) {
  const n = coords.length / 2;
  if (n <= 2) return coords;

  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  function simplifySection(start, end) {
    if (end <= start + 1) return;

    const x1 = coords[start * 2];
    const y1 = coords[start * 2 + 1];
    const x2 = coords[end * 2];
    const y2 = coords[end * 2 + 1];

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    let maxSqDist = 0;
    let maxIdx = -1;

    for (let i = start + 1; i < end; i++) {
      const px = coords[i * 2];
      const py = coords[i * 2 + 1];
      let sqDist;

      if (lenSq === 0) {
        const dpx = px - x1;
        const dpy = py - y1;
        sqDist = dpx * dpx + dpy * dpy;
      } else {
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        const dpx = px - projX;
        const dpy = py - projY;
        sqDist = dpx * dpx + dpy * dpy;
      }

      if (sqDist > maxSqDist) {
        maxSqDist = sqDist;
        maxIdx = i;
      }
    }

    if (maxSqDist > sqTol) {
      keep[maxIdx] = 1;
      simplifySection(start, maxIdx);
      simplifySection(maxIdx, end);
    }
  }

  simplifySection(0, n - 1);

  let count = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i]) count++;
  }

  const result = new Array(count * 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      result[k++] = Math.round(coords[i * 2]);
      result[k++] = Math.round(coords[i * 2 + 1]);
    }
  }
  return result;
}

// ==============================================================
// 4. BUILDING BOUNDING BOX CALCULATION
// ==============================================================
export function calcBuildingBBox(coords) {
  const n = coords.length / 2;
  if (n < 4) return null; // Needs at least 3 vertices + closing

  // Shoelace area
  let area2 = 0;
  for (let i = 0; i < n - 1; i++) {
    area2 += coords[i * 2] * coords[(i + 1) * 2 + 1] - coords[(i + 1) * 2] * coords[i * 2 + 1];
  }
  const area = Math.abs(area2) * 0.5;
  if (area < 150) return null; // Minimum area >= 150 in world-units

  let minBoxArea = Infinity;
  let best = null;

  for (let i = 0; i < n - 1; i++) {
    const dx = coords[(i + 1) * 2] - coords[i * 2];
    const dy = coords[(i + 1) * 2 + 1] - coords[i * 2 + 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const cos = dx / len;
    const sin = dy / len;

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (let j = 0; j < n; j++) {
      const px = coords[j * 2];
      const py = coords[j * 2 + 1];
      const u = px * cos + py * sin;
      const v = -px * sin + py * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const w = maxU - minU;
    const h = maxV - minV;
    const boxArea = w * h;
    if (boxArea < minBoxArea) {
      minBoxArea = boxArea;
      const midU = (minU + maxU) * 0.5;
      const midV = (minV + maxV) * 0.5;
      const cx = midU * cos - midV * sin;
      const cy = midU * sin + midV * cos;
      const angle = Math.atan2(dy, dx);
      best = [
        Math.round(cx),
        Math.round(cy),
        Math.max(1, Math.round(w)),
        Math.max(1, Math.round(h)),
        Math.round(angle * 100) / 100,
        area
      ];
    }
  }

  // Fallback to axis-aligned box
  if (!best) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < n; j++) {
      const x = coords[j * 2];
      const y = coords[j * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    best = [
      Math.round((minX + maxX) * 0.5),
      Math.round((minY + maxY) * 0.5),
      Math.max(1, Math.round(w)),
      Math.max(1, Math.round(h)),
      0,
      area
    ];
  }

  return best;
}

// ==============================================================
// 5. CACHE CHECK
// ==============================================================
async function ensurePbfExists() {
  if (fs.existsSync(PBF_PATH)) {
    const stat = fs.statSync(PBF_PATH);
    if (stat.size > 10 * 1024 * 1024) {
      console.log(`[build-env] Found cached OSM data at ${PBF_PATH} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
  }

  const tmpPath = '/tmp/moldova-latest.osm.pbf';
  if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 10 * 1024 * 1024) {
    console.log(`[build-env] Copying from ${tmpPath} to ${PBF_PATH}...`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(tmpPath, PBF_PATH);
    return;
  }

  console.log(`[build-env] Downloading Moldova OSM data from Geofabrik (${PBF_URL})...`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  execSync(`curl -L -o "${PBF_PATH}" "${PBF_URL}"`, { stdio: 'inherit' });
  console.log(`[build-env] Download complete!`);
}

// ==============================================================
// 6. MAIN BUILD PIPELINE
// ==============================================================
async function buildEnv() {
  const startTime = Date.now();
  console.log('===========================================================');
  console.log('   ETS 2 MOLDOVA | Environment Chunk Tiles Builder (OSM)   ');
  console.log('===========================================================');

  await ensurePbfExists();

  const nodeIndexMap = new Map(); // OSM Node ID -> continuous index
  function getOrAddNodeIndex(id) {
    let idx = nodeIndexMap.get(id);
    if (idx === undefined) {
      idx = nodeIndexMap.size;
      nodeIndexMap.set(id, idx);
    }
    return idx;
  }

  const landWays = [];
  const waterWays = [];
  const railWays = [];

  // Compact typed buffers for buildings
  let buildingRefs = new Uint32Array(5500000);
  let buildingRefsCount = 0;
  let buildingOffsets = new Uint32Array(850000);
  let buildingCount = 0;

  function addBuildingRefs(refs) {
    if (buildingRefsCount + refs.length > buildingRefs.length) {
      const next = new Uint32Array(buildingRefs.length * 2);
      next.set(buildingRefs);
      buildingRefs = next;
    }
    if (buildingCount + 1 >= buildingOffsets.length) {
      const next = new Uint32Array(buildingOffsets.length * 2);
      next.set(buildingOffsets);
      buildingOffsets = next;
    }
    buildingOffsets[buildingCount] = buildingRefsCount;
    for (let i = 0; i < refs.length; i++) {
      buildingRefs[buildingRefsCount++] = getOrAddNodeIndex(refs[i]);
    }
    buildingCount++;
    buildingOffsets[buildingCount] = buildingRefsCount;
  }

  // -------------------------------------------------------------
  // PASS 1: Filter environment ways & register needed nodes
  // -------------------------------------------------------------
  console.log('\n[Pass 1/2] Scanning PBF to filter environment ways...');
  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    const stream = fs.createReadStream(PBF_PATH).pipe(osm);

    osm.on('data', items => {
      for (const item of items) {
        if (item.type !== 'way') continue;
        const tags = item.tags;
        if (!tags || !item.refs || item.refs.length < 2) continue;

        const isClosed = item.refs.length >= 4 && item.refs[0] === item.refs[item.refs.length - 1];

        // 1. Buildings (closed polygons)
        if (isClosed && tags.building) {
          addBuildingRefs(item.refs);
          continue;
        }

        // 2. Landuse & Natural (closed polygons)
        if (isClosed) {
          let typeCode = -1;
          if (tags.landuse && LANDUSE_SET.has(tags.landuse)) {
            typeCode = LAND_TYPES.indexOf(tags.landuse);
          } else if (tags.natural && NATURAL_SET.has(tags.natural)) {
            typeCode = LAND_TYPES.indexOf(tags.natural);
          }

          if (typeCode !== -1) {
            const refs = new Uint32Array(item.refs.length);
            for (let i = 0; i < item.refs.length; i++) {
              refs[i] = getOrAddNodeIndex(item.refs[i]);
            }
            landWays.push({ typeCode, refs });
            continue;
          }
        }

        // 3. Waterway (lines)
        if (tags.waterway && WATERWAY_SET.has(tags.waterway)) {
          const refs = new Uint32Array(item.refs.length);
          for (let i = 0; i < item.refs.length; i++) {
            refs[i] = getOrAddNodeIndex(item.refs[i]);
          }
          waterWays.push(refs);
          continue;
        }

        // 4. Railway (rail lines)
        if (tags.railway === 'rail') {
          const refs = new Uint32Array(item.refs.length);
          for (let i = 0; i < item.refs.length; i++) {
            refs[i] = getOrAddNodeIndex(item.refs[i]);
          }
          railWays.push(refs);
          continue;
        }
      }
    });

    osm.on('end', resolve);
    osm.on('error', reject);
    stream.on('error', reject);
  });

  const totalNodes = nodeIndexMap.size;
  console.log(`[Pass 1 done] Extracted ${landWays.length} land polygons, ${waterWays.length} water lines, ${railWays.length} rail lines, ${buildingCount} buildings.`);
  console.log(`[Pass 1 done] Required unique nodes: ${totalNodes.toLocaleString()}`);

  // -------------------------------------------------------------
  // PASS 2: Extract & project coordinates for needed nodes
  // -------------------------------------------------------------
  console.log('\n[Pass 2/2] Extracting node coordinates from PBF...');
  const coordsX = new Int32Array(totalNodes);
  const coordsY = new Int32Array(totalNodes);

  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    const stream = fs.createReadStream(PBF_PATH);
    stream.pipe(osm);

    let stopped = false;
    function cleanup() {
      if (stopped) return;
      stopped = true;
      stream.destroy();
      resolve();
    }

    osm.on('data', items => {
      if (stopped) return;
      for (const item of items) {
        if (item.type === 'node') {
          const idx = nodeIndexMap.get(item.id);
          if (idx !== undefined) {
            const [x, y] = project(item.lon, item.lat);
            coordsX[idx] = x;
            coordsY[idx] = y;
          }
        } else {
          cleanup();
          return;
        }
      }
    });

    osm.on('end', resolve);
    osm.on('error', err => { if (!stopped) reject(err); });
    stream.on('error', err => { if (!stopped) reject(err); });
  });

  // Free node map from memory
  nodeIndexMap.clear();
  console.log(`[Pass 2 done] Projected ${totalNodes.toLocaleString()} coordinates into game world units.`);

  // -------------------------------------------------------------
  // 7. GEOMETRY PROCESSING & SPATIAL CHUNKING
  // -------------------------------------------------------------
  console.log('\n[Chunking] Simplifying geometry and partitioning into 8192-unit chunks...');
  const chunks = new Map(); // key "cx_cy" -> { land: [], water: [], rail: [], buildings: [] }

  function getChunk(cx, cy) {
    const key = `${cx}_${cy}`;
    let c = chunks.get(key);
    if (!c) {
      c = { land: [], water: [], rail: [], buildings: [] };
      chunks.set(key, c);
    }
    return c;
  }

  // 1. Process Land polygons (tolerance ~8 world units)
  console.log(' - Processing landuse and natural polygons...');
  for (let w = 0; w < landWays.length; w++) {
    const way = landWays[w];
    const raw = new Array(way.refs.length * 2);
    for (let i = 0; i < way.refs.length; i++) {
      const idx = way.refs[i];
      raw[i * 2] = coordsX[idx];
      raw[i * 2 + 1] = coordsY[idx];
    }

    const simp = douglasPeuckerFlat(raw, 8.0);
    if (simp.length < 8) continue; // Degenerate polygon (< 3 unique vertices)

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < simp.length; i += 2) {
      const x = simp[i];
      const y = simp[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const minCx = Math.floor(minX / CHUNK_SIZE);
    const maxCx = Math.floor(maxX / CHUNK_SIZE);
    const minCy = Math.floor(minY / CHUNK_SIZE);
    const maxCy = Math.floor(maxY / CHUNK_SIZE);

    if (maxCx - minCx > 30 || maxCy - minCy > 30) continue; // Outlier protection

    const entry = [way.typeCode, simp];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        getChunk(cx, cy).land.push(entry);
      }
    }
  }

  // 2. Process Water lines (tolerance ~4 world units)
  console.log(' - Processing waterways...');
  for (let w = 0; w < waterWays.length; w++) {
    const refs = waterWays[w];
    const raw = new Array(refs.length * 2);
    for (let i = 0; i < refs.length; i++) {
      const idx = refs[i];
      raw[i * 2] = coordsX[idx];
      raw[i * 2 + 1] = coordsY[idx];
    }

    const simp = douglasPeuckerFlat(raw, 4.0);
    if (simp.length < 4) continue; // Degenerate line (< 2 vertices)

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < simp.length; i += 2) {
      const x = simp[i];
      const y = simp[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const minCx = Math.floor(minX / CHUNK_SIZE);
    const maxCx = Math.floor(maxX / CHUNK_SIZE);
    const minCy = Math.floor(minY / CHUNK_SIZE);
    const maxCy = Math.floor(maxY / CHUNK_SIZE);

    if (maxCx - minCx > 30 || maxCy - minCy > 30) continue;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        getChunk(cx, cy).water.push(simp);
      }
    }
  }

  // 3. Process Rail lines (tolerance ~4 world units)
  console.log(' - Processing railways...');
  for (let w = 0; w < railWays.length; w++) {
    const refs = railWays[w];
    const raw = new Array(refs.length * 2);
    for (let i = 0; i < refs.length; i++) {
      const idx = refs[i];
      raw[i * 2] = coordsX[idx];
      raw[i * 2 + 1] = coordsY[idx];
    }

    const simp = douglasPeuckerFlat(raw, 4.0);
    if (simp.length < 4) continue;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < simp.length; i += 2) {
      const x = simp[i];
      const y = simp[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const minCx = Math.floor(minX / CHUNK_SIZE);
    const maxCx = Math.floor(maxX / CHUNK_SIZE);
    const minCy = Math.floor(minY / CHUNK_SIZE);
    const maxCy = Math.floor(maxY / CHUNK_SIZE);

    if (maxCx - minCx > 30 || maxCy - minCy > 30) continue;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        getChunk(cx, cy).rail.push(simp);
      }
    }
  }

  // 4. Process Buildings (area >= 150 m², oriented bbox)
  console.log(` - Processing ${buildingCount} buildings...`);
  let qualifiedBuildings = 0;

  for (let b = 0; b < buildingCount; b++) {
    const start = buildingOffsets[b];
    const end = buildingOffsets[b + 1];
    const refLen = end - start;
    if (refLen < 4) continue;

    const raw = new Array(refLen * 2);
    for (let i = 0; i < refLen; i++) {
      const idx = buildingRefs[start + i];
      raw[i * 2] = coordsX[idx];
      raw[i * 2 + 1] = coordsY[idx];
    }

    const box = calcBuildingBBox(raw);
    if (!box) continue;
    qualifiedBuildings++;

    // Bounding box of the building
    const [cx, cy, w, h, angle, area] = box;
    const radius = Math.max(w, h);
    const minCx = Math.floor((cx - radius) / CHUNK_SIZE);
    const maxCx = Math.floor((cx + radius) / CHUNK_SIZE);
    const minCy = Math.floor((cy - radius) / CHUNK_SIZE);
    const maxCy = Math.floor((cy + radius) / CHUNK_SIZE);

    if (maxCx - minCx > 5 || maxCy - minCy > 5) continue;

    const bldEntry = [cx, cy, w, h, angle, area];
    for (let chX = minCx; chX <= maxCx; chX++) {
      for (let chY = minCy; chY <= maxCy; chY++) {
        getChunk(chX, chY).buildings.push(bldEntry);
      }
    }
  }
  console.log(` - Qualified buildings with area >= 150: ${qualifiedBuildings.toLocaleString()}`);

  // -------------------------------------------------------------
  // 8. WRITE CHUNKS & INDEX
  // -------------------------------------------------------------
  console.log('\n[Export] Writing chunk files to data/env-tiles/...');
  fs.mkdirSync(TILES_DIR, { recursive: true });

  const chunkKeys = [];
  let totalBytes = 0;
  let totalLandPolys = 0;
  let totalBuildings = 0;
  let maxPolysInChunk = 0;

  for (const [key, chunk] of chunks.entries()) {
    // Limit buildings to top 120 largest by area
    if (chunk.buildings.length > 120) {
      chunk.buildings.sort((a, b) => b[5] - a[5]);
      chunk.buildings = chunk.buildings.slice(0, 120);
    }
    // Remove the area element: [cx, cy, w, h, angle]
    chunk.buildings = chunk.buildings.map(b => [b[0], b[1], b[2], b[3], b[4]]);

    const polyCount = chunk.land.length + chunk.buildings.length;
    if (polyCount === 0 && chunk.water.length === 0 && chunk.rail.length === 0) {
      continue; // Skip empty chunks
    }

    chunkKeys.push(key);
    totalLandPolys += chunk.land.length;
    totalBuildings += chunk.buildings.length;
    if (polyCount > maxPolysInChunk) {
      maxPolysInChunk = polyCount;
    }

    const filePath = path.join(TILES_DIR, `${key}.json`);
    const jsonStr = JSON.stringify(chunk);
    fs.writeFileSync(filePath, jsonStr, 'utf8');
    totalBytes += Buffer.byteLength(jsonStr, 'utf8');
  }

  chunkKeys.sort();

  // Write index file
  const indexData = {
    chunkSize: CHUNK_SIZE,
    mapScale: MAP_SCALE,
    types: LAND_TYPES,
    chunks: chunkKeys
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexData, null, 2), 'utf8');

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
  const avgPolys = chunkKeys.length > 0 ? (totalLandPolys / chunkKeys.length).toFixed(1) : '0';
  const avgBuildings = chunkKeys.length > 0 ? (totalBuildings / chunkKeys.length).toFixed(1) : '0';
  const avgTotalPolys = chunkKeys.length > 0 ? ((totalLandPolys + totalBuildings) / chunkKeys.length).toFixed(1) : '0';

  console.log('\n===========================================================');
  console.log('   ENVIRONMENT CHUNK BUILD COMPLETE                       ');
  console.log('===========================================================');
  console.log(`- Time elapsed:       ${elapsedSec}s`);
  console.log(`- Chunks created:     ${chunkKeys.length}`);
  console.log(`- Total tiles size:   ${totalMB} MB`);
  console.log(`- Land polygons/chunk: avg ${avgPolys}`);
  console.log(`- Buildings/chunk:    avg ${avgBuildings}`);
  console.log(`- Total polys/chunk:  avg ${avgTotalPolys}, max ${maxPolysInChunk}`);
  console.log(`- Index written to:   ${path.relative(ROOT, INDEX_PATH)}`);
  console.log(`- Tiles written to:   ${path.relative(ROOT, TILES_DIR)}/`);
  console.log('===========================================================\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildEnv().catch(err => {
    console.error('[build-env] Fatal error:', err);
    process.exit(1);
  });
}
