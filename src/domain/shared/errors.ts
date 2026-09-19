/** ドメインルール違反を表すエラー。UIはcodeを見てメッセージを出し分ける */
export type DomainErrorCode =
  | "INVALID_SETTINGS" // 設定値が不正（総ハンド数0など）
  | "INVALID_PLAYERS" // 人数が範囲外、ID重複など
  | "NOT_PLAYING" // 対局中でない（結果入力待ちなのに操作した等）
  | "NO_MORE_HANDS" // 最終ハンドより先へは進めない
  | "PLAYER_NOT_FOUND"
  | "ALREADY_ELIMINATED"
  | "NOT_ELIMINATED"
  | "LAST_SURVIVOR" // 最後の生存者は脱落させられない
  | "NOTHING_TO_UNDO"
  | "NOT_RESULT_PENDING" // 結果入力の段階ではない
  | "RESULT_INCOMPLETE" // 結果が全員分そろっていない
  | "RESULT_INVALID"; // 開始チップ全額を超える負けなど

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
