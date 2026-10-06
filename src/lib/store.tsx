// 排程台状态中心：账本重放、提交、待审、冲突、断网重试
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  conflictsStore,
  eventsStore,
  getMeta,
  outboxStore,
} from "./db";
import { ensureMigrated } from "./migrate";
import {
  acceptIncoming,
  deepEqual,
  emptyState,
  entityOf,
  ENTITY_LABELS,
  keepCurrent,
  makeDeleteEvent,
  makeUpsertEvent,
  replay,
  uuid,
  type LedgerState,
} from "./ledger";
import { recomputeCue } from "./compute";
import {
  approveItem,
  buildSnapshot,
  downloadSnapshot,
  flushOutbox,
  parseSnapshot,
  rejectItem,
  snapshotToOutbox,
} from "./sync";
import type {
  ConflictRecord,
  EntityKind,
  LedgerEvent,
  MigrationSummary,
  OpType,
  OutboxItem,
  Role,
} from "./types";

interface DeskStore {
  loading: boolean;
  state: LedgerState;
  events: LedgerEvent[];
  outbox: OutboxItem[];
  conflicts: ConflictRecord[];
  role: Role;
  setRole: (r: Role) => void;
  online: boolean;
  activeShowId: string | null;
  setActiveShowId: (id: string) => void;
  migration: MigrationSummary | null;
  migrationDismissed: boolean;
  dismissMigration: () => void;
  authorName: string;
  submit: (kind: EntityKind, entityId: string | null, op: OpType, entity: Record<string, unknown>) => Promise<void>;
  approve: (item: OutboxItem) => Promise<void>;
  reject: (item: OutboxItem) => Promise<void>;
  resolveConflict: (c: ConflictRecord, mode: "keep" | "accept") => Promise<void>;
  retryFlush: () => Promise<void>;
  importSnapshotText: (text: string) => Promise<OutboxItem>;
  exportLedger: () => void;
  recomputeAllCues: () => Promise<void>;
  pendingCount: number;
  openConflictCount: number;
  queuedCount: number;
}

const DeskContext = createContext<DeskStore | null>(null);

const META_FIELDS = new Set(["id", "version", "createdAt", "updatedAt"]);

