'use strict';
// CueSport ScoreBoard is a modified version of G4ScoreBoard by Iain MacLeod. The purpose of this modification was to simplify and enhance the UI/UX for users.
// I have removed the Salotto logo, as I myself have not asked for permission to use - but if you choose to use it, it can be uploaded as a custom logo.
// This implementation now uses 5 custom logos, 2 associated with players, and for a slideshow functionality.

//  G4ScoreBoard addon for OBS version 1.6.0 Copyright 2022-2023 Norman Gholson IV
//  https://g4billiards.com http://www.g4creations.com
//  this is a purely javascript/html/css driven scoreboard system for OBS Studio
//  free to use and modify and use as long as this copyright statment remains intact. 
//  Salotto logo is the copyright of Salotto and is used with their permission.
//  for more information about Salotto please visit https://salotto.app

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// variable declarations
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var cLogoName = "Player 1 Logo";  // 13 character limit. it will auto trim to 13 characters.
var cLogoName2 = "Player 2 Logo";
const bc = new BroadcastChannel(`main_${INSTANCE_ID}`);
const bcr = new BroadcastChannel(`recv_${INSTANCE_ID}`); // return channel from browser_source

(function wrapBroadcastChannelForCloud() {
    const _post = bc.postMessage.bind(bc);
    bc.postMessage = function (data) {
        _post(data);
        if (window.cloudRelay && typeof window.cloudRelay.sendEvent === 'function' && !window.cloudRelay.replaying) {
            window.cloudRelay.sendEvent(data);
        }
    };
})();
var hotkeyP1ScoreUp;
var hotkeyP1ScoreDown;
var hotkeyP2ScoreUp;
var hotkeyP2ScoreDown;
var hotkeyScoreReset;
var hotkeyP1Extension;
var hotkeyP2Extension;
var hotkey30Clock;
var hotkey60Clock;
var hotkeyStopClock;
var hotkeySwap;
var hotkeyPlayerToggle;
var hotkeyP1ScoreUpOld = hotkeyP1ScoreUp;
var hotkeyP2ScoreUpOld = hotkeyP2ScoreUp;
var hotkeyP1ScoreDownOld = hotkeyP1ScoreDown;
var hotkeyP2ScoreDownOld = hotkeyP2ScoreDown;
var hotkeyScoreResetOld = hotkeyScoreReset;
var hotkeyP1ExtensionOld = hotkeyP1Extension;
var hotkeyP2ExtensionOld = hotkeyP2Extension;
var hotkey30ClockOld = hotkey30Clock;
var hotkey60ClockOld = hotkey60Clock;
var hotkeyStopClockOld = hotkeyStopClock;
var hotkeySwapOld = hotkeySwap;
var hotkeyPlayerToggleOld = hotkeyPlayerToggle; // Track old state
var tev;
var p1ScoreValue;
var p2ScoreValue;
var warningBeep = new Audio("./common/sound/beep2.mp3");
var foulSound = new Audio("./common/sound/buzz.mp3");
var timerIsRunning;
var msg;
var msg2;
var racemsg;
var gamemsg;
var uiScalingSlider = document.getElementById("uiScaling")
var sliderUiScalingValue;
var slider = document.getElementById("scoreOpacity");
var sliderValue;
var countDownTime;
var shotClockxr = null;
var playerNumber;
var p1namemsg;
var p2namemsg;
var playerx;
var c1value;
var c2value;
var pColormsg;

