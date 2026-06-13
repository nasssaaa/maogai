import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3888;
const JWT_SECRET = process.env.JWT_SECRET || 'tiku-brush-dev-secret-change-in-production';

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// SQLite database (file-based, lives on the server)
const dbPath = path.join(dataDir, 'tiku-brush.db');
const db = new Database(dbPath);

// Enable foreign keys and WAL for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER PRIMARY KEY,
    supplements TEXT DEFAULT '{}',
    mastered TEXT DEFAULT '[]',
    bookmarks TEXT DEFAULT '[]',
    wrongs TEXT DEFAULT '[]',
    last_practice TEXT,
    exam_history TEXT DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

console.log(`[Server] SQLite database ready at ${dbPath}`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未登录或 token 无效' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token 已过期或无效' });
    }
    req.user = user; // { id, username }
    next();
  });
}

// === Auth Routes ===

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 2) {
    return res.status(400).json({ error: '用户名至少 2 个字符' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: '密码至少 4 个字符' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    const userId = result.lastInsertRowid;

    // Create empty data row
    db.prepare('INSERT INTO user_data (user_id) VALUES (?)').run(userId);

    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id: userId, username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

  res.json({ token, user: { id: user.id, username: user.username } });
});

// === Data Routes (protected) ===

app.get('/api/data', authenticateToken, (req, res) => {
  const row = db.prepare('SELECT * FROM user_data WHERE user_id = ?').get(req.user.id);

  if (!row) {
    // Should not happen if register created the row
    return res.json({
      supplements: {},
      mastered: [],
      bookmarks: [],
      wrongs: [],
      last_practice: null,
      exam_history: [],
    });
  }

  res.json({
    supplements: JSON.parse(row.supplements || '{}'),
    mastered: JSON.parse(row.mastered || '[]'),
    bookmarks: JSON.parse(row.bookmarks || '[]'),
    wrongs: JSON.parse(row.wrongs || '[]'),
    last_practice: row.last_practice ? JSON.parse(row.last_practice) : null,
    exam_history: JSON.parse(row.exam_history || '[]'),
  });
});

app.post('/api/data', authenticateToken, (req, res) => {
  const { supplements, mastered, bookmarks, wrongs, last_practice, exam_history } = req.body;

  const stmt = db.prepare(`
    UPDATE user_data SET
      supplements = ?,
      mastered = ?,
      bookmarks = ?,
      wrongs = ?,
      last_practice = ?,
      exam_history = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `);

  stmt.run(
    JSON.stringify(supplements ?? {}),
    JSON.stringify(mastered ?? []),
    JSON.stringify(bookmarks ?? []),
    JSON.stringify(wrongs ?? []),
    last_practice ? JSON.stringify(last_practice) : null,
    JSON.stringify(exam_history ?? []),
    req.user.id
  );

  res.json({ success: true });
});

// === Serve React static files (production only) ===
// In dev we use Vite (with /api proxy). In production `npm start` serves everything.
const distPath = path.join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  // SPA fallback - Express 5 compatible wildcard (/* instead of *)
  app.get('/*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next(); // let 404 or other handlers deal with unknown API
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] 后端已启动 http://0.0.0.0:${PORT} (可通过 localhost:${PORT} 访问)`);
  console.log(`[Server] API 端点: /api/auth/login, /api/auth/register, /api/data`);
  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    console.log(`[Server] 生产模式：同时提供前端静态文件 (dist/)`);
  } else {
    console.log(`[Server] 开发模式：仅提供 API，前端由 Vite 提供 (通过 /api 代理)`);
  }
});
