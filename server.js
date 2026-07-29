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
const OpenAI = require('openai');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

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

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- AI QUIZ GENERATION (OpenAI) ---------------- */

function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) return null;
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getOpenAIErrorDetails(err) {
    const status = Number(err?.status || err?.response?.status || 0);
    const code = String(err?.code || err?.error?.code || err?.response?.data?.error?.code || '').toLowerCase();
    const message = String(err?.message || err?.error?.message || '').toLowerCase();

    const quotaExceeded = status === 429 && (
        code === 'insufficient_quota' ||
        message.includes('exceeded your current quota') ||
        message.includes('billing') ||
        message.includes('quota')
    );
    if (quotaExceeded) {
        return {
            status: 429,
            body: {
                ok: false,
                error: 'openai_quota_exceeded',
                message: 'OpenAI API đã hết hạn mức sử dụng. Hãy kiểm tra số dư và giới hạn chi tiêu trong trang Billing của OpenAI.',
                retryable: false
            }
        };
    }

    if (status === 429) {
        return {
            status: 429,
            body: {
                ok: false,
                error: 'openai_rate_limited',
                message: 'OpenAI đang giới hạn tốc độ yêu cầu. Vui lòng chờ một lúc rồi thử lại.',
                retryable: true
            }
        };
    }

    if (status === 401 || code === 'invalid_api_key') {
        return {
            status: 401,
            body: {
                ok: false,
                error: 'openai_invalid_api_key',
                message: 'OPENAI_API_KEY trên máy chủ không hợp lệ hoặc đã bị thu hồi.',
                retryable: false
            }
        };
    }

    if (status === 403) {
        return {
            status: 403,
            body: {
                ok: false,
                error: 'openai_access_denied',
                message: 'API key hiện không có quyền sử dụng model được cấu hình.',
                retryable: false
            }
        };
    }

    if (status === 404 || code === 'model_not_found' || message.includes('model_not_found')) {
        return {
            status: 400,
            body: {
                ok: false,
                error: 'openai_model_unavailable',
                message: 'Model OpenAI được cấu hình không tồn tại hoặc tài khoản chưa được cấp quyền.',
                retryable: false
            }
        };
    }

    if (message === 'empty_quiz' || message === 'invalid_quiz' ||
        message === 'empty_vocabulary' || message === 'invalid_vocabulary') {
        return {
            status: 502,
            body: {
                ok: false,
                error: 'openai_invalid_response',
                message: 'AI chưa trả về dữ liệu đúng cấu trúc. Vui lòng thử lại với tài liệu rõ hơn.',
                retryable: true
            }
        };
    }

    return {
        status: 502,
        body: {
            ok: false,
            error: 'openai_request_failed',
            message: 'Không thể xử lý yêu cầu bằng OpenAI lúc này. Vui lòng thử lại sau.',
            retryable: true
        }
    };
}

function shouldRetryOpenAIError(err) {
    const details = getOpenAIErrorDetails(err);
    return details.body.error === 'openai_rate_limited' ||
        Number(err?.status || 0) >= 500 ||
        ['ECONNRESET', 'ETIMEDOUT'].includes(String(err?.code || '').toUpperCase());
}

async function runOpenAIWithRetry(operation, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;
            if (attempt >= maxRetries || !shouldRetryOpenAIError(err)) throw err;
            const delayMs = 500 * (2 ** attempt) + Math.floor(Math.random() * 250);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}

