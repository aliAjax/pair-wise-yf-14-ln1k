// 账本核心：事件重放、三方合并、冲突识别
import type {
  ConflictRecord,
  EntityKind,
  Fixture,
  LedgerEvent,
  OpType,
  Role,
  Show,
  Cue,
} from "./types";

export interface LedgerState {
  shows: Record<string, Show>;
  fixtures: Record<string, Fixture>;
  cues: Record<string, Cue>;
}

export function emptyState(): LedgerState {
  return { shows: {}, fixtures: {}, cues: {} };
}

const KIND_TO_STORE = { show: "shows", fixture: "fixtures", cue: "cues" } as const;

export function entitiesOf(state: LedgerState, kind: EntityKind): Record<string, Show | Fixture | Cue> {
  return state[KIND_TO_STORE[kind]];
}

export function entityOf(state: LedgerState, kind: EntityKind, id: string) {
  return entitiesOf(state, kind)[id] as Show | Fixture | Cue | undefined;
}

/** 重放事件流水，生成当前实体状态 */
export function replay(events: LedgerEvent[]): LedgerState {
  const state = emptyState();
  const sorted = [...events].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  for (const ev of sorted) applyEvent(state, ev);
  return state;
}

/** 把一条事件应用到状态（原地修改） */
export function applyEvent(state: LedgerState, ev: LedgerEvent): void {
  const bucket = entitiesOf(state, ev.entity) as unknown as Record<string, Record<string, unknown>>;
  const prev = bucket[ev.entityId];
  if (ev.op === "delete") {
    delete bucket[ev.entityId];
    return;
  }
  const next: Record<string, unknown> = {
    ...(prev ?? {}),
    ...ev.patch,
    id: ev.entityId,
    updatedAt: ev.ts,
    version: ((prev?.version as number | undefined) ?? 0) + 1,
  };
  if (!prev) {
    next.createdAt = ev.ts;
  }
  bucket[ev.entityId] = next;
}

/** 构造一条 upsert 事件 */
export function makeUpsertEvent(
  entity: EntityKind,
  entityId: string,
  patch: Record<string, unknown>,
  current: { version?: number } | null,
  author: string,
  role: Role,
  batchId: string,
  ts: number
): LedgerEvent {
  return {
    id: uuid(),
    entity,
    entityId,
    op: "upsert",
    patch,
    base: current ? { ...(current as Record<string, unknown>) } : null,
    baseVersion: current?.version ?? 0,
    author,
    role,
    ts,
    status: "published",
    batchId,
  };
}

export function makeDeleteEvent(
  entity: EntityKind,
  entityId: string,
  current: { version: number } | null,
  author: string,
  role: Role,
  batchId: string,
  ts: number
): LedgerEvent {
  return {
    id: uuid(),
    entity,
    entityId,
    op: "delete",
    patch: {},
    base: current ? { ...(current as Record<string, unknown>) } : null,
    baseVersion: current?.version ?? 0,
    author,
    role,
    ts,
    status: "published",
    batchId,
  };
}

/**
 * 三方合并：
 * - 事件 UUID 已存在 -> 跳过（幂等，不重复入账）
 * - 实体自 base 后未被他人改过 -> 干净应用
 * - 双方都改了同一字段 -> 记冲突，先到的留在库里，后到的进冲突队列
 */
export interface MergeResult {
  applied: LedgerEvent[];
  skipped: string[];
  conflicts: ConflictRecord[];
}

export function mergeEvents(
  state: LedgerState,
  incoming: LedgerEvent[],
  alreadyMerged: Set<string>
): MergeResult {
  const result: MergeResult = { applied: [], skipped: [], conflicts: [] };

  for (const ev of incoming) {
    if (alreadyMerged.has(ev.id)) {
      result.skipped.push(ev.id);
      continue;
    }
    const current = entityOf(state, ev.entity, ev.entityId) as
      | Record<string, unknown>
      | undefined;

    if (ev.op === "delete") {
      if (current && current.version !== ev.baseVersion) {
        result.conflicts.push(buildConflict(ev, current));
        continue;
      }
      applyEvent(state, ev);
      result.applied.push(ev);
      alreadyMerged.add(ev.id);
      continue;
    }

    // upsert
    if (current && current.version !== ev.baseVersion) {
      const conflicting = conflictingFields(ev, current);
      if (conflicting.length > 0) {
        result.conflicts.push(buildConflict(ev, current, conflicting));
        continue;
      }
    }
    applyEvent(state, ev);
    result.applied.push(ev);
    alreadyMerged.add(ev.id);
  }

  return result;
}

function buildConflict(
  ev: LedgerEvent,
  current: Record<string, unknown>,
  fields?: string[]
): ConflictRecord {
  const incoming = { ...(ev.base ?? {}), ...ev.patch };
  return {
    id: uuid(),
    ts: Date.now(),
    entity: ev.entity,
    entityId: ev.entityId,
    event: ev,
    current,
    incoming,
    fields: fields ?? ["该实体已被他人修改"],
    status: "open",
    batchId: ev.batchId,
  };
}

/** 找出“后到”与“先到”同时改过的字段（base 两侧都动过） */
function conflictingFields(ev: LedgerEvent, current: Record<string, unknown>): string[] {
  const base = ev.base ?? {};
  const out: string[] = [];
  for (const key of Object.keys(ev.patch)) {
    const baseVal = base[key];
    const curVal = current[key];
    const patchVal = ev.patch[key];
    if (deepEqual(baseVal, curVal)) continue; // 先到没动过这个字段 -> 可干净合并
    if (deepEqual(curVal, patchVal)) continue; // 改后的值其实一样
    out.push(FIELD_LABELS[key] ?? key);
  }
  return out;
}

/** 冲突解决：采用后到版本（在当前状态上强制覆盖） */
export function acceptIncoming(state: LedgerState, conflict: ConflictRecord): void {
  const bucket = entitiesOf(state, conflict.entity) as unknown as Record<string, Record<string, unknown>>;
  const prev = bucket[conflict.entityId] ?? {};
  bucket[conflict.entityId] = {
    ...prev,
    ...conflict.incoming,
    id: conflict.entityId,
    updatedAt: Date.now(),
    version: ((prev.version as number) ?? 0) + 1,
  };
}

/** 冲突解决：保留先到版本（后到事件驳回留痕） */
export function keepCurrent(conflict: ConflictRecord): void {
  conflict.status = "kept";
  conflict.event.status = "rejected";
}

// ---- 展示工具 ----

export const FIELD_LABELS: Record<string, string> = {
  name: "演出名称",
  notes: "版本备注",
  channelLoads: "通道额定负载",
  number: "编号",
  channel: "通道号",
  gel: "色片",
  position: "焦点位置",
  area: "灯区",
  brightness: "亮度预设",
  ratedLoad: "灯具额定负载",
  x: "灯位X",
  y: "灯位Y",
  rev: "版本标记",
  showId: "所属演出",
  label: "Cue标签",
  states: "Cue状态",
  revs: "重算标记",
};

export const ENTITY_LABELS: Record<EntityKind, string> = {
  show: "演出",
  fixture: "灯具",
  cue: "Cue",
};

export function entityDisplayName(kind: EntityKind, obj: Record<string, unknown> | null | undefined): string {
  if (!obj) return "（已删除）";
  if (kind === "show") return String(obj.name ?? "未命名演出");
  if (kind === "fixture") return `${obj.number ?? "?"} 号灯具`;
  return `Cue ${obj.number ?? "?"}${obj.label ? ` · ${obj.label}` : ""}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function nowTs(): number {
  return Date.now();
}

export type { OpType };
