'use strict';

require('dotenv').config();

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const db         = require('./database');

// ─── Kiểm tra biến môi trường bắt buộc ────────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET chưa được cấu hình hoặc quá ngắn (>= 32 ký tự).');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD_HASH) {
  console.error('[FATAL] ADMIN_PASSWORD_HASH chưa được cấu hình. Chạy: npm run setup');
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware chung ─────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate limiter: tối đa 5 lần thử/15 phút per IP ──────────────────────
const loginLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 5,
  message  : { error: 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.' },
  standardHeaders : true,
  legacyHeaders   : false,
});

// ─── Middleware: xác thực JWT Admin ──────────────────────────────────────
function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Không có quyền truy cập.' });
  }
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Không đủ quyền.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc token không hợp lệ.' });
  }
}

// ─── Helpers: làm sạch & kiểm tra đầu vào ────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

function validateName(raw) {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim();
  if (clean.length === 0 || clean.length > 100) return null;
  return sanitize(clean);
}

function generateId(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ═══════════════════════════════════════════════════════════════════════════
//  API: XÁC THỰC
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/admin/login
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập mật khẩu.' });
  }

  const hash = process.env.ADMIN_PASSWORD_HASH;
  const match = await bcrypt.compare(password, hash);
  if (!match) {
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ error: 'Mật khẩu không đúng.' });
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

