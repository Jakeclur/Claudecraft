#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Install Node.js (LTS) from https://nodejs.org then run this again."; open https://nodejs.org 2>/dev/null; exit 1; fi
[ -d node_modules ] || npm install
(sleep 2; open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) &
node server.js
