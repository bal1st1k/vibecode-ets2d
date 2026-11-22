/*! 2D ETS2 Moldova Edition | Full Republic of Moldova Road Network & Geography | ETS2 1:19 Scale */
(function (root) {
  'use strict';

  // Coordinate scale: MAP_SCALE px per 1 real meter
  // In 1:8 scale, 1 real meter = 1.25 canvas units (1 real km = 1250 px)
  const MAP_SCALE = (typeof OSM_MOLDOVA_MAP !== 'undefined' && OSM_MOLDOVA_MAP?.meta?.mapScale) || 1.25;
  const UNITS_PER_METER = MAP_SCALE;
  const ETS2_SCALE = Math.round(10 / MAP_SCALE); // 8 for 1:8, 19 for 1:19
  const realKmToUnits = realKm => realKm * 1000 * MAP_SCALE;
  const unitsToRealKm = units => (units / MAP_SCALE) / 1000;
  const unitsToRealMeters = units => units / MAP_SCALE;

  // Road lanes lookup: oneway default trunk/primary = 2, others = 1; two-way default = 2; max 3 lanes; links = 1
  function getEdgeLanes(edge) {
    if (!edge) return 2;
    const rc = edge.roadClass || '';
    if (rc.endsWith('_link')) {
      return 1;
    }
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

  // Road width calculation: lanes * 36 + shoulders of 10 px each side for trunk/primary/secondary. Links = 36 px (no shoulder).
  function getRoadWidth(edgeOrClass, maybeLanes, maybeOneway) {
    let rc, lanes, oneway;
    if (typeof edgeOrClass === 'object' && edgeOrClass !== null) {
      rc = edgeOrClass.roadClass || '';
      lanes = getEdgeLanes(edgeOrClass);
      oneway = Boolean(edgeOrClass.oneway);
    } else {
      rc = edgeOrClass || '';
      oneway = Boolean(maybeOneway);
      lanes = maybeLanes || (oneway ? ((rc === 'motorway' || rc === 'trunk' || rc === 'primary') ? 2 : 1) : 2);
    }
    if (rc.endsWith('_link')) {
      return 36;
    }
    lanes = Math.min(3, Math.max(1, lanes));
    const hasShoulder = rc === 'motorway' || rc === 'trunk' || rc === 'primary' || rc === 'secondary';
    const shoulder = hasShoulder ? 10 : 0;
    return lanes * 36 + shoulder * 2;
  }

  // Freight Market Cargo
  const CARGO_CATALOG = [
    { id: 'wine', name: 'Vin Moldovenesc', nameRu: 'Молдавское вино (Purcari)', weightKg: 18000, valuePerKm: 34, type: 'dryvan' },
    { id: 'apples', name: 'Mere de Livadă', nameRu: 'Яблоки (Орхей)', weightKg: 15000, valuePerKm: 28, type: 'reefer' },
    { id: 'sunflower_oil', name: 'Ulei de Floarea Soarelui', nameRu: 'Подсолнечное масло (Bălți)', weightKg: 22000, valuePerKm: 36, type: 'tanker' },
    { id: 'machinery', name: 'Piese și Utilaj Agricol', nameRu: 'Сельхозтехника (Bălți/Chișinău)', weightKg: 16000, valuePerKm: 42, type: 'lowbed' },
    { id: 'customs_freight', name: 'Mărfuri de Import UE', nameRu: 'Импортные товары (Ungheni Vamă)', weightKg: 19000, valuePerKm: 38, type: 'dryvan' },
    { id: 'textiles', name: 'Produse Textile (Tiraspol)', nameRu: 'Текстиль и ткани (Тиротекс)', weightKg: 12000, valuePerKm: 30, type: 'dryvan' }
  ];

  // Cities of Republic of Moldova
  const CITIES = [
    { id: 'chisinau', name: 'Chișinău', nameRu: 'Кишинёв', x: 1200, y: 3000, rank: 1, desc: 'Столица Республики Молдова' },
    { id: 'balti', name: 'Bălți', nameRu: 'Бельцы', x: -8500, y: -40000, rank: 1, desc: 'Северная индустриальная столица' },
    { id: 'orhei', name: 'Orhei', nameRu: 'Орхей', x: 1200, y: -20684, rank: 1, desc: 'Центр виноделия и логистики' },
    { id: 'ungheni', name: 'Ungheni', nameRu: 'Унгены', x: -30000, y: 2400, rank: 1, desc: 'Западный таможенный хаб на границе с Румынией' },
    { id: 'tiraspol', name: 'Tiraspol', nameRu: 'Тирасполь', x: 17500, y: 6400, rank: 1, desc: 'Восточный промышленный центр на Днестре' },
    { id: 'hincesti', name: 'Hîncești', nameRu: 'Хынчешты', x: -2200, y: 19800, rank: 2, desc: 'Юго-западный аграрный и винный центр' },
    { id: 'stauceni', name: 'Stăuceni', nameRu: 'Ставчены', x: 1350, y: 950, rank: 3, desc: 'Пригород Кишинёва на M2' },
    { id: 'cricova', name: 'Cricova', nameRu: 'Крикова', x: 1700, y: -2200, rank: 2, desc: 'Подземные винные галереи и развязка M1' },
    { id: 'magdacesti', name: 'Măgdăcești', nameRu: 'Мэгдачешть', x: 1400, y: -4800, rank: 3, desc: 'Скоростной участок M2' },
    { id: 'ratus', name: 'Ratuș', nameRu: 'Ратуш', x: 1050, y: -7200, rank: 3, desc: 'Перекрёсток M2' },
    { id: 'peresecina', name: 'Peresecina', nameRu: 'Пересечина', x: -450, y: -12800, rank: 2, desc: 'Серпантины M2 и АЗС Rompetrol' },
    { id: 'pelivan', name: 'Pelivan', nameRu: 'Пеливан', x: 800, y: -17000, rank: 3, desc: 'Подход к Орхею' },
    { id: 'telenesti', name: 'Telenești', nameRu: 'Теленешты', x: -1800, y: -24500, rank: 3, desc: 'Развязка R14' },
    { id: 'singerei', name: 'Sîngerei', nameRu: 'Сынжерей', x: -5000, y: -32000, rank: 3, desc: 'Шоссе R14 к Бельцам' },
    { id: 'straseni', name: 'Strășeni', nameRu: 'Страшены', x: -6500, y: 2800, rank: 2, desc: 'Город в Кодрах на трассе R1' },
    { id: 'calarasi', name: 'Călărași', nameRu: 'Калараш', x: -14000, y: 3200, rank: 2, desc: 'Винно-коньячный хаб на R1' },
    { id: 'dubasari', name: 'Dubăsari', nameRu: 'Дубоссары', x: 12500, y: -2800, rank: 2, desc: 'Переправа через реку Днестр' },
    { id: 'anenii-noi', name: 'Anenii Noi', nameRu: 'Новые Анены', x: 11500, y: 5400, rank: 3, desc: 'Трасса R2 на Тирасполь' }
  ];

  // Dynamic DEPOTS, FUELS & ROAD_SIGNS containers loaded strictly from data/moldova-map.json
  const DEPOTS = [];
  const FUELS = [];
  const ROAD_SIGNS = [];

  // Moldovan Real Geographical Features (Google Maps Layers)
  const GEOGRAPHY = {
    // Republic of Moldova National Border Boundary Polygon (Simplified Google Maps Outline)
    moldovaBorder: [
      { x: -32000, y: -45000 }, // Northern Prut entry
      { x: -12000, y: -47000 }, // Northern apex (Ocnița/Briceni)
      { x: 5000, y: -46000 },   // Soroca North
      { x: 15000, y: -38000 },  // Camenca / Nistru bend
      { x: 16000, y: -20000 },  // Rîbnița East
      { x: 18000, y: -4000 },   // Dubăsari East
      { x: 22000, y: 8000 },    // Tiraspol / Slobozia East
      { x: 18000, y: 22000 },   // Ştefan Vodă South-East
      { x: 2000, y: 26000 },    // Taraclia South
      { x: -8000, y: 30000 },   // Giurgiulești Danube point
      { x: -18000, y: 20000 },  // Cahul / Prut
      { x: -24000, y: 12000 },  // Cantemir / Leova
      { x: -31000, y: 2400 },   // Ungheni Prut Border
      { x: -33000, y: -16000 }, // Glodeni Prut
      { x: -32000, y: -45000 }
    ],

    // 1. Râul Nistru (Dniester River — Eastern Border & Lifeline)
    nistruRiver: [
      { x: 8000, y: -45000 },
      { x: 12000, y: -35000 },
      { x: 14000, y: -22000 },
      { x: 11000, y: -10000 },
      { x: 10500, y: -2700 }, // Under M1 Bridge
      { x: 12000, y: 1500 },
      { x: 14500, y: 5900 },  // Under R2 Bridge
      { x: 16000, y: 12000 },
      { x: 19000, y: 20000 }
    ],

    // 2. Râul Prut (Prut River — Western Border with Romania)
    prutRiver: [
      { x: -32000, y: -45000 },
      { x: -33000, y: -28000 },
      { x: -32500, y: -12000 },
      { x: -30800, y: 2400 },  // Under Ungheni Customs Bridge
      { x: -28000, y: 12000 },
      { x: -22000, y: 22000 },
      { x: -10000, y: 30000 }
    ],

    // 3. Râul Răut (Răut River — Winding through Bălți and Orhei)
    rautRiver: [
      { x: -12000, y: -42000 },
      { x: -8500, y: -39000 }, // Bălți River Bank
      { x: -5000, y: -34000 },
      { x: -2000, y: -26000 },
      { x: 500, y: -21000 },
      { x: 1200, y: -20000 },  // Under M2 Orhei Bridge
      { x: 3000, y: -19500 },
      { x: 6500, y: -18000 },
      { x: 11500, y: -16000 }  // Confluence with Nistru
    ],

    // 4. Râul Bîc (Bîc River — Through Strășeni and Chișinău)
    bicRiver: [
      { x: -12000, y: 3200 },
      { x: -6500, y: 2700 },  // Strășeni Bank
      { x: -3000, y: 2400 },  // Ghidighici Reservoir
      { x: 500, y: 2900 },
      { x: 1200, y: 3200 },   // Chișinău Downtown
      { x: 2800, y: 3400 },
      { x: 7500, y: 4400 },
      { x: 14500, y: 5800 }   // Confluence with Nistru
    ],

    // Forests & Protected Nature Reserves (Google Maps Green Polygons)
    forests: [
      {
        name: 'Rezervația Naturală Codru (Chișinău — Călărași — Strășeni)',
        points: [
          { x: -200, y: -7000 },
          { x: 1500, y: -7800 },
          { x: 2200, y: -9500 },
          { x: 1200, y: -11500 },
          { x: -1200, y: -11000 },
          { x: -3500, y: -8000 },
          { x: -5000, y: -2000 },
          { x: -3000, y: 1500 },
          { x: -500, y: 0 }
        ]
      },
      {
        name: 'Parcul Național Orhei (Trebujeni — Curchi)',
        points: [
          { x: 1400, y: -15500 },
          { x: 3200, y: -16800 },
          { x: 4500, y: -19000 },
          { x: 2500, y: -20500 },
          { x: 1500, y: -18500 }
        ]
      },
      {
        name: 'Pădurea Hîncești (Lăpușna)',
        points: [
          { x: -1200, y: 12000 },
          { x: 400, y: 13500 },
          { x: -500, y: 17000 },
          { x: -2400, y: 16500 },
          { x: -2800, y: 13000 }
        ]
      }
    ],

    // 5. Bridges across rivers (1:19 base coordinates, rescaled with RESCALE_S)
    bridges: [
      { id: 'bridge-raut-orhei', name: 'Мост через реку Рэут (Орхей, M2)', x: 1200, y: -20000, angle: -Math.PI / 2, length: 180, width: 150 },
      { id: 'bridge-nistru-m1', name: 'Мост через реку Днестр (Дубоссары, M1)', x: 10500, y: -2700, angle: 0, length: 220, width: 140 },
      { id: 'bridge-nistru-r2', name: 'Мост через реку Днестр (Бендеры, R2)', x: 14500, y: 5900, angle: 0.35, length: 240, width: 140 },
      { id: 'bridge-prut-ungheni', name: 'Мост через реку Прут (Унгены, R1)', x: -30800, y: 2400, angle: 3.14, length: 200, width: 135 }
    ],

    // Dynamic POIs (Populated strictly from data/moldova-map.json)
    pois: []
  };

  // Environment Buildings & City Architecture footprint for visual realism in 2D
  const CITY_BLOCKS = [
    // Chișinău Urban Core Blocks
    { x: 1450, y: 2800, w: 160, h: 220, color: '#1a232a', label: 'Centru Logistic' },
    { x: 1450, y: 3100, w: 180, h: 140, color: '#1e2832', label: 'Depozit Calea Orheiului' },
    { x: 950, y: 2800, w: 150, h: 120, color: '#162028', label: 'Depozit Purcari' },
    { x: 950, y: 3250, w: 200, h: 90, color: '#141c22', label: 'Parc Camioane' },
    // Orhei City Blocks
    { x: 1750, y: -20500, w: 180, h: 160, color: '#1c2428', label: 'Fabrica de Conserve Orhei' },
    { x: 1350, y: -21200, w: 220, h: 140, color: '#162024', label: 'Orhei Vit Hub' },
    // Bălți City Blocks
    { x: -8400, y: -41200, w: 260, h: 180, color: '#1e262c', label: 'Combinatul Agro Bălți' },
    { x: -7800, y: -41800, w: 220, h: 200, color: '#182024', label: 'Fabrica Răut Bălți' },
    // Ungheni City Blocks
    { x: -29800, y: 2200, w: 240, h: 160, color: '#1c242a', label: 'Terminal Vamal Ungheni' },
    { x: -30500, y: 2500, w: 200, h: 120, color: '#161e24', label: 'Gara Feroviară Ungheni' },
    // Tiraspol City Blocks
    { x: 17200, y: 6200, w: 260, h: 160, color: '#202428', label: 'Tirotex Tiraspol' },
    // Hîncești City Blocks
    { x: -2100, y: 20400, w: 200, h: 140, color: '#1c2226', label: 'Combinatul Vinicol Hîncești' }
  ];

  // Rescale GEOGRAPHY and CITY_BLOCKS from 1:19 coordinate space to current MAP_SCALE
  const RESCALE_S = MAP_SCALE / (10 / 19);
  if (Math.abs(RESCALE_S - 1.0) > 0.01) {
    const rescaleCoord = pt => ({
      ...pt,
      x: Math.round((1200 + (pt.x - 1200) * RESCALE_S) * 10) / 10,
      y: Math.round((3000 + (pt.y - 3000) * RESCALE_S) * 10) / 10
    });
    for (let i = 0; i < CITIES.length; i++) {
      const c = rescaleCoord(CITIES[i]);
      CITIES[i].x = c.x;
      CITIES[i].y = c.y;
    }
    GEOGRAPHY.moldovaBorder = GEOGRAPHY.moldovaBorder.map(rescaleCoord);
    GEOGRAPHY.nistruRiver = GEOGRAPHY.nistruRiver.map(rescaleCoord);
    GEOGRAPHY.prutRiver = GEOGRAPHY.prutRiver.map(rescaleCoord);
    GEOGRAPHY.rautRiver = GEOGRAPHY.rautRiver.map(rescaleCoord);
    GEOGRAPHY.bicRiver = GEOGRAPHY.bicRiver.map(rescaleCoord);
    GEOGRAPHY.bridges = GEOGRAPHY.bridges.map(rescaleCoord);
    for (const f of GEOGRAPHY.forests) {
      f.points = f.points.map(rescaleCoord);
    }
    for (const b of CITY_BLOCKS) {
      const c = rescaleCoord(b);
      b.x = c.x;
      b.y = c.y;
      b.w = Math.round(b.w * RESCALE_S);
      b.h = Math.round(b.h * RESCALE_S);
    }
  }

  // ==============================================================
  // REAL OPENSTREETMAP ROAD NETWORK GRAPH & A* ROUTING
  // ==============================================================
  let osmMap = null;
  if (typeof root !== 'undefined' && root) {
    osmMap = root.OSM_MOLDOVA_MAP || (root.window && root.window.OSM_MOLDOVA_MAP);
  }
  if (!osmMap && typeof window !== 'undefined' && window) {
    osmMap = window.OSM_MOLDOVA_MAP;
  }
  if (!osmMap && typeof globalThis !== 'undefined' && globalThis) {
    osmMap = globalThis.OSM_MOLDOVA_MAP || (globalThis.window && globalThis.window.OSM_MOLDOVA_MAP);
  }
  if (!osmMap && typeof require !== 'undefined') {
    try {
      const fs = require('node:fs');
      const p = require('node:path').join(__dirname, '../data/moldova-map.json');
      if (fs.existsSync(p)) osmMap = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {}
  }

  // Pre-build adjacency graph if OSM data loaded
  const osmAdj = new Map();
  if (osmMap && osmMap.edges) {
    for (const edge of osmMap.edges) {
      const f = String(edge.from);
      const t = String(edge.to);
      if (!osmAdj.has(f)) osmAdj.set(f, []);
      osmAdj.get(f).push({ to: t, weight: edge.length, edge, reverse: false });
      if (!edge.oneway) {
        if (!osmAdj.has(t)) osmAdj.set(t, []);
        osmAdj.get(t).push({ to: f, weight: edge.length, edge, reverse: true });
      }
    }
  }

  // Fast Binary MinHeap for A*
  class RouteMinHeap {
    constructor() { this.heap = []; }
    push(item) { this.heap.push(item); this._bubbleUp(this.heap.length - 1); }
    pop() {
      if (this.heap.length === 0) return null;
      const top = this.heap[0];
      const bottom = this.heap.pop();
      if (this.heap.length > 0) { this.heap[0] = bottom; this._sinkDown(0); }
      return top;
    }
    get size() { return this.heap.length; }
    _bubbleUp(idx) {
      while (idx > 0) {
        const pIdx = (idx - 1) >> 1;
        if (this.heap[idx].f >= this.heap[pIdx].f) break;
        [this.heap[idx], this.heap[pIdx]] = [this.heap[pIdx], this.heap[idx]];
        idx = pIdx;
      }
    }
    _sinkDown(idx) {
      const len = this.heap.length;
      while (true) {
        const left = (idx << 1) + 1;
        const right = left + 1;
        let smallest = idx;
        if (left < len && this.heap[left].f < this.heap[smallest].f) smallest = left;
        if (right < len && this.heap[right].f < this.heap[smallest].f) smallest = right;
        if (smallest === idx) break;
        [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
        idx = smallest;
      }
    }
  }

  // Fast spatial grid for OSM graph nodes to accelerate nearest node queries
  const nodeSpatialGrid = new Map();
  const NODE_CELL_SIZE = 500;

  function ensureNodeSpatialGrid() {
    if (nodeSpatialGrid.size > 0 || !osmMap || !osmMap.nodes) return;
    for (const nid in osmMap.nodes) {
      const node = osmMap.nodes[nid];
      const cx = Math.floor(node[0] / NODE_CELL_SIZE);
      const cy = Math.floor(node[1] / NODE_CELL_SIZE);
      const k = `${cx}:${cy}`;
      let list = nodeSpatialGrid.get(k);
      if (!list) {
        list = [];
        nodeSpatialGrid.set(k, list);
      }
      list.push(nid);
    }
  }

  function findNearestNode(x, y) {
    if (!osmMap || !osmMap.nodes) return null;
    ensureNodeSpatialGrid();
    if (nodeSpatialGrid.size > 0) {
      const cx = Math.floor(x / NODE_CELL_SIZE);
      const cy = Math.floor(y / NODE_CELL_SIZE);
      let closest = null;
      let minDistSq = Infinity;
      for (let r = 0; r <= 8; r++) {
        let foundInRing = false;
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const list = nodeSpatialGrid.get(`${cx + dx}:${cy + dy}`);
            if (!list) continue;
            for (let i = 0; i < list.length; i++) {
              const nid = list[i];
              const node = osmMap.nodes[nid];
              const dSq = (node[0] - x) ** 2 + (node[1] - y) ** 2;
              if (dSq < minDistSq) {
                minDistSq = dSq;
                closest = nid;
                foundInRing = true;
              }
            }
          }
        }
        if (foundInRing && Math.sqrt(minDistSq) <= r * NODE_CELL_SIZE) {
          return closest;
        }
      }
      if (closest) return closest;
    }
    let closest = null;
    let minDist = Infinity;
    for (const nid in osmMap.nodes) {
      const node = osmMap.nodes[nid];
      const d = Math.hypot(node[0] - x, node[1] - y);
      if (d < minDist) {
        minDist = d;
        closest = nid;
      }
    }
    return closest;
  }

  function findRoute(startPointOrNodeId, endPointOrNodeId) {
    if (!osmMap || !osmMap.nodes || osmAdj.size === 0) return null;
    let startNodeId = typeof startPointOrNodeId === 'string' || typeof startPointOrNodeId === 'number'
      ? String(startPointOrNodeId)
      : findNearestNode(startPointOrNodeId.x, startPointOrNodeId.y);
    let endNodeId = typeof endPointOrNodeId === 'string' || typeof endPointOrNodeId === 'number'
      ? String(endPointOrNodeId)
      : findNearestNode(endPointOrNodeId.x, endPointOrNodeId.y);

    if (!startNodeId || !endNodeId) return null;
    if (startNodeId === endNodeId) {
      const pt = osmMap.nodes[startNodeId];
      return { found: true, totalLength: 0, totalEstMinutes: 1, edges: [], polyline: pt ? [[pt[0], pt[1]]] : [[0, 0]] };
    }

    const dist = new Map();
    const prev = new Map();
    const pq = new RouteMinHeap();
    dist.set(startNodeId, 0);

    const endPt = osmMap.nodes[endNodeId];
    const startPt = osmMap.nodes[startNodeId];
    const h0 = endPt && startPt ? Math.hypot(startPt[0] - endPt[0], startPt[1] - endPt[1]) : 0;
    pq.push({ node: startNodeId, cost: 0, f: h0 });

    while (pq.size > 0) {
      const { node, cost } = pq.pop();
      if (node === endNodeId) {
        const pathEdges = [];
        const polyline = [];
        let cur = endNodeId;
        while (prev.has(cur)) {
          const { from, edge, reverse } = prev.get(cur);
          pathEdges.unshift(edge);
          const pts = reverse ? [...edge.points].reverse() : edge.points;
          for (let p = pts.length - 1; p >= 0; p--) polyline.unshift(pts[p]);
          cur = from;
        }
        const totalLength = dist.get(endNodeId);
        let totalMeters = 0;
        for (const e of pathEdges) {
          totalMeters += (typeof e.lengthM === 'number' ? e.lengthM : (e.length / MAP_SCALE));
        }
        const km = totalMeters / 1000;
        const estMinutes = Math.max(1, Math.round((km / 75) * 60));
        return { found: true, totalLength, totalLengthM: totalMeters, totalDistKm: km, totalEstMinutes: estMinutes, edges: pathEdges, polyline };
      }

      if (cost > dist.get(node)) continue;

      const neighbors = osmAdj.get(node) || [];
      for (const { to, weight, edge, reverse } of neighbors) {
        const nextCost = cost + weight;
        if (!dist.has(to) || nextCost < dist.get(to)) {
          dist.set(to, nextCost);
          prev.set(to, { from: node, edge, reverse });
          const toPt = osmMap.nodes[to];
          const h = toPt && endPt ? Math.hypot(toPt[0] - endPt[0], toPt[1] - endPt[1]) : 0;
          pq.push({ node: to, cost: nextCost, f: nextCost + h });
        }
      }
    }
    return null;
  }

  function getPositionAlongPolyline(polyline, distance) {
    if (!polyline || polyline.length === 0) return { x: 0, y: 0, angle: 0 };
    if (polyline.length === 1 || distance <= 0) {
      return { x: polyline[0][0], y: polyline[0][1], angle: 0 };
    }
    let accumulated = 0;
    for (let i = 0; i < polyline.length - 1; i++) {
      const p1 = polyline[i];
      const p2 = polyline[i + 1];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (accumulated + segLen >= distance || i === polyline.length - 2) {
        const t = segLen > 0 ? (distance - accumulated) / segLen : 0;
        const clampedT = Math.max(0, Math.min(1, t));
        const x = p1[0] + (p2[0] - p1[0]) * clampedT;
        const y = p1[1] + (p2[1] - p1[1]) * clampedT;
        const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        return { x, y, angle };
      }
      accumulated += segLen;
    }
    const last = polyline[polyline.length - 1];
    const prev = polyline[polyline.length - 2];
    return { x: last[0], y: last[1], angle: Math.atan2(last[1] - prev[1], last[0] - prev[0]) };
  }

  const junctionNodes = [];

  // Populate DEPOTS, FUELS, junctionNodes and GEOGRAPHY.pois strictly from osmMap data (moldova-map.json)
  function initMapObjects() {
    DEPOTS.length = 0;
    FUELS.length = 0;
    GEOGRAPHY.pois = [];
    junctionNodes.length = 0;

    // 1. Precalculate degree >= 3 junction nodes for seamless intersection rendering
    if (osmMap && osmMap.nodes && osmMap.edges) {
      const edgeMap = new Map();
      for (let i = 0; i < osmMap.edges.length; i++) {
        edgeMap.set(osmMap.edges[i].id, osmMap.edges[i]);
      }
      for (const [id, n] of Object.entries(osmMap.nodes)) {
        const edgeIds = n[2];
        if (edgeIds && edgeIds.length >= 3) {
          let maxW = 55;
          for (let e = 0; e < edgeIds.length; e++) {
            const edge = edgeMap.get(edgeIds[e]);
            if (edge) {
              const w = getRoadWidth(edge);
              if (w > maxW) maxW = w;
            }
          }
          junctionNodes.push({
            id,
            x: n[0],
            y: n[1],
            radius: maxW * 0.5,
            degree: edgeIds.length
          });
        }
      }

      // 1b. Precalculate paired divided highway edges (50-100 px apart, same ref, no links)
      const oneways = osmMap.edges.filter(e => e.oneway && e.ref && !e.roadClass.endsWith('_link'));
      const pairGrid = new Map();
      const cellSize = 300;
      for (let i = 0; i < oneways.length; i++) {
        const e = oneways[i];
        const b = e.bounds;
        if (!b) continue;
        const minCx = Math.floor(b[0] / cellSize);
        const maxCx = Math.floor(b[2] / cellSize);
        const minCy = Math.floor(b[1] / cellSize);
        const maxCy = Math.floor(b[3] / cellSize);
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            const k = cx + ',' + cy;
            let l = pairGrid.get(k);
            if (!l) { l = []; pairGrid.set(k, l); }
            l.push(e);
          }
        }
      }

      for (let i = 0; i < oneways.length; i++) {
        const e1 = oneways[i];
        const b = e1.bounds;
        if (!b) continue;
        const minCx = Math.floor((b[0] - 100) / cellSize);
        const maxCx = Math.floor((b[2] + 100) / cellSize);
        const minCy = Math.floor((b[1] - 100) / cellSize);
        const maxCy = Math.floor((b[3] + 100) / cellSize);
        const mid1 = e1.points[Math.floor(e1.points.length / 2)];
        let closestE2 = null;
        let minDist = 101;
        const seen = new Set();
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            const list = pairGrid.get(cx + ',' + cy);
            if (!list) continue;
            for (let j = 0; j < list.length; j++) {
              const e2 = list[j];
              if (e2.id === e1.id || seen.has(e2.id) || e2.ref !== e1.ref) continue;
              seen.add(e2.id);
              const mid2 = e2.points[Math.floor(e2.points.length / 2)];
              const d = Math.hypot(mid1[0] - mid2[0], mid1[1] - mid2[1]);
              if (d >= 50 && d <= 100 && d < minDist) {
                minDist = d;
                closestE2 = e2;
              }
            }
          }
        }
        if (closestE2) {
          e1.pairedEdgeId = closestE2.id;
          e1.medianDist = minDist;
          const mid2 = closestE2.points[Math.floor(closestE2.points.length / 2)];
          const vx = mid2[0] - mid1[0];
          const vy = mid2[1] - mid1[1];
          const mIdx = Math.floor(e1.points.length / 2);
          const pPrev = e1.points[Math.max(0, mIdx - 1)];
          const pNext = e1.points[Math.min(e1.points.length - 1, mIdx + 1)];
          const tdx = pNext[0] - pPrev[0];
          const tdy = pNext[1] - pPrev[1];
          const tlen = Math.hypot(tdx, tdy) || 1;
          const nx = -tdy / tlen;
          const ny = tdx / tlen;
          const dot = vx * nx + vy * ny;
          e1.medianSide = dot >= 0 ? 1 : -1;
        }
      }

      // 1c. Dynamic road signs placed ~150 px before interchanges/junctions on the right
      ROAD_SIGNS.length = 0;
      const majorClasses = new Set(['motorway', 'trunk', 'primary', 'secondary']);
      const placedSigns = [];
      for (let i = 0; i < osmMap.edges.length; i++) {
        const edge = osmMap.edges[i];
        if (!majorClasses.has(edge.roadClass) || edge.length < 120) continue;
        const pts = edge.points;
        if (!pts || pts.length < 2) continue;

        const toNode = osmMap.nodes[edge.to];
        if (!toNode) continue;
        const connected = toNode[2] || [];
        if (connected.length < 2) continue;

        let hasBranch = connected.length >= 3;
        let branchRef = null;
        let branchName = null;
        for (let j = 0; j < connected.length; j++) {
          const ce = edgeMap.get(connected[j]);
          if (!ce || ce.id === edge.id) continue;
          if (ce.roadClass && ce.roadClass.endsWith('_link')) hasBranch = true;
          if (ce.ref && ce.ref !== edge.ref) branchRef = ce.ref;
          if (ce.name && ce.name !== edge.name) branchName = ce.name;
        }
        if (!hasBranch) continue;

        // Position ~150 px before junction along travel direction
        const targetDist = Math.max(edge.length * 0.4, edge.length - 150);
        const pos = getPositionAlongPolyline(pts, targetDist);
        if (!pos) continue;

        const roadW = getRoadWidth(edge);
        // Right normal: (-sin(angle), cos(angle))
        const nx = -Math.sin(pos.angle);
        const ny = Math.cos(pos.angle);
        const shoulderX = pos.x + nx * (roadW * 0.5);
        const shoulderY = pos.y + ny * (roadW * 0.5);
        const signX = pos.x + nx * (roadW * 0.5 + 20);
        const signY = pos.y + ny * (roadW * 0.5 + 20);

        // Deduplicate nearby signs
        let tooClose = false;
        for (let p = 0; p < placedSigns.length; p++) {
          if (Math.hypot(signX - placedSigns[p].x, signY - placedSigns[p].y) < 250) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        let mainText = edge.ref || '';
        if (!mainText) {
          mainText = edge.name ? edge.name.slice(0, 16) : 'Трасса';
        }
        if (mainText.toUpperCase().includes('TRASEU')) {
          mainText = mainText.replace(/Traseul|Traseu|TRASEUL|TRASEU/gi, 'Трасса');
        }

        let subText = 'Перекрёсток 150м ↗';
        if (branchRef) {
          subText = `${branchRef} ↗  |  ${mainText} ↑`;
        } else if (branchName) {
          let bName = branchName;
          if (bName.includes('Cricova')) bName = 'Крикова';
          else if (bName.includes('Orhei')) bName = 'Орхей';
          else if (bName.includes('Chișinău') || bName.includes('Chisinau')) bName = 'Кишинёв';
          else if (bName.includes('Bălți') || bName.includes('Balti')) bName = 'Бельцы';
          subText = `${bName.slice(0, 14)} ↗`;
        }

        const signObj = {
          x: signX,
          y: signY,
          roadX: shoulderX,
          roadY: shoulderY,
          angle: pos.angle,
          main: mainText,
          sub: subText,
          speed: edge.maxspeed || (edge.roadClass === 'trunk' || edge.roadClass === 'motorway' ? 90 : 70),
          roadClass: edge.roadClass
        };
        placedSigns.push(signObj);
        ROAD_SIGNS.push(signObj);
      }
    }

    // 2. Depots
    if (osmMap && Array.isArray(osmMap.depots)) {
      for (const d of osmMap.depots) {
        if (!d.nearestNodeId && typeof findNearestNode === 'function') {
          d.nearestNodeId = findNearestNode(d.x, d.y);
        }
        d.rampX = d.x;
        d.rampY = d.y;
        DEPOTS.push(d);
        GEOGRAPHY.pois.push({
          id: d.id,
          name: d.name,
          cityName: d.cityName,
          type: 'depot',
          x: d.x,
          y: d.y,
          label: d.cityName || d.name,
          nearestNodeId: d.nearestNodeId
        });
      }
    }

    // 3. Fuels: offset point by w/2 + 30 px from nearest road centerline away from road,
    // then if after offset two fuels are closer than 120 px, keep one (with brand).
    if (osmMap && Array.isArray(osmMap.fuels)) {
      const offsetCandidates = [];

      for (const f of osmMap.fuels) {
        if (!f.nearestNodeId && typeof findNearestNode === 'function') {
          f.nearestNodeId = findNearestNode(f.x, f.y);
        }

        let bestDistSq = Infinity;
        let bestEdge = null;
        let bestPt = null;
        let bestNormal = null;
        let bestAngle = 0;

        if (osmMap.edges) {
          for (let e = 0; e < osmMap.edges.length; e++) {
            const edge = osmMap.edges[e];
            const b = edge.bounds;
            if (b && (f.x < b[0] - 250 || f.x > b[2] + 250 || f.y < b[1] - 250 || f.y > b[3] + 250)) continue;
            const pts = edge.points;
            if (!pts || pts.length < 2) continue;
            for (let i = 0; i < pts.length - 1; i++) {
              const x1 = pts[i][0], y1 = pts[i][1];
              const x2 = pts[i + 1][0], y2 = pts[i + 1][1];
              const dx = x2 - x1, dy = y2 - y1;
              const l2 = dx * dx + dy * dy;
              if (l2 === 0) continue;
              let t = ((f.x - x1) * dx + (f.y - y1) * dy) / l2;
              t = Math.max(0, Math.min(1, t));
              const qx = x1 + t * dx;
              const qy = y1 + t * dy;
              const dSq = (f.x - qx) * (f.x - qx) + (f.y - qy) * (f.y - qy);
              if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestEdge = edge;
                const L = Math.hypot(dx, dy);
                const nx = -dy / L;
                const ny = dx / L;
                bestAngle = Math.atan2(dy, dx);
                bestPt = { x: qx, y: qy };
                const dot = (f.x - qx) * nx + (f.y - qy) * ny;
                const side = dot < 0 ? -1 : 1;
                bestNormal = { nx: nx * side, ny: ny * side };
              }
            }
          }
        }

        let posX = f.x;
        let posY = f.y;
        let angle = 0;
        if (bestEdge && bestPt && bestNormal) {
          const w = getRoadWidth(bestEdge);
          const offsetDist = w * 0.5 + 30; // w/2 + 30 px from centerline away from road
          posX = bestPt.x + bestNormal.nx * offsetDist;
          posY = bestPt.y + bestNormal.ny * offsetDist;
          angle = bestAngle;
        }

        offsetCandidates.push({
          ...f,
          x: posX,
          y: posY,
          rawX: f.x,
          rawY: f.y,
          angle,
          hasBrand: Boolean(f.brand && f.brand.trim())
        });
      }

      // Sort so stations with brand come first
      offsetCandidates.sort((a, b) => {
        const aB = a.hasBrand ? 1 : 0;
        const bB = b.hasBrand ? 1 : 0;
        return bB - aB;
      });

      // Deduplicate AFTER offset: if two fuels are closer than 120 px, keep one (with brand)
      const dedupedFuels = [];
      for (const cand of offsetCandidates) {
        let tooClose = false;
        for (const kept of dedupedFuels) {
          if (Math.hypot(cand.x - kept.x, cand.y - kept.y) < 120) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          dedupedFuels.push(cand);
        }
      }

      for (const fuelObj of dedupedFuels) {
        FUELS.push(fuelObj);
        GEOGRAPHY.pois.push({
          id: fuelObj.id,
          name: fuelObj.name || (fuelObj.brand ? 'АЗС ' + fuelObj.brand : ''),
          brand: fuelObj.brand || '',
          type: 'gas',
          x: fuelObj.x,
          y: fuelObj.y,
          angle: fuelObj.angle,
          label: fuelObj.brand || fuelObj.name || '',
          nearestNodeId: fuelObj.nearestNodeId
        });
      }
    }
  }

  initMapObjects();

  const MapSystem = {
    MAP_SCALE,
    UNITS_PER_METER,
    ETS2_SCALE,
    realKmToUnits,
    unitsToRealKm,
    unitsToRealMeters,
    getEdgeLanes,
    getRoadWidth,
    junctionNodes,
    OSM: osmMap,
    edges: osmMap ? osmMap.edges : [],
    findRoute,
    findNearestNode,
    getPositionAlongPolyline,
    CITIES: (osmMap && osmMap.cities && osmMap.cities.length > 10) ? osmMap.cities : CITIES,
    DEPOTS,
    FUELS,
    ROAD_SIGNS,
    CITY_BLOCKS,
    GEOGRAPHY,
    bridges: GEOGRAPHY.bridges,
    BRIDGES: GEOGRAPHY.bridges,
    CARGO_CATALOG,
    getAllDepots: () => DEPOTS,
    getAllFuels: () => FUELS,
    getStartSpawn: () => ({ x: 1200, y: 2950, angle: -Math.PI / 2 }),
    initMapObjects
  };

  root.ETSMap = MapSystem;
  if (typeof module !== 'undefined' && module.exports) module.exports = MapSystem;
})(typeof globalThis !== 'undefined' ? globalThis : window);
