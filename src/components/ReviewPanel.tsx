import { useState } from "react";
import type { Changeset, DB, Publication, Role } from "../types";
import type { MergeResult } from "../ledger";

const FIELD_LABELS: Record<string, string> = {
  _delete: "删除冲突",
  name: "名称",
  note: "备注",
  code: "灯具编号",
  channelNo: "通道号",
  type: "灯位类型",
  gel: "色片",
  x: "舞台X",
  y: "舞台Y",
  focus: "焦点位置",
  brightness: "亮度预设",
  power: "功率",
  no: "编号",
  ratedLoad: "额定负载",
  fixtureIds: "点亮灯具",
};

interface ReviewPanelProps {
  db: DB;
  showId: string;
  online: boolean;
  role: Role;
  userName: string;
  onRetryOutbox: () => void;
  onResolve: (cs: Changeset, decisions: Record<string, "master" | "incoming">) => void;
  onPublish: (note: string) => void;
  onDiscardChangeset: (cs: Changeset) => void;
  currentRev: number;
  publishedRev: number;
}

export function ReviewPanel(props: ReviewPanelProps) {
  const { db, role, online } = props;
  const [pubNote, setPubNote] = useState("");
  const conflictSets = db.changesets.filter((c) => c.status === "conflict" && c.showId === props.showId);
  const outbox = db.changesets.filter((c) => c.status === "outbox" && c.showId === props.showId).sort((a, b) => a.seq - b.seq);
  const merged = db.changesets.filter((c) => c.status === "merged" && c.showId === props.showId);
  const dirtyCueCount = db.cues.filter((c) => c.showId === props.showId && c.dirty).length;
  const pubs = db.publications.filter((p) => p.showId === props.showId);

  return (
    <div className="review-grid">
      <section className="panel">
        <div className="heading">
          <div>
            <p>断网续传</p>
            <h2>待合并发件箱（{outbox.length}）</h2>
          </div>
          <button className="primary" disabled={!online || outbox.length === 0} onClick={props.onRetryOutbox} title={online ? "按幂等键重试，已合并内容不重复" : "当前离线，联网后自动重试"}>
            {online ? "重试合并" : "离线中…"}
          </button>
        </div>
        <p className="muted small">断网提交的变更单暂存此处；联网后重试，已入库的操作按幂等键自动跳过，不会重复。</p>
        <ChangesetList items={outbox} mergedRev={undefined} />
      </section>

      <section className="panel conflict-panel">
        <div className="heading">
          <div>
            <p>主控台操作员裁决</p>
            <h2>提交冲突（{conflictSets.length}）</h2>
          </div>
        </div>
        {role !== "operator" && <p className="muted small">仅主控台操作员可裁决冲突，当前身份为灯光师（只读）。</p>}
        {conflictSets.length === 0 && <p className="muted">暂无冲突。两人同改一场演出时，先到的入库，晚到的字段级冲突会列在这里。</p>}
        {conflictSets.map((cs) => (
          <ConflictCard key={cs.id} cs={cs} canResolve={role === "operator"} onResolve={props.onResolve} onDiscard={() => props.onDiscardChangeset(cs)} />
        ))}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>主控台发布</p>
            <h2>已合并待审稿（{merged.filter((c) => (c.mergedRev ?? 0) > props.publishedRev).length}）</h2>
          </div>
        </div>
        <div className="publish-box">
          <div className="rev-line">
            当前台账 <b>v{props.currentRev}</b> · 已发布 <b>v{props.publishedRev}</b>
            {props.currentRev > props.publishedRev && <em className="pending-tag">有 {props.currentRev - props.publishedRev} 版待发布</em>}
            {dirtyCueCount > 0 && <em className="stale-tag">发布前建议先重算 {dirtyCueCount} 个作废 Cue</em>}
          </div>
          <input placeholder="发布备注（如：二幕联排版）" value={pubNote} onChange={(e) => setPubNote(e.target.value)} disabled={role !== "operator"} />
          <button className="primary" disabled={role !== "operator" || props.currentRev <= props.publishedRev} onClick={() => { props.onPublish(pubNote); setPubNote(""); }}>
            发布到主控台
          </button>
          {role !== "operator" && <p className="muted small">灯光师提交的改动经合并后进入待审稿，由主控台操作员发布。</p>}
        </div>
        <ChangesetList items={merged} mergedRev={props.publishedRev} />
        <PublicationList pubs={pubs} />
      </section>
    </div>
  );
}

