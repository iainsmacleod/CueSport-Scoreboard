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

function bsStyleChange() {
	if (document.getElementById("bsStyle").value == 1) {
		bc.postMessage({ clockDisplay: 'style125' });
		setStorageItem("b_style", 1);
	}
	if (document.getElementById("bsStyle").value == 2) {
		bc.postMessage({ clockDisplay: 'style150' });
		setStorageItem("b_style", 2);
	}
	if (document.getElementById("bsStyle").value == 3) {
		bc.postMessage({ clockDisplay: 'style200' });
		setStorageItem("b_style", 3);
	}
}

function toggleAnimationSetting(){
	if (!document.getElementById("winAnimation").checked) {
		setStorageItem("winAnimation", "no");
		console.log("Win animation disabled");
	} else if (document.getElementById("winAnimation").checked) {
		setStorageItem("winAnimation", "yes");
		console.log("Win animation enabled");
	}	
}

function gameType(value) {
	setStorageItem("gameType", value);
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
	bc.postMessage({ gameType: value });
}

function useBallTracker(){
	const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
	setStorageItem("enableBallTracker", document.getElementById("ballTrackerCheckbox").checked);
	if (document.getElementById("ballTrackerCheckbox").checked) {
		document.getElementById("ballTracker").classList.remove("noShow");
		document.getElementById("ballTrackerDirection").classList.remove("noShow");
	} else {
		document.getElementById("ballTracker").classList.add("noShow");
		document.getElementById("ballTrackerDirection").classList.add("noShow");
	}
	if (bothPlayersEnabled){
		bc.postMessage({ displayBallTracker: document.getElementById("ballTrackerCheckbox").checked});
	}
	console.log(`Both players are not enabled so we are not enabling the ball tracker`)
}

function toggleBallTrackerDirection() {
    // Get current direction from localStorage or default to "horizontal"
    const currentDirection = getStorageItem("ballTrackerDirection") || "vertical";
    // Toggle direction
    const newDirection = currentDirection === "horizontal" ? "vertical" : "horizontal";
    // Send message to browser source
    bc.postMessage({ ballTracker: newDirection });
    // Update localStorage
    setStorageItem("ballTrackerDirection", newDirection);
    console.log(`Changed ball tracker to ${newDirection} orientation`);
	document.getElementById("ballTrackerDirection").innerHTML = currentDirection.charAt(0).toUpperCase() + currentDirection.slice(1).toLowerCase() + " Ball Tracker";
}

function togglePot(element) {
    // Toggle the 'faded' class on the element
    element.classList.toggle('faded');

    // Parse the current ball state from localStorage or default to an empty object
    const ballState = JSON.parse(getStorageItem('ballState') || '{}');
    
    // Update the state by reading the current status from the element
    ballState[element.id] = element.classList.contains('faded');
    
    // Save the updated state back to localStorage
    setStorageItem('ballState', JSON.stringify(ballState));

    // Broadcast the change if needed
    bc.postMessage({ toggle: element.id });
    console.log(`Toggle pot state of`, element.id);
}

