#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "Запуск Moldova Truck Simulator 2D..."
xdg-open "http://127.0.0.1:4250/" 2>/dev/null &
node server.cjs
