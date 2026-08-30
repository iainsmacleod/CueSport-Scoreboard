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

    const hasVisibleClip = Array.from(buttons).some(btn => btn.style.display !== "none");
    const connected = getStorageItem("isConnected") !== "false";

    replayClips.classList.toggle("noShow", !connected || !hasVisibleClip);
}

function getBallTrackerPanel() {
    return document.getElementById("ballTrackerDiv");
}

function isBallTrackerControlsVisible() {
    if (!isScoreDisplayEnabled()) {
        return false;
    }
    const checkbox = document.getElementById("ballTrackerCheckbox");
    return !!(checkbox && checkbox.checked);
}

function syncPlayerTrackingSectionHeader() {
    const block = document.getElementById("playerTrackingBlock");
    if (block) {
        block.classList.toggle("noShow", !isBallTrackerControlsVisible());
    }
}

function syncControlsTabLayout() {
    syncBallSetSettingsVisibility();

    const showTracker = isBallTrackerControlsVisible();
    const panel = getBallTrackerPanel();
    if (panel) {
        panel.classList.toggle("noShow", !showTracker);
    }
    syncPlayerTrackingSectionHeader();

    if (showTracker) {
        syncRackBreakerPlayerToggleVisibility();
    } else {
        const playerToggle = document.getElementById("playerToggle");
        if (playerToggle) {
            playerToggle.classList.add("noShow");
        }
    }

    syncBallSetControlsVisibility();
    if (typeof updateScoringUndoButton === "function") {
        updateScoringUndoButton();
    }
}

