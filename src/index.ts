/**
 * pi-minimal-lsp extension entry point.
 * Wires session lifecycle (runtime init/teardown), registers the four lsp_*
 * tools, and installs the write/edit diagnostics hook.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initRuntime, getManager } from "./runtime.ts";
import { registerExplore } from "./tools/explore.ts";
import { registerSearch } from "./tools/search.ts";
import { registerAt } from "./tools/at.ts";
import { registerDiagnostics } from "./tools/diagnostics.ts";
import { registerHooks } from "./hooks.ts";
import { renderDiagnostics } from "./render.ts";

export const DIAG_ENTRY = "lsp-diag";

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (event, ctx) => {
		void event;
		const cwd = (ctx as ExtensionContext).cwd;
		if (cwd) initRuntime(cwd);
	});

	pi.on("session_shutdown", () => {
		getManager(process.cwd())?.dispose();
	});

	registerExplore(pi);
	registerSearch(pi);
	registerAt(pi);
	registerDiagnostics(pi);
	registerHooks(pi);

	// Human-facing card for write/edit diagnostics, printed right after the tool call.
	pi.registerEntryRenderer(DIAG_ENTRY, (entry, { expanded }, theme) => {
		const data = entry.data as { diagnostics?: any } | undefined;
		if (!data?.diagnostics) return undefined;
		return renderDiagnostics(data.diagnostics, { expanded, isPartial: false }, theme);
	});
}
