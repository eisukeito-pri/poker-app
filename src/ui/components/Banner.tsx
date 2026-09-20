/** 画面の上に出す、常時表示の注意書き（例：この端末では保存が残らない） */
import type { ReactNode } from "react";

export interface BannerProps {
  readonly children: ReactNode;
}

export function Banner(props: BannerProps): ReactNode {
  return <div className="banner">{props.children}</div>;
}
