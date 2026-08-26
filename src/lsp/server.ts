/**
 * A single managed language-server process. Handles the LSP lifecycle
 * (initialize -> initialized -> didOpen/didChange/didSave), request/notify
 * plumbing over stdio, and surfaces server-pushed diagnostics and log messages.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ByteFramer, framed, type IncomingMessage, type RequestMessage } from "./jsonrpc.ts";
import type { Diagnostic } from "./types.ts";

export interface ServerOptions {
	command: string;
	args?: string[];
	cwd: string;
	rootUri: string | null; // null for single-file mode (no workspace folder)
	languageId: string;
	settings?: Record<string, unknown>; // workspace configuration to send to the server
	extraEnv?: Record<string, string>;
	log?: (msg: string) => void;
}

const CLIENT_CAPABILITIES = {
	workspace: {
		workspaceFolders: true,
		configuration: true,
		symbol: { dynamicRegistration: false },
		didChangeConfiguration: { dynamicRegistration: false },
	},
	textDocument: {
		hover: { dynamicRegistration: false },
		documentSymbol: { hierarchicalDocumentSymbolSupport: true },
		symbol: { hierarchicalDocumentSymbolSupport: true },
		declaration: { dynamicRegistration: false, linkSupport: true },
		definition: { dynamicRegistration: false, linkSupport: true },
		typeDefinition: { dynamicRegistration: false, linkSupport: true },
		implementation: { dynamicRegistration: false, linkSupport: true },
		references: { dynamicRegistration: false },
		callHierarchy: { dynamicRegistration: false },
		diagnostic: { dynamicRegistration: false, relatedDocumentDiagnostic: false },
		formatting: { dynamicRegistration: false },
	},
	callHierarchy: {
		dynamicRegistration: false,
	},
};

export type DiagnosticsHandler = (uri: string, diagnostics: Diagnostic[]) => void;

export class LanguageServer {
	private proc: ChildProcessWithoutNullStreams;
	private framer: ByteFramer;
	private nextId = 1;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private closed = false;
	private readyPromise: Promise<void>;
	private readyResolve!: () => void;
	private readyDone = false;
	private diagHandlers = new Set<DiagnosticsHandler>();
	readonly languageId: string;
	readonly rootUri: string | null;

	constructor(private options: ServerOptions) {
		this.languageId = options.languageId;
		this.rootUri = options.rootUri;
		this.proc = spawn(options.command, options.args ?? [], {
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...options.extraEnv },
		});
		this.framer = new ByteFramer((msg) => this.route(msg));
		this.proc.stdout.on("data", (chunk: Buffer) => this.framer.feed(chunk));
		this.proc.stderr.on("data", (chunk: Buffer) => this.log(`[stderr] ${chunk.toString().trimEnd()}`));
		this.proc.on("error", (err) => this.failAll(err));
		this.proc.on("exit", (code, signal) => {
			this.closed = true;
			this.failAll(new Error(`language server exited (code=${code} signal=${signal})`));
		});
		this.readyPromise = new Promise((resolve) => (this.readyResolve = resolve));
		void this.init();
	}

	private log(msg: string): void {
		this.options.log?.(msg);
	}

	private failAll(err: Error): void {
		for (const { reject } of this.pending.values()) reject(err);
		this.pending.clear();
	}

	private route(msg: IncomingMessage): void {
		if ((msg as RequestMessage).id !== undefined && "method" in msg) {
			const req = msg as RequestMessage;
			this.handleRequest(req);
			return;
		}
		if ((msg as RequestMessage).id !== undefined && ("result" in msg || "error" in msg)) {
			const id = (msg as RequestMessage).id;
			if (typeof id === "number") {
				const p = this.pending.get(id);
				if (p) {
					this.pending.delete(id);
					if ("error" in msg && msg.error) p.reject(new Error(`${(msg.error as { message?: string }).message ?? "error"} (code ${(msg.error as { code?: number }).code ?? "?"})`));
					else p.resolve((msg as { result?: unknown }).result);
				}
			}
			return;
		}
		// Notification
		const method = (msg as { method: string }).method;
		const params = (msg as { params?: any }).params;
		if (method === "textDocument/publishDiagnostics") {
			const uri = params?.uri as string;
			const diagnostics = (params?.diagnostics ?? []) as Diagnostic[];
			for (const h of this.diagHandlers) h(uri, diagnostics);
		} else if (method === "window/logMessage" || method === "window/showMessage") {
			this.log(`[${params?.type ?? "log"}] ${params?.message ?? ""}`);
		} else {
			this.log(`[notification] ${method}`);
		}
	}

	/** Answer server-initiated requests (a small surface that gopls/other servers rely on). */
	private async handleRequest(req: RequestMessage): Promise<void> {
		try {
			switch (req.method) {
				case "workspace/configuration": {
					const items = (req.params as { items?: Array<{ section?: string }> } | undefined)?.items ?? [];
					const result = items.map((it) => {
						const section = it.section ?? "";
						const settings = this.options.settings ?? {};
						return section.split(".").reduce((acc, k) => (acc && typeof acc === "object" ? (acc as any)[k] : undefined), settings) ?? null;
					});
					this.send({ jsonrpc: "2.0", id: req.id, result });
					return;
				}
				case "workspace/workspaceFolders": {
					this.send({
						jsonrpc: "2.0",
						id: req.id,
						result: this.options.rootUri === null ? null : [{ uri: this.options.rootUri, name: this.options.rootUri.split("/").pop() ?? "" }],
					});
					return;
				}
				default:
					this.log(`[unhandled request] ${req.method}`);
					this.send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } } as never);
			}
		} catch (err) {
			this.send({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: `internal error: ${(err as Error).message}` } } as never);
		}
	}

	private async init(): Promise<void> {
		try {
			const result = (await this.request("initialize", {
				processId: process.pid,
				rootUri: this.options.rootUri,
				workspaceFolders:
					this.options.rootUri === null
						? null
						: [{ uri: this.options.rootUri, name: this.options.rootUri.split("/").pop() ?? "" }],
				capabilities: CLIENT_CAPABILITIES,
				initializationOptions: this.options.settings,
			})) as { capabilities?: Record<string, unknown> };
			this.notify("initialized", {});
			this.applyServerCapabilities(result.capabilities ?? {});
			// Give the server a chance to pull in workspace configuration
			if (this.options.settings && Object.keys(this.options.settings).length > 0) {
				this.notify("workspace/didChangeConfiguration", { settings: this.options.settings });
			}
			this.readyResolve();
			this.readyDone = true;
		} catch (err) {
			this.log(`initialize failed: ${(err as Error).message}`);
			this.readyDone = true;
			this.readyResolve();
		}
	}

	private applyServerCapabilities(_cap: Record<string, unknown>): void {
		// Reserved for future use (e.g. registering dynamic providers)
	}

	/** Resolves once the server is past `initialized`. */
	ready(): Promise<void> {
		return this.readyPromise;
	}

	/** True once the server has finished initialize/initialized. */
	isReady(): boolean {
		return this.readyDone;
	}

	/** Fire a request and await its response. */
	request<T>(method: string, params?: unknown): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			if (this.closed) {
				reject(new Error("language server is closed"));
				return;
			}
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	/** Fire a notification with no response. */
	notify(method: string, params?: unknown): void {
		if (this.closed) return;
		this.send({ jsonrpc: "2.0", method, params });
	}

	private send(msg: unknown): void {
		this.proc.stdin.write(framed(msg));
	}

	/** Register a handler for server-pushed diagnostics. Returns an unsubscribe fn. */
	onDiagnostics(handler: DiagnosticsHandler): () => void {
		this.diagHandlers.add(handler);
		return () => this.diagHandlers.delete(handler);
	}

	// ---- text document lifecycle -------------------------------------------------

	didOpen(uri: string, languageId: string, text: string): void {
		this.notify("textDocument/didOpen", {
			textDocument: { uri, languageId, version: 1, text },
		});
	}

	didChange(uri: string, text: string, version: number): void {
		this.notify("textDocument/didChange", {
			textDocument: { uri, version },
			contentChanges: [{ text }],
		});
	}

	didSave(uri: string, text: string): void {
		this.notify("textDocument/didSave", { textDocument: { uri }, text });
	}

	didClose(uri: string): void {
		this.notify("textDocument/didClose", { textDocument: { uri } });
	}

	isClosed(): boolean {
		return this.closed;
	}

	/** Tear the process down (shutdown + exit). */
	dispose(): void {
		if (this.closed) return;
		try {
			this.notify("exit", null);
		} catch {
			/* ignore */
		}
		this.closed = true;
	}
}
