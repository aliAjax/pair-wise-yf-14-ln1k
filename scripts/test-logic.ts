// 核心逻辑测试：账本合并/冲突/幂等、失效重算、负载计算、旧数据迁移
import { makeUpsertEvent, makeDeleteEvent, mergeEvents, replay } from "../src/lib/ledger";
import { recomputeCue, cueStatus, cueLoad } from "../src/lib/compute";
import { migrateLegacyData } from "../src/lib/migrate";
import type { Cue, Fixture } from "../src/lib/types";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("  ✓", msg);
  } else {
    fail++;
    console.error("  ✗", msg);
  }
}

const author = "tester";
const ts = 1000;

// 1. 新增与重放
console.log("① 事件重放");
const ev1 = makeUpsertEvent("show", "s1", { name: "演出A", notes: "", channelLoads: {} }, null, author, "operator", "b1", ts);
let state = replay([ev1]);
assert(state.shows.s1?.name === "演出A", "新增演出重放正确");

// 2. 编辑后版本递增
const ev2 = makeUpsertEvent("show", "s1", { name: "演出A2" }, state.shows.s1, author, "operator", "b1", ts + 1);
state = replay([ev1, ev2]);
assert(state.shows.s1?.name === "演出A2" && state.shows.s1.version === 2, "编辑后版本 +1");

// 3. 同字段冲突：先到入库，后到列冲突
console.log("② 并发冲突");
const base = state.shows.s1;
const ev3 = makeUpsertEvent("show", "s1", { name: "先到版" }, base, "甲", "operator", "b2", ts + 2);
const ev4 = makeUpsertEvent("show", "s1", { name: "后到版" }, base, "乙", "operator", "b3", ts + 3);
const s3 = replay([ev1, ev2, ev3]);
const r1 = mergeEvents(s3, [ev4], new Set());
assert(r1.applied.length === 0 && r1.conflicts.length === 1, "同字段冲突：后到被列入冲突");
assert(s3.shows.s1.name === "先到版", "先到版本保留在库");
assert(r1.conflicts[0].fields.includes("演出名称"), "冲突字段名正确");

// 4. 不同字段干净合并
const ev5 = makeUpsertEvent("show", "s1", { notes: "新备注" }, base, "丙", "operator", "b4", ts + 4);
const s4 = replay([ev1, ev2, ev3]);
const r2 = mergeEvents(s4, [ev5], new Set());
assert(r2.applied.length === 1 && r2.conflicts.length === 0, "不同字段干净合并");
assert(s4.shows.s1.notes === "新备注" && s4.shows.s1.name === "先到版", "合并后两边改动都在");

// 5. 幂等：已合并事件不重复
console.log("③ 幂等重试");
const s5 = replay([ev1, ev2, ev3]);
const r3 = mergeEvents(s5, [ev3], new Set([ev3.id]));
assert(r3.skipped.length === 1 && r3.applied.length === 0, "已合并事件跳过不重复");
const r3b = mergeEvents(replay([ev1, ev2]), [ev3, ev3], new Set());
assert(r3b.applied.length === 1, "同一事件在批次内重复也只应用一次");

// 6. 删除冲突
const evDel = makeDeleteEvent("show", "s1", state.shows.s1, "丁", "operator", "b5", ts + 5);
const s8 = replay([ev1, ev2, ev3]);
const r4 = mergeEvents(s8, [evDel], new Set());
assert(r4.conflicts.length === 1, "实体被他人改过 -> 删除冲突");

