class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.packet = new Uint8Array(641);
    this.packet[0] = 0x41;
    this.packetSamples = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (let i = 0; i < input.length; i++) {
        this.sum += input[i];
        this.count++;
        this.phase++;
        if (this.phase >= this.ratio) {
          const value = Math.max(-1, Math.min(1, this.sum / this.count));
          const pcm = Math.round(value < 0 ? value * 32768 : value * 32767);
          const offset = 1 + this.packetSamples * 2;
          this.packet[offset] = pcm & 255;
          this.packet[offset + 1] = (pcm >> 8) & 255;
          this.packetSamples++;
          this.phase -= this.ratio;
          this.sum = 0;
          this.count = 0;
          if (this.packetSamples === 320) {
            this.port.postMessage(this.packet, [this.packet.buffer]);
            this.packet = new Uint8Array(641);
            this.packet[0] = 0x41;
            this.packetSamples = 0;
          }
        }
      }
    }
    for (const output of outputs[0] || []) output.fill(0);
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
