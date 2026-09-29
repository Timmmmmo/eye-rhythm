/**
 * 界面装配冒烟：用最小 DOM 桩加载全部脚本，确保 boot() 不抛错、
 * 关键导出齐全、store 往返正确。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function makeEl(id) {
  const el = {
    id,
    textContent: "",
    innerHTML: "",
    className: "",
    style: {},
    checked: true,
    disabled: false,
    files: [],
    value: "",
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, v) { if (v) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return makeEl("q"); },
    querySelectorAll() { return []; },
    closest() { return null; },
    appendChild() {},
    remove() {},
    click() {},
    getContext() {
      return {
        setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {},
        moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() {},
        stroke() {}, save() {}, restore() {}, translate() {}, rotate() {},
        scale() {}, drawImage() {}, fillText() {}, setLineDash() {},
        createLinearGradient() { return { addColorStop() {} }; }
      };
    },
    getBoundingClientRect() { return { width: 320, height: 240, top: 0, left: 0 }; },
    toDataURL() { return "data:image/png;base64,"; }
  };
  return el;
}

const els = new Map();
function getEl(id) {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
}

const listeners = [];
const documentStub = {
  readyState: "complete",
  getElementById: getEl,
  querySelector: (sel) => getEl(sel.replace(/[^a-zA-Z0-9]/g, "")),
  querySelectorAll: () => [],
  createElement: (tag) => makeEl(tag),
  body: makeEl("body"),
  addEventListener: (t, fn) => listeners.push([t, fn])
};

const windowStub = {
  XTJY: {},
  devicePixelRatio: 2,
  addEventListener() {},
  requestAnimationFrame(fn) { return setTimeout(() => fn(performance.now()), 16); },
  cancelAnimationFrame(id) { clearTimeout(id); },
  matchMedia() { return { matches: false, addEventListener() {} }; }
};

// 将脚本注入同一全局
const g = windowStub;
g.window = g;
g.document = documentStub;
g.performance = performance;
g.navigator = { connection: {}, vibrate() {} };
g.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
})();
g.Blob = class Blob { constructor(parts) { this.parts = parts; } };
g.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
g.FileReader = class FileReader {
  readAsText() {}
};
g.confirm = () => true;
g.import = async () => { throw new Error("no network"); };

const files = [
  "js/store.js",
  "js/expressions.js",
  "js/face.js",
  "js/session.js",
  "js/track.js",
  "js/quiz.js",
  "js/app.js"
];

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log("  ✅", name);
  else { failed++; console.log("  ❌", name, detail || ""); }
}

console.log("\n【加载脚本】");
for (const f of files) {
  const code = readFileSync(join(root, f), "utf8");
  try {
    const fn = new Function("window", "document", "performance", "navigator", "localStorage", "Blob", "URL", "FileReader", "confirm", code);
    fn(g, g.document, g.performance, g.navigator, g.localStorage, g.Blob, g.URL, g.FileReader, g.confirm);
    ok(f, true);
  } catch (e) {
    ok(f, false, e.message);
    console.error(e);
  }
}

console.log("\n【命名空间导出】");
const XTJY = g.XTJY;
ok("store", !!XTJY.store);
ok("expressions", !!XTJY.expressions);
ok("face", !!XTJY.face);
ok("session", !!XTJY.session);
ok("track", !!XTJY.track);
ok("quiz", !!XTJY.quiz);
ok("app", !!XTJY.app);
ok("session.hud", typeof XTJY.session.create(...[{}].map(()=> ({}))).hud === "function" || typeof XTJY.session.create({}).hud === "function");
ok("store.exportData", typeof XTJY.store.exportData === "function");
ok("store.importData", typeof XTJY.store.importData === "function");
ok("store.stats", typeof XTJY.store.stats === "function");

console.log("\n【存档往返】");
const exp = XTJY.store.exportData();
ok("导出是 JSON", exp[0] === "{");
XTJY.store.recordSession({ ms: 90000, score: 72, best: 3.1, avg: 2.4, hit: 0.7, blinks: 18, rounds: 9 }, 1);
const after = JSON.parse(XTJY.store.exportData());
ok("记录写入 days", Object.keys(after.days || {}).length >= 1);
XTJY.store.reset();
XTJY.store.importData(exp);
ok("导入后有 settings", !!XTJY.store.get().settings);
ok("导入不带 _app 字段到运行时", XTJY.store.get()._app === undefined);

console.log("\n【眼力题库】");
const qs = XTJY.expressions.drawQuestions(10);
ok("抽满 10 题", qs.length === 10);
const opt = XTJY.expressions.optionsFor(qs[0]);
ok("4 选项且含正确", opt.options.length === 4 && opt.options.some(o => o.id === opt.correctId));

console.log("\n【关卡配置】");
ok("6 级阶梯", XTJY.face.LEVELS.length === 6);
ok("3 种动物", XTJY.face.ANIMALS.length === 3);
ok("animBase 字段齐全", "gazeX" in XTJY.face.animBase() && "lidOpen" in XTJY.face.animBase());

console.log("\n【场景包】");
ok("SCENES 暴露", Array.isArray(XTJY.app.SCENES) && XTJY.app.SCENES.length >= 3);
ok("sceneCfg 可用", typeof XTJY.app.sceneCfg("interview").name === "string");

console.log(`\n结果：${failed ? "有 " + failed + " 处失败" : "全部通过"}`);
if (failed) process.exit(1);
