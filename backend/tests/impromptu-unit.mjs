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
