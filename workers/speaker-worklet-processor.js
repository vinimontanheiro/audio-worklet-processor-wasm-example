import Module from './buffer-kernel.wasmodule.js';
import { HeapAudioBuffer, RingBuffer, ALAW_TO_LINEAR } from './audio-helper.js';

class SpeakerWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.payload = null;
    this.bufferSize = options.processorOptions.bufferSize;
    this.channelCount = options.processorOptions.channelCount;
    this.inputRingBuffer = new RingBuffer(this.bufferSize, this.channelCount);
    this.outputRingBuffer = new RingBuffer(this.bufferSize, this.channelCount);
    this.heapInputBuffer = new HeapAudioBuffer(Module, this.bufferSize, this.channelCount);
    this.heapOutputBuffer = new HeapAudioBuffer(Module, this.bufferSize, this.channelCount);
    this.kernel = new Module.VariableBufferKernel(this.bufferSize);
    this.port.onmessage = this.onmessage.bind(this);
  }

  alawToLinear(incomingData) {
    const outputData = new Float32Array(incomingData.length);
    for (let i = 0; i < incomingData.length; i++) {
      outputData[i] = (ALAW_TO_LINEAR[incomingData[i]] * 1.0) / 32768;
    }
    return outputData;
  }

  onmessage(event) {
    const { data } = event;
    if (data) {
      this.payload = this.alawToLinear(new Uint8Array(data));
    } else {
      this.payload = null;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (this.payload) {
      this.inputRingBuffer.push([this.payload]);
      if (this.inputRingBuffer.framesAvailable >= this.bufferSize) {
        this.inputRingBuffer.pull(this.heapInputBuffer.getChannelData());
        this.kernel.process(
          this.heapInputBuffer.getHeapAddress(),
          this.heapOutputBuffer.getHeapAddress(),
          this.channelCount,
        );
        this.outputRingBuffer.push(this.heapOutputBuffer.getChannelData());
      }
      this.outputRingBuffer.pull(output);
    }
    return true;
  }
}

registerProcessor(`speaker-worklet-processor`, SpeakerWorkletProcessor);
