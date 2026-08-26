/**
 * lsp_search: find symbols by name.
 *   no path       -> workspace/symbol across the whole project
 *   path is dir   -> workspace/symbol filtered to that subtree
 *   path is file  -> symbol search within a single file (document symbols)
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, relative, basename, join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getManager } from "../runtime.ts";
import { documentSymbols, workspaceSymbols } from "../lsp/queries.ts";
import { pathToUri, isWithin, uriToPath } from "../helpers.ts";
import { collectSourceFiles } from "../collect.ts";

interface SearchParams {
	query: string;
	path?: string;
}

export interface SearchRow {
	name: string;
	kind: number;
	file: string;
	line: number;
	col: number;
	container?: string;
}

function flatten(syms: any[], rows: SearchRow[] = []): SearchRow[] {
	for (const s of syms ?? []) {
		rows.push({
			name: s.name,
			kind: s.kind,
			file: "",
			line: s.selectionRange.start.line + 1,
			col: s.selectionRange.start.character + 1,
			container: s.detail,
		});
		if (s.children) flatten(s.children, rows);
	}
	return rows;
}

export function registerSearch(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "lsp_search",
		label: "LSP Search",
		description:
			"Search for workspace or document symbols by name. With no path: workspace-wide. With a dir path: filtered to that subtree. With a file path: search within that one file. Query is required and must be non-empty; results are flat locations, capped (`... N more` = more exist).",
		promptSnippet: "Look up symbols across the project by name",
		promptGuidelines: [
			"Use lsp_search when you know a symbol name but not where it lives; use lsp_explore to browse and lsp_at for a precise location.",
			"Narrow lsp_search with path (dir filters to a subtree, file searches one file). A capped result list means more exist - refine the query or scope.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Symbol name substring to search for (required, non-empty)" }),
			path: Type.Optional(Type.String({ description: "Optional scope: file or directory" })),
		}),
		async execute(_toolCallId, params: SearchParams, _signal, _onUpdate, ctx) {
			return search(params, ctx);
		},
	});
}

async function search(params: SearchParams, ctx: ExtensionContext) {
	const cwd = ctx.cwd;
	const query = (params.query ?? "").trim();
	if (!query) {
		return error("query is required and must be non-empty");
	}
	const manager = getManager(cwd);
	const q = query.toLowerCase();

	const rawPath = params.path?.trim() || undefined;
	let rows: SearchRow[] = [];
	let inFile = false;

	if (!rawPath) {
		// workspace-wide: launch servers for languages present, then query each
		const ids = manager.discoverLanguages();
		for (const id of ids) {
			const handle = manager.ensureServerById(id);
			if (!handle) continue;
			await handle.server.ready();
			try {
				const syms = await workspaceSymbols(handle.server, params.query);
				for (const s of syms) {
					const file = uriToPath(s.location.uri);
					if (!isWithin(file, cwd)) continue;
					rows.push({
						name: s.name,
						kind: s.kind,
						file: relative(cwd, file),
						line: s.location.range.start.line + 1,
						col: s.location.range.start.character + 1,
						container: s.containerName,
					});
				}
			} catch {
				/* server may not support workspace/symbol */
			}
		}
	} else {
		const abs = resolve(cwd, rawPath);
		if (!isWithin(abs, cwd)) return error("path is outside the project; lsp_search only works inside the cwd");
		const st = statSync(abs);
		if (st.isDirectory()) {
			const baseUri = pathToUri(abs);
			const ids = manager.discoverLanguages();
			for (const id of ids) {
				const handle = manager.ensureServerById(id);
				if (!handle) continue;
				await handle.server.ready();
				try {
					const syms = await workspaceSymbols(handle.server, params.query);
					for (const s of syms) {
						const file = uriToPath(s.location.uri);
						if (!file.startsWith(abs)) continue;
						rows.push({
							name: s.name,
							kind: s.kind,
							file: relative(cwd, file),
							line: s.location.range.start.line + 1,
							col: s.location.range.start.character + 1,
							container: s.containerName,
						});
					}
				} catch {
					/* ignore */
				}
			}
			// also use document search on files in dir via docSymbols on-demand (bounded)
			for (const f of collectSourceFiles(abs, 60)) {
				const m = manager.serverFor(f);
				if (!m) continue;
				const text = readFileSync(f, "utf8");
				manager.upsertDocument(f, m.handle.config.languageId, text);
				await m.handle.server.ready();
				const syms = flatten(await documentSymbols(m.handle.server, pathToUri(f)));
				for (const row of syms) {
					if (!row.name.toLowerCase().includes(q)) continue;
					row.file = relative(cwd, f);
					rows.push(row);
				}
			}
		} else {
			// single file
			const m = manager.serverFor(abs);
			if (!m) return error(`no language server for '${abs}'`);
			const text = readFileSync(abs, "utf8");
			manager.upsertDocument(abs, m.handle.config.languageId, text);
			await m.handle.server.ready();
			const syms = flatten(await documentSymbols(m.handle.server, pathToUri(abs)));
			for (const row of syms) {
				if (!row.name.toLowerCase().includes(q)) continue;
				row.file = relative(cwd, abs);
				rows.push(row);
			}
			inFile = true;
		}
	}

	// dedupe by name+location, richest label wins
	rows = dedupe(rows);

	const heading = inFile
		? `symbols matching \`${query}\` in file \`${rawPath}\``
		: rawPath
			? `symbols matching \`${query}\` in dir \`${rawPath}\``
			: `symbols matching \`${query}\` in \`${basename(cwd)}\``;

	const agent = [heading];
	for (const r of rows.slice(0, 100)) {
		const info = kindLabel(r.kind);
		const sig = r.container && r.container.includes("(") ? r.container : `${r.name}`;
		const loc = inFile ? "" : ` ${r.file}:${r.line}:${r.col}`;
		agent.push(`- ${info} \`${sig}\`${loc}`);
	}
	if (rows.length > 100) agent.push(`... ${rows.length - 100} more`);

	return {
		content: [t(agent.join("\n"))],
		details: {
			ok: true,
			kind: "search",
			query,
			file: inFile ? rawPath : undefined,
			results: rows.slice(0, 500),
			more: Math.max(0, rows.length - 500),
		},
	};
}

function dedupe(rows: SearchRow[]): SearchRow[] {
	const seen = new Set<string>();
	const out: SearchRow[] = [];
	for (const r of rows) {
		const k = `${r.name}|${r.file}:${r.line}:${r.col}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(r);
	}
	return out;
}

function kindLabel(kind: number): string {
	// lightweight; full icon/color handled in render
	const names: Record<number, string> = { 1: "File", 4: "Package", 5: "Class", 6: "Method", 12: "Function", 13: "Variable", 14: "Constant", 7: "Property", 8: "Field", 23: "Struct", 10: "Enum" };
	return names[kind] ?? "Symbol";
}

function error(msg: string) {
	return { content: [t(msg)], details: { ok: false, kind: "search", error: msg } };
}

function t(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}
