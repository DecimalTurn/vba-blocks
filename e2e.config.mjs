export default {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/tests/**/*.e2e.ts"],
	testPathIgnorePatterns: ["/node_modules/", "/lib/"],
	moduleNameMapper: {
		"^vbapm$": "<rootDir>/src/index.ts",
		"^@timhall/dedent$": "<rootDir>/node_modules/@timhall/dedent/dist/dedent.js"
	},
	snapshotFormat: {
		escapeString: true,
		printBasicPrototype: true
	},
	globals: {
		"ts-jest": {
			tsconfig: "tests/tsconfig.json"
		}
	}
};
