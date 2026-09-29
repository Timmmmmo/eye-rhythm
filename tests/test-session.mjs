/**
 * session.js 核心主张回归测试（Node 可直接跑：node tests/test-session.mjs）
 * 覆盖：满分窗 / 死盯惩罚 / 渐进扣分 / 互惠状态机 / 未结束轮次补计 / 轻量 HUD
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// session.js 是浏览器 IIFE，这里用最小 DOM/全局垫片加载
globalThis.window = globalThis;
window.XTJY = { face: { animBase: () => ({
  gazeX: 0, gazeY: 0, lidOpen: 1, lowerLid: 0,
  browRaise: 0, browAngle: 0, browAsym: 0, pupil: 1,
  headYaw: 0, headPitch: 0, headRoll: 0,
  mouth: 0, blush: 0, sweat: 0
}) }};

const code = readFileSync(join(root, "js/session.js"), "utf8");
// eslint-disable-next-line no-new-func
new Function(code)();

const session = window.XTJY.session;
let passed = 0, failed = 0;

function ok(name, cond, detail) {
  if (cond) { passed++; console.log("  ✅", name); }
  else { failed++; console.log("  ❌", name, detail || ""); }
}

function runScenario(label, steps) {
  // steps: [{ ms, looking }]
  const s = session.create({ level: { lv: 1, blink: true, drift: true, expr: true }, breath: false });
  let now = 1000;
  s.start(now);
  for (const st of steps) {
    const frames = Math.max(1, Math.round(st.ms / 16));
    for (let i = 0; i < frames; i++) {
      now += 16;
      s.feed(now, { looking: !!st.looking, faceSeen: true });
    }
  }
  return s.summary();
}

console.log("\n【核心主张】看 3 秒移开 > 一路盯着");
const ideal = runScenario("ideal", [
  { ms: 3000, looking: true }, { ms: 1000, looking: false },
  { ms: 3000, looking: true }, { ms: 1000, looking: false },
  { ms: 3000, looking: true }, { ms: 1000, looking: false }
]);
const stare = runScenario("stare", [{ ms: 60000, looking: true }]);
ok("ideal > stare", ideal.score > stare.score, `ideal=${ideal.score} stare=${stare.score}`);
ok("ideal 接近满分", ideal.score >= 85, `score=${ideal.score}`);
ok("stare 被压到 40 以下", stare.score <= 40, `score=${stare.score}`);
ok("stare 触发超时惩罚", stare.penalty >= 0.25, `penalty=${stare.penalty}`);
ok("stare 超时秒数显著", stare.overSec > 50, `overSec=${stare.overSec}`);

console.log("\n【渐进惩罚】每次多看一眼（5 秒）介于两者之间");
const longish = runScenario("longish", [
  { ms: 5000, looking: true }, { ms: 1000, looking: false },
  { ms: 5000, looking: true }, { ms: 1000, looking: false }
]);
ok("5s 轮次分数介于 ideal 与 stare 之间",
  longish.score > stare.score && longish.score < ideal.score,
  `longish=${longish.score}`);

console.log("\n【状态机】relax → engage → reward → uncomfortable → avoid");
{
  const s = session.create({ level: { lv: 6, blink: true, drift: true, expr: true }, breath: false });
  let now = 0;
  s.start(now);
  const hold = (sec) => {
    for (let i = 0; i < Math.round(sec * 60); i++) {
      now += 16;
      s.feed(now, { looking: true, faceSeen: true });
    }
    return s.hud().state;
  };
  ok("没看 = relax", s.hud().state === "relax" || s.state().state === "relax");
  hold(0.5);
  ok("刚看上 = engage", s.hud().state === "engage", s.hud().state);
  hold(1.2); // 累计 ~1.7s
  ok("0.8~4s = reward", s.hud().state === "reward", s.hud().state);
  hold(3.0); // 累计 ~4.7s
  ok(">4s = uncomfortable", s.hud().state === "uncomfortable", s.hud().state);
  hold(2.0); // 累计 ~6.7s
  ok(">6s = avoid", s.hud().state === "avoid", s.hud().state);
}

console.log("\n【统计正确性】未结束的注视轮次要补计");
{
  const s = session.create({ level: { lv: 1 }, breath: false });
  let now = 0;
  s.start(now);
  // 一路盯着直到结算，中间不松开
  for (let i = 0; i < Math.round(10 * 60); i++) {
    now += 16;
    s.feed(now, { looking: true, faceSeen: true });
  }
  const sum = s.summary();
  ok("死盯也算至少 1 轮", sum.rounds >= 1, `rounds=${sum.rounds}`);
  ok("最长注视接近 10s", sum.best > 8, `best=${sum.best}`);
  ok("超时秒数 > 5", sum.overSec > 5, `overSec=${sum.overSec}`);
}

console.log("\n【轻量 HUD】hud() 不应依赖 summary()");
{
  const s = session.create({ level: { lv: 1 }, breath: false });
  let now = 0;
  s.start(now);
  for (let i = 0; i < 30; i++) {
    now += 16;
    s.feed(now, { looking: true, faceSeen: true });
  }
  const h = s.hud();
  ok("hud 有 hold/state/hit", typeof h.hold === "number" && typeof h.state === "string" && typeof h.hit === "number");
  ok("hud 命中率为 1", h.hit > 0.99, `hit=${h.hit}`);
}

console.log("\n【零注视】整轮没看 → 0 分");
{
  const sum = runScenario("none", [{ ms: 20000, looking: false }]);
  ok("score=0", sum.score === 0, `score=${sum.score}`);
  ok("noData=true", sum.noData === true);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed) process.exit(1);
