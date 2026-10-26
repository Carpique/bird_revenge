import { appleDef } from './apple';
import { birdDef } from './bird';
import { friendDefs } from './friend';
import { pooDef } from './poo';
import { villainDef } from './villain';
import type { CharacterDef } from './types';

export const allCharacters: CharacterDef[] = [birdDef, villainDef, pooDef, appleDef, ...Object.values(friendDefs)];
