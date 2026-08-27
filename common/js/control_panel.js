'use strict';
// CueSport ScoreBoard is a modified version of G4ScoreBoard by Iain MacLeod. The purpose of this modification was to simplify and enhance the UI/UX for users.
// I have removed the Salotto logo, as I myself have not asked for permission to use - but if you choose to use it, it can be uploaded as a custom logo.
// This implementation now uses 5 custom logos, 2 associated with players, and 3 for a slideshow functionality.

//  G4ScoreBoard addon for OBS version 1.6.0 Copyright 2022-2023 Norman Gholson IV
//  https://g4billiards.com http://www.g4creations.com
//  this is a purely javascript/html/css driven scoreboard system for OBS Studio
//  free to use and modify and use as long as this copyright statment remains intact. 
//  Salotto logo is the copyright of Salotto and is used with their permission.
//  for more information about Salotto please visit https://salotto.app


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// functions
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////			
// Get instance from URL or use 'default'
const urlParams = new URLSearchParams(window.location.search);
const INSTANCE_ID = urlParams.get('instance') || '';
// Create OBSWebSocket client instance
const obs = new OBSWebSocket();
// Track readiness (post-Identify)
let isObsReady = false;
// UI button click handlers, async and awaiting hotkey dispatch
// Initialize from localStorage - use getStorageItem for consistency with prefix handling
let isMonitoringActive = getStorageItem('isMonitoringActive') === 'true' || false;
let isConnected = getStorageItem('isConnected') === 'true' || false;
let replayHistory = JSON.parse(localStorage.getItem('replayHistory')) || [];

// function updateTabVisibility() {
//     // Get the state of the player settings
//     const player1Enabled = document.getElementById("usePlayer1Setting").checked;
//     const player2Enabled = document.getElementById("usePlayer2Setting").checked;
//     // Determine if both players are enabled
//     const bothPlayersEnabled = player1Enabled && player2Enabled;

//     // Get tab elements
//     const scoringTab = document.getElementById("scoringTab");

//     // Show or hide the scoring tab
//     // scoringTab.style.display = bothPlayersEnabled ? "inline-block" : "none";
// }

function toggleReplayClipsVisibility() {
    const replayClips = document.getElementById("replayClips");
    const buttons = replayClips.querySelectorAll("button");

    // Check if there is any visible button
    const hasVisibleClip = Array.from(buttons).some(btn => btn.style.display !== "none");

    if (hasVisibleClip) {
        replayClips.classList.remove("noShow");
    } else {
        replayClips.classList.add("noShow");
    }
}

function updatePlayerBallControlVisibility() {
    const ballTrackerCheckbox = document.getElementById("ballTrackerCheckbox").checked;
    const ballSetCheckbox = document.getElementById("ballSetCheckbox").checked;
    const useToggleSetting = document.getElementById("useToggleSetting").checked;

    if (!ballTrackerCheckbox && !ballSetCheckbox && !useToggleSetting) {
        document.getElementById("playerToggleLabel").classList.add("noShow");
    } else {
        document.getElementById("playerToggleLabel").classList.remove("noShow");
    }
}

// Show/hide Replay Controls based on configuration
function updateReplayControlsVisibility() {
    const replaySectionHeader = document.getElementById('replayLabel');
    const replayControlsDiv = document.getElementById('replay-controls');
    // Always show replay controls; configuration alerts fire when buttons are used
    replaySectionHeader.classList.remove('noShow');
    replayControlsDiv.classList.remove('noShow');
}

// Call updateTabVisibility on page load to set initial tab visibility
document.addEventListener("DOMContentLoaded", function () {
    // In your initialization code
    loadReplaySources();
    updateReplayControlsVisibility();
    // updateTabVisibility();
    updateReplayButtonsVisibility();
    updateReplaySourceSettingsVisibility();
    updatePlayerBallControlVisibility();
    initControlPanelTooltips();
});

/**
 * Position a fixed tooltip inside the viewport: prefer above the anchor,
 * flip below if needed, and clamp horizontally so it never widens the tab.
 */
function positionFixedTooltip(tip, anchor) {
    if (!tip || !anchor) {
        return;
    }
    const gap = 6;
    const pad = 8;
    const anchorRect = anchor.getBoundingClientRect();

    // Reset placement so measurement uses natural size within max-width
    tip.style.top = "0px";
    tip.style.left = "0px";
    tip.classList.remove("tooltip-below");

    const tipRect = tip.getBoundingClientRect();
    const tipWidth = tipRect.width || tip.offsetWidth || 0;
    const tipHeight = tipRect.height || tip.offsetHeight || 0;

    let top = anchorRect.top - tipHeight - gap;
    if (top < pad) {
        top = anchorRect.bottom + gap;
        tip.classList.add("tooltip-below");
    }
    if (top + tipHeight > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - pad - tipHeight);
    }

    let left = anchorRect.left + (anchorRect.width / 2) - (tipWidth / 2);
    const maxLeft = window.innerWidth - pad - tipWidth;
    left = Math.min(Math.max(pad, left), Math.max(pad, maxLeft));

    tip.style.top = Math.round(top) + "px";
    tip.style.left = Math.round(left) + "px";
    tip.style.bottom = "auto";
    tip.style.right = "auto";
    tip.style.margin = "0";
    tip.style.transform = "none";
}

function initControlPanelTooltips() {
    const wraps = document.querySelectorAll(".tooltip");
    wraps.forEach(function (wrap) {
        const tip = wrap.querySelector(".tooltiptext");
        if (!tip || wrap._tooltipBound) {
            return;
        }
        wrap._tooltipBound = true;

        const reposition = function () {
            positionFixedTooltip(tip, wrap);
        };

        wrap.addEventListener("mouseenter", reposition);
        wrap.addEventListener("focusin", reposition);
    });

    const refreshOpen = function () {
        document.querySelectorAll(".tooltip:hover").forEach(function (wrap) {
            const tip = wrap.querySelector(".tooltiptext");
            if (tip) {
                positionFixedTooltip(tip, wrap);
            }
        });
    };
    window.addEventListener("resize", refreshOpen);
    window.addEventListener("scroll", refreshOpen, true);
}

function openTab(evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tablinks");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";

    // Save the selected tab to localStorage
    setStorageItem("lastSelectedTab", tabName);
    console.log(`Last Stored Tab- ${tabName}`);
}

document.addEventListener("DOMContentLoaded", function () {
    // Try to get the last selected tab from localStorage
    const lastSelectedTab = getStorageItem("lastSelectedTab");

    if (lastSelectedTab && document.getElementById(lastSelectedTab)) {
        // Convert first letter to lowercase before adding "Tab"
        const buttonId = lastSelectedTab.charAt(0).toLowerCase() + lastSelectedTab.slice(1) + "Tab";
        const tabButton = document.getElementById(buttonId);

        if (tabButton) {
            tabButton.click();
        } else {
            // Fallback to first tab if button not found
            document.querySelector(".tablinks").click();
        }
    } else {
        // Otherwise default to the first tab
        document.querySelector(".tablinks").click();
    }
});

function toggleAnimationSetting() {
    if (!document.getElementById("winAnimation").checked) {
        setStorageItem("winAnimation", "no");
        console.log("Win animation disabled");
    } else if (document.getElementById("winAnimation").checked) {
        setStorageItem("winAnimation", "yes");
        console.log("Win animation enabled");
    }
}

function isDualScoreMode() {
    const type = getStorageItem("gameType");
    if (type === "game5" || type === "game6" || type === "game8") {
        return true;
    }
    return type === "game7" && getStorageItem("pointBased") === "yes";
}

function isStraightPool() {
    return getStorageItem("gameType") === "game4";
}

function isSnooker() {
    return getStorageItem("gameType") === "game8";
}

/** Bank / One Pocket — ball counters decide the rack (first to 8). */
function isPocketScoreGame() {
    const type = getStorageItem("gameType");
    return type === "game5" || type === "game6";
}

const POCKET_RACK_BALL_TARGET = 8;

function isSnookerBallMode() {
    return isSnooker() || getStorageItem("ballSelection") === "snooker";
}

function getPrimaryScoreSuffix() {
    if (isSnooker()) {
        return "Frames";
    }
    return isStraightPool() ? "Balls" : "Racks";
}

function getSecondaryScoreSuffix() {
    return isSnooker() ? "Points" : "Balls";
}

const SNOOKER_BALL_META = {
    1: { file: "snooker-red-small.png", title: "Red Ball (1-point)", points: 1 },
    2: { file: "snooker-yellow-small.png", title: "Yellow Ball (2-point)", points: 2 },
    3: { file: "snooker-green-small.png", title: "Green Ball (3-point)", points: 3 },
    4: { file: "snooker-brown-small.png", title: "Brown Ball (4-point)", points: 4 },
    5: { file: "snooker-blue-small.png", title: "Blue Ball (5-point)", points: 5 },
    6: { file: "snooker-pink-small.png", title: "Pink Ball (6-point)", points: 6 },
    7: { file: "snooker-black-small.png", title: "Black Ball (7-point)", points: 7 },
    8: { file: "snooker-gold-small.png", title: "Golden Ball (20-point)", points: 20 },
    9: { spacer: true, title: "" },
    10: { file: "snooker-freeball-small.png", title: "Free Ball (1-point)", points: 1 },
    11: { file: "snooker-foul-small.png", title: "Foul Ball", foul: true }
};

const SNOOKER_FOUL_POINTS = {
    white: 4,
    yellow: 4,
    green: 4,
    brown: 4,
    gold: 4,
    blue: 5,
    pink: 6,
    black: 7
};

function getSnookerActivePlayer() {
    return getActivePlayerSlot();
}

function getActivePlayerSlot() {
    const stored = getStorageItem("activePlayer");
    if (stored === "1" || stored === "2") {
        return stored;
    }
    const checkbox = document.getElementById("playerToggleCheckbox");
    if (checkbox) {
        return checkbox.checked ? "1" : "2";
    }
    return "1";
}

function isSnookerGoldEnabled() {
    return getStorageItem("snookerGoldEnabled") === "yes";
}

function isSnookerGoldenBallFouled() {
    return getStorageItem("snookerGoldenBallFouled") === "yes";
}

function setSnookerGoldenBallFouled(fouled) {
    setStorageItem("snookerGoldenBallFouled", fouled ? "yes" : "no");
}

/** Golden Ball fouled — removed from the frame; no further pots or fouls on it. */
function removeSnookerGoldenBallFromPlay() {
    setSnookerGoldenBallFouled(true);
    markSnookerColorCleared(8);
}

/** Golden Ball may be potted only when the option is on, final black is cleared, active player has 147+, and it was not fouled off. */
function isSnookerGoldenBallAvailable() {
    if (!isSnookerGoldEnabled() || !isSnookerBallMode()) {
        return false;
    }
    if (isSnookerGoldenBallFouled() || isSnookerColorCleared(8)) {
        return false;
    }
    if (!isSnookerColorCleared(7)) {
        return false;
    }
    const active = getActivePlayerSlot();
    const pts = parseInt(getStorageItem("p" + active + "BallsCtrlPanel"), 10) || 0;
    return pts >= 147;
}

let snookerColorFeedbackTimer = null;
let snookerColorFeedbackBall = null;

function getSnookerRedsPotted() {
    const n = parseInt(getStorageItem("snookerRedsPotted") || "0", 10);
    return Number.isFinite(n) ? Math.min(15, Math.max(0, n)) : 0;
}

/**
 * Reds potted count used for possible-break math. If phase/color and visit points exist
 * but the counter has not caught up yet (async overlay race), treat one red as potted.
 * Freeball visits keep all 15 reds on the table (afterFreeball=yes).
 */
function getEffectiveSnookerRedsPotted() {
    const stored = getSnookerRedsPotted();
    if (
        stored === 0 &&
        getSnookerPhase() === "color" &&
        !getSnookerAfterFreeball() &&
        getSnookerCurrentBreak() > 0
    ) {
        return 1;
    }
    return stored;
}

function setSnookerRedsPotted(n) {
    setStorageItem("snookerRedsPotted", String(Math.min(15, Math.max(0, n))));
}

function getSnookerPhase() {
    return getStorageItem("snookerPhase") === "color" ? "color" : "red";
}

function setSnookerPhase(phase) {
    setStorageItem("snookerPhase", phase === "color" ? "color" : "red");
}

function getSnookerAfterFreeball() {
    return getStorageItem("snookerAfterFreeball") === "yes";
}

function setSnookerAfterFreeball(yes) {
    setStorageItem("snookerAfterFreeball", yes ? "yes" : "no");
}

function clearSnookerColorFeedback() {
    if (snookerColorFeedbackTimer) {
        clearTimeout(snookerColorFeedbackTimer);
        snookerColorFeedbackTimer = null;
    }
    if (snookerColorFeedbackBall) {
        snookerColorFeedbackBall.classList.remove("snooker-ball-clicked");
        snookerColorFeedbackBall = null;
    }
}

function resetSnookerSequenceState(options) {
    const keepReds = options && options.keepReds;
    const keepBreaks = options && options.keepBreaks;
    if (!keepReds) {
        setSnookerRedsPotted(0);
        setSnookerClearedColors([]);
        setSnookerGoldenBallFouled(false);
    }
    setSnookerPhase("red");
    setSnookerAfterFreeball(false);
    clearSnookerColorFeedback();
    if (!keepBreaks) {
        resetSnookerBreakTracking(options && options.keepFrameHighs);
    }
    updateSnookerBallAvailability();
}

