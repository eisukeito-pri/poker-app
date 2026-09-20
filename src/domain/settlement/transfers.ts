/**
 * 送金回数が最小になる送金リストを求める。
 *
 * 1. 収支0円の人を除き、収支の絶対値が大きい順（同額なら入力順）に並べる
 * 2. 全員を「合計0のグループ」にできるだけ多く分ける（ビットDPによる厳密解）。
 *    n人がkグループに分かれるとき、送金は n−k 回で済む
 * 3. 複数の分け方があるときは、順位の高い人を含むグループから、順位の高い人を
 *    できるだけ多く含む形を選ぶ（決定的）
 * 4. 各グループ内は、受取額が最大の人と支払額が最大の人から順に組み合わせる
 */
import { yen } from "../shared/constructors";
import { DomainError } from "../shared/errors";
import type { PlayerId, Yen } from "../shared/types";
import type { Transfer, TransferMinimizer } from "./types";

/** 厳密解を求める人数の上限（2^16通りまで）。最大参加人数は10人なので通常は常に厳密解 */
const EXACT_LIMIT = 16;

interface Person {
  readonly playerId: PlayerId;
  readonly balance: number;
  /** 入力順（同額のときの順位決めに使う） */
  readonly order: number;
}

interface Party {
  readonly playerId: PlayerId;
  remaining: number;
}

/** groupA と groupB のうち、順位の高い人（下位ビット）をより多く含む方を優先するか */
function prefers(a: number, b: number): boolean {
  const diff = a ^ b;
  const lowestDiff = diff & -diff;
  return (a & lowestDiff) !== 0;
}

function splitIntoMaxZeroSumGroups(people: readonly Person[]): Person[][] {
  const count = people.length;
  const full = (1 << count) - 1;
  const sums = new Float64Array(1 << count);
  const best = new Int16Array(1 << count); // 並べ替えたときの「合計0の区切り」の最大数

  for (let mask = 1; mask <= full; mask++) {
    const lowBit = mask & -mask;
    const lowIndex = 31 - Math.clz32(lowBit);
    sums[mask] = (sums[mask ^ lowBit] ?? 0) + (people[lowIndex]?.balance ?? 0);
    let top = 0;
    for (let i = 0; i < count; i++) {
      const bit = 1 << i;
      if ((mask & bit) !== 0) top = Math.max(top, best[mask ^ bit] ?? 0);
    }
    best[mask] = top + (sums[mask] === 0 ? 1 : 0);
  }

  const groups: Person[][] = [];
  let rest = full;
  while (rest !== 0) {
    const lowBit = rest & -rest; // 残りの中で一番順位の高い人
    const others = rest ^ lowBit;
    const needed = (best[rest] ?? 0) - 1;
    let chosen = -1;
    for (let s = others; ; s = (s - 1) & others) {
      const candidate = s | lowBit;
      if (
        sums[candidate] === 0 &&
        (best[rest ^ candidate] ?? 0) === needed &&
        (chosen === -1 || prefers(candidate, chosen))
      ) {
        chosen = candidate;
      }
      if (s === 0) break;
    }
    if (chosen === -1) chosen = rest; // 到達しない想定の安全策
    groups.push(people.filter((_, i) => (chosen & (1 << i)) !== 0));
    rest ^= chosen;
  }
  return groups;
}

function indexOfLargest(list: readonly Party[]): number {
  let bestIndex = 0;
  let bestValue = -Infinity;
  list.forEach((party, index) => {
    if (party.remaining > bestValue) {
      bestValue = party.remaining;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function settleGroup(group: readonly Person[]): Transfer[] {
  const creditors: Party[] = group
    .filter((p) => p.balance > 0)
    .map((p) => ({ playerId: p.playerId, remaining: p.balance }));
  const debtors: Party[] = group
    .filter((p) => p.balance < 0)
    .map((p) => ({ playerId: p.playerId, remaining: -p.balance }));

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    const creditorIndex = indexOfLargest(creditors);
    const debtorIndex = indexOfLargest(debtors);
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    if (!creditor || !debtor) break;

    const amount = Math.min(creditor.remaining, debtor.remaining);
    transfers.push({
      from: debtor.playerId,
      to: creditor.playerId,
      amount: yen(amount),
    });
    creditor.remaining -= amount;
    debtor.remaining -= amount;
    if (creditor.remaining === 0) creditors.splice(creditorIndex, 1);
    if (debtor.remaining === 0) debtors.splice(debtorIndex, 1);
  }
  return transfers;
}

export function minimizeTransfers(
  balances: readonly { readonly playerId: PlayerId; readonly netYen: Yen }[],
): readonly Transfer[] {
  const total = balances.reduce<number>((sum, b) => sum + b.netYen, 0);
  if (total !== 0) {
    throw new DomainError(
      "RESULT_INVALID",
      "円換算後の収支の合計が0ではありません",
    );
  }

  const people: Person[] = balances
    .map((b, order) => ({ playerId: b.playerId, balance: b.netYen as number, order }))
    .filter((p) => p.balance !== 0)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.order - b.order);
  if (people.length === 0) return [];

  // 厳密解が求められない人数のときは、全員を1グループとして貪欲に組み合わせる
  const groups =
    people.length <= EXACT_LIMIT ? splitIntoMaxZeroSumGroups(people) : [people];
  return groups.flatMap((group) => settleGroup(group));
}

export const transferMinimizer: TransferMinimizer = {
  minimize: minimizeTransfers,
};
