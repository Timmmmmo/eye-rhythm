/* face.js — 程序化「脸 + 眼」渲染器（Canvas 2D，零素材）
 *
 * 为什么不用 AI 生成视频：
 *   图生视频每帧重新生成，角色的"脸"会漂移（越看越不像同一个人），
 *   而且延迟进不了实时交互。正确解法是 —— 固定角色资产 + 程序化驱动。
 *   本文件就是"固定资产"的代码化版本：一次定义参数，随时画出任意神态。
 *
 * 分层：
 *   静态层（头 / 毛 / 耳 / 鼻 / 嘴 / 斑纹）→ 离屏缓存，只画一次
 *   动态层（眼球 / 瞳孔 / 眼睑 / 眉毛 / 生理反应）→ 每帧重画
 *   两层套同一个「头部姿态」变换，就有"头在动"的错觉。
 *
 * anim 参数（全部 -1..1 或 0..x）：
 *   gazeX/gazeY   眼球偏移
 *   lidOpen       上眼睑开合：0=闭，1=正常，>1=睁大
 *   lowerLid      下眼睑上抬（眯）
 *   browRaise     眉毛整体上抬（+好奇 / -压眉）
 *   browAngle     眉毛角度：-内侧下压(怒) / +内侧上抬(忧)
 *   browAsym      眉毛左右不对称（怀疑）
 *   pupil         瞳孔缩放
 *   headYaw/Pitch/Roll  头部偏转
 *   mouth         嘴角（+笑 / -沉）
 *   blush / sweat 生理反应
 */
