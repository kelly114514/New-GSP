# Native page header transfer

The complete byte ranges `004A4060..004A42CB` and `004A42D0..004A4358`
convert the native `0x110` page prefix and its 36-byte serialized header,
then join that converter to the recovered typed-transfer implementation.
The first address is a `LAB` in the retained Ghidra database, so the rejected
`analyze_function` request is not evidence of decompilation. The extractor
instead binds the complete LLVM Listing and both spans to the original PE
SHA-256. No code fragment is linked into production.

The converter snapshots all 36 input bytes before a read-side native write.
It preserves original alias order and untouched fields. `meta_14==1` uses
related state at `006BA210`; reads may initialize its words at `+5C/+5E`,
and writes require a valid pointer. The source API exposes this dependency.
The layout normalizations use different word and signed-dword comparisons.
The native `+E8` value serializes its low word only when nonpositive.
Short serialized buffers return 39; long reads warn with 4, and specified
write-side normalizations warn with 5. The wrapper has its own length guard.

New differential tests cover these branches, input/output overlap, related
state mutations and the real typed-transfer chain. The test-only cookie
check is an explicit compiler-runtime boundary. This module does not create
a document, read its object records or establish application compatibility.
