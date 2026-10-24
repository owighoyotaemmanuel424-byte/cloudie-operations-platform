import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "primary" | "secondary" | "danger"; children: ReactNode };
export function Button({ loading = false, variant = "primary", children, disabled, className = "", ...props }: ButtonProps) {
  const styles = { primary: "bg-indigo-600 text-white hover:bg-indigo-700", secondary: "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50", danger: "bg-red-600 text-white hover:bg-red-700" };
  return <button {...props} disabled={disabled || loading} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]} ${className}`}>{loading && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{children}</button>;
}
