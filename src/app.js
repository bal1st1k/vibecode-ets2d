/*! 2D ETS2 Moldova Edition | Main Application Controller & Shell | Google Maps Navigation Edition */
(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const safeText = (sel, text) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (el) el.textContent = text;
  };
  const safeHtml = (sel, html) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (el) el.innerHTML = html;
  };

  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h) {
      if (typeof this.rect === 'function') this.rect(x, y, w, h);
    };
  }

  const map = ETSMap;
  const geo = map.GEOGRAPHY || {};
  const trucksCatalog = ETSTrucks;
  const sim = new ETSEngine.TruckSimulation(map);
  const audio = new ETSAudio();
  const gameCanvas = $('#game-canvas');
  const renderer = new ETSRenderer(gameCanvas);
  const previewCanvas = $('#preview-canvas');
  const worldMapCanvas = $('#world-map-canvas');

  // Storage key
  const STORAGE_KEY = 'ets2-moldova-profile.v1';

  // Load or initialize career profile
  function loadProfile() {
    let p = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) p = JSON.parse(raw);
    } catch (_) {}
    if (!p || typeof p !== 'object') {
      p = {};
    }

    if (typeof p.moneyMdl !== 'number' || isNaN(p.moneyMdl)) p.moneyMdl = 48500;
    if (typeof p.level !== 'number') p.level = 1;
    if (typeof p.xp !== 'number') p.xp = 240;
    if (typeof p.totalDeliveries !== 'number') p.totalDeliveries = 3;
    if (!Array.isArray(p.ownedTrucks) || p.ownedTrucks.length === 0) p.ownedTrucks = ['kamaz-54901'];
    if (!p.currentTruckId || !trucksCatalog.getTruck(p.currentTruckId)) p.currentTruckId = p.ownedTrucks[0];
    if (!p.truckTunings || typeof p.truckTunings !== 'object') p.truckTunings = {};

    // Validate and sanitize activeJob against current depots
    const depots = map.getAllDepots ? map.getAllDepots() : (map.DEPOTS || []);
    if (p.activeJob) {
      if (!p.activeJob.cargo || !p.activeJob.cargo.id) {
        p.activeJob.cargo = (map.CARGO_CATALOG && map.CARGO_CATALOG[0]) || { id: 'grain', nameRu: 'Зерно', weightKg: 18000 };
      }
      const targetDepot = depots.find(d => d.id === p.activeJob.targetDepot?.id) || depots[1] || depots[0];
      const originDepot = depots.find(d => d.id === p.activeJob.originDepot?.id) || depots[0];
      if (targetDepot && originDepot && typeof targetDepot.x === 'number') {
        p.activeJob.targetDepot = targetDepot;
        p.activeJob.originDepot = originDepot;
        if (!p.activeJob.targetCityName) p.activeJob.targetCityName = targetDepot.name;
        if (!p.activeJob.originCity) p.activeJob.originCity = originDepot.name;
        if (typeof p.activeJob.rewardMdl !== 'number') p.activeJob.rewardMdl = 4800;
        if (typeof p.activeJob.distKm !== 'number') p.activeJob.distKm = 45;
      } else {
        p.activeJob = null;
      }
    }
    return p;
  }

  const profile = loadProfile();

  function saveProfile() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (_) {}
    updateWalletDisplays();
  }

  function updateWalletDisplays() {
    const formatted = `${profile.moneyMdl.toLocaleString()} MDL`;
    for (const el of $$('[data-wallet]')) el.textContent = formatted;
    safeText('#home-truck-count', `${profile.ownedTrucks.length}/6`);
  }

  // Activate starting truck in simulation
  function applyActiveTruck() {
    const truck = trucksCatalog.getTruck(profile.currentTruckId);
    sim.setTruckModel(truck);
    if (profile.truckTunings && profile.truckTunings[truck.id]?.bonusHp) {
      sim.truck.powerHp += profile.truckTunings[truck.id].bonusHp;
    }
    // Update labels in home and HUD
    safeText('#preview-truck-name', `${truck.brand} ${truck.model}`.toUpperCase());
    safeHtml('#hud-truck-model', `${truck.brand} <strong>${truck.model}</strong>`);
  }
  applyActiveTruck();

  // Toast Notification System
  let toastTimer = null;
  function toast(msg, isError = false) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = isError ? 'show error' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = '';
    }, 2800);
  }

  // State Management: Menu vs Driving
  let isDriving = false;
  let currentPage = 'home';
  let adminModalOpen = false;
  let selectedTargetCoord = { x: 1200, y: 3000 };

  // ==============================================================
  // GOOGLE MAPS NAVIGATION ENGINE (ETS 2 GPS Mod Style)
  // ==============================================================
  let gmapZoom = 1.0;
  let gmapPanX = 0;
  let gmapPanY = 0;
  let gmapLayer = 'schema'; // 'schema' or 'satellite'
  let gmapSelectedPin = null; // { x, y, title, desc }
  let isDraggingGmap = false;
  let gmapDragStart = { x: 0, y: 0 };
  let gmapPulseTimer = 0;

  // Project World coordinates to Google Maps Canvas (North is UP!)
  function worldToGmap(wx, wy, cw, ch) {
    const centerX = -5000;
    const centerY = -10000; // Geographic center of Moldova
    const baseScale = Math.min((cw - 100) / 58000, (ch - 100) / 72000);
    const s = baseScale * gmapZoom;
    const cx = (cw * 0.5) + (wx - centerX) * s + gmapPanX;
    const cy = (ch * 0.5) + (wy - centerY) * s + gmapPanY;
    return { cx, cy, scale: s };
  }

  // Inverse project Google Maps Canvas coordinates to World
  function gmapToWorld(cx, cy, cw, ch) {
    const centerX = -5000;
    const centerY = -10000;
    const baseScale = Math.min((cw - 100) / 58000, (ch - 100) / 72000);
    const s = baseScale * gmapZoom;
    const wx = centerX + (cx - (cw * 0.5) - gmapPanX) / s;
    const wy = centerY + (cy - (ch * 0.5) - gmapPanY) / s;
    return { wx, wy };
  }

  // Center Google Maps viewport on specific world coordinates
  function gmapCenterOn(wx, wy) {
    const canvas = worldMapCanvas;
    if (!canvas) return;
    const cw = canvas.width || 900;
    const ch = canvas.height || 520;
    const centerX = -5000;
    const centerY = -10000;
    const baseScale = Math.min((cw - 100) / 58000, (ch - 100) / 72000);
    const s = baseScale * gmapZoom;

    gmapPanX = -((wx - centerX) * s);
    gmapPanY = -((wy - centerY) * s);
    renderGoogleMaps();
  }

  // Draw Google Maps Viewport
  function renderGoogleMaps() {
    const canvas = worldMapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const cw = canvas.width = Math.floor(rect.width || 900);
    const ch = canvas.height = Math.floor(rect.height || 520);

    // 1. Land Background
    if (gmapLayer === 'satellite') {
      // Satellite Dark Imagery Palette
      ctx.fillStyle = '#111713';
      ctx.fillRect(0, 0, cw, ch);

      // Subtle satellite relief noise/gradients
      const satGrad = ctx.createRadialGradient(cw * 0.5, ch * 0.5, 50, cw * 0.5, ch * 0.5, ch);
      satGrad.addColorStop(0, '#1a241e');
      satGrad.addColorStop(0.5, '#131b16');
      satGrad.addColorStop(1, '#0e1410');
      ctx.fillStyle = satGrad;
      ctx.fillRect(0, 0, cw, ch);
    } else {
      // Google Maps Dark Mode Vector Palette (#202124)
      ctx.fillStyle = '#202124';
      ctx.fillRect(0, 0, cw, ch);

      // Subtle gridlines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      for (let x = 0; x < cw; x += 48) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
      }
      for (let y = 0; y < ch; y += 48) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
      }
    }

    // 1b. Republic of Moldova National Territorial Border
    if (geo && geo.moldovaBorder) {
      ctx.fillStyle = gmapLayer === 'satellite' ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.035)';
      ctx.beginPath();
      geo.moldovaBorder.forEach((p, i) => {
        const { cx, cy } = worldToGmap(p.x, p.y, cw, ch);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(156, 163, 175, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Forests & Green Areas
    if (geo && geo.forests) {
      geo.forests.forEach(f => {
        ctx.fillStyle = gmapLayer === 'satellite' ? '#1b3823' : '#162a1e';
        ctx.strokeStyle = gmapLayer === 'satellite' ? '#274e31' : '#1e3827';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        f.points.forEach((p, i) => {
          const { cx, cy } = worldToGmap(p.x, p.y, cw, ch);
          if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Forest label
        if (gmapZoom >= 0.75) {
          const center = worldToGmap(f.points[0].x, f.points[0].y, cw, ch);
          ctx.fillStyle = '#42684e';
          ctx.font = '10px Roboto, "Segoe UI", sans-serif';
          ctx.fillText(f.name, center.cx + 10, center.cy);
        }
      });
    }

    // 3. Rivers & Water (Nistru, Prut, Răut, Bîc)
    if (geo) {
      const riverList = [
        { pts: geo.nistruRiver, name: 'Râul Nistru', w: 14 },
        { pts: geo.prutRiver, name: 'Râul Prut', w: 12 },
        { pts: geo.rautRiver, name: 'Râul Răut', w: 9 },
        { pts: geo.bicRiver, name: 'Râul Bîc', w: 8 }
      ];

      riverList.forEach((r) => {
        if (!r.pts || r.pts.length < 2) return;
        ctx.strokeStyle = '#172b42'; // Google Maps Dark Water Blue
        ctx.lineWidth = r.w * (gmapZoom * 0.7 + 0.3);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        r.pts.forEach((p, i) => {
          const { cx, cy } = worldToGmap(p.x, p.y, cw, ch);
          if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        });
        ctx.stroke();

        ctx.strokeStyle = '#2b4d70';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // River Label
        if (gmapZoom >= 0.75) {
          const midIndex = Math.floor(r.pts.length / 2);
          const labelPt = worldToGmap(r.pts[midIndex].x, r.pts[midIndex].y, cw, ch);
          ctx.fillStyle = '#5383b8';
          ctx.font = 'italic 10px Roboto, sans-serif';
          ctx.fillText(r.name, labelPt.cx + 8, labelPt.cy - 6);
        }
      });
    }

    // 4. Real OpenStreetMap Road Network (LOD & Viewport Culled)
    const topLeft = gmapToWorld(0, 0, cw, ch);
    const bottomRight = gmapToWorld(cw, ch, cw, ch);
    const viewMinX = Math.min(topLeft.wx, bottomRight.wx);
    const viewMaxX = Math.max(topLeft.wx, bottomRight.wx);
    const viewMinY = Math.min(topLeft.wy, bottomRight.wy);
    const viewMaxY = Math.max(topLeft.wy, bottomRight.wy);

    const showSecondary = gmapZoom >= 0.26;
    const showTertiary = gmapZoom >= 0.65;
    const s = Math.min((cw - 100) / 58000, (ch - 100) / 72000) * gmapZoom;
    const centerX = -5000;
    const centerY = -10000;

    const osmEdges = (map.OSM && map.OSM.edges) ? map.OSM.edges : null;

    if (osmEdges && osmEdges.length > 0) {
      // Pass 1: Road Casings for all visible edges
      ctx.strokeStyle = '#18212b';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < osmEdges.length; i++) {
        const e = osmEdges[i];
        const b = e.bounds;
        if (b[0] > viewMaxX || b[2] < viewMinX || b[1] > viewMaxY || b[3] < viewMinY) continue;

        const rc = e.roadClass;
        if (rc === 'tertiary' || rc === 'tertiary_link') {
          if (!showTertiary) continue;
        } else if (rc === 'secondary' || rc === 'secondary_link') {
          if (!showSecondary) continue;
        }

        const isMajor = rc === 'motorway' || rc === 'trunk' || rc === 'primary';
        const casingW = Math.max(2.2, (isMajor ? 11 : rc === 'secondary' ? 7.5 : 5) * s);
        ctx.lineWidth = casingW;
        ctx.beginPath();
        const pts = e.points;
        for (let p = 0; p < pts.length; p++) {
          const cx = (cw * 0.5) + (pts[p][0] - centerX) * s + gmapPanX;
          const cy = (ch * 0.5) + (pts[p][1] - centerY) * s + gmapPanY;
          if (p === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }

      // Pass 2: Road Cores with True Highway Colors
      for (let i = 0; i < osmEdges.length; i++) {
        const e = osmEdges[i];
        const b = e.bounds;
        if (b[0] > viewMaxX || b[2] < viewMinX || b[1] > viewMaxY || b[3] < viewMinY) continue;

        const rc = e.roadClass;
        if (rc === 'tertiary' || rc === 'tertiary_link') {
          if (!showTertiary) continue;
          ctx.strokeStyle = '#64748b'; // Tertiary gray
          ctx.lineWidth = Math.max(1.2, 3.8 * s);
        } else if (rc === 'secondary' || rc === 'secondary_link') {
          if (!showSecondary) continue;
          ctx.strokeStyle = '#cbd5e1'; // Secondary light gray
          ctx.lineWidth = Math.max(1.6, 6.0 * s);
        } else if (rc === 'primary' || rc === 'primary_link') {
          ctx.strokeStyle = '#10b981'; // Primary Emerald
          ctx.lineWidth = Math.max(2.0, 7.5 * s);
        } else if (rc === 'trunk' || rc === 'trunk_link') {
          ctx.strokeStyle = '#38bdf8'; // Trunk Sky Blue
          ctx.lineWidth = Math.max(2.4, 9.0 * s);
        } else {
          ctx.strokeStyle = '#f59e0b'; // Motorway Amber
          ctx.lineWidth = Math.max(2.8, 10.5 * s);
        }

        ctx.beginPath();
        const pts = e.points;
        for (let p = 0; p < pts.length; p++) {
          const cx = (cw * 0.5) + (pts[p][0] - centerX) * s + gmapPanX;
          const cy = (ch * 0.5) + (pts[p][1] - centerY) * s + gmapPanY;
          if (p === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    } else if (map.ROADS) {
      // Fallback schematic roads
      map.ROADS.forEach(road => {
        const pts = road.dense || road.points;
        if (!pts || pts.length < 2) return;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4 * gmapZoom;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const { cx, cy } = worldToGmap(p.x, p.y, cw, ch);
          if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        });
        ctx.stroke();
      });
    }

    // 5. Active Dijkstra / A* Navigation Route (Signature Google Blue #4285F4)
    let currentNavRoute = null;
    if (profile.activeJob && profile.activeJob.targetDepot && map.findRoute) {
      currentNavRoute = map.findRoute(sim.truck, profile.activeJob.targetDepot);
    }

    if (currentNavRoute && currentNavRoute.polyline && currentNavRoute.polyline.length >= 2) {
      const poly = currentNavRoute.polyline;

      // Outer Glow Aura
      ctx.strokeStyle = 'rgba(66, 133, 244, 0.4)';
      ctx.lineWidth = Math.max(6, 16 * s);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const cx = (cw * 0.5) + (poly[i][0] - centerX) * s + gmapPanX;
        const cy = (ch * 0.5) + (poly[i][1] - centerY) * s + gmapPanY;
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();

      // Navigation Blue Core
      ctx.strokeStyle = '#4285F4';
      ctx.lineWidth = Math.max(3, 7.5 * s);
      ctx.stroke();

      // White Center Strip with Moving Pulse Chevrons
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, 2.5 * s);
      ctx.setLineDash([12 * gmapZoom, 16 * gmapZoom]);
      ctx.lineDashOffset = -(gmapPulseTimer * 40);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 6. Road Shields (M2, M5, M1, R1, R6, R14, R20, etc.)
    if (gmapZoom >= 0.35) {
      const drawnShields = new Set();
      const shieldList = [];

      // Add national highway shields
      if (osmEdges) {
        for (let i = 0; i < osmEdges.length; i += 12) {
          const e = osmEdges[i];
          if (e.ref && e.points.length >= 2 && !drawnShields.has(e.ref)) {
            const midP = e.points[Math.floor(e.points.length / 2)];
            if (midP[0] >= viewMinX && midP[0] <= viewMaxX && midP[1] >= viewMinY && midP[1] <= viewMaxY) {
              const isM = e.ref.startsWith('M');
              const isR = e.ref.startsWith('R');
              if (isM || isR || gmapZoom >= 0.75) {
                drawnShields.add(e.ref);
                shieldList.push({
                  x: midP[0],
                  y: midP[1],
                  label: e.ref,
                  color: isM ? '#1b5e20' : '#b71c1c'
                });
              }
            }
          }
        }
      }

      shieldList.forEach(sh => {
        const { cx, cy } = worldToGmap(sh.x, sh.y, cw, ch);
        const isWide = sh.label.length > 3;
        const sw = (isWide ? 42 : 28) * Math.min(1.2, Math.max(0.7, gmapZoom));
        const sh2 = 16 * Math.min(1.2, Math.max(0.7, gmapZoom));

        ctx.fillStyle = sh.color;
        ctx.beginPath();
        ctx.roundRect(cx - sw * 0.5, cy - sh2 * 0.5, sw, sh2, 3);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(9 * Math.min(1.2, Math.max(0.7, gmapZoom)))}px Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(sh.label, cx, cy + sh2 * 0.22);
        ctx.textAlign = 'left';
      });
    }

    // 8. Freight Logistics Depots & Terminals
    const allDepots = map.getAllDepots ? map.getAllDepots() : (map.DEPOTS || []);
    allDepots.forEach(depot => {
      const { cx, cy } = worldToGmap(depot.x, depot.y, cw, ch);

      // Depot marker badge
      ctx.fillStyle = '#ea4335';
      ctx.beginPath();
      ctx.arc(cx, cy, 7 * gmapZoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🏢', cx, cy + 3);
      ctx.textAlign = 'left';

      // Depot label
      if (gmapZoom >= 0.45) {
        ctx.fillStyle = '#fca5a5';
        ctx.font = 'bold 10px Roboto, sans-serif';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText(depot.name, cx + 11 * gmapZoom, cy + 3);
        ctx.shadowBlur = 0;
      }
    });

    // 9. Real OpenStreetMap Cities and Settlements (with LOD)
    const citiesList = map.CITIES || [];
    citiesList.forEach(city => {
      // LOD filter for settlements
      if (gmapZoom < 0.28) {
        if (city.population && city.population < 20000 && city.place !== 'city') return;
      } else if (gmapZoom < 0.65) {
        if (city.population && city.population < 4000 && city.place === 'village') return;
      }

      const { cx, cy } = worldToGmap(city.x, city.y, cw, ch);
      if (cx < -40 || cx > cw + 40 || cy < -40 || cy > ch + 40) return;

      const isCapital = city.nameRu === 'Кишинёв' || city.nameRo === 'Chișinău';
      const isMajor = isCapital || (city.population && city.population > 30000) || city.place === 'city';

      // City Dot
      ctx.fillStyle = isCapital ? '#f59e0b' : '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, (isCapital ? 6 : isMajor ? 4.5 : 3) * Math.min(1.4, gmapZoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#202124';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // City Label
      ctx.fillStyle = '#ffffff';
      ctx.font = isCapital ? '700 13px Roboto, sans-serif' : isMajor ? '600 11px Roboto, sans-serif' : '500 9px Roboto, sans-serif';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      const labelText = city.nameRu || city.name || city.nameRo;
      ctx.fillText(labelText, cx + 8 * gmapZoom, cy + 4);
      ctx.shadowBlur = 0;
    });

    // 10. Selected Dropped Pin (Google Maps Red Marker 📍)
    if (gmapSelectedPin) {
      const { cx, cy } = worldToGmap(gmapSelectedPin.x, gmapSelectedPin.y, cw, ch);

      // Pin shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pin Body
      ctx.fillStyle = '#EA4335';
      ctx.beginPath();
      ctx.arc(cx, cy - 20, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - 16);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 8, cy - 16);
      ctx.closePath();
      ctx.fill();

      // Pin Inner Dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy - 20, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 11. GPS Navigation Truck Location (Google Navigation Marker)
    const t = sim.truck;
    const truckGmap = worldToGmap(t.x, t.y, cw, ch);

    // Pulsing Outer Radar Circle
    ctx.fillStyle = 'rgba(66, 133, 244, 0.25)';
    ctx.beginPath();
    ctx.arc(truckGmap.cx, truckGmap.cy, 18 * gmapZoom, 0, Math.PI * 2);
    ctx.fill();

    // Direction Beam
    ctx.save();
    ctx.translate(truckGmap.cx, truckGmap.cy);
    ctx.rotate(t.angle + Math.PI * 0.5); // Convert to canvas angle

    const beamGrad = ctx.createRadialGradient(0, 0, 5, 0, -35, 30);
    beamGrad.addColorStop(0, 'rgba(66, 133, 244, 0.5)');
    beamGrad.addColorStop(1, 'rgba(66, 133, 244, 0)');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-18, -45);
    ctx.lineTo(18, -45);
    ctx.closePath();
    ctx.fill();

    // Navigation Arrow Circle
    ctx.fillStyle = '#4285F4';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Forward Arrowhead
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(-4, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(4, 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Live Speed Floating Label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Consolas, monospace';
    ctx.fillText(`${sim.currentSpeedKmh} км/ч`, truckGmap.cx + 12, truckGmap.cy - 6);
  }

  function renderWorldMap() {
    renderGoogleMaps();
  }

  // Google Maps Interactivity: Drag & Zoom & Click
  function setupGoogleMapsInteractions() {
    const canvas = worldMapCanvas;
    if (!canvas) return;

    // Pan with Mouse Drag
    canvas.addEventListener('mousedown', e => {
      isDraggingGmap = true;
      gmapDragStart = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', e => {
      if (!isDraggingGmap || currentPage !== 'map') return;
      const dx = e.clientX - gmapDragStart.x;
      const dy = e.clientY - gmapDragStart.y;
      gmapDragStart = { x: e.clientX, y: e.clientY };

      gmapPanX += dx;
      gmapPanY += dy;
      renderGoogleMaps();
    });

    window.addEventListener('mouseup', () => {
      isDraggingGmap = false;
    });

    // Zoom with Mouse Wheel
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      gmapZoom = Math.max(0.4, Math.min(4.5, gmapZoom * zoomFactor));
      renderGoogleMaps();
    }, { passive: false });

    // Click to Place Google Maps Pin & Show Location Card
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const { wx, wy } = gmapToWorld(cx, cy, canvas.width, canvas.height);

      // Find nearest POI or city within 600 units
      let nearestName = 'Пользовательская точка на карте M2';
      let minDist = Infinity;
      [...map.CITIES, ...(map.GEOGRAPHY.pois || [])].forEach(loc => {
        const d = Math.hypot(loc.x - wx, loc.y - wy);
        if (d < minDist) {
          minDist = d;
          nearestName = loc.nameRu || loc.name;
        }
      });

      const distFromTruckKm = (Math.hypot(sim.truck.x - wx, sim.truck.y - wy) * 0.1 / 1000).toFixed(1);

      gmapSelectedPin = {
        x: wx,
        y: wy,
        title: nearestName,
        desc: `Координаты: X ${Math.round(wx)} · Y ${Math.round(wy)} (${distFromTruckKm} км от тягача)`
      };

      // Show Pin Card
      const card = $('#gmaps-pin-card');
      if (card) {
        card.hidden = false;
        $('#pin-card-title').textContent = gmapSelectedPin.title;
        $('#pin-card-coords').textContent = `X: ${Math.round(wx)} · Y: ${Math.round(wy)}`;
        $('#pin-card-desc').textContent = gmapSelectedPin.desc;

        $('#btn-pin-teleport').onclick = () => {
          executeTeleport(wx, wy, null, 0, gmapSelectedPin.title);
          renderGoogleMaps();
        };

        $('#btn-pin-drive').onclick = () => {
          executeTeleport(wx, wy, null, 0, gmapSelectedPin.title);
          launchDrive();
        };
      }

      renderGoogleMaps();
    });

    $('#btn-pin-card-close')?.addEventListener('click', () => {
      $('#gmaps-pin-card').hidden = true;
      gmapSelectedPin = null;
      renderGoogleMaps();
    });

    // Google Maps Controls
    $('#btn-gmaps-zoom-in')?.addEventListener('click', () => {
      gmapZoom = Math.min(4.5, gmapZoom * 1.25);
      renderGoogleMaps();
    });

    $('#btn-gmaps-zoom-out')?.addEventListener('click', () => {
      gmapZoom = Math.max(0.4, gmapZoom / 1.25);
      renderGoogleMaps();
    });

    $('#btn-gmaps-locate')?.addEventListener('click', () => {
      gmapCenterOn(sim.truck.x, sim.truck.y);
      toast('🎯 Google Maps: центрировано на тягаче');
    });

    $('#btn-gmaps-layer-toggle')?.addEventListener('click', () => {
      gmapLayer = gmapLayer === 'schema' ? 'satellite' : 'schema';
      $('#gmaps-layer-icon').textContent = gmapLayer === 'schema' ? '🛰️' : '🗺️';
      renderGoogleMaps();
      toast(gmapLayer === 'satellite' ? 'Включён слой: Спутниковый снимок' : 'Включён слой: Схема Google Maps');
    });

    $('#btn-gmaps-start-driving')?.addEventListener('click', () => {
      launchDrive();
    });

    // Chips filter navigation
    $$('[data-chip]').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('[data-chip]').forEach(c => c.classList.remove('gmaps-chip-active'));
        chip.classList.add('gmaps-chip-active');

        const type = chip.dataset.chip;
        if (type === 'truck') {
          gmapCenterOn(sim.truck.x, sim.truck.y);
        } else if (type === 'gas') {
          gmapCenterOn(750, -12394); // Rompetrol
          toast('АЗС Rompetrol на трассе M2');
        } else if (type === 'depots') {
          gmapCenterOn(1200, 3000); // Trans-Moldova
          toast('Логистический хаб Trans-Moldova');
        } else if (type === 'peresecina') {
          gmapCenterOn(-400, -8842);
          toast('Серпантин Пересечина');
        } else if (type === 'orhei') {
          gmapCenterOn(1200, -20684);
          toast('Город Орхей (Терминал логистики)');
        } else if (type === 'chisinau') {
          gmapCenterOn(1200, 3000);
          toast('Город Кишинёв');
        }
      });
    });

    $('#btn-gmaps-clear-search')?.addEventListener('click', () => {
      $('#gmaps-search-input').value = '';
    });
  }

  // Navigation Controller
  function navigate(page) {
    if (!['home', 'jobs', 'garage', 'dealer', 'map', 'admin', 'help'].includes(page)) return;
    currentPage = page;

    // Update rail buttons
    for (const btn of $$('.rail-button[data-nav]')) {
      btn.classList.toggle('active', btn.dataset.nav === page);
    }

    // Toggle pages
    for (const section of $$('.page')) {
      const active = section.id === `view-${page}`;
      section.hidden = !active;
      section.classList.toggle('active', active);
    }

    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    // Populate dynamic views
    if (page === 'home') updateHomeView();
    if (page === 'jobs') renderJobMarket();
    if (page === 'garage') renderGarage();
    if (page === 'dealer') renderDealer();
    if (page === 'map') renderWorldMap();
    if (page === 'admin') renderAdminView();
  }

  // Switch to Drive Simulation (Starts driving)
  function launchDrive() {
    isDriving = true;
    audio.unlock();
    audio.init();

    $('#menu-shell').hidden = true;
    $('#drive-screen').hidden = false;
    document.body.style.overflow = 'hidden';

    renderer.resize();
    lastTime = performance.now();
    toast('Вы в кабине тягача. Приятного рейса!');
  }

  // Exit Drive Simulation (Returns to Menu)
  function exitDrive() {
    isDriving = false;
    $('#drive-screen').hidden = true;
    $('#menu-shell').hidden = false;
    document.body.style.overflow = '';

    closeAdminModal();
    navigate('home');
    toast('Рейс приостановлен. Вы вернулись в главное меню.');
  }

  // In-Game Admin Modal Controller
  function openAdminModal() {
    adminModalOpen = true;
    $('#modal-admin').hidden = false;
    renderModalAdminMap();
  }

  function closeAdminModal() {
    adminModalOpen = false;
    $('#modal-admin').hidden = true;
  }

  function toggleAdminModal() {
    if (adminModalOpen) closeAdminModal();
    else openAdminModal();
  }

  // Event Listeners for Shell & Rail
  $$('[data-nav]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.nav);
    });
  });

  $('#start-drive').addEventListener('click', launchDrive);
  $('#btn-back-to-menu').addEventListener('click', exitDrive);
  $('#btn-open-map-drive')?.addEventListener('click', () => {
    exitDrive();
    navigate('map');
  });
  $('#btn-admin-to-drive').addEventListener('click', launchDrive);
  $('#btn-open-admin-drive').addEventListener('click', openAdminModal);
  $('#btn-close-admin-modal').addEventListener('click', closeAdminModal);

  // Sound Toggle
  let soundMuted = false;
  function toggleSound() {
    soundMuted = !soundMuted;
    audio.setMuted(soundMuted);
    const icon = soundMuted ? '#i-muted' : '#i-volume';
    $('#sound-button').innerHTML = `<svg><use href="${icon}"/></svg>`;
    $('#drive-sound-btn').innerHTML = `<svg><use href="${icon}"/></svg>`;
    toast(soundMuted ? 'Звук симулятора выключен' : 'Звук симулятора включён');
  }
  $('#sound-button').addEventListener('click', toggleSound);
  $('#drive-sound-btn').addEventListener('click', toggleSound);

  // Update Home Dashboard
  function updateHomeView() {
    updateWalletDisplays();
    const truck = trucksCatalog.getTruck(profile.currentTruckId);
    safeText('#preview-truck-name', `${truck.brand} ${truck.model}`.toUpperCase());

    if (profile.activeJob && profile.activeJob.cargo) {
      const cargo = profile.activeJob.cargo;
      const cargoName = cargo.nameRu || 'Груз';
      const cargoWeight = typeof cargo.weightKg === 'number' ? (cargo.weightKg / 1000).toFixed(1) : '18.0';
      safeText('#home-cargo-title', `${cargoName} · ${cargoWeight} т`);
      safeText('#home-cargo-route', `Маршрут: ${profile.activeJob.originCity || 'Chișinău'} → ${profile.activeJob.targetCityName || 'Destin'} · ${profile.activeJob.distKm || 40} км`);
      safeText('#home-cargo-reward', `${(profile.activeJob.rewardMdl || 4800).toLocaleString()} MDL`);
      safeText('#drive-job-label', `${profile.activeJob.originCity || 'Chișinău'} → ${profile.activeJob.targetCityName || 'Destin'}: ${cargoName}`);
    } else {
      safeText('#home-cargo-title', 'Нет активного рейса');
      safeText('#home-cargo-route', 'Выберите коммерческий груз на бирже');
      safeText('#home-cargo-reward', '—');
      safeText('#drive-job-label', 'БЕЗ ГРУЗА (Выберите рейс на бирже)');
    }
  }

  // Freight Market (Jobs)
  function startJob(job) {
    profile.activeJob = job;
    sim.forceHitch(true, job.cargo);
    saveProfile();
    updateHomeView();
    toast(`Взят заказ: ${job.cargo.nameRu} в ${job.targetCityName} (${job.rewardMdl.toLocaleString()} MDL)`);
  }

  function renderJobMarket() {
    const container = $('#jobs-grid-container');
    container.innerHTML = '';
    const depots = map.getAllDepots ? map.getAllDepots() : [];
    if (depots.length < 2) return;

    const contracts = [
      { cargo: map.CARGO_CATALOG[0], origin: depots[0], target: depots[1], distKm: 45, reward: 4800 }, // Chișinău -> Orhei
      { cargo: map.CARGO_CATALOG[3] || map.CARGO_CATALOG[0], origin: depots[0], target: depots[2] || depots[1], distKm: 125, reward: 9200 }, // Chișinău -> Bălți
      { cargo: map.CARGO_CATALOG[4] || map.CARGO_CATALOG[0], origin: depots[3] || depots[0], target: depots[0], distKm: 105, reward: 7800 }, // Ungheni -> Chișinău
      { cargo: map.CARGO_CATALOG[2] || map.CARGO_CATALOG[0], origin: depots[2] || depots[0], target: depots[5] || depots[1], distKm: 160, reward: 11500 }, // Bălți -> Hîncești
      { cargo: map.CARGO_CATALOG[1] || map.CARGO_CATALOG[0], origin: depots[1], target: depots[3] || depots[0], distKm: 85, reward: 6400 }, // Orhei -> Ungheni
      { cargo: map.CARGO_CATALOG[5] || map.CARGO_CATALOG[1] || map.CARGO_CATALOG[0], origin: depots[4] || depots[0], target: depots[1], distKm: 110, reward: 8100 }, // Tiraspol -> Orhei
      { cargo: map.CARGO_CATALOG[0], origin: depots[5] || depots[0], target: depots[2] || depots[1], distKm: 155, reward: 11200 }, // Hîncești -> Bălți
      { cargo: map.CARGO_CATALOG[3] || map.CARGO_CATALOG[0], origin: depots[2] || depots[1], target: depots[0], distKm: 125, reward: 9500 } // Bălți -> Chișinău
    ];

    contracts.forEach((item, index) => {
      const isCurrent = profile.activeJob && profile.activeJob.cargo.id === item.cargo.id && profile.activeJob.targetCityName === item.target.cityName;
      const card = document.createElement('div');
      card.className = `job-card ${isCurrent ? 'active-job-card' : ''}`;
      card.innerHTML = `
        <div class="job-card-top">
          <div>
            <div class="cargo-name">${item.cargo.nameRu}</div>
            <div class="cargo-tag">${item.cargo.name} · ${(item.cargo.weightKg / 1000).toFixed(1)} т · ${item.cargo.type.toUpperCase()}</div>
          </div>
          <div class="job-reward">${item.reward.toLocaleString()} MDL</div>
        </div>
        <div class="job-route-line">
          <span>${item.origin.cityName} (${item.origin.name})</span>
          <span class="route-arrow">➔</span>
          <span>${item.target.cityName} (${item.target.name})</span>
        </div>
        <div class="job-card-actions">
          <button class="button ${isCurrent ? 'button-outline' : 'button-lime'} btn-take-job">
            ${isCurrent ? '✓ ТЕКУЩИЙ ЗАКАЗ' : 'ВЗЯТЬ КОНТРАКТ'}
          </button>
          <button class="button button-outline btn-drive-with-job">В КАБИНУ →</button>
        </div>
      `;

      card.querySelector('.btn-take-job').addEventListener('click', () => {
        startJob({
          id: `job-${index}`,
          cargo: item.cargo,
          originCity: item.origin.cityName,
          originDepot: item.origin,
          targetCityName: item.target.cityName,
          targetDepot: item.target,
          rewardMdl: item.reward,
          distKm: item.distKm
        });
        renderJobMarket();
      });

      card.querySelector('.btn-drive-with-job').addEventListener('click', () => {
        startJob({
          id: `job-${index}`,
          cargo: item.cargo,
          originCity: item.origin.cityName,
          originDepot: item.origin,
          targetCityName: item.target.cityName,
          targetDepot: item.target,
          rewardMdl: item.reward,
          distKm: item.distKm
        });
        launchDrive();
      });

      container.appendChild(card);
    });
  }

  // Delivery / Cargo Drop check
  function checkDepotDelivery() {
    if (!profile.activeJob || !profile.activeJob.targetDepot || typeof profile.activeJob.targetDepot.x !== 'number') return;
    const t = sim.truck;
    const target = profile.activeJob.targetDepot;
    const dist = Math.hypot(t.x - target.x, t.y - target.y);

    const promptEl = $('#delivery-prompt');
    if (!promptEl) return;
    if (dist < 120 && Math.abs(sim.currentSpeedKmh) < 5) {
      promptEl.classList.add('active');
      if (sim.truck.parkingBrake) {
        completeJobSuccess();
      }
    } else {
      promptEl.classList.remove('active');
    }
  }

  function completeJobSuccess() {
    if (!profile.activeJob) return;
    const job = profile.activeJob;
    const earned = job.rewardMdl;
    profile.moneyMdl += earned;
    profile.xp += 150;
    profile.totalDeliveries++;
    profile.activeJob = null;
    saveProfile();
    audio.playRelayClick(true);
    toast(`🎉 Рейс завершён! Вы заработали +${earned.toLocaleString()} MDL!`);
    updateHomeView();
    $('#delivery-prompt').classList.remove('active');
  }

  // Garage View
  function renderGarage() {
    const list = $('#garage-cards-list');
    list.innerHTML = '';

    profile.ownedTrucks.forEach(id => {
      const truck = trucksCatalog.getTruck(id);
      if (!truck) return;
      const isCurrent = profile.currentTruckId === id;
      const card = document.createElement('div');
      card.className = `garage-truck-card ${isCurrent ? 'selected' : ''}`;
      card.innerHTML = `
        <div>
          <div style="font: 700 14px var(--mono);">${truck.name}</div>
          <div style="font: 10px var(--body); color: var(--muted);">${truck.brand} · ${truck.powerHp} л.с. · ${truck.axles}</div>
        </div>
        <button class="button ${isCurrent ? 'button-outline' : 'button-lime'}" style="min-height: 36px; padding: 0 14px;">
          ${isCurrent ? 'АКТИВЕН' : 'ВЫБРАТЬ'}
        </button>
      `;

      card.addEventListener('click', () => {
        profile.currentTruckId = id;
        applyActiveTruck();
        saveProfile();
        renderGarage();
        inspectTruck(truck);
      });

      list.appendChild(card);
    });

    inspectTruck(trucksCatalog.getTruck(profile.currentTruckId));
  }

  function inspectTruck(truck) {
    if (!truck) return;
    safeText('#inspect-truck-name', truck.name);
    safeText('#inspect-truck-desc', truck.description);
    const bonusHp = (profile.truckTunings && profile.truckTunings[truck.id]) ? (profile.truckTunings[truck.id].bonusHp || 0) : 0;
    safeText('#inspect-power', `${truck.powerHp + bonusHp} л.с. ${bonusHp ? '(+40 chip)' : ''}`);
    safeText('#inspect-torque', `${truck.torqueNm} Н·м`);
    safeText('#inspect-tank', `${truck.fuelCapacity} л`);
    safeText('#inspect-mass', `${truck.massKg.toLocaleString()} кг`);

    const actBtn = $('#btn-garage-activate');
    if (actBtn) actBtn.onclick = () => launchDrive();

    const tuneBtn = $('#btn-garage-tune');
    if (tuneBtn) {
      tuneBtn.onclick = () => {
        const cost = 15000;
        if (profile.moneyMdl < cost) {
          toast(`Недостаточно средств! Требуется ${cost.toLocaleString()} MDL`, true);
          return;
        }
        profile.moneyMdl -= cost;
        if (!profile.truckTunings) profile.truckTunings = {};
        if (!profile.truckTunings[truck.id]) profile.truckTunings[truck.id] = { bonusHp: 0 };
        profile.truckTunings[truck.id].bonusHp += 40;
        sim.truck.powerHp += 40;
        saveProfile();
        inspectTruck(truck);
        toast(`Чип-тюнинг установлен! Мощность увеличена до ${truck.powerHp + profile.truckTunings[truck.id].bonusHp} л.с.`);
      };
    }
  }

  // Dealership View
  function renderDealer() {
    const grid = $('#dealer-grid-container');
    grid.innerHTML = '';

    trucksCatalog.ALL_TRUCKS.forEach(truck => {
      const owned = profile.ownedTrucks.includes(truck.id);
      const isCurrent = profile.currentTruckId === truck.id;

      const card = document.createElement('div');
      card.className = 'dealer-card';
      card.innerHTML = `
        <div class="dealer-brand">${truck.brand} · ${truck.axles}</div>
        <div class="dealer-model">${truck.model}</div>
        <div class="dealer-price">${owned ? 'УЖЕ В ГАРАЖЕ' : `${truck.priceMdl.toLocaleString()} MDL`}</div>
        <p style="font-size: 11px; color: var(--muted); margin-bottom: 16px; min-height: 38px;">${truck.description}</p>
        <div class="spec-grid">
          <div class="spec-box"><span class="spec-lbl">Мощность</span><strong>${truck.powerHp} л.с.</strong></div>
          <div class="spec-box"><span class="spec-lbl">Крутящий момент</span><strong>${truck.torqueNm} Н·м</strong></div>
          <div class="spec-box"><span class="spec-lbl">Бак</span><strong>${truck.fuelCapacity} л</strong></div>
          <div class="spec-box"><span class="spec-lbl">Масса</span><strong>${(truck.massKg / 1000).toFixed(1)} т</strong></div>
        </div>
        <button class="button ${owned ? (isCurrent ? 'button-outline' : 'button-lime') : 'button-lime'} btn-buy-or-select">
          ${owned ? (isCurrent ? '✓ ЗА РУЛЁМ' : 'СЕСТЬ ЗА РУЛЬ') : `КУПИТЬ ТЯГАЧ`}
        </button>
      `;

      card.querySelector('.btn-buy-or-select').addEventListener('click', () => {
        if (owned) {
          profile.currentTruckId = truck.id;
          applyActiveTruck();
          saveProfile();
          renderDealer();
          toast(`Выбран тягач: ${truck.name}`);
        } else {
          if (profile.moneyMdl < truck.priceMdl) {
            toast(`Недостаточно средств! Требуется ${truck.priceMdl.toLocaleString()} MDL`, true);
            return;
          }
          profile.moneyMdl -= truck.priceMdl;
          profile.ownedTrucks.push(truck.id);
          profile.currentTruckId = truck.id;
          applyActiveTruck();
          saveProfile();
          renderDealer();
          audio.playRelayClick(true);
          toast(`Поздравляем с покупкой! Новый ${truck.name} доставлен в ваш гараж!`);
        }
      });

      grid.appendChild(card);
    });
  }

  // ==============================================================
  // ADMIN PANEL & TELEPORT SUITE
  // ==============================================================

  const TELEPORT_PRESETS = {
    'chisinau-hub': {
      name: 'Кишинёв: База Trans-Moldova',
      x: 750, y: 3150, angle: -1.57, speed: 0,
      desc: 'Центральная база логистики в столице'
    },
    'chisinau-center': {
      name: 'Кишинёв: Проспект Calea Orheiului',
      x: 1200, y: 3000, angle: -1.57, speed: 50,
      desc: 'Выезд из города на трассу M2'
    },
    'centura-chisinau': {
      name: 'Кишинёв: Кольцевая объездная (Centura)',
      x: 1200, y: 1800, angle: 0, speed: 70,
      desc: 'Орбитальная магистраль вокруг Кишинёва'
    },
    'cricova-cloverleaf': {
      name: 'Крикова: Развязка M1 / M2',
      x: 1700, y: -2200, angle: -1.57, speed: 60,
      desc: 'Крупнейший путепровод Молдовы'
    },
    'm2-magdacesti': {
      name: 'Трасса M2: Скоростная прямая (Мэгдачешть)',
      x: 1400, y: -4800, angle: -1.57, speed: 90,
      desc: 'Скоростной замер динамики 0–90 км/ч'
    },
    'm2-serpentine': {
      name: 'Пересечина: Серпантин M2',
      x: -650, y: -11900, angle: -1.45, speed: 45,
      desc: 'Крутые повороты и проверка заноса полуприцепа'
    },
    'm2-gas': {
      name: 'Пересечина: АЗС Rompetrol (Стоянка)',
      x: -650, y: -12800, angle: -1.57, speed: 0,
      desc: 'Парковка дальнобойщиков и заправка'
    },
    'orhei-roundabout': {
      name: 'Орхей: Кольцевая развязка M2 / R14',
      x: 1200, y: -19200, angle: -1.57, speed: 40,
      desc: 'Круговое движение на въезде в Орхей'
    },
    'orhei-hub': {
      name: 'Орхей: Терминал Orhei Logistics',
      x: 1000, y: -20744, angle: 3.14, speed: 0,
      desc: 'Логистический комплекс в Орхее'
    },
    'balti-roundabout': {
      name: 'Бельцы: Кольцевая развязка R14 / M5',
      x: -7500, y: -38000, angle: -1.57, speed: 40,
      desc: 'Южный въезд в северную столицу'
    },
    'balti-hub': {
      name: 'Бельцы: Терминал Agro-Mașini',
      x: -9000, y: -41600, angle: -1.57, speed: 0,
      desc: 'Северный промышленный комплекс'
    },
    'm5-autostrada': {
      name: 'Автомагистраль M5: Бельцы — Кишинёв',
      x: -6500, y: -28000, angle: 1.25, speed: 95,
      desc: 'Скоростная 4-полосная магистраль M5'
    },
    'r1-straseni': {
      name: 'Трасса R1: Страшены (Кодры)',
      x: -6500, y: 2800, angle: 3.14, speed: 85,
      desc: 'Живописная трасса сквозь заповедник Кодры'
    },
    'r1-calarasi': {
      name: 'Трасса R1: Калараш',
      x: -14000, y: 3200, angle: 3.14, speed: 70,
      desc: 'Винно-коньячный край Молдовы'
    },
    'ungheni-terminal': {
      name: 'Унгены: Таможенный терминал (Река Прут)',
      x: -30400, y: 2300, angle: 3.14, speed: 0,
      desc: 'Западный хаб на границе с Румынией'
    },
    'm1-dubasari': {
      name: 'Трасса M1: Дубоссары (Река Днестр)',
      x: 10500, y: -2700, angle: 0.05, speed: 80,
      desc: 'Мост через Днестр и восточный терминал'
    },
    'r2-tiraspol': {
      name: 'Тирасполь: Промышленный терминал',
      x: 17900, y: 6500, angle: 0.2, speed: 0,
      desc: 'Восточный логистический хаб на Днестре'
    },
    'm3-hincesti': {
      name: 'Хынчешты: Винзавод Vit-Agro',
      x: -2500, y: 20200, angle: 1.45, speed: 0,
      desc: 'Юго-западный винодельческий центр'
    }
  };

  function executeTeleport(x, y, angle = null, speedKmh = 0, label = '') {
    sim.teleport(x, y, angle, speedKmh);
    const msg = `📍 Телепортирован в ${label || `X: ${Math.round(x)}, Y: ${Math.round(y)}`}${speedKmh > 0 ? ` (${speedKmh} км/ч)` : ''}`;
    toast(msg);
    safeText('#admin-status-text', msg);

    selectedTargetCoord = { x, y };
    safeText('#admin-selected-coords', `X: ${Math.round(x)} · Y: ${Math.round(y)} (${label || 'Пользовательская точка'})`);
    if ($('#admin-input-x')) $('#admin-input-x').value = Math.round(x);
    if ($('#admin-input-y')) $('#admin-input-y').value = Math.round(y);

    renderAdminMap();
    renderModalAdminMap();
    renderGoogleMaps();
  }

  // Draw Admin Map Canvas
  function drawHighwayAdminMap(canvasEl, showTarget = true) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const cw = canvasEl.width;
    const ch = canvasEl.height;

    // Dark cyber terrain
    ctx.fillStyle = '#080d10';
    ctx.fillRect(0, 0, cw, ch);

    // Subtle coordinate grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < cw; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    }
    for (let y = 0; y < ch; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    // Projection for Full Republic of Moldova Country Map
    const projectAdmin = (wx, wy) => {
      const padX = 45, padY = 25;
      const cx = padX + ((wx - (-32000)) / 52000) * (cw - 2 * padX);
      const cy = padY + ((wy - (-44000)) / 66000) * (ch - 2 * padY);
      return { cx, cy };
    };

    // Draw Country Borders
    const geo = map.GEOGRAPHY;
    if (geo && geo.moldovaBorder) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      geo.moldovaBorder.forEach((p, i) => {
        const { cx, cy } = projectAdmin(p.x, p.y);
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw ALL Road Splines from map.ROADS
    if (map.ROADS) {
      map.ROADS.forEach(road => {
        const pts = road.dense || road.points;
        if (!pts || pts.length < 2) return;
        const isHighway = road.category === 'highway';

        ctx.strokeStyle = isHighway ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = isHighway ? 8 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach((p, i) => {
          const { cx, cy } = projectAdmin(p.x, p.y);
          if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        });
        ctx.stroke();

        ctx.strokeStyle = isHighway ? '#f59e0b' : '#64748b';
        ctx.lineWidth = isHighway ? 4 : 2;
        ctx.stroke();
      });
    }

    // Draw Preset Landmarks
    Object.entries(TELEPORT_PRESETS).forEach(([key, pt]) => {
      const { cx, cy } = projectAdmin(pt.x, pt.y);
      ctx.fillStyle = key.includes('hub') || key.includes('ramp') ? '#55e6c3' : key.includes('gas') ? '#fbbc05' : '#f39c12';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Major Cities
    map.CITIES.filter(c => c.rank === 1).forEach(c => {
      const { cx, cy } = projectAdmin(c.x, c.y);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Roboto, monospace';
      ctx.fillText(c.nameRu.toUpperCase(), cx + 6, cy + 3);
    });

    // Selected Crosshair
    if (showTarget && selectedTargetCoord) {
      const target = projectAdmin(selectedTargetCoord.x, selectedTargetCoord.y);
      ctx.strokeStyle = '#EA4335';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(target.cx, target.cy, 9, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(target.cx - 14, target.cy); ctx.lineTo(target.cx + 14, target.cy);
      ctx.moveTo(target.cx, target.cy - 14); ctx.lineTo(target.cx, target.cy + 14);
      ctx.stroke();
    }

    // Draw Truck Live Position
    const truckPos = projectAdmin(sim.truck.x, sim.truck.y);
    ctx.fillStyle = '#34A853';
    ctx.shadowColor = '#34A853';
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.arc(truckPos.cx, truckPos.cy, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#81c995';
    ctx.font = 'bold 9px Consolas, monospace';
    ctx.fillText(`🚚 ${sim.currentSpeedKmh} км/ч`, truckPos.cx + 8, truckPos.cy - 4);
  }

  function renderAdminView() {
    renderAdminMap();
  }

  function renderAdminMap() {
    const canvas = $('#admin-map-canvas');
    drawHighwayAdminMap(canvas, true);
  }

  function renderModalAdminMap() {
    const canvas = $('#modal-map-canvas');
    drawHighwayAdminMap(canvas, true);
  }

  // Click-To-Teleport on Admin Canvas
  function attachAdminMapClickHandler(canvasEl, isModal = false) {
    if (!canvasEl) return;
    canvasEl.addEventListener('click', e => {
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = canvasEl.width / rect.width;
      const scaleY = canvasEl.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const padX = 45, padY = 25;
      const wx = -32000 + ((cx - padX) / (canvasEl.width - 2 * padX)) * 52000;
      const wy = -44000 + ((cy - padY) / (canvasEl.height - 2 * padY)) * 66000;
      const instant = $('#admin-instant-teleport-toggle')?.checked ?? true;

      selectedTargetCoord = { x: wx, y: wy };
      safeText('#admin-selected-coords', `X: ${Math.round(wx)} · Y: ${Math.round(wy)}`);
      if ($('#admin-input-x')) $('#admin-input-x').value = Math.round(wx);
      if ($('#admin-input-y')) $('#admin-input-y').value = Math.round(wy);

      if (instant) {
        executeTeleport(wx, wy, null, 0, `Точка карты (X: ${Math.round(wx)}, Y: ${Math.round(wy)})`);
      } else {
        renderAdminMap();
        renderModalAdminMap();
        toast(`Выбрана точка: X: ${Math.round(wx)}, Y: ${Math.round(wy)}. Нажмите «Телепортироваться»`);
      }
    });

    canvasEl.addEventListener('mousemove', e => {
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = canvasEl.width / rect.width;
      const scaleY = canvasEl.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      const padX = 45, padY = 25;
      const wx = -32000 + ((cx - padX) / (canvasEl.width - 2 * padX)) * 52000;
      const wy = -44000 + ((cy - padY) / (canvasEl.height - 2 * padY)) * 66000;

      const label = `Курсор: X ${Math.round(wx)} · Y ${Math.round(wy)} (Клик для телепорта)`;
      const infoEl = isModal ? $('#modal-map-coords') : $('#admin-map-info');
      if (infoEl) infoEl.textContent = label;
    });
  }

  attachAdminMapClickHandler($('#admin-map-canvas'), false);
  attachAdminMapClickHandler($('#modal-map-canvas'), true);

  // Button: Teleport to Selected Target
  $('#btn-teleport-target')?.addEventListener('click', () => {
    if (selectedTargetCoord) {
      executeTeleport(selectedTargetCoord.x, selectedTargetCoord.y, null, 0);
    }
  });

  // Preset Buttons
  $$('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.preset;
      const pt = TELEPORT_PRESETS[key];
      if (!pt) return;
      executeTeleport(pt.x, pt.y, pt.angle, pt.speed, pt.name);
    });
  });

  // Manual Coordinates Teleport
  $('#btn-teleport-custom')?.addEventListener('click', () => {
    const x = parseFloat($('#admin-input-x').value) || 1200;
    const y = parseFloat($('#admin-input-y').value) || 3000;
    const angle = parseFloat($('#admin-input-angle').value);
    const speed = parseFloat($('#admin-input-speed').value) || 0;
    executeTeleport(x, y, angle, speed, 'Ручной ввод координат');
  });

  // Vehicle Cheats and Tools
  $$('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      switch (action) {
        case 'repair':
          sim.repairAll();
          toast('🔧 Тягач и груз полностью отремонтированы (0% урона)!');
          break;
        case 'refuel':
          sim.refuelFull();
          toast('⛽ Топливный бак заправлен до 100% (600 L)!');
          break;
        case 'air':
          sim.restoreAir();
          toast('💨 Пневмосистема накачана до 10.0 bar!');
          break;
        case 'toggle-trailer':
          sim.forceHitch(!sim.trailer.attached);
          toast(sim.trailer.attached ? '🚛 Полуприцеп сочленён с седлом!' : '🚛 Полуприцеп отцеплен!');
          break;
        case 'boost':
          sim.setImpulseSpeed(80);
          toast('🚀 Импульс скорости 80 км/ч активирован!');
          break;
        case 'stop':
          sim.setImpulseSpeed(0);
          sim.truck.parkingBrake = true;
          toast('🛑 Экстренная остановка (0 км/ч, ручник включён)');
          break;
        case 'turn-180':
          sim.reverseTruckDirection();
          toast('🔄 Разворот автопоезда на 180° выполнен!');
          break;
        case 'change-cargo':
          const catalog = map.CARGO_CATALOG;
          const curIndex = catalog.findIndex(c => profile.activeJob?.cargo.id === c.id);
          const nextCargo = catalog[(curIndex + 1) % catalog.length];
          sim.forceHitch(true, nextCargo);
          if (profile.activeJob) profile.activeJob.cargo = nextCargo;
          saveProfile();
          toast(`📦 Установлен новый груз: ${nextCargo.nameRu} (${(nextCargo.weightKg / 1000).toFixed(1)} т)`);
          updateHomeView();
          break;
        case 'money-50k':
          profile.moneyMdl += 50000;
          saveProfile();
          toast('💰 Начислено +50 000 MDL!');
          break;
        case 'money-250k':
          profile.moneyMdl += 250000;
          saveProfile();
          toast('💎 Начислено +250 000 MDL!');
          break;
        case 'unlock-all-trucks':
          trucksCatalog.ALL_TRUCKS.forEach(t => {
            if (!profile.ownedTrucks.includes(t.id)) profile.ownedTrucks.push(t.id);
          });
          saveProfile();
          renderGarage();
          renderDealer();
          toast('🏆 Все 6 тягачей разблокированы в вашем гараже!');
          break;
        case 'complete-job':
          completeJobSuccess();
          break;
      }
      renderAdminMap();
      renderModalAdminMap();
      renderGoogleMaps();
    });
  });

  // ==============================================================
  // KEYBOARD INPUT SYSTEM
  // ==============================================================

  const keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    reverse: false
  };

  window.addEventListener('keydown', e => {
    audio.unlock();

    // Hotkey: F1 or Tilde (~) opens Admin Panel in any mode
    if (e.code === 'F1' || e.code === 'Backquote') {
      e.preventDefault();
      if (isDriving) {
        toggleAdminModal();
      } else {
        navigate('admin');
      }
      return;
    }

    // Hotkey: M opens Google Maps Navigation
    if (e.code === 'KeyM') {
      e.preventDefault();
      if (isDriving) {
        exitDrive();
      }
      navigate('map');
      return;
    }

    // Escape handling
    if (e.code === 'Escape') {
      if (adminModalOpen) {
        closeAdminModal();
        return;
      }
      if (isDriving) {
        exitDrive();
        return;
      }
      navigate('home');
      return;
    }

    // Only process driving controls when in drive screen
    if (!isDriving) return;
    if (e.repeat) return;

    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.up = true; break;
      case 'KeyS': case 'ArrowDown': keys.down = true; break;
      case 'KeyA': case 'ArrowLeft': keys.left = true; break;
      case 'KeyD': case 'ArrowRight': keys.right = true; break;
      case 'KeyR':
        sim.truck.gear = sim.truck.gear === -1 ? 1 : -1;
        keys.reverse = sim.truck.gear === -1;
        toast(keys.reverse ? 'Передача: ЗАДНИЙ ХОД [R]' : 'Передача: ВПЕРЁД [D]');
        break;
      case 'KeyT':
        const res = sim.toggleHitch();
        toast(res.msg, !res.ok);
        break;
      case 'KeyL':
        sim.truck.lights = (sim.truck.lights + 1) % 3;
        const lightLabels = ['Фары ВЫКЛ', 'Ближний свет', 'Дальний свет'];
        toast(lightLabels[sim.truck.lights]);
        break;
      case 'KeyQ':
        sim.truck.turnSignal = (sim.truck.turnSignal === -1) ? 0 : -1;
        break;
      case 'KeyE':
        sim.truck.turnSignal = (sim.truck.turnSignal === 1) ? 0 : 1;
        break;
      case 'KeyF':
        sim.truck.turnSignal = (sim.truck.turnSignal === 2) ? 0 : 2;
        break;
      case 'KeyH':
        sim.truck.horn = true;
        break;
      case 'Space':
        sim.truck.parkingBrake = !sim.truck.parkingBrake;
        toast(sim.truck.parkingBrake ? 'Стояночный тормоз ВКЛ' : 'Стояночный тормоз СНЯТ');
        break;
    }
  });

  window.addEventListener('keyup', e => {
    if (!isDriving) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.up = false; break;
      case 'KeyS': case 'ArrowDown': keys.down = false; break;
      case 'KeyA': case 'ArrowLeft': keys.left = false; break;
      case 'KeyD': case 'ArrowRight': keys.right = false; break;
      case 'KeyH': sim.truck.horn = false; break;
    }
  });

  // HUD Update with Google Maps Navigation Theme
  function updateHUD() {
    const t = sim.truck;
    const r = sim.trailer;

    // Digital Speedometer & Gear
    $('#hud-speed').textContent = sim.currentSpeedKmh;
    $('#hud-gear').textContent = t.gear === -1 ? 'R' : `D${t.gear}`;

    // Speed limit
    const speedLimitEl = $('#hud-speed-limit');
    speedLimitEl.textContent = `${sim.speedLimit}`;
    speedLimitEl.classList.toggle('overspeed', sim.currentSpeedKmh > sim.speedLimit + 5);

    // Fuel & Odometer
    $('#hud-fuel').textContent = `${Math.round(t.fuel)} L`;
    $('#hud-odometer').textContent = `${t.odometer.toFixed(1)} km`;

    // Pressure & Damage
    $('#hud-air').textContent = `${t.airPressure.toFixed(1)} bar`;
    $('#hud-truck-damage').textContent = `${Math.round(t.damage)}%`;
    $('#hud-cargo-damage').textContent = `${Math.round(r.cargoDamage)}%`;

    // Turn Signals & Indicators
    $('#ind-left').classList.toggle('active', (t.turnSignal === -1 || t.turnSignal === 2) && renderer.turnBlinkOn);
    $('#ind-right').classList.toggle('active', (t.turnSignal === 1 || t.turnSignal === 2) && renderer.turnBlinkOn);
    $('#ind-lights').classList.toggle('active', t.lights > 0);
    $('#ind-lights').textContent = t.lights === 2 ? 'HIGH' : t.lights === 1 ? 'LOW' : 'OFF';
    $('#ind-trailer').classList.toggle('active', r.attached);
    $('#ind-trailer').textContent = r.attached ? 'TRAILER: ON' : 'NO TRAILER';
    $('#ind-park').classList.toggle('active', t.parkingBrake);

    // GPS Navigation & ETA Calculations (Real OSM Graph & A* Route)
    if (profile.activeJob && profile.activeJob.targetDepot && typeof profile.activeJob.targetDepot.x === 'number') {
      const target = profile.activeJob.targetDepot;
      let route = null;
      if (map.findRoute) {
        route = map.findRoute(t, target);
      }
      const distKm = route ? (route.totalDistKm).toFixed(1) : Math.max(0.1, (Math.hypot(target.x - t.x, target.y - t.y) / 526.3)).toFixed(1);
      const estMinutes = route ? route.totalEstMinutes : Math.max(1, Math.round((distKm / 75) * 60));

      const nextEdge = route && route.edges && route.edges[0];
      const roadRef = nextEdge ? (nextEdge.ref || nextEdge.name || 'M2') : 'M2';

      safeText('#hud-turn-dist', `${distKm} км`);
      safeText('#hud-turn-icon', distKm < 0.8 ? '↱' : '⬆');
      safeText('#hud-nav-dest', distKm < 0.8 ? `Поворот на ${target.name}` : `Следуйте по ${roadRef} к ${profile.activeJob.targetCityName || target.name}`);
      safeText('#hud-nav-dist', `${distKm} км`);
      safeText('#hud-eta-time', `${estMinutes} мин`);

      // Calculate arrival clock
      const now = new Date();
      now.setMinutes(now.getMinutes() + estMinutes);
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      safeText('#hud-eta-clock', timeStr);

      // Update world map bottom ETA bar too
      safeText('#gmaps-eta-time', `${estMinutes} мин`);
      safeText('#gmaps-eta-distance', `${distKm} км`);
      safeText('#gmaps-eta-arrival', `Прибытие в ${timeStr}`);
    } else {
      safeText('#hud-turn-dist', '—');
      safeText('#hud-turn-icon', '—');
      safeText('#hud-nav-dest', 'Нет активного рейса (Биржа грузов)');
      safeText('#hud-nav-dist', '—');
      safeText('#hud-eta-time', '—');
      safeText('#hud-eta-clock', '—');
    }

    safeText('#topbar-status-text', isDriving ? 'В РЕЙСЕ' : 'НА СТОЯНКЕ');
  }

  // Set default starter job if none or ensure trailer hitched
  if (!profile.activeJob) {
    const depots = map.getAllDepots ? map.getAllDepots() : [];
    if (depots.length >= 2) {
      profile.activeJob = {
        id: 'starter-job',
        cargo: map.CARGO_CATALOG[0],
        originCity: 'Chișinău',
        originDepot: depots[0],
        targetCityName: 'Orhei',
        targetDepot: depots[1],
        rewardMdl: 4800,
        distKm: 45
      };
      sim.forceHitch(true, profile.activeJob.cargo);
    }
  } else if (!sim.trailer.attached && profile.activeJob.cargo) {
    sim.forceHitch(true, profile.activeJob.cargo);
  }

  // ==============================================================
  // MAIN ANIMATION & SIMULATION LOOP
  // ==============================================================
  let lastTime = performance.now();
  let previewTime = 0;

  function gameLoop(now) {
    try {
      const dt = Math.max(0.001, Math.min(0.05, (now - lastTime) / 1000));
      lastTime = now;
      gmapPulseTimer += dt;

      if (isDriving) {
        // 1. Driving Physics & Simulation
        const input = {
          throttle: keys.up ? 1 : 0,
          brake: (keys.down || sim.truck.parkingBrake) ? 1 : 0,
          steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
          reverse: sim.truck.gear === -1
        };

        sim.update(dt, input);
        audio.update(sim, dt);
        checkDepotDelivery();
        renderer.render(sim, dt);
        updateHUD();

        // If modal admin is open while driving, keep live marker updated
        if (adminModalOpen) renderModalAdminMap();
      } else {
        // 2. Main Menu: Render Hero Showcase Preview Canvas
        if (currentPage === 'home' && previewCanvas) {
          previewTime += dt;
          const currentModel = trucksCatalog.getTruck(profile.currentTruckId);
          renderer.renderPreview(previewCanvas, currentModel, sim.trailer, previewTime);
        }
        // If on Google Maps tab, re-render animated pulse
        if (currentPage === 'map' && worldMapCanvas) {
          renderGoogleMaps();
        }
      }
    } catch (err) {
      console.error('ETS2 gameLoop frame error:', err);
    }

    requestAnimationFrame(gameLoop);
  }

  // Initial Boot
  setupGoogleMapsInteractions();
  saveProfile();
  navigate('home');
  requestAnimationFrame(gameLoop);
})();
