/* ==========================================================================
   STUDYFLOW - APPLICATION LOGIC (FAIL-SAFE REGISTER & LOGIN SYSTEM)
   ========================================================================== */

// --- CẤU HÌNH ĐỒNG BỘ DỮ LIỆU LÊN SERVER (RAILWAY VOLUME /date) ---
const API_BASE = ''; // cùng origin với server Express

// Gửi dữ liệu lên server (dùng chung cho lưu VÀ xóa, vì xóa = lưu lại mảng đã bớt phần tử)
async function syncUserDataToServer(userId, userData) {
    if (!userId) return;
    try {
        await fetch(`${API_BASE}/api/user-data/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
    } catch (err) {
        console.warn('Không thể đồng bộ dữ liệu người dùng lên server (đang offline?):', err);
    }
}

function updateLocalSystemDB(serverData) {
    if (!serverData) return;
    const usersMap = new Map();
    (systemDB.users || []).forEach(u => u && u.userId && usersMap.set(u.userId, u));
    (serverData.users || []).forEach(u => u && u.userId && usersMap.set(u.userId, u));

    const friendshipsMap = new Map();
    (systemDB.friendships || []).forEach(f => f && f.id && friendshipsMap.set(f.id, f));
    (serverData.friendships || []).forEach(f => f && f.id && friendshipsMap.set(f.id, f));

    const groupsMap = new Map();
    (systemDB.groups || []).forEach(g => g && g.id && groupsMap.set(g.id, g));
    (serverData.groups || []).forEach(g => g && g.id && groupsMap.set(g.id, g));

    const messagesMap = new Map();
    (systemDB.messages || []).forEach(m => m && m.id && messagesMap.set(m.id, m));
    (serverData.messages || []).forEach(m => m && m.id && messagesMap.set(m.id, m));

    systemDB.users = Array.from(usersMap.values());
    systemDB.friendships = Array.from(friendshipsMap.values());
    systemDB.groups = Array.from(groupsMap.values());
    systemDB.messages = Array.from(messagesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    localStorage.setItem('studyflow_users_db', JSON.stringify(systemDB.users));
    localStorage.setItem('studyflow_friendships', JSON.stringify(systemDB.friendships));
    localStorage.setItem('studyflow_groups', JSON.stringify(systemDB.groups));
    localStorage.setItem('studyflow_messages', JSON.stringify(systemDB.messages));
}

async function syncSystemDBToServer() {
    try {
        const res = await fetch(`${API_BASE}/api/system-db`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(systemDB)
        });
        if (res.ok) {
            const result = await res.json();
            if (result && result.data) {
                updateLocalSystemDB(result.data);
            }
        }
    } catch (err) {
        console.warn('Không thể đồng bộ system DB lên server (đang offline?):', err);
    }
}

// Xóa hẳn dữ liệu 1 người dùng khỏi server (dùng khi cần xóa toàn bộ tài khoản)
async function deleteUserDataFromServer(userId) {
    if (!userId) return;
    try {
        await fetch(`${API_BASE}/api/user-data/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    } catch (err) {
        console.warn('Không thể xóa dữ liệu người dùng trên server:', err);
    }
}

// Tải toàn bộ system DB từ server (nếu có) để đồng bộ giữa nhiều thiết bị/phiên
async function fetchSystemDBFromServer() {
    try {
        const res = await fetch(`${API_BASE}/api/system-db`);
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn('Không thể tải system DB từ server:', err);
        return null;
    }
}

// Tải dữ liệu 1 người dùng từ server (nếu có)
async function fetchUserDataFromServer(userId) {
    if (!userId) return null;
    try {
        const res = await fetch(`${API_BASE}/api/user-data/${encodeURIComponent(userId)}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn('Không thể tải dữ liệu người dùng từ server:', err);
        return null;
    }
}

// Chuẩn hóa User ID: dùng CHUNG cho đăng ký, đăng nhập, và tìm bạn bè, để đảm bảo
// cùng một ID luôn được so khớp giống hệt nhau ở mọi nơi (trước đây ô tìm bạn không
// lọc ký tự lạ giống lúc đăng ký, nên đôi khi tìm không ra dù tài khoản tồn tại).
function normalizeUserId(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace('@', '')
        .replace(/[^a-z0-9_]/g, '');
}

// --- INITIAL STATE & DATABASE SCHEMAS ---
const DEFAULT_SUBJECTS = [
    { id: 'subj-1', name: 'Toán Học', color: '#6366f1', targetHours: 8 },
    { id: 'subj-2', name: 'Tiếng Anh', color: '#06b6d4', targetHours: 6 },
    { id: 'subj-3', name: 'Văn Học', color: '#ec4899', targetHours: 4 },
    { id: 'subj-4', name: 'Lập Trình', color: '#10b981', targetHours: 10 },
    { id: 'subj-5', name: 'Vật Lý', color: '#f59e0b', targetHours: 5 }
];

function getFormattedDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
}

const DEFAULT_MAILBOX = [
    {
        id: 'mail-welcome',
        title: '🎉 Chào mừng bạn đến với StudyFlow!',
        badgeIcon: '🎓',
        sender: 'Ban Quản Trị StudyFlow',
        date: getFormattedDate(0),
        read: false,
        content: `Chào mừng bạn đã gia nhập StudyFlow! Bạn có thể kết bạn bằng cách nhập User ID và trò chuyện trực tiếp. Lưu ý: Mọi tin nhắn trò chuyện sẽ được hệ thống tự động xóa sạch sau 7 ngày!`
    }
];

function cloneDefaultSubjects() {
    return DEFAULT_SUBJECTS.map(subject => ({ ...subject }));
}

function cloneDefaultMailbox() {
    return DEFAULT_MAILBOX.map(letter => ({ ...letter }));
}

function readLocalJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.warn(`Dữ liệu cục bộ "${key}" bị lỗi và đã được đặt lại.`, error);
        localStorage.removeItem(key);
        return fallback;
    }
}

// Multi-Account & Global System Database
let systemDB = {
    users: readLocalJSON('studyflow_users_db', []),
    friendships: readLocalJSON('studyflow_friendships', []),
    groups: readLocalJSON('studyflow_groups', []),
    messages: readLocalJSON('studyflow_messages', [])
};

// Current Session State
let currentUser = readLocalJSON('studyflow_current_user', null);

let state = {
    tasks: [],
    subjects: cloneDefaultSubjects(),
    mailbox: cloneDefaultMailbox(),
    streak: 1,
    lastCheckinDate: '',
    theme: localStorage.getItem('studyflow_theme') || 'dark',
    currentPeriod: 'week',
    activeChatFriendId: null,
    activeGroupId: null,
    exercises: [],
    vocabulary: []
};

// --- AUTHENTICATION HANDLERS ---

// Early auth handlers removed - using main handlers at line ~500
// Live Study Session Overlay State
let liveStudyState = {
    taskId: null,
    secondsSpent: 0,
    isRunning: false,
    isPaused: false,
    isBreak: false,
    breakSecondsLeft: 0,
    intervalId: null
};

// Pomodoro Timer State
let pomoState = {
    mode: 'work',
    duration: 25 * 60,
    timeLeft: 25 * 60,
    isRunning: false,
    intervalId: null,
    attachedTaskId: null
};

// Chart Instances
let mainChartInstance = null;
let subjectPieChartInstance = null;
let dailyHoursMapChartInstance = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // Tải systemDB (danh sách người dùng, bạn bè, tin nhắn) từ server (volume /date) trước,
    // nếu offline hoặc server chưa có dữ liệu thì dùng bản trong localStorage như cũ.
    // QUAN TRỌNG: KHÔNG được ghi đè thẳng systemDB bằng dữ liệu server, vì nếu server
    // vừa khởi động lại (sau khi deploy/cập nhật code) mà volume chưa kịp sẵn sàng, hoặc
    // có trục trặc mạng tạm thời khiến server trả về danh sách rỗng/thiếu, ghi đè trực
    // tiếp sẽ XÓA SẠCH tài khoản đang có trong trình duyệt (kể cả khi dữ liệu gốc trên
    // volume vẫn còn nguyên). Thay vào đó luôn HỢP NHẤT (merge) 2 bên bằng
    // updateLocalSystemDB() — hàm này giữ lại mọi user/friendship/message ở CẢ HAI phía,
    // không bao giờ làm mất dữ liệu chỉ vì 1 phía tạm thời rỗng.
    const serverSystemDB = await fetchSystemDBFromServer();
    if (serverSystemDB) {
        updateLocalSystemDB(serverSystemDB);

        // Tự "chữa lành": nếu server vừa mất dữ liệu (ví dụ volume bị reset khi deploy)
        // nhưng trình duyệt này vẫn còn cache đầy đủ, đẩy ngay bản đã merge lên lại
        // server để khôi phục volume — tránh việc lần load sau lại bị coi là "mất".
        const localUserCount = (systemDB.users || []).length;
        const serverUserCount = (serverSystemDB.users || []).length;
        if (localUserCount > serverUserCount) {
            syncSystemDBToServer();
        }
    }

    purgeExpiredMessages();
    initTheme();
    initLiveClock();
    initNavigation();
    initMobileSidebar();
    initPeriodSelector();
    initModals();
    initTaskEvents();
    initPomodoro();
    initLiveStudyModal();
    initMailbox();
    initAuthSystem();
    initVocabularySystem();
    // initChatSystem(); // Disabled

    // KIỂM TRA ĐĂNG NHẬP: NẾU CHƯA ĐĂNG NHẬP THÌ HỆ THỐNG BẬT MODAL ĐĂNG NHẬP MẶC ĐỊNH
    if (!currentUser) {
        openAuthModal();
    } else {
        document.getElementById('auth-modal')?.classList.remove('active');
        loadUserData();
    }
});

// XÓA TIN NHẮN TỰ ĐỘNG SAU 7 NGÀY (7-DAY AUTO PURGE)
function purgeExpiredMessages() {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const initialCount = systemDB.messages.length;

    systemDB.messages = systemDB.messages.filter(msg => {
        return (now - msg.timestamp) < SEVEN_DAYS_MS;
    });

    if (systemDB.messages.length !== initialCount) {
        localStorage.setItem('studyflow_messages', JSON.stringify(systemDB.messages));
        syncSystemDBToServer();
    }
}

function saveSystemDB() {
    localStorage.setItem('studyflow_users_db', JSON.stringify(systemDB.users));
    localStorage.setItem('studyflow_friendships', JSON.stringify(systemDB.friendships));
    localStorage.setItem('studyflow_groups', JSON.stringify(systemDB.groups));
    localStorage.setItem('studyflow_messages', JSON.stringify(systemDB.messages));
    syncSystemDBToServer();
}

function saveUserData() {
    if (!currentUser) return;
    const userKey = `studyflow_userdata_${currentUser.userId}`;
    const userData = {
        tasks: state.tasks,
        subjects: state.subjects,
        mailbox: state.mailbox,
        streak: state.streak,
        lastCheckinDate: state.lastCheckinDate,
        exercises: state.exercises,
        vocabulary: state.vocabulary
    };
    localStorage.setItem(userKey, JSON.stringify(userData));
    localStorage.setItem('studyflow_current_user', JSON.stringify(currentUser));

    // Đồng bộ lên server -> lưu vào volume /date. Cũng như saveSystemDB(), hàm này
    // luôn chạy SAU KHI state.tasks/state.subjects/... đã bị filter (xóa), nên
    // dữ liệu gửi lên server luôn khớp với những gì người dùng vừa xóa.
    syncUserDataToServer(currentUser.userId, userData);
}

function loadUserData() {
    if (!currentUser) return;

    const userKey = `studyflow_userdata_${currentUser.userId}`;
    const saved = readLocalJSON(userKey, null);

    if (saved) {
        state.tasks = saved.tasks || [];
        state.subjects = Array.isArray(saved.subjects) && saved.subjects.length
            ? saved.subjects
            : cloneDefaultSubjects();
        state.mailbox = Array.isArray(saved.mailbox)
            ? saved.mailbox
            : cloneDefaultMailbox();
        state.streak = saved.streak || 1;
        state.lastCheckinDate = saved.lastCheckinDate || '';
        state.exercises = saved.exercises || [];
        state.vocabulary = saved.vocabulary || [];
    } else {
        state.tasks = [];
        state.subjects = cloneDefaultSubjects();
        state.mailbox = cloneDefaultMailbox();
        state.streak = 1;
        state.lastCheckinDate = '';
        state.exercises = [];
        state.vocabulary = [];
    }

    const nameEl = document.getElementById('sidebar-user-name');
    const idEl = document.getElementById('sidebar-user-id');
    const avatarEl = document.getElementById('sidebar-user-avatar');
    const greetingTitle = document.getElementById('greeting-title');

    if (nameEl) nameEl.textContent = currentUser.name;
    if (idEl) idEl.textContent = `@${currentUser.userId}`;
    if (avatarEl) avatarEl.textContent = getInitials(currentUser.name);
    if (greetingTitle) greetingTitle.textContent = `Xin chào, ${currentUser.name}! 👋`;

    initDailyCheckin();
    renderDashboard();
    renderTasksPage();
    renderSubjects();
    renderPomodoroTasksDropdown();
    updateMailboxBadge();
    renderFriendsList();
    renderIncomingRequests();
    startContinuousSystemSync();

    // Sau khi hiển thị ngay dữ liệu có sẵn trong localStorage (không bị giật/chờ),
    // thử tải bản mới nhất từ server (volume /date) để đồng bộ giữa các thiết bị.
    refreshUserDataFromServer();
}

async function refreshUserDataFromServer() {
    if (!currentUser) return;
    const serverData = await fetchUserDataFromServer(currentUser.userId);
    if (!serverData) return; // chưa có trên server hoặc đang offline -> giữ nguyên bản local

    // Merge tasks theo ID để đảm bảo 100% không bị mất bài học hay nhiệm vụ học tập
    const tasksMap = new Map();
    (state.tasks || []).forEach(t => t && t.id && tasksMap.set(t.id, t));
    (serverData.tasks || []).forEach(t => t && t.id && tasksMap.set(t.id, t));

    // Merge mailbox theo ID
    const mailboxMap = new Map();
    (state.mailbox || []).forEach(m => m && m.id && mailboxMap.set(m.id, m));
    (serverData.mailbox || []).forEach(m => m && m.id && mailboxMap.set(m.id, m));

    state.tasks = Array.from(tasksMap.values());
    state.subjects = (serverData.subjects && serverData.subjects.length > 0) ? serverData.subjects : state.subjects;
    state.mailbox = Array.from(mailboxMap.values());
    state.streak = Math.max(state.streak || 1, serverData.streak || 1);
    state.lastCheckinDate = serverData.lastCheckinDate || state.lastCheckinDate || '';

    saveUserData();
    renderDashboard();
    renderTasksPage();
    renderSubjects();
    renderPomodoroTasksDropdown();
    updateMailboxBadge();
    renderFriendsList();
}

function getInitials(name) {
    if (!name) return 'US';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

// --- GLOBAL FAIL-SAFE AUTH HANDLERS ---
window.handleUserRegister = async function(e) {
    if (e) e.preventDefault();

    const feedbackEl = document.getElementById('auth-feedback');
    function showFb(msg, isError = true) {
        if (feedbackEl) {
            feedbackEl.className = `auth-feedback-box ${isError ? 'error' : 'success'}`;
            feedbackEl.innerHTML = '';
            const icon = document.createElement('i');
            icon.className = isError ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check';
            feedbackEl.append(icon, document.createTextNode(` ${msg}`));
            feedbackEl.style.display = 'block';
        } else {
            alert(msg);
        }
    }

    const nameInput = document.getElementById('reg-name-input');
    const userIdInput = document.getElementById('reg-userid-input');
    const passInput = document.getElementById('reg-password-input');
    const confirmInput = document.getElementById('reg-confirm-input');

    const name = nameInput ? nameInput.value.trim() : '';
    let rawUserId = normalizeUserId(userIdInput ? userIdInput.value : '');
    const password = passInput ? passInput.value.trim() : '';
    const confirmPassword = confirmInput ? confirmInput.value.trim() : '';

    if (!name) {
        showFb('Vui lòng nhập Họ và Tên của bạn!');
        return false;
    }
    if (!rawUserId) {
        showFb('Vui lòng nhập User ID (ví dụ: tri2026)!');
        return false;
    }
    if (!password) {
        showFb('Vui lòng nhập Mật khẩu!');
        return false;
    }
    if (password.length < 4) {
        showFb('Mật khẩu cần có tối thiểu 4 ký tự!');
        return false;
    }
    if (confirmInput && password !== confirmPassword) {
        showFb('Mật khẩu xác nhận không khớp. Vui lòng kiểm tra lại!');
        return false;
    }

    let newUser;
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, userId: rawUserId, password })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showFb(response.status === 409
                ? `User ID "@${rawUserId}" đã có người đăng ký. Vui lòng chọn User ID khác!`
                : 'Không thể đăng ký lúc này. Vui lòng kiểm tra kết nối và thử lại!');
            return false;
        }
        newUser = result.user;
    } catch (error) {
        showFb('Không thể kết nối máy chủ để đăng ký. Vui lòng thử lại!');
        return false;
    }

    updateLocalSystemDB({ users: [newUser] });
    currentUser = newUser;
    saveUserData();

    showFb(`🎉 Đăng ký thành công! Đã tự động đăng nhập @${rawUserId}`, false);

    const authModal = document.getElementById('auth-modal');
    if (authModal) {
        setTimeout(() => {
            authModal.classList.remove('active');
            loadUserData();
            if (typeof confetti === 'function') confetti({ particleCount: 100, spread: 80 });
        }, 500);
    }
    return false;
};

window.handleUserLogin = async function(e) {
    if (e) e.preventDefault();

    const feedbackEl = document.getElementById('auth-feedback');
    function showFb(msg, isError = true) {
        if (feedbackEl) {
            feedbackEl.className = `auth-feedback-box ${isError ? 'error' : 'success'}`;
            feedbackEl.innerHTML = '';
            const icon = document.createElement('i');
            icon.className = isError ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check';
            feedbackEl.append(icon, document.createTextNode(` ${msg}`));
            feedbackEl.style.display = 'block';
        } else {
            alert(msg);
        }
    }

    const userIdInput = document.getElementById('login-userid-input');
    const passInput = document.getElementById('login-password-input');

    const rawUserId = normalizeUserId(userIdInput ? userIdInput.value : '');
    const password = passInput ? passInput.value.trim() : '';

    if (!rawUserId || !password) {
        showFb('Vui lòng nhập đầy đủ User ID và Mật khẩu!');
        return false;
    }

    let user;
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: rawUserId, password })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            showFb(response.status === 401
                ? 'User ID hoặc Mật khẩu không đúng. Vui lòng thử lại!'
                : 'Không thể đăng nhập lúc này. Vui lòng kiểm tra kết nối!');
            return false;
        }
        user = result.user;
    } catch (error) {
        showFb('Không thể kết nối máy chủ để đăng nhập. Vui lòng thử lại!');
        return false;
    }

    updateLocalSystemDB({ users: [user] });
    currentUser = user;
    localStorage.setItem('studyflow_current_user', JSON.stringify(currentUser));

    showFb(`Đăng nhập thành công! Chào mừng ${user.name}`, false);

    const authModal = document.getElementById('auth-modal');
    if (authModal) {
        setTimeout(() => {
            authModal.classList.remove('active');
            loadUserData();
        }, 400);
    }
    return false;
};

window.switchTab = function(targetTab) {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const sidebar = document.querySelector('.sidebar');

    if (!targetTab) return;

    navItems.forEach(n => {
        if (n.getAttribute('data-tab') === targetTab) {
            n.classList.add('active');
        } else {
            n.classList.remove('active');
        }
    });

    tabContents.forEach(tc => {
        if (tc.id === `tab-${targetTab}`) {
            tc.classList.add('active');
        } else {
            tc.classList.remove('active');
        }
    });

    if (sidebar) {
        sidebar.classList.remove('active');
        sidebar.classList.remove('mobile-open');
    }

    if (targetTab === 'chat') {
        renderGroupsList();
        renderFriendsList();
        renderIncomingRequests();
        renderChatMessages();
    }
};

window.toggleMobileSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('active');
        sidebar.classList.toggle('mobile-open');
    }
};

// --- MOBILE SIDEBAR DRAWER & MAIN NAVIGATION TABS ---
function initNavigation() {
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', (e) => {
            if (e) e.stopPropagation();
            toggleMobileSidebar();
        });
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const targetTab = item.getAttribute('data-tab');
            if (targetTab) {
                switchTab(targetTab);
            }
        });
    });
}

// --- AUTH SYSTEM SWITCH TAB EVENTS ---
function initAuthSystem() {
    const btnShowLogin = document.getElementById('btn-show-login');
    const btnShowReg = document.getElementById('btn-show-register');
    const linkGoRegister = document.getElementById('link-go-register');
    const linkGoLogin = document.getElementById('link-go-login');
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const btnLogout = document.getElementById('btn-logout');
    const feedbackEl = document.getElementById('auth-feedback');
    const subtitleEl = document.getElementById('auth-form-subtitle');

    function switchToLogin() {
        if (feedbackEl) feedbackEl.style.display = 'none';
        btnShowLogin?.classList.add('active');
        btnShowReg?.classList.remove('active');
        if (loginForm) loginForm.style.display = 'block';
        if (regForm) regForm.style.display = 'none';
        if (subtitleEl) subtitleEl.textContent = 'Đăng nhập để tiếp tục học tập';
    }

    function switchToRegister() {
        if (feedbackEl) feedbackEl.style.display = 'none';
        btnShowReg?.classList.add('active');
        btnShowLogin?.classList.remove('active');
        if (regForm) regForm.style.display = 'block';
        if (loginForm) loginForm.style.display = 'none';
        if (subtitleEl) subtitleEl.textContent = 'Tạo tài khoản mới trong vài giây';
    }

    btnShowLogin?.addEventListener('click', (e) => { e.preventDefault(); switchToLogin(); });
    btnShowReg?.addEventListener('click', (e) => { e.preventDefault(); switchToRegister(); });
    linkGoRegister?.addEventListener('click', (e) => { e.preventDefault(); switchToRegister(); });
    linkGoLogin?.addEventListener('click', (e) => { e.preventDefault(); switchToLogin(); });

    // Password Show/Hide Toggle Buttons
    document.querySelectorAll('.btn-toggle-pass').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.getAttribute('data-target');
            const targetInput = document.getElementById(targetId);
            if (!targetInput) return;
            const icon = btn.querySelector('i');
            if (targetInput.type === 'password') {
                targetInput.type = 'text';
                if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
            } else {
                targetInput.type = 'password';
                if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
            }
        });
    });

    if (btnLogout) {
        btnLogout.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            performLogout();
        };
    }
}

function performLogout() {
    saveUserData();
    stopContinuousSystemSync();
    if (socketIO) {
        socketIO.disconnect();
        socketIO = null;
    }
    currentUser = null;
    localStorage.removeItem('studyflow_current_user');

    clearInterval(pomoState.intervalId);
    pomoState.isRunning = false;
    pomoState.intervalId = null;
    pomoState.timeLeft = pomoState.duration;
    clearInterval(liveStudyState.intervalId);
    liveStudyState = {
        taskId: null,
        secondsSpent: 0,
        isRunning: false,
        isPaused: false,
        isBreak: false,
        breakSecondsLeft: 0,
        intervalId: null
    };

    // Xóa dữ liệu đang hiển thị của tài khoản cũ trên thiết bị dùng chung.
    state.tasks = [];
    state.subjects = cloneDefaultSubjects();
    state.mailbox = cloneDefaultMailbox();
    state.streak = 1;
    state.lastCheckinDate = '';
    state.currentPeriod = 'week';
    state.activeChatFriendId = null;
    state.activeGroupId = null;
    state.exercises = [];
    state.vocabulary = [];

    const nameEl = document.getElementById('sidebar-user-name');
    const idEl = document.getElementById('sidebar-user-id');
    const avatarEl = document.getElementById('sidebar-user-avatar');
    const greetingTitle = document.getElementById('greeting-title');
    if (nameEl) nameEl.textContent = 'Chưa Đăng Nhập';
    if (idEl) idEl.textContent = '@guest';
    if (avatarEl) avatarEl.textContent = 'US';
    if (greetingTitle) greetingTitle.textContent = 'Xin chào, Bạn học! 👋';

    document.getElementById('btn-show-login')?.classList.add('active');
    document.getElementById('btn-show-register')?.classList.remove('active');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
    const subtitle = document.getElementById('auth-form-subtitle');
    if (subtitle) subtitle.textContent = 'Đăng nhập để tiếp tục học tập';
    const feedback = document.getElementById('auth-feedback');
    if (feedback) {
        feedback.style.display = 'none';
        feedback.replaceChildren();
    }
    document.querySelectorAll('#auth-modal input').forEach(input => { input.value = ''; });

    renderDashboard();
    renderTasksPage();
    renderSubjects();
    renderPomodoroTasksDropdown();
    updateMailboxBadge();
    updatePendingExerciseCount();
    renderExercises();
    renderVocabTopics();
    updatePomodoroDisplay();

    openAuthModal();
}

function openAuthModal() {
    const authModal = document.getElementById('auth-modal');
    if (authModal) authModal.classList.add('active');
}

// --- CHAT & FRIENDS SYSTEM ---
function initChatSystem() {
    const searchForm = document.getElementById('add-friend-form');
    const sendChatForm = document.getElementById('chat-send-form');

    // Search & Add Friend by User ID
    searchForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) {
            alert('Vui lòng đăng nhập trước khi kết bạn!');
            openAuthModal();
            return;
        }

        const searchId = normalizeUserId(document.getElementById('search-friend-userid').value);
        const resultEl = document.getElementById('add-friend-result-msg');

        if (searchId === currentUser.userId) {
            resultEl.innerHTML = `<span class="text-danger">Bạn không thể kết bạn với chính mình!</span>`;
            return;
        }

        // Tải lại DB mới nhất từ server để đảm bảo không bị thiếu user vừa đăng ký
        const latestServerDB = await fetchSystemDBFromServer();
        if (latestServerDB) {
            updateLocalSystemDB(latestServerDB);
        }

        const targetUser = systemDB.users.find(u => u && u.userId === searchId);
        if (!targetUser) {
            resultEl.innerHTML = `<span class="text-danger">Không tìm thấy người dùng với User ID "@${searchId}"!</span>`;
            return;
        }

        const existingRelation = systemDB.friendships.find(f => 
            (f.user1 === currentUser.userId && f.user2 === targetUser.userId) ||
            (f.user2 === currentUser.userId && f.user1 === targetUser.userId)
        );

        if (existingRelation) {
            if (existingRelation.status === 'accepted') {
                resultEl.innerHTML = `<span class="text-success">Bạn và @${targetUser.userId} đã là bạn bè!</span>`;
                return;
            }
            if (existingRelation.status === 'pending') {
                if (existingRelation.user1 === currentUser.userId) {
                    resultEl.innerHTML = `<span class="text-warning">Đã gửi lời mời tới @${targetUser.userId}, đang chờ chấp nhận!</span>`;
                } else {
                    resultEl.innerHTML = `<span class="text-warning">@${targetUser.userId} đã gửi lời mời kết bạn cho bạn — vào mục "Lời Mời Kết Bạn" bên dưới để chấp nhận!</span>`;
                    renderIncomingRequests();
                }
                return;
            }
            // Trước đó đã từ chối -> cho phép gửi lại lời mời mới
            existingRelation.status = 'pending';
            existingRelation.user1 = currentUser.userId;
            existingRelation.user2 = targetUser.userId;
            existingRelation.requestedAt = Date.now();
            delete existingRelation.respondedAt;

            saveSystemDB();
            if (socketIO) socketIO.emit('add-friendship', existingRelation);

            resultEl.innerHTML = `<span class="text-success">📨 Đã gửi lời mời kết bạn tới ${escapeHTML(targetUser.name)} (@${targetUser.userId})! Đang chờ chấp nhận...</span>`;
            document.getElementById('search-friend-userid').value = '';
            return;
        }

        // Gửi LỜI MỜI kết bạn — CHƯA phải bạn bè ngay. Người nhận (targetUser) phải vào
        // mục "Lời Mời Kết Bạn" và bấm Chấp Nhận thì cả 2 mới chính thức là bạn bè và
        // có thể nhắn tin / gọi cho nhau. Trước đây code tự động đặt status = 'accepted'
        // ngay khi gửi, khiến người gửi coi như đã kết bạn xong còn người nhận không hề
        // hay biết và không thấy gì cả — đây là lỗi đã được sửa.
        const newFriendship = {
            id: 'friend-' + Date.now(),
            user1: currentUser.userId,   // người gửi lời mời
            user2: targetUser.userId,    // người phải chấp nhận
            status: 'pending',
            requestedAt: Date.now()
        };

        systemDB.friendships.push(newFriendship);
        saveSystemDB();

        if (socketIO) {
            socketIO.emit('add-friendship', newFriendship);
        }

        resultEl.innerHTML = `<span class="text-success">📨 Đã gửi lời mời kết bạn tới ${escapeHTML(targetUser.name)} (@${targetUser.userId})! Đang chờ chấp nhận...</span>`;
        document.getElementById('search-friend-userid').value = '';
    });

    // Open & Close Create Group Modal
    addTouchClick(document.getElementById('btn-open-create-group-modal'), () => {
        openCreateGroupModal();
    });

    document.getElementById('btn-close-create-group-modal')?.addEventListener('click', () => {
        document.getElementById('create-group-modal')?.classList.remove('active');
    });

    document.getElementById('btn-cancel-create-group')?.addEventListener('click', () => {
        document.getElementById('create-group-modal')?.classList.remove('active');
    });

    // Create Group Form Submit
    document.getElementById('create-group-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const nameInput = document.getElementById('group-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) return;

        const selectedCheckboxes = document.querySelectorAll('.group-member-checkbox:checked');
        const selectedMemberIds = Array.from(selectedCheckboxes).map(cb => cb.value);

        const newGroup = {
            id: 'group-' + Date.now(),
            name: name,
            avatar: '📚',
            ownerId: currentUser.userId,
            members: [currentUser.userId, ...selectedMemberIds],
            createdAt: Date.now()
        };

        systemDB.groups.push(newGroup);
        saveSystemDB();

        if (socketIO) {
            socketIO.emit('create-group', newGroup);
        }

        document.getElementById('create-group-modal')?.classList.remove('active');
        nameInput.value = '';

        renderGroupsList();
        selectChatGroup(newGroup.id);
        showToastNotification(`🎉 Đã tạo nhóm "${name}" thành công!`, 'success', 'fa-users');
    });

    // Send Direct or Group Message Submit
    sendChatForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentUser) return;
        if (!state.activeChatFriendId && !state.activeGroupId) return;

        const inputEl = document.getElementById('chat-message-input');
        const text = inputEl.value.trim();
        if (!text) return;

        purgeExpiredMessages();

        const newMsg = {
            id: 'msg-' + Date.now(),
            senderId: currentUser.userId,
            senderName: currentUser.name,
            receiverId: state.activeChatFriendId || null,
            groupId: state.activeGroupId || null,
            text: text,
            timestamp: Date.now()
        };

        systemDB.messages.push(newMsg);
        saveSystemDB();

        if (socketIO) {
            socketIO.emit('send-message', newMsg);
        }

        inputEl.value = '';
        renderChatMessages();
    });
}

// --- ĐỒNG BỘ LIÊN TỤC (fallback ngoài Socket.IO) ---
// Socket.IO cho tốc độ tức thời khi cả 2 người đang online cùng lúc, nhưng nếu kết nối
// socket bị rớt/không ổn định (mạng yếu, sleep tab...), vẫn cần 1 lớp bảo hiểm để trạng
// thái kết bạn/tin nhắn luôn được cập nhật đều đặn ở CẢ HAI phía mà không cần bấm gì.
let systemSyncIntervalId = null;
const SYSTEM_SYNC_INTERVAL_MS = 12000; // 12 giây/lần

function startContinuousSystemSync() {
    if (systemSyncIntervalId) return; // đã chạy rồi, tránh tạo trùng interval
    systemSyncIntervalId = setInterval(async () => {
        if (!currentUser) return;
        const previousFriendships = (systemDB.friendships || []).map(f => ({ id: f.id, status: f.status }));

        const latest = await fetchSystemDBFromServer();
        if (!latest) return; // offline tạm thời -> giữ nguyên bản hiện có, thử lại lần sau

        updateLocalSystemDB(latest);
        notifyFriendshipChanges(previousFriendships);
        renderIncomingRequests();
        renderFriendsList();
        renderChatMessages();
    }, SYSTEM_SYNC_INTERVAL_MS);
}

function stopContinuousSystemSync() {
    if (systemSyncIntervalId) {
        clearInterval(systemSyncIntervalId);
        systemSyncIntervalId = null;
    }
}

// --- LỜI MỜI KẾT BẠN: hiển thị, chấp nhận, từ chối ---
function getIncomingFriendRequests() {
    if (!currentUser) return [];
    return systemDB.friendships.filter(f => f && f.status === 'pending' && f.user2 === currentUser.userId);
}

function renderIncomingRequests() {
    const card = document.getElementById('friend-requests-card');
    const listEl = document.getElementById('friend-requests-list');
    if (!card || !listEl || !currentUser) return;

    const requests = getIncomingFriendRequests();

    if (requests.length === 0) {
        card.style.display = 'none';
        listEl.innerHTML = '';
        return;
    }

    card.style.display = 'block';
    listEl.innerHTML = requests.map(f => {
        const sender = systemDB.users.find(u => u && u.userId === f.user1);
        const senderName = sender ? sender.name : f.user1;
        return `
            <div class="friend-request-item">
                <div class="user-avatar-circle">${escapeHTML(getInitials(senderName))}</div>
                <div class="friend-item-info">
                    <div class="friend-item-name">${escapeHTML(senderName)}</div>
                    <div class="user-id-badge">@${f.user1}</div>
                </div>
                <div class="friend-request-actions">
                    <button type="button" class="btn btn-success btn-sm" onclick="acceptFriendRequest('${f.id}')" title="Chấp nhận"><i class="fa-solid fa-check"></i></button>
                    <button type="button" class="btn btn-danger btn-sm" onclick="rejectFriendRequest('${f.id}')" title="Từ chối"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

window.acceptFriendRequest = function(friendshipId) {
    if (!currentUser) return;
    const f = systemDB.friendships.find(x => x && x.id === friendshipId);
    // Chỉ người NHẬN lời mời (user2) mới được chấp nhận
    if (!f || f.user2 !== currentUser.userId || f.status !== 'pending') return;

    f.status = 'accepted';
    f.respondedAt = Date.now();
    saveSystemDB();

    if (socketIO) socketIO.emit('add-friendship', f);

    renderIncomingRequests();
    renderFriendsList();
};

window.rejectFriendRequest = function(friendshipId) {
    if (!currentUser) return;
    const f = systemDB.friendships.find(x => x && x.id === friendshipId);
    if (!f || f.user2 !== currentUser.userId || f.status !== 'pending') return;

    // Không xóa hẳn record (để tránh việc đồng bộ merge làm nó "sống lại" ở phía
    // khác), mà chuyển sang trạng thái 'rejected'. Người gửi có thể gửi lại lời mời
    // mới sau này nếu muốn.
    f.status = 'rejected';
    f.respondedAt = Date.now();
    saveSystemDB();

    if (socketIO) socketIO.emit('add-friendship', f);

    renderIncomingRequests();
};

// So sánh danh sách kết bạn trước/sau khi đồng bộ để báo cho người dùng biết ngay
// (qua Hộp Thư) khi có lời mời mới đến, hoặc khi lời mời mình gửi vừa được chấp nhận —
// giúp cả 2 bên luôn thấy trạng thái mới nhất mà không cần tự tay bấm tìm lại.
function notifyFriendshipChanges(previousFriendships) {
    if (!currentUser) return;
    const beforeMap = new Map((previousFriendships || []).map(f => [f.id, f.status]));

    (systemDB.friendships || []).forEach(f => {
        if (!f || !f.id) return;
        const prevStatus = beforeMap.get(f.id);
        if (prevStatus === f.status) return; // không đổi -> bỏ qua

        if (f.user2 === currentUser.userId && f.status === 'pending') {
            const sender = systemDB.users.find(u => u && u.userId === f.user1);
            addSystemMailboxLetter(
                '🤝 Lời mời kết bạn mới',
                `${sender ? sender.name : '@' + f.user1} vừa gửi cho bạn một lời mời kết bạn. Vào mục "Bạn Bè" để chấp nhận hoặc từ chối nhé!`
            );
        } else if (f.user1 === currentUser.userId && f.status === 'accepted') {
            const target = systemDB.users.find(u => u && u.userId === f.user2);
            addSystemMailboxLetter(
                '🎉 Lời mời kết bạn được chấp nhận!',
                `${target ? target.name : '@' + f.user2} đã chấp nhận lời mời kết bạn của bạn. Giờ hai bạn có thể nhắn tin cho nhau rồi!`
            );
        }
    });
}

function addSystemMailboxLetter(title, content) {
    state.mailbox.unshift({
        id: 'mail-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        title: title,
        badgeIcon: '🤝',
        sender: 'Ban Quản Trị StudyFlow',
        date: getFormattedDate(0),
        read: false,
        content: content
    });
    saveUserData();
    updateMailboxBadge();
}

function openCreateGroupModal() {
    if (!currentUser) return;
    const modal = document.getElementById('create-group-modal');
    const listEl = document.getElementById('group-members-select-list');
    if (!modal || !listEl) return;

    const myFriendships = (systemDB.friendships || []).filter(f => f && 
        ((f.user1 === currentUser.userId || f.user2 === currentUser.userId) && f.status === 'accepted')
    );

    const friendUserIds = myFriendships.map(f => f.user1 === currentUser.userId ? f.user2 : f.user1);
    const friends = (systemDB.users || []).filter(u => u && friendUserIds.includes(u.userId));

    if (friends.length === 0) {
        listEl.innerHTML = `<p class="text-muted text-sm">Chưa có bạn học nào trong danh sách. Hãy kết bạn trước khi tạo nhóm!</p>`;
    } else {
        listEl.innerHTML = friends.map(f => `
            <label class="group-member-checkbox-item">
                <input type="checkbox" class="group-member-checkbox" value="${f.userId}">
                <div class="user-avatar-circle" style="width:28px;height:28px;font-size:12px">${escapeHTML(getInitials(f.name))}</div>
                <span>${escapeHTML(f.name)} (@${f.userId})</span>
            </label>
        `).join('');
    }

    modal.classList.add('active');
}

window.openCreateGroupModal = openCreateGroupModal;

function renderGroupsList() {
    const listContainer = document.getElementById('chat-groups-list');
    if (!listContainer || !currentUser) return;

    const myGroups = (systemDB.groups || []).filter(g => 
        g && g.members && g.members.includes(currentUser.userId)
    );

    if (myGroups.length === 0) {
        listContainer.innerHTML = `
            <div class="p-3 text-center text-muted text-sm">
                Chưa tham gia nhóm nào. Bấm "+ Tạo Nhóm" để tạo nhóm học tập mới!
            </div>
        `;
        return;
    }

    listContainer.innerHTML = myGroups.map(g => `
        <div class="group-item-card ${state.activeGroupId === g.id ? 'active' : ''}" onclick="selectChatGroup('${g.id}')">
            <div class="group-avatar-circle">📚</div>
            <div class="group-item-info">
                <div class="group-item-name">${escapeHTML(g.name)}</div>
                <div class="group-member-count">${g.members.length} thành viên</div>
            </div>
        </div>
    `).join('');
}

window.selectChatGroup = function(groupId) {
    const group = (systemDB.groups || []).find(g => g && g.id === groupId);
    if (!group) return;

    state.activeGroupId = groupId;
    state.activeChatFriendId = null;

    document.getElementById('chat-active-name').textContent = group.name;
    document.getElementById('chat-active-id').textContent = `${group.members.length} thành viên`;
    document.getElementById('chat-active-avatar').textContent = '📚';

    document.getElementById('chat-empty-state').style.display = 'none';
    document.getElementById('chat-input-area').style.display = 'block';

    updateCallButtonsVisibility();
    renderGroupsList();
    renderFriendsList();
    renderChatMessages();
};

function renderFriendsList() {
    const listContainer = document.getElementById('chat-friends-list');
    if (!listContainer || !currentUser) return;

    renderGroupsList();
    renderIncomingRequests();

    const myFriendships = (systemDB.friendships || []).filter(f => f && 
        ((f.user1 === currentUser.userId || f.user2 === currentUser.userId) && f.status === 'accepted')
    );

    const friendUserIds = myFriendships.map(f => f.user1 === currentUser.userId ? f.user2 : f.user1);
    const friends = (systemDB.users || []).filter(u => u && friendUserIds.includes(u.userId));

    if (friends.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-user-group"></i>
                <p>Chưa có bạn học nào. Hãy nhập User ID ở ô trên để kết bạn!</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = friends.map(f => `
        <div class="friend-item-card ${state.activeChatFriendId === f.userId ? 'active' : ''}" onclick="selectChatFriend('${f.userId}')">
            <div class="user-avatar-circle">${escapeHTML(getInitials(f.name))}</div>
            <div class="friend-item-info">
                <div class="friend-item-name">${escapeHTML(f.name)}</div>
                <div class="user-id-badge">@${f.userId}</div>
            </div>
        </div>
    `).join('');
}

window.selectChatFriend = function(friendUserId) {
    const friend = systemDB.users.find(u => u && u.userId === friendUserId);
    if (!friend) return;

    state.activeChatFriendId = friendUserId;
    state.activeGroupId = null;

    document.getElementById('chat-active-name').textContent = friend.name;
    document.getElementById('chat-active-id').textContent = `@${friend.userId}`;
    document.getElementById('chat-active-avatar').textContent = getInitials(friend.name);

    document.getElementById('chat-empty-state').style.display = 'none';
    document.getElementById('chat-input-area').style.display = 'block';

    updateCallButtonsVisibility();
    renderGroupsList();
    renderFriendsList();
    renderChatMessages();
};

function renderChatMessages() {
    const container = document.getElementById('chat-messages-container');
    if (!container || !currentUser || !state.activeChatFriendId) return;

    purgeExpiredMessages();

    const threadMessages = systemDB.messages.filter(m => 
        (m.senderId === currentUser.userId && m.receiverId === state.activeChatFriendId) ||
        (m.senderId === state.activeChatFriendId && m.receiverId === currentUser.userId)
    ).sort((a, b) => a.timestamp - b.timestamp);

    if (threadMessages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-comments"></i>
                <p>Chưa có tin nhắn nào. Hãy gửi lời chào đến bạn học ngay nào!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = threadMessages.map(m => {
        const isSent = m.senderId === currentUser.userId;
        const timeStr = new Date(m.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) +
            ` (${new Date(m.timestamp).toLocaleDateString('vi-VN')})`;

        return `
            <div class="chat-bubble-wrapper ${isSent ? 'sent' : 'received'}">
                <div class="chat-bubble">${escapeHTML(m.text)}</div>
                <div class="chat-timestamp">${timeStr}</div>
            </div>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

// --- THEME MANAGEMENT ---
function initTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const themeCheckbox = document.getElementById('theme-checkbox');
    if (themeCheckbox) {
        themeCheckbox.checked = state.theme === 'dark';
        themeCheckbox.addEventListener('change', (e) => {
            state.theme = e.target.checked ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', state.theme);
            localStorage.setItem('studyflow_theme', state.theme);
            updateChartsTheme();
        });
    }
}

// --- LIVE CLOCK ---
function initLiveClock() {
    function updateClock() {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' };
        const dateStr = now.toLocaleDateString('vi-VN', options);
        
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}:${seconds}`;

        const dateEl = document.getElementById('current-date-text');
        const clockEl = document.getElementById('live-clock-text');

        if (dateEl) dateEl.textContent = dateStr;
        if (clockEl) clockEl.innerHTML = `<i class="fa-regular fa-clock"></i> ${timeStr}`;
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// Mobile Sidebar
function initMobileSidebar() {
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('sidebar');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('mobile-open');
        });

        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('mobile-open') && !sidebar.contains(e.target) && e.target !== toggleBtn) {
                sidebar.classList.remove('mobile-open');
            }
        });
    }
}

// --- NAVIGATION & TABS ---
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-menu .nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const sidebar = document.getElementById('sidebar');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            if (!targetTab) return;
            
            navItems.forEach(nav => nav.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            item.classList.add('active');
            const activeTabEl = document.getElementById(`tab-${targetTab}`);
            if (activeTabEl) activeTabEl.classList.add('active');

            if (sidebar) sidebar.classList.remove('mobile-open');

            if (targetTab === 'dashboard') renderDashboard();
            else if (targetTab === 'tasks') renderTasksPage();
            else if (targetTab === 'subjects') renderSubjects();
            else if (targetTab === 'pomodoro') renderPomodoroTasksDropdown();
            else if (targetTab === 'chat') { renderFriendsList(); renderIncomingRequests(); }
        });
    });

    document.getElementById('btn-view-all-tasks')?.addEventListener('click', () => {
        document.querySelector('.nav-item[data-tab="tasks"]')?.click();
    });
}

