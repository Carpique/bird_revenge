import { appleDef } from './apple';
import { batDef } from './bat';
import { birdDef } from './bird';
import { coinDef } from './coin';
import { friendDefs } from './friend';
import { batPooDef, pooDef } from './poo';
import { villainDef } from './villain';
import type { CharacterDef } from './types';

export const allCharacters: CharacterDef[] = [birdDef, villainDef, batDef, pooDef, batPooDef, appleDef, coinDef, ...Object.values(friendDefs)];
