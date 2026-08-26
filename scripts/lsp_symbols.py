#!/usr/bin/env python3
"""Launch gopls, fetch documentSymbols for a Go file, print keywords.

Usage: lsp_symbols.py <file.go> [--top N]
Wires the DocumentSymbol result straight into make_keywords.py.
"""
import argparse
import json
import subprocess
import sys


def msg(obj):
    body = json.dumps(obj).encode()
    return b"Content-Length: %d\r\n\r\n" % len(body) + body


def send(proc, obj):
    proc.stdin.write(msg(obj))
    proc.stdin.flush()


def recv(proc):
    headers = {}
    while True:
        line = proc.stdout.readline()
        if not line:
            raise EOFError("server closed")
        if line in (b"\r\n", b"\n"):
            break
        k, v = line.decode().split(":", 1)
        headers[k.strip().lower()] = v.strip()
    length = int(headers["content-length"])
    return json.loads(proc.stdout.read(length))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--top", type=int, default=5)
    args = ap.parse_args()

    if is_test_path(args.file):
        print("(test file, skipped)")
        return

    proc = subprocess.Popen(
        ["gopls", "serve"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )

    send(proc, {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"processId": None, "rootUri": None, "capabilities": {}},
    })
    recv(proc)  # initialize response

    send(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
    send(proc, {
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": {"textDocument": {"uri": "file://" + args.file,
                                    "languageId": "go", "version": 1,
                                    "text": open(args.file).read()}},
    })
    send(proc, {
        "jsonrpc": "2.0", "id": 2, "method": "textDocument/documentSymbol",
        "params": {"textDocument": {"uri": "file://" + args.file}},
    })
    # skip notifications (diagnostics, etc.) until the matching response
    while True:
        res = recv(proc)
        if res.get("id") == 2:
            break

    proc.terminate()
    syms = res.get("result")
    # gopls returns a DocumentSymbol[] (an array); strip any {'kind': ...} wrapper
    kwargs = ["--top", str(args.top)] if args.top else []
    out = subprocess.run(
        [sys.executable, "scripts/make_keywords.py", *kwargs],
        input=json.dumps(syms if isinstance(syms, list) else []),
        capture_output=True, text=True,
    )
    sys.stdout.write(out.stdout)
    if out.stderr:
        sys.stderr.write(out.stderr)


if __name__ == "__main__":
    main()
