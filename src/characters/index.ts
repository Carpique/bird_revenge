import { appleDef, glueDef } from './apple';
import { batDef, homingBatDef } from './bat';
import { birdDef } from './bird';
import { coinDef } from './coin';
import { friendDefs } from './friend';
import { batPooDef, pooDef } from './poo';
import { ghostDef, villainDef } from './villain';
import type { CharacterDef } from './types';

export const allCharacters: CharacterDef[] = [birdDef, villainDef, ghostDef, batDef, homingBatDef, pooDef, batPooDef, appleDef, glueDef, coinDef, ...Object.values(friendDefs)];
