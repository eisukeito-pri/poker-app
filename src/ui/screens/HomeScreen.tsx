/**
 * ホーム画面。対局を始める、記録や成績を見る、名簿やバックアップを管理する、の入り口。
 * 起動時にすでに進行中の対局があれば、AppShell がここを経由せず直接ゲーム画面へ進む。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";

export function HomeScreen(): ReactNode {
  const { services, navigate } = useShell();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const view = await services.settlement.getPendingSettlement();
        if (!cancelled) setPendingCount(view.pendingGames.length);
      } catch {
        // ホーム画面での取得失敗は静かに無視する（他の画面で改めてエラーになる）
      }
    })();
    return () => {
      cancelled = true;
    };
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="screen screen-home">
      <h1 className="app-title">ポーカー進行・記録</h1>

      {!services.isPersistent && (
        <Banner>
          この端末ではデータを保存できないため、タブを閉じると記録が消えます。
        </Banner>
      )}

      {pendingCount > 0 && (
        <Banner>
          未精算の対局が{pendingCount}件あります。
          <Button variant="primary" fullWidth onClick={() => navigate({ name: "Settlement" })}>
            精算して支払いへ
          </Button>
        </Banner>
      )}

      <div className="home-menu">
        <Button variant="primary" fullWidth onClick={() => navigate({ name: "Setup" })}>
          新しい対局を始める
        </Button>
        <Button fullWidth onClick={() => navigate({ name: "History" })}>
          対局の記録
        </Button>
        <Button fullWidth onClick={() => navigate({ name: "Stats" })}>
          通算成績
        </Button>
        <Button fullWidth onClick={() => navigate({ name: "Roster" })}>
          参加者の名簿
        </Button>
        <Button variant="ghost" fullWidth onClick={() => navigate({ name: "Backup" })}>
          バックアップ・データの管理
        </Button>
      </div>
    </div>
  );
}
