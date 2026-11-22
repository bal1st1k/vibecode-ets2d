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
const ORIGIN_LON = 28.8353;
const ORIGIN_LAT = 47.0105;
const LAT0_RAD = (ORIGIN_LAT * Math.PI) / 180;
const R = 6371000; // Earth radius in meters
const ETS2_SCALE = 10 / 19; // 1:19 ETS 2 Scale (1 real meter ≈ 0.526 game units)

export function project(lon, lat) {
  const x = 1200 + (lon - ORIGIN_LON) * (Math.PI / 180) * R * Math.cos(LAT0_RAD) * ETS2_SCALE;
  const y = 3000 - (lat - ORIGIN_LAT) * (Math.PI / 180) * R * ETS2_SCALE;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

export function unproject(x, y) {
  const lon = ORIGIN_LON + ((x - 1200) / (ETS2_SCALE * R * Math.cos(LAT0_RAD))) * (180 / Math.PI);
  const lat = ORIGIN_LAT - ((y - 3000) / (ETS2_SCALE * R)) * (180 / Math.PI);
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
  console.log('\n[Graph] Segmenting ways at junctions into graph edges...');

  // Identify junction nodes:
  // A node is an intersection if:
  // 1. It is the first or last node of ANY way
  // 2. OR it is referenced by >= 2 ways (degree > 1)
  const isJunction = new Set();
  for (const way of rawWays) {
    if (way.refs.length >= 1) {
      isJunction.add(way.refs[0]);
      isJunction.add(way.refs[way.refs.length - 1]);
    }
    for (const ref of way.refs) {
      if ((nodeUsage.get(ref) || 0) > 1) {
        isJunction.add(ref);
      }
    }
  }

  const graphNodes = new Map(); // nodeId -> { id, x, y, edges: [] }
  const graphEdges = [];
  let edgeIdCounter = 1;

  for (const way of rawWays) {
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
            points: pts,
            bounds: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)]
          };
          if (way.lanes > 0) edgeObj.lanes = way.lanes;
          if (way.lanesForward > 0) edgeObj.lanesForward = way.lanesForward;
          if (way.lanesBackward > 0) edgeObj.lanesBackward = way.lanesBackward;
          if (way.bridge) edgeObj.bridge = 1;
          if (way.tunnel) edgeObj.tunnel = 1;
          if (way.junction) edgeObj.junction = way.junction;

          graphEdges.push(edgeObj);

          // Ensure graph nodes exist
          const startPt = pts[0];
          const endPt = pts[pts.length - 1];

          if (!graphNodes.has(startNid)) {
            graphNodes.set(startNid, { id: startNid, x: startPt[0], y: startPt[1], outEdges: [] });
          }
          graphNodes.get(startNid).outEdges.push(edgeId);

          if (!graphNodes.has(endNid)) {
            graphNodes.set(endNid, { id: endNid, x: endPt[0], y: endPt[1], outEdges: [] });
          }
          if (!way.oneway) {
            graphNodes.get(endNid).outEdges.push(edgeId);
          }
        }

        segmentStartIdx = i;
      }
    }
  }

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
  const processedDepots = [
    {
      id: 'depot-chisinau-center',
      name: 'Chișinău Central Hub (Poșta Moldovei Cargo)',
      cityName: 'Chișinău',
      x: 1200,
      y: 2950,
      type: 'hub'
    },
    {
      id: 'depot-chisinau-cricova',
      name: 'Cricova Logistics Park (M2 Junction)',
      cityName: 'Chișinău / Cricova',
      x: 1240,
      y: -2980,
      type: 'warehouse'
    },
    {
      id: 'depot-orhei-central',
      name: 'Orhei Regional Terminal (M2)',
      cityName: 'Orhei',
      x: 1180,
      y: -20650,
      type: 'terminal'
    },
    {
      id: 'depot-balti-north',
      name: 'Bălți North Industrial Logistics (M5 / R6)',
      cityName: 'Bălți',
      x: -24800,
      y: -58200,
      type: 'hub'
    },
    {
      id: 'depot-ungheni-west',
      name: 'Ungheni Customs Intermodal Terminal (R1)',
      cityName: 'Ungheni',
      x: -42100,
      y: -14500,
      type: 'customs'
    },
    {
      id: 'depot-tiraspol-east',
      name: 'Tiraspol East Freight Logistics (M5)',
      cityName: 'Tiraspol',
      x: 41600,
      y: 20400,
      type: 'warehouse'
    },
    {
      id: 'depot-cahul-south',
      name: 'Cahul Agro-Industrial Terminal (M3 / R34)',
      cityName: 'Cahul',
      x: -28900,
      y: 64200,
      type: 'agro'
    }
  ];

  // Snap depots to nearest road nodes
  for (const depot of processedDepots) {
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
      scale: '1:19 European ETS2 Scale',
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

if (process.argv.includes('--export-js')) {
  exportJsFromMapJson();
  process.exit(0);
}

buildMap().catch(err => {
  console.error('[build-map] ERROR:', err);
  process.exit(1);
});
