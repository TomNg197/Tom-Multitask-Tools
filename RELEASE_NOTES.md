## MetaTools 2.4

Một app cho Mac và Windows gồm nhiều tài khoản Slack, mỗi tài khoản có Drive/Gmail riêng và các nick Git gắn kèm. Không cần trình duyệt, không có server riêng.

**Mới ở bản 2.4:**
- **Gõ tiếng Việt bằng UniKey ổn định hơn.** Trước đây mỗi lần số tin chưa đọc thay đổi, app gỡ rồi gắn lại khung Slack, làm ô soạn tin mất con trỏ giữa chừng nên UniKey bỏ dấu sai hoặc mất chữ. Lỗi này đã sửa.
- **Giao diện mới kiểu macOS 26:** cột bên mờ trong suốt (Mac, Windows 11), góc bo tròn, font hệ thống, nút dạng viên thuốc. Sáng/tối theo máy.
- **Tab dạng cột dọc:** chọn hồ sơ thì Slack, Drive/Gmail, Trello, Git hiện thành một cột ngay cạnh cột hồ sơ. Dùng được phím ↑/↓ và Enter.
- Có bản 2.3 rồi thì cập nhật ngay trong app (Cài đặt → Cập nhật).

**Từ bản 2.3:** **cập nhật ngay trong app**. App tự kiểm tra bản mới, tải về, kiểm tra mã sha256 rồi chỉ cần khởi động lại, không phải tải zip cài lại. Nếu bản mới lỗi khi mở, app tự quay về bản trước. (Bản 2.3 cần cài tay một lần.)

**Từ bản 2.2:** mỗi hồ sơ có thêm **tab Trello** riêng, đăng nhập Trello riêng theo hồ sơ. Bấm link Trello trong Slack thì link mở thẳng trong tab Trello của đúng hồ sơ đó. Trong Sửa hồ sơ có ô dán link bảng hoặc workspace để mở sẵn.

**Từ bản 2.1:** bôi đen chữ, chuột phải hoặc bấm Ctrl/Cmd+Shift+E để **dịch sang tiếng Anh/Việt**; có nút **Thay bằng bản dịch** khi đang soạn tin; chuột phải có đủ Cắt/Copy/Dán và gợi ý chính tả.

**Tải về**

| Máy | File |
|---|---|
| Windows 10/11 | `MetaTools-Windows-x64.zip` |
| Mac chip Apple (M1/M2/M3/M4) | `MetaTools-Mac-AppleChip.zip` |
| Mac chip Intel | `MetaTools-Mac-Intel.zip` |

Lần đầu mở app sẽ có cảnh báo vì app chưa ký số chính thức:
- Windows: bấm **More info → Run anyway**.
- Mac: vào **System Settings → Privacy & Security → Open Anyway**, hoặc chạy `xattr -cr /Applications/MetaTools.app`.

Hướng dẫn đầy đủ nằm trong file `HUONG_DAN.md` (có sẵn trong file zip).
