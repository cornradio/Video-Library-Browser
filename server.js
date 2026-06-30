const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const os = require('os');

const PORT = process.env.PORT || process.argv[2] || 3000;
const BASE = __dirname;
const UPLOADS = path.join(BASE, 'uploads');

// Video quality presets for transcoding
const QUALITY_PRESETS = {
  copy: { name: '直接复制', vbitrate: 0, abitrate: 0, scale: null },
  '1080p-high': { name: '1080p 高画质', vbitrate: 8000, abitrate: 128, scale: 1080 },
  '1080p': { name: '1080p 省空间', vbitrate: 4000, abitrate: 128, scale: 1080 },
  '720p': { name: '720p 手机', vbitrate: 2000, abitrate: 96, scale: 720 },
  '480p': { name: '480p 最小', vbitrate: 1000, abitrate: 64, scale: 480 }
};
const NULL_DEV = os.platform() === 'win32' ? 'NUL' : '/dev/null';
const TRICKS_FILE = path.join(BASE, 'data', 'tricks.json');
const CATS_FILE = path.join(BASE, 'data', 'categories.json');

const funnyNames = [
  '地板杀手','膝盖终结者','重力叛逆者','水泥冲浪王','空中飞人',
  '刹车失灵','轮子成精','马路小旋风','摔倒艺术家','风一样的少年',
  '地心引力挑战者','360度懵逼侠','翻滚吧蛋蛋','闪电小蜗牛','无敌风火轮',
  '膝盖保险到期','地球自转加速器','半空中的咸鱼','刹车在哪','今天不摔了',
  '物理老师哭了','牛顿棺材板','轮胎想飞','地面摩擦战士','我是来滑的'
];

