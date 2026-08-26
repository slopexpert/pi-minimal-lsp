# tool spec: lsp_search

## parameters
- `query`: self explanatory
- `path?`
    - **no path**: workspace symbols search
    - **path is dir**: workspace symbols search, filtered by directory 
    - **path is file**: document symbol search

## guidance
- Use when you know a symbol name but not where it lives; the opposite of `lsp_explore` (browse vs lookup).
- `query` is required and must be non-empty. An empty query isn't a search - use `lsp_explore` for an outline.
- Narrow with `path`: dir filters results to that subtree, file searches within one file.
- Results are flat locations, not nested outlines - `workspace/symbol` has no children. 
    - Each row may include the enclosing `containerName` (shown as `on Bar` when present) for disambiguating same-name matches. 
- Matches are capped; `... N more` = more exist. Refine the query or scope instead of assuming the list is complete.

## agent output examples
```markdown
symbols matching `err` in dir `isshues`
- Function `func ErrCmd(app *app.App) error {` cmd/mod_issue.go:2:3 
- Constant `ErrNotEnoughArgs = fmt.Errorf("not enough args")` cmd/new_issue.go:2:3
- Constant `ErrTooManyArgs = fmt.Errorf("too many args")` cmd/new_issue.go:3:3
- Function `func MakeErr(s string) error {` cmd/new_issue.go:10:2
```
- (`line:col`)
- if path is file, do not show per symbol paths
- if path is file, say `symbols matching ... in file ...`

## human output
```markdown
lsp_search "err"
󰊕 ErrCmd cmd/mod_issue.go:2:3 
󰏿 ErrNotEnoughArgs 
N+ more (<key> to expand)
```
- `<key>` is the expand tool key (ctrl+o by defualt)
- output is collapsed to a ~10-row preview by default; `N+ more (ctrl+o to expand)` hints at the rest, ctrl+o toggles the full list
- the file:line:col should be muted color
- the lsp icons should be accent color
- the symbol names should be fg color
- the N+ more.... line should be muted color
- see `specs/reference/lsp_icon_kinds.md` for information on the lsp icons
- if path is file, do not show per symbol paths
