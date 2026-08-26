/**
 * Small filesystem/URI helpers shared across the tools and the server manager.
 */

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep, extname } from "node:path";

/** Convert an absolute filesystem path to a file:// URI. */
export function pathToUri(absPath: string): string {
	return `file://${absPath.startsWith("/") ? absPath : `/${absPath}`}`;
}

/** Convert a file:// URI back to an absolute filesystem path. */
export function uriToPath(uri: string): string {
	const p = uri.replace(/^file:\/\//, "");
	return decodeURIComponent(p);
}

/** True if `child` lives at or under `parent` (both resolved absolute paths). */
export function isWithin(child: string, parent: string): boolean {
	const c = resolve(child);
	const p = resolve(parent);
	if (c === p) return true;
	return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** Directory name of an arbitrary file path, resolving through symlinks loosely. */
export function dirOf(file: string): string {
	return resolve(file).split("/").slice(0, -1).join("/") || "/";
}

/** True if path exists and is a regular file. */
export function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function canExecute(p: string): boolean {
	try {
		accessSync(p, constants.X_OK);
		return isFile(p);
	} catch {
		return false;
	}
}

/**
 * Resolve an executable. A command containing a path separator is used as-is;
 * otherwise it is searched for on the extraPaths then $PATH.
 */
export function findExecutable(command: string, extraPaths: string[]): string | null {
	if (command.includes("/") || command.includes(sep)) {
		const abs = isAbsolute(command) ? command : resolve(command);
		return canExecute(abs) ? abs : null;
	}
	const seen = new Set<string>();
	for (const dir of [...extraPaths, ...(process.env.PATH ?? "").split(":")]) {
		if (!dir || seen.has(dir)) continue;
		seen.add(dir);
		const candidate = join(dir, command);
		if (canExecute(candidate)) return candidate;
	}
	return null;
}

/** Expand a leading ~ to the home directory. */
export function tilde(p: string): string {
	if (p === "~") return process.env.HOME ?? p;
	if (p.startsWith("~/")) return join(process.env.HOME ?? "", p.slice(2));
	return p;
}

export function extOf(file: string): string {
	return extname(file).toLowerCase();
}

/** Load available marks (bash-equivalent "which" output) for an id-less path. */
export function exists(p: string): boolean {
	return existsSync(p);
}
