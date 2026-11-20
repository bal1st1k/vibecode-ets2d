/*! 2D ETS2 Moldova Edition | Clean Minimalist Renderer */
(function (root) {
  'use strict';

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

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.floor(rect.width);
      this.height = Math.floor(rect.height);
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
    }

    render(sim, dt = 0.016) {
      if (!this.ctx || !sim) return;
      const ctx = this.ctx;
      const t = sim.truck;
      const r = sim.trailer;
      const map = sim.map;

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
      const lookahead = Math.min(220, speedKmh * 2.0);
      const camX = t.x + Math.cos(t.angle) * lookahead;
      const camY = t.y + Math.sin(t.angle) * lookahead;

      // Viewport culling bounds
      const halfW = (this.width / (2 * this.zoom)) + 150;
      const halfH = (this.height / (2 * this.zoom)) + 150;
      const view = {
        minX: camX - halfW,
        maxX: camX + halfW,
        minY: camY - halfH,
        maxY: camY + halfH
      };

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // Clean dark backdrop (like Neon Drift #0c1013)
      ctx.fillStyle = '#0c1013';
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.save();
      ctx.translate(this.width * 0.5, this.height * 0.5);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-camX, -camY);

      // 1. Draw Roads (only visible segments)
      this._drawRoads(ctx, map.ROADS, view);

      // 2. Shadows
      if (r.attached) this._drawShadow(ctx, r.x, r.y, r.angle, 136, 25);
      this._drawShadow(ctx, t.x, t.y, t.angle, 68, 25);

      // 3. Reversing guide line (subtle)
      if (t.gear === -1 && r.attached) {
        this._drawReverseGuide(ctx, t, r);
      }

      // 4. Semi-Trailer
      if (r.attached) {
        this._drawTrailer(ctx, r, t, sim);
      }

      // 5. Truck
      this._drawTruck(ctx, t, sim);

      // 6. Headlights cone
      if (t.lights > 0) {
        this._drawHeadlightBeams(ctx, t);
      }

      ctx.restore();
    }

    _drawRoads(ctx, roads, view) {
      if (!roads) return;
      for (const road of roads) {
        const b = road.bounds;
        if (b && (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY)) continue;

        const pts = road.dense || road.points;
        if (!pts || pts.length < 2) continue;

        const w = road.width || 120;

        // Dark asphalt base
        ctx.strokeStyle = '#181e23';
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        // Subtle road borders
        ctx.strokeStyle = '#283139';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Edge white lines
        ctx.strokeStyle = 'rgba(240, 242, 236, 0.6)';
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

        // Center dashed line
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

    _drawShadow(ctx, x, y, angle, length, width) {
      ctx.save();
      ctx.translate(x + 3, y + 4);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(-length * 0.5, -width * 0.5, length, width);
      ctx.restore();
    }

    _drawTruck(ctx, t, sim) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);

      const l = 68;
      const w = 25;

      // Wheels
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

      ctx.fillStyle = '#0a0d0f';
      ctx.fillRect(-l * 0.32, -w * 0.53, 14, 9);
      ctx.fillRect(-l * 0.32, w * 0.53 - 5, 14, 9);

      // Chassis
      ctx.fillStyle = '#1c242a';
      ctx.fillRect(-l * 0.48, -w * 0.36, l * 0.96, w * 0.72);

      // Fifth wheel
      ctx.fillStyle = '#3a444c';
      ctx.beginPath();
      ctx.arc(-16, 0, 6, 0, Math.PI * 2);
      ctx.fill();

      // Cab Body
      ctx.fillStyle = t.color || '#2c3e50';
      ctx.fillRect(-l * 0.05, -w * 0.48, l * 0.52, w * 0.96);

      // Windshield
      ctx.fillStyle = '#0a0d10';
      ctx.fillRect(l * 0.22, -w * 0.42, l * 0.16, w * 0.84);

      // Roof spoiler
      ctx.fillStyle = t.cabColor || '#1a252f';
      ctx.fillRect(l * 0.32, -w * 0.44, l * 0.08, w * 0.88);

      // Mirrors
      ctx.fillStyle = '#0a0d10';
      ctx.fillRect(l * 0.34, -w * 0.58, 4, 6);
      ctx.fillRect(l * 0.34, w * 0.58 - 6, 4, 6);

      // Headlights
      ctx.fillStyle = t.lights > 0 ? '#ffffff' : '#636e72';
      ctx.fillRect(l * 0.45, -w * 0.44, 3, 6);
      ctx.fillRect(l * 0.45, w * 0.44 - 6, 3, 6);

      // Blinker
      if ((t.turnSignal === -1 || t.turnSignal === 2) && this.turnBlinkOn) {
        ctx.fillStyle = '#f39c12';
        ctx.fillRect(l * 0.45, -w * 0.48, 3, 5);
      }
      if ((t.turnSignal === 1 || t.turnSignal === 2) && this.turnBlinkOn) {
        ctx.fillStyle = '#f39c12';
        ctx.fillRect(l * 0.45, w * 0.48 - 5, 3, 5);
      }

      // Tail lights
      const brakeOn = t.speed !== 0 && sim.wasBraking;
      ctx.fillStyle = brakeOn ? '#ff3838' : '#7f1d1d';
      ctx.fillRect(-l * 0.49, -w * 0.4, 3, 7);
      ctx.fillRect(-l * 0.49, w * 0.4 - 7, 3, 7);

      // Reverse Light
      if (t.gear === -1) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-l * 0.49, -w * 0.1, 3, 5);
      }

      ctx.restore();
    }

    _drawTrailer(ctx, r, t, sim) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);

      const l = 136;
      const w = 25;

      // Triple rear bogie wheels
      ctx.fillStyle = '#0a0d0f';
      for (let offset = -l * 0.28; offset >= -l * 0.44; offset -= 12) {
        ctx.fillRect(offset, -w * 0.53, 11, 7);
        ctx.fillRect(offset, w * 0.53 - 7, 11, 7);
      }

      // Trailer Body (Clean Dark Grey / Metallic Tarpaulin)
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(-l * 0.5, -w * 0.5, l, w);

      // Clean side stripe
      ctx.fillStyle = '#4a5568';
      ctx.fillRect(-l * 0.48, -w * 0.48, l * 0.96, 3);
      ctx.fillRect(-l * 0.48, w * 0.48 - 3, l * 0.96, 3);

      // Rear tail lights
      const brakeOn = t.speed !== 0 && sim.wasBraking;
      ctx.fillStyle = brakeOn ? '#ff3838' : '#7f1d1d';
      ctx.fillRect(-l * 0.52, -w * 0.45, 2, 8);
      ctx.fillRect(-l * 0.52, w * 0.45 - 8, 2, 8);

      if ((t.turnSignal === -1 || t.turnSignal === 2) && this.turnBlinkOn) {
        ctx.fillStyle = '#f39c12';
        ctx.fillRect(-l * 0.52, -w * 0.48, 2, 6);
      }
      if ((t.turnSignal === 1 || t.turnSignal === 2) && this.turnBlinkOn) {
        ctx.fillStyle = '#f39c12';
        ctx.fillRect(-l * 0.52, w * 0.48 - 6, 2, 6);
      }

      ctx.restore();
    }

    _drawHeadlightBeams(ctx, t) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);

      const beamLength = t.lights === 2 ? 360 : 200;
      const beamSpread = t.lights === 2 ? 120 : 80;

      const grad = ctx.createRadialGradient(35, 0, 10, beamLength * 0.6, 0, beamSpread * 1.4);
      grad.addColorStop(0, 'rgba(255, 255, 240, 0.35)');
      grad.addColorStop(0.5, 'rgba(255, 255, 220, 0.12)');
      grad.addColorStop(1, 'rgba(255, 255, 220, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(35, -10);
      ctx.lineTo(beamLength, -beamSpread);
      ctx.lineTo(beamLength, beamSpread);
      ctx.lineTo(35, 10);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    _drawReverseGuide(ctx, t, r) {
      ctx.save();
      ctx.strokeStyle = r.jackknifed ? '#e74c3c' : 'rgba(46, 204, 113, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);

      const rearX = r.x - Math.cos(r.angle) * 60;
      const rearY = r.y - Math.sin(r.angle) * 60;
      const arcLen = 120;
      const predictAngle = r.angle + r.articulationAngle * 1.2;
      const targetX = rearX - Math.cos(predictAngle) * arcLen;
      const targetY = rearY - Math.sin(predictAngle) * arcLen;

      ctx.beginPath();
      ctx.moveTo(rearX, rearY);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      ctx.restore();
    }
  }

  root.ETSRenderer = TruckRenderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = TruckRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
