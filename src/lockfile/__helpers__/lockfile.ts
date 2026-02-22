export function normalizeLockfile(lockfile: string): string {
	return lockfile.replace(/vbapm v\d.\d.\d/g, "vbapm v#.#.#");
}
