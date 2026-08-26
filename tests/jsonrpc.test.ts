import test from "node:test";
import assert from "node:assert/strict";
import { FramedParser, encodeMessage, framed, isNotification, isRequest, isResponse } from "../src/lsp/jsonrpc.ts";

test("encodeMessage: correct Content-Length framing", () => {
	const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
	const bytes = encodeMessage(msg);
	const text = new TextDecoder().decode(bytes);
	assert.ok(text.startsWith(`Content-Length: ${msg.length}\r\n\r\n`));
	assert.equal(text.slice(text.indexOf("\r\n\r\n") + 4), msg);
});

test("FramedParser: single complete message", () => {
	const parsed: unknown[] = [];
	const p = new FramedParser((m) => parsed.push(m));
	p.feed(framed({ jsonrpc: "2.0", id: 1, method: "textDocument/documentSymbol" }));
	assert.equal(parsed.length, 1);
	assert.equal((parsed[0] as any).id, 1);
	assert.equal(p.buffered, "");
});

test("FramedParser: handles multiple messages in one chunk", () => {
	const parsed: unknown[] = [];
	const p = new FramedParser((m) => parsed.push(m));
	p.feed(framed({ jsonrpc: "2.0", id: 1, method: "a" }) + framed({ jsonrpc: "2.0", method: "b" }));
	assert.equal(parsed.length, 2);
	assert.equal((parsed[0] as any).id, 1);
	assert.equal((parsed[1] as any).method, "b");
});

test("FramedParser: splits across chunk boundaries (including mid-body)", () => {
	const parsed: unknown[] = [];
	const p = new FramedParser((m) => parsed.push(m));
	const msg = framed({ jsonrpc: "2.0", id: 9, method: "c", params: { lots: "x".repeat(100) } });
	for (let i = 0; i < msg.length; i += 7) {
		p.feed(msg.slice(i, i + 7));
	}
	assert.equal(parsed.length, 1);
	assert.equal((parsed[0] as any).id, 9);
	assert.equal(p.buffered, "");
});

test("message type guards", () => {
	assert.ok(isRequest({ jsonrpc: "2.0", id: 1, method: "m" }));
	assert.ok(isNotification({ jsonrpc: "2.0", method: "m" }));
	assert.ok(isResponse({ jsonrpc: "2.0", id: 1, result: {} }));
	assert.ok(isResponse({ jsonrpc: "2.0", id: 1, error: { code: 1, message: "e" } }));
	assert.ok(!isResponse({ jsonrpc: "2.0", id: 1, method: "m" }));
});
