'use strict';

/**
 * Stream promotion for CueSport Scoreboard.
 * Listing flags ride on CueSport Cloud join/state — no separate WebSocket.
 * Requires Cloud connected + OBS live + a valid manual stream URL.
 */
(function() {
    const STORAGE_PREFIX = 'streamSharing_';

    let isEnabled = false;
    let isObsStreaming = false;
    let streamingCheckInterval = null;
    let publishGeneration = 0;

    function getStorageItem(key) {
        const prefixedKey = STORAGE_PREFIX + key;
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        const fullKey = instanceId ? `${instanceId}_${prefixedKey}` : prefixedKey;
        return localStorage.getItem(fullKey);
    }

    function setStorageItem(key, value) {
        const prefixedKey = STORAGE_PREFIX + key;
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        const fullKey = instanceId ? `${instanceId}_${prefixedKey}` : prefixedKey;
        localStorage.setItem(fullKey, value);
    }

    function isCloudReady() {
        return !!(
            window.cloudRelay &&
            typeof window.cloudRelay.isEnabled === 'function' &&
            window.cloudRelay.isEnabled() &&
            typeof window.cloudRelay.isConnected === 'function' &&
            window.cloudRelay.isConnected()
        );
    }

    function isCloudEnabled() {
        return !!(
            window.cloudRelay &&
            typeof window.cloudRelay.isEnabled === 'function' &&
            window.cloudRelay.isEnabled()
        );
    }

    function isValidStreamUrl(urlString) {
        if (!urlString || typeof urlString !== 'string') {
            return false;
        }

        const trimmed = urlString.trim();
        if (!trimmed || trimmed.length < 10) {
            return false;
        }

        if (!trimmed.match(/^https?:\/\//i)) {
            return false;
        }

        try {
            const url = new URL(trimmed);

            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return false;
            }

            if (!url.hostname || url.hostname.length === 0) {
                return false;
            }

            if (!url.hostname.match(/^localhost(:\d+)?$|^\[?[\da-fA-F:]+\]?$/) && !url.hostname.includes('.')) {
                return false;
            }

            if (url.hostname.match(/[\s<>"{}|\\^`\[\]]/)) {
                return false;
            }

            if (url.href === url.protocol + '//' || url.href === url.protocol + '///') {
                return false;
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    function getManualStreamUrl() {
        const modalInput = document.getElementById('manualStreamUrlModal');
        if (modalInput && modalInput.value) {
            const manualUrl = String(modalInput.value).trim();
            if (manualUrl && isValidStreamUrl(manualUrl)) {
                return manualUrl;
            }
        }
        const saved = getStorageItem('manualStreamUrl');
        if (saved && isValidStreamUrl(saved)) {
            return saved;
        }
        return '';
    }

    async function getStreamUrl() {
        const manualUrl = getManualStreamUrl();
        if (manualUrl) {
            return manualUrl;
        }

        try {
            if (typeof obs === 'undefined' || !obs || typeof isObsReady === 'undefined' || !isObsReady) {
                return '';
            }

            try {
                const serviceSettings = await obs.call('GetStreamServiceSettings');
                const serviceType = serviceSettings.streamServiceType || '';
                const settings = serviceSettings.streamServiceSettings || {};
                let streamUrl = '';

                if (serviceType.toLowerCase().includes('twitch')) {
                    const channel = settings.channel || settings.key || '';
                    const cleanChannel = channel.replace(/^@/, '');
                    if (cleanChannel) {
                        streamUrl = `https://www.twitch.tv/${cleanChannel}`;
                    }
                } else if (serviceType.toLowerCase().includes('youtube')) {
                    const streamKey = settings.key || settings.stream_key || '';
                    if (streamKey) {
                        streamUrl = 'https://www.youtube.com/live';
                    }
                } else if (serviceType.toLowerCase().includes('facebook')) {
                    streamUrl = 'https://www.facebook.com/live';
                } else if (serviceType.includes('rtmp')) {
                    const server = settings.server || '';
                    if (server.includes('twitch.tv')) {
                        const channel = settings.key || '';
                        if (channel) {
                            const cleanChannel = channel.replace(/^@/, '');
                            streamUrl = `https://www.twitch.tv/${cleanChannel}`;
                        }
                    } else if (server.includes('youtube.com') || server.includes('googlevideo.com')) {
                        streamUrl = 'https://www.youtube.com/live';
                    }
                }

                if (streamUrl && isValidStreamUrl(streamUrl)) {
                    return streamUrl;
                }
                return '';
            } catch (error) {
                console.warn('Could not get stream service settings:', error);
                return '';
            }
        } catch (error) {
            console.warn('Error getting stream URL:', error);
            return '';
        }
    }

    function invalidatePendingPublishes() {
        publishGeneration += 1;
        if (window.cloudRelay && typeof window.cloudRelay.invalidatePendingState === 'function') {
            window.cloudRelay.invalidatePendingState();
        }
    }

    function readScoreInt(storageKey, inputId, storagePrefix) {
        // Storage is authoritative for cloud sync — DOM can lag mid-update.
        const fromStorage = parseInt(localStorage.getItem(`${storagePrefix}${storageKey}`) || localStorage.getItem(storageKey) || '0', 10);
        if (!Number.isNaN(fromStorage)) {
            return fromStorage;
        }
        const el = document.getElementById(inputId);
        return el ? (parseInt(el.value, 10) || 0) : 0;
    }

    async function collectGameState() {
        const getValue = (id, defaultValue = '') => {
            const el = document.getElementById(id);
            return el ? (el.value || defaultValue) : defaultValue;
        };

        const getStorage = (key, defaultValue = '') => {
            try {
                const val = localStorage.getItem(key);
                return val !== null ? val : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        };

        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        const storagePrefix = instanceId ? `${instanceId}_` : '';

        const scoreSnapshot = {
            player1Name: getValue('p1Name', '') || getStorage(`${storagePrefix}p1NameCtrlPanel`, ''),
            player2Name: getValue('p2Name', '') || getStorage(`${storagePrefix}p2NameCtrlPanel`, ''),
            p1Score: readScoreInt('p1ScoreCtrlPanel', 'p1Score', storagePrefix),
            p2Score: readScoreInt('p2ScoreCtrlPanel', 'p2Score', storagePrefix),
            p1Balls: readScoreInt('p1BallsCtrlPanel', 'p1Balls', storagePrefix),
            p2Balls: readScoreInt('p2BallsCtrlPanel', 'p2Balls', storagePrefix),
            pointBased: getStorage(`${storagePrefix}pointBased`, 'no'),
            gameType: getStorage(`${storagePrefix}gameType`, 'game1'),
            raceInfo: getValue('raceInfoTxt', '') || getStorage(`${storagePrefix}raceInfo`, ''),
            gameInfo: getValue('gameInfoTxt', '') || getStorage(`${storagePrefix}gameInfo`, ''),
        };

        const streamUrl = await getStreamUrl();
        const validatedUrl = isValidStreamUrl(streamUrl) ? streamUrl : '';

        const player1Setting = String(getStorage(`${storagePrefix}usePlayer1`, getStorage('usePlayer1', 'yes')) || 'yes').toLowerCase();
        const player2Setting = String(getStorage(`${storagePrefix}usePlayer2`, getStorage('usePlayer2', 'yes')) || 'yes').toLowerCase();
        const player1Enabled = !(player1Setting === 'no' || player1Setting === 'false' || player1Setting === '0');
        const player2Enabled = !(player2Setting === 'no' || player2Setting === 'false' || player2Setting === '0');

        const scoreDisplaySetting = String(getStorage(`${storagePrefix}scoreDisplay`, getStorage('scoreDisplay', 'yes')) || 'yes').toLowerCase();
        const scoreDisplay = !(scoreDisplaySetting === 'no' || scoreDisplaySetting === 'false' || scoreDisplaySetting === '0');

        const ballTrackerSetting = String(getStorage(`${storagePrefix}enableBallTracker`, getStorage('enableBallTracker', 'no')) || 'no').toLowerCase();
        const ballDisplaySetting = String(getStorage(`${storagePrefix}enableBallDisplay`, getStorage('enableBallDisplay', 'no')) || 'no').toLowerCase();
        const shotClockSetting = String(getStorage(`${storagePrefix}useClock`, getStorage('useClock', 'no')) || 'no').toLowerCase();
        const ballTrackerEnabled = ballTrackerSetting === 'yes' || ballTrackerSetting === 'true' || ballTrackerSetting === '1';
        const ballDisplayEnabled = ballDisplaySetting === 'yes' || ballDisplaySetting === 'true' || ballDisplaySetting === '1';
        const shotClockEnabled = shotClockSetting === 'yes' || shotClockSetting === 'true' || shotClockSetting === '1';

        const breakingPlayerSetting = String(getStorage(`${storagePrefix}usePlayerToggle`, getStorage('usePlayerToggle', 'no')) || 'no').toLowerCase();
        const breakingPlayerEnabled = breakingPlayerSetting === 'yes' || breakingPlayerSetting === 'true' || breakingPlayerSetting === '1';

        const ballSelection = String(getStorage(`${storagePrefix}ballSelection`, getStorage('ballSelection', 'american')) || 'american').toLowerCase();
        let ballType = 'World';
        if (ballSelection === 'international') {
            ballType = 'International';
        } else if (ballSelection === 'unity') {
            ballType = 'Unity';
        } else if (ballSelection === 'ultimate') {
            ballType = 'Ultimate';
        } else if (ballSelection === 'snooker') {
            ballType = 'Snooker';
        }

        return {
            ...scoreSnapshot,
            streamUrl: validatedUrl,
            player1Enabled,
            player2Enabled,
            scoreDisplay,
            ballTrackerEnabled,
            ballDisplayEnabled,
            shotClockEnabled,
            breakingPlayerEnabled,
            ballType,
            timestamp: new Date().toISOString()
        };
    }

    async function sendGameState() {
        const gen = publishGeneration;
        try {
            if (!isCloudEnabled()) {
                return false;
            }
            const state = await collectGameState();
            if (gen !== publishGeneration) {
                return false;
            }
            return window.cloudRelay.sendState(state);
        } catch (error) {
            console.error('Error sending game state:', error);
            return false;
        }
    }

    /** Push listing state through Cloud; never opens a separate socket. */
    function publishPromotionState() {
        if (!isCloudEnabled()) {
            return;
        }
        if (typeof window.cloudRelay.pushDockStateSoon === 'function') {
            window.cloudRelay.pushDockStateSoon();
            return;
        }
        sendGameState();
    }

    function canUseStreamPromotion() {
        return isCloudEnabled() && !!isObsStreaming;
    }

    function promotionUnavailableReason() {
        if (!isCloudEnabled()) {
            return 'Enable CueSport Cloud (with an OBS Dock Key) to promote your stream';
        }
        if (!isCloudReady()) {
            return 'CueSport Cloud must be connected before promoting';
        }
        if (!isObsStreaming) {
            return 'OBS must be live streaming to promote your stream';
        }
        return '';
    }

    function updateStreamPromotionToggle() {
        const toggle = document.getElementById('streamPromotionToggle');
        if (!toggle) return;

        const usable = canUseStreamPromotion();
        toggle.disabled = !usable;
        toggle.checked = !!isEnabled;

        const switchLabel = toggle.closest('label.switch, label.toggle');
        if (switchLabel) {
            switchLabel.classList.toggle('toggle-disabled', !usable);
            const reason = promotionUnavailableReason();
            if (reason) {
                switchLabel.title = reason;
            } else {
                switchLabel.removeAttribute('title');
            }
        }

        const row = document.getElementById('streamPromotionRow');
        if (row) {
            row.classList.toggle('stream-promotion-unavailable', !usable);
        }
    }

    function updateStreamSharingVisibility() {
        updateStreamPromotionToggle();
        const section = document.getElementById('streamSharingLabel');
        if (!section) return;

        // Match replay-source disabled opacity (single 0.6 pass; cog stays fully opaque).
        const usable = canUseStreamPromotion();
        section.style.setProperty('opacity', usable ? '1' : '0.6', 'important');
    }

    function clearPromotionEnabled() {
        isEnabled = false;
        setStorageItem('enabled', 'false');
        setStorageItem('streamPromotionEnabled', 'false');
    }

    function handleStreamingStopped() {
        if (isEnabled) {
            clearPromotionEnabled();
        }
        updateStreamPromotionToggle();
        updateStreamSharingVisibility();
        publishPromotionState();
    }

    async function checkObsStreamingStatus() {
        try {
            if (typeof obs === 'undefined' || !obs || typeof isObsReady === 'undefined' || !isObsReady) {
                const wasStreaming = isObsStreaming;
                isObsStreaming = false;
                if (wasStreaming) {
                    handleStreamingStopped();
                } else {
                    updateStreamPromotionToggle();
                    updateStreamSharingVisibility();
                }
                return;
            }

            try {
                const status = await obs.call('GetStreamStatus');
                const wasStreaming = isObsStreaming;
                isObsStreaming = status.outputActive === true;

                if (wasStreaming && !isObsStreaming) {
                    handleStreamingStopped();
                }

                if (!wasStreaming && isObsStreaming) {
                    if (isEnabled) {
                        publishPromotionState();
                    }
                }

                updateStreamPromotionToggle();
                updateStreamSharingVisibility();
            } catch (error) {
                console.warn('Could not check OBS streaming status:', error);
                if (isObsStreaming) {
                    handleStreamingStopped();
                }
                isObsStreaming = false;
                updateStreamPromotionToggle();
                updateStreamSharingVisibility();
            }
        } catch (error) {
            console.warn('Error checking OBS streaming status:', error);
            if (isObsStreaming) {
                handleStreamingStopped();
            }
            isObsStreaming = false;
            updateStreamPromotionToggle();
            updateStreamSharingVisibility();
        }
    }

    function toggleStreamPromotion() {
        const toggle = document.getElementById('streamPromotionToggle');
        if (!toggle) return;

        if (toggle.disabled || !canUseStreamPromotion()) {
            toggle.checked = !!isEnabled;
            updateStreamPromotionToggle();
            const reason = promotionUnavailableReason();
            if (reason) {
                alert(reason);
            }
            return;
        }

        if (toggle.checked) {
            if (!isCloudReady()) {
                toggle.checked = false;
                alert('CueSport Cloud must be connected before promoting. Enable CueSport Cloud and wait until it is joined.');
                updateStreamPromotionToggle();
                return;
            }

            const streamUrl = getManualStreamUrl();
            if (!streamUrl) {
                toggle.checked = false;
                openStreamPromotionSettingsModal();
                return;
            }

            if (!isObsStreaming) {
                toggle.checked = false;
                alert('OBS must be streaming to share your game data.');
                return;
            }

            isEnabled = true;
            setStorageItem('enabled', 'true');
            setStorageItem('streamPromotionEnabled', 'true');
            updateStreamPromotionToggle();
            updateStreamSharingVisibility();
            publishPromotionState();
        } else {
            clearPromotionEnabled();
            updateStreamPromotionToggle();
            updateStreamSharingVisibility();
            publishPromotionState();
        }
    }

    function init() {
        const savedEnabled = getStorageItem('streamPromotionEnabled') === 'true' || getStorageItem('enabled') === 'true';
        isEnabled = savedEnabled;

        updateStreamPromotionToggle();
        updateStreamSharingVisibility();

        checkObsStreamingStatus();

        if (streamingCheckInterval) {
            clearInterval(streamingCheckInterval);
        }
        streamingCheckInterval = setInterval(checkObsStreamingStatus, 2000);

        if (typeof window !== 'undefined') {
            let lastObsReady = false;
            const obsReadyCheck = setInterval(() => {
                if (typeof isObsReady !== 'undefined' && isObsReady !== lastObsReady) {
                    lastObsReady = isObsReady;
                    if (isObsReady) {
                        checkObsStreamingStatus();
                    }
                }
            }, 500);

            window.addEventListener('beforeunload', () => {
                if (streamingCheckInterval) clearInterval(streamingCheckInterval);
                clearInterval(obsReadyCheck);
            });
        }

        if (isEnabled) {
            const streamUrl = getManualStreamUrl();
            if (!streamUrl) {
                clearPromotionEnabled();
                const toggle = document.getElementById('streamPromotionToggle');
                if (toggle && toggle.checked) {
                    toggle.checked = false;
                    openStreamPromotionSettingsModal();
                }
            } else {
                setTimeout(() => {
                    if (isEnabled && isObsStreaming && isCloudReady()) {
                        publishPromotionState();
                    }
                }, 500);
            }
        }
    }

    function openStreamPromotionSettingsModal() {
        const modal = document.getElementById('streamPromotionSettingsModal');
        if (!modal) return;

        const urlInput = document.getElementById('manualStreamUrlModal');
        if (urlInput) {
            const saved = getStorageItem('manualStreamUrl');
            urlInput.value = saved || '';
        }

        modal.style.display = 'block';
    }

    function closeStreamPromotionSettingsModal() {
        const modal = document.getElementById('streamPromotionSettingsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    function saveStreamPromotionSettings() {
        const urlInput = document.getElementById('manualStreamUrlModal');
        if (!urlInput) return;

        const url = urlInput.value.trim();

        if (url && !isValidStreamUrl(url)) {
            alert('Please enter a valid URL starting with http:// or https://');
            urlInput.focus();
            return;
        }

        setStorageItem('manualStreamUrl', url || '');
        closeStreamPromotionSettingsModal();

        if (isEnabled && isObsStreaming && isCloudReady()) {
            publishPromotionState();
        }

        updateStreamPromotionToggle();
        updateStreamSharingVisibility();
    }

    window.openStreamPromotionSettingsModal = openStreamPromotionSettingsModal;
    window.closeStreamPromotionSettingsModal = closeStreamPromotionSettingsModal;
    window.saveStreamPromotionSettings = saveStreamPromotionSettings;
    window.toggleStreamPromotion = toggleStreamPromotion;

    window.streamSharing = {
        sendUpdate: function() {
            if (isCloudEnabled()) {
                sendGameState();
            }
        },

        invalidatePendingPublishes: invalidatePendingPublishes,

        isEnabled: function() {
            return isEnabled;
        },

        isConnected: function() {
            return isEnabled && isCloudReady();
        },

        getPromotionListingState: function() {
            const promotionOn = getStorageItem('streamPromotionEnabled') === 'true';
            const manualUrl = getManualStreamUrl();
            const streamUrl = isValidStreamUrl(manualUrl) ? manualUrl : '';
            return {
                listed: promotionOn && isObsStreaming && !!streamUrl,
                obsStreaming: isObsStreaming,
                streamUrl: streamUrl,
            };
        },

        /** Called when OBS WebSocket disconnects — clear promotion listing. */
        disconnect: function() {
            if (isEnabled) {
                clearPromotionEnabled();
                updateStreamPromotionToggle();
                updateStreamSharingVisibility();
                publishPromotionState();
            }
        },

        /** Refresh toggle when Cloud connect/disconnect changes availability. */
        refreshUi: function() {
            updateStreamPromotionToggle();
            updateStreamSharingVisibility();
        },

        toggle: toggleStreamPromotion,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