/** Stop OBS/browser dock from highlighting ball images on click-drag (clicks still work). */
function initBallClickTargets() {
	const selector = "#ballTrackerDiv .ball, .snooker-foul-targets .ball, #snookerUndoBtn";
	document.querySelectorAll(selector).forEach(function (ball) {
		ball.addEventListener("mousedown", function (e) {
			if (e.button === 0) {
				e.preventDefault();
			}
		});
	});
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// onload stuff
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

window.onload = function () {
	// Set local storage values if not previously configured
	if (getStorageItem("usePlayer1") === null) {
		setStorageItem("usePlayer1", "yes");
	}
	if (getStorageItem("usePlayer2") === null) {
		setStorageItem("usePlayer2", "yes");
	}

	if (getStorageItem("rackBreakerSlot") === null) {
		setStorageItem("rackBreakerSlot", "");
	}
	if (getStorageItem("lastRackBreakerSlot") === null) {
		setStorageItem("lastRackBreakerSlot", "");
	}
	if (getStorageItem("rackOpponentVisited") === null) {
		setStorageItem("rackOpponentVisited", "no");
	}
	if (!getStorageItem("lastRackBreakerSlot") && getStorageItem("rackBreakerSlot")) {
		const legacySlot = getStorageItem("rackBreakerSlot");
		if (legacySlot === "1" || legacySlot === "2") {
			setStorageItem("lastRackBreakerSlot", legacySlot);
		}
	}

	if (getStorageItem("scoreDisplay") === null) {
		setStorageItem("scoreDisplay", "yes");
	}

	if (getStorageItem("usePlayerToggle") === "yes" || getStorageItem("usePlayerToggle") === null) {
		document.getElementById("useToggleSetting").checked = true;
		setStorageItem("usePlayerToggle", "yes");
		toggleSetting();
	} else {
		document.getElementById("useToggleSetting").checked = false;
		setStorageItem("usePlayerToggle", "no");
		toggleSetting();
	}

	if (getStorageItem("autoResumeReplayBuffer") === "yes") {
		document.getElementById("autoResumeReplayBuffer").checked = true;
	} else {
		document.getElementById("autoResumeReplayBuffer").checked = false;
	}

	if (getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes" && getStorageItem("usePlayerToggle") === "yes") {
		console.log(`We should be showing active player identifier`);
		const activePlayer = getStorageItem("activePlayer") === "2" ? "2" : "1";
		setStorageItem("activePlayer", activePlayer);
		document.getElementById("playerToggleCheckbox").checked = activePlayer === "1";
		setStorageItem("toggleState", activePlayer === "1");
		console.log(`activePlayer: ${activePlayer}`);
		bc.postMessage({ clockDisplay: 'showActivePlayer', player: activePlayer });
	}

	if (getStorageItem("scoreDisplay") === "yes") {
		document.getElementById("scoreDisplay").checked = true;
		scoreDisplaySetting();
	} else {
		document.getElementById("scoreDisplay").checked = false;
		scoreDisplaySetting();
	}

	if (getStorageItem("p1Score") === null) {
		setStorageItem("p1Score", "0");
	}
	if (getStorageItem("p2Score") === null) {
		setStorageItem("p2Score", "0");
	}
	if (getStorageItem("p1Balls") === null) {
		setStorageItem("p1Balls", "0");
	}
	if (getStorageItem("p2Balls") === null) {
		setStorageItem("p2Balls", "0");
	}
	if (getStorageItem("p1BallsCtrlPanel") === null) {
		setStorageItem("p1BallsCtrlPanel", getStorageItem("p1Balls") || "0");
	}
	if (getStorageItem("p2BallsCtrlPanel") === null) {
		setStorageItem("p2BallsCtrlPanel", getStorageItem("p2Balls") || "0");
	}
	if (getStorageItem("pointBased") === null) {
		setStorageItem("pointBased", "no");
	}

	const defaultGameType = ensureDefaultGameType();
	syncGameTypeSelect(defaultGameType);

	if (getStorageItem("ballSelection") === null) {
		setStorageItem("ballSelection", "american");
		document.getElementById("ballSelection").value = getStorageItem("ballSelection");
	} else {
		document.getElementById("ballSelection").value = getStorageItem("ballSelection");
	}
	console.log("Ball type: " + getStorageItem("ballSelection"));

	if (getStorageItem("snookerGoldEnabled") === null) {
		setStorageItem("snookerGoldEnabled", "no");
	}
	const snookerGoldCheckbox = document.getElementById("snookerGoldCheckbox");
	if (snookerGoldCheckbox) {
		snookerGoldCheckbox.checked = getStorageItem("snookerGoldEnabled") === "yes";
	}
	if (getStorageItem("winOnBreakEnabled") === null) {
		setStorageItem("winOnBreakEnabled", "no");
	}
	if (getStorageItem("earlyGameBallEnabled9") === null) {
		setStorageItem("earlyGameBallEnabled9", "no");
	}
	if (getStorageItem("earlyGameBallEnabled10") === null) {
		setStorageItem("earlyGameBallEnabled10", "no");
	}
	// Drop legacy shared flag so it cannot re-enable all games together.
	if (getStorageItem("earlyGameBallEnabled") !== null) {
		setStorageItem("earlyGameBallEnabled", "no");
	}
	const earlyGameBallCheckbox = document.getElementById("earlyGameBallCheckbox");
	if (earlyGameBallCheckbox && typeof isEarlyGameBallEnabled === "function") {
		earlyGameBallCheckbox.checked = isEarlyGameBallEnabled();
	}
	if (getStorageItem("snookerRedsPotted") === null) {
		setStorageItem("snookerRedsPotted", "0");
	}
	if (getStorageItem("snookerPhase") === null) {
		setStorageItem("snookerPhase", "red");
	}
	if (getStorageItem("snookerAfterFreeball") === null) {
		setStorageItem("snookerAfterFreeball", "no");
	}
	if (getStorageItem("snookerFoulAwaitingPlayerChange") === null) {
		setStorageItem("snookerFoulAwaitingPlayerChange", "no");
	}
	if (getStorageItem("snookerFreeBallOffered") === null) {
		setStorageItem("snookerFreeBallOffered", "no");
	}
	if (getStorageItem("snookerUndoStack") === null) {
		setStorageItem("snookerUndoStack", "[]");
	}
	if (typeof loadSnookerUndoStackFromStorage === "function") {
		loadSnookerUndoStackFromStorage();
	}
	if (typeof loadScoringUndoStackFromStorage === "function") {
		loadScoringUndoStackFromStorage();
	}
	if (typeof updateScoringUndoButton === "function") {
		updateScoringUndoButton();
	}
	if (getStorageItem("snookerClearedColors") === null) {
		setStorageItem("snookerClearedColors", "[]");
	}
	if (getStorageItem("snookerGoldenBallFouled") === null) {
		setStorageItem("snookerGoldenBallFouled", "no");
	}
	if (getStorageItem("snookerCurrentBreak") === null) {
		setStorageItem("snookerCurrentBreak", "0");
	}
	if (getStorageItem("snookerFrameHighBreakP1") === null) {
		setStorageItem("snookerFrameHighBreakP1", "0");
	}
	if (getStorageItem("snookerFrameHighBreakP2") === null) {
		setStorageItem("snookerFrameHighBreakP2", "0");
	}
	if (getStorageItem("snookerFrameFoulsP1") === null) {
		setStorageItem("snookerFrameFoulsP1", "0");
	}
	if (getStorageItem("snookerFrameFoulsP2") === null) {
		setStorageItem("snookerFrameFoulsP2", "0");
	}

	// Update label text based on initial ball type
	const redLabel = document.querySelector('label[for="p1colorRed"] span');
	if (redLabel) {
		const currentBallType = getStorageItem("ballSelection");
		if (currentBallType === "american" || currentBallType === "ultimate") {
			redLabel.textContent = "Smalls/Lows/Solids";
		} else if (currentBallType === "unity") {
			redLabel.textContent = "Pink";
		} else {
			redLabel.textContent = "Red";
		}
	}

	const yellowLabel = document.querySelector('label[for="p1colorYellow"] span');
	if (yellowLabel) {
		const currentBallType = getStorageItem("ballSelection");
		if (currentBallType === "american" || currentBallType === "ultimate") {
			yellowLabel.textContent = "Bigs/Highs/Stripes";
		} else if (currentBallType === "unity") {
			yellowLabel.textContent = "Blue";
		} else {
			yellowLabel.textContent = "Yellow";
		}
	}

	var savedOpacity = getStorageItem('overlayOpacity');
	if (savedOpacity) {
		document.getElementById('scoreOpacity').value = savedOpacity;
		document.getElementById('sliderValue').innerText = savedOpacity + '%'; // Update displayed value
	}

	var savedScaling = getStorageItem('uiScalingValue');
	if (savedScaling) {
		document.getElementById('uiScaling').value = savedScaling;
		document.getElementById('sliderUiScalingValue').innerText = savedScaling + '%'; // Update displayed value
	}

	if (getStorageItem("enableBallTracker") === null) {
		setStorageItem("enableBallTracker", "no");
		document.getElementById("ballTrackerCheckbox").checked = false;
		document.getElementById("ballTrackerDiv").classList.add("noShow");
	} else if ((getStorageItem("enableBallTracker") === "yes")) {
		setStorageItem("enableBallTracker", "yes");
		document.getElementById("ballTrackerCheckbox").checked = true;
		document.getElementById("ballTrackerDiv").classList.remove("noShow");
	} else {
		setStorageItem("enableBallTracker", "no");
		document.getElementById("ballTrackerCheckbox").checked = false;
		document.getElementById("ballTrackerDiv").classList.add("noShow");
	}

	// Migrate / init Display Balls (overlay). Cannot be on without Ball Tracker; never for snooker.
	const snookerModeInit = getStorageItem("gameType") === "game8" || getStorageItem("ballSelection") === "snooker";
	if (getStorageItem("enableBallDisplay") === null) {
		// Preserve prior behavior: tracker on + non-snooker meant overlay was shown
		const legacyShow = getStorageItem("enableBallTracker") === "yes" && !snookerModeInit;
		setStorageItem("enableBallDisplay", legacyShow ? "yes" : "no");
	}
	if (snookerModeInit || getStorageItem("enableBallTracker") !== "yes") {
		setStorageItem("enableBallDisplay", "no");
	}
	const ballDisplayCheckbox = document.getElementById("ballDisplayCheckbox");
	if (ballDisplayCheckbox) {
		ballDisplayCheckbox.checked = getStorageItem("enableBallDisplay") === "yes";
	}

	if ((getStorageItem("enableBallTracker") === "yes") && (getStorageItem("gameType") === "game1" || getStorageItem("gameType") === "game8" || getStorageItem("ballSelection") === "snooker")) {
		document.getElementById("ballTrackerCheckbox").checked = true;
		document.getElementById("ballTrackerDiv").classList.remove("noShow");
		console.log(`Ball tracker enabled`);
		bc.postMessage({ displayBallTracker: getStorageItem("enableBallDisplay") === "yes" && !snookerModeInit });
	} else if (getStorageItem("enableBallTracker") === "yes") {
		document.getElementById("ballTrackerCheckbox").checked = true;
		document.getElementById("ballTrackerDiv").classList.remove("noShow");
		bc.postMessage({ displayBallTracker: getStorageItem("enableBallDisplay") === "yes" && !snookerModeInit });
	} else {
		document.getElementById("ballTrackerCheckbox").checked = false;
		setStorageItem("enableBallTracker", "no");
		setStorageItem("enableBallDisplay", "no");
		document.getElementById("ballTrackerDirectionDiv").classList.add("noShow");
		document.getElementById("ballTrackerDiv").classList.add("noShow");

		console.log(`Ball tracker disabled`);
		bc.postMessage({ displayBallTracker: false });
	}
	if (typeof syncBallDisplayControls === "function") {
		syncBallDisplayControls();
	}

	if (getStorageItem("ballTrackerDirection") === null) {
		// Initialize with default value if not set
		setStorageItem("ballTrackerDirection", "vertical");
		setStorageItem("ballSelection", "american");
		document.getElementById("ballTrackerDirectionDiv").innerHTML = "Vertical Ball Display";
		bc.postMessage({ ballTracker: "vertical" });
		bc.postMessage({ ballSelection: "american" });
		console.log(`Ball tracker initialized vertical`);
		console.log(`Ball selection initialized american`);
	} else {
		// Use existing stored value
		const direction = getStorageItem("ballTrackerDirection");
		document.getElementById("ballTrackerDirectionDiv").innerHTML = direction === "vertical" ? "Vertical Ball Display" : "Horizontal Ball Display";
		const selection = getStorageItem("ballSelection");
		bc.postMessage({ ballSelection: selection });
		bc.postMessage({ ballTracker: direction });
		console.log(`Ball tracker initialized ${direction}`);
	}

	if (getStorageItem("isConnected") === "true") {
		obsReConnect();
		console.log(`Reconnecting on statup, due to isConnected being true`);
		if ((getStorageItem("isMonitoringActive") === "true")) {
			obsReMonitor();
		}
		setMonitorButtonText();
	}



	// Call the visibility functions based on the checkbox states
	setPlayerVisibility(1);
	setPlayerVisibility(2);
	applySavedBallStates();

	// Initialize control panel ball images
	const ballSelection = getStorageItem("ballSelection") || "american";
	updateControlPanelBallImages(ballSelection);

	// Check game type and initialize ball set toggle visibility
	const currentGameType = getStoredGameType();
	// Restore UI without wiping live snooker visit/break state from localStorage
	gameType(currentGameType, { restore: true });

	// Properly initialize ball tracker visibility
	useBallTracker();
	if (getStorageItem("useBallSet") === null) {
		setStorageItem("useBallSet", "no");
	}
	if (typeof syncControlsTabLayout === "function") {
		syncControlsTabLayout();
	} else if (typeof syncBallSetControlsVisibility === "function") {
		syncBallSetControlsVisibility();
	}
	initBallClickTargets();
	if (typeof syncRackBreakerPickerVisibility === "function") {
		syncRackBreakerPickerVisibility();
	}
	if (typeof syncPlayerSlotPickerUI === "function") {
		syncPlayerSlotPickerUI();
	}
	if (window.PlayerStats && typeof window.PlayerStats.renderStatsVisibilityPanel === "function") {
		window.PlayerStats.renderStatsVisibilityPanel();
	}
	if (typeof initPushScoresFieldListeners === "function") {
		initPushScoresFieldListeners();
	}
	// Initialize the logo and extension status for each logo (players + slideshow logos) and player
	initializeLogoStatus();
	initializeExtensionButtonStatus();
	toggleReplayClipsVisibility();
	updateReplayButtonsVisibility();
};

async function obsReConnect() {
	const address = getObsAddress();
	const password = getObsPassword();

	try {
		await obs.connect(address, password);
		isConnected = true;
		setStorageItem('isConnected', 'true');
		updateConnectButton();
		console.log('OBS WebSocket: Connected and authenticated');
        return true;
    } catch (err) {
        console.error('Failed to connect:', err);
        const hint = `Unable to reach OBS WebSocket at ${address}.\n\n` +
            'Please confirm OBS is running, the WebSocket server is enabled, and the address/password are correct.';
        alert('Failed to connect.\n\nDetails: ' + (err?.message || err?.code || err?.toString() || 'Unknown error') + '\n\n' + hint);
        return false;
	}
}

async function obsReMonitor() {
	console.log('Monitoring is marked as active after reconnection, changing states');
	btnReplayClip.classList.remove('noShow');
}


function initializeLogoStatus() {
	// Loop through the logos (in this example logos 1 through 5)
	for (let xL = 1; xL <= 5; xL++) {
		let savedLogo = getStorageItem("customLogo" + xL);
		let containerId;
		if (xL === 1) {
			containerId = "uploadCustomLogo";
		} else if (xL === 2) {
			containerId = "uploadCustomLogo2";
		} else {
			containerId = "logoSsImg" + xL;
		}
		let container = document.getElementById(containerId);
		let fileInput = document.getElementById("FileUploadL" + xL);
		let label = document.getElementById("FileUploadLText" + xL);
		let imgElem = document.getElementById("l" + xL + "Img");

		if (savedLogo) {
			// A custom logo exists for this slot.
			// Update the preview image.
			if (imgElem) {
				imgElem.src = savedLogo;
			}
			// Display "Clear" on the label
			if (label) {
				label.textContent = "Clear";
			}
			// Bind the container's click to call clearLogo.
			if (container && fileInput) {
				container.onclick = function (e) {
					e.preventDefault();
					clearLogo(xL);
				};
				// Change styling to indicate clear mode (red background, light text)
				container.style.backgroundColor = "red";
				container.style.color = "white";
			}
		} else {
			// No custom logo; restore default settings.
			if (imgElem) {
				imgElem.src = "./common/images/placeholder.png";
			}
			if (label) {
				label.textContent = (xL === 1) ? "Upload Player 1 Logo" :
					(xL === 2) ? "Upload Player 2 Logo" : "L" + (xL - 2);
			}
			if (container && fileInput) {
				container.onclick = function (e) {
					// e.preventDefault();
					fileInput.click();
				};
				// Reset any inline styles applied previously.
				container.style.backgroundColor = "";
				container.style.color = "";
			}
		}
	}
}

function initializeExtensionButtonStatus() {
	// Player 1 Extension Button
	let extBtn1 = document.getElementById("p1extensionBtn");
	// Use a key to store if the extension is enabled. Here "enabled" means it is active.
	// If the key is not present, then consider it not enabled.
	let extStatus1 = getStorageItem("p1Extension"); // e.g., "enabled" or "disabled"
	if (extBtn1) {
		if (extStatus1 && extStatus1 === "enabled") {
			// When enabled, show Reset
			//extBtn1.textContent = "Reset";
			document.getElementById("p1extensionBtn").setAttribute("onclick", "resetExt('p1')");
			document.getElementById("p1extensionBtn").classList.add("clkd");
			var playerName = document.getElementById("p1Name").value.split(" ")[0] || "P1";
			document.getElementById("p1extensionBtn").innerHTML = "Reset " + playerName.substring(0, 9) + "'s Ext";
			extBtn1.style.backgroundColor = "red";
			extBtn1.style.color = "black";
		} else {
			//extBtn1.textContent = "Extend";
			extBtn1.style.backgroundColor = "";
			extBtn1.style.color = "";
		}
	}

	// Player 2 Extension Button
	let extBtn2 = document.getElementById("p2extensionBtn");
	let extStatus2 = getStorageItem("p2Extension");
	if (extBtn2) {
		if (extStatus2 && extStatus2 === "enabled") {
			//extBtn2.textContent = "Reset";
			document.getElementById("p2extensionBtn").setAttribute("onclick", "resetExt('p2')");
			document.getElementById("p2extensionBtn").classList.add("clkd");
			var playerName = document.getElementById("p2Name").value.split(" ")[0] || "P1";
			document.getElementById("p2extensionBtn").innerHTML = "Reset " + playerName.substring(0, 9) + "'s Ext";
			extBtn2.style.backgroundColor = "red";
			extBtn2.style.color = "black";
		} else {
			//extBtn2.textContent = "Extend";
			extBtn2.style.backgroundColor = "";
			extBtn2.style.color = "";
		}
	}
}

slider.oninput = function () {
	sliderValue = this.value / 100;
	document.getElementById("sliderValue").innerHTML = this.value + "%";  // Add this line
	bc.postMessage({ opacity: sliderValue });
}

uiScalingSlider.oninput = function () {
	sliderUiScalingValue = this.value / 100;
	document.getElementById("sliderUiScalingValue").innerHTML = this.value + "%";  // Add this line
	bc.postMessage({ scaling: sliderUiScalingValue });
}

document.getElementById('uploadCustomLogo').onclick = function () {
	// document.getElementById('uploadCustomLogo').style.border = "2px solid blue";
	document.getElementById('FileUploadL1').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('uploadCustomLogo2').onclick = function () {
	//document.getElementById('uploadCustomLogo2').style.border = "2px solid blue";
	document.getElementById('FileUploadL2').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('logoSsImg3').onclick = function () {
	//document.getElementById('logoSsImg3').style.border = "2px solid blue";
	document.getElementById('FileUploadL3').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('logoSsImg4').onclick = function () {
	//document.getElementById('logoSsImg4').style.border = "2px solid blue";
	document.getElementById('FileUploadL4').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('logoSsImg5').onclick = function () {
	//document.getElementById('logoSsImg5').style.border = "2px solid blue";
	document.getElementById('FileUploadL5').click();
	//setTimeout(rst_scr_btn, 100);
};

if (getStorageItem('p1colorSet') !== null) {
	var cvalue = getStorageItem('p1colorSet');
	var selectElement = document.getElementById('p1colorDiv');

	// Set the selected option
	for (var i = 0; i < selectElement.options.length; i++) {
		if (selectElement.options[i].value === cvalue) {
			selectElement.selectedIndex = i;
			break;
		}
	}
	document.getElementById('p1colorDiv').style.background = getStorageItem('p1colorSet');
	document.getElementById('p1Name').style.background = `linear-gradient(to right, ${getStorageItem('p1colorSet')}, white)`;
	if (cvalue == "white" || cvalue == "") {
		document.getElementById("p1colorDiv").style.color = "black"; document.getElementById("p1colorDiv").style.textShadow = "none";
	} else { document.getElementById("p1colorDiv").style.color = "white"; };
} else {
	document.getElementById("p1colorDiv").style.color = "black";
	document.getElementById("p1colorDiv").style.textShadow = "none";
}

if (getStorageItem('p2colorSet') !== null) {
	var cvalue = getStorageItem('p2colorSet');
	var selectElement = document.getElementById('p2colorDiv');

	// Set the selected option
	for (var i = 0; i < selectElement.options.length; i++) {
		if (selectElement.options[i].value === cvalue) {
			selectElement.selectedIndex = i;
			break;
		}
	}
	document.getElementById('p2colorDiv').style.background = getStorageItem('p2colorSet');
	document.getElementById('p2Name').style.background = `linear-gradient(to left, ${getStorageItem('p2colorSet')}, white)`;
	if (cvalue == "white" || cvalue == "") {
		document.getElementById("p2colorDiv").style.color = "black"; document.getElementById("p2colorDiv").style.textShadow = "none";
	} else { document.getElementById("p2colorDiv").style.color = "white"; };
}
else {
	document.getElementById("p2colorDiv").style.color = "black";
	document.getElementById("p2colorDiv").style.textShadow = "none";
}

ensureDefaultGameType();

if (getStorageItem('p1ScoreCtrlPanel') > 0 || getStorageItem('p1ScoreCtrlPanel') == "") {
	p1ScoreValue = getStorageItem('p1ScoreCtrlPanel');
	msg = { player: '1', score: p1ScoreValue };
	bc.postMessage(msg);
} else {
	p1ScoreValue = 0;
	msg = { player: '1', score: p1ScoreValue };
	bc.postMessage(msg);
}

if (getStorageItem('p2ScoreCtrlPanel') > 0 || getStorageItem('p2ScoreCtrlPanel') == "") {
	p2ScoreValue = getStorageItem('p2ScoreCtrlPanel');
	msg = { player: '2', score: p2ScoreValue };
	bc.postMessage(msg);
} else {
	p2ScoreValue = 0;
	msg = { player: '2', score: p2ScoreValue };
	bc.postMessage(msg);
}

const p1BallsValue = parseInt(getStorageItem('p1BallsCtrlPanel'), 10) || 0;
const p2BallsValue = parseInt(getStorageItem('p2BallsCtrlPanel'), 10) || 0;
bc.postMessage({ player: '1', balls: p1BallsValue });
bc.postMessage({ player: '2', balls: p2BallsValue });

if (getStorageItem("useCustomLogo") == "yes") {
	console.log("customLogo1 = TRUE");
	document.getElementById("customLogo1").checked = true;
	customLogoSetting();
} else {
	customLogoSetting()
}

if (getStorageItem("useCustomLogo2") == "yes") {
	console.log("customLogo2 = TRUE");
	document.getElementById("customLogo2").checked = true;
	customLogoSetting2();
} else {
	customLogoSetting2()
}

if (getStorageItem("useClock") == "yes") {
	console.log("Clock enabled");
	document.getElementById("useClockSetting").checked = true;
	clockSetting();
} else {
	console.log("Clock disabled");
	clockSetting()
}

if (getStorageItem("winAnimation") === "no" || getStorageItem("winAnimation") === null) {
	console.log("Win animation disabled");
	document.getElementById("winAnimation").checked = false;
	setStorageItem("winAnimation", "no");
} else {
	console.log("Win animation enabled");
	document.getElementById("winAnimation").checked = true;
	setStorageItem("winAnimation", "yes");
}
if (typeof syncWinAnimationControls === "function") {
	syncWinAnimationControls();
}

function setPlayerVisibility(playerNumber) {
	const usePlayer = getStorageItem(`usePlayer${playerNumber}`) == "yes";
	const checkbox = document.getElementById(`usePlayer${playerNumber}Setting`);
	checkbox.checked = usePlayer;
	if (usePlayer) {
		console.log(`Enable player/team ${playerNumber}`);
	}
	playerSetting(playerNumber);
}

if (getStorageItem("customLogo1") != null) { document.getElementById("l1Img").src = getStorageItem("customLogo1"); } else { document.getElementById("l1Img").src = "./common/images/placeholder.png"; };
if (getStorageItem("customLogo2") != null) { document.getElementById("l2Img").src = getStorageItem("customLogo2"); } else { document.getElementById("l2Img").src = "./common/images/placeholder.png"; };
if (getStorageItem("customLogo3") != null) { document.getElementById("l3Img").src = getStorageItem("customLogo3"); } else { document.getElementById("l3Img").src = "./common/images/placeholder.png"; };
if (getStorageItem("customLogo4") != null) { document.getElementById("l4Img").src = getStorageItem("customLogo4"); } else { document.getElementById("l4Img").src = "./common/images/placeholder.png"; };
if (getStorageItem("customLogo5") != null) { document.getElementById("l5Img").src = getStorageItem("customLogo5"); } else { document.getElementById("l5Img").src = "./common/images/placeholder.png"; };
if (getStorageItem("slideShow") == "yes") { document.getElementById("logoSlideshowChk").checked = true; logoSlideshow(); };
if (getStorageItem("obsTheme") == "28") { document.getElementById("obsTheme").value = "28"; }
// if (getStorageItem("b_style") == "1") { document.getElementById("bsStyle").value = "1"; }
// if (getStorageItem("b_style") == "2") { document.getElementById("bsStyle").value = "2"; }
// if (getStorageItem("b_style") == "3") { document.getElementById("bsStyle").value = "3"; }
if (getStorageItem("clogoNameStored") != null) { cLogoName = getStorageItem("clogoNameStored"); }
if (getStorageItem("clogoName2Stored") != null) { cLogoName2 = getStorageItem("clogoName2Stored"); }
document.getElementById("logoName").innerHTML = cLogoName.substring(0, 13);
document.getElementById("logoName2").innerHTML = cLogoName2.substring(0, 13);
document.getElementById("p1Name").value = getStorageItem("p1NameCtrlPanel");
document.getElementById("p1Score").value = getStorageItem("p1ScoreCtrlPanel");
document.getElementById("p2Name").value = getStorageItem("p2NameCtrlPanel");
document.getElementById("p2Score").value = getStorageItem("p2ScoreCtrlPanel");
const p1BallsInput = document.getElementById("p1Balls");
const p2BallsInput = document.getElementById("p2Balls");
if (p1BallsInput) {
	p1BallsInput.value = getStorageItem("p1BallsCtrlPanel") || "0";
}
if (p2BallsInput) {
	p2BallsInput.value = getStorageItem("p2BallsCtrlPanel") || "0";
}
document.getElementById("pointBased").checked = getStorageItem("pointBased") === "yes";
syncGameTypeSelect(getStoredGameType());
if (getStoredGameType() === "game2") {
	document.getElementById("ball 10").classList.add("noShow");
	document.getElementById("ball 11").classList.add("noShow");
	document.getElementById("ball 12").classList.add("noShow");
	document.getElementById("ball 13").classList.add("noShow");
	document.getElementById("ball 14").classList.add("noShow");
	document.getElementById("ball 15").classList.add("noShow");
} else if (getStoredGameType() === "game3") {
	document.getElementById("ball 10").classList.remove("noShow");
	document.getElementById("ball 11").classList.add("noShow");
	document.getElementById("ball 12").classList.add("noShow");
	document.getElementById("ball 13").classList.add("noShow");
	document.getElementById("ball 14").classList.add("noShow");
	document.getElementById("ball 15").classList.add("noShow");
} else {
	document.getElementById("ball 10").classList.remove("noShow");
	document.getElementById("ball 11").classList.remove("noShow");
	document.getElementById("ball 12").classList.remove("noShow");
	document.getElementById("ball 13").classList.remove("noShow");
	document.getElementById("ball 14").classList.remove("noShow");
	document.getElementById("ball 15").classList.remove("noShow");
}
if (typeof syncPoolFoulButtonVisibility === "function") {
	syncPoolFoulButtonVisibility();
}
if (typeof syncBallTrackerRows === "function") {
	syncBallTrackerRows();
}
document.getElementById("raceInfoTxt").value = getStorageItem("raceInfo");
document.getElementById("gameInfoTxt").value = getStorageItem("gameInfo");
document.getElementById("verNum").innerHTML = versionNum;

const replaySceneNameInput = document.getElementById('replaySceneName');
if (replaySceneNameInput) {
    replaySceneNameInput.value = getStorageItem("replaySceneName");
}
document.getElementById('replayVideoSourceName').value = getStorageItem("replayVideoSourceName");
document.getElementById('replayIndicatorSourceName').value = getStorageItem("replayIndicatorSourceName");

if (typeof updateScoreControlAvailability === 'function') {
    updateScoreControlAvailability();
}

// Initialize ball set selection from storage
const savedBallSet = getStorageItem("playerBallSet");
if (savedBallSet) {
	const radioButton = document.querySelector(`input[name="p1BallSetSelect"][value="${savedBallSet}"]`);
	if (radioButton) {
		radioButton.checked = true;
		// Trigger the ball set change to update the display
		ballSetChange();
	}
} else {
	// Default to "Open Table" if no selection is saved
	document.getElementById('p1colorOpen').checked = true;
	setStorageItem("playerBallSet", "p1Open");
	bc.postMessage({ playerBallSet: "p1Open" });
}
// document.getElementById("psVerNum").innerHTML = psVersionNum;
postNames(); postInfo(); startThemeCheck();

if (window.PlayerStats) {
    window.PlayerStats.init().then(function () {
        window.PlayerStats.initPlayerAutocomplete();
        window.PlayerStats.syncOverlayButtonsFromStorage();
        return window.PlayerStats.onNamesUpdated();
    }).then(function () {
        window.PlayerStats.broadcastOverlayStatsIfEnabled();
    }).catch(function (err) {
        console.error('PlayerStats init error:', err);
    });
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// broadcast channel events from browser_source
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////			

bcr.onmessage = (event) => {
	const clockDisplay = document.getElementById("clockLocalDisplay");
	clockDisplay.style.background = "green";
	clockDisplay.style.border = "2px solid black";
	clockDisplay.innerHTML = event.data + "s";
	tev = event.data;
	console.log(tev);
	if (tev > 20) { document.getElementById("clockLocalDisplay").style.color = "white"; };
	if (tev > 5 && tev < 21) { document.getElementById("clockLocalDisplay").style.color = "black"; };
	if (tev < 21) { document.getElementById("clockLocalDisplay").style.background = "orange"; };
	if (tev < 16) { document.getElementById("clockLocalDisplay").style.background = "yellow"; };
	if (tev < 11) { document.getElementById("clockLocalDisplay").style.background = "tomato"; };
	if (tev == 10) {
		document.getElementById("shotClockShow").setAttribute("onclick", "clockDisplay('hide')");
		document.getElementById("shotClockShow").innerHTML = "Hide Clock";
		document.getElementById("shotClockShow").style.border = "2px solid black";
	}
	if (tev < 6 && tev > 0) {    //tev > 0   this prevents both sounds from playing at 0.
		document.getElementById("clockLocalDisplay").style.background = "red";
		document.getElementById("clockLocalDisplay").style.color = "white";
		warningBeep.loop = false;
		warningBeep.play();
	}
	if (tev == 0) {
		foulSound.loop = false;
		foulSound.play();
		setTimeout("stopClock()", 1000);
	}
}
