import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const SCREENSHOTS_DIR = path.resolve('assets/screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const LOCATIONS = [
  {
    name: 'Центр Кишинёва',
    file: 'rescale-chisinau-center.png',
    x: 1200, y: 3000, angle: -Math.PI / 2, speed: 0,
    desc: 'Городская сеть: бульвар Штефан чел Маре и параллельные улицы'
  },
  {
    name: 'Трасса M3',
    file: 'rescale-m3-highway.png',
    x: 2996, y: 5769, angle: -2.33, speed: 70,
    desc: 'Разделённая скоростная трасса M3 с разделителем и отбойниками'
  },
  {
    name: 'Развязка (Крикова)',
    file: 'rescale-cricova-interchange.png',
    x: 3148, y: -11203, angle: -1.2, speed: 50,
    desc: 'Многоуровневая развязка M1 / M2'
  }
];

async function main() {
  console.log('====================================================');
  console.log('   ETS2 2D RESCALE 1:8 VERIFICATION SCREENSHOTS     ');
  console.log('====================================================');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  await page.goto('http://127.0.0.1:4250/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Switch to Drive
  await page.evaluate(() => {
    if (typeof window.launchDrive === 'function') {
      window.launchDrive();
    } else {
      const btn = document.querySelector('#start-drive') || document.querySelector('#btn-admin-to-drive');
      if (btn) btn.click();
    }
  });
  await page.waitForTimeout(1200);

  const TRUCK_LENGTH = 68; // px

  for (const loc of LOCATIONS) {
    console.log(`\nCapturing: ${loc.name} at (${loc.x}, ${loc.y})...`);

    // Teleport
    await page.evaluate(({ x, y, angle, speed, name }) => {
      window.executeTeleport(x, y, angle, speed, name);
    }, loc);

    await page.waitForTimeout(1500);

    // Measure distance between parallel roads visible near player
    const stats = await page.evaluate(({ locX, locY, TRUCK_LENGTH }) => {
      const map = window.ETSMap;
      const edges = (map && map.OSM && map.OSM.edges) || (map && map.edges) || [];
      const nearby = edges.filter(e => {
        const b = e.bounds;
        return b && Math.abs((b[0] + b[2]) / 2 - locX) < 1500 && Math.abs((b[1] + b[3]) / 2 - locY) < 1500;
      });

      // Find pairs of parallel non-link edges
      const pairs = [];
      for (let i = 0; i < nearby.length; i++) {
        for (let j = i + 1; j < nearby.length; j++) {
          const e1 = nearby[i];
          const e2 = nearby[j];
          if (e1.id === e2.id) continue;
          if (e1.roadClass.endsWith('_link') || e2.roadClass.endsWith('_link')) continue;
          // Dual carriageways of the same divided highway have median divider (50-100 px)
          if (e1.oneway && e2.oneway && e1.ref && e1.ref === e2.ref) continue;
          if (e1.name && e2.name && e1.name === e2.name) continue;

          // Check if lines are roughly parallel (angle diff < 0.35 rad)
          const p1a = e1.points[0], p1b = e1.points[e1.points.length - 1];
          const p2a = e2.points[0], p2b = e2.points[e2.points.length - 1];
          const a1 = Math.atan2(p1b[1] - p1a[1], p1b[0] - p1a[0]);
          const a2 = Math.atan2(p2b[1] - p2a[1], p2b[0] - p2a[0]);
          let diff = Math.abs(a1 - a2);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          const isParallel = diff < 0.35 || Math.abs(diff - Math.PI) < 0.35;
          if (!isParallel) continue;

          // Distance between midpoints
          const m1 = [(p1a[0] + p1b[0]) / 2, (p1a[1] + p1b[1]) / 2];
          const m2 = [(p2a[0] + p2b[0]) / 2, (p2a[1] + p2b[1]) / 2];
          const dist = Math.hypot(m1[0] - m2[0], m1[1] - m2[1]);
          if (dist > 50 && dist < 1200) {
            pairs.push({
              e1: e1.ref || e1.name || e1.roadClass,
              e2: e2.ref || e2.name || e2.roadClass,
              dist: Math.round(dist)
            });
          }
        }
      }

      pairs.sort((a, b) => a.dist - b.dist);
      const minDist = pairs.length > 0 ? pairs[0].dist : null;
      return {
        nearbyCount: nearby.length,
        parallelPairsCount: pairs.length,
        minDist,
        minDistTruckLengths: minDist ? (minDist / TRUCK_LENGTH).toFixed(1) : null,
        topPairs: pairs.slice(0, 3)
      };
    }, { locX: loc.x, locY: loc.y, TRUCK_LENGTH });

    const outPath = path.join(SCREENSHOTS_DIR, loc.file);
    await page.screenshot({ path: outPath });
    console.log(`✔ Saved screenshot: ${outPath}`);
    console.log(`  - Nearby roads in view: ${stats.nearbyCount}`);
    console.log(`  - Parallel road pairs: ${stats.parallelPairsCount}`);
    if (stats.minDist) {
      console.log(`  - Min parallel distance: ${stats.minDist} px (${stats.minDistTruckLengths} truck lengths, >= 2.0 required)`);
      for (const p of stats.topPairs) {
        console.log(`    * [${p.e1}] <-> [${p.e2}]: ${p.dist} px (${(p.dist / TRUCK_LENGTH).toFixed(1)} тягача)`);
      }
    }
  }

  await browser.close();
  console.log('\nAll rescale verification screenshots captured successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
