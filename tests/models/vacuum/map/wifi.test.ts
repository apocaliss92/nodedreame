import { describe, it, expect } from 'vitest';
import { decodeWifiSignalMap, renderWifiSignalPng } from '../../../../src/models/vacuum/map/wifi.js';

const HEADER_SIZE = 27;
const FRAME_W = 87; // 'W'

/** Build a synthetic inflated Wi-Fi frame: 27-byte header + width*height grid. */
function frame(opts: {
  width: number;
  height: number;
  gridSize: number;
  left: number;
  top: number;
  robotX: number;
  robotY: number;
  cells: number[]; // nibbles, row-major
}): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE + opts.width * opts.height);
  buf.writeInt16LE(1, 0); // mapId
  buf.writeInt16LE(1, 2); // frameId
  buf[4] = FRAME_W;
  buf.writeInt16LE(opts.robotX, 5);
  buf.writeInt16LE(opts.robotY, 7);
  buf.writeInt16LE(0, 9); // robotA
  buf.writeInt16LE(opts.robotX, 11); // chargerX (reuse)
  buf.writeInt16LE(opts.robotY, 13); // chargerY
  buf.writeInt16LE(0, 15);
  buf.writeInt16LE(opts.gridSize, 17);
  buf.writeInt16LE(opts.width, 19);
  buf.writeInt16LE(opts.height, 21);
  buf.writeInt16LE(opts.left, 23);
  buf.writeInt16LE(opts.top, 25);
  for (let i = 0; i < opts.cells.length; i++) buf[HEADER_SIZE + i] = opts.cells[i]!;
  return buf;
}

describe('decodeWifiSignalMap', () => {
  it('maps nibbles to signal bars and samples the robot cell', () => {
    // 3x2 grid, 100mm cells, origin (0,0). Robot at world (150,50) => col1,row0.
    const cells = [
      10, 14, 11, // row0: unreached, 4 bars, 1 bar
      12, 13, 0, //  row1: 2 bars, 3 bars, no-data
    ];
    const m = decodeWifiSignalMap(
      frame({ width: 3, height: 2, gridSize: 100, left: 0, top: 0, robotX: 150, robotY: 50, cells }),
    );
    expect(m.dimensions).toEqual({ left: 0, top: 0, width: 3, height: 2, gridSize: 100 });
    expect(m.robot).toEqual({ x: 150, y: 50, angle: 0 });
    // world (150,50) -> col=1,row=0 -> nibble 14 -> 4 bars
    expect(m.currentSignal).toBe(4);
    expect(m.signalAt(50, 50)).toBe(0); // col0,row0 = 10 unreached
    expect(m.signalAt(250, 50)).toBe(1); // col2,row0 = 11 -> 1 bar
    expect(m.signalAt(150, 150)).toBe(3); // col1,row1 = 13 -> 3 bars
    expect(m.signalAt(250, 150)).toBeNull(); // nibble 0 = no wifi data
    expect(m.signalAt(9999, 9999)).toBeNull(); // off-map
  });

  it('reports null robot/currentSignal when the header pose is absent (0,0)', () => {
    const m = decodeWifiSignalMap(
      frame({ width: 2, height: 1, gridSize: 100, left: 0, top: 0, robotX: 0, robotY: 0, cells: [12, 13] }),
    );
    expect(m.robot).toBeNull();
    expect(m.currentSignal).toBeNull();
  });

  it('renders a PNG heatmap', () => {
    const m = decodeWifiSignalMap(
      frame({ width: 2, height: 2, gridSize: 100, left: 0, top: 0, robotX: 50, robotY: 50, cells: [10, 14, 11, 12] }),
    );
    const png = renderWifiSignalPng(m, { scale: 3 });
    expect(png.length).toBeGreaterThan(8);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG'); // PNG signature
  });
});
