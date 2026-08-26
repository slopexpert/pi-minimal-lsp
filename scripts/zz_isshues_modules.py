#!/usr/bin/env python3
"""Aggregate documentSymbols per top-level module in isshues -> keywords."""
import json, subprocess, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_keywords as mkw

ROOT = "/home/tesohh/dev/isshues"


def msg(obj):
    b = json.dumps(obj).encode()
    return b"Content-Length: %d\r\n\r\n" % len(b) + b


def send(p, obj):
    p.stdin.write(msg(obj)); p.stdin.flush()


def recv(p):
    h = {}
    while True:
        line = p.stdout.readline()
        if not line: raise EOFError("closed")
        if line in (b"\r\n", b"\n"): break
        k, v = line.decode().split(":", 1); h[k.strip().lower()] = v.strip()
    return json.loads(p.stdout.read(int(h["content-length"])))


files = []
for dirpath, _, names in os.walk(ROOT):
    if "/.git" in dirpath or "/db/generated" in dirpath: continue
    if ".ignored" in dirpath or ".ssh" in dirpath or ".vscode" in dirpath: continue
    for n in names:
        if n.endswith(".go") and not mkw.is_test_path(n):
            files.append(os.path.join(dirpath, n))

p = subprocess.Popen(["gopls", "serve"], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
send(p, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"processId": None,
                    "rootUri": "file://" + ROOT,
                    "capabilities": {}}})
recv(p)
send(p, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
for f in files:
    send(p, {"jsonrpc": "2.0", "method": "textDocument/didOpen",
             "params": {"textDocument": {"uri": "file://" + f,
                                         "languageId": "go", "version": 1,
                                         "text": open(f).read()}}})

# group by package dir
from collections import defaultdict
syms_by_mod = defaultdict(list)

for f in files:
    send(p, {"jsonrpc": "2.0", "id": 2, "method": "textDocument/documentSymbol",
             "params": {"textDocument": {"uri": "file://" + f}}})
    while True:
        res = recv(p)
        if res.get("id") == 2: break
    syms = res.get("result") or []
    rel = os.path.relpath(os.path.dirname(f), ROOT)
    mod = rel if rel != "." else "(root)"
    if isinstance(syms, list):
        syms_by_mod[mod] += syms

p.terminate()
for mod in sorted(syms_by_mod):
    counts = mkw.extract(syms_by_mod[mod], 2)
    top = ", ".join(t for t, _ in counts.most_common(8))
    print(f"{mod:12s} ({len(syms_by_mod[mod]):3d} symbols)  {top}")
