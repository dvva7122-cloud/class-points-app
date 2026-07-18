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
  if (opts.id) el.id = opts.id;
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

  const eventsContainer = document.getElementById('events-container');

  if (!cls) {
    classInfoEl.style.display = 'none';
    addContainer.style.display = 'none';
    gridEl.innerHTML = '';
    eventsContainer.innerHTML = '';
    const p = createEl('p', { text: 'Chưa có lớp học nào. Hãy tạo một lớp mới!', className: 'empty-msg' });
    p.style.cssText = 'text-align:center;width:100%;color:#888;';
    gridEl.appendChild(p);
    return;
  }

  classInfoEl.style.display = 'flex';
  nameEl.textContent = cls.name;
  
  const gifEl = document.getElementById('current-class-gif');
  if (cls.gifUrl) {
    gifEl.src = cls.gifUrl;
    gifEl.style.display = 'inline-block';
  } else {
    gifEl.src = '';
    gifEl.style.display = 'none';
  }

  gridEl.innerHTML = '';

  if (cls.students.length === 0) {
    const p = createEl('p', { text: 'Lớp này chưa có học sinh.' });
    p.style.cssText = 'text-align:center;width:100%;color:#888;';
    gridEl.appendChild(p);
  } else {
    const maxPts = Math.max(...cls.students.map(s => s.points));
    cls.students.forEach(student => renderStudentCard(student, cls.id, maxPts));
  }
  
  renderSeatingChart(cls);
  renderEvents(cls);
  renderWheel(cls);
}

// ─── Events (Upcoming Events) ─────────────────────────────────────────────
function renderEvents(cls) {
  const container = document.getElementById('events-container');
  container.innerHTML = '';

  const hasEvents = cls.events && cls.events.length > 0;
  
  // Chỉ hiển thị nếu có sự kiện hoặc đang là admin
  if (!hasEvents && !isAdmin) return;

  const section = createEl('div', { className: 'events-section' });
  const header = createEl('div', { className: 'events-header' });
  const title = createEl('h2', { text: '📅 Upcoming Events' });
  header.appendChild(title);

  if (isAdmin) {
    const addBtn = createEl('button', { className: 'add-event-btn admin-only', text: '+ Thêm ảnh' });
    addBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) doAddEvent(cls.id, file);
      };
      input.click();
    });
    header.appendChild(addBtn);
  }

  section.appendChild(header);

  if (hasEvents) {
    const grid = createEl('div', { className: 'events-grid' });
    cls.events.forEach(evt => {
      const card = createEl('div', { className: 'event-card' });
      const img = createEl('img', { className: 'event-img' });
      img.src = evt.imageUrl;
      
      // Click để phóng to (tùy chọn)
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
         const w = window.open();
         w.document.write(`<img src="${evt.imageUrl}" style="max-width:100%; display:block; margin:auto;" />`);
      });

      card.appendChild(img);

      if (isAdmin) {
        const delBtn = createEl('button', { className: 'btn-delete-event admin-only', title: 'Xóa ảnh' });
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        delBtn.addEventListener('click', () => {
          if (confirm('Bạn có chắc chắn muốn xóa sự kiện này?')) {
            doDeleteEvent(cls.id, evt.id);
          }
        });
        card.appendChild(delBtn);
      }
      grid.appendChild(card);
    });
    section.appendChild(grid);
  } else {
    const emptyMsg = createEl('p', { text: 'Chưa có sự kiện nào.', className: 'empty-msg' });
    emptyMsg.style.color = '#888';
    section.appendChild(emptyMsg);
  }

  container.appendChild(section);
  updateAdminUI(); // Đảm bảo ẩn/hiện đúng theo mode
}

async function doAddEvent(classId, file) {
  try {
    // Đọc và nén ảnh bằng canvas
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height *= MAX_WIDTH / width));
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width *= MAX_HEIGHT / height));
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Nén jpeg chất lượng 0.7
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

        try {
          await api('POST', `/api/classes/${classId}/events`, { imageUrl: dataUrl });
          // SSE sẽ tự động cập nhật
        } catch (err) {
          showError(err.message);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } catch (err) {
    showError('Không thể đọc ảnh');
  }
}

async function doDeleteEvent(classId, eventId) {
  try {
    await api('DELETE', `/api/classes/${classId}/events/${eventId}`);
  } catch (err) {
    showError(err.message);
  }
}

