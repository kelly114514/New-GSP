# Common object allocation, default style and parent-edge removal

Production source restores three complete original entries. It does not yet
provide complete page/document/object construction and destruction.

* `00440E50..00440F57` allocates the primary kind's exact size from row +4 of
  `0064E7E8` via recovered `0043CB30` with tag 2. It initializes only the fields
  explicitly written by the original; remaining allocation bytes retain their
  allocator contents. It copies selected prototype fields, clears `30..5F`,
  sets object kind, detached-list sentinels, and common counters/handles. It
  neither invokes the kind-specific constructor nor inserts the object into a
  page. All 20 original kind indices remain valid preconditions.
* `00440F60..00440FF7` increments current page `+28C` even with no parents. For
  each object pointer in parent vector `+AC`, it scans that parent's child
  vector `+B0`, replaces the first matching element with the final element when
  necessary, and decrements the 16-bit count. It preserves unused vector bytes,
  vector allocation, and any later duplicate matching child. Missing matches
  do not decrement the count. It does not delete either object or vector.
* `00441BE0..00441CCC` copies 22 bytes of default style into object `+60`.
  The immutable primary row `+60` selects a style at page `+28 + category*22`
  or live preferences `+1C + category*22`. For categories 1/2, the only
  admitted primary rows are 0/7/11; each dispatches row +74 to `004C0020`,
  whose complete body returns palette slot9. Its exact body is inlined,
  not replaced by a success callback or separately counted function. RGB
  bytes from page `+AC+9*4` become one-based words at object `+6E/+70/+72`,
  then the updated style is backed up at `+104`. Other categories preserve
  copy-only behavior. The three color-reading rows require a current page,
  as in the original; no-page preference copies are valid for the other rows.

The original `+18` field copy uses `FLD m32`/`FSTP m32`. Explicit x87 load/store
is retained because an SSE bit copy under MSVC `/fp:strict` omitted denormal
status and signaling-NaN quieting. The source and oracle compare masked x87
status alongside complete memory. Unmasked floating exceptions retain the
host's original x87 trap behavior and are not a successful-return claim.

`object-lifetime-original.bin` contains only the 264-byte allocation and
152-byte unlink entries, hash-bound to the unmodified unpacked PE. The oracle
relocates the kind-table operand and calls the same recovered allocator, whose
CRT boundary is controlled explicitly. Other allocation behavior is verified
by the allocator module. Production has no PE loader or machine-code oracle.

Verification checks every kind's full allocation span including untouched
bytes; null allocation; finite, signed-zero, subnormal, infinite, quiet-NaN and
signaling-NaN `+18` values; empty parents, shared parents, first/middle/final and
missing child edges. A separate production integration uses actual heap
allocation, recovered arena creation/append/removal/free and these functions.
The parent vector in that integration now passes through the real recovered
`00441920` binding operation before unlinking. A separate style oracle fixture
contains the full 237-byte entry, its six-byte constant callee and independent
original kind-table bytes (2,883 bytes total). Seventy-four cases compare full
object memory for all20 kinds with page styles and the admitted no-page paths.
The extractor checks every category1/2 dispatch before allowing the source's
constant-body specialization. Actual-DPI/default-resource page integration
also invokes this style initializer on a real common object allocation.

Evidence for the surrounding lifecycle is retained in
`analysis/sessions/document-lifetime-core/`. The complete native listing
establishes these additional boundaries and dependencies:

* Page creator `004A26D0..004A2992` allocates a `0x5E0` page and a `0x1008` arena.
  Arena failure releases the first allocation. It copies `0xFC` bytes of live
  preferences from `006BF6E0`, `0x150` bytes of defaults from `006501B8`, reads
  unit scale state, initializes 21 label-number records through `00462510`,
  and writes the original sentinel/flag fields. Label initialization depends
  on resource string lengths. This constructor and compiled Chinese label
  resource adaptation are implemented separately in `RECOVERY-page-lifetime.md`.
* Page destroyer starts at `004A29E0`. It selects the page context, calls
  `004A3DF0` and `004CEA90`, traverses the object chain rooted at `+114` through
  object `+80`, and calls `00441000(object,0,1)`. It handles the `+5C8`
  notification list, releases arena and auxiliary allocations, clears context,
  restores the previous context when needed, then frees the page. Ghidra's
  `_free` no-return annotation truncates pseudocode; use the retained listing.
* Object destructor `00441000..00441132` also requires observer unlink
  `004A22E0`, optional text cleanup `0046CC00`, page unlink `004427E0`, selection
  cleanup `00499790`, notification dispatch/clear `004626E0`/`00462730`, kind
  row +28 destructor, and vector release `004D5790`. A subset destructor that
  skips reachable dependencies is not supplied. The guarded headless point/
  segment specialization is documented in `RECOVERY-object-page-links.md`;
  it rejects states requiring the still-unrecovered paths before mutation.

REA pseudocode confirms source identities and common operations, but misses
register inputs and the x87 nature of `+18`; listing/bytes govern those details.
