/* ==========================================================================
   STUDYFLOW - BACKEND SERVER
   Lưu trữ dữ liệu người dùng dưới dạng file JSON trên Railway Volume.
   Mặc định đường dẫn volume là /date (đổi bằng biến môi trường DATA_DIR).
   + Socket.IO cho signaling cuộc gọi video/audio & đồng bộ nhắn tin/kết bạn real-time.
   ========================================================================== */

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Đường dẫn tới Volume đã mount trên Railway (mặc định: /date)
const DATA_DIR = process.env.DATA_DIR || '/date';
const USERS_DIR = path.join(DATA_DIR, 'userdata');

// Đảm bảo thư mục tồn tại (chạy lần đầu / máy chủ mới khởi động)
function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
}
ensureDirs();

const SYSTEM_DB_PATH = path.join(DATA_DIR, 'system-db.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Chặn ký tự lạ trong userId để tránh path traversal khi ghi file
function safeUserId(userId) {
    return String(userId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
}

function readJsonFile(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            if (raw && raw.trim()) return JSON.parse(raw);
        }
        // Tự động khôi phục từ bản sao lưu .bak nếu file chính rỗng hoặc chưa tồn tại
        const bakPath = filePath + '.bak';
        if (fs.existsSync(bakPath)) {
            const bakRaw = fs.readFileSync(bakPath, 'utf-8');
            if (bakRaw && bakRaw.trim()) {
                console.log(`[Tự động khôi phục] Đã khôi phục dữ liệu từ bản sao lưu: ${bakPath}`);
                const parsed = JSON.parse(bakRaw);
                return parsed;
            }
        }
        return fallback;
    } catch (err) {
        console.error('Lỗi đọc file', filePath, err);
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    // Sao lưu bản hiện tại trước khi ghi đè (nếu file đã tồn tại và không rỗng), để
    // luôn có 1 bản ".bak" gần nhất có thể khôi phục thủ công nếu chẳng may bản ghi mới
    // bị lỗi hoặc rỗng bất thường (ví dụ do lỗi mạng/khởi động lại giữa chừng).
    try {
        if (fs.existsSync(filePath)) {
            const currentRaw = fs.readFileSync(filePath, 'utf-8');
            if (currentRaw && currentRaw.trim()) {
                fs.writeFileSync(filePath + '.bak', currentRaw, 'utf-8');
            }
        }
    } catch (err) {
        console.error('Không thể tạo bản sao lưu cho', filePath, err);
    }

    // Ghi ra file tạm trước rồi đổi tên, tránh hỏng file nếu server bị crash giữa chừng
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

// Hàm hợp nhất (merge) dữ liệu System DB an toàn chống ghi đè/mất mát
function mergeSystemDB(incomingData) {
    const currentData = readJsonFile(SYSTEM_DB_PATH, { users: [], friendships: [], messages: [], groups: [] });
    const { users = [], friendships = [], messages = [], groups = [] } = incomingData || {};

    // 1. Merge users (theo userId)
    const usersMap = new Map();
    (currentData.users || []).forEach(u => { if (u && u.userId) usersMap.set(u.userId, u); });
    users.forEach(u => { if (u && u.userId) usersMap.set(u.userId, u); });

    // 2. Merge friendships (theo id hoặc cặp user1-user2)
    const friendshipsMap = new Map();
    (currentData.friendships || []).forEach(f => {
        if (f) {
            const key = f.id || `${f.user1}_${f.user2}`;
            friendshipsMap.set(key, f);
        }
    });
    friendships.forEach(f => {
        if (f) {
            const key = f.id || `${f.user1}_${f.user2}`;
            friendshipsMap.set(key, f);
        }
    });

    // 3. Merge groups (theo id)
    const groupsMap = new Map();
    (currentData.groups || []).forEach(g => { if (g && g.id) groupsMap.set(g.id, g); });
    groups.forEach(g => { if (g && g.id) groupsMap.set(g.id, g); });

    // 4. Merge messages (theo id) - Lọc bỏ tin nhắn hết hạn 7 ngày
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const messagesMap = new Map();

    (currentData.messages || []).forEach(m => {
        if (m && m.id && (now - m.timestamp < SEVEN_DAYS_MS)) {
            messagesMap.set(m.id, m);
        }
    });
    messages.forEach(m => {
        if (m && m.id && (now - m.timestamp < SEVEN_DAYS_MS)) {
            messagesMap.set(m.id, m);
        }
    });

    const merged = {
        users: Array.from(usersMap.values()),
        friendships: Array.from(friendshipsMap.values()),
        groups: Array.from(groupsMap.values()),
        messages: Array.from(messagesMap.values()).sort((a, b) => a.timestamp - b.timestamp)
    };

    writeJsonFile(SYSTEM_DB_PATH, merged);
    return merged;
}

/* ---------------- SYSTEM DB (users / friendships / messages / groups) ---------------- */

// Lấy toàn bộ system DB
app.get('/api/system-db', (req, res) => {
    const data = readJsonFile(SYSTEM_DB_PATH, { users: [], friendships: [], messages: [], groups: [] });
    res.json(data);
});

// Ghi đè / hợp nhất system DB
app.put('/api/system-db', (req, res) => {
    try {
        const updated = mergeSystemDB(req.body || {});
        io.emit('system-db-updated', updated);
        res.json({ ok: true, data: updated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'save_failed' });
    }
});

/* ---------------- USER DATA (tasks / subjects / mailbox / streak...) ---------------- */

// Lấy dữ liệu của 1 người dùng
app.get('/api/user-data/:userId', (req, res) => {
    const userId = safeUserId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'invalid_user_id' });

    const filePath = path.join(USERS_DIR, `${userId}.json`);
    const data = readJsonFile(filePath, null);
    if (data === null) return res.status(404).json({ error: 'not_found' });
    res.json(data);
});