app.post('/api/ai/generate-quiz', async (req, res) => {
    const client = getOpenAIClient();
    if (!client) return res.status(503).json({ ok: false, error: 'openai_not_configured' });

    const { dataUrl, imageDataUrls = [], extractedText = '', topic = '', fileName = '' } = req.body || {};
    if (!dataUrl && !imageDataUrls.length && !extractedText.trim()) {
        return res.status(400).json({ ok: false, error: 'missing_input' });
    }

    const prompt = `Bạn là hệ thống tạo bài tập học tập từ tài liệu đầu vào.
Hãy đọc kỹ tài liệu, giữ nguyên dữ kiện, công thức, ký hiệu và nội dung trong hình nếu có.
${fileName ? `Tên tài liệu: ${fileName}` : ''}
${topic ? `Yêu cầu thêm của người dùng: ${topic}` : ''}

Quy tắc:
- Nếu tài liệu có câu hỏi và đáp án sẵn, bóc tách chính xác, không tự sửa nội dung.
- Nếu tài liệu chưa có câu hỏi, tạo 10-20 câu kiểm tra kiến thức quan trọng.
- Mỗi câu chọn một trong hai dạng: multiple_choice hoặc true_false.
- multiple_choice bắt buộc có đúng 4 đáp án khác nhau; true_false bắt buộc có options ["Đúng", "Sai"].
- answer là chỉ số bắt đầu từ 0 của đáp án đúng.
- explanation giải thích ngắn gọn, dễ hiểu bằng tiếng Việt.
- Không bịa thông tin không có trong tài liệu. Nếu hình không đủ rõ, nêu điều đó trong explanation và tránh tạo câu hỏi dựa vào phần không đọc được.
- Trả về JSON thuần theo cấu trúc {"questions":[...]}.

Mỗi câu có dạng:
{"type":"multiple_choice","question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}
hoặc:
{"type":"true_false","question":"...","options":["Đúng","Sai"],"answer":0,"explanation":"..."}`;

    const content = [{ type: 'text', text: prompt }];
    if (extractedText.trim()) content.push({ type: 'text', text: `Nội dung văn bản trích xuất:\n${extractedText.slice(0, 50000)}` });
    if (dataUrl && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(dataUrl)) {
        content.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    imageDataUrls.slice(0, 5).forEach(image => {
        if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(image)) {
            content.push({ type: 'image_url', image_url: { url: image } });
        }
    });

    try {
        const completion = await runOpenAIWithRetry(() => client.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: 'Bạn luôn trả về JSON hợp lệ, không có markdown.' },
                { role: 'user', content }
            ]
        }));
        const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        const questions = Array.isArray(parsed) ? parsed : parsed.questions;
        if (!Array.isArray(questions) || !questions.length) throw new Error('empty_quiz');

        const normalized = questions.slice(0, 30).map(q => {
            const type = q.type === 'true_false' ? 'true_false' : 'multiple_choice';
            const options = type === 'true_false' ? ['Đúng', 'Sai'] : (Array.isArray(q.options) ? q.options.slice(0, 4) : []);
            if (type === 'multiple_choice' && options.length !== 4) return null;
            const answer = Number(q.answer);
            if (!q.question || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
            return { type, question: String(q.question), options: options.map(String), answer, explanation: String(q.explanation || '') };
        }).filter(Boolean);

        if (!normalized.length) throw new Error('invalid_quiz');
        res.json({ ok: true, questions: normalized });
    } catch (err) {
        console.error('[OpenAI quiz]', err);
        const details = getOpenAIErrorDetails(err);
        res.status(details.status).json(details.body);
    }
});

app.post('/api/ai/extract-vocabulary', async (req, res) => {
    const client = getOpenAIClient();
    if (!client) return res.status(503).json({ ok: false, error: 'openai_not_configured' });

    const { dataUrl, imageDataUrls = [], extractedText = '', fileName = '' } = req.body || {};
    if (!dataUrl && !imageDataUrls.length && !extractedText.trim()) {
        return res.status(400).json({ ok: false, error: 'missing_input' });
    }

    const content = [{
        type: 'text',
        text: `Bạn là trợ lý học tiếng Anh. Hãy trích xuất các từ hoặc cụm từ tiếng Anh thực sự có trong tài liệu${fileName ? ` "${fileName}"` : ''}.
Với mỗi mục, cung cấp nghĩa tiếng Việt ngắn gọn, một ví dụ tiếng Anh đơn giản, và chủ đề phù hợp.
Không bịa thêm từ không xuất hiện trong tài liệu. Bỏ qua tên riêng, số, câu quá dài và từ không phải tiếng Anh.
Trả về JSON thuần theo dạng {"vocabulary":[{"word":"...","meaning":"...","example":"...","topic":"..."}]}.`
    }];
    if (extractedText.trim()) content.push({ type: 'text', text: `Nội dung văn bản trích xuất:\n${extractedText.slice(0, 50000)}` });
    if (dataUrl && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(dataUrl)) {
        content.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    imageDataUrls.slice(0, 5).forEach(image => {
        if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(image)) {
            content.push({ type: 'image_url', image_url: { url: image } });
        }
    });

    try {
        const completion = await runOpenAIWithRetry(() => client.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: 'Bạn luôn trả về JSON hợp lệ, không có markdown.' },
                { role: 'user', content }
            ]
        }));
        const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        const vocabulary = Array.isArray(parsed) ? parsed : parsed.vocabulary;
        if (!Array.isArray(vocabulary) || !vocabulary.length) throw new Error('empty_vocabulary');

        const seen = new Set();
        const normalized = vocabulary.slice(0, 100).map(item => {
            const word = String(item.word || '').trim();
            const meaning = String(item.meaning || '').trim();
            const key = word.toLowerCase();
            if (!word || !meaning || seen.has(key)) return null;
            seen.add(key);
            return {
                word: word.slice(0, 120),
                meaning: meaning.slice(0, 500),
                example: String(item.example || '').trim().slice(0, 500),
                topic: String(item.topic || 'Tài liệu vựng').trim().slice(0, 120)
            };
        }).filter(Boolean);
        if (!normalized.length) throw new Error('invalid_vocabulary');
        res.json({ ok: true, vocabulary: normalized });
    } catch (err) {
        console.error('[OpenAI vocabulary]', err);
        const details = getOpenAIErrorDetails(err);
        res.status(details.status).json(details.body);
    }
});