for (const d of ['uploads/videos', 'uploads/thumbnails', 'uploads/trimmed', 'data']) {
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
    execFile('ffmpeg', [
      '-y', '-ss', '00:00:01', '-i', videoPath,
      '-vframes', '1', '-vf', 'scale=480:-1', tp
    ], err => resolve(err ? null : `/uploads/thumbnails/${thumbName}`));
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
        execFile('ffmpeg', [
          '-y', '-ss', String(clip.startTime), '-t', dur, '-i', inputPath,
          '-vf', 'fps=15,scale=480:-1:flags=lanczos,palettegen',
          palettePath
        ], err => err ? reject(err) : resolve());
      });

      // Generate GIF using palette
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-y', '-ss', String(clip.startTime), '-t', dur, '-i', inputPath,
          '-i', palettePath,
          '-filter_complex', '[0:v]fps=15,scale=480:-1:flags=lanczos[v];[v][1:v]paletteuse',
          outputPath
        ], (err) => {
          try { fs.unlinkSync(palettePath); } catch {}
          err ? reject(err) : resolve();
        });
      });

      res.download(outputPath, `${safeName}.gif`, err => {
        try { fs.unlinkSync(outputPath); } catch {}
      });
    } else {
      const outputPath = path.join(UPLOADS, 'trimmed', `${safeName}_${Date.now()}.mp4`);

      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-y', '-ss', String(clip.startTime), '-i', inputPath,
          '-t', dur, '-c', 'copy', '-avoid_negative_ts', 'make_zero',
          outputPath
        ], (err) => {
          if (!err) return resolve();
          // Fallback: re-encode
          execFile('ffmpeg', [
            '-y', '-ss', String(clip.startTime), '-i', inputPath,
            '-t', dur, '-c:v', 'libx264', '-c:a', 'aac',
            outputPath
          ], (err2) => err2 ? reject(err2) : resolve());
        });
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
app.delete('/api/tricks/:id', async (req, res) => {
  const db = readTricks();
  const idx = db.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '未找到' });

  const trick = db[idx];
  const videoFullPath = path.join(BASE, trick.videoPath);
  await killStreams(videoFullPath);
  await new Promise(r => setTimeout(r, 200));
  try { fs.unlinkSync(videoFullPath); } catch {}
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
const SUBTITLE_EXTS = new Set(['.srt', '.ass', '.ssa', '.vtt']);

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
      const subtitleFiles = [];
      for (const e of entries) {
        if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
          const fp = path.join(dir, e.name);
          let size = 0;
          try { size = fs.statSync(fp).size; } catch {}
          videos.push({ name: e.name, path: fp, size });
        } else if (e.isFile() && SUBTITLE_EXTS.has(path.extname(e.name).toLowerCase())) {
          subtitleFiles.push(e.name);
        } else if (e.isDirectory()) {
          folders.push(scan(path.join(dir, e.name)));
        }
      }
      // Match subtitle files to videos by base name
      for (const v of videos) {
        const base = path.basename(v.name, path.extname(v.name));
        const subs = subtitleFiles.filter(s => path.basename(s, path.extname(s)) === base);
        if (subs.length) {
          v.subtitles = subs.map(s => ({ name: s, path: path.join(dir, s) }));
        }
      }
      videos.sort((a, b) => a.name.localeCompare(b.name));
      folders.sort((a, b) => a.name.localeCompare(b.name));
      const hasThumb = fs.existsSync(path.join(dir, '.TThumb.PNG'));
      return { name: path.basename(dir), path: dir, videos, folders, hasThumb };
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
    const subtitleFiles = [];
    for (const e of entries) {
      if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
        const fp = path.join(dirPath, e.name);
        let size = 0;
        try { size = fs.statSync(fp).size; } catch {}
        videos.push({ name: e.name, path: fp, size });
      } else if (e.isFile() && SUBTITLE_EXTS.has(path.extname(e.name).toLowerCase())) {
        subtitleFiles.push(e.name);
      } else if (e.isDirectory()) {
        const subPath = path.join(dirPath, e.name);
        const hasThumb = fs.existsSync(path.join(subPath, '.TThumb.PNG'));
        folders.push({ name: e.name, path: subPath, videos: [], folders: [], hasThumb });
      }
    }
    // Match subtitle files to videos by base name
    for (const v of videos) {
      const base = path.basename(v.name, path.extname(v.name));
      const subs = subtitleFiles.filter(s => path.basename(s, path.extname(s)) === base);
      if (subs.length) {
        v.subtitles = subs.map(s => ({ name: s, path: path.join(dirPath, s) }));
      }
    }
    videos.sort((a, b) => a.name.localeCompare(b.name));
    folders.sort((a, b) => a.name.localeCompare(b.name));
    const hasThumb = fs.existsSync(path.join(dirPath, '.TThumb.PNG'));
    res.json({ name: path.basename(dirPath), path: dirPath, videos, folders, hasThumb });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Track open file streams so we can destroy them before deletion
const openStreams = new Map(); // filePath -> Set of {stream, res}

function killStreams(filePath) {
  return new Promise(resolve => {
    const set = openStreams.get(filePath);
    if (!set || set.size === 0) return resolve();
    let remaining = set.size;
    const timer = setTimeout(() => {
      // Safety timeout: resolve after 2s even if not all streams closed
      console.log('[killStreams] timeout, proceeding with', remaining, 'streams still open');
      resolve();
    }, 2000);
    for (const s of set) {
      const onClose = () => {
        remaining--;
        if (remaining <= 0) { clearTimeout(timer); resolve(); }
      };
      s.stream.once('close', onClose);
      s.stream.once('error', onClose);
      try { s.stream.destroy(); } catch {}
      try { s.res.end(); } catch {}
    }
  });
}

