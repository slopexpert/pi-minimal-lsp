/**
 * lsp_at: get information about the symbol at a precise 1-based (line, col).
 *   kinds: definition | hover | declaration | typedef | implementation |
 *          references | callers | callees  (omitted = full deduped set)
 *   depth: call-graph depth for callers/callees (default 1)
 *   maxResults: cap for fan-out kinds (references/callers/callees)
 */

import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getManager } from "../runtime.ts";
import {
	fromPosition,
	toPosition,
	hover,
	definition,
	declaration,
	typeDefinition,
	implementation,
	references,
	prepareCallHierarchy,
	callGraph,
	type CallHierarchyItem,
} from "../lsp/queries.ts";
import { pathToUri, isWithin, uriToPath } from "../helpers.ts";
import { kindInfo } from "../kinds.ts";
import { renderCall as uiRenderCall, renderResult as uiRenderResult } from "../render.ts";
import type { Location } from "../lsp/types.ts";
import type { LanguageServer } from "../lsp/server.ts";

const KIND_LABELS: Record<string, { label: string; icon: string }> = {
	definition: { label: "definition", icon: "\uF087" }, // nf-cod-reference
	hover: { label: "hover", icon: "\uED80" },
	declaration: { label: "declaration", icon: "\uF087" },
	typedef: { label: "type definition", icon: "\uF087" },
	implementation: { label: "implementation", icon: "\uF7C4" },
	references: { label: "references", icon: "\uF087" },
	callers: { label: "callers", icon: "\uF086" }, // nf-cod-method
	callees: { label: "callees", icon: "\uF086" },
};

const FAN_OUT = new Set(["references", "callers", "callees"]);

interface AtParams {
	line: number;
	col: number;
	file: string;
	kinds?: string[];
	depth?: number;
	maxResults?: number;
}

interface KindResult {
	key: string;
	label: string;
	icon: string;
	kindSymbol?: number;
	locations: string[];
	count: number;
	summary?: string;
	items?: Array<{ name?: string; detail?: string; location: string }>;
}

export function registerAt(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "lsp_at",
		label: "LSP At",
		description:
			"Get information about the symbol at an exact (line, col) location in a file. kinds (optional): definition, hover, declaration, typedef, implementation, references, callers, callees; omitted = full set. depth (default 1) applies only to callers/callees; maxResults caps fan-out kinds only. Results are deduped by location.",
		promptSnippet: "Get info about the symbol at an exact line:col",
		promptGuidelines: [
			"Use lsp_at when you need details at a precise location; its opposite is lsp_explore (browse) and lsp_search (lookup by name). Request only the kinds you need.",
		],
		parameters: Type.Object({
			line: Type.Integer({ minimum: 1, description: "1-based line of the anchor symbol" }),
			col: Type.Integer({ minimum: 1, description: "1-based column of the anchor symbol" }),
			file: Type.String({ description: "File containing the anchor symbol" }),
			kinds: Type.Optional(
				Type.Array(
					StringEnum(["definition", "hover", "declaration", "typedef", "implementation", "references", "callers", "callees"] as const),
				),
			),
			depth: Type.Optional(Type.Integer({ minimum: 1, default: 1, description: "Call-graph depth for callers/callees (default 1)" })),
			maxResults: Type.Optional(Type.Integer({ minimum: 1, description: "Cap fan-out kinds (references/callers/callees); small kinds are never capped" })),
		}),
		async execute(_toolCallId, params: AtParams, _signal, _onUpdate, ctx) {
			return at(params, ctx);
		},
		renderCall(args: AtParams, theme: any) {
			return uiRenderCall("lsp_at", args as unknown as Record<string, unknown>, theme);
		},
		renderResult(result: any, options: any, theme: any) {
			return uiRenderResult(result.details, { expanded: options?.expanded, isPartial: options?.isPartial }, theme);
		},
	});
}

