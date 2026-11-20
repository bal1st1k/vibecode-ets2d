#!/usr/bin/env node
/*! 2D ETS2 | Universal Google AI Studio Client (Hydrogen, Neon, Argon, etc.) */

const fs = require('fs');
const path = require('path');

// 1. Load .env
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

// 2. Parse CLI args
const args = process.argv.slice(2);
function getArg(flag, fallback = '') {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

const model = getArg('--model', 'neon');
const prompt = getArg('--prompt');
const output = getArg('--output'); // optional file to save text/code/svg result

if (!prompt) {
  console.log(`
Использование:
  node tools/studio-client.js --model "имя_модели" --prompt "твой запрос" [--output "файл"]

Примеры:
  # Запрос к Neon / Argon / Hydrogen для генерации данных/кода/текста:
  node tools/studio-client.js --model "neon" --prompt "Создай SVG спрайт европейского грузовика" --output "assets/truck.svg"
  `);
  process.exit(0);
}

if (!API_KEY) {
  console.error(`\n[ОШИБКА]: Не задан GEMINI_API_KEY в файле .env!`);
  console.error(`Получи бесплатный ключ на https://aistudio.google.com/app/apikey и пропиши в .env:\nGEMINI_API_KEY=твой_ключ\n`);
  process.exit(1);
}

// 3. Send request to Google AI Studio generateContent
async function askModel() {
  // Normalize model name (e.g. models/neon or neon)
  const modelId = model.startsWith('models/') ? model.slice(7) : model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${API_KEY}`;

  console.log(`[Google AI Studio] Запрос к модели: ${modelId}`);

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.7
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
      throw new Error(`Статус ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates && data.candidates[0];
    const text = candidate?.content?.parts?.map(p => p.text).join('') || '';

    if (!text) {
      console.log('[Пустой ответ от модели]');
      return;
    }

    console.log(`\n--- [ОТВЕТ МОДЕЛИ: ${modelId}] ---\n`);
    console.log(text);
    console.log(`\n----------------------------------\n`);

    if (output) {
      const outputPath = path.resolve(process.cwd(), output);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, text);
      console.log(`[Сохранено в файл]: ${outputPath}`);
    }
  } catch (err) {
    console.error(`[ОШИБКА]:`, err.message);
    process.exit(1);
  }
}

askModel();