// --- PERIOD SELECTOR ---
function initPeriodSelector() {
    const periodBtns = document.querySelectorAll('.period-btn');
    periodBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            periodBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentPeriod = btn.getAttribute('data-period');
            renderDashboard();
        });
    });
}

// --- DASHBOARD RENDER & DYNAMIC STATS ---
function renderDashboard() {
    updatePeriodRangeText();
    calculateAndRenderStats();
    renderDashboardTasksList();
    renderCharts();
}

function updatePeriodRangeText() {
    const rangeEl = document.getElementById('period-range-display');
    const tagEl = document.getElementById('chart-tag-period');
    
    if (state.currentPeriod === 'week') {
        if (rangeEl) rangeEl.textContent = 'Tuần này (7 ngày gần nhất)';
        if (tagEl) tagEl.textContent = 'Theo Tuần';
    } else if (state.currentPeriod === 'month') {
        if (rangeEl) rangeEl.textContent = 'Tháng này (30 ngày gần nhất)';
        if (tagEl) tagEl.textContent = 'Theo Tháng';
    } else if (state.currentPeriod === 'year') {
        if (rangeEl) rangeEl.textContent = 'Năm 2026';
        if (tagEl) tagEl.textContent = 'Theo Năm';
    }
}

function getFilteredTasksByPeriod() {
    const now = new Date();
    return state.tasks.filter(t => {
        if (!t.date) return true;
        const taskDate = new Date(t.date);
        if (state.currentPeriod === 'week') {
            const diffTime = Math.abs(now - taskDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays <= 7;
        } else if (state.currentPeriod === 'month') {
            return taskDate.getMonth() === now.getMonth() && taskDate.getFullYear() === now.getFullYear();
        } else if (state.currentPeriod === 'year') {
            return taskDate.getFullYear() === now.getFullYear();
        }
        return true;
    });
}

function calculateAndRenderStats() {
    const periodTasks = getFilteredTasksByPeriod();
    const totalCount = periodTasks.length;
    const completedCount = periodTasks.filter(t => t.completed).length;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    
    const totalMinutes = periodTasks.reduce((acc, t) => acc + (t.timeSpent || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);

    document.getElementById('stat-completion-rate').textContent = `${completionRate}%`;
    const progressFill = document.getElementById('progress-completion-fill');
    if (progressFill) progressFill.style.width = `${completionRate}%`;

    document.getElementById('stat-tasks-done').textContent = `${completedCount} / ${totalCount}`;
    document.getElementById('stat-tasks-sub').textContent = totalCount === 0 ? 'Chưa có nhiệm vụ nào' : `Còn ${totalCount - completedCount} nhiệm vụ chưa xong`;

    document.getElementById('stat-study-hours').textContent = `${totalHours} Giờ`;
    document.getElementById('stat-streak').textContent = `${state.streak} Ngày`;
    document.getElementById('streak-days-count').textContent = `${state.streak} Ngày`;
    
    const pendingCount = state.tasks.filter(t => !t.completed).length;
    document.getElementById('pending-count-badge').textContent = pendingCount.toString();
}

function renderDashboardTasksList() {
    const container = document.getElementById('dashboard-tasks-list');
    if (!container) return;

    const todayStr = getFormattedDate(0);
    const todayTasks = state.tasks.filter(t => t.date === todayStr);

    if (todayTasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-clipboard-check"></i>
                <p>Chưa có nhiệm vụ nào cho hôm nay. Hãy bấm "Thêm Nhiệm Vụ" để tạo bài học đầu tiên!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = todayTasks.map(t => createTaskItemHTML(t)).join('');
    attachTaskItemEventListeners(container);
}

function createTaskItemHTML(task) {
    const subject = state.subjects.find(s => s.id === task.subjectId) || { name: 'Chung', color: '#6366f1' };
    const subjectColor = safeCssColor(subject.color);
    const priorityLabels = { high: 'Cao 🔥', medium: 'Vừa ⚡', low: 'Thấp 🌱' };
    const formattedDate = task.date ? formatDateVi(task.date) : 'Hôm nay';
    const timeDisplay = task.time ? `🕒 ${task.time}` : '';

    return `
        <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${escapeHTML(task.id)}">
            <label class="checkbox-container">
                <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
                <span class="checkmark"></span>
            </label>
            <div class="task-content">
                <div class="task-title">${escapeHTML(task.title)}</div>
                <div class="task-meta">
                    <span class="subject-badge" style="background-color: ${subjectColor}">
                        ${escapeHTML(subject.name)}
                    </span>
                    <span class="datetime-pill">
                        <i class="fa-regular fa-calendar-days"></i> ${escapeHTML(formattedDate)} ${escapeHTML(timeDisplay)}
                    </span>
                    <span class="priority-tag priority-${task.priority}">
                        ${priorityLabels[task.priority] || 'Vừa'}
                    </span>
                    <span><i class="fa-solid fa-stopwatch"></i> ${Number(task.timeSpent) || 0} phút</span>
                </div>
            </div>
            <div class="task-actions">
                <button class="btn start-live-study-btn" title="Bắt đầu học bài này ngay">
                    <i class="fa-solid fa-play"></i> Vào Học
                </button>
                <button class="icon-btn edit-task-btn" title="Chỉnh sửa"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="icon-btn danger delete-task-btn" title="Xóa"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>
    `;
}

function formatDateVi(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateStr;
}

function attachTaskItemEventListeners(container) {
    container.querySelectorAll('.task-checkbox').forEach(chk => {
        chk.addEventListener('change', (e) => {
            const taskId = e.target.closest('.task-item').getAttribute('data-id');
            toggleTaskComplete(taskId, e.target.checked);
        });
    });

    container.querySelectorAll('.start-live-study-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const taskId = e.target.closest('.task-item').getAttribute('data-id');
            openLiveStudyModal(taskId);
        });
    });

    container.querySelectorAll('.delete-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const taskId = e.target.closest('.task-item').getAttribute('data-id');
            deleteTask(taskId);
        });
    });

    container.querySelectorAll('.edit-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const taskId = e.target.closest('.task-item').getAttribute('data-id');
            openEditTaskModal(taskId);
        });
    });
}

