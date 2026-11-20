/*! 2D ETS2 Moldova Edition | Main Application Controller & Shell */
(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const map = ETSMap;
  const trucksCatalog = ETSTrucks;
  const sim = new ETSEngine.TruckSimulation(map);
  const audio = new ETSAudio();
  const canvas = $('#game-canvas');
  const renderer = new ETSRenderer(canvas);

  // Storage key
  const STORAGE_KEY = 'ets2-moldova-profile.v1';

  // Load or initialize career profile
  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      moneyMdl: 48500,
      level: 1,
      xp: 240,
      totalDeliveries: 3,
      ownedTrucks: ['kamaz-54901'],
      currentTruckId: 'kamaz-54901',
      truckTunings: {}, // truckId: { bonusHp: 0 }
      activeJob: null
    };
  }

  const profile = loadProfile();

  function saveProfile() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (_) {}
    $('#wallet-amount').textContent = `${profile.moneyMdl.toLocaleString()} MDL`;
  }

  // Activate starting truck in simulation
  const startingTruck = trucksCatalog.getTruck(profile.currentTruckId);
  sim.setTruckModel(startingTruck);
  if (profile.truckTunings[startingTruck.id]?.bonusHp) {
    sim.truck.powerHp += profile.truckTunings[startingTruck.id].bonusHp;
  }

  // Navigation Tabs System
  let activeTab = 'drive';
  const modalMap = {
    jobs: $('#modal-jobs'),
    map: $('#modal-map'),
    garage: $('#modal-garage'),
    dealer: $('#modal-dealer'),
    help: $('#modal-help')
  };

  function switchTab(tabName) {
    activeTab = tabName;
    $$('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Close all modals first
    Object.values(modalMap).forEach(modal => modal?.classList.remove('active'));

    if (tabName !== 'drive' && modalMap[tabName]) {
      modalMap[tabName].classList.add('active');

      // Populate content depending on tab
      if (tabName === 'jobs') renderJobList();
      if (tabName === 'map') renderWorldMap();
      if (tabName === 'garage') renderGarage();
      if (tabName === 'dealer') renderDealer();
    }
  }

  $$('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => switchTab('drive'));
  });

  // Keyboard input state
  const keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    reverse: false
  };

  window.addEventListener('keydown', e => {
    // Unlock audio on first interaction
    audio.unlock();

    if (e.repeat) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.up = true; break;
      case 'KeyS': case 'ArrowDown': keys.down = true; break;
      case 'KeyA': case 'ArrowLeft': keys.left = true; break;
      case 'KeyD': case 'ArrowRight': keys.right = true; break;
      case 'KeyR':
        sim.truck.gear = sim.truck.gear === -1 ? 1 : -1;
        keys.reverse = sim.truck.gear === -1;
        toast(keys.reverse ? 'Передача: ЗАДНИЙ ХОД [R]' : 'Передача: ВПЕРЁД [D]');
        break;
      case 'KeyT':
        const res = sim.toggleHitch();
        toast(res.msg, !res.ok);
        break;
      case 'KeyL':
        sim.truck.lights = (sim.truck.lights + 1) % 3;
        const lightLabels = ['Фары ВЫКЛ', 'Ближний свет', 'Дальний свет'];
        toast(lightLabels[sim.truck.lights]);
        break;
      case 'KeyQ':
        sim.truck.turnSignal = (sim.truck.turnSignal === -1) ? 0 : -1;
        break;
      case 'KeyE':
        sim.truck.turnSignal = (sim.truck.turnSignal === 1) ? 0 : 1;
        break;
      case 'KeyF':
        sim.truck.turnSignal = (sim.truck.turnSignal === 2) ? 0 : 2;
        break;
      case 'KeyH':
        sim.truck.horn = true;
        break;
      case 'Space':
        sim.truck.parkingBrake = !sim.truck.parkingBrake;
        toast(sim.truck.parkingBrake ? 'Стояночный тормоз ВКЛ' : 'Стояночный тормоз СНЯТ');
        break;
      case 'KeyM':
        switchTab(activeTab === 'map' ? 'drive' : 'map');
        break;
      case 'Escape':
        switchTab('drive');
        break;
    }
  });

  window.addEventListener('keyup', e => {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.up = false; break;
      case 'KeyS': case 'ArrowDown': keys.down = false; break;
      case 'KeyA': case 'ArrowLeft': keys.left = false; break;
      case 'KeyD': case 'ArrowRight': keys.right = false; break;
      case 'KeyH': sim.truck.horn = false; break;
    }
  });

  // In-game toast notifications
  let toastTimer = 0;
  function toast(text, isError = false) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.className = isError ? 'show error' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3200);
  }

  // 1. DELIVERY & FREIGHT MARKET
  function startJob(job) {
    profile.activeJob = job;
    sim.trailer.attached = true;
    sim.trailer.cargo = job.cargo;
    sim.trailer.cargoWeightKg = job.cargo.weightKg;
    sim.trailer.cargoDamage = 0;
    saveProfile();
    switchTab('drive');
    toast(`Взят заказ: ${job.cargo.nameRu} → ${job.targetCityName} (${job.rewardMdl.toLocaleString()} MDL)`);
  }

  function completeJob() {
    if (!profile.activeJob) return;
    const job = profile.activeJob;
    const damagePenalty = (100 - sim.trailer.cargoDamage) / 100;
    const finalReward = Math.round(job.rewardMdl * Math.max(0.2, damagePenalty));

    profile.moneyMdl += finalReward;
    profile.totalDeliveries++;
    profile.xp += 180;
    profile.activeJob = null;
    sim.trailer.cargo = null;

    saveProfile();
    audio.playRelayClick(true);
    toast(`Груз успешно доставлен! Выплата: ${finalReward.toLocaleString()} MDL (Повреждения: ${Math.round(sim.trailer.cargoDamage)}%)`);
  }

  function checkDepotDelivery() {
    if (!profile.activeJob) return;
    const target = profile.activeJob.targetDepot;
    const dist = Math.hypot(sim.truck.x - target.x, sim.truck.y - target.y);

    const promptEl = $('#delivery-prompt');
    if (dist < 95 && Math.abs(sim.truck.speed) < 6) {
      promptEl.classList.add('visible');
      promptEl.textContent = `[РАМПА] Нажмите ПРОБЕЛ для сдачи груза (${profile.activeJob.rewardMdl.toLocaleString()} MDL)`;
      if (sim.truck.parkingBrake) {
        completeJob();
        promptEl.classList.remove('visible');
      }
    } else {
      promptEl.classList.remove('visible');
    }
  }

  function renderJobList() {
    const list = $('#job-list');
    list.innerHTML = '';
    const depots = map.getAllDepots ? map.getAllDepots() : [];
    if (!depots.length) return;

    const contracts = [
      {
        id: 'job-1',
        cargo: map.CARGO_CATALOG[0],
        originCity: 'Chișinău',
        originDepot: depots[0],
        targetCityName: 'Orhei',
        targetDepot: depots[1] || depots[0],
        rewardMdl: 4800,
        distKm: 45
      },
      {
        id: 'job-2',
        cargo: map.CARGO_CATALOG[1],
        originCity: 'Orhei',
        originDepot: depots[1] || depots[0],
        targetCityName: 'Chișinău',
        targetDepot: depots[0],
        rewardMdl: 4200,
        distKm: 45
      },
      {
        id: 'job-3',
        cargo: map.CARGO_CATALOG[2],
        originCity: 'Chișinău',
        originDepot: depots[0],
        targetCityName: 'Orhei',
        targetDepot: depots[1] || depots[0],
        rewardMdl: 6500,
        distKm: 45
      }
    ];

    contracts.forEach(contract => {
      const card = document.createElement('div');
      card.className = 'job-card';
      card.innerHTML = `
        <div class="job-info">
          <h4>${contract.cargo.nameRu}</h4>
          <p class="job-route">${contract.originCity} → <strong>${contract.targetCityName}</strong> (${contract.targetDepot.name})</p>
          <p class="job-meta">Тип: ${contract.cargo.type} | Масса: ${(contract.cargo.weightKg / 1000).toFixed(1)} т | Дистанция: ~${contract.distKm} км (масштаб 1:19)</p>
        </div>
        <div class="job-pay">
          <span class="pay-amount">${contract.rewardMdl.toLocaleString()} MDL</span>
          <button class="btn-take-job">ВЗЯТЬ РЕЙС</button>
        </div>
      `;
      card.querySelector('.btn-take-job').addEventListener('click', () => startJob(contract));
      list.appendChild(card);
    });
  }

  // 2. WORLD MAP VIEWER
  function renderWorldMap() {
    const mapCanvas = $('#world-map-canvas');
    if (!mapCanvas) return;
    const ctx = mapCanvas.getContext('2d');
    const w = mapCanvas.width = mapCanvas.clientWidth || 800;
    const h = mapCanvas.height = mapCanvas.clientHeight || 440;

    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(0, 0, w, h);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const road of map.ROADS) {
      for (const p of road.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
    }
    minX = Math.min(minX, sim.truck.x) - 400;
    maxX = Math.max(maxX, sim.truck.x) + 400;
    minY = Math.min(minY, sim.truck.y) - 400;
    maxY = Math.max(maxY, sim.truck.y) + 400;

    const toMapX = x => ((x - minX) / (maxX - minX)) * (w - 80) + 40;
    const toMapY = y => ((y - minY) / (maxY - minY)) * (h - 80) + 40;

    // Draw Roads
    ctx.lineWidth = 4;
    for (const road of map.ROADS) {
      ctx.strokeStyle = '#283139';
      ctx.beginPath();
      road.points.forEach((pt, i) => {
        const mx = toMapX(pt.x), my = toMapY(pt.y);
        if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      });
      ctx.stroke();
    }

    // Active GPS Route Line
    if (profile.activeJob && profile.activeJob.targetDepot) {
      const target = profile.activeJob.targetDepot;
      ctx.strokeStyle = '#55e6c3';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(toMapX(sim.truck.x), toMapY(sim.truck.y));
      ctx.lineTo(toMapX(target.x), toMapY(target.y));
      ctx.stroke();
      ctx.setLineDash([]);

      const tx = toMapX(target.x), ty = toMapY(target.y);
      ctx.fillStyle = '#d4ff42';
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Cities
    for (const city of (map.CITIES || [])) {
      const cx = toMapX(city.x), cy = toMapY(city.y);
      ctx.fillStyle = '#f0f2ec';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#7e8a8f';
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(city.name, cx, cy - 8);
    }

    // Player Truck Position
    const px = toMapX(sim.truck.x), py = toMapY(sim.truck.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(sim.truck.angle);
    ctx.fillStyle = '#55e6c3';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 3. GARAGE SYSTEM
  function renderGarage() {
    const listEl = $('#garage-trucks-list');
    listEl.innerHTML = '';

    profile.ownedTrucks.forEach(truckId => {
      const model = trucksCatalog.getTruck(truckId);
      const isSelected = profile.currentTruckId === truckId;
      const bonus = profile.truckTunings[truckId]?.bonusHp || 0;

      const item = document.createElement('div');
      item.className = isSelected ? 'truck-list-item selected' : 'truck-list-item';
      item.innerHTML = `
        <h5>${model.name} ${isSelected ? '★ [АКТИВЕН]' : ''}</h5>
        <span>${model.powerHp + bonus} л.с. · ${model.axles} · Бак ${model.fuelCapacity} л</span>
      `;
      item.addEventListener('click', () => selectGarageTruck(truckId));
      listEl.appendChild(item);
    });

    selectGarageTruck(profile.currentTruckId);
  }

  let inspectedTruckId = profile.currentTruckId;
  function selectGarageTruck(truckId) {
    inspectedTruckId = truckId;
    const model = trucksCatalog.getTruck(truckId);
    const bonus = profile.truckTunings[truckId]?.bonusHp || 0;
    const isCurrent = profile.currentTruckId === truckId;

    $('#detail-truck-name').textContent = model.name;
    $('#detail-truck-desc').textContent = model.description;
    $('#detail-power').textContent = `${model.powerHp + bonus} л.с. ${bonus > 0 ? `(+${bonus} чип)` : ''}`;
    $('#detail-torque').textContent = `${model.torqueNm} Н·м`;
    $('#detail-tank').textContent = `${model.fuelCapacity} л`;
    $('#detail-mass').textContent = `${model.massKg.toLocaleString()} кг`;

    const btnActivate = $('#btn-activate-truck');
    btnActivate.textContent = isCurrent ? 'УЖЕ ЗА РУЛЁМ' : 'СЕСТЬ ЗА РУЛЬ';
    btnActivate.disabled = isCurrent;

    btnActivate.onclick = () => {
      profile.currentTruckId = truckId;
      sim.setTruckModel(model);
      if (bonus) sim.truck.powerHp += bonus;
      saveProfile();
      renderGarage();
      toast(`Вы пересели за руль: ${model.name}`);
    };

    const btnTune = $('#btn-tune-engine');
    btnTune.onclick = () => {
      if (profile.moneyMdl < 15000) {
        toast('Недостаточно денег на чип-тюнинг (нужно 15 000 MDL)!', true);
        return;
      }
      profile.moneyMdl -= 15000;
      profile.truckTunings[truckId] = profile.truckTunings[truckId] || { bonusHp: 0 };
      profile.truckTunings[truckId].bonusHp += 40;
      if (isCurrent) sim.truck.powerHp += 40;
      saveProfile();
      selectGarageTruck(truckId);
      audio.playRelayClick(true);
      toast(`Чип-тюнинг выполнен! Мощность увеличена: +40 л.с.`);
    };
  }

  // 4. TRUCK DEALERSHIP SYSTEM
  function renderDealer() {
    const grid = $('#dealer-grid');
    grid.innerHTML = '';

    trucksCatalog.TRUCKS.forEach(truck => {
      const owned = profile.ownedTrucks.includes(truck.id);
      const card = document.createElement('div');
      card.className = 'dealer-card';
      card.innerHTML = `
        <h4>${truck.name}</h4>
        <p class="dealer-desc">${truck.description}</p>
        <div class="dealer-specs">
          <span>${truck.powerHp} л.с.</span>
          <span>${truck.torqueNm} Н·м</span>
          <span>Бак: ${truck.fuelCapacity} л</span>
          <span>${truck.axles}</span>
        </div>
        <div class="dealer-bottom">
          <span class="dealer-price">${truck.priceMdl.toLocaleString()} MDL</span>
          <button class="btn-buy-truck" ${owned ? 'disabled' : ''}>
            ${owned ? 'В ГАРАЖЕ' : 'КУПИТЬ'}
          </button>
        </div>
      `;

      if (!owned) {
        card.querySelector('.btn-buy-truck').addEventListener('click', () => {
          if (profile.moneyMdl < truck.priceMdl) {
            toast(`Недостаточно средств! Требуется ${truck.priceMdl.toLocaleString()} MDL`, true);
            return;
          }
          profile.moneyMdl -= truck.priceMdl;
          profile.ownedTrucks.push(truck.id);
          profile.currentTruckId = truck.id;
          sim.setTruckModel(truck);
          saveProfile();
          audio.playRelayClick(true);
          toast(`Поздравляем! Куплен новый тягач: ${truck.name}`);
          renderDealer();
        });
      }

      grid.appendChild(card);
    });
  }

  // HUD and Route Advisor update
  function updateHUD() {
    const t = sim.truck;
    const r = sim.trailer;

    // Truck brand and model
    const currentModel = trucksCatalog.getTruck(profile.currentTruckId);
    $('#hud-truck-model').innerHTML = `${currentModel.brand} <strong>${currentModel.model}</strong>`;
    $('#hud-cargo-name').textContent = profile.activeJob ? `${profile.activeJob.cargo.nameRu} (${(profile.activeJob.cargo.weightKg / 1000).toFixed(1)} т)` : 'БЕЗ ГРУЗА';

    // Digital Speedometer
    $('#hud-speed').textContent = sim.currentSpeedKmh;
    $('#hud-gear').textContent = t.gear === -1 ? 'R' : `D${t.gear}`;

    // Speed limit check with color alert
    const speedLimitEl = $('#hud-speed-limit');
    speedLimitEl.textContent = `${sim.speedLimit}`;
    speedLimitEl.classList.toggle('overspeed', sim.currentSpeedKmh > sim.speedLimit + 5);

    // Fuel & Odometer
    $('#hud-fuel').textContent = `${Math.round(t.fuel)} L`;
    $('#hud-odometer').textContent = `${t.odometer.toFixed(1)} km`;

    // Pressure & Damage
    $('#hud-air').textContent = `${t.airPressure.toFixed(1)} bar`;
    $('#hud-truck-damage').textContent = `${Math.round(t.damage)}%`;
    $('#hud-cargo-damage').textContent = `${Math.round(r.cargoDamage)}%`;

    // Indicators
    $('#ind-left').classList.toggle('active', (t.turnSignal === -1 || t.turnSignal === 2) && renderer.turnBlinkOn);
    $('#ind-right').classList.toggle('active', (t.turnSignal === 1 || t.turnSignal === 2) && renderer.turnBlinkOn);
    $('#ind-lights').classList.toggle('active', t.lights > 0);
    $('#ind-lights').textContent = t.lights === 2 ? 'HIGH' : t.lights === 1 ? 'LOW' : 'OFF';
    $('#ind-trailer').classList.toggle('active', r.attached);
    $('#ind-trailer').textContent = r.attached ? 'TRAILER: ON' : 'NO TRAILER';
    $('#ind-park').classList.toggle('active', t.parkingBrake);

    // Route Advisor: GPS Destination
    const navText = $('#hud-nav-dest');
    const navDist = $('#hud-nav-dist');
    const navArrow = $('#hud-nav-arrow');

    if (profile.activeJob) {
      const target = profile.activeJob.targetDepot;
      const dx = target.x - t.x;
      const dy = target.y - t.y;
      const distMeters = Math.hypot(dx, dy) * 0.1; // scale 10px = 1m
      const targetAngle = Math.atan2(dy, dx);
      const relAngle = targetAngle - t.angle;

      navText.textContent = `${profile.activeJob.targetCityName} — ${target.name}`;
      navDist.textContent = `${(distMeters / 1000).toFixed(1)} км`;
      navArrow.style.transform = `rotate(${relAngle}rad)`;
    } else {
      navText.textContent = 'Нет активного заказа (Биржа грузов)';
      navDist.textContent = '—';
      navArrow.style.transform = 'rotate(0deg)';
    }

    $('#wallet-amount').textContent = `${profile.moneyMdl.toLocaleString()} MDL`;
  }

  // Set default starter job if none
  if (!profile.activeJob) {
    const depots = map.getAllDepots ? map.getAllDepots() : [];
    if (depots.length >= 2) {
      startJob({
        id: 'starter-job',
        cargo: map.CARGO_CATALOG[0],
        originCity: 'Chișinău',
        originDepot: depots[0],
        targetCityName: 'Orhei',
        targetDepot: depots[1],
        rewardMdl: 4800,
        distKm: 45
      });
    }
  }

  // Main Game Loop (Optimized 60 FPS requestAnimationFrame)
  let lastTime = performance.now();
  function gameLoop(now) {
    const dt = Math.max(0.001, Math.min(0.05, (now - lastTime) / 1000));
    lastTime = now;

    // Only update driving physics and render if in driving view or if physics is running
    const input = {
      throttle: keys.up ? 1 : 0,
      brake: (keys.down || sim.truck.parkingBrake) ? 1 : 0,
      steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
      reverse: sim.truck.gear === -1
    };

    sim.update(dt, input);
    audio.update(sim, dt);
    checkDepotDelivery();
    renderer.render(sim, dt);
    updateHUD();

    requestAnimationFrame(gameLoop);
  }

  saveProfile();
  requestAnimationFrame(gameLoop);
})();
