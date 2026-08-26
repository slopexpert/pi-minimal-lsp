#!/usr/bin/env python3
"""Per-package keywords scored by distinctiveness vs sibling packages.

Siblings = packages on the same level (share the same parent dir). A keyword
scores high when it is frequent in one package but rare in its siblings (a
TF-IDF-style weighting), so the output highlights what makes each package
special rather than what is common everywhere.
"""
import argparse
import math
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lsp_collect
import make_keywords as mkw


def sibling_groups(by_pkg):
    """Group package paths by their parent (same-level siblings)."""
    groups = defaultdict(list)
    for pkg in by_pkg:
        parent = os.path.dirname(pkg)  # repo-root packages share parent ""
        groups[parent].append(pkg)
    return groups


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--top", type=int, default=6)
    args = ap.parse_args()

    by_pkg = lsp_collect.collect_symbols(args.root)

    # raw token counts per package (weighted by kind, stopwords removed)
    tf = {pkg: mkw.extract(syms, 2) for pkg, syms in by_pkg.items()}

    groups = sibling_groups(by_pkg)

    # document frequency within each sibling group: how many siblings have token
    df = Counter()  # df[(parent, token)] -> count of sibling pkgs containing it
    for parent, pkgs in groups.items():
        for pkg in pkgs:
            for tok in tf[pkg]:
                df[(parent, tok)] += 1

    for parent in sorted(groups, reverse=True):
        gf = groups[parent]
        n = len(gf)  # group size (number of siblings incl. self)
        print(f"\n== {parent or '(project root)'} ({n} packages) ==")
        for pkg in sorted(gf):
            counter = tf[pkg]
            if not counter:
                print(f"  {os.path.relpath(pkg, args.root):24s} (no symbols)")
                continue
            # tf-idf vs siblings: common everywhere -> ~0, unique -> high
            scored = Counter()
            for tok, cnt in counter.items():
                f = df[(parent, tok)]
                idf = math.log((1 + n) / (1 + f))
                scored[tok] = cnt * idf
            top = ", ".join(t for t, _ in scored.most_common(args.top))
            print(f"  {os.path.relpath(pkg, args.root):24s} {top}")


if __name__ == "__main__":
    main()
