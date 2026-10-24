import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { strict as assert } from "node:assert";

const root = process.cwd();
const walkDirs = [
  "src/pages/marketplace",
  "src/features/marketplace",
  "src/components/money",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [path] : [];
  });
}

const files = walkDirs.flatMap((directory) => sourceFiles(join(root, directory)));
const lines = files.flatMap((file) =>
  readFileSync(file, "utf8").split(/\r?\n/).map((line, index) => ({ file, line, number: index + 1 })),
);

test("marketplace source keeps NGN and points on separate lines", () => {
  const violations = lines.filter(({ line }) => line.includes("₦") && /point/i.test(line))
    .map(({ file, line, number }) => `${file}:${number}: ${line.trim()}`);
  assert.deepEqual(violations, [], `NGN and points appeared on the same source line:\n${violations.join("\n")}`);
});

test("marketplace money source uses semantic palette tokens", () => {
  const rawPalette = /\b(?:bg|text|border|ring|from|to|via)-(?:blue|slate|gray|zinc|neutral|indigo|red|green|amber|rose|orange|yellow|lime|emerald|teal|cyan|sky|violet|purple|fuchsia|pink)-(?:[1-9]00|50|950)\b/;
  const violations = lines.filter(({ line }) => rawPalette.test(line))
    .map(({ file, line, number }) => `${file}:${number}: ${line.trim()}`);
  assert.deepEqual(violations, [], `Raw palette classes found:\n${violations.join("\n")}`);
});

test("marketplace money source avoids hard-coded hex colors except token-ok lines", () => {
  const hexLiteral = /#[0-9a-fA-F]{3,8}\b/;
  const violations = lines.filter(({ line }) => hexLiteral.test(line) && !line.includes("// token-ok"))
    .map(({ file, line, number }) => `${file}:${number}: ${line.trim()}`);
  assert.deepEqual(violations, [], `Hex color literals found:\n${violations.join("\n")}`);
});

test("marketplace UI avoids elevation shadows outside dialog and popover overlays", () => {
  const shadowClass = /\bshadow-(?:sm|md|lg|xl|2xl)\b/;
  const violations = lines.filter(({ file, line }) =>
    (file.includes("/pages/marketplace/") || file.includes("/features/marketplace/")) &&
    shadowClass.test(line) && !/Dialog\.Content|Popover\.Content/.test(line),
  ).map(({ file, line, number }) => `${file}:${number}: ${line.trim()}`);
  assert.deepEqual(violations, [], `Surface shadow classes found:\n${violations.join("\n")}`);
});
