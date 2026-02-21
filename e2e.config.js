module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/tests/**/*.e2e.ts"],
	testPathIgnorePatterns: ["/node_modules/", "/lib/"],
	moduleNameMapper: {
		"^vbapm$": "<rootDir>/src/index.ts"
	}
};
