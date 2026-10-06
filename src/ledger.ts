import type {
  Channel,
  Changeset,
  Cue,
  DB,
  FieldConflict,
  Fixture,
  LogEntry,
  Op,
  Publication,
  Show,
  WorkingCopy,
} from "./types";

export const STORAGE_KEY = "lighting-console-ledger-v1";

export function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_LOGS = 80;

export function addLog(db: DB, text: string): void {
  const entry: LogEntry = { id: uid("log"), at: Date.now(), text };
  db.logs = [entry, ...db.logs].slice(0, MAX_LOGS);
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed && parsed.schemaVersion === 1) {
        if (typeof parsed.csSeq !== "number") parsed.csSeq = parsed.changesets.length;
        return parsed;
      }
    }
  } catch {
    // 损坏数据不阻断使用，落到迁移重建
  }
  return {
    schemaVersion: 1,
    migrated: false,
    migrationDismissed: false,
    migrationSummary: null,
    shows: [],
    channels: [],
    fixtures: [],
    cues: [],
    copies: [],
    changesets: [],
    publications: [],
    mergedOpKeys: [],
    csSeq: 0,
    logs: [],
  };
}

export function saveDB(db: DB): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

/* ---------------- 派生查询 ---------------- */

export function channelsOf(db: DB, showId: string): Channel[] {
  return db.channels.filter((c) => c.showId === showId).sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }));
}

export function fixturesOf(db: DB, showId: string): Fixture[] {
  return db.fixtures.filter((f) => f.showId === showId);
}

export function cuesOf(db: DB, showId: string): Cue[] {
  return db.cues.filter((c) => c.showId === showId).sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }));
}

/** 每个 Cue 的通道占用：channelNo -> 该 Cue 下通道被占用的负载(W) */
export function cueChannelLoad(cue: Cue, fixtures: Fixture[]): Record<string, number> {
  const load: Record<string, number> = {};
  for (const id of cue.fixtureIds) {
    const fx = fixtures.find((f) => f.id === id);
    if (!fx || !fx.channelNo) continue;
    const w = ((fx.power ?? 0) * (fx.brightness ?? 0)) / 100;
    load[fx.channelNo] = (load[fx.channelNo] ?? 0) + w;
  }
  return load;
}

export interface ChannelLoadLine {
  channel: Channel;
  used: number;
  rated: number | null;
  /** 该通道被哪些 Cue 占用，及对应负载 */
  byCue: { cueId: string; cueName: string; used: number }[];
}

/** 整场各通道的最大占用（跨 Cue 取峰值），用于额定负载校核 */
export function channelLoadTable(showId: string, db: DB): ChannelLoadLine[] {
  const channels = channelsOf(db, showId);
  const fxs = fixturesOf(db, showId);
  const cues = cuesOf(db, showId);
  return channels.map((ch) => {
    const byCue: ChannelLoadLine["byCue"] = [];
    let peak = 0;
    for (const cue of cues) {
      if (cue.dirty) continue; // 作废中的 Cue 不计入占用校核
      const load = cueChannelLoad(cue, fxs)[ch.no] ?? 0;
      if (load > 0) byCue.push({ cueId: cue.id, cueName: `Cue ${cue.no} ${cue.name}`, used: Math.round(load) });
      peak = Math.max(peak, load);
    }
    return { channel: ch, used: Math.round(peak), rated: ch.ratedLoad, byCue };
  });
}

/* ---------------- 灯位/色片变更 → 关联 Cue 作废 ---------------- */

/** 找出引用指定灯具的 Cue */
export function relatedCues(db: DB, showId: string, fixtureId: string): Cue[] {
  return cuesOf(db, showId).filter((c) => c.fixtureIds.includes(fixtureId));
}

/** 灯具的灯位或色片变化时，关联 Cue 的触发顺序与负载占用全部作废 */
export function invalidateRelatedCues(db: DB, showId: string, fixtureId: string): string[] {
  const names: string[] = [];
  for (const cue of relatedCues(db, showId, fixtureId)) {
    if (!cue.dirty) {
      cue.dirty = true;
      cue.updatedAt = Date.now();
      names.push(`Cue ${cue.no}`);
    }
  }
  return names;
}

