/**
 * lsp_explore: browse a project, directory, or file outline.
 *   no path      -> overview of the whole project (root markers + top-level entries)
 *   path is dir  -> overview of that directory
 *   path is file -> outline of file symbols
 * `query` filters symbols/keywords/names case-insensitively.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { Type } from "typebox";
import { getManager } from "../runtime.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isTestPath, extractCounts, distinctiveKeywords } from "../keywords.ts";
import { documentSymbols, hover, toPosition } from "../lsp/queries.ts";
import type { DocumentSymbol } from "../lsp/types.ts";
import { pathToUri, isWithin, isDir } from "../helpers.ts";
import { collectSourceFiles } from "../collect.ts";
import { kindInfo } from "../kinds.ts";
import { renderCall as uiRenderCall, renderResult as uiRenderResult } from "../render.ts";

const MAX_DIRS = 40;
const MAX_FILES_PER_DIR = 30;
const MAX_TOTAL_FILES = 120;
const MAX_ENTRIES = 120;

interface ExploreParams {
	path?: string;
	query?: string;
}

interface OutlineRow {
	name: string;
	kind: number;
	detail?: string;
	line: number;
	col: number;
	file?: string;
}

function rel(cwd: string, abs: string): string {
	const r = relative(cwd, abs);
	return r === "" ? basename(abs) : r;
}

function flattenSymbols(syms: DocumentSymbol[], rows: OutlineRow[] = [], file?: string): OutlineRow[] {
	for (const s of syms) {
		rows.push({
			name: s.name,
			kind: s.kind,
			detail: s.detail,
			line: s.selectionRange.start.line + 1,
			col: s.selectionRange.start.character + 1,
			file,
		});
		if (s.children) flattenSymbols(s.children, rows, file);
	}
	return rows;
}

/** Keep the doc-comment text from a hover, dropping the fenced signature echo. */
function hoverDoc(contents: { kind: string; value: string } | string | Array<string | { kind: string; value: string }>): string {
	const flat: string[] = [];
	const push = (c: unknown) => {
		if (typeof c === "string") flat.push(c);
		else if (c && typeof (c as any).value === "string") flat.push((c as any).value);
	};
	if (typeof contents === "string") push(contents);
	else if (Array.isArray(contents)) contents.forEach(push);
	else push(contents);
	const raw = flat.join("\n");
	// even segments are outside ``` fences = real doc text, not the signature
	let doc = "";
	const parts = raw.split(/```[a-z]*\n?|```/);
	for (let i = 0; i < parts.length; i += 2) doc += parts[i];
	return doc.replace(/\n{2,}/g, "\n").trim().slice(0, 300);
}

function filterRows(rows: OutlineRow[], query?: string): OutlineRow[] {
	if (!query) return rows;
	const q = query.toLowerCase();
	return rows.filter((r) => r.name.toLowerCase().includes(q));
}

/** Open a file in its server and return its document symbols (skips tests). */
async function collectFileSymbols(
	manager: ReturnType<typeof getManager>,
	absFile: string,
): Promise<DocumentSymbol[]> {
	if (isTestPath(basename(absFile))) return Promise.resolve([]);
	const res = manager.serverFor(absFile);
	if (!res) return Promise.resolve([]);
	const text = readFileSync(absFile, "utf8");
	manager.upsertDocument(absFile, res.handle.config.languageId, text);
	return res.handle.server.ready().then(() => documentSymbols(res.handle.server, pathToUri(absFile)));
}

function siblingKeywordGroups(
	cwd: string,
	manager: ReturnType<typeof getManager>,
	targetDir: string,
	children: string[],
): Promise<Map<string, Map<string, number>>> {
	return (async () => {
		const groups = new Map<string, Map<string, number>>();
		let total = 0;
		for (const child of children) {
			const abs = join(targetDir, child);
			if (!isDir(abs)) continue;
			const counts = new Map<string, number>();
			const files = collectSourceFiles(abs, MAX_FILES_PER_DIR);
			// cap the global budget
			const allowed = files.slice(0, Math.max(0, MAX_TOTAL_FILES - total));
			total += allowed.length;
			for (const f of allowed) {
				try {
					const syms = await collectFileSymbols(manager, f);
					for (const [tok, n] of extractCounts(syms)) counts.set(tok, (counts.get(tok) ?? 0) + n);
				} catch {
					/* skip unreadable / server hiccups */
				}
			}
			groups.set(child, counts);
		}
		return groups;
	})();
}

