#!/usr/bin/env python3
"""Apply all review thread fixes to the wave-2-ir branch."""
import subprocess
import re
import os

# Verify branch
branch = subprocess.check_output(["git", "branch", "--show-current"]).decode().strip()
assert branch == "wave-2-ir", f"Wrong branch: {branch}"
print(f"On: {branch}")

# 1. validate.ts - add required top-level field validation
path = "packages/ir/src/validate.ts"
with open(path) as f:
    content = f.read()

old = (
    '  const shapeOk =\n'
    '    p.apiVersion === "sverka.dev/v1" &&\n'
    '    typeof p.name === "string" &&\n'
    '    typeof p.sourceContextHash === "string" &&\n'
    '    Array.isArray(p.operations) &&\n'
    '    isPlainObject(p.metadata);\n'
    '\n'
    '  if (shapeOk && idIsNonEmptyString) {\n'
    '    recomputeId(p, errors);\n'
    '  }\n'
    '}'
)

new = (
    '  // Rule 14: required top-level fields. Without these, a plan would pass\n'
    '  // validation silently because shapeOk gates the id recompute but never\n'
    '  // produces an error on its own.\n'
    '  if (typeof p.name !== "string" || p.name.length === 0) {\n'
    '    errors.push({ field: "name", code: "INVALID_PLAN", message: "name must be a non-empty string" });\n'
    '  }\n'
    '  if (typeof p.sourceContextHash !== "string" || p.sourceContextHash.length === 0) {\n'
    '    errors.push({ field: "sourceContextHash", code: "INVALID_PLAN", message: "sourceContextHash must be a non-empty string" });\n'
    '  }\n'
    '  if (typeof p.createdAt !== "string" || p.createdAt.length === 0) {\n'
    '    errors.push({ field: "createdAt", code: "INVALID_PLAN", message: "createdAt must be a non-empty ISO 8601 string" });\n'
    '  }\n'
    '  if (!isPlainObject(p.metadata)) {\n'
    '    errors.push({ field: "metadata", code: "INVALID_METADATA", message: "metadata must be an object" });\n'
    '  }\n'
    '\n'
    '  const shapeOk =\n'
    '    p.apiVersion === "sverka.dev/v1" &&\n'
    '    typeof p.name === "string" &&\n'
    '    typeof p.sourceContextHash === "string" &&\n'
    '    Array.isArray(p.operations) &&\n'
    '    isPlainObject(p.metadata);\n'
    '\n'
    '  if (shapeOk && idIsNonEmptyString) {\n'
    '    recomputeId(p, errors);\n'
    '  }\n'
    '}'
)

assert old in content, "validate.ts: old string not found!"
content = content.replace(old, new, 1)
with open(path, "w") as f:
    f.write(content)
print("1. validate.ts OK")

# 2. serialize.ts - remove raw input from error context
path = "packages/ir/src/serialize.ts"
with open(path) as f:
    content = f.read()
old = '      { raw: json.length > 256 ? json.slice(0, 256) + "\u2026" : json },'
new = '      { inputLength: json.length },'
assert old in content, "serialize.ts: old string not found!"
content = content.replace(old, new, 1)
with open(path, "w") as f:
    f.write(content)
print("2. serialize.ts OK")

# 3. serialize.test.ts - compactness assertions + failure path test
path = "packages/ir/src/__tests__/serialize.test.ts"
with open(path) as f:
    content = f.read()

old1 = (
    '  it("produces a canonical JSON string", () => {\n'
    '    const out = serializePlan(validPlan());\n'
    '    expect(typeof out).toBe("string");\n'
    '    expect(out.startsWith("{")).toBe(true);\n'
    '    // compact: no whitespace between tokens\n'
    '    expect(out).not.toMatch(/,\\s/);\n'
    '    expect(out).not.toMatch(/:\\s/);\n'
    '  });'
)
new1 = (
    '  it("produces a canonical JSON string", () => {\n'
    '    const out = serializePlan(validPlan());\n'
    '    expect(typeof out).toBe("string");\n'
    '    expect(out.startsWith("{")).toBe(true);\n'
    '    // Compact: structural separators must not have whitespace.\n'
    '    // Compare against JSON.stringify(JSON.parse(out)) which produces\n'
    '    // canonical compact JSON; the serialized output must match it.\n'
    '    expect(out).toBe(JSON.stringify(JSON.parse(out)));\n'
    '  });'
)
assert old1 in content, "serialize.test.ts: compactness not found!"
content = content.replace(old1, new1, 1)

old2 = (
    '    expect(out).not.toContain(\'"compiler"\');\n'
    '  });\n'
    '});'
)
new2 = (
    '    expect(out).not.toContain(\'"compiler"\');\n'
    '  });\n'
    '\n'
    '  it("throws SerializationError on a plan containing NaN", () => {\n'
    '    // NaN is not valid JSON; canonicalStringify rejects it. The Plan type\n'
    '    // forbids NaN, but callers can smuggle it in via `as Plan`.\n'
    '    const plan = { ...validPlan(), name: NaN } as unknown as ReturnType<\n'
    '      typeof validPlan\n'
    '    >;\n'
    '    expect(() => serializePlan(plan)).toThrow(SerializationError);\n'
    '  });\n'
    '});'
)
assert old2 in content, "serialize.test.ts: failure path not found!"
content = content.replace(old2, new2, 1)
with open(path, "w") as f:
    f.write(content)
print("3. serialize.test.ts OK")

# 4. ids.test.ts - improve id/createdAt exclusion test
path = "packages/ir/src/__tests__/ids.test.ts"
with open(path) as f:
    content = f.read()

