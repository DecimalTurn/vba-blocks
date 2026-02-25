/**
 * check-archiver-bundling.js
 *
 * Validates that archiver still cannot be safely bundled by rollup, confirming
 * the vendoring workaround in ensure-vendor.js is still necessary.
 *
 * Background:
 *   archiver's dependency tree contains a readable-stream version mismatch
 *   (v2 in lazystream, v4 everywhere else) that causes rollup's module
 *   flattening to place class definitions after their consumers, resulting in:
 *     "TypeError: Class extends value undefined is not a constructor or null"
 *   See: https://github.com/archiverjs/node-archiver/issues/711
 *
 * How it works:
 *   1. Runs a temporary rollup build with archiver NOT marked as external,
 *      using multiple entry points to trigger code splitting (required to
 *      reproduce the issue).
 *   2. Attempts to run the bundled output.
 *   3. Expects the bundled archiver to FAIL — confirming the workaround is
 *      still justified.
 *
 * Exit codes:
 *   0 (PASS) — archiver bundling still fails; vendoring workaround is justified.
 *   1 (FAIL) — archiver bundling now works! The vendoring workaround can be
 *              removed. Follow the instructions in the output.
 *
 * Usage:
 *   node scripts/check-archiver-bundling
 *   npm run check:archiver
 *
 *  * If this script prints FAILS, you can safely:
 *   1. Remove `id === "archiver" ||` from the external() function in rollup.config.js
 *   2. Remove the vendorArchiver() call and related functions from scripts/ensure-vendor.js
 *   3. Remove this script
 *
 *
 */

const { join } = require("path");
const { writeFileSync, mkdirSync, unlinkSync, rmSync } = require("fs");
const { execSync } = require("child_process");

const root = join(__dirname, "..");
const tmpDir = join(root, ".archiver-bundle-test");

async function main() {
	console.log("Testing whether archiver can be bundled by rollup...\n");

	// 1. Create multiple entry files so rollup code-splits archiver into a
	//    shared chunk — this is what triggers the circular dependency bug.
	//    A single entry point does NOT reproduce the issue.
	mkdirSync(tmpDir, { recursive: true });
	const outDir = join(tmpDir, "out");

	// Use ESM syntax for entries — mirrors the real .ts sources which use
	// `import`. The commonjs plugin only processes node_modules/, so CJS
	// entries would leave require("./shared.js") unresolved by rollup.
	const mainEntry = join(tmpDir, "main.mjs");
	writeFileSync(
		mainEntry,
		`
import { doZip } from "./shared.mjs";
doZip().then(() => {
  console.log("__ARCHIVER_OK__");
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
`
	);

	const secondEntry = join(tmpDir, "second.mjs");
	writeFileSync(
		secondEntry,
		`
// A second entry that also imports the shared module, forcing rollup
// to extract archiver into a separate chunk (code splitting).
import { doZip } from "./shared.mjs";
export { doZip };
`
	);

	const sharedModule = join(tmpDir, "shared.mjs");
	writeFileSync(
		sharedModule,
		`
import archiver from "archiver";
import { PassThrough } from "stream";

export function doZip() {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const sink = new PassThrough();
    archive.pipe(sink);
    archive.on("error", reject);
    archive.append("hello", { name: "test.txt" });
    archive.finalize();
    sink.on("end", resolve);
    sink.resume();
  });
}
`
	);

	// 2. Create a rollup config that closely mirrors the real rollup.config.js:
	//    - Multiple entry points (triggers code splitting)
	//    - Output to a directory (not a single file)
	//    - All the same plugins: resolve, replace, commonjs, json, terser, readableStream
	const rollupConfig = join(tmpDir, "rollup.config.mjs");
	writeFileSync(
		rollupConfig,
		`
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import { terser } from "rollup-plugin-terser";

// Replicate the readableStream() plugin from rollup.config.js
function readableStream() {
  const isReadable = /readable\\-stream[\\\\,\\/]readable\\.js/;
  const isPassthrough = /readable\\-stream[\\\\,\\/]passthrough\\.js/;
  const isDuplex = /readable\\-stream[\\\\,\\/]duplex\\.js/;

  return {
    name: "readable-stream",
    load(id) {
      if (isReadable.test(id)) {
        return {
          code: \`
            const Stream = require('stream');
            exports = module.exports = Stream.Readable;
            exports.Readable = Stream.Readable;
            exports.Writable = Stream.Writable;
            exports.Duplex = Stream.Duplex;
            exports.Transform = Stream.Transform;
            exports.PassThrough = Stream.PassThrough;
            exports.Stream = Stream;
          \`
        };
      }
      if (isPassthrough.test(id)) {
        return { code: \`module.exports = require('stream').PassThrough;\` };
      }
      if (isDuplex.test(id)) {
        return { code: \`module.exports = require('stream').Duplex;\` };
      }
      return null;
    }
  };
}

export default {
  input: [${JSON.stringify(mainEntry)}, ${JSON.stringify(secondEntry)}],
  output: {
    format: "cjs",
    dir: ${JSON.stringify(outDir)},
    entryFileNames: "[name].js",
    chunkFileNames: "[name].js",
    exports: "auto"
  },
  external: [/^node:/],
  plugins: [
    resolve(),
    replace({
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.env.READABLE_STREAM": '"disable"',
      "require.cache": "{}"
    }),
    commonjs({ include: "node_modules/**" }),
    json(),
    terser(),
    readableStream()
  ],
  onwarn() {} // suppress warnings
};
`
	);

	// 3. Run rollup
	let bundleOk = false;
	try {
		execSync(`npx rollup -c ${JSON.stringify(rollupConfig)}`, {
			cwd: root,
			stdio: "pipe",
			timeout: 60000
		});
		bundleOk = true;
	} catch (err) {
		console.log("PASS - rollup cannot bundle archiver (build failed).\n");
		console.log("The vendoring workaround in ensure-vendor.js is still needed.");
		console.log("Rollup error:", err.stderr?.toString().trim() || err.message);
		cleanup();
		process.exit(0);
	}

	// 4. Try to execute the bundled file
	if (bundleOk) {
		try {
			const result = execSync(`node ${JSON.stringify(join(outDir, "main.js"))}`, {
				cwd: root,
				stdio: "pipe",
				timeout: 10000
			});
			const output = result.toString();
			if (output.includes("__ARCHIVER_OK__")) {
				console.log("FAIL - archiver can now be safely bundled by rollup!\n");
				console.log("The vendoring workaround is no longer needed. You should:");
				console.log('  1. Remove `id === "archiver" ||` from external() in rollup.config.js');
				console.log(
					"  2. Remove vendorArchiver() and related functions from scripts/ensure-vendor.js"
				);
				console.log("  3. Delete this script (scripts/check-archiver-bundling.js)");
				console.log('  4. Remove the "check:archiver" script from package.json');
				cleanup();
				process.exit(1);
			}
		} catch (err) {
			const stderr = err.stderr?.toString().trim() || "";
			console.log("PASS - bundled archiver crashes at runtime.\n");
			console.log("The vendoring workaround in ensure-vendor.js is still needed.");
			if (stderr.includes("Class extends value undefined") || stderr.includes("superCtor")) {
				console.log(
					"Reason: readable-stream version mismatch still causes class inheritance failures."
				);
				console.log("See: https://github.com/archiverjs/node-archiver/issues/711");
			} else {
				console.log("Runtime error:", stderr || err.message);
			}
			cleanup();
			process.exit(0);
		}
	}

	cleanup();
}

function cleanup() {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// best effort
	}
}

main().catch(err => {
	console.error(err);
	cleanup();
	process.exit(1);
});
