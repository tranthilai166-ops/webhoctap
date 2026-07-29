const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studyflow-test-'));
process.env.PORT = '0';
process.env.DATA_DIR = testDataDir;
delete process.env.OPENAI_API_KEY;

const { server } = require('../server');

async function ensureServerListening() {
    if (server.listening) return;
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
}

async function request(route, options = {}) {
    await ensureServerListening();
    const { port } = server.address();
    return fetch(`http://127.0.0.1:${port}${route}`, options);
}

function jsonOptions(method, body) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

test.after(async () => {
    if (server.listening) {
        await new Promise(resolve => server.close(resolve));
    }
    fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('health check và trang web hoạt động', async () => {
    const healthResponse = await request('/api/health');
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).ok, true);

    const pageResponse = await request('/');
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.text();
    assert.match(page, /StudyFlow/);
    assert.match(page, /id="btn-add-vocab-manual"/);
    assert.match(page, /id="vocab-manager-modal"/);
    assert.match(page, /id="vocab-confirm-modal"/);
});

test('đăng ký, đăng nhập và bảo vệ mật khẩu', async () => {
    const account = {
        name: 'Người dùng kiểm thử',
        userId: 'smoke_user',
        password: 'safe-password'
    };

    const registerResponse = await request('/api/auth/register', jsonOptions('POST', account));
    assert.equal(registerResponse.status, 201);
    const registered = await registerResponse.json();
    assert.equal(registered.ok, true);
    assert.equal(registered.user.userId, account.userId);
    assert.equal('password' in registered.user, false);
    assert.equal('passwordHash' in registered.user, false);

    const duplicateResponse = await request('/api/auth/register', jsonOptions('POST', account));
    assert.equal(duplicateResponse.status, 409);

    const wrongPasswordResponse = await request('/api/auth/login', jsonOptions('POST', {
        userId: account.userId,
        password: 'wrong-password'
    }));
    assert.equal(wrongPasswordResponse.status, 401);

    const loginResponse = await request('/api/auth/login', jsonOptions('POST', account));
    assert.equal(loginResponse.status, 200);
    const loggedIn = await loginResponse.json();
    assert.equal(loggedIn.ok, true);
    assert.equal('password' in loggedIn.user, false);
    assert.equal('passwordHash' in loggedIn.user, false);

    const publicDbResponse = await request('/api/system-db');
    const publicDb = await publicDbResponse.json();
    assert.equal(publicDb.users.length, 1);
    assert.equal('password' in publicDb.users[0], false);
    assert.equal('passwordHash' in publicDb.users[0], false);

    const storedDb = JSON.parse(fs.readFileSync(path.join(testDataDir, 'system-db.json'), 'utf8'));
    assert.match(storedDb.users[0].passwordHash, /^\$2[aby]\$/);
    assert.equal('password' in storedDb.users[0], false);
});

test('lưu, tải và xóa dữ liệu học tập', async () => {
    const userData = {
        tasks: [{ id: 'task-smoke', title: 'Ôn bài', completed: false }],
        subjects: [],
        mailbox: [],
        exercises: [],
        vocabulary: []
    };

    const saveResponse = await request('/api/user-data/smoke_user', jsonOptions('PUT', userData));
    assert.equal(saveResponse.status, 200);
    assert.equal((await saveResponse.json()).ok, true);

    const loadResponse = await request('/api/user-data/smoke_user');
    assert.equal(loadResponse.status, 200);
    assert.deepEqual(await loadResponse.json(), userData);

    const deleteResponse = await request('/api/user-data/smoke_user', { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);

    const missingResponse = await request('/api/user-data/smoke_user');
    assert.equal(missingResponse.status, 404);
});

test('API AI báo cấu hình thiếu rõ ràng khi chưa có khóa', async () => {
    const quizResponse = await request('/api/ai/generate-quiz', jsonOptions('POST', {
        extractedText: 'Water boils at 100 degrees Celsius.'
    }));
    assert.equal(quizResponse.status, 503);
    assert.equal((await quizResponse.json()).error, 'openai_not_configured');

    const vocabularyResponse = await request('/api/ai/extract-vocabulary', jsonOptions('POST', {
        extractedText: 'apple: quả táo'
    }));
    assert.equal(vocabularyResponse.status, 503);
    assert.equal((await vocabularyResponse.json()).error, 'openai_not_configured');
});
