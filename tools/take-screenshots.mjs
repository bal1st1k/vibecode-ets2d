/*!
 * ETS2 2D | tools/take-screenshots.mjs
 * Captures high-resolution Playwright screenshots at different zoom levels:
 * 1. Full Country Overview (OSM Moldova Road Network)
 * 2. Highway M2 Corridor (Chișinău -> Orhei A* Navigation Route)
 * 3. Close Tactical View (Orhei Junction & Curves)
 * 4. In-Cab Driving View
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'assets/screenshots');

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function takeScreenshots() {
  console.log('====================================================');
  console.log('   PLAYWRIGHT AUTOMATED CANVAS SCREENSHOT RUNNER    ');
  console.log('====================================================');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2 // High DPI for crisp screenshot rendering
  });

  const url = 'http://127.0.0.1:4250/';
  console.log(`Navigating to ${url}...`);

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. Task 1: Dealership View with purchased truck (after +250k cheat)
  console.log('[1/6] Task 1: Dealership View with purchased truck...');
  await page.click('[data-nav="dealer"]');
  await page.waitForTimeout(600);

  // Trigger cheat +250k and buy cheapest truck
  await page.evaluate(() => {
    if (window.profile && window.ETSTrucks && window.ETSTrucks.ALL_TRUCKS) {
      window.profile.moneyMdl += 250000;
      const cheapest = [...window.ETSTrucks.ALL_TRUCKS].sort((a, b) => a.priceMdl - b.priceMdl)[0];
      if (!window.profile.ownedTrucks.includes(cheapest.id)) {
        window.profile.ownedTrucks.push(cheapest.id);
        window.profile.moneyMdl -= cheapest.priceMdl;
        window.profile.currentTruckId = cheapest.id;
      }
      window.saveProfile();
      window.renderDealer();
    }
  });
  await page.waitForTimeout(600);
  const pathTask1 = path.join(SCREENSHOTS_DIR, 'task1-truck-dealer.png');
  await page.screenshot({ path: pathTask1 });
  console.log(`✔ Saved: ${pathTask1}`);

  // Switch to Drive Mode
  console.log('Switching to Drive Mode for in-world tasks...');
  await page.evaluate(() => {
    if (typeof window.launchDrive === 'function') {
      window.launchDrive();
    } else {
      const btn = document.querySelector('#start-drive') || document.querySelector('#btn-admin-to-drive');
      if (btn) btn.click();
    }
  });
  await page.waitForTimeout(1000);

  // 2. Task 2: Gas Station offset w/2 + 30 px
  console.log('[2/6] Task 2: Gas Station offset by w/2 + 30 px...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      // Teleport near Lukoil station on main road
      window.executeTeleport(831, 1315, -Math.PI / 2, 0, 'АЗС Лукойл (смещение w/2 + 30 px)');
    }
  });
  await page.waitForTimeout(1000);
  const pathTask2 = path.join(SCREENSHOTS_DIR, 'task2-gas-station.png');
  await page.screenshot({ path: pathTask2 });
  console.log(`✔ Saved: ${pathTask2}`);

  // 3. Task 3: Guardrails trimmed at w/2 + 20 px near 3+ junctions
  console.log('[3/6] Task 3: Guardrails trimmed near 3+ junction...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(2020, -2980, -1.2, 50, 'Развязка Крикова (отбойники обрезаны w/2 + 20 px)');
    }
  });
  await page.waitForTimeout(1000);
  const pathTask3 = path.join(SCREENSHOTS_DIR, 'task3-guardrails-junction.png');
  await page.screenshot({ path: pathTask3 });
  console.log(`✔ Saved: ${pathTask3}`);

  // 4. Task 4: Russian Roadside Signs ("Перекрёсток 150м ↗")
  console.log('[4/6] Task 4: Russian Signs («Перекрёсток»)...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(1826, 840, -1.359, 0, 'Дорожный знак «Перекрёсток»');
    }
  });
  await page.waitForTimeout(1000);
  const pathTask4 = path.join(SCREENSHOTS_DIR, 'task4-russian-signs.png');
  await page.screenshot({ path: pathTask4 });
  console.log(`✔ Saved: ${pathTask4}`);

  // 5. Task 5: In-world Route (wide green glow + bright line + chevrons + next turn badge)
  console.log('[5/6] Task 5: In-world Active Route Navigation & Next Turn Badge...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(1244, -4736, -1.96, 70, 'Маршрут в мире (Мэгдачешть)');
    }
  });
  await page.waitForTimeout(1000);
  const pathTask5 = path.join(SCREENSHOTS_DIR, 'task5-world-route.png');
  await page.screenshot({ path: pathTask5 });
  console.log(`✔ Saved: ${pathTask5}`);

  // 6. Task 6: HUD Mini-Map in top right corner (circular 220 px, 3000 px range)
  console.log('[6/6] Task 6: HUD Mini-Map (220 px circular, top right)...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(1458.2, 3352.7, 1.8, 80, 'Мини-карта в HUD');
    }
  });
  await page.waitForTimeout(1000);
  const pathTask6 = path.join(SCREENSHOTS_DIR, 'task6-hud-minimap.png');
  await page.screenshot({ path: pathTask6 });
  console.log(`✔ Saved: ${pathTask6}`);

  await browser.close();
  console.log('====================================================');
  console.log('✔ ALL SCREENSHOTS SUCCESSFULLY CAPTURED IN:');
  console.log(`  ${SCREENSHOTS_DIR}`);
  console.log('====================================================');
}

takeScreenshots().catch(err => {
  console.error('Playwright Error:', err);
  process.exit(1);
});