function siblingFileKeywordGroups(
	cwd: string,
	manager: ReturnType<typeof getManager>,
	targetDir: string,
	files: string[],
): Promise<Map<string, Map<string, number>>> {
	return (async () => {
		const groups = new Map<string, Map<string, number>>();
		for (const child of files) {
			const abs = join(targetDir, child);
			if (isDir(abs) || isTestPath(child)) continue;
			try {
				const syms = await collectFileSymbols(manager, abs);
				groups.set(child, extractCounts(syms));
			} catch {
				/* skip unreadable / server hiccups */
			}
		}
		return groups;
	})();
}

export function registerExplore(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "lsp_explore",
		label: "LSP Explore",
		description:
			"Explore a project/directory (outline + keywords, never file bodies) or get a file's symbol outline. With no path, overviews the whole project; with a dir path, overviews that dir; with a file path, lists its symbols. Empty query = full outline. Output is a bounded sample (`... N more` means more exists).",
		promptSnippet: "Browse a project, directory, or file outline token-efficiently",
		promptGuidelines: [
			"PREFER lsp_explore over bash for orientation: never use `cd <dir> && ls` / `cat` / `head` / `grep -r` to get a project or directory overview or to list a file's symbols. Use lsp_explore (no path = whole project, dir path = that dir, file path = file symbols) instead.",
			"Use the `query` param to narrow an overview: it filters dirs/files by name OR by their keywords (e.g. lsp_explore with query='db' to surface the files/dirs most relevant to DB code). Prefer scoping with query over reading the whole outline.",
			"Don't read whole files just to see what they contain: lsp_explore <file> already lists each top-level symbol's signature + a doc/summary line. Read only after you've narrowed to a specific symbol, and read just the range/lines you need.",
			"Explore broad -> narrow with lsp_explore (no path, then dir, then file) instead of reading whole files to get oriented.",
			"Use lsp_search if you know a symbol name and lsp_at for a precise location; use read only after you've located something specific, and scope bash (grep/find) to a dir you already know.",
		],
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Path to explore: file or directory (default: whole project)" })),
			query: Type.Optional(Type.String({ description: "Filter symbols/keywords/names by substring" })),
		}),
		async execute(_toolCallId, params: ExploreParams, _signal, _onUpdate, ctx) {
			return explore(params, ctx);
		},
		renderCall(args: ExploreParams, theme: any) {
			return uiRenderCall("lsp_explore", args as Record<string, unknown>, theme);
		},
		renderResult(result: any, options: any, theme: any) {
			return uiRenderResult(result.details, { expanded: options?.expanded, isPartial: options?.isPartial }, theme);
		},
	});
}

async function explore(params: ExploreParams, ctx: ExtensionContext): Promise<{ content: any[]; details: any }> {
	const cwd = ctx.cwd;
	const manager = getManager(cwd);
	const rawPath = params.path && params.path.trim() !== "" ? params.path : undefined;
	const query = params.query && params.query.trim() !== "" ? params.query : undefined;

	let target: string;
	if (!rawPath) target = cwd;
	else {
		const abs = resolve(cwd, rawPath);
		if (!isWithin(abs, cwd)) {
			return error("path is outside the project; lsp_explore only works inside the cwd");
		}
		target = abs;
	}

	try {
		const st = statSync(target);
		if (st.isFile()) {
			return await fileOutline(cwd, manager, target, query);
		}
		return await dirOverview(cwd, manager, target, query, rawPath === undefined);
	} catch {
		return error(`cannot explore '${rawPath ?? "."}': not a readable file or directory`);
	}
}

