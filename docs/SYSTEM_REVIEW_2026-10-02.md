# Rà soát DOAN_THIEU — 02/10/2026

Mã nguồn nền được kiểm tra: commit `c2bf0b6`. Phạm vi: đối chiếu đặc tả, backend/frontend, chạy test hiện có, kiểm tra GPU và log; sau rà soát đã cập nhật preload/readiness/UI, không thay đổi database.

## Kết luận

Hệ thống đáp ứng luồng demo/MVP quản lý và phân tích video phòng thi, chưa đủ bằng chứng nghiệm thu toàn bộ nghiệp vụ hoặc độ chính xác AI trong triển khai thực tế. Sau đợt sửa cùng ngày, tracking và phân tích hành vi có readiness riêng; profile RTX 3060 compile X3D trong preload đồng bộ trước khi API nhận request. Benchmark mới đo cold preload 66,5 giây; sau đó model được dùng lại cho các phiên và không compile khi bấm Giám sát.

## Chức năng và nghiệp vụ

| Hạng mục | Hiện trạng từ mã nguồn | Đánh giá |
|---|---|---|
| Đăng nhập, phân quyền, quản lý tài khoản, audit | Có API/UI và test | Đáp ứng nền tảng |
| Phòng, vị trí ghế, thí sinh, phiên thi, phân công | Có CRUD, kiểm tra trạng thái và uniqueness | Có luồng cơ bản; ghế là bổ sung tùy chọn cho stable actor |
| Upload MP4, native playback, tracking overlay | Có ffprobe, HTML5 video, WebSocket, Canvas | Phù hợp kiến trúc realtime video |
| Start/pause/resume/seek/stop | Có runtime và kiểm thử | Đạt bộ test hiện có |
| Sự kiện AI, tìm kiếm, xác minh | Có API/UI, review append-only và audit | Đã triển khai; AI tạo PENDING_REVIEW |
| Sự kiện chưa xác định thí sinh | Có lưu runtime reference và gán thí sinh sau với audit | Có hỗ trợ; tài liệu X3D đã cập nhật |
| Dấu mốc/sự kiện thủ công | Không có endpoint tạo manual event trong events router, không thấy luồng Mark ở Monitoring | Thiếu so với FUNCTIONAL_SPEC |
| Chứng cứ | UI phát lại video nguồn, ngữ cảnh 3 giây mỗi bên | Chưa có API/UI tạo snapshot/context clip, khóa, xuất hoặc retention; model EvidenceAsset không đủ để coi tính năng hoàn tất |
| Khiếu nại | Có mô hình dữ liệu, không có router/trang nghiệp vụ | Chưa hoàn tất |
| Báo cáo, cấu hình hệ thống | Không có luồng tương ứng trong app/router | Chưa hoàn tất |
| Camera realtime | Camera hiện gắn source_media_asset_id; start dùng media_file_path và loop_source | Hiện là video mô phỏng camera, chưa phải pipeline camera trực tiếp |
| RTSP | POST /monitoring/rtsp/check gọi ffprobe | Chỉ probe; chưa nối RTSP vào giám sát và browser playback |

Nguồn: `docs/FUNCTIONAL_SPEC.md`, `backend/app/api/v1/router.py`, `backend/app/features/events/router.py`, `backend/app/features/cameras/service.py`, `backend/app/features/monitoring/service.py`, `backend/app/features/monitoring/rtsp_router.py`, `frontend/src/app/App.tsx`, `frontend/src/features/events/EventsPage.tsx`.

## UX: vấn đề nên sửa trước

1. **Đã xử lý — readiness hành vi:** MonitoringPage hiển thị riêng đang tải model, đang thu thập 3,2 giây hình ảnh, hoạt động, lỗi và tắt. Tracking vẫn được hiển thị độc lập.
2. **Đã xử lý — lỗi classifier:** UI nhận `behavior_status`/`action_error`, hiển thị trạng thái suy giảm và nói rõ nhận diện người vẫn tiếp tục hoạt động.
3. **Cao — camera có thể gây hiểu nhầm:** nhãn camera/realtime đang áp dụng cho video phát lặp. Cần ghi rõ nguồn mô phỏng hoặc hoàn thiện pipeline live camera; khi loop timestamp reset, xem lại lịch sử cần xác định đúng vòng nguồn.
4. **Đã xử lý — trạng thái video:** panel phân biệt sẵn sàng, đang phát và tạm dừng theo runtime.
5. **Đã xử lý — thuật ngữ kỹ thuật:** panel thông thường dùng nhãn tiếng Việt; số active/lost chỉ hiện khi bật chẩn đoán.
6. **Vừa — khoảng ngữ cảnh:** EventClip dùng CONTEXT_MS=3000, đặc tả khuyến nghị 5000 mỗi bên. Bổ sung chứng cứ giữ nguyên ngữ cảnh và bảo vệ khỏi mất video nguồn.
7. **Vừa — nguồn AI hiển thị cố định:** EventsPage ghi “X3D-L tự động” cho mọi source=AI; nếu bật R3 sẽ sai. Cần lưu/hiển thị provenance model đúng.