function toggleTaskComplete(taskId, isCompleted) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = isCompleted;
    if (isCompleted) {
        if (typeof confetti === 'function') confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
    }
    saveUserData();
    renderDashboard();
    renderTasksPage();
}

function deleteTask(taskId) {
    if (confirm('Bạn có chắc chắn muốn xóa nhiệm vụ này?')) {
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        saveUserData();
        renderDashboard();
        renderTasksPage();
        renderPomodoroTasksDropdown();
    }
}

// --- LIVE STUDY OVERLAY TIMER LOGIC ---
function initLiveStudyModal() {
    const startBtn = document.getElementById('btn-live-start');
    const pauseBtn = document.getElementById('btn-live-pause');
    const finishBtn = document.getElementById('btn-live-finish');
    const closeBtn = document.getElementById('btn-close-live-study');
    const breakBtns = document.querySelectorAll('.break-btn');

    closeBtn?.addEventListener('click', () => closeLiveStudyModal());
    startBtn?.addEventListener('click', () => startLiveTimer());
    pauseBtn?.addEventListener('click', () => pauseLiveTimer());
    finishBtn?.addEventListener('click', () => finishLiveTimer());

    breakBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mins = parseInt(btn.getAttribute('data-minutes')) || 5;
            startQuickBreak(mins);
        });
    });
}

function openLiveStudyModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const subject = state.subjects.find(s => s.id === task.subjectId) || { name: 'Môn Học', color: '#6366f1' };

    liveStudyState.taskId = taskId;
    liveStudyState.secondsSpent = 0;
    liveStudyState.isRunning = false;
    liveStudyState.isPaused = false;
    liveStudyState.isBreak = false;
    clearInterval(liveStudyState.intervalId);

    document.getElementById('live-study-task-title').textContent = task.title;
    const badgeEl = document.getElementById('live-study-subject-badge');
    if (badgeEl) {
        badgeEl.textContent = subject.name;
        badgeEl.style.backgroundColor = subject.color;
    }

    updateLiveTimerDisplay();
    document.getElementById('live-timer-status').textContent = 'Sẵn sàng bắt đầu phiên học';
    document.getElementById('btn-live-start').style.display = 'inline-flex';
    document.getElementById('btn-live-pause').style.display = 'none';

    document.getElementById('live-study-modal').classList.add('active');
}

function closeLiveStudyModal() {
    if (liveStudyState.isRunning && liveStudyState.secondsSpent > 10) {
        if (!confirm('Phiên học đang diễn ra. Bạn có muốn kết thúc và lưu thời gian học không?')) {
            return;
        }
        finishLiveTimer();
    }
    pauseLiveTimer();
    document.getElementById('live-study-modal').classList.remove('active');
}

function startLiveTimer() {
    if (liveStudyState.isRunning && !liveStudyState.isPaused && !liveStudyState.isBreak) return;

    liveStudyState.isRunning = true;
    liveStudyState.isPaused = false;
    liveStudyState.isBreak = false;

    document.getElementById('btn-live-start').style.display = 'none';
    document.getElementById('btn-live-pause').style.display = 'inline-flex';
    document.getElementById('live-timer-status').textContent = '⚡ Đang trong phiên học tập...';

    clearInterval(liveStudyState.intervalId);
    liveStudyState.intervalId = setInterval(() => {
        liveStudyState.secondsSpent++;
        updateLiveTimerDisplay();
    }, 1000);
}

function pauseLiveTimer() {
    liveStudyState.isPaused = true;
    clearInterval(liveStudyState.intervalId);

    document.getElementById('btn-live-start').style.display = 'inline-flex';
    document.getElementById('btn-live-pause').style.display = 'none';
    document.getElementById('live-timer-status').textContent = '☕ Đã tạm dừng (Việc bận)';
}

