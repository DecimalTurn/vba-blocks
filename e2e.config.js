module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/tests/**/*.e2e.ts"],
	snapshotFormat: {
		escapeString: true,
		printBasicPrototype: true
	}
};
