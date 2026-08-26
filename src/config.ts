/**
 * Language server configuration: an lspconfig-style default set merged with the
 * user's `~/.pi/minimal-lsp.json`. Users register their own servers or override
 * defaults and add search paths (e.g. an nvim-mason install dir).
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

export interface LSServerConfig {
	/** Executable name (resolved on $PATH + extraPaths) or an absolute path. */
	command: string;
	args?: string[];
	/** File extensions handled by this server, e.g. [".go"]. */
	extensions: string[];
	/** LSP languageId used in didOpen. Defaults to the first extension minus dot. */
	languageId: string;
	/** Presence of any of these files at a dir/parent marks the project root. */
	rootMarkers: string[];
	/** Works on a lone file with no root marker present. */
	singleFile?: boolean;
	/** Workspace configuration handed to the server. */
	settings?: Record<string, unknown>;
	/** initializationOptions for the server. */
	initOptions?: Record<string, unknown>;
	/** Nerdfont icon shown for this server in the UI. */
	icon: string;
}

const ic = {
	go: "\uE627",
	rust: "\uE7A8",
	python: "\uE73C",
	typescript: "\uE8CA",
	javascript: "\uE781",
	lua: "\uE826",
	c: "\uE771",
	java: "\uE738",
	bash: "\uEBCA",
	json: "\uEB0F",
	yaml: "\uE8EB",
	toml: "\uE6B2",
	markdown: "\uE73E",
};

function langId(ext: string): string {
	return ext.slice(1).replace(/^c$/, "cpp");
}

/** Built-in defaults, keyed by server id (mirrors nvim's lspconfig). */
export const DEFAULT_SERVERS: Record<string, LSServerConfig> = {
	go: {
		command: "gopls",
		extensions: [".go"],
		languageId: "go",
		rootMarkers: ["go.mod", "go.sum", "Gopkg.toml", ".git"],
		icon: ic.go,
	},
	rust: {
		command: "rust-analyzer",
		extensions: [".rs"],
		languageId: "rust",
		rootMarkers: ["Cargo.toml", ".git"],
		icon: ic.rust,
	},
	python: {
		command: "pyright-langserver",
		args: ["--stdio"],
		extensions: [".py"],
		languageId: "python",
		rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", ".git"],
		icon: ic.python,
	},
	typescript: {
		command: "typescript-language-server",
		args: ["--stdio"],
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		languageId: "typescript",
		rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
		icon: ic.typescript,
	},
	lua: {
		command: "lua-language-server",
		extensions: [".lua"],
		languageId: "lua",
		rootMarkers: [".luarc.json", "src", ".git"],
		icon: ic.lua,
	},
	cpp: {
		command: "clangd",
		args: ["--background-index"],
		extensions: [".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".hxx"],
		languageId: "cpp",
		rootMarkers: ["compile_commands.json", ".git"],
		icon: ic.c,
	},
	java: {
		command: "jdtls",
		extensions: [".java"],
		languageId: "java",
		rootMarkers: ["pom.xml", "build.gradle", "settings.gradle", ".git"],
		icon: ic.java,
	},
	bash: {
		command: "bash-language-server",
		args: ["start"],
		extensions: [".sh", ".bash"],
		languageId: "shellscript",
		rootMarkers: [".git"],
		singleFile: true,
		icon: ic.bash,
	},
	json: {
		command: "vscode-json-languageserver",
		args: ["--stdio"],
		extensions: [".json", ".jsonc"],
		languageId: "json",
		rootMarkers: [".git"],
		singleFile: true,
		icon: ic.json,
	},
	yaml: {
		command: "yaml-language-server",
		args: ["--stdio"],
		extensions: [".yaml", ".yml"],
		languageId: "yaml",
		rootMarkers: [".git"],
		singleFile: true,
		icon: ic.yaml,
	},
	toml: {
		command: "taplo",
		args: ["lsp", "stdio"],
		extensions: [".toml"],
		languageId: "toml",
		rootMarkers: ["Cargo.toml", ".git"],
		singleFile: true,
		icon: ic.toml,
	},
	markdown: {
		command: "marksman",
		extensions: [".md", ".markdown"],
		languageId: "markdown",
		rootMarkers: [".markdownlint.json", ".git"],
		singleFile: true,
		icon: ic.markdown,
	},
};

const CONFIG_PATH = join(homedir(), ".pi", "minimal-lsp.json");

function deepMerge<T extends Record<string, unknown>>(base: T, over: T): T {
	const out: Record<string, unknown> = { ...base };
	for (const k of Object.keys(over)) {
		const baseVal = (base as Record<string, unknown>)[k];
		const overVal = (over as Record<string, unknown>)[k];
		if (
			baseVal &&
			overVal &&
			typeof baseVal === "object" &&
			typeof overVal === "object" &&
			!Array.isArray(baseVal) &&
			!Array.isArray(overVal)
		) {
			out[k] = deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
		} else {
			out[k] = overVal;
		}
	}
	return out as T;
}

export interface UserConfig {
	servers?: Record<string, Partial<LSServerConfig>>;
	extraPaths?: string[];
}

function loadUserConfig(): UserConfig {
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as UserConfig;
	} catch {
		return {};
	}
}

/** Full resolved config: defaults deep-merged with the user config. */
export function loadConfig(user?: UserConfig): { servers: Record<string, LSServerConfig>; extraPaths: string[] } {
	const u = user ?? loadUserConfig();
	const servers: Record<string, LSServerConfig> = {};
	for (const [id, def] of Object.entries(DEFAULT_SERVERS)) {
		servers[id] = deepMerge(def as unknown as Record<string, unknown>, (u.servers?.[id] ?? {}) as Record<string, unknown>) as unknown as LSServerConfig;
	}
	for (const [id, custom] of Object.entries(u.servers ?? {})) {
		if (!servers[id]) {
			servers[id] = custom as LSServerConfig;
		}
	}
	return { servers, extraPaths: u.extraPaths ?? [] };
}

/** Map from extension -> server id (first match wins; .go -> go, etc.). */
export function buildExtensionIndex(servers: Record<string, LSServerConfig>): Map<string, string> {
	const index = new Map<string, string>();
	for (const [id, config] of Object.entries(servers)) {
		for (const ext of config.extensions) {
			if (!index.has(ext)) index.set(ext, id);
		}
	}
	return index;
}

/** Pick a regex-worthy icon fallback for unknown langs. */
export const UNKNOWN_ICON = "\u2699"; // gear
