/*! 2D ETS2 Moldova Edition | High-Performance Truck & Trailer Engine */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const angleDiff = (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current));

  // Physics constants scaled to canvas units (1 meter ≈ 10 pixels)
  const TRUCK_LENGTH = 68;       // ~6.8 m
  const TRUCK_WIDTH = 25;        // ~2.5 m
  const WHEELBASE = 40;          // ~4.0 m between front steer and rear drive axle
  const HITCH_OFFSET = -16;      // Fifth wheel position relative to truck center
  const TRAILER_LENGTH = 136;    // ~13.6 m standard European semi-trailer
  const TRAILER_WIDTH = 25;      // ~2.5 m
  const KINGPIN_TO_AXLE = 85;    // ~8.5 m from kingpin to trailer bogie center
  const JACKKNIFE_LIMIT = 1.35;  // ~77 degrees max articulation before collision

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

  class SpatialEdgeGrid {
    constructor(edges, cellSize = 400) {
      this.cellSize = cellSize;
      this.cells = new Map();
      if (!edges) return;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const b = e.bounds;
        if (!b) continue;
        const minCx = Math.floor(b[0] / cellSize);
        const maxCx = Math.floor(b[2] / cellSize);
        const minCy = Math.floor(b[1] / cellSize);
        const maxCy = Math.floor(b[3] / cellSize);
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            const key = cx + ',' + cy;
            let list = this.cells.get(key);
            if (!list) {
              list = [];
              this.cells.set(key, list);
            }
            list.push(e);
          }
        }
      }
    }

    queryRadius(x, y, radius = 250) {
      const minCx = Math.floor((x - radius) / this.cellSize);
      const maxCx = Math.floor((x + radius) / this.cellSize);
      const minCy = Math.floor((y - radius) / this.cellSize);
      const maxCy = Math.floor((y + radius) / this.cellSize);
      const seen = new Set();
      const result = [];
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const key = cx + ',' + cy;
          const list = this.cells.get(key);
          if (list) {
            for (let i = 0; i < list.length; i++) {
              const e = list[i];
              if (!seen.has(e.id)) {
                seen.add(e.id);
                result.push(e);
              }
            }
          }
        }
      }
      return result;
    }
  }

  class TruckSimulation {
    constructor(mapSystem) {
      this.map = mapSystem;
      this.reset();
    }

    reset() {
      // Spawn on highway
      const spawn = this.map.getStartSpawn ? this.map.getStartSpawn() : { x: 1200, y: 3000, angle: -Math.PI / 2 };

      // Truck state
      this.truck = {
        x: spawn.x,
        y: spawn.y,
        angle: spawn.angle,
        speed: 0,          // in pixels/sec
        vx: 0,
        vy: 0,
        steerAngle: 0,     // current front wheel angle in radians
        maxSteer: 0.58,    // ~33 degrees max wheel cut
        rpm: 800,
        gear: 1,           // -1 for reverse, 0 for neutral, 1..12 forward
        airPressure: 9.5,  // bar (standard European air brake system 8-10 bar)
        fuel: 580,         // Litres (max 600)
        fuelCapacity: 600,
        odometer: 14280,   // km
        damage: 0,         // % 0-100
        offroad: false,
        lights: 0,         // 0: off, 1: low beam, 2: high beam
        turnSignal: 0,     // -1: left, 0: off, 1: right, 2: hazard
        hazard: false,
        horn: false,
        parkingBrake: false,
        engineRunning: true,
        powerHp: 480,
        massKg: 8000,
        color: '#1e3799',
        cabColor: '#0c2461'
      };

      // Semi-trailer state
      const hx = this.truck.x + Math.cos(this.truck.angle) * HITCH_OFFSET;
      const hy = this.truck.y + Math.sin(this.truck.angle) * HITCH_OFFSET;
      this.trailer = {
        attached: true,
        angle: spawn.angle,
        x: hx - Math.cos(spawn.angle) * (KINGPIN_TO_AXLE * 0.5),
        y: hy - Math.sin(spawn.angle) * (KINGPIN_TO_AXLE * 0.5),
        cargo: null,
        cargoWeightKg: 18000,
        cargoDamage: 0,    // %
        jackknifed: false,
        articulationAngle: 0
      };

      // Telemetry
      this.currentSpeedKmh = 0;
      this.nearestRoad = null;
      this.speedLimit = 50;
      this.lastHonk = 0;
      this.brakePshTrigger = false;
      this.wasBraking = false;
    }

    setTruckModel(model) {
      if (!model) return;
      this.truckModel = model;
      this.truck.powerHp = model.powerHp || 480;
      this.truck.massKg = model.massKg || 8000;
      this.truck.fuelCapacity = model.fuelCapacity || 600;
      this.truck.fuel = Math.min(this.truck.fuel, this.truck.fuelCapacity);
      this.truck.color = model.color || '#1e3799';
      this.truck.cabColor = model.cabColor || '#0c2461';
    }

    // Teleport truck and semi-trailer to exact coordinates
    teleport(x, y, angle = null, speedKmh = 0) {
      if (angle === null || angle === undefined) angle = this.truck.angle;
      this.truck.x = x;
      this.truck.y = y;
      this.truck.angle = angle;
      this.truck.steerAngle = 0;

      // 1 meter = 10 canvas units; speed in px/s
      const speedPx = (speedKmh * 1000 / 3600) * 10;
      this.truck.speed = speedPx;
      this.truck.vx = Math.cos(angle) * speedPx;
      this.truck.vy = Math.sin(angle) * speedPx;

      if (this.trailer) {
        const hx = this.truck.x + Math.cos(angle) * HITCH_OFFSET;
        const hy = this.truck.y + Math.sin(angle) * HITCH_OFFSET;
        this.trailer.angle = angle;
        this.trailer.x = hx - Math.cos(angle) * (KINGPIN_TO_AXLE * 0.5);
        this.trailer.y = hy - Math.sin(angle) * (KINGPIN_TO_AXLE * 0.5);
        this.trailer.vx = this.truck.vx;
        this.trailer.vy = this.truck.vy;
        this.trailer.jackknifed = false;
        this.trailer.articulationAngle = 0;
      }
    }

    // Repair all damage to 0%
    repairAll() {
      this.truck.damage = 0;
      if (this.trailer) {
        this.trailer.cargoDamage = 0;
        this.trailer.jackknifed = false;
      }
    }

    // Refuel tank to maximum
    refuelFull() {
      this.truck.fuel = this.truck.fuelCapacity || 600;
    }

    // Restore air brake pressure
    restoreAir() {
      this.truck.airPressure = 10.0;
    }

    // Instant boost impulse
    setImpulseSpeed(speedKmh) {
      const speedPx = (speedKmh * 1000 / 3600) * 10;
      this.truck.speed = speedPx;
      this.truck.vx = Math.cos(this.truck.angle) * speedPx;
      this.truck.vy = Math.sin(this.truck.angle) * speedPx;
    }

    // Reverse orientation 180 degrees
    reverseTruckDirection() {
      this.teleport(this.truck.x, this.truck.y, this.truck.angle + Math.PI, 0);
    }

    // Force hitch/unhitch trailer with optional cargo
    forceHitch(attached, cargo = null) {
      this.trailer.attached = !!attached;
      if (attached) {
        const hx = this.truck.x + Math.cos(this.truck.angle) * HITCH_OFFSET;
        const hy = this.truck.y + Math.sin(this.truck.angle) * HITCH_OFFSET;
        this.trailer.angle = this.truck.angle;
        this.trailer.x = hx - Math.cos(this.truck.angle) * (KINGPIN_TO_AXLE * 0.5);
        this.trailer.y = hy - Math.sin(this.truck.angle) * (KINGPIN_TO_AXLE * 0.5);
        this.trailer.jackknifed = false;
        this.trailer.articulationAngle = 0;
        if (cargo) {
          this.trailer.cargo = cargo;
          this.trailer.cargoWeightKg = cargo.weightKg || 18000;
        }
      }
    }

    // Attach or detach trailer at fifth wheel
    toggleHitch() {
      if (this.trailer.attached) {
        // Only allow unhitch at near zero speed
        if (Math.abs(this.truck.speed) < 5) {
          this.trailer.attached = false;
          return { ok: true, attached: false, msg: 'Полуприцеп отцеплен' };
        }
        return { ok: false, msg: 'Для расцепки полностью остановитесь!' };
      } else {
        // Check distance between fifth wheel and trailer front kingpin
        const hx = this.truck.x + Math.cos(this.truck.angle) * HITCH_OFFSET;
        const hy = this.truck.y + Math.sin(this.truck.angle) * HITCH_OFFSET;
        const dist = Math.hypot(hx - this.trailer.x, hy - this.trailer.y);
        if (dist < 45) {
          this.trailer.attached = true;
          this.trailer.angle = this.truck.angle;
          return { ok: true, attached: true, msg: 'Полуприцеп успешно сочленён!' };
        }
        return { ok: false, msg: 'Подъедьте седлом вплотную к прицепу!' };
      }
    }

    update(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.05); // prevent large delta spikes

      const t = this.truck;
      const r = this.trailer;

      // 1. Controls processing
      const throttle = input.throttle || 0;
      const brake = input.brake || 0;
      const steer = input.steer || 0; // -1 to 1

      // Turn signals & lights
      if (input.toggleLights) t.lights = (t.lights + 1) % 3;
      if (input.signalLeft) t.turnSignal = (t.turnSignal === -1) ? 0 : -1;
      if (input.signalRight) t.turnSignal = (t.turnSignal === 1) ? 0 : 1;
      if (input.hazard) t.turnSignal = (t.turnSignal === 2) ? 0 : 2;
      t.horn = !!input.horn;

      // Steering with speed-sensitive damping (heavier wheel at 80 km/h, agile at 10 km/h)
      const speedFactor = 1 / (1 + Math.abs(t.speed) * 0.003);
      const targetSteer = steer * t.maxSteer * speedFactor;
      t.steerAngle = lerp(t.steerAngle, targetSteer, 1 - Math.exp(-dt * 9));

      // 2. Air Brake simulation
      if (brake > 0.1) {
        t.airPressure = Math.max(4.5, t.airPressure - dt * 0.4 * brake);
        this.wasBraking = true;
        this.brakePshTrigger = false;
      } else if (this.wasBraking) {
        // Air discharge hiss when releasing brake pedal
        this.brakePshTrigger = true;
        this.wasBraking = false;
      } else {
        this.brakePshTrigger = false;
        // Compressor refills air reservoir
        t.airPressure = Math.min(10.0, t.airPressure + dt * 0.35);
      }

      // 3. Engine & Transmission physics
      // Total weight: Truck + Trailer + Cargo
      const totalMassKg = (t.massKg || 8000) + (r.attached ? 6000 + (r.cargoWeightKg || 0) : 0);
      const massRatio = 32000 / totalMassKg; // baseline 32 tonnes

      // Drive acceleration based on diesel torque curve
      const maxForwardSpeed = (90 / 3.6) * 10; // 90 km/h in px/s (1m = 10px) = 250 px/s
      const maxReverseSpeed = (20 / 3.6) * 10; // 20 km/h = 55 px/s

      let acceleration = 0;
      if (input.reverse) {
        t.gear = -1;
        if (throttle > 0 && t.speed > -maxReverseSpeed) {
          acceleration = -throttle * ((t.powerHp || 480) * 0.1) * massRatio;
        }
      } else {
        if (t.speed < -2) {
          // Automatic shift back to drive
          t.gear = 1;
        } else {
          t.gear = clamp(Math.floor(Math.abs(t.speed) / 20) + 1, 1, 12);
        }
        if (throttle > 0 && t.speed < maxForwardSpeed) {
          // Strong low-gear torque, tapering off near governor 90 km/h
          const torqueDrop = 1 - Math.pow(Math.max(0, t.speed) / maxForwardSpeed, 1.8);
          const powerFactor = (t.powerHp || 480) / 8;
          acceleration = throttle * powerFactor * massRatio * Math.max(0.2, torqueDrop);
        }
      }

      // Braking deceleration
      if (brake > 0) {
        const brakeForce = 140 * (t.airPressure / 8.5);
        if (t.speed > 1) {
          acceleration -= brake * brakeForce;
        } else if (t.speed < -1) {
          acceleration += brake * brakeForce;
        } else {
          t.speed = 0;
        }
      }

      // Natural drag & rolling resistance (higher on grass/shoulder)
      const offroadPenalty = t.offroad ? 4.5 : 1.0;
      const rollingResistance = 12 * offroadPenalty;
      const airDrag = 0.0018 * t.speed * t.speed;

      if (Math.abs(t.speed) > 0.5) {
        acceleration -= Math.sign(t.speed) * (rollingResistance + airDrag);
      } else if (throttle === 0 && brake === 0) {
        t.speed = 0;
      }

      t.speed += acceleration * dt;
      if (input.reverse && t.speed < -maxReverseSpeed) t.speed = -maxReverseSpeed;
      if (!input.reverse && t.speed > maxForwardSpeed) t.speed = maxForwardSpeed;

      // 4. Bicycle / Ackermann truck motion
      const angularVelocity = (t.speed / WHEELBASE) * Math.tan(t.steerAngle);
      t.angle += angularVelocity * dt;
      t.angle = Math.atan2(Math.sin(t.angle), Math.cos(t.angle));

      t.vx = Math.cos(t.angle) * t.speed;
      t.vy = Math.sin(t.angle) * t.speed;
      t.x += t.vx * dt;
      t.y += t.vy * dt;

      // 5. Articulated Semi-Trailer Kinematics
      if (r.attached) {
        // Hitch (fifth wheel) position on truck
        const hx = t.x + Math.cos(t.angle) * HITCH_OFFSET;
        const hy = t.y + Math.sin(t.angle) * HITCH_OFFSET;

        // Kinematic angle update:
        // Difference between truck orientation and trailer orientation
        const articulation = angleDiff(t.angle, r.angle);
        r.articulationAngle = articulation;

        // Trailer hitch velocity vector
        const hitchVx = t.vx - Math.sin(t.angle) * HITCH_OFFSET * angularVelocity;
        const hitchVy = t.vy + Math.cos(t.angle) * HITCH_OFFSET * angularVelocity;

        // Forward and lateral speed components relative to trailer body
        const trailerParallelSpeed = hitchVx * Math.cos(r.angle) + hitchVy * Math.sin(r.angle);
        const trailerLateralSpeed = hitchVx * Math.sin(r.angle) - hitchVy * Math.cos(r.angle);

        // Rotation rate of trailer
        let trailerAngularVel = -trailerLateralSpeed / KINGPIN_TO_AXLE;

        // Jackknife protection / collision limit
        if (Math.abs(articulation) >= JACKKNIFE_LIMIT) {
          r.jackknifed = true;
          // Impose hard angle limit so trailer doesn't swing through cab
          r.angle = t.angle - Math.sign(articulation) * JACKKNIFE_LIMIT;
          // Apply shock / minor damage from cab contact
          if (Math.abs(t.speed) > 15) {
            t.damage = Math.min(100, t.damage + dt * 4);
            r.cargoDamage = Math.min(100, r.cargoDamage + dt * 6);
          }
        } else {
          r.jackknifed = false;
          r.angle += trailerAngularVel * dt;
          r.angle = Math.atan2(Math.sin(r.angle), Math.cos(r.angle));
        }

        // Trailer center follows fifth wheel exactly
        r.x = hx - Math.cos(r.angle) * (KINGPIN_TO_AXLE * 0.5);
        r.y = hy - Math.sin(r.angle) * (KINGPIN_TO_AXLE * 0.5);
      }

      // 6. Fuel & Odometer
      const distTraveledUnits = Math.abs(t.speed * dt);
      const map = this.map || (typeof ETSMap !== 'undefined' ? ETSMap : null);
      const distTraveledMeters = (map && typeof map.unitsToRealMeters === 'function')
        ? map.unitsToRealMeters(distTraveledUnits)
        : (distTraveledUnits / 1.25);
      t.odometer += distTraveledMeters / 1000;
      // Consumption ~32L/100km loaded, 22L/100km empty
      const lPerKm = (r.attached ? 0.33 : 0.23) + (throttle * 0.15);
      t.fuel = Math.max(0, t.fuel - (distTraveledMeters / 1000) * lPerKm);

      // 7. Engine RPM simulation
      const baseRpm = 600;
      const speedRpm = (Math.abs(t.speed) / maxForwardSpeed) * 1600;
      const throttleRpm = throttle * 400;
      t.rpm = clamp(baseRpm + speedRpm + throttleRpm, 600, 2400);

      this.currentSpeedKmh = Math.round(Math.abs(t.speed) * 0.36);

      // 8. Road bounds & offroad check
      this._checkRoadSurface();
    }

    _checkRoadSurface() {
      const t = this.truck;
      if (!this.edgeGrid) {
        const edges = (this.map && this.map.OSM && this.map.OSM.edges) ||
                      (this.map && this.map.edges) ||
                      (typeof globalThis !== 'undefined' && globalThis.OSM_MOLDOVA_MAP && globalThis.OSM_MOLDOVA_MAP.edges) ||
                      [];
        this.edgeGrid = new SpatialEdgeGrid(edges, 400);
      }

      let onAnyRoad = false;
      let closestRoad = null;
      let minDistance = Infinity;

      // Spatial culling query via bounds grid (radius 120 px around truck)
      const candidates = this.edgeGrid.queryRadius(t.x, t.y, 120);
      for (let c = 0; c < candidates.length; c++) {
        const edge = candidates[c];
        const pts = edge.points;
        if (!pts || pts.length < 2) continue;
        for (let i = 0; i < pts.length - 1; i++) {
          const x1 = pts[i][0], y1 = pts[i][1];
          const x2 = pts[i + 1][0], y2 = pts[i + 1][1];
          const dx = x2 - x1, dy = y2 - y1;
          const l2 = dx * dx + dy * dy;
          if (l2 === 0) continue;
          let proj = ((t.x - x1) * dx + (t.y - y1) * dy) / l2;
          proj = Math.max(0, Math.min(1, proj));
          const qx = x1 + proj * dx;
          const qy = y1 + proj * dy;
          const dist = Math.hypot(t.x - qx, t.y - qy);
          if (dist < minDistance) {
            minDistance = dist;
            closestRoad = edge;
          }
        }
      }

      const getW = (this.map && this.map.getRoadWidth) || getRoadWidth;
      const roadW = closestRoad ? getW(closestRoad) : 60;

      if (closestRoad && minDistance <= (roadW * 0.5 + 15)) {
        onAnyRoad = true;
        this.speedLimit = closestRoad.maxspeed || (closestRoad.roadClass === 'motorway' || closestRoad.roadClass === 'trunk' ? 90 : closestRoad.roadClass === 'primary' ? 70 : 50);
      } else {
        this.speedLimit = 50;
      }

      this.nearestRoad = closestRoad;
      t.offroad = !onAnyRoad;
    }
  }

  root.ETSEngine = {
    TruckSimulation,
    TRUCK_LENGTH,
    TRUCK_WIDTH,
    TRAILER_LENGTH,
    TRAILER_WIDTH,
    HITCH_OFFSET
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ETSEngine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
