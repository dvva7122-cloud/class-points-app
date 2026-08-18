'use strict';

// ─── State ────────────────────────────────────────────────────────────────
let appData        = [];       // [{id, name, students:[{id, name, points}]}]
let currentClassId = null;
let isAdmin        = false;
let isEditingMode  = false;

async function doStudentPrivatePopup(classId, student) {
  const res = await showCustomPrompt(`Khóa bảo mật: ${student.name}`, [
    { key: 'password', label: 'Nhập mật khẩu (Mã HS + Ngày sinh)', type: 'password' }
  ]);
  if (!res || !res.password) return;

  try {
    const verifyRes = await api('POST', `/api/classes/${classId}/students/${student.id}/verify-password`, { password: res.password });
    if (verifyRes.success) {
      const modal = document.getElementById('student-popup-modal');
      const body  = document.getElementById('student-popup-body');
      const grades = verifyRes.grades;
      const points = verifyRes.points;

      renderGradeReport(body, student, grades, points, classId);

      modal.classList.add('show');
      document.getElementById('student-popup-close').onclick = () => modal.classList.remove('show');
    }
  } catch (err) {
    showError(err.message);
  }
}

// Tính trung bình học kỳ: (Tổng HS1 + HS2×2 + HS3×3) / (n + 2 + 3)
function calcSemesterAvg(sem) {
  if (!sem) return null;
  const hs1Scores = (sem.hs1 || []).filter(v => v !== null && v !== undefined);
  const hs2 = sem.hs2;
  const hs3 = sem.hs3;
  if (hs1Scores.length === 0 && hs2 === null && hs3 === null) return null;

  let totalWeight = 0, totalScore = 0;
  hs1Scores.forEach(v => { totalScore += v * 1; totalWeight += 1; });
  if (hs2 !== null && hs2 !== undefined) { totalScore += hs2 * 2; totalWeight += 2; }
  if (hs3 !== null && hs3 !== undefined) { totalScore += hs3 * 3; totalWeight += 3; }
  if (totalWeight === 0) return null;
  return Math.round((totalScore / totalWeight) * 100) / 100;
}

function renderGradeReport(container, student, grades, points, classId) {
  container.innerHTML = `
    <div style="width: 100%; display: flex; justify-content: center;">
      <div class="grade-report-title-wrap">
          <h3>BẢNG ĐIỂM HỌC SINH</h3>
          <div class="dots-under">
             <span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span>
          </div>
      </div>
    </div>
  `;

  // Admin toolbar (nếu đang là admin)
  if (isAdmin) {
    const toolbar = document.createElement('div');
    toolbar.className = 'grade-admin-toolbar';

    const importBtn = document.createElement('button');
    importBtn.className = 'btn-grade-action btn-import-excel';
    importBtn.innerHTML = '<i class="fa-solid fa-file-excel"></i> Import điểm từ Excel';
    importBtn.onclick = () => doImportGradesExcel(classId);
    toolbar.appendChild(importBtn);

    const templateBtn = document.createElement('button');
    templateBtn.className = 'btn-grade-action btn-download-template';
    templateBtn.innerHTML = '<i class="fa-solid fa-download"></i> Tải file mẫu điểm';
    templateBtn.onclick = () => doDownloadGradeTemplate(classId);
    toolbar.appendChild(templateBtn);

    container.appendChild(toolbar);
  }

  const report = document.createElement('div');
  report.className = 'grade-report';

  // Tính trước trung bình năm học để hiển thị bên trái
  const hk1Data = grades && grades.hk1 ? grades.hk1 : null;
  const hk2Data = grades && grades.hk2 ? grades.hk2 : null;
  const avgHk1 = calcSemesterAvg(hk1Data);
  const avgHk2 = calcSemesterAvg(hk2Data);
  let yearlyAvg = null;
  if (avgHk1 !== null && avgHk2 !== null) {
      yearlyAvg = Math.round(((avgHk1 + avgHk2 * 2) / 3) * 100) / 100;
  } else if (avgHk2 !== null) {
      yearlyAvg = avgHk2;
  } else if (avgHk1 !== null) {
      yearlyAvg = avgHk1;
  }

  // === LEFT: Thông tin học sinh ===
  const left = document.createElement('div');
  left.className = 'grade-report-left';

  const nameEl = document.createElement('div');
  nameEl.className = 'grade-report-name';
  nameEl.textContent = student.name;
  left.appendChild(nameEl);

  const pointsEl = document.createElement('div');
  pointsEl.className = 'grade-report-points-simple';
  pointsEl.innerHTML = `<span class="pts-val">${points}</span><span class="pts-emoji">🍊</span>`;
  left.appendChild(pointsEl);

  const yearlyBox = document.createElement('div');
  yearlyBox.className = 'yearly-box-compact';
  yearlyBox.innerHTML = `
    <div class="yearly-trophy"><i class="fa-solid fa-trophy"></i></div>
    <div class="yearly-title">TRUNG BÌNH NĂM</div>
    <div class="yearly-score">${yearlyAvg !== null ? yearlyAvg.toFixed(2) : '—'}</div>
  `;
  left.appendChild(yearlyBox);

  report.appendChild(left);

  // === RIGHT/MIDDLE: Bảng điểm 2 học kỳ ===
  const middle = document.createElement('div');
  middle.className = 'grade-report-middle';

  const semesters = [
    { key: 'hk1', label: 'HỌC KỲ I', icon: '📘', headerClass: 'sem-hk1' },
    { key: 'hk2', label: 'HỌC KỲ II', icon: '📗', headerClass: 'sem-hk2' }
  ];

  semesters.forEach(sem => {
    const semData = (grades && grades[sem.key]) || { hs1: [null, null, null, null], hs2: null, hs3: null };
    const section = document.createElement('div');
    section.className = 'semester-section';

    // Header
    const header = document.createElement('div');
    header.className = `semester-header ${sem.headerClass}`;
    header.innerHTML = `<span class="sem-icon">${sem.icon}</span> ${sem.label}`;
    section.appendChild(header);

    // Table
    const table = document.createElement('table');
    table.className = 'grade-table';

    // Thead — 2 rows
    const thead = document.createElement('thead');

    // Row 1: group headers
    const tr1 = document.createElement('tr');
    const th1_hs1 = document.createElement('th');
    th1_hs1.className = 'col-group-header';
    th1_hs1.colSpan = 4;
    th1_hs1.textContent = 'ĐIỂM HỆ SỐ 1';
    tr1.appendChild(th1_hs1);

    const th1_hs2 = document.createElement('th');
    th1_hs2.className = 'col-group-header';
    th1_hs2.rowSpan = 2;
    th1_hs2.innerHTML = 'ĐIỂM HỆ SỐ 2<br><small>(Thi giữa kì)</small>';
    tr1.appendChild(th1_hs2);

    const th1_hs3 = document.createElement('th');
    th1_hs3.className = 'col-group-header';
    th1_hs3.rowSpan = 2;
    th1_hs3.innerHTML = 'ĐIỂM HỆ SỐ 3<br><small>(Thi cuối kì)</small>';
    tr1.appendChild(th1_hs3);

    const th1_avg = document.createElement('th');
    th1_avg.className = 'col-group-header';
    th1_avg.rowSpan = 2;
    th1_avg.innerHTML = 'ĐIỂM TRUNG BÌNH<br>HỌC KỲ';
    tr1.appendChild(th1_avg);

    thead.appendChild(tr1);

    // Row 2: sub headers for HS1
    const tr2 = document.createElement('tr');
    for (let i = 1; i <= 4; i++) {
      const th = document.createElement('th');
      th.textContent = `Điểm ${i}`;
      tr2.appendChild(th);
    }
    thead.appendChild(tr2);

    table.appendChild(thead);

    // Tbody
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');

    // 4 cột HS1
    for (let i = 0; i < 4; i++) {
      const td = document.createElement('td');
      const val = semData.hs1 ? semData.hs1[i] : null;
      renderGradeCell(td, val, isAdmin, (newVal) => {
        if (!grades[sem.key]) grades[sem.key] = { hs1: [null, null, null, null], hs2: null, hs3: null };
        if (!grades[sem.key].hs1) grades[sem.key].hs1 = [null, null, null, null];
        grades[sem.key].hs1[i] = newVal;
        saveGradesAndRefresh(classId, student, grades, container, points);
      });
      tr.appendChild(td);
    }

    // HS2
    const tdHs2 = document.createElement('td');
    renderGradeCell(tdHs2, semData.hs2, isAdmin, (newVal) => {
      if (!grades[sem.key]) grades[sem.key] = { hs1: [null, null, null, null], hs2: null, hs3: null };
      grades[sem.key].hs2 = newVal;
      saveGradesAndRefresh(classId, student, grades, container, points);
    });
    tr.appendChild(tdHs2);

    // HS3
    const tdHs3 = document.createElement('td');
    renderGradeCell(tdHs3, semData.hs3, isAdmin, (newVal) => {
      if (!grades[sem.key]) grades[sem.key] = { hs1: [null, null, null, null], hs2: null, hs3: null };
      grades[sem.key].hs3 = newVal;
      saveGradesAndRefresh(classId, student, grades, container, points);
    });
    tr.appendChild(tdHs3);

    // TB
    const tdAvg = document.createElement('td');
    tdAvg.className = 'td-avg';
    const avg = calcSemesterAvg(semData);
    tdAvg.textContent = avg !== null ? avg.toFixed(2) : '—';
    tr.appendChild(tdAvg);

    tbody.appendChild(tr);
    table.appendChild(tbody);
    section.appendChild(table);
    middle.appendChild(section);
  });

  report.appendChild(middle);
  container.appendChild(report);
}

function renderGradeCell(td, value, editable, onSave) {
  if (value !== null && value !== undefined) {
    td.textContent = value;
  } else {
    td.textContent = '—';
    td.classList.add('td-empty');
  }

  if (editable) {
    td.classList.add('grade-cell-editable');
    td.addEventListener('click', () => {
      const currentVal = value;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.1';
      input.min = '0';
      input.max = '10';
      input.className = 'grade-cell-input';
      input.value = currentVal !== null && currentVal !== undefined ? currentVal : '';
      
      td.textContent = '';
      td.classList.remove('td-empty');
      td.appendChild(input);
      input.focus();
      input.select();

      const apply = () => {
        const raw = input.value.trim();
        let newVal = null;
        if (raw !== '') {
          const n = parseFloat(raw);
          if (!isNaN(n) && n >= 0 && n <= 10) {
            newVal = Math.round(n * 100) / 100;
          }
        }
        onSave(newVal);
      };

      input.addEventListener('blur', apply);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') {
          // Revert
          td.textContent = currentVal !== null && currentVal !== undefined ? currentVal : '—';
          if (currentVal === null || currentVal === undefined) td.classList.add('td-empty');
        }
      });
    });
  }
}

async function saveGradesAndRefresh(classId, student, grades, container, points) {
  try {
    await api('PATCH', `/api/classes/${classId}/students/${student.id}/grades`, { grades });
    renderGradeReport(container, student, grades, points, classId);
  } catch (err) {
    if (err.message !== 'Unauthorized') showError(err.message);
  }
}

