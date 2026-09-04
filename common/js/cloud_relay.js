'use strict';

/**
 * CueSport Cloud relay client — WebSocket room hub for dock, mobile, and stream listing.
 */
(function () {
    const STORAGE_PREFIX = 'cloudRelay_';

    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const INITIAL_RECONNECT_DELAY = 1000;
    const MAX_RECONNECT_DELAY = 60000;

    let isEnabled = false;
    let isConnected = false;
    let isJoined = false;
    let isBlockedByServer = false;
    let blockedReason = null;
    let replaying = false;
    let lastState = {};
    let commandHandlers = [];
    let stateHandlers = [];
    let presenceHandlers = [];
    let hadControlClient = false;
    /** request_id -> { resolve, reject, timer } for stats over WebSocket */
    const pendingStats = new Map();

    /** Enable players, score display, and Ball Scoring when mobile/guest first joins. */
    function ensureBallScoringForMobileControl() {
        try {
            let changed = false;

            function enablePlayerIfNeeded(slot) {
                const key = 'usePlayer' + slot;
                if (dockStorage(key, 'no') === 'yes') {
                    return;
                }
                const cb = document.getElementById('usePlayer' + slot + 'Setting');
                if (cb) {
                    cb.checked = true;
                }
                if (typeof playerSetting === 'function') {
                    playerSetting(slot);
                } else if (typeof window.setStorageItem === 'function') {
                    window.setStorageItem(key, 'yes');
                }
                changed = true;
            }

            enablePlayerIfNeeded(1);
            enablePlayerIfNeeded(2);

            const bothPlayers =
                dockStorage('usePlayer1', 'no') === 'yes' &&
                dockStorage('usePlayer2', 'no') === 'yes';
            if (!bothPlayers) {
                return changed;
            }

            // Score Display is required for Ball Scoring / mobile score controls.
            if (dockStorage('scoreDisplay', 'yes') !== 'yes') {
                const scoreCb = document.getElementById('scoreDisplay');
                if (scoreCb) {
                    scoreCb.disabled = false;
                    scoreCb.checked = true;
                }
                if (typeof scoreDisplaySetting === 'function') {
                    scoreDisplaySetting();
                } else if (typeof window.setStorageItem === 'function') {
                    window.setStorageItem('scoreDisplay', 'yes');
                    if (typeof syncScoreDisplayDependentUI === 'function') {
                        syncScoreDisplayDependentUI();
                    }
                }
                changed = true;
            } else {
                const scoreCb = document.getElementById('scoreDisplay');
                if (scoreCb) {
                    scoreCb.disabled = false;
                    if (!scoreCb.checked) {
                        scoreCb.checked = true;
                        if (typeof scoreDisplaySetting === 'function') {
                            scoreDisplaySetting();
                        }
                        changed = true;
                    }
                }
            }

            if (dockStorage('enableBallTracker', 'no') === 'yes') {
                if (changed) {
                    console.log('CueSport Cloud: enabled players/score display for mobile/guest control');
                }
                return changed;
            }

            const checkbox = document.getElementById('ballTrackerCheckbox');
            if (checkbox) {
                checkbox.disabled = false;
                checkbox.checked = true;
            }
            if (typeof useBallTracker === 'function') {
                useBallTracker();
            } else if (typeof window.setStorageItem === 'function') {
                window.setStorageItem('enableBallTracker', 'yes');
            }
            console.log('CueSport Cloud: enabled players, score display, and Ball Scoring for mobile/guest control');
            return true;
        } catch (err) {
            console.error('CueSport Cloud: failed to enable scoring prerequisites for mobile:', err);
            return false;
        }
    }

    function handlePresenceForControlClients(clients) {
        const list = Array.isArray(clients) ? clients : [];
        const hasControl = list.includes('mobile') || list.includes('mobile_guest');
        if (hasControl && !hadControlClient) {
            ensureBallScoringForMobileControl();
        }
        hadControlClient = hasControl;
        if (hasControl) {
            pushDockStateSoon(0);
        }
    }

    function instanceKey(key) {
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        const prefixed = STORAGE_PREFIX + key;
        return instanceId ? `${instanceId}_${prefixed}` : prefixed;
    }

    function getStorageItem(key) {
        return localStorage.getItem(instanceKey(key));
    }

    function setStorageItem(key, value) {
        localStorage.setItem(instanceKey(key), value);
    }

    function getServerUrl() {
        return (getStorageItem('serverUrl') || 'https://cuesports.macleod.systems').replace(/\/$/, '');
    }

    function getWsUrl() {
        let base = getServerUrl();
        if (base.startsWith('https://')) base = base.replace('https://', 'wss://');
        else if (base.startsWith('http://')) base = base.replace('http://', 'ws://');
        else if (!base.startsWith('ws')) base = 'wss://' + base;
        return base.replace(/\/$/, '') + '/ws';
    }

    function getRoomId() {
        return getStorageItem('roomId') || '';
    }

    function getAccessToken() {
        return getStorageItem('accessToken') || '';
    }

    function getApiKey() {
        return getStorageItem('apiKey') || '';
    }

    function getClientType() {
        return 'dock';
    }

    function onCommand(fn) {
        if (typeof fn === 'function') commandHandlers.push(fn);
    }

    function onState(fn) {
        if (typeof fn === 'function') stateHandlers.push(fn);
    }

    function onPresence(fn) {
        if (typeof fn === 'function') presenceHandlers.push(fn);
    }

    function dispatchCommand(msg) {
        if (!msg || msg.source === 'dock') return;
        if (!isJoined) {
            console.warn('cloudRelay: command ignored (not joined):', msg.action);
            return;
        }
        replaying = true;
        const pending = [];
        try {
            for (const fn of commandHandlers) {
                pending.push(Promise.resolve(fn(msg.action, msg.payload || {}, msg)));
            }
        } catch (err) {
            replaying = false;
            throw err;
        }
        Promise.all(pending).catch(function (err) {
            console.error('cloudRelay command handler error', err);
        }).finally(function () {
            replaying = false;
        });
    }

    function dispatchState(state) {
        lastState = state || {};
        for (const fn of stateHandlers) {
            fn(lastState);
        }
    }

    function sendRaw(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
            return true;
        }
        return false;
    }

    function getInstanceKey() {
        return new URLSearchParams(window.location.search).get('instance') || 'default';
    }

    function sendJoin() {
        const roomId = getRoomId();
        const msg = {
            type: 'join',
            client: getClientType(),
            instance_id: getInstanceKey(),
        };
        if (roomId) msg.room_id = roomId;
        const token = getAccessToken();
        const apiKey = getApiKey();
        if (token) msg.access_token = token;
        else if (apiKey) msg.api_key = apiKey;
        else {
            console.warn('cloudRelay: no access_token or api_key');
            return false;
        }
        return sendRaw(msg);
    }

    function sendEvent(payload) {
        if (!isJoined || replaying) return false;
        return sendRaw({
            type: 'event',
            room_id: getRoomId(),
            payload: payload,
            source: 'dock',
            ts: new Date().toISOString(),
        });
    }

    function sendCommand(action, payload) {
        if (!isJoined) return false;
        return sendRaw({
            type: 'command',
            room_id: getRoomId(),
            action: action,
            payload: payload || {},
            source: 'dock',
            ts: new Date().toISOString(),
        });
    }

    /** Read dock storage (instance-aware) — not cloudRelay_ prefixed keys */
    function dockStorage(key, fallback) {
        if (typeof window.getStorageItem === 'function') {
            const v = window.getStorageItem(key);
            return v != null ? v : fallback;
        }
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        const prefixed = instanceId ? `${instanceId}_${key}` : key;
        const v = localStorage.getItem(prefixed);
        return v != null ? v : fallback;
    }

    function imageFileName(img) {
        if (!img || !img.getAttribute('src')) return '';
        const raw = img.getAttribute('src') || '';
        try {
            return decodeURIComponent(raw.split('/').pop().split('?')[0]);
        } catch (_) {
            return '';
        }
    }

    function computeRackBreakerPromptEnabled() {
        if (typeof window.isRackBreakerPromptEnabled === 'function') {
            return window.isRackBreakerPromptEnabled();
        }
        const bothPlayers =
            dockStorage('usePlayer1', 'no') === 'yes' &&
            dockStorage('usePlayer2', 'no') === 'yes';
        if (!bothPlayers) {
            return false;
        }
        const type = dockStorage('gameType', 'game1') || 'game1';
        return type === 'game1' || type === 'game2' || type === 'game3' ||
            type === 'game4' || type === 'game5' || type === 'game6' ||
            type === 'game7' || type === 'game8';
    }

    function computeBallTrackerVisible() {
        if (typeof window.isBallTrackerControlsVisible === 'function') {
            return window.isBallTrackerControlsVisible();
        }
        if (dockStorage('enableBallTracker', 'no') !== 'yes') {
            return false;
        }
        return dockStorage('usePlayer1', 'no') === 'yes' &&
            dockStorage('usePlayer2', 'no') === 'yes' &&
            dockStorage('scoreDisplay', 'yes') === 'yes';
    }

    function computePlayerSlotPickerVisible(ballTrackerVisible, rackBreakerPromptEnabled) {
        if (!ballTrackerVisible) {
            return false;
        }
        return dockStorage('usePlayerToggle', 'no') === 'yes' || rackBreakerPromptEnabled;
    }

    function computeAwaitingBreaker(hasRackBreaker, gameScoringLocked) {
        const tracker = document.getElementById('ballTrackerDiv');
        if (tracker && tracker.classList.contains('ball-tracker-awaiting-breaker')) {
            return true;
        }
        if (gameScoringLocked || hasRackBreaker) {
            return false;
        }
        if (typeof window.isRackBreakerBallGridLockEnabled === 'function' &&
            typeof window.getRackBreakerSlot === 'function') {
            return window.isRackBreakerBallGridLockEnabled() && !window.getRackBreakerSlot();
        }
        const rackBreakerPromptEnabled = computeRackBreakerPromptEnabled();
        return dockStorage('enableBallTracker', 'no') === 'yes' &&
            rackBreakerPromptEnabled &&
            !hasRackBreaker;
    }

    function collectBallGridSnapshot() {
        if (typeof window.updateSnookerBallAvailability === 'function') {
            window.updateSnookerBallAvailability();
        }
        if (typeof window.updateScoringUndoButton === 'function') {
            window.updateScoringUndoButton();
        }
        const tracker = document.getElementById('ballTrackerDiv');
        const undoEl = document.getElementById('snookerUndoBtn');
        const snooker = typeof window.isSnookerBallMode === 'function' && window.isSnookerBallMode();
        const ballTrackerVisible = computeBallTrackerVisible();
        // Mobile remote: export balls whenever ball scoring is on (ignore Controls-tab noShow).
        const visible = !!ballTrackerVisible;
        const rackBreakerSlotRaw = dockStorage('rackBreakerSlot', '') || '';
        const hasRackBreaker = rackBreakerSlotRaw === '1' || rackBreakerSlotRaw === '2';
        const gameScoringLocked = typeof window.isGameScoringLocked === 'function'
            ? window.isGameScoringLocked()
            : !!(tracker && tracker.classList.contains('ball-tracker-locked'));
        const awaitingBreaker = computeAwaitingBreaker(hasRackBreaker, gameScoringLocked);
        const locked = !!(tracker && tracker.classList.contains('ball-tracker-locked')) ||
            (typeof window.isGameScoringLocked === 'function' && window.isGameScoringLocked());
        const balls = [];
        if (tracker) {
            tracker.querySelectorAll('.ball').forEach(function (el) {
                if (el.id === 'snookerUndoBtn' || el.id === 'poolFoulBtn') {
                    // Always include the pool foul control for mobile (not an object ball).
                    if (el.id === 'poolFoulBtn') {
                        balls.push({
                            id: el.id,
                            file: imageFileName(el.querySelector('img')),
                            title: 'Foul',
                            hidden: el.classList.contains('noShow'),
                            faded: false,
                            disabled: el.classList.contains('snooker-ball-disabled') ||
                                el.getAttribute('aria-disabled') === 'true',
                            foul: true,
                            freeball: false,
                        });
                    }
                    return;
                }
                const img = el.querySelector('img');
                const hidden = el.classList.contains('noShow') ||
                    el.classList.contains('snooker-spacer') ||
                    (img && img.style.display === 'none');
                balls.push({
                    id: el.id,
                    file: imageFileName(img),
                    title: el.getAttribute('title') || el.id,
                    hidden: !!hidden,
                    faded: el.classList.contains('faded'),
                    disabled: el.classList.contains('snooker-ball-disabled') ||
                        el.classList.contains('ball-win-cooldown') ||
                        el.getAttribute('aria-disabled') === 'true',
                    cooldown: el.classList.contains('ball-win-cooldown'),
                    clicked: el.classList.contains('snooker-ball-clicked'),
                    // Roles match control_panel SNOOKER_BALL_META — do not infer from title text.
                    foul: snooker && el.id === 'ball 11',
                    freeball: snooker && el.id === 'ball 10',
                });
            });
        }
        const undoDisabled = !undoEl ||
            undoEl.classList.contains('snooker-ball-disabled') ||
            undoEl.getAttribute('aria-disabled') === 'true' ||
            undoEl.classList.contains('noShow');
        const snookerFoulTargets = [];
        if (snooker) {
            const foulContainer = document.getElementById('snookerFoulTargets');
            if (foulContainer) {
                foulContainer.querySelectorAll('[data-foul]').forEach(function (el) {
                    if (el.classList.contains('noShow')) return;
                    const key = el.getAttribute('data-foul');
                    if (!key) return;
                    const img = el.querySelector('img');
                    snookerFoulTargets.push({
                        key: key,
                        file: imageFileName(img),
                        alt: (img && img.alt) ? img.alt : key,
                    });
                });
            }
        }
        return {
            visible: visible,
            snooker: !!snooker,
            awaitingBreaker: awaitingBreaker,
            locked: locked,
            canUndo: !undoDisabled && visible,
            balls: balls,
            snookerFoulTargets: snookerFoulTargets,
            foulsP1: typeof window.getRackFouls === 'function'
                ? window.getRackFouls('1')
                : Math.max(0, parseInt(dockStorage('snookerFrameFoulsP1', '0') || '0', 10) || 0),
            foulsP2: typeof window.getRackFouls === 'function'
                ? window.getRackFouls('2')
                : Math.max(0, parseInt(dockStorage('snookerFrameFoulsP2', '0') || '0', 10) || 0),
        };
    }

    async function collectExtendedGameState(baseState) {
        const state = Object.assign({}, baseState || {});
        try {
            state.rackBreakerSlot = dockStorage('rackBreakerSlot', '') || '';
            state.activePlayer = dockStorage('activePlayer', '1') || '1';
            try {
                state.ballState = JSON.parse(dockStorage('ballState', '{}') || '{}');
            } catch (_) {
                state.ballState = {};
            }
            state.ballScoringEnabled = dockStorage('enableBallTracker', 'no') === 'yes';
            state.ballTrackerEnabled = baseState && baseState.ballTrackerEnabled === true
                ? true
                : state.ballScoringEnabled;
            const rackBreakerPromptEnabled = computeRackBreakerPromptEnabled();
            const rackBreakerSlotRaw = dockStorage('rackBreakerSlot', '') || '';
            const hasRackBreaker = rackBreakerSlotRaw === '1' || rackBreakerSlotRaw === '2';
            state.rackBreakerSlot = hasRackBreaker ? rackBreakerSlotRaw : '';
            state.gameScoringLocked = typeof window.isGameScoringLocked === 'function'
                ? window.isGameScoringLocked()
                : false;
            state.awaitingBreaker = computeAwaitingBreaker(hasRackBreaker, state.gameScoringLocked);
            state.breakerPromptVisible = typeof window.isPlayerSlotPickerBreakerMode === 'function'
                ? window.isPlayerSlotPickerBreakerMode()
                : (rackBreakerPromptEnabled && !hasRackBreaker);
            state.playerSlotPickerVisible = computePlayerSlotPickerVisible(
                computeBallTrackerVisible(),
                rackBreakerPromptEnabled
            );
            if (!state.playerSlotPickerVisible || !rackBreakerPromptEnabled) {
                state.playerSlotMode = 'off';
            } else if (hasRackBreaker) {
                state.playerSlotMode = 'active';
            } else if (state.gameScoringLocked && state.breakerPromptVisible) {
                state.playerSlotMode = 'match_locked';
            } else if (state.breakerPromptVisible) {
                state.playerSlotMode = 'breaker';
            } else {
                state.playerSlotMode = 'off';
            }
            state.obsConnected = dockStorage('isConnected', 'false') === 'true';
            // "Enable Replay and Promotion Function" toggle (persists across reconnects).
            state.replayEnabled = dockStorage('websocketEnabled', 'false') === 'true' || state.obsConnected;
            // Prefer storage; also trust control_panel Monitor / Instant Replay button labels.
            const monitorBtn = document.getElementById('btnMonitorGame');
            const instantBtn = document.getElementById('btnReplayClip');
            const monitoringFromStorage = dockStorage('isMonitoringActive', 'false') === 'true';
            const monitoringFromUi = !!(
                (monitorBtn && /stop\s*monitoring/i.test(monitorBtn.textContent || '')) ||
                (instantBtn && !instantBtn.classList.contains('noShow'))
            );
            state.monitoringActive = monitoringFromStorage || monitoringFromUi;
            state.replayPlaybackActive = typeof isReplayPlaybackActive === 'boolean'
                ? !!isReplayPlaybackActive
                : /replay\s*active/i.test((document.getElementById('btnMonitorGame') || {}).textContent || '');
            // replayHistory is stored without instance prefix (matches control_panel.js)
            let replayHistory = [];
            try {
                const raw = localStorage.getItem('replayHistory');
                replayHistory = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(replayHistory)) replayHistory = [];
            } catch (_) {
                replayHistory = [];
            }
            state.replayClipCount = replayHistory.length;
            state.replayClips = [0, 1, 2, 3, 4].map(function (i) {
                if (replayHistory[i]) return true;
                const clipBtn = document.getElementById('prvReplayClip' + (i + 1));
                if (!clipBtn) return false;
                // control_panel sets display to inline-block when the slot has a clip
                return clipBtn.style.display === 'inline-block' ||
                    (clipBtn.style.display !== 'none' && !clipBtn.disabled && clipBtn.offsetParent !== null);
            });
            if (!state.replayClipCount) {
                state.replayClipCount = state.replayClips.filter(Boolean).length;
            }            // Match control_panel updateCallGameButton: never call early once race is complete.
            state.canCallGame = !state.gameScoringLocked &&
                window.PlayerStats &&
                typeof window.PlayerStats.canCallGame === 'function' &&
                window.PlayerStats.canCallGame();
            if (!state.gameType) {
                state.gameType = dockStorage('gameType', 'game1') || 'game1';
            }
            state.ballSelection = dockStorage('ballSelection', 'american') || 'american';
            state.snookerGoldEnabled = dockStorage('snookerGoldEnabled', 'no') === 'yes';
            state.pointBased = dockStorage('pointBased', 'no');
            state.useBallSet = dockStorage('useBallSet', 'no') === 'yes';
            state.playerBallSet = dockStorage('playerBallSet', 'p1Open') || 'p1Open';
            const gt = state.gameType || dockStorage('gameType', 'game1') || 'game1';
            if (gt === 'game1') {
                state.earlyGameBallEnabled = dockStorage('winOnBreakEnabled', 'no') === 'yes';
            } else if (gt === 'game2') {
                state.earlyGameBallEnabled = dockStorage('earlyGameBallEnabled9', 'no') === 'yes';
            } else if (gt === 'game3') {
                state.earlyGameBallEnabled = dockStorage('earlyGameBallEnabled10', 'no') === 'yes';
            } else {
                state.earlyGameBallEnabled = false;
            }
            state.snookerFreeBallOffered = dockStorage('snookerFreeBallOffered', 'no') === 'yes';
            state.snookerPhase = dockStorage('snookerPhase', 'red') || 'red';
            state.dualScoreMode = typeof window.isDualScoreMode === 'function'
                ? window.isDualScoreMode()
                : (state.gameType === 'game5' || state.gameType === 'game6' || state.gameType === 'game8' ||
                    (state.gameType === 'game7' && (state.pointBased === 'yes' || dockStorage('pointBased', 'no') === 'yes')));
            state.primaryScoreLabel = typeof window.getPrimaryScoreSuffix === 'function'
                ? window.getPrimaryScoreSuffix()
                : (state.gameType === 'game8' ? 'Frames' : (state.gameType === 'game4' ? 'Balls' : 'Racks'));
            state.secondaryScoreLabel = typeof window.getSecondaryScoreSuffix === 'function'
                ? window.getSecondaryScoreSuffix()
                : (state.gameType === 'game8' ? 'Points' : 'Balls');
            state.raceLabel = state.gameType === 'game8' ? 'Best Of' : 'Race';
            function undoStackLen(key) {
                try {
                    const arr = JSON.parse(dockStorage(key, '[]') || '[]');
                    return Array.isArray(arr) ? arr.length : 0;
                } catch (_) {
                    return 0;
                }
            }
            const snookerMode = typeof window.isSnookerBallMode === 'function'
                ? window.isSnookerBallMode()
                : state.gameType === 'game8';
            state.canUndo = snookerMode
                ? (undoStackLen('snookerUndoStack') > 0 || undoStackLen('scoringUndoStack') > 0)
                : undoStackLen('scoringUndoStack') > 0;
            state.ballGrid = collectBallGridSnapshot();
            state.ballGrid.awaitingBreaker = state.awaitingBreaker;
            state.ballGrid.locked = state.gameScoringLocked;
            state.ballGrid.canUndo = state.canUndo;
            // Match progress heuristics for mobile UI
            const p1 = Number(state.p1Score) || 0;
            const p2 = Number(state.p2Score) || 0;
            const p1b = Number(state.p1Balls) || 0;
            const p2b = Number(state.p2Balls) || 0;
            const ballsTouched = state.ballState && Object.keys(state.ballState).some((k) => state.ballState[k]);
            state.matchInProgress = !!(
                state.canCallGame ||
                state.gameScoringLocked ||
                state.rackBreakerSlot ||
                state.breakerPromptVisible ||
                ballsTouched ||
                p1 > 0 ||
                p2 > 0 ||
                p1b > 0 ||
                p2b > 0
            );
            state.instanceKey = getInstanceKey();
            if (typeof window.streamSharing?.getPromotionListingState === 'function') {
                const promo = window.streamSharing.getPromotionListingState();
                state.streamPromotionListed = !!promo.listed;
                state.obsStreaming = !!promo.obsStreaming;
                state.streamUrl = promo.listed ? (promo.streamUrl || '') : '';
            } else {
                state.streamPromotionListed = false;
                state.obsStreaming = false;
                state.streamUrl = '';
            }
        } catch (err) {
            console.warn('cloudRelay: extended state collection error', err);
        }
        return state;
    }

    let sendStateGeneration = 0;
    let pushStateTimer = null;

    function invalidatePendingState() {
        sendStateGeneration += 1;
    }

    async function sendState(baseState) {
        if (!isJoined) return false;
        const localGen = ++sendStateGeneration;
        const state = await collectExtendedGameState(baseState);
        // Drop superseded publishes when a newer sendState started.
        if (localGen !== sendStateGeneration) {
            return false;
        }
        lastState = state;
        state.stateSeq = localGen;
        return sendRaw({
            type: 'state',
            room_id: getRoomId(),
            state: state,
            ts: new Date().toISOString(),
        });
    }

    function sendSession(action, payload) {
        if (!isJoined) return false;
        return sendRaw({
            type: 'session',
            room_id: getRoomId(),
            action: action,
            payload: payload || {},
            ts: new Date().toISOString(),
        });
    }

    /** Sync score snapshot for cloud publish — avoids awaiting OBS getStreamUrl races. */
    function collectDockScoreSnapshot() {
        function scoreInt(key) {
            const n = parseInt(dockStorage(key, '0'), 10);
            return Number.isFinite(n) ? n : 0;
        }
        return {
            player1Name: dockStorage('p1NameCtrlPanel', '') || '',
            player2Name: dockStorage('p2NameCtrlPanel', '') || '',
            p1Score: scoreInt('p1ScoreCtrlPanel'),
            p2Score: scoreInt('p2ScoreCtrlPanel'),
            p1Balls: scoreInt('p1BallsCtrlPanel'),
            p2Balls: scoreInt('p2BallsCtrlPanel'),
            gameType: dockStorage('gameType', 'game1') || 'game1',
            raceInfo: dockStorage('raceInfo', '') || '',
            gameInfo: dockStorage('gameInfo', '') || '',
            pointBased: dockStorage('pointBased', 'no') || 'no',
            ballTrackerEnabled: dockStorage('enableBallTracker', 'no') === 'yes',
            timestamp: new Date().toISOString(),
        };
    }

    function pushDockStateSoon(delayMs) {
        if (pushStateTimer) clearTimeout(pushStateTimer);
        pushStateTimer = setTimeout(function () {
            pushStateTimer = null;
            // Prefer direct cloud publish with sync scores. Routing through
            // streamSharing.sendUpdate() awaits OBS getStreamUrl and often drops
            // monitoring/clip updates behind in-flight score publishes.
            if (isJoined) {
                sendState(collectDockScoreSnapshot());
                return;
            }
            if (window.streamSharing && typeof window.streamSharing.sendUpdate === 'function') {
                window.streamSharing.sendUpdate();
            }
        }, delayMs == null ? 50 : delayMs);
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
            return;
        }
        if (isBlockedByServer) {
            alert(`CueSport Cloud blocked:\n${blockedReason || 'Access denied'}`);
            return;
        }
        if (!getRoomId()) {
            console.warn('cloudRelay: room will be assigned on join (instance: ' + getInstanceKey() + ')');
        }
        if (!getAccessToken() && !getApiKey()) {
            console.warn('cloudRelay: cannot connect without credentials');
            return;
        }

        try {
            ws = new WebSocket(getWsUrl());
            ws.onopen = function () {
                reconnectAttempts = 0;
                isConnected = true;
                sendJoin();
            };
            ws.onmessage = function (event) {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (err) {
                    console.error('cloudRelay parse error', err);
                }
            };
            ws.onerror = function () {
                isConnected = false;
                isJoined = false;
            };
            ws.onclose = function () {
                isConnected = false;
                isJoined = false;
                if (isBlockedByServer) return;
                if (isEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = Math.min(
                        INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
                        MAX_RECONNECT_DELAY
                    );
                    reconnectAttempts++;
                    reconnectTimer = setTimeout(connect, delay);
                }
            };
        } catch (err) {
            console.error('cloudRelay connect error', err);
        }
    }

    /**
     * Account stats over the authenticated room WebSocket (no HTTP/CORS).
     * Preferred for OBS docks loaded from file://.
     */
    function requestStats(limit) {
        return new Promise(function (resolve, reject) {
            if (!isCloudConnected()) {
                reject(new Error('Not connected to CueSport Cloud'));
                return;
            }
            const requestId = 'stats_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
            const timer = setTimeout(function () {
                pendingStats.delete(requestId);
                reject(new Error('Stats request timed out'));
            }, 15000);
            pendingStats.set(requestId, { resolve: resolve, reject: reject, timer: timer });
            const ok = sendRaw({
                type: 'stats',
                request_id: requestId,
                limit: limit || 5000,
            });
            if (!ok) {
                clearTimeout(timer);
                pendingStats.delete(requestId);
                reject(new Error('WebSocket not open'));
            }
        });
    }

    function handleMessage(data) {
        if (data.type === 'joined') {
            isJoined = true;
            if (data.room_id) setStorageItem('roomId', data.room_id);
            if (data.state) dispatchState(data.state);
            if (window.cloudCommands && typeof window.cloudCommands.initCloudCommands === 'function') {
                window.cloudCommands.initCloudCommands();
            }
            updateCloudUI();
            // Push authoritative dock snapshot to room (mobile + DB)
            pushDockStateSoon();
            return;
        }
        if (data.type === 'stats') {
            const pending = data.request_id ? pendingStats.get(data.request_id) : null;
            if (pending) {
                clearTimeout(pending.timer);
                pendingStats.delete(data.request_id);
                if (data.ok === false) {
                    pending.reject(new Error(data.error || 'Stats failed'));
                } else {
                    pending.resolve({
                        players: Array.isArray(data.players) ? data.players : [],
                        matches: Array.isArray(data.matches) ? data.matches : [],
                        summary: data.summary || null,
                        tables: Array.isArray(data.tables) ? data.tables : [],
                    });
                }
            }
            return;
        }
        if (data.type === 'error') {
            if (pendingStats.size) {
                for (const pending of pendingStats.values()) {
                    clearTimeout(pending.timer);
                    pending.reject(new Error(data.message || data.code || 'Cloud error'));
                }
                pendingStats.clear();
            }
            if (
                data.code === 'subscription_required' ||
                data.code === 'invalid_api_key' ||
                data.code === 'room_limit'
            ) {
                isBlockedByServer = true;
                blockedReason = data.message;
                setStorageItem('enabled', 'false');
                isEnabled = false;
                updateCloudUI();
            }
            console.error('cloudRelay error:', data.code, data.message);
            // unknown_type is often a version skew (e.g. new dock vs old server) — don't alert.
            if (data.code !== 'unknown_type' && typeof alert === 'function') {
                alert(`CueSport Cloud: ${data.message || data.code}`);
            }
            return;
        }
        if (data.type === 'command') {
            dispatchCommand(data);
            return;
        }
        if (data.type === 'state') {
            dispatchState(data.state);
            return;
        }
        if (data.type === 'presence') {
            const clients = data.clients || [];
            for (const fn of presenceHandlers) fn(clients);
            // When a mobile/guest client joins, enable Ball Scoring if needed and refresh state.
            handlePresenceForControlClients(clients);
            return;
        }
        // Legacy auth
        if (data.type === 'auth' && data.status === 'success') {
            isJoined = true;
        }
    }

    function disconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'disconnect' })); } catch (_) { /* ignore */ }
            ws.close();
        }
        ws = null;
        isConnected = false;
        isJoined = false;
        hadControlClient = false;
        updateCloudUI();
    }

    function setEnabled(enabled) {
        isEnabled = !!enabled;
        setStorageItem('enabled', isEnabled ? 'true' : 'false');
        if (isEnabled) connect();
        else disconnect();
        updateCloudUI();
    }

    function isCloudEnabled() {
        return isEnabled;
    }

    function isCloudConnected() {
        return isConnected && isJoined;
    }

    function getLastState() {
        return lastState;
    }

    function setCredentials({ serverUrl, roomId, accessToken, apiKey }) {
        if (serverUrl != null) setStorageItem('serverUrl', serverUrl);
        if (roomId != null) setStorageItem('roomId', roomId);
        if (accessToken != null) setStorageItem('accessToken', accessToken);
        if (apiKey != null) setStorageItem('apiKey', apiKey);
    }

    function clearSession() {
        setStorageItem('accessToken', '');
        setStorageItem('apiKey', '');
        setStorageItem('roomId', '');
        setStorageItem('signedInEmail', '');
        setStorageItem('enabled', 'false');
        isEnabled = false;
        disconnect();
    }

    function updateCloudUI() {
        const statusEl = document.getElementById('cloudRelayStatus');
        const toggle = document.getElementById('cloudRelayToggle');
        if (statusEl) {
            if (isBlockedByServer) statusEl.textContent = 'Blocked';
            else if (isCloudConnected()) statusEl.textContent = 'Connected';
            else if (isEnabled) statusEl.textContent = 'Connecting…';
            else statusEl.textContent = 'Off';
        }
        if (toggle) toggle.checked = isEnabled;
        // Notify listeners (e.g. stats) of cloud connection state change
        try { window.dispatchEvent(new CustomEvent('cloudRelayStateChange', { detail: { connected: isCloudConnected(), enabled: isEnabled } })); } catch (_) {}
        const emailEl = document.getElementById('cloudSignedInEmail');
        const statusSep = document.getElementById('cloudStatusSep');
        if (emailEl) {
            const email = getStorageItem('signedInEmail') || '';
            emailEl.textContent = email ? `Signed in: ${email}` : '';
            emailEl.classList.toggle('noShow', !email);
            if (statusSep) statusSep.classList.toggle('noShow', !email);
        }
    }

    function hasCredentials() {
        return !!(getAccessToken() || getApiKey());
    }

    function init() {
        isEnabled = getStorageItem('enabled') === 'true';
        if (isEnabled && (getAccessToken() || getApiKey())) {
            connect();
        }
        updateCloudUI();
    }

    window.cloudRelay = {
        connect,
        disconnect,
        sendEvent,
        sendState,
        sendCommand,
        sendSession,
        requestStats,
        setEnabled,
        isConnected: isCloudConnected,
        isEnabled: isCloudEnabled,
        getLastState,
        setCredentials,
        clearSession,
        onCommand,
        onState,
        onPresence,
        pushDockStateSoon,
        invalidatePendingState,
        get replaying() { return replaying; },
        hasCredentials,
        ensureBallScoringForMobileControl,
        init,
        updateCloudUI,
        getServerUrl,
        getRoomId,
        getAccessToken,
        getApiKey,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
