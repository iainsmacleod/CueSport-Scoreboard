/**
 * CueSport Scoreboard — Player statistics (IndexedDB, global roster)
 */
(function () {
    'use strict';

    const DB_NAME = 'cuesport_stats';
    const DB_VERSION = 1;
    const SCHEMA_VERSION = 1;

    const GAME_TYPE_LABELS = {
        game1: '8-Ball',
        game2: '9-Ball',
        game3: '10-Ball',
        game4: 'Straight',
        game5: 'Bank',
        game6: 'One Pocket',
        game7: 'Custom'
    };

    let db = null;
    let initPromise = null;

    const activeMatchSession = {
        matchId: null,
        player1Id: null,
        player2Id: null,
        player1Name: '',
        player2Name: '',
        gameType: 'game1',
        raceTo: null,
        gameInfo: '',
        status: 'active',
        matchCompletedRecorded: false,
        lastRackWinnerSlot: null,
        lastBallWinnerSlot: null,
        duplicateNames: false
    };

    function generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function normalizeName(name) {
        return (name || '').trim().toLowerCase();
    }

    function truncateName(name) {
        return (name || '').substring(0, 20);
    }

    function createEmptyTypeStats() {
        return {
            racksWon: 0,
            racksLost: 0,
            gamesWon: 0,
            gamesLost: 0,
            ballsWon: 0,
            ballsLost: 0
        };
    }

    function createEmptyStats() {
        return {
            racksWon: 0,
            racksLost: 0,
            gamesWon: 0,
            gamesLost: 0,
            ballsWon: 0,
            ballsLost: 0,
            byGameType: {}
        };
    }

    function ensureTypeStats(stats, gameType) {
        if (!stats.byGameType[gameType]) {
            stats.byGameType[gameType] = createEmptyTypeStats();
        }
        return stats.byGameType[gameType];
    }

    function getWinRate(stats) {
        const played = stats.gamesWon + stats.gamesLost;
        if (played === 0) {
            return 0;
        }
        return Math.round((stats.gamesWon / played) * 100);
    }

    function formatWL(won, lost) {
        return (won || 0) + '/' + (lost || 0);
    }

    function formatPlayerPreview(stats) {
        const g = formatWL(stats.gamesWon, stats.gamesLost) + 'G';
        const r = stats.racksWon + 'R';
        return g + ' \u00b7 ' + r;
    }

    function openDatabase() {
        if (initPromise) {
            return initPromise;
        }
        initPromise = new Promise(function (resolve, reject) {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = function () {
                reject(request.error);
            };
            request.onsuccess = function () {
                db = request.result;
                resolve(db);
            };
            request.onupgradeneeded = function (event) {
                const database = event.target.result;
                if (!database.objectStoreNames.contains('players')) {
                    const playerStore = database.createObjectStore('players', { keyPath: 'id' });
                    playerStore.createIndex('nameNormalized', 'nameNormalized', { unique: true });
                }
                if (!database.objectStoreNames.contains('matches')) {
                    const matchStore = database.createObjectStore('matches', { keyPath: 'id' });
                    matchStore.createIndex('player1Id', 'player1Id', { unique: false });
                    matchStore.createIndex('player2Id', 'player2Id', { unique: false });
                    matchStore.createIndex('completedAt', 'completedAt', { unique: false });
                }
                if (!database.objectStoreNames.contains('meta')) {
                    database.createObjectStore('meta', { keyPath: 'key' });
                }
            };
        });
        return initPromise;
    }

    function tx(storeNames, mode) {
        return db.transaction(storeNames, mode);
    }

    function promisifyRequest(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    async function getMeta(key) {
        await openDatabase();
        const store = tx(['meta'], 'readonly').objectStore('meta');
        return promisifyRequest(store.get(key));
    }

    async function setMeta(key, value) {
        await openDatabase();
        const store = tx(['meta'], 'readwrite').objectStore('meta');
        return promisifyRequest(store.put({ key: key, value: value }));
    }

    async function getPlayer(id) {
        await openDatabase();
        const store = tx(['players'], 'readonly').objectStore('players');
        return promisifyRequest(store.get(id));
    }

    async function putPlayer(player) {
        await openDatabase();
        const store = tx(['players'], 'readwrite').objectStore('players');
        return promisifyRequest(store.put(player));
    }

    async function getMatch(id) {
        await openDatabase();
        const store = tx(['matches'], 'readonly').objectStore('matches');
        return promisifyRequest(store.get(id));
    }

    async function putMatch(match) {
        await openDatabase();
        const store = tx(['matches'], 'readwrite').objectStore('matches');
        return promisifyRequest(store.put(match));
    }

    async function findPlayerByNormalizedName(normalized) {
        if (!normalized) {
            return null;
        }
        await openDatabase();
        const store = tx(['players'], 'readonly').objectStore('players');
        return promisifyRequest(store.index('nameNormalized').get(normalized));
    }

    async function getAllPlayers() {
        await openDatabase();
        const store = tx(['players'], 'readonly').objectStore('players');
        return promisifyRequest(store.getAll());
    }

    async function ensurePlayer(name) {
        const displayName = truncateName(name);
        const normalized = normalizeName(displayName);
        if (!normalized) {
            return null;
        }
        let player = await findPlayerByNormalizedName(normalized);
        if (player) {
            return player;
        }
        const now = new Date().toISOString();
        player = {
            id: generateId(),
            name: displayName,
            nameNormalized: normalized,
            stats: createEmptyStats(),
            createdAt: now,
            updatedAt: now,
            lastPlayedAt: null
        };
        await putPlayer(player);
        return player;
    }

    async function searchPlayers(query, limit) {
        const normalizedQuery = normalizeName(query);
        const all = await getAllPlayers();
        if (!normalizedQuery) {
            return all.slice(0, limit || 8);
        }
        return all
            .filter(function (p) {
                return p.nameNormalized.indexOf(normalizedQuery) === 0 ||
                    p.name.toLowerCase().indexOf(normalizedQuery) !== -1;
            })
            .sort(function (a, b) {
                const aStarts = a.nameNormalized.indexOf(normalizedQuery) === 0 ? 0 : 1;
                const bStarts = b.nameNormalized.indexOf(normalizedQuery) === 0 ? 0 : 1;
                if (aStarts !== bStarts) {
                    return aStarts - bStarts;
                }
                return a.name.localeCompare(b.name);
            })
            .slice(0, limit || 8);
    }

    function isPlayerSlotEnabled(slot) {
        if (typeof getStorageItem !== 'function') {
            return true;
        }
        const key = slot === '1' ? 'usePlayer1' : 'usePlayer2';
        const val = String(getStorageItem(key, 'yes') || 'yes').toLowerCase();
        return !(val === 'no' || val === 'false' || val === '0');
    }

    function getCurrentContext() {
        const gameType = typeof getStorageItem === 'function'
            ? (getStorageItem('gameType') || 'game1')
            : 'game1';
        const raceTo = typeof getRaceTarget === 'function' ? getRaceTarget() : null;
        const gameInfoEl = document.getElementById('gameInfoTxt');
        const gameInfo = gameInfoEl ? gameInfoEl.value : '';
        const dualScore = typeof isDualScoreMode === 'function' && isDualScoreMode();
        return { gameType: gameType, raceTo: raceTo, gameInfo: gameInfo, dualScore: dualScore };
    }

    function getPlayerIdFromInput(slot) {
        const input = document.getElementById(slot === '1' ? 'p1Name' : 'p2Name');
        if (!input) {
            return null;
        }
        return input.getAttribute('data-player-id') || null;
    }

    function setPlayerIdOnInput(slot, id) {
        const input = document.getElementById(slot === '1' ? 'p1Name' : 'p2Name');
        if (input) {
            if (id) {
                input.setAttribute('data-player-id', id);
            } else {
                input.removeAttribute('data-player-id');
            }
        }
    }

    async function lookupPlayer(name) {
        const normalized = normalizeName(truncateName(name));
        if (!normalized) {
            return null;
        }
        return findPlayerByNormalizedName(normalized);
    }

    async function resolvePlayerForSlot(slot, name, createIfMissing) {
        const existingId = getPlayerIdFromInput(slot);
        if (existingId) {
            const player = await getPlayer(existingId);
            if (player) {
                return player;
            }
        }
        const found = await lookupPlayer(name);
        if (found) {
            return found;
        }
        if (createIfMissing) {
            return ensurePlayer(name);
        }
        return null;
    }

    function sessionNeedsReset(p1Name, p2Name, context) {
        if (!activeMatchSession.matchId) {
            return true;
        }
        if (activeMatchSession.player1Name !== truncateName(p1Name) ||
            activeMatchSession.player2Name !== truncateName(p2Name) ||
            activeMatchSession.gameType !== context.gameType ||
            activeMatchSession.raceTo !== context.raceTo) {
            return true;
        }
        return false;
    }

    async function createNewMatchSession(p1Name, p2Name, context) {
        const p1 = await resolvePlayerForSlot('1', p1Name, true);
        const p2 = await resolvePlayerForSlot('2', p2Name, true);
        if (!p1 || !p2) {
            return false;
        }
        setPlayerIdOnInput('1', p1.id);
        setPlayerIdOnInput('2', p2.id);

        const duplicateNames = p1.id === p2.id || normalizeName(p1Name) === normalizeName(p2Name);
        const now = new Date().toISOString();
        const match = {
            id: generateId(),
            status: 'active',
            startedAt: now,
            completedAt: null,
            player1Id: p1.id,
            player2Id: p2.id,
            player1Name: truncateName(p1Name),
            player2Name: truncateName(p2Name),
            gameType: context.gameType,
            raceTo: context.raceTo,
            gameInfo: context.gameInfo || '',
            finalScore: { p1: 0, p2: 0 },
            winnerId: null,
            racks: [],
            balls: []
        };
        await putMatch(match);

        activeMatchSession.matchId = match.id;
        activeMatchSession.player1Id = p1.id;
        activeMatchSession.player2Id = p2.id;
        activeMatchSession.player1Name = match.player1Name;
        activeMatchSession.player2Name = match.player2Name;
        activeMatchSession.gameType = context.gameType;
        activeMatchSession.raceTo = context.raceTo;
        activeMatchSession.gameInfo = context.gameInfo || '';
        activeMatchSession.status = 'active';
        activeMatchSession.matchCompletedRecorded = false;
        activeMatchSession.lastRackWinnerSlot = null;
        activeMatchSession.lastBallWinnerSlot = null;
        activeMatchSession.duplicateNames = duplicateNames;
        return true;
    }

    async function ensureActiveSession() {
        const p1Name = (document.getElementById('p1Name')?.value || '').trim();
        const p2Name = (document.getElementById('p2Name')?.value || '').trim();
        if (!p1Name || !p2Name) {
            return false;
        }
        if (!isPlayerSlotEnabled('1') || !isPlayerSlotEnabled('2')) {
            return false;
        }
        const context = getCurrentContext();
        if (sessionNeedsReset(p1Name, p2Name, context)) {
            if (activeMatchSession.matchId && activeMatchSession.status === 'active') {
                await persistActiveMatch();
            }
            return createNewMatchSession(p1Name, p2Name, context);
        }
        return true;
    }

    async function persistActiveMatch() {
        if (!activeMatchSession.matchId) {
            return;
        }
        const match = await getMatch(activeMatchSession.matchId);
        if (!match) {
            return;
        }
        const p1Score = parseInt(typeof getStorageItem === 'function' ? getStorageItem('p1ScoreCtrlPanel') : 0, 10) || 0;
        const p2Score = parseInt(typeof getStorageItem === 'function' ? getStorageItem('p2ScoreCtrlPanel') : 0, 10) || 0;
        match.finalScore = { p1: p1Score, p2: p2Score };
        match.gameInfo = activeMatchSession.gameInfo;
        match.status = activeMatchSession.status;
        await putMatch(match);
    }

    async function applyRackDelta(winnerId, loserId, gameType, delta) {
        const now = new Date().toISOString();
        const winner = await getPlayer(winnerId);
        const loser = await getPlayer(loserId);
        if (!winner || !loser) {
            return;
        }

        winner.stats.racksWon += delta;
        loser.stats.racksLost += delta;
        const wType = ensureTypeStats(winner.stats, gameType);
        const lType = ensureTypeStats(loser.stats, gameType);
        wType.racksWon += delta;
        lType.racksLost += delta;

        if (delta > 0) {
            winner.lastPlayedAt = now;
            loser.lastPlayedAt = now;
        }
        winner.updatedAt = now;
        loser.updatedAt = now;
        await putPlayer(winner);
        await putPlayer(loser);
    }

    async function applyBallDelta(winnerId, loserId, gameType, delta) {
        const now = new Date().toISOString();
        const winner = await getPlayer(winnerId);
        const loser = await getPlayer(loserId);
        if (!winner || !loser) {
            return;
        }

        winner.stats.ballsWon += delta;
        loser.stats.ballsLost += delta;
        const wType = ensureTypeStats(winner.stats, gameType);
        const lType = ensureTypeStats(loser.stats, gameType);
        wType.ballsWon += delta;
        lType.ballsLost += delta;

        if (delta > 0) {
            winner.lastPlayedAt = now;
            loser.lastPlayedAt = now;
        }
        winner.updatedAt = now;
        loser.updatedAt = now;
        await putPlayer(winner);
        await putPlayer(loser);
    }

    async function applyGameDelta(winnerId, loserId, gameType, delta) {
        if (activeMatchSession.duplicateNames) {
            return;
        }
        const now = new Date().toISOString();
        const winner = await getPlayer(winnerId);
        const loser = await getPlayer(loserId);
        if (!winner || !loser) {
            return;
        }

        winner.stats.gamesWon += delta;
        loser.stats.gamesLost += delta;
        const wType = ensureTypeStats(winner.stats, gameType);
        const lType = ensureTypeStats(loser.stats, gameType);
        wType.gamesWon += delta;
        lType.gamesLost += delta;

        winner.lastPlayedAt = now;
        loser.lastPlayedAt = now;
        winner.updatedAt = now;
        loser.updatedAt = now;
        await putPlayer(winner);
        await putPlayer(loser);
    }

    function getSlotPlayerIds(slot) {
        if (slot === '1') {
            return { winnerId: activeMatchSession.player1Id, loserId: activeMatchSession.player2Id };
        }
        return { winnerId: activeMatchSession.player2Id, loserId: activeMatchSession.player1Id };
    }

    async function recordRackWin(playerSlot) {
        const ready = await ensureActiveSession();
        if (!ready || activeMatchSession.duplicateNames) {
            return;
        }

        const ids = getSlotPlayerIds(playerSlot);
        const context = getCurrentContext();
        const match = await getMatch(activeMatchSession.matchId);
        if (!match) {
            return;
        }

        const rackEntry = {
            rackNumber: match.racks.length + 1,
            winnerId: ids.winnerId,
            timestamp: new Date().toISOString()
        };
        match.racks.push(rackEntry);

        const p1Score = parseInt(getStorageItem('p1ScoreCtrlPanel'), 10) || 0;
        const p2Score = parseInt(getStorageItem('p2ScoreCtrlPanel'), 10) || 0;
        match.finalScore = { p1: p1Score, p2: p2Score };
        await putMatch(match);

        await applyRackDelta(ids.winnerId, ids.loserId, context.gameType, 1);
        activeMatchSession.lastRackWinnerSlot = playerSlot;

        await checkMatchCompletion();
    }

    async function undoLastRack(playerSlot) {
        if (!activeMatchSession.matchId || activeMatchSession.lastRackWinnerSlot !== playerSlot) {
            return;
        }

        const match = await getMatch(activeMatchSession.matchId);
        if (!match || match.racks.length === 0) {
            return;
        }

        const lastRack = match.racks[match.racks.length - 1];
        const context = getCurrentContext();
        const winnerId = lastRack.winnerId;
        const loserId = winnerId === activeMatchSession.player1Id
            ? activeMatchSession.player2Id
            : activeMatchSession.player1Id;

        match.racks.pop();
        const p1Score = parseInt(getStorageItem('p1ScoreCtrlPanel'), 10) || 0;
        const p2Score = parseInt(getStorageItem('p2ScoreCtrlPanel'), 10) || 0;
        match.finalScore = { p1: p1Score, p2: p2Score };

        if (activeMatchSession.matchCompletedRecorded) {
            await revertMatchCompletion(match);
        }

        await putMatch(match);
        await applyRackDelta(winnerId, loserId, context.gameType, -1);
        activeMatchSession.lastRackWinnerSlot = match.racks.length > 0
            ? (match.racks[match.racks.length - 1].winnerId === activeMatchSession.player1Id ? '1' : '2')
            : null;
    }

    async function recordBallWin(playerSlot) {
        const ready = await ensureActiveSession();
        if (!ready || activeMatchSession.duplicateNames) {
            return;
        }
        const context = getCurrentContext();
        if (!context.dualScore) {
            return;
        }

        const ids = getSlotPlayerIds(playerSlot);
        const match = await getMatch(activeMatchSession.matchId);
        if (!match) {
            return;
        }

        match.balls.push({
            winnerId: ids.winnerId,
            timestamp: new Date().toISOString()
        });
        await putMatch(match);
        await applyBallDelta(ids.winnerId, ids.loserId, context.gameType, 1);
        activeMatchSession.lastBallWinnerSlot = playerSlot;
    }

    async function undoLastBall(playerSlot) {
        if (!activeMatchSession.matchId || activeMatchSession.lastBallWinnerSlot !== playerSlot) {
            return;
        }
        const match = await getMatch(activeMatchSession.matchId);
        if (!match || !match.balls || match.balls.length === 0) {
            return;
        }

        const lastBall = match.balls[match.balls.length - 1];
        const context = getCurrentContext();
        const winnerId = lastBall.winnerId;
        const loserId = winnerId === activeMatchSession.player1Id
            ? activeMatchSession.player2Id
            : activeMatchSession.player1Id;

        match.balls.pop();
        await putMatch(match);
        await applyBallDelta(winnerId, loserId, context.gameType, -1);
        activeMatchSession.lastBallWinnerSlot = match.balls.length > 0
            ? (match.balls[match.balls.length - 1].winnerId === activeMatchSession.player1Id ? '1' : '2')
            : null;
    }

    function getCurrentScores() {
        const p1 = parseInt(getStorageItem('p1ScoreCtrlPanel'), 10) || 0;
        const p2 = parseInt(getStorageItem('p2ScoreCtrlPanel'), 10) || 0;
        return { p1: p1, p2: p2 };
    }

    function getWinnerSlotFromScores(scores, raceTo) {
        if (raceTo === null) {
            return null;
        }
        if (scores.p1 >= raceTo && scores.p1 >= scores.p2) {
            return '1';
        }
        if (scores.p2 >= raceTo && scores.p2 >= scores.p1) {
            return '2';
        }
        return null;
    }

    async function checkMatchCompletion() {
        const context = getCurrentContext();
        if (context.raceTo === null || activeMatchSession.matchCompletedRecorded) {
            return;
        }
        const scores = getCurrentScores();
        const winnerSlot = getWinnerSlotFromScores(scores, context.raceTo);
        if (!winnerSlot) {
            return;
        }
        await finalizeMatchCompletion(winnerSlot, scores);
    }

    async function finalizeMatchCompletion(winnerSlot, scores) {
        if (activeMatchSession.matchCompletedRecorded || activeMatchSession.duplicateNames) {
            return;
        }

        const match = await getMatch(activeMatchSession.matchId);
        if (!match) {
            return;
        }

        const ids = getSlotPlayerIds(winnerSlot);
        const now = new Date().toISOString();
        match.status = 'completed';
        match.completedAt = now;
        match.finalScore = { p1: scores.p1, p2: scores.p2 };
        match.winnerId = ids.winnerId;
        await putMatch(match);

        await applyGameDelta(ids.winnerId, ids.loserId, activeMatchSession.gameType, 1);
        activeMatchSession.status = 'completed';
        activeMatchSession.matchCompletedRecorded = true;
        broadcastOverlayStatsIfEnabled();
    }

    async function revertMatchCompletion(match) {
        if (!activeMatchSession.matchCompletedRecorded) {
            return;
        }
        const winnerId = match.winnerId;
        const loserId = winnerId === activeMatchSession.player1Id
            ? activeMatchSession.player2Id
            : activeMatchSession.player1Id;

        await applyGameDelta(winnerId, loserId, activeMatchSession.gameType, -1);
        match.status = 'active';
        match.completedAt = null;
        match.winnerId = null;
        activeMatchSession.status = 'active';
        activeMatchSession.matchCompletedRecorded = false;
        broadcastOverlayStatsIfEnabled();
    }

    async function syncPlayerNameFromInput(slot) {
        const input = document.getElementById(slot === '1' ? 'p1Name' : 'p2Name');
        if (!input) {
            return null;
        }
        const name = truncateName((input.value || '').trim());
        if (!name) {
            setPlayerIdOnInput(slot, null);
            return null;
        }

        const existingId = getPlayerIdFromInput(slot);
        if (existingId) {
            const player = await getPlayer(existingId);
            if (!player) {
                setPlayerIdOnInput(slot, null);
                return null;
            }
            if (normalizeName(player.name) !== normalizeName(name)) {
                try {
                    await updatePlayerName(existingId, name);
                    return await getPlayer(existingId);
                } catch (err) {
                    input.value = player.name;
                    throw err;
                }
            }
            return player;
        }

        const found = await lookupPlayer(name);
        if (found) {
            setPlayerIdOnInput(slot, found.id);
            return found;
        }
        return null;
    }

    async function onNamesUpdated() {
        const p1Name = (document.getElementById('p1Name')?.value || '').trim();
        const p2Name = (document.getElementById('p2Name')?.value || '').trim();

        try {
            if (p1Name) {
                await syncPlayerNameFromInput('1');
            } else {
                setPlayerIdOnInput('1', null);
            }
            if (p2Name) {
                await syncPlayerNameFromInput('2');
            } else {
                setPlayerIdOnInput('2', null);
            }
        } catch (err) {
            console.error('PlayerStats name sync error:', err);
            alert('Name update failed: ' + err.message);
            return;
        }

        if (p1Name && p2Name) {
            const context = getCurrentContext();
            if (sessionNeedsReset(p1Name, p2Name, context)) {
                if (activeMatchSession.matchId && activeMatchSession.status === 'active') {
                    await persistActiveMatch();
                }
                resetSessionState();
            }
        }
        broadcastOverlayStatsIfEnabled();
    }

    async function onClearGame() {
        if (activeMatchSession.matchId) {
            await persistActiveMatch();
        }
        resetSessionState();
    }

    async function onResetScores() {
        if (activeMatchSession.matchId && activeMatchSession.matchCompletedRecorded) {
            resetSessionState();
            await ensureActiveSession();
        } else if (activeMatchSession.matchId) {
            const match = await getMatch(activeMatchSession.matchId);
            if (match && (match.racks.length > 0 || (match.balls && match.balls.length > 0))) {
                await undoAllRacksInMatch(match);
                match.finalScore = { p1: 0, p2: 0 };
                match.racks = [];
                match.balls = [];
                await putMatch(match);
            }
            activeMatchSession.matchCompletedRecorded = false;
            activeMatchSession.status = 'active';
            activeMatchSession.lastRackWinnerSlot = null;
            activeMatchSession.lastBallWinnerSlot = null;
        }
        broadcastOverlayStatsIfEnabled();
    }

    async function undoAllRacksInMatch(match) {
        const context = getCurrentContext();
        for (let i = match.racks.length - 1; i >= 0; i--) {
            const rack = match.racks[i];
            const loserId = rack.winnerId === activeMatchSession.player1Id
                ? activeMatchSession.player2Id
                : activeMatchSession.player1Id;
            await applyRackDelta(rack.winnerId, loserId, context.gameType, -1);
        }
        if (match.balls) {
            for (let j = match.balls.length - 1; j >= 0; j--) {
                const ball = match.balls[j];
                const loserId = ball.winnerId === activeMatchSession.player1Id
                    ? activeMatchSession.player2Id
                    : activeMatchSession.player1Id;
                await applyBallDelta(ball.winnerId, loserId, context.gameType, -1);
            }
        }
    }

    function resetSessionState() {
        activeMatchSession.matchId = null;
        activeMatchSession.player1Id = null;
        activeMatchSession.player2Id = null;
        activeMatchSession.player1Name = '';
        activeMatchSession.player2Name = '';
        activeMatchSession.gameType = 'game1';
        activeMatchSession.raceTo = null;
        activeMatchSession.gameInfo = '';
        activeMatchSession.status = 'active';
        activeMatchSession.matchCompletedRecorded = false;
        activeMatchSession.lastRackWinnerSlot = null;
        activeMatchSession.lastBallWinnerSlot = null;
        activeMatchSession.duplicateNames = false;
    }

    function pairKey(idA, idB) {
        return [idA, idB].sort().join('::');
    }

    async function getHeadToHead(playerId1, playerId2) {
        if (!playerId1 || !playerId2 || playerId1 === playerId2) {
            return null;
        }
        await openDatabase();
        const store = tx(['matches'], 'readonly').objectStore('matches');
        const allMatches = await promisifyRequest(store.getAll());

        const relevant = allMatches.filter(function (m) {
            return (m.player1Id === playerId1 && m.player2Id === playerId2) ||
                (m.player1Id === playerId2 && m.player2Id === playerId1);
        }).sort(function (a, b) {
            const dateA = a.completedAt || a.startedAt;
            const dateB = b.completedAt || b.startedAt;
            return dateB.localeCompare(dateA);
        });

        const p1 = await getPlayer(playerId1);
        const p2 = await getPlayer(playerId2);
        const summary = {
            player1: p1,
            player2: p2,
            gamesWon: { [playerId1]: 0, [playerId2]: 0 },
            racksWon: { [playerId1]: 0, [playerId2]: 0 },
            ballsWon: { [playerId1]: 0, [playerId2]: 0 },
            matches: relevant,
            lastPlayedAt: null
        };

        relevant.forEach(function (m) {
            m.racks.forEach(function (r) {
                summary.racksWon[r.winnerId] = (summary.racksWon[r.winnerId] || 0) + 1;
            });
            if (m.balls) {
                m.balls.forEach(function (b) {
                    summary.ballsWon[b.winnerId] = (summary.ballsWon[b.winnerId] || 0) + 1;
                });
            }
            if (m.status === 'completed' && m.winnerId) {
                summary.gamesWon[m.winnerId] = (summary.gamesWon[m.winnerId] || 0) + 1;
            }
            const date = m.completedAt || m.startedAt;
            if (!summary.lastPlayedAt || date > summary.lastPlayedAt) {
                summary.lastPlayedAt = date;
            }
        });

        return summary;
    }

    async function getAllMatches() {
        await openDatabase();
        const store = tx(['matches'], 'readonly').objectStore('matches');
        return promisifyRequest(store.getAll());
    }

    async function getMatchesForPlayer(playerId) {
        const all = await getAllMatches();
        return all.filter(function (m) {
            return m.player1Id === playerId || m.player2Id === playerId;
        }).sort(function (a, b) {
            const dateA = a.completedAt || a.startedAt || '';
            const dateB = b.completedAt || b.startedAt || '';
            return dateB.localeCompare(dateA);
        });
    }

    async function deleteMatchFromStore(matchId) {
        await openDatabase();
        const store = tx(['matches'], 'readwrite').objectStore('matches');
        return promisifyRequest(store.delete(matchId));
    }

    async function deletePlayerFromStore(playerId) {
        await openDatabase();
        const store = tx(['players'], 'readwrite').objectStore('players');
        return promisifyRequest(store.delete(playerId));
    }

    function clampScore(value) {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n)) {
            return 0;
        }
        return Math.min(Math.max(n, 0), 999);
    }

    function synthesizeRacksFromScores(match) {
        const racks = [];
        const timestamp = new Date().toISOString();
        const p1Count = clampScore(match.finalScore.p1);
        const p2Count = clampScore(match.finalScore.p2);
        let rackNumber = 1;
        for (let i = 0; i < p1Count; i++) {
            racks.push({ rackNumber: rackNumber++, winnerId: match.player1Id, timestamp: timestamp });
        }
        for (let i = 0; i < p2Count; i++) {
            racks.push({ rackNumber: rackNumber++, winnerId: match.player2Id, timestamp: timestamp });
        }
        return racks;
    }

    function synthesizeBallsFromCounts(match, ballsP1, ballsP2) {
        const balls = [];
        const timestamp = new Date().toISOString();
        const countP1 = clampScore(ballsP1);
        const countP2 = clampScore(ballsP2);
        for (let i = 0; i < countP1; i++) {
            balls.push({ winnerId: match.player1Id, timestamp: timestamp });
        }
        for (let i = 0; i < countP2; i++) {
            balls.push({ winnerId: match.player2Id, timestamp: timestamp });
        }
        return balls;
    }

    function countBallsForPlayer(match, playerId) {
        if (!match.balls) {
            return 0;
        }
        return match.balls.filter(function (b) { return b.winnerId === playerId; }).length;
    }

    async function recomputePlayerStats(playerId) {
        const player = await getPlayer(playerId);
        if (!player) {
            return;
        }

        const matches = await getMatchesForPlayer(playerId);
        player.stats = createEmptyStats();
        let lastPlayed = null;

        matches.forEach(function (m) {
            const opponentId = m.player1Id === playerId ? m.player2Id : m.player1Id;
            const gameType = m.gameType || 'game1';

            (m.racks || []).forEach(function (r) {
                if (r.winnerId === playerId) {
                    player.stats.racksWon++;
                    ensureTypeStats(player.stats, gameType).racksWon++;
                } else if (r.winnerId === opponentId) {
                    player.stats.racksLost++;
                    ensureTypeStats(player.stats, gameType).racksLost++;
                }
            });

            (m.balls || []).forEach(function (b) {
                if (b.winnerId === playerId) {
                    player.stats.ballsWon++;
                    ensureTypeStats(player.stats, gameType).ballsWon++;
                } else if (b.winnerId === opponentId) {
                    player.stats.ballsLost++;
                    ensureTypeStats(player.stats, gameType).ballsLost++;
                }
            });

            if (m.status === 'completed' && m.winnerId) {
                if (m.winnerId === playerId) {
                    player.stats.gamesWon++;
                    ensureTypeStats(player.stats, gameType).gamesWon++;
                } else if (m.winnerId === opponentId) {
                    player.stats.gamesLost++;
                    ensureTypeStats(player.stats, gameType).gamesLost++;
                }
            }

            const date = m.completedAt || m.startedAt;
            if (date && (!lastPlayed || date > lastPlayed)) {
                lastPlayed = date;
            }
        });

        player.lastPlayedAt = lastPlayed;
        player.updatedAt = new Date().toISOString();
        await putPlayer(player);
    }

    async function recomputePlayersForMatch(match) {
        if (!match) {
            return;
        }
        await recomputePlayerStats(match.player1Id);
        if (match.player2Id !== match.player1Id) {
            await recomputePlayerStats(match.player2Id);
        }
    }

    function dateInputFromIso(iso) {
        if (!iso) {
            return '';
        }
        try {
            return iso.slice(0, 10);
        } catch (e) {
            return '';
        }
    }

    async function saveMatch(matchPayload) {
        if (!matchPayload.player1Id || !matchPayload.player2Id) {
            throw new Error('Both players are required.');
        }
        if (matchPayload.player1Id === matchPayload.player2Id) {
            throw new Error('Cannot save a match with the same player on both sides.');
        }

        const p1 = await getPlayer(matchPayload.player1Id);
        const p2 = await getPlayer(matchPayload.player2Id);
        if (!p1 || !p2) {
            throw new Error('One or both players were not found.');
        }

        const scoreP1 = clampScore(matchPayload.scoreP1);
        const scoreP2 = clampScore(matchPayload.scoreP2);
        const ballsP1 = clampScore(matchPayload.ballsP1);
        const ballsP2 = clampScore(matchPayload.ballsP2);
        let status = matchPayload.status === 'completed' ? 'completed' : 'active';
        const now = new Date().toISOString();
        const dateIso = matchPayload.date ? (matchPayload.date + 'T12:00:00.000Z') : now;

        let match = matchPayload.id ? await getMatch(matchPayload.id) : null;
        if (!match) {
            match = {
                id: generateId(),
                startedAt: dateIso,
                gameInfo: '',
                raceTo: null
            };
        }

        match.player1Id = matchPayload.player1Id;
        match.player2Id = matchPayload.player2Id;
        match.player1Name = p1.name;
        match.player2Name = p2.name;
        match.gameType = matchPayload.gameType || 'game1';
        match.finalScore = { p1: scoreP1, p2: scoreP2 };
        match.racks = synthesizeRacksFromScores(match);
        match.balls = synthesizeBallsFromCounts(match, ballsP1, ballsP2);

        if (status === 'completed') {
            if (scoreP1 > scoreP2) {
                match.winnerId = match.player1Id;
                match.completedAt = dateIso;
            } else if (scoreP2 > scoreP1) {
                match.winnerId = match.player2Id;
                match.completedAt = dateIso;
            } else {
                status = 'active';
                match.winnerId = null;
                match.completedAt = null;
            }
        } else {
            match.winnerId = null;
            match.completedAt = null;
        }
        match.status = status;

        if (!match.startedAt) {
            match.startedAt = dateIso;
        }

        await putMatch(match);

        if (activeMatchSession.matchId === match.id) {
            resetSessionState();
        }

        await recomputePlayersForMatch(match);
        return match;
    }

    async function deleteMatch(matchId) {
        const match = await getMatch(matchId);
        if (!match) {
            return;
        }

        if (activeMatchSession.matchId === matchId) {
            resetSessionState();
        }

        await deleteMatchFromStore(matchId);
        await recomputePlayersForMatch(match);
    }

    async function updatePlayerName(playerId, newName) {
        const displayName = truncateName(newName);
        const normalized = normalizeName(displayName);
        if (!normalized) {
            throw new Error('Name cannot be empty.');
        }

        const existing = await findPlayerByNormalizedName(normalized);
        if (existing && existing.id !== playerId) {
            throw new Error('A player with that name already exists.');
        }

        const player = await getPlayer(playerId);
        if (!player) {
            throw new Error('Player not found.');
        }

        player.name = displayName;
        player.nameNormalized = normalized;
        player.updatedAt = new Date().toISOString();
        await putPlayer(player);

        const matches = await getMatchesForPlayer(playerId);
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            if (m.player1Id === playerId) {
                m.player1Name = displayName;
            }
            if (m.player2Id === playerId) {
                m.player2Name = displayName;
            }
            await putMatch(m);
        }

        if (getPlayerIdFromInput('1') === playerId) {
            const input = document.getElementById('p1Name');
            if (input) {
                input.value = displayName;
            }
        }
        if (getPlayerIdFromInput('2') === playerId) {
            const input = document.getElementById('p2Name');
            if (input) {
                input.value = displayName;
            }
        }
    }

    async function deletePlayer(playerId) {
        const matches = await getMatchesForPlayer(playerId);
        const opponentIds = {};

        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            if (activeMatchSession.matchId === m.id) {
                resetSessionState();
            }
            opponentIds[m.player1Id === playerId ? m.player2Id : m.player1Id] = true;
            await deleteMatchFromStore(m.id);
        }

        await deletePlayerFromStore(playerId);

        const opponents = Object.keys(opponentIds);
        for (let j = 0; j < opponents.length; j++) {
            await recomputePlayerStats(opponents[j]);
        }

        if (getPlayerIdFromInput('1') === playerId) {
            setPlayerIdOnInput('1', null);
        }
        if (getPlayerIdFromInput('2') === playerId) {
            setPlayerIdOnInput('2', null);
        }

        if (statsModalSelectedPlayerId === playerId) {
            statsModalSelectedPlayerId = null;
        }
    }

    async function refreshStatsUI() {
        await renderStatsLeaderboard();
        await populateH2HPlayerSelects();
        if (statsModalSelectedPlayerId) {
            await showPlayerDetail(statsModalSelectedPlayerId);
        }
        await refreshH2HView();
        broadcastOverlayStatsIfEnabled();
    }

    async function exportData() {
        await openDatabase();
        const players = await getAllPlayers();
        const matchStore = tx(['matches'], 'readonly').objectStore('matches');
        const matches = await promisifyRequest(matchStore.getAll());
        const data = {
            schemaVersion: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            players: players,
            matches: matches
        };
        await setMeta('lastExportAt', data.exportedAt);
        return data;
    }

    async function importData(data, merge) {
        if (!data || !Array.isArray(data.players) || !Array.isArray(data.matches)) {
            throw new Error('Invalid import file format.');
        }
        if (data.schemaVersion && data.schemaVersion > SCHEMA_VERSION) {
            const proceed = confirm(
                'Import file uses a newer schema (v' + data.schemaVersion + '). Continue anyway?'
            );
            if (!proceed) {
                return { players: 0, matches: 0, updated: 0 };
            }
        }

        let playersAdded = 0;
        let matchesAdded = 0;
        let updated = 0;

        for (const player of data.players) {
            const existing = await getPlayer(player.id);
            if (existing && merge) {
                await putPlayer(player);
                updated++;
            } else if (!existing) {
                await putPlayer(player);
                playersAdded++;
            } else {
                await putPlayer(player);
                updated++;
            }
        }

        for (const match of data.matches) {
            const existing = await getMatch(match.id);
            if (!existing) {
                await putMatch(match);
                matchesAdded++;
            } else if (merge) {
                await putMatch(match);
                updated++;
            } else {
                await putMatch(match);
                updated++;
            }
        }

        await setMeta('schemaVersion', SCHEMA_VERSION);
        return { players: playersAdded, matches: matchesAdded, updated: updated };
    }

    async function clearAllStats() {
        await openDatabase();
        const dbTx = tx(['players', 'matches'], 'readwrite');
        await promisifyRequest(dbTx.objectStore('players').clear());
        await promisifyRequest(dbTx.objectStore('matches').clear());
        resetSessionState();
    }

    function getOverlayStatsMode() {
        return localStorage.getItem('overlayStatsMode') || '';
    }

    function setOverlayStatsMode(mode) {
        localStorage.setItem('overlayStatsMode', mode || '');
    }

    function migrateOverlayStorage() {
        // Legacy flag must not auto-enable H2H on refresh; discard it.
        if (localStorage.getItem('h2hOverlayEnabled')) {
            localStorage.removeItem('h2hOverlayEnabled');
        }
    }

    function updateOverlayButtonStyles(activeMode) {
        const buttons = {
            p1: document.getElementById('overlayP1StatsBtn'),
            p2: document.getElementById('overlayP2StatsBtn'),
            h2h: document.getElementById('overlayH2HBtn')
        };
        Object.keys(buttons).forEach(function (key) {
            const btn = buttons[key];
            if (!btn) {
                return;
            }
            if (activeMode === key) {
                btn.style.backgroundColor = '#008000';
                btn.style.color = '#ffffff';
            } else {
                btn.style.backgroundColor = '';
                btn.style.color = '';
            }
        });
    }

    function syncOverlayButtonsFromStorage() {
        migrateOverlayStorage();
        updateOverlayButtonStyles(getOverlayStatsMode());
    }

    async function resolvePlayerIdForSlot(slot) {
        const inputId = slot === '1' ? 'p1Name' : 'p2Name';
        const name = truncateName(document.getElementById(inputId)?.value || '');
        if (!name) {
            return null;
        }
        let id = getPlayerIdFromInput(slot);
        if (id) {
            const player = await getPlayer(id);
            if (player) {
                return player.id;
            }
        }
        const found = await lookupPlayer(name);
        return found ? found.id : null;
    }

    async function buildPlayerOverlayPayload(slot) {
        const mode = slot === '1' ? 'p1' : 'p2';
        const inputId = slot === '1' ? 'p1Name' : 'p2Name';
        const name = truncateName(document.getElementById(inputId)?.value || '');
        const visible = getOverlayStatsMode() === mode;

        if (!name) {
            return { visible: visible, mode: mode, title: 'Player ' + slot, emptyMessage: 'First tracked game' };
        }

        const playerId = await resolvePlayerIdForSlot(slot);
        if (!playerId) {
            return { visible: visible, mode: mode, title: name, emptyMessage: 'First tracked game' };
        }

        const player = await getPlayer(playerId);
        if (!player || (player.stats.gamesWon + player.stats.gamesLost + player.stats.racksWon) === 0) {
            return {
                visible: visible,
                mode: mode,
                title: player ? player.name : name,
                emptyMessage: 'First tracked game'
            };
        }

        return {
            visible: visible,
            mode: mode,
            title: player.name,
            gamesWL: formatWL(player.stats.gamesWon, player.stats.gamesLost),
            racksWL: formatWL(player.stats.racksWon, player.stats.racksLost),
            ballsWL: formatWL(player.stats.ballsWon, player.stats.ballsLost),
            winRate: getWinRate(player.stats)
        };
    }

    async function buildH2HOverlayPayload() {
        const visible = getOverlayStatsMode() === 'h2h';
        const p1Name = truncateName(document.getElementById('p1Name')?.value || '');
        const p2Name = truncateName(document.getElementById('p2Name')?.value || '');

        if (!p1Name || !p2Name) {
            return { visible: visible, mode: 'h2h', title: 'Head to Head', emptyMessage: 'First match-up' };
        }

        const p1Id = await resolvePlayerIdForSlot('1');
        const p2Id = await resolvePlayerIdForSlot('2');

        if (!p1Id || !p2Id) {
            return { visible: visible, mode: 'h2h', title: 'Head to Head', emptyMessage: 'First match-up' };
        }

        const h2h = await getHeadToHead(p1Id, p2Id);
        if (!h2h) {
            return { visible: visible, mode: 'h2h', title: 'Head to Head', emptyMessage: 'First match-up' };
        }
        const totalGames = (h2h.gamesWon[p1Id] || 0) + (h2h.gamesWon[p2Id] || 0);
        const totalRacks = (h2h.racksWon[p1Id] || 0) + (h2h.racksWon[p2Id] || 0);
        if (totalGames + totalRacks === 0) {
            return { visible: visible, mode: 'h2h', title: 'Head to Head', emptyMessage: 'First match-up' };
        }

        return {
            visible: visible,
            mode: 'h2h',
            title: 'Head to Head',
            p1Name: h2h.player1.name,
            p2Name: h2h.player2.name,
            p1Games: h2h.gamesWon[p1Id] || 0,
            p2Games: h2h.gamesWon[p2Id] || 0,
            p1Racks: h2h.racksWon[p1Id] || 0,
            p2Racks: h2h.racksWon[p2Id] || 0,
            p1Balls: h2h.ballsWon[p1Id] || 0,
            p2Balls: h2h.ballsWon[p2Id] || 0
        };
    }

    async function buildOverlayStatsPayload() {
        const mode = getOverlayStatsMode();
        if (!mode) {
            return { visible: false };
        }
        if (mode === 'p1') {
            return buildPlayerOverlayPayload('1');
        }
        if (mode === 'p2') {
            return buildPlayerOverlayPayload('2');
        }
        if (mode === 'h2h') {
            return buildH2HOverlayPayload();
        }
        return { visible: false };
    }

    function persistOverlayStatsPayload(payload) {
        try {
            localStorage.setItem('overlayStatsPayload', JSON.stringify(payload || { visible: false }));
        } catch (err) {
            console.warn('Failed to persist overlay stats payload:', err);
        }
    }

    function broadcastOverlayStatsIfEnabled() {
        buildOverlayStatsPayload().then(function (payload) {
            persistOverlayStatsPayload(payload);
            if (typeof bc !== 'undefined') {
                bc.postMessage({ overlayStats: payload });
            }
        }).catch(function (err) {
            console.error('Overlay stats broadcast error:', err);
        });
    }

    function toggleOverlayStats(mode) {
        const current = getOverlayStatsMode();
        if (current === mode) {
            setOverlayStatsMode('');
        } else {
            setOverlayStatsMode(mode);
        }
        updateOverlayButtonStyles(getOverlayStatsMode());
        broadcastOverlayStatsIfEnabled();
    }

    // --- Autocomplete ---
    const autocompleteState = {};

    function initPlayerAutocomplete() {
        initAutocompleteForInput('1', 'p1Name', 'p1Autocomplete');
        initAutocompleteForInput('2', 'p2Name', 'p2Autocomplete');
    }

    function initAutocompleteForInput(slot, inputId, listId) {
        const input = document.getElementById(inputId);
        const list = document.getElementById(listId);
        if (!input || !list) {
            return;
        }

        autocompleteState[slot] = { activeIndex: -1, results: [], createNewName: null };
        let debounceTimer = null;

        input.addEventListener('input', function () {
            if (!input.value.trim()) {
                input.removeAttribute('data-player-id');
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                refreshAutocomplete(slot, input, list);
            }, 150);
        });

        input.addEventListener('focus', function () {
            refreshAutocomplete(slot, input, list);
        });

        input.addEventListener('keydown', function (e) {
            const state = autocompleteState[slot];
            const listVisible = !list.classList.contains('noShow');
            if (!listVisible) {
                return;
            }

            if (state.createNewName && state.results.length === 0) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    createAndSelectAutocompletePlayer(slot, state.createNewName, input, list);
                } else if (e.key === 'Escape') {
                    list.classList.add('noShow');
                }
                return;
            }

            if (!state.results.length) {
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.activeIndex = Math.min(state.activeIndex + 1, state.results.length - 1);
                highlightAutocompleteItem(list, state.activeIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.activeIndex = Math.max(state.activeIndex - 1, 0);
                highlightAutocompleteItem(list, state.activeIndex);
            } else if (e.key === 'Enter' && state.activeIndex >= 0) {
                e.preventDefault();
                selectAutocompletePlayer(slot, state.results[state.activeIndex], input, list);
            } else if (e.key === 'Escape') {
                list.classList.add('noShow');
            }
        });

        document.addEventListener('click', function (e) {
            if (!input.contains(e.target) && !list.contains(e.target)) {
                list.classList.add('noShow');
            }
        });
    }

    async function createAndSelectAutocompletePlayer(slot, name, input, list) {
        try {
            const player = await ensurePlayer(name);
            if (!player) {
                return;
            }
            autocompleteState[slot].createNewName = null;
            selectAutocompletePlayer(slot, player, input, list);
        } catch (err) {
            console.error('Create player error:', err);
            alert('Could not create player: ' + err.message);
        }
    }

    async function refreshAutocomplete(slot, input, list) {
        const query = input.value.trim();
        if (!query) {
            autocompleteState[slot].createNewName = null;
            list.classList.add('noShow');
            list.innerHTML = '';
            return;
        }

        try {
            const results = await searchPlayers(query, 8);
            autocompleteState[slot].results = results;
            autocompleteState[slot].activeIndex = -1;
            autocompleteState[slot].createNewName = null;
            list.innerHTML = '';

            if (results.length === 0) {
                const createName = truncateName(query);
                autocompleteState[slot].createNewName = createName;
                autocompleteState[slot].activeIndex = 0;
                const item = document.createElement('div');
                item.className = 'autocomplete-item autocomplete-new autocomplete-active';
                item.textContent = 'Create new player: "' + createName + '"';
                item.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    createAndSelectAutocompletePlayer(slot, createName, input, list);
                });
                list.appendChild(item);
                list.classList.remove('noShow');
                return;
            }

            results.forEach(function (player, index) {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.dataset.index = index;
                item.innerHTML = '<span class="autocomplete-name">' + escapeHtml(player.name) + '</span>' +
                    '<span class="autocomplete-preview">' + formatPlayerPreview(player.stats) + '</span>';
                item.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    selectAutocompletePlayer(slot, player, input, list);
                });
                list.appendChild(item);
            });
            list.classList.remove('noShow');
        } catch (err) {
            console.error('Autocomplete error:', err);
        }
    }

    function highlightAutocompleteItem(list, index) {
        const items = list.querySelectorAll('.autocomplete-item');
        items.forEach(function (item, i) {
            item.classList.toggle('autocomplete-active', i === index);
        });
    }

    function selectAutocompletePlayer(slot, player, input, list) {
        input.value = player.name;
        setPlayerIdOnInput(slot, player.id);
        list.classList.add('noShow');
        if (typeof postNames === 'function') {
            postNames();
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDate(iso) {
        if (!iso) {
            return '\u2014';
        }
        try {
            return new Date(iso).toLocaleDateString();
        } catch (e) {
            return iso;
        }
    }

    // --- Stats Modal UI ---
    function renderMatchActionButtons(matchId) {
        return '<td class="stats-actions-col">' +
            '<button type="button" class="stats-edit-btn hover obs28 button" onclick="openMatchEditModal(\'' + matchId + '\')">Edit</button> ' +
            '<button type="button" class="stats-delete-btn hover obs28 button" onclick="confirmDeleteMatch(\'' + matchId + '\')">Del</button>' +
            '</td>';
    }

    function openMatchEditModal(matchId, player1Id, player2Id) {
        const modal = document.getElementById('statsMatchEditModal');
        if (!modal) {
            return;
        }

        const title = document.getElementById('statsMatchEditTitle');
        const deleteBtn = document.getElementById('statsMatchDeleteBtn');
        const p1Label = document.getElementById('statsMatchP1Label');
        const p2Label = document.getElementById('statsMatchP2Label');

        modal.dataset.matchId = matchId || '';
        modal.dataset.player1Id = player1Id || '';
        modal.dataset.player2Id = player2Id || '';

        if (matchId) {
            getMatch(matchId).then(function (match) {
                if (!match) {
                    return;
                }
                modal.dataset.player1Id = match.player1Id;
                modal.dataset.player2Id = match.player2Id;

                getPlayer(match.player1Id).then(function (p1) {
                    getPlayer(match.player2Id).then(function (p2) {
                        if (title) {
                            title.textContent = 'Edit Match';
                        }
                        if (deleteBtn) {
                            deleteBtn.classList.remove('noShow');
                        }
                        if (p1Label) {
                            p1Label.textContent = p1 ? p1.name + ' score:' : 'Player 1 score:';
                        }
                        if (p2Label) {
                            p2Label.textContent = p2 ? p2.name + ' score:' : 'Player 2 score:';
                        }
                        document.getElementById('statsMatchDate').value = dateInputFromIso(match.completedAt || match.startedAt);
                        document.getElementById('statsMatchGameType').value = match.gameType || 'game1';
                        document.getElementById('statsMatchScoreP1').value = match.finalScore.p1;
                        document.getElementById('statsMatchScoreP2').value = match.finalScore.p2;
                        document.getElementById('statsMatchStatus').value = match.status === 'completed' ? 'completed' : 'active';
                        document.getElementById('statsMatchBallsP1').value = countBallsForPlayer(match, match.player1Id);
                        document.getElementById('statsMatchBallsP2').value = countBallsForPlayer(match, match.player2Id);
                        modal.style.display = 'block';
                    });
                });
            }).catch(function (err) {
                alert('Failed to load match: ' + err.message);
            });
        } else {
            Promise.all([getPlayer(player1Id), getPlayer(player2Id)]).then(function (results) {
                const p1 = results[0];
                const p2 = results[1];
                if (title) {
                    title.textContent = 'Add Match';
                }
                if (deleteBtn) {
                    deleteBtn.classList.add('noShow');
                }
                if (p1Label) {
                    p1Label.textContent = p1 ? p1.name + ' score:' : 'Player 1 score:';
                }
                if (p2Label) {
                    p2Label.textContent = p2 ? p2.name + ' score:' : 'Player 2 score:';
                }
                document.getElementById('statsMatchDate').value = dateInputFromIso(new Date().toISOString());
                document.getElementById('statsMatchGameType').value = 'game1';
                document.getElementById('statsMatchScoreP1').value = 0;
                document.getElementById('statsMatchScoreP2').value = 0;
                document.getElementById('statsMatchStatus').value = 'completed';
                document.getElementById('statsMatchBallsP1').value = 0;
                document.getElementById('statsMatchBallsP2').value = 0;
                modal.style.display = 'block';
            });
        }
    }

    function closeMatchEditModal() {
        const modal = document.getElementById('statsMatchEditModal');
        if (modal) {
            modal.style.display = 'none';
            modal.dataset.matchId = '';
            modal.dataset.player1Id = '';
            modal.dataset.player2Id = '';
        }
    }

    async function saveMatchFromModal() {
        const modal = document.getElementById('statsMatchEditModal');
        if (!modal) {
            return;
        }

        const matchId = modal.dataset.matchId || null;
        const player1Id = modal.dataset.player1Id;
        const player2Id = modal.dataset.player2Id;

        if (!player1Id || !player2Id) {
            alert('Both players must be selected.');
            return;
        }

        try {
            await saveMatch({
                id: matchId || undefined,
                player1Id: player1Id,
                player2Id: player2Id,
                date: document.getElementById('statsMatchDate').value,
                gameType: document.getElementById('statsMatchGameType').value,
                scoreP1: document.getElementById('statsMatchScoreP1').value,
                scoreP2: document.getElementById('statsMatchScoreP2').value,
                status: document.getElementById('statsMatchStatus').value,
                ballsP1: document.getElementById('statsMatchBallsP1').value,
                ballsP2: document.getElementById('statsMatchBallsP2').value
            });
            closeMatchEditModal();
            await refreshStatsUI();
        } catch (err) {
            alert('Save failed: ' + err.message);
        }
    }

    async function confirmDeleteMatch(matchId) {
        if (!matchId) {
            return;
        }
        if (!confirm('Delete this match? Player stats will be recalculated.')) {
            return;
        }
        try {
            await deleteMatch(matchId);
            closeMatchEditModal();
            await refreshStatsUI();
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    }

    async function deleteMatchFromModal() {
        const modal = document.getElementById('statsMatchEditModal');
        if (!modal || !modal.dataset.matchId) {
            return;
        }
        await confirmDeleteMatch(modal.dataset.matchId);
    }

    function openAddMatchForH2H() {
        const select1 = document.getElementById('h2hPlayer1Select');
        const select2 = document.getElementById('h2hPlayer2Select');
        if (!select1 || !select2 || !select1.value || !select2.value || select1.value === select2.value) {
            alert('Select two different players first.');
            return;
        }
        openMatchEditModal(null, select1.value, select2.value);
    }

    function openAddMatchForPlayer() {
        const select = document.getElementById('statsPlayerOpponentSelect');
        if (!statsModalSelectedPlayerId) {
            alert('No player selected.');
            return;
        }
        if (!select || !select.value) {
            alert('Select an opponent first.');
            return;
        }
        if (select.value === statsModalSelectedPlayerId) {
            alert('Select a different opponent.');
            return;
        }
        openMatchEditModal(null, statsModalSelectedPlayerId, select.value);
    }

    async function openPlayerRenameModal() {
        if (!statsModalSelectedPlayerId) {
            alert('Select a player from the leaderboard first.');
            return;
        }
        const player = await getPlayer(statsModalSelectedPlayerId);
        if (!player) {
            alert('Player not found.');
            return;
        }
        const modal = document.getElementById('statsPlayerRenameModal');
        const input = document.getElementById('statsPlayerRenameInput');
        if (!modal || !input) {
            return;
        }
        modal.dataset.playerId = statsModalSelectedPlayerId;
        input.value = player.name;
        modal.style.display = 'block';
        input.focus();
        input.select();
    }

    function closePlayerRenameModal() {
        const modal = document.getElementById('statsPlayerRenameModal');
        if (modal) {
            modal.style.display = 'none';
            modal.dataset.playerId = '';
        }
    }

    async function savePlayerRenameFromModal() {
        const modal = document.getElementById('statsPlayerRenameModal');
        const input = document.getElementById('statsPlayerRenameInput');
        if (!modal || !input) {
            return;
        }
        const playerId = modal.dataset.playerId;
        if (!playerId) {
            return;
        }
        try {
            await updatePlayerName(playerId, input.value);
            if (typeof postNames === 'function') {
                postNames();
            }
            closePlayerRenameModal();
            await refreshStatsUI();
        } catch (err) {
            alert('Rename failed: ' + err.message);
        }
    }

    async function confirmDeletePlayer() {
        if (!statsModalSelectedPlayerId) {
            return;
        }
        const player = await getPlayer(statsModalSelectedPlayerId);
        if (!player) {
            return;
        }
        const matches = await getMatchesForPlayer(statsModalSelectedPlayerId);
        if (!confirm('Delete "' + player.name + '" and ' + matches.length + ' match(es)? This cannot be undone.')) {
            return;
        }
        if (!confirm('Are you absolutely sure?')) {
            return;
        }
        try {
            await deletePlayer(statsModalSelectedPlayerId);
            document.getElementById('statsPlayerDetail').innerHTML = '<p class="stats-empty">Select a player from the leaderboard.</p>';
            statsModalSelectedPlayerId = null;
            await refreshStatsUI();
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    }

    // --- Stats Modal UI ---
    let statsModalSelectedPlayerId = null;

    async function openStatsModal() {
        const modal = document.getElementById('statsModal');
        if (!modal) {
            return;
        }
        await openDatabase();
        modal.style.display = 'block';
        const body = modal.querySelector('.stats-modal-body');
        if (body) {
            body.scrollTop = 0;
        }
        await renderStatsLeaderboard();
        await populateH2HPlayerSelects();
        switchStatsTab('leaderboard');
    }

    function closeStatsModal() {
        const modal = document.getElementById('statsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    function switchStatsTab(tabName) {
        document.querySelectorAll('.stats-tab-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.stats-tab-panel').forEach(function (panel) {
            panel.classList.toggle('noShow', panel.id !== 'statsTab-' + tabName);
        });
        const body = document.querySelector('#statsModal .stats-modal-body');
        if (body) {
            body.scrollTop = 0;
        }
        if (tabName === 'h2h') {
            refreshH2HView();
        }
    }

    async function renderStatsLeaderboard() {
        const tbody = document.getElementById('statsLeaderboardBody');
        if (!tbody) {
            return;
        }
        const players = await getAllPlayers();
        players.sort(function (a, b) {
            return b.stats.gamesWon - a.stats.gamesWon || b.stats.racksWon - a.stats.racksWon;
        });

        if (players.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">No players recorded yet.</td></tr>';
            return;
        }

        tbody.innerHTML = players.map(function (p) {
            const wr = getWinRate(p.stats);
            return '<tr class="stats-row" data-player-id="' + p.id + '">' +
                '<td>' + escapeHtml(p.name) + '</td>' +
                '<td>' + formatWL(p.stats.gamesWon, p.stats.gamesLost) + '</td>' +
                '<td>' + wr + '%</td>' +
                '<td>' + formatWL(p.stats.racksWon, p.stats.racksLost) + '</td>' +
                '<td>' + formatDate(p.lastPlayedAt) + '</td>' +
                '</tr>';
        }).join('');

        tbody.querySelectorAll('.stats-row').forEach(function (row) {
            row.addEventListener('click', function () {
                showPlayerDetail(row.dataset.playerId);
            });
        });
    }

    function renderPlayerStatsTable(player) {
        const wr = getWinRate(player.stats);
        let typeRows = '';
        Object.keys(GAME_TYPE_LABELS).forEach(function (gt) {
            const ts = player.stats.byGameType[gt];
            if (!ts || (ts.gamesWon + ts.gamesLost + ts.racksWon) === 0) {
                return;
            }
            typeRows += '<tr><td>' + GAME_TYPE_LABELS[gt] + '</td>' +
                '<td>' + formatWL(ts.gamesWon, ts.gamesLost) + '</td>' +
                '<td>' + formatWL(ts.racksWon, ts.racksLost) + '</td>' +
                '<td>' + formatWL(ts.ballsWon, ts.ballsLost) + '</td>' +
                '<td></td></tr>';
        });

        const overallRow = '<tr class="stats-overall-row"><td><strong>Overall</strong></td>' +
            '<td>' + formatWL(player.stats.gamesWon, player.stats.gamesLost) + ' (' + wr + '%)</td>' +
            '<td>' + formatWL(player.stats.racksWon, player.stats.racksLost) + '</td>' +
            '<td>' + formatWL(player.stats.ballsWon, player.stats.ballsLost) + '</td>' +
            '<td>' + formatDate(player.lastPlayedAt) + '</td></tr>';

        return '<table class="stats-table stats-player-stats-table"><thead><tr>' +
            '<th>Category</th><th>G W/L</th><th>R W/L</th><th>B W/L</th><th>Last</th>' +
            '</tr></thead><tbody>' + overallRow + typeRows + '</tbody></table>';
    }

    function renderH2HComparisonTable(viewerId, opponentId, h2h) {
        if (!h2h) {
            return '<p class="stats-empty">No head-to-head data.</p>';
        }

        const viewer = h2h.player1.id === viewerId ? h2h.player1 : h2h.player2;
        const opponent = h2h.player1.id === viewerId ? h2h.player2 : h2h.player1;
        const totalGames = (h2h.gamesWon[viewerId] || 0) + (h2h.gamesWon[opponentId] || 0);
        const totalRacks = (h2h.racksWon[viewerId] || 0) + (h2h.racksWon[opponentId] || 0);
        const totalBalls = (h2h.ballsWon[viewerId] || 0) + (h2h.ballsWon[opponentId] || 0);

        if (totalGames + totalRacks + totalBalls === 0) {
            return '<p class="stats-empty">No matches recorded vs this opponent.</p>';
        }

        let html = '<table class="stats-table stats-h2h-comparison-table"><thead><tr>' +
            '<th>Player</th><th>G W/L</th><th>R W/L</th><th>B W/L</th>' +
            '</tr></thead><tbody>' +
            '<tr><td>' + escapeHtml(viewer.name) + '</td>' +
            '<td>' + formatWL(h2h.gamesWon[viewerId] || 0, h2h.gamesWon[opponentId] || 0) + '</td>' +
            '<td>' + formatWL(h2h.racksWon[viewerId] || 0, h2h.racksWon[opponentId] || 0) + '</td>' +
            '<td>' + formatWL(h2h.ballsWon[viewerId] || 0, h2h.ballsWon[opponentId] || 0) + '</td></tr>' +
            '<tr><td>' + escapeHtml(opponent.name) + '</td>' +
            '<td>' + formatWL(h2h.gamesWon[opponentId] || 0, h2h.gamesWon[viewerId] || 0) + '</td>' +
            '<td>' + formatWL(h2h.racksWon[opponentId] || 0, h2h.racksWon[viewerId] || 0) + '</td>' +
            '<td>' + formatWL(h2h.ballsWon[opponentId] || 0, h2h.ballsWon[viewerId] || 0) + '</td></tr>' +
            '</tbody></table>';

        if (h2h.lastPlayedAt) {
            html += '<p class="stats-h2h-last">Last played: ' + formatDate(h2h.lastPlayedAt) + '</p>';
        }
        return html;
    }

    function renderInlineH2HStats(playerId, otherId, h2h) {
        if (!h2h || !playerId || !otherId) {
            return '<span class="stats-empty">&mdash;</span>';
        }
        const totalGames = (h2h.gamesWon[playerId] || 0) + (h2h.gamesWon[otherId] || 0);
        const totalRacks = (h2h.racksWon[playerId] || 0) + (h2h.racksWon[otherId] || 0);
        const totalBalls = (h2h.ballsWon[playerId] || 0) + (h2h.ballsWon[otherId] || 0);
        if (totalGames + totalRacks + totalBalls === 0) {
            return '<span class="stats-empty">No recorded matches</span>';
        }
        return 'G ' + formatWL(h2h.gamesWon[playerId] || 0, h2h.gamesWon[otherId] || 0) +
            ' &middot; R ' + formatWL(h2h.racksWon[playerId] || 0, h2h.racksWon[otherId] || 0) +
            ' &middot; B ' + formatWL(h2h.ballsWon[playerId] || 0, h2h.ballsWon[otherId] || 0);
    }

    function renderPlayerMatchHistoryRows(playerId, matches) {
        if (matches.length === 0) {
            return '<tr><td colspan="6" class="stats-empty">No matches recorded.</td></tr>';
        }
        return matches.map(function (m) {
            const opponent = m.player1Id === playerId ? m.player2Name : m.player1Name;
            const viewerScore = m.player1Id === playerId ? m.finalScore.p1 : m.finalScore.p2;
            const oppScore = m.player1Id === playerId ? m.finalScore.p2 : m.finalScore.p1;
            return '<tr>' +
                '<td>' + formatDate(m.completedAt || m.startedAt) + '</td>' +
                '<td>' + escapeHtml(opponent) + '</td>' +
                '<td>' + (GAME_TYPE_LABELS[m.gameType] || m.gameType) + '</td>' +
                '<td>' + viewerScore + ' - ' + oppScore + '</td>' +
                '<td>' + (m.status === 'completed' ? 'Completed' : 'Partial') + '</td>' +
                renderMatchActionButtons(m.id) +
                '</tr>';
        }).join('');
    }

    async function refreshPlayerOpponentH2H() {
        const panel = document.getElementById('statsPlayerH2HPanel');
        const select = document.getElementById('statsPlayerOpponentSelect');
        if (!panel || !statsModalSelectedPlayerId) {
            return;
        }
        let bodyHtml;
        if (!select || !select.value || select.value === statsModalSelectedPlayerId) {
            bodyHtml = '<p class="stats-empty">Select an opponent to view head-to-head stats.</p>';
        } else {
            const h2h = await getHeadToHead(statsModalSelectedPlayerId, select.value);
            bodyHtml = renderH2HComparisonTable(statsModalSelectedPlayerId, select.value, h2h);
        }
        panel.innerHTML = '<h4 class="stats-section-title">Head to Head</h4>' + bodyHtml;
    }

    async function showPlayerDetail(playerId) {
        statsModalSelectedPlayerId = playerId;
        const player = await getPlayer(playerId);
        const detailPanel = document.getElementById('statsPlayerDetail');
        if (!player || !detailPanel) {
            return;
        }

        const prevOpponentSelect = document.getElementById('statsPlayerOpponentSelect');
        const prevOpponentId = prevOpponentSelect ? prevOpponentSelect.value : '';

        const matches = await getMatchesForPlayer(playerId);
        const allPlayers = await getAllPlayers();
        const opponentOptions = allPlayers
            .filter(function (p) { return p.id !== playerId; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); })
            .map(function (p) {
                return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
            }).join('');

        const matchRows = renderPlayerMatchHistoryRows(playerId, matches);

        detailPanel.innerHTML =
            '<div class="stats-player-header">' +
            '<h3>' + escapeHtml(player.name) + '</h3>' +
            '<div class="stats-player-header-actions">' +
            '<div class="hover obs28 button stats-edit-btn" onclick="promptRenamePlayer()">Edit Name</div>' +
            '<div class="hover obs28 button stats-danger-btn" onclick="confirmDeletePlayer()">Delete Player</div>' +
            '</div></div>' +
            '<div class="stats-section">' + renderPlayerStatsTable(player) + '</div>' +
            '<div class="stats-section stats-opponent-row">' +
            '<label>Opponent:' +
            '<select id="statsPlayerOpponentSelect" onchange="refreshPlayerOpponentH2H()">' +
            '<option value="">-- Select --</option>' + opponentOptions + '</select></label></div>' +
            '<div id="statsPlayerH2HPanel" class="stats-section">' +
            '<h4 class="stats-section-title">Head to Head</h4>' +
            '<p class="stats-empty">Select an opponent to view head-to-head stats.</p></div>' +
            '<div class="stats-section stats-section-actions">' +
            '<div class="hover obs28 button stats-edit-btn" onclick="openAddMatchForPlayer()">Add Match</div></div>' +
            '<div class="stats-section">' +
            '<h4 class="stats-section-title">Match History</h4>' +
            '<div class="stats-scroll-panel">' +
            '<table class="stats-table"><thead><tr><th>Date</th><th>Opponent</th><th>Game</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
            matchRows + '</tbody></table></div></div>';

        const opponentSelect = document.getElementById('statsPlayerOpponentSelect');
        if (opponentSelect && prevOpponentId && prevOpponentId !== playerId &&
            opponentSelect.querySelector('option[value="' + prevOpponentId + '"]')) {
            opponentSelect.value = prevOpponentId;
        }
        await refreshPlayerOpponentH2H();

        switchStatsTab('detail');
    }

    async function populateH2HPlayerSelects() {
        const select1 = document.getElementById('h2hPlayer1Select');
        const select2 = document.getElementById('h2hPlayer2Select');
        if (!select1 || !select2) {
            return;
        }
        const prev1 = select1.value;
        const prev2 = select2.value;
        const players = await getAllPlayers();
        players.sort(function (a, b) { return a.name.localeCompare(b.name); });

        const options = players.map(function (p) {
            return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
        }).join('');

        select1.innerHTML = '<option value="">-- Select --</option>' + options;
        select2.innerHTML = '<option value="">-- Select --</option>' + options;

        if (prev1 && select1.querySelector('option[value="' + prev1 + '"]')) {
            select1.value = prev1;
        } else {
            const p1Id = getPlayerIdFromInput('1');
            if (p1Id) {
                select1.value = p1Id;
            }
        }
        if (prev2 && select2.querySelector('option[value="' + prev2 + '"]')) {
            select2.value = prev2;
        } else {
            const p2Id = getPlayerIdFromInput('2');
            if (p2Id) {
                select2.value = p2Id;
            }
        }
    }

    async function refreshH2HView() {
        const select1 = document.getElementById('h2hPlayer1Select');
        const select2 = document.getElementById('h2hPlayer2Select');
        const stats1 = document.getElementById('h2hPlayer1Stats');
        const stats2 = document.getElementById('h2hPlayer2Stats');
        const container = document.getElementById('h2hResults');
        if (!select1 || !select2 || !container) {
            return;
        }

        const id1 = select1.value;
        const id2 = select2.value;
        if (!id1 || !id2 || id1 === id2) {
            if (stats1) {
                stats1.innerHTML = '<span class="stats-empty">Select two different players.</span>';
            }
            if (stats2) {
                stats2.innerHTML = '';
            }
            container.innerHTML = '<p class="stats-empty">Select two different players.</p>';
            return;
        }

        const h2h = await getHeadToHead(id1, id2);
        if (stats1) {
            stats1.innerHTML = renderInlineH2HStats(id1, id2, h2h);
        }
        if (stats2) {
            stats2.innerHTML = renderInlineH2HStats(id2, id1, h2h);
        }

        if (!h2h) {
            container.innerHTML = '<p class="stats-empty">No head-to-head data.</p>';
            return;
        }

        if (h2h.matches.length === 0) {
            container.innerHTML = '<p class="stats-empty">No matches recorded between these players.</p>';
            return;
        }

        container.innerHTML = '<table class="stats-table"><thead><tr><th>Date</th><th>Game</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
            h2h.matches.map(function (m) {
                const p1Score = m.player1Id === id1 ? m.finalScore.p1 : m.finalScore.p2;
                const p2Score = m.player1Id === id1 ? m.finalScore.p2 : m.finalScore.p1;
                const name1 = h2h.player1.name;
                const name2 = h2h.player2.name;
                return '<tr><td>' + formatDate(m.completedAt || m.startedAt) + '</td>' +
                    '<td>' + (GAME_TYPE_LABELS[m.gameType] || m.gameType) + '</td>' +
                    '<td>' + escapeHtml(name1) + ' ' + p1Score + ' - ' + p2Score + ' ' + escapeHtml(name2) + '</td>' +
                    '<td>' + (m.status === 'completed' ? 'Completed' : 'Partial') + '</td>' +
                    renderMatchActionButtons(m.id) +
                    '</tr>';
            }).join('') + '</tbody></table>';
    }

    async function exportStatsJson() {
        const data = await exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const date = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'cuesport-stats-' + date + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function importStatsJson(file) {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await importData(data, true);
        alert('Import complete: ' + result.players + ' players added, ' +
            result.matches + ' matches added, ' + result.updated + ' updated.');
        await renderStatsLeaderboard();
        await populateH2HPlayerSelects();
    }

    async function clearAllStatsConfirmed() {
        if (!confirm('Clear ALL player statistics and match history? This cannot be undone.')) {
            return;
        }
        if (!confirm('Are you absolutely sure? All recorded stats will be permanently deleted.')) {
            return;
        }
        await clearAllStats();
        await renderStatsLeaderboard();
        await populateH2HPlayerSelects();
        document.getElementById('statsPlayerDetail').innerHTML = '<p class="stats-empty">Select a player from the leaderboard.</p>';
        const h2hStats1 = document.getElementById('h2hPlayer1Stats');
        const h2hStats2 = document.getElementById('h2hPlayer2Stats');
        if (h2hStats1) {
            h2hStats1.innerHTML = '<span class="stats-empty">Select two different players.</span>';
        }
        if (h2hStats2) {
            h2hStats2.innerHTML = '';
        }
        document.getElementById('h2hResults').innerHTML = '<p class="stats-empty">Select two different players.</p>';
        broadcastOverlayStatsIfEnabled();
    }

    // Expose API
    window.PlayerStats = {
        init: openDatabase,
        ensurePlayer: ensurePlayer,
        findPlayerByNormalizedName: findPlayerByNormalizedName,
        searchPlayers: searchPlayers,
        getPlayer: getPlayer,
        getAllPlayers: getAllPlayers,
        recordRackWin: recordRackWin,
        undoLastRack: undoLastRack,
        recordBallWin: recordBallWin,
        undoLastBall: undoLastBall,
        checkMatchCompletion: checkMatchCompletion,
        onNamesUpdated: onNamesUpdated,
        onClearGame: onClearGame,
        onResetScores: onResetScores,
        getHeadToHead: getHeadToHead,
        getMatchesForPlayer: getMatchesForPlayer,
        saveMatch: saveMatch,
        deleteMatch: deleteMatch,
        recomputePlayerStats: recomputePlayerStats,
        updatePlayerName: updatePlayerName,
        deletePlayer: deletePlayer,
        exportData: exportData,
        importData: importData,
        clearAllStats: clearAllStats,
        broadcastOverlayStatsIfEnabled: broadcastOverlayStatsIfEnabled,
        syncOverlayButtonsFromStorage: syncOverlayButtonsFromStorage,
        initPlayerAutocomplete: initPlayerAutocomplete,
        buildOverlayStatsPayload: buildOverlayStatsPayload
    };

    window.openStatsModal = openStatsModal;
    window.closeStatsModal = closeStatsModal;
    window.switchStatsTab = switchStatsTab;
    window.refreshH2HView = refreshH2HView;
    window.refreshPlayerOpponentH2H = refreshPlayerOpponentH2H;
    window.exportStatsJson = exportStatsJson;
    window.importStatsJsonFile = function () {
        const input = document.getElementById('statsImportFile');
        if (input) {
            input.click();
        }
    };
    window.handleStatsImportFile = function (input) {
        if (input.files && input.files[0]) {
            importStatsJson(input.files[0]).catch(function (err) {
                alert('Import failed: ' + err.message);
            });
            input.value = '';
        }
    };
    window.clearAllStatsConfirmed = clearAllStatsConfirmed;
    window.toggleOverlayStats = toggleOverlayStats;
    window.openMatchEditModal = openMatchEditModal;
    window.closeMatchEditModal = closeMatchEditModal;
    window.saveMatchFromModal = saveMatchFromModal;
    window.deleteMatchFromModal = deleteMatchFromModal;
    window.confirmDeleteMatch = confirmDeleteMatch;
    window.openAddMatchForH2H = openAddMatchForH2H;
    window.openAddMatchForPlayer = openAddMatchForPlayer;
    window.promptRenamePlayer = openPlayerRenameModal;
    window.openPlayerRenameModal = openPlayerRenameModal;
    window.closePlayerRenameModal = closePlayerRenameModal;
    window.savePlayerRenameFromModal = savePlayerRenameFromModal;
    window.confirmDeletePlayer = confirmDeletePlayer;

    openDatabase().catch(function (err) {
        console.error('PlayerStats DB init failed:', err);
    });
})();