function getSnookerClearedColors() {
    try {
        const parsed = JSON.parse(getStorageItem("snookerClearedColors") || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function setSnookerClearedColors(list) {
    setStorageItem("snookerClearedColors", JSON.stringify(Array.isArray(list) ? list : []));
}

function markSnookerColorCleared(ballNum) {
    const cleared = getSnookerClearedColors();
    if (cleared.indexOf(ballNum) === -1) {
        cleared.push(ballNum);
        setSnookerClearedColors(cleared);
    }
}

function isSnookerColorCleared(ballNum) {
    return getSnookerClearedColors().indexOf(ballNum) !== -1;
}

function getSnookerCurrentBreak() {
    return parseInt(getStorageItem("snookerCurrentBreak") || "0", 10) || 0;
}

function setSnookerCurrentBreak(n) {
    setStorageItem("snookerCurrentBreak", String(Math.max(0, n || 0)));
}

function getSnookerFrameHighBreak(player) {
    const key = player === "2" ? "snookerFrameHighBreakP2" : "snookerFrameHighBreakP1";
    return parseInt(getStorageItem(key) || "0", 10) || 0;
}

function setSnookerFrameHighBreak(player, n) {
    const key = player === "2" ? "snookerFrameHighBreakP2" : "snookerFrameHighBreakP1";
    setStorageItem(key, String(Math.max(0, n || 0)));
}

function resetSnookerBreakTracking(keepFrameHighs) {
    setSnookerCurrentBreak(0);
    if (!keepFrameHighs) {
        setSnookerFrameHighBreak("1", 0);
        setSnookerFrameHighBreak("2", 0);
    }
}

/** Add pot points to the active player's continuous break and frame high. */
function addToSnookerBreak(player, points) {
    if (!points || (player !== "1" && player !== "2")) {
        return;
    }
    const nextBreak = getSnookerCurrentBreak() + points;
    setSnookerCurrentBreak(nextBreak);
    if (nextBreak > getSnookerFrameHighBreak(player)) {
        setSnookerFrameHighBreak(player, nextBreak);
    }
}

/** End the current visit without adding foul/award points to the break. */
function endSnookerBreak() {
    setSnookerCurrentBreak(0);
    if (window.PlayerStats && typeof window.PlayerStats.broadcastOverlayStatsIfEnabled === 'function') {
        window.PlayerStats.broadcastOverlayStatsIfEnabled();
    }
}

function getSnookerFrameBreakSnapshot() {
    // Fold any in-progress break into the frame high before snapshotting.
    const active = getSnookerActivePlayer();
    const current = getSnookerCurrentBreak();
    if (current > getSnookerFrameHighBreak(active)) {
        setSnookerFrameHighBreak(active, current);
    }
    return {
        highBreakP1: getSnookerFrameHighBreak("1"),
        highBreakP2: getSnookerFrameHighBreak("2"),
        p1Score: parseInt(getStorageItem("p1BallsCtrlPanel"), 10) || 0,
        p2Score: parseInt(getStorageItem("p2BallsCtrlPanel"), 10) || 0
    };
}

function applySnookerFrameWinToDisplay(winnerSlot) {
    if (winnerSlot !== "1" && winnerSlot !== "2") {
        return;
    }
    const key = "p" + winnerSlot + "ScoreCtrlPanel";
    let frames = parseInt(getStorageItem(key), 10) || 0;
    const raceTarget = getRaceTarget();
    if (raceTarget !== null && frames >= raceTarget) {
        return;
    }
    frames = Math.min(999, frames + 1);
    setStorageItem(key, frames);
    setStorageItem("p" + winnerSlot + "Score", frames);
    const input = document.getElementById("p" + winnerSlot + "Score");
    if (input) {
        input.value = frames;
    }
    bc.postMessage({ player: winnerSlot, score: frames });
    if (winnerSlot === "1") {
        p1ScoreValue = frames;
    } else {
        p2ScoreValue = frames;
    }
}

function updateSnookerRackFrameLabels() {
    updateResetScoreButton();
    const racksHeader = document.getElementById("statsBoardRacksHeader");
    if (racksHeader) {
        racksHeader.textContent = isSnooker() ? "Frames W/L" : "Racks W/L";
    }
    const raceLabel = document.getElementById("raceInfo");
    if (raceLabel) {
        raceLabel.textContent = isSnooker() ? "Best Of:" : "Race Info:";
    }
}

function isRaceComplete() {
    return isGameScoringLocked();
}

/** Primary rack/frame scores meet the race / Best Of target — match is over until End Match. */
function isGameScoringLocked() {
    const raceTarget = getRaceTarget();
    if (raceTarget === null) {
        return false;
    }
    const p1Input = document.getElementById("p1Score");
    const p2Input = document.getElementById("p2Score");
    const p1Value = p1Input
        ? (parseInt(p1Input.value, 10) || 0)
        : (parseInt(getStorageItem("p1ScoreCtrlPanel"), 10) || 0);
    const p2Value = p2Input
        ? (parseInt(p2Input.value, 10) || 0)
        : (parseInt(getStorageItem("p2ScoreCtrlPanel"), 10) || 0);
    return p1Value >= raceTarget || p2Value >= raceTarget;
}

function updateBallTrackerLockState() {
    const locked = isGameScoringLocked();
    const tracker = document.getElementById("ballTracker");
    if (tracker) {
        tracker.classList.toggle("ball-tracker-locked", locked);
    }
    document.querySelectorAll("#ballTracker .ball").forEach(function (ball) {
        if (locked) {
            ball.classList.add("snooker-ball-disabled");
            ball.setAttribute("aria-disabled", "true");
        } else if (!isSnookerBallMode()) {
            ball.classList.remove("snooker-ball-disabled");
            ball.removeAttribute("aria-disabled");
        }
    });
    if (!locked && isSnookerBallMode()) {
        updateSnookerBallAvailability();
    }
    ["sendP1Balls", "sendP1BallsSub", "sendP2Balls", "sendP2BallsSub"].forEach(function (id) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = locked;
            btn.classList.toggle("disabled", locked);
        }
    });
    ["p1Balls", "p2Balls"].forEach(function (id) {
        const input = document.getElementById(id);
        if (input) {
            input.readOnly = locked;
            input.classList.toggle("read-only", locked);
        }
    });
    if (locked) {
        cancelSnookerFoul();
    }
}

/** Label/style for reset: "Reset Score" until race/Best Of is met, then "End Match". Always danger. */
function updateResetScoreButton() {
    const resetBtn = document.getElementById("resetScores");
    if (!resetBtn) {
        return;
    }
    resetBtn.textContent = isRaceComplete() ? "End Match" : "Reset Score";
    resetBtn.classList.add("danger-btn");
    // Danger class owns color; clear any leftover inline race-complete green.
    resetBtn.style.backgroundColor = "";
    resetBtn.style.color = "";
}

/** Show Call Match Early when racks/frames exist and the race is not yet complete. */
function updateCallGameButton() {
    const wrap = document.getElementById("callGameWrap");
    if (!wrap) {
        return;
    }
    const canCall = !isRaceComplete() &&
        window.PlayerStats &&
        typeof window.PlayerStats.canCallGame === "function" &&
        window.PlayerStats.canCallGame();
    wrap.classList.toggle("noShow", !canCall);
}

function setSnookerBallDisabled(ballNum, disabled) {
    const el = document.getElementById("ball " + ballNum);
    if (!el) {
        return;
    }
    el.classList.toggle("snooker-ball-disabled", !!disabled);
    el.setAttribute("aria-disabled", disabled ? "true" : "false");
}

function getSnookerRemainingReds() {
    return Math.max(0, 15 - getEffectiveSnookerRedsPotted());
}

function refreshSnookerOverlayStats() {
    if (window.PlayerStats && typeof window.PlayerStats.publishSnookerOverlayLiveStats === "function") {
        window.PlayerStats.publishSnookerOverlayLiveStats();
    } else if (window.PlayerStats && typeof window.PlayerStats.broadcastOverlayStatsIfEnabled === "function") {
        window.PlayerStats.broadcastOverlayStatsIfEnabled();
    }
}

/** True once the frame is in colors-only clearance and yellow→black are all off the table. */
function areSnookerColorsAllCleared() {
    if (getSnookerRemainingReds() > 0) {
        return false;
    }
    for (let i = 2; i <= 7; i++) {
        if (!isSnookerColorCleared(i)) {
            return false;
        }
    }
    return true;
}

/** Next color that must be potted in clearance order (yellow→…→black), or null if all cleared. */
function getNextSnookerClearanceColor() {
    for (let i = 2; i <= 7; i++) {
        if (!isSnookerColorCleared(i)) {
            return i;
        }
    }
    return null;
}

/** Final-colors package: 27 normally, or 47 when Golden Ball is enabled and still in play. */
function getSnookerFinalColorsPoints() {
    let pts = 27;
    if (isSnookerGoldEnabled() && !isSnookerGoldenBallFouled() && !isSnookerColorCleared(8)) {
        pts += (SNOOKER_BALL_META[8] && SNOOKER_BALL_META[8].points) || 20;
    }
    return pts;
}

/**
 * Absolute max points still available from balls on the table (frame mathematics).
 * Includes an owed color after a red — that ball is still on the table.
 */
function getSnookerPointsRemainingOnTable() {
    if (!isSnookerBallMode()) {
        return 0;
    }
    const expectColor = getSnookerPhase() === "color";
    const redsOnTable = getSnookerRemainingReds();
    let pts = 0;

    if (redsOnTable > 0 || (expectColor && getEffectiveSnookerRedsPotted() < 15)) {
        pts += redsOnTable * 8;
        if (expectColor) {
            pts += 7;
        }
        pts += getSnookerFinalColorsPoints();
        return pts;
    }

    if (expectColor) {
        pts += 7;
        pts += getSnookerFinalColorsPoints();
        return pts;
    }

    for (let i = 2; i <= 7; i++) {
        if (!isSnookerColorCleared(i)) {
            pts += (SNOOKER_BALL_META[i] && SNOOKER_BALL_META[i].points) || 0;
        }
    }
    if (isSnookerGoldEnabled() && !isSnookerGoldenBallFouled() && !isSnookerColorCleared(8)) {
        pts += (SNOOKER_BALL_META[8] && SNOOKER_BALL_META[8].points) || 20;
    }
    return pts;
}

/**
 * Remaining points for a player's maximum continuing break:
 * - 8 per unpotted red (red + black)
 * - if this player is at the table and just potted a red (phase=color), +7 for that visit's color
 * - then 27 (or 47 with Golden Ball) while reds remain / before clearance
 * - during clearance, only the uncleared colors (in order) + gold if still available
 *
 * Color-phase +7 is visit-scoped: if the striker misses, the incoming player is on a red
 * (or yellow in clearance), not owed a color.
 */
function getSnookerRemainingTablePoints(playerSlot) {
    if (!isSnookerBallMode()) {
        return 0;
    }
    let pts = getSnookerPointsRemainingOnTable();
    const slot = playerSlot === "2" || playerSlot === 2 ? "2" : (playerSlot === "1" || playerSlot === 1 ? "1" : null);
    const atTable = !slot || getActivePlayerSlot() === slot;
    if (!atTable && getSnookerPhase() === "color") {
        pts = Math.max(0, pts - 7);
    }
    return pts;
}

/**
 * Possible break = current break (active player) + remaining table potential for that player.
 */
function getSnookerPossibleBreak(playerSlot) {
    if (!isSnookerBallMode()) {
        return 0;
    }
    const slot = playerSlot === "2" || playerSlot === 2 ? "2" : "1";
    const current = getActivePlayerSlot() === slot ? getSnookerCurrentBreak() : 0;
    return current + getSnookerRemainingTablePoints(slot);
}

/**
 * Frame score margin vs opponent, compared to points left on the table.
 * Remaining uses the inactive player's possible break (no owed-color), which matches
 * true table potential if the striker misses.
 * When |diff| > remaining, the trailing player cannot catch up without fouls:
 *   lagging → pointsRemainingTone "danger" (red)
 *   leading → pointsRemainingTone "safe" (green)
 * showMargin is false while both players are still on 0 frame points.
 */
function getSnookerScoreMargin(playerSlot) {
    if (!isSnookerBallMode()) {
        return {
            diff: 0,
            remaining: 0,
            display: "0",
            critical: false,
            safe: false,
            pointsRemainingTone: "",
            showMargin: false
        };
    }
    const slot = playerSlot === "2" || playerSlot === 2 ? "2" : "1";
    const other = slot === "1" ? "2" : "1";
    const mine = parseInt(getStorageItem("p" + slot + "BallsCtrlPanel"), 10) || 0;
    const theirs = parseInt(getStorageItem("p" + other + "BallsCtrlPanel"), 10) || 0;
    const showMargin = mine !== 0 || theirs !== 0;
    const diff = mine - theirs;
    const active = getActivePlayerSlot();
    const inactive = active === "1" ? "2" : "1";
    const remaining = getSnookerPossibleBreak(inactive);
    let display;
    if (diff > 0) {
        display = "+" + diff;
    } else if (diff < 0) {
        display = String(diff);
    } else {
        display = "0";
    }
    const cannotComeback = Math.abs(diff) > remaining;
    const critical = showMargin && diff < 0 && cannotComeback;
    const safe = showMargin && diff > 0 && cannotComeback;
    return {
        diff: diff,
        remaining: remaining,
        display: display,
        critical: critical,
        safe: safe,
        pointsRemainingTone: critical ? "danger" : (safe ? "safe" : ""),
        showMargin: showMargin
    };
}

function updateSnookerBallAvailability() {
    if (!isSnookerBallMode()) {
        for (let i = 1; i <= 11; i++) {
            const el = document.getElementById("ball " + i);
            if (el) {
                el.classList.remove("snooker-ball-disabled", "snooker-ball-clicked");
                el.removeAttribute("aria-disabled");
            }
        }
        return;
    }

    if (isGameScoringLocked()) {
        for (let i = 1; i <= 11; i++) {
            setSnookerBallDisabled(i, true);
        }
        updateSnookerGoldVisibility();
        return;
    }

    const phase = getSnookerPhase();
    const reds = getSnookerRedsPotted();
    const redsDone = reds >= 15;
    const expectColor = phase === "color";
    // After all reds and the color that follows the 15th red, colors-only clearance.
    const clearance = redsDone && !expectColor;
    const allColorsCleared = areSnookerColorsAllCleared();
    const nextClearanceColor = clearance ? getNextSnookerClearanceColor() : null;

    setSnookerBallDisabled(1, expectColor || redsDone);
    // Free ball: available on reds (as red substitute) and during colors-only clearance;
    // not while a color is required after a red/freeball, and not after all colors are gone.
    setSnookerBallDisabled(10, expectColor || allColorsCleared);

    if (clearance) {
        // Must pot yellow→green→brown→blue→pink→black in order
        for (let i = 2; i <= 7; i++) {
            const el = document.getElementById("ball " + i);
            if (el && el.classList.contains("snooker-ball-clicked")) {
                setSnookerBallDisabled(i, true);
                continue;
            }
            setSnookerBallDisabled(i, i !== nextClearanceColor);
        }
    } else {
        const colorsEnabled = expectColor;
        for (let i = 2; i <= 7; i++) {
            const el = document.getElementById("ball " + i);
            if (el && el.classList.contains("snooker-ball-clicked")) {
                setSnookerBallDisabled(i, true);
                continue;
            }
            setSnookerBallDisabled(i, !colorsEnabled);
        }
    }

    // Golden Ball: option toggle may show it; only enabled after final black + 147; stays off if fouled or potted.
    if (isSnookerGoldEnabled()) {
        const goldenEl = document.getElementById("ball 8");
        if (goldenEl && (isSnookerGoldenBallFouled() || isSnookerColorCleared(8))) {
            setSnookerBallDisabled(8, true);
        } else if (goldenEl && goldenEl.classList.contains("snooker-ball-clicked")) {
            setSnookerBallDisabled(8, true);
        } else {
            setSnookerBallDisabled(8, !isSnookerGoldenBallAvailable());
        }
    }

    // Foul ball is unavailable once the frame has no colors left to foul on.
    setSnookerBallDisabled(11, allColorsCleared);
    updateSnookerGoldVisibility();
}

function flashSnookerColorFeedback(ballEl, afterFeedback) {
    clearSnookerColorFeedback();
    if (ballEl) {
        snookerColorFeedbackBall = ballEl;
        ballEl.classList.add("snooker-ball-clicked", "snooker-ball-disabled");
        ballEl.setAttribute("aria-disabled", "true");
    }
    if (typeof afterFeedback === "function") {
        afterFeedback();
    } else {
        updateSnookerBallAvailability();
    }
    if (ballEl) {
        requestAnimationFrame(function () {
            if (snookerColorFeedbackBall === ballEl) {
                ballEl.classList.remove("snooker-ball-clicked");
                snookerColorFeedbackBall = null;
            }
        });
    }
}

function refreshBallSelectionOptions() {
    const select = document.getElementById("ballSelection");
    if (!select) {
        return;
    }
    const snookerOption = select.querySelector('option[value="snooker"]');
    if (!snookerOption) {
        return;
    }
    const game = getStorageItem("gameType") || "game1";
    const allowSnooker = game === "game7" || game === "game8";
    snookerOption.disabled = !allowSnooker;
    snookerOption.hidden = !allowSnooker;
    if (!allowSnooker && (select.value === "snooker" || getStorageItem("ballSelection") === "snooker")) {
        select.value = "american";
        setStorageItem("ballSelection", "american");
        updateControlPanelBallImages("american");
        bc.postMessage({ ballSelection: "american" });
    }
}

function enableActivePlayerTrackerAids() {
    const bothPlayers = getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes";
    if (bothPlayers) {
        const toggleCheckbox = document.getElementById("useToggleSetting");
        if (toggleCheckbox) {
            toggleCheckbox.checked = true;
            toggleSetting();
        }
    }
    const trackerCheckbox = document.getElementById("ballTrackerCheckbox");
    if (trackerCheckbox && !trackerCheckbox.checked) {
        trackerCheckbox.checked = true;
        setStorageItem("enableBallTracker", "yes");
    }
}

function enableSnookerScoringAids() {
    enableActivePlayerTrackerAids();
}

function enablePocketScoringAids() {
    enableActivePlayerTrackerAids();
}

function updateSnookerUiVisibility() {
    const snookerMode = isSnookerBallMode();
    const goldDiv = document.getElementById("snookerGoldDiv");
    const goldCheckbox = document.getElementById("snookerGoldCheckbox");
    if (goldDiv) {
        goldDiv.classList[snookerMode ? "remove" : "add"]("noShow");
    }
    if (goldCheckbox) {
        goldCheckbox.checked = isSnookerGoldEnabled();
    }
    const game = getStorageItem("gameType");
    const ballSetDiv = document.getElementById("ballSetDiv");
    if (game === "game7" && ballSetDiv) {
        if (snookerMode) {
            ballSetDiv.classList.add("noShow");
            document.getElementById("ballSetCheckbox").checked = false;
            setStorageItem("useBallSet", "no");
            document.getElementById("ballTypeDiv").classList.remove("noShow");
        } else {
            ballSetDiv.classList.remove("noShow");
        }
    }
    updateSnookerGoldVisibility();
    if (snookerMode) {
        updateSnookerBallAvailability();
        setStorageItem("enableBallDisplay", "no");
        const displayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (displayCheckbox) {
            displayCheckbox.checked = false;
        }
    }
    if (typeof syncBallDisplayControls === "function") {
        syncBallDisplayControls();
    }
}

function updateSnookerGoldVisibility() {
    const optionOn = isSnookerGoldEnabled();
    const ball8 = document.getElementById("ball 8");
    const foulGold = document.getElementById("snookerFoulGold");
    if (!isSnookerBallMode()) {
        // Golden option hides ball 8 in snooker; restore it for pool trackers.
        if (ball8) {
            ball8.classList.remove("noShow");
        }
        if (foulGold) {
            foulGold.classList.add("noShow");
        }
        return;
    }
    if (ball8) {
        // Option off → hide. Option on → show (disabled until 147 + final black).
        ball8.classList[optionOn ? "remove" : "add"]("noShow");
    }
    if (foulGold) {
        // Golden Ball foul while the ball is still in play (option on, not yet fouled off).
        const foulGoldAvailable = optionOn && !isSnookerGoldenBallFouled();
        foulGold.classList[foulGoldAvailable ? "remove" : "add"]("noShow");
    }
}

function snookerGoldToggle() {
    const checkbox = document.getElementById("snookerGoldCheckbox");
    const enabled = checkbox && checkbox.checked;
    setStorageItem("snookerGoldEnabled", enabled ? "yes" : "no");
    updateSnookerGoldVisibility();
    updateSnookerBallAvailability();
    if (!enabled) {
        cancelSnookerFoul();
    }
}

function applySnookerTrackerLayout() {
    const snookerMode = isSnookerBallMode();
    for (let i = 1; i <= 15; i++) {
        const ball = document.getElementById(`ball ${i}`);
        if (!ball) {
            continue;
        }
        ball.classList.remove("snooker-spacer", "faded");
        if (!snookerMode) {
            const img = ball.querySelector("img");
            if (img) {
                img.style.display = "";
            }
            ball.classList.remove("snooker-ball-disabled", "snooker-ball-clicked", "noShow");
            ball.removeAttribute("aria-disabled");
            continue;
        }
        if (i >= 12) {
            ball.classList.add("noShow");
            continue;
        }
        if (i === 9) {
            ball.classList.remove("noShow");
            ball.classList.add("snooker-spacer");
            ball.removeAttribute("title");
            const img = ball.querySelector("img");
            if (img) {
                img.style.display = "none";
            }
            continue;
        }
        ball.classList.remove("noShow");
        const img = ball.querySelector("img");
        if (img) {
            img.style.display = "";
        }
    }
    if (snookerMode) {
        updateControlPanelBallImages("snooker");
        updateSnookerGoldVisibility();
        updateSnookerBallAvailability();
    } else {
        // Restore balls 10-15 for non-snooker (gameType may still hide some for 9/10-ball)
        const game = getStorageItem("gameType");
        if (game === "game2") {
            ["10", "11", "12", "13", "14", "15"].forEach(function (num) {
                const el = document.getElementById("ball " + num);
                if (el) {
                    el.classList.add("noShow");
                }
            });
        } else if (game === "game3") {
            const b10 = document.getElementById("ball 10");
            if (b10) {
                b10.classList.remove("noShow");
            }
            ["11", "12", "13", "14", "15"].forEach(function (num) {
                const el = document.getElementById("ball " + num);
                if (el) {
                    el.classList.add("noShow");
                }
            });
        } else {
            ["10", "11", "12", "13", "14", "15"].forEach(function (num) {
                const el = document.getElementById("ball " + num);
                if (el) {
                    el.classList.remove("noShow");
                }
            });
        }
        // Leaving snooker layout must also restore pool ball art for the active ball type
        updateControlPanelBallImages(getStorageItem("ballSelection") || "american");
    }
}

function addSnookerPoints(player, delta) {
    if (!delta || (player !== "1" && player !== "2")) {
        return false;
    }
    // Race lock is based on frame score (primary), not in-frame points.
    let p1Frames = parseInt(getStorageItem("p1ScoreCtrlPanel"), 10) || 0;
    let p2Frames = parseInt(getStorageItem("p2ScoreCtrlPanel"), 10) || 0;
    const raceTarget = getRaceTarget();
    const raceLocked = raceTarget !== null && (p1Frames >= raceTarget || p2Frames >= raceTarget);

    if (raceLocked) {
        updateScoreControlAvailability();
        return false;
    }

    let current = parseInt(getStorageItem("p" + player + "BallsCtrlPanel"), 10) || 0;
    let next = current + delta;
    if (next < 0) {
        next = 0;
    }
    if (next > 999) {
        next = 999;
    }
    if (next === current) {
        return false;
    }

    setStorageItem("p" + player + "BallsCtrlPanel", next);
    setStorageItem("p" + player + "Balls", next);
    const ballsInput = document.getElementById("p" + player + "Balls");
    if (ballsInput) {
        ballsInput.value = next;
    }
    bc.postMessage({ player: player, balls: next });
    stopClock();
    updateScoreControlAvailability();
    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
    return true;
}

function recordSnookerBallPotted(player) {
    if (!window.PlayerStats || typeof window.PlayerStats.recordBallWin !== "function") {
        return;
    }
    if (player !== "1" && player !== "2") {
        return;
    }
    window.PlayerStats.recordBallWin(player).catch(function (err) {
        console.error("PlayerStats snooker ball pot error:", err);
    });
}

function openSnookerFoulPicker() {
    if (isGameScoringLocked()) {
        return;
    }
    const modal = document.getElementById("snookerFoulModal");
    if (!modal) {
        return;
    }
    updateSnookerGoldVisibility();
    clearSnookerFoulHoverLabel();
    modal.style.display = "block";
}

function cancelSnookerFoul() {
    const modal = document.getElementById("snookerFoulModal");
    if (modal) {
        modal.style.display = "none";
    }
    clearSnookerFoulHoverLabel();
}

function snookerFoulModalBackdrop(event) {
    if (event && event.target && event.target.id === "snookerFoulModal") {
        cancelSnookerFoul();
    }
}

function updateSnookerFoulHoverLabel(element) {
    const label = document.getElementById("snookerFoulHoverLabel");
    if (!label || !element) {
        return;
    }
    const foulKey = element.getAttribute("data-foul");
    const points = SNOOKER_FOUL_POINTS[foulKey];
    if (!points) {
        label.textContent = "";
        return;
    }
    label.textContent = points + "-point foul";
}

function clearSnookerFoulHoverLabel() {
    const label = document.getElementById("snookerFoulHoverLabel");
    if (label) {
        label.textContent = "";
    }
}

function selectSnookerFoul(element) {
    if (!element || !isSnookerBallMode()) {
        return;
    }
    const foulKey = element.getAttribute("data-foul");
    if (foulKey === "gold") {
        if (!isSnookerGoldEnabled() || isSnookerGoldenBallFouled()) {
            return;
        }
    }
    const points = SNOOKER_FOUL_POINTS[foulKey];
    if (!points) {
        return;
    }
    const active = getSnookerActivePlayer();
    const opponent = active === "1" ? "2" : "1";
    addSnookerPoints(opponent, points);
    // Foul ends the active player's break (foul points are not break points).
    endSnookerBreak();
    // Break ended — next shot can be a red (unless all reds are gone).
    setSnookerPhase("red");
    setSnookerAfterFreeball(false);
    clearSnookerColorFeedback();
    if (foulKey === "gold") {
        removeSnookerGoldenBallFromPlay();
    }
    updateSnookerBallAvailability();
    updateSnookerGoldVisibility();
    cancelSnookerFoul();
    console.log(`Snooker foul (${foulKey}) awarded ${points} to player ${opponent}`);
}

function handleSnookerBallClick(element) {
    if (!element || !element.id || isGameScoringLocked()) {
        return;
    }
    if (element.classList.contains("snooker-ball-disabled") || element.getAttribute("aria-disabled") === "true") {
        return;
    }
    const match = element.id.match(/^ball\s+(\d+)$/);
    if (!match) {
        return;
    }
    const num = parseInt(match[1], 10);
    const meta = SNOOKER_BALL_META[num];
    if (!meta || meta.spacer) {
        return;
    }
    if (meta.foul) {
        openSnookerFoulPicker();
        return;
    }
    if (num === 8) {
        if (!isSnookerGoldenBallAvailable()) {
            return;
        }
        const scorer = getSnookerActivePlayer();
        if (!addSnookerPoints(scorer, meta.points)) {
            return;
        }
        addToSnookerBreak(scorer, meta.points);
        markSnookerColorCleared(8);
        flashSnookerColorFeedback(element, function () {
            updateSnookerBallAvailability();
            refreshSnookerOverlayStats();
        });
        refreshSnookerOverlayStats();
        queueMicrotask(function () {
            recordSnookerBallPotted(scorer);
        });
        return;
    }
    if (typeof meta.points !== "number") {
        return;
    }

    const phase = getSnookerPhase();
    const reds = getSnookerRedsPotted();
    const isRed = num === 1;
    const isFreeball = num === 10;
    const isColor = num >= 2 && num <= 7;
    const redsDone = reds >= 15;
    const expectColor = phase === "color";
    const clearance = redsDone && !expectColor;

    if (isRed) {
        if (expectColor || redsDone) {
            return;
        }
        const scorer = getSnookerActivePlayer();
        if (!addSnookerPoints(scorer, meta.points)) {
            return;
        }
        addToSnookerBreak(scorer, meta.points);
        setSnookerRedsPotted(reds + 1);
        setSnookerAfterFreeball(false);
        setSnookerPhase("color");
        updateSnookerBallAvailability();
        refreshSnookerOverlayStats();
        queueMicrotask(function () {
            recordSnookerBallPotted(scorer);
        });
        return;
    }

    if (isFreeball) {
        // Free ball substitutes for a red during the reds phase, or is allowed in colors-only clearance.
        if (expectColor) {
            return;
        }
        if (!clearance && redsDone) {
            return;
        }
        const scorer = getSnookerActivePlayer();
        if (!addSnookerPoints(scorer, meta.points)) {
            return;
        }
        addToSnookerBreak(scorer, meta.points);
        if (!clearance) {
            setSnookerAfterFreeball(true);
            setSnookerPhase("color");
        }
        updateSnookerBallAvailability();
        refreshSnookerOverlayStats();
        queueMicrotask(function () {
            recordSnookerBallPotted(scorer);
        });
        return;
    }

    if (isColor) {
        if (!expectColor && !clearance) {
            return;
        }
        if (clearance) {
            const nextColor = getNextSnookerClearanceColor();
            if (num !== nextColor) {
                return;
            }
        }
        if (clearance && isSnookerColorCleared(num)) {
            return;
        }
        const scorer = getSnookerActivePlayer();
        if (!addSnookerPoints(scorer, meta.points)) {
            return;
        }
        addToSnookerBreak(scorer, meta.points);

        const afterFreeball = getSnookerAfterFreeball();
        setSnookerAfterFreeball(false);

        if (clearance) {
            // Colors-only phase: potting a color removes it for the rest of the frame.
            markSnookerColorCleared(num);
            flashSnookerColorFeedback(element, function () {
                setSnookerPhase("red");
                updateSnookerBallAvailability();
                refreshSnookerOverlayStats();
            });
            refreshSnookerOverlayStats();
            queueMicrotask(function () {
                recordSnookerBallPotted(scorer);
            });
            return;
        }

        // Reds phase (or color after 15th red): lock colors briefly, then return to red/clearance.
        for (let i = 2; i <= 7; i++) {
            setSnookerBallDisabled(i, true);
        }
        if (isSnookerGoldEnabled()) {
            setSnookerBallDisabled(8, true);
        }

        flashSnookerColorFeedback(element, function () {
            setSnookerPhase("red");
            updateSnookerBallAvailability();
            refreshSnookerOverlayStats();
            if (afterFreeball) {
                console.log("Snooker color after freeball — sequence returns to red/color alternation");
            }
        });
        refreshSnookerOverlayStats();
        queueMicrotask(function () {
            recordSnookerBallPotted(scorer);
        });
        return;
    }
}

function updateActivePlayerNameDisplay() {
    const display = document.getElementById("activePlayerNameDisplay");
    if (!display) {
        return;
    }
    const checkbox = document.getElementById("playerToggleCheckbox");
    const isP1 = checkbox ? checkbox.checked : getStorageItem("activePlayer") !== "2";
    const p1Name = (document.getElementById("p1Name")?.value || "").trim();
    const p2Name = (document.getElementById("p2Name")?.value || "").trim();
    display.textContent = isP1 ? (p1Name || "Player 1") : (p2Name || "Player 2");
}

function updateScoreLabels() {
    const suffix = getPrimaryScoreSuffix();
    const p1Name = (document.getElementById("p1Name")?.value || "").trim();
    const p2Name = (document.getElementById("p2Name")?.value || "").trim();
    const p1BallsLabel = document.getElementById("p1BallsLabel");
    const p2BallsLabel = document.getElementById("p2BallsLabel");

    document.getElementById("p1ScoreLabel").innerHTML = (p1Name || "Player/Team 1") + " - " + suffix;
    document.getElementById("p2ScoreLabel").innerHTML = (p2Name || "Player/Team 2") + " - " + suffix;

    if (p1BallsLabel) {
        p1BallsLabel.innerHTML = (p1Name || "Player/Team 1") + " - " + getSecondaryScoreSuffix();
    }
    if (p2BallsLabel) {
        p2BallsLabel.innerHTML = (p2Name || "Player/Team 2") + " - " + getSecondaryScoreSuffix();
    }
    updateActivePlayerNameDisplay();
}

function updateScoreModeUI() {
    const bothPlayersEnabled = getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes";
    const dualMode = isDualScoreMode() && bothPlayersEnabled;
    const isCustom = getStorageItem("gameType") === "game7";
    const pointBasedDiv = document.getElementById("pointBasedDiv");
    const scoreInfoP1Balls = document.getElementById("scoreInfoP1Balls");
    const scoreInfoP2Balls = document.getElementById("scoreInfoP2Balls");

    if (pointBasedDiv) {
        pointBasedDiv.classList[isCustom ? "remove" : "add"]("noShow");
    }

    if (scoreInfoP1Balls) {
        scoreInfoP1Balls.classList[dualMode ? "remove" : "add"]("noShow");
    }
    if (scoreInfoP2Balls) {
        scoreInfoP2Balls.classList[dualMode ? "remove" : "add"]("noShow");
    }

    updateScoreLabels();

    const dualDisplay = dualMode ? "yes" : "no";
    setStorageItem("dualScoreDisplay", dualDisplay);
    bc.postMessage({ dualScoreDisplay: dualDisplay });

    if (window.PlayerStats && typeof window.PlayerStats.onScoreModeChanged === "function") {
        window.PlayerStats.onScoreModeChanged();
    }
    updateSnookerRackFrameLabels();
}

function pointBasedSetting() {
    const checkbox = document.getElementById("pointBased");
    const enabled = checkbox && checkbox.checked;
    setStorageItem("pointBased", enabled ? "yes" : "no");
    updateScoreModeUI();

    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
}

let gameTypeSwitchChain = Promise.resolve();

/**
 * Finalize the open match before leaving a game type:
 * End Match if race/Best Of is complete, Call Match Early if racks/frames exist, else Reset Score.
 * Must run while storage still has the previous gameType.
 */
function finalizeMatchBeforeGameTypeSwitch() {
    if (isRaceComplete()) {
        performResetScores({ endMatch: true });
        return Promise.resolve("endMatch");
    }
    if (window.PlayerStats &&
        typeof window.PlayerStats.canCallGame === "function" &&
        window.PlayerStats.canCallGame() &&
        typeof window.PlayerStats.callGame === "function") {
        return window.PlayerStats.callGame().then(function (saved) {
            performResetScores({ endMatch: !!saved });
            return saved ? "callGame" : "reset";
        }).catch(function (err) {
            console.error("PlayerStats callGame on game-type switch error:", err);
            performResetScores({ endMatch: false });
            return "reset";
        });
    }
    performResetScores({ endMatch: false });
    return Promise.resolve("reset");
}

function gameType(value, options) {
    const run = function () {
        const restore = !!(options && options.restore);
        const previous = getStorageItem("gameType");
        const switching = !restore && previous != null && String(value) !== String(previous);

        if (!switching) {
            applyGameTypeChange(value, options);
            return Promise.resolve();
        }

        // Finalize under the previous game type, then apply the new one.
        return finalizeMatchBeforeGameTypeSwitch().then(function () {
            applyGameTypeChange(value, options);
        });
    };
    // Serialize switches so rapid changes cannot overlap Call Game / apply.
    gameTypeSwitchChain = gameTypeSwitchChain.then(run, run);
    return gameTypeSwitchChain;
}

function applyGameTypeChange(value, options) {
    const restore = !!(options && options.restore);
    setStorageItem("gameType", value);

    const gameType = getStorageItem("gameType");
    cancelSnookerFoul();

    // 9-Ball or 10-Ball -> hide both
    if (["game2", "game3"].includes(gameType)) {
        document.getElementById("ballSetDiv").classList.add("noShow");
        document.getElementById("ballTypeDiv").classList.add("noShow");
        document.getElementById("ballSetCheckbox").checked = false;
        setStorageItem("useBallSet", "no");
        setStorageItem("ballSelection", "american");
        document.getElementById("ballSelection").value = "american";
        ballType("american");

        // 8-Ball or Custom -> show both
    } else if (["game1", "game7"].includes(gameType)) {
        document.getElementById("ballSetDiv").classList.remove("noShow");
        document.getElementById("ballTypeDiv").classList.remove("noShow");
        const ballSelectionWrap = document.getElementById("ballSelectionWrap");
        if (ballSelectionWrap) {
            ballSelectionWrap.classList.remove("noShow");
        }
        document.getElementById("ballSetCheckbox").disabled = false;
        document.getElementById('p1colorOpen').checked = true;
        setStorageItem("playerBallSet", "p1Open");
        bc.postMessage({ playerBallSet: "p1Open" });
        // Leaving Snooker: drop forced snooker ball set (Custom may still choose snooker via Ball Type)
        if (getStorageItem("ballSelection") === "snooker") {
            setStorageItem("ballSelection", "american");
        }
        const currentBall = getStorageItem("ballSelection") || "american";
        document.getElementById("ballSelection").value = currentBall;
        ballType(currentBall);
        console.log("Ball set toggle enabled and reset to Open Table");

        // Snooker -> force snooker balls; show gold toggle only (no ball set / type dropdown)
    } else if (gameType === "game8") {
        document.getElementById("ballSetDiv").classList.add("noShow");
        document.getElementById("ballTypeDiv").classList.remove("noShow");
        const ballSelectionWrap = document.getElementById("ballSelectionWrap");
        if (ballSelectionWrap) {
            ballSelectionWrap.classList.add("noShow");
        }
        document.getElementById("ballSetCheckbox").checked = false;
        setStorageItem("useBallSet", "no");
        setStorageItem("playerBallSet", "p1Open");
        document.getElementById('p1colorOpen').checked = true;
        bc.postMessage({ playerBallSet: "p1Open" });
        setStorageItem("ballSelection", "snooker");
        document.getElementById("ballSelection").value = "snooker";
        ballType("snooker");
        enableSnookerScoringAids();
        // Page restore must keep live visit break / reds / clearance; switching into Snooker resets
        if (!restore) {
            resetSnookerSequenceState();
        } else {
            updateSnookerBallAvailability();
        }

        // All other game types -> hide ball set, show ball type
    } else {
        document.getElementById("ballSetDiv").classList.add("noShow");
        document.getElementById("ballTypeDiv").classList.remove("noShow");
        const ballSelectionWrap = document.getElementById("ballSelectionWrap");
        if (ballSelectionWrap) {
            ballSelectionWrap.classList.remove("noShow");
        }
        document.getElementById("ballSetCheckbox").checked = false;
        setStorageItem("useBallSet", "no");
        if (getStorageItem("ballSelection") === "snooker") {
            setStorageItem("ballSelection", "american");
        }
        document.getElementById("ballSelection").value = getStorageItem("ballSelection") || "american";
        ballType(document.getElementById("ballSelection").value);
        if (isPocketScoreGame()) {
            enablePocketScoringAids();
        }
    }

    refreshBallSelectionOptions();
    applySnookerTrackerLayout();

    if (getStorageItem("gameType") === "game2") {
        document.getElementById("ball 10").classList.add("noShow");
        document.getElementById("ball 11").classList.add("noShow");
        document.getElementById("ball 12").classList.add("noShow");
        document.getElementById("ball 13").classList.add("noShow");
        document.getElementById("ball 14").classList.add("noShow");
        document.getElementById("ball 15").classList.add("noShow");
    } else if (getStorageItem("gameType") === "game3") {
        document.getElementById("ball 10").classList.remove("noShow");
        document.getElementById("ball 11").classList.add("noShow");
        document.getElementById("ball 12").classList.add("noShow");
        document.getElementById("ball 13").classList.add("noShow");
        document.getElementById("ball 14").classList.add("noShow");
        document.getElementById("ball 15").classList.add("noShow");
    } else if (!isSnookerBallMode()) {
        document.getElementById("ball 10").classList.remove("noShow");
        document.getElementById("ball 11").classList.remove("noShow");
        document.getElementById("ball 12").classList.remove("noShow");
        document.getElementById("ball 13").classList.remove("noShow");
        document.getElementById("ball 14").classList.remove("noShow");
        document.getElementById("ball 15").classList.remove("noShow");
    }
    bc.postMessage({ gameType: value, ballSelection: getStorageItem("ballSelection") });
    updateScoreModeUI();
    updateSnookerUiVisibility();
    updateScoreControlAvailability();
    const raceVal = (document.getElementById("raceInfoTxt") && document.getElementById("raceInfoTxt").value) ||
        getStorageItem("raceInfo") || "";
    bc.postMessage({ race: getRaceOverlayText(raceVal) });
    if (!isSnookerBallMode()) {
        resetBallTracker();
    }

    // Send update to stream sharing if enabled
    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }

    // Reset ball style to American when switching to 9-/10-ball
    if (value === "game2" || value === "game3") {
        setStorageItem("ballSelection", "american");
        bc.postMessage({ ballSelection: "american" });
        updateControlPanelBallImages("american");
        console.log("Ball style reset to American for non-8-ball game");
    } else if (value === "game8") {
        updateControlPanelBallImages("snooker");
        bc.postMessage({ ballSelection: "snooker" });
    }
    useBallSetToggle();
    useBallTracker();
}

