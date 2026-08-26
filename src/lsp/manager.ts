/**
 * Owns all live language servers. Supports running many servers concurrently
 * (one per language, e.g. gopls + rust-analyzer in a mixed repo), launches them
 * lazily, enforces the external-directories policy, detects project roots from
 * root markers, and tracks open documents so late-started servers see them.
 */

import { join, resolve, dirname } from "node:path";
import { readdirSync, type Dirent } from "node:fs";
import { LanguageServer, type DiagnosticsHandler } from "./server.ts";
import type { Diagnostic } from "./types.ts";
import type { LSServerConfig } from "../config.ts";
import { findExecutable, isDir, isFile, isWithin, pathToUri } from "../helpers.ts";

export interface ServerHandle {
	id: string;
	config: LSServerConfig;
	server: LanguageServer;
	root: string | null;
}

interface OpenDoc {
	serverId: string;
	languageId: string;
	uri: string;
	text: string;
	version: number;
}

export class LanguageManager {
	private servers = new Map<string, ServerHandle>();
	private openDocs = new Map<string, OpenDoc>(); // keyed by abs path
	private diagnostics = new Map<string, Diagnostic[]>(); // keyed by pathToUri
	private diagVersion = new Map<string, number>(); // per-uri change counter
	private diagEvents = 0; // total publishDiagnostics received across servers

	constructor(
		private cwd: string,
		private serverConfigs: Record<string, LSServerConfig>,
		private extraPaths: string[],
		private log: (msg: string) => void,
	) {}

	/** Which server config (if any) handles this extension. */
	serverForExt(ext: string): { id: string; config: LSServerConfig } | null {
		for (const [id, config] of Object.entries(this.serverConfigs)) {
			if (config.extensions.includes(ext)) return { id, config };
		}
		return null;
	}

	/**
	 * Normalize + validate a file path. Returns an absolute path only when the
	 * file is inside cwd (external directories get no language features).
	 */
	private normalizeInCwd(raw: string): string | null {
		const abs = resolve(this.cwd, raw);
		return isWithin(abs, this.cwd) ? abs : null;
	}

	/** Find the project root by walking up from an absolute file path. */
	findRootForFile(absFile: string, config: LSServerConfig): string | null {
		let dir = dirname(absFile);
		while (isWithin(dir, this.cwd)) {
			for (const marker of config.rootMarkers) {
				if (isFile(join(dir, marker))) return dir;
			}
			if (dir === this.cwd) break;
			dir = dirname(dir);
		}
		return null;
	}

	/** Open a document (store it); start the server and didOpen if possible. */
	upsertDocument(absFile: string, languageId: string, text: string): void {
		const ext = "." + (absFile.split(".").pop() ?? "");
		const match = this.serverForExt(ext);
		const id = match?.id ?? "unknown";
		const existing = this.openDocs.get(absFile);
		const version = (existing?.version ?? 0) + 1;
		const uri = pathToUri(absFile);
		this.openDocs.set(absFile, { serverId: id, languageId, uri, text, version });

		const handle = match ? this.servers.get(id) : undefined;
		if (!handle) return;
		if (!handle.server.isReady()) return; // deferred until ready (openTrackedForServer)
		if (existing) {
			handle.server.didChange(uri, text, version);
		} else {
			handle.server.didOpen(uri, languageId, text);
		}
	}

	/**
	 * Get (and lazily start) the server for a file. Returns null when the file
	 * is external, unregistered, or the server is unavailable.
	 */
		serverFor(absRaw: string): { handle: ServerHandle; absFile: string } | null {
		const absFile = this.normalizeInCwd(absRaw);
		if (!absFile) return null;
		const ext = "." + (absFile.split(".").pop() ?? "");
		const match = this.serverForExt(ext);
		if (!match) return null;
		const handle = this.servers.get(match.id) ?? this.launch(match.id, match.config, absFile);
		if (!handle) return null;
		return { handle, absFile };
	}