/* ---------------- 重算触发顺序与负载占用 ---------------- */

/**
 * 重算：按 Cue 号顺序重排触发序号；负载占用本身由灯具功率/亮度派生，
 * 重算后清掉 dirty，通道占用表（channelLoadTable）随之恢复计入。
 */
export function recomputeCues(db: DB, showId: string): number {
  const cues = cuesOf(db, showId);
  cues
    .sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }) || a.updatedAt - b.updatedAt)
    .forEach((cue, i) => {
      cue.trigger = i + 1;
      cue.dirty = false;
    });
  return cues.length;
}

/* ---------------- 主控台账直接编辑（操作员） ---------------- */

function bumpShow(db: DB, showId: string): Show | undefined {
  const show = db.shows.find((s) => s.id === showId);
  if (show) show.rev += 1;
  return show;
}

export function saveShow(db: DB, show: Show): void {
  const i = db.shows.findIndex((s) => s.id === show.id);
  if (i >= 0) db.shows[i] = show;
  else db.shows.push(show);
}

export function saveChannel(db: DB, ch: Channel): void {
  const i = db.channels.findIndex((c) => c.id === ch.id);
  if (i >= 0) db.channels[i] = ch;
  else db.channels.push(ch);
}

export function deleteChannel(db: DB, showId: string, id: string): void {
  db.channels = db.channels.filter((c) => c.id !== id);
  bumpShow(db, showId);
}

/** upsert 灯具；返回因灯位/色片变更而作废的 Cue 名称 */
export function saveFixture(db: DB, fx: Fixture): string[] {
  const old = db.fixtures.find((f) => f.id === fx.id);
  const i = db.fixtures.findIndex((f) => f.id === fx.id);
  if (i >= 0) db.fixtures[i] = fx;
  else db.fixtures.push(fx);
  if (fx.channelNo && !db.channels.some((c) => c.showId === fx.showId && c.no === fx.channelNo)) {
    const ch: Channel = { id: uid("ch"), showId: fx.showId, no: fx.channelNo, ratedLoad: null };
    db.channels.push(ch);
    addLog(db, `通道 CH ${ch.no} 随灯具 ${fx.code} 建档，额定负载待补全`);
  }
  let invalidated: string[] = [];
  if (old) {
    const moved = old.x !== fx.x || old.y !== fx.y;
    const gelChanged = old.gel !== fx.gel;
    if (moved || gelChanged) {
      invalidated = invalidateRelatedCues(db, fx.showId, fx.id);
      const reason = moved && gelChanged ? "灯位、色片" : moved ? "灯位" : "色片";
      if (invalidated.length) addLog(db, `灯具 ${fx.code} ${reason}变更，${invalidated.join("、")} 触发顺序与负载占用作废`);
    }
  }
  bumpShow(db, fx.showId);
  return invalidated;
}

export function deleteFixture(db: DB, showId: string, id: string): void {
  db.fixtures = db.fixtures.filter((f) => f.id !== id);
  for (const cue of db.cues.filter((c) => c.showId === showId)) {
    if (cue.fixtureIds.includes(id)) {
      cue.fixtureIds = cue.fixtureIds.filter((x) => x !== id);
      cue.dirty = true;
    }
  }
  bumpShow(db, showId);
}

export function saveCue(db: DB, cue: Cue): void {
  const i = db.cues.findIndex((c) => c.id === cue.id);
  if (i >= 0) db.cues[i] = cue;
  else {
    cue.trigger = cuesOf(db, cue.showId).length + 1;
    db.cues.push(cue);
  }
  bumpShow(db, cue.showId);
}

export function deleteCue(db: DB, showId: string, id: string): void {
  db.cues = db.cues.filter((c) => c.id !== id);
  bumpShow(db, showId);
}

/* ---------------- 控台副本编辑（不改主账） ---------------- */

export function saveCopyFixture(copy: WorkingCopy, fx: Fixture): string[] {
  const old = copy.fixtures.find((f) => f.id === fx.id);
  const i = copy.fixtures.findIndex((f) => f.id === fx.id);
  if (i >= 0) copy.fixtures[i] = fx;
  else copy.fixtures.push(fx);
  let invalidated: string[] = [];
  if (old && (old.x !== fx.x || old.y !== fx.y || old.gel !== fx.gel)) {
    invalidated = copy.cues.filter((c) => c.fixtureIds.includes(fx.id)).map((c) => {
      c.dirty = true;
      return `Cue ${c.no}`;
    });
  }
  return invalidated;
}