function updatePlayerBallControlVisibility() {
    syncControlsTabLayout();
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

const TAB_BUTTON_BY_CONTENT = {
    GameInfo: "gameInfoTab",
    Controls: "controlsTab",
    Images: "imagesTab",
    ReplaySettings: "replaySettingsTab",
    StatsSettings: "statsTab",
    GeneralSettings: "generalSettingsTab"
};

function getTabButtonId(tabContentId) {
    if (TAB_BUTTON_BY_CONTENT[tabContentId]) {
        return TAB_BUTTON_BY_CONTENT[tabContentId];
    }
    return tabContentId.charAt(0).toLowerCase() + tabContentId.slice(1) + "Tab";
}

document.addEventListener("DOMContentLoaded", function () {
    // Try to get the last selected tab from localStorage
    const lastSelectedTab = getStorageItem("lastSelectedTab");

    if (lastSelectedTab && document.getElementById(lastSelectedTab)) {
        const tabButton = document.getElementById(getTabButtonId(lastSelectedTab));

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

/** 8 / 9 / 10-Ball — potting the game ball awards a rack. */
function isTrackerRackWinGame() {
    const type = getActiveGameType();
    return type === "game1" || type === "game2" || type === "game3";
}

/** All game types with both players — prompt for breaker at rack/frame start (when Ball Scoring is on). */
function isRackBreakerPromptEnabled() {
    const bothPlayers =
        getStorageItem("usePlayer1") === "yes" &&
        getStorageItem("usePlayer2") === "yes";
    if (!bothPlayers) {
        return false;
    }
    const type = getActiveGameType();
    return type === "game1" || type === "game2" || type === "game3" ||
        type === "game4" || type === "game5" || type === "game6" ||
        type === "game7" || type === "game8";
}

/** Ball Scoring on for 8/9/10 — lock the ball grid until a breaker is chosen. */
function isRackBreakerBallGridLockEnabled() {
    return getStorageItem("enableBallTracker") === "yes" && isRackBreakerPromptEnabled();
}

function getRackBreakerSlot() {
    const slot = getStorageItem("rackBreakerSlot");
    return slot === "1" || slot === "2" ? slot : null;
}

function isRackOpponentVisited() {
    return getStorageItem("rackOpponentVisited") === "yes";
}

function setRackOpponentVisited(yes) {
    setStorageItem("rackOpponentVisited", yes ? "yes" : "no");
}

function clearRackBreakerState(clearLastKnown) {
    setStorageItem("rackBreakerSlot", "");
    setRackOpponentVisited(false);
    if (clearLastKnown) {
        setStorageItem("lastRackBreakerSlot", "");
    }
}

/** True when a rack/frame is visibly in progress (not a fresh rack awaiting breaker). */
function hasMidRackActivity() {
    const ballState = JSON.parse(getStorageItem("ballState") || "{}");
    if (Object.keys(ballState).some(function (id) { return ballState[id]; })) {
        return true;
    }
    try {
        const owners = JSON.parse(getStorageItem("pocketBallOwners") || "{}");
        if (owners && Object.keys(owners).length > 0) {
            return true;
        }
    } catch (e) {
        /* ignore */
    }
    if (isPocketScoreGame() || (getActiveGameType() === "game7" && isDualScoreMode())) {
        const p1b = parseInt(getStorageItem("p1BallsCtrlPanel"), 10) || 0;
        const p2b = parseInt(getStorageItem("p2BallsCtrlPanel"), 10) || 0;
        if (p1b > 0 || p2b > 0) {
            return true;
        }
    }
    if (isSnookerBallMode()) {
        if ((parseInt(getStorageItem("snookerRedsPotted") || "0", 10) > 0)) {
            return true;
        }
        if ((parseInt(getStorageItem("snookerCurrentBreak") || "0", 10) > 0)) {
            return true;
        }
        const p1 = parseInt(getStorageItem("p1BallsCtrlPanel"), 10) || 0;
        const p2 = parseInt(getStorageItem("p2BallsCtrlPanel"), 10) || 0;
        if (p1 > 0 || p2 > 0) {
            return true;
        }
    }
    return false;
}

/** After refresh, restore breaker/active-player when a rack was already underway. */
function resumeRackBreakerAfterPageLoad() {
    if (!isRackBreakerPromptEnabled()) {
        return;
    }
    if (getRackBreakerSlot()) {
        return;
    }
    if (!hasMidRackActivity()) {
        return;
    }
    const last = getStorageItem("lastRackBreakerSlot");
    const slot = (last === "1" || last === "2") ? last : getActivePlayerSlot();
    setStorageItem("rackBreakerSlot", slot);
}

function updateRackBreakerPickerLabels() {
    const p1Name = (document.getElementById("p1Name")?.value || "").trim() || "Player 1";
    const p2Name = (document.getElementById("p2Name")?.value || "").trim() || "Player 2";
    const btn1 = document.getElementById("rackBreakerP1Btn");
    const btn2 = document.getElementById("rackBreakerP2Btn");
    if (btn1) {
        btn1.textContent = p1Name;
    }
    if (btn2) {
        btn2.textContent = p2Name;
    }
}

function updateRackBreakerBallLock() {
    const tracker = getBallTrackerPanel();
    if (!tracker) {
        return;
    }
    const awaiting = isRackBreakerBallGridLockEnabled() &&
        !getRackBreakerSlot() &&
        !isGameScoringLocked();
    tracker.classList.toggle("ball-tracker-awaiting-breaker", awaiting);
}

function isPlayerSlotPickerBreakerMode() {
    if (!isRackBreakerPromptEnabled()) {
        return false;
    }
    return !getRackBreakerSlot();
}

function onPlayerSlotButton(slot) {
    if (slot !== "1" && slot !== "2") {
        return;
    }
    if (isPlayerSlotPickerBreakerMode()) {
        if (isGameScoringLocked()) {
            openResetScoresModal("endMatch");
            return;
        }
        selectRackBreaker(slot);
        return;
    }
    if (slot === getActivePlayerSlot() || isGameScoringLocked()) {
        return;
    }
    const checkbox = document.getElementById("playerToggleCheckbox");
    if (checkbox) {
        checkbox.checked = slot === "1";
    }
    togglePlayer(slot === "1");
    syncPlayerSlotPickerUI();
}

function syncPlayerSlotPickerUI() {
    const question = document.getElementById("playerSlotQuestion");
    const btn1 = document.getElementById("rackBreakerP1Btn");
    const btn2 = document.getElementById("rackBreakerP2Btn");
    if (!question || !btn1 || !btn2) {
        return;
    }
    updateRackBreakerPickerLabels();
    const breakerMode = isPlayerSlotPickerBreakerMode();
    const locked = isGameScoringLocked();
    const activeSlot = getActivePlayerSlot();
    if (breakerMode && locked) {
        question.textContent = "End Match to continue";
    } else {
        question.textContent = breakerMode ? "Breaking Player?" : "Active Player";
    }

    function setBreakerBtnState(btn, matchLocked) {
        btn.disabled = false;
        btn.classList.remove("rack-breaker-disabled");
        btn.classList.toggle("rack-breaker-match-locked", matchLocked);
        btn.classList.remove("rack-breaker-inactive");
        if (matchLocked) {
            btn.setAttribute("aria-disabled", "false");
        } else {
            btn.removeAttribute("aria-disabled");
        }
    }

    function setActivePlayerBtnState(btn, isActiveSlot) {
        btn.disabled = false;
        btn.classList.remove("rack-breaker-disabled");
        btn.classList.toggle("rack-breaker-inactive", !isActiveSlot);
        if (isActiveSlot) {
            btn.removeAttribute("aria-disabled");
        } else {
            btn.setAttribute("aria-disabled", "false");
        }
    }

    if (breakerMode) {
        setBreakerBtnState(btn1, locked);
        setBreakerBtnState(btn2, locked);
    } else {
        setActivePlayerBtnState(btn1, activeSlot === "1");
        setActivePlayerBtnState(btn2, activeSlot === "2");
    }
}

function syncRackBreakerPlayerToggleVisibility() {
    const playerToggle = document.getElementById("playerToggle");
    const useToggleSetting = document.getElementById("useToggleSetting");
    if (!playerToggle || !useToggleSetting) {
        return;
    }
    if (!isBallTrackerControlsVisible()) {
        playerToggle.classList.add("noShow");
        return;
    }
    const showPicker = useToggleSetting.checked ||
        isRackBreakerPromptEnabled();
    playerToggle.classList.toggle("noShow", !showPicker);
}

function updateRackBreakerButtonState() {
    syncPlayerSlotPickerUI();
}

/** Match is complete — show breaker prompt with buttons disabled until End Match. */
function showRackBreakerPickerForMatchLocked() {
    if (!isRackBreakerPromptEnabled()) {
        return;
    }
    clearRackBreakerState();
    updateRackBreakerBallLock();
    syncPlayerSlotPickerUI();
    syncRackBreakerPlayerToggleVisibility();
    updatePlayerBallControlVisibility();
}

function showRackBreakerPicker() {
    if (!isRackBreakerPromptEnabled()) {
        hideRackBreakerPicker();
        return;
    }
    if (isGameScoringLocked()) {
        showRackBreakerPickerForMatchLocked();
        return;
    }
    clearRackBreakerState();
    updateRackBreakerBallLock();
    syncPlayerSlotPickerUI();
    syncRackBreakerPlayerToggleVisibility();
    updatePlayerBallControlVisibility();
}

function hideRackBreakerPicker() {
    updateRackBreakerBallLock();
    syncPlayerSlotPickerUI();
    syncRackBreakerPlayerToggleVisibility();
    updatePlayerBallControlVisibility();
}

function syncRackBreakerPickerVisibility() {
    resumeRackBreakerAfterPageLoad();
    if (!isRackBreakerPromptEnabled()) {
        hideRackBreakerPicker();
        updateRackBreakerBallLock();
        updateRackBreakerButtonState();
        syncRackBreakerPlayerToggleVisibility();
        updatePlayerBallControlVisibility();
        return;
    }
    if (isGameScoringLocked()) {
        showRackBreakerPickerForMatchLocked();
        return;
    }
    if (getRackBreakerSlot()) {
        hideRackBreakerPicker();
        syncRackBreakerPlayerToggleVisibility();
        updatePlayerBallControlVisibility();
        return;
    }
    showRackBreakerPicker();
    syncRackBreakerPlayerToggleVisibility();
    updatePlayerBallControlVisibility();
}

function captureBreakerPickUndoBefore() {
    return {
        rackBreakerSlot: getStorageItem("rackBreakerSlot") || "",
        rackOpponentVisited: getStorageItem("rackOpponentVisited") || "no",
        activePlayer: getActivePlayerSlot(),
        lastRackBreakerSlot: getStorageItem("lastRackBreakerSlot") || ""
    };
}

function selectRackBreaker(slot) {
    if (slot !== "1" && slot !== "2") {
        return;
    }
    if (!isRackBreakerPromptEnabled() || isGameScoringLocked()) {
        return;
    }
    const breakerPickUndo = isPlayerSlotPickerBreakerMode();
    const beforeBreakerPick = breakerPickUndo ? captureBreakerPickUndoBefore() : null;
    setStorageItem("rackBreakerSlot", slot);
    setStorageItem("lastRackBreakerSlot", slot);
    setRackOpponentVisited(false);
    const checkbox = document.getElementById("playerToggleCheckbox");
    if (checkbox) {
        checkbox.checked = slot === "1";
    }
    togglePlayer(slot === "1");
    if (breakerPickUndo && beforeBreakerPick) {
        pushScoringUndo({ type: "breakerPick", slot: slot, before: beforeBreakerPick });
    }
    hideRackBreakerPicker();
    syncRackBreakerPlayerToggleVisibility();
    updatePlayerBallControlVisibility();
}

function noteRackOpponentVisitForSlot(activeSlot) {
    if (!isRackBreakerPromptEnabled()) {
        return;
    }
    const breaker = getRackBreakerSlot();
    if (!breaker || (activeSlot !== "1" && activeSlot !== "2")) {
        return;
    }
    if (activeSlot !== breaker) {
        setRackOpponentVisited(true);
    }
}

/** Classify rack outcome for stats (8/9/10-ball ball tracker). */
function getRackRunClassification(winnerSlot) {
    const breaker = getRackBreakerSlot();
    if (!breaker || (winnerSlot !== "1" && winnerSlot !== "2")) {
        return { breakAndRun: false, tableRun: false, breakerSlot: null };
    }
    const opponentVisited = isRackOpponentVisited();
    if (winnerSlot === breaker && !opponentVisited) {
        return { breakAndRun: true, tableRun: false, breakerSlot: breaker };
    }
    if (opponentVisited) {
        return { breakAndRun: false, tableRun: true, breakerSlot: breaker };
    }
    return { breakAndRun: false, tableRun: false, breakerSlot: breaker };
}

function maybeShowRackBreakerPickerAfterRackChange() {
    if (!isRackBreakerPromptEnabled()) {
        return;
    }
    if (isGameScoringLocked()) {
        showRackBreakerPickerForMatchLocked();
        return;
    }
    showRackBreakerPicker();
}

/** Game ball id that wins the rack for 8 / 9 / 10-Ball, else null. */
function getGameWinningBallId() {
    const type = getStorageItem("gameType");
    if (type === "game1") {
        return "ball 8";
    }
    if (type === "game2") {
        return "ball 9";
    }
    if (type === "game3") {
        return "ball 10";
    }
    return null;
}

/** Games where Ball Tracker auto-updates score (and aids should turn on). */
function isBallTrackerAutoScoreGame() {
    const type = getStorageItem("gameType");
    return type === "game1" || type === "game2" || type === "game3" ||
        type === "game4" || type === "game5" || type === "game6";
}

const POCKET_RACK_BALL_TARGET = 8;

function isSnookerBallMode() {
    return isSnooker() || getActiveBallSelection() === "snooker";
}

function getActiveGameType() {
    const select = document.getElementById(GAME_TYPE_SELECT_ID);
    if (select && select.value) {
        return select.value;
    }
    return getStoredGameType();
}

function getActiveBallSelection() {
    const select = document.getElementById("ballSelection");
    if (select && select.value) {
        return select.value;
    }
    return getStorageItem("ballSelection") || "american";
}

function repairGameTypeSelectOptions() {
    const select = document.getElementById(GAME_TYPE_SELECT_ID);
    if (!select) {
        return;
    }
    for (let i = 0; i < select.options.length && i < VALID_GAME_TYPES.length; i++) {
        if (select.options[i].value !== VALID_GAME_TYPES[i]) {
            select.options[i].value = VALID_GAME_TYPES[i];
        }
    }
}

function syncGameTypeSelect(value) {
    const select = document.getElementById(GAME_TYPE_SELECT_ID);
    const resolved = normalizeGameType(value || getStoredGameType());
    if (!select) {
        return;
    }
    repairGameTypeSelectOptions();
    select.value = resolved;
    if (!select.value) {
        const option = select.querySelector('option[value="' + resolved + '"]');
        if (option) {
            option.selected = true;
        }
    }
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
    10: { file: "snooker-freeball-small.png", title: "Free Ball", points: null },
    11: { file: "foul-small.png", title: "Foul Ball", foul: true }
};

const SNOOKER_FOUL_POINTS = {
    white: 4,
    yellow: 4,
    green: 4,
    brown: 4,
    gold: 20,
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

/** Foul just recorded — Free Ball waits until Active Player is changed. */
function getSnookerFoulAwaitingPlayerChange() {
    return getStorageItem("snookerFoulAwaitingPlayerChange") === "yes";
}

function setSnookerFoulAwaitingPlayerChange(yes) {
    setStorageItem("snookerFoulAwaitingPlayerChange", yes ? "yes" : "no");
}

/** Incoming player may take Free Ball (foul already happened + player changed). */
function isSnookerFreeBallOffered() {
    return getStorageItem("snookerFreeBallOffered") === "yes";
}

function setSnookerFreeBallOffered(yes) {
    setStorageItem("snookerFreeBallOffered", yes ? "yes" : "no");
}

function clearSnookerFreeBallOfferState() {
    setSnookerFoulAwaitingPlayerChange(false);
    setSnookerFreeBallOffered(false);
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
    const keepUndoStack = options && options.keepUndoStack;
    if (!keepReds) {
        setSnookerRedsPotted(0);
        setSnookerClearedColors([]);
        setSnookerGoldenBallFouled(false);
    }
    setSnookerPhase("red");
    setSnookerAfterFreeball(false);
    if (!(options && options.preserveFreeBallOfferState)) {
        clearSnookerFreeBallOfferState();
    }
    clearSnookerColorFeedback();
    if (!keepBreaks) {
        resetSnookerBreakTracking(options && options.keepFrameHighs);
    }
    // Player changes keep undo history; new frame / leave snooker clears it.
    if (!keepUndoStack) {
        clearSnookerUndoStack();
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

const SNOOKER_UNDO_STACK_MAX = 40;
const SNOOKER_UNDO_STACK_KEY = "snookerUndoStack";
let snookerUndoStack = [];

function loadSnookerUndoStackFromStorage() {
    try {
        const raw = getStorageItem(SNOOKER_UNDO_STACK_KEY);
        if (!raw) {
            snookerUndoStack = [];
            return;
        }
        const parsed = JSON.parse(raw);
        snookerUndoStack = Array.isArray(parsed) ? parsed.slice(-SNOOKER_UNDO_STACK_MAX) : [];
    } catch (e) {
        snookerUndoStack = [];
    }
}

function persistSnookerUndoStack() {
    try {
        setStorageItem(SNOOKER_UNDO_STACK_KEY, JSON.stringify(snookerUndoStack || []));
    } catch (e) {
        console.error("Failed to persist snooker undo stack:", e);
    }
}

function captureSnookerUndoSnapshot() {
    return {
        p1Points: parseInt(getStorageItem("p1BallsCtrlPanel"), 10) || 0,
        p2Points: parseInt(getStorageItem("p2BallsCtrlPanel"), 10) || 0,
        phase: getSnookerPhase(),
        afterFreeball: getSnookerAfterFreeball(),
        foulAwaitingPlayerChange: getSnookerFoulAwaitingPlayerChange(),
        freeBallOffered: isSnookerFreeBallOffered(),
        redsPotted: getSnookerRedsPotted(),
        clearedColors: getSnookerClearedColors().slice(),
        goldenBallFouled: isSnookerGoldenBallFouled(),
        currentBreak: getSnookerCurrentBreak(),
        frameHighP1: getSnookerFrameHighBreak("1"),
        frameHighP2: getSnookerFrameHighBreak("2"),
        activePlayer: getSnookerActivePlayer(),
        recordedBallPlayer: null
    };
}

function commitSnookerUndoSnapshot(snapshot, recordedBallPlayer) {
    if (!snapshot) {
        return;
    }
    snapshot.recordedBallPlayer = recordedBallPlayer === "1" || recordedBallPlayer === "2"
        ? recordedBallPlayer
        : null;
    snookerUndoStack.push(snapshot);
    if (snookerUndoStack.length > SNOOKER_UNDO_STACK_MAX) {
        snookerUndoStack.shift();
    }
    persistSnookerUndoStack();
    updateSnookerUndoButton();
}

function clearSnookerUndoStack() {
    snookerUndoStack = [];
    persistSnookerUndoStack();
    updateScoringUndoButton();
}

const SCORING_UNDO_STACK_MAX = 40;
const SCORING_UNDO_STACK_KEY = "scoringUndoStack";
let scoringUndoStack = [];

function loadScoringUndoStackFromStorage() {
    try {
        const raw = getStorageItem(SCORING_UNDO_STACK_KEY);
        if (!raw) {
            scoringUndoStack = [];
            return;
        }
        const parsed = JSON.parse(raw);
        scoringUndoStack = Array.isArray(parsed) ? parsed.slice(-SCORING_UNDO_STACK_MAX) : [];
    } catch (e) {
        scoringUndoStack = [];
    }
}

function persistScoringUndoStack() {
    try {
        setStorageItem(SCORING_UNDO_STACK_KEY, JSON.stringify(scoringUndoStack || []));
    } catch (e) {
        console.error("Failed to persist scoring undo stack:", e);
    }
}

function clearScoringUndoStack() {
    scoringUndoStack = [];
    persistScoringUndoStack();
    updateScoringUndoButton();
}

/** Clear pool/8-9-10 and snooker scoring undo history (e.g. score reset, clear game). */
function clearAllScoringUndoHistory() {
    clearScoringUndoStack();
    clearSnookerUndoStack();
    updateScoringUndoButton();
}

function captureScoringUndoSnapshot(options) {
    const ballState = JSON.parse(getStorageItem("ballState") || "{}");
    const snapshotBallState = Object.assign({}, ballState);
    if (options && options.unfadeBallId) {
        snapshotBallState[options.unfadeBallId] = false;
    }
    return {
        ballState: snapshotBallState,
        pocketOwners: getPocketBallOwners(),
        playerBallSet: getStorageItem("playerBallSet") || "p1Open",
        rackBreakerSlot: getStorageItem("rackBreakerSlot") || "",
        rackOpponentVisited: getStorageItem("rackOpponentVisited") || "no",
        activePlayer: getActivePlayerSlot(),
        p1Score: parseInt(getStorageItem("p1ScoreCtrlPanel"), 10) || 0,
        p2Score: parseInt(getStorageItem("p2ScoreCtrlPanel"), 10) || 0,
        p1Balls: parseInt(getStorageItem("p1BallsCtrlPanel"), 10) || 0,
        p2Balls: parseInt(getStorageItem("p2BallsCtrlPanel"), 10) || 0
    };
}

function pushScoringUndo(entry) {
    if (!entry || !entry.type) {
        return;
    }
    scoringUndoStack.push(entry);
    if (scoringUndoStack.length > SCORING_UNDO_STACK_MAX) {
        scoringUndoStack.shift();
    }
    persistScoringUndoStack();
    updateScoringUndoButton();
}

function discardLastScoringUndoIf(predicate) {
    if (!scoringUndoStack.length) {
        return null;
    }
    const last = scoringUndoStack[scoringUndoStack.length - 1];
    if (!predicate(last)) {
        return null;
    }
    scoringUndoStack.pop();
    persistScoringUndoStack();
    updateScoringUndoButton();
    return last;
}

function setPrimaryScoreAbsolute(player, value) {
    if (player !== "1" && player !== "2") {
        return;
    }
    const next = Math.min(999, Math.max(0, parseInt(value, 10) || 0));
    setStorageItem("p" + player + "ScoreCtrlPanel", next);
    setStorageItem("p" + player + "Score", next);
    const input = document.getElementById("p" + player + "Score");
    if (input) {
        input.value = next;
    }
    if (typeof bc !== "undefined") {
        bc.postMessage({ player: player, score: next });
    }
}

function setBallsScoreAbsolute(player, value) {
    if (player !== "1" && player !== "2") {
        return;
    }
    const next = Math.min(999, Math.max(-999, parseInt(value, 10) || 0));
    setStorageItem("p" + player + "BallsCtrlPanel", next);
    setStorageItem("p" + player + "Balls", next);
    const input = document.getElementById("p" + player + "Balls");
    if (input) {
        input.value = next;
    }
    if (typeof bc !== "undefined") {
        bc.postMessage({ player: player, balls: next });
    }
}

function restoreTrackerFromScoringSnapshot(before) {
    if (!before) {
        return;
    }
    clearTrackerRackWinCooldownTimer();
    clearEarlyGameBallRejectCooldown();
    clearTrackerRackWinPending();

    const ballState = before.ballState && typeof before.ballState === "object" ? before.ballState : {};
    setStorageItem("ballState", JSON.stringify(ballState));
    document.querySelectorAll("#ballTrackerDiv .ball").forEach(function (ball) {
        if (ball.id === "snookerUndoBtn") {
            return;
        }
        const faded = !!ballState[ball.id];
        ball.classList.toggle("faded", faded);
        ball.classList.remove("ball-win-cooldown");
        ball.removeAttribute("aria-disabled");
        if (typeof bc !== "undefined") {
            if (faded) {
                bc.postMessage({ toggle: ball.id });
            } else {
                bc.postMessage({ resetBall: ball.id });
            }
        }
    });

    setPocketBallOwners(before.pocketOwners || {});
    const ballSet = before.playerBallSet || "p1Open";
    setStorageItem("playerBallSet", ballSet);
    const radio = document.querySelector('input[name="p1BallSetSelect"][value="' + ballSet + '"]');
    if (radio) {
        radio.checked = true;
    }
    if (typeof bc !== "undefined") {
        bc.postMessage({ playerBallSet: ballSet });
    }

    setStorageItem("rackBreakerSlot", before.rackBreakerSlot || "");
    setStorageItem("rackOpponentVisited", before.rackOpponentVisited === "yes" ? "yes" : "no");
    if (before.activePlayer === "1" || before.activePlayer === "2") {
        setSnookerActivePlayerFromUndo(before.activePlayer);
    }
    syncRackBreakerPickerVisibility();
    syncPlayerSlotPickerUI();
    updateRackBreakerBallLock();
}

function updateScoringUndoButton() {
    const btn = document.getElementById("snookerUndoBtn");
    if (!btn) {
        return;
    }
    const show = isBallTrackerControlsVisible();
    const hasSnookerUndo = isSnookerBallMode() && snookerUndoStack.length > 0;
    const hasPoolUndo = scoringUndoStack.length > 0;
    // Allow undo even when the race is locked so a match-winning game-ball pot can be reversed.
    const canUndo = show && (hasSnookerUndo || hasPoolUndo);
    btn.classList.toggle("noShow", !show);
    btn.classList.toggle("snooker-ball-disabled", !canUndo);
    if (canUndo) {
        btn.removeAttribute("aria-disabled");
        btn.title = isSnookerBallMode() && hasSnookerUndo
            ? "Undo last pot or foul"
            : "Undo last scoring action (pots, fouls, breaker)";
    } else {
        btn.setAttribute("aria-disabled", "true");
        btn.title = "Undo last scoring action";
    }
}

/** @deprecated Use updateScoringUndoButton */
function updateSnookerUndoButton() {
    updateScoringUndoButton();
}

function setSnookerActivePlayerFromUndo(player) {
    const slot = player === "2" ? "2" : "1";
    setStorageItem("activePlayer", slot);
    setStorageItem("toggleState", slot === "1");
    const checkbox = document.getElementById("playerToggleCheckbox");
    if (checkbox) {
        checkbox.checked = slot === "1";
    }
    updateActivePlayerNameDisplay();
    const useToggleCheckbox = document.getElementById("useToggleSetting");
    if (useToggleCheckbox && useToggleCheckbox.checked && typeof bc !== "undefined") {
        bc.postMessage({ clockDisplay: "toggleActivePlayer", player: slot === "1" });
    }
}

function setSnookerPointsAbsolute(player, value) {
    if (player !== "1" && player !== "2") {
        return;
    }
    const next = Math.min(999, Math.max(0, parseInt(value, 10) || 0));
    setStorageItem("p" + player + "BallsCtrlPanel", next);
    setStorageItem("p" + player + "Balls", next);
    const ballsInput = document.getElementById("p" + player + "Balls");
    if (ballsInput) {
        ballsInput.value = next;
    }
    if (typeof bc !== "undefined") {
        bc.postMessage({ player: player, balls: next });
    }
}

async function undoLastScoringAction() {
    const btn = document.getElementById("snookerUndoBtn");
    if (btn && (btn.classList.contains("snooker-ball-disabled") || btn.getAttribute("aria-disabled") === "true")) {
        return;
    }
    if (isSnookerBallMode() && snookerUndoStack.length > 0) {
        await undoLastSnookerAction();
        return;
    }
    if (!scoringUndoStack.length) {
        return;
    }
    if (window.PlayerStats && typeof window.PlayerStats.flushRackRecordQueue === "function") {
        try {
            await window.PlayerStats.flushRackRecordQueue();
        } catch (err) {
            console.error("flushRackRecordQueue before undo:", err);
        }
    }
    const entry = scoringUndoStack.pop();
    persistScoringUndoStack();
    updateScoringUndoButton();
    try {
        await applyScoringUndoEntry(entry);
    } catch (err) {
        console.error("Scoring undo failed:", err);
    }
    updateScoreControlAvailability();
    updateCallGameButton();
    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
    if (window.PlayerStats && typeof window.PlayerStats.broadcastOverlayStatsIfEnabled === "function") {
        window.PlayerStats.broadcastOverlayStatsIfEnabled();
    }
    console.log("Scoring action undone:", entry && entry.type);
}

async function applyScoringUndoEntry(entry) {
    if (!entry) {
        return;
    }
    if (entry.type === "breakerPick") {
        const before = entry.before || {};
        setStorageItem("rackBreakerSlot", before.rackBreakerSlot || "");
        setStorageItem("lastRackBreakerSlot", before.lastRackBreakerSlot || "");
        setRackOpponentVisited(before.rackOpponentVisited === "yes");
        setSnookerActivePlayerFromUndo(before.activePlayer === "2" ? "2" : "1");
        syncRackBreakerPickerVisibility();
        syncPlayerSlotPickerUI();
        updateRackBreakerBallLock();
        updateScoringUndoButton();
        return;
    }
    if (entry.type === "fade") {
        const ball = document.getElementById(entry.ballId);
        if (ball && ball.classList.contains("faded")) {
            ball.classList.remove("faded");
            const ballState = JSON.parse(getStorageItem("ballState") || "{}");
            ballState[entry.ballId] = false;
            setStorageItem("ballState", JSON.stringify(ballState));
            if (typeof bc !== "undefined") {
                bc.postMessage({ resetBall: entry.ballId });
            }
        }
        if (entry.recordedBall && entry.player) {
            await undoTrackerBallPot(entry.player);
        }
        return;
    }

    if (entry.type === "earlyGameBallReject") {
        const ball = document.getElementById(entry.ballId);
        if (ball && ball.classList.contains("faded")) {
            ball.classList.remove("faded");
            const ballState = JSON.parse(getStorageItem("ballState") || "{}");
            ballState[entry.ballId] = false;
            setStorageItem("ballState", JSON.stringify(ballState));
            if (typeof bc !== "undefined") {
                bc.postMessage({ resetBall: entry.ballId });
            }
        }
        clearEarlyGameBallRejectCooldown();
        if (entry.recordedBall && entry.player) {
            await undoTrackerBallPot(entry.player);
        }
        return;
    }

    if (entry.type === "rackWin" || entry.type === "rackLoss" || entry.type === "snookerFrame") {
        // Restore scores before tracker/breaker UI so race-lock checks see the pre-win scoreline.
        if (entry.before) {
            setPrimaryScoreAbsolute("1", entry.before.p1Score);
            setPrimaryScoreAbsolute("2", entry.before.p2Score);
            setBallsScoreAbsolute("1", entry.before.p1Balls);
            setBallsScoreAbsolute("2", entry.before.p2Balls);
        }
        restoreTrackerFromScoringSnapshot(entry.before);
        if (entry.player && window.PlayerStats && typeof window.PlayerStats.undoLastRack === "function") {
            await window.PlayerStats.undoLastRack(entry.player);
        }
        // Game-ball pot was recorded for the shooter (active player), not always entry.player (rackLoss credits opponent).
        if (entry.recordedBall && entry.recordedBallPlayer) {
            await undoTrackerBallPot(entry.recordedBallPlayer);
        }
        if (entry.type === "snookerFrame" && isSnookerBallMode()) {
            updateSnookerBallAvailability();
            updateSnookerGoldVisibility();
            refreshSnookerOverlayStats();
        }
        // Do not re-prompt for breaker — snapshot already restored Active Player / breaker for further undos.
        updateScoreControlAvailability();
        updateCallGameButton();
        updateScoringUndoButton();
        return;
    }

    if (entry.type === "straightPot") {
        const ball = document.getElementById(entry.ballId);
        if (ball && ball.classList.contains("faded")) {
            ball.classList.remove("faded");
            const ballState = JSON.parse(getStorageItem("ballState") || "{}");
            ballState[entry.ballId] = false;
            setStorageItem("ballState", JSON.stringify(ballState));
            if (typeof bc !== "undefined") {
                bc.postMessage({ resetBall: entry.ballId });
            }
        }
        const owners = getPocketBallOwners();
        delete owners[entry.ballId];
        setPocketBallOwners(owners);
        if (entry.player) {
            postScore("sub", entry.player);
        }
        return;
    }

    if (entry.type === "pocketPot") {
        if (entry.awardedRack) {
            if (entry.before) {
                setPrimaryScoreAbsolute("1", entry.before.p1Score);
                setPrimaryScoreAbsolute("2", entry.before.p2Score);
                setBallsScoreAbsolute("1", entry.before.p1Balls);
                setBallsScoreAbsolute("2", entry.before.p2Balls);
            }
            restoreTrackerFromScoringSnapshot(entry.before);
            if (entry.player && window.PlayerStats && typeof window.PlayerStats.undoLastRack === "function") {
                await window.PlayerStats.undoLastRack(entry.player);
            }
            // Ball pot that triggered the rack was also recorded — undo it if still last.
            if (entry.player && window.PlayerStats && typeof window.PlayerStats.undoLastBall === "function") {
                try {
                    await window.PlayerStats.undoLastBall(entry.player);
                } catch (err) {
                    console.error("undoLastBall after pocket rack undo:", err);
                }
            }
            updateScoreControlAvailability();
            updateCallGameButton();
            updateScoringUndoButton();
            return;
        }
        const ball = document.getElementById(entry.ballId);
        if (ball && ball.classList.contains("faded")) {
            ball.classList.remove("faded");
            const ballState = JSON.parse(getStorageItem("ballState") || "{}");
            ballState[entry.ballId] = false;
            setStorageItem("ballState", JSON.stringify(ballState));
            if (typeof bc !== "undefined") {
                bc.postMessage({ resetBall: entry.ballId });
            }
        }
        const owners = getPocketBallOwners();
        delete owners[entry.ballId];
        setPocketBallOwners(owners);
        if (entry.player) {
            postBalls("sub", entry.player);
        }
    }
}

async function undoLastSnookerAction() {
    if (!isSnookerBallMode()) {
        return;
    }
    const btn = document.getElementById("snookerUndoBtn");
    if (btn && (btn.classList.contains("snooker-ball-disabled") || btn.getAttribute("aria-disabled") === "true")) {
        return;
    }
    if (snookerUndoStack.length === 0) {
        return;
    }
    const snap = snookerUndoStack.pop();
    persistSnookerUndoStack();
    updateScoringUndoButton();
    clearSnookerColorFeedback();

    setSnookerPointsAbsolute("1", snap.p1Points);
    setSnookerPointsAbsolute("2", snap.p2Points);
    setSnookerPhase(snap.phase);
    setSnookerAfterFreeball(!!snap.afterFreeball);
    setSnookerFoulAwaitingPlayerChange(!!snap.foulAwaitingPlayerChange);
    setSnookerFreeBallOffered(!!snap.freeBallOffered);
    setSnookerRedsPotted(snap.redsPotted || 0);
    setSnookerClearedColors(Array.isArray(snap.clearedColors) ? snap.clearedColors : []);
    setSnookerGoldenBallFouled(!!snap.goldenBallFouled);
    setSnookerCurrentBreak(snap.currentBreak || 0);
    setSnookerFrameHighBreak("1", snap.frameHighP1 || 0);
    setSnookerFrameHighBreak("2", snap.frameHighP2 || 0);
    if (snap.activePlayer === "1" || snap.activePlayer === "2") {
        setSnookerActivePlayerFromUndo(snap.activePlayer);
    }

    if (snap.recordedBallPlayer &&
        window.PlayerStats &&
        typeof window.PlayerStats.undoLastBall === "function") {
        try {
            await window.PlayerStats.undoLastBall(snap.recordedBallPlayer);
        } catch (err) {
            console.error("PlayerStats snooker undo ball error:", err);
        }
    }

    updateSnookerBallAvailability();
    updateSnookerGoldVisibility();
    updateScoreControlAvailability();
    refreshSnookerOverlayStats();
    updateScoringUndoButton();
    if (window.streamSharing) {
        window.streamSharing.sendUpdate();
    }
    console.log("Snooker action undone");
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
    const tracker = getBallTrackerPanel();
    if (tracker) {
        tracker.classList.toggle("ball-tracker-locked", locked);
    }
    document.querySelectorAll("#ballTrackerDiv .ball").forEach(function (ball) {
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

/** Points for the lowest ball still on the table (free ball scores this value). */
function getSnookerLowestBallPoints() {
    if (!isSnookerBallMode()) {
        return 1;
    }
    if (getSnookerRemainingReds() > 0) {
        return (SNOOKER_BALL_META[1] && SNOOKER_BALL_META[1].points) || 1;
    }
    const nextColor = getNextSnookerClearanceColor();
    if (nextColor && SNOOKER_BALL_META[nextColor]) {
        return SNOOKER_BALL_META[nextColor].points || 1;
    }
    return 1;
}

function refreshSnookerFreeBallLabel() {
    const el = document.getElementById("ball 10");
    if (!el || !isSnookerBallMode()) {
        return;
    }
    const pts = getSnookerLowestBallPoints();
    el.title = "Free Ball (" + pts + "-point)";
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
 * Points left on the table for frame mathematics / Points Remaining:
 *   (unpotted reds × 8) + final colors package (27, or 47 with Golden Ball).
 * Once reds are gone, sum only the uncleared colors still on the table (+ gold if available).
 */
function getSnookerPointsRemainingOnTable() {
    if (!isSnookerBallMode()) {
        return 0;
    }
    const redsOnTable = getSnookerRemainingReds();
    if (redsOnTable > 0) {
        return redsOnTable * 8 + getSnookerFinalColorsPoints();
    }

    // Colors-only clearance: count what's still on the table.
    let pts = 0;
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
 * table remaining (reds×8 + 27/47, or clearance colors) plus +7 when this player
 * is at the table on a color-after-red (owed color for the visit).
 */
function getSnookerRemainingTablePoints(playerSlot) {
    if (!isSnookerBallMode()) {
        return 0;
    }
    let pts = getSnookerPointsRemainingOnTable();
    const slot = playerSlot === "2" || playerSlot === 2 ? "2" : (playerSlot === "1" || playerSlot === 1 ? "1" : null);
    const atTable = !slot || getActivePlayerSlot() === slot;
    if (atTable && getSnookerPhase() === "color") {
        pts += 7;
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
 * Points Remaining = reds×8 + 27/47 (or clearance colors) — not visit-scoped.
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
    const remaining = getSnookerPointsRemainingOnTable();
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
        updateSnookerUndoButton();
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
    // Free Ball only after a foul and then an Active Player change (incoming visit).
    const freeBallOk = isSnookerFreeBallOffered() && !expectColor && !allColorsCleared;
    setSnookerBallDisabled(10, !freeBallOk);

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
    refreshSnookerFreeBallLabel();
    updateSnookerGoldVisibility();
    updateSnookerUndoButton();
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
            updateSnookerBallAvailability();
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
}

function enableSnookerScoringAids() {
    enableActivePlayerTrackerAids();
}

function enableBallTrackerScoringAids() {
    enableActivePlayerTrackerAids();
}

/** @deprecated Use enableBallTrackerScoringAids */
function enablePocketScoringAids() {
    enableBallTrackerScoringAids();
}

function syncSetupVariantOptionSlot() {
    const slot = document.getElementById("setupVariantOptionSlot");
    const goldDiv = document.getElementById("snookerGoldDiv");
    const earlyDiv = document.getElementById("earlyGameBallDiv");
    const pointDiv = document.getElementById("pointBasedDiv");
    if (!slot || !goldDiv || !pointDiv) {
        return;
    }
    const gameType = getStorageItem("gameType");
    const isCustom = gameType === "game7";
    const showPoint = isCustom;
    const showGold = !isCustom && isSnookerBallMode();
    const showEarly = gameType === "game1" || gameType === "game2" || gameType === "game3";
    pointDiv.classList.toggle("noShow", !showPoint);
    goldDiv.classList.toggle("noShow", !showGold);
    if (earlyDiv) {
        earlyDiv.classList.toggle("noShow", !showEarly);
    }
    slot.classList.toggle("noShow", !showPoint && !showGold && !showEarly);

    const earlyLabel = document.getElementById("labelForEarlyGameBallCheckbox");
    if (earlyLabel) {
        earlyLabel.textContent = gameType === "game1"
            ? "Win on Break"
            : "Early Game Ball/Win on Break";
    }
    const earlyCheckbox = document.getElementById("earlyGameBallCheckbox");
    if (earlyCheckbox) {
        earlyCheckbox.checked = isEarlyGameBallEnabled();
    }
}

function updateSnookerUiVisibility() {
    const snookerMode = isSnookerBallMode();
    const goldCheckbox = document.getElementById("snookerGoldCheckbox");
    if (goldCheckbox) {
        goldCheckbox.checked = isSnookerGoldEnabled();
    }
    syncSetupVariantOptionSlot();
    syncControlsTabLayout();
    updateSnookerGoldVisibility();
    if (snookerMode) {
        updateSnookerBallAvailability();
        setStorageItem("enableBallDisplay", "no");
        const displayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (displayCheckbox) {
            displayCheckbox.checked = false;
        }
    } else {
        clearSnookerUndoStack();
    }
    updateSnookerUndoButton();
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
        // Option off → hide. Fouled or potted → removed from table (hide). Otherwise show
        // (disabled until unlock: final black + 147).
        const onTable = optionOn && !isSnookerGoldenBallFouled() && !isSnookerColorCleared(8);
        ball8.classList[onTable ? "remove" : "add"]("noShow");
    }
    if (foulGold) {
        // Golden Ball foul while the ball is still in play (option on, not yet fouled/potted off).
        const foulGoldAvailable = optionOn && !isSnookerGoldenBallFouled() && !isSnookerColorCleared(8);
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
    // Recalculate Possible Break / Points Remaining (27 vs 47) and push overlay.
    if (isSnookerBallMode()) {
        refreshSnookerOverlayStats();
    }
}

/** Per-game storage key for Win on Break (8) / Early Game Ball (9/10). */
function getWinOnBreakStorageKey(gameType) {
    const type = gameType || getStorageItem("gameType");
    if (type === "game1") {
        return "winOnBreakEnabled";
    }
    if (type === "game2") {
        return "earlyGameBallEnabled9";
    }
    if (type === "game3") {
        return "earlyGameBallEnabled10";
    }
    return null;
}

/** 8 / 9 / 10-Ball: Win on Break or Early Game Ball/Win on Break for the active game type only. */
function isEarlyGameBallEnabled() {
    const key = getWinOnBreakStorageKey();
    return !!(key && getStorageItem(key) === "yes");
}

function earlyGameBallToggle() {
    const key = getWinOnBreakStorageKey();
    if (!key) {
        return;
    }
    const checkbox = document.getElementById("earlyGameBallCheckbox");
    const enabled = checkbox && checkbox.checked;
    setStorageItem(key, enabled ? "yes" : "no");
}

/**
 * For 9/10-Ball with Early Game Ball/Win on Break off, every ball below the game ball must already be faded.
 * Hidden balls (e.g. 10–15 in 9-Ball) are ignored.
 */
function arePrecedingObjectBallsPotted() {
    const winningId = getGameWinningBallId();
    if (!winningId) {
        return true;
    }
    const match = /^ball\s+(\d+)$/i.exec(winningId);
    const winNum = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isFinite(winNum) || winNum < 2) {
        return true;
    }
    for (let n = 1; n < winNum; n++) {
        const ball = document.getElementById("ball " + n);
        if (!ball || ball.classList.contains("noShow")) {
            continue;
        }
        if (!ball.classList.contains("faded")) {
            return false;
        }
    }
    return true;
}

/** All visible 8-Ball object balls (1–7, 9–15) are faded — table cleared for a legal 8. */
function areAllEightBallObjectBallsPotted() {
    for (let n = 1; n <= 15; n++) {
        if (n === 8) {
            continue;
        }
        const ball = document.getElementById("ball " + n);
        if (!ball || ball.classList.contains("noShow")) {
            continue;
        }
        if (!ball.classList.contains("faded")) {
            return false;
        }
    }
    return true;
}

/**
 * Resolve potting the game ball for 8 / 9 / 10-Ball.
 * 9/10: Early Game Ball/Win on Break on → early win; off → require all lower balls (else reject).
 * 8: Win on Break on + first ball → win; all object balls down → win; otherwise out of sequence → loss.
 * 8 with Win on Break off + first ball → reject (no win on break).
 */
function resolveTrackerGameBallPot(ballId) {
    const type = getStorageItem("gameType");

    if (type === "game2" || type === "game3") {
        if (isEarlyGameBallEnabled() || arePrecedingObjectBallsPotted()) {
            creditTrackerRackWin(ballId);
        } else {
            rejectTrackerEarlyGameBall(ballId);
        }
        return;
    }

    if (type === "game1") {
        const othersDown = countFadedObjectBalls();
        if (othersDown === 0) {
            if (isEarlyGameBallEnabled()) {
                creditTrackerRackWin(ballId);
            } else {
                rejectTrackerEarlyGameBall(ballId);
            }
            return;
        }
        if (areAllEightBallObjectBallsPotted()) {
            creditTrackerRackWin(ballId);
            return;
        }
        // 8 potted with other object balls still up — loss of rack for Active Player.
        creditTrackerRackLoss(ballId);
        return;
    }

    creditTrackerRackWin(ballId);
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
        return Promise.resolve();
    }
    if (player !== "1" && player !== "2") {
        return Promise.resolve();
    }
    return window.PlayerStats.recordBallWin(player).catch(function (err) {
        console.error("PlayerStats snooker ball pot error:", err);
    });
}

/** 8 / 9 / 10-Ball Ball Scoring: credit Active Player balls-potted (match-scoped). */
function recordTrackerBallPot(player) {
    if (!window.PlayerStats || typeof window.PlayerStats.recordBallWin !== "function") {
        return Promise.resolve();
    }
    if (player !== "1" && player !== "2") {
        return Promise.resolve();
    }
    return window.PlayerStats.recordBallWin(player).catch(function (err) {
        console.error("PlayerStats tracker ball pot error:", err);
    });
}

function undoTrackerBallPot(player) {
    if (!window.PlayerStats || typeof window.PlayerStats.undoLastBall !== "function") {
        return Promise.resolve();
    }
    if (player !== "1" && player !== "2") {
        return Promise.resolve();
    }
    return window.PlayerStats.undoLastBall(player).then(function () {
        if (typeof window.PlayerStats.broadcastOverlayStatsIfEnabled === "function") {
            window.PlayerStats.broadcastOverlayStatsIfEnabled();
        }
    }).catch(function (err) {
        console.error("PlayerStats tracker ball undo error:", err);
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
    const undoSnap = captureSnookerUndoSnapshot();
    const active = getSnookerActivePlayer();
    const opponent = active === "1" ? "2" : "1";
    if (!addSnookerPoints(opponent, points)) {
        return;
    }
    // Foul ends the active player's break (foul points are not break points).
    endSnookerBreak();
    // Break ended — next shot can be a red (unless all reds are gone).
    setSnookerPhase("red");
    setSnookerAfterFreeball(false);
    // Free Ball becomes available only after the Active Player is changed.
    setSnookerFreeBallOffered(false);
    setSnookerFoulAwaitingPlayerChange(true);
    clearSnookerColorFeedback();
    if (foulKey === "gold") {
        removeSnookerGoldenBallFromPlay();
    }
    commitSnookerUndoSnapshot(undoSnap, null);
    updateSnookerBallAvailability();
    updateSnookerGoldVisibility();
    cancelSnookerFoul();
    // Incoming player takes the table after a foul (also unlocks Free Ball).
    const nextIsP1 = opponent === "1";
    const playerToggle = document.getElementById("playerToggleCheckbox");
    if (playerToggle) {
        playerToggle.checked = nextIsP1;
    }
    togglePlayer(nextIsP1);
    console.log(`Snooker foul (${foulKey}) awarded ${points} to player ${opponent}; active player → ${opponent}`);
}

async function handleSnookerBallClick(element) {
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
        const undoSnap = captureSnookerUndoSnapshot();
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
        await recordSnookerBallPotted(scorer);
        commitSnookerUndoSnapshot(undoSnap, scorer);
        return;
    }
    if (typeof meta.points !== "number" && num !== 10) {
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
        const undoSnap = captureSnookerUndoSnapshot();
        const scorer = getSnookerActivePlayer();
        if (!addSnookerPoints(scorer, meta.points)) {
            return;
        }
        addToSnookerBreak(scorer, meta.points);
        setSnookerRedsPotted(reds + 1);
        setSnookerAfterFreeball(false);
        setSnookerFreeBallOffered(false);
        setSnookerFoulAwaitingPlayerChange(false);
        setSnookerPhase("color");
        updateSnookerBallAvailability();
        refreshSnookerOverlayStats();
        await recordSnookerBallPotted(scorer);
        commitSnookerUndoSnapshot(undoSnap, scorer);
        return;
    }

    if (isFreeball) {
        // Free Ball: only after a foul and an Active Player change (incoming visit).
        if (!isSnookerFreeBallOffered() || expectColor || areSnookerColorsAllCleared()) {
            return;
        }
        const undoSnap = captureSnookerUndoSnapshot();
        const scorer = getSnookerActivePlayer();
        const freeBallPoints = getSnookerLowestBallPoints();
        if (!addSnookerPoints(scorer, freeBallPoints)) {
            return;
        }
        addToSnookerBreak(scorer, freeBallPoints);
        setSnookerFreeBallOffered(false);
        setSnookerFoulAwaitingPlayerChange(false);
        if (!redsDone) {
            setSnookerAfterFreeball(true);
            setSnookerPhase("color");
        }
        updateSnookerBallAvailability();
        refreshSnookerOverlayStats();
        await recordSnookerBallPotted(scorer);
        commitSnookerUndoSnapshot(undoSnap, scorer);
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
        const undoSnap = captureSnookerUndoSnapshot();
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
            await recordSnookerBallPotted(scorer);
            commitSnookerUndoSnapshot(undoSnap, scorer);
            return;
        }

        // Reds phase: color is re-spotted after each red. After the 15th red's color, clearance begins (yellow first).
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
        await recordSnookerBallPotted(scorer);
        commitSnookerUndoSnapshot(undoSnap, scorer);
        return;
    }
}

function updateActivePlayerNameDisplay() {
    syncPlayerSlotPickerUI();
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
    updateRackBreakerPickerLabels();
}

function isScoreDisplayEnabled() {
    return getStorageItem("usePlayer1") === "yes" &&
        getStorageItem("usePlayer2") === "yes" &&
        getStorageItem("scoreDisplay") === "yes";
}

function syncScoreDisplayDependentUI() {
    const bothPlayersEnabled = getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes";
    const scoresOn = isScoreDisplayEnabled();
    const manualScoreIds = ["scoreLabel", "scoreInfoP1", "scoreInfoP2", "scoreEditing"];

    manualScoreIds.forEach(function (id) {
        const el = document.getElementById(id);
        if (el) {
            el.classList[(bothPlayersEnabled && scoresOn) ? "remove" : "add"]("noShow");
        }
    });

    const ballTrackerCheckbox = document.getElementById("ballTrackerCheckbox");
    const ballDisplayCheckbox = document.getElementById("ballDisplayCheckbox");
    const ballTrackerPanel = getBallTrackerPanel();
    const ballTrackerDirectionDiv = document.getElementById("ballTrackerDirectionDiv");

    if (!scoresOn) {
        if (ballTrackerCheckbox) {
            ballTrackerCheckbox.disabled = true;
            ballTrackerCheckbox.checked = false;
        }
        if (ballDisplayCheckbox) {
            ballDisplayCheckbox.disabled = true;
            ballDisplayCheckbox.checked = false;
        }
        if (ballTrackerPanel) {
            ballTrackerPanel.classList.add("noShow");
        }
        if (ballTrackerDirectionDiv) {
            ballTrackerDirectionDiv.classList.add("noShow");
        }
        if (typeof bc !== "undefined") {
            bc.postMessage({ displayBallTracker: false });
        }
    } else if (bothPlayersEnabled) {
        if (ballTrackerCheckbox) {
            ballTrackerCheckbox.disabled = false;
            ballTrackerCheckbox.checked = getStorageItem("enableBallTracker") === "yes";
        }
        if (ballDisplayCheckbox) {
            ballDisplayCheckbox.disabled = false;
            ballDisplayCheckbox.checked = getStorageItem("enableBallDisplay") === "yes";
        }
        useBallTracker();
        syncActivePlayerRequiredForBallTracker();
    }

    updateScoreModeUI();

    if (bothPlayersEnabled && typeof bc !== "undefined") {
        bc.postMessage({ scoreDisplay: scoresOn ? "yes" : "no" });
    }
    syncControlsTabLayout();
}

function updateScoreModeUI() {
    const bothPlayersEnabled = getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes";
    const scoresOn = isScoreDisplayEnabled();
    const dualMode = isDualScoreMode() && bothPlayersEnabled && scoresOn;
    const isCustom = getStorageItem("gameType") === "game7";
    const scoreInfoP1Balls = document.getElementById("scoreInfoP1Balls");
    const scoreInfoP2Balls = document.getElementById("scoreInfoP2Balls");

    syncSetupVariantOptionSlot();

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

        syncGameTypeSelect(value);
        syncControlsTabLayout();
        syncSetupVariantOptionSlot();

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
    const resolved = normalizeGameType(value);
    setStorageItem("gameType", resolved);
    syncGameTypeSelect(resolved);

    const gameType = resolved;
    cancelSnookerFoul();

    // 9-Ball or 10-Ball -> hide both
    if (["game2", "game3"].includes(gameType)) {
        const ballSelectionWrap = document.getElementById("ballSelectionWrap");
        if (ballSelectionWrap) {
            ballSelectionWrap.classList.add("noShow");
        }
        setStorageItem("ballSelection", "american");
        document.getElementById("ballSelection").value = "american";
        ballType("american");
        enableBallTrackerScoringAids();

        // 8-Ball or Custom -> show both
    } else if (["game1", "game7"].includes(gameType)) {
        const ballSelectionWrap = document.getElementById("ballSelectionWrap");
        if (ballSelectionWrap) {
            ballSelectionWrap.classList.remove("noShow");
        }
        if (getStorageItem("useBallSet") !== "yes") {
            document.getElementById('p1colorOpen').checked = true;
            setStorageItem("playerBallSet", "p1Open");
            bc.postMessage({ playerBallSet: "p1Open" });
        }
        // Leaving Snooker: drop forced snooker ball set (Custom may still choose snooker via Ball Type)
        if (getStorageItem("ballSelection") === "snooker") {
            setStorageItem("ballSelection", "american");
        }
        const currentBall = getStorageItem("ballSelection") || "american";
        document.getElementById("ballSelection").value = currentBall;
        ballType(currentBall);
        console.log("Ball set toggle enabled and reset to Open Table");
        if (gameType === "game1") {
            enableBallTrackerScoringAids();
        }

        // Snooker -> force snooker balls; show gold toggle only (no ball set / type dropdown)
    } else if (gameType === "game8") {
        const ballSelectionWrap = document.getElementById("ballSelectionWrap");
        if (ballSelectionWrap) {
            ballSelectionWrap.classList.add("noShow");
        }
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
        const ballSelectionWrap = document.getElementById("ballSelectionWrap");
        if (ballSelectionWrap) {
            ballSelectionWrap.classList.remove("noShow");
        }
        if (getStorageItem("ballSelection") === "snooker") {
            setStorageItem("ballSelection", "american");
        }
        document.getElementById("ballSelection").value = getStorageItem("ballSelection") || "american";
        ballType(document.getElementById("ballSelection").value);
        if (isBallTrackerAutoScoreGame()) {
            enableBallTrackerScoringAids();
        }
    }

    refreshBallSelectionOptions();
    applySnookerTrackerLayout();
    syncBallSetSettingsVisibility();

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
    bc.postMessage({ gameType: resolved, ballSelection: getStorageItem("ballSelection") });
    updateScoreModeUI();
    updateSnookerUiVisibility();
    updateScoreControlAvailability();
    const raceVal = (document.getElementById("raceInfoTxt") && document.getElementById("raceInfoTxt").value) ||
        getStorageItem("raceInfo") || "";
    bc.postMessage({ race: getRaceOverlayText(raceVal) });
    if (restore) {
        applySavedBallStates();
    } else if (!isSnookerBallMode()) {
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
    useBallTracker();
    if (!restore) {
        clearRackBreakerState(true);
        clearAllScoringUndoHistory();
    }
    syncControlsTabLayout();
    syncRackBreakerPickerVisibility();
    if (window.PlayerStats && typeof window.PlayerStats.renderStatsVisibilityPanel === "function") {
        window.PlayerStats.renderStatsVisibilityPanel();
    }
}

function ballType(value) {
    setStorageItem("ballSelection", value);

    // Update the label text based on ball type
    const redLabel = document.querySelector('label[for="p1colorRed"] span');
    const yellowLabel = document.querySelector('label[for="p1colorYellow"] span');
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
    syncBallSetSettingsVisibility();
    console.log(`Ball Type ${value}`)
}

function isBallSetToggleApplicable() {
    const gameType = getActiveGameType();
    if (gameType === "game1") {
        return true;
    }
    return gameType === "game7" && getActiveBallSelection() !== "snooker";
}

function syncBallSetSettingsVisibility() {
    const ballSetDiv = document.getElementById("ballSetDiv");
    const ballSetCheckbox = document.getElementById("ballSetCheckbox");
    if (!ballSetDiv) {
        return;
    }
    const applicable = isBallSetToggleApplicable();
    ballSetDiv.classList.toggle("noShow", !applicable);
    if (!ballSetCheckbox) {
        syncBallSetControlsVisibility();
        return;
    }
    if (!applicable) {
        ballSetCheckbox.disabled = true;
        ballSetCheckbox.checked = false;
        syncBallSetControlsVisibility();
        return;
    }
    ballSetCheckbox.disabled = false;
    ballSetCheckbox.checked = getStorageItem("useBallSet") === "yes";
    syncBallSetControlsVisibility();
    if (!ballSetCheckbox.checked) {
        return;
    }
    const savedBallSet = getStorageItem("playerBallSet");
    if (!savedBallSet) {
        return;
    }
    const radio = document.querySelector(`input[name="p1BallSetSelect"][value="${savedBallSet}"]`);
    if (radio) {
        radio.checked = true;
    }
}

function syncBallSetControlsVisibility() {
    const ballSet = document.getElementById("ballSet");
    if (!ballSet) {
        return;
    }
    const show = isScoreDisplayEnabled() &&
        isBallSetToggleApplicable() &&
        getStorageItem("useBallSet") === "yes" &&
        !isBallTrackerControlsVisible();
    ballSet.classList.toggle("noShow", !show);
}

function useBallSetToggle() {
    // Allow ball set toggle only for 8-ball
    var useBallSet = document.getElementById("ballSetCheckbox");
    var isChecked = useBallSet.checked;
    var storageValue = isChecked ? "yes" : "no";

    console.log(`Use Ball Set Toggle ${isChecked}`);
    setStorageItem("useBallSet", storageValue);
    if (!isChecked) {
        // Reset to "Open Table" and hide the ball images
        document.getElementById('p1colorOpen').checked = true;
        setStorageItem("playerBallSet", "p1Open");
        bc.postMessage({ playerBallSet: "p1Open" });
    }
    syncBallSetControlsVisibility();
    syncControlsTabLayout();
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
    if (!isScoreDisplayEnabled()) {
        const checkbox = document.getElementById("ballTrackerCheckbox");
        if (checkbox) {
            checkbox.checked = false;
            checkbox.disabled = true;
        }
        const displayCheckbox = document.getElementById("ballDisplayCheckbox");
        if (displayCheckbox) {
            displayCheckbox.checked = false;
            displayCheckbox.disabled = true;
        }
        getBallTrackerPanel()?.classList.add("noShow");
        document.getElementById("ballTrackerDirectionDiv")?.classList.add("noShow");
        if (typeof bc !== "undefined") {
            bc.postMessage({ displayBallTracker: false });
        }
        syncBallSetSettingsVisibility();
        syncControlsTabLayout();
        return;
    }
    const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
    const checked = document.getElementById("ballTrackerCheckbox").checked;
    console.log('Both players enabled evaluation:', bothPlayersEnabled)
    setStorageItem("enableBallTracker", checked ? "yes" : "no");
    if (checked) {
        getBallTrackerPanel()?.classList.remove("noShow");
    } else {
        // Hide tracker UI; Display Balls cannot stay on without the tracker
        getBallTrackerPanel()?.classList.add("noShow");
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
    syncControlsTabLayout();
    updateSnookerUiVisibility();

    if (window.streamSharing && typeof window.streamSharing.sendUpdate === "function") {
        window.streamSharing.sendUpdate();
    }
    syncRackBreakerPickerVisibility();
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
            const activePlayer = getActivePlayerSlot() === "1";
            bc.postMessage({ clockDisplay: "showActivePlayer", player: activePlayer });
            syncPlayerSlotPickerUI();
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
    document.getElementById("ballTrackerDirectionDiv").innerHTML = newDirection.charAt(0).toUpperCase() + newDirection.slice(1).toLowerCase() + " Ball Display";
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
                        if (i === 10) {
                            refreshSnookerFreeBallLabel();
                        } else {
                            ballElement.title = meta.title || "";
                        }
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
    const currentGame = getStoredGameType() || (document.getElementById(GAME_TYPE_SELECT_ID) ? document.getElementById(GAME_TYPE_SELECT_ID).value : DEFAULT_GAME_TYPE);
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
    if (isRackBreakerBallGridLockEnabled() && !getRackBreakerSlot()) {
        return;
    }
    if (element.classList.contains("ball-win-cooldown")) {
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

    if (nowFaded === wasFaded) {
        return;
    }

    // 8-Ball / Custom: while Open, assign Chosen Ball from Active Player (8-Ball waits for 2nd object ball).
    if (nowFaded) {
        maybeAssignBallSetFromPot(element.id);
    }

    // Bank / One Pocket: tracker pots award a ball to the Active Player;
    // re-enabling deducts from the player who originally received that ball.
    if (isPocketScoreGame()) {
        if (nowFaded) {
            creditPocketBallPot(element.id);
        } else {
            discardLastScoringUndoIf(function (e) {
                return e.type === "pocketPot" && e.ballId === element.id && !e.awardedRack;
            });
            debitPocketBallUnpot(element.id);
        }
        return;
    }

    // 8 / 9 / 10-Ball: potting the game ball awards a rack (or 8-ball out-of-sequence loss);
    // early / illegal pots may reject and reappear after a short cooldown.
    if (isTrackerRackWinGame()) {
        const winningId = getGameWinningBallId();
        if (nowFaded && element.id !== winningId) {
            // Next rack underway — clear pending game-ball fade without deducting.
            clearPendingTrackerRackWinBallIfNeeded(element.id);
            const player = getActivePlayerSlot();
            pushScoringUndo({ type: "fade", ballId: element.id, player: player, recordedBall: true });
            recordTrackerBallPot(player);
        }
        if (!nowFaded && element.id !== winningId) {
            const discarded = discardLastScoringUndoIf(function (e) {
                return e.type === "fade" && e.ballId === element.id;
            });
            if (discarded && discarded.recordedBall && discarded.player) {
                undoTrackerBallPot(discarded.player);
            }
        }
        if (element.id === winningId) {
            if (nowFaded) {
                resolveTrackerGameBallPot(element.id);
            } else if (getStorageItem("trackerRackWinBall") === element.id) {
                const discarded = discardLastScoringUndoIf(function (e) {
                    return (e.type === "rackWin" || e.type === "rackLoss") && e.ballId === element.id;
                });
                debitTrackerRackWin(element.id);
                if (discarded && discarded.recordedBall && discarded.recordedBallPlayer) {
                    undoTrackerBallPot(discarded.recordedBallPlayer);
                }
            } else {
                const discarded = discardLastScoringUndoIf(function (e) {
                    return e.type === "earlyGameBallReject" && e.ballId === element.id;
                });
                clearEarlyGameBallRejectCooldown();
                if (discarded && discarded.recordedBall && discarded.player) {
                    undoTrackerBallPot(discarded.player);
                }
            }
        }
        return;
    }

    // Straight Pool: every pot +1 primary Balls; unclick −1; 14.1 re-rack at one ball left.
    if (isStraightPool()) {
        if (nowFaded) {
            creditStraightPoolPot(element.id);
            maybeStraightPoolRerack();
        } else {
            discardLastScoringUndoIf(function (e) {
                return e.type === "straightPot" && e.ballId === element.id;
            });
            debitStraightPoolUnpot(element.id);
        }
    }
}

/**
 * Map a potted object ball (1–7 or 9–15) to the P1-centric playerBallSet value.
 * American/Unity: 1–7 → solids/smalls, 9–15 → stripes/bigs.
 * International: 1–7 → yellows, 9–15 → reds (tracker art matches group colour).
 */
function getBallSetValueForPottedBall(num, activeSlot) {
    const selection = getStorageItem("ballSelection") || "american";
    let p1GetsRedSmalls;
    if (selection === "international") {
        p1GetsRedSmalls = num >= 9 && num <= 15;
    } else {
        p1GetsRedSmalls = num >= 1 && num <= 7;
    }
    if (activeSlot === "1") {
        return p1GetsRedSmalls ? "p1red/smalls" : "p1yellow/bigs";
    }
    return p1GetsRedSmalls ? "p1yellow/bigs" : "p1red/smalls";
}

/** Count faded object balls (1–7, 9–15) on the Ball Scoring grid — excludes the 8. */
function countFadedObjectBalls() {
    let count = 0;
    for (let n = 1; n <= 15; n++) {
        if (n === 8) {
            continue;
        }
        const ball = document.getElementById("ball " + n);
        if (ball && ball.classList.contains("faded")) {
            count++;
        }
    }
    return count;
}

/**
 * While Ball Set Toggle + Ball Scoring are on (8-Ball / Custom) and the table is Open,
 * assign Chosen Ball for the Active Player from a potted object ball.
 * 8-Ball waits until a second object ball is potted (first pot may be off the break / still open).
 * Custom still assigns on the first object ball.
 * Stored P1-centric: if P2 pots a group, P1 is set to the opposite group.
 */
function maybeAssignBallSetFromPot(ballId) {
    if (getStorageItem("useBallSet") !== "yes") {
        return;
    }
    if (getStorageItem("enableBallTracker") !== "yes") {
        return;
    }
    const gameType = getStorageItem("gameType");
    if (gameType !== "game1" && gameType !== "game7") {
        return;
    }
    if (isSnookerBallMode()) {
        return;
    }
    if (getStorageItem("playerBallSet") !== "p1Open") {
        return;
    }

    const match = /^ball\s+(\d+)$/i.exec(String(ballId || ""));
    const num = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isFinite(num) || num === 8 || num < 1 || num > 15) {
        return;
    }

    // 8-Ball: stay Open until two object balls are down (avoids assigning off a break pot).
    if (gameType === "game1" && countFadedObjectBalls() < 2) {
        return;
    }

    const active = getActivePlayerSlot();
    const value = getBallSetValueForPottedBall(num, active);

    const radio = document.querySelector('input[name="p1BallSetSelect"][value="' + value + '"]');
    if (radio) {
        radio.checked = true;
    }
    setStorageItem("playerBallSet", value);
    bc.postMessage({ playerBallSet: value });
    console.log("Ball set auto-assigned from " + ballId + " (active P" + active + "): " + value);
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
    const before = captureScoringUndoSnapshot();
    const owners = getPocketBallOwners();
    owners[ballId] = player;
    setPocketBallOwners(owners);
    const scoreBefore = before.p1Score + before.p2Score;
    postBalls("add", player);
    const scoreAfter =
        (parseInt(getStorageItem("p1ScoreCtrlPanel"), 10) || 0) +
        (parseInt(getStorageItem("p2ScoreCtrlPanel"), 10) || 0);
    const awardedRack = scoreAfter > scoreBefore;
    pushScoringUndo({
        type: "pocketPot",
        player: player,
        ballId: ballId,
        awardedRack: awardedRack,
        before: before
    });
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
 * 8 / 9 / 10-Ball: potting the game ball awards a rack to the Active Player.
 * Other balls reset for the next rack; the game ball stays faded and disabled briefly
 * so a double-click cannot award/undo immediately, then clears so the next rack can be won.
 */
function creditTrackerRackWin(ballId) {
    const before = captureScoringUndoSnapshot({ unfadeBallId: ballId });
    const player = getActivePlayerSlot();
    const owners = getPocketBallOwners();
    owners[ballId] = player;
    setPocketBallOwners(owners);
    postScore("add", player, { skipTrackerReset: true });
    resetBallTrackerKeepingBall(ballId, player);
    setStorageItem("trackerRackWinBall", ballId);
    startTrackerRackWinCooldown(ballId);
    recordTrackerBallPot(player);
    pushScoringUndo({
        type: "rackWin",
        player: player,
        ballId: ballId,
        before: before,
        recordedBall: true,
        recordedBallPlayer: player
    });
    maybeShowRackBreakerPickerAfterRackChange();
}

/**
 * 8-Ball: game ball potted out of sequence — Active Player loses the rack (opponent scores).
 */
function creditTrackerRackLoss(ballId) {
    const before = captureScoringUndoSnapshot({ unfadeBallId: ballId });
    const active = getActivePlayerSlot();
    const opponent = active === "1" ? "2" : "1";
    const owners = getPocketBallOwners();
    owners[ballId] = opponent;
    setPocketBallOwners(owners);
    postScore("add", opponent, { skipTrackerReset: true });
    resetBallTrackerKeepingBall(ballId, opponent);
    setStorageItem("trackerRackWinBall", ballId);
    startTrackerRackWinCooldown(ballId);
    // Still counts as a pot for the shooter who sank the 8.
    recordTrackerBallPot(active);
    pushScoringUndo({
        type: "rackLoss",
        player: opponent,
        ballId: ballId,
        before: before,
        recordedBall: true,
        recordedBallPlayer: active
    });
    maybeShowRackBreakerPickerAfterRackChange();
}

/**
 * Unclicking the game ball (before cooldown release) deducts the rack from the credited player.
 */
function debitTrackerRackWin(ballId) {
    clearTrackerRackWinCooldownTimer();
    const ball = document.getElementById(ballId);
    if (ball) {
        ball.classList.remove("ball-win-cooldown");
        ball.removeAttribute("aria-disabled");
    }
    const owners = getPocketBallOwners();
    const player = owners[ballId] || getActivePlayerSlot();
    delete owners[ballId];
    setPocketBallOwners(owners);
    clearTrackerRackWinPending();

    const current = parseInt(getStorageItem("p" + player + "ScoreCtrlPanel"), 10) || 0;
    if (current > 0) {
        postScore("sub", player, { skipTrackerReset: true });
    }
    maybeShowRackBreakerPickerAfterRackChange();
}

function clearTrackerRackWinPending() {
    setStorageItem("trackerRackWinBall", "");
}

let trackerRackWinCooldownTimer = null;
const TRACKER_RACK_WIN_COOLDOWN_MS = 500;

function clearTrackerRackWinCooldownTimer() {
    if (trackerRackWinCooldownTimer) {
        clearTimeout(trackerRackWinCooldownTimer);
        trackerRackWinCooldownTimer = null;
    }
}

function startTrackerRackWinCooldown(ballId) {
    clearTrackerRackWinCooldownTimer();
    const ball = document.getElementById(ballId);
    if (ball) {
        ball.classList.add("ball-win-cooldown");
        ball.setAttribute("aria-disabled", "true");
    }
    trackerRackWinCooldownTimer = setTimeout(function () {
        trackerRackWinCooldownTimer = null;
        releaseTrackerRackWinBall(ballId);
    }, TRACKER_RACK_WIN_COOLDOWN_MS);
}

let earlyGameBallRejectTimer = null;

function clearEarlyGameBallRejectCooldown() {
    if (earlyGameBallRejectTimer) {
        clearTimeout(earlyGameBallRejectTimer);
        earlyGameBallRejectTimer = null;
    }
    const winningId = getGameWinningBallId();
    if (winningId) {
        const ball = document.getElementById(winningId);
        if (ball) {
            ball.classList.remove("ball-win-cooldown");
            ball.removeAttribute("aria-disabled");
        }
    }
}

/**
 * Early Game Ball / Win on Break off: game ball potted too early — no rack awarded.
 * Still counts toward Balls Potted; ball reappears after a short cooldown.
 */
function rejectTrackerEarlyGameBall(ballId) {
    const player = getActivePlayerSlot();
    recordTrackerBallPot(player);
    pushScoringUndo({
        type: "earlyGameBallReject",
        ballId: ballId,
        player: player,
        recordedBall: true
    });
    startEarlyGameBallRejectCooldown(ballId);
}

/**
 * Early Game Ball off: game ball was potted before all lower balls — no rack awarded;
 * re-enable the ball after the same brief cooldown used for rack wins.
 */
function startEarlyGameBallRejectCooldown(ballId) {
    clearEarlyGameBallRejectCooldown();
    clearTrackerRackWinCooldownTimer();
    const ball = document.getElementById(ballId);
    if (ball) {
        ball.classList.add("ball-win-cooldown");
        ball.setAttribute("aria-disabled", "true");
    }
    earlyGameBallRejectTimer = setTimeout(function () {
        earlyGameBallRejectTimer = null;
        releaseEarlyGameBallReject(ballId);
    }, TRACKER_RACK_WIN_COOLDOWN_MS);
}

function releaseEarlyGameBallReject(ballId) {
    const ball = document.getElementById(ballId);
    if (ball) {
        ball.classList.remove("ball-win-cooldown");
        ball.removeAttribute("aria-disabled");
    }
    const ballState = JSON.parse(getStorageItem("ballState") || "{}");
    if (ball && ball.classList.contains("faded")) {
        ball.classList.remove("faded");
        ballState[ballId] = false;
        setStorageItem("ballState", JSON.stringify(ballState));
        bc.postMessage({ resetBall: ballId });
    }
}

/**
 * After the win cooldown, clear the game-ball fade without debiting so it can win the next rack.
 */
function releaseTrackerRackWinBall(ballId) {
    const ball = document.getElementById(ballId);
    if (ball) {
        ball.classList.remove("ball-win-cooldown");
        ball.removeAttribute("aria-disabled");
    }
    const pending = getStorageItem("trackerRackWinBall");
    if (pending && pending !== ballId) {
        return;
    }
    const ballState = JSON.parse(getStorageItem("ballState") || "{}");
    const owners = getPocketBallOwners();
    delete owners[ballId];
    setPocketBallOwners(owners);
    clearTrackerRackWinPending();
    if (ball && ball.classList.contains("faded")) {
        ball.classList.remove("faded");
        ballState[ballId] = false;
        setStorageItem("ballState", JSON.stringify(ballState));
        bc.postMessage({ resetBall: ballId });
    }
}

/**
 * After a tracker rack win, clear all fades except the game ball (held through the cooldown).
 */
function resetBallTrackerKeepingBall(keepBallId, ownerPlayer) {
    const ballState = JSON.parse(getStorageItem("ballState") || "{}");
    const ballElements = document.querySelectorAll("#ballTrackerDiv .ball");

    ballElements.forEach(function (ball) {
        if (ball.id === "snookerUndoBtn") {
            return;
        }
        if (ball.id === keepBallId) {
            // Already faded + synced from togglePot — keep through cooldown.
            ball.classList.add("faded");
            ballState[ball.id] = true;
            return;
        }
        if (ball.classList.contains("faded")) {
            ball.classList.remove("faded");
            bc.postMessage({ resetBall: ball.id });
        }
        ball.classList.remove("ball-win-cooldown");
        ballState[ball.id] = false;
    });

    setStorageItem("ballState", JSON.stringify(ballState));
    const owners = {};
    if (keepBallId && (ownerPlayer === "1" || ownerPlayer === "2")) {
        owners[keepBallId] = ownerPlayer;
    }
    setPocketBallOwners(owners);
    resetBallSet();
}

/**
 * Next rack has started (another ball potted) — drop the pending game-ball fade without debit.
 */
function clearPendingTrackerRackWinBallIfNeeded(clickedBallId) {
    const pending = getStorageItem("trackerRackWinBall");
    if (!pending || pending === clickedBallId) {
        return;
    }
    clearTrackerRackWinCooldownTimer();
    const ball = document.getElementById(pending);
    const ballState = JSON.parse(getStorageItem("ballState") || "{}");
    const owners = getPocketBallOwners();
    delete owners[pending];
    setPocketBallOwners(owners);
    clearTrackerRackWinPending();
    if (ball) {
        ball.classList.remove("ball-win-cooldown");
        ball.removeAttribute("aria-disabled");
        if (ball.classList.contains("faded")) {
            ball.classList.remove("faded");
            ballState[pending] = false;
            setStorageItem("ballState", JSON.stringify(ballState));
            bc.postMessage({ resetBall: pending });
        }
    }
}

/**
 * Straight Pool: each pot adds 1 to primary Balls for the Active Player.
 * Does not reset the tracker (see postScore skip for game4).
 */
function creditStraightPoolPot(ballId) {
    const player = getActivePlayerSlot();
    postScore("add", player);
    const owners = getPocketBallOwners();
    owners[ballId] = player;
    setPocketBallOwners(owners);
    pushScoringUndo({ type: "straightPot", player: player, ballId: ballId });
}

/**
 * Unclicking a Straight Pool ball deducts 1 Ball from the credited player.
 */
function debitStraightPoolUnpot(ballId) {
    const owners = getPocketBallOwners();
    const player = owners[ballId] || getActivePlayerSlot();
    delete owners[ballId];
    setPocketBallOwners(owners);

    const current = parseInt(getStorageItem("p" + player + "ScoreCtrlPanel"), 10) || 0;
    if (current > 0) {
        postScore("sub", player);
    }
}

/**
 * 14.1: when only one object ball remains on the tracker, re-enable the pocketed
 * balls (re-rack) without changing scores.
 */
function maybeStraightPoolRerack() {
    if (!isStraightPool()) {
        return;
    }
    const balls = Array.from(document.querySelectorAll(".ballTracker .ball")).filter(function (ball) {
        return !ball.classList.contains("noShow");
    });
    if (balls.length < 2) {
        return;
    }
    const remaining = balls.filter(function (ball) {
        return !ball.classList.contains("faded");
    });
    if (remaining.length !== 1) {
        return;
    }

    const ballState = JSON.parse(getStorageItem("ballState") || "{}");
    const owners = getPocketBallOwners();
    let restored = 0;

    balls.forEach(function (ball) {
        if (!ball.classList.contains("faded")) {
            return;
        }
        ball.classList.remove("faded");
        ballState[ball.id] = false;
        delete owners[ball.id];
        bc.postMessage({ resetBall: ball.id });
        restored += 1;
    });

    if (restored > 0) {
        setStorageItem("ballState", JSON.stringify(ballState));
        setPocketBallOwners(owners);
        console.log("Straight Pool: re-rack — restored " + restored + " balls (one remaining)");
        maybeShowRackBreakerPickerAfterRackChange();
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
    console.log(`Display active player ${checkbox ? "enabled" : "disabled"}`);
    if (checkbox) {
        if (isBallTrackerControlsVisible()) {
            document.getElementById("playerToggle").classList.remove("noShow");
        }
        setStorageItem("usePlayerToggle", "yes");
        const activePlayer = getActivePlayerSlot() === "1";
        bc.postMessage({ clockDisplay: 'showActivePlayer', player: activePlayer });
        syncPlayerSlotPickerUI();
        console.log(`Player ${activePlayer ? 1 : 2} is active`);
    } else {
        document.getElementById("playerToggle").classList.add("noShow");
        // document.getElementById("playerToggleLabel").classList.add("noShow");
        setStorageItem("usePlayerToggle", "no");
        bc.postMessage({ clockDisplay: 'hideActivePlayer' });
    }
    syncActivePlayerRequiredForBallTracker();
    updatePlayerBallControlVisibility();
    syncRackBreakerPlayerToggleVisibility();
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
    }
}

function setPlayerDetailSectionVisibility(player, visible) {
    const label = document.getElementById("player" + player + "DetailLabel");
    const details = document.getElementById("player" + player + "Details");
    const action = visible ? "remove" : "add";
    if (label) {
        label.classList[action]("noShow");
    }
    if (details) {
        details.classList[action]("noShow");
    }
}

function playerSetting(player) {
    var usePlayerSetting = document.getElementById("usePlayer" + player + "Setting");
    var isChecked = usePlayerSetting.checked;
    var storageValue = isChecked ? "yes" : "no";
    var usePlayer = isChecked ? "showPlayer" : "hidePlayer";

    setStorageItem("usePlayer" + player, storageValue);

    setPlayerDetailSectionVisibility(player, isChecked);

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
    const ballSetCheckbox = document.getElementById("ballSetCheckbox");

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

        if (ballSetCheckbox) {
            ballSetCheckbox.disabled = true;
            ballSetCheckbox.checked = false;
        }
        document.getElementById("ballSet").classList.add("noShow");
        setStorageItem("useBallSet", "no");

        document.getElementById("ballSelection").disabled = true;

        resetBallSet()

        // Hide related elements
        document.getElementById("clockInfo").classList.add("noShow");
        document.getElementById("extensionControls").classList.add("noShow");
        document.getElementById("clockControlLabel").classList.add("noShow");
        document.getElementById("playerToggle").classList.add("noShow");
        document.getElementById("playerToggleLabel").classList.add("noShow");
        document.getElementById("playerTrackingBlock")?.classList.add("noShow");
        document.getElementById("ballTrackerDirectionDiv").classList.add("noShow");
        getBallTrackerPanel()?.classList.add("noShow");

        // Send messages to hide these features
        bc.postMessage({ clockDisplay: 'noClock' });
        bc.postMessage({ clockDisplay: 'hideActivePlayer' });
        bc.postMessage({ displayBallTracker: false });
    } else {
        // Enable the checkboxes
        clockCheckbox.disabled = false;
        toggleCheckbox.disabled = false;
        ballTrackerCheckbox.disabled = false;
        if (ballSetCheckbox) {
            ballSetCheckbox.disabled = false;
        }
        document.getElementById("ballSelection").disabled = false;
        syncBallDisplayControls();
        syncControlsTabLayout();
        syncBallSetControlsVisibility();
        syncActivePlayerRequiredForBallTracker();
    }

    // Show/hide  elements based on individual players being enabled
    document.getElementById("logoName").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("customLogo1").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("uploadCustomLogo").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("logoName2").classList[player2Enabled ? "remove" : "add"]("noShow");
    document.getElementById("customLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");
    document.getElementById("uploadCustomLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");

    // Hide shared elements when both players are disabled
    document.getElementById("raceInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfoTxt").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");

    // Hide Race info when any player is disabled
    document.getElementById("raceInfo").classList[anyPlayerDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfoTxt").classList[anyPlayerDisabled ? "add" : "remove"]("noShow");

    bc.postMessage({ playerDisplay: usePlayer, playerNumber: player });

    // updateTabVisibility();
    //Hide/Show based on both players enabled
    document.getElementById("swapBtn").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    syncScoreDisplayDependentUI();
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
    syncScoreDisplayDependentUI();

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

function resetCurrentGame(options) {
    const skipStatsAbandon = !!(options && options.skipStatsAbandon);

    console.log("Resetting current game");
    if (!skipStatsAbandon && window.PlayerStats) {
        window.PlayerStats.onClearGame().catch(function (err) {
            console.error("PlayerStats onClearGame error:", err);
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
    clearAllScoringUndoHistory();
    postNames();
    pushScores();
    postInfo();
}

function clearGame() {
    const confirmed = confirm("Are you sure you wish to clear player, score, and game information?");
    if (!confirmed) {
        return;
    }
    resetCurrentGame();
}
window.resetCurrentGame = resetCurrentGame;

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

let scoreFieldsHaveManualEntry = false;

function markScoreFieldsDirty() {
    scoreFieldsHaveManualEntry = true;
    updatePushScoresButtonVisibility();
}

function clearScoreFieldsDirty() {
    scoreFieldsHaveManualEntry = false;
    updatePushScoresButtonVisibility();
}

function updatePushScoresButtonVisibility() {
    const wrap = document.getElementById("pushScoresWrap");
    if (!wrap) {
        return;
    }
    wrap.classList.toggle("noShow", !scoreFieldsHaveManualEntry);
}

function initPushScoresFieldListeners() {
    ["p1Score", "p2Score", "p1Balls", "p2Balls"].forEach(function (id) {
        const el = document.getElementById(id);
        if (!el || el.dataset.pushListenBound === "1") {
            return;
        }
        el.dataset.pushListenBound = "1";
        el.addEventListener("input", markScoreFieldsDirty);
        el.addEventListener("change", markScoreFieldsDirty);
    });
    updatePushScoresButtonVisibility();
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
    syncRackBreakerPickerVisibility();
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
    if (window.PlayerStats && typeof window.PlayerStats.syncActiveMatchGameInfoFromUI === "function") {
        window.PlayerStats.syncActiveMatchGameInfoFromUI();
    }
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
    clearScoreFieldsDirty();
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
    if (ballsChanged) {
        clearScoreFieldsDirty();
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
    // Straight Pool keeps per-ball owners across primary score changes for unclick undo.
    if (!isStraightPool()) {
        clearPocketBallOwners();
    }
}

function postScore(opt1, player, options) {
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
    const skipTrackerReset = !!(options && options.skipTrackerReset) || isStraightPool();

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
        maybeShowRackBreakerPickerAfterRackChange();
    } else if (!isSnooker() && !skipTrackerReset) {
        // Straight Pool and tracker rack-win keep/partially keep tracker state.
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
                    // Tracker rack win/loss already prompted for the next breaker; skipping
                    // avoids clobbering Active Player after a quick Undo of that rack.
                    if (!skipTrackerReset) {
                        maybeShowRackBreakerPickerAfterRackChange();
                    }
                }).catch(function (err) {
                    console.error('PlayerStats recordRackWin error:', err);
                });
            }
        } else {
            window.PlayerStats.undoLastRack(player).then(function () {
                updateCallGameButton();
                updateScoreControlAvailability();
                if (!skipTrackerReset) {
                    maybeShowRackBreakerPickerAfterRackChange();
                }
            }).catch(function (err) {
                console.error('PlayerStats undoLastRack error:', err);
            });
        }
    }
    if (scoreChanged) {
        clearScoreFieldsDirty();
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
    const activePlayer = isChecked;
    const playerSlot = isChecked ? "1" : "2";
    noteRackOpponentVisitForSlot(playerSlot);
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
    syncPlayerSlotPickerUI();
    if (isSnookerBallMode()) {
        // Visit ended — keep frame high breaks, reds-potted count, and undo history.
        const foulAwaiting = getSnookerFoulAwaitingPlayerChange();
        endSnookerBreak();
        resetSnookerSequenceState({
            keepReds: true,
            keepBreaks: true,
            keepFrameHighs: true,
            keepUndoStack: true
        });
        // Free Ball is only offered to the incoming player after a foul + player change.
        if (foulAwaiting) {
            setSnookerFreeBallOffered(true);
            updateSnookerBallAvailability();
        }
        updateSnookerUndoButton();
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
            message: "End this match early and keep completed racks/frames in match history? Scores will clear after saving. Please note, this is not ending the frame, this is the entire match, to complete a frame score it for the appropriate player.",
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

function restoreRackBreakerPromptAfterScoreReset() {
    if (!isRackBreakerPromptEnabled()) {
        return;
    }
    clearRackBreakerState(true);
    syncRackBreakerPickerVisibility();
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
        clearAllScoringUndoHistory();

        // Send update to stream sharing if enabled
        if (window.streamSharing) {
            window.streamSharing.sendUpdate();
        }

        if (window.PlayerStats) {
            // End Match / Call Match Early keeps recorded stats; mid-match Reset Score undoes the open session.
            const opts = endMatch ? { endMatch: true } : undefined;
            window.PlayerStats.onResetScores(opts).then(function () {
                updateScoreControlAvailability();
                restoreRackBreakerPromptAfterScoreReset();
            }).catch(function (err) {
                console.error('PlayerStats onResetScores error:', err);
                updateScoreControlAvailability();
                restoreRackBreakerPromptAfterScoreReset();
            });
        } else {
            updateScoreControlAvailability();
            restoreRackBreakerPromptAfterScoreReset();
        }

        clearScoreFieldsDirty();
}

function resetBallSet() {
    setStorageItem("playerBallSet", "p1Open");
    document.getElementById('p1colorOpen').checked = true;
    bc.postMessage({ playerBallSet: "p1Open" });
}

function resetBallTracker() {
    clearTrackerRackWinCooldownTimer();
    clearEarlyGameBallRejectCooldown();
    // Retrieve the saved ball state from localStorage
    let ballState = JSON.parse(getStorageItem('ballState') || '{}');

    // Select ball elements in the tracker grid (not foul-modal targets)
    const ballElements = document.querySelectorAll("#ballTrackerDiv .ball");

    ballElements.forEach(function (ball) {
        // Remove the 'faded' class to reset the ball
        ball.classList.remove('faded');
        ball.classList.remove('ball-win-cooldown');
        ball.removeAttribute('aria-disabled');

        // Update the ball state to false (not faded)
        ballState[ball.id] = false;
        bc.postMessage({ resetBall: ball.id });
    });

    // Save the updated state back to localStorage
    setStorageItem('ballState', JSON.stringify(ballState));
    clearPocketBallOwners();
    clearTrackerRackWinPending();

    console.log("All balls have been reset in ball tracker.");
    restoreRackBreakerPromptAfterScoreReset();
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

const DEFAULT_GAME_TYPE = "game1";
const VALID_GAME_TYPES = ["game1", "game2", "game3", "game4", "game5", "game6", "game7", "game8"];
const GAME_TYPE_SELECT_ID = "gameTypeSelect";

function normalizeGameType(value) {
    return VALID_GAME_TYPES.includes(value) ? value : DEFAULT_GAME_TYPE;
}

function getStoredGameType() {
    return normalizeGameType(getStorageItem("gameType") || "");
}

function ensureDefaultGameType() {
    const stored = getStorageItem("gameType");
    const normalized = normalizeGameType(stored || "");
    if (stored !== normalized) {
        setStorageItem("gameType", normalized);
    }
    return normalized;
}

const STATS_PROTECTED_KEYS = ['overlayStatsMode', 'overlayStatsPayload', 'statsVisibility', 'statsVisibilityGameType'];

function isStatsProtectedKey(key) {
    if (!key) {
        return false;
    }
    return STATS_PROTECTED_KEYS.some(function (protectedKey) {
        return key === protectedKey || key.endsWith('_' + protectedKey);
    });
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
// cuesport_stats IndexedDB is never cleared here — only via Stats tab Clear.
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
            if (key.startsWith(instanceId) && !isStatsProtectedKey(key)) {
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

    toggleReplayClipsVisibility();
    const clipsVisible = !document.getElementById("replayClips").classList.contains("noShow");
    document.getElementById("savedPathNote").classList.toggle("noShow", !clipsVisible);
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