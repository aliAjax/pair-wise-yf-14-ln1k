import type { Channel, Cue, Fixture, FixtureType } from "../types";
import { cueChannelLoad, type ChannelLoadLine } from "../ledger";
import { FIXTURE_TYPES } from "../types";
import { gelColor } from "./StageMap";
import { fixtureMissing } from "./Editors";

export interface ScopeData {
  channels: Channel[];
  fixtures: Fixture[];
  cues: Cue[];
}

export interface ScopeActions {
  saveFixture: (f: Fixture) => void;
  deleteFixture: (id: string) => void;
  saveChannel: (c: Channel) => void;
  deleteChannel: (id: string) => void;
  saveCue: (c: Cue) => void;
  deleteCue: (id: string) => void;
  recompute: () => void;
}

interface LedgerViewProps extends ScopeData, ScopeActions {
  filter: FixtureType | "全部" | "待补全";
  setFilter: (f: FixtureType | "全部" | "待补全") => void;
  activeCueId: string | null;
  setActiveCueId: (id: string | null) => void;
  selectedFixtureId: string | null;
  setSelectedFixtureId: (id: string | null) => void;
  editable: boolean;
  onNewFixture: () => void;
  onNewChannel: () => void;
  onNewCue: () => void;
  onEditFixture: (id: string) => void;
  onEditCue: (id: string) => void;
}

const FILTERS: (FixtureType | "全部" | "待补全")[] = ["全部", ...FIXTURE_TYPES, "待补全"];

