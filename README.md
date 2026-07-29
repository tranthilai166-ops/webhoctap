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

## Bản sửa lỗi: mất tài khoản khi cập nhật code & tìm bạn không ra

**Lỗi 1 — Mất tài khoản sau khi deploy/cập nhật file:** khi trang web load lần đầu,
`app.js` từng **ghi đè thẳng** danh sách user trong trình duyệt bằng dữ liệu lấy về từ
server, thay vì hợp nhất (merge) 2 bên. Nếu server vừa khởi động lại sau khi bạn cập
nhật code mà volume trả về dữ liệu rỗng/thiếu (dù chỉ tạm thời), toàn bộ tài khoản
trong trình duyệt bị xóa theo. Đã sửa: giờ luôn **hợp nhất** dữ liệu server + local
(giữ lại user ở cả 2 phía), và nếu phát hiện trình duyệt đang có nhiều dữ liệu hơn
server (dấu hiệu volume vừa bị mất dữ liệu), tự động đẩy bản hợp nhất lên lại server
để khôi phục.

**Lỗi 2 — Tìm bạn bằng User ID không ra:** lúc đăng ký, User ID được lọc bỏ mọi ký tự
lạ (`chỉ giữ a-z, 0-9, _`), nhưng ô tìm bạn trước đây không lọc giống vậy, nên đôi khi
gõ ID đúng nhưng không khớp. Đã sửa: dùng chung 1 hàm `normalizeUserId()` cho cả đăng
ký, đăng nhập, và tìm bạn.

**Thêm cơ chế tự sao lưu phía server:** mỗi lần server ghi đè `system-db.json` hoặc
file dữ liệu user, nó tự lưu 1 bản `.bak` cạnh bên (ví dụ `system-db.json.bak`) chứa
nội dung ngay trước đó. Nếu chẳng may có sự cố, bạn có thể vào volume và đổi tên file
`.bak` thành file gốc để khôi phục thủ công.

**Cách kiểm tra volume có thực sự giữ dữ liệu qua các lần deploy hay không:** mỗi lần
server khởi động, log Railway sẽ in ra số lượng user/kết bạn/tin nhắn hiện có trên
volume. Nếu con số này bất ngờ về 0 ngay sau khi bạn vừa deploy code mới (mà trước đó
đã có user), gần như chắc chắn Volume **không được gắn giữ nguyên** giữa các lần
deploy — kiểm tra lại **Settings → Volumes → Mount Path = `/date`** của service.

## Bản sửa lỗi: kết bạn phải chờ chấp nhận + đồng bộ liên tục

Trước đây bấm "Tìm & Kết Bạn" là **tự động thành bạn bè ngay lập tức** ở phía người
gửi, còn phía người nhận không hề được thông báo và cũng không thấy gì cả (giao diện
"Lời Mời Kết Bạn" trong `index.html` vốn đã có sẵn nhưng chưa từng được nối vào code).
Đã sửa thành luồng đúng:

1. Bấm "Tìm & Kết Bạn" → gửi **lời mời** (trạng thái `pending`), CHƯA phải bạn bè.
2. Người nhận thấy lời mời hiện ra trong khung **"Lời Mời Kết Bạn"**, có nút
   ✅ Chấp nhận / ❌ Từ chối.
3. Chỉ khi người nhận bấm **Chấp nhận**, cả 2 bên mới chính thức là bạn bè, cùng lúc
   hiện ra trong danh sách bạn học của cả 2 người và có thể nhắn tin/gọi cho nhau ngay
   — không cần ai phải "gửi tin nhắn trước mới hiện ra" như trước.
4. Nếu bị từ chối, người gửi có thể tìm và gửi lại lời mời mới sau đó.
5. Khi có lời mời mới hoặc lời mời được chấp nhận, hệ thống tự gửi 1 thư vào
   **Hộp Thư** của người liên quan để không bị bỏ lỡ.

**Đồng bộ liên tục:** ngoài việc đẩy cập nhật tức thời qua Socket.IO khi cả 2 người
đang online cùng lúc, ứng dụng giờ còn tự động kiểm tra lại dữ liệu từ server mỗi 12
giây (chạy ngầm, không cần bấm gì) — nên kể cả khi kết nối realtime bị rớt tạm thời,
lời mời kết bạn / tin nhắn / trạng thái bạn bè vẫn sẽ tự cập nhật đều đặn ở cả hai
phía trong ít giây.

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
## Cấu hình ChatGPT tạo bài tập

Đặt biến môi trường trên server/Railway rồi khởi động lại:

```text
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Trong mục **Bài Tập & Luyện Tập → Tạo Quiz Bằng AI**, chọn **ChatGPT**. Hệ thống nhận PDF, TXT và ảnh; tự tạo câu 4 đáp án hoặc Đúng/Sai, lưu đáp án/giải thích, và hiển thị tài liệu nguồn trong màn hình làm bài.

Không đặt API key trong `public/app.js` hoặc localStorage của trình duyệt.
