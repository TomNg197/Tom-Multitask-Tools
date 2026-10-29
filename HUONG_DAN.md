# Tom Multitask (trước đây là MetaTools): Slack + Drive/Gmail + Trello + Git trong một app

Một app duy nhất cho Mac và Windows. Không cần trình duyệt, không cần Python, không có server riêng: mọi thứ chạy trên máy, nói chuyện thẳng với Slack, Google, GitHub và GitLab.

## Cài đặt
**Windows**
1. Giải nén `TomMultitask-Windows-x64.zip` vào một thư mục cố định, ví dụ `C:\Tools\Tom Multitask`.
2. Mở `Tom Multitask.exe`. Lần đầu Windows có thể hiện "Windows protected your PC": bấm **More info → Run anyway**. App chưa ký số nên mới có cảnh báo này.
3. Muốn có lối tắt: chuột phải `Tom Multitask.exe` → Send to → Desktop.

**Mac**
1. Mac chip Apple (M1/M2/M3/M4) dùng bản `darwin-arm64`; Mac chip Intel dùng bản `darwin-x64`.
2. Giải nén, kéo `Tom Multitask.app` vào thư mục **Applications**.
3. Lần đầu mở, macOS sẽ chặn. Có hai cách mở:
   - Vào **System Settings → Privacy & Security**, kéo xuống, bấm **Open Anyway**.
   - Hoặc mở Terminal, chạy: `xattr -cr "/Applications/Tom Multitask.app"` rồi mở app lại.

Phần Git cần có **Git** trên máy:
- Mac: chạy `xcode-select --install`.
- Windows: cài Git for Windows từ git-scm.com.

## Dùng
- **Hồ sơ** (cột trái): mỗi hồ sơ gồm 1 tài khoản Slack, 1 tài khoản Google (Drive/Gmail) và các nick Git gắn kèm. Các phiên đăng nhập tách riêng, không lẫn nhau.
  - Bấm **+** để tạo hồ sơ.
  - Chuột phải vào một hồ sơ để sửa.
- **Cột tab (từ bản 2.4):** chọn một hồ sơ thì cột thứ hai liệt kê các tab của hồ sơ đó (Slack, Drive/Gmail, Trello, Git) theo chiều dọc; nút **Sửa hồ sơ** ở cuối cột. Bàn phím: Tab để vào danh sách, ↑/↓ để đổi tab hoặc đổi hồ sơ, Enter để chọn.
- **Tab Slack:** đăng nhập Slack một lần cho mỗi hồ sơ. Khi tắt app, phiên đăng nhập được ghi xuống đĩa nên không bị văng.
- **Tab Drive/Gmail:** đăng nhập email công ty một lần cho mỗi hồ sơ.
  - Bấm link Drive/Docs/Sheets/Slides trong Slack thì link mở ngay trong tab này, đúng email của hồ sơ.
  - Link web khác mở bằng trình duyệt mặc định.
- **Tin mới:**
  - Thông báo hiện thật trên Windows/Mac; bấm vào thông báo là nhảy đúng hồ sơ.
  - Số tin chưa đọc hiện trên từng hồ sơ và trên icon app.
  - Nút 🔔 gom tin của mọi hồ sơ.
- **Chạy ngầm:** bấm X chỉ ẩn app xuống khay hệ thống (góc phải dưới trên Windows, thanh menu trên Mac); app vẫn nhận tin.
  - Thoát hẳn: chuột phải biểu tượng khay → **Thoát**, hoặc vào Cài đặt.
  - Trong Cài đặt có tuỳ chọn **tự chạy ngầm khi mở máy**.

