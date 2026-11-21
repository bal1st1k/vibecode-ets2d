/*! 2D ETS2 Moldova Edition | High-Performance Procedural Audio Engine */
(function (root) {
  'use strict';

  class TruckAudio {
    constructor() {
      this.ctx = null;
      this.unlocked = false;
      this.running = false;
      this.muted = false;
      this.lastTickTime = 0;
      this.turnSignalTick = false;
      this.lastBeepTime = 0;
    }

    setMuted(muted) {
      this.muted = !!muted;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
      }
    }

    init() {
      if (this.ctx) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;
      this.masterGain.connect(this.ctx.destination);

      // 1. Diesel Engine Synthesizer
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.25;
      this.engineGain.connect(this.masterGain);

      // Low frequency rumble (fundamental cylinder firing)
      this.oscRumble = this.ctx.createOscillator();
      this.oscRumble.type = 'sawtooth';
      this.oscRumble.frequency.value = 45; // ~700 RPM idle

      // Engine body filter
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 350;

      this.oscRumble.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);

      // 2. Turbo Whistle Synthesizer
      this.turboGain = this.ctx.createGain();
      this.turboGain.gain.value = 0;
      this.turboGain.connect(this.masterGain);

      this.oscTurbo = this.ctx.createOscillator();
      this.oscTurbo.type = 'sine';
      this.oscTurbo.frequency.value = 1400;

      this.oscTurbo.connect(this.turboGain);

      this.oscRumble.start();
      this.oscTurbo.start();
      this.running = true;
      this.unlocked = true;
    }

    unlock() {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    update(sim, dt) {
      if (!this.running || !this.ctx || !sim || this.muted) return;
      const t = sim.truck;
      const now = this.ctx.currentTime;

      // 1. Update Engine RPM Sound
      // 600 RPM = ~40 Hz fundamental; 2400 RPM = ~160 Hz
      const freq = (t.rpm / 60) * 4; // 4 cylinder pulses per revolution for 6-cyl 4-stroke
      this.oscRumble.frequency.setTargetAtTime(freq, now, 0.05);

      // Engine volume and filter open up with speed and throttle
      const throttle = Math.max(0, t.speed > 0 ? (t.rpm - 600) / 1800 : 0.1);
      this.engineFilter.frequency.setTargetAtTime(250 + throttle * 400, now, 0.05);
      this.engineGain.gain.setTargetAtTime(0.2 + throttle * 0.25, now, 0.05);

      // 2. Turbo whistle on high RPM
      const turboIntensity = Math.max(0, (t.rpm - 1100) / 1300);
      this.oscTurbo.frequency.setTargetAtTime(1200 + turboIntensity * 800, now, 0.1);
      this.turboGain.gain.setTargetAtTime(turboIntensity * 0.06, now, 0.1);

      // 3. Air Brake Discharge (Pshhhh!)
      if (sim.brakePshTrigger) {
        this.playAirBrakePsh();
      }

      // 4. Turn Signal Relay Clicker (tick-tack)
      if (t.turnSignal !== 0) {
        if (now - this.lastTickTime > 0.45) {
          this.playRelayClick(this.turnSignalTick);
          this.turnSignalTick = !this.turnSignalTick;
          this.lastTickTime = now;
        }
      }

      // 5. Reverse Beeper (Safety Warning)
      if (t.gear === -1 && t.speed < -0.5) {
        if (now - this.lastBeepTime > 0.75) {
          this.playReverseBeep();
          this.lastBeepTime = now;
        }
      }

      // 6. Air Horn
      if (t.horn) {
        this.startAirHorn();
      } else {
        this.stopAirHorn();
      }
    }

    // Procedural noise burst for air brake release
    playAirBrakePsh() {
      if (!this.ctx) return;
      const bufferSize = this.ctx.sampleRate * 0.35;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.12));
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1600;
      filter.Q.value = 1.2;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.35);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noise.start();
    }

    // Turn signal relay click
    playRelayClick(isHigh) {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = isHigh ? 1800 : 1200;

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.035);
    }

    // Reverse safety beep
    playReverseBeep() {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1100;

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.2, this.ctx.currentTime + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.26);
    }

    startAirHorn() {
      if (this.hornActive || !this.ctx) return;
      this.hornActive = true;
      const now = this.ctx.currentTime;

      this.hornGain = this.ctx.createGain();
      this.hornGain.gain.setValueAtTime(0.3, now);
      this.hornGain.connect(this.masterGain);

      // Two-tone European air trumpet (e.g. 290 Hz and 370 Hz)
      this.horn1 = this.ctx.createOscillator();
      this.horn1.type = 'sawtooth';
      this.horn1.frequency.value = 290;

      this.horn2 = this.ctx.createOscillator();
      this.horn2.type = 'sawtooth';
      this.horn2.frequency.value = 370;

      const hornFilter = this.ctx.createBiquadFilter();
      hornFilter.type = 'lowpass';
      hornFilter.frequency.value = 1200;

      this.horn1.connect(hornFilter);
      this.horn2.connect(hornFilter);
      hornFilter.connect(this.hornGain);

      this.horn1.start();
      this.horn2.start();
    }

    stopAirHorn() {
      if (!this.hornActive || !this.ctx) return;
      this.hornActive = false;
      const now = this.ctx.currentTime;
      if (this.hornGain) {
        this.hornGain.gain.setTargetAtTime(0.001, now, 0.05);
        setTimeout(() => {
          try {
            if (this.horn1) this.horn1.stop();
            if (this.horn2) this.horn2.stop();
          } catch (_) {}
        }, 100);
      }
    }
  }

  root.ETSAudio = TruckAudio;
  if (typeof module !== 'undefined' && module.exports) module.exports = TruckAudio;
})(typeof globalThis !== 'undefined' ? globalThis : window);
