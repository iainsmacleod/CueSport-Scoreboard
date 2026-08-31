'use strict';

/**
 * Executes CueSport Cloud commands on the dock (stats-safe — calls real control_panel functions).
 */
(function () {
    function runCommand(action, payload) {
        switch (action) {
            case 'score_add':
                if (payload && payload.player) postScore('add', String(payload.player));
                break;
            case 'score_sub':
                if (payload && payload.player) postScore('sub', String(payload.player));
                break;
            case 'balls_add':
                if (payload && payload.player) postBalls('add', String(payload.player));
                break;
            case 'balls_sub':
                if (payload && payload.player) postBalls('sub', String(payload.player));
                break;
            case 'select_breaker':
                if (payload && payload.slot && typeof onPlayerSlotButton === 'function') {
                    onPlayerSlotButton(String(payload.slot));
                } else if (payload && payload.slot) {
                    selectRackBreaker(String(payload.slot));
                }
                break;
            case 'toggle_active_player':
                if (typeof onPlayerSlotButton === 'function') {
                    onPlayerSlotButton(payload && payload.isP1 === false ? '2' : '1');
                } else if (payload && typeof payload.isP1 === 'boolean') {
                    togglePlayer(payload.isP1);
                }
                break;
            case 'player_slot':
                if (payload && payload.slot) {
                    const slot = String(payload.slot);
                    const breakerPick = payload.mode === 'breaker' ||
                        (typeof isPlayerSlotPickerBreakerMode === 'function' && isPlayerSlotPickerBreakerMode());
                    if (breakerPick && typeof selectRackBreaker === 'function') {
                        selectRackBreaker(slot);
                    } else if (typeof onPlayerSlotButton === 'function') {
                        onPlayerSlotButton(slot);
                    } else if (typeof selectRackBreaker === 'function') {
                        selectRackBreaker(slot);
                    }
                }
                break;
            case 'set_player_name': {
                const slot = payload && payload.slot;
                const name = payload && payload.name != null ? String(payload.name) : '';
                if (slot === '1' || slot === 1) {
                    const el = document.getElementById('p1Name');
                    if (el) el.value = name.substring(0, 20);
                } else if (slot === '2' || slot === 2) {
                    const el = document.getElementById('p2Name');
                    if (el) el.value = name.substring(0, 20);
                }
                postNames();
                break;
            }
            case 'set_race': {
                const el = document.getElementById('raceInfoTxt');
                if (el && payload) el.value = String(payload.value != null ? payload.value : '');
                postInfo();
                break;
            }
            case 'set_game_info': {
                const el = document.getElementById('gameInfoTxt');
                if (el && payload) el.value = String(payload.value != null ? payload.value : '').substring(0, 60);
                postInfo();
                break;
            }
            case 'set_game_type':
                if (payload && payload.gameType) gameType(String(payload.gameType));
                break;
            case 'toggle_pot':
            case 'snooker_ball': {
                const ballId = payload && payload.ballId;
                const el = ballId ? document.getElementById(ballId) : null;
                if (el) {
                    if (typeof isSnookerBallMode === 'function' && isSnookerBallMode() &&
                        typeof handleSnookerBallClick === 'function') {
                        return Promise.resolve(handleSnookerBallClick(el)).then(function () {
                            pushStateAfterCommand(200);
                        });
                    }
                    togglePot(el);
                    pushStateAfterCommand(200);
                    return;
                }
                break;
            }
            case 'reset_scores':
                performResetScores();
                break;
            case 'end_match':
                performResetScores({ endMatch: true });
                break;
            case 'call_match_early':
                performCallGame();
                break;
            case 'instant_replay':
                triggerInstantReplay();
                break;
            case 'toggle_monitoring':
                toggleReplayMonitoring();
                break;
            case 'play_clip':
                if (payload && payload.index != null) playPreviousReplay(parseInt(payload.index, 10));
                break;
            case 'undo':
                if (typeof undoLastScoringAction === 'function') {
                    return Promise.resolve(undoLastScoringAction()).then(function () {
                        pushStateAfterCommand();
                    });
                }
                break;
            default:
                console.warn('cloud_commands: unknown action', action);
        }

        pushStateAfterCommand();
    }

    function pushStateAfterCommand(delayMs) {
        if (window.cloudRelay && typeof window.cloudRelay.pushDockStateSoon === 'function') {
            window.cloudRelay.pushDockStateSoon(delayMs == null ? 80 : delayMs);
        } else if (window.streamSharing && typeof window.streamSharing.sendUpdate === 'function') {
            setTimeout(function () { window.streamSharing.sendUpdate(); }, delayMs == null ? 80 : delayMs);
        }
    }

    function initCloudCommands() {
        if (!window.cloudRelay) return;
        window.cloudRelay.onCommand(function (action, payload) {
            Promise.resolve(runCommand(action, payload)).catch(function (err) {
                console.error('cloud_commands:', err);
            });
        });
    }

    window.cloudCommands = { runCommand, initCloudCommands };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCloudCommands);
    } else {
        initCloudCommands();
    }
})();
