'use strict';

/**
 * Executes CueSport Cloud commands on the dock by calling the same control_panel
 * functions the OBS UI uses. Mobile is a thin remote — scoring rules stay on the dock.
 */
(function () {
    function isFoulBallId(ballId) {
        if (ballId === 'poolFoulBtn') {
            return true;
        }
        // Snooker only: ball 11 is the foul control. In 8/9/10/Straight/etc. it is an object ball.
        if (ballId === 'ball 11' && typeof isSnookerBallMode === 'function' && isSnookerBallMode()) {
            return true;
        }
        return false;
    }

    function isActionBallId(ballId) {
        return ballId === 'poolFoulBtn' ||
            ballId === 'poolRespotBtn' ||
            ballId === 'snookerUndoBtn' ||
            isFoulBallId(ballId);
    }

    /** Route tracker action controls (foul / undo / respot) — never silent-drop guest/admin remotes. */
    function runActionBallRemote(ballId) {
        if (ballId === 'snookerUndoBtn') {
            if (typeof undoLastScoringAction === 'function') {
                return Promise.resolve(undoLastScoringAction()).then(publishAfterScoring);
            }
            return Promise.resolve();
        }
        if (ballId === 'poolFoulBtn') {
            if (typeof applyPoolFoul === 'function') {
                applyPoolFoul();
            } else if (typeof window.applyPoolFoul === 'function') {
                window.applyPoolFoul();
            }
            return Promise.resolve().then(publishAfterScoring);
        }
        // Snooker foul needs foulKey (snooker_foul). Respot needs a target ball (respot_ball).
        if (ballId === 'poolRespotBtn' || isFoulBallId(ballId)) {
            return Promise.resolve();
        }
        return null;
    }

    /** Drop stale in-flight snapshots, then publish authoritative dock state. */
    function publishAfterScoring() {
        if (window.streamSharing && typeof window.streamSharing.invalidatePendingPublishes === 'function') {
            window.streamSharing.invalidatePendingPublishes();
        }
        if (window.streamSharing && typeof window.streamSharing.sendUpdate === 'function') {
            window.streamSharing.sendUpdate();
            return;
        }
        if (window.cloudRelay && typeof window.cloudRelay.pushDockStateSoon === 'function') {
            window.cloudRelay.pushDockStateSoon(0);
        }
    }

    /** Apply ball variant from mobile without toggleBallSelection guard rails reverting the pick. */
    function applyRemoteBallSelection(value) {
        const val = String(value || 'american');
        const currentGame = typeof getStoredGameType === 'function'
            ? getStoredGameType()
            : (document.getElementById('gameTypeSelect') ? document.getElementById('gameTypeSelect').value : 'game1');
        if (currentGame === 'game2' || currentGame === 'game3') {
            return;
        }
        if (val === 'snooker' && currentGame !== 'game7' && currentGame !== 'game8') {
            return;
        }
        if (typeof setStorageItem === 'function') {
            setStorageItem('ballSelection', val);
        }
        const el = document.getElementById('ballSelection');
        if (el) {
            el.value = val;
        }
        if (typeof updateControlPanelBallImages === 'function') {
            updateControlPanelBallImages(val);
        }
        if (typeof ballType === 'function') {
            ballType(val);
        }
        if (typeof applySnookerTrackerLayout === 'function') {
            applySnookerTrackerLayout();
        }
        if (typeof updateSnookerUiVisibility === 'function') {
            updateSnookerUiVisibility();
        }
        if (typeof syncBallDisplayControls === 'function') {
            syncBallDisplayControls();
        }
        if (typeof bc !== 'undefined' && bc && typeof bc.postMessage === 'function') {
            const displayOn = typeof isBallDisplayEnabled === 'function' ? isBallDisplayEnabled() : false;
            bc.postMessage({ ballSelection: val, displayBallTracker: displayOn });
        }
    }

    function runCommand(action, payload) {
        switch (action) {
            case 'score_add':
                if (payload && payload.player) postScore('add', String(payload.player));
                return Promise.resolve().then(publishAfterScoring);
            case 'score_sub':
                if (payload && payload.player) postScore('sub', String(payload.player));
                return Promise.resolve().then(publishAfterScoring);
            case 'balls_add':
                if (payload && payload.player) postBalls('add', String(payload.player));
                return Promise.resolve().then(publishAfterScoring);
            case 'balls_sub':
                if (payload && payload.player) postBalls('sub', String(payload.player));
                return Promise.resolve().then(publishAfterScoring);
            case 'select_breaker':
                if (payload && payload.slot && typeof onPlayerSlotButton === 'function') {
                    onPlayerSlotButton(String(payload.slot));
                } else if (payload && payload.slot) {
                    selectRackBreaker(String(payload.slot));
                }
                return Promise.resolve().then(publishAfterScoring);
            case 'toggle_active_player': {
                const targetSlot = payload && payload.isP1 === false ? '2' : '1';
                if (typeof getActivePlayerSlot === 'function' &&
                    typeof isPlayerSlotPickerBreakerMode === 'function' &&
                    !isPlayerSlotPickerBreakerMode() &&
                    getActivePlayerSlot() === targetSlot) {
                    return Promise.resolve();
                }
                if (typeof onPlayerSlotButton === 'function') {
                    onPlayerSlotButton(targetSlot);
                } else if (payload && typeof payload.isP1 === 'boolean') {
                    togglePlayer(payload.isP1);
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'player_slot':
                if (payload && payload.slot) {
                    const slot = String(payload.slot);
                    const breakerPick = payload.mode === 'breaker' ||
                        (typeof isPlayerSlotPickerBreakerMode === 'function' && isPlayerSlotPickerBreakerMode());
                    if (!breakerPick &&
                        typeof getActivePlayerSlot === 'function' &&
                        getActivePlayerSlot() === slot) {
                        return Promise.resolve();
                    }
                    if (breakerPick && typeof selectRackBreaker === 'function') {
                        selectRackBreaker(slot);
                    } else if (typeof onPlayerSlotButton === 'function') {
                        onPlayerSlotButton(slot);
                    } else if (typeof selectRackBreaker === 'function') {
                        selectRackBreaker(slot);
                    }
                }
                return Promise.resolve().then(publishAfterScoring);
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
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_race': {
                const el = document.getElementById('raceInfoTxt');
                if (el && payload) el.value = String(payload.value != null ? payload.value : '');
                postInfo();
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_game_info': {
                const el = document.getElementById('gameInfoTxt');
                if (el && payload) el.value = String(payload.value != null ? payload.value : '').substring(0, 60);
                postInfo();
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_game_type':
                if (payload && payload.gameType && typeof gameType === 'function') {
                    return Promise.resolve(gameType(String(payload.gameType))).then(publishAfterScoring);
                }
                return Promise.resolve();
            case 'set_early_game_ball': {
                const cb = document.getElementById('earlyGameBallCheckbox');
                if (cb && payload && typeof payload.enabled === 'boolean') {
                    cb.checked = payload.enabled;
                    if (typeof earlyGameBallToggle === 'function') earlyGameBallToggle();
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_snooker_gold': {
                const cb = document.getElementById('snookerGoldCheckbox');
                if (cb && payload && typeof payload.enabled === 'boolean') {
                    cb.checked = payload.enabled;
                    if (typeof snookerGoldToggle === 'function') snookerGoldToggle();
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_point_based': {
                const cb = document.getElementById('pointBased');
                if (cb && payload && typeof payload.enabled === 'boolean') {
                    cb.checked = payload.enabled;
                    if (typeof pointBasedSetting === 'function') pointBasedSetting();
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_ball_selection': {
                const val = payload && payload.value ? String(payload.value) : '';
                if (val) applyRemoteBallSelection(val);
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_use_ball_set': {
                const cb = document.getElementById('ballSetCheckbox');
                if (cb && payload && typeof payload.enabled === 'boolean') {
                    cb.checked = payload.enabled;
                    if (typeof useBallSetToggle === 'function') useBallSetToggle();
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'set_player_ball_set': {
                const val = payload && payload.value ? String(payload.value) : '';
                if (val) {
                    const radio = document.querySelector('input[name="p1BallSetSelect"][value="' + val + '"]');
                    if (radio) {
                        radio.checked = true;
                        if (typeof ballSetChange === 'function') ballSetChange();
                    }
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'toggle_pot':
            case 'snooker_ball': {
                const ballId = payload && payload.ballId;
                // Free Ball is ball 10 — not an action-control id; must reach handleSnookerBallClick.
                if (isActionBallId(ballId)) {
                    const handled = runActionBallRemote(ballId);
                    return handled || Promise.resolve();
                }
                const el = ballId ? document.getElementById(ballId) : null;
                if (!el) return Promise.resolve();
                if (typeof isSnookerBallMode === 'function' && isSnookerBallMode() &&
                    typeof handleSnookerBallClick === 'function') {
                    return Promise.resolve(handleSnookerBallClick(el)).then(publishAfterScoring);
                }
                togglePot(el);
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'snooker_foul': {
                if (!payload || !payload.foulKey) return Promise.resolve();
                if (typeof cancelSnookerFoul === 'function') {
                    cancelSnookerFoul();
                }
                const apply = typeof applySnookerFoulByKey === 'function'
                    ? applySnookerFoulByKey
                    : (typeof window.applySnookerFoulByKey === 'function' ? window.applySnookerFoulByKey : null);
                if (apply) apply(String(payload.foulKey));
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'pool_foul': {
                if (typeof applyPoolFoul === 'function') {
                    applyPoolFoul();
                } else if (typeof window.applyPoolFoul === 'function') {
                    window.applyPoolFoul();
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'respot_ball': {
                const ballId = payload && payload.ballId ? String(payload.ballId) : '';
                if (ballId && typeof applyRespotBall === 'function') {
                    applyRespotBall(ballId);
                } else if (ballId && typeof window.applyRespotBall === 'function') {
                    window.applyRespotBall(ballId);
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'reset_scores':
                if (typeof window.canResetOrEndMatch === 'function' && !window.canResetOrEndMatch()) {
                    return Promise.resolve();
                }
                performResetScores();
                return Promise.resolve().then(publishAfterScoring);
            case 'abandon_match': {
                const message = (payload && payload.message)
                    ? String(payload.message)
                    : 'This match was killed from CueSport Cloud. The game has been cleared.';
                if (typeof window.applyCloudMatchAbandon === 'function') {
                    window.applyCloudMatchAbandon(Object.assign({}, payload || {}, { message: message }));
                } else if (typeof window.resetCurrentGame === 'function') {
                    try { window.alert(message); } catch (_) { /* ignore */ }
                    window.resetCurrentGame({ fromCloudAbandon: true });
                }
                return Promise.resolve().then(publishAfterScoring);
            }
            case 'end_match':
                if (typeof window.canResetOrEndMatch === 'function' && !window.canResetOrEndMatch()) {
                    return Promise.resolve();
                }
                performResetScores({ endMatch: true });
                return Promise.resolve().then(publishAfterScoring);
            case 'call_match_early':
                performCallGame();
                return Promise.resolve().then(publishAfterScoring);
            case 'instant_replay':
                return Promise.resolve(
                    typeof triggerInstantReplay === 'function' ? triggerInstantReplay() : undefined
                ).then(publishAfterScoring);
            case 'toggle_monitoring':
                return Promise.resolve(
                    typeof toggleReplayMonitoring === 'function' ? toggleReplayMonitoring() : undefined
                ).then(publishAfterScoring);
            case 'toggle_streaming':
                if (typeof window.toggleObsStreaming !== 'function') {
                    return Promise.reject(new Error('Streaming control is unavailable — reload the OBS dock'));
                }
                return Promise.resolve(window.toggleObsStreaming()).then(publishAfterScoring);
            case 'set_replay_controls': {
                const enabled = !!(payload && payload.enabled);
                if (typeof window.setReplayControlsEnabled !== 'function') {
                    return Promise.reject(new Error('Replay controls are unavailable — reload the OBS dock'));
                }
                return Promise.resolve(window.setReplayControlsEnabled(enabled)).then(publishAfterScoring);
            }
            case 'toggle_overlay_stats': {
                const mode = payload && payload.mode ? String(payload.mode) : '';
                if (!mode || (mode !== 'p1' && mode !== 'p2' && mode !== 'h2h')) {
                    return Promise.resolve();
                }
                if (typeof window.toggleOverlayStats !== 'function') {
                    return Promise.reject(new Error('Overlay stats are unavailable — reload the OBS dock'));
                }
                return Promise.resolve(window.toggleOverlayStats(mode)).then(publishAfterScoring);
            }
            case 'play_clip':
                if (payload && payload.index != null && typeof playPreviousReplay === 'function') {
                    return Promise.resolve(playPreviousReplay(parseInt(payload.index, 10))).then(publishAfterScoring);
                }
                return Promise.resolve();
            case 'delete_clip':
                if (payload && payload.index != null && typeof deleteClip === 'function') {
                    deleteClip(parseInt(payload.index, 10), null, { skipConfirm: true });
                    return Promise.resolve().then(publishAfterScoring);
                }
                return Promise.resolve();
            case 'undo':
                if (typeof undoLastScoringAction === 'function') {
                    return Promise.resolve(undoLastScoringAction()).then(publishAfterScoring);
                }
                return Promise.resolve();
            default:
                console.warn('cloud_commands: unknown action', action);
                return Promise.resolve();
        }
    }

    function initCloudCommands() {
        if (!window.cloudRelay) return;
        if (window.__cloudCommandsBound) return;
        window.__cloudCommandsBound = true;
        window.cloudRelay.onCommand(function (action, payload) {
            Promise.resolve(runCommand(action, payload)).catch(function (err) {
                console.error('cloud_commands:', err);
                if ((action === 'toggle_streaming' || action === 'set_replay_controls') && typeof alert === 'function') {
                    alert(err && err.message ? err.message : 'Command failed');
                }
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
