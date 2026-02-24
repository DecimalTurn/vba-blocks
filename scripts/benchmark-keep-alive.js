/**
 * Benchmark: vba build with and without --keep-alive
 *
 * Mirrors the e2e test build scenarios to compare build times.
 * Each scenario runs multiple times and reports average/min/max.
 *
 * Scenarios:
 *   1. "standard"   — has target path (zip + 1 COM call: importGraph)
 *   2. "single"     — blank target (2 COM calls: createDocument + importGraph)
 *   3. "targetless" — package with --target flag (2 COM calls: createDocument + importGraph)
 *
 * --keep-alive only helps scenarios with 2+ COM calls (single, targetless).
 *
 * Usage:
 *   node scripts/benchmark-keep-alive.js [runs]
 *
 *   runs  Number of iterations per mode (default: 3)
 */

const { execSync } = require("child_process");
const { copySync, removeSync, ensureDirSync } = require("fs-extra");
const path = require("path");

const RUNS = parseInt(process.argv[2], 10) || 3;
const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "vba");
const FIXTURES_DIR = path.join(ROOT, "tests", "__fixtures__", "projects");
const TMP_DIR = path.join(ROOT, "tests", ".tmp", "benchmark");

// Scenario definitions matching e2e tests
const SCENARIOS = [
	{
		name: "standard",
		fixture: "standard",
		buildArgs: "",
		comCalls: 1,
		description: "has target path → zip + importGraph (1 COM call)"
	},
	{
		name: "single",
		fixture: "single",
		buildArgs: "",
		comCalls: 2,
		description: "blank target → createDocument + importGraph (2 COM calls)"
	},
	{
		name: "targetless",
		fixture: "targetless",
		buildArgs: "--target xlsm",
		comCalls: 2,
		description: "package + --target → createDocument + importGraph (2 COM calls)"
	}
];

function setupTmp(fixture, label) {
	const src = path.join(FIXTURES_DIR, fixture);
	const dir = path.join(TMP_DIR, label);
	removeSync(dir);
	ensureDirSync(dir);
	copySync(src, dir);
	return dir;
}

function runBuild(cwd, extraArgs = "") {
	const cmd = `"${BIN}" build ${extraArgs}`;
	const start = process.hrtime.bigint();
	try {
		execSync(cmd, { cwd, stdio: "pipe", timeout: 120_000 });
	} catch (err) {
		console.error(`  BUILD FAILED in ${cwd}`);
		console.error(err.stderr?.toString() || err.message);
		return null;
	}
	const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
	return elapsed;
}

function stats(times) {
	const valid = times.filter(t => t !== null);
	if (!valid.length) return { avg: NaN, min: NaN, max: NaN, count: 0 };
	const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
	const min = Math.min(...valid);
	const max = Math.max(...valid);
	return { avg, min, max, count: valid.length };
}

function fmt(ms) {
	if (isNaN(ms)) return "N/A";
	return (ms / 1000).toFixed(2) + "s";
}

// Clean up any stale keep-alive session file before starting
const sessionFile = path.join(process.env.TEMP || "/tmp", "vbapm-session.json");
try { removeSync(sessionFile); } catch {}

console.log("=".repeat(70));
console.log("Benchmark: vba build --keep-alive");
console.log(`Runs per mode per scenario: ${RUNS}`);
console.log("=".repeat(70));

const allResults = [];

for (const scenario of SCENARIOS) {
	console.log(`\n${"─".repeat(70)}`);
	console.log(`Scenario: "${scenario.name}" — ${scenario.description}`);
	console.log(`${"─".repeat(70)}`);

	const buildArgs = scenario.buildArgs;

	// --- Without --keep-alive ---
	console.log(`\n  Without --keep-alive:`);
	const timesNormal = [];
	for (let i = 1; i <= RUNS; i++) {
		const cwd = setupTmp(scenario.fixture, `${scenario.name}-normal-${i}`);
		process.stdout.write(`    Run ${i}/${RUNS}... `);
		const elapsed = runBuild(cwd, buildArgs);
		if (elapsed !== null) {
			console.log(fmt(elapsed));
		}
		timesNormal.push(elapsed);
		removeSync(cwd);
	}

	// --- With --keep-alive ---
	console.log(`\n  With --keep-alive:`);
	const timesKeepAlive = [];
	for (let i = 1; i <= RUNS; i++) {
		const cwd = setupTmp(scenario.fixture, `${scenario.name}-keepalive-${i}`);
		process.stdout.write(`    Run ${i}/${RUNS}... `);
		const elapsed = runBuild(cwd, `${buildArgs} --keep-alive`);
		if (elapsed !== null) {
			console.log(fmt(elapsed));
		}
		timesKeepAlive.push(elapsed);
		removeSync(cwd);
	}

	allResults.push({
		name: scenario.name,
		comCalls: scenario.comCalls,
		normal: stats(timesNormal),
		keepAlive: stats(timesKeepAlive)
	});
}

// --- Summary ---
console.log("\n" + "=".repeat(70));
console.log("Summary");
console.log("=".repeat(70));

console.log(`\n  ${"Scenario".padEnd(12)} ${"COM calls".padEnd(11)} ${"Normal".padEnd(10)} ${"Keep-alive".padEnd(12)} ${"Diff".padEnd(10)} Improvement`);
console.log(`  ${"─".repeat(12)} ${"─".repeat(11)} ${"─".repeat(10)} ${"─".repeat(12)} ${"─".repeat(10)} ${"─".repeat(11)}`);

for (const r of allResults) {
	const diff = r.normal.avg - r.keepAlive.avg;
	const pct = !isNaN(diff) && !isNaN(r.normal.avg) && r.normal.avg > 0
		? ((diff / r.normal.avg) * 100).toFixed(1) + "%"
		: "N/A";
	console.log(
		`  ${r.name.padEnd(12)} ${String(r.comCalls).padEnd(11)} ${fmt(r.normal.avg).padEnd(10)} ${fmt(r.keepAlive.avg).padEnd(12)} ${fmt(diff).padEnd(10)} ${pct}`
	);
}

console.log(`\n  Note: --keep-alive only benefits scenarios with 2+ COM calls.`);

// Cleanup
removeSync(TMP_DIR);
console.log("\nDone.\n");
