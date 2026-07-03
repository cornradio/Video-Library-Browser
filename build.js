/**
 * build.js — 一键打包 videos-tricks 为单个 EXE 文件
 *
 * 用法:
 *   node build.js          — 直接运行
 *   npm run build          — 通过 npm script
 *
 * 要求: Node.js 18.x (pkg 对 node18 支持最好)
 * 输出: dist/videos-tricks.exe
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Step 1: 确保依赖已安装
console.log('[1/5] 检查依赖...');
try {
  require.resolve('express');
  require.resolve('multer');
} catch (e) {
  console.log('  安装项目依赖...');
  execSync('npm install --production', { stdio: 'inherit', cwd: ROOT });
}

// Step 2: 清理不必要的文件，减小打包体积
console.log('[2/5] 清理 node_modules...');
const nmDir = path.join(ROOT, 'node_modules');
// 删除非 Windows 的 systray 二进制文件
const traybin = path.join(nmDir, 'systray', 'traybin');
if (fs.existsSync(traybin)) {
  for (const f of fs.readdirSync(traybin)) {
    if (f.includes('darwin') || f.includes('linux')) {
      fs.rmSync(path.join(traybin, f), { recursive: true, force: true });
    }
  }
}
// 递归删除 node_modules 中的无用文件 (test, docs, examples, README, CHANGELOG 等)
function cleanNodeModules(dir, depth) {
  if (depth > 3) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const lower = entry.name.toLowerCase();
      if (['test', 'tests', 'example', 'examples', 'doc', 'docs', 'coverage', '.github', '.nyc_output', 'bench', 'benchmark'].includes(lower)) {
        fs.rmSync(fp, { recursive: true, force: true });
      } else {
        cleanNodeModules(fp, depth + 1);
      }
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (/^(readme|changelog|changes|history|license|licence|contributing|authors|news)\b/i.test(lower) ||
          /\.(md|markdown|ts|tsx|coffee|yml|yaml|lock|log|jst|html|css|map)$/i.test(lower)) {
        try { fs.unlinkSync(fp); } catch {}
      }
    }
  }
}
cleanNodeModules(nmDir, 0);
console.log('  清理完成');

// Step 3: 安装 @yao-pkg/pkg (如果未安装)
console.log('[3/5] 检查打包工具 @yao-pkg/pkg...');
try {
  require.resolve('@yao-pkg/pkg');
} catch (e) {
  console.log('  安装 @yao-pkg/pkg...');
  execSync('npm install --save-dev @yao-pkg/pkg', { stdio: 'inherit', cwd: ROOT });
}

// Step 4: 确保 data 目录有默认文件
console.log('[4/5] 准备默认数据文件...');
const dataDir = path.join(ROOT, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const defaults = {
  'tricks.json': '[]',
  'categories.json': '[]',
  'local-clips.json': '[]',
};
for (const [name, content] of Object.entries(defaults)) {
  const fp = path.join(dataDir, name);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, content);
}

// Step 5: 执行打包
console.log('[5/5] 打包中 (这可能需要几分钟)...');
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

try {
  execSync('npx @yao-pkg/pkg . --out-path dist', {
    stdio: 'inherit',
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PKG_CACHE_PATH: path.join(ROOT, '.pkg-cache')
    })
  });
} catch (e) {
  console.error('\n[ERROR] 打包失败:', e.message);
  process.exit(1);
}

// 结果
const files = fs.readdirSync(DIST);
if (files.length > 0) {
  const f = files[0];
  const fp = path.join(DIST, f);
  const size = (fs.statSync(fp).size / 1024 / 1024).toFixed(1);
  console.log('');
  console.log('========================================');
  console.log('  打包成功!');
  console.log('  输出: dist/' + f + ' (' + size + ' MB)');
  console.log('========================================');
  console.log('');
  console.log('使用方法:');
  console.log('  1. 把 ' + f + ' 放到任意文件夹');
  console.log('  2. 双击运行 (默认端口 3000)');
  console.log('  3. 浏览器打开 http://localhost:3000');
  console.log('  data/ 和 uploads/ 会自动在 exe 同目录创建');
  console.log('');
  console.log('自定义端口:');
  console.log('  ' + f + ' 8080');
} else {
  console.log('打包失败: 输出目录为空');
}
