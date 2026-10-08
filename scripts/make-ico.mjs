// Packs packaging/icons/chalkd-<size>.png into packaging/icons/chalkd.ico for
// Windows (the app, its installer, and its shortcuts). ICO files can hold
// PNGs as they are. Run after changing the icons: node scripts/make-ico.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join('packaging', 'icons');
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((size) =>
  readFileSync(path.join(dir, `chalkd-${size}.png`)),
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(images.length, 4);

let offset = header.length + 16 * images.length;
const entries = images.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(sizes[i] % 256, 0); // width (0 means 256)
  entry.writeUInt8(sizes[i] % 256, 1); // height
  entry.writeUInt8(0, 2); // no palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});

const out = path.join(dir, 'chalkd.ico');
writeFileSync(out, Buffer.concat([header, ...entries, ...images]));
console.log(`Wrote ${out}`);
