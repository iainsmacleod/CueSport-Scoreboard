'use strict';

/**
 * Pure scoreboard helpers shared by control panel and player stats (browser).
 * Keep formulas identical to backend/web/shared/scoreboard-helpers.js and
 * backend/src/lib/scoreboard-helpers.js.
 */
(function (root) {
    function clampScore(value) {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(n, 999);
    }

    function truncatePlayerName(name) {
        return String(name || '').trim().slice(0, 20);
    }

    /** Lowercase trimmed name for roster matching. */
    function normalizePlayerName(name) {
        return String(name || '').trim().toLowerCase();
    }

    /**
     * Parse race / Best Of text into the racks/frames needed to win.
     * Snooker (game8): Best Of N → first to floor(N/2)+1.
     * @returns {number|null}
     */
    function parseRaceTarget(raceInfo, gameType) {
        const raceString = String(raceInfo || '').trim();
        if (!raceString) return null;
        const matches = raceString.match(/\d+/g);
        if (!matches || matches.length === 0) return null;
        const target = parseInt(matches[matches.length - 1], 10);
        if (!Number.isFinite(target) || target <= 0) return null;
        if (gameType === 'game8') {
            return Math.floor(target / 2) + 1;
        }
        return target;
    }

    function isRaceLocked(p1Score, p2Score, raceTarget) {
        if (raceTarget === null || raceTarget === undefined) return false;
        const p1 = Number(p1Score) || 0;
        const p2 = Number(p2Score) || 0;
        return p1 >= raceTarget || p2 >= raceTarget;
    }

    /**
     * Map a winner id (player id or slot '1'/'2'/1/2) to slot '1' | '2' | null.
     */
    function resolveWinnerSlot(winnerId, p1Id, p2Id) {
        if (winnerId == null || winnerId === '') return null;
        if (winnerId === '1' || winnerId === 1) return '1';
        if (winnerId === '2' || winnerId === 2) return '2';
        if (p1Id != null && winnerId === p1Id) return '1';
        if (p2Id != null && winnerId === p2Id) return '2';
        return null;
    }

    /** Winner slot from live scores vs race target (tie → null). */
    function winnerSlotFromScores(scores, raceTo) {
        if (raceTo === null || raceTo === undefined) return null;
        const p1 = Number(scores && scores.p1) || 0;
        const p2 = Number(scores && scores.p2) || 0;
        if (p1 >= raceTo && p1 >= p2) return '1';
        if (p2 >= raceTo && p2 >= p1) return '2';
        return null;
    }

    const api = {
        clampScore,
        truncatePlayerName,
        normalizePlayerName,
        parseRaceTarget,
        isRaceLocked,
        resolveWinnerSlot,
        winnerSlotFromScores,
    };

    root.ScoreboardHelpers = api;
})(typeof window !== 'undefined' ? window : globalThis);
