#!/usr/bin/env python3
"""Regression tests for .devin/plugins/gc-watchdog/skills/gc-watchdog/watchdog.sh.

Run directly: python3 scripts/test_gc_watchdog.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

from testlib import run_tests


WATCHDOG = os.path.join(
    os.path.dirname(__file__),
    "..",
    ".devin",
    "plugins",
    "gc-watchdog",
    "skills",
    "gc-watchdog",
    "watchdog.sh",
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


def _count_real_issues(bd_json: str, status: str = "open", bd_exit: int = 0) -> str:
    """Source count_real_issues and run it with a fake `bd` that prints bd_json."""
    tmp = tempfile.mkdtemp()
    try:
        fake_bd = os.path.join(tmp, "bd")
        with open(fake_bd, "w") as f:
            f.write("#!/bin/bash\n")
            f.write("cat <<'BDEOF'\n")
            f.write(bd_json)
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


def _get_open_bead_ids(bd_json: str) -> str:
    """Source get_open_bead_ids and run it with a fake `bd` that prints bd_json."""
    tmp = tempfile.mkdtemp()
    try:
        fake_bd = os.path.join(tmp, "bd")
        with open(fake_bd, "w") as f:
            f.write("#!/bin/bash\n")
            f.write("cat <<'BDEOF'\n")
            f.write(bd_json)
            f.write("\nBDEOF\n")
        os.chmod(fake_bd, 0o755)

        script = _source_prefix() + "\nget_open_bead_ids\n"
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


def _duration_to_minutes(dur: str) -> str:
    """Source _duration_to_minutes and run it for a single duration string."""
    script = _source_prefix() + f"\n_duration_to_minutes '{dur}'\n"
    result = subprocess.run(
        ["bash", "-c", script],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def test_real_beads_counted():
    """Real sv-* bead IDs are counted from JSON output."""
    assert _count_real_issues(
        json.dumps([{"id": "sv-abc"}, {"id": "sv-def"}, {"id": "sv-ghi99"}])
    ) == "3"


def test_uppercase_bead_ids_counted():
    """Bead IDs with uppercase letters are counted as real beads."""
    assert _count_real_issues(
        json.dumps([{"id": "sv-ABC"}, {"id": "sv-Def"}, {"id": "sv-GHI99"}])
    ) == "3"


def test_wisp_nudge_exact_excluded():
    """Exact wisp and nudge beads are excluded from the count."""
    assert _count_real_issues(
        json.dumps([{"id": "sv-wisp"}, {"id": "sv-nudge"}])
    ) == "0"


def test_wispish_and_nudgeable_not_over_excluded():
    """IDs that merely contain 'wisp' or 'nudge' are real beads, not ephemeral."""
    assert _count_real_issues(
        json.dumps([{"id": "sv-wispish"}, {"id": "sv-nudgeable"}])
    ) == "2"


def test_wisp_with_suffix_excluded():
    """Wisp/nudge beads with hyphen suffixes (e.g. sv-wisp-123) are excluded."""
    assert _count_real_issues(
        json.dumps([{"id": "sv-wisp-123"}, {"id": "sv-nudge-456"}, {"id": "sv-abc"}])
    ) == "1"


def test_non_sv_prefix_ignored():
    """Non-sv prefixed IDs are not counted as real beads."""
    assert _count_real_issues(
        json.dumps([{"id": "gh-123"}, {"id": "sv-abc"}])
    ) == "1"


def test_bd_lookup_failure_returns_minus_one():
    """When bd fails, count_real_issues returns -1 so the caller knows."""
    assert _count_real_issues("[]", status="open", bd_exit=1) == "-1"


def test_empty_json_returns_zero():
    """Empty JSON array returns 0, not -1."""
    assert _count_real_issues("[]") == "0"


def test_invalid_json_returns_minus_one():
    """Invalid JSON returns -1 (lookup failure)."""
    assert _count_real_issues("not json") == "-1"


def test_open_bead_ids_with_age():
    """get_open_bead_ids returns bid|assignee|priority|title|age lines."""
    output = _get_open_bead_ids(
        json.dumps([
            {"id": "sv-abc", "assignee": "", "priority": 1, "title": "Fix bug", "created": "2025-01-01T00:00:00Z"},
            {"id": "sv-wisp-123", "assignee": "builder1", "priority": 2, "title": "Wisp task"},
        ])
    )
    lines = [l for l in output.split("\n") if l.strip()]
    # Only sv-abc should appear (sv-wisp-123 is excluded)
    assert len(lines) == 1
    parts = lines[0].split("|")
    assert parts[0] == "sv-abc"
    assert parts[1] == ""  # no assignee
    assert parts[2] == "1"  # priority
    assert parts[3] == "Fix bug"


def test_duration_to_minutes():
    """_duration_to_minutes converts duration strings to minutes."""
    assert _duration_to_minutes("30s") == "0"
    assert _duration_to_minutes("5m") == "5"
    assert _duration_to_minutes("2h") == "120"
    assert _duration_to_minutes("1d") == "1440"
    assert _duration_to_minutes("invalid") == "0"


def test_session_exists_timeout_returns_2():
    """session_exists returns 2 on lookup timeout (not 1=absent)."""
    tmp = tempfile.mkdtemp()
    try:
        fake_gc = os.path.join(tmp, "gc")
        with open(fake_gc, "w") as f:
            f.write("#!/bin/bash\n")
            f.write("exit 1\n")  # Simulate gc session list failure
        os.chmod(fake_gc, 0o755)

        script = _source_prefix() + '\nsession_exists "sv-wisp-test"\necho "RC=$?"\n'
        env = os.environ.copy()
        env["PATH"] = tmp + ":" + env.get("PATH", "")
        result = subprocess.run(
            ["bash", "-c", script],
            env=env,
            capture_output=True,
            text=True,
        )
        assert "RC=2" in result.stdout
    finally:
        shutil.rmtree(tmp)


TESTS = [
    test_real_beads_counted,
    test_uppercase_bead_ids_counted,
    test_wisp_nudge_exact_excluded,
    test_wispish_and_nudgeable_not_over_excluded,
    test_wisp_with_suffix_excluded,
    test_non_sv_prefix_ignored,
    test_bd_lookup_failure_returns_minus_one,
    test_empty_json_returns_zero,
    test_invalid_json_returns_minus_one,
    test_open_bead_ids_with_age,
    test_duration_to_minutes,
    test_session_exists_timeout_returns_2,
]


if __name__ == "__main__":
    sys.exit(run_tests(TESTS))
