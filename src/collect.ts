/**
 * Bounded source-file discovery shared by the explore/search tools. Walks a
 * directory tree collecting regular files while skipping common non-source,
 * generated and test directories, and stops once the limit is reached.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([".git", ".vscode", ".idea", "node_modules", "target", "dist", "build", "generated", "__pycache__", ".venv", "vendor"]);

export function collectSourceFiles(dir: string, limit: number): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		if (out.length >= limit) return;
		let entries;
		try {
			entries = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (out.length >= limit) return;
			if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
			const full = join(d, e.name);
			if (e.isDirectory()) walk(full);
			else if (statSync(full).isFile()) out.push(full);
		}
	};
	walk(dir);
	return out;
}
