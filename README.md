# Tom-Multitask-Tools

## Tom Multitask (trước đây là MetaTools): Slack + Drive/Gmail + Trello + Git trong một app (Mac / Windows)

- **Hồ sơ**: mỗi hồ sơ gồm 1 tài khoản Slack (phiên đăng nhập riêng), 1 tab Drive/Gmail và các nick Git gắn kèm. Link Drive bấm trong Slack mở đúng email công ty của hồ sơ đó.
- **Tin mới**: thông báo thật của hệ điều hành, số tin chưa đọc trên từng hồ sơ, chạy ngầm ở khay hệ thống.
- **Git**: nick đăng nhập bằng PAT (token cất trong Keychain/DPAPI) hoặc SSH key riêng cho từng nick. Cặp pull → push có thể tuỳ biến (nhánh mới nhất, cố định hoặc theo mẫu; nhánh đích trùng tên, cố định hoặc có tiền tố; mẫu nội dung commit). App đẩy **1 commit** đứng tên nick đích, không mang lịch sử, tên hay email cá nhân sang, và không bao giờ force push.
- **Không có server riêng**: app chạy trên máy, nói chuyện thẳng với Slack, Google, GitHub và GitLab.

**Tải bộ cài**: xem mục [Releases](../../releases). Hướng dẫn: [HUONG_DAN.md](HUONG_DAN.md).

### Dev
```bash
npm ci
npm start                 # chạy app
node test/git.test.js     # test lõi git (repo giả)
node test/update.test.js  # test cập nhật trong app (manifest, sha256, quay về bản cũ)
```
Đẩy tag `vX.Y.Z` thì GitHub Actions tự build Windows x64, Mac arm64 và Mac x64, rồi đính bộ cài vào Release. Job `payload` làm thêm `MetaTools-payload-<ver>.asar` và `metatools-update.json` cho tính năng cập nhật trong app (xem TIEN_DO.md).
