const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || process.argv[2] || 3000;
const BASE = __dirname;
const UPLOADS = path.join(BASE, 'uploads');
const TRICKS_FILE = path.join(BASE, 'data', 'tricks.json');
const CATS_FILE = path.join(BASE, 'data', 'categories.json');

const funnyNames = [
  '地板杀手','膝盖终结者','重力叛逆者','水泥冲浪王','空中飞人',
  '刹车失灵','轮子成精','马路小旋风','摔倒艺术家','风一样的少年',
  '地心引力挑战者','360度懵逼侠','翻滚吧蛋蛋','闪电小蜗牛','无敌风火轮',
  '膝盖保险到期','地球自转加速器','半空中的咸鱼','刹车在哪','今天不摔了',
  '物理老师哭了','牛顿棺材板','轮胎想飞','地面摩擦战士','我是来滑的'
];

for (const d of ['uploads/videos', 'uploads/thumbnails', 'data']) {
  const p = path.join(BASE, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ── DB helpers ──
function readTricks() {
  try { return JSON.parse(fs.readFileSync(TRICKS_FILE, 'utf-8')); }
  catch { return []; }
}
function writeTricks(d) { fs.writeFileSync(TRICKS_FILE, JSON.stringify(d, null, 2)); }

function readCats() {
  try { return JSON.parse(fs.readFileSync(CATS_FILE, 'utf-8')); }
  catch { return []; }
}
function writeCats(d) { fs.writeFileSync(CATS_FILE, JSON.stringify(d, null, 2)); }

function getDescendantIds(cats, parentId) {
  const ids = [parentId];
  for (const child of cats.filter(c => c.parentId === parentId))
    ids.push(...getDescendantIds(cats, child.id));
  return ids;
}

// ── Thumbnail ──
function generateThumbnail(videoPath, thumbName) {
  return new Promise(resolve => {
    const tp = path.join(UPLOADS, 'thumbnails', thumbName);
    exec(
      `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -vf "scale=480:-1" "${tp}"`,
      err => resolve(err ? null : `/uploads/thumbnails/${thumbName}`)
    );
  });
}

// ── Multer ──
const storage = multer.diskStorage({
  destination: (_req, _f, cb) => cb(null, path.join(UPLOADS, 'videos')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function multerErrHandler(err, req, res, next) {
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: '上传错误: ' + err.message });
  next(err);
}

// ── App ──
const app = express();
app.use(express.json());
app.use(express.static(path.join(BASE, 'public')));
app.use('/uploads', express.static(UPLOADS));

// ════════════════════════════
//  Category API
// ════════════════════════════
app.get('/api/categories', (_req, res) => res.json(readCats()));

app.post('/api/categories', (req, res) => {
  const { name, parentId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '请输入分类名称' });
  const cats = readCats();
  if (parentId && !cats.find(c => c.id === parentId))
    return res.status(400).json({ error: '父分类不存在' });
  const cat = { id: randomUUID(), name: name.trim(), parentId: parentId || null, createdAt: new Date().toISOString() };
  cats.push(cat);
  writeCats(cats);
  res.json(cat);
});

// Rename category
app.patch('/api/categories/:id', (req, res) => {
  const cats = readCats();
  const cat = cats.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: '未找到' });
  if (req.body.name?.trim()) cat.name = req.body.name.trim();
  if (req.body.parentId !== undefined) cat.parentId = req.body.parentId || null;
  writeCats(cats);
  res.json(cat);
});

app.delete('/api/categories/:id', (req, res) => {
  let cats = readCats();
  const tricks = readTricks();
  const toRemove = new Set(getDescendantIds(cats, req.params.id));
  let changed = false;
  for (const t of tricks) {
    if (toRemove.has(t.category)) { t.category = null; changed = true; }
  }
  if (changed) writeTricks(tricks);
  cats = cats.filter(c => !toRemove.has(c.id));
  writeCats(cats);
  res.json({ success: true });
});

