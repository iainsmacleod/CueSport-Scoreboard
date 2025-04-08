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
const urlParams = new URLSearchParams(window.location.search);
const INSTANCE_ID = urlParams.get('instance') || '';
const bcr = new BroadcastChannel(`recv_${INSTANCE_ID}`); // browser_source -> control_panel channel 
const bc = new BroadcastChannel(`main_${INSTANCE_ID}`);
var playerNumber;

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//										broadcast channel events
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////			

// First, separate handlers into distinct functions
const handlers = {
    ballTracker(data) {
        console.log('Ball tracker value:', data.ballTracker);
        if (data.ballTracker === "vertical") {
            document.getElementById("ballTracker").style.display = "flex";
            document.getElementById("ballTracker").style.flexDirection = "column";
            console.log('Changed ball tracker direction to vertical');
        } else if (data.ballTracker === "horizontal") {
            document.getElementById("ballTracker").style.display = "flex";
            document.getElementById("ballTracker").style.flexDirection = "row";
            console.log('Changed ball tracker direction to horizontal');
        }
    },

    score(data) {
        console.log(`Player: ${data.player}, Score: ${data.score}`);
        const scoreElement = document.getElementById(`player${data.player}Score`);
        if (data.score > scoreElement.innerHTML) {
            scoreElement.innerHTML = data.score;
            scoreElement.classList.add("winBlink");
            scoreElement.textContent = data.score;
            setTimeout("clearWinBlink()", 500);
        } else {
            scoreElement.innerHTML = data.score;
        }
    },

    opacity(data) {
        console.log(`Opacity setting: ${data.opacity}`);
        const elements = ["scoreBoardDiv", "raceInfo", "gameInfo"];
        elements.forEach(id => {
            document.getElementById(id).style.opacity = data.opacity;
        });
    },

    scaling(data) {
        console.log(`Scaling setting: ${data.scaling}`);
        document.documentElement.style.setProperty('--ui-scaling', data.scaling);
    },

    race(data) {
        console.log("Race info: " + data.race);
        const player1Enabled = getStorageItem("usePlayer1");
        const player2Enabled = getStorageItem("usePlayer2");
        const bothPlayersEnabled = player1Enabled && player2Enabled;
        if (data.race == "" || !bothPlayersEnabled) {
            document.getElementById("raceInfo").classList.add("noShow");
            document.getElementById("raceInfo").classList.remove("fadeInElm");
            document.getElementById("customLogo1").classList.remove("customLogoWide1");
            document.getElementById("customLogo2").classList.remove("customLogoWide2");
        } else {
            document.getElementById("raceInfo").classList.remove("noShow");
            document.getElementById("raceInfo").classList.add("fadeInElm");
            document.getElementById("customLogo1").classList.add("customLogoWide1");
            document.getElementById("customLogo2").classList.add("customLogoWide2");
            document.getElementById("raceInfo").innerHTML = "(" + data.race + ")";
        }
    },

    game(data) {
        console.log("Game info: " + data.game);
        if (data.game == "") {
            document.getElementById("gameInfo").classList.add("noShow");
            document.getElementById("gameInfo").classList.remove("fadeInElm");
        } else {
            document.getElementById("gameInfo").classList.remove("noShow");
            document.getElementById("gameInfo").classList.add("fadeInElm");
            document.getElementById("gameInfo").innerHTML = data.game;
        }
    },

    time(data) {
        console.log("event.data.time: " + data.time);
        shotTimer(data.time);
    },

    color(data) {
        console.log("Player: " + data.player + " using color: " + data.color);
        if (data.player == "1") { document.getElementById("player" + data.player + "Name").style.background = "linear-gradient(to left, white, " + data.color; };
        if (data.player == "2") { document.getElementById("player" + data.player + "Name").style.background = "linear-gradient(to right, white, " + data.color; };
    },

    name(data) {
        console.log("Player/Team: " + data.player + " named " + data.name);
        if (!data.name == "") {
            document.getElementById("player" + data.player + "Name").innerHTML = data.name;
        } else {
            document.getElementById("player" + data.player + "Name").innerHTML = "Player " + data.player;
        }
    },

    playerDisplay(data) {
        // Code to assist with displaying active player image when only two players are enabled, on reload.
        const player1Enabled = getStorageItem("usePlayer1");
        const player2Enabled = getStorageItem("usePlayer2");
        const bothPlayersEnabled = player1Enabled && player2Enabled;
        const playerToggleEnabled = getStorageItem("usePlayerToggle") === "yes";
        const useclockEnabled = getStorageItem("useClock") === "yes";

        console.log(`player1Enabled:${player1Enabled} player2Enabled:${player2Enabled} bothPlayersEnabled:${bothPlayersEnabled} playerToggleEnabled:${player1Enabled} useclockEnabled${useclockEnabled}`)
                
        if (data.playerDisplay == "showPlayer") {
            if ( useclockEnabled && bothPlayersEnabled) {
                console.log("Use clock evaluating as enabled");
                document.getElementById("p1ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
                document.getElementById("p2ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
            } else {
                console.log("Use clock evaluating as not enabled");
            }
            // Check if both players are enabled before fading in the player images
            if (bothPlayersEnabled && playerToggleEnabled) {
                const activePlayer = getStorageItem("activePlayer");
                console.log(`Show player ${activePlayer} as active`);
                document.getElementById("player1Image").classList.replace(activePlayer === "1" ? "fadeOutElm" : "fadeInElm", activePlayer === "1" ? "fadeInElm" : "fadeOutElm");
                document.getElementById("player2Image").classList.replace(activePlayer === "2" ? "fadeOutElm" : "fadeInElm", activePlayer === "2" ? "fadeInElm" : "fadeOutElm");
            }
            if (player1Enabled && getStorageItem("useCustomLogo")=="yes") {
                document.getElementById("customLogo1").classList.replace("fadeOutElm", "fadeInElm");
            }
            if (player2Enabled && getStorageItem("useCustomLogo2")=="yes") {
                document.getElementById("customLogo2").classList.replace("fadeOutElm", "fadeInElm");
            }
            if (bothPlayersEnabled && getStorageItem("raceInfo")) {
                document.getElementById("raceInfo").classList.replace("fadeOutElm", "fadeInElm");
            }

			if (getStorageItem("enableBallTracker") === "true"){
				document.getElementById("ballTracker").classList.remove("noShow");
			}

            showPlayer(data.playerNumber);

            // Add a small delay to check after showPlayer has completed
            setTimeout(() => {
                // Debug logs
                console.log("Display player 1:", getStorageItem("usePlayer1"));
                console.log("Display player 2:", getStorageItem("usePlayer2"));
                if (getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes") {
                    console.log("Both players enabled, so scores are enabled");
                    showScores();
                } else {
                    console.log("Not all players enabled, scores remain hidden");
                }
            }, 50); // Small delay to ensure localStorage is updated
        };

        if (data.playerDisplay == "hidePlayer") { 
            hidePlayer(data.playerNumber); 
            hideScores();
            hideClock();
            document.getElementById("p1ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
            document.getElementById("p2ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
            document.getElementById("player1Image").classList.replace("fadeInElm", "fadeOutElm");
            document.getElementById("player2Image").classList.replace("fadeInElm", "fadeOutElm");
            document.getElementById("customLogo"+ data.playerNumber).classList.replace("fadeInElm", "fadeOutElm");
			document.getElementById("ballTracker").classList.add("noShow");
        };
    },

    clockDisplay(data) {
        // start of original clockDisplay channel 
        if (data.clockDisplay != null) {
            if (data.clockDisplay == "show") { showClock(); };
            if (data.clockDisplay == "hide") { hideClock(); };
            if (data.clockDisplay == "stopClock") { stopClock(); };
            if (data.clockDisplay == "noClock") {
                document.getElementById("p1ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
                document.getElementById("p2ExtIcon").classList.replace("fadeInElm", "fadeOutElm");
            }
            if (data.clockDisplay == "useClock") {
                document.getElementById("p1ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
                document.getElementById("p2ExtIcon").classList.replace("fadeOutElm", "fadeInElm");
            }
            if (data.clockDisplay == "p1extension") { add30(1); };
            if (data.clockDisplay == "p2extension") { add30(2); };
            if (data.clockDisplay == "p1ExtReset") { extReset('p1'); };
            if (data.clockDisplay == "p2ExtReset") { extReset('p2'); };
            if (data.clockDisplay == "hidesalotto") { salottoHide(); };
            if (data.clockDisplay == "showsalotto") { salottoShow(); };
            if (data.clockDisplay == "hidecustomLogo") { 
                customHide(); 
            }
            if (data.clockDisplay == "showcustomLogo") { 
                customShow(); 
            }
            if (data.clockDisplay == "hidecustomLogo2") { 
                custom2Hide(); 
            }
            if (data.clockDisplay == "showcustomLogo2") { 
                custom2Show(); 
            }
            if (data.clockDisplay == "postLogo") { postLogo(); };
            if (data.clockDisplay == "logoSlideShow-show") {
                customHide();
                document.getElementById("logoSlideshowDiv").classList.replace("fadeOutElm", "fadeInElm");
                if (getStorageItem("customLogo3") != null) { document.getElementById("customLogo3").src = getStorageItem("customLogo3"); } else { document.getElementById("customLogo3").src = "./common/images/placeholder.png"; };
                if (getStorageItem("customLogo4") != null) { document.getElementById("customLogo4").src = getStorageItem("customLogo4"); } else { document.getElementById("customLogo4").src = "./common/images/placeholder.png"; };
                if (getStorageItem("customLogo5") != null) { document.getElementById("customLogo5").src = getStorageItem("customLogo5"); } else { document.getElementById("customLogo5").src = "./common/images/placeholder.png"; };
            }
            if (data.clockDisplay == "logoSlideShow-hide") { document.getElementById("logoSlideshowDiv").classList.replace("fadeInElm", "fadeOutElm"); };

            // if (data.clockDisplay == "style125") {
            //     styleChange(1); 
            //     // Reload the specific HTML file
            //     window.location.href = 'browser_source.html'; // This line redirects to browser_source.html
            //  };
            // if (data.clockDisplay == "style150") {
            //     styleChange(2);
            //     // Reload the specific HTML file
            //     window.location.href = 'browser_source.html'; // This line redirects to browser_source.html
            //  };
            // if (data.clockDisplay == "style200") {
            //     styleChange(3);
            //     // Reload the specific HTML file
            //     window.location.href = 'browser_source.html'; // This line redirects to browser_source.html
            //  };

            if (data.clockDisplay === 'toggleActivePlayer') {
                const playerToggle = data.player; // Get the active player from the message
                var activePlayer = playerToggle ? "1": "2";
                console.log(`Toggle to player ${activePlayer}`);
                changeActivePlayer(playerToggle); // Call the function to update the display
            }

            if (data.clockDisplay === 'showActivePlayer'){
                const activePlayer = data.player; // Get the active player from the message
                const player1Enabled = getStorageItem("usePlayer1") === "yes";
                const player2Enabled = getStorageItem("usePlayer2") === "yes";
                const bothPlayersEnabled = player1Enabled && player2Enabled;
                // const playerToggle = (activePlayer === 1 || activePlayer === 2); // true if activePlayer is 1 or 2, otherwise false
                // console.log(`playerToggle: ${playerToggle}`);
                console.log(`Display active player: ${bothPlayersEnabled}`)
                if (bothPlayersEnabled) {
                    //const activePlayer = getStorageItem("activePlayer");
                    changeActivePlayer(activePlayer); // Call the function to update the display
                }
            }
            if (data.clockDisplay === 'hideActivePlayer'){
                document.getElementById("player1Image").classList.replace("fadeInElm", "fadeOutElm");
                document.getElementById("player2Image").classList.replace("fadeInElm", "fadeOutElm");
            }
        }
    },

    toggle(data) {
        // Check if the message contains a 'toggle' property
        if (data.toggle) {
            const elementId = data.toggle;
            // Find the element on this page with the corresponding id
            const elementToToggle = document.getElementById(elementId);
            if (elementToToggle) {
                // Toggle the 'faded' class on this element
                elementToToggle.classList.toggle('faded');
                console.log('Toggled element with id:', elementId, 'on browser_source.html');
            } else {
                console.log('Element with id', elementId, 'not found on browser_source.html');
            }
        }
    },

    resetBall(data) {
        const elementId = data.resetBall;
        // Find the element on this page with the corresponding id
        const elementToToggle = document.getElementById(elementId);
        if (elementToToggle) {
            // Toggle the 'faded' class on this 
            elementToToggle.classList.remove('faded');
            console.log('Removed faded class from', elementId, 'on browser_source.html');
        } else {
            console.log('Element with id', elementId, 'not found on browser_source.html');
        }
    },

    displayBallTracker(data) {
        const ballTracker = document.getElementById("ballTracker");
        if (!ballTracker) {
            console.warn('Ball tracker element not found in DOM');
            return;
        }
        
        if (data.displayBallTracker === true) {
            ballTracker.classList.remove("noShow");
            console.log('Show ball tracker');
        } else if (data.displayBallTracker === false) {
            ballTracker.classList.add("noShow");
            console.log('Hide ball tracker');
        }
    },

	gameType(data) {
        console.log('Game type value:', data.gameType);
        if (data.gameType === "game3") {
            // 9-ball
            ["10", "11", "12", "13", "14", "15"].forEach(num => {
                document.getElementById(`ball ${num}`).classList.add("noShow");
            });
        } else if (data.gameType === "game4") {
            // 10-ball
            document.getElementById("ball 10").classList.remove("noShow");
            ["11", "12", "13", "14", "15"].forEach(num => {
                document.getElementById(`ball ${num}`).classList.add("noShow");
            });
        } else {
            // All balls
            ["10", "11", "12", "13", "14", "15"].forEach(num => {
                document.getElementById(`ball ${num}`).classList.remove("noShow");
            });
        }
    }
};

// Main event handler
bc.onmessage = (event) => {
    console.log('Received event data:', event.data);

    // Process each property in the event data
    Object.entries(event.data).forEach(([key, value]) => {
        if (value != null && handlers[key]) {
            handlers[key](event.data);
        }
    });
};

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////			
//							autostart stuff
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

$(document).ready(function() {
    // Initialize draggable elements
    $("#scoreBoardDiv").draggable();
    $("#gameInfo").draggable();
    $("#logoSlideshowDiv").draggable();
	$("#ballTracker").draggable();

});

setCustomLogo("customLogo1", "useCustomLogo", "usePlayer1");
setCustomLogo("customLogo2", "useCustomLogo2", "usePlayer2");

if (getStorageItem("gameType") === "game3"){
	document.getElementById("ball 10").classList.add("noShow");
	document.getElementById("ball 11").classList.add("noShow");
	document.getElementById("ball 12").classList.add("noShow");
	document.getElementById("ball 13").classList.add("noShow");
	document.getElementById("ball 14").classList.add("noShow");
	document.getElementById("ball 15").classList.add("noShow");
} else if (getStorageItem("gameType") === "game4"){
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

if (getStorageItem("customLogo3") != null) { document.getElementById("customLogo3").src = getStorageItem("customLogo3"); } else { document.getElementById("customLogo3").src = "./common/images/placeholder.png"; };
if (getStorageItem("customLogo4") != null) { document.getElementById("customLogo4").src = getStorageItem("customLogo4"); } else { document.getElementById("customLogo4").src = "./common/images/placeholder.png"; };
if (getStorageItem("customLogo5") != null) { document.getElementById("customLogo5").src = getStorageItem("customLogo5"); } else { document.getElementById("customLogo5").src = "./common/images/placeholder.png"; };
if (getStorageItem("slideShow") == "yes") {
	document.getElementById("logoSlideshowDiv").classList.replace("fadeOutElm", "fadeInElm");
	document.getElementById("logoSlideshowDiv").classList.replace("fadeOutElm", "fadeInElm");
}

if (getStorageItem("p1NameCtrlPanel") != "" || getStorageItem("p1NameCtrlPanel") != null) {
	document.getElementById("player1Name").innerHTML = getStorageItem("p1NameCtrlPanel");
}
if (getStorageItem("p1NameCtrlPanel") == "" || getStorageItem("p1NameCtrlPanel") == null) {
	document.getElementById("player1Name").innerHTML = "Player 1";
}

if (getStorageItem("p2NameCtrlPanel") != "" || getStorageItem("p2NameCtrlPanel") != null) {
	document.getElementById("player2Name").innerHTML = getStorageItem("p2NameCtrlPanel");
}
if (getStorageItem("p2NameCtrlPanel") == "" || getStorageItem("p2NameCtrlPanel") == null) {
	document.getElementById("player2Name").innerHTML = "Player 2";
}

// Code to assist with displaying active player image when only two players are enabled, on reload.
const player1Enabled = getStorageItem("usePlayer1") == "yes";
const player2Enabled = getStorageItem("usePlayer2") == "yes";
const bothPlayersEnabled = player1Enabled && player2Enabled;
const playerToggleEnabled = getStorageItem("usePlayerToggle") == "yes";
console.log(`PlayerToggle: ${playerToggleEnabled}. Players both enabled: ${bothPlayersEnabled}`)

if (bothPlayersEnabled && playerToggleEnabled) {
    const activePlayer = getStorageItem("activePlayer");
	console.log(`Show player image in autostart condition. PlayerToggle: ${playerToggleEnabled}. Players both enabled: ${bothPlayersEnabled}`);
    document.getElementById("player1Image").classList.replace(activePlayer === "1" ? "fadeOutElm" : "fadeInElm", activePlayer === "1" ? "fadeInElm" : "fadeOutElm");
    document.getElementById("player2Image").classList.replace(activePlayer === "2" ? "fadeOutElm" : "fadeInElm", activePlayer === "2" ? "fadeInElm" : "fadeOutElm");
} else {
    // Hide both players if not enabled
    document.getElementById("player1Image").classList.replace("fadeInElm", "fadeOutElm");
    document.getElementById("player2Image").classList.replace("fadeInElm", "fadeOutElm");
}

if (getStorageItem("p1ScoreCtrlPanel") != null) {
	document.getElementById("player1Score").innerHTML = getStorageItem("p1ScoreCtrlPanel");
} else {
	document.getElementById("player1Score").innerHTML = 0;
}

if (getStorageItem("p2ScoreCtrlPanel") != null) {
	document.getElementById("player2Score").innerHTML = getStorageItem("p2ScoreCtrlPanel");
} else {
	document.getElementById("player2Score").innerHTML = 0;
}

if (getStorageItem("gameInfo") != "" && getStorageItem("gameInfo") != null) {
	document.getElementById("gameInfo").classList.remove("noShow");
}

if (getStorageItem("raceInfo") != "" && getStorageItem("raceInfo") != null && bothPlayersEnabled) {
	document.getElementById("raceInfo").classList.remove("noShow");
	document.getElementById("raceInfo").classList.add("fadeInElm");
	document.getElementById("customLogo1").classList.add("customLogoWide1");
	document.getElementById("customLogo2").classList.add("customLogoWide2");
}

document.getElementById("gameInfo").innerHTML = getStorageItem("gameInfo");
document.getElementById("raceInfo").innerHTML = "(" + getStorageItem("raceInfo") + ")";

function updateIconsVisibility(show) {
    const action = show ? "fadeInElm" : "fadeOutElm";
    document.getElementById("p1ExtIcon").classList.replace(show ? "fadeOutElm" : "fadeInElm", action);
    document.getElementById("p2ExtIcon").classList.replace(show ? "fadeOutElm" : "fadeInElm", action);
}

if (getStorageItem("useClock") == "yes" && bothPlayersEnabled) {
    console.log("Icons shown due to conditions met.");
    updateIconsVisibility(true);
} else {
    console.log("Icons not shown due to conditions not met.");
    updateIconsVisibility(false);
}

// Setting defaults in storage so functions execute correctly, in the event values are not being retrieved from storage successfully due to initialization or similar
if (getStorageItem("usePlayer1") === null) {
    setStorageItem("usePlayer1", "yes");
}
if (getStorageItem("usePlayer2") === null) {
    setStorageItem("usePlayer2", "yes");
}
if (getStorageItem("usePlayerToggle") === null) {
    setStorageItem("usePlayerToggle", "yes");
}
if (getStorageItem("activePlayer") === null) {
    setStorageItem("activePlayer", "1");
}


if (getStorageItem(("usePlayer1")) != "yes") {
	document.getElementById("player1Name").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player1Score").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player2Score").classList.replace("fadeInElm", "fadeOutElm");
}
if (getStorageItem(("usePlayer2")) != "yes") {
	document.getElementById("player2Name").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player1Score").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player2Score").classList.replace("fadeInElm", "fadeOutElm");
}

if (getStorageItem('p1colorSet') != "") {
	document.getElementById("player1Name").style.background = "linear-gradient(to left, white, " + getStorageItem('p1colorSet');
	console.log("p1color: " + getStorageItem('p1colorSet'));
}
if (getStorageItem('p2colorSet') != "") {
	document.getElementById("player2Name").style.background = "linear-gradient(to right, white, " + getStorageItem('p2colorSet');
	console.log("p2color: " + getStorageItem('p2colorSet'));
}

// if (getStorageItem("b_style") != null) {
// 	styleChange(getStorageItem("b_style"));
// } else {
// 	// document.styleSheets[0].disabled = true;
// 	document.styleSheets[0].disabled = true;
// 	document.styleSheets[1].disabled = true;
// 	document.styleSheets[2].disabled = false;
// 	setStorageItem("b_style", "3");      // Store XL as default
// }

if (getStorageItem("enableBallTracker") === "false" || getStorageItem("enableBallTracker") === null){
	document.getElementById("ballTracker").classList.add("noShow");
	console.log(`Ball tracker disabled on overlay`);
} else {
	document.getElementById("ballTracker").classList.remove("noShow");
	console.log(`Ball tracker enabled on overlay`);
}

// On browser_source.html load, check stored direction and apply it
const initializeBallTracker = () => {
    const direction = getStorageItem("ballTrackerDirection") || "vertical";
    const ballTracker = document.getElementById("ballTracker");
    
    if (ballTracker) {
        ballTracker.style.display = "flex";
        ballTracker.style.flexDirection = direction === "vertical" ? "column" : "row";
        console.log(`Ball tracker initialized from stored value: ${direction}`);
    }
};

// Run initialization
initializeBallTracker();

// Only handle changes via broadcast messages after initial setup
if (getStorageItem("ballTrackerDirection") === null) {
    setStorageItem("ballTrackerDirection", "vertical");
    console.log(`Ball tracker default value set to vertical`);
} else {
    const direction = getStorageItem("ballTrackerDirection");
    console.log(`Ball tracker using existing value: ${direction}`);
}

let slideIndex = 0;
showSlides();
applySavedBallStates();

// Functions

function setCustomLogo(logoId, useCustomLogoKey, usePlayerKey) {
    if (getStorageItem(logoId) !== null && getStorageItem(logoId) !== "") {
        document.getElementById(logoId).src = getStorageItem(logoId);
        if (getStorageItem(useCustomLogoKey) === "yes" && getStorageItem(usePlayerKey) === "yes") {
            document.getElementById(logoId).classList.replace("fadeOutElm", "fadeInElm");
        }
    } else {
        document.getElementById(logoId).src = "./common/images/placeholder.png";
    }
}

// Call the initialization function on window load
window.addEventListener("load", initializeBrowserSourceExtensionStatus);


// Add this function to initialize and update the player extension button styling
function initializeBrowserSourceExtensionStatus() {
    // Get the extension icon elements for player 1 and 2
    let p1ExtIcon = document.getElementById("p1ExtIcon");
    let p2ExtIcon = document.getElementById("p2ExtIcon");

    // Check localStorage for stored extension status values
    // (Assuming you set "playerExtension1" and "playerExtension2" to "enabled" when active)
    let extStatus1 = getStorageItem("p1Extension");
    let extStatus2 = getStorageItem("p2Extension");

    // Update styling for Player 1's extension element
    if (p1ExtIcon) {
        if (extStatus1 && extStatus1 === "enabled") {
            // p1ExtIcon.textContent = "Reset";
            p1ExtIcon.style.backgroundColor = "darkred";
            p1ExtIcon.style.color = "white";
        } else {
            // p1ExtIcon.textContent = "Extend";
            p1ExtIcon.style.backgroundColor = "";
            p1ExtIcon.style.color = "";
        }
    }
    
    // Update styling for Player 2's extension element
    if (p2ExtIcon) {
        if (extStatus2 && extStatus2 === "enabled") {
            // p2ExtIcon.textContent = "Reset";
            p2ExtIcon.style.backgroundColor = "darkred";
            p2ExtIcon.style.color = "white";
        } else {
            // p2ExtIcon.textContent = "Extend";
            p2ExtIcon.style.backgroundColor = "";
            p2ExtIcon.style.color = "";
        }
    }
}