function ballType(value) {
    setStorageItem("ballSelection", value);

    // Update the label text based on ball type
    const redLabel = document.querySelector('label[for="p1colorRed"]');
    const yellowLabel = document.querySelector('label[for="p1colorYellow"]');
    if (redLabel) {
        if (value === "american") {
            redLabel.textContent = "Smalls/Lows/Solids";
        } else if (value === "unity") {
            redLabel.textContent = "Pink";
        } else {
            redLabel.textContent = "Red";
        }
    }
    if (yellowLabel) {
        if (value === "american") {
            yellowLabel.textContent = "Bigs/Highs/Stripes";
        } else if (value === "unity") {
            yellowLabel.textContent = "Blue";
        } else {
            yellowLabel.textContent = "Yellow";
        }
    }

    // Keep control-panel tracker art in sync (e.g. leaving Snooker → Bank/Straight/One Pocket)
    updateControlPanelBallImages(value);

    // Send ball type change message to browser source
    bc.postMessage({ ballType: value });

    const snookerMode = value === "snooker" || getStorageItem("gameType") === "game8";
    if (snookerMode) {
        setStorageItem("enableBallDisplay", "no");
        const displayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (displayCheckbox) {
            displayCheckbox.checked = false;
        }
    }
    syncBallDisplayControls();
    broadcastBallDisplayState();
    console.log(`Ball Type ${value}`)
}

function useBallSetToggle() {
    // Allow ball set toggle only for 8-ball
    var useBallSet = document.getElementById("ballSetCheckbox");
    var isChecked = useBallSet.checked;
    var storageValue = isChecked ? "yes" : "no";

    console.log(`Use Ball Set Toggle ${isChecked}`);
    setStorageItem("useBallSet", storageValue);
    if (isChecked) {
        document.getElementById("ballSet").classList.remove("noShow");
    } else {
        document.getElementById("ballSet").classList.add("noShow");

        // Reset to "Open Table" and hide the ball images
        document.getElementById('p1colorOpen').checked = true;
        setStorageItem("playerBallSet", "p1Open");
        bc.postMessage({ playerBallSet: "p1Open" });
    }
    updatePlayerBallControlVisibility();
}

function ballSetChange() {
    const getSelectedP1Set = () => {
        const selectedRadio = document.querySelector('input[name="p1BallSetSelect"]:checked');
        if (selectedRadio) {
            return selectedRadio.value;
        }
        return null; // Or handle the case where no radio button is selected
    };

    var p1Selected = getSelectedP1Set()
    // Store the selection
    setStorageItem("playerBallSet", p1Selected);

    bc.postMessage({ playerBallSet: p1Selected });

    console.log(`Player 1 Ball Set Selected ${p1Selected}`)
}

function isBallDisplayAllowed() {
    // Snooker never shows the ball grid on the OBS overlay
    return !isSnookerBallMode();
}

function isBallDisplayEnabled() {
    return getStorageItem("enableBallDisplay") === "yes" &&
        getStorageItem("enableBallTracker") === "yes" &&
        isBallDisplayAllowed();
}

function syncBallDisplayControls() {
    const trackerCheckbox = document.getElementById("ballTrackerCheckbox");
    const displayCheckbox = document.getElementById("ballDisplayCheckbox");
    const displayDiv = document.getElementById("ballDisplayDiv");
    const directionDiv = document.getElementById("ballTrackerDirectionDiv");
    if (!trackerCheckbox || !displayCheckbox) {
        return;
    }

    const trackerOn = !!trackerCheckbox.checked;
    const displayAllowed = isBallDisplayAllowed();

    if (displayDiv) {
        displayDiv.classList.toggle("noShow", !displayAllowed);
    }

    if (!displayAllowed) {
        displayCheckbox.checked = false;
        displayCheckbox.disabled = true;
        setStorageItem("enableBallDisplay", "no");
    } else if (!trackerOn) {
        displayCheckbox.checked = false;
        displayCheckbox.disabled = true;
        setStorageItem("enableBallDisplay", "no");
    } else {
        displayCheckbox.disabled = false;
        const stored = getStorageItem("enableBallDisplay") === "yes";
        displayCheckbox.checked = stored;
    }

    const showDirection = trackerOn && displayAllowed && displayCheckbox.checked;
    if (directionDiv) {
        directionDiv.classList.toggle("noShow", !showDirection);
    }
}

function broadcastBallDisplayState() {
    const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
    const show = bothPlayersEnabled && isBallDisplayEnabled();
    bc.postMessage({
        displayBallTracker: show,
        ballTrackerType: getStorageItem("ballSelection")
    });
}

function useBallDisplay() {
    const trackerCheckbox = document.getElementById("ballTrackerCheckbox");
    const displayCheckbox = document.getElementById("ballDisplayCheckbox");
    if (!trackerCheckbox || !displayCheckbox) {
        return;
    }
    if (!trackerCheckbox.checked || !isBallDisplayAllowed()) {
        displayCheckbox.checked = false;
        setStorageItem("enableBallDisplay", "no");
    } else {
        setStorageItem("enableBallDisplay", displayCheckbox.checked ? "yes" : "no");
    }
    syncBallDisplayControls();
    broadcastBallDisplayState();
    if (window.streamSharing && typeof window.streamSharing.sendUpdate === "function") {
        window.streamSharing.sendUpdate();
    }
}

