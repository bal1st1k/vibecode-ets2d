/*! 2D ETS2 Moldova Edition | High-Performance Realistic World Renderer | ETS2 Visuals */
(function (root) {
  'use strict';

  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h) {
      if (typeof this.rect === 'function') this.rect(x, y, w, h);
    };
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function createTileCanvas(width = 1024, height = 1024) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }
    return {
      width,
      height,
      getContext() {
        return {
          canvas: this,
          save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
          setTransform() {}, fillRect() {}, strokeRect() {}, beginPath() {},
          closePath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {},
          fill() {}, fillText() {}, setLineDash() {}, clearRect() {}, rect() {},
          roundRect() {}, drawImage() {}
        };
      }
    };
  }

  class RoadSpatialGrid {
    constructor(cellSize = 512) {
      this.cellSize = cellSize;
      this.cells = new Map();
    }

    build(edges) {
      this.cells.clear();
      if (!edges) return;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const b = e.bounds;
        if (!b) continue;
        const minCx = Math.floor(b[0] / this.cellSize);
        const maxCx = Math.floor(b[2] / this.cellSize);
        const minCy = Math.floor(b[1] / this.cellSize);
        const maxCy = Math.floor(b[3] / this.cellSize);

        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            const k = `${cx}:${cy}`;
            let list = this.cells.get(k);
            if (!list) {
              list = [];
              this.cells.set(k, list);
            }
            list.push(e);
          }
        }
      }
    }

    query(minX, minY, maxX, maxY) {
      const minCx = Math.floor(minX / this.cellSize);
      const maxCx = Math.floor(maxX / this.cellSize);
      const minCy = Math.floor(minY / this.cellSize);
      const maxCy = Math.floor(maxY / this.cellSize);

      const result = [];
      const visited = new Set();

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const list = this.cells.get(`${cx}:${cy}`);
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (!visited.has(e.id)) {
              visited.add(e.id);
              const b = e.bounds;
              if (b && (b[2] < minX || b[0] > maxX || b[3] < minY || b[1] > maxY)) continue;
              result.push(e);
            }
          }
        }
      }
      return result;
    }
  }

  class JunctionSpatialGrid {
    constructor(cellSize = 512) {
      this.cellSize = cellSize;
      this.cells = new Map();
    }

    build(junctions) {
      this.cells.clear();
      if (!junctions || !junctions.length) return;
      for (let i = 0; i < junctions.length; i++) {
        const j = junctions[i];
        const r = j.radius || 46;
        const minCx = Math.floor((j.x - r) / this.cellSize);
        const maxCx = Math.floor((j.x + r) / this.cellSize);
        const minCy = Math.floor((j.y - r) / this.cellSize);
        const maxCy = Math.floor((j.y + r) / this.cellSize);

        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            const k = `${cx}:${cy}`;
            let list = this.cells.get(k);
            if (!list) {
              list = [];
              this.cells.set(k, list);
            }
            list.push(j);
          }
        }
      }
    }

    query(minX, minY, maxX, maxY) {
      const minCx = Math.floor(minX / this.cellSize);
      const maxCx = Math.floor(maxX / this.cellSize);
      const minCy = Math.floor(minY / this.cellSize);
      const maxCy = Math.floor(maxY / this.cellSize);

      const result = [];
      const visited = new Set();

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const list = this.cells.get(`${cx}:${cy}`);
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const j = list[i];
            if (!visited.has(j.id)) {
              visited.add(j.id);
              if (j.x + j.radius >= minX && j.x - j.radius <= maxX &&
                  j.y + j.radius >= minY && j.y - j.radius <= maxY) {
                result.push(j);
              }
            }
          }
        }
      }
      return result;
    }
  }

  class PointSpatialGrid {
    constructor(cellSize = 512) {
      this.cellSize = cellSize;
      this.cells = new Map();
    }

    build(items) {
      this.cells.clear();
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item.x !== 'number' || typeof item.y !== 'number') continue;
        const cx = Math.floor(item.x / this.cellSize);
        const cy = Math.floor(item.y / this.cellSize);
        const k = `${cx}:${cy}`;
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(item);
      }
    }

    query(minX, minY, maxX, maxY) {
      const minCx = Math.floor(minX / this.cellSize);
      const maxCx = Math.floor(maxX / this.cellSize);
      const minCy = Math.floor(minY / this.cellSize);
      const maxCy = Math.floor(maxY / this.cellSize);
      const res = [];
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const list = this.cells.get(`${cx}:${cy}`);
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
              res.push(item);
            }
          }
        }
      }
      return res;
    }
  }

  class TileLRUCache {
    constructor(maxSize = 40) {
      this.maxSize = maxSize;
      this.map = new Map();
      this.pool = [];
    }

    clear() {
      for (const tile of this.map.values()) {
        if (tile && tile.canvas && this.pool.length < 8) {
          this.pool.push(tile.canvas);
        }
      }
      this.map.clear();
    }

    get(key) {
      const item = this.map.get(key);
      if (!item) return null;
      this.map.delete(key);
      this.map.set(key, item);
      return item;
    }

    put(key, tile) {
      if (this.map.has(key)) {
        this.map.delete(key);
      }
      this.map.set(key, tile);
      if (this.map.size > this.maxSize) {
        const oldestKey = this.map.keys().next().value;
        const evicted = this.map.get(oldestKey);
        this.map.delete(oldestKey);
        if (evicted && evicted.canvas) {
          if (this.pool.length < 8) {
            this.pool.push(evicted.canvas);
          } else {
            evicted.canvas.width = 0;
            evicted.canvas.height = 0;
          }
        }
      }
    }

    recycleCanvas() {
      return this.pool.pop() || null;
    }
  }

  class TruckRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      this.width = canvas.width;
      this.height = canvas.height;
      this.zoom = 1.0;
      this.targetZoom = 1.0;
      this.turnBlinkTimer = 0;
      this.turnBlinkOn = false;
      this.pulseTimer = 0;
      this.osmEdges = (typeof root !== 'undefined' && root.OSM_MOLDOVA_MAP) ? root.OSM_MOLDOVA_MAP.edges : null;

      // Spatial grid and Tile LRU Cache (Item 1, 2, 3)
      this.spatialGrid = new RoadSpatialGrid(512);
      this.junctionGrid = new JunctionSpatialGrid(512);
      this.signGrid = new PointSpatialGrid(512);
      this.poiGrid = new PointSpatialGrid(512);
      this.tileCache = new TileLRUCache(40);
      this.spatialGridReady = false;

      // Performance profiling (F3 overlay)
      this.showPerf = false;
      this.perf = {
        fps: 60,
        frameTime: 16.6,
        sections: {
          roads: 0,
          guardrails: 0,
          markings: 0,
          entities: 0
        }
      };
      this._lastFrameTime = 0;

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.floor(rect.width || 800);
      this.height = Math.floor(rect.height || 600);
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = false;
        if ('mozImageSmoothingEnabled' in this.ctx) this.ctx.mozImageSmoothingEnabled = false;
        if ('imageSmoothingQuality' in this.ctx) this.ctx.imageSmoothingQuality = 'low';
      }
    }

    render(sim, dt = 0.016) {
      if (!this.ctx || !sim) return;
      const ctx = this.ctx;
      const t = sim.truck;
      const r = sim.trailer;
      const map = sim.map;

      if (!this.spatialGridReady) {
        this._initSpatialGrids(map);
      }

      const frameStart = performance.now();
      if (this._lastFrameTime > 0) {
        const delta = frameStart - this._lastFrameTime;
        if (delta > 0 && delta < 1000) {
          this.perf.frameTime = this.perf.frameTime * 0.9 + delta * 0.1;
          this.perf.fps = 1000 / Math.max(1, this.perf.frameTime);
        }
      }
      this._lastFrameTime = frameStart;

      this.pulseTimer = (this.pulseTimer + dt) % 100;

      // Update blinker
      this.turnBlinkTimer += dt;
      if (this.turnBlinkTimer > 0.35) {
        this.turnBlinkOn = !this.turnBlinkOn;
        this.turnBlinkTimer = 0;
      }

      // Dynamic camera zoom based on speed: 0 km/h: 1.15, 90 km/h: ~0.80 (25-35% zoom out)
      const speedKmh = sim.currentSpeedKmh || 0;
      const speedRatio = clamp(speedKmh / 90, 0, 1.25);
      const baseZoom = 1.05;
      this.targetZoom = clamp(baseZoom - 0.08 * speedRatio, 0.98, 1.05);
      this.zoom += (this.targetZoom - this.zoom) * clamp(dt * 3.0, 0, 1);

      // Smooth camera forward lookahead up to 25% of screen height
      const worldHeight = this.height / this.zoom;
      const maxForwardOffset = worldHeight * 0.25;
      const forwardRatio = clamp(speedKmh / 80, 0.2, 1.0);
      const targetCamX = t.x + Math.cos(t.angle) * (maxForwardOffset * forwardRatio);
      const targetCamY = t.y + Math.sin(t.angle) * (maxForwardOffset * forwardRatio);

      if (this.camX === undefined || this.camY === undefined) {
        this.camX = targetCamX;
        this.camY = targetCamY;
      } else {
        const camLerp = clamp(dt * 4.0, 0, 1);
        this.camX += (targetCamX - this.camX) * camLerp;
        this.camY += (targetCamY - this.camY) * camLerp;
      }

      // Viewport culling bounds (in world units)
      const halfW = this.width / (2 * this.zoom);
      const halfH = this.height / (2 * this.zoom);
      const view = {
        minX: this.camX - halfW,
        maxX: this.camX + halfW,
        minY: this.camY - halfH,
        maxY: this.camY + halfH
      };

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // 1. Natural dark earth backdrop (#0e1310)
      ctx.fillStyle = '#0e1310';
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.save();
      const snapHalfW = Math.round(this.width * 0.5);
      const snapHalfH = Math.round(this.height * 0.5);
      const snapCamX = Math.round(this.camX);
      const snapCamY = Math.round(this.camY);
      ctx.translate(snapHalfW, snapHalfH);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-snapCamX, -snapCamY);

      // 2 & 3. Static World Tiles Layer (terrain, rivers, casing, asphalt, markings, medians, guardrails, bridges)
      const roadMetrics = this._drawStaticWorld(ctx, map, view, sim) || { roadsTime: 0, guardrailsTime: 0, markingsTime: 0 };

      const tEntStart = performance.now();

      // 3b. Active Navigation Route in World (wide semi-transparent green line + narrow bright + running chevrons + next turn)
      const tR0 = performance.now();
      this._drawWorldRoute(ctx, sim, view);
      const tR1 = performance.now();

      // 6. Draw City Architecture, Buildings & Logistics Depots
      this._drawCityBuildings(ctx, map, view, sim);
      const tC1 = performance.now();

      // 7. Draw Highway Overhead Signs & Speed Limits
      this._drawRoadSigns(ctx, map.ROAD_SIGNS, view);
      const tS1 = performance.now();

      // 8. Vehicle Shadows
      if (r.attached) this._drawShadow(ctx, r.x, r.y, r.angle, 136, 25);
      this._drawShadow(ctx, t.x, t.y, t.angle, 68, 25);

      // 9. Reversing guide line (subtle)
      if (t.gear === -1 && r.attached) {
        this._drawReverseGuide(ctx, t, r);
      }

      // 10. Semi-Trailer
      if (r.attached) {
        this._drawTrailer(ctx, r, t, sim);
      }

      // 11. Truck
      this._drawTruck(ctx, t, sim);

      // 12. Headlights cone
      if (t.lights > 0) {
        this._drawHeadlightBeams(ctx, t);
      }

      ctx.restore();

      // 13. HUD Mini-Map in Top Right Corner (circular 220 px, ~3000 px surroundings, route, position & heading)
      const tM0 = performance.now();
      this._drawMiniMap(ctx, sim);
      const tM1 = performance.now();

      const entTime = performance.now() - tEntStart;
      this.perf._entBreakdown = {
        route: tR1 - tR0,
        city: tC1 - tR1,
        signs: tS1 - tC1,
        minimap: tM1 - tM0
      };

      // Update perf metrics (exponential smoothing)
      this.perf.sections.roads = this.perf.sections.roads * 0.85 + roadMetrics.roadsTime * 0.15;
      this.perf.sections.guardrails = this.perf.sections.guardrails * 0.85 + roadMetrics.guardrailsTime * 0.15;
      this.perf.sections.markings = this.perf.sections.markings * 0.85 + roadMetrics.markingsTime * 0.15;
      this.perf.sections.entities = this.perf.sections.entities * 0.85 + entTime * 0.15;

      // 14. HUD Performance Profiler Overlay (F3)
      if (this.showPerf) {
        this._drawPerfOverlay(ctx);
      }
    }

    // ==============================================================
    // ROAD SYSTEM HELPERS & GEOMETRY
    // ==============================================================

    // Helper: road lanes lookup: oneway trunk/primary = 2, others = 1; two-way = 2; max 3 lanes; links = 1
    getEdgeLanes(edge) {
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

    // Helper: road width calculation: lanes * 36 + shoulders of 10 px each side for trunk/primary/secondary. Links = 36 px (no shoulder).
    getRoadWidth(edgeOrClass, maybeLanes, maybeOneway) {
      let rc, lanes, oneway;
      if (typeof edgeOrClass === 'object' && edgeOrClass !== null) {
        rc = edgeOrClass.roadClass || '';
        lanes = this.getEdgeLanes(edgeOrClass);
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

    _getRoadTier(rc) {
      if (!rc) return 0;
      if (rc === 'motorway' || rc === 'trunk' || rc === 'motorway_link' || rc === 'trunk_link') return 4;
      if (rc === 'primary' || rc === 'primary_link') return 3;
      if (rc === 'secondary' || rc === 'secondary_link') return 2;
      if (rc === 'tertiary' || rc === 'tertiary_link') return 1;
      return 0; // service, residential, living_street, unclassified, other
    }

    _offsetPolyline(pts, offset) {
      if (!pts || pts.length < 2) return [];
      const n = pts.length;
      const result = [];
      for (let i = 0; i < n; i++) {
        let dx, dy;
        if (i === 0) {
          dx = pts[1][0] - pts[0][0];
          dy = pts[1][1] - pts[0][1];
        } else if (i === n - 1) {
          dx = pts[n - 1][0] - pts[n - 2][0];
          dy = pts[n - 1][1] - pts[n - 2][1];
        } else {
          const dx1 = pts[i][0] - pts[i - 1][0];
          const dy1 = pts[i][1] - pts[i - 1][1];
          const dx2 = pts[i + 1][0] - pts[i][0];
          const dy2 = pts[i + 1][1] - pts[i][1];
          const l1 = Math.hypot(dx1, dy1) || 1;
          const l2 = Math.hypot(dx2, dy2) || 1;
          dx = dx1 / l1 + dx2 / l2;
          dy = dy1 / l1 + dy2 / l2;
        }
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        result.push([pts[i][0] + nx * offset, pts[i][1] + ny * offset]);
      }
      return result;
    }

    _trimPolyline(points, trimStart, trimEnd) {
      if (!points || points.length < 2) return null;
      let totalLen = 0;
      const dists = [0];
      for (let i = 1; i < points.length; i++) {
        const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        totalLen += d;
        dists.push(totalLen);
      }
      if (totalLen <= trimStart + trimEnd) return null;

      const targetStart = trimStart;
      const targetEnd = totalLen - trimEnd;
      const result = [];

      for (let i = 1; i < points.length; i++) {
        if (dists[i] >= targetStart) {
          const segLen = dists[i] - dists[i - 1];
          const t = segLen > 0 ? (targetStart - dists[i - 1]) / segLen : 0;
          result.push([
            points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
            points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t
          ]);
          for (let j = i; j < points.length; j++) {
            if (dists[j] < targetEnd) {
              result.push([points[j][0], points[j][1]]);
            } else {
              const segEndLen = dists[j] - dists[j - 1];
              const te = segEndLen > 0 ? (targetEnd - dists[j - 1]) / segEndLen : 0;
              result.push([
                points[j - 1][0] + (points[j][0] - points[j - 1][0]) * te,
                points[j - 1][1] + (points[j][1] - points[j - 1][1]) * te
              ]);
              break;
            }
          }
          break;
        }
      }
      return result;
    }

    // ==============================================================
    // HIGHWAYS & STATIC WORLD TILE CACHE (LRU 40 Tiles, 512 World Units, 2 px/unit)
    // ==============================================================

    _initSpatialGrids(map) {
      const edges = (map && map.OSM && map.OSM.edges) || (map && map.edges) || this.osmEdges || [];
      if (edges && edges.length > 0) {
        this.spatialGrid.build(edges);
        const junctions = (map && map.junctionNodes) || [];
        this.junctionGrid.build(junctions);
        if (map && map.ROAD_SIGNS) {
          this.signGrid.build(map.ROAD_SIGNS);
        }
        const pois = (map && map.GEOGRAPHY && map.GEOGRAPHY.pois) || [];
        if (pois.length > 0) {
          this.poiGrid.build(pois);
        }
        this.spatialGridReady = true;
      }
    }

    _ensureEdgeCached(e, map) {
      if (e._cached) return;
      e._cached = true;

      const w = (map && map.getRoadWidth ? map.getRoadWidth(e) : this.getRoadWidth(e));
      const lanes = (map && map.getEdgeLanes ? map.getEdgeLanes(e) : this.getEdgeLanes(e));
      const tier = this._getRoadTier(e.roadClass);

      e._w = w;
      e._lanes = lanes;
      e._tier = tier;

      const osmNodes = (map && map.OSM && map.OSM.nodes) || (map && map.nodes) || {};
      const isJunc = (nodeId) => {
        const n = osmNodes[nodeId];
        return Boolean(n && Array.isArray(n[2]) && n[2].length >= 3);
      };

      const fromJunc = isJunc(e.from);
      const toJunc = isJunc(e.to);

      // 1. Median strip for divided dual-carriageway highways (50-100 px between axes)
      if (e.pairedEdgeId && e.medianSide && e.medianDist >= 50 && e.medianDist <= 100) {
        if (e.id <= e.pairedEdgeId) {
          const medianOffset = e.medianSide * (e.medianDist * 0.5);
          e._medianPts = this._offsetPolyline(e.points, medianOffset);
          e._medianW = Math.max(10, e.medianDist - w + 6);
        }

        // 2. Guardrails along inner edges of divided paired highways
        // Trimmed near degree >= 3 junction nodes by w/2 + 20 px
        const gRadius = w * 0.5 + 20;
        const trimStart = fromJunc ? gRadius : 0;
        const trimEnd = toJunc ? gRadius : 0;
        const trimmedE = (trimStart > 0 || trimEnd > 0)
          ? this._trimPolyline(e.points, trimStart, trimEnd)
          : e.points;

        if (trimmedE && trimmedE.length >= 2) {
          const gOffset = e.medianSide * (w * 0.5 - 1);
          e._guardrailPts = this._offsetPolyline(trimmedE, gOffset);
        }
      }

      // 3. Markings: trimmed near degree >= 3 nodes by w/2 + 10 px
      if (lanes >= 2) {
        const carriagewayW = lanes * 36;
        const halfC = carriagewayW * 0.5;
        const trimStart = fromJunc ? (w * 0.5 + 10) : 0;
        const trimEnd = toJunc ? (w * 0.5 + 10) : 0;

        const trimmed = (trimStart > 0 || trimEnd > 0)
          ? this._trimPolyline(e.points, trimStart, trimEnd)
          : e.points;

        if (trimmed && trimmed.length >= 2) {
          e._dashedMarkings = [];
          for (let k = 1; k < lanes; k++) {
            const offset = -halfC + k * 36;
            const linePts = this._offsetPolyline(trimmed, offset);
            if (!linePts || linePts.length < 2) continue;
            e._dashedMarkings.push(linePts);
          }
        }
      }
    }

    _hasRiversInBounds(minX, minY, maxX, maxY, geo) {
      if (!geo) return false;
      const rivers = [geo.nistruRiver, geo.prutRiver, geo.rautRiver, geo.bicRiver];
      for (let i = 0; i < rivers.length; i++) {
        const pts = rivers[i];
        if (!pts || pts.length < 2) continue;
        if (!pts._bounds) {
          let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
          for (let p = 0; p < pts.length; p++) {
            if (pts[p].x < rMinX) rMinX = pts[p].x;
            if (pts[p].x > rMaxX) rMaxX = pts[p].x;
            if (pts[p].y < rMinY) rMinY = pts[p].y;
            if (pts[p].y > rMaxY) rMaxY = pts[p].y;
          }
          pts._bounds = [rMinX, rMinY, rMaxX, rMaxY];
        }
        const b = pts._bounds;
        if (b[2] < minX - 150 || b[0] > maxX + 150 || b[3] < minY - 150 || b[1] > maxY + 150) {
          continue;
        }
        for (let p = 0; p < pts.length; p++) {
          if (pts[p].x >= minX - 150 && pts[p].x <= maxX + 150 &&
              pts[p].y >= minY - 150 && pts[p].y <= maxY + 150) {
            return true;
          }
        }
      }
      return false;
    }

    _hasBridgesInBounds(minX, minY, maxX, maxY, map) {
      const bridges = (map && (map.bridges || (map.GEOGRAPHY && map.GEOGRAPHY.bridges))) ||
                      (root && root.ETSMap && (root.ETSMap.bridges || (root.ETSMap.GEOGRAPHY && root.ETSMap.GEOGRAPHY.bridges))) || [];
      for (let i = 0; i < bridges.length; i++) {
        const b = bridges[i];
        const len = b.length || b.len || 200;
        if (b.x + len >= minX && b.x - len <= maxX &&
            b.y + len >= minY && b.y - len <= maxY) {
          return true;
        }
      }
      return false;
    }

    _drawTerrainForTile(tCtx, map, minX, minY, maxX, maxY) {
      // 1. Agricultural fields
      const fieldSize = 600;
      const startX = Math.floor(minX / fieldSize) * fieldSize;
      const startY = Math.floor(minY / fieldSize) * fieldSize;
      for (let x = startX; x <= maxX; x += fieldSize) {
        for (let y = startY; y <= maxY; y += fieldSize) {
          const hash = Math.abs(Math.sin(x * 0.0013 + y * 0.0029) * 10000);
          const variant = Math.floor(hash) % 4;
          const colors = ['#0f1511', '#121a14', '#111713', '#141c16'];
          tCtx.fillStyle = colors[variant];
          tCtx.fillRect(x + 4, y + 4, fieldSize - 8, fieldSize - 8);
          tCtx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
          tCtx.lineWidth = 1;
          tCtx.strokeRect(x, y, fieldSize, fieldSize);
        }
      }

      // 2. Forests (only if bounds intersect tile)
      const geo = map && map.GEOGRAPHY;
      if (geo && geo.forests) {
        for (let i = 0; i < geo.forests.length; i++) {
          const f = geo.forests[i];
          const pts = f.points;
          if (!pts || pts.length < 3) continue;
          if (!f._bounds) {
            let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity;
            for (let p = 0; p < pts.length; p++) {
              if (pts[p].x < fMinX) fMinX = pts[p].x;
              if (pts[p].x > fMaxX) fMaxX = pts[p].x;
              if (pts[p].y < fMinY) fMinY = pts[p].y;
              if (pts[p].y > fMaxY) fMaxY = pts[p].y;
            }
            f._bounds = [fMinX, fMinY, fMaxX, fMaxY];
          }
          const b = f._bounds;
          if (b[2] < minX || b[0] > maxX || b[3] < minY || b[1] > maxY) continue;

          tCtx.fillStyle = '#0b160e';
          tCtx.strokeStyle = '#122417';
          tCtx.lineWidth = 6;
          tCtx.beginPath();
          tCtx.moveTo(pts[0].x, pts[0].y);
          for (let p = 1; p < pts.length; p++) tCtx.lineTo(pts[p].x, pts[p].y);
          tCtx.closePath();
          tCtx.fill();
          tCtx.stroke();
        }
      }

      // 3. Rivers (only if tile has rivers in bounds)
      if (this._hasRiversInBounds(minX, minY, maxX, maxY, geo)) {
        const rivers = [
          { pts: geo?.nistruRiver, width: 140 },
          { pts: geo?.prutRiver, width: 120 },
          { pts: geo?.rautRiver, width: 95 },
          { pts: geo?.bicRiver, width: 85 }
        ];
        for (let i = 0; i < rivers.length; i++) {
          const r = rivers[i];
          if (!r.pts || r.pts.length < 2) continue;
          tCtx.strokeStyle = '#0d1a24';
          tCtx.lineWidth = r.width + 12;
          tCtx.lineCap = 'round';
          tCtx.lineJoin = 'round';
          tCtx.beginPath();
          r.pts.forEach((p, idx) => { if (idx === 0) tCtx.moveTo(p.x, p.y); else tCtx.lineTo(p.x, p.y); });
          tCtx.stroke();

          tCtx.strokeStyle = '#163346';
          tCtx.lineWidth = r.width;
          tCtx.stroke();

          tCtx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
          tCtx.lineWidth = r.width * 0.4;
          tCtx.stroke();
        }
      }
    }

    _drawBridgesForTile(tCtx, minX, minY, maxX, maxY, map) {
      const bridges = (map && (map.bridges || (map.GEOGRAPHY && map.GEOGRAPHY.bridges))) ||
                      (root && root.ETSMap && (root.ETSMap.bridges || (root.ETSMap.GEOGRAPHY && root.ETSMap.GEOGRAPHY.bridges))) || [];

      for (let i = 0; i < bridges.length; i++) {
        const br = bridges[i];
        const len = br.length || br.len || 200;
        const width = br.width || 140;
        if (br.x + len < minX || br.x - len > maxX || br.y + len < minY || br.y - len > maxY) continue;

        tCtx.save();
        tCtx.translate(br.x, br.y);
        tCtx.rotate(br.angle || 0);

        tCtx.fillStyle = '#374151';
        tCtx.fillRect(-len * 0.5 - 15, -width * 0.5 - 6, len + 30, 6);
        tCtx.fillRect(-len * 0.5 - 15, width * 0.5, len + 30, 6);

        tCtx.fillStyle = '#94a3b8';
        tCtx.fillRect(-len * 0.5, -width * 0.5 - 4, len, 3);
        tCtx.fillRect(-len * 0.5, width * 0.5 + 1, len, 3);

        tCtx.setLineDash([]);
        tCtx.fillStyle = '#94a3b8';
        for (let bx = -len * 0.5; bx <= len * 0.5; bx += 25) {
          tCtx.fillRect(bx - 1.5, -width * 0.5 - 6, 3, 5);
          tCtx.fillRect(bx - 1.5, width * 0.5 + 1, 3, 5);
        }
        tCtx.restore();
      }
    }

    _buildTile(tx, ty, map, metrics) {
      const tileMinX = tx * 512;
      const tileMaxX = (tx + 1) * 512;
      const tileMinY = ty * 512;
      const tileMaxY = (ty + 1) * 512;

      const tileEdges = this.spatialGrid ? this.spatialGrid.query(tileMinX - 60, tileMinY - 60, tileMaxX + 60, tileMaxY + 60) : [];
      const tileJunctions = this.junctionGrid ? this.junctionGrid.query(tileMinX - 60, tileMinY - 60, tileMaxX + 60, tileMaxY + 60) : [];

      const geo = map && map.GEOGRAPHY;
      const hasRivers = this._hasRiversInBounds(tileMinX, tileMinY, tileMaxX, tileMaxY, geo);
      const hasBridges = this._hasBridgesInBounds(tileMinX, tileMinY, tileMaxX, tileMaxY, map);

      if (tileEdges.length === 0 && !hasRivers && !hasBridges) {
        return { empty: true, tx, ty };
      }

      const canvas = (this.tileCache && this.tileCache.recycleCanvas()) || createTileCanvas(1024, 1024);
      const tCtx = canvas.getContext('2d', { alpha: false });
      if (!tCtx) return { empty: true, tx, ty };

      tCtx.setTransform(2, 0, 0, 2, -tx * 1024, -ty * 1024);
      tCtx.lineCap = 'round';
      tCtx.lineJoin = 'round';

      // 1. Natural dark earth background
      tCtx.fillStyle = '#0e1310';
      tCtx.fillRect(tileMinX, tileMinY, 512, 512);

      // 2. Terrain & Rivers
      this._drawTerrainForTile(tCtx, map, tileMinX, tileMinY, tileMaxX, tileMaxY);

      // Precompute/cache edge geometry
      for (let i = 0; i < tileEdges.length; i++) {
        this._ensureEdgeCached(tileEdges[i], map);
      }

      const tC0 = performance.now();

      // 3. Medians for divided dual-carriageway highways
      tCtx.strokeStyle = '#14241a';
      for (let i = 0; i < tileEdges.length; i++) {
        const e = tileEdges[i];
        if (e._medianPts) {
          tCtx.lineWidth = e._medianW;
          tCtx.beginPath();
          tCtx.moveTo(e._medianPts[0][0], e._medianPts[0][1]);
          for (let p = 1; p < e._medianPts.length; p++) tCtx.lineTo(e._medianPts[p][0], e._medianPts[p][1]);
          tCtx.stroke();
        }
      }

      // Group visible edges into 5 class tiers (0 to 4)
      const tiers = [[], [], [], [], []];
      for (let i = 0; i < tileEdges.length; i++) {
        tiers[tileEdges[i]._tier || 0].push(tileEdges[i]);
      }

      let highestActiveTier = -1;
      for (let t = 4; t >= 0; t--) {
        if (tiers[t].length > 0) {
          highestActiveTier = t;
          break;
        }
      }

      let totalGuardTime = 0;
      let totalMarkTime = 0;

      for (let t = 0; t <= 4; t++) {
        const tierEdges = tiers[t];
        if (tierEdges.length === 0) continue;

        // a) Casing (Контур): group by width, ONE beginPath/stroke per width!
        const casingBuckets = new Map();
        for (let i = 0; i < tierEdges.length; i++) {
          const e = tierEdges[i];
          const w = e._w + 4;
          let b = casingBuckets.get(w);
          if (!b) { b = []; casingBuckets.set(w, b); }
          b.push(e.points);
        }
        tCtx.strokeStyle = '#3f4d45';
        for (const [w, polys] of casingBuckets.entries()) {
          tCtx.lineWidth = w;
          tCtx.beginPath();
          for (let i = 0; i < polys.length; i++) {
            const pts = polys[i];
            tCtx.moveTo(pts[0][0], pts[0][1]);
            for (let p = 1; p < pts.length; p++) tCtx.lineTo(pts[p][0], pts[p][1]);
          }
          tCtx.stroke();
        }

        // b) Asphalt (Асфальт): group by width, ONE beginPath/stroke per width!
        const asphaltBuckets = new Map();
        for (let i = 0; i < tierEdges.length; i++) {
          const e = tierEdges[i];
          const w = e._w;
          let b = asphaltBuckets.get(w);
          if (!b) { b = []; asphaltBuckets.set(w, b); }
          b.push(e.points);
        }
        tCtx.strokeStyle = '#181e23';
        for (const [w, polys] of asphaltBuckets.entries()) {
          tCtx.lineWidth = w;
          tCtx.beginPath();
          for (let i = 0; i < polys.length; i++) {
            const pts = polys[i];
            tCtx.moveTo(pts[0][0], pts[0][1]);
            for (let p = 1; p < pts.length; p++) tCtx.lineTo(pts[p][0], pts[p][1]);
          }
          tCtx.stroke();
        }

        // Seamless junction circles for this tier in this tile (drawn once at highest active tier)
        if (t === highestActiveTier && tileJunctions.length > 0) {
          tCtx.fillStyle = '#181e23';
          tCtx.beginPath();
          for (let i = 0; i < tileJunctions.length; i++) {
            const j = tileJunctions[i];
            tCtx.moveTo(j.x + j.radius, j.y);
            tCtx.arc(j.x, j.y, j.radius, 0, Math.PI * 2);
          }
          tCtx.fill();
        }

        // Guardrails for this tier
        const tG0 = performance.now();
        // 1. Continuous steel W-beam rail
        tCtx.strokeStyle = '#94a3b8';
        tCtx.lineWidth = 2.5;
        tCtx.setLineDash([]);
        tCtx.beginPath();
        let hasGuard = false;
        for (let i = 0; i < tierEdges.length; i++) {
          const gPts = tierEdges[i]._guardrailPts;
          if (gPts && gPts.length >= 2) {
            tCtx.moveTo(gPts[0][0], gPts[0][1]);
            for (let p = 1; p < gPts.length; p++) tCtx.lineTo(gPts[p][0], gPts[p][1]);
            hasGuard = true;
          }
        }
        if (hasGuard) {
          tCtx.stroke();

          // 2. Barrier posts: single line with setLineDash([2, 14])!
          tCtx.strokeStyle = '#475569';
          tCtx.lineWidth = 5;
          tCtx.setLineDash([2, 14]);
          tCtx.beginPath();
          for (let i = 0; i < tierEdges.length; i++) {
            const gPts = tierEdges[i]._guardrailPts;
            if (gPts && gPts.length >= 2) {
              tCtx.moveTo(gPts[0][0], gPts[0][1]);
              for (let p = 1; p < gPts.length; p++) tCtx.lineTo(gPts[p][0], gPts[p][1]);
            }
          }
          tCtx.stroke();
          tCtx.setLineDash([]);
        }
        totalGuardTime += (performance.now() - tG0);

        // Markings for this tier
        const tM0 = performance.now();
        // 1. Solid markings
        tCtx.strokeStyle = '#f0f2ec';
        tCtx.lineWidth = 3;
        tCtx.setLineDash([]);
        tCtx.beginPath();
        let hasSolid = false;
        for (let i = 0; i < tierEdges.length; i++) {
          const sm = tierEdges[i]._solidMarkings;
          if (sm) {
            for (let m = 0; m < sm.length; m++) {
              const pts = sm[m];
              tCtx.moveTo(pts[0][0], pts[0][1]);
              for (let p = 1; p < pts.length; p++) tCtx.lineTo(pts[p][0], pts[p][1]);
              hasSolid = true;
            }
          }
        }
        if (hasSolid) tCtx.stroke();

        // 2. Dashed markings
        tCtx.strokeStyle = '#d8dcd3';
        tCtx.lineWidth = 2.2;
        tCtx.setLineDash([18, 22]);
        tCtx.beginPath();
        let hasDashed = false;
        for (let i = 0; i < tierEdges.length; i++) {
          const dm = tierEdges[i]._dashedMarkings;
          if (dm) {
            for (let m = 0; m < dm.length; m++) {
              const pts = dm[m];
              tCtx.moveTo(pts[0][0], pts[0][1]);
              for (let p = 1; p < pts.length; p++) tCtx.lineTo(pts[p][0], pts[p][1]);
              hasDashed = true;
            }
          }
        }
        if (hasDashed) tCtx.stroke();
        tCtx.setLineDash([]);
        totalMarkTime += (performance.now() - tM0);
      }

      // Bridges inside this tile
      this._drawBridgesForTile(tCtx, tileMinX, tileMinY, tileMaxX, tileMaxY, map);

      if (metrics) {
        metrics.guardrailsTime = totalGuardTime;
        metrics.markingsTime = totalMarkTime;
        metrics.casingAsphaltTime = Math.max(0, (performance.now() - tC0) - totalGuardTime - totalMarkTime);
      }

      return {
        empty: false,
        canvas,
        tx,
        ty
      };
    }

    _drawSimplifiedTile(ctx, tx, ty, map) {
      const minX = tx * 512;
      const maxX = (tx + 1) * 512;
      const minY = ty * 512;
      const maxY = (ty + 1) * 512;

      const queryEdges = this.spatialGrid ? this.spatialGrid.query(minX - 40, minY - 40, maxX + 40, maxY + 40) : [];
      if (!queryEdges || queryEdges.length === 0) return;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Fast single-pass casing
      ctx.strokeStyle = 'rgba(175, 190, 200, 0.35)';
      ctx.lineWidth = 60;
      ctx.beginPath();
      for (let i = 0; i < queryEdges.length; i++) {
        const pts = queryEdges[i].points;
        if (!pts || pts.length < 2) continue;
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
      }
      ctx.stroke();

      // Fast single-pass asphalt
      ctx.strokeStyle = '#181e23';
      ctx.lineWidth = 55;
      ctx.stroke();
    }

    _drawStaticWorld(ctx, map, view, sim) {
      const tStart = performance.now();
      let guardrailsTime = 0;
      let markingsTime = 0;
      let casingAsphaltTime = 0;

      const minTx = Math.floor(view.minX / 512);
      const maxTx = Math.floor(view.maxX / 512);
      const minTy = Math.floor(view.minY / 512);
      const maxTy = Math.floor(view.maxY / 512);

      const missingTiles = [];
      const camCenterX = (view.minX + view.maxX) * 0.5;
      const camCenterY = (view.minY + view.maxY) * 0.5;

      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';

      for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = minTy; ty <= maxTy; ty++) {
          const tileMinX = tx * 512;
          const tileMaxX = tileMinX + 512;
          const tileMinY = ty * 512;
          const tileMaxY = tileMinY + 512;

          if (tileMaxX <= view.minX || tileMinX >= view.maxX || tileMaxY <= view.minY || tileMinY >= view.maxY) continue;

          const key = `${tx}:${ty}`;
          const tile = this.tileCache.get(key);
          if (tile) {
            if (!tile.empty && tile.canvas) {
              if (typeof ctx.drawImage === 'function') {
                ctx.drawImage(tile.canvas, tileMinX, tileMinY, 512, 512);
              }
            }
          } else {
            // Draw simplified layer (casing + asphalt) while tile builds
            const tSimp0 = performance.now();
            this._drawSimplifiedTile(ctx, tx, ty, map);
            casingAsphaltTime += (performance.now() - tSimp0);

            const tileCenterX = tx * 512 + 256;
            const tileCenterY = ty * 512 + 256;
            const distSq = (tileCenterX - camCenterX) ** 2 + (tileCenterY - camCenterY) ** 2;
            missingTiles.push({ tx, ty, key, distSq });
          }
        }
      }

      ctx.imageSmoothingEnabled = prevSmoothing;

      // Build at most 1 tile per frame (Item 1)
      if (missingTiles.length > 0) {
        missingTiles.sort((a, b) => a.distSq - b.distSq);
        const maxBuild = Math.min(1, missingTiles.length);
        for (let i = 0; i < maxBuild; i++) {
          const item = missingTiles[i];
          const m = { guardrailsTime: 0, markingsTime: 0, casingAsphaltTime: 0 };
          const tile = this._buildTile(item.tx, item.ty, map, m);
          this.tileCache.put(item.key, tile);
          guardrailsTime += m.guardrailsTime;
          markingsTime += m.markingsTime;
          casingAsphaltTime += m.casingAsphaltTime;
        }
      }

      const totalTime = performance.now() - tStart;
      const roadsOnly = Math.max(0, totalTime - guardrailsTime - markingsTime);

      return {
        roadsTime: roadsOnly,
        guardrailsTime,
        markingsTime
      };
    }

    _drawRoads(ctx, map, view, sim) {
      return this._drawStaticWorld(ctx, map, view, sim);
    }

    _drawPerfOverlay(ctx) {
      ctx.save();
      const x = 20;
      const y = 80;
      const w = 270;
      const h = 145;

      ctx.fillStyle = 'rgba(10, 16, 20, 0.90)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('[F3] ПРОИЗВОДИТЕЛЬНОСТЬ РЕНДЕРА', x + 14, y + 24);

      const fpsColor = this.perf.fps >= 50 ? '#4ade80' : (this.perf.fps >= 30 ? '#facc15' : '#ef4444');
      ctx.fillStyle = fpsColor;
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`FPS: ${this.perf.fps.toFixed(1)} (${this.perf.frameTime.toFixed(1)} мс)`, x + 14, y + 48);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px monospace';
      ctx.fillText(`• Дороги:     ${this.perf.sections.roads.toFixed(2)} мс`, x + 14, y + 72);
      ctx.fillText(`• Отбойники:  ${this.perf.sections.guardrails.toFixed(2)} мс`, x + 14, y + 92);
      ctx.fillText(`• Разметка:   ${this.perf.sections.markings.toFixed(2)} мс`, x + 14, y + 112);
      ctx.fillText(`• Сущности:   ${this.perf.sections.entities.toFixed(2)} мс`, x + 14, y + 132);

      ctx.restore();
    }

    // ==============================================================
    // ACTIVE NAVIGATION ROUTE IN WORLD (Wide Green Glow, Animated Arrows, Next Turn Highlight)
    // ==============================================================

    _drawWorldRoute(ctx, sim, view) {
      const route = sim && (sim.currentRoute || sim.activeRoute);
      if (!route || !route.polyline || route.polyline.length < 2) return;

      const tRouteStart = performance.now();
      const t = sim.truck;
      const poly = route.polyline;

      // 1. Find projection of truck onto polyline to prune passed/driven part
      let bestDistSq = Infinity;
      let bestSeg = 0;
      let bestX = poly[0][0];
      let bestY = poly[0][1];

      let startIdx = 0;
      let endIdx = poly.length - 1;
      if (typeof sim._routeBestSeg === 'number' && sim._routeBestSeg >= 0 && sim._routeBestSeg < poly.length - 1) {
        startIdx = Math.max(0, sim._routeBestSeg - 2);
        endIdx = Math.min(poly.length - 1, sim._routeBestSeg + 15);
      }

      for (let i = startIdx; i < endIdx; i++) {
        const x1 = poly[i][0], y1 = poly[i][1];
        const x2 = poly[i + 1][0], y2 = poly[i + 1][1];
        const dx = x2 - x1, dy = y2 - y1;
        const l2 = dx * dx + dy * dy;
        if (l2 === 0) continue;
        let s = ((t.x - x1) * dx + (t.y - y1) * dy) / l2;
        s = Math.max(0, Math.min(1, s));
        const qx = x1 + s * dx;
        const qy = y1 + s * dy;
        const d2 = (t.x - qx) * (t.x - qx) + (t.y - qy) * (t.y - qy);
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestSeg = i;
          bestX = qx;
          bestY = qy;
        }
      }

      // Fallback to full search if off-route or after teleport
      if (bestDistSq > 90000 && startIdx > 0) {
        bestDistSq = Infinity;
        for (let i = 0; i < poly.length - 1; i++) {
          const x1 = poly[i][0], y1 = poly[i][1];
          const x2 = poly[i + 1][0], y2 = poly[i + 1][1];
          const dx = x2 - x1, dy = y2 - y1;
          const l2 = dx * dx + dy * dy;
          if (l2 === 0) continue;
          let s = ((t.x - x1) * dx + (t.y - y1) * dy) / l2;
          s = Math.max(0, Math.min(1, s));
          const qx = x1 + s * dx;
          const qy = y1 + s * dy;
          const d2 = (t.x - qx) * (t.x - qx) + (t.y - qy) * (t.y - qy);
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestSeg = i;
            bestX = qx;
            bestY = qy;
          }
        }
      }
      sim._routeBestSeg = bestSeg;

      // Zero-allocation access to remaining polyline
      const remCount = Math.min(35, poly.length - bestSeg);
      if (remCount < 2) return;

      const getRemPtX = (idx) => idx === 0 ? bestX : poly[bestSeg + idx][0];
      const getRemPtY = (idx) => idx === 0 ? bestY : poly[bestSeg + idx][1];

      const tProj = performance.now();

      ctx.lineCap = 'butt';
      ctx.lineJoin = 'bevel';

      const vMinX = view.minX - 80;
      const vMaxX = view.maxX + 80;
      const vMinY = view.minY - 80;
      const vMaxY = view.maxY + 80;

      // Layer 1 & 2: Wide semi-transparent green line + narrow bright green line (clipped to view & micro-segments simplified)
      ctx.beginPath();
      let hasLine = false;
      let drawingLine = false;
      let lastX = 0, lastY = 0;
      let linePoints = 0;
      const maxLineScan = remCount - 1;
      for (let i = 0; i < maxLineScan; i++) {
        const p1x = getRemPtX(i), p1y = getRemPtY(i);
        const p2x = getRemPtX(i + 1), p2y = getRemPtY(i + 1);
        const segMinX = Math.min(p1x, p2x);
        const segMaxX = Math.max(p1x, p2x);
        const segMinY = Math.min(p1y, p2y);
        const segMaxY = Math.max(p1y, p2y);
        if (segMaxX < vMinX || segMinX > vMaxX || segMaxY < vMinY || segMinY > vMaxY) {
          drawingLine = false;
          continue;
        }
        if (!drawingLine) {
          ctx.moveTo(p1x, p1y);
          lastX = p1x;
          lastY = p1y;
          drawingLine = true;
          hasLine = true;
          linePoints++;
        }
        const dx = p2x - lastX;
        const dy = p2y - lastY;
        if (i < maxLineScan - 1 && (dx * dx + dy * dy) < 1600) {
          continue;
        }
        ctx.lineTo(p2x, p2y);
        lastX = p2x;
        lastY = p2y;
        linePoints++;
      }
      if (hasLine) {
        ctx.strokeStyle = '#1d693e';
        ctx.lineWidth = 14;
        ctx.stroke();

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      const tLines = performance.now();

      // Layer 3: Animated running chevrons / arrows (batched single path, no per-chevron save/restore)
      const spacing = 70;
      const phase = (this.pulseTimer * 65) % spacing;

      let accumulated = 0;
      let nextChevronDist = phase;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let hasChevrons = false;

      const maxChevronScan = remCount - 1;
      for (let i = 0; i < maxChevronScan; i++) {
        if (accumulated > 2500) break;
        const p1x = getRemPtX(i), p1y = getRemPtY(i);
        const p2x = getRemPtX(i + 1), p2y = getRemPtY(i + 1);
        const dx = p2x - p1x;
        const dy = p2y - p1y;
        const segLen = Math.hypot(dx, dy);
        if (segLen === 0) continue;

        const segMinX = Math.min(p1x, p2x);
        const segMaxX = Math.max(p1x, p2x);
        const segMinY = Math.min(p1y, p2y);
        const segMaxY = Math.max(p1y, p2y);
        const segInView = !(segMaxX < vMinX || segMinX > vMaxX || segMaxY < vMinY || segMinY > vMaxY);

        if (segInView) {
          const invLen = 1 / segLen;
          const ux = dx * invLen;
          const uy = dy * invLen;
          const nx = -uy;
          const ny = ux;

          while (accumulated + segLen >= nextChevronDist) {
            const tFrac = (nextChevronDist - accumulated) * invLen;
            const cx = p1x + dx * tFrac;
            const cy = p1y + dy * tFrac;

            if (cx >= vMinX && cx <= vMaxX && cy >= vMinY && cy <= vMaxY) {
              const w1x = cx - 5 * ux - 6 * nx;
              const w1y = cy - 5 * uy - 6 * ny;
              const tipX = cx + 4 * ux;
              const tipY = cy + 4 * uy;
              const w2x = cx - 5 * ux + 6 * nx;
              const w2y = cy - 5 * uy + 6 * ny;

              ctx.moveTo(w1x, w1y);
              ctx.lineTo(tipX, tipY);
              ctx.lineTo(w2x, w2y);
              hasChevrons = true;
            }
            nextChevronDist += spacing;
          }
        } else {
          while (accumulated + segLen >= nextChevronDist) {
            nextChevronDist += spacing;
          }
        }
        accumulated += segLen;
      }
      if (hasChevrons) ctx.stroke();

      const tChevrons = performance.now();

      // Layer 4: Next turn highlight & distance badge (fast lookahead up to 25 segments)
      let turnPt = null;
      let turnDist = 0;
      let turnAngleDiff = 0;

      let distSoFar = 0;
      const maxTurnScan = Math.min(remCount - 2, 25);
      for (let i = 0; i < maxTurnScan; i++) {
        const p1x = getRemPtX(i), p1y = getRemPtY(i);
        const p2x = getRemPtX(i + 1), p2y = getRemPtY(i + 1);
        const p3x = getRemPtX(i + 2), p3y = getRemPtY(i + 2);
        const seg1Len = Math.hypot(p2x - p1x, p2y - p1y);
        distSoFar += seg1Len;

        const a1 = Math.atan2(p2y - p1y, p2x - p1x);
        const a2 = Math.atan2(p3y - p2y, p3x - p2x);
        let diff = a2 - a1;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (Math.abs(diff) > 0.4) {
          turnPt = [p2x, p2y];
          turnDist = distSoFar;
          turnAngleDiff = diff;
          break;
        }
      }

      if (!turnPt && remCount >= 2) {
        turnPt = [getRemPtX(remCount - 1), getRemPtY(remCount - 1)];
        turnDist = distSoFar;
      }

      if (turnPt) {
        // Pulsing glow halo on the asphalt
        const pulse = Math.sin(this.pulseTimer * 6) * 4;
        ctx.fillStyle = 'rgba(212, 255, 66, 0.3)';
        ctx.beginPath();
        ctx.arc(turnPt[0], turnPt[1], 28 + pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#d4ff42';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Floating turn distance badge above turn point
        const MAP_SCALE = (sim && sim.map && sim.map.MAP_SCALE) || 1.25;
        const turnMeters = turnDist / MAP_SCALE;
        const distText = turnMeters < 1000
          ? `${Math.round(turnMeters)} м`
          : `${(turnMeters / 1000).toFixed(1)} км`;
        const icon = turnAngleDiff > 0.3 ? '↱' : (turnAngleDiff < -0.3 ? '↰' : '⬆');
        const badgeLabel = `${icon} ${distText}`;

        ctx.save();
        ctx.translate(turnPt[0], turnPt[1] - 32);

        // Badge pill box
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.beginPath();
        ctx.roundRect(-42, -14, 84, 28, 14);
        ctx.fill();

        ctx.strokeStyle = '#d4ff42';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Badge pointer triangle
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.beginPath();
        ctx.moveTo(-6, 14);
        ctx.lineTo(6, 14);
        ctx.lineTo(0, 20);
        ctx.closePath();
        ctx.fill();

        // Badge text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeLabel, 0, 0);

        ctx.restore();
      }

      this._lastRouteTimings = {
        proj: tProj - tRouteStart,
        preLoop: tBeforeLoop - tProj,
        lines: tLines - tBeforeLoop,
        chevrons: tChevrons - tLines,
        turnBadge: performance.now() - tChevrons,
        total: performance.now() - tRouteStart
      };
    }

    // ==============================================================
    // BRIDGES ACROSS RIVERS
    // ==============================================================

    _drawBridges(ctx, map, view) {
      const bridges = (map && (map.bridges || (map.GEOGRAPHY && map.GEOGRAPHY.bridges))) ||
                      (root && root.ETSMap && (root.ETSMap.bridges || (root.ETSMap.GEOGRAPHY && root.ETSMap.GEOGRAPHY.bridges))) || [];

      for (const br of bridges) {
        const len = br.length || br.len || 200;
        const width = br.width || 140;
        if (br.x + len < view.minX || br.x - len > view.maxX || br.y + len < view.minY || br.y - len > view.maxY) continue;

        ctx.save();
        ctx.translate(br.x, br.y);
        ctx.rotate(br.angle || 0);

        // Concrete abutments
        ctx.fillStyle = '#374151';
        ctx.fillRect(-len * 0.5 - 15, -width * 0.5 - 6, len + 30, 6);
        ctx.fillRect(-len * 0.5 - 15, width * 0.5, len + 30, 6);

        // Metallic Guardrails (Silver)
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-len * 0.5, -width * 0.5 - 4, len, 3);
        ctx.fillRect(-len * 0.5, width * 0.5 + 1, len, 3);

        // Vertical bridge barrier posts
        for (let bx = -len * 0.5; bx <= len * 0.5; bx += 25) {
          ctx.fillRect(bx - 1.5, -width * 0.5 - 6, 3, 5);
          ctx.fillRect(bx - 1.5, width * 0.5 + 1, 3, 5);
        }

        ctx.restore();
      }
    }

    // ==============================================================
    // CITY ARCHITECTURE, BUILDINGS & LOGISTICS DEPOTS
    // ==============================================================

    _drawCityBuildings(ctx, map, view, sim) {
      // 1. City Blocks & Warehouses (Batched state changes)
      const blocks = map.CITY_BLOCKS || [];
      const visibleBlocks = [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.x + b.w >= view.minX && b.x <= view.maxX && b.y + b.h >= view.minY && b.y <= view.maxY) {
          visibleBlocks.push(b);
        }
      }

      if (visibleBlocks.length > 0) {
        // Shadows
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        for (let i = 0; i < visibleBlocks.length; i++) {
          const b = visibleBlocks[i];
          ctx.fillRect(b.x + 8, b.y + 8, b.w, b.h);
        }

        // Roof bases & HVAC
        for (let i = 0; i < visibleBlocks.length; i++) {
          const b = visibleBlocks[i];
          ctx.fillStyle = b.color || '#1a232a';
          ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.fillStyle = '#374151';
          ctx.fillRect(b.x + 15, b.y + 15, 25, 20);
          ctx.fillRect(b.x + b.w - 40, b.y + 15, 25, 20);
        }

        // Batched Parapet edges
        ctx.strokeStyle = '#2d3b46';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < visibleBlocks.length; i++) {
          const b = visibleBlocks[i];
          ctx.rect(b.x, b.y, b.w, b.h);
        }
        ctx.stroke();

        // Warehouse labels only when zoomed in
        if (this.zoom >= 0.8) {
          ctx.fillStyle = '#64748b';
          ctx.font = 'bold 9px Roboto, monospace';
          for (let i = 0; i < visibleBlocks.length; i++) {
            const b = visibleBlocks[i];
            ctx.fillText(b.label || 'WAREHOUSE', b.x + 12, b.y + b.h - 12);
          }
        }
      }

      // 2. Logistics Loading / Unloading Ramp Zones
      const depots = map.DEPOTS || [];
      const pulse = Math.sin(this.pulseTimer * 4) * 0.2 + 0.8;

      for (const d of depots) {
        if (d.rampX + 150 < view.minX || d.rampX - 150 > view.maxX || d.rampY + 150 < view.minY || d.rampY - 150 > view.maxY) continue;

        // Pulsing delivery bay zone
        ctx.save();
        ctx.translate(d.rampX, d.rampY);

        // Outer glow
        ctx.strokeStyle = `rgba(212, 255, 66, ${0.4 * pulse})`;
        ctx.lineWidth = 14;
        ctx.strokeRect(-40, -80, 80, 160);

        // Green/Lime Dashed Parking Box
        ctx.strokeStyle = '#d4ff42';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 10]);
        ctx.strokeRect(-40, -80, 80, 160);
        ctx.setLineDash([]);

        // Loading dock bay stripes
        ctx.fillStyle = 'rgba(212, 255, 66, 0.12)';
        ctx.fillRect(-38, -78, 76, 156);

        // Ramp text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('РАМПА [ПРОБЕЛ]', 0, -4);
        ctx.fillText(d.name, 0, 14);

        ctx.restore();
      }

      // 3. Gas Stations (Deduplicated & offset from road centerline by roadWidth/2 + 40 px)
      const pois = (this.poiGrid && this.spatialGridReady)
        ? this.poiGrid.query(view.minX - 120, view.minY - 120, view.maxX + 120, view.maxY + 120)
        : ((map && map.GEOGRAPHY && map.GEOGRAPHY.pois) || []);
      for (let i = 0; i < pois.length; i++) {
        const poi = pois[i];
        if (poi.type !== 'gas') continue;
        if (poi.x + 120 < view.minX || poi.x - 120 > view.maxX || poi.y + 120 < view.minY || poi.y - 120 > view.maxY) continue;

        ctx.save();
        ctx.translate(poi.x, poi.y);

        if (this.zoom < 0.25) {
          // Far zoom: small badge icon
          ctx.fillStyle = '#dc2626';
          ctx.beginPath();
          ctx.arc(0, 0, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⛽', 0, 0);
        } else {
          // Close zoom: ~60x36 px canopy aligned with road
          if (poi.angle !== undefined) ctx.rotate(poi.angle);

          // Canopy roof
          ctx.fillStyle = '#b91c1c';
          ctx.fillRect(-30, -18, 60, 36);

          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(-30, -18, 60, 36);

          // Fuel pump concrete islands
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(-20, -6, 8, 12);
          ctx.fillRect(12, -6, 8, 12);

          // Canopy Brand Sign (no "АЗС" text if no brand/name)
          const brandText = poi.brand || poi.name || '';
          if (brandText && brandText !== 'АЗС') {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 8px Roboto, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(brandText, 0, 0);
          }
        }

        ctx.restore();
      }
    }

    // ==============================================================
    // HIGHWAY ROADSIDE DIRECTION SIGNS & SPEED LIMITS
    // ==============================================================

    _drawRoadSigns(ctx, signs, view) {
      const list = (this.signGrid && this.spatialGridReady)
        ? this.signGrid.query(view.minX - 100, view.minY - 100, view.maxX + 100, view.maxY + 100)
        : (signs || []);
      if (!list || list.length === 0) return;

      // Batched mounting posts
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let hasPosts = false;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.x + 100 < view.minX || s.x - 100 > view.maxX || s.y + 100 < view.minY || s.y - 100 > view.maxY) continue;
        if (s.roadX !== undefined && s.roadY !== undefined) {
          ctx.moveTo(s.roadX, s.roadY);
          ctx.lineTo(s.x, s.y);
          hasPosts = true;
        }
      }
      if (hasPosts) ctx.stroke();

      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.x + 100 < view.minX || s.x - 100 > view.maxX || s.y + 100 < view.minY || s.y - 100 > view.maxY) continue;

        ctx.save();
        ctx.translate(s.x, s.y);

        // Keep sign text upright and readable: flip by 180 deg if pointing westward
        let drawAngle = s.angle;
        if (Math.cos(drawAngle) < -0.05) {
          drawAngle = drawAngle > 0 ? drawAngle - Math.PI : drawAngle + Math.PI;
        }
        ctx.rotate(drawAngle);

        // Sign Pole base
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Signboard: green for motorway/trunk, blue for primary/secondary
        const isHighway = s.roadClass === 'motorway' || s.roadClass === 'trunk';
        ctx.fillStyle = isHighway ? '#15803d' : '#1d4ed8';
        ctx.beginPath();
        ctx.roundRect(-42, -14, 84, 28, 4);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Main destination / road ref text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.main, 0, -3);

        // Subtext / turn directions
        if (s.sub) {
          ctx.fillStyle = '#fef08a';
          ctx.font = '7.5px Roboto, sans-serif';
          ctx.fillText(s.sub, 0, 7);
        }

        // Speed limit circle attached on the right
        if (s.speed) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(48, 0, 9, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 8px Roboto, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(s.speed), 48, 0);
        }

        ctx.restore();
      }
    }

    // ==============================================================
    // VEHICLE: SHADOWS, REVERSE GUIDES, TRAILER & TRUCK
    // ==============================================================

    _drawShadow(ctx, x, y, angle, length, width) {
      ctx.save();
      ctx.translate(x + 3, y + 4);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(-length * 0.5, -width * 0.5, length, width);
      ctx.restore();
    }

    _drawReverseGuide(ctx, t, r) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);
      ctx.strokeStyle = 'rgba(212, 255, 66, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(-68, -12); ctx.lineTo(-240, -22);
      ctx.moveTo(-68, 12); ctx.lineTo(-240, 22);
      ctx.stroke();
      ctx.restore();
    }

    _drawTruck(ctx, t, sim) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);

      const l = 68;
      const w = 25;

      // Steerable Front Wheels
      ctx.save();
      ctx.translate(l * 0.34, -w * 0.52);
      ctx.rotate(t.steerAngle);
      ctx.fillStyle = '#0a0d0f';
      ctx.fillRect(-7, -4, 14, 8);
      ctx.restore();

      ctx.save();
      ctx.translate(l * 0.34, w * 0.52);
      ctx.rotate(t.steerAngle);
      ctx.fillStyle = '#0a0d0f';
      ctx.fillRect(-7, -4, 14, 8);
      ctx.restore();

      // Rear Dual Wheels
      ctx.fillStyle = '#0a0d0f';
      ctx.fillRect(-l * 0.32, -w * 0.53, 14, 9);
      ctx.fillRect(-l * 0.32, w * 0.53 - 5, 14, 9);

      // Chassis Frame (Dark Grey)
      ctx.fillStyle = '#1c2227';
      ctx.fillRect(-l * 0.48, -w * 0.42, l * 0.96, w * 0.84);

      // Fifth Wheel Hitch Plate (Metallic)
      ctx.fillStyle = '#3a444c';
      ctx.beginPath();
      ctx.arc(-l * 0.28, 0, 7, 0, Math.PI * 2);
      ctx.fill();

      // Fuel Tank (Left & Right aluminum)
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(-l * 0.12, -w * 0.48, 22, 6);
      ctx.fillRect(-l * 0.12, w * 0.48 - 6, 22, 6);

      // Cab Body (Custom truck color)
      ctx.fillStyle = t.color || '#d4ff42';
      ctx.beginPath();
      ctx.roundRect(-l * 0.05, -w * 0.46, l * 0.52, w * 0.92, [4, 6, 6, 4]);
      ctx.fill();

      // Aerodynamic Wind Deflector Roof
      ctx.fillStyle = t.cabColor || '#12171a';
      ctx.beginPath();
      ctx.roundRect(-l * 0.02, -w * 0.40, l * 0.32, w * 0.80, 3);
      ctx.fill();

      // Windshield & Side Windows
      ctx.fillStyle = '#4a5568';
      ctx.beginPath();
      ctx.roundRect(l * 0.22, -w * 0.38, 8, w * 0.76, 2);
      ctx.fill();

      // Side Mirrors
      ctx.fillStyle = '#1a202c';
      ctx.fillRect(l * 0.26, -w * 0.58, 4, 7);
      ctx.fillRect(l * 0.26, w * 0.58 - 7, 4, 7);

      // Front Headlights
      ctx.fillStyle = t.lights > 0 ? '#ffffff' : '#e2e8f0';
      ctx.fillRect(l * 0.45, -w * 0.42, 3, 6);
      ctx.fillRect(l * 0.45, w * 0.42 - 6, 3, 6);

      // Turn Signals Front
      if (this.turnBlinkOn) {
        if (t.turnSignal === -1 || t.turnSignal === 2) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(l * 0.45, -w * 0.46, 3, 4);
        }
        if (t.turnSignal === 1 || t.turnSignal === 2) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(l * 0.45, w * 0.46 - 4, 3, 4);
        }
      }

      // Brake Taillights (Red)
      const isBraking = sim && sim.wasBraking;
      ctx.fillStyle = isBraking ? '#ff2a2a' : '#881111';
      ctx.fillRect(-l * 0.48, -w * 0.38, 3, 6);
      ctx.fillRect(-l * 0.48, w * 0.38 - 6, 3, 6);

      ctx.restore();
    }

    _drawTrailer(ctx, r, t, sim) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);

      const l = 136;
      const w = 25;

      // Triple Axle Wheels (Rear)
      ctx.fillStyle = '#0a0d0f';
      const wheelOffsets = [-l * 0.38, -l * 0.26, -l * 0.14];
      wheelOffsets.forEach(ox => {
        ctx.fillRect(ox - 6, -w * 0.54, 12, 7);
        ctx.fillRect(ox - 6, w * 0.54 - 7, 12, 7);
      });

      // Trailer Body Box (European Semi-Trailer)
      ctx.fillStyle = '#1a202c';
      ctx.beginPath();
      ctx.roundRect(-l * 0.48, -w * 0.48, l * 0.96, w * 0.96, 3);
      ctx.fill();

      // Side Tarpaulin / Curtainsider Livery (Neon Lime stripe)
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(-l * 0.44, -w * 0.42, l * 0.88, w * 0.84);

      ctx.fillStyle = '#d4ff42';
      ctx.fillRect(-l * 0.44, -2, l * 0.88, 4);

      // Kingpin Hitch Mount Point
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(l * 0.40, 0, 4, 0, Math.PI * 2);
      ctx.fill();

      // Rear Bumper & Under-ride Protection
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-l * 0.49, -w * 0.44, 2, w * 0.88);

      // Rear Taillights & License Plate
      const isBraking = sim && sim.wasBraking;
      ctx.fillStyle = isBraking ? '#ff1a1a' : '#881111';
      ctx.fillRect(-l * 0.49, -w * 0.40, 2, 7);
      ctx.fillRect(-l * 0.49, w * 0.40 - 7, 2, 7);

      // Turn Signals Rear
      if (this.turnBlinkOn && t) {
        if (t.turnSignal === -1 || t.turnSignal === 2) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(-l * 0.49, -w * 0.44, 2, 4);
        }
        if (t.turnSignal === 1 || t.turnSignal === 2) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(-l * 0.49, w * 0.44 - 4, 2, 4);
        }
      }

      ctx.restore();
    }

    _drawHeadlightBeams(ctx, t) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);

      const range = t.lights === 2 ? 340 : 220;
      const spread = t.lights === 2 ? 0.45 : 0.35;

      const grad = ctx.createRadialGradient(34, 0, 10, 34 + range * 0.7, 0, range);
      grad.addColorStop(0, 'rgba(255, 255, 230, 0.45)');
      grad.addColorStop(0.3, 'rgba(255, 255, 210, 0.25)');
      grad.addColorStop(0.8, 'rgba(255, 255, 180, 0.08)');
      grad.addColorStop(1, 'rgba(255, 255, 150, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(34, -10);
      ctx.arc(34, 0, range, -spread, spread);
      ctx.lineTo(34, 10);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Live Truck Showcase on Home Hero Canvas
    renderPreview(targetCanvasOrTruck, truckOrTime, maybeTrailer, maybeTime) {
      let targetCanvas = null;
      let truck = null;
      let trailer = null;
      let time = 0;

      if (targetCanvasOrTruck && (typeof targetCanvasOrTruck.getContext === 'function' || targetCanvasOrTruck.tagName === 'CANVAS')) {
        targetCanvas = targetCanvasOrTruck;
        truck = truckOrTime;
        trailer = maybeTrailer;
        time = typeof maybeTime === 'number' && !isNaN(maybeTime) ? maybeTime : 0;
      } else {
        targetCanvas = this.canvas;
        truck = targetCanvasOrTruck;
        time = typeof truckOrTime === 'number' && !isNaN(truckOrTime) ? truckOrTime : 0;
      }

      if (!targetCanvas) return;
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;

      const rect = targetCanvas.getBoundingClientRect ? targetCanvas.getBoundingClientRect() : null;
      const dpr = Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 2);
      const displayW = Math.max(300, Math.floor(rect && rect.width > 50 ? rect.width : (targetCanvas.width || 560)));
      const displayH = Math.max(200, Math.floor(rect && rect.height > 50 ? rect.height : (targetCanvas.height || 420)));

      if (targetCanvas.width !== Math.floor(displayW * dpr) || targetCanvas.height !== Math.floor(displayH * dpr)) {
        targetCanvas.width = Math.floor(displayW * dpr);
        targetCanvas.height = Math.floor(displayH * dpr);
      }

      const w = displayW;
      const h = displayH;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Clean dark canvas
      ctx.fillStyle = '#0c1013';
      ctx.fillRect(0, 0, w, h);

      // Asphalt Showcase Road strip
      const roadW = Math.min(w * 0.75, 420);
      const roadX = (w - roadW) * 0.5;

      ctx.fillStyle = '#141a1f';
      ctx.fillRect(roadX, 0, roadW, h);

      // Shoulder lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(roadX + 15, 0); ctx.lineTo(roadX + 15, h);
      ctx.moveTo(roadX + roadW - 15, 0); ctx.lineTo(roadX + roadW - 15, h);
      ctx.stroke();

      // Moving Dashed Center Line
      ctx.strokeStyle = 'rgba(212, 255, 66, 0.45)';
      ctx.lineWidth = 3;
      ctx.setLineDash([25, 20]);
      ctx.lineDashOffset = -(time * 140) % 45;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw truck and trailer centered vertically moving North (-Math.PI / 2)
      const centerX = w * 0.5 + Math.sin(time * 1.5) * 6;
      const centerY = h * 0.55 + Math.sin(time * 25) * 0.4;
      const angle = -Math.PI * 0.5;

      const dummyTruck = {
        x: centerX,
        y: centerY,
        angle: angle,
        steerAngle: Math.sin(time * 1.5) * 0.04,
        speed: 80,
        lights: 2,
        turnSignal: 0,
        color: truck ? (truck.color || '#1e3799') : '#1e3799',
        cabColor: truck ? (truck.cabColor || '#0c2461') : '#0c2461'
      };

      this._drawHeadlightBeams(ctx, dummyTruck);

      // Shadows
      const trailerY = centerY + 85;
      this._drawShadow(ctx, centerX, trailerY, angle, 136, 25);
      this._drawShadow(ctx, centerX, centerY, angle, 68, 25);

      // Semi-trailer
      const dummyTrailer = {
        x: centerX,
        y: trailerY,
        angle: angle,
        attached: true,
        jackknifed: false,
        articulationAngle: 0
      };
      this._drawTrailer(ctx, dummyTrailer, dummyTruck, { wasBraking: false });
      this._drawTruck(ctx, dummyTruck, { wasBraking: false });

      // Exhaust heat particles
      ctx.fillStyle = 'rgba(200, 210, 220, 0.15)';
      for (let i = 0; i < 4; i++) {
        const pAge = ((time * 3 + i * 0.25) % 1);
        const px = centerX - 12 - pAge * 8;
        const py = centerY + 18 + pAge * 35;
        const pr = 3 + pAge * 9;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // ==============================================================
    // HUD MINI-MAP (Top Right Corner, Circular 220 px, 3000 px Range, Heading & Route)
    // ==============================================================

    _drawMiniMap(ctx, sim) {
      if (!sim) return;
      const t = sim.truck;
      const r = sim.trailer;
      const map = sim.map;
      if (!t) return;

      const R = 110; // 220 px circular diameter
      const cx = this.width - 130;
      const cy = 145;
      const worldRadius = 1500; // ~3000 px surroundings diameter
      const s = R / worldRadius;

      // Ensure cached mini-map canvas exists
      if (!this._miniMapCanvas) {
        this._miniMapCanvas = createTileCanvas(R * 2, R * 2);
        this._lastMiniMapX = -999999;
        this._lastMiniMapY = -999999;
      }

      const mmDistSq = (t.x - this._lastMiniMapX) ** 2 + (t.y - this._lastMiniMapY) ** 2;
      if (mmDistSq > 225) { // redraw background when truck moved > 15 units (~1 px on minimap)
        this._lastMiniMapX = t.x;
        this._lastMiniMapY = t.y;
        const mCtx = this._miniMapCanvas.getContext('2d');
        if (mCtx) {
          mCtx.save();
          mCtx.clearRect(0, 0, R * 2, R * 2);

          // 1. Circular clipping mask
          mCtx.beginPath();
          mCtx.arc(R, R, R, 0, Math.PI * 2);
          mCtx.clip();

          // 2. Tactical dark radar background
          mCtx.fillStyle = '#080d0a';
          mCtx.fillRect(0, 0, R * 2, R * 2);

          // Distance rings at 500m (36.6 px) and 1000m (73.3 px)
          mCtx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
          mCtx.lineWidth = 1;
          mCtx.beginPath();
          mCtx.arc(R, R, 500 * 0.1 * 10 * s, 0, Math.PI * 2);
          mCtx.arc(R, R, 1000 * 0.1 * 10 * s, 0, Math.PI * 2);
          mCtx.stroke();

          // Radial crosshair guides (subtle)
          mCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
          mCtx.beginPath();
          mCtx.moveTo(0, R); mCtx.lineTo(R * 2, R);
          mCtx.moveTo(R, 0); mCtx.lineTo(R, R * 2);
          mCtx.stroke();

          // 3. Draw road network in 3000 px surroundings (Spatial Grid & Batched Strokes)
          const nearbyEdges = (this.spatialGrid && this.spatialGridReady)
            ? this.spatialGrid.query(t.x - worldRadius, t.y - worldRadius, t.x + worldRadius, t.y + worldRadius)
            : [];
          if (nearbyEdges && nearbyEdges.length > 0) {
            mCtx.lineCap = 'round';
            mCtx.lineJoin = 'round';

            // Minor roads (tertiary / secondary)
            mCtx.strokeStyle = '#1e293b';
            mCtx.lineWidth = 3;
            mCtx.beginPath();
            let hasMinor = false;
            for (let i = 0; i < nearbyEdges.length; i++) {
              const e = nearbyEdges[i];
              if (e.roadClass === 'service' || e.roadClass === 'track' || e.roadClass === 'footway' || e.roadClass === 'path' || e.roadClass === 'residential' || e.roadClass === 'living_street') continue;
              const isMajor = e.roadClass === 'motorway' || e.roadClass === 'trunk' || e.roadClass === 'primary';
              if (isMajor) continue;
              const pts = e.points;
              if (!pts || pts.length < 2) continue;
              let lx = R + (pts[0][0] - t.x) * s;
              let ly = R + (pts[0][1] - t.y) * s;
              mCtx.moveTo(lx, ly);
              for (let p = 1; p < pts.length; p++) {
                const mx = R + (pts[p][0] - t.x) * s;
                const my = R + (pts[p][1] - t.y) * s;
                if (p < pts.length - 1 && Math.abs(mx - lx) < 2 && Math.abs(my - ly) < 2) continue;
                mCtx.lineTo(mx, my);
                lx = mx;
                ly = my;
              }
              hasMinor = true;
            }
            if (hasMinor) mCtx.stroke();

            // Major roads
            mCtx.strokeStyle = '#334155';
            mCtx.lineWidth = 5;
            mCtx.beginPath();
            let hasMajor = false;
            for (let i = 0; i < nearbyEdges.length; i++) {
              const e = nearbyEdges[i];
              const isMajor = e.roadClass === 'motorway' || e.roadClass === 'trunk' || e.roadClass === 'primary';
              if (!isMajor) continue;
              const pts = e.points;
              if (!pts || pts.length < 2) continue;
              let lx = R + (pts[0][0] - t.x) * s;
              let ly = R + (pts[0][1] - t.y) * s;
              mCtx.moveTo(lx, ly);
              for (let p = 1; p < pts.length; p++) {
                const mx = R + (pts[p][0] - t.x) * s;
                const my = R + (pts[p][1] - t.y) * s;
                if (p < pts.length - 1 && Math.abs(mx - lx) < 2 && Math.abs(my - ly) < 2) continue;
                mCtx.lineTo(mx, my);
                lx = mx;
                ly = my;
              }
              hasMajor = true;
            }
            if (hasMajor) mCtx.stroke();
          }
          mCtx.restore();
        }
      }

      ctx.save();
      // Draw cached mini-map background
      ctx.drawImage(this._miniMapCanvas, cx - R, cy - R);

      // Clip to circular mini-map for dynamic elements
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      // 4. Draw active route on mini-map
      const route = sim.currentRoute || sim.activeRoute;
      if (route && route.polyline && route.polyline.length >= 2) {
        const poly = route.polyline;
        const maxDist = worldRadius * 1.3;
        ctx.strokeStyle = '#16532e';
        ctx.lineWidth = 6;
        ctx.beginPath();
        let drawing = false;
        let drawnPoints = 0;
        for (let p = 0; p < poly.length; p++) {
          const dx = poly[p][0] - t.x;
          const dy = poly[p][1] - t.y;
          if (Math.abs(dx) > maxDist || Math.abs(dy) > maxDist) {
            drawing = false;
            continue;
          }
          const mx = cx + dx * s;
          const my = cy + dy * s;
          if (!drawing) {
            ctx.moveTo(mx, my);
            drawing = true;
          } else {
            ctx.lineTo(mx, my);
          }
          drawnPoints++;
        }
        if (drawnPoints > 1) {
          ctx.stroke();

          // Inner bright green route line
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }

      // 5. Semi-trailer on mini-map (if attached)
      if (r && r.attached) {
        ctx.save();
        const trMx = cx + (r.x - t.x) * s;
        const trMy = cy + (r.y - t.y) * s;
        ctx.translate(trMx, trMy);
        ctx.rotate(r.angle);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(-10, -3, 20, 6);
        ctx.restore();
      }

      // 6. Truck position & heading on mini-map (centered at cx, cy)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t.angle);

      // Vision cone / heading line
      ctx.fillStyle = 'rgba(212, 255, 66, 0.15)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 36, -0.4, 0.4);
      ctx.closePath();
      ctx.fill();

      // Truck marker: crisp directional triangle/chevron
      ctx.fillStyle = '#f97316'; // Vivid orange truck body
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, -6);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();

      // End clipping
      ctx.restore();

      // 7. Bezel & Glass Ring around mini-map
      ctx.save();
      // Outer cyan accent border
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Subtle outer dark shadow
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // North compass indicator badge 'С' at top
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy - R + 12, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ef4444'; // Red 'С' for North
      ctx.font = 'bold 9px Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('С', cx, cy - R + 12);

      // Mini-map label below: "GPS 3 KM"
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 8px Roboto, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('GPS 3 KM', cx, cy + R + 4);

      ctx.restore();
    }
  }

  root.ETSRenderer = TruckRenderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = TruckRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