Đánh giá UX trên là từ code và test, chưa phải buổi usability test với giám thị thực hoặc kiểm thử trực quan toàn bộ trang trên trình duyệt.

## Startup, độ trễ và realtime

Profile rtx3060 hiện tại: target 18 FPS, queue analysis=1, drop stale=true, YOLO11n + ByteTrack + LogicalTrack; X3D-L bật, `compile=true`, R3 và R3 event FSM tắt. X3D events vẫn được tạo qua runtime riêng dù event_detection.enabled=false.

`main.py` preload model đồng bộ trong lifespan trước khi API sẵn sàng. `MonitoringRuntimeManager` cache detector/model theo process. Worker vẫn dùng load_async=True như đường dự phòng sau preload lỗi và publish tracking độc lập. Runtime/WebSocket trả readiness riêng; endpoint health cơ bản vẫn chỉ kiểm tra application/database.

Benchmark trực tiếp mới trên RTX 3060 12 GB, torch 2.7.1+cu126 ngày 02/10/2026: cold load/compile/warmup **66,492 giây**; hai lần suy luận liên tiếp với 6 actor là **193,7 ms** và **194,1 ms**. Model sau warmup là `OptimizedModule`. Inductor vẫn cảnh báo fallback ở một số graph của X3D head (`aten._local_scalar_dense`), nhưng phép đo hoàn tất thành công và không làm toàn bộ model quay về eager.

Số đo dưới đây là **artifact đã có ngày 29/09**, không phải benchmark mới của lần rà soát này:

| Chỉ số | Cold process | Phiên thứ hai cùng process |
|---|---:|---:|
| Worker start → tracking publication đầu | 2498 ms | 270 ms |
| Worker start → behavior publication đầu | 89516 ms | 3295 ms |
| Analysis FPS snapshot cuối | 16,50 | 16,51 |
| Detector latency snapshot cuối | 25,8 ms | 24,4 ms |
| Analysis lag snapshot cuối | 45 ms | 30 ms |

Nguồn: `docs/diagnostics/monitoring-startup-measurements.json`, `docs/diagnostics/tracking-startup-investigation.md`.

Các timing artifact không bao gồm đầy đủ HTTP request, import/lifespan, WebSocket delivery hoặc Canvas paint. FPS/lag là snapshot cuối, không phải P95 cả lượt. Với preload đồng bộ mới, cold compile hoàn tất trước khi API nhận request nên không còn tranh tài nguyên với phiên giám sát đầu tiên.

X3D dùng 16 mẫu cách 200 ms, cần khoảng 3,0–3,2 giây video để hình thành clip đầu tiên sau khi model sẵn sàng. Đây là kết quả phân loại đầu, không phải cam kết cảnh báo hay event đã được lưu. Smoothing 3 windows, min_windows=2 và ngưỡng 0,85/0,70 thêm độ trễ ra cảnh báo. Event hiện chỉ được lưu khi alert đóng, actor hết hạn, reset hoặc close; cảnh báo kéo dài có thể chưa xuất hiện ngay ở danh sách “Sự kiện đã ghi nhận”.

Realtime tracking có bounded/latest-frame semantics và kiểm tra runtime/generation sau seek. Tuy nhiên queue nhỏ không tự chứng minh end-to-end freshness. X3D buffer giữ 16 mẫu hiện có, chưa giới hạn span/gap của cả window khi source bỏ nhiều frame; _apply chỉ loại generation cũ/closed, chưa loại kết quả quá tuổi trong cùng generation. Cần thêm giới hạn temporal gap/span và prediction age để tránh clip lệch thời gian hoặc cập nhật muộn khi tải cao.

Không tìm thấy video phòng thi gốc trong data/uploads của workspace; MP4 tìm thấy trong /tmp là fixture do test tạo. Vì vậy không dùng chúng để đưa ra số đo độ chính xác/độ trễ phòng thi. GPU hiện tại là RTX3060 12 GB; torch 2.7.1+cu126 nhận CUDA. Có GPU không thay thế benchmark trên nguồn thực.

## Chất lượng nhận diện

