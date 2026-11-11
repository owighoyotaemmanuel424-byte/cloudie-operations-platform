export function points(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}${Math.abs(rounded).toLocaleString("en-NG")}`;
}

export function naira(value: number): string {
  return `₦${Math.round(value).toLocaleString("en-NG")}`;
}

export function shortDate(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function relative(value: number): string {
  const diff = Date.now() - value;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(value);
}

export function countdown(value: number): string {
  const days = Math.ceil((value - Date.now()) / 86_400_000);
  if (days <= 0) return "due now";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
