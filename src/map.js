/*! 2D ETS2 | Map Engine with ETS2 1:19 Scale Ratio */
(function (root) {
  'use strict';

  // ETS2 Standard European Scale: 1:19
  // 1 km in real world ≈ 1000m / 19 ≈ 52.63 in-game meters
  // Coordinate scale: 1 meter = 10 canvas units
  const ETS2_SCALE = 19;
  const UNITS_PER_METER = 10;
  const realKmToUnits = realKm => (realKm * 1000 / ETS2_SCALE) * UNITS_PER_METER;

  // Real-world distance Chișinău - Bălți along M2 / R14 is ~135 km
  // At 1:19 scale, that is ~7.1 km in-game distance (~71,000 units)
  // Clean continuous highway corridor
  const HIGHWAY_LENGTH_KM = 45; // 45 real km stretch for testing (~2,368 meters in-game)
  const ROAD_UNITS = realKmToUnits(HIGHWAY_LENGTH_KM);

  // Generate highway M2 (Chișinău - Orhei corridor) with realistic gentle highway curves
  const highwayPoints = [];
  const segments = 40;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = 3000 - t * ROAD_UNITS; // Going North
    // Gentle sweeping highway bends (radius > 1500m like real highway)
    const x = 1200 + Math.sin(t * Math.PI * 3) * 1200 + Math.sin(t * Math.PI * 7) * 400;
    highwayPoints.push({ x, y });
  }

  const ROADS = [
    {
      id: 'm2-highway',
      code: 'M2',
      name: 'Traseul M2 (Chișinău - Orhei)',
      speedLimit: 90,
      lanes: 2,
      width: 140, // 14m wide 2-lane dual carriageway
      points: highwayPoints
    }
  ];

  // Helper: Hermite spline interpolation for smooth curves
  function hermitePoint(p0, p1, p2, p3, t, tension = 0.25) {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
      x: h00 * p1.x + h10 * (p2.x - p0.x) * tension + h01 * p2.x + h11 * (p3.x - p1.x) * tension,
      y: h00 * p1.y + h10 * (p2.y - p0.y) * tension + h01 * p2.y + h11 * (p3.y - p1.y) * tension
    };
  }

  // Pre-bake road points into dense sampled segments
  function bakeRoad(road) {
    const raw = road.points;
    const count = raw.length;
    const dense = [];
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    for (let i = 0; i < count - 1; i++) {
      const p0 = raw[Math.max(0, i - 1)];
      const p1 = raw[i];
      const p2 = raw[i + 1];
      const p3 = raw[Math.min(count - 1, i + 2)];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const steps = clamp(Math.ceil(dist / 35), 15, 90);

      for (let s = 0; s < steps; s++) {
        dense.push(hermitePoint(p0, p1, p2, p3, s / steps));
      }
    }
    dense.push({ ...raw[count - 1] });

    let totalLength = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let i = 0; i < dense.length; i++) {
      const p = dense[i];
      const next = dense[Math.min(i + 1, dense.length - 1)];
      const prev = dense[Math.max(0, i - 1)];
      const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
      p.angle = angle;
      p.nx = -Math.sin(angle);
      p.ny = Math.cos(angle);
      if (i > 0) totalLength += Math.hypot(p.x - dense[i - 1].x, p.y - dense[i - 1].y);
      p.dist = totalLength;

      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const margin = (road.width || 140) + 100;
    return {
      ...road,
      dense,
      totalLength,
      bounds: {
        minX: minX - margin,
        minY: minY - margin,
        maxX: maxX + margin,
        maxY: maxY + margin
      }
    };
  }

  const BAKED_ROADS = ROADS.map(bakeRoad);

  // Freight Market Cargo
  const CARGO_CATALOG = [
    { id: 'wine', name: 'Vin Moldovenesc', nameRu: 'Молдавское вино (Purcari)', weightKg: 18000, valuePerKm: 32, type: 'dryvan' },
    { id: 'apples', name: 'Mere de Livadă', nameRu: 'Яблоки (Орхей)', weightKg: 15000, valuePerKm: 26, type: 'reefer' },
    { id: 'sunflower_oil', name: 'Ulei de Floarea Soarelui', nameRu: 'Подсолнечное масло', weightKg: 22000, valuePerKm: 35, type: 'tanker' },
    { id: 'machinery', name: 'Piese și Utilaj', nameRu: 'Оборудование и запчасти', weightKg: 16000, valuePerKm: 40, type: 'lowbed' }
  ];

  // Endpoints and Logistics Hubs on M2
  const CITIES = [
    { id: 'chisinau', name: 'Chișinău', nameRu: 'Кишинёв', x: 1200, y: 3000 },
    { id: 'orhei', name: 'Orhei', nameRu: 'Орхей', x: 1200 + Math.sin(Math.PI * 3) * 1200, y: 3000 - ROAD_UNITS }
  ];

  const DEPOTS = [
    { id: 'chisinau-hub', name: 'Trans-Moldova Chișinău', cityName: 'Chișinău', x: 1200, y: 3000 },
    { id: 'orhei-terminal', name: 'Orhei Logistics Terminal', cityName: 'Orhei', x: 1200 + Math.sin(Math.PI * 3) * 1200, y: 3000 - ROAD_UNITS }
  ];

  const MapSystem = {
    ETS2_SCALE,
    realKmToUnits,
    ROADS: BAKED_ROADS,
    CITIES,
    DEPOTS,
    CARGO_CATALOG,
    getAllDepots: () => DEPOTS,
    getStartSpawn: () => ({ x: 1200, y: 2950, angle: -Math.PI / 2 })
  };

  root.ETSMap = MapSystem;
  if (typeof module !== 'undefined' && module.exports) module.exports = MapSystem;
})(typeof globalThis !== 'undefined' ? globalThis : window);
