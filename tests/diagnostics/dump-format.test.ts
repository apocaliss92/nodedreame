import { describe, it, expect } from 'vitest';
import { DeviceDumpSchema, type DeviceDump } from '../../src/diagnostics/dump-format.js';

function goodDump(): DeviceDump {
  return {
    schemaVersion: 1,
    library: 'nodedreame',
    libraryVersion: '1.3.0',
    device: { model: 'dreame.vacuum.r2532a', firmware: '4.3.9', region: 'eu', type: 'vacuum' },
    observations: {
      properties: {
        '2.1': {
          values: [6, 2],
          unmapped: [],
          enum: 'MiotState',
          count: 2,
          firstSeen: 1000,
          lastSeen: 2000,
        },
        '4.1': { values: [99], unmapped: [99], count: 1, firstSeen: 1500, lastSeen: 1500 },
      },
      events: [{ at: 1700, type: '4.1', data: { arguments: [] } }],
    },
    catalog: {
      commands: [{ name: 'START', siid: 2, aiid: 1 }],
      capabilities: { tokens: ['mop', 'auto-empty'] },
    },
    meta: { startedAt: 1000, durationMs: 1000, generatedAt: 2100 },
  };
}

describe('DeviceDumpSchema', () => {
  it('validates a well-formed dump', () => {
    const parsed = DeviceDumpSchema.safeParse(goodDump());
    expect(parsed.success).toBe(true);
  });

  it('accepts the optional rawFrames + sensors fields', () => {
    const d = goodDump();
    const withOptional: DeviceDump = {
      ...d,
      observations: {
        ...d.observations,
        rawFrames: [{ at: 1, source: 'mqtt:event', payload: { siid: 4 } }],
      },
      catalog: { ...d.catalog, sensors: [{ model: 'WH40', channel: 1 }] },
    };
    expect(DeviceDumpSchema.safeParse(withOptional).success).toBe(true);
  });

  it('rejects a wrong schemaVersion', () => {
    const bad = { ...goodDump(), schemaVersion: 2 };
    expect(DeviceDumpSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-enum library value', () => {
    const bad = { ...goodDump(), library: 'nodefoo' };
    expect(DeviceDumpSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a property observation missing count', () => {
    const d = goodDump();
    const bad = {
      ...d,
      observations: {
        ...d.observations,
        properties: { '2.1': { values: [6], unmapped: [], firstSeen: 1, lastSeen: 2 } },
      },
    };
    expect(DeviceDumpSchema.safeParse(bad).success).toBe(false);
  });
});
