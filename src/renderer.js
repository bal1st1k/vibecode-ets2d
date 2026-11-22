/*! 2D ETS2 Moldova Edition | High-Performance Realistic World Renderer | ETS2 Visuals */
(function (root) {
  'use strict';

  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h) {
      if (typeof this.rect === 'function') this.rect(x, y, w, h);
    };
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.floor(rect.width || 800);
      this.height = Math.floor(rect.height || 600);
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
    }

    render(sim, dt = 0.016) {
      if (!this.ctx || !sim) return;
      const ctx = this.ctx;
      const t = sim.truck;
      const r = sim.trailer;
      const map = sim.map;

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
      const baseZoom = 1.15;
      this.targetZoom = baseZoom * (1 - 0.30 * speedRatio);
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
      const halfW = (this.width / (2 * this.zoom)) + 180;
      const halfH = (this.height / (2 * this.zoom)) + 180;
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
      ctx.translate(this.width * 0.5, this.height * 0.5);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.camX, -this.camY);

      // 2. Draw Terrain (meadows, agricultural parcels, forests, rivers)
      this._drawTerrain(ctx, map, view);

      // 3. Draw Roads (asphalt, edge markings, seamless junctions, center dashed lines)
      this._drawRoads(ctx, map, view);

      // 4. Draw Bridges across rivers
      this._drawBridges(ctx, map, view);

      // 6. Draw City Architecture, Buildings & Logistics Depots
      this._drawCityBuildings(ctx, map, view, sim);

      // 7. Draw Highway Overhead Signs & Speed Limits
      this._drawRoadSigns(ctx, map.ROAD_SIGNS, view);

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
    }

    // ==============================================================
    // ENVIRONMENT: TERRAIN, MEADOWS, FORESTS & RIVERS
    // ==============================================================

    _drawTerrain(ctx, map, view) {
      // Agricultural Fields Grid (subtle field parcels in countryside)
      const fieldSize = 600;
      const startX = Math.floor(view.minX / fieldSize) * fieldSize;
      const startY = Math.floor(view.minY / fieldSize) * fieldSize;

      for (let x = startX; x <= view.maxX; x += fieldSize) {
        for (let y = startY; y <= view.maxY; y += fieldSize) {
          const hash = Math.abs(Math.sin(x * 0.0013 + y * 0.0029) * 10000);
          const variant = Math.floor(hash) % 4;
          const colors = ['#0f1511', '#121a14', '#111713', '#141c16'];

          ctx.fillStyle = colors[variant];
          ctx.fillRect(x + 4, y + 4, fieldSize - 8, fieldSize - 8);

          // Subtle field boundary lines
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, fieldSize, fieldSize);
        }
      }

      // Forests (Codru and Orhei National Park)
      const geo = map.GEOGRAPHY;
      if (geo && geo.forests) {
        for (const forest of geo.forests) {
          const pts = forest.points;
          if (!pts || pts.length < 3) continue;

          ctx.fillStyle = '#0b160e';
          ctx.strokeStyle = '#122417';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      // Rivers (Nistru, Prut, Răut, Bîc)
      const rivers = [
        { pts: geo?.nistruRiver, width: 140, name: 'Râul Nistru' },
        { pts: geo?.prutRiver, width: 120, name: 'Râul Prut' },
        { pts: geo?.rautRiver, width: 95, name: 'Râul Răut' },
        { pts: geo?.bicRiver, width: 85, name: 'Râul Bîc' }
      ];

      for (const r of rivers) {
        if (!r.pts || r.pts.length < 2) continue;

        // River base
        ctx.strokeStyle = '#0d1a24';
        ctx.lineWidth = r.width + 12;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        r.pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();

        // Water blue core
        ctx.strokeStyle = '#142c3d';
        ctx.lineWidth = r.width;
        ctx.stroke();

        // Subtle water flow ripple
        ctx.strokeStyle = 'rgba(74, 144, 226, 0.15)';
        ctx.lineWidth = r.width * 0.4;
        ctx.stroke();
      }
    }

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
    // HIGHWAYS & ROAD NETWORK (Layered Class Rendering & Multi-Lane Markings)
    // ==============================================================

    _drawRoads(ctx, map, view) {
      const edges = (map && map.OSM && map.OSM.edges) || (map && map.edges) || this.osmEdges || [];
      if (!edges || edges.length === 0) return;

      const visibleEdges = [];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const b = e.bounds;
        if (b && (b[2] < view.minX || b[0] > view.maxX || b[3] < view.minY || b[1] > view.maxY)) continue;
        const pts = e.points;
        if (!pts || pts.length < 2) continue;
        visibleEdges.push(e);
      }

      if (visibleEdges.length === 0) return;

      const getW = (edge) => (map && map.getRoadWidth ? map.getRoadWidth(edge) : this.getRoadWidth(edge));
      const getLanes = (edge) => (map && map.getEdgeLanes ? map.getEdgeLanes(edge) : this.getEdgeLanes(edge));

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 0. Median strip for divided dual-carriageway highways (50-100 px between axes only)
      // Drawn as grass/concrete fill WITHOUT white casing contour
      for (let i = 0; i < visibleEdges.length; i++) {
        const e = visibleEdges[i];
        if (!e.pairedEdgeId || !e.medianSide) continue;
        if (e.medianDist < 50 || e.medianDist > 100) continue;
        if (e.id > e.pairedEdgeId) continue; // Draw once per pair

        const w = getW(e);
        const medianOffset = e.medianSide * (e.medianDist * 0.5);
        const medianPts = this._offsetPolyline(e.points, medianOffset);
        if (!medianPts || medianPts.length < 2) continue;

        // Dark ground/grass median strip without white contour
        ctx.strokeStyle = '#14241a';
        ctx.lineWidth = Math.max(10, e.medianDist - w + 6);
        ctx.beginPath();
        ctx.moveTo(medianPts[0][0], medianPts[0][1]);
        for (let p = 1; p < medianPts.length; p++) ctx.lineTo(medianPts[p][0], medianPts[p][1]);
        ctx.stroke();
      }

      // Group visible edges into 5 class tiers:
      // Tier 0: service, residential, living_street, unclassified, other
      // Tier 1: tertiary_link, tertiary
      // Tier 2: secondary_link, secondary
      // Tier 3: primary_link, primary
      // Tier 4: trunk_link, trunk, motorway_link, motorway
      const tiers = [[], [], [], [], []];
      for (let i = 0; i < visibleEdges.length; i++) {
        const tier = this._getRoadTier(visibleEdges[i].roadClass);
        tiers[tier].push(visibleEdges[i]);
      }

      // Degree >= 3 junction lookup for trimming markings and junction asphalt circles
      const osmNodes = (map && map.OSM && map.OSM.nodes) || (map && map.nodes) || {};
      const isJunctionNode = (nodeId) => {
        const n = osmNodes[nodeId];
        return Boolean(n && Array.isArray(n[2]) && n[2].length >= 3);
      };

      const junctions = (map && map.junctionNodes) || [];

      // Render tier by tier from lowest (0) to highest (4)
      for (let t = 0; t <= 4; t++) {
        const tierEdges = tiers[t];
        if (tierEdges.length === 0) continue;

        // a) Casing (Контур): width w + 4, subtle semi-transparent light (darker, 2 px border, not white)
        ctx.strokeStyle = 'rgba(175, 190, 200, 0.35)';
        for (let i = 0; i < tierEdges.length; i++) {
          const e = tierEdges[i];
          const w = getW(e);
          ctx.lineWidth = w + 4;
          ctx.beginPath();
          const pts = e.points;
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
          ctx.stroke();
        }

        // b) Asphalt (Асфальт): width w, dark asphalt core
        ctx.strokeStyle = '#181e23';
        for (let i = 0; i < tierEdges.length; i++) {
          const e = tierEdges[i];
          const w = getW(e);
          ctx.lineWidth = w;
          ctx.beginPath();
          const pts = e.points;
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
          ctx.stroke();
        }

        // Seamless junction circles for this tier at degree >= 3 intersections
        ctx.fillStyle = '#181e23';
        for (let i = 0; i < junctions.length; i++) {
          const j = junctions[i];
          if (j.x + j.radius < view.minX || j.x - j.radius > view.maxX || j.y + j.radius < view.minY || j.y - j.radius > view.maxY) continue;
          ctx.beginPath();
          ctx.arc(j.x, j.y, j.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Steel guardrails along inner edges of divided paired highways of this tier
        for (let i = 0; i < tierEdges.length; i++) {
          const e = tierEdges[i];
          if (!e.pairedEdgeId || !e.medianSide) continue;
          if (e.medianDist < 50 || e.medianDist > 100) continue;

          const totalW = getW(e);
          const gOffset = e.medianSide * (totalW * 0.5 - 1);
          const gPts = this._offsetPolyline(e.points, gOffset);
          if (!gPts || gPts.length < 2) continue;

          // Continuous steel W-beam guardrail line
          ctx.save();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(gPts[0][0], gPts[0][1]);
          for (let p = 1; p < gPts.length; p++) ctx.lineTo(gPts[p][0], gPts[p][1]);
          ctx.stroke();

          // Short upright barrier posts every 16 px
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 2;
          let distSincePost = 16;
          for (let p = 1; p < gPts.length; p++) {
            const dx = gPts[p][0] - gPts[p - 1][0];
            const dy = gPts[p][1] - gPts[p - 1][1];
            const segLen = Math.hypot(dx, dy);
            if (segLen === 0) continue;
            const nx = -dy / segLen;
            const ny = dx / segLen;

            let traveled = 0;
            while (traveled + (16 - distSincePost) <= segLen) {
              traveled += (16 - distSincePost);
              distSincePost = 0;
              const px = gPts[p - 1][0] + (dx / segLen) * traveled;
              const py = gPts[p - 1][1] + (dy / segLen) * traveled;
              ctx.beginPath();
              ctx.moveTo(px - nx * 3, py - ny * 3);
              ctx.lineTo(px + nx * 3, py + ny * 3);
              ctx.stroke();
            }
            distSincePost += (segLen - traveled);
          }
          ctx.restore();
        }

        // c) Markings (Разметка) of this tier: trimmed near degree >= 3 nodes by w/2 + 10 px
        for (let i = 0; i < tierEdges.length; i++) {
          const e = tierEdges[i];
          const lanes = getLanes(e);
          if (lanes < 2) continue;

          const w = getW(e);
          const carriagewayW = lanes * 36;
          const halfC = carriagewayW * 0.5;

          const fromJunc = isJunctionNode(e.from);
          const toJunc = isJunctionNode(e.to);
          const trimStart = fromJunc ? (w * 0.5 + 10) : 0;
          const trimEnd = toJunc ? (w * 0.5 + 10) : 0;

          const trimmed = (trimStart > 0 || trimEnd > 0)
            ? this._trimPolyline(e.points, trimStart, trimEnd)
            : e.points;

          if (!trimmed || trimmed.length < 2) continue;

          for (let k = 1; k < lanes; k++) {
            const offset = -halfC + k * 36;
            const linePts = this._offsetPolyline(trimmed, offset);
            if (!linePts || linePts.length < 2) continue;

            ctx.save();
            if (!e.oneway && lanes >= 4 && k === Math.floor(lanes / 2)) {
              // Solid center line on 4+ lane two-way roads
              ctx.strokeStyle = 'rgba(240, 242, 236, 0.95)';
              ctx.lineWidth = 3;
              ctx.setLineDash([]);
            } else {
              // Dashed line between lanes
              ctx.strokeStyle = 'rgba(240, 242, 236, 0.85)';
              ctx.lineWidth = 2.2;
              ctx.setLineDash([18, 22]);
            }

            ctx.beginPath();
            ctx.moveTo(linePts[0][0], linePts[0][1]);
            for (let p = 1; p < linePts.length; p++) ctx.lineTo(linePts[p][0], linePts[p][1]);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // ==============================================================
    // BRIDGES ACROSS RIVERS
    // ==============================================================

    _drawBridges(ctx, map, view) {
      const bridges = [
        { x: 1200, y: -20000, angle: -Math.PI / 2, length: 180, width: 150, name: 'Podul peste Răut (M2 Orhei)' },
        { x: 10500, y: -2700, angle: 0, length: 220, width: 140, name: 'Podul peste Nistru (M1 Dubăsari)' },
        { x: 14500, y: 5900, angle: 0.35, length: 240, width: 140, name: 'Podul peste Nistru (R2 Gura Bîcului)' },
        { x: -30800, y: 2400, angle: 3.14, length: 200, width: 135, name: 'Podul peste Prut (R1 Ungheni)' }
      ];

      for (const br of bridges) {
        if (br.x + br.length < view.minX || br.x - br.length > view.maxX || br.y + br.length < view.minY || br.y - br.length > view.maxY) continue;

        ctx.save();
        ctx.translate(br.x, br.y);
        ctx.rotate(br.angle);

        // Concrete abutments
        ctx.fillStyle = '#374151';
        ctx.fillRect(-br.length * 0.5 - 15, -br.width * 0.5 - 6, br.length + 30, 6);
        ctx.fillRect(-br.length * 0.5 - 15, br.width * 0.5, br.length + 30, 6);

        // Metallic Guardrails (Silver)
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-br.length * 0.5, -br.width * 0.5 - 4, br.length, 3);
        ctx.fillRect(-br.length * 0.5, br.width * 0.5 + 1, br.length, 3);

        // Vertical bridge barrier posts
        for (let bx = -br.length * 0.5; bx <= br.length * 0.5; bx += 25) {
          ctx.fillRect(bx - 1.5, -br.width * 0.5 - 6, 3, 5);
          ctx.fillRect(bx - 1.5, br.width * 0.5 + 1, 3, 5);
        }

        ctx.restore();
      }
    }

    // ==============================================================
    // CITY ARCHITECTURE, BUILDINGS & LOGISTICS DEPOTS
    // ==============================================================

    _drawCityBuildings(ctx, map, view, sim) {
      // 1. City Blocks & Warehouses
      const blocks = map.CITY_BLOCKS || [];
      for (const b of blocks) {
        if (b.x + b.w < view.minX || b.x > view.maxX || b.y + b.h < view.minY || b.y > view.maxY) continue;

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(b.x + 8, b.y + 8, b.w, b.h);

        // Roof Base
        ctx.fillStyle = b.color || '#1a232a';
        ctx.fillRect(b.x, b.y, b.w, b.h);

        // Parapet edge
        ctx.strokeStyle = '#2d3b46';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        // Roof HVAC units
        ctx.fillStyle = '#374151';
        ctx.fillRect(b.x + 15, b.y + 15, 25, 20);
        ctx.fillRect(b.x + b.w - 40, b.y + 15, 25, 20);

        // Roof Label
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 9px Roboto, monospace';
        ctx.fillText(b.label || 'WAREHOUSE', b.x + 12, b.y + b.h - 12);
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
      const pois = (map && map.GEOGRAPHY && map.GEOGRAPHY.pois) || [];
      for (const poi of pois) {
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
      if (!signs || signs.length === 0) return;
      for (let i = 0; i < signs.length; i++) {
        const s = signs[i];
        if (s.x + 100 < view.minX || s.x - 100 > view.maxX || s.y + 100 < view.minY || s.y - 100 > view.maxY) continue;

        // Draw mounting post from road shoulder to sign base
        if (s.roadX !== undefined && s.roadY !== undefined) {
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(s.roadX, s.roadY);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }

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
  }

  root.ETSRenderer = TruckRenderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = TruckRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
