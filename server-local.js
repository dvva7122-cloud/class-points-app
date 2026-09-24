'use strict';

/**
 * server-local.js
 * Server nhẹ để xem giao diện local mà không cần kết nối MongoDB.
 * Dùng file data.json làm nguồn dữ liệu tạm thời.
 * KHÔNG dùng file này để deploy lên hosting!
 */

require('dotenv').config();

const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');

const app  = express();
const PORT = 3000;

// ─── Dữ liệu mẫu tạm thời nếu data.json chưa có ────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');
let localData = { settings: { title: '🍊COLLECTED' }, classes: [
  { id: 'c1', name: 'Lớp 10A1', students: [
    { id: 's1', name: 'Nguyễn Văn A', points: 5 },
    { id: 's2', name: 'Trần Thị B', points: 12 },
    { id: 's3', name: 'Lê Văn C', points: 8 },
    { id: 's4', name: 'Phạm Thị D', points: 2 },
    { id: 's5', name: 'Hoàng Văn E', points: 25 },
  ]},
  { id: 'c2', name: 'Lớp 10A2', students: [
    { id: 's6', name: 'Vũ Thị F', points: 10 },
    { id: 's7', name: 'Đặng Văn G', points: 4 },
    { id: 's8', name: 'Bùi Thị H', points: 18 },
  ]},
]};

if (fs.existsSync(DATA_FILE)) {
  try { localData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(_) {}
}

function saveLocal() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(localData, null, 2));
}

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10 });

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Không có quyền.' });
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Không đủ quyền.' });
    next();
  } catch(e) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });
  }
}

