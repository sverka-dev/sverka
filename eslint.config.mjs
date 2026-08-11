// ESLint 9 flat config — used by Codacy and local lint targets.
// This config explicitly does NOT include eslint-plugin-es-x rules
// (which forbid ES2015+ syntax like arrow functions, const, import).
// Those rules are inappropriate for a Node 24 / Bun / TypeScript project.
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.beads/**",
      "**/.devin/**",
      "**/.evidence/**",
      "**/.gc/**",
      "**/.nx/**",
      "**/.opencode/**",
      "**/website/**",
      "**/pack/**",
      "**/skills/**",
      "**/specs/**",
      "**/engdocs/**",
      "**/template-fragments/**",
      "**/*.config.ts",
      "**/*.test.ts",
      "**/__tests__/**",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
      },
    },
    rules: {
      // No es-x rules — we target Node 24+ which supports all modern JS features.
      // TypeScript is parsed by typescript-eslint; no style rules are enabled.
    },
  },
];
