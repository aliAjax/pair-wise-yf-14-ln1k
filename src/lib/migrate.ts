// 旧数据迁移：首次打开把 v0 旧格式迁入 演出/灯具/Cue 三本账
import { eventsStore, getMeta, setMeta } from "./db";
import { makeUpsertEvent, replay, uuid } from "./ledger";
import type { Cue, Fixture, LedgerEvent, MigrationSummary, Show } from "./types";

export const LEGACY_KEY = "lighting-desk-legacy-v0";
export const MIGRATION_FLAG = "v1";

interface LegacyData {
  version?: number;
  savedAt?: number;
  shows?: Array<{ id?: string; name?: string; notes?: string }>;
  fixtures?: Array<{
    id?: string;
    showName?: string;
    number?: string;
    channel?: number | string;
    gel?: string;
    position?: string;
    area?: string;
    brightness?: number;
    ratedLoad?: number;
    x?: number;
    y?: number;
  }>;
  cues?: Array<{
    id?: string;
    showName?: string;
    number?: number;
    label?: string;
    notes?: string;
    levels?: Record<string, number>;
  }>;
  channelLoads?: Record<string, number>;
}

/** 演示用旧数据：真实用户若有旧版本数据则不会走到这里 */
function seedLegacy(): LegacyData {
  return {
    version: 0,
    savedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
    shows: [{ name: "《第十二夜》巡演版", notes: "版本B · 地下库房排练场" }],
    fixtures: [
      { number: "L01", channel: 21, gel: "冷蓝", position: "台口左", brightness: 65, x: 18, y: 78 },
      { number: "L02", channel: 22, gel: "琥珀", position: "台口右", brightness: 70, ratedLoad: 1000, area: "面光", x: 82, y: 78 },
      { number: "L03", channel: 31, position: "吊杆中", brightness: 60, x: 50, y: 30 },
      { number: "L04", channel: 32, gel: "冷蓝", position: "逆光高架", brightness: 40, ratedLoad: 1200, area: "逆光", x: 50, y: 12 },
    ],
    cues: [
      { number: 12, label: "冷蓝侧光", notes: "二幕开场", levels: { L01: 65, L02: 40 } },
      { number: 18, label: "追光入场", levels: { L03: 100 } },
      { number: 24, label: "暖色谢幕", notes: "版本B" },
    ],
    channelLoads: { 21: 2000, 22: 2000, 31: 1500 },
  };
}

function readLegacy(): LegacyData | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) {
      const seeded = seedLegacy();
      localStorage.setItem(LEGACY_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return JSON.parse(raw) as LegacyData;
  } catch {
    return null;
  }
}

export interface MigrationResult {
  migrated: boolean;
  summary?: MigrationSummary;
}

/** 首次打开时执行迁移；幂等，可重复调用 */
export async function ensureMigrated(): Promise<MigrationResult> {
  const meta = await getMeta();
  if (meta.migrated === MIGRATION_FLAG) return { migrated: false, summary: meta.migration };

  const legacy = readLegacy();
  if (!legacy) {
    await setMeta("migrated", MIGRATION_FLAG);
    return { migrated: false };
  }

  const { events, missing } = migrateLegacyData(legacy);

  // 落账
  for (const ev of events) await eventsStore.put(ev);
  const state = replay(events);
  const summary: MigrationSummary = {
    migratedAt: Date.now(),
    shows: Object.keys(state.shows).length,
    fixtures: Object.keys(state.fixtures).length,
    cues: Object.keys(state.cues).length,
    missing,
  };
  await setMeta("migrated", MIGRATION_FLAG);
  await setMeta("migration", summary);
  return { migrated: true, summary };
}

