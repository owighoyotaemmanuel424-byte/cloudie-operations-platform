/**
 * Minimal browser-side replacement for Convex's generated API reference proxy.
 * The application resolves these names in src/lib/neonClient.tsx and calls the
 * same-origin Turso API; this module never opens a Convex connection.
 */
const FUNCTION_NAME_SYMBOL = Symbol.for("functionName");

type ApiReference = ((...args: unknown[]) => unknown) & Record<PropertyKey, unknown>;

function referenceName(path: string[]): string {
  if (path.length < 2) return path[0] ?? "";
  return `${path.slice(0, -1).join("/") }:${path[path.length - 1]}`;
}

function createReference(path: string[]): ApiReference {
  const target = function apiReference() { return createReference(path); };
  return new Proxy(target as ApiReference, {
    get(_target, property) {
      if (property === "_name" || property === FUNCTION_NAME_SYMBOL) {
        return referenceName(path);
      }
      if (property === "then") return undefined;
      if (property === "toJSON") return () => ({ _name: referenceName(path) });
      if (property === Symbol.toStringTag) return "CloudieApiReference";
      return createReference([...path, String(property)]);
    },
    apply() {
      return createReference(path);
    },
  });
}

export const anyApi = createReference([]);
export const componentsGeneric = () => createReference(["components"]);
export const makeFunctionReference = (name: string) => createReference(name.split(":"));
