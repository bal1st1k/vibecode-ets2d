/* ETS2 2D | Job Market Contracts Origin/Target ID Verification */
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
  getContext() {
    return {
      canvas: this,
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      setTransform() {}, fillRect() {}, strokeRect() {}, beginPath() {},
      closePath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {},
      fill() {}, fillText() {}, setLineDash() {}, clearRect() {}, rect() {},
      roundRect() {}, measureText() { return { width: 40 }; }
    };
  }
}

const elementsMap = {};
function getEl(sel) {
  if (!sel) return new MockElement('div');
  if (!elementsMap[sel]) {
    const tag = String(sel).includes('canvas') ? 'canvas' : 'div';
    elementsMap[sel] = new MockElement(tag);
  }
  return elementsMap[sel];
}

console.log('====================================================');
console.log('   JOB MARKET CONTRACTS VERIFICATION SUITE         ');
console.log('====================================================');

const osmData = JSON.parse(fs.readFileSync(path.join(base, 'data/moldova-map.json'), 'utf8'));

const sandbox = {
  OSM_MOLDOVA_MAP: osmData,
  window: { OSM_MOLDOVA_MAP: osmData },
  document: {
    querySelector: getEl,
    querySelectorAll: sel => [getEl(sel)],
    getElementById: id => getEl('#' + id),
    createElement: tag => new MockElement(tag),
    addEventListener: () => {},
    body: new MockElement('body')
  },
  navigator: { userAgent: 'node' },
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: () => {},
  cancelAnimationFrame: () => {},
  performance: { now: () => Date.now() },
  console,
  Math,
  Date,
  setTimeout: fn => setTimeout(fn, 0),
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
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(mapCode, sandbox);
vm.runInContext(trucksCode, sandbox);
vm.runInContext(engineCode, sandbox);
vm.runInContext(rendererCode, sandbox);
vm.runInContext(audioCode, sandbox);
vm.runInContext(appCode, sandbox);

// Navigate to jobs to trigger renderJobMarket
sandbox.navigate('jobs');

const contracts = sandbox.jobContracts;
assert(Array.isArray(contracts), 'jobContracts must be an array');
assert.equal(contracts.length, 6, 'There must be exactly 6 job market contracts');

const EXPECTED_CONTRACTS = [
  {
    name: 'Кишинёв -> Орхей',
    originId: 'depot-chisinau-center',
    originCity: 'Chișinău',
    targetId: 'depot-orhei-central',
    targetCity: 'Orhei'
  },
  {
    name: 'Кишинёв -> Бельцы',
    originId: 'depot-chisinau-center',
    originCity: 'Chișinău',
    targetId: 'depot-balti-north',
    targetCity: 'Bălți'
  },
  {
    name: 'Унгены -> Кишинёв',
    originId: 'depot-ungheni-west',
    originCity: 'Ungheni',
    targetId: 'depot-chisinau-center',
    targetCity: 'Chișinău'
  },
  {
    name: 'Бельцы -> Кагул',
    originId: 'depot-balti-north',
    originCity: 'Bălți',
    targetId: 'depot-cahul-south',
    targetCity: 'Cahul'
  },
  {
    name: 'Орхей -> Унгены',
    originId: 'depot-orhei-central',
    originCity: 'Orhei',
    targetId: 'depot-ungheni-west',
    targetCity: 'Ungheni'
  },
  {
    name: 'Тирасполь -> Орхей',
    originId: 'depot-tiraspol-east',
    originCity: 'Tiraspol',
    targetId: 'depot-orhei-central',
    targetCity: 'Orhei'
  }
];

EXPECTED_CONTRACTS.forEach((exp, idx) => {
  const c = contracts[idx];
  assert(c, `Contract ${idx} (${exp.name}) must exist`);

  assert.equal(
    c.origin.id,
    exp.originId,
    `Contract ${idx} (${exp.name}): origin.id (${c.origin.id}) must equal ${exp.originId}`
  );
  assert.equal(
    c.origin.cityName,
    exp.originCity,
    `Contract ${idx} (${exp.name}): origin.cityName (${c.origin.cityName}) must equal ${exp.originCity}`
  );

  assert.equal(
    c.target.id,
    exp.targetId,
    `Contract ${idx} (${exp.name}): target.id (${c.target.id}) must equal ${exp.targetId}`
  );
  assert.equal(
    c.target.cityName,
    exp.targetCity,
    `Contract ${idx} (${exp.name}): target.cityName (${c.target.cityName}) must equal ${exp.targetCity}`
  );

  console.log(`PASS Contract ${idx + 1}: ${exp.name} [${c.origin.id} (${c.origin.cityName}) -> ${c.target.id} (${c.target.cityName})]`);
});

// Also verify starter job
assert(sandbox.profile.activeJob, 'Default starter job must exist');
assert.equal(sandbox.profile.activeJob.originDepot.id, 'depot-chisinau-center');
assert.equal(sandbox.profile.activeJob.targetDepot.id, 'depot-orhei-central');
console.log('PASS Starter job: Chișinău -> Orhei [depot-chisinau-center -> depot-orhei-central]');

console.log('\n====================================================');
console.log(' ALL JOB MARKET CONTRACT CHECKS PASSED SUCCESSFULLY! ');
console.log('====================================================');
