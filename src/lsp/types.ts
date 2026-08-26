/**
 * LSP protocol types referenced by the tools. Kept intentionally narrow to the
 * subset of the LSP we consume (documentSymbol, workspace/symbol, hover,
 * definition/declaration/implementation/typeDefinition, references,
 * callHierarchy, diagnostics, formatting).
 */

export type SymbolKindValue =
	| 1 // File
	| 2 // Module
	| 3 // Namespace
	| 4 // Package
	| 5 // Class
	| 6 // Method
	| 7 // Property
	| 8 // Field
	| 9 // Constructor
	| 10 // Enum
	| 11 // Interface
	| 12 // Function
	| 13 // Variable
	| 14 // Constant
	| 15 // String
	| 16 // Number
	| 17 // Boolean
	| 18 // Array
	| 19 // Object
	| 20 // Key
	| 21 // Null
	| 22 // EnumMember
	| 23 // Struct
	| 24 // Event
	| 25 // Operator
	| 26; // TypeParameter

export interface Position {
	line: number; // 0-based
	character: number; // 0-based
}

export interface Range {
	start: Position;
	end: Position;
}

export interface Location {
	uri: string;
	range: Range;
}

export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: SymbolKindValue;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
	tags?: number[];
}

export interface SymbolInformation {
	name: string;
	kind: SymbolKindValue;
	location: Location;
	containerName?: string;
	tags?: number[];
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4; // Error, Warning, Information, Hint

export interface Diagnostic {
	range: Range;
	severity?: DiagnosticSeverity;
	code?: string | number;
	source?: string;
	message: string;
	tags?: number[];
}

export interface DiagnosticNotificationParams {
	uri: string;
	diagnostics: Diagnostic[];
	version?: number;
}

export interface MarkupContent {
	kind: "plaintext" | "markdown";
	value: string;
}

export interface Hover {
	contents: string | MarkupContent | Array<string | MarkupContent>;
	range?: Range;
}

export interface DocumentSymbolParams {
	textDocument: { uri: string };
}

export interface WorkspaceSymbolParams {
	query: string;
}

export interface TextDocumentPositionParams {
	textDocument: { uri: string };
	position: Position;
}
