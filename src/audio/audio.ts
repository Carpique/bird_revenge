import { sound, type webaudio } from '@pixi/sound';
import files from 'virtual:audio-files';
import { config } from '../config';

/** Sound effect groups; each plays a random file of public/assets/audio/<group>-N.mp3 */
export type SfxGroup = 'shot' | 'splat' | 'bad-guy-dies' | 'ghost-dies' | 'bat-dies' | 'score' | 'player-hit' | 'boing' | 'sad-audience' | 'friend' | 'coin' | 'button' | 'fanfare' | 'dragon-roar';

const DIR = 'assets/audio/';
const STORAGE_KEY = 'bird-revenge-volume';

/** "splat-2.mp3" → "splat"; every "music-*" file is in the "music" group, every "main-theme-*" in "main-theme" */
const groupOf = (file: string) => file.replace(/\.[^.]+$/, '').replace(/-\d+$/, '');
const url = (file: string) => import.meta.env.BASE_URL + DIR + file;

/**
 * All game audio. Effects are decoded into memory by @pixi/sound so they play instantly; music is
 * streamed through an <audio> element (a whole song decoded would take ~60 MB), and so is the title
 * screen's looped theme (`playTheme`), on an element of its own. The falling-poo
 * tone, the dragons' fire and a poo hissing away in it are synthesised on @pixi/sound's AudioContext.
 *
 * Browsers only allow sound after a click or key press. Music starts with the first countdown
 * (`startMusic`), which comes from the pose, not a click, so the first click / key press unlocks the
 * music element for later by playing it silently for a moment.
 * `volume`/`muted` come from the speaker button and are remembered in this browser;
 * config.audio holds the mix levels.
 */
class GameAudio {
  volume = 0.7;
  muted = false;