// Lưu / ghi đè dữ liệu của 1 người dùng
app.put('/api/user-data/:userId', (req, res) => {
    const userId = safeUserId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'invalid_user_id' });

    try {
        const filePath = path.join(USERS_DIR, `${userId}.json`);
        writeJsonFile(filePath, req.body || {});
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'save_failed' });
    }
});

// Xóa hẳn dữ liệu của 1 người dùng
app.delete('/api/user-data/:userId', (req, res) => {
    const userId = safeUserId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'invalid_user_id' });

    const filePath = path.join(USERS_DIR, `${userId}.json`);
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'delete_failed' });
    }
});

// Kiểm tra sức khỏe server (Railway healthcheck)
app.get('/api/health', (req, res) => {
    res.json({ ok: true, dataDir: DATA_DIR });
});

// Trả về index.html cho mọi route còn lại (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ==========================================================================
   SOCKET.IO - SIGNALING CUỘC GỌI VÀ ĐỒNG BỘ REAL-TIME (TIN NHẮN & KẾT BẠN)
   ========================================================================== */

const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log(`[Socket] Kết nối mới: ${socket.id}`);

    // Khi user đăng nhập, đăng ký userId -> socketId
    socket.on('user-online', (userId) => {
        if (!userId) return;
        onlineUsers.set(userId, socket.id);
        socket.userId = userId;
        console.log(`[Socket] ${userId} đã online (${socket.id})`);

        io.emit('online-users', Array.from(onlineUsers.keys()));
    });

    socket.on('get-online-users', () => {
        socket.emit('online-users', Array.from(onlineUsers.keys()));
    });

    // Khi có dữ liệu System DB mới (đăng ký, kết bạn, nhắn tin)
    socket.on('sync-system-db', (data) => {
        const updated = mergeSystemDB(data);
        io.emit('system-db-updated', updated);
    });

    // Gửi tin nhắn mới real-time
    socket.on('send-message', (msgData) => {
        if (!msgData || !msgData.id) return;
        const updated = mergeSystemDB({ messages: [msgData] });
        io.emit('system-db-updated', updated);
    });

    // Tạo kết bạn mới real-time
    socket.on('add-friendship', (friendshipData) => {
        if (!friendshipData || !friendshipData.id) return;
        const updated = mergeSystemDB({ friendships: [friendshipData] });
        io.emit('system-db-updated', updated);
    });

    // Tạo nhóm mới real-time
    socket.on('create-group', (groupData) => {
        if (!groupData || !groupData.id) return;
        const updated = mergeSystemDB({ groups: [groupData] });
        io.emit('system-db-updated', updated);
    });

    // Call signaling events...
    socket.on('call-request', (data) => {
        const targetSocketId = onlineUsers.get(data.targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming-call', {
                callerId: data.callerId,
                callerName: data.callerName,
                callType: data.callType,
                callerPeerId: data.callerPeerId
            });
        } else {
            socket.emit('call-failed', {
                reason: 'offline',
                message: 'Người dùng không trực tuyến.'
            });
        }
    });

    socket.on('call-accepted', (data) => {
        const callerSocketId = onlineUsers.get(data.callerId);
        if (callerSocketId) {
            io.to(callerSocketId).emit('call-accepted', {
                accepterPeerId: data.accepterPeerId
            });
        }
    });

    socket.on('call-rejected', (data) => {
        const callerSocketId = onlineUsers.get(data.callerId);
        if (callerSocketId) {
            io.to(callerSocketId).emit('call-rejected', {
                reason: data.reason || 'Cuộc gọi bị từ chối.'
            });
        }
    });

    socket.on('call-ended', (data) => {
        const targetSocketId = onlineUsers.get(data.targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-ended', {
                endedBy: socket.userId
            });
        }
    });

    socket.on('toggle-camera', (data) => {
        const targetSocketId = onlineUsers.get(data.targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('remote-toggle-camera', {
                cameraOn: data.cameraOn
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            console.log(`[Socket] ${socket.userId} đã offline`);
            io.emit('online-users', Array.from(onlineUsers.keys()));
        }
    });
});

server.listen(PORT, () => {
    console.log(`StudyFlow server đang chạy tại cổng ${PORT}`);
    console.log(`Dữ liệu được lưu tại: ${DATA_DIR}`);
    console.log(`Socket.IO signaling & real-time messaging đã sẵn sàng.`);

    // In số lượng user/friendship/message hiện có ngay khi khởi động, để kiểm tra
    // trong log Railway sau mỗi lần deploy: nếu con số này bất ngờ về 0 sau khi bạn
    // vừa cập nhật code, gần như chắc chắn Volume KHÔNG được gắn đúng /giữ nguyên
    // giữa các lần deploy (kiểm tra lại Settings → Volumes → Mount Path = /date).
    const dbAtBoot = readJsonFile(SYSTEM_DB_PATH, { users: [], friendships: [], messages: [] });
    console.log(`[Khởi động] Dữ liệu hiện có trên volume: ${dbAtBoot.users.length} user, ${dbAtBoot.friendships.length} kết bạn, ${dbAtBoot.messages.length} tin nhắn.`);
    if (dbAtBoot.users.length === 0) {
        console.log('[Khởi động] ⚠️  Không thấy user nào trong system-db.json. Nếu bạn đã từng có user trước đó, kiểm tra xem Volume có đang gắn đúng mount path (mặc định /date) và có được giữ nguyên qua lần deploy này không.');
    }
});
