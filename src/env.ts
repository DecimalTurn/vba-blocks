import envPaths from "env-paths";
import { Reporter, reporter } from "./reporter";
import { getStaging } from "./utils/get-staging";
import { join } from "./utils/path";

export interface Env {
	isWindows: boolean;
	cwd: string;
	values: any;

	data: string;
	config: string;
	cache: string;
	log: string;
	temp: string;

	addins: string;
	templates: string;
	scripts: string;
	registry: string;
	packages: string;
	sources: string;
	staging: string;

	reporter: Reporter;
	debug: (id: string) => (...values: any[]) => void;
	silent: boolean;
}

const paths = envPaths("vbapm", { suffix: "" });

const cache = paths.cache;
const root = join(__dirname, "../");

export const env: Env = {
	isWindows: process.platform === "win32",
	cwd: process.cwd(),
	values: process.env,

	...paths, // data, config, cache, log, temp
	addins: join(root, "addins/build"),
	templates: join(root, "templates"),
	scripts: join(root, "run-scripts"),
	registry: join(cache, "registry"),
	packages: join(cache, "packages"),
	sources: join(cache, "sources"),
	staging: getStaging(paths.temp),

	reporter,
	debug: id => {
		// Late-bind debug to allow loading --debug first
		let debug: (...args: any[]) => any;

		return (...args) => {
			if (!debug) {
				const _debug = require("./debug").default;
				debug = _debug(id);
			}

			return debug(...args);
		};
	},
	silent: false
};