function generateId(p='') { return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function sanitize(s) { return typeof s==='string' ? s.replace(/[<>"'&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;','&':'&amp;'})[c]).trim() : ''; }
function validateName(r) { const c=sanitize(r||''); return c.length>0&&c.length<=100?c:null; }

// ─── Routes ───────────────────────────────────────────────────────────────
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Nhập mật khẩu.' });
  const match = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
  if (!match) return res.status(401).json({ error: 'Mật khẩu không đúng.' });
  const token = jwt.sign({ role:'admin' }, process.env.JWT_SECRET, { expiresIn:'2h' });
  res.json({ token });
});

app.get('/api/settings', (req, res) => res.json({
  title: localData.settings?.title || '🍊COLLECTED',
  lockRedeemHk1: localData.settings?.lockRedeemHk1 || false,
  lockRedeemHk2: localData.settings?.lockRedeemHk2 || false
}));
app.patch('/api/settings', requireAdmin, (req, res) => {
  if (!localData.settings) localData.settings = {};
  if (req.body.title !== undefined) {
    const t = validateName(req.body.title);
    if (t) localData.settings.title = t;
  }
  if (req.body.lockRedeemHk1 !== undefined) localData.settings.lockRedeemHk1 = Boolean(req.body.lockRedeemHk1);
  if (req.body.lockRedeemHk2 !== undefined) localData.settings.lockRedeemHk2 = Boolean(req.body.lockRedeemHk2);
  saveLocal();
  res.json({ success:true, ...localData.settings });
});

app.get('/api/classes', (req, res) => res.json(localData.classes || []));

app.post('/api/classes', requireAdmin, (req, res) => {
  const name = validateName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Không hợp lệ.' });
  const c = { id:generateId('c'), name, students:[], order:(localData.classes||[]).length };
  localData.classes.push(c); saveLocal();
  res.status(201).json(c);
});

app.patch('/api/classes/reorder', requireAdmin, (req, res) => {
  const { classIds } = req.body;
  if (!Array.isArray(classIds)) return res.status(400).json({ error: 'Không hợp lệ.' });
  localData.classes = classIds.map(id=>localData.classes.find(c=>c.id===id)).filter(Boolean);
  const rest = localData.classes.filter(c=>!classIds.includes(c.id));
  localData.classes = [...localData.classes, ...rest];
  saveLocal(); res.json({ success:true });
});

app.patch('/api/classes/:id', requireAdmin, (req, res) => {
  const cls = localData.classes.find(c=>c.id===req.params.id);
  if (!cls) return res.status(404).json({ error: 'Không tìm thấy.' });
  const name = validateName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Không hợp lệ.' });
  cls.name = name; saveLocal(); res.json(cls);
});

app.delete('/api/classes/:id', requireAdmin, (req, res) => {
  const i = localData.classes.findIndex(c=>c.id===req.params.id);
  if (i===-1) return res.status(404).json({ error: 'Không tìm thấy.' });
  localData.classes.splice(i,1); saveLocal(); res.json({ success:true });
});

app.post('/api/classes/:id/students', requireAdmin, (req, res) => {
  const cls = localData.classes.find(c=>c.id===req.params.id);
  if (!cls) return res.status(404).json({ error: 'Không tìm thấy.' });
  const name = validateName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Không hợp lệ.' });
  const s = { id:generateId('s'), name, points:0 };
  cls.students.push(s); saveLocal(); res.status(201).json(s);
});

app.post('/api/classes/:id/students/bulk', requireAdmin, (req, res) => {
  const cls = localData.classes.find(c=>c.id===req.params.id);
  if (!cls) return res.status(404).json({ error: 'Không tìm thấy.' });
  const { students } = req.body;
  if (!Array.isArray(students)) return res.status(400).json({ error: 'Không hợp lệ.' });
  let count=0;
  for (const raw of students) {
    const name = validateName(raw);
    if (name) { cls.students.push({ id:generateId('s'), name, points:0 }); count++; }
  }
  saveLocal(); res.json({ success:true, added:count });
});

app.patch('/api/classes/:cid/students/:sid', requireAdmin, (req, res) => {
  const cls = localData.classes.find(c=>c.id===req.params.cid);
  const stu = cls && cls.students.find(s=>s.id===req.params.sid);
  if (!stu) return res.status(404).json({ error: 'Không tìm thấy.' });
  const name = validateName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Không hợp lệ.' });
  stu.name = name; saveLocal(); res.json(stu);
});

app.delete('/api/classes/:cid/students/:sid', requireAdmin, (req, res) => {
  const cls = localData.classes.find(c=>c.id===req.params.cid);
  if (!cls) return res.status(404).json({ error: 'Không tìm thấy.' });
  const i = cls.students.findIndex(s=>s.id===req.params.sid);
  if (i===-1) return res.status(404).json({ error: 'Không tìm thấy.' });
  cls.students.splice(i,1); saveLocal(); res.json({ success:true });
});

app.patch('/api/classes/:cid/students/:sid/points', requireAdmin, (req, res) => {
  const cls = localData.classes.find(c=>c.id===req.params.cid);
  const stu = cls && cls.students.find(s=>s.id===req.params.sid);
  if (!stu) return res.status(404).json({ error: 'Không tìm thấy.' });
  const change = parseInt(req.body.change,10);
  if (isNaN(change)||change===0||Math.abs(change)>100) return res.status(400).json({ error: 'Không hợp lệ.' });
  stu.points = Math.max(0, stu.points+change);
  saveLocal(); res.json({ id:req.params.sid, points:stu.points });
});

app.post('/api/classes/:cid/students/:sid/redeem-hs1', async (req, res) => {
  const { cid, sid } = req.params;
  const { password, semKey, delta, targetSlotIndex } = req.body;

  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Vui lòng nhập mật khẩu.' });
  if (!['hk1', 'hk2'].includes(semKey)) return res.status(400).json({ error: 'Học kỳ không hợp lệ.' });
  const numericDelta = parseFloat(delta);
  if (![0.25, 0.5, 1.0].includes(numericDelta)) return res.status(400).json({ error: 'Mức điểm quy đổi không hợp lệ.' });

  if (semKey === 'hk1' && localData.settings?.lockRedeemHk1) {
    return res.status(400).json({ error: 'Học kỳ I đã bị giáo viên khóa chức năng quy đổi điểm.' });
  }
  if (semKey === 'hk2' && localData.settings?.lockRedeemHk2) {
    return res.status(400).json({ error: 'Học kỳ II đã bị giáo viên khóa chức năng quy đổi điểm.' });
  }

  const cls = (localData.classes || []).find(c => c.id === cid);
  if (!cls) return res.status(404).json({ error: 'Không tìm thấy lớp.' });
  const student = (cls.students || []).find(s => s.id === sid);
  if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh.' });
  if (!student.passwordHash && password !== 'ADMIN') return res.status(400).json({ error: 'Học sinh chưa có mật khẩu.' });

  // Admin bypass: nếu password là 'ADMIN', bỏ qua xác thực mật khẩu học sinh
  if (password !== 'ADMIN') {
    const match = await bcrypt.compare(password.toLowerCase(), student.passwordHash);
    if (!match) return res.status(401).json({ error: 'Mật khẩu không đúng.' });
  }

  if (!student.grades) student.grades = { hk1: { hs1: [null, null, null, null], hs2: null, hs3: null }, hk2: { hs1: [null, null, null, null], hs2: null, hs3: null } };
  if (!student.grades[semKey]) student.grades[semKey] = { hs1: [null, null, null, null], hs2: null, hs3: null };
  if (!Array.isArray(student.grades[semKey].hs1)) student.grades[semKey].hs1 = [null, null, null, null];

  const hs1Array = student.grades[semKey].hs1;

  function findTargetSlotIndex(arr) {
    for (let i = 0; i < 4; i++) { if (arr[i] === null || arr[i] === undefined) return i; }
    let lowestIdx = -1, lowestVal = 11;
    for (let i = 0; i < 4; i++) {
      if (arr[i] !== null && arr[i] < 10) {
        if (arr[i] < lowestVal) { lowestVal = arr[i]; lowestIdx = i; }
      }
    }
    return lowestIdx;
  }

  function getCostForDelta(mark, delta) {
    const start = Math.max(0, (mark === null || mark === undefined) ? 0 : mark);
    const end = Math.min(10.0, Math.round((start + delta) * 100) / 100);
    if (end <= start) return 0;

    const tiers = [
      { min: 0.0, max: 5.0, rate: 1 },
      { min: 5.0, max: 7.0, rate: 2 },
      { min: 7.0, max: 8.0, rate: 4 },
      { min: 8.0, max: 9.0, rate: 8 },
      { min: 9.0, max: 10.0, rate: 16 }
    ];

    let totalCost = 0;
    for (const t of tiers) {
      const overlapStart = Math.max(start, t.min);
      const overlapEnd = Math.min(end, t.max);
      if (overlapEnd > overlapStart) {
        const span = overlapEnd - overlapStart;
        totalCost += span * t.rate;
      }
    }

    return Math.max(1, Math.round(totalCost));
  }

  let targetIdx = -1;
  if (targetSlotIndex !== undefined && targetSlotIndex !== null && !isNaN(parseInt(targetSlotIndex, 10))) {
    const idx = parseInt(targetSlotIndex, 10);
    if (idx >= 0 && idx < 4 && (hs1Array[idx] === null || hs1Array[idx] < 10)) {
      targetIdx = idx;
    }
  }
  if (targetIdx === -1) {
    targetIdx = findTargetSlotIndex(hs1Array);
  }
  if (targetIdx === -1) return res.status(400).json({ error: 'Tất cả 4 cột điểm HS1 học kỳ này đã đạt 10.0 điểm.' });

  const curMark = hs1Array[targetIdx] || 0;
  const cost = getCostForDelta(curMark, numericDelta);
  const currentPoints = student.points || 0;
  if (currentPoints < cost) return res.status(400).json({ error: `Số Quả Cam không đủ! Cần ${cost} 🍊 nhưng bạn chỉ có ${currentPoints} 🍊.` });

  let newVal = curMark + numericDelta;
  let overflowVal = 0;
  if (newVal > 10.0) { overflowVal = Math.round((newVal - 10.0) * 100) / 100; newVal = 10.0; }
  hs1Array[targetIdx] = Math.round(newVal * 100) / 100;

  if (overflowVal > 0) {
    const nextIdx = findTargetSlotIndex(hs1Array);
    if (nextIdx !== -1) {
      const nextCur = hs1Array[nextIdx] || 0;
      hs1Array[nextIdx] = Math.min(10.0, Math.round((nextCur + overflowVal) * 100) / 100);
    }
  }

  student.points = currentPoints - cost;
  const historyEntry = {
    historyId: Date.now().toString() + '_' + Math.floor(Math.random() * 10000),
    studentId: sid,
    studentName: student.name,
    change: -cost,
    reason: password === 'ADMIN'
      ? `Giáo viên quy đổi ${cost} 🍊 cho HS lấy +${numericDelta}đ HS1 (${semKey === 'hk1' ? 'HK1' : 'HK2'} - Ô ${targetIdx + 1})`
      : `Tự đổi ${cost} 🍊 lấy +${numericDelta}đ HS1 (${semKey === 'hk1' ? 'HK1' : 'HK2'} - Ô ${targetIdx + 1})`,
    ts: Date.now()
  };
  cls.history.push(historyEntry);

  saveLocal();
  res.json({ success: true, points: student.points, grades: student.grades, historyEntry });
});

app.use((req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'Không tìm thấy.'});
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ [LOCAL] Server đang chạy tại http://localhost:${PORT}`);
  console.log('   (Đây là server xem local, dùng data.json, KHÔNG kết nối MongoDB)');
});
