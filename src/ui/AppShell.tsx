/**
 * アプリの土台。ここで1回だけ行うこと：
 * - サービス一式（ユースケース）を組み立てる
 * - 画面の状態を持ち、ブラウザの履歴（戻るボタン）と同期する
 * - 起動時に、進行中の対局があれば対局画面／結果入力画面へ自動で進む
 * - トースト通知と確認ダイアログの「置き場所」になる
 *
 * 画面（screens/）は useShell() 経由でこれらを使うだけで、
 * 保存の仕組みや組み立て方を知らなくてよい。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ScreenRouter } from "./ScreenRouter";
import type {
  ConfirmOptions,
  NavigateOptions,
  Toast,
  ToastKind,
} from "./ShellContext";
import { ShellContext } from "./ShellContext";
import { ConfirmDialogHost } from "./components/ConfirmDialogHost";
import type { ConfirmRequest } from "./components/ConfirmDialogHost";
import { LoadingScreen } from "./components/LoadingScreen";
import { ToastHost } from "./components/ToastHost";
import { toUserMessage } from "./errorMessages";
import { HOME_SCREEN, isScreen } from "./navigation";
import type { Screen } from "./navigation";
import { createAppServices } from "./wiring";

let nextToastId = 1;

export function AppShell(): ReactNode {
  const services = useMemo(() => createAppServices(), []);
  const [screen, setScreen] = useState<Screen>(HOME_SCREEN);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = "info") => {
    const toast: Toast = { id: nextToastId++, kind, message };
    setToasts((current) => [...current, toast]);
  }, []);

  const notifyError = useCallback(
    (error: unknown) => {
      notify(toUserMessage(error), "error");
    },
    [notify],
  );

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmRequest({
        options,
        resolve: (confirmed) => {
          setConfirmRequest(null);
          resolve(confirmed);
        },
      });
    });
  }, []);

  const navigate = useCallback((next: Screen, options: NavigateOptions = {}) => {
    if (options.replace) {
      window.history.replaceState(next, "");
    } else {
      window.history.pushState(next, "");
    }
    setScreen(next);
  }, []);

  // ブラウザ（や、PWAとしてインストールしたときの）戻る操作に対応する
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      setScreen(isScreen(event.state) ? event.state : HOME_SCREEN);
    };
    window.history.replaceState(HOME_SCREEN, "");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // 起動時：進行中の対局があれば、対局画面／結果入力画面から始める
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const view = await services.game.getCurrentGame();
        if (cancelled || !view) return;
        const destination: Screen =
          view.state.phase === "ResultPending" ? { name: "ResultInput" } : { name: "Game" };
        window.history.replaceState(destination, "");
        setScreen(destination);
      } catch (error) {
        if (!cancelled) notifyError(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [services, notifyError]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <ShellContext.Provider value={{ services, screen, navigate, notify, notifyError, confirm }}>
      <ScreenRouter />
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
      <ConfirmDialogHost request={confirmRequest} />
    </ShellContext.Provider>
  );
}
