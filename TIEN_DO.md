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
- [x] Giao bằng GitHub Releases: repo TomNg197/Tom-Multitask-Tools; v2.0.0 (sếp đã tải bản Mac), v2.1.0 thêm dịch (selftest 20/20)

- [x] v2.3.0 (21/10): **cập nhật trong app** (mục dưới). Unit 64/64, e2e Electron 37/37 (kênh công khai + dự phòng token với GitHub API giả, 302 sang host khác không mang token), selftest 26/26, git 17/17. Commit ở máy, chưa push, chưa tag.

## Cập nhật trong app (2.3.0)
**Cách làm: cập nhật phần JS (asar-level).** App gốc (Electron + app.asar trong bộ cài) giữ nguyên. Bản mới là 1 file `MetaTools-payload-<ver>.asar` lưu ở `userData/updates/payloads/`. Lúc mở app, `bootstrap.js` chọn chạy payload hay code gốc.
- **Kênh (chốt 21/10, repo chuyển sang công khai):** app đọc `https://github.com/TomNg197/Tom-Multitask-Tools/releases/latest/download/metatools-update.json` (`DEFAULT_MANIFEST_URL` trong lib/updater.js). **Không cần token.** Link payload trong manifest trỏ tới asset của đúng release đó. Env `METATOOLS_UPDATE_URL` dùng để đổi sang kênh khác (test, mirror).
- **Token chỉ là dự phòng, không bắt buộc:** nằm trong ô thu gọn ở Cài đặt → Cập nhật. App chỉ dùng token khi link manifest công khai trả 401/403/404 (ví dụ repo bị đổi lại thành private) **và** đã có token. Lúc đó app đọc `api.github.com/repos/.../releases/latest`, tải asset với `Accept: application/octet-stream`, và khi bị 302 sang S3 thì **bỏ header Authorization** (`ghGet`). Token cất bằng safeStorage giống token của nick Git, có thể chọn "Dùng token của nick …". Token không ghi log, không hiện lại, chỉ gửi tới api.github.com. Repo công khai thì không bao giờ dùng tới token.
- **Kiểm tra trước khi cài:** sha256 trong manifest (bắt buộc), kích thước, file đúng dạng asar có main.js, package.json đúng tên `metatools` và đúng version. Sai một điểm thì xoá file, không cài.
- **Quay về bản cũ (lib/boot.js):**
  - Bản mới chạy ở chế độ thử. Sau `did-finish-load` 10 giây không lỗi thì `markGood`.
  - Nếu lúc nạp ném lỗi hoặc có uncaughtException trong khi thử, app ghi crash và relaunch.
  - Nếu 2 lần mở mà chưa xác nhận thì về bản tốt trước đó hoặc code gốc. Bản lỗi bị ghi vào `bad` và không được gợi ý lại.
  - sha256 được kiểm lại mỗi lần mở. Bộ cài đầy đủ mới hơn hoặc bằng payload thì code gốc thắng.
- **Giới hạn:** payload chỉ thay JS/UI/asset. Nếu đổi Electron hoặc cần bootstrap mới (`updateMinShell` trong package.json, hiện là 2.3.0), app báo "cần tải bản đầy đủ" và mở link zip. Bản 2.2 trở về trước phải cài tay 2.3.0 một lần.
- **CI (release.yml):** job `payload` (ubuntu) đóng gói giống các bản kia, lấy `resources/app.asar` làm `MetaTools-payload-<ver>.asar`, chạy `scripts/make-update-manifest.js` để tạo `metatools-update.json`, rồi đính cả hai vào **release của chính tag đó** trong repo này, cùng chỗ với 3 file zip. Không còn job đẩy sang repo khác.

### Sếp cần làm
1. Chuyển repo `TomNg197/Tom-Multitask-Tools` sang Public (sếp đã định làm).
2. Đẩy tag `v2.3.0`, tải zip 2.3.0 cài tay **lần cuối**.
3. Bản sau: tăng `version` trong package.json, viết RELEASE_NOTES.md (phần trước mục "Tải về" là ghi chú hiện trong app), đẩy tag. Chờ Actions xong là app tự thấy bản mới. Khi đổi Electron hoặc sửa bootstrap.js/lib/boot.js theo cách không tương thích thì tăng `updateMinShell`.
- Không cần tạo token, secret hay biến nào.

### Ưu / nhược
- **Ưu:** không token, không secret trong app, repo hay CI (CI dùng GITHUB_TOKEN mặc định). Đơn giản: đẩy tag là xong. Không đụng chữ ký Mac. Không thêm thư viện nào. Có trial-run + tự quay về bản cũ.
- **Nhược / rủi ro:**
  - **Ai push được tag lên repo (hoặc chiếm được tài khoản GitHub của sếp) thì đẩy được code vào app.** sha256 nằm cùng chỗ với payload nên chỉ chống file hỏng hoặc tải thiếu, không chống người cố ý. Nên bật 2FA và bảo vệ tag `v*`. Bước sau có thể ký manifest bằng ed25519.
  - Repo công khai thì ai cũng xem được code và tải được app. Trong code hiện không có khoá hay token. Từ giờ **đừng commit secret nào** vào repo, kể cả lịch sử cũ: nên rà lịch sử git trước khi chuyển sang Public.
  - "latest" của GitHub bỏ qua draft và pre-release. Muốn phát thử cho riêng mình thì dùng pre-release, app sẽ không thấy.
  - Mac/Windows thật **chưa test** (pod chỉ có Linux). Nên thử một vòng 2.3.0 → 2.3.1 trên máy sếp.

## Chạy test trên pod
`METATOOLS_USERDATA=/tmp/mt2ud METATOOLS_SELFTEST=/tmp/mt2shots METATOOLS_GIT_TEST=1 ~/workspace/tools/elx.sh ~/workspace/tools/MetaTools2`
- elx.sh dùng thư viện ở ~/.local/electronlibs (lấy bằng tools/debfetch.py) và Xvfb-buu (đã vá đường dẫn xkbcomp sang /tmp/xbn).
- Font cấu hình ở fonts-buu.conf.
- Unit test Git: `node test/git.test.js` (17/17).
- Updater: `node test/update.test.js` (64/64), e2e trong Electron thật: `node test/update.e2e.js` (37/37). Bài e2e chạy app 5 lần: A tải 2.3.1, B chạy payload, C payload 2.3.2 lỗi, D tự quay về, G dự phòng token khi kênh trả 404, với API giả (test/fake-update-server.js). Lần G thử các ca: không có token, token sai, dán token, dùng token của nick, và 302 sang host khác không mang theo token. Đặt `E2E_OUT=<thư mục>` để giữ ảnh/log, `E2E_CMD=<script>` để chạy bản đã đóng gói.

## Build lại
`npx @electron/packager . MetaTools --platform=win32 --arch=x64 --out=dist --asar --ignore='^/test' --ignore='^/dist' ...`
Bản darwin thêm `--arch=arm64,x64 --icon=assets/icon.icns --app-bundle-id=vn.metax.metatools`, sau đó ký `rcodesign sign MetaTools.app`.
