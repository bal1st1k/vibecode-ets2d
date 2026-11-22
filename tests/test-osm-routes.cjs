/* ETS2 2D | OSM Route Verification (Chișinău - Orhei & Chișinău - Bălți) */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const osmData = JSON.parse(fs.readFileSync(path.join(base, 'data/moldova-map.json'), 'utf8'));

// Build adjacency
const adj = new Map();
for (const edge of osmData.edges) {
  const f = String(edge.from);
  const t = String(edge.to);
  if (!adj.has(f)) adj.set(f, []);
  adj.get(f).push({ to: t, weight: edge.length, edge, reverse: false });
  if (!edge.oneway) {
    if (!adj.has(t)) adj.set(t, []);
    adj.get(t).push({ to: f, weight: edge.length, edge, reverse: true });
  }
}

class MinHeap {
  constructor() { this.heap = []; }
  push(item) { this.heap.push(item); this._bubbleUp(this.heap.length - 1); }
  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) { this.heap[0] = bottom; this._sinkDown(0); }
    return top;
  }
  get size() { return this.heap.length; }
  _bubbleUp(idx) {
    while (idx > 0) {
      const pIdx = (idx - 1) >> 1;
      if (this.heap[idx].f >= this.heap[pIdx].f) break;
      [this.heap[idx], this.heap[pIdx]] = [this.heap[pIdx], this.heap[idx]];
      idx = pIdx;
    }
  }
  _sinkDown(idx) {
    const len = this.heap.length;
    while (true) {
      const left = (idx << 1) + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < len && this.heap[left].f < this.heap[smallest].f) smallest = left;
      if (right < len && this.heap[right].f < this.heap[smallest].f) smallest = right;
      if (smallest === idx) break;
      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
      idx = smallest;
    }
  }
}

function findNearestNode(x, y) {
  let closest = null;
  let minDist = Infinity;
  for (const nid in osmData.nodes) {
    const [nx, ny] = osmData.nodes[nid];
    const d = Math.hypot(nx - x, ny - y);
    if (d < minDist) {
      minDist = d;
      closest = nid;
    }
  }
  return closest;
}

function findRoute(startNode, endNode) {
  startNode = String(startNode);
  endNode = String(endNode);
  const t0 = performance.now();
  const dist = new Map();
  const prev = new Map();
  const pq = new MinHeap();
  dist.set(startNode, 0);

  const endPt = osmData.nodes[endNode];
  const h0 = endPt ? Math.hypot(osmData.nodes[startNode][0] - endPt[0], osmData.nodes[startNode][1] - endPt[1]) : 0;
  pq.push({ node: startNode, cost: 0, f: h0 });

  while (pq.size > 0) {
    const { node, cost } = pq.pop();
    if (node === endNode) {
      const pathEdges = [];
      const polyline = [];
      let cur = endNode;
      while (prev.has(cur)) {
        const { from, edge, reverse } = prev.get(cur);
        pathEdges.unshift(edge);
        const pts = reverse ? [...edge.points].reverse() : edge.points;
        for (let p = pts.length - 1; p >= 0; p--) polyline.unshift(pts[p]);
        cur = from;
      }
      const dt = performance.now() - t0;
      return { found: true, totalLength: dist.get(endNode), edges: pathEdges, polyline, dt };
    }
    if (cost > dist.get(node)) continue;
    for (const { to, weight, edge, reverse } of (adj.get(node) || [])) {
      const nextCost = cost + weight;
      if (!dist.has(to) || nextCost < dist.get(to)) {
        dist.set(to, nextCost);
        prev.set(to, { from: node, edge, reverse });
        const toPt = osmData.nodes[to];
        const h = toPt && endPt ? Math.hypot(toPt[0] - endPt[0], toPt[1] - endPt[1]) : 0;
        pq.push({ node: to, cost: nextCost, f: nextCost + h });
      }
    }
  }
  return null;
}

const mapScale = (osmData.meta && osmData.meta.mapScale) || 1.25;
const S = mapScale / (10 / 19);

const nChi = findNearestNode(1200 + (1200 - 1200) * S, 3000 + (2950 - 3000) * S);
const nOrh = findNearestNode(1200 + (1180 - 1200) * S, 3000 + (-20650 - 3000) * S);
const nBalti = findNearestNode(1200 + (-24800 - 1200) * S, 3000 + (-58200 - 3000) * S);

console.log('====================================================');
console.log('   OSM REAL ROAD NETWORK ROUTING VERIFICATION      ');
console.log('====================================================\n');

// 1. Chișinău to Orhei
const rOrhei = findRoute(nChi, nOrh);
const kmOrhei = rOrhei ? rOrhei.edges.reduce((s, e) => s + (e.lengthM || (e.length / mapScale)), 0) / 1000 : 0;
console.log('ROUTE 1: Chișinău -> Orhei (Traseul M2 / R6)');
console.log(`- Time to compute: ${rOrhei.dt.toFixed(2)} ms`);
console.log(`- Total length: ${rOrhei.totalLength.toFixed(1)} units (${kmOrhei.toFixed(1)} km)`);
console.log(`- Road edges count: ${rOrhei.edges.length}`);
console.log(`- Polyline points: ${rOrhei.polyline.length}`);
const orheiNames = [...new Set(rOrhei.edges.map(e => e.ref || e.name || e.roadClass).filter(Boolean))];
console.log(`- Corridor: ${orheiNames.join(' -> ')}`);
console.log('');

// 2. Chișinău to Bălți
const rBalti = findRoute(nChi, nBalti);
const kmBalti = rBalti ? rBalti.edges.reduce((s, e) => s + (e.lengthM || (e.length / mapScale)), 0) / 1000 : 0;
console.log('ROUTE 2: Chișinău -> Bălți (Traseul M5 / R6)');
console.log(`- Time to compute: ${rBalti.dt.toFixed(2)} ms`);
console.log(`- Total length: ${rBalti.totalLength.toFixed(1)} units (${kmBalti.toFixed(1)} km)`);
console.log(`- Road edges count: ${rBalti.edges.length}`);
console.log(`- Polyline points: ${rBalti.polyline.length}`);
const baltiNames = [...new Set(rBalti.edges.map(e => e.ref || e.name || e.roadClass).filter(Boolean))];
console.log(`- Corridor: ${baltiNames.slice(0, 8).join(' -> ')} ... ${baltiNames.slice(-4).join(' -> ')}`);
console.log('');

module.exports = { findRoute, findNearestNode, osmData };
