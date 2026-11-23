import { FullBox } from '#/box';
import type { MultiBufferStream } from '#/buffer';
import { validateEntryCount } from '#/entry-count';

export class saizBox extends FullBox {
  static override readonly fourcc = 'saiz' as const;
  box_name = 'SampleAuxiliaryInformationSizesBox' as const;

  aux_info_type: string;
  aux_info_type_parameter: number;
  default_sample_info_size: number;
  sample_count: number;
  sample_info_size: Array<number>;

  parse(stream: MultiBufferStream) {
    this.parseFullHeader(stream);
    let fixedBytesRead = 0;
    if (this.flags & 0x1) {
      this.aux_info_type = stream.readString(4);
      this.aux_info_type_parameter = stream.readUint32();
      fixedBytesRead += 8;
    }
    this.default_sample_info_size = stream.readUint8();
    this.sample_count = stream.readUint32();
    fixedBytesRead += 5;
    this.sample_info_size = [];
    // only a zero default size stores one explicit size byte per sample
    if (this.default_sample_info_size === 0) {
      const invalid = validateEntryCount(this, stream, this.sample_count, 1, fixedBytesRead);
      if (invalid) return invalid;
      for (let i = 0; i < this.sample_count; i++) {
        this.sample_info_size[i] = stream.readUint8();
      }
    }
  }
}