async function fileOutline(cwd: string, manager: ReturnType<typeof getManager>, file: string, query?: string) {
	const res = manager.serverFor(file);
	if (!res) {
		const ext = file.split(".").pop();
		return { content: [t(`no language server for '${file}' (${ext ? "." + ext : "?"}) or unavailable`)], details: { ok: false, kind: "explore", file: rel(cwd, file) } };
	}
	const text = readFileSync(file, "utf8");
	manager.upsertDocument(file, res.handle.config.languageId, text);
	await res.handle.server.ready();
	const uri = pathToUri(file);
	const syms = await documentSymbols(res.handle.server, uri);

	// hover/doc summaries for a few top-level symbols so agents can skip full reads
	const summaries = new Map<string, string>();
	for (const s of syms.slice(0, 12)) {
		const pos = toPosition(s.selectionRange.start.line, s.selectionRange.start.character);
		try {
			const h = await hover(res.handle.server, uri, pos);
			const t = h?.contents ? hoverDoc(h.contents) : "";
			if (t.length >= 4) summaries.set(`${s.selectionRange.start.line}:${s.selectionRange.start.character}`, t);
		} catch {
			/* ignore */
		}
	}

	const rows = filterRows(flattenSymbols(syms), query);

	const heading = query ? `symbols in file \`${rel(cwd, file)}\` matching \`${query}\`` : `outline of file \`${rel(cwd, file)}\``;
	const agent = [heading];
	for (const r of rows) {
		const info = kindInfo(r.kind);
		const sig = r.detail && r.detail.includes("(") ? r.detail : `${r.name}`;
		const sum = summaries.get(`${r.line - 1}:${r.col - 1}`);
		agent.push(`- ${info.name} \`${sig}\` ${r.line}:${r.col}${sum ? `  # ${sum}` : ""}`);
	}
	agent.push(`(${rows.length} symbols)`);

	return {
		content: [t(agent.join("\n"))],
		details: { ok: true, kind: "explore", file: rel(cwd, file), query, rows: rows.slice(0, 400) },
	};
}

async function dirOverview(
	cwd: string,
	manager: ReturnType<typeof getManager>,
	dir: string,
	query?: string,
	isRoot = false,
) {
	let entries: Array<{ name: string; isDir: boolean }> = [];
	try {
		entries = readdirSync(dir, { withFileTypes: true })
			.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "target" && e.name !== "generated")
			.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
	} catch {
		/* fall through to empty */
	}

	const dirs = entries.filter((e) => e.isDir).map((e) => e.name);
	const files = entries.filter((e) => !e.isDir).map((e) => e.name);

	// keywords per immediate child dir, scored vs same-level siblings
	let keywords = new Map<string, string[]>();
	if (dirs.length > 0) {
		try {
			const groups = await siblingKeywordGroups(cwd, manager, dir, dirs.slice(0, MAX_DIRS));
			keywords = distinctiveKeywords(groups);
		} catch {
			keywords = new Map();
		}
	}

	// keywords per immediate file, scored vs sibling files
	let fileKeywords = new Map<string, string[]>();
	if (files.length > 0) {
		try {
			const fgroups = await siblingFileKeywordGroups(cwd, manager, dir, files.slice(0, MAX_TOTAL_FILES));
			fileKeywords = distinctiveKeywords(fgroups);
		} catch {
			fileKeywords = new Map();
		}
	}

	// filter by query
	let shownDirs = dirs;
	let shownFiles = files;
	if (query) {
		const q = query.toLowerCase();
		shownDirs = dirs.filter((d) => d.toLowerCase().includes(q) || (keywords.get(d) ?? []).some((k) => k.includes(q)));
		shownFiles = files.filter((f) => f.toLowerCase().includes(q) || (fileKeywords.get(f) ?? []).some((k) => k.includes(q)));
	}

	const totalChildren = shownDirs.length + shownFiles.length;
	const cappedDirs = shownDirs.slice(0, MAX_ENTRIES);
	const cappedFiles = shownFiles.slice(0, MAX_ENTRIES);
	const more = MAX_ENTRIES < totalChildren ? totalChildren - (cappedDirs.length + cappedFiles.length) : 0;

	const heading = isRoot ? `outline of project \`${basename(cwd)}\`` : `outline of dir \`${rel(cwd, dir)}\``;
	const agent: string[] = [heading];
	if (isRoot) {
		const markers = manager.rootMarkersOf(cwd);
		if (markers.length > 0) agent.push(`root markers: \`${markers.join("\`, \`")}\``);
	}
	for (const d of cappedDirs) {
		const kw = keywords.get(d) ?? [];
		agent.push(kw.length > 0 ? `- ${d}/ (keywords ${kw.join(", ")})` : `- ${d}/`);
	}
	for (const f of cappedFiles) {
		const kw = fileKeywords.get(f) ?? [];
		agent.push(kw.length > 0 ? `- ${f} (keywords ${kw.join(", ")})` : `- ${f}`);
	}
	if (more > 0) agent.push(`... ${more} more`);

	return {
		content: [t(agent.join("\n"))],
		details: {
			ok: true,
			kind: "explore",
			path: isRoot ? undefined : rel(cwd, dir),
			root: isRoot,
			rootMarkers: isRoot ? manager.rootMarkersOf(cwd) : undefined,
			dirs: cappedDirs.map((d) => ({ name: d, keywords: keywords.get(d) ?? [] })),
			files: cappedFiles.map((f) => ({ name: f, keywords: fileKeywords.get(f) ?? [] })),
			more,
			query,
		},
	};
}

function error(msg: string) {
	return { content: [t(msg)], details: { ok: false, kind: "explore", error: msg } };
}

function t(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}
