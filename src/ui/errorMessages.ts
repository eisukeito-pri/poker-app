/**
 * DomainError を、画面に出す日本語のメッセージに変換する。
 * どの画面もこの1か所を通せば、メッセージの言い回しがそろう。
 */
import { DomainError } from "../domain/shared/errors";
import type { DomainErrorCode } from "../domain/shared/errors";

const MESSAGES: Record<DomainErrorCode, string> = {
  INVALID_SETTINGS: "設定の値が正しくありません。",
  INVALID_PLAYERS: "参加者の指定が正しくありません。",
  NOT_PLAYING: "この操作は今はできません。",
  NO_MORE_HANDS: "これ以上ハンドを進められません。",
  CANNOT_END_YET: "まだ結果入力には進めません。",
  PLAYER_NOT_FOUND: "参加者が見つかりません。",
  ALREADY_ELIMINATED: "すでに脱落しています。",
  NOT_ELIMINATED: "脱落していません。",
  LAST_SURVIVOR: "最後の一人は脱落させられません。",
  NOTHING_TO_UNDO: "これ以上戻せません。",
  NOT_RESULT_PENDING: "結果入力の段階ではありません。",
  RESULT_INCOMPLETE: "まだ入力が終わっていない人がいます。",
  RESULT_INVALID: "入力値が正しくありません。範囲を確認してください。",
  INVALID_PLAYER_NAME: "名前は1〜20文字で入力してください。",
  DUPLICATE_PLAYER_NAME: "同じ名前がすでに登録されています。",
  DUPLICATE_RECORD: "この対局はすでに記録されています。",
  INVALID_BACKUP: "バックアップファイルを読み込めませんでした。",
  UNSUPPORTED_BACKUP_VERSION: "新しいバージョンのアプリで作られたバックアップです。アプリを更新してください。",
  STORAGE_FAILED: "保存できませんでした。端末の空き容量を確認してください。",
  STORAGE_CORRUPTED: "保存されているデータが壊れています。",
  GAME_IN_PROGRESS: "進行中の対局があります。",
  NO_CURRENT_GAME: "進行中の対局がありません。",
  RECORD_NOT_FOUND: "記録が見つかりません。",
  NO_PENDING_SETTLEMENT: "未精算の対局がありません。",
  SETTLEMENT_NOT_FOUND: "精算の記録が見つかりません。",
  BOUNTY_RECIPIENT_REQUIRED: "脱落させた人を選んでください。",
  INVALID_BOUNTY_RECIPIENT: "脱落させた人の指定が正しくありません。",
};

/** 画面に出すためのメッセージ。DomainError以外は汎用の文言にする */
export function toUserMessage(error: unknown): string {
  if (error instanceof DomainError) {
    return MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return "予期しないエラーが発生しました。";
}

/** DomainErrorなら code を返す。画面の分岐に使う（例：GAME_IN_PROGRESSなら確認ダイアログを出す） */
export function errorCodeOf(error: unknown): DomainErrorCode | null {
  return error instanceof DomainError ? error.code : null;
}
