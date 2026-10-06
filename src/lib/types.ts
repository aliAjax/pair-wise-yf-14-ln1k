// 灯光排程台核心数据模型

export type Role = "operator" | "designer";

export type EntityKind = "show" | "fixture" | "cue";

export type OpType = "upsert" | "delete";

/** 事件状态：published 已入账；rejected 已驳回（留痕，重试不重复） */
export type EventStatus = "published" | "rejected";

/** 发件箱批次状态 */
export type BatchStatus =
  | "queued" // 断网排队中
  | "pending" // 待审稿（设计师提交）
  | "published" // 已发布入账
  | "partial" // 部分冲突
  | "conflict" // 全部冲突
  | "rejected"; // 已驳回

export interface Show {
  id: string;
  name: string;
  notes: string;
  /** 通道号 -> 通道额定负载（瓦） */
  channelLoads: Record<number, number>;
  createdAt: number;
  updatedAt: number;
  version: number;
  missingFields?: string[];
}

export interface Fixture {
  id: string;
  showId: string;
  number: string;
  channel: number | null;
  gel: string;
  position: string;
  area: string;
  brightness: number;
  /** 灯具额定负载（瓦），迁移期可能为空 */
  ratedLoad: number | null;
  /** 舞台平面坐标（百分比） */
  x: number;
  y: number;
  /** 影响 Cue 计算的字段版本（灯位/色片/通道/负载/区域变更时 +1） */
  rev: number;
  createdAt: number;
  updatedAt: number;
  version: number;
  missingFields?: string[];
}

export interface CueState {
  fixtureId: string;
  brightness: number;
}

export interface Cue {
  id: string;
  showId: string;
  /** 触发顺序 */
  number: number;
  label: string;
  notes: string;
  states: CueState[];
  /** 上次重算时各灯具的 rev */
  revs: Record<string, number>;
  createdAt: number;
  updatedAt: number;
  version: number;
  missingFields?: string[];
}

/** 账本事件：一次变更一条，UUID 即幂等键 */
export interface LedgerEvent {
  id: string;
  entity: EntityKind;
  entityId: string;
  op: OpType;
  /** 变更字段 -> 新值 */
  patch: Record<string, unknown>;
  /** 基于哪个快照版本（用于三方合并） */
  base: Record<string, unknown> | null;
  baseVersion: number;
  author: string;
  role: Role;
  ts: number;
  status: EventStatus;
  batchId: string;
}

export interface OutboxItem {
  id: string;
  ts: number;
  author: string;
  role: Role;
  status: BatchStatus;
  events: LedgerEvent[];
  attempts: number;
  lastError?: string;
  /** local=本机提交；import=带回的副本 */
  source: "local" | "import";
  label: string;
}

export interface ConflictRecord {
  id: string;
  ts: number;
  entity: EntityKind;
  entityId: string;
  event: LedgerEvent;
  /** 先到的版本（已入库） */
  current: Record<string, unknown> | null;
  /** 后到的版本（base + patch） */
  incoming: Record<string, unknown>;
  /** 发生冲突的字段中文名 */
  fields: string[];
  status: "open" | "kept" | "accepted";
  batchId: string;
}

export interface MigrationSummary {
  migratedAt: number;
  shows: number;
  fixtures: number;
  cues: number;
  missing: number;
}
