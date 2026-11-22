/*!
 * ETS2 2D | tools/measure-fps.mjs
 * Measures real rendering performance and section timings over 5 seconds in 3 spots:
 * 1. Город (Chisinau center/streets)
 * 2. Трасса M3 (Highway corridor)
 * 3. Развязка (Cricova multi-level interchange)
 */

import { chromium, firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const LOCATIONS = [
  { name: 'Город (Кишинёв)', x: 1200, y: 2950, angle: -Math.PI / 2, speed: 45 },
  { name: 'Трасса M3', x: 1956, y: 4166, angle: -2.33, speed: 70 },
  { name: 'Развязка (Крикова)', x: 2020, y: -2980, angle: -1.2, speed: 60 }
];

async function measureLocation(page, loc, targetBrowser) {
  // Teleport and let scene settle
  await page.evaluate(({ x, y, angle, speed, name }) => {
    window.executeTeleport(x, y, angle, speed, name);
  }, loc);

  await page.waitForTimeout(1500);

  // Reset perf metrics after settle so 5s test measures steady-state rendering
  await page.evaluate(() => {
    if (window.renderer && window.renderer.perf) {
      window.renderer.perf.sections = { roads: 0, guardrails: 0, markings: 0, entities: 0 };
    }
  });

  // Measure frames and timings over 5 seconds
  const result = await page.evaluate(async (loc) => {
    return new Promise(resolve => {
      let frames = 0;
      const start = performance.now();
      const endTarget = start + 5000;

      const roadSamples = [];
      const guardrailSamples = [];
      const markingSamples = [];
      const entitySamples = [];

      function onFrame(now) {
        frames++;
        if (window.renderer && window.renderer.perf && window.renderer.perf.sections) {
          const s = window.renderer.perf.sections;
          roadSamples.push(s.roads || 0);
          guardrailSamples.push(s.guardrails || 0);
          markingSamples.push(s.markings || 0);
          entitySamples.push(s.entities || 0);
        }

        if (now < endTarget) {
          requestAnimationFrame(onFrame);
        } else {
          const durationSec = (now - start) / 1000;
          const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
          resolve({
            fps: Number((frames / durationSec).toFixed(1)),
            roadsMs: Number(avg(roadSamples).toFixed(2)),
            guardrailsMs: Number(avg(guardrailSamples).toFixed(2)),
            markingsMs: Number(avg(markingSamples).toFixed(2)),
            entitiesMs: Number(avg(entitySamples).toFixed(2)),
            totalFrameMs: Number((1000 / (frames / durationSec)).toFixed(2))
          });
        }
      }

      requestAnimationFrame(onFrame);
    });
  }, loc);

  // Capture screenshot of the scene with F3 HUD perf overlay visible
  const ssDir = path.resolve('screenshots');
  if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
  const safeName = loc.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '_');
  await page.screenshot({ path: path.join(ssDir, `perf-${safeName}-${targetBrowser}.png`) });

  return {
    Локация: loc.name,
    'Браузер': targetBrowser,
    'FPS (кадров/с)': result.fps,
    'Дороги (мс)': result.roadsMs,
    'Отбойники (мс)': result.guardrailsMs,
    'Разметка (мс)': result.markingsMs,
    'Сущности (мс)': result.entitiesMs,
    'Кадр (мс)': result.totalFrameMs
  };
}

async function main() {
  const targetBrowser = process.env.BROWSER || 'firefox';
  console.log('====================================================');
  console.log(` ETS2 2D RENDER PERFORMANCE PROFILER: ${targetBrowser.toUpperCase()} (5 SEC) `);
  console.log('====================================================');

  const launcher = targetBrowser === 'chromium' ? chromium : firefox;
  const browser = await launcher.launch({
    headless: true,
    args: targetBrowser === 'chromium' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 }
  });

  page.on('console', msg => {
    const text = msg.text();
    if (!text.startsWith('[BREAKDOWN') && !text.startsWith('[LINE') && !text.startsWith('[ROUTE')) {
      console.log('BROWSER:', text);
    }
  });
  page.on('pageerror', err => console.error('BROWSER ERROR:', err));

  await page.goto('http://127.0.0.1:4250/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Switch to drive mode & enable F3 perf overlay
  await page.evaluate(() => {
    if (typeof window.launchDrive === 'function') {
      window.launchDrive();
    }
    if (window.renderer) {
      window.renderer.showPerf = true;
    }
  });

  await page.waitForTimeout(500);

  const results = [];
  for (const loc of LOCATIONS) {
    console.log(`Измерение: ${loc.name} в ${targetBrowser} (5 сек)...`);
    const data = await measureLocation(page, loc, targetBrowser);
    results.push(data);
  }

  await browser.close();

  console.log(`\nТАБЛИЦА ПРОИЗВОДИТЕЛЬНОСТИ (${targetBrowser.toUpperCase()}):`);
  console.table(results);

  return results;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
