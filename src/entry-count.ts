import { ErrorCode } from '#/constants';
import { Log } from '#/log';
import type { Box } from '#/box';
import type { MultiBufferStream } from '#/buffer';

/**
 * Absolute ceiling for a declared sample/entry count that materializes a JS
 * array without any backing per-entry bytes (e.g. constant-size stsz). Such a
 * box cannot be reconciled against carried bytes, so it only gets this sanity
 * bound. 2^24 (~16.7M) is far above any real track's sample count while keeping
 * the worst-case single array well below a typical container's memory budget,
 * so a forged 32-bit count is rejected instead of exhausting the heap.
 */
export const MAX_DECLARED_ENTRY_COUNT = 2 ** 24;

/**
 * Reconciliation for sample-table boxes whose batch reads are driven by a
 * count field declared inside the box.
 *
 * A malformed file can declare an entry_count far larger than the data the box
 * actually carries. The read loops below allocate one array slot per declared
 * entry before touching the corresponding bytes, so a forged count grows the
 * heap without bound while never raising on the library's error channel.
 *
 * This guard compares the declared count against the number of bytes the box
 * really has left after its fixed fields have been consumed. The check runs
 * before any per-entry allocation, so a mismatch fails fast through the same
 * ERR_INVALID_DATA contract used elsewhere (e.g. tkhd) instead of exhausting
 * memory.
 *
 * @param box            the box being parsed (provides declared box boundaries)
 * @param stream         the parse stream, positioned right after the count field
 * @param entryCount     the entry count / sample count declared in the box
 * @param bytesPerEntry  number of bytes one table entry occupies
 * @param fixedBytesRead bytes already consumed from the box payload (after the
 *                       full box header), i.e. the count field and any siblings
 * @returns ErrorCode.ERR_INVALID_DATA when the declaration does not match the
 *          box's actual data volume, undefined otherwise
 */
export function validateEntryCount(
  box: Box,
  stream: MultiBufferStream,
  entryCount: number,
  bytesPerEntry: number,
  fixedBytesRead: number,
): ErrorCode | undefined {
  // Everything between the end of the (full) box header and the end of the box.
  const availableBytes = box.size - box.hdr_size - fixedBytesRead;
  const requiredBytes = entryCount * bytesPerEntry;
  if (availableBytes !== requiredBytes) {
    Log.error(
      'BoxParser',
      `Box of type '${box.type}' declares ${entryCount} entries requiring ${requiredBytes} bytes ` +
        `but only carries ${availableBytes} bytes of entry data`,
      stream.isofile,
    );
    return ErrorCode.ERR_INVALID_DATA;
  }
  return undefined;
}

/**
 * Sanity bound for a declared count that materializes an array without any
 * per-entry bytes in the box (constant-size stsz). There is nothing in the box
 * payload to reconcile against, so an absolute ceiling is the only available
 * guard. Reads beyond any plausible real track are rejected as invalid data
 * instead of letting a forged 32-bit count exhaust the heap.
 *
 * @param box        the box being parsed
 * @param stream     parse stream (used only to route through onError)
 * @param entryCount the declared sample/entry count
 * @returns ErrorCode.ERR_INVALID_DATA when the count exceeds the ceiling,
 *          undefined otherwise
 */
export function validateDeclaredCount(
  box: Box,
  stream: MultiBufferStream,
  entryCount: number,
): ErrorCode | undefined {
  if (entryCount > MAX_DECLARED_ENTRY_COUNT) {
    Log.error(
      'BoxParser',
      `Box of type '${box.type}' declares ${entryCount} entries, exceeding the maximum ` +
        `${MAX_DECLARED_ENTRY_COUNT}`,
      stream.isofile,
    );
    return ErrorCode.ERR_INVALID_DATA;
  }
  return undefined;
}

/**
 * Boundary guard for boxes whose entries are variable length (e.g. subs, where
 * each outer entry carries its own subsample count). A byte-accurate entry
 * count cannot be derived up front, so instead every read is checked against
 * the box's own end. A forged count that would read past the carried data is
 * rejected before the loop can grow arrays without bound.
 *
 * @param box    the box being parsed
 * @param stream parse stream, positioned immediately before the next read
 * @param bytes  number of bytes the next read needs
 * @returns ErrorCode.ERR_INVALID_DATA when the read would leave the box,
 *          undefined otherwise
 */
export function validateBoxSpace(
  box: Box,
  stream: MultiBufferStream,
  bytes: number,
): ErrorCode | undefined {
  if (stream.getPosition() + bytes > box.start + box.size) {
    Log.error(
      'BoxParser',
      `Box of type '${box.type}' entry data extends past the end of the box`,
      stream.isofile,
    );
    return ErrorCode.ERR_INVALID_DATA;
  }
  return undefined;
}
