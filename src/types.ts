// 灯光排程台本地账的数据模型

export type Role = "operator" | "designer";

export interface User {
  name: string;
  role: Role;
}

export interface Show {
  id: string;
  name: string;
  note: string;
  /** 主控台账当前版本号（乐观锁用） */
  rev: number;
  /** 最近一次发布的版本号 */
  publishedRev: number;
  createdAt: number;
}

export interface Channel {
  id: string;
  showId: string;
  /** 通道号，如 "021" */
  no: string;
  /** 额定负载（W），旧数据缺失时为 null，待补全 */
  ratedLoad: number | null;
}

export type FixtureType = "面光" | "侧光" | "逆光" | "效果光";

export const FIXTURE_TYPES: FixtureType[] = ["面光", "侧光", "逆光", "效果光"];

export interface Fixture {
  id: string;
  showId: string;
  /** 灯具编号，如 FOH-03 */
  code: string;
  /** 通道号 */
  channelNo: string | null;
  type: FixtureType | "";
  /** 色片 */
  gel: string;
  /** 灯位（舞台平面坐标 0-100），null 表示待定位 */
  x: number | null;
  y: number | null;
  /** 焦点位置 */
  focus: string;
  /** 亮度预设百分比 */
  brightness: number | null;
  /** 灯具功率（W） */
  power: number | null;
  updatedAt: number;
}

export interface Cue {
  id: string;
  showId: string;
  /** Cue 号，如 "12" */
  no: string;
  name: string;
  /** 触发顺序（重算后按 Cue 号顺延） */
  trigger: number;
  /** 该 Cue 点亮的灯具 */
  fixtureIds: string[];
  note: string;
  /** 灯位/色片变更后置脏：触发顺序与负载占用作废，等待重算 */
  dirty: boolean;
  updatedAt: number;
}

export interface Publication {
  id: string;
  showId: string;
  rev: number;
  note: string;
  by: string;
  at: number;
}

export interface LogEntry {
  id: string;
  at: number;
  text: string;
}

export type Op =
  | { kind: "upsertShow"; opId: string; entity: Show }
  | { kind: "upsertChannel"; opId: string; entity: Channel }
  | { kind: "upsertFixture"; opId: string; entity: Fixture }
  | { kind: "upsertCue"; opId: string; entity: Cue }
  | { kind: "deleteChannel"; opId: string; showId: string; id: string }
  | { kind: "deleteFixture"; opId: string; showId: string; id: string }
  | { kind: "deleteCue"; opId: string; showId: string; id: string };

export interface FieldConflict {
  entityType: "show" | "channel" | "fixture" | "cue";
  entityId: string;
  label: string;
  field: string;
  base: string;
  master: string;
  incoming: string;
  /** 操作员裁决方向，未裁决为 null */
  resolved: "master" | "incoming" | null;
}

export type ChangesetStatus = "outbox" | "conflict" | "merged";

export interface Changeset {
  id: string;
  showId: string;
  showName: string;
  copyId: string;
  copyLabel: string;
  author: string;
  role: Role;
  /** 副本所基于的主账版本 */
  baseRev: number;
  /** 建副本时的实体快照，三方合并的 base（先到入库 / 晚到列冲突） */
  baseSnapshot: {
    shows: Show[];
    channels: Channel[];
    fixtures: Fixture[];
    cues: Cue[];
  };
  ops: Op[];
  status: ChangesetStatus;
  createdAt: number;
  submittedAt: number;
  /** 提交先后序号（先到先入库） */
  seq: number;
  /** 入库后的主账版本 */
  mergedRev?: number;
  conflicts: FieldConflict[];
  appliedCount: number;
  skippedCount: number;
}

/** 控台副本：断网期间灯光师各自续作的一份草稿账 */
export interface WorkingCopy {
  id: string;
  showId: string;
  label: string;
  owner: string;
  baseRev: number;
  createdAt: number;
  show: Show;
  channels: Channel[];
  fixtures: Fixture[];
  cues: Cue[];
  /** 建副本时的快照，三方合并的 base */
  base: {
    show: Show;
    channels: Channel[];
    fixtures: Fixture[];
    cues: Cue[];
  };
}

export interface MigrationSummary {
  shows: number;
  fixtures: number;
  cues: number;
  missing: number;
}

export interface DB {
  schemaVersion: 1;
  migrated: boolean;
  migrationDismissed: boolean;
  migrationSummary: MigrationSummary | null;
  shows: Show[];
  channels: Channel[];
  fixtures: Fixture[];
  cues: Cue[];
  copies: WorkingCopy[];
  changesets: Changeset[];
  publications: Publication[];
  /** 已合并操作的幂等键：断网重试时跳过，已合并内容不重复 */
  mergedOpKeys: string[];
  /** 变更单单调序号，保证同毫秒并发也按提交先后合并 */
  csSeq: number;
  logs: LogEntry[];
}
