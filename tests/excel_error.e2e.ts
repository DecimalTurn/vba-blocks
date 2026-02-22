import { exec as _exec } from "child_process";
import envPaths from "env-paths";
import { copy, pathExists, writeFile } from "fs-extra";
import { join } from "path";
import { promisify } from "util";
import { empty, json, single, standard, targetless } from "./__fixtures__";
import { execute, readdir, run, RunResult, setup, tmp } from "./__helpers__/execute";

const exec = promisify(_exec);
const cache = getRegistryCachePath();

jest.setTimeout(60000);

expect.addSnapshotSerializer({
	test: value => isSnapshotFileMap(value),
	print: value => formatSnapshotFileMap(value as { [path: string]: string })
});

function isSnapshotFileMap(value: any): value is { [path: string]: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const entries = Object.entries(value);
	if (!entries.length) {
		return false;
	}

	return (
		entries.every(([_, contents]) => typeof contents === "string") &&
		entries.some(([path]) => path.includes("/") || path.endsWith(".toml"))
	);
}

function formatSnapshotFileMap(value: { [path: string]: string }): string {
	const lines = ["Object {"];

	for (const [path, contents] of Object.entries(value)) {
		if (contents.includes("\n")) {
			lines.push(`  ${quote(path)}:`);
			lines.push(`  ${quote(contents)},`);
		} else {
			lines.push(`  ${quote(path)}: ${quote(contents)},`);
		}
	}

	lines.push("}");
	return lines.join("\n");
}

function quote(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

beforeAll(async () => {
	if (!(await pathExists(cache))) {
		throw new Error(`Expected local registry cache at ${cache}`);
	}

	await prepareDivergedRegistry(cache);
});

afterAll(async () => {
	await restoreRegistry(cache);
});

describe("build", () => {
	test("build standard project", async () => {
		await setup(standard, "build", async cwd => {
			await execute(cwd, "build");

			const result = await validateBuild(cwd, "standard.xlsm");
			expect(result).toMatchSnapshot();
		});
	});

	test("build project with single target", async () => {
		await setup(single, "build-single", async cwd => {
			await execute(cwd, "build");

			const result = await validateBuild(cwd, "single.xlsm");
			expect(result).toMatchSnapshot();
		});
	});

	test("build project with no target", async () => {
		await setup(targetless, "build-targetless", async cwd => {
			await execute(cwd, "build --target xlsm");

			const result = await validateBuild(cwd, "targetless.xlsm");
			expect(result).toMatchSnapshot();
		});
	});
});

describe("export", () => {
	test("export to empty project", async () => {
		await setup(empty, "export-empty", async cwd => {
			await setup(standard, "export-standard", async built => {
				await execute(built, "build");
				await copy(join(built, "build/standard.xlsm"), join(cwd, "build/empty.xlsm"));

				const { stdout } = await execute(cwd, "export --target xlsm");

				const result = await readdir(cwd);
				expect(result).toMatchSnapshot();
				expect(stdout).toMatchSnapshot();
			});
		});
	});

	test("export to project with dependency", async () => {
		await setup(json, "export-json", async cwd => {
			await setup(standard, "export-standard-to-json", async built => {
				await execute(built, "build");
				await copy(join(built, "build/standard.xlsm"), join(cwd, "build/json.xlsm"));

				const { stdout } = await execute(cwd, "export --target xlsm");

				const result = await readdir(cwd);
				expect(result).toMatchSnapshot();
				expect(stdout).toMatchSnapshot();
			});
		});
	});
});

describe("new", () => {
	test("should create blank package", async () => {
		await tmp("new-blank-package", async cwd => {
			await execute(cwd, "new blank-package --package --no-git");

			const result = await readdir(join(cwd, "blank-package"));
			expect(result).toMatchSnapshot();
		});
	});

	test("should create with blank target", async () => {
		await tmp("new-blank-target", async cwd => {
			await execute(cwd, "new blank-target.xlsm");

			const result = await readdir(join(cwd, "blank-target"));
			expect(result).toMatchSnapshot();
		});
	});

	test("should create from existing", async () => {
		await tmp("new-existing-target", async cwd => {
			await setup(standard, "new-existing-target-build", async built => {
				await execute(built, "build");
				await execute(cwd, `new existing-target --from ${join(built, "build/standard.xlsm")}`);

				const result = await readdir(join(cwd, "existing-target"));
				expect(result).toMatchSnapshot();
			});
		});
	});
});

describe("version", () => {
	test("should update to explicit version", async () => {
		await tmp("new-blank-package", async cwd => {
			await execute(cwd, "new blank-package --package --no-git");

			const dir = join(cwd, "blank-package");
			await execute(dir, "version v2.0.0");

			const result = await readdir(dir);
			expect(result).toMatchSnapshot();
		});
	});

	test("should update by increment and preid", async () => {
		await tmp("new-blank-package", async cwd => {
			await execute(cwd, "new blank-package --package --no-git");

			const dir = join(cwd, "blank-package");
			await execute(dir, "version preminor --preid beta");

			const result = await readdir(dir);
			expect(result).toMatchSnapshot();
		});
	});
});

function getRegistryCachePath(): string {
	const paths = envPaths("vbapm", { suffix: "" });
	return join(paths.cache, "registry", "vba-blocks");
}

async function prepareDivergedRegistry(cache: string): Promise<void> {
	await runAllowFailure(`git -C "${cache}" fetch --deepen=50 origin master`);
	await runCommand(`git -C "${cache}" fetch origin master`);
	await runCommand(`git -C "${cache}" checkout master`);
	await runCommand(`git -C "${cache}" reset --hard origin/master`);
	await runCommand(`git -C "${cache}" reset --hard "HEAD^"`);
	await runCommand(`git -C "${cache}" config user.name "vbapm"`);
	await runCommand(`git -C "${cache}" config user.email "vbapm@local"`);
	await writeFile(join(cache, "cat.txt"), "meow\n", "utf8");
	await runCommand(`git -C "${cache}" add cat.txt`);
	await runCommand(
		`git -C "${cache}" commit -m "test: add cat.txt for registry recovery scenario"`
	);
}

async function restoreRegistry(cache: string): Promise<void> {
	await runCommand(`git -C "${cache}" fetch origin master --depth=1`);
	await runCommand(`git -C "${cache}" checkout master`);
	await runCommand(`git -C "${cache}" reset --hard origin/master`);
}

async function validateBuild(cwd: string, target: string): Promise<RunResult> {
	const file = join(cwd, "build", target);
	return await run("excel", file, "Validation.Validate");
}

async function runCommand(command: string): Promise<void> {
	try {
		await exec(command);
	} catch (error: any) {
		const stdout = error?.stdout || "";
		const stderr = error?.stderr || "";
		throw new Error(`Command failed: ${command}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
	}
}

async function runAllowFailure(command: string): Promise<void> {
	try {
		await exec(command);
	} catch {
		// Ignore expected non-critical failures in setup/cleanup helpers
	}
}
