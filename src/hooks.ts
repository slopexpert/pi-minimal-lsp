/**
 * Agent-visible hooks:
 *  - write/edit diagnostics: after any write or edit tool call, check the
 *    affected file for diagnostics, append a plain `<errors ...>` block to the
 *    agent-visible tool output, and print a pretty human-facing diagnostics
 *    card into the transcript via appendEntry (rendered in index.ts).
 *  - format-at-agent_end: formatting is handled in a future spec; this is the
 *    reserved hook point (currently a no-op).
 */

import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getManager } from "./runtime.ts";
import { isWithin } from "./helpers.ts";
import type { Diagnostic } from "./lsp/types.ts";
import { DIAG_ENTRY } from "./index.ts";

const HOOKED_TOOLS = new Set(["write", "edit"]);

export function registerHooks(pi: ExtensionAPI): void {
	pi.on("tool_result", async (event, ctx) => {
		if (!HOOKED_TOOLS.has(event.toolName)) return;
		const raw = (event.input as { path?: string })?.path;
		if (!raw) return;
		const abs = resolve(ctx.cwd, raw);
		if (!isWithin(abs, ctx.cwd)) return; // external dirs get no language features

		const manager = getManager(ctx.cwd);
		const res = manager.serverFor(abs);
		if (!res) return; // no (available) server for this file
		await res.handle.server.ready(); // warm a cold server so diagnostics flow

		let text: string;
		try {
			text = readFileSync(abs, "utf8");
		} catch {
			return;
		}
		const diags = await manager.refreshAfterWrite(abs, res.handle.config.languageId, text, 1500);
		const issues = diags.filter((d) => d.severity !== undefined && d.severity <= 2);
		if (issues.length === 0) return;

		const file = relative(ctx.cwd, abs);
		// Agent-visible block (kept plain and machine-readable).
		const lines = issues.map((d: Diagnostic) => {
			const sev = d.severity === 1 ? "Error" : "Warning";
			const line = d.range.start.line + 1;
			const col = d.range.start.character + 1;
			return `${sev}: ${d.message} (${file}:${line}:${col})`;
		});
		const agentBlock = `<errors in ${file}>\n${lines.join("\n")}\n</errors>`;

		// Structured diagnostics; also print a pretty human-facing card after the tool call.
		const errors = issues.filter((d) => d.severity === 1).length;
		const warnings = issues.length - errors;
		const diagnostics = {
			ok: true,
			kind: "diagnostics" as const,
			total: issues.length,
			errors,
			warnings,
			items: issues.map((d: Diagnostic) => ({
				severity: d.severity ?? 2,
				message: d.message,
				file,
				line: d.range.start.line + 1,
				col: d.range.start.character + 1,
			})),
		};
		pi.appendEntry(DIAG_ENTRY, { diagnostics });

		return {
			content: [...(event.content ?? []), { type: "text", text: agentBlock }],
		};
	});

	// Formatting happens at agent_end (future spec; reserved hook point).
	pi.on("agent_end", async () => {
		// TODO(spec): format written/edited files here once formatting lands
	});
}
