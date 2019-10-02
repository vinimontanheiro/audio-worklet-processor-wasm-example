/*global chrome */
import { EventEmitter } from 'events';
import RTPBuilder from './RTPBuilder.d.ts';
import { debug, getRandomInt } from './utils';
import { AudioState } from './sipjs/lib/Enums.d.ts';
import UDPSocket from './UDPSocket.d.ts';
import arrayBufferToBuffer from 'arraybuffer-to-buffer';
import * as RTPParser from '@penggy/easy-rtp-parser';
import { ALAW_TO_LINEAR } from '../constants';
import { store } from '../redux/store';

export default class AudioManager extends EventEmitter {
  public ws: UDPSocket;
  private nextRTPPort: string;
  private boundOnOpen: Function;
  private boundOnPause: Function;
  private boundOnMessage: Function;
  private boundOnClose: Function;
  private boundOnError: Function;
  private audioContext: AudioContext;
  private audioSource: AudioBufferSourceNode;
  private audioWalking: boolean;
  private audioSize: number;
  private sampleRate: number;
  private audioId: number;
  private audioGain: GainNode;
  private microphoneAudioContext: AudioContext;
  public state: AudioState;
  private session: InviteClientContext | InviteServerContext;
  private speakerWorklet:any;

  constructor(session: InviteClientContext | InviteServerContext) {
    super();
    this.session = session;
    this.audioSize = 16384;
    this.sampleRate = 8000;
    this.boundOnOpen = this.onOpen.bind(this);
    this.boundOnPause = this.onPause.bind(this);
    this.boundOnMessage = this.onMessage.bind(this);
    this.boundOnClose = this.onSocketClose.bind(this);
    this.boundOnError = this.onError.bind(this);
    this.renewAudioSettings();
    this.state = AudioState.CLOSED;
  }

