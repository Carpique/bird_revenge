import configSource from '../src/config.ts?raw';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { parseConfigDocs } from '../src/ui/configDocs';

describe('config docs for the tuning panel tooltips', () => {
  const docs = parseConfigDocs(configSource);

  it('reads one-line, multi-line and section comments', () => {
    expect(docs['flap.velocityDeadzone']).toBe('downward arm angular speed (deg/s) below which nothing happens');
    expect(docs['tilt.holdDrag']).toMatch(/^hovering \(arms held out, .* keeps its altitude$/);
    expect(docs['tilt']).toMatch(/^Tilting the arms/);
    expect(docs['smoothing']).toMatch(/^One-Euro filter/);
  });

  it('only documents options that exist, and skips undocumented ones', () => {
    for (const path of Object.keys(docs)) {
      let obj: unknown = config;
      for (const k of path.split('.')) obj = (obj as Record<string, unknown>)[k];
      expect(obj, path).not.toBeUndefined();
    }
    expect(docs['flap.maxLiftAccel']).toBeUndefined();
  });
});
