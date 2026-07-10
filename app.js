// Default Mock Data
const defaultData = {
    classes: [
        {
            id: 'c1',
            name: 'Lớp 10A1',
            students: [
                { id: 's1', name: 'Nguyễn Văn A', points: 5 },
                { id: 's2', name: 'Trần Thị B', points: 12 },
                { id: 's3', name: 'Lê Văn C', points: 8 }
            ]
        }
    ]
};

// State
let data = loadData();
let currentClassId = data.classes.length > 0 ? data.classes[0].id : null;
let isAdmin = false;
let isEditingMode = false;

// Theme State
let themeState = loadTheme();

// Title State
let appTitle = localStorage.getItem('classPointsTitle') || ' 🍊 COLLECTED';

// DOM Elements
const classTabsContainer = document.getElementById('class-tabs');
const currentClassNameEl = document.getElementById('current-class-name');
const studentGridEl = document.getElementById('student-grid');
const editModeToggleBtn = document.getElementById('edit-mode-toggle');

// Title Elements
const appMainTitleEl = document.getElementById('app-main-title');
const editTitleBtn = document.getElementById('edit-title-btn');

// Admin Elements
const adminToggleBtn = document.getElementById('admin-toggle');
const passwordModal = document.getElementById('password-modal');
const closeModalBtn = document.getElementById('close-modal');
const adminPasswordInput = document.getElementById('admin-password');
const submitPasswordBtn = document.getElementById('submit-password');
const passwordError = document.getElementById('password-error');
const editClassBtn = document.getElementById('edit-class-btn');
const deleteClassBtn = document.getElementById('delete-class-btn');
const addClassBtn = document.getElementById('add-class-btn');
const addStudentBtn = document.getElementById('add-student-btn');
const classInfoSection = document.querySelector('.class-info');
const excelUploadInput = document.getElementById('excel-upload');

// Theme Elements
const themeBtn = document.getElementById('theme-btn');
const themeModal = document.getElementById('theme-modal');
const closeThemeModalBtn = document.getElementById('close-theme-modal');
const themeOptions = document.querySelectorAll('.theme-option');
const toggleFramesCheckbox = document.getElementById('toggle-frames');
const customBgUpload = document.getElementById('custom-bg-upload');
const clearCustomBgBtn = document.getElementById('clear-custom-bg');

// Table Elements
const conversionHeader = document.getElementById('conversion-header');
const conversionTable = document.getElementById('conversion-table');

// --- Initialization ---
function init() {
    appMainTitleEl.textContent = appTitle;
    renderClassTabs();
    if(currentClassId) {
        renderClass(currentClassId);
    } else {
        showNoClassState();
    }
    updateAdminUI();
    applyTheme();
    
    // Setup listeners
    setupListeners();
}

function loadData() {
    const saved = localStorage.getItem('classPointsData');
    if (saved) return JSON.parse(saved);
    return JSON.parse(JSON.stringify(defaultData));
}

function saveData() {
    localStorage.setItem('classPointsData', JSON.stringify(data));
}

function loadTheme() {
    const saved = localStorage.getItem('classPointsTheme');
    if(saved) return JSON.parse(saved);
    return { name: 'default', useFrames: false, customBg: null };
}

function saveTheme() {
    localStorage.setItem('classPointsTheme', JSON.stringify(themeState));
    applyTheme();
}

// --- Theme Logic ---
function applyTheme() {
    // Apply body class
    document.body.className = `theme-${themeState.name}`;
    
    // Apply frames
    toggleFramesCheckbox.checked = themeState.useFrames;
    if(currentClassId) renderClass(currentClassId); // re-render to apply frame classes to students

    // Apply custom bg
    const appBg = document.getElementById('app-background');
    if (themeState.customBg) {
        appBg.style.backgroundImage = `url(${themeState.customBg})`;
        document.body.classList.add('custom-bg-active');
        clearCustomBgBtn.style.display = 'inline-block';
    } else {
        appBg.style.backgroundImage = '';
        document.body.classList.remove('custom-bg-active');
        clearCustomBgBtn.style.display = 'none';
    }

    // Update modal selection visual
    themeOptions.forEach(opt => {
        if(opt.dataset.theme === themeState.name) opt.classList.add('selected');
        else opt.classList.remove('selected');
    });
}

