/*! 2D ETS2 Moldova Edition | Full Republic of Moldova Road Network & Geography | ETS2 1:19 Scale */
(function (root) {
  'use strict';

  // ETS2 Standard European Scale: 1:19
  // 1 km in real world ≈ 1000m / 19 ≈ 52.63 in-game meters
  // Coordinate scale: 1 meter = 10 canvas units -> 1 real km ≈ 526 canvas units
  const ETS2_SCALE = 19;
  const UNITS_PER_METER = 10;
  const realKmToUnits = realKm => (realKm * 1000 / ETS2_SCALE) * UNITS_PER_METER;

  // Hermite spline interpolation for ultra-smooth realistic highway curves
  function hermitePoint(p0, p1, p2, p3, t, tension = 0.25) {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
      x: h00 * p1.x + h10 * (p2.x - p0.x) * tension + h01 * p2.x + h11 * (p3.x - p1.x) * tension,
      y: h00 * p1.y + h10 * (p2.y - p0.y) * tension + h01 * p2.y + h11 * (p3.y - p1.y) * tension
    };
  }

  // Pre-bake roads with dense Hermite sampling, bounds, and normal vectors
  function bakeRoad(road) {
    const raw = road.points;
    const count = raw.length;
    const dense = [];
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    if (count < 2) {
      return {
        ...road,
        dense: raw.map(p => ({ ...p, angle: 0, nx: 0, ny: 1, dist: 0 })),
        totalLength: 0,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      };
    }

    for (let i = 0; i < count - 1; i++) {
      const p0 = raw[Math.max(0, i - 1)];
      const p1 = raw[i];
      const p2 = raw[i + 1];
      const p3 = raw[Math.min(count - 1, i + 2)];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const steps = clamp(Math.ceil(dist / 40), 10, 80);

      for (let s = 0; s < steps; s++) {
        dense.push(hermitePoint(p0, p1, p2, p3, s / steps));
      }
    }
    dense.push({ ...raw[count - 1] });

    let totalLength = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let i = 0; i < dense.length; i++) {
      const p = dense[i];
      const next = dense[Math.min(i + 1, dense.length - 1)];
      const prev = dense[Math.max(0, i - 1)];
      const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
      p.angle = angle;
      p.nx = -Math.sin(angle);
      p.ny = Math.cos(angle);
      if (i > 0) totalLength += Math.hypot(p.x - dense[i - 1].x, p.y - dense[i - 1].y);
      p.dist = totalLength;

      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const margin = (road.width || 140) + 120;
    return {
      ...road,
      dense,
      totalLength,
      bounds: {
        minX: minX - margin,
        minY: minY - margin,
        maxX: maxX + margin,
        maxY: maxY + margin
      }
    };
  }

  // ==============================================================
  // REPUBLIC OF MOLDOVA ROAD NETWORK (Full ETS 2 Map Topology)
  // Major Cities: Chișinău, Bălți, Orhei, Ungheni, Tiraspol, Hîncești
  // ==============================================================

  // 1. Traseul M2 (Chișinău — Stăuceni — Cricova — Peresecina — Orhei)
  const M2_HIGHWAY = {
    id: 'm2-highway',
    code: 'M2',
    name: 'Traseul M2 (Chișinău — Orhei)',
    speedLimit: 90,
    lanes: 2,
    width: 140,
    category: 'highway',
    points: [
      { x: 1200, y: 3000 },    // Chișinău Center Depot
      { x: 1200, y: 1800 },    // Centura North Interchange
      { x: 1350, y: 950 },     // Stăuceni
      { x: 1550, y: -200 },    // Stăuceni Hill
      { x: 1700, y: -2200 },   // Cricova Cloverleaf (M1 Interchange)
      { x: 1600, y: -3500 },   // Cricova North
      { x: 1400, y: -4800 },   // Măgdăcești
      { x: 1250, y: -5900 },   // Măgdăcești North
      { x: 1050, y: -7200 },   // Ratuș
      { x: 750, y: -8600 },    // Codru Forest Edge
      { x: 350, y: -9800 },    // Peresecina Entry Descent
      { x: -200, y: -11000 },  // Peresecina Serpentine 1
      { x: -650, y: -11900 },  // Peresecina Serpentine 2 (Hairpin)
      { x: -450, y: -12800 },  // Peresecina Valley (Rompetrol Gas Station)
      { x: 50, y: -13900 },    // Peresecina Hill Climb
      { x: 450, y: -15200 },   // Codru Ridge
      { x: 800, y: -17000 },   // Pelivan
      { x: 1200, y: -19200 },  // Orhei South Roundabout (R14 Junction)
      { x: 1200, y: -20000 },  // Răut River Bridge
      { x: 1200, y: -20684 }   // Orhei Logistics Terminal
    ]
  };

  // 2. Traseul R14 (Orhei — Telenești — Sîngerei — Bălți)
  const R14_HIGHWAY = {
    id: 'r14-highway',
    code: 'R14',
    name: 'Traseul R14 (Orhei — Bălți)',
    speedLimit: 90,
    lanes: 2,
    width: 130,
    category: 'highway',
    points: [
      { x: 1200, y: -19200 },  // Orhei South Roundabout
      { x: 400, y: -20200 },   // Mitoc Approach
      { x: -400, y: -21500 },  // Mitoc Crossroads
      { x: -1800, y: -24500 }, // Telenești Exit
      { x: -3200, y: -28000 }, // Codru Hills North
      { x: -4800, y: -32000 }, // Sîngerei South
      { x: -6200, y: -35500 }, // Sîngerei North
      { x: -7500, y: -38000 }  // Bălți South Roundabout
    ]
  };

  // 3. Autostrada M5 (Bălți — Fălești — Călărași — Strășeni — Chișinău)
  const M5_HIGHWAY = {
    id: 'm5-highway',
    code: 'M5',
    name: 'Autostrada M5 (Bălți — Chișinău)',
    speedLimit: 100,
    lanes: 2,
    width: 140,
    category: 'highway',
    points: [
      { x: -7500, y: -38000 }, // Bălți South Roundabout
      { x: -7100, y: -34000 }, // Bălți Airport Corridor
      { x: -6500, y: -28000 }, // Fălești Interchange
      { x: -5000, y: -20000 }, // Călărași Hills West
      { x: -4000, y: -13000 }, // Codru West Reserve
      { x: -2800, y: -5000 },  // Strășeni North / Bucovăț
      { x: -1600, y: -1000 },  // Trușeni
      { x: -800, y: 2200 }     // Chișinău Centura West (Petricani)
    ]
  };

  // 4. Traseul R1 (Chișinău — Strășeni — Călărași — Cornești — Ungheni Border)
  const R1_HIGHWAY = {
    id: 'r1-highway',
    code: 'R1',
    name: 'Traseul R1 (Chișinău — Ungheni)',
    speedLimit: 90,
    lanes: 2,
    width: 130,
    category: 'highway',
    points: [
      { x: -800, y: 2200 },    // Chișinău Centura West
      { x: -3000, y: 2500 },   // Vatra / Ghidighici Reservoir
      { x: -6500, y: 2800 },   // Strășeni City
      { x: -9500, y: 3000 },   // Panășești
      { x: -14000, y: 3200 },  // Călărași City Center
      { x: -19000, y: 3000 },  // Bahmut Hills
      { x: -24000, y: 2700 },  // Pîrlița
      { x: -28500, y: 2500 },  // Ungheni City Entry
      { x: -30000, y: 2400 }   // Ungheni Customs & Rail Terminal (Prut River)
    ]
  };

  // 5. Traseul M1 (Cricova — Vadul lui Vodă — Criuleni — Dubăsari)
  const M1_HIGHWAY = {
    id: 'm1-highway',
    code: 'M1',
    name: 'Traseul M1 (Cricova — Dubăsari)',
    speedLimit: 90,
    lanes: 2,
    width: 130,
    category: 'highway',
    points: [
      { x: 1700, y: -2200 },   // Cricova Cloverleaf
      { x: 3500, y: -2300 },   // Hrușova
      { x: 6000, y: -2450 },   // Vadul lui Vodă Resort
      { x: 8500, y: -2600 },   // Criuleni Bypass
      { x: 10500, y: -2700 },  // Nistru River Bridge
      { x: 12500, y: -2800 }   // Dubăsari Freight Terminal
    ]
  };

  // 6. Traseul R2 (Chișinău — Anenii Noi — Tiraspol)
  const R2_HIGHWAY = {
    id: 'r2-highway',
    code: 'R2',
    name: 'Traseul R2 (Chișinău — Tiraspol)',
    speedLimit: 90,
    lanes: 2,
    width: 130,
    category: 'highway',
    points: [
      { x: 2800, y: 3200 },    // Chișinău Centura East
      { x: 5500, y: 4200 },    // Sîngera
      { x: 8500, y: 4900 },    // Țînțăreni
      { x: 11500, y: 5400 },   // Anenii Noi City
      { x: 14500, y: 5900 },   // Nistru River Bridge (Gura Bîcului)
      { x: 17500, y: 6400 }    // Tiraspol Industrial Terminal
    ]
  };

  // 7. Traseul M3 (Chișinău — Ialoveni — Fundul Galbenei — Hîncești)
  const M3_HIGHWAY = {
    id: 'm3-highway',
    code: 'M3',
    name: 'Traseul M3 (Chișinău — Hîncești)',
    speedLimit: 90,
    lanes: 2,
    width: 130,
    category: 'highway',
    points: [
      { x: 1200, y: 4500 },    // Chișinău Centura South
      { x: 700, y: 7200 },     // Ialoveni
      { x: -100, y: 10200 },   // Dănceni Lake
      { x: -900, y: 13800 },   // Fundul Galbenei Serpentines
      { x: -1500, y: 17000 },  // Hîncești Crest
      { x: -2200, y: 19800 }   // Hîncești Winery Terminal
    ]
  };

  // 8. Centura de Nord & Sud Chișinău (Full 360° Orbital Ring Road)
  const CENTURA_CHISINAU = {
    id: 'centura-chisinau',
    code: 'Centura',
    name: 'Centura Orbitală Chișinău',
    speedLimit: 70,
    lanes: 2,
    width: 120,
    category: 'secondary',
    points: [
      { x: 1200, y: 1800 },    // North (M2 Junction)
      { x: 2200, y: 2200 },    // North-East (Ciocana)
      { x: 2800, y: 3200 },    // East (R2 Junction to Tiraspol)
      { x: 2300, y: 4200 },    // South-East (Aeroport)
      { x: 1200, y: 4500 },    // South (M3 Junction to Hîncești)
      { x: 0, y: 4200 },       // South-West (Telecentru)
      { x: -800, y: 2200 },    // West (R1/M5 Junction to Ungheni & Bălți)
      { x: 0, y: 1750 },       // North-West (Petricani)
      { x: 1200, y: 1800 }     // Closed orbital loop!
    ]
  };

  // 9. Cricova Cloverleaf Connector Ramp (M2 Northbound -> M1 Eastbound)
  const CRICOVA_RAMP = {
    id: 'cricova-ramp',
    code: 'Ramp',
    name: 'Nod Rutier Cricova (Bretea M2 → M1)',
    speedLimit: 50,
    lanes: 1,
    width: 90,
    category: 'ramp',
    points: [
      { x: 1650, y: -1800 },
      { x: 1850, y: -1980 },
      { x: 2050, y: -2150 },
      { x: 2250, y: -2220 }
    ]
  };

  // 10. Orhei City Avenue (Strada Vasile Lupu)
  const ORHEI_CITY_AVENUE = {
    id: 'orhei-city',
    code: 'Orhei',
    name: 'Bulevardul Orhei (Centru)',
    speedLimit: 50,
    lanes: 2,
    width: 100,
    category: 'urban',
    points: [
      { x: 1200, y: -19200 },
      { x: 1700, y: -19600 },
      { x: 2200, y: -20200 },
      { x: 2600, y: -20900 }
    ]
  };

  // 11. Bălți City Avenue (Strada Decebal / Centru)
  const BALTI_CITY_AVENUE = {
    id: 'balti-city',
    code: 'Bălți',
    name: 'Bulevardul Bălți (Centru)',
    speedLimit: 50,
    lanes: 2,
    width: 105,
    category: 'urban',
    points: [
      { x: -7500, y: -38000 },
      { x: -8000, y: -39000 },
      { x: -8500, y: -40000 },
      { x: -8800, y: -41200 }
    ]
  };

  // 12. Ungheni City Avenue (Strada Națională)
  const UNGHENI_CITY_AVENUE = {
    id: 'ungheni-city',
    code: 'Ungheni',
    name: 'Bulevardul Ungheni (Vamă)',
    speedLimit: 50,
    lanes: 2,
    width: 100,
    category: 'urban',
    points: [
      { x: -28500, y: 2500 },
      { x: -29300, y: 2450 },
      { x: -30000, y: 2400 }
    ]
  };

  // 13. Tiraspol City Avenue (Strada 25 Octombrie)
  const TIRASPOL_CITY_AVENUE = {
    id: 'tiraspol-city',
    code: 'Tiraspol',
    name: 'Bulevardul Tiraspol (Centru)',
    speedLimit: 50,
    lanes: 2,
    width: 100,
    category: 'urban',
    points: [
      { x: 16000, y: 6200 },
      { x: 16800, y: 6300 },
      { x: 17500, y: 6400 }
    ]
  };

  // 14. Hîncești City Avenue (Strada Chișinăului)
  const HINCESTI_CITY_AVENUE = {
    id: 'hincesti-city',
    code: 'Hîncești',
    name: 'Bulevardul Hîncești (Centru)',
    speedLimit: 50,
    lanes: 2,
    width: 100,
    category: 'urban',
    points: [
      { x: -1700, y: 18500 },
      { x: -2000, y: 19200 },
      { x: -2200, y: 19800 }
    ]
  };

  // 15. Peresecina Gas Station & Truck Rest Stop Loop
  const ROMPETROL_LOOP = {
    id: 'rompetrol-loop',
    code: 'Rompetrol',
    name: 'Parcare & Peco Rompetrol Peresecina',
    speedLimit: 30,
    lanes: 1,
    width: 85,
    category: 'service',
    points: [
      { x: -480, y: -12500 },
      { x: -680, y: -12700 },
      { x: -720, y: -12900 },
      { x: -620, y: -13100 },
      { x: -430, y: -13250 }
    ]
  };

  // 16. Chișinău Central Depot Yard Road
  const CHISINAU_DEPOT_YARD = {
    id: 'chisinau-yard',
    code: 'Yard-C',
    name: 'Baza Trans-Moldova Chișinău',
    speedLimit: 30,
    lanes: 1,
    width: 100,
    category: 'service',
    points: [
      { x: 1200, y: 3000 },
      { x: 1050, y: 3100 },
      { x: 900, y: 3150 },
      { x: 750, y: 3150 }
    ]
  };

  // 17. Orhei Logistics Terminal Yard Road
  const ORHEI_TERMINAL_YARD = {
    id: 'orhei-yard',
    code: 'Yard-O',
    name: 'Orhei Logistics Terminal (Rampa)',
    speedLimit: 30,
    lanes: 1,
    width: 100,
    category: 'service',
    points: [
      { x: 1200, y: -20684 },
      { x: 1100, y: -20720 },
      { x: 1000, y: -20744 }
    ]
  };

  // 18. Bălți Logistics Hub Yard Road
  const BALTI_DEPOT_YARD = {
    id: 'balti-yard',
    code: 'Yard-B',
    name: 'Bălți Agro-Mașini Terminal (Rampa)',
    speedLimit: 30,
    lanes: 1,
    width: 100,
    category: 'service',
    points: [
      { x: -8800, y: -41200 },
      { x: -8900, y: -41400 },
      { x: -9000, y: -41600 }
    ]
  };

  // 19. Ungheni Customs & Rail Port Yard Road
  const UNGHENI_DEPOT_YARD = {
    id: 'ungheni-yard',
    code: 'Yard-U',
    name: 'Ungheni Vamă Terminal (Rampa)',
    speedLimit: 30,
    lanes: 1,
    width: 100,
    category: 'service',
    points: [
      { x: -30000, y: 2400 },
      { x: -30200, y: 2350 },
      { x: -30400, y: 2300 }
    ]
  };

  // 20. Tiraspol Industrial Terminal Yard Road
  const TIRASPOL_DEPOT_YARD = {
    id: 'tiraspol-yard',
    code: 'Yard-T',
    name: 'Tiraspol Logistic Terminal (Rampa)',
    speedLimit: 30,
    lanes: 1,
    width: 100,
    category: 'service',
    points: [
      { x: 17500, y: 6400 },
      { x: 17700, y: 6450 },
      { x: 17900, y: 6500 }
    ]
  };

  // 21. Hîncești Vit-Agro Yard Road
  const HINCESTI_DEPOT_YARD = {
    id: 'hincesti-yard',
    code: 'Yard-H',
    name: 'Hîncești Vit-Agro Terminal (Rampa)',
    speedLimit: 30,
    lanes: 1,
    width: 100,
    category: 'service',
    points: [
      { x: -2200, y: 19800 },
      { x: -2350, y: 20000 },
      { x: -2500, y: 20200 }
    ]
  };

  // Full Moldovan Network of All Interconnected Roads
  const ALL_RAW_ROADS = [
    M2_HIGHWAY,
    R14_HIGHWAY,
    M5_HIGHWAY,
    R1_HIGHWAY,
    M1_HIGHWAY,
    R2_HIGHWAY,
    M3_HIGHWAY,
    CENTURA_CHISINAU,
    CRICOVA_RAMP,
    ORHEI_CITY_AVENUE,
    BALTI_CITY_AVENUE,
    UNGHENI_CITY_AVENUE,
    TIRASPOL_CITY_AVENUE,
    HINCESTI_CITY_AVENUE,
    ROMPETROL_LOOP,
    CHISINAU_DEPOT_YARD,
    ORHEI_TERMINAL_YARD,
    BALTI_DEPOT_YARD,
    UNGHENI_DEPOT_YARD,
    TIRASPOL_DEPOT_YARD,
    HINCESTI_DEPOT_YARD
  ];

  // Bake all roads into dense Hermite geometry with pre-computed normals & spatial bounds
  const BAKED_ROADS = ALL_RAW_ROADS.map(bakeRoad);

  // Freight Market Cargo
  const CARGO_CATALOG = [
    { id: 'wine', name: 'Vin Moldovenesc', nameRu: 'Молдавское вино (Purcari)', weightKg: 18000, valuePerKm: 34, type: 'dryvan' },
    { id: 'apples', name: 'Mere de Livadă', nameRu: 'Яблоки (Орхей)', weightKg: 15000, valuePerKm: 28, type: 'reefer' },
    { id: 'sunflower_oil', name: 'Ulei de Floarea Soarelui', nameRu: 'Подсолнечное масло (Bălți)', weightKg: 22000, valuePerKm: 36, type: 'tanker' },
    { id: 'machinery', name: 'Piese și Utilaj Agricol', nameRu: 'Сельхозтехника (Bălți/Chișinău)', weightKg: 16000, valuePerKm: 42, type: 'lowbed' },
    { id: 'customs_freight', name: 'Mărfuri de Import UE', nameRu: 'Импортные товары (Ungheni Vamă)', weightKg: 19000, valuePerKm: 38, type: 'dryvan' },
    { id: 'textiles', name: 'Produse Textile (Tiraspol)', nameRu: 'Текстиль и ткани (Тиротекс)', weightKg: 12000, valuePerKm: 30, type: 'dryvan' }
  ];

  // Cities of Republic of Moldova
  const CITIES = [
    { id: 'chisinau', name: 'Chișinău', nameRu: 'Кишинёв', x: 1200, y: 3000, rank: 1, desc: 'Столица Республики Молдова' },
    { id: 'balti', name: 'Bălți', nameRu: 'Бельцы', x: -8500, y: -40000, rank: 1, desc: 'Северная индустриальная столица' },
    { id: 'orhei', name: 'Orhei', nameRu: 'Орхей', x: 1200, y: -20684, rank: 1, desc: 'Центр виноделия и логистики' },
    { id: 'ungheni', name: 'Ungheni', nameRu: 'Унгены', x: -30000, y: 2400, rank: 1, desc: 'Западный таможенный хаб на границе с Румынией' },
    { id: 'tiraspol', name: 'Tiraspol', nameRu: 'Тирасполь', x: 17500, y: 6400, rank: 1, desc: 'Восточный промышленный центр на Днестре' },
    { id: 'hincesti', name: 'Hîncești', nameRu: 'Хынчешты', x: -2200, y: 19800, rank: 2, desc: 'Юго-западный аграрный и винный центр' },
    { id: 'stauceni', name: 'Stăuceni', nameRu: 'Ставчены', x: 1350, y: 950, rank: 3, desc: 'Пригород Кишинёва на M2' },
    { id: 'cricova', name: 'Cricova', nameRu: 'Крикова', x: 1700, y: -2200, rank: 2, desc: 'Подземные винные галереи и развязка M1' },
    { id: 'magdacesti', name: 'Măgdăcești', nameRu: 'Мэгдачешть', x: 1400, y: -4800, rank: 3, desc: 'Скоростной участок M2' },
    { id: 'ratus', name: 'Ratuș', nameRu: 'Ратуш', x: 1050, y: -7200, rank: 3, desc: 'Перекрёсток M2' },
    { id: 'peresecina', name: 'Peresecina', nameRu: 'Пересечина', x: -450, y: -12800, rank: 2, desc: 'Серпантины M2 и АЗС Rompetrol' },
    { id: 'pelivan', name: 'Pelivan', nameRu: 'Пеливан', x: 800, y: -17000, rank: 3, desc: 'Подход к Орхею' },
    { id: 'telenesti', name: 'Telenești', nameRu: 'Теленешты', x: -1800, y: -24500, rank: 3, desc: 'Развязка R14' },
    { id: 'singerei', name: 'Sîngerei', nameRu: 'Сынжерей', x: -5000, y: -32000, rank: 3, desc: 'Шоссе R14 к Бельцам' },
    { id: 'straseni', name: 'Strășeni', nameRu: 'Страшены', x: -6500, y: 2800, rank: 2, desc: 'Город в Кодрах на трассе R1' },
    { id: 'calarasi', name: 'Călărași', nameRu: 'Калараш', x: -14000, y: 3200, rank: 2, desc: 'Винно-коньячный хаб на R1' },
    { id: 'dubasari', name: 'Dubăsari', nameRu: 'Дубоссары', x: 12500, y: -2800, rank: 2, desc: 'Переправа через реку Днестр' },
    { id: 'anenii-noi', name: 'Anenii Noi', nameRu: 'Новые Анены', x: 11500, y: 5400, rank: 3, desc: 'Трасса R2 на Тирасполь' }
  ];

  // Dynamic DEPOTS & FUELS containers loaded strictly from data/moldova-map.json
  const DEPOTS = [];
  const FUELS = [];

  // Major Highway Interchanges & Roundabouts (Seamless Paved Junctions)
  const JUNCTIONS = [
    { id: 'cricova-cloverleaf', name: 'Развязка M1 / M2 Cricova', x: 1700, y: -2200, radius: 180, type: 'cloverleaf' },
    { id: 'orhei-roundabout', name: 'Кольцевая развязка Орхей Юг', x: 1200, y: -19200, radius: 110, type: 'roundabout' },
    { id: 'balti-roundabout', name: 'Кольцевая развязка Бельцы Юг', x: -7500, y: -38000, radius: 120, type: 'roundabout' },
    { id: 'centura-north', name: 'Развязка Centura de Nord / M2', x: 1200, y: 1800, radius: 140, type: 'interchange' },
    { id: 'centura-west', name: 'Развязка Centura / R1 / M5', x: -800, y: 2200, radius: 150, type: 'interchange' },
    { id: 'centura-east', name: 'Развязка Centura / R2', x: 2800, y: 3200, radius: 140, type: 'interchange' },
    { id: 'centura-south', name: 'Развязка Centura / M3', x: 1200, y: 4500, radius: 140, type: 'interchange' }
  ];

  // Highway Overhead Direction Signs
  const ROAD_SIGNS = [
    { x: 1200, y: 2400, angle: -Math.PI / 2, main: 'M2 ORHEI 38 km', sub: 'M1 DUBĂSARI ↗  |  R1 UNGHENI ↖', speed: 90 },
    { x: 1650, y: -1600, angle: -Math.PI / 2, main: 'NOD CRICOVA', sub: 'M1 DUBĂSARI ↗  |  M2 ORHEI ↑', speed: 70 },
    { x: 1400, y: -5400, angle: -Math.PI / 2, main: 'M2 MĂGDĂCEȘTI', sub: 'ORHEI 28 km ↑  |  BĂLȚI 115 km ↑', speed: 90 },
    { x: -100, y: -10200, angle: -Math.PI / 2, main: 'ATENȚIE! SERPANTINĂ', sub: 'PERSECINA  |  ROMPETROL ⛽ 3 km', speed: 50 },
    { x: 1100, y: -18500, angle: -Math.PI / 2, main: 'SENS GIRATORIU ORHEI', sub: 'BĂLȚI R14 ↖  |  ORHEI CENTRU ↗', speed: 50 },
    { x: 500, y: -20000, angle: -2.3, main: 'TRASEUL R14', sub: 'TELENEȘTI 15 km  |  BĂLȚI 75 km ↑', speed: 90 },
    { x: -6800, y: -36500, angle: -1.9, main: 'SENS GIRATORIU BĂLȚI', sub: 'BĂLȚI CENTRU ↑  |  M5 CHIȘINĂU ↘', speed: 50 },
    { x: -2000, y: 2400, angle: 3.14, main: 'TRASEUL R1 VEST', sub: 'STRĂȘENI 12 km  |  UNGHENI VAMĂ 85 km', speed: 90 },
    { x: 4200, y: -2350, angle: 0.05, main: 'TRASEUL M1 EST', sub: 'CRIULENI 18 km  |  DUBĂSARI 35 km', speed: 90 },
    { x: 4000, y: 3600, angle: 0.4, main: 'TRASEUL R2 SUD-EST', sub: 'ANENII NOI 22 km  |  TIRASPOL 60 km', speed: 90 },
    { x: 900, y: 5500, angle: 1.8, main: 'TRASEUL M3 SUD', sub: 'IALOVENI 8 km  |  HÎNCEȘTI 28 km', speed: 90 }
  ];

  // Moldovan Real Geographical Features (Google Maps Layers)
  const GEOGRAPHY = {
    // Republic of Moldova National Border Boundary Polygon (Simplified Google Maps Outline)
    moldovaBorder: [
      { x: -32000, y: -45000 }, // Northern Prut entry
      { x: -12000, y: -47000 }, // Northern apex (Ocnița/Briceni)
      { x: 5000, y: -46000 },   // Soroca North
      { x: 15000, y: -38000 },  // Camenca / Nistru bend
      { x: 16000, y: -20000 },  // Rîbnița East
      { x: 18000, y: -4000 },   // Dubăsari East
      { x: 22000, y: 8000 },    // Tiraspol / Slobozia East
      { x: 18000, y: 22000 },   // Ştefan Vodă South-East
      { x: 2000, y: 26000 },    // Taraclia South
      { x: -8000, y: 30000 },   // Giurgiulești Danube point
      { x: -18000, y: 20000 },  // Cahul / Prut
      { x: -24000, y: 12000 },  // Cantemir / Leova
      { x: -31000, y: 2400 },   // Ungheni Prut Border
      { x: -33000, y: -16000 }, // Glodeni Prut
      { x: -32000, y: -45000 }
    ],

    // 1. Râul Nistru (Dniester River — Eastern Border & Lifeline)
    nistruRiver: [
      { x: 8000, y: -45000 },
      { x: 12000, y: -35000 },
      { x: 14000, y: -22000 },
      { x: 11000, y: -10000 },
      { x: 10500, y: -2700 }, // Under M1 Bridge
      { x: 12000, y: 1500 },
      { x: 14500, y: 5900 },  // Under R2 Bridge
      { x: 16000, y: 12000 },
      { x: 19000, y: 20000 }
    ],

    // 2. Râul Prut (Prut River — Western Border with Romania)
    prutRiver: [
      { x: -32000, y: -45000 },
      { x: -33000, y: -28000 },
      { x: -32500, y: -12000 },
      { x: -30800, y: 2400 },  // Under Ungheni Customs Bridge
      { x: -28000, y: 12000 },
      { x: -22000, y: 22000 },
      { x: -10000, y: 30000 }
    ],

    // 3. Râul Răut (Răut River — Winding through Bălți and Orhei)
    rautRiver: [
      { x: -12000, y: -42000 },
      { x: -8500, y: -39000 }, // Bălți River Bank
      { x: -5000, y: -34000 },
      { x: -2000, y: -26000 },
      { x: 500, y: -21000 },
      { x: 1200, y: -20000 },  // Under M2 Orhei Bridge
      { x: 3000, y: -19500 },
      { x: 6500, y: -18000 },
      { x: 11500, y: -16000 }  // Confluence with Nistru
    ],

    // 4. Râul Bîc (Bîc River — Through Strășeni and Chișinău)
    bicRiver: [
      { x: -12000, y: 3200 },
      { x: -6500, y: 2700 },  // Strășeni Bank
      { x: -3000, y: 2400 },  // Ghidighici Reservoir
      { x: 500, y: 2900 },
      { x: 1200, y: 3200 },   // Chișinău Downtown
      { x: 2800, y: 3400 },
      { x: 7500, y: 4400 },
      { x: 14500, y: 5800 }   // Confluence with Nistru
    ],

    // Forests & Protected Nature Reserves (Google Maps Green Polygons)
    forests: [
      {
        name: 'Rezervația Naturală Codru (Chișinău — Călărași — Strășeni)',
        points: [
          { x: -200, y: -7000 },
          { x: 1500, y: -7800 },
          { x: 2200, y: -9500 },
          { x: 1200, y: -11500 },
          { x: -1200, y: -11000 },
          { x: -3500, y: -8000 },
          { x: -5000, y: -2000 },
          { x: -3000, y: 1500 },
          { x: -500, y: 0 }
        ]
      },
      {
        name: 'Parcul Național Orhei (Trebujeni — Curchi)',
        points: [
          { x: 1400, y: -15500 },
          { x: 3200, y: -16800 },
          { x: 4500, y: -19000 },
          { x: 2500, y: -20500 },
          { x: 1500, y: -18500 }
        ]
      },
      {
        name: 'Pădurea Hîncești (Lăpușna)',
        points: [
          { x: -1200, y: 12000 },
          { x: 400, y: 13500 },
          { x: -500, y: 17000 },
          { x: -2400, y: 16500 },
          { x: -2800, y: 13000 }
        ]
      }
    ],

    // Dynamic POIs (Populated strictly from data/moldova-map.json)
    pois: []
  };

  // Environment Buildings & City Architecture footprint for visual realism in 2D
  const CITY_BLOCKS = [
    // Chișinău Urban Core Blocks
    { x: 1450, y: 2800, w: 160, h: 220, color: '#1a232a', label: 'Centru Logistic' },
    { x: 1450, y: 3100, w: 180, h: 140, color: '#1e2832', label: 'Depozit Calea Orheiului' },
    { x: 950, y: 2800, w: 150, h: 120, color: '#162028', label: 'Depozit Purcari' },
    { x: 950, y: 3250, w: 200, h: 90, color: '#141c22', label: 'Parc Camioane' },
    // Orhei City Blocks
    { x: 1750, y: -20500, w: 180, h: 160, color: '#1c2428', label: 'Fabrica de Conserve Orhei' },
    { x: 1350, y: -21200, w: 220, h: 140, color: '#162024', label: 'Orhei Vit Hub' },
    // Bălți City Blocks
    { x: -8400, y: -41200, w: 260, h: 180, color: '#1e262c', label: 'Combinatul Agro Bălți' },
    { x: -7800, y: -41800, w: 220, h: 200, color: '#182024', label: 'Fabrica Răut Bălți' },
    // Ungheni City Blocks
    { x: -29800, y: 2200, w: 240, h: 160, color: '#1c242a', label: 'Terminal Vamal Ungheni' },
    { x: -30500, y: 2500, w: 200, h: 120, color: '#161e24', label: 'Gara Feroviară Ungheni' },
    // Tiraspol City Blocks
    { x: 17200, y: 6200, w: 260, h: 160, color: '#202428', label: 'Tirotex Tiraspol' },
    // Hîncești City Blocks
    { x: -2100, y: 20400, w: 200, h: 140, color: '#1c2226', label: 'Combinatul Vinicol Hîncești' }
  ];

  // ==============================================================
  // REAL OPENSTREETMAP ROAD NETWORK GRAPH & A* ROUTING
  // ==============================================================
  let osmMap = null;
  if (typeof root !== 'undefined' && root) {
    osmMap = root.OSM_MOLDOVA_MAP || (root.window && root.window.OSM_MOLDOVA_MAP);
  }
  if (!osmMap && typeof window !== 'undefined' && window) {
    osmMap = window.OSM_MOLDOVA_MAP;
  }
  if (!osmMap && typeof globalThis !== 'undefined' && globalThis) {
    osmMap = globalThis.OSM_MOLDOVA_MAP || (globalThis.window && globalThis.window.OSM_MOLDOVA_MAP);
  }
  if (!osmMap && typeof require !== 'undefined') {
    try {
      const fs = require('node:fs');
      const p = require('node:path').join(__dirname, '../data/moldova-map.json');
      if (fs.existsSync(p)) osmMap = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {}
  }

  // Pre-build adjacency graph if OSM data loaded
  const osmAdj = new Map();
  if (osmMap && osmMap.edges) {
    for (const edge of osmMap.edges) {
      const f = String(edge.from);
      const t = String(edge.to);
      if (!osmAdj.has(f)) osmAdj.set(f, []);
      osmAdj.get(f).push({ to: t, weight: edge.length, edge, reverse: false });
      if (!edge.oneway) {
        if (!osmAdj.has(t)) osmAdj.set(t, []);
        osmAdj.get(t).push({ to: f, weight: edge.length, edge, reverse: true });
      }
    }
  }

  // Fast Binary MinHeap for A*
  class RouteMinHeap {
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
    if (!osmMap || !osmMap.nodes) return null;
    let closest = null;
    let minDist = Infinity;
    for (const nid in osmMap.nodes) {
      const node = osmMap.nodes[nid];
      const d = Math.hypot(node[0] - x, node[1] - y);
      if (d < minDist) {
        minDist = d;
        closest = nid;
      }
    }
    return closest;
  }

  function findRoute(startPointOrNodeId, endPointOrNodeId) {
    if (!osmMap || !osmMap.nodes || osmAdj.size === 0) return null;
    let startNodeId = typeof startPointOrNodeId === 'string' || typeof startPointOrNodeId === 'number'
      ? String(startPointOrNodeId)
      : findNearestNode(startPointOrNodeId.x, startPointOrNodeId.y);
    let endNodeId = typeof endPointOrNodeId === 'string' || typeof endPointOrNodeId === 'number'
      ? String(endPointOrNodeId)
      : findNearestNode(endPointOrNodeId.x, endPointOrNodeId.y);

    if (!startNodeId || !endNodeId) return null;
    if (startNodeId === endNodeId) {
      const pt = osmMap.nodes[startNodeId];
      return { found: true, totalLength: 0, totalEstMinutes: 1, edges: [], polyline: pt ? [[pt[0], pt[1]]] : [[0, 0]] };
    }

    const dist = new Map();
    const prev = new Map();
    const pq = new RouteMinHeap();
    dist.set(startNodeId, 0);

    const endPt = osmMap.nodes[endNodeId];
    const startPt = osmMap.nodes[startNodeId];
    const h0 = endPt && startPt ? Math.hypot(startPt[0] - endPt[0], startPt[1] - endPt[1]) : 0;
    pq.push({ node: startNodeId, cost: 0, f: h0 });

    while (pq.size > 0) {
      const { node, cost } = pq.pop();
      if (node === endNodeId) {
        const pathEdges = [];
        const polyline = [];
        let cur = endNodeId;
        while (prev.has(cur)) {
          const { from, edge, reverse } = prev.get(cur);
          pathEdges.unshift(edge);
          const pts = reverse ? [...edge.points].reverse() : edge.points;
          for (let p = pts.length - 1; p >= 0; p--) polyline.unshift(pts[p]);
          cur = from;
        }
        const totalLength = dist.get(endNodeId);
        // Estimate minutes assuming average 75 km/h (1 km ≈ 526 game units)
        const km = totalLength / 526.3;
        const estMinutes = Math.max(1, Math.round((km / 75) * 60));
        return { found: true, totalLength, totalDistKm: km, totalEstMinutes: estMinutes, edges: pathEdges, polyline };
      }

      if (cost > dist.get(node)) continue;

      const neighbors = osmAdj.get(node) || [];
      for (const { to, weight, edge, reverse } of neighbors) {
        const nextCost = cost + weight;
        if (!dist.has(to) || nextCost < dist.get(to)) {
          dist.set(to, nextCost);
          prev.set(to, { from: node, edge, reverse });
          const toPt = osmMap.nodes[to];
          const h = toPt && endPt ? Math.hypot(toPt[0] - endPt[0], toPt[1] - endPt[1]) : 0;
          pq.push({ node: to, cost: nextCost, f: nextCost + h });
        }
      }
    }
    return null;
  }

  function getPositionAlongPolyline(polyline, distance) {
    if (!polyline || polyline.length === 0) return { x: 0, y: 0, angle: 0 };
    if (polyline.length === 1 || distance <= 0) {
      return { x: polyline[0][0], y: polyline[0][1], angle: 0 };
    }
    let accumulated = 0;
    for (let i = 0; i < polyline.length - 1; i++) {
      const p1 = polyline[i];
      const p2 = polyline[i + 1];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (accumulated + segLen >= distance || i === polyline.length - 2) {
        const t = segLen > 0 ? (distance - accumulated) / segLen : 0;
        const clampedT = Math.max(0, Math.min(1, t));
        const x = p1[0] + (p2[0] - p1[0]) * clampedT;
        const y = p1[1] + (p2[1] - p1[1]) * clampedT;
        const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        return { x, y, angle };
      }
      accumulated += segLen;
    }
    const last = polyline[polyline.length - 1];
    const prev = polyline[polyline.length - 2];
    return { x: last[0], y: last[1], angle: Math.atan2(last[1] - prev[1], last[0] - prev[0]) };
  }

  // Populate DEPOTS, FUELS and GEOGRAPHY.pois strictly from osmMap data (moldova-map.json)
  function initMapObjects() {
    DEPOTS.length = 0;
    FUELS.length = 0;
    GEOGRAPHY.pois = [];

    if (osmMap && Array.isArray(osmMap.depots)) {
      for (const d of osmMap.depots) {
        if (!d.nearestNodeId && typeof findNearestNode === 'function') {
          d.nearestNodeId = findNearestNode(d.x, d.y);
        }
        d.rampX = d.x;
        d.rampY = d.y;
        DEPOTS.push(d);
        GEOGRAPHY.pois.push({
          id: d.id,
          name: d.name,
          cityName: d.cityName,
          type: 'depot',
          x: d.x,
          y: d.y,
          label: d.cityName || d.name,
          nearestNodeId: d.nearestNodeId
        });
      }
    }

    if (osmMap && Array.isArray(osmMap.fuels)) {
      for (const f of osmMap.fuels) {
        if (!f.nearestNodeId && typeof findNearestNode === 'function') {
          f.nearestNodeId = findNearestNode(f.x, f.y);
        }
        FUELS.push(f);
        GEOGRAPHY.pois.push({
          id: f.id,
          name: f.name || `АЗС ${f.brand || ''}`.trim(),
          brand: f.brand,
          type: 'gas',
          x: f.x,
          y: f.y,
          label: f.brand || f.name || 'АЗС',
          nearestNodeId: f.nearestNodeId
        });
      }
    }
  }

  initMapObjects();

  const MapSystem = {
    ETS2_SCALE,
    realKmToUnits,
    ROADS: BAKED_ROADS,
    PRIMARY_ROAD: BAKED_ROADS[0],
    SECONDARY_ROADS: BAKED_ROADS.slice(1),
    OSM: osmMap,
    findRoute,
    findNearestNode,
    getPositionAlongPolyline,
    CITIES: (osmMap && osmMap.cities && osmMap.cities.length > 10) ? osmMap.cities : CITIES,
    DEPOTS,
    FUELS,
    JUNCTIONS,
    ROAD_SIGNS,
    CITY_BLOCKS,
    GEOGRAPHY,
    CARGO_CATALOG,
    getAllDepots: () => DEPOTS,
    getAllFuels: () => FUELS,
    getStartSpawn: () => ({ x: 1200, y: 2950, angle: -Math.PI / 2 }),
    initMapObjects
  };

  root.ETSMap = MapSystem;
  if (typeof module !== 'undefined' && module.exports) module.exports = MapSystem;
})(typeof globalThis !== 'undefined' ? globalThis : window);
