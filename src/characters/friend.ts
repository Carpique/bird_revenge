import type { FriendKind } from '../level/types';
import type { CharacterDef } from './types';

/**
 * Friends: little animals guarded by the villain, saved by flying into them. One entry per kind.
 * The anchor is the image's centre (a saved friend grows upwards from its feet); levels place a friend by its feet.
 */
export const friendDefs = {
  bunny: {
    id: 'bunny',
    displayHeight: 64,
    anchor: { x: 0.5, y: 0.5 },
    facing: 'right',
    animations: {
      idle: { frames: ['assets/friend/bunny/idle.svg'], fps: 1 },
      blink: { frames: ['assets/friend/bunny/blink.svg'], fps: 1 },
      twitch: { frames: ['assets/friend/bunny/twitch.svg'], fps: 1 },
    },
    defaultAnimation: 'idle',
  },
} satisfies Record<FriendKind, CharacterDef<FriendAnim>>;

/** A friend sits still (`idle`), now and then blinking or twitching an ear. */
export type FriendAnim = 'idle' | 'blink' | 'twitch';

/**
 * Each friend fidgets on its own clock: after a random wait it blinks or twitches for a moment.
 * ms; `twitchChance` is the share of fidgets that are ear twitches.
 */
export const friendFidget = { minWaitMs: 1200, maxWaitMs: 4500, blinkMs: 150, twitchMs: 450, twitchChance: 0.35 };

/** Distance (px) from a friend's centre within which the bird's body saves it. */
export const friendRadius: Record<FriendKind, number> = { bunny: 24 };
