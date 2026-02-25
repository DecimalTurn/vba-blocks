const { promisify } = require("util");
const { join, dirname, basename } = require("path");
const { get: httpsGet } = require("https");
const { createWriteStream } = require("fs");
const { ensureDir, pathExists, remove, writeFile, readFile, copy } = require("fs-extra");
const tmpDir = promisify(require("tmp").dir);
const decompress = require("decompress");

const node_version = "v22.22.0";

// Node.js dropped win-x86 binaries after v22.x. For v23+, use win-x64 only.
function getWindowsArch(version) {
	const major = parseInt(version.replace(/^v/, "").split(".")[0], 10);
	return major >= 23 ? "x64" : "x86";
}
const vendor = join(__dirname, "../vendor");
const version = join(vendor, ".version");

main().catch(err => {
	console.error(err);
	process.exit(1);
});

const root = join(__dirname, "..");
const lib = join(root, "lib");

async function main() {
	await downloadNode();
	await vendorArchiver();
}

// WORKAROUND: archiver cannot be bundled by rollup because of a version
// mismatch in its dependency tree that breaks class inheritance at runtime.
// This is a known upstream issue:
//   https://github.com/archiverjs/node-archiver/issues/711
//
// The problem:
//
//   archiver ──► archiver-utils ──► lazystream ──► readable-stream@2
//      │                                              (nested node_modules)
//      ├──► zip-stream ──► compress-commons ──► readable-stream@4
//      │                        └──► crc32-stream ──► readable-stream@4
//      └──► readable-stream@4
//
//   lazystream pins readable-stream@^2, while every other package uses @^4.
//   readable-stream v2 has files like readable.js, passthrough.js, duplex.js.
//   readable-stream v4 moved to lib/ours/index.js and uses _stream_*.js shims.
//
//   Our readableStream() rollup plugin (in rollup.config.js) replaces
//   readable-stream with Node's built-in stream module by intercepting
//   files matching the v2 layout. When rollup bundles archiver, it resolves
//   both versions and the plugin only partially replaces them. Combined with
//   code splitting across multiple entry points, class parent references
//   (e.g. CRC32Stream extends Transform) end up undefined before they're
//   defined, causing:
//     "TypeError: Class extends value undefined is not a constructor or null"
//
// To work around this, archiver is marked as external in rollup.config.js and
// we copy it (with all transitive deps) into lib/node_modules/ so Node's
// module resolution finds them next to lib/vbapm.js at runtime.
// create-packages.js already picks up lib/** via walkSync, so the copied
// packages are automatically included in the distribution zip.
//
// TODO: Remove this workaround when archiver's tree uses a single
// readable-stream version (or drops it entirely in favor of Node streams).
// Run "npm run check:archiver" to test if bundling is safe again.
// If it prints PASS, you can:
//   1. Remove `id === "archiver" ||` from external() in rollup.config.js
//   2. Remove vendorArchiver() and related functions below
//   3. Delete scripts/check-archiver-bundling.js
async function vendorArchiver() {
	const src = join(root, "node_modules");
	const dest = join(lib, "node_modules");

	const visited = new Set();
	await copyModule("archiver", src, dest, visited);
	console.log(`Vendored archiver and ${visited.size} dependencies into lib/node_modules/`);
}

async function copyModule(name, src, dest, visited) {
	if (visited.has(name)) return;
	visited.add(name);

	const srcDir = join(src, name);
	if (!(await pathExists(srcDir))) return;

	const destDir = join(dest, name);
	await copyDir(srcDir, destDir);

	const pkgPath = join(srcDir, "package.json");
	if (!(await pathExists(pkgPath))) return;

	const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
	const deps = Object.keys(pkg.dependencies || {});
	for (const dep of deps) {
		await copyModule(dep, src, dest, visited);
	}

	// Some packages have nested node_modules/ with their own dependencies
	// (e.g. lazystream/node_modules/readable-stream). Those nested deps may
	// require packages hoisted to the top-level node_modules/ (e.g.
	// process-nextick-args). Walk nested node_modules/ to discover and copy
	// those transitive dependencies as well.
	const nestedModules = join(srcDir, "node_modules");
	if (await pathExists(nestedModules)) {
		const { readdirSync } = require("fs");
		const nested = readdirSync(nestedModules).filter(n => !n.startsWith("."));
		for (const nestedName of nested) {
			const nestedPkg = join(nestedModules, nestedName, "package.json");
			if (await pathExists(nestedPkg)) {
				const nestedMeta = JSON.parse(await readFile(nestedPkg, "utf8"));
				const nestedDeps = Object.keys(nestedMeta.dependencies || {});
				for (const dep of nestedDeps) {
					// Only copy if it's not already satisfied by the nested node_modules
					const nestedDepPath = join(nestedModules, dep);
					if (!(await pathExists(nestedDepPath))) {
						await copyModule(dep, src, dest, visited);
					}
				}
			}
		}
	}
}

async function copyDir(src, dest) {
	if (await pathExists(dest)) return; // already copied
	await ensureDir(dest);
	await copy(src, dest);
}

async function downloadNode() {
	const version_exists = await pathExists(version);
	const previous_version = version_exists && (await readFile(version, "utf8")).trim();

	if (previous_version === node_version) return;

	const base = `https://nodejs.org/dist/${node_version}/`;
	const winArch = getWindowsArch(node_version);
	const windows = `node-${node_version}-win-${winArch}.zip`;
	const mac = `node-${node_version}-darwin-x64.tar.gz`;

	console.log(`Downloading node ${node_version} (win-${winArch}, mac-x64)...`);

	const dir = await tmpDir();
	await Promise.all([
		download(`${base}${windows}`, join(dir, windows)),
		download(`${base}${mac}`, join(dir, mac))
	]);

	console.log("Unzipping node");

	const filename = file => {
		file.path = basename(file.path);
		return file;
	};

	await ensureDir(vendor);
	await Promise.all([
		decompress(join(dir, windows), vendor, {
			filter: file => /node\.exe$/.test(file.path),
			map: filename
		}),
		decompress(join(dir, mac), vendor, {
			filter: file => /node$/.test(file.path),
			map: filename
		})
	]);

	await remove(dir);
	await writeFile(join(vendor, ".version"), node_version);
}

async function download(url, dest) {
	await ensureDir(dirname(dest));

	return new Promise((resolve, reject) => {
		httpsGet(url, response => {
			try {
				const code = response.statusCode;
				if (code && code >= 400) {
					reject(new Error(`${code} ${response.statusMessage}`));
				} else if (code && code >= 300) {
					const location = response.headers.location;
					const redirect = Array.isArray(location) ? location[0] : location;

					download(redirect, dest).then(resolve, reject);
				} else {
					const file = createWriteStream(dest);
					response
						.pipe(file)
						.on("finish", () => resolve())
						.on("error", reject);
				}
			} catch (err) {
				console.error(err);
			}
		}).on("error", reject);
	});
}

module.exports = {
	versions: {
		node: node_version
	}
};
