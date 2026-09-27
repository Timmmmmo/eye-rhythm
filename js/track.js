/* track.js — 端侧眼神追踪
 *
 * ▍隐私是设计前提，不是免责声明
 *   画面只在本机内存里过一遍：不落盘、不上传、不留帧、不做人脸辨识。
 *   推理跑在浏览器里（MediaPipe Face Landmarker，WASM），模型只下载一次。
 *   这既是合规最短路径（人脸/眼动属敏感个人信息），也是最好的产品话术。
 *
 * ▍三级降级（保证任何环境都能用）
 *   ready    摄像头 + 模型都就绪 → 真实测你的眼神
 *   nocam    没有摄像头 / 拒绝了权限 / 非 HTTPS → 按压式"手动注视"，全部玩法照常
 *   nosupport 浏览器不支持 → 同上
 *
 * ▍输出的指标（这才是护城河）
 *   looking   此刻是否在看对方眼睛（屏幕）
 *   gazeX/Y   视线偏移量，-1..1
 *   ear       眼睛纵横比（眨眼指标）
 *   blink     本帧是否发生一次眨眼
 *   yaw/pitch 头部偏转（回避时头会先动）
 */
window.XTJY = window.XTJY || {};
(function (N) {
  "use strict";

  var VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
  var WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
  var MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  // 关键点位（Face Mesh 478 点）
  var IDX = {
    lEye: { outer: 33, inner: 133, up: 159, down: 145, iris: 468 },
    rEye: { outer: 263, inner: 362, up: 386, down: 374, iris: 473 },
    noseTip: 4, chin: 152, forehead: 10
  };

  var T = {
    status: "idle",
    video: null,
    landmarker: null,
    stream: null,
    lastTs: -1,
    last: {
      faceSeen: false, looking: false, gazeX: 0, gazeY: 0,
      ear: 0.3, blink: false, yaw: 0, pitch: 0
    },
    // 平滑用的内部状态
    _gx: 0, _gy: 0, _earPrev: 0.3, _blinkCooldown: 0, _missFrames: 0,
    mock: false,
    onStatus: null
  };

  function setStatus(s, detail) {
    T.status = s;
    if (T.onStatus) { try { T.onStatus(s, detail); } catch (_) {} }
  }

  function statusText() {
    switch (T.status) {
      case "idle": return "摄像头：未启动";
      case "loading": return "摄像头：正在加载模型（首次约 3MB，之后有缓存）…";
      case "ready": return "摄像头：已就绪 · 画面只在本机计算";
      case "denied": return "摄像头：权限被拒绝 · 已切换按压模式";
      case "nocam": return "摄像头：不可用 · 已切换按压模式";
      case "nosupport": return "摄像头：此浏览器不支持 · 已切换按压模式";
      case "nomodel": return "摄像头：模型没下下来（可能网络受限）· 已切换按压模式";
      default: return "摄像头：" + T.status;
    }
  }

  function isFallback() {
    return T.status === "denied" || T.status === "nocam" || T.status === "nosupport" || T.status === "nomodel";
  }

  /** 现在是否可以用"按住屏幕 = 注视"兜底 */
  function canHold() {
    return T.status !== "ready" || isFallback();
  }

  function setMockOut(L) {
    L.faceSeen = true;                 // 兜底时视为"脸一直在"，避免统计被误判
    L.looking = T.mock;
    L.gazeX = T.mock ? 0 : -0.7;
    L.gazeY = T.mock ? 0 : 0.25;
    L.ear = 0.3;
    L.blink = false;
    L.yaw = 0; L.pitch = 0;
  }

  /** 按压模式：按住屏幕 = 在注视 */
  function setMock(v) { T.mock = !!v; }

  function init(video, onStatus) {
    T.video = video;
    if (onStatus) T.onStatus = onStatus;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("nosupport");
      return Promise.resolve(T.status);
    }
    if (!window.isSecureContext && location.protocol !== "file:") {
      setStatus("nocam", "非 HTTPS");
      return Promise.resolve(T.status);
    }

    setStatus("loading");
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    }).then(function (stream) {
      T.stream = stream;
      video.srcObject = stream;
      if (video.play) video.play().catch(function () {});
      return loadModel();
    }).catch(function (err) {
      var name = err && err.name ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setStatus("denied");
      else setStatus("nocam", name);
      return T.status;
    });
  }

  function loadModel() {
    return ensureModel(true).then(function () { return T.status; });
  }

  // 模型只加载一次：预热和正式初始化共用同一个 promise，避免下两遍
  var modelPromise = null;

  /**
   * @param reportStatus true = 这次加载要负责更新界面状态（init 走的路）
   *                     false = 静默预热（首页 idle 时走的路，不碰摄像头 → 不弹权限框）
   */
  function ensureModel(reportStatus) {
    if (T.landmarker) {
      if (reportStatus) setStatus("ready");
      return Promise.resolve(T.landmarker);
    }
    if (modelPromise) {
      // 已经有加载中的任务（比如首页预热起了头），挂上去等它，别重复下 3MB
      return modelPromise.then(function (lm) {
        if (reportStatus && lm) setStatus("ready");
        else if (reportStatus && !lm) setStatus("nomodel");
        return lm;
      });
    }

    // 模型要从 CDN 下 3MB 左右。国内网络可能很慢甚至不可达——绝不能让它把界面卡死：
    //   14 秒还没好，就先切到「按压模式」让玩家能玩；模型真的下下来了再自动升级为真实追踪。
    //   （静默预热时不设这个 14 秒的界面计时器，因为那时还没有"界面"要照顾）
    var settled = false;
    var timer = reportStatus
      ? setTimeout(function () {
          if (!settled && !T.landmarker) { settled = true; setStatus("nomodel", "超时"); }
        }, 14000)
      : setTimeout(function () {
          // 静默路径的兜底：真卡住了就把 promise 清掉，允许用户点进训练时重新发起
          if (!settled && !T.landmarker) { settled = true; modelPromise = null; }
        }, 90000);

    modelPromise = import(/* webpackIgnore: true */ VISION_URL).then(function (mod) {
      var Vision = mod.FilesetResolver ? mod : mod.default;
      return Vision.FilesetResolver.forVisionTasks(WASM_URL).then(function (fileset) {
        return Vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false
        });
      });
    }).then(function (lm) {
      T.landmarker = lm;
      clearTimeout(timer);
      settled = true;
      if (reportStatus) setStatus("ready");
      return lm;
    }).catch(function () {
      clearTimeout(timer);
      if (!settled) { settled = true; if (reportStatus) setStatus("nomodel"); }
      modelPromise = null;   // 失败就别把坏 promise 粘住，下次还能重试
      return null;
    });
    return modelPromise;
  }

  /**
   * 静默预热：只下模型/WASM 进缓存，**不申请摄像头**（所以不会一进首页就弹权限框）。
   * 实测线上首次冷缓存要 ~17 秒才 ready —— 把这 17 秒藏到用户看首页的时候，
   * 比让他点进训练再干等好得多。省流量 / 慢网时主动跳过。
   */
  function warm() {
    if (T.landmarker || modelPromise) return modelPromise || Promise.resolve(T.landmarker);
    try {
      var c = navigator.connection || navigator.mozConnection || {};
      if (c.saveData) return Promise.resolve(null);                       // 用户开了省流量
      if (/^(slow-)?2g$/.test(String(c.effectiveType || ""))) return Promise.resolve(null);  // 慢网别下 3MB
    } catch (_) {}
    return ensureModel(false);
  }

  function stop() {
    if (T.stream) {
      try { T.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      T.stream = null;
    }
    if (T.video) { try { T.video.srcObject = null; } catch (_) {} }
  }

  /** 每帧读一次；返回 T.last（对象引用，别缓存） */
  function read(now) {
    var L = T.last;
    var realOk = (T.status === "ready") && T.video && T.video.readyState >= 2;

    // 真实追踪没在跑（模型还在下载 / 没摄像头 / 权限被拒）→ 用按压兜底
    // 注意：不能只在"明确降级"时兜底，否则模型下载那几秒里整个应用是死的。
    if (!realOk) {
      setMockOut(L);
      return L;
    }

    var ts = now;
    if (ts <= T.lastTs) ts = T.lastTs + 1;
    T.lastTs = ts;

    var res = null;
    try { res = T.landmarker.detectForVideo(T.video, ts); } catch (_) { res = null; }

    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) {
      T._missFrames = (T._missFrames || 0) + 1;
      // 连续丢 5 帧才判"看不见脸"，避免抖动
      if (T._missFrames > 5) {
        L.faceSeen = false;
        L.looking = T.mock;      // 人不在画面里时，允许按压兜底
        L.blink = false;
        T._gx *= 0.9; T._gy *= 0.9;
        L.gazeX = T._gx; L.gazeY = T._gy;
      }
      return L;
    }
    T._missFrames = 0;

    var p = res.faceLandmarks[0];
    var W = 1, H = 1;

    function ratio(eye) {
      var outer = p[eye.outer], inner = p[eye.inner];
      var iris = p[eye.iris];
      var dx = inner.x - outer.x;
      if (Math.abs(dx) < 1e-6) return 0.5;
      var r = (iris.x - outer.x) / dx;
      // inner 可能在 outer 左边或右边，统一到"0=偏外，1=偏内"
      return dx > 0 ? r : 1 - r;
    }
    function vratio(eye) {
      var up = p[eye.up], dn = p[eye.down], iris = p[eye.iris];
      var dy = dn.y - up.y;
      if (Math.abs(dy) < 1e-6) return 0.5;
      return (iris.y - up.y) / dy;
    }
    function dist(a, b) {
      var ddx = a.x - b.x, ddy = a.y - b.y;
      return Math.sqrt(ddx * ddx + ddy * ddy);
    }

    var gxL = ratio(IDX.lEye), gxR = 1 - ratio(IDX.rEye);  // 两眼取"同向"
    var hx = (gxL + gxR) / 2;                              // 0..1，0.5 = 正对
    var vL = vratio(IDX.lEye), vR = vratio(IDX.rEye);
    var vy = (vL + vR) / 2;

    // 头部偏转：两眼视觉宽度不对称 ⇒ 转头
    var wl = dist(p[IDX.lEye.outer], p[IDX.lEye.inner]);
    var wr = dist(p[IDX.rEye.outer], p[IDX.rEye.inner]);
    var yaw = (wl - wr) / Math.max(1e-6, (wl + wr));
    var noseLen = dist(p[IDX.noseTip], p[IDX.chin]);
    var faceH = dist(p[IDX.forehead], p[IDX.chin]);
    var pitch = (noseLen / Math.max(1e-6, faceH)) - 0.42;   // 大致基准

    // 眼纵横比（眨眼）
    var earL = dist(p[IDX.lEye.up], p[IDX.lEye.down]) / Math.max(1e-6, wl);
    var earR = dist(p[IDX.rEye.up], p[IDX.rEye.down]) / Math.max(1e-6, wr);
    var ear = (earL + earR) / 2;

    // 平滑（EMA）：原始点位抖动很大，不平滑会让人看着"发神经"
    var k = 0.28;
    T._gx = T._gx + ((hx - 0.5) * 2 - T._gx) * k;
    T._gy = T._gy + ((vy - 0.55) * 2 - T._gy) * k;

    // 眨眼检测：EAR 下穿阈值 → 记一次眨眼
    var blinking = ear < 0.16;
    var blinkEvent = false;
    if (blinking && T._earPrev >= 0.16) { T._blinkCooldown = 12; }
    if (T._blinkCooldown > 0) {
      T._blinkCooldown--;
      if (T._blinkCooldown === 0) blinkEvent = true;
    }
    T._earPrev = ear;

    var yawAbs = Math.abs(yaw);
    var looking = Math.abs(T._gx) < 0.62 && Math.abs(T._gy) < 0.85 && yawAbs < 0.30;

    L.faceSeen = true;
    L.looking = looking;
    L.gazeX = T._gx;
    L.gazeY = T._gy;
    L.ear = ear;
    L.blink = blinkEvent;
    L.yaw = yaw;
    L.pitch = pitch;
    return L;
  }

  N.track = {
    init: init,
    warm: warm,
    read: read,
    stop: stop,
    setMock: setMock,
    statusText: statusText,
    isFallback: isFallback,
    canHold: canHold,
    state: function () { return T; },
    URLS: { VISION_URL: VISION_URL, WASM_URL: WASM_URL, MODEL_URL: MODEL_URL }
  };
})(window.XTJY);
