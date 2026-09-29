/* session.js — 一轮训练的核心逻辑
 *
 * ▍这里落地的产品判断（整份方案里最重要的那一刀）
 *   目标不是「敢一直盯着」，是「会看」。
 *   人对视超过约 4 秒会生理性不适——这是普遍现象，不是病。
 *   所以计分**不奖励**「撑得久」：
 *     注视 2.2～3.8 秒 = 满分窗
 *     超过 4 秒 → 扣分，并且对方的神态真的会变得不适（把教学做进机制里）
 *
 * ▍互惠反馈状态机（让"对视"变成双向的，而不是盯一张图）
 *   relax        你没看它 → 它松弛、视线飘走（不给你压力，降低挫败）
 *   engage       你刚看上 → 它回看你
 *   reward       你稳视 0.8～4s → 它注视 + 微点头（正反馈，这是唯一被奖励的行为）
 *   uncomfortable 超过 4s → 皱眉/眨眼变快/后仰（它在不适，提示你该移开）
 *   avoid        不适持续 2s → 它先移开视线（现实里对方也会先躲）
 */
window.XTJY = window.XTJY || {};
(function (N) {
  "use strict";

  var F = N.face;

  // ---------- 阈值（全部可解释，不拍脑袋）----------
  var ENGAGE_AT = 0.8;     // 秒：进入"对方开始回看你"
  var REWARD_AT = 0.80;    // 秒
  var OVER_AT = 4.0;       // 秒：进入"对方不适"，提示你该移开
  var AVOID_AT = 6.0;      // 秒：对方主动先移开
  var MIN_ROUND = 0.25;    // 秒：低于此不算一轮注视，记为"游离"

  var IDEAL_LO = 2.2, IDEAL_HI = 3.8;

  function create(cfg) {
    cfg = cfg || {};
    var lv = cfg.level || { lv: 1, blink: false, drift: false, expr: false, full: false };
    var breathEnabled = cfg.breath !== false;

    var S = {
      level: lv,
      t0: 0,
      now: 0,
      totalMs: 0,
      lookingMs: 0,
      faceMissMs: 0,
      rounds: [],
      roundStart: 0,
      darts: 0,
      holdStart: 0,
      state: "relax",
      stateSince: 0,
      rewardRun: 0,
      mood: "neutral",
      blinkAt: 1.4,      // 秒：倒计时
      blinkPhase: -1,    // <0 = 不在眨眼中，0..1 = 眨眼进度
      blinkGap: 3.6,
      lastBlinkAt: 0,
      blinkMarks: [],
      driftSeed: Math.random() * 1000,
      breathOffered: false,
      breathDone: false,
      breathOn: false,
      breathSince: 0,
      breathPhase: 0,
      windowMarks: [],   // {t, looking, dart} 用于紧张检测
      events: []
    };

    var target = F.animBase();

    // ---------------- 对外接口 ----------------
    function start(now) {
      S.t0 = now; S.now = now;
      S.totalMs = 0; S.lookingMs = 0; S.faceMissMs = 0;
      S.rounds = []; S.darts = 0; S.blinkMarks = []; S.windowMarks = [];
      S.holdStart = 0; S.state = "relax"; S.stateSince = now;
      S.rewardRun = 0; S.nervous = false;
      S.breathOffered = false; S.breathDone = false; S.breathOn = false;
      S.blinkAt = 1.4;   // 秒：倒计时，不是绝对时间戳
      S.blinkPhase = -1;
    }

    /** 每个动画帧调用一次 */
    function feed(now, info) {
      info = info || {};
      if (!S.t0) start(now);
      var dt = Math.min(0.05, Math.max(0, (now - S.now) / 1000));
      S.now = now;
      S.totalMs += dt * 1000;

      var looking = !!info.looking;
      var seen = info.faceSeen !== false;
      if (!seen) S.faceMissMs += dt * 1000;

      // ---- 注视轮次统计 ----
      if (looking) {
        S.lookingMs += dt * 1000;
        if (S.holdStart === 0) {
          S.holdStart = now;
          S.state = "engage";
          S.rewardRun = 0;
        }
      } else {
        if (S.holdStart !== 0) {
          var dur = (now - S.holdStart) / 1000;
          S.holdStart = 0;
          if (dur >= MIN_ROUND) S.rounds.push({ dur: dur, over: dur > OVER_AT });
          else S.darts += 1;
        }
        if (S.state !== "relax") { S.state = "relax"; S.stateSince = now; }
      }

      var hold = S.holdStart ? (now - S.holdStart) / 1000 : 0;
      if (hold > 0) {
        if (hold >= AVOID_AT) {
          if (S.state !== "avoid") { S.state = "avoid"; S.stateSince = now; }
        } else if (hold >= OVER_AT) {
          if (S.state !== "uncomfortable") { S.state = "uncomfortable"; S.stateSince = now; }
        } else if (hold >= REWARD_AT) {
          if (S.state !== "reward") { S.state = "reward"; S.stateSince = now; S.rewardRun += 1; if (lv.expr) updateMood(); }
        } else {
          S.state = "engage";
        }
      }

      // ---- 滑动窗口（紧张检测）----
      S.windowMarks.push({ t: now, looking: looking });
      while (S.windowMarks.length && now - S.windowMarks[0].t > 9000) S.windowMarks.shift();
      maybeBreath(now);

      // ---- 眨眼 / 游移 / 目标神态 ----
      computeTarget(now, dt, looking, hold);
      return target;
    }

    function updateMood() {
      // lv5+ 才会"眼里的意思变化"
      if (S.state === "uncomfortable" || S.state === "avoid") S.mood = "cool";
      else if (S.rewardRun >= 3) S.mood = S.mood === "warm" ? "curious" : "warm";
      else if (S.rewardRun === 1) S.mood = "neutral";
    }

    function computeTarget(now, dt, looking, hold) {
      var t = now / 1000;
      var T = target;
      // 默认：中性
      T.browRaise = 0; T.browAngle = 0; T.browAsym = 0;
      T.lidOpen = 1; T.lowerLid = 0; T.pupil = 1;
      T.mouth = 0; T.blush = 0; T.sweat = 0;
      T.headRoll = 0; T.headPitch = 0; T.headYaw = 0;

      var gx = 0, gy = 0;

      if (S.state === "relax") {
        // 它自己看别处：缓慢漂 + 偶发扫视（只在 lv.drift 时幅度大）
        var amp = lv.drift ? 0.55 : 0.26;
        gx = Math.sin(t * 0.42 + S.driftSeed) * amp * 0.8;
        gy = Math.sin(t * 0.31 + S.driftSeed * 1.7) * amp * 0.5 + 0.06;
        T.browRaise = -0.05;
        T.headRoll = Math.sin(t * 0.5 + S.driftSeed) * 0.09;
        T.headYaw = gx * 0.30;
      } else if (S.state === "engage") {
        // 你刚看上，它回看
        gx = 0; gy = 0;
        T.browRaise = 0.14 + (lv.expr ? 0.06 : 0);
        T.lidOpen = 1.02;
        T.headPitch = -0.03;
        T.mouth = 0.08;
      } else if (S.state === "reward") {
        // 被奖励的区间：注视 + 微点头 + 柔和下眼睑（真笑的标志）
        gx = 0; gy = 0;
        var nod = Math.sin((hold - REWARD_AT) * 3.4) * Math.max(0, 1 - (hold - REWARD_AT) * 1.4);
        T.browRaise = 0.22;
        T.browAngle = 0.14;
        T.lidOpen = 0.94;
        T.lowerLid = 0.30 + Math.abs(nod) * 0.18;
        T.mouth = 0.34 + Math.abs(nod) * 0.2;
        T.headPitch = -0.02 + nod * 0.10;
        if (S.mood === "warm") { T.pupil = 1.02; T.mouth = 0.46; }
        if (S.mood === "curious") { T.browRaise = 0.42; T.pupil = 1.1; T.lidOpen = 1.0; }
      } else if (S.state === "uncomfortable") {
        // 它在不适：眉毛下压、眨眼变快、瞳孔缩、后仰、视线开始游走
        var k = Math.min(1, (hold - OVER_AT) / 1.4);
        gx = Math.sin(t * 1.9) * 0.30 * k;
        gy = 0.10 * k;
        T.browRaise = -0.22 * k;
        T.browAngle = -0.42 * k;
        T.lidOpen = 1 - 0.16 * k;
        T.lowerLid = 0.34 * k;
        T.pupil = 1 - 0.16 * k;
        T.mouth = -0.16 * k;
        T.headPitch = 0.13 * k;
        T.headRoll = Math.sin(t * 1.2) * 0.05 * k;
      } else if (S.state === "avoid") {
        // 它先移开视线
        gx = -0.72; gy = 0.34;
        T.browRaise = -0.06;
        T.browAngle = -0.2;
        T.lidOpen = 0.9;
        T.headYaw = -0.42;
        T.headPitch = 0.08;
        T.mouth = -0.1;
      }

      // ---- 眨眼 ----
      var wantBlink = lv.blink || S.state === "uncomfortable" || S.state === "avoid";
      if (S.state === "uncomfortable") S.blinkGap = 0.95;
      else if (S.state === "avoid") S.blinkGap = 1.15;
      else S.blinkGap = 3.6;

      if (wantBlink) {
        if (S.blinkPhase < 0) {
          S.blinkAt -= dt;
          if (S.blinkAt <= 0) { S.blinkPhase = 0; S.blinkAt = S.blinkGap * (0.65 + Math.random() * 0.75); S.blinkMarks.push(now); }
        } else {
          S.blinkPhase += dt / 0.14;
          if (S.blinkPhase >= 1) { S.blinkPhase = -1; }
        }
        if (S.blinkPhase >= 0) {
          var p = S.blinkPhase;
          T.lidOpen = Math.min(T.lidOpen, 1 - Math.sin(Math.PI * p) * 0.97);
        }
      }
      // 紧张时（不管关卡）也允许快眨眼，因为"眨眼频率是最好用的紧张指标"
      if (S.nervous && S.blinkPhase < 0 && wantBlink === false) {
        S.blinkAt -= dt * 2.2;
      }

      // 眼部微抖（写实档加一点生理性眼球漂移，避免"死盯着"的塑料感）
      if (lv.style !== "toon") {
        gx += Math.sin(t * 6.1 + S.driftSeed) * 0.012;
        gy += Math.sin(t * 5.3 + S.driftSeed * 2) * 0.010;
      }

      T.gazeX = gx;
      T.gazeY = gy;
    }

    // ---------------- 呼吸降档 ----------------
    function maybeBreath(now) {
      if (!breathEnabled || S.breathOffered || S.breathDone) return;
      if (now - S.t0 < 12000) return;
      var w = S.windowMarks;
      if (w.length < 30) return;
      var lookN = 0;
      for (var i = 0; i < w.length; i++) if (w[i].looking) lookN++;
      var hitRate = lookN / w.length;
      var dur = (w[w.length - 1].t - w[0].t) / 1000;
      var dartRate = S.darts / Math.max(1, (now - S.t0) / 1000);
      if (hitRate < 0.32 && dartRate > 0.55 && dur > 6) {
        S.nervous = true;
        S.breathOffered = true;
        S.breathOn = true;
        S.breathSince = now;
        S.breathPhase = 0;
        S.events.push({ type: "breath" });
      }
    }

    /** 呼吸结束，回到训练 */
    function endBreath(now) {
      S.breathOn = false;
      S.breathDone = true;
      S.holdStart = 0;
      S.state = "relax";
      S.stateSince = now;
    }

    /** 4-7-8 呼吸的当前提示：返回 {phase, scale} */
    function breathTick(now) {
      if (!S.breathOn) return null;
      var el = (now - S.breathSince) / 1000;
      var CYCLE = 19; // 4 吸 + 7 屏 + 8 呼
      var c = el % CYCLE;
      var phase, scale;
      if (c < 4) { phase = "吸气"; scale = 0.8 + (c / 4) * 0.5; }
      else if (c < 11) { phase = "屏住"; scale = 1.3; }
      else { var p = (c - 11) / 8; phase = "呼气"; scale = 1.3 - p * 0.5; }
      return { phase: phase, scale: scale, elapsed: el, done: el >= CYCLE };
    }

    // ---------------- 自动结束判定 ----------------
    function autoEnd(now, limitSec) {
      return limitSec && (now - S.t0) / 1000 >= limitSec;
    }

    /**
     * 每帧用的轻量指标（禁止在这里调 summary()）。
     * summary() 要扫全部轮次、拼建议文案，放在 rAF 里会白白烧 CPU。
     */
    function hud() {
      var hold = S.holdStart ? (S.now - S.holdStart) / 1000 : 0;
      return {
        hold: hold,
        state: S.state,
        hit: S.totalMs > 0 ? S.lookingMs / S.totalMs : 0,
        darts: S.darts,
        rounds: S.rounds.length,
        lookingMs: S.lookingMs,
        totalMs: S.totalMs,
        breathOn: !!S.breathOn,
        nervous: !!S.nervous
      };
    }

    // ---------------- 结算 ----------------
    function roundScore(d) {
      if (d < 0.25) return 0.30;
      if (d < 1.0) return lerp(0.45, 0.70, (d - 0.25) / 0.75);
      if (d < IDEAL_LO) return lerp(0.70, 0.97, (d - 1.0) / (IDEAL_LO - 1.0));
      if (d <= IDEAL_HI) return 1.0;
      if (d < 5.0) return lerp(1.0, 0.70, (d - IDEAL_HI) / (5.0 - IDEAL_HI));
      if (d < 6.0) return lerp(0.70, 0.50, (d - 5.0));
      if (d < 8.0) return lerp(0.50, 0.28, (d - 6.0) / 2);
      if (d < 12.0) return lerp(0.28, 0.12, (d - 8.0) / 4);
      return 0.12;
    }
    function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

    function summary() {
      var secs = S.totalMs / 1000;
      var lookingMs = S.lookingMs;
      var hitRate = S.totalMs > 0 ? S.lookingMs / S.totalMs : 0;

      // 关键：结算时把"还没结束的那一轮"补上。
      // 否则一路盯着不放的人在数据里会显示成「一次都没看」——统计上完全反了。
      var rounds = S.rounds.slice();
      if (S.holdStart) {
        var openDur = (S.now - S.holdStart) / 1000;
        if (openDur >= MIN_ROUND) rounds.push({ dur: openDur, over: openDur > OVER_AT, open: true });
      }

      var wsum = 0, rsum = 0, best = 0, tot = 0, overSec = 0;
      for (var i = 0; i < rounds.length; i++) {
        var r = rounds[i];
        best = Math.max(best, r.dur);
        tot += r.dur;
        overSec += Math.max(0, r.dur - OVER_AT);   // 只罚"超出舒适窗的那部分"
        wsum += roundScore(r.dur) * r.dur;
        rsum += r.dur;
      }
      var rhythm = rsum > 0 ? (wsum / rsum) * 100 : 0;
      var avgRound = rounds.length ? tot / rounds.length : 0;
      var hitScore = Math.min(1, hitRate / 0.65) * 100;

      // 超时惩罚：一次都不移开的人，命中率再高也不该拿高分
      // 注意单位：overSec 是秒，lookingMs 是毫秒——必须换算，否则惩罚恒为 0
      var lookSec = lookingMs / 1000;
      var overRatio = lookSec > 0.4 ? clamp01(overSec / lookSec * 1.6) : 0;
      var penalty = Math.min(0.6, overRatio);

      var base = 0;
      if (rounds.length > 0) base = hitScore * 0.45 + rhythm * 0.55;
      var score = Math.round(base * (1 - penalty));

      var blinkPerMin = secs > 3 ? (S.blinkMarks.length / secs) * 60 : 0;

      var out = {
        ms: Math.round(S.totalMs),
        secs: Math.round(secs),
        hit: hitRate,
        hitScore: Math.round(hitScore),
        rhythm: Math.round(rhythm),
        score: score,
        best: Math.round(best * 10) / 10,
        avg: Math.round(avgRound * 10) / 10,
        rounds: rounds.length,
        darts: S.darts,
        over: rounds.filter(function (r) { return r.over; }).length,
        overSec: Math.round(overSec * 10) / 10,
        penalty: penalty,
        blinks: Math.round(blinkPerMin),
        noData: rounds.length === 0,
        verdict: verdictFor(score)
      };
      out.advice = adviceFor(hitRate, best, avgRound, blinkPerMin, S, score, out);
      return out;
    }

    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    function verdictFor(sc) {
      if (sc >= 85) return { t: "出色", s: "节奏稳、眼神自然" };
      if (sc >= 70) return { t: "稳", s: "已经像正常人交流了" };
      if (sc >= 55) return { t: "入门", s: "有节奏了，还差一点" };
      if (sc > 0) return { t: "起步", s: "先把「看进去」做到" };
      return { t: "—", s: "这一轮没有有效注视" };
    }

    function adviceFor(hitRate, best, avg, blinkPerMin, S, score, sum) {
      var out = [];
      if (sum.rounds === 0) {
        if (S.darts > 5) {
          out.push({ k: "bad", t: "有 " + S.darts + " 次「碰一下就躲」，但每次都不足 0.25 秒，没有形成一次真正的注视。先别追求时长，瞄准 2 秒。" });
        } else {
          out.push({ k: "bad", t: "整轮没有一次有效注视（每次需 ≥0.25 秒）。只要「看进去」，一次两秒也行。" });
        }
        return out;
      }
      if (sum.penalty >= 0.25) {
        // 措辞要说清「超出的那部分」，否则和上面的「最长注视 5.9 秒」并列时会被读成「一共才盯了 1.9 秒」
        out.push({ k: "bad", t: "最长那次在 4 秒舒适窗之外多停了 " + sum.overSec.toFixed(1) + " 秒，超出了自然节奏，所以总分被扣掉 " + Math.round(sum.penalty * 100) + "%。这一轮的关键不是看得更久，是学会移开。" });
      }
      if (hitRate < 0.35) out.push({ k: "bad", t: "注视命中率只有 " + Math.round(hitRate * 100) + "%，视线大部分时间不在对方眼上。可以先降低难度，从卡通档把「看进去」练熟。" });
      if (best > 5.5 && sum.penalty < 0.25) out.push({ k: "bad", t: "最长一次撑到 " + best.toFixed(1) + " 秒——这已经越过对方的舒适区了。记住目标不是撑久，是 3 秒时自然移开。" });
      else if (best >= 2.2 && best <= 3.8) out.push({ k: "ok", t: "最长注视 " + best.toFixed(1) + " 秒，正好落在 2～3.8 秒的舒适窗里——这就是要的感觉。" });
      if (avg > 0 && avg < 1.0) out.push({ k: "bad", t: "平均每轮只有 " + avg.toFixed(1) + " 秒，看着像是在躲。试着每轮做到 2～3 秒。" });
      if (blinkPerMin > 26) out.push({ k: "bad", t: "眨眼 " + Math.round(blinkPerMin) + " 次/分（常态约 15～20）——这是紧张的信号。练前先做一次 4-7-8 呼吸。" });
      if (S.darts > 12) out.push({ k: "", t: "游离 " + S.darts + " 次，节奏被打散了。移开要「有意识地移开」，而不是「忍不住躲开」。" });
      if (!out.length) out.push({ k: "ok", t: "节奏和命中率都在好区间，维持这个感觉，逐级提升拟真度。" });
      return out.slice(0, 3);
    }

    return {
      state: function () { return S; },
      start: start,
      feed: feed,
      hud: hud,
      breathTick: breathTick,
      endBreath: endBreath,
      summary: summary,
      autoEnd: autoEnd,
      targets: function () { return target; },
      RULES: { ENGAGE_AT: ENGAGE_AT, REWARD_AT: REWARD_AT, OVER_AT: OVER_AT, AVOID_AT: AVOID_AT, IDEAL_LO: IDEAL_LO, IDEAL_HI: IDEAL_HI }
    };
  }

  N.session = { create: create };
})(window.XTJY);
