// Cue 表：触发顺序、每台灯亮度、通道负载占用、失效作废重算
import { useMemo, useState } from "react";
import { cueLoad, cueStatus, recomputeCue } from "../lib/compute";
import { useDesk } from "../lib/store";
import { Badge, EmptyState, Field, Modal, MissingTag } from "./ui";
import type { Cue, Fixture } from "../lib/types";

export function CuesTab() {
  const { state, activeShowId, submit, recomputeAllCues } = useDesk();
  const [editing, setEditing] = useState<Cue | null | undefined>(undefined);

  const show = activeShowId ? state.shows[activeShowId] : null;

  const cues = useMemo(
    () =>
      Object.values(state.cues)
        .filter((c) => c.showId === activeShowId)
        .sort((a, b) => a.number - b.number),
    [state.cues, activeShowId]
  );

  const fixtures = useMemo(
    () =>
      Object.values(state.fixtures)
        .filter((f) => f.showId === activeShowId)
        .sort((a, b) => (a.channel ?? 999) - (b.channel ?? 999)),
    [state.fixtures, activeShowId]
  );

  if (!show) {
    return (
      <section className="panel">
        <EmptyState title="尚未选择演出" hint="先在「演出」页建一场演出。" />
      </section>
    );
  }

  const invalidCount = cues.filter((c) => cueStatus(c, state.fixtures).invalid).length;

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>{show.name}</p>
            <h2>Cue 表</h2>
          </div>
          <div className="heading-actions">
            {invalidCount > 0 && (
              <Badge tone="red">{invalidCount} 条待重算</Badge>
            )}
            <button onClick={() => void recomputeAllCues()}>全部重算</button>
            <button className="primary" onClick={() => setEditing(null)}>
              新增 Cue
            </button>
          </div>
        </div>

        {cues.length === 0 ? (
          <EmptyState title="还没有 Cue" hint="新增 Cue，设置触发顺序和每台灯的亮度。" />
        ) : (
          <div className="cue-list">
            {cues.map((c) => {
              const status = cueStatus(c, state.fixtures);
              const loads = cueLoad(c, state.fixtures, show.channelLoads ?? {});
              return (
                <article key={c.id} className={status.invalid ? "cue-card invalid" : "cue-card"}>
                  <div className="cue-head">
                    <div className="cue-num">Cue {c.number}</div>
                    <div className="cue-title">
                      <h3>
                        {c.label || "未命名 Cue"}
                        {c.missingFields?.map((f) => <MissingTag key={f} />)}
                      </h3>
                      {c.notes && <p className="muted">{c.notes}</p>}
                    </div>
                    <div className="cue-actions">
                      {status.invalid ? (
                        <Badge tone="red">已作废 · {status.reasons.length} 处</Badge>
                      ) : (
                        <Badge tone="green">有效</Badge>
                      )}
                      <button onClick={() => setEditing(c)}>编辑</button>
                      <button
                        className="danger"
                        onClick={() => {
                          if (confirm(`删除 Cue ${c.number}？`)) {
                            void submit("cue", c.id, "delete", {});
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {status.invalid && (
                    <div className="cue-reasons">
                      {status.reasons.map((r, i) => (
                        <span key={i} className="reason">
                          {r}
                        </span>
                      ))}
                      <button
                        className="primary small"
                        onClick={() =>
                          void submit("cue", c.id, "upsert", recomputeCue(c, state.fixtures) as unknown as Record<string, unknown>)
                        }
                      >
                        重算负载
                      </button>
                    </div>
                  )}

                  <div className="cue-states">
                    {c.states.length === 0 && <span className="muted">未设置灯具状态</span>}
                    {c.states.map((st) => {
                      const f = state.fixtures[st.fixtureId];
                      if (!f) return null;
                      return (
                        <span key={st.fixtureId} className="state-chip">
                          {f.number}
                          <b>{st.brightness}%</b>
                        </span>
                      );
                    })}
                  </div>

                  {loads.length > 0 && (
                    <div className="load-bars">
                      {loads.map((l) => (
                        <div key={l.channel} className="load-row">
                          <span className="load-label">CH{l.channel}</span>
                          <div className="load-track">
                            <div
                              className={l.over ? "load-fill over" : "load-fill"}
                              style={{ width: `${Math.min(100, l.rated ? (l.watts / l.rated) * 100 : 0)}%` }}
                            />
                          </div>
                          <span className={l.over ? "load-text over" : "load-text"}>
                            {l.watts}W{l.rated != null ? ` / ${l.rated}W` : " / 未设额定"}
                            {l.over && " · 过载"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {editing !== undefined && (
        <CueForm
          initial={editing}
          showId={show.id}
          fixtures={fixtures}
          onClose={() => setEditing(undefined)}
          onSubmit={async (entity) => {
            await submit("cue", editing?.id ?? null, "upsert", entity);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}

function CueForm({ initial, showId, fixtures, onClose, onSubmit }: {
  initial: Cue | null;
  showId: string;
  fixtures: Fixture[];
  onClose: () => void;
  onSubmit: (entity: Record<string, unknown>) => Promise<void>;
}) {
  const [number, setNumber] = useState(initial?.number ?? (fixtures.length ? 1 : 1));
  const [label, setLabel] = useState(initial?.label ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [levels, setLevels] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const st of initial?.states ?? []) init[st.fixtureId] = st.brightness;
    return init;
  });

  const toggle = (id: string, on: boolean) => {
    setLevels((prev) => {
      const next = { ...prev };
      if (on) next[id] = fixtures.find((f) => f.id === id)?.brightness ?? 80;
      else delete next[id];
      return next;
    });
  };

  const save = () => {
    const states = Object.entries(levels).map(([fixtureId, brightness]) => ({ fixtureId, brightness: Number(brightness) }));
    const draft: Cue = {
      id: initial?.id ?? "",
      showId,
      number: Number(number),
      label: label.trim(),
      notes: notes.trim(),
      states,
      revs: {},
      createdAt: initial?.createdAt ?? 0,
      updatedAt: 0,
      version: initial?.version ?? 0,
    };
    // 保存即重算：固化当前灯具 rev，Cue 从有效开始
    const recomputed = recomputeCue(draft, Object.fromEntries(fixtures.map((f) => [f.id, f])));
    const entity = {
      showId,
      number: recomputed.number,
      label: recomputed.label,
      notes: recomputed.notes,
      states: recomputed.states,
      revs: recomputed.revs,
    };
    void onSubmit(entity);
  };

  return (
    <Modal
      title={initial ? "编辑 Cue" : "新增 Cue"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save}>
            保存并重算
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field-grid">
          <Field label="触发顺序（Cue 号）">
            <input type="number" value={number} onChange={(e) => setNumber(Number(e.target.value))} />
          </Field>
          <Field label="Cue 标签">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如：冷蓝侧光" />
          </Field>
        </div>
        <Field label="版本备注">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="例如：二幕开场" />
        </Field>
        <Field label="灯具状态（勾选并设置亮度 0–100%）">
          <div className="cue-states-editor">
            {fixtures.length === 0 && <p className="muted">先挂灯具才能编排 Cue。</p>}
            {fixtures.map((f) => {
              const on = f.id in levels;
              return (
                <div key={f.id} className={on ? "state-row on" : "state-row"}>
                  <label className="state-check">
                    <input type="checkbox" checked={on} onChange={(e) => toggle(f.id, e.target.checked)} />
                    <span>
                      {f.number}
                      <small>
                        {f.channel != null ? `CH${f.channel}` : "未设通道"} · {f.gel || "无色片"} · {f.position || "未设焦点"}
                      </small>
                    </span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!on}
                    value={levels[f.id] ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLevels((prev) => ({ ...prev, [f.id]: v }));
                    }}
                  />
                </div>
              );
            })}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