// Import điểm từ Excel (Admin)
function doImportGradesExcel(classId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(evt) {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (!rows || rows.length < 2) {
          showError('File Excel trống hoặc không đọc được.');
          return;
        }

        const header = rows[0];
        // Tìm cột mã HS và cột tên
        let codeCol = -1, nameCol = -1;
        for (let i = 0; i < header.length; i++) {
          const h = String(header[i] || '').toLowerCase();
          if (h.includes('mã') || h.includes('code')) codeCol = i;
          if (h.includes('tên') || h.includes('name') || h.includes('họ')) nameCol = i;
        }
        if (nameCol === -1) nameCol = codeCol !== -1 ? 1 : 0;

        // Tìm các cột điểm theo header: HK1 Điểm 1..4, HK1 Giữa kì, HK1 Cuối kì, HK2 tương tự
        const gradeColNames = [
          'hk1 điểm 1', 'hk1 điểm 2', 'hk1 điểm 3', 'hk1 điểm 4',
          'hk1 giữa kì', 'hk1 cuối kì',
          'hk2 điểm 1', 'hk2 điểm 2', 'hk2 điểm 3', 'hk2 điểm 4',
          'hk2 giữa kì', 'hk2 cuối kì'
        ];
        const gradeCols = gradeColNames.map(name => {
          for (let i = 0; i < header.length; i++) {
            if (String(header[i] || '').toLowerCase().trim() === name) return i;
          }
          return -1;
        });

        const studentsGrades = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const code = codeCol !== -1 && row[codeCol] ? String(row[codeCol]).trim() : null;
          const name = row[nameCol] ? String(row[nameCol]).trim() : null;
          if (!code && !name) continue;

          const g = (idx) => {
            if (idx === -1 || row[idx] === undefined || row[idx] === null || row[idx] === '') return null;
            const n = parseFloat(row[idx]);
            return (!isNaN(n) && n >= 0 && n <= 10) ? Math.round(n * 100) / 100 : null;
          };

          studentsGrades.push({
            code, name,
            grades: {
              hk1: {
                hs1: [g(gradeCols[0]), g(gradeCols[1]), g(gradeCols[2]), g(gradeCols[3])],
                hs2: g(gradeCols[4]),
                hs3: g(gradeCols[5])
              },
              hk2: {
                hs1: [g(gradeCols[6]), g(gradeCols[7]), g(gradeCols[8]), g(gradeCols[9])],
                hs2: g(gradeCols[10]),
                hs3: g(gradeCols[11])
              }
            }
          });
        }

        if (studentsGrades.length === 0) {
          showError('Không tìm thấy dữ liệu điểm trong file.');
          return;
        }

        const res = await api('POST', `/api/classes/${classId}/import-grades`, { studentsGrades });
        alert(`✅ Đã cập nhật điểm cho ${res.updated} học sinh!`);
        // Reload nếu popup đang mở
        await loadAllData();
        renderCurrentClass();
      } catch (err) {
        if (err.message !== 'Unauthorized') showError('Lỗi import: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };
  input.click();
}

// Tải file mẫu Excel điểm
function doDownloadGradeTemplate(classId) {
  const cls = appData.find(c => c.id === classId);
  const headers = [
    'Mã học sinh', 'Họ và tên',
    'HK1 Điểm 1', 'HK1 Điểm 2', 'HK1 Điểm 3', 'HK1 Điểm 4',
    'HK1 Giữa kì', 'HK1 Cuối kì',
    'HK2 Điểm 1', 'HK2 Điểm 2', 'HK2 Điểm 3', 'HK2 Điểm 4',
    'HK2 Giữa kì', 'HK2 Cuối kì'
  ];

  const data = [];
  if (cls && cls.students) {
    cls.students.forEach(s => {
      const g = s.grades || { hk1: { hs1: [null,null,null,null], hs2: null, hs3: null }, hk2: { hs1: [null,null,null,null], hs2: null, hs3: null } };
      data.push([
        s.code || '', s.name,
        ...(g.hk1.hs1 || [null,null,null,null]),
        g.hk1.hs2, g.hk1.hs3,
        ...(g.hk2.hs1 || [null,null,null,null]),
        g.hk2.hs2, g.hk2.hs3
      ]);
    });
  }

  // Thêm dòng mẫu nếu lớp rỗng
  if (data.length === 0) {
    data.push(['HS001', 'Nguyễn Văn A', 8.5, 9.0, 7.5, 8.0, 8.5, 9.0, 8.0, 8.5, 9.0, 8.5, 8.5, 9.5]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  
  // Thử thêm màu sắc cơ bản cho header nếu thư viện hỗ trợ style
  for (let c = 0; c < 14; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: c });
    if (!ws[cellRef]) continue;
    ws[cellRef].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: c < 2 ? "475569" : (c < 8 ? "3B82F6" : "10B981") } },
      alignment: { horizontal: "center" }
    };
  }

  ws['!cols'] = [
    { wch: 14 }, { wch: 24 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 13 }, { wch: 13 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 13 }, { wch: 13 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Bang diem');
  XLSX.writeFile(wb, 'Mau_nhap_diem.xlsx');
}


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

// --- API helper ---
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token   = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Bỏ qua lỗi 401/403 (không tính là hết hạn session) đối với API đăng nhập và API xác thực mật khẩu
  if ((res.status === 401 || res.status === 403) && path !== '/api/admin/login' && !path.includes('/verify-password')) {
    handleSessionExpired();
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Loi server ${res.status}`);
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

  // Render multi GIFs/images beside class name
  const gifsContainer = document.getElementById('current-class-gifs');
  if (gifsContainer) {
    gifsContainer.innerHTML = '';
    let urls = Array.isArray(cls.gifUrls) ? [...cls.gifUrls] : [];
    if (cls.gifUrl && !urls.includes(cls.gifUrl)) urls.unshift(cls.gifUrl);

    urls.forEach((url, index) => {
      if (!url) return;
      const itemWrapper = document.createElement('div');
      itemWrapper.style.cssText = 'position: relative; display: inline-block; margin-left: 4px;';

      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Trang trí lớp';
      img.style.cssText = 'max-height: 55px; vertical-align: middle; object-fit: contain; background: transparent; border: none; outline: none;';
      itemWrapper.appendChild(img);

      if (isAdmin && isEditingMode) {
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Xóa ảnh này';
        deleteBtn.style.cssText = 'position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: #FF4D4D; color: white; border: 2px solid white; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(0,0,0,0.3); padding: 0; line-height: 1; z-index: 10; transition: transform 0.15s ease;';
        deleteBtn.onmouseover = () => deleteBtn.style.transform = 'scale(1.2)';
        deleteBtn.onmouseout = () => deleteBtn.style.transform = 'scale(1)';

        deleteBtn.onclick = async (e) => {
          e.stopPropagation();
          urls.splice(index, 1);
          try {
            const patchRes = await api('PATCH', '/api/classes/' + currentClassId, {
              gifUrls: urls,
              gifUrl: urls[0] || null
            });
            cls.gifUrls = patchRes.gifUrls;
            cls.gifUrl = patchRes.gifUrl;
            renderCurrentClass();
          } catch (err) {
            if (err.message !== 'Unauthorized') showError(err.message);
          }
        };
        itemWrapper.appendChild(deleteBtn);
      }
      gifsContainer.appendChild(itemWrapper);
    });
  }

  gridEl.innerHTML = '';

  if (cls.students.length === 0) {
    const p = createEl('p', { text: 'Lớp này chưa có học sinh.' });
    p.style.cssText = 'text-align:center;width:100%;color:#888;';
    gridEl.appendChild(p);
  } else {
    const allPts = cls.students.map(s => s.points);
    const maxPts = Math.max(...allPts);
    const allSame = allPts.every(p => p === allPts[0]);
    // If all students have the same score, set maxPts to -1 so nobody gets the crown
    const effectiveMax = allSame ? -1 : maxPts;
    cls.students.forEach(student => renderStudentCard(student, cls.id, effectiveMax));
  }
  
  renderSeatingChart(cls);
  renderEvents(cls);
  renderWheel(cls);
  renderDuckRaceSection(cls);
}

// ─── Events (Upcoming Events) ─────────────────────────────────────────────

// Lưu ảnh đã chỉnh sửa lên server
async function doSaveEventImage(classId, eventId, dataUrl) {
  try {
    const cls = appData.find(c => c.id === classId);
    if (!cls) return;
    const evt = cls.events && cls.events.find(e => e.id === eventId);
    if (!evt) return;
    // Update in memory immediately
    evt.imageUrl = dataUrl;
    // Call the correct API endpoint
    const token = getToken();
    const resp = await fetch('/api/classes/' + classId + '/events/' + eventId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ imageUrl: dataUrl })
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || 'Server trả về lỗi ' + resp.status);
    }
    showCustomAlert('Đã lưu', 'Ảnh và nét vẽ đã được lưu thành công!');
  } catch (err) {
    showCustomAlert('Lỗi', 'Không thể lưu ảnh: ' + err.message);
  }
}


// ──────────────────────────────────────────────────────────────
//  IMAGE EDITOR (Fabric.js)
// ──────────────────────────────────────────────────────────────
let _fabricCanvas = null;
let _editorSaveCallback = null;
let _editorHasChanges = false;
let _undoHistory = [];
let _isHistoryLocked = false;

function saveEditorHistory() {
  if (_isHistoryLocked || !_fabricCanvas) return;
  _undoHistory.push(JSON.stringify(_fabricCanvas.toJSON()));
  if (_undoHistory.length > 50) _undoHistory.shift();
}

function undoEditorHistory() {
  if (_undoHistory.length <= 1 || !_fabricCanvas) return;
  _isHistoryLocked = true;
  _undoHistory.pop(); // remove current state
  const prevState = _undoHistory[_undoHistory.length - 1];
  _fabricCanvas.loadFromJSON(prevState, function() {
    _fabricCanvas.renderAll();
    _isHistoryLocked = false;
    _editorHasChanges = true;
  });
}

function openImageEditor(imageUrl, onSave) {
  _editorSaveCallback = onSave;
  _editorHasChanges = false;
  _undoHistory = [];
  _isHistoryLocked = false;

  const modal = document.getElementById('image-editor-modal');
  modal.classList.add('show');

  // Dispose previous instance
  if (_fabricCanvas) {
    _fabricCanvas.dispose();
    _fabricCanvas = null;
  }

  // Load image first to get original dimensions
  const tempImg = new Image();
  tempImg.crossOrigin = 'Anonymous';
  tempImg.onload = () => {
    const origW = tempImg.naturalWidth;
    const origH = tempImg.naturalHeight;

    // Canvas = original image size (preserve quality 1:1)
    _fabricCanvas = new fabric.Canvas('image-editor-canvas', {
      width: origW,
      height: origH,
      backgroundColor: '#ffffff',
      enableRetinaScaling: false, // Prevents GPU buffer flickering on 4K Touch TV displays
      renderOnAddRemove: true,
      stateful: false // Disables heavy internal object state tracking per touch stroke
    });

    // GPU Hardware Acceleration fix for Touch TVs
    if (_fabricCanvas.upperCanvasEl) {
      _fabricCanvas.upperCanvasEl.style.transform = 'translateZ(0)';
      _fabricCanvas.upperCanvasEl.style.willChange = 'transform';
      _fabricCanvas.upperCanvasEl.style.backfaceVisibility = 'hidden';
      _fabricCanvas.upperCanvasEl.style.touchAction = 'none';
    }
    if (_fabricCanvas.lowerCanvasEl) {
      _fabricCanvas.lowerCanvasEl.style.transform = 'translateZ(0)';
      _fabricCanvas.lowerCanvasEl.style.willChange = 'transform';
      _fabricCanvas.lowerCanvasEl.style.backfaceVisibility = 'hidden';
    }

    // Load as background at full 1:1 quality (no scaling)
    fabric.Image.fromURL(imageUrl, (img) => {
      img.set({ left: 0, top: 0, selectable: false, evented: false, scaleX: 1, scaleY: 1 });
      _fabricCanvas.add(img);
      _fabricCanvas.sendToBack(img);
      _fabricCanvas.renderAll();
      saveEditorHistory(); // Save initial state
    }, { crossOrigin: 'Anonymous' });

    // Debounced history save to prevent lag during rapid touch stroke additions
    let historyDebounceTimer = null;
    const debouncedSaveHistory = () => {
      _editorHasChanges = true;
      if (historyDebounceTimer) clearTimeout(historyDebounceTimer);
      historyDebounceTimer = setTimeout(() => {
        saveEditorHistory();
      }, 300);
    };

    _fabricCanvas.on('object:added', debouncedSaveHistory);
    _fabricCanvas.on('object:modified', debouncedSaveHistory);
    _fabricCanvas.on('object:removed', debouncedSaveHistory);

    // Disable object selection while free drawing for smooth touch performance
    _fabricCanvas.on('mouse:down', () => {
      if (_fabricCanvas.isDrawingMode) {
        _fabricCanvas.skipTargetFind = true;
      }
    });
    _fabricCanvas.on('mouse:up', () => {
      _fabricCanvas.skipTargetFind = false;
    });
    
    // Disable interaction for non-admin (view only)
    if (!isAdmin) {
      _fabricCanvas.selection = false;
      _fabricCanvas.isDrawingMode = false;
      _fabricCanvas.forEachObject(obj => { obj.selectable = false; obj.evented = false; });
    }

    // Show/hide tools based on role
    const adminTools = document.getElementById('editor-admin-tools');
    const saveBtn = document.getElementById('editor-save-btn');
    const roleBadge = document.getElementById('editor-role-badge');
    if (isAdmin) {
      if (adminTools) adminTools.style.display = 'flex';
      if (saveBtn) saveBtn.style.display = 'flex';
      if (roleBadge) { roleBadge.textContent = '👑 Admin'; roleBadge.style.background = '#c05621'; roleBadge.style.color = '#fff'; }
    } else {
      if (adminTools) adminTools.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'none';
      if (roleBadge) { roleBadge.textContent = '👁️ Xem'; roleBadge.style.background = '#2d3748'; roleBadge.style.color = '#a0aec0'; }
    }

    // Toolbar bindings
    setupEditorToolbar(origW, origH);

    // Close button
    document.getElementById('editor-close-btn').onclick = () => closeImageEditor(false);

    // Save button (admin only)
    document.getElementById('editor-save-btn').onclick = () => saveImageEditor(origW, origH);
  };
  tempImg.onerror = () => {
    showCustomAlert('Lỗi', 'Không thể tải ảnh để chỉnh sửa. Vui lòng thử lại.');
  };
  tempImg.src = imageUrl;
}

function setupEditorToolbar(origW, origH) {
  const drawBtn = document.getElementById('editor-draw-btn');
  const eraserBtn = document.getElementById('editor-eraser-btn');
  const colorPicker = document.getElementById('editor-color-picker');
  const textBtn = document.getElementById('editor-text-btn');
  const emojiBtn = document.getElementById('editor-emoji-btn');
  const zoomInBtn = document.getElementById('editor-zoom-in-btn');
  const zoomOutBtn = document.getElementById('editor-zoom-out-btn');
  const resetZoomBtn = document.getElementById('editor-reset-zoom-btn');

  // Helper: deactivate all draw modes
  function setDrawMode(mode) {
    _fabricCanvas.isDrawingMode = false;
    drawBtn.classList.remove('active');
    if (eraserBtn) eraserBtn.classList.remove('active');
    if (mode === 'draw') {
      _fabricCanvas.isDrawingMode = true;
      _fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(_fabricCanvas);
      _fabricCanvas.freeDrawingBrush.color = colorPicker.value;
      _fabricCanvas.freeDrawingBrush.width = 4;
      drawBtn.classList.add('active');
      // Khi vẽ: tắt cursor grab để dùng cursor bút
      const cc = document.getElementById('editor-canvas-container');
      if (cc) cc.style.cursor = 'crosshair';
    } else if (mode === 'eraser') {
      _fabricCanvas.isDrawingMode = true;
      // Simulate eraser with white wide brush
      _fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(_fabricCanvas);
      _fabricCanvas.freeDrawingBrush.color = '#ffffff';
      _fabricCanvas.freeDrawingBrush.width = 22;
      if (eraserBtn) eraserBtn.classList.add('active');
      const cc = document.getElementById('editor-canvas-container');
      if (cc) cc.style.cursor = 'cell';
    } else {
      // Chế độ bình thường: trả về grab nếu đang zoom
      const cc = document.getElementById('editor-canvas-container');
      if (cc) cc.style.cursor = 'default';
    }
  }

  // Draw toggle
  let currentMode = 'none';
  drawBtn.onclick = () => {
    currentMode = currentMode === 'draw' ? 'none' : 'draw';
    setDrawMode(currentMode);
  };

  // Eraser toggle
  if (eraserBtn) {
    eraserBtn.onclick = () => {
      currentMode = currentMode === 'eraser' ? 'none' : 'eraser';
      setDrawMode(currentMode);
    };
  }

  // Color picker — applies to both free drawing and selected objects
  colorPicker.oninput = () => {
    if (_fabricCanvas.isDrawingMode && currentMode === 'draw') {
      _fabricCanvas.freeDrawingBrush.color = colorPicker.value;
    }
    const active = _fabricCanvas.getActiveObject();
    if (active) {
      if (active.type === 'i-text' || active.type === 'text') {
        active.set('fill', colorPicker.value);
      } else {
        active.set('stroke', colorPicker.value);
      }
      _fabricCanvas.renderAll();
    }
  };

  // Add text
  textBtn.onclick = () => {
    currentMode = 'none';
    setDrawMode('none');
    const text = new fabric.IText('Gõ nội dung vào đây...', {
      left: 100, top: 100,
      fontFamily: 'Arial',
      fill: colorPicker.value,
      fontSize: 24,
      editable: true
    });
    _fabricCanvas.add(text);
    _fabricCanvas.setActiveObject(text);
    text.enterEditing();
    _fabricCanvas.renderAll();
  };

  // Emoji picker panel
  emojiBtn.onclick = () => {
    currentMode = 'none';
    setDrawMode('none');
    showEmojiPicker(colorPicker.value);
  };

  // Undo button
  const undoBtn = document.getElementById('editor-undo-btn');
  if (undoBtn) {
    undoBtn.onclick = () => undoEditorHistory();
  }

  // Zoom — min zoom=1 (original), can only zoom IN from default
  const canvasContainer = document.getElementById('editor-canvas-container');
  let currentZoom = 1;

  function applyZoom(zoom) {
    currentZoom = zoom;
    _fabricCanvas.setZoom(currentZoom);
    _fabricCanvas.setDimensions({
      width: origW * currentZoom,
      height: origH * currentZoom
    });
    // Sửa lỗi kẹt cuộn của CSS Flexbox: khi zoom to hơn màn hình, tắt flex center
    if (currentZoom > 1) {
      canvasContainer.style.display = 'block';
      canvasContainer.style.cursor = 'grab';
    } else {
      canvasContainer.style.display = 'flex';
      canvasContainer.style.cursor = 'default';
    }
  }

  zoomInBtn.onclick = () => applyZoom(Math.min(currentZoom + 0.25, 5));
  zoomOutBtn.onclick = () => applyZoom(Math.max(currentZoom - 0.25, 1));
  resetZoomBtn.onclick = () => {
    applyZoom(1);
    canvasContainer.scrollLeft = 0;
    canvasContainer.scrollTop = 0;
  };

  // ── Drag-to-Pan (kéo ảnh sau khi zoom) - Native DOM ──────────────────────
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let panScrollLeft = 0, panScrollTop = 0;

  function startPan(e) {
    if (_fabricCanvas.isDrawingMode || currentZoom <= 1) return;
    
    // Bỏ qua nếu click trúng object
    const activeObj = _fabricCanvas.getActiveObject();
    if (activeObj && activeObj.selectable !== false) return;

    isPanning = true;
    panStartX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    panStartY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    panScrollLeft = canvasContainer.scrollLeft;
    panScrollTop = canvasContainer.scrollTop;
    canvasContainer.style.cursor = 'grabbing';
    
    // Tắt vùng chọn của Fabric và ngăn chặn browser drag mặc định
    _fabricCanvas.selection = false;
    e.preventDefault();
  }

  function movePan(e) {
    if (!isPanning) return;
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    const dx = clientX - panStartX;
    const dy = clientY - panStartY;
    canvasContainer.scrollLeft = panScrollLeft - dx;
    canvasContainer.scrollTop = panScrollTop - dy;
  }

  function stopPan() {
    if (!isPanning) return;
    isPanning = false;
    canvasContainer.style.cursor = currentZoom > 1 ? 'grab' : 'default';
    if (isAdmin && !_fabricCanvas.isDrawingMode) {
      _fabricCanvas.selection = true;
    }
  }

  // Dùng container bọc ngoài cùng để bắt sự kiện chắc chắn nhất
  const wrapper = document.getElementById('image-editor-modal');
  wrapper.addEventListener('mousedown', startPan, true);
  wrapper.addEventListener('mousemove', movePan, true);
  window.addEventListener('mouseup', stopPan, true);
  
  wrapper.addEventListener('touchstart', startPan, { passive: false, capture: true });
  wrapper.addEventListener('touchmove', movePan, { passive: false, capture: true });
  window.addEventListener('touchend', stopPan, true);

  // ── Delete/Backspace key: remove selected objects ─────────────────────────
  function handleEditorKeyDown(e) {
    const modal = document.getElementById('image-editor-modal');
    if (!modal || !modal.classList.contains('show')) return;
    if (!_fabricCanvas) return;
    // Don't delete while typing inside text box
    const active = _fabricCanvas.getActiveObject();
    if (active && (active.type === 'i-text' || active.type === 'text') && active.isEditing) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      undoEditorHistory();
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selected = _fabricCanvas.getActiveObjects();
      if (selected && selected.length > 0) {
        // Don't allow deleting the background image (selectable = false)
        selected.forEach(obj => {
          if (obj.selectable !== false) _fabricCanvas.remove(obj);
        });
        _fabricCanvas.discardActiveObject();
        _fabricCanvas.renderAll();
        _editorHasChanges = true;
        e.preventDefault();
      }
    }
  }
  // Remove old listener if any, then add fresh
  document.removeEventListener('keydown', window._editorKeyHandler);
  window._editorKeyHandler = handleEditorKeyDown;
  document.addEventListener('keydown', window._editorKeyHandler);
}

function showEmojiPicker(color) {
  // Remove existing picker
  const old = document.getElementById('emoji-picker-panel');
  if (old) { old.remove(); return; }

  const emojis = ["😀","😂","😍","🥰","😎","🤩","😜","🤔","😴","🤗","🎉","🎊","🎈","🎁","🏆","🥇","⭐","🌟","💯","🔥","❤️","💙","💚","💛","💜","🖤","💖","💝","💪","👏","📚","📖","✏️","📝","🖊️","📐","📏","🎒","🏫","📓","🌸","🌺","🌻","🌈","☀️","🌙","⛅","🍎","🍊","🍋","🐶","🐱","🐼","🐨","🐸","🦊","🐝","🦋","🌴","🌵","🚀","🎸","🎮","🎯","🏅","🛸","💡","🔮","🌍","🏖️","👋","✌️","🤙","🙌","🫶","🤝","🙏","💪","🎓","🧠"];

  const panel = document.createElement('div');
  panel.id = 'emoji-picker-panel';
  panel.style.cssText = `
    position: fixed; z-index: 99999;
    top: 70px; left: 50%; transform: translateX(-50%);
    background: #1a202c; border: 1px solid #4a5568; border-radius: 12px;
    padding: 12px; display: flex; flex-wrap: wrap; gap: 6px;
    max-width: 380px; max-height: 260px; overflow-y: auto;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  `;

  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.style.cssText = 'font-size: 1.5rem; background: transparent; border: none; cursor: pointer; padding: 4px; border-radius: 4px; transition: background 0.15s;';
    btn.onmouseover = () => btn.style.background = '#4a5568';
    btn.onmouseout = () => btn.style.background = 'transparent';
    btn.onclick = () => {
      const text = new fabric.IText(emoji, {
        left: 120, top: 120,
        fontSize: 36,
        selectable: true
      });
      _fabricCanvas.add(text);
      _fabricCanvas.setActiveObject(text);
      _fabricCanvas.renderAll();
      panel.remove();
    };
    panel.appendChild(btn);
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function outsideHandler(e) {
      if (!panel.contains(e.target) && e.target.id !== 'editor-emoji-btn') {
        panel.remove();
        document.removeEventListener('click', outsideHandler);
      }
    });
  }, 100);

  document.body.appendChild(panel);
}

function closeImageEditor(skipConfirm) {
  if (!skipConfirm && _editorHasChanges && isAdmin) {
    // Boost confirm modal z-index ABOVE image editor modal so it appears on top
    const alertModal = document.getElementById('custom-alert-modal');
    if (alertModal) {
      alertModal.style.zIndex = '11000';
    }
    showConfirmModal(
      'Bạn muốn lưu trước khi thoát?',
      'Các thay đổi chưa được lưu sẽ bị mất nếu bạn thoát.',
      () => {
        if (alertModal) alertModal.style.zIndex = '';
        saveImageEditor();
      },
      () => {
        if (alertModal) alertModal.style.zIndex = '';
        _editorHasChanges = false;
        closeImageEditor(true);
      },
      'Lưu & Thoát',
      'Thoát không lưu'
    );
    return;
  }
  const modal = document.getElementById('image-editor-modal');
  modal.classList.remove('show');
  const old = document.getElementById('emoji-picker-panel');
  if (old) old.remove();
  if (_fabricCanvas) {
    _fabricCanvas.dispose();
    _fabricCanvas = null;
  }
  _editorSaveCallback = null;
  _editorHasChanges = false;
}

function saveImageEditor(origW, origH) {
  if (!_fabricCanvas) return;
  // Reset zoom to 1 before exporting to get the correct resolution
  const prevZoom = _fabricCanvas.getZoom();
  _fabricCanvas.setZoom(1);
  const w = origW || _fabricCanvas.getWidth();
  const h = origH || _fabricCanvas.getHeight();
  _fabricCanvas.setDimensions({ width: w, height: h });
  const dataUrl = _fabricCanvas.toDataURL({
    format: 'jpeg',
    quality: 0.92,
    width: w,
    height: h,
    left: 0,
    top: 0
  });
  // Restore zoom after export
  _fabricCanvas.setZoom(prevZoom);
  if (_editorSaveCallback) _editorSaveCallback(dataUrl);
  _editorHasChanges = false;
  closeImageEditor(true);
}

// Generic confirm modal (two buttons)
function showConfirmModal(title, message, onConfirm, onCancel, confirmText = 'Đồng ý', cancelText = 'Hủy') {
  const existing = document.getElementById('custom-alert-modal');
  if (!existing) return;

  document.getElementById('custom-alert-title').textContent = title;
  document.getElementById('custom-alert-message').textContent = message;
  document.getElementById('custom-alert-icon').textContent = '❓';

  const okBtn = document.getElementById('custom-alert-ok-btn');
  okBtn.textContent = confirmText;
  
  // Clean up previous event listeners by cloning if necessary, but here we just overwrite onclick
  okBtn.onclick = () => {
    existing.classList.remove('show');
    if (onConfirm) onConfirm();
    setTimeout(() => { 
      okBtn.textContent = 'Đóng'; 
      document.getElementById('custom-alert-icon').textContent = '⚠️';
    }, 300);
  };

  let cancelBtn = document.getElementById('custom-alert-cancel-btn');
  if (!cancelBtn) {
    cancelBtn = document.createElement('button');
    cancelBtn.id = 'custom-alert-cancel-btn';
    cancelBtn.className = okBtn.className;
    cancelBtn.style.background = '#6b7280';
    cancelBtn.style.flex = '1';
    cancelBtn.style.margin = '0';
    cancelBtn.style.color = 'white';
    cancelBtn.style.border = 'none';
    cancelBtn.style.padding = '11px 24px';
    cancelBtn.style.borderRadius = '10px';
    cancelBtn.style.fontWeight = '700';
    cancelBtn.style.fontSize = '0.95rem';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.transition = 'transform 0.15s';
    okBtn.parentNode.insertBefore(cancelBtn, okBtn);
  }
  
  cancelBtn.textContent = cancelText;
  cancelBtn.style.display = 'flex';
  cancelBtn.style.justifyContent = 'center';
  cancelBtn.style.alignItems = 'center';
  cancelBtn.onclick = () => {
    existing.classList.remove('show');
    cancelBtn.style.display = 'none';
    if (onCancel) onCancel();
    setTimeout(() => { 
      document.getElementById('custom-alert-icon').textContent = '⚠️'; 
    }, 300);
  };

  existing.classList.add('show');
}

function rotateHandbookImage(classId, evt, degrees, imgElement) {
  const tempImg = new Image();
  tempImg.crossOrigin = 'Anonymous';
  tempImg.onload = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (degrees === 90 || degrees === -90) {
      canvas.width = tempImg.height;
      canvas.height = tempImg.width;
    } else {
      canvas.width = tempImg.width;
      canvas.height = tempImg.height;
    }
    
    if (degrees === 90) {
      ctx.translate(tempImg.height, 0);
      ctx.rotate(90 * Math.PI / 180);
    } else if (degrees === -90) {
      ctx.translate(0, tempImg.width);
      ctx.rotate(-90 * Math.PI / 180);
    } else if (degrees === 180) {
      ctx.translate(tempImg.width, tempImg.height);
      ctx.rotate(180 * Math.PI / 180);
    }
    
    ctx.drawImage(tempImg, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    
    evt.imageUrl = dataUrl;
    imgElement.src = dataUrl;
    
    doSaveEventImage(classId, evt.id, dataUrl);
  };
  tempImg.src = evt.imageUrl;
}

function renderEvents(cls) {
  const container = document.getElementById('events-container');
  container.innerHTML = '';

  const hasEvents = cls.events && cls.events.length > 0;
  
  // Chỉ hiển thị nếu có sự kiện hoặc đang là admin
  if (!hasEvents && !isAdmin) return;

  const section = createEl('div', { className: 'events-section' });
  const header = createEl('div', { className: 'events-header' });
  const title = createEl('h2', { text: '📚 Sổ Tay Lớp Học 📓' });
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
      
            // Click để mở trình chỉnh sửa
      img.style.cursor = 'pointer';
      
      // Overlay hint "✏️ Chỉnh sửa"
      const overlay = createEl('div', { className: 'event-card-hover-overlay' });
      overlay.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';

      card.appendChild(img);
      card.appendChild(overlay);

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-event') || e.target.closest('.btn-rotate-event')) return;
        openImageEditor(evt.imageUrl, (newDataUrl) => {
          evt.imageUrl = newDataUrl;
          img.src = newDataUrl; // Cập nhật trực tiếp ảnh trên DOM mà không vẽ lại cả trang
          doSaveEventImage(cls.id, evt.id, newDataUrl);
        });
      });

      if (isAdmin) {
        const rotLeftBtn = createEl('button', { className: 'btn-rotate-event btn-rotate-left admin-only', title: 'Quay trái 90°' });
        rotLeftBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
        rotLeftBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          rotateHandbookImage(cls.id, evt, -90, img);
        });

        const rotRightBtn = createEl('button', { className: 'btn-rotate-event btn-rotate-right admin-only', title: 'Quay phải 90°' });
        rotRightBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
        rotRightBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          rotateHandbookImage(cls.id, evt, 90, img);
        });

        const delBtn = createEl('button', { className: 'btn-delete-event admin-only', title: 'Xóa ảnh' });
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        delBtn.addEventListener('click', () => {
          showConfirmModal(
            'Xác nhận xóa',
            'Bạn có chắc chắn muốn xóa ảnh này không?',
            () => { doDeleteEvent(cls.id, evt.id); },
            null,
            'Xóa',
            'Hủy'
          );
        });
        card.appendChild(rotLeftBtn);
        card.appendChild(rotRightBtn);
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
    id: `student-card-${student.id}`,
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
  const iconsContainer = createEl('div', { className: 'icons-container student-icons-container' });
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

  // Click handler cho thẻ học sinh -> Mở hộp bí mật (trừ khi click vào input hoặc các nút thao tác)
  card.addEventListener('click', (e) => {
    // Bỏ qua nếu click vào các thành phần thao tác
    if (e.target.closest('button') || e.target.closest('.points-display') || e.target.tagName === 'INPUT') return;
    doStudentPrivatePopup(classId, student);
  });

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
      // Cập nhật crown trực tiếp trên DOM mà không vẽ lại cả trang (chống nháy)
      updateCrowns(cls);
    } catch (err) {
      if (err.message !== 'Unauthorized') showError(err.message);
      // Rollback điểm về giá trị server nếu thất bại
      await loadAllData();
      renderCurrentClass();
    }
  }, 800);
}

// Cập nhật biểu tượng vương miện và hiệu ứng card mà KHÔNG làm nháy trang (No DOM rebuild)
function updateCrowns(cls) {
  if (!cls || !cls.students) return;
  const allPts = cls.students.map(s => s.points);
  const maxPts = Math.max(...allPts);
  const allSame = allPts.every(p => p === allPts[0]);
  const effectiveMax = allSame ? -1 : maxPts;

  cls.students.forEach(s => {
    const card = document.getElementById(`student-card-${s.id}`);
    if (!card) return;
    const isTop = effectiveMax > 0 && s.points === effectiveMax;
    
    // Highlight top student card
    if (isTop) {
      card.classList.add('is-top');
    } else {
      card.classList.remove('is-top');
    }

    // Toggle crown icon in icons container
    const iconsContainer = card.querySelector('.student-icons-container');
    if (iconsContainer) {
      let crown = iconsContainer.querySelector('.crown-icon');
      if (isTop) {
        if (!crown) {
          crown = createEl('span', { className: 'crown-icon', text: '👑', title: 'Người cao điểm nhất' });
          iconsContainer.appendChild(crown);
        }
      } else {
        if (crown) crown.remove();
      }
    }
  });
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
      
      let input;
      if (field.type === 'password') {
        const wrapper = createEl('div');
        wrapper.className = 'password-input-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.width = '100%';
        
        input = createEl('input');
        input.type = 'password';
        input.style.width = '100%';
        input.style.paddingRight = '35px';
        
        const toggleBtn = createEl('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'password-toggle-btn';
        toggleBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
        toggleBtn.style.position = 'absolute';
        toggleBtn.style.right = '12px';
        toggleBtn.style.top = '50%';
        toggleBtn.style.transform = 'translateY(-50%)';
        toggleBtn.style.background = 'none';
        toggleBtn.style.border = 'none';
        toggleBtn.style.cursor = 'pointer';
        toggleBtn.style.color = '#777';
        toggleBtn.style.padding = '0';
        toggleBtn.style.fontSize = '14px';
        toggleBtn.style.zIndex = '5';
        
        toggleBtn.addEventListener('click', () => {
          if (input.type === 'password') {
            input.type = 'text';
            toggleBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
          } else {
            input.type = 'password';
            toggleBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
          }
        });
        
        if (field.value) input.value = field.value;
        if (field.placeholder) input.placeholder = field.placeholder;
        
        wrapper.appendChild(input);
        wrapper.appendChild(toggleBtn);
        group.appendChild(label);
        group.appendChild(wrapper);
      } else {
        input = createEl('input');
        input.type = field.type || 'text';
        if (field.value) input.value = field.value;
        if (field.placeholder) input.placeholder = field.placeholder;
        group.appendChild(label);
        group.appendChild(input);
      }
      
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
      });

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
    { key: 'code', label: 'Mã học sinh', value: student ? (student.code || '') : '' },
    { key: 'name', label: 'Tên học sinh', value: student ? student.name : currentName },
    { key: 'dob', label: 'Ngày sinh (Ví dụ: 15/08)', value: student ? (student.dob || '') : '', placeholder: 'DD/MM hoặc DD/MM/YYYY' }
  ]);
  if (!res || !res.name) return;
  
  try {
    const patchRes = await api('PATCH', `/api/classes/${classId}/students/${studentId}`, { name: res.name, dob: res.dob, code: res.code });
    if (student) {
      student.name = patchRes.name;
      student.dob = patchRes.dob;
      student.code = patchRes.code;
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
    { key: 'code', label: 'Mã học sinh', placeholder: 'Ví dụ: HS001' },
    { key: 'name', label: 'Tên học sinh' },
    { key: 'dob', label: 'Ngày sinh (DD/MM/YYYY)', placeholder: 'Ví dụ: 15/05/2012' }
  ]);
  if (!res || !res.name) return;

  try {
    const newStudent = await api('POST', `/api/classes/${currentClassId}/students`, { name: res.name, dob: res.dob, code: res.code });
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
  const res = await showCustomPrompt('Thêm ảnh/GIF trang trí lớp', [
    { key: 'url', label: 'Nhập link ảnh hoặc GIF mới', value: '' }
  ]);
  if (!res || !res.url || !res.url.trim()) return; // Cancel or empty

  const newUrl = res.url.trim();
  let urls = Array.isArray(cls.gifUrls) ? [...cls.gifUrls] : [];
  if (cls.gifUrl && !urls.includes(cls.gifUrl)) urls.unshift(cls.gifUrl);
  
  // Append new URL (support multiple images added rightwards)
  urls.push(newUrl);

  try {
    const patchRes = await api('PATCH', `/api/classes/${currentClassId}`, {
      gifUrls: urls,
      gifUrl: urls[0] || null
    });
    cls.gifUrls = patchRes.gifUrls;
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
      const rows     = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

      if (!rows || rows.length === 0) {
        alert('File Excel trống hoặc không đọc được.');
        return;
      }

      // Tìm cột tên, cột ngày sinh và cột mã học sinh
      let nameCol = -1;
      let dobCol = -1;
      let codeCol = -1;
      const header = rows[0];
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || '').toLowerCase();
        if (h.includes('tên') || h.includes('name') || h.includes('họ')) {
          nameCol = i;
        }
        if (h.includes('sinh') || h.includes('dob') || h.includes('birthday')) {
          dobCol = i;
        }
        if (h.includes('mã') || h.includes('code') || h.includes('id')) {
          codeCol = i;
        }
      }
      // Nếu không tìm thấy cột tên, thử cột đầu tiên hoặc cột thứ hai
      if (nameCol === -1) nameCol = codeCol !== -1 ? 1 : 0;

      const studentsToImport = [];
      for (let i = 1; i < rows.length; i++) {
        const val = rows[i][nameCol];
        if (val) {
          const studentObj = { name: String(val).trim() };
          if (dobCol !== -1 && rows[i][dobCol]) {
            let dobVal = rows[i][dobCol];
            if (typeof dobVal === 'number' && dobVal > 0 && dobVal < 100000) {
              // Excel serial date number → convert directly, no timezone issues
              const dateInfo = XLSX.SSF.parse_date_code(dobVal);
              const d = String(dateInfo.d).padStart(2, '0');
              const m = String(dateInfo.m).padStart(2, '0');
              const y = dateInfo.y;
              studentObj.dob = `${d}/${m}/${y}`;
            } else {
              studentObj.dob = String(dobVal).trim();
            }
          }
          if (codeCol !== -1 && rows[i][codeCol]) {
            studentObj.code = String(rows[i][codeCol]).trim();
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

  // Theo dõi số lần thử (client-side, max 5 khớp với server rate limiter)
  if (typeof window._loginAttempts === 'undefined') window._loginAttempts = 0;
  const MAX_ATTEMPTS = 5;

  try {
    const res = await api('POST', '/api/admin/login', { password: pwd });
    window._loginAttempts = 0; // reset khi đăng nhập thành công
    setToken(res.token);
    isAdmin = true;
    document.getElementById('password-modal').classList.remove('show');
    updateAdminUI();
    renderClassTabs();
    renderCurrentClass();
  } catch (err) {
    window._loginAttempts++;
    const remaining = Math.max(0, MAX_ATTEMPTS - window._loginAttempts);
    let msg = '🔐 Sai mật khẩu!';
    if (remaining > 0) {
      msg += ` Còn ${remaining} lần thử.`;
    } else {
      msg = '🔒 Đã vượt quá số lần thử. Vui lòng chờ 15 phút rồi thử lại.';
    }
    // Nếu server trả về thông báo quá nhiều lần thử (rate limit)
    if (err.message && err.message.includes('nhiều')) {
      msg = '🔒 Quá nhiều lần thử sai. Vui lòng chờ 15 phút rồi thử lại.';
    }
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
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

  const conversionTable = document.getElementById('conversion-table');

  if (isAdmin) {
    document.body.classList.add('is-admin');
    toggleBtn.classList.add('unlocked');
    toggleBtn.innerHTML = '<i class="fa-solid fa-lock-open"></i>';
    editModeToggle.style.display = 'inline-flex';
    if (conversionTable) conversionTable.style.display = 'block';

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
    if (conversionTable) conversionTable.style.display = 'none';
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────
async function loadAllData() {
  // Giu lai cac imageUrl da duoc ve tay (DataURL) khoi bi ghi de boi SSE reload
  const localAnnotations = {};
  if (appData && appData.length > 0) {
    appData.forEach(cls => {
      if (cls.events && cls.events.length > 0) {
        cls.events.forEach(evt => {
          if (evt.imageUrl && evt.imageUrl.startsWith('data:image/')) {
            if (!localAnnotations[cls.id]) localAnnotations[cls.id] = {};
            localAnnotations[cls.id][evt.id] = evt.imageUrl;
          }
        });
      }
    });
  }

  appData = await api('GET', '/api/classes');

  // Phuc hoi lai cac annotation vao data moi
  if (Object.keys(localAnnotations).length > 0) {
    appData.forEach(cls => {
      if (localAnnotations[cls.id] && cls.events) {
        cls.events.forEach(evt => {
          if (localAnnotations[cls.id][evt.id]) {
            evt.imageUrl = localAnnotations[cls.id][evt.id];
          }
        });
      }
    });
  }

  if (!currentClassId && appData.length > 0) {
    currentClassId = appData[0].id;
  }
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
  document.getElementById('excel-template-btn').addEventListener('click', () => {
    // Generate a template using the XLSX library already loaded
    const headers = [["Mã học sinh", "Họ và tên học sinh", "Ngày sinh (DD/MM/YYYY)"]];
    const data = [
      ["HS001", "Nguyễn Văn A", "15/05/2012"],
      ["HS002", "Trần Thị B", "20/11/2012"],
      ["HS003", "Lê Văn C", ""]
    ];
    const ws = XLSX.utils.aoa_to_sheet(headers.concat(data));
    // Set column widths
    ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Danh sach hoc sinh");
    
    // Trigger browser download
    XLSX.writeFile(wb, "Mau_nhap_hoc_sinh.xlsx");
  });

  const deleteAllBtn = document.getElementById('delete-all-students-btn');
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', async () => {
      if (!currentClassId) return;
      if (confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ học sinh trong lớp này? Hành động này không thể hoàn tác!')) {
        try {
          await api('DELETE', `/api/classes/${currentClassId}/students`);
          alert('Đã xóa tất cả học sinh!');
          await loadAllData();
          renderCurrentClass();
        } catch (err) {
          if (err.message !== 'Unauthorized') showError(err.message);
        }
      }
    });
  }

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
function showError(msg, title = 'Thông báo', icon = '⚠️') {
  const modal = document.getElementById('custom-alert-modal');
  if (!modal) {
    alert(msg);
    return;
  }
  document.getElementById('custom-alert-icon').textContent = icon;
  document.getElementById('custom-alert-title').textContent = title;
  document.getElementById('custom-alert-message').textContent = msg;
  modal.classList.add('show');
  
  const okBtn = document.getElementById('custom-alert-ok-btn');
  okBtn.focus();
  okBtn.onclick = () => {
    modal.classList.remove('show');
  };
}



// ══════════════════════════════════════════════════════════════════════════════
// 🦆 RACE DUCK — LAKE WATER ALL-IN-ONE (Duck Race like classic Online Duck Race)
// ══════════════════════════════════════════════════════════════════════════════

const DUCK_SKINS = [
  { body: '#FFD700', beak: '#FF8C00', eye: '#1a1a1a', hat: null,        wing: '#FFA500' },
  { body: '#FF6B6B', beak: '#c0392b', eye: '#fff',   hat: 'crown',     wing: '#e74c3c' },
  { body: '#74b9ff', beak: '#0984e3', eye: '#fff',   hat: null,        wing: '#0984e3' },
  { body: '#a29bfe', beak: '#6c5ce7', eye: '#fff',   hat: 'tophat',    wing: '#6c5ce7' },
  { body: '#55efc4', beak: '#00b894', eye: '#1a1a1a',hat: 'pirate',    wing: '#00b894' },
  { body: '#fd79a8', beak: '#e84393', eye: '#fff',   hat: 'bow',       wing: '#e84393' },
  { body: '#fdcb6e', beak: '#e17055', eye: '#1a1a1a',hat: 'cap',       wing: '#e17055' },
  { body: '#dfe6e9', beak: '#b2bec3', eye: '#636e72',hat: 'wizard',    wing: '#b2bec3' },
  { body: '#2d3436', beak: '#636e72', eye: '#FFD700',hat: 'glasses',   wing: '#636e72' },
  { body: '#e17055', beak: '#d35400', eye: '#fff',   hat: 'tophat',    wing: '#d35400' },
  { body: '#00cec9', beak: '#00b894', eye: '#fff',   hat: 'crown',     wing: '#00b894' },
  { body: '#fab1a0', beak: '#e17055', eye: '#1a1a1a',hat: 'headphones',wing: '#e17055' },
  { body: '#95a5a6', beak: '#7f8c8d', eye: '#1a1a1a',hat: 'viking',    wing: '#7f8c8d' },
  { body: '#f39c12', beak: '#d35400', eye: '#fff',   hat: 'ninja',     wing: '#e67e22' },
  { body: '#16a085', beak: '#16a085', eye: '#FFD700',hat: 'detective', wing: '#1abc9c' },
  { body: '#8e44ad', beak: '#9b59b6', eye: '#fff',   hat: 'chef',      wing: '#9b59b6' },
  { body: '#27ae60', beak: '#2ecc71', eye: '#1a1a1a',hat: 'cap',       wing: '#2ecc71' },
  { body: '#e74c3c', beak: '#c0392b', eye: '#FFD700',hat: 'crown',     wing: '#c0392b' },
  { body: '#34495e', beak: '#2c3e50', eye: '#fff',   hat: 'pirate',    wing: '#2c3e50' },
  { body: '#d35400', beak: '#e67e22', eye: '#fff',   hat: 'wizard',    wing: '#e67e22' },
];

function getDuckSVG(skin, size) {
  size = size || 52;
  var body = skin.body, beak = skin.beak, hat = skin.hat;
  var gid = (body + beak).replace(/#/g, '').substring(0, 10);

  var hatSvg = '';
  if (hat === 'crown') {
    hatSvg = '<g transform="translate(13,-3)"><rect x="0" y="8" width="18" height="3" rx="1.2" fill="#FFA500"/><polygon points="2,8 4.5,1 9,5.5 13.5,1 16,8" fill="#FFD700" stroke="#E67E22" stroke-width="0.5"/><circle cx="4.5" cy="1.8" r="1.1" fill="#E74C3C"/><circle cx="9" cy="5.5" r="0.8" fill="#fff"/><circle cx="13.5" cy="1.8" r="1.1" fill="#3498DB"/></g>';
  } else if (hat === 'tophat') {
    hatSvg = '<g transform="translate(13,-5)"><rect x="1" y="2" width="15" height="11" rx="1" fill="#2D3436"/><rect x="-1" y="12.5" width="19" height="2.8" rx="1.2" fill="#1E272C"/><rect x="1" y="9.5" width="15" height="2.2" fill="#E74C3C"/></g>';
  } else if (hat === 'wizard') {
    hatSvg = '<g transform="translate(11,-10)"><polygon points="11,0 2,17 20,17" fill="#6C5CE7"/><ellipse cx="11" cy="17" rx="10" ry="2.5" fill="#4834D4"/><polygon points="11,5 12.2,8.5 16,8.5 13,10.5 14,14 11,12 8,14 9,10.5 6,8.5 9.8,8.5" fill="#FFD700"/></g>';
  } else if (hat === 'cap') {
    hatSvg = '<g transform="translate(11,4)"><path d="M0,10 A11,8.5 0 0,1 22,10 Z" fill="#E74C3C"/><rect x="0" y="9.2" width="22" height="2" rx="0.5" fill="#C0392B"/><path d="M20,9 Q27,8 29,11 Q23,13.5 20,10.5 Z" fill="#C0392B"/></g>';
  } else if (hat === 'bow') {
    hatSvg = '<g transform="translate(19,1)"><path d="M0,5.5 Q5.5,0 11,5.5 Q5.5,3 0,5.5 Z" fill="#FF6B9D"/><path d="M11,5.5 Q16.5,0 22,5.5 Q16.5,3 11,5.5 Z" fill="#FF6B9D"/><circle cx="11" cy="4.5" r="2.5" fill="#E84393"/></g>';
  } else if (hat === 'glasses') {
    hatSvg = '<g transform="translate(17,9)"><ellipse cx="8.5" cy="3.5" rx="5.5" ry="4" fill="rgba(10,10,10,0.72)" stroke="#FFD700" stroke-width="1.1"/><line x1="3" y1="3.5" x2="-1" y2="4.2" stroke="#FFD700" stroke-width="1.1"/><line x1="14" y1="3.5" x2="19" y2="5" stroke="#FFD700" stroke-width="1.1"/></g>';
  } else if (hat === 'pirate') {
    hatSvg = '<g transform="translate(9,-3)"><path d="M1,12 Q13,0 25,12 L21,10 Q13,6 5,10 Z" fill="#2D3436"/><circle cx="13" cy="7" r="2" fill="#FFF"/><path d="M10.5,6 L15.5,8 M10.5,8 L15.5,6" stroke="#2D3436" stroke-width="0.8"/><path d="M4,11 Q0,5 4,1" stroke="#E74C3C" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>';
  } else if (hat === 'headphones') {
    hatSvg = '<g transform="translate(11,4)"><path d="M0,10 A11,11 0 0,1 22,10" fill="none" stroke="#E74C3C" stroke-width="2.5" stroke-linecap="round"/><rect x="17" y="8" width="6.5" height="10" rx="2.5" fill="#2D3436" stroke="#E74C3C" stroke-width="1"/><rect x="-1.5" y="8" width="5" height="8" rx="2.5" fill="#2D3436" stroke="#E74C3C" stroke-width="1"/></g>';
  } else if (hat === 'viking') {
    hatSvg = '<g transform="translate(10,-1)"><path d="M0,11 Q11,3 22,11 Z" fill="#7F8C8D"/><rect x="0" y="10" width="22" height="2.8" rx="1.2" fill="#95A5A6"/><path d="M20,10 Q26,4 28,0" fill="none" stroke="#DDD" stroke-width="2.8" stroke-linecap="round"/><path d="M2,10 Q-3,4 -4,0" fill="none" stroke="#DDD" stroke-width="2.8" stroke-linecap="round"/></g>';
  } else if (hat === 'ninja') {
    hatSvg = '<g transform="translate(12,7)"><rect x="0" y="0" width="20" height="5" rx="2.2" fill="#2D3436"/><rect x="4" y="0" width="11" height="5" fill="#E74C3C"/><path d="M18,2.5 Q23,6 22,12" fill="none" stroke="#E74C3C" stroke-width="2.2" stroke-linecap="round"/></g>';
  } else if (hat === 'detective') {
    hatSvg = '<g transform="translate(9,-3)"><path d="M1,12 Q13,2 25,12 Z" fill="#6E5773"/><ellipse cx="13" cy="12" rx="13.5" ry="3.2" fill="#5C3D46"/></g>';
  } else if (hat === 'chef') {
    hatSvg = '<g transform="translate(11,-10)"><path d="M2,13 C0,7 4,1.5 9,3.5 C10,-1 16,0 18,3.5 C22,2 24,8 21,13 Z" fill="#FFF" stroke="#DDD" stroke-width="0.8"/><rect x="3" y="12" width="17" height="3" rx="1.2" fill="#FFF" stroke="#CCC" stroke-width="0.6"/></g>';
  }

  // Pure clean gradients without muddy shadows
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 46" width="${size}" height="${size}">
    <defs>
      <!-- Base Body: Solid color with bright top-left specular highlight -->
      <radialGradient id="bG${gid}" cx="35%" cy="25%" r="65%">
        <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.85"/>
        <stop offset="40%"  stop-color="${body}"/>
        <stop offset="100%" stop-color="${body}"/>
      </radialGradient>
      
      <!-- Head: Solid color with bright top-left specular highlight -->
      <radialGradient id="hG${gid}" cx="30%" cy="20%" r="60%">
        <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.9"/>
        <stop offset="35%"  stop-color="${body}"/>
        <stop offset="100%" stop-color="${body}"/>
      </radialGradient>

      <!-- Beak: Solid with highlight -->
      <radialGradient id="kG${gid}" cx="28%" cy="20%" r="62%">
        <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.8"/>
        <stop offset="40%"  stop-color="${beak}"/>
        <stop offset="100%" stop-color="${beak}"/>
      </radialGradient>

      <!-- Very soft belly glow -->
      <radialGradient id="bl${gid}" cx="50%" cy="40%" r="55%">
        <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <!-- Ground shadow (very soft, less muddy) -->
    <ellipse cx="20" cy="44" rx="13" ry="1.8" fill="rgba(0,0,0,0.08)"/>

    <!-- Tail -->
    <path d="M 5,29 C 1,23 3,17 7,21 C 8,24 7,27 6,30 Z" fill="url(#bG${gid})"/>

    <!-- Body -->
    <path d="M 6,30 C 4,22 12,17 22,17 C 34,17 38,23 37,31 C 36,38 22,41 10,38 C 6,36 6,33 6,30 Z" fill="url(#bG${gid})"/>

    <!-- Belly highlight -->
    <ellipse cx="22" cy="32" rx="11" ry="5.5" fill="url(#bl${gid})"/>

    <!-- Wing (brighter, NO BLACK SHADOWS) -->
    <ellipse cx="20" cy="27" rx="9" ry="4.2" fill="${body}"/>
    <ellipse cx="20" cy="27" rx="9" ry="4.2" fill="rgba(255,255,255,0.2)"/>
    <ellipse cx="18" cy="25.5" rx="4.5" ry="1.5" fill="#ffffff" opacity="0.4"/>

    <!-- Head -->
    <circle cx="22" cy="14" r="10" fill="url(#hG${gid})"/>

    <!-- Upper beak (SHORTENED: pulled back x coordinates by 5-6 units) -->
    <path d="M 31,14 C 34.5,12 39,13.5 40,15.5 C 40,16.5 37,17.5 31,16.5 Z" fill="url(#kG${gid})"/>
    
    <!-- Lower beak (SHORTENED) -->
    <path d="M 31.5,16.5 C 33.5,16 38,16.5 39,18 C 39,19.5 35,19 31.5,18 Z" fill="url(#kG${gid})"/>
    
    <!-- Beak divider line (SHORTENED) -->
    <path d="M 31.5,16 C 34,16 38,16.5 39.5,17.2" stroke="${body}" stroke-width="0.5" fill="none" stroke-linecap="round"/>

    <!-- Eyelid crease (softer color) -->
    <path d="M 22,9 Q 25.5,8 29,10" stroke="rgba(0,0,0,0.1)" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    
    <!-- Eye (cleaner black) -->
    <circle cx="25.5" cy="12.5" r="3.1" fill="#1e272c"/>
    <circle cx="26.7" cy="11.2" r="1.05" fill="#ffffff"/>
    <circle cx="24.2" cy="14" r="0.48" fill="#ffffff"/>

    <!-- Blush (brighter pink/coral, less muddy) -->
    <ellipse cx="20.5" cy="17" rx="2.8" ry="1.9" fill="#ff7675" opacity="0.8"/>

    <!-- Accessories -->
    ${hatSvg}
  </svg>`;
}

let _duckRaceRunning = false;
let _duckRaceAnimFrame = null;
let _duckRaceDucks = [];
let _duckRaceCurrentClassId = null;
let _duckPendingWinners = [];
let _duckActiveStudents = [];

function renderDuckRaceSection(cls) {
  const container = document.getElementById('duck-race-container');
  if (!container) return;

  if (!isAdmin) { container.innerHTML = ''; return; }
  if (!cls || !cls.students || cls.students.length === 0) { container.innerHTML = ''; return; }

  if (_duckRaceCurrentClassId !== cls.id) {
    _duckRaceCurrentClassId = cls.id;
    _duckPendingWinners = [];
    _duckActiveStudents = [...cls.students];
    if (_duckRaceRunning) { cancelAnimationFrame(_duckRaceAnimFrame); _duckRaceRunning = false; }
  }

  if (_duckRaceRunning) return;

  container.innerHTML = '';

  const section = document.createElement('div');
  section.className = 'wheel-section';

  // 1. Header: 🐤 Race Duck 🐤
  const header = document.createElement('div');
  header.className = 'wheel-header';
  const title = document.createElement('h2');
  title.textContent = '🦆 Race Duck 🦆';
  header.appendChild(title);
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'wheel-body';
  body.style.flexDirection = 'column';
  body.style.gap = '20px';

  // Lake Water Track (Fixed Height: 380px)
  const trackWrapper = document.createElement('div');
  trackWrapper.id = 'duck-lake-track';
  trackWrapper.style.cssText = 'width:100%; height:380px; background: linear-gradient(180deg, #2b7a78 0%, #3aaf9f 30%, #17252a 100%); border-radius:16px; overflow:hidden; border:3px solid #2b7a78; position:relative; box-shadow: inset 0 0 30px rgba(0,0,0,0.3);';

  // Grass banks top & bottom
  const topGrass = document.createElement('div');
  topGrass.style.cssText = 'position:absolute; top:0; left:0; right:0; height:18px; background:#40916c; border-bottom:3px solid #2d6a4f; z-index:3;';
  const bottomGrass = document.createElement('div');
  bottomGrass.style.cssText = 'position:absolute; bottom:0; left:0; right:0; height:18px; background:#40916c; border-top:3px solid #2d6a4f; z-index:3;';
  trackWrapper.appendChild(topGrass);
  trackWrapper.appendChild(bottomGrass);

  // Water ripples background lines
  const ripples = document.createElement('div');
  ripples.style.cssText = 'position:absolute; inset:0; opacity:0.15; background: repeating-linear-gradient(0deg, transparent, transparent 20px, #ffffff 20px, #ffffff 22px); pointer-events:none;';
  trackWrapper.appendChild(ripples);

  // Finish line visual (Checkerboard bar on right edge)
  const finishLine = document.createElement('div');
  finishLine.style.cssText = 'position:absolute; right:70px; top:18px; bottom:18px; width:14px; background:repeating-linear-gradient(180deg,#fff 0,#fff 14px,#000 14px,#000 28px); z-index:5; opacity:0.9; box-shadow:0 0 10px rgba(0,0,0,0.3); pointer-events:none;';
  trackWrapper.appendChild(finishLine);

  const finishLabel = document.createElement('div');
  finishLabel.style.cssText = 'position:absolute; right:25px; top:50%; transform:translateY(-50%); color:white; font-size:0.75rem; font-weight:900; writing-mode:vertical-lr; opacity:0.8; letter-spacing:2px; pointer-events:none;';
  finishLabel.textContent = 'FINISH';
  trackWrapper.appendChild(finishLabel);

  // Start Line visual on left
  const startLine = document.createElement('div');
  startLine.style.cssText = 'position:absolute; left:140px; top:18px; bottom:18px; width:3px; background:rgba(255,255,255,0.4); border-right:2px dashed rgba(255,255,255,0.6); z-index:5; pointer-events:none;';
  trackWrapper.appendChild(startLine);

  // Center Overlay Start Button
  const centerOverlay = document.createElement('div');
  centerOverlay.id = 'duck-center-overlay';
  centerOverlay.style.cssText = 'position:absolute; inset:0; z-index:20; display:flex; align-items:center; justify-content:center; pointer-events:none;';

  const startBtn = document.createElement('button');
  startBtn.id = 'duck-inline-start-btn';
  startBtn.innerHTML = '🚀 BẮT ĐẦU ĐUA';
  startBtn.style.cssText = 'pointer-events:auto; background:linear-gradient(135deg,#FFD700,#FF8C00);color:#1a1a1a;border:none;padding:14px 42px;border-radius:50px;font-size:1.15rem;font-weight:900;cursor:pointer;box-shadow:0 8px 25px rgba(0,0,0,0.4);transition:transform 0.15s, box-shadow 0.15s;letter-spacing:0.5px;';
  startBtn.onmouseover = () => { startBtn.style.transform = 'scale(1.06)'; startBtn.style.boxShadow = '0 10px 30px rgba(255,152,0,0.7)'; };
  startBtn.onmouseout = () => { startBtn.style.transform = 'scale(1)'; startBtn.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)'; };
  startBtn.onclick = () => _startInlineDuckRace(cls);

  centerOverlay.appendChild(startBtn);
  trackWrapper.appendChild(centerOverlay);

  // Duck Lake Arena container
  const lakeArena = document.createElement('div');
  lakeArena.id = 'duck-lake-arena';
  lakeArena.style.cssText = 'position:absolute; inset:18px 0; overflow:hidden;';
  trackWrapper.appendChild(lakeArena);

  // Buttons Row (Shuffle & Reset buttons matching Wheel style)
  const buttonsRow = document.createElement('div');
  buttonsRow.className = 'wheel-buttons';

  const shuffleBtn = document.createElement('button');
  shuffleBtn.className = 'wheel-btn wheel-btn-shuffle';
  shuffleBtn.innerHTML = '<i class="fa-solid fa-random"></i> Shuffle';
  shuffleBtn.onclick = () => {
    if (_duckRaceRunning) return;
    for (let i = _duckActiveStudents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_duckActiveStudents[i], _duckActiveStudents[j]] = [_duckActiveStudents[j], _duckActiveStudents[i]];
    }
    _buildLakeDucks(_duckActiveStudents, lakeArena);
  };

  const resetBtn = document.createElement('button');
  resetBtn.className = 'wheel-btn wheel-btn-reset';
  resetBtn.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> Reset';
  resetBtn.onclick = () => {
    if (_duckRaceRunning) { cancelAnimationFrame(_duckRaceAnimFrame); _duckRaceRunning = false; }
    _duckActiveStudents = [...cls.students];
    _duckPendingWinners = [];
    renderDuckRaceSection(cls);
  };

  buttonsRow.appendChild(shuffleBtn);
  buttonsRow.appendChild(resetBtn);

  // Task Sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'wheel-sidebar';
  sidebar.style.cssText = 'width:100%;';
  const sidebarTitle = document.createElement('h3');
  sidebarTitle.textContent = '🎯 Khu vực nhiệm vụ';
  const pendingList = document.createElement('div');
  pendingList.id = 'duck-pending-list';
  sidebar.appendChild(sidebarTitle);
  sidebar.appendChild(pendingList);

  body.appendChild(trackWrapper);
  body.appendChild(buttonsRow);
  body.appendChild(sidebar);
  section.appendChild(body);
  container.appendChild(section);

  _buildLakeDucks(_duckActiveStudents, lakeArena);
  _renderDuckPending(cls);
}