function renderStudentCard(student, classId, maxPts) {
  const gridEl   = document.getElementById('student-grid');
  const isTop    = maxPts > 0 && student.points === maxPts;

  const today = new Date();
  const d = String(today.getDate()).padStart(2, '0');
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const todayStr = `${d}/${m}`;
  let isBirthday = false;
  if (student.dob) {
    const dobParts = student.dob.split('/');
    if (dobParts.length >= 2) {
      const dobStr = `${dobParts[0].padStart(2, '0')}/${dobParts[1].padStart(2, '0')}`;
      if (dobStr === todayStr) isBirthday = true;
    }
  }

  const card = createEl('div', {
    className: `student-card ${themeState.useFrames ? 'with-frame' : ''} ${isTop ? 'is-top' : ''} ${isBirthday ? 'is-birthday' : ''}`,
  });
  card.dataset.studentId = student.id;

  // Tầng 0: Nút sửa/xóa lơ lửng
  const absLayer = createEl('div', { className: 'absolute-buttons admin-edit-only' });
  const editBtn = createEl('button', { className: 'action-icon edit-icon', title: 'Đổi tên' });
  editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  editBtn.addEventListener('click', () => doEditStudentName(classId, student.id, student.name));
  
  const delBtn = createEl('button', { className: 'action-icon delete-icon', title: 'Xóa học sinh' });
  delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
  delBtn.addEventListener('click', () => doDeleteStudent(classId, student.id, student.name));
  
  absLayer.appendChild(editBtn);
  absLayer.appendChild(delBtn);
  card.appendChild(absLayer);

  // Tầng 1: Khu vực Biểu tượng
  const iconsContainer = createEl('div', { className: 'icons-container' });
  if (isTop) {
    const crown = createEl('span', { className: 'crown-icon', text: '👑', title: 'Người cao điểm nhất' });
    iconsContainer.appendChild(crown);
  }
  if (isBirthday) {
    const cake = createEl('span', { className: 'birthday-icon', text: '🎂', title: 'Chúc mừng sinh nhật!' });
    iconsContainer.appendChild(cake);
  }
  card.appendChild(iconsContainer);

  // Tầng 2: Tên Học Sinh
  const nameRow = createEl('div', { className: 'student-name-container' });
  const nameEl = createEl('div', { className: 'student-name', text: student.name });
  nameRow.appendChild(nameEl);
  card.appendChild(nameRow);

  // Điểm (click để nhập trực tiếp khi là admin)
  const pointsRow = createEl('div', { className: 'points-display' });
  pointsRow.id = `points-${student.id}`;
  
  const pointVal = createEl('span', { className: 'point-val', text: String(student.points) });
  pointsRow.appendChild(pointVal);
  pointsRow.appendChild(document.createTextNode(' '));
  
  const orangeEmoji = createEl('span', { className: 'orange-emoji', text: '🍊' });
  pointsRow.appendChild(orangeEmoji);

  if (isAdmin) {
    pointsRow.style.cursor = 'pointer';
    pointsRow.title = 'Nhấn để nhập điểm';
    pointsRow.addEventListener('click', (e) => {
      if (document.body.classList.contains('is-editing')) return;
      if (e.target.tagName === 'INPUT') return; 

      const oldPoints = student.points;
      const input = document.createElement('input');
      input.type = 'number';
      input.value = oldPoints;
      input.style.cssText = `
        width: 80px; font-size: 2.5rem; font-weight: 800;
        border: 2px solid #FF9800; border-radius: 10px;
        text-align: center; padding: 2px 6px; color: #F57C00;
        background: #FFF4E3; outline: none;
      `;
      pointsRow.replaceChild(input, pointVal);
      input.focus();
      input.select();

      const applyChange = () => {
        const newVal = parseInt(input.value, 10);
        pointsRow.replaceChild(pointVal, input);
        if (!isNaN(newVal) && newVal !== oldPoints && newVal >= 0) {
          const change = newVal - oldPoints;
          doUpdatePoints(classId, student.id, change);
        }
      };
      input.addEventListener('blur', applyChange);
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { input.value = oldPoints; input.blur(); }
      });
    });
  }

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

// ─── Optimistic points update với Debounce ────────────────────────────────
// Lưu thay đổi điểm đang chờ gửi (chưa sync với server)
const pendingPointsChange = {}; // { studentId: { classId, change, timer } }

function doUpdatePoints(classId, studentId, change) {
  const cls     = appData.find(c => c.id === classId);
  const student = cls && cls.students.find(s => s.id === studentId);
  if (!student) return;

  // 1. Cập nhật state local & DOM ngay lập tức (không chờ server)
  student.points = Math.max(0, student.points + change);
  const display = document.getElementById(`points-${studentId}`);
  if (display) {
    display.querySelector('.point-val').textContent = student.points;
    display.classList.remove('pop');
    void display.offsetWidth;
    display.classList.add('pop');
  }

  // 2. Gom thay đổi vào hàng chờ
  if (!pendingPointsChange[studentId]) {
    pendingPointsChange[studentId] = { classId, accumulated: 0, timer: null };
  }
  pendingPointsChange[studentId].accumulated += change;

  // 3. Debounce: hủy timer cũ, đặt timer mới 800ms
  clearTimeout(pendingPointsChange[studentId].timer);
  pendingPointsChange[studentId].timer = setTimeout(async () => {
    const pending = pendingPointsChange[studentId];
    if (!pending || pending.accumulated === 0) return;

    const totalChange = pending.accumulated;
    delete pendingPointsChange[studentId]; // xóa khỏi hàng chờ

    try {
      const res = await api('PATCH', `/api/classes/${classId}/students/${studentId}/points`, { change: totalChange });
      // Đồng bộ lại điểm chính xác từ server (phòng trường hợp lệch)
      const s = cls && cls.students.find(s => s.id === studentId);
      if (s && res.points !== s.points) {
        s.points = res.points;
        const d = document.getElementById(`points-${studentId}`);
        if (d) d.querySelector('.point-val').textContent = res.points;
      }
      // Cập nhật crown
      renderCurrentClass();
    } catch (err) {
      if (err.message !== 'Unauthorized') showError(err.message);
      // Rollback điểm về giá trị server nếu thất bại
      await loadAllData();
      renderCurrentClass();
    }
  }, 800);
}



