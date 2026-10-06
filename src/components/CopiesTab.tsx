import { useState } from "react";
import type { Channel, Cue, Fixture, Show, User, WorkingCopy } from "../types";
import { cuesOf, fixturesOf, channelsOf, uid } from "../ledger";
import type { DB } from "../types";
import { LedgerView } from "./LedgerView";
import { StageMap } from "./StageMap";
import { ChannelForm, CueForm, FixtureForm, ShowForm } from "./Editors";
import type { FixtureType } from "../types";

interface CopiesTabProps {
  db: DB;
  show: Show;
  user: User;
  online: boolean;
  onChanged: () => void;
  onToast: (text: string, kind?: "ok" | "warn") => void;
  onSubmitCopy: (copy: WorkingCopy) => void;
  onSimulateConcurrent: () => void;
}

type EditorState =
  | { kind: "none" }
  | { kind: "fixture"; id: string | null }
  | { kind: "cue"; id: string | null }
  | { kind: "channel"; id: string | null }
  | { kind: "show" };

export function CopiesTab(props: CopiesTabProps) {
  const { db, show, user } = props;
  const [copyId, setCopyId] = useState<string | null>(db.copies.filter((c) => c.showId === show.id)[0]?.id ?? null);
  const copy = db.copies.find((c) => c.id === copyId) ?? null;
  const [editor, setEditor] = useState<EditorState>({ kind: "none" });
  const [filter, setFilter] = useState<FixtureType | "全部" | "待补全">("全部");
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const masterRev = show.rev;
  const behind = copy !== null && copy.baseRev < masterRev;

  const createCopy = () => {
    const label = newLabel.trim() || `${user.name}的控台副本`;
    const wc: WorkingCopy = {
      id: uid("copy"),
      showId: show.id,
      label,
      owner: user.name,
      baseRev: show.rev,
      createdAt: Date.now(),
      show: structuredClone(show),
      channels: structuredClone(channelsOf(db, show.id)),
      fixtures: structuredClone(fixturesOf(db, show.id)),
      cues: structuredClone(cuesOf(db, show.id)),
      base: {
        show: structuredClone(show),
        channels: structuredClone(channelsOf(db, show.id)),
        fixtures: structuredClone(fixturesOf(db, show.id)),
        cues: structuredClone(cuesOf(db, show.id)),
      },
    };
    db.copies.unshift(wc);
    setNewLabel("");
    setCopyId(wc.id);
    props.onToast(`已为 ${user.name} 建立控台副本（基于 v${show.rev}），可断网续作`);
    props.onChanged();
  };

  const removeCopy = (id: string) => {
    if (!confirm("删除该控台副本？未提交的改动会丢失。")) return;
    db.copies = db.copies.filter((c) => c.id !== id);
    if (copyId === id) setCopyId(null);
    props.onChanged();
  };

  /** 已入库后把副本基线刷新到主账当前版本，可继续改、继续提交 */
  const resyncCopy = (wc: WorkingCopy) => {
    wc.baseRev = show.rev;
    wc.show = structuredClone(show);
    wc.channels = structuredClone(channelsOf(db, show.id));
    wc.fixtures = structuredClone(fixturesOf(db, show.id));
    wc.cues = structuredClone(cuesOf(db, show.id));
    wc.base = {
      show: structuredClone(show),
      channels: structuredClone(channelsOf(db, show.id)),
      fixtures: structuredClone(fixturesOf(db, show.id)),
      cues: structuredClone(cuesOf(db, show.id)),
    };
    props.onToast(`副本已对齐主账 v${show.rev}，旧改动已合并，可继续断网续作`);
    props.onChanged();
  };

  if (!copy) {
    return (
      <div className="panel copy-landing">
        <h2>控台副本（断网续作账）</h2>
        <p className="muted">
          地下库房断网时，灯光师各从主控台账拉一份副本继续改：灯位、色片、Cue 触发顺序都存在本地，断电不丢。
          回主控台后提交——先到的入库，晚到的冲突列给操作员裁决；已合并内容凭幂等键不重复。
        </p>
        <div className="copy-create">
          <input placeholder={`副本名称，如「${user.name}侧光调整」`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button className="primary" onClick={createCopy}>
            拉取 v{show.rev} 建副本
          </button>
        </div>
        <CopyRoster db={db} showId={show.id} onOpen={setCopyId} onRemove={removeCopy} />
        <div className="sim-box">
          <button onClick={props.onSimulateConcurrent}>🧪 模拟两名灯光师同改一场后同时提交</button>
          <span className="muted small">自动建 A/B 两份副本制造同字段竞争，用于演示先到入库、晚到列冲突</span>
        </div>
      </div>
    );
  }

  const editingFixture = editor.kind === "fixture" ? (editor.id ? copy.fixtures.find((f) => f.id === editor.id) ?? blankFixture(copy.showId) : blankFixture(copy.showId)) : null;
  const editingCue = editor.kind === "cue" ? (editor.id ? copy.cues.find((c) => c.id === editor.id) ?? blankCue(copy.showId) : blankCue(copy.showId)) : null;
  const editingChannel = editor.kind === "channel" ? (editor.id ? copy.channels.find((c) => c.id === editor.id) ?? blankChannel(copy.showId) : blankChannel(copy.showId)) : null;

  const saveFixture = (f: Fixture) => {
    const old = copy.fixtures.find((x) => x.id === f.id);
    const i = copy.fixtures.findIndex((x) => x.id === f.id);
    if (i >= 0) copy.fixtures[i] = f;
    else copy.fixtures.push(f);
    if (f.channelNo && !copy.channels.some((c) => c.no === f.channelNo)) {
      copy.channels.push({ id: uid("ch"), showId: copy.showId, no: f.channelNo, ratedLoad: null });
    }
    if (old && (old.x !== f.x || old.y !== f.y || old.gel !== f.gel)) {
      for (const cue of copy.cues.filter((c) => c.fixtureIds.includes(f.id))) cue.dirty = true;
      props.onToast(`灯具 ${f.code} 灯位/色片变更，关联 Cue 已置为作废，请重算`, "warn");
    }
    setEditor({ kind: "none" });
    props.onChanged();
  };
  const deleteFixture = (id: string) => {
    copy.fixtures = copy.fixtures.filter((f) => f.id !== id);
    for (const cue of copy.cues) cue.fixtureIds = cue.fixtureIds.filter((x) => x !== id);
    setEditor({ kind: "none" });
    props.onChanged();
  };
  const saveChannel = (c: Channel) => {
    const i = copy.channels.findIndex((x) => x.id === c.id);
    if (i >= 0) copy.channels[i] = c;
    else copy.channels.push(c);
    setEditor({ kind: "none" });
    props.onChanged();
  };
  const deleteChannel = (id: string) => {
    copy.channels = copy.channels.filter((c) => c.id !== id);
    props.onChanged();
  };
  const saveCue = (c: Cue) => {
    const i = copy.cues.findIndex((x) => x.id === c.id);
    if (i >= 0) copy.cues[i] = c;
    else copy.cues.push(c);
    setEditor({ kind: "none" });
    props.onChanged();
  };
  const deleteCue = (id: string) => {
    copy.cues = copy.cues.filter((c) => c.id !== id);
    setActiveCueId(null);
    setEditor({ kind: "none" });
    props.onChanged();
  };
  const recompute = () => {
    copy.cues
      .sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }) || a.updatedAt - b.updatedAt)
      .forEach((c, i) => {
        c.trigger = i + 1;
        c.dirty = false;
      });
    props.onToast(`副本内 ${copy.cues.length} 个 Cue 已重排触发顺序，负载占用恢复计算`);
    props.onChanged();
  };

  const activeCue = copy.cues.find((c) => c.id === activeCueId) ?? null;

  return (
    <div className="copies-tab">
      <div className="panel copy-bar">
        <div className="copy-tabs">
          {db.copies.filter((c) => c.showId === show.id).map((c) => (
            <button key={c.id} className={c.id === copy.id ? "copy-tab on" : "copy-tab"} onClick={() => { setCopyId(c.id); setEditor({ kind: "none" }); }}>
              {c.label}
              <small>
                {c.owner} · v{c.baseRev}
                {c.baseRev < masterRev && <em className="behind">落后</em>}
              </small>
            </button>
          ))}
        </div>
        <div className="copy-actions">
          {behind && <button onClick={() => resyncCopy(copy)} title="把已合并的主账最新版拉回副本">↧ 对齐主账 v{masterRev}</button>}
          <button className="primary" onClick={() => props.onSubmitCopy(copy)}>
            {props.online ? "提交到主控台" : "断网提交（存发件箱）"}
          </button>
          <button onClick={() => removeCopy(copy.id)}>删除副本</button>
        </div>
      </div>

      {behind && (
        <div className="dirty-banner warn">
          <span>该副本基于 v{copy.baseRev}，主账已推进到 v{masterRev}（先到提交已入库）。提交后将做三方合并：无冲突部分自动入库，冲突字段列给操作员。</span>
        </div>
      )}

      <div className="panel">
        <div className="heading">
          <div>
            <p>当前场景预览</p>
            <h2>{activeCue ? `Cue ${activeCue.no} ${activeCue.name}` : "点击下方 Cue 卡片预览灯位"}</h2>
          </div>
          <button onClick={() => setEditor({ kind: "show" })}>编辑演出信息</button>
        </div>
        <StageMap
          fixtures={copy.fixtures}
          activeCue={activeCue}
          selectedId={selectedFixtureId}
          onSelect={setSelectedFixtureId}
          onMove={(id, x, y) => {
            const fx = copy.fixtures.find((f) => f.id === id);
            if (fx) saveFixture({ ...fx, x, y, updatedAt: Date.now() });
          }}
          editable
        />
      </div>

      {editor.kind !== "none" && (
        <div className="modal-backdrop" onClick={() => setEditor({ kind: "none" })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {editingFixture && editor.kind === "fixture" && (
              <FixtureForm fixture={editingFixture} onSave={saveFixture} onCancel={() => setEditor({ kind: "none" })} onDelete={editor.id ? () => deleteFixture(editingFixture.id) : undefined} />
            )}
            {editingCue && editor.kind === "cue" && (
              <CueForm
                cue={editingCue}
                fixtures={copy.fixtures}
                onSave={saveCue}
                onCancel={() => setEditor({ kind: "none" })}
                onDelete={editor.id ? () => deleteCue(editingCue.id) : undefined}
              />
            )}
            {editingChannel && <ChannelForm channel={editingChannel} onSave={saveChannel} onCancel={() => setEditor({ kind: "none" })} />}
            {editor.kind === "show" && (
              <ShowForm
                show={copy.show}
                onSave={(s) => {
                  copy.show = s;
                  setEditor({ kind: "none" });
                  props.onChanged();
                }}
                onCancel={() => setEditor({ kind: "none" })}
              />
            )}
          </div>
        </div>
      )}

      <LedgerView
        channels={copy.channels}
        fixtures={copy.fixtures}
        cues={copy.cues}
        filter={filter}
        setFilter={setFilter}
        activeCueId={activeCueId}
        setActiveCueId={setActiveCueId}
        selectedFixtureId={selectedFixtureId}
        setSelectedFixtureId={(id) => {
          setSelectedFixtureId(id);
        }}
        editable
        saveFixture={saveFixture}
        deleteFixture={deleteFixture}
        saveChannel={saveChannel}
        deleteChannel={deleteChannel}
        saveCue={saveCue}
        deleteCue={deleteCue}
        recompute={recompute}
        onNewFixture={() => setEditor({ kind: "fixture", id: selectedFixtureId })}
        onNewChannel={() => setEditor({ kind: "channel", id: null })}
        onNewCue={() => setEditor({ kind: "cue", id: null })}
        onEditFixture={(id) => setEditor({ kind: "fixture", id })}
        onEditCue={(id) => setEditor({ kind: "cue", id })}
      />
      <CopyRoster db={db} showId={show.id} currentId={copy.id} onOpen={(id) => { setCopyId(id); setEditor({ kind: "none" }); }} onRemove={removeCopy} compact />
    </div>
  );
}

