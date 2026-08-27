/**
 * TUI rendering for the four lsp_* tools. Each renderResult reads the tool's
 * structured `details` and renders compact, color-coded human output following
 * the specs (accent/warning/fg/muted fg colors + nerdfont icons + "N more").
 */

import { Text } from "@earendil-works/pi-tui";
import { keyText } from "@earendil-works/pi-coding-agent";
import { kindInfo } from "./kinds.ts";

const ICON = {
  folder: "", // nf-fa-folder
  file: "", // nf-cod-file
  keywords: "󱄽", // nf-md-text_recognition
  check: "", // nf-fa-check
  warning: "", // nf-fa-warning
  error: "", // nf-cod-error
  disclosure: "", // chevron, fallback for unknown
};

interface RenderOpts {
  expanded: boolean;
  isPartial: boolean;
  pad?: number;
}

// max rows shown before the output is collapsed; ctrl+o expands
const PREVIEW = 10;

/** Truncate a plain string to roughly the terminal width (ellipsis if cut). */
function clip(s: string, max?: number): string {
  const m = max ?? Math.max(40, (process.stdout?.columns ?? 100) - 12);
  return s.length <= m ? s : s.slice(0, m - 3) + "...";
}

/** Generic tool-call header: tool name (bold) + fg-colored args. */
export function renderCall(
  toolName: string,
  args: Record<string, unknown>,
  theme: any,
): Text {
  const text = new Text("", 0, 0);
  let content = theme.fg("toolTitle", theme.bold(toolName));
  const file = args.file as string | undefined;
  const loc = file && args.line !== undefined;
  if (loc) {
    // lsp_at: single file:line:col location
    content +=
      " " + theme.fg("accent", `${clip(file)}:${args.line}:${args.col}`);
  } else {
    const path = (args.path as string) ?? file;
    if (path && !(args as any)?.hidePath) {
      content += " " + theme.fg("text", clip(path));
    }
    if (args.query) {
      // show the quoted query (explore filter / search term)
      content += " " + theme.fg("text", clip(`"${args.query}"`, 40));
    }
  }
  text.setText(content);
  return text;
}

export function renderResult(details: any, opts: RenderOpts, theme: any): Text {
  if (details && details.error) {
    return new Text(theme.fg("error", String(details.error)), 0, 0);
  }
  switch (details?.kind) {
    case "explore":
      return renderExplore(details, opts, theme);
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

function foot(theme: any, more: number): string {
  return (
    theme.fg("muted", `${more}+ more `) +
    theme.fg("dim", `(${keyText("app.tools.expand")} to expand)`)
  );
}

function renderExplore(details: any, opts: RenderOpts, theme: any): Text {
  const pad = 1;
  const text = new Text("", pad, 0);
  let content = "";

  if (details.file) {
    // file outline
    content += theme.fg("text", clip(details.file)) + "\n";
    const rows = details.rows ?? [];
    const limit = opts.expanded ? rows.length : PREVIEW;
    for (const row of rows.slice(0, limit)) {
      const info = kindInfo(row.kind);
      content +=
        theme.fg("accent", ` ${info.icon} `) +
        theme.fg("text", clip(row.name)) +
        "\n";
    }
    if (rows.length > limit) content += foot(theme, rows.length - limit) + "\n";
    text.setText(content.trimEnd());
    return text;
  }

  // dir / project overview
  const dirLines: string[] = [];
  for (const d of details.dirs ?? []) {
    const kw = d.keywords ?? [];
    let line =
      theme.fg("accent", `${ICON.folder} `) +
      theme.fg("text", clip(`${d.name}/`, 40));
    if (kw.length > 0)
      line +=
        " " + theme.fg("muted", `${ICON.keywords} ${clip(kw.join(", "), 60)}`);
    dirLines.push(line);
  }
  const fileLines: string[] = [];
  for (const f of details.files ?? []) {
    const fname = typeof f === "string" ? f : f.name;
    const fkw = typeof f === "string" ? [] : f.keywords ?? [];
    let line =
      theme.fg("warning", `${ICON.file} `) + theme.fg("text", clip(fname, 60));
    if (fkw.length > 0)
      line +=
        " " + theme.fg("muted", `${ICON.keywords} ${clip(fkw.join(", "), 60)}`);
    fileLines.push(line);
  }
  const all = [...dirLines, ...fileLines];
  const limit = opts.expanded ? all.length : PREVIEW;
  content = all.slice(0, limit).join("\n");
  const more = all.length - limit + (details.more ?? 0);
  if (more > 0) content += (content ? "\n" : "") + foot(theme, more);
  text.setText(content.trimEnd());
  return text;
}

function renderSearch(details: any, opts: RenderOpts, theme: any): Text {
  const text = new Text("", 1, 0);
  const results = details.results ?? [];
  if (results.length === 0) {
    text.setText(theme.fg("muted", "no results"));
    return text;
  }
  const limit = opts.expanded ? results.length : PREVIEW;
  let content = "";
  for (const r of results.slice(0, limit)) {
    const info = kindInfo(r.kind);
    content +=
      theme.fg("accent", `${info.icon} `) + theme.fg("text", clip(r.name));
    if (details.file) {
      content += "\n"; // no per-symbol paths when searching one file
    } else {
      content +=
        " " + theme.fg("muted", clip(`${r.file}:${r.line}:${r.col}`)) + "\n";
    }
  }
  if (results.length > limit) content += foot(theme, results.length - limit);
  text.setText(content.trimEnd());
  return text;
}

function renderAt(details: any, opts: RenderOpts, theme: any): Text {
  const text = new Text("", 1, 0);
  const results = details.results ?? [];
  const limit = opts.expanded ? results.length : PREVIEW;
  let content = "";
  for (const k of results.slice(0, limit)) {
    const icon = k.icon ?? "\uF087";
    if (k.summary !== undefined) {
      content +=
        `${theme.fg("accent", `${icon} ${clip(k.label, 24)}`)}  ${theme.fg("text", clip(String(k.summary)))}` +
        "\n";
    } else {
      const locs = (k.locations ?? [])
        .map((l: any) => theme.fg("muted", clip(l, 60)))
        .join("  ");
      content +=
        `${theme.fg("accent", `${icon} ${clip(k.label, 24)}`)}  ${locs}` + "\n";
    }
  }
  const more =
    (results.length > limit ? results.length - limit : 0) + (details.more ?? 0);
  if (more > 0) content += foot(theme, more);
  text.setText(content.trimEnd());
  return text;
}

export function renderDiagnostics(details: any, opts: RenderOpts, theme: any): Text {
  const text = new Text("", 1, 0);
  if (
    details.ok &&
    (details.errors ?? 0 + (details.warnings ?? 0)) === 0 &&
    details.total === 0
  ) {
    text.setText(theme.fg("accent", ICON.check) + " " + theme.fg("text", "no diagnostics"));
    return text;
  }
  const items = details.items ?? [];
  const limit = opts.expanded ? items.length : PREVIEW;
  let content = "";
  for (const d of items.slice(0, limit)) {
    const icon = d.severity === 1 ? ICON.error : ICON.warning;
    const color = d.severity === 1 ? "error" : "warning";
    const msgColor = color; // whole error line colored by severity
    content +=
      theme.fg(color, `${icon} `) +
      theme.fg(msgColor, clip(`${d.message} (${d.file}:${d.line}:${d.col})`)) +
      "\n";
  }
  if (items.length > limit) content += foot(theme, items.length - limit);
  text.setText(content.trimEnd());
  return text;
}

export function severityColor(severity: number): string {
  return severity === 1 ? "error" : "warning";
}
export { ICON };
