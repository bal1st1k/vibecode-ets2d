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

  // 1. Navigate to Google Maps Tab
  console.log('[1/4] Navigating to Google Maps & Route Advisor tab...');
  await page.click('[data-nav="map"]');
  await page.waitForTimeout(600);

  // --- Screenshot 1: Full Country Overview (Дальний зум: Fit to bounds) ---
  console.log('[1/6] Capturing Full Country Overview (Дальний зум: Fit to bounds)...');
  await page.evaluate(() => {
    if (typeof window.fitMapToBounds === 'function') {
      window.fitMapToBounds();
    }
  });
  await page.waitForTimeout(600);
  const pathOverview = path.join(SCREENSHOTS_DIR, '01-overview-country.png');
  await page.screenshot({ path: pathOverview });
  console.log(`✔ Saved: ${pathOverview}`);

  // --- Screenshot 2: Regional View (Средний зум) ---
  console.log('[2/6] Capturing Regional View (Средний зум)...');
  await page.evaluate(() => {
    const zoomIn = document.querySelector('#btn-gmaps-zoom-in');
    if (zoomIn) {
      zoomIn.click();
      zoomIn.click();
    }
  });
  await page.waitForTimeout(600);
  const pathCorridor = path.join(SCREENSHOTS_DIR, '02-corridor-chisinau-orhei.png');
  await page.screenshot({ path: pathCorridor });
  console.log(`✔ Saved: ${pathCorridor}`);

  // --- Switch to Driving Mode ---
  console.log('Switching to Drive Mode for track screenshots...');
  await page.click('#btn-gmaps-start-driving');
  await page.waitForTimeout(1000);

  // --- Screenshot 3: M3 Divided Highway (Разделённая трасса M3) ---
  console.log('[3/6] Capturing M3 Divided Highway (Разделённая трасса M3)...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(1458.2, 3352.7, 1.8, 85, 'M3 Разделённая трасса (Южный выезд Кишинёва)');
    }
  });
  await page.waitForTimeout(1000);
  const pathM3Divided = path.join(SCREENSHOTS_DIR, '03-m3-divided.png');
  await page.screenshot({ path: pathM3Divided });
  console.log(`✔ Saved: ${pathM3Divided}`);

  // --- Screenshot 4: M2 Standard Two-Way Highway (Обычная двухполосная M2) ---
  console.log('[4/6] Capturing M2 Standard Two-Way Highway (Обычная двухполосная трасса M2)...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(-2008.9, 5763.7, 1.1, 70, 'M2 Обычная двухполосная трасса (Centura Chișinăului)');
    }
  });
  await page.waitForTimeout(1000);
  const pathM2TwoWay = path.join(SCREENSHOTS_DIR, '04-m2-twoway.png');
  await page.screenshot({ path: pathM2TwoWay });
  console.log(`✔ Saved: ${pathM2TwoWay}`);

  // --- Screenshot 5: Major Interchange near Chișinău (Крупная развязка у Кишинёва / Крикова) ---
  console.log('[5/6] Capturing Major Interchange near Chișinău (Крупная развязка у Кишинёва / Cricova M1-M2-R6)...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(2020, -2980, -1.2, 50, 'Крупная развязка у Кишинёва (Узел Крикова)');
    }
  });
  await page.waitForTimeout(1000);
  const pathInterchange = path.join(SCREENSHOTS_DIR, '05-cricova-interchange.png');
  await page.screenshot({ path: pathInterchange });
  console.log(`✔ Saved: ${pathInterchange}`);

  // --- Screenshot 6: Two-Way Highway at Măgdăcești ---
  console.log('[6/6] Capturing Highway at Măgdăcești...');
  await page.evaluate(() => {
    if (typeof window.executeTeleport === 'function') {
      window.executeTeleport(1244, -4736, -1.96, 75, 'Трасса у Мэгдачешть');
    }
  });
  await page.waitForTimeout(1000);
  const pathMagdacesti = path.join(SCREENSHOTS_DIR, '06-m2-magdacesti.png');
  await page.screenshot({ path: pathMagdacesti });
  console.log(`✔ Saved: ${pathMagdacesti}`);

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