/** 旧数据 -> 账本事件（纯函数，可测试） */
export function migrateLegacyData(legacy: LegacyData): { events: LedgerEvent[]; missing: number } {
  const ts = legacy.savedAt ?? Date.now();
  const batchId = `migration-${uuid()}`;
  const events: LedgerEvent[] = [];
  let missing = 0;
  const countMissing = (fields: string[]) => (missing += fields.length);

  // 演出
  const showIds = new Map<string, string>();
  (legacy.shows ?? []).forEach((s, i) => {
    const id = s.id ?? uuid();
    showIds.set(s.name ?? `show-${i}`, id);
    const missingFields: string[] = [];
    if (!s.name) missingFields.push("name");
    if (s.notes == null) missingFields.push("notes");
    countMissing(missingFields);
    const show: Show = {
      id,
      name: s.name ?? "未命名演出",
      notes: s.notes ?? "",
      channelLoads: Object.fromEntries(
        Object.entries(legacy.channelLoads ?? {}).map(([k, v]) => [Number(k), v])
      ),
      createdAt: ts,
      updatedAt: ts,
      version: 1,
      missingFields: missingFields.length ? missingFields : undefined,
    };
    events.push({
      ...makeUpsertEvent("show", id, show as unknown as Record<string, unknown>, null, "旧数据迁移", "operator", batchId, ts),
      base: null,
    });
  });

  // 灯具
  const fixtureIds = new Map<string, string>();
  (legacy.fixtures ?? []).forEach((f, i) => {
    const id = f.id ?? uuid();
    const key = `${f.showName ?? ""}::${f.number ?? i}`;
    fixtureIds.set(key, id);
    const missingFields: string[] = [];
    if (f.number == null) missingFields.push("number");
    if (f.channel == null) missingFields.push("channel");
    if (f.gel == null) missingFields.push("gel");
    if (f.position == null) missingFields.push("position");
    if (f.area == null) missingFields.push("area");
    if (f.ratedLoad == null) missingFields.push("ratedLoad");
    countMissing(missingFields);
    const channel = f.channel == null ? null : Number(f.channel);
    const fixture: Fixture = {
      id,
      showId: pickShowId(showIds, f.showName),
      number: f.number ?? `未命名${i + 1}`,
      channel: Number.isFinite(channel) ? channel : null,
      gel: f.gel ?? "",
      position: f.position ?? "",
      area: f.area ?? "",
      brightness: f.brightness ?? 80,
      ratedLoad: f.ratedLoad ?? null,
      x: f.x ?? 50,
      y: f.y ?? 50,
      rev: 1,
      createdAt: ts,
      updatedAt: ts,
      version: 1,
      missingFields: missingFields.length ? missingFields : undefined,
    };
    events.push({
      ...makeUpsertEvent("fixture", id, fixture as unknown as Record<string, unknown>, null, "旧数据迁移", "operator", batchId, ts),
      base: null,
    });
  });

  // Cue
  (legacy.cues ?? []).forEach((c, i) => {
    const id = c.id ?? uuid();
    const missingFields: string[] = [];
    if (c.number == null) missingFields.push("number");
    if (c.label == null) missingFields.push("label");
    if (c.notes == null) missingFields.push("notes");
    const states = Object.entries(c.levels ?? {}).map(([num, brightness]) => {
      const fixtureId = fixtureIds.get(`${c.showName ?? ""}::${num}`) ?? "";
      return { fixtureId, brightness };
    });
    if (states.length === 0) missingFields.push("states");
    countMissing(missingFields);
    const cue: Cue = {
      id,
      showId: pickShowId(showIds, c.showName),
      number: c.number ?? i + 1,
      label: c.label ?? "",
      notes: c.notes ?? "",
      states: states.filter((s) => s.fixtureId),
      revs: {},
      createdAt: ts,
      updatedAt: ts,
      version: 1,
      missingFields: missingFields.length ? missingFields : undefined,
    };
    events.push({
      ...makeUpsertEvent("cue", id, cue as unknown as Record<string, unknown>, null, "旧数据迁移", "operator", batchId, ts),
      base: null,
    });
  });

  return { events, missing };
}

function pickShowId(showIds: Map<string, string>, showName?: string): string {
  if (showName && showIds.has(showName)) return showIds.get(showName)!;
  const first = showIds.values().next().value as string | undefined;
  return first ?? uuid();
}
