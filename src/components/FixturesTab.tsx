// 灯具管理：灯位、色片、通道、额定负载；变更即触发 Cue 作废重算
import { useMemo, useState } from "react";
import { deepEqual } from "../lib/ledger";
import { channelSummary } from "../lib/compute";
import { useDesk } from "../lib/store";
import { StageMap } from "./StageMap";
import { Badge, EmptyState, Field, Modal, MissingTag } from "./ui";
import type { Fixture } from "../lib/types";

const AREAS = ["面光", "侧光", "逆光", "效果光"];
const REV_FIELDS = ["channel", "gel", "position", "area", "ratedLoad"] as const;

export function FixturesTab() {
  const { state, activeShowId, submit } = useDesk();
  const [area, setArea] = useState<string>("全部");
  const [editing, setEditing] = useState<Fixture | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const show = activeShowId ? state.shows[activeShowId] : null;

  const fixtures = useMemo(
    () =>
      Object.values(state.fixtures)
        .filter((f) => f.showId === activeShowId)
        .sort((a, b) => (a.channel ?? 999) - (b.channel ?? 999) || a.number.localeCompare(b.number)),
    [state.fixtures, activeShowId]
  );

  const filtered = area === "全部" ? fixtures : fixtures.filter((f) => f.area === area);
  const areas = useMemo(() => {
    const set = new Set(fixtures.map((f) => f.area).filter(Boolean));
    return ["全部", ...AREAS.filter((a) => set.has(a)), ...[...set].filter((a) => !AREAS.includes(a))];
  }, [fixtures]);

  const summary = useMemo(
    () => channelSummary(fixtures, show?.channelLoads ?? {}),
    [fixtures, show]
  );

  if (!show) {
    return (
      <section className="panel">
        <EmptyState title="尚未选择演出" hint="先在「演出」页建一场演出，再来挂灯具。" />
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>{show.name}</p>
            <h2>舞台灯位图</h2>
          </div>
          <button className="primary" onClick={() => setEditing(null)}>
            新增灯具
          </button>
        </div>
        <StageMap fixtures={fixtures} selectedId={selectedId} onSelect={setSelectedId} />
        <p className="muted hint">点击灯位可选中；灯光明暗按亮度百分比显示，颜色按色片匹配。</p>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>通道额定负载</p>
            <h2>通道负载表</h2>
          </div>
          <Badge tone="slate">过载时 Cue 页会标红</Badge>
        </div>
        {summary.length === 0 ? (
          <p className="muted">挂了灯具后在这里设置每个通道的额定负载（瓦）。</p>
        ) : (
          <div className="channel-grid">
            {summary.map((s) => (
              <label key={s.channel} className="channel-load">
                <span>
                  CH{s.channel}
                  <small>
                    {s.count} 台灯 · 合计 {s.totalRated}W
                  </small>
                </span>
                <input
                  type="number"
                  min={0}
                  placeholder="额定负载 W"
                  defaultValue={s.rated ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value;
                    const next = { ...(show.channelLoads ?? {}) };
                    if (v === "") delete next[s.channel];
                    else next[s.channel] = Number(v);
                    if (!deepEqual(next, show.channelLoads ?? {})) {
                      void submit("show", show.id, "upsert", {
                        name: show.name,
                        notes: show.notes,
                        channelLoads: next,
                      });
                    }
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>灯具台账</p>
            <h2>灯具列表</h2>
          </div>
          <div className="chips">
            {areas.map((a) => (
              <button key={a} className={area === a ? "chip active" : "chip"} onClick={() => setArea(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="没有灯具" hint="新增灯具，或换个灯区筛选。" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>通道</th>
                  <th>色片</th>
                  <th>灯区</th>
                  <th>焦点位置</th>
                  <th>亮度</th>
                  <th>额定负载</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} className={f.id === selectedId ? "row-selected" : ""}>
                    <td>
                      <b>{f.number}</b>
                      {f.missingFields?.length ? <MissingTag /> : null}
                    </td>
                    <td>{f.channel != null ? `CH${f.channel}` : "—"}</td>
                    <td>{f.gel || <span className="muted">未设</span>}</td>
                    <td>{f.area || "—"}</td>
                    <td>{f.position || <span className="muted">未设</span>}</td>
                    <td>{f.brightness}%</td>
                    <td>{f.ratedLoad != null ? `${f.ratedLoad}W` : <span className="muted">待补全</span>}</td>
                    <td className="row-actions">
                      <button onClick={() => { setSelectedId(f.id); setEditing(f); }}>编辑</button>
                      <button
                        className="danger"
                        onClick={() => {
                          if (confirm(`删除灯具 ${f.number}？相关 Cue 会标记作废。`)) {
                            void submit("fixture", f.id, "delete", {});
                          }
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing !== undefined && (
        <FixtureForm
          initial={editing}
          showId={show.id}
          onClose={() => setEditing(undefined)}
          onSubmit={async (entity) => {
            await submit("fixture", editing?.id ?? null, "upsert", entity);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}

function FixtureForm({ initial, showId, onClose, onSubmit }: {
  initial: Fixture | null;
  showId: string;
  onClose: () => void;
  onSubmit: (entity: Record<string, unknown>) => Promise<void>;
}) {
  const [number, setNumber] = useState(initial?.number ?? "");
  const [channel, setChannel] = useState<string>(initial?.channel != null ? String(initial.channel) : "");
  const [gel, setGel] = useState(initial?.gel ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [brightness, setBrightness] = useState(initial?.brightness ?? 80);
  const [ratedLoad, setRatedLoad] = useState<string>(initial?.ratedLoad != null ? String(initial.ratedLoad) : "");
  const [x, setX] = useState(initial?.x ?? 50);
  const [y, setY] = useState(initial?.y ?? 50);

  const revChanged =
    initial != null &&
    REV_FIELDS.some((k) => {
      const nextVal =
        k === "channel"
          ? channel === ""
            ? null
            : Number(channel)
          : k === "ratedLoad"
            ? ratedLoad === ""
              ? null
              : Number(ratedLoad)
            : { gel, area, position }[k as "gel" | "area" | "position"];
      return !deepEqual(nextVal, initial[k]);
    });

  const save = () => {
    const entity = {
      showId,
      number: number.trim(),
      channel: channel === "" ? null : Number(channel),
      gel: gel.trim(),
      area: area.trim(),
      position: position.trim(),
      brightness: Number(brightness),
      ratedLoad: ratedLoad === "" ? null : Number(ratedLoad),
      x: Number(x),
      y: Number(y),
      // 灯位/色片/通道/负载一变，版本号 +1，相关 Cue 自动作废
      rev: initial ? (revChanged ? initial.rev + 1 : initial.rev) : 1,
    };
    void onSubmit(entity);
  };

  return (
    <Modal
      title={initial ? "编辑灯具" : "新增灯具"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!number.trim()} onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field-grid">
          <Field label="灯具编号">
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="例如：L01" />
          </Field>
          <Field label="通道号">
            <input type="number" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="例如：21" />
          </Field>
          <Field label="色片">
            <input value={gel} onChange={(e) => setGel(e.target.value)} placeholder="例如：冷蓝" />
          </Field>
          <Field label="灯区">
            <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="面光 / 侧光 / 逆光 / 效果光" list="area-list" />
            <datalist id="area-list">
              {AREAS.map((a) => <option key={a} value={a} />)}
            </datalist>
          </Field>
          <Field label="焦点位置">
            <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="例如：台口左" />
          </Field>
          <Field label="亮度预设 (%)">
            <input type="number" min={0} max={100} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
          </Field>
          <Field label="额定负载 (W)">
            <input type="number" min={0} value={ratedLoad} onChange={(e) => setRatedLoad(e.target.value)} placeholder="灯具瓦数，迁移期可后补" />
          </Field>
        </div>
        <Field label={`灯位坐标（舞台平面 X: ${x}% / Y: ${y}%）`}>
          <input
            type="range"
            min={2}
            max={98}
            value={x}
            onChange={(e) => setX(Number(e.target.value))}
          />
        </Field>
        <Field label=" ">
          <input
            type="range"
            min={4}
            max={56}
            value={y}
            onChange={(e) => setY(Number(e.target.value))}
          />
        </Field>
        {revChanged && (
          <p className="muted warn-text">检测到灯位/色片/通道/负载变更，保存后相关 Cue 将作废重算。</p>
        )}
      </div>
    </Modal>
  );
}
