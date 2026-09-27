/* app.js — 界面装配与主循环
 * 依赖（按 index.html 的加载顺序）：store → expressions → face → session → track → quiz
 */
(function (N) {
  "use strict";

  var store = N.store, F = N.face;
  var $ = function (id) { return document.getElementById(id); };

  // ==================== 屏幕路由 ====================
  var SCREENS = ["screenHome", "screenTrain", "screenResult", "screenQuiz", "screenAnimal"];
  var curScreen = "screenHome";
  function show(id) {
    SCREENS.forEach(function (s) { $(s).classList.toggle("show", s === id); });
    curScreen = id;
    $("main").scrollTop = 0;
    if (id !== "screenTrain") stopTrain(false);
    if (id !== "screenAnimal") stopAnimal();
    if (id !== "screenQuiz") stopQuiz();
  }

  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("on"); }, ms || 1900);
  }

  // ==================== 画布辅助 ====================
  // 前提：canvas 的布局尺寸必须由 CSS 决定（#stage/#qStage/#aStage 是 100%，#spark 是 100%×70px）。
  // 否则下面改 cv.width/height 会改动布局尺寸，量一次放大一次 —— dpr=2 时直接翻倍。
  // 这条约束由 _dev/cdp-check.js 的「连调两次尺寸不许变大」断言守着。
  function fitCanvas(cv) {
    var r = cv.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width || 320));
    var h = Math.max(1, Math.round(r.height || 240));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function easeObj(cur, tgt, k) {
    Object.keys(tgt).forEach(function (key) {
      var c = cur[key] === undefined ? tgt[key] : cur[key];
      cur[key] = c + (tgt[key] - c) * k;
    });
    return cur;
  }

  function download(url, name) {
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); }, 120);
  }

  // ==================== 首页 ====================
  function renderHome() {
    var d = store.get(), t = store.day();
    var has = t.sessions > 0;
    $("homeScore").textContent = has ? t.score : "—";
    // .empty 必须挂在 .score-big 上：规则是 .score-big.empty，
    // 挂在里面那个 span 上不匹配，background-clip:text 会把渐变透出来，看着像一根进度条
    $("scoreBig").classList.toggle("empty", !has);
    $("todayScore").textContent = has ? t.score : "—";

    var st = store.streak();
    $("homeStreak").innerHTML = st > 0
      ? "连续打卡 <b>" + st + "</b> 天 · 今天已练 " + t.sessions + " 轮"
      : (has ? "今天已练 " + t.sessions + " 轮" : "还没有记录 · 今天开个头");

    var items = [
      { u: has ? t.best.toFixed(1) + "s" : "—", s: "最长注视" },
      { u: has ? t.avg.toFixed(1) + "s" : "—", s: "平均轮次" },
      { u: has ? Math.round(t.hit * 100) + "%" : "—", s: "命中率" },
      { u: has ? t.blinks : "—", s: "眨眼/分" }
    ];
    $("homeMetrics").innerHTML = items.map(function (m) {
      return '<div class="m"><u>' + m.u + "</u><s>" + m.s + "</s></div>";
    }).join("");

    var sparkEmpty = drawSpark($("spark"), store.last(14));
    $("sparkHint").classList.toggle("on", !!sparkEmpty);
    renderLevels();

    var q = d.quiz;
    $("goQuiz").querySelector("span").textContent = q.plays ? ("最好 " + q.best + " 分 · 已玩 " + q.plays + " 次") : "读懂眼神 · 10 题";
    var ab = bestAnimal();
    $("goAnimal").querySelector("span").textContent = ab ? ("当前最佳 " + ab.sec + "s（" + ab.name + "）") : "你能和它对视几秒";
  }

  function drawSpark(cv, data) {
    var f = fitCanvas(cv), ctx = f.ctx, w = f.w, h = f.h;
    ctx.clearRect(0, 0, w, h);
    var pad = 6;
    var max = Math.max(60, Math.max.apply(null, data.map(function (x) { return x.score; })));
    var y60 = h - pad - (60 / max) * (h - pad * 2);

    // 一条都没有数据时，别画 14 个 2px 小短杠（看着像 bug），只给一条基线
    var allZero = data.every(function (d) { return d.score === 0; });
    if (allZero) {
      ctx.strokeStyle = "rgba(120,150,200,.22)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pad, h - pad - 1);
      ctx.lineTo(w - pad, h - pad - 1);
      ctx.stroke();
      ctx.fillStyle = "rgba(107,124,153,.75)";
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(255,178,107,.28)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, y60); ctx.lineTo(w - pad, y60); ctx.stroke();
      ctx.setLineDash([]);
      return true; // 空状态：文案交给 #sparkHint（DOM），见 style.css 注释
    }

    // 目标线 60
    ctx.strokeStyle = "rgba(255,178,107,.28)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pad, y60); ctx.lineTo(w - pad, y60); ctx.stroke();
    ctx.setLineDash([]);

    var bw = (w - pad * 2) / data.length;
    data.forEach(function (d, i) {
      var x = pad + i * bw + bw * 0.18;
      var bwid = bw * 0.64;
      var hgt = d.score > 0 ? Math.max(3, (d.score / max) * (h - pad * 2)) : 3;
      var y = h - pad - hgt;
      var g = ctx.createLinearGradient(0, y, 0, h - pad);
      if (d.score >= 70) { g.addColorStop(0, "#5ee0a8"); g.addColorStop(1, "rgba(94,224,168,.25)"); }
      else if (d.score >= 45) { g.addColorStop(0, "#ffb26b"); g.addColorStop(1, "rgba(255,178,107,.22)"); }
      else { g.addColorStop(0, "#4a5a7a"); g.addColorStop(1, "rgba(74,90,122,.2)"); }
      ctx.fillStyle = g;
      roundRect(ctx, x, y, bwid, hgt, 2);
      ctx.fill();
    });
    return false;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderLevels() {
    var d = store.get();
    $("levelList").innerHTML = F.LEVELS.map(function (lv) {
      var unlocked = lv.lv <= d.unlocked;
      var best = d.levelBest[lv.lv] || 0;
      var done = best >= 60;
      var cls = "lv" + (unlocked ? "" : " locked") + (done ? " done" : "");
      return '<button class="' + cls + '" data-lv="' + lv.lv + '">' +
        '<span class="lv-no">' + (done ? "✓" : lv.lv) + "</span>" +
        '<span class="lv-txt"><b>' + lv.name + "</b><span>" + lv.sub +
        (best ? " · 最好 " + best + " 分" : "") + "</span></span>" +
        '<span class="lv-go">' + (unlocked ? "开始 ›" : "锁") + "</span></button>";
    }).join("");

    Array.prototype.forEach.call($("levelList").querySelectorAll(".lv"), function (el) {
      el.addEventListener("click", function () {
        var lv = parseInt(el.getAttribute("data-lv"), 10);
        if (lv > store.get().unlocked) { toast("先过上一关：单轮 60 分即解锁"); return; }
        startTrain(lv);
      });
    });
  }

  // ==================== 训练 ====================
  var train = {
    phase: "idle",
    sess: null, level: 1, ch: null, cur: null, tgt: null,
    raf: 0, last: 0, limitSec: 90
  };

  function startTrain(lv) {
    train.level = lv;
    var cfg = F.levelCfg(lv);
    train.ch = { species: cfg.species, style: cfg.style, seed: "lv" + lv };
    train.cur = F.animBase();
    train.tgt = F.animBase();
    train.sess = N.session.create({ level: cfg, breath: store.get().settings.breath });
    train.phase = "idle";
    $("btnTrainStart").textContent = "开始";
    $("stateBanner").textContent = "准备好了就点开始";
    $("stateBanner").className = "hud-state";
    $("roundPill").innerHTML = '注视 0.0s<span class="tgt">/ 目标 3s</span>';
    $("hitPill").textContent = "命中 —";
    $("holdBar").style.width = "0%";
    $("holdBar").classList.remove("over");
    $("breathBox").classList.remove("on");
    $("hudNote").textContent = "看它的眼睛，2～3 秒刚好";
    show("screenTrain");
    ensureCamera();
    startTrainLoop();
  }

  function ensureCamera() {
    if (N.track.state().status !== "idle") { updateCamLine(); return; }
    N.track.init($("cam"), function () { updateCamLine(); }).then(updateCamLine);
  }

  function updateCamLine() {
    var s = N.track.statusText();
    var el = $("camLine");
    el.textContent = s;
    el.className = "camline" + (N.track.state().status === "ready" ? "" : (N.track.isFallback() ? " warn" : ""));
    if (N.track.canHold()) {
      $("hudNote").textContent = "按住屏幕 = 注视，松开 = 移开";
    }
  }

  function startTrainLoop() {
    cancelAnimationFrame(train.raf);
    train.last = performance.now();
    var loop = function (now) {
      train.raf = requestAnimationFrame(loop);
      var dt = Math.min(0.05, Math.max(0.0005, (now - train.last) / 1000));
      train.last = now;

      var info = N.track.read(now);
      var tgt;

      if (train.phase === "run") {
        tgt = train.sess.feed(now, info);
        // 自动结束
        if (train.sess.autoEnd(now, train.limitSec)) { finishTrain(); return; }
      } else if (train.phase === "idle") {
        // 待机：轻轻飘一飘，让脸"活"着
        tgt = F.animBase();
        tgt.gazeX = Math.sin(now / 1600) * 0.22;
        tgt.gazeY = Math.sin(now / 2300) * 0.12;
        tgt.headRoll = Math.sin(now / 2600) * 0.06;
        tgt.lidOpen = 1;
      } else {
        tgt = F.animBase();
      }

      easeObj(train.cur, tgt, Math.min(1, dt * 11));
      var f = fitCanvas($("stage"));
      F.draw(f.ctx, f.w, f.h, train.ch, train.cur);

      if (train.phase === "run") updateHud(now, info);

      // 呼吸降档
      if (train.phase === "run") updateBreath(now);
    };
    train.raf = requestAnimationFrame(loop);
  }

  function updateHud(now, info) {
    var S = train.sess.state();
    var hold = S.holdStart ? (now - S.holdStart) / 1000 : 0;
    var sum = train.sess.summary();

    $("roundPill").innerHTML = "注视 " + hold.toFixed(1) + 's<span class="tgt">/ 目标 3s</span>';
    $("hitPill").textContent = "命中 " + Math.round(sum.hit * 100) + "%";

    var bar = $("holdBar");
    bar.style.width = Math.min(100, (hold / 4) * 100) + "%";
    bar.classList.toggle("over", hold > 4);

    var b = $("stateBanner");
    var map = {
      relax: ["对方看向别处 —— 看它的眼睛开始", ""],
      engage: ["它回看你了", ""],
      reward: ["就是这个节奏 · 稳住 2～3 秒", "good"],
      uncomfortable: ["它有点不适了 —— 现在自然移开", "warn"],
      avoid: ["它先移开了视线", "bad"]
    };
    var m = map[S.state] || ["", ""];
    if (b.textContent !== m[0]) b.textContent = m[0];
    b.className = "hud-state " + m[1];

    if (S.state === "reward") $("hudNote").textContent = "在 2～3 秒之间自然移开，比撑到 5 秒更好";
    else if (S.state === "uncomfortable") $("hudNote").textContent = "超过 4 秒，它已经不自在了 —— 要练的就是识别这个信号";
    else if (S.state === "avoid") $("hudNote").textContent = "现实中对方也会先躲开，这就是信号";
    else if (S.state === "relax") $("hudNote").textContent = N.track.canHold() ? "按住屏幕 = 注视，松开 = 移开" : "看它的眼睛，2～3 秒刚好";
  }

  function updateBreath(now) {
    var b = train.sess.breathTick(now);
    var box = $("breathBox");
    if (!b) { box.classList.remove("on"); return; }
    if (b.done) {
      train.sess.endBreath(now);
      box.classList.remove("on");
      toast("好，继续。慢慢来");
      return;
    }
    box.classList.add("on");
    $("breathTxt").textContent = b.phase;
    box.querySelector(".breath-ring").style.transform = "scale(" + b.scale.toFixed(2) + ")";
  }

  function stopTrain(finish) {
    cancelAnimationFrame(train.raf);
    train.raf = 0;
    if (train.phase === "run" && finish !== false) { /* 由 finishTrain 处理 */ }
    if (!finish) train.phase = "idle";
  }

  function finishTrain() {
    if (train.phase !== "run") return;
    train.phase = "done";
    cancelAnimationFrame(train.raf);
    var sum = train.sess.summary();
    store.recordSession(sum, train.level);
    renderResult(sum);
    show("screenResult");
  }

  function renderResult(sum) {
    $("resScore").textContent = sum.score;
    $("resTitle").textContent = "本轮稳视分（第 " + train.level + " 关）";
    $("resVerdict").innerHTML = "<b>" + sum.verdict.t + "</b><span>" + sum.verdict.s + "</span>";

    var items = [
      { u: sum.best.toFixed(1) + "s", s: "最长注视" },
      { u: sum.avg.toFixed(1) + "s", s: "平均轮次" },
      { u: Math.round(sum.hit * 100) + "%", s: "命中率" },
      { u: sum.rhythm, s: "节奏分" },
      { u: sum.rounds, s: "有效轮次" },
      { u: sum.darts, s: "游离次数" },
      { u: sum.over, s: "超时轮次" },
      { u: sum.blinks, s: "眨眼/分" }
    ];
    $("resMetrics").innerHTML = items.map(function (m) {
      return '<div class="m"><u>' + m.u + "</u><s>" + m.s + "</s></div>";
    }).join("");

    $("resAdvice").innerHTML = sum.advice.map(function (a) {
      return '<li class="' + (a.k || "") + '">' + a.t + "</li>";
    }).join("");

    var nextLv = store.get().unlocked;
    if (nextLv > train.level) toast("解锁第 " + nextLv + " 关！");
  }

  // ==================== 眼力游戏 ====================
  var quiz = { q: null, cur: null, tgt: null, raf: 0, phase: "idle", reveal: false, t0: 0 };

  function startQuiz() {
    quiz.q = N.quiz.create(10);
    quiz.cur = F.animBase();
    quiz.tgt = F.animBase();
    quiz.phase = "run";
    show("screenQuiz");
    renderQuestion();
    startQuizLoop();
  }

  function stopQuiz() {
    cancelAnimationFrame(quiz.raf);
    quiz.raf = 0;
    quiz.phase = "idle";
  }

  function startQuizLoop() {
    cancelAnimationFrame(quiz.raf);
    var last = performance.now();
    var loop = function (now) {
      quiz.raf = requestAnimationFrame(loop);
      var dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
      last = now;
      if (!quiz.q) return;
      var it = quiz.q.current();
      if (it && quiz.phase === "run") {
        var base = F.animBase();
        Object.keys(it.expr.anim).forEach(function (k) { base[k] = it.expr.anim[k]; });
        // 眨眼：按该表情的紧张度
        var gap = (it.expr.blinkMs || 3600) / 1000;
        var ph = (now / 1000) % gap;
        if (ph < 0.14) base.lidOpen = Math.min(base.lidOpen, 1 - Math.sin(Math.PI * (ph / 0.14)) * 0.95);
        quiz.tgt = base;
      }
      easeObj(quiz.cur, quiz.tgt, Math.min(1, dt * 6));
      var f = fitCanvas($("qStage"));
      F.draw(f.ctx, f.w, f.h, { species: "human", style: "real", seed: "quiz" + (quiz.q.index ? quiz.q.index() : 0) }, quiz.cur);
    };
    quiz.raf = requestAnimationFrame(loop);
  }

  function renderQuestion() {
    var q = quiz.q;
    if (q.finished()) return renderQuizSummary();

    var it = q.current();
    quiz.reveal = false;
    $("qTitle").textContent = "这双眼睛在想什么？";
    $("qFlag").textContent = "";
    $("qFlag").className = "q-flag";
    $("qIdx").textContent = (q.index() + 1) + " / " + q.total();
    $("qScore").textContent = q.score() + " 分";
    $("qBar").style.width = (q.index() / q.total() * 100) + "%";
    $("qExplain").className = "q-explain";
    $("qExplain").innerHTML = "";
    $("btnQuizNext").disabled = true;
    $("btnQuizNext").textContent = "下一题";

    $("qOpts").innerHTML = it.options.map(function (o) {
      return '<button class="opt" data-id="' + o.id + '">' + o.label + "</button>";
    }).join("");
    Array.prototype.forEach.call($("qOpts").querySelectorAll(".opt"), function (el) {
      el.addEventListener("click", function () { pickAnswer(el.getAttribute("data-id")); });
    });
  }

  function pickAnswer(id) {
    var q = quiz.q;
    var it = q.answer(id);
    if (!it) return;
    quiz.reveal = true;

    Array.prototype.forEach.call($("qOpts").querySelectorAll(".opt"), function (el) {
      var oid = el.getAttribute("data-id");
      if (oid === it.correctId) el.classList.add("right");
      else if (oid === id) el.classList.add("wrong");
      else el.classList.add("dim");
      el.disabled = true;
    });

    var right = it.ok;
    $("qFlag").textContent = right ? "对了" : "错了 · 正确答案是「" + it.expr.label + "」";
    $("qFlag").className = "q-flag " + (right ? "right" : "wrong");
    $("qScore").textContent = q.score() + " 分";
    $("qExplain").className = "q-explain on";
    $("qExplain").innerHTML = "<b>" + it.expr.label + "</b>（" + it.expr.tone + "）<br>" + it.expr.hint;

    var btn = $("btnQuizNext");
    btn.disabled = false;
    btn.textContent = (q.index() + 1 >= q.total()) ? "看结果" : "下一题";
  }

  function renderQuizSummary() {
    var q = quiz.q;
    var sc = q.score();
    var pct = q.percentile(sc);
    var r = q.rating(sc);
    /* 进度条走满 */
    $("qBar").style.width = "100%";
    $("qIdx").textContent = "已完成";
    $("qScore").textContent = sc + " 分";
    $("qFlag").textContent = "";
    $("qFlag").className = "q-flag";

    // 把该表情的画布换成"最容易被骗"的那一个（用最后一次的表情保持画面不空）
    $("qTitle").textContent = "眼力 " + sc + " 分 · " + r.t + " 级";
    $("qOpts").innerHTML =
      '<div class="metrics" style="grid-column:1/-1">' +
      '<div class="m"><u>' + q.count() + "/" + q.total() + "</u><s>答对</s></div>" +
      '<div class="m"><u>' + sc + "</u><s>眼力分</s></div>" +
      '<div class="m"><u>前 ' + (100 - pct) + "%</u><s>标准分位*</s></div>" +
      '<div class="m"><u>' + r.t + "</u><s>评级</s></div></div>";

    $("qExplain").className = "q-explain on";
    $("qExplain").innerHTML =
      "<b>" + r.s + "</b><br>" +
      "读眼测试测的是「读懂眼神里的情绪」。这套能力可以练：" +
      "先看眉毛（内侧往下压=不满，内侧往上抬=不安），再看眼睑开合，最后才看眼球方向。" +
      "<br><br>* 标准分位是按 10 题均值 5.2、标准差 1.8 的正态模型估算，不是真实人群抽样。" +
      "本机最好成绩：" + store.get().quiz.best + " 分。";

    $("btnQuizNext").disabled = false;
    $("btnQuizNext").textContent = "再来一轮";
  }

  // ==================== 动物挑战 ====================
  var ani = { id: "cat", running: false, t0: 0, acc: 0, curSec: 0, phase: "idle", cur: null, tgt: null, raf: 0, last: 0, held: false };

  function startAnimal() {
    ani.cur = F.animBase();
    ani.tgt = F.animBase();
    ani.phase = "idle";
    ani.acc = 0; ani.curSec = 0; ani.running = false;
    renderAnimalPicks();
    renderAnimalBest();
    $("aBanner").textContent = N.track.canHold() ? "按住屏幕盯住它的眼睛" : "盯住它的眼睛";
    ensureCamera();
    show("screenAnimal");
    startAnimalLoop();
  }

  function renderAnimalPicks() {
    $("aPicks").innerHTML = F.ANIMALS.map(function (a) {
      return '<button class="pick' + (a.id === ani.id ? " on" : "") + '" data-id="' + a.id + '">' +
        a.name + " · " + a.sub + "</button>";
    }).join("");
    Array.prototype.forEach.call($("aPicks").querySelectorAll(".pick"), function (el) {
      el.addEventListener("click", function () {
        ani.id = el.getAttribute("data-id");
        ani.acc = 0; ani.curSec = 0; ani.running = false;
        renderAnimalPicks(); renderAnimalBest();
        $("aBanner").textContent = "换成了" + F.animalCfg(ani.id).name + "，点开始挑战";
      });
    });
  }

  function renderAnimalBest() {
    var b = store.get().animal[ani.id] || 0;
    $("aBest").textContent = "最佳 " + (b ? b.toFixed(1) + "s" : "—");
    $("aTimer").textContent = ani.curSec.toFixed(1) + "s";
  }

  function bestAnimal() {
    var d = store.get().animal, best = null;
    F.ANIMALS.forEach(function (a) {
      if (d[a.id] && (!best || d[a.id] > best.sec)) best = { id: a.id, name: a.name, sec: d[a.id] };
    });
    return best;
  }

  function stopAnimal() {
    cancelAnimationFrame(ani.raf);
    ani.raf = 0;
    ani.phase = "idle";
    ani.running = false;
  }

  function startAnimalLoop() {
    cancelAnimationFrame(ani.raf);
    ani.last = performance.now();
    var loop = function (now) {
      ani.raf = requestAnimationFrame(loop);
      var dt = Math.min(0.05, Math.max(0.0005, (now - ani.last) / 1000));
      ani.last = now;

      var info = N.track.read(now);
      var looking = info.looking;

      if (ani.running && looking) {
        ani.acc += dt;
        ani.curSec = ani.acc;
        $("aTimer").textContent = ani.curSec.toFixed(1) + "s";
      }

      var cfg = F.animalCfg(ani.id);
      var t = ani.curSec;
      var T = F.animBase();
      // 掠食者：全程直视你，越久越压迫（缓慢逼近 + 瞳孔收缩 + 眉压）
      T.gazeX = Math.sin(now / 3400) * 0.05;
      T.gazeY = 0;
      T.lidOpen = 1 - Math.min(0.18, t * 0.012);
      T.lowerLid = Math.min(0.35, t * 0.02);
      T.pupil = 1 - Math.min(0.22, t * 0.014);
      T.browRaise = -Math.min(0.4, t * 0.03);
      T.browAngle = -Math.min(0.5, t * 0.035);
      T.headPitch = Math.min(0.12, t * 0.008);
      var gap = 5.2 - Math.min(3.0, t * 0.18);
      var ph = (now / 1000) % Math.max(1.4, gap);
      if (ph < 0.13) T.lidOpen = Math.min(T.lidOpen, 1 - Math.sin(Math.PI * (ph / 0.13)) * 0.95);

      ani.tgt = T;
      easeObj(ani.cur, ani.tgt, Math.min(1, dt * 8));
      var f = fitCanvas($("aStage"));
      var scale = cfg.scale * (1 + Math.min(0.14, t * 0.006));
      F.draw(f.ctx, f.w, f.h, { species: cfg.species, style: "real", seed: cfg.id, scale: scale }, ani.cur);
    };
    ani.raf = requestAnimationFrame(loop);
  }

  function animalStart() {
    ani.acc = 0; ani.curSec = 0; ani.running = true;
    $("aTimer").textContent = "0.0s";
    $("aBanner").textContent = "盯住它 —— 视线一离开就停表";
    $("btnAnimalStart").textContent = "结束";
  }

  function animalStop() {
    if (!ani.running) return;
    ani.running = false;
    $("btnAnimalStart").textContent = "开始挑战";
    var sec = ani.curSec;
    var prev = store.get().animal[ani.id] || 0;
    var isBest = sec > prev;
    if (sec > 0.5) {
      store.recordAnimal(ani.id, sec);
      renderAnimalBest();
      $("aBanner").textContent = (isBest ? "新纪录！" : "") + "坚持了 " + sec.toFixed(1) + " 秒";
      toast((isBest ? "新纪录 " : "") + sec.toFixed(1) + "s");
    } else {
      $("aBanner").textContent = "不到 0.5 秒，不计入";
    }
  }

  // ==================== 分享卡 ====================
  function shareCard(kind) {
    var W = 1080, H = 1350;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#141d33");
    g.addColorStop(0.55, "#0b1020");
    g.addColorStop(1, "#1a1226");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,178,107,.95)";
    ctx.font = "600 34px -apple-system,PingFang SC,Microsoft YaHei,sans-serif";
    ctx.fillText("对视 · 眼神节奏训练", W / 2, 108);

    if (kind === "animal") {
      var cfg = F.animalCfg(ani.id);
      var sec = store.get().animal[ani.id] || 0;
      F.draw(ctx, W, 760, { species: cfg.species, style: "real", seed: cfg.id, scale: 1.35 }, F.animBase(), { noClear: true, noBg: true });
      ctx.fillStyle = "#fff";
      ctx.font = "700 108px -apple-system,PingFang SC,sans-serif";
      ctx.fillText(sec.toFixed(1) + " 秒", W / 2, 950);
      ctx.fillStyle = "rgba(232,238,251,.72)";
      ctx.font = "500 40px -apple-system,PingFang SC,sans-serif";
      ctx.fillText("我和" + cfg.name + "对视了这么久", W / 2, 1016);
      ctx.fillStyle = "rgba(255,178,107,.9)";
      ctx.font = "600 38px -apple-system,PingFang SC,sans-serif";
      ctx.fillText("你能撑几秒？", W / 2, 1180);
    } else {
      var d = store.get(), t = store.day();
      F.draw(ctx, W, 700, { species: "human", style: "real", seed: "card", scale: 1.3 }, F.animBase(), { noClear: true, noBg: true });
      ctx.fillStyle = "#fff";
      ctx.font = "700 130px -apple-system,PingFang SC,sans-serif";
      ctx.fillText(String(t.score || 0), W / 2, 920);
      ctx.fillStyle = "rgba(232,238,251,.72)";
      ctx.font = "500 40px -apple-system,PingFang SC,sans-serif";
      ctx.fillText("今日稳视分", W / 2, 986);
      ctx.fillStyle = "rgba(232,238,251,.9)";
      ctx.font = "600 36px -apple-system,PingFang SC,sans-serif";
      ctx.fillText("最长注视 " + (t.best || 0).toFixed(1) + "s · 命中率 " + Math.round((t.hit || 0) * 100) + "%", W / 2, 1070);
      ctx.fillStyle = "rgba(255,178,107,.9)";
      ctx.font = "600 36px -apple-system,PingFang SC,sans-serif";
      ctx.fillText("对视超过 4 秒，其实谁都不舒服 —— 关键是节奏", W / 2, 1180);
    }

    ctx.fillStyle = "rgba(159,176,204,.5)";
    ctx.font = "400 26px -apple-system,PingFang SC,sans-serif";
    ctx.fillText("你的脸永远不出你的手机 · 全部计算在本机完成", W / 2, H - 62);

    var url = cv.toDataURL("image/png");
    download(url, "对视_" + kind + "_" + Date.now() + ".png");
    toast("分享卡已保存到下载目录");
  }

  // ==================== 事件绑定 ====================
  function bind() {
    // 规则弹层
    function openSheet(v) { $("sheetRule").classList.toggle("show", v); }
    $("btnRule").addEventListener("click", function () { openSheet(true); });
    $("btnToday").addEventListener("click", function () { openSheet(true); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (el) {
      el.addEventListener("click", function () { openSheet(false); });
    });

    $("goQuiz").addEventListener("click", startQuiz);
    $("goAnimal").addEventListener("click", function () { startAnimal(); });

    // 训练
    $("btnTrainExit").addEventListener("click", function () { stopTrain(false); show("screenHome"); renderHome(); });
    $("btnTrainStart").addEventListener("click", function () {
      if (train.phase === "idle") {
        train.phase = "run";
        train.sess.start(performance.now());
        $("btnTrainStart").textContent = "结束";
        $("stateBanner").textContent = "看它的眼睛";
        $("hudNote").textContent = "2～3 秒刚好，不要试着一路撑住";
        if (store.get().settings.camera === false) toast("已按设置关闭摄像头：按住屏幕 = 注视", 2400);
      } else if (train.phase === "run") {
        finishTrain();
      }
    });
    $("btnTrainShot").addEventListener("click", function () {
      var f = fitCanvas($("stage"));
      F.draw(f.ctx, f.w, f.h, train.ch, train.cur);
      download($("stage").toDataURL("image/png"), "对视_画面_" + Date.now() + ".png");
      toast("已保存当前画面");
    });

    // 复盘
    $("btnResHome").addEventListener("click", function () { show("screenHome"); renderHome(); });
    $("btnResAgain").addEventListener("click", function () { startTrain(train.level); });

    // 眼力
    $("btnQuizExit").addEventListener("click", function () { stopQuiz(); show("screenHome"); renderHome(); });
    $("btnQuizNext").addEventListener("click", function () {
      var q = quiz.q;
      if (q.finished()) { startQuiz(); return; }
      if (!quiz.reveal) { toast("先选一个答案"); return; }
      q.next();
      renderQuestion();
    });

    // 动物
    $("btnAnimalExit").addEventListener("click", function () { stopAnimal(); show("screenHome"); renderHome(); });
    $("btnAnimalStart").addEventListener("click", function () {
      if (ani.running) animalStop(); else animalStart();
    });
    $("btnAnimalShare").addEventListener("click", function () { shareCard("animal"); });

    // 无摄像头：按住 = 注视
    var stageWrap = document.querySelector("#screenTrain .stage-wrap");
    var aWrap = document.querySelector("#screenAnimal .stage-wrap");
    function hold(el) {
      el.addEventListener("pointerdown", function (e) {
        if (!N.track.canHold()) return;
        e.preventDefault(); N.track.setMock(true);
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
        el.addEventListener(ev, function () { N.track.setMock(false); });
      });
    }
    hold(stageWrap); hold(aWrap);
    window.addEventListener("keydown", function (e) { if (e.code === "Space") { N.track.setMock(true); e.preventDefault(); } });
    window.addEventListener("keyup", function (e) { if (e.code === "Space") { N.track.setMock(false); } });

    // 尺寸变化：重画
    window.addEventListener("resize", function () {
      if (curScreen === "screenHome") drawSpark($("spark"), store.last(14));
    });
    window.addEventListener("orientationchange", function () {
      setTimeout(function () { if (curScreen === "screenHome") drawSpark($("spark"), store.last(14)); }, 260);
    });

    // 首访自动弹一次 3 秒法则（这是产品的认知入口）
    if (!store.get().seen.rule) {
      store.markSeen("rule");
      setTimeout(function () { $("sheetRule").classList.add("show"); }, 420);
    }
  }

  // ==================== 启动 ====================
  function boot() {
    bind();
    renderHome();
    // 首页先预热摄像头状态文案（不主动开摄像头，避免一进来就弹权限）
    updateCamLine();

    // 静默预热模型：只下模型/WASM，不申请摄像头，所以不会弹权限框。
    // 线上冷缓存实测要 ~17 秒才 ready，把这 17 秒藏进用户看首页的时间里，
    // 等他点「开始」时摄像头基本已经就绪。慢网/省流量模式在 track.warm() 里会自动跳过。
    setTimeout(function () {
      try { N.track.warm(); } catch (_) {}
    }, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  N.app = { show: show, toast: toast, share: shareCard, train: train };
})(window.XTJY);
