'use strict';

/**
 * public/app.js
 * Frontend hoàn toàn dựa trên API. Không lưu dữ liệu lớp/học sinh/điểm vào localStorage.
 * - Mật khẩu KHÔNG được kiểm tra ở đây.
 * - JWT được lưu trong sessionStorage (xóa khi đóng tab).
 * - Mọi thao tác write đều gửi JWT lên backend để xác thực.
 * - Dùng createElement / textContent thay vì innerHTML để chống XSS.
 */

// ─── State ────────────────────────────────────────────────────────────────
let appData        = [];       // [{id, name, students:[{id, name, points}]}]
let currentClassId = null;
let isAdmin        = false;
let isEditingMode  = false;
let themeState     = loadThemeLocal();   // theme lưu localStorage vì đây là UI preference

// ─── Token helpers ────────────────────────────────────────────────────────
function getToken() {
  return sessionStorage.getItem('adminToken');
}
function setToken(token) {
  sessionStorage.setItem('adminToken', token);
}
function clearToken() {
  sessionStorage.removeItem('adminToken');
}

// ─── API helper ───────────────────────────────────────────────────────────
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token   = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Phiên hết hạn hoặc token không hợp lệ
  if (res.status === 401 || res.status === 403) {
    handleSessionExpired();
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi server ${res.status}`);
  return data;
}

function handleSessionExpired() {
  clearToken();
  isAdmin = false;
  isEditingMode = false;
  updateAdminUI();
  renderCurrentClass();
  document.getElementById('session-expired-modal').classList.add('show');
}

// ─── Theme state (chỉ lưu local để tránh chớp màn hình khi tải trang, bản thật lấy từ server) ──
let themeState = { name: 'default', useFrames: false, customBg: null };

async function saveThemeToServer(patch) {
  try {
    await api('PATCH', '/api/settings', patch);
    Object.assign(themeState, patch);
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

function applyTheme() {
  document.body.className = `theme-${themeState.name}`;
  if (isAdmin) document.body.classList.add('is-admin');
  if (isEditingMode) document.body.classList.add('is-editing');

  const checkbox = document.getElementById('toggle-frames');
  if (checkbox) checkbox.checked = themeState.useFrames;

  const appBg       = document.getElementById('app-background');
  const clearBgBtn  = document.getElementById('clear-custom-bg');

  if (themeState.customBg) {
    appBg.style.backgroundImage = `url(${themeState.customBg})`;
    document.body.classList.add('custom-bg-active');
    if (clearBgBtn) clearBgBtn.style.display = 'inline-block';
  } else {
    appBg.style.backgroundImage = '';
    document.body.classList.remove('custom-bg-active');
    if (clearBgBtn) clearBgBtn.style.display = 'none';
  }

  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.theme === themeState.name);
  });
}

// ─── Render helpers (dùng createElement thay vì innerHTML để chống XSS) ──
function createEl(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.title) el.title = opts.title;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function renderClassTabs() {
  const container = document.getElementById('class-tabs');
  container.innerHTML = '';

  let draggedItem = null;

  appData.forEach((cls, index) => {
    const btn = createEl('button', { className: `tab-btn${cls.id === currentClassId ? ' active' : ''}`, text: cls.name });
    btn.dataset.index = index;
    btn.dataset.id = cls.id;

    if (isEditingMode) {
      btn.setAttribute('draggable', 'true');
      btn.style.cursor = 'grab';

      btn.addEventListener('dragstart', function(e) {
        draggedItem = this;
        setTimeout(() => this.classList.add('dragging'), 0);
      });

      btn.addEventListener('dragend', function() {
        this.classList.remove('dragging');
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('drag-over'));
        draggedItem = null;
      });

      btn.addEventListener('dragover', function(e) {
        e.preventDefault();
        if (this !== draggedItem) {
          this.classList.add('drag-over');
        }
      });

      btn.addEventListener('dragleave', function() {
        this.classList.remove('drag-over');
      });

      btn.addEventListener('drop', async function(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        if (this !== draggedItem) {
          const fromIndex = parseInt(draggedItem.dataset.index, 10);
          const toIndex = parseInt(this.dataset.index, 10);
          
          // Reorder locally
          const movedClass = appData.splice(fromIndex, 1)[0];
          appData.splice(toIndex, 0, movedClass);
          
          renderClassTabs();

          // Sync with server
          try {
            const classIds = appData.map(c => c.id);
            await api('PATCH', '/api/classes/reorder', { classIds });
          } catch (err) {
            if (err.message !== 'Unauthorized') showError('Lỗi khi lưu vị trí lớp: ' + err.message);
          }
        }
      });
    }

    btn.addEventListener('click', () => {
      currentClassId = cls.id;
      renderClassTabs();
      renderCurrentClass();
    });
    container.appendChild(btn);
  });
}

function getCurrentClass() {
  return appData.find(c => c.id === currentClassId) || null;
}

function renderCurrentClass() {
  const cls            = getCurrentClass();
  const nameEl         = document.getElementById('current-class-name');
  const gridEl         = document.getElementById('student-grid');
  const classInfoEl    = document.querySelector('.class-info');
  const addContainer   = document.getElementById('add-student-container');

  if (!cls) {
    classInfoEl.style.display = 'none';
    addContainer.style.display = 'none';
    gridEl.innerHTML = '';
    const p = createEl('p', { text: 'Chưa có lớp học nào. Hãy tạo một lớp mới!', className: 'empty-msg' });
    p.style.cssText = 'text-align:center;width:100%;color:#888;';
    gridEl.appendChild(p);
    return;
  }

  classInfoEl.style.display = 'flex';
  nameEl.textContent = cls.name;
  gridEl.innerHTML = '';

  if (cls.students.length === 0) {
    const p = createEl('p', { text: 'Lớp này chưa có học sinh.' });
    p.style.cssText = 'text-align:center;width:100%;color:#888;';
    gridEl.appendChild(p);
  } else {
    const maxPts = Math.max(...cls.students.map(s => s.points));
    cls.students.forEach(student => renderStudentCard(student, cls.id, maxPts));
  }
}

function renderStudentCard(student, classId, maxPts) {
  const gridEl   = document.getElementById('student-grid');
  const isTop    = maxPts > 0 && student.points === maxPts;

  const card = createEl('div', {
    className: `student-card ${themeState.useFrames ? 'with-frame' : ''} ${isTop ? 'is-top' : ''}`,
  });
  card.dataset.studentId = student.id;

  // Tên + nút sửa/xóa
  const nameRow = createEl('div', { className: 'student-name-container' });

  if (isTop) {
    const crown = createEl('span', { className: 'crown-icon', text: '👑', title: 'Người cao điểm nhất' });
    nameRow.appendChild(crown);
  }

  const nameEl = createEl('div', { className: 'student-name', text: student.name });
  nameRow.appendChild(nameEl);

  // Nút sửa tên (chỉ hiện khi is-editing)
  const editBtn = createEl('button', { className: 'action-icon edit-icon admin-edit-only', title: 'Đổi tên' });
  editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  editBtn.addEventListener('click', () => doEditStudentName(classId, student.id, student.name));
  nameRow.appendChild(editBtn);

  // Nút xóa (chỉ hiện khi is-editing)
  const delBtn = createEl('button', { className: 'action-icon delete-icon admin-edit-only', title: 'Xóa học sinh' });
  delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
  delBtn.addEventListener('click', () => doDeleteStudent(classId, student.id, student.name));
  nameRow.appendChild(delBtn);

  card.appendChild(nameRow);

  // Điểm
  const pointsRow = createEl('div', { className: 'points-display' });
  pointsRow.id = `points-${student.id}`;
  const pointVal = createEl('span', { className: 'point-val', text: String(student.points) });
  pointsRow.appendChild(pointVal);
  pointsRow.appendChild(document.createTextNode(' 🍊'));
  card.appendChild(pointsRow);

  // Nút +/- (hiện khi is-admin, không cần is-editing)
  const actionRow = createEl('div', { className: 'action-buttons admin-only' });

  const minusBtn = createEl('button', { className: 'btn-action btn-minus', text: '-' });
  minusBtn.addEventListener('click', () => doUpdatePoints(classId, student.id, -1));
  actionRow.appendChild(minusBtn);

  const plusBtn = createEl('button', { className: 'btn-action btn-plus', text: '+' });
  plusBtn.addEventListener('click', () => doUpdatePoints(classId, student.id, 1));
  actionRow.appendChild(plusBtn);

  card.appendChild(actionRow);
  document.getElementById('student-grid').appendChild(card);
}

// ─── Actions → gọi API (không sửa data client mà re-fetch sau khi thành công) ──

async function doUpdatePoints(classId, studentId, change) {
  try {
    const res = await api('PATCH', `/api/classes/${classId}/students/${studentId}/points`, { change });
    // Cập nhật local state không cần re-fetch toàn bộ
    const cls     = appData.find(c => c.id === classId);
    const student = cls && cls.students.find(s => s.id === studentId);
    if (student) {
      student.points = res.points;
      // Cập nhật DOM trực tiếp
      const display  = document.getElementById(`points-${studentId}`);
      if (display) {
        display.querySelector('.point-val').textContent = res.points;
        display.classList.remove('pop');
        void display.offsetWidth;
        display.classList.add('pop');
      }
      // Cập nhật crown nếu thứ hạng thay đổi
      renderCurrentClass();
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doEditStudentName(classId, studentId, currentName) {
  const newName = prompt('Nhập tên mới cho học sinh:', currentName);
  if (!newName || !newName.trim()) return;
  try {
    const res = await api('PATCH', `/api/classes/${classId}/students/${studentId}`, { name: newName });
    const cls     = appData.find(c => c.id === classId);
    const student = cls && cls.students.find(s => s.id === studentId);
    if (student) student.name = res.name;
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doDeleteStudent(classId, studentId, name) {
  if (!confirm(`Bạn có chắc chắn muốn xóa học sinh "${name}" không?`)) return;
  try {
    await api('DELETE', `/api/classes/${classId}/students/${studentId}`);
    const cls = appData.find(c => c.id === classId);
    if (cls) cls.students = cls.students.filter(s => s.id !== studentId);
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doAddStudent() {
  const name = prompt('Nhập tên học sinh mới:');
  if (!name || !name.trim()) return;
  try {
    const res = await api('POST', `/api/classes/${currentClassId}/students`, { name });
    const cls  = appData.find(c => c.id === currentClassId);
    if (cls) cls.students.push(res);
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doEditClassName() {
  const cls = getCurrentClass();
  if (!cls) return;
  const newName = prompt('Nhập tên mới cho lớp:', cls.name);
  if (!newName || !newName.trim()) return;
  try {
    const res = await api('PATCH', `/api/classes/${currentClassId}`, { name: newName });
    cls.name = res.name;
    renderClassTabs();
    document.getElementById('current-class-name').textContent = res.name;
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doDeleteClass() {
  const cls = getCurrentClass();
  if (!cls) return;
  if (!confirm(`Bạn có chắc chắn muốn xóa toàn bộ "${cls.name}" không? Thao tác này không thể hoàn tác.`)) return;
  try {
    await api('DELETE', `/api/classes/${currentClassId}`);
    appData = appData.filter(c => c.id !== currentClassId);
    currentClassId = appData.length > 0 ? appData[0].id : null;
    renderClassTabs();
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doAddClass() {
  const name = prompt('Nhập tên lớp mới:');
  if (!name || !name.trim()) return;
  try {
    const res = await api('POST', '/api/classes', { name });
    appData.push(res);
    currentClassId = res.id;
    renderClassTabs();
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doEditTitle() {
  const current = document.getElementById('app-main-title').textContent;
  const newTitle = prompt('Nhập tiêu đề mới:', current);
  if (!newTitle || !newTitle.trim()) return;
  try {
    const res = await api('PATCH', '/api/settings', { title: newTitle });
    document.getElementById('app-main-title').textContent = res.title;
    // Lưu preference vào localStorage để hiển thị đúng khi reload trước khi fetch
    localStorage.setItem('classPointsTitle', res.title);
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

// ─── Excel Import ─────────────────────────────────────────────────────────
async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (evt) {
    try {
      const wb       = XLSX.read(evt.target.result, { type: 'binary' });
      const sheet    = wb.Sheets[wb.SheetNames[0]];
      const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (!rows || rows.length === 0) {
        alert('File Excel trống hoặc không đọc được.');
        return;
      }

      // Tìm cột tên
      let nameCol = 0;
      const header = rows[0];
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || '').toLowerCase();
        if (h.includes('tên') || h.includes('name') || h.includes('họ')) {
          nameCol = i;
          break;
        }
      }

      const names = [];
      for (let i = 1; i < rows.length; i++) {
        const val = rows[i][nameCol];
        if (val) names.push(String(val).trim());
      }

      if (names.length === 0) {
        alert('Không tìm thấy tên học sinh trong file.');
        return;
      }

      const res = await api('POST', `/api/classes/${currentClassId}/students/bulk`, { students: names });
      alert(`Đã thêm thành công ${res.added} học sinh!`);
      // Reload data
      await loadAllData();
      renderCurrentClass();
    } catch (err) {
      if (err.message !== 'Unauthorized') alert('Lỗi: ' + err.message);
    }
  };
  reader.readAsBinaryString(file);
  e.target.value = '';
}

// ─── Auth ─────────────────────────────────────────────────────────────────
async function verifyPassword() {
  const pwd      = document.getElementById('admin-password').value;
  const errorEl  = document.getElementById('password-error');
  errorEl.style.display = 'none';

  if (!pwd) return;

  try {
    const res = await api('POST', '/api/admin/login', { password: pwd });
    setToken(res.token);
    isAdmin = true;
    document.getElementById('password-modal').classList.remove('show');
    updateAdminUI();
    renderClassTabs();
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      errorEl.textContent = err.message || 'Mật khẩu không đúng.';
      errorEl.style.display = 'block';
    }
  }
}

function doLogout() {
  clearToken();
  isAdmin = false;
  isEditingMode = false;
  updateAdminUI();
  renderClassTabs();
  renderCurrentClass();
}

// ─── Admin UI ─────────────────────────────────────────────────────────────
function updateAdminUI() {
  const toggleBtn      = document.getElementById('admin-toggle');
  const editModeToggle = document.getElementById('edit-mode-toggle');

  if (isAdmin) {
    document.body.classList.add('is-admin');
    toggleBtn.classList.add('unlocked');
    toggleBtn.innerHTML = '<i class="fa-solid fa-lock-open"></i>';
    editModeToggle.style.display = 'inline-flex';

    if (isEditingMode) {
      document.body.classList.add('is-editing');
      editModeToggle.innerHTML = '<i class="fa-solid fa-user-gear"></i> Tắt Chỉnh Sửa';
      editModeToggle.style.background = '#ff9800';
      editModeToggle.style.color      = 'white';
    } else {
      document.body.classList.remove('is-editing');
      editModeToggle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Bật Chỉnh Sửa';
      editModeToggle.style.background = 'white';
      editModeToggle.style.color      = '#ff9800';
    }
  } else {
    document.body.classList.remove('is-admin', 'is-editing');
    toggleBtn.classList.remove('unlocked');
    toggleBtn.innerHTML = '<i class="fa-solid fa-lock"></i>';
    editModeToggle.style.display = 'none';
    isEditingMode = false;
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────
async function loadAllData() {
  appData = await api('GET', '/api/classes');
  if (!currentClassId && appData.length > 0) {
    currentClassId = appData[0].id;
  }
  // Kiểm tra xem currentClassId còn hợp lệ không
  if (currentClassId && !appData.find(c => c.id === currentClassId)) {
    currentClassId = appData.length > 0 ? appData[0].id : null;
  }
}

async function loadTitle() {
  try {
    const res = await api('GET', '/api/settings');
    if (res.title) {
      document.getElementById('app-main-title').textContent = res.title;
      localStorage.setItem('classPointsTitle', res.title);
    }
  } catch (_) {}
}

// ─── Event Wiring ─────────────────────────────────────────────────────────
function setupListeners() {
  // Admin toggle
  document.getElementById('admin-toggle').addEventListener('click', () => {
    if (isAdmin) {
      doLogout();
    } else {
      const modal = document.getElementById('password-modal');
      modal.classList.add('show');
      document.getElementById('admin-password').value = '';
      document.getElementById('password-error').style.display = 'none';
      document.getElementById('admin-password').focus();
    }
  });

  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('password-modal').classList.remove('show');
  });

  document.getElementById('submit-password').addEventListener('click', verifyPassword);
  document.getElementById('admin-password').addEventListener('keypress', e => {
    if (e.key === 'Enter') verifyPassword();
  });

  // Session expired OK button
  document.getElementById('session-expired-ok').addEventListener('click', () => {
    document.getElementById('session-expired-modal').classList.remove('show');
  });

  // Edit mode toggle
  document.getElementById('edit-mode-toggle').addEventListener('click', () => {
    if (!isAdmin) return;
    isEditingMode = !isEditingMode;
    updateAdminUI();
    renderCurrentClass();
  });

  // Class actions
  document.getElementById('add-class-btn').addEventListener('click', doAddClass);
  document.getElementById('edit-class-btn').addEventListener('click', doEditClassName);
  document.getElementById('delete-class-btn').addEventListener('click', doDeleteClass);

  // Student actions
  document.getElementById('add-student-btn').addEventListener('click', doAddStudent);
  document.getElementById('excel-upload').addEventListener('change', handleExcelUpload);

  // Title
  document.getElementById('edit-title-btn').addEventListener('click', doEditTitle);

  // Conversion table collapse
  document.getElementById('conversion-header').addEventListener('click', () => {
    document.getElementById('conversion-table').classList.toggle('minimized');
  });

  // Theme Modal
  document.getElementById('theme-btn').addEventListener('click', () => {
    document.getElementById('theme-modal').classList.add('show');
  });
  document.getElementById('close-theme-modal').addEventListener('click', () => {
    document.getElementById('theme-modal').classList.remove('show');
  });
  // Theme options
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      await saveThemeToServer({ theme: opt.dataset.theme });
      applyTheme();
    });
  });
  document.getElementById('toggle-frames').addEventListener('change', async e => {
    await saveThemeToServer({ useFrames: e.target.checked });
    renderCurrentClass();
  });
  document.getElementById('custom-bg-upload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert('Ảnh quá lớn! Vui lòng chọn ảnh nhỏ hơn 3MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async evt => {
      await saveThemeToServer({ customBg: evt.target.result });
      applyTheme();
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('clear-custom-bg').addEventListener('click', async () => {
    await saveThemeToServer({ customBg: null });
    document.getElementById('custom-bg-upload').value = '';
    applyTheme();
  });
}


// ─── Utility ──────────────────────────────────────────────────────────────
function showError(msg) {
  alert('Lỗi: ' + msg);
}

// ─── Init ─────────────────────────────────────────────────────────────────

// Tải settings từ server (title, theme, bg, frames) cho tất cả người dùng
async function loadSettings() {
  try {
    const res = await api('GET', '/api/settings');
    if (res.title)                   document.getElementById('app-main-title').textContent = res.title;
    if (res.theme)                   themeState.name      = res.theme;
    if (res.useFrames !== undefined) themeState.useFrames = res.useFrames;
    if (res.customBg  !== undefined) themeState.customBg  = res.customBg;
    applyTheme();
  } catch (_) {}
}

async function init() {
  // Kiểm tra token còn trong session không
  const token = getToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 > Date.now() && payload.role === 'admin') {
        isAdmin = true;
      } else {
        clearToken();
      }
    } catch (_) {
      clearToken();
    }
  }

  applyTheme();
  setupListeners();
  updateAdminUI();

  try {
    await loadSettings(); // tải title + theme + bg từ server (cho tất cả người dùng)
    await loadAllData();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      showError('Không thể kết nối đến server. Hãy chắc chắn server đang chạy.');
    }
    return;
  }

  renderClassTabs();
  renderCurrentClass();
}

init();

