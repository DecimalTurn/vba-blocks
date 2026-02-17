import { createWriteStream, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { ZipFile } from "yazl";
import { getDefault } from "./interop";

/**
 * Recursively collect all file paths under `dir`.
 */
function collectFiles(dir: string, base: string = ""): { fullPath: string; zipPath: string }[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: { fullPath: string; zipPath: string }[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		const zipPath = base ? base + "/" + entry.name : entry.name;

		if (entry.isDirectory()) {
			files.push(...collectFiles(fullPath, zipPath));
		} else {
			files.push({ fullPath, zipPath });
		}
	}

	return files;
}

/**
 * Zip a directory into a file using yazl (no glob dependency).
 */
export async function zip(dir: string, file: string): Promise<void> {
	const files = collectFiles(dir);

	return new Promise<void>((resolve, reject) => {
		try {
			const zipfile = new ZipFile();
			const output = createWriteStream(file);

			output.on("close", () => resolve());
			output.on("error", reject);

			for (const { fullPath, zipPath } of files) {
				zipfile.addFile(fullPath, zipPath);
			}

			zipfile.outputStream.pipe(output);
			zipfile.end();
		} catch (err) {
			reject(err);
		}
	});
}

export interface UnzipOptions {
	filter?: (file: UnzipFile, index: number, files: UnzipFile[]) => boolean;
	map?: (file: UnzipFile, index: number, files: UnzipFile[]) => UnzipFile;
	plugins?: UnzipPlugin[];
	strip?: number;
}
export type UnzipPlugin = (buffer: Buffer) => Promise<UnzipFile[]>;

export interface UnzipFile {
	data: Buffer;
	mode: number;
	mtime: string;
	path: string;
	type: string;
}

export async function unzip(file: string, dest: string, options?: UnzipOptions): Promise<void> {
	const decompress = getDefault(await import("decompress"));

	await decompress(file, dest, options);
}
