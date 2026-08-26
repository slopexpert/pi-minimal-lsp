#!/usr/bin/env python3
"""Shared gopls client: collect documentSymbols per package for a Go project."""
import json
import os
import subprocess
from collections import defaultdict


def _msg(obj):
    b = json.dumps(obj).encode()
    return b"Content-Length: %d\r\n\r\n" % len(b) + b


def _send(proc, obj):
    proc.stdin.write(_msg(obj))
    proc.stdin.flush()


def _recv(proc):
    headers = {}
    while True:
        line = proc.stdout.readline()
        if not line:
            raise EOFError("server closed")
        if line in (b"\r\n", b"\n"):
            break
        k, v = line.decode().split(":", 1)
        headers[k.strip().lower()] = v.strip()
    return json.loads(proc.stdout.read(int(headers["content-length"])))


def go_files(root):
    """All .go files under root, skipping git/internal-generated/test dirs."""
    files = []
    for dirpath, dirnames, names in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules",
                                                        ".vscode", ".ignored", ".ssh",
                                                        "generated")]
        for n in names:
            if n.endswith(".go"):
                files.append(os.path.join(dirpath, n))
    return files


def collect_symbols(root, files=None):
    """Query gopls for documentSymbols and group by package dir.

    Returns {package_dir: [documentSymbol objects]}. Test files are skipped.
    """
    files = files if files is not None else go_files(root)
    from make_keywords import is_test_path
    files = [f for f in files if not is_test_path(os.path.basename(f))]

    proc = subprocess.Popen(["gopls", "serve"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    _send(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                 "params": {"processId": None, "rootUri": "file://" + root,
                            "capabilities": {}}})
    _recv(proc)
    _send(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
    for f in files:
        _send(proc, {"jsonrpc": "2.0", "method": "textDocument/didOpen",
                     "params": {"textDocument": {"uri": "file://" + f,
                                                 "languageId": "go", "version": 1,
                                                 "text": open(f).read()}}})

    by_pkg = defaultdict(list)
    for f in files:
        _send(proc, {"jsonrpc": "2.0", "id": 2, "method": "textDocument/documentSymbol",
                     "params": {"textDocument": {"uri": "file://" + f}}})
        while True:
            res = _recv(proc)
            if res.get("id") == 2:
                break
        syms = res.get("result") or []
        pkg = os.path.dirname(f)
        if isinstance(syms, list):
            by_pkg[pkg].extend(syms)
    proc.terminate()
    return dict(by_pkg)
