#!/usr/bin/env node
/*! 2D ETS2 | Google AI Studio Image Generator (Imagen 3 / Gemini) */

const fs = require('fs');
const path = require('path');

// 1. Simple zero-dependency .env loader
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// 2. Parse CLI arguments
const args = process.argv.slice(2);
function getArg(flag, fallback = '') {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

const prompt = getArg('--prompt');
const output = getArg('--output', 'assets/generated/output.png');
const aspect = getArg('--aspect', '16:9'); // 1:1, 3:4, 4:3, 9:16, 16:9
const model = getArg('--model', 'imagen-3.0-generate-002');

if (!prompt) {
  console.log(`
Использование:
  node tools/studio-generate.js --prompt "описание изображения" [параметры]

Параметры:
  --output   Путь сохранения (по умолчанию: assets/generated/output.png)
  --aspect   Соотношение сторон: 16:9, 1:1, 4:3, 3:4, 9:16 (по умолчанию: 16:9)
  --model    Модель в AI Studio (по умолчанию: imagen-3.0-generate-002)

Пример:
  node tools/studio-generate.js \\
    --prompt "Studio photograph of Volvo FH16 750 truck, front three-quarter view, dramatic lighting, 8k" \\
    --output "assets/trucks/volvo-hero.png" \\
    --aspect "16:9"
  `);
  process.exit(0);
}

if (!API_KEY) {
  console.error(`\n[ОШИБКА]: Не найден GEMINI_API_KEY!`);
  console.error(`1. Получите бесплатный ключ на https://aistudio.google.com/app/apikey`);
  console.error(`2. Добавьте его в файл .env:`);
  console.error(`   GEMINI_API_KEY=ваш_ключ\n`);
  process.exit(1);
}

// 3. Call Google AI Studio REST API for Imagen 3
async function generate() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${API_KEY}`;

  console.log(`\n======================================================`);
  console.log(`[Google AI Studio] Отправка запроса в модель: ${model}`);
  console.log(`Промпт: "${prompt}"`);
  console.log(`Формат: ${aspect} | Целевой файл: ${output}`);
  console.log(`======================================================\n`);

  const payload = {
    instances: [
      { prompt }
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: aspect,
      outputMimeType: 'image/png'
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error && parsed.error.message) errMsg = parsed.error.message;
      } catch (_) {}
      throw new Error(`Ошибка API (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    const prediction = data.predictions && data.predictions[0];
    if (!prediction || !prediction.bytesBase64Encoded) {
      throw new Error('API не вернуло байты изображения в ответе');
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(prediction.bytesBase64Encoded, 'base64');

    // Ensure output directory exists
    const outputPath = path.resolve(process.cwd(), output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);

    const sizeKb = (buffer.length / 1024).toFixed(1);
    console.log(`[УСПЕХ]: Изображение сохранено!`);
    console.log(`Файл: ${outputPath} (${sizeKb} KB)\n`);
  } catch (err) {
    console.error(`\n[ОШИБКА ГЕНЕРАЦИИ]:`, err.message);
    process.exit(1);
  }
}

generate();
