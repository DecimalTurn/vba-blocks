import { copy, ensureDirSync, readFile, remove } from "fs-extra";
import { promisify } from "util";
import { run as _run } from "vba-blocks";
import walkSync from "walk-sync";
import { tmpFolder } from "../../src/utils/fs";
import { basename, extname, join, resolve } from "../../src/utils/path";
import { RunResult } from "../../src/utils/run";
import { truncate } from "../../src/utils/text";
const exec = promisify(require("child_process").exec);

export { RunResult };

const tmp_dir = join(__dirname, "../.tmp");
ensureDirSync(tmp_dir);
// To keep the tmp folder around for inspection, run `$env:KEEP_E2E_TMP=1` in PowerShell or `export KEEP_E2E_TMP=1` in bash before running the tests. The tmp folder is located at `tests/.tmp`.
const keepTmp = /^(1|true|yes)$/i.test(process.env.KEEP_E2E_TMP || "");

export async function tmp(id: string, action: (cwd: string) => void) {
	const path = await tmpFolder({ dir: tmp_dir, prefix: `${id}-` });

	try {
		await action(path);
	} finally {
		if (!keepTmp) {
			await remove(path);
		}
	}
}
/**
 * Sets up a temporary directory with the contents of `dir`, then runs `action` with the temporary directory as the current working directory. The temporary directory is removed after `action` completes, unless the environment variable `KEEP_E2E_TMP` is set to `1`, `true`, or `yes`.
 * @param dir The directory to copy into the temporary directory.
 * @param id A unique identifier for the temporary directory.
 * @param action The action to run with the temporary directory as the current working directory.
 */
export async function setup(dir: string, id: string, action: (cwd: string) => void): Promise<void> {
	await tmp(id, async path => {
		await copy(dir, path);
		await action(path);
	});
}

export async function execute(
	cwd: string,
	command: string
): Promise<{ stdout: string; stderr: string }> {
	const bin = resolve(__dirname, "../../bin/vba");
	const result = await exec(`${bin} ${command}`, { cwd });

	// Give Office time to clean up
	await wait(500);

	return result;
}

const isBackup = /\.backup/;
const isGit = /\.git[\/,\\]/;
const isBinary = (file: string) => [".xlsm", ".frx"].includes(extname(file));

export async function readdir(cwd: string): Promise<{ [path: string]: string }> {
	const files = walkSync(cwd, { directories: false });
	const details: { [file: string]: string } = {};
	for (const file of files) {
		if (isBackup.test(file) || isGit.test(file)) continue;

		// TEMP Need reproducible builds to compare binary results
		if (isBinary(file)) {
			details[file] = "<TODO>";
		} else {
			const data = await readFile(resolve(cwd, file), "utf8");
			details[file] = basename(file) === "vba-block.toml" ? data : truncate(normalize(data), 200);
		}
	}

	return details;
}

export async function run(
	application: string,
	file: string,
	macro: string,
	args: string[] = []
): Promise<RunResult> {
	let result;
	try {
		result = await _run(application, file, macro, args);

		// Give Office time to clean up
		await wait(500);
	} catch (err) {
		result = err.result;
	}

	return result;
}

async function wait(ms: number) {
	return new Promise(resolve => {
		setTimeout(() => resolve(), ms);
	});
}

function normalize(value: string): string {
	return value
		.replace(/\r/g, "{CR}")
		.replace(/\n/g, "{LF}")
		.replace(/\t/g, "{tab}");
}