function _buildLakeDucks(students, arenaEl) {
  arenaEl.innerHTML = '';
  _duckRaceDucks = [];

  if (students.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center; padding:50px; color:#ffffff; font-weight:700; font-size:1.1rem;';
    empty.textContent = 'Tất cả học sinh đã tham gia! Hãy bấm "Reset" để đua lại từ đầu.';
    arenaEl.appendChild(empty);
    return;
  }

  const total = students.length;
  // Calculate vertical height spacing in the lake (total usable height ~320px)
  const availableHeight = 310;
  const stepY = total > 1 ? availableHeight / (total + 1) : availableHeight / 2;

  students.forEach((student, idx) => {
    const skin = DUCK_SKINS[idx % DUCK_SKINS.length];
    
    // Position vertically staggered
    const topY = 10 + (idx + 1) * stepY - 20;

    const duckContainer = document.createElement('div');
    duckContainer.style.cssText = `position:absolute; left:0px; top:${topY}px; width:140px; display:flex; align-items:center; justify-content:flex-end; transition:none; z-index:${Math.floor(topY)};`;

    // Nametag bubble (Speech bubble style)
    const nameBubble = document.createElement('div');
    nameBubble.style.cssText = 'background:#ffffff; color:#1a1a1a; font-weight:800; font-size:0.75rem; padding:3px 8px; border-radius:10px; box-shadow:0 2px 6px rgba(0,0,0,0.3); border:1.5px solid #333; white-space:nowrap; margin-right:4px; flex-shrink:0; pointer-events:none; position:relative;';
    nameBubble.textContent = student.name;

    // Duck Graphic
    const duckGraphic = document.createElement('div');
    duckGraphic.className = 'duck-runner';
    duckGraphic.style.cssText = 'width:42px; height:42px; flex-shrink:0;';
    duckGraphic.innerHTML = getDuckSVG(skin, 42);

    duckContainer.appendChild(nameBubble);
    duckContainer.appendChild(duckGraphic);
    arenaEl.appendChild(duckContainer);

    _duckRaceDucks.push({
      student,
      skin,
      el: duckContainer,
      graphicEl: duckGraphic,
      progress: 0,
      baseY: topY,
      speed: 0,
      waver: 0,
      finished: false
    });
  });
}

