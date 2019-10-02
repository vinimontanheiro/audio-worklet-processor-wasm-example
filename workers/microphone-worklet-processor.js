import Module from './buffer-kernel.wasmodule.js';
import { HeapAudioBuffer, RingBuffer, LOG_TABLE } from './audio-helper.js';

class MicrophoneWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.bufferSize = options.processorOptions.bufferSize;
    this.channelCount = options.processorOptions.channelCount;
    this.inputRingBuffer = new RingBuffer(this.bufferSize, this.channelCount);
    this.heapInputBuffer = new HeapAudioBuffer(Module, this.bufferSize, this.channelCount);
    this.heapOutputBuffer = new HeapAudioBuffer(Module, this.bufferSize, this.channelCount);
    this.kernel = new Module.VariableBufferKernel(this.bufferSize);
  }

  float32ToInt16(float32array) {
    let l = float32array.length;
    const buffer = new Int16Array(l);
    while (l--) {
      buffer[l] = Math.min(1, float32array[l]) * 0x7fff;
    }
    return buffer;
  }

  alawEncode(sample) {
    let compandedValue;
    sample = sample === -32768 ? -32767 : sample;
    const sign = (~sample >> 8) & 0x80;
    if (!sign) {
      sample *= -1;
    }
    if (sample > 32635) {
      sample = 32635;
    }
    if (sample >= 256) {
      const exponent = LOG_TABLE[(sample >> 8) & 0x7f];
      const mantissa = (sample >> (exponent + 3)) & 0x0f;
      compandedValue = (exponent << 4) | mantissa;
    } else {
      compandedValue = sample >> 4;
    }
    return compandedValue ^ (sign ^ 0x55);
  }

  linearToAlaw(int16array) {
    const aLawSamples = new Uint8Array(int16array.length);
    for (let i = 0; i < int16array.length; i++) {
      aLawSamples[i] = this.alawEncode(int16array[i]);
    }
    return aLawSamples;
  }

  process(inputs) {
    const input = inputs[0];
    this.inputRingBuffer.push(input);

    if (this.inputRingBuffer.framesAvailable >= this.bufferSize) {
      this.inputRingBuffer.pull(this.heapInputBuffer.getChannelData());

      this.kernel.process(
        this.heapInputBuffer.getHeapAddress(),
        this.heapOutputBuffer.getHeapAddress(),
        this.channelCount,
      );
      const channelData = this.heapOutputBuffer.getChannelData();

      if (channelData && !!channelData.length) {
        const float32array = channelData[0];
        const int16array = this.float32ToInt16(float32array);
        const payload = this.linearToAlaw(int16array);
        this.port.postMessage({ payload });
      }
    }
    return true;
  }
}

registerProcessor(`microphone-worklet-processor`, MicrophoneWorkletProcessor);
