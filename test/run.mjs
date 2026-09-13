#!/usr/bin/env node
// 用 esbuild 把 TS 测试打包为 CJS 临时文件，再交给 node:test 运行
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "strata-test-"));
const out = join(dir, "tests.cjs");

try {
  await build({
    entryPoints: ["test/domain.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: out,
    logLevel: "warning",
  });
  const res = spawnSync(process.execPath, ["--test", out], { stdio: "inherit" });
  process.exit(res.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