// ═══════════════════════════════════════════════════════════════════════════
//  API: CÀI ĐẶT
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/settings  (public)
app.get('/api/settings', async (req, res) => {
  try {
    const settingsColl = db.getSettingsCollection();
    const globalSettings = await settingsColl.findOne({ _id: 'global' });
    res.json({ title: globalSettings ? globalSettings.title : '🍊COLLECTED' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// PATCH /api/settings  (admin only)
app.patch('/api/settings', requireAdmin, async (req, res) => {
  const validTitle = validateName(req.body.title);
  if (!validTitle) return res.status(400).json({ error: 'Tiêu đề không hợp lệ.' });

  try {
    const settingsColl = db.getSettingsCollection();
    await settingsColl.updateOne(
      { _id: 'global' },
      { $set: { title: validTitle } },
      { upsert: true }
    );
    res.json({ success: true, title: validTitle });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  API: LỚP HỌC
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/classes  (public)
app.get('/api/classes', async (req, res) => {
  try {
    const classesColl = db.getClassesCollection();
    // Sort by order first, then created_at
    const classes = await classesColl.find({}).sort({ order: 1, created_at: 1 }).toArray();
    
    // Convert _id objects to match our frontend logic if needed (but frontend uses `id`)
    const result = classes.map(c => {
      delete c._id;
      return c;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// POST /api/classes  (admin)
app.post('/api/classes', requireAdmin, async (req, res) => {
  const validName = validateName(req.body.name);
  if (!validName) return res.status(400).json({ error: 'Tên lớp không hợp lệ.' });

  try {
    const classesColl = db.getClassesCollection();
    // Get max order
    const lastClass = await classesColl.find({}).sort({ order: -1 }).limit(1).toArray();
    const newOrder = (lastClass.length > 0 && lastClass[0].order !== undefined) ? lastClass[0].order + 1 : 0;

    const newClass = { 
      id: generateId('c'), 
      name: validName, 
      created_at: Date.now(), 
      order: newOrder,
      students: [] 
    };

    await classesColl.insertOne(newClass);
    delete newClass._id;
    res.status(201).json(newClass);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// PATCH /api/classes/:classId  (admin)
app.patch('/api/classes/:classId', requireAdmin, async (req, res) => {
  const { classId } = req.params;
  const validName = validateName(req.body.name);
  if (!validName) return res.status(400).json({ error: 'Tên lớp không hợp lệ.' });

  try {
    const classesColl = db.getClassesCollection();
    const result = await classesColl.findOneAndUpdate(
      { id: classId },
      { $set: { name: validName } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
    delete result._id;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// DELETE /api/classes/:classId  (admin)
app.delete('/api/classes/:classId', requireAdmin, async (req, res) => {
  const { classId } = req.params;
  try {
    const classesColl = db.getClassesCollection();
    const result = await classesColl.deleteOne({ id: classId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// PATCH /api/classes/reorder (admin)
app.patch('/api/classes/reorder', requireAdmin, async (req, res) => {
  const { classIds } = req.body;
  if (!Array.isArray(classIds)) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  }

  try {
    const classesColl = db.getClassesCollection();
    // Bulk write to update order
    const bulkOps = classIds.map((id, index) => ({
      updateOne: {
        filter: { id: id },
        update: { $set: { order: index } }
      }
    }));

    if (bulkOps.length > 0) {
      await classesColl.bulkWrite(bulkOps);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  API: HỌC SINH
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/classes/:classId/students  (admin) - Thêm 1 học sinh
app.post('/api/classes/:classId/students', requireAdmin, async (req, res) => {
  const { classId } = req.params;
  const validName = validateName(req.body.name);
  if (!validName) return res.status(400).json({ error: 'Tên học sinh không hợp lệ.' });

  try {
    const classesColl = db.getClassesCollection();
    const newStudent = { id: generateId('s'), name: validName, points: 0, created_at: Date.now() };
    
    const result = await classesColl.updateOne(
      { id: classId },
      { $push: { students: newStudent } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
    res.status(201).json(newStudent);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// POST /api/classes/:classId/students/bulk  (admin) - Nhập hàng loạt từ Excel
app.post('/api/classes/:classId/students/bulk', requireAdmin, async (req, res) => {
  const { classId } = req.params;
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'Danh sách học sinh không hợp lệ.' });
  }
  if (students.length > 200) {
    return res.status(400).json({ error: 'Tối đa 200 học sinh mỗi lần nhập.' });
  }

  const newStudents = [];
  for (const raw of students) {
    const validName = validateName(raw);
    if (!validName) continue;
    newStudents.push({
      id: generateId('s'),
      name: validName,
      points: 0,
      created_at: Date.now()
    });
  }

  if (newStudents.length === 0) {
    return res.json({ success: true, added: 0 });
  }

  try {
    const classesColl = db.getClassesCollection();
    const result = await classesColl.updateOne(
      { id: classId },
      { $push: { students: { $each: newStudents } } }
    );
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
    res.json({ success: true, added: newStudents.length });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// PATCH /api/classes/:classId/students/:studentId  (admin) - Đổi tên
app.patch('/api/classes/:classId/students/:studentId', requireAdmin, async (req, res) => {
  const { classId, studentId } = req.params;
  const validName = validateName(req.body.name);
  if (!validName) return res.status(400).json({ error: 'Tên học sinh không hợp lệ.' });

  try {
    const classesColl = db.getClassesCollection();
    const result = await classesColl.findOneAndUpdate(
      { id: classId, 'students.id': studentId },
      { $set: { 'students.$.name': validName } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Không tìm thấy học sinh hoặc lớp.' });
    
    const updatedStudent = result.students.find(s => s.id === studentId);
    res.json(updatedStudent);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// DELETE /api/classes/:classId/students/:studentId  (admin)
app.delete('/api/classes/:classId/students/:studentId', requireAdmin, async (req, res) => {
  const { classId, studentId } = req.params;
  
  try {
    const classesColl = db.getClassesCollection();
    const result = await classesColl.updateOne(
      { id: classId },
      { $pull: { students: { id: studentId } } }
    );
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
    if (result.modifiedCount === 0) return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// PATCH /api/classes/:classId/students/:studentId/points  (admin)
app.patch('/api/classes/:classId/students/:studentId/points', requireAdmin, async (req, res) => {
  const { classId, studentId } = req.params;
  const change = parseInt(req.body.change, 10);
  if (isNaN(change) || change === 0 || Math.abs(change) > 100) {
    return res.status(400).json({ error: 'Thay đổi điểm không hợp lệ.' });
  }

  try {
    const classesColl = db.getClassesCollection();
    
    // First, find the current points to ensure they don't go below 0
    const cls = await classesColl.findOne({ id: classId, 'students.id': studentId }, { projection: { 'students.$': 1 } });
    if (!cls || !cls.students || cls.students.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
    }
    
    let currentPoints = cls.students[0].points || 0;
    let newPoints = Math.max(0, currentPoints + change);

    const result = await classesColl.findOneAndUpdate(
      { id: classId, 'students.id': studentId },
      { $set: { 'students.$.points': newPoints } },
      { returnDocument: 'after' }
    );

    res.json({ id: studentId, points: newPoints });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── 404 fallback ────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API không tồn tại.' });
  }
  // SPA fallback
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Khởi động ────────────────────────────────────────────────────────────
db.connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
  });
});