// ════════════════════════════
//  Tricks API
// ════════════════════════════
app.get('/api/tricks', (req, res) => {
  const db = readTricks();
  let changed = false;
  for (const t of db) {
    if (t.fileSize == null) {
      try { t.fileSize = fs.statSync(path.join(BASE, t.videoPath)).size; changed = true; } catch {}
    }
  }
  if (changed) writeTricks(db);
  if (req.query.category) {
    const ids = getDescendantIds(readCats(), req.query.category);
    const filtered = db.filter(t => ids.includes(t.category));
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json(filtered);
  }
  db.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(db);
});

// Upload (category defaults to null)
app.post('/api/tricks', upload.single('file'), multerErrHandler, async (req, res) => {
  try {
    const { name, notes } = req.body;
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const trickName = name?.trim() || funnyNames[Math.floor(Math.random() * funnyNames.length)];

    const ext = path.extname(req.file.filename).toLowerCase();
    const mediaType = ext === '.gif' ? 'gif' : 'video';
    const videoPath = `/uploads/videos/${req.file.filename}`;

    let thumbnail = null;
    if (mediaType === 'video') {
      thumbnail = await generateThumbnail(req.file.path, req.file.filename.replace(ext, '.jpg'));
    }

    const trick = {
      id: randomUUID(),
      name: trickName,
      category: null,
      mediaType,
      videoPath,
      fileSize: req.file.size,
      thumbnail,
      clips: [],
      notes: notes?.trim() || '',
      originalName: req.file.originalname,
      createdAt: new Date().toISOString()
    };

    const db = readTricks();
    db.push(trick);
    writeTricks(db);
    res.json(trick);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Rename / move category
app.patch('/api/tricks/:id', (req, res) => {
  const db = readTricks();
  const trick = db.find(t => t.id === req.params.id);
  if (!trick) return res.status(404).json({ error: '未找到' });
  if (req.body.name !== undefined) trick.name = req.body.name;
  if (req.body.category !== undefined) trick.category = req.body.category || null;
  if (req.body.notes !== undefined) trick.notes = req.body.notes;
  writeTricks(db);
  res.json(trick);
});

// ── Clip management (time-range markers, no file ops) ──
app.post('/api/tricks/:id/clips', (req, res) => {
  const db = readTricks();
  const trick = db.find(t => t.id === req.params.id);
  if (!trick) return res.status(404).json({ error: '未找到' });
  if (!trick.clips) trick.clips = [];

  const { startTime, endTime, name } = req.body;
  if (startTime === undefined || endTime === undefined)
    return res.status(400).json({ error: '缺少起止时间' });

  const clip = {
    id: randomUUID(),
    name: name?.trim() || `片段 ${trick.clips.length + 1}`,
    startTime: parseFloat(startTime),
    endTime: parseFloat(endTime)
  };
  trick.clips.push(clip);
  writeTricks(db);
  res.json(clip);
});

app.patch('/api/tricks/:trickId/clips/:clipId', (req, res) => {
  const db = readTricks();
  const trick = db.find(t => t.id === req.params.trickId);
  if (!trick?.clips) return res.status(404).json({ error: '未找到' });
  const clip = trick.clips.find(c => c.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: '片段未找到' });
  if (req.body.name !== undefined) clip.name = req.body.name;
  if (req.body.startTime !== undefined) clip.startTime = parseFloat(req.body.startTime);
  if (req.body.endTime !== undefined) clip.endTime = parseFloat(req.body.endTime);
  writeTricks(db);
  res.json(clip);
});

// ── Clip Export ──
app.get('/api/tricks/:trickId/clips/:clipId/export', async (req, res) => {
  try {
    const db = readTricks();
    const trick = db.find(t => t.id === req.params.trickId);
    if (!trick?.clips) return res.status(404).json({ error: '未找到' });
    const clip = trick.clips.find(c => c.id === req.params.clipId);
    if (!clip) return res.status(404).json({ error: '片段未找到' });

    const format = req.query.format || 'mp4';
    const inputPath = path.join(BASE, trick.videoPath);
    const dur = (clip.endTime - clip.startTime).toFixed(2);
    const safeName = clip.name.replace(/[^\w\u4e00-\u9fff-]/g, '_');

    if (format === 'gif') {
      const palettePath = path.join(UPLOADS, 'trimmed', `palette_${Date.now()}.png`);
      const outputPath = path.join(UPLOADS, 'trimmed', `${safeName}_${Date.now()}.gif`);

      // Generate palette
      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -y -ss ${clip.startTime} -t ${dur} -i "${inputPath}" -vf "fps=15,scale=480:-1:flags=lanczos,palettegen" "${palettePath}"`,
          err => err ? reject(err) : resolve()
        );
      });

      // Generate GIF using palette
      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -y -ss ${clip.startTime} -t ${dur} -i "${inputPath}" -i "${palettePath}" -filter_complex "[0:v]fps=15,scale=480:-1:flags=lanczos[v];[v][1:v]paletteuse" "${outputPath}"`,
          err => {
            try { fs.unlinkSync(palettePath); } catch {}
            err ? reject(err) : resolve();
          }
        );
      });

      res.download(outputPath, `${safeName}.gif`, err => {
        try { fs.unlinkSync(outputPath); } catch {}
      });
    } else {
      const outputPath = path.join(UPLOADS, 'trimmed', `${safeName}_${Date.now()}.mp4`);

      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -y -i "${inputPath}" -ss ${clip.startTime} -t ${dur} -c copy -avoid_negative_ts make_zero "${outputPath}"`,
          err => {
            if (!err) return resolve();
            // Fallback: re-encode
            exec(
              `ffmpeg -y -i "${inputPath}" -ss ${clip.startTime} -t ${dur} -c:v libx264 -c:a aac "${outputPath}"`,
              err2 => err2 ? reject(err2) : resolve()
            );
          }
        );
      });

      res.download(outputPath, `${safeName}.mp4`, err => {
        try { fs.unlinkSync(outputPath); } catch {}
      });
    }
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: '导出失败: ' + err.message });
  }
});

app.delete('/api/tricks/:trickId/clips/:clipId', (req, res) => {
  const db = readTricks();
  const trick = db.find(t => t.id === req.params.trickId);
  if (!trick?.clips) return res.status(404).json({ error: '未找到' });
  trick.clips = trick.clips.filter(c => c.id !== req.params.clipId);
  writeTricks(db);
  res.json({ success: true });
});

// Delete trick + files
app.delete('/api/tricks/:id', (req, res) => {
  const db = readTricks();
  const idx = db.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '未找到' });

  const trick = db[idx];
  try { fs.unlinkSync(path.join(BASE, trick.videoPath)); } catch {}
  if (trick.thumbnail) {
    try { fs.unlinkSync(path.join(BASE, trick.thumbnail)); } catch {}
  }

  db.splice(idx, 1);
  writeTricks(db);
  res.json({ success: true });
});

// ════════════════════════════
//  Local Viewer API
// ════════════════════════════
const LOCAL_CLIPS_FILE = path.join(BASE, 'data', 'local-clips.json');
const LOCAL_THUMB_DIR = path.join(UPLOADS, 'local-thumbs');
for (const d of [LOCAL_THUMB_DIR]) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function readLocalClips() { try { return JSON.parse(fs.readFileSync(LOCAL_CLIPS_FILE, 'utf-8')); } catch { return []; } }
function writeLocalClips(d) { fs.writeFileSync(LOCAL_CLIPS_FILE, JSON.stringify(d, null, 2)); }

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.m4v']);

app.get('/api/local/directory', (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) return res.status(400).json({ error: '请输入路径' });
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(400).json({ error: '路径不存在' });
    }

    function scan(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const videos = [];
      const folders = [];
      for (const e of entries) {
        if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
          const fp = path.join(dir, e.name);
          let size = 0;
          try { size = fs.statSync(fp).size; } catch {}
          videos.push({ name: e.name, path: fp, size });
        } else if (e.isDirectory()) {
          folders.push(scan(path.join(dir, e.name)));
        }
      }
      videos.sort((a, b) => a.name.localeCompare(b.name));
      folders.sort((a, b) => a.name.localeCompare(b.name));
      return { name: path.basename(dir), path: dir, videos, folders };
    }

    res.json(scan(dirPath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lightweight folder scan (direct contents only, no recursion) — for refresh
app.get('/api/local/scan-folder', (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) return res.status(400).json({ error: '缺少路径' });
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(400).json({ error: '路径不存在' });
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const videos = [];
    const folders = [];
    for (const e of entries) {
      if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
        const fp = path.join(dirPath, e.name);
        let size = 0;
        try { size = fs.statSync(fp).size; } catch {}
        videos.push({ name: e.name, path: fp, size });
      } else if (e.isDirectory()) {
        const subPath = path.join(dirPath, e.name);
        folders.push({ name: e.name, path: subPath, videos: [], folders: [] });
      }
    }
    videos.sort((a, b) => a.name.localeCompare(b.name));
    folders.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ name: path.basename(dirPath), path: dirPath, videos, folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/local/stream', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('No path');
  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.wmv': 'video/x-ms-wmv', '.m4v': 'video/mp4' };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    res.status(404).send('File not found');
  }
});

app.get('/api/local/thumbnail', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('No path');
  const customTime = req.query.t; // optional custom timestamp in seconds
  try {
    // Include custom time in hash so different times produce different cache files
    const hashInput = customTime ? filePath + '@' + customTime : filePath;
    const hash = require('crypto').createHash('md5').update(hashInput).digest('hex');
    const thumbPath = path.join(LOCAL_THUMB_DIR, hash + '.jpg');
    if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).size < 500) {
      // Delete failed/tiny thumbnail
      try { fs.unlinkSync(thumbPath); } catch {}
      let ok = false;
      if (customTime != null) {
        // Use only the specified timestamp
        try {
          await new Promise((resolve, reject) => {
            execFile('ffmpeg', ['-y', '-ss', String(customTime), '-i', filePath, '-vframes', '1', '-vf', 'scale=480:-1', thumbPath],
              err => err ? reject(err) : resolve());
          });
          if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500) ok = true;
        } catch {}
      } else {
        // Try multiple timestamps
        for (const t of ['1', '0.5', '0']) {
          try {
            await new Promise((resolve, reject) => {
              execFile('ffmpeg', ['-y', '-ss', t, '-i', filePath, '-vframes', '1', '-vf', 'scale=480:-1', thumbPath],
                err => err ? reject(err) : resolve());
            });
            if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500) { ok = true; break; }
          } catch {}
        }
      }
      if (!ok) return res.status(404).send('Thumbnail failed');
    }
    if (req.query._) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else {
      res.set('Cache-Control', 'public, max-age=86400');
    }
    res.sendFile(thumbPath);
  } catch {
    res.status(404).send('Thumbnail failed');
  }
});

app.get('/api/local/clips-counts', (req, res) => {
  const db = readLocalClips();
  const counts = {};
  for (const c of db) counts[c.videoPath] = (counts[c.videoPath] || 0) + 1;
  res.json(counts);
});

app.get('/api/local/clips', (req, res) => {
  const videoPath = req.query.path;
  const clips = readLocalClips().filter(c => c.videoPath === videoPath);
  res.json(clips);
});

app.post('/api/local/clips', (req, res) => {
  const { videoPath, name, startTime, endTime } = req.body;
  if (!videoPath || startTime == null || endTime == null) return res.status(400).json({ error: '参数不完整' });
  const clip = {
    id: randomUUID(), videoPath,
    name: name?.trim() || '片段',
    startTime: parseFloat(startTime), endTime: parseFloat(endTime),
    createdAt: new Date().toISOString()
  };
  const db = readLocalClips(); db.push(clip); writeLocalClips(db);
  res.json(clip);
});

app.patch('/api/local/clips/:id', (req, res) => {
  const db = readLocalClips();
  const clip = db.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: '未找到' });
  if (req.body.name !== undefined) clip.name = req.body.name;
  if (req.body.startTime !== undefined) clip.startTime = parseFloat(req.body.startTime);
  if (req.body.endTime !== undefined) clip.endTime = parseFloat(req.body.endTime);
  writeLocalClips(db); res.json(clip);
});

app.delete('/api/local/clips/:id', (req, res) => {
  let db = readLocalClips();
  db = db.filter(c => c.id !== req.params.id);
  writeLocalClips(db); res.json({ success: true });
});

// Server-side file operations
app.get('/api/local/reveal', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  try {
    execFile('explorer.exe', ['/select,' + filePath], err => {
      // explorer.exe /select returns non-zero even on success, ignore errors
      res.json({ success: true });
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/local/file', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  try {
    await new Promise((resolve, reject) => {
      execFile('powershell', ['-Command', 'Remove-Item -LiteralPath $env:_F -Force'], {
        env: { ...process.env, _F: filePath }
      }, err => err ? reject(err) : resolve());
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/local/file', async (req, res) => {
  const { path: filePath, name } = req.body;
  if (!filePath || !name) return res.status(400).json({ error: '参数不完整' });
  try {
    const dir = path.dirname(filePath);
    const newPath = path.join(dir, name);
    await new Promise((resolve, reject) => {
      execFile('powershell', ['-Command', 'Rename-Item -LiteralPath $env:_F -NewName $env:_N'], {
        env: { ...process.env, _F: filePath, _N: name }
      }, err => err ? reject(err) : resolve());
    });
    res.json({ success: true, newPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Folder Management ──
app.post('/api/local/folder', async (req, res) => {
  const { parentPath, name } = req.body;
  if (!parentPath || !name) return res.status(400).json({ error: '参数不完整' });
  const newDir = path.join(parentPath, name.trim());
  try {
    await new Promise((resolve, reject) => {
      execFile('powershell', ['-Command', 'New-Item -ItemType Directory -Path $env:_P -Force | Out-Null'], {
        env: { ...process.env, _P: newDir }
      }, err => err ? reject(err) : resolve());
    });
    res.json({ success: true, path: newDir });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/local/folder', async (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ error: '缺少路径' });
  try {
    await new Promise((resolve, reject) => {
      execFile('powershell', ['-Command', 'Remove-Item -LiteralPath $env:_P -Recurse -Force'], {
        env: { ...process.env, _P: folderPath }
      }, err => err ? reject(err) : resolve());
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/local/folder', async (req, res) => {
  const { path: folderPath, name } = req.body;
  if (!folderPath || !name) return res.status(400).json({ error: '参数不完整' });
  try {
    const dir = path.dirname(folderPath);
    const newPath = path.join(dir, name);
    await new Promise((resolve, reject) => {
      execFile('powershell', ['-Command', 'Rename-Item -LiteralPath $env:_P -NewName $env:_N'], {
        env: { ...process.env, _P: folderPath, _N: name }
      }, err => err ? reject(err) : resolve());
    });
    res.json({ success: true, newPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/local/move-files', async (req, res) => {
  const { filePaths, destPath } = req.body;
  console.log('[move-files] request:', { filePaths, destPath });
  if (!filePaths?.length || !destPath) return res.status(400).json({ error: '参数不完整' });
  const moved = [];
  const errors = [];
  for (const fp of filePaths) {
    try {
      await new Promise((resolve, reject) => {
        execFile('powershell', ['-Command', 'Move-Item -LiteralPath $env:_F -Destination $env:_D -Force'], {
          env: { ...process.env, _F: fp, _D: destPath }
        }, (err, stdout, stderr) => {
          if (err) { console.error('[move-files] PowerShell error:', err.message, 'stderr:', stderr); reject(err); }
          else resolve();
        });
      });
      moved.push({ oldPath: fp, newPath: path.join(destPath, path.basename(fp)) });
    } catch (err) {
      console.error('[move-files] failed for:', fp, err.message);
      errors.push({ path: fp, error: err.message });
    }
  }
  console.log('[move-files] result:', { moved: moved.length, errors: errors.length });
  res.json({ success: true, moved, errors });
});

app.listen(PORT, () => {
  console.log(`Tricks Collection running at http://localhost:${PORT}`);
});
