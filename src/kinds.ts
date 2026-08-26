/**
 * LSP SymbolKind -> display name + nerdfont icon (from the lspkind.nvim map
 * referenced in specs/reference/lsp_icon_kinds.md).
 */

import type { SymbolKindValue } from "./lsp/types.ts";

export interface KindInfo {
	name: string;
	icon: string;
}

const ICON = {
	text: "\uF0E9",
	method: "\uF086",
	function: "\uF095",
	constructor: "\uF423",
	field: "\uF09B",
	variable: "\uF02B",
	class: "\uF071",
	interface: "\uF0E8",
	module: "\uF0C7",
	property: "\uF09B",
	unit: "\uF06D",
	value: "\uF0A0",
	enum: "\uF75D",
	keyword: "\uF0CB",
	snippet: "\uF06F",
	color: "\uF758",
	file: "\uF759",
	reference: "\uF087",
	folder: "\uF0CB",
	enumMember: "\uF75D",
	constant: "\uF07F",
	struct: "\uF645",
	event: "\uF0E7",
	operator: "\uF035",
	typeParameter: "",
} as const;

/** SymbolKindValue -> KindInfo. */
export const KINDS: Record<number, KindInfo> = {
	1: { name: "File", icon: ICON.file },
	2: { name: "Module", icon: ICON.module },
	3: { name: "Namespace", icon: ICON.module },
	4: { name: "Package", icon: ICON.module },
	5: { name: "Class", icon: ICON.class },
	6: { name: "Method", icon: ICON.method },
	7: { name: "Property", icon: ICON.property },
	8: { name: "Field", icon: ICON.field },
	9: { name: "Constructor", icon: ICON.constructor },
	10: { name: "Enum", icon: ICON.enum },
	11: { name: "Interface", icon: ICON.interface },
	12: { name: "Function", icon: ICON.function },
	13: { name: "Variable", icon: ICON.variable },
	14: { name: "Constant", icon: ICON.constant },
	15: { name: "Text", icon: ICON.text },
	16: { name: "Number", icon: ICON.value },
	17: { name: "Boolean", icon: ICON.value },
	18: { name: "Array", icon: ICON.text },
	19: { name: "Object", icon: ICON.text },
	20: { name: "Key", icon: ICON.text },
	21: { name: "Null", icon: ICON.text },
	22: { name: "Enum Member", icon: ICON.enumMember },
	23: { name: "Struct", icon: ICON.struct },
	24: { name: "Event", icon: ICON.event },
	25: { name: "Operator", icon: ICON.operator },
	26: { name: "Type Parameter", icon: ICON.typeParameter },
};

export const FALLBACK_KIND: KindInfo = { name: "Symbol", icon: ICON.function };

export function kindInfo(kind: number | undefined): KindInfo {
	return (kind !== undefined && KINDS[kind]) || FALLBACK_KIND;
}
