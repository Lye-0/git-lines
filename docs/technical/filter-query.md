# Graph filtering

The text input is the source of truth for both free text and the filter popover.
Filtering dims loaded rows without changing graph lanes, coordinates, refs, or the commit DAG.
It does not request additional history.

- `branch:main`: exact displayed route or current/historical branch ref.
- `type:commit`, `type:working`, `type:operation`: row category.
- `worktree:linked`, `worktree:clean`, `worktree:detached`: worktree state.
- Names containing spaces or quotes use JSON string quoting, e.g. `branch:"feature example"`.

Multiple values in one category use OR; categories and free text use AND.
Free text keeps the existing case-insensitive substring search over row metadata,
including commit OIDs, subjects, ref names, worktree paths, and operation captions.
Unknown or incomplete clauses remain literal search text. Branch names are case-sensitive.
Tags stay searchable as text but are not branch choices.

The menu writes clauses into the input without removing unrelated text. Editing clauses
updates menu selection. Counts describe loaded rows in each option, independently of the
other selected conditions. Selected branches absent from loaded rows remain removable.
`All` clears one category; `Clear all` and the input's × clear everything.

Filters survive Refresh and Load more, reset on repository change, and are not persisted.
The popover closes on outside pointer/scroll/wheel, Escape, window blur, resize, or
repository change. Internal scrolling and selections leave it open. Escape restores
focus to its trigger. Popup positioning uses the viewport so narrow sidebar and bottom
panel layouts can scroll the menu instead of clipping it within the toolbar.

Each category scrolls independently with a thin scrollbar after five 27px options.
The All control stays outside its scroll area. Branch / Route has a separate candidate
search that never changes graph filtering or removes hidden selections. Clear all also
resets this candidate search. The menu retains viewport-bounded outer scrolling as a
fallback when the entire set of controls cannot fit on a short screen.