- **Người/tracking:** TRACKING_VALIDATION_REPORT ghi nhận 60/60 person observations trên 9 timestamp của 3 clip độc lập. Đây là mini validation, không phải 100% accuracy mọi frame. Báo cáo còn fragmentation: 34 raw IDs cho 20 người; chưa đủ ground truth crossing/occlusion dài.
- **Stable identity/ghế:** SEAT_STABLE_IDENTITY_REPORT ghi 95,146% correct, 4,854% unassigned trên tập đã kiểm tra; nghiệm thu tổng thể chưa đạt do thiếu tình huống giám thị đi lại, đứng/rời ghế và calibration thực tế.
- **X3D-L:** X3D_INTEGRATION ghi 43/52 sự kiện được bắt ở S07/S08 (~82,7%) và 15,6 false alarms/person-hour. Đây là số liệu tài liệu, chưa tái lập trong lần này và chưa chứng minh tính đại diện hoặc cùng cấu hình production mới nhất. Mức báo sai này cần hiệu chỉnh và đánh giá lại trước nghiệm thu.
- **R3/TSM:** PHASE7_EVENT_AGGREGATION_REPORT ghi Event Precision/Recall/F1=0,1452/0,1047/0,1216, false events/min=1,0145; đang tắt. Không dùng kết quả R3 để đánh giá chất lượng X3D đang bật.
- AI confidence hiển thị là score model, không phải phần trăm độ chính xác hệ thống hoặc xác suất đã hiệu chuẩn rằng thí sinh vi phạm.

## Kiểm thử thực hiện trong lần này

- Frontend `npm test`: 13 files, 44 tests passed.
- Frontend `npm run typecheck`: passed.
- Backend ban đầu thiếu pytest; cài pytest 9.1.1 vào virtualenv có sẵn, không sửa pyproject/lockfile.
- Lượt backend mặc định: 171 passed, 4 failed, 3 skipped. Ba lỗi start API liên quan CONFIG_ROOT mặc định /app/configs không khớp workspace; một test action bất đồng bộ thất bại và đạt khi chạy riêng.
- Lượt toàn bộ với CONFIG_ROOT đúng: **175 passed, 3 skipped**, 7 deprecation warnings. Không che lỗi bằng sửa test. Test action có dấu hiệu nhạy scheduling cần cải thiện đồng bộ.
- Các test chủ yếu unit/API SQLite/fake model; không thay thế nghiệm thu PostgreSQL, GPU accuracy, live RTSP, browser paint, hoặc tải đa phiên.

Lệnh tái lập:

```bash
cd /workspace/DOAN_THIEU/backend
CONFIG_ROOT=/workspace/DOAN_THIEU/backend/configs .venv/bin/python -m pytest
cd /workspace/DOAN_THIEU/frontend
. /opt/nvm/nvm.sh
npm test
npm run typecheck
```

## Thứ tự bổ sung đề xuất

1. Duy trì preload compile đồng bộ và model cache theo process. Khởi động service trước ca thi, chờ API sẵn sàng rồi mới cho vận hành; benchmark lại cold startup khi thay GPU hoặc phiên bản PyTorch.
2. Bổ sung manual mark, chứng cứ context/snapshot/lock/export và lịch sử xem lại; sau đó reports và appeals theo phạm vi nghiệm thu.
3. Temporal span/gap/prediction age cho X3D; thông báo degraded khi tải tăng. Persistence event thất bại hiện log/counter, chưa thấy retry bền vững: cần cơ chế retry có giới hạn và cảnh báo vận hành để tránh mất finding.
4. Hoàn thiện hoặc ghi rõ giới hạn camera/RTSP; quy hoạch danh tính, timestamp và chứng cứ nguồn live.
5. Đánh giá accuracy với video có nhãn độc lập theo lớp, phòng/camera/ánh sáng/che khuất; đo event precision/recall/F1, false alarms/person-hour, thời gian phát hiện và ID switches. Kiểm tra tương tác tránh tạo nhiều event cho cùng một tình huống nếu nghiệp vụ yêu cầu ghép hai actor.
6. Đo ít nhất nhiều lượt cold/warm, 1/2/4 phiên và số người tăng: click → API → first tracking → Canvas paint, behavior ready, first alert, DB persistence; báo P50/P95/max, GPU/VRAM, dropped frames và stop/restart. Ngưỡng nghiệm thu cần thống nhất theo yêu cầu thật; không lấy số snapshot cũ làm SLA.

Tài liệu CURRENT_STATE.md và X3D_INTEGRATION.md còn mô tả cũ (thiếu events hoặc bỏ alert không có candidate), trong khi mã nguồn đã có events/unidentified persistence. Cần cập nhật tài liệu cùng checklist nghiệm thu để tránh đánh giá sai mức hoàn thành.
