#!/usr/bin/env python3
"""Regression tests for .agents/skills/gc-watchdog/watchdog.sh.

Run directly: python3 scripts/test_gc_watchdog.py
"""

import os
import shutil
import subprocess
import sys
import tempfile


WATCHDOG = os.path.join(
    os.path.dirname(__file__), "..", ".agents", "skills", "gc-watchdog", "watchdog.sh"
)


def _source_prefix() -> str:
    """Return the helper section of watchdog.sh between marker comments."""
    result = subprocess.run(
        ["sed", "-n", "/# test-source-begin/,/# test-source-end/p", WATCHDOG],
        capture_output=True,
        text=True,
        check=True,
    )
    prefix = result.stdout
    if "# test-source-begin" not in prefix or "# test-source-end" not in prefix:
        raise AssertionError("watchdog.sh is missing test-source markers")
    return prefix


def _count_real_issues(bd_output: str, status: str = "open", bd_exit: int = 0) -> str:
    """Source count_real_issues and run it with a fake `bd` that prints bd_output."""
    tmp = tempfile.mkdtemp()
    try:
        fake_bd = os.path.join(tmp, "bd")
        with open(fake_bd, "w") as f:
            f.write("#!/bin/bash\n")
            f.write("cat <<'BDEOF'\n")
            f.write(bd_output)
            f.write("\nBDEOF\n")
            f.write(f"exit {bd_exit}\n")
        os.chmod(fake_bd, 0o755)

        script = _source_prefix() + f"\ncount_real_issues '{status}'\n"
        env = os.environ.copy()
        env["PATH"] = tmp + ":" + env.get("PATH", "")
        result = subprocess.run(
            ["bash", "-c", script],
            env=env,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    finally:
        shutil.rmtree(tmp)


def _parse_status(status: str) -> tuple:
    """Run the same pipelines watchdog uses to parse gc status fields."""
    script = f"""
STATUS=$(cat <<'STATUSEOF'
{status}
STATUSEOF
)
MAYOR=$(printf '%s\\n' "$STATUS" | awk '/^harness\\.mayor / {{print $2; exit}}')
SESSIONS=$(printf '%s\\n' "$STATUS" | awk '/^Sessions:/ {{gsub(/^ */, ""); print; exit}}')
SUSPENDED=$(printf '%s\\n' "$STATUS" | awk '/^Suspended:/ {{print $2; exit}}')
CONTROLLER=$(printf '%s\\n' "$STATUS" | grep -m1 '^Controller:' | grep -o "supervisor-managed\\|stopped\\|error" | head -1 || true)
echo "$MAYOR|$SESSIONS|$SUSPENDED|$CONTROLLER"
"""
    result = subprocess.run(
        ["bash", "-c", script],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"status parsing failed: {result.stderr}")
    parts = result.stdout.strip().split("|")
    return tuple(parts)


def test_real_beads_counted():
    """Real bead IDs and hierarchical IDs are counted."""
    assert _count_real_issues(
        "● sv-abc\n"
        "○ sv-def.1\n"
        "◐ sv-ghi99\n"
    ) == "3"


def test_uppercase_bead_ids_counted():
    """Bead IDs with uppercase letters are counted as real beads."""
    assert _count_real_issues(
        "● sv-ABC\n"
        "○ sv-Def.1\n"
        "◐ sv-GHI99\n"
    ) == "3"


def test_wisp_nudge_exact_excluded():
    """Exact wisp and nudge beads (and optional .N) are excluded from the count."""
    assert _count_real_issues(
        "● sv-wisp\n"
        "○ sv-nudge\n"
        "● sv-wisp.1\n"
        "○ sv-nudge.2\n"
    ) == "0"


def test_wispish_and_nudgeable_not_over_excluded():
    """IDs that merely contain 'wisp' or 'nudge' are real beads, not ephemeral."""
    assert _count_real_issues(
        "● sv-wispish\n"
        "○ sv-nudgeable\n"
    ) == "2"


def test_beads_with_hyphens_after_prefix_not_double_excluded():
    """Wisp/nudge beads use a hyphen after the prefix and are not real IDs."""
    assert _count_real_issues(
        "● sv-wisp-123\n"
        "○ sv-nudge-456\n"
        "● sv-abc\n"
    ) == "1"


def test_non_status_lines_ignored():
    """Lines without status symbols or bead IDs do not affect the count."""
    assert _count_real_issues(
        "some header\n"
        "✓ sv-abc\n"
        "  \n"
        "● sv-real\n"
    ) == "1"


def test_bd_lookup_failure_returns_minus_one():
    """When bd fails, count_real_issues returns -1 so the caller knows."""
    assert _count_real_issues("", status="open", bd_exit=1) == "-1"


def test_status_fields_parsed():
    """The mayor, sessions, suspended, and controller fields parse correctly."""
    status = (
        "harness.mayor awake\n"
        "Sessions: 3 active\n"
        "Controller: supervisor-managed\n"
        "Suspended: no\n"
    )
    mayor, sessions, suspended, controller = _parse_status(status)
    assert mayor == "awake"
    assert sessions == "Sessions: 3 active"
    assert suspended == "no"
    assert controller == "supervisor-managed"


def test_status_missing_fields():
    """Missing status fields produce empty values rather than stale defaults."""
    status = "Sessions: 0 active\n"
    mayor, sessions, suspended, controller = _parse_status(status)
    assert mayor == ""
    assert sessions == "Sessions: 0 active"
    assert suspended == ""
    assert controller == ""


TESTS = [
    test_real_beads_counted,
    test_uppercase_bead_ids_counted,
    test_wisp_nudge_exact_excluded,
    test_wispish_and_nudgeable_not_over_excluded,
    test_beads_with_hyphens_after_prefix_not_double_excluded,
    test_non_status_lines_ignored,
    test_bd_lookup_failure_returns_minus_one,
    test_status_fields_parsed,
    test_status_missing_fields,
]


def run() -> int:
    passed = 0
    failed = 0
    for test in TESTS:
        try:
            test()
            print(f"PASS  {test.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"FAIL  {test.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"ERROR {test.__name__}: {e}")
            failed += 1
    print()
    print(f"{passed}/{len(TESTS)} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
