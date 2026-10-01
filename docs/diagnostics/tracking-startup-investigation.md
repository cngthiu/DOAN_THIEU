# Điều tra tracking/behavior flicker và startup — 2026-09-29

## Phạm vi và flow thực tế

Profile được đo: `backend/configs/runtime/rtx3060.yaml`, Ultralytics **8.4.155**, PyTorch **2.7.1+cu126**, NVIDIA RTX 3060 12 GB. Profile hiện bật **X3D-L**, tắt R3/TSM và R3 event FSM. Những tên `communicating`, `suspicious_looking` là ánh xạ event của X3D; Canvas hiện đọc `cheat_prediction`, không vẽ trực tiếp R3 `action_prediction`.

```text
VideoDecoder.read_for_timestamp (source timestamp, source 25 FPS)
→ LatestValueBuffer (capacity 1; bỏ stale)
→ PersonDetector.detect (YOLO11n + NMS + nested-person suppression)
→ ByteTrackAdapter.update (chỉ trả active track)
→ LogicalTrackManager (actor history/recovery) + SeatAssignmentEngine
→ TrackingFrame → LatestWebSocketPublisher → native WebSocket
→ TrackingBuffer.nearest(video.currentTime) → HTML5 video + Canvas

Song song sau khi publish tracking:
tracks/frame → CheatingClassifierRuntime.update
→ sample bucket 200 ms + box history + 16 RGB frames
→ square crop chung theo actor, resize 356
→ queue capacity 1 → X3D-L (16 × 312 × 312, batch pad 8)
→ smoothing 3 windows + hysteresis 0.85/0.70, min 2 windows
→ actor.state/latest prediction → cheat_prediction
→ TrackingCanvas.cheatStateAt → màu/label hoặc fallback box tracking
```

| Công đoạn | File / hành vi |
|---|---|
| Model load, YOLO inference, NMS | `backend/app/ai/detector/yolo.py`, `PersonDetector` |
| YOLO hiện tại | conf=0.10, iou=0.50, imgsz=640, classes=[0], max_det=32, cuda:0, quantize=16 (API FP16 của bản cài đặt) |
| Duplicate suppression | containment=.90, area ratio=.70, center distance=.35, preferred confidence=.25 |
| Tracker | `backend/app/ai/tracker/bytetrack.py`; high=.25, low=.10, new=.40, buffer=30, match=.80, fuse_score=true |
| FPS/tracker units | Bản BYTETracker cài đặt **không có tham số frame_rate**; `max_frames_lost=args.track_buffer`, tăng frame_id mỗi update. 30 update ≈1.67 s tại 18 FPS, lâu hơn khi processing chậm. Không dùng nhầm source 25/30 FPS. |
| ID/history | ByteTrack tạo raw ID; `logical_tracking/manager.py` giữ actor/center history, grace 5500 ms; không dùng Track ID làm candidate identity |
| Seat grace | `seat_identity/assignment.py`, release 1500 ms |
| Behavior history/crop/queue | `cheating_classifier/runtime.py`, `_Actor`, `_make_job`, `_infer_loop`; minimum coverage 12/16, inference interval 1000 ms |
| X3D load/device/preprocess | `cheating_classifier/model.py`; checkpoint → CPU → CUDA, `.eval()`, `torch.no_grad()`, CUDA preprocessing, BF16 autocast; không bật FP16 tùy ý |
| R3 nếu bật | `action_recognition/runtime.py`, `buffer.py`, `roi.py`, `adapter.py`, `scheduler.py`; 8 segments/4 s, capture 160 ms, gap 750 ms, stride 1000 ms, batch 4; buffer prune sau span+gap, không xóa vì một miss |
| Rendering | `TrackingCanvas.tsx`: màu theo latest actor state; TTL 2600 ms theo timestamp nguồn, không xóa prediction mỗi frame; tracking tolerance ahead 250 / late 1200 ms |
| Transport | `worker.py` publish tracking trước action update; `publisher.py` coalesce theo message type, queue bounded 4 |

## Root causes đã xác nhận trước sửa