function CopyRoster({
  db,
  showId,
  currentId,
  onOpen,
  onRemove,
  compact,
}: {
  db: DB;
  showId: string;
  currentId?: string;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}) {
  const list = db.copies.filter((c) => c.showId === showId);
  if (list.length === 0) return null;
  return (
    <div className={`copy-roster ${compact ? "compact" : ""}`}>
      <h4>本演出的控台副本</h4>
      {list.map((c) => (
        <div key={c.id} className={`roster-row ${currentId === c.id ? "on" : ""}`}>
          <button onClick={() => onOpen(c.id)}>
            <b>{c.label}</b>
            <span className="muted small">
              {c.owner} · 基于 v{c.baseRev}
            </span>
          </button>
          <button className="danger-text" onClick={() => onRemove(c.id)}>
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

function blankFixture(showId: string): Fixture {
  return { id: uid("fx"), showId, code: "", channelNo: null, type: "", gel: "", x: null, y: null, focus: "", brightness: null, power: null, updatedAt: Date.now() };
}
function blankCue(showId: string): Cue {
  return { id: uid("cue"), showId, no: "", name: "", trigger: 0, fixtureIds: [], note: "", dirty: false, updatedAt: Date.now() };
}
function blankChannel(showId: string): Channel {
  return { id: uid("ch"), showId, no: "", ratedLoad: null };
}
