// 通用 UI 小件
import type { ReactNode } from "react";

type Tone = "violet" | "amber" | "cyan" | "green" | "red" | "slate";

const TONE_COLORS: Record<Tone, string> = {
  violet: "#7c3aed",
  amber: "#b45309",
  cyan: "#0e7490",
  green: "#047857",
  red: "#b91c1c",
  slate: "#64748b",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: Tone }) {
  const color = TONE_COLORS[tone];
  return (
    <span
      className="badge"
      style={{
        color,
        borderColor: `${color}55`,
        background: `${color}14`,
      }}
    >
      {children}
    </span>
  );
}

export function MissingTag() {
  return <Badge tone="amber">待补全</Badge>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
    </div>
  );
}

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
