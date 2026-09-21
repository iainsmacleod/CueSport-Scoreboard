#!/usr/bin/env node
/**
 * Unit tests for impromptu (dockless) tables: schema, quota, create, sweep exemption.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuesport-impromptu-'));
process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
process.env.ALLOW_DEV_AUTH = 'true';
process.env.DEV_AUTH_SECRET = 'impromptu-unit-test-secret';
process.env.ACCOUNT_FINGERPRINT_SECRET = 'impromptu-fingerprint-secret';

let failed = 0;
function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  const sqlite = await import('../src/db/sqlite.js');
  const quotas = await import('../src/quotas.js');

  const { account } = sqlite.ensureAccount('impromptu@example.com', 'auth-impromptu-test');
  assert('account created', !!account?.id);

  const room = sqlite.createImpromptuRoom(account.id, 'Side Game');
  assert('createImpromptuRoom returns row', !!room?.id);
  assert('room kind is impromptu', room.kind === 'impromptu');
  assert('room label set', room.label === 'Side Game');
  assert('no room_docks row', !sqlite.getDb().prepare('SELECT 1 FROM room_docks WHERE room_id = ?').get(room.id));
  assert('impromptu usage count 1', sqlite.countImpromptuRoomsForAccount(account.id) === 1);
  assert('dock room count still 0', sqlite.countDockRoomsForAccount(account.id) === 0);

  const unmapped = sqlite.listUnmappedRooms();
  assert('impromptu not listed as unmapped dock junk', !unmapped.some((r) => r.id === room.id));

  const live = sqlite.getRoomsWithLiveState(account.id);
  assert('live list includes impromptu', live.some((r) => r.id === room.id && r.kind === 'impromptu'));

  const token = sqlite.createGuestToken(room.id, account.id, 'Guest scorer');
  assert('guest token created', !!token);

  const quota = quotas.getAccountQuota(account);
  assert('quota tracks impromptu usage', (quota.usage.impromptuTables || 0) === 1);
  assert('self-host unrestricted impromptu', quota.limits.maxImpromptuTables == null);

  sqlite.deleteRoom(room.id);
  assert('delete frees seat', sqlite.countImpromptuRoomsForAccount(account.id) === 0);
  assert('guest tokens cascaded', sqlite.countActiveGuestTokensForRoom(room.id) === 0);

  // Authority command: destroy_table discards and closes (frees seat via session discard).
  const { applyImpromptuCommand, createDefaultImpromptuState } = await import('../web/shared/impromptu-authority.js');
  const base = createDefaultImpromptuState({ player1Name: 'A', player2Name: 'B' });
  const destroyed = applyImpromptuCommand(base, 'destroy_table', {});
  assert('destroy_table closes table', destroyed.closeTable === true);
  assert(
    'destroy_table emits discard',
    (destroyed.sessionEvents || []).some((ev) => ev.action === 'discard' && ev.payload?.reason === 'abandon_match'),
  );
  assert('destroy_table does not emit end', !(destroyed.sessionEvents || []).some((ev) => ev.action === 'end'));

  const fresh = createDefaultImpromptuState({ player1Name: 'A', player2Name: 'B' });
  assert('default awaits breaker', fresh.awaitingBreaker === true && fresh.playerSlotMode === 'breaker');
  const afterBreaker = applyImpromptuCommand(fresh, 'select_breaker', { slot: '2' });
  assert(
    'select_breaker clears await',
    afterBreaker.state.awaitingBreaker === false
      && afterBreaker.state.playerSlotMode === 'active'
      && afterBreaker.state.rackBreakerSlot === '2'
      && afterBreaker.state.activePlayer === '2',
  );
  const afterRack = applyImpromptuCommand(afterBreaker._private, 'score_add', { player: '2' });
  assert(
    'score_add re-prompts breaker',
    afterRack.state.awaitingBreaker === true
      && afterRack.state.playerSlotMode === 'breaker'
      && !afterRack.state.rackBreakerSlot,
  );

  // Snooker: colors re-spot after red → color (not permanently faded).
  let snooker = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  snooker = applyImpromptuCommand(snooker, 'select_breaker', { slot: '1' })._private;
  const afterRed = applyImpromptuCommand(snooker, 'snooker_ball', { ballId: 'ball 1' });
  assert('red sets color phase', afterRed.state.snookerPhase === 'color' && afterRed.state.snookerRedsPotted === 1);
  const blackAfterRed = (afterRed.state.ballGrid?.balls || []).find((b) => b.id === 'ball 7');
  assert('black enabled after red', blackAfterRed && !blackAfterRed.disabled && !blackAfterRed.faded);
  const afterBlack = applyImpromptuCommand(afterRed._private, 'snooker_ball', { ballId: 'ball 7' });
  assert('color returns to red phase', afterBlack.state.snookerPhase === 'red');
  assert('points for red+black', afterBlack.state.p1Balls === 8);
  const blackRespot = (afterBlack.state.ballGrid?.balls || []).find((b) => b.id === 'ball 7');
  assert(
    'black re-enabled after color pot',
    blackRespot && !blackRespot.faded && blackRespot.disabled === true,
    `faded=${blackRespot?.faded} disabled=${blackRespot?.disabled}`,
  );
  const redAgain = (afterBlack.state.ballGrid?.balls || []).find((b) => b.id === 'ball 1');
  assert('red enabled again', redAgain && !redAgain.disabled && !redAgain.faded);

  // Clearance: after 15 reds + color, yellow stays down.
  let clear = afterBlack._private;
  for (let i = 0; i < 14; i += 1) {
    clear = applyImpromptuCommand(clear, 'snooker_ball', { ballId: 'ball 1' })._private;
    clear = applyImpromptuCommand(clear, 'snooker_ball', { ballId: 'ball 2' })._private;
  }
  assert('15 reds potted', clear.snookerRedsPotted === 15 && clear._snookerPhase === 'red');
  const yellowOnly = (clear.ballGrid?.balls || []).find((b) => b.id === 'ball 2');
  const greenLocked = (clear.ballGrid?.balls || []).find((b) => b.id === 'ball 3');
  assert('clearance enables yellow', yellowOnly && !yellowOnly.disabled && !yellowOnly.faded);
  assert('clearance locks green', greenLocked && greenLocked.disabled);
  const afterYellow = applyImpromptuCommand(clear, 'snooker_ball', { ballId: 'ball 2' });
  const yellowDown = (afterYellow.state.ballGrid?.balls || []).find((b) => b.id === 'ball 2');
  const greenNext = (afterYellow.state.ballGrid?.balls || []).find((b) => b.id === 'ball 3');
  assert('yellow stays cleared', yellowDown && yellowDown.faded && yellowDown.disabled);
  assert('green next in clearance', greenNext && !greenNext.disabled && !greenNext.faded);

  // Snooker free ball only after foul + player change.
  let free = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  free = applyImpromptuCommand(free, 'select_breaker', { slot: '1' })._private;
  const freeBefore = (free.ballGrid?.balls || []).find((b) => b.id === 'ball 10');
  assert('free ball disabled initially', freeBefore && freeBefore.disabled);
  const rejectFree = applyImpromptuCommand(free, 'snooker_ball', { ballId: 'ball 10' });
  assert('free ball rejected without foul', rejectFree.publish === false && rejectFree.state.p1Balls === 0);
  const afterFoul = applyImpromptuCommand(free, 'snooker_foul', { foulKey: 'ball_7' });
  assert('snooker foul awards min 4 / black 7', afterFoul.state.p2Balls === 7 && afterFoul.state.foulsP1 === 1);
  const freeAfterFoul = (afterFoul.state.ballGrid?.balls || []).find((b) => b.id === 'ball 10');
  assert('free ball still disabled until player change', freeAfterFoul && freeAfterFoul.disabled);
  assert('free ball not offered yet', afterFoul.state.snookerFreeBallOffered !== true);
  const afterSwitch = applyImpromptuCommand(afterFoul._private, 'toggle_active_player', { isP1: false });
  assert('free ball offered after switch', afterSwitch.state.snookerFreeBallOffered === true);
  const freeReady = (afterSwitch.state.ballGrid?.balls || []).find((b) => b.id === 'ball 10');
  assert('free ball enabled after switch', freeReady && !freeReady.disabled);
  const afterFree = applyImpromptuCommand(afterSwitch._private, 'snooker_ball', { ballId: 'ball 10' });
  assert('free ball scores 1 in reds', afterFree.state.p2Balls === 8 && afterFree.state.snookerPhase === 'color');
  assert('free ball cleared after pot', afterFree.state.snookerFreeBallOffered !== true);

  // Undo restores snooker phase.
  const undone = applyImpromptuCommand(afterBlack._private, 'undo', {});
  assert('undo restores color phase', undone.state.snookerPhase === 'color' && undone.state.p1Balls === 1);

  // Bank: pot awards ball; respot unfades without score change; first to 8 awards rack.
  let bank = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game5',
  });
  bank = applyImpromptuCommand(bank, 'select_breaker', { slot: '1' })._private;
  const respotIdle = (bank.ballGrid?.balls || []).find((b) => b.id === 'poolRespotBtn');
  assert('bank respot visible but disabled empty', respotIdle && !respotIdle.hidden && respotIdle.disabled);
  const pot1 = applyImpromptuCommand(bank, 'toggle_pot', { ballId: 'ball 1' });
  assert('bank pot awards ball', pot1.state.p1Balls === 1 && pot1.state.p1Score === 0);
  const faded1 = (pot1.state.ballGrid?.balls || []).find((b) => b.id === 'ball 1');
  const respotReady = (pot1.state.ballGrid?.balls || []).find((b) => b.id === 'poolRespotBtn');
  assert('bank ball faded', faded1 && faded1.faded);
  assert('bank respot enabled with faded', respotReady && !respotReady.disabled);
  const respot = applyImpromptuCommand(pot1._private, 'respot_ball', { ballId: 'ball 1' });
  assert(
    'bank respot keeps score',
    respot.state.p1Balls === 1
      && !(respot.state.ballGrid?.balls || []).find((b) => b.id === 'ball 1')?.faded,
  );
  let bankRun = pot1._private;
  for (let i = 2; i <= 8; i += 1) {
    bankRun = applyImpromptuCommand(bankRun, 'toggle_pot', { ballId: `ball ${i}` })._private;
  }
  assert(
    'bank first-to-8 awards rack',
    bankRun.p1Score === 1 && bankRun.p1Balls === 0 && bankRun.p2Balls === 0
      && bankRun.awaitingBreaker === true,
    `score=${bankRun.p1Score} balls=${bankRun.p1Balls} await=${bankRun.awaitingBreaker}`,
  );

  // One Pocket foul: −1 balls and switch active player.
  let op = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game6',
  });
  op = applyImpromptuCommand(op, 'select_breaker', { slot: '1' })._private;
  op = applyImpromptuCommand(op, 'toggle_pot', { ballId: 'ball 3' })._private;
  const opFoul = applyImpromptuCommand(op, 'pool_foul', {});
  assert(
    'one-pocket foul deducts ball and switches',
    opFoul.state.p1Balls === 0
      && opFoul.state.foulsP1 === 1
      && opFoul.state.activePlayer === '2',
  );

  // Straight Pool: pot awards primary score.
  let straight = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game4',
  });
  straight = applyImpromptuCommand(straight, 'select_breaker', { slot: '1' })._private;
  const stPot = applyImpromptuCommand(straight, 'toggle_pot', { ballId: 'ball 5' });
  assert('straight pot +1 primary', stPot.state.p1Score === 1);
  const stFoul = applyImpromptuCommand(stPot._private, 'pool_foul', {});
  assert(
    'straight foul −1 primary and switches',
    stFoul.state.p1Score === 0 && stFoul.state.activePlayer === '2' && stFoul.state.foulsP1 === 1,
  );

  // Grid sizes: 9-ball / 10-ball / 8-ball object counts.
  function objectBalls(gt) {
    const s = createDefaultImpromptuState({ player1Name: 'A', player2Name: 'B', gameType: gt });
    return (s.ballGrid?.balls || []).filter((b) => /^ball \d+$/.test(b.id)).length;
  }
  assert('8-ball grid has 15', objectBalls('game1') === 15);
  assert('9-ball grid has 9', objectBalls('game2') === 9);
  assert('10-ball grid has 10', objectBalls('game3') === 10);
  const eight = createDefaultImpromptuState({ player1Name: 'A', player2Name: 'B', gameType: 'game1' });
  const eightRespot = (eight.ballGrid?.balls || []).find((b) => b.id === 'poolRespotBtn');
  assert('8-ball hides respot', eightRespot && eightRespot.hidden);

  // Pool fade toggle (no auto rack on game ball for impromptu — documented).
  let nine = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game2',
  });
  nine = applyImpromptuCommand(nine, 'select_breaker', { slot: '1' })._private;
  const ninePot = applyImpromptuCommand(nine, 'toggle_pot', { ballId: 'ball 9' });
  assert(
    '9-ball game-ball fade does not auto-rack',
    ninePot.state.p1Score === 0
      && (ninePot.state.ballGrid?.balls || []).find((b) => b.id === 'ball 9')?.faded === true,
  );

  // Simulated paid tier: assertCanCreateImpromptuTable respects maxImpromptuTables
  process.env.ALLOW_DEV_AUTH = 'false';
  // Re-import won't reload env in quotas (already loaded). Directly exercise catalog limits.
  const streamerLimits = quotas.getTierLimits('streamer');
  assert('streamer has maxImpromptuTables', streamerLimits.maxImpromptuTables === 2);
  const toLimits = quotas.getTierLimits('tournament_organizer');
  assert('tournament organizer has maxImpromptuTables', toLimits.maxImpromptuTables === 5);
} catch (err) {
  failed += 1;
  console.error('FAIL suite error', err);
} finally {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll impromptu unit checks passed');
