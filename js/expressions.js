/* expressions.js — 眼神语义预设（眼力游戏的题库 + 训练里的神态库）
 *
 * 为什么把"眼神语义"单独抽出来：
 * 让眼睛"会动"不是产品变量，"动出来的意思"才是。
 * 所以每个预设都是一组「可解释的几何特征」——
 *   眉高 / 眉角度（内侧下压=怒，内侧上抬=忧） / 眼睑开合 / 下眼睑收紧（眯） /
 *   瞳孔大小 / 视线方向 / 头部微倾 / 对称性 / 生理反应（潮红、汗）
 * 这些特征能被人读懂，也能被画出来——两条腿都成立。
 */
window.XTJY = window.XTJY || {};
(function (N) {
  "use strict";

  // 表情档位。字段含义见 face.js 的 anim 说明。
  // blinkMs：平均眨眼间隔（紧张时会明显变短，这是最容易做出来的"情绪泄漏"）
  var LIST = [
    {
      id: "curious", label: "好奇", tone: "正向 · 想继续听",
      blinkMs: 3400,
      hint: "眉毛整体上抬、眼睑张开、瞳孔放大——注意力被你抓住了，还想知道更多。",
      anim: { browRaise: 0.7, browAngle: 0.06, lidOpen: 1.16, pupil: 1.12, gazeY: -0.16, headPitch: -0.07, mouth: 0.15 }
    },
    {
      id: "scrutinizing", label: "审视", tone: "中性偏压 · 在评估你",
      blinkMs: 3200,
      hint: "眉毛内侧下压、眼睑收紧（眯）、瞳孔收缩——他在挑毛病，不是在欣赏你。",
      anim: { browRaise: -0.28, browAngle: -0.58, lidOpen: 0.7, lowerLid: 0.55, pupil: 0.86, mouth: -0.12 }
    },
    {
      id: "bored", label: "厌烦", tone: "负向 · 想结束",
      blinkMs: 4600,
      hint: "眼睑下垂、视线飘走、头微侧——不是害羞，是没兴趣了。这时候继续盯只会更糟。",
      anim: { browRaise: -0.42, browAngle: -0.1, lidOpen: 0.46, gazeX: -0.36, gazeY: 0.3, pupil: 0.84, headRoll: 0.13, mouth: -0.1 }
    },
    {
      id: "awkward", label: "尴尬", tone: "负向 · 不自在",
      blinkMs: 2200,
      hint: "眉毛内侧上抬 + 视线明显躲开 + 脸色发红——他在找出口。给他留个台阶，别追。",
      anim: { browRaise: 0.42, browAngle: 0.6, lidOpen: 1.08, gazeX: 0.5, gazeY: 0.42, pupil: 1.14, blush: 0.55, mouth: -0.2 }
    },
    {
      id: "warm", label: "温柔", tone: "正向 · 接纳",
      blinkMs: 4200,
      hint: "下眼睑微微收紧（这是真笑的标志）、眼睑柔和下垂、直视不闪——这是最舒服的一种注视。",
      anim: { browRaise: 0.2, browAngle: 0.14, lidOpen: 0.86, lowerLid: 0.38, pupil: 1.0, mouth: 0.55 }
    },
    {
      id: "surprised", label: "惊讶", tone: "中性 · 被意外击中",
      blinkMs: 6000,
      hint: "眉毛高抬、眼睑大幅张开、瞳孔瞬间放大、嘴张开——纯粹的信息冲击，没有评价。",
      anim: { browRaise: 1.0, browAngle: 0.1, lidOpen: 1.32, pupil: 1.5, mouth: -0.5, headPitch: -0.1 }
    },
    {
      id: "angry", label: "愤怒", tone: "负向 · 对抗",
      blinkMs: 2600,
      hint: "眉毛内侧大幅下压、上下眼睑同时收紧、瞳孔缩小——这是最容易被误读成「强势」的表情。",
      anim: { browRaise: -0.55, browAngle: -0.9, lidOpen: 0.74, lowerLid: 0.65, pupil: 0.78, mouth: -0.3 }
    },
    {
      id: "sad", label: "悲伤", tone: "负向 · 低落",
      blinkMs: 4000,
      hint: "眉毛内侧上抬、上眼睑下垂、视线往下——注意和「审视」的区别：悲伤的眉毛往上内收，不是往下压。",
      anim: { browRaise: 0.24, browAngle: 0.86, lidOpen: 0.7, gazeY: 0.34, pupil: 0.96, mouth: -0.35 }
    },
    {
      id: "skeptical", label: "怀疑", tone: "中性偏负 · 不信",
      blinkMs: 3600,
      hint: "只有一侧眉毛挑起来、头微侧、视线偏一点——不对称是关键；对称上抬是「好奇」。",
      anim: { browRaise: 0.46, browAngle: -0.26, browAsym: 0.85, lidOpen: 0.8, gazeX: 0.26, headRoll: 0.17, mouth: -0.18 }
    },
    {
      id: "nervous", label: "紧张", tone: "负向 · 自身不安",
      blinkMs: 1500,
      hint: "眉毛内侧上抬、眼睑略微张大、视线快速躲向一侧、眨眼明显变快、额头冒汗——眨眼频率是最好用的紧张指标。",
      anim: { browRaise: 0.55, browAngle: 0.4, lidOpen: 1.04, gazeX: -0.44, gazeY: 0.2, pupil: 1.22, sweat: 0.65, mouth: -0.15 }
    }
  ];

  var BY_ID = {};
  LIST.forEach(function (e) { BY_ID[e.id] = e; });

  // 易混对：生成干扰项时优先从这些里挑，题目才有区分度
  var CONFUSE = {
    curious: ["warm", "surprised", "skeptical"],
    scrutinizing: ["angry", "skeptical", "bored"],
    bored: ["sad", "scrutinizing", "awkward"],
    awkward: ["nervous", "sad", "surprised"],
    warm: ["curious", "bored", "nervous"],
    surprised: ["curious", "awkward", "nervous"],
    angry: ["scrutinizing", "skeptical", "bored"],
    sad: ["bored", "nervous", "awkward"],
    skeptical: ["scrutinizing", "curious", "angry"],
    nervous: ["awkward", "surprised", "sad"]
  };

  /** 从 10 个预设里抽 n 题（不重复） */
  function drawQuestions(n) {
    var pool = LIST.slice();
    shuffle(pool);
    return pool.slice(0, Math.min(n, pool.length));
  }

  /** 为目标表情生成 4 个选项（1 正确 + 3 干扰），并打乱顺序 */
  function optionsFor(expr) {
    var ids = [expr.id].concat((CONFUSE[expr.id] || []).slice(0, 3));
    var opts = ids.map(function (id) { return BY_ID[id]; });
    shuffle(opts);
    return { correctId: expr.id, options: opts };
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  N.expressions = {
    list: LIST,
    byId: BY_ID,
    drawQuestions: drawQuestions,
    optionsFor: optionsFor,
    shuffle: shuffle
  };
})(window.XTJY);
