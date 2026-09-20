/**
 * 通算成績画面。収支の合計が多い順（ユースケース側ですでに並んでいる）に表示する。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { ScreenHeader } from "../components/ScreenHeader";
import type { PlayerStats } from "../../domain/roster/types";

function formatYen(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("ja-JP")}円`;
}

export function StatsScreen(): ReactNode {
  const { services, navigate, notifyError } = useShell();
  const [stats, setStats] = useState<readonly PlayerStats[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setStats(await services.history.getPlayerStats());
      } catch (error) {
        notifyError(error);
      }
    })();
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goHome = () => navigate({ name: "Home" });

  return (
    <div className="screen screen-stats">
      <ScreenHeader title="通算成績" onBack={goHome} />

      {stats === null && <p className="loading-text">読み込み中…</p>}
      {stats !== null && stats.length === 0 && (
        <p className="placeholder-text">まだ記録がありません。</p>
      )}

      {stats !== null && stats.length > 0 && (
        <ul className="stats-list">
          {stats.map((s, index) => (
            <li key={s.playerId} className="stats-item">
              <span className="stats-rank">{index + 1}</span>
              <span className="stats-name">{s.name}</span>
              <span className="stats-record">
                {s.wins}勝{s.losses}敗{s.draws}分・{s.gamesPlayed}回
              </span>
              <span
                className={`stats-total${
                  s.totalNetYen > 0 ? " is-positive" : s.totalNetYen < 0 ? " is-negative" : ""
                }`}
              >
                {formatYen(s.totalNetYen)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
