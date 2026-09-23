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

  sqlite.setAccountSimulatedPlan(account.id, 'streamer');
  const simAccount = sqlite.getAccountById(account.id);
  const simQuota = quotas.getAccountQuota(simAccount);
  assert('self-host simulated streamer caps ad-hoc', simQuota.limits.maxImpromptuTables === 2);
  assert('self-host simulated clears unrestricted flag', simQuota.self_host_unrestricted === false);
  assert(
    'self-host simulated assertCanCreate still ok under limit',
    quotas.assertCanCreateImpromptuTable(simAccount).ok === true,
  );
  const room2 = sqlite.createImpromptuRoom(account.id, 'Second');
  const room3 = sqlite.createImpromptuRoom(account.id, 'Third');
  assert('created second and third for limit test', !!room2?.id && !!room3?.id);
  const overAccount = sqlite.getAccountById(account.id);
  const overCheck = quotas.assertCanCreateImpromptuTable(overAccount);
  assert('self-host simulated streamer blocks 3rd ad-hoc', overCheck.ok === false && overCheck.code === 'impromptu_table_limit');
  sqlite.deleteRoom(room2.id);
  sqlite.deleteRoom(room3.id);
  sqlite.setAccountSimulatedPlan(account.id, null);
  const resetQuota = quotas.getAccountQuota(sqlite.getAccountById(account.id));
  assert('self-host reset to unrestricted', resetQuota.self_host_unrestricted === true && resetQuota.limits.maxImpromptuTables == null);

  sqlite.deleteRoom(room.id);
  assert('delete frees seat', sqlite.countImpromptuRoomsForAccount(account.id) === 0);
  assert('guest tokens cascaded', sqlite.countActiveGuestTokensForRoom(room.id) === 0);

  // Authority command: destroy_table discards and closes (frees seat via session discard).
  const { applyImpromptuCommand, createDefaultImpromptuState, hydrateAuthorityState } = await import('../web/shared/impromptu-authority.js');
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

  // Leaving Snooker must drop snooker ball art (dock applyGameTypeChange parity).
  let snookerToEight = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  snookerToEight = applyImpromptuCommand(snookerToEight, 'set_game_type', { gameType: 'game1' })._private;
  assert(
    'snooker→8-ball clears snooker ballSelection',
    snookerToEight.gameType === 'game1' && snookerToEight.ballSelection === 'american',
    `gt=${snookerToEight.gameType} sel=${snookerToEight.ballSelection}`,
  );
  const eightBall1 = (snookerToEight.ballGrid?.balls || []).find((b) => b.id === 'ball 1');
  const eightBall10 = (snookerToEight.ballGrid?.balls || []).find((b) => b.id === 'ball 10');
  assert(
    'snooker→8-ball shows pool ball art',
    eightBall1 && eightBall1.file === '1ball_small.png'
      && eightBall10 && eightBall10.file === '10ball_small.png'
      && !(snookerToEight.ballGrid?.balls || []).some((b) => b.freeball || b.file?.includes('snooker-')),
    `file1=${eightBall1?.file} file10=${eightBall10?.file}`,
  );
  const eightGridCount = (snookerToEight.ballGrid?.balls || []).filter((b) => /^ball \d+$/.test(b.id)).length;
  assert('snooker→8-ball has 15 object balls', eightGridCount === 15, `count=${eightGridCount}`);

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
  assert(
    'snooker current break after red+black',
    afterBlack.state.snookerCurrentBreak === 8
      && afterBlack.state.ballGrid?.snookerCurrentBreak === 8,
    `break=${afterBlack.state.snookerCurrentBreak}`,
  );
  const breakBalls = afterBlack.state.snookerBreakBalls || [];
  assert(
    'snooker break ball chips',
    breakBalls.length === 2
      && breakBalls[0]?.key === 'red' && breakBalls[0]?.count === 1
      && breakBalls[1]?.key === 'black' && breakBalls[1]?.count === 1,
    JSON.stringify(breakBalls),
  );
  // Full table remaining at start of frame: 15×8 + 27 = 147; after red+black still 14 reds → 14×8+27=139.
  assert(
    'snooker points remaining after red+black',
    afterBlack.state.snookerPointsRemaining === 139
      && afterBlack.state.snookerScoreMargin?.remaining === 139
      && afterBlack.state.snookerScoreMargin?.diff === 8
      && afterBlack.state.snookerScoreMargin?.display === '+8',
    `remaining=${afterBlack.state.snookerPointsRemaining} margin=${JSON.stringify(afterBlack.state.snookerScoreMargin)}`,
  );
  const blackRespot = (afterBlack.state.ballGrid?.balls || []).find((b) => b.id === 'ball 7');
  assert(
    'black re-enabled after color pot',
    blackRespot && !blackRespot.faded && blackRespot.disabled === true,
    `faded=${blackRespot?.faded} disabled=${blackRespot?.disabled}`,
  );
  const redAgain = (afterBlack.state.ballGrid?.balls || []).find((b) => b.id === 'ball 1');
  assert('red enabled again', redAgain && !redAgain.disabled && !redAgain.faded);

  // Dock parity: miss after red (player change) returns incoming player to ball-on red.
  let miss = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  miss = applyImpromptuCommand(miss, 'select_breaker', { slot: '1' })._private;
  miss = applyImpromptuCommand(miss, 'snooker_ball', { ballId: 'ball 1' })._private;
  assert('miss setup is color phase', miss.snookerPhase === 'color');
  miss = applyImpromptuCommand(miss, 'toggle_active_player', { isP1: false })._private;
  assert('miss/switch resets to red phase', miss.snookerPhase === 'red');
  const missRed = (miss.ballGrid?.balls || []).find((b) => b.id === 'ball 1');
  const missBlack = (miss.ballGrid?.balls || []).find((b) => b.id === 'ball 7');
  assert(
    'incoming player is on red after miss',
    missRed && !missRed.disabled && missBlack && missBlack.disabled === true,
    `redDisabled=${missRed?.disabled} blackDisabled=${missBlack?.disabled}`,
  );
  assert('miss/switch clears free ball offer', miss.snookerFreeBallOffered !== true);
  const missSwitchEntry = miss._scoringUndoStack?.[miss._scoringUndoStack.length - 1];
  assert(
    'playerSwitch undo entry is typed (no full _potted clone on stack tip)',
    missSwitchEntry
      && missSwitchEntry.type === 'playerSwitch'
      && missSwitchEntry.before
      && missSwitchEntry.before._potted == null,
    JSON.stringify(missSwitchEntry),
  );
  // Typed playerSwitch undo restores colour visit without reversing the red pot.
  const missUndone = applyImpromptuCommand(miss, 'undo', {});
  assert(
    'undo miss restores colour phase and P1',
    missUndone.state.snookerPhase === 'color'
      && missUndone.state.activePlayer === '1'
      && missUndone.state.p1Balls === 1,
    `phase=${missUndone.state.snookerPhase} active=${missUndone.state.activePlayer} p1=${missUndone.state.p1Balls}`,
  );

  // After 15th red, miss/switch must enter clearance (yellow), not free-choice colors.
  let missClear = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
    rackBreakerSlot: '1', activePlayer: '1',
    _snookerRedsPotted: 14,
    _snookerPhase: 'red',
  });
  missClear = applyImpromptuCommand(missClear, 'snooker_ball', { ballId: 'ball 1' })._private;
  assert('15th red sets color phase', missClear.snookerPhase === 'color' && missClear.snookerRedsPotted === 15);
  missClear = applyImpromptuCommand(missClear, 'toggle_active_player', { isP1: false })._private;
  assert('miss after 15th red enters clearance phase', missClear.snookerPhase === 'red');
  const missYellow = (missClear.ballGrid?.balls || []).find((b) => b.id === 'ball 2');
  const missGreen = (missClear.ballGrid?.balls || []).find((b) => b.id === 'ball 3');
  assert(
    'miss after 15th red enables yellow only',
    missYellow && !missYellow.disabled && missGreen && missGreen.disabled === true,
    `yellowDisabled=${missYellow?.disabled} greenDisabled=${missGreen?.disabled}`,
  );

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

  // Snooker free ball after foul (dock switches player + offers Free Ball in one step).
  let free = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  free = applyImpromptuCommand(free, 'select_breaker', { slot: '1' })._private;
  const freeBefore = (free.ballGrid?.balls || []).find((b) => b.id === 'ball 10');
  assert('free ball disabled initially', freeBefore && freeBefore.disabled);
  const rejectFree = applyImpromptuCommand(free, 'snooker_ball', { ballId: 'ball 10' });
  assert('free ball rejected without foul', rejectFree.publish === false && rejectFree.state.p1Balls === 0);
  const foulTargets = free.ballGrid?.snookerFoulTargets || [];
  assert(
    'foul picker targets use dock keys',
    foulTargets.some((t) => t.key === 'black')
      && foulTargets.some((t) => t.key === 'red')
      && foulTargets.some((t) => t.key === 'white')
      && foulTargets.every((t) => !String(t.key).startsWith('ball')),
    JSON.stringify(foulTargets.map((t) => t.key)),
  );
  const afterFoul = applyImpromptuCommand(free, 'snooker_foul', { foulKey: 'black' });
  assert('snooker foul awards black 7', afterFoul.state.p2Balls === 7 && afterFoul.state.foulsP1 === 1);
  assert('snooker foul switches active player', afterFoul.state.activePlayer === '2');
  assert('free ball offered after foul', afterFoul.state.snookerFreeBallOffered === true);
  assert(
    'snooker foul clears break chips',
    afterFoul.state.snookerCurrentBreak === 0
      && Array.isArray(afterFoul.state.snookerBreakBalls)
      && afterFoul.state.snookerBreakBalls.length === 0,
  );
  const freeReady = (afterFoul.state.ballGrid?.balls || []).find((b) => b.id === 'ball 10');
  assert('free ball enabled after foul', freeReady && !freeReady.disabled);
  const afterFree = applyImpromptuCommand(afterFoul._private, 'snooker_ball', { ballId: 'ball 10' });
  assert('free ball scores 1 in reds', afterFree.state.p2Balls === 8 && afterFree.state.snookerPhase === 'color');
  assert('free ball cleared after pot', afterFree.state.snookerFreeBallOffered !== true);
  assert(
    'free ball sets afterFreeball flag',
    afterFree._private._snookerAfterFreeball === true
      || afterFree.state.snookerAfterFreeball === true,
  );
  assert(
    'free ball remaining stays full reds package',
    afterFree.state.snookerPointsRemaining === 147,
    `remaining=${afterFree.state.snookerPointsRemaining}`,
  );
  assert(
    'free ball appears in break chips',
    afterFree.state.snookerCurrentBreak === 1
      && afterFree.state.snookerBreakBalls?.some((b) => b.key === 'freeball' && b.count === 1),
    JSON.stringify(afterFree.state.snookerBreakBalls),
  );
  const undoFree = applyImpromptuCommand(afterFree._private, 'undo', {});
  assert(
    'undo free ball restores foul score and offer',
    undoFree.state.p2Balls === 7
      && undoFree.state.snookerFreeBallOffered === true
      && undoFree.state.activePlayer === '2',
  );
  const undoFoul = applyImpromptuCommand(undoFree._private, 'undo', {});
  assert(
    'undo foul restores pre-foul scores and P1',
    undoFoul.state.p2Balls === 0
      && undoFoul.state.foulsP1 === 0
      && undoFoul.state.activePlayer === '1'
      && undoFoul.state.snookerFreeBallOffered !== true,
  );

  // WPBSA: Free Ball cannot apply when Black is the only object ball remaining.
  let onlyBlack = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
    rackBreakerSlot: '1', activePlayer: '1',
    _snookerRedsPotted: 15,
    _snookerPhase: 'red',
    _snookerCleared: {
      'ball 2': true, 'ball 3': true, 'ball 4': true,
      'ball 5': true, 'ball 6': true,
    },
  });
  onlyBlack = applyImpromptuCommand(onlyBlack, 'snooker_foul', { foulKey: 'black' })._private;
  assert('foul still switches when only black left', onlyBlack.activePlayer === '2');
  assert(
    'free ball not offered when only black remains',
    onlyBlack.snookerFreeBallOffered !== true,
    `offered=${onlyBlack.snookerFreeBallOffered}`,
  );
  const freeOnBlack = (onlyBlack.ballGrid?.balls || []).find((b) => b.id === 'ball 10');
  assert(
    'free ball disabled when only black remains',
    freeOnBlack && freeOnBlack.disabled === true,
    `disabled=${freeOnBlack?.disabled}`,
  );
  const rejectFreeOnBlack = applyImpromptuCommand(onlyBlack, 'snooker_ball', { ballId: 'ball 10' });
  assert(
    'free ball pot rejected when only black remains',
    rejectFreeOnBlack.publish === false
      || rejectFreeOnBlack.state.p2Balls === onlyBlack.p2Balls,
    `p2=${rejectFreeOnBlack.state.p2Balls}`,
  );

  // Foul picker: cleared colors (not re-spotted) are not foul options.
  let foulClear = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
    rackBreakerSlot: '1', activePlayer: '1',
    _snookerRedsPotted: 15,
    _snookerPhase: 'red',
    _snookerCleared: { 'ball 2': true, 'ball 3': true },
  });
  const clearanceFoulKeys = (foulClear.ballGrid?.snookerFoulTargets || []).map((t) => t.key);
  assert(
    'foul picker omits cleared yellow/green',
    clearanceFoulKeys.includes('white')
      && clearanceFoulKeys.includes('brown')
      && clearanceFoulKeys.includes('black')
      && !clearanceFoulKeys.includes('yellow')
      && !clearanceFoulKeys.includes('green')
      && !clearanceFoulKeys.includes('red'),
    JSON.stringify(clearanceFoulKeys),
  );
  const rejectClearedFoul = applyImpromptuCommand(foulClear, 'snooker_foul', { foulKey: 'yellow' });
  assert(
    'cleared yellow foul rejected',
    rejectClearedFoul.publish === false && rejectClearedFoul.state.p2Balls === 0,
  );

  // White foul = value of the ball on (min 4): blue/pink/black → 5; only black → 7.
  let whiteBlue = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
    rackBreakerSlot: '1', activePlayer: '1',
    _snookerRedsPotted: 15,
    _snookerPhase: 'red',
    _snookerCleared: { 'ball 2': true, 'ball 3': true, 'ball 4': true },
  });
  const whiteBlueTarget = (whiteBlue.ballGrid?.snookerFoulTargets || []).find((t) => t.key === 'white');
  assert(
    'white foul shows 5 when blue is on',
    whiteBlueTarget && whiteBlueTarget.points === 5,
    JSON.stringify(whiteBlueTarget),
  );
  const whiteBlueFoul = applyImpromptuCommand(whiteBlue, 'snooker_foul', { foulKey: 'white' });
  assert('white foul awards 5 when blue on', whiteBlueFoul.state.p2Balls === 5);

  let whiteBlack = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
    rackBreakerSlot: '1', activePlayer: '1',
    _snookerRedsPotted: 15,
    _snookerPhase: 'red',
    _snookerCleared: {
      'ball 2': true, 'ball 3': true, 'ball 4': true,
      'ball 5': true, 'ball 6': true,
    },
  });
  const whiteBlackTarget = (whiteBlack.ballGrid?.snookerFoulTargets || []).find((t) => t.key === 'white');
  assert(
    'white foul shows 7 when only black remains',
    whiteBlackTarget && whiteBlackTarget.points === 7,
    JSON.stringify(whiteBlackTarget),
  );
  const whiteBlackFoul = applyImpromptuCommand(whiteBlack, 'snooker_foul', { foulKey: 'white' });
  assert('white foul awards 7 when only black on', whiteBlackFoul.state.p2Balls === 7);

  // Remaining/Diff row: hide only at 0–0; show with Diff 0 when tied after scoring.
  let tied = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  assert(
    'margin hidden at 0-0',
    tied.snookerScoreMargin?.showMargin === false,
    JSON.stringify(tied.snookerScoreMargin),
  );
  tied = applyImpromptuCommand(tied, 'select_breaker', { slot: '1' })._private;
  tied = applyImpromptuCommand(tied, 'snooker_ball', { ballId: 'ball 1' })._private;
  tied = applyImpromptuCommand(tied, 'toggle_active_player', { isP1: false })._private;
  tied = applyImpromptuCommand(tied, 'snooker_foul', { foulKey: 'black' })._private;
  // After foul black (+7 to P1), P1 leads; force a tie for margin UI.
  tied.p1Balls = 7;
  tied.p2Balls = 7;
  tied = applyImpromptuCommand(tied, 'toggle_active_player', { isP1: true })._private;
  assert(
    'margin shown when tied mid-frame',
    tied.snookerScoreMargin?.showMargin === true
      && tied.snookerScoreMargin?.diff === 0
      && tied.snookerScoreMargin?.display === '0'
      && tied.snookerScoreMargin?.remaining > 0,
    JSON.stringify(tied.snookerScoreMargin),
  );

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
  const undoBankPot = applyImpromptuCommand(pot1._private, 'undo', {});
  assert(
    'bank pot undo unfades and clears ball',
    undoBankPot.state.p1Balls === 0
      && !(undoBankPot.state.ballGrid?.balls || []).find((b) => b.id === 'ball 1')?.faded,
  );
  // Re-pot for respot path.
  const pot1b = applyImpromptuCommand(undoBankPot._private, 'toggle_pot', { ballId: 'ball 1' });
  assert('bank pot awards ball again', pot1b.state.p1Balls === 1);
  const respot = applyImpromptuCommand(pot1b._private, 'respot_ball', { ballId: 'ball 1' });
  assert(
    'bank respot keeps score',
    respot.state.p1Balls === 1
      && !(respot.state.ballGrid?.balls || []).find((b) => b.id === 'ball 1')?.faded,
  );
  let bankRun = pot1b._private;
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

  // Manual − must allow negatives (dock postBalls / Straight Pool foul parity).
  let negPrimary = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game4',
  });
  negPrimary = applyImpromptuCommand(negPrimary, 'select_breaker', { slot: '1' })._private;
  negPrimary = applyImpromptuCommand(negPrimary, 'score_sub', { player: '1' })._private;
  assert('manual score_sub goes negative', negPrimary.p1Score === -1, `score=${negPrimary.p1Score}`);
  negPrimary = applyImpromptuCommand(negPrimary, 'score_add', { player: '1' })._private;
  assert('manual score_add recovers from negative', negPrimary.p1Score === 0, `score=${negPrimary.p1Score}`);

  // Straight Pool manual +/− scores balls, not racks — keep breaker (dock postScore skip).
  let straightManual = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game4',
  });
  straightManual = applyImpromptuCommand(straightManual, 'select_breaker', { slot: '1' })._private;
  const afterStraightAdd = applyImpromptuCommand(straightManual, 'score_add', { player: '1' });
  assert(
    'straight score_add keeps breaker',
    afterStraightAdd.state.p1Score === 1
      && afterStraightAdd.state.awaitingBreaker === false
      && afterStraightAdd.state.rackBreakerSlot === '1'
      && afterStraightAdd.state.playerSlotMode === 'active',
    `score=${afterStraightAdd.state.p1Score} await=${afterStraightAdd.state.awaitingBreaker} breaker=${afterStraightAdd.state.rackBreakerSlot}`,
  );
  assert(
    'straight score_add notes run',
    afterStraightAdd._private._straightRunSlot === '1'
      && afterStraightAdd._private._straightRunLength === 1,
    `run=${afterStraightAdd._private._straightRunSlot}:${afterStraightAdd._private._straightRunLength}`,
  );
  const afterStraightAdd2 = applyImpromptuCommand(afterStraightAdd._private, 'score_add', { player: '1' });
  assert(
    'straight score_add still no breaker prompt',
    afterStraightAdd2.state.p1Score === 2
      && afterStraightAdd2.state.awaitingBreaker === false
      && afterStraightAdd2.state.rackBreakerSlot === '1',
  );

  let negBalls = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  negBalls = applyImpromptuCommand(negBalls, 'select_breaker', { slot: '1' })._private;
  negBalls = applyImpromptuCommand(negBalls, 'balls_sub', { player: '1' })._private;
  assert('manual balls_sub goes negative', negBalls.p1Balls === -1, `balls=${negBalls.p1Balls}`);
  negBalls = applyImpromptuCommand(negBalls, 'balls_add', { player: '1' })._private;
  assert('manual balls_add recovers from negative', negBalls.p1Balls === 0, `balls=${negBalls.p1Balls}`);

  // One Pocket / Bank: balls may go below 0 (dock foul / postBalls parity).
  let opNeg = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game6',
  });
  opNeg = applyImpromptuCommand(opNeg, 'select_breaker', { slot: '1' })._private;
  opNeg = applyImpromptuCommand(opNeg, 'balls_sub', { player: '1' })._private;
  assert('one-pocket balls_sub goes negative', opNeg.p1Balls === -1, `balls=${opNeg.p1Balls}`);
  opNeg = applyImpromptuCommand(opNeg, 'pool_foul', {})._private;
  assert(
    'one-pocket foul goes more negative',
    opNeg.p1Balls === -2 && opNeg.activePlayer === '2',
    `balls=${opNeg.p1Balls}`,
  );
  let bankNeg = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game5',
  });
  bankNeg = applyImpromptuCommand(bankNeg, 'select_breaker', { slot: '1' })._private;
  bankNeg = applyImpromptuCommand(bankNeg, 'balls_sub', { player: '1' })._private;
  assert('bank balls_sub goes negative', bankNeg.p1Balls === -1, `balls=${bankNeg.p1Balls}`);
  bankNeg = applyImpromptuCommand(bankNeg, 'pool_foul', {})._private;
  assert(
    'bank foul goes more negative',
    bankNeg.p1Balls === -2 && bankNeg.activePlayer === '2',
    `balls=${bankNeg.p1Balls}`,
  );
  let stFoulNeg = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game4',
  });
  stFoulNeg = applyImpromptuCommand(stFoulNeg, 'select_breaker', { slot: '1' })._private;
  stFoulNeg = applyImpromptuCommand(stFoulNeg, 'pool_foul', {})._private;
  assert(
    'straight foul from 0 goes negative',
    stFoulNeg.p1Score === -1 && stFoulNeg.activePlayer === '2',
    `score=${stFoulNeg.p1Score}`,
  );

  // Straight Pool with no race: Call Match after points are on the board.
  let straightCall = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game4', raceInfo: '',
  });
  assert('straight open race not locked', straightCall.gameScoringLocked !== true);
  assert('straight open race cannot call before play', straightCall.canCallGame !== true);
  straightCall = applyImpromptuCommand(straightCall, 'select_breaker', { slot: '1' })._private;
  straightCall = applyImpromptuCommand(straightCall, 'score_add', { player: '1' })._private;
  assert(
    'straight open race can call after points',
    straightCall.canCallGame === true && straightCall.gameScoringLocked !== true,
    `canCall=${straightCall.canCallGame} locked=${straightCall.gameScoringLocked}`,
  );
  const called = applyImpromptuCommand(straightCall, 'call_match_early', {});
  assert(
    'straight open race call_match_early ends session',
    (called.sessionEvents || []).some((ev) => ev.action === 'end'),
    JSON.stringify(called.sessionEvents),
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

  // Pool fade toggle + game-ball rack win resets the table (game ball held through cooldown).
  let nine = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game2',
  });
  nine = applyImpromptuCommand(nine, 'select_breaker', { slot: '1' })._private;
  nine = applyImpromptuCommand(nine, 'toggle_pot', { ballId: 'ball 1' })._private;
  assert('9-ball object ball fades', !!(nine._potted && nine._potted['ball 1']));
  // Early 9 rejected when preceding balls not down and early option off.
  const earlyNine = applyImpromptuCommand(
    createDefaultImpromptuState({ player1Name: 'A', player2Name: 'B', gameType: 'game2', earlyGameBallEnabled: false }),
    'select_breaker',
    { slot: '1' },
  );
  const earlyNinePot = applyImpromptuCommand(earlyNine._private, 'toggle_pot', { ballId: 'ball 9' });
  assert(
    'early 9 rejected with cooldown',
    earlyNinePot.state.p1Score === 0
      && earlyNinePot._private._cooldown?.mode === 'early_reject'
      && earlyNinePot._private._cooldown?.ballId === 'ball 9',
  );
  const earlyNineClear = applyImpromptuCommand(earlyNinePot._private, 'clear_tracker_cooldown', {});
  assert(
    'early 9 revive after cooldown',
    !(earlyNineClear.state.ballGrid?.balls || []).find((b) => b.id === 'ball 9')?.faded
      && !earlyNineClear._private._cooldown,
  );

  // Early option on: 9 wins immediately.
  let nineEarlyOn = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game2', earlyGameBallEnabled: true,
  });
  nineEarlyOn = applyImpromptuCommand(nineEarlyOn, 'select_breaker', { slot: '1' })._private;
  const nineWin = applyImpromptuCommand(nineEarlyOn, 'toggle_pot', { ballId: 'ball 9' });
  assert(
    'early-9 option awards rack',
    nineWin.state.p1Score === 1
      && nineWin.state.awaitingBreaker === true
      && nineWin._private._cooldown?.mode === 'rack_win',
  );
  assert(
    'early-9 counts game-ball pot',
    nineWin._private._matchBallsP1 === 1
      && nineWin._private._matchRacks?.[0]?.ballsP1 === 1,
    `balls=${nineWin._private._matchBallsP1} rack=${JSON.stringify(nineWin._private._matchRacks)}`,
  );
  const nineCleared = applyImpromptuCommand(nineWin._private, 'clear_tracker_cooldown', {});
  assert(
    '9-ball cooldown clears game ball for next rack',
    !(nineCleared.state.ballGrid?.balls || []).some((b) => b.faded),
  );

  // Preceding balls down: 9 wins without early option.
  let nineClear = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game2', earlyGameBallEnabled: false,
  });
  nineClear = applyImpromptuCommand(nineClear, 'select_breaker', { slot: '1' })._private;
  for (let n = 1; n <= 8; n += 1) {
    nineClear = applyImpromptuCommand(nineClear, 'toggle_pot', { ballId: `ball ${n}` })._private;
  }
  const nineInOrder = applyImpromptuCommand(nineClear, 'toggle_pot', { ballId: 'ball 9' });
  assert('9-ball in-order awards rack', nineInOrder.state.p1Score === 1);
  assert(
    '9-ball in-order includes game ball in pots',
    nineInOrder._private._matchBallsP1 === 9
      && nineInOrder._private._matchRacks?.[0]?.ballsP1 === 9,
    `balls=${nineInOrder._private._matchBallsP1} rack=${JSON.stringify(nineInOrder._private._matchRacks)}`,
  );

  // Manual score_add must reset tracker / snooker frame (dock postScore parity).
  let rack = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1',
  });
  rack = applyImpromptuCommand(rack, 'select_breaker', { slot: '1' })._private;
  rack = applyImpromptuCommand(rack, 'toggle_pot', { ballId: 'ball 1' })._private;
  rack = applyImpromptuCommand(rack, 'toggle_pot', { ballId: 'ball 2' })._private;
  const afterManualRack = applyImpromptuCommand(rack, 'score_add', { player: '1' });
  assert(
    'score_add clears faded balls for next rack',
    afterManualRack.state.p1Score === 1
      && afterManualRack.state.awaitingBreaker === true
      && !(afterManualRack.state.ballGrid?.balls || []).some((b) => b.faded),
  );

  let frame = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  frame = applyImpromptuCommand(frame, 'select_breaker', { slot: '1' })._private;
  // Drive into clearance yellow-down state quickly via private fields after a few pots.
  frame = applyImpromptuCommand(frame, 'snooker_ball', { ballId: 'ball 1' })._private;
  frame = applyImpromptuCommand(frame, 'snooker_ball', { ballId: 'ball 7' })._private;
  frame._snookerRedsPotted = 15;
  frame._snookerPhase = 'red';
  frame._snookerCleared = { 'ball 2': true, 'ball 3': true };
  frame = applyImpromptuCommand(frame, 'score_add', { player: '1' })._private;
  assert(
    'snooker score_add resets frame sequence',
    frame.snookerRedsPotted === 0
      && frame.snookerPhase === 'red'
      && frame.p1Balls === 0
      && !(frame.ballGrid?.balls || []).some((b) => b.faded)
      && frame.awaitingBreaker === true,
    `reds=${frame.snookerRedsPotted} phase=${frame.snookerPhase} balls=${frame.p1Balls}`,
  );

  // balls_add to 8 also awards Bank rack and clears tracker.
  let bankBalls = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game5',
  });
  bankBalls = applyImpromptuCommand(bankBalls, 'select_breaker', { slot: '1' })._private;
  bankBalls = applyImpromptuCommand(bankBalls, 'toggle_pot', { ballId: 'ball 1' })._private;
  for (let i = 0; i < 7; i += 1) {
    bankBalls = applyImpromptuCommand(bankBalls, 'balls_add', { player: '1' })._private;
  }
  assert(
    'balls_add to 8 awards bank rack and clears pots',
    bankBalls.p1Score === 1
      && bankBalls.p1Balls === 0
      && !(bankBalls.ballGrid?.balls || []).some((b) => b.faded)
      && bankBalls.awaitingBreaker === true,
  );

  // Win-on-break off: first-ball 8 is early_reject (cooldown), not a loss.
  let earlyEight = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', earlyGameBallEnabled: false,
  });
  earlyEight = applyImpromptuCommand(earlyEight, 'select_breaker', { slot: '1' })._private;
  const early8 = applyImpromptuCommand(earlyEight, 'toggle_pot', { ballId: 'ball 8' });
  assert(
    'win-on-break off rejects bare 8',
    early8.state.p1Score === 0
      && early8.state.p2Score === 0
      && early8._private._cooldown?.mode === 'early_reject',
  );

  // Dry break → incoming player pots 8 → loss (not win-on-break / restore).
  let dryBreakEight = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', earlyGameBallEnabled: false,
  });
  dryBreakEight = applyImpromptuCommand(dryBreakEight, 'select_breaker', { slot: '1' })._private;
  dryBreakEight = applyImpromptuCommand(dryBreakEight, 'toggle_active_player', { isP1: false })._private;
  assert('dry break marks opponent visit', dryBreakEight._rackOpponentVisited === true);
  const dry8 = applyImpromptuCommand(dryBreakEight, 'toggle_pot', { ballId: 'ball 8' });
  assert(
    'dry-break incoming 8 is loss of rack',
    dry8.state.p1Score === 1
      && dry8.state.p2Score === 0
      && dry8.state.lastRackWinnerSlot === '1',
    `p1=${dry8.state.p1Score} p2=${dry8.state.p2Score} last=${dry8.state.lastRackWinnerSlot}`,
  );

  // Same scenario with win-on-break on must still be a loss (not a break win).
  let dryBreakWinFlag = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', earlyGameBallEnabled: true,
  });
  dryBreakWinFlag = applyImpromptuCommand(dryBreakWinFlag, 'select_breaker', { slot: '1' })._private;
  dryBreakWinFlag = applyImpromptuCommand(dryBreakWinFlag, 'toggle_active_player', { isP1: false })._private;
  const dry8WinFlag = applyImpromptuCommand(dryBreakWinFlag, 'toggle_pot', { ballId: 'ball 8' });
  assert(
    'dry-break incoming 8 is loss even if win-on-break on',
    dry8WinFlag.state.p1Score === 1
      && dry8WinFlag.state.p2Score === 0
      && dry8WinFlag.state.lastRackWinnerSlot === '1',
    `p1=${dry8WinFlag.state.p1Score} p2=${dry8WinFlag.state.p2Score} last=${dry8WinFlag.state.lastRackWinnerSlot}`,
  );

  // Illegal 8 with some (but not a full group) down → opponent rack.
  let illegal8 = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', useBallSet: false,
  });
  illegal8 = applyImpromptuCommand(illegal8, 'select_breaker', { slot: '1' })._private;
  illegal8 = applyImpromptuCommand(illegal8, 'toggle_pot', { ballId: 'ball 1' })._private;
  illegal8 = applyImpromptuCommand(illegal8, 'toggle_pot', { ballId: 'ball 2' })._private;
  const loss8 = applyImpromptuCommand(illegal8, 'toggle_pot', { ballId: 'ball 8' });
  assert(
    'illegal 8 awards opponent rack',
    loss8.state.p1Score === 0
      && loss8.state.p2Score === 1
      && loss8.state.lastRackWinnerSlot === '2',
    `p1=${loss8.state.p1Score} p2=${loss8.state.p2Score} last=${loss8.state.lastRackWinnerSlot}`,
  );
  assert(
    'illegal 8 still counts shooter’s pot',
    loss8._private._matchBallsP1 === 3
      && loss8._private._matchRacks?.[0]?.ballsP1 === 3
      && loss8._private._matchRacks?.[0]?.winnerSlot === '2',
    `balls=${loss8._private._matchBallsP1} rack=${JSON.stringify(loss8._private._matchRacks)}`,
  );

  // Ball-set: second object pot on break assigns group.
  let ballSet = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', useBallSet: true, playerBallSet: 'p1Open',
  });
  ballSet = applyImpromptuCommand(ballSet, 'select_breaker', { slot: '1' })._private;
  ballSet = applyImpromptuCommand(ballSet, 'toggle_pot', { ballId: 'ball 3' })._private;
  assert('first break pot keeps Open', ballSet.playerBallSet === 'p1Open');
  ballSet = applyImpromptuCommand(ballSet, 'toggle_pot', { ballId: 'ball 5' })._private;
  assert('second break pot assigns solids', ballSet.playerBallSet === 'p1red/smalls');

  // Legal 8 after clearing assigned group.
  for (const n of [1, 2, 4, 6, 7]) {
    ballSet = applyImpromptuCommand(ballSet, 'toggle_pot', { ballId: `ball ${n}` })._private;
  }
  const legal8 = applyImpromptuCommand(ballSet, 'toggle_pot', { ballId: 'ball 8' });
  assert(
    'legal 8 after group awards active rack',
    legal8.state.p1Score === 1 && legal8.state.p2Score === 0,
  );
  assert(
    'legal 8 includes game ball in pots',
    legal8._private._matchBallsP1 === 8
      && legal8._private._matchRacks?.[0]?.ballsP1 === 8,
    `balls=${legal8._private._matchBallsP1} rack=${JSON.stringify(legal8._private._matchRacks)}`,
  );

  // Default ad-hoc 8-ball enables Ball Set (dock Feature Settings parity).
  const default8 = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1',
  });
  assert('ad-hoc 8-ball defaults useBallSet on', default8.useBallSet === true);
  assert('ad-hoc 8-ball starts Open table', default8.playerBallSet === 'p1Open');
  let autoAssign = applyImpromptuCommand(default8, 'select_breaker', { slot: '1' })._private;
  autoAssign = applyImpromptuCommand(autoAssign, 'toggle_pot', { ballId: 'ball 2' })._private;
  const autoPub = applyImpromptuCommand(autoAssign, 'toggle_pot', { ballId: 'ball 4' });
  assert(
    'default Ball Set auto-assigns group without override',
    autoPub.state.useBallSet === true && autoPub.state.playerBallSet === 'p1red/smalls',
    `use=${autoPub.state.useBallSet} set=${autoPub.state.playerBallSet}`,
  );
  const setToggle = applyImpromptuCommand(autoPub._private, 'set_use_ball_set', { enabled: false });
  assert(
    'set_use_ball_set disables feature and clears group',
    setToggle.state.useBallSet === false && setToggle.state.playerBallSet === 'p1Open',
    `use=${setToggle.state.useBallSet} set=${setToggle.state.playerBallSet}`,
  );
  const setChoice = applyImpromptuCommand(
    createDefaultImpromptuState({ player1Name: 'A', player2Name: 'B', gameType: 'game1' }),
    'set_player_ball_set',
    { value: 'p1yellow/bigs' },
  );
  assert(
    'set_player_ball_set publishes stripes for P1',
    setChoice.state.playerBallSet === 'p1yellow/bigs' && setChoice.state.useBallSet === true,
  );
  const switched = applyImpromptuCommand(
    setChoice._private,
    'set_game_type',
    { gameType: 'game2' },
  );
  assert(
    'game type change resets Chosen Ball to Open',
    switched.state.playerBallSet === 'p1Open',
    `set=${switched.state.playerBallSet}`,
  );

  // Straight 14.1 re-rack when one ball left.
  let straight141 = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game4',
  });
  straight141 = applyImpromptuCommand(straight141, 'select_breaker', { slot: '1' })._private;
  for (let n = 1; n <= 14; n += 1) {
    straight141 = applyImpromptuCommand(straight141, 'toggle_pot', { ballId: `ball ${n}` })._private;
  }
  assert('14.1 re-rack restores pocketed balls',
    straight141.p1Score === 14
      && straight141.rackBreakerSlot === '1'
      && !(straight141._potted && Object.values(straight141._potted).some(Boolean)),
    `score=${straight141.p1Score} potted=${JSON.stringify(straight141._potted)}`,
  );

  // Ball art filenames match dock/mobile assets.
  const unity = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', ballSelection: 'unity',
  });
  assert(
    'unity ball file name',
    (unity.ballGrid?.balls || []).find((b) => b.id === 'ball 1')?.file === '1-ball-unity-small.png',
  );
  const ultimate = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', ballSelection: 'ultimate',
  });
  assert(
    'ultimate ball file name',
    (ultimate.ballGrid?.balls || []).find((b) => b.id === 'ball 3')?.file === 'ultimate-3ball-small.png',
  );
  const intl = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', ballSelection: 'international',
  });
  assert(
    'international solids file',
    (intl.ballGrid?.balls || []).find((b) => b.id === 'ball 2')?.file === 'yellow-international-small-ball.png',
  );
  assert(
    'international 8 file',
    (intl.ballGrid?.balls || []).find((b) => b.id === 'ball 8')?.file === 'international-8-small-ball.png',
  );

  // Golden Ball: hidden until option; enabled after black cleared + 147; pot awards 20.
  let goldOff = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker', snookerGoldEnabled: false,
  });
  assert(
    'gold hidden when option off',
    (goldOff.ballGrid?.balls || []).find((b) => b.id === 'ball 8')?.hidden === true,
  );
  let gold = createDefaultImpromptuState({
    player1Name: 'A',
    player2Name: 'B',
    gameType: 'game8',
    ballSelection: 'snooker',
    snookerGoldEnabled: true,
    p1Balls: 147,
    rackBreakerSlot: '1',
    activePlayer: '1',
    _snookerRedsPotted: 15,
    _snookerPhase: 'red',
    _snookerCleared: {
      'ball 2': true, 'ball 3': true, 'ball 4': true,
      'ball 5': true, 'ball 6': true, 'ball 7': true,
    },
  });
  const goldReady = (gold.ballGrid?.balls || []).find((b) => b.id === 'ball 8');
  assert(
    'gold enabled at 147 after black',
    goldReady && !goldReady.hidden && !goldReady.disabled,
    `hidden=${goldReady?.hidden} disabled=${goldReady?.disabled}`,
  );
  const goldPot = applyImpromptuCommand(gold, 'snooker_ball', { ballId: 'ball 8' });
  assert(
    'gold pot awards 20 and removes ball',
    goldPot.state.p1Balls === 167
      && (goldPot.state.ballGrid?.balls || []).find((b) => b.id === 'ball 8')?.hidden === true,
    `pts=${goldPot.state.p1Balls}`,
  );

  // Match stats → session:end (rack breakdown + Straight longest run).
  let stats8 = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game1', raceInfo: '3',
  });
  stats8 = applyImpromptuCommand(stats8, 'select_breaker', { slot: '1' })._private;
  // B&R: breaker wins without opponent visit.
  stats8 = applyImpromptuCommand(stats8, 'score_add', { player: '1' })._private;
  assert(
    'rack row recorded on score_add',
    Array.isArray(stats8._matchRacks) && stats8._matchRacks.length === 1
      && stats8._matchRacks[0].winnerSlot === '1'
      && stats8._matchRacks[0].breakAndRun === true,
    JSON.stringify(stats8._matchRacks),
  );
  // Second rack after opponent visit → not B&R.
  stats8 = applyImpromptuCommand(stats8, 'select_breaker', { slot: '1' })._private;
  stats8 = applyImpromptuCommand(stats8, 'toggle_active_player', { isP1: false })._private;
  stats8 = applyImpromptuCommand(stats8, 'score_add', { player: '2' })._private;
  assert(
    'second rack after visit is not B&R',
    stats8._matchRacks.length === 2
      && stats8._matchRacks[1].winnerSlot === '2'
      && !stats8._matchRacks[1].breakAndRun,
    JSON.stringify(stats8._matchRacks[1]),
  );
  const end8 = applyImpromptuCommand(stats8, 'end_match', {});
  const end8Payload = (end8.sessionEvents || []).find((ev) => ev.action === 'end')?.payload;
  assert(
    'session:end includes racks',
    Array.isArray(end8Payload?.racks) && end8Payload.racks.length === 2
      && end8Payload.breakAndRunsP1 === 1
      && end8Payload.scores?.p1 === 1 && end8Payload.scores?.p2 === 1,
    JSON.stringify(end8Payload),
  );

  // Snooker frame row with high break.
  let statsSn = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game8', ballSelection: 'snooker',
  });
  statsSn = applyImpromptuCommand(statsSn, 'select_breaker', { slot: '1' })._private;
  statsSn = applyImpromptuCommand(statsSn, 'snooker_ball', { ballId: 'ball 1' })._private;
  statsSn = applyImpromptuCommand(statsSn, 'snooker_ball', { ballId: 'ball 7' })._private;
  assert('frame high break tracks visit', statsSn._frameHighBreakP1 === 8, `hb=${statsSn._frameHighBreakP1}`);
  // Alternating shooter must credit the outgoing visit, not the incoming player.
  statsSn = applyImpromptuCommand(statsSn, 'toggle_active_player', { isP1: false })._private;
  assert(
    'player switch keeps high break on P1 (outgoing)',
    statsSn._frameHighBreakP1 === 8 && statsSn._frameHighBreakP2 === 0
      && (Number(statsSn._snookerBreak) || 0) === 0,
    `p1=${statsSn._frameHighBreakP1} p2=${statsSn._frameHighBreakP2} cur=${statsSn._snookerBreak}`,
  );
  statsSn = applyImpromptuCommand(statsSn, 'snooker_ball', { ballId: 'ball 1' })._private;
  statsSn = applyImpromptuCommand(statsSn, 'snooker_ball', { ballId: 'ball 5' })._private;
  assert('P2 visit high is 6', statsSn._frameHighBreakP2 === 6, `hb2=${statsSn._frameHighBreakP2}`);
  statsSn = applyImpromptuCommand(statsSn, 'toggle_active_player', { isP1: true })._private;
  assert(
    'switch back does not swap highs',
    statsSn._frameHighBreakP1 === 8 && statsSn._frameHighBreakP2 === 6,
    `p1=${statsSn._frameHighBreakP1} p2=${statsSn._frameHighBreakP2}`,
  );
  statsSn = applyImpromptuCommand(statsSn, 'score_add', { player: '1' })._private;
  const endSn = applyImpromptuCommand(statsSn, 'end_match', {});
  const endSnPayload = (endSn.sessionEvents || []).find((ev) => ev.action === 'end')?.payload;
  assert(
    'snooker session:end has frame racks + HB',
    endSnPayload?.racks?.length === 1
      && endSnPayload.racks[0].frameScore?.p1 === 8
      && endSnPayload.racks[0].highestBreakP1 === 8
      && endSnPayload.highestBreakP1 === 8,
    JSON.stringify(endSnPayload),
  );

  // Straight: longest run across visits.
  let statsSt = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game4', raceInfo: '50',
  });
  statsSt = applyImpromptuCommand(statsSt, 'select_breaker', { slot: '1' })._private;
  for (const n of [1, 2, 3]) {
    statsSt = applyImpromptuCommand(statsSt, 'toggle_pot', { ballId: `ball ${n}` })._private;
  }
  assert('straight run length 3', statsSt._straightRunLength === 3 && statsSt._highestRunP1 === 3);
  statsSt = applyImpromptuCommand(statsSt, 'toggle_active_player', { isP1: false })._private;
  statsSt = applyImpromptuCommand(statsSt, 'toggle_pot', { ballId: 'ball 4' })._private;
  statsSt = applyImpromptuCommand(statsSt, 'toggle_pot', { ballId: 'ball 5' })._private;
  assert(
    'straight opponent run resets then tracks',
    statsSt._highestRunP1 === 3 && statsSt._highestRunP2 === 2 && statsSt._straightRunSlot === '2',
    `p1=${statsSt._highestRunP1} p2=${statsSt._highestRunP2} slot=${statsSt._straightRunSlot}`,
  );
  const endSt = applyImpromptuCommand(statsSt, 'end_match', {});
  const endStPayload = (endSt.sessionEvents || []).find((ev) => ev.action === 'end')?.payload;
  assert(
    'straight session:end has highestRun, empty racks',
    Array.isArray(endStPayload?.racks) && endStPayload.racks.length === 0
      && endStPayload.highestRunP1 === 3
      && endStPayload.highestRunP2 === 2
      && endStPayload.scores?.p1 === 3 && endStPayload.scores?.p2 === 2,
    JSON.stringify(endStPayload),
  );

  // Bank first-to-8 records a rack.
  let statsBank = createDefaultImpromptuState({
    player1Name: 'A', player2Name: 'B', gameType: 'game5',
  });
  statsBank = applyImpromptuCommand(statsBank, 'select_breaker', { slot: '1' })._private;
  for (let i = 1; i <= 8; i += 1) {
    statsBank = applyImpromptuCommand(statsBank, 'toggle_pot', { ballId: `ball ${i}` })._private;
  }
  assert(
    'bank rack recorded on first-to-8',
    statsBank.p1Score === 1 && statsBank._matchRacks?.length === 1
      && statsBank._matchRacks[0].winnerSlot === '1'
      && statsBank._matchRacks[0].breakAndRun === true,
    JSON.stringify(statsBank._matchRacks),
  );

  // Hydrate restores matchStats for reconnect.
  const pubBank = applyImpromptuCommand(statsBank, 'select_breaker', { slot: '2' });
  assert('public matchStats has racks', (pubBank.state.matchStats?.racks || []).length === 1);
  const hydratedStats = hydrateAuthorityState(pubBank.state, { sessionId: pubBank.state.matchId });
  assert(
    'hydrate restores match racks',
    hydratedStats._matchRacks?.length === 1 && hydratedStats._matchRacks[0].winnerSlot === '1',
    JSON.stringify(hydratedStats._matchRacks),
  );

  // Same roster UUID on both sides: no session:start; end discards (dock duplicateNames parity).
  let dup = createDefaultImpromptuState({
    player1Name: 'Bob', player2Name: 'Bob',
    player1Id: 'same-uuid', player2Id: 'same-uuid',
  });
  const dupBreaker = applyImpromptuCommand(dup, 'select_breaker', { slot: '1' });
  assert(
    'duplicate player ids skip session:start',
    !(dupBreaker.sessionEvents || []).some((ev) => ev.action === 'start')
      && dupBreaker.state.duplicatePlayerIds === true,
    JSON.stringify(dupBreaker.sessionEvents),
  );
  dup = applyImpromptuCommand(dupBreaker._private, 'score_add', { player: '1' })._private;
  const dupEnd = applyImpromptuCommand(dup, 'end_match', {});
  assert(
    'duplicate player ids end discards (no history)',
    (dupEnd.sessionEvents || []).some((ev) => ev.action === 'discard' && ev.payload?.reason === 'duplicate_player_ids')
      && !(dupEnd.sessionEvents || []).some((ev) => ev.action === 'end'),
    JSON.stringify(dupEnd.sessionEvents),
  );

  // Reconnect must not emit a second session:start (stale live games).
  let liveMatch = createDefaultImpromptuState({ player1Name: 'A', player2Name: 'B' });
  liveMatch = applyImpromptuCommand(liveMatch, 'select_breaker', { slot: '1' });
  assert(
    'breaker emits session start',
    (liveMatch.sessionEvents || []).some((ev) => ev.action === 'start'),
  );
  const matchId = liveMatch._private._matchId;
  assert('match id assigned', !!matchId);
  liveMatch = applyImpromptuCommand(liveMatch._private, 'score_add', { player: '1' });
  assert('public state carries session markers', liveMatch.state.cloudSessionStarted === true && liveMatch.state.matchId === matchId);
  const rehydrated = hydrateAuthorityState(liveMatch.state, { sessionId: matchId });
  assert('hydrate marks cloud started', rehydrated._cloudStarted === true && rehydrated._matchId === matchId);
  const afterReconnect = applyImpromptuCommand(rehydrated, 'score_add', { player: '1' });
  assert(
    'reconnect score does not emit second start',
    !(afterReconnect.sessionEvents || []).some((ev) => ev.action === 'start'),
    JSON.stringify(afterReconnect.sessionEvents),
  );
  assert('reconnect keeps same match id', afterReconnect._private._matchId === matchId);

  // Simulated paid tier: assertCanCreateImpromptuTable respects maxImpromptuTables
  process.env.ALLOW_DEV_AUTH = 'false';
  // Re-import won't reload env in quotas (already loaded). Directly exercise catalog limits.
  const streamerLimits = quotas.getTierLimits('streamer');
  assert('streamer has maxImpromptuTables', streamerLimits.maxImpromptuTables === 2);
  const toLimits = quotas.getTierLimits('tournament_organizer');
  assert('tournament organizer has maxImpromptuTables', toLimits.maxImpromptuTables === 5);

  // Static UI contracts: mobile shows badges only (no Chosen Ball UI) + B&R/TR tooltips.
  const { fileURLToPath } = await import('url');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const mobileHtml = fs.readFileSync(path.join(repoRoot, 'backend', 'web', 'mobile', 'index.html'), 'utf8');
  assert('mobile has slot ball badge imgs', mobileHtml.includes('id="playerSlotP1Ball"') && mobileHtml.includes('id="playerSlotP2Ball"'));
  assert('mobile has no Chosen Ball panel', !mobileHtml.includes('id="ballSetPanel"'));
  assert('mobile has no Ball Set setup toggle', !mobileHtml.includes('id="useBallSetCheckbox"'));
  assert('mobile has no Chosen Ball buttons', !mobileHtml.includes('data-cmd="set_player_ball_set"'));
  const playerStatsSrc = fs.readFileSync(path.join(repoRoot, 'common', 'js', 'player_stats.js'), 'utf8');
  assert('dock stats B&R tooltip', /title="Break\\'n\\'Run"/.test(playerStatsSrc));
  assert('dock stats TR tooltip', playerStatsSrc.includes('title="Table Run"'));
  const dashSrc = fs.readFileSync(path.join(repoRoot, 'backend', 'web', 'dashboard', 'app.js'), 'utf8');
  assert(
    'dashboard B&R tooltip',
    /title="Break\\'n\\'Run"/.test(dashSrc) || dashSrc.includes("title=\"Break'n'Run\""),
  );
  assert('dashboard TR tooltip', dashSrc.includes('title="Table Run"'));
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