m = re.search(r'  it\("ignores id and createdAt.*?\n  \}\);', content, re.DOTALL)
assert m, "ids.test.ts: test not found"
old = m.group(0)
new = (
    '  it("ignores runtime id and createdAt fields", () => {\n'
    '    // Two complete Plan values with identical content but different id and\n'
    '    // createdAt must produce the same plan id, because computePlanId\n'
    '    // explicitly strips identity fields at runtime.\n'
    '    const body = planBody();\n'
    '    const first: Plan = {\n'
    '      ...body,\n'
    '      id: "plan-first",\n'
    '      createdAt: "2026-01-01T00:00:00.000Z",\n'
    '    };\n'
    '    const second: Plan = {\n'
    '      ...body,\n'
    '      id: "plan-second",\n'
    '      createdAt: "2026-02-01T00:00:00.000Z",\n'
    '    };\n'
    '    expect(computePlanId(first)).toBe(computePlanId(second));\n'
    '  });'
)
content = content.replace(old, new, 1)
with open(path, "w") as f:
    f.write(content)
print("4. ids.test.ts OK")

# 5. validate.test.ts - append rule 14 tests
path = "packages/ir/src/__tests__/validate.test.ts"
with open(path) as f:
    content = f.read()

new_tests = (
    '\n\ndescribe("validatePlan \u2014 rule 14 (required top-level fields)", () => {\n'
    '  it("rejects a missing name with INVALID_PLAN", () => {\n'
    '    const { name: _omit, ...rest } = validPlan();\n'
    '    const result = validatePlan(rest);\n'
    '    expect(result.valid).toBe(false);\n'
    '    const err = result.errors.find(\n'
    '      (e) => e.code === "INVALID_PLAN" && e.field === "name",\n'
    '    );\n'
    '    expect(err).toBeDefined();\n'
    '  });\n'
    '\n'
    '  it("rejects a missing sourceContextHash with INVALID_PLAN", () => {\n'
    '    const { sourceContextHash: _omit, ...rest } = validPlan();\n'
    '    const result = validatePlan(rest);\n'
    '    expect(result.valid).toBe(false);\n'
    '    const err = result.errors.find(\n'
    '      (e) => e.code === "INVALID_PLAN" && e.field === "sourceContextHash",\n'
    '    );\n'
    '    expect(err).toBeDefined();\n'
    '  });\n'
    '\n'
    '  it("rejects a missing createdAt with INVALID_PLAN", () => {\n'
    '    const { createdAt: _omit, ...rest } = validPlan();\n'
    '    const result = validatePlan(rest);\n'
    '    expect(result.valid).toBe(false);\n'
    '    const err = result.errors.find(\n'
    '      (e) => e.code === "INVALID_PLAN" && e.field === "createdAt",\n'
    '    );\n'
    '    expect(err).toBeDefined();\n'
    '  });\n'
    '\n'
    '  it("rejects missing metadata with INVALID_METADATA", () => {\n'
    '    const { metadata: _omit, ...rest } = validPlan();\n'
    '    const result = validatePlan(rest);\n'
    '    expect(result.valid).toBe(false);\n'
    '    const err = result.errors.find((e) => e.code === "INVALID_METADATA");\n'
    '    expect(err).toBeDefined();\n'
    '    expect(err?.field).toBe("metadata");\n'
    '  });\n'
    '\n'
    '  it("rejects a plan with valid apiVersion/id/operations but no name/sourceContextHash/createdAt/metadata", () => {\n'
    '    // This is the exact case from the review: shapeOk is false so the id\n'
    '    // recompute is skipped, but the field errors must still fire.\n'
    '    const plan = {\n'
    '      apiVersion: "sverka.dev/v1",\n'
    '      id: "plan-anything",\n'
    '      operations: [validOperation()],\n'
    '    };\n'
    '    const result = validatePlan(plan);\n'
    '    expect(result.valid).toBe(false);\n'
    '    const codes = result.errors.map((e) => e.code);\n'
    '    expect(codes).toContain("INVALID_PLAN");\n'
    '    expect(codes).toContain("INVALID_METADATA");\n'
    '  });\n'
    '});'
)
content = content.rstrip() + new_tests + "\n"
with open(path, "w") as f:
    f.write(content)
print("5. validate.test.ts OK")

# 6. wave-02-ir-plan.md
path = "engdocs/architecture/wave-02-ir-plan.md"
with open(path) as f:
    content = f.read()

content = content.replace(
    "Validation: `validatePlan` (13 rules, never throws) + `ValidationResult`.",
    "Validation: `validatePlan` (15 rules, never throws) + `ValidationResult`.",
    1,
)
content = content.replace(
    "one positive + 13 negative cases (one per rule),",
    "one positive + 15 negative cases (one per rule),",
    1,
)
old_t = "| 13   | `EMPTY_CREDENTIAL_ENVVAR`  | `operations[].credentials[].envVar` |"
new_t = (
    "| 13   | `EMPTY_CREDENTIAL_ENVVAR`  | `operations[].credentials[].envVar` |\n"
    "| 14   | `INVALID_METADATA`         | `metadata`                     |\n"
    "| 15   | `INVALID_OPERATION`        | `operations[]`                 |"
)
assert old_t in content, "wave doc: table not found!"
content = content.replace(old_t, new_t, 1)

old_f = "```\npackages/ir/src/"
new_f = "```text\npackages/ir/src/"
assert old_f in content, "wave doc: fence not found!"
content = content.replace(old_f, new_f, 1)
with open(path, "w") as f:
    f.write(content)
print("6. wave-02-ir-plan.md OK")

print("\nAll 6 files edited successfully!")