## Trello (từ bản 2.2)
- Mỗi hồ sơ có tab **📋 Trello** với phiên đăng nhập riêng. Hồ sơ Công ty dùng Trello công ty, hồ sơ Khách A dùng Trello khách, không lẫn sang nhau.
- Lần đầu mở tab thì đăng nhập Trello. Chọn "Continue with Google" cũng được, cửa sổ đăng nhập vẫn dùng chung phiên của hồ sơ đó.
- **Sửa hồ sơ → ô Trello:** dán link bảng hay workspace (ví dụ https://trello.com/w/tencongty) để mỗi lần bấm ⌂ là về đúng bảng đó.
- Bấm link Trello trong Slack thì link mở thẳng trong tab Trello của hồ sơ đó.

## Dịch nhanh (từ bản 2.1)
- Bôi đen chữ trong Slack (hoặc Drive/Gmail) → **chuột phải → Dịch sang tiếng Anh / tiếng Việt**, hoặc bấm **Ctrl+Shift+E** (Mac: **Cmd+Shift+E**).
- Bản dịch hiện trong app, có nút **Copy**. Nếu đang bôi đen trong **ô soạn tin** thì có thêm nút **Thay bằng bản dịch**: câu tiếng Việt được thay bằng tiếng Anh, gửi đi là xong.
- Bản dịch dùng **Google Dịch**: chỉ đoạn chữ đang bôi đen được gửi đi, và chỉ khi bấm dịch.
- Chuột phải giờ có đủ Cắt / Copy / Dán / Chọn tất cả, gợi ý sửa chính tả, và Mở/Copy link.

## Git: tab Git của mỗi hồ sơ
1. **+ Thêm nick:** điền tên gợi nhớ, máy chủ (github.com, gitlab.com, gitlab.congty.vn...), username và email đứng tên commit, rồi chọn cách đăng nhập:
   - **Token (PAT):** dán token vào. Token được cất trong kho bảo mật của máy (Keychain trên Mac, DPAPI trên Windows), không ghi ra file. Quyền tối thiểu:
     - GitHub fine-grained: Contents Read (nick nguồn) hoặc Read and write (nick đích), chỉ chọn repo cần.
     - GitLab: read_repository, write_repository (nick đích) và read_user.
   - **SSH key:** app tự tạo key riêng cho nick (hoặc chọn key có sẵn) và hiện public key để dán lên trang SSH keys. App không đụng `~/.ssh/config`.
2. Bấm **Kiểm tra**: app hỏi máy chủ token hoặc key đó là ai. Sai nick là chặn. App cũng báo khi token sắp hết hạn.
3. **Cặp nick của hồ sơ (từ bản 2.8):** ở đầu cột phải tab Git, chọn **nick nguồn** (pull về) và **nick đích** (push lên, đứng tên commit) rồi bấm **Lưu cặp nick**. Mỗi hồ sơ có 1 cặp nick, mọi dự án của hồ sơ dùng chung. Đổi cặp nick thì app áp dụng cho tất cả dự án.
4. **+ Thêm dự án:** mỗi dự án = 1 repo nguồn + 1 repo đích. Một hồ sơ có bao nhiêu dự án cũng được.
   - **Nhánh nguồn:** mới nhất (tự động), cố định, hoặc mới nhất theo mẫu (ví dụ `release/*`).
   - **Nhánh đích:** trùng tên, cố định, hoặc thêm tiền tố (ví dụ `sync/`).
   - **Mẫu commit:** điền sẵn khi đẩy, có biến `{branch}` (nhánh đích) và `{date}` (ngày đẩy). Không có biến nào lấy thông tin nguồn.
5. **Pull + Push:** app pull về rồi hiện bảng xác nhận (nhánh, số file, người đứng tên). **Gõ nội dung commit** ở đây (nhiều dòng được) rồi bấm **Đẩy lên**: app đẩy **1 commit** đứng tên nick đích.
   - Commit không mang lịch sử, nhánh, mã commit, tên hay email của nick nguồn. Nội dung commit có tên nick nguồn, email nguồn, tên repo nguồn hoặc mã commit nguồn sẽ bị **chặn** để sửa lại.
6. **Lịch sử (n):** mỗi dự án lưu 50 lần đẩy gần nhất (giờ, nhánh, mã commit, nội dung), có nút Copy nội dung.
   - Cấu hình cũ (≤ 2.7) tự chuyển: cặp nick lấy theo cặp đầu tiên của hồ sơ, mỗi cặp cũ thành 1 dự án; dự án nào đang dùng nick khác sẽ có nhãn **nick khác cặp** cho tới khi bấm Lưu cặp nick.
   - Không bao giờ force push: nếu repo đích vừa có người đẩy thêm, app từ chối và bảo bấm lại.

## Cập nhật trong app (từ bản 2.3)
- App tự kiểm tra bản mới (tối đa 6 giờ một lần) và báo bằng chấm ↑ trên nút ⚙️. Muốn kiểm tra ngay: **Cài đặt → Kiểm tra cập nhật**, hoặc chuột phải biểu tượng ở khay → **Kiểm tra cập nhật…**
- Bấm **Tải bản cập nhật**, chờ thanh tiến trình chạy hết, rồi bấm **Khởi động lại để cập nhật**. Không cần tải file zip và cài lại.
- App kiểm tra mã sha256 của bản tải về. Sai mã thì app không cài. Nếu bản mới không chạy được, lần mở sau app tự quay về bản trước và báo cho anh biết.
- Một số bản đổi phần lõi (Electron). Với các bản đó app sẽ ghi **cần tải bản đầy đủ** và có nút mở link tải file zip.
- Không cần token. Ô **GitHub token** trong mục Cập nhật chỉ dùng khi repo app bị để private, lúc đó app báo lỗi 404 và gợi ý dán token (fine-grained, Contents: Read-only).
- Bản 2.2 trở về trước chưa có tính năng này, nên phải cài tay bản 2.3 một lần.

## Gõ tiếng Việt (UniKey, Windows)
- Bản 2.4 đã sửa lỗi ô soạn tin mất con trỏ giữa chừng, nguyên nhân làm UniKey bỏ dấu sai.
- Nếu thỉnh thoảng vẫn bị lặp hoặc mất chữ (thường gặp ở mọi app nền Chromium như Slack desktop, Chrome, VS Code): mở UniKey → **Mở rộng** → tích **Luôn sử dụng clipboard cho unicode** → Đóng. Hoặc dùng EVKey, hoặc bộ gõ Vietnamese Telex có sẵn của Windows (Cài đặt → Thời gian và ngôn ngữ → Ngôn ngữ → Tiếng Việt).
- Nếu app chạy bằng quyền Administrator thì UniKey cũng phải chạy bằng quyền Administrator, nếu không Windows sẽ chặn UniKey gửi phím vào app.

## Chuyển máy (Mac ⇄ Windows)
Vào **Cài đặt → Xuất danh sách hồ sơ**, sang máy kia bấm **Nhập**. File chỉ chứa tên, workspace, Gmail, nick và cặp Git; **không có** token, SSH key hay phiên đăng nhập. Mỗi máy phải đăng nhập Slack/Google và nhập token (hoặc tạo key) lại một lần.

## Dữ liệu nằm ở đâu
- Windows: `%APPDATA%\MetaTools` (tên thư mục giữ như cũ từ thời MetaTools để không mất dữ liệu khi đổi tên)
- Mac: `~/Library/Application Support/MetaTools`