function diffPatch(next: Record<string, unknown>, prev: Record<string, unknown> | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    if (META_FIELDS.has(key)) continue;
    if (!deepEqual(next[key], prev?.[key])) patch[key] = next[key];
  }
  return patch;
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LedgerState>(emptyState);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [role, setRole] = useState<Role>("operator");
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [activeShowId, setActiveShowId] = useState<string | null>(null);
  const [migration, setMigration] = useState<MigrationSummary | null>(null);
  const [migrationDismissed, setMigrationDismissed] = useState(false);

  const stateRef = useRef(state);
  const outboxRef = useRef(outbox);
  const eventsRef = useRef(events);
  stateRef.current = state;
  outboxRef.current = outbox;
  eventsRef.current = events;

  const authorName = role === "operator" ? "主控台操作员" : "灯光师（副本）";

  const reload = useCallback(async () => {
    const [evs, ob, cf] = await Promise.all([
      eventsStore.all(),
      outboxStore.all(),
      conflictsStore.all(),
    ]);
    setState(replay(evs));
    setEvents(evs);
    setOutbox(ob);
    setConflicts(cf);
  }, []);

  // 首次打开：迁移旧数据 + 加载账本
  useEffect(() => {
    (async () => {
      const { summary } = await ensureMigrated();
      const meta = await getMeta();
      setMigration(summary ?? meta.migration ?? null);
      const evs = await eventsStore.all();
      const st = replay(evs);
      setState(st);
      setEvents(evs);
      setOutbox(await outboxStore.all());
      setConflicts(await conflictsStore.all());
      setActiveShowId((prev) => prev ?? Object.keys(st.shows)[0] ?? null);
      setLoading(false);
    })();
  }, []);

  // 在线/离线监听
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const runFlush = useCallback(
    async (targets?: OutboxItem[]) => {
      const st = stateRef.current;
      const items = targets ?? outboxRef.current;
      const queued = items.filter((i) => i.status === "queued");
      // 设计师联网后：排队件转待审稿，仍需操作员发布
      for (const it of queued) {
        if (it.role !== "operator") {
          it.status = "pending";
          await outboxStore.put(it);
        }
      }
      const toMerge = queued.filter((i) => i.role === "operator" || i.source === "import");
      if (toMerge.length > 0) {
        await flushOutbox(st, toMerge);
      }
      await reload();
    },
    [reload]
  );

  // 联网后自动重试合并
  useEffect(() => {
    if (online && !loading) void runFlush();
  }, [online, loading, runFlush]);

  const submit = useCallback(
    async (kind: EntityKind, entityId: string | null, op: OpType, entity: Record<string, unknown>) => {
      const ts = Date.now();
      const batchId = uuid();
      const current = entityId ? (entityOf(stateRef.current, kind, entityId) as Record<string, unknown> | undefined) : null;
      let ev: LedgerEvent;
      if (op === "delete") {
        ev = makeDeleteEvent(kind, entityId!, (current as { version: number } | undefined) ?? null, authorName, role, batchId, ts);
      } else {
        const targetId = entityId ?? uuid();
        const patch = diffPatch(entity, current ?? null);
        ev = makeUpsertEvent(kind, targetId, patch, current ?? null, authorName, role, batchId, ts);
      }
      const isNew = !current;
      const item: OutboxItem = {
        id: uuid(),
        ts,
        author: authorName,
        role,
        // 操作员：联网即发布；设计师：联网进待审稿；断网一律排队
        status: role === "operator" ? "queued" : online ? "pending" : "queued",
        events: [ev],
        attempts: 0,
        source: "local",
        label: `${isNew ? "新增" : op === "delete" ? "删除" : "编辑"}${ENTITY_LABELS[kind]}`,
      };
      await outboxStore.put(item);
      setOutbox((prev) => [...prev, { ...item }]);
      if (role === "operator" && online) {
        await runFlush([item]);
      }
    },
    [authorName, role, online, runFlush]
  );

  const approve = useCallback(
    async (item: OutboxItem) => {
      await approveItem(stateRef.current, item);
      await reload();
    },
    [reload]
  );

  const reject = useCallback(
    async (item: OutboxItem) => {
      await rejectItem(item);
      await reload();
    },
    [reload]
  );

  const resolveConflict = useCallback(
    async (c: ConflictRecord, mode: "keep" | "accept") => {
      if (mode === "keep") {
        keepCurrent(c);
        await conflictsStore.put(c);
      } else {
        acceptIncoming(stateRef.current, c);
        c.status = "accepted";
        // 后到事件留痕入账，重试同一副本不重复
        await eventsStore.put({
          ...c.event,
          op: "upsert",
          patch: { ...c.incoming },
          base: null,
          baseVersion: 0,
          status: "published",
        });
        await conflictsStore.put(c);
      }
      await reload();
    },
    [reload]
  );

  const retryFlush = useCallback(async () => {
    await runFlush();
  }, [runFlush]);

  const importSnapshotText = useCallback(
    async (text: string) => {
      const snap = parseSnapshot(text);
      const item = snapshotToOutbox(snap);
      await outboxStore.put(item);
      setOutbox((prev) => [...prev, item]);
      if (online) await runFlush([item]);
      const fresh = await outboxStore.get(item.id);
      return fresh ?? item;
    },
    [online, runFlush]
  );

  const exportLedger = useCallback(() => {
    const snap = buildSnapshot(eventsRef.current, authorName);
    downloadSnapshot(snap);
  }, [authorName]);

  const recomputeAllCues = useCallback(async () => {
    const st = stateRef.current;
    const ts = Date.now();
    const batchId = uuid();
    for (const cue of Object.values(st.cues)) {
      const updated = recomputeCue(cue, st.fixtures);
      const ev = makeUpsertEvent(
        "cue",
        cue.id,
        { revs: updated.revs },
        cue,
        "系统重算",
        "operator",
        batchId,
        ts
      );
      await eventsStore.put(ev);
    }
    await reload();
  }, [reload]);

  const dismissMigration = useCallback(() => setMigrationDismissed(true), []);

  const pendingCount = useMemo(() => outbox.filter((i) => i.status === "pending").length, [outbox]);
  const openConflictCount = useMemo(() => conflicts.filter((c) => c.status === "open").length, [conflicts]);
  const queuedCount = useMemo(() => outbox.filter((i) => i.status === "queued").length, [outbox]);

  const value: DeskStore = {
    loading,
    state,
    events,
    outbox,
    conflicts,
    role,
    setRole,
    online,
    activeShowId,
    setActiveShowId,
    migration,
    migrationDismissed,
    dismissMigration,
    authorName,
    submit,
    approve,
    reject,
    resolveConflict,
    retryFlush,
    importSnapshotText,
    exportLedger,
    recomputeAllCues,
    pendingCount,
    openConflictCount,
    queuedCount,
  };

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): DeskStore {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk must be used within DeskProvider");
  return ctx;
}
