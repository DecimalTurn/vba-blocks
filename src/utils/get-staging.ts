import { homedir } from "os";
import { ensureDirSync } from "./fs";
import { join } from "./path";


export function getStaging(cache: string): string {
	let staging: string;
	if (process.platform === "darwin") {
		staging = join(findMacOfficeContainer(), ".vba-blocks");
	} else {
		staging = join(cache, "staging");
	}
	ensureDirSync(staging);
	return staging;
}

function findMacOfficeContainer(): string {
	// TODO This is potentially brittle, use search in the future
	// e.g. readdirSync(Group Containers) -> look for *.Office
	return join(homedir(), "Library/Group Containers/UBF8T346G9.Office");
}
