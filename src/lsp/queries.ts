/**
 * LSP query helpers built on a running LanguageServer. Keeps the API the tools
 * use small and composes standard LSP request/response shapes.
 */

import { LanguageServer } from "./server.ts";
import type {
	DocumentSymbol,
	Hover,
	Location,
	Position,
	SymbolInformation,
} from "./types.ts";

export function toPosition(line1: number, col1: number): Position {
	// 1-based public coords -> 0-based LSP position
	return { line: line1 - 1, character: Math.max(col1 - 1, 0) };
}

export function fromPosition(p: Position): { line: number; col: number } {
	return { line: p.line + 1, col: p.character + 1 };
}

export async function documentSymbols(server: LanguageServer, uri: string): Promise<DocumentSymbol[]> {
	const res = (await server.request<DocumentSymbol[] | { children?: DocumentSymbol[] }>(
		"textDocument/documentSymbol",
		{ textDocument: { uri } },
	)) as unknown;
	if (Array.isArray(res)) return res as DocumentSymbol[];
	const wrapped = res as { children?: DocumentSymbol[] };
	return wrapped?.children ?? [];
}

export async function workspaceSymbols(server: LanguageServer, query: string): Promise<SymbolInformation[]> {
	return (await server.request<SymbolInformation[]>("workspace/symbol", { query })) ?? [];
}

export async function findSymbols(server: LanguageServer, uri: string, names: string[]): Promise<SymbolInformation[]> {
	const syms = await documentSymbols(server, uri);
	const out: SymbolInformation[] = [];
	const want = names.map((n) => n.toLowerCase());
	const lower = (s: string) => s.toLowerCase();
	const walk = (sym: DocumentSymbol) => {
		for (const wantName of want) {
			if (lower(sym.name).includes(wantName)) {
				out.push({
					name: sym.name,
					kind: sym.kind,
					location: { uri, range: sym.selectionRange },
					containerName: sym.detail,
				});
			}
		}
		for (const child of sym.children ?? []) walk(child);
	};
	for (const sym of syms) walk(sym);
	return out;
}

function toLocations(res: unknown): Location[] {
	if (!res) return [];
	if (Array.isArray(res)) {
		return res as Location[];
	}
	return [res as Location];
}

export async function hover(server: LanguageServer, uri: string, pos: Position): Promise<Hover | null> {
	// some servers reject hover before they are ready; just dispatch normally
	return (await server.request<Hover | null>("textDocument/hover", {
		textDocument: { uri },
		position: pos,
	})) ?? null;
}

export async function definition(server: LanguageServer, uri: string, pos: Position): Promise<Location[]> {
	return toLocations(await server.request<unknown>("textDocument/definition", { textDocument: { uri }, position: pos }));
}

export async function declaration(server: LanguageServer, uri: string, pos: Position): Promise<Location[]> {
	return toLocations(await server.request<unknown>("textDocument/declaration", { textDocument: { uri }, position: pos }));
}

export async function typeDefinition(server: LanguageServer, uri: string, pos: Position): Promise<Location[]> {
	return toLocations(await server.request<unknown>("textDocument/typeDefinition", { textDocument: { uri }, position: pos }));
}

export async function implementation(server: LanguageServer, uri: string, pos: Position): Promise<Location[]> {
	return toLocations(await server.request<unknown>("textDocument/implementation", { textDocument: { uri }, position: pos }));
}

export async function references(server: LanguageServer, uri: string, pos: Position): Promise<Location[]> {
	const res = await server.request<Location[] | null>("textDocument/references", {
		textDocument: { uri },
		position: pos,
		context: { includeDeclaration: true },
	});
	return res ?? [];
}

export interface CallHierarchyItem {
	name: string;
	kind: number;
	uri: string;
	range: { start: Position; end: Position };
	selectionRange: { start: Position; end: Position };
	detail?: string;
}

export async function prepareCallHierarchy(
	server: LanguageServer,
	uri: string,
	pos: Position,
): Promise<CallHierarchyItem[]> {
	const res = await server.request<CallHierarchyItem[] | CallHierarchyItem | null>(
		"textDocument/prepareCallHierarchy",
		{ textDocument: { uri }, position: pos },
	);
	if (!res) return [];
	return Array.isArray(res) ? res : [res];
}

async function hierarchyCalls(
	server: LanguageServer,
	method: string,
	item: CallHierarchyItem,
): Promise<Array<{ from?: CallHierarchyItem; to?: CallHierarchyItem; fromRanges?: unknown }>> {
	const res = await server.request<Array<{ from?: CallHierarchyItem; to?: CallHierarchyItem }>>(method, { item });
	return res ?? [];
}

export async function incomingCalls(server: LanguageServer, item: CallHierarchyItem): Promise<Array<{ from?: CallHierarchyItem }>> {
	return hierarchyCalls(server, "callHierarchy/incomingCalls", item);
}

export async function outgoingCalls(server: LanguageServer, item: CallHierarchyItem): Promise<Array<{ to?: CallHierarchyItem }>> {
	return hierarchyCalls(server, "callHierarchy/outgoingCalls", item);
}

/** Recursively collect callers (incoming) or callees (outgoing) up to depth. */
export async function callGraph(
	server: LanguageServer,
	item: CallHierarchyItem,
	direction: "callers" | "callees",
	maxDepth: number,
): Promise<CallHierarchyItem[]> {
	const seen = new Set<string>();
	const out: CallHierarchyItem[] = [];
	const key = (it: CallHierarchyItem) => `${it.uri}@${it.selectionRange.start.line}:${it.selectionRange.start.character}`;
	const visit = async (it: CallHierarchyItem, depth: number) => {
		if (depth > maxDepth) return;
		const calls =
			direction === "callers" ? await incomingCalls(server, it) : await outgoingCalls(server, it);
		for (const c of calls) {
			const next = direction === "callers" ? (c as { from?: CallHierarchyItem }).from : (c as { to?: CallHierarchyItem }).to;
			if (!next) continue;
			const k = key(next);
			if (!seen.has(k)) {
				seen.add(k);
				out.push(next);
				await visit(next, depth + 1);
			}
		}
	};
	seen.add(key(item));
	await visit(item, 1);
	return out;
}
