#!/usr/bin/env python3
"""Regression tests for the merge-stack squash-merge verification logic.

The merge-stack formula verifies that a lower branch's content is already
included in main by computing the tree that results from a trial 3-way merge
of origin/main and the lower branch. If that merged tree equals origin/main's
tree, every change the branch carries is already present.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

from testlib import run_tests


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _git_version() -> tuple[int, int]:
    result = subprocess.run(
        ["git", "--version"], capture_output=True, text=True, check=True
    )
    match = re.search(r"(\d+)\.(\d+)", result.stdout)
    if not match:
        raise AssertionError("could not parse git version")
    return int(match.group(1)), int(match.group(2))


def _require_merge_tree_write_tree() -> None:
    major, minor = _git_version()
    if (major, minor) < (2, 38):
        raise AssertionError(
            f"git {major}.{minor} does not support merge-tree --write-tree"
        )


def _run_git(repo: str, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _tree_included(repo: str, target_ref: str, lower_ref: str) -> bool:
    """Return True iff merging lower_ref into target_ref produces the same tree.

    This mirrors the verification used in pack/formulas/merge-stack.toml.
    """
    target_tree = _run_git(repo, "rev-parse", f"{target_ref}^{{tree}}").stdout.strip()
    merged_tree = _run_git(
        repo, "merge-tree", "--write-tree", "--no-messages", target_ref, lower_ref
    ).stdout.strip()

    if not re.match(r"^[0-9a-f]{40,64}$", merged_tree):
        raise AssertionError(f"merge-tree returned an invalid tree OID: {merged_tree!r}")
    if subprocess.run(
        ["git", "-C", repo, "cat-file", "-t", merged_tree],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip() != "tree":
        raise AssertionError(f"merge-tree output {merged_tree!r} is not a tree object")

    return merged_tree == target_tree


def _create_repo() -> str:
    tmp = tempfile.mkdtemp(prefix="merge-stack-test-")
    _run_git(tmp, "init")
    _run_git(tmp, "config", "user.email", "test@example.com")
    _run_git(tmp, "config", "user.name", "Test User")
    return tmp


def _commit_file(repo: str, path: str, content: str, message: str) -> None:
    with open(os.path.join(repo, path), "w") as f:
        f.write(content)
    _run_git(repo, "add", path)
    _run_git(repo, "commit", "-m", message)


def _init_base(repo: str) -> None:
    _commit_file(repo, "base.txt", "base\n", "initial")


def _branch_with_file(repo: str, branch: str, path: str, content: str, message: str) -> None:
    _run_git(repo, "checkout", "-b", branch)
    _commit_file(repo, path, content, message)


def test_squash_merged_content_is_included():
    """When a lower branch's change is already on main, merge-tree matches main."""
    repo = _create_repo()
    try:
        _init_base(repo)
        _branch_with_file(repo, "feature", "feature.txt", "feature\n", "feature")

        # main: simulate squash-merge by bringing in feature.txt without a merge commit
        _run_git(repo, "checkout", "main")
        _run_git(repo, "checkout", "feature", "--", "feature.txt")
        _run_git(repo, "add", "feature.txt")
        _run_git(repo, "commit", "-m", "squash feature into main")

        assert _tree_included(repo, "main", "feature")
    finally:
        shutil.rmtree(repo)


def test_unmerged_content_is_not_included():
    """When a lower branch carries a change not on main, merge-tree differs."""
    repo = _create_repo()
    try:
        _init_base(repo)
        _branch_with_file(repo, "diverged", "diverged.txt", "diverged\n", "diverged change")

        _run_git(repo, "checkout", "main")

        assert not _tree_included(repo, "main", "diverged")
    finally:
        shutil.rmtree(repo)


def test_unrelated_change_on_main_does_not_fool_wc_check():
    """Main may have unrelated changes; the branch content is still detected.

    This is the regression case that the old diff-size heuristic could not
    distinguish: a 5-line branch and a 50-line unrelated change on main.
    """
    repo = _create_repo()
    try:
        _init_base(repo)
        _branch_with_file(repo, "feature", "feature.txt", "feature\n", "feature")

        # main adds many unrelated lines in a different file, then includes feature.txt
        _run_git(repo, "checkout", "main")
        with open(os.path.join(repo, "unrelated.txt"), "w") as f:
            f.write("\n".join(f"line {i}" for i in range(50)) + "\n")
        _run_git(repo, "checkout", "feature", "--", "feature.txt")
        _run_git(repo, "add", ".")
        _run_git(repo, "commit", "-m", "unrelated + squash feature")

        assert _tree_included(repo, "main", "feature")
    finally:
        shutil.rmtree(repo)


def test_invalid_merge_tree_output_is_rejected():
    """A non-OID merge-tree result is not treated as a valid tree."""
    # The regex used in the formula must reject diagnostics and garbage.
    assert not re.match(r"^[0-9a-f]{40,64}$", "usage: git merge-tree")
    assert not re.match(r"^[0-9a-f]{40,64}$", "")
    assert not re.match(r"^[0-9a-f]{40,64}$", "abc")
    assert re.match(r"^[0-9a-f]{40,64}$", "a" * 40)
    assert re.match(r"^[0-9a-f]{40,64}$", "a" * 64)


GIT_TESTS = [
    test_squash_merged_content_is_included,
    test_unmerged_content_is_not_included,
    test_unrelated_change_on_main_does_not_fool_wc_check,
]

ALL_TESTS = [
    *GIT_TESTS,
    test_invalid_merge_tree_output_is_rejected,
]


def _select_tests() -> list:
    major, minor = _git_version()
    if (major, minor) < (2, 38):
        print(f"SKIP: git {major}.{minor} does not support merge-tree --write-tree; running non-git tests only")
        return [t for t in ALL_TESTS if t not in GIT_TESTS]
    return list(ALL_TESTS)


if __name__ == "__main__":
    sys.exit(run_tests(_select_tests()))
