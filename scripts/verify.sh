#!/usr/bin/env bash
set -euo pipefail

echo "==> Root: typecheck"
bunx tsc -b --noEmit

echo "==> Root: tests"
bun test

echo "==> API: typecheck"
npm --prefix api run typecheck

echo "==> API: tests"
npm --prefix api test

echo
echo "All four commands exited 0."
echo "NOTE: this proves compilation and unit tests only."
echo "The following still require manual verification against a live Convex deployment:"
echo "  - escrow → credited reactive transition"
echo "  - insufficient-funds failure path with a real backend error"