export function recomputeCopyCues(copy: WorkingCopy): number {
  copy.cues
    .sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }) || a.updatedAt - b.updatedAt)
    .forEach((cue, i) => {
      cue.trigger = i + 1;
      cue.dirty = false;
    });
  return copy.cues.length;
}

/* ---------------- 三方合并：先到入库，晚到列冲突 ---------------- */

type AnyEntity = Show | Channel | Fixture | Cue;

function recAll(e: unknown): Record<string, unknown> {
  return e as unknown as Record<string, unknown>;
}

function getEntity(db: DB, type: FieldConflict["entityType"], id: string): AnyEntity | undefined {
  switch (type) {
    case "show":
      return db.shows.find((x) => x.id === id);
    case "channel":
      return db.channels.find((x) => x.id === id);
    case "fixture":
      return db.fixtures.find((x) => x.id === id);
    case "cue":
      return db.cues.find((x) => x.id === id);
  }
}

function entitiesForOp(db: DB, op: Op): { type: FieldConflict["entityType"]; id: string } {
  switch (op.kind) {
    case "upsertShow":
      return { type: "show", id: op.entity.id };
    case "upsertChannel":
      return { type: "channel", id: op.entity.id };
    case "upsertFixture":
      return { type: "fixture", id: op.entity.id };
    case "upsertCue":
      return { type: "cue", id: op.entity.id };
    case "deleteChannel":
      return { type: "channel", id: op.id };
    case "deleteFixture":
      return { type: "fixture", id: op.id };
    case "deleteCue":
      return { type: "cue", id: op.id };
  }
}

const FIELD_LABELS: Record<string, string> = {
  name: "名称",
  note: "备注",
  code: "灯具编号",
  channelNo: "通道号",
  type: "灯位类型",
  gel: "色片",
  x: "舞台X",
  y: "舞台Y",
  focus: "焦点位置",
  brightness: "亮度预设",
  power: "功率",
  no: "编号",
  ratedLoad: "额定负载",
  fixtureIds: "点亮灯具",
  trigger: "触发顺序",
};

const SKIP_FIELDS = new Set(["id", "showId", "updatedAt", "rev", "publishedRev", "createdAt", "dirty"]);

function diffFields(a: AnyEntity, b: AnyEntity): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out: string[] = [];
  for (const k of keys) {
    if (SKIP_FIELDS.has(k)) continue;
    const va = JSON.stringify(recAll(a)?.[k] ?? null);
    const vb = JSON.stringify(recAll(b)?.[k] ?? null);
    if (va !== vb) out.push(k);
  }
  return out;
}

function findBase<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((x) => x.id === id);
}

function putFixtureSilent(db: DB, fx: Fixture): void {
  const old = db.fixtures.find((f) => f.id === fx.id);
  const i = db.fixtures.findIndex((f) => f.id === fx.id);
  if (i >= 0) db.fixtures[i] = fx;
  else db.fixtures.push(fx);
  if (fx.channelNo && !db.channels.some((c) => c.showId === fx.showId && c.no === fx.channelNo)) {
    db.channels.push({ id: uid("ch"), showId: fx.showId, no: fx.channelNo, ratedLoad: null });
  }
  if (old && (old.x !== fx.x || old.y !== fx.y || old.gel !== fx.gel)) {
    invalidateRelatedCues(db, fx.showId, fx.id);
  }
}