async function at(params: AtParams, ctx: ExtensionContext) {
	const cwd = ctx.cwd;
	const manager = getManager(cwd);
	if (!params.line || !params.col) return error("line and col (1-based) are required");
	const absFile = resolve(cwd, params.file);
	if (!isWithin(absFile, cwd)) return error("file is outside the project; lsp_at only works inside the cwd");

	const res = manager.serverFor(absFile);
	if (!res) return error(`no language server for '${absFile}'`);
	const text = readFileSync(absFile, "utf8");
	manager.upsertDocument(absFile, res.handle.config.languageId, text);
	await res.handle.server.ready();
	const server = res.handle.server;
	const uri = pathToUri(absFile);
	const pos = toPosition(params.line, params.col);

	// anchor symbol (name/kind) via call hierarchy when available
	let anchorName = "";
	let anchorKind: number | undefined;
	let anchorItem: CallHierarchyItem | null = null;
	try {
		const items = await prepareCallHierarchy(server, uri, pos);
		if (items.length > 0) {
			anchorItem = items[0];
			anchorName = anchorItem.name;
			anchorKind = anchorItem.kind;
		}
	} catch {
		/* server may not support call hierarchy */
	}

	const wanted = params.kinds?.length ? params.kinds : Object.keys(KIND_LABELS);
	const depth = params.depth ?? 1;
	const maxResults = params.maxResults;

	const results: KindResult[] = [];
	for (const key of wanted) {
		if (!KIND_LABELS[key]) continue;
		const meta = KIND_LABELS[key];
		try {
			const kr = await runKind(key, server, uri, pos, anchorItem, depth, maxResults, cwd);
			if (kr && (kr.count > 0 || (key === "hover" && kr.summary))) results.push(kr);
		} catch {
			/* a failing kind shouldn't kill the others */
		}
	}

	const header = `info at \`${relative(cwd, absFile)}:${params.line}:${params.col}\`` + (anchorName ? ` \`${anchorName}\`` : "");
	const agent = [header];
	for (const r of results) {
		if (r.key === "hover" && r.summary) {
			agent.push(`- hover: ${r.summary}`);
			continue;
		}
		if (r.count === 1 && r.locations.length === 1) {
			agent.push(`- ${r.key}: \`${r.locations[0]}\``);
			continue;
		}
		if (FAN_OUT.has(r.key)) {
			const shown = r.items?.slice(0, maxResults ?? 10) ?? [];
			for (const it of shown) {
				const name = it.name ? ` \`${it.name}\`` : "";
				agent.push(`- ${r.key}: \`${it.location}\`${name}`);
			}
			continue;
		}
		agent.push(`- ${r.key}: ${r.count} ${r.count === 1 ? "location" : "locations"}`);
	}
	if (results.length === 0) agent.push("(nothing found)");

	return {
		content: [t(agent.join("\n"))],
		details: {
			ok: true,
			kind: "at",
			file: relative(cwd, absFile),
			line: params.line,
			col: params.col,
			anchor: anchorName || undefined,
			results,
			more: 0,
		},
	};
}

async function runKind(
	key: string,
	server: LanguageServer,
	uri: string,
	pos: { line: number; character: number },
	anchorItem: CallHierarchyItem | null,
	depth: number,
	maxResults: number | undefined,
	cwd: string,
): Promise<KindResult> {
	const meta = KIND_LABELS[key];
	const cap = FAN_OUT.has(key) ? (maxResults ?? 20) : Infinity;
	const toLoc = (l: Location): string => {
		const p = uriToPath(l.uri);
		const r = relative(cwd, p);
		const { line, col } = fromPosition(l.range.start);
		return `${r}:${line}:${col}`;
	};

	if (key === "hover") {
		const h = await hover(server, uri, pos);
		if (!h) return { key, label: meta.label, icon: meta.icon, locations: [], count: 0 };
		const summary = hoverText(h.contents);
		const locs = h.range ? [toLoc({ uri, range: h.range })] : [];
		return { key, label: meta.label, icon: meta.icon, locations: locs, count: locs.length, summary };
	}

	if (key === "references") {
		const locs = await references(server, uri, pos);
		const capped = dedupeLocs(locs, cap);
		return { key, label: meta.label, icon: meta.icon, locations: capped.map(toLoc), count: locs.length, items: capped.map((l) => ({ location: toLoc(l) })) };
	}

	if (key === "callers" || key === "callees") {
		if (!anchorItem) return { key, label: meta.label, icon: meta.icon, locations: [], count: 0 };
		const items = await callGraph(server, anchorItem, key, depth);
		const capped = items.slice(0, cap);
		const mapped = capped.map((it) => ({
			name: it.name,
			detail: it.detail,
			location: `${relative(cwd, uriToPath(it.uri))}:${it.selectionRange.start.line + 1}:${it.selectionRange.start.character + 1}`,
		}));
		return { key, label: meta.label, icon: meta.icon, kindSymbol: anchorItem.kind, locations: mapped.map((m) => m.location), count: items.length, items: mapped };
	}

	// definition / declaration / typedef / implementation
	const fn: Record<string, (s: typeof server, u: string, p: typeof pos) => Promise<Location[]>> = {
		definition: definition,
		declaration: declaration,
		typedef: typeDefinition,
		implementation: implementation,
	};
	const locs = await fn[key](server, uri, pos);
	const capped = dedupeLocs(locs, cap);
	return { key, label: meta.label, icon: meta.icon, locations: capped.map(toLoc), count: locs.length, items: capped.map((l) => ({ location: toLoc(l) })) };
}

function hoverText(contents: { kind: string; value: string } | string | Array<string | { kind: string; value: string }>): string {
	const flat: string[] = [];
	const push = (c: unknown) => {
		if (typeof c === "string") flat.push(c);
		else if (c && typeof (c as any).value === "string") flat.push((c as any).value);
	};
	if (typeof contents === "string") push(contents);
	else if (Array.isArray(contents)) contents.forEach(push);
	else push(contents);
	return flat.join("\n").replace(/```[a-zA-Z]*\n?|```/g, "").replace(/\n{2,}/g, "\n").trim().slice(0, 500);
}

function dedupeLocs(locs: Location[], cap: number): Location[] {
	const seen = new Set<string>();
	const out: Location[] = [];
	for (const l of locs) {
		const k = `${l.uri}:${l.range.start.line}:${l.range.start.character}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(l);
		if (out.length >= cap) break;
	}
	return out;
}

function error(msg: string) {
	return { content: [t(msg)], details: { ok: false, kind: "at", error: msg } };
}

function t(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}

export { kindInfo };
