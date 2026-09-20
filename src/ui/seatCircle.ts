/**
 * 参加者を円卓のように丸く配置するための座標計算。
 * 人数が多いと窮屈になるので、CIRCLE_LAYOUT_MAX_PLAYERS人まででのみ使う
 * （それを超える場合は、呼び出し側で一覧表示にフォールバックする）。
 */

/** これ以下の人数なら円形表示、これを超えたら一覧表示にフォールバックする */
export const CIRCLE_LAYOUT_MAX_PLAYERS = 6;

export interface CirclePosition {
  readonly left: string;
  readonly top: string;
}

/**
 * index番目（0始まり）の席の位置を、円の中心からの相対位置（%）で返す。
 * 12時の位置から時計回りに並べる。
 */
export function seatCirclePosition(index: number, total: number): CirclePosition {
  if (total <= 1) {
    return { left: "50%", top: "50%" };
  }
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  const radius = 40; // %
  const left = 50 + radius * Math.cos(angle);
  const top = 50 + radius * Math.sin(angle);
  return { left: `${left}%`, top: `${top}%` };
}