function ChangesetList({ items, mergedRev }: { items: Changeset[]; mergedRev?: number }) {
  if (items.length === 0) return <p className="muted">无记录</p>;
  return (
    <div className="cs-list">
      {items.map((cs) => {
        const published = mergedRev !== undefined && (cs.mergedRev ?? 0) <= mergedRev;
        return (
          <div key={cs.id} className={`cs-item ${cs.status}`}>
            <div className="cs-main">
              <b>
                {cs.copyLabel} <span className="cs-author">· {cs.author}（{cs.role === "operator" ? "操作员" : "灯光师"}）</span>
              </b>
              <span className="muted small">
                基于 v{cs.baseRev} · {cs.ops.length} 项操作
                {cs.status === "merged" && <> · 入库 v{cs.mergedRev}（应用 {cs.appliedCount}，跳过重复 {cs.skippedCount}）{published ? " · 已随版发布" : " · 待发布"}</>}
                {cs.status === "outbox" && " · 等待联网合并"}
              </span>
            </div>
            <time>{new Date(cs.submittedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
          </div>
        );
      })}
    </div>
  );
}

function ConflictCard({
  cs,
  canResolve,
  onResolve,
  onDiscard,
}: {
  cs: Changeset;
  canResolve: boolean;
  onResolve: (cs: Changeset, decisions: Record<string, "master" | "incoming">) => void;
  onDiscard: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, "master" | "incoming">>({});
  const allDecided = cs.conflicts.every((c) => decisions[`${c.entityType}:${c.entityId}:${c.field}`]);
  const pick = (key: string, side: "master" | "incoming") => setDecisions((d) => ({ ...d, [key]: side }));

  return (
    <div className="conflict-card">
      <header>
        <b>
          {cs.copyLabel} · {cs.author} 晚到一步
        </b>
        <span className="muted small">
          副本基于 v{cs.baseRev}，主账已被先到提交推进；无冲突的 {cs.appliedCount} 项操作已先入库，{cs.conflicts.length} 个字段冲突待裁决（重复操作 {cs.skippedCount} 项自动跳过）
        </span>
      </header>
      <div className="conflict-rows">
        {cs.conflicts.map((c) => {
          const key = `${c.entityType}:${c.entityId}:${c.field}`;
          const side = decisions[key];
          return (
            <div key={key} className={`conflict-row ${side ? `picked-${side}` : ""}`}>
              <div className="conflict-what">
                <em>{c.label}</em>
                <span>{FIELD_LABELS[c.field] ?? c.field}</span>
              </div>
              <div className="conflict-base">
                <small>原值</small>
                <span>{c.base}</span>
              </div>
              <button type="button" className={`side master ${side === "master" ? "pick" : ""}`} disabled={!canResolve} onClick={() => pick(key, "master")}>
                <small>主账（先到）</small>
                <b>{c.master}</b>
              </button>
              <button type="button" className={`side incoming ${side === "incoming" ? "pick" : ""}`} disabled={!canResolve} onClick={() => pick(key, "incoming")}>
                <small>晚到提交</small>
                <b>{c.incoming}</b>
              </button>
            </div>
          );
        })}
      </div>
      {canResolve && (
        <div className="conflict-actions">
          <button className="primary" disabled={!allDecided} onClick={() => onResolve(cs, decisions)}>
            {allDecided ? "按裁决入库并重算" : "逐条裁决后才能入库"}
          </button>
          <button className="danger-text" onClick={onDiscard}>
            退回该提交
          </button>
        </div>
      )}
    </div>
  );
}

function PublicationList({ pubs }: { pubs: Publication[] }) {
  return (
    <div className="pub-list">
      <h4>发布记录</h4>
      {pubs.length === 0 && <p className="muted">尚未发布过。主控台操作员发布后，演出版本在此固化。</p>}
      {pubs.map((p) => (
        <div key={p.id} className="pub-item">
          <b>v{p.rev}</b>
          <span>{p.note || "（无备注）"}</span>
          <small className="muted">
            {p.by} · {new Date(p.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </small>
        </div>
      ))}
    </div>
  );
}

export type { MergeResult };
