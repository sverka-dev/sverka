// Emits a canned SARIF report on stdout — stands in for a real linter so
// the example pipeline exercises the findings → policy path deterministically.
const sarif = {
  version: "2.1.0",
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  runs: [
    {
      tool: {
        driver: {
          name: "mocklint",
          version: "1.0.0",
          rules: [
            {
              id: "no-hardcoded-secret",
              name: "NoHardcodedSecret",
              shortDescription: { text: "Hardcoded credential" },
            },
            {
              id: "prefer-const",
              name: "PreferConst",
              shortDescription: { text: "Prefer const over let" },
            },
          ],
        },
      },
      results: [
        {
          ruleId: "no-hardcoded-secret",
          level: "error",
          message: { text: "Hardcoded API token detected" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/index.ts" },
                region: { startLine: 3 },
              },
            },
          ],
        },
        {
          ruleId: "prefer-const",
          level: "warning",
          message: { text: "Use const instead of let" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/index.ts" },
                region: { startLine: 6 },
              },
            },
          ],
        },
      ],
    },
  ],
};
process.stdout.write(JSON.stringify(sarif, null, 2) + "\n");
