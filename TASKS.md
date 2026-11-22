# Трекер задач (TASKS.md)

| ID | Описание | Статус | Хеш коммита |
|:---|:---|:---:|:---|
| T-001 | Инициализация правил разработки AGENTS.md и трекера TASKS.md | done | eeaf9f5 |
| T-002 | Реальная дорожная сеть OpenStreetMap (OSM) Молдовы, меню и A*-навигация | done | 5c4f32a |
| T-003 | Детекция коллизий подписей, подгонка карты по границам и иерархия классов | done | b2b3f20 |
| T-004 | Послойный рендер дорог, указатели, разметка по полосам и обрезка у узлов | done | f2a2a2b |
| T-005 | Тест покупки тягачей, смещение АЗС, русские дорожные знаки и миникарта HUD | done | 6bdd16d |
| T-006 | Оптимизация рендера дорог тайловым LRU-кешем до 50+ FPS в Firefox (Linux) | done | ab4708f |
| T-007 | Добавление точки АЗС в бенчмарк и замеры FPS при питании от сети | done | 57a2cc1 |
| T-008 | Вынос MAP_SCALE (1:8 = 1.25 px/m), параметр --scale и lengthM в рёбра | done | 9516f8f |
| T-009 | Упрощение графа (--min-class, связность с terminals/fuels, удаление висячих) | done | b47ff53 |
| T-010 | Пересборка moldova-map.json и адаптация A*, физики, HUD и наград на lengthM | done | db7c53d |
| T-011 | Прогон тестов, замер FPS и скриншоты Кишинёв/M3/Развязка (расстояние >= 2 тягачей) | done | 18c5d1a |
| T-012 | Обновление README (время пути на 90 км/ч) и CHANGELOG | done | 5a016f1 |
| T-013 | Замена distTraveledMeters в engine.js на map.unitsToRealMeters | done | 5daba86 |
| T-014 | Замена distFromTruckKm в app.js на map.unitsToRealKm | done | a36b69a |
| T-015 | Перенос 4 мостов в map.js и масштабирование RESCALE_S | done | b8dd21b |
| T-016 | Динамические координаты кнопок навигации Google Maps в app.js | done | 036a3b1 |
| T-017 | Замена depots[N] на find по ID в renderJobMarket() и тест контрактов | done | 9027251 |
| T-018 | Торможение и блокировка движения при parkingBrake=true в engine.js | done | 1f93c3f |
| T-019 | Удаление мертвого метода _drawTerrain и поля _lastLineDetail в renderer.js | done | b31d808 |
| T-020 | Удаление недостижимой ветки разметки lanes>=4 в _ensureEdgeCached | done | 5db6e93 |
| T-021 | Обновление scripts test/start и devDependencies в package.json | done | beec4f1 |
| T-022 | Удаление screenshots/ в корне и перенаправление measure-fps в assets/screenshots | done | c81a0eb |
| T-023 | Обновление AGENTS.md (карта файлов, npm test, запреты, правило MAP_SCALE) | done | 9c251d4 |