// --- Render Logic ---
function renderClassTabs() {
    classTabsContainer.innerHTML = '';
    data.classes.forEach(cls => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${cls.id === currentClassId ? 'active' : ''}`;
        btn.textContent = cls.name;
        btn.onclick = () => {
            currentClassId = cls.id;
            updateActiveTab();
            renderClass(currentClassId);
        };
        classTabsContainer.appendChild(btn);
    });
}

function updateActiveTab() {
    const tabs = classTabsContainer.querySelectorAll('.tab-btn');
    tabs.forEach((tab, index) => {
        if (data.classes[index].id === currentClassId) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
}

function showNoClassState() {
    classInfoSection.style.display = 'none';
    studentGridEl.innerHTML = '<p style="text-align:center; width:100%; color:#888;">Chưa có lớp học nào. Hãy tạo một lớp mới!</p>';
    document.getElementById('add-student-container').style.display = 'none';
}

function renderClass(classId) {
    const currentClass = data.classes.find(c => c.id === classId);
    if (!currentClass) {
        showNoClassState();
        return;
    }

    classInfoSection.style.display = 'flex';

    currentClassNameEl.textContent = currentClass.name;

    studentGridEl.innerHTML = '';
    
    if (currentClass.students.length === 0) {
        studentGridEl.innerHTML = '<p style="text-align:center; width:100%; color:#888;">Lớp này chưa có học sinh.</p>';
        return;
    }

    // --- LOGIC TÌM ĐIỂM CAO NHẤT ---
    // Tìm số điểm lớn nhất trong danh sách học sinh của lớp này
    const maxPoints = Math.max(...currentClass.students.map(s => s.points));

    currentClass.students.forEach(student => {
        // Kiểm tra xem học sinh này có đạt điểm cao nhất không (và điểm phải lớn hơn 0)
        const isTopStudent = maxPoints > 0 && student.points === maxPoints;
        
        // Nếu là top 1 thì thêm class 'is-top', ngược lại thì để trống
        const topClass = isTopStudent ? 'is-top' : '';
        // Nếu là top 1 thì hiện vương miện, ngược lại không hiện gì
        const crownIcon = isTopStudent ? '<span class="crown-icon" title="Người cao điểm nhất">👑</span>' : '';

        const card = document.createElement('div');
        // Thêm class topClass vào thẻ card để sau này dễ làm hiệu ứng viền vàng ở CSS
        card.className = `student-card ${themeState.useFrames ? 'with-frame' : ''} ${topClass}`;
        card.innerHTML = `
            <div class="student-name-container">
                ${crownIcon}
                <div class="student-name" id="name-${student.id}">${student.name}</div>
                <button class="action-icon edit-icon admin-edit-only" onclick="editStudentName('${classId}', '${student.id}')" title="Đổi tên"><i class="fa-solid fa-pen"></i></button>
                <button class="action-icon delete-icon admin-edit-only" onclick="deleteStudent('${classId}', '${student.id}')" title="Xóa học sinh"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="points-display" id="points-${student.id}">
                <span class="point-val">${student.points}</span> 🍊
            </div>
            <div class="action-buttons admin-only">
                <button class="btn-action btn-minus" onclick="updatePoints('${classId}', '${student.id}', -1)">-</button>
                <button class="btn-action btn-plus" onclick="updatePoints('${classId}', '${student.id}', 1)">+</button>
            </div>
        `;
        studentGridEl.appendChild(card);
    });
}
// --- Actions ---
window.updatePoints = function(classId, studentId, amount) {
    const currentClass = data.classes.find(c => c.id === classId);
    if (!currentClass) return;
    const student = currentClass.students.find(s => s.id === studentId);
    if (!student) return;
    
    student.points += amount;
    if (student.points < 0) student.points = 0;
    
    saveData();
    renderClass(classId);
    // UI Update
    const pointsDisplay = document.getElementById(`points-${studentId}`);
    if (pointsDisplay) {
        pointsDisplay.querySelector('.point-val').textContent = student.points;
        pointsDisplay.classList.remove('pop');
        void pointsDisplay.offsetWidth; 
        pointsDisplay.classList.add('pop');
    }
};

window.editStudentName = function(classId, studentId) {
    if(!isAdmin) return;
    const currentClass = data.classes.find(c => c.id === classId);
    const student = currentClass.students.find(s => s.id === studentId);
    
    const newName = prompt('Nhập tên mới cho học sinh:', student.name);
    if(newName && newName.trim() !== '') {
        student.name = newName.trim();
        saveData();
        renderClass(classId);
    }
};

window.deleteStudent = function(classId, studentId) {
    if(!isAdmin) return;
    const currentClass = data.classes.find(c => c.id === classId);
    const student = currentClass.students.find(s => s.id === studentId);
    
    if(confirm(`Bạn có chắc chắn muốn xóa học sinh "${student.name}" không?`)) {
        currentClass.students = currentClass.students.filter(s => s.id !== studentId);
        saveData();
        renderClass(classId);
    }
};

function editClassName() {
    if(!isAdmin) return;
    const currentClass = data.classes.find(c => c.id === currentClassId);
    const newName = prompt('Nhập tên mới cho lớp:', currentClass.name);
    if(newName && newName.trim() !== '') {
        currentClass.name = newName.trim();
        saveData();
        renderClassTabs();
        renderClass(currentClassId);
    }
}

function deleteClass() {
    if(!isAdmin) return;
    const currentClass = data.classes.find(c => c.id === currentClassId);
    if(confirm(`Bạn có chắc chắn muốn xóa toàn bộ "${currentClass.name}" không? Thao tác này không thể hoàn tác.`)) {
        data.classes = data.classes.filter(c => c.id !== currentClassId);
        if(data.classes.length > 0) {
            currentClassId = data.classes[0].id;
        } else {
            currentClassId = null;
        }
        saveData();
        renderClassTabs();
        renderClass(currentClassId);
    }
}

function addClass() {
    if(!isAdmin) return;
    const newName = prompt('Nhập tên lớp mới:');
    if(newName && newName.trim() !== '') {
        const newId = 'c' + Date.now();
        data.classes.push({ id: newId, name: newName.trim(), students: [] });
        currentClassId = newId; 
        saveData();
        renderClassTabs();
        renderClass(currentClassId);
    }
}

function addStudent() {
    if(!isAdmin) return;
    const currentClass = data.classes.find(c => c.id === currentClassId);
    const newName = prompt('Nhập tên học sinh mới:');
    if(newName && newName.trim() !== '') {
        const newId = 's' + Date.now();
        currentClass.students.push({ id: newId, name: newName.trim(), points: 0 });
        saveData();
        renderClass(currentClassId);
    }
}

// --- Excel Import Logic ---
function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = evt.target.result;
            const workbook = XLSX.read(data, { type: 'binary' });
            
            // Get first sheet
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convert to JSON
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (json.length > 0) {
                // Find column index for name
                let nameColIdx = -1;
                const headerRow = json[0];
                
                for(let i=0; i<headerRow.length; i++) {
                    const cell = (headerRow[i] || '').toString().toLowerCase();
                    if(cell.includes('tên') || cell.includes('name') || cell.includes('họ và')) {
                        nameColIdx = i;
                        break;
                    }
                }
                
                // fallback to first column if no header found
                if(nameColIdx === -1) nameColIdx = 0;

                const currentClass = window.data.classes.find(c => c.id === currentClassId);
                let addedCount = 0;

                // Loop through rows (skip header)
                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (row[nameColIdx]) {
                        const newName = row[nameColIdx].toString().trim();
                        if (newName) {
                            currentClass.students.push({
                                id: 's' + Date.now() + Math.random().toString(36).substr(2, 5),
                                name: newName,
                                points: 0
                            });
                            addedCount++;
                        }
                    }
                }
                
                saveData();
                renderClass(currentClassId);
                alert(`Đã thêm thành công ${addedCount} học sinh từ file Excel!`);
            } else {
                alert("File Excel trống hoặc không đúng định dạng.");
            }
        } catch(error) {
            console.error(error);
            alert("Đã xảy ra lỗi khi đọc file Excel. Vui lòng kiểm tra lại file.");
        }
    };
    reader.readAsBinaryString(file);
    e.target.value = ''; // reset input
}

// --- Listeners ---
function setupListeners() {
    // Admin Login
    adminToggleBtn.addEventListener('click', () => {
        if(isAdmin) {
            isAdmin = false;
            updateAdminUI();
        } else {
            passwordModal.classList.add('show');
            adminPasswordInput.value = '';
            passwordError.style.display = 'none';
            adminPasswordInput.focus();
        }
    });

    closeModalBtn.addEventListener('click', () => {
        passwordModal.classList.remove('show');
    });

    submitPasswordBtn.addEventListener('click', verifyPassword);
    adminPasswordInput.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') verifyPassword();
    });

    // Theme Modal
    themeBtn.addEventListener('click', () => {
        themeModal.classList.add('show');
    });

    closeThemeModalBtn.addEventListener('click', () => {
        themeModal.classList.remove('show');
    });

    themeOptions.forEach(opt => {
        opt.addEventListener('click', (e) => {
            themeState.name = e.target.dataset.theme;
            saveTheme();
        });
    });

    toggleFramesCheckbox.addEventListener('change', (e) => {
        themeState.useFrames = e.target.checked;
        saveTheme();
    });

    customBgUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                themeState.customBg = evt.target.result;
                saveTheme();
            };
            reader.readAsDataURL(file);
        }
    });

    clearCustomBgBtn.addEventListener('click', () => {
        themeState.customBg = null;
        customBgUpload.value = '';
        saveTheme();
    });

    // Edit Title
    editTitleBtn.addEventListener('click', () => {
        if(!isAdmin) return;
        const newTitle = prompt('Nhập tiêu đề mới:', appTitle);
        if(newTitle && newTitle.trim() !== '') {
            appTitle = newTitle.trim();
            localStorage.setItem('classPointsTitle', appTitle);
            appMainTitleEl.textContent = appTitle;
        }
    });

    // Edit/Delete Class
    editClassBtn.addEventListener('click', editClassName);
    deleteClassBtn.addEventListener('click', deleteClass);
    addClassBtn.addEventListener('click', addClass);

    // Add Student
    addStudentBtn.addEventListener('click', addStudent);
    excelUploadInput.addEventListener('change', handleExcelUpload);

    // Minimize Table
    conversionHeader.addEventListener('click', () => {
        conversionTable.classList.toggle('minimized');
    });
 	// edit
editModeToggleBtn.addEventListener('click', () => {
        if (!isAdmin) return;
        isEditingMode = !isEditingMode;
        updateAdminUI();
        renderClass(currentClassId);
    });

}

function verifyPassword() {
    const pwd = adminPasswordInput.value;
    if(pwd === '712002') { // Default password
        isAdmin = true;
        passwordModal.classList.remove('show');
        updateAdminUI();
    } else {
        passwordError.textContent = 'Mật khẩu không đúng!';
        passwordError.style.display = 'block';
    }
}

function updateAdminUI() {
    if(isAdmin) {
        document.body.classList.add('is-admin');
        adminToggleBtn.classList.add('unlocked');
        adminToggleBtn.innerHTML = '<i class="fa-solid fa-lock-open"></i>';
        
        // Hiển thị nút bật chế độ chỉnh sửa
        editModeToggleBtn.style.display = 'inline-block';
        
        if (isEditingMode) {
            document.body.classList.add('is-editing');
            editModeToggleBtn.innerHTML = '<i class="fa-solid fa-user-gear"></i> Tắt Chỉnh Sửa';
            editModeToggleBtn.style.background = '#ff9800';
            editModeToggleBtn.style.color = 'white';
        } else {
            document.body.classList.remove('is-editing');
            editModeToggleBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Bật Chỉnh Sửa';
            editModeToggleBtn.style.background = 'white';
            editModeToggleBtn.style.color = '#ff9800';
        }
    } else {
        document.body.classList.remove('is-admin');
        document.body.classList.remove('is-editing');
        isEditingMode = false;
        adminToggleBtn.classList.remove('unlocked');
        adminToggleBtn.innerHTML = '<i class="fa-solid fa-lock"></i>';
        editModeToggleBtn.style.display = 'none';
        document.getElementById('add-student-container').style.display = 'none';
    }
}
// Start
init();