app.get('/api/local/stream', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send('No path');
  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.wmv': 'video/x-msvideo', '.m4v': 'video/mp4' };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const range = req.headers.range;

    function track(stream) {
      if (!openStreams.has(filePath)) openStreams.set(filePath, new Set());
      const entry = { stream, res };
      openStreams.get(filePath).add(entry);
      const cleanup = () => {
        const s = openStreams.get(filePath);
        if (s) { s.delete(entry); if (s.size === 0) openStreams.delete(filePath); }
      };
      stream.on('end', cleanup);
      stream.on('close', cleanup);
      stream.on('error', cleanup);
      res.on('close', cleanup);
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const safeEnd = Math.min(end, stat.size - 1);
      if (start > safeEnd || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${safeEnd}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': safeEnd - start + 1,
        'Content-Type': contentType
      });
      const stream = fs.createReadStream(filePath, { start, end: safeEnd });
      stream.on('error', (err) => {
        console.error('Stream read error:', err.message);
        if (!res.headersSent) res.status(500).send('Stream error');
        else res.end();
      });
      track(stream);
      stream.pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => {
        console.error('Stream read error:', err.message);
        if (!res.headersSent) res.status(500).send('Stream error');
        else res.end();
      });
      track(stream);
      stream.pipe(res);
    }
  } catch (err) {
    console.error('Stream 404:', filePath, '-', err.message);
    if (!res.headersSent) res.status(404).send('File not found');
  }
});

// ── Subtitle file ──
app.get('/api/local/subtitle', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  const ext = path.extname(filePath).toLowerCase();
  const ct = ext === '.vtt' ? 'text/vtt' : ext === '.ass' || ext === '.ssa' ? 'text/x-ssa' : 'text/plain';
  res.setHeader('Content-Type', ct + '; charset=utf-8');
  fs.createReadStream(filePath).pipe(res);
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

app.get('/api/local/clips/:id/export', async (req, res) => {
  try {
    const db = readLocalClips();
    const clip = db.find(c => c.id === req.params.id);
    if (!clip) return res.status(404).json({ error: '片段未找到' });

    const inputPath = clip.videoPath;
    if (!fs.existsSync(inputPath)) return res.status(404).json({ error: '视频文件不存在' });

    const dur = (clip.endTime - clip.startTime).toFixed(2);
    const safeName = clip.name.replace(/[^\w\u4e00-\u9fff-]/g, '_');
    const outputPath = path.join(UPLOADS, 'trimmed', `${safeName}_${Date.now()}.mp4`);

    // Try stream copy first (fast), fallback to re-encode
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-ss', String(clip.startTime), '-i', inputPath,
        '-t', dur, '-c', 'copy', '-avoid_negative_ts', 'make_zero',
        outputPath
      ], (err) => {
        if (!err) return resolve();
        execFile('ffmpeg', [
          '-y', '-ss', String(clip.startTime), '-i', inputPath,
          '-t', dur, '-c:v', 'libx264', '-c:a', 'aac',
          outputPath
        ], (err2) => err2 ? reject(err2) : resolve());
      });
    });

    res.download(outputPath, `${safeName}.mp4`, () => {
      try { fs.unlinkSync(outputPath); } catch {}
    });
  } catch (err) {
    console.error('Local clip export error:', err);
    res.status(500).json({ error: '导出失败: ' + err.message });
  }
});

// ── Folder thumbnail ──
const thumbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/local/folder-thumb', thumbUpload.single('thumb'), (req, res) => {
  try {
    const folderPath = req.body.folderPath;
    if (!folderPath || !req.file) return res.status(400).json({ error: '缺少参数' });
    const thumbPath = path.join(folderPath, '.TThumb.PNG');
    fs.writeFileSync(thumbPath, req.file.buffer);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/local/folder-thumb', (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).send('No path');
  const thumbPath = path.join(folderPath, '.TThumb.PNG');
  if (!fs.existsSync(thumbPath)) return res.status(404).send('Not found');
  const ext = path.extname(thumbPath).toLowerCase();
  const ct = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  fs.createReadStream(thumbPath).pipe(res);
});