function _startInlineDuckRace(cls) {
  if (_duckRaceRunning || _duckRaceDucks.length === 0) return;

  const centerOverlay = document.getElementById('duck-center-overlay');
  if (centerOverlay) centerOverlay.style.display = 'none';

  // Reset positions
  _duckRaceDucks.forEach(d => {
    d.progress = 0; d.maxReachedProgress = 0; d.finished = false; d.speed = 0; d.waver = 0;
    d.el.style.left = '0px';
    d.graphicEl.classList.remove('waddling', 'winner-dance');
  });

  const winnerIdx = Math.floor(Math.random() * _duckRaceDucks.length);
  _runInlineRace(winnerIdx, cls);
}

function _runInlineRace(winnerIdx, cls) {
  _duckRaceRunning = true;

  const TARGET_DURATION_SEC = 8;
  const totalFrames = TARGET_DURATION_SEC * 60; // 480 frames
  let frameCount = 0;
  const FINISH_PERCENT = 100;

  // 🎲 Randomly pick 1 of 8 natural dynamic scenarios per race match:
  // 0: Wire-to-Wire Controlled Lead
  // 1: Mid-Race Surge
  // 2: Chaos & Multi-lead Swap
  // 3: Linear Smooth Pace
  // 4: Final Surge (t^1.18)
  // 5: Duo Photo-Finish Battle (2 con song kè đan xen tiến tới)
  // 6: Tight Pack Sprint (Đàn vịt bơi dính chùm ngang nhau)
  // 7: Precision Late Pass (Núp gió Top 2-3 rồi lướt qua về đích)
  const raceScenario = Math.floor(Math.random() * 8);

  // Pick a rival duck index for Scenario 5 (Duo Battle)
  let rivalIdx = (winnerIdx + 1) % Math.max(1, _duckRaceDucks.length);
  if (_duckRaceDucks.length > 2) {
    rivalIdx = (winnerIdx + 1 + Math.floor(Math.random() * (_duckRaceDucks.length - 1))) % _duckRaceDucks.length;
    if (rivalIdx === winnerIdx) rivalIdx = (winnerIdx + 1) % _duckRaceDucks.length;
  }

  _duckRaceDucks.forEach((d, i) => {
    d.waver = Math.random() * Math.PI * 2;
    d.graphicEl.classList.add('waddling');
    d.burstTime = 0.2 + Math.random() * 0.5;
    d.burstDuration = 0.25;
  });

  let raceWon = false;
  let cachedTrackW = 0;

  const animate = () => {
    if (!_duckRaceRunning) return;

    if (cachedTrackW <= 0) {
      const trackEl = document.getElementById('duck-lake-track');
      const trackWidth = trackEl ? trackEl.offsetWidth : 0;
      if (!trackWidth || trackWidth <= 200) { _duckRaceAnimFrame = requestAnimationFrame(animate); return; }
      cachedTrackW = Math.max(50, trackWidth - 210);
    }

    frameCount++;
    const t = frameCount / totalFrames; // 0.0 to 1.0

    _duckRaceDucks.forEach((d, i) => {
      if (d.finished) return;

      d.waver += 0.12;
      const bobbingY = 3 * Math.cos(d.waver * 1.5);
      const wobble = 0.85 + 0.3 * Math.sin(frameCount * 0.08 + i * 1.7) + 0.1 * (Math.random() - 0.5);

      let targetProgress = 0;

      if (i === winnerIdx) {
        if (raceScenario === 0) {
          const easeT = Math.sin(t * Math.PI * 0.5);
          targetProgress = 100 * Math.pow(easeT, 1.08) + wobble * 1.5;

        } else if (raceScenario === 1) {
          const smoothSurge = t + 0.12 * Math.sin(t * Math.PI * 2);
          targetProgress = 100 * Math.pow(smoothSurge, 1.05) + wobble * 2;

        } else if (raceScenario === 2) {
          const smoothWaver = t + 0.05 * Math.sin(t * Math.PI * 3);
          targetProgress = 100 * Math.pow(smoothWaver, 1.08) + wobble * 2.5;

        } else if (raceScenario === 3) {
          const linearT = t;
          const lateBoost = t > 0.8 ? (t - 0.8) * 0.25 : 0;
          targetProgress = 100 * (linearT + lateBoost) + wobble * 1.8;

        } else if (raceScenario === 4) {
          targetProgress = 100 * Math.pow(t, 1.18) + wobble * 1.5;

        } else if (raceScenario === 5) {
          // 5: Duo Photo-Finish Battle (Winner)
          // Đảm bảo hàm luôn tăng (Monotonic) bằng cách cộng Sine dao động nhỏ vào tiến trình tăng đều t
          const duoWave = Math.sin(t * Math.PI * 3) * 1.8;
          targetProgress = 100 * Math.pow(t, 1.02) + duoWave + wobble * 1.2;

        } else if (raceScenario === 6) {
          // 6: Tight Pack Sprint (Winner) - Cả đàn đi sát nhau, winner chỉ tiến trước 2% ở đoạn cuối
          targetProgress = 100 * Math.pow(t, 1.05) + wobble * 1.5;

        } else {
          // 7: Precision Late Pass (Winner) - Núp gió Top 2-3 đến 75% rồi lướt qua
          const latePassPace = Math.pow(t, 1.12);
          targetProgress = 100 * latePassPace + wobble * 1.5;
        }

      } else {
        // Vịt không thắng
        const rankOffset = (i * 13 + winnerIdx * 7) % 22;
        const maxFinal = 68 + rankOffset * 1.1; // 68-92%

        if (raceScenario === 5 && i === rivalIdx) {
          // 5: Duo Photo-Finish Rival (Đối thủ so kè trực tiếp)
          // Ngược pha nhẹ với winner nhưng ĐẢM BẢO luôn tiến lên trước, chỉ cán đích sau winner 1.5-2.5%
          const rivalWave = -Math.sin(t * Math.PI * 3) * 1.8;
          targetProgress = 98.2 * Math.pow(t, 1.02) + rivalWave + wobble * 1.2;

        } else if (raceScenario === 6) {
          // 6: Tight Pack Sprint (Nhóm vịt bơi dính chùm)
          // Nhóm sau bám sát winner (chỉ kém 2% - 8%)
          const tightPace = Math.pow(t, 1.05);
          const tightFinal = Math.max(90, maxFinal);
          targetProgress = tightFinal * tightPace + wobble * 1.8;

        } else if (raceScenario === 7) {
          // 7: Precision Late Pass (Vịt khác dẫn trước 75% đường)
          if (i === rivalIdx) {
            // Rival dẫn đầu 75% đầu đường đua, sau đó giữ nguyên nhịp 94% để winner lướt qua
            const leadPace = Math.sin(t * Math.PI * 0.5);
            targetProgress = 94 * Math.pow(leadPace, 0.95) + wobble * 1.8;
          } else {
            const smoothLag = Math.sin(t * Math.PI * 0.5);
            targetProgress = maxFinal * Math.pow(smoothLag, 1.05) + wobble * 2.5;
          }

        } else if (raceScenario === 3 || raceScenario === 4) {
          const linearLag = Math.sin(t * Math.PI * 0.5);
          targetProgress = (maxFinal * 0.98) * linearLag + wobble * 1.8;

        } else {
          // Kịch bản 0, 1, 2
          const smoothLag = Math.sin(t * Math.PI * 0.5);
          targetProgress = maxFinal * Math.pow(smoothLag, 1.05) + wobble * 2.5;
        }

        if (t > 0.85) {
          targetProgress = Math.min(targetProgress, 92.8);
        }
      }

      // 🛡️ BẢO VỆ TUYỆT ĐỐI: Đảm bảo vịt CHỈ CÓ ĐI TỚI (Monotonic Forward Motion), không bao giờ lùi pixel nào!
      if (typeof d.maxReachedProgress === 'undefined') d.maxReachedProgress = 0;
      d.progress = Math.max(d.maxReachedProgress, Math.min(FINISH_PERCENT, targetProgress));
      d.maxReachedProgress = d.progress;

      const px = (d.progress / 100) * cachedTrackW;
      const py = d.baseY + bobbingY;

      d.el.style.left = px + 'px';
      d.el.style.top = py + 'px';

      if (!raceWon && i === winnerIdx && (d.progress >= FINISH_PERCENT || frameCount >= totalFrames)) {
        raceWon = true;
        d.finished = true;
        d.progress = FINISH_PERCENT;
        d.el.style.left = (cachedTrackW) + 'px';
        d.graphicEl.classList.remove('waddling');
        d.graphicEl.classList.add('winner-dance');
        _onInlineDuckWin(d, cls);
      }
    });

    if (!raceWon) {
      _duckRaceAnimFrame = requestAnimationFrame(animate);
    } else {
      setTimeout(() => {
        _duckRaceDucks.forEach(d => {
          if (!d.finished) d.graphicEl.classList.remove('waddling');
        });
        _duckRaceRunning = false;
      }, 500);
    }
  };

  _duckRaceAnimFrame = requestAnimationFrame(animate);
}