1. **Scheduling → behavior TTL → render fallback**: điều kiện cũ `sample % infer_every == 0` bỏ lỡ inference nếu latest-frame dropping bỏ đúng bucket chia hết. Regression tái hiện: không gửi các sample chia hết cho 5; code cũ không có prediction nào dù buffer đầy. Sau sửa, cùng chuỗi có ≥6 prediction, khoảng cách tối đa 1200 ms. TTL 2600 ms được giữ nguyên; không che vấn đề bằng cách giữ nhãn vô hạn.
2. **State giữa runtime/generation**: frontend nhận `cheat_prediction` không kiểm tra runtime/generation, đổi session và tracking generation chưa xóa cheat state nhất quán. Có thể dùng prediction cũ sau seek/đổi phiên. Đã kiểm tra runtime và xóa state đúng boundary.
3. **Startup bị chặn bởi classifier**: constructor `CheatingClassifierRuntime` gọi `model.ensure_loaded()` đồng bộ trong `_analyze`, trước `_on_ready` và detection đầu tiên. Cold X3D load/compile/warmup đo 69.986 ms; lần đo có profiling 76.8 s, warmup riêng 74.437 ms. Đây là bottleneck thực, không phải kết luận GPU yếu.
4. **YOLO reload mỗi video/worker**: `_detector_factory` tạo YOLO mới mỗi lần. Lần mở thứ hai vẫn trả giá load + predictor setup.
5. **Mất box không đồng nghĩa xóa state**: ByteTrack trả `[]` ở frame miss dù track đang Lost; Canvas chỉ vẽ track active. Logical actor giữ 5.5 s, X3D giữ actor 5 s, R3 buffer có grace. Không tìm thấy cleanup tức thì dạng xóa toàn bộ state vì `old_ids - active_ids`. Không thay tracker, không tăng buffer, không hạ conf.

## Thay đổi

- `ai/cheating_classifier/runtime.py`: schedule theo thời gian từ job cuối; reset cadence khi seek. Production worker dùng load bất đồng bộ, tracking không chờ classifier. Model sẵn sàng mới tích temporal frames; checkpoint metadata vẫn quyết định clip length. Log first buffer/first result; debug latest state có giới hạn.
- `ai/detector/yolo.py`: `DetectorRegistry` giữ predictor theo cấu hình trong process, warmup một lần, serialize inference của predictor dùng chung. Mỗi worker vẫn có adapter/counts riêng. Không chia sẻ tracker/history giữa sessions.
- `monitoring/manager.py`: preload detector và model enabled; cấp detector cache cho worker production. X3D registry đã tồn tại, không viết lại.
- `monitoring/worker.py`: timing video open, first read, acquire detector, tracker init, first inference, first tracking publish; gọi classifier với `load_async=True`; debug có giới hạn.
- `ai/cheating_classifier/model.py`: timing checkpoint/placement/warmup, log device/dtype của model và input một lần. Giữ `.eval()`, `no_grad()`, BF16 và compile như trước.
- `ai/tracker/bytetrack.py`, `monitoring/config.py`: snapshot Tracked/Lost/Removed, bbox, confidence, lost update count; lựa chọn tối đa 8 Track ID, tối đa 32 dòng/snapshot.
- `MonitoringPage.tsx`, `trackingBuffer.ts`: reject prediction khác runtime/generation, clear state khi đổi session/generation.
- Tests: skipped sampling slots, miss 1–3 updates/recovery/removal, actor cleanup, async model startup và worker tracking output, detector reuse/isolation, behavior TTL/normal/generation.
- `scripts/profile_monitoring_startup.py`: benchmark cold/warm dùng decoder/model/worker thật, không ghi database, không đo browser paint.

## Lifecycle sau sửa

`Tracked → Lost → Recovered / Removed`: ByteTrack giữ track 30 update theo implementation; metadata actor giữ 5500 ms, X3D giữ 5000 ms từ lần thấy cuối. Test 1–3 miss phục hồi cùng raw ID; hết buffer có TRACK_REMOVED. Không tạo box giả từ tọa độ cũ khi track Lost. Detection/track được publish ngay, không đợi clip hành vi.

Latest behavior cập nhật khi có prediction mới, kể cả normal. Không có result mới thì giữ state cũ; Canvas chỉ dùng trong TTL 2600 ms (có tolerance phía tương lai 1200 ms như trước). Seek/generation/session mới xóa state. Actor hết hạn được xóa khỏi runtime và snapshot kế tiếp. Không sửa hysteresis/threshold đã có.

## Đo GPU trước/sau (input tổng hợp 1280×720, không phải accuracy benchmark)

