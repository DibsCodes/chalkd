// pdf.js loads fonts, character maps, and decoders at runtime by URL, so
// they're copied next to the app (public/ is served as-is by Vite).
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const from = path.join('node_modules', 'pdfjs-dist');
const to = path.join('public', 'pdfjs');
mkdirSync(to, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(path.join(from, dir), path.join(to, dir), { recursive: true });
}
console.log(`Copied pdf.js data to ${to}`);