/** 合并路径：静默应用操作，不逐操作 bump rev（由合并统一 +1） */
function applyOp(db: DB, op: Op): void {
  switch (op.kind) {
    case "upsertShow": {
      const cur = db.shows.find((s) => s.id === op.entity.id);
      const merged: Show = { ...op.entity, rev: cur ? cur.rev : op.entity.rev, publishedRev: cur ? cur.publishedRev : op.entity.publishedRev };
      saveShow(db, merged);
      break;
    }
    case "upsertChannel":
      saveChannel(db, op.entity);
      break;
    case "upsertFixture":
      putFixtureSilent(db, op.entity);
      break;
    case "upsertCue": {
      const i = db.cues.findIndex((c) => c.id === op.entity.id);
      if (i >= 0) db.cues[i] = op.entity;
      else db.cues.push(op.entity);
      break;
    }
    case "deleteChannel":
      db.channels = db.channels.filter((c) => !(c.id === op.id && c.showId === op.showId));
      break;
    case "deleteFixture":
      db.fixtures = db.fixtures.filter((f) => !(f.id === op.id && f.showId === op.showId));
      for (const cue of db.cues.filter((c) => c.showId === op.showId)) {
        if (cue.fixtureIds.includes(op.id)) {
          cue.fixtureIds = cue.fixtureIds.filter((x) => x !== op.id);
          cue.dirty = true;
        }
      }
      break;
    case "deleteCue":
      db.cues = db.cues.filter((c) => !(c.id === op.id && c.showId === op.showId));
      break;
  }
}

export interface MergeResult {
  status: Changeset["status"];
  conflicts: FieldConflict[];
  appliedCount: number;
  skippedCount: number;
  mergedRev?: number;
}

/**
 * 合并一份变更单到主控台账。
 * - 已合并的幂等操作直接跳过（断网重试不重复）
 * - baseRev 与主账一致：先到入库
 * - 版本落后：逐操作三方比对，有冲突的列出交主控台操作员，无冲突操作仍可先入库
 */
export function mergeChangeset(db: DB, cs: Changeset): MergeResult {
  const show = db.shows.find((s) => s.id === cs.showId);
  const conflicts: FieldConflict[] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  const pending: Op[] = [];
  for (const op of cs.ops) {
    if (db.mergedOpKeys.includes(op.opId)) {
      skippedCount += 1;
      continue;
    }
    pending.push(op);
  }

  // 落后版本：逐操作三方比对，标出冲突实体
  const conflictingKeys = new Set<string>();
  if (show && cs.baseRev !== show.rev) {
    for (const op of pending) {
      const { type, id } = entitiesForOp(db, op);
      const opKey = `${type}:${id}`;
      const master = getEntity(db, type, id);
      const base = findBaseEntity(cs, type, id);
      if (op.kind.startsWith("delete")) {
        if (base && master) {
          const changed = diffFields(base, master);
          if (changed.length) {
            conflicts.push({
              entityType: type,
              entityId: id,
              label: entityLabel(type, master),
              field: "_delete",
              base: "存在",
              master: `主账已修改（${changed.map((f) => FIELD_LABELS[f] ?? f).join("、")}）`,
              incoming: "删除",
              resolved: null,
            });
            conflictingKeys.add(opKey);
          }
        }
        continue;
      }
      const incoming = (op as { entity: AnyEntity }).entity;
      if (base && master) {
        for (const field of diffFields(base, incoming)) {
          const masterChanged = diffFields(base, master).includes(field);
          const mVal = recAll(master)[field];
          const inc = recAll(incoming)[field];
          const sameEdit = JSON.stringify(mVal ?? null) === JSON.stringify(inc ?? null);
          if (masterChanged && !sameEdit) {
            conflicts.push({
              entityType: type,
              entityId: id,
              label: entityLabel(type, incoming),
              field,
              base: fmt(recAll(base)[field]),
              master: fmt(mVal),
              incoming: fmt(inc),
              resolved: null,
            });
            conflictingKeys.add(opKey);
          }
        }
      }
    }
  }

  // 无冲突的操作先入库；冲突实体保留给主控台操作员裁决
  for (const op of pending) {
    const { type, id } = entitiesForOp(db, op);
    const opKey = `${type}:${id}`;
    if (conflictingKeys.has(opKey)) continue;
    if (op.kind.startsWith("delete")) {
      const master = getEntity(db, type, id);
      if (!master && !findBaseEntity(cs, type, id)) {
        skippedCount += 1;
        continue;
      }
    }
    applyOp(db, op);
    db.mergedOpKeys.push(op.opId);
    appliedCount += 1;
  }

  if (conflicts.length === 0) {
    if (show && appliedCount > 0) {
      show.rev += 1;
      recomputeCues(db, show.id);
    }
    const result: MergeResult = { status: "merged", conflicts: [], appliedCount, skippedCount, mergedRev: show?.rev };
    cs.status = "merged";
    cs.conflicts = [];
    cs.appliedCount = appliedCount;
    cs.skippedCount = skippedCount;
    cs.mergedRev = result.mergedRev;
    return result;
  }

  if (show && appliedCount > 0) {
    show.rev += 1;
    addLog(db, `「${cs.copyLabel}」部分入库 ${appliedCount} 项，${conflicts.length} 个字段冲突待裁决`);
  }
  const result: MergeResult = { status: "conflict", conflicts, appliedCount, skippedCount };
  cs.status = "conflict";
  cs.conflicts = conflicts;
  cs.appliedCount = appliedCount;
  cs.skippedCount = skippedCount;
  return result;
}

