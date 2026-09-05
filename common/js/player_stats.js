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
        game7: 'Custom',
        game8: 'Snooker'
    };

    const STAT_VISIBILITY_CATALOG = [
        { id: 'gamesWL', label: 'Matches Won (H2H)', gameTypes: ['game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8'] },
        { id: 'racksWL', label: 'Racks / Frames Won (H2H)', gameTypes: ['game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8'] },
        { id: 'winStreak', label: 'Win Streak', gameTypes: ['game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8'] },
        { id: 'currentBreak', label: 'Current Break / Run', gameTypes: ['game4', 'game8'] },
        { id: 'possibleBreak', label: 'Possible Break', gameTypes: ['game8'] },
        { id: 'scoreMargin', label: 'Difference', gameTypes: ['game8'] },
        { id: 'pointsRemaining', label: 'Points Remaining', gameTypes: ['game8'] },
        { id: 'highestBreak', label: 'Highest Break', gameTypes: ['game8'] },
        { id: 'highestRun', label: 'Longest Run', gameTypes: ['game4'] },
        { id: 'ballsPotted', label: 'Balls Potted', gameTypes: ['game1', 'game2', 'game3', 'game5', 'game6', 'game7', 'game8'] },
        { id: 'fouls', label: 'Fouls', gameTypes: ['game1', 'game2', 'game3', 'game4', 'game5', 'game6', 'game7', 'game8'] },
        { id: 'breakAndRun', label: 'Break & Run', gameTypes: ['game1', 'game2', 'game3'] },
        { id: 'tableRun', label: 'Table Run', gameTypes: ['game1', 'game2', 'game3'] }
    ];

    const STATS_VISIBILITY_STORAGE_KEY = 'statsVisibility';
    const STATS_VISIBILITY_GAME_TYPE_KEY = 'statsVisibilityGameType';

    function emitCloudSession(action, payload) {
        if (window.cloudRelay && typeof window.cloudRelay.sendSession === 'function') {
            window.cloudRelay.sendSession(action, payload || {});
        }
    }

    /** Match extras for cloud session:end (HB / HR / B&R / TR / balls / fouls). */
    function buildCloudMatchExtras(match) {
        const extras = {
            highestBreakP1: 0,
            highestBreakP2: 0,
            highestRunP1: 0,
            highestRunP2: 0,
            breakAndRunsP1: 0,
            breakAndRunsP2: 0,
            tableRunsP1: 0,
            tableRunsP2: 0,
            ballsP1: 0,
            ballsP2: 0,
            foulsP1: 0,
            foulsP2: 0
        };
        if (!match) {
            return extras;
        }
        const p1Id = match.player1Id;
        const p2Id = match.player2Id;
        const straight = isStraightPoolGameType(match.gameType);
        (match.racks || []).forEach(function (r) {
            if (straight) {
                extras.highestRunP1 = Math.max(
                    extras.highestRunP1,
                    clampScore(r.highestRunP1 != null ? r.highestRunP1 : r.highestBreakP1)
                );
                extras.highestRunP2 = Math.max(
                    extras.highestRunP2,
                    clampScore(r.highestRunP2 != null ? r.highestRunP2 : r.highestBreakP2)
                );
            } else {
                extras.highestBreakP1 = Math.max(extras.highestBreakP1, clampScore(r.highestBreakP1));
                extras.highestBreakP2 = Math.max(extras.highestBreakP2, clampScore(r.highestBreakP2));
            }
            if (r.breakAndRun) {
                if (r.winnerId === p1Id || r.winnerId === '1' || r.winnerId === 1) {
                    extras.breakAndRunsP1 += 1;
                } else if (r.winnerId === p2Id || r.winnerId === '2' || r.winnerId === 2) {
                    extras.breakAndRunsP2 += 1;
                }
            }
            if (r.tableRun) {
                if (r.winnerId === p1Id || r.winnerId === '1' || r.winnerId === 1) {
                    extras.tableRunsP1 += 1;
                } else if (r.winnerId === p2Id || r.winnerId === '2' || r.winnerId === 2) {
                    extras.tableRunsP2 += 1;
                }
            }
            extras.foulsP1 += clampScore(r.foulsP1);
            extras.foulsP2 += clampScore(r.foulsP2);
        });
        if (straight) {
            if (match.matchHighestRun) {
                extras.highestRunP1 = Math.max(extras.highestRunP1, clampScore(match.matchHighestRun[p1Id]));
                extras.highestRunP2 = Math.max(extras.highestRunP2, clampScore(match.matchHighestRun[p2Id]));
            }
            // Legacy straight sessions stored run length under matchHighestBreak.
            if (match.matchHighestBreak) {
                extras.highestRunP1 = Math.max(extras.highestRunP1, clampScore(match.matchHighestBreak[p1Id]));
                extras.highestRunP2 = Math.max(extras.highestRunP2, clampScore(match.matchHighestBreak[p2Id]));
            }
        } else if (match.matchHighestBreak) {
            extras.highestBreakP1 = Math.max(
                extras.highestBreakP1,
                clampScore(match.matchHighestBreak[p1Id])
            );
            extras.highestBreakP2 = Math.max(
                extras.highestBreakP2,
                clampScore(match.matchHighestBreak[p2Id])
            );
        }
        (match.balls || []).forEach(function (b) {
            if (b.winnerId === p1Id) {
                extras.ballsP1 += 1;
            } else if (b.winnerId === p2Id) {
                extras.ballsP2 += 1;
            }
        });
        return extras;
    }

    function buildCloudMatchEndPayload(match, base) {
        const payload = Object.assign({}, base || {}, buildCloudMatchExtras(match));
        if (match && match.id && !payload.matchId) {
            payload.matchId = match.id;
        }
        if (match && match.finalScore && !payload.scores) {
            payload.scores = {
                p1: clampScore(match.finalScore.p1),
                p2: clampScore(match.finalScore.p2)
            };
        }
        if (match && payload.winnerSlot == null) {
            if (match.winnerId && match.winnerId === match.player1Id) {
                payload.winnerSlot = '1';
            } else if (match.winnerId && match.winnerId === match.player2Id) {
                payload.winnerSlot = '2';
            }
        }
        if (match && payload.gameInfo == null) {
            payload.gameInfo = String(match.gameInfo || '').trim();
        }
        return payload;
    }

    /** True when cloud relay is enabled and connected — stats should come from backend. */
    function isCloudStatsMode() {
        return !!(window.cloudRelay &&
            typeof window.cloudRelay.isConnected === 'function' &&
            window.cloudRelay.isConnected() &&
            typeof window.cloudRelay.isEnabled === 'function' &&
            window.cloudRelay.isEnabled());
    }

    let cloudStatsCache = null;
    let cloudStatsCacheTs = 0;
    const CLOUD_STATS_CACHE_TTL = 30000;

    /**
     * Fetch account stats from CueSport Cloud.
     * Prefers the authenticated WebSocket (avoids CORS from file:// OBS docks),
     * then falls back to GET /api/stats.
     */
    async function fetchCloudStats() {
        const now = Date.now();
        if (cloudStatsCache && (now - cloudStatsCacheTs) < CLOUD_STATS_CACHE_TTL) {
            return cloudStatsCache;
        }
        if (!window.cloudRelay) return { players: [], matches: [] };

        var wsErrMsg = '';
        if (typeof window.cloudRelay.requestStats === 'function' && isCloudStatsMode()) {
            try {
                const payload = await window.cloudRelay.requestStats(5000);
                const result = {
                    players: Array.isArray(payload.players) ? payload.players : [],
                    matches: Array.isArray(payload.matches) ? payload.matches : [],
                    summary: payload.summary || null,
                    tables: Array.isArray(payload.tables) ? payload.tables : [],
                };
                cloudStatsCache = result;
                cloudStatsCacheTs = Date.now();
                return result;
            } catch (wsErr) {
                wsErrMsg = wsErr && wsErr.message ? String(wsErr.message) : 'WebSocket stats failed';
                console.warn('fetchCloudStats via WebSocket failed, trying HTTP:', wsErr);
            }
        }

        const serverUrl = (window.cloudRelay.getServerUrl() || '').replace(/\/$/, '');
        if (!serverUrl) {
            return { players: [], matches: [], error: 'Cloud server URL is not set' };
        }

        var token = '';
        var apiKey = '';
        if (typeof window.cloudRelay.getAccessToken === 'function') {
            token = window.cloudRelay.getAccessToken() || '';
        }
        if (typeof window.cloudRelay.getApiKey === 'function') {
            apiKey = window.cloudRelay.getApiKey() || '';
        }
        if (!token && !apiKey) {
            const prefix = 'cloudRelay_';
            const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
            function getCloudStorage(k) {
                const key = instanceId ? (instanceId + '_' + prefix + k) : (prefix + k);
                return localStorage.getItem(key) || '';
            }
            token = getCloudStorage('accessToken');
            apiKey = getCloudStorage('apiKey');
        }
        if (!token && !apiKey) {
            return { players: [], matches: [], error: 'Not signed in to CueSport Cloud' };
        }
        const headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        else headers['X-Api-Key'] = apiKey;

        try {
            const res = await fetch(serverUrl + '/api/stats?limit=5000', { headers: headers });
            if (!res.ok) {
                var errBody = {};
                try { errBody = await res.json(); } catch (_) { /* ignore */ }
                throw new Error(errBody.error || ('HTTP ' + res.status));
            }
            const payload = await res.json();
            const result = {
                players: Array.isArray(payload.players) ? payload.players : [],
                matches: Array.isArray(payload.matches) ? payload.matches : [],
                summary: payload.summary || null,
                tables: Array.isArray(payload.tables) ? payload.tables : [],
            };
            cloudStatsCache = result;
            cloudStatsCacheTs = Date.now();
            return result;
        } catch (err) {
            console.error('fetchCloudStats failed:', err);
            var msg = err && err.message ? String(err.message) : 'Failed to fetch';
            if (msg === 'Failed to fetch') {
                if (/unknown_type|timed out|timeout/i.test(wsErrMsg)) {
                    msg = 'Cloud server at ' + serverUrl +
                        ' is missing the stats API (rebuild/redeploy CueSport Cloud, then reload the dock)';
                } else {
                    msg = 'Could not reach ' + serverUrl +
                        ' (check Connection settings Server URL, and that the cloud server is running)';
                }
            } else if (wsErrMsg && /unknown_type/i.test(wsErrMsg)) {
                msg = 'Cloud server needs an update for dock stats (rebuild/redeploy), then reload the dock';
            }
            return { players: [], matches: [], error: msg };
        }
    }

    /**
     * Convert raw backend match_events into player summaries and match list.
     * Events of type session:start / session:end carry match lifecycle data.
     */
    function normalizeCloudEvents(events) {
        const sessionMap = {};
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var sid = ev.session_id;
            if (!sid) continue;
            if (!sessionMap[sid]) sessionMap[sid] = { events: [] };
            sessionMap[sid].events.push(ev);
        }

        var matches = [];
        var playerMap = {};

        function getOrCreatePlayer(name) {
            var key = (name || '').trim().toLowerCase();
            if (!key) return null;
            if (!playerMap[key]) {
                playerMap[key] = {
                    id: key,
                    name: (name || '').trim(),
                    gamesWon: 0,
                    gamesLost: 0,
                    racksWon: 0,
                    racksLost: 0,
                    lastPlayedAt: null
                };
            }
            return playerMap[key];
        }

        var sessionIds = Object.keys(sessionMap);
        for (var s = 0; s < sessionIds.length; s++) {
            var sess = sessionMap[sessionIds[s]];
            var startEv = null;
            var endEv = null;
            for (var e = 0; e < sess.events.length; e++) {
                if (sess.events[e].event_type === 'session:start') startEv = sess.events[e];
                if (sess.events[e].event_type === 'session:end') endEv = sess.events[e];
            }
            if (!startEv) continue;

            var sp = startEv.payload || {};
            var ep = endEv ? (endEv.payload || {}) : {};
            var p1Name = sp.player1 || '';
            var p2Name = sp.player2 || '';
            if (!p1Name || !p2Name) continue;

            var p1 = getOrCreatePlayer(p1Name);
            var p2 = getOrCreatePlayer(p2Name);
            if (!p1 || !p2) continue;

            var matchDate = endEv ? endEv.created_at : startEv.created_at;
            var match = {
                id: sessionIds[s],
                player1Name: p1Name,
                player2Name: p2Name,
                gameType: sp.gameType || 'game1',
                completedAt: endEv ? matchDate : null,
                startedAt: startEv.created_at,
                status: endEv ? 'completed' : 'active',
                winnerSlot: null,
                scores: ep.scores || null
            };

            if (endEv && ep.winnerSlot) {
                match.winnerSlot = String(ep.winnerSlot);
                var winner = match.winnerSlot === '1' ? p1 : p2;
                var loser = match.winnerSlot === '1' ? p2 : p1;
                winner.gamesWon++;
                loser.gamesLost++;
                if (ep.scores) {
                    winner.racksWon += Number(ep.scores.p1 && match.winnerSlot === '1' ? ep.scores.p1 : ep.scores.p2) || 0;
                    winner.racksLost += Number(match.winnerSlot === '1' ? ep.scores.p2 : ep.scores.p1) || 0;
                    loser.racksWon += Number(match.winnerSlot === '1' ? ep.scores.p2 : ep.scores.p1) || 0;
                    loser.racksLost += Number(match.winnerSlot === '1' ? ep.scores.p1 : ep.scores.p2) || 0;
                }
            }

            if (matchDate) {
                if (!p1.lastPlayedAt || matchDate > p1.lastPlayedAt) p1.lastPlayedAt = matchDate;
                if (!p2.lastPlayedAt || matchDate > p2.lastPlayedAt) p2.lastPlayedAt = matchDate;
            }
            matches.push(match);
        }

        matches.sort(function (a, b) {
            var da = a.completedAt || a.startedAt || '';
            var db2 = b.completedAt || b.startedAt || '';
            return db2.localeCompare(da);
        });

        var players = [];
        var keys = Object.keys(playerMap);
        for (var k = 0; k < keys.length; k++) {
            players.push(playerMap[keys[k]]);
        }
        players.sort(function (a, b) {
            return b.gamesWon - a.gamesWon || b.racksWon - a.racksWon;
        });

        return { players: players, matches: matches };
    }

    /** Invalidate cloud stats cache so next render fetches fresh data. */
    function invalidateCloudStatsCache() {
        cloudStatsCache = null;
        cloudStatsCacheTs = 0;
    }

    function getCloudAuthContext() {
        if (!window.cloudRelay) {
            return { error: 'Cloud relay unavailable' };
        }
        const serverUrl = (window.cloudRelay.getServerUrl() || '').replace(/\/$/, '');
        if (!serverUrl) {
            return { error: 'Cloud server URL is not set' };
        }
        var token = '';
        var apiKey = '';
        if (typeof window.cloudRelay.getAccessToken === 'function') {
            token = window.cloudRelay.getAccessToken() || '';
        }
        if (typeof window.cloudRelay.getApiKey === 'function') {
            apiKey = window.cloudRelay.getApiKey() || '';
        }
        if (!token && !apiKey) {
            const prefix = 'cloudRelay_';
            const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
            function getCloudStorage(k) {
                const key = instanceId ? (instanceId + '_' + prefix + k) : (prefix + k);
                return localStorage.getItem(key) || '';
            }
            token = getCloudStorage('accessToken');
            apiKey = getCloudStorage('apiKey');
        }
        if (!token && !apiKey) {
            return { error: 'Not signed in to CueSport Cloud' };
        }
        const headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        else headers['X-Api-Key'] = apiKey;
        return { serverUrl: serverUrl, headers: headers };
    }

    async function cloudApiFetch(path, options) {
        const auth = getCloudAuthContext();
        if (auth.error) {
            throw new Error(auth.error);
        }
        const opts = options || {};
        const headers = Object.assign({}, auth.headers, opts.headers || {});
        if (opts.body != null && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
        const res = await fetch(auth.serverUrl + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body != null ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
        });
        var errBody = {};
        try { errBody = await res.json(); } catch (_) { errBody = {}; }
        if (!res.ok) {
            throw new Error(errBody.error || errBody.message || ('HTTP ' + res.status));
        }
        return errBody;
    }

    function cloudPlayerKey(name) {
        return String(name || '').trim().toLowerCase();
    }

    function adaptCloudMatchForUi(m) {
        if (!m) return null;
        const p1Name = m.player1Name || '';
        const p2Name = m.player2Name || '';
        return {
            id: m.startEventId || m.id,
            startEventId: m.startEventId || m.id,
            player1Id: cloudPlayerKey(p1Name),
            player2Id: cloudPlayerKey(p2Name),
            player1Name: p1Name,
            player2Name: p2Name,
            gameType: m.gameType || 'game1',
            gameInfo: m.gameInfo || '',
            status: m.status || 'completed',
            completedAt: m.completedAt,
            startedAt: m.startedAt,
            finalScore: m.scores || { p1: 0, p2: 0 },
            racks: [],
            highestBreakP1: Number(m.highestBreakP1) || 0,
            highestBreakP2: Number(m.highestBreakP2) || 0,
            highestRunP1: Number(m.highestRunP1) || 0,
            highestRunP2: Number(m.highestRunP2) || 0,
            breakAndRunsP1: Number(m.breakAndRunsP1) || 0,
            breakAndRunsP2: Number(m.breakAndRunsP2) || 0,
            tableRunsP1: Number(m.tableRunsP1) || 0,
            tableRunsP2: Number(m.tableRunsP2) || 0,
            ballsP1: Number(m.ballsP1) || 0,
            ballsP2: Number(m.ballsP2) || 0,
            foulsP1: Number(m.foulsP1) || 0,
            foulsP2: Number(m.foulsP2) || 0,
            winnerSlot: m.winnerSlot || null,
            winnerId: m.winnerSlot === '1'
                ? cloudPlayerKey(p1Name)
                : (m.winnerSlot === '2' ? cloudPlayerKey(p2Name) : null),
            _cloud: true
        };
    }

    function cloudMatchesForPlayer(matches, playerKey) {
        const key = cloudPlayerKey(playerKey);
        return (matches || []).filter(function (m) {
            return cloudPlayerKey(m.player1Name) === key || cloudPlayerKey(m.player2Name) === key;
        }).map(adaptCloudMatchForUi);
    }

    function buildCloudPlayerDetailShape(cloudPlayer, matches) {
        const key = cloudPlayerKey(cloudPlayer.id || cloudPlayer.name);
        const byGameType = {};
        Object.keys(GAME_TYPE_LABELS).forEach(function (gt) {
            byGameType[gt] = createEmptyTypeStats();
        });
        (matches || []).forEach(function (raw) {
            if (!raw || raw.status !== 'completed') return;
            const m = adaptCloudMatchForUi(raw);
            const gt = m.gameType || 'game1';
            const typed = ensureTypeStats({ byGameType: byGameType }, gt);
            const isP1 = m.player1Id === key;
            if (m.winnerSlot === '1' || m.winnerSlot === '2') {
                const won = (m.winnerSlot === '1' && isP1) || (m.winnerSlot === '2' && !isP1);
                if (won) typed.gamesWon += 1;
                else typed.gamesLost += 1;
                const own = isP1 ? (m.finalScore.p1 || 0) : (m.finalScore.p2 || 0);
                const opp = isP1 ? (m.finalScore.p2 || 0) : (m.finalScore.p1 || 0);
                typed.racksWon += own;
                typed.racksLost += opp;
            }
            if (isP1) {
                typed.highestBreak = Math.max(typed.highestBreak || 0, m.highestBreakP1);
                typed.highestRun = Math.max(typed.highestRun || 0, m.highestRunP1);
                typed.ballsWon = (typed.ballsWon || 0) + m.ballsP1;
                typed.fouls = (typed.fouls || 0) + m.foulsP1;
            } else {
                typed.highestBreak = Math.max(typed.highestBreak || 0, m.highestBreakP2);
                typed.highestRun = Math.max(typed.highestRun || 0, m.highestRunP2);
                typed.ballsWon = (typed.ballsWon || 0) + m.ballsP2;
                typed.fouls = (typed.fouls || 0) + m.foulsP2;
            }
        });
        return {
            id: key,
            name: cloudPlayer.name,
            lastPlayedAt: cloudPlayer.lastPlayedAt,
            stats: {
                gamesWon: cloudPlayer.gamesWon || 0,
                gamesLost: cloudPlayer.gamesLost || 0,
                racksWon: cloudPlayer.racksWon || 0,
                racksLost: cloudPlayer.racksLost || 0,
                highestBreak: cloudPlayer.highestBreak || 0,
                highestRun: cloudPlayer.highestRun || 0,
                ballsWon: cloudPlayer.ballsPotted || 0,
                fouls: cloudPlayer.fouls || 0,
                byGameType: byGameType
            }
        };
    }

    function buildCloudHeadToHead(playerId1, playerId2, cloudData) {
        const id1 = cloudPlayerKey(playerId1);
        const id2 = cloudPlayerKey(playerId2);
        if (!id1 || !id2 || id1 === id2) return null;
        const players = cloudData.players || [];
        const p1 = players.find(function (p) { return cloudPlayerKey(p.id || p.name) === id1; });
        const p2 = players.find(function (p) { return cloudPlayerKey(p.id || p.name) === id2; });
        if (!p1 || !p2) return null;
        const summary = {
            player1: { id: id1, name: p1.name },
            player2: { id: id2, name: p2.name },
            gamesWon: { [id1]: 0, [id2]: 0 },
            racksWon: { [id1]: 0, [id2]: 0 },
            ballsWon: { [id1]: 0, [id2]: 0 },
            highestBreak: { [id1]: 0, [id2]: 0 },
            highestRun: { [id1]: 0, [id2]: 0 },
            fouls: { [id1]: 0, [id2]: 0 },
            matches: [],
            lastPlayedAt: null,
            gameType: null
        };
        (cloudData.matches || []).forEach(function (raw) {
            if (!raw || raw.status !== 'completed') return;
            const a = cloudPlayerKey(raw.player1Name);
            const b = cloudPlayerKey(raw.player2Name);
            if (!((a === id1 && b === id2) || (a === id2 && b === id1))) return;
            const m = adaptCloudMatchForUi(raw);
            summary.matches.push(m);
            if (m.winnerSlot === '1') {
                summary.gamesWon[m.player1Id] = (summary.gamesWon[m.player1Id] || 0) + 1;
            } else if (m.winnerSlot === '2') {
                summary.gamesWon[m.player2Id] = (summary.gamesWon[m.player2Id] || 0) + 1;
            }
            summary.racksWon[m.player1Id] = (summary.racksWon[m.player1Id] || 0) + (m.finalScore.p1 || 0);
            summary.racksWon[m.player2Id] = (summary.racksWon[m.player2Id] || 0) + (m.finalScore.p2 || 0);
            summary.ballsWon[m.player1Id] = (summary.ballsWon[m.player1Id] || 0) + m.ballsP1;
            summary.ballsWon[m.player2Id] = (summary.ballsWon[m.player2Id] || 0) + m.ballsP2;
            summary.fouls[m.player1Id] = (summary.fouls[m.player1Id] || 0) + m.foulsP1;
            summary.fouls[m.player2Id] = (summary.fouls[m.player2Id] || 0) + m.foulsP2;
            summary.highestBreak[m.player1Id] = Math.max(summary.highestBreak[m.player1Id] || 0, m.highestBreakP1);
            summary.highestBreak[m.player2Id] = Math.max(summary.highestBreak[m.player2Id] || 0, m.highestBreakP2);
            summary.highestRun[m.player1Id] = Math.max(summary.highestRun[m.player1Id] || 0, m.highestRunP1);
            summary.highestRun[m.player2Id] = Math.max(summary.highestRun[m.player2Id] || 0, m.highestRunP2);
            const played = m.completedAt || m.startedAt;
            if (played && (!summary.lastPlayedAt || played > summary.lastPlayedAt)) {
                summary.lastPlayedAt = played;
            }
        });
        summary.matches.sort(function (a, b) {
            return String(b.completedAt || b.startedAt || '').localeCompare(String(a.completedAt || a.startedAt || ''));
        });
        return summary;
    }

    async function findCloudMatchById(matchId) {
        const data = await fetchCloudStats();
        const raw = (data.matches || []).find(function (m) {
            return String(m.startEventId || m.id) === String(matchId);
        });
        return adaptCloudMatchForUi(raw);
    }

    function setMatchEditMode(isCloud) {
        const modal = document.getElementById('statsMatchEditModal');
        if (modal) {
            modal.dataset.cloud = isCloud ? '1' : '';
        }
        const localBlock = document.getElementById('statsMatchLocalRacksBlock');
        const cloudScores = document.getElementById('statsMatchCloudScoresRow');
        if (localBlock) localBlock.classList.toggle('noShow', !!isCloud);
        if (cloudScores) cloudScores.classList.toggle('noShow', !isCloud);
        syncMatchExtrasVisibilityForEdit();
    }

    function syncMatchExtrasVisibilityForEdit() {
        const modal = document.getElementById('statsMatchEditModal');
        const isCloud = !!(modal && modal.dataset.cloud === '1');
        const select = document.getElementById('statsMatchGameType');
        const gt = (select && select.value) || 'game1';
        const showFouls = isCloud;
        const showHb = isCloud && gt === 'game8';
        const showHr = isCloud && gt === 'game4';
        const showRuns = isCloud && (gt === 'game1' || gt === 'game2' || gt === 'game3');
        const hbEl = document.getElementById('statsMatchExtrasHb');
        const hrEl = document.getElementById('statsMatchExtrasHr');
        const runsEl = document.getElementById('statsMatchExtrasRuns');
        const foulsEl = document.getElementById('statsMatchExtrasFouls');
        if (hbEl) hbEl.classList.toggle('noShow', !showHb);
        if (hrEl) hrEl.classList.toggle('noShow', !showHr);
        if (runsEl) runsEl.classList.toggle('noShow', !showRuns);
        if (foulsEl) foulsEl.classList.toggle('noShow', !showFouls);
        updateMatchBallFieldsVisibility();
    }

    function readNumInput(id) {
        const n = parseInt((document.getElementById(id) || {}).value, 10);
        return Number.isFinite(n) && n >= 0 ? Math.min(n, 999) : 0;
    }

    function populateCloudMatchEditForm(match) {
        const modal = document.getElementById('statsMatchEditModal');
        const title = document.getElementById('statsMatchEditTitle');
        const deleteBtn = document.getElementById('statsMatchDeleteBtn');
        if (!modal || !match) return;
        setMatchEditMode(true);
        modal.dataset.matchId = match.startEventId || match.id || '';
        modal.dataset.player1Id = match.player1Id || '';
        modal.dataset.player2Id = match.player2Id || '';
        modal.dataset.player1Name = match.player1Name || '';
        modal.dataset.player2Name = match.player2Name || '';
        modal.dataset.inProgress = '';
        matchEditPlayerNames = {
            p1: match.player1Name || 'Player 1',
            p2: match.player2Name || 'Player 2'
        };
        if (title) title.textContent = 'Edit Cloud Match';
        if (deleteBtn) {
            deleteBtn.classList.remove('noShow');
            deleteBtn.textContent = 'Delete Match';
        }
        setMatchEditGameTypeLocked(false);
        document.getElementById('statsMatchDate').value = dateInputFromIso(match.completedAt || match.startedAt);
        document.getElementById('statsMatchGameType').value = match.gameType || 'game1';
        const gameInfoInput = document.getElementById('statsMatchGameInfo');
        if (gameInfoInput) gameInfoInput.value = match.gameInfo || '';
        document.getElementById('statsMatchScoreP1').value = (match.finalScore && match.finalScore.p1) || 0;
        document.getElementById('statsMatchScoreP2').value = (match.finalScore && match.finalScore.p2) || 0;
        document.getElementById('statsMatchHbP1').value = match.highestBreakP1 || 0;
        document.getElementById('statsMatchHbP2').value = match.highestBreakP2 || 0;
        document.getElementById('statsMatchHrP1').value = match.highestRunP1 || 0;
        document.getElementById('statsMatchHrP2').value = match.highestRunP2 || 0;
        document.getElementById('statsMatchBrP1').value = match.breakAndRunsP1 || 0;
        document.getElementById('statsMatchBrP2').value = match.breakAndRunsP2 || 0;
        document.getElementById('statsMatchTrP1').value = match.tableRunsP1 || 0;
        document.getElementById('statsMatchTrP2').value = match.tableRunsP2 || 0;
        document.getElementById('statsMatchBallsP1').value = match.ballsP1 || 0;
        document.getElementById('statsMatchBallsP2').value = match.ballsP2 || 0;
        document.getElementById('statsMatchFoulsP1').value = match.foulsP1 || 0;
        document.getElementById('statsMatchFoulsP2').value = match.foulsP2 || 0;
        const scoreP1Label = document.getElementById('statsMatchScoreP1Label');
        const scoreP2Label = document.getElementById('statsMatchScoreP2Label');
        if (scoreP1Label) scoreP1Label.textContent = 'Score (' + matchEditPlayerNames.p1 + '):';
        if (scoreP2Label) scoreP2Label.textContent = 'Score (' + matchEditPlayerNames.p2 + '):';
        syncMatchExtrasVisibilityForEdit();
        modal.style.display = 'block';
    }

    async function saveCloudMatchFromModal() {
        const modal = document.getElementById('statsMatchEditModal');
        if (!modal) return;
        const startEventId = modal.dataset.matchId;
        if (!startEventId) {
            alert('Missing cloud match id.');
            return;
        }
        const scoreP1 = readNumInput('statsMatchScoreP1');
        const scoreP2 = readNumInput('statsMatchScoreP2');
        if (scoreP1 === scoreP2) {
            alert('Frame/rack wins must differ — only completed matches are recorded.');
            return;
        }
        const dateVal = document.getElementById('statsMatchDate').value;
        try {
            await cloudApiFetch('/api/stats/matches/' + encodeURIComponent(startEventId), {
                method: 'PATCH',
                body: {
                    player1Name: modal.dataset.player1Name || matchEditPlayerNames.p1,
                    player2Name: modal.dataset.player2Name || matchEditPlayerNames.p2,
                    gameType: document.getElementById('statsMatchGameType').value,
                    gameInfo: (document.getElementById('statsMatchGameInfo') || {}).value || '',
                    scores: { p1: scoreP1, p2: scoreP2 },
                    completedAt: dateVal ? (dateVal + 'T12:00:00.000Z') : undefined,
                    highestBreakP1: readNumInput('statsMatchHbP1'),
                    highestBreakP2: readNumInput('statsMatchHbP2'),
                    highestRunP1: readNumInput('statsMatchHrP1'),
                    highestRunP2: readNumInput('statsMatchHrP2'),
                    breakAndRunsP1: readNumInput('statsMatchBrP1'),
                    breakAndRunsP2: readNumInput('statsMatchBrP2'),
                    tableRunsP1: readNumInput('statsMatchTrP1'),
                    tableRunsP2: readNumInput('statsMatchTrP2'),
                    ballsP1: readNumInput('statsMatchBallsP1'),
                    ballsP2: readNumInput('statsMatchBallsP2'),
                    foulsP1: readNumInput('statsMatchFoulsP1'),
                    foulsP2: readNumInput('statsMatchFoulsP2')
                }
            });
            closeMatchEditModal();
            invalidateCloudStatsCache();
            await refreshStatsUI();
        } catch (err) {
            alert('Save failed: ' + err.message);
        }
    }

    async function deleteCloudMatchFromModal() {
        const modal = document.getElementById('statsMatchEditModal');
        const startEventId = modal && modal.dataset.matchId;
        if (!startEventId) return;
        if (!confirm('Delete this match from cloud stats? This cannot be undone.')) return;
        try {
            await cloudApiFetch('/api/stats/matches/' + encodeURIComponent(startEventId), {
                method: 'DELETE'
            });
            closeMatchEditModal();
            invalidateCloudStatsCache();
            await refreshStatsUI();
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    }

    function readStatsVisibilityConfig() {
        if (typeof getStorageItem === 'function') {
            try {
                const raw = getStorageItem(STATS_VISIBILITY_STORAGE_KEY);
                return raw ? JSON.parse(raw) : {};
            } catch (err) {
                console.warn('Failed to parse stats visibility config:', err);
            }
        }
        return {};
    }

    function writeStatsVisibilityConfig(config) {
        if (typeof setStorageItem === 'function') {
            setStorageItem(STATS_VISIBILITY_STORAGE_KEY, JSON.stringify(config || {}));
        }
    }

    function readStatsVisibilityGameType() {
        if (typeof getStorageItem === 'function') {
            const stored = getStorageItem(STATS_VISIBILITY_GAME_TYPE_KEY);
            if (stored && GAME_TYPE_LABELS[stored]) {
                return stored;
            }
        }
        const active = getActiveGameType();
        writeStatsVisibilityGameType(active);
        return active;
    }

    function writeStatsVisibilityGameType(gameType) {
        if (!GAME_TYPE_LABELS[gameType] || typeof setStorageItem !== 'function') {
            return;
        }
        setStorageItem(STATS_VISIBILITY_GAME_TYPE_KEY, gameType);
    }

    function syncStatsVisibilityGameTypeSelect() {
        const select = document.getElementById('statsVisibilityGameType');
        if (!select) {
            return;
        }
        if (!select.options.length) {
            Object.keys(GAME_TYPE_LABELS).forEach(function (gt) {
                const opt = document.createElement('option');
                opt.value = gt;
                opt.textContent = GAME_TYPE_LABELS[gt];
                select.appendChild(opt);
            });
        }
        const gt = readStatsVisibilityGameType();
        if (select.value !== gt) {
            select.value = gt;
        }
    }

    function onStatsVisibilityGameTypeChange(gameType) {
        if (!GAME_TYPE_LABELS[gameType]) {
            return;
        }
        writeStatsVisibilityGameType(gameType);
        renderStatsVisibilityPanel();
    }

    function isStatApplicable(statId, gameType) {
        const entry = STAT_VISIBILITY_CATALOG.find(function (s) {
            return s.id === statId;
        });
        if (!entry || entry.gameTypes.indexOf(gameType) === -1) {
            return false;
        }
        if (statId === 'ballsPotted' && gameType === 'game7') {
            return typeof isDualScoreMode === 'function' && isDualScoreMode();
        }
        return true;
    }

    function isStatVisible(gameType, statId) {
        if (!isStatApplicable(statId, gameType)) {
            return false;
        }
        const config = readStatsVisibilityConfig();
        const gt = config[gameType];
        if (gt && gt[statId] === false) {
            return false;
        }
        return true;
    }

    function setStatVisibility(gameType, statId, enabled) {
        const config = readStatsVisibilityConfig();
        if (!config[gameType]) {
            config[gameType] = {};
        }
        config[gameType][statId] = !!enabled;
        writeStatsVisibilityConfig(config);
    }

    function renderStatsVisibilityPanel() {
        const panel = document.getElementById('statsVisibilityPanel');
        if (!panel) {
            return;
        }
        syncStatsVisibilityGameTypeSelect();
        const gt = readStatsVisibilityGameType();
        const stats = STAT_VISIBILITY_CATALOG.filter(function (s) {
            return s.gameTypes.indexOf(gt) !== -1 && isStatApplicable(s.id, gt);
        });
        let html = '';
        if (!stats.length) {
            panel.innerHTML = '<p class="stats-tab-help">No overlay stats apply to this game type.</p>';
            return;
        }
        html += '<div class="stats-visibility-stat-list">';
        stats.forEach(function (stat) {
            const inputId = 'statVis_' + gt + '_' + stat.id;
            const checked = isStatVisible(gt, stat.id) ? ' checked' : '';
            html += '<label class="stats-visibility-item" for="' + inputId + '">';
            html += '<span class="stats-visibility-label">' + stat.label + '</span>';
            html += '<input type="checkbox" class="smallSize stats-visibility-toggle" id="' + inputId + '" data-game-type="' + gt + '" data-stat-id="' + stat.id + '"' + checked + ' onchange="onStatVisibilityToggle(this)">';
            html += '</label>';
        });
        html += '</div>';
        panel.innerHTML = html;
    }

    function onStatVisibilityToggle(input) {
        if (!input || !input.dataset) {
            return;
        }
        setStatVisibility(input.dataset.gameType, input.dataset.statId, input.checked);
        broadcastOverlayStatsIfEnabled();
    }

    function overlayStatEnabled(gameType, statId) {
        if (!isStatVisible(gameType, statId)) {
            return false;
        }
        if (statId === 'ballsPotted') {
            return showsBallStats(gameType);
        }
        if (statId === 'highestBreak' || (statId === 'currentBreak' && isSnookerGameType(gameType))) {
            return showsHighestBreakStats(gameType);
        }
        if (statId === 'highestRun' || (statId === 'currentBreak' && isStraightPoolGameType(gameType))) {
            return showsHighestRunStats(gameType);
        }
        if (statId === 'currentBreak') {
            return showsHighestBreakStats(gameType) || showsHighestRunStats(gameType);
        }
        if (statId === 'possibleBreak' || statId === 'scoreMargin' || statId === 'pointsRemaining') {
            return isSnookerGameType(gameType);
        }
        if (statId === 'fouls') {
            return showsFoulStats(gameType);
        }
        return true;
    }

    function gameTypeHasBallScoring(gameType) {
        return gameType === 'game1' || gameType === 'game2' || gameType === 'game3' ||
            gameType === 'game5' || gameType === 'game6' || gameType === 'game7' || gameType === 'game8';
    }

    function isSnookerGameType(gameType) {
        if (gameType != null && gameType !== '') {
            return gameType === 'game8';
        }
        return typeof isSnooker === 'function' && isSnooker();
    }

    function isStraightPoolGameType(gameType) {
        if (gameType != null && gameType !== '') {
            return gameType === 'game4';
        }
        return typeof isStraightPool === 'function' && isStraightPool();
    }

    function getActiveGameType() {
        if (typeof getStorageItem === 'function') {
            return getStorageItem('gameType') || 'game1';
        }
        return 'game1';
    }

    function usesFrameTerminology(gameType) {
        const gt = gameType || getActiveGameType();
        return isSnookerGameType(gt);
    }

    function rackOrFrameLabel(plural, gameType) {
        if (usesFrameTerminology(gameType)) {
            return plural ? 'Frames' : 'Frame';
        }
        return plural ? 'Racks' : 'Rack';
    }

    function showsBallStats(gameType) {
        const gt = gameType || getActiveGameType();
        if (isSnookerGameType(gt)) {
            return true;
        }
        if (gt === 'game1' || gt === 'game2' || gt === 'game3') {
            return true;
        }
        if (gt === 'game5' || gt === 'game6') {
            return true;
        }
        if (gt === 'game7') {
            return typeof isDualScoreMode === 'function' && isDualScoreMode();
        }
        return false;
    }

    function showsHighestBreakStats(gameType) {
        return isSnookerGameType(gameType || getActiveGameType());
    }

    function showsFoulStats(gameType) {
        return true;
    }

    function showsHighestRunStats(gameType) {
        return isStraightPoolGameType(gameType || getActiveGameType());
    }

    function highestBreakLabel(gameType) {
        return 'Highest Break';
    }

    function highestRunLabel(gameType) {
        return 'Longest Run';
    }

    function currentBreakLabel(gameType) {
        const gt = gameType || getActiveGameType();
        if (isStraightPoolGameType(gt)) {
            return 'Current Run';
        }
        return 'Current Break';
    }

    /** Live visit break/run for the given scoreboard slot (0 if not their turn). */
    function readLiveCurrentBreakForSlot(slot) {
        const gameType = getActiveGameType();
        const slotStr = String(slot);
        if (isSnookerGameType(gameType)) {
            if (typeof getStorageItem !== 'function') {
                return 0;
            }
            const active = String(getStorageItem('activePlayer') || '1');
            if (active !== slotStr) {
                return 0;
            }
            return parseInt(getStorageItem('snookerCurrentBreak') || '0', 10) || 0;
        }
        if (isStraightPoolGameType(gameType)) {
            if (activeMatchSession.straightPoolRunSlot === slotStr) {
                return activeMatchSession.straightPoolRunLength || 0;
            }
            return 0;
        }
        return 0;
    }

    /** Max snooker break still possible this visit (current + remaining table). */
    function readLivePossibleBreakForSlot(slot) {
        if (!isSnookerGameType(getActiveGameType())) {
            return 0;
        }
        if (typeof getSnookerPossibleBreak === 'function') {
            return getSnookerPossibleBreak(slot) || 0;
        }
        return 0;
    }

    /** Frame score margin vs opponent (+ahead / -behind); critical when behind by more than table remaining. */
    function readLiveScoreMarginForSlot(slot) {
        if (!isSnookerGameType(getActiveGameType())) {
            return { diff: 0, remaining: 0, display: '0', critical: false };
        }
        if (typeof getSnookerScoreMargin === 'function') {
            return getSnookerScoreMargin(slot);
        }
        return { diff: 0, remaining: 0, display: '0', critical: false, safe: false, pointsRemainingTone: '', showMargin: false };
    }

    function readTypeStats(player, gameType) {
        const empty = createEmptyTypeStats();
        if (!player || !player.stats) {
            return empty;
        }
        const typed = player.stats.byGameType && player.stats.byGameType[gameType];
        if (!typed) {
            return empty;
        }
        return {
            racksWon: typed.racksWon || 0,
            racksLost: typed.racksLost || 0,
            gamesWon: typed.gamesWon || 0,
            gamesLost: typed.gamesLost || 0,
            ballsWon: typed.ballsWon || 0,
            ballsLost: typed.ballsLost || 0,
            highestBreak: typed.highestBreak || 0,
            breakAndRuns: typed.breakAndRuns || 0,
            tableRuns: typed.tableRuns || 0,
            fouls: typed.fouls || 0
        };
    }

    function typeStatsHaveActivity(stats) {
        if (!stats) {
            return false;
        }
        return (
            (stats.gamesWon || 0) +
            (stats.gamesLost || 0) +
            (stats.racksWon || 0) +
            (stats.racksLost || 0) +
            (stats.ballsWon || 0) +
            (stats.highestBreak || 0) +
            (stats.highestRun || 0) +
            (stats.fouls || 0)
        ) > 0;
    }

    let db = null;
    let initPromise = null;
    let playerStatsReady = false;

    const activeMatchSession = {
        matchId: null,
        pendingMatch: null,
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
        duplicateNames: false,
        straightPoolRunSlot: null,
        straightPoolRunLength: 0
    };

    function getActivePendingMatch() {
        return activeMatchSession.pendingMatch || null;
    }

    async function abandonActivePendingMatch() {
        const match = getActivePendingMatch();
        if (!match || activeMatchSession.matchCompletedRecorded) {
            return;
        }
        if ((match.racks && match.racks.length > 0) || (match.balls && match.balls.length > 0)) {
            await undoAllRacksInMatch(match);
        }
    }

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
            ballsLost: 0,
            highestBreak: 0,
            highestRun: 0,
            breakAndRuns: 0,
            tableRuns: 0,
            fouls: 0
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
            highestBreak: 0,
            highestRun: 0,
            breakAndRuns: 0,
            tableRuns: 0,
            fouls: 0,
            byGameType: {}
        };
    }

    function ensureTypeStats(stats, gameType) {
        if (!stats.byGameType[gameType]) {
            stats.byGameType[gameType] = createEmptyTypeStats();
        }
        const typed = stats.byGameType[gameType];
        if (typed.highestRun == null) typed.highestRun = 0;
        if (typed.highestBreak == null) typed.highestBreak = 0;
        if (typed.fouls == null) typed.fouls = 0;
        if (typed.breakAndRuns == null) typed.breakAndRuns = 0;
        if (typed.tableRuns == null) typed.tableRuns = 0;
        return typed;
    }

    function getWinPct(won, lost) {
        const played = (won || 0) + (lost || 0);
        if (played === 0) {
            return 0;
        }
        return Math.round(((won || 0) / played) * 100);
    }

    function getWinRate(stats) {
        if (!stats) {
            return 0;
        }
        return getWinPct(stats.gamesWon, stats.gamesLost);
    }

    function getRackWinRate(stats) {
        if (!stats) {
            return 0;
        }
        return getWinPct(stats.racksWon, stats.racksLost);
    }

    function formatWL(won, lost) {
        return (won || 0) + '/' + (lost || 0);
    }

    /** Pairwise scoreline for H2H, e.g. 3:3 */
    function formatMatchupScore(left, right) {
        return (left || 0) + ':' + (right || 0);
    }

    /** Informative W/L with win percentage, e.g. 3/1 (75%). */
    function formatWLWithPct(won, lost) {
        return formatWL(won, lost) + ' (' + getWinPct(won, lost) + '%)';
    }

    function formatPlayerPreview(stats) {
        const safe = stats || createEmptyStats();
        const g = formatWL(safe.gamesWon, safe.gamesLost) + 'G';
        const rSuffix = usesFrameTerminology() ? 'F' : 'R';
        const r = (safe.racksWon || 0) + rSuffix;
        const hb = safe.highestBreak ? (' \u00b7 HB ' + safe.highestBreak) : '';
        const hr = safe.highestRun ? (' \u00b7 HR ' + safe.highestRun) : '';
        return g + ' \u00b7 ' + r + hb + hr;
    }

    function ensurePlayerRecordShape(player) {
        if (!player || typeof player !== 'object') {
            return null;
        }
        const displayName = truncateName(player.name || '');
        const normalized = normalizeName(displayName) || normalizeName(player.nameNormalized || '');
        if (!normalized) {
            return null;
        }

        const stats = player.stats && typeof player.stats === 'object'
            ? player.stats
            : createEmptyStats();
        if (!stats.byGameType || typeof stats.byGameType !== 'object') {
            stats.byGameType = {};
        }
        stats.racksWon = stats.racksWon || 0;
        stats.racksLost = stats.racksLost || 0;
        stats.gamesWon = stats.gamesWon || 0;
        stats.gamesLost = stats.gamesLost || 0;
        stats.ballsWon = stats.ballsWon || 0;
        stats.ballsLost = stats.ballsLost || 0;
        stats.highestBreak = stats.highestBreak || 0;
        stats.highestRun = stats.highestRun || 0;
        stats.breakAndRuns = stats.breakAndRuns || 0;
        stats.tableRuns = stats.tableRuns || 0;
        stats.fouls = stats.fouls || 0;

        return {
            id: player.id || generateId(),
            name: displayName || truncateName(normalized),
            nameNormalized: normalized,
            stats: stats,
            createdAt: player.createdAt || new Date().toISOString(),
            updatedAt: player.updatedAt || new Date().toISOString(),
            lastPlayedAt: player.lastPlayedAt || null
        };
    }

    async function repairPlayerRecords() {
        await openDatabase();
        const players = await getAllPlayers();
        let repaired = 0;
        for (let i = 0; i < players.length; i++) {
            const original = players[i];
            const shaped = ensurePlayerRecordShape(original);
            if (!shaped) {
                continue;
            }
            const needsRepair =
                original.nameNormalized !== shaped.nameNormalized ||
                original.name !== shaped.name ||
                !original.stats ||
                !original.stats.byGameType;
            if (needsRepair) {
                await putPlayer(shaped);
                repaired++;
            }
        }
        return repaired;
    }

    /** Current consecutive game wins from most recent completed match (matches newest-first). */
    function getCurrentWinStreak(playerId, matches) {
        if (!playerId || !matches || matches.length === 0) {
            return 0;
        }
        let streak = 0;
        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            if (m.status !== 'completed' || !m.winnerId) {
                continue;
            }
            if (m.winnerId === playerId) {
                streak++;
            } else {
                break;
            }
        }
        return streak;
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

    async function deleteMeta(key) {
        await openDatabase();
        const store = tx(['meta'], 'readwrite').objectStore('meta');
        return promisifyRequest(store.delete(key));
    }

    const OVERLAY_STATS_MODE_KEY = 'overlayStatsMode';
    const OVERLAY_STATS_PAYLOAD_KEY = 'overlayStatsPayload';

    function getInstanceId() {
        if (typeof INSTANCE_ID !== 'undefined') {
            return INSTANCE_ID || '';
        }
        try {
            return new URLSearchParams(window.location.search).get('instance') || '';
        } catch (err) {
            return '';
        }
    }

    /** Per-instance pending match (global roster; session state isolated by OBS instance). */
    function getPendingSessionMetaKey() {
        const id = getInstanceId();
        return id ? ('activePendingSession_' + id) : 'activePendingSession';
    }

    let pendingSessionGeneration = 0;

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function serializePendingSession() {
        if (!activeMatchSession.matchId || !activeMatchSession.pendingMatch) {
            return null;
        }
        return {
            version: 1,
            matchId: activeMatchSession.matchId,
            pendingMatch: cloneJson(activeMatchSession.pendingMatch),
            player1Id: activeMatchSession.player1Id,
            player2Id: activeMatchSession.player2Id,
            player1Name: activeMatchSession.player1Name,
            player2Name: activeMatchSession.player2Name,
            gameType: activeMatchSession.gameType,
            raceTo: activeMatchSession.raceTo,
            gameInfo: activeMatchSession.gameInfo,
            status: activeMatchSession.status,
            matchCompletedRecorded: !!activeMatchSession.matchCompletedRecorded,
            lastRackWinnerSlot: activeMatchSession.lastRackWinnerSlot,
            lastBallWinnerSlot: activeMatchSession.lastBallWinnerSlot,
            duplicateNames: !!activeMatchSession.duplicateNames,
            straightPoolRunSlot: activeMatchSession.straightPoolRunSlot,
            straightPoolRunLength: activeMatchSession.straightPoolRunLength || 0
        };
    }

    async function clearPendingSessionMeta() {
        await deleteMeta(getPendingSessionMetaKey());
    }

    async function clearAllPendingSessionMeta() {
        await openDatabase();
        const store = tx(['meta'], 'readonly').objectStore('meta');
        const all = await promisifyRequest(store.getAll());
        const rows = all || [];
        for (let i = 0; i < rows.length; i++) {
            const key = rows[i] && rows[i].key;
            if (key === 'activePendingSession' ||
                (typeof key === 'string' && key.indexOf('activePendingSession_') === 0)) {
                await deleteMeta(key);
            }
        }
    }

    async function persistPendingSession() {
        const gen = pendingSessionGeneration;
        const snap = serializePendingSession();
        if (!snap) {
            if (gen === pendingSessionGeneration) {
                await clearPendingSessionMeta();
            }
            return;
        }
        if (gen !== pendingSessionGeneration) {
            return;
        }
        await setMeta(getPendingSessionMetaKey(), snap);
    }

    function queuePersistPendingSession() {
        persistPendingSession().catch(function (err) {
            console.error('Persist pending session error:', err);
        });
    }

    async function restorePendingSession() {
        const row = await getMeta(getPendingSessionMetaKey());
        const snap = row && row.value;
        if (!snap || !snap.matchId || !snap.pendingMatch) {
            return false;
        }
        activeMatchSession.pendingMatch = snap.pendingMatch;
        activeMatchSession.matchId = snap.matchId;
        activeMatchSession.player1Id = snap.player1Id || null;
        activeMatchSession.player2Id = snap.player2Id || null;
        activeMatchSession.player1Name = snap.player1Name || '';
        activeMatchSession.player2Name = snap.player2Name || '';
        activeMatchSession.gameType = snap.gameType || 'game1';
        activeMatchSession.raceTo = snap.raceTo != null ? snap.raceTo : null;
        activeMatchSession.gameInfo = snap.gameInfo || '';
        activeMatchSession.status = snap.status || 'active';
        activeMatchSession.matchCompletedRecorded = !!snap.matchCompletedRecorded;
        activeMatchSession.lastRackWinnerSlot = snap.lastRackWinnerSlot || null;
        activeMatchSession.lastBallWinnerSlot = snap.lastBallWinnerSlot || null;
        activeMatchSession.duplicateNames = !!snap.duplicateNames;
        activeMatchSession.straightPoolRunSlot = snap.straightPoolRunSlot || null;
        activeMatchSession.straightPoolRunLength = snap.straightPoolRunLength || 0;

        if (activeMatchSession.player1Id) {
            setPlayerIdOnInput('1', activeMatchSession.player1Id);
        }
        if (activeMatchSession.player2Id) {
            setPlayerIdOnInput('2', activeMatchSession.player2Id);
        }

        // Drop stale sessions without undoing career stats (already applied when events occurred).
        const p1Name = (document.getElementById('p1Name')?.value || '').trim();
        const p2Name = (document.getElementById('p2Name')?.value || '').trim();
        if (p1Name && p2Name) {
            const context = getCurrentContext();
            if (sessionNeedsReset(p1Name, p2Name, context)) {
                await resetSessionState();
                return false;
            }
        }
        return true;
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
        const maxResults = typeof limit === 'number' ? limit : 8;
        if (!normalizedQuery) {
            return all
                .slice()
                .sort(function (a, b) {
                    return (a.name || '').localeCompare(b.name || '');
                })
                .slice(0, maxResults);
        }
        return all
            .filter(function (p) {
                const nameNorm = p.nameNormalized || normalizeName(p.name);
                const nameLower = (p.name || '').toLowerCase();
                if (!nameNorm && !nameLower) {
                    return false;
                }
                return (nameNorm && nameNorm.indexOf(normalizedQuery) === 0) ||
                    nameLower.indexOf(normalizedQuery) !== -1;
            })
            .sort(function (a, b) {
                const aNorm = a.nameNormalized || normalizeName(a.name);
                const bNorm = b.nameNormalized || normalizeName(b.name);
                const aStarts = aNorm.indexOf(normalizedQuery) === 0 ? 0 : 1;
                const bStarts = bNorm.indexOf(normalizedQuery) === 0 ? 0 : 1;
                if (aStarts !== bStarts) {
                    return aStarts - bStarts;
                }
                return (a.name || '').localeCompare(b.name || '');
            })
            .slice(0, maxResults);
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
        const dualScore = typeof isDualScoreMode === 'function' && isDualScoreMode() &&
            !isSnookerGameType(gameType);
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
            // Bound id is only valid while the typed name still matches that player
            if (player && normalizeName(player.name) === normalizeName(truncateName(name))) {
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
            activeMatchSession.gameType !== context.gameType) {
            return true;
        }
        // Race-to / game info alone must not discard an in-progress match (e.g. control panel refresh).
        if (activeMatchSession.raceTo !== context.raceTo) {
            activeMatchSession.raceTo = context.raceTo;
            if (activeMatchSession.pendingMatch) {
                activeMatchSession.pendingMatch.raceTo = context.raceTo;
            }
            queuePersistPendingSession();
        }
        const gameInfo = context.gameInfo || '';
        if (activeMatchSession.gameInfo !== gameInfo) {
            activeMatchSession.gameInfo = gameInfo;
            if (activeMatchSession.pendingMatch) {
                activeMatchSession.pendingMatch.gameInfo = gameInfo;
            }
            queuePersistPendingSession();
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
        activeMatchSession.pendingMatch = match;
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
        activeMatchSession.straightPoolRunSlot = null;
        activeMatchSession.straightPoolRunLength = 0;
        await persistPendingSession();
        emitCloudSession('start', {
            sessionId: match.id,
            gameType: context.gameType,
            gameInfo: context.gameInfo || '',
            player1: match.player1Name,
            player2: match.player2Name,
        });
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
            await abandonActivePendingMatch();
            await resetSessionState();
            return createNewMatchSession(p1Name, p2Name, context);
        }
        return true;
    }

    async function persistActiveMatch() {
        const match = getActivePendingMatch();
        if (!match || match.status !== 'completed') {
            return;
        }
        await putMatch(match);
    }

    function isTrackerRackWinGameType(gameType) {
        return gameType === 'game1' || gameType === 'game2' || gameType === 'game3';
    }

    function readRackRunClassificationFromStorage(winnerSlot) {
        const breaker = getStorageItem('rackBreakerSlot');
        const opponentVisited = getStorageItem('rackOpponentVisited') === 'yes';
        if (breaker !== '1' && breaker !== '2') {
            return { breakAndRun: false, tableRun: false, breakerSlot: null };
        }
        if (winnerSlot === breaker && !opponentVisited) {
            return { breakAndRun: true, tableRun: false, breakerSlot: breaker };
        }
        if (opponentVisited) {
            return { breakAndRun: false, tableRun: true, breakerSlot: breaker };
        }
        return { breakAndRun: false, tableRun: false, breakerSlot: breaker };
    }

    async function applyFoulDelta(playerId, gameType, delta) {
        if (!playerId || !delta) {
            return;
        }
        const player = await getPlayer(playerId);
        if (!player) {
            return;
        }
        const now = new Date().toISOString();
        player.stats.fouls = Math.max(0, (player.stats.fouls || 0) + delta);
        const typeStats = ensureTypeStats(player.stats, gameType);
        typeStats.fouls = Math.max(0, (typeStats.fouls || 0) + delta);
        if (delta > 0) {
            player.lastPlayedAt = now;
        }
        player.updatedAt = now;
        await putPlayer(player);
    }

    async function applyRunOutDelta(winnerId, gameType, delta, kind) {
        const field = kind === 'tableRun' ? 'tableRuns' : 'breakAndRuns';
        const winner = await getPlayer(winnerId);
        if (!winner) {
            return;
        }
        const now = new Date().toISOString();
        winner.stats[field] = (winner.stats[field] || 0) + delta;
        const typeStats = ensureTypeStats(winner.stats, gameType);
        typeStats[field] = (typeStats[field] || 0) + delta;
        if (delta > 0) {
            winner.lastPlayedAt = now;
        }
        winner.updatedAt = now;
        await putPlayer(winner);
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

    // Serialize career/match writes so concurrent ball pots and rack wins cannot
    // overwrite each other (e.g. B&R lost when creditTrackerRackWin fires both).
    let rackRecordQueue = Promise.resolve();

    function enqueueStatsWrite(run) {
        const queued = rackRecordQueue.then(run, run);
        rackRecordQueue = queued.catch(function () { /* keep queue alive */ });
        return queued;
    }

    async function flushRackRecordQueue() {
        await rackRecordQueue;
    }

    async function recordRackWin(playerSlot, options) {
        return enqueueStatsWrite(() => recordRackWinInternal(playerSlot, options));
    }

    async function recordRackWinInternal(playerSlot, options) {
        const ready = await ensureActiveSession();
        if (!ready || activeMatchSession.duplicateNames) {
            return;
        }

        const ids = getSlotPlayerIds(playerSlot);
        const context = getCurrentContext();
        const match = getActivePendingMatch();
        if (!match) {
            return;
        }

        let straightRunLength = 0;
        if (context.gameType === 'game4') {
            if (activeMatchSession.straightPoolRunSlot === playerSlot) {
                activeMatchSession.straightPoolRunLength += 1;
            } else {
                activeMatchSession.straightPoolRunSlot = playerSlot;
                activeMatchSession.straightPoolRunLength = 1;
            }
            straightRunLength = activeMatchSession.straightPoolRunLength;
        }

        const rackEntry = {
            rackNumber: match.racks.length + 1,
            winnerId: ids.winnerId,
            timestamp: new Date().toISOString()
        };
        if (context.gameType === 'game4') {
            // Store current run length for the scorer (editable in match history).
            rackEntry.highestRunP1 = playerSlot === '1' ? straightRunLength : 0;
            rackEntry.highestRunP2 = playerSlot === '2' ? straightRunLength : 0;
        }
        if (isTrackerRackWinGameType(context.gameType)) {
            // Prefer classification captured before breaker state was cleared for next rack.
            const runClass = (options && options.rackRunClass)
                ? options.rackRunClass
                : readRackRunClassificationFromStorage(playerSlot);
            if (runClass.breakerSlot) {
                rackEntry.breakerSlot = runClass.breakerSlot;
            }
            rackEntry.breakAndRun = !!runClass.breakAndRun;
            rackEntry.tableRun = !!runClass.tableRun;
            if (runClass.breakAndRun) {
                await applyRunOutDelta(ids.winnerId, context.gameType, 1, 'breakAndRun');
            } else if (runClass.tableRun) {
                await applyRunOutDelta(ids.winnerId, context.gameType, 1, 'tableRun');
            }
        }
        const foulsP1 = Math.max(0, parseInt(getStorageItem('snookerFrameFoulsP1') || '0', 10) || 0);
        const foulsP2 = Math.max(0, parseInt(getStorageItem('snookerFrameFoulsP2') || '0', 10) || 0);
        rackEntry.foulsP1 = foulsP1;
        rackEntry.foulsP2 = foulsP2;
        match.racks.push(rackEntry);

        const p1Score = parseInt(getStorageItem('p1ScoreCtrlPanel'), 10) || 0;
        const p2Score = parseInt(getStorageItem('p2ScoreCtrlPanel'), 10) || 0;
        match.finalScore = { p1: p1Score, p2: p2Score };

        await applyRackDelta(ids.winnerId, ids.loserId, context.gameType, 1);
        if (foulsP1 > 0) {
            await applyFoulDelta(activeMatchSession.player1Id, context.gameType, foulsP1);
        }
        if (foulsP2 > 0) {
            await applyFoulDelta(activeMatchSession.player2Id, context.gameType, foulsP2);
        }
        if (typeof setStorageItem === 'function') {
            setStorageItem('snookerFrameFoulsP1', '0');
            setStorageItem('snookerFrameFoulsP2', '0');
        }
        activeMatchSession.lastRackWinnerSlot = playerSlot;

        if (context.gameType === 'game4') {
            await applyHighestRunIfBetter(ids.winnerId, straightRunLength, 'game4');
        }

        await checkMatchCompletion();
        await persistPendingSession();
        broadcastOverlayStatsIfEnabled();
    }

    async function applyHighestBreakIfBetter(playerId, breakValue, gameType) {
        const value = parseInt(breakValue, 10) || 0;
        if (!playerId || value <= 0) {
            return;
        }
        noteMatchHighestBreak(playerId, value);
        const player = await getPlayer(playerId);
        if (!player) {
            return;
        }
        let changed = false;
        if (value > (player.stats.highestBreak || 0)) {
            player.stats.highestBreak = value;
            changed = true;
        }
        const typeStats = ensureTypeStats(player.stats, gameType || 'game8');
        if (value > (typeStats.highestBreak || 0)) {
            typeStats.highestBreak = value;
            changed = true;
        }
        if (changed) {
            player.updatedAt = new Date().toISOString();
            await putPlayer(player);
        }
    }

    async function applyHighestRunIfBetter(playerId, runValue, gameType) {
        const value = parseInt(runValue, 10) || 0;
        if (!playerId || value <= 0) {
            return;
        }
        noteMatchHighestRun(playerId, value);
        const player = await getPlayer(playerId);
        if (!player) {
            return;
        }
        let changed = false;
        if (value > (player.stats.highestRun || 0)) {
            player.stats.highestRun = value;
            changed = true;
        }
        const typeStats = ensureTypeStats(player.stats, gameType || 'game4');
        if (value > (typeStats.highestRun || 0)) {
            typeStats.highestRun = value;
            changed = true;
        }
        // Migrate legacy straight totals that lived under highestBreak.
        if ((typeStats.highestBreak || 0) > 0 && (typeStats.highestBreak || 0) > (typeStats.highestRun || 0)) {
            typeStats.highestRun = typeStats.highestBreak;
            typeStats.highestBreak = 0;
            changed = true;
        }
        if (changed) {
            player.updatedAt = new Date().toISOString();
            await putPlayer(player);
        }
    }

    /** Track best break on the in-progress match (overlay is match-scoped). */
    function noteMatchHighestBreak(playerId, value) {
        const match = getActivePendingMatch();
        const v = parseInt(value, 10) || 0;
        if (!match || !playerId || v <= 0) {
            return;
        }
        if (!match.matchHighestBreak) {
            match.matchHighestBreak = {};
        }
        if (v > (match.matchHighestBreak[playerId] || 0)) {
            match.matchHighestBreak[playerId] = v;
            queuePersistPendingSession();
        }
    }

    /** Track best run on the in-progress Straight Pool match. */
    function noteMatchHighestRun(playerId, value) {
        const match = getActivePendingMatch();
        const v = parseInt(value, 10) || 0;
        if (!match || !playerId || v <= 0) {
            return;
        }
        if (!match.matchHighestRun) {
            match.matchHighestRun = {};
        }
        if (v > (match.matchHighestRun[playerId] || 0)) {
            match.matchHighestRun[playerId] = v;
            queuePersistPendingSession();
        }
    }

    /**
     * Balls potted + highest break/run for the current match only (not career).
     * Includes live snooker frame/current break and Straight Pool run in progress.
     */
    function readMatchScopedStatsForSlot(slot) {
        const match = getActivePendingMatch();
        const slotStr = String(slot);
        const playerId = slotStr === '2' ? activeMatchSession.player2Id : activeMatchSession.player1Id;
        const empty = { ballsPotted: 0, highestBreak: 0, highestRun: 0, fouls: 0 };
        if (!match || !playerId) {
            return empty;
        }

        let ballsPotted = 0;
        (match.balls || []).forEach(function (b) {
            if (b.winnerId === playerId) {
                ballsPotted += 1;
            }
        });

        let highestBreak = highestBreakFromMatchForPlayer(match, playerId);
        let highestRun = highestRunFromMatchForPlayer(match, playerId);
        let fouls = 0;
        (match.racks || []).forEach(function (r) {
            if (slotStr === '2') {
                fouls += clampScore(r.foulsP2);
            } else {
                fouls += clampScore(r.foulsP1);
            }
        });

        const gameType = match.gameType || getActiveGameType();
        if (isSnookerGameType(gameType) && typeof getStorageItem === 'function') {
            const frameKey = slotStr === '2' ? 'snookerFrameHighBreakP2' : 'snookerFrameHighBreakP1';
            const frameHb = parseInt(getStorageItem(frameKey) || '0', 10) || 0;
            highestBreak = Math.max(highestBreak, frameHb);
            const foulKey = slotStr === '2' ? 'snookerFrameFoulsP2' : 'snookerFrameFoulsP1';
            fouls += Math.max(0, parseInt(getStorageItem(foulKey) || '0', 10) || 0);
            const active = String(getStorageItem('activePlayer') || '1');
            if (active === slotStr) {
                const current = parseInt(getStorageItem('snookerCurrentBreak') || '0', 10) || 0;
                highestBreak = Math.max(highestBreak, current);
            }
        }
        if (isStraightPoolGameType(gameType) &&
            activeMatchSession.straightPoolRunSlot === slotStr) {
            highestRun = Math.max(highestRun, activeMatchSession.straightPoolRunLength || 0);
        }

        return { ballsPotted: ballsPotted, highestBreak: highestBreak, highestRun: highestRun, fouls: fouls };
    }

    /**
     * Finalize a snooker frame: store per-player highest breaks, frame point score,
     * and frame win (if not tied). Race-to uses frame wins, not in-frame points.
     */
    async function recordSnookerFrame(frameData) {
        const data = frameData || {};
        const p1Score = parseInt(data.p1Score, 10) || 0;
        const p2Score = parseInt(data.p2Score, 10) || 0;
        const highBreakP1 = parseInt(data.highBreakP1, 10) || 0;
        const highBreakP2 = parseInt(data.highBreakP2, 10) || 0;
        const foulsP1 = clampScore(data.foulsP1);
        const foulsP2 = clampScore(data.foulsP2);

        let winnerSlot = data.winnerSlot === '1' || data.winnerSlot === '2' ? data.winnerSlot : null;
        if (!winnerSlot) {
            if (p1Score > p2Score) {
                winnerSlot = '1';
            } else if (p2Score > p1Score) {
                winnerSlot = '2';
            }
        }

        if (!winnerSlot && p1Score === 0 && p2Score === 0 && highBreakP1 === 0 && highBreakP2 === 0 &&
            foulsP1 === 0 && foulsP2 === 0) {
            return;
        }

        const ready = await ensureActiveSession();
        if (!ready || activeMatchSession.duplicateNames) {
            return;
        }

        const match = getActivePendingMatch();
        if (!match) {
            return;
        }

        const rackEntry = {
            rackNumber: match.racks.length + 1,
            winnerId: winnerSlot ? getSlotPlayerIds(winnerSlot).winnerId : null,
            timestamp: new Date().toISOString(),
            highestBreakP1: highBreakP1,
            highestBreakP2: highBreakP2,
            foulsP1: foulsP1,
            foulsP2: foulsP2,
            frameScore: { p1: p1Score, p2: p2Score }
        };
        match.racks.push(rackEntry);

        let p1Frames = 0;
        let p2Frames = 0;
        match.racks.forEach(function (r) {
            if (r.winnerId === activeMatchSession.player1Id) {
                p1Frames++;
            } else if (r.winnerId === activeMatchSession.player2Id) {
                p2Frames++;
            }
        });
        match.finalScore = { p1: p1Frames, p2: p2Frames };

        if (winnerSlot) {
            const ids = getSlotPlayerIds(winnerSlot);
            await applyRackDelta(ids.winnerId, ids.loserId, 'game8', 1);
            activeMatchSession.lastRackWinnerSlot = winnerSlot;
        }

        await applyHighestBreakIfBetter(activeMatchSession.player1Id, highBreakP1, 'game8');
        await applyHighestBreakIfBetter(activeMatchSession.player2Id, highBreakP2, 'game8');
        if (foulsP1 > 0) {
            await applyFoulDelta(activeMatchSession.player1Id, 'game8', foulsP1);
        }
        if (foulsP2 > 0) {
            await applyFoulDelta(activeMatchSession.player2Id, 'game8', foulsP2);
        }

        await checkSnookerMatchCompletion(p1Frames, p2Frames);
        await persistPendingSession();
        broadcastOverlayStatsIfEnabled();
    }

    async function checkSnookerMatchCompletion(p1Frames, p2Frames) {
        const context = getCurrentContext();
        if (context.raceTo === null || activeMatchSession.matchCompletedRecorded) {
            return;
        }
        let winnerSlot = null;
        if (p1Frames >= context.raceTo && p1Frames >= p2Frames) {
            winnerSlot = '1';
        } else if (p2Frames >= context.raceTo && p2Frames >= p1Frames) {
            winnerSlot = '2';
        }
        if (!winnerSlot) {
            return;
        }
        await finalizeMatchCompletion(winnerSlot, { p1: p1Frames, p2: p2Frames });
    }

    async function undoLastRack(playerSlot) {
        return enqueueStatsWrite(() => undoLastRackInternal(playerSlot));
    }

    async function undoLastRackInternal(playerSlot) {
        if (!activeMatchSession.matchId || activeMatchSession.lastRackWinnerSlot !== playerSlot) {
            return;
        }

        const match = getActivePendingMatch();
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

        await applyRackDelta(winnerId, loserId, context.gameType, -1);
        if (isTrackerRackWinGameType(context.gameType) && lastRack.winnerId === winnerId) {
            if (lastRack.breakAndRun) {
                await applyRunOutDelta(winnerId, context.gameType, -1, 'breakAndRun');
            } else if (lastRack.tableRun) {
                await applyRunOutDelta(winnerId, context.gameType, -1, 'tableRun');
            }
        }
        const undoFoulsP1 = clampScore(lastRack.foulsP1);
        const undoFoulsP2 = clampScore(lastRack.foulsP2);
        if (undoFoulsP1 > 0) {
            await applyFoulDelta(activeMatchSession.player1Id, context.gameType, -undoFoulsP1);
        }
        if (undoFoulsP2 > 0) {
            await applyFoulDelta(activeMatchSession.player2Id, context.gameType, -undoFoulsP2);
        }
        // Restore live rack foul counters so a re-finished rack re-counts correctly.
        if (typeof setStorageItem === 'function') {
            setStorageItem('snookerFrameFoulsP1', String(undoFoulsP1));
            setStorageItem('snookerFrameFoulsP2', String(undoFoulsP2));
        }
        activeMatchSession.lastRackWinnerSlot = match.racks.length > 0
            ? (match.racks[match.racks.length - 1].winnerId === activeMatchSession.player1Id ? '1' : '2')
            : null;
        if (context.gameType === 'game4') {
            // Rebuild current run from trailing consecutive racks for the same player.
            recomputeStraightPoolRunFromRacks();
        }
        await persistPendingSession();
        broadcastOverlayStatsIfEnabled();
    }

    /** Straight Pool: current run = trailing streak of primary-score racks for one player. */
    function recomputeStraightPoolRunFromRacks() {
        const match = getActivePendingMatch();
        if (!match || !match.racks || match.racks.length === 0) {
            activeMatchSession.straightPoolRunSlot = null;
            activeMatchSession.straightPoolRunLength = 0;
            return;
        }
        const lastWinnerId = match.racks[match.racks.length - 1].winnerId;
        let length = 0;
        for (let i = match.racks.length - 1; i >= 0; i--) {
            if (match.racks[i].winnerId !== lastWinnerId) {
                break;
            }
            length += 1;
        }
        const slot = lastWinnerId === activeMatchSession.player1Id
            ? '1'
            : (lastWinnerId === activeMatchSession.player2Id ? '2' : null);
        activeMatchSession.straightPoolRunSlot = slot;
        activeMatchSession.straightPoolRunLength = slot ? length : 0;
    }

    async function recordBallWin(playerSlot) {
        return enqueueStatsWrite(() => recordBallWinInternal(playerSlot));
    }

    async function recordBallWinInternal(playerSlot) {
        const ready = await ensureActiveSession();
        if (!ready || activeMatchSession.duplicateNames) {
            return;
        }
        const context = getCurrentContext();
        // 8/9/10 Ball Scoring pots, Bank/One Pocket/Custom point-based, Snooker pots
        if (!showsBallStats(context.gameType)) {
            return;
        }

        const ids = getSlotPlayerIds(playerSlot);
        const match = getActivePendingMatch();
        if (!match) {
            return;
        }

        if (!match.balls) {
            match.balls = [];
        }
        match.balls.push({
            winnerId: ids.winnerId,
            timestamp: new Date().toISOString()
        });
        await applyBallDelta(ids.winnerId, ids.loserId, context.gameType, 1);
        activeMatchSession.lastBallWinnerSlot = playerSlot;
        await persistPendingSession();
        // Snooker overlay is refreshed from control_panel after sequence state is committed.
        if (context.gameType !== 'game8') {
            broadcastOverlayStatsIfEnabled();
        }
    }

    /**
     * Straight Pool: update Longest Run when the current consecutive scoring run grows.
     */
    async function noteStraightPoolRun(playerSlot, runLength) {
        const length = parseInt(runLength, 10) || 0;
        if (length <= 0 || (playerSlot !== '1' && playerSlot !== '2')) {
            return;
        }
        if (getActiveGameType() !== 'game4') {
            return;
        }
        let playerId = getPlayerIdFromInput(playerSlot);
        if (!playerId) {
            const input = document.getElementById(playerSlot === '1' ? 'p1Name' : 'p2Name');
            const name = truncateName((input && input.value) || '');
            if (!name) {
                return;
            }
            const found = await lookupPlayer(name);
            if (!found) {
                return;
            }
            playerId = found.id;
            setPlayerIdOnInput(playerSlot, playerId);
        }
        await applyHighestRunIfBetter(playerId, length, 'game4');
        broadcastOverlayStatsIfEnabled();
    }

    async function undoLastBall(playerSlot) {
        return enqueueStatsWrite(() => undoLastBallInternal(playerSlot));
    }

    async function undoLastBallInternal(playerSlot) {
        if (!activeMatchSession.matchId || activeMatchSession.lastBallWinnerSlot !== playerSlot) {
            return;
        }
        const match = getActivePendingMatch();
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
        await applyBallDelta(winnerId, loserId, context.gameType, -1);
        activeMatchSession.lastBallWinnerSlot = match.balls.length > 0
            ? (match.balls[match.balls.length - 1].winnerId === activeMatchSession.player1Id ? '1' : '2')
            : null;
        await persistPendingSession();
    }

    function getCurrentScores() {
        const p1Input = document.getElementById('p1Score');
        const p2Input = document.getElementById('p2Score');
        const p1 = p1Input
            ? (parseInt(p1Input.value, 10) || 0)
            : (parseInt(getStorageItem('p1ScoreCtrlPanel'), 10) || 0);
        const p2 = p2Input
            ? (parseInt(p2Input.value, 10) || 0)
            : (parseInt(getStorageItem('p2ScoreCtrlPanel'), 10) || 0);
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

    /**
     * Append any missing rack rows so match.racks counts match the live scoreboard.
     * Used before Call Match Early / End Match so async recordRackWin cannot under-count.
     */
    async function reconcileMatchRacksWithScores(match, scores) {
        if (!match || !scores) {
            return;
        }
        if (!match.racks) {
            match.racks = [];
        }
        const p1Id = match.player1Id;
        const p2Id = match.player2Id;
        const wantP1 = clampScore(scores.p1);
        const wantP2 = clampScore(scores.p2);
        let p1Have = match.racks.filter(function (r) { return r.winnerId === p1Id; }).length;
        let p2Have = match.racks.filter(function (r) { return r.winnerId === p2Id; }).length;
        const gameType = match.gameType || activeMatchSession.gameType || 'game1';
        const now = new Date().toISOString();

        while (p1Have < wantP1) {
            const entry = {
                rackNumber: match.racks.length + 1,
                winnerId: p1Id,
                timestamp: now
            };
            if (isStraightPoolGameType(gameType)) {
                entry.highestRunP1 = 0;
                entry.highestRunP2 = 0;
            }
            match.racks.push(entry);
            await applyRackDelta(p1Id, p2Id, gameType, 1);
            p1Have += 1;
        }
        while (p2Have < wantP2) {
            const entry = {
                rackNumber: match.racks.length + 1,
                winnerId: p2Id,
                timestamp: now
            };
            if (isStraightPoolGameType(gameType)) {
                entry.highestRunP1 = 0;
                entry.highestRunP2 = 0;
            }
            match.racks.push(entry);
            await applyRackDelta(p2Id, p1Id, gameType, 1);
            p2Have += 1;
        }

        match.finalScore = { p1: wantP1, p2: wantP2 };
        if (match.racks.length > 0) {
            const last = match.racks[match.racks.length - 1];
            activeMatchSession.lastRackWinnerSlot = last.winnerId === p1Id
                ? '1'
                : (last.winnerId === p2Id ? '2' : activeMatchSession.lastRackWinnerSlot);
        }
    }

    function captureActiveMatchGameInfo() {
        const context = getCurrentContext();
        const gameInfo = (context.gameInfo || activeMatchSession.gameInfo || '').trim();
        activeMatchSession.gameInfo = gameInfo;
        const match = getActivePendingMatch();
        if (match) {
            match.gameInfo = gameInfo;
        }
        return gameInfo;
    }

    async function finalizeMatchCompletion(winnerSlot, scores) {
        if (activeMatchSession.matchCompletedRecorded || activeMatchSession.duplicateNames) {
            return;
        }

        const match = getActivePendingMatch();
        if (!match) {
            return;
        }

        // Do not flushRackRecordQueue here — this may run inside the queue (deadlock).
        await reconcileMatchRacksWithScores(match, scores);

        const ids = getSlotPlayerIds(winnerSlot);
        const now = new Date().toISOString();
        match.status = 'completed';
        match.completedAt = now;
        match.finalScore = { p1: scores.p1, p2: scores.p2 };
        match.winnerId = ids.winnerId;
        captureActiveMatchGameInfo();
        await putMatch(match);

        await applyGameDelta(ids.winnerId, ids.loserId, activeMatchSession.gameType, 1);
        activeMatchSession.status = 'completed';
        activeMatchSession.matchCompletedRecorded = true;
        await persistPendingSession();
        emitCloudSession('end', buildCloudMatchEndPayload(match, {
            matchId: match.id,
            winnerSlot: winnerSlot,
            scores: scores,
            reason: 'race_complete',
        }));
        broadcastOverlayStatsIfEnabled();
    }

    function canCallGame() {
        if (activeMatchSession.matchCompletedRecorded || activeMatchSession.duplicateNames) {
            return false;
        }
        const match = getActivePendingMatch();
        return !!(match && match.racks && match.racks.length > 0);
    }

    /**
     * End the in-progress match early: same persistence path as completing a race / End Match.
     * Winner is the player ahead on primary score; tied scores save with no game W/L.
     * @returns {Promise<boolean>} true if a match was saved
     */
    async function callGame() {
        await flushRackRecordQueue();

        const match = getActivePendingMatch();
        const scores = getCurrentScores();
        if (!match || activeMatchSession.matchCompletedRecorded || activeMatchSession.duplicateNames) {
            return false;
        }
        // After flush, require either recorded racks or a non-zero scoreboard to reconcile.
        if ((!match.racks || match.racks.length === 0) && (scores.p1 + scores.p2) <= 0) {
            return false;
        }

        match.finalScore = { p1: scores.p1, p2: scores.p2 };

        // Keep storage in sync with the board so finalize + history use the same scoreline.
        if (typeof setStorageItem === 'function') {
            setStorageItem('p1ScoreCtrlPanel', scores.p1);
            setStorageItem('p2ScoreCtrlPanel', scores.p2);
        }

        await reconcileMatchRacksWithScores(match, scores);

        let winnerSlot = null;
        if (scores.p1 > scores.p2) {
            winnerSlot = '1';
        } else if (scores.p2 > scores.p1) {
            winnerSlot = '2';
        }

        if (winnerSlot) {
            await finalizeMatchCompletion(winnerSlot, scores);
        } else {
            const now = new Date().toISOString();
            match.status = 'completed';
            match.completedAt = now;
            match.winnerId = null;
            captureActiveMatchGameInfo();
            await putMatch(match);
            activeMatchSession.status = 'completed';
            activeMatchSession.matchCompletedRecorded = true;
            await persistPendingSession();
            emitCloudSession('end', buildCloudMatchEndPayload(match, {
                reason: 'call_early',
                scores: scores,
            }));
            broadcastOverlayStatsIfEnabled();
        }
        return true;
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
        await deleteMatchFromStore(match.id);
        activeMatchSession.status = 'active';
        activeMatchSession.matchCompletedRecorded = false;
        await persistPendingSession();
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
        // Boot postNames() runs before IndexedDB restore — ignore until init finishes.
        if (!playerStatsReady) {
            return;
        }

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
            if (isPlayerSlotEnabled('1') && isPlayerSlotEnabled('2')) {
                await ensureActiveSession();
            } else if (sessionNeedsReset(p1Name, p2Name, context)) {
                await abandonActivePendingMatch();
                await resetSessionState();
            }
        }
        maybeRefreshStatsModalH2H();
        broadcastOverlayStatsIfEnabled();
    }

    async function onClearGame() {
        await abandonActivePendingMatch();
        await resetSessionState();
    }

    async function onResetScores(options) {
        const endMatch = options && (options.endMatch || options.snookerEndMatch);

        if (endMatch) {
            // End Match: rack/frame stats are already stored on the match row. The scoreboard
            // is cleared before this runs, so do not persist finalScore from live storage.
            const match = getActivePendingMatch();
            emitCloudSession('end', buildCloudMatchEndPayload(match, { reason: 'end_match' }));
            await resetSessionState();
            await ensureActiveSession();
            broadcastOverlayStatsIfEnabled();
            return;
        }

        if (activeMatchSession.matchId && activeMatchSession.matchCompletedRecorded) {
            await resetSessionState();
            await ensureActiveSession();
        } else if (activeMatchSession.matchId) {
            const match = getActivePendingMatch();
            if (match && (match.racks.length > 0 || (match.balls && match.balls.length > 0))) {
                await undoAllRacksInMatch(match);
                match.finalScore = { p1: 0, p2: 0 };
                match.racks = [];
                match.balls = [];
            }
            activeMatchSession.matchCompletedRecorded = false;
            activeMatchSession.status = 'active';
            activeMatchSession.lastRackWinnerSlot = null;
            activeMatchSession.lastBallWinnerSlot = null;
            activeMatchSession.straightPoolRunSlot = null;
            activeMatchSession.straightPoolRunLength = 0;
            await persistPendingSession();
        }
        broadcastOverlayStatsIfEnabled();
    }

    async function undoAllRacksInMatch(match) {
        if (!match) {
            return;
        }
        const gameType = match.gameType || activeMatchSession.gameType ||
            (typeof getCurrentContext === 'function' ? getCurrentContext().gameType : 'game1');
        const p1Id = match.player1Id || activeMatchSession.player1Id;
        const p2Id = match.player2Id || activeMatchSession.player2Id;
        const racks = match.racks || [];
        for (let i = racks.length - 1; i >= 0; i--) {
            const rack = racks[i];
            if (!rack) {
                continue;
            }
            if (isSnookerGameType(gameType)) {
                const f1 = clampScore(rack.foulsP1);
                const f2 = clampScore(rack.foulsP2);
                if (f1 > 0) await applyFoulDelta(p1Id, gameType, -f1);
                if (f2 > 0) await applyFoulDelta(p2Id, gameType, -f2);
            }
            if (!rack.winnerId) {
                continue;
            }
            const loserId = rack.winnerId === p1Id ? p2Id : (rack.winnerId === p2Id ? p1Id : null);
            if (!loserId) {
                continue;
            }
            await applyRackDelta(rack.winnerId, loserId, gameType, -1);
        }
        const balls = match.balls || [];
        for (let j = balls.length - 1; j >= 0; j--) {
            const ball = balls[j];
            if (!ball || !ball.winnerId) {
                continue;
            }
            const loserId = ball.winnerId === p1Id ? p2Id : (ball.winnerId === p2Id ? p1Id : null);
            if (!loserId) {
                continue;
            }
            await applyBallDelta(ball.winnerId, loserId, gameType, -1);
        }
    }

    function clearLiveMatchScoreboardState() {
        if (typeof setStorageItem === 'function') {
            setStorageItem('p1ScoreCtrlPanel', 0);
            setStorageItem('p2ScoreCtrlPanel', 0);
            setStorageItem('p1Score', 0);
            setStorageItem('p2Score', 0);
            setStorageItem('p1BallsCtrlPanel', 0);
            setStorageItem('p2BallsCtrlPanel', 0);
            setStorageItem('p1Balls', 0);
            setStorageItem('p2Balls', 0);
            setStorageItem('snookerCurrentBreak', '0');
            setStorageItem('snookerFrameHighBreakP1', '0');
            setStorageItem('snookerFrameHighBreakP2', '0');
            setStorageItem('snookerFrameFoulsP1', '0');
            setStorageItem('snookerFrameFoulsP2', '0');
        }
        ['p1Score', 'p2Score', 'p1Balls', 'p2Balls'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) {
                el.value = 0;
            }
        });
        if (typeof bc !== 'undefined') {
            bc.postMessage({ player: '1', score: 0 });
            bc.postMessage({ player: '2', score: 0 });
            bc.postMessage({ player: '1', balls: 0 });
            bc.postMessage({ player: '2', balls: 0 });
        }
        if (typeof updateScoreControlAvailability === 'function') {
            updateScoreControlAvailability();
        }
        if (typeof updateCallGameButton === 'function') {
            updateCallGameButton();
        }
    }

    async function resetSessionState() {
        // Only clear persisted meta when we actually had a session. Early postNames()
        // before init must not wipe IndexedDB pending match (balls / match HB).
        const shouldClearMeta = !!(activeMatchSession.matchId || activeMatchSession.pendingMatch);
        pendingSessionGeneration += 1;
        activeMatchSession.pendingMatch = null;
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
        activeMatchSession.straightPoolRunSlot = null;
        activeMatchSession.straightPoolRunLength = 0;
        if (shouldClearMeta) {
            try {
                await clearPendingSessionMeta();
            } catch (err) {
                console.error('Clear pending session error:', err);
            }
        }
    }

    function pairKey(idA, idB) {
        return [idA, idB].sort().join('::');
    }

    /** Longest consecutive rack/frame wins for a player within one match (Straight Pool run). */
    function longestConsecutiveRackWins(match, playerId) {
        let best = 0;
        let run = 0;
        (match.racks || []).forEach(function (r) {
            if (r.winnerId === playerId) {
                run += 1;
                if (run > best) {
                    best = run;
                }
            } else {
                run = 0;
            }
        });
        return best;
    }

    /** Max snooker break for a player from racks in a single H2H match only (never career totals). */
    function highestBreakFromMatchForPlayer(match, playerId) {
        if (!match || !playerId || isStraightPoolGameType(match.gameType)) {
            return 0;
        }
        let best = 0;
        (match.racks || []).forEach(function (r) {
            let frameBreak = 0;
            if (match.player1Id === playerId) {
                frameBreak = parseInt(r.highestBreakP1, 10) || 0;
            } else if (match.player2Id === playerId) {
                frameBreak = parseInt(r.highestBreakP2, 10) || 0;
            }
            if (frameBreak > best) {
                best = frameBreak;
            }
        });
        if (match.matchHighestBreak && match.matchHighestBreak[playerId]) {
            best = Math.max(best, match.matchHighestBreak[playerId] || 0);
        }
        return best;
    }

    /** Max Straight Pool run for a player from a single match (never career totals). */
    function highestRunFromMatchForPlayer(match, playerId) {
        if (!match || !playerId || !isStraightPoolGameType(match.gameType)) {
            return 0;
        }
        let best = 0;
        (match.racks || []).forEach(function (r) {
            let run = 0;
            if (match.player1Id === playerId) {
                run = parseInt(r.highestRunP1 != null ? r.highestRunP1 : r.highestBreakP1, 10) || 0;
            } else if (match.player2Id === playerId) {
                run = parseInt(r.highestRunP2 != null ? r.highestRunP2 : r.highestBreakP2, 10) || 0;
            }
            if (run > best) {
                best = run;
            }
        });
        if (match.matchHighestRun && match.matchHighestRun[playerId]) {
            best = Math.max(best, match.matchHighestRun[playerId] || 0);
        }
        if (match.matchHighestBreak && match.matchHighestBreak[playerId]) {
            best = Math.max(best, match.matchHighestBreak[playerId] || 0);
        }
        const derivedRun = longestConsecutiveRackWins(match, playerId);
        if (derivedRun > best) {
            best = derivedRun;
        }
        return best;
    }

    function accumulateMatchIntoH2HSummary(summary, match, playerId1, playerId2) {
        if (!summary || !match) {
            return;
        }
        (match.racks || []).forEach(function (r) {
            if (r.winnerId) {
                summary.racksWon[r.winnerId] = (summary.racksWon[r.winnerId] || 0) + 1;
            }
        });
        if (match.balls) {
            match.balls.forEach(function (b) {
                if (b.winnerId) {
                    summary.ballsWon[b.winnerId] = (summary.ballsWon[b.winnerId] || 0) + 1;
                }
            });
        }
        if (summary.fouls) {
            (match.racks || []).forEach(function (r) {
                const f1 = clampScore(r.foulsP1);
                const f2 = clampScore(r.foulsP2);
                if (f1) summary.fouls[match.player1Id] = (summary.fouls[match.player1Id] || 0) + f1;
                if (f2) summary.fouls[match.player2Id] = (summary.fouls[match.player2Id] || 0) + f2;
            });
        }
        if (match.status === 'completed' && match.winnerId) {
            summary.gamesWon[match.winnerId] = (summary.gamesWon[match.winnerId] || 0) + 1;
        }
        const hb1 = highestBreakFromMatchForPlayer(match, playerId1);
        const hb2 = highestBreakFromMatchForPlayer(match, playerId2);
        if (hb1 > summary.highestBreak[playerId1]) {
            summary.highestBreak[playerId1] = hb1;
        }
        if (hb2 > summary.highestBreak[playerId2]) {
            summary.highestBreak[playerId2] = hb2;
        }
        if (summary.highestRun) {
            const hr1 = highestRunFromMatchForPlayer(match, playerId1);
            const hr2 = highestRunFromMatchForPlayer(match, playerId2);
            if (hr1 > summary.highestRun[playerId1]) {
                summary.highestRun[playerId1] = hr1;
            }
            if (hr2 > summary.highestRun[playerId2]) {
                summary.highestRun[playerId2] = hr2;
            }
        }
        const date = match.completedAt || match.startedAt;
        if (date && (!summary.lastPlayedAt || date > summary.lastPlayedAt)) {
            summary.lastPlayedAt = date;
        }
    }

    function pendingMatchBelongsToPair(match, playerId1, playerId2) {
        if (!match || !playerId1 || !playerId2) {
            return false;
        }
        return (match.player1Id === playerId1 && match.player2Id === playerId2) ||
            (match.player1Id === playerId2 && match.player2Id === playerId1);
    }

    function h2hSummaryIncludesInProgressMatch(summary) {
        if (!summary || !summary.matches) {
            return false;
        }
        return summary.matches.some(function (m) {
            return m && m.status !== 'completed';
        });
    }

    function h2hSummaryHasDisplayableActivity(summary, playerId1, playerId2) {
        if (!summary) {
            return false;
        }
        const totalGames = (summary.gamesWon[playerId1] || 0) + (summary.gamesWon[playerId2] || 0);
        const totalRacks = (summary.racksWon[playerId1] || 0) + (summary.racksWon[playerId2] || 0);
        const totalBalls = (summary.ballsWon[playerId1] || 0) + (summary.ballsWon[playerId2] || 0);
        const totalFouls = summary.fouls
            ? ((summary.fouls[playerId1] || 0) + (summary.fouls[playerId2] || 0))
            : 0;
        if (totalGames + totalRacks + totalBalls + totalFouls > 0) {
            return true;
        }
        return h2hSummaryIncludesInProgressMatch(summary);
    }

    /** In-progress match eligible for H2H / stats editing (not yet written as completed). */
    function getEditablePendingMatch() {
        const match = getActivePendingMatch();
        if (!match || !match.id || activeMatchSession.matchCompletedRecorded) {
            return null;
        }
        if (match.status === 'completed') {
            return null;
        }
        return match;
    }

    function isEditablePendingMatchId(matchId) {
        const pending = getEditablePendingMatch();
        return !!(matchId && pending && pending.id === matchId);
    }

    async function getHeadToHead(playerId1, playerId2, options) {
        if (!playerId1 || !playerId2 || playerId1 === playerId2) {
            return null;
        }
        const opts = options || {};
        const gameTypeFilter = opts.gameType || null;
        await openDatabase();
        const store = tx(['matches'], 'readonly').objectStore('matches');
        const allMatches = await promisifyRequest(store.getAll());

        const relevant = allMatches.filter(function (m) {
            return pendingMatchBelongsToPair(m, playerId1, playerId2);
        }).filter(function (m) {
            return m.status === 'completed';
        }).filter(function (m) {
            return !gameTypeFilter || m.gameType === gameTypeFilter;
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
            gameType: gameTypeFilter,
            gamesWon: { [playerId1]: 0, [playerId2]: 0 },
            racksWon: { [playerId1]: 0, [playerId2]: 0 },
            ballsWon: { [playerId1]: 0, [playerId2]: 0 },
            // Only from mutual matches — never career / by-game-type player totals
            highestBreak: { [playerId1]: 0, [playerId2]: 0 },
            highestRun: { [playerId1]: 0, [playerId2]: 0 },
            fouls: { [playerId1]: 0, [playerId2]: 0 },
            matches: relevant,
            lastPlayedAt: null
        };

        relevant.forEach(function (m) {
            accumulateMatchIntoH2HSummary(summary, m, playerId1, playerId2);
        });

        // Live match: fold finished racks/frames/balls into H2H before the match is completed.
        const pending = getEditablePendingMatch();
        if (pending &&
            pendingMatchBelongsToPair(pending, playerId1, playerId2) &&
            (!gameTypeFilter || pending.gameType === gameTypeFilter) &&
            !relevant.some(function (m) { return m.id === pending.id; })) {
            accumulateMatchIntoH2HSummary(summary, pending, playerId1, playerId2);
            summary.matches = [pending].concat(relevant);
        }

        return summary;
    }

    const LOCAL_RETENTION_DAYS = 30;

    /**
     * Remove completed matches older than the retention window from local IndexedDB,
     * then recompute aggregates for affected players. Skipped when cloud mode is active
     * since the backend is the stats source of truth in that case.
     */
    async function pruneOldMatches() {
        if (isCloudStatsMode()) return;
        await openDatabase();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - LOCAL_RETENTION_DAYS);
        const cutoffIso = cutoff.toISOString();

        const all = await promisifyRequest(
            tx(['matches'], 'readonly').objectStore('matches').getAll()
        );
        const toDelete = all.filter(function (m) {
            if (m.status !== 'completed') return false;
            const date = m.completedAt || m.startedAt || '';
            return date && date < cutoffIso;
        });
        if (!toDelete.length) return;

        const affectedPlayerIds = new Set();
        const store = tx(['matches'], 'readwrite').objectStore('matches');
        for (const m of toDelete) {
            store.delete(m.id);
            if (m.player1Id) affectedPlayerIds.add(m.player1Id);
            if (m.player2Id) affectedPlayerIds.add(m.player2Id);
        }
        await new Promise(function (resolve, reject) {
            store.transaction.oncomplete = resolve;
            store.transaction.onerror = function () { reject(store.transaction.error); };
        });

        for (const pid of affectedPlayerIds) {
            await recomputePlayerStats(pid);
        }
        console.log('PlayerStats: pruned ' + toDelete.length + ' matches older than ' + LOCAL_RETENTION_DAYS + ' days');
    }

    async function getAllMatches() {
        await openDatabase();
        const store = tx(['matches'], 'readonly').objectStore('matches');
        return promisifyRequest(store.getAll());
    }

    async function getStoredMatchesForPlayer(playerId) {
        const all = await getAllMatches();
        return all.filter(function (m) {
            return m.player1Id === playerId || m.player2Id === playerId;
        });
    }

    async function getMatchesForPlayer(playerId, options) {
        const opts = options || {};
        const all = await getStoredMatchesForPlayer(playerId);
        let matches = all.filter(function (m) {
            return m.status === 'completed';
        }).sort(function (a, b) {
            const dateA = a.completedAt || a.startedAt || '';
            const dateB = b.completedAt || b.startedAt || '';
            return dateB.localeCompare(dateA);
        });

        if (opts.includePending) {
            const pending = getEditablePendingMatch();
            if (pending &&
                (pending.player1Id === playerId || pending.player2Id === playerId) &&
                !matches.some(function (m) { return m.id === pending.id; })) {
                matches = [pending].concat(matches);
            }
        }
        return matches;
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

                let frameBreak = 0;
                let frameRun = 0;
                if (m.player1Id === playerId) {
                    frameBreak = parseInt(r.highestBreakP1, 10) || 0;
                    frameRun = parseInt(r.highestRunP1 != null ? r.highestRunP1 : (isStraightPoolGameType(gameType) ? r.highestBreakP1 : 0), 10) || 0;
                } else if (m.player2Id === playerId) {
                    frameBreak = parseInt(r.highestBreakP2, 10) || 0;
                    frameRun = parseInt(r.highestRunP2 != null ? r.highestRunP2 : (isStraightPoolGameType(gameType) ? r.highestBreakP2 : 0), 10) || 0;
                }
                if (!isStraightPoolGameType(gameType) && frameBreak > 0) {
                    if (frameBreak > (player.stats.highestBreak || 0)) {
                        player.stats.highestBreak = frameBreak;
                    }
                    const typeStats = ensureTypeStats(player.stats, gameType);
                    if (frameBreak > (typeStats.highestBreak || 0)) {
                        typeStats.highestBreak = frameBreak;
                    }
                }
                if (isStraightPoolGameType(gameType) && frameRun > 0) {
                    if (frameRun > (player.stats.highestRun || 0)) {
                        player.stats.highestRun = frameRun;
                    }
                    const typeStats = ensureTypeStats(player.stats, gameType);
                    if (frameRun > (typeStats.highestRun || 0)) {
                        typeStats.highestRun = frameRun;
                    }
                }
                if (r.breakAndRun && r.winnerId === playerId) {
                    player.stats.breakAndRuns++;
                    ensureTypeStats(player.stats, gameType).breakAndRuns++;
                }
                if (r.tableRun && r.winnerId === playerId) {
                    player.stats.tableRuns++;
                    ensureTypeStats(player.stats, gameType).tableRuns++;
                }
                let frameFouls = 0;
                if (m.player1Id === playerId) {
                    frameFouls = parseInt(r.foulsP1, 10) || 0;
                } else if (m.player2Id === playerId) {
                    frameFouls = parseInt(r.foulsP2, 10) || 0;
                }
                if (frameFouls > 0) {
                    player.stats.fouls = (player.stats.fouls || 0) + frameFouls;
                    ensureTypeStats(player.stats, gameType).fouls =
                        (ensureTypeStats(player.stats, gameType).fouls || 0) + frameFouls;
                }
            });

            // Straight Pool legacy matches may lack per-ball run fields — derive from streaks.
            if (isStraightPoolGameType(gameType)) {
                const derivedRun = longestConsecutiveRackWins(m, playerId);
                if (derivedRun > (player.stats.highestRun || 0)) {
                    player.stats.highestRun = derivedRun;
                }
                const typeStats = ensureTypeStats(player.stats, gameType);
                if (derivedRun > (typeStats.highestRun || 0)) {
                    typeStats.highestRun = derivedRun;
                }
                // Clear legacy straight totals wrongly stored as highestBreak.
                if ((typeStats.highestBreak || 0) > 0) {
                    typeStats.highestRun = Math.max(typeStats.highestRun || 0, typeStats.highestBreak || 0);
                    typeStats.highestBreak = 0;
                }
            }

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

        const includeBalls = gameTypeHasBallScoring(matchPayload.gameType);
        const ballsP1 = includeBalls ? clampScore(matchPayload.ballsP1) : 0;
        const ballsP2 = includeBalls ? clampScore(matchPayload.ballsP2) : 0;
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
        match.gameInfo = matchPayload.gameInfo != null
            ? String(matchPayload.gameInfo).trim()
            : (match.gameInfo || '');

        let racks;
        let scoreP1;
        let scoreP2;
        if (Array.isArray(matchPayload.racks)) {
            racks = normalizeRacksPayload(matchPayload.racks, match.player1Id, match.player2Id, match.gameType);
            if (racks.length === 0) {
                throw new Error('Add at least one ' + rackFrameWord(match.gameType, false).toLowerCase() + '.');
            }
            scoreP1 = racks.filter(function (r) { return r.winnerId === match.player1Id; }).length;
            scoreP2 = racks.filter(function (r) { return r.winnerId === match.player2Id; }).length;
        } else {
            // Legacy/API path: synthesize racks from match scores
            scoreP1 = clampScore(matchPayload.scoreP1);
            scoreP2 = clampScore(matchPayload.scoreP2);
            match.finalScore = { p1: scoreP1, p2: scoreP2 };
            racks = synthesizeRacksFromScores(match);
        }

        if (scoreP1 === scoreP2) {
            throw new Error('Frame/rack wins must differ — only completed matches are recorded.');
        }

        match.finalScore = { p1: scoreP1, p2: scoreP2 };
        match.racks = racks;
        match.balls = synthesizeBallsFromCounts(match, ballsP1, ballsP2);

        if (scoreP1 > scoreP2) {
            match.winnerId = match.player1Id;
            match.completedAt = dateIso;
        } else {
            match.winnerId = match.player2Id;
            match.completedAt = dateIso;
        }
        match.status = 'completed';

        if (!match.startedAt) {
            match.startedAt = dateIso;
        }

        await putMatch(match);

        if (activeMatchSession.matchId === match.id) {
            await resetSessionState();
        }

        await recomputePlayersForMatch(match);
        return match;
    }

    function refreshMatchHighestBreakFromRacks(match) {
        if (!match) {
            return;
        }
        const map = {};
        (match.racks || []).forEach(function (r) {
            const hb1 = clampScore(r.highestBreakP1);
            const hb2 = clampScore(r.highestBreakP2);
            if (hb1 > 0 && hb1 > (map[match.player1Id] || 0)) {
                map[match.player1Id] = hb1;
            }
            if (hb2 > 0 && hb2 > (map[match.player2Id] || 0)) {
                map[match.player2Id] = hb2;
            }
        });
        match.matchHighestBreak = map;
    }

    function syncLiveScoreboardFromMatch(match) {
        if (!match || typeof setStorageItem !== 'function') {
            return;
        }
        const p1 = clampScore(match.finalScore && match.finalScore.p1);
        const p2 = clampScore(match.finalScore && match.finalScore.p2);
        setStorageItem('p1ScoreCtrlPanel', p1);
        setStorageItem('p2ScoreCtrlPanel', p2);
        setStorageItem('p1Score', p1);
        setStorageItem('p2Score', p2);
        const p1ScoreEl = document.getElementById('p1Score');
        const p2ScoreEl = document.getElementById('p2Score');
        if (p1ScoreEl) {
            p1ScoreEl.value = p1;
        }
        if (p2ScoreEl) {
            p2ScoreEl.value = p2;
        }
        if (typeof bc !== 'undefined') {
            bc.postMessage({ player: '1', score: p1 });
            bc.postMessage({ player: '2', score: p2 });
        }

        if (gameTypeHasBallScoring(match.gameType)) {
            const b1 = countBallsForPlayer(match, match.player1Id);
            const b2 = countBallsForPlayer(match, match.player2Id);
            setStorageItem('p1BallsCtrlPanel', b1);
            setStorageItem('p2BallsCtrlPanel', b2);
            setStorageItem('p1Balls', b1);
            setStorageItem('p2Balls', b2);
            const p1BallsEl = document.getElementById('p1Balls');
            const p2BallsEl = document.getElementById('p2Balls');
            if (p1BallsEl) {
                p1BallsEl.value = b1;
            }
            if (p2BallsEl) {
                p2BallsEl.value = b2;
            }
            if (typeof bc !== 'undefined') {
                bc.postMessage({ player: '1', balls: b1 });
                bc.postMessage({ player: '2', balls: b2 });
            }
        }

        if (typeof updateScoreControlAvailability === 'function') {
            updateScoreControlAvailability();
        }
        if (typeof updateCallGameButton === 'function') {
            updateCallGameButton();
        }
    }

    /**
     * Apply stats-window edits to the live in-progress match (racks/frames/balls/breaks).
     * Keeps the match active; career rack/ball deltas are rewritten from the new rows.
     */
    async function savePendingMatchEdit(matchPayload) {
        const match = getEditablePendingMatch();
        if (!match || !matchPayload || matchPayload.id !== match.id) {
            throw new Error('No in-progress match to edit.');
        }
        if (matchPayload.player1Id !== match.player1Id || matchPayload.player2Id !== match.player2Id) {
            throw new Error('Cannot change players on an in-progress match.');
        }

        const gameType = match.gameType || activeMatchSession.gameType || 'game1';
        const includeBalls = gameTypeHasBallScoring(gameType);
        const ballsP1 = includeBalls ? clampScore(matchPayload.ballsP1) : 0;
        const ballsP2 = includeBalls ? clampScore(matchPayload.ballsP2) : 0;

        await undoAllRacksInMatch(match);

        const racks = normalizeRacksPayload(
            matchPayload.racks || [],
            match.player1Id,
            match.player2Id,
            gameType
        );
        const scoreP1 = racks.filter(function (r) { return r.winnerId === match.player1Id; }).length;
        const scoreP2 = racks.filter(function (r) { return r.winnerId === match.player2Id; }).length;

        match.racks = racks;
        match.balls = includeBalls ? synthesizeBallsFromCounts(match, ballsP1, ballsP2) : [];
        match.finalScore = { p1: scoreP1, p2: scoreP2 };
        match.status = 'active';
        match.winnerId = null;
        match.completedAt = null;
        if (matchPayload.gameInfo != null) {
            match.gameInfo = String(matchPayload.gameInfo).trim();
            activeMatchSession.gameInfo = match.gameInfo;
        }
        refreshMatchHighestBreakFromRacks(match);

        for (let i = 0; i < racks.length; i++) {
            const rack = racks[i];
            if (!rack.winnerId) {
                continue;
            }
            const loserId = rack.winnerId === match.player1Id ? match.player2Id : match.player1Id;
            await applyRackDelta(rack.winnerId, loserId, gameType, 1);
            const hb = rack.winnerId === match.player1Id
                ? clampScore(rack.highestBreakP1)
                : clampScore(rack.highestBreakP2);
            if (hb > 0) {
                await applyHighestBreakIfBetter(rack.winnerId, hb, gameType);
            }
            if (isSnookerGameType(gameType)) {
                const otherHb = rack.winnerId === match.player1Id
                    ? clampScore(rack.highestBreakP2)
                    : clampScore(rack.highestBreakP1);
                const otherId = rack.winnerId === match.player1Id ? match.player2Id : match.player1Id;
                if (otherHb > 0) {
                    await applyHighestBreakIfBetter(otherId, otherHb, gameType);
                }
            }
        }

        if (includeBalls && match.balls) {
            for (let j = 0; j < match.balls.length; j++) {
                const ball = match.balls[j];
                const loserId = ball.winnerId === match.player1Id ? match.player2Id : match.player1Id;
                await applyBallDelta(ball.winnerId, loserId, gameType, 1);
            }
        }

        activeMatchSession.status = 'active';
        activeMatchSession.matchCompletedRecorded = false;
        activeMatchSession.lastRackWinnerSlot = racks.length > 0
            ? (racks[racks.length - 1].winnerId === match.player1Id ? '1' : '2')
            : null;
        activeMatchSession.lastBallWinnerSlot = match.balls && match.balls.length > 0
            ? (match.balls[match.balls.length - 1].winnerId === match.player1Id ? '1' : '2')
            : null;

        if (isStraightPoolGameType(gameType)) {
            recomputeStraightPoolRunFromRacks();
            if (activeMatchSession.straightPoolRunSlot && activeMatchSession.straightPoolRunLength > 0) {
                const runIds = getSlotPlayerIds(activeMatchSession.straightPoolRunSlot);
                await applyHighestBreakIfBetter(
                    runIds.winnerId,
                    activeMatchSession.straightPoolRunLength,
                    'game4'
                );
            }
        } else {
            activeMatchSession.straightPoolRunSlot = null;
            activeMatchSession.straightPoolRunLength = 0;
        }

        syncLiveScoreboardFromMatch(match);
        await persistPendingSession();

        if (isSnookerGameType(gameType)) {
            await checkSnookerMatchCompletion(scoreP1, scoreP2);
        } else {
            await checkMatchCompletion();
        }
        broadcastOverlayStatsIfEnabled();
        return match;
    }

    async function discardPendingMatch() {
        const match = getEditablePendingMatch();
        if (!match) {
            return;
        }
        const p1Id = match.player1Id;
        const p2Id = match.player2Id;

        // Reverse live rack/ball deltas, then rebuild career stats from completed matches only
        // so highest breaks and any residual frame counts from this match are fully cleared.
        await abandonActivePendingMatch();
        await resetSessionState();
        clearLiveMatchScoreboardState();

        if (p1Id) {
            await recomputePlayerStats(p1Id);
        }
        if (p2Id && p2Id !== p1Id) {
            await recomputePlayerStats(p2Id);
        }
        broadcastOverlayStatsIfEnabled();
    }

    function normalizeRacksPayload(rawRacks, player1Id, player2Id, gameType) {
        const timestamp = new Date().toISOString();
        const isSnooker = isSnookerGameType(gameType);
        const isStraight = isStraightPoolGameType(gameType);
        const racks = [];
        (rawRacks || []).forEach(function (raw, index) {
            if (!raw) {
                return;
            }
            let winnerId = raw.winnerId || '';
            if (winnerId === '1' || winnerId === 1) {
                winnerId = player1Id;
            } else if (winnerId === '2' || winnerId === 2) {
                winnerId = player2Id;
            }
            if (winnerId !== player1Id && winnerId !== player2Id) {
                return;
            }
            const entry = {
                rackNumber: index + 1,
                winnerId: winnerId,
                timestamp: raw.timestamp || timestamp
            };
            if (isSnooker) {
                const p1Pts = clampScore(raw.frameScore && raw.frameScore.p1 != null ? raw.frameScore.p1 : raw.pointsP1);
                const p2Pts = clampScore(raw.frameScore && raw.frameScore.p2 != null ? raw.frameScore.p2 : raw.pointsP2);
                entry.frameScore = { p1: p1Pts, p2: p2Pts };
                entry.highestBreakP1 = clampScore(raw.highestBreakP1);
                entry.highestBreakP2 = clampScore(raw.highestBreakP2);
            } else if (isStraight) {
                entry.highestRunP1 = clampScore(
                    raw.highestRunP1 != null ? raw.highestRunP1 : raw.highestBreakP1
                );
                entry.highestRunP2 = clampScore(
                    raw.highestRunP2 != null ? raw.highestRunP2 : raw.highestBreakP2
                );
            }
            entry.foulsP1 = clampScore(raw.foulsP1);
            entry.foulsP2 = clampScore(raw.foulsP2);
            racks.push(entry);
        });
        return racks;
    }

    async function deleteMatch(matchId) {
        const match = await getMatch(matchId);
        if (!match) {
            return;
        }

        if (activeMatchSession.matchId === matchId) {
            await resetSessionState();
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

        const matches = await getStoredMatchesForPlayer(playerId);
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
        const matches = await getStoredMatchesForPlayer(playerId);
        const opponentIds = {};

        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            if (activeMatchSession.matchId === m.id) {
                await resetSessionState();
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

    async function importData(data) {
        if (!data || !Array.isArray(data.players) || !Array.isArray(data.matches)) {
            throw new Error('Invalid import file format.');
        }
        if (data.schemaVersion && data.schemaVersion > SCHEMA_VERSION) {
            const proceed = confirm(
                'Import file uses a newer schema (v' + data.schemaVersion + '). Continue anyway?'
            );
            if (!proceed) {
                return { cancelled: true, players: 0, matches: 0 };
            }
        }

        await clearAllStats();

        let playersImported = 0;
        let matchesImported = 0;
        const usedNormalized = {};

        for (let i = 0; i < data.players.length; i++) {
            const shaped = ensurePlayerRecordShape(data.players[i]);
            if (!shaped) {
                continue;
            }
            // Keep unique nameNormalized index happy if file has duplicates.
            let uniqueNorm = shaped.nameNormalized;
            let suffix = 2;
            while (usedNormalized[uniqueNorm]) {
                uniqueNorm = shaped.nameNormalized + '-' + suffix;
                suffix++;
            }
            shaped.nameNormalized = uniqueNorm;
            usedNormalized[uniqueNorm] = true;
            await putPlayer(shaped);
            playersImported++;
        }

        for (let j = 0; j < data.matches.length; j++) {
            const match = data.matches[j];
            if (!match || !match.id) {
                continue;
            }
            await putMatch(match);
            matchesImported++;
        }

        await setMeta('schemaVersion', SCHEMA_VERSION);
        return { players: playersImported, matches: matchesImported };
    }

    async function clearAllStats() {
        await openDatabase();
        const dbTx = tx(['players', 'matches'], 'readwrite');
        await promisifyRequest(dbTx.objectStore('players').clear());
        await promisifyRequest(dbTx.objectStore('matches').clear());
        await resetSessionState();
        try {
            await clearAllPendingSessionMeta();
        } catch (err) {
            console.error('Clear pending session error:', err);
        }
    }

    function migrateOverlayStorage() {
        // Legacy flag must not auto-enable H2H on refresh; discard it.
        if (localStorage.getItem('h2hOverlayEnabled')) {
            localStorage.removeItem('h2hOverlayEnabled');
        }
        const instanceId = getInstanceId();
        if (!instanceId || typeof setStorageItem !== 'function') {
            return;
        }
        const prefix = instanceId + '_';
        [OVERLAY_STATS_MODE_KEY, OVERLAY_STATS_PAYLOAD_KEY].forEach(function (key) {
            if (localStorage.getItem(prefix + key) != null) {
                return;
            }
            const legacy = localStorage.getItem(key);
            if (legacy != null) {
                localStorage.setItem(prefix + key, legacy);
                localStorage.removeItem(key);
            }
        });
    }

    function getOverlayStatsMode() {
        migrateOverlayStorage();
        if (typeof getStorageItem === 'function') {
            return getStorageItem(OVERLAY_STATS_MODE_KEY, '') || '';
        }
        return localStorage.getItem(OVERLAY_STATS_MODE_KEY) || '';
    }

    function setOverlayStatsMode(mode) {
        if (typeof setStorageItem === 'function') {
            setStorageItem(OVERLAY_STATS_MODE_KEY, mode || '');
        } else {
            localStorage.setItem(OVERLAY_STATS_MODE_KEY, mode || '');
        }
    }

    function readOverlayStatsPayloadRaw() {
        migrateOverlayStorage();
        if (typeof getStorageItem === 'function') {
            return getStorageItem(OVERLAY_STATS_PAYLOAD_KEY);
        }
        return localStorage.getItem(OVERLAY_STATS_PAYLOAD_KEY);
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
            if (player && normalizeName(player.name) === normalizeName(name)) {
                return player.id;
            }
        }
        const sessionId = slot === '1' ? activeMatchSession.player1Id : activeMatchSession.player2Id;
        const sessionName = slot === '1' ? activeMatchSession.player1Name : activeMatchSession.player2Name;
        if (sessionId && sessionName && normalizeName(sessionName) === normalizeName(name)) {
            return sessionId;
        }
        const found = await lookupPlayer(name);
        return found ? found.id : null;
    }

    async function buildPlayerOverlayPayload(slot) {
        const mode = slot === '1' ? 'p1' : 'p2';
        const inputId = slot === '1' ? 'p1Name' : 'p2Name';
        const name = truncateName(document.getElementById(inputId)?.value || '');
        const visible = getOverlayStatsMode() === mode;
        const gameType = getActiveGameType();

        if (!name) {
            return { visible: visible, mode: mode, title: 'Player ' + slot, emptyMessage: 'First tracked game' };
        }

        const playerId = await resolvePlayerIdForSlot(slot);
        if (!playerId) {
            return { visible: visible, mode: mode, title: name, emptyMessage: 'First tracked game' };
        }

        const player = await getPlayer(playerId);
        const typeStats = readTypeStats(player, gameType);
        if (!player || (!typeStatsHaveActivity(typeStats) &&
            readLiveCurrentBreakForSlot(slot) <= 0 &&
            readLivePossibleBreakForSlot(slot) <= 0 &&
            readMatchScopedStatsForSlot(slot).ballsPotted <= 0 &&
            readMatchScopedStatsForSlot(slot).highestBreak <= 0 &&
            readMatchScopedStatsForSlot(slot).highestRun <= 0 &&
            readMatchScopedStatsForSlot(slot).fouls <= 0)) {
            return {
                visible: visible,
                mode: mode,
                title: player ? player.name : name,
                emptyMessage: 'First tracked ' + (GAME_TYPE_LABELS[gameType] || 'game')
            };
        }

        const matches = (await getMatchesForPlayer(playerId)).filter(function (m) {
            return m.gameType === gameType;
        });
        const matchStats = readMatchScopedStatsForSlot(slot);
        const currentBreak = readLiveCurrentBreakForSlot(slot);
        const possibleBreak = readLivePossibleBreakForSlot(slot);
        const scoreMargin = readLiveScoreMarginForSlot(slot);
        return {
            visible: visible,
            mode: mode,
            title: player.name,
            gameType: gameType,
            gameTypeLabel: GAME_TYPE_LABELS[gameType] || gameType,
            // Matches / racks won are H2H-only on the browser overlay.
            showGamesWL: false,
            showRacksWL: false,
            showWinStreak: overlayStatEnabled(gameType, 'winStreak'),
            showBalls: overlayStatEnabled(gameType, 'ballsPotted'),
            showFouls: overlayStatEnabled(gameType, 'fouls'),
            showHighestBreak: overlayStatEnabled(gameType, isStraightPoolGameType(gameType) ? 'highestRun' : 'highestBreak'),
            highestBreakLabel: isStraightPoolGameType(gameType) ? highestRunLabel(gameType) : highestBreakLabel(gameType),
            showCurrentBreak: overlayStatEnabled(gameType, 'currentBreak'),
            currentBreakLabel: currentBreakLabel(gameType),
            currentBreak: currentBreak,
            showPossibleBreak: overlayStatEnabled(gameType, 'possibleBreak'),
            possibleBreakLabel: 'Possible Break',
            possibleBreak: possibleBreak,
            showScoreMargin: overlayStatEnabled(gameType, 'scoreMargin') && !!scoreMargin.showMargin,
            scoreMarginLabel: 'Difference',
            scoreMargin: scoreMargin.display,
            scoreMarginDiff: scoreMargin.diff,
            scoreMarginRemaining: scoreMargin.remaining,
            scoreMarginCritical: !!scoreMargin.critical,
            scoreMarginSafe: !!scoreMargin.safe,
            showPointsRemaining: overlayStatEnabled(gameType, 'pointsRemaining') && !!scoreMargin.showMargin,
            pointsRemainingLabel: 'Points Remaining',
            pointsRemaining: scoreMargin.remaining,
            pointsRemainingTone: scoreMargin.pointsRemainingTone || '',
            showBreakAndRun: overlayStatEnabled(gameType, 'breakAndRun'),
            showTableRun: overlayStatEnabled(gameType, 'tableRun'),
            rackLabel: rackOrFrameLabel(false, gameType),
            racksLabel: rackOrFrameLabel(true, gameType),
            gamesWL: formatWL(typeStats.gamesWon, typeStats.gamesLost),
            racksWL: formatWL(typeStats.racksWon, typeStats.racksLost),
            // Match-scoped only — cleared when End Match / Clear Game starts a new session
            ballsPotted: matchStats.ballsPotted || 0,
            fouls: matchStats.fouls || 0,
            highestBreak: isStraightPoolGameType(gameType)
                ? (matchStats.highestRun || 0)
                : (matchStats.highestBreak || 0),
            breakAndRuns: typeStats.breakAndRuns || 0,
            tableRuns: typeStats.tableRuns || 0,
            winRate: getWinPct(typeStats.gamesWon, typeStats.gamesLost),
            rackWinRate: getWinPct(typeStats.racksWon, typeStats.racksLost),
            winStreak: getCurrentWinStreak(playerId, matches)
        };
    }

    async function buildH2HOverlayPayload() {
        const visible = getOverlayStatsMode() === 'h2h';
        const p1Name = truncateName(document.getElementById('p1Name')?.value || '');
        const p2Name = truncateName(document.getElementById('p2Name')?.value || '');
        const gameType = getActiveGameType();

        if (!p1Name || !p2Name) {
            return { visible: visible, mode: 'h2h', title: 'Head to Head', emptyMessage: 'First match-up' };
        }

        const p1Id = await resolvePlayerIdForSlot('1');
        const p2Id = await resolvePlayerIdForSlot('2');

        if (!p1Id || !p2Id) {
            return { visible: visible, mode: 'h2h', title: 'Head to Head', emptyMessage: 'First match-up' };
        }

        const h2h = await getHeadToHead(p1Id, p2Id, { gameType: gameType });
        if (!h2h) {
            return { visible: visible, mode: 'h2h', title: 'Head to Head', emptyMessage: 'First match-up' };
        }
        if (!h2hSummaryHasDisplayableActivity(h2h, p1Id, p2Id)) {
            return {
                visible: visible,
                mode: 'h2h',
                title: 'Head to Head',
                emptyMessage: 'First ' + (GAME_TYPE_LABELS[gameType] || 'game') + ' match-up'
            };
        }

        const p1TypeStats = readTypeStats(h2h.player1, gameType);
        const p2TypeStats = readTypeStats(h2h.player2, gameType);

        return {
            visible: visible,
            mode: 'h2h',
            title: 'Head to Head',
            gameType: gameType,
            gameTypeLabel: GAME_TYPE_LABELS[gameType] || gameType,
            showGamesWL: overlayStatEnabled(gameType, 'gamesWL'),
            showRacksWL: overlayStatEnabled(gameType, 'racksWL'),
            showBalls: overlayStatEnabled(gameType, 'ballsPotted'),
            showFouls: overlayStatEnabled(gameType, 'fouls'),
            showHighestBreak: overlayStatEnabled(gameType, isStraightPoolGameType(gameType) ? 'highestRun' : 'highestBreak'),
            highestBreakLabel: isStraightPoolGameType(gameType) ? highestRunLabel(gameType) : highestBreakLabel(gameType),
            showBreakAndRun: overlayStatEnabled(gameType, 'breakAndRun'),
            showTableRun: overlayStatEnabled(gameType, 'tableRun'),
            rackLabel: rackOrFrameLabel(false, gameType),
            racksLabel: rackOrFrameLabel(true, gameType),
            p1Name: h2h.player1.name,
            p2Name: h2h.player2.name,
            p1Games: h2h.gamesWon[p1Id] || 0,
            p2Games: h2h.gamesWon[p2Id] || 0,
            p1Racks: h2h.racksWon[p1Id] || 0,
            p2Racks: h2h.racksWon[p2Id] || 0,
            p1Balls: h2h.ballsWon[p1Id] || 0,
            p2Balls: h2h.ballsWon[p2Id] || 0,
            p1Fouls: (h2h.fouls && h2h.fouls[p1Id]) || 0,
            p2Fouls: (h2h.fouls && h2h.fouls[p2Id]) || 0,
            p1HighestBreak: isStraightPoolGameType(gameType)
                ? (h2h.highestRun[p1Id] || 0)
                : (h2h.highestBreak[p1Id] || 0),
            p2HighestBreak: isStraightPoolGameType(gameType)
                ? (h2h.highestRun[p2Id] || 0)
                : (h2h.highestBreak[p2Id] || 0),
            p1BreakAndRuns: p1TypeStats.breakAndRuns || 0,
            p2BreakAndRuns: p2TypeStats.breakAndRuns || 0,
            p1TableRuns: p1TypeStats.tableRuns || 0,
            p2TableRuns: p2TypeStats.tableRuns || 0
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

    function onScoreModeChanged() {
        broadcastOverlayStatsIfEnabled();
        renderStatsVisibilityPanel();
        const modal = document.getElementById('statsModal');
        if (modal && modal.style.display === 'block') {
            refreshStatsUI();
        }
    }

    function persistOverlayStatsPayload(payload) {
        try {
            const json = JSON.stringify(payload || { visible: false });
            if (typeof setStorageItem === 'function') {
                setStorageItem(OVERLAY_STATS_PAYLOAD_KEY, json);
            } else {
                localStorage.setItem(OVERLAY_STATS_PAYLOAD_KEY, json);
            }
        } catch (err) {
            console.warn('Failed to persist overlay stats payload:', err);
        }
    }

    /** Re-read live visit stats at publish time (after async DB work may have lagged). */
    function applyLiveOverlayFields(payload) {
        if (!payload || !payload.visible) {
            return payload;
        }
        const gameType = payload.gameType || getActiveGameType();
        if (payload.mode !== 'p1' && payload.mode !== 'p2') {
            return payload;
        }
        const slot = payload.mode === 'p1' ? '1' : '2';
        if (isSnookerGameType(gameType) || isStraightPoolGameType(gameType)) {
            payload.currentBreak = readLiveCurrentBreakForSlot(slot);
        }
        if (isSnookerGameType(gameType)) {
            payload.possibleBreak = readLivePossibleBreakForSlot(slot);
            const scoreMargin = readLiveScoreMarginForSlot(slot);
            payload.showScoreMargin = overlayStatEnabled(gameType, 'scoreMargin') && !!scoreMargin.showMargin;
            payload.scoreMarginLabel = 'Difference';
            payload.scoreMargin = scoreMargin.display;
            payload.scoreMarginDiff = scoreMargin.diff;
            payload.scoreMarginRemaining = scoreMargin.remaining;
            payload.scoreMarginCritical = !!scoreMargin.critical;
            payload.scoreMarginSafe = !!scoreMargin.safe;
            payload.showPointsRemaining = overlayStatEnabled(gameType, 'pointsRemaining') && !!scoreMargin.showMargin;
            payload.pointsRemainingLabel = 'Points Remaining';
            payload.pointsRemaining = scoreMargin.remaining;
            payload.pointsRemainingTone = scoreMargin.pointsRemainingTone || '';
        }
        const matchStats = readMatchScopedStatsForSlot(slot);
        payload.ballsPotted = matchStats.ballsPotted || 0;
        payload.fouls = matchStats.fouls || 0;
        payload.showFouls = overlayStatEnabled(gameType, 'fouls');
        payload.highestBreak = isStraightPoolGameType(gameType)
            ? (matchStats.highestRun || 0)
            : (matchStats.highestBreak || 0);
        return payload;
    }

    let overlayBroadcastGeneration = 0;
    let overlayRebuildTimer = null;

    /** Push live snooker visit stats immediately (no async DB wait). */
    function patchAndPublishLiveOverlayFields() {
        const mode = getOverlayStatsMode();
        if (mode !== 'p1' && mode !== 'p2') {
            return false;
        }
        let payload;
        try {
            const raw = readOverlayStatsPayloadRaw();
            payload = raw ? JSON.parse(raw) : null;
        } catch (err) {
            return false;
        }
        if (!payload || !payload.visible) {
            return false;
        }
        payload = applyLiveOverlayFields(payload);
        persistOverlayStatsPayload(payload);
        if (typeof bc !== 'undefined') {
            bc.postMessage({ overlayStats: payload });
        }
        return true;
    }

    function scheduleOverlayStatsRebuild() {
        clearTimeout(overlayRebuildTimer);
        const gen = overlayBroadcastGeneration;
        overlayRebuildTimer = setTimeout(function () {
            if (gen !== overlayBroadcastGeneration) {
                return;
            }
            buildOverlayStatsPayload().then(function (payload) {
                if (gen !== overlayBroadcastGeneration) {
                    return;
                }
                payload = applyLiveOverlayFields(payload);
                persistOverlayStatsPayload(payload);
                if (typeof bc !== 'undefined') {
                    bc.postMessage({ overlayStats: payload });
                }
            }).catch(function (err) {
                console.error('Overlay stats rebuild error:', err);
            });
        }, 120);
    }

    /** Snooker pots: sync live break fields first, then debounced full rebuild for balls potted etc. */
    function publishSnookerOverlayLiveStats() {
        overlayBroadcastGeneration += 1;
        if (!patchAndPublishLiveOverlayFields()) {
            broadcastOverlayStatsIfEnabled();
            return;
        }
        scheduleOverlayStatsRebuild();
    }

    function maybeRefreshStatsModalH2H() {
        const modal = document.getElementById('statsModal');
        if (!modal || modal.style.display !== 'block') {
            return;
        }
        const h2hPanel = document.getElementById('statsTab-h2h');
        if (h2hPanel && !h2hPanel.classList.contains('noShow')) {
            refreshH2HView();
        }
    }

    function broadcastOverlayStatsIfEnabled() {
        const gen = ++overlayBroadcastGeneration;
        buildOverlayStatsPayload().then(function (payload) {
            if (gen !== overlayBroadcastGeneration) {
                return;
            }
            payload = applyLiveOverlayFields(payload);
            persistOverlayStatsPayload(payload);
            if (typeof bc !== 'undefined') {
                bc.postMessage({ overlayStats: payload });
            }
            maybeRefreshStatsModalH2H();
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
            // Any edit invalidates a previously selected player id
            input.removeAttribute('data-player-id');
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                refreshAutocomplete(slot, input, list);
            }, 150);
        });

        input.addEventListener('focus', function () {
            refreshAutocomplete(slot, input, list);
        });

        input.addEventListener('blur', function () {
            setTimeout(function () {
                if (typeof postNames === 'function') {
                    postNames();
                }
            }, 0);
        });

        input.addEventListener('dblclick', function (e) {
            e.preventDefault();
            input.select();
            refreshAutocomplete(slot, input, list, { browseAll: true });
        });

        input.addEventListener('keydown', function (e) {
            const state = autocompleteState[slot];
            const listVisible = !list.classList.contains('noShow');
            if (!listVisible) {
                return;
            }

            const navCount = getAutocompleteNavCount(state);
            if (navCount === 0) {
                if (e.key === 'Escape') {
                    list.classList.add('noShow');
                }
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (state.activeIndex < 0) {
                    state.activeIndex = 0;
                } else {
                    state.activeIndex = Math.min(state.activeIndex + 1, navCount - 1);
                }
                highlightAutocompleteItem(list, state.activeIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (state.activeIndex < 0) {
                    state.activeIndex = navCount - 1;
                } else {
                    state.activeIndex = Math.max(state.activeIndex - 1, 0);
                }
                highlightAutocompleteItem(list, state.activeIndex);
            } else if (e.key === 'Enter' && state.activeIndex >= 0) {
                e.preventDefault();
                activateAutocompleteIndex(slot, state.activeIndex, input, list);
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

    function getAutocompleteNavCount(state) {
        if (!state) {
            return 0;
        }
        return (state.createNewName ? 1 : 0) + (state.results ? state.results.length : 0);
    }

    function activateAutocompleteIndex(slot, index, input, list) {
        const state = autocompleteState[slot];
        if (!state || index < 0) {
            return;
        }
        if (state.createNewName) {
            if (index === 0) {
                createAndSelectAutocompletePlayer(slot, state.createNewName, input, list);
                return;
            }
            const player = state.results[index - 1];
            if (player) {
                selectAutocompletePlayer(slot, player, input, list);
            }
            return;
        }
        const player = state.results[index];
        if (player) {
            selectAutocompletePlayer(slot, player, input, list);
        }
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

    async function refreshAutocomplete(slot, input, list, options) {
        const browseAll = options && options.browseAll;
        const query = input.value.trim();
        if (!query && !browseAll) {
            autocompleteState[slot].createNewName = null;
            list.classList.remove('autocomplete-browse');
            list.classList.add('noShow');
            list.innerHTML = '';
            return;
        }

        try {
            const results = browseAll
                ? await searchPlayers('', 250)
                : await searchPlayers(query, 8);
            const queryNorm = normalizeName(query);
            const exactExists = !!(queryNorm && results.some(function (p) {
                return (p.nameNormalized || normalizeName(p.name)) === queryNorm;
            }));
            // Offer create whenever the typed name is not an exact existing player
            // (e.g. "Billy" while "Billy Strings" exists)
            const createName = (!browseAll && query && !exactExists) ? truncateName(query) : null;

            autocompleteState[slot].results = results;
            autocompleteState[slot].createNewName = createName;
            autocompleteState[slot].activeIndex = -1;
            list.innerHTML = '';
            list.classList.toggle('autocomplete-browse', !!browseAll);

            if (browseAll && results.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'autocomplete-item autocomplete-new';
                empty.textContent = 'No saved players yet.';
                list.appendChild(empty);
                list.classList.remove('noShow');
                return;
            }

            if (createName) {
                const createItem = document.createElement('div');
                createItem.className = 'autocomplete-item autocomplete-new';
                createItem.dataset.index = '0';
                createItem.textContent = 'Create new player: "' + createName + '"';
                createItem.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    createAndSelectAutocompletePlayer(slot, createName, input, list);
                });
                list.appendChild(createItem);
            }

            results.forEach(function (player, index) {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.dataset.index = String(createName ? index + 1 : index);
                item.innerHTML = '<span class="autocomplete-name">' + escapeHtml(player.name) + '</span>' +
                    '<span class="autocomplete-preview">' + formatPlayerPreview(player.stats) + '</span>';
                item.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    selectAutocompletePlayer(slot, player, input, list);
                });
                list.appendChild(item);
            });

            if (createName || results.length > 0) {
                list.classList.remove('noShow');
            } else {
                list.classList.add('noShow');
            }
            if (browseAll) {
                list.scrollTop = 0;
            }
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

    /** Match history: date + time (minutes), locale-aware. */
    function formatDateTime(iso) {
        if (!iso) {
            return '\u2014';
        }
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) {
                return iso;
            }
            return d.toLocaleString(undefined, {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        } catch (e) {
            return iso;
        }
    }

    function rackFrameWord(gameType, plural) {
        return isSnookerGameType(gameType) ? (plural ? 'Frames' : 'Frame') : (plural ? 'Racks' : 'Rack');
    }

    function winnerDisplayName(match, winnerId) {
        if (!winnerId) {
            return '\u2014';
        }
        if (winnerId === match.player1Id) {
            return match.player1Name || 'Player 1';
        }
        if (winnerId === match.player2Id) {
            return match.player2Name || 'Player 2';
        }
        return '\u2014';
    }

    /** Per-rack/frame breakdown for match history (snooker includes frame points + highest breaks). */
    function renderMatchRackBreakdown(match, options) {
        const racks = match.racks || [];
        if (racks.length === 0) {
            return '';
        }
        const opts = options || {};
        const viewerId = opts.viewerPlayerId || null;
        const isSnooker = isSnookerGameType(match.gameType);
        const isStraight = isStraightPoolGameType(match.gameType);
        const p1Name = escapeHtml(match.player1Name || 'Player 1');
        const p2Name = escapeHtml(match.player2Name || 'Player 2');

        if (isSnooker) {
            const neutral = !viewerId;
            const header = neutral
                ? '<tr><th>#</th><th>Points</th><th>HB ' + p1Name + '</th><th>HB ' + p2Name +
                    '</th><th>Fouls ' + p1Name + '</th><th>Fouls ' + p2Name + '</th><th>Winner</th></tr>'
                : '<tr><th>#</th><th>Points</th><th>HB</th><th>Fouls</th><th>Result</th></tr>';
            const rows = racks.map(function (r) {
                const num = r.rackNumber || '';
                const fs = r.frameScore || { p1: 0, p2: 0 };
                const hb1 = parseInt(r.highestBreakP1, 10) || 0;
                const hb2 = parseInt(r.highestBreakP2, 10) || 0;
                const f1 = parseInt(r.foulsP1, 10) || 0;
                const f2 = parseInt(r.foulsP2, 10) || 0;
                if (neutral) {
                    return '<tr><td>' + num + '</td><td>' + fs.p1 + '\u2013' + fs.p2 + '</td><td>' + hb1 +
                        '</td><td>' + hb2 + '</td><td>' + f1 + '</td><td>' + f2 + '</td><td>' +
                        escapeHtml(winnerDisplayName(match, r.winnerId)) + '</td></tr>';
                }
                const viewerIsP1 = match.player1Id === viewerId;
                const pts = viewerIsP1 ? (fs.p1 + '\u2013' + fs.p2) : (fs.p2 + '\u2013' + fs.p1);
                const hb = viewerIsP1 ? (hb1 + '\u2013' + hb2) : (hb2 + '\u2013' + hb1);
                const fouls = viewerIsP1 ? (f1 + '\u2013' + f2) : (f2 + '\u2013' + f1);
                let result = '\u2014';
                if (r.winnerId) {
                    result = r.winnerId === viewerId ? 'Won' : 'Lost';
                }
                return '<tr><td>' + num + '</td><td>' + pts + '</td><td>' + hb + '</td><td>' + fouls +
                    '</td><td>' + result + '</td></tr>';
            }).join('');
            return '<div class="stats-match-racks-wrap">' +
                '<table class="stats-table stats-rack-detail-table"><thead>' + header + '</thead><tbody>' +
                rows + '</tbody></table></div>';
        }

        if (isStraight) {
            const neutral = !viewerId;
            const header = neutral
                ? '<tr><th>#</th><th>Run ' + p1Name + '</th><th>Run ' + p2Name + '</th><th>Winner</th></tr>'
                : '<tr><th>#</th><th>Run</th><th>Result</th></tr>';
            const rows = racks.map(function (r) {
                const num = r.rackNumber || '';
                const hb1 = parseInt(r.highestBreakP1, 10) || 0;
                const hb2 = parseInt(r.highestBreakP2, 10) || 0;
                if (neutral) {
                    return '<tr><td>' + num + '</td><td>' + hb1 + '</td><td>' + hb2 + '</td><td>' +
                        escapeHtml(winnerDisplayName(match, r.winnerId)) + '</td></tr>';
                }
                const viewerIsP1 = match.player1Id === viewerId;
                const run = viewerIsP1 ? (hb1 + '\u2013' + hb2) : (hb2 + '\u2013' + hb1);
                let result = '\u2014';
                if (r.winnerId) {
                    result = r.winnerId === viewerId ? 'Won' : 'Lost';
                }
                return '<tr><td>' + num + '</td><td>' + run + '</td><td>' + result + '</td></tr>';
            }).join('');
            return '<div class="stats-match-racks-wrap">' +
                '<table class="stats-table stats-rack-detail-table"><thead>' + header + '</thead><tbody>' +
                rows + '</tbody></table></div>';
        }

        const header = viewerId
            ? '<tr><th>#</th><th>Result</th></tr>'
            : '<tr><th>#</th><th>Winner</th></tr>';
        const rows = racks.map(function (r) {
            const num = r.rackNumber || '';
            if (!viewerId) {
                return '<tr><td>' + num + '</td><td>' + escapeHtml(winnerDisplayName(match, r.winnerId)) + '</td></tr>';
            }
            let result = '\u2014';
            if (r.winnerId) {
                result = r.winnerId === viewerId ? 'Won' : 'Lost';
            }
            return '<tr><td>' + num + '</td><td>' + result + '</td></tr>';
        }).join('');
        return '<div class="stats-match-racks-wrap">' +
            '<table class="stats-table stats-rack-detail-table"><thead>' + header + '</thead><tbody>' +
            rows + '</tbody></table></div>';
    }

    function formatMatchGameCell(match) {
        const label = GAME_TYPE_LABELS[match.gameType] || match.gameType;
        const info = (match.gameInfo || '').trim();
        if (!info) {
            return label;
        }
        return label + '<div class="stats-match-game-info">' + escapeHtml(info) + '</div>';
    }

    function renderMatchHistoryRows(matches, options) {
        const opts = options || {};
        const viewerId = opts.viewerPlayerId;
        const h2h = opts.h2h;
        const colspan = opts.colspan || 5;

        if (matches.length === 0) {
            return '<tr><td colspan="' + colspan + '" class="stats-empty">No matches recorded.</td></tr>';
        }

        return matches.map(function (m) {
            const inProgress = m.status !== 'completed';
            const score = m.finalScore || { p1: 0, p2: 0 };
            const dateLabel = inProgress
                ? ('In progress' + (m.startedAt ? ' \u00b7 ' + formatDateTime(m.startedAt) : ''))
                : formatDateTime(m.completedAt || m.startedAt);
            let mainRow;
            if (h2h) {
                const id1 = h2h.id1;
                const p1Score = m.player1Id === id1 ? score.p1 : score.p2;
                const p2Score = m.player1Id === id1 ? score.p2 : score.p1;
                mainRow = '<tr class="stats-match-row"><td>' + dateLabel + '</td>' +
                    '<td>' + formatMatchGameCell(m) + '</td>' +
                    '<td>' + escapeHtml(h2h.name1) + ' ' + p1Score + ' - ' + p2Score + ' ' + escapeHtml(h2h.name2) + '</td>' +
                    renderMatchActionButtons(m.id) + '</tr>';
            } else {
                const opponent = m.player1Id === viewerId ? m.player2Name : m.player1Name;
                const viewerScore = m.player1Id === viewerId ? score.p1 : score.p2;
                const oppScore = m.player1Id === viewerId ? score.p2 : score.p1;
                mainRow = '<tr class="stats-match-row"><td>' + dateLabel + '</td>' +
                    '<td>' + escapeHtml(opponent) + '</td>' +
                    '<td>' + formatMatchGameCell(m) + '</td>' +
                    '<td>' + viewerScore + ' - ' + oppScore + '</td>' +
                    renderMatchActionButtons(m.id) + '</tr>';
            }

            const breakdown = renderMatchRackBreakdown(m, h2h ? {} : { viewerPlayerId: viewerId });
            const detailRow = breakdown
                ? '<tr class="stats-match-racks-row"><td colspan="' + colspan + '">' + breakdown + '</td></tr>'
                : '';
            return mainRow + detailRow;
        }).join('');
    }

    // --- Stats Modal UI ---
    function renderMatchActionButtons(matchId) {
        return '<td class="stats-actions-col">' +
            '<button type="button" class="stats-edit-btn hover obs28 button" onclick="openMatchEditModal(\'' + matchId + '\')">Edit</button> ' +
            '<button type="button" class="stats-delete-btn hover obs28 button" onclick="confirmDeleteMatch(\'' + matchId + '\')">Del</button>' +
            '</td>';
    }

    let matchEditPlayerNames = { p1: 'Player 1', p2: 'Player 2' };

    function setMatchEditGameTypeLocked(locked) {
        const select = document.getElementById('statsMatchGameType');
        if (select) {
            select.disabled = !!locked;
        }
    }

    function populateMatchEditForm(match, options) {
        const opts = options || {};
        const inProgress = !!opts.inProgress;
        const modal = document.getElementById('statsMatchEditModal');
        const title = document.getElementById('statsMatchEditTitle');
        const deleteBtn = document.getElementById('statsMatchDeleteBtn');
        if (!modal || !match) {
            return;
        }

        modal.dataset.matchId = match.id || '';
        modal.dataset.player1Id = match.player1Id || '';
        modal.dataset.player2Id = match.player2Id || '';
        modal.dataset.inProgress = inProgress ? '1' : '';

        if (title) {
            title.textContent = inProgress ? 'Edit In-Progress Match' : 'Edit Match';
        }
        if (deleteBtn) {
            deleteBtn.classList.remove('noShow');
            deleteBtn.textContent = inProgress ? 'Discard Match' : 'Delete Match';
        }
        setMatchEditGameTypeLocked(inProgress);
        document.getElementById('statsMatchDate').value = dateInputFromIso(match.completedAt || match.startedAt);
        document.getElementById('statsMatchGameType').value = match.gameType || 'game1';
        const gameInfoInput = document.getElementById('statsMatchGameInfo');
        if (gameInfoInput) {
            gameInfoInput.value = match.gameInfo || '';
        }
        document.getElementById('statsMatchBallsP1').value = countBallsForPlayer(match, match.player1Id);
        document.getElementById('statsMatchBallsP2').value = countBallsForPlayer(match, match.player2Id);
        setMatchEditMode(false);
        renderMatchRacksEditor(match.racks || []);
        updateMatchBallFieldsVisibility();
        updateMatchScoreSummary();
        modal.style.display = 'block';
    }

    function openMatchEditModal(matchId, player1Id, player2Id) {
        const modal = document.getElementById('statsMatchEditModal');
        if (!modal) {
            return;
        }

        if (isCloudStatsMode()) {
            if (!matchId) {
                alert('Adding matches from the dock is not supported while CueSport Cloud is connected. Play a race on a dock to create matches, then edit them here.');
                return;
            }
            findCloudMatchById(matchId).then(function (match) {
                if (!match) {
                    alert('Match not found.');
                    return;
                }
                populateCloudMatchEditForm(match);
            }).catch(function (err) {
                alert('Failed to load match: ' + err.message);
            });
            return;
        }

        setMatchEditMode(false);
        const title = document.getElementById('statsMatchEditTitle');
        const deleteBtn = document.getElementById('statsMatchDeleteBtn');

        modal.dataset.matchId = matchId || '';
        modal.dataset.player1Id = player1Id || '';
        modal.dataset.player2Id = player2Id || '';
        modal.dataset.inProgress = '';
        modal.dataset.player1Name = '';
        modal.dataset.player2Name = '';

        if (matchId) {
            const pending = isEditablePendingMatchId(matchId) ? getEditablePendingMatch() : null;
            const loadPromise = pending
                ? Promise.resolve(pending)
                : getMatch(matchId);

            loadPromise.then(function (match) {
                if (!match) {
                    alert('Match not found.');
                    return;
                }
                return Promise.all([getPlayer(match.player1Id), getPlayer(match.player2Id)]).then(function (results) {
                    const p1 = results[0];
                    const p2 = results[1];
                    matchEditPlayerNames = {
                        p1: (p1 && p1.name) || match.player1Name || 'Player 1',
                        p2: (p2 && p2.name) || match.player2Name || 'Player 2'
                    };
                    populateMatchEditForm(match, { inProgress: !!pending });
                });
            }).catch(function (err) {
                alert('Failed to load match: ' + err.message);
            });
        } else {
            Promise.all([getPlayer(player1Id), getPlayer(player2Id)]).then(function (results) {
                const p1 = results[0];
                const p2 = results[1];
                matchEditPlayerNames = {
                    p1: (p1 && p1.name) || 'Player 1',
                    p2: (p2 && p2.name) || 'Player 2'
                };
                if (title) {
                    title.textContent = 'Add Match';
                }
                if (deleteBtn) {
                    deleteBtn.classList.add('noShow');
                    deleteBtn.textContent = 'Delete Match';
                }
                setMatchEditGameTypeLocked(false);
                document.getElementById('statsMatchDate').value = dateInputFromIso(new Date().toISOString());
                document.getElementById('statsMatchGameType').value = getActiveGameType();
                const gameInfoInput = document.getElementById('statsMatchGameInfo');
                const liveGameInfo = document.getElementById('gameInfoTxt');
                if (gameInfoInput) {
                    gameInfoInput.value = liveGameInfo ? (liveGameInfo.value || '').trim() : '';
                }
                document.getElementById('statsMatchBallsP1').value = 0;
                document.getElementById('statsMatchBallsP2').value = 0;
                renderMatchRacksEditor([]);
                updateMatchBallFieldsVisibility();
                updateMatchScoreSummary();
                modal.style.display = 'block';
            });
        }
    }

    function onStatsMatchGameTypeChange() {
        const modal = document.getElementById('statsMatchEditModal');
        if (modal && modal.dataset.cloud === '1') {
            syncMatchExtrasVisibilityForEdit();
            return;
        }
        const existing = collectMatchRacksFromEditor();
        renderMatchRacksEditor(existing);
        updateMatchBallFieldsVisibility();
        updateMatchScoreSummary();
    }

    function updateMatchBallFieldsVisibility() {
        const row = document.getElementById('statsMatchBallsRow');
        const select = document.getElementById('statsMatchGameType');
        if (!row) {
            return;
        }
        const show = gameTypeHasBallScoring(select && select.value);
        row.classList.toggle('noShow', !show);
        const p1Label = document.getElementById('statsMatchBallsP1Label');
        const p2Label = document.getElementById('statsMatchBallsP2Label');
        if (p1Label) {
            p1Label.textContent = 'Balls potted (' + matchEditPlayerNames.p1 + ', optional):';
        }
        if (p2Label) {
            p2Label.textContent = 'Balls potted (' + matchEditPlayerNames.p2 + ', optional):';
        }
        if (!show) {
            const p1 = document.getElementById('statsMatchBallsP1');
            const p2 = document.getElementById('statsMatchBallsP2');
            if (p1) {
                p1.value = 0;
            }
            if (p2) {
                p2.value = 0;
            }
        }
    }

    function updateMatchScoreSummary() {
        const summary = document.getElementById('statsMatchScoreSummary');
        if (!summary) {
            return;
        }
        const racks = collectMatchRacksFromEditor();
        let p1 = 0;
        let p2 = 0;
        racks.forEach(function (r) {
            if (r.winnerId === '1') {
                p1++;
            } else if (r.winnerId === '2') {
                p2++;
            }
        });
        summary.textContent = 'Match: ' + matchEditPlayerNames.p1 + ' ' + p1 +
            ' \u2013 ' + p2 + ' ' + matchEditPlayerNames.p2;
    }

    function renderMatchRacksEditor(racks) {
        const editor = document.getElementById('statsMatchRacksEditor');
        const label = document.getElementById('statsMatchRacksEditorLabel');
        const addBtn = document.getElementById('statsMatchAddRackBtn');
        const select = document.getElementById('statsMatchGameType');
        if (!editor) {
            return;
        }
        const gameType = (select && select.value) || 'game1';
        const isSnooker = isSnookerGameType(gameType);
        const isStraight = isStraightPoolGameType(gameType);
        const word = rackFrameWord(gameType, false);
        const words = rackFrameWord(gameType, true);
        if (label) {
            label.textContent = words;
        }
        if (addBtn) {
            addBtn.textContent = 'Add ' + word;
        }

        const list = Array.isArray(racks) ? racks.slice() : [];
        if (list.length === 0) {
            editor.innerHTML = '<p class="stats-empty">No ' + words.toLowerCase() + ' yet. Use Add ' + word + '.</p>';
            updateMatchScoreSummary();
            return;
        }

        let html = '<table class="stats-table stats-rack-edit-table"><thead><tr>' +
            '<th>#</th><th>Winner</th>';
        if (isSnooker) {
            html += '<th>Pts ' + escapeHtml(matchEditPlayerNames.p1) + '</th>' +
                '<th>Pts ' + escapeHtml(matchEditPlayerNames.p2) + '</th>' +
                '<th>HB ' + escapeHtml(matchEditPlayerNames.p1) + '</th>' +
                '<th>HB ' + escapeHtml(matchEditPlayerNames.p2) + '</th>';
        } else if (isStraight) {
            html += '<th>Run ' + escapeHtml(matchEditPlayerNames.p1) + '</th>' +
                '<th>Run ' + escapeHtml(matchEditPlayerNames.p2) + '</th>';
        }
        html += '<th>Fouls ' + escapeHtml(matchEditPlayerNames.p1) + '</th>' +
            '<th>Fouls ' + escapeHtml(matchEditPlayerNames.p2) + '</th>';
        html += '<th></th></tr></thead><tbody>';

        list.forEach(function (r, index) {
            let winnerSlot = '';
            if (r.winnerId === '1' || r.winnerId === 1) {
                winnerSlot = '1';
            } else if (r.winnerId === '2' || r.winnerId === 2) {
                winnerSlot = '2';
            } else {
                const modal = document.getElementById('statsMatchEditModal');
                if (modal && r.winnerId === modal.dataset.player1Id) {
                    winnerSlot = '1';
                } else if (modal && r.winnerId === modal.dataset.player2Id) {
                    winnerSlot = '2';
                }
            }
            const fs = r.frameScore || {};
            html += '<tr class="stats-rack-edit-row">' +
                '<td>' + (index + 1) + '</td>' +
                '<td><select class="stats-rack-winner" onchange="updateMatchScoreSummary()">' +
                '<option value="">—</option>' +
                '<option value="1"' + (winnerSlot === '1' ? ' selected' : '') + '>' + escapeHtml(matchEditPlayerNames.p1) + '</option>' +
                '<option value="2"' + (winnerSlot === '2' ? ' selected' : '') + '>' + escapeHtml(matchEditPlayerNames.p2) + '</option>' +
                '</select></td>';
            if (isSnooker) {
                html += '<td><input type="number" class="stats-rack-pts-p1" min="0" max="999" value="' +
                    clampScore(fs.p1 != null ? fs.p1 : r.pointsP1) + '" /></td>' +
                    '<td><input type="number" class="stats-rack-pts-p2" min="0" max="999" value="' +
                    clampScore(fs.p2 != null ? fs.p2 : r.pointsP2) + '" /></td>' +
                    '<td><input type="number" class="stats-rack-hb-p1" min="0" max="999" value="' +
                    clampScore(r.highestBreakP1) + '" /></td>' +
                    '<td><input type="number" class="stats-rack-hb-p2" min="0" max="999" value="' +
                    clampScore(r.highestBreakP2) + '" /></td>';
            } else if (isStraight) {
                html += '<td><input type="number" class="stats-rack-hr-p1" min="0" max="999" value="' +
                    clampScore(r.highestRunP1 != null ? r.highestRunP1 : r.highestBreakP1) + '" /></td>' +
                    '<td><input type="number" class="stats-rack-hr-p2" min="0" max="999" value="' +
                    clampScore(r.highestRunP2 != null ? r.highestRunP2 : r.highestBreakP2) + '" /></td>';
            }
            html += '<td><input type="number" class="stats-rack-fouls-p1" min="0" max="999" value="' +
                clampScore(r.foulsP1) + '" /></td>' +
                '<td><input type="number" class="stats-rack-fouls-p2" min="0" max="999" value="' +
                clampScore(r.foulsP2) + '" /></td>';
            html += '<td><button type="button" class="stats-delete-btn hover obs28 button" onclick="removeMatchRackRow(this)">Del</button></td>' +
                '</tr>';
        });
        html += '</tbody></table>';
        editor.innerHTML = html;
        updateMatchScoreSummary();
    }

    function readRackExtraFieldsFromRow(row) {
        const entry = {};
        const pts1 = row.querySelector('.stats-rack-pts-p1');
        const hb1 = row.querySelector('.stats-rack-hb-p1');
        const hr1 = row.querySelector('.stats-rack-hr-p1');
        if (pts1) {
            entry.frameScore = {
                p1: clampScore(pts1.value),
                p2: clampScore((row.querySelector('.stats-rack-pts-p2') || {}).value)
            };
        }
        if (hb1) {
            entry.highestBreakP1 = clampScore(hb1.value);
            entry.highestBreakP2 = clampScore((row.querySelector('.stats-rack-hb-p2') || {}).value);
        }
        const fouls1 = row.querySelector('.stats-rack-fouls-p1');
        if (fouls1) {
            entry.foulsP1 = clampScore(fouls1.value);
            entry.foulsP2 = clampScore((row.querySelector('.stats-rack-fouls-p2') || {}).value);
        }
        if (hr1) {
            entry.highestRunP1 = clampScore(hr1.value);
            entry.highestRunP2 = clampScore((row.querySelector('.stats-rack-hr-p2') || {}).value);
        }
        return entry;
    }

    function collectMatchRacksFromEditor() {
        const editor = document.getElementById('statsMatchRacksEditor');
        if (!editor) {
            return [];
        }
        const rows = editor.querySelectorAll('tr.stats-rack-edit-row');
        const racks = [];
        rows.forEach(function (row) {
            const winnerSel = row.querySelector('.stats-rack-winner');
            const winnerId = winnerSel ? winnerSel.value : '';
            if (!winnerId) {
                return;
            }
            const entry = { winnerId: winnerId };
            Object.assign(entry, readRackExtraFieldsFromRow(row));
            racks.push(entry);
        });
        return racks;
    }

    function addMatchRackRow() {
        const existing = collectMatchRacksFromEditor();
        // Keep incomplete rows visible by reading all DOM rows including empty winners
        const editor = document.getElementById('statsMatchRacksEditor');
        const allRows = editor ? editor.querySelectorAll('tr.stats-rack-edit-row') : [];
        const preserved = [];
        allRows.forEach(function (row) {
            const winnerSel = row.querySelector('.stats-rack-winner');
            const entry = { winnerId: winnerSel ? winnerSel.value : '' };
            Object.assign(entry, readRackExtraFieldsFromRow(row));
            preserved.push(entry);
        });
        if (preserved.length === 0 && existing.length > 0) {
            preserved.push.apply(preserved, existing);
        }
        preserved.push({ winnerId: '' });
        renderMatchRacksEditor(preserved);
    }

    function removeMatchRackRow(btn) {
        const row = btn && btn.closest ? btn.closest('tr.stats-rack-edit-row') : null;
        if (!row) {
            return;
        }
        row.remove();
        const editor = document.getElementById('statsMatchRacksEditor');
        const allRows = editor ? editor.querySelectorAll('tr.stats-rack-edit-row') : [];
        if (!allRows.length) {
            renderMatchRacksEditor([]);
            return;
        }
        // Renumber and refresh summary without dropping empty winner rows
        const preserved = [];
        allRows.forEach(function (r) {
            const winnerSel = r.querySelector('.stats-rack-winner');
            const entry = { winnerId: winnerSel ? winnerSel.value : '' };
            Object.assign(entry, readRackExtraFieldsFromRow(r));
            preserved.push(entry);
        });
        renderMatchRacksEditor(preserved);
    }

    function closeMatchEditModal() {
        const modal = document.getElementById('statsMatchEditModal');
        if (modal) {
            modal.style.display = 'none';
            modal.dataset.matchId = '';
            modal.dataset.player1Id = '';
            modal.dataset.player2Id = '';
            modal.dataset.player1Name = '';
            modal.dataset.player2Name = '';
            modal.dataset.inProgress = '';
            modal.dataset.cloud = '';
        }
        setMatchEditMode(false);
        setMatchEditGameTypeLocked(false);
        const deleteBtn = document.getElementById('statsMatchDeleteBtn');
        if (deleteBtn) {
            deleteBtn.textContent = 'Delete Match';
        }
    }

    async function saveMatchFromModal() {
        const modal = document.getElementById('statsMatchEditModal');
        if (!modal) {
            return;
        }
        if (modal.dataset.cloud === '1') {
            return saveCloudMatchFromModal();
        }

        const matchId = modal.dataset.matchId || null;
        const player1Id = modal.dataset.player1Id;
        const player2Id = modal.dataset.player2Id;
        const inProgress = modal.dataset.inProgress === '1' || isEditablePendingMatchId(matchId);

        if (!player1Id || !player2Id) {
            alert('Both players must be selected.');
            return;
        }

        try {
            const payload = {
                id: matchId || undefined,
                player1Id: player1Id,
                player2Id: player2Id,
                date: document.getElementById('statsMatchDate').value,
                gameType: document.getElementById('statsMatchGameType').value,
                gameInfo: (document.getElementById('statsMatchGameInfo') || {}).value || '',
                racks: collectMatchRacksFromEditor(),
                ballsP1: document.getElementById('statsMatchBallsP1').value,
                ballsP2: document.getElementById('statsMatchBallsP2').value
            };
            if (inProgress) {
                await savePendingMatchEdit(payload);
            } else {
                await saveMatch(payload);
            }
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
        if (isCloudStatsMode()) {
            if (!confirm('Delete this match from cloud stats? This cannot be undone.')) {
                return;
            }
            try {
                await cloudApiFetch('/api/stats/matches/' + encodeURIComponent(matchId), {
                    method: 'DELETE'
                });
                closeMatchEditModal();
                invalidateCloudStatsCache();
                await refreshStatsUI();
            } catch (err) {
                alert('Delete failed: ' + err.message);
            }
            return;
        }
        const inProgress = isEditablePendingMatchId(matchId);
        const message = inProgress
            ? 'Discard this in-progress match? Rack/frame and ball stats from it will be undone, and the scoreboard will reset to 0–0.'
            : 'Delete this match? Player stats will be recalculated.';
        if (!confirm(message)) {
            return;
        }
        try {
            if (inProgress) {
                await discardPendingMatch();
            } else {
                await deleteMatch(matchId);
            }
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
        if (modal.dataset.cloud === '1') {
            return deleteCloudMatchFromModal();
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
        let playerName = '';
        if (isCloudStatsMode()) {
            const data = await fetchCloudStats();
            const key = cloudPlayerKey(statsModalSelectedPlayerId);
            const cloudPlayer = (data.players || []).find(function (p) {
                return cloudPlayerKey(p.id || p.name) === key;
            });
            if (!cloudPlayer) {
                alert('Player not found.');
                return;
            }
            playerName = cloudPlayer.name;
        } else {
            const player = await getPlayer(statsModalSelectedPlayerId);
            if (!player) {
                alert('Player not found.');
                return;
            }
            playerName = player.name;
        }
        const modal = document.getElementById('statsPlayerRenameModal');
        const input = document.getElementById('statsPlayerRenameInput');
        if (!modal || !input) {
            return;
        }
        modal.dataset.playerId = statsModalSelectedPlayerId;
        modal.dataset.fromName = playerName;
        input.value = playerName;
        modal.style.display = 'block';
        input.focus();
        input.select();
    }

    function closePlayerRenameModal() {
        const modal = document.getElementById('statsPlayerRenameModal');
        if (modal) {
            modal.style.display = 'none';
            modal.dataset.playerId = '';
            modal.dataset.fromName = '';
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
        const newName = String(input.value || '').trim().slice(0, 20);
        if (!newName) {
            alert('Name is required.');
            return;
        }
        try {
            if (isCloudStatsMode()) {
                const fromName = modal.dataset.fromName || '';
                await cloudApiFetch('/api/stats/players', {
                    method: 'PATCH',
                    body: { from: fromName, to: newName }
                });
                invalidateCloudStatsCache();
                statsModalSelectedPlayerId = cloudPlayerKey(newName);
            } else {
                await updatePlayerName(playerId, newName);
                if (typeof postNames === 'function') {
                    postNames();
                }
            }
            closePlayerRenameModal();
            await refreshStatsUI();
            if (statsModalSelectedPlayerId) {
                await showPlayerDetail(statsModalSelectedPlayerId);
            }
        } catch (err) {
            alert('Rename failed: ' + err.message);
        }
    }

    async function confirmDeletePlayer() {
        if (!statsModalSelectedPlayerId) {
            return;
        }
        if (isCloudStatsMode()) {
            alert('Deleting players is not available while CueSport Cloud is connected. Rename the player, or delete individual matches instead.');
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
        updateStatsCloudBanner();
        await renderStatsLeaderboard();
        await populateH2HPlayerSelects();
        switchStatsTab('leaderboard');
    }

    function updateStatsCloudBanner() {
        var banner = document.getElementById('statsCloudBanner');
        if (!banner) return;
        var cloud = isCloudStatsMode();
        if (cloud) {
            banner.textContent = 'Showing cloud-backed stats. Click a player to view and edit matches.';
        } else {
            banner.textContent = 'Showing local stats (last ' + LOCAL_RETENTION_DAYS + ' days).';
        }
        banner.classList.remove('noShow');
        updateStatsActionButtons(cloud);
    }

    function updateStatsActionButtons(cloudMode) {
        var importBtn = document.getElementById('statsImportBtn');
        var exportBtn = document.getElementById('statsExportBtn');
        var clearBtn = document.getElementById('statsClearBtn');
        var hint = document.getElementById('statsActionHint');
        if (cloudMode) {
            if (importBtn) { importBtn.classList.add('disabled'); importBtn.setAttribute('aria-disabled', 'true'); importBtn.style.pointerEvents = 'none'; importBtn.style.opacity = '0.4'; }
            if (exportBtn) { exportBtn.classList.add('disabled'); exportBtn.setAttribute('aria-disabled', 'true'); exportBtn.style.pointerEvents = 'none'; exportBtn.style.opacity = '0.4'; }
            if (clearBtn) { clearBtn.classList.add('disabled'); clearBtn.setAttribute('aria-disabled', 'true'); clearBtn.style.pointerEvents = 'none'; clearBtn.style.opacity = '0.4'; }
            if (hint) hint.textContent = 'Import, export and clear are disabled while CueSport Cloud is connected. Click a player to edit cloud matches from this dock.';
        } else {
            if (importBtn) { importBtn.classList.remove('disabled'); importBtn.removeAttribute('aria-disabled'); importBtn.style.pointerEvents = ''; importBtn.style.opacity = ''; }
            if (exportBtn) { exportBtn.classList.remove('disabled'); exportBtn.removeAttribute('aria-disabled'); exportBtn.style.pointerEvents = ''; exportBtn.style.opacity = ''; }
            if (clearBtn) { clearBtn.classList.remove('disabled'); clearBtn.removeAttribute('aria-disabled'); clearBtn.style.pointerEvents = ''; clearBtn.style.opacity = ''; }
            if (hint) hint.textContent = 'Export creates a backup file. Import replaces all current statistics after confirmation. Clear permanently deletes statistics history and resets the current game (names, race/game info, and scoreline).';
        }
    }

    function closeStatsModal() {
        const modal = document.getElementById('statsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    function switchStatsTab(tabName) {
        const allowed = { leaderboard: true, detail: true, h2h: true };
        if (!allowed[tabName]) {
            tabName = 'leaderboard';
        }
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

        if (isCloudStatsMode()) {
            return renderCloudLeaderboard(tbody);
        }

        const players = await getAllPlayers();
        players.sort(function (a, b) {
            const aStats = a.stats || createEmptyStats();
            const bStats = b.stats || createEmptyStats();
            return bStats.gamesWon - aStats.gamesWon || bStats.racksWon - aStats.racksWon;
        });

        if (players.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">No players recorded yet.</td></tr>';
            return;
        }

        tbody.innerHTML = players.map(function (p) {
            const stats = p.stats || createEmptyStats();
            const wr = getWinRate(stats);
            return '<tr class="stats-row" data-player-id="' + p.id + '">' +
                '<td>' + escapeHtml(p.name) + '</td>' +
                '<td>' + formatWL(stats.gamesWon, stats.gamesLost) + '</td>' +
                '<td>' + wr + '%</td>' +
                '<td>' + formatWLWithPct(stats.racksWon, stats.racksLost) + '</td>' +
                '<td>' + formatDate(p.lastPlayedAt) + '</td>' +
                '</tr>';
        }).join('');

        tbody.querySelectorAll('.stats-row').forEach(function (row) {
            row.addEventListener('click', function () {
                showPlayerDetail(row.dataset.playerId);
            });
        });
    }

    async function renderCloudLeaderboard(tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">Loading cloud stats\u2026</td></tr>';
        const data = await fetchCloudStats();
        if (data.error) {
            tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">Could not load cloud stats: ' + escapeHtml(data.error) + '</td></tr>';
            return;
        }
        if (!data.players.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="stats-empty">No cloud match data yet.</td></tr>';
            return;
        }
        tbody.innerHTML = data.players.map(function (p) {
            const total = p.gamesWon + p.gamesLost;
            const wr = total > 0 ? Math.round((p.gamesWon / total) * 100) : 0;
            return '<tr class="stats-row" data-player-id="' + escapeHtml(p.id) + '">' +
                '<td>' + escapeHtml(p.name) + '</td>' +
                '<td>' + formatWL(p.gamesWon, p.gamesLost) + '</td>' +
                '<td>' + wr + '%</td>' +
                '<td>' + formatWLWithPct(p.racksWon, p.racksLost) + '</td>' +
                '<td>' + formatDate(p.lastPlayedAt) + '</td>' +
                '</tr>';
        }).join('');

        tbody.querySelectorAll('.stats-row').forEach(function (row) {
            row.addEventListener('click', function () {
                showPlayerDetail(row.dataset.playerId);
            });
        });
    }

    function racksWlHeaderForGameType(gameType) {
        return usesFrameTerminology(gameType) ? 'Frames W/L' : 'Racks W/L';
    }

    function breakHeaderForGameType(gameType) {
        if (isStraightPoolGameType(gameType)) {
            return 'Longest Run';
        }
        if (isSnookerGameType(gameType)) {
            return 'Highest Break';
        }
        return 'HB / Run';
    }

    function breakValueForGameType(ts, gameType) {
        if (!ts) return 0;
        if (isStraightPoolGameType(gameType)) {
            return Math.max(ts.highestRun || 0, ts.highestBreak || 0);
        }
        return ts.highestBreak || 0;
    }

    function buildPlayerStatsDataTable(headers, cells, rowClass) {
        let html = '<table class="stats-table stats-player-stats-table"><thead><tr>';
        headers.forEach(function (header) {
            html += '<th>' + header + '</th>';
        });
        html += '</tr></thead><tbody><tr';
        if (rowClass) {
            html += ' class="' + rowClass + '"';
        }
        html += '>';
        cells.forEach(function (cell) {
            html += '<td>' + cell + '</td>';
        });
        html += '</tr></tbody></table>';
        return html;
    }

    function renderPlayerStatsTable(player, winStreak) {
        const showBalls = (player.stats.ballsWon || 0) > 0 ||
            Object.keys(player.stats.byGameType || {}).some(function (gt) {
                return gameTypeHasBallScoring(gt) && (player.stats.byGameType[gt].ballsWon || 0) > 0;
            });
        const showFouls = (player.stats.fouls || 0) > 0 ||
            !!(player.stats.byGameType && player.stats.byGameType.game8 &&
                (player.stats.byGameType.game8.fouls || 0) > 0);
        const showBreak = (player.stats.highestBreak || 0) > 0 ||
            (player.stats.highestRun || 0) > 0 ||
            !!(player.stats.byGameType && (
                (player.stats.byGameType.game8 && player.stats.byGameType.game8.highestBreak) ||
                (player.stats.byGameType.game4 && (
                    player.stats.byGameType.game4.highestRun ||
                    player.stats.byGameType.game4.highestBreak
                ))
            ));

        const overallHeaders = ['Matches Won', racksWlHeaderForGameType()];
        const overallCells = [
            formatWLWithPct(player.stats.gamesWon, player.stats.gamesLost),
            formatWLWithPct(player.stats.racksWon, player.stats.racksLost)
        ];
        if (showBreak) {
            if ((player.stats.highestBreak || 0) > 0) {
                overallHeaders.push('Highest Break');
                overallCells.push(String(player.stats.highestBreak || 0));
            }
            if ((player.stats.highestRun || 0) > 0 ||
                (player.stats.byGameType && player.stats.byGameType.game4 &&
                    ((player.stats.byGameType.game4.highestRun || 0) > 0 ||
                        (player.stats.byGameType.game4.highestBreak || 0) > 0))) {
                overallHeaders.push('Longest Run');
                overallCells.push(String(Math.max(
                    player.stats.highestRun || 0,
                    (player.stats.byGameType && player.stats.byGameType.game4 &&
                        Math.max(
                            player.stats.byGameType.game4.highestRun || 0,
                            player.stats.byGameType.game4.highestBreak || 0
                        )) || 0
                )));
            }
        }
        if (showBalls) {
            overallHeaders.push('Balls Potted');
            overallCells.push(String(player.stats.ballsWon || 0));
        }
        if (showFouls) {
            overallHeaders.push('Fouls');
            overallCells.push(String(player.stats.fouls || 0));
        }
        overallHeaders.push('Last');
        overallCells.push(formatDate(player.lastPlayedAt));

        let html = '<div class="stats-player-game-block">' +
            '<h4 class="stats-section-title">Overall</h4>' +
            buildPlayerStatsDataTable(overallHeaders, overallCells, 'stats-overall-row') +
            '</div>';

        Object.keys(GAME_TYPE_LABELS).forEach(function (gt) {
            const ts = player.stats.byGameType[gt];
            const typeBalls = ts ? (ts.ballsWon || 0) : 0;
            const typeBreak = breakValueForGameType(ts, gt);
            const typeFouls = ts ? (ts.fouls || 0) : 0;
            if (!ts || (ts.gamesWon + ts.gamesLost + ts.racksWon + typeBalls + typeBreak + typeFouls) === 0) {
                return;
            }
            const gameHeaders = ['Matches Won', racksWlHeaderForGameType(gt)];
            const gameCells = [
                formatWLWithPct(ts.gamesWon, ts.gamesLost),
                formatWLWithPct(ts.racksWon, ts.racksLost)
            ];
            const showGameBreak = showBreak && (gt === 'game8' || gt === 'game4' || typeBreak > 0);
            if (showGameBreak) {
                gameHeaders.push(breakHeaderForGameType(gt));
                gameCells.push((gt === 'game8' || gt === 'game4' || typeBreak) ? String(typeBreak) : '\u2014');
            }
            if (showBalls) {
                gameHeaders.push('Balls Potted');
                gameCells.push(gameTypeHasBallScoring(gt) ? String(typeBalls) : '\u2014');
            }
            if (showFouls) {
                gameHeaders.push('Fouls');
                gameCells.push(String(typeFouls));
            }
            html += '<div class="stats-player-game-block">' +
                '<h4 class="stats-section-title">' + GAME_TYPE_LABELS[gt] + '</h4>' +
                buildPlayerStatsDataTable(gameHeaders, gameCells) +
                '</div>';
        });

        const streak = typeof winStreak === 'number' ? winStreak : 0;
        html += '<p class="stats-win-streak">Win Streak: ' + streak + '</p>';
        return html;
    }

    function renderH2HComparisonTable(viewerId, opponentId, h2h) {
        if (!h2h) {
            return '<p class="stats-empty">No head-to-head data.</p>';
        }

        const viewer = h2h.player1.id === viewerId ? h2h.player1 : h2h.player2;
        const opponent = h2h.player1.id === viewerId ? h2h.player2 : h2h.player1;
        const showBalls = showsBallStats();
        const showFouls = showsFoulStats(h2h.gameType);
        const h2hBreak1 = (h2h.highestBreak && h2h.highestBreak[viewerId]) || 0;
        const h2hBreak2 = (h2h.highestBreak && h2h.highestBreak[opponentId]) || 0;
        const h2hRun1 = (h2h.highestRun && h2h.highestRun[viewerId]) || 0;
        const h2hRun2 = (h2h.highestRun && h2h.highestRun[opponentId]) || 0;
        const showBreak = showsHighestBreakStats(h2h.gameType) || h2hBreak1 > 0 || h2hBreak2 > 0;
        const showRun = showsHighestRunStats(h2h.gameType) || h2hRun1 > 0 || h2hRun2 > 0;
        const racksHeader = usesFrameTerminology() ? 'Frames Won' : 'Racks Won';

        if (!h2hSummaryHasDisplayableActivity(h2h, viewerId, opponentId)) {
            return '<p class="stats-empty">No matches recorded vs this opponent.</p>';
        }

        const rows = [
            {
                label: 'Matches Won',
                left: h2h.gamesWon[viewerId] || 0,
                right: h2h.gamesWon[opponentId] || 0
            },
            {
                label: racksHeader,
                left: h2h.racksWon[viewerId] || 0,
                right: h2h.racksWon[opponentId] || 0
            }
        ];
        if (showBreak) {
            rows.push({
                label: highestBreakLabel(h2h.gameType),
                left: h2hBreak1,
                right: h2hBreak2
            });
        }
        if (showRun) {
            rows.push({
                label: highestRunLabel(h2h.gameType),
                left: h2hRun1,
                right: h2hRun2
            });
        }
        if (showBalls) {
            rows.push({
                label: 'Balls Potted',
                left: h2h.ballsWon[viewerId] || 0,
                right: h2h.ballsWon[opponentId] || 0
            });
        }
        if (showFouls) {
            rows.push({
                label: 'Fouls',
                left: (h2h.fouls && h2h.fouls[viewerId]) || 0,
                right: (h2h.fouls && h2h.fouls[opponentId]) || 0
            });
        }

        const sideCh = Math.max(
            (viewer.name || '').length,
            (opponent.name || '').length,
            4
        );

        let html = '<table class="stats-table stats-h2h-comparison-table">' +
            '<colgroup>' +
            '<col class="stats-h2h-side" style="width:' + sideCh + 'ch">' +
            '<col class="stats-h2h-mid">' +
            '<col class="stats-h2h-side" style="width:' + sideCh + 'ch">' +
            '</colgroup>' +
            '<thead><tr>' +
            '<th class="stats-h2h-col-player">' + escapeHtml(viewer.name) + '</th>' +
            '<th class="stats-h2h-col-label"></th>' +
            '<th class="stats-h2h-col-player">' + escapeHtml(opponent.name) + '</th>' +
            '</tr></thead><tbody>';
        rows.forEach(function (row) {
            html += '<tr>' +
                '<td class="stats-h2h-col-value">' + row.left + '</td>' +
                '<td class="stats-h2h-col-label">' + escapeHtml(row.label) + '</td>' +
                '<td class="stats-h2h-col-value">' + row.right + '</td>' +
                '</tr>';
        });
        html += '</tbody></table>';

        if (h2h.lastPlayedAt) {
            html += '<p class="stats-h2h-last">Last played: ' + formatDate(h2h.lastPlayedAt) + '</p>';
        }
        return html;
    }

    function renderInlineH2HStats(playerId, otherId, h2h) {
        if (!h2h || !playerId || !otherId) {
            return '<span class="stats-empty">&mdash;</span>';
        }
        const showBalls = showsBallStats();
        const showFouls = showsFoulStats();
        const racksWord = usesFrameTerminology() ? 'Frames' : 'Racks';
        if (!h2hSummaryHasDisplayableActivity(h2h, playerId, otherId)) {
            return '<span class="stats-empty">No recorded matches</span>';
        }
        const hb = (h2h.highestBreak && h2h.highestBreak[playerId]) || 0;
        const fouls = (h2h.fouls && h2h.fouls[playerId]) || 0;
        return 'Matches Won ' + formatMatchupScore(h2h.gamesWon[playerId] || 0, h2h.gamesWon[otherId] || 0) +
            ' · ' + racksWord + ' Won ' + formatMatchupScore(h2h.racksWon[playerId] || 0, h2h.racksWon[otherId] || 0) +
            (hb ? ' · HB ' + hb : '') +
            (showBalls ? ' · Balls Potted ' + (h2h.ballsWon[playerId] || 0) : '') +
            (showFouls && fouls ? ' · Fouls ' + fouls : '');
    }

    function renderPlayerMatchHistoryRows(playerId, matches) {
        return renderMatchHistoryRows(matches, { viewerPlayerId: playerId, colspan: 5 });
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
        } else if (isCloudStatsMode()) {
            const cloud = await fetchCloudStats();
            const h2h = buildCloudHeadToHead(statsModalSelectedPlayerId, select.value, cloud);
            bodyHtml = renderH2HComparisonTable(statsModalSelectedPlayerId, select.value, h2h);
        } else {
            const h2h = await getHeadToHead(statsModalSelectedPlayerId, select.value);
            bodyHtml = renderH2HComparisonTable(statsModalSelectedPlayerId, select.value, h2h);
        }
        panel.innerHTML = '<h4 class="stats-section-title">Head to Head</h4>' + bodyHtml;
    }

    async function showPlayerDetail(playerId) {
        if (isCloudStatsMode()) {
            return showCloudPlayerDetail(playerId);
        }
        statsModalSelectedPlayerId = playerId;
        const player = await getPlayer(playerId);
        const detailPanel = document.getElementById('statsPlayerDetail');
        if (!player || !detailPanel) {
            return;
        }

        const prevOpponentSelect = document.getElementById('statsPlayerOpponentSelect');
        const prevOpponentId = prevOpponentSelect ? prevOpponentSelect.value : '';

        const matches = await getMatchesForPlayer(playerId, { includePending: true });
        const completedMatches = matches.filter(function (m) { return m.status === 'completed'; });
        const allPlayers = await getAllPlayers();
        const opponentOptions = allPlayers
            .filter(function (p) { return p.id !== playerId; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); })
            .map(function (p) {
                return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
            }).join('');

        const matchRows = renderPlayerMatchHistoryRows(playerId, matches);
        const winStreak = getCurrentWinStreak(playerId, completedMatches);

        detailPanel.innerHTML =
            '<div class="stats-player-header">' +
            '<h3>' + escapeHtml(player.name) + '</h3>' +
            '<div class="stats-player-header-actions">' +
            '<div class="hover obs28 button stats-edit-btn" onclick="promptRenamePlayer()">Edit Name</div>' +
            '<div class="hover obs28 button stats-edit-btn stats-danger-btn" onclick="confirmDeletePlayer()">Delete Player</div>' +
            '</div></div>' +
            '<div class="stats-section">' + renderPlayerStatsTable(player, winStreak) + '</div>' +
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
            '<table class="stats-table"><thead><tr><th>Date / time</th><th>Opponent</th><th>Game</th><th>Score</th><th>Actions</th></tr></thead><tbody>' +
            matchRows + '</tbody></table></div></div>';

        const opponentSelect = document.getElementById('statsPlayerOpponentSelect');
        if (opponentSelect && prevOpponentId && prevOpponentId !== playerId &&
            opponentSelect.querySelector('option[value="' + prevOpponentId + '"]')) {
            opponentSelect.value = prevOpponentId;
        }
        await refreshPlayerOpponentH2H();

        switchStatsTab('detail');
    }

    async function showCloudPlayerDetail(playerId) {
        statsModalSelectedPlayerId = playerId;
        const detailPanel = document.getElementById('statsPlayerDetail');
        if (!detailPanel) return;

        const prevOpponentSelect = document.getElementById('statsPlayerOpponentSelect');
        const prevOpponentId = prevOpponentSelect ? prevOpponentSelect.value : '';

        const data = await fetchCloudStats();
        if (data.error) {
            detailPanel.innerHTML = '<p class="stats-empty">Could not load cloud stats: ' +
                escapeHtml(data.error) + '</p>';
            switchStatsTab('detail');
            return;
        }
        const key = cloudPlayerKey(playerId);
        const cloudPlayer = (data.players || []).find(function (p) {
            return cloudPlayerKey(p.id || p.name) === key;
        });
        if (!cloudPlayer) {
            detailPanel.innerHTML = '<p class="stats-empty">Player not found in cloud stats.</p>';
            switchStatsTab('detail');
            return;
        }

        const playerMatches = (data.matches || []).filter(function (m) {
            return m.status === 'completed' &&
                (cloudPlayerKey(m.player1Name) === key || cloudPlayerKey(m.player2Name) === key);
        });
        const player = buildCloudPlayerDetailShape(cloudPlayer, playerMatches);
        const uiMatches = playerMatches.map(adaptCloudMatchForUi);
        const winStreak = getCurrentWinStreak(key, uiMatches);

        const opponentOptions = (data.players || [])
            .filter(function (p) { return cloudPlayerKey(p.id || p.name) !== key; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); })
            .map(function (p) {
                return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>';
            }).join('');

        const matchRows = renderMatchHistoryRows(uiMatches, { viewerPlayerId: key, colspan: 5 });

        detailPanel.innerHTML =
            '<div class="stats-player-header">' +
            '<h3>' + escapeHtml(player.name) + '</h3>' +
            '<div class="stats-player-header-actions">' +
            '<div class="hover obs28 button stats-edit-btn" onclick="promptRenamePlayer()">Edit Name</div>' +
            '</div></div>' +
            '<div class="stats-section">' + renderPlayerStatsTable(player, winStreak) + '</div>' +
            '<div class="stats-section stats-opponent-row">' +
            '<label>Opponent:' +
            '<select id="statsPlayerOpponentSelect" onchange="refreshPlayerOpponentH2H()">' +
            '<option value="">-- Select --</option>' + opponentOptions + '</select></label></div>' +
            '<div id="statsPlayerH2HPanel" class="stats-section">' +
            '<h4 class="stats-section-title">Head to Head</h4>' +
            '<p class="stats-empty">Select an opponent to view head-to-head stats.</p></div>' +
            '<div class="stats-section">' +
            '<h4 class="stats-section-title">Match History</h4>' +
            '<div class="stats-scroll-panel">' +
            '<table class="stats-table"><thead><tr><th>Date / time</th><th>Opponent</th><th>Game</th><th>Score</th><th>Actions</th></tr></thead><tbody>' +
            matchRows + '</tbody></table></div></div>';

        const opponentSelect = document.getElementById('statsPlayerOpponentSelect');
        if (opponentSelect && prevOpponentId && prevOpponentId !== key &&
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
        let players;
        if (isCloudStatsMode()) {
            const cloud = await fetchCloudStats();
            players = (cloud.players || []).map(function (p) {
                return { id: p.id, name: p.name };
            });
        } else {
            players = await getAllPlayers();
        }
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

        const h2h = isCloudStatsMode()
            ? buildCloudHeadToHead(id1, id2, await fetchCloudStats())
            : await getHeadToHead(id1, id2);
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

        container.innerHTML = '<table class="stats-table"><thead><tr><th>Date / time</th><th>Game</th><th>Score</th><th>Actions</th></tr></thead><tbody>' +
            renderMatchHistoryRows(h2h.matches, {
                colspan: 4,
                h2h: {
                    id1: id1,
                    name1: h2h.player1.name,
                    name2: h2h.player2.name
                }
            }) + '</tbody></table>';
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

        if (!data || !Array.isArray(data.players) || !Array.isArray(data.matches)) {
            throw new Error('Invalid import file format.');
        }

        const playerCount = data.players.length;
        const matchCount = data.matches.length;
        if (!confirm(
            'Import will REPLACE all current player statistics and match history with this file (' +
            playerCount + ' player(s), ' + matchCount + ' match(es)).\n\n' +
            'Existing stats will be permanently overwritten. Continue?'
        )) {
            return;
        }
        if (!confirm('Are you sure? This cannot be undone. Export a backup first if you need to keep current data.')) {
            return;
        }

        const result = await importData(data);
        if (result.cancelled) {
            return;
        }

        alert('Import complete: ' + result.players + ' player(s) and ' +
            result.matches + ' match(es) loaded.');
        statsModalSelectedPlayerId = null;
        document.getElementById('statsPlayerDetail').innerHTML =
            '<p class="stats-empty">Select a player from the leaderboard.</p>';
        await renderStatsLeaderboard();
        await populateH2HPlayerSelects();
        await refreshH2HView();
        broadcastOverlayStatsIfEnabled();
    }

    async function clearAllStatsConfirmed() {
        if (!confirm(
            "Clear ALL player statistics and match history?\n\n" +
            "This permanently deletes your stats roster, resets the current game " +
            "(names, race/game info, and scoreline), and cannot be undone."
        )) {
            return;
        }
        if (!confirm("Are you absolutely sure? All recorded statistics will be permanently deleted.")) {
            return;
        }
        await clearAllStats();
        if (typeof window.resetCurrentGame === "function") {
            window.resetCurrentGame({ skipStatsAbandon: true });
        }
        statsModalSelectedPlayerId = null;
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

    async function initPlayerStats() {
        await openDatabase();
        await repairPlayerRecords();
        await restorePendingSession();
        await pruneOldMatches();
        playerStatsReady = true;
        // Set initial cloud stats UI state
        var cloud = isCloudStatsMode();
        updateStatsActionButtons(cloud);
        var cta = document.getElementById('cloudStatsCtaRow');
        if (cta) cta.style.display = cloud ? '' : 'none';
        return db;
    }

    // Expose API
    window.PlayerStats = {
        init: initPlayerStats,
        ensurePlayer: ensurePlayer,
        findPlayerByNormalizedName: findPlayerByNormalizedName,
        searchPlayers: searchPlayers,
        getPlayer: getPlayer,
        getAllPlayers: getAllPlayers,
        recordRackWin: recordRackWin,
        undoLastRack: undoLastRack,
        recordBallWin: recordBallWin,
        noteStraightPoolRun: noteStraightPoolRun,
        undoLastBall: undoLastBall,
        recordSnookerFrame: recordSnookerFrame,
        checkMatchCompletion: checkMatchCompletion,
        canCallGame: canCallGame,
        callGame: callGame,
        flushRackRecordQueue: flushRackRecordQueue,
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
        publishSnookerOverlayLiveStats: publishSnookerOverlayLiveStats,
        onScoreModeChanged: onScoreModeChanged,
        syncOverlayButtonsFromStorage: syncOverlayButtonsFromStorage,
        initPlayerAutocomplete: initPlayerAutocomplete,
        buildOverlayStatsPayload: buildOverlayStatsPayload,
        renderMatchRackBreakdown: renderMatchRackBreakdown,
        getActivePendingMatch: getActivePendingMatch,
        buildCloudMatchExtras: buildCloudMatchExtras,
        syncActiveMatchGameInfoFromUI: captureActiveMatchGameInfo,
        renderStatsVisibilityPanel: renderStatsVisibilityPanel,
        isStatVisible: isStatVisible,
        readStatsVisibilityGameType: readStatsVisibilityGameType,
        isCloudStatsMode: isCloudStatsMode,
        invalidateCloudStatsCache: invalidateCloudStatsCache
    };

    window.openStatsModal = openStatsModal;
    window.closeStatsModal = closeStatsModal;
    window.switchStatsTab = switchStatsTab;
    window.onStatVisibilityToggle = onStatVisibilityToggle;
    window.onStatsVisibilityGameTypeChange = onStatsVisibilityGameTypeChange;
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
    window.updateMatchBallFieldsVisibility = updateMatchBallFieldsVisibility;
    window.onStatsMatchGameTypeChange = onStatsMatchGameTypeChange;
    window.updateMatchScoreSummary = updateMatchScoreSummary;
    window.addMatchRackRow = addMatchRackRow;
    window.removeMatchRackRow = removeMatchRackRow;
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

    // Refresh stats UI when cloud connection state changes
    function onCloudStateChange() {
        invalidateCloudStatsCache();
        var cloud = isCloudStatsMode();
        updateStatsActionButtons(cloud);
        var banner = document.getElementById('statsCloudBanner');
        if (banner) updateStatsCloudBanner();
        var cta = document.getElementById('cloudStatsCtaRow');
        if (cta) cta.style.display = cloud ? '' : 'none';
    }
    window.addEventListener('cloudRelayStateChange', onCloudStateChange);

    openDatabase().then(function () {
        return repairPlayerRecords();
    }).catch(function (err) {
        console.error('PlayerStats DB init failed:', err);
    });
})();
