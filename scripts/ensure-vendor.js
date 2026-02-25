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

// archiver cannot be bundled by rollup (or any other bundler) because its
// dependency tree contains circular CJS requires that cause class parents to
// be undefined at evaluation time, resulting in:
//   "TypeError: Class extends value undefined is not a constructor or null"
// This is a known issue: https://github.com/archiverjs/node-archiver/issues/711
//
// To work around this, archiver is marked as external in rollup.config.js and
// we copy it (with all transitive deps) into lib/node_modules/ so Node's
// module resolution finds them next to lib/vbapm.js at runtime.
// create-packages.js already picks up lib/** via walkSync, so the copied
// packages are automatically included in the distribution zip.
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
