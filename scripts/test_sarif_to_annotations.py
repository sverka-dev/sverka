#!/usr/bin/env python3
"""Tests for parse_location URI normalization in sarif-to-annotations.py.

Run: python3 scripts/test_sarif_to_annotations.py
"""
import sys
import os
import importlib.util

sys.path.insert(0, os.path.dirname(__file__))
_spec = importlib.util.spec_from_file_location(
    "sarif_to_annotations",
    os.path.join(os.path.dirname(__file__), "sarif-to-annotations.py"),
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
parse_location = _mod.parse_location


def _loc(uri, **region):
    """Build a minimal SARIF result with the given artifactLocation.uri."""
    phys = {"artifactLocation": {"uri": uri}}
    if region:
        phys["region"] = region
    return {"locations": [{"physicalLocation": phys}]}


def _file_uri(uri):
    return parse_location(_loc(uri))["file_uri"]


def test_empty_locations():
    assert parse_location({})["file_uri"] == ""
    assert parse_location({"locations": []})["file_uri"] == ""


def test_relative_path_unchanged():
    assert _file_uri("src/a.ts") == "src/a.ts"
    assert _file_uri("packages/core/src/index.ts") == "packages/core/src/index.ts"


def test_absolute_path_stripped():
    assert _file_uri("/src/a.ts") == "src/a.ts"
    assert _file_uri("/absolute/path/to/file.py") == "absolute/path/to/file.py"


def test_file_uri_triple_slash():
    assert _file_uri("file:///src/a.ts") == "src/a.ts"
    assert _file_uri("file:///path/to/file.py") == "path/to/file.py"


def test_file_uri_with_localhost():
    assert _file_uri("file://localhost/src/a.ts") == "src/a.ts"


def test_file_uri_single_slash():
    assert _file_uri("file:/src/a.ts") == "src/a.ts"


def test_file_uri_uppercase_scheme():
    assert _file_uri("FILE:///src/a.ts") == "src/a.ts"
    assert _file_uri("FILE://localhost/src/a.ts") == "src/a.ts"


def test_file_uri_with_query_and_fragment():
    assert _file_uri("file:///src/a.ts?line=1#fragment") == "src/a.ts"


def test_https_uri():
    assert _file_uri("https://example.com/src/a.ts") == "src/a.ts"
    assert _file_uri("https://example.com:8080/src/a.ts?query=1#frag") == "src/a.ts"


def test_https_uri_no_path():
    assert _file_uri("https://example.com") == ""


def test_region_fields():
    result = parse_location(_loc("src/a.ts", startLine=10, startColumn=3,
                                  endLine=12, endColumn=5))
    assert result["start_line"] == 10
    assert result["start_col"] == 3
    assert result["end_line"] == 12
    assert result["end_col"] == 5


def test_missing_region():
    result = parse_location(_loc("src/a.ts"))
    assert result["start_line"] is None
    assert result["start_col"] is None
    assert result["end_line"] is None
    assert result["end_col"] is None


def test_url_encoded_path():
    assert _file_uri("file:///src/a%20b.ts") == "src/a b.ts"
    assert _file_uri("file:///src/%E4%B8%AD.ts") == "src/中.ts"


# Tests for integer validation in build_annotation_line (qodo thread 4)
def _annotation_line(uri, **region):
    """Build an annotation line and return it for inspection."""
    _build = _mod.build_annotation_line
    result = _loc(uri, **region)
    entries = {}
    line, is_error = _build(result, "test-tool", entries)
    return line


def test_non_integer_line_skipped():
    """Non-integer startLine (e.g. string) should be skipped, not stringified."""
    # JSON only has numbers, but if a hostile SARIF has a string, json.loads
    # will parse it as a string. parse_location passes it through.
    line = _annotation_line("src/a.ts", startLine="10")
    assert "line=10" not in line
    assert "line=" not in line


def test_negative_line_skipped():
    """Negative line numbers should be skipped."""
    line = _annotation_line("src/a.ts", startLine=-5)
    assert "line=-5" not in line
    assert "line=" not in line


def test_string_line_skipped():
    """String values with newlines should not appear in the annotation."""
    line = _annotation_line("src/a.ts", startLine="evil\n::error::injected")
    assert "evil" not in line
    assert "injected" not in line


def test_valid_integer_lines_emitted():
    """Valid positive integers should be emitted correctly."""
    line = _annotation_line("src/a.ts", startLine=10, startColumn=3,
                            endLine=12, endColumn=5)
    assert "line=10" in line
    assert "col=3" in line
    assert "endLine=12" in line
    assert "endColumn=5" in line


TESTS = [
    test_empty_locations,
    test_relative_path_unchanged,
    test_absolute_path_stripped,
    test_file_uri_triple_slash,
    test_file_uri_with_localhost,
    test_file_uri_single_slash,
    test_file_uri_uppercase_scheme,
    test_file_uri_with_query_and_fragment,
    test_https_uri,
    test_https_uri_no_path,
    test_region_fields,
    test_missing_region,
    test_url_encoded_path,
    test_non_integer_line_skipped,
    test_negative_line_skipped,
    test_string_line_skipped,
    test_valid_integer_lines_emitted,
]


def main():
    failed = 0
    for test in TESTS:
        try:
            test()
            print(f"  PASS  {test.__name__}")
        except AssertionError as e:
            print(f"  FAIL  {test.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR {test.__name__}: {e}")
            failed += 1
    print(f"\n{len(TESTS) - failed}/{len(TESTS)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