  private renewAudioSettings(): void {
    const { devices: { audioinput } } = store.getState().Settings;
    this.audioId = 0;
    this.audioWalking = false;
    this.audioContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: this.sampleRate,
      sinkId: audioinput || "default"
    });
    this.audioContext.onstatechange = () => {
      if (this.audioContext) {
        this.state = this.audioContext.state;
      } else {
        this.state = AudioState.CLOSED;
      }
    };
    this.audioBuffer = this.audioContext.createBuffer(1, this.audioSize, this.sampleRate);
    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = this.audioBuffer;
    // this.audioGain = this.audioContext.createGain();
    // this.audioSource.connect(this.audioGain);
    // this.audioGain.connect(this.audioContext.destination);
    this.audioSource.loop = true;
    this.audioContext.audioWorklet
    .addModule('workers/speaker-worklet-processor.js')
    .then(() => {
      this.speakerWorklet = new AudioWorkletNode(
        this.audioContext,
        'speaker-worklet-processor',
        {
          channelCount: 1,
          processorOptions: {
            bufferSize: 160,
            channelCount: 1,
          },
        },
      );
      this.audioSource.connect(this.speakerWorklet).connect(this.audioContext.destination);
    }).catch((err)=>{
      console.log("Receiver ", err);
    })
         
  }

  private renewMicrophoneSettings(): void {
    const { devices : { audiooutput } } = store.getState().Settings;
    this.microphoneAudioContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: this.sampleRate,
      sinkId: audiooutput || "default"
    });
  }

  public listen(
    localAddress: string,
    localPort: number,
    remoteAddress: string,
    remotePort: number,
  ): void {
    const errorCallback = error => {
      debug(`Failed socket >>> ${JSON.stringify(error)}`);
    };

    const successCallback = result => {
      this.ws.addListener('open', this.boundOnOpen);
      this.ws.addListener('pause', this.boundOnPause);
      this.ws.addListener('message', this.boundOnMessage);
      this.ws.addListener('close', this.boundOnClose);
      this.ws.addListener('error', this.boundOnError);
      this.ws.emit('open');
    };

      this.ws = new UDPSocket(localAddress, localPort);
      this.ws.connect(
        remoteAddress,
        remotePort,
        errorCallback,
        successCallback,
        false
      );
    
  }

  private disposeWs(): void {
    if (this.ws) {
      this.ws.close();
      this.ws.removeListener('open', this.boundOnOpen);
      this.ws.removeListener('pause', this.boundOnPause);
      this.ws.removeListener('message', this.boundOnMessage);
      this.ws.removeListener('close', this.boundOnClose);
      this.ws.removeListener('error', this.boundOnError);
      this.ws = null;
    }
  }

  private onSocketClose(e: any): void {
    this.disposeWs();
    if (this.state !== AudioState.CLOSED) {
      try {
        if(this.audioContext && this.audioSource && this.speakerWorklet){
          this.audioContext.close();
          this.audioSource.disconnect(this.speakerWorklet).disconnect(this.audioContext.destination);
        }
        if (this.microphoneAudioContext) {
          this.microphoneAudioContext.close();
        }
        debug(`UDP CLOSED >>> ${e || `by call end!`}`);
        this.renewAudioSettings();
        this.renewMicrophoneSettings();
      } catch (err) {
        debug(`UDP CLOSED ERR >>> ${err}`);
      }
    }
  }

  public close(): void {
    this.onSocketClose();
  }

  protected onOpen(): void {
    debug(`UDP OPEN >>> `);
    this.audioWalking = true;
    this.audioSource.start(0, 1);
    this.renewMicrophoneSettings();
    this.startMicrophoneCapture();

  }

  protected onPause(paused): void {
    debug(`UDP PAUSED >>> ${paused}`);
    this.audioWalking = !paused;
  }

  protected startMicrophoneCapture(): void {
    let rtpBuilder = null;
    this.renewMicrophoneSettings();
    if (this.microphoneAudioContext) {
      this.microphoneAudioContext.audioWorklet
        .addModule('workers/microphone-worklet-processor.js')
        .then(() => {
          navigator.mediaDevices
            .getUserMedia({ audio: true })
            .then(stream => {
              const microphone = this.microphoneAudioContext.createMediaStreamSource(stream);
              const audioNode = new AudioWorkletNode(
                this.microphoneAudioContext,
                'microphone-worklet-processor',
                {
                  channelCount: 1,
                  processorOptions: {
                    bufferSize: 160,
                    channelCount: 1,
                  },
                },
              );
              audioNode.port.onmessage = ({ data }) => {
                if(data && data.payload && this.ws){
                    if(!rtpBuilder){
                      rtpBuilder = new RTPBuilder();
                      rtpBuilder.setPayloadType(8);
                    }
                    const payload = arrayBufferToBuffer(data.payload);
                    rtpBuilder.setPayload(payload);
                    const { rtp } = rtpBuilder;
                    this.ws.send(rtp.buffer, null, false)
                }
              };
              microphone.connect(audioNode).connect(this.microphoneAudioContext.destination);
            })
            .catch(e => {
              debug(`AudioManager >> GetUserMedia >> ${e}`);
            });
        })
        .catch(e => {
          debug(`AudioManager >>> MicrophoneAudioContext >>> audioWorklet >> ${e}`);
        });
    }
  }

  protected onMessage(e: any): void {
    /* eslint-disable no-undef*/
    const serverData = e.data;
    const socketId = e.socketId;
    if (this.audioWalking && this.ws && !this.ws.isPaused() && this.ws.info.socketId === socketId) {
      const buffer = arrayBufferToBuffer(serverData);
      const rtp = RTPParser.parseRtpPacket(buffer);
      const sharedPayload = new Uint8Array(new SharedArrayBuffer(rtp.payload.length)); //sharing javascript memory
      sharedPayload.set(rtp.payload, 0);
      this.speakerWorklet.port.postMessage(sharedPayload);
    }
  }

  protected onError(e: any): void {
    debug(`UDP ERROR: ${JSON.stringify(e)}`);
    this.onSocketClose();
  }

  public changeVolume(value: number): void {
    const volume = Number(value) / 100;
    if (this.audioGain) {
      this.audioGain.gain.value = Number(value) / 100;
    }
  }

  public toggleMute(mute: bool): void {
    if (this.microphoneAudioContext) {
      if (mute) {
        this.microphoneAudioContext.suspend();
        this.microphoneAudioContext.close();
      } else {
        this.startMicrophoneCapture();
      }
    }
  }

  public toggleHold(hold: bool): void {
    if (this.audioContext) {
      if (hold) {
        this.audioContext.suspend();
      } else {
        this.audioContext.resume();
      }
    }
    this.toggleMute(hold);

    if(this.ws){
      this.ws.pause(hold);
    }
    
  }
  
}
