/**
 * 共通の型：ブランド型（値の取り違え防止）と単位
 */

declare const brand: unique symbol;

/** プリミティブ値に「意味」を付けるためのブランド型 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PlayerId = Brand<string, "PlayerId">;
export type GameId = Brand<string, "GameId">;

/** チップ数（整数）。収支を表すときは負の値もとる */
export type Chips = Brand<number, "Chips">;

/** 円（整数）。収支を表すときは負の値もとる */
export type Yen = Brand<number, "Yen">;

/**
 * 換算レート：1チップあたりの金額を「1/1000円」単位の整数で保持する。
 * 例）1チップ＝0.1円 → 100、1チップ＝1円 → 1000
 * 小数の誤差を避けるため内部では整数で扱う（入力は小数第3位まで）。
 */
export type MilliYenPerChip = Brand<number, "MilliYenPerChip">;

/** ハンド数（1始まり） */
export type HandNumber = Brand<number, "HandNumber">;

/** ISO 8601 形式の日時文字列 */
export type IsoDateTime = string;

/** 参加人数の上下限 */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