function useBallTracker() {
    const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
    const checked = document.getElementById("ballTrackerCheckbox").checked;
    console.log('Both players enabled evaluation:', bothPlayersEnabled)
    setStorageItem("enableBallTracker", checked ? "yes" : "no");
    if (checked) {
        document.getElementById("ballTrackerDiv").classList.remove("noShow");
        document.getElementById("ballTracker").classList.remove("noShow");

        // Enable related ball controls for applicable games
        const gameType = getStorageItem("gameType");

        if (gameType === "game1") {
            document.getElementById("ballSetCheckbox").disabled = false;
            document.getElementById("ballTypeDiv").classList.remove("noShow");
            document.getElementById("ballSetDiv").classList.remove("noShow");
        } else if (gameType === "game8") {
            document.getElementById("ballTypeDiv").classList.remove("noShow");
            document.getElementById("ballSetDiv").classList.add("noShow");
            const ballSelectionWrap = document.getElementById("ballSelectionWrap");
            if (ballSelectionWrap) {
                ballSelectionWrap.classList.add("noShow");
            }
        } else if (gameType !== "game2" && gameType !== "game3") {
            document.getElementById("ballSetCheckbox").disabled = false;
            document.getElementById("ballTypeDiv").classList.remove("noShow");
        }
    } else {
        // Hide tracker UI; Display Balls cannot stay on without the tracker
        document.getElementById("ballTrackerDiv").classList.add("noShow");
        document.getElementById("ballTracker").classList.add("noShow");
        setStorageItem("enableBallDisplay", "no");
        const displayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (displayCheckbox) {
            displayCheckbox.checked = false;
        }
        cancelSnookerFoul();
    }

    // Ball Tracker scoring needs an Active Player — force/lock that setting while tracker is on
    syncActivePlayerRequiredForBallTracker();

    syncBallDisplayControls();
    broadcastBallDisplayState();
    updatePlayerBallControlVisibility();
    updateSnookerUiVisibility();

    if (window.streamSharing && typeof window.streamSharing.sendUpdate === "function") {
        window.streamSharing.sendUpdate();
    }
}

/**
 * Ball Tracker awards points to the Active Player, so Active Player Indicator must stay
 * on whenever the tracker is enabled (both players present).
 */
function syncActivePlayerRequiredForBallTracker() {
    const trackerCheckbox = document.getElementById("ballTrackerCheckbox");
    const toggleCheckbox = document.getElementById("useToggleSetting");
    if (!trackerCheckbox || !toggleCheckbox) {
        return;
    }
    const bothPlayers =
        getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes";
    const trackerOn = !!trackerCheckbox.checked;

    if (!bothPlayers) {
        return;
    }

    if (trackerOn) {
        if (!toggleCheckbox.checked) {
            toggleCheckbox.checked = true;
            setStorageItem("usePlayerToggle", "yes");
            document.getElementById("playerToggle").classList.remove("noShow");
            document.getElementById("playerToggleCheckbox").classList.remove("noShow");
            const activePlayer = document.getElementById("playerToggleCheckbox").checked;
            bc.postMessage({ clockDisplay: "showActivePlayer", player: activePlayer });
        }
        toggleCheckbox.disabled = true;
    } else {
        toggleCheckbox.disabled = false;
    }
}

function toggleBallTrackerDirection() {
    // Get current direction from localStorage or default to "vertical"
    const currentDirection = getStorageItem("ballTrackerDirection") || "vertical";
    // Toggle direction
    const newDirection = currentDirection === "horizontal" ? "vertical" : "horizontal";
    // Send message to browser source
    bc.postMessage({ ballTracker: newDirection });
    // Update localStorage
    setStorageItem("ballTrackerDirection", newDirection);
    console.log(`Changed ball tracker to ${newDirection} orientation`);
    // Update button label to reflect NEW direction (current state after toggle)
    document.getElementById("ballTrackerDirectionDiv").innerHTML = newDirection.charAt(0).toUpperCase() + newDirection.slice(1).toLowerCase() + " Ball Tracker";
}

function updateControlPanelBallImages(selection) {
    console.log(`Updating control panel ball images to: ${selection}`);

    // Update all ball images in the control panel
    for (let i = 1; i <= 15; i++) {
        const ballElement = document.getElementById(`ball ${i}`);
        if (ballElement) {
            const img = ballElement.querySelector('img');
            if (img) {
                let imageSrc;

                if (selection === "snooker") {
                    const meta = SNOOKER_BALL_META[i];
                    if (meta && meta.spacer) {
                        img.style.display = "none";
                        ballElement.removeAttribute("title");
                        continue;
                    }
                    if (meta && meta.file) {
                        imageSrc = `./common/images/${meta.file}`;
                        img.style.display = "";
                        ballElement.title = meta.title || "";
                    } else {
                        continue;
                    }
                } else if (selection === "international") {
                    // International ball naming convention
                    if (i >= 1 && i <= 7) {
                        imageSrc = `./common/images/yellow-international-small-ball.png`;
                    } else if (i === 8) {
                        imageSrc = `./common/images/international-8-small-ball.png`;
                    } else if (i >= 9 && i <= 15) {
                        imageSrc = `./common/images/red-international-small-ball.png`;
                    }
                    img.style.display = "";
                    ballElement.title = `Ball ${i}`;
                } else if (selection === "unity") {
                    // Unity ball naming convention
                    imageSrc = `./common/images/${i}-ball-unity-small.png`;
                    img.style.display = "";
                    ballElement.title = `Ball ${i}`;
                } else {
                    // American ball naming convention (default)
                    imageSrc = `./common/images/${i}ball_small.png`;
                    img.style.display = "";
                    ballElement.title = `Ball ${i}`;
                }
                if (imageSrc) {
                    img.src = imageSrc;
                }
            }
        }
    }
}

function toggleBallSelection() {
    // Get the selected value from the dropdown
    const ballSelectionElement = document.getElementById("ballSelection");
    const newSelection = ballSelectionElement ? ballSelectionElement.value : "american";
    
    // Only allow changing ball style for 8-ball (game1) and custom (game7); snooker (game8) is locked
    const currentGame = getStorageItem("gameType") || (document.getElementById("gameType") ? document.getElementById("gameType").value : "game1");
    if (currentGame === "game2" || currentGame === "game3") {
        console.log("Ball style selection is not available for 9- or 10-ball (game2/game3)");
        // Reset to american if trying to change during 9-ball or 10-ball
        if (ballSelectionElement) {
            ballSelectionElement.value = "american";
        }
        return;
    }
    if (currentGame === "game8") {
        if (ballSelectionElement) {
            ballSelectionElement.value = "snooker";
        }
        setStorageItem("ballSelection", "snooker");
        updateControlPanelBallImages("snooker");
        applySnookerTrackerLayout();
        updateSnookerUiVisibility();
        setStorageItem("enableBallDisplay", "no");
        const displayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (displayCheckbox) {
            displayCheckbox.checked = false;
        }
        syncBallDisplayControls();
        bc.postMessage({ ballSelection: "snooker", displayBallTracker: false });
        return;
    }
    if (newSelection === "snooker" && currentGame !== "game7") {
        console.log("Snooker ball style is only available for Snooker or Custom");
        if (ballSelectionElement) {
            ballSelectionElement.value = getStorageItem("ballSelection") || "american";
        }
        return;
    }
    
    // Send message to browser source
    setStorageItem("ballSelection", newSelection);
    if (newSelection === "snooker") {
        setStorageItem("enableBallDisplay", "no");
        const displayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (displayCheckbox) {
            displayCheckbox.checked = false;
        }
    }
    syncBallDisplayControls();
    bc.postMessage({
        ballSelection: newSelection,
        displayBallTracker: isBallDisplayEnabled()
    });
    // Update localStorage
    console.log(`Changed ball selection to ${newSelection} ball style`);

    // Update control panel ball images
    updateControlPanelBallImages(newSelection);
    applySnookerTrackerLayout();
    updateSnookerUiVisibility();
    ballType(newSelection);
    if (newSelection === "snooker") {
        resetSnookerSequenceState();
    } else {
        ballSetChange();
        clearSnookerColorFeedback();
    }
    useBallTracker();
}

function togglePot(element) {
    if (isGameScoringLocked()) {
        return;
    }
    if (isSnookerBallMode()) {
        handleSnookerBallClick(element);
        return;
    }

    const wasFaded = element.classList.contains('faded');

    // Toggle the 'faded' class on the element
    element.classList.toggle('faded');
    const nowFaded = element.classList.contains('faded');

    // Parse the current ball state from localStorage or default to an empty object
    const ballState = JSON.parse(getStorageItem('ballState') || '{}');

    // Update the state by reading the current status from the element
    ballState[element.id] = nowFaded;

    // Save the updated state back to localStorage
    setStorageItem('ballState', JSON.stringify(ballState));

    // Broadcast the change if needed
    bc.postMessage({ toggle: element.id });
    console.log(`Toggle pot state of`, element.id);

    // Bank / One Pocket: tracker pots award a ball to the Active Player;
    // re-enabling deducts from the player who originally received that ball.
    if (isPocketScoreGame() && nowFaded !== wasFaded) {
        if (nowFaded) {
            creditPocketBallPot(element.id);
        } else {
            debitPocketBallUnpot(element.id);
        }
    }
}

function getPocketBallOwners() {
    try {
        const parsed = JSON.parse(getStorageItem("pocketBallOwners") || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}

function setPocketBallOwners(owners) {
    setStorageItem("pocketBallOwners", JSON.stringify(owners && typeof owners === "object" ? owners : {}));
}

function clearPocketBallOwners() {
    setPocketBallOwners({});
}

function creditPocketBallPot(ballId) {
    const player = getActivePlayerSlot();
    const owners = getPocketBallOwners();
    owners[ballId] = player;
    setPocketBallOwners(owners);
    postBalls("add", player);
}

function debitPocketBallUnpot(ballId) {
    const owners = getPocketBallOwners();
    const player = owners[ballId] || getActivePlayerSlot();
    delete owners[ballId];
    setPocketBallOwners(owners);

    const current = parseInt(getStorageItem("p" + player + "BallsCtrlPanel"), 10) || 0;
    if (current > 0) {
        postBalls("sub", player);
    }
}

/**
 * Bank / One Pocket: first player to 8 balls wins the rack.
 * Awards the rack (primary +1), which also clears both ball scores and the tracker.
 */
function maybeAwardPocketRack(player) {
    if (!isPocketScoreGame() || (player !== "1" && player !== "2")) {
        return;
    }
    const balls = parseInt(getStorageItem("p" + player + "BallsCtrlPanel"), 10) || 0;
    if (balls >= POCKET_RACK_BALL_TARGET) {
        console.log(`Pocket game: player ${player} reached ${POCKET_RACK_BALL_TARGET} — awarding rack`);
        postScore('add', player);
    }
}

function applySavedBallStates() {
    // Retrieve the ballState object from localStorage (or default to an empty object)
    const ballState = JSON.parse(getStorageItem('ballState') || '{}');

    // Get all ball elements (assuming each ball has the class 'ball')
    const balls = document.querySelectorAll('.ball');

    // Iterate over each ball element and apply or remove the 'faded' class
    balls.forEach(function (ball) {
        if (ballState[ball.id]) {
            ball.classList.add("faded");
        } else {
            // ball.classList.remove("faded");
        }
    });
}

// Function to save the opacity value to localStorage
function saveOpacity() {
    var opacityValue = document.getElementById('scoreOpacity').value;
    setStorageItem('overlayOpacity', opacityValue);
    document.getElementById('sliderValue').innerText = opacityValue + '%'; // Update displayed value
}

// Function to save the uiScaling localStorage
function saveScaling() {
    var scalingValue = document.getElementById('uiScaling').value;
    setStorageItem('uiScalingValue', scalingValue);
    document.getElementById('sliderUiScalingValue').innerText = scalingValue + '%';
}

function toggleCheckbox(checkboxId, inputElement) {
    const checkbox = document.getElementById(checkboxId);
    console.log(`File size ${inputElement.files.length}`);
    checkbox.disabled = !inputElement.files.length; // Enable if file is selected, disable otherwise
}

function toggleSetting() {
    const toggleCheckbox = document.getElementById("useToggleSetting");
    const trackerCheckbox = document.getElementById("ballTrackerCheckbox");
    // Ball Tracker requires Active Player — refuse to turn the indicator off while tracker is on
    if (toggleCheckbox && trackerCheckbox && trackerCheckbox.checked && !toggleCheckbox.checked) {
        toggleCheckbox.checked = true;
        syncActivePlayerRequiredForBallTracker();
        return;
    }
    const checkbox = toggleCheckbox && toggleCheckbox.checked;
    const activePlayer = document.getElementById("playerToggleCheckbox").checked;
    console.log(`Display active player ${checkbox ? "enabled" : "disabled"}`);
    if (checkbox) {
        document.getElementById("playerToggle").classList.remove("noShow");
        document.getElementById("playerToggleCheckbox").classList.remove("noShow");
        // document.getElementById("playerToggleLabel").classList.remove("noShow");
        setStorageItem("usePlayerToggle", "yes");
        bc.postMessage({ clockDisplay: 'showActivePlayer', player: activePlayer });
        console.log(`Player ${activePlayer ? 1 : 2} is active`);
    } else {
        document.getElementById("playerToggle").classList.add("noShow");
        document.getElementById("playerToggleCheckbox").classList.add("noShow");
        // document.getElementById("playerToggleLabel").classList.add("noShow");
        setStorageItem("usePlayerToggle", "no");
        bc.postMessage({ clockDisplay: 'hideActivePlayer' });
    }
    syncActivePlayerRequiredForBallTracker();
    updatePlayerBallControlVisibility();
}

function logoSlideshow() {
    if (document.getElementById("logoSlideshowChk").checked == true) {
        setStorageItem("slideShow", "yes");
        bc.postMessage({ clockDisplay: 'logoSlideShow-show' });
    } else {
        bc.postMessage({ clockDisplay: 'logoSlideShow-hide' });
        setStorageItem("slideShow", "no");
    }
}

function logoPost(input, xL) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.readAsDataURL(input.files[0]);
        reader.addEventListener("load", function () {
            try {
                setStorageItem("customLogo" + xL, reader.result);
            } catch (err) {
                alert("The selected image exceeds the maximum file size");
                input.value = ""; // Clear the input
                // Additional error handling here if needed
            }
            document.getElementById("l" + xL + "Img").src = getStorageItem("customLogo" + xL);

            // Update label and rebind container click to clearLogo
            if (xL >= 1 && xL <= 5) {
                var textElem = document.getElementById(`FileUploadLText${xL}`);
                if (textElem) {
                    textElem.textContent = "Clear";
                }
                // Choose the correct container ID based on the logo type
                var containerId;
                if (xL === 1) {
                    containerId = "uploadCustomLogo";
                } else if (xL === 2) {
                    containerId = "uploadCustomLogo2";
                } else {
                    containerId = "logoSsImg" + xL;
                }
                var container = document.getElementById(containerId);
                if (container) {
                    container.onclick = function (e) {
                        e.preventDefault();
                        clearLogo(xL);
                    };
                    // Apply the red background and white text to indicate "clear" mode
                    container.style.backgroundColor = "red";
                    container.style.color = "white";
                }
            } else {
                console.log(`No related element for changing innerHtml to clear`);
            }

            // Additional logic for slideshows or other settings...
        }, false);
        if (document.getElementById("logoSlideshowChk").checked == true) { setTimeout(slideOther, 50); };
        if (xL == 1 || xL == 2) { setTimeout(logoOther, 50); };
    }
}

function logoOther() {
    bc.postMessage({ clockDisplay: 'postLogo' });
}

function slideOther() {
    bc.postMessage({ clockDisplay: 'logoSlideShow-show' });
}

function swapColors() {
    // Get current colors with default "white"
    const p1original = getStorageItem('p1colorSet') || "white";
    const p2original = getStorageItem('p2colorSet') || "white";

    // If colors are identical, don't swap
    if (p1original === p2original) {
        return;
    }

    setTimeout(function () {
        document.getElementById("p1colorDiv").value = p2original;
        document.getElementById("p2colorDiv").value = p1original;
        bc.postMessage({ player: '1', color: p2original });
        bc.postMessage({ player: '2', color: p1original });
        document.getElementById("p2colorDiv").style.background = p1original;
        document.getElementById("p1colorDiv").style.background = p2original;
        setStorageItem('p1colorSet', p2original);
        setStorageItem('p2colorSet', p1original);
        document.getElementById("p2Name").style.background = `linear-gradient(to left, ${p1original}, white)`;
        document.getElementById("p1Name").style.background = `linear-gradient(to right, ${p2original}, white)`;
        document.getElementsByTagName("select")[0].options[0].value = p2original;
        document.getElementsByTagName("select")[1].options[0].value = p1original;
        c1value = p1original;
        c2value = p2original;
        if (c1value == "white" || c1value == "") {
            document.getElementById("p1colorDiv").style.color = "black"; document.getElementById("p1colorDiv").style.textShadow = "none";
        } else { document.getElementById("p1colorDiv").style.color = "white"; };
        if (c2value == "white" || c2value == "") {
            document.getElementById("p2colorDiv").style.color = "black"; document.getElementById("p2colorDiv").style.textShadow = "none";
        } else { document.getElementById("p2colorDiv").style.color = "white"; };
    }, 100);
}

function playerColorChange(player) {
    var cvalue = document.getElementById("p" + player + "colorDiv").value;
    if (player == 1) {
        playerx = player;
        pColormsg = document.getElementById("p" + player + "colorDiv").value;
        bc.postMessage({ player: playerx, color: pColormsg });
        var selectedColor = document.getElementById("p" + player + "colorDiv").value;
        document.getElementById("p1colorDiv").style.background = `${selectedColor}`;
        document.getElementById("p1Name").style.background = `linear-gradient(to right, ${selectedColor}, white)`;

        if (cvalue == "white" || cvalue == "") {
            document.getElementById("p1colorDiv").style.color = "black"; document.getElementById("p1colorDiv").style.textShadow = "none";
        } else { document.getElementById("p1colorDiv").style.color = "white"; };
        setStorageItem("p1colorSet", document.getElementById("p" + player + "colorDiv").value);
        document.getElementsByTagName("select")[0].options[0].value = cvalue;
    } else {
        playerx = player;
        pColormsg = document.getElementById("p" + player + "colorDiv").value;
        bc.postMessage({ player: playerx, color: pColormsg });
        var selectedColor = document.getElementById("p" + player + "colorDiv").value;
        document.getElementById("p2colorDiv").style.background = `${selectedColor}`;
        document.getElementById("p2Name").style.background = `linear-gradient(to left, ${selectedColor}, white)`;

        if (cvalue == "white" || cvalue == "") {
            document.getElementById("p2colorDiv").style.color = "black"; document.getElementById("p2colorDiv").style.textShadow = "none";
        } else { document.getElementById("p2colorDiv").style.color = "white"; };
        setStorageItem("p2colorSet", document.getElementById("p" + player + "colorDiv").value);
        document.getElementsByTagName("select")[1].options[0].value = cvalue;
    }
}

