// 冲突队列：先到的入库，后到的列出冲突，操作员裁决
import { ENTITY_LABELS, FIELD_LABELS, entityDisplayName } from "../lib/ledger";
import { useDesk } from "../lib/store";
import { Badge, EmptyState } from "./ui";
import type { ConflictRecord } from "../lib/types";

const SKIP_KEYS = new Set(["id", "version", "createdAt", "updatedAt", "rev", "revs", "missingFields"]);

function displayValue(key: string, value: unknown): string {
  if (value == null || value === "") return "（空）";
  if (key === "states" && Array.isArray(value)) return `${value.length} 个灯具状态`;
  if (key === "channelLoads" && typeof value === "object") {
    return Object.entries(value as Record<string, number>)
      .map(([ch, w]) => `CH${ch}:${w}W`)
      .join(" · ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ConflictCard({ c }: { c: ConflictRecord }) {
  const { resolveConflict } = useDesk();
  const current = c.current ?? {};
  const incoming = c.incoming;
  const keys = [
    ...new Set([...Object.keys(current), ...Object.keys(incoming)]),
  ].filter((k) => !SKIP_KEYS.has(k));

  return (
    <article className="conflict-card">
      <div className="conflict-head">
        <Badge tone="red">冲突</Badge>
        <b>
          {ENTITY_LABELS[c.entity]} · {entityDisplayName(c.entity, current as Record<string, unknown>)}
        </b>
        <span className="muted">
          后到批次：{c.event.author} ·{" "}
          {new Date(c.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <p className="conflict-fields">
        争议字段：{c.fields.map((f) => <Badge key={f} tone="amber">{f}</Badge>)}
      </p>
      <div className="diff-grid">
        <div className="diff-col">
          <h4>先到版本（已入库）</h4>
          {keys.map((k) => {
            const changed = !deepEqualish(current[k], incoming[k]);
            return (
              <div key={k} className={changed ? "diff-row changed" : "diff-row"}>
                <span>{FIELD_LABELS[k] ?? k}</span>
                <b>{displayValue(k, current[k])}</b>
              </div>
            );
          })}
        </div>
        <div className="diff-col">
          <h4>后到版本（待裁决）</h4>
          {keys.map((k) => {
            const changed = !deepEqualish(current[k], incoming[k]);
            return (
              <div key={k} className={changed ? "diff-row changed" : "diff-row"}>
                <span>{FIELD_LABELS[k] ?? k}</span>
                <b>{displayValue(k, incoming[k])}</b>
              </div>
            );
          })}
        </div>
      </div>
      <div className="conflict-actions">
        <button onClick={() => void resolveConflict(c, "keep")}>保留先到版本</button>
        <button className="primary" onClick={() => void resolveConflict(c, "accept")}>
          采用后到版本
        </button>
      </div>
    </article>
  );
}

function deepEqualish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

export function ConflictsTab() {
  const { conflicts } = useDesk();
  const open = conflicts.filter((c) => c.status === "open");
  const resolved = conflicts.filter((c) => c.status !== "open").sort((a, b) => b.ts - a.ts);

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>先到的入库，晚到的列这里</p>
            <h2>未决冲突</h2>
          </div>
        </div>
        {open.length === 0 ? (
          <EmptyState title="没有冲突" hint="两份副本改了同一场演出的同一字段时，冲突会列在这里。" />
        ) : (
          <div className="conflict-list">
            {open.map((c) => <ConflictCard key={c.id} c={c} />)}
          </div>
        )}
      </section>

      {resolved.length > 0 && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>裁决记录</p>
              <h2>已处理</h2>
            </div>
          </div>
          <div className="ledger-list">
            {resolved.map((c) => (
              <div key={c.id} className="ledger-row">
                <Badge tone={c.status === "accepted" ? "green" : "slate"}>
                  {c.status === "accepted" ? "已采用后到" : "已保留先到"}
                </Badge>
                <span className="ledger-text">
                  {ENTITY_LABELS[c.entity]} · {entityDisplayName(c.entity, (c.status === "accepted" ? c.incoming : c.current) as Record<string, unknown> | null)}
                </span>
                <span className="ledger-time">
                  {new Date(c.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
