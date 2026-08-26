/**
 * Agent-visible hooks:
 *  - write/edit diagnostics: after any write or edit tool call, check the
 *    affected file for diagnostics and inject any errors into the tool output
 *    while also surfacing them to the user.
 *  - format-at-agent_end: formatting is handled in a future spec; this is the
 *    reserved hook point (currently a no-op).
 */

import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getManager } from "./runtime.ts";
import { isWithin } from "./helpers.ts";
import type { Diagnostic } from "./lsp/types.ts";

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
		const lines = issues.map((d: Diagnostic) => {
			const sev = d.severity === 1 ? "Error" : "Warning";
			const line = d.range.start.line + 1;
			const col = d.range.start.character + 1;
			return `${sev}: ${d.message} (${file}:${line}:${col})`;
		});
		const block = `<errors in ${file}>\n${lines.join("\n")}\n</errors>`;

		if (ctx.hasUI) {
			const n = issues.filter((d: Diagnostic) => d.severity === 1).length;
			ctx.ui.notify(`${file}: ${n} error(s), ${issues.length - n} warning(s)`, n > 0 ? "error" : "warning");
		}

		return {
			content: [...(event.content ?? []), { type: "text", text: block }],
		};
	});

	// Formatting happens at agent_end (future spec; reserved hook point).
	pi.on("agent_end", async () => {
		// TODO(spec): format written/edited files here once formatting lands
	});
}
