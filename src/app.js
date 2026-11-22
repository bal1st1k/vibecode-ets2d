/*! 2D ETS2 Moldova Edition | Main Application Controller & Shell | Google Maps Navigation Edition */
(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const elCache = new Map();
  const safeText = (sel, text) => {
    let el = typeof sel === 'string' ? elCache.get(sel) : sel;
    if (!el && typeof sel === 'string') {
      el = document.querySelector(sel);
      if (el) elCache.set(sel, el);
    }
    const str = String(text);
    if (el && el.textContent !== str) el.textContent = str;
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
  if (typeof window !== 'undefined') {
    window.sim = sim;
    window.renderer = renderer;
    window.executeTeleport = executeTeleport;
  }
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

  if (typeof window !== 'undefined') {
    window.profile = profile;
    window.saveProfile = saveProfile;
    window.launchDrive = launchDrive;
    window.exitDrive = exitDrive;
    window.navigate = navigate;
    window.renderDealer = renderDealer;
    window.renderJobMarket = renderJobMarket;
    window.renderGoogleMaps = renderGoogleMaps;
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

  // Cached tier buckets for road batch rendering
  let gmapTierBuckets = null;
  let gmapTierSourceEdges = null;

  function getGmapTierBuckets(osmEdges) {
    if (gmapTierBuckets && gmapTierSourceEdges === osmEdges) {
      return gmapTierBuckets;
    }
    const tiers = [[], [], [], [], []]; // 0: motorway, 1: trunk, 2: primary, 3: secondary, 4: tertiary/other
    for (let i = 0; i < osmEdges.length; i++) {
      const e = osmEdges[i];
      const rc = e.roadClass;
      if (rc === 'motorway' || rc === 'motorway_link') {
        tiers[0].push(e);
      } else if (rc === 'trunk' || rc === 'trunk_link') {
        tiers[1].push(e);
      } else if (rc === 'primary' || rc === 'primary_link') {
        tiers[2].push(e);
      } else if (rc === 'secondary' || rc === 'secondary_link') {
        tiers[3].push(e);
      } else {
        tiers[4].push(e);
      }
    }
    gmapTierBuckets = tiers;
    gmapTierSourceEdges = osmEdges;
    return tiers;
  }

  // Cached A* Navigation Route for Google Maps Viewport
  let gmapCachedRoute = null;
  let gmapCachedTargetId = null;
  let gmapCachedTruckX = null;
  let gmapCachedTruckY = null;

  function getCachedGmapRoute() {
    if (!profile.activeJob || !profile.activeJob.targetDepot || !map.findRoute) {
      gmapCachedRoute = null;
      gmapCachedTargetId = null;
      gmapCachedTruckX = null;
      gmapCachedTruckY = null;
      return null;
    }
    const target = profile.activeJob.targetDepot;
    const targetId = target.id || `${target.x},${target.y}`;
    const t = sim.truck;
    const DIST_RECALC_THRESHOLD = 60; // 60 px ~ 48 m in 1:8 scale

    if (
      gmapCachedRoute &&
      gmapCachedTargetId === targetId &&
      gmapCachedTruckX !== null &&
      gmapCachedTruckY !== null &&
      Math.hypot(t.x - gmapCachedTruckX, t.y - gmapCachedTruckY) <= DIST_RECALC_THRESHOLD
    ) {
      return gmapCachedRoute;
    }

    gmapCachedRoute = map.findRoute(t, target);
    gmapCachedTargetId = targetId;
    gmapCachedTruckX = t.x;
    gmapCachedTruckY = t.y;
    return gmapCachedRoute;
  }

  // Helper for map boundaries from OSM meta.bounds
  function getMapBounds() {
    return (map.OSM && map.OSM.meta && map.OSM.meta.bounds)
      ? map.OSM.meta.bounds
      : [-87580, -84310, 58012, 93884];
  }

  // Project World coordinates to Map Canvas (North is UP!)
  function worldToGmap(wx, wy, cw, ch) {
    const b = getMapBounds();
    const boundW = b[2] - b[0];
    const centerX = (b[0] + b[2]) * 0.5;
    const centerY = (b[1] + b[3]) * 0.5;
    // Fit to bounds: country occupies entire width of canvas container
    const baseScale = cw / boundW;
    const s = baseScale * gmapZoom;
    const cx = (cw * 0.5) + (wx - centerX) * s + gmapPanX;
    const cy = (ch * 0.5) + (wy - centerY) * s + gmapPanY;
    return { cx, cy, scale: s };
  }

  // Inverse project Map Canvas coordinates to World
  function gmapToWorld(cx, cy, cw, ch) {
    const b = getMapBounds();
    const boundW = b[2] - b[0];
    const centerX = (b[0] + b[2]) * 0.5;
    const centerY = (b[1] + b[3]) * 0.5;
    const baseScale = cw / boundW;
    const s = baseScale * gmapZoom;
    const wx = centerX + (cx - (cw * 0.5) - gmapPanX) / s;
    const wy = centerY + (cy - (ch * 0.5) - gmapPanY) / s;
    return { wx, wy };
  }

  // Center Map viewport on specific world coordinates
  function gmapCenterOn(wx, wy) {
    const canvas = worldMapCanvas;
    if (!canvas) return;
    const cw = canvas.width || 900;
    const ch = canvas.height || 520;
    const b = getMapBounds();
    const boundW = b[2] - b[0];
    const centerX = (b[0] + b[2]) * 0.5;
    const centerY = (b[1] + b[3]) * 0.5;
    const baseScale = cw / boundW;
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
    const targetW = Math.floor(rect.width || 900);
    const targetH = Math.floor(rect.height || 520);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const cw = canvas.width;
    const ch = canvas.height;

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

    const b = getMapBounds();
    const boundW = b[2] - b[0];
    const centerX = (b[0] + b[2]) * 0.5;
    const centerY = (b[1] + b[3]) * 0.5;
    const baseScale = cw / boundW;
    const s = baseScale * gmapZoom;

    const osmEdges = (map.OSM && map.OSM.edges) ? map.OSM.edges : null;

    if (osmEdges && osmEdges.length > 0) {
      const buckets = getGmapTierBuckets(osmEdges);
      const tierConfig = [
        { casingColor: '#78350f', casingW: Math.max(4.5, 14.0 * s), coreColor: '#f59e0b', coreW: Math.max(3.2, 10.5 * s) },
        { casingColor: '#0369a1', casingW: Math.max(4.0, 12.0 * s), coreColor: '#38bdf8', coreW: Math.max(2.8, 9.0 * s) },
        { casingColor: '#064e3b', casingW: Math.max(2.8, 8.5 * s), coreColor: '#10b981', coreW: Math.max(2.0, 6.0 * s) },
        { casingColor: '#334155', casingW: Math.max(2.2, 6.5 * s), coreColor: '#94a3b8', coreW: Math.max(1.6, 4.8 * s) },
        { casingColor: '#1e293b', casingW: Math.max(1.5, 3.2 * s), coreColor: '#334155', coreW: Math.max(1.0, 2.0 * s) }
      ];

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Pass 1: Road Casings (batched by tier, lowest tier to highest)
      for (let tIdx = 4; tIdx >= 0; tIdx--) {
        const bucket = buckets[tIdx];
        if (!bucket || bucket.length === 0) continue;
        const cfg = tierConfig[tIdx];

        ctx.strokeStyle = cfg.casingColor;
        ctx.lineWidth = cfg.casingW;
        ctx.beginPath();
        let hasPaths = false;

        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          const eb = e.bounds;
          if (eb[0] > viewMaxX || eb[2] < viewMinX || eb[1] > viewMaxY || eb[3] < viewMinY) continue;

          const pts = e.points;
          for (let p = 0; p < pts.length; p++) {
            const cx = (cw * 0.5) + (pts[p][0] - centerX) * s + gmapPanX;
            const cy = (ch * 0.5) + (pts[p][1] - centerY) * s + gmapPanY;
            if (p === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
          }
          hasPaths = true;
        }

        if (hasPaths) {
          ctx.stroke();
        }
      }

      // Pass 2: Road Cores (batched by tier, lowest tier to highest)
      for (let tIdx = 4; tIdx >= 0; tIdx--) {
        const bucket = buckets[tIdx];
        if (!bucket || bucket.length === 0) continue;
        const cfg = tierConfig[tIdx];

        ctx.strokeStyle = cfg.coreColor;
        ctx.lineWidth = cfg.coreW;
        ctx.beginPath();
        let hasPaths = false;

        for (let i = 0; i < bucket.length; i++) {
          const e = bucket[i];
          const eb = e.bounds;
          if (eb[0] > viewMaxX || eb[2] < viewMinX || eb[1] > viewMaxY || eb[3] < viewMinY) continue;

          const pts = e.points;
          for (let p = 0; p < pts.length; p++) {
            const cx = (cw * 0.5) + (pts[p][0] - centerX) * s + gmapPanX;
            const cy = (ch * 0.5) + (pts[p][1] - centerY) * s + gmapPanY;
            if (p === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
          }
          hasPaths = true;
        }

        if (hasPaths) {
          ctx.stroke();
        }
      }
    }

    // 5. Active Dijkstra / A* Navigation Route (Cached)
    const currentNavRoute = getCachedGmapRoute();

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
      ctx.setLineDash([12 * Math.min(2, Math.max(0.8, gmapZoom)), 16 * Math.min(2, Math.max(0.8, gmapZoom))]);
      ctx.lineDashOffset = -(gmapPulseTimer * 40);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Update bottom ETA panel real data / hide without active route
    // Requirement 5: "Панель «Трасса M2 (45 км) / 34 мин» должна показывать реальные данные: длину и время активного маршрута из A*, а без маршрута скрываться."
    const navFooter = document.querySelector('#gmaps-navigation-footer');
    if (currentNavRoute && currentNavRoute.found && currentNavRoute.polyline && currentNavRoute.polyline.length >= 2) {
      if (navFooter) navFooter.hidden = false;
      const distKm = (currentNavRoute.totalDistKm).toFixed(1);
      const estMinutes = currentNavRoute.totalEstMinutes;
      const primaryRef = currentNavRoute.edges.find(e => e.ref)?.ref || 'M2';
      safeText('#gmaps-eta-time', `${estMinutes} мин`);
      safeText('#gmaps-eta-distance', `${distKm} км`);
      const now = new Date();
      now.setMinutes(now.getMinutes() + estMinutes);
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      safeText('#gmaps-eta-arrival', `Прибытие в ${timeStr}`);
      safeText('#gmaps-eta-route-name', `Трасса ${primaryRef} (${distKm} км) / ${estMinutes} мин`);
    } else {
      if (navFooter) navFooter.hidden = true;
    }

    // 6. Label Placement with Collision Detection
    // Requirement 1: "Дальний зум: только города с population > 50000 и номера трасс M*/R*. Средний: города/посёлки покрупнее. Ближний: все. Если подпись пересекается с уже нарисованной, пропускай её."
    const placedBoxes = [];
    function hasCollision(box) {
      for (let i = 0; i < placedBoxes.length; i++) {
        const o = placedBoxes[i];
        if (box.x1 < o.x2 && box.x2 > o.x1 && box.y1 < o.y2 && box.y2 > o.y1) {
          return true;
        }
      }
      return false;
    }

    const isFarZoom = gmapZoom <= 1.25;
    const isMidZoom = gmapZoom > 1.25 && gmapZoom <= 2.2;
    const isCloseZoom = gmapZoom > 2.2;

    // A. Priority 1: Cities & Settlements
    const allCities = [...(map.CITIES || [])];
    allCities.sort((a, b) => {
      const aCap = a.nameRu === 'Кишинёв' || a.nameRo === 'Chișinău';
      const bCap = b.nameRu === 'Кишинёв' || b.nameRo === 'Chișinău';
      if (aCap) return -1;
      if (bCap) return 1;
      return (b.population || 0) - (a.population || 0);
    });

    for (const city of allCities) {
      const isCapital = city.nameRu === 'Кишинёв' || city.nameRo === 'Chișinău';
      const pop = city.population || 0;

      // Filter by LOD zoom level
      if (isFarZoom) {
        if (!isCapital && pop <= 50000) continue;
      } else if (isMidZoom) {
        if (!isCapital && pop < 10000 && city.place !== 'city' && city.place !== 'town') continue;
      }

      const { cx, cy } = worldToGmap(city.x, city.y, cw, ch);
      if (cx < -40 || cx > cw + 40 || cy < -40 || cy > ch + 40) continue;

      const isMajor = isCapital || pop > 30000 || city.place === 'city';
      const labelText = city.nameRu || city.name || city.nameRo;
      const fontSize = isCapital ? 13 : isMajor ? 11 : 9;
      const fontWeight = isCapital ? '700' : isMajor ? '600' : '500';
      ctx.font = `${fontWeight} ${fontSize}px Roboto, sans-serif`;
      const tw = ctx.measureText(labelText).width;
      const dr = isCapital ? 6 : isMajor ? 4.5 : 3;

      const box = {
        x1: cx - dr - 3,
        y1: cy - fontSize,
        x2: cx + dr + 8 + tw + 3,
        y2: cy + 6
      };

      if (hasCollision(box)) continue; // Collision detected -> skip!
      placedBoxes.push(box);

      // Draw City Dot
      ctx.fillStyle = isCapital ? '#f59e0b' : '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, dr * Math.min(1.3, Math.max(0.8, gmapZoom)), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#202124';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw City Label
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.strokeText(labelText, cx + dr + 6, cy + 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, cx + dr + 6, cy + 4);
    }

    // B. Priority 2: Road Shields
    if (osmEdges) {
      const drawnShields = new Set();
      const shieldStep = isFarZoom ? 18 : isMidZoom ? 12 : 8;

      for (let i = 0; i < osmEdges.length; i += shieldStep) {
        const e = osmEdges[i];
        if (!e.ref || e.points.length < 2 || drawnShields.has(e.ref)) continue;

        const isM = e.ref.startsWith('M');
        const isR = e.ref.startsWith('R');

        // LOD filter: far & mid zoom only show M* and R*
        if (isFarZoom || isMidZoom) {
          if (!isM && !isR) continue;
        }

        const midP = e.points[Math.floor(e.points.length / 2)];
        if (midP[0] < viewMinX || midP[0] > viewMaxX || midP[1] < viewMinY || midP[1] > viewMaxY) continue;

        const { cx, cy } = worldToGmap(midP[0], midP[1], cw, ch);
        if (cx < 20 || cx > cw - 20 || cy < 20 || cy > ch - 20) continue;

        const sFactor = Math.min(1.2, Math.max(0.8, gmapZoom));
        const isWide = e.ref.length > 3;
        const sw = (isWide ? 40 : 28) * sFactor;
        const sh2 = 16 * sFactor;

        const shieldBox = {
          x1: cx - sw * 0.5 - 3,
          y1: cy - sh2 * 0.5 - 3,
          x2: cx + sw * 0.5 + 3,
          y2: cy + sh2 * 0.5 + 3
        };

        if (hasCollision(shieldBox)) continue; // Overlap detected -> skip!

        drawnShields.add(e.ref);
        placedBoxes.push(shieldBox);

        // Draw Shield
        ctx.fillStyle = isM ? '#1b5e20' : '#b71c1c';
        ctx.beginPath();
        ctx.roundRect(cx - sw * 0.5, cy - sh2 * 0.5, sw, sh2, 3);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(9 * sFactor)}px Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(e.ref, cx, cy + sh2 * 0.22);
        ctx.textAlign = 'left';
      }
    }

    // C. Priority 3: Freight Logistics Depots & Terminals
    const allDepots = map.getAllDepots ? map.getAllDepots() : (map.DEPOTS || []);
    if (gmapZoom >= 0.7) {
      for (const depot of allDepots) {
        const { cx, cy } = worldToGmap(depot.x, depot.y, cw, ch);
        if (cx < 10 || cx > cw - 10 || cy < 10 || cy > ch - 10) continue;

        ctx.font = 'bold 10px Roboto, sans-serif';
        const tw = isCloseZoom ? ctx.measureText(depot.name).width : 0;
        const box = {
          x1: cx - 8,
          y1: cy - 10,
          x2: cx + (isCloseZoom ? 14 + tw : 8),
          y2: cy + 10
        };

        if (hasCollision(box)) continue;
        placedBoxes.push(box);

        // Depot icon badge
        ctx.fillStyle = '#ea4335';
        ctx.beginPath();
        ctx.arc(cx, cy, 7 * Math.min(1.2, gmapZoom), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🏢', cx, cy + 3);
        ctx.textAlign = 'left';

        if (isCloseZoom) {
          ctx.font = 'bold 10px Roboto, sans-serif';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.lineWidth = 2.5;
          ctx.lineJoin = 'round';
          ctx.strokeText(depot.name, cx + 11, cy + 3);
          ctx.fillStyle = '#fca5a5';
          ctx.fillText(depot.name, cx + 11, cy + 3);
        }
      }
    }

    // D. Priority 4: Fuel Stations (Fuels) in close zoom
    if (isCloseZoom) {
      const allFuels = map.getAllFuels ? map.getAllFuels() : (map.FUELS || []);
      for (const fuel of allFuels) {
        const { cx, cy } = worldToGmap(fuel.x, fuel.y, cw, ch);
        if (cx < 10 || cx > cw - 10 || cy < 10 || cy > ch - 10) continue;

        const label = fuel.brand || fuel.name || 'АЗС';
        ctx.font = '9px Roboto, sans-serif';
        const tw = ctx.measureText(label).width;
        const box = {
          x1: cx - 6,
          y1: cy - 8,
          x2: cx + 12 + tw,
          y2: cy + 8
        };

        if (hasCollision(box)) continue;
        placedBoxes.push(box);

        ctx.fillStyle = '#059669';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(label, cx + 8, cy + 3);
        ctx.fillStyle = '#6ee7b7';
        ctx.fillText(label, cx + 8, cy + 3);
      }
    }

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

  function fitMapToBounds() {
    gmapPanX = 0;
    gmapPanY = 0;
    gmapZoom = 1.0;
  }
  if (typeof window !== 'undefined') {
    window.fitMapToBounds = () => {
      fitMapToBounds();
      renderGoogleMaps();
    };
  }

  function renderWorldMap() {
    fitMapToBounds();
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

      const distFromTruckUnits = Math.hypot(sim.truck.x - wx, sim.truck.y - wy);
      const distFromTruckKm = (typeof map.unitsToRealKm === 'function'
        ? map.unitsToRealKm(distFromTruckUnits)
        : (distFromTruckUnits / 1.25 / 1000)).toFixed(1);

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
          if (sim && sim.truck) {
            gmapCenterOn(sim.truck.x, sim.truck.y);
            toast('Мой тягач (GPS)');
          }
        } else if (type === 'gas') {
          const fuels = (map && map.FUELS) || [];
          const tx = (sim && sim.truck) ? sim.truck.x : 1200;
          const ty = (sim && sim.truck) ? sim.truck.y : 3000;
          let nearest = null;
          let minDist = Infinity;
          for (let i = 0; i < fuels.length; i++) {
            const f = fuels[i];
            const d = Math.hypot(f.x - tx, f.y - ty);
            if (d < minDist) {
              minDist = d;
              nearest = f;
            }
          }
          if (nearest) {
            gmapCenterOn(nearest.x, nearest.y);
            const name = nearest.name || (nearest.brand ? 'АЗС ' + nearest.brand : 'АЗС');
            toast(`Ближайшая ${name}`);
          }
        } else if (type === 'depots') {
          const depot = map && map.DEPOTS && (map.DEPOTS.find(d => d.id === 'depot-chisinau-center') || map.DEPOTS[0]);
          if (depot) {
            gmapCenterOn(depot.x, depot.y);
            toast(depot.name || 'Центральный хаб Chișinău');
          }
        } else if (type === 'peresecina') {
          const c = map && map.CITIES && map.CITIES.find(city =>
            city.nameRo === 'Peresecina' ||
            (city.name && city.name.toLowerCase().includes('пересеч')) ||
            (city.nameRu && city.nameRu.toLowerCase().includes('пересеч')) ||
            city.id === 'peresecina'
          );
          if (c) {
            gmapCenterOn(c.x, c.y);
            toast('Серпантин Пересечина (M2)');
          }
        } else if (type === 'orhei') {
          const d = map && map.DEPOTS && map.DEPOTS.find(dep => dep.id === 'depot-orhei-central');
          const c = map && map.CITIES && map.CITIES.find(city => city.nameRo === 'Orhei' || city.nameRu === 'Оргеев');
          const target = d || c;
          if (target) {
            gmapCenterOn(target.x, target.y);
            toast(target.name || 'Орхей (Терминал логистики)');
          }
        } else if (type === 'chisinau') {
          const c = map && map.CITIES && map.CITIES.find(city => city.nameRo === 'Chișinău' || city.nameRu === 'Кишинёв');
          const d = map && map.DEPOTS && map.DEPOTS.find(dep => dep.id === 'depot-chisinau-center');
          const target = c || d;
          if (target) {
            gmapCenterOn(target.x, target.y);
            toast(target.name || 'Город Кишинёв');
          }
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
      { cargo: map.CARGO_CATALOG[0], origin: depots.find(d => d.id === 'depot-chisinau-center') || depots[0], target: depots.find(d => d.id === 'depot-orhei-central') || depots[1] }, // Кишинёв -> Орхей
      { cargo: map.CARGO_CATALOG[3] || map.CARGO_CATALOG[0], origin: depots.find(d => d.id === 'depot-chisinau-center') || depots[0], target: depots.find(d => d.id === 'depot-balti-north') || depots[1] }, // Кишинёв -> Бельцы
      { cargo: map.CARGO_CATALOG[4] || map.CARGO_CATALOG[0], origin: depots.find(d => d.id === 'depot-ungheni-west') || depots[0], target: depots.find(d => d.id === 'depot-chisinau-center') || depots[1] }, // Унгены -> Кишинёв
      { cargo: map.CARGO_CATALOG[2] || map.CARGO_CATALOG[0], origin: depots.find(d => d.id === 'depot-balti-north') || depots[0], target: depots.find(d => d.id === 'depot-cahul-south') || depots[1] }, // Бельцы -> Кагул
      { cargo: map.CARGO_CATALOG[1] || map.CARGO_CATALOG[0], origin: depots.find(d => d.id === 'depot-orhei-central') || depots[0], target: depots.find(d => d.id === 'depot-ungheni-west') || depots[1] }, // Орхей -> Унгены
      { cargo: map.CARGO_CATALOG[5] || map.CARGO_CATALOG[1] || map.CARGO_CATALOG[0], origin: depots.find(d => d.id === 'depot-tiraspol-east') || depots[0], target: depots.find(d => d.id === 'depot-orhei-central') || depots[1] } // Тирасполь -> Орхей
    ];
    if (typeof window !== 'undefined') window.jobContracts = contracts;

    const MAP_SCALE = (map && map.MAP_SCALE) || 1.25;

    contracts.forEach((item, index) => {
      // Calculate road distance in meters (from A* route lengthM if connected, else Euclidean / MAP_SCALE)
      let distMeters = 0;
      if (item.origin.nearestNodeId && item.target.nearestNodeId && map.findRoute) {
        const r = map.findRoute(item.origin.nearestNodeId, item.target.nearestNodeId);
        if (r && r.found && r.totalLengthM) distMeters = r.totalLengthM;
      }
      if (!distMeters) {
        distMeters = Math.hypot(item.target.x - item.origin.x, item.target.y - item.origin.y) / MAP_SCALE;
      }
      const distKm = Math.max(5, Math.round(distMeters / 1000));
      const valPerKm = item.cargo.valuePerKm || 34;
      const reward = Math.round(distKm * valPerKm + 3200);
      item.distKm = distKm;
      item.reward = reward;

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
  let cachedDeliveryPromptEl = null;
  function checkDepotDelivery() {
    if (!profile.activeJob || !profile.activeJob.targetDepot || typeof profile.activeJob.targetDepot.x !== 'number') return;
    const t = sim.truck;
    const target = profile.activeJob.targetDepot;
    const dist = Math.hypot(t.x - target.x, t.y - target.y);

    if (!cachedDeliveryPromptEl) cachedDeliveryPromptEl = $('#delivery-prompt');
    if (!cachedDeliveryPromptEl) return;
    if (dist < 120 && Math.abs(sim.currentSpeedKmh) < 5) {
      if (!cachedDeliveryPromptEl.classList.contains('active')) cachedDeliveryPromptEl.classList.add('active');
      if (sim.truck.parkingBrake) {
        completeJobSuccess();
      }
    } else if (cachedDeliveryPromptEl.classList.contains('active')) {
      cachedDeliveryPromptEl.classList.remove('active');
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

  const TELEPORT_PRESETS_RAW = {
    'chisinau-hub': {
      name: 'Кишинёв: База Trans-Moldova',
      x: 750, y: 3150, angle: -1.57, speed: 0,
      desc: 'Центральная база логистики в столице'
    },
    'chisinau-center': {
      name: 'Кишинёв: Проспект Calea Orheiului',
      x: 1172, y: 3028, angle: -2.35, speed: 50,
      desc: 'Выезд из города на трассу M2'
    },
    'centura-chisinau': {
      name: 'Кишинёв: Кольцевая объездная (Centura)',
      x: 1200, y: 1800, angle: 0, speed: 70,
      desc: 'Орбитальная магистраль вокруг Кишинёва'
    },
    'cricova-cloverleaf': {
      name: 'Крикова: Развязка M1 / M2',
      x: 1568, y: -2263, angle: -1.13, speed: 60,
      desc: 'Крупнейший путепровод Молдовы'
    },
    'm2-magdacesti': {
      name: 'Трасса M2: Скоростная прямая (Мэгдачешть)',
      x: 1244, y: -4736, angle: -1.96, speed: 90,
      desc: 'Скоростной замер динамики 0–90 км/ч'
    },
    'm2-serpentine': {
      name: 'Пересечина: Серпантин M2',
      x: -296, y: -12732, angle: -1.15, speed: 45,
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

  const S_SCALE = ((typeof ETSMap !== 'undefined' && ETSMap.MAP_SCALE) || 1.25) / (10 / 19);
  const TELEPORT_PRESETS = {};
  for (const [k, p] of Object.entries(TELEPORT_PRESETS_RAW)) {
    TELEPORT_PRESETS[k] = {
      ...p,
      x: Math.round((1200 + (p.x - 1200) * S_SCALE) * 10) / 10,
      y: Math.round((3000 + (p.y - 3000) * S_SCALE) * 10) / 10
    };
  }

  function executeTeleport(x, y, angle = null, speedKmh = 0, label = '') {
    sim.teleport(x, y, angle, speedKmh);
    sim.currentRoute = null;
    sim._lastRouteCalcTime = 0;
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

    // Draw OSM Road Network
    const adminEdges = (map.OSM && map.OSM.edges) || map.edges || [];
    if (adminEdges.length > 0) {
      adminEdges.forEach(edge => {
        const pts = edge.points;
        if (!pts || pts.length < 2) return;
        const isHighway = edge.roadClass === 'motorway' || edge.roadClass === 'trunk' || edge.roadClass === 'primary';

        ctx.strokeStyle = isHighway ? '#f59e0b' : '#64748b';
        ctx.lineWidth = isHighway ? 2.5 : 1.2;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const { cx, cy } = projectAdmin(p[0], p[1]);
          if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        });
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
    ctx.fillStyle = 'rgba(52, 168, 83, 0.35)';
    ctx.beginPath();
    ctx.arc(truckPos.cx, truckPos.cy, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#34A853';
    ctx.beginPath();
    ctx.arc(truckPos.cx, truckPos.cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

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

    // Hotkey: F3 toggles Performance Profiler Overlay
    if (e.code === 'F3') {
      e.preventDefault();
      renderer.showPerf = !renderer.showPerf;
      toast(`Отладка FPS (F3): ${renderer.showPerf ? 'ВКЛ' : 'ВЫКЛ'}`);
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

  // HUD Update with Google Maps Navigation Theme (Throttled to 20Hz to prevent DOM reflow thrashing)
  let lastHudUpdateMs = 0;
  function updateHUD() {
    const nowMs = performance.now();
    if (nowMs - lastHudUpdateMs < 50) return;
    lastHudUpdateMs = nowMs;

    const t = sim.truck;
    const r = sim.trailer;

    // Digital Speedometer & Gear
    safeText('#hud-speed', sim.currentSpeedKmh);
    safeText('#hud-gear', t.gear === -1 ? 'R' : `D${t.gear}`);

    // Speed limit
    safeText('#hud-speed-limit', sim.speedLimit);
    const speedLimitEl = elCache.get('#hud-speed-limit') || $('#hud-speed-limit');
    if (speedLimitEl) speedLimitEl.classList.toggle('overspeed', sim.currentSpeedKmh > sim.speedLimit + 5);

    // Fuel & Odometer
    safeText('#hud-fuel', `${Math.round(t.fuel)} L`);
    safeText('#hud-odometer', `${t.odometer.toFixed(1)} km`);

    // Pressure & Damage
    safeText('#hud-air', `${t.airPressure.toFixed(1)} bar`);
    safeText('#hud-truck-damage', `${Math.round(t.damage)}%`);
    safeText('#hud-cargo-damage', `${Math.round(r.cargoDamage)}%`);

    // Turn Signals & Indicators
    const indLeft = elCache.get('#ind-left') || $('#ind-left');
    const indRight = elCache.get('#ind-right') || $('#ind-right');
    const indLights = elCache.get('#ind-lights') || $('#ind-lights');
    const indTrailer = elCache.get('#ind-trailer') || $('#ind-trailer');
    const indPark = elCache.get('#ind-park') || $('#ind-park');

    if (indLeft) indLeft.classList.toggle('active', (t.turnSignal === -1 || t.turnSignal === 2) && renderer.turnBlinkOn);
    if (indRight) indRight.classList.toggle('active', (t.turnSignal === 1 || t.turnSignal === 2) && renderer.turnBlinkOn);
    if (indLights) {
      indLights.classList.toggle('active', t.lights > 0);
      safeText(indLights, t.lights === 2 ? 'HIGH' : t.lights === 1 ? 'LOW' : 'OFF');
    }
    if (indTrailer) {
      indTrailer.classList.toggle('active', r.attached);
      safeText(indTrailer, r.attached ? 'TRAILER: ON' : 'NO TRAILER');
    }
    if (indPark) indPark.classList.toggle('active', t.parkingBrake);

    // GPS Navigation & ETA Calculations (Real OSM Graph & A* Route)
    if (profile.activeJob && profile.activeJob.targetDepot && typeof profile.activeJob.targetDepot.x === 'number') {
      const target = profile.activeJob.targetDepot;
      const nowMs = performance.now();
      const needsRecalc = !sim.currentRoute ||
                          sim.navTarget !== target ||
                          (sim._lastRouteCalcTime === 0);

      if (needsRecalc && map.findRoute) {
        sim.currentRoute = map.findRoute(t, target);
        sim.navTarget = target;
        sim._lastRouteCalcTime = nowMs;
      }

      const route = sim.currentRoute;
      const lastHudCalc = sim._lastHudCalc || 0;
      if (nowMs - lastHudCalc > 150 || !sim._cachedHudData) {
        sim._lastHudCalc = nowMs;

        let distKm, estMinutes;
        if (route && route.polyline && route.polyline.length >= 2) {
          const poly = route.polyline;
          let bestDistSq = Infinity;
          let bestSeg = 0;
          let bestX = poly[0][0], bestY = poly[0][1];

          let startIdx = 0;
          let endIdx = poly.length - 1;
          if (typeof sim._hudRouteBestSeg === 'number' && sim._hudRouteBestSeg >= 0 && sim._hudRouteBestSeg < poly.length - 1) {
            startIdx = Math.max(0, sim._hudRouteBestSeg - 2);
            endIdx = Math.min(poly.length - 1, sim._hudRouteBestSeg + 15);
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
          sim._hudRouteBestSeg = bestSeg;
          if (bestDistSq > 300 * 300) {
            sim._lastRouteCalcTime = 0; // Trigger reroute next tick if off-route
          }
          const MAP_SCALE = (map && map.MAP_SCALE) || 1.25;
          let remDist = Math.hypot(poly[bestSeg + 1][0] - bestX, poly[bestSeg + 1][1] - bestY);
          for (let i = bestSeg + 1; i < poly.length - 1; i++) {
            remDist += Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
          }
          const remMeters = remDist / MAP_SCALE;
          const km = remMeters / 1000;
          distKm = km.toFixed(1);
          estMinutes = Math.max(1, Math.round((km / 75) * 60));
        } else {
          const fallbackMeters = (Math.hypot(target.x - t.x, target.y - t.y)) / ((map && map.MAP_SCALE) || 1.25);
          const fallbackKm = Math.max(0.1, fallbackMeters / 1000);
          distKm = fallbackKm.toFixed(1);
          estMinutes = Math.max(1, Math.round((fallbackKm / 75) * 60));
        }

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
        const navFooter = document.querySelector('#gmaps-navigation-footer');
        if (navFooter) navFooter.hidden = false;
        safeText('#gmaps-eta-time', `${estMinutes} мин`);
        safeText('#gmaps-eta-distance', `${distKm} км`);
        safeText('#gmaps-eta-arrival', `Прибытие в ${timeStr}`);
        safeText('#gmaps-eta-route-name', `Трасса ${roadRef} (${distKm} км) / ${estMinutes} мин`);

        sim._cachedHudData = { distKm, estMinutes, roadRef };
      }
    } else {
      sim.currentRoute = null;
      sim.navTarget = null;
      const navFooter = document.querySelector('#gmaps-navigation-footer');
      if (navFooter) navFooter.hidden = true;
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
        originDepot: depots.find(d => d.id === 'depot-chisinau-center') || depots[0],
        targetCityName: 'Orhei',
        targetDepot: depots.find(d => d.id === 'depot-orhei-central') || depots[2] || depots[1],
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
