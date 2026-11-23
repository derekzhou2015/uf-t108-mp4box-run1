import { FullBox } from '#/box';
import type { MultiBufferStream } from '#/buffer';
import { validateEntryCount } from '#/entry-count';

class PaddingBit {
  constructor(
    public pad1: number,
    public pad2: number,
  ) {}
}

export class padbBox extends FullBox {
  static override readonly fourcc = 'padb' as const;
  box_name = 'PaddingBitsBox' as const;

  padbits: Array<PaddingBit>;

  parse(stream: MultiBufferStream) {
    this.parseFullHeader(stream);
    const sample_count = stream.readUint32();
    // two samples' padding flags share one byte; an odd count still uses a byte
    const byteCount = Math.floor((sample_count + 1) / 2);
    const invalid = validateEntryCount(this, stream, byteCount, 1, 4);
    if (invalid) return invalid;
    this.padbits = [];
    for (let i = 0; i < byteCount; i++) {
      const bits = stream.readUint8();
      const pad1 = (bits & 0x70) >> 4; // 5,6,7 bits
      const pad2 = bits & 0x07; // 0,1,2 bits
      this.padbits.push(new PaddingBit(pad1, pad2));
    }
  }
}