// ─── Custom Modal System ──────────────────────────────────────────────────
function showCustomPrompt(title, fields) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-prompt-modal');
    if (!modal) {
      // Fallback nếu không tìm thấy modal
      const res = {};
      for (const field of fields) {
        const val = prompt(field.label, field.value || '');
        if (val === null) return resolve(null);
        res[field.key] = val;
      }
      return resolve(res);
    }
    
    document.getElementById('custom-prompt-title').textContent = title;
    const body = document.getElementById('custom-prompt-body');
    body.innerHTML = '';
    
    const inputs = [];
    fields.forEach(field => {
      const group = createEl('div', { className: 'prompt-input-group' });
      const label = createEl('label', { text: field.label });
      const input = createEl('input', { type: field.type || 'text' });
      if (field.value) input.value = field.value;
      if (field.placeholder) input.placeholder = field.placeholder;
      
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
      });

      group.appendChild(label);
      group.appendChild(input);
      body.appendChild(group);
      inputs.push({ key: field.key, el: input });
    });

    const cancelBtn = document.getElementById('custom-prompt-cancel');
    const submitBtn = document.getElementById('custom-prompt-submit');
    
    const cleanup = () => {
      cancelBtn.onclick = null;
      submitBtn.onclick = null;
      modal.classList.remove('show');
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    submitBtn.onclick = () => {
      const result = {};
      inputs.forEach(i => result[i.key] = i.el.value.trim());
      cleanup();
      resolve(result);
    };

    modal.classList.add('show');
    if (inputs.length > 0) inputs[0].el.focus();
  });
}

