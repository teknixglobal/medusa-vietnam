// Unit tests for every package. Workspace imports resolve to source, no build needed.
module.exports = {
  transform: {
    "^.+\\.[jt]s$": ["@swc/jest", { jsc: { parser: { syntax: "typescript", decorators: true } } }],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  modulePathIgnorePatterns: ["dist/", "\\.medusa/"],
  testMatch: ["<rootDir>/packages/*/src/**/__tests__/**/*.unit.spec.[jt]s"],
  moduleNameMapper: {
    "^@teknixglobal/medusa-vietnam-core$": "<rootDir>/packages/core/src",
    "^@teknixglobal/medusa-vietnam-shipping-core$": "<rootDir>/packages/shipping-core/src",
  },
}
