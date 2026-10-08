# MetaTools 2.0 (Electron): tiến độ

Sếp duyệt hướng B (tin 1543, 08/10 00:41 giờ VN): một app Electron chạy trên Mac và Windows, không qua trình duyệt, **gắn tài khoản Git vào mỗi tài khoản Slack**. Đã báo kế hoạch ở tin 1545: khoảng 1 ngày làm việc, xong phần nào báo phần đó.

## Thiết kế
- **Hồ sơ** (profile) gồm: tab Slack (partition `persist:p-<id>`), tab Google (Drive/Gmail, dùng chung partition), tab Git (tài khoản PAT và các cặp).
- **Thông báo:** preload-slack chèn hook vào main world bằng webFrame.executeJavaScript, chuyển qua postMessage có nonce, preload gửi ipc lên main. Main hiện Notification thật của hệ điều hành, bấm vào thì nhảy đúng hồ sơ.
- **Badge:** đọc page-title-updated. Mac dùng app.setBadgeCount; Windows dùng overlay icon và tooltip tray.
- **Khay hệ thống:** đóng cửa sổ thì ẩn xuống khay. Dùng single instance lock. Lúc before-quit gọi session.flushStorageData() để chống văng đăng nhập.
- **User agent:** UA Chrome bỏ đi phần token Electron/MetaTools.
- **Link:** window.open tới *.google.com mở trong tab Google của hồ sơ; link khác mở bằng shell.openExternal.
- **Git (lib/git.js):**
  - Chỉ dùng PAT; kiểm tra nick qua API: GitHub /user (Enterprise /api/v3/user), GitLab /api/v4/user. Báo hạn token.
  - Xác thực: `-c credential.helper= -c http.<url>.extraheader=Authorization: Basic b64(user:token)`.
  - Snapshot: fetch các nhánh nguồn, chọn nhánh mới nhất. Ở repo đích: `git fetch <srcdir> <sha>`, rồi `commit-tree <tree> -p <dst head>` với env tác giả là nick đích, rồi push `<commit>:refs/heads/<br>` (không force). Lịch sử nguồn không đi theo.
  - Token mã hoá bằng safeStorage, lưu ở userData/secrets.json.

## Trạng thái
- [x] Khung project, main.js, preload-slack (hook Notification qua postMessage+nonce), preload-ui, ui/ (sidebar, tab Slack/Drive/Git, Tin mới, Cài đặt, form, bảng xác nhận)
- [x] lib/git.js (PAT + SSH, rule nhánh, mẫu commit), test 17/17
- [x] Electron 44.7 (Chromium 152, vì Chromium 140 bị Slack báo sắp ngừng hỗ trợ). Selftest trong app thật (test/selftest.js, Xvfb) đạt 17/17
- [x] Đóng gói: dist/MetaTools-2.0-{Windows-x64,Mac-AppleChip,Mac-Intel}.zip; bản Mac ký ad-hoc bằng rcodesign (~/.local/bin); zip giữ symlink
- [x] HUONG_DAN.md; đã gửi ảnh và báo cáo (tin 1561, 1562)
- [ ] GIAO FILE: chờ Hive Link v0.3.1 trên máy sếp (file >20MB). Đã đặt nhắc việc 09/10 10:30 để đẩy vào D:/MetaX/Tools/MetaTools2/

## Chạy test trên pod
`METATOOLS_USERDATA=/tmp/mt2ud METATOOLS_SELFTEST=/tmp/mt2shots METATOOLS_GIT_TEST=1 ~/workspace/tools/elx.sh ~/workspace/tools/MetaTools2`
- elx.sh dùng thư viện ở ~/.local/electronlibs (lấy bằng tools/debfetch.py) và Xvfb-buu (đã vá đường dẫn xkbcomp sang /tmp/xbn).
- Font cấu hình ở fonts-buu.conf.
- Unit test Git: `node test/git.test.js` (17/17).

## Build lại
`npx @electron/packager . MetaTools --platform=win32 --arch=x64 --out=dist --asar --ignore='^/test' --ignore='^/dist' ...`
Bản darwin thêm `--arch=arm64,x64 --icon=assets/icon.icns --app-bundle-id=vn.metax.metatools`, sau đó ký `rcodesign sign MetaTools.app`.
