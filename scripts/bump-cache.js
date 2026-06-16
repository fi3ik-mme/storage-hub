#!/usr/bin/env node
/**
 * Bump APP_VERSION so the service worker drops old caches.
 * Run after code changes: node scripts/bump-cache.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const versionFile = path.join(root, 'js', 'app-version.js');
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const content = `const APP_VERSION = '${stamp}';\n`;

fs.writeFileSync(versionFile, content);
console.log(`Bumped APP_VERSION → ${stamp}`);
