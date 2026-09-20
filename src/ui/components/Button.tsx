/** 卓上でも押しやすい、大きめのボタン。variant で見た目を切り替える */
import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "normal" | "large";

export interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
  readonly type?: "button" | "submit";
}

export function Button(props: ButtonProps): ReactNode {
  const {
    children,
    onClick,
    variant = "secondary",
    size = "normal",
    disabled = false,
    fullWidth = false,
    type = "button",
  } = props;

  const className = [
    "btn",
    `btn-${variant}`,
    size === "large" ? "btn-large" : "",
    fullWidth ? "btn-full" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={className} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
