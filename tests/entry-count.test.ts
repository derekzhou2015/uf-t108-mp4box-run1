import { createFile, MP4BoxBuffer } from '../entries/all';
import { parseOneBox } from '../src/parser';
import { MultiBufferStream } from '../src/buffer';
import { ErrorCode } from '../src/constants';

const ascii = (value: string) => new Uint8Array(Array.from(value, char => char.charCodeAt(0)));
const u32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0);
  return bytes;
};
const u16 = (value: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value >>> 0);
  return bytes;
};
const u8 = (value: number) => new Uint8Array([value & 0xff]);
const concat = (...parts: Array<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const box = (type: string, payload: Uint8Array) =>
  concat(u32(8 + payload.length), ascii(type), payload);
const fullBox = (type: string, versionFlags: number, payload: Uint8Array) =>
  box(type, concat(u32(versionFlags), payload));

// Wrap a sample-table box in the minimum hierarchy that reaches an stbl box.
const wrapInStbl = (sampleTableBox: Uint8Array) =>
  box('moov', box('trak', box('mdia', box('minf', box('stbl', sampleTableBox)))));
// trun lives in a movie fragment rather than the movie sample table.
const wrapInTraf = (trun: Uint8Array) => box('moof', box('traf', trun));

const FORGED_COUNT = 0x7fffffff;

// Each malformed case is a physically small, fully buffered box whose outer
// size is correct but whose inner count field is forged far beyond the data
// the box actually carries. Pre-fix these loops grew JS arrays without bound
// and never reported anything on the library's error channel.
const malformed: Record<string, Uint8Array> = {
  stts: fullBox('stts', 0, concat(u32(FORGED_COUNT), u32(1), u32(1000))),
  ctts: fullBox('ctts', 0, concat(u32(FORGED_COUNT), u32(1), u32(0))),
  stsc: fullBox('stsc', 0, concat(u32(FORGED_COUNT), u32(1), u32(1), u32(1))),
  stss: fullBox('stss', 0, concat(u32(FORGED_COUNT), u32(1))),
  stsh: fullBox('stsh', 0, concat(u32(FORGED_COUNT), u32(1), u32(1))),
  stco: fullBox('stco', 0, concat(u32(FORGED_COUNT), u32(0))),
  co64: fullBox('co64', 0, concat(u32(FORGED_COUNT), u32(0), u32(0))),
  // stsz variable-size form (sample_size 0): one 4-byte size per sample
  stsz: fullBox('stsz', 0, concat(u32(0), u32(FORGED_COUNT), u32(42))),
  // stz2 field_size 8: one byte per sample
  stz2: fullBox('stz2', 0, concat(new Uint8Array([0, 0, 0, 8]), u32(FORGED_COUNT), u8(7))),
  padb: fullBox('padb', 0, concat(u32(FORGED_COUNT), u8(0))),
  // saiz with default size 0: one explicit size byte per sample
  saiz: fullBox('saiz', 0, concat(u8(0), u32(FORGED_COUNT), u8(1))),
  sbgp: fullBox('sbgp', 0, concat(ascii('roll'), u32(FORGED_COUNT), u32(1), u32(0))),
  // trun with the sample-duration flag set: one 4-byte field per sample
  trun: fullBox('trun', 0x00000100, concat(u32(FORGED_COUNT), u32(1))),
  subs: fullBox('subs', 0, concat(u32(FORGED_COUNT), u32(1), u16(0))),
};

// Well-formed boxes whose declarations match the data they carry. These must
// keep parsing unchanged so the guard cannot regress ordinary valid files.
const valid: Record<string, { bytes: Uint8Array; entries: number; arrayKey: string }> = {
  stts: {
    bytes: fullBox('stts', 0, concat(u32(2), u32(1), u32(1000), u32(1), u32(2000))),
    entries: 2,
    arrayKey: 'sample_counts',
  },
  ctts: {
    bytes: fullBox('ctts', 1, concat(u32(1), u32(1), u32(-2 >>> 0))),
    entries: 1,
    arrayKey: 'sample_counts',
  },
  stsc: {
    bytes: fullBox('stsc', 0, concat(u32(1), u32(1), u32(2), u32(1))),
    entries: 1,
    arrayKey: 'first_chunk',
  },
  stss: {
    bytes: fullBox('stss', 0, concat(u32(2), u32(1), u32(3))),
    entries: 2,
    arrayKey: 'sample_numbers',
  },
  stsh: {
    bytes: fullBox('stsh', 0, concat(u32(1), u32(2), u32(1))),
    entries: 1,
    arrayKey: 'shadowed_sample_numbers',
  },
  stco: {
    bytes: fullBox('stco', 0, concat(u32(2), u32(100), u32(200))),
    entries: 2,
    arrayKey: 'chunk_offsets',
  },
  co64: {
    bytes: fullBox('co64', 0, concat(u32(1), u32(0), u32(128))),
    entries: 1,
    arrayKey: 'chunk_offsets',
  },
  stsz: {
    bytes: fullBox('stsz', 0, concat(u32(0), u32(2), u32(42), u32(57))),
    entries: 2,
    arrayKey: 'sample_sizes',
  },
  stz2: {
    bytes: fullBox('stz2', 0, concat(new Uint8Array([0, 0, 0, 8]), u32(2), u8(7), u8(9))),
    entries: 2,
    arrayKey: 'sample_sizes',
  },
  padb: { bytes: fullBox('padb', 0, concat(u32(2), u8(0x12))), entries: 1, arrayKey: 'padbits' },
  saiz: {
    bytes: fullBox('saiz', 0, concat(u8(0), u32(2), u8(3), u8(4))),
    entries: 2,
    arrayKey: 'sample_info_size',
  },
  sbgp: {
    bytes: fullBox('sbgp', 0, concat(ascii('roll'), u32(1), u32(1), u32(0))),
    entries: 1,
    arrayKey: 'entries',
  },
  trun: {
    bytes: fullBox('trun', 0x00000100, concat(u32(2), u32(10), u32(20))),
    entries: 2,
    arrayKey: 'sample_duration',
  },
  // subs: one outer entry carrying two version-0 (8-byte) subsamples
  subs: {
    bytes: fullBox(
      'subs',
      0,
      concat(u32(1), u32(1), u16(2), u16(10), u8(1), u8(0), u32(0), u16(20), u8(2), u8(0), u32(0)),
    ),
    entries: 1,
    arrayKey: 'entries',
  },
};

// Drives the full ISOFile pipeline, which is the route a real transcoding
// service uses and the place where onError must surface the failure.
function parseThroughPipeline(...boxes: Array<Uint8Array>) {
  const bytes = concat(...boxes);
  const mp4 = createFile(false);
  const onError = vi.fn();
  mp4.onError = onError;
  const heapBefore = process.memoryUsage().heapUsed;
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.buffer, 0));
  mp4.flush();
  const heapGrowthMB = (process.memoryUsage().heapUsed - heapBefore) / 1048576;
  return { mp4, onError, heapGrowthMB };
}

