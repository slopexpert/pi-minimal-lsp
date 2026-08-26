/**
 * Smoke test: the entry factory registers the four lsp_* tools and event
 * hooks without throwing, and each tool has renderCall/renderResult.
 */
import test from "node:test";
import assert from "node:assert/strict";
import factory from "../src/index.ts";

const tools: Array<{ name: string; def: any }> = [];
const events = new Map<string, number>();

const pi: any = {
	registerTool(def: any) {
		tools.push({ name: (def as any).name, def });
	},
	on(event: string) {
		events.set(event, (events.get(event) ?? 0) + 1);
	},
};

factory(pi);

test("registers four lsp_* tools", () => {
	const names = tools.map((t) => t.name).sort();
	assert.deepEqual(names, ["lsp_at", "lsp_diagnostics", "lsp_explore", "lsp_search"]);
});

test("every tool has renderCall and renderResult", () => {
	for (const t of tools) {
		assert.equal(typeof (t.def as any).renderCall, "function", `${t.name} renderCall`);
		assert.equal(typeof (t.def as any).renderResult, "function", `${t.name} renderResult`);
	}
});

test("session + hook handlers registered", () => {
	assert.equal(events.get("session_start"), 1);
	assert.equal(events.get("session_shutdown"), 1);
	assert.equal(events.get("tool_result"), 1);
	assert.equal(events.get("agent_end"), 1);
});