  private groups = new Map<string, string[]>();
  private tracks: string[] = [];
  private music = new Audio();
  private track = '';
  /** the game wants music (from the first countdown on) */
  private musicWanted = false;
  /** turned down by `duckMusic` until `restoreMusic` */
  private musicDucked = false;
  /** faded out under a `playOverMusic` sound until it ends */
  private musicHushed = false;
  /** the music's level (0–1, times the mix), gliding between `startMusic` / `duckMusic` / `restoreMusic` / `stopMusic`; silent until `startMusic` */
  private musicRamp = { from: 0, to: 0, start: 0, ms: 1 };
  /** the music element has played once inside a click / key press, so it may play later */
  private musicUnlocked = false;
  /** `unlockMusic` is playing the music silently */
  private musicUnlocking = false;
  private themes: string[] = [];
  private theme = new Audio();
  /** the title screen wants its theme played (it's waiting for a click / key press, or playing) */
  private themeWanted = false;
  /** when `stopTheme` started fading the theme out; null when not fading */
  private themeFadeStart: number | null = null;
  private themeFadeMs = 0;
  private suspended = false;
  private warned = new Set<string>();
  /** the falling-poo tones go through this, so volume changes reach tones already playing */
  private fallBus: GainNode | null = null;
  /** the fire sounds go through this, likewise */
  private flameBus: GainNode | null = null;
  /** looped noise for the fire sounds: plain, and sparse pops (crackle); made on first use */
  private flameNoise: { hiss: AudioBuffer; crackle: AudioBuffer } | null = null;
  /** fire sounds playing, with when they were last `set`; one not set for a while (the game stopped stepping) stops */
  private flames = new Map<FlameSound, number>();
  /** last levels applied (only push changes) */
  private applied = { effects: -1, music: -1, theme: -1, fall: -1, flame: -1 };

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (typeof saved?.volume === 'number') this.volume = Math.min(1, Math.max(0, saved.volume));
      if (typeof saved?.muted === 'boolean') this.muted = saved.muted;
    } catch {
      // no storage: defaults
    }

    // pausing is driven by the game (setSuspended), which also covers the window losing focus
    sound.disableAutoPause = true;
    for (const f of files) {
      const g = groupOf(f);
      if (g === 'music' || g === 'main-theme') {
        (g === 'music' ? this.tracks : this.themes).push(f);
        continue;
      }
      sound.add(f, { url: url(f), preload: true });
      this.groups.set(g, [...(this.groups.get(g) ?? []), f]);
    }

    // in file name order, numbers compared as numbers (music-2 before music-10)
    this.tracks.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    this.music.preload = 'none';
    this.music.loop = this.tracks.length === 1;
    this.music.addEventListener('ended', () => this.nextTrack());
    this.theme.preload = 'auto';
    if (this.themes.length) this.theme.src = url(this.themes[0]);
    this.theme.loop = true;

    // the lock screen / Control Center player (iOS) can start the elements on its own, e.g. the music
    // on the title screen, where it then plays over the theme: only the game decides what plays
    this.music.addEventListener('play', () => {
      if (this.suspended || (!this.musicWanted && !this.musicUnlocking)) this.music.pause();
    });
    this.theme.addEventListener('play', () => {
      if (this.suspended || !this.themeWanted) this.theme.pause();
    });
    if ('mediaSession' in navigator) {
      for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as const) {
        try {
          navigator.mediaSession.setActionHandler(action, () => {});
        } catch {
          // action not supported here
        }
      }
    }

    const unlock = () => {
      if (this.suspended) return;
      void sound.context.audioContext.resume();
      if (this.musicWanted) this.playMusic();
      else this.unlockMusic();
      if (this.themeWanted) this.resumeTheme();
      if ((this.musicUnlocked || !this.tracks.length) && !(this.themeWanted && this.theme.paused)) {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    this.update();
  }

  /** A random sound of `group`; `onEnd` is called when it has finished (right away if there's none to play). */
  play(group: SfxGroup, onEnd?: () => void) {
    const list = this.groups.get(group);
    if (!list?.length) {
      if (!this.warned.has(group)) console.warn(`no sound files for "${group}" in public/${DIR}`);
      this.warned.add(group);
      onEnd?.();
      return;
    }
    const alias = list[Math.floor(Math.random() * list.length)];
    // a sound still loading would otherwise play late, whenever it arrives
    if (sound.find(alias).isLoaded) sound.play(alias, { complete: () => onEnd?.() });
    else onEnd?.();
  }

  /** A random sound of `group` with the music faded out under it (config.audio.musicHushMs), and back in after it. */
  playOverMusic(group: SfxGroup) {
    this.musicHushed = true;
    this.rampMusic(0, config.audio.musicHushMs);
    this.play(group, () => {
      if (!this.musicHushed) return;
      this.musicHushed = false;
      this.rampMusic(this.musicLevel(), config.audio.musicHushMs);
    });
  }

  /** Starts the falling tone (pitch gliding down); call the returned function when the poo lands. */
  startFall(): () => void {
    const ctx = sound.context.audioContext;
    if (ctx.state !== 'running' || this.suspended) return () => {};
    const a = config.audio;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(a.fallFromHz, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, a.fallToHz), t + a.fallMs / 1000);
    // a slight wobble makes it sound like a cartoon whistle rather than a test tone
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 6;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 8;
    wobble.connect(wobbleDepth).connect(osc.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.05);
    osc.connect(env).connect(this.bus(ctx));
    osc.start(t);
    wobble.start(t);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      env.gain.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0, now, 0.02);
      osc.stop(now + 0.15);
      wobble.stop(now + 0.15);
    };
    // never drone on if the poo somehow doesn't land
    osc.addEventListener('ended', () => env.disconnect());
    setTimeout(stop, a.fallMs + 5000);
    return stop;
  }

  /**
   * Starts a fire's roar (filtered noise, flickering, crackling), silent until `set`. `set` it every game step to how far
   * the fire is out (0–1); not set for a while (the game paused or stopped), it fades out and `ended` turns true.
   */
  startFlame(): FlameSound {
    const ctx = sound.context.audioContext;
    const flame: FlameSound = { ended: true, set: () => {}, stop: () => {} };
    if (ctx.state !== 'running' || this.suspended) return flame;
    const t = ctx.currentTime;
    const noise = this.noise(ctx);
    // noise loops from random points, so several fires don't sum into one louder, phasey one
    const loop = (buffer: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.start(t, Math.random() * buffer.duration);
      return src;
    };
    const filter = (type: BiquadFilterType, hz: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    const gain = (value: number) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };
    const env = gain(0);
    // flicker: the level wavering a little, two slow sines out of step
    const flicker = gain(1);
    const lfos = [3.3, 7.9].map((hz, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz * (0.85 + Math.random() * 0.3);
      o.connect(gain(i ? 0.08 : 0.15)).connect(flicker.gain);
      o.start(t);
      return o;
    });
    // the roar: low rumble, its cutoff opening as the fire comes out
    const rumble = filter('lowpass', 300, 1.2);
    const hiss = loop(noise.hiss);
    hiss.connect(rumble).connect(flicker);
    hiss.connect(filter('bandpass', 1800, 0.6)).connect(gain(0.25)).connect(flicker);
    const crackle = loop(noise.crackle);
    crackle.connect(filter('highpass', 1200)).connect(gain(0.5)).connect(flicker);
    flicker.connect(env).connect(this.flameOut(ctx));
    const sources = [hiss, crackle, ...lfos];

    flame.ended = false;
    flame.set = (level: number) => {
      if (flame.ended) return;
      this.flames.set(flame, performance.now());
      const now = ctx.currentTime;
      const k = Math.min(1, Math.max(0, level));
      env.gain.setTargetAtTime(k, now, 0.05);
      rumble.frequency.setTargetAtTime(300 + 900 * k, now, 0.08);
    };
    flame.stop = () => {
      if (flame.ended) return;
      flame.ended = true;
      this.flames.delete(flame);
      const now = ctx.currentTime;
      env.gain.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0, now, 0.05);
      for (const s of sources) s.stop(now + 0.4);
    };
    hiss.addEventListener('ended', () => env.disconnect());
    return flame;
  }

  /** A short "shhh": a poo evaporating in a fire (noise, its pitch and level falling away). */
  playHiss() {
    const ctx = sound.context.audioContext;
    const level = (this.muted ? 0 : this.volume) * config.audio.hiss;
    if (ctx.state !== 'running' || this.suspended || level <= 0) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx).hiss;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(6000 + Math.random() * 1500, t);
    band.frequency.exponentialRampToValueAtTime(2500, t + 0.35);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.02);
    env.gain.setTargetAtTime(0, t + 0.08, 0.09);
    src.connect(band).connect(env).connect((sound.context as webaudio.WebAudioContext).destination);
    src.start(t, Math.random() * (src.buffer.duration - 0.6));
    src.stop(t + 0.6);
    src.addEventListener('ended', () => env.disconnect());
  }

  setVolume(volume: number, muted: boolean) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: this.volume, muted }));
    } catch {
      // not remembered, that's all
    }
    this.update();
  }

  /** Pause everything (game paused, window hidden or unfocused) or carry on. */
  setSuspended(suspended: boolean) {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    if (suspended) {
      sound.pauseAll();
      this.music.pause();
      this.theme.pause();
    } else {
      sound.resumeAll();
      if (this.musicWanted) this.playMusic();
      if (this.themeWanted) this.resumeTheme();
    }
  }

  /** Applies volume and config.audio levels; cheap, called every frame so tuning changes apply live. */
  update() {
    const v = this.muted ? 0 : this.volume;
    const effects = v * config.audio.effects;
    const music = v * config.audio.music * this.musicFade();
    const theme = v * config.audio.music * this.themeFade();
    const fall = v * config.audio.fall;
    const flame = v * config.audio.flame;
    if (effects !== this.applied.effects) sound.volumeAll = effects;
    if (music !== this.applied.music) this.music.volume = Math.min(1, Math.max(0, music));
    if (theme !== this.applied.theme) this.theme.volume = Math.min(1, Math.max(0, theme));
    if (fall !== this.applied.fall && this.fallBus) this.fallBus.gain.value = fall;
    if (flame !== this.applied.flame && this.flameBus) this.flameBus.gain.value = flame;
    this.applied = { effects, music, theme, fall, flame };
    const now = performance.now();
    for (const [f, setAt] of this.flames) if (now - setAt > FLAME_TIMEOUT_MS) f.stop();
  }

  /** The music's current level along its ramp; once `stopMusic` has faded it to 0, it's paused. */
  private musicFade(): number {
    const r = this.musicRamp;
    const k = Math.min(1, (performance.now() - r.start) / r.ms);
    const level = r.from + (r.to - r.from) * k;
    if (k >= 1 && r.to === 0 && !this.musicWanted && !this.musicUnlocking && !this.music.paused) this.music.pause();
    return level;
  }

  /** The level the music should be at: down between levels, silent under a `playOverMusic` sound. */
  private musicLevel() {
    if (this.musicHushed) return 0;
    return this.musicDucked ? config.audio.musicDucked : 1;
  }

  /** Glide the music from its current level to `to` over `ms`. */
  private rampMusic(to: number, ms: number) {
    this.musicRamp = { from: this.musicFade(), to, start: performance.now(), ms: Math.max(1, ms) };
  }

  /** 1 → 0 while the theme fades out after `stopTheme`; it's paused at 0. */
  private themeFade(): number {
    if (this.themeFadeStart === null) return 1;
    const k = Math.min(1, (performance.now() - this.themeFadeStart) / this.themeFadeMs);
    if (k >= 1) {
      this.themeFadeStart = null;
      this.theme.pause();
      return 1;
    }
    return 1 - k;
  }

  /**
   * The title screen showed up: its theme from the start, looped until `stopTheme`. Before the first
   * click / key press the browser doesn't allow it, so it starts then.
   */
  playTheme() {
    if (!this.themes.length) return;
    this.themeWanted = true;
    this.themeFadeStart = null;
    this.theme.currentTime = 0;
    if (!this.suspended) this.resumeTheme();
  }

  /** Fade the theme out over `fadeMs` (the title screen is left). */
  stopTheme(fadeMs: number) {
    if (!this.themeWanted) return;
    this.themeWanted = false;
    if (this.theme.paused) return;
    this.themeFadeStart = performance.now();
    this.themeFadeMs = Math.max(1, fadeMs);
  }

  private resumeTheme() {
    if (!this.theme.paused) return;
    this.theme
      .play()
      .then(() => {
        if (this.suspended || !this.themeWanted) this.theme.pause();
      })
      .catch(() => {}); // not allowed yet: the next click / key press tries again
  }

  private bus(ctx: AudioContext): GainNode {
    if (!this.fallBus) {
      this.fallBus = ctx.createGain();
      this.fallBus.gain.value = this.applied.fall;
      // into @pixi/sound's chain (analyser → compressor → speakers), like the effects
      this.fallBus.connect((sound.context as webaudio.WebAudioContext).destination);
    }
    return this.fallBus;
  }

  private flameOut(ctx: AudioContext): GainNode {
    if (!this.flameBus) {
      this.flameBus = ctx.createGain();
      this.flameBus.gain.value = this.applied.flame;
      this.flameBus.connect((sound.context as webaudio.WebAudioContext).destination);
    }
    return this.flameBus;
  }

  /** 2 s of white noise, and of sparse pops of it (a fire's crackle) */
  private noise(ctx: AudioContext) {
    if (!this.flameNoise) {
      const len = 2 * ctx.sampleRate;
      const hiss = ctx.createBuffer(1, len, ctx.sampleRate);
      const crackle = ctx.createBuffer(1, len, ctx.sampleRate);
      const h = hiss.getChannelData(0), c = crackle.getChannelData(0);
      let pop = 0;
      for (let i = 0; i < len; i++) {
        h[i] = Math.random() * 2 - 1;
        // ~40 pops a second, each a few ms of noise dying away
        if (Math.random() < 40 / ctx.sampleRate) pop = 0.3 + Math.random() * 0.7;
        c[i] = (Math.random() * 2 - 1) * pop;
        pop *= 0.995;
      }
      this.flameNoise = { hiss, crackle };
    }
    return this.flameNoise;
  }

  /** Start the background music, or carry on with it after `stopMusic`; otherwise nothing changes. */
  startMusic() {
    if (this.musicWanted) return;
    this.musicWanted = true;
    this.rampMusic(1, 0);
    if (!this.suspended) this.playMusic();
  }

  /** Turn the music down to config.audio.musicDucked over `ms` (a level is won); it plays on until `restoreMusic`. */
  duckMusic(ms: number) {
    if (!this.musicWanted) return;
    this.musicDucked = true;
    this.rampMusic(this.musicLevel(), ms);
  }

  /** After `duckMusic` / `playOverMusic`: back to full volume over `ms` (a new level). Otherwise nothing changes. */
  restoreMusic(ms: number) {
    if (!this.musicDucked && !this.musicHushed) return;
    this.musicDucked = false;
    this.musicHushed = false;
    if (this.musicWanted) this.rampMusic(1, ms);
  }

  /** Fade the music out over `fadeMs` and pause it (back to the title screen); `startMusic` carries on. */
  stopMusic(fadeMs: number) {
    if (!this.musicWanted) return;
    this.musicWanted = false;
    this.musicDucked = false;
    this.musicHushed = false;
    this.rampMusic(0, fadeMs);
  }

  private playMusic() {
    if (!this.tracks.length || !this.music.paused) return;
    if (!this.track) this.setTrack(this.tracks[0]);
    this.music
      .play()
      .then(() => {
        this.musicUnlocked = true;
        if (this.suspended) this.music.pause(); // paused while it was starting
      })
      .catch(() => {}); // not allowed yet: the next click / key press tries again
  }

  /**
   * Inside a click / key press: play the music muted for a moment so it's allowed to play later.
   * Until `startMusic` its level is 0 too, and `musicFade` pauses it should it keep playing anyway
   * (Safari has been heard to).
   */
  private unlockMusic() {
    if (this.musicUnlocked || this.musicUnlocking || !this.tracks.length) return;
    if (!this.track) this.setTrack(this.tracks[0]);
    this.musicUnlocking = true;
    this.music.muted = true;
    this.music
      .play()
      .then(() => (this.musicUnlocked = true))
      .catch(() => {})
      .finally(() => {
        this.musicUnlocking = false;
        if (!this.musicWanted || this.suspended) this.music.pause();
        this.music.muted = false;
      });
  }

  private setTrack(file: string) {
    this.track = file;
    this.music.src = url(file);
  }

  /** Several songs: the next one in order, back to the first after the last. */
  private nextTrack() {
    this.setTrack(this.tracks[(this.tracks.indexOf(this.track) + 1) % this.tracks.length]);
    if (this.musicWanted && !this.suspended) void this.music.play().catch(() => {});
  }
}

/** A fire's sound playing (`GameAudio.startFlame`). */
export interface FlameSound {
  /** stopped (or never started: no sound allowed then); a new one is needed */
  ended: boolean;
  /** how loud, 0–1: how far the fire is out */
  set(level: number): void;
  stop(): void;
}

/** a fire sound not `set` for this long stops */
const FLAME_TIMEOUT_MS = 250;

export const audio = new GameAudio();
