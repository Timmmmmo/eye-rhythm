/* store.js — 本地存档（localStorage）
   原则：数据全在本机。没有账号、没有服务端、没有上报。
   结构：
   {
     v: 1,
     days: { "2026-09-27": { score, best, avg, hit, blinks, rounds, sessions, minutes } },
     unlocked: 1,                      // 已解锁到第几级阶梯
     levelBest: { "1": 62, ... },
     quiz: { best: 0, plays: 0, last: 0 },
     animal: { cat: 4.2, wolf: 6.1, tiger: 3.4 },
     settings: { camera: true, breath: true },
     seen: { rule: false }
   }
*/
window.XTJY = window.XTJY || {};
(function (N) {
  "use strict";

  var KEY = "xtjy_v1";

  var EMPTY = {
    v: 1, days: {}, unlocked: 1, levelBest: {}, quiz: { best: 0, plays: 0, last: 0 },
    animal: {}, settings: { camera: true, breath: true }, seen: { rule: false }
  };

  var cache = null;

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (_) { raw = null; }
    var d = clone(EMPTY);
    if (raw) {
      try {
        var p = JSON.parse(raw);
        // 只增字段、深合并：旧存档缺字段不丢数据
        d = merge(d, p);
      } catch (_) {}
    }
    cache = d;
    return cache;
  }

  function merge(base, patch) {
    if (!patch || typeof patch !== "object") return base;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
        base[k] = merge(base[k], v);
      } else if (v !== undefined) {
        base[k] = v;
      }
    });
    return base;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (_) {}
  }

  function get() { return load(); }

  function day(k) {
    var d = load();
    k = k || todayKey();
    if (!d.days[k]) d.days[k] = { score: 0, best: 0, avg: 0, hit: 0, blinks: 0, rounds: 0, sessions: 0, minutes: 0 };
    return d.days[k];
  }

  /** 合并一轮训练结果到当天记录 */
  function recordSession(r, levelIdx) {
    var d = load();
    var t = day();
    t.sessions += 1;
    t.minutes = round1(t.minutes + (r.ms || 0) / 60000);
    // 当日稳视分取"历史最好一轮"，避免越练越低打击积极性
    t.score = Math.max(t.score, r.score);
    t.best = Math.max(t.best, r.best);
    // 用真实加权平均，而不是 (旧+新)/2 的伪平均（练 5 轮后旧数据权重会虚高）
    t.avg = round1((t.avg * (t.sessions - 1) + r.avg) / t.sessions);
    t.hit = round1(((t.hit || 0) * (t.sessions - 1) + r.hit) / t.sessions * 100) / 100;
    t.blinks = r.blinks;
    t.rounds += r.rounds;

    if (levelIdx) {
      d.levelBest[levelIdx] = Math.max(d.levelBest[levelIdx] || 0, r.score);
      // 解锁：本关 ≥ 60 分即解锁下一关
      if (r.score >= 60 && d.unlocked === levelIdx && d.unlocked < 6) d.unlocked = levelIdx + 1;
    }
    save();
    return t;
  }

  function streak() {
    var d = load(), n = 0, cur = new Date();
    for (var i = 0; i < 400; i++) {
      var k = cur.getFullYear() + "-" + pad(cur.getMonth() + 1) + "-" + pad(cur.getDate());
      if (d.days[k] && d.days[k].sessions > 0) { n++; cur.setDate(cur.getDate() - 1); }
      else break;
    }
    return n;
  }

  /** 最近 n 天的 [{key, score}]，从旧到新 */
  function last(n) {
    var d = load(), out = [], cur = new Date();
    cur.setDate(cur.getDate() - (n - 1));
    for (var i = 0; i < n; i++) {
      var k = cur.getFullYear() + "-" + pad(cur.getMonth() + 1) + "-" + pad(cur.getDate());
      out.push({ key: k, score: (d.days[k] && d.days[k].score) || 0, sessions: (d.days[k] && d.days[k].sessions) || 0 });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  function recordQuiz(score) {
    var d = load();
    d.quiz.plays += 1;
    d.quiz.last = score;
    d.quiz.best = Math.max(d.quiz.best, score);
    save();
    return d.quiz;
  }

  function recordAnimal(sp, sec) {
    var d = load();
    d.animal[sp] = Math.max(d.animal[sp] || 0, round1(sec));
    save();
    return d.animal[sp];
  }

  function setSetting(k, v) { var d = load(); d.settings[k] = v; save(); }
  function markSeen(k) { var d = load(); d.seen[k] = true; save(); }

  /** 导出存档（换机/备份）。只含分数与时长，不含任何画面/人脸数据。 */
  function exportData() {
    // 必须拷贝：不能把 _exportedAt/_app 写进运行中的 cache，否则会被 save() 持久化
    var d = clone(load());
    d._exportedAt = new Date().toISOString();
    d._app = "eye-rhythm";
    return JSON.stringify(d);
  }

  /** 导入存档。校验结构后深合并，导入失败不破坏现有数据。 */
  function importData(json) {
    var p = typeof json === "string" ? JSON.parse(json) : json;
    if (!p || typeof p !== "object" || typeof p.days !== "object") {
      throw new Error("invalid");
    }
    var next = merge(clone(EMPTY), p);
    delete next._exportedAt;
    delete next._app;
    cache = next;
    save();
    return cache;
  }

  /** 汇总：用于首页趋势与分享卡 */
  function stats(days) {
    days = days || 14;
    var series = last(days);
    var trained = 0, totalSessions = 0, maxScore = 0, sumScore = 0;
    for (var i = 0; i < series.length; i++) {
      if (series[i].sessions > 0) {
        trained++;
        totalSessions += series[i].sessions;
        maxScore = Math.max(maxScore, series[i].score);
        sumScore += series[i].score;
      }
    }
    return {
      days: series,
      trainedDays: trained,
      totalSessions: totalSessions,
      maxScore: maxScore,
      avgScore: trained ? Math.round(sumScore / trained) : 0,
      streak: streak()
    };
  }

  function reset() {
    cache = clone(EMPTY);
    try { localStorage.removeItem(KEY); } catch (_) {}
    save();
  }

  function round1(n) { return Math.round((n || 0) * 10) / 10; }

  N.store = {
    get: get, save: save, day: day, todayKey: todayKey, streak: streak, last: last,
    recordSession: recordSession, recordQuiz: recordQuiz, recordAnimal: recordAnimal,
    setSetting: setSetting, markSeen: markSeen, reset: reset, round1: round1,
    exportData: exportData, importData: importData, stats: stats
  };
})(window.XTJY);
