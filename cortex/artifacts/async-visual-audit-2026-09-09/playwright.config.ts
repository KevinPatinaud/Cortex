import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "../../playwright.config.ts";

export default defineConfig({ ...base, testDir: path.resolve("tests/e2e"), webServer: undefined,
  reporter: [["list"]], outputDir: path.resolve("artifacts/async-visual-audit-2026-09-09/e2e") });
