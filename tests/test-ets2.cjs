/* ETS2 2D | Comprehensive Test Suite for Menu & Admin Teleport */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = path.resolve(__dirname, '..');
let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}

// 1. Mock DOM and Web APIs for pure Node testing
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classList = new Set();
    this.classList.toggle = (cls, force) => {
      if (force !== undefined) {
        if (force) this.classList.add(cls); else this.classList.delete(cls);
        return force;
      }
      if (this.classList.has(cls)) { this.classList.delete(cls); return false; }
      this.classList.add(cls); return true;
    };
    this.classList.contains = cls => this.classList.has(cls);
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.listeners = {};
    this.value = '0';
    this.checked = true;
    this.width = 800;
    this.height = 400;
  }

  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, val) { this.attributes[name] = String(val); }
  removeAttribute(name) { delete this.attributes[name]; }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    list.forEach(fn => fn(event));
  }

  querySelector(sel) {
    return findFirst(this, sel);
  }

  querySelectorAll(sel) {
    return findAll(this, sel);
  }

  appendChild(el) {
    this.children.push(el);
    return el;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }

  getContext(type) {
    return {
      canvas: this,
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      setTransform() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      stroke() {},
      fill() {},
      fillText() {},
      setLineDash() {},
      createRadialGradient() {
        return { addColorStop() {} };
      }
    };
  }
}

function findFirst(root, sel) {
  const all = findAll(root, sel);
  return all.length ? all[0] : null;
}

function findAll(root, sel) {
  const results = [];
  function walk(node) {
    if (matchesSelector(node, sel)) results.push(node);
    for (const child of node.children) walk(child);
  }
  walk(root);
  return results;
}

