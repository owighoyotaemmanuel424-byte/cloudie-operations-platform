/**
 * Minimal browser-side replacement for Convex's generated API reference proxy.
 * The application resolves these names in src/lib/neonClient.tsx and calls the
 * same-origin Turso API; this module never opens a Convex connection.
 */
const FUNCTION_NAME_SYMBOL = Symbol.for("functionName");

type ApiReference = ((...args: unknown[]) => unknown) & Record<PropertyKey, unknown>;

function createReference(path: string[]): ApiReference {
  const target = function apiReference() { return createReference(path); };
  return new Proxy(target as ApiReference, {
    get(_target, property) {
      if (property === "_name" || property === FUNCTION_NAME_SYMBOL) {
        if (path.length === 0) return "";
        return path.length === 1 ? path[0] : `${path[0]}:${path.slice(1).join(".")}`;
      }
      if (property === "then") return undefined;
      if (property === "toJSON") return () => ({ _name: path.length > 1 ? `${path[0]}:${path.slice(1).join(".")}` : path[0] ?? "" });
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
