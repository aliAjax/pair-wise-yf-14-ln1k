// 工作台总览
import { useMemo } from "react";
import { ENTITY_LABELS, entityDisplayName } from "../lib/ledger";
import { useDesk } from "../lib/store";
import { Badge } from "./ui";
import { MigrationBanner } from "./MigrationBanner";
import type { Tab } from "./TopBar";

export function OverviewTab({ go }: { go: (t: Tab) => void }) {
  const { state, events, pendingCount, openConflictCount, queuedCount, role } = useDesk();

  const recent = useMemo(
    () =>
      [...events]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 8)
        .map((ev) => {
          const obj = state[`${ev.entity}s` as "shows"][ev.entityId] as unknown as Record<string, unknown> | undefined;
          return {
            id: ev.id,
            text: `${ENTITY_LABELS[ev.entity]} · ${entityDisplayName(ev.entity, obj)}`,
            op: ev.op === "delete" ? "删除" : ev.baseVersion ? "编辑" : "新增",
            author: ev.author,
            ts: ev.ts,
          };
        }),
    [events, state]
  );

  const metrics = [
    { label: "演出", value: Object.keys(state.shows).length, tone: "var(--primary)" },
    { label: "灯具", value: Object.keys(state.fixtures).length, tone: "var(--secondary)" },
    { label: "Cue", value: Object.keys(state.cues).length, tone: "var(--accent)" },
    { label: "待审稿", value: pendingCount, tone: pendingCount ? "#b45309" : "#64748b" },
    { label: "未决冲突", value: openConflictCount, tone: openConflictCount ? "#b91c1c" : "#64748b" },
    { label: "断网排队", value: queuedCount, tone: queuedCount ? "#0e7490" : "#64748b" },
  ];

  return (
    <div className="stack">
      <MigrationBanner />

      <section className="hero compact-hero">
        <p>离线账本 · 先到先入库 · 后到列冲突</p>
        <h1>地下库房也能续作的灯光排程台</h1>
        <span>
          演出、灯具、Cue 共用一本本地账，断网照改不误；回到主控台导入副本即合并，
          已合并的内容不重复。灯位或色片一变，相关 Cue 自动作废、按通道额定负载重算。
          当前身份：<b>{role === "operator" ? "主控台操作员（可发布）" : "灯光师（提交进待审稿）"}</b>
        </span>
      </section>

      <section className="metrics metrics-6">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong style={{ color: m.tone }}>{m.value}</strong>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>快速开始</p>
            <h2>今天排练要做什么</h2>
          </div>
        </div>
        <div className="quick-grid">
          <button className="quick-card" onClick={() => go("shows")}>
            <b>① 建演出</b>
            <span>登记演出名称与版本备注，一本账管到底</span>
          </button>
          <button className="quick-card" onClick={() => go("fixtures")}>
            <b>② 挂灯具</b>
            <span>通道号、色片、灯位、额定负载，随改随算</span>
          </button>
          <button className="quick-card" onClick={() => go("cues")}>
            <b>③ 排 Cue</b>
            <span>触发顺序 + 每台灯亮度，通道负载自动汇总</span>
          </button>
          <button className="quick-card" onClick={() => go("sync")}>
            <b>④ 带回来</b>
            <span>导出账本副本，回主控台合并重试不重复</span>
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>账本流水</p>
            <h2>最近入账</h2>
          </div>
          <Badge tone="slate">共 {events.length} 条事件</Badge>
        </div>
        {recent.length === 0 ? (
          <p className="muted">还没有任何记录，从建第一场演出开始。</p>
        ) : (
          <div className="ledger-list">
            {recent.map((r) => (
              <div key={r.id} className="ledger-row">
                <Badge tone={r.op === "新增" ? "green" : r.op === "删除" ? "red" : "violet"}>{r.op}</Badge>
                <span className="ledger-text">{r.text}</span>
                <span className="ledger-author">{r.author}</span>
                <span className="ledger-time">
                  {new Date(r.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
