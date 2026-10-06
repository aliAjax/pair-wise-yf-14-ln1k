import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { Channel, Changeset, Cue, DB, Fixture, FixtureType, Show, User, WorkingCopy } from "./types";
import {
  addLog,
  channelsOf,
  createChangeset,
  cuesOf,
  deleteChannel,
  deleteCue,
  deleteFixture,
  fixturesOf,
  loadDB,
  mergeChangeset,
  pendingConflicts,
  publishShow,
  recomputeCues,
  resolveAndMerge,
  saveChannel,
  saveCue,
  saveFixture,
  saveShow,
  saveDB,
  uid,
} from "./ledger";
import { migrateLegacy } from "./migrate";
import { StageMap } from "./components/StageMap";
import { ChannelForm, CueForm, FixtureForm, ShowForm, fixtureMissing } from "./components/Editors";
import { LedgerView } from "./components/LedgerView";
import { ReviewPanel } from "./components/ReviewPanel";
import { CopiesTab } from "./components/CopiesTab";

type Tab = "ledger" | "copies" | "review";

type EditorState =
  | { kind: "none" }
  | { kind: "fixture"; id: string | null }
  | { kind: "cue"; id: string | null }
  | { kind: "channel"; id: string | null }
  | { kind: "show" };

const USERS: User[] = [
  { name: "主控台操作员·老周", role: "operator" },
  { name: "灯光师·小林", role: "designer" },
  { name: "灯光师·阿May", role: "designer" },
];

