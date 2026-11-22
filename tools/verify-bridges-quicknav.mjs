import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const SCREENSHOTS_DIR = path.resolve('assets/screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function run() {
  console.log('====================================================');
  console.log('   VERIFY BRIDGES & GMAP QUICKNAV (PLAYWRIGHT)      ');
  console.log('====================================================');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('http://127.0.0.1:4250/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. VERIFY GOOGLE MAPS QUICK NAVIGATION CHIPS
  console.log('\n--- 1. Testing Google Maps Quick Navigation Chips ---');
  await page.evaluate(() => {
    const mapBtn = document.querySelector('.rail-button[data-nav="map"]');
    if (mapBtn) mapBtn.click();
  });
  await page.waitForTimeout(800);

  const chips = [
    { chip: 'truck', label: 'Мой тягач (GPS)', file: 'gmap-chip-truck.png' },
    { chip: 'gas', label: 'Ближайшая АЗС', file: 'gmap-chip-gas.png' },
    { chip: 'depots', label: 'Терминалы и рампы', file: 'gmap-chip-depots.png' },
    { chip: 'peresecina', label: 'Серпантин Пересечина', file: 'gmap-chip-peresecina.png' },
    { chip: 'orhei', label: 'Орхей', file: 'gmap-chip-orhei.png' },
    { chip: 'chisinau', label: 'Кишинёв', file: 'gmap-chip-chisinau.png' }
  ];

  for (const c of chips) {
    console.log(`Clicking chip: [data-chip="${c.chip}"] (${c.label})...`);
    const result = await page.evaluate(async (chipName) => {
      const btn = document.querySelector(`[data-chip="${chipName}"]`);
      if (!btn) return { error: 'Chip not found' };
      btn.click();
      await new Promise(r => setTimeout(r, 400));
      return {
        panX: window.gmapPanX,
        panY: window.gmapPanY,
        zoom: window.gmapZoom,
        active: btn.classList.contains('gmaps-chip-active')
      };
    }, c.chip);

    console.log(`  -> Result:`, result);
    const shotPath = path.join(SCREENSHOTS_DIR, c.file);
    await page.screenshot({ path: shotPath });
    console.log(`  Saved screenshot: ${shotPath}`);
  }

  // 2. VERIFY BRIDGES OVER RIVERS IN DRIVE MODE
  console.log('\n--- 2. Testing Bridges Over Rivers in Driving Render ---');
  await page.evaluate(() => {
    if (typeof window.launchDrive === 'function') {
      window.launchDrive();
    }
  });
  await page.waitForTimeout(1000);

  const bridgeLocations = [
    {
      id: 'bridge-raut-orhei',
      name: 'Мост через реку Рэут (Орхей, M2)',
      x: 1200, y: -51625, angle: -Math.PI / 2, speed: 20,
      file: 'bridge-raut-orhei.png'
    },
    {
      id: 'bridge-nistru-m1',
      name: 'Мост через реку Днестр (Дубоссары, M1)',
      x: 23287.5, y: -10537.5, angle: 0, speed: 20,
      file: 'bridge-nistru-dubasari.png'
    },
    {
      id: 'bridge-nistru-r2',
      name: 'Мост через реку Днестр (Бендеры, R2)',
      x: 32787.5, y: 9887.5, angle: 0.35, speed: 20,
      file: 'bridge-nistru-bender.png'
    },
    {
      id: 'bridge-prut-ungheni',
      name: 'Мост через реку Прут (Унгены, R1)',
      x: -74800, y: 1575, angle: 3.14, speed: 20,
      file: 'bridge-prut-ungheni.png'
    }
  ];

  for (const b of bridgeLocations) {
    console.log(`Teleporting to bridge: ${b.name} at (${b.x}, ${b.y})...`);
    await page.evaluate(({ x, y, angle, speed, name }) => {
      window.executeTeleport(x, y, angle, speed, name);
    }, b);

    await page.waitForTimeout(1500);

    const shotPath = path.join(SCREENSHOTS_DIR, b.file);
    await page.screenshot({ path: shotPath });
    console.log(`  Saved screenshot: ${shotPath}`);
  }

  await browser.close();
  console.log('\nAll checks and screenshots completed successfully!');
}

run().catch(err => {
  console.error('Error running verification:', err);
  process.exit(1);
});