function startQuickBreak(minutes) {
    pauseLiveTimer();
    liveStudyState.isBreak = true;
    liveStudyState.breakSecondsLeft = minutes * 60;

    document.getElementById('live-timer-status').textContent = `🏖️ Nghỉ giải lao ${minutes} phút...`;

    clearInterval(liveStudyState.intervalId);
    liveStudyState.intervalId = setInterval(() => {
        if (liveStudyState.breakSecondsLeft > 0) {
            liveStudyState.breakSecondsLeft--;
            const mins = Math.floor(liveStudyState.breakSecondsLeft / 60);
            const secs = liveStudyState.breakSecondsLeft % 60;
            document.getElementById('live-stopwatch-text').textContent = 
                `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        } else {
            clearInterval(liveStudyState.intervalId);
            alert('🔔 Hết thời gian nghỉ! Hãy tiếp tục vào học thôi nào!');
            liveStudyState.isBreak = false;
            updateLiveTimerDisplay();
            document.getElementById('live-timer-status').textContent = 'Đã hết thời gian nghỉ! Nhấn "Bắt đầu" để tiếp tục.';
        }
    }, 1000);
}

function finishLiveTimer() {
    pauseLiveTimer();

    const task = state.tasks.find(t => t.id === liveStudyState.taskId);
    const minutesAdded = Math.max(1, Math.round(liveStudyState.secondsSpent / 60));

    if (task) {
        task.timeSpent = (task.timeSpent || 0) + minutesAdded;

        if (confirm(`🎉 Bạn đã tích lũy thêm ${minutesAdded} phút học bài!\nBạn có muốn đánh dấu bài học này là HOÀN THÀNH không?`)) {
            task.completed = true;
            if (typeof confetti === 'function') confetti();
        }
    }

    saveUserData();
    renderDashboard();
    renderTasksPage();
    document.getElementById('live-study-modal').classList.remove('active');
}

function updateLiveTimerDisplay() {
    const hrs = Math.floor(liveStudyState.secondsSpent / 3600);
    const mins = Math.floor((liveStudyState.secondsSpent % 3600) / 60);
    const secs = liveStudyState.secondsSpent % 60;

    document.getElementById('live-stopwatch-text').textContent = 
        `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// --- DAILY CHECK-IN & STREAK MILESTONES ---
function initDailyCheckin() {
    const btn = document.getElementById('btn-daily-checkin');
    if (!btn) return;

    const todayStr = getFormattedDate(0);
    if (state.lastCheckinDate === todayStr) {
        btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đã Điểm Danh`;
        btn.classList.replace('btn-primary', 'btn-outline');
    }

    btn.onclick = function(e) {
        e.preventDefault();
        performDailyCheckin();
    };
}

function performDailyCheckin() {
    if (!currentUser) {
        alert('Vui lòng đăng nhập để điểm danh hàng ngày!');
        openAuthModal();
        return;
    }

    const todayStr = getFormattedDate(0);
    if (state.lastCheckinDate === todayStr) {
        alert('Bạn đã điểm danh học tập hôm nay rồi! Tiếp tục giữ vững phong độ nhé 🔥');
        return;
    }

    state.lastCheckinDate = todayStr;
    state.streak += 1;
    saveUserData();

    const btn = document.getElementById('btn-daily-checkin');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đã Điểm Danh`;
        btn.classList.replace('btn-primary', 'btn-outline');
    }

    if (typeof confetti === 'function') confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });

    document.getElementById('streak-days-count').textContent = `${state.streak} Ngày`;
    document.getElementById('stat-streak').textContent = `${state.streak} Ngày`;

    checkStreakMilestones(state.streak);
}

function checkStreakMilestones(streak) {
    const isMilestone = (streak === 3 || streak === 10 || streak === 50 || streak === 100 || streak === 150 || streak === 200 || (streak > 200 && (streak - 200) % 50 === 0));

    if (!isMilestone) return;

    let badgeIcon = '🥉';
    let title = `🎉 Vượt mốc Chuỗi Học ${streak} Ngày!`;
    let content = `Chúc mừng bạn học xuất sắc! Bạn đã kiên trì điểm danh và học tập liên tục trong ${streak} ngày. Sự nỗ lực không ngừng nghỉ chính là chìa khóa tới thành công!`;

    if (streak === 3) badgeIcon = '🥉';
    else if (streak === 10) badgeIcon = '🥈';
    else if (streak === 50) badgeIcon = '🥇';
    else if (streak === 100) badgeIcon = '💎';
    else if (streak >= 150) badgeIcon = '👑';

    const newLetter = {
        id: 'mail-' + Date.now(),
        title: title,
        badgeIcon: badgeIcon,
        sender: 'Ban Quản Trị StudyFlow',
        date: getFormattedDate(0),
        read: false,
        content: content
    };

    state.mailbox.unshift(newLetter);
    saveUserData();
    updateMailboxBadge();

    alert(`📩 BẠN CÓ THƯ MỚI!\nChúc mừng bạn đã đạt mốc ${streak} Ngày Chuỗi Học Tập Liên Tục! Vui lòng mở Hộp Thư để nhận phần thưởng danh hiệu.`);
    openMailboxModal();
}

// --- HỘP THƯ CHÚC MỪNG ---
function initMailbox() {
    document.getElementById('btn-open-mailbox')?.addEventListener('click', () => openMailboxModal());
    document.getElementById('btn-close-mailbox')?.addEventListener('click', () => document.getElementById('mailbox-modal').classList.remove('active'));
    document.getElementById('btn-close-letter-detail')?.addEventListener('click', () => document.getElementById('letter-detail-modal').classList.remove('active'));
    document.getElementById('btn-close-letter-confirm')?.addEventListener('click', () => document.getElementById('letter-detail-modal').classList.remove('active'));
}

function updateMailboxBadge() {
    const unreadCount = state.mailbox.filter(m => !m.read).length;
    const badgeEl = document.getElementById('mailbox-unread-count');
    if (badgeEl) {
        badgeEl.textContent = unreadCount.toString();
        badgeEl.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
}

function openMailboxModal() {
    const listContainer = document.getElementById('mailbox-letters-list');
    if (!listContainer) return;

    if (state.mailbox.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-envelope-open"></i>
                <p>Chưa có thư chúc mừng nào trong hộp thư.</p>
            </div>
        `;
    } else {
        listContainer.innerHTML = state.mailbox.map(m => `
            <div class="letter-card ${m.read ? '' : 'unread'}" onclick="viewSingleLetter('${m.id}')">
                <div class="letter-card-icon">${escapeHTML(m.badgeIcon || '✉️')}</div>
                <div class="letter-card-info">
                    <div class="letter-card-title">${escapeHTML(m.title)}</div>
                    <div class="letter-card-snippet">${escapeHTML(m.content)}</div>
                </div>
                <div class="letter-card-date">${escapeHTML(m.date)}</div>
            </div>
        `).join('');
    }

    document.getElementById('mailbox-modal').classList.add('active');
}

window.viewSingleLetter = function(letterId) {
    const letter = state.mailbox.find(m => m.id === letterId);
    if (!letter) return;

    letter.read = true;
    saveUserData();
    updateMailboxBadge();

    document.getElementById('letter-badge-icon').textContent = letter.badgeIcon || '🎖️';
    document.getElementById('letter-detail-title').textContent = letter.title;
    document.getElementById('letter-detail-date').textContent = `Ngày nhận: ${letter.date} | Người gửi: ${letter.sender}`;
    document.getElementById('letter-detail-content').textContent = letter.content;

    document.getElementById('mailbox-modal').classList.remove('active');
    document.getElementById('letter-detail-modal').classList.add('active');

    if (typeof confetti === 'function') confetti({ particleCount: 70, spread: 60 });
};

// --- DYNAMIC CHARTS ---
function renderCharts() {
    renderMainChart();
    renderSubjectPieChart();
    renderDailyHoursMapChart();
}

function renderDailyHoursMapChart() {
    const ctx = document.getElementById('dailyHoursMapChart');
    if (!ctx) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    const todayStr = getFormattedDate(0);
    const todayTasks = state.tasks.filter(t => t.date === todayStr);

    const timeSlots = ['06:00-09:00', '09:00-12:00', '12:00-15:00', '15:00-18:00', '18:00-21:00', '21:00-24:00'];
    const hoursData = [0, 0, 0, 0, 0, 0];

    todayTasks.forEach(t => {
        const timeStr = t.time || '09:00';
        const hour = parseInt(timeStr.split(':')[0]) || 9;
        const hoursSpent = (t.timeSpent || 0) / 60;

        if (hour >= 6 && hour < 9) hoursData[0] += hoursSpent;
        else if (hour >= 9 && hour < 12) hoursData[1] += hoursSpent;
        else if (hour >= 12 && hour < 15) hoursData[2] += hoursSpent;
        else if (hour >= 15 && hour < 18) hoursData[3] += hoursSpent;
        else if (hour >= 18 && hour < 21) hoursData[4] += hoursSpent;
        else hoursData[5] += hoursSpent;
    });

    if (dailyHoursMapChartInstance) dailyHoursMapChartInstance.destroy();

    dailyHoursMapChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeSlots,
            datasets: [{
                label: 'Số giờ học tập thực tế hôm nay (Giờ)',
                data: hoursData.map(v => parseFloat(v.toFixed(1))),
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6, 182, 212, 0.15)',
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor } } },
            scales: {
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
                y: { ticks: { color: textColor }, grid: { color: gridColor }, beginAtZero: true }
            }
        }
    });
}

function renderMainChart() {
    const ctx = document.getElementById('mainProgressChart');
    if (!ctx) return;

    let labels = [];
    let completedData = [];
    let pendingData = [];

    if (state.currentPeriod === 'week') {
        labels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
        for (let i = 6; i >= 0; i--) {
            const dateStr = getFormattedDate(-i);
            const tasksOnDate = state.tasks.filter(t => t.date === dateStr);
            completedData.push(tasksOnDate.filter(t => t.completed).length);
            pendingData.push(tasksOnDate.filter(t => !t.completed).length);
        }
    } else if (state.currentPeriod === 'month') {
        labels = ['Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4'];
        completedData = [0, 0, 0, 0];
        pendingData = [0, 0, 0, 0];

        const now = new Date();
        state.tasks.forEach(t => {
            if (!t.date) return;
            const taskDate = new Date(t.date);
            if (taskDate.getMonth() === now.getMonth() && taskDate.getFullYear() === now.getFullYear()) {
                const day = taskDate.getDate();
                const weekIndex = Math.min(3, Math.floor((day - 1) / 7));
                if (t.completed) completedData[weekIndex]++;
                else pendingData[weekIndex]++;
            }
        });
    } else {
        labels = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
        completedData = new Array(12).fill(0);
        pendingData = new Array(12).fill(0);

        const now = new Date();
        state.tasks.forEach(t => {
            if (!t.date) return;
            const taskDate = new Date(t.date);
            if (taskDate.getFullYear() === now.getFullYear()) {
                const m = taskDate.getMonth();
                if (t.completed) completedData[m]++;
                else pendingData[m]++;
            }
        });
    }

    if (mainChartInstance) mainChartInstance.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    mainChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Đã hoàn thành', data: completedData, backgroundColor: '#6366f1', borderRadius: 6 },
                { label: 'Chưa xong', data: pendingData, backgroundColor: 'rgba(239, 68, 68, 0.4)', borderRadius: 6 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor } } },
            scales: {
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
                y: { ticks: { color: textColor }, grid: { color: gridColor }, beginAtZero: true }
            }
        }
    });
}

function renderSubjectPieChart() {
    const ctx = document.getElementById('subjectPieChart');
    if (!ctx) return;

    const subjectCounts = state.subjects.map(s => {
        return {
            name: s.name,
            color: s.color,
            count: state.tasks.filter(t => t.subjectId === s.id && t.completed).length
        };
    });

    const labels = subjectCounts.map(s => s.name);
    const data = subjectCounts.map(s => s.count);
    const colors = subjectCounts.map(s => s.color);

    const hasData = data.some(c => c > 0);

    if (subjectPieChartInstance) subjectPieChartInstance.destroy();

    subjectPieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: hasData ? labels : ['Chưa có bài học'],
            datasets: [{
                data: hasData ? data : [1],
                backgroundColor: hasData ? colors : ['#334155'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            cutout: '70%'
        }
    });

    const legendContainer = document.getElementById('subject-legend-container');
    if (legendContainer) {
        legendContainer.innerHTML = subjectCounts.map(s => `
            <div class="legend-item">
                <div class="legend-left">
                    <span class="legend-dot" style="background-color: ${safeCssColor(s.color)}"></span>
                    <span>${escapeHTML(s.name)}</span>
                </div>
                <span class="legend-val">${s.count} bài</span>
            </div>
        `).join('');
    }
}

function updateChartsTheme() {
    renderCharts();
}

// --- TASKS PAGE LOGIC ---
function initTaskEvents() {
    const searchInput = document.getElementById('task-search-input');
    const filterStatus = document.getElementById('filter-status');
    const filterSubject = document.getElementById('filter-subject');
    const filterPriority = document.getElementById('filter-priority');

    [searchInput, filterStatus, filterSubject, filterPriority].forEach(el => {
        if (el) el.addEventListener('input', () => renderTasksPage());
    });

    document.getElementById('btn-add-task-modal')?.addEventListener('click', () => openAddTaskModal());
    document.getElementById('btn-quick-add-task')?.addEventListener('click', () => openAddTaskModal());
}

function renderTasksPage() {
    const container = document.getElementById('full-tasks-list');
    if (!container) return;

    const filterSubjectSelect = document.getElementById('filter-subject');
    if (filterSubjectSelect && filterSubjectSelect.children.length <= 1) {
        filterSubjectSelect.innerHTML = '<option value="all">Tất cả môn học</option>' +
            state.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
    }

    const searchText = (document.getElementById('task-search-input')?.value || '').toLowerCase();
    const statusVal = document.getElementById('filter-status')?.value || 'all';
    const subjectVal = document.getElementById('filter-subject')?.value || 'all';
    const priorityVal = document.getElementById('filter-priority')?.value || 'all';

    let filtered = state.tasks.filter(t => {
        const matchesSearch = t.title.toLowerCase().includes(searchText) || (t.notes && t.notes.toLowerCase().includes(searchText));
        const matchesStatus = statusVal === 'all' || (statusVal === 'completed' ? t.completed : !t.completed);
        const matchesSubject = subjectVal === 'all' || t.subjectId === subjectVal;
        const matchesPriority = priorityVal === 'all' || t.priority === priorityVal;
        return matchesSearch && matchesStatus && matchesSubject && matchesPriority;
    });

    document.getElementById('task-summary-counter').textContent = `Hiển thị ${filtered.length} nhiệm vụ`;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-list-check"></i>
                <p>Không có nhiệm vụ học tập nào phù hợp.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(t => createTaskItemHTML(t)).join('');
    attachTaskItemEventListeners(container);
}

// --- MODALS (TASK & SUBJECT) ---
function initModals() {
    const taskModal = document.getElementById('task-modal');
    const subjectModal = document.getElementById('subject-modal');

    document.getElementById('btn-close-task-modal')?.addEventListener('click', () => taskModal.classList.remove('active'));
    document.getElementById('btn-cancel-task-modal')?.addEventListener('click', () => taskModal.classList.remove('active'));

    document.getElementById('btn-close-subject-modal')?.addEventListener('click', () => subjectModal.classList.remove('active'));
    document.getElementById('btn-cancel-subject-modal')?.addEventListener('click', () => subjectModal.classList.remove('active'));
    document.getElementById('btn-add-subject-modal')?.addEventListener('click', () => subjectModal.classList.add('active'));

    document.getElementById('task-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveTaskFromForm();
    });

    document.getElementById('subject-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveSubjectFromForm();
    });
}

function openAddTaskModal() {
    const taskModal = document.getElementById('task-modal');
    document.getElementById('modal-task-title').innerHTML = '<i class="fa-solid fa-square-plus"></i> Thêm Nhiệm Vụ Học Tập Mới';
    document.getElementById('task-id-input').value = '';
    document.getElementById('task-title-input').value = '';
    document.getElementById('task-date-input').value = getFormattedDate(0);
    document.getElementById('task-time-input').value = '09:00';
    document.getElementById('task-notes-input').value = '';

    const subjectSelect = document.getElementById('task-subject-select');
    if (subjectSelect) {
        subjectSelect.innerHTML = state.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
    }

    taskModal.classList.add('active');
}

function openEditTaskModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    openAddTaskModal();
    document.getElementById('modal-task-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Chỉnh Sửa Nhiệm Vụ';
    document.getElementById('task-id-input').value = task.id;
    document.getElementById('task-title-input').value = task.title;
    document.getElementById('task-subject-select').value = task.subjectId;
    document.getElementById('task-priority-select').value = task.priority;
    document.getElementById('task-date-input').value = task.date || getFormattedDate(0);
    document.getElementById('task-time-input').value = task.time || '09:00';
    document.getElementById('task-notes-input').value = task.notes || '';
}

function saveTaskFromForm() {
    const id = document.getElementById('task-id-input').value;
    const title = document.getElementById('task-title-input').value.trim();
    const subjectId = document.getElementById('task-subject-select').value;
    const priority = document.getElementById('task-priority-select').value;
    const date = document.getElementById('task-date-input').value || getFormattedDate(0);
    const time = document.getElementById('task-time-input').value || '09:00';
    const notes = document.getElementById('task-notes-input').value.trim();

    if (!title) return;

    if (id) {
        const task = state.tasks.find(t => t.id === id);
        if (task) {
            task.title = title;
            task.subjectId = subjectId;
            task.priority = priority;
            task.date = date;
            task.time = time;
            task.notes = notes;
        }
    } else {
        const newTask = {
            id: 'task-' + Date.now(),
            title: title,
            subjectId: subjectId,
            priority: priority,
            date: date,
            time: time,
            timeSpent: 0,
            completed: false,
            notes: notes
        };
        state.tasks.unshift(newTask);
    }

    saveUserData();
    document.getElementById('task-modal').classList.remove('active');
    renderDashboard();
    renderTasksPage();
    renderPomodoroTasksDropdown();
}

function saveSubjectFromForm() {
    const name = document.getElementById('subject-name-input').value.trim();
    const color = document.getElementById('subject-color-input').value;
    const targetHours = parseInt(document.getElementById('subject-target-input').value) || 5;

    if (!name) return;

    const newSubject = {
        id: 'subj-' + Date.now(),
        name: name,
        color: color,
        targetHours: targetHours
    };

    state.subjects.push(newSubject);
    saveUserData();
    document.getElementById('subject-modal').classList.remove('active');
    renderSubjects();
    renderDashboard();
}

// --- SUBJECTS TAB ---
function renderSubjects() {
    const container = document.getElementById('subjects-cards-container');
    if (!container) return;

    container.innerHTML = state.subjects.map(s => {
        const subjectTasks = state.tasks.filter(t => t.subjectId === s.id);
        const completedTasks = subjectTasks.filter(t => t.completed).length;
        const totalMinutes = subjectTasks.reduce((sum, t) => sum + (t.timeSpent || 0), 0);
        const totalHours = (totalMinutes / 60).toFixed(1);

        return `
            <div class="subject-card">
                <div class="subject-card-top">
                    <span class="subject-badge-large" style="background-color: ${safeCssColor(s.color)}">
                        <i class="fa-solid fa-book-open"></i> ${escapeHTML(s.name)}
                    </span>
                    <button class="icon-btn danger" onclick="deleteSubject('${s.id}')" title="Xóa môn"><i class="fa-solid fa-trash-can"></i></button>
                </div>
                <div class="subject-stats-row">
                    <span><i class="fa-solid fa-check"></i> Hoàn thành:</span>
                    <strong>${completedTasks} / ${subjectTasks.length} bài</strong>
                </div>
                <div class="subject-stats-row">
                    <span><i class="fa-solid fa-clock"></i> Thời gian học:</span>
                    <strong>${totalHours} / ${s.targetHours} Giờ</strong>
                </div>
            </div>
        `;
    }).join('');
}

window.deleteSubject = function(subjectId) {
    if (state.subjects.length <= 1) {
        alert('Bạn cần giữ lại ít nhất 1 môn học!');
        return;
    }
    if (confirm('Bạn có chắc chắn muốn xóa môn học này?')) {
        state.subjects = state.subjects.filter(s => s.id !== subjectId);
        saveUserData();
        renderSubjects();
        renderDashboard();
    }
};

// --- POMODORO TIMER ---
function initPomodoro() {
    const startBtn = document.getElementById('pomo-start-btn');
    const pauseBtn = document.getElementById('pomo-pause-btn');
    const resetBtn = document.getElementById('pomo-reset-btn');
    const modeBtns = document.querySelectorAll('.pomo-mode-btn');

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setPomodoroMode(btn.getAttribute('data-mode'));
        });
    });

    startBtn?.addEventListener('click', startPomodoro);
    pauseBtn?.addEventListener('click', pausePomodoro);
    resetBtn?.addEventListener('click', resetPomodoro);

    document.getElementById('pomo-task-select')?.addEventListener('change', (e) => {
        pomoState.attachedTaskId = e.target.value;
    });
}

function setPomodoroMode(mode) {
    pomoState.mode = mode;
    pausePomodoro();

    if (mode === 'work') pomoState.duration = 25 * 60;
    else if (mode === 'shortBreak') pomoState.duration = 5 * 60;
    else if (mode === 'longBreak') pomoState.duration = 15 * 60;

    pomoState.timeLeft = pomoState.duration;
    updatePomodoroDisplay();
}

function startPomodoro() {
    if (pomoState.isRunning) return;
    pomoState.isRunning = true;
    document.getElementById('pomo-start-btn').style.display = 'none';
    document.getElementById('pomo-pause-btn').style.display = 'inline-flex';
    document.getElementById('pomo-status-label').textContent = pomoState.mode === 'work' ? 'Đang tập trung học tập...' : 'Đang thời gian nghỉ ngơi...';

    pomoState.intervalId = setInterval(() => {
        if (pomoState.timeLeft > 0) {
            pomoState.timeLeft--;
            updatePomodoroDisplay();

            if (pomoState.mode === 'work' && pomoState.attachedTaskId && pomoState.timeLeft % 60 === 0) {
                const task = state.tasks.find(t => t.id === pomoState.attachedTaskId);
                if (task) {
                    task.timeSpent = (task.timeSpent || 0) + 1;
                    saveUserData();
                    renderDashboard();
                }
            }
        } else {
            pausePomodoro();
            alert('🎉 Đã hết thời gian! Hãy nghỉ ngơi hoặc bắt đầu phiên mới.');
            if (typeof confetti === 'function') confetti();
        }
    }, 1000);
}

function pausePomodoro() {
    pomoState.isRunning = false;
    clearInterval(pomoState.intervalId);
    document.getElementById('pomo-start-btn').style.display = 'inline-flex';
    document.getElementById('pomo-pause-btn').style.display = 'none';
    document.getElementById('pomo-status-label').textContent = 'Đã tạm dừng';
}

function resetPomodoro() {
    pausePomodoro();
    pomoState.timeLeft = pomoState.duration;
    updatePomodoroDisplay();
    document.getElementById('pomo-status-label').textContent = 'Hãy sẵn sàng học tập!';
}

function updatePomodoroDisplay() {
    const mins = Math.floor(pomoState.timeLeft / 60);
    const secs = pomoState.timeLeft % 60;
    
    document.getElementById('pomo-minutes').textContent = mins.toString().padStart(2, '0');
    document.getElementById('pomo-seconds').textContent = secs.toString().padStart(2, '0');

    const circle = document.getElementById('pomo-progress-ring');
    if (circle) {
        const radius = circle.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (pomoState.timeLeft / pomoState.duration) * circumference;
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        circle.style.strokeDashoffset = offset;
    }
}

function renderPomodoroTasksDropdown() {
    const select = document.getElementById('pomo-task-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- Chọn nhiệm vụ để tính giờ --</option>' +
        state.tasks.filter(t => !t.completed).map(t => `<option value="${t.id}">${escapeHTML(t.title)}</option>`).join('');
}

// Utility: Escape HTML
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function safeCssColor(value, fallback = '#6366f1') {
    const color = String(value || '');
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

/* ==========================================================================
   VIDEO / AUDIO CALL SYSTEM (Socket.IO + PeerJS WebRTC)
   ========================================================================== */

let socketIO = null;       // Socket.IO connection
let myPeer = null;         // PeerJS instance
let localStream = null;    // MediaStream (camera + mic) bản thân
let currentCallPeer = null; // PeerJS call connection hiện tại
let onlineUsersList = [];  // Danh sách userId đang online

let callState = {
    inCall: false,
    callType: null,         // 'video' | 'audio'
    partnerId: null,        // userId của đối phương
    partnerName: null,
    isMicOn: true,
    isCamOn: true,
    callTimerSeconds: 0,
    callTimerInterval: null,
    incomingCallData: null,  // Dữ liệu cuộc gọi đến đang chờ
    ringtoneAudio: null
};

// --- KHỞI TẠO HỆ THỐNG GỌI ĐIỆN ---
function initCallSystem() {
    if (!currentUser) return;

    // Kết nối Socket.IO
    socketIO = io(window.location.origin);

    // Đăng ký user online
    socketIO.emit('user-online', currentUser.userId);

    // Lắng nghe danh sách online
    socketIO.on('online-users', (users) => {
        onlineUsersList = users || [];
        updateFriendsOnlineStatus();
        updateCallButtonsVisibility();
    });

    // Lắng nghe đồng bộ DB hệ thống real-time (tin nhắn mới, lời mời kết bạn mới,
    // lời mời được chấp nhận...). Đây là kênh cập nhật NGAY LẬP TỨC cho cả 2 phía khi
    // đang online cùng lúc; startContinuousSystemSync() ở trên là lớp dự phòng chạy định
    // kỳ phòng khi socket bị rớt kết nối.
    socketIO.on('system-db-updated', (updatedData) => {
        if (updatedData) {
            const previousFriendships = (systemDB.friendships || []).map(f => ({ id: f.id, status: f.status }));
            updateLocalSystemDB(updatedData);
            notifyFriendshipChanges(previousFriendships);
            renderIncomingRequests();
            renderFriendsList();
            renderChatMessages();
        }
    });

    // Yêu cầu danh sách online hiện tại
    socketIO.emit('get-online-users');

    // Lắng nghe cuộc gọi đến
    socketIO.on('incoming-call', (data) => {
        handleIncomingCall(data);
    });

    // Cuộc gọi được chấp nhận
    socketIO.on('call-accepted', (data) => {
        handleCallAccepted(data);
    });

    // Cuộc gọi bị từ chối
    socketIO.on('call-rejected', (data) => {
        handleCallRejected(data);
    });

    // Cuộc gọi kết thúc bởi đối phương
    socketIO.on('call-ended', (data) => {
        handleCallEnded(data);
    });

    // Gọi thất bại (user offline)
    socketIO.on('call-failed', (data) => {
        handleCallFailed(data);
    });

    // Remote bật/tắt camera
    socketIO.on('remote-toggle-camera', (data) => {
        const remoteOff = document.getElementById('remote-video-off');
        if (remoteOff) {
            if (data.cameraOn) {
                remoteOff.classList.add('hidden');
            } else {
                remoteOff.classList.remove('hidden');
            }
        }
    });

    // Khởi tạo PeerJS (sử dụng public PeerJS cloud server)
    initPeerJS();

    // Bind các nút call
    bindCallButtons();
}

function initPeerJS() {
    if (!currentUser) return;

    // Cấu hình máy chủ STUN/TURN truyền tín hiệu qua 4G/5G/Firewall
    const peerConfig = {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    };

    const peerId = 'studyflow-' + currentUser.userId;

    if (myPeer) {
        try { myPeer.destroy(); } catch (e) {}
    }

    myPeer = new Peer(peerId, peerConfig);

    myPeer.on('open', (id) => {
        console.log('[PeerJS] Đã kết nối, Peer ID:', id);
    });

    // Nhận cuộc gọi PeerJS đến (Receiver tự động trả lời stream khi nhận call)
    myPeer.on('call', (call) => {
        console.log('[PeerJS] Receiver nhận cuộc gọi peer...');
        if (localStream) {
            call.answer(localStream);
            currentCallPeer = call;
            setupCallPeerEvents(call);
        } else {
            navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(stream => {
                localStream = stream;
                call.answer(localStream);
                currentCallPeer = call;
                setupCallPeerEvents(call);
            }).catch(err => {
                console.error('[PeerJS] Lỗi lấy localStream answer:', err);
            });
        }
    });

    myPeer.on('error', (err) => {
        console.error('[PeerJS] Lỗi Peer connection:', err);
    });
}

function addTouchClick(el, callback) {
    if (!el) return;
    let handled = false;
    el.addEventListener('pointerdown', (e) => {
        handled = true;
        callback(e);
    });
    el.addEventListener('click', (e) => {
        if (!handled) {
            callback(e);
        }
        handled = false;
    });
}

function bindCallButtons() {
    // Nút gọi thoại
    addTouchClick(document.getElementById('btn-audio-call'), () => {
        if (!state.activeChatFriendId) return;
        initiateCall('audio');
    });

    // Nút gọi video
    addTouchClick(document.getElementById('btn-video-call'), () => {
        if (!state.activeChatFriendId) return;
        initiateCall('video');
    });

    // Nút tắt mic
    addTouchClick(document.getElementById('btn-toggle-mic'), (e) => {
        if (e) e.stopPropagation();
        toggleMicrophone();
    });

    // Nút tắt cam
    addTouchClick(document.getElementById('btn-toggle-camera'), (e) => {
        if (e) e.stopPropagation();
        toggleCamera();
    });

    // Nút đổi màn hình lớn/nhỏ (Swap View)
    addTouchClick(document.getElementById('btn-swap-view'), (e) => {
        if (e) e.stopPropagation();
        toggleSwapView();
    });

    // Nút chia đôi màn hình 50/50 (Messenger Style)
    addTouchClick(document.getElementById('btn-toggle-layout'), (e) => {
        if (e) e.stopPropagation();
        toggleSplitLayout();
    });

    // Bấm vào khung nhỏ (PiP) để đổi vị trí màn hình bản thân <-> người kia
    addTouchClick(document.getElementById('local-video-pip'), (e) => {
        if (e) e.stopPropagation();
        toggleSwapView();
    });

    // Nút kết thúc cuộc gọi
    addTouchClick(document.getElementById('btn-end-call'), (e) => {
        if (e) e.stopPropagation();
        endCall(true);
    });

    // Nút chấp nhận cuộc gọi đến
    addTouchClick(document.getElementById('btn-accept-call'), () => {
        acceptIncomingCall();
    });

    // Nút từ chối cuộc gọi đến
    addTouchClick(document.getElementById('btn-reject-call'), () => {
        rejectIncomingCall();
    });
}

// Chuyển đổi màn hình lớn / nhỏ giữa bản thân & đối phương
function toggleSwapView() {
    const overlay = document.getElementById('call-screen-overlay');
    if (!overlay) return;
    overlay.classList.toggle('swapped-view');
}

// Chuyển đổi chế độ chia đôi 50/50 (Messenger Call Style)
function toggleSplitLayout() {
    const overlay = document.getElementById('call-screen-overlay');
    const btn = document.getElementById('btn-toggle-layout');
    if (!overlay) return;
    
    overlay.classList.toggle('split-view-mode');
    if (btn) {
        if (overlay.classList.contains('split-view-mode')) {
            btn.classList.add('active-btn');
        } else {
            btn.classList.remove('active-btn');
        }
    }
}

// --- CẬP NHẬT TRẠNG THÁI ONLINE TRÊN DANH SÁCH BẠN BÈ ---
function updateFriendsOnlineStatus() {
    const friendItems = document.querySelectorAll('.friend-item-card');
    friendItems.forEach(item => {
        const onclickAttr = item.getAttribute('onclick') || '';
        const match = onclickAttr.match(/selectChatFriend\('(.+?)'\)/);
        if (!match) return;
        const friendId = match[1];

        // Thêm hoặc cập nhật chấm online
        let dot = item.querySelector('.online-status-dot');
        if (!dot) {
            dot = document.createElement('div');
            dot.className = 'online-status-dot';
            item.appendChild(dot);
        }

        if (onlineUsersList.includes(friendId)) {
            dot.classList.add('online');
        } else {
            dot.classList.remove('online');
        }
    });
}

// --- HIỆN/ẨN NÚT GỌI TRONG CHAT HEADER ---
function updateCallButtonsVisibility() {
    const audioBtn = document.getElementById('btn-audio-call');
    const videoBtn = document.getElementById('btn-video-call');

    if (!audioBtn || !videoBtn) return;

    if ((state.activeChatFriendId && onlineUsersList.includes(state.activeChatFriendId)) || state.activeGroupId) {
        audioBtn.style.display = 'flex';
        videoBtn.style.display = 'flex';
    } else {
        audioBtn.style.display = 'none';
        videoBtn.style.display = 'none';
    }
}

// --- BẮT ĐẦU GỌI (CALLER) ---
async function initiateCall(callType) {
    if (callState.inCall) {
        alert('Bạn đang trong một cuộc gọi khác!');
        return;
    }

    // GỌI NHÓM HỌC TẬP
    if (state.activeGroupId) {
        const group = (systemDB.groups || []).find(g => g && g.id === state.activeGroupId);
        if (!group) return;

        try {
            const constraints = {
                audio: true,
                video: callType === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
            };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);

            callState.inCall = true;
            callState.callType = callType;
            callState.partnerId = state.activeGroupId;
            callState.partnerName = group.name;
            callState.isMicOn = true;
            callState.isCamOn = callType === 'video';

            showCallScreen(group.name, callType);

            const localVideoEl = document.getElementById('local-video');
            if (localVideoEl && localStream) {
                localVideoEl.srcObject = localStream;
            }

            // Gửi cuộc gọi đến tất cả thành viên trong nhóm đang online
            const otherMembers = (group.members || []).filter(m => m !== currentUser.userId);
            otherMembers.forEach(targetUserId => {
                if (socketIO && onlineUsersList.includes(targetUserId)) {
                    socketIO.emit('call-request', {
                        callerId: currentUser.userId,
                        callerName: `${currentUser.name} (Nhóm: ${group.name})`,
                        targetUserId: targetUserId,
                        callType: callType,
                        callerPeerId: myPeer?.id || ''
                    });
                }
            });

            const connectText = document.getElementById('call-connecting-text');
            if (connectText) connectText.textContent = `Đang đổ chuông nhóm ${group.name}...`;

        } catch (err) {
            console.error('Không thể truy cập camera/mic:', err);
            alert('Không thể truy cập camera hoặc microphone. Vui lòng kiểm tra quyền thiết bị.');
            cleanupCall();
        }
        return;
    }

    if (!state.activeChatFriendId) return;

    const friend = systemDB.users.find(u => u && u.userId === state.activeChatFriendId);
    if (!friend) return;

    // Kiểm tra online
    if (!onlineUsersList.includes(state.activeChatFriendId)) {
        alert(`${friend.name} hiện không trực tuyến. Không thể gọi điện.`);
        return;
    }

    try {
        // Xin quyền camera/mic
        const constraints = {
            audio: true,
            video: callType === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Cập nhật state
        callState.inCall = true;
        callState.callType = callType;
        callState.partnerId = state.activeChatFriendId;
        callState.partnerName = friend.name;
        callState.isMicOn = true;
        callState.isCamOn = callType === 'video';

        // Hiển thị màn hình gọi
        showCallScreen(friend.name, callType);

        // Hiển thị local video
        const localVideoEl = document.getElementById('local-video');
        if (localVideoEl && localStream) {
            localVideoEl.srcObject = localStream;
        }

        // Gửi yêu cầu gọi qua Socket.IO
        socketIO.emit('call-request', {
            callerId: currentUser.userId,
            callerName: currentUser.name,
            targetUserId: state.activeChatFriendId,
            callType: callType,
            callerPeerId: myPeer?.id || ''
        });

        // Hiện trạng thái "Đang đổ chuông..."
        const connectText = document.getElementById('call-connecting-text');
        if (connectText) connectText.textContent = 'Đang đổ chuông...';

    } catch (err) {
        console.error('Không thể truy cập camera/mic:', err);
        alert('Không thể truy cập camera hoặc microphone. Vui lòng kiểm tra quyền truy cập của trình duyệt.');
        cleanupCall();
    }
}

// --- XỬ LÝ CUỘC GỌI ĐẾN (RECEIVER) ---
function handleIncomingCall(data) {
    if (callState.inCall) {
        // Đang trong cuộc gọi khác → tự động từ chối
        socketIO.emit('call-rejected', {
            callerId: data.callerId,
            reason: 'Người dùng đang bận.'
        });
        return;
    }

    // Lưu dữ liệu cuộc gọi đến
    callState.incomingCallData = data;

    // Cập nhật modal cuộc gọi đến
    const nameEl = document.getElementById('incoming-call-name');
    const avatarEl = document.getElementById('incoming-call-avatar');
    const typeEl = document.getElementById('incoming-call-type');

    if (nameEl) nameEl.textContent = data.callerName || 'Bạn Học';
    if (avatarEl) avatarEl.textContent = getInitials(data.callerName);
    if (typeEl) {
        typeEl.innerHTML = data.callType === 'video'
            ? '<i class="fa-solid fa-video"></i> Cuộc gọi video đến...'
            : '<i class="fa-solid fa-phone"></i> Cuộc gọi thoại đến...';
    }

    // Hiện modal
    document.getElementById('incoming-call-modal')?.classList.add('active');

    // Phát âm chuông
    playRingtone();
}

// --- CHẤP NHẬN CUỘC GỌI ĐẾN ---
async function acceptIncomingCall() {
    const data = callState.incomingCallData;
    if (!data) return;

    stopRingtone();
    document.getElementById('incoming-call-modal')?.classList.remove('active');

    try {
        const constraints = {
            audio: true,
            video: data.callType === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        callState.inCall = true;
        callState.callType = data.callType;
        callState.partnerId = data.callerId;
        callState.partnerName = data.callerName;
        callState.isMicOn = true;
        callState.isCamOn = data.callType === 'video';

        showCallScreen(data.callerName, data.callType);

        const localVideoEl = document.getElementById('local-video');
        if (localVideoEl && localStream) {
            localVideoEl.srcObject = localStream;
        }

        // Thông báo cho caller biết đã chấp nhận + gửi peerId
        socketIO.emit('call-accepted', {
            callerId: data.callerId,
            accepterPeerId: myPeer?.id || ('studyflow-' + currentUser.userId)
        });

        // Phía Receiver KHÔNG gọi myPeer.call() mà chỉ chờ Caller thực hiện cuộc gọi PeerJS đến!
        // Receiver đã có sẵn myPeer.on('call', ...) tự động trả lời khi nhận call từ Caller.

        callState.incomingCallData = null;

    } catch (err) {
        console.error('Không thể truy cập camera/mic:', err);
        alert('Không thể truy cập camera hoặc microphone.');
        socketIO.emit('call-rejected', {
            callerId: data.callerId,
            reason: 'Lỗi thiết bị.'
        });
        cleanupCall();
    }
}

// --- TỪ CHỐI CUỘC GỌI ĐẾN ---
function rejectIncomingCall() {
    const data = callState.incomingCallData;
    if (!data) return;

    stopRingtone();
    document.getElementById('incoming-call-modal')?.classList.remove('active');

    socketIO.emit('call-rejected', {
        callerId: data.callerId,
        reason: 'Cuộc gọi bị từ chối.'
    });

    callState.incomingCallData = null;
}

// --- XỬ LÝ KHI CUỘC GỌI ĐƯỢC CHẤP NHẬN (CALLER NHẬN TÍN HIỆU TỪ RECEIVER) ---
function handleCallAccepted(data) {
    console.log('[Call] Đã được chấp nhận, Caller thực hiện kết nối PeerJS tới Receiver...');
    const targetPeerId = data.accepterPeerId || ('studyflow-' + callState.partnerId);

    if (myPeer && targetPeerId && localStream) {
        const call = myPeer.call(targetPeerId, localStream);
        currentCallPeer = call;
        setupCallPeerEvents(call);
    }
}

// --- XỬ LÝ KHI CUỘC GỌI BỊ TỪ CHỐI ---
function handleCallRejected(data) {
    alert(`Cuộc gọi bị từ chối: ${data.reason || 'Không rõ lý do'}`);
    cleanupCall();
}

// --- XỬ LÝ KHI CUỘC GỌI KẾT THÚC BỞI ĐỐI PHƯƠNG ---
function handleCallEnded(data) {
    cleanupCall();
}

// --- XỬ LÝ KHI GỌI THẤT BẠI (USER OFFLINE) ---
function handleCallFailed(data) {
    alert(data.message || 'Không thể kết nối cuộc gọi.');
    cleanupCall();
}

// --- THIẾT LẬP SỰ KIỆN PEER CALL ---
function setupCallPeerEvents(call) {
    call.on('stream', (remoteStream) => {
        console.log('[PeerJS] Nhận được remote stream');

        // Ẩn trạng thái connecting
        document.getElementById('call-connecting-state')?.classList.add('hidden');

        // Hiển thị remote video
        const remoteVideoEl = document.getElementById('remote-video');
        if (remoteVideoEl) {
            remoteVideoEl.srcObject = remoteStream;
        }

        // Nếu có video track thì ẩn avatar
        const hasVideo = remoteStream.getVideoTracks().length > 0 && remoteStream.getVideoTracks()[0].enabled;
        const remoteOff = document.getElementById('remote-video-off');
        if (remoteOff) {
            if (hasVideo) {
                remoteOff.classList.add('hidden');
            }
        }

        // Bắt đầu timer
        startCallTimer();
    });

    call.on('close', () => {
        console.log('[PeerJS] Cuộc gọi peer đã đóng');
        cleanupCall();
    });

    call.on('error', (err) => {
        console.error('[PeerJS] Lỗi cuộc gọi:', err);
        cleanupCall();
    });
}

// --- KẾT THÚC CUỘC GỌI ---
function endCall(notifyPartner = false) {
    if (notifyPartner && callState.partnerId && socketIO) {
        socketIO.emit('call-ended', {
            targetUserId: callState.partnerId
        });
    }
    cleanupCall();
}

// --- CLEANUP SAU CUỘC GỌI ---
function cleanupCall() {
    // Dừng tất cả media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Đóng peer call
    if (currentCallPeer) {
        currentCallPeer.close();
        currentCallPeer = null;
    }

    // Dừng timer
    stopCallTimer();

    // Dừng chuông
    stopRingtone();

    // Reset state
    callState.inCall = false;
    callState.callType = null;
    callState.partnerId = null;
    callState.partnerName = null;
    callState.isMicOn = true;
    callState.isCamOn = true;
    callState.incomingCallData = null;

    // Ẩn tất cả overlay
    document.getElementById('call-screen-overlay')?.classList.remove('active');
    document.getElementById('incoming-call-modal')?.classList.remove('active');

    // Reset video elements
    const remoteVideo = document.getElementById('remote-video');
    const localVideo = document.getElementById('local-video');
    if (remoteVideo) remoteVideo.srcObject = null;
    if (localVideo) localVideo.srcObject = null;

    // Reset UI buttons
    const micBtn = document.getElementById('btn-toggle-mic');
    const camBtn = document.getElementById('btn-toggle-camera');
    if (micBtn) {
        micBtn.classList.remove('muted');
        micBtn.querySelector('i').className = 'fa-solid fa-microphone';
    }
    if (camBtn) {
        camBtn.classList.remove('cam-off');
        camBtn.querySelector('i').className = 'fa-solid fa-video';
    }

    // Reset local video off
    document.getElementById('local-video-off')?.classList.remove('visible');
    document.getElementById('remote-video-off')?.classList.remove('hidden');
    document.getElementById('call-connecting-state')?.classList.remove('hidden');
}

// --- BẬT/TẮT MIC ---
function toggleMicrophone() {
    if (!localStream) return;

    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    callState.isMicOn = !callState.isMicOn;
    audioTracks.forEach(track => track.enabled = callState.isMicOn);

    const btn = document.getElementById('btn-toggle-mic');
    if (btn) {
        if (callState.isMicOn) {
            btn.classList.remove('muted');
            btn.querySelector('i').className = 'fa-solid fa-microphone';
        } else {
            btn.classList.add('muted');
            btn.querySelector('i').className = 'fa-solid fa-microphone-slash';
        }
    }
}

// --- BẬT/TẮT CAMERA ---
function toggleCamera() {
    if (!localStream) return;

    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) {
        // Nếu đang gọi audio → không có video track
        alert('Cuộc gọi thoại không có camera.');
        return;
    }

    callState.isCamOn = !callState.isCamOn;
    videoTracks.forEach(track => track.enabled = callState.isCamOn);

    const btn = document.getElementById('btn-toggle-camera');
    const localOff = document.getElementById('local-video-off');

    if (btn) {
        if (callState.isCamOn) {
            btn.classList.remove('cam-off');
            btn.querySelector('i').className = 'fa-solid fa-video';
        } else {
            btn.classList.add('cam-off');
            btn.querySelector('i').className = 'fa-solid fa-video-slash';
        }
    }

    if (localOff) {
        if (callState.isCamOn) {
            localOff.classList.remove('visible');
        } else {
            localOff.classList.add('visible');
        }
    }

    // Thông báo cho đối phương
    if (socketIO && callState.partnerId) {
        socketIO.emit('toggle-camera', {
            targetUserId: callState.partnerId,
            cameraOn: callState.isCamOn
        });
    }
}

// --- HIỂN THỊ MÀN HÌNH GỌI ---
function showCallScreen(partnerName, callType) {
    const overlay = document.getElementById('call-screen-overlay');
    if (!overlay) return;

    // Cập nhật tên
    const nameEl = document.getElementById('call-partner-name');
    if (nameEl) nameEl.textContent = partnerName;

    const remoteNameEl = document.getElementById('call-remote-name-display');
    if (remoteNameEl) remoteNameEl.textContent = partnerName;

    const remoteAvatarEl = document.getElementById('call-remote-avatar');
    if (remoteAvatarEl) remoteAvatarEl.textContent = getInitials(partnerName);

    // Reset timer
    const timerEl = document.getElementById('call-timer');
    if (timerEl) timerEl.textContent = '00:00';

    // Hiện connecting state
    document.getElementById('call-connecting-state')?.classList.remove('hidden');

    // Hiện remote-video-off (avatar) cho tới khi nhận stream
    document.getElementById('remote-video-off')?.classList.remove('hidden');

    // Ẩn/hiện local video pip based on call type
    const localPip = document.getElementById('local-video-pip');
    if (localPip) localPip.style.display = callType === 'video' ? 'block' : 'none';

    // Hiện camera button chỉ khi gọi video
    const camBtn = document.getElementById('btn-toggle-camera');
    if (camBtn) camBtn.style.display = callType === 'video' ? 'flex' : 'none';

    overlay.classList.add('active');
}

// --- CALL TIMER ---
function startCallTimer() {
    callState.callTimerSeconds = 0;
    stopCallTimer();

    callState.callTimerInterval = setInterval(() => {
        callState.callTimerSeconds++;
        const mins = Math.floor(callState.callTimerSeconds / 60);
        const secs = callState.callTimerSeconds % 60;
        const timerEl = document.getElementById('call-timer');
        if (timerEl) timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }, 1000);
}

function stopCallTimer() {
    if (callState.callTimerInterval) {
        clearInterval(callState.callTimerInterval);
        callState.callTimerInterval = null;
    }
    callState.callTimerSeconds = 0;
}

// --- RINGTONE (ÂM CHUÔNG) ---
function playRingtone() {
    try {
        // Tạo âm thanh chuông bằng Web Audio API
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        function playBeep(startTime) {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, startTime);
            oscillator.frequency.setValueAtTime(660, startTime + 0.15);
            
            gainNode.gain.setValueAtTime(0.3, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
            
            oscillator.start(startTime);
            oscillator.stop(startTime + 0.4);
        }
        
        // Phát chuông lặp lại 
        let time = audioCtx.currentTime;
        for (let i = 0; i < 20; i++) {
            playBeep(time);
            time += 1.2;
        }
        
        callState.ringtoneAudio = audioCtx;
    } catch (e) {
        console.warn('Không thể phát chuông:', e);
    }
}

function stopRingtone() {
    if (callState.ringtoneAudio) {
        try {
            callState.ringtoneAudio.close();
        } catch (e) {}
        callState.ringtoneAudio = null;
    }
}

// --- OVERRIDE renderFriendsList để thêm online status ---
const _originalRenderFriendsList = renderFriendsList;
// Ghi đè renderFriendsList 
const _patchedRenderFriendsList = function() {
    _originalRenderFriendsList();
    // Sau khi render xong, cập nhật online status
    setTimeout(() => {
        updateFriendsOnlineStatus();
    }, 50);
};

// Override selectChatFriend để cập nhật call buttons
const _originalSelectChatFriend = window.selectChatFriend;
window.selectChatFriend = function(friendUserId) {
    _originalSelectChatFriend(friendUserId);
    // Sau khi chọn bạn, cập nhật hiển thị nút gọi
    setTimeout(() => {
        updateCallButtonsVisibility();
        updateFriendsOnlineStatus();
    }, 50);
};

// Patch renderFriendsList
renderFriendsList = _patchedRenderFriendsList;

// --- KHỞI TẠO KHI ĐĂNG NHẬP ---
// Ghi đè loadUserData để thêm bước khởi tạo call system và tự động đồng bộ DB
const _originalLoadUserData = loadUserData;
loadUserData = function() {
    _originalLoadUserData();
    syncSystemDBToServer();
    setTimeout(() => {
        initCallSystem();
    }, 500);
};

// --- DOM READY INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAuthSystem();
    // initChatSystem(); // Disabled
    initExercises();
    if(typeof initAiQuizSystem === 'function') initAiQuizSystem();

    if (currentUser) {
        loadUserData();
    } else {
        openAuthModal();
    }
});

// ==========================================
// BÀI TẬP & LUYỆN TẬP (EXERCISES FEATURE)
// ==========================================

function initExercises() {
    const btnAddModal = document.getElementById('btn-add-exercise-modal');
    const modal = document.getElementById('exercise-modal');
    const btnClose = document.getElementById('btn-close-exercise-modal');
    const btnCancel = document.getElementById('btn-cancel-exercise');
    const form = document.getElementById('exercise-form');
    
    if (btnAddModal) {
        btnAddModal.addEventListener('click', () => {
            openExerciseModal();
        });
    }

    if (btnClose) btnClose.addEventListener('click', closeExerciseModal);
    if (btnCancel) btnCancel.addEventListener('click', closeExerciseModal);

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveExercise();
        });
    }

    const subjSelect = document.getElementById('filter-exercise-subject');

    if (subjSelect) subjSelect.addEventListener('change', renderExercises);

    // Initial render when tab switches or loaded
    const tabExercises = document.getElementById('tab-exercises');
    if (tabExercises) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.target.classList.contains('active')) {
                    populateExerciseSubjects();
                    renderExercises();
                }
            });
        });
        observer.observe(tabExercises, { attributes: true, attributeFilter: ['class'] });
    }
}

function populateExerciseSubjects() {
    const selects = [
        document.getElementById('exercise-subject-select'),
        document.getElementById('filter-exercise-subject')
    ];
    selects.forEach(sel => {
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = sel.id === 'filter-exercise-subject' ? '<option value="all">Tất cả môn học</option>' : '<option value="">-- Chọn môn học --</option>';
        state.subjects.forEach(subj => {
            const opt = document.createElement('option');
            opt.value = subj.id;
            opt.textContent = subj.name;
            sel.appendChild(opt);
        });
        if (currentVal && Array.from(sel.options).some(o => o.value === currentVal)) {
            sel.value = currentVal;
        }
    });
}

function openExerciseModal(exercise = null) {
    populateExerciseSubjects();
    const modal = document.getElementById('exercise-modal');
    const title = document.getElementById('exercise-modal-title');
    const form = document.getElementById('exercise-form');
    const fileInput = document.getElementById('exercise-file-input');
    const fileNameDisplay = document.getElementById('exercise-file-name');
    
    if (fileInput) fileInput.value = '';
    if (fileNameDisplay) fileNameDisplay.textContent = '';

    if (exercise) {
        title.innerHTML = '<i class="fa-solid fa-pen-ruler"></i> Chỉnh Sửa Bài Tập';
        document.getElementById('exercise-id').value = exercise.id;
        document.getElementById('exercise-title').value = exercise.title || '';
        document.getElementById('exercise-subject-select').value = exercise.subjectId || '';
        document.getElementById('exercise-due-date').value = exercise.dueDate || '';
        document.getElementById('exercise-desc').value = exercise.desc || '';
        if (exercise.attachedFile && fileNameDisplay) {
            fileNameDisplay.textContent = 'File hiện tại: ' + exercise.attachedFile.name;
        }
    } else {
        title.innerHTML = '<i class="fa-solid fa-pen-ruler"></i> Thêm Bài Tập Mới';
        form.reset();
        document.getElementById('exercise-id').value = '';
    }
    
    modal.classList.add('active');
}

function closeExerciseModal() {
    const modal = document.getElementById('exercise-modal');
    if (modal) modal.classList.remove('active');
}

async function saveExercise() {
    const id = document.getElementById('exercise-id').value;
    const title = document.getElementById('exercise-title').value.trim();
    const subjectId = document.getElementById('exercise-subject-select').value;
    const dueDate = document.getElementById('exercise-due-date').value;
    const desc = document.getElementById('exercise-desc').value.trim();
    const fileInput = document.getElementById('exercise-file-input');

    if (!title || !subjectId) {
        alert('Vui lòng nhập đầy đủ Tiêu đề và Môn học!');
        return;
    }

    if (!state.exercises) state.exercises = [];

    let attachedFile = null;
    if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        if (file.size > 3 * 1024 * 1024) {
            alert('File đính kèm không vượt quá 3MB!');
            return;
        }
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            attachedFile = {
                name: file.name,
                type: file.type,
                data: dataUrl
            };
        } catch (err) {
            console.error('Lỗi đọc file:', err);
        }
    }

    if (id) {
        const ex = state.exercises.find(e => e.id === id);
        if (ex) {
            ex.title = title;
            ex.subjectId = subjectId;
            ex.dueDate = dueDate;
            ex.desc = desc;
            if (attachedFile) ex.attachedFile = attachedFile;
        }
    } else {
        const newEx = {
            id: 'ex-' + Date.now(),
            title,
            subjectId,
            dueDate,
            desc,
            completed: false,
            createdAt: new Date().toISOString()
        };
        if (attachedFile) newEx.attachedFile = attachedFile;
        state.exercises.unshift(newEx);
    }

    saveUserData();
    closeExerciseModal();
    renderExercises();
    updatePendingExerciseCount();
}

function deleteExercise(id) {
    if (confirm('Bạn có chắc chắn muốn xóa bài tập này?')) {
        state.exercises = state.exercises.filter(e => e.id !== id);
        saveUserData();
        renderExercises();
        updatePendingExerciseCount();
    }
}

function toggleExerciseComplete(id) {
    const ex = state.exercises.find(e => e.id === id);
    if (ex) {
        ex.completed = !ex.completed;
        saveUserData();
        renderExercises();
        updatePendingExerciseCount();
    }
}

function updatePendingExerciseCount() {
    if (!state.exercises) state.exercises = [];
    const pendingCount = state.exercises.filter(e => !e.completed).length;
    const badge = document.getElementById('pending-exercise-count-badge');
    if (badge) {
        badge.textContent = pendingCount;
        badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
}

// Gọi updatePendingExerciseCount mỗi khi load user data
const _origLoadUserDataForExercises = loadUserData;
loadUserData = function() {
    _origLoadUserDataForExercises();
    if (typeof updatePendingExerciseCount === 'function') {
        updatePendingExerciseCount();
    }
};

function renderExercises() {
    // We now have two separate containers, check them below

    if (!state.exercises) state.exercises = [];

    const subjFilter = document.getElementById('filter-exercise-subject')?.value || 'all';

    let filtered = state.exercises.filter(ex => {
        const matchSubj = subjFilter === 'all' || ex.subjectId === subjFilter;
        return matchSubj;
    });

    // Sort: pending first, then by due date
    filtered.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return 0;
    });

    const pendingContainer = document.getElementById('pending-exercises-list');
    const completedContainer = document.getElementById('completed-exercises-list');
    const pendingSummary = document.getElementById('exercise-pending-counter');
    const completedSummary = document.getElementById('exercise-completed-counter');

    if (pendingContainer) pendingContainer.innerHTML = '';
    if (completedContainer) completedContainer.innerHTML = '';

    const pendingList = filtered.filter(ex => !ex.completed);
    const completedList = filtered.filter(ex => ex.completed);

    if (pendingSummary) pendingSummary.textContent = `${pendingList.length} bài tập`;
    if (completedSummary) completedSummary.textContent = `${completedList.length} bài tập`;

    const createCardHTML = (ex) => {
        const subj = state.subjects.find(s => s.id === ex.subjectId) || { name: 'Không rõ', color: '#888' };
        const exerciseId = String(ex.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const subjectColor = safeCssColor(subj.color, '#888888');
        const dueText = ex.dueDate ? `<span class="task-date"><i class="fa-solid fa-clock"></i> Hạn nộp: ${escapeHTML(ex.dueDate)}</span>` : '';
        const fileLink = ex.attachedFile ? `
            <div style="margin-top: 6px;">
                <a href="${escapeHTML(ex.attachedFile.data)}" download="${escapeHTML(ex.attachedFile.name)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="padding: 3px 10px; font-size: 0.8rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px;">
                    <i class="fa-solid fa-paperclip"></i> ${escapeHTML(ex.attachedFile.name)}
                </a>
            </div>
        ` : '';

        return `
            <div class="task-item ${ex.completed ? 'completed' : ''}">
                <div class="task-checkbox ${ex.completed ? 'checked' : ''}" onclick="toggleExerciseComplete('${exerciseId}')">
                    <i class="fa-solid fa-check"></i>
                </div>
                <div class="task-content">
                    <h4 class="task-title" style="text-decoration: ${ex.completed ? 'line-through' : 'none'}">${escapeHTML(ex.title)}</h4>
                    ${ex.desc ? `<p class="task-desc" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">${escapeHTML(ex.desc)}</p>` : ''}
                    ${fileLink}
                    <div class="task-meta" style="margin-top: 6px;">
                        <span class="task-subject" style="background: ${subjectColor}20; color: ${subjectColor}"><i class="fa-solid fa-tag"></i> ${escapeHTML(subj.name)}</span>
                        ${dueText}
                    </div>
                </div>
                <div class="task-actions">
                    ${ex.isQuiz && !ex.completed ? `<button class="btn btn-primary" style="padding: 5px 12px; font-size: 0.85rem; border-radius: 6px; margin-right: 5px;" onclick="openQuizExercise('${exerciseId}')"><i class="fa-solid fa-play"></i> Làm bài</button>` : ''}
                    <button class="icon-btn edit" onclick="openExerciseModal(state.exercises.find(e => e.id === '${exerciseId}'))" title="Sửa"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn danger" onclick="deleteExercise('${exerciseId}')" title="Xóa"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
    };

    if (pendingContainer) {
        if (pendingList.length === 0) {
            pendingContainer.innerHTML = `<div class="empty-state">
                <div class="empty-icon"><i class="fa-solid fa-clipboard-list"></i></div>
                <p>Không có bài tập nào cần làm.</p>
            </div>`;
        } else {
            pendingList.forEach(ex => {
                pendingContainer.insertAdjacentHTML('beforeend', createCardHTML(ex));
            });
        }
    }

    if (completedContainer) {
        if (completedList.length === 0) {
            completedContainer.innerHTML = `<div class="empty-state">
                <div class="empty-icon"><i class="fa-solid fa-check-circle"></i></div>
                <p>Chưa hoàn thành bài tập nào.</p>
            </div>`;
        } else {
            completedList.forEach(ex => {
                completedContainer.insertAdjacentHTML('beforeend', createCardHTML(ex));
            });
        }
    }
}

// ==========================================
// AI QUIZ GENERATOR FEATURE
// ==========================================

let aiProvider = localStorage.getItem('ai_provider') || 'openai';
let geminiApiKey = localStorage.getItem('gemini_api_key') || '';
let currentQuizData = [];
let currentQuizExerciseId = null;

function initAiQuizSystem() {
    const btnOpenConfig = document.getElementById('btn-open-ai-config');
    const btnSaveConfig = document.getElementById('btn-save-ai-config');
    const btnCloseConfig = document.getElementById('btn-close-ai-config-modal');
    const btnCancelConfig = document.getElementById('btn-cancel-ai-config');
    
    const btnOpenQuiz = document.getElementById('btn-open-ai-quiz-modal');
    const btnCloseQuiz = document.getElementById('btn-close-ai-quiz-modal');
    const btnCancelQuiz = document.getElementById('btn-cancel-ai-quiz');
    const btnStartGen = document.getElementById('btn-start-ai-gen');
    
    const fileInput = document.getElementById('ai-quiz-file-input');
    const uploadZone = document.getElementById('ai-quiz-upload-zone');
    
    const btnCloseTake = document.getElementById('btn-close-take-quiz-modal');
    const btnCancelTake = document.getElementById('btn-cancel-take-quiz');
    const btnSubmitQuiz = document.getElementById('btn-submit-quiz');
    const btnRetakeQuiz = document.getElementById('btn-retake-quiz');

    if(btnOpenConfig) btnOpenConfig.addEventListener('click', openAiConfigModal);
    if(btnSaveConfig) btnSaveConfig.addEventListener('click', saveAiConfig);
    if(btnCloseConfig) btnCloseConfig.addEventListener('click', closeAiConfigModal);
    if(btnCancelConfig) btnCancelConfig.addEventListener('click', closeAiConfigModal);
    
    if(btnOpenQuiz) btnOpenQuiz.addEventListener('click', openAiQuizModal);
    if(btnCloseQuiz) btnCloseQuiz.addEventListener('click', closeAiQuizModal);
    if(btnCancelQuiz) btnCancelQuiz.addEventListener('click', closeAiQuizModal);
    if(btnStartGen) btnStartGen.addEventListener('click', startAiGeneration);
    
    if(btnCloseTake) btnCloseTake.addEventListener('click', closeTakeQuizModal);
    if(btnCancelTake) btnCancelTake.addEventListener('click', closeTakeQuizModal);
    if(btnSubmitQuiz) btnSubmitQuiz.addEventListener('click', submitQuiz);
    if(btnRetakeQuiz) btnRetakeQuiz.addEventListener('click', retakeQuiz);

    if(uploadZone && fileInput) {
        uploadZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if(e.target.files && e.target.files[0]) {
                document.getElementById('ai-quiz-file-name').textContent = e.target.files[0].name;
            }
        });
        uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--primary-color)'; });
        uploadZone.addEventListener('dragleave', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--border-color)'; });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = 'var(--border-color)';
            if(e.dataTransfer.files && e.dataTransfer.files[0]) {
                fileInput.files = e.dataTransfer.files;
                document.getElementById('ai-quiz-file-name').textContent = e.dataTransfer.files[0].name;
            }
        });
    }
}


