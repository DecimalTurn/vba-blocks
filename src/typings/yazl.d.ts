declare module "yazl" {
	import { Readable } from "stream";

	interface Options {
		mtime?: Date;
		mode?: number;
		compress?: boolean;
		forceZip64Format?: boolean;
		fileComment?: string;
	}

	interface EndOptions {
		forceZip64Format?: boolean;
	}

	export class ZipFile {
		outputStream: Readable;
		addFile(realPath: string, metadataPath: string, options?: Options): void;
		addBuffer(buffer: Buffer, metadataPath: string, options?: Options): void;
		addReadStream(readStream: NodeJS.ReadableStream, metadataPath: string, options?: Options): void;
		addEmptyDirectory(metadataPath: string, options?: Options): void;
		end(options?: EndOptions, finalSizeCallback?: (finalSize: number) => void): void;
	}
}