function _onInlineDuckWin(duck, cls) {
  _duckRaceRunning = false;

  _duckActiveStudents = _duckActiveStudents.filter(s => s.id !== duck.student.id);
  _duckPendingWinners.push(duck.student);

  // Show "Finish / Claim Winner" button in center overlay first so user can inspect the final positions
  const centerOverlay = document.getElementById('duck-center-overlay');
  const startBtn = document.getElementById('duck-inline-start-btn');

  if (centerOverlay && startBtn) {
    centerOverlay.style.display = 'flex';
    startBtn.style.display = 'block';
    startBtn.innerHTML = '🏁 FINISH';
    startBtn.style.background = 'linear-gradient(135deg, #FF416C, #FF4B2B)';
    startBtn.style.boxShadow = '0 8px 25px rgba(255, 75, 43, 0.6)';

    startBtn.onclick = () => {
      // Restore start button style for next race
      startBtn.innerHTML = '🚀 BẮT ĐẦU ĐUA';
      startBtn.style.background = 'linear-gradient(135deg, #FFD700, #FF8C00)';
      startBtn.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)';
      startBtn.onclick = () => _startInlineDuckRace(cls);

      // Trigger the celebration popup!
      _showDuckWinnerModal(duck, cls);
    };
  } else {
    _showDuckWinnerModal(duck, cls);
  }
}

