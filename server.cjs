const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4250;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/' || file === '') file = '/index.html';
  const filePath = path.join(__dirname, file);

  // Dynamic fallback for moldova-map.js from moldova-map.json if js not yet generated
  if (file === '/data/moldova-map.js' && !fs.existsSync(filePath)) {
    const jsonPath = path.join(__dirname, 'data/moldova-map.json');
    if (fs.existsSync(jsonPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.write('/*! ETS2 2D | Auto-generated from moldova-map.json */\n(function (root) {\n  "use strict";\n  root.OSM_MOLDOVA_MAP = ');
      const stream = fs.createReadStream(jsonPath);
      stream.pipe(res, { end: false });
      stream.on('end', () => {
        res.end(';\n})(typeof globalThis !== "undefined" ? globalThis : window);\n');
      });
      return;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n==============================================`);
  console.log(`   MOLDOVA TRUCK SIMULATOR 2D (ETS2 2D)`);
  console.log(`   Сервер запущен: http://${HOST}:${PORT}/`);
  console.log(`==============================================\n`);
});
