import type { Settings } from '../core/save';
import type { BattleEvent } from '../sim/battle';
import type { Enemy } from '../sim/enemies';
import type { RouteOption } from '../world/route';

/** Synthesised sound. No sample files: every cue is oscillators, noise and envelopes. */
type Kind = RouteOption['kind'];

interface Bus {
  sfx: GainNode;
  amb: GainNode;
  master: GainNode;
}

/**
 * Procedural audio. Each gameplay fact has its own timbre so cues are told apart
 * by ear: glaive whooshes, quill chirps, hit thumps, dodge air, shard chimes,
 * and a voice per enemy telegraph. Ambience is a drone, an airy noise bed, page
 * rustles and a distant bell. Everything fails silently when audio is unavailable.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private noise: AudioBuffer | null = null;
  private ambience: { nodes: AudioNode[]; timers: number[] } | null = null;
  private volumes = { master: 0.8, sfx: 0.9, amb: 0.5 };
  private ducked = false;
  private lastTelegraph = new Map<number, number>();

  /** Creates the audio context. Browsers allow it only after a user gesture, so call from input handlers. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      const sfx = ctx.createGain();
      const amb = ctx.createGain();
      sfx.connect(master);
      amb.connect(master);
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.bus = { sfx, amb, master };
      this.noise = this.makeNoise(2);
      this.applyVolumes();
    } catch {
      this.ctx = null;
    }
  }

  setVolumes(s: Settings): void {
    this.volumes = { master: s.masterVolume, sfx: s.sfxVolume, amb: s.ambienceVolume };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.bus || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.bus.master.gain.setTargetAtTime(this.volumes.master * 0.8, t, 0.02);
    this.bus.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.02);
    this.bus.amb.gain.setTargetAtTime(this.volumes.amb * (this.ducked ? 0.3 : 1), t, 0.1);
  }

  setAmbienceDucked(on: boolean): void {
    this.ducked = on;
    this.applyVolumes();
  }

  private makeNoise(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    return buf;
  }

  /** Oscillator with a pitch envelope and an exponential decay. */
  private tone(opts: { type: OscillatorType; f0: number; f1?: number; dur: number; gain: number; bus?: 'sfx' | 'amb'; when?: number; filter?: { type: BiquadFilterType; f: number; q?: number } }): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const start = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.f0, start);
    if (opts.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), start + opts.dur);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), start + Math.min(0.012, opts.dur * 0.2));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);
    let node: AudioNode = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter.type;
      f.frequency.value = opts.filter.f;
      f.Q.value = opts.filter.q ?? 0.7;
      osc.connect(f);
      node = f;
    }
    node.connect(amp);
    amp.connect(opts.bus === 'amb' ? bus.amb : bus.sfx);
    osc.start(start);
    osc.stop(start + opts.dur + 0.05);
  }

  /** Filtered noise with a sweep, for breath, rush and air. */
  private whoosh(opts: { dur: number; f0: number; f1: number; q?: number; gain: number; type?: BiquadFilterType; when?: number }): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus || !this.noise) return;
    const start = ctx.currentTime + (opts.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.Q.value = opts.q ?? 1.2;
    f.frequency.setValueAtTime(opts.f0, start);
    f.frequency.exponentialRampToValueAtTime(opts.f1, start + opts.dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(opts.gain, start + Math.min(0.03, opts.dur * 0.25));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);
    src.connect(f);
    f.connect(amp);
    amp.connect(bus.sfx);
    src.start(start, Math.random() * 0.5);
    src.stop(start + opts.dur + 0.05);
  }

  /** Short click or snap. */
  private click(gain: number, f = 2400, when = 0): void {
    this.tone({ type: 'square', f0: f, f1: f * 0.5, dur: 0.03, gain, when, filter: { type: 'highpass', f: 800 } });
  }

  /** Cues for battle events. Called for every event as it is drained. */
  onBattleEvent(ev: BattleEvent): void {
    if (!this.ctx) return;
    switch (ev.type) {
      case 'swing':
        if (ev.riposte) {
          this.whoosh({ dur: 0.22, f0: 1400, f1: 3600, q: 2, gain: 0.22 });
          this.tone({ type: 'sine', f0: 1320, dur: 0.3, gain: 0.05, when: 0.05 });
        } else if (ev.heavy) {
          this.whoosh({ dur: 0.34, f0: 350, f1: 1500, q: 0.9, gain: 0.3 });
          this.tone({ type: 'sawtooth', f0: 140, f1: 70, dur: 0.3, gain: 0.05, filter: { type: 'lowpass', f: 500 } });
        } else {
          this.whoosh({ dur: 0.16, f0: 900 + ev.index * 250, f1: 2400 + ev.index * 300, q: 1.6, gain: 0.18 });
        }
        break;
      case 'shot':
        this.tone({ type: 'triangle', f0: 1400, f1: 700, dur: 0.08, gain: 0.12 });
        this.click(0.05, 3200);
        break;
      case 'enemyHurt':
        if (ev.heavy) {
          this.tone({ type: 'sine', f0: 170, f1: 55, dur: 0.22, gain: 0.32 });
          this.click(0.12, 1800);
        } else {
          this.tone({ type: 'sine', f0: 190, f1: 70, dur: 0.12, gain: 0.18 });
          this.click(0.06, 2200);
        }
        break;
      case 'armourBroken':
        this.tone({ type: 'sine', f0: 2600, f1: 1900, dur: 0.18, gain: 0.1 });
        this.click(0.1, 4200);
        this.click(0.08, 3000, 0.04);
        break;
      case 'stagger':
        this.tone({ type: 'sine', f0: 240, f1: 110, dur: 0.16, gain: 0.16 });
        break;
      case 'wallStun':
        this.tone({ type: 'square', f0: 220, f1: 90, dur: 0.4, gain: 0.12, filter: { type: 'lowpass', f: 700 } });
        this.whoosh({ dur: 0.3, f0: 800, f1: 200, q: 0.8, gain: 0.2 });
        break;
      case 'enemyDied':
        this.tone({ type: 'sawtooth', f0: 330, f1: 55, dur: 0.55, gain: 0.12, filter: { type: 'lowpass', f: 900 } });
        this.whoosh({ dur: 0.7, f0: 1600, f1: 300, q: 0.6, gain: 0.14 });
        break;
      case 'ignited':
        this.whoosh({ dur: 0.35, f0: 600, f1: 2200, q: 1.1, gain: 0.12 });
        break;
      case 'kindlingBlast':
        this.tone({ type: 'sine', f0: 120, f1: 40, dur: 0.6, gain: 0.35 });
        this.whoosh({ dur: 0.5, f0: 2000, f1: 200, q: 0.7, gain: 0.25 });
        break;
      case 'telegraph':
        this.telegraph(ev.enemy, ev.duration);
        break;
      case 'attackActive':
        if (ev.attack === 'lunge' || ev.attack === 'charge' || ev.attack === 'triple-dash') {
          this.whoosh({ dur: 0.18, f0: 500, f1: 1400, q: 1, gain: 0.16 });
        }
        break;
      case 'ring':
        this.tone({ type: 'sine', f0: 80, f1: 30, dur: 0.6, gain: 0.45 });
        this.whoosh({ dur: 0.5, f0: 600, f1: 120, q: 0.6, gain: 0.25 });
        break;
      case 'playerHurt':
        this.tone({ type: 'sawtooth', f0: 110, f1: 80, dur: 0.3, gain: 0.22, filter: { type: 'lowpass', f: 650 } });
        this.tone({ type: 'sawtooth', f0: 117, f1: 84, dur: 0.3, gain: 0.12, filter: { type: 'lowpass', f: 650 } });
        break;
      case 'playerDied':
        this.tone({ type: 'sawtooth', f0: 220, f1: 36, dur: 1.4, gain: 0.2, filter: { type: 'lowpass', f: 500 } });
        break;
      case 'dodge':
        if (ev.phase === 'start') {
          this.whoosh({ dur: 0.2, f0: 300, f1: 3000, q: 0.9, gain: 0.22 });
          this.tone({ type: 'sine', f0: 1200, dur: 0.1, gain: 0.07, when: 0.02 });
        }
        break;
      case 'pickup':
        if (ev.kind === 'shard') {
          this.tone({ type: 'triangle', f0: 880, dur: 0.12, gain: 0.1 });
          this.tone({ type: 'triangle', f0: 1320, dur: 0.16, gain: 0.1, when: 0.07 });
        } else {
          this.tone({ type: 'sine', f0: 660, dur: 0.6, gain: 0.12 });
          this.tone({ type: 'sine', f0: 990, dur: 0.5, gain: 0.05, when: 0.02 });
        }
        break;
      case 'tear':
        this.whoosh({ dur: 0.3, f0: 2500, f1: 500, q: 0.8, gain: 0.25 });
        this.click(0.12, 5200);
        break;
      case 'fragmentLaunch':
        this.tone({ type: 'square', f0: 1800, f1: 2600, dur: 0.04, gain: 0.05 });
        break;
      case 'impact':
        if (ev.owner === 'player') this.click(0.05, 3600);
        else this.tone({ type: 'sine', f0: 400, f1: 180, dur: 0.1, gain: 0.1 });
        break;
      case 'spawnRune':
        this.tone({ type: 'sine', f0: 300, f1: 620, dur: 0.7, gain: 0.05 });
        break;
      case 'hazardArmed':
        this.click(0.04, 1500);
        break;
      case 'hazardBurst':
        this.whoosh({ dur: 0.4, f0: 3000, f1: 300, q: 0.6, gain: ev.hit ? 0.28 : 0.12 });
        break;
      case 'bossPhase':
        this.stinger([110, 165, 220]);
        break;
      case 'roomCleared':
        this.chime([523, 659, 784]);
        break;
      default:
        break;
    }
  }

  /** Each enemy kind has its own telegraph voice, so the ear knows what is coming. */
  private telegraph(enemy: Enemy, duration: number): void {
    const last = this.lastTelegraph.get(enemy.id) ?? -1;
    if (this.ctx && this.ctx.currentTime - last < 0.2) return;
    this.lastTelegraph.set(enemy.id, this.ctx?.currentTime ?? 0);
    switch (enemy.def.kind) {
      case 'husk':
        for (let i = 0; i < 3; i++) this.click(0.08, 1900 + i * 180, i * 0.06);
        break;
      case 'acolyte':
        this.tone({ type: 'sine', f0: 500, f1: 1000, dur: Math.min(0.5, duration), gain: 0.1 });
        break;
      case 'bulwark':
        this.tone({ type: 'sawtooth', f0: 70, f1: 140, dur: duration, gain: 0.1, filter: { type: 'lowpass', f: 320 } });
        break;
      case 'elite':
        this.tone({ type: 'sine', f0: 660, dur: 1.1, gain: 0.12 });
        this.tone({ type: 'sine', f0: 990, dur: 0.9, gain: 0.05 });
        break;
      case 'boss':
        this.tone({ type: 'sine', f0: 55, dur: 1.4, gain: 0.25 });
        this.tone({ type: 'sine', f0: 110, dur: 1.2, gain: 0.08 });
        break;
    }
  }

  private chime(freqs: number[]): void {
    freqs.forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.6, gain: 0.12, when: i * 0.09 }));
  }

  private stinger(freqs: number[]): void {
    freqs.forEach((f) => this.tone({ type: 'sawtooth', f0: f, dur: 1.6, gain: 0.08, filter: { type: 'lowpass', f: 1200 } }));
    this.whoosh({ dur: 1.2, f0: 120, f1: 1800, q: 0.7, gain: 0.2 });
  }

  onUpgrade(): void {
    this.chime([659, 784, 988]);
  }

  onMend(): void {
    this.tone({ type: 'sine', f0: 523, dur: 1.2, gain: 0.14 });
  }

  onRoomStart(kind: Kind): void {
    if (kind === 'boss') this.stinger([55, 82, 110]);
  }

  onRoomCleared(): void {
    this.chime([523, 659, 784]);
  }

  onRunEnd(won: boolean): void {
    if (won) this.chime([523, 659, 784, 1047]);
    else this.tone({ type: 'sawtooth', f0: 180, f1: 40, dur: 1.6, gain: 0.14, filter: { type: 'lowpass', f: 600 } });
  }

  /**
   * Starts the ambience: a detuned drone through a slow low-pass, an airy noise
   * bed, page rustles and a distant bell at irregular intervals.
   */
  startAmbience(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus || !this.noise || this.ambience) return;
    const nodes: AudioNode[] = [];
    const timers: number[] = [];

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.08;
    for (const f of [55, 82.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(lp);
      o.start();
      nodes.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
    nodes.push(lfo, lfoGain);
    lp.connect(droneGain);
    droneGain.connect(bus.amb);
    nodes.push(lp, droneGain);

    const bed = ctx.createBufferSource();
    bed.buffer = this.noise;
    bed.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.5;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.035;
    bed.connect(bp);
    bp.connect(bedGain);
    bedGain.connect(bus.amb);
    bed.start();
    nodes.push(bed, bp, bedGain);

    const schedule = (): void => {
      const rustle = window.setTimeout(() => {
        if (!this.ambience) return;
        this.whoosh({ dur: 0.5, f0: 4000, f1: 1200, q: 2.5, gain: 0.05 });
        schedule();
      }, 5000 + Math.random() * 7000);
      timers.push(rustle);
    };
    schedule();
    const bell = (): void => {
      const t = window.setTimeout(() => {
        if (!this.ambience) return;
        this.tone({ type: 'sine', f0: 392, dur: 3.2, gain: 0.05, bus: 'amb' });
        this.tone({ type: 'sine', f0: 588, dur: 2.4, gain: 0.02, bus: 'amb', when: 0.02 });
        bell();
      }, 22000 + Math.random() * 18000);
      timers.push(t);
    };
    bell();
    this.ambience = { nodes, timers };
  }

  stopAmbience(): void {
    if (!this.ambience) return;
    for (const n of this.ambience.nodes) {
      if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) {
        try {
          n.stop();
        } catch {
          // Already stopped.
        }
      }
    }
    this.ambience.timers.forEach((t) => window.clearTimeout(t));
    this.ambience = null;
  }
}
