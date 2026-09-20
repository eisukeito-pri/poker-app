/** ドメインルール違反を表すエラー。UIはcodeを見てメッセージを出し分ける */
export type DomainErrorCode =
  | "INVALID_SETTINGS" // 設定値が不正（総ハンド数0など）
  | "INVALID_PLAYERS" // 人数が範囲外、ID重複など
  | "NOT_PLAYING" // 対局中でない（結果入力待ちなのに操作した等）
  | "NO_MORE_HANDS" // 最終ハンドより先へは進めない
  | "CANNOT_END_YET" // 最終ハンドでも生存者1人でもないのに結果入力へ進もうとした
  | "PLAYER_NOT_FOUND"
  | "ALREADY_ELIMINATED"
  | "NOT_ELIMINATED"
  | "LAST_SURVIVOR" // 最後の生存者は脱落させられない
  | "NOTHING_TO_UNDO"
  | "NOT_RESULT_PENDING" // 結果入力の段階ではない
  | "RESULT_INCOMPLETE" // 結果が全員分そろっていない
  | "RESULT_INVALID" // 開始チップ全額を超える負けなど
  | "INVALID_PLAYER_NAME" // 名前が空、または長すぎる
  | "DUPLICATE_PLAYER_NAME" // 同じ名前がすでに名簿にある
  | "DUPLICATE_RECORD" // 同じ対局の記録がすでにある
  | "INVALID_BACKUP" // バックアップの形式が不正
  | "UNSUPPORTED_BACKUP_VERSION" // 新しい（未対応の）バージョンのバックアップ
  | "STORAGE_FAILED" // 保存・読み込みに失敗（容量超過など）
  | "STORAGE_CORRUPTED" // 保存されているデータが壊れている
  | "GAME_IN_PROGRESS" // 進行中の対局があるため、新しい対局を始められない
  | "NO_CURRENT_GAME" // 進行中の対局がない
  | "RECORD_NOT_FOUND"; // 指定した記録がない

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
