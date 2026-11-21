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

      // Dynamic camera zoom based on speed
      const speedKmh = sim.currentSpeedKmh || 0;
      this.targetZoom = clamp(1.1 - (speedKmh / 120) * 0.4, 0.65, 1.2);
      this.zoom += (this.targetZoom - this.zoom) * clamp(dt * 3.5, 0, 1);

      // Smooth lookahead camera
      const lookahead = Math.min(240, speedKmh * 2.2);
      const camX = t.x + Math.cos(t.angle) * lookahead;
      const camY = t.y + Math.sin(t.angle) * lookahead;

      // Viewport culling bounds (in world units)
      const halfW = (this.width / (2 * this.zoom)) + 180;
      const halfH = (this.height / (2 * this.zoom)) + 180;
      const view = {
        minX: camX - halfW,
        maxX: camX + halfW,
        minY: camY - halfH,
        maxY: camY + halfH
      };

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // 1. Natural dark earth backdrop (#0e1310)
      ctx.fillStyle = '#0e1310';
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.save();
      ctx.translate(this.width * 0.5, this.height * 0.5);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-camX, -camY);

      // 2. Draw Terrain (meadows, agricultural parcels, forests, rivers)
      this._drawTerrain(ctx, map, view);

      // 3. Draw Seamless Paved Junctions & Roundabouts
      this._drawJunctions(ctx, map.JUNCTIONS, view);

      // 4. Draw Roads (asphalt, shoulders, road markings)
      this._drawRoads(ctx, map.ROADS, view);

      // 5. Draw Bridges across rivers
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

    // ==============================================================
    // SEAMLESS PAVED JUNCTIONS & ROUNDABOUTS
    // ==============================================================

    _drawJunctions(ctx, junctions, view) {
      if (!junctions) return;
      for (const j of junctions) {
        const rad = j.radius || 120;
        if (j.x + rad < view.minX || j.x - rad > view.maxX || j.y + rad < view.minY || j.y - rad > view.maxY) continue;

        // Asphalt circle base connecting all intersecting roads
        ctx.fillStyle = '#181e23';
        ctx.beginPath();
        ctx.arc(j.x, j.y, rad, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#283139';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Special Roundabout Design (Sens Giratoriu)
        if (j.type === 'roundabout') {
          // Circular dashed lane
          ctx.save();
          ctx.strokeStyle = 'rgba(240, 242, 236, 0.7)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([14, 18]);
          ctx.beginPath();
          ctx.arc(j.x, j.y, rad * 0.72, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          // Center Raised Island with stone curb and grass
          ctx.fillStyle = '#374151'; // Concrete Curb
          ctx.beginPath();
          ctx.arc(j.x, j.y, rad * 0.44, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#14291a'; // Center Island Grass
          ctx.beginPath();
          ctx.arc(j.x, j.y, rad * 0.40, 0, Math.PI * 2);
          ctx.fill();

          // Roundabout Decorative Center Emblem
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(j.x, j.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ==============================================================
    // ROADS & HIGHWAYS (Asphalt, Shoulders, Markings)
    // ==============================================================

    _drawRoads(ctx, roads, view) {
      // 1. Draw Real OpenStreetMap Road Network
      if (this.osmEdges && this.osmEdges.length > 0) {
        for (let i = 0; i < this.osmEdges.length; i++) {
          const e = this.osmEdges[i];
          const b = e.bounds;
          if (b && (b[2] < view.minX || b[0] > view.maxX || b[3] < view.minY || b[1] > view.maxY)) continue;
          const pts = e.points;
          if (!pts || pts.length < 2) continue;

          const isMajor = e.roadClass === 'motorway' || e.roadClass === 'trunk' || e.roadClass === 'primary';
          const w = isMajor ? 120 : e.roadClass === 'secondary' ? 85 : 60;

          // Asphalt base
          ctx.strokeStyle = '#181e23';
          ctx.lineWidth = w;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
          ctx.stroke();

          // Subtle shoulder borders
          ctx.strokeStyle = '#283139';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Center dashed line
          ctx.save();
          ctx.strokeStyle = 'rgba(240, 242, 236, 0.75)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([20, 24]);
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (!roads) return;
      for (const road of roads) {
        const b = road.bounds;
        if (b && (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY)) continue;

        const pts = road.dense || road.points;
        if (!pts || pts.length < 2) continue;

        const w = road.width || 120;

        // 1. Dark asphalt base
        ctx.strokeStyle = '#181e23';
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        // 2. Subtle asphalt edge borders
        ctx.strokeStyle = '#283139';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 3. Outer Shoulder White Lines (using precomputed normals)
        ctx.strokeStyle = 'rgba(240, 242, 236, 0.65)';
        ctx.lineWidth = 2.5;

        if (pts[0].nx !== undefined) {
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const px = pts[i].x + pts[i].nx * (w * 0.47);
            const py = pts[i].y + pts[i].ny * (w * 0.47);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();

          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const px = pts[i].x - pts[i].nx * (w * 0.47);
            const py = pts[i].y - pts[i].ny * (w * 0.47);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }

        // 4. Center Dashed Line (Skip for narrow 1-lane service ramps)
        if (road.lanes !== 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(240, 242, 236, 0.85)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([20, 24]);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          ctx.restore();
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

      // 3. Gas Stations (Rompetrol Peresecina, Petrom, etc.)
      const pois = map.GEOGRAPHY?.pois || [];
      for (const poi of pois) {
        if (poi.type !== 'gas') continue;
        if (poi.x + 120 < view.minX || poi.x - 120 > view.maxX || poi.y + 120 < view.minY || poi.y - 120 > view.maxY) continue;

        ctx.save();
        ctx.translate(poi.x, poi.y);

        // Gas Station Canopy Roof (Red/Orange canopy)
        ctx.fillStyle = '#b91c1c';
        ctx.fillRect(-55, -35, 110, 70);

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-55, -35, 110, 70);

        // Fuel pump concrete islands
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-35, -12, 14, 24);
        ctx.fillRect(20, -12, 14, 24);

        // Canopy Brand Sign
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(poi.label || 'PECO', 0, 4);

        ctx.restore();
      }
    }

    // ==============================================================
    // HIGHWAY OVERHEAD SIGNS & ROAD PROPS
    // ==============================================================

    _drawRoadSigns(ctx, signs, view) {
      if (!signs) return;
      for (const s of signs) {
        if (s.x + 150 < view.minX || s.x - 150 > view.maxX || s.y + 150 < view.minY || s.y - 150 > view.maxY) continue;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);

        // Overhead Metal Gantry Beam across the road
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-75, 0); ctx.lineTo(75, 0);
        ctx.stroke();

        // Gantry upright posts
        ctx.fillStyle = '#334155';
        ctx.fillRect(-78, -4, 6, 8);
        ctx.fillRect(72, -4, 6, 8);

        // Green Highway Direction Signboard
        ctx.fillStyle = '#15803d'; // European Motorway Green
        ctx.beginPath();
        ctx.roundRect(-65, -38, 130, 36, 4);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Sign text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.main, 0, -22);

        ctx.fillStyle = '#fef08a'; // Sub destination / arrows in yellow
        ctx.font = '8.5px Roboto, sans-serif';
        ctx.fillText(s.sub, 0, -8);

        // Speed limit circle sign on right gantry post
        if (s.speed) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(88, -18, 12, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#dc2626'; // Red ring
          ctx.lineWidth = 3;
          ctx.stroke();

          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 9px Roboto, monospace';
          ctx.fillText(String(s.speed), 88, -14);
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
