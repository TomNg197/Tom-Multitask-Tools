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

- [x] v2.3.0 (21/10): **cập nhật trong app** (mục dưới). Unit 47/47, e2e Electron 20/20 (chạy cả bằng `electron .` và bằng bản giả đóng gói `resources/app.asar`), selftest 26/26, git 17/17. Commit ở máy, chưa push, chưa tag.

## Cập nhật trong app (2.3.0)
**Chọn cách: cập nhật phần JS (asar-level) từ một manifest công khai.** App gốc (Electron + app.asar trong bộ cài) giữ nguyên. Bản mới là 1 file `MetaTools-payload-<ver>.asar` lưu ở `userData/updates/payloads/`. Lúc mở app, `bootstrap.js` chọn chạy payload hay code gốc.
- **Vì sao không dùng electron-updater:** repo nguồn private nên provider GitHub phải nhúng token vào app (ai có app là đọc được repo). Squirrel.Mac đòi Developer ID, ký ad-hoc không chạy được. Bộ cài hiện là zip, không phải NSIS. Cách payload không đụng vào bundle đã ký (chữ ký ad-hoc Mac còn nguyên), không bị Windows khoá file, không cần quyền admin, và không thêm thư viện nào.
- **Luồng:** kiểm tra manifest (30 giây sau khi mở, sau đó mỗi giờ xem lại, nhưng chỉ gọi mạng khi đã quá 6 giờ từ lần trước; tắt được trong Cài đặt) → nút **Tải bản cập nhật** (có thanh tiến trình) → kiểm tra **sha256 + kích thước + file asar có main.js + package.json đúng tên `metatools` và đúng version**. Sai bất kỳ điểm nào thì xoá file và không cài → lưu vào `pending` → **Khởi động lại để cập nhật** (cả ở khay).
- **Quay về bản cũ (lib/boot.js):** bản mới chạy ở chế độ thử (`good=false`). Sau `did-finish-load` 10 giây không lỗi thì `markGood`. Nếu `require` ném lỗi hoặc có uncaughtException trong lúc thử thì app ghi crash và relaunch. Nếu 2 lần mở mà chưa xác nhận được thì về `previous` (bản tốt trước đó) hoặc về code gốc. Bản lỗi bị ghi vào `bad`, không gợi ý lại. sha256 được kiểm lại mỗi lần mở (file hỏng thì bỏ). Nếu bộ cài đầy đủ mới hơn hoặc bằng payload thì code gốc thắng.
- **Giới hạn:** payload chỉ thay JS/UI/asset. Đổi Electron (manifest `electron` khác) hoặc cần bootstrap mới (`updateMinShell` trong package.json, hiện là 2.3.0) thì app báo **cần tải bản đầy đủ** và mở link zip. Người dùng 2.2 trở về trước phải cài tay 2.3.0 một lần.
- **Kênh:** `DEFAULT_MANIFEST_URL` trong lib/updater.js = `https://github.com/TomNg197/MetaTools-releases/releases/latest/download/metatools-update.json`. Đè bằng env `METATOOLS_UPDATE_URL`. Khi kênh chưa có bản nào, app báo lỗi 404 dễ hiểu và mọi tính năng khác vẫn chạy bình thường.
- **CI (release.yml):** job `payload` (ubuntu) đóng gói như các bản khác rồi lấy `resources/app.asar` làm `MetaTools-payload-<ver>.asar`, chạy `scripts/make-update-manifest.js` để tạo `metatools-update.json` (version, ghi chú lấy từ RELEASE_NOTES.md trước mục "Tải về", minShell, electron, url + sha256 + size, link zip từng máy). Các file này luôn được đính vào release private. Job `publish-update` chép cả 3 zip, payload và manifest sang repo công khai khi đã đặt `vars.UPDATE_REPO`.

### Sếp cần làm để bật (một lần)
1. Tạo repo **công khai** `TomNg197/MetaTools-releases` (chỉ chứa release, không chứa code), có sẵn 1 commit (README) để tạo được tag.
2. Tạo fine-grained PAT: chỉ repo đó, quyền **Contents: Read and write**. Ở repo private Tom-Multitask-Tools vào Settings → Secrets and variables → Actions: secret `UPDATE_REPO_TOKEN` = PAT đó, variable `UPDATE_REPO` = `TomNg197/MetaTools-releases`. Token chỉ nằm trong CI, không vào app.
3. Đẩy tag `v2.3.0`, rồi gửi zip 2.3.0 cho mọi người cài tay **lần cuối**.
4. Bản sau: tăng `version` trong package.json, viết RELEASE_NOTES.md, đẩy tag. App của mọi người tự thấy bản mới. Khi đổi Electron hoặc sửa bootstrap.js/lib/boot.js theo cách không tương thích thì tăng `updateMinShell`.
- Muốn dùng chỗ khác (GitHub Pages, S3/R2, máy chủ công ty): đặt variable `UPDATE_BASE_URL` (thư mục công khai, tự upload file lên), rồi sửa `DEFAULT_MANIFEST_URL` cho trỏ vào `<chỗ đó>/metatools-update.json`.

### Rủi ro cần biết
- **Ai giữ được kênh thì đẩy được code vào máy mọi người.** sha256 chỉ chống file hỏng hoặc tải thiếu, vì nó nằm cùng chỗ với payload. Nếu tài khoản GitHub hoặc PAT bị lộ, kẻ đó phát hành được bản độc. Nên bật 2FA. Bước tiếp theo nên làm là ký manifest bằng ed25519 (khoá riêng để ở secret CI, khoá công khai nhúng trong app).
- **Repo công khai thì ai cũng tải được app**, và cả mã JS bên trong (asar giải nén dễ). Hiện code không chứa khoá hay token nào. Nếu không muốn công khai thì dùng `UPDATE_BASE_URL` với một link khó đoán, nhưng đó chỉ là giấu, không phải bảo mật.
- Mac/Windows thật **chưa test** (pod chỉ có Linux). Cơ chế không đụng tới chữ ký, nhưng nên thử trên máy thật 1 vòng 2.3.0 → 2.3.1 trước khi phát rộng.
- Hai cửa sổ thông báo (đã tải xong, đã quay về) dùng Notification của hệ điều hành. Nếu máy tắt thông báo thì vẫn xem được trong Cài đặt.

## Chạy test trên pod
`METATOOLS_USERDATA=/tmp/mt2ud METATOOLS_SELFTEST=/tmp/mt2shots METATOOLS_GIT_TEST=1 ~/workspace/tools/elx.sh ~/workspace/tools/MetaTools2`
- elx.sh dùng thư viện ở ~/.local/electronlibs (lấy bằng tools/debfetch.py) và Xvfb-buu (đã vá đường dẫn xkbcomp sang /tmp/xbn).
- Font cấu hình ở fonts-buu.conf.
- Unit test Git: `node test/git.test.js` (17/17).
- Updater: `node test/update.test.js` (47/47), e2e trong Electron thật: `node test/update.e2e.js` (20/20, chạy app 4 lần: tải 2.3.1, chạy payload, payload 2.3.2 lỗi, tự quay về). Đặt `E2E_OUT=<thư mục>` để giữ ảnh/log, `E2E_CMD=<script>` để chạy bản đã đóng gói.

## Build lại
`npx @electron/packager . MetaTools --platform=win32 --arch=x64 --out=dist --asar --ignore='^/test' --ignore='^/dist' ...`
Bản darwin thêm `--arch=arm64,x64 --icon=assets/icon.icns --app-bundle-id=vn.metax.metatools`, sau đó ký `rcodesign sign MetaTools.app`.
