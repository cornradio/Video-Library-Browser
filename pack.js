const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'videos-tricks.zip');
const SKIP = new Set(['uploads', 'data', 'node_modules', 'videos-tricks.zip']);

function walk(dir, base) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) entries.push(...walk(full, base));
    else entries.push({ full, rel: path.relative(base, full).replace(/\\/g, '/') });
  }
  return entries;
}

const files = walk(ROOT, ROOT);
const tmp = path.join(ROOT, '.pack-tmp');
if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });

for (const f of files) {
  const dest = path.join(tmp, f.rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(f.full, dest);
  console.log('  + ' + f.rel);
}

if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
const ps = `Compress-Archive -Path '${tmp}\\*' -DestinationPath '${OUT}' -Force`;
execSync(`powershell -Command "${ps}"`, { stdio: 'inherit' });

fs.rmSync(tmp, { recursive: true });
const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\nPacked ${files.length} files -> ${OUT}`);
console.log(`Size: ${size} KB`);
