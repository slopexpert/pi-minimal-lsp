# pi-minimal-lsp

## goals
- provide robust, token efficient tools to interact with codebases without reading entire files
- format written/edited files at `agent_end`

## non-goals
- no security scans (other than what the language servers do)
- no auto LSP install
- multi-project-root

## tools
- `lsp_explore(path?, query?)`: flexible tool to **explore projects** and get **file outlines**
    - **no path**: overview of entire project
    - **path is dir**: overview of that dir
    - **path is file**: outline of file symbols
    - use `query` to filter
- `lsp_search(query, path?)`: search for workspace or document symbols
    - **no path**: workspace symbols search
    - **path is dir**: workspace symbols search, filtered by directory 
    - **path is file**: document symbol search
- `lsp_at(line, col, file, kinds?: Kind[], depth?, maxResults?)`: get **information about symbol** at a _precise location_
    - `Kind = definition | hover | declaration | typedef | implementation | references | callers | callees`
    - depth applies only to `callers` and `callees`
- `lsp_diagnostics`: checks entire project for errors and warnings 

## write/edit diagnostics hook
after every `write`/`edit` tool call, check for diagnostics and inject any errors to the agent in the tool output.
Also show these errors to the user so that they can see what the agent has done.

## compliance
All of the regular LSP events should be fired when the agent calls tools, just as if it was a real LSP enabled text editor.

## formatting
TODO: WILL BE HANDLED IN A FUTURE SPEC

## lazy server start
Whenever the agent tries to access a file in a language that is registered for LSP, and the current project has a root marker 
(or the lsp works for single file), then launch the LS for that language.

Also launch all required LSs when the agent tries to use `lsp_*` tools

## external directories
When the agent tries to access a file outside of the cwd, do not start any LSP, and do not allow language features inside external folders.

## config 
We provide a predefined set of configs (similar to neovim's `lspconfig`)

Each language server has an additional icon in its definition.

Users can also register their own LSs via the config and place custom settings 
(which get merged with the default configs, in case they exist for that language server).

The config should be in `~/.pi/minimal-lsp.json`

## language server installation path
Take language server executables from `$PATH`, and let users also specify additional locations inside the config.
That way for example, the `nvim-mason` LSP servers can be used. (But don't hardcode it!)
