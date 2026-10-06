// 同步中心：断网排队重试、账本副本导出导入、合并流水
import { useRef, useState } from "react";
import { useDesk } from "../lib/store";
import { Badge, EmptyState } from "./ui";

export function SyncTab() {
  const {
    online,
    outbox,
    retryFlush,
    importSnapshotText,
    exportLedger,
    events,
  } = useDesk();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const queued = outbox.filter((i) => i.status === "queued");
  const recentOutbox = outbox
    .filter((i) => i.status !== "queued")
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6);

  const onFile = async (file: File) => {
    setImportMsg(null);
    setImportErr(null);
    try {
      const text = await file.text();
      const item = await importSnapshotText(text);
      const evCount = item.events.length;
      if (item.status === "conflict") {
        setImportMsg(`已导入副本「${item.author}」：${evCount} 条变更全部与先到版本冲突，请到冲突页裁决。`);
      } else if (item.status === "partial") {
        setImportMsg(`已导入副本「${item.author}」：${evCount} 条变更部分合并，冲突请到冲突页裁决。`);
      } else if (item.status === "published") {
        setImportMsg(`已导入副本「${item.author}」：${evCount} 条变更合并完成，已合并内容不会重复入账。`);
      } else {
        setImportMsg(`已导入副本「${item.author}」：${evCount} 条变更，已排队，联网后自动重试。`);
      }
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "导入失败");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>地下库房没网也能续作</p>
            <h2>同步中心</h2>
          </div>
          <Badge tone={online ? "green" : "red"}>{online ? "在线 · 自动合并" : "离线 · 本地续作"}</Badge>
        </div>

        <div className="sync-grid">
          <div className="sync-card">
            <b>① 导出账本副本</b>
            <p>把当前整本账（演出/灯具/Cue 事件流水）导出成文件，带到排练场。</p>
            <button className="primary" onClick={exportLedger}>
              导出账本副本
            </button>
          </div>
          <div className="sync-card">
            <b>② 带回主控台导入</b>
            <p>回库房后导入副本：按事件 UUID 合并，已合并不重复，冲突列到冲突页。</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <button onClick={() => fileRef.current?.click()}>导入副本合并</button>
          </div>
          <div className="sync-card">
            <b>③ 断网重试</b>
            <p>排队中的批次联网后自动重试；合并幂等，已入账的事件不会重复应用。</p>
            <button onClick={() => void retryFlush()} disabled={queued.length === 0}>
              重试合并{queued.length ? `（${queued.length} 件排队）` : ""}
            </button>
          </div>
        </div>

        {importMsg && <p className="sync-msg ok">{importMsg}</p>}
        {importErr && <p className="sync-msg err">{importErr}</p>}
      </section>

      {queued.length > 0 && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>联网后自动继续</p>
              <h2>排队中的批次</h2>
            </div>
          </div>
          <div className="ledger-list">
            {queued.map((item) => (
              <div key={item.id} className="ledger-row">
                <Badge tone="cyan">排队</Badge>
                <span className="ledger-text">{item.label}</span>
                <span className="ledger-author">
                  {item.author} · 第 {item.attempts} 次尝试
                  {item.lastError ? ` · ${item.lastError}` : ""}
                </span>
                <button className="small" onClick={() => void retryFlush()}>
                  立即重试
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>合并流水</p>
            <h2>最近批次</h2>
          </div>
        </div>
        {recentOutbox.length === 0 ? (
          <EmptyState title="还没有合并记录" hint="导出副本带到排练场，或导入一份副本开始。" />
        ) : (
          <div className="ledger-list">
            {recentOutbox.map((item) => (
              <div key={item.id} className="ledger-row">
                <Badge
                  tone={
                    item.status === "published"
                      ? "green"
                      : item.status === "rejected"
                        ? "slate"
                        : item.status === "partial"
                          ? "amber"
                          : "red"
                  }
                >
                  {item.status === "published"
                    ? "已发布"
                    : item.status === "rejected"
                      ? "已驳回"
                      : item.status === "partial"
                        ? "部分冲突"
                        : "全部冲突"}
                </Badge>
                <span className="ledger-text">{item.label}</span>
                <span className="ledger-author">{item.author}</span>
                <span className="ledger-time">
                  {new Date(item.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>账本规模</p>
            <h2>事件流水</h2>
          </div>
          <Badge tone="slate">{events.length} 条事件 · 幂等合并</Badge>
        </div>
        <p className="muted">
          每一次新增、编辑、删除都是一条带 UUID 的事件。合并时按 UUID 去重，所以断网后反复重试、
          副本来回导入，已合并的内容都不会重复入账。
        </p>
      </section>
    </div>
  );
}
