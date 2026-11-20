/*! 2D ETS2 Moldova Edition | Truck Dealership & Catalogue */
(function (root) {
  'use strict';

  const TRUCKS = [
    {
      id: 'kamaz-54901',
      brand: 'KAMAZ',
      model: '54901 (K5)',
      name: 'КамАЗ 54901 Continent',
      priceMdl: 125000,
      powerHp: 450,
      torqueNm: 2060,
      fuelCapacity: 500,
      color: '#e67e22',
      cabColor: '#d35400',
      massKg: 7900,
      axles: '4x2',
      description: 'Доступный и надёжный тягач для региональных рейсов по Молдове.'
    },
    {
      id: 'daf-xf-105',
      brand: 'DAF',
      model: 'XF 105.460',
      name: 'DAF XF 105 Super Space',
      priceMdl: 165000,
      powerHp: 460,
      torqueNm: 2300,
      fuelCapacity: 600,
      color: '#f39c12',
      cabColor: '#d68910',
      massKg: 8100,
      axles: '4x2',
      description: 'Комфортабельный голландский магистральный тягач с мягкой подвеской.'
    },
    {
      id: 'man-tgx-18',
      brand: 'MAN',
      model: 'TGX 18.480',
      name: 'MAN TGX EfficientLine',
      priceMdl: 185000,
      powerHp: 480,
      torqueNm: 2400,
      fuelCapacity: 650,
      color: '#27ae60',
      cabColor: '#1e8449',
      massKg: 8000,
      axles: '4x2',
      description: 'Экономичный немецкий дизель с отличной тягой на затяжных подъёмах Орхея.'
    },
    {
      id: 'mercedes-actros',
      brand: 'MERCEDES-BENZ',
      model: 'Actros 1845 GigaSpace',
      name: 'Mercedes-Benz Actros MP4',
      priceMdl: 220000,
      powerHp: 450,
      torqueNm: 2200,
      fuelCapacity: 650,
      color: '#7f8c8d',
      cabColor: '#34495e',
      massKg: 8200,
      axles: '4x2',
      description: 'Премиальный магистральник с электронными помощниками и плавным ходом.'
    },
    {
      id: 'scania-s500',
      brand: 'SCANIA',
      model: 'S500 Highline V8',
      name: 'Scania S500 Streamline',
      priceMdl: 260000,
      powerHp: 500,
      torqueNm: 2550,
      fuelCapacity: 700,
      color: '#c0392b',
      cabColor: '#962d22',
      massKg: 8400,
      axles: '4x2',
      description: 'Король дорог. Мощный дизель V8, легендарный басовитый выхлоп и динамика.'
    },
    {
      id: 'volvo-fh16-750',
      brand: 'VOLVO',
      model: 'FH16 750 Globetrotter XL',
      name: 'Volvo FH16 750',
      priceMdl: 310000,
      powerHp: 750,
      torqueNm: 3550,
      fuelCapacity: 800,
      color: '#1e3799',
      cabColor: '#0c2461',
      massKg: 8800,
      axles: '6x4',
      description: 'Флагманский супер-тягач. 750 лошадей с лёгкостью тянут 25-тонные полуприцепы.'
    }
  ];

  const TruckCatalog = {
    TRUCKS,
    getTruck: id => TRUCKS.find(t => t.id === id) || TRUCKS[0]
  };

  root.ETSTrucks = TruckCatalog;
  if (typeof module !== 'undefined' && module.exports) module.exports = TruckCatalog;
})(typeof globalThis !== 'undefined' ? globalThis : window);
