/**
 * TUI rendering for the four lsp_* tools. Each renderResult reads the tool's
 * structured `details` and renders compact, color-coded human output following
 * the specs (accent/warning/fg/muted fg colors + nerdfont icons + "N more").
 */

import { Text } from "@earendil-works/pi-tui";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { kindInfo } from "./kinds.ts";

const ICON = {
	folder: "\uF07B", // nf-fa-folder
	file: "\uEA7B", // nf-cod-file
	keywords: "\uF113D", // nf-md-text_recognition
	check: "\uF00C", // nf-fa-check
	warning: "\uF071", // nf-fa-warning
	error: "\uEA87", // nf-cod-error
	disclosure: "\uF078", // chevron, fallback for unknown
};

interface RenderOpts {
	expanded: boolean;
	isPartial: boolean;
	pad?: number;
}

/** Generic tool-call header: tool name (bold) + fg-colored args. */
export function renderCall(toolName: string, args: Record<string, unknown>, theme: any): Text {
	const text = new Text("", 0, 0);
	let content = theme.fg("toolTitle", theme.bold(toolName));
	const path = (args.path as string) ?? (args.file as string) ?? (args.query as string) ?? "";
	if (path && !(args as any)?.hidePath) content += " " + theme.fg("fg", path);
	if (args.file && args.line !== undefined) {
		content += " " + theme.fg("accent", `${args.file}:${args.line}:${args.col}`);
	}
	text.setText(content);
	return text;
}

export function renderResult(details: any, opts: RenderOpts, theme: any): Text {
	switch (details?.kind) {
		case "explore": {
			if (details.root !== undefined || details.file) return renderExplore(details, opts, theme);
			return renderExplore(details, opts, theme);
		}
		case "search":
			return renderSearch(details, opts, theme);
		case "at":
			return renderAt(details, opts, theme);
		case "diagnostics":
			return renderDiagnostics(details, opts, theme);
		default:
			return new Text(theme.fg("dim", "no details"), 0, 0);
	}
}

function moreLine(theme: any, more: number, pad: number): Text {
	const t = new Text("", pad, 0);
	t.setText(theme.fg("muted", `${more}+ more (${keyHint("app.tools.expand", "to expand")})`));
	return t;
}

function renderExplore(details: any, _opts: RenderOpts, theme: any): Text {
	const pad = 1;
	const text = new Text("", pad, 0);
	let content = "";

	if (details.file) {
		// file outline
		content += theme.fg("fg", details.file) + "\n";
		let shown = 0;
		for (const row of (details.rows ?? []).slice(0, 60)) {
			const info = kindInfo(row.kind);
			content += theme.fg("accent", ` ${info.icon} `) + theme.fg("fg", row.name) + "\n";
			shown++;
		}
		if (details.rows && details.rows.length > shown) {
			content += theme.fg("muted", `${details.rows.length - shown}+ more (${keyHint("app.tools.expand", "to expand")})`) + "\n";
		}
		text.setText(content.trimEnd());
		return text;
	}

	// dir / project overview
	for (const d of details.dirs ?? []) {
		content += theme.fg("accent", `${ICON.folder} `) + theme.fg("fg", `${d.name}/`) + "\t";
		content += theme.fg("muted", `${ICON.keywords} ${(d.keywords ?? []).join(", ")}`) + "\n";
	}
	for (const f of details.files ?? []) {
		content += theme.fg("warning", `${ICON.file} `) + theme.fg("fg", f) + "\n";
	}
	if (details.more > 0) {
		content += theme.fg("muted", `${details.more}+ more`) + "\n";
	}
	text.setText(content.trimEnd());
	return text;
}

function renderSearch(details: any, _opts: RenderOpts, theme: any): Text {
	const text = new Text("", 1, 0);
	let content = "";
	let shown = 0;
	for (const r of (details.results ?? []).slice(0, 60)) {
		const info = kindInfo(r.kind);
		content += theme.fg("accent", `${info.icon} `) + theme.fg("fg", r.name);
		if (details.file) {
			content += "\n"; // no per-symbol paths when searching one file
		} else {
			content += " " + theme.fg("muted", `${r.file}:${r.line}:${r.col}`) + "\n";
		}
		shown++;
	}
	const total = details.results?.length ?? 0;
	if (total > shown) {
		content += theme.fg("muted", `${total - shown}+ more (${keyHint("app.tools.expand", "to expand")})`) + "\n";
	}
	text.setText(content.trimEnd());
	return text;
}

function renderAt(details: any, _opts: RenderOpts, theme: any): Text {
	const text = new Text("", 1, 0);
	let content = "";
	let shown = 0;
	const kinds = details.kinds ?? [];
	for (const k of kinds) {
		const info = { name: k.kindLabel, icon: k.icon } as any;
		const line =
			`${info.icon} ${k.label}\t` +
			(k.summary !== undefined
				? theme.fg("fg", String(k.summary))
				: (k.locations ?? []).map((l: any) => theme.fg("muted", l)).join(" "));
		content += `${theme.fg("accent", info.icon)} ${theme.fg("accent", k.label)}\t${line}` + "\n";
		shown++;
	}
	if (details.more > 0) {
		content += theme.fg("muted", `${details.more}+ more (${keyHint("app.tools.expand", "to expand")})`) + "\n";
	}
	text.setText(content.trimEnd());
	return text;
}

function renderDiagnostics(details: any, _opts: RenderOpts, theme: any): Text {
	const text = new Text("", 1, 0);
	if (details.ok && (details.errors ?? 0 + (details.warnings ?? 0)) === 0 && details.total === 0) {
		text.setText(theme.fg("accent", `${ICON.check} lsp_diagnostics`));
		return text;
	}
	let content = "";
	for (const d of details.items ?? []) {
		const icon = d.severity === 1 ? ICON.error : ICON.warning;
		const color = d.severity === 1 ? "error" : "warning";
		const msgColor = d.severity === 1 ? "fg" : "muted";
		content += theme.fg(color, `${icon} `) + theme.fg(msgColor, `${d.message} (${d.file}:${d.line}:${d.col})`) + "\n";
	}
	text.setText(content.trimEnd());
	return text;
}

export function severityColor(severity: number): string {
	return severity === 1 ? "error" : "warning";
}
export { ICON };
