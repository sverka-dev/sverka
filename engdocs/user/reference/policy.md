# Policy evaluation

Policy evaluation determines whether a set of findings passes or fails.
Source: `packages/policy/src/`.

## `evaluatePolicy(findings, policy, baselineFingerprints)`

Evaluate findings against a policy. Returns a `PolicyResult`. Pass an empty
array for `baselineFingerprints` when no baseline exists.

```ts
import { evaluatePolicy, DEFAULT_POLICY } from "@sverka/sdk";

const result = evaluatePolicy(findings, DEFAULT_POLICY, []);
console.log(result.verdict); // "pass" | "fail"
console.log(result.summary); // human-readable summary
```

## `DEFAULT_POLICY`

The built-in default policy fails on any finding with severity `high` (all
findings) or `medium` (only new findings not in the baseline).

```ts
import { DEFAULT_POLICY } from "@sverka/sdk";

// DEFAULT_POLICY = {
//   name: "default",
//   default: "pass",
//   failOn: [
//     { severity: "high", onlyNew: false },
//     { severity: "medium", onlyNew: true },
//   ],
// }
```

## `createPolicy(config)`

Create a custom policy.

```ts
import { createPolicy } from "@sverka/sdk";

const policy = createPolicy({
  name: "strict",
  default: "pass",
  failOn: [
    { severity: "medium", onlyNew: false },
    { severity: "low", onlyNew: true, checkIds: ["eslint"] },
  ],
});
```

## `FailOnRule`

Each rule in `failOn` specifies:

| Field      | Type       | Description                                    |
|------------|------------|------------------------------------------------|
| `severity` | `Severity` | Minimum severity that triggers (inclusive)    |
| `onlyNew`  | `boolean`  | Only consider findings not in the baseline    |
| `checkIds` | `string[]?` | Restrict to these check IDs (all if absent)   |

A finding triggers a rule if its severity rank is >= the rule's threshold
and (when `onlyNew` is true) its fingerprint is not in the baseline.

## `PolicyResult`

| Field        | Type                | Description                        |
|--------------|---------------------|------------------------------------|
| `verdict`    | `Verdict`           | `"pass"` or `"fail"`              |
| `triggered`  | `TriggeredFinding[]`| Findings that caused failure      |
| `rules`      | `RuleResult[]`      | Per-rule outcomes                  |
| `summary`    | `string`            | Human-readable summary             |

## `Verdict`

```ts
type Verdict = "pass" | "fail";
```

The CLI's exit code reflects the verdict: 0 for pass, 1 for fail.
