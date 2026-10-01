# THIẾT KẾ CƠ SỞ DỮ LIỆU HỆ THỐNG EXAMGUARD

## 1. Mục đích tài liệu

Tài liệu mô tả phần cơ sở dữ liệu PostgreSQL đang được ứng dụng ExamGuard sử dụng. Nội dung được đối chiếu với model SQLAlchemy, service/router đang hoạt động và hai migration Alembic hiện hành:

- [20260920_0001_initial_schema.py](../backend/alembic/versions/20260920_0001_initial_schema.py)
- [20260924_0002_camera_sources.py](../backend/alembic/versions/20260924_0002_camera_sources.py)

Các bảng chỉ được khai báo trong schema nhưng chưa có luồng ứng dụng đọc hoặc ghi không thuộc phạm vi tài liệu hiện hành.

Cơ sở dữ liệu đang lưu dữ liệu nghiệp vụ bền vững về người dùng, phòng thi, chỗ ngồi, camera, thí sinh, phiên thi, sự kiện nghi vấn, quá trình đánh giá và nhật ký kiểm toán. Trạng thái theo dõi thời gian thực như từng khung hình, hộp giới hạn và Track ID chỉ tồn tại trong bộ nhớ khi xử lý, không được lưu thành bảng.

## 2. Quy ước chung

| Quy ước | Ý nghĩa |
|---|---|
| PK | Khóa chính |
| FK | Khóa ngoại |
| UNIQUE | Giá trị hoặc tổ hợp giá trị không được trùng |
| NOT NULL | Bắt buộc có giá trị |
| NULL | Được phép không có giá trị |
| UUID | Định danh duy nhất, do ứng dụng sinh theo UUID phiên bản 4 |
| TIMESTAMPTZ | Thời gian có múi giờ; trao đổi qua API theo ISO 8601, ví dụ 2026-09-29T15:30:00+00:00 |
| JSONB | Dữ liệu JSON dạng nhị phân của PostgreSQL |
| Mốc thời gian video | Số mili giây tính từ đầu nguồn video |

Các cột created_at có giá trị mặc định now() khi tạo bản ghi. Các cột updated_at cũng mặc định now() khi tạo và được SQLAlchemy cập nhật bằng now() khi bản ghi được sửa.

Tất cả khóa ngoại hiện sử dụng hành vi mặc định của PostgreSQL khi xóa hoặc cập nhật bản ghi được tham chiếu. Migration không khai báo ON DELETE CASCADE.

## 3. Danh sách bảng đang được sử dụng

| STT | Tên bảng | Mô tả ngắn |
|---:|---|---|
| 1 | users | Tài khoản người dùng và vai trò truy cập |
| 2 | rooms | Phòng thi |
| 3 | candidates | Hồ sơ thí sinh |
| 4 | media_assets | Tệp video và tài sản đa phương tiện |
| 5 | seats | Vị trí ghế trong phòng thi |
| 6 | cameras | Nguồn camera gắn với phòng thi |
| 7 | exam_sessions | Phiên thi và nguồn giám sát |
| 8 | session_candidates | Phân công thí sinh vào ghế trong phiên thi |
| 9 | events | Sự kiện nghi vấn do pipeline AI ghi nhận |
| 10 | event_actors | Thí sinh liên quan đến sự kiện |
| 11 | event_reviews | Lịch sử đánh giá sự kiện |
| 12 | audit_logs | Nhật ký kiểm toán dạng chỉ ghi thêm |

## 4. Sơ đồ quan hệ tổng quát