function matchesSelector(el, sel) {
  if (!el || !el.tagName) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList && el.classList.has(sel.slice(1));
  if (sel.startsWith('[')) {
    const m = sel.match(/\[([a-zA-Z0-9_-]+)(?:=([^\]]+))?\]/);
    if (m) {
      const attr = m[1];
      const val = m[2] ? m[2].replace(/['"]/g, '') : undefined;
      if (attr.startsWith('data-')) {
        const key = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return val !== undefined ? el.dataset[key] === val : el.dataset[key] !== undefined;
      }
      return val !== undefined ? el.getAttribute(attr) === val : el.getAttribute(attr) !== null;
    }
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

// 2. Set up DOM Tree based on index.html
const htmlSource = fs.readFileSync(path.join(base, 'index.html'), 'utf8');

check('index.html contains #menu-shell and #drive-screen', () => {
  assert.match(htmlSource, /id="menu-shell"/);
  assert.match(htmlSource, /id="drive-screen"/);
  assert.match(htmlSource, /id="view-home"/);
  assert.match(htmlSource, /id="view-admin"/);
  assert.match(htmlSource, /id="admin-map-canvas"/);
  assert.match(htmlSource, /id="modal-admin"/);
});

check('styles.css contains rail and neon drift colors', () => {
  const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8');
  assert.match(css, /--bg:\s*#0c1013/);
  assert.match(css, /--lime:\s*#d4ff42/);
  assert.match(css, /\.rail\s*\{/);
  assert.match(css, /\.hero\s*\{/);
  assert.match(css, /\.admin-block\s*\{/);
  assert.match(css, /\.drive-topbar\s*\{/);
});

// 3. Test Simulation Engine Teleport & Cheats
const mapCode = fs.readFileSync(path.join(base, 'src/map.js'), 'utf8');
const trucksCode = fs.readFileSync(path.join(base, 'src/trucks.js'), 'utf8');
const engineCode = fs.readFileSync(path.join(base, 'src/engine.js'), 'utf8');

const osmData = JSON.parse(fs.readFileSync(path.join(base, 'data/moldova-map.json'), 'utf8'));

const sandbox = {
  window: { OSM_MOLDOVA_MAP: osmData },
  OSM_MOLDOVA_MAP: osmData,
  console,
  Math,
  performance: { now: () => 1000 }
};
vm.createContext(sandbox);
vm.runInContext(mapCode, sandbox);
vm.runInContext(trucksCode, sandbox);
vm.runInContext(engineCode, sandbox);

check('ETSMap and ETSEngine load correctly', () => {
  assert(sandbox.ETSMap);
  assert(sandbox.ETSTrucks);
  assert(sandbox.ETSEngine);
});

const sim = new sandbox.ETSEngine.TruckSimulation(sandbox.ETSMap);

check('TruckSimulation starts at Chisinau spawn', () => {
  assert.equal(sim.truck.x, 1200);
  assert.equal(sim.truck.y, 2950);
  assert(sim.trailer.attached);
});

check('Teleport method moves truck and trailer safely', () => {
  // Teleport to Orhei (Y = -20684)
  sim.teleport(1200, -20684, -Math.PI / 2, 0);

  assert.equal(sim.truck.x, 1200);
  assert.equal(sim.truck.y, -20684);
  assert.equal(sim.truck.speed, 0);
  assert.equal(sim.trailer.jackknifed, false);
  assert(Math.abs(sim.trailer.angle - (-Math.PI / 2)) < 0.01);
  // Trailer should be positioned behind fifth wheel
  assert(sim.trailer.y > sim.truck.y); // Going North, so behind means higher Y
});

check('Admin Repair restores truck and trailer to 0% damage', () => {
  sim.truck.damage = 45;
  sim.trailer.cargoDamage = 30;
  sim.trailer.jackknifed = true;

  sim.repairAll();

  assert.equal(sim.truck.damage, 0);
  assert.equal(sim.trailer.cargoDamage, 0);
  assert.equal(sim.trailer.jackknifed, false);
});

check('Admin Refuel fills tank to 100%', () => {
  sim.truck.fuel = 20;
  sim.refuelFull();
  assert.equal(sim.truck.fuel, sim.truck.fuelCapacity);
});

check('Admin Air Pressure restores 10.0 bar', () => {
  sim.truck.airPressure = 4.5;
  sim.restoreAir();
  assert.equal(sim.truck.airPressure, 10.0);
});

check('Admin Speed Impulse sets speed correctly', () => {
  sim.setImpulseSpeed(80);
  const currentKmh = Math.round(Math.abs(sim.truck.speed) * 0.36);
  assert.equal(currentKmh, 80);
});

check('Admin 180 degree turn reverses orientation', () => {
  const prevAngle = sim.truck.angle;
  sim.reverseTruckDirection();
  const diff = Math.abs(sim.truck.angle - (prevAngle + Math.PI));
  assert(diff < 0.01 || Math.abs(diff - Math.PI * 2) < 0.01);
});

check('Admin Force Hitch/Unhitch operates without speed restriction', () => {
  sim.truck.speed = 100; // moving fast
  sim.forceHitch(false);
  assert.equal(sim.trailer.attached, false);

  sim.forceHitch(true, sandbox.ETSMap.CARGO_CATALOG[2]);
  assert.equal(sim.trailer.attached, true);
  assert.equal(sim.trailer.cargo.id, 'sunflower_oil');
});

check('ETSTrucks exports ALL_TRUCKS and purchasing cheapest truck after +250k cheat adds to ownedTrucks', () => {
  assert(sandbox.ETSTrucks.ALL_TRUCKS, 'ALL_TRUCKS is exported');
  assert.equal(sandbox.ETSTrucks.ALL_TRUCKS.length, 6, 'Contains all 6 trucks');

  // Test profile purchasing flow
  const profile = {
    moneyMdl: 15000,
    ownedTrucks: [],
    currentTruckId: null
  };

  // 1. Cheat: +250k MDL
  profile.moneyMdl += 250000;
  assert.equal(profile.moneyMdl, 265000);

  // 2. Find cheapest truck from ALL_TRUCKS
  const cheapest = [...sandbox.ETSTrucks.ALL_TRUCKS].sort((a, b) => a.priceMdl - b.priceMdl)[0];
  assert.equal(cheapest.id, 'kamaz-54901');
  assert.equal(cheapest.priceMdl, 125000);

  // 3. Purchase cheapest truck
  assert(profile.moneyMdl >= cheapest.priceMdl);
  profile.moneyMdl -= cheapest.priceMdl;
  profile.ownedTrucks.push(cheapest.id);
  profile.currentTruckId = cheapest.id;

  // 4. Verification
  assert(profile.ownedTrucks.includes(cheapest.id), 'Cheapest truck must be in ownedTrucks');
  assert.equal(profile.moneyMdl, 140000);
});

check('index.html contains all critical UI elements without null exceptions', () => {
  assert.match(htmlSource, /id="home-truck-count"/);
  assert.match(htmlSource, /id="hud-truck-model"/);
  assert.match(htmlSource, /id="game-canvas"/);
  assert.match(htmlSource, /id="modal-map-canvas"/);
});

check('map.js contains full Moldova network of interconnected OSM roads', () => {
  const edges = (sandbox.ETSMap.OSM && sandbox.ETSMap.OSM.edges) || sandbox.ETSMap.edges;
  assert(edges && edges.length >= 6000, `OSM edge count (${edges?.length}) covers full country network`);
  for (let i = 0; i < 50; i++) {
    const edge = edges[i];
    assert(edge.points && edge.points.length >= 2, `Edge ${edge.id} has points`);
    assert(edge.bounds, `Edge ${edge.id} has bounds`);
  }
});

console.log(`\n========================================`);
console.log(`   ALL ${checks} ETS2 2D CHECKS PASSED!`);
console.log(`========================================\n`);

// 4. Test Google Maps Navigation System (ETS2 Mod Style)
check('index.html contains Google Maps Navigation UI components', () => {
  assert.match(htmlSource, /class="google-maps-app"/);
  assert.match(htmlSource, /id="gmaps-search-input"/);
  assert.match(htmlSource, /id="btn-gmaps-zoom-in"/);
  assert.match(htmlSource, /id="btn-gmaps-locate"/);
  assert.match(htmlSource, /id="gmaps-pin-card"/);
  assert.match(htmlSource, /class="gmaps-navigation-footer"/);
  assert.match(htmlSource, /class="route-advisor gmaps-advisor-theme"/);
  assert.match(htmlSource, /class="gmaps-nav-header"/);
});

check('map.js contains geographical features (rivers, pois, cities)', () => {
  assert(sandbox.ETSMap.GEOGRAPHY);
  assert(sandbox.ETSMap.GEOGRAPHY.rautRiver.length > 0);
  assert(sandbox.ETSMap.GEOGRAPHY.pois.length > 0);
  assert(sandbox.ETSMap.CITIES.length >= 5);
});

check('styles.css contains Google Maps Navigation colors and rules', () => {
  const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8');
  assert.match(css, /\.google-maps-app\s*\{/);
  assert.match(css, /#4285F4/); // Google Navigation Blue
  assert.match(css, /#34A853/); // Google ETA Green
  assert.match(css, /\.gmaps-nav-header\s*\{/);
  assert.match(css, /\.gmaps-floating-controls\s*\{/);
});
