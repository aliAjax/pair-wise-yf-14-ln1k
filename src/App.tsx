import { useState } from "react";
import { DeskProvider, useDesk } from "./lib/store";
import { TopBar, type Tab } from "./components/TopBar";
import { OverviewTab } from "./components/OverviewTab";
import { ShowsTab } from "./components/ShowsTab";
import { FixturesTab } from "./components/FixturesTab";
import { CuesTab } from "./components/CuesTab";
import { ReviewTab } from "./components/ReviewTab";
import { ConflictsTab } from "./components/ConflictsTab";
import { SyncTab } from "./components/SyncTab";

function Shell() {
  const [tab, setTab] = useState<Tab>("overview");
  const { loading } = useDesk();

  return (
    <>
      <TopBar tab={tab} onTab={setTab} />
      <main className="app">
        {loading ? (
          <section className="panel">
            <p className="muted">正在打开本地账本…</p>
          </section>
        ) : (
          <>
            {tab === "overview" && <OverviewTab go={setTab} />}
            {tab === "shows" && <ShowsTab />}
            {tab === "fixtures" && <FixturesTab />}
            {tab === "cues" && <CuesTab />}
            {tab === "review" && <ReviewTab />}
            {tab === "conflicts" && <ConflictsTab />}
            {tab === "sync" && <SyncTab />}
          </>
        )}
      </main>
      <footer className="footer">
        灯光排程台 · 离线账本 · 数据保存在本设备浏览器中，断网可续作
      </footer>
    </>
  );
}

export default function App() {
  return (
    <DeskProvider>
      <Shell />
    </DeskProvider>
  );
}
