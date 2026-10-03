#!/usr/bin/env node
/**
 * Unit: mergeRackTimingFromPrevious preserves duration when editors omit timing.
 */
import { mergeRackTimingFromPrevious } from '../src/api/events.js';

let failed = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const previous = [
  {
    rackNumber: 1,
    winnerSlot: '1',
    startedAt: '2026-09-01T12:00:00.000Z',
    timestamp: '2026-09-01T12:05:00.000Z',
    durationSeconds: 300,
  },
  {
    rackNumber: 2,
    winnerSlot: '2',
    startedAt: '2026-09-01T12:05:00.000Z',
    timestamp: '2026-09-01T12:12:00.000Z',
    durationSeconds: 420,
  },
];

const incomingNoTiming = [
  { rackNumber: 1, winnerSlot: '1', foulsP1: 0, foulsP2: 0 },
  { rackNumber: 2, winnerSlot: '1', foulsP1: 0, foulsP2: 1 },
];

const merged = mergeRackTimingFromPrevious(incomingNoTiming, previous);
assert('merge copies durationSeconds by index', Number(merged[0].durationSeconds) === 300 && Number(merged[1].durationSeconds) === 420);
assert('merge copies startedAt/timestamp', merged[0].startedAt === previous[0].startedAt && merged[0].timestamp === previous[0].timestamp);
assert('merge keeps edited winnerSlot', merged[1].winnerSlot === '1');

const incomingWithTiming = [
  {
    rackNumber: 1,
    winnerSlot: '1',
    durationSeconds: 111,
    startedAt: '2026-09-02T10:00:00.000Z',
    timestamp: '2026-09-02T10:01:51.000Z',
  },
  { rackNumber: 2, winnerSlot: '2' },
];
const mergedPreferIncoming = mergeRackTimingFromPrevious(incomingWithTiming, previous);
assert(
  'merge prefers incoming duration when present',
  Number(mergedPreferIncoming[0].durationSeconds) === 111,
  String(mergedPreferIncoming[0].durationSeconds),
);
assert(
  'merge fills missing timing on later racks',
  Number(mergedPreferIncoming[1].durationSeconds) === 420,
  String(mergedPreferIncoming[1]?.durationSeconds),
);

assert('merge empty previous is passthrough', mergeRackTimingFromPrevious(incomingNoTiming, null)[0].durationSeconds == null);
assert('merge empty incoming returns empty', Array.isArray(mergeRackTimingFromPrevious([], previous)) && mergeRackTimingFromPrevious([], previous).length === 0);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll rack-timing unit tests passed.');
