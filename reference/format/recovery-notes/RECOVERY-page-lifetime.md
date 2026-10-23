# Page construction and label initialization

`004A26D0..004A2992` is restored as a complete constructor with its original
`0x5E0` page and `0x1008` arena allocations. The real recovered allocator is
used with tags `A2` and `02`. A second-allocation failure frees the page; a
first-allocation failure returns null. Ownership is transferred to the caller
only after successful construction.

`PageConstructionState32` normalizes the original live global inputs. Its
preferences pointer supplies exactly `0xFC` bytes from the real preference
state, including unit index at `+F4`; the unit-scale array supplies the selected
nonzero unit. These are not optional defaults. Both original globals reside
in BSS and are initialized elsewhere; an all-zero test preference block must
not be mistaken for recovered application preference initialization.

The source preserves original partial initialization, detached list slots,
arena header `{8,1008,0,3FF}`, owner at `+568`, self pointer at `+548`, rectangle
sentinels, coordinate template and exact double constants. The repeated
24-iteration clear targets the same `+190..+287` bytes each time, as shown by
the original listing. Unwritten bytes retain allocator contents.

`page_defaults.inc` contains verified data rather than executable payload:
the original 336-byte template at `006501B8`, double constants at
`006726D0`/`006726D8`, and original UTF-16 label alphabets. The extractor verifies
them against the hash-bound PE and retained REA resource evidence on every
run. `--write-source` is an explicit generation mode; normal builds only
verify this production data source.

`00462510` selects strings using RCDATA type 10/id 128: its word at byte `2A`
is 4368, selecting RT_STRING IDs 4368..4388. Its output for each of 21 records
at page `+2A0 + i*12` is `{0, length<=1 ? 1 : 0, 1}`. Empty resource slots are
preserved. Production compiles the Chinese resource alphabets into a readonly
table; this is an explicit resource adapter replacing MFC/Win32 resource
discovery and caching, not a claim to restore those framework globals. Actual
label values and initialization semantics are verified against the original
helper loading the original resources through Win32.

The test-only 913-byte oracle comprises constructor and label helper. Tests
load the original PE only as a data/image-resource module with
`LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE`, never execute its
entry point, and call real FindResourceW/LoadResource/LockResource/LoadStringW.
The MFC module-state query is a declared test-host boundary supplying that
resource module. Original allocator calls are connected to the recovered
allocator; its controlled CRT heap boundary lets both allocation failures be
checked, including exact released pointer. Constructor comparison checks all
page/arena bytes, result, allocation sizes/order, free count and x87 status.
The original label helper is exercised with both cold and warm resource cache.

A production integration uses actual heap storage and existing `00404060` to
select and deselect a newly constructed page. That integration releases the
owned page/arena explicitly; it is not yet an original-page-destructor test.

The original destructor `004A29E0` still depends on interaction reset
`004A3DF0` (`00402A30`, `004B1110`, animation/history/queue cleanup), history
cleanup `004CEA90`/`004CEA30`, real object destruction, notifications and
active-view cleanup. Their raw listings are retained under
`analysis/sessions/document-lifetime-core/`. Complete original destructor
semantics and full application preference/font initialization remain separate
requirements; neither is replaced by a success callback here. The explicit
headless resource/default-unit adapter is documented separately in
`RECOVERY-page-preferences.md`; it can now supply the constructor's FC-byte
preference input without a test-prepared memory block.
