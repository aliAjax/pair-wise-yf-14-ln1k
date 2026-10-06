import { useState } from "react";
import type { Channel, Cue, Fixture, FixtureType, Show } from "../types";
import { FIXTURE_TYPES } from "../types";

export function Field({ label, missing, children }: { label: string; missing?: boolean; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>
        {label}
        {missing && <em className="miss-tag">待补</em>}
      </span>
      {children}
    </label>
  );
}

export const inputCls = (missing?: boolean) => (missing ? "missing" : "");

/* ---------------- 演出 ---------------- */

export function ShowForm({ show, onSave, onCancel }: { show: Show; onSave: (s: Show) => void; onCancel?: () => void }) {
  const [name, setName] = useState(show.name);
  const [note, setNote] = useState(show.note);
  return (
    <div className="form-grid">
      <Field label="演出名称" missing={!show.name.trim()}>
        <input className={inputCls(!show.name.trim())} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="演出版本备注">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="版本B / 排练调整说明" />
      </Field>
      <div className="form-actions">
        <button className="primary" onClick={() => onSave({ ...show, name: name.trim() || show.name, note })}>
          保存演出
        </button>
        {onCancel && <button onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}

/* ---------------- 通道 ---------------- */

export function ChannelForm({ channel, onSave, onCancel }: { channel: Channel; onSave: (c: Channel) => void; onCancel?: () => void }) {
  const [no, setNo] = useState(channel.no);
  const [rated, setRated] = useState(channel.ratedLoad === null ? "" : String(channel.ratedLoad));
  return (
    <div className="form-grid">
      <Field label="通道号" missing={!channel.no}>
        <input value={no} onChange={(e) => setNo(e.target.value)} />
      </Field>
      <Field label="额定负载 (W)" missing={channel.ratedLoad === null}>
        <input className={inputCls(channel.ratedLoad === null)} type="number" value={rated} onChange={(e) => setRated(e.target.value)} placeholder="如 2000" />
      </Field>
      <div className="form-actions">
        <button
          className="primary"
          onClick={() => onSave({ ...channel, no: no.trim(), ratedLoad: rated === "" ? null : Number(rated) })}
        >
          保存通道
        </button>
        {onCancel && <button onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}

/* ---------------- 灯具 ---------------- */

export function fixtureMissing(f: Fixture): string[] {
  const miss: string[] = [];
  if (!f.channelNo) miss.push("通道号");
  if (!f.type) miss.push("类型");
  if (!f.gel.trim()) miss.push("色片");
  if (f.x === null || f.y === null) miss.push("灯位");
  if (!f.focus.trim()) miss.push("焦点");
  if (f.brightness === null) miss.push("亮度");
  if (f.power === null) miss.push("功率");
  return miss;
}

export function FixtureForm({ fixture, onSave, onCancel, onDelete }: { fixture: Fixture; onSave: (f: Fixture) => void; onCancel?: () => void; onDelete?: () => void }) {
  const [f, setF] = useState<Fixture>(fixture);
  const set = <K extends keyof Fixture>(k: K, v: Fixture[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const miss = fixtureMissing(f);
  return (
    <div className="form-grid">
      <Field label="灯具编号" missing={!f.code.trim()}>
        <input value={f.code} onChange={(e) => set("code", e.target.value)} />
      </Field>
      <Field label="通道号" missing={!f.channelNo}>
        <input className={inputCls(!f.channelNo)} value={f.channelNo ?? ""} onChange={(e) => set("channelNo", e.target.value || null)} placeholder="如 021" />
      </Field>
      <Field label="灯位类型" missing={!f.type}>
        <select className={inputCls(!f.type)} value={f.type} onChange={(e) => set("type", e.target.value as FixtureType | "")}>
          <option value="">待选择…</option>
          {FIXTURE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="色片" missing={!f.gel.trim()}>
        <input className={inputCls(!f.gel.trim())} value={f.gel} onChange={(e) => set("gel", e.target.value)} placeholder="冷蓝 / 暖白 / #色号" />
      </Field>
      <Field label="焦点位置" missing={!f.focus.trim()}>
        <input className={inputCls(!f.focus.trim())} value={f.focus} onChange={(e) => set("focus", e.target.value)} placeholder="门口 / 全台" />
      </Field>
      <Field label="亮度预设 (%)" missing={f.brightness === null}>
        <input className={inputCls(f.brightness === null)} type="number" min={0} max={100} value={f.brightness ?? ""} onChange={(e) => set("brightness", e.target.value === "" ? null : Number(e.target.value))} />
      </Field>
      <Field label="功率 (W)" missing={f.power === null}>
        <input className={inputCls(f.power === null)} type="number" value={f.power ?? ""} onChange={(e) => set("power", e.target.value === "" ? null : Number(e.target.value))} />
      </Field>
      <Field label="灯位坐标 X / Y" missing={f.x === null || f.y === null}>
        <div className="xy">
          <input className={inputCls(f.x === null)} type="number" min={0} max={100} value={f.x ?? ""} onChange={(e) => set("x", e.target.value === "" ? null : Number(e.target.value))} placeholder="X" />
          <input className={inputCls(f.y === null)} type="number" min={0} max={100} value={f.y ?? ""} onChange={(e) => set("y", e.target.value === "" ? null : Number(e.target.value))} placeholder="Y" />
        </div>
      </Field>
      <div className="form-actions">
        <button className="primary" onClick={() => onSave({ ...f, updatedAt: Date.now() })}>
          保存灯具
        </button>
        {onCancel && <button onClick={onCancel}>取消</button>}
        {onDelete && (
          <button className="danger" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
      {miss.length > 0 && <p className="miss-line">待补全：{miss.join("、")}</p>}
    </div>
  );
}

/* ---------------- Cue ---------------- */

export function CueForm({ cue, fixtures, onSave, onCancel, onDelete }: { cue: Cue; fixtures: Fixture[]; onSave: (c: Cue) => void; onCancel?: () => void; onDelete?: () => void }) {
  const [c, setC] = useState<Cue>(cue);
  const toggleFx = (id: string) =>
    setC((prev) => ({ ...prev, fixtureIds: prev.fixtureIds.includes(id) ? prev.fixtureIds.filter((x) => x !== id) : [...prev.fixtureIds, id] }));
  return (
    <div className="form-grid">
      <Field label="Cue 号" missing={!c.no.trim()}>
        <input value={c.no} onChange={(e) => setC((prev) => ({ ...prev, no: e.target.value }))} />
      </Field>
      <Field label="Cue 名称" missing={!c.name.trim()}>
        <input value={c.name} onChange={(e) => setC((prev) => ({ ...prev, name: e.target.value }))} />
      </Field>
      <Field label="备注">
        <input value={c.note} onChange={(e) => setC((prev) => ({ ...prev, note: e.target.value }))} placeholder="二幕开场 / 需走位确认" />
      </Field>
      <Field label={`点亮灯具（已选 ${c.fixtureIds.length}）`}>
        <div className="fx-picker">
          {fixtures.length === 0 && <span className="muted">暂无灯具</span>}
          {fixtures.map((f) => (
            <button key={f.id} type="button" className={c.fixtureIds.includes(f.id) ? "pick on" : "pick"} onClick={() => toggleFx(f.id)}>
              {f.code}
            </button>
          ))}
        </div>
      </Field>
      <div className="form-actions">
        <button className="primary" onClick={() => onSave({ ...c, updatedAt: Date.now() })}>
          保存 Cue
        </button>
        {onCancel && <button onClick={onCancel}>取消</button>}
        {onDelete && (
          <button className="danger" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </div>
  );
}