function applySavedBallStates() {
    // Retrieve the ballState object from localStorage (or default to an empty object)
    const ballState = JSON.parse(getStorageItem('ballState') || '{}');

    // Get all ball elements (assuming each ball has the class 'ball')
    const balls = document.querySelectorAll('.ball');

    // Iterate over each ball element and apply or remove the 'faded' class
    balls.forEach(function(ball) {
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
	const checkbox = document.getElementById("useToggleSetting").checked;
	const activePlayer = document.getElementById("playerToggleCheckbox").checked;
	console.log(`Display active player ${checkbox ? "enabled" : "disabled"}`);
	if (checkbox) {
		document.getElementById("playerToggle").classList.remove("noShow");
		setStorageItem("usePlayerToggle", "yes");
		bc.postMessage({ clockDisplay: 'showActivePlayer', player: activePlayer });
		console.log(`Player ${activePlayer ? 1 : 2} is active`);
	} else {
		document.getElementById("playerToggle").classList.add("noShow");
		setStorageItem("usePlayerToggle", "no");
		bc.postMessage({ clockDisplay: 'hideActivePlayer' });
	}
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
					container.onclick = function(e) {
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
		document.getElementsByTagName("select")[0].options[0].value = p2original;
		document.getElementsByTagName("select")[1].options[0].value = p1original;
		c1value = p1original;
		c2value = p2original;
		if (c1value == "white") { document.getElementById("p1colorDiv").style.color = "black"; } else { document.getElementById("p1colorDiv").style.color = "white"; };
		//if (c1value == "cadetblue" || c1value == "steelblue" || c1value == "grey" || c1value == "lightgrey" || c1value == "green" || c1value == "khaki" || c1value == "tomato" || c1value == "red" || c1value == "orangered" || c1value == "white" || c1value == "orange" || c1value == "lightgreen" || c1value == "lightseagreen") { document.getElementById("p2colorDiv").style.color = "#000"; } else { document.getElementById("p2colorDiv").style.color = "lightgrey"; };
		if (c2value == "white") { document.getElementById("p2colorDiv").style.color = "black"; } else { document.getElementById("p2colorDiv").style.color = "white"; };
		//if (c2value == "cadetblue" || c2value == "steelblue" || c2value == "grey" || c2value == "lightgrey" || c2value == "green" || cvalue == "orange" || cvalue == "khaki" || cvalue == "tomato" || cvalue == "red" || cvalue == "orangered" || cvalue == "white" || cvalue == "orange" || cvalue == "lightgreen" || cvalue == "lightseagreen") { document.getElementById("p1colorDiv").style.color = "#000"; } else { document.getElementById("p1colorDiv").style.color = "lightgrey"; };
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

		//if (cvalue == "cadetblue" || cvalue == "steelblue" || cvalue == "grey" || cvalue == "lightgrey" || cvalue == "green" || cvalue == "khaki" || cvalue == "tomato" || cvalue == "red" || cvalue == "orangered" || cvalue == "white" || cvalue == "orange" || cvalue == "lightgreen" || cvalue == "lightseagreen") { document.getElementById("p1colorDiv").style.color = "#000"; } else { document.getElementById("p1colorDiv").style.color = "lightgrey"; };
		if (cvalue == "white") { document.getElementById("p1colorDiv").style.color = "black"; } else { document.getElementById("p1colorDiv").style.color = "white"; };
		setStorageItem("p1colorSet", document.getElementById("p" + player + "colorDiv").value);
		document.getElementsByTagName("select")[0].options[0].value = cvalue;
	} else {
		playerx = player;
		pColormsg = document.getElementById("p" + player + "colorDiv").value;
		bc.postMessage({ player: playerx, color: pColormsg });
		var selectedColor = document.getElementById("p" + player + "colorDiv").value;
		document.getElementById("p2colorDiv").style.background = `${selectedColor}`;
		document.getElementById("p2Name").style.background = `linear-gradient(to left, ${selectedColor}, white)`;

		//if (cvalue == "cadetblue" || cvalue == "steelblue" || cvalue == "grey" || cvalue == "lightgrey" || cvalue == "green" || cvalue == "khaki" || cvalue == "tomato" || cvalue == "red" || cvalue == "orangered" || cvalue == "white" || cvalue == "orange" || cvalue == "lightgreen" || cvalue == "lightseagreen") { document.getElementById("p2colorDiv").style.color = "#000"; } else { document.getElementById("p2colorDiv").style.color = "lightgrey"; };
		if (cvalue == "white") { document.getElementById("p2colorDiv").style.color = "black"; } else { document.getElementById("p2colorDiv").style.color = "white"; };
		setStorageItem("p2colorSet", document.getElementById("p" + player + "colorDiv").value);
		document.getElementsByTagName("select")[1].options[0].value = cvalue;
	}
}

function playerSetting(player) {
    var usePlayerSetting = document.getElementById("usePlayer" + player + "Setting");
    var isChecked = usePlayerSetting.checked;
    var action = isChecked ? "remove" : "add";
    var storageValue = isChecked ? "yes" : "no";
    var usePlayer = isChecked ? "showPlayer" : "hidePlayer";
    
    setStorageItem("usePlayer" + player, storageValue);
    
    // Handle player-specific elements
    ["Name", "NameLabel", "colorDiv", "ColorLabel"].forEach(function(elem) {
        document.getElementById("p" + player + elem).classList[action]("noShow");
    });

    // Check if both players are enabled
    const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
	const bothPlayersDisabled = !player1Enabled && !player2Enabled;

    // Show/hide shared elements based on both players being enabled
    document.getElementById("scoreInfo").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
    document.getElementById("swapBtn").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
	document.getElementById("useClockSetting").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
	document.getElementById("labelForUseClockSetting").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
	document.getElementById("useToggleSetting").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
	document.getElementById("labelForUseToggleSetting").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
	document.getElementById("ballTrackerCheckbox").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
	document.getElementById("labelForBallTrackerCheckbox").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
	
	// Show/hide  elements based on individual players being enabled
	document.getElementById("logoName").classList[player1Enabled ? "remove" : "add"]("noShow");
	document.getElementById("customLogo1").classList[player1Enabled ? "remove" : "add"]("noShow");
	document.getElementById("uploadCustomLogo").classList[player1Enabled ? "remove" : "add"]("noShow");
	document.getElementById("logoName2").classList[player2Enabled ? "remove" : "add"]("noShow");
	document.getElementById("customLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");
	document.getElementById("uploadCustomLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");

	// Update clockInfo visibility based on player settings and useClock
    const useClockEnabled = getStorageItem("useClock") === "yes";
    if (bothPlayersEnabled && useClockEnabled) {
        document.getElementById("clockInfo").classList.remove("noShow");
    } else {
        document.getElementById("clockInfo").classList.add("noShow");
    } 

	// Hide shared elements based on both players being enabled
	document.getElementById("playerInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");

    bc.postMessage({playerDisplay: usePlayer, playerNumber: player});
}

function clockSetting() {
	const clockDiv = document.getElementById("clockInfo");
	if (!document.getElementById("useClockSetting").checked) {
		setStorageItem("useClock", "no");
		bc.postMessage({ clockDisplay: 'noClock' });
		clockDiv.classList.add("noShow"); // Hide the clock controls
	} else if (document.getElementById("useClockSetting").checked) {
		setStorageItem("useClock", "yes");
		bc.postMessage({ clockDisplay: 'useClock' });
		clockDiv.classList.remove("noShow"); // Show the clock controls
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

function postNames() {
	p1namemsg = document.getElementById("p1Name").value.substring(0, 20);
	p2namemsg = document.getElementById("p2Name").value.substring(0, 20);
	bc.postMessage({ player: '1', name: p1namemsg });
	bc.postMessage({ player: '2', name: p2namemsg });
	var p1FirstName = document.getElementById("p1Name").value.split(" ")[0];
	var p2FirstName = document.getElementById("p2Name").value.split(" ")[0];
	if (!p1Name.value == "") { document.getElementById("p1extensionBtn").innerHTML = p1FirstName.substring(0, 9) + "'s Extension"; } else { document.getElementById("p1extensionBtn").innerHTML = "P1's Extension"; }
	if (!p2Name.value == "") { document.getElementById("p2extensionBtn").innerHTML = p2FirstName.substring(0, 9) + "'s Extension"; } else { document.getElementById("p2extensionBtn").innerHTML = "P2's Extension"; }
	if (!p1Name.value == "") { document.getElementById("p1ScoreLabel").innerHTML = p1namemsg + " - Score/Rack(s)/Ball(s)"; } else { document.getElementById("p1ScoreLabel").innerHTML = "Player/Team 1 - Score/Rack(s)/Ball(s)";}
	if (!p2Name.value == "") { document.getElementById("p2ScoreLabel").innerHTML = p2namemsg + " - Score/Rack(s)/Ball(s)"; } else { document.getElementById("p2ScoreLabel").innerHTML = "Player/Team 2 - Score/Rack(s)/Ball(s)";}
	setStorageItem("p1NameCtrlPanel", p1Name.value);
	setStorageItem("p2NameCtrlPanel", p2Name.value);
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
	bc.postMessage({ race: racemsg });
	bc.postMessage({ game: gamemsg });	
	setStorageItem("raceInfo", raceInfoTxt.value);
	setStorageItem("gameInfo", gameInfoTxt.value);
}


function pushScores() {
	// Send current scores
    const p1Score = document.getElementById("p1Score").value || 0;
    const p2Score = document.getElementById("p2Score").value || 0;
    bc.postMessage({ player: '1', score: p1Score });
    bc.postMessage({ player: '2', score: p2Score });
    
    // Update global score variables
    p1ScoreValue = parseInt(p1Score) || 0;
    p2ScoreValue = parseInt(p2Score) || 0;
    
    // Store scores in localStorage
    setStorageItem("p1ScoreCtrlPanel", p1ScoreValue);
	setStorageItem("p1Score", p1ScoreValue);
    setStorageItem("p2ScoreCtrlPanel", p2ScoreValue);
	setStorageItem("p2Score", p2ScoreValue);
}

function postScore(opt1, player) {
	// Parse stored scores as integers
    let p1ScoreValue = parseInt(getStorageItem("p1ScoreCtrlPanel")) || 0;
    let p2ScoreValue = parseInt(getStorageItem("p2ScoreCtrlPanel")) || 0;

    if (player == "1") {
        if (opt1 == "add") {
            if (p1ScoreValue < 999) {
                p1ScoreValue = p1ScoreValue + 1;
                msg = { player: player, score: p1ScoreValue };
                bc.postMessage(msg);
                setStorageItem("p" + player + "ScoreCtrlPanel", p1ScoreValue);
                setStorageItem("p" + player + "Score", p1ScoreValue);
                stopClock();
                //document.getElementById("sendP" + player + "Score").style.border = "2px solid lightgreen";
                document.getElementById("p"+player+"Score").value = p1ScoreValue;
                resetExt('p1', 'noflash');
                resetExt('p2', 'noflash');
            }
        } else if (p1ScoreValue > 0) {
            p1ScoreValue = p1ScoreValue - 1;
            msg = { player: player, score: p1ScoreValue };
            bc.postMessage(msg);
            setStorageItem("p" + player + "ScoreCtrlPanel", p1ScoreValue);
            setStorageItem("p" + player + "Score", p1ScoreValue);
            //document.getElementById("sendP" + player + "ScoreSub").style.border = "2px solid tomato";
            document.getElementById("p"+player+"Score").value = p1ScoreValue;
        }
    }
    if (player == "2") {
        if (opt1 == "add") {
            if (p2ScoreValue < 999) {
                p2ScoreValue = p2ScoreValue + 1;
                msg2 = { player: player, score: p2ScoreValue };
                bc.postMessage(msg2);
                setStorageItem("p" + player + "ScoreCtrlPanel", p2ScoreValue);
                setStorageItem("p" + player + "Score", p2ScoreValue);
                stopClock();
                //document.getElementById("sendP" + player + "Score").style.border = "2px solid lightgreen";
                document.getElementById("p"+player+"Score").value = p2ScoreValue;
                resetExt('p1', 'noflash');
                resetExt('p2', 'noflash');
            }
        } else if (p2ScoreValue > 0) {
            p2ScoreValue = p2ScoreValue - 1;
            msg2 = { player: player, score: p2ScoreValue };
            bc.postMessage(msg2);
            setStorageItem("p" + player + "ScoreCtrlPanel", p2ScoreValue);
            setStorageItem("p" + player + "Score", p2ScoreValue);
            //document.getElementById("sendP" + player + "ScoreSub").style.border = "2px solid tomato";
            document.getElementById("p"+player+"Score").value = p2ScoreValue;
        }
    }
	resetBallTracker()
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
    checkbox.addEventListener('change', function() {
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
    checkbox.addEventListener('change', function() {
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
	const activePlayer = isChecked
	const player = isChecked ? 1 : 2; // Determine active player based on checkbox state
	const useToggleCheckbox = document.getElementById("useToggleSetting");
	if (useToggleCheckbox.checked){
		bc.postMessage({ clockDisplay: 'toggleActivePlayer', player: activePlayer }); 	// Send a message to the broadcast channel with the active player
	} else {
		console.log(`Not changing visual player indicator UI, due to useToggleSetting being disabled`);
	}
	setStorageItem("activePlayer", player);
	setStorageItem("toggleState", activePlayer);
    console.log(`Player ${player} is active`); // Log the active player
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
	if (getStorageItem("obsTheme") == null) { setStorageItem("obsTheme", "28"); document.getElementById("obsTheme").value = "28"; };
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

function resetScores() {
	if (confirm("Click OK to confirm score reset")) {

    // Reset input fields
    document.getElementById("p1Score").value = "0";
    document.getElementById("p2Score").value = "0";
    
    // Send reset scores
    bc.postMessage({ player: '1', score: '0' });
    bc.postMessage({ player: '2', score: '0' });
    
    // Update global score variables
    p1ScoreValue = 0;
    p2ScoreValue = 0;
    
    // Store reset scores in localStorage
    setStorageItem("p1ScoreCtrlPanel", 0);
    setStorageItem("p2ScoreCtrlPanel", 0);

		resetExt('p1', 'noflash');
		resetExt('p2', 'noflash');
		resetBallTracker();
	} else { }
}

function resetBallTracker() {
    // Retrieve the saved ball state from localStorage
    let ballState = JSON.parse(getStorageItem('ballState') || '{}');

    // Select all ball elements within the .ballTracker container
    const ballElements = document.querySelectorAll('.ball');

    ballElements.forEach(function(ball) {
        // Remove the 'faded' class to reset the ball
        ball.classList.remove('faded');
        
        // Update the ball state to false (not faded)
        ballState[ball.id] = false;
		bc.postMessage({ resetBall: ball.id });
    });

    // Save the updated state back to localStorage
    setStorageItem('ballState', JSON.stringify(ballState));

    console.log("All balls have been reset to their default condition.");
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
                      "L" + (xL-2);
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
		if (xL ===1) {
			setStorageItem("useCustomLogo", "no");
			customLogoSetting();
		} else {
			setStorageItem("useCustomLogo2","no");
			customLogoSetting2();
		}
		var fileInput = document.getElementById("FileUploadL" + xL);
		toggleCheckbox("customLogo"+ xL, fileInput)
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

function resetAll() {
    if (confirm("Click OK to confirm complete reset. This will clear all stored data for ALL scoreboard instance.")) {
        clearAllData();
    }
}
function clearAllData() {
    if (confirm('Are you sure you want to clear ALL locally stored data for CueSports Scoreboard, and reset to defaults?')) {
		removeAllData(INSTANCE_ID );
        location.reload(); // Reload the page to start fresh
    }
}
function removeAllData() {
    // Remove all localStorage items for this instance
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        localStorage.removeItem(key);
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
    }
}
function removeInstanceData(instanceId) {
    if (instanceId === null || instanceId === undefined) {
        // Remove all localStorage items
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            localStorage.removeItem(key);
        }
    } else {
        // Remove only items for this instance
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key.startsWith(instanceId)) {
                localStorage.removeItem(key);
            }
        }
    }
}
