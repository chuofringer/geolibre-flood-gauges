#!/usr/bin/env node
// T6: package & registry conformance (plan §5). Runs the registry's own
// validator logic against our built artifact: imports the bundle, asserts
// exported id/name/version match plugin.json, activate/deactivate are
// functions, no activeByDefault, entry/style paths are contained in the
// bundle dir, and the total bundle stays under the size budget. This
// pre-empts the checks opengeos/geolibre-plugins CI runs on our PR.
import { stat, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const bundleDir = join(rootDir, "geolibre-plugin");
const manifestPath = join(bundleDir, "plugin.json");
const packageJsonPath = join(rootDir, "package.json");

const MAX_BUNDLE_BYTES = 1024 * 1024; // 1 MB sanity margin (plan C2), not a hard host limit

let failed = false;
function assert(cond, message) {
  if (!cond) {
    failed = true;
    console.error(`validate-plugin: FAIL — ${message}`);
  }
}

function assertContainedPath(root, candidate) {
  const normalizedRoot = resolve(root) + sep;
  assert(resolve(candidate).startsWith(normalizedRoot), `unsafe path escapes bundle dir: ${candidate}`);
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));

  assert(typeof manifest.id === "string" && manifest.id.length > 0, "plugin.json: missing id");
  assert(typeof manifest.name === "string" && manifest.name.length > 0, "plugin.json: missing name");
  assert(typeof manifest.version === "string" && manifest.version.length > 0, "plugin.json: missing version");
  assert(manifest.entry === "dist/index.js", `plugin.json: unexpected entry "${manifest.entry}"`);
  assert(manifest.style === "dist/style.css", `plugin.json: unexpected style "${manifest.style}"`);
  assert(!("activeByDefault" in manifest), "plugin.json must not set activeByDefault (registry README rule)");
  assert(
    manifest.version === pkg.version,
    `version mismatch: plugin.json ${manifest.version} !== package.json ${pkg.version}`,
  );

  if (failed) return report();

  const entryPath = join(bundleDir, manifest.entry);
  const stylePath = join(bundleDir, manifest.style);
  assertContainedPath(bundleDir, entryPath);
  assertContainedPath(bundleDir, stylePath);

  let entryStat, styleStat;
  try {
    entryStat = await stat(entryPath);
    styleStat = await stat(stylePath);
  } catch (err) {
    assert(false, `bundle artifacts missing — run "npm run build:geolibre" first (${err.message})`);
    return report();
  }

  const totalBytes = entryStat.size + styleStat.size;
  assert(
    totalBytes <= MAX_BUNDLE_BYTES,
    `bundle too large: ${totalBytes} bytes exceeds the ${MAX_BUNDLE_BYTES}-byte budget`,
  );

  // Simulate the registry validator's environment: it imports every
  // plugin bundle in ONE Node process, so an earlier plugin may have
  // polyfilled `window`. Our bundle must import cleanly even then.
  globalThis.window ??= {};
  const mod = await import(pathToFileURL(entryPath).href);
  const exported = mod.plugin ?? mod.default;
  assert(Boolean(exported), "bundle does not export a default or named `plugin`");
  if (exported) {
    assert(exported.id === manifest.id, `exported id "${exported.id}" !== plugin.json id "${manifest.id}"`);
    assert(
      exported.name === manifest.name,
      `exported name "${exported.name}" !== plugin.json name "${manifest.name}"`,
    );
    assert(
      exported.version === manifest.version,
      `exported version "${exported.version}" !== plugin.json version "${manifest.version}"`,
    );
    assert(typeof exported.activate === "function", "exported plugin.activate is not a function");
    assert(typeof exported.deactivate === "function", "exported plugin.deactivate is not a function");
  }

  if (!failed) {
    console.log(
      `validate-plugin: OK — ${manifest.id}@${manifest.version} — ${totalBytes} bytes ` +
        `(entry ${entryStat.size} + style ${styleStat.size})`,
    );
  }
  report();
}

function report() {
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