// --- BUILT-IN DICTIONARY & OFFLINE VOCABULARY EXTRACTOR ---
const BUILTIN_DICT = {
    "education": { meaning: "nền giáo dục, sự học hành", example: "Education opens the door to a bright future.", topic: "Giáo dục & Trường học" },
    "vocabulary": { meaning: "từ vựng, vốn từ", example: "Learning new vocabulary improves your English.", topic: "Giáo dục & Trường học" },
    "language": { meaning: "ngôn ngữ", example: "English is an international language.", topic: "Giáo dục & Trường học" },
    "knowledge": { meaning: "kiến thức, sự hiểu biết", example: "Reading books expands your knowledge.", topic: "Giáo dục & Trường học" },
    "student": { meaning: "học sinh, sinh viên", example: "The student works hard every day.", topic: "Giáo dục & Trường học" },
    "teacher": { meaning: "giáo viên, giảng viên", example: "The teacher helps students understand complex ideas.", topic: "Giáo dục & Trường học" },
    "university": { meaning: "trường đại học", example: "She entered a top university this year.", topic: "Giáo dục & Trường học" },
    "assignment": { meaning: "bài tập, nhiệm vụ học tập", example: "Please complete your assignment by tomorrow.", topic: "Giáo dục & Trường học" },
    "technology": { meaning: "công nghệ", example: "Modern technology makes life more convenient.", topic: "Công nghệ & Máy tính" },
    "computer": { meaning: "máy tính", example: "He uses a computer to write code.", topic: "Công nghệ & Máy tính" },
    "application": { meaning: "ứng dụng, phần mềm", example: "Download the study application to your phone.", topic: "Công nghệ & Máy tính" },
    "software": { meaning: "phần mềm máy tính", example: "Software updates include new features.", topic: "Công nghệ & Máy tính" },
    "internet": { meaning: "mạng internet", example: "You can find information easily on the internet.", topic: "Công nghệ & Máy tính" },
    "communication": { meaning: "sự giao tiếp, truyền thông", example: "Effective communication builds strong relationships.", topic: "Giao tiếp & Đời sống" },
    "environment": { meaning: "môi trường", example: "Planting trees helps protect the environment.", topic: "Tự nhiên & Môi trường" },
    "opportunity": { meaning: "cơ hội, thời cơ", example: "Every challenge brings a new opportunity.", topic: "Công việc & Thành công" },
    "development": { meaning: "sự phát triển", example: "Continuous learning leads to personal development.", topic: "Công việc & Thành công" },
    "achievement": { meaning: "thành tựu, kết quả đạt được", example: "Passing the test was a great achievement.", topic: "Công việc & Thành công" },
    "strategy": { meaning: "chiến lược, phương pháp", example: "Adopt a good study strategy to save time.", topic: "Công việc & Thành công" }
};

