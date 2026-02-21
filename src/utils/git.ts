import * as fs from "fs";
import { env } from "../env";
import { pathExists } from "./fs";
import { join } from "./path";

const debug = env.debug("vba-blocks:git");
const DEFAULT_GIT_IDENTITY = {
	name: "vbapm",
	email: "vbapm@local"
};

async function loadGit() {
	const fetch = await import("node-fetch");
	(global as any).fetch = fetch.default;

	const git = await import("isomorphic-git");
	const httpNode = await import("isomorphic-git/http/node");

	return {
		git,
		http: httpNode.default
	};
}

export async function clone(remote: string, name: string, cwd: string) {
	const { git, http } = await loadGit();
	const dir = join(cwd, name);

	debug(`clone: ${remote} to ${dir}`);
	await git.clone({ fs, http, dir, url: remote, depth: 1 });
}

export async function pull(local: string) {
	const { git, http } = await loadGit();
	const ref = await git.currentBranch({ fs, dir: local, fullname: false });

	debug(`pull: ${local}${ref ? ` (${ref})` : ""}`);
	await git.pull({
		fs,
		http,
		dir: local,
		ref: ref || undefined,
		author: DEFAULT_GIT_IDENTITY,
		committer: DEFAULT_GIT_IDENTITY
	});
}

export async function init(dir: string) {
	const { git } = await loadGit();

	debug(`init: ${dir}`);
	await git.init({ fs, dir });
}

export async function isGitRepository(dir: string): Promise<boolean> {
	return await pathExists(join(dir, ".git"));
}
