/**
 * 参加者の名簿画面。登録・名前の変更・削除ができる。
 * 削除しても過去の記録（名前のスナップショット）には影響しない。
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import type { Player } from "../../domain/roster/types";

export function RosterScreen(): ReactNode {
  const { services, navigate, notifyError, confirm } = useShell();
  const [players, setPlayers] = useState<readonly Player[] | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setPlayers(await services.roster.list());
    } catch (error) {
      notifyError(error);
    }
  }

  useEffect(() => {
    load();
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await services.roster.register(name);
      setNewName("");
      await load();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(player: Player) {
    setEditingId(player.id);
    setEditingName(player.name);
  }

  async function commitEdit(id: string) {
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    setBusy(true);
    try {
      await services.roster.rename(id, name);
      await load();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(player: Player) {
    const ok = await confirm({
      title: "名簿から削除する",
      message: `${player.name}さんを名簿から削除します。過去の記録には影響しません。`,
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await services.roster.remove(player.id);
      await load();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  const goHome = () => navigate({ name: "Home" });

  return (
    <div className="screen screen-roster">
      <ScreenHeader title="参加者の名簿" onBack={goHome} />

      <div className="add-player-row">
        <input
          className="field-input"
          type="text"
          placeholder="新しい参加者の名前"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button onClick={handleAdd} disabled={busy}>
          追加
        </Button>
      </div>

      {players === null && <p className="loading-text">読み込み中…</p>}
      {players !== null && players.length === 0 && (
        <p className="placeholder-text">まだ参加者が登録されていません。</p>
      )}

      {players !== null && players.length > 0 && (
        <ul className="roster-list">
          {players.map((player) => (
            <li key={player.id} className="roster-item">
              {editingId === player.id ? (
                <input
                  className="field-input roster-edit-input"
                  type="text"
                  value={editingName}
                  autoFocus
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => commitEdit(player.id)}
                />
              ) : (
                <button
                  type="button"
                  className="roster-item-name"
                  onClick={() => startEdit(player)}
                  disabled={busy}
                >
                  {player.name}
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="削除"
                disabled={busy}
                onClick={() => handleRemove(player)}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