window.updateAiProviderUI = function() {
    const provider = document.getElementById('ai-provider-select')?.value || 'offline';
    const keyGroup = document.getElementById('ai-key-input-group');
    const keyInput = document.getElementById('gemini-api-key-input');
    const hint = document.getElementById('ai-key-link-hint');
    const desc = document.getElementById('ai-provider-desc');

    if (provider === 'offline') {
        if (keyGroup) keyGroup.style.display = 'none';
        if (desc) desc.innerHTML = '⚡ <strong>Quét từ vựng Offline:</strong> Dùng cho PDF/TXT có văn bản đọc được. Ảnh hoặc PDF scan cần ChatGPT/Gemini.';
    } else if (provider === 'openai') {
        if (keyGroup) keyGroup.style.display = 'none';
        if (desc) desc.innerHTML = '✨ <strong>ChatGPT:</strong> API key được giữ an toàn trên server. Có thể đọc văn bản và hình ảnh, tạo câu 4 đáp án hoặc Đúng/Sai.';
    } else if (provider === 'gemini') {
        if (keyGroup) keyGroup.style.display = 'block';
        if (keyInput) keyInput.value = geminiApiKey;
        if (hint) hint.innerHTML = '<a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--primary-color);">Lấy Google Gemini API Key tại đây (Miễn phí)</a>';
        if (desc) desc.innerHTML = '🤖 <strong>Google Gemini AI:</strong> Sử dụng mô hình Gemini Flash từ Google.';
    }
};

