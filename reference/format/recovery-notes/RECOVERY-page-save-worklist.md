# Save worklist and font/style tables

`004375F0`, `00437670`, `00437700`, `00437730`, `00437760` and `00437790`
are recovered from the original PE Listing and retained REA observations in
`analysis/sessions/save-worklist/`. Original executable spans remain test
oracles only. Font lookup/interning and style deduplication use the real
recovered block-table operations.

The save preprocessor creates font and style tables with arguments
`(2,5,10,0)` and `(24,10,20,0)` in the source API. Pseudocode omitted the
register argument; its apparent tag values were not reliable. Worklist row
zero is unused; each subsequent row is 20 bytes, with object pointer at
`+0` and the resulting style index word at `+12`. Styles compare eleven
words, are copied in the original order, and carry mapped font at `+22`.
Font lookup uses the signed low word of the high-water mark. Failure cleanup
preserves the original cached-table and global-slot read points.

Kinds whose row `+60` is below six use the inline style at object `+60`
unless row `+70` supplies an indirect descriptor. Free points, segments and
midpoints use the inline path without an unrecovered callback. Text-like
kinds still require their real style accessor and font visitor; the API
exposes them without a default-success implementation. Differential tests
with supplied visitors establish only this dispatch contract, not text
support. Empty input preserves original table-creation-failure behavior;
unchecked nonempty null-table dereferences remain original preconditions.

This removes the preprocessing callback gap for the selected minimal kinds.
The complete page serializer and document writer remain distinct work.