function playerSetting(player) {
    var usePlayerSetting = document.getElementById("usePlayer" + player + "Setting");
    var isChecked = usePlayerSetting.checked;
    var action = isChecked ? "remove" : "add";
    var storageValue = isChecked ? "yes" : "no";
    var usePlayer = isChecked ? "showPlayer" : "hidePlayer";

    setStorageItem("usePlayer" + player, storageValue);

    // Handle player-specific elements
    ["Name", "NameLabel", "colorDiv", "ColorLabel"].forEach(function (elem) {
        document.getElementById("p" + player + elem).classList[action]("noShow");
    });

    // Check if both players are enabled
    const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
    const bothPlayersDisabled = !player1Enabled && !player2Enabled;
    const anyPlayerDisabled = !player1Enabled || !player2Enabled;

    // Handle score display checkbox
    const scoreDisplayCheckbox = document.getElementById("scoreDisplay");
    if (anyPlayerDisabled) {
        scoreDisplayCheckbox.disabled = true;
        scoreDisplayCheckbox.checked = false;
        setStorageItem("scoreDisplay", "no");
        resetBallSet()
    } else {
        scoreDisplayCheckbox.disabled = false;
    }

    // Handle clock, player toggle, and ball tracker checkboxes
    const clockCheckbox = document.getElementById("useClockSetting");
    const toggleCheckbox = document.getElementById("useToggleSetting");
    const ballTrackerCheckbox = document.getElementById("ballTrackerCheckbox");

    if (anyPlayerDisabled) {
        // Disable and uncheck the checkboxes
        clockCheckbox.disabled = true;
        clockCheckbox.checked = false;
        setStorageItem("useClock", "no");

        toggleCheckbox.disabled = true;
        toggleCheckbox.checked = false;
        setStorageItem("usePlayerToggle", "no");

        ballTrackerCheckbox.disabled = true;
        ballTrackerCheckbox.checked = false;
        setStorageItem("enableBallTracker", "no");
        setStorageItem("enableBallDisplay", "no");
        const ballDisplayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (ballDisplayCheckbox) {
            ballDisplayCheckbox.checked = false;
            ballDisplayCheckbox.disabled = true;
        }

        ballSetCheckbox.disabled = true;
        ballSetCheckbox.checked = false;
        document.getElementById("ballSet").classList[anyPlayerDisabled ? "add" : "remove"]("noShow");
        setStorageItem("useBallSet", "no");

        document.getElementById("ballSelection").disabled = true;

        resetBallSet()

        // Hide related elements
        document.getElementById("clockInfo").classList.add("noShow");
        document.getElementById("extensionControls").classList.add("noShow");
        document.getElementById("clockControlLabel").classList.add("noShow");
        document.getElementById("playerToggle").classList.add("noShow");
        document.getElementById("playerToggleLabel").classList.add("noShow");
        document.getElementById("ballTrackerDirectionDiv").classList.add("noShow");
        document.getElementById("ballTrackerDiv").classList.add("noShow");
        document.getElementById("ballTracker").classList.add("noShow");

        // Send messages to hide these features
        bc.postMessage({ clockDisplay: 'noClock' });
        bc.postMessage({ clockDisplay: 'hideActivePlayer' });
        bc.postMessage({ displayBallTracker: false });
    } else {
        // Enable the checkboxes
        clockCheckbox.disabled = false;
        toggleCheckbox.disabled = false;
        ballTrackerCheckbox.disabled = false;
        ballSetCheckbox.disabled = false;
        document.getElementById("ballSelection").disabled = false;
        syncBallDisplayControls();
        syncActivePlayerRequiredForBallTracker();
    }

    // Show/hide  elements based on individual players being enabled
    document.getElementById("logoName").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("customLogo1").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("uploadCustomLogo").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("logoName2").classList[player2Enabled ? "remove" : "add"]("noShow");
    document.getElementById("customLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");
    document.getElementById("uploadCustomLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");

    // Hide shared elements based on both players being enabled
    document.getElementById("gameInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("teamInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfoTxt").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("sendPNames").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("playerDetailLabel").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");

    // Hide Race info when any player is disabled
    document.getElementById("raceInfo").classList[anyPlayerDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfoTxt").classList[anyPlayerDisabled ? "add" : "remove"]("noShow");

    bc.postMessage({ playerDisplay: usePlayer, playerNumber: player });

    // updateTabVisibility();
    //Hide/Show based on both players enabled
    document.getElementById("swapBtn").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    document.getElementById("scoreLabel").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    document.getElementById("scoreInfoP1").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    document.getElementById("scoreInfoP2").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    document.getElementById("scoreEditing").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    updateScoreModeUI();
    // document.getElementById("ballTypeDiv").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    // document.getElementById("ballSet").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");

    if (window.streamSharing && typeof window.streamSharing.sendUpdate === "function") {
        window.streamSharing.sendUpdate();
    }
}

function scoreDisplaySetting() {
    const scoreDisplay = document.getElementById("scoreDisplay");
    if (!document.getElementById("scoreDisplay").checked) {
        setStorageItem("scoreDisplay", "no");
    } else if (document.getElementById("scoreDisplay").checked) {
        setStorageItem("scoreDisplay", "yes");
    }
    if (getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes") {
        bc.postMessage({ scoreDisplay: scoreDisplay.checked ? "yes" : "no" });
    }

    if (window.streamSharing && typeof window.streamSharing.sendUpdate === "function") {
        window.streamSharing.sendUpdate();
    }
}

function clockSetting() {
    const clockDiv = document.getElementById("clockInfo");
    if (!document.getElementById("useClockSetting").checked) {
        setStorageItem("useClock", "no");
        bc.postMessage({ clockDisplay: 'noClock' });
        document.getElementById("clockInfo").classList.add("noShow");
        document.getElementById("extensionControls").classList.add("noShow");
        document.getElementById("clockControlLabel").classList.add("noShow");
    } else if (document.getElementById("useClockSetting").checked) {
        setStorageItem("useClock", "yes");
        bc.postMessage({ clockDisplay: 'useClock' });
        document.getElementById("clockInfo").classList.remove("noShow");
        document.getElementById("extensionControls").classList.remove("noShow");
        document.getElementById("clockControlLabel").classList.remove("noShow");
    }
    // updateTabVisibility();

    if (window.streamSharing && typeof window.streamSharing.sendUpdate === "function") {
        window.streamSharing.sendUpdate();
    }
}

function clockDisplay(opt3) {
    var optmsg = opt3;
    bc.postMessage({ clockDisplay: optmsg });
    if (opt3 == "show") {
        document.getElementById("shotClockShow").innerHTML = "Hide Clock";
        document.getElementById("shotClockShow").setAttribute("onclick", "clockDisplay('hide')");
        document.getElementById("shotClockShow").style.background = "green";
        document.getElementById("shotClockShow").style.color = "black";
    } else if (opt3 == "hide") {
        document.getElementById("shotClockShow").innerHTML = "Show Clock";
        document.getElementById("shotClockShow").setAttribute("onclick", "clockDisplay('show')");
        document.getElementById("shotClockShow").style.background = "none";
        document.getElementById("shotClockShow").style.color = "lightgrey";
    }
}

function clearGame() {
    const confirmed = confirm('Are you sure you wish to clear player, score, and game information?');
    if (!confirmed) {
        return;
    }

    console.log('Clearing Match Data');
    if (window.PlayerStats) {
        window.PlayerStats.onClearGame().catch(function (err) {
            console.error('PlayerStats onClearGame error:', err);
        });
    }
    document.getElementById("raceInfoTxt").value = "";
    document.getElementById("gameInfoTxt").value = "";
    document.getElementById("p1Name").value = "";
    document.getElementById("p2Name").value = "";
    document.getElementById("p1Name").removeAttribute("data-player-id");
    document.getElementById("p2Name").removeAttribute("data-player-id");
    setStorageItem("p1NameCtrlPanel", "");
    setStorageItem("p2NameCtrlPanel", "");
    setStorageItem("raceInfo", "");
    setStorageItem("gameInfo", "");
    performResetScores({ endMatch: false });
    postNames();
    pushScores();
    postInfo();
}

function postNames() {
    p1namemsg = document.getElementById("p1Name").value.substring(0, 20);
    p2namemsg = document.getElementById("p2Name").value.substring(0, 20);
    bc.postMessage({ player: '1', name: p1namemsg });
    bc.postMessage({ player: '2', name: p2namemsg });
    var p1FirstName = document.getElementById("p1Name").value.split(" ")[0];
    var p2FirstName = document.getElementById("p2Name").value.split(" ")[0];
    if (!p1Name.value == "") { document.getElementById("p1extensionBtn").innerHTML = p1FirstName.substring(0, 9) + "'s Extension"; } else { document.getElementById("p1extensionBtn").innerHTML = "P1's Extension"; }
    if (!p2Name.value == "") { document.getElementById("p2extensionBtn").innerHTML = p2FirstName.substring(0, 9) + "'s Extension"; } else { document.getElementById("p2extensionBtn").innerHTML = "P2's Extension"; }
    updateScoreLabels();
    setStorageItem("p1NameCtrlPanel", p1Name.value);
    setStorageItem("p2NameCtrlPanel", p2Name.value);
    // Send update to stream sharing if enabled
    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
    if (window.PlayerStats) {
        window.PlayerStats.onNamesUpdated().catch(function (err) {
            console.error('PlayerStats onNamesUpdated error:', err);
        });
    }
}

function getRaceTarget() {
    const raceInput = document.getElementById("raceInfoTxt");
    let raceString = '';

    if (raceInput && raceInput.value && raceInput.value.trim().length > 0) {
        raceString = raceInput.value.trim();
    } else {
        raceString = (getStorageItem("raceInfo") || '').toString().trim();
    }

    if (!raceString) {
        return null;
    }

    const matches = raceString.match(/\d+/g);
    if (!matches || matches.length === 0) {
        return null;
    }

    const target = parseInt(matches[matches.length - 1], 10);
    if (!Number.isFinite(target) || target <= 0) {
        return null;
    }

    // Snooker "Best Of N" → first to floor(N/2)+1 frames (e.g. best of 35 → first to 18)
    if (isSnooker()) {
        return Math.floor(target / 2) + 1;
    }

    return target;
}

function getRaceOverlayText(raceValue) {
    // Show the stored race / Best Of value as entered — do not rewrite as "Best of N" on overlay.
    return (raceValue == null ? "" : String(raceValue)).trim();
}

function updateScoreControlAvailability() {
    const raceTarget = getRaceTarget();
    const p1Input = document.getElementById("p1Score");
    const p2Input = document.getElementById("p2Score");
    const p1Value = p1Input ? parseInt(p1Input.value, 10) || 0 : 0;
    const p2Value = p2Input ? parseInt(p2Input.value, 10) || 0 : 0;
    const winnerExists = raceTarget !== null && (p1Value >= raceTarget || p2Value >= raceTarget);
    const winnerIsP1 = winnerExists && raceTarget !== null && p1Value >= raceTarget && p1Value >= p2Value;
    const winnerIsP2 = winnerExists && raceTarget !== null && p2Value >= raceTarget && p2Value >= p1Value;

    const controls = [
        document.getElementById("sendP1Score"),
        document.getElementById("sendP1ScoreSub"),
        document.getElementById("sendP2Score"),
        document.getElementById("sendP2ScoreSub")
    ];

    controls.forEach(control => {
        if (control) {
            control.disabled = winnerExists;
            control.classList.toggle('disabled', winnerExists);
        }
    });

    [p1Input, p2Input].forEach(input => {
        if (input) {
            input.readOnly = winnerExists;
            input.classList.toggle('read-only', winnerExists);
        }
    });

    const winnerDecrementButton = winnerIsP1 ? document.getElementById("sendP1ScoreSub") : winnerIsP2 ? document.getElementById("sendP2ScoreSub") : null;
    const winnerInput = winnerIsP1 ? p1Input : winnerIsP2 ? p2Input : null;

    if (winnerExists && winnerDecrementButton && winnerInput) {
        winnerDecrementButton.disabled = false;
        winnerDecrementButton.classList.remove('disabled');
        winnerInput.readOnly = false;
        winnerInput.classList.remove('read-only');
    }

    const resetBtn = document.getElementById("resetScores");
    if (resetBtn) {
        updateResetScoreButton();
    }
    updateCallGameButton();
    updateBallTrackerLockState();
}

function postInfo() {
    if (raceInfoTxt.value == " ") {
        raceInfoTxt.value = null;
    }
    if (gameInfoTxt.value == " ") {
        gameInfoTxt.value = null;
    }
    racemsg = document.getElementById("raceInfoTxt").value;
    gamemsg = document.getElementById("gameInfoTxt").value;
    bc.postMessage({ race: getRaceOverlayText(racemsg) });
    bc.postMessage({ game: gamemsg });
    setStorageItem("raceInfo", raceInfoTxt.value);
    setStorageItem("gameInfo", gameInfoTxt.value);
    // Send update to stream sharing if enabled
    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
    updateScoreControlAvailability();
}

function postSources() {
    // Check if WebSocket is connected
    const isConnected = getStorageItem('isConnected') === 'true';
    if (!isConnected) {
        alert('A WebSocket connection is required for replay functionality. Please connect to OBS WebSocket first.');
        return;
    }
    
    const videoSourceEl = document.getElementById('replayVideoSourceName');
    const indicatorSourceEl = document.getElementById('replayIndicatorSourceName');

    // Clean up empty strings
    if (videoSourceEl && videoSourceEl.value.trim() === "") {
        videoSourceEl.value = "";
    }
    if (indicatorSourceEl && indicatorSourceEl.value.trim() === "") {
        indicatorSourceEl.value = "";
    }

    if (videoSourceEl) {
        setStorageItem("replayVideoSourceName", videoSourceEl.value);
    }
    if (indicatorSourceEl) {
        setStorageItem("replayIndicatorSourceName", indicatorSourceEl.value);
    }

    // Update visibility after saving
    updateReplayControlsVisibility();

    console.log('Replay source settings saved:', {
        videoSource: videoSourceEl ? videoSourceEl.value : '',
        indicatorSource: indicatorSourceEl ? indicatorSourceEl.value : ''
    });
}

function loadReplaySources() {
    const videoSource = getStorageItem("replayVideoSourceName") || "";
    const indicatorSource = getStorageItem("replayIndicatorSourceName") || "";

    const videoSourceInput = document.getElementById('replayVideoSourceName');
    const indicatorInput = document.getElementById('replayIndicatorSourceName');

    if (videoSourceInput) {
        videoSourceInput.value = videoSource;
    }
    if (indicatorInput) {
        indicatorInput.value = indicatorSource;
    }
}

function getReplaySettings() {
    return {
        videoSource: getStorageItem("replayVideoSourceName") || "",
        indicatorSource: getStorageItem("replayIndicatorSourceName") || ""
    };
}

function pushScores() {
    const p1Input = document.getElementById("p1Score");
    const p2Input = document.getElementById("p2Score");
    let enteredP1 = p1Input ? parseInt(p1Input.value, 10) || 0 : 0;
    let enteredP2 = p2Input ? parseInt(p2Input.value, 10) || 0 : 0;
    const raceTarget = getRaceTarget();

    if (raceTarget !== null) {
        enteredP1 = Math.min(Math.max(enteredP1, 0), raceTarget);
        enteredP2 = Math.min(Math.max(enteredP2, 0), raceTarget);

        if (enteredP1 >= raceTarget) {
            enteredP2 = Math.min(enteredP2, raceTarget);
        }

        if (enteredP2 >= raceTarget) {
            enteredP1 = Math.min(enteredP1, raceTarget);
        }
    }

    enteredP1 = Math.min(Math.max(enteredP1, 0), 999);
    enteredP2 = Math.min(Math.max(enteredP2, 0), 999);

    if (p1Input) {
        p1Input.value = enteredP1;
    }
    if (p2Input) {
        p2Input.value = enteredP2;
    }

    bc.postMessage({ player: '1', score: enteredP1 });
    bc.postMessage({ player: '2', score: enteredP2 });

    p1ScoreValue = enteredP1;
    p2ScoreValue = enteredP2;

    setStorageItem("p1ScoreCtrlPanel", p1ScoreValue);
    setStorageItem("p1Score", p1ScoreValue);
    setStorageItem("p2ScoreCtrlPanel", p2ScoreValue);
    setStorageItem("p2Score", p2ScoreValue);

    if (isDualScoreMode()) {
        const p1BallsInput = document.getElementById("p1Balls");
        const p2BallsInput = document.getElementById("p2Balls");
        let enteredP1Balls = p1BallsInput ? parseInt(p1BallsInput.value, 10) || 0 : 0;
        let enteredP2Balls = p2BallsInput ? parseInt(p2BallsInput.value, 10) || 0 : 0;
        enteredP1Balls = Math.min(Math.max(enteredP1Balls, -999), 999);
        enteredP2Balls = Math.min(Math.max(enteredP2Balls, -999), 999);

        if (p1BallsInput) {
            p1BallsInput.value = enteredP1Balls;
        }
        if (p2BallsInput) {
            p2BallsInput.value = enteredP2Balls;
        }

        bc.postMessage({ player: '1', balls: enteredP1Balls });
        bc.postMessage({ player: '2', balls: enteredP2Balls });
        setStorageItem("p1BallsCtrlPanel", enteredP1Balls);
        setStorageItem("p1Balls", enteredP1Balls);
        setStorageItem("p2BallsCtrlPanel", enteredP2Balls);
        setStorageItem("p2Balls", enteredP2Balls);
    }

    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
    if (!isSnookerBallMode()) {
        resetBallTracker();
        resetBallSet();
    }
    updateScoreControlAvailability();
    if (isSnooker()) {
        refreshSnookerOverlayStats();
    }
}

function postBalls(opt1, player) {
    if (isGameScoringLocked()) {
        return;
    }
    let p1BallsValue = parseInt(getStorageItem("p1BallsCtrlPanel"), 10) || 0;
    let p2BallsValue = parseInt(getStorageItem("p2BallsCtrlPanel"), 10) || 0;
    let ballsChanged = false;
    let hadRecordedBallToUndo = false;

    if (player == "1") {
        if (opt1 == "add") {
            if (p1BallsValue < 999) {
                p1BallsValue = p1BallsValue + 1;
                ballsChanged = true;
            }
        } else if (p1BallsValue > -999) {
            hadRecordedBallToUndo = p1BallsValue > 0;
            p1BallsValue = p1BallsValue - 1;
            ballsChanged = true;
        }
        bc.postMessage({ player: player, balls: p1BallsValue });
        setStorageItem("p1BallsCtrlPanel", p1BallsValue);
        setStorageItem("p1Balls", p1BallsValue);
        document.getElementById("p1Balls").value = p1BallsValue;
        stopClock();
        resetExt('p1', 'noflash');
        resetExt('p2', 'noflash');
    } else if (player == "2") {
        if (opt1 == "add") {
            if (p2BallsValue < 999) {
                p2BallsValue = p2BallsValue + 1;
                ballsChanged = true;
            }
        } else if (p2BallsValue > -999) {
            hadRecordedBallToUndo = p2BallsValue > 0;
            p2BallsValue = p2BallsValue - 1;
            ballsChanged = true;
        }
        bc.postMessage({ player: player, balls: p2BallsValue });
        setStorageItem("p2BallsCtrlPanel", p2BallsValue);
        setStorageItem("p2Balls", p2BallsValue);
        document.getElementById("p2Balls").value = p2BallsValue;
        stopClock();
        resetExt('p1', 'noflash');
        resetExt('p2', 'noflash');
    }

    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }

    if (window.PlayerStats && ballsChanged && !isSnooker()) {
        if (opt1 === 'add') {
            window.PlayerStats.recordBallWin(player).catch(function (err) {
                console.error('PlayerStats recordBallWin error:', err);
            });
        } else if (hadRecordedBallToUndo) {
            window.PlayerStats.undoLastBall(player).catch(function (err) {
                console.error('PlayerStats undoLastBall error:', err);
            });
        }
    }

    if (ballsChanged && opt1 === 'add') {
        maybeAwardPocketRack(player);
    }

    if (ballsChanged && isSnooker()) {
        refreshSnookerOverlayStats();
    }
}

function resetPlayerBalls(player) {
    if (!isDualScoreMode()) {
        return;
    }
    const ballsInput = document.getElementById("p" + player + "Balls");
    if (ballsInput) {
        ballsInput.value = "0";
    }
    setStorageItem("p" + player + "BallsCtrlPanel", 0);
    setStorageItem("p" + player + "Balls", 0);
    bc.postMessage({ player: player, balls: 0 });
}

function resetBothPlayersBalls() {
    resetPlayerBalls('1');
    resetPlayerBalls('2');
    clearPocketBallOwners();
}