function _showDuckWinnerModal(duck, cls) {
  const modal = document.getElementById('wheel-winner-modal');
  const nameEl = document.getElementById('wheel-winner-name');

  if (modal && nameEl) {
    nameEl.textContent = duck.student.name;
    modal.classList.add('show');
    startConfetti();

    const closeBtn = document.getElementById('winner-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.classList.remove('show');
        stopConfetti();

        const lakeArena = document.getElementById('duck-lake-arena');
        if (lakeArena) _buildLakeDucks(_duckActiveStudents, lakeArena);
        _renderDuckPending(cls);
      };
    }
  } else {
    _renderDuckPending(cls);
    const lakeArena = document.getElementById('duck-lake-arena');
    if (lakeArena) _buildLakeDucks(_duckActiveStudents, lakeArena);
  }
}

function _renderDuckPending(cls) {
  const container = document.getElementById('duck-pending-list');
  if (!container) return;
  container.innerHTML = '';

  if (_duckPendingWinners.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-msg';
    empty.style.cssText = 'text-align:center;color:#94A3B8;font-size:0.95rem;margin-top:10px;';
    empty.textContent = 'Chưa có ai.';
    container.appendChild(empty);
    return;
  }

  _duckPendingWinners.forEach((winner, index) => {
    const card = document.createElement('div');
    card.className = 'pending-winner-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'pending-name';
    nameEl.textContent = winner.name;
    card.appendChild(nameEl);

    const actions = document.createElement('div');
    actions.className = 'pending-actions';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'pending-btn zero';
    btnCancel.textContent = 'Không làm gì';
    btnCancel.onclick = () => {
      _duckPendingWinners.splice(index, 1);
      _renderDuckPending(cls);
    };
    actions.appendChild(btnCancel);

    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement('button');
      btn.className = 'pending-btn';
      btn.textContent = '+' + i;
      btn.onclick = async () => {
        try {
          await doUpdatePoints(cls.id, winner.id, i);
          _duckPendingWinners.splice(index, 1);
          _renderDuckPending(cls);
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
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//  SEATING CHART (SƠ ĐỒ LỚP HỌC)
// ═══════════════════════════════════════════════════════════════════════════
function resetAllSeats(cls) {
  currentChartData.desks.forEach(d => {
    if (d.seats) {
      d.seats.forEach(s => s.studentId = null);
    }
  });
  renderSeatingChart(cls);
}

function randomAssignSeats(cls) {
  const emptySeats = [];
  currentChartData.desks.forEach(d => {
    if (d.type !== 'teacher' && d.seats) {
      d.seats.forEach(s => {
        if (!s.studentId) emptySeats.push(s);
      });
    }
  });

  const assignedIds = new Set();
  currentChartData.desks.forEach(d => (d.seats || []).forEach(s => { if (s.studentId) assignedIds.add(s.studentId); }));
  const unassignedStudents = cls.students.filter(s => !assignedIds.has(s.id));

  if (unassignedStudents.length > emptySeats.length) {
    const missing = unassignedStudents.length - emptySeats.length;
    showError(`Chưa đủ chỗ trống! Thiếu ${missing} chỗ ngồi để xếp toàn bộ học sinh.`);
    return;
  }

  // Shuffle empty seats or students
  const shuffledStudents = [...unassignedStudents].sort(() => Math.random() - 0.5);
  shuffledStudents.forEach((student, index) => {
    emptySeats[index].studentId = student.id;
  });

  renderSeatingChart(cls);
}


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
    x: 60,
    y: 160,
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

  if (!cls.seatingChart) {
    cls.seatingChart = {
      desks: [
        { id: 'desk_teacher', type: 'teacher', label: 'Thầy Việt Anh', x: 280, y: 100, seats: [] }
      ]
    };
  }

  if (!isEditingSeatingChart) {
    currentChartData = JSON.parse(JSON.stringify(cls.seatingChart));
  }

  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'seating-chart-header';
  const title = document.createElement('h3');
  title.textContent = '🗺️ Sơ đồ lớp học';
  header.appendChild(title);

  const controls = document.createElement('div');
  controls.className = 'seating-chart-controls';

  if (isAdmin) {
    if (!isEditingSeatingChart) {
      const editBtn = document.createElement('button');
      editBtn.className = 'seating-btn';
      editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Chỉnh sửa sơ đồ';
      editBtn.onclick = () => { isEditingSeatingChart = true; renderSeatingChart(cls); };
      controls.appendChild(editBtn);
    } else {
      ['Bàn 2 chỗ', 'Bàn 4 chỗ'].forEach((label, i) => {
        const btn = document.createElement('button');
        btn.className = 'seating-btn';
        btn.innerHTML = '<i class="fa-solid fa-plus"></i> ' + label;
        btn.onclick = () => addDesk(i === 0 ? 2 : 4);
        controls.appendChild(btn);
      });

      // Nút Xóa hết chỗ (Reset)
      const resetBtn = document.createElement('button');
      resetBtn.className = 'seating-btn danger';
      resetBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Xóa hết chỗ';
      resetBtn.onclick = () => {
        if (confirm('Bạn có chắc chắn muốn xóa toàn bộ học sinh khỏi sơ đồ?')) {
          resetAllSeats(cls);
        }
      };
      controls.appendChild(resetBtn);

      // Nút Xếp ngẫu nhiên (Random)
      const randomBtn = document.createElement('button');
      randomBtn.className = 'seating-btn warning';
      randomBtn.innerHTML = '<i class="fa-solid fa-shuffle"></i> Xếp ngẫu nhiên';
      randomBtn.onclick = () => randomAssignSeats(cls);
      controls.appendChild(randomBtn);
      
      // Nút Thêm hình ảnh
      const addImgBtn = document.createElement('button');
      addImgBtn.className = 'seating-btn';
      addImgBtn.innerHTML = '<i class="fa-regular fa-image"></i> Thêm ảnh';
      addImgBtn.onclick = async () => {
        const res = await showCustomPrompt('Thêm ảnh trang trí', [
          { key: 'url', label: 'Link ảnh (URL)', type: 'text' }
        ]);
        if (res && res.url) {
          const newImg = {
            id: 'img_' + Date.now(),
            type: 'image',
            url: res.url,
            x: 100,
            y: 100
          };
          currentChartData.desks.push(newImg);
          renderSeatingChart(cls);
        }
      };
      controls.appendChild(addImgBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'seating-btn';
      cancelBtn.innerHTML = 'Hủy';
      cancelBtn.onclick = () => { isEditingSeatingChart = false; renderSeatingChart(cls); };
      controls.appendChild(cancelBtn);

      const saveBtn = document.createElement('button');
      saveBtn.className = 'seating-btn primary';
      saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Lưu sơ đồ';
      saveBtn.onclick = async () => {
        try {
          const res = await api('PATCH', '/api/classes/' + cls.id, { seatingChart: currentChartData });
          cls.seatingChart = res.seatingChart;
          isEditingSeatingChart = false;
          renderSeatingChart(cls);
        } catch (err) { showError('Lỗi lưu sơ đồ: ' + err.message); }
      };
      controls.appendChild(saveBtn);
    }
  }

  header.appendChild(controls);
  container.appendChild(header);

  const layoutWrapper = document.createElement('div');
  layoutWrapper.className = 'seating-layout-wrapper' + (isEditingSeatingChart ? ' editing' : '');

  // Panel học sinh chưa xếp chỗ
  const panel = document.createElement('div');
  panel.className = 'unassigned-students-panel' + (isEditingSeatingChart ? ' active' : '');
  const panelTitle = document.createElement('h4');
  panelTitle.textContent = 'Học sinh chưa xếp chỗ';
  panel.appendChild(panelTitle);

  const assignedIds = new Set();
  currentChartData.desks.forEach(d => (d.seats || []).forEach(s => { if (s.studentId) assignedIds.add(s.studentId); }));
  const unassigned = cls.students.filter(s => !assignedIds.has(s.id));

  if (unassigned.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Tất cả đã có chỗ ✅';
    p.style.cssText = 'font-size:0.82rem;color:#166534;';
    panel.appendChild(p);
  } else {
    unassigned.forEach(s => {
      const item = document.createElement('div');
      item.className = 'unassigned-student-item';
      item.draggable = true;
      const av = document.createElement('div');
      av.className = 'avatar';
      av.textContent = getInitials(s.name);
      av.style.background = getColorForName(s.name);
      item.appendChild(av);
      item.appendChild(document.createTextNode(s.name));
      item.ondragstart = e => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.setData('source', 'panel'); };
      panel.appendChild(item);
    });
  }

  panel.ondragover = e => e.preventDefault();
  panel.ondrop = e => {
    e.preventDefault();
    if (!isEditingSeatingChart) return;
    const sid = e.dataTransfer.getData('text/plain');
    if (sid) {
      currentChartData.desks.forEach(d => (d.seats || []).forEach(seat => { if (seat.studentId === sid) seat.studentId = null; }));
      renderSeatingChart(cls);
    }
  };
  layoutWrapper.appendChild(panel);

  // Canvas
  const canvas = document.createElement('div');
  canvas.className = 'classroom-canvas' + (isEditingSeatingChart ? ' editing-mode' : '');

  // Bảng đen
  const bb = document.createElement('div');
  bb.className = 'blackboard';
  bb.innerHTML = '<span class="bb-text">BẢNG VIẾT</span>';
  canvas.appendChild(bb);

  // Ve ban
  currentChartData.desks.forEach(desk => {
    const seatCount = desk.seats ? desk.seats.length : 0;

    const deskEl = document.createElement('div');
    let deskClass = 'desk';
    if (desk.type === 'teacher') deskClass += ' desk-teacher';
    else if (desk.type === 'image') deskClass = 'decor-image-wrapper';
    else deskClass += ' desk-' + (seatCount === 4 ? '4' : '2');
    if (isEditingSeatingChart) deskClass += ' draggable';
    deskEl.className = deskClass;
    deskEl.style.left = desk.x + 'px';
    deskEl.style.top = desk.y + 'px';
    deskEl.dataset.deskId = desk.id;

    if (desk.type === 'teacher') {
      let tLabel = desk.label || 'Thầy Việt Anh';
      if (tLabel === 'Th. Việt Anh' || tLabel === 'Th. Viet Anh') {
        tLabel = 'Thầy Việt Anh';
      }
      deskEl.innerHTML = '<div class="teacher-desk-icon">💻 📚</div><div class="teacher-desk-name">' + tLabel + '</div>';
    } else if (desk.type === 'image') {
      const img = document.createElement('img');
      img.src = desk.url;
      img.style.width = '120px'; // Kích thước nhỏ nhỏ xinh xinh
      img.style.height = 'auto';
      img.style.borderRadius = '8px';
      img.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
      img.style.display = 'block';
      img.style.pointerEvents = 'none'; // Ngăn việc bị kéo nhầm ảnh thay vì kéo wrapper
      deskEl.appendChild(img);
    } else {
      const is4 = seatCount === 4;
      const sc = document.createElement('div');
      sc.className = 'desk-seats-container' + (is4 ? ' grid-2x2' : '');

      desk.seats.forEach((seat, index) => {
        const seatEl = document.createElement('div');
        seatEl.className = 'seat';

        if (seat.studentId) {
          const student = cls.students.find(s => s.id === seat.studentId);
          if (student) {
            seatEl.classList.add('occupied');
            seatEl.title = student.name;
            const av = document.createElement('div');
            av.className = 'seat-avatar';
            av.textContent = getInitials(student.name);
            av.style.background = getColorForName(student.name);
            seatEl.appendChild(av);
            const nameParts = student.name.trim().split(/\s+/);
            const displayName = nameParts.length > 1 ? nameParts.slice(-2).join(' ') : student.name;
            seatEl.appendChild(document.createTextNode(displayName));
            if (isEditingSeatingChart) {
              seatEl.draggable = true;
              seatEl.ondragstart = e => {
                e.dataTransfer.setData('text/plain', student.id);
                e.dataTransfer.setData('source', 'seat');
                e.dataTransfer.setData('sourceDeskId', desk.id);
                e.dataTransfer.setData('sourceSeatIndex', String(index));
              };

              // Thêm nút xóa học sinh đưa về danh sách
              const removeBtn = document.createElement('button');
              removeBtn.className = 'remove-student-seat-btn';
              removeBtn.innerHTML = '&times;';
              removeBtn.title = 'Xóa khỏi chỗ';
              removeBtn.onclick = (e) => {
                e.stopPropagation();
                seat.studentId = null;
                renderSeatingChart(cls);
              };
              seatEl.appendChild(removeBtn);
            }
          } else {
            seat.studentId = null;
            seatEl.innerHTML = '<div class="empty-seat-circle">+</div><div>Trống</div>';
          }
        } else {
          seatEl.innerHTML = '<div class="empty-seat-circle">+</div><div>Trống</div>';
        }

        if (isEditingSeatingChart) {
          seatEl.ondragover = e => { e.preventDefault(); seatEl.classList.add('drag-over'); };
          seatEl.ondragleave = () => seatEl.classList.remove('drag-over');
          seatEl.ondrop = e => {
            e.preventDefault(); e.stopPropagation();
            seatEl.classList.remove('drag-over');
            const sid = e.dataTransfer.getData('text/plain');
            if (!sid) return;
            const existingSid = seat.studentId;
            currentChartData.desks.forEach(d => (d.seats || []).forEach(s => { if (s.studentId === sid) s.studentId = null; }));
            if (existingSid && e.dataTransfer.getData('source') === 'seat') {
              const srcDesk = currentChartData.desks.find(d => d.id === e.dataTransfer.getData('sourceDeskId'));
              if (srcDesk) srcDesk.seats[parseInt(e.dataTransfer.getData('sourceSeatIndex'), 10)].studentId = existingSid;
            }
            seat.studentId = sid;
            renderSeatingChart(cls);
          };
        }
        sc.appendChild(seatEl);
      });
      deskEl.appendChild(sc);
    }

    if (isEditingSeatingChart) {
      // Keo ban
      let dragging = false, startX, startY, initX, initY;
      deskEl.onmousedown = e => {
        if (e.target.closest('.seat') || e.target.closest('.delete-desk-btn')) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        initX = desk.x; initY = desk.y;
        const onMove = me => {
          if (!dragging) return;
          desk.x = Math.max(0, initX + me.clientX - startX);
          desk.y = Math.max(0, initY + me.clientY - startY);
          deskEl.style.left = desk.x + 'px';
          deskEl.style.top = desk.y + 'px';
        };
        const onUp = () => {
          if (!dragging) return;
          dragging = false;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };
      
      // Delete button
      if (desk.type !== 'teacher') {
        const delBtn = document.createElement('div');
        delBtn.className = 'delete-desk-btn';
        delBtn.innerHTML = '&times;';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          currentChartData.desks = currentChartData.desks.filter(d => d.id !== desk.id);
          renderSeatingChart(cls);
        };
        deskEl.appendChild(delBtn);
      }
    }

    canvas.appendChild(deskEl);
  });

  layoutWrapper.appendChild(canvas);
  container.appendChild(layoutWrapper);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🛡️ Anti-Flicker Optimization for Touch TVs / External Displays
// Dynamically disables heavy backdrop-filter blur during scroll & touch events
// to prevent GPU-bound white screen flashing on external monitors.
// ═══════════════════════════════════════════════════════════════════════════════
(function initAntiFlicker() {
  let scrollTimer = null;
  let touchTimer = null;

  // --- Scroll: disable blur while scrolling ---
  window.addEventListener('scroll', function() {
    if (!document.body.classList.contains('is-scrolling')) {
      document.body.classList.add('is-scrolling');
    }
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      document.body.classList.remove('is-scrolling');
    }, 150); // Re-enable blur 150ms after scroll stops
  }, { passive: true });

  // --- Touch: disable blur while touching ---
  window.addEventListener('touchstart', function() {
    document.body.classList.add('is-touching');
    if (touchTimer) clearTimeout(touchTimer);
  }, { passive: true });

  window.addEventListener('touchmove', function() {
    if (!document.body.classList.contains('is-touching')) {
      document.body.classList.add('is-touching');
    }
    if (touchTimer) clearTimeout(touchTimer);
  }, { passive: true });

  window.addEventListener('touchend', function() {
    if (touchTimer) clearTimeout(touchTimer);
    touchTimer = setTimeout(function() {
      document.body.classList.remove('is-touching');
    }, 200); // Re-enable blur 200ms after touch ends
  }, { passive: true });
})();
