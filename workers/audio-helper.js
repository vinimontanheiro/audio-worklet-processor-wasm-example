const BYTES_PER_UNIT = Uint16Array.BYTES_PER_ELEMENT;
const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;
const MAX_CHANNEL_COUNT = 32;
const RENDER_QUANTUM_FRAMES = 128;

class HeapAudioBuffer {
  constructor(wasmModule, length, channelCount, maxChannelCount) {
    this._isInitialized = false;
    this._module = wasmModule;
    this._length = length;
    this._maxChannelCount = maxChannelCount
      ? Math.min(maxChannelCount, MAX_CHANNEL_COUNT)
      : channelCount;
    this._channelCount = channelCount;
    this._allocateHeap();
    this._isInitialized = true;
  }

  _allocateHeap() {
    const channelByteSize = this._length * BYTES_PER_SAMPLE;
    const dataByteSize = this._channelCount * channelByteSize;
    this._dataPtr = this._module._malloc(dataByteSize);
    this._channelData = [];
    for (let i = 0; i < this._channelCount; ++i) {
      const startByteOffset = this._dataPtr + i * channelByteSize;
      const endByteOffset = startByteOffset + channelByteSize;
      this._channelData[i] = this._module.HEAPF32.subarray(
        startByteOffset >> BYTES_PER_UNIT,
        endByteOffset >> BYTES_PER_UNIT,
      );
    }
  }

  adaptChannel(newChannelCount) {
    if (newChannelCount < this._maxChannelCount) {
      this._channelCount = newChannelCount;
    }
  }

  get length() {
    return this._isInitialized ? this._length : null;
  }

  get numberOfChannels() {
    return this._isInitialized ? this._channelCount : null;
  }

  get maxChannelCount() {
    return this._isInitialized ? this._maxChannelCount : null;
  }

  getChannelData(channelIndex) {
    if (channelIndex >= this._channelCount) {
      return null;
    }

    return typeof channelIndex === `undefined`
      ? this._channelData
      : this._channelData[channelIndex];
  }

  getHeapAddress() {
    return this._dataPtr;
  }

  free() {
    this._isInitialized = false;
    this._module._free(this._dataPtr);
    this._module._free(this._pointerArrayPtr);
    this._channelData = null;
  }
}

class RingBuffer {
  constructor(length, channelCount) {
    this._readIndex = 0;
    this._writeIndex = 0;
    this._framesAvailable = 0;

    this._channelCount = channelCount;
    this._length = length;
    this._channelData = [];
    for (let i = 0; i < this._channelCount; ++i) {
      this._channelData[i] = new Float32Array(length);
    }
  }

  get framesAvailable() {
    return this._framesAvailable;
  }

  push(arraySequence) {
    const sourceLength = arraySequence[0].length;
    for (let i = 0; i < sourceLength; ++i) {
      const writeIndex = (this._writeIndex + i) % this._length;
      for (let channel = 0; channel < this._channelCount; ++channel) {
        this._channelData[channel][writeIndex] = arraySequence[channel][i];
      }
    }

    this._writeIndex += sourceLength;
    if (this._writeIndex >= this._length) {
      this._writeIndex = 0;
    }

    this._framesAvailable += sourceLength;
    if (this._framesAvailable > this._length) {
      this._framesAvailable = this._length;
    }
  }

  pull(arraySequence) {
    if (this._framesAvailable === 0) {
      return;
    }

    const destinationLength = arraySequence[0].length;

    for (let i = 0; i < destinationLength; ++i) {
      const readIndex = (this._readIndex + i) % this._length;
      for (let channel = 0; channel < this._channelCount; ++channel) {
        arraySequence[channel][i] = this._channelData[channel][readIndex];
      }
    }

    this._readIndex += destinationLength;
    if (this._readIndex >= this._length) {
      this._readIndex = 0;
    }

    this._framesAvailable -= destinationLength;
    if (this._framesAvailable < 0) {
      this._framesAvailable = 0;
    }
  }
}

const LOG_TABLE = [
  1,
  1,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  6,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
  7,
];

const ALAW_TO_LINEAR = [
  -5504,
  -5248,
  -6016,
  -5760,
  -4480,
  -4224,
  -4992,
  -4736,
  -7552,
  -7296,
  -8064,
  -7808,
  -6528,
  -6272,
  -7040,
  -6784,
  -2752,
  -2624,
  -3008,
  -2880,
  -2240,
  -2112,
  -2496,
  -2368,
  -3776,
  -3648,
  -4032,
  -3904,
  -3264,
  -3136,
  -3520,
  -3392,
  -22016,
  -20992,
  -24064,
  -23040,
  -17920,
  -16896,
  -19968,
  -18944,
  -30208,
  -29184,
  -32256,
  -31232,
  -26112,
  -25088,
  -28160,
  -27136,
  -11008,
  -10496,
  -12032,
  -11520,
  -8960,
  -8448,
  -9984,
  -9472,
  -15104,
  -14592,
  -16128,
  -15616,
  -13056,
  -12544,
  -14080,
  -13568,
  -344,
  -328,
  -376,
  -360,
  -280,
  -264,
  -312,
  -296,
  -472,
  -456,
  -504,
  -488,
  -408,
  -392,
  -440,
  -424,
  -88,
  -72,
  -120,
  -104,
  -24,
  -8,
  -56,
  -40,
  -216,
  -200,
  -248,
  -232,
  -152,
  -136,
  -184,
  -168,
  -1376,
  -1312,
  -1504,
  -1440,
  -1120,
  -1056,
  -1248,
  -1184,
  -1888,
  -1824,
  -2016,
  -1952,
  -1632,
  -1568,
  -1760,
  -1696,
  -688,
  -656,
  -752,
  -720,
  -560,
  -528,
  -624,
  -592,
  -944,
  -912,
  -1008,
  -976,
  -816,
  -784,
  -880,
  -848,
  5504,
  5248,
  6016,
  5760,
  4480,
  4224,
  4992,
  4736,
  7552,
  7296,
  8064,
  7808,
  6528,
  6272,
  7040,
  6784,
  2752,
  2624,
  3008,
  2880,
  2240,
  2112,
  2496,
  2368,
  3776,
  3648,
  4032,
  3904,
  3264,
  3136,
  3520,
  3392,
  22016,
  20992,
  24064,
  23040,
  17920,
  16896,
  19968,
  18944,
  30208,
  29184,
  32256,
  31232,
  26112,
  25088,
  28160,
  27136,
  11008,
  10496,
  12032,
  11520,
  8960,
  8448,
  9984,
  9472,
  15104,
  14592,
  16128,
  15616,
  13056,
  12544,
  14080,
  13568,
  344,
  328,
  376,
  360,
  280,
  264,
  312,
  296,
  472,
  456,
  504,
  488,
  408,
  392,
  440,
  424,
  88,
  72,
  120,
  104,
  24,
  8,
  56,
  40,
  216,
  200,
  248,
  232,
  152,
  136,
  184,
  168,
  1376,
  1312,
  1504,
  1440,
  1120,
  1056,
  1248,
  1184,
  1888,
  1824,
  2016,
  1952,
  1632,
  1568,
  1760,
  1696,
  688,
  656,
  752,
  720,
  560,
  528,
  624,
  592,
  944,
  912,
  1008,
  976,
  816,
  784,
  880,
  848,
];

export {
  MAX_CHANNEL_COUNT,
  RENDER_QUANTUM_FRAMES,
  HeapAudioBuffer,
  RingBuffer,
  LOG_TABLE,
  ALAW_TO_LINEAR,
};