function parseVocabularyOffline(text, fileName) {
    if (!text || typeof text !== 'string') return [];
    
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const result = [];
    const baseTopic = fileName ? ('File: ' + fileName.replace(/\.[^/.]+$/, '')) : 'Từ vựng bóc tách';
    const seenWords = new Set();

    // 1. Line-by-Line Table & Pair Parser (Matches English word + Vietnamese meaning)
    lines.forEach(line => {
        // Skip header rows
        if (/^(từ vựng|tiếng anh|stt|nghĩa|word|meaning|translation|stt\t|stt,)/i.test(line)) return;

        // Try delimiters: Tab, Comma, Semicolon, Colon, Hyphen, Pipe, or Space separation
        let word = '', meaning = '';

        if (line.includes('\t')) {
            const parts = line.split('\t').map(p => p.trim());
            if (parts.length >= 2) { word = parts[0]; meaning = parts[1]; }
        } else if (line.includes(';')) {
            const parts = line.split(';').map(p => p.trim());
            if (parts.length >= 2) { word = parts[0]; meaning = parts[1]; }
        } else if (line.includes(',')) {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length >= 2) { word = parts[0]; meaning = parts[1]; }
        } else if (line.includes(':')) {
            const parts = line.split(':').map(p => p.trim());
            if (parts.length >= 2) { word = parts[0]; meaning = parts[1]; }
        } else if (line.includes(' - ')) {
            const parts = line.split(' - ').map(p => p.trim());
            if (parts.length >= 2) { word = parts[0]; meaning = parts[1]; }
        } else if (line.includes('|')) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 2) { word = parts[0]; meaning = parts[1]; }
        } else {
            // Space-separated English word/phrase followed by Vietnamese meaning
            const match = line.match(/^([a-zA-Z\s\-']+?)\s+([àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđA-Za-z0-9\s\(\),\-\/.]+)/i);
            if (match) {
                word = match[1].trim();
                meaning = match[2].trim();
            }
        }

        // Clean up extracted word and meaning
        word = word.replace(/^[0-9]+\.\s*/, '').trim();
        meaning = meaning.trim();

        const wordLower = word.toLowerCase();

        if (word && meaning && /[a-zA-Z]{2,}/.test(word) && !seenWords.has(wordLower)) {
            seenWords.add(wordLower);
            result.push({
                word: word,
                meaning: meaning,
                example: "Practice using '" + word + "' in your daily sentences.",
                topic: baseTopic + ' - Phần ' + (Math.floor(result.length / 10) + 1)
            });
        }
    });

    // 2. Fallback: If no structured pairs were found, use word frequency & dictionary
    if (result.length === 0) {
        const words = (text.match(/[a-zA-Z]{3,}/g) || []).map(w => w.toLowerCase());
        const uniqueWords = Array.from(new Set(words));
        const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use']);

        const validWords = uniqueWords.filter(w => !stopWords.has(w) && !/^\d+$/.test(w));
        validWords.forEach((w, idx) => {
            const dictEntry = BUILTIN_DICT[w];
            result.push({
                word: w,
                meaning: dictEntry ? dictEntry.meaning : ("nghĩa từ vựng '" + w + "'"),
                example: dictEntry ? dictEntry.example : ("Practice using '" + w + "' in daily sentences."),
                topic: baseTopic + ' - Phần ' + (Math.floor(result.length / 10) + 1)
            });
        });
    }

    return result;
}

function openAiConfigModal() {
    document.getElementById('ai-provider-select').value = aiProvider;
    document.getElementById('gemini-api-key-input').value = geminiApiKey;
    updateAiProviderUI();
    document.getElementById('ai-config-modal').classList.add('active');
}
function closeAiConfigModal() {
    document.getElementById('ai-config-modal').classList.remove('active');
}
function saveAiConfig() {
    aiProvider = document.getElementById('ai-provider-select').value;
    localStorage.setItem('ai_provider', aiProvider);
    if (aiProvider === 'openai') {
        closeAiConfigModal();
        return;
    }
    if (aiProvider === 'offline') {
        closeAiConfigModal();
        return;
    }
    const key = document.getElementById('gemini-api-key-input').value.trim();
    if(!key) {
        alert('Vui lòng nhập API Key!');
        return;
    }
    geminiApiKey = key;
    localStorage.setItem('gemini_api_key', key);
    closeAiConfigModal();
}

function openAiQuizModal() {
    if (aiProvider === 'offline') {
        openAiConfigModal();
        const desc = document.getElementById('ai-provider-desc');
        if (desc) desc.innerHTML = 'ℹ️ <strong>Tạo quiz cần ChatGPT hoặc Gemini.</strong> Chế độ Offline chỉ dùng để trích xuất từ vựng từ PDF/TXT có văn bản.';
        return;
    }
    if(aiProvider !== 'openai' && aiProvider !== 'offline' && !geminiApiKey) {
        openAiConfigModal();
        return;
    }
    document.getElementById('ai-quiz-file-input').value = '';
    document.getElementById('ai-quiz-file-name').textContent = '';
    document.getElementById('ai-quiz-topic-input').value = '';
    document.getElementById('ai-quiz-progress-state').style.display = 'none';
    document.getElementById('btn-start-ai-gen').disabled = false;
    document.getElementById('ai-quiz-modal').classList.add('active');
}
function closeAiQuizModal() {
    document.getElementById('ai-quiz-modal').classList.remove('active');
}

async function startAiGeneration() {
    const fileInput = document.getElementById('ai-quiz-file-input');
    const topic = document.getElementById('ai-quiz-topic-input').value.trim();
    
    if(!fileInput.files || fileInput.files.length === 0) {
        alert('Vui lòng chọn hoặc kéo thả file PDF, TXT hoặc ảnh vào ô trống!');
        return;
    }
    const file = fileInput.files[0];
    const progressState = document.getElementById('ai-quiz-progress-state');
    const progressText = document.getElementById('ai-quiz-progress-text');
    const btnStart = document.getElementById('btn-start-ai-gen');
    
    progressState.style.display = 'block';
    btnStart.disabled = true;
    
    try {
        progressText.textContent = 'Đang đọc nội dung file...';
        
        // Đọc file để lưu lại làm minh họa và gửi ảnh/text cho AI.
        const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        
        // base64Data is in format "data:mime/type;base64,....."
        const mimeType = base64Data.split(';')[0].split(':')[1];
        const base64String = base64Data.split(',')[1];
        
        progressText.textContent = 'AI đang phân tích tài liệu và tạo bài trắc nghiệm (sẽ mất khoảng 5-15 giây)...';
        
        let generatedQuiz;
        if (aiProvider === 'openai') {
            let extractedText = '';
            let imageDataUrls = [];
            if (file.name.toLowerCase().endsWith('.pdf')) extractedText = await extractTextFromPDF(file);
            else if (file.name.toLowerCase().endsWith('.txt')) extractedText = await file.text();
            if (file.name.toLowerCase().endsWith('.pdf')) imageDataUrls = await renderPDFPagesForAI(file);
            const response = await fetch('/api/ai/generate-quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl: /^data:image\//i.test(base64Data) ? base64Data : '', imageDataUrls, extractedText, topic, fileName: file.name })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error === 'openai_not_configured' ? 'Server chưa cấu hình OPENAI_API_KEY.' : (result.error || 'Không thể gọi ChatGPT.'));
            generatedQuiz = result.questions;
        } else {
            generatedQuiz = await callGeminiToGenerateQuiz(base64String, mimeType, topic);
        }
        
        if(generatedQuiz && generatedQuiz.length > 0) {
            closeAiQuizModal();
            
            if (!state.exercises) state.exercises = [];
            const quizEx = {
                id: 'ex-' + Date.now(),
            title: 'Trắc nghiệm ' + (aiProvider === 'openai' ? 'ChatGPT: ' : 'AI: ') + (file.name || 'Tài liệu mới'),
                subjectId: state.subjects[0]?.id || '', // Default to first subject
                dueDate: new Date().toISOString().split('T')[0],
                desc: topic || 'Bài tập tạo tự động từ tài liệu.',
                completed: false,
                isQuiz: true,
                quizData: generatedQuiz,
                attachedFile: {
                    name: file.name,
                    data: base64Data
                }
            };
            state.exercises.unshift(quizEx);
            saveUserData();
            renderExercises();
            
            alert('Tạo bài tập thành công! Bài kiểm tra đã được lưu vào danh sách Bài Tập của bạn.');
            
            // Switch to Exercises tab if function exists
            if(typeof switchTab === 'function') switchTab('exercises');
            
        } else {
            throw new Error('AI không tạo được bài tập. Vui lòng thử lại!');
        }
        
    } catch (err) {
        console.error(err);
        alert('Lỗi: ' + err.message);
    } finally {
        progressState.style.display = 'none';
        btnStart.disabled = false;
    }
}

async function extractTextFromPDF(file) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('Thư viện PDF.js chưa được tải. Vui lòng kiểm tra kết nối mạng!');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    // Read up to 5 pages
    const numPages = Math.min(pdf.numPages, 5);
    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
    }
    return fullText;
}

async function getGeminiGenerateModels() {
    try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(geminiApiKey)}`;
        const listRes = await fetch(listUrl);
        if (listRes.ok) {
            const listData = await listRes.json();
            if (Array.isArray(listData.models)) {
                const models = listData.models.filter(m => {
                    const name = (m.name || '').toLowerCase();
                    const isSpecialistModel = /tts|audio|live|computer-use|image-generation|imagen|embedding|robotics/.test(name);
                    return Array.isArray(m.supportedGenerationMethods) &&
                        m.supportedGenerationMethods.includes('generateContent') &&
                        name.includes('gemini') &&
                        !isSpecialistModel &&
                        (name.includes('flash') || name.includes('pro'));
                }).map(m => m.name.replace(/^models\//, ''));

                if (models.length) {
                    return [...new Set(models)].sort((a, b) => {
                        const score = name => {
                            if (name === 'gemini-3.6-flash') return 100;
                            if (name === 'gemini-3.5-flash') return 95;
                            if (name === 'gemini-flash-latest') return 90;
                            if (/flash/i.test(name) && !/preview|exp/i.test(name)) return 80;
                            if (/pro/i.test(name) && !/preview|exp/i.test(name)) return 70;
                            if (/preview/i.test(name)) return 30;
                            return 10;
                        };
                        return score(b) - score(a);
                    });
                }
            }
        }
    } catch (err) {
        console.warn('Không lấy được danh sách model, dùng danh sách mặc định.', err);
    }

    return ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
}

async function callGeminiToGenerateQuiz(base64String, mimeType, topic) {
    const generateModels = await getGeminiGenerateModels();
    let lastError = null;
    
    const prompt = `Bạn là một hệ thống bóc tách và tạo bài tập trắc nghiệm thông minh. Dựa vào nội dung file đính kèm, hãy tạo ra danh sách các câu hỏi trắc nghiệm khách quan (tối đa 30 câu).
${topic ? "YÊU CẦU THÊM TỪ HỌC SINH: " + topic : ""}
CHỈ DẪN QUAN TRỌNG:
- Tài liệu đính kèm có thể là văn bản, ảnh chụp đề thi hoặc PDF. Hãy đọc cẩn thận.
- Nếu tài liệu cung cấp đã có sẵn các câu hỏi trắc nghiệm, hãy bóc tách CHÍNH XÁC các câu hỏi và các lựa chọn (A, B, C, D) đó.
- Nếu tài liệu có sẵn đáp án, BẮT BUỘC phải dùng đáp án của tài liệu.
- Nếu tài liệu không có đáp án, hãy tự phân tích nội dung và đưa ra đáp án chính xác nhất.
- Nếu tài liệu chỉ là văn bản lý thuyết thông thường (không có câu hỏi), hãy TỰ ĐỘNG TẠO ra 10 - 20 câu hỏi trắc nghiệm hay nhất để kiểm tra kiến thức.

Hãy trả về DUY NHẤT một mảng JSON (không có markdown json hoặc giải thích thêm) theo đúng cấu trúc sau:
[
  {
    "question": "Nội dung câu hỏi 1",
    "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
    "answer": 0,
    "explanation": "Giải thích chi tiết vì sao đáp án này đúng"
  }
]
Chú ý: "answer" là index của mảng options (0, 1, 2, 3). Các câu trả lời phải là tiếng Việt nếu tài liệu tiếng Việt.
    `.trim();

    // 2. Thử từng model cho đến khi thành công
    for (let modelName of generateModels) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64String
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.2
                    }
                })
            });
            
            if(!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'Lỗi kết nối Gemini API.');
            }
            
            const data = await response.json();
            let resText = data.candidates[0].content.parts[0].text;
            
            // Clean up markdown block if any
                resText = resText.replace(/```json/gi, '').replace(/```/g, '').trim(); const jsonMatch = resText.match(/\[[\s\S]*\]/); resText = jsonMatch ? jsonMatch[0] : resText;
            
            try {
                return JSON.parse(resText);
            } catch (e) {
                throw new Error("AI trả về kết quả không đúng định dạng JSON.");
            }
        } catch (err) {
            lastError = err;
            const msg = err.message.toLowerCase();
            // Bỏ qua model nếu bị các lỗi liên quan đến deprecation, unsupported, hoặc quota/limit (đặc biệt là limit: 0)
            if (msg.includes('not found') || msg.includes('not supported') || 
                msg.includes('no longer available') || msg.includes('deprecated') || 
                msg.includes('unavailable') || msg.includes('quota') || 
                msg.includes('exceeded') || msg.includes('limit') ||
                msg.includes('image input modality')) {
                console.warn(`Model ${modelName} bị từ chối (${err.message}), đang thử model khác...`);
                continue;
            } else {
                // Nếu là lỗi parse JSON hoặc lỗi API key không đúng, ném lỗi luôn
                throw err;
            }
        }
    }
    
    throw new Error(`Tất cả các mô hình AI đều bị từ chối (có thể do API Key hết hạn mức hoặc chưa hỗ trợ khu vực này). Lỗi cuối: ${lastError?.message}`);
}

window.openQuizExercise = function(id) {
    const ex = state.exercises.find(e => e.id === id);
    if (!ex || !ex.quizData) return;
    
    currentQuizExerciseId = id;
    
    // Nếu bài tập chưa hoàn thành, xóa đáp án cũ để làm lại
    if (!ex.completed) {
        ex.quizData.forEach(q => delete q.userAnswer);
    }
    
    renderTakeQuizModal(ex.quizData, ex);
    
    // Nếu bài tập đã hoàn thành, tự động hiển thị kết quả (điểm số cũ)
    if (ex.completed) {
        submitQuiz(true); // isReopen = true
    }
};

window.retakeQuiz = function() {
    if (currentQuizData && currentQuizExerciseId) {
        const ex = state.exercises.find(e => e.id === currentQuizExerciseId);
        if (ex) {
            ex.completed = false;
            ex.score = 0;
            saveUserData();
            renderExercises();
        }
        
        currentQuizData.forEach(q => delete q.userAnswer);
        renderTakeQuizModal(currentQuizData, ex);
    }
};

function renderTakeQuizModal(quizArray, ex) {
    currentQuizData = quizArray;
    const container = document.getElementById('quiz-questions-container');
    container.innerHTML = '';
    
    // Hiển thị tài liệu nguồn ngay đầu bài để người học đối chiếu khi làm.
    if (ex && ex.attachedFile && ex.attachedFile.data) {
        const sourceData = String(ex.attachedFile.data);
        const isImage = /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(sourceData);
        const isPdf = /^data:application\/pdf;base64,/i.test(sourceData);
        const isPlainText = /^data:text\/plain(?:;charset=[^;,]+)?;base64,/i.test(sourceData);
        if (!isImage && !isPdf && !isPlainText) {
            console.warn('Đã bỏ qua định dạng xem trước tài liệu không an toàn.');
        } else {
            const imgHeader = document.createElement('div');
            imgHeader.className = 'quiz-source-preview';
            const label = document.createElement('p');
            label.textContent = 'Tài liệu minh họa: ' + (ex.attachedFile.name || 'tài liệu nguồn');
            const media = document.createElement(isImage ? 'img' : 'iframe');
            media.src = sourceData;
            media.className = isImage ? 'quiz-source-image' : 'quiz-source-pdf';
            media.setAttribute('title', 'Tài liệu nguồn');
            imgHeader.append(label, media);
            container.appendChild(imgHeader);
        }
    }
    
    quizArray.forEach((q, idx) => {
        const qCard = document.createElement('div');
        qCard.className = 'quiz-question-card';
        const typeLabel = q.type === 'true_false' ? 'Đúng / Sai' : 'Chọn 1 đáp án';
        const options = Array.isArray(q.options) ? q.options : [];
        qCard.innerHTML = `
            <div class="quiz-question-meta"><span>Câu ${idx + 1}</span><small>${typeLabel}</small></div>
            <div class="quiz-question-title">${escapeHTML(q.question)}</div>
            <div class="quiz-options-list" id="q-opts-${idx}">
                ${options.map((opt, optIdx) => `
                    <div class="quiz-option" data-q="${idx}" data-opt="${optIdx}" onclick="selectQuizOption(this, ${idx}, ${optIdx})">
                        ${String.fromCharCode(65 + optIdx)}. ${escapeHTML(opt)}
                    </div>
                `).join('')}
            </div>
            <div id="q-feedback-${idx}" style="display:none; margin-top:15px; font-size:0.9rem; padding:10px; border-radius:5px; background:var(--bg-color); border-left: 3px solid var(--primary-color);">
                <strong><i class="fa-solid fa-lightbulb" style="color:var(--warning-color)"></i> Giải thích:</strong> ${escapeHTML(q.explanation || 'Không có giải thích.')}
            </div>
        `;
        container.appendChild(qCard);
    });
    
    document.getElementById('quiz-result-display').style.display = 'none';
    document.getElementById('btn-submit-quiz').style.display = 'inline-flex';
    document.getElementById('take-quiz-modal').classList.add('active');
}

function selectQuizOption(el, qIdx, optIdx) {
    // Nếu đã nộp bài thì chặn click
    if(document.getElementById('quiz-result-display').style.display === 'block') return;
    
    const siblings = document.querySelectorAll(`#q-opts-${qIdx} .quiz-option`);
    siblings.forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    currentQuizData[qIdx].userAnswer = optIdx;
}

