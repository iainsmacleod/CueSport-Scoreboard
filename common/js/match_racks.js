'use strict';

/**
 * Rack timing helpers for dock player stats.
 * Keep in sync with backend/web/shared/match-racks.js.
 */
(function (root) {
    function parseIsoMs(iso) {
        if (!iso) return NaN;
        const raw = String(iso);
        const normalized = raw.includes('T')
            ? raw
            : raw.replace(' ', 'T') + (raw.includes('Z') || raw.includes('+') ? '' : 'Z');
        const ms = Date.parse(normalized);
        return Number.isFinite(ms) ? ms : NaN;
    }

    function computeDurationSeconds(startedAt, endedAt) {
        const startMs = parseIsoMs(startedAt);
        const endMs = parseIsoMs(endedAt);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
        return Math.round((endMs - startMs) / 1000);
    }

    function formatDurationSeconds(durationSeconds) {
        let secs = Number(durationSeconds);
        if (!Number.isFinite(secs) || secs < 0) return '';
        secs = Math.round(secs);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return s ? (m + 'm ' + s + 's') : (m + 'm');
        return s + 's';
    }

    function enrichRacksWithDuration(match) {
        const racks = Array.isArray(match && match.racks) ? match.racks : [];
        let prevEnd = match && match.startedAt;
        return racks.map(function (r) {
            const copy = Object.assign({}, r || {});
            const hasDur = Number.isFinite(Number(copy.durationSeconds)) && Number(copy.durationSeconds) >= 0;
            if (!hasDur) {
                const start = copy.startedAt || prevEnd;
                const end = copy.timestamp;
                const dur = computeDurationSeconds(start, end);
                if (dur != null) {
                    if (!copy.startedAt && start) {
                        copy.startedAt = start;
                    }
                    copy.durationSeconds = dur;
                }
            }
            prevEnd = copy.timestamp || copy.startedAt || prevEnd;
            return copy;
        });
    }

    function sumRackDurationSeconds(match) {
        let sum = 0;
        let any = false;
        enrichRacksWithDuration(match).forEach(function (r) {
            const dur = Number(r.durationSeconds);
            if (Number.isFinite(dur) && dur >= 0) {
                sum += dur;
                any = true;
            }
        });
        return any ? sum : null;
    }

    root.MatchRacksHelpers = {
        parseIsoMs,
        computeDurationSeconds,
        formatDurationSeconds,
        enrichRacksWithDuration,
        sumRackDurationSeconds,
    };
})(typeof window !== 'undefined' ? window : globalThis);
