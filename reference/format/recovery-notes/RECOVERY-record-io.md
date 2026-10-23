# Original record IO recovery

This module restores three original x86 functions from the Chinese GSP 5 executable. It is a record layer of the native save/load chain, not a replacement document parser or a complete restoration of the application. Production calls the recovered block table, byte-stream IO, and memory-stream implementation directly. There is no record-level success stub or substitute vector/parser.

The immutable input is `analysis/unpacked/GSP5chs.exe`, SHA-256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`. The complete original Listings, not just Ghidra's incomplete prototypes, establish the source interfaces:

| Original function | Complete body | Evidence ID | Original ABI |
| --- | --- | --- | --- |
| `FUN_004B9D50` | `004B9D50..004B9DEB`, 156 bytes | `ev_73ae5bc5a38a838bd6c0e9c977437c4b372b8a3ef255a2c013c63421b7ba7534` | EAX = physical-length output pointer; ECX = handle; stack = raw length, kind |
| `FUN_004B9DF0` | `004B9DF0..004B9EE6`, 247 bytes | `ev_e9d65e3714ee3b786a24e9af93e32dae25184f19e8a100d2cb2beaf29144a620` | EAX = raw length; stack = handle, kind, payload pointer |
| `FUN_004BA0D0` | `004BA0D0..004BA21F`, 336 bytes | `ev_19c9e048a502fefe6f707c0059107fc8f94b749c50db69d811b8658c32dd0cc1` | cdecl(handle, kind output pointer, raw-length output pointer, buffer, capacity) |

`include/gsp/record_io.hpp` normalizes those register ABIs and appends a `ByteStreamEnvironment32` reference. It reuses `streams.hpp` without changing its layout. The stream handle is resolved through the real `DAT_006BB560` slot and the original signed low 16-bit index. Valid allocated handles and valid buffers remain original preconditions.

## Stream fields and wire layout

| Stream offset | Use established by these original Listings |
| --- | --- |
| `+04` | Any nonzero value enables two-byte payload alignment |
| `+18` | Position saved before the record operation; rollback uses absolute seek to this value |
| `+1C` | Maximum record payload field, with different read and write comparison details below |
| `+24` | Existing stream error; nonzero returns immediately before output or IO |

The record is `[raw_length:u32 little endian][kind:u32 little endian][physical payload bytes]`. The kind is preserved as the complete original 32-bit value. These functions do not validate a kind enumeration.

`physical = raw` when `align_04 == 0`; otherwise `physical = (raw + 1) & 0xFFFFFFFE`, with original unsigned 32-bit wrap. The eight-byte record header is not included in either payload length or `max_record_bytes_1c`.

`FUN_004B9D50` writes the raw length as the first four bytes and kind as the next four. It publishes the physical-length output before the first byte IO call (`004B9DA0/004B9DA8`), so that output remains changed on subsequent write failure. An existing stream error returns without changing it. Failure of either four-byte write triggers an absolute rollback attempt whose return is ignored; the original IO error is returned.

`FUN_004B9DF0` saves the starting position, calls the original header writer, then writes exactly raw payload bytes. For nonzero raw length it writes each alignment byte as a separate one-byte zero write; the original stores the zero in the low byte of its already-copied handle stack argument (`004B9E2C`). The recovered source uses an explicit zero byte with the same IO sequence. Raw length zero skips the data/padding branch entirely. Data or padding failure attempts absolute rollback and returns the original IO error. Header failure already attempted its own rollback; dispatch does not add another rollback on that path.

The writer's success update is deliberately **not** `max(old, physical)`: original `004B9ED1` compares **raw** length with the old maximum, and only when raw is larger does `004B9EDA` store **physical** length. Thus a raw length equal to an old odd maximum can leave that maximum odd despite an aligned payload one byte larger. At `raw = 0xFFFFFFFF` with alignment enabled, the physical length wraps to zero; the original raw comparison can even replace a nonzero maximum with zero. The source retains this behavior. The huge-size test cases use the original no-copy type-4 write backend rather than attempting invalid huge memory copies.

## Read commits, warnings and partial effects

`FUN_004BA0D0` saves the original position and reads two four-byte words into its own stack storage. The first read overwrites the original handle stack argument, after the handle was copied to EBP. It computes physical length from the stream's current alignment field after both header reads, rather than caching alignment before IO.

| Condition after successful header reads | Original action and return |
| --- | --- |
| Physical length is zero | Skip payload entirely, regardless of capacity; commit optional outputs and return 0 |
| Capacity equals nonzero physical length | Read that many bytes, including alignment padding; commit outputs only if the read returns 0 |
| Capacity exceeds nonzero physical length | Read physical bytes; successful read becomes warning 3, followed by absolute rollback |
| Capacity is smaller than nonzero physical length | Read exactly capacity bytes; then seek forward by `physical - capacity`, origin 1; successful skip becomes warning 4, followed by absolute rollback |
| Header/payload/skip operation fails | Attempt absolute rollback and preserve that operation's original error |

Warnings 3/4 do not commit either optional output and do not update `max_record_bytes_1c`. Already copied destination bytes are retained. On success, raw-length output is written **before** kind output (`004BA1C8..004BA1DA`), including when the output pointers alias; null outputs are independently allowed. Only then is the stream looked up again and its maximum increased if physical length is greater.

A rollback is a real `FUN_004BA9B0` call, not a memory transaction. The byte-stream module's existing sticky error and seek rules still apply. For example, an error other than EOF 25 can prevent a later rollback from moving the position; absolute seek can clear EOF 25, but an origin-1 skip cannot. The returned record error/warning is retained even if rollback itself fails. File bytes, partial destination writes, logical end, errno, and error/position side effects are not reverted by this module.

## Actual compiled verification

Run `tests/record_io_build_probe.ps1` from PowerShell. It reuses the existing ASCII source junction created by the root native build and compiles actual MSVC x86 C++17 source with `/O2 /W4 /WX /fp:strict`. It links the real `blocktable.cpp`, `memory_stream.cpp`, and `byte_stream_io.cpp`; both oracle and recovered record functions use those same real dependencies.

`tests/record_io_extract_fixture.py` verifies the complete input PE hash and retained Evidence body ranges, then extracts only the three functions above into the 739-byte fixture. The fixture SHA-256 is `0a723e5ee9d7d41a23a2a8ac9227067c07e3898e0296f2531f01437fd262903a`. The test checks that hash before mapping code, fills all gaps with INT3, relocates five exact global operands, and verifies/redirects 17 external relative calls to declared ABI adapters for the real recovered dependencies. The original dispatch-to-header call is left intact. Writable code becomes RX before execution. It never loads the original PE, starts its entry point, invokes its UI, or resolves its imports.

The observed result in `tests/record_io_validation.json` is **186,669 scenarios, zero mismatches**: 28,360 header writes, 28,445 record writes, 129,864 record reads, 48,689 warning-3 results, 48,157 warning-4 results, and 19,724 error returns. The comparisons include EAX plus every byte of the actual table/stream structures, file fixture, source/destination buffers, optional outputs and all 304,820 stdio callback trace entries.

Coverage includes raw lengths 0..80, unsigned length wrap boundaries, alignment 0/1/2/FFFFFFFF, nonzero upper handle bits, real stream types 1/2/3, type-4 no-copy writes, maximum field thresholds, null/aliased output pointers, zero padding, every header/data/padding IO fault position, partial writes/reads, all recovered errno mappings, EOF, failing rollback/skip, mutation of alignment during header reads, fixed-buffer EOF, and 12,000 fixed-seed random cases. Original and recovered runs use the same addresses restored from byte snapshots. The host stdio callback contract is explicit and supplies controlled short operations; this is the existing opaque CRT boundary, not a substitute byte-stream implementation.

## Remaining boundaries

The original type-4 read backend returns success without filling its destination. Consequently this record reader would interpret uninitialized stack header words. The recovered source does not invent a zero/default record for that path; meaningful successful record reads require a backend that supplies all four bytes of each header word. That undefined-payload path is excluded from deterministic differential claims. Invalid handles, invalid pointers, arbitrary overlapping memcpy ranges, and invalid huge payload buffers likewise remain original preconditions, not new errors or repaired semantics.

These three record functions have no allocator call of their own. Table/memory-backend allocation and opaque CRT behavior retain the recovered dependency contracts. Full application file opening/closing, document dispatch, object creation/lifetime and UI are outside this module. Current integrated-build evidence is recorded in `provenance-record-io.json` under `latest_integrated_build`; build verification is described in the [current implementation guide](../README.md). Real-GSP document acceptance and task order are maintained only in the [project plan](../PLAN.md).