window.XTJY = window.XTJY || {};
(function (N) {
  "use strict";

  // ==================== 角色库 ====================
  var SPECIES = {
    human: {
      label: "人",
      head: { rx: 0.318, ry: 0.352, taper: 0.80 },
      eye: { dx: 0.150, dy: -0.048, rx: 0.090, ry: 0.048, tilt: -0.06, iris: 0.047 },
      brow: { dy: -0.136, len: 0.114, bend: 0.55, thick: 1.0 },
      ear: { dy: 0.028, dx: 0.318, rx: 0.046, ry: 0.066 },
      hair: true,
      nose: { dy: 0.086, w: 0.052, h: 0.040 },
      mouth: { dy: 0.206, w: 0.086 },
      skin: { base: "#ecc09b", mid: "#d9a47c", shade: "#bb8560", deep: "#97613f", rim: "#ffe6cb" },
      iris: { c1: "#7a5636", c2: "#452e1d" },
      sclera: "#faf5f3"
    },
    cat: {
      label: "猫",
      head: { rx: 0.315, ry: 0.285, taper: 0.95 },
      eye: { dx: 0.150, dy: -0.062, rx: 0.074, ry: 0.054, tilt: 0.10, iris: 0.043, slit: true },
      brow: { dy: -0.132, len: 0.084, bend: 0.6, thick: 0.65 },
      ear: { tri: true, dx: 0.238, dy: -0.212, w: 0.150, h: 0.200, tilt: 0.30 },
      nose: { dy: 0.098, w: 0.038, h: 0.028, tri: true },
      mouth: { dy: 0.146, w: 0.062, whisker: true },
      skin: { base: "#d8b98d", mid: "#c6a273", shade: "#a8814f", deep: "#7e5d35", rim: "#ffeccb", muzzle: "#f3e4cd" },
      iris: { c1: "#a8d94f", c2: "#5d8f1c" },
      sclera: "#f6f2e6",
      fur: { base: "#d9a866", mid: "#c08e4e", dark: "#9b6c35", stripes: "tabby", stripec: "#a8763a" }
    },
    wolf: {
      label: "狼",
      head: { rx: 0.312, ry: 0.300, taper: 0.86 },
      eye: { dx: 0.152, dy: -0.048, rx: 0.070, ry: 0.052, tilt: 0.14, iris: 0.041 },
      brow: { dy: -0.122, len: 0.090, bend: 0.5, thick: 0.8 },
      ear: { tri: true, dx: 0.232, dy: -0.212, w: 0.145, h: 0.210, tilt: 0.16 },
      nose: { dy: 0.108, w: 0.050, h: 0.036, tri: true, dark: true },
      mouth: { dy: 0.168, w: 0.080, fangs: true },
      skin: { base: "#b9bec6", mid: "#9aa1ab", shade: "#7a818c", deep: "#5a606a", rim: "#eef2f7", muzzle: "#dfe3e8" },
      iris: { c1: "#e8b04a", c2: "#a56c14" },
      sclera: "#f7f5ef",
      fur: { base: "#9ba1ab", mid: "#868d98", dark: "#6a707b", belly: "#d6dae0", stripes: "none" }
    },
    tiger: {
      label: "虎",
      head: { rx: 0.320, ry: 0.298, taper: 0.90 },
      eye: { dx: 0.155, dy: -0.052, rx: 0.074, ry: 0.055, tilt: 0.08, iris: 0.044 },
      brow: { dy: -0.128, len: 0.092, bend: 0.5, thick: 0.85 },
      ear: { tri: true, dx: 0.240, dy: -0.206, w: 0.148, h: 0.186, tilt: 0.26, round: true },
      nose: { dy: 0.104, w: 0.056, h: 0.040, tri: true, dark: true },
      mouth: { dy: 0.166, w: 0.090, fangs: true },
      skin: { base: "#e09348", mid: "#cf7c33", shade: "#b05f22", deep: "#8a4514", rim: "#ffd9a3", muzzle: "#f7e6d2" },
      iris: { c1: "#f5c542", c2: "#b57d0a" },
      sclera: "#faf4e8",
      fur: { base: "#e09348", mid: "#d07f39", dark: "#a95c1e", belly: "#f8ead6", stripes: "tiger", stripec: "#3b2415" }
    }
  };

  var STYLE = {
    toon: { lash: 1.9, lidLine: 2.4, browThick: 1.35, rim: 0.10, detail: 0.30, crease: 0.28, blur: 0.25 },
    semi: { lash: 1.2, lidLine: 1.6, browThick: 1.05, rim: 0.24, detail: 0.62, crease: 0.60, blur: 0.55 },
    real: { lash: 0.75, lidLine: 1.05, browThick: 0.85, rim: 0.38, detail: 1.0, crease: 0.95, blur: 0.9 }
  };

  // 阶梯：视觉拟真度与生动度逐级上升（游戏化的逐步暴露）
  var LEVELS = [
    { lv: 1, name: "卡通 · 静态", sub: "先把节奏练出来", species: "human", style: "toon", blink: false, drift: false, expr: false },
    { lv: 2, name: "半写实 · 静态", sub: "更像人了，但还不动", species: "human", style: "semi", blink: false, drift: false, expr: false },
    { lv: 3, name: "写实 · 会眨眼", sub: "开始有生命感", species: "human", style: "real", blink: true, drift: false, expr: false },
    { lv: 4, name: "写实 · 会游移", sub: "它会自己看别处", species: "human", style: "real", blink: true, drift: true, expr: false },
    { lv: 5, name: "写实 · 有表情", sub: "眼里的意思会变", species: "human", style: "real", blink: true, drift: true, expr: true },
    { lv: 6, name: "写实 · 有态度", sub: "它在回应你", species: "human", style: "real", blink: true, drift: true, expr: true, full: true }
  ];

  var ANIMALS = [
    { id: "cat", species: "cat", name: "猫", sub: "入门", scale: 1.0 },
    { id: "wolf", species: "wolf", name: "狼", sub: "进阶", scale: 1.02 },
    { id: "tiger", species: "tiger", name: "虎", sub: "终极", scale: 1.05 }
  ];

  function levelCfg(lv) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].lv === lv) return LEVELS[i];
    return LEVELS[0];
  }
  function animalCfg(id) {
    for (var i = 0; i < ANIMALS.length; i++) if (ANIMALS[i].id === id) return ANIMALS[i];
    return ANIMALS[0];
  }

  // ==================== 工具 ====================
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // 静态层缓存：key = species|style|W|H
  var staticCache = {};

  function animBase() {
    return {
      gazeX: 0, gazeY: 0, lidOpen: 1, lowerLid: 0,
      browRaise: 0, browAngle: 0, browAsym: 0, pupil: 1,
      headYaw: 0, headPitch: 0, headRoll: 0,
      mouth: 0, blush: 0, sweat: 0
    };
  }

  /** 把整体 anim 展开成左右眼各自的参数（browAsym 在这里起作用） */
  function sideState(anim, side) {
    var b = anim.browRaise || 0;
    var asym = (anim.browAsym || 0) * (side > 0 ? 1 : -1) * 0.5;
    return {
      gazeX: anim.gazeX || 0,
      gazeY: anim.gazeY || 0,
      lidOpen: anim.lidOpen,
      lowerLid: anim.lowerLid || 0,
      pupil: anim.pupil || 1,
      browRaise: b + asym,
      browAngle: (anim.browAngle || 0) * (side > 0 ? 1 : -1)
    };
  }

  // ==================== 几何 ====================
  function metrics(W, H, sp, scale) {
    var S = Math.min(W * 0.92, H * 0.86) * (scale || 1);
    return { S: S, cx: W / 2, cy: H * 0.5 - S * 0.02 };
  }

  function headPath(ctx, M, sp) {
    var rx = sp.head.rx * M.S, ry = sp.head.ry * M.S, t = sp.head.taper;
    var cx = M.cx, cy = M.cy;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - ry * 0.12);
    // 颅顶
    ctx.bezierCurveTo(cx - rx * 1.02, cy - ry * 1.12, cx + rx * 1.02, cy - ry * 1.12, cx + rx, cy - ry * 0.12);
    if (sp.fur) {
      // 兽类：宽下颚 + 短吻
      ctx.bezierCurveTo(cx + rx * 1.06, cy + ry * 0.34, cx + rx * 0.74, cy + ry * 0.80, cx + rx * 0.34, cy + ry * 0.92);
      ctx.bezierCurveTo(cx + rx * 0.12, cy + ry * 0.99, cx - rx * 0.12, cy + ry * 0.99, cx - rx * 0.34, cy + ry * 0.92);
      ctx.bezierCurveTo(cx - rx * 0.74, cy + ry * 0.80, cx - rx * 1.06, cy + ry * 0.34, cx - rx, cy - ry * 0.12);
    } else {
      // 人：颧骨 → 下颌角 → 收下巴（有转折，才不是一颗蛋）
      ctx.bezierCurveTo(cx + rx * 0.99, cy + ry * 0.16, cx + rx * 0.92, cy + ry * 0.34, cx + rx * 0.82, cy + ry * 0.52);
      ctx.bezierCurveTo(cx + rx * 0.70, cy + ry * 0.74, cx + rx * 0.44, cy + ry * 0.94, cx, cy + ry * 1.0);
      ctx.bezierCurveTo(cx - rx * 0.44, cy + ry * 0.94, cx - rx * 0.70, cy + ry * 0.74, cx - rx * 0.82, cy + ry * 0.52);
      ctx.bezierCurveTo(cx - rx * 0.92, cy + ry * 0.34, cx - rx * 0.99, cy + ry * 0.16, cx - rx, cy - ry * 0.12);
    }
    ctx.closePath();
  }

  function earPath(ctx, M, sp, sgn) {
    var e = sp.ear, cx = M.cx, cy = M.cy, S = M.S;
    ctx.save();
    ctx.translate(cx + sgn * e.dx * S, cy + e.dy * S);
    ctx.rotate(sgn * (e.tilt || 0));
    ctx.beginPath();
    var w = e.w * S, h = e.h * S;
    if (e.tri) {
      ctx.moveTo(-w * 0.5, h * 0.34);
      ctx.quadraticCurveTo(-w * 0.16, -h * 0.72, w * 0.06, -h * (e.round ? 0.78 : 1.0));
      ctx.quadraticCurveTo(w * 0.40, -h * 0.62, w * 0.5, h * 0.34);
      ctx.quadraticCurveTo(0, h * 0.52, -w * 0.5, h * 0.34);
    } else {
      ctx.ellipse(0, 0, e.rx * S, e.ry * S, 0, 0, Math.PI * 2);
    }
    ctx.closePath();
    ctx.restore();
  }

  // ==================== 静态层 ====================
  function buildStatic(W, H, ch) {
    var sp = SPECIES[ch.species] || SPECIES.human;
    var st = STYLE[ch.style] || STYLE.semi;
    var M = metrics(W, H, sp, ch.scale);
    var cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(W));
    cv.height = Math.max(2, Math.round(H));
    var ctx = cv.getContext("2d");
    var S = M.S, cx = M.cx, cy = M.cy, skin = sp.skin;

    // ---- 脖子 / 肩（窄一点，否则整张脸会像半身雕像底座）----
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - S * 0.118, cy + sp.head.ry * S * 0.62);
    ctx.lineTo(cx + S * 0.118, cy + sp.head.ry * S * 0.62);
    ctx.lineTo(cx + S * 0.30, cy + S * 0.62);
    ctx.lineTo(cx - S * 0.30, cy + S * 0.62);
    ctx.closePath();
    var neck = ctx.createLinearGradient(cx, cy + S * 0.2, cx, cy + S * 0.62);
    neck.addColorStop(0, skin.deep);
    neck.addColorStop(0.30, skin.shade);
    neck.addColorStop(1, skin.mid);
    ctx.fillStyle = neck;
    ctx.fill();
    // 下颌在脖子上的投影，把头和颈分开
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + sp.head.ry * S * 0.62, S * 0.135, S * 0.030, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(40,20,10,.85)";
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- 耳（先画，压在后脑后面）----
    ctx.save();
    var earGrad = ctx.createLinearGradient(cx - S * 0.4, cy, cx + S * 0.4, cy + S * 0.3);
    earGrad.addColorStop(0, skin.shade);
    earGrad.addColorStop(0.5, skin.base);
    earGrad.addColorStop(1, skin.mid);
    [-1, 1].forEach(function (sgn) {
      earPath(ctx, M, sp, sgn);
      ctx.fillStyle = sp.fur ? (sp.fur.dark || skin.shade) : earGrad;
      ctx.fill();
      if (sp.ear.tri) {
        ctx.save();
        ctx.translate(cx + sgn * sp.ear.dx * S, cy + sp.ear.dy * S);
        ctx.rotate(sgn * (sp.ear.tilt || 0));
        ctx.beginPath();
        var w = sp.ear.w * S * 0.52, h = sp.ear.h * S * 0.62;
        ctx.moveTo(-w * 0.42, h * 0.30);
        ctx.quadraticCurveTo(-w * 0.10, -h * 0.60, w * 0.06, -h * 0.74);
        ctx.quadraticCurveTo(w * 0.34, -h * 0.44, w * 0.42, h * 0.30);
        ctx.closePath();
        ctx.fillStyle = sp.species === "tiger" || sp.species === "cat" ? "rgba(214,140,150,.75)" : "rgba(150,140,150,.55)";
        ctx.fill();
        ctx.restore();
      }
    });
    ctx.restore();

    // ---- 头 ----
    headPath(ctx, M, sp);
    ctx.save();
    ctx.clip();
    var g = ctx.createRadialGradient(cx - S * 0.10, cy - S * 0.16, S * 0.04, cx, cy + S * 0.06, S * 0.62);
    g.addColorStop(0, skin.base);
    g.addColorStop(0.48, skin.mid);
    g.addColorStop(1, skin.shade);
    ctx.fillStyle = g;
    ctx.fillRect(cx - S, cy - S, S * 2, S * 2);

    // 颧骨 / 下颌结构阴影：没有这层，脸就是一颗蛋，看着像人体模特
    ctx.globalAlpha = 0.30;
    [-1, 1].forEach(function (sgn) {
      var jg = ctx.createLinearGradient(cx + sgn * S * 0.06, cy + S * 0.02, cx + sgn * S * 0.34, cy + S * 0.30);
      jg.addColorStop(0, "rgba(120,70,45,0)");
      jg.addColorStop(1, "rgba(120,70,45,.8)");
      ctx.fillStyle = jg;
      ctx.beginPath();
      ctx.moveTo(cx + sgn * S * 0.04, cy + S * 0.015);
      ctx.quadraticCurveTo(cx + sgn * S * 0.30, cy + S * 0.05, cx + sgn * S * 0.26, cy + S * 0.30);
      ctx.quadraticCurveTo(cx + sgn * S * 0.14, cy + S * 0.40, cx + sgn * S * 0.02, cy + S * 0.36);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 鼻梁侧影：用多段渐变"羽化"，不能用一个矩形 —— 否则脸上会出现一条硬边亮带
    // 起点原来在眉毛上方（cy-0.060S），整条太长，看着像脸上插了根管子；压到眼线以下
    [-1, 1].forEach(function (sgn) {
      var x0 = cx + sgn * S * 0.064, x1 = cx + sgn * S * 0.014;
      var N = 16;
      for (var i = 0; i < N; i++) {
        var t = i / (N - 1);
        var y = cy - S * 0.028 + t * S * 0.126;
        var fade = Math.sin(Math.PI * t);
        ctx.globalAlpha = 0.16 * fade;
        var gx = ctx.createLinearGradient(x0, 0, x1, 0);
        gx.addColorStop(0, "rgba(112,64,40,0)");
        gx.addColorStop(1, "rgba(112,64,40,1)");
        ctx.fillStyle = gx;
        ctx.fillRect(Math.min(x0, x1), y, S * 0.050, S * 0.011);
      }
    });
    ctx.globalAlpha = 1;

    // 面颊红晕底色
    ctx.globalAlpha = 0.16;
    [-1, 1].forEach(function (sgn) {
      var rg = ctx.createRadialGradient(cx + sgn * S * 0.21, cy + S * 0.13, 0, cx + sgn * S * 0.21, cy + S * 0.13, S * 0.16);
      rg.addColorStop(0, "#e8735f");
      rg.addColorStop(1, "rgba(232,115,95,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(cx - S, cy - S, S * 2, S * 2);
    });
    ctx.globalAlpha = 1;

    // 毛皮 / 斑纹
    if (sp.fur) paintFur(ctx, M, sp, ch, st);

    // 吻部（兽类）
    if (sp.skin.muzzle) {
      ctx.beginPath();
      ctx.ellipse(cx, cy + S * (sp.mouth.dy - 0.012), S * 0.150, S * 0.104, 0, 0, Math.PI * 2);
      ctx.fillStyle = sp.skin.muzzle;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 眼窝阴影
    ctx.globalAlpha = 0.20 * (0.6 + st.detail);
    [-1, 1].forEach(function (sgn) {
      var ex = cx + sgn * sp.eye.dx * S, ey = cy + sp.eye.dy * S;
      var sg = ctx.createRadialGradient(ex, ey - S * 0.012, 0, ex, ey - S * 0.012, S * 0.085);
      sg.addColorStop(0, skin.deep);
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(ex, ey - S * 0.010, S * 0.084, S * 0.062, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 鼻
    drawNose(ctx, M, sp, st);
    // 嘴
    drawMouth(ctx, M, sp, st, 0);

    // 高光 / 边缘光
    ctx.globalAlpha = st.rim;
    ctx.beginPath();
    ctx.ellipse(cx - S * 0.16, cy - S * 0.22, S * 0.20, S * 0.13, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = skin.rim;
    ctx.filter = "none";
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore(); // clip

    // 头发（人）
    if (sp.hair) {
      ctx.beginPath();
      ctx.ellipse(cx, cy - sp.head.ry * S * 0.66, sp.head.rx * S * 1.06, sp.head.ry * S * 0.62, 0, Math.PI, Math.PI * 2);
      ctx.fillStyle = "#241b15";
      ctx.fill();
      // 发际线碎发
      var rnd = mulberry32(hashStr("hair" + ch.seed));
      ctx.strokeStyle = "rgba(36,27,21,.9)";
      ctx.lineWidth = S * 0.004;
      for (var i = 0; i < 22; i++) {
        var a = Math.PI + rnd() * Math.PI;
        var x0 = cx + Math.cos(a) * sp.head.rx * S * 1.0;
        var y0 = cy - sp.head.ry * S * 0.66 + Math.sin(a) * sp.head.ry * S * 0.58;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + (rnd() - 0.5) * S * 0.02, y0 + S * 0.035, x0 + (rnd() - 0.5) * S * 0.05, y0 + S * 0.072);
        ctx.stroke();
      }
    }

    // 轮廓描边（卡通更重）
    headPath(ctx, M, sp);
    ctx.strokeStyle = "rgba(30,20,14," + (0.30 - 0.16 * st.detail) + ")";
    ctx.lineWidth = Math.max(1, S * (0.006 - 0.003 * st.detail));
    ctx.stroke();

    return cv;
  }

  function paintFur(ctx, M, sp, ch, st) {
    var S = M.S, cx = M.cx, cy = M.cy, f = sp.fur;
    var rnd = mulberry32(hashStr(ch.species + ch.seed));
    // 底色渐变
    var g = ctx.createLinearGradient(cx, cy - S * 0.3, cx, cy + S * 0.35);
    g.addColorStop(0, f.base);
    g.addColorStop(0.55, f.mid);
    g.addColorStop(1, f.dark || f.mid);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = g;
    ctx.fillRect(cx - S, cy - S, S * 2, S * 2);
    ctx.globalAlpha = 1;

    // 条纹
    if (f.stripes === "tiger") {
      ctx.strokeStyle = f.stripec;
      ctx.globalAlpha = 0.82;
      for (var i = 0; i < 9; i++) {
        var t = i / 8;
        var x = cx + (t - 0.5) * S * 0.62;
        var top = cy - S * 0.30 + Math.abs(t - 0.5) * S * 0.16;
        ctx.lineWidth = S * (0.010 + rnd() * 0.010);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.quadraticCurveTo(x + (rnd() - 0.5) * S * 0.04, top + S * 0.075, x + (rnd() - 0.5) * S * 0.05, top + S * 0.135);
        ctx.stroke();
      }
      // 两颊横纹
      [-1, 1].forEach(function (sgn) {
        for (var j = 0; j < 3; j++) {
          ctx.lineWidth = S * 0.008;
          ctx.beginPath();
          var y0 = cy + S * (0.03 + j * 0.045);
          ctx.moveTo(cx + sgn * S * 0.30, y0);
          ctx.quadraticCurveTo(cx + sgn * S * 0.24, y0 + S * 0.012, cx + sgn * S * 0.175, y0 + S * 0.006);
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    } else if (f.stripes === "tabby") {
      ctx.strokeStyle = f.stripec;
      ctx.globalAlpha = 0.62;
      for (var k = 0; k < 5; k++) {
        var y1 = cy - S * 0.24 + k * S * 0.055;
        ctx.lineWidth = S * 0.011;
        ctx.beginPath();
        ctx.moveTo(cx - S * 0.12, y1);
        ctx.quadraticCurveTo(cx, y1 - S * 0.028, cx + S * 0.12, y1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 短毛笔触（seeded，不逐帧抖动）
    if (st.detail > 0.4) {
      ctx.strokeStyle = f.dark || f.mid;
      ctx.globalAlpha = 0.10 * st.detail;
      ctx.lineWidth = S * 0.0025;
      for (var n = 0; n < 260; n++) {
        var a = rnd() * Math.PI * 2, r = rnd() * S * 0.30;
        var x0 = cx + Math.cos(a) * r, y0 = cy + Math.sin(a) * r * 0.95;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + (rnd() - 0.5) * S * 0.012, y0 + S * 0.012 * (0.4 + rnd()));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 鼻梁亮部
    var hl = ctx.createLinearGradient(cx, cy - S * 0.1, cx, cy + S * 0.16);
    hl.addColorStop(0, "rgba(255,255,255,0)");
    hl.addColorStop(0.5, sp.skin.rim);
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = hl;
    ctx.fillRect(cx - S * 0.055, cy - S * 0.18, S * 0.11, S * 0.34);
    ctx.globalAlpha = 1;
  }

  function drawNose(ctx, M, sp, st) {
    var S = M.S, cx = M.cx, cy = M.cy + sp.nose.dy * S;
    var w = sp.nose.w * S, h = sp.nose.h * S;
    ctx.save();
    ctx.beginPath();
    if (sp.nose.tri) {
      ctx.moveTo(cx - w * 0.82, cy - h * 0.52);
      ctx.quadraticCurveTo(cx, cy - h * 0.78, cx + w * 0.82, cy - h * 0.52);
      ctx.quadraticCurveTo(cx + w * 0.72, cy + h * 0.52, cx, cy + h * 0.70);
      ctx.quadraticCurveTo(cx - w * 0.72, cy + h * 0.52, cx - w * 0.82, cy - h * 0.52);
    } else {
      ctx.moveTo(cx - w * 0.55, cy - h * 0.42);
      ctx.quadraticCurveTo(cx, cy - h * 0.62, cx + w * 0.55, cy - h * 0.42);
      ctx.quadraticCurveTo(cx + w * 0.72, cy + h * 0.18, cx + w * 0.24, cy + h * 0.46);
      ctx.quadraticCurveTo(cx, cy + h * 0.62, cx - w * 0.24, cy + h * 0.46);
      ctx.quadraticCurveTo(cx - w * 0.72, cy + h * 0.18, cx - w * 0.55, cy - h * 0.42);
    }
    ctx.closePath();
    var ng = ctx.createLinearGradient(cx, cy - h, cx, cy + h);
    if (sp.nose.dark) { ng.addColorStop(0, "#4c4a4e"); ng.addColorStop(1, "#241f22"); }
    else { ng.addColorStop(0, sp.skin.shade); ng.addColorStop(1, sp.skin.deep); }
    ctx.fillStyle = ng;
    ctx.globalAlpha = sp.nose.dark ? 0.96 : 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 鼻头下缘投影 + 鼻孔：没有这两个，鼻子就"贴"不到脸上
    if (!sp.nose.dark) {
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.ellipse(cx, cy + h * 0.78, w * 0.60, h * 0.28, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(96,50,30,.9)";
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(72,38,26,.95)";
      [-1, 1].forEach(function (sgn) {
        ctx.beginPath();
        ctx.ellipse(cx + sgn * w * 0.46, cy + h * 0.30, w * 0.11, h * 0.17, sgn * 0.35, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawMouth(ctx, M, sp, st, mouth) {
    var S = M.S, cx = M.cx, cy = M.cy + sp.mouth.dy * S;
    var w = sp.mouth.w * S;
    ctx.save();
    ctx.strokeStyle = "rgba(60,32,24," + (0.55 + 0.25 * st.detail) + ")";
    ctx.lineWidth = Math.max(1, S * 0.0055);
    ctx.lineCap = "round";
    if (sp.fur) {
      // 兽类的"ω"形嘴
      ctx.beginPath();
      ctx.moveTo(cx, cy - S * 0.012);
      ctx.lineTo(cx, cy + S * 0.010);
      ctx.moveTo(cx, cy + S * 0.010);
      ctx.quadraticCurveTo(cx - w * 0.5, cy + S * 0.034, cx - w, cy - S * 0.004);
      ctx.moveTo(cx, cy + S * 0.010);
      ctx.quadraticCurveTo(cx + w * 0.5, cy + S * 0.034, cx + w, cy - S * 0.004);
      ctx.stroke();
      // 胡须（猫）
      if (sp.mouth.whisker) {
        ctx.strokeStyle = "rgba(255,255,255,.75)";
        ctx.lineWidth = Math.max(1, S * 0.0034);
        for (var i = 0; i < 3; i++) {
          var dy = cy + (i - 1) * S * 0.016;
          [-1, 1].forEach(function (sgn) {
            ctx.beginPath();
            ctx.moveTo(cx + sgn * w * 0.25, dy - S * 0.006);
            ctx.quadraticCurveTo(cx + sgn * w * 1.5, dy - S * 0.03, cx + sgn * w * 2.5, dy - S * 0.05 + i * S * 0.012);
            ctx.stroke();
          });
        }
      }
      // 獠牙
      if (sp.mouth.fangs) {
        ctx.fillStyle = "rgba(252,250,244,.94)";
        [-1, 1].forEach(function (sgn) {
          ctx.beginPath();
          ctx.moveTo(cx + sgn * w * 0.60, cy + S * 0.008);
          ctx.lineTo(cx + sgn * w * 0.70, cy + S * 0.030);
          ctx.lineTo(cx + sgn * w * 0.52, cy + S * 0.014);
          ctx.closePath();
          ctx.fill();
        });
      }
    } else {
      // 人：嘴角受 mouth 控制（+ 笑 / - 沉）
      var lift = mouth * S * 0.018;
      // 唇缝主线
      ctx.strokeStyle = "rgba(84,40,32,.82)";
      ctx.lineWidth = Math.max(1.1, S * 0.0058);
      ctx.beginPath();
      ctx.moveTo(cx - w, cy - lift * 0.30);
      ctx.quadraticCurveTo(cx, cy + S * 0.020 + lift, cx + w, cy - lift * 0.30);
      ctx.stroke();
      // 张嘴（惊讶 / 悲伤）
      if (mouth < -0.3) {
        var open = clamp((-mouth - 0.3) / 0.7, 0, 1) * S * 0.038;
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.80, cy - lift * 0.24);
        ctx.quadraticCurveTo(cx, cy + S * 0.020 + lift, cx + w * 0.80, cy - lift * 0.24);
        ctx.quadraticCurveTo(cx, cy + open + S * 0.020, cx - w * 0.80, cy - lift * 0.24);
        ctx.closePath();
        ctx.fillStyle = "rgba(58,24,22,.88)";
        ctx.fill();
      }
      // 下唇亮线
      ctx.strokeStyle = "rgba(198,120,106,.45)";
      ctx.lineWidth = Math.max(1, S * 0.0044);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.66, cy - lift * 0.22 + S * 0.008);
      ctx.quadraticCurveTo(cx, cy + S * 0.012 + lift * 0.62, cx + w * 0.66, cy - lift * 0.22 + S * 0.008);
      ctx.stroke();
      // 唇下阴影
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = "rgba(110,60,45,.9)";
      ctx.lineWidth = Math.max(1, S * 0.0038);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.56, cy + S * 0.030);
      ctx.quadraticCurveTo(cx, cy + S * 0.038 + lift * 0.4, cx + w * 0.56, cy + S * 0.030);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ==================== 动态层：眼 + 眉 ====================
  function eyeLens(ctx, ex, ey, rx, ry, st, tilt) {
    // 上睑弧（开合）+ 下睑弧（眯）
    var up = ry * clamp(st.lidOpen, 0, 1.45) * 1.12;
    var dn = ry * (1 - clamp(st.lowerLid, 0, 0.9) * 0.82) * 0.96;
    var ly = (tilt || 0) * ry * 0.75;
    var ax = ex - rx, ay = ey + ly;
    var bx = ex + rx, by = ey - ly;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ex - rx * 0.22, ey - up, bx, by);
    ctx.quadraticCurveTo(ex + rx * 0.22, ey + dn, ax, ay);
    ctx.closePath();
  }

  function drawEye(ctx, M, sp, st, anim, side) {
    var S = M.S, ex = M.cx + side * sp.eye.dx * S, ey = M.cy + sp.eye.dy * S;
    var rx = sp.eye.rx * S, ry = sp.eye.ry * S, tilt = sp.eye.tilt * side;
    var irisR = sp.eye.iris * S;

    var opened = clamp(st.lidOpen, 0, 1.45);
    var closed = opened < 0.10;

    if (closed) {
      // 闭眼：一条睑缝 +（卡通）睫毛
      ctx.save();
      ctx.strokeStyle = "rgba(46,28,20,.86)";
      ctx.lineWidth = Math.max(1.2, S * 0.0058 * (M.style === "toon" ? 1.7 : M.style === "semi" ? 1.2 : 0.9));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ex - rx, ey + tilt * ry * 0.7);
      ctx.quadraticCurveTo(ex, ey + ry * 0.36, ex + rx, ey - tilt * ry * 0.7);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    eyeLens(ctx, ex, ey, rx, ry, st, tilt);
    ctx.clip();

    // 巩膜
    var sg = ctx.createLinearGradient(ex - rx, ey - ry, ex + rx, ey + ry);
    sg.addColorStop(0, sp.sclera);
    sg.addColorStop(0.6, "#f3ecea");
    sg.addColorStop(1, "#ded3d1");
    ctx.fillStyle = sg;
    ctx.fillRect(ex - rx * 1.6, ey - ry * 2, rx * 3.2, ry * 4);

    // 上睑投影
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = "#3b2a24";
    ctx.beginPath();
    ctx.moveTo(ex - rx * 1.3, ey - ry * 2);
    ctx.lineTo(ex + rx * 1.3, ey - ry * 2);
    ctx.lineTo(ex + rx * 1.3, ey - ry * 0.10);
    ctx.quadraticCurveTo(ex, ey - ry * (0.70 * opened), ex - rx * 1.3, ey - ry * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 虹膜
    var ox = ex + st.gazeX * (rx - irisR * 0.72);
    var oy = ey + st.gazeY * (ry - irisR * 0.90);
    var pr = irisR * clamp(st.pupil, 0.5, 1.7);

    ctx.beginPath();
    ctx.arc(ox, oy, irisR, 0, Math.PI * 2);
    var ig = ctx.createRadialGradient(ox - irisR * 0.3, oy - irisR * 0.35, irisR * 0.1, ox, oy, irisR);
    ig.addColorStop(0, sp.iris.c1);
    ig.addColorStop(0.62, sp.iris.c2);
    ig.addColorStop(1, "rgba(0,0,0,.85)");
    ctx.fillStyle = ig;
    ctx.fill();

    // 虹膜纹理
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.lineWidth = Math.max(0.6, S * 0.0016);
    for (var i = 0; i < 14; i++) {
      var a = i / 14 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(ox + Math.cos(a) * irisR * 0.42, oy + Math.sin(a) * irisR * 0.42);
      ctx.lineTo(ox + Math.cos(a) * irisR * 0.92, oy + Math.sin(a) * irisR * 0.92);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 瞳孔（猫：竖裂）
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = "#08060a";
    ctx.beginPath();
    if (sp.eye.slit) ctx.ellipse(ox, oy, pr * 0.28, pr * 1.30, 0, 0, Math.PI * 2);
    else ctx.arc(ox, oy, pr * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 眼睑边缘阴影（让眼球"陷"进去）
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#2a1a14";
    ctx.beginPath();
    ctx.moveTo(ex - rx * 1.3, ey - ry * 2);
    ctx.lineTo(ex + rx * 1.3, ey - ry * 2);
    ctx.lineTo(ex + rx * 1.3, ey - ry * 0.42);
    ctx.lineTo(ex - rx * 1.3, ey - ry * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore(); // clip

    // 下睑反光：眼球看起来"湿"，靠的就是这一条
    // 下睑高光：原来 0.55 透明度、跨 0.7 个眼宽，看着像眼睛下面被人划了一道，压到几乎看不见
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.lineWidth = Math.max(0.7, S * 0.0018);
    ctx.beginPath();
    ctx.moveTo(ex - rx * 0.48, ey + ry * (1 - clamp(st.lowerLid, 0, 0.9) * 0.82) * 0.95);
    ctx.quadraticCurveTo(ex + rx * 0.15, ey + ry * (1 - clamp(st.lowerLid, 0, 0.9) * 0.82) * 1.02, ex + rx * 0.48, ey + ry * (1 - clamp(st.lowerLid, 0, 0.9) * 0.82) * 0.95);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 高光
    ctx.beginPath();
    ctx.arc(ox - irisR * 0.34, oy - irisR * 0.38, Math.max(1, irisR * 0.20), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ox + irisR * 0.34, oy + irisR * 0.34, Math.max(0.8, irisR * 0.09), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fill();

    // 上睑线 + 睫毛
    ctx.save();
    ctx.strokeStyle = "rgba(38,22,14,.92)";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.1, S * 0.0050 * (0.7 + 0.6 * (M.style === "toon" ? 1.5 : 1)));
    var up = ry * opened * 1.12;
    var ly = tilt * ry * 0.75;
    ctx.beginPath();
    ctx.moveTo(ex - rx, ey + ly);
    ctx.quadraticCurveTo(ex - rx * 0.22, ey - up, ex + rx, ey - ly);
    ctx.stroke();

    // 睫毛（按风格）
    // 原来 7 根等距、从内到外铺满整条睑缘，每根还很长 —— 放大看像用梳子刮出来的痕迹。
    // 改成 5 根、只集中在眼尾、再短一点，才像睫毛。
    var lashLen = S * 0.0085 * (M.lashScale || 1);
    if (lashLen > S * 0.004) {
      ctx.lineWidth = Math.max(0.8, S * 0.0028);
      var tA = side > 0 ? 0.40 : 0.60;   // 眼尾在靠脸外侧那一半
      var tB = side > 0 ? 1.00 : 0.00;
      for (var k = 0; k <= 4; k++) {
        var t = lerp(tA, tB, k / 4);
        var px = lerp(ex - rx * 0.95, ex + rx * 0.95, t);
        var cv2 = (1 - Math.pow(2 * t - 1, 2));
        var py = lerp(ey + ly, ey - ly, t) - up * cv2;
        var dir = side > 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + dir * lashLen * 0.3, py - lashLen * 0.6, px + dir * lashLen * 0.9, py - lashLen * 1.0);
        ctx.stroke();
      }
    }
    // 下睑线
    ctx.strokeStyle = "rgba(70,44,34,.55)";
    ctx.lineWidth = Math.max(1, S * 0.0030);
    var dn = ry * (1 - clamp(st.lowerLid, 0, 0.9) * 0.82) * 0.96;
    ctx.beginPath();
    ctx.moveTo(ex - rx * 0.98, ey + ly);
    ctx.quadraticCurveTo(ex + rx * 0.22, ey + dn, ex + rx * 0.98, ey - ly);
    ctx.stroke();
    ctx.restore();

    // 蒙古褶 / 内眼角
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = M.skinDeep || "#a9714f";
    ctx.beginPath();
    ctx.ellipse(ex - side * rx * 0.86, ey + tilt * ry * 0.7, rx * 0.20, ry * 0.40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function qp(a, b, c, t) { var u = 1 - t; return u * u * a + 2 * u * t * b + t * t * c; }

  function drawBrow(ctx, M, sp, st, side) {
    var S = M.S;
    var bx = M.cx + side * sp.eye.dx * S;
    var by = M.cy + (sp.brow.dy - (st.browRaise || 0) * 0.052) * S;
    var w = sp.brow.len * S;
    // browAngle>0 = 内侧上抬（忧），<0 = 内侧下压（怒）
    var innerX = bx - side * w * 0.55;
    var outerX = bx + side * w * 0.55;
    var innerY = by + (st.browAngle || 0) * S * 0.028;
    var outerY = by - (st.browAngle || 0) * S * 0.014;
    var ctrlX = bx + side * w * 0.10;
    var ctrlY = by - S * 0.022 - Math.abs(st.browAngle || 0) * S * 0.006;

    var th = S * 0.017 * sp.brow.thick * (M.browScale || 1);

    ctx.save();
    ctx.lineCap = "round";
    var grd = ctx.createLinearGradient(innerX, innerY, outerX, outerY);
    grd.addColorStop(0, "#2f1e14");
    grd.addColorStop(0.5, "#3a271b");
    grd.addColorStop(1, "#5a4234");
    ctx.strokeStyle = grd;

    // 分段画：内侧粗、外侧收成尖 —— 一根等宽的眉毛看着就像贴了条黑胶带
    var N = 14;
    for (var i = 0; i < N; i++) {
      var t0 = i / N, t1 = (i + 1) / N;
      var x0 = qp(innerX, ctrlX, outerX, t0), y0 = qp(innerY, ctrlY, outerY, t0);
      var x1 = qp(innerX, ctrlX, outerX, t1), y1 = qp(innerY, ctrlY, outerY, t1);
      var bulge = 1 + 0.22 * Math.sin(Math.PI * t0);
      var taper = 1.0 - 0.80 * t0 * t0;
      ctx.lineWidth = Math.max(0.5, th * bulge * taper);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // 眉尾碎毛，避免边缘太"剪影"
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(0.4, th * 0.22);
    for (var k = 1; k <= 4; k++) {
      var tk = 0.30 + k * 0.16;
      var px = qp(innerX, ctrlX, outerX, tk), py = qp(innerY, ctrlY, outerY, tk);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + side * S * 0.006, py - S * 0.010);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPhysio(ctx, M, anim) {
    var S = M.S, cx = M.cx, cy = M.cy;
    if (anim.blush > 0.01) {
      ctx.globalAlpha = clamp(anim.blush, 0, 1) * 0.42;
      [-1, 1].forEach(function (sgn) {
        var rg = ctx.createRadialGradient(cx + sgn * S * 0.21, cy + S * 0.13, 0, cx + sgn * S * 0.21, cy + S * 0.13, S * 0.14);
        rg.addColorStop(0, "#ef6a58");
        rg.addColorStop(1, "rgba(239,106,88,0)");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(cx + sgn * S * 0.21, cy + S * 0.13, S * 0.14, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    if (anim.sweat > 0.01) {
      ctx.globalAlpha = clamp(anim.sweat, 0, 1) * 0.85;
      ctx.fillStyle = "#bfe6ff";
      var sx = cx + S * 0.215, sy = cy - S * 0.135;
      ctx.beginPath();
      ctx.moveTo(sx, sy - S * 0.022);
      ctx.bezierCurveTo(sx + S * 0.016, sy - S * 0.004, sx + S * 0.012, sy + S * 0.020, sx, sy + S * 0.022);
      ctx.bezierCurveTo(sx - S * 0.012, sy + S * 0.020, sx - S * 0.016, sy - S * 0.004, sx, sy - S * 0.022);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ==================== 主入口 ====================
  /**
   * @param ctx   目标 2D 上下文
   * @param W,H   逻辑尺寸（CSS 像素；调用方负责 dpr）
   * @param ch    {species, style, seed, scale}
   * @param anim  animBase() 形状的参数对象
   */
  function draw(ctx, W, H, ch, anim, opts) {
    opts = opts || {};
    var sp = SPECIES[ch.species] || SPECIES.human;
    var st = STYLE[ch.style] || STYLE.semi;
    var M = metrics(W, H, sp, ch.scale);
    M.style = ch.style;
    M.skinDeep = sp.skin.deep;
    M.browScale = st.browThick * (ch.style === "toon" ? 1.0 : 0.9);
    M.lashScale = 1.0 * (ch.style === "toon" ? 1.7 : ch.style === "semi" ? 1.35 : 0.9);

    if (!opts.noClear) ctx.clearRect(0, 0, W, H);

    // 背景暗角（画布本身透明，这里给一层氛围）
    if (!opts.noBg) {
      var bg = ctx.createRadialGradient(M.cx, M.cy - H * 0.06, H * 0.08, M.cx, M.cy, H * 0.72);
      bg.addColorStop(0, "rgba(26,38,64,.55)");
      bg.addColorStop(1, "rgba(6,9,16,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }

    var key = ch.species + "|" + ch.style + "|" + Math.round(W) + "x" + Math.round(H) + "|" + (ch.seed || "");
    var layer = staticCache[key];
    if (!layer) {
      layer = buildStatic(W, H, ch);
      staticCache[key] = layer;
      if (Object.keys(staticCache).length > 6) {
        // 简单 LRU：避免无限膨胀
        var k0 = Object.keys(staticCache)[0];
        if (k0 !== key) delete staticCache[k0];
      }
    }

    ctx.save();
    // 头部姿态：以脸中心为轴，做平移 + 轻微旋转 + 横向压缩
    ctx.translate(M.cx, M.cy);
    ctx.rotate((anim.headRoll || 0) * 0.055);
    ctx.translate((anim.headYaw || 0) * M.S * 0.028, (anim.headPitch || 0) * M.S * 0.024);
    ctx.scale(1 - Math.abs(anim.headYaw || 0) * 0.035, 1);
    ctx.translate(-M.cx, -M.cy);

    ctx.drawImage(layer, 0, 0, W, H);

    var stL = sideState(anim, -1), stR = sideState(anim, 1);
    drawEye(ctx, M, sp, stL, anim, -1);
    drawEye(ctx, M, sp, stR, anim, 1);
    drawBrow(ctx, M, sp, stL, -1);
    drawBrow(ctx, M, sp, stR, 1);
    drawPhysio(ctx, M, anim);

    ctx.restore();
    return M;
  }

  N.face = {
    draw: draw,
    animBase: animBase,
    SPECIES: SPECIES,
    STYLE: STYLE,
    LEVELS: LEVELS,
    ANIMALS: ANIMALS,
    levelCfg: levelCfg,
    animalCfg: animalCfg,
    clamp: clamp,
    lerp: lerp
  };
})(window.XTJY);
