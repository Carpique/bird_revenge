import { sound, type webaudio } from '@pixi/sound';
import files from 'virtual:audio-files';
import { config } from '../config';

/** Sound effect groups; each plays a random file of public/assets/audio/<group>-N.mp3 */
export type SfxGroup = 'shot' | 'splat' | 'bad-guy-dies' | 'score' | 'player-hit' | 'boing' | 'sad-audience' | 'friend';

const DIR = 'assets/audio/';
const STORAGE_KEY = 'pooping-birds-volume';

/** "splat-2.mp3" → "splat"; every "music-*" file is in the "music" group */
const groupOf = (file: string) => (file.startsWith('music-') ? 'music' : file.replace(/\.[^.]+$/, '').replace(/-\d+$/, ''));
const url = (file: string) => import.meta.env.BASE_URL + DIR + file;

/**
 * All game audio. Effects are decoded into memory by @pixi/sound so they play instantly; music is
 * streamed through an <audio> element (a whole song decoded would take ~60 MB). The falling-poo
 * tone is synthesised on @pixi/sound's AudioContext.
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
  /** the music element has played once inside a click / key press, so it may play later */
  private musicUnlocked = false;
  private suspended = false;
  private warned = new Set<string>();
  /** the falling-poo tones go through this, so volume changes reach tones already playing */
  private fallBus: GainNode | null = null;
  /** last levels applied (only push changes) */
  private applied = { effects: -1, music: -1, fall: -1 };

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
      if (g === 'music') {
        this.tracks.push(f);
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

    const unlock = () => {
      if (this.suspended) return;
      void sound.context.audioContext.resume();
      if (this.musicWanted) this.playMusic();
      else this.unlockMusic();
      if (this.musicUnlocked || !this.tracks.length) {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    this.update();
  }

  /** A random sound of `group`. */
  play(group: SfxGroup) {
    const list = this.groups.get(group);
    if (!list?.length) {
      if (!this.warned.has(group)) console.warn(`no sound files for "${group}" in public/${DIR}`);
      this.warned.add(group);
      return;
    }
    const alias = list[Math.floor(Math.random() * list.length)];
    // a sound still loading would otherwise play late, whenever it arrives
    if (sound.find(alias).isLoaded) sound.play(alias);
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
    } else {
      sound.resumeAll();
      if (this.musicWanted) this.playMusic();
    }
  }

  /** Applies volume and config.audio levels; cheap, called every frame so tuning changes apply live. */
  update() {
    const v = this.muted ? 0 : this.volume;
    const effects = v * config.audio.effects;
    const music = v * config.audio.music;
    const fall = v * config.audio.fall;
    if (effects !== this.applied.effects) sound.volumeAll = effects;
    if (music !== this.applied.music) this.music.volume = Math.min(1, Math.max(0, music));
    if (fall !== this.applied.fall && this.fallBus) this.fallBus.gain.value = fall;
    this.applied = { effects, music, fall };
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

  /** Start the background music (once; later calls do nothing). */
  startMusic() {
    if (this.musicWanted) return;
    this.musicWanted = true;
    if (!this.suspended) this.playMusic();
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

  /** Inside a click / key press: play the music muted for a moment so it's allowed to play later. */
  private unlockMusic() {
    if (this.musicUnlocked || !this.tracks.length) return;
    if (!this.track) this.setTrack(this.tracks[0]);
    this.music.muted = true;
    this.music
      .play()
      .then(() => {
        this.musicUnlocked = true;
        if (!this.musicWanted || this.suspended) this.music.pause();
      })
      .catch(() => {})
      .finally(() => (this.music.muted = false));
  }

  private setTrack(file: string) {
    this.track = file;
    this.music.src = url(file);
  }

  /** Several songs: the next one in order, back to the first after the last. */
  private nextTrack() {
    this.setTrack(this.tracks[(this.tracks.indexOf(this.track) + 1) % this.tracks.length]);
    if (!this.suspended) void this.music.play().catch(() => {});
  }
}

export const audio = new GameAudio();