// 7. 灯具 rev 变更 -> Cue 作废 -> 重算恢复
console.log("④ 失效重算");
const fx: Fixture = {
  id: "f1", showId: "s1", number: "L1", channel: 21, gel: "冷蓝", position: "台口",
  area: "面光", brightness: 80, ratedLoad: 1000, x: 50, y: 50, rev: 1,
  createdAt: ts, updatedAt: ts, version: 1,
};
const cue: Cue = {
  id: "c1", showId: "s1", number: 1, label: "开场", notes: "",
  states: [{ fixtureId: "f1", brightness: 80 }], revs: { f1: 1 },
  createdAt: ts, updatedAt: ts, version: 1,
};
assert(cueStatus(cue, { f1: fx }).invalid === false, "rev 未变 -> Cue 有效");
const fx2 = { ...fx, gel: "琥珀", rev: 2, updatedAt: ts + 1 };
const status = cueStatus(cue, { f1: fx2 });
assert(status.invalid && status.reasons.some((r) => r.includes("L1")), "色片变更 -> Cue 作废");
const recomputed = recomputeCue(cue, { f1: fx2 });
assert(cueStatus(recomputed, { f1: fx2 }).invalid === false, "重算后 Cue 恢复有效");
const fx3 = { ...fx, position: "台口右", rev: 2, updatedAt: ts + 1 };
assert(cueStatus(cue, { f1: fx3 }).invalid === true, "灯位变更 -> Cue 作废");
const fx4 = { ...fx, ratedLoad: 1200, rev: 2, updatedAt: ts + 1 };
assert(cueStatus(cue, { f1: fx4 }).invalid === true, "额定负载变更 -> Cue 作废");

// 8. 负载计算与过载
console.log("⑤ 通道负载");
const fA: Fixture = { ...fx, id: "fA", channel: 21, ratedLoad: 1000 };
const fB: Fixture = { ...fx, id: "fB", channel: 21, ratedLoad: 1000 };
const fC: Fixture = { ...fx, id: "fC", channel: 22, ratedLoad: 1000 };
const cue2: Cue = {
  ...cue, id: "c2",
  states: [
    { fixtureId: "fA", brightness: 100 },
    { fixtureId: "fB", brightness: 100 },
    { fixtureId: "fC", brightness: 50 },
  ],
};
const loads = cueLoad(cue2, { fA, fB, fC }, { 21: 1500, 22: 2000 });
const ch21 = loads.find((l) => l.channel === 21);
assert(ch21?.watts === 2000 && ch21.over === true, "CH21 过载：2000W > 1500W");
const ch22 = loads.find((l) => l.channel === 22);
assert(ch22?.watts === 500 && ch22.over === false, "CH22 正常：500W / 2000W");
const loadsNoRated = cueLoad(cue2, { fA, fB, fC }, {});
assert(loadsNoRated.every((l) => l.rated === null && l.over === false), "未设额定负载时不判过载");

// 9. 旧数据迁移
console.log("⑥ 旧数据迁移");
const legacy = {
  version: 0,
  savedAt: ts,
  shows: [{ name: "旧演出", notes: "旧备注" }],
  fixtures: [
    { number: "L1", channel: 21, gel: "冷蓝", position: "台口", brightness: 80, ratedLoad: 1000, area: "面光" },
    { number: "L2", channel: 22, position: "台口右", brightness: 60 }, // 缺色片/灯区/额定负载
  ],
  cues: [
    { number: 1, label: "开场", levels: { L1: 80 } },
    { number: 2, label: "过场" }, // 缺 states
  ],
  channelLoads: { 21: 2000 },
};
const { events: migEvents, missing } = migrateLegacyData(legacy);
const migState = replay(migEvents);
assert(Object.keys(migState.shows).length === 1, "迁移 1 场演出");
assert(Object.keys(migState.fixtures).length === 2, "迁移 2 台灯具");
assert(Object.keys(migState.cues).length === 2, "迁移 2 条 Cue");
const l2 = Object.values(migState.fixtures).find((f) => f.number === "L2");
assert(l2?.missingFields?.includes("ratedLoad"), "缺额定负载 -> 标记待补全");
assert(missing > 0, `共 ${missing} 个字段待补全`);
const l1 = Object.values(migState.fixtures).find((f) => f.number === "L1");
assert(l1?.channel === 21 && l1?.ratedLoad === 1000, "迁移灯具字段正确");
const c1 = Object.values(migState.cues).find((c) => c.number === 1);
const c2 = Object.values(migState.cues).find((c) => c.number === 2);
assert(c2?.missingFields?.includes("states"), "缺灯具状态 -> 标记待补全");
assert(c1?.states.length === 1 && c1.states[0].fixtureId === l1?.id, "Cue 按编号关联到灯具");

// 10. 迁移幂等：重放迁移事件两次不产生重复实体
const migState2 = replay([...migEvents, ...migEvents]);
assert(Object.keys(migState2.shows).length === 1 && Object.keys(migState2.fixtures).length === 2, "迁移事件重放不重复");

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