function findBox(mp4: ReturnType<typeof createFile>, type: string) {
  const walk = (boxes?: Array<{ type: string; boxes?: Array<unknown> }>): unknown => {
    for (const candidate of boxes ?? []) {
      if (candidate.type === type) return candidate;
      const nested = walk(
        (candidate as { boxes?: Array<{ type: string; boxes?: Array<unknown> }> }).boxes,
      );
      if (nested) return nested;
    }
  };
  return walk(mp4.boxes as Array<{ type: string; boxes?: Array<{ type: string }> }>);
}

// Box-level parse, isolated from movie post-processing.
function parseSingleBox(bytes: Uint8Array) {
  const stream = new MultiBufferStream(MP4BoxBuffer.fromArrayBuffer(bytes.slice().buffer, 0));
  return parseOneBox(stream, false);
}

describe('Sample-table entry count reconciliation', () => {
  it('rejects a forged stts entry count through the invalid-data channel', () => {
    const { mp4, onError, heapGrowthMB } = parseThroughPipeline(
      box('ftyp', concat(ascii('mp42'), u32(0), ascii('mp42'))),
      wrapInStbl(malformed.stts),
    );

    // The whole moov is discarded as invalid data; only ftyp survives.
    expect(mp4.boxes.map(b => b.type)).toEqual(['ftyp']);
    expect(onError).toHaveBeenCalled();
    const message = onError.mock.calls.map(call => String(call[1])).join(' ');
    expect(message).toContain('stts');
    // A forged 2-billion-entry table must not allocate before failing.
    expect(heapGrowthMB).toBeLessThan(5);
  });

  it.each(Object.keys(malformed))(
    'fails fast when the %s declaration does not match its carried data',
    type => {
      const container = type === 'trun' ? wrapInTraf(malformed[type]) : wrapInStbl(malformed[type]);
      const { mp4, onError, heapGrowthMB } = parseThroughPipeline(
        box('ftyp', concat(ascii('mp42'), u32(0), ascii('mp42'))),
        container,
      );

      expect(onError).toHaveBeenCalled();
      const message = onError.mock.calls.map(call => String(call[1])).join(' ');
      expect(message).toContain(type);
      // The offending box (and its container) is rejected, never retained.
      expect(findBox(mp4, type)).toBeUndefined();
      expect(heapGrowthMB).toBeLessThan(5);
    },
  );

  it.each(Object.keys(valid))(
    'keeps parsing a well-formed %s box whose count matches its data',
    type => {
      const spec = valid[type];
      const result = parseSingleBox(spec.bytes);

      expect(result.code).toBe(ErrorCode.OK);
      const parsed = result.box as unknown as Record<string, Array<unknown>>;
      expect(parsed.type).toBe(type);
      expect(parsed[spec.arrayKey]).toHaveLength(spec.entries);
    },
  );

  it('fails fast on a forged constant-size stsz count (no per-entry table)', () => {
    const constantStsz = fullBox('stsz', 0, concat(u32(1024), u32(FORGED_COUNT)));
    const { mp4, onError, heapGrowthMB } = parseThroughPipeline(
      box('ftyp', concat(ascii('mp42'), u32(0), ascii('mp42'))),
      wrapInStbl(constantStsz),
    );

    expect(onError).toHaveBeenCalled();
    const message = onError.mock.calls.map(call => String(call[1])).join(' ');
    expect(message).toContain('stsz');
    expect(message).toContain('exceeding the maximum');
    expect(findBox(mp4, 'stsz')).toBeUndefined();
    expect(heapGrowthMB).toBeLessThan(5);
  });

  it('keeps parsing a well-formed constant-size stsz box', () => {
    const result = parseSingleBox(fullBox('stsz', 0, concat(u32(1024), u32(3))));

    expect(result.code).toBe(ErrorCode.OK);
    const parsed = result.box as unknown as {
      type: string;
      sample_size: number;
      sample_sizes: Array<number>;
    };
    expect(parsed.type).toBe('stsz');
    expect(parsed.sample_size).toBe(1024);
    expect(parsed.sample_sizes).toEqual([1024, 1024, 1024]);
  });
});
