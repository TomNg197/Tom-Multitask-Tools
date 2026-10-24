## Tom Multitask 2.6 (trước đây là MetaTools)

**Mới ở bản 2.6.0:**
- **Tab Discord cho mỗi hồ sơ:** đăng nhập Discord riêng từng hồ sơ, chạy nền vẫn nhận tin, số tin chưa đọc cộng vào icon app. Sửa hồ sơ → ô Discord để mở sẵn một server/kênh. Link discord.gg / discord.com bấm từ tab khác tự mở vào tab Discord của đúng hồ sơ.
- **Nút Hồ sơ gọn:** cột trái chỉ còn nút Hồ sơ (ảnh hồ sơ đang mở + tổng tin chưa đọc), Dự án, Tin mới, Cài đặt. Di chuột vào Hồ sơ là bảng danh sách hồ sơ trượt ra bên phải. Phím tắt **Ctrl/Cmd + 1…9** chuyển nhanh hồ sơ.
- **Quản lý dự án:** thẻ dự án có trạng thái, hạn chót (trễ đỏ, sắp tới hạn vàng), người phụ trách, tiến độ %, checklist việc, ghi chú, link tài liệu, gắn với nhiều hồ sơ và nút mở nhanh Slack / Trello / Discord / Git của từng hồ sơ.
- **Đồng bộ dự án giữa các máy:** dự án lưu thành `projects.json` trong một repo Git riêng (nên private). Bấm **⟳ Đồng bộ** để kéo bản mới, gộp với máy này rồi đẩy lên; bấm ⚙ để chọn repo + nick Git. Hai máy sửa cùng dự án thì bản sửa sau cùng được giữ; dự án đã xoá không bị hồi sinh.

**Bản 2.5.0:**
- **Đổi tên thành Tom Multitask**, có logo mới (chồng cửa sổ trên nền cam–hồng) cho icon app, khay hệ thống và thông báo.
- **Giao diện đồng bộ với logo:** màu nhấn đổi từ tím sang cam–hồng, nút chính dùng dải màu của logo, màn hình chào và mục Cài đặt có logo.
- **Dữ liệu giữ nguyên:** hồ sơ, phiên đăng nhập và token vẫn nằm trong thư mục cũ `MetaTools`, nên không phải đăng nhập lại.
- Cập nhật trong app (từ 2.3 trở lên) thì đổi được tên, giao diện, icon cửa sổ và icon khay. **Icon của file exe/app và lối tắt trên Desktop/taskbar vẫn là icon cũ** cho tới khi tải bộ cài 2.5 mới (giải nén đè hoặc sang thư mục mới đều được, dữ liệu không mất).

**Bản 2.4.2:**
- **Logo cho từng hồ sơ:** Sửa hồ sơ → Logo → Chọn ảnh (app tự cắt vuông, thu nhỏ 128 px). Bấm "Bỏ logo" để quay về chữ viết tắt + màu.
- **Sửa nội dung commit trước khi push:** khung xác nhận có ô commit điền sẵn theo mẫu, sửa xong mới bấm Đẩy lên (code, nhánh, người đứng tên giữ nguyên).

**Bản 2.4.1:** cột tab chỉ còn **biểu tượng** (logo Slack, Drive, Trello, Git), không còn chữ, cột hẹp lại để khung nội dung rộng hơn. Rê chuột vào biểu tượng để xem tên.

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
| Windows 10/11 | `TomMultitask-Windows-x64.zip` |
| Mac chip Apple (M1/M2/M3/M4) | `TomMultitask-Mac-AppleChip.zip` |
| Mac chip Intel | `TomMultitask-Mac-Intel.zip` |

Lần đầu mở app sẽ có cảnh báo vì app chưa ký số chính thức:
- Windows: bấm **More info → Run anyway**.
- Mac: vào **System Settings → Privacy & Security → Open Anyway**, hoặc chạy `xattr -cr "/Applications/Tom Multitask.app"`.

Hướng dẫn đầy đủ nằm trong file `HUONG_DAN.md` (có sẵn trong file zip).