function findBaseEntity(cs: Changeset, type: FieldConflict["entityType"], id: string): AnyEntity | undefined {
  const pool: AnyEntity[] =
    type === "show" ? cs.baseSnapshot.shows : type === "channel" ? cs.baseSnapshot.channels : type === "fixture" ? cs.baseSnapshot.fixtures : cs.baseSnapshot.cues;
  return pool.find((x) => x.id === id);
}

function entityLabel(type: FieldConflict["entityType"], e: AnyEntity): string {
  switch (type) {
    case "show":
      return (e as Show).name;
    case "channel":
      return `CH ${(e as Channel).no}`;
    case "fixture":
      return (e as Fixture).code;
    case "cue":
      return `Cue ${(e as Cue).no} ${(e as Cue).name}`;
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "（空）";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/* ---------------- 冲突裁决后按方向重放 ---------------- */

/** 操作员对冲突逐条裁决后，按裁决方向把变更单剩余操作入库 */
export function resolveAndMerge(db: DB, cs: Changeset, decisions: Record<string, "master" | "incoming">): void {
  const show = db.shows.find((s) => s.id === cs.showId);
  for (const c of cs.conflicts) {
    const decision = decisions[`${c.entityType}:${c.entityId}:${c.field}`] ?? null;
    c.resolved = decision;
  }
  // 仍有未裁决项则保持冲突
  if (cs.conflicts.some((c) => c.resolved === null)) {
    cs.status = "conflict";
    return;
  }

  let applied = 0;
  let skipped = cs.skippedCount;
  const conflictKeys = new Set(cs.conflicts.map((c) => `${c.entityType}:${c.entityId}`));
  for (const op of cs.ops) {
    if (db.mergedOpKeys.includes(op.opId)) {
      skipped += 1;
      continue;
    }
    const { type, id } = entitiesForOp(db, op);
    if (!conflictKeys.has(`${type}:${id}`)) {
      // 合并阶段已处理过（理论上已带 opKey），这里防御性跳过
      skipped += 1;
      continue;
    }
    if (op.kind.startsWith("delete")) {
      const conflict = cs.conflicts.find((c) => c.entityType === type && c.entityId === id && c.field === "_delete");
      if (conflict && conflict.resolved === "master") {
        db.mergedOpKeys.push(op.opId); // 裁决保留主账 = 该删除不再重放，也标记处理过
        skipped += 1;
        continue;
      }
      applyOp(db, op);
      db.mergedOpKeys.push(op.opId);
      applied += 1;
      continue;
    }
    const incoming = (op as { entity: AnyEntity }).entity;
    const master = getEntity(db, type, id);
    let finalEntity = incoming;
    if (master) {
      const mergedObj: Record<string, unknown> = { ...recAll(incoming) };
      for (const c of cs.conflicts) {
        if (c.entityType === type && c.entityId === id && c.resolved === "master") {
          mergedObj[c.field] = recAll(master)[c.field];
        }
      }
      finalEntity = mergedObj as unknown as AnyEntity;
    }
    const newOp = { ...(op as unknown as { entity: AnyEntity }), entity: finalEntity } as unknown as Op;
    applyOp(db, newOp);
    db.mergedOpKeys.push(op.opId);
    applied += 1;
  }
  cs.status = "merged";
  cs.appliedCount = applied;
  cs.skippedCount = skipped;
  if (show) {
    show.rev += 1;
    cs.mergedRev = show.rev;
    recomputeCues(db, show.id);
  }
}

/* ---------------- 发布 ---------------- */

export function publishShow(db: DB, showId: string, note: string, by: string): Publication | null {
  const show = db.shows.find((s) => s.id === showId);
  if (!show) return null;
  recomputeCues(db, showId);
  show.publishedRev = show.rev;
  const pub: Publication = { id: uid("pub"), showId, rev: show.rev, note, by, at: Date.now() };
  db.publications = [pub, ...db.publications];
  addLog(db, `《${show.name}》发布 v${show.rev}${note ? `：${note}` : ""}`);
  return pub;
}

/* ---------------- 副本 → 变更单（diff 出操作） ---------------- */

function diffEntity<T extends { id: string }>(
  baseList: T[],
  nextList: T[],
  makeUpsert: (e: T) => Op,
  makeDelete: (id: string) => Op
): Op[] {
  const ops: Op[] = [];
  for (const next of nextList) {
    const base = baseList.find((b) => b.id === next.id);
    if (!base || JSON.stringify(stripMeta(base)) !== JSON.stringify(stripMeta(next))) {
      ops.push(makeUpsert(next));
    }
  }
  const nextIds = new Set(nextList.map((x) => x.id));
  for (const base of baseList) {
    if (!nextIds.has(base.id)) ops.push(makeDelete(base.id));
  }
  return ops;
}

function stripMeta<T>(e: T): T {
  const out: Record<string, unknown> = { ...recAll(e) };
  delete out.updatedAt;
  delete out.dirty;
  delete out.rev;
  delete out.publishedRev;
  return out as unknown as T;
}

export function buildChangesetOps(copy: WorkingCopy): Op[] {
  const ops: Op[] = [];
  const showChanged = JSON.stringify(stripMeta(copy.base.show)) !== JSON.stringify(stripMeta(copy.show));
  if (showChanged) ops.push({ kind: "upsertShow", opId: uid("op"), entity: copy.show });
  ops.push(
    ...diffEntity(
      copy.base.channels,
      copy.channels,
      (e) => ({ kind: "upsertChannel", opId: uid("op"), entity: e }),
      (id) => ({ kind: "deleteChannel", opId: uid("op"), showId: copy.showId, id })
    )
  );
  ops.push(
    ...diffEntity(
      copy.base.fixtures,
      copy.fixtures,
      (e) => ({ kind: "upsertFixture", opId: uid("op"), entity: e }),
      (id) => ({ kind: "deleteFixture", opId: uid("op"), showId: copy.showId, id })
    )
  );
  ops.push(
    ...diffEntity(
      copy.base.cues,
      copy.cues,
      (e) => ({ kind: "upsertCue", opId: uid("op"), entity: e }),
      (id) => ({ kind: "deleteCue", opId: uid("op"), showId: copy.showId, id })
    )
  );
  return ops;
}

export function createChangeset(db: DB, copy: WorkingCopy, author: string, role: Changeset["role"]): Changeset | null {
  const ops = buildChangesetOps(copy);
  if (ops.length === 0) return null;
  db.csSeq += 1;
  const cs: Changeset = {
    id: uid("cs"),
    showId: copy.showId,
    showName: copy.show.name,
    copyId: copy.id,
    copyLabel: copy.label,
    author,
    role,
    baseRev: copy.baseRev,
    baseSnapshot: {
      shows: [copy.base.show],
      channels: copy.base.channels,
      fixtures: copy.base.fixtures,
      cues: copy.base.cues,
    },
    ops,
    status: "outbox",
    createdAt: Date.now(),
    submittedAt: Date.now(),
    seq: db.csSeq,
    conflicts: [],
    appliedCount: 0,
    skippedCount: 0,
  };
  db.changesets = [cs, ...db.changesets];
  return cs;
}

export function pendingOutbox(db: DB): Changeset[] {
  return db.changesets.filter((c) => c.status === "outbox").sort((a, b) => a.seq - b.seq);
}

export function pendingConflicts(db: DB): Changeset[] {
  return db.changesets.filter((c) => c.status === "conflict");
}
