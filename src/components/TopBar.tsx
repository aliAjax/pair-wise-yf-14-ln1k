// 顶栏：角色切换、联网状态、页签
import type { ReactNode } from "react";
import { useDesk } from "../lib/store";
import type { Role } from "../lib/types";

export type Tab = "overview" | "shows" | "fixtures" | "cues" | "review" | "conflicts" | "sync";

const TABS: { key: Tab; label: string; badge?: (s: ReturnType<typeof useDesk>) => number }[] = [
  { key: "overview", label: "工作台" },
  { key: "shows", label: "演出" },
  { key: "fixtures", label: "灯具" },
  { key: "cues", label: "Cue 表" },
  { key: "review", label: "待审稿", badge: (s) => s.pendingCount },
  { key: "conflicts", label: "冲突", badge: (s) => s.openConflictCount },
  { key: "sync", label: "同步" },
];

export function TopBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const desk = useDesk();
  const { role, setRole, online, pendingCount, openConflictCount, queuedCount } = desk;

  const switchRole = (r: Role) => {
    setRole(r);
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark">灯</span>
          <div>
            <strong>灯光排程台</strong>
            <small>离线账本 · 断网续作</small>
          </div>
        </div>

        <nav className="tabs">
          {TABS.map((t) => {
            const badge = t.badge?.(desk) ?? 0;
            return (
              <button
                key={t.key}
                className={tab === t.key ? "tab active" : "tab"}
                onClick={() => onTab(t.key)}
              >
                {t.label}
                {badge > 0 && <em className="tab-badge">{badge}</em>}
              </button>
            );
          })}
        </nav>

        <div className="topbar-right">
          <span className={online ? "online-dot" : "online-dot off"}>
            {online ? "在线" : "离线"}
            {queuedCount > 0 && <i>{queuedCount} 件排队</i>}
          </span>
          <div className="role-switch">
            <button
              className={role === "operator" ? "role active" : "role"}
              onClick={() => switchRole("operator")}
            >
              主控台操作员
            </button>
            <button
              className={role === "designer" ? "role active" : "role"}
              onClick={() => switchRole("designer")}
              title="灯光师的提交进入待审稿，由操作员发布"
            >
              灯光师
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function TabPage({ children }: { children: ReactNode }) {
  return <div className="tab-page">{children}</div>;
}