app.delete('/api/local/folder-thumb', (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ error: '缺少路径' });
  const thumbPath = path.join(folderPath, '.TThumb.PNG');
  try {
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    console.log('[delete] attempt:', filePath);
    if (!fs.existsSync(filePath)) {
      console.log('[delete] file not found:', filePath);
      return res.status(404).json({ error: '文件不存在' });
    }
    // Kill any open streams for this file and wait for FDs to close
    await killStreams(filePath);
    // Small extra delay for Windows UNC paths to release file locks
    await new Promise(r => setTimeout(r, 200));

    // Try unlink, retry once if file still exists (Windows UNC lock issue)
    fs.unlinkSync(filePath);
    if (fs.existsSync(filePath)) {
      console.log('[delete] still exists, retrying in 500ms...');
      await new Promise(r => setTimeout(r, 500));
      try { fs.unlinkSync(filePath); } catch {}
    }
    if (fs.existsSync(filePath)) {
      console.log('[delete] STILL EXISTS after retry:', filePath);
      // Last resort: move to temp so it's out of sight
      const tempDir = path.join(os.tmpdir(), 'videos-tricks-deleted');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, `${Date.now()}_${path.basename(filePath)}`);
      try {
        fs.renameSync(filePath, tempPath);
        console.log('[delete] moved to temp:', tempPath);
        res.json({ success: true });
        return;
      } catch (e) {
        console.log('[delete] move failed:', e.message);
      }
      return res.status(500).json({ error: '文件删除失败 (仍存在)' });
    }
    console.log('[delete] OK:', filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('[delete] error:', filePath, '-', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/local/file', (req, res) => {
  const { path: filePath, name } = req.body;
  if (!filePath || !name) return res.status(400).json({ error: '参数不完整' });
  try {
    const dir = path.dirname(filePath);
    const newPath = path.join(dir, name);
    fs.renameSync(filePath, newPath);
    res.json({ success: true, newPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Folder Management ──
app.post('/api/local/folder', (req, res) => {
  const { parentPath, name } = req.body;
  if (!parentPath || !name) return res.status(400).json({ error: '参数不完整' });
  const newDir = path.join(parentPath, name.trim());
  try {
    fs.mkdirSync(newDir, { recursive: true });
    res.json({ success: true, path: newDir });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/local/folder', async (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ error: '缺少路径' });
  try {
    fs.rmSync(folderPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/local/folder', async (req, res) => {
  const { path: folderPath, name } = req.body;
  if (!folderPath || !name) return res.status(400).json({ error: '参数不完整' });
  try {
    const dir = path.dirname(folderPath);
    const newPath = path.join(dir, name);
    fs.renameSync(folderPath, newPath);
    res.json({ success: true, newPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/local/move-files', async (req, res) => {
  const { filePaths, destPath } = req.body;
  console.log('[move-files] request:', { filePaths, destPath });
  if (!filePaths?.length || !destPath) return res.status(400).json({ error: '参数不完整' });

  // Check destination exists
  if (!fs.existsSync(destPath) || !fs.statSync(destPath).isDirectory()) {
    return res.status(400).json({ error: '目标文件夹不存在: ' + destPath });
  }

  const moved = [];
  const errors = [];
  for (const fp of filePaths) {
    const dest = path.join(destPath, path.basename(fp));
    console.log('[move-files] attempting:', fp, '->', dest);
    try {
      // Try native rename first (fast, works on same volume)
      fs.renameSync(fp, dest);
      moved.push({ oldPath: fp, newPath: dest });
    } catch (renameErr) {
      // If rename fails (e.g. cross-volume), fall back to copy + delete
      if (renameErr.code === 'ENOENT') {
        console.error('[move-files] source not found:', fp);
        errors.push({ path: fp, error: '源文件不存在' });
        continue;
      }
      try {
        fs.copyFileSync(fp, dest);
        fs.unlinkSync(fp);
        moved.push({ oldPath: fp, newPath: dest });
      } catch (copyErr) {
        console.error('[move-files] failed for:', fp, copyErr.message);
        errors.push({ path: fp, error: copyErr.message });
      }
    }
  }
  console.log('[move-files] result:', { moved: moved.length, errors: errors.length });
  res.json({ success: true, moved, errors });
});

// ── MKV to MP4 conversion (SSE streaming with progress) ──
// ── Probe video info (duration, size) for quality estimation ──
app.get('/api/local/probe', (req, res) => {
  const filePath = req.query.filePath;
  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  execFile('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ], (err, stdout) => {
    const duration = err ? 0 : parseFloat(stdout.trim()) || 0;
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch {}
    res.json({ duration, size, presets: Object.entries(QUALITY_PRESETS).map(([key, p]) => ({
      key, name: p.name,
      estimatedSize: p.vbitrate > 0 ? Math.round((p.vbitrate + p.abitrate) * 1000 / 8 * duration) : size
    }))});
  });
});

// ── Video conversion with SSE progress (supports any video format + quality presets) ──
app.get('/api/local/convert-mkv-stream', (req, res) => {
  const filePath = req.query.filePath;
  const quality = req.query.quality || 'copy';
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.copy;

  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  const ext = path.extname(filePath).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) return res.status(400).json({ error: '不支持的视频格式' });

  const isMkv = ext === '.mkv';
  const isCopy = quality === 'copy';

  // Copy mode only makes sense for MKV → MP4
  if (isCopy && !isMkv) return res.status(400).json({ error: '直接复制仅支持 MKV 文件' });

  // Build output path
  let mp4Path;
  if (isCopy) {
    // MKV → MP4 (same folder, replace extension)
    mp4Path = filePath.replace(/\.mkv$/i, '.mp4');
  } else {
    // Transcode: add quality suffix (e.g. movie_720p.mp4)
    const baseName = path.basename(filePath, ext);
    const dir = path.dirname(filePath);
    mp4Path = path.join(dir, `${baseName}_${quality}.mp4`);
  }
  if (fs.existsSync(mp4Path)) return res.status(400).json({ error: '输出文件已存在: ' + path.basename(mp4Path) });

  // SSE setup
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  const send = (data) => res.write('data: ' + JSON.stringify(data) + '\n\n');

  // Get video duration with ffprobe
  execFile('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ], (err, stdout) => {
    const totalDuration = err ? 0 : parseFloat(stdout.trim()) || 0;

    console.log('[convert-mkv] starting:', filePath, 'quality:', quality, 'duration:', totalDuration);

    // Build ffmpeg args based on quality
    const isCopy = quality === 'copy';
    let ffmpegProcess;

    if (isCopy) {
      // Stream copy (fast, no re-encode)
      ffmpegProcess = execFile('ffmpeg', [
        '-y', '-i', filePath,
        '-map', '0:v', '-map', '0:a',
        '-c', 'copy',
        mp4Path
      ], handleDone);
    } else {
      // Two-pass encoding
      const vBitrate = preset.vbitrate + 'k';
      const aBitrate = preset.abitrate + 'k';
      const passLogFile = path.join(UPLOADS, 'trimmed', `ffmpeg2pass_${Date.now()}`);

      const scaleFilter = preset.scale ? ['-vf', `scale=-2:${preset.scale}`] : null;
      const pass1Args = [
        '-y', '-i', filePath,
        '-map', '0:v',
        '-c:v', 'libx264', '-b:v', vBitrate,
        '-pass', '1', '-passlogfile', passLogFile,
        '-an', '-f', 'mp4', NULL_DEV
      ];
      if (scaleFilter) {
        const idx = pass1Args.indexOf('-c:v');
        pass1Args.splice(idx, 0, scaleFilter[0], scaleFilter[1]);
      }

      const pass2Args = [
        '-y', '-i', filePath,
        '-map', '0:v', '-map', '0:a',
        '-c:v', 'libx264', '-b:v', vBitrate,
        '-pass', '2', '-passlogfile', passLogFile,
        '-c:a', 'aac', '-b:a', aBitrate,
        mp4Path
      ];
      if (scaleFilter) {
        const idx = pass2Args.indexOf('-c:v');
        pass2Args.splice(idx, 0, scaleFilter[0], scaleFilter[1]);
      }

      // Pass 1
      send({ progress: 0, phase: '分析中' });
      const pass1 = execFile('ffmpeg', pass1Args, (err) => {
        if (err) {
          cleanupPassLog(passLogFile);
          handleDone(err);
          return;
        }
        // Pass 2
        send({ progress: 0, phase: '编码中' });
        ffmpegProcess = execFile('ffmpeg', pass2Args, (err) => {
          cleanupPassLog(passLogFile);
          handleDone(err);
        });
        // Parse pass 2 stderr for progress
        attachProgress(ffmpegProcess, totalDuration, '编码中');
        req.on('close', () => killProcess(ffmpegProcess));
      });

      // Parse pass 1 stderr for progress
      attachProgress(pass1, totalDuration, '分析中');
      req.on('close', () => killProcess(pass1));
      return;
    }

    // Parse stderr for progress (copy mode)
    attachProgress(ffmpegProcess, totalDuration, '');
    req.on('close', () => killProcess(ffmpegProcess));
  });

  let completed = false;

  function handleDone(err) {
    completed = true;
    if (err) {
      try { fs.unlinkSync(mp4Path); } catch {}
      console.error('[convert] failed:', err.message);
      send({ error: '转换失败: ' + err.message });
      res.end();
    } else {
      // Only delete source for MKV→copy mode; keep original for transcodes
      if (isCopy && isMkv) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      console.log('[convert] done:', mp4Path);
      send({ done: true, newPath: mp4Path });
      res.end();
    }
  }

  function attachProgress(proc, duration, phase) {
    let stderrBuf = '';
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const matches = stderrBuf.match(/time=(\d+:\d+:\d+\.\d+)/g);
      if (matches) {
        const last = matches[matches.length - 1];
        const timeStr = last.replace('time=', '');
        const parts = timeStr.split(':');
        const currentSec = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
        const progress = duration > 0 ? Math.min(100, Math.round((currentSec / duration) * 100)) : 0;
        send({ progress, time: timeStr.split('.')[0], phase });
        if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048);
      }
    });
  }

  function killProcess(proc) {
    if (completed) return; // Don't touch anything if conversion finished
    if (proc && !proc.killed) {
      proc.kill();
      try { fs.unlinkSync(mp4Path); } catch {}
    }
  }

  function cleanupPassLog(passLogFile) {
    try { fs.unlinkSync(passLogFile + '-0.log'); } catch {}
    try { fs.unlinkSync(passLogFile + '-0.log.mbtree'); } catch {}
  }
});

// ── MKV to MP4 conversion (upload mode for FSA/local) ──
const convertStorage = multer.diskStorage({
  destination: (_req, _f, cb) => cb(null, path.join(UPLOADS, 'trimmed')),
  filename: (_req, file, cb) => cb(null, `convert_${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
});
const convertUpload = multer({ storage: convertStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } });

app.post('/api/local/convert-mkv-upload', convertUpload.single('file'), multerErrHandler, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未上传文件' });
  const inputPath = req.file.path;
  const mp4Name = path.basename(req.file.originalname, path.extname(req.file.originalname)) + '.mp4';
  const outputPath = path.join(UPLOADS, 'trimmed', `converted_${Date.now()}.mp4`);

  console.log('[convert-mkv-upload] starting:', inputPath);

  try {
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-i', inputPath,
        '-map', '0:v', '-map', '0:a',
        '-c', 'copy',
        outputPath
      ], (err, stdout, stderr) => {
        if (err) {
          console.error('[convert-mkv-upload] ffmpeg error:', stderr?.slice(-500));
          reject(err);
        } else resolve();
      });
    });

    // Clean up uploaded MKV
    try { fs.unlinkSync(inputPath); } catch {}

    console.log('[convert-mkv-upload] done:', outputPath);
    const downloadUrl = '/api/local/convert-download?file=' + encodeURIComponent(path.basename(outputPath)) + '&name=' + encodeURIComponent(mp4Name);
    res.json({ success: true, downloadUrl });
  } catch (err) {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
    console.error('[convert-mkv-upload] failed:', err.message);
    res.status(500).json({ error: '转换失败: ' + err.message });
  }
});

app.get('/api/local/convert-download', (req, res) => {
  const fileName = req.query.file;
  const displayName = req.query.name || 'converted.mp4';
  if (!fileName) return res.status(400).send('No file');
  const filePath = path.join(UPLOADS, 'trimmed', fileName);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath, displayName, () => {
    // Clean up after download
    setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 5000);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tricks Collection running at http://0.0.0.0:${PORT}`);
});