| Stage | Trước | Sau |
|---|---:|---:|
| YOLO load process đầu | 370.4 ms | 406.7 ms |
| YOLO inference đầu / warmup | 3399.3 ms | warmup 3451.3 ms |
| Inference đầu ở shape video sau warmup vuông | chưa tách | 250.2 ms |
| YOLO load/acquire phiên thứ hai | 109.7 ms | **0.1 ms** |
| YOLO inference đầu phiên thứ hai | 381.3 ms | **20.0 ms** |
| YOLO inference tiếp theo | 18.5 ms | 19.1 ms |
| X3D load/compile/warmup | 69986.2 ms | không giảm compile; chuyển khỏi luồng tracking |
| X3D ensure_loaded lần tiếp theo | <0.1 ms | registry cũ được giữ |
| X3D inference sau warmup | 171.7 ms | không đổi kiến trúc/precision |

Device xác nhận: YOLO parameters cuda:0/float16; X3D parameters cuda:0/float32, input cuda:0/float32 shape [8,3,16,312,312], autocast BF16=true. Input YOLO là numpy CPU theo API Ultralytics; CUDA placement được xác nhận từ predictor đã warmup. Cold compile có graph-break warnings từ pytorchvideo, không tuyên bố full-graph compilation hay cold startup đã hết chậm.

## Reproduce / diagnostics

```bash
cd backend
PYTHONPATH=. .venv/bin/python scripts/profile_monitoring_startup.py \
  ../data/uploads/928e0371-c45b-46ee-95d2-1e0f31416d03/source.mp4 \
  --seconds 30 --output /tmp/examguard-profile.json
```

Để trace một số ID, bật trong runtime YAML rồi khởi tạo phiên mới:

```yaml
tracking_debug:
  enabled: true
  track_ids: [12, 18]
  max_items: 8
  log_every_n_frames: 10
  suspicious_iou_threshold: 0.50
```

`log_every_n_frames` đếm analysis sequence, không modulo source frame ID để tránh bỏ lỡ log khi frame skipping. Log raw_post_nms trước nested suppression, detection sau suppression, tracker state/bbox/confidence và behavior timestamp. Đây **không** là logits dưới conf threshold; không dùng log này để khẳng định confidence thấp hơn 0.10 đã gây drop. Bỏ trống track_ids để lấy tối đa max_items dòng. Tắt debug sau khi thu mẫu.

## Video thật: cold/warm pipeline

Video upload `928e0371-c45b-46ee-95d2-1e0f31416d03/source.mp4`, 1280×720, 25 FPS; mỗi lượt chạy tiếp **30 giây sau behavior đầu tiên**. Cold run không preload: theo dõi thực sự tiếp tục trong lúc X3D compile. JSON đầy đủ: `monitoring-startup-measurements.json`.

| Stage / metric | Cold process | Video thứ hai, cùng model |
|---|---:|---:|
| Video open | 25.0 ms | 18.4 ms |
| First frame read | 23.5 ms | 13.9 ms |
| Tracker init (cold) | 0.3 ms | không tạo lại model weights |
| First tracking publication từ worker start | **2498.0 ms** | **269.9 ms** |
| First behavior publication từ worker start | 89516.3 ms | **3294.9 ms** |
| Temporal buffer ready (warm, từ classifier runtime init) | gồm cả compile wait | 3022.7 ms |
| Analysis FPS, snapshot cuối | 16.50 | 16.51 |
| Detector latency, snapshot cuối | 25.8 ms | 24.4 ms |
| Analysis lag, snapshot cuối | 45 ms | 30 ms |
| Tracking messages | 688 | 533 |
| Số active tracks min–max | 5–6 | 4–6 |
| Runtime errors / stop sạch | 0 / có | 0 / có |

Các số FPS/lag là **snapshot cuối**, không phải toàn-run p95 hay cam kết không jitter. Cold compile vẫn tranh tài nguyên và giảm throughput trong giai đoạn khởi động (688 message trong khoảng 119.5 s). Không tuyên bố đã loại hết cold GPU contention. Timing first tracking là backend publication, **chưa đo WebSocket delivery/browser Canvas paint**. Không so trực tiếp synthetic inference 20 ms với end-to-end warm startup 270 ms.

## Root cause mất box trên video thật và A/B cấu hình

Trace deterministic **540 updates / 30 source seconds**, đúng video trên, target 18 FPS; không có classifier để cô lập detector/tracker. Đọc trực tiếp cost matrix từ `BYTETracker.get_dists` sau Kalman prediction, không chỉ ước lượng từ bbox frame trước:

