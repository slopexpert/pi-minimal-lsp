#!/usr/bin/env python3
"""Turn LSP symbols into a short keyword list.

Reads either a DocumentSymbol[] (nested, from textDocument/documentSymbol)
or a SymbolInformation[] (flat, from workspace/symbol) as JSON on stdin
(or from a file given as argv[1]) and prints the top-N keywords.

Usage:
    echo '[...symbols...]' | make_keywords.py
    make_keywords.py symbols.json [--top 5] [--min-len 2]
"""
import argparse
import json
import re
import sys
from collections import Counter

# SymbolKind values we treat as meaningful keywords.
TYPE_KINDS = {5, 10, 11, 23}          # class, enum, interface, struct
CODE_KINDS = {2, 3, 4, 6, 9, 12, 22}  # module/namespace/pkg, method, ctor, func, enum member
USEFUL_KINDS = TYPE_KINDS | CODE_KINDS

STOPWORDS = set("""
a an and are as at be by for from get got has have if in into is it its new of on
set the this to with
""".split())

# split on camelCase, snake_case, kebab, and dots: FooBar_baz-qux.schmoo -> words
_TOKEN_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|[\s_.\-/]")

# test-related words that creep in from TestFoo()/test()/it() symbols
STOPWORDS.update("""test tests spec specs suite bench benchmate fuzz it describe testing
""".split())

# paths/files treated as tests; covers common test naming across languages
TEST_FILE_RE = re.compile(
    r"(?:[_\-.]test(?:s)?(?:\.[a-z0-9]+)?$|"     # foo_test.go, foo.test.ts, foo_tests.rb
    r"[_\-.]spec(?:s)?(?:\.[a-z0-9]+)?$|"        # foo_spec.rb, foo.spec.ts
    r"(?:^|/)(?:test|tests|spec|specs)(?:/|$))",  # dirs named test/tests/spec
    re.IGNORECASE,
)


def is_test_path(path):
    """True if a file/dir path looks like a test file or test directory"""
    return bool(TEST_FILE_RE.search(path))


def symbol_kinds(symbol):
    # yield (name, kind, is_top_level)
    yield (symbol.get("name"), symbol.get("kind"), True)
    for child in symbol.get("children") or []:
        yield from symbol_kinds(child)


def normalize_token(token):
    token = token.lower()
    return token if token.isalpha() and token not in STOPWORDS else None


def extract(symbols, min_len):
    counts = Counter()

    def add_keywords(name, kind):
        if kind not in USEFUL_KINDS or not name:
            return
        for part in _TOKEN_RE.split(name):
            tok = normalize_token(part)
            if tok and len(tok) >= min_len:
                # type names are higher signal than helper code names
                weight = 2 if kind in TYPE_KINDS else 1
                counts[tok] += weight

    for sym in symbols:
        # SymbolInformation[] (workspace/symbol) is flat and has no children
        if "children" not in sym:
            name, kind = sym.get("name"), sym.get("kind")
            add_keywords(name, kind)
            continue
        for name, kind, top in symbol_kinds(sym):
            add_keywords(name, kind)
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?", help="JSON file (default: stdin)")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--min-len", type=int, default=2)
    args = ap.parse_args()

    data = json.load(open(args.file) if args.file else sys.stdin)
    if isinstance(data, dict):  # maybe {"symbols": [...]}
        data = data.get("symbols", list(data.values())[0])

    top = extract(data, args.min_len).most_common(args.top)
    print(", ".join(tok for tok, _ in top))
    if not top:
        print("(no keywords derived)", file=sys.stderr)


if __name__ == "__main__":
    main()
