# Stream registry, files and ownership

`stream_lifetime.cpp` restores `004B8C80`, `004B8CC0`, `004B8D60`,
`004B8DB0`, `004B90C0`, `004B8FD0` and `004B9260`. The source follows the
complete hash-bound original Listing, with retained REA observations for
file opening and closing under `analysis/sessions/save-worklist/`.

Registry creation uses `(0x34,8,24,1)` block-table arguments and resets the
handle cursor to one even if allocation fails. Handle release clears all
`0x34` bytes and compares the cursor as a signed 16-bit value. File writes
open Unicode mode `wb`; reads use `rb`, probe size with seek/ftell and always
rewind. The size-probe return and rewind's sticky error remain distinct.
Invalid-argument open error 30 maps to 32. The original leaks an opened FILE
when handle reservation fails; the recovered routine retains that behavior
and the controlled test records it, without causing a real leak in the
host-file integration.

File close releases auxiliary state, snapshots error/end/max-record fields,
normalizes EOF 25 only for its return, and closes/reset handles only for
type one. A type mismatch sets sticky error 34 while returning the previous
error. Memory destruction frees owned type-two payload/chunks, preserves
borrowed type-three payload, releases auxiliary storage for both, and clears
the handle. Registry teardown alone does not close active streams.

`host_runtime.cpp` is explicitly new MSVC adaptation: real malloc/realloc/free
feed the recovered allocation pressure policy, and actual host stdio supplies
the opaque FILE boundary. It does not claim original static CRT binary-layout
equivalence. Production neither loads the PE nor calls machine-code fixtures.

The differential oracle compares new routines, full registry/allocation bytes,
cursor, error state and call traces across failure, EOF and ownership cases.
It uses original block-table routines and controlled CRT boundaries; the
already recovered errno mapper/rewind callee are shared dependencies. A separate
integration test uses actual heap and disk files through production callbacks
for record write/read/padding/EOF/close and memory-stream growth/destruction.
This verifies real I/O plumbing, not GSP object/document semantics.
