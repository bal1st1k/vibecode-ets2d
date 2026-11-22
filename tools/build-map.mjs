#!/usr/bin/env node
/*!
 * ETS2 2D | tools/build-map.mjs
 * Downloads OpenStreetMap data of Moldova and builds a true-to-life 1:19 road graph.
 * 
 * Data Source: OpenStreetMap contributors (Geofabrik moldova-latest.osm.pbf)
 * License: Open Database License (ODbL)
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import parseOSM from 'osm-pbf-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PBF_PATH = path.join(DATA_DIR, 'moldova-latest.osm.pbf');
const JSON_OUT_PATH = path.join(DATA_DIR, 'moldova-map.json');
const JS_OUT_PATH = path.join(DATA_DIR, 'moldova-map.js');

const PBF_URL = 'https://download.geofabrik.de/europe/moldova-latest.osm.pbf';

// ==============================================================
// 1. PROJECTION & SCALE CONSTANTS
// ==============================================================
// Chișinău Geographic Anchor: 47.0105° N, 28.8353° E -> Game (1200, 3000)
export const ORIGIN_LON = 28.8353;
export const ORIGIN_LAT = 47.0105;
export const LAT0_RAD = (ORIGIN_LAT * Math.PI) / 180;
export const R = 6371000; // Earth radius in meters

function getCliArg(name, defaultValue) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1].trim();
  }
  return defaultValue;
}

function parseScale(val) {
  if (!val) return 1.25; // default 1:8 scale (1 real meter = 1.25 px)
  if (typeof val === 'number') return val;
  val = String(val).trim();
  if (val.includes(':')) {
    const [num, den] = val.split(':').map(Number);
    if (num > 0 && den > 0) return 10 / (den / num); // e.g. 1:8 -> 10 / 8 = 1.25; 1:19 -> 10 / 19 = 0.5263
  }
  if (val.includes('/')) {
    const [num, den] = val.split('/').map(Number);
    if (num > 0 && den > 0) return 10 / (den / num);
  }
  const n = parseFloat(val);
  if (!isNaN(n) && n > 0) {
    return n < 0.5 ? n * 10 : n;
  }
  return 1.25;
}

export const MAP_SCALE = parseScale(getCliArg('--scale', '1:8'));
export const MIN_CLASS = getCliArg('--min-class', 'tertiary');

export function project(lon, lat, scale = MAP_SCALE) {
  const x = 1200 + (lon - ORIGIN_LON) * (Math.PI / 180) * R * Math.cos(LAT0_RAD) * scale;
  const y = 3000 - (lat - ORIGIN_LAT) * (Math.PI / 180) * R * scale;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

export function unproject(x, y, scale = MAP_SCALE) {
  const lon = ORIGIN_LON + ((x - 1200) / (scale * R * Math.cos(LAT0_RAD))) * (180 / Math.PI);
  const lat = ORIGIN_LAT - ((y - 3000) / (scale * R)) * (180 / Math.PI);
  return [lon, lat];
}

// Allowed highway classifications and display parameters
const ROAD_CLASSES = {
  motorway: { priority: 1, width: 20, defaultSpeed: 90, color: '#f59e0b', minLod: 0.05 },
  motorway_link: { priority: 1, width: 14, defaultSpeed: 60, color: '#f59e0b', minLod: 0.25 },
  trunk: { priority: 2, width: 18, defaultSpeed: 90, color: '#3b82f6', minLod: 0.05 },
  trunk_link: { priority: 2, width: 12, defaultSpeed: 50, color: '#3b82f6', minLod: 0.25 },
  primary: { priority: 3, width: 14, defaultSpeed: 90, color: '#10b981', minLod: 0.15 },
  primary_link: { priority: 3, width: 10, defaultSpeed: 50, color: '#10b981', minLod: 0.35 },
  secondary: { priority: 4, width: 10, defaultSpeed: 70, color: '#8b5cf6', minLod: 0.35 },
  secondary_link: { priority: 4, width: 8, defaultSpeed: 40, color: '#8b5cf6', minLod: 0.55 },
  tertiary: { priority: 5, width: 7, defaultSpeed: 60, color: '#64748b', minLod: 0.65 },
  tertiary_link: { priority: 5, width: 6, defaultSpeed: 40, color: '#64748b', minLod: 0.85 }
};

export const DEPOT_DEFINITIONS = [
  {
    id: 'depot-chisinau-center',
    name: 'Chișinău Central Hub (Poșta Moldovei Cargo)',
    cityName: 'Chișinău',
    lon: 28.8353,
    lat: 47.0114,
    type: 'hub'
  },
  {
    id: 'depot-chisinau-cricova',
    name: 'Cricova Logistics Park (M2 Junction)',
    cityName: 'Chișinău / Cricova',
    lon: 28.8363,
    lat: 47.1127,
    type: 'warehouse'
  },
  {
    id: 'depot-orhei-central',
    name: 'Orhei Regional Terminal (M2)',
    cityName: 'Orhei',
    lon: 28.8348,
    lat: 47.4146,
    type: 'terminal'
  },
  {
    id: 'depot-balti-north',
    name: 'Bălți North Industrial Logistics (M5 / R6)',
    cityName: 'Bălți',
    lon: 28.1838,
    lat: 48.0562,
    type: 'hub'
  },
  {
    id: 'depot-ungheni-west',
    name: 'Ungheni Customs Intermodal Terminal (R1)',
    cityName: 'Ungheni',
    lon: 27.7502,
    lat: 47.3095,
    type: 'customs'
  },
  {
    id: 'depot-tiraspol-east',
    name: 'Tiraspol East Freight Logistics (M5)',
    cityName: 'Tiraspol',
    lon: 29.8477,
    lat: 46.7132,
    type: 'warehouse'
  },
  {
    id: 'depot-cahul-south',
    name: 'Cahul Agro-Industrial Terminal (M3 / R34)',
    cityName: 'Cahul',
    lon: 28.0810,
    lat: 45.9648,
    type: 'agro'
  }
];

// ==============================================================
// 2. RAMER-DOUGLAS-PEUCKER POLYLINES SIMPLIFICATION
// ==============================================================
function sqDistPointSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  return (p[0] - px) ** 2 + (p[1] - py) ** 2;
}

function douglasPeucker(pts, epsilon) {
  if (pts.length <= 2) return pts;
  const epsSq = epsilon * epsilon;
  let maxDistSq = 0;
  let index = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const distSq = sqDistPointSegment(pts[i], first, last);
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      index = i;
    }
  }

  if (maxDistSq > epsSq) {
    const left = douglasPeucker(pts.slice(0, index + 1), epsilon);
    const right = douglasPeucker(pts.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  }
  return [first, last];
}

// ==============================================================
// 3. DOWNLOAD UTILITY
// ==============================================================
async function ensurePbfExists() {
  if (fs.existsSync(PBF_PATH)) {
    const stat = fs.statSync(PBF_PATH);
    if (stat.size > 10 * 1024 * 1024) {
      console.log(`[build-map] Found cached OSM data at ${PBF_PATH} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
  }

  // Also check /tmp
  const tmpPath = '/tmp/moldova-latest.osm.pbf';
  if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 10 * 1024 * 1024) {
    console.log(`[build-map] Copying from ${tmpPath} to ${PBF_PATH}...`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(tmpPath, PBF_PATH);
    return;
  }

  console.log(`[build-map] Downloading Moldova OSM data from Geofabrik (${PBF_URL})...`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  execSync(`curl -L -o "${PBF_PATH}" "${PBF_URL}"`, { stdio: 'inherit' });
  console.log(`[build-map] Download complete!`);
}

// ==============================================================
// 4. MAIN BUILD PROCESS (Two-Pass Streaming Parser)
// ==============================================================
async function buildMap() {
  const startTime = Date.now();
  console.log('===========================================================');
  console.log('   ETS 2 MOLDOVA | OpenStreetMap Road Network Builder     ');
  console.log('===========================================================');

  await ensurePbfExists();

  const rawWays = [];
  const neededNodeIds = new Set();
  const nodeUsage = new Map(); // nodeId -> count of ways using it
  const rawPlaces = [];
  const rawFuels = [];
  const rawIndustrials = [];
  const processedDepots = DEPOT_DEFINITIONS.map(d => ({ ...d }));

  // -------------------------------------------------------------
  // PASS 1: Scan Ways, Collect Needed Nodes & Node POIs
  // -------------------------------------------------------------
  console.log('\n[Pass 1/2] Scanning PBF to filter highway ways & node POIs...');
  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    const stream = fs.createReadStream(PBF_PATH).pipe(osm);

    osm.on('data', items => {
      for (const item of items) {
        if (item.type === 'node' && item.tags) {
          const tags = item.tags;
          // Cities / Towns / Villages
          if (tags.place === 'city' || tags.place === 'town' || tags.place === 'village') {
            const nameRu = tags['name:ru'] || tags.name || '';
            const nameRo = tags['name:ro'] || tags.name || tags['name:mo'] || '';
            rawPlaces.push({
              id: item.id,
              name: nameRu || nameRo,
              nameRo: nameRo || nameRu,
              nameRu: nameRu || nameRo,
              place: tags.place,
              population: parseInt(tags.population) || 0,
              lat: item.lat,
              lon: item.lon
            });
          }
          // Gas Stations
          if (tags.amenity === 'fuel') {
            rawFuels.push({
              id: item.id,
              name: tags.name || tags.brand || 'АЗС',
              brand: tags.brand || tags.operator || '',
              lat: item.lat,
              lon: item.lon
            });
          }
          // Warehouses
          if (tags.building === 'warehouse' || tags.industrial === 'warehouse') {
            rawIndustrials.push({
              id: item.id,
              name: tags.name || 'Складской комплекс',
              lat: item.lat,
              lon: item.lon
            });
          }
        } else if (item.type === 'way' && item.tags && item.tags.highway) {
          const hw = item.tags.highway;
          if (ROAD_CLASSES[hw]) {
            const lanes = parseInt(item.tags.lanes) || 0;
            const lanesForward = parseInt(item.tags['lanes:forward']) || 0;
            const lanesBackward = parseInt(item.tags['lanes:backward']) || 0;
            const bridge = Boolean(item.tags.bridge && item.tags.bridge !== 'no');
            const tunnel = Boolean(item.tags.tunnel && item.tags.tunnel !== 'no');
            const junction = item.tags.junction || '';

            rawWays.push({
              id: item.id,
              highway: hw,
              name: item.tags['name:ru'] || item.tags.name || item.tags['name:ro'] || '',
              ref: item.tags.ref || '',
              maxspeed: item.tags.maxspeed || '',
              oneway: item.tags.oneway === 'yes' || item.tags.oneway === '1' || hw === 'motorway',
              lanes,
              lanesForward,
              lanesBackward,
              bridge,
              tunnel,
              junction,
              refs: item.refs
            });

            for (const ref of item.refs) {
              neededNodeIds.add(ref);
              nodeUsage.set(ref, (nodeUsage.get(ref) || 0) + 1);
            }
          }
        }
      }
    });

    osm.on('end', resolve);
    osm.on('error', reject);
    stream.on('error', reject);
  });

  console.log(`[Pass 1 done] Matched ${rawWays.length} highway ways, ${neededNodeIds.size} unique nodes required.`);
  console.log(`[Pass 1 done] Extracted ${rawPlaces.length} places, ${rawFuels.length} fuel stations.`);

  // -------------------------------------------------------------
  // PASS 2: Extract Coordinates for Required Nodes
  // -------------------------------------------------------------
  console.log('\n[Pass 2/2] Extracting node coordinates for road geometry...');
  const nodeCoords = new Map(); // nodeId -> [x, y]

  await new Promise((resolve, reject) => {
    const osm = parseOSM();
    const stream = fs.createReadStream(PBF_PATH).pipe(osm);

    osm.on('data', items => {
      for (const item of items) {
        if (item.type === 'node' && neededNodeIds.has(item.id)) {
          nodeCoords.set(item.id, project(item.lon, item.lat));
        }
      }
    });

    osm.on('end', resolve);
    osm.on('error', reject);
    stream.on('error', reject);
  });

  console.log(`[Pass 2 done] Resolved coordinates for ${nodeCoords.size} nodes.`);

  // -------------------------------------------------------------
  // 5. GRAPH SEGMENTATION & TOPOLOGY BUILDING
  // -------------------------------------------------------------
  console.log('\n[Graph] Filtering tertiary ways and segmenting into graph edges...');

  const placePts = rawPlaces.map(p => project(p.lon, p.lat, MAP_SCALE));
  const depotPts = processedDepots.map(d => project(d.lon, d.lat, MAP_SCALE));

  // Filter tertiary ways: keep if length >= 300m OR within 1200m of a settlement
  const keptWays = [];
  let droppedTertiary = 0;
  for (const way of rawWays) {
    if (way.highway === 'tertiary' || way.highway === 'tertiary_link') {
      const pts = [];
      for (const r of way.refs) {
        const pt = nodeCoords.get(r);
        if (pt) pts.push(pt);
      }
      if (pts.length < 2) continue;
      let lenPx = 0;
      for (let i = 1; i < pts.length; i++) {
        lenPx += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
      const lenM = lenPx / MAP_SCALE;

      let nearPlace = false;
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      for (let i = 0; i < placePts.length; i++) {
        const pl = placePts[i];
        if (Math.hypot(p1[0] - pl[0], p1[1] - pl[1]) / MAP_SCALE < 1000 ||
            Math.hypot(p2[0] - pl[0], p2[1] - pl[1]) / MAP_SCALE < 1000) {
          nearPlace = true;
          break;
        }
      }

      if (MIN_CLASS === 'secondary') {
        // If minClass is secondary, drop all tertiary except access near depots
        let nearDepot = false;
        for (const dp of depotPts) {
          if (Math.hypot(p1[0] - dp[0], p1[1] - dp[1]) / MAP_SCALE < 800 ||
              Math.hypot(p2[0] - dp[0], p2[1] - dp[1]) / MAP_SCALE < 800) {
            nearDepot = true;
            break;
          }
        }
        if (nearDepot) keptWays.push(way);
        else droppedTertiary++;
      } else {
        // Tertiary: keep only if connects settlements (nearPlace) or length >= 300 real meters
        if ((nearPlace || lenM >= 300) && (way.ref || lenM >= 300)) {
          keptWays.push(way);
        } else {
          droppedTertiary++;
        }
      }
    } else {
      keptWays.push(way);
    }
  }

  console.log(`[Filter] Kept ${keptWays.length} ways (dropped ${droppedTertiary} short/disconnected tertiary stubs).`);

  // Count usage of nodes among kept ways
  const keptNodeUsage = new Map();
  for (const way of keptWays) {
    for (const r of way.refs) {
      keptNodeUsage.set(r, (keptNodeUsage.get(r) || 0) + 1);
    }
  }

  // Identify junction nodes:
  const isJunction = new Set();
  for (const way of keptWays) {
    if (way.refs.length >= 1) {
      isJunction.add(way.refs[0]);
      isJunction.add(way.refs[way.refs.length - 1]);
    }
    for (const ref of way.refs) {
      if ((keptNodeUsage.get(ref) || 0) > 1) {
        isJunction.add(ref);
      }
    }
  }

  const rawEdges = [];
  let edgeIdCounter = 1;

  for (const way of keptWays) {
    const refs = way.refs;
    if (refs.length < 2) continue;

    const classInfo = ROAD_CLASSES[way.highway] || ROAD_CLASSES.secondary;
    const speedLimit = parseInt(way.maxspeed) || classInfo.defaultSpeed;
    const epsilon = way.highway === 'motorway' || way.highway === 'trunk' ? 6.0 : 4.5;

    let segmentStartIdx = 0;

    for (let i = 1; i < refs.length; i++) {
      const nid = refs[i];
      const isEnd = (i === refs.length - 1);
      const isSplit = isJunction.has(nid);

      if (isSplit || isEnd) {
        const segRefs = refs.slice(segmentStartIdx, i + 1);
        const startNid = segRefs[0];
        const endNid = segRefs[segRefs.length - 1];

        // Collect coordinates
        const rawPts = [];
        for (const r of segRefs) {
          const pt = nodeCoords.get(r);
          if (pt) rawPts.push(pt);
        }

        if (rawPts.length >= 2) {
          // Simplify polyline while keeping exact curves
          const pts = douglasPeucker(rawPts, epsilon);

          // Calculate polyline length along real curve
          let segLen = 0;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let p = 0; p < pts.length; p++) {
            minX = Math.min(minX, pts[p][0]);
            minY = Math.min(minY, pts[p][1]);
            maxX = Math.max(maxX, pts[p][0]);
            maxY = Math.max(maxY, pts[p][1]);
            if (p > 0) segLen += Math.hypot(pts[p][0] - pts[p - 1][0], pts[p][1] - pts[p - 1][1]);
          }

          const edgeId = `e-${edgeIdCounter++}`;
          const edgeObj = {
            id: edgeId,
            osmWayId: way.id,
            from: startNid,
            to: endNid,
            roadClass: way.highway,
            name: way.name,
            ref: way.ref,
            maxspeed: speedLimit,
            oneway: way.oneway,
            length: Math.round(segLen * 10) / 10,
            lengthM: Math.round((segLen / MAP_SCALE) * 10) / 10,
            points: pts,
            bounds: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)]
          };
          if (way.lanes > 0) edgeObj.lanes = way.lanes;
          if (way.lanesForward > 0) edgeObj.lanesForward = way.lanesForward;
          if (way.lanesBackward > 0) edgeObj.lanesBackward = way.lanesBackward;
          if (way.bridge) edgeObj.bridge = 1;
          if (way.tunnel) edgeObj.tunnel = 1;
          if (way.junction) edgeObj.junction = way.junction;

          rawEdges.push(edgeObj);
        }

        segmentStartIdx = i;
      }
    }
  }

  console.log(`[Graph] Initial segmented edges: ${rawEdges.length}`);

  // -------------------------------------------------------------
  // 5b. COLLINEAR DEGREE-2 EDGE MERGING
  // -------------------------------------------------------------
  console.log('[Graph] Merging continuous road segments at non-intersection nodes...');
  function mergeDegree2(edgeList) {
    const edgeMap = new Map();
    for (const e of edgeList) edgeMap.set(e.id, { ...e });

    let mergedAny = true;
    let pass = 0;

    while (mergedAny && pass < 40) {
      mergedAny = false;
      pass++;

      const adj = new Map();
      for (const e of edgeMap.values()) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        if (!adj.has(e.to)) adj.set(e.to, []);
        adj.get(e.from).push({ edge: e, end: 'from' });
        adj.get(e.to).push({ edge: e, end: 'to' });
      }

      const removedIds = new Set();

      for (const [nid, conn] of adj) {
        if (conn.length !== 2) continue;
        const c1 = conn[0];
        const c2 = conn[1];
        const e1 = edgeMap.get(c1.edge.id);
        const e2 = edgeMap.get(c2.edge.id);
        if (!e1 || !e2 || e1.id === e2.id) continue;
        if (removedIds.has(e1.id) || removedIds.has(e2.id)) continue;

        // Compatibility checks
        if (e1.roadClass !== e2.roadClass) continue;
        if (e1.oneway !== e2.oneway) continue;
        if (e1.ref && e2.ref && e1.ref !== e2.ref) continue;
        if ((e1.lanes || 2) !== (e2.lanes || 2)) continue;
        if (Boolean(e1.tunnel) !== Boolean(e2.tunnel)) continue;
        if (Boolean(e1.bridge) !== Boolean(e2.bridge)) {
          const b = e1.bridge ? e1 : e2;
          if (b.lengthM > 40) continue;
        }

        let pts1 = [...e1.points];
        let pts2 = [...e2.points];
        let newFrom, newTo;

        if (e1.oneway) {
          if (e1.to === nid && e2.from === nid) {
            newFrom = e1.from;
            newTo = e2.to;
          } else if (e2.to === nid && e1.from === nid) {
            newFrom = e2.from;
            newTo = e1.to;
            pts1 = [...e2.points];
            pts2 = [...e1.points];
          } else {
            continue;
          }
        } else {
          // Two-way road
          if (e1.to === nid) {
            newFrom = e1.from;
          } else {
            pts1.reverse();
            newFrom = e1.to;
          }
          if (e2.from === nid) {
            newTo = e2.to;
          } else {
            pts2.reverse();
            newTo = e2.from;
          }
        }

        if (newFrom === newTo) continue;

        const mergedPoints = [...pts1, ...pts2.slice(1)];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of mergedPoints) {
          minX = Math.min(minX, p[0]);
          minY = Math.min(minY, p[1]);
          maxX = Math.max(maxX, p[0]);
          maxY = Math.max(maxY, p[1]);
        }

        const mergedEdge = {
          ...e1,
          from: newFrom,
          to: newTo,
          ref: e1.ref || e2.ref || '',
          name: e1.name || e2.name || '',
          bridge: (e1.bridge || e2.bridge) ? 1 : undefined,
          tunnel: (e1.tunnel || e2.tunnel) ? 1 : undefined,
          points: mergedPoints,
          length: Math.round((e1.length + e2.length) * 10) / 10,
          lengthM: Math.round((e1.lengthM + e2.lengthM) * 10) / 10,
          bounds: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)]
        };

        edgeMap.set(e1.id, mergedEdge);
        edgeMap.delete(e2.id);
        removedIds.add(e2.id);
        mergedAny = true;
      }
    }

    return Array.from(edgeMap.values());
  }

  let graphEdges = mergeDegree2(rawEdges);
  console.log(`[Graph] After degree-2 merging: ${graphEdges.length} edges (merged ${rawEdges.length - graphEdges.length})`);

  // -------------------------------------------------------------
  // 5c. CONNECTED COMPONENT ANALYSIS (Keep only Main National Highway Network)
  // -------------------------------------------------------------
  console.log('[Graph] Filtering disconnected fragments outside main connected component...');
  const adj = new Map();
  for (const e of graphEdges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from).add(e.to);
    adj.get(e.to).add(e.from);
  }

  // Find node closest to Chișinău anchor (1200, 3000)
  let chisinauNodeId = null;
  let chisinauDist = Infinity;
  for (const [nid, pt] of nodeCoords) {
    const d = Math.hypot(pt[0] - 1200, pt[1] - 3000);
    if (d < chisinauDist && adj.has(nid)) {
      chisinauDist = d;
      chisinauNodeId = nid;
    }
  }

  const visitedNodes = new Set();
  if (chisinauNodeId) {
    const queue = [chisinauNodeId];
    visitedNodes.add(chisinauNodeId);
    while (queue.length > 0) {
      const cur = queue.shift();
      const neighbors = adj.get(cur);
      if (neighbors) {
        for (const nxt of neighbors) {
          if (!visitedNodes.has(nxt)) {
            visitedNodes.add(nxt);
            queue.push(nxt);
          }
        }
      }
    }
  }

  graphEdges = graphEdges.filter(e => visitedNodes.has(e.from) && visitedNodes.has(e.to));
  console.log(`[Graph] Main network component: ${graphEdges.length} edges connecting ${visitedNodes.size} nodes.`);

  // -------------------------------------------------------------
  // 5d. DEAD-END STUB PRUNING
  // -------------------------------------------------------------
  const protectedNodes = new Set();
  for (const [nid, pt] of nodeCoords) {
    for (const dp of depotPts) {
      if (Math.hypot(pt[0] - dp[0], pt[1] - dp[1]) / MAP_SCALE < 1500) {
        protectedNodes.add(nid);
        break;
      }
    }
    if (protectedNodes.has(nid)) continue;
    for (const pl of placePts) {
      if (Math.hypot(pt[0] - pl[0], pt[1] - pl[1]) / MAP_SCALE < 800) {
        protectedNodes.add(nid);
        break;
      }
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    const deg = new Map();
    for (const e of graphEdges) {
      deg.set(e.from, (deg.get(e.from) || 0) + 1);
      deg.set(e.to, (deg.get(e.to) || 0) + 1);
    }
    const toRemove = new Set();
    for (const e of graphEdges) {
      const d1 = deg.get(e.from) || 0;
      const d2 = deg.get(e.to) || 0;
      const isDeadEnd = (d1 === 1 && !protectedNodes.has(e.from)) || (d2 === 1 && !protectedNodes.has(e.to));
      if (isDeadEnd && e.lengthM < 500 && (e.roadClass === 'tertiary' || e.roadClass === 'tertiary_link' || e.roadClass === 'secondary_link')) {
        toRemove.add(e.id);
      }
    }
    if (toRemove.size === 0) break;
    graphEdges = graphEdges.filter(e => !toRemove.has(e.id));
  }

  // Second merge pass in case pruning exposed new degree-2 nodes
  graphEdges = mergeDegree2(graphEdges);

  // Rebuild final graphNodes
  const graphNodes = new Map();
  for (const e of graphEdges) {
    const startPt = e.points[0];
    const endPt = e.points[e.points.length - 1];
    if (!graphNodes.has(e.from)) graphNodes.set(e.from, { id: e.from, x: startPt[0], y: startPt[1], outEdges: [] });
    if (!graphNodes.has(e.to)) graphNodes.set(e.to, { id: e.to, x: endPt[0], y: endPt[1], outEdges: [] });
    graphNodes.get(e.from).outEdges.push(e.id);
    if (!e.oneway) {
      graphNodes.get(e.to).outEdges.push(e.id);
    }
  }

  console.log(`[Graph built] Final Simplified Graph: ${graphNodes.size} Nodes, ${graphEdges.length} Edges.`);

  console.log(`[Graph built] Total Junction Nodes: ${graphNodes.size}, Total Directed/Split Edges: ${graphEdges.length}`);

  // -------------------------------------------------------------
  // 6. CITIES & DEPOTS MAPPING
  // -------------------------------------------------------------
  console.log('\n[Places] Projecting cities and snapping to nearest road graph node...');

  // Filter significant Moldovan cities & towns
  const validPlaces = rawPlaces.filter(p => {
    // Keep all cities, towns, and significant settlements
    if (p.place === 'city' || p.place === 'town') return true;
    if (p.population > 2500) return true;
    return false;
  });

  const processedCities = [];
  for (const place of validPlaces) {
    const [px, py] = project(place.lon, place.lat);

    // Find closest road node
    let closestNodeId = null;
    let minDist = Infinity;
    for (const [nid, node] of graphNodes) {
      const d = Math.hypot(node.x - px, node.y - py);
      if (d < minDist) {
        minDist = d;
        closestNodeId = nid;
      }
    }

    processedCities.push({
      id: `city-${place.id}`,
      name: place.name,
      nameRo: place.nameRo,
      nameRu: place.nameRu,
      place: place.place,
      population: place.population,
      x: px,
      y: py,
      nearestNodeId: closestNodeId,
      snapDist: Math.round(minDist)
    });
  }

  // Logistics Depots & Terminals
  // Project and snap depots to nearest road nodes
  for (const depot of processedDepots) {
    const [dx, dy] = project(depot.lon, depot.lat, MAP_SCALE);
    depot.x = dx;
    depot.y = dy;

    let closestNodeId = null;
    let minDist = Infinity;
    for (const [nid, node] of graphNodes) {
      const d = Math.hypot(node.x - depot.x, node.y - depot.y);
      if (d < minDist) {
        minDist = d;
        closestNodeId = nid;
      }
    }
    depot.nearestNodeId = closestNodeId;
    depot.snapDist = Math.round(minDist);
  }

  // Gas stations
  const processedFuels = [];
  for (const f of rawFuels.slice(0, 300)) {
    const [fx, fy] = project(f.lon, f.lat);
    processedFuels.push({
      id: `fuel-${f.id}`,
      name: f.name,
      brand: f.brand,
      x: fx,
      y: fy
    });
  }

  // Calculate overall bounding box
  let mapMinX = Infinity, mapMinY = Infinity, mapMaxX = -Infinity, mapMaxY = -Infinity;
  for (const edge of graphEdges) {
    mapMinX = Math.min(mapMinX, edge.bounds[0]);
    mapMinY = Math.min(mapMinY, edge.bounds[1]);
    mapMaxX = Math.max(mapMaxX, edge.bounds[2]);
    mapMaxY = Math.max(mapMaxY, edge.bounds[3]);
  }

  // Compact node map for export: id -> [x, y, [outEdges]]
  const exportNodes = {};
  for (const [nid, node] of graphNodes) {
    exportNodes[nid] = [node.x, node.y, node.outEdges];
  }

  const mapData = {
    meta: {
      title: 'ETS2 2D Real OpenStreetMap Republic of Moldova Road Network',
      source: 'OpenStreetMap contributors (Geofabrik)',
      license: 'ODbL (Open Database License)',
      scale: Math.abs(MAP_SCALE - 1.25) < 0.001 ? '1:8' : (Math.abs(MAP_SCALE - (10 / 19)) < 0.001 ? '1:19' : `1:${Math.round(10 / MAP_SCALE)}`),
      mapScale: MAP_SCALE,
      unitsPerMeter: MAP_SCALE,
      minClass: MIN_CLASS,
      generatedAt: new Date().toISOString(),
      bounds: [mapMinX, mapMinY, mapMaxX, mapMaxY],
      nodeCount: graphNodes.size,
      edgeCount: graphEdges.length,
      cityCount: processedCities.length,
      depotCount: processedDepots.length,
      fuelCount: processedFuels.length
    },
    nodes: exportNodes,
    edges: graphEdges,
    cities: processedCities,
    depots: processedDepots,
    fuels: processedFuels
  };

  // -------------------------------------------------------------
  // 7. WRITE TO JSON & BROWSER SCRIPT
  // -------------------------------------------------------------
  console.log(`\n[Save] Writing compact road network to ${JSON_OUT_PATH} and ${JS_OUT_PATH}...`);
  fs.mkdirSync(path.dirname(JSON_OUT_PATH), { recursive: true });
  const jsonStr = JSON.stringify(mapData);
  fs.writeFileSync(JSON_OUT_PATH, jsonStr, 'utf8');

  const jsContent = `/*! ETS2 2D | Pre-baked OSM Republic of Moldova Road Network */
