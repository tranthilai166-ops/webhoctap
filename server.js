/* ==========================================================================
   STUDYFLOW - BACKEND SERVER
   Lưu trữ dữ liệu người dùng dưới dạng file JSON trên Railway Volume.
   Mặc định đường dẫn volume là /date (đổi bằng biến môi trường DATA_DIR).
   + Socket.IO cho signaling cuộc gọi video/audio.
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
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.error('Lỗi đọc file', filePath, err);
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    // Ghi ra file tạm trước rồi đổi tên, tránh hỏng file nếu server bị crash giữa chừng
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/* ---------------- SYSTEM DB (users / friendships / messages) ---------------- */

// Lấy toàn bộ system DB
app.get('/api/system-db', (req, res) => {
    const data = readJsonFile(SYSTEM_DB_PATH, { users: [], friendships: [], messages: [] });
    res.json(data);
});

// Ghi đè toàn bộ system DB (gọi mỗi khi có thay đổi: đăng ký, kết bạn, chat, xóa...)
app.put('/api/system-db', (req, res) => {
    try {
        const { users, friendships, messages } = req.body || {};
        writeJsonFile(SYSTEM_DB_PATH, {
            users: users || [],
            friendships: friendships || [],
            messages: messages || []
        });
        res.json({ ok: true });
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

// Lưu / ghi đè dữ liệu của 1 người dùng (mỗi lần app gọi saveUserData())
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

// Xóa hẳn dữ liệu của 1 người dùng (ví dụ khi người dùng xóa tài khoản)
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
   SOCKET.IO - SIGNALING CHO CUỘC GỌI VIDEO/AUDIO
   Quản lý trạng thái online và chuyển tiếp tín hiệu cuộc gọi giữa 2 user.
   ========================================================================== */

// Map: userId -> socketId (theo dõi ai đang online)
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log(`[Socket] Kết nối mới: ${socket.id}`);

    // Khi user đăng nhập, đăng ký userId -> socketId
    socket.on('user-online', (userId) => {
        if (!userId) return;
        onlineUsers.set(userId, socket.id);
        socket.userId = userId;
        console.log(`[Socket] ${userId} đã online (${socket.id})`);

        // Thông báo cho tất cả client biết danh sách online cập nhật
        io.emit('online-users', Array.from(onlineUsers.keys()));
    });

    // Client yêu cầu danh sách user online hiện tại
    socket.on('get-online-users', () => {
        socket.emit('online-users', Array.from(onlineUsers.keys()));
    });

    // Gửi yêu cầu gọi tới user đích
    socket.on('call-request', (data) => {
        // data: { callerId, callerName, targetUserId, callType: 'video' | 'audio', callerPeerId }
        const targetSocketId = onlineUsers.get(data.targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming-call', {
                callerId: data.callerId,
                callerName: data.callerName,
                callType: data.callType,
                callerPeerId: data.callerPeerId
            });
        } else {
            // User đích không online
            socket.emit('call-failed', {
                reason: 'offline',
                message: 'Người dùng không trực tuyến.'
            });
        }
    });

    // User đích chấp nhận cuộc gọi
    socket.on('call-accepted', (data) => {
        // data: { callerId, accepterPeerId }
        const callerSocketId = onlineUsers.get(data.callerId);
        if (callerSocketId) {
            io.to(callerSocketId).emit('call-accepted', {
                accepterPeerId: data.accepterPeerId
            });
        }
    });

    // User đích từ chối cuộc gọi
    socket.on('call-rejected', (data) => {
        // data: { callerId, reason }
        const callerSocketId = onlineUsers.get(data.callerId);
        if (callerSocketId) {
            io.to(callerSocketId).emit('call-rejected', {
                reason: data.reason || 'Cuộc gọi bị từ chối.'
            });
        }
    });

    // Khi một bên kết thúc cuộc gọi
    socket.on('call-ended', (data) => {
        // data: { targetUserId }
        const targetSocketId = onlineUsers.get(data.targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-ended', {
                endedBy: socket.userId
            });
        }
    });

    // User bật/tắt camera - thông báo cho đối phương
    socket.on('toggle-camera', (data) => {
        const targetSocketId = onlineUsers.get(data.targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('remote-toggle-camera', {
                cameraOn: data.cameraOn
            });
        }
    });

    // Khi socket disconnect
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
    console.log(`Socket.IO signaling đã sẵn sàng cho cuộc gọi video/audio.`);
});
