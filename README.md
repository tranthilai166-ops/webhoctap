# StudyFlow — Hướng dẫn deploy lên Railway (lưu dữ liệu vào Volume `/date`)

## Cấu trúc project
```
studyflow-app/
├── server.js          # Backend Express: nhận dữ liệu từ trình duyệt, ghi ra volume
├── package.json
└── public/
    ├── index.html
    ├── app.js         # Đã sửa: mỗi lần lưu/xóa sẽ tự gửi lên server
    └── style.css
```

## Cách hoạt động
- Trước đây app chỉ lưu bằng `localStorage` (chỉ có trên máy/trình duyệt đó).
- Giờ mỗi lần gọi `saveUserData()` hoặc `saveSystemDB()` (tức là mỗi lần thêm, sửa,
  **hoặc xóa** — vì xóa cũng là lưu lại mảng đã bớt phần tử), app sẽ:
  1. Vẫn lưu vào `localStorage` như cũ (để dùng offline / phản hồi tức thì).
  2. Gửi `PUT` toàn bộ dữ liệu lên server (`/api/user-data/:userId` hoặc `/api/system-db`).
  3. Server ghi đè file JSON tương ứng trong volume `/date`.
- Vì server ghi đè (overwrite) toàn bộ file mỗi lần, nên khi người dùng **xóa** task,
  môn học, bạn bè, tin nhắn... trên trình duyệt, file trên volume cũng tự động phản
  ánh đúng — không còn phần tử đã xóa.
- Khi tải lại trang / đăng nhập, app hiển thị ngay dữ liệu từ `localStorage`, sau đó
  âm thầm gọi `GET /api/user-data/:userId` để lấy bản mới nhất từ volume (hữu ích nếu
  bạn dùng nhiều thiết bị).

## Dữ liệu được lưu ở đâu trong volume?
```
/date/system-db.json           # danh sách tài khoản, kết bạn, tin nhắn
/date/userdata/<userId>.json   # task, môn học, hộp thư, streak... của từng người dùng
```

## Khắc phục lỗi "Cannot find module '/app/server.js'"

Lỗi này nghĩa là Railway build container xong nhưng không tìm thấy `server.js`
ngay tại thư mục gốc `/app`. Nguyên nhân gần như luôn là **cấu trúc file trên
GitHub bị lồng thêm một cấp thư mục**. Kiểm tra repo GitHub của bạn:

✅ **Đúng** — các file nằm ngay tại gốc repo:
```
ten-repo/
├── server.js
├── package.json
├── railway.json
├── Procfile
└── public/
    ├── index.html
    ├── app.js
    └── style.css
```

❌ **Sai** — bị lồng thêm 1 cấp thư mục (ví dụ do kéo cả folder `studyflow-app`
vào repo):
```
ten-repo/
└── studyflow-app/
    ├── server.js
    └── ...
```

Nếu bị lồng, có 2 cách sửa:
1. Di chuyển toàn bộ file ra ngoài gốc repo rồi push lại, **hoặc**
2. Vào Railway → service → **Settings → Source → Root Directory**, nhập tên
   thư mục con (ví dụ `studyflow-app`) để Railway build đúng chỗ.

File `railway.json` và `Procfile` trong gói này đã khai báo rõ lệnh khởi động
là `node server.js` để giảm rủi ro Railway đoán sai lệnh chạy.

## Các bước deploy trên Railway

1. **Đẩy code lên GitHub** (hoặc dùng Railway CLI để deploy trực tiếp từ thư mục này).

2. **Tạo service mới trên Railway** từ repo này. Railway sẽ tự nhận diện Node.js
   qua `package.json` (build: `npm install`, start: `npm start`).

3. **Gắn Volume vào service:**
   - Vào tab **Settings → Volumes** của service.
   - Bấm **New Volume**, đặt **Mount Path = `/date`** (đúng như bạn đã tạo).

4. **(Tuỳ chọn) Biến môi trường:** nếu muốn đổi đường dẫn lưu trữ khác `/date`, thêm:
   ```
   DATA_DIR=/date
   ```
   (Nếu không set, server mặc định dùng `/date`.)

5. **Deploy.** Railway sẽ cấp domain public dạng `https://<ten-app>.up.railway.app`.
   Mở domain đó — vì frontend và backend chạy chung 1 server (Express serve luôn
   file tĩnh trong `public/`), không cần cấu hình CORS hay domain riêng cho API.

6. **Kiểm tra:** mở `https://<ten-app>.up.railway.app/api/health` — nếu thấy
   `{"ok":true,"dataDir":"/date"}` nghĩa là server đã kết nối đúng volume.

## Chạy thử ở máy local
```bash
cd studyflow-app
npm install
DATA_DIR=./data node server.js
```
Mở `http://localhost:3000`. Dữ liệu sẽ được lưu vào thư mục `./data` thay vì `/date`.

## Lưu ý quan trọng
- Mật khẩu người dùng hiện đang được lưu **dạng thường** (plain text) trong
  `system-db.json`, giống hệt cách app cũ lưu trong `localStorage`. Việc chuyển
  sang lưu trên server khiến rủi ro này nghiêm trọng hơn (dữ liệu tập trung một
  chỗ). Nếu app dùng thật, nên băm mật khẩu (bcrypt) trước khi lưu — mình có thể
  làm giúp nếu bạn cần.
- Hiện tại **chưa có xác thực API** — ai biết được `userId` đều có thể gọi API để
  đọc/ghi dữ liệu của người đó. Phù hợp để demo/dự án cá nhân, nhưng nếu công khai
  cho nhiều người dùng thật, nên thêm xác thực (session/token) cho các route
  `/api/user-data/*`.