(function (root) {
  'use strict';
  root.OSM_MOLDOVA_MAP = ${jsonStr};
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;
  fs.writeFileSync(JS_OUT_PATH, jsContent, 'utf8');

  const fileSizeMb = (Buffer.byteLength(jsonStr, 'utf8') / 1024 / 1024).toFixed(2);
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('===========================================================');
  console.log(`✔ BUILD COMPLETE in ${durationSec}s!`);
  console.log(`✔ Output File: ${JSON_OUT_PATH} (${fileSizeMb} MB)`);
  console.log(`✔ Total Graph Nodes: ${graphNodes.size.toLocaleString()}`);
  console.log(`✔ Total Graph Edges: ${graphEdges.length.toLocaleString()}`);
  console.log(`✔ Cities & Towns: ${processedCities.length}`);
  console.log(`✔ Freight Logistics Depots: ${processedDepots.length}`);
  console.log(`✔ Fuel Stations: ${processedFuels.length}`);
  console.log('===========================================================');
}

export function exportJsFromMapJson() {
  if (!fs.existsSync(JSON_OUT_PATH)) {
    console.error(`[export-js] File not found: ${JSON_OUT_PATH}`);
    process.exit(1);
  }
  console.log(`[export-js] Generating ${JS_OUT_PATH} from ${JSON_OUT_PATH}...`);
  const jsonStr = fs.readFileSync(JSON_OUT_PATH, 'utf8');
  const jsContent = `/*! ETS2 2D | Pre-baked OSM Republic of Moldova Road Network */
(function (root) {
  'use strict';
  root.OSM_MOLDOVA_MAP = ${jsonStr};
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;
  fs.writeFileSync(JS_OUT_PATH, jsContent, 'utf8');
  console.log(`✔ Successfully generated ${JS_OUT_PATH}!`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  if (process.argv.includes('--export-js')) {
    exportJsFromMapJson();
    process.exit(0);
  }

  buildMap().catch(err => {
    console.error('[build-map] ERROR:', err);
    process.exit(1);
  });
}
