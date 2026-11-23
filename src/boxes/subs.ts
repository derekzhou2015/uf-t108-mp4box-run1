import { FullBox } from '#/box';
import type { MultiBufferStream } from '#/buffer';
import { validateBoxSpace } from '#/entry-count';
import type { SubSample } from '@types';

interface SampleInfo {
  size: number;
  sample_delta: number;
  subsamples: Array<SubSample>;
}

export class subsBox extends FullBox {
  static override readonly fourcc = 'subs' as const;
  box_name = 'SubSampleInformationBox' as const;

  entries: Array<SampleInfo>;

  parse(stream: MultiBufferStream) {
    this.parseFullHeader(stream);
    const entry_count = stream.readUint32();
    this.entries = [];
    const subsampleEntrySize = this.version === 1 ? 10 : 8;
    for (let i = 0; i < entry_count; i++) {
      // every outer entry has at least its sample_delta (4) + subsample_count (2)
      let invalid = validateBoxSpace(this, stream, 6);
      if (invalid) return invalid;
      const sampleInfo = {} as SampleInfo;
      this.entries[i] = sampleInfo;
      sampleInfo.sample_delta = stream.readUint32();
      sampleInfo.subsamples = [];
      const subsample_count = stream.readUint16();
      for (let j = 0; j < subsample_count; j++) {
        invalid = validateBoxSpace(this, stream, subsampleEntrySize);
        if (invalid) return invalid;
        const subsample = {} as SubSample;
        sampleInfo.subsamples.push(subsample);
        if (this.version === 1) {
          subsample.size = stream.readUint32();
        } else {
          subsample.size = stream.readUint16();
        }
        subsample.priority = stream.readUint8();
        subsample.discardable = stream.readUint8();
        subsample.codec_specific_parameters = stream.readUint32();
      }
    }
  }
}
