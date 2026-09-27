/* quiz.js — 眼力游戏（读懂眼神）
 *
 * 为什么它是"传播引擎"而不是主线的附庸：
 *   训练模块（稳视）是「输出」——涉及摄像头和隐私，天生不适合分享；
 *   眼力模块是「输入」——纯游戏、有分数、有排行榜、不碰隐私，可以随便晒。
 *   输出做留存，输入做传播。
 */
window.XTJY = window.XTJY || {};
(function (N) {
  "use strict";

  var PER_Q = 10;   // 每题 10 分

  function create(n) {
    n = n || 10;
    var questions = N.expressions.drawQuestions(n);
    var Q = {
      items: questions.map(function (e) {
        var o = N.expressions.optionsFor(e);
        return { expr: e, options: o.options, correctId: o.correctId, picked: null, ok: null };
      }),
      idx: 0,
      correct: 0,
      finished: false
    };

    function current() { return Q.finished ? null : Q.items[Q.idx]; }

    function answer(id) {
      var it = current();
      if (!it || it.picked) return null;
      it.picked = id;
      it.ok = id === it.correctId;
      if (it.ok) Q.correct += 1;
      return it;
    }

    function next() {
      if (Q.finished) return false;
      if (Q.idx + 1 >= Q.items.length) { Q.finished = true; return false; }
      Q.idx += 1;
      return true;
    }

    function score() { return Q.correct * PER_Q; }

    /** 标准分位（模型估算，不是真实人群统计——UI 上必须标注清楚） */
    function percentile(sc) {
      // 以 10 题为基准，均值 5.2、标准差 1.8 近似正态
      var mean = 5.2, sd = 1.8;
      var z = ((sc / PER_Q) - mean) / sd;
      var p = 0.5 * (1 + erf(z / Math.SQRT2));
      return Math.max(1, Math.min(99, Math.round(p * 100)));
    }

    function erf(x) {
      // Abramowitz-Stegun 7.1.26
      var s = x < 0 ? -1 : 1;
      x = Math.abs(x);
      var t = 1 / (1 + 0.3275911 * x);
      var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return s * y;
    }

    function rating(sc) {
      if (sc >= 90) return { t: "S", s: "读眼高手" };
      if (sc >= 70) return { t: "A", s: "比大多数人会看" };
      if (sc >= 50) return { t: "B", s: "平均水平之上一点" };
      if (sc >= 30) return { t: "C", s: "容易被礼貌性表情骗到" };
      return { t: "D", s: "先看眉毛，再看眼睑" };
    }

    return {
      current: current,
      answer: answer,
      next: next,
      finished: function () { return Q.finished; },
      progress: function () { return Q.idx / Q.items.length; },
      index: function () { return Q.idx; },
      total: function () { return Q.items.length; },
      count: function () { return Q.correct; },
      score: score,
      percentile: percentile,
      rating: rating,
      raw: function () { return Q; }
    };
  }

  N.quiz = { create: create, PER_Q: PER_Q };
})(window.XTJY);
