import type { HTMLAttributes, ReactNode } from "react";
type CardProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };
export function Card({ children, className = "", ...props }: CardProps) { return <div {...props} className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>; }
