// Bun's runner with happy-dom. The Vite build aliases `convex/react` to
// `@/lib/neonClient`, so this shim is what every page actually runs.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useQuery } from "@/lib/neonClient";

const originalFetch = globalThis.fetch;
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    return new Response(
      JSON.stringify({
        brand: { name: "Cloudie", tagline: "Operations", accentColor: "#10b981", footerNote: "" },
        support: { email: "", phone: "", hours: "", widgetEnabled: false, widgetTitle: "", widgetMessage: "", faqs: [] },
        quickActions: [],
        hasCustomBrand: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function Probe({ functionName }: { functionName: string }) {
  const [renders, setRenders] = useState(0);
  // A fresh object literal every render, exactly how pages call useQuery.
  useQuery(functionName, { limit: 10 });
  return (
    <button type="button" onClick={() => setRenders((value) => value + 1)}>
      rendered {renders}
    </button>
  );
}

describe("neon useQuery argument stability", () => {
  test("an inline argument object does not re-run the query effect on every render", async () => {
    const user = userEvent.setup();
    render(<Probe functionName="platform:getPublicConfig" />);

    await waitFor(() => expect(fetchCalls.length).toBe(1));

    await user.click(screen.getByRole("button", { name: /rendered 0/ }));
    await screen.findByRole("button", { name: /rendered 1/ });
    await user.click(screen.getByRole("button", { name: /rendered 1/ }));
    await screen.findByRole("button", { name: /rendered 2/ });

    // Three renders, one fetch: the effect is keyed on the argument values.
    expect(fetchCalls.length).toBe(1);
  });

  test("an unhandled query name settles instead of looping on render", async () => {
    const user = userEvent.setup();
    render(<Probe functionName="unknown:probe" />);

    await user.click(screen.getByRole("button", { name: /rendered 0/ }));
    await screen.findByRole("button", { name: /rendered 1/ });
  });
});