function postScore(opt1, player) {
    // Parse stored scores as integers
    let p1ScoreValue = parseInt(getStorageItem("p1ScoreCtrlPanel")) || 0;
    let p2ScoreValue = parseInt(getStorageItem("p2ScoreCtrlPanel")) || 0;
    const raceTarget = getRaceTarget();
    const raceLocked = raceTarget !== null && (p1ScoreValue >= raceTarget || p2ScoreValue >= raceTarget);
    const winnerIsP1 = raceLocked && raceTarget !== null && p1ScoreValue >= raceTarget && p1ScoreValue >= p2ScoreValue;
    const winnerIsP2 = raceLocked && raceTarget !== null && p2ScoreValue >= raceTarget && p2ScoreValue >= p1ScoreValue;
    const isWinner = player === '1' ? winnerIsP1 : player === '2' ? winnerIsP2 : false;
    let scoreChanged = false;
    let snookerFrameSnapshot = null;

    if (raceLocked && !isWinner) {
        updateScoreControlAvailability();
        return;
    }
    if (raceLocked && opt1 === "add") {
        updateScoreControlAvailability();
        return;
    }

    // Capture in-frame points/breaks before they are cleared on frame award
    if (opt1 === "add" && isSnooker()) {
        snookerFrameSnapshot = getSnookerFrameBreakSnapshot();
        snookerFrameSnapshot.winnerSlot = player;
    }

    if (player == "1") {
        if (opt1 == "add") {
            if (raceTarget !== null && p1ScoreValue + 1 > raceTarget) {
                p1ScoreValue = raceTarget;
                document.getElementById("p" + player + "Score").value = p1ScoreValue;
                updateScoreControlAvailability();
                return;
            }

            if (p1ScoreValue < 999) {
                p1ScoreValue = p1ScoreValue + 1;
                msg = { player: player, score: p1ScoreValue };
                bc.postMessage(msg);
                setStorageItem("p" + player + "ScoreCtrlPanel", p1ScoreValue);
                setStorageItem("p" + player + "Score", p1ScoreValue);
                stopClock();
                document.getElementById("p" + player + "Score").value = p1ScoreValue;
                resetExt('p1', 'noflash');
                resetExt('p2', 'noflash');
                resetBothPlayersBalls();
                scoreChanged = true;
            }
        } else if (p1ScoreValue > 0) {
            p1ScoreValue = p1ScoreValue - 1;
            msg = { player: player, score: p1ScoreValue };
            bc.postMessage(msg);
            setStorageItem("p" + player + "ScoreCtrlPanel", p1ScoreValue);
            setStorageItem("p" + player + "Score", p1ScoreValue);
            document.getElementById("p" + player + "Score").value = p1ScoreValue;
            scoreChanged = true;
        }
    }
    if (player == "2") {
        if (opt1 == "add") {
            if (raceTarget !== null && p2ScoreValue + 1 > raceTarget) {
                p2ScoreValue = raceTarget;
                document.getElementById("p" + player + "Score").value = p2ScoreValue;
                updateScoreControlAvailability();
                return;
            }

            if (p2ScoreValue < 999) {
                p2ScoreValue = p2ScoreValue + 1;
                msg2 = { player: player, score: p2ScoreValue };
                bc.postMessage(msg2);
                setStorageItem("p" + player + "ScoreCtrlPanel", p2ScoreValue);
                setStorageItem("p" + player + "Score", p2ScoreValue);
                stopClock();
                document.getElementById("p" + player + "Score").value = p2ScoreValue;
                resetExt('p1', 'noflash');
                resetExt('p2', 'noflash');
                resetBothPlayersBalls();
                scoreChanged = true;
            }
        } else if (p2ScoreValue > 0) {
            p2ScoreValue = p2ScoreValue - 1;
            msg2 = { player: player, score: p2ScoreValue };
            bc.postMessage(msg2);
            setStorageItem("p" + player + "ScoreCtrlPanel", p2ScoreValue);
            setStorageItem("p" + player + "Score", p2ScoreValue);
            document.getElementById("p" + player + "Score").value = p2ScoreValue;
            scoreChanged = true;
        }
    }

    // Send update to stream sharing if enabled
    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
    if (opt1 === "add" && isSnooker()) {
        // Frame awarded — start a fresh points/sequence state for the next frame
        resetSnookerSequenceState();
        cancelSnookerFoul();
    } else if (!isSnooker()) {
        resetBallTracker();
        resetBallSet();
    }
    updateScoreControlAvailability();

    if (window.PlayerStats && scoreChanged) {
        if (opt1 === 'add') {
            if (isSnooker() && snookerFrameSnapshot && typeof window.PlayerStats.recordSnookerFrame === "function") {
                window.PlayerStats.recordSnookerFrame(snookerFrameSnapshot).then(function () {
                    updateCallGameButton();
                }).catch(function (err) {
                    console.error('PlayerStats recordSnookerFrame error:', err);
                });
            } else {
                window.PlayerStats.recordRackWin(player).then(function () {
                    return window.PlayerStats.checkMatchCompletion();
                }).then(function () {
                    updateCallGameButton();
                    updateScoreControlAvailability();
                }).catch(function (err) {
                    console.error('PlayerStats recordRackWin error:', err);
                });
            }
        } else {
            window.PlayerStats.undoLastRack(player).then(function () {
                updateCallGameButton();
                updateScoreControlAvailability();
            }).catch(function (err) {
                console.error('PlayerStats undoLastRack error:', err);
            });
        }
    }
}

function shotClock(timex) {
    // Stop any existing timer
    stopClock();

    // Explicitly set tev based on the new timer
    tev = timex === 30000 ? 30 : 60;  // Set initial time explicitly
    console.log("Starting new timer with:", tev, "seconds");

    timerIsRunning = true;
    var stime = timex;
    bc.postMessage({ time: stime });

    // Store which button was clicked
    const buttonId = timex === 30000 ? 'shotClock30' : 'shotClock60';
    const button = document.getElementById(buttonId);
    const clockDisplay = document.getElementById("clockLocalDisplay");

    // Reset both buttons first
    document.getElementById("shotClock30").style.border = "2px solid black";
    document.getElementById("shotClock60").style.border = "2px solid black";
    document.getElementById("shotClock30").classList.remove("clkd");
    document.getElementById("shotClock60").classList.remove("clkd");

    // Then style only the clicked button
    if (timex == 30000) {
        document.getElementById("shotClock30").style.border = "2px solid black";
        document.getElementById("shotClock30").classList.add("clkd");
    } else {
        document.getElementById("shotClock60").style.border = "2px solid black";
        document.getElementById("shotClock60").classList.add("clkd");
    }

    // Disable both buttons while timer is running
    document.getElementById("shotClock30").setAttribute("onclick", "");
    document.getElementById("shotClock60").setAttribute("onclick", "");

    document.getElementById("stopClockDiv").classList.replace("obs28", "blue28");
    document.getElementById("stopClockDiv").classList.remove("hover");

    // Position clockLocalDisplay over the button that was clicked
    const buttonRect = button.getBoundingClientRect();
    clockDisplay.style.position = 'fixed';
    clockDisplay.style.left = buttonRect.left + 'px';
    clockDisplay.style.top = buttonRect.top + 'px';
    clockDisplay.style.width = '100px';
    clockDisplay.style.height = '24px';
    clockDisplay.style.display = 'flex';
    clockDisplay.style.justifyContent = 'center';
    clockDisplay.style.alignItems = 'center';
    clockDisplay.style.zIndex = '1';
}

function stopClock() {
    console.log("Stopping clock - Current tev:", tev); // Log before clearing

    // Reset ALL timer-related variables
    timerIsRunning = false;
    tev = null;  // Reset the time event variable
    countDownTime = null;  // Reset countdown time
    shotClockxr = null;  // Reset interval timer

    bc.postMessage({ clockDisplay: 'stopClock' });

    document.getElementById("shotClock30").style.border = "2px solid black";
    document.getElementById("shotClock60").style.border = "2px solid black";
    document.getElementById("shotClock30").setAttribute("onclick", "shotClock(30000)");
    document.getElementById("shotClock60").setAttribute("onclick", "shotClock(60000)");
    document.getElementById("clockLocalDisplay").style.display = 'none';
    clockDisplay("hide");
    if (getStorageItem("obsTheme") == "light") {
        document.getElementById("shotClock30").classList.remove("clkd");
        document.getElementById("shotClock60").classList.remove("clkd");
    } else {
        document.getElementById("shotClock30").classList.remove("clkd");
        document.getElementById("shotClock60").classList.remove("clkd");
    }
    document.getElementById("stopClockDiv").classList.replace("blue28", "obs28");
    document.getElementById("stopClockDiv").classList.add("hover");
}

function resetExtensions() {
    if (confirm("Click OK to confirm extension reset")) {
        resetExt('p1', 'noflash');
        resetExt('p2', 'noflash');
    } else { }
}

function add30(player) {
    var playermsgx = player;
    bc.postMessage({ clockDisplay: playermsgx + 'extension' });
    document.getElementById(player + "extensionBtn").setAttribute("onclick", "resetExt('" + player + "')");
    document.getElementById(player + "extensionBtn").classList.add("clkd");
    document.getElementById(player + "extensionBtn").style.background = "red";
    document.getElementById(player + "extensionBtn").style.color = "black";

    var playerName = document.getElementById(player + "Name").value.split(" ")[0] || player.toUpperCase();
    document.getElementById(player + "extensionBtn").innerHTML = "Reset " + playerName.substring(0, 9) + "'s Ext";

    setStorageItem(player + "Extension", "enabled");

    clockDisplay("hide");
}

function resetExt(player, flash) {
    var playermsgx = player;
    bc.postMessage({ clockDisplay: playermsgx + 'ExtReset' });

    document.getElementById(player + "extensionBtn").setAttribute("onclick", "add30('" + player + "')");
    document.getElementById(player + "extensionBtn").style.border = "2px solid black";
    document.getElementById(player + "extensionBtn").classList.remove("clkd");
    document.getElementById(player + "extensionBtn").style.background = "green";

    var playerName = document.getElementById(player + "Name").value.split(" ")[0] || player.toUpperCase();
    document.getElementById(player + "extensionBtn").innerHTML = playerName.substring(0, 9) + "'s Extension";

    // if (flash != "noflash") {
    // 	document.getElementById(player + "extensionBtn").style.border = "2px solid blue";
    // }

    setStorageItem(player + "Extension", "disabled");

}

function customLogoSetting() {
    const checkbox = document.getElementById("customLogo1");
    const isImageLoaded = getStorageItem("customLogo1") !== null;

    // Initially disable the checkbox if no image is loaded
    checkbox.disabled = !isImageLoaded;

    if (!checkbox.checked) {
        bc.postMessage({ clockDisplay: 'hidecustomLogo' });
        setStorageItem("useCustomLogo", "no");
    } else {
        bc.postMessage({ clockDisplay: 'showcustomLogo' });
        setStorageItem("useCustomLogo", "yes");
    }

    // Add event listener for checkbox toggle
    checkbox.addEventListener('change', function () {
        // Disable the checkbox immediately
        checkbox.disabled = true;

        // Handle the checkbox state
        if (checkbox.checked) {
            bc.postMessage({ clockDisplay: 'showcustomLogo' });
            setStorageItem("useCustomLogo", "yes");
        } else {
            bc.postMessage({ clockDisplay: 'hidecustomLogo' });
            setStorageItem("useCustomLogo", "no");
        }

        // Re-enable after timeout
        setTimeout(() => {
            checkbox.disabled = false; // Re-enable after timeout
        }, 1100); // 1100 ms delay
    });
}

function customLogoSetting2() {
    const checkbox = document.getElementById("customLogo2");
    const isImageLoaded = getStorageItem("customLogo2") !== null;

    // Initially disable the checkbox if no image is loaded
    checkbox.disabled = !isImageLoaded;

    if (!checkbox.checked) {
        bc.postMessage({ clockDisplay: 'hidecustomLogo2' });
        setStorageItem("useCustomLogo2", "no");
    } else {
        bc.postMessage({ clockDisplay: 'showcustomLogo2' });
        setStorageItem("useCustomLogo2", "yes");
    }

    // Add event listener for checkbox toggle
    checkbox.addEventListener('change', function () {
        // Disable the checkbox immediately
        checkbox.disabled = true;

        // Handle the checkbox state
        if (checkbox.checked) {
            bc.postMessage({ clockDisplay: 'showcustomLogo2' });
            setStorageItem("useCustomLogo2", "yes");
        } else {
            bc.postMessage({ clockDisplay: 'hidecustomLogo2' });
            setStorageItem("useCustomLogo2", "no");
        }

        // Re-enable after timeout
        setTimeout(() => {
            checkbox.disabled = false; // Re-enable after timeout
        }, 1100); // 1100 ms delay
    });
}

function togglePlayer(isChecked) {
    const activePlayer = isChecked
    const player = isChecked ? 1 : 2; // Determine active player based on checkbox state
    const useToggleCheckbox = document.getElementById("useToggleSetting");
    if (useToggleCheckbox.checked) {
        bc.postMessage({ clockDisplay: 'toggleActivePlayer', player: activePlayer }); 	// Send a message to the broadcast channel with the active player
    } else {
        console.log(`Not changing visual active player indicator UI, due to useToggleSetting being disabled`);
    }
    setStorageItem("activePlayer", player);
    setStorageItem("toggleState", activePlayer);
    console.log(`Player ${player} is active`); // Log the active player
    updateActivePlayerNameDisplay();
    if (isSnookerBallMode()) {
        // Visit ended — keep frame high breaks and reds-potted count.
        endSnookerBreak();
        resetSnookerSequenceState({ keepReds: true, keepBreaks: true, keepFrameHighs: true });
    }
}

function obsThemeChange() {
    if (document.getElementById("obsTheme").value == "28") {
        setStorageItem("obsTheme", "28");
        document.getElementById("obsTheme").value = "28";
        document.getElementsByTagName("body")[0].style.background = "#2b2e38";
        document.styleSheets[0].disabled = false;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;

    }
    if (document.getElementById("obsTheme").value == "27") {
        setStorageItem("obsTheme", "27");
        document.getElementById("obsTheme").value = "27";
        document.getElementsByTagName("body")[0].style.background = "#1f1e1f";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = false;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;
    }
    if (document.getElementById("obsTheme").value == "acri") {
        setStorageItem("obsTheme", "acri");
        document.getElementById("obsTheme").value = "acri";
        document.getElementsByTagName("body")[0].style.background = "#181819";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = false;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;
    }
    if (document.getElementById("obsTheme").value == "grey") {
        setStorageItem("obsTheme", "grey");
        document.getElementById("obsTheme").value = "grey";
        document.getElementsByTagName("body")[0].style.background = "#2f2f2f";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = false;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;
    }
    if (document.getElementById("obsTheme").value == "light") {
        setStorageItem("obsTheme", "light");
        document.getElementById("obsTheme").value = "light";
        document.getElementsByTagName("body")[0].style.background = "#e5e5e5";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = false;
        document.styleSheets[5].disabled = true;
    }
    if (document.getElementById("obsTheme").value == "rachni") {
        setStorageItem("obsTheme", "rachni");
        document.getElementById("obsTheme").value = "rachni";
        document.getElementsByTagName("body")[0].style.background = "#232629";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = false;
    }
}

function startThemeCheck() {
    if (getStorageItem("obsTheme") == null) { setStorageItem("obsTheme", "27"); document.getElementById("obsTheme").value = "27"; };
    if (getStorageItem("obsTheme") == "28") {
        document.getElementById("obsTheme").value = "28";
        document.getElementsByTagName("body")[0].style.background = "#2b2e38";
        document.styleSheets[0].disabled = false;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;
    }
    if (getStorageItem("obsTheme") == "27") {
        document.getElementById("obsTheme").value = "27";
        document.getElementsByTagName("body")[0].style.background = "#1f1e1f";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = false;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;
    }
    if (getStorageItem("obsTheme") == "acri") {
        document.getElementById("obsTheme").value = "acri";
        document.getElementsByTagName("body")[0].style.background = "#181819";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = false;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;
    }
    if (getStorageItem("obsTheme") == "grey") {
        document.getElementById("obsTheme").value = "grey";
        document.getElementsByTagName("body")[0].style.background = "#2f2f2f";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = false;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = true;
    }
    if (getStorageItem("obsTheme") == "light") {
        document.getElementById("obsTheme").value = "light";
        document.getElementsByTagName("body")[0].style.background = "#e5e5e5";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = false;
        document.styleSheets[5].disabled = true;
    }
    if (getStorageItem("obsTheme") == "rachni") {
        document.getElementById("obsTheme").value = "rachni";
        document.getElementsByTagName("body")[0].style.background = "#232629";
        document.styleSheets[0].disabled = true;
        document.styleSheets[1].disabled = true;
        document.styleSheets[2].disabled = true;
        document.styleSheets[3].disabled = true;
        document.styleSheets[4].disabled = true;
        document.styleSheets[5].disabled = false;
    }
}

function cLogoNameChange() {
    cLogoName = prompt("Rename \'Player 1 Logo\' checkbox label (13 character maximum)");
    if (cLogoName != null && cLogoName != "") {
        setStorageItem("clogoNameStored", cLogoName.substring(0, 13));
        document.getElementById("logoName").innerHTML = cLogoName.substring(0, 13);
    }
}

function cLogoNameChange2() {
    cLogoName2 = prompt("Rename \'Player 2 Logo\' checkbox label (13 character maximum)");
    if (cLogoName2 != null && cLogoName2 != "") {
        setStorageItem("clogoName2Stored", cLogoName2.substring(0, 13));
        document.getElementById("logoName2").innerHTML = cLogoName2.substring(0, 13);
    }
}

let pendingResetAction = null; // 'reset' | 'endMatch' | 'callGame'

function openResetScoresModal(action) {
    pendingResetAction = action;
    const modal = document.getElementById("resetScoresModal");
    const title = document.getElementById("resetScoresModalTitle");
    const message = document.getElementById("resetScoresModalMessage");
    const confirmBtn = document.getElementById("resetScoresModalConfirm");

    const copy = {
        reset: {
            title: "Reset Score",
            message: "Reset all scores for this match? This cannot be undone from here.",
            confirm: "Reset Score",
            fallback: "Click OK to confirm score reset"
        },
        endMatch: {
            title: "End Match",
            message: "End the match and clear all scores? Recorded stats will be kept.",
            confirm: "End Match",
            fallback: "Click OK to end the match and clear all scores"
        },
        callGame: {
            title: "Call Match Early",
            message: "End this match early and keep completed racks/frames in match history? Scores will clear after saving.",
            confirm: "Call Match Early",
            fallback: "Click OK to call the match early and save completed racks/frames"
        }
    };
    const cfg = copy[action] || copy.reset;

    if (!modal || !title || !message) {
        if (!confirm(cfg.fallback)) {
            pendingResetAction = null;
            return;
        }
        if (action === "callGame") {
            performCallGame();
        } else {
            performResetScores({ endMatch: action === "endMatch" });
        }
        return;
    }
    title.textContent = cfg.title;
    message.textContent = cfg.message;
    if (confirmBtn) {
        confirmBtn.textContent = cfg.confirm;
    }
    modal.style.display = "block";
}

function resetScores() {
    openResetScoresModal(isRaceComplete() ? "endMatch" : "reset");
}

function callGameScores() {
    if (isRaceComplete()) {
        return;
    }
    if (!window.PlayerStats || typeof window.PlayerStats.canCallGame !== "function" ||
        !window.PlayerStats.canCallGame()) {
        return;
    }
    openResetScoresModal("callGame");
}

function cancelResetScores() {
    const modal = document.getElementById("resetScoresModal");
    if (modal) {
        modal.style.display = "none";
    }
    pendingResetAction = null;
}

function resetScoresModalBackdrop(event) {
    if (event && event.target && event.target.id === "resetScoresModal") {
        cancelResetScores();
    }
}

function confirmResetScores() {
    const action = pendingResetAction;
    cancelResetScores();
    if (action === "callGame") {
        performCallGame();
        return;
    }
    performResetScores({ endMatch: action === "endMatch" });
}

function performCallGame() {
    if (!window.PlayerStats || typeof window.PlayerStats.callGame !== "function") {
        return;
    }
    window.PlayerStats.callGame().then(function (saved) {
        if (saved) {
            performResetScores({ endMatch: true });
        } else {
            updateCallGameButton();
            updateScoreControlAvailability();
        }
    }).catch(function (err) {
        console.error("PlayerStats callGame error:", err);
        alert("Call Match Early failed: " + err.message);
        updateCallGameButton();
    });
}

function performResetScores(options) {
    const endMatch = !!(options && options.endMatch);

        // Clear primary rack/frame scores
        document.getElementById("p1Score").value = "0";
        document.getElementById("p2Score").value = "0";
        bc.postMessage({ player: '1', score: '0' });
        bc.postMessage({ player: '2', score: '0' });
        p1ScoreValue = 0;
        p2ScoreValue = 0;
        setStorageItem("p1ScoreCtrlPanel", 0);
        setStorageItem("p2ScoreCtrlPanel", 0);
        setStorageItem("p1Score", 0);
        setStorageItem("p2Score", 0);

        const p1BallsInput = document.getElementById("p1Balls");
        const p2BallsInput = document.getElementById("p2Balls");
        if (p1BallsInput) {
            p1BallsInput.value = "0";
        }
        if (p2BallsInput) {
            p2BallsInput.value = "0";
        }
        bc.postMessage({ player: '1', balls: 0 });
        bc.postMessage({ player: '2', balls: 0 });
        setStorageItem("p1BallsCtrlPanel", 0);
        setStorageItem("p2BallsCtrlPanel", 0);
        setStorageItem("p1Balls", 0);
        setStorageItem("p2Balls", 0);

        resetExt('p1', 'noflash');
        resetExt('p2', 'noflash');
        resetBallTracker();
        resetBallSet();
        if (isSnookerBallMode()) {
            resetSnookerSequenceState();
            cancelSnookerFoul();
        }

        // Send update to stream sharing if enabled
        if (window.streamSharing) {
            window.streamSharing.sendUpdate();
        }

        if (window.PlayerStats) {
            // End Match / Call Match Early keeps recorded stats; mid-match Reset Score undoes the open session.
            const opts = endMatch ? { endMatch: true } : undefined;
            window.PlayerStats.onResetScores(opts).then(function () {
                updateScoreControlAvailability();
            }).catch(function (err) {
                console.error('PlayerStats onResetScores error:', err);
                updateScoreControlAvailability();
            });
        } else {
            updateScoreControlAvailability();
        }
}

