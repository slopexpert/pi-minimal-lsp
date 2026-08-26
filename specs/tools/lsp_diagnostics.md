# tool spec: lsp_diagnostics

scan the entire project for diagnostics

## guidance
- prefer using this instead of compiling the project to check for errors

## agent output exaple
There are errors/warnigns
```markdown
Error: asdasdasdasd (file.go:2:1)
Warning: qweioqwiouqweui (file.go:10:1)
```

There are no errors/warnigns
```markdown
Everything good
```

## user output exaple
```
lsp_diagnostics
 asdasdasdasd (file.go:2:1)
 qweioqwiouqweui (file.go:10:1)
```
- `nf-cod-error` for the error, use "error" color
- `nf-fa-warning` for the warning, use "warning" color
- output is collapsed to a ~10-item preview; `N+ more (ctrl+o to expand)` hints at the rest, ctrl+o toggles the full list

No err/warn
```
lsp_diagnostics 
```
- `nf-fa-check` for the checkmark, use "accent" color