export function LedgerView(props: LedgerViewProps) {
  const { fixtures, cues, channels, filter, activeCueId } = props;
  const activeCue = cues.find((c) => c.id === activeCueId) ?? null;
  const dirtyCount = cues.filter((c) => c.dirty).length;

  const visibleFixtures = fixtures.filter((f) => {
    if (filter === "全部") return true;
    if (filter === "待补全") return fixtureMissing(f).length > 0;
    return f.type === filter;
  });

  return (
    <div className="ledger-view">
      {dirtyCount > 0 && (
        <div className="dirty-banner">
          <span>
            ⚠ 灯位/色片已变更，<b>{dirtyCount}</b> 个 Cue 的触发顺序与负载占用作废，等待重算（作废 Cue 暂不计入通道负载校核）
          </span>
          {props.editable && (
            <button className="primary" onClick={props.recompute}>
              立即重算
            </button>
          )}
        </div>
      )}

      <div className="lv-grid">
        <section className="panel lv-fixtures">
          <div className="heading">
            <div>
              <p>灯具账</p>
              <h2>灯具筛选（{visibleFixtures.length}/{fixtures.length}）</h2>
            </div>
            {props.editable && <button className="primary" onClick={props.onNewFixture}>+ 新灯具</button>}
          </div>
          <div className="chips">
            {FILTERS.map((t) => (
              <button key={t} className={filter === t ? "chip-on" : ""} onClick={() => props.setFilter(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="fx-table">
            <table>
              <thead>
                <tr>
                  <th>灯具</th>
                  <th>通道</th>
                  <th>类型</th>
                  <th>色片</th>
                  <th>焦点</th>
                  <th>亮度/功率</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleFixtures.map((f) => {
                  const miss = fixtureMissing(f);
                  return (
                    <tr key={f.id} className={props.selectedFixtureId === f.id ? "sel-row" : ""} onClick={() => props.setSelectedFixtureId(f.id)}>
                      <td>
                        <b>{f.code}</b>
                        {miss.length > 0 && <em className="miss-tag">待补 {miss.length}</em>}
                      </td>
                      <td>{f.channelNo ? `CH ${f.channelNo}` : <em className="blank">待补</em>}</td>
                      <td>{f.type || <em className="blank">待补</em>}</td>
                      <td>
                        <span className="gel-dot" style={{ background: gelColor(f.gel) }} />
                        {f.gel || <em className="blank">待补</em>}
                      </td>
                      <td>{f.focus || <em className="blank">—</em>}</td>
                      <td>
                        {f.brightness !== null ? `${f.brightness}%` : <em className="blank">待补</em>}
                        {f.power !== null ? ` · ${f.power}W` : <em className="blank"> · 功率待补</em>}
                      </td>
                      <td className="row-actions">
                        {props.editable && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onEditFixture(f.id);
                            }}
                          >
                            编
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleFixtures.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted center">
                      无灯具
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel lv-load">
          <div className="heading">
            <div>
              <p>额定负载</p>
              <h2>通道占用校核</h2>
            </div>
            {props.editable && <button onClick={props.onNewChannel}>+ 通道</button>}
          </div>
          <ChannelLoadTable channels={channels} cues={cues} fixtures={fixtures} editable={props.editable} onSave={props.saveChannel} onDelete={props.deleteChannel} />
        </section>
      </div>

      <section className="panel lv-cues">
        <div className="heading">
          <div>
            <p>Cue 表</p>
            <h2>触发顺序与负载占用</h2>
          </div>
          <div className="head-actions">
            <button onClick={props.recompute} title="按 Cue 号重排触发顺序并恢复负载校核">↻ 重算全部</button>
            {props.editable && (
              <button className="primary" onClick={props.onNewCue}>
                + 新 Cue
              </button>
            )}
          </div>
        </div>
        <div className="cue-cards">
          {[...cues]
            .sort((a, b) => a.trigger - b.trigger || a.no.localeCompare(b.no, undefined, { numeric: true }))
            .map((cue) => {
              const load = cueChannelLoad(cue, fixtures);
              const overloaded = overloadedChannels(load, channels);
              const isActive = cue.id === activeCueId;
              return (
                <article key={cue.id} className={`cue-card ${cue.dirty ? "stale" : ""} ${isActive ? "active" : ""}`} onClick={() => props.setActiveCueId(isActive ? null : cue.id)}>
                  <header>
                    <span className="trig">#{cue.trigger}</span>
                    <h3>
                      Cue {cue.no} {cue.name}
                    </h3>
                    {cue.dirty && <em className="stale-tag">已作废·待重算</em>}
                    {overloaded.length > 0 && !cue.dirty && <em className="over-tag">超载 {overloaded.join(",")}</em>}
                  </header>
                  <p className="cue-note">{cue.note || "—"}</p>
                  <div className="cue-load">
                    {Object.keys(load).length === 0 && <span className="muted">无点亮灯具</span>}
                    {Object.entries(load).map(([chNo, w]) => {
                      const rated = channels.find((c) => c.no === chNo)?.ratedLoad ?? null;
                      const over = rated !== null && w > rated;
                      return (
                        <span key={chNo} className={over ? "load over" : "load"}>
                          CH {chNo}：{Math.round(w)}W{rated !== null ? `/${rated}W` : "/额定待补"}
                        </span>
                      );
                    })}
                  </div>
                  <footer>
                    <span className="muted">{cue.fixtureIds.length} 灯</span>
                    {props.editable && (
                      <span className="row-actions">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onEditCue(cue.id);
                          }}
                        >
                          编
                        </button>
                      </span>
                    )}
                  </footer>
                </article>
              );
            })}
        </div>
      </section>
    </div>
  );
}

function overloadedChannels(load: Record<string, number>, channels: Channel[]): string[] {
  const out: string[] = [];
  for (const [no, w] of Object.entries(load)) {
    const rated = channels.find((c) => c.no === no)?.ratedLoad ?? null;
    if (rated !== null && w > rated) out.push(no);
  }
  return out;
}

function ChannelLoadTable({
  channels,
  cues,
  fixtures,
  editable,
  onSave,
  onDelete,
}: {
  channels: Channel[];
  cues: Cue[];
  fixtures: Fixture[];
  editable: boolean;
  onSave: (c: Channel) => void;
  onDelete: (id: string) => void;
}) {
  const lines: ChannelLoadLine[] = channels.map((ch) => {
    let peak = 0;
    const byCue: ChannelLoadLine["byCue"] = [];
    for (const cue of cues) {
      if (cue.dirty) continue;
      const used = cueChannelLoad(cue, fixtures)[ch.no] ?? 0;
      if (used > 0) byCue.push({ cueId: cue.id, cueName: `Cue ${cue.no} ${cue.name}`, used: Math.round(used) });
      peak = Math.max(peak, used);
    }
    return { channel: ch, used: Math.round(peak), rated: ch.ratedLoad, byCue };
  });

  return (
    <div className="ch-table">
      {lines.length === 0 && <p className="muted">暂无通道，保存带通道号的灯具时会自动建档（额定负载待补）。</p>}
      {lines.map((line) => {
        const over = line.rated !== null && line.used > line.rated;
        const pct = line.rated ? Math.min(100, Math.round((line.used / line.rated) * 100)) : 0;
        return (
          <div key={line.channel.id} className={`ch-row ${over ? "over" : ""} ${line.rated === null ? "miss" : ""}`}>
            <div className="ch-head">
              <b>CH {line.channel.no}</b>
              {line.rated === null ? (
                <span className="miss-inline">额定负载待补</span>
              ) : (
                <span>
                  {line.used}/{line.rated}W {over && <em className="over-tag">超载</em>}
                </span>
              )}
            </div>
            {line.rated !== null && (
              <div className="bar">
                <i className={over ? "bar-over" : ""} style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="ch-cues">
              {line.byCue.slice(0, 4).map((x) => (
                <span key={x.cueId} className="mini-load">
                  {x.cueName}：{x.used}W
                </span>
              ))}
              {line.byCue.length === 0 && <span className="muted">无占用</span>}
            </div>
            {editable && (
              <div className="ch-edit">
                <button
                  onClick={() => {
                    const v = prompt(`CH ${line.channel.no} 额定负载(W)，留空表示待补全：`, line.rated === null ? "" : String(line.rated));
                    if (v === null) return;
                    onSave({ ...line.channel, ratedLoad: v.trim() === "" ? null : Number(v) });
                  }}
                >
                  额定
                </button>
                <button className="danger-text" onClick={() => confirm(`删除通道 CH ${line.channel.no}？`) && onDelete(line.channel.id)}>
                  删
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
