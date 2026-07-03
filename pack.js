/**
 * pack.js — 打包源代码 zip，用于部署到服务器
 *
 * 用法:
 *   node pack.js
 *
 * 输出: videos-tricks.zip (只含源代码，不含 node_modules/.git/.pkg-cache/dist/uploads/data)
 * 服务器部署: unzip → npm install --production → node server.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const ZIP_NAME = 'videos-tricks.zip';
const ZIP_PATH = path.join(ROOT, ZIP_NAME);

// 需要排除的目录/文件
const EXCLUDES = [
  'node_modules', '.git', '.pkg-cache', 'dist',
  'uploads', 'data', '.idea', '.vscode',
  ZIP_NAME, 'Thumbs.db', '.DS_Store', '_pack_temp.ps1',
];

// 删除旧 zip
if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

console.log('Collecting source files...');

// 用 Windows 内置 tar 打包 (支持中文路径，-a 自动根据扩展名选 zip 格式)
const excludeArgs = EXCLUDES.map(e => `--exclude="${e}"`).join(' ');
const cmd = `tar -a -c -f "${ZIP_NAME}" ${excludeArgs} -C "${ROOT}" .`;

console.log('Packing...');
try {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
} catch (e) {
  console.error('Pack failed:', e.message);
  process.exit(1);
}

if (fs.existsSync(ZIP_PATH)) {
  const size = (fs.statSync(ZIP_PATH).size / 1024).toFixed(1);
  console.log('');
  console.log('========================================');
  console.log('  Done! ' + ZIP_NAME + ' (' + size + ' KB)');
  console.log('========================================');
  console.log('');
  console.log('Deploy on server:');
  console.log('  unzip ' + ZIP_NAME + ' && npm install --production && node server.js');
} else {
  console.log('Pack failed: zip not created');
}
