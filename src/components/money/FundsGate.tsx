import type { ReactNode } from "react";

export type Naira = Readonly<{ kind: "naira"; kobo: number }>;
export type Points = Readonly<{ kind: "points"; amount: number }>;

export const naira = (kobo: number): Naira => {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new RangeError("Naira must be a non-negative integer number of kobo.");
  return { kind: "naira", kobo };
};

export const points = (amount: number): Points => {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Points must be a non-negative integer.");
  return { kind: "points", amount };
};

export function fmtNaira(value: Naira): string {
  if (value.kind !== "naira") throw new TypeError("Expected Naira.");
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value.kobo / 100);
}

export function fmtPoints(value: Points, options: { sign?: boolean } = {}): string {
  if (value.kind !== "points") throw new TypeError("Expected Points.");
  return `${options.sign && value.amount > 0 ? "+" : ""}${value.amount.toLocaleString("en-NG")} points`;
}

export function FundsGate({ children, balance, cost, fallback }: {
  children: ReactNode;
  balance: Naira;
  cost: Naira;
  fallback?: ReactNode;
}) {
  if (balance.kind !== "naira" || cost.kind !== "naira") {
    throw new TypeError("FundsGate accepts NGN values only.");
  }
  return balance.kobo >= cost.kobo ? children : (fallback ?? <p role="alert" className="text-sm text-destructive">Insufficient NGN wallet balance.</p>);
}
