// 断网同步：发件箱刷新、副本导入导出、幂等合并
import { conflictsStore, eventsStore, outboxStore } from "./db";
import { mergeEvents, uuid, type LedgerState, type MergeResult } from "./ledger";
import type { ConflictRecord, LedgerEvent, OutboxItem } from "./types";

export interface MergeDeps {
  putEvent: (e: LedgerEvent) => Promise<void>;
  putConflict: (c: ConflictRecord) => Promise<void>;
  hasEvent: (id: string) => Promise<boolean>;
  hasOpenConflict: (eventId: string) => Promise<boolean>;
}

export function defaultDeps(): MergeDeps {
  return {
    putEvent: (e) => eventsStore.put(e),
    putConflict: async (c) => {
      if (await conflictsStore.all().then((all) => all.some((x) => x.event.id === c.event.id && x.status === "open"))) return;
      await conflictsStore.put(c);
    },
    hasEvent: async (id) => Boolean(await eventsStore.has(id)),
    hasOpenConflict: async (eventId) =>
      (await conflictsStore.all()).some((x) => x.event.id === eventId && x.status === "open"),
  };
}

/** 合并一批事件到账本：UUID 去重，冲突入队，已合并不重复 */
export async function mergeAndPersist(
  state: LedgerState,
  incoming: LedgerEvent[],
  deps: MergeDeps = defaultDeps()
): Promise<MergeResult> {
  const already = new Set<string>();
  for (const ev of incoming) {
    if (await deps.hasEvent(ev.id)) already.add(ev.id);
  }
  const result = mergeEvents(state, incoming, already);
  for (const ev of result.applied) await deps.putEvent(ev);
  for (const c of result.conflicts) {
    if (await deps.hasOpenConflict(c.event.id)) continue;
    await deps.putConflict(c);
  }
  return result;
}

/** 刷新发件箱：排队中的批次在联网后继续重试合并 */
export async function flushOutbox(
  state: LedgerState,
  items: OutboxItem[],
  deps: MergeDeps = defaultDeps()
): Promise<{ item: OutboxItem; result: MergeResult }[]> {
  const report: { item: OutboxItem; result: MergeResult }[] = [];
  for (const item of items) {
    if (item.status !== "queued") continue;
    item.attempts += 1;
    try {
      const result = await mergeAndPersist(state, item.events, deps);
      item.lastError = undefined;
      item.status = result.conflicts.length
        ? result.applied.length
          ? "partial"
          : "conflict"
        : "published";
      await outboxStore.put(item);
      report.push({ item, result });
    } catch (err) {
      item.lastError = err instanceof Error ? err.message : String(err);
      await outboxStore.put(item);
    }
  }
  return report;
}

/** 待审稿发布：操作员批准后才合并入账 */
export async function approveItem(
  state: LedgerState,
  item: OutboxItem,
  deps: MergeDeps = defaultDeps()
): Promise<MergeResult> {
  const result = await mergeAndPersist(state, item.events, deps);
  item.status = result.conflicts.length
    ? result.applied.length
      ? "partial"
      : "conflict"
    : "published";
  await outboxStore.put(item);
  return result;
}

/** 待审稿驳回：事件标记 rejected 留痕，重试不重复 */
export async function rejectItem(item: OutboxItem): Promise<void> {
  item.status = "rejected";
  for (const ev of item.events) ev.status = "rejected";
  await outboxStore.put(item);
}

// ---- 副本文件格式 ----

export interface Snapshot {
  app: "lighting-cue-desk";
  version: 1;
  exportedAt: number;
  author: string;
  events: LedgerEvent[];
}

export function buildSnapshot(events: LedgerEvent[], author: string): Snapshot {
  return {
    app: "lighting-cue-desk",
    version: 1,
    exportedAt: Date.now(),
    author,
    events: [...events].sort((a, b) => a.ts - b.ts),
  };
}

export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Partial<Snapshot>;
  if (data.app !== "lighting-cue-desk" || !Array.isArray(data.events)) {
    throw new Error("文件格式不正确：不是灯光排程台账本副本");
  }
  return data as Snapshot;
}

export function downloadSnapshot(snapshot: Snapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `灯光排程台-账本副本-${new Date(snapshot.exportedAt).toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 把副本导入为发件箱批次（带回主控台合并） */
export function snapshotToOutbox(snap: Snapshot): OutboxItem {
  return {
    id: uuid(),
    ts: snap.exportedAt,
    author: snap.author || "未知灯光师",
    role: "designer",
    status: "queued",
    events: snap.events,
    attempts: 0,
    source: "import",
    label: `副本导入 · ${snap.events.length} 条变更`,
  };
}