~~~mermaid
erDiagram
    USERS o|--o{ MEDIA_ASSETS : tao
    USERS ||--o{ EXAM_SESSIONS : tao
    USERS o|--o{ EVENTS : ghi_nhan
    USERS ||--o{ EVENT_REVIEWS : danh_gia
    USERS o|--o{ AUDIT_LOGS : thuc_hien

    ROOMS ||--o{ SEATS : co
    ROOMS ||--o{ CAMERAS : co
    ROOMS ||--o{ EXAM_SESSIONS : to_chuc

    MEDIA_ASSETS ||--o{ CAMERAS : lam_nguon
    MEDIA_ASSETS o|--o{ EXAM_SESSIONS : lam_video
    CAMERAS o|--o{ EXAM_SESSIONS : cung_cap_nguon

    EXAM_SESSIONS ||--o{ SESSION_CANDIDATES : xep_cho
    CANDIDATES ||--o{ SESSION_CANDIDATES : tham_du
    SEATS ||--o{ SESSION_CANDIDATES : duoc_phan_cong

    EXAM_SESSIONS ||--o{ EVENTS : phat_sinh
    EVENTS ||--o{ EVENT_ACTORS : co_doi_tuong
    SESSION_CANDIDATES ||--o{ EVENT_ACTORS : lien_quan
    EVENTS ||--o{ EVENT_REVIEWS : duoc_danh_gia
~~~

## 5. Mô tả chi tiết các bảng

### 5.1. Bảng users

**Tên bảng:** users

**Mô tả bảng:** Lưu tài khoản đăng nhập, thông tin hiển thị, vai trò và trạng thái hoạt động của người dùng hệ thống.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh người dùng | UUID | PK, NOT NULL; UUID v4 |
| username | Tên đăng nhập | VARCHAR(100) | NOT NULL, UNIQUE; chuỗi tối đa 100 ký tự |
| password_hash | Mật khẩu đã được băm | VARCHAR(255) | NOT NULL; chuỗi hash tối đa 255 ký tự, không lưu mật khẩu thuần |
| full_name | Họ và tên hiển thị | VARCHAR(255) | NULL; chuỗi Unicode tối đa 255 ký tự |
| role | Vai trò phân quyền | VARCHAR(20) | NOT NULL; một trong SUPERVISOR, REVIEWER, ADMIN |
| is_active | Trạng thái được phép sử dụng tài khoản | BOOLEAN | NOT NULL; TRUE hoặc FALSE; mặc định TRUE |
| created_at | Thời điểm tạo tài khoản | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |
| updated_at | Thời điểm cập nhật gần nhất | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- username là duy nhất trên toàn hệ thống.
- role chỉ nhận một trong ba giá trị SUPERVISOR, REVIEWER hoặc ADMIN.

### 5.2. Bảng rooms

**Tên bảng:** rooms

**Mô tả bảng:** Lưu danh mục phòng thi được dùng để bố trí ghế, camera và tổ chức các phiên thi.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh phòng thi | UUID | PK, NOT NULL; UUID v4 |
| code | Mã phòng thi | VARCHAR(100) | NOT NULL, UNIQUE; chuỗi tối đa 100 ký tự |
| name | Tên phòng thi | VARCHAR(255) | NOT NULL; chuỗi Unicode tối đa 255 ký tự |
| description | Mô tả bổ sung về phòng thi | TEXT | NULL; văn bản Unicode |
| is_active | Trạng thái phòng còn được sử dụng | BOOLEAN | NOT NULL; TRUE hoặc FALSE; mặc định TRUE |
| created_at | Thời điểm tạo phòng | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |
| updated_at | Thời điểm cập nhật gần nhất | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- code là duy nhất trên toàn hệ thống.

### 5.3. Bảng candidates

**Tên bảng:** candidates

**Mô tả bảng:** Lưu hồ sơ cơ bản của thí sinh, độc lập với từng phiên thi cụ thể.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh thí sinh | UUID | PK, NOT NULL; UUID v4 |
| candidate_code | Mã thí sinh | VARCHAR(100) | NOT NULL, UNIQUE; chuỗi tối đa 100 ký tự |
| full_name | Họ và tên thí sinh | VARCHAR(255) | NOT NULL; chuỗi Unicode tối đa 255 ký tự |
| class_name | Tên lớp hoặc nhóm học tập | VARCHAR(255) | NULL; chuỗi Unicode tối đa 255 ký tự |
| note | Ghi chú về thí sinh | TEXT | NULL; văn bản Unicode |
| created_at | Thời điểm tạo hồ sơ | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |
| updated_at | Thời điểm cập nhật gần nhất | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- candidate_code là duy nhất trên toàn hệ thống.
- Một thí sinh có thể tham gia nhiều phiên thi thông qua bảng session_candidates.

### 5.4. Bảng media_assets

**Tên bảng:** media_assets

**Mô tả bảng:** Lưu metadata và vị trí tệp đa phương tiện được tải lên hoặc dùng làm nguồn video của camera và phiên thi. Nội dung tệp nằm trong hệ thống lưu trữ; bảng chỉ lưu thông tin tham chiếu.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh tài sản đa phương tiện | UUID | PK, NOT NULL; UUID v4 |
| original_filename | Tên tệp do người dùng tải lên | VARCHAR(255) | NOT NULL; tên tệp tối đa 255 ký tự |
| stored_filename | Tên tệp được hệ thống dùng khi lưu | VARCHAR(255) | NOT NULL; tên tệp tối đa 255 ký tự |
| storage_path | Đường dẫn đến tệp trong vùng lưu trữ | VARCHAR(1024) | NOT NULL; chuỗi đường dẫn tối đa 1024 ký tự |
| mime_type | Kiểu nội dung của tệp | VARCHAR(255) | NULL; dạng type/subtype, ví dụ video/mp4 |
| codec | Bộ mã hóa video | VARCHAR(100) | NULL; ví dụ h264, hevc |
| width | Chiều rộng khung hình | INTEGER | NULL; số pixel nguyên, giá trị nghiệp vụ mong đợi lớn hơn 0 |
| height | Chiều cao khung hình | INTEGER | NULL; số pixel nguyên, giá trị nghiệp vụ mong đợi lớn hơn 0 |
| fps | Tốc độ khung hình | DOUBLE PRECISION | NULL; số khung hình mỗi giây, ví dụ 25.0 |
| duration_ms | Thời lượng tệp | BIGINT | NULL; số mili giây |
| size_bytes | Kích thước tệp | BIGINT | NULL; số byte |
| sha256 | Mã kiểm tra toàn vẹn của tệp | VARCHAR(64) | NULL; 64 ký tự hệ thập lục phân |
| created_by | Người tải lên hoặc tạo tài sản | UUID | NULL; FK → users.id |
| created_at | Thời điểm tạo bản ghi | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- created_by được phép NULL để hỗ trợ tài sản được tạo bởi tiến trình hệ thống.
- Migration hiện chưa đặt CHECK cho width, height, fps, duration_ms và size_bytes; tính hợp lệ của các metadata này do lớp nghiệp vụ kiểm tra.

### 5.5. Bảng seats

**Tên bảng:** seats

**Mô tả bảng:** Lưu vị trí chuẩn hóa của từng ghế trong sơ đồ phòng thi. Tọa độ nằm trong miền từ 0 đến 1 để không phụ thuộc độ phân giải hình ảnh.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh ghế | UUID | PK, NOT NULL; UUID v4 |
| room_id | Phòng chứa ghế | UUID | NOT NULL; FK → rooms.id |
| code | Mã ghế trong phòng | VARCHAR(100) | NOT NULL; chuỗi tối đa 100 ký tự |
| x | Tọa độ trái của vùng ghế | DOUBLE PRECISION | NOT NULL; 0 ≤ x ≤ 1 |
| y | Tọa độ trên của vùng ghế | DOUBLE PRECISION | NOT NULL; 0 ≤ y ≤ 1 |
| width | Chiều rộng chuẩn hóa của vùng ghế | DOUBLE PRECISION | NOT NULL; 0 < width ≤ 1 |
| height | Chiều cao chuẩn hóa của vùng ghế | DOUBLE PRECISION | NOT NULL; 0 < height ≤ 1 |
| sort_order | Thứ tự hiển thị ghế | INTEGER | NULL; số nguyên |
| is_active | Trạng thái ghế còn được sử dụng | BOOLEAN | NOT NULL; TRUE hoặc FALSE; mặc định TRUE |
| created_at | Thời điểm tạo ghế | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |
| updated_at | Thời điểm cập nhật gần nhất | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- Tổ hợp room_id và code là duy nhất; cùng một phòng không thể có hai ghế trùng mã.
- x + width ≤ 1 và y + height ≤ 1, bảo đảm vùng ghế không vượt khỏi khung tọa độ chuẩn hóa.

### 5.6. Bảng cameras

**Tên bảng:** cameras

**Mô tả bảng:** Lưu cấu hình nguồn camera theo phòng. Trong schema hiện tại, nguồn của camera tham chiếu đến một media asset dùng làm nguồn phát hoặc nguồn mô phỏng.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh camera | UUID | PK, NOT NULL; UUID v4 |
| name | Tên camera | VARCHAR(255) | NOT NULL; chuỗi Unicode tối đa 255 ký tự |
| room_id | Phòng được camera giám sát | UUID | NOT NULL; FK → rooms.id |
| source_media_asset_id | Tài sản đa phương tiện làm nguồn camera | UUID | NOT NULL; FK → media_assets.id |
| description | Mô tả vị trí hoặc góc quan sát | TEXT | NULL; văn bản Unicode |
| is_active | Trạng thái camera được phép sử dụng | BOOLEAN | NOT NULL; TRUE hoặc FALSE; mặc định TRUE |
| created_at | Thời điểm tạo camera | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |
| updated_at | Thời điểm cập nhật gần nhất | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Chỉ mục:**

- ix_cameras_room_id trên room_id, phục vụ truy vấn danh sách camera theo phòng.

### 5.7. Bảng exam_sessions

**Tên bảng:** exam_sessions

**Mô tả bảng:** Lưu phiên thi, phòng tổ chức, nguồn video giám sát, trạng thái vòng đời và các mốc thời gian dự kiến hoặc thực tế.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh phiên thi | UUID | PK, NOT NULL; UUID v4 |
| session_code | Mã phiên thi | VARCHAR(100) | NOT NULL, UNIQUE; chuỗi tối đa 100 ký tự |
| exam_name | Tên kỳ thi hoặc môn thi | VARCHAR(255) | NOT NULL; chuỗi Unicode tối đa 255 ký tự |
| room_id | Phòng tổ chức phiên thi | UUID | NOT NULL; FK → rooms.id |
| video_asset_id | Video dùng để phát và phân tích | UUID | NULL; FK → media_assets.id |
| source_type | Loại nguồn giám sát | VARCHAR(20) | NOT NULL; CAMERA hoặc VIDEO_UPLOAD; mặc định VIDEO_UPLOAD |
| camera_id | Camera được chọn làm nguồn | UUID | NULL; FK → cameras.id |
| status | Trạng thái vòng đời phiên thi | VARCHAR(20) | NOT NULL; DRAFT, READY, RUNNING, PAUSED, COMPLETED, CANCELLED hoặc ERROR |
| scheduled_start | Thời gian bắt đầu dự kiến | TIMESTAMPTZ | NULL; ISO 8601 có múi giờ |
| scheduled_end | Thời gian kết thúc dự kiến | TIMESTAMPTZ | NULL; ISO 8601 có múi giờ |
| actual_start | Thời gian bắt đầu thực tế | TIMESTAMPTZ | NULL; ISO 8601 có múi giờ |
| actual_end | Thời gian kết thúc thực tế | TIMESTAMPTZ | NULL; ISO 8601 có múi giờ |
| runtime_profile | Hồ sơ cấu hình chạy AI | VARCHAR(100) | NULL; tên cấu hình tối đa 100 ký tự |
| created_by | Người tạo phiên thi | UUID | NOT NULL; FK → users.id |
| created_at | Thời điểm tạo phiên thi | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |
| updated_at | Thời điểm cập nhật gần nhất | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- session_code là duy nhất trên toàn hệ thống.
- Nếu source_type = VIDEO_UPLOAD thì camera_id phải là NULL.
- Nếu source_type = CAMERA thì camera_id và video_asset_id đều phải có giá trị.
- status chỉ nhận các giá trị thuộc vòng đời đã liệt kê.

### 5.8. Bảng session_candidates

**Tên bảng:** session_candidates

**Mô tả bảng:** Là thực thể phân công, xác định thí sinh nào ngồi ở ghế nào trong một phiên thi. Đây là danh tính nghiệp vụ ổn định của thí sinh trong phiên, không sử dụng Track ID làm định danh lâu dài.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh lượt tham dự và phân công ghế | UUID | PK, NOT NULL; UUID v4 |
| session_id | Phiên thi được tham dự | UUID | NOT NULL; FK → exam_sessions.id |
| candidate_id | Thí sinh tham dự | UUID | NOT NULL; FK → candidates.id |
| seat_id | Ghế được phân công | UUID | NOT NULL; FK → seats.id |
| created_at | Thời điểm tạo phân công | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- Tổ hợp session_id và candidate_id là duy nhất; một thí sinh chỉ xuất hiện một lần trong một phiên.
- Tổ hợp session_id và seat_id là duy nhất; một ghế chỉ được gán cho một thí sinh trong một phiên.
- Việc ghế thuộc đúng room_id của phiên thi là quy tắc nghiệp vụ; migration hiện chưa có CHECK hoặc trigger liên bảng để ép buộc điều này.

### 5.9. Bảng events

**Tên bảng:** events

**Mô tả bảng:** Lưu sự kiện nghi vấn do pipeline AI phát hiện trong phiên thi; đây không phải kết luận thí sinh gian lận. Schema vẫn cho phép nguồn `MANUAL`, nhưng ứng dụng hiện chưa có luồng tạo sự kiện thủ công.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh sự kiện | UUID | PK, NOT NULL; UUID v4 |
| event_code | Mã sự kiện | VARCHAR(100) | NOT NULL, UNIQUE; chuỗi tối đa 100 ký tự |
| session_id | Phiên thi phát sinh sự kiện | UUID | NOT NULL; FK → exam_sessions.id |
| source | Nguồn ghi nhận | VARCHAR(10) | NOT NULL; AI hoặc MANUAL |
| behavior_type | Loại hành vi nghi vấn | VARCHAR(40) | NULL; SUSPICIOUS_LOOKING, COMMUNICATING, EXCHANGE_OBJECT, USING_PHONE_CHEAT_SHEET hoặc OTHER |
| start_ms | Mốc bắt đầu sự kiện trong video | BIGINT | NOT NULL; số mili giây, start_ms ≥ 0 |
| end_ms | Mốc kết thúc sự kiện trong video | BIGINT | NOT NULL; số mili giây, end_ms ≥ start_ms |
| peak_ms | Mốc thể hiện rõ nhất của sự kiện | BIGINT | NULL; start_ms ≤ peak_ms ≤ end_ms |
| ai_confidence | Độ tin cậy do AI trả về | DOUBLE PRECISION | NULL; số thực từ 0 đến 1 |
| status | Trạng thái xử lý sự kiện | VARCHAR(20) | NOT NULL; PENDING_REVIEW, CONFIRMED, DISMISSED, NEEDS_REVIEW, DISPUTED hoặc RESOLVED |
| created_by | Người tạo sự kiện thủ công | UUID | NULL; FK → users.id; sự kiện AI hiện để NULL |
| created_at | Thời điểm tạo sự kiện | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |
| updated_at | Thời điểm cập nhật gần nhất | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc và chỉ mục:**

- event_code là duy nhất trên toàn hệ thống.
- Các CHECK bảo đảm khoảng thời gian hợp lệ và ai_confidence nằm trong miền từ 0 đến 1.
- Luồng hiện hành tạo sự kiện ở trạng thái PENDING_REVIEW và cho phép đánh giá thành CONFIRMED, DISMISSED hoặc NEEDS_REVIEW; DISPUTED và RESOLVED là các giá trị schema chưa có luồng xử lý.
- ix_events_session_id_start_ms trên session_id, start_ms.
- ix_events_session_id_status trên session_id, status.
- ix_events_session_id_behavior_type trên session_id, behavior_type.

### 5.10. Bảng event_actors

**Tên bảng:** event_actors

**Mô tả bảng:** Liên kết một sự kiện với một hoặc nhiều thí sinh trong phiên và mô tả vai trò của từng người trong sự kiện.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh liên kết đối tượng sự kiện | UUID | PK, NOT NULL; UUID v4 |
| event_id | Sự kiện liên quan | UUID | NOT NULL; FK → events.id |
| session_candidate_id | Thí sinh trong phiên liên quan | UUID | NOT NULL; FK → session_candidates.id |
| role | Vai trò của thí sinh trong sự kiện | VARCHAR(100) | NULL; chuỗi tối đa 100 ký tự |
| created_at | Thời điểm tạo liên kết | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- Tổ hợp event_id và session_candidate_id là duy nhất.
- Việc session_candidate_id thuộc cùng phiên với event_id là quy tắc nghiệp vụ; migration hiện chưa có CHECK hoặc trigger liên bảng để ép buộc điều này.

### 5.11. Bảng event_reviews

**Tên bảng:** event_reviews

**Mô tả bảng:** Lưu từng lần đánh giá một sự kiện. Mỗi bản ghi là một quyết định độc lập, giúp giữ lịch sử thay vì ghi đè kết quả cũ.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh lần đánh giá | UUID | PK, NOT NULL; UUID v4 |
| event_id | Sự kiện được đánh giá | UUID | NOT NULL; FK → events.id |
| reviewer_id | Người thực hiện đánh giá | UUID | NOT NULL; FK → users.id |
| decision | Quyết định của người đánh giá | VARCHAR(20) | NOT NULL; CONFIRM, DISMISS hoặc NEEDS_REVIEW |
| note | Nhận xét đi kèm quyết định | TEXT | NULL; văn bản Unicode |
| created_at | Thời điểm đánh giá | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc chính:**

- decision chỉ nhận CONFIRM, DISMISS hoặc NEEDS_REVIEW.
- Bảng cho phép nhiều lần đánh giá cho cùng một sự kiện để bảo toàn lịch sử.

### 5.12. Bảng audit_logs

**Tên bảng:** audit_logs

**Mô tả bảng:** Lưu dấu vết các thao tác quan trọng để phục vụ kiểm toán. Dữ liệu được thiết kế theo nguyên tắc chỉ ghi thêm; ứng dụng không sửa hoặc xóa lịch sử đã tạo.

| Tên cột | Mô tả | Kiểu dữ liệu | Khuôn dạng |
|---|---|---|---|
| id | Định danh bản ghi kiểm toán | UUID | PK, NOT NULL; UUID v4 |
| actor_user_id | Người thực hiện thao tác | UUID | NULL; FK → users.id; có thể NULL với tác vụ hệ thống |
| action | Tên hành động đã thực hiện | VARCHAR(100) | NOT NULL; chuỗi định danh hành động tối đa 100 ký tự |
| entity_type | Loại thực thể bị tác động | VARCHAR(100) | NOT NULL; tên thực thể tối đa 100 ký tự |
| entity_id | Định danh thực thể bị tác động | UUID | NULL; tham chiếu đa hình, không khai báo FK |
| metadata | Dữ liệu ngữ cảnh bổ sung | JSONB | NULL; đối tượng JSON hợp lệ |
| created_at | Thời điểm ghi nhận thao tác | TIMESTAMPTZ | NOT NULL; ISO 8601 có múi giờ; mặc định now() |

**Ràng buộc và chỉ mục:**

- ix_audit_logs_entity_type_entity_id trên entity_type, entity_id.
- ix_audit_logs_actor_user_id_created_at trên actor_user_id, created_at.
- ix_audit_logs_created_at trên created_at.
- ix_audit_logs_action trên action.
- entity_id không có khóa ngoại vì có thể chỉ đến nhiều loại bảng khác nhau.
- Nguyên tắc chỉ ghi thêm được thực thi ở tầng ứng dụng; migration hiện chưa tạo trigger PostgreSQL để cấm UPDATE hoặc DELETE.

## 6. Tổng hợp khóa ngoại

| Bảng nguồn | Cột khóa ngoại | Bảng đích | Cột đích | Ý nghĩa |
|---|---|---|---|---|
| media_assets | created_by | users | id | Người tạo tài sản |
| seats | room_id | rooms | id | Ghế thuộc phòng |
| cameras | room_id | rooms | id | Camera thuộc phòng |
| cameras | source_media_asset_id | media_assets | id | Nguồn của camera |
| exam_sessions | room_id | rooms | id | Phiên thi diễn ra tại phòng |
| exam_sessions | video_asset_id | media_assets | id | Video của phiên thi |
| exam_sessions | camera_id | cameras | id | Camera của phiên thi |
| exam_sessions | created_by | users | id | Người tạo phiên thi |
| session_candidates | session_id | exam_sessions | id | Phân công thuộc phiên thi |
| session_candidates | candidate_id | candidates | id | Thí sinh được phân công |
| session_candidates | seat_id | seats | id | Ghế được phân công |
| events | session_id | exam_sessions | id | Sự kiện thuộc phiên thi |
| events | created_by | users | id | Người ghi nhận sự kiện |
| event_actors | event_id | events | id | Đối tượng thuộc sự kiện |
| event_actors | session_candidate_id | session_candidates | id | Thí sinh trong phiên liên quan |
| event_reviews | event_id | events | id | Đánh giá thuộc sự kiện |
| event_reviews | reviewer_id | users | id | Người đánh giá |
| audit_logs | actor_user_id | users | id | Người thực hiện thao tác |

## 7. Quy tắc toàn vẹn dữ liệu nổi bật

1. Mã người dùng, phòng, thí sinh, phiên thi và sự kiện được bảo vệ bằng các ràng buộc UNIQUE tương ứng.
2. Mỗi thí sinh chỉ được phân một ghế trong một phiên và mỗi ghế chỉ được gán cho một thí sinh trong phiên đó.
3. Hình học ghế dùng tọa độ chuẩn hóa trong khoảng từ 0 đến 1 và không được vượt khỏi khung hình.
4. Khoảng thời gian của sự kiện phải có start_ms không âm, end_ms không nhỏ hơn start_ms và peak_ms nằm trong khoảng sự kiện.
5. Độ tin cậy AI, nếu có, phải nằm trong khoảng từ 0 đến 1.
6. Sự kiện AI chỉ là phát hiện nghi vấn. Kết luận được hình thành qua event_reviews và trạng thái của events; hệ thống không lưu cờ khẳng định một thí sinh gian lận.
7. Lịch sử đánh giá và nhật ký kiểm toán được lưu thành các bản ghi riêng để giữ dấu vết thay đổi.
8. Dữ liệu theo từng khung hình của pipeline YOLO11n và ByteTrack không được lưu trong PostgreSQL, giúp tránh tăng dữ liệu quá mức và không biến Track ID thành danh tính thí sinh.

## 8. Chuỗi dữ liệu nghiệp vụ chính

Luồng dữ liệu nghiệp vụ cốt lõi:

~~~text
rooms
  └── seats

exam_sessions
  ├── room
  ├── video hoặc camera
  ├── session_candidates
  │     ├── candidate
  │     └── seat
  └── events
        ├── event_actors
        └── event_reviews

users
  └── audit_logs
~~~

Quan hệ nghiệp vụ tổng quát của hệ thống:

~~~text
Room ──→ ExamSession ──→ SessionCandidate ←── Candidate
  └──→ Seat ───────────────────────────────↑

ExamSession ──→ Event ──→ EventReview
                   └────→ EventActor ──→ SessionCandidate
~~~

## 9. Phạm vi thiết kế

Phạm vi tài liệu là phần schema nghiệp vụ bền vững đang được ExamGuard truy cập. Các đối tượng chạy thời gian thực như frame, detection, bounding box, track và bộ đệm phân tích không phải thực thể lưu trữ lâu dài. Khi cần tái hiện hoặc kiểm tra một sự kiện, hệ thống sử dụng video nguồn, mốc thời gian, metadata sự kiện, lịch sử đánh giá và nhật ký kiểm toán.
