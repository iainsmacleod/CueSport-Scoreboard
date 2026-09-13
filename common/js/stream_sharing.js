'use strict';

/**
 * Stream promotion for CueSport Scoreboard.
 * Listing flags ride on CueSport Cloud join/state — no separate WebSocket.
 * Requires Cloud connected + OBS live + a stream URL (OBS auto-detect first, manual failover).
 */
(function() {
    const STORAGE_PREFIX = 'streamSharing_';

    let isEnabled = false;
    let isObsStreaming = false;
    let streamingCheckInterval = null;
    let publishGeneration = 0;
    let lastPromotionHeartbeatAt = 0;
    /** Last URL derived from OBS GetStreamServiceSettings (sync path for cloud listing). */
    let cachedObsStreamUrl = '';
    const PROMOTION_HEARTBEAT_MS = 45000;

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

    /** Sync effective URL: cached OBS detect first, then saved/manual failover. */
    function resolveEffectiveStreamUrlSync() {
        if (cachedObsStreamUrl && isValidStreamUrl(cachedObsStreamUrl)) {
            return cachedObsStreamUrl;
        }
        return getManualStreamUrl();
    }

    /** Derive a public watch URL from OBS stream service settings when possible. */
    async function detectStreamUrlFromObs() {
        try {
            if (typeof obs === 'undefined' || !obs || typeof isObsReady === 'undefined' || !isObsReady) {
                return '';
            }
            const serviceSettings = await obs.call('GetStreamServiceSettings');
            const serviceType = String(serviceSettings.streamServiceType || '');
            const settings = serviceSettings.streamServiceSettings || {};
            const typeLower = serviceType.toLowerCase();
            let streamUrl = '';

            if (typeLower.includes('twitch')) {
                const channel = settings.channel || settings.key || '';
                const cleanChannel = String(channel).replace(/^@/, '').trim();
                if (cleanChannel && !cleanChannel.includes('live_') && !cleanChannel.includes(':')) {
                    streamUrl = `https://www.twitch.tv/${cleanChannel}`;
                }
            } else if (typeLower.includes('youtube')) {
                const channel = settings.channel || settings.channel_id || settings.channelId || '';
                const cleanChannel = String(channel).replace(/^@/, '').trim();
                if (cleanChannel) {
                    streamUrl = cleanChannel.startsWith('UC')
                        ? `https://www.youtube.com/channel/${cleanChannel}/live`
                        : `https://www.youtube.com/@${cleanChannel}/live`;
                } else if (settings.key || settings.stream_key) {
                    // Stream key alone is not a public watch URL — keep generic live hub as last resort.
                    streamUrl = 'https://www.youtube.com/live';
                }
            } else if (typeLower.includes('facebook')) {
                streamUrl = 'https://www.facebook.com/live';
            } else if (typeLower.includes('kick')) {
                const channel = settings.channel || settings.key || '';
                const cleanChannel = String(channel).replace(/^@/, '').trim();
                if (cleanChannel) {
                    streamUrl = `https://kick.com/${cleanChannel}`;
                }
            } else if (typeLower.includes('rtmp') || serviceType.includes('rtmp')) {
                const server = String(settings.server || '');
                if (server.includes('twitch.tv')) {
                    const channel = settings.channel || settings.key || '';
                    const cleanChannel = String(channel).replace(/^@/, '').trim();
                    if (cleanChannel && !cleanChannel.includes('live_') && !cleanChannel.includes(':')) {
                        streamUrl = `https://www.twitch.tv/${cleanChannel}`;
                    }
                } else if (server.includes('youtube.com') || server.includes('googlevideo.com')) {
                    streamUrl = 'https://www.youtube.com/live';
                } else if (server.includes('kick.com')) {
                    const channel = settings.channel || settings.key || '';
                    const cleanChannel = String(channel).replace(/^@/, '').trim();
                    if (cleanChannel) {
                        streamUrl = `https://kick.com/${cleanChannel}`;
                    }
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
    }

    async function refreshObsDetectedStreamUrl() {
        const fromObs = await detectStreamUrlFromObs();
        cachedObsStreamUrl = fromObs || '';
        return cachedObsStreamUrl;
    }

    /** OBS auto-detect first; manual/saved URL only if OBS cannot provide one. */
    async function getStreamUrl() {
        try {
            const fromObs = await refreshObsDetectedStreamUrl();
            if (fromObs) {
                return fromObs;
            }
        } catch (error) {
            console.warn('Error getting stream URL from OBS:', error);
            cachedObsStreamUrl = '';
        }
        return getManualStreamUrl();
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

    function shouldListPromotion() {
        return !!(isEnabled && isObsStreaming && isCloudReady() && resolveEffectiveStreamUrlSync());
    }

    function maybeHeartbeatPromotionListing() {
        if (!shouldListPromotion()) return;
        const now = Date.now();
        if (now - lastPromotionHeartbeatAt < PROMOTION_HEARTBEAT_MS) return;
        lastPromotionHeartbeatAt = now;
        publishPromotionState();
    }

    function republishPromotionIfActive() {
        if (!shouldListPromotion()) return;
        lastPromotionHeartbeatAt = Date.now();
        publishPromotionState();
    }

    function canUseStreamPromotion() {
        return isCloudEnabled() && !!isObsStreaming;
    }

    function promotionUnavailableReason() {
        if (!isCloudEnabled()) {
            return 'Enable CueSport Scoreboard Cloud (with an OBS Dock Key) to promote your stream';
        }
        if (!isCloudReady()) {
            return 'CueSport Scoreboard Cloud must be connected before promoting';
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

    function handleStreamingStopped({ clearPreference = true } = {}) {
        if (clearPreference && isEnabled) {
            clearPromotionEnabled();
        }
        updateStreamPromotionToggle();
        updateStreamSharingVisibility();
        publishPromotionState();
    }

    async function checkObsStreamingStatus() {
        try {
            if (typeof obs === 'undefined' || !obs || typeof isObsReady === 'undefined' || !isObsReady) {
                cachedObsStreamUrl = '';
                const wasStreaming = isObsStreaming;
                isObsStreaming = false;
                if (wasStreaming) {
                    // OBS socket dropped briefly — pause listing, keep the user's toggle preference.
                    handleStreamingStopped({ clearPreference: false });
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
                await refreshObsDetectedStreamUrl();

                if (wasStreaming && !isObsStreaming) {
                    // Confirmed stream end — turn promotion off so the next go-live is opt-in.
                    handleStreamingStopped({ clearPreference: true });
                } else if (!wasStreaming && isObsStreaming) {
                    if (isEnabled) {
                        publishPromotionState();
                    }
                } else if (isEnabled && isObsStreaming) {
                    // Keep live_streams.updated_at fresh while idle between scoring events.
                    maybeHeartbeatPromotionListing();
                }

                updateStreamPromotionToggle();
                updateStreamSharingVisibility();
                if (wasStreaming !== isObsStreaming &&
                    window.cloudRelay &&
                    typeof window.cloudRelay.pushDockStateSoon === 'function') {
                    window.cloudRelay.pushDockStateSoon(0);
                }
            } catch (error) {
                console.warn('Could not check OBS streaming status:', error);
                const wasStreaming = isObsStreaming;
                isObsStreaming = false;
                if (wasStreaming) {
                    // Transient GetStreamStatus failure — unlist only, keep preference.
                    handleStreamingStopped({ clearPreference: false });
                } else {
                    updateStreamPromotionToggle();
                    updateStreamSharingVisibility();
                }
            }
        } catch (error) {
            console.warn('Error checking OBS streaming status:', error);
            const wasStreaming = isObsStreaming;
            isObsStreaming = false;
            if (wasStreaming) {
                handleStreamingStopped({ clearPreference: false });
            } else {
                updateStreamPromotionToggle();
                updateStreamSharingVisibility();
            }
        }
    }

    async function toggleStreamPromotion() {
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
                alert('CueSport Scoreboard Cloud must be connected before promoting. Enable CueSport Scoreboard Cloud and wait until it is joined.');
                updateStreamPromotionToggle();
                return;
            }

            if (!isObsStreaming) {
                toggle.checked = false;
                alert('OBS must be streaming to share your game data.');
                return;
            }

            const streamUrl = await getStreamUrl();
            if (!streamUrl) {
                toggle.checked = false;
                openStreamPromotionSettingsModal();
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
            getStreamUrl().then((streamUrl) => {
                if (!streamUrl) {
                    clearPromotionEnabled();
                    const toggle = document.getElementById('streamPromotionToggle');
                    if (toggle && toggle.checked) {
                        toggle.checked = false;
                        openStreamPromotionSettingsModal();
                    }
                    updateStreamPromotionToggle();
                    return;
                }
                setTimeout(() => {
                    republishPromotionIfActive();
                }, 500);
                setTimeout(() => {
                    republishPromotionIfActive();
                }, 2500);
            }).catch(() => {
                clearPromotionEnabled();
                updateStreamPromotionToggle();
            });
        }
    }

    async function openStreamPromotionSettingsModal() {
        const modal = document.getElementById('streamPromotionSettingsModal');
        if (!modal) return;

        const urlInput = document.getElementById('manualStreamUrlModal');
        if (urlInput) {
            const saved = getStorageItem('manualStreamUrl');
            if (saved) {
                urlInput.value = saved;
            } else {
                const detected = cachedObsStreamUrl || await detectStreamUrlFromObs();
                urlInput.value = detected || '';
            }
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

    async function toggleObsStreaming() {
        // Prefer control_panel implementation (same OBS client / alerts as Instant Replay).
        if (typeof window.toggleObsStreaming === 'function' && window.toggleObsStreaming !== toggleObsStreaming) {
            return window.toggleObsStreaming();
        }
        if (typeof obs === 'undefined' || !obs || typeof isObsReady === 'undefined' || !isObsReady) {
            throw new Error('OBS WebSocket is not connected');
        }
        const status = await obs.call('GetStreamStatus');
        const active = status && status.outputActive === true;
        if (active) {
            await obs.call('StopStream');
        } else {
            await obs.call('StartStream');
        }
        await checkObsStreamingStatus();
        if (window.cloudRelay && typeof window.cloudRelay.pushDockStateSoon === 'function') {
            window.cloudRelay.pushDockStateSoon(0);
        }
        return { streaming: !active };
    }

    window.openStreamPromotionSettingsModal = openStreamPromotionSettingsModal;
    window.closeStreamPromotionSettingsModal = closeStreamPromotionSettingsModal;
    window.saveStreamPromotionSettings = saveStreamPromotionSettings;
    window.toggleStreamPromotion = toggleStreamPromotion;
    // control_panel.js owns the primary toggleObsStreaming; keep a fallback for load-order safety.
    if (typeof window.toggleObsStreaming !== 'function') {
        window.toggleObsStreaming = toggleObsStreaming;
    }

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
            const streamUrl = resolveEffectiveStreamUrlSync();
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
            // Cloud often joins after OBS is already live — republish so /streams lists us.
            republishPromotionIfActive();
        },

        toggle: toggleStreamPromotion,
        refreshStreamingStatus: checkObsStreamingStatus,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
