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

  // --- Screenshot 1: Full Country Overview ---
  console.log('[2/4] Capturing 1: Overview Country (Zoom out)...');
  await page.evaluate(() => {
    // Zoom out to see full country
    window.location.hash = '#map';
    const canvas = document.querySelector('#world-map-canvas');
    if (canvas) {
      // Trigger zoom out via synthetic events or click
      const zoomOut = document.querySelector('#btn-gmaps-zoom-out');
      if (zoomOut) {
        for (let i = 0; i < 4; i++) zoomOut.click();
      }
    }
  });
  await page.waitForTimeout(800);
  const pathOverview = path.join(SCREENSHOTS_DIR, '01-overview-country.png');
  await page.screenshot({ path: pathOverview });
  console.log(`✔ Saved: ${pathOverview}`);

  // --- Screenshot 2: Chișinău - Orhei Corridor (Traseul M2) ---
  console.log('[3/4] Capturing 2: Chișinău — Orhei M2 Highway Corridor...');
  await page.evaluate(() => {
    const zoomIn = document.querySelector('#btn-gmaps-zoom-in');
    if (zoomIn) {
      for (let i = 0; i < 3; i++) zoomIn.click();
    }
  });
  await page.waitForTimeout(800);
  const pathCorridor = path.join(SCREENSHOTS_DIR, '02-corridor-chisinau-orhei.png');
  await page.screenshot({ path: pathCorridor });
  console.log(`✔ Saved: ${pathCorridor}`);

  // --- Screenshot 3: Close Zoom on Orhei Curves & Depot ---
  console.log('[4/4] Capturing 3: Close Tactical View (Orhei curves & depot)...');
  await page.evaluate(() => {
    const zoomIn = document.querySelector('#btn-gmaps-zoom-in');
    if (zoomIn) {
      for (let i = 0; i < 3; i++) zoomIn.click();
    }
  });
  await page.waitForTimeout(800);
  const pathClose = path.join(SCREENSHOTS_DIR, '03-close-orhei-curves.png');
  await page.screenshot({ path: pathClose });
  console.log(`✔ Saved: ${pathClose}`);

  // --- Screenshot 4: In-Cab Driving Simulation ---
  console.log('[Bonus] Capturing 4: Driving simulation on real road...');
  await page.click('#btn-gmaps-start-driving');
  await page.waitForTimeout(1200);
  const pathDrive = path.join(SCREENSHOTS_DIR, '04-driving-simulation.png');
  await page.screenshot({ path: pathDrive });
  console.log(`✔ Saved: ${pathDrive}`);

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
