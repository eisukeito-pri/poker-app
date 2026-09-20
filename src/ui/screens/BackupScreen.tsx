/**
 * バックアップ・データ管理画面。
 * - 書き出し：ファイルとしてダウンロードする
 * - 読み込み：ファイルを選ぶと、今のデータをすべて置き換える（確認必須）
 * - 全データ削除：確認必須
 * 読み込み・削除のあとは、起動時の状態判定をやり直すためページを再読み込みする。
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useShell } from "../ShellContext";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import { Banner } from "../components/Banner";

export function BackupScreen(): ReactNode {
  const { services, navigate, notify, notifyError, confirm } = useShell();
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleExport() {
    setBusy(true);
    try {
      const file = await services.backup.exportBackup();
      const blob = new Blob([file.content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      notify("バックアップを書き出しました。");
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChosen(file: File) {
    const content = await file.text();
    const ok = await confirm({
      title: "バックアップを読み込む",
      message: "今のデータをすべて、このファイルの内容に置き換えます。よろしいですか？",
      confirmLabel: "置き換える",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await services.backup.importBackup(content);
      notify("読み込みました。");
      window.location.reload();
    } catch (error) {
      notifyError(error);
      setBusy(false);
    }
  }

  async function handleWipe() {
    const ok = await confirm({
      title: "全データを削除する",
      message: "参加者・記録・進行中の対局を含む、すべてのデータを削除します。元に戻せません。",
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await services.backup.wipeAllData();
      notify("削除しました。");
      window.location.reload();
    } catch (error) {
      notifyError(error);
      setBusy(false);
    }
  }

  const goHome = () => navigate({ name: "Home" });

  return (
    <div className="screen screen-backup">
      <ScreenHeader title="バックアップ・データの管理" onBack={goHome} />

      {!services.isPersistent && (
        <Banner>
          この端末ではデータを保存できないため、バックアップの読み込み・削除の効果はこのタブの中だけです。
        </Banner>
      )}

      <section className="setup-section">
        <h2 className="setup-section-title">書き出し</h2>
        <p className="section-hint">参加者・記録・設定をまとめてファイルに保存します。</p>
        <Button fullWidth disabled={busy} onClick={handleExport}>
          バックアップを書き出す
        </Button>
      </section>

      <section className="setup-section">
        <h2 className="setup-section-title">読み込み</h2>
        <p className="section-hint">書き出したファイルから、今のデータを置き換えます。</p>
        <Button fullWidth disabled={busy} onClick={handleImportClick}>
          バックアップを読み込む
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFileChosen(file);
          }}
        />
      </section>

      <section className="setup-section">
        <h2 className="setup-section-title">全データの削除</h2>
        <p className="section-hint">このアプリのデータをすべて消します。</p>
        <Button variant="danger" fullWidth disabled={busy} onClick={handleWipe}>
          全データを削除する
        </Button>
      </section>
    </div>
  );
}
