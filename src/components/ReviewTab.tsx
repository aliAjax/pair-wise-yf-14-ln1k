// 待审稿：设计师提交在此排队，操作员发布或驳回
import { useMemo } from "react";
import { ENTITY_LABELS, entityDisplayName } from "../lib/ledger";
import { useDesk } from "../lib/store";
import { Badge, EmptyState } from "./ui";
import type { OutboxItem } from "../lib/types";

const STATUS_BADGE: Record<OutboxItem["status"], { tone: "amber" | "green" | "red" | "slate" | "cyan"; text: string }> = {
  pending: { tone: "amber", text: "待审稿" },
  queued: { tone: "cyan", text: "断网排队" },
  published: { tone: "green", text: "已发布" },
  partial: { tone: "amber", text: "部分冲突" },
  conflict: { tone: "red", text: "全部冲突" },
  rejected: { tone: "slate", text: "已驳回" },
};

export function ReviewTab() {
  const { outbox, state, role, approve, reject } = useDesk();

  const pending = outbox.filter((i) => i.status === "pending");
  const history = outbox
    .filter((i) => i.status !== "pending")
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);

  const eventText = (item: OutboxItem) =>
    item.events.map((ev) => {
      const obj = state[`${ev.entity}s` as "shows"][ev.entityId] as unknown as Record<string, unknown> | undefined;
      const name = ev.op === "delete" ? "（删除）" : entityDisplayName(ev.entity, obj);
      return `${ENTITY_LABELS[ev.entity]} ${name}`;
    });

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>其他人的改动</p>
            <h2>待审稿</h2>
          </div>
          <Badge tone={role === "operator" ? "green" : "slate"}>
            {role === "operator" ? "操作员可直接发布" : "你的提交需操作员发布"}
          </Badge>
        </div>
        {pending.length === 0 ? (
          <EmptyState title="待审稿为空" hint="灯光师身份提交的改动会先到这里，发布后才入账本。" />
        ) : (
          <div className="review-list">
            {pending.map((item) => (
              <article key={item.id} className="review-card">
                <div className="review-head">
                  <Badge tone="amber">待审稿</Badge>
                  <b>{item.label}</b>
                  <span className="muted">
                    {item.author} · {new Date(item.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <ul className="review-events">
                  {eventText(item).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
                {role === "operator" && (
                  <div className="review-actions">
                    <button className="primary" onClick={() => void approve(item)}>
                      发布入库
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("驳回这份待审稿？改动不会入账。")) void reject(item);
                      }}
                    >
                      驳回
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>处理记录</p>
            <h2>历史批次</h2>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="muted">还没有处理过批次。</p>
        ) : (
          <div className="ledger-list">
            {history.map((item) => {
              const b = STATUS_BADGE[item.status];
              return (
                <div key={item.id} className="ledger-row">
                  <Badge tone={b.tone}>{b.text}</Badge>
                  <span className="ledger-text">{item.label}</span>
                  <span className="ledger-author">{item.author}</span>
                  <span className="ledger-time">
                    {new Date(item.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
