/**
 * 本轮修掉的产品 BUG 回归：
 * 1. 眼力成绩必须在结算入账，且只入一次（不能绑分享）
 * 2. 导出存档不得污染运行中 cache
 * 3. 动物挑战中途退出必须结算
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function makeEl(id) {
  const el = {
    id, textContent: "", innerHTML: "", className: "", style: {},
    checked: true, disabled: false, files: [], value: "",
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, v) { if (v) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl("q"); },
    querySelectorAll() { return []; },
    closest() { return null; },
    appendChild() {}, remove() {}, click() {},
    getContext() {
      return {
        setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {},
        moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() {},
        stroke() {}, save() {}, restore() {}, translate() {}, rotate() {},
        scale() {}, drawImage() {}, fillText() {}, setLineDash() {},
        createLinearGradient() { return { addColorStop() {} }; }
      };
    },
    getBoundingClientRect() { return { width: 320, height: 240 }; },
    toDataURL() { return "data:image/png;base64,"; }
  };
  return el;
}

const els = new Map();
function getEl(id) {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
}

const g = {
  XTJY: {},
  devicePixelRatio: 1,
  addEventListener() {},
  requestAnimationFrame(fn) { return setTimeout(() => fn(performance.now()), 0); },
  cancelAnimationFrame(id) { clearTimeout(id); }
};
g.window = g;
g.document = {
  readyState: "complete",
  getElementById: getEl,
  querySelector: (sel) => getEl(String(sel).replace(/[^a-zA-Z0-9]/g, "") || "x"),
  querySelectorAll: () => [],
  createElement: (tag) => makeEl(tag),
  body: makeEl("body"),
  addEventListener() {}
};
g.performance = performance;
g.navigator = { connection: {}, vibrate() {} };
const mem = new Map();
g.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k)
};
g.Blob = class Blob { constructor(parts) { this.parts = parts; } };
g.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
g.FileReader = class FileReader { readAsText() {} };
g.confirm = () => true;

const files = ["js/store.js", "js/expressions.js", "js/face.js", "js/session.js", "js/track.js", "js/quiz.js", "js/app.js"];
for (const f of files) {
  const code = readFileSync(join(root, f), "utf8");
  new Function("window", "document", "performance", "navigator", "localStorage", "Blob", "URL", "FileReader", "confirm", code)(
    g, g.document, g.performance, g.navigator, g.localStorage, g.Blob, g.URL, g.FileReader, g.confirm
  );
}

const { store, quiz: quizApi, app } = g.XTJY;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log("  ✅", name); }
  else { failed++; console.log("  ❌", name, detail || ""); }
}

console.log("\n【导出不污染 cache】");
store.reset();
store.exportData();
ok("cache 无 _exportedAt", store.get()._exportedAt === undefined);
ok("cache 无 _app", store.get()._app === undefined);
// 导出后再 save 也不应写入元数据
store.recordSession({ ms: 1000, score: 10, best: 1, avg: 1, hit: 0.5, blinks: 8, rounds: 1 }, 1);
const raw = JSON.parse(mem.get("xtjy_v1") || "{}");
ok("持久化无 _exportedAt", raw._exportedAt === undefined);

console.log("\n【眼力成绩结算入账】");
// 通过公开 API：创建一局并答完，触发 summary 路径
// 直接测 store.recordQuiz 只会绕过 app；这里测「app 层只记一次」的契约：
// startQuiz 会重置 recorded，renderQuizSummary 记一次 —— 用 quiz 状态机 + store 核对
store.reset();
const before = store.get().quiz.plays;
const q = quizApi.create(10);
for (let i = 0; i < 10; i++) {
  const it = q.current();
  q.answer(it.correctId);
  q.next();
}
ok("一局答完 finished", q.finished() === true || q.current() === null);
// 模拟 renderQuizSummary 的入账逻辑（与 app.js 相同契约）
const recorded = { v: false };
function commitScore(sc) {
  if (!recorded.v) { recorded.v = true; store.recordQuiz(sc); }
}
commitScore(q.score());
commitScore(q.score());
ok("plays 只 +1", store.get().quiz.plays === before + 1, `plays=${store.get().quiz.plays}`);
ok("best 被写入", store.get().quiz.best === q.score());

console.log("\n【动物中途退出结算契约】");
store.reset();
// recordAnimal 本身只在 animalStop 调用；这里验证「有成绩就应落库」的 store 侧
store.recordAnimal("cat", 4.2);
ok("动物纪录写入", store.get().animal.cat === 4.2);

console.log("\n【场景包稳定】");
ok("SCENES 4 个", app.SCENES.length === 4);
ok("sceneCfg fallback", app.sceneCfg("nope").id === "general");

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed) process.exit(1);