function App() {
  const [db, setDb] = useState<DB>(() => {
    const initial = loadDB();
    if (!initial.migrated && initial.shows.length === 0) migrateLegacy(initial);
    saveDB(initial);
    return initial;
  });
  const [showId, setShowId] = useState<string>(() => db.shows[0]?.id ?? "");
  const [user, setUser] = useState<User>(USERS[0]);
  const [online, setOnline] = useState<boolean>(() => localStorage.getItem("lighting-console-online") !== "0");
  const [tab, setTab] = useState<Tab>("ledger");
  const [editor, setEditor] = useState<EditorState>({ kind: "none" });
  const [filter, setFilter] = useState<FixtureType | "全部" | "待补全">("全部");
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "warn" } | null>(null);

  const show = db.shows.find((s) => s.id === showId) ?? db.shows[0];

  const commit = (next?: DB) => {
    const d = next ?? db;
    saveDB(d);
    setDb({ ...d });
  };

  const notify = (text: string, kind: "ok" | "warn" = "ok") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 3200);
  };

  /* 联网恢复：自动重补发件箱（幂等，已合并不重复） */
  useEffect(() => {
    localStorage.setItem("lighting-console-online", online ? "1" : "0");
    if (online) {
      const outbox = db.changesets.filter((c) => c.status === "outbox").sort((a, b) => a.seq - b.seq);
      if (outbox.length > 0) {
        let merged = 0;
        let conflict = 0;
        for (const cs of outbox) {
          const r = mergeChangeset(db, cs);
          if (r.status === "merged") merged += 1;
          else conflict += 1;
        }
        if (merged > 0) addLog(db, `联网恢复：发件箱 ${merged} 份提交已入库（重复操作自动跳过）`);
        if (conflict > 0) addLog(db, `${conflict} 份晚到提交存在冲突，已交主控台操作员裁决`);
        commit();
        if (merged > 0) notify(`联网恢复，${merged} 份待提交已合并入主控台账`);
        if (conflict > 0) notify(`${conflict} 份提交有冲突，请到「待审 / 发布」裁决`, "warn");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  if (!show) {
    return (
      <main className="app">
        <p>本地账为空。</p>
        <button
          onClick={() => {
            const s: Show = { id: uid("show"), name: "新演出", note: "", rev: 1, publishedRev: 0, createdAt: Date.now() };
            db.shows.push(s);
            commit();
            setShowId(s.id);
          }}
        >
          新建演出
        </button>
      </main>
    );
  }

  const channels = channelsOf(db, show.id);
  const fixtures = fixturesOf(db, show.id);
  const cues = cuesOf(db, show.id);
  const activeCue = cues.find((c) => c.id === activeCueId) ?? null;
  const canEditMaster = user.role === "operator";
  const conflictCount = pendingConflicts(db).filter((c) => c.showId === show.id).length;
  const outboxCount = db.changesets.filter((c) => c.status === "outbox" && c.showId === show.id).length;
  const missingCount = fixtures.reduce((n, f) => n + fixtureMissing(f).length, 0) + channels.filter((c) => c.ratedLoad === null).length;

  /* ---------- 主账编辑（操作员直接改主账并推进 rev） ---------- */

  const masterSaveFixture = (fx: Fixture) => {
    const invalidated = saveFixture(db, fx);
    setEditor({ kind: "none" });
    commit();
    if (invalidated.length) notify(`灯位/色片变更：${invalidated.join("、")} 已作废，等待重算`, "warn");
  };
  const masterDeleteFixture = (id: string) => {
    if (!confirm("删除该灯具？引用它的 Cue 将作废。")) return;
    deleteFixture(db, show.id, id);
    setEditor({ kind: "none" });
    commit();
  };
  const masterSaveChannel = (c: Channel) => {
    saveChannel(db, c);
    show.rev += 1;
    setEditor({ kind: "none" });
    commit();
  };
  const masterDeleteChannel = (id: string) => {
    deleteChannel(db, show.id, id);
    commit();
  };
  const masterSaveCue = (c: Cue) => {
    saveCue(db, c);
    setEditor({ kind: "none" });
    commit();
  };
  const masterDeleteCue = (id: string) => {
    deleteCue(db, show.id, id);
    setActiveCueId(null);
    setEditor({ kind: "none" });
    commit();
  };
  const masterRecompute = () => {
    const n = recomputeCues(db, show.id);
    show.rev += 1;
    addLog(db, `《${show.name}》重算：${n} 个 Cue 触发顺序重排，负载占用恢复`);
    commit();
    notify(`已重算 ${n} 个 Cue，触发顺序与通道负载占用已更新`);
  };

  /* ---------- 副本提交流程 ---------- */

  const doSubmitCopy = (copy: WorkingCopy, author = user.name, role = user.role) => {
    const cs = createChangeset(db, copy, author, role);
    if (!cs) {
      notify("该副本没有改动，无需提交");
      return;
    }
    addLog(db, `${author} 提交「${copy.label}」（基于 v${cs.baseRev}，${cs.ops.length} 项操作）`);
    if (!online) {
      commit();
      notify("当前断网：提交已存发件箱，联网后自动重试，已合并内容不会重复", "warn");
      return;
    }
    const r = mergeChangeset(db, cs);
    if (r.status === "merged") {
      addLog(db, `「${copy.label}」先到入库 → v${r.mergedRev}（应用 ${r.appliedCount} 项，跳过重复 ${r.skippedCount} 项）`);
      commit();
      setTab("review");
      notify(`提交已合并入主控台账 v${r.mergedRev}，等待操作员发布`);
    } else {
      addLog(db, `「${copy.label}」晚到：${r.conflicts.length} 个字段冲突，交操作员裁决`);
      commit();
      setTab("review");
      notify("提交晚到，字段冲突已列给主控台操作员", "warn");
    }
  };

  const simulateConcurrent = () => {
    // 模拟两名灯光师同改一场：先各拉同一版副本
    const makeCopy = (label: string, owner: string): WorkingCopy => ({
      id: uid("copy"),
      showId: show.id,
      label,
      owner,
      baseRev: show.rev,
      createdAt: Date.now(),
      show: structuredClone(show),
      channels: structuredClone(channels),
      fixtures: structuredClone(fixtures),
      cues: structuredClone(cues),
      base: {
        show: structuredClone(show),
        channels: structuredClone(channels),
        fixtures: structuredClone(fixtures),
        cues: structuredClone(cues),
      },
    });
    const copyA = makeCopy(`小林-侧光排练本`, "灯光师·小林");
    const copyB = makeCopy(`阿May-侧光排练本`, "灯光师·阿May");
    // 两人改了同一盏灯的同一字段（色片），还各改了不冲突字段
    const targetA = copyA.fixtures.find((f) => f.code.startsWith("SL-")) ?? copyA.fixtures[0];
    const targetB = copyB.fixtures.find((f) => f.id === targetA?.id);
    if (targetA) {
      targetA.gel = "深蓝";
      targetA.focus = targetA.focus || "二幕侧幕条";
      targetA.updatedAt = Date.now();
    }
    if (targetB) {
      targetB.gel = "紫罗兰";
      targetB.brightness = 72;
      targetB.updatedAt = Date.now();
    }
    db.copies.unshift(copyB, copyA);
    // A 先提交入库
    const csA = createChangeset(db, copyA, "灯光师·小林", "designer")!;
    const rA = online ? mergeChangeset(db, csA) : null;
    // B 几乎同时提交 → 晚到列冲突
    const csB = createChangeset(db, copyB, "灯光师·阿May", "designer")!;
    if (online) {
      mergeChangeset(db, csB);
      addLog(db, `模拟并发：小林先到入库 v${rA?.mergedRev}，阿May 同字段冲突已列出`);
    } else {
      addLog(db, "模拟并发：两份提交均在发件箱，联网后按到达顺序合并");
    }
    commit();
    setTab("review");
    notify(online ? "小林先到已入库，阿May 的冲突已列在下方，请裁决" : "离线：两份提交进发件箱，联网自动按序合并", "warn");
  };

  const retryOutbox = () => {
    const outbox = db.changesets.filter((c) => c.status === "outbox" && c.showId === show.id).sort((a, b) => a.seq - b.seq);
    let merged = 0;
    let conflict = 0;
    for (const cs of outbox) {
      const r = mergeChangeset(db, cs);
      if (r.status === "merged") merged += 1;
      else conflict += 1;
    }
    commit();
    if (merged) notify(`${merged} 份提交已入库（重复操作幂等跳过）`);
    if (conflict) notify(`${conflict} 份提交存在冲突待裁决`, "warn");
    if (!merged && !conflict) notify("发件箱为空");
  };

  const resolveConflict = (cs: Changeset, decisions: Record<string, "master" | "incoming">) => {
    resolveAndMerge(db, cs, decisions);
    addLog(db, `操作员裁决「${cs.copyLabel}」后入库 → v${cs.mergedRev}`);
    commit();
    notify("冲突已按裁决入库，相关 Cue 已自动重算");
  };

  const discardChangeset = (cs: Changeset) => {
    if (!confirm("退回该提交？其操作将从队列移除（副本仍保留）。")) return;
    db.changesets = db.changesets.filter((c) => c.id !== cs.id);
    commit();
  };

  const doPublish = (note: string) => {
    const pub = publishShow(db, show.id, note, user.name);
    commit();
    if (pub) notify(`《${show.name}》v${pub.rev} 已发布到主控台`);
  };

  const editingFixture = editor.kind === "fixture" ? (editor.id ? fixtures.find((f) => f.id === editor.id) ?? blankFixture(show.id) : blankFixture(show.id)) : null;
  const editingCue = editor.kind === "cue" ? (editor.id ? cues.find((c) => c.id === editor.id) ?? blankCue(show.id) : blankCue(show.id)) : null;
  const editingChannel = editor.kind === "channel" ? (editor.id ? channels.find((c) => c.id === editor.id) ?? blankChannel(show.id) : blankChannel(show.id)) : null;

  const logSlice = db.logs.slice(0, 8);

  return (
    <main className="app">
      <section className="topbar panel">
        <div className="brand">
          <h1>剧场灯光排程台</h1>
          <span className="sub">演出 · 灯具 · Cue 共用一份本地账，断网可续作，断电不丢</span>
        </div>
        <div className="tb-controls">
          <label className="switch">
            <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
            <span className={`net ${online ? "on" : "off"}`}>{online ? "● 联网（主控台）" : "○ 断网（库房续作）"}</span>
          </label>
          <select value={USERS.findIndex((u) => u.name === user.name)} onChange={(e) => setUser(USERS[Number(e.target.value)])}>
            {USERS.map((u, i) => (
              <option key={u.name} value={i}>
                {u.name}（{u.role === "operator" ? "可发布" : "灯光师"}）
              </option>
            ))}
          </select>
          <select value={showId} onChange={(e) => { setShowId(e.target.value); setActiveCueId(null); setSelectedFixtureId(null); }}>
            {db.shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} v{s.rev}
              </option>
            ))}
          </select>
          <button
            title="新建一场演出"
            onClick={() => {
              const name = prompt("新演出名称：", "新演出");
              if (name === null) return;
              const s: Show = { id: uid("show"), name: name.trim() || "未命名演出", note: "", rev: 1, publishedRev: 0, createdAt: Date.now() };
              db.shows.push(s);
              addLog(db, `新建演出《${s.name}》`);
              commit();
              setShowId(s.id);
            }}
          >
            + 新演出
          </button>
        </div>
      </section>

      {db.migrated && !db.migrationDismissed && db.migrationSummary && (
        <section className="mig-banner panel">
          <div>
            <b>旧账已迁移：</b>
            从旧版静态 Cue 表迁入 {db.migrationSummary.shows} 场演出、{db.migrationSummary.fixtures} 盏灯具、{db.migrationSummary.cues} 个 Cue；
            另有 <em>{db.migrationSummary.missing}</em> 处字段缺失（标「待补」），请在下方逐项补全后再发布。
          </div>
          <button
            onClick={() => {
              db.migrationDismissed = true;
              commit();
            }}
          >
            知道了
          </button>
        </section>
      )}

      <section className="metrics">
        <article><small>灯具数量</small><strong>{fixtures.length}</strong></article>
        <article><small>Cue 数量</small><strong>{cues.length}</strong></article>
        <article><small>当前场景</small><strong className="txt">{activeCue ? `Cue ${activeCue.no}` : "未选"}</strong></article>
        <article><small>待补全字段</small><strong className={missingCount ? "warn-num" : ""}>{missingCount}</strong></article>
      </section>

      <nav className="tabs">
        <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>主控台账</button>
        <button className={tab === "copies" ? "on" : ""} onClick={() => setTab("copies")}>
          控台副本{outboxCount > 0 && <em className="badge outbox">{outboxCount}</em>}
        </button>
        <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
          待审 / 发布
          {conflictCount > 0 && <em className="badge conflict">{conflictCount} 冲突</em>}
        </button>
      </nav>

      {tab === "ledger" && (
        <>
          <section className="panel">
            <div className="heading">
              <div>
                <p>演出与版本</p>
                <h2>{show.name} <span className="rev">v{show.rev}{show.publishedRev > 0 && <> / 已发布 v{show.publishedRev}</>}</span></h2>
              </div>
              {canEditMaster ? (
                <button onClick={() => setEditor({ kind: "show" })}>编辑演出 / 备注</button>
              ) : (
                <span className="role-lock">🔒 灯光师只读，改动请走「控台副本」</span>
              )}
            </div>
            <p className="show-note">{show.note || "（无版本备注）"}</p>
            <StageMap
              fixtures={fixtures}
              activeCue={activeCue}
              selectedId={selectedFixtureId}
              onSelect={(id) => {
                setSelectedFixtureId(id);
                if (canEditMaster) setEditor({ kind: "fixture", id });
              }}
              onMove={canEditMaster ? (id, x, y) => {
                const fx = fixtures.find((f) => f.id === id);
                if (fx) masterSaveFixture({ ...fx, x, y, updatedAt: Date.now() });
              } : undefined}
              editable={canEditMaster}
            />
          </section>

          <LedgerView
            channels={channels}
            fixtures={fixtures}
            cues={cues}
            filter={filter}
            setFilter={setFilter}
            activeCueId={activeCueId}
            setActiveCueId={(id) => { setActiveCueId(id); }}
            selectedFixtureId={selectedFixtureId}
            setSelectedFixtureId={setSelectedFixtureId}
            editable={canEditMaster}
            saveFixture={masterSaveFixture}
            deleteFixture={masterDeleteFixture}
            saveChannel={masterSaveChannel}
            deleteChannel={masterDeleteChannel}
            saveCue={masterSaveCue}
            deleteCue={masterDeleteCue}
            recompute={masterRecompute}
            onNewFixture={() => setEditor({ kind: "fixture", id: selectedFixtureId })}
            onNewChannel={() => setEditor({ kind: "channel", id: null })}
            onNewCue={() => setEditor({ kind: "cue", id: null })}
            onEditFixture={(id) => setEditor({ kind: "fixture", id })}
            onEditCue={(id) => setEditor({ kind: "cue", id })}
          />
        </>
      )}

      {tab === "copies" && (
        <CopiesTab
          db={db}
          show={show}
          user={user}
          online={online}
          onChanged={() => commit()}
          onToast={notify}
          onSubmitCopy={(c) => doSubmitCopy(c)}
          onSimulateConcurrent={simulateConcurrent}
        />
      )}

      {tab === "review" && (
        <ReviewPanel
          db={db}
          showId={show.id}
          online={online}
          role={user.role}
          userName={user.name}
          onRetryOutbox={retryOutbox}
          onResolve={resolveConflict}
          onPublish={doPublish}
          onDiscardChangeset={discardChangeset}
          currentRev={show.rev}
          publishedRev={show.publishedRev}
        />
      )}

      <section className="panel log-panel">
        <div className="heading">
          <div><p>本地账流水</p><h2>最近操作（已写入浏览器本地存储，断电保留）</h2></div>
          <button
            onClick={() => {
              if (confirm("导出整份本地账 JSON 备份？")) {
                const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `lighting-ledger-${show.id}-v${show.rev}.json`;
                a.click();
              }
            }}
          >
            导出备份
          </button>
        </div>
        <ul className="logs">
          {logSlice.map((l) => (
            <li key={l.id}>
              <time>{new Date(l.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
              <span>{l.text}</span>
            </li>
          ))}
          {logSlice.length === 0 && <li className="muted">暂无流水</li>}
        </ul>
      </section>

      {editor.kind !== "none" && (
        <div className="modal-backdrop" onClick={() => setEditor({ kind: "none" })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {editingFixture && editor.kind === "fixture" && (
              <FixtureForm fixture={editingFixture} onSave={masterSaveFixture} onCancel={() => setEditor({ kind: "none" })} onDelete={editor.id ? () => masterDeleteFixture(editingFixture.id) : undefined} />
            )}
            {editingCue && editor.kind === "cue" && (
              <CueForm cue={editingCue} fixtures={fixtures} onSave={masterSaveCue} onCancel={() => setEditor({ kind: "none" })} onDelete={editor.id ? () => masterDeleteCue(editingCue.id) : undefined} />
            )}
            {editingChannel && <ChannelForm channel={editingChannel} onSave={masterSaveChannel} onCancel={() => setEditor({ kind: "none" })} />}
            {editor.kind === "show" && (
              <ShowForm
                show={show}
                onSave={(s) => {
                  saveShow(db, { ...s, rev: show.rev, publishedRev: show.publishedRev });
                  show.rev += 1;
                  setEditor({ kind: "none" });
                  commit();
                }}
                onCancel={() => setEditor({ kind: "none" })}
              />
            )}
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </main>
  );
}

function blankFixture(showId: string): Fixture {
  return { id: uid("fx"), showId, code: "", channelNo: null, type: "", gel: "", x: null, y: null, focus: "", brightness: null, power: null, updatedAt: Date.now() };
}
function blankCue(showId: string) {
  return { id: uid("cue"), showId, no: "", name: "", trigger: 0, fixtureIds: [], note: "", dirty: false, updatedAt: Date.now() };
}
function blankChannel(showId: string) {
  return { id: uid("ch"), showId, no: "", ratedLoad: null };
}

export default App;
