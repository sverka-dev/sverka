// ESLint 9 flat config — TypeScript-aware, strict, ESM.
// Single root config discovered by all packages via ESLint's flat-config
// resolution (walks up from the linted directory). See ADR-001 for the
// minimal-dependency stance; typescript-eslint is the official unified
// package for ESLint 9 + TypeScript.
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores — never lint build output, deps, or tooling artifacts.
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.beads/**",
      "**/.devin/**",
      "**/.evidence/**",
      "**/.gc/**",
      "**/.opencode/**",
      "website/**",
    ],
  },
  // Strict TypeScript preset for all source files.
  {
    files: ["**/src/**/*.ts"],
    extends: tseslint.configs.recommended,
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
    rules: {
      // Allow _-prefixed unused vars/args (intentional ignore convention).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Test files: relax rules that conflict with vitest patterns (vi.hoisted,
  // top-level awaits, deliberate any casts in fixtures, unused fixture imports).
  {
    files: ["**/src/__tests__/**/*.ts", "**/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
);
