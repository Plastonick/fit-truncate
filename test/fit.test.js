import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrcCalculator, Decoder, Stream } from '@garmin/fitsdk';
import { inspectFit, selectedEntries, truncateFit } from '../src/fit.js';

const u32 = (number, little = true) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, number, little);
  return [...bytes];
};

function fitFile(records, headerSize = 14) {
  const data = records.flat();
  const bytes = new Uint8Array(headerSize + data.length + 2);
  bytes.set([headerSize, 0x20, 0, 8, ...u32(data.length), 46, 70, 73, 84]);
  const view = new DataView(bytes.buffer);
  if (headerSize === 14) view.setUint16(12, CrcCalculator.calculateCRC(bytes, 0, 12), true);
  bytes.set(data, headerSize);
  view.setUint16(bytes.length - 2, CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2), true);
  return bytes;
}

const deviceDefinition = [0x40, 0, 0, 23, 0, 2, 253, 4, 0x86, 0, 1, 2];
const device = (timestamp, index) => [0, ...u32(timestamp), index];
const recordDefinition = [0x41, 0, 0, 20, 0, 2, 253, 4, 0x86, 3, 1, 2];
const record = (timestamp, heartRate) => [1, ...u32(timestamp), heartRate];
const valid = (bytes) => new Decoder(Stream.fromArrayBuffer(bytes.buffer)).checkIntegrity();
const retainedBytes = (file) => {
  let cursor = file.headerSize;
  const parts = [];
  for (const entry of file.devices) {
    parts.push(...file.bytes.subarray(cursor, entry.start));
    cursor = entry.end;
  }
  parts.push(...file.bytes.subarray(cursor, -2));
  return parts;
};

test('no changes produce an identical copy', () => {
  const bytes = fitFile([deviceDefinition, device(100, 1)]);
  assert.deepEqual(truncateFit(inspectFit(bytes), []), bytes);
});

test('inclusive overlapping ranges preserve numbering and count entries once', () => {
  assert.deepEqual([...selectedEntries(8, [{ from: 2, to: 4 }, { from: 3, to: 6 }])], [2, 3, 4, 5, 6]);
  for (const [from, to] of [[0, 2], [2, 1], [1, 9], [1.5, 2], [NaN, 2]]) {
    assert.throws(() => selectedEntries(8, [{ from, to }]), /whole-number range/);
  }
});

test('removes only selected device messages and preserves interleaved activity bytes', () => {
  const file = inspectFit(fitFile([
    deviceDefinition, device(100, 0), recordDefinition, record(101, 130),
    device(101, 1), device(102, 2), record(102, 140), device(103, 3),
  ]));
  const output = truncateFit(file, [{ from: 2, to: 3 }]);
  assert.ok(valid(output));
  const edited = inspectFit(output);
  assert.deepEqual(edited.devices.map(({ message }) => message.deviceIndex), ['creator', 3]);
  assert.deepEqual(edited.messages.recordMesgs, file.messages.recordMesgs);
  assert.deepEqual(retainedBytes(edited), retainedBytes(file));
  assert.equal(output.length, file.bytes.length - 12);
});

test('26,000 alternating entries can be removed while preserving genuine entries at both ends', () => {
  const records = [deviceDefinition, device(90, 0), device(91, 3)];
  for (let i = 0; i < 26000; i++) records.push(device(100 + Math.floor(i / 2), i % 2 + 1));
  records.push(device(14000, 4), device(14001, 5));
  const file = inspectFit(fitFile(records));
  assert.equal(file.devices.length, 26004);
  const edited = inspectFit(truncateFit(file, [{ from: 3, to: 26002 }]));
  assert.deepEqual(edited.devices.map(({ message }) => message.deviceIndex), ['creator', 3, 4, 5]);
  assert.deepEqual(edited.devices.map(({ start, end }) => [...edited.bytes.subarray(start, end)]),
    [0, 1, 26002, 26003].map((index) => [...file.bytes.subarray(file.devices[index].start, file.devices[index].end)]));
});

test('supports 12-byte headers and removing every device entry', () => {
  const file = inspectFit(fitFile([deviceDefinition, device(100, 1), device(101, 2)], 12));
  const output = truncateFit(file, [{ from: 1, to: 2 }]);
  assert.ok(valid(output));
  assert.equal(inspectFit(output).devices.length, 0);
});

test('preserves unknown fields, unknown messages, developer bytes, and redefined big-endian records', () => {
  // Developer bytes deliberately have no field_description; preserving the raw
  // records must retain them even though the SDK cannot display their meaning.
  const developerDevice = [0x60, 0, 0, 23, 0, 3, 253, 4, 0x86, 0, 1, 2, 200, 2, 0x84, 1, 0, 3, 0];
  const unknownDefinition = [0x42, 0, 0, 0, 255, 1, 1, 3, 13];
  const bigEndianDevice = [0x40, 0, 1, 0, 23, 2, 253, 4, 0x86, 0, 1, 2];
  const file = inspectFit(fitFile([
    developerDevice, [0, ...u32(100), 1, 17, 18, 19, 20, 21],
    unknownDefinition, [2, 91, 92, 93],
    [0, ...u32(101), 2, 22, 23, 24, 25, 26],
    bigEndianDevice, [0, ...u32(102, false), 3],
  ]));
  const edited = inspectFit(truncateFit(file, [{ from: 2, to: 2 }]));
  assert.deepEqual(retainedBytes(edited), retainedBytes(file));
  assert.deepEqual(edited.devices.map(({ message }) => message), [file.devices[0].message, file.devices[2].message]);
  assert.equal(file.messages['65280'].length, 1);
  assert.deepEqual(edited.messages['65280'], file.messages['65280']);
});

test('handles a file without device entries', () => {
  const bytes = fitFile([recordDefinition, record(100, 120)]);
  const file = inspectFit(bytes);
  assert.equal(file.devices.length, 0);
  assert.deepEqual(truncateFit(file, []), bytes);
});

test('rejects non-FIT, damaged, truncated, and chained files', () => {
  assert.throws(() => inspectFit(new Uint8Array(0)), /Choose a FIT/);
  const good = fitFile([deviceDefinition, device(100, 1)]);
  const damaged = good.slice();
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => inspectFit(damaged), /integrity check/);
  assert.throws(() => inspectFit(good.subarray(0, -1)), /incomplete/);
  const chained = new Uint8Array(good.length * 2);
  chained.set(good);
  chained.set(good, good.length);
  assert.throws(() => inspectFit(chained), /chained/);
  assert.throws(() => inspectFit(fitFile([[0, 1]])), /Could not read/);
});

test('rejects compressed timestamps rather than exporting potentially shifted timestamps', () => {
  const bytes = fitFile([deviceDefinition, device(100, 1), [0x85, 2]]);
  assert.throws(() => inspectFit(bytes), /compressed timestamps/);
});