function submitQuiz(isReopen = false) {
    if (!isReopen) {
        let unanswered = 0;
        currentQuizData.forEach(q => {
            if(q.userAnswer === undefined) unanswered++;
        });
        
        if(unanswered > 0) {
            if(!confirm(`Bạn còn ${unanswered} câu chưa trả lời. Bạn có chắc chắn muốn nộp bài?`)) return;
        }
    }
    
    let score = 0;
    currentQuizData.forEach((q, idx) => {
        const userAns = q.userAnswer;
        const correctAns = q.answer;
        const siblings = document.querySelectorAll(`#q-opts-${idx} .quiz-option`);
        
        siblings.forEach(s => {
            s.style.pointerEvents = 'none'; 
        });
        
        if(userAns !== undefined) {
            const userEl = document.querySelector(`#q-opts-${idx} .quiz-option[data-opt="${userAns}"]`);
            if(userAns === correctAns) {
                score++;
                userEl.classList.add('correct');
            } else {
                userEl.classList.add('incorrect');
                const correctEl = document.querySelector(`#q-opts-${idx} .quiz-option[data-opt="${correctAns}"]`);
                if(correctEl) correctEl.classList.add('correct');
            }
        } else {
            const correctEl = document.querySelector(`#q-opts-${idx} .quiz-option[data-opt="${correctAns}"]`);
            if(correctEl) correctEl.classList.add('correct');
        }
        
        document.getElementById(`q-feedback-${idx}`).style.display = 'block';
    });
    
    const resultBox = document.getElementById('quiz-result-display');
    document.getElementById('quiz-score-text').textContent = `${score}/${currentQuizData.length}`;
    
    let feedback = '';
    const ratio = score / currentQuizData.length;
    if(ratio === 1) feedback = 'Tuyệt cú mèo! Bạn đã trả lời đúng tất cả.';
    else if(ratio >= 0.7) feedback = 'Khá lắm! Bạn hiểu bài rất tốt.';
    else if(ratio >= 0.5) feedback = 'Đạt yêu cầu! Nhưng cần ôn tập thêm nhé.';
    else feedback = 'Cố gắng lên! Hãy đọc kỹ tài liệu lại một lần nữa.';
    
    document.getElementById('quiz-feedback-text').textContent = feedback;
    resultBox.style.display = 'block';
    
    document.getElementById('btn-submit-quiz').style.display = 'none';
    
    if (!isReopen && currentQuizExerciseId) {
        const ex = state.exercises.find(e => e.id === currentQuizExerciseId);
        if (ex) {
            ex.completed = true;
            ex.score = score;
            saveUserData();
            renderExercises();
            if (typeof updatePendingExerciseCount === 'function') updatePendingExerciseCount();
        }
    }
}

function closeTakeQuizModal() {
    document.getElementById('take-quiz-modal').classList.remove('active');
}

// ==========================================
// VOCABULARY SPACED REPETITION SYSTEM
// ==========================================

let currentFlashcards = [];
let currentFlashcardIndex = 0;

function initVocabularySystem() {
    const btnOpenImport = document.getElementById('btn-open-import-vocab-modal');
    const btnCloseImport = document.getElementById('btn-close-import-vocab-modal');
    const btnCancelImport = document.getElementById('btn-cancel-import-vocab');
    const btnStartImport = document.getElementById('btn-start-import-vocab');
    
    const fileInput = document.getElementById('vocab-file-input');
    const uploadZone = document.getElementById('vocab-upload-zone');
    
    const btnCloseFlashcard = document.getElementById('btn-close-flashcard-modal');
    const btnForget = document.getElementById('btn-fc-forget');
    const btnRemember = document.getElementById('btn-fc-remember');

    if (btnOpenImport) btnOpenImport.addEventListener('click', () => document.getElementById('import-vocab-modal').classList.add('active'));
    if (btnCloseImport) btnCloseImport.addEventListener('click', () => document.getElementById('import-vocab-modal').classList.remove('active'));
    if (btnCancelImport) btnCancelImport.addEventListener('click', () => document.getElementById('import-vocab-modal').classList.remove('active'));
    
    if (btnStartImport) btnStartImport.addEventListener('click', startVocabImport);
    const btnOpenConfigVocab = document.getElementById('btn-open-ai-config-vocab');
    if (btnOpenConfigVocab) btnOpenConfigVocab.addEventListener('click', openAiConfigModal);
    
    if (uploadZone && fileInput) {
        uploadZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if(e.target.files && e.target.files[0]) {
                document.getElementById('vocab-file-name').textContent = e.target.files[0].name;
            }
        });
        uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--primary-color)'; });
        uploadZone.addEventListener('dragleave', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--border-color)'; });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = 'var(--border-color)';
            if(e.dataTransfer.files && e.dataTransfer.files[0]) {
                fileInput.files = e.dataTransfer.files;
                document.getElementById('vocab-file-name').textContent = e.dataTransfer.files[0].name;
            }
        });
    }

    if (btnCloseFlashcard) btnCloseFlashcard.addEventListener('click', closeFlashcardModal);
    if (btnForget) btnForget.addEventListener('click', handleVocabForget);
    if (btnRemember) btnRemember.addEventListener('click', handleVocabRemember);
    
    const tabVocab = document.getElementById('tab-vocabulary');
    if (tabVocab) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.target.classList.contains('active')) {
                    renderVocabTopics();
                }
            });
        });
        observer.observe(tabVocab, { attributes: true, attributeFilter: ['class'] });
    }
}

async function startVocabImport() {
    const fileInput = document.getElementById('vocab-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Vui lòng chọn hoặc kéo thả 1 file tài liệu (Hình ảnh, PDF, TXT) vào ô!');
        return;
    }
    const file = fileInput.files[0];
    const progressState = document.getElementById('vocab-progress-state');
    const progressText = document.getElementById('vocab-progress-text');
    const btnStart = document.getElementById('btn-start-import-vocab');

    progressState.style.display = 'block';
    btnStart.disabled = true;

    try {
        progressText.textContent = 'Đang đọc nội dung file...';

        let mimeType = file.type || 'image/png';
        let extractedText = '';

        const fileNameLower = file.name.toLowerCase();

        if (fileNameLower.endsWith('.pdf')) {
            mimeType = 'application/pdf';
            try {
                extractedText = await extractTextFromPDF(file);
            } catch (e) {
                console.warn('PDF text extraction error:', e);
            }
        } else if (fileNameLower.endsWith('.txt')) {
            mimeType = 'text/plain';
            extractedText = await file.text();
        }

        let resJson = null;

        // ChatGPT xử lý được cả chữ, hình và các trang PDF đã render.
        if (aiProvider === 'openai') {
            progressText.textContent = 'ChatGPT đang đọc tài liệu và tạo thẻ từ vựng...';
            const dataUrl = file.type.startsWith('image/') ? await readFileAsDataURL(file) : '';
            const imageDataUrls = fileNameLower.endsWith('.pdf') ? await renderPDFPagesForAI(file) : [];
            const response = await fetch('/api/ai/extract-vocabulary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl, imageDataUrls, extractedText, fileName: file.name })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = result.error === 'openai_not_configured'
                    ? 'Server chưa cấu hình OPENAI_API_KEY.'
                    : (result.error || 'Không thể phân tích tài liệu bằng ChatGPT.');
                throw new Error(message);
            }
            resJson = result.vocabulary;
        // Chế độ offline chỉ phù hợp cho PDF/TXT có thể trích xuất được chữ.
        } else if (aiProvider === 'offline' || !geminiApiKey) {
            progressText.textContent = 'Đang tự động bóc tách từ vựng từ tài liệu...';
            if (!extractedText.trim()) {
                throw new Error('Không đọc được chữ trong file này. Hãy chọn ChatGPT hoặc Gemini để quét ảnh/PDF dạng scan.');
            }
            const textToProcess = extractedText;
            resJson = parseVocabularyOffline(textToProcess, file.name);
        } else {
            // --- CHẾ ĐỘ 2: GỌI GOOGLE GEMINI AI ---
            progressText.textContent = 'Đang kết nối AI để bóc tách từ vựng (khoảng 5-15 giây)...';

            const base64Data = await readFileAsDataURL(file);
            let base64String = '';

            if (typeof base64Data === 'string' && base64Data.includes(';base64,')) {
                mimeType = base64Data.split(';')[0].split(':')[1] || mimeType;
                base64String = base64Data.split(',')[1];
            } else {
                base64String = String(base64Data);
            }

            const generateModels = await getGeminiGenerateModels();
            const promptText = "Bạn là hệ thống AI bóc tách từ vựng tiếng Anh chuyên nghiệp. Dựa vào hình ảnh/tài liệu đính kèm" +
                (extractedText ? " và nội dung văn bản sau:\n" + extractedText : "") +
                ", hãy tìm và trích xuất TẤT CẢ các từ vựng tiếng Anh xuất hiện kèm theo nghĩa tiếng Việt chuẩn xác nhất.\n\n" +
                "Hãy trả về DUY NHẤT một mảng JSON theo mẫu:\n" +
                "[\n  {\n    \"word\": \"apple\",\n    \"meaning\": \"quả táo\",\n    \"example\": \"I eat an apple.\",\n    \"topic\": \"Tài liệu vựng\"\n  }\n]";

            let lastError = null;

            for (let modelName of generateModels) {
                try {
                    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + encodeURIComponent(geminiApiKey);
                    const parts = [{ text: promptText }];
                    if (base64String) {
                        parts.push({ inlineData: { mimeType: mimeType, data: base64String } });
                    }

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: parts }],
                            generationConfig: { temperature: 0.2 }
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        let resText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (resText) {
                            resText = resText.replace(/```json/gi, '').replace(/```/g, '').trim();
                            const jsonMatch = resText.match(/\[[\s\S]*\]/);
                            resJson = JSON.parse(jsonMatch ? jsonMatch[0] : resText);
                            if (Array.isArray(resJson) && resJson.length > 0) break;
                        }
                    } else {
                        const errData = await response.json().catch(() => ({}));
                        lastError = new Error(errData.error?.message || ("HTTP " + response.status));
                    }
                } catch (err) {
                    console.warn(modelName + " failed:", err);
                    lastError = err;
                }
            }

            // Fallback sang chế độ Offline nếu online AI bị lỗi quota/mạng
            if (!resJson || !Array.isArray(resJson) || resJson.length === 0) {
                console.warn("Online AI failed, falling back to Offline Scanner:", lastError);
                const textToProcess = extractedText;
                resJson = parseVocabularyOffline(textToProcess, file.name);
            }
        }

        if (resJson && Array.isArray(resJson) && resJson.length > 0) {
            if (!state.vocabulary) state.vocabulary = [];

            resJson.forEach(item => {
                state.vocabulary.push({
                    id: 'voc-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                    word: item.word,
                    meaning: item.meaning,
                    example: item.example || '',
                    topic: item.topic || 'Chưa phân loại',
                    stage: 0,
                    lastReviewed: 0,
                    nextReviewDate: 0
                });
            });

            saveUserData();
            document.getElementById('import-vocab-modal').classList.remove('active');
            renderVocabTopics();
            alert("🎉 Đã nhập thành công " + resJson.length + " từ vựng mới vào hệ thống!");
        } else {
            throw new Error('Không thể bóc tách từ vựng từ file này.');
        }
    } catch (err) {
        alert('Lỗi: ' + err.message);
    } finally {
        progressState.style.display = 'none';
        btnStart.disabled = false;
        fileInput.value = '';
        document.getElementById('vocab-file-name').textContent = '';
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function renderPDFPagesForAI(file) {
    if (typeof pdfjsLib === 'undefined') return [];
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const images = [];
    const numPages = Math.min(pdf.numPages, 5);
    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.78));
    }
    return images;
}

function calculateNextReviewDate(currentStage) {
    const now = Date.now();
    const msInDay = 24 * 60 * 60 * 1000;
    
    let daysToAdd = 1;
    switch(currentStage) {
        case 0: daysToAdd = 2; break; // Học xong lần 1, 2 ngày sau ôn
        case 1: daysToAdd = 4; break; // Ôn xong lần 1, 4 ngày sau ôn (tổng ~7 ngày)
        case 2: daysToAdd = 7; break; // Ôn xong lần 2, 7 ngày sau ôn (tổng ~14 ngày)
        case 3: daysToAdd = 16; break; // Ôn xong lần 3, 16 ngày sau ôn (tổng ~30 ngày)
        default: daysToAdd = 30; break;
    }
    return now + (daysToAdd * msInDay);
}

function renderVocabTopics() {
    const container = document.getElementById('vocab-topics-container');
    const statsInfo = document.getElementById('vocab-stats-info');
    const badge = document.getElementById('due-vocab-count-badge');
    if(!container) return;
    
    if(!state.vocabulary) state.vocabulary = [];
    
    const now = Date.now();
    let dueCount = 0;
    
    const topicsMap = {};
    
    state.vocabulary.forEach(v => {
        if(!topicsMap[v.topic]) topicsMap[v.topic] = { total: 0, due: 0, mastered: 0 };
        topicsMap[v.topic].total++;
        
        const isDue = (v.stage === 0) || (v.nextReviewDate > 0 && now >= v.nextReviewDate);
        if (isDue) {
            topicsMap[v.topic].due++;
            dueCount++;
        }
        if (v.stage >= 4) {
            topicsMap[v.topic].mastered++;
        }
    });
    
    if(statsInfo) statsInfo.innerHTML = `Bạn có <strong>${dueCount}</strong> từ vựng cần học/ôn tập hôm nay.`;
    if (badge) {
        badge.textContent = dueCount;
        badge.style.display = dueCount > 0 ? 'inline-block' : 'none';
    }
    
    container.innerHTML = '';
    
    if (Object.keys(topicsMap).length === 0) {
        container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-icon"><i class="fa-solid fa-box-open"></i></div>
            <p>Chưa có từ vựng nào. Hãy quét file để thêm!</p>
        </div>`;
        return;
    }
    
    Object.keys(topicsMap).forEach(topic => {
        const stats = topicsMap[topic];
        const hasDue = stats.due > 0;
        
        const card = document.createElement('div');
        card.className = 'task-item';
        card.style.flexDirection = 'column';
        card.style.alignItems = 'flex-start';
        card.style.cursor = 'pointer';
        card.style.borderLeft = hasDue ? '4px solid var(--danger-color)' : '4px solid var(--success-color)';
        
        card.innerHTML = `
            <h4 style="margin:0; font-size: 1.1rem;">${escapeHTML(topic)}</h4>
            <div style="margin-top: 8px; font-size: 0.9rem; color: var(--text-secondary); width: 100%; display: flex; justify-content: space-between;">
                <span>Tổng: ${stats.total} từ</span>
                ${hasDue ? `<span style="color: var(--danger-color); font-weight: bold;"><i class="fa-solid fa-clock"></i> Cần ôn: ${stats.due}</span>` : `<span style="color: var(--success-color);"><i class="fa-solid fa-check"></i> Đã ôn xong</span>`}
            </div>
            <button class="btn ${hasDue ? 'btn-primary' : 'btn-outline'} btn-sm" style="margin-top: 15px; width: 100%;">
                <i class="fa-solid fa-layer-group"></i> Học Chủ Đề Này
            </button>
        `;
        card.querySelector('button')?.addEventListener('click', () => openFlashcards(encodeURIComponent(topic)));
        container.appendChild(card);
    });
}

window.toggleFlashcardFlip = function() {
    document.getElementById('flashcard-card-element').classList.toggle('flipped');
};

window.openFlashcards = function(encodedTopic) {
    const topic = decodeURIComponent(encodedTopic);
    const now = Date.now();
    
    currentFlashcards = state.vocabulary.filter(v => v.topic === topic && ((v.stage === 0) || (v.nextReviewDate > 0 && now >= v.nextReviewDate)));
    
    if (currentFlashcards.length === 0) {
        alert('Tuyệt vời! Bạn đã hoàn thành tất cả từ vựng cần ôn trong chủ đề này hôm nay.');
        return;
    }
    
    currentFlashcardIndex = 0;
    const topicTitle = document.getElementById('flashcard-topic-title');
    if (topicTitle) {
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-graduation-cap';
        topicTitle.replaceChildren(icon, document.createTextNode(` ${topic}`));
    }
    document.getElementById('flashcard-modal').classList.add('active');
    
    renderCurrentFlashcard();
};

function renderCurrentFlashcard() {
    if (currentFlashcardIndex >= currentFlashcards.length) {
        alert('🎉 Bạn đã hoàn thành tất cả thẻ của phiên học này!');
        closeFlashcardModal();
        renderVocabTopics();
        return;
    }
    
    const wordObj = currentFlashcards[currentFlashcardIndex];
    document.getElementById('flashcard-card-element').classList.remove('flipped');
    
    document.getElementById('fc-word').textContent = wordObj.word;
    document.getElementById('fc-meaning').textContent = wordObj.meaning;
    document.getElementById('fc-example').textContent = wordObj.example || '';
    
    document.getElementById('flashcard-progress-text').textContent = `Từ ${currentFlashcardIndex + 1} / ${currentFlashcards.length}`;
}

function handleVocabForget(e) {
    if (e) e.stopPropagation();
    const wordObj = currentFlashcards[currentFlashcardIndex];
    
    wordObj.stage = 0;
    wordObj.lastReviewed = Date.now();
    wordObj.nextReviewDate = 0; 
    saveUserData();
    
    currentFlashcardIndex++;
    renderCurrentFlashcard();
}

function handleVocabRemember(e) {
    if (e) e.stopPropagation();
    const wordObj = currentFlashcards[currentFlashcardIndex];
    
    wordObj.nextReviewDate = calculateNextReviewDate(wordObj.stage);
    wordObj.stage++;
    wordObj.lastReviewed = Date.now();
    saveUserData();
    
    currentFlashcardIndex++;
    renderCurrentFlashcard();
}

function closeFlashcardModal() {
    document.getElementById('flashcard-modal').classList.remove('active');
    renderVocabTopics();
}
