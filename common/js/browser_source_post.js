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

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//										variable declarations
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////			

var countDownTime;
var shotClockxr = null;
const bcr = new BroadcastChannel('g4-recv'); // browser_source -> control_panel channel 
const bc = new BroadcastChannel('g4-main');
var playerNumber;

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//										broadcast channel events
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////			

bc.onmessage = (event) => {
	if (event.data.score != null) {
		console.log("event.data.player: " + event.data.player + "  event.data.score: " + event.data.score);
		if (event.data.score > document.getElementById("player" + event.data.player + "Score").innerHTML) {
			document.getElementById("player" + event.data.player + "Score").innerHTML = event.data.score;
			document.getElementById("player" + event.data.player + "Score").classList.add("winBlink");
			// Update the control_panel score on click
			document.getElementById("player" + event.data.player + "Score").textContent = event.data.score;
			setTimeout("clearWinBlink()", 500);
		} else {
			document.getElementById("player" + event.data.player + "Score").innerHTML = event.data.score;
		}
	}

	if (event.data.opacity != null) {
		console.log("Opacity setting: " + event.data.opacity);
		document.getElementById("scoreBoardDiv").style.opacity = event.data.opacity;
		document.getElementById("raceInfo").style.opacity = event.data.opacity;
		document.getElementById("wagerInfo").style.opacity = event.data.opacity;
	}

	if (event.data.race != null) {
		console.log("Race info: " + event.data.race);
		if (event.data.race == "") {
			document.getElementById("raceInfo").classList.add("noShow");
			document.getElementById("raceInfo").classList.remove("fadeInElm");
		} else {
			document.getElementById("raceInfo").classList.remove("noShow");
			document.getElementById("raceInfo").classList.add("fadeInElm");
			document.getElementById("raceInfo").innerHTML = event.data.race;
		}
	}

	if (event.data.wager != null) {
		console.log("Wager info: " + event.data.wager);
		if (event.data.wager == "") {
			document.getElementById("wagerInfo").classList.add("noShow");
			document.getElementById("wagerInfo").classList.remove("fadeInElm");
		} else {
			document.getElementById("wagerInfo").classList.remove("noShow");
			document.getElementById("wagerInfo").classList.add("fadeInElm");
			document.getElementById("wagerInfo").innerHTML = event.data.wager;
		}
	}

	if (event.data.time != null) {
		console.log("event.data.time: " + event.data.time);
		shotTimer(event.data.time);
	}

	if (event.data.color != null) {
		console.log("Player: " + event.data.player + " using color: " + event.data.color);
		if (event.data.player == "1") { document.getElementById("player" + event.data.player + "Name").style.background = "linear-gradient(to left, white, " + event.data.color; };
		if (event.data.player == "2") { document.getElementById("player" + event.data.player + "Name").style.background = "linear-gradient(to right, white, " + event.data.color; };
	}

	if (event.data.name != null) {
		console.log("Player/Team: " + event.data.player + " named " + event.data.name);
		if (!event.data.name == "") {
			document.getElementById("player" + event.data.player + "Name").innerHTML = event.data.name;
		} else {
			document.getElementById("player" + event.data.player + "Name").innerHTML = "Player " + event.data.player;
		}
	}

	if (event.data.playerDisplay != null) {
		// Code to assist with displaying active player image when only tow players are enabled, on reload.
		const player1Enabled = localStorage.getItem("usePlayer1") === "yes";
		const player2Enabled = localStorage.getItem("usePlayer2") === "yes";
		const bothPlayersEnabled = player1Enabled && player2Enabled;
		console.log("Player display action: " + event.data.playerDisplay + " number " + event.data.playerNumber);
		if (event.data.playerDisplay == "showPlayer") {
			if (localStorage.getItem("useClock") === "yes" && bothPlayersEnabled) {
				console.log("Use clock evaluating as enabled");
				document.getElementById("p1ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
				document.getElementById("p2ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
			} else {
				console.log("Use clock evaluating as not enabled");
			}
			// Check if both players are enabled before fading in the player images
			if (bothPlayersEnabled) {
				const activePlayer = localStorage.getItem("activePlayer");
				document.getElementById("player1Image").classList.replace(activePlayer === "1" ? "fadeOutElm" : "fadeInElm", activePlayer === "1" ? "fadeInElm" : "fadeOutElm");
				document.getElementById("player2Image").classList.replace(activePlayer === "2" ? "fadeOutElm" : "fadeInElm", activePlayer === "2" ? "fadeInElm" : "fadeOutElm");
			}
			if (player1Enabled && localStorage.getItem("useCustomLogo")=="yes") {
				document.getElementById("customLogo1").classList.replace("fadeOutElm", "fadeInElm");
			}
			if (player2Enabled && localStorage.getItem("useCustomLogo2")=="yes") {
				document.getElementById("customLogo2").classList.replace("fadeOutElm", "fadeInElm");
			}
			showPlayer(event.data.playerNumber);

			// Add a small delay to check after showPlayer has completed
			setTimeout(() => {
				// Debug logs
				console.log("Player1 status:", localStorage.getItem("usePlayer1"));
				console.log("Player2 status:", localStorage.getItem("usePlayer2"));
				if (localStorage.getItem("usePlayer1") === "yes" && localStorage.getItem("usePlayer2") === "yes") {
					console.log("Both players enabled, showing scores");
					showScores();
				} else {
					console.log("Not all players enabled, scores remain hidden");
				}
			}, 50); // Small delay to ensure localStorage is updated
		};
		if (event.data.playerDisplay == "hidePlayer") { 
			hidePlayer(event.data.playerNumber); 
			hideScores();
			hideClock();
			document.getElementById("p1ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
			document.getElementById("p2ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
			document.getElementById("player1Image").classList.replace("fadeInElm", "fadeOutElm");
			document.getElementById("player2Image").classList.replace("fadeInElm", "fadeOutElm");
			document.getElementById("customLogo"+ event.data.playerNumber).classList.replace("fadeInElm", "fadeOutElm");
		};
	}

	// start of original clockDisplay channel 
	if (event.data.clockDisplay != null) {
		console.log("event.data.clockDisplay: " + event.data.clockDisplay);
		if (event.data.clockDisplay == "show") { showClock(); };
		if (event.data.clockDisplay == "hide") { hideClock(); };
		if (event.data.clockDisplay == "stopClock") { stopClock(); };
		if (event.data.clockDisplay == "noClock") {
			document.getElementById("p1ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
			document.getElementById("p2ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
		}
		if (event.data.clockDisplay == "useClock") {
			document.getElementById("p1ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
			document.getElementById("p2ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
		}
		if (event.data.clockDisplay == "p1extension") { add30(1); };
		if (event.data.clockDisplay == "p2extension") { add30(2); };
		if (event.data.clockDisplay == "p1ExtReset") { extReset('p1'); };
		if (event.data.clockDisplay == "p2ExtReset") { extReset('p2'); };
		if (event.data.clockDisplay == "hidesalotto") { salottoHide(); };
		if (event.data.clockDisplay == "showsalotto") { salottoShow(); };
		if (event.data.clockDisplay == "hidecustomLogo") { 
			customHide(); 
		}
		if (event.data.clockDisplay == "showcustomLogo") { 
			customShow(); 
		}
		if (event.data.clockDisplay == "hidecustomLogo2") { 
			custom2Hide(); 
		}
		if (event.data.clockDisplay == "showcustomLogo2") { 
			custom2Show(); 
		}
		if (event.data.clockDisplay == "postLogo") { postLogo(); };
		if (event.data.clockDisplay == "logoSlideShow-show") {
			customHide();
			document.getElementById("logoSlideshowDiv").classList.replace("fadeOutElm", "fadeInElm");
			if (localStorage.getItem("customLogo3") != null) { document.getElementById("customLogo3").src = localStorage.getItem("customLogo3"); } else { document.getElementById("customLogo3").src = "./common/images/placeholder.png"; };
			if (localStorage.getItem("customLogo4") != null) { document.getElementById("customLogo4").src = localStorage.getItem("customLogo4"); } else { document.getElementById("customLogo4").src = "./common/images/placeholder.png"; };
			if (localStorage.getItem("customLogo5") != null) { document.getElementById("customLogo5").src = localStorage.getItem("customLogo5"); } else { document.getElementById("customLogo5").src = "./common/images/placeholder.png"; };
		}
		if (event.data.clockDisplay == "logoSlideShow-hide") { document.getElementById("logoSlideshowDiv").classList.replace("fadeInElm", "fadeOutElm"); };
		// if (event.data.clockDisplay == "style100") { styleChange(1); };
		if (event.data.clockDisplay == "style125") { styleChange(1); };
		if (event.data.clockDisplay == "style150") { styleChange(2); };
		if (event.data.clockDisplay == "style200") { styleChange(3); };
		// if (event.data.clockDisplay === 'showActivePlayer') {
		// 	// Additional logic when images are shown, if needed
		// 	console.log("Player is now showing.");
		// 	showActivePlayer();
		// } else if (event.data.clockDisplay === 'hideActivePlayer') {
		// 	// Additional logic when images are hidden, if needed
		// 	console.log("Player is now showing 2.");
		// 	hideActivePlayer();
		// }
		if (event.data.clockDisplay === 'toggleActivePlayer') {
			const activePlayer = event.data.player; // Get the active player from the message
			toggleActivePlayer(activePlayer); // Call the function to update the display
		}
		if (event.data.clockDisplay === 'showActivePlayer'){
			const activePlayer = event.data.player; // Get the active player from the message
			const playerToToggle = activePlayer === true ? 1 : (activePlayer === false ? 2 : 1); // Convert true/false to 1/2
			console.log(`Indicate active player, set to player ${activePlayer}`);
			if (playerToToggle) {
				toggleActivePlayer(playerToToggle); // Call the function to update the display
			}
		}
		if (event.data.clockDisplay === 'hideActivePlayer'){
			document.getElementById("player1Image").classList.replace("fadeInElm", "fadeOutElm");
			document.getElementById("player2Image").classList.replace("fadeInElm", "fadeOutElm");
		}
	}
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////			
//							autostart stuff
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function setCustomLogo(logoId, useCustomLogoKey, usePlayerKey) {
    if (localStorage.getItem(logoId) !== null && localStorage.getItem(logoId) !== "") {
        document.getElementById(logoId).src = localStorage.getItem(logoId);
        if (localStorage.getItem(useCustomLogoKey) === "yes" && localStorage.getItem(usePlayerKey) === "yes") {
            document.getElementById(logoId).classList.replace("fadeOutElm", "fadeInElm");
        }
    } else {
        document.getElementById(logoId).src = "./common/images/placeholder.png";
    }
}

setCustomLogo("customLogo1", "useCustomLogo", "usePlayer1");
setCustomLogo("customLogo2", "useCustomLogo2", "usePlayer2");

if (localStorage.getItem("customLogo3") != null) { document.getElementById("customLogo3").src = localStorage.getItem("customLogo3"); } else { document.getElementById("customLogo3").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("customLogo4") != null) { document.getElementById("customLogo4").src = localStorage.getItem("customLogo4"); } else { document.getElementById("customLogo4").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("customLogo5") != null) { document.getElementById("customLogo5").src = localStorage.getItem("customLogo5"); } else { document.getElementById("customLogo5").src = "./common/images/placeholder.png"; };
if (localStorage.getItem("slideShow") == "yes") {
	document.getElementById("logoSlideshowDiv").classList.replace("fadeOutElm", "fadeInElm");
	document.getElementById("logoSlideshowDiv").classList.replace("fadeOutElm", "fadeInElm");
}

if (localStorage.getItem("p1NameCtrlPanel") != "" || localStorage.getItem("p1NameCtrlPanel") != null) {
	document.getElementById("player1Name").innerHTML = localStorage.getItem("p1NameCtrlPanel");
}
if (localStorage.getItem("p1NameCtrlPanel") == "" || localStorage.getItem("p1NameCtrlPanel") == null) {
	document.getElementById("player1Name").innerHTML = "Player 1";
}

if (localStorage.getItem("p2NameCtrlPanel") != "" || localStorage.getItem("p2NameCtrlPanel") != null) {
	document.getElementById("player2Name").innerHTML = localStorage.getItem("p2NameCtrlPanel");
}
if (localStorage.getItem("p2NameCtrlPanel") == "" || localStorage.getItem("p2NameCtrlPanel") == null) {
	document.getElementById("player2Name").innerHTML = "Player 2";
}

// Code to assist with displaying active player image when only tow players are enabled, on reload.
const player1Enabled = localStorage.getItem("usePlayer1") === "yes";
const player2Enabled = localStorage.getItem("usePlayer2") === "yes";
const bothPlayersEnabled = player1Enabled && player2Enabled;
const playerToggleEnabled = localStorage.getItem("usePlayerToggle") === "yes";

if (bothPlayersEnabled && playerToggleEnabled) {
    const activePlayer = localStorage.getItem("activePlayer");
    document.getElementById("player1Image").classList.replace(activePlayer === "1" ? "fadeOutElm" : "fadeInElm", activePlayer === "1" ? "fadeInElm" : "fadeOutElm");
    document.getElementById("player2Image").classList.replace(activePlayer === "2" ? "fadeOutElm" : "fadeInElm", activePlayer === "2" ? "fadeInElm" : "fadeOutElm");
} else {
    // Hide both players if not enabled
    document.getElementById("player1Image").classList.replace("fadeInElm", "fadeOutElm");
    document.getElementById("player2Image").classList.replace("fadeInElm", "fadeOutElm");
}

if (localStorage.getItem("p1ScoreCtrlPanel") != null) {
	document.getElementById("player1Score").innerHTML = localStorage.getItem("p1ScoreCtrlPanel");
} else {
	document.getElementById("player1Score").innerHTML = 0;
}

if (localStorage.getItem("p2ScoreCtrlPanel") != null) {
	document.getElementById("player2Score").innerHTML = localStorage.getItem("p2ScoreCtrlPanel");
} else {
	document.getElementById("player2Score").innerHTML = 0;
}

if (localStorage.getItem("wagerInfo") != "" && localStorage.getItem("wagerInfo") != null) {
	document.getElementById("wagerInfo").classList.remove("noShow");
}

if (localStorage.getItem("raceInfo") != "" && localStorage.getItem("raceInfo") != null) {
	document.getElementById("raceInfo").classList.remove("noShow");
}

document.getElementById("wagerInfo").innerHTML = localStorage.getItem("wagerInfo");
document.getElementById("raceInfo").innerHTML = localStorage.getItem("raceInfo");

function updateIconsVisibility(show) {
    const action = show ? "fadeInElm" : "fadeOutElm";
    document.getElementById("p1ExtIcon").classList.replace(show ? "fadeOutElm" : "fadeInElm", action);
    document.getElementById("p2ExtIcon").classList.replace(show ? "fadeOutElm" : "fadeInElm", action);
}

if (localStorage.getItem("useClock") == "yes" && bothPlayersEnabled) {
    console.log("Icons shown due to conditions met.");
    updateIconsVisibility(true);
} else {
    console.log("Icons not shown due to conditions not met.");
    updateIconsVisibility(false);
}

if (localStorage.getItem(("usePlayer1")) != "yes") {
	document.getElementById("player1Name").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player1Score").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player2Score").classList.replace("fadeInElm", "fadeOutElm");
}
if (localStorage.getItem(("usePlayer2")) != "yes") {
	document.getElementById("player2Name").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player1Score").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player2Score").classList.replace("fadeInElm", "fadeOutElm");
}

if (localStorage.getItem('p1colorSet') != "") {
	document.getElementById("player1Name").style.background = "linear-gradient(to left, white, " + localStorage.getItem('p1colorSet');
	console.log("p1color: " + localStorage.getItem('p1colorSet'));
}
if (localStorage.getItem('p2colorSet') != "") {
	document.getElementById("player2Name").style.background = "linear-gradient(to right, white, " + localStorage.getItem('p2colorSet');
	console.log("p2color: " + localStorage.getItem('p2colorSet'));
}

if (localStorage.getItem("b_style") != null) {
	styleChange(localStorage.getItem("b_style"));
} else {
	// document.styleSheets[0].disabled = true;
	document.styleSheets[0].disabled = true;
	document.styleSheets[1].disabled = true;
	document.styleSheets[2].disabled = false;
	localStorage.setItem("b_style", "3");      // Store XL as default
}

let slideIndex = 0;
showSlides();