| Timestamp | Track ID | Detection vẫn có | Min fused matching cost | Gate cũ |
|---:|---:|---|---:|---:|
| 560 ms | 5 | conf .3008 | .8303 | .80 |
| 5840 ms | 5 | conf .2751, bbox thân trên → toàn thân | .9198 | .80 |
| 6000 ms | 5 | conf .3066, bbox đổi chiều cao | .9094 | .80 |
| 9120 ms | 5 | conf .4216 | .8230 | .80 |
| 28560 ms | 6 | detection cùng vùng conf .2583 | .8079 (min trên toàn row) | .80 |

Cả 5 lần đều có detection gần bbox trước, nhưng min first-stage cost vượt gate. High-confidence partition bắt đầu từ .25; detection .26–.31 không được chuyển lại sang low-score second pass khi first association fail. Đây là **ByteTrack mismatch do confidence fusion + biến động geometry**, không phải YOLO hoàn toàn không có person ở 5 mẫu này. Không có bằng chứng phải hạ detector conf=.10.

| Thử nghiệm | Created | Lost | Removed |
|---|---:|---:|---:|
| Baseline fuse=true, match=.80 | 7 | 5 | 1 |
| fuse=false, match=.80 (không áp dụng) | 7 | 2 | 2 |
| **fuse=true, match=.85 (đã áp dụng RTX 3060)** | **6** | **2** | **0** |

Chỉ sửa `backend/configs/tracking/bytetrack_exam_3060.yaml`: match_thresh .80 → .85. Giữ confidence, NMS, new-track threshold, track_buffer, fusion. Không chọn bỏ fusion: removal tăng và bbox track 5 mở rộng mạnh về phía người bên cạnh trong trace. Hai Lost còn lại ở 5840/6000 ms có cost >.90, được phục hồi; không nới gate tới mức đó để ghép những bbox khác hình dạng quá mạnh.

Artifacts: `tracking-baseline.json` (có exact costs), `tracking-match85.json`, `tracking-without-fusion.json`. Lượt startup end-to-end ở bảng trước chạy trước điều chỉnh matching (.80); A/B detector/tracker cô lập kiểm tra cấu hình .85 cuối cùng. Không coi giảm số ID là bằng chứng đã xác minh identity đúng với ground truth; chưa có annotation identity cho video này.

```bash
cd backend
PYTHONPATH=. .venv/bin/python scripts/trace_tracking.py \
  ../data/uploads/928e0371-c45b-46ee-95d2-1e0f31416d03/source.mp4 \
  --match-thresh 0.8 --output /tmp/tracking-baseline.json
# Bỏ --match-thresh để dùng .85 của profile hiện tại.
# --no-fuse-score chỉ phục vụ A/B; không thay file cấu hình.
```

## Tests và giới hạn còn lại

- Affected backend suites: 73 passed, 2 skipped; sau khi thêm hai test fused-cost gate, 45 tests của detector/worker/X3D/config chạy lại đều pass (75 test cases khác nhau đã pass tổng cộng). Hai skip do không mount checkpoint R3 và reference ROI clip.
- Frontend monitoring: 9 passed; TypeScript typecheck passed. Ruff passed.
- Test TSM cũ có một lần fail do loop dùng sleep 5 ms khi chạy đồng thời GPU compile; chạy riêng và chạy lại toàn bộ các suite liên quan đều pass. Không sửa timing test để che fail.
- X3D cold compile vẫn chậm và có graph-break warnings; tracking không chờ completion nhưng vẫn có thể tranh GPU/CPU. Không đổi compile/precision thiếu benchmark accuracy.
- Còn hai Lost tạm thời trong 30 s do geometry thay đổi mạnh. Canvas không vẽ box dự đoán cho Lost; metadata được giữ. Không cam kết box không biến mất ở mọi frame.
- Chưa đo browser paint hay xác minh bbox/identity trên toàn bộ video dài, camera khác, crossing/occlusion dài. Điều chỉnh matching mới chỉ có evidence cho đoạn video đã đo; có regression để không ghép detection không overlap.
- Không khởi động lại/deploy server đang chạy; thay đổi áp dụng khi chạy backend mới và dùng cấu hình mới.

Timing worker start không bao gồm import ứng dụng hoặc kết nối database; baseline riêng đo imports khoảng 2441 ms. Không có số đo HTTP readiness/application lifespan hoàn chỉnh trong lượt này.
