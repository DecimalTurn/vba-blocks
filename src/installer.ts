import { differenceInCalendarDays } from "date-fns";
import { gt as semverGreaterThan } from "semver";
import fetch from "node-fetch";
import { version as currentVersion } from "../package.json";
import { cache } from "./cache";
import { env } from "./env";

const debug = env.debug("vbapm:installer");

const NPM_PACKAGE_NAME = "@vbapm/core";

export function updateVersion(): string | undefined {
	return cache.latest_version;
}

export function updateAvailable(): boolean {
	// Previously checked version is greater
	const latestKnownVersion = cache.latest_version;
	return !!latestKnownVersion && semverGreaterThan(latestKnownVersion, currentVersion);
}

export async function checkForUpdate(): Promise<boolean> {
	// Only check for new version once per day
	const lastChecked = cache.latest_version_checked;
	if (lastChecked && differenceInCalendarDays(new Date(lastChecked), Date.now()) < 1)
		return updateAvailable();

	// Allow skipping from the outside
	// set VBA_BLOCKS_SKIP_UPDATE_CHECK=1
	//
	// (maybe this should be added to config)
	if (parseInt(env.values.VBA_BLOCKS_SKIP_UPDATE_CHECK, 10)) return false;

	cache.latest_version_checked = Date.now();

	try {
		const response = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`);
		const data: any = await response.json();
		const latestVersion: string = data.version;
		cache.latest_version = latestVersion;

		return semverGreaterThan(latestVersion, currentVersion);
	} catch (error) {
		debug("Error loading latest version from npm registry");
		debug(error);
		return false;
	}
}
