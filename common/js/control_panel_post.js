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
// variable declarations
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var cLogoName = "Player 1 Logo";  // 13 character limit. it will auto trim to 13 characters.
var cLogoName2 = "Player 2 Logo";
const bc = new BroadcastChannel('g4-main');
const bcr = new BroadcastChannel('g4-recv'); // return channel from browser_source 
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

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// onload stuff
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

window.onload = function() {
	// Set local storage values if not previously configured
	if (localStorage.getItem("usePlayer1") === null) {
		localStorage.setItem("usePlayer1", "yes");
	}
	if (localStorage.getItem("usePlayer2") === null) {
		localStorage.setItem("usePlayer2", "yes");
	}

	if (localStorage.getItem("usePlayerToggle")==="yes" || localStorage.getItem("usePlayerToggle") === null) {
		document.getElementById("useToggleSetting").checked = true;
		localStorage.setItem("usePlayerToggle", "yes");
		toggleSetting();
	} else {
		document.getElementById("useToggleSetting").checked = false;
		localStorage.setItem("usePlayerToggle", "no");
		toggleSetting();
	}

	if (localStorage.getItem("usePlayer1") === "yes" && localStorage.getItem("usePlayer2") === "yes" && localStorage.getItem("usePlayerToggle") === "yes"){
		console.log(`We should be showing active player identifier`);
		const activePlayer = localStorage.getItem("activePlayer") === "2" ? "2" : "1";
		localStorage.setItem("activePlayer", activePlayer);
		document.getElementById("playerToggleCheckbox").checked = activePlayer === "1";
		localStorage.setItem("toggleState", activePlayer === "1");
		console.log(`activePlayer: ${activePlayer}`);
		bc.postMessage({ clockDisplay: 'showActivePlayer', player: activePlayer });
	}

	// Simplified activePlayer initialization
	// const activePlayer = localStorage.getItem("activePlayer") === "2" ? "2" : "1";
	// localStorage.setItem("activePlayer", activePlayer);
	// document.getElementById("playerToggleCheckbox").checked = activePlayer === "1";
	// localStorage.setItem("toggleState", activePlayer === "1");
	// bc.postMessage({ clockDisplay: 'showActivePlayer', player: activePlayer });

	if (localStorage.getItem("p1Score") === null) {
		localStorage.setItem("p1Score", "0");
	}
	if (localStorage.getItem("p2Score") === null) {
		localStorage.setItem("p2Score", "0");
	}

	if (localStorage.getItem("gameType") === null) {
		localStorage.setItem("gameType", "game1");
		document.getElementById("gameType").value = localStorage.getItem("gameType");
	}

	var savedOpacity = localStorage.getItem('overlayOpacity');
	if (savedOpacity) {
		document.getElementById('scoreOpacity').value = savedOpacity;
		document.getElementById('sliderValue').innerText = savedOpacity + '%'; // Update displayed value
	}

	if (localStorage.getItem("enableBallTracker") === "true"){
		document.getElementById("ballTrackerCheckbox").checked = true;
		document.getElementById("ballTracker").classList.remove("noShow");
		console.log(`Ball tracker enabled`);
		bc.postMessage({ displayBallTracker: true });
	} else {
		document.getElementById("ballTrackerCheckbox").checked = false;
		localStorage.setItem("enableBallTracker", "false");
		document.getElementById("ballTracker").classList.add("noShow");
		console.log(`Ball tracker disabled`);
		bc.postMessage({ displayBallTracker: false });
	}

	// Call the visibility functions based on the checkbox states
    setPlayerVisibility(1);
    setPlayerVisibility(2);
	applySavedBallStates();

	// Initialize the logo and extension status for each logo (players + slideshow logos) and player
	initializeLogoStatus();
	initializeExtensionButtonStatus();
};

