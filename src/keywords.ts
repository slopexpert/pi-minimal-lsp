/**
 * Turn LSP symbols into a short, distinctive keyword list (TS port of
 * scripts/make_keywords.py and lsp_keywords_diff.py). Weighted by symbol kind
 * and scored extra for distinctiveness against sibling directories.
 */

import type { DocumentSymbol, SymbolKindValue } from "./lsp/types.ts";

const TYPE_KINDS = new Set<SymbolKindValue>([5, 10, 11, 23]); // class, enum, interface, struct
const CODE_KINDS = new Set<SymbolKindValue>([2, 3, 4, 6, 9, 12, 22]); // module/pkg, method, ctor, func, enum member
const USEFUL_KINDS = new Set<SymbolKindValue>([...TYPE_KINDS, ...CODE_KINDS]);

const STOPWORDS = new Set(
	"a an and are as at be by for from get got has have if in into is it its new of on set the this to with test tests spec specs suite bench benchmate fuzz it describe describe testing"
		.split(" "),
);

// split camelCase, snake_case, kebab, dots: FooBar_baz-qux.schmoo -> words
const TOKEN_RE = /(?<=[a-z0-9])(?=[A-Z])|[\s_.\-/]/;

// foo_test.go, foo.spec.ts, dirs named test/tests/spec/specs
const TEST_FILE_RE =
	/(?:[_\-.]test(?:s)?(?:\.[a-z0-9]+)?$|[_\-.]spec(?:s)?(?:\.[a-z0-9]+)?$|(?:^|\/)(?:test|tests|spec|specs)(?:\/|$))/i;

export function isTestPath(path: string): boolean {
	return TEST_FILE_RE.test(path);
}

function symbolTokens(symbol: DocumentSymbol): Array<[string, SymbolKindValue]> {
	const out: Array<[string, SymbolKindValue]> = [[symbol.name, symbol.kind]];
	for (const child of symbol.children ?? []) out.push(...symbolTokens(child));
	return out;
}

const normalizeToken = (token: string): string | null => {
	const t = token.toLowerCase();
	return t && /^[a-z]+$/.test(t) && !STOPWORDS.has(t) ? t : null;
};

/** Weighted token counts for a list of DocumentSymbols (type names weigh 2x). */
export function extractCounts(symbols: DocumentSymbol[], minLen = 2): Map<string, number> {
	const counts = new Map<string, number>();
	const add = (name: string, kind: SymbolKindValue) => {
		if (!USEFUL_KINDS.has(kind) || !name) return;
		for (let tok of name.split(TOKEN_RE)) {
			tok = normalizeToken(tok) ?? "";
			if (tok && tok.length >= minLen) {
				const weight = TYPE_KINDS.has(kind) ? 2 : 1;
				counts.set(tok, (counts.get(tok) ?? 0) + weight);
			}
		}
	};
	for (const symbol of symbols) {
		for (const [name, kind] of symbolTokens(symbol)) add(name, kind);
	}
	return counts;
}

/** token set from a group name, used to drop keywords that just echo the file/dir name */
function nameTokens(name: string): Set<string> {
	const set = new Set<string>();
	for (const part of name.split(TOKEN_RE)) {
		const t = normalizeToken(part);
		if (t) set.add(t);
	}
	return set;
}

/**
 * Score each group's keywords for distinctiveness vs its sibling groups.
 * `groups` maps groupName -> per-group token counts. Returns groupName -> top
 * keywords, ordered by a tf-idf style score (unique-to-a-group tokens rank high).
 * Keywords that just duplicate the group's own name (e.g. `main` for main.go)
 * are dropped so the list adds signal beyond what the name already tells us.
 */
export function distinctiveKeywords(
	groups: Map<string, Map<string, number>>,
	top = 6,
): Map<string, string[]> {
	const df = new Map<string, number>(); // token -> how many groups contain it
	for (const counts of groups.values()) {
		for (const tok of counts.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);
	}
	const n = Math.max(groups.size, 1);
	const out = new Map<string, string[]>();
	for (const [group, counts] of groups) {
		const skip = nameTokens(group);
		const scored: Array<[string, number]> = [];
		for (const [tok, cnt] of counts) {
			if (skip.has(tok)) continue;
			const idf = Math.log((1 + n) / (1 + (df.get(tok) ?? 0)));
			scored.push([tok, cnt * idf]);
		}
		scored.sort((a, b) => b[1] - a[1]);
		out.set(group, scored.slice(0, top).map(([t]) => t));
	}
	return out;
}
