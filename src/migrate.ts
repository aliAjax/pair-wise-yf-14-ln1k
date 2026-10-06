import type { Cue, DB, Fixture, MigrationSummary, Show } from "./types";
import { addLog, recomputeCues, saveChannel, saveShow, uid } from "./ledger";

/** 旧页面里硬编码的三条记录（Cue 12 / Cue 18 / Cue 24） */
export const LEGACY_RECORDS: string[][] = [
  ["Cue 12", "冷蓝侧光", "CH 021-028，亮度65%", "二幕开场"],
  ["Cue 18", "追光入场", "FOH-03，焦点门口", "需演员走位确认"],
  ["Cue 24", "暖色谢幕", "全台面光80%", "版本B"],
];

function parsePercent(text: string): number | null {
  const m = text.match(/(\d+)\s*%/);
  return m ? Number(m[1]) : null;
}

function parseChRange(text: string): string[] {
  const m = text.match(/CH\s*(\d+)\s*[-–~]\s*(\d+)/i);
  if (m) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    const out: string[] = [];
    for (let n = start; n <= end; n += 1) out.push(String(n).padStart(3, "0"));
    return out;
  }
  const single = text.match(/CH\s*(\d+)/i);
  return single ? [String(Number(single[1])).padStart(3, "0")] : [];
}

/** 旧账首次打开迁移：解析为 演出 / 灯具 / Cue；缺字段置空，留待补全 */
export function migrateLegacy(db: DB): MigrationSummary {
  const now = Date.now();
  const show: Show = {
    id: uid("show"),
    name: "未命名演出（旧账迁移）",
    note: "由旧版 Cue 表静态记录迁移而来，请补全演出名称与灯位信息",
    rev: 1,
    publishedRev: 0,
    createdAt: now,
  };
  saveShow(db, show);

  const fixtures: Fixture[] = [];
  const cues: Cue[] = [];
  let missing = 0;

  for (const [cueText, cueName, desc, note] of LEGACY_RECORDS) {
    const cueNo = cueText.replace(/^Cue\s*/i, "").trim();
    const brightness = parsePercent(desc);
    let fxIds: string[] = [];

    if (cueNo === "12") {
      // CH 021-028，亮度65%：为每通道建一盏灯，灯位/额定负载/功率缺失
      const range = parseChRange(desc);
      for (const ch of range) {
        saveChannel(db, { id: uid("ch"), showId: show.id, no: ch, ratedLoad: null });
        const fx: Fixture = {
          id: uid("fx"),
          showId: show.id,
          code: `SL-${ch}`,
          channelNo: ch,
          type: "侧光",
          gel: "冷蓝",
          x: null,
          y: null,
          focus: "",
          brightness,
          power: null,
          updatedAt: now,
        };
        fixtures.push(fx);
        missing += 3; // 灯位、功率、额定负载
      }
      fxIds = fixtures.slice(-range.length).map((f) => f.id);
    } else if (cueNo === "18") {
      // FOH-03，焦点门口：通道、色片、灯位、功率缺失
      const fx: Fixture = {
        id: uid("fx"),
        showId: show.id,
        code: "FOH-03",
        channelNo: null,
        type: "效果光",
        gel: "",
        x: null,
        y: null,
        focus: "门口",
        brightness,
        power: null,
        updatedAt: now,
      };
      fixtures.push(fx);
      fxIds = [fx.id];
      missing += 4;
    } else {
      // Cue 24 全台面光80%：建一盏面光占位灯，通道与灯位待补
      const fx: Fixture = {
        id: uid("fx"),
        showId: show.id,
        code: "WASH-FOH",
        channelNo: null,
        type: "面光",
        gel: "暖",
        x: null,
        y: null,
        focus: "全台",
        brightness,
        power: null,
        updatedAt: now,
      };
      fixtures.push(fx);
      fxIds = [fx.id];
      missing += 3;
    }

    const cue: Cue = {
      id: uid("cue"),
      showId: show.id,
      no: cueNo,
      name: cueName,
      trigger: 0,
      fixtureIds: fxIds,
      note,
      dirty: false,
      updatedAt: now,
    };
    cues.push(cue);
  }

  db.fixtures.push(...fixtures);
  db.cues.push(...cues);
  recomputeCues(db, show.id);

  const summary: MigrationSummary = {
    shows: 1,
    fixtures: fixtures.length,
    cues: cues.length,
    missing,
  };
  db.migrated = true;
  db.migrationSummary = summary;
  addLog(db, `旧账迁移完成：${summary.shows} 场演出、${summary.fixtures} 盏灯具、${summary.cues} 个 Cue，${summary.missing} 处字段待补全`);
  return summary;
}
