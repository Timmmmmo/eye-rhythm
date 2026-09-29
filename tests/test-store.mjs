/**
 * store.js 数据完整性：加权平均、导出导入、stats
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

globalThis.window = globalThis;
window.XTJY = {};
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k)
};

new Function(readFileSync(join(root, "js/store.js"), "utf8"))();
const store = window.XTJY.store;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log("  ✅", name); }
  else { failed++; console.log("  ❌", name, detail || ""); }
}

console.log("\n【加权平均】");
store.reset();
// 3 轮：avg 1.0 / 3.0 / 5.0 → 真实平均 3.0
store.recordSession({ ms: 1000, score: 50, best: 1, avg: 1, hit: 0.5, blinks: 10, rounds: 1 }, 1);
store.recordSession({ ms: 1000, score: 60, best: 3, avg: 3, hit: 0.6, blinks: 12, rounds: 2 }, 1);
store.recordSession({ ms: 1000, score: 70, best: 5, avg: 5, hit: 0.8, blinks: 14, rounds: 3 }, 1);
const t = store.day();
ok("avg ≈ 3.0（不是 (0+1)/2 再 (1+3)/2 的伪平均）", Math.abs(t.avg - 3.0) < 0.15, `avg=${t.avg}`);
ok("sessions=3", t.sessions === 3);
ok("score 取当日最好", t.score === 70, `score=${t.score}`);
ok("hit 为加权平均", Math.abs(t.hit - (0.5 + 0.6 + 0.8) / 3) < 0.02, `hit=${t.hit}`);

console.log("\n【导出导入】");
const json = store.exportData();
ok("导出含 days", JSON.parse(json).days != null);
ok("导出带元数据字段", JSON.parse(json)._exportedAt != null);
ok("导出不污染运行时 cache", store.get()._exportedAt === undefined && store.get()._app === undefined);
store.reset();
ok("reset 后清空", store.day().sessions === 0);
store.importData(json);
ok("导入恢复 sessions", store.day().sessions === 3);
ok("导入恢复 score", store.day().score === 70);
ok("导入后 cache 无导出元数据", store.get()._exportedAt === undefined && store.get()._app === undefined);

console.log("\n【非法导入】");
let threw = false;
try { store.importData('{"foo":1}'); } catch (_) { threw = true; }
ok("缺 days 的 JSON 被拒绝", threw);
ok("拒绝后原数据仍在", store.day().sessions === 3);

console.log("\n【stats】");
const st = store.stats(14);
ok("trainedDays >= 1", st.trainedDays >= 1);
ok("totalSessions = 3", st.totalSessions === 3, `total=${st.totalSessions}`);

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed) process.exit(1);
