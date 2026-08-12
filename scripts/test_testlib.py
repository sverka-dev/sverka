#!/usr/bin/env python3
"""Regression tests for the shared test runner in scripts/testlib.py."""

import io
import sys
from contextlib import redirect_stdout, redirect_stderr

from testlib import run_tests


_TESTS = []


def test_run_tests_returns_zero_when_all_pass():
    """run_tests returns 0 when every test passes."""
    def pass1():
        pass

    def pass2():
        pass

    assert run_tests([pass1, pass2]) == 0


def test_run_tests_returns_non_zero_on_failure():
    """run_tests returns 1 when at least one test fails."""
    def passes():
        pass

    def fails():
        raise AssertionError("expected failure")

    assert run_tests([passes, fails]) == 1


def test_run_tests_returns_non_zero_on_error():
    """run_tests returns 1 when a test raises a non-AssertionError exception."""
    def passes():
        pass

    def errors():
        raise RuntimeError("expected error")

    assert run_tests([passes, errors]) == 1


def test_run_tests_counts_correctly():
    """run_tests prints the number of passing tests and the total."""
    def pass1():
        pass

    def pass2():
        pass

    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(io.StringIO()):
        run_tests([pass1, pass2])
    assert "2/2 passed" in out.getvalue()


def test_run_tests_reports_failed_tests():
    """run_tests marks failing tests with a FAIL prefix."""
    def failing_test():
        raise AssertionError("expected failure")

    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(io.StringIO()):
        run_tests([failing_test])
    lines = out.getvalue().splitlines()
    assert any(line.startswith("FAIL  failing_test:") for line in lines)
    assert "0/1 passed" in out.getvalue()


if __name__ == "__main__":
    sys.exit(run_tests([
        test_run_tests_returns_zero_when_all_pass,
        test_run_tests_returns_non_zero_on_failure,
        test_run_tests_returns_non_zero_on_error,
        test_run_tests_counts_correctly,
        test_run_tests_reports_failed_tests,
    ]))