function resetBallSet() {
    setStorageItem("playerBallSet", "p1Open");
    document.getElementById('p1colorOpen').checked = true;
    bc.postMessage({ playerBallSet: "p1Open" });
}

function resetBallTracker() {
    // Retrieve the saved ball state from localStorage
    let ballState = JSON.parse(getStorageItem('ballState') || '{}');

    // Select all ball elements within the .ballTracker container
    const ballElements = document.querySelectorAll('.ball');

    ballElements.forEach(function (ball) {
        // Remove the 'faded' class to reset the ball
        ball.classList.remove('faded');

        // Update the ball state to false (not faded)
        ballState[ball.id] = false;
        bc.postMessage({ resetBall: ball.id });
    });

    // Save the updated state back to localStorage
    setStorageItem('ballState', JSON.stringify(ballState));
    clearPocketBallOwners();

    console.log("All balls have been reset in ball tracker.");
}

function clearLogo(xL) {
    // Remove the custom logo from localStorage
    localStorage.removeItem("customLogo" + xL);

    // Clear the preview image source
    var imgElem = document.getElementById("l" + xL + "Img");
    if (imgElem) {
        imgElem.src = "./common/images/placeholder.png";
    }

    // Reset the file input field so that a file can be re-selected
    var fileInput = document.getElementById("FileUploadL" + xL);
    if (fileInput) {
        fileInput.value = "";
    }

    // Reset the label text to its default state
    var defaultText = (xL === 1) ? "Upload Player 1 Logo" :
        (xL === 2) ? "Upload Player 2 Logo" :
            "L" + (xL - 2);
    var textElem = document.getElementById("FileUploadLText" + xL);
    if (textElem) {
        textElem.textContent = defaultText;
    }

    // For player logos (1 and 2), uncheck their associated checkbuttons
    if (xL === 1 || xL === 2) {
        var checkbox = document.getElementById("customLogo" + xL);
        if (checkbox) {
            checkbox.checked = false;
        }
        if (xL === 1) {
            setStorageItem("useCustomLogo", "no");
            customLogoSetting();
        } else {
            setStorageItem("useCustomLogo2", "no");
            customLogoSetting2();
        }
        var fileInput = document.getElementById("FileUploadL" + xL);
        toggleCheckbox("customLogo" + xL, fileInput)
    }

    // Rebind the container's click so that it triggers a file input click
    var containerId;
    if (xL === 1) {
        containerId = "uploadCustomLogo";
    } else if (xL === 2) {
        containerId = "uploadCustomLogo2";
    } else {
        containerId = "logoSsImg" + xL;
    }
    var container = document.getElementById(containerId);
    if (container && fileInput) {
        container.onclick = function (e) {
            fileInput.click();
        };
        // Restore original styling by removing inline styles
        container.style.backgroundColor = "";
        container.style.color = "";
    }
}

function setStorageItem(key, value) {
    const prefix = INSTANCE_ID ? `${INSTANCE_ID}_` : '';
    localStorage.setItem(`${prefix}${key}`, value);
}

function getStorageItem(key, defaultValue = null) {
    const prefix = INSTANCE_ID ? `${INSTANCE_ID}_` : '';
    const value = localStorage.getItem(`${prefix}${key}`);
    return value !== null ? value : defaultValue;
}

const STATS_PROTECTED_KEYS = ['overlayStatsMode', 'overlayStatsPayload'];

function isStatsProtectedKey(key) {
    if (!key) {
        return false;
    }
    return STATS_PROTECTED_KEYS.includes(key);
}

function resetAll() {
    if (confirm("Click OK to confirm complete reset. This will clear all stored data for ALL scoreboard instance.")) {
        clearAllData();
    }
}
function clearAllData() {
    if (confirm('Are you sure you want to clear ALL locally stored data for CueSports Scoreboard, and reset to defaults?')) {
        removeAllData(INSTANCE_ID);
        location.reload(); // Reload the page to start fresh
        // Send refresh message to browser_source before clearing data
        bc.postMessage({ refresh: true });
    }
}
// cuesport_stats IndexedDB is never cleared here — only via Stats modal Clear All Stats.
function removeAllData() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!isStatsProtectedKey(key)) {
            localStorage.removeItem(key);
        }
    }
}

function resetInstance() {
    if (confirm("Click OK to confirm complete reset. This will clear stored data for this scoreboard instance.")) {
        clearInstanceData();
    }
}

function clearInstanceData() {
    if (confirm('Are you sure you want to clear stored data for this scoreboard instance, and reset to defaults?')) {
        const INSTANCE_ID = urlParams.get('instance') || '';
        removeInstanceData(INSTANCE_ID);
        location.reload(); // Reload the page to start fresh
        // Send refresh message to browser_source before clearing data
        bc.postMessage({ refresh: true });
    }
}

function removeInstanceData(instanceId) {
    if (instanceId === null || instanceId === undefined) {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!isStatsProtectedKey(key)) {
                localStorage.removeItem(key);
            }
        }
    } else {
        // Remove only items for this instance
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key.startsWith(instanceId)) {
                localStorage.removeItem(key);
            }
        }
    }
}

