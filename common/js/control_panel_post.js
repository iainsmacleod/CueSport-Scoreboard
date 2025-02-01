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

	if (localStorage.getItem("activePlayer") === null || (localStorage.getItem("activePlayer") === "1")) {
		localStorage.setItem("activePlayer", "1");
		document.getElementById("playerToggleCheckbox").checked = true;
		localStorage.setItem("toggleState", true);
	} else if (localStorage.getItem("activePlayer") === "2") {
		localStorage.setItem("activePlayer", "2");
		document.getElementById("playerToggleCheckbox").checked = false;
		localStorage.setItem("toggleState", false);
	} else {
		console.log("activePlayer =", localStorage.getItem("activePlayer"));
	}

	if (localStorage.getItem("usePlayerToggle")==="yes" || localStorage.getItem("usePlayerToggle") === null) {
		document.getElementById("useToggleSetting").checked = true;
	} else {
		document.getElementById("useToggleSetting").checked = false;
	}

	// Call the visibility functions based on the checkbox states
    setPlayerVisibility(1);
    setPlayerVisibility(2);
	toggleSetting();

    // Check if custom logos exist in local storage and enable checkboxes accordingly
    if (localStorage.getItem("customLogo1") != null) {
        document.getElementById("customLogo1").disabled = false; // Enable checkbox for Player 1
    }
    if (localStorage.getItem("customLogo2") != null) {
		document.getElementById("customLogo2").disabled = false; // Enable checkbox for Player 2
    }

	var savedOpacity = localStorage.getItem('overlayOpacity');
		if (savedOpacity) {
			document.getElementById('scoreOpacity').value = savedOpacity;
			document.getElementById('sliderValue').innerText = savedOpacity + '%'; // Update displayed value
		}
};

slider.oninput = function () {
	sliderValue = this.value / 100;
	document.getElementById("sliderValue").innerHTML = this.value + "%";  // Add this line
	bc.postMessage({ opacity: sliderValue });
}

document.getElementById('uploadCustomLogo').onclick = function () {
	document.getElementById('uploadCustomLogo').style.border = "2px solid blue";
	document.getElementById('FileUploadL1').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('uploadCustomLogo2').onclick = function () {
	document.getElementById('uploadCustomLogo2').style.border = "2px solid blue";
	document.getElementById('FileUploadL2').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('logoSsImg3').onclick = function () {
	document.getElementById('logoSsImg3').style.border = "2px solid blue";
	document.getElementById('FileUploadL3').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('logoSsImg4').onclick = function () {
	document.getElementById('logoSsImg4').style.border = "2px solid blue";
	document.getElementById('FileUploadL4').click();
	//setTimeout(rst_scr_btn, 100);
};

document.getElementById('logoSsImg5').onclick = function () {
	document.getElementById('logoSsImg5').style.border = "2px solid blue";
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
	console.log("Clock = TRUE");
	document.getElementById("useClockSetting").checked = true;
	clockSetting();
} else {
	clockSetting()
}

function setPlayerVisibility(playerNumber) {
	const usePlayer = localStorage.getItem(`usePlayer${playerNumber}`) == "yes";
	const checkbox = document.getElementById(`usePlayer${playerNumber}Setting`);
	checkbox.checked = usePlayer;
	if (usePlayer) {
		console.log(`Use Player ${playerNumber} = TRUE`);
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
// if (localStorage.getItem("raceInfo") != null) {document.getElementById("raceInfoTxt").value = localStorage.getItem("raceInfo")}
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
