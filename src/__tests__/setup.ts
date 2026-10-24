import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

// A real origin (not `about:blank`) so cookie-backed behaviour — the Neon
// double-submit CSRF token in particular — behaves the way it does in a browser.
GlobalRegistrator.register({ url: "http://localhost:3000/" });

const testingLibraryPath: string = "@testing-library/react";
const { cleanup } = await import(testingLibraryPath);
const jestDomPath: string = "@testing-library/jest-dom";
await import(jestDomPath);

afterEach(() => cleanup());
