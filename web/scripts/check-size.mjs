// Fails if initial JS exceeds 150 KB gzipped (spec M5).
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
const dir = new URL('../dist/assets/', import.meta.url)
const total = readdirSync(dir).filter(f => f.endsWith('.js'))
  .reduce((n, f) => n + gzipSync(readFileSync(new URL(f, dir))).length, 0)
console.log(`JS gzipped: ${(total / 1024).toFixed(1)} KB (budget 150 KB)`)
if (total > 150 * 1024) process.exit(1)