function initializeLogoStatus() {
	// Loop through the logos (in this example logos 1 through 5)
	for (let xL = 1; xL <= 5; xL++) {
		let savedLogo = localStorage.getItem("customLogo" + xL);
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
		let label  = document.getElementById("FileUploadLText" + xL);
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
				container.onclick = function(e) {
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
									(xL === 2) ? "Upload Player 2 Logo" : "L" + (xL-2);
			}
			if (container && fileInput) {
				container.onclick = function(e) {
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
    let extStatus1 = localStorage.getItem("p1Extension"); // e.g., "enabled" or "disabled"
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
    let extStatus2 = localStorage.getItem("p2Extension");
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

if (localStorage.getItem('p1colorSet') !== null) {
	var cvalue = localStorage.getItem('p1colorSet');
	var selectElement = document.getElementById('p1colorDiv');
    
    // Set the selected option
    for (var i = 0; i < selectElement.options.length; i++) {
        if (selectElement.options[i].value === cvalue) {
            selectElement.selectedIndex = i;
            break;
        }
    }
	document.getElementById('p1colorDiv').style.background = localStorage.getItem('p1colorSet');
	document.getElementById('p1Name').style.background = `linear-gradient(to right, ${localStorage.getItem('p1colorSet')}, white)`;
	document.getElementsByTagName("select")[0].options[0].value = cvalue;
	if (cvalue == "white") { document.getElementById("p1colorDiv").style.color = "black"; } else { document.getElementById("p1colorDiv").style.color = "white"; };
	// if (cvalue == "cadetblue" || cvalue == "steelblue" || cvalue == "grey" ||cvalue == "lightgrey" || cvalue == "green" || cvalue == "khaki" || cvalue == "tomato" || cvalue == "red" || cvalue == "white" || cvalue == "orangered" || cvalue == "orange" || cvalue == "lightgreen" || cvalue == "lightseagreen") { document.getElementById("p1colorDiv").style.color = "#000"; } else { document.getElementById("p1colorDiv").style.color = "lightgrey"; };
}

if (localStorage.getItem('p2colorSet') !== null) {
	var cvalue = localStorage.getItem('p2colorSet');
	var selectElement = document.getElementById('p2colorDiv');
    
    // Set the selected option
    for (var i = 0; i < selectElement.options.length; i++) {
        if (selectElement.options[i].value === cvalue) {
            selectElement.selectedIndex = i;
            break;
        }
    }
	document.getElementById('p2colorDiv').style.background = localStorage.getItem('p2colorSet');
	document.getElementById('p2Name').style.background = `linear-gradient(to left, ${localStorage.getItem('p2colorSet')}, white)`;
	if (cvalue == "white") { document.getElementById("p2colorDiv").style.color = "black"; } else { document.getElementById("p2colorDiv").style.color = "white"; };
	// if (cvalue == "cadetblue" || cvalue == "steelblue" || cvalue == "grey" || cvalue == "lightgrey" || cvalue == "green" || cvalue == "khaki" || cvalue == "tomato" || cvalue == "red" || cvalue == "orangered" || cvalue == "white" || cvalue == "orange" || cvalue == "lightgreen" || cvalue == "lightseagreen") { document.getElementById("p2colorDiv").style.color = "#000"; } else { document.getElementById("p2colorDiv").style.color = "lightgrey"; };
}

if (localStorage.getItem('p1ScoreCtrlPanel') > 0 || localStorage.getItem('p1ScoreCtrlPanel') == "") {
	p1ScoreValue = localStorage.getItem('p1ScoreCtrlPanel');
	msg = { player: '1', score: p1ScoreValue };
	bc.postMessage(msg);
} else {
	p1ScoreValue = 0;
	msg = { player: '1', score: p1ScoreValue };
	bc.postMessage(msg);
}

if (localStorage.getItem('p2ScoreCtrlPanel') > 0 || localStorage.getItem('p2ScoreCtrlPanel') == "") {
	p2ScoreValue = localStorage.getItem('p2ScoreCtrlPanel');
	msg = { player: '2', score: p2ScoreValue };
	bc.postMessage(msg);
} else {
	p2ScoreValue = 0;
	msg = { player: '2', score: p2ScoreValue };
	bc.postMessage(msg);
}

if (localStorage.getItem("useCustomLogo") == "yes") {
	console.log("customLogo1 = TRUE");
	document.getElementById("customLogo1").checked = true;
	customLogoSetting();
} else {
	customLogoSetting()
}

if (localStorage.getItem("useCustomLogo2") == "yes") {
	console.log("customLogo2 = TRUE");
	document.getElementById("customLogo2").checked = true;	
	customLogoSetting2();
} else {
	customLogoSetting2()
}

if (localStorage.getItem("useClock") == "yes") {
	console.log("Clock enabled");
	document.getElementById("useClockSetting").checked = true;
	clockSetting();
} else {
	console.log("Clock disabled");
	clockSetting()
}

if (localStorage.getItem("winAnimation") === "no" || localStorage.getItem("winAnimation") === null) {
	console.log("Win animation disabled");
	document.getElementById("winAnimation").checked = false;
	localStorage.setItem("winAnimation", "no");
} else {
	console.log("Win animation enabled");
	document.getElementById("winAnimation").checked = true;
	localStorage.setItem("winAnimation", "yes");
}

function setPlayerVisibility(playerNumber) {
	const usePlayer = localStorage.getItem(`usePlayer${playerNumber}`) == "yes";
	const checkbox = document.getElementById(`usePlayer${playerNumber}Setting`);
	checkbox.checked = usePlayer;
	if (usePlayer) {
		console.log(`Enable player/team ${playerNumber}`);
	}
	playerSetting(playerNumber);
}
  
//   setPlayerVisibility(1);
//   setPlayerVisibility(2);

if (localStorage.getItem("customLogo1") != null) { document.getElementById("l1Img").src = localStorage.getItem("customLogo1"); } else { document.getElementById("l1Img").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("customLogo2") != null) { document.getElementById("l2Img").src = localStorage.getItem("customLogo2"); } else { document.getElementById("l2Img").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("customLogo3") != null) { document.getElementById("l3Img").src = localStorage.getItem("customLogo3"); } else { document.getElementById("l3Img").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("customLogo4") != null) { document.getElementById("l4Img").src = localStorage.getItem("customLogo4"); } else { document.getElementById("l4Img").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("customLogo5") != null) { document.getElementById("l5Img").src = localStorage.getItem("customLogo5"); } else { document.getElementById("l5Img").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("slideShow") == "yes") { document.getElementById("logoSlideshowChk").checked = true; logoSlideshow(); };
if (localStorage.getItem("obsTheme") == "28") { document.getElementById("obsTheme").value = "28"; }
if (localStorage.getItem("b_style") == "1") { document.getElementById("bsStyle").value = "1"; }
if (localStorage.getItem("b_style") == "2") { document.getElementById("bsStyle").value = "2"; }
if (localStorage.getItem("b_style") == "3") { document.getElementById("bsStyle").value = "3"; }
if (localStorage.getItem("clogoNameStored") != null) { cLogoName = localStorage.getItem("clogoNameStored"); }
if (localStorage.getItem("clogoName2Stored") != null) { cLogoName2 = localStorage.getItem("clogoName2Stored"); }
document.getElementById("logoName").innerHTML = cLogoName.substring(0, 13);
document.getElementById("logoName2").innerHTML = cLogoName2.substring(0, 13);
document.getElementById("p1Name").value = localStorage.getItem("p1NameCtrlPanel");
document.getElementById("p1Score").value = localStorage.getItem("p1ScoreCtrlPanel");
document.getElementById("p2Name").value = localStorage.getItem("p2NameCtrlPanel");
document.getElementById("p2Score").value = localStorage.getItem("p2ScoreCtrlPanel");
document.getElementById("gameType").value = localStorage.getItem("gameType");
document.getElementById("raceInfoTxt").value = localStorage.getItem("raceInfo");
document.getElementById("gameInfoTxt").value = localStorage.getItem("gameInfo");
document.getElementById("verNum").innerHTML = versionNum;
postNames(); postInfo(); startThemeCheck();

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
