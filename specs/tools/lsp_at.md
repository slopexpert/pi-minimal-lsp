# tool spec: lsp_at

## parameters
- `line`, `col`: 1-based position of the anchor symbol
- `file`
- `kinds?`: which operations to run
    - `Kind = definition | hover | declaration | typedef | implementation | references | callers | callees`
    - omitted -> full deduped set
- `depth?`: call-graph recursion for `callers`/`callees` only. Default 1
- `maxResults?`: cap for fan-out kinds only (`references`, `callers`, `callees`); small kinds are never capped

## guidance
- Use when you need info at a precise location; the opposite of `lsp_explore` (browse) and `lsp_search` (look up by name).
- Request only the kinds you need; omitted = everything (cheap by default).
- `depth` only affects `callers`/`callees`.
- Results deduped by location; richest label wins.

## agent output examples
```markdown
info at `cmd/new_issue.go:10:2` `func MakeErr(s string) error`
- hover: `MakeErr` builds an error from a message string
- definition: `cmd/new_issue.go:10:2`
- references: `cmd/mod_issue.go:3:5`
- callers: `cmd/mod_issue.go:9:3` `func Cmd(app *app.App) error`
```
- `line:col`
- only show kinds that returned something

## human output
```markdown
lsp_at cmd/new_issue.go:10:2
󰊕 definition    cmd/new_issue.go:10:2
󰈇 references    3
󰆧 callers       cmd/mod_issue.go:9:3
N+ more (<key> to expand)
```
- `<key>` is the expand tool key (ctrl+o by default)
- output is collapsed to a ~10-row preview by default; `N+ more (ctrl+o to expand)` hints at the rest, ctrl+o toggles the full list
- the icon, kind label, and summary should follow the same color rules as `lsp_search`
- see `specs/reference/lsp_icon_kinds.md` for the lsp icons