// Chặn ký tự lạ trong userId để tránh path traversal khi ghi file
function safeUserId(userId) {
    return String(userId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
}

function toPublicUser(user) {
    if (!user || typeof user !== 'object') return user;
    const { password, passwordHash, ...publicUser } = user;
    return publicUser;
}

function toPublicSystemDB(data) {
    return {
        users: (data.users || []).map(toPublicUser),
        friendships: data.friendships || [],
        messages: data.messages || [],
        groups: data.groups || []
    };
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
    users.forEach(u => {
        if (!u || !u.userId) return;
        const existing = usersMap.get(u.userId) || {};
        // Hồ sơ từ client không được xóa hoặc thay thế thông tin xác thực trên server.
        usersMap.set(u.userId, {
            ...existing,
            ...toPublicUser(u),
            ...(existing.passwordHash ? { passwordHash: existing.passwordHash } : {}),
            ...(existing.password ? { password: existing.password } : {})
        });
    });

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

/* ---------------- AUTHENTICATION ---------------- */

app.post('/api/auth/register', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const userId = safeUserId(String(req.body?.userId || '').toLowerCase());
    const password = String(req.body?.password || '');

    if (!name || !userId || password.length < 4) {
        return res.status(400).json({ ok: false, error: 'invalid_registration' });
    }

    try {
        const db = readJsonFile(SYSTEM_DB_PATH, { users: [], friendships: [], messages: [], groups: [] });
        if ((db.users || []).some(user => user?.userId === userId)) {
            return res.status(409).json({ ok: false, error: 'user_exists' });
        }

        const user = {
            id: `user-${randomUUID()}`,
            name: name.slice(0, 120),
            userId,
            passwordHash: await bcrypt.hash(password, 12),
            createdAt: Date.now()
        };
        db.users = [...(db.users || []), user];
        writeJsonFile(SYSTEM_DB_PATH, db);

        const publicDb = toPublicSystemDB(db);
        io.emit('system-db-updated', publicDb);
        res.status(201).json({ ok: true, user: toPublicUser(user) });
    } catch (err) {
        console.error('[Auth register]', err);
        res.status(500).json({ ok: false, error: 'registration_failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const userId = safeUserId(String(req.body?.userId || '').toLowerCase());
    const password = String(req.body?.password || '');

    if (!userId || !password) {
        return res.status(400).json({ ok: false, error: 'invalid_login' });
    }

    try {
        const db = readJsonFile(SYSTEM_DB_PATH, { users: [], friendships: [], messages: [], groups: [] });
        const user = (db.users || []).find(item => item?.userId === userId);
        if (!user) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

        const valid = user.passwordHash
            ? await bcrypt.compare(password, user.passwordHash)
            : user.password === password;
        if (!valid) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

        // Tự động chuyển tài khoản cũ đang lưu mật khẩu thường sang bcrypt.
        if (!user.passwordHash) {
            user.passwordHash = await bcrypt.hash(password, 12);
            delete user.password;
            writeJsonFile(SYSTEM_DB_PATH, db);
        }

        res.json({ ok: true, user: toPublicUser(user) });
    } catch (err) {
        console.error('[Auth login]', err);
        res.status(500).json({ ok: false, error: 'login_failed' });
    }
});

/* ---------------- SYSTEM DB (users / friendships / messages / groups) ---------------- */

// Lấy toàn bộ system DB
app.get('/api/system-db', (req, res) => {
    const data = readJsonFile(SYSTEM_DB_PATH, { users: [], friendships: [], messages: [], groups: [] });
    res.json(toPublicSystemDB(data));
});

// Ghi đè / hợp nhất system DB
app.put('/api/system-db', (req, res) => {
    try {
        const updated = mergeSystemDB(req.body || {});
        const publicUpdated = toPublicSystemDB(updated);
        io.emit('system-db-updated', publicUpdated);
        res.json({ ok: true, data: publicUpdated });
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
        io.emit('system-db-updated', toPublicSystemDB(updated));
    });

    // Gửi tin nhắn mới real-time
    socket.on('send-message', (msgData) => {
        if (!msgData || !msgData.id) return;
        const updated = mergeSystemDB({ messages: [msgData] });
        io.emit('system-db-updated', toPublicSystemDB(updated));
    });

    // Tạo kết bạn mới real-time
    socket.on('add-friendship', (friendshipData) => {
        if (!friendshipData || !friendshipData.id) return;
        const updated = mergeSystemDB({ friendships: [friendshipData] });
        io.emit('system-db-updated', toPublicSystemDB(updated));
    });

    // Tạo nhóm mới real-time
    socket.on('create-group', (groupData) => {
        if (!groupData || !groupData.id) return;
        const updated = mergeSystemDB({ groups: [groupData] });
        io.emit('system-db-updated', toPublicSystemDB(updated));
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

module.exports = { app, server, getOpenAIErrorDetails, shouldRetryOpenAIError };
