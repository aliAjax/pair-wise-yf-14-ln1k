// 旧数据迁移提示条
import { useDesk } from "../lib/store";

export function MigrationBanner() {
  const { migration, migrationDismissed, dismissMigration, setActiveShowId, state } = useDesk();
  if (!migration || migrationDismissed) return null;

  const goReview = () => {
    const first = Object.keys(state.shows)[0];
    if (first) setActiveShowId(first);
    dismissMigration();
  };

  return (
    <section className="banner migration-banner">
      <div className="banner-body">
        <strong>检测到旧版数据，已自动迁入新账本</strong>
        <p>
          演出 {migration.shows} 场 · 灯具 {migration.fixtures} 台 · Cue {migration.cues} 条；
          其中 <b>{migration.missing}</b> 个字段缺失，已标记「待补全」，可在灯具/Cue 页逐条补录。
        </p>
      </div>
      <div className="banner-actions">
        <button onClick={goReview}>去补全</button>
        <button className="primary" onClick={dismissMigration}>
          知道了
        </button>
      </div>
    </section>
  );
}