async function doEditStudentName(classId, studentId, currentName) {
  const cls = appData.find(c => c.id === classId);
  const student = cls && cls.students.find(s => s.id === studentId);
  
  const res = await showCustomPrompt('Sửa thông tin học sinh', [
    { key: 'name', label: 'Tên học sinh', value: student ? student.name : currentName },
    { key: 'dob', label: 'Ngày sinh (Ví dụ: 15/08)', value: student ? (student.dob || '') : '', placeholder: 'DD/MM hoặc DD/MM/YYYY' }
  ]);
  if (!res || !res.name) return;
  
  try {
    const patchRes = await api('PATCH', `/api/classes/${classId}/students/${studentId}`, { name: res.name, dob: res.dob });
    if (student) {
      student.name = patchRes.name;
      student.dob = patchRes.dob;
    }
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
    if (cls) {
      cls.students = cls.students.filter(s => s.id !== studentId);
    }
    if (wheelCurrentClassId === classId) {
      wheelActiveStudents = wheelActiveStudents.filter(s => s.id !== studentId);
    }
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doAddStudent() {
  const res = await showCustomPrompt('Thêm học sinh mới', [
    { key: 'name', label: 'Tên học sinh' },
    { key: 'dob', label: 'Ngày sinh (Ví dụ: 15/08)', placeholder: 'Để trống nếu không rõ' }
  ]);
  if (!res || !res.name) return;

  try {
    const newStudent = await api('POST', `/api/classes/${currentClassId}/students`, { name: res.name, dob: res.dob });
    const cls  = appData.find(c => c.id === currentClassId);
    if (cls) cls.students.push(newStudent);
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doEditClassName() {
  const cls = getCurrentClass();
  if (!cls) return;
  const res = await showCustomPrompt('Sửa tên lớp', [
    { key: 'name', label: 'Tên lớp', value: cls.name }
  ]);
  if (!res || !res.name) return;
  try {
    const patchRes = await api('PATCH', `/api/classes/${currentClassId}`, { name: res.name });
    cls.name = patchRes.name;
    renderClassTabs();
    document.getElementById('current-class-name').textContent = patchRes.name;
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doEditClassGif() {
  const cls = getCurrentClass();
  if (!cls) return;
  const res = await showCustomPrompt('Trang trí lớp học', [
    { key: 'url', label: 'Link ảnh GIF (để trống nếu muốn xóa)', value: cls.gifUrl || '' }
  ]);
  if (!res) return; // Cancel
  try {
    const patchRes = await api('PATCH', `/api/classes/${currentClassId}`, { gifUrl: res.url });
    cls.gifUrl = patchRes.gifUrl;
    renderCurrentClass();
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
  const res = await showCustomPrompt('Thêm lớp mới', [
    { key: 'name', label: 'Tên lớp' }
  ]);
  if (!res || !res.name) return;
  try {
    const newClass = await api('POST', '/api/classes', { name: res.name });
    appData.push(newClass);
    currentClassId = newClass.id;
    renderClassTabs();
    renderCurrentClass();
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

async function doEditTitle() {
  const current = document.getElementById('app-main-title').textContent;
  const res = await showCustomPrompt('Đổi Tiêu Đề', [
    { key: 'title', label: 'Tiêu đề trang web', value: current }
  ]);
  if (!res || !res.title) return;
  try {
    const patchRes = await api('PATCH', '/api/settings', { title: res.title });
    document.getElementById('app-main-title').textContent = patchRes.title;
    localStorage.setItem('classPointsTitle', patchRes.title);
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

      // Tìm cột tên và cột ngày sinh
      let nameCol = 0;
      let dobCol = -1;
      const header = rows[0];
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || '').toLowerCase();
        if (h.includes('tên') || h.includes('name') || h.includes('họ')) {
          nameCol = i;
        }
        if (h.includes('sinh') || h.includes('dob') || h.includes('birthday')) {
          dobCol = i;
        }
      }

      const studentsToImport = [];
      for (let i = 1; i < rows.length; i++) {
        const val = rows[i][nameCol];
        if (val) {
          const studentObj = { name: String(val).trim() };
          if (dobCol !== -1 && rows[i][dobCol]) {
            studentObj.dob = String(rows[i][dobCol]).trim();
          }
          studentsToImport.push(studentObj);
        }
      }

      if (studentsToImport.length === 0) {
        alert('Không tìm thấy tên học sinh trong file.');
        return;
      }

      const res = await api('POST', `/api/classes/${currentClassId}/students/bulk`, { students: studentsToImport });
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
  document.getElementById('edit-class-gif-btn').addEventListener('click', doEditClassGif);
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

// ─── Lắng nghe sự kiện Real-time (SSE) ───────────────────────────────────
let isRealtimeSetup = false;
function setupRealtime() {
  if (isRealtimeSetup) return;
  isRealtimeSetup = true;
  
  const evtSource = new EventSource('/api/events');
  evtSource.onmessage = async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'DATA_CHANGED') {
        await loadAllData();
        renderClassTabs();
        renderCurrentClass();
      } else if (data.type === 'SETTINGS_CHANGED') {
        await loadSettings();
      }
    } catch (err) {}
  };
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
    await loadSettings(); // tải title + theme + bg từ server
    await loadAllData();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      // Server đang khởi động (Cold Start Render) -> Không hiển thị alert gây khó chịu
      const gridEl = document.getElementById('student-grid');
      if (gridEl) {
        gridEl.innerHTML = `
          <div style="text-align: center; width: 100%; grid-column: 1 / -1; padding: 40px; color: #F57C00;">
            <i class="fa-solid fa-spinner fa-spin fa-3x" style="margin-bottom: 16px;"></i>
            <h3 style="margin-bottom: 8px;">Đang kết nối đến máy chủ...</h3>
            <p style="color: #6B7280; font-size: 0.95rem;">Máy chủ miễn phí cần khoảng 30-50 giây để khởi động lại nếu không có ai truy cập trong 15 phút. Vui lòng đợi...</p>
          </div>
        `;
      }
      // Tự động thử lại sau 3 giây
      setTimeout(init, 3000);
      return;
    }
  }

  renderClassTabs();
  renderCurrentClass();
  setupRealtime();
  startClock();
}

function startClock() {
  const clockText = document.getElementById('clock-text');
  if (!clockText) return;
  
  function update() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    clockText.textContent = `${hh}:${mm} - ${dd}/${mo}/${yyyy}`;
  }
  
  update();
  setInterval(update, 1000); // Cập nhật mỗi giây để sang phút mới là hiển thị ngay
}

init();


// ═══════════════════════════════════════════════════════════════════════════
//  WHEEL OF NAMES (VÒNG QUAY MAY MẮN)
// ═══════════════════════════════════════════════════════════════════════════

let wheelActiveStudents = [];
let pendingWinners = [];
let wheelCurrentClassId = null;
let wheelRotationAngle = 0;
let wheelIsSpinning = false;

const wheelColors = [
  '#FF8A8A', '#FFB38A', '#FFF38A', '#B3FF8A',
  '#8AFFB3', '#8AFFF3', '#8AB3FF', '#B38AFF',
  '#FF8AFF', '#FF8AB3'
];

function renderWheel(cls) {
  const container = document.getElementById('wheel-container');
  if (!container) return;

  // Chỉ admin mới được dùng vòng quay
  if (!isAdmin) {
    container.innerHTML = '';
    return;
  }

  // Nếu lớp không có học sinh, ẩn vòng quay đi
  if (!cls || !cls.students || cls.students.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Reset danh sách học sinh của vòng quay khi chuyển lớp
  if (wheelCurrentClassId !== cls.id) {
    wheelCurrentClassId = cls.id;
    wheelActiveStudents = [...cls.students];
    pendingWinners = [];
    wheelRotationAngle = 0;
    wheelIsSpinning = false;
  }

  // Nếu đang quay, không vẽ lại giao diện HTML để tránh giật lag hoặc gián đoạn
  if (wheelIsSpinning) return;

  container.innerHTML = '';

  const section = createEl('div', { className: 'wheel-section' });
  const header = createEl('div', { className: 'wheel-header' });
  const title = createEl('h2', { text: '🎡 Wheel of Names 🎡' }); // Bỏ tiếng Việt và dấu ngoặc đơn
  header.appendChild(title);
  section.appendChild(header);

  const body = createEl('div', { className: 'wheel-body' });

  // Vòng quay canvas (làm to ra 450px)
  const canvasContainer = createEl('div', { className: 'wheel-canvas-container' });
  const canvas = createEl('canvas', { id: 'wheel-canvas' });
  canvas.width = 900;
  canvas.height = 900;
  canvas.style.width = '450px';
  canvas.style.height = '450px';
  
  canvasContainer.appendChild(canvas);
  canvasContainer.appendChild(createEl('div', { className: 'wheel-pointer' }));
  body.appendChild(canvasContainer);

  // Bộ điều khiển nằm bên dưới vòng quay
  const buttonsRow = createEl('div', { className: 'wheel-buttons' });
  
  const shuffleBtn = createEl('button', { id: 'wheel-btn-shuffle', className: 'wheel-btn wheel-btn-shuffle' });
  shuffleBtn.innerHTML = '<i class="fa-solid fa-random"></i> Shuffle';
  shuffleBtn.addEventListener('click', () => {
    if (wheelIsSpinning) return;
    shuffleWheel();
  });
  
  const resetBtn = createEl('button', { id: 'wheel-btn-reset', className: 'wheel-btn wheel-btn-reset' });
  resetBtn.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> Reset';
  resetBtn.addEventListener('click', () => {
    if (wheelIsSpinning) return;
    resetWheel(cls);
  });
  
  buttonsRow.appendChild(shuffleBtn);
  buttonsRow.appendChild(resetBtn);

  // Vùng chính
  const mainCol = createEl('div', { className: 'wheel-main-col' });
  mainCol.appendChild(canvasContainer);
  mainCol.appendChild(buttonsRow);
  body.appendChild(mainCol);

  // Vùng sidebar (pending)
  const sidebar = createEl('div', { className: 'wheel-sidebar' });
  const sidebarTitle = createEl('h3', { text: '🎯 Khu vực nhiệm vụ' });
  const pendingList = createEl('div', { id: 'pending-winners-list' });
  sidebar.appendChild(sidebarTitle);
  sidebar.appendChild(pendingList);
  body.appendChild(sidebar);

  section.appendChild(body);
  container.appendChild(section);

  // Gán sự kiện click quay
  canvas.addEventListener('click', () => {
    if (wheelIsSpinning || wheelActiveStudents.length === 0) return;
    spinWheel(cls);
  });

  // Truyền trực tiếp element canvas vừa tạo vào để vẽ ngay lập tức, khắc phục lỗi canvas trắng
  drawWheel(canvas);
  
  // Vẽ danh sách chờ
  renderPendingWinners(cls);
}

function renderPendingWinners(cls) {
  const container = document.getElementById('pending-winners-list');
  if (!container) return;
  container.innerHTML = '';

  if (pendingWinners.length === 0) {
    const emptyMsg = createEl('div', { text: 'Chưa có ai.', className: 'empty-msg' });
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = '#94A3B8';
    emptyMsg.style.fontSize = '0.95rem';
    emptyMsg.style.marginTop = '10px';
    container.appendChild(emptyMsg);
    return;
  }

  pendingWinners.forEach((winner, index) => {
    const card = createEl('div', { className: 'pending-winner-card' });
    const nameEl = createEl('div', { className: 'pending-name', text: winner.name });
    card.appendChild(nameEl);

    const actions = createEl('div', { className: 'pending-actions' });
    
    // Nút Hủy (0)
    const btnCancel = createEl('button', { className: 'pending-btn zero', text: 'Không làm gì' });
    btnCancel.onclick = () => {
      pendingWinners.splice(index, 1);
      renderPendingWinners(cls);
    };
    actions.appendChild(btnCancel);

    // Các nút cộng 1 đến 5
    for (let i = 1; i <= 5; i++) {
      const btn = createEl('button', { className: 'pending-btn', text: '+' + i });
      btn.onclick = async () => {
        try {
          await doUpdatePoints(cls.id, winner.id, i);
          pendingWinners.splice(index, 1);
          renderPendingWinners(cls);
        } catch (err) {
          showError('Không thể cộng điểm: ' + err.message);
        }
      };
      actions.appendChild(btn);
    }

    card.appendChild(actions);
    container.appendChild(card);
  });
}

function drawWheel(canvasEl) {
  const canvas = canvasEl || document.getElementById('wheel-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 30; // Chừa lề vẽ cho đẹp

  ctx.clearRect(0, 0, size, size);

  if (wheelActiveStudents.length === 0) {
    // Vẽ vòng quay trống
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#F8FAFC';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#E2E8F0';
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Vòng quay trống. Ấn Reset!', center, center);
    return;
  }

  const sliceAngle = (2 * Math.PI) / wheelActiveStudents.length;

  for (let i = 0; i < wheelActiveStudents.length; i++) {
    const startAngle = i * sliceAngle + wheelRotationAngle;
    const endAngle = startAngle + sliceAngle;

    // Vẽ lát cắt màu
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, startAngle, endAngle);
    ctx.fillStyle = wheelColors[i % wheelColors.length];
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    // Vẽ tên học sinh
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(startAngle + sliceAngle / 2);
    
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold 30px Inter, sans-serif'; // Tăng font size do canvas to lên 900px
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    // Cắt tên nếu quá dài để không bị đè lên tâm
    let displayName = wheelActiveStudents[i].name;
    if (displayName.length > 15) displayName = displayName.substring(0, 13) + '...';
    
    ctx.fillText(displayName, radius - 45, 0);
    ctx.restore();
  }

  // Vẽ vòng tròn trung tâm (nút SPIN)
  ctx.beginPath();
  ctx.arc(center, center, 85, 0, 2 * Math.PI);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#FF9800';
  ctx.stroke();

  // Chữ SPIN ở tâm
  ctx.fillStyle = '#F57C00';
  ctx.font = '900 36px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SPIN', center, center);
}
function shuffleWheel() {
  // Fisher-Yates shuffle xáo trộn ngẫu nhiên
  for (let i = wheelActiveStudents.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wheelActiveStudents[i], wheelActiveStudents[j]] = [wheelActiveStudents[j], wheelActiveStudents[i]];
  }
  drawWheel();
}

function resetWheel(cls) {
  wheelActiveStudents = [...cls.students];
  drawWheel();
}

function spinWheel(cls) {
  if (wheelIsSpinning || wheelActiveStudents.length === 0) return;
  wheelIsSpinning = true;

  const n = wheelActiveStudents.length;
  const sliceAngle = (2 * Math.PI) / n;

  // 1. Chọn ngẫu nhiên người thắng trước
  const winnerIndex = Math.floor(Math.random() * n);

  // 2. Tính góc dừng sao cho giữa ô người thắng CĂN ĐÚNG mũi tên bên phải (góc 0 / 2π)
  //    Tâm của slice winnerIndex phải nằm tại góc 0 (mũi tên bên phải).
  //    Tâm slice = winnerIndex * sliceAngle + sliceAngle/2 + wheelRotationAngle ≡ 0 (mod 2π)
  //    => wheelRotationAngle = -(winnerIndex * sliceAngle + sliceAngle/2) (mod 2π)
  const targetOffset = (-(winnerIndex * sliceAngle + sliceAngle / 2)) % (2 * Math.PI);
  const normalizedTarget = ((targetOffset % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // 3. Tổng số góc quay = nhiều vòng đầy (chiều kim đồng hồ = âm, nhưng canvas tăng dương = CKĐ)
  //    Ta dùng góc tăng dần (CKĐ). Quay thêm ít nhất 8 vòng từ vị trí hiện tại.
  const currentAngle = ((wheelRotationAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let delta = normalizedTarget - currentAngle;
  if (delta <= 0) delta += 2 * Math.PI; // Đảm bảo luôn quay về phía trước (CKĐ)
  const fullSpins = Math.floor(Math.random() * 4 + 6) * 2 * Math.PI; // 6–9 vòng ngẫu nhiên
  const totalSpin = fullSpins + delta;

  const startAngle = wheelRotationAngle;
  const targetAngle = startAngle + totalSpin;
  const duration = 4500;
  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease-out quintic — chậm dần thật tự nhiên
    const eased = 1 - Math.pow(1 - progress, 5);
    wheelRotationAngle = startAngle + totalSpin * eased;

    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      wheelIsSpinning = false;
      const winner = wheelActiveStudents[winnerIndex];
      showWinnerModal(winner, cls);
    }
  }

  requestAnimationFrame(animate);
}

function showWinnerModal(winner, cls) {
  const modal = document.getElementById('wheel-winner-modal');
  const nameEl = document.getElementById('wheel-winner-name');
  if (!modal || !nameEl) return;

  nameEl.textContent = winner.name;
  modal.classList.add('show');

  // Khởi động pháo hoa giấy chúc mừng
  startConfetti();

  const closeBtn = document.getElementById('winner-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.classList.remove('show');
      stopConfetti();

      // Xóa học sinh khỏi vòng quay trong lượt chơi này
      wheelActiveStudents = wheelActiveStudents.filter(s => s.id !== winner.id);
      
      // Đẩy học sinh vào danh sách chờ
      pendingWinners.push(winner);
      
      // Vẽ lại giao diện vòng quay & danh sách chờ
      drawWheel(); // chỉ cần vẽ lại canvas, không cần render lại toàn bộ section
      renderPendingWinners(cls);
    };
  }
}

function startConfetti() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  container.innerHTML = '';
  
  const colors = ['#FF4565', '#35B978', '#FF9800', '#2B6CB0', '#805AD5', '#ECC94B', '#06B6D4', '#F97316'];
  const shapes = ['circle', 'rect'];
  
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    const isCircle = Math.random() > 0.5;
    el.style.left = Math.random() * 100 + '%';
    el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    el.style.width = Math.random() * 8 + 5 + 'px';
    el.style.height = isCircle ? el.style.width : (Math.random() * 5 + 4 + 'px');
    el.style.borderRadius = isCircle ? '50%' : '2px';
    el.style.animationDelay = (Math.random() * 0.05) + 's'; // Gần như không delay
    el.style.animationDuration = Math.random() * 1.2 + 0.8 + 's'; // Nhanh hơn
    container.appendChild(el);
  }
}

function stopConfetti() {
  const container = document.getElementById('confetti-container');
  if (container) container.innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEATING CHART (SƠ ĐỒ LỚP HỌC)
// ═══════════════════════════════════════════════════════════════════════════

let isEditingSeatingChart = false;
let currentChartData = null;

function getInitials(name) {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getColorForName(name) {
  const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function addDesk(seatCount) {
  const newDesk = {
    id: 'desk_' + Date.now(),
    type: 'student',
    x: 50,
    y: 150,
    seats: Array(seatCount).fill(null).map(() => ({ studentId: null }))
  };
  currentChartData.desks.push(newDesk);
  renderSeatingChart(getCurrentClass());
}

function renderSeatingChart(cls) {
  const container = document.getElementById('seating-chart-container');
  if (!container) return;

  if (!cls) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  // Khởi tạo data mặc định nếu chưa có
  if (!cls.seatingChart) {
    cls.seatingChart = {
      desks: [
        { id: 'desk_teacher', type: 'teacher', label: 'Th. Việt Anh', x: 280, y: 100, seats: [] }
      ]
    };
  }

  if (!isEditingSeatingChart) {
    currentChartData = JSON.parse(JSON.stringify(cls.seatingChart));
  }

  container.innerHTML = '';

  // --- Header ---
  const header = createEl('div', { className: 'seating-chart-header' });
  const title = createEl('h3', { text: '🗺️ Sơ đồ lớp học' });
  header.appendChild(title);

  const controls = createEl('div', { className: 'seating-chart-controls' });

  if (isAdmin) {
    if (!isEditingSeatingChart) {
      const editBtn = createEl('button', { className: 'seating-btn' });
      editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Chỉnh sửa sơ đồ';
      editBtn.onclick = () => {
        isEditingSeatingChart = true;
        renderSeatingChart(cls);
      };
      controls.appendChild(editBtn);
    } else {
      const addDesk2Btn = createEl('button', { className: 'seating-btn' });
      addDesk2Btn.innerHTML = '+ Bàn 2 chỗ';
      addDesk2Btn.onclick = () => addDesk(2);

      const addDesk4Btn = createEl('button', { className: 'seating-btn' });
      addDesk4Btn.innerHTML = '+ Bàn 4 chỗ';
      addDesk4Btn.onclick = () => addDesk(4);

      const cancelBtn = createEl('button', { className: 'seating-btn' });
      cancelBtn.innerHTML = 'Hủy';
      cancelBtn.onclick = () => {
        isEditingSeatingChart = false;
        renderSeatingChart(cls);
      };

      const saveBtn = createEl('button', { className: 'seating-btn primary' });
      saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Lưu Sơ Đồ';
      saveBtn.onclick = async () => {
        try {
          const res = await api('PATCH', `/api/classes/${cls.id}`, { seatingChart: currentChartData });
          cls.seatingChart = res.seatingChart;
          isEditingSeatingChart = false;
          renderSeatingChart(cls);
        } catch (err) {
          showError('Lỗi lưu sơ đồ: ' + err.message);
        }
      };

      controls.appendChild(addDesk2Btn);
      controls.appendChild(addDesk4Btn);
      controls.appendChild(cancelBtn);
      controls.appendChild(saveBtn);
    }
  }

  header.appendChild(controls);
  container.appendChild(header);

  const layoutWrapper = createEl('div', { className: 'seating-layout-wrapper' });

  // --- Panel học sinh chưa xếp chỗ ---
  const panel = createEl('div', { className: 'unassigned-students-panel' + (isEditingSeatingChart ? ' active' : '') });
  const panelTitle = createEl('h4', { text: 'Học sinh chưa xếp chỗ' });
  panel.appendChild(panelTitle);

  const assignedStudentIds = new Set();
  currentChartData.desks.forEach(d => {
    d.seats.forEach(s => { if (s.studentId) assignedStudentIds.add(s.studentId); });
  });

  const unassignedStudents = cls.students.filter(s => !assignedStudentIds.has(s.id));

  if (unassignedStudents.length === 0) {
    const p = createEl('p', { text: 'Tất cả đã có chỗ.' });
    p.style.fontSize = '0.85rem';
    panel.appendChild(p);
  } else {
    unassignedStudents.forEach(s => {
      const item = createEl('div', { className: 'unassigned-student-item' });
      item.draggable = true;
      item.dataset.studentId = s.id;

      const avatar = createEl('div', { className: 'avatar' });
      avatar.textContent = getInitials(s.name);
      avatar.style.background = getColorForName(s.name);
      item.appendChild(avatar);
      item.appendChild(document.createTextNode(s.name));

      item.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', s.id);
        e.dataTransfer.setData('source', 'panel');
      };
      panel.appendChild(item);
    });
  }

  panel.ondragover = (e) => e.preventDefault();
  panel.ondrop = (e) => {
    e.preventDefault();
    if (!isEditingSeatingChart) return;
    const studentId = e.dataTransfer.getData('text/plain');
    if (!studentId) return;
    currentChartData.desks.forEach(d => {
      d.seats.forEach(seat => { if (seat.studentId === studentId) seat.studentId = null; });
    });
    renderSeatingChart(cls);
  };

  layoutWrapper.appendChild(panel);

  // --- Classroom Canvas ---
  const canvas = createEl('div', { className: 'classroom-canvas' });

  // Bảng đen
  const blackboard = createEl('div', { className: 'blackboard' });
  blackboard.textContent = 'BẢNG VIẾT';
  canvas.appendChild(blackboard);

  // Trang trí phòng học
  const decorItems = [
    { emoji: '🌿', style: 'bottom:16px; left:16px; font-size:2.4rem;' },
    { emoji: '🌿', style: 'bottom:16px; right:16px; font-size:2.4rem;' },
    { emoji: '🚪', style: 'bottom:0; right:24px; font-size:3rem; line-height:1;' },
    { emoji: '🖥️', style: 'top:110px; left:16px; font-size:1.6rem; opacity:0.5;' },
  ];
  decorItems.forEach(d => {
    const el = createEl('div', { className: 'classroom-decor' });
    el.textContent = d.emoji;
    el.style.cssText += d.style;
    canvas.appendChild(el);
  });

  currentChartData.desks.forEach(desk => {
    const seatCount = desk.seats ? desk.seats.length : 0;
    const deskClass = desk.type === 'teacher'
      ? 'desk desk-teacher'
      : `desk desk-${seatCount === 4 ? '4' : '2'}`;
    const deskEl = createEl('div', { className: deskClass + (isEditingSeatingChart ? ' draggable' : '') });
    deskEl.style.left = desk.x + 'px';
    deskEl.style.top = desk.y + 'px';

    if (desk.type === 'teacher') {
      const label = createEl('span');
      label.textContent = desk.label || 'Th. Việt Anh';
      deskEl.appendChild(label);
    } else {
      const is4 = seatCount === 4;
      const seatsContainer = createEl('div', { className: 'desk-seats-container' + (is4 ? ' grid-2x2' : '') });
      desk.seats.forEach((seat, index) => {
        const seatEl = createEl('div', { className: 'seat' });

        if (seat.studentId) {
          const student = cls.students.find(s => s.id === seat.studentId);
          if (student) {
            seatEl.classList.add('occupied');
            seatEl.title = student.name;
            const av = createEl('div', { className: 'seat-avatar' });
            av.textContent = getInitials(student.name);
            av.style.background = getColorForName(student.name);
            seatEl.appendChild(av);
            seatEl.appendChild(document.createTextNode(student.name.split(' ').pop()));

            if (isEditingSeatingChart) {
              seatEl.draggable = true;
              seatEl.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', student.id);
                e.dataTransfer.setData('source', 'seat');
                e.dataTransfer.setData('sourceDeskId', desk.id);
                e.dataTransfer.setData('sourceSeatIndex', String(index));
              };
            }
          } else {
            seat.studentId = null;
            seatEl.textContent = 'Trống';
          }
        } else {
          seatEl.textContent = 'Trống';
        }

        if (isEditingSeatingChart) {
          seatEl.ondragover = (e) => { e.preventDefault(); seatEl.classList.add('drag-over'); };
          seatEl.ondragleave = () => seatEl.classList.remove('drag-over');
          seatEl.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            seatEl.classList.remove('drag-over');
            const studentId = e.dataTransfer.getData('text/plain');
            if (!studentId) return;

            const existingStudentId = seat.studentId;

            // Xóa người mới khỏi chỗ cũ
            currentChartData.desks.forEach(d => {
              d.seats.forEach(s => { if (s.studentId === studentId) s.studentId = null; });
            });

            // Nếu swap thì đặt người cũ vào chỗ mới
            if (existingStudentId && e.dataTransfer.getData('source') === 'seat') {
              const srcDeskId = e.dataTransfer.getData('sourceDeskId');
              const srcIdx = parseInt(e.dataTransfer.getData('sourceSeatIndex'), 10);
              const srcDesk = currentChartData.desks.find(d => d.id === srcDeskId);
              if (srcDesk) srcDesk.seats[srcIdx].studentId = existingStudentId;
            }

            seat.studentId = studentId;
            renderSeatingChart(cls);
          };
        }

        seatsContainer.appendChild(seatEl);
      });
      deskEl.appendChild(seatsContainer);
    }

    if (isEditingSeatingChart) {
      // Nút xóa bàn
      if (desk.type !== 'teacher') {
        const delBtn = createEl('div', { className: 'delete-desk-btn' });
        delBtn.innerHTML = '&times;';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          currentChartData.desks = currentChartData.desks.filter(d => d.id !== desk.id);
          renderSeatingChart(cls);
        };
        deskEl.appendChild(delBtn);
      }

      // Kéo bàn bằng mouse
      let draggingDesk = false;
      let startX, startY, initX, initY;

      deskEl.onmousedown = (e) => {
        if (e.target.closest('.seat') || e.target.closest('.delete-desk-btn')) return;
        draggingDesk = true;
        startX = e.clientX;
        startY = e.clientY;
        initX = desk.x;
        initY = desk.y;

        const onMove = (me) => {
          if (!draggingDesk) return;
          desk.x = Math.max(0, initX + me.clientX - startX);
          desk.y = Math.max(0, initY + me.clientY - startY);
          deskEl.style.left = desk.x + 'px';
          deskEl.style.top = desk.y + 'px';
        };
        const onUp = () => {
          draggingDesk = false;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };
    }

    canvas.appendChild(deskEl);
  });

  layoutWrapper.appendChild(canvas);
  container.appendChild(layoutWrapper);
}
