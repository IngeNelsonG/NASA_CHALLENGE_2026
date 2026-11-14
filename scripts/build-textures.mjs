// Rebuilds the Earth textures in public/textures from equirectangular sources.
// Usage: npm i -D sharp && node scripts/build-textures.mjs <dir-with-earth_day_4096.jpg-and-earth_night_4096.jpg> [outDir]
// Sources used for the committed files: three.js examples/textures/planets (NASA Blue Marble / Black Marble derived).
import sharp from 'sharp';
import path from 'node:path';

const [src, out = 'public/textures'] = process.argv.slice(2);
if (!src) throw new Error('source dir required');

const jobs = [
  ['earth_day_4096.jpg', 'earth-day', [[4096, 78], [2048, 76], [512, 60]]],
  ['earth_night_4096.jpg', 'earth-night', [[4096, 70], [2048, 70], [512, 55]]],
];
for (const [file, name, sizes] of jobs) {
  for (const [w, q] of sizes) {
    const dest = path.join(out, `${name}-${w}.webp`);
    await sharp(path.join(src, file)).resize(w, w / 2).webp({ quality: q, effort: 5 }).toFile(dest);
    console.log('wrote', dest);
  }
}
