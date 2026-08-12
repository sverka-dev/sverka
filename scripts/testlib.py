"""Minimal shared test runner for standalone Python regression scripts."""

import sys
from typing import Callable, Sequence


def run_tests(tests: Sequence[Callable[[], None]]) -> int:
    """Run a list of no-arg test functions and print a summary."""
    passed = 0
    failed = 0
    for test in tests:
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
    print(f"{passed}/{len(tests)} passed")
    return 0 if failed == 0 else 1
