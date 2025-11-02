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
    
    // Update connection status display
    function updateConnectionStatus(status, message) {
        const statusEl = document.getElementById('streamConnectionStatus');
        if (!statusEl) return;
        
        statusEl.textContent = message || status;
        
        // Update color based on status
        switch(status) {
            case 'connected':
                statusEl.style.backgroundColor = '#4CAF50'; // Green
                break;
            case 'connecting':
                statusEl.style.backgroundColor = '#FF9800'; // Orange
                break;
            case 'disconnected':
            case 'error':
                statusEl.style.backgroundColor = '#f44336'; // Red
                break;
            default:
                statusEl.style.backgroundColor = '#666'; // Gray
        }
    }
    
    // Collect current game state
    function collectGameState() {
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
        
        return {
            player1Name: getValue('p1Name', '') || getStorage(`${storagePrefix}p1NameCtrlPanel`, ''),
            player2Name: getValue('p2Name', '') || getStorage(`${storagePrefix}p2NameCtrlPanel`, ''),
            p1Score: parseInt(getValue('p1Score', '0')) || parseInt(getStorage(`${storagePrefix}p1ScoreCtrlPanel`, '0')) || 0,
            p2Score: parseInt(getValue('p2Score', '0')) || parseInt(getStorage(`${storagePrefix}p2ScoreCtrlPanel`, '0')) || 0,
            gameType: getStorage(`${storagePrefix}gameType`, 'game1'),
            raceInfo: getValue('raceInfoTxt', '') || getStorage(`${storagePrefix}raceInfo`, ''),
            gameInfo: getValue('gameInfoTxt', '') || getStorage(`${storagePrefix}gameInfo`, ''),
            timestamp: new Date().toISOString()
        };
    }
    
    // Send game state update to server
    function sendGameState() {
        if (!ws || ws.readyState !== WebSocket.OPEN || !isAuthenticated) {
            return false;
        }
        
        try {
            const state = collectGameState();
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
            updateConnectionStatus('error', 'No server URL');
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
        
        updateConnectionStatus('connecting', 'Connecting...');
        console.log('Connecting to:', wsUrl);
        
        try {
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                console.log('WebSocket connected');
                reconnectAttempts = 0;
                isConnected = true;
                updateConnectionStatus('connecting', 'Authenticating...');
                
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
                            updateConnectionStatus('connected', 'Connected');
                            console.log('Authenticated successfully');
                            // Send initial state
                            sendGameState();
                        } else {
                            isAuthenticated = false;
                            updateConnectionStatus('error', 'Auth failed: ' + (data.message || 'Unknown error'));
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
                updateConnectionStatus('error', 'Connection error');
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
                    updateConnectionStatus('disconnected', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                    
                    reconnectTimer = setTimeout(() => {
                        connect();
                    }, delay);
                } else {
                    updateConnectionStatus('disconnected', 'Disconnected');
                    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                        console.error('Max reconnection attempts reached');
                        updateConnectionStatus('error', 'Connection failed');
                    }
                }
            };
            
        } catch (error) {
            console.error('Error creating WebSocket:', error);
            updateConnectionStatus('error', 'Connection error');
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
        updateConnectionStatus('disconnected', 'Disconnected');
    }
    
    // Toggle stream sharing on/off
    function toggleShareStream() {
        const checkbox = document.getElementById('shareStreamSetting');
        if (!checkbox) return;
        
        isEnabled = checkbox.checked;
        setStorageItem('enabled', isEnabled ? 'true' : 'false');
        
        if (isEnabled) {
            connect();
        } else {
            disconnect();
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
        
        // Set UI elements
        const checkbox = document.getElementById('shareStreamSetting');
        if (checkbox) {
            checkbox.checked = savedEnabled;
            isEnabled = savedEnabled;
        }
        
        // Update API key display
        updateApiKeyDisplay();
        
        // Update connection status
        updateConnectionStatus('disconnected', 'Disconnected');
        
        // Connect if enabled
        if (isEnabled) {
            // Delay connection slightly to ensure DOM is ready
            setTimeout(() => {
                connect();
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

