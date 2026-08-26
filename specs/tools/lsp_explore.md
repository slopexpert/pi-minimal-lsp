# tool spec: lsp_explore

## parameters
- `path?`
    - **no path** (unset or empty string): overview of entire project
    - **path is dir**: overview of that dir
    - **path is file**: outline of file symbols
- `query?` to filter symbols/keywords/paths

## keywords
Keywords help the agent get a better sense of what a directory contains, 
without having to read entire files or dumping all symbols in a directory.

See `specs/reference/lsp_keywords_diff.py` for a reference keyword algorithm that uses TF-IDF scoring

## guidance
- **Prefer `lsp_explore` over bash for orientation.** Never use `cd <dir> && ls`, `cat`, `head`, or `grep -r` to get a project or directory overview or to list a file's symbols. Use `lsp_explore` (no path = whole project, dir path = that dir, file path = file symbols).
- Explore broad -> narrow: no path, then dir, then file. Don't read whole files to get oriented.
- Empty query = full outline (no filter), not an empty search.
- **Use `query` to narrow an overview**: it filters dirs/files by name or by their keywords (e.g. `query='db'` surfaces the files/dirs most relevant to DB code). Prefer scoping with query over scanning the full outline.
- **Don't read whole files just to see what they contain.** `lsp_explore <file>` already lists each top-level symbol's kind, signature, and a doc/summary line. Read only after you've narrowed to a specific symbol, and read just the lines/range you need.
- Use `lsp_search` if you know a symbol name, `lsp_at` for a location, `read` only after you've located something specific.
- Scope bash (`grep`/`find`) to a directory you already know; never use it to orient.
- Output is a bounded sample (`... N more` = more exists). Don't assume absence; drill deeper.
- Explore never returns file bodies.

## agent output examples
### no path / path is dir
```markdown
outline of project `isshues`
root markers: `go.mod`, `go.sum`, `.git`
- cli/ (keywords cmd, issue, root)
- model/ (keywords nav, messages)
- model/issues/ (keywords form, list, panels)
- main.go (keywords main, connect, db)
```
- show the root markers only on no path
- every immediate entry (dir **and** file) may carry its own keywords, scored vs same-level siblings
- files with no language server (json, lockfiles, configs) or no distinct tokens show without keywords

### path is file
```markdown
outline of file `isshues/cli/new_issue_cmd.go`
- Function `func NewIssueCmd(app *app.App) error` 2:3  # Creates a new issue from the CLI
- Variable `var count int` 3:5
```
(`line:col`)
- each row is the symbol **kind** (Function, Variable, Class, ...) + its signature + `line:col`
- top-level symbols get a short hover/doc summary after `#` (capped at ~12 symbols, truncated)
- the summary helps the agent decide whether a file needs reading at all

## human output
### no path/path is dir
```markdown
lsp_explore isshues/
 cli/          󱄽 cmd, issue, root
 model/        󱄽 nav, messages
 model/issues/ 󱄽 form, list, panels
 main.go       󱄽 main, connect, db
```
- The directory icon (nf-fa-folder) should be accent color
- The file icon (nf-cod-file) should be warning color 
- The dir/file name should be fg color
- The keywords and keyword icon (nf-md-text_recognition) should be muted
- the `path` arg text should be fg
- If no `path` arg is specified, don't show anything
- output is collapsed to a ~10-entry preview; `N+ more (ctrl+o to expand)` hints at the rest, ctrl+o toggles the full list

### path is file
```markdown
lsp_explore isshues/cli/new_issue_cmd.go
󰊕 NewIssueCmd
󰀫 count
N+ more (<key> to expand)
```
- `<key>` is the expand tool key (ctrl+o by defualt)
- the file name should be fg color
- the lsp icons should be accent color
- the symbol names should be fg color
- the N+ more.... line should be muted color
- see `specs/reference/lsp_icon_kinds.md` for information on the lsp icons