	private launch(id: string, config: LSServerConfig, absFile: string): ServerHandle | null {
		const root = this.findRootForFile(absFile, config);
		if (root === null && !config.singleFile) return null;

		const executable = findExecutable(config.command, this.extraPaths);
		if (!executable) {
			this.log(`server '${id}' (${config.command}) not found on path`);
			return null;
		}
		const cwd = root ?? dirname(absFile);
		const handle: ServerHandle = {
			id,
			config,
			server: new LanguageServer({
				command: executable,
				args: config.args,
				cwd,
				rootUri: root ? pathToUri(root) : null,
				languageId: config.languageId,
				settings: config.settings,
				log: (m) => this.log(`[${id}] ${m}`),
			}),
			root,
		};
		handle.server.onDiagnostics(this.onDiagnostics);
		this.servers.set(id, handle);
		void handle.server.ready().then(() => this.openTrackedForServer(id));
		return handle;
	}

	/** Open all already-tracked documents belonging to a freshly started server. */
	private openTrackedForServer(serverId: string): void {
		for (const [absFile, doc] of this.openDocs) {
			if (doc.serverId === serverId) {
				this.servers.get(serverId)?.server.didOpen(doc.uri, doc.languageId, doc.text);
				doc.version = 1;
			}
		}
	}

	private onDiagnostics: DiagnosticsHandler = (uri, diags) => {
		this.diagnostics.set(uri, diags);
		this.diagVersion.set(uri, (this.diagVersion.get(uri) ?? 0) + 1);
		this.diagEvents++;
	};

	/** Total count of publishDiagnostics events received. */
	diagEventCount(): number {
		return this.diagEvents;
	}

	/** Latest pushed diagnostics for a file, keyed by its path. */
	diagnosticsFor(absFile: string): Diagnostic[] {
		return this.diagnostics.get(pathToUri(resolve(absFile))) ?? [];
	}

	/** All known diagnostics across every running server. */
	allDiagnostics(): Array<{ uri: string; diagnostics: Diagnostic[] }> {
		const out: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
		for (const handle of this.servers.values()) {
			for (const uri of this.openDocs.values()) {
				if (uri.serverId !== handle.id) continue;
				const diags = this.diagnostics.get(uri.uri);
				if (diags && diags.length > 0) out.push({ uri: uri.uri, diagnostics: diags });
			}
		}
		return out;
	}

	/**
	 * Change a file then wait briefly for diagnostics to refresh. Returns the
	 * diagnostics for that file after the change settles (or an empty list).
	 */
	async refreshAfterWrite(absFile: string, languageId: string, text: string, waitMs = 2000): Promise<Diagnostic[]> {
		const before = this.diagVersion.get(pathToUri(resolve(absFile))) ?? 0;
		this.upsertDocument(absFile, languageId, text);
		const uri = pathToUri(resolve(absFile));
		const deadline = Date.now() + waitMs;
		while (Date.now() < deadline) {
			if ((this.diagVersion.get(uri) ?? 0) > before) break;
			await new Promise((r) => setTimeout(r, 50));
		}
		return this.diagnosticsFor(absFile);
	}

	/** Determine which server ids have source files present in the project. */
	discoverLanguages(): string[] {
		const found = new Set<string>();
		const walk = (dir: string): void => {
			let entries: Dirent[];
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "target") continue;
				const full = join(dir, e.name);
				if (e.isDirectory()) {
					if (e.name === "generated") continue;
					walk(full);
				} else {
					const m = this.serverForExt("." + e.name.split(".").pop());
					if (m) found.add(m.id);
				}
			}
		};
		walk(this.cwd);
		return [...found];
	}

	/** Ensure a server is launched by id (for lsp_* tool calls on whole project). */
	ensureServerById(id: string): ServerHandle | null {
		const existing = this.servers.get(id);
		if (existing) return existing;
		const config = this.serverConfigs[id];
		if (!config) return null;
		return this.launch(id, config, join(this.cwd, "placeholder" + config.extensions[0]));
	}

	/** Ensure a server is launched for a specific file and return diagnostics channel. */
	rootMarkersOf(cwd?: string): string[] {
		const dir = cwd ?? this.cwd;
		const markers: string[] = [];
		for (const config of Object.values(this.serverConfigs)) {
			for (const marker of config.rootMarkers) {
				if (isFile(join(dir, marker)) && !markers.includes(marker)) markers.push(marker);
			}
		}
		if (isDir(join(dir, ".git")) || isFile(join(dir, ".git"))) {
			if (!markers.includes(".git")) markers.push(".git");
		}
		return markers;
	}

	/** Shut down every running server. */
	dispose(): void {
		for (const handle of this.servers.values()) handle.server.dispose();
		this.servers.clear();
	}
}

export type { Diagnostic };