function checkForUpdate() {
    const updateStatus = document.getElementById('updateStatus');
    updateStatus.textContent = "Checking for updates...";

    fetch('https://api.github.com/repos/iainsmacleod/CueSport-Scoreboard/releases/latest')
        .then(response => {
            if (!response.ok) {
                throw new Error(`GitHub API request failed: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const latestVersion = data.tag_name.replace(/^v/, '');
            if (compareVersions(latestVersion, versionNum) > 0) {
                updateStatus.innerHTML = `Update available! Latest version: ${latestVersion}&nbsp; 
<a href="${data.html_url}" target="_blank" rel="noopener noreferrer" style="color: red;">Download Update</a>`;

            } else {
                updateStatus.textContent = "You have the latest version.";
            }
        })
        .catch(error => {
            updateStatus.textContent = "Error checking for updates. Please try again later.";
            console.error("Update check failed:", error);
        });
}

function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;
        if (part1 > part2) return 1;
        if (part1 < part2) return -1;
    }
    return 0;
}

function updateLayout() {
    // Force layout recalculation
    const tabContents = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabContents.length; i++) {
        if (tabContents[i].style.display !== "none") {
            // Only update visible tabs
            LayoutRebuilder.ForceRebuildLayoutImmediate(tabContents[i]);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('obsPassword');

    // Only add toggle event listener if password field exists
    if (toggleBtn && passwordInput) {
        toggleBtn.style.display = passwordInput.value ? 'flex' : 'none';

        toggleBtn.addEventListener('click', () => {
            if (!passwordInput.value) return; // Do nothing if no password

            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                toggleBtn.textContent = 'Hide Password';
            } else {
                passwordInput.type = 'password';
                toggleBtn.textContent = 'Show Password';
            }
        });

        // Optionally, listen to input changes to hide/show button dynamically
        passwordInput.addEventListener('input', () => {
            toggleBtn.style.display = passwordInput.value ? 'flex' : 'none';
            // Reset input type and button text when emptied
            if (!passwordInput.value) {
                passwordInput.type = 'password';
                toggleBtn.textContent = 'Show';
            }
        });
    }
    
    // Initialize WebSocket toggle state and auto-connect if previously enabled
    initializeWebSocketSettings();
});

// Initialize WebSocket settings and auto-connect if previously enabled
function initializeWebSocketSettings() {
    // Update toggle state based on current connection status
    updateWebSocketToggle();
    
    // Check if WebSocket was previously enabled and configured
    const wasEnabled = getStorageItem('websocketEnabled') === 'true';
    const isConfigured = isWebSocketConfigured();
    
    if (wasEnabled && isConfigured && !isConnected) {
        // Auto-connect after a short delay to ensure DOM is ready
        setTimeout(() => {
            const toggle = document.getElementById('websocketToggle');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                connectWebSocket();
            }
        }, 500);
    } else if (!isConfigured && wasEnabled) {
        // Was enabled but configuration is missing - show modal
        const toggle = document.getElementById('websocketToggle');
        if (toggle) toggle.checked = false;
        setStorageItem('websocketEnabled', 'false');
    }
}

function getObsAddress() {
    // Try modal input first, then fallback to localStorage, then default
    const modalInput = document.getElementById('obsAddressModal');
    if (modalInput && modalInput.value.trim()) {
        return modalInput.value.trim();
    }
    const saved = getStorageItem('obsAddress');
    return saved || 'ws://127.0.0.1:4455'; // fallback to default if empty
}

function getObsPassword() {
    // Try modal input first, then fallback to localStorage
    const modalInput = document.getElementById('obsPasswordModal');
    if (modalInput && modalInput.value.trim()) {
        return modalInput.value.trim();
    }
    const saved = getStorageItem('obsPassword');
    return saved || ''; // fallback to empty if not set
}

function isWebSocketConfigured() {
    const address = getObsAddress();
    // Address is required, password is optional
    return address && address.trim() !== '';
}

function autoResumeReplayBuffer() {
    const autoResumeReplayBuffer = document.getElementById("autoResumeReplayBuffer").checked;
    if (autoResumeReplayBuffer) {
        // document.getElementById("autoResumeReplayBuffer").checked = true;
        setStorageItem("autoResumeReplayBuffer", "yes");
    } else {
        // document.getElementById("autoResumeReplayBuffer").checked = false;
        setStorageItem("autoResumeReplayBuffer", "no");
    }
}

async function toggleWebSocketConnection() {
    const toggle = document.getElementById('websocketToggle');
    if (!toggle) return;
    
    // If trying to enable but not configured, show modal
    if (toggle.checked && !isWebSocketConfigured()) {
        toggle.checked = false;
        openWebSocketSettingsModal();
        return;
    }
    
    if (toggle.checked) {
        // Connect
        await connectWebSocket();
    } else {
        // Disconnect
        await disconnectWebSocket();
    }
}

async function connectWebSocket() {
    if (isConnected) return; // Already connected
    
    const address = getObsAddress();
    const password = getObsPassword();

    if (!address || address.trim() === '') {
        const toggle = document.getElementById('websocketToggle');
        if (toggle) toggle.checked = false;
        openWebSocketSettingsModal();
        return;
    }

    try {
        await obs.connect(address, password);
        isConnected = true;
        setStorageItem('isConnected', 'true');
        setStorageItem('websocketEnabled', 'true'); // Persistent enabled state
        updateWebSocketToggle();
        updateReplayButtonsVisibility();
        updateReplaySourceSettingsVisibility();
        console.log('OBS WebSocket: Connected and authenticated');
    } catch (err) {
        console.error('Failed to connect:', err);
        const toggle = document.getElementById('websocketToggle');
        if (toggle) toggle.checked = false;
        setStorageItem('websocketEnabled', 'false');
        updateWebSocketToggle();
        alert('Failed to connect. Is OBS running and WebSocket enabled? Check your OBS settings.\n\nDetails: ' + (err.message || err.toString()));
        // Show modal if connection fails due to configuration
        openWebSocketSettingsModal();
    }
}

async function disconnectWebSocket() {
    if (!isConnected) return; // Already disconnected
    
    if (getStorageItem("isMonitoringActive") === "true") {
        await toggleReplayMonitoring();
    }
    
    try {
        await obs.disconnect();
        isConnected = false;
        setStorageItem('isConnected', 'false');
        setStorageItem('websocketEnabled', 'false'); // Persistent enabled state
        updateWebSocketToggle();
        updateReplayButtonsVisibility();
        updateReplaySourceSettingsVisibility();
        
        // Disconnect stream promotion since it requires WebSocket to check OBS streaming status
        if (window.streamSharing && typeof window.streamSharing.disconnect === 'function') {
            window.streamSharing.disconnect();
        }
        
        console.log('Disconnected from OBS WebSocket');
    } catch (err) {
        console.error('Failed to disconnect:', err);
        alert('Failed to disconnect: ' + (err.message || err.toString()));
    }
}

// Legacy function for backwards compatibility
async function connectToObsWebSocket() {
    const toggle = document.getElementById('websocketToggle');
    if (toggle) {
        toggle.checked = !toggle.checked;
        await toggleWebSocketConnection();
    }
}

// WebSocket Settings Modal Functions
function openWebSocketSettingsModal() {
    const modal = document.getElementById('websocketSettingsModal');
    if (!modal) return;
    
    // Load current values into modal
    const addressInput = document.getElementById('obsAddressModal');
    const passwordInput = document.getElementById('obsPasswordModal');
    
    if (addressInput) {
        const saved = getStorageItem('obsAddress');
        addressInput.value = saved || 'ws://127.0.0.1:4455';
    }
    
    if (passwordInput) {
        const saved = getStorageItem('obsPassword');
        passwordInput.value = saved || '';
        passwordInput.type = 'password';
        const toggleBtn = document.getElementById('togglePasswordModal');
        if (toggleBtn) {
            const eyeIcon = toggleBtn.querySelector('.eye-icon');
            if (eyeIcon) {
                eyeIcon.textContent = '👁'; // Start with closed/hidden state (styled with CSS line through)
                toggleBtn.classList.add('hidden');
            }
        }
    }
    
    modal.style.display = 'block';
}

function closeWebSocketSettingsModal() {
    const modal = document.getElementById('websocketSettingsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function saveWebSocketSettings() {
    const addressInput = document.getElementById('obsAddressModal');
    const passwordInput = document.getElementById('obsPasswordModal');
    
    if (!addressInput) return;
    
    const address = addressInput.value.trim();
    if (!address) {
        alert('OBS WebSocket Address is required.');
        return;
    }
    
    // Save to localStorage
    setStorageItem('obsAddress', address);
    if (passwordInput) {
        setStorageItem('obsPassword', passwordInput.value);
    }
    
    closeWebSocketSettingsModal();
    
    // If toggle is on, attempt to connect
    const toggle = document.getElementById('websocketToggle');
    if (toggle && toggle.checked) {
        connectWebSocket();
    }
}

function togglePasswordVisibility() {
    const passwordInput = document.getElementById('obsPasswordModal');
    const toggleBtn = document.getElementById('togglePasswordModal');
    
    if (!passwordInput || !toggleBtn) return;
    
    const eyeIcon = toggleBtn.querySelector('.eye-icon');
    if (!eyeIcon) return;
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.textContent = '👁'; // Open eye when visible
        toggleBtn.classList.remove('hidden');
        toggleBtn.title = 'Hide password';
    } else {
        passwordInput.type = 'password';
        eyeIcon.textContent = '👁'; // Same icon, styled as closed with CSS (line through)
        toggleBtn.classList.add('hidden');
        toggleBtn.title = 'Show password';
    }
}

// Close modal when clicking outside of it
window.onclick = function(event) {
    const websocketModal = document.getElementById('websocketSettingsModal');
    const streamModal = document.getElementById('streamPromotionSettingsModal');
    const statsModal = document.getElementById('statsModal');
    const matchEditModal = document.getElementById('statsMatchEditModal');
    const playerRenameModal = document.getElementById('statsPlayerRenameModal');
    
    if (event.target === websocketModal) {
        closeWebSocketSettingsModal();
    }
    if (event.target === streamModal) {
        closeStreamPromotionSettingsModal();
    }
    if (event.target === statsModal) {
        closeStatsModal();
    }
    if (event.target === matchEditModal) {
        closeMatchEditModal();
    }
    if (event.target === playerRenameModal) {
        closePlayerRenameModal();
    }
}


function updateConnectButton() {
    // Legacy function - now updates toggle instead
    updateWebSocketToggle();
}

function updateWebSocketToggle() {
    const toggle = document.getElementById('websocketToggle');
    if (!toggle) return;
    
    isConnected = getStorageItem('isConnected') === 'true';
    toggle.checked = isConnected;
    
    // Update replay source settings visibility based on WebSocket connection
    updateReplaySourceSettingsVisibility();
}

// Update replay source settings visibility based on WebSocket connection
function updateReplaySourceSettingsVisibility() {
    // Find the "Replay Source Settings" section header specifically (not WebSocket Settings)
    // We'll find it by looking for the section header that contains this text
    const allSectionHeaders = document.querySelectorAll('.section-header');
    let replaySourceHeader = null;
    
    for (let header of allSectionHeaders) {
        if (header.textContent && header.textContent.trim() === 'Replay Source Settings') {
            replaySourceHeader = header;
            break;
        }
    }
    
    if (!replaySourceHeader) return;
    
    // Find all replay source settings elements
    const replayElements = [];
    replayElements.push(replaySourceHeader);
    
    // Find form rows - get all form-row elements after the section header
    let currentElement = replaySourceHeader.nextElementSibling;
    while (currentElement) {
        if (currentElement.classList && currentElement.classList.contains('form-row')) {
            replayElements.push(currentElement);
        } else if (currentElement.classList && currentElement.classList.contains('section-header')) {
            // Stop if we hit another section header
            break;
        }
        currentElement = currentElement.nextElementSibling;
    }
    
    // Find inputs and button
    const videoSourceInput = document.getElementById('replayVideoSourceName');
    const indicatorSourceInput = document.getElementById('replayIndicatorSourceName');
    const autoResumeCheckbox = document.getElementById('autoResumeReplayBuffer');
    const sendSourceBtn = document.getElementById('sendSourceInfo');
    
    // Apply styling based on WebSocket connection state
    const isConnected = getStorageItem('isConnected') === 'true';
    
    // Apply opacity to section header and form rows
    replayElements.forEach(el => {
        if (el) {
            if (!isConnected) {
                el.style.setProperty('opacity', '0.6', 'important');
            } else {
                el.style.setProperty('opacity', '1', 'important');
            }
        }
    });
    
    // Also directly target labels with !important to ensure they get dimmed
    // Find all form-rows after the section header and get their labels
    let currentRow = replaySourceHeader.nextElementSibling;
    while (currentRow) {
        if (currentRow.classList && currentRow.classList.contains('form-row')) {
            const labels = currentRow.querySelectorAll('label');
            labels.forEach(label => {
                if (!isConnected) {
                    label.style.setProperty('opacity', '0.6', 'important');
                } else {
                    label.style.setProperty('opacity', '1', 'important');
                }
            });
            
            // Also dim the "*Required Fields" text if it exists in this row
            const requiredFieldsText = currentRow.querySelector('.field');
            if (requiredFieldsText && requiredFieldsText.textContent && requiredFieldsText.textContent.includes('*Required Fields')) {
                if (!isConnected) {
                    requiredFieldsText.style.setProperty('opacity', '0.6', 'important');
                } else {
                    requiredFieldsText.style.setProperty('opacity', '1', 'important');
                }
            }
        } else if (currentRow.classList && currentRow.classList.contains('section-header')) {
            // Stop if we hit another section header
            break;
        }
        currentRow = currentRow.nextElementSibling;
    }
    
    // Disable/enable inputs and button
    if (videoSourceInput) {
        videoSourceInput.disabled = !isConnected;
    }
    if (indicatorSourceInput) {
        indicatorSourceInput.disabled = !isConnected;
    }
    if (autoResumeCheckbox) {
        autoResumeCheckbox.disabled = !isConnected;
    }
    if (sendSourceBtn) {
        sendSourceBtn.disabled = !isConnected;
        sendSourceBtn.style.cursor = isConnected ? 'pointer' : 'not-allowed';
    }
}

async function getActiveSceneName() {
    try {
        const { currentProgramSceneName } = await obs.call('GetCurrentProgramScene');
        if (currentProgramSceneName) {
            return currentProgramSceneName;
        }
    } catch (err) {
        console.warn('GetCurrentProgramScene failed, falling back to GetCurrentScene', err);
    }

    try {
        const { name } = await obs.call('GetCurrentScene');
        if (name) {
            return name;
        }
    } catch (fallbackError) {
        console.error('Unable to determine active scene from OBS', fallbackError);
        throw new Error('Unable to determine active OBS scene');
    }

    throw new Error('Active scene name unavailable');
}

async function getSceneItemId(sceneName, sourceName) {
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
    const item = sceneItems.find(i => i.sourceName === sourceName);
    if (!item) throw new Error(`Source ${sourceName} not found in scene ${sceneName}`);
    return item.sceneItemId;
}

async function showSource(sceneName, sourceName) {
    // Handle optional/missing source name gracefully
    if (!sourceName || sourceName.trim() === "") {
        return; // Silently skip if source name is not provided (optional parameter)
    }

    try {
        const id = await getSceneItemId(sceneName, sourceName);
        if (id === null || id === undefined) {
            alert(`Error: Source "${sourceName}" not found in scene "${sceneName}". Please check the names.`);
            return;
        }
        await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId: id, sceneItemEnabled: true });
    } catch (error) {
        console.error(`Failed to show source "${sourceName}" in scene "${sceneName}":`, error);
        alert(`OBS Error: Could not show source "${sourceName}" in scene "${sceneName}". Please verify your inputs.`);
    }
}

async function hideSource(sceneName, sourceName) {
    // Handle optional/missing source name gracefully
    if (!sourceName || sourceName.trim() === "") {
        return; // Silently skip if source name is not provided (optional parameter)
    }

    try {
        const id = await getSceneItemId(sceneName, sourceName);
        if (id === null || id === undefined) {
            console.warn(`Source "${sourceName}" not found in scene "${sceneName}".`);
            alert(`Error: Source "${sourceName}" not found in scene "${sceneName}". Please check the names.`);
            return;
        }
        await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId: id, sceneItemEnabled: false });
        console.log(`Source "${sourceName}" hidden in scene "${sceneName}".`);
    } catch (error) {
        console.error(`Failed to hide source "${sourceName}" in scene "${sceneName}":`, error);
        alert(`OBS Error: Could not hide source "${sourceName}" in scene "${sceneName}". Please verify your inputs and OBS connection.`);
    }
}
obs.on('MediaInputPlaybackEnded', async ({ inputName }) => {
	const { videoSource, indicatorSource } = getReplaySettings();
	let sceneName = null;
	try {
		sceneName = await getActiveSceneName();
	} catch (err) {
		console.warn('Could not resolve active scene on playback end:', err);
	}

	if (inputName === videoSource && sceneName) {
		try {
			await hideSource(sceneName, indicatorSource);
			await hideSource(sceneName, videoSource);
			console.log(`MediaInputPlaybackEnded event received for ${inputName}, source hidden.`);
			if (document.getElementById("autoResumeReplayBuffer").checked) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		} catch (error) {
			console.error('Error hiding replay source on playback end:', error);
		}
	}
	if (document.getElementById("autoResumeReplayBuffer").checked) {
		toggleReplayMonitoring();
	}
	return;
});

async function showReplayIndicator(sceneName) {
    const textSceneItemId = await getSceneItemId(sceneName, REPLAY_TEXT_NAME);
    await obs.call('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: textSceneItemId,
        sceneItemEnabled: true,
    });
}

async function hideReplayIndicator(sceneName) {
    const textSceneItemId = await getSceneItemId(sceneName, REPLAY_TEXT_NAME);
    await obs.call('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: textSceneItemId,
        sceneItemEnabled: false,
    });
}

// When the replay is saved, OBS emits ReplayBufferSaved with the file path
obs.on('ReplayBufferSaved', ({ savedReplayPath }) => {
	console.log('ReplayBufferSaved event received:', savedReplayPath);
});

// OBS v5 lifecycle events
obs.on('ConnectionOpened', () => {
    console.log('OBS WebSocket: ConnectionOpened');
});

obs.on('Identified', () => {
    isObsReady = true;
    console.log('OBS WebSocket: Identified (ready for requests)');
    // setButtonsEnabled(true);
});

obs.on('ConnectionClosed', () => {
    isObsReady = false;
    isConnected = false;
    setStorageItem('isConnected', 'false');
    updateConnectButton();
    updateReplaySourceSettingsVisibility();
    console.warn('OBS WebSocket: ConnectionClosed');
    
    // Disconnect stream promotion since it requires WebSocket to check OBS streaming status
    if (window.streamSharing && typeof window.streamSharing.disconnect === 'function') {
        window.streamSharing.disconnect();
    }
    
    // setButtonsEnabled(false);
});

// UI helpers
function setMonitorButtonText() {
    const btn = document.getElementById('btnMonitorGame');
    if (!btn) return;
    if (getStorageItem("isMonitoringActive") === "true") {
        btn.textContent = 'Stop Monitoring';
        btn.style.backgroundColor = 'red';  // red fill for Stop Monitoring
        btn.style.color = 'white';           // optionally set text color for contrast
    } else {
        btn.textContent = 'Resume Monitoring';
        btn.style.backgroundColor = 'green'; // green fill for Resume Monitoring
        btn.style.color = 'white';            // optionally set text color
    }
}

function setReplayButtonText() {
    const btn = document.getElementById('btnReplayClip');
    if (!btn) return;
    if ((getStorageItem("isMonitoringActive") === "false")) {
        btnReplayClip.classList.add('noShow');
    }
}

// One-time wait for ReplayBufferSaved
function waitForReplaySaved(timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const handler = ({ savedReplayPath }) => {
            if (settled) return;
            settled = true;
            obs.off('ReplayBufferSaved', handler);
            resolve(savedReplayPath);
        };

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            obs.off('ReplayBufferSaved', handler);
            reject(new Error('Timed out waiting for ReplayBufferSaved'));
        }, timeoutMs);

        obs.on('ReplayBufferSaved', (evt) => {
            clearTimeout(timer);
            handler(evt);
        });
    });
}

// Replay/Restart Clip handler
async function triggerInstantReplay() {
    if (!isObsReady) {
        console.log('Failed to control OBS: OBS connection is not ready, most likely the websocket connection has not been setup.');
        alert('Failed to control OBS: OBS connection is not ready, most likely the websocket connection has not been setup.');
        return;
    }

    // First time: need to save a clip first
    try {
        // If monitoring is not active, we can't save a new clip
        if ((getStorageItem("isMonitoringActive") === "false" || getStorageItem("isMonitoringActive") === null)) {
            console.warn('Cannot replay: monitoring is not active and no saved clip exists.');
            alert('Cannot replay: monitoring is not active and no saved clip exists.');
            return;
        }

        // Confirm replay buffer is running
        const { outputActive } = await obs.call('GetReplayBufferStatus');
        if (!outputActive) {
            console.warn('Replay buffer is not running; cannot save replay.');
            alert('Replay buffer is not running; cannot save replay.');
            return;
        }

        // Get and preserve current settings BEFORE saving
        const { videoSource } = getReplaySettings();
        if (!videoSource) {
            console.error('Replay video source name not configured.');
            alert('Replay video source name not configured.');
            return;
        }

        let originalSettings = null;
        try {
            const currentSettings = await obs.call('GetInputSettings', {
                inputName: videoSource
            });
            originalSettings = currentSettings.inputSettings;
            console.log('Preserved original Media Source settings before save');
        } catch (error) {
            console.warn('Could not get original settings:', error);
        }

        // NOW save the replay (this might change the settings)
        const savedPathPromise = waitForReplaySaved(8000);
        await obs.call('SaveReplayBuffer');
        const savedPath = await savedPathPromise;

        // Stop monitoring
        try {
            const { outputActive } = await obs.call('GetReplayBufferStatus');
            if (outputActive) {
                try {
                    await obs.call('StopReplayBuffer');
                    await new Promise(r => setTimeout(r, 150)); // small delay
                } catch (err) {
                    console.error('Failed to stop replay buffer:', err);
                }
            }
            // Always update state and button text when playing a replay, regardless of buffer state
            isMonitoringActive = false;
            setStorageItem('isMonitoringActive', 'false');
            setMonitorButtonText();
        } catch (err) {
            console.error('Failed to stop replay buffer:', err);
            // Still update state even if check failed
            isMonitoringActive = false;
            setStorageItem('isMonitoringActive', 'false');
            setMonitorButtonText();
        }

        // Restore original settings and set the new file
        await obs.call('SetInputSettings', {
            inputName: videoSource,
            inputSettings: {
                ...originalSettings,  // Restore all original settings
                local_file: savedPath,  // Override just the file path
            },
            overlay: false
        });

        // Decide which scene to show replay sources on and start playback
        try {
            const sceneName = await getActiveSceneName();
            await showSource(sceneName, videoSource);
            const { indicatorSource } = getReplaySettings();
            if (indicatorSource) {
                await showSource(sceneName, indicatorSource);
            }
            await obs.call('TriggerMediaInputAction', {
                inputName: videoSource,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
            });
            console.log('Replay loaded and playing:', savedPath);
        } catch (playbackError) {
            console.error('Failed to start instant replay playback:', playbackError);
            const message = playbackError?.message || playbackError?.toString() || '';
            if (message.includes('Unable to determine active OBS scene')) {
                alert('Replay monitoring could not determine the active OBS scene. Please ensure OBS is connected and a program scene is active.');
            } else {
                alert(`Failed to play instant replay: ${message}`);
            }
        }

        // Update instant replay button
		setReplayButtonText();

        console.log('Replay ready and playback requested for:', savedPath);

        // Save new replay path to history
        replayHistory.push(savedPath);

        // Keep only the last 5 entries
        if (replayHistory.length > 5) {
            replayHistory.shift(); // removes the oldest (first) entry
        }

        // Save replayHistory to localStorage
        localStorage.setItem('replayHistory', JSON.stringify(replayHistory));
        console.log('Updated Replay History:', replayHistory);

    } catch (error) {
        console.error('Replay Clip failed:', error);
    }
    updateReplayButtonsVisibility();
    toggleReplayClipsVisibility();
}

async function playPreviousReplay(index) {
    // Always rehydrate the array from localStorage
    const replayHistory = JSON.parse(localStorage.getItem('replayHistory')) || [];

    if (index < 0 || index >= replayHistory.length) {
        console.warn('Invalid replay index');
        return;
    }

    const filePath = replayHistory[index];
    if (!filePath) {
        console.warn('No replay file found at this index.');
        return;
    }

    try {
        const { outputActive } = await obs.call('GetReplayBufferStatus');
        if (outputActive) {
            try {
                await obs.call('StopReplayBuffer');
                await new Promise(r => setTimeout(r, 150)); // small delay
            } catch (err) {
                console.error('Failed to stop replay buffer:', err);
            }
        }
        // Always update state and button text when playing a replay, regardless of buffer state
        isMonitoringActive = false;
        setStorageItem('isMonitoringActive', 'false');
        setMonitorButtonText();
    } catch (err) {
        console.error('Failed to stop replay buffer:', err);
        // Still update state even if check failed
        isMonitoringActive = false;
        setStorageItem('isMonitoringActive', 'false');
        setMonitorButtonText();
    }

	const { videoSource, indicatorSource } = getReplaySettings();
	let sceneName;
	try {
		sceneName = await getActiveSceneName();
	} catch (err) {
		console.error('Unable to determine active scene for replay playback:', err);
		alert('Unable to determine the active OBS scene. Please ensure OBS is connected and streaming.');
		return;
	}
	await showSource(sceneName, videoSource);
	if (indicatorSource) await showSource(sceneName, indicatorSource);

    try {
        const { inputSettings } = await obs.call('GetInputSettings', {
            inputName: videoSource
        });

        await obs.call('SetInputSettings', {
            inputName: videoSource,
            inputSettings: { ...inputSettings, local_file: filePath },
            overlay: false
        });

        await obs.call('TriggerMediaInputAction', {
            inputName: videoSource,
            mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
        });

        console.log('Replaying historic clip:', filePath);
    } catch (err) {
		console.error('Failed to play previous replay:', err);
		const message = err?.message || err?.toString() || '';
		if (message.includes('Unable to determine active OBS scene')) {
			alert('Unable to determine the active OBS scene when playing a replay. Please ensure OBS is connected and a program scene is active.');
		}
    }
    setReplayButtonText();
}



function deleteClip(index, event) {
    // Prevent the event from bubbling up to the play button
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    // Get current replay history from localStorage (or use global if it exists)
    replayHistory = JSON.parse(localStorage.getItem('replayHistory')) || [];

    // Validate index
    if (index < 0 || index >= replayHistory.length) {
        console.warn('Invalid clip index for deletion');
        return;
    }

    // Show confirmation dialog
    const clipNumber = index + 1;
    const confirmed = confirm(`Are you sure you want to delete Clip ${clipNumber}?`);
    
    if (!confirmed) {
        return;
    }

    // Remove the clip from the array
    replayHistory.splice(index, 1);

    // Save updated history to localStorage
    localStorage.setItem('replayHistory', JSON.stringify(replayHistory));

    console.log('Clip deleted. Updated Replay History:', replayHistory);

    // Update button visibility and labels
    updateReplayButtonsVisibility();
    toggleReplayClipsVisibility();
}

function updateReplayButtonsVisibility() {
    const replayHistory = JSON.parse(localStorage.getItem('replayHistory')) || [];

    if (getStorageItem("isConnected") === "false") {
        document.getElementById("replayClips").classList.add("noShow");
        document.getElementById("savedPathNote").classList.add("noShow");
    } else {
        document.getElementById("replayClips").classList.remove("noShow");
        document.getElementById("savedPathNote").classList.remove("noShow");

    }

    if (!replayHistory || replayHistory.length === 0) {
        // replayHistory is null, undefined, or empty
        document.getElementById("replayClips").classList.add("noShow");
        document.getElementById("savedPathNote").classList.add("noShow");
    }

    for (let i = 0; i < 5; i++) {
        const buttonId = `prvReplayClip${i + 1}`;
        const button = document.getElementById(buttonId);
        const wrapperId = `clipWrapper${i + 1}`;
        const wrapper = document.getElementById(wrapperId);
        const clipLabel = button ? button.querySelector('.clip-label') : null;
        const deleteBtn = wrapper ? wrapper.querySelector('.clip-delete-btn') : null;
        
        if (!button || !wrapper) continue;

        // Show button only if replayHistory has a clip at index i
        if (replayHistory[i]) {
            button.style.display = 'inline-block';
            wrapper.style.display = 'inline-block';
            button.disabled = false;
            
            // Update button label
            if (clipLabel) {
                clipLabel.textContent = `Clip ${i + 1}`;
            } else {
                button.innerHTML = `<span class="clip-label">Clip ${i + 1}</span>`;
            }
            
            // Update onclick to use correct index
            button.setAttribute('onclick', `playPreviousReplay(${i})`);
            
            // Update delete button onclick
            if (deleteBtn) {
                deleteBtn.setAttribute('onclick', `deleteClip(${i}, event)`);
            }
        } else {
            button.style.display = 'none';
            wrapper.style.display = 'none';
            button.disabled = true;
        }
    }
}


// Monitor toggle
async function toggleReplayMonitoring() {
    //Reconnect to OBS if not connected
    if(!isConnected){
        const reconnected = await obsReConnect();
        if (!reconnected) {
			alert('Replay monitoring requires an active OBS WebSocket connection. Please configure a websocket connection in OBS under Tools, as well as connection settings on the Replay/Share tab before toggling monitoring.');
            return;
        }
        toggleReplayClipsVisibility();
        updateReplayButtonsVisibility();
    }
    const { videoSource } = getReplaySettings();

	if (!videoSource) {
		alert('Replay monitoring requires a configured OBS media source. Please set the Replay Video Source on the Replay/Share tab before toggling monitoring.');
        return;
    }
    try {
        const { mediaState } = await obs.call('GetMediaInputStatus', { inputName: videoSource });
        // Stop playback if the media source is already running
        if (mediaState === 'playing') {
            await obs.call('TriggerMediaInputAction', { inputName: videoSource, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP' });
            await new Promise(r => setTimeout(r, 150));
        }
    } catch (error) {
        console.error('Failed to get media input status:', error);
        alert(`Error: Media source "${videoSource}" not found or inaccessible. Please check your source name.`);
        return;  // Stop execution since the source is not valid
    }
        
    if (!isObsReady) {
        alert('Failed to initiate monitoring: OBS connection is not ready, most likely the websocket connection has not been setup.');
        return;
    }

    try {
        if (getStorageItem("isMonitoringActive") === "false" || getStorageItem("isMonitoringActive") === null) {
            console.log('Monitoring is not active, starting replay buffer...');
            
            // Check actual OBS state first
            let outputActive = false;
            try {
                const statusResult = await obs.call('GetReplayBufferStatus');
                outputActive = statusResult.outputActive;
            } catch (statusError) {
                console.warn('Could not check replay buffer status:', statusError);
            }
            
            if (outputActive) {
                console.log('Replay buffer is already running, syncing state...');
                isMonitoringActive = true;
                setStorageItem('isMonitoringActive', 'true');
                btnReplayClip.classList.remove('noShow');
                setReplayButtonText();
                setMonitorButtonText();
                return;
            }
            
            // Try to start the replay buffer
            try {
                await obs.call('StartReplayBuffer');
                isMonitoringActive = true;
                setStorageItem('isMonitoringActive', 'true');
                btnReplayClip.classList.remove('noShow');
                setReplayButtonText();
                setMonitorButtonText();
                console.log('Replay buffer started successfully');
            } catch (startError) {
                // Handle the "k" error - likely means already running
                const errorMessage = startError?.message || startError?.code || startError?.toString() || 'Unknown error';
                console.error('StartReplayBuffer failed:', errorMessage, startError);
                
                // If it's the "k" error or "already" error, verify actual state
                if (errorMessage === 'k' || errorMessage.includes('already')) {
                    try {
                        const { outputActive: verifyActive } = await obs.call('GetReplayBufferStatus');
                        if (verifyActive) {
                            console.log('Replay buffer was already running despite error, syncing state');
                            isMonitoringActive = true;
                            setStorageItem('isMonitoringActive', 'true');
                            btnReplayClip.classList.remove('noShow');
                            setReplayButtonText();
                            setMonitorButtonText();
                            return; // Success - buffer is running
                        }
                    } catch (verifyError) {
                        console.error('Could not verify replay buffer status:', verifyError);
                    }
                }
                
                // If we get here, it's a real error
                alert(`Failed to start replay buffer.\n\nError: ${errorMessage}\n\nPossible causes:\n- Replay Buffer not enabled in OBS Settings > Output\n- Replay Buffer encoder not configured\n- Insufficient disk space\n- Output encoder is busy`);
                setMonitorButtonText();
                return;
            }
        } else {
            // Check actual OBS state before assuming it's active
            let outputActive = false;
            try {
                const statusResult = await obs.call('GetReplayBufferStatus');
                outputActive = statusResult.outputActive;
            } catch (statusError) {
                console.warn('Could not check replay buffer status:', statusError);
            }
            
            if (outputActive) {
                console.log('Monitoring is active, stopping replay buffer...');
                try {
                    await obs.call('StopReplayBuffer');
                    isMonitoringActive = false;
                    setStorageItem('isMonitoringActive', 'false');
                    await new Promise(r => setTimeout(r, 150)); // small delay
                    console.log('Replay buffer stopped successfully');
                } catch (err) {
                    console.error('Failed to stop replay buffer:', err);
                    const errorMessage = err?.message || err?.code || err?.toString() || 'Unknown error';
                    alert(`Failed to stop replay buffer: ${errorMessage}`);
                }
            } else {
                console.log('Stored state says monitoring is active, but replay buffer is not running. Syncing state...');
            }
            
            // Always update local state regardless of OBS state
            isMonitoringActive = false;
            setStorageItem('isMonitoringActive', 'false');
            btnReplayClip.classList.add('noShow');
            setMonitorButtonText();
        }
    } catch (error) {
        const errorMessage = error?.message || error?.code || error?.toString() || 'Unknown error';
        console.error('Replay buffer toggle failed:', errorMessage, error);
        alert(`Replay buffer operation failed: ${errorMessage}`);
        setMonitorButtonText();
    }
}