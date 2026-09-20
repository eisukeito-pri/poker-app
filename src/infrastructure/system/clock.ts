/** 実際の時刻を返すClock */
import type { Clock } from "../../application/types";
import type { IsoDateTime } from "../../domain/shared/types";

export const systemClock: Clock = {
  now(): IsoDateTime {
    return new Date().toISOString();
  },
};
