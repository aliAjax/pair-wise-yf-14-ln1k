// 演出管理
import { useState } from "react";
import { useDesk } from "../lib/store";
import { Badge, EmptyState, Field, Modal, MissingTag } from "./ui";
import type { Show } from "../lib/types";

export function ShowsTab() {
  const { state, activeShowId, setActiveShowId, submit, role } = useDesk();
  const [editing, setEditing] = useState<Show | null | undefined>(undefined);

  const shows = Object.values(state.shows).sort((a, b) => b.updatedAt - a.updatedAt);

  const counts = (showId: string) => ({
    fixtures: Object.values(state.fixtures).filter((f) => f.showId === showId).length,
    cues: Object.values(state.cues).filter((c) => c.showId === showId).length,
  });

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>演出账本</p>
            <h2>演出列表</h2>
          </div>
          <button className="primary" onClick={() => setEditing(null)}>
            新增演出
          </button>
        </div>
        {shows.length === 0 ? (
          <EmptyState title="还没有演出" hint="新增第一场演出，灯具和 Cue 都会挂在它名下。" />
        ) : (
          <div className="show-grid">
            {shows.map((s) => {
              const c = counts(s.id);
              const active = s.id === activeShowId;
              return (
                <article key={s.id} className={active ? "show-card active" : "show-card"}>
                  <div className="show-card-head">
                    <h3>{s.name}</h3>
                    {active && <Badge tone="green">当前</Badge>}
                  </div>
                  <p className="show-notes">{s.notes || "（无版本备注）"}</p>
                  <div className="show-meta">
                    <span>灯具 {c.fixtures}</span>
                    <span>Cue {c.cues}</span>
                    {s.missingFields?.map((f) => <MissingTag key={f} />)}
                  </div>
                  <div className="show-actions">
                    <button onClick={() => setActiveShowId(s.id)} disabled={active}>
                      {active ? "已选中" : "打开"}
                    </button>
                    <button onClick={() => setEditing(s)}>编辑</button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`删除演出「${s.name}」？其下灯具与 Cue 不会自动删除，但会失去归属。`)) {
                          void submit("show", s.id, "delete", {});
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {role === "designer" && (
          <p className="muted hint">灯光师提交将进入待审稿，由主控台操作员发布。</p>
        )}
      </section>

      {editing !== undefined && (
        <ShowForm
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSubmit={async (entity) => {
            await submit("show", editing?.id ?? null, editing ? "upsert" : "upsert", entity);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}

function ShowForm({ initial, onClose, onSubmit }: {
  initial: Show | null;
  onClose: () => void;
  onSubmit: (entity: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <Modal
      title={initial ? "编辑演出" : "新增演出"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() =>
              void onSubmit({
                name: name.trim(),
                notes: notes.trim(),
                channelLoads: initial?.channelLoads ?? {},
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="form-stack">
        <Field label="演出名称">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：《第十二夜》巡演版" />
        </Field>
        <Field label="版本备注">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="例如：版本B · 二幕换景" />
        </Field>
      </div>
    </Modal>
  );
}
