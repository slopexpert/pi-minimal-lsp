/**
 * Minimal LSP JSON-RPC transport over stdio.
 *
 * Encodes/decodes the Content-Length framed JSON-RPC 2.0 messages used by
 * the Language Server Protocol and drives a read loop that routes responses,
 * requests and notifications to consumers. Pure and fully unit-testable.
 */

export type JSONRPC = {
	jsonrpc: "2.0";
	[id: string]: unknown;
};

export type RequestMessage = JSONRPC & {
	id: number | string;
	method: string;
	params?: unknown;
};

export type NotificationMessage = JSONRPC & {
	method: string;
	params?: unknown;
};

export type ResponseMessage = JSONRPC & {
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

export type IncomingMessage = RequestMessage | ResponseMessage | NotificationMessage;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Wrap a JSON payload in the LSP Content-Length framing header. */
export function encodeMessage(body: string): Uint8Array {
	const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
	return encoder.encode(payload);
}

/** Serialize a structured object into a framed JSON string (for writing). */
export function framed(message: unknown): string {
	return `Content-Length: ${Buffer.byteLength(JSON.stringify(message), "utf8")}\r\n\r\n${JSON.stringify(message)}`;
}

/**
 * Incremental Content-Length framed parser.
 * Feed raw chunks; returns all complete messages decoded so far and keeps
 * leftover bytes buffered until the next chunk arrives.
 */
export class FramedParser {
	private buf = "";
	private onMessage: (msg: IncomingMessage) => void;

	constructor(onMessage: (msg: IncomingMessage) => void) {
		this.onMessage = onMessage;
	}

	/** Consume a raw chunk, dispatching any complete messages to the handler. */
	feed(chunk: string): void {
		this.buf += chunk;
		let idx: number;
		while ((idx = this.buf.indexOf("\r\n\r\n")) !== -1) {
			const headerBlock = this.buf.slice(0, idx);
			const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerBlock);
			if (!lengthMatch) {
				// Malformed header: drop everything up to and including the delimiter
				this.buf = this.buf.slice(idx + 4);
				continue;
			}
			const length = Number(lengthMatch[1]);
			const bodyStart = idx + 4;
			if (this.buf.length < bodyStart + length) {
				break; // wait for the rest of the body
			}
			const body = this.buf.slice(bodyStart, bodyStart + length);
			this.buf = this.buf.slice(bodyStart + length);
			this.onMessage(JSON.parse(body) as IncomingMessage);
		}
	}

	/** Any leftover buffered (incomplete) bytes. */
	get buffered(): string {
		return this.buf;
	}
}

export function isResponse(msg: IncomingMessage): msg is ResponseMessage {
	return typeof (msg as ResponseMessage).id !== "undefined" && "result" in msg || typeof (msg as ResponseMessage).id !== "undefined" && "error" in msg;
}

export function isNotification(msg: IncomingMessage): msg is NotificationMessage {
	return "method" in msg && typeof (msg as NotificationMessage).id === "undefined";
}

export function isRequest(msg: IncomingMessage): msg is RequestMessage {
	return "method" in msg && typeof (msg as RequestMessage).id !== "undefined";
}
