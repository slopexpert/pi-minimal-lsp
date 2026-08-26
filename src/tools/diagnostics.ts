/**
 * lsp_diagnostics: scan the whole project for errors and warnings.
 * Opens every source file into its language server, waits for diagnostics to
 * settle, then reports errors (severity 1) and warnings (severity 2).
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getManager } from "../runtime.ts";
import { collectSourceFiles } from "../collect.ts";
import { fromPosition } from "../lsp/queries.ts";
import { renderCall as uiRenderCall, renderResult as uiRenderResult } from "../render.ts";

const WAIT_MS = 5000;

interface DiagItem {
	message: string;
	severity: number;
	file: string;
	line: number;
	col: number;
}

export function registerDiagnostics(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "lsp_diagnostics",
		label: "LSP Diagnostics",
		description:
			"Scan the entire project for errors and warnings via the language servers. Returns 'Everything good' when no errors/warnings, otherwise lists each Error/Warning with its file:line:col. Prefer this over compiling to check for errors.",
		promptSnippet: "Check the whole project for errors and warnings",
		promptGuidelines: [
			"Use lsp_diagnostics to check the project for errors/warnings instead of compiling the project.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return runDiagnostics(ctx);
		},
		renderCall(_args: any, theme: any) {
			return uiRenderCall("lsp_diagnostics", {} as Record<string, unknown>, theme);
		},
		renderResult(result: any, options: any, theme: any) {
			return uiRenderResult(result.details, { expanded: options?.expanded, isPartial: options?.isPartial }, theme);
		},
	});
}

async function runDiagnostics(ctx: ExtensionContext) {
	const cwd = ctx.cwd;
	const manager = getManager(cwd);
	const ids = manager.discoverLanguages();
	for (const id of ids) {
		const handle = manager.ensureServerById(id);
		if (handle) await handle.server.ready();
	}

	// open every source file so diagnostics flow
	for (const f of collectSourceFiles(cwd, 400)) {
		const res = manager.serverFor(f);
		if (!res) continue;
		const text = readFileSync(f, "utf8");
		manager.upsertDocument(f, res.handle.config.languageId, text);
	}

	// wait for diagnostics to settle
	const before = manager.diagEventCount();
	await new Promise((r) => setTimeout(r, WAIT_MS));
	// keep waiting a bit if things are still changing
	let stable = false;
	let guard = 0;
	while (!stable && guard < 8) {
		guard++;
		if (manager.diagEventCount() === before) stable = true;
		else await new Promise((r) => setTimeout(r, 400));
	}

	const items: DiagItem[] = [];
	for (const { uri, diagnostics } of manager.allDiagnostics()) {
		for (const d of diagnostics) {
			if (d.severity !== undefined && d.severity > 2) continue; // only errors + warnings
			const path = uri.replace(/^file:\/\//, "");
			items.push({
				message: d.message,
				severity: d.severity ?? 2,
				file: relative(cwd, decodeURIComponent(path)),
				line: fromPosition(d.range.start).line,
				col: fromPosition(d.range.start).col,
			});
		}
	}

	const errors = items.filter((i) => i.severity === 1).length;
	const warnings = items.filter((i) => i.severity === 2).length;

	if (items.length === 0) {
		return { content: [t("Everything good")], details: { ok: true, kind: "diagnostics", total: 0, errors: 0, warnings: 0, items: [] } };
	}

	const agent: string[] = [];
	for (const i of items) {
		agent.push(`${i.severity === 1 ? "Error" : "Warning"}: ${i.message} (${i.file}:${i.line}:${i.col})`);
	}

	return {
		content: [t(agent.join("\n"))],
		details: { ok: true, kind: "diagnostics", total: items.length, errors, warnings, items: items.slice(0, 500) },
	};
}

function t(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}
