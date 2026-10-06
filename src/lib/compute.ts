// 负载计算与 Cue 失效重算
import type { Cue, Fixture } from "./types";

export interface LoadRow {
  channel: number;
  watts: number;
  rated: number | null;
  over: boolean;
  /** 参与该通道的灯具数 */
  count: number;
}

/** 计算 Cue 各通道的负载占用（亮度% × 灯具额定负载） */
export function cueLoad(cue: Cue, fixtures: Record<string, Fixture>, channelLoads: Record<number, number>): LoadRow[] {
  const perChannel = new Map<number, { watts: number; count: number }>();
  for (const st of cue.states) {
    const f = fixtures[st.fixtureId];
    if (!f || f.channel == null || f.ratedLoad == null) continue;
    const level = Math.max(0, Math.min(100, st.brightness)) / 100;
    const row = perChannel.get(f.channel) ?? { watts: 0, count: 0 };
    row.watts += f.ratedLoad * level;
    row.count += 1;
    perChannel.set(f.channel, row);
  }
  return [...perChannel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([channel, v]) => {
      const rated = channelLoads[channel] ?? null;
      return {
        channel,
        watts: Math.round(v.watts),
        rated,
        over: rated != null && v.watts > rated,
        count: v.count,
      };
    });
}

export interface CueStatus {
  invalid: boolean;
  reasons: string[];
}

/** 灯位/色片/通道/负载变更后，引用该灯具的 Cue 作废，需要重算 */
export function cueStatus(cue: Cue, fixtures: Record<string, Fixture>): CueStatus {
  const reasons: string[] = [];
  for (const st of cue.states) {
    const f = fixtures[st.fixtureId];
    if (!f) {
      reasons.push(`灯具 ${st.fixtureId.slice(0, 6)}… 已删除`);
      continue;
    }
    const seenRev = cue.revs[st.fixtureId] ?? 0;
    if (f.rev > seenRev) {
      reasons.push(`${f.number} 号灯具参数已变更（灯位/色片/通道/负载）`);
    }
  }
  return { invalid: reasons.length > 0, reasons };
}

/** 重算：固化当前灯具 rev 快照，作废标记清除 */
export function recomputeCue(cue: Cue, fixtures: Record<string, Fixture>): Cue {
  const revs: Record<string, number> = {};
  for (const st of cue.states) {
    const f = fixtures[st.fixtureId];
    if (f) revs[st.fixtureId] = f.rev;
  }
  return { ...cue, revs, updatedAt: Date.now() };
}

/** 重算全部 Cue，返回更新后的实体映射 */
export function recomputeAll(
  cues: Record<string, Cue>,
  fixtures: Record<string, Fixture>
): Record<string, Cue> {
  const out: Record<string, Cue> = {};
  for (const [id, cue] of Object.entries(cues)) {
    out[id] = recomputeCue(cue, fixtures);
  }
  return out;
}

/** 通道负载汇总（灯具页用） */
export function channelSummary(
  fixtures: Fixture[],
  channelLoads: Record<number, number>
): { channel: number; count: number; totalRated: number; rated: number | null }[] {
  const map = new Map<number, { count: number; totalRated: number }>();
  for (const f of fixtures) {
    if (f.channel == null) continue;
    const row = map.get(f.channel) ?? { count: 0, totalRated: 0 };
    row.count += 1;
    row.totalRated += f.ratedLoad ?? 0;
    map.set(f.channel, row);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([channel, v]) => ({
      channel,
      count: v.count,
      totalRated: v.totalRated,
      rated: channelLoads[channel] ?? null,
    }));
}
