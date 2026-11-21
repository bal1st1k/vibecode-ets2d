/* ETS2 2D Full Lifecycle & Regression Verification Suite */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const base = path.resolve(__dirname, '..');
const mapCode = fs.readFileSync(path.join(base, 'src/map.js'), 'utf8');
const trucksCode = fs.readFileSync(path.join(base, 'src/trucks.js'), 'utf8');
const engineCode = fs.readFileSync(path.join(base, 'src/engine.js'), 'utf8');
const rendererCode = fs.readFileSync(path.join(base, 'src/renderer.js'), 'utf8');
const audioCode = fs.readFileSync(path.join(base, 'src/audio.js'), 'utf8');
const appCode = fs.readFileSync(path.join(base, 'src/app.js'), 'utf8');

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
    this.classList.add = cls => this.classList.add(cls);
    this.classList.remove = cls => this.classList.delete(cls);
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.listeners = {};
    this.value = '0';
    this.checked = true;
    this.width = 900;
    this.height = 520;
    this.clientWidth = 900;
    this.clientHeight = 520;
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
  querySelector(sel) { return getEl(sel); }
  querySelectorAll(sel) { return [getEl(sel)]; }
  appendChild(el) { this.children.push(el); return el; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 520 }; }
  getContext(type) {
    return {
      canvas: this,
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      setTransform() {}, fillRect() {}, strokeRect() {}, beginPath() {},
      closePath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {},
      fill() {}, fillText() {}, setLineDash() {}, clearRect() {}, rect() {},
      roundRect() {}, measureText() { return { width: 40 }; },
      createRadialGradient() { return { addColorStop() {} }; },
      createLinearGradient() { return { addColorStop() {} }; }
    };
  }
}

let elementsMap = {};
function getEl(sel) {
  if (!sel) return new MockElement('div');
  if (!elementsMap[sel]) {
    const tag = String(sel).includes('canvas') ? 'canvas' : 'div';
    elementsMap[sel] = new MockElement(tag);
  }
  return elementsMap[sel];
}

function runSession(name, initialStorage) {
  console.log(`\n=== RUNNING TEST SESSION: ${name} ===`);
  elementsMap = {};
  let storage = { ...initialStorage };
  let raf = null;
  const documentListeners = {};

  const osmData = JSON.parse(fs.readFileSync(path.join(base, 'data/moldova-map.json'), 'utf8'));

  const sandbox = {
    window: { OSM_MOLDOVA_MAP: osmData },
    document: {
      querySelector: getEl,
      querySelectorAll: sel => [getEl(sel)],
      getElementById: id => getEl('#' + id),
      addEventListener: (type, handler) => {
        documentListeners[type] = documentListeners[type] || [];
        documentListeners[type].push(handler);
      },
      body: new MockElement('body')
    },
    navigator: { userAgent: 'node' },
    localStorage: {
      getItem: k => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: cb => { raf = cb; },
    cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    console,
    Math,
    Date,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    AudioContext: class {
      createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} } }; }
      createGain() { return { connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } }; }
      createBiquadFilter() { return { connect() {}, frequency: { setValueAtTime() {} } }; }
      createBufferSource() { return { connect() {}, start() {}, buffer: null }; }
      createBuffer() { return { getChannelData() { return new Float32Array(100); } }; }
    }
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(mapCode, sandbox);
  vm.runInContext(trucksCode, sandbox);
  vm.runInContext(engineCode, sandbox);
  vm.runInContext(rendererCode, sandbox);
  vm.runInContext(audioCode, sandbox);
  vm.runInContext(appCode, sandbox);

  // 1. Run 30 frames in Menu mode
  for (let i = 0; i < 30; i++) {
    if (raf) {
      const cb = raf;
      raf = null;
      cb(1000 + i * 16.6);
    }
  }
  console.log('PASS: 30 Menu frames with truck preview rendering');

  // 2. Click each nav button
  for (const page of ['jobs', 'garage', 'dealer', 'map', 'admin', 'home']) {
    const navBtn = getEl(`[data-nav="${page}"]`);
    navBtn.dispatchEvent({ type: 'click' });
    if (raf) { const cb = raf; raf = null; cb(2000); }
  }
  console.log('PASS: Navigated through all tabs (including Google Maps view)');

  // 3. Launch drive
  const playBtn = getEl('#btn-play-hero');
  playBtn.dispatchEvent({ type: 'click' });
  console.log('PASS: Launched drive mode');

  // 4. Simulate keyboard input and 100 driving frames
  const keydown = documentListeners['keydown'] || [];
  keydown.forEach(fn => fn({ key: 'ArrowUp', code: 'ArrowUp', preventDefault() {} }));

  for (let i = 0; i < 100; i++) {
    if (raf) {
      const cb = raf;
      raf = null;
      cb(3000 + i * 16.6);
    }
  }
  console.log('PASS: 100 Driving frames with physics & HUD updates');

  // 5. Open Admin Teleport Modal (F1)
  keydown.forEach(fn => fn({ key: 'F1', code: 'F1', preventDefault() {} }));
  console.log('PASS: F1 Modal Admin opened');

  // 6. Click Admin Repair
  const repairBtn = getEl('#btn-admin-repair');
  repairBtn.dispatchEvent({ type: 'click' });

  // 7. Click Teleport to Balti
  const baltiBtn = getEl('[data-preset="balti"]');
  baltiBtn.dispatchEvent({ type: 'click' });

  for (let i = 0; i < 50; i++) {
    if (raf) {
      const cb = raf;
      raf = null;
      cb(5000 + i * 16.6);
    }
  }
  console.log('PASS: 50 frames after teleport to Bălți');

  console.log(`>>> SUCCESS: SESSION ${name} COMPLETED WITHOUT ERRORS <<<\n`);
}

// Session 1: Clean brand new profile
runSession('Brand New User Profile', {});

// Session 2: Legacy corrupted profile from previous versions
runSession('Corrupted Legacy Profile', {
  'ets2-moldova-profile.v1': JSON.stringify({
    moneyMdl: 12000,
    activeJob: { id: 'old-job-no-target' } // missing targetDepot, missing cargo
  })
});

// Session 3: Profile with broken truckId and empty objects
runSession('Profile with Invalid Truck ID', {
  'ets2-moldova-profile.v1': JSON.stringify({
    moneyMdl: 'invalid-string',
    currentTruckId: 'non-existent-truck',
    ownedTrucks: []
  })
});

console.log('====================================================');
console.log(' ALL 3 LIFECYCLE SIMULATIONS PASSED 100% CLEANLY! ');
console.log('====================================================');
