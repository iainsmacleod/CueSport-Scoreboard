'use strict';

// Stream Sharing Module for CueSport Scoreboard
// Handles WebSocket connection and game state updates to external server

(function() {
    // Storage key prefix for this instance
    const STORAGE_PREFIX = 'streamSharing_';
    
    // Connection state
    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const INITIAL_RECONNECT_DELAY = 1000; // 1 second
    const MAX_RECONNECT_DELAY = 60000; // 1 minute
    
    let isEnabled = false;
    let isConnected = false;
    let isAuthenticated = false;
    let isObsStreaming = false;
    let streamingCheckInterval = null;
    let autoResumeEnabled = false;
    
    // Helper function to get storage item (compatible with existing codebase pattern)
    function getStorageItem(key) {
        const prefixedKey = STORAGE_PREFIX + key;
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        const fullKey = instanceId ? `${instanceId}_${prefixedKey}` : prefixedKey;
        return localStorage.getItem(fullKey);
    }
    
    // Helper function to set storage item
    function setStorageItem(key, value) {
        const prefixedKey = STORAGE_PREFIX + key;
        const instanceId = new URLSearchParams(window.location.search).get('instance') || '';
        const fullKey = instanceId ? `${instanceId}_${prefixedKey}` : prefixedKey;
        localStorage.setItem(fullKey, value);
    }
    
    // Generate unique API key (32 character hex string)
    function generateApiKey() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    
    // Get or create API key
    function getApiKey() {
        let apiKey = getStorageItem('apiKey');
        if (!apiKey) {
            apiKey = generateApiKey();
            setStorageItem('apiKey', apiKey);
            updateApiKeyDisplay();
        }
        return apiKey;
    }
    
    // Update API key display in UI
    function updateApiKeyDisplay() {
        const apiKeyField = document.getElementById('streamApiKey');
        if (apiKeyField) {
            apiKeyField.value = getApiKey();
        }
    }
    
    // Get server URL - hardcoded to hosted server
    function getServerUrl() {
        return 'https://cuesports.macleod.systems';
    }
    
    
    // Validate stream URL format
    function isValidStreamUrl(urlString) {
        if (!urlString || typeof urlString !== 'string') {
            return false;
        }
        
        const trimmed = urlString.trim();
        if (!trimmed || trimmed.length === 0) {
            return false;
        }
        
        // Must have a minimum length
        if (trimmed.length < 10) {
            return false;
        }
        
        // Must start with http:// or https://
        if (!trimmed.match(/^https?:\/\//i)) {
            return false;
        }
        
        try {
            const url = new URL(trimmed);
            
            // Must be http or https protocol
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return false;
            }
            
            // Must have a valid hostname (not empty)
            if (!url.hostname || url.hostname.length === 0) {
                return false;
            }
            
            // Hostname should contain at least one dot (for domain) or be localhost
            if (!url.hostname.match(/^localhost(:\d+)?$|^\[?[\da-fA-F:]+\)?$/) && !url.hostname.includes('.')) {
                return false;
            }
            
            // Hostname should not contain spaces or invalid characters
            if (url.hostname.match(/[\s<>"{}|\\^`\[\]]/)) {
                return false;
            }
            
            // Basic validation: should have a reasonable structure
            // Check that it's not just "http://" or "https://"
            if (url.href === url.protocol + '//' || url.href === url.protocol + '///') {
                return false;
            }
            
            return true;
        } catch (e) {
            // URL constructor throws error for invalid URLs
            return false;
        }
    }
    
    // Get manual stream URL synchronously (for button state checks)
    function getManualStreamUrl() {
        const manualUrlField = document.getElementById('manualStreamUrl');
        if (manualUrlField && manualUrlField.value) {
            const manualUrl = String(manualUrlField.value).trim();
            if (manualUrl && isValidStreamUrl(manualUrl)) {
                return manualUrl;
            }
        }
        return '';
    }
    
    // Get stream URL from OBS or manual input
    async function getStreamUrl() {
        // First check for manual input
        const manualUrl = getManualStreamUrl();
        if (manualUrl) {
            console.log('Using manual stream URL:', manualUrl);
            return manualUrl;
        }
        
        // Try to auto-detect from OBS
        try {
            // Check if OBS is ready
            if (typeof obs === 'undefined' || !obs || typeof isObsReady === 'undefined' || !isObsReady) {
                return '';
            }
            
            try {
                // Get stream service settings
                const serviceSettings = await obs.call('GetStreamServiceSettings');
                console.log('Stream service settings:', serviceSettings);
                
                const serviceType = serviceSettings.streamServiceType || '';
                const settings = serviceSettings.streamServiceSettings || {};
                
                // Build stream URL based on service type
                let streamUrl = '';
                
                // For Twitch
                if (serviceType.toLowerCase().includes('twitch')) {
                    // Twitch settings can have 'channel' field or 'server' + 'key'
                    const channel = settings.channel || settings.key || '';
                    // Remove leading @ if present
                    const cleanChannel = channel.replace(/^@/, '');
                    if (cleanChannel) {
                        streamUrl = `https://www.twitch.tv/${cleanChannel}`;
                        console.log('Detected Twitch channel:', cleanChannel);
                    }
                } 
                // For YouTube
                else if (serviceType.toLowerCase().includes('youtube')) {
                    // YouTube uses stream keys in format, but we can't always construct watch URL
                    // Try to get channel from settings if available
                    const streamKey = settings.key || settings.stream_key || '';
                    // YouTube Live streams use different URLs, but we can try
                    if (streamKey) {
                        // For now, just provide a generic YouTube Live link
                        streamUrl = 'https://www.youtube.com/live';
                        console.log('Detected YouTube streaming');
                    }
                } 
                // For Facebook
                else if (serviceType.toLowerCase().includes('facebook')) {
                    streamUrl = 'https://www.facebook.com/live';
                    console.log('Detected Facebook Live');
                }
                // For RTMP (custom or common)
                else if (serviceType.includes('rtmp')) {
                    // For RTMP services, try to extract readable info
                    // Check if server contains twitch/youtube domain
                    const server = settings.server || '';
                    if (server.includes('twitch.tv')) {
                        const channel = settings.key || '';
                        if (channel) {
                            const cleanChannel = channel.replace(/^@/, '');
                            streamUrl = `https://www.twitch.tv/${cleanChannel}`;
                            console.log('Detected Twitch via RTMP:', cleanChannel);
                        }
                    } else if (server.includes('youtube.com') || server.includes('googlevideo.com')) {
                        streamUrl = 'https://www.youtube.com/live';
                        console.log('Detected YouTube via RTMP');
                    }
                }
                
                if (streamUrl && isValidStreamUrl(streamUrl)) {
                    console.log('Auto-detected stream URL:', streamUrl);
                    return streamUrl;
                } else if (streamUrl) {
                    console.warn('Auto-detected stream URL failed validation:', streamUrl);
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
    
    // Collect current game state
    async function collectGameState() {
        // Helper to safely get value
        const getValue = (id, defaultValue = '') => {
            const el = document.getElementById(id);
            return el ? (el.value || defaultValue) : defaultValue;
        };
        
        // Helper to safely get storage item
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
        
        // Get stream URL from OBS (validate it)
        const streamUrl = await getStreamUrl();
        const validatedUrl = isValidStreamUrl(streamUrl) ? streamUrl : '';
        
        const player1Setting = String(getStorage(`${storagePrefix}usePlayer1`, getStorage('usePlayer1', 'yes')) || 'yes').toLowerCase();
        const player2Setting = String(getStorage(`${storagePrefix}usePlayer2`, getStorage('usePlayer2', 'yes')) || 'yes').toLowerCase();
        const player1Enabled = !(player1Setting === 'no' || player1Setting === 'false' || player1Setting === '0');
        const player2Enabled = !(player2Setting === 'no' || player2Setting === 'false' || player2Setting === '0');

        const scoreDisplaySetting = String(getStorage(`${storagePrefix}scoreDisplay`, getStorage('scoreDisplay', 'yes')) || 'yes').toLowerCase();
        const scoreDisplay = !(scoreDisplaySetting === 'no' || scoreDisplaySetting === 'false' || scoreDisplaySetting === '0');

        const ballTrackerSetting = String(getStorage(`${storagePrefix}enableBallTracker`, getStorage('enableBallTracker', 'no')) || 'no').toLowerCase();
        const shotClockSetting = String(getStorage(`${storagePrefix}useClock`, getStorage('useClock', 'no')) || 'no').toLowerCase();
        const ballTrackerEnabled = ballTrackerSetting === 'yes' || ballTrackerSetting === 'true' || ballTrackerSetting === '1';
        const shotClockEnabled = shotClockSetting === 'yes' || shotClockSetting === 'true' || shotClockSetting === '1';
        
        return {
            player1Name: getValue('p1Name', '') || getStorage(`${storagePrefix}p1NameCtrlPanel`, ''),
            player2Name: getValue('p2Name', '') || getStorage(`${storagePrefix}p2NameCtrlPanel`, ''),
            p1Score: parseInt(getValue('p1Score', '0')) || parseInt(getStorage(`${storagePrefix}p1ScoreCtrlPanel`, '0')) || 0,
            p2Score: parseInt(getValue('p2Score', '0')) || parseInt(getStorage(`${storagePrefix}p2ScoreCtrlPanel`, '0')) || 0,
            gameType: getStorage(`${storagePrefix}gameType`, 'game1'),
            raceInfo: getValue('raceInfoTxt', '') || getStorage(`${storagePrefix}raceInfo`, ''),
            gameInfo: getValue('gameInfoTxt', '') || getStorage(`${storagePrefix}gameInfo`, ''),
            streamUrl: validatedUrl,
            player1Enabled,
            player2Enabled,
            scoreDisplay,
            ballTrackerEnabled,
            shotClockEnabled,
            timestamp: new Date().toISOString()
        };
    }
    
    // Send game state update to server
    async function sendGameState() {
        if (!ws || ws.readyState !== WebSocket.OPEN || !isAuthenticated) {
            return false;
        }
        
        try {
            const state = await collectGameState();
            const message = {
                type: 'update',
                api_key: getApiKey(),
                state: state
            };
            
            ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Error sending game state:', error);
            return false;
        }
    }
    
    // Connect to WebSocket server
    function connect() {
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
            return; // Already connecting or connected
        }
        
        const serverUrl = getServerUrl();
        if (!serverUrl) {
            console.error('No server URL');
            return;
        }
        
        // Convert HTTP URL to WebSocket URL if needed
        let wsUrl = serverUrl;
        if (wsUrl.startsWith('http://')) {
            wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
            wsUrl = wsUrl.replace('https://', 'wss://');
        }
        if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
            wsUrl = 'ws://' + wsUrl;
        }
        
        // Add /ws path if not present
        if (!wsUrl.endsWith('/ws')) {
            wsUrl = wsUrl.replace(/\/$/, '') + '/ws';
        }
        
        console.log('Connecting to stream sharing server...');
        console.log('Connecting to:', wsUrl);
        
        try {
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                console.log('WebSocket connected');
                reconnectAttempts = 0;
                isConnected = true;
                            console.log('Authenticating...');
                
                // Send authentication
                const authMessage = {
                    type: 'auth',
                    api_key: getApiKey()
                };
                ws.send(JSON.stringify(authMessage));
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'auth') {
                        if (data.status === 'success') {
                            isAuthenticated = true;
                            console.log('Stream sharing connected');
                            updateConnectButton();
                            console.log('Authenticated successfully');
                            // Send initial state
                            sendGameState();
                        } else if (data.status === 'pending') {
                            // Server is waiting for authentication - ignore, we already sent it
                            // Do nothing, wait for success response
                        } else {
                            isAuthenticated = false;
                            console.error('Auth failed: ' + (data.message || 'Unknown error'));
                            updateConnectButton();
                            console.error('Authentication failed:', data.message);
                            ws.close();
                        }
                    } else if (data.type === 'ack') {
                        if (data.status === 'error') {
                            console.warn('Server error:', data.message);
                        }
                    } else if (data.type === 'pong') {
                        // Heartbeat response
                    }
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket error:', error);
                console.error('Connection error');
                isConnected = false;
                isAuthenticated = false;
            };
            
            ws.onclose = function(event) {
                console.log('WebSocket closed:', event.code, event.reason);
                isConnected = false;
                isAuthenticated = false;
                
                if (isEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    // Exponential backoff reconnection
                    const delay = Math.min(
                        INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
                        MAX_RECONNECT_DELAY
                    );
                    reconnectAttempts++;
                    console.log(`Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                    
                    reconnectTimer = setTimeout(() => {
                        connect();
                    }, delay);
                } else {
                    console.log('Disconnected');
                    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                        console.error('Max reconnection attempts reached');
                        console.error('Connection failed');
                    }
                }
            };
            
        } catch (error) {
            console.error('Error creating WebSocket:', error);
            console.error('Connection error');
            isConnected = false;
        }
    }
    
    // Disconnect from server
    function disconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        
        if (ws) {
            ws.close();
            ws = null;
        }
        
        isConnected = false;
        isAuthenticated = false;
        reconnectAttempts = 0;
        console.log('Disconnected');
    }
    
    // Update connect/disconnect button text and visibility
    function updateConnectButton() {
        const btn = document.getElementById('streamConnectBtn');
        if (!btn) return;
        
        // Disable button if not streaming
        if (!isObsStreaming) {
            if (autoResumeEnabled && isEnabled) {
                btn.textContent = 'Auto-resume when Live';
            } else {
                btn.textContent = 'Connect (Not Streaming)';
            }
            btn.style.backgroundColor = '#999'; // Gray
            btn.disabled = true;
            btn.style.cursor = 'not-allowed';
            return;
        }
        
        // Disable button if stream URL is missing
        const streamUrl = getManualStreamUrl();
        if (!streamUrl || streamUrl === '') {
            btn.textContent = 'Connect (URL Required)';
            btn.style.backgroundColor = '#999'; // Gray
            btn.disabled = true;
            btn.style.cursor = 'not-allowed';
            return;
        }
        
        btn.disabled = false;
        btn.style.cursor = 'pointer';
        
        if (isEnabled && isConnected && isAuthenticated) {
            btn.textContent = 'Disconnect';
            btn.style.backgroundColor = 'red'; // Red - matches WebSocket button
        } else if (isEnabled && isConnected) {
            btn.textContent = 'Connecting...';
            btn.style.backgroundColor = '#FF9800'; // Orange
        } else {
            btn.textContent = 'Connect';
            btn.style.backgroundColor = 'green'; // Green - matches WebSocket button
        }
    }
    
    // Update stream sharing UI visibility based on streaming state
    function updateStreamSharingVisibility() {
        const section = document.getElementById('streamSharingLabel');
        if (!section) return;
        
        const parent = section.parentElement;
        if (!parent) return;
        
        // Find the stream sharing section and related elements
        let currentElement = section.nextElementSibling;
        const streamSection = section.closest('.tabcontent') || parent;
        
        // Walk through siblings to find stream sharing controls
        const streamElements = [];
        streamElements.push(section);
        
        // Find elements by their IDs
        const apiKeyField = document.getElementById('streamApiKey');
        const connectBtn = document.getElementById('streamConnectBtn');
        const statusEl = document.getElementById('streamConnectionStatus');
        const manualUrlField = document.getElementById('manualStreamUrl');
        const autoResumeCheckbox = document.getElementById('autoResumeSharing');
        
        if (apiKeyField) streamElements.push(apiKeyField.parentElement);
        if (connectBtn) streamElements.push(connectBtn.parentElement);
        if (statusEl) streamElements.push(statusEl.parentElement);
        if (manualUrlField) streamElements.push(manualUrlField.parentElement);
        if (autoResumeCheckbox) streamElements.push(autoResumeCheckbox.parentElement);
        
        // Apply styling based on streaming state
        streamElements.forEach(el => {
            if (el) {
                if (!isObsStreaming) {
                    el.style.opacity = '0.6';
                } else {
                    el.style.opacity = '1';
                }
            }
        });
    }
    
    // Check OBS streaming status
    async function checkObsStreamingStatus() {
        try {
            // Access the global obs object
            if (typeof obs === 'undefined' || !obs) {
                isObsStreaming = false;
                updateConnectButton();
                updateStreamSharingVisibility();
                return;
            }
            
            // Check if OBS is ready
            if (typeof isObsReady === 'undefined' || !isObsReady) {
                isObsStreaming = false;
                updateConnectButton();
                updateStreamSharingVisibility();
                return;
            }
            
            try {
                const status = await obs.call('GetStreamStatus');
                const wasStreaming = isObsStreaming;
                // GetStreamStatus returns { outputActive: boolean, outputTimecode: string, outputDuration: number, etc. }
                isObsStreaming = status.outputActive === true;
                
                // If streaming stopped and we were connected, disconnect
                if (wasStreaming && !isObsStreaming) {
                    const shouldResume = autoResumeEnabled && isEnabled;
                    if (isConnected || isAuthenticated) {
                        console.log('OBS stopped streaming, disconnecting stream sharing');
                        disconnect();
                    }

                    isEnabled = shouldResume;
                    setStorageItem('enabled', shouldResume ? 'true' : 'false');
                }

                // If streaming has started and sharing is enabled, ensure connection
                if (!wasStreaming && isObsStreaming && isEnabled && (!isConnected || !isAuthenticated)) {
                    console.log('OBS streaming detected, reconnecting stream sharing');
                    connect();
                }
                
                updateConnectButton();
                updateStreamSharingVisibility();
            } catch (error) {
                // If we can't check status, assume not streaming
                console.warn('Could not check OBS streaming status:', error);
                isObsStreaming = false;
                updateConnectButton();
                updateStreamSharingVisibility();
            }
        } catch (error) {
            console.warn('Error checking OBS streaming status:', error);
            isObsStreaming = false;
            updateConnectButton();
            updateStreamSharingVisibility();
        }
    }
    
    // Toggle stream sharing on/off
    function toggleShareStream() {
        // Don't allow connection if not streaming
        if (!isObsStreaming) {
            alert('OBS must be streaming to share your game data.');
            return;
        }
        
        // Require stream URL before connecting
        const streamUrl = getManualStreamUrl();
        if (!streamUrl || streamUrl === '') {
            alert('Stream URL is required. Please enter your stream URL before connecting.');
            const manualUrlField = document.getElementById('manualStreamUrl');
            if (manualUrlField) {
                manualUrlField.focus();
            }
            return;
        }
        
        if (isEnabled && isConnected) {
            // Disconnect
            isEnabled = false;
            setStorageItem('enabled', 'false');
            disconnect();
            updateConnectButton();
        } else {
            // Connect
            isEnabled = true;
            setStorageItem('enabled', 'true');
            updateConnectButton();
            connect();
        }
    }
    
    // Generate new API key (UI function)
    function generateApiKeyUI() {
        if (confirm('Generate a new API key? Your current key will be replaced and you will need to reconnect.')) {
            const newKey = generateApiKey();
            setStorageItem('apiKey', newKey);
            updateApiKeyDisplay();
            
            if (isConnected) {
                disconnect();
            }
            
            if (isEnabled) {
                setTimeout(() => connect(), 1000);
            }
        }
    }
    
    // Copy API key to clipboard
    function copyApiKey() {
        const apiKey = getApiKey();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(apiKey).then(() => {
                alert('API key copied to clipboard');
            }).catch(err => {
                console.error('Failed to copy:', err);
                fallbackCopy(apiKey);
            });
        } else {
            fallbackCopy(apiKey);
        }
    }
    
    // Fallback copy method
    function fallbackCopy(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            alert('API key copied to clipboard');
        } catch (err) {
            console.error('Fallback copy failed:', err);
            alert('Failed to copy. Please copy manually: ' + text);
        }
        document.body.removeChild(textArea);
    }
    
    // Initialize on page load
    function init() {
        // Load saved settings
        const savedEnabled = getStorageItem('enabled') === 'true';
        isEnabled = savedEnabled;
        
        // Load saved manual stream URL
        const savedStreamUrl = getStorageItem('manualStreamUrl');
        const manualUrlField = document.getElementById('manualStreamUrl');
        if (manualUrlField && savedStreamUrl) {
            manualUrlField.value = savedStreamUrl;
        }

        // Load auto-resume sharing preference
        const autoResumeCheckbox = document.getElementById('autoResumeSharing');
        autoResumeEnabled = getStorageItem('autoResumeSharing') === 'true';
        if (autoResumeCheckbox) {
            autoResumeCheckbox.checked = autoResumeEnabled;
            autoResumeCheckbox.addEventListener('change', () => {
                autoResumeEnabled = autoResumeCheckbox.checked;
                setStorageItem('autoResumeSharing', autoResumeEnabled ? 'true' : 'false');

                if (!autoResumeEnabled && !isObsStreaming && !isConnected && isEnabled) {
                    // If auto-resume is disabled while waiting for streaming, clear pending state
                    isEnabled = false;
                    setStorageItem('enabled', 'false');
                    updateConnectButton();
                }

                updateConnectButton();
            });
            // Ensure button reflects persisted state on load
            updateConnectButton();
        }
        
        // Save manual URL when changed and update button state
        if (manualUrlField) {
            // Add visual feedback for URL validation
            const updateUrlValidation = () => {
                const urlValue = manualUrlField.value.trim();
                if (urlValue && !isValidStreamUrl(urlValue)) {
                    manualUrlField.style.borderColor = '#f44336'; // Red border for invalid
                    manualUrlField.style.backgroundColor = '#ffebee'; // Light red background
                } else {
                    manualUrlField.style.borderColor = '';
                    manualUrlField.style.backgroundColor = '';
                }
            };
            
            manualUrlField.addEventListener('blur', function() {
                const trimmed = this.value.trim();
                updateUrlValidation();
                
                // Only save if valid URL
                if (trimmed && isValidStreamUrl(trimmed)) {
                    setStorageItem('manualStreamUrl', trimmed);
                } else if (trimmed) {
                    // Show alert for invalid URL
                    alert('Please enter a valid URL starting with http:// or https://');
                    this.focus();
                    return;
                } else {
                    setStorageItem('manualStreamUrl', '');
                }
                
                updateConnectButton();
                if (isEnabled && isConnected && isAuthenticated) {
                    sendGameState();
                }
            });
            manualUrlField.addEventListener('input', function() {
                updateUrlValidation();
                updateConnectButton();
            });
            manualUrlField.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    this.blur();
                }
            });
            
            // Initial validation check
            updateUrlValidation();
        }
        
        // Update API key display
        updateApiKeyDisplay();
        
        // Start checking OBS streaming status
        checkObsStreamingStatus();
        
        // Check streaming status every 2 seconds
        if (streamingCheckInterval) {
            clearInterval(streamingCheckInterval);
        }
        streamingCheckInterval = setInterval(checkObsStreamingStatus, 2000);
        
        // Also check when OBS becomes ready
        if (typeof window !== 'undefined') {
            // Listen for OBS ready state changes
            let lastObsReady = false;
            const obsReadyCheck = setInterval(() => {
                if (typeof isObsReady !== 'undefined' && isObsReady !== lastObsReady) {
                    lastObsReady = isObsReady;
                    if (isObsReady) {
                        checkObsStreamingStatus();
                    }
                }
            }, 500);
            
            // Clean up on page unload
            window.addEventListener('beforeunload', () => {
                if (streamingCheckInterval) clearInterval(streamingCheckInterval);
                clearInterval(obsReadyCheck);
            });
        }
        
        // Don't auto-connect on page load - user must manually connect
        // But if they were connected and OBS is streaming, we can reconnect
        if (isEnabled && isObsStreaming) {
            // Delay connection slightly to ensure DOM is ready
            setTimeout(() => {
                if (isEnabled && isObsStreaming) {
                    connect();
                }
            }, 500);
        }
    }
    
    // Export public API
    window.streamSharing = {
        // Send current game state (called from update functions)
        sendUpdate: function() {
            if (isEnabled && isConnected && isAuthenticated) {
                sendGameState();
            }
        },
        
        // Check if sharing is enabled
        isEnabled: function() {
            return isEnabled;
        },
        
        // Check if connected
        isConnected: function() {
            return isConnected && isAuthenticated;
        },
        
        // Disconnect stream sharing (called when WebSocket disconnects)
        disconnect: function() {
            if (isEnabled && (isConnected || isAuthenticated)) {
                isEnabled = false;
                setStorageItem('enabled', 'false');
                disconnect();
                updateConnectButton();
            }
        },
        
        // Toggle function (called from HTML)
        toggle: toggleShareStream,
        
        // Generate API key function (called from HTML)
        generateApiKey: generateApiKeyUI,
        
        // Copy API key function (called from HTML)
        copyApiKey: copyApiKey
    };
    
    // Expose functions for HTML onclick handlers
    window.toggleShareStream = toggleShareStream;
    window.generateApiKey = generateApiKeyUI;
    window.copyApiKey = copyApiKey;
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();

