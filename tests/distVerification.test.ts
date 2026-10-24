import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyDistDirectory } from "../scripts/verify-dist.mjs";

const rootDir = path.resolve(import.meta.dir, "..");

describe("InfinityFree production MIME-type & asset integrity safeguards", () => {
  it("configures public/.htaccess with explicit JS/CSS MIME types, cache revalidation, and 404 for missing static assets", () => {
    const htaccess = fs.readFileSync(path.join(rootDir, "public/.htaccess"), "utf8");

    expect(htaccess).toContain("AddType text/javascript .js .mjs");
    expect(htaccess).toContain("AddType text/css .css");
    expect(htaccess).toContain('Header set Cache-Control "no-cache, no-store, must-revalidate"');
    expect(htaccess).toContain('Header merge Cache-Control "public, max-age=31536000, immutable"');
    expect(htaccess).toContain("RewriteCond %{REQUEST_URI} ^/assets/ [OR]");
    expect(htaccess).toContain("RewriteRule ^ - [R=404,L]");
    expect(htaccess).toContain("RewriteRule ^ /index.html [L]");
  });

  it("Rejects text/html responses for .js and .css requests in public/sw.js", () => {
    const sw = fs.readFileSync(path.join(rootDir, "public/sw.js"), "utf8");

    expect(sw).toContain("function hasValidAssetMimeType(url, response)");
    expect(sw).toContain('contentType.includes("text/html")');
    expect(sw).toContain('contentType.includes("javascript")');
    expect(sw).toContain('contentType.includes("text/css")');
  });

  it("bundles Dashboard and the app shell in the primary entry and consolidates lucide-react icons", () => {
    const mainTsx = fs.readFileSync(path.join(rootDir, "src/main.tsx"), "utf8");
    const viteConfig = fs.readFileSync(path.join(rootDir, "vite.config.ts"), "utf8");

    expect(mainTsx).toContain('import Dashboard from "./pages/Dashboard.tsx";');
    expect(mainTsx).toContain('import { AppShell } from "./components/nav/AppShell";');
    expect(mainTsx).toContain("window.addEventListener(\"vite:preloadError\"");
    expect(mainTsx).toContain("not a valid JavaScript MIME type");
    expect(viteConfig).toContain("if (id.includes('lucide-react')) return 'ui-icons';");
  });

  it("verifyDistDirectory catches missing referenced JS/CSS assets and validates complete dist output", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudie-dist-test-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "assets"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-123.css"><script type="module" src="/assets/index-123.js"></script></head><body><div id="root"></div></body></html>',
      );
      fs.writeFileSync(
        path.join(tmpDir, "assets/index-123.js"),
        'const deps = ["assets/chunk-abc.js"]; console.log(deps);',
      );
      fs.writeFileSync(path.join(tmpDir, "assets/index-123.css"), "body{margin:0}");
      fs.copyFileSync(path.join(rootDir, "public/.htaccess"), path.join(tmpDir, ".htaccess"));
      fs.copyFileSync(path.join(rootDir, "public/404.html"), path.join(tmpDir, "404.html"));
      fs.copyFileSync(path.join(rootDir, "public/sw.js"), path.join(tmpDir, "sw.js"));

      // Missing dynamic chunk should throw
      expect(() => verifyDistDirectory(tmpDir)).toThrow(/chunk-abc\.js/);

      // Present dynamic chunk should pass
      fs.writeFileSync(path.join(tmpDir, "assets/chunk-abc.js"), "export default 1;");
      const result = verifyDistDirectory(tmpDir);
      expect(result.htmlAssetCount).toBe(2);
      expect(result.dynamicChunkCount).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
