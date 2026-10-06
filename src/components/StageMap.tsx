// 舞台平面灯位图
import type { Fixture } from "../lib/types";

const GEL_COLORS: Record<string, string> = {
  冷蓝: "#3b82f6",
  深蓝: "#1d4ed8",
  琥珀: "#f59e0b",
  暖白: "#fde68a",
  白: "#f8fafc",
  红: "#ef4444",
  绿: "#22c55e",
  紫: "#a855f7",
  粉: "#f472b6",
  青: "#06b6d4",
};

export function gelColor(gel: string): string {
  if (!gel) return "#94a3b8";
  for (const key of Object.keys(GEL_COLORS)) {
    if (gel.includes(key)) return GEL_COLORS[key];
  }
  return "#94a3b8";
}

export function StageMap({
  fixtures,
  selectedId,
  onSelect,
}: {
  fixtures: Fixture[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <svg viewBox="0 0 100 60" className="stage-map" role="img" aria-label="舞台灯位图">
      <rect x="1" y="1" width="98" height="58" rx="3" fill="#0f172a" stroke="#334155" />
      {/* 台口 */}
      <line x1="8" y1="50" x2="92" y2="50" stroke="#475569" strokeWidth="0.6" strokeDasharray="2 1.5" />
      <text x="50" y="56" textAnchor="middle" fontSize="3" fill="#64748b">
        台口 / 观众席
      </text>
      {/* 吊杆 */}
      <line x1="8" y1="12" x2="92" y2="12" stroke="#1e293b" strokeWidth="1" />
      <line x1="8" y1="30" x2="92" y2="30" stroke="#1e293b" strokeWidth="1" />
      {fixtures.map((f) => {
        if (f.channel == null) return null;
        const color = gelColor(f.gel);
        const selected = f.id === selectedId;
        return (
          <g
            key={f.id}
            transform={`translate(${f.x}, ${f.y})`}
            className={onSelect ? "stage-light" : undefined}
            onClick={() => onSelect?.(f.id)}
          >
            <circle r={selected ? 3.2 : 2.4} fill={color} opacity={0.25 + 0.75 * (f.brightness / 100)} />
            <circle r={selected ? 3.2 : 2.4} fill="none" stroke={selected ? "#fff" : color} strokeWidth="0.5" />
            <text y={-3.2} textAnchor="middle" fontSize="2.6" fill="#cbd5e1">
              {f.number}
            </text>
            <title>{`${f.number} 号 · CH${f.channel} · ${f.gel || "无色片"} · ${f.position || "未设焦点"}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
