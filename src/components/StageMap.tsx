import type { Cue, Fixture } from "../types";

const GEL_HEX: Record<string, string> = {
  冷蓝: "#2f7de1",
  蓝: "#2f7de1",
  暖: "#f2a93b",
  暖白: "#ffd28a",
  红: "#e04747",
  绿: "#38a169",
  紫: "#7c3aed",
  黄: "#f5d442",
  白: "#f8fafc",
};

export function gelColor(gel: string): string {
  if (!gel) return "#94a3b8";
  const key = Object.keys(GEL_HEX).find((k) => gel.includes(k));
  return key ? GEL_HEX[key] : gel.startsWith("#") ? gel : "#94a3b8";
}

interface StageMapProps {
  fixtures: Fixture[];
  activeCue?: Cue | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  editable?: boolean;
  height?: number;
}

/** 舞台平面灯位图：上方为面光桥，下方为舞台区 */
export function StageMap({ fixtures, activeCue, selectedId, onSelect, onMove, editable, height = 340 }: StageMapProps) {
  const activeIds = new Set(activeCue?.fixtureIds ?? []);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!editable || !onMove) return;
    const id = e.dataTransfer.getData("text/fixture-id");
    if (!id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    onMove(id, Math.max(2, Math.min(98, x)), Math.max(4, Math.min(96, y)));
  };

  const unplaced = fixtures.filter((f) => f.x === null || f.y === null);

  return (
    <div className="stage-wrap">
      <div
        className="stage"
        style={{ height }}
        onDragOver={(e) => editable && e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="stage-label">舞 台 平 面 图</div>
        <div className="stage-zone front">面光桥 / FOH</div>
        <div className="stage-zone audience">观众席方向 ↓</div>
        {fixtures
          .filter((f) => f.x !== null && f.y !== null)
          .map((f) => {
            const lit = activeIds.has(f.id);
            const dim = activeCue ? !lit : false;
            return (
              <button
                key={f.id}
                className={`lamp ${lit ? "lit" : ""} ${dim ? "dim" : ""} ${selectedId === f.id ? "sel" : ""}`}
                style={{
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  background: lit ? gelColor(f.gel) : "#e2e8f0",
                  borderColor: gelColor(f.gel),
                  boxShadow: lit ? `0 0 16px 4px ${gelColor(f.gel)}` : undefined,
                }}
                title={`${f.code}${f.channelNo ? ` · CH ${f.channelNo}` : ""}${f.gel ? ` · ${f.gel}` : ""}`}
                draggable={editable}
                onDragStart={(e) => editable && e.dataTransfer.setData("text/fixture-id", f.id)}
                onClick={() => onSelect?.(f.id)}
              >
                {f.code}
              </button>
            );
          })}
      </div>
      {unplaced.length > 0 && (
        <div className="unplaced">
          <b>待定位灯具（拖入舞台或在表单补坐标）：</b>
          {unplaced.map((f) => (
            <span
              key={f.id}
              className={`unplaced-chip ${selectedId === f.id ? "sel" : ""}`}
              draggable={editable}
              onDragStart={(e) => editable && e.dataTransfer.setData("text/fixture-id", f.id)}
              onClick={() => onSelect?.(f.id)}
            >
              <i style={{ background: gelColor(f.gel) }} />
              {f.code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
