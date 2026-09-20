/**
 * アプリの土台となる React Context。
 *
 * 画面（screens/）は、ここが提供するもの以外に何も知らなくてよい：
 * - services：ユースケース一式
 * - screen / navigate：画面遷移
 * - notify：エラーや完了をトースト（バナー）で知らせる
 * - confirm：確認ダイアログ（Promise<boolean>）
 *
 * 状態そのもの（現在の画面、トースト一覧、確認ダイアログの中身）は AppShell が持ち、
 * ここでは「渡し方」だけを決める。
 */
import { createContext, useContext } from "react";
import type { AppServices } from "./wiring";
import type { Screen } from "./navigation";

export interface NavigateOptions {
  /** true なら、履歴を1件消費せずに今の画面を置き換える（起動時の復元などに使う） */
  readonly replace?: boolean;
}

export type ToastKind = "info" | "error";

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

export interface ConfirmOptions {
  readonly title?: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** true なら、確認ボタンを警告色にする（削除・破棄など取り消せない操作） */
  readonly danger?: boolean;
}

export interface ShellContextValue {
  readonly services: AppServices;
  readonly screen: Screen;
  navigate(screen: Screen, options?: NavigateOptions): void;
  /** 短いメッセージを表示する。エラーは catch 節から notifyError() 経由で使うのが基本 */
  notify(message: string, kind?: ToastKind): void;
  /** DomainError などを、決まった文言に変換してから表示する */
  notifyError(error: unknown): void;
  /** 確認ダイアログを出す。true=確認、false=キャンセル（閉じた場合も false） */
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("useShell は AppShell の内側でのみ使えます");
  }
  return value;
}
