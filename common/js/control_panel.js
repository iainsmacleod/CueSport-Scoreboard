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
// Get instance from URL or use 'default'
const urlParams = new URLSearchParams(window.location.search);
const INSTANCE_ID = urlParams.get('instance') || '';
// Create OBSWebSocket client instance
const obs = new OBSWebSocket();
// Track readiness (post-Identify)
let isObsReady = false;
// UI button click handlers, async and awaiting hotkey dispatch
let isMonitoringActive = false;
// Track if we have a saved clip ready to replay
let hasSavedClip = false;
let isConnected = false;
let replayHistory = [];


// function updateTabVisibility() {
//     // Get the state of the player settings
//     const player1Enabled = document.getElementById("usePlayer1Setting").checked;
//     const player2Enabled = document.getElementById("usePlayer2Setting").checked;
//     // Determine if both players are enabled
//     const bothPlayersEnabled = player1Enabled && player2Enabled;

//     // Get tab elements
//     const scoringTab = document.getElementById("scoringTab");

//     // Show or hide the scoring tab
//     // scoringTab.style.display = bothPlayersEnabled ? "inline-block" : "none";
// }

function updatePlayerBallControlVisibility() {
    const ballTrackerCheckbox = document.getElementById("ballTrackerCheckbox").checked;
    const ballSetCheckbox = document.getElementById("ballSetCheckbox").checked;
    const useToggleSetting = document.getElementById("useToggleSetting").checked;

    if (!ballTrackerCheckbox && !ballSetCheckbox && !useToggleSetting) {
        document.getElementById("playerToggleLabel").classList.add("noShow");
    } else {
        document.getElementById("playerToggleLabel").classList.remove("noShow");
    }
}

// Show/hide Replay Controls based on configuration
function updateReplayControlsVisibility() {
    const replaySectionHeader = document.getElementById('replayLabel');
    const replayControlsDiv = document.getElementById('replay-controls');

    const sceneName = getStorageItem("replaySceneName") || "";
    const videoSource = getStorageItem("replayVideoSourceName") || "";

    if (!sceneName || !videoSource) {
        // Hide replay controls if either required field is empty
        replaySectionHeader.classList.add('noShow');
        replayControlsDiv.classList.add('noShow');
    } else {
        // Show replay controls if both fields are configured
        replaySectionHeader.classList.remove('noShow');
        replayControlsDiv.classList.remove('noShow');
    }
}

// Call updateTabVisibility on page load to set initial tab visibility
document.addEventListener("DOMContentLoaded", function () {
    // In your initialization code
    loadReplaySources();
    updateReplayControlsVisibility();
    // updateTabVisibility();
    updateReplayButtonsVisibility();
    updatePlayerBallControlVisibility();
});

function openTab(evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tablinks");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";

    // Save the selected tab to localStorage
    setStorageItem("lastSelectedTab", tabName);
    console.log(`Last Stored Tab- ${tabName}`);
}

document.addEventListener("DOMContentLoaded", function () {
    // Try to get the last selected tab from localStorage
    const lastSelectedTab = getStorageItem("lastSelectedTab");

    if (lastSelectedTab && document.getElementById(lastSelectedTab)) {
        // Convert first letter to lowercase before adding "Tab"
        const buttonId = lastSelectedTab.charAt(0).toLowerCase() + lastSelectedTab.slice(1) + "Tab";
        const tabButton = document.getElementById(buttonId);

        if (tabButton) {
            tabButton.click();
        } else {
            // Fallback to first tab if button not found
            document.querySelector(".tablinks").click();
        }
    } else {
        // Otherwise default to the first tab
        document.querySelector(".tablinks").click();
    }
});

function toggleAnimationSetting() {
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

    // Show/hide ball type div based on game type (hide for 9-Ball and 10-Ball)
    if (getStorageItem("gameType") === "game2" || getStorageItem("gameType") === "game3") { // 9-Ball or 10-Ball
        document.getElementById("ballTypeDiv").classList.add("noShow");
        // Reset to International when hidden
        setStorageItem("ballSelection", "american");
        document.getElementById("ballSelection").value = "american";
        ballType("american"); // Call the ballType function to update the display
    } else {
        // Only show ball type div if ball tracker is enabled
        const ballTrackerEnabled = document.getElementById("ballTrackerCheckbox").checked;
        if (ballTrackerEnabled) {
            document.getElementById("ballTypeDiv").classList.remove("noShow");
        } else {
            document.getElementById("ballTypeDiv").classList.add("noShow");
        }
    }

    // Disable and hide ball set toggle for non-8-ball games
    if (getStorageItem("gameType") !== "game1") { // Not 8-Ball
        // Disable and hide the ball set toggle checkbox
        document.getElementById("ballSetCheckbox").disabled = true;
        document.getElementById("ballSetCheckbox").checked = false;
        setStorageItem("useBallSet", "no");

        // Hide ball set controls and reset to "Open Table"
        document.getElementById("ballSet").style.display = 'none';
        // document.getElementById("ballSetLabel").classList.add("noShow");
        document.getElementById("ballSetDiv").classList.add("noShow");
        document.getElementById('p1colorOpen').checked = true;
        setStorageItem("playerBallSet", "p1Open");
        bc.postMessage({ playerBallSet: "p1Open" });

        console.log("Ball set toggle disabled and hidden for non-8-ball game");
    } else {
        const ballTrackerEnabled = document.getElementById("ballTrackerCheckbox").checked;
        if (ballTrackerEnabled) {
            document.getElementById("ballTypeDiv").classList.remove("noShow");
            document.getElementById("ballSetDiv").classList.remove("noShow");
            document.getElementById("ballSetCheckbox").disabled = false;
        } else {
            document.getElementById("ballTypeDiv").classList.add("noShow");
            document.getElementById("ballSetDiv").classList.add("noShow");

        }
        // Always allow ball set/ball type for 8-ball regardless of tracker
        // document.getElementById("ballSetCheckbox").disabled = false;
        // document.getElementById("ballSetDiv").classList.remove("noShow");

        // // Ball type controls should be visible in 8-ball
        // document.getElementById("ballTypeDiv").classList.remove("noShow");
    }

    if (getStorageItem("gameType") === "game2") {
        document.getElementById("ball 10").classList.add("noShow");
        document.getElementById("ball 11").classList.add("noShow");
        document.getElementById("ball 12").classList.add("noShow");
        document.getElementById("ball 13").classList.add("noShow");
        document.getElementById("ball 14").classList.add("noShow");
        document.getElementById("ball 15").classList.add("noShow");
    } else if (getStorageItem("gameType") === "game3") {
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
    resetBallTracker();

    // Reset ball style to American when switching away from 8-ball (game1)
    if (value === "game2" || value === "game3") {
        setStorageItem("ballSelection", "american");
        bc.postMessage({ ballSelection: "american" });
        updateControlPanelBallImages("american");
        console.log("Ball style reset to American for non-8-ball game");
    }
}

function ballType(value) {
    setStorageItem("ballSelection", value);

    // Update the label text based on ball type
    const redLabel = document.querySelector('label[for="p1colorRed"]');
    const yellowLabel = document.querySelector('label[for="p1colorYellow"]');
    if (redLabel) {
        if (value === "american") {
            redLabel.textContent = "Smalls/Lows/Solids";
        } else {
            redLabel.textContent = "Red";
        }
    }
    if (yellowLabel) {
        if (value === "american") {
            yellowLabel.textContent = "Bigs/Highs/Stripes";
        } else {
            yellowLabel.textContent = "Yellow";
        }
    }

    // Send ball type change message to browser source
    bc.postMessage({ ballType: value });

    if (document.getElementById("ballTrackerCheckbox").checked) {
        bc.postMessage({ displayBallTracker: true, ballTrackerType: getStorageItem("ballSelection") });
    } else {
        bc.postMessage({ displayBallTracker: false, ballTrackerType: getStorageItem("ballSelection") });
    }
    console.log(`Ball Type ${value}`)
}

function useBallSetToggle() {
    // Allow ball set toggle only for 8-ball
    const gameTypeIs8Ball = getStorageItem("gameType") === "game1";

    if (!gameTypeIs8Ball) {
        console.log("Ball set toggle is disabled - not 8-ball game");
        return;
    }

    var useBallSet = document.getElementById("ballSetCheckbox");
    var isChecked = useBallSet.checked;
    var storageValue = isChecked ? "yes" : "no";

    console.log(`Use Ball Set Toggle ${isChecked}`);
    setStorageItem("useBallSet", storageValue);
    if (isChecked) {
        document.getElementById("ballSet").style.display = 'flex';
        // document.getElementById("ballSetLabel").classList.remove("noShow");
    } else {
        document.getElementById("ballSet").style.display = 'none';
        // document.getElementById("ballSetLabel").classList.add("noShow");

        // Reset to "Open Table" and hide the ball images
        document.getElementById('p1colorOpen').checked = true;
        setStorageItem("playerBallSet", "p1Open");
        bc.postMessage({ playerBallSet: "p1Open" });
    }
    updatePlayerBallControlVisibility();
}

function ballSetChange() {
    const getSelectedP1Set = () => {
        const selectedRadio = document.querySelector('input[name="p1BallSetSelect"]:checked');
        if (selectedRadio) {
            return selectedRadio.value;
        }
        return null; // Or handle the case where no radio button is selected
    };

    var p1Selected = getSelectedP1Set()
    // Store the selection
    setStorageItem("playerBallSet", p1Selected);

    bc.postMessage({ playerBallSet: p1Selected });

    console.log(`Player 1 Ball Set Selected ${p1Selected}`)
}

function useBallTracker() {
    const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
    console.log('Both players enabled evaluation:', bothPlayersEnabled)
    setStorageItem("enableBallTracker", document.getElementById("ballTrackerCheckbox").checked);
    if (document.getElementById("ballTrackerCheckbox").checked) {
        document.getElementById("ballTrackerDirectionDiv").classList.remove("noShow");
        document.getElementById("ballTrackerDiv").classList.remove("noShow");
        document.getElementById("ballTracker").classList.remove("noShow");

        // Enable related ball controls for aplicable games
        const gameType = getStorageItem("gameType");

        if (gameType === "game1") {
            // For game1, -ball
            document.getElementById("ballSetCheckbox").disabled = false;
            document.getElementById("ballTypeDiv").classList.remove("noShow");
            document.getElementById("ballSetDiv").classList.remove("noShow");
        } else if (gameType !== "game2" && gameType !== "game3") {
            // For any game other than game2 and game3 (but not game1), therefore 9- and 10-ball
            document.getElementById("ballSetCheckbox").disabled = false;
            document.getElementById("ballTypeDiv").classList.remove("noShow");
            // Note: no line for ballSetDiv here
        }

    } else {
        // Hide tracker UI only
        document.getElementById("ballTrackerDirectionDiv").classList.add("noShow");
        document.getElementById("ballTrackerDiv").classList.add("noShow");
        document.getElementById("ballTracker").classList.add("noShow");
        document.getElementById("ballTypeDiv").classList.add("noShow");
        document.getElementById("ballSetDiv").classList.add("noShow");
    }
    if (bothPlayersEnabled) {
        bc.postMessage({ displayBallTracker: document.getElementById("ballTrackerCheckbox").checked });
    } else {
        console.log(`Both players are not enabled so we are not enabling the ball tracker`)
    }
    updatePlayerBallControlVisibility();
}

function toggleBallTrackerDirection() {
    // Get current direction from localStorage or default to "vertical"
    const currentDirection = getStorageItem("ballTrackerDirection") || "vertical";
    // Toggle direction
    const newDirection = currentDirection === "horizontal" ? "vertical" : "horizontal";
    // Send message to browser source
    bc.postMessage({ ballTracker: newDirection });
    // Update localStorage
    setStorageItem("ballTrackerDirection", newDirection);
    console.log(`Changed ball tracker to ${newDirection} orientation`);
    // Update button label to reflect NEW direction (current state after toggle)
    document.getElementById("ballTrackerDirectionDiv").innerHTML = newDirection.charAt(0).toUpperCase() + newDirection.slice(1).toLowerCase() + " Ball Tracker";
}

function updateControlPanelBallImages(selection) {
    console.log(`Updating control panel ball images to: ${selection}`);

    // Update all ball images in the control panel
    for (let i = 1; i <= 15; i++) {
        const ballElement = document.getElementById(`ball ${i}`);
        if (ballElement) {
            const img = ballElement.querySelector('img');
            if (img) {
                let imageSrc;

                if (selection === "international") {
                    // International ball naming convention
                    if (i >= 1 && i <= 7) {
                        imageSrc = `./common/images/yellow-international-small-ball.png`;
                    } else if (i === 8) {
                        imageSrc = `./common/images/international-8-small-ball.png`;
                    } else if (i >= 9 && i <= 15) {
                        imageSrc = `./common/images/red-international-small-ball.png`;
                    }
                } else {
                    // American ball naming convention (default)
                    imageSrc = `./common/images/${i}ball_small.png`;
                }

                img.src = imageSrc;
            }
        }
    }
}

function toggleBallSelection() {
    // Get current selection from localStorage or default to "american"
    const currentSelection = getStorageItem("ballSelection") || "american";
    // Only allow toggling ball style for 8-ball (game1)
    const currentGame = getStorageItem("gameType") || (document.getElementById("gameType") ? document.getElementById("gameType").value : "game1");
    if (currentGame === "game2" || currentGame === "game3") {
        console.log("Ball style toggle is not available for 9- or 10-ball (game2/game3)");
        return;
    }
    // Toggle selection
    const newSelection = currentSelection === "international" ? "american" : "international";
    // Send message to browser source
    bc.postMessage({ ballSelection: newSelection });
    // Update localStorage
    setStorageItem("ballSelection", newSelection);
    console.log(`Changed ball selection to ${newSelection} ball style`);
    // Update button label to reflect NEW selection (what it will show after toggle)
    // var bs = document.getElementById("ballSelection");
    // if (bs) {
    // 	bs.innerHTML = (newSelection === "american" ? "World (Small/Big,Lows/Highs,Solids/Stripes)" : "International (Red/Yellow)");
    // }
    // Update control panel ball images
    updateControlPanelBallImages(newSelection);
    ballType(newSelection);
    ballSetChange();
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
    balls.forEach(function (ball) {
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
        document.getElementById("playerToggleCheckbox").classList.remove("noShow");
        // document.getElementById("playerToggleLabel").classList.remove("noShow");
        setStorageItem("usePlayerToggle", "yes");
        bc.postMessage({ clockDisplay: 'showActivePlayer', player: activePlayer });
        console.log(`Player ${activePlayer ? 1 : 2} is active`);
    } else {
        document.getElementById("playerToggle").classList.add("noShow");
        document.getElementById("playerToggleCheckbox").classList.add("noShow");
        // document.getElementById("playerToggleLabel").classList.add("noShow");
        setStorageItem("usePlayerToggle", "no");
        bc.postMessage({ clockDisplay: 'hideActivePlayer' });
    }
    updatePlayerBallControlVisibility();
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
                    container.onclick = function (e) {
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
        if (c1value == "white" || c1value == "") {
            document.getElementById("p1colorDiv").style.color = "black"; document.getElementById("p1colorDiv").style.textShadow = "none";
        } else { document.getElementById("p1colorDiv").style.color = "white"; };
        if (c2value == "white" || c2value == "") {
            document.getElementById("p2colorDiv").style.color = "black"; document.getElementById("p2colorDiv").style.textShadow = "none";
        } else { document.getElementById("p2colorDiv").style.color = "white"; };
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

        if (cvalue == "white" || cvalue == "") {
            document.getElementById("p1colorDiv").style.color = "black"; document.getElementById("p1colorDiv").style.textShadow = "none";
        } else { document.getElementById("p1colorDiv").style.color = "white"; };
        setStorageItem("p1colorSet", document.getElementById("p" + player + "colorDiv").value);
        document.getElementsByTagName("select")[0].options[0].value = cvalue;
    } else {
        playerx = player;
        pColormsg = document.getElementById("p" + player + "colorDiv").value;
        bc.postMessage({ player: playerx, color: pColormsg });
        var selectedColor = document.getElementById("p" + player + "colorDiv").value;
        document.getElementById("p2colorDiv").style.background = `${selectedColor}`;
        document.getElementById("p2Name").style.background = `linear-gradient(to left, ${selectedColor}, white)`;

        if (cvalue == "white" || cvalue == "") {
            document.getElementById("p2colorDiv").style.color = "black"; document.getElementById("p2colorDiv").style.textShadow = "none";
        } else { document.getElementById("p2colorDiv").style.color = "white"; };
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
    ["Name", "NameLabel", "colorDiv", "ColorLabel"].forEach(function (elem) {
        document.getElementById("p" + player + elem).classList[action]("noShow");
    });

    // Check if both players are enabled
    const player1Enabled = getStorageItem("usePlayer1") === "yes";
    const player2Enabled = getStorageItem("usePlayer2") === "yes";
    const bothPlayersEnabled = player1Enabled && player2Enabled;
    const bothPlayersDisabled = !player1Enabled && !player2Enabled;
    const anyPlayerDisabled = !player1Enabled || !player2Enabled;

    // Handle score display checkbox
    const scoreDisplayCheckbox = document.getElementById("scoreDisplay");
    if (anyPlayerDisabled) {
        scoreDisplayCheckbox.disabled = true;
        scoreDisplayCheckbox.checked = false;
        setStorageItem("scoreDisplay", "no");
    } else {
        scoreDisplayCheckbox.disabled = false;
    }

    // Handle clock, player toggle, and ball tracker checkboxes
    const clockCheckbox = document.getElementById("useClockSetting");
    const toggleCheckbox = document.getElementById("useToggleSetting");
    const ballTrackerCheckbox = document.getElementById("ballTrackerCheckbox");

    if (anyPlayerDisabled) {
        // Disable and uncheck the checkboxes
        clockCheckbox.disabled = true;
        clockCheckbox.checked = false;
        setStorageItem("useClock", "no");

        toggleCheckbox.disabled = true;
        toggleCheckbox.checked = false;
        setStorageItem("usePlayerToggle", "no");

        ballTrackerCheckbox.disabled = true;
        ballTrackerCheckbox.checked = false;
        setStorageItem("enableBallTracker", "no");

        ballSetCheckbox.disabled = true;
        ballSetCheckbox.checked = false;
        setStorageItem("useBallSet", "no");
        resetBallSet()

        // Hide related elements
        document.getElementById("clockInfo").classList.add("noShow");
        document.getElementById("extensionControls").classList.add("noShow");
        document.getElementById("clockControlLabel").classList.add("noShow");
        document.getElementById("playerToggle").classList.add("noShow");
        document.getElementById("playerToggleLabel").classList.add("noShow");
        document.getElementById("ballTrackerDirectionDiv").classList.add("noShow");
        document.getElementById("ballTrackerDiv").classList.add("noShow");
        document.getElementById("ballTracker").classList.add("noShow");
        document.getElementById("ballTypeDiv").classList.add("noShow");


        // Send messages to hide these features
        bc.postMessage({ clockDisplay: 'noClock' });
        bc.postMessage({ clockDisplay: 'hideActivePlayer' });
        bc.postMessage({ displayBallTracker: false });
    } else {
        // Enable the checkboxes
        clockCheckbox.disabled = false;
        toggleCheckbox.disabled = false;
        ballTrackerCheckbox.disabled = false;
    }

    // Show/hide  elements based on individual players being enabled
    document.getElementById("logoName").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("customLogo1").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("uploadCustomLogo").classList[player1Enabled ? "remove" : "add"]("noShow");
    document.getElementById("logoName2").classList[player2Enabled ? "remove" : "add"]("noShow");
    document.getElementById("customLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");
    document.getElementById("uploadCustomLogo2").classList[player2Enabled ? "remove" : "add"]("noShow");

    // Hide shared elements based on both players being enabled
    document.getElementById("gameInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("teamInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfo").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfoTxt").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("sendPNames").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");
    document.getElementById("playerDetailLabel").classList[bothPlayersDisabled ? "add" : "remove"]("noShow");

    // Hide Race info when any player is disabled
    document.getElementById("raceInfo").classList[anyPlayerDisabled ? "add" : "remove"]("noShow");
    document.getElementById("raceInfoTxt").classList[anyPlayerDisabled ? "add" : "remove"]("noShow");

    bc.postMessage({ playerDisplay: usePlayer, playerNumber: player });

    // updateTabVisibility();

    document.getElementById("swapBtn").classList[bothPlayersEnabled ? "remove" : "add"]("noShow");
}

function scoreDisplaySetting() {
    const scoreDisplay = document.getElementById("scoreDisplay");
    if (!document.getElementById("scoreDisplay").checked) {
        setStorageItem("scoreDisplay", "no");
    } else if (document.getElementById("scoreDisplay").checked) {
        setStorageItem("scoreDisplay", "yes");
    }
    if (getStorageItem("usePlayer1") === "yes" && getStorageItem("usePlayer2") === "yes") {
        bc.postMessage({ scoreDisplay: scoreDisplay.checked ? "yes" : "no" });
    }
}

function clockSetting() {
    const clockDiv = document.getElementById("clockInfo");
    if (!document.getElementById("useClockSetting").checked) {
        setStorageItem("useClock", "no");
        bc.postMessage({ clockDisplay: 'noClock' });
        document.getElementById("clockInfo").classList.add("noShow");
        document.getElementById("extensionControls").classList.add("noShow");
        document.getElementById("clockControlLabel").classList.add("noShow");
    } else if (document.getElementById("useClockSetting").checked) {
        setStorageItem("useClock", "yes");
        bc.postMessage({ clockDisplay: 'useClock' });
        document.getElementById("clockInfo").classList.remove("noShow");
        document.getElementById("extensionControls").classList.remove("noShow");
        document.getElementById("clockControlLabel").classList.remove("noShow");
    }
    // updateTabVisibility();
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

function clearGame() {
    console.log('Clearing Match Data');
    document.getElementById("raceInfoTxt").value = "";
    document.getElementById("gameInfoTxt").value = "";
    document.getElementById("p1Name").value = "";
    document.getElementById("p2Name").value = "";
    setStorageItem("p1NameCtrlPanel", "");
    setStorageItem("p2NameCtrlPanel", "");
    setStorageItem("raceInfo", "");
    setStorageItem("gameInfo", "");
    resetBallSet();
    postNames();
    pushScores();
    postInfo();
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
    if (!p1Name.value == "") { document.getElementById("p1ScoreLabel").innerHTML = p1namemsg + " - Score/Rack(s)/Ball(s)"; } else { document.getElementById("p1ScoreLabel").innerHTML = "Player/Team 1 - Score/Rack(s)/Ball(s)"; }
    if (!p2Name.value == "") { document.getElementById("p2ScoreLabel").innerHTML = p2namemsg + " - Score/Rack(s)/Ball(s)"; } else { document.getElementById("p2ScoreLabel").innerHTML = "Player/Team 2 - Score/Rack(s)/Ball(s)"; }
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

function postSources() {
    const sceneNameEl = document.getElementById('replaySceneName');
    const videoSourceEl = document.getElementById('replayVideoSourceName');
    const indicatorSourceEl = document.getElementById('replayIndicatorSourceName');

    // Clean up empty strings
    if (sceneNameEl.value.trim() === "") {
        sceneNameEl.value = "";
    }
    if (videoSourceEl.value.trim() === "") {
        videoSourceEl.value = "";
    }
    if (indicatorSourceEl.value.trim() === "") {
        indicatorSourceEl.value = "";
    }

    // Save the values (using replaySceneName as the storage key)
    setStorageItem("replaySceneName", sceneNameEl.value);
    setStorageItem("replayVideoSourceName", videoSourceEl.value);
    setStorageItem("replayIndicatorSourceName", indicatorSourceEl.value);

    // Update visibility after saving
    updateReplayControlsVisibility();

    console.log('Replay source settings saved:', {
        sceneName: sceneNameEl.value,
        videoSource: videoSourceEl.value,
        indicatorSource: indicatorSourceEl.value
    });
}

function loadReplaySources() {
    const sceneName = getStorageItem("replaySceneName") || "";
    const videoSource = getStorageItem("replayVideoSourceName") || "";
    const indicatorSource = getStorageItem("replayIndicatorSourceName") || "";

    document.getElementById('replaySceneName').value = sceneName;
    document.getElementById('replayVideoSourceName').value = videoSource;
    document.getElementById('replayIndicatorSourceName').value = indicatorSource;
}

function getReplaySettings() {
    return {
        sceneName: getStorageItem("replaySceneName") || "",
        videoSource: getStorageItem("replayVideoSourceName") || "",
        indicatorSource: getStorageItem("replayIndicatorSourceName") || ""
    };
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
                document.getElementById("p" + player + "Score").value = p1ScoreValue;
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
            document.getElementById("p" + player + "Score").value = p1ScoreValue;
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
                document.getElementById("p" + player + "Score").value = p2ScoreValue;
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
            document.getElementById("p" + player + "Score").value = p2ScoreValue;
        }
    }
    resetBallSet();
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
    checkbox.addEventListener('change', function () {
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
    checkbox.addEventListener('change', function () {
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
    if (useToggleCheckbox.checked) {
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
    if (getStorageItem("obsTheme") == null) { setStorageItem("obsTheme", "27"); document.getElementById("obsTheme").value = "27"; };
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
        resetBallSet();
    } else { }
}

function resetBallSet() {
    setStorageItem("playerBallSet", "p1Open");
    document.getElementById('p1colorOpen').checked = true;
    bc.postMessage({ playerBallSet: "p1Open" });
}

function resetBallTracker() {
    // Retrieve the saved ball state from localStorage
    let ballState = JSON.parse(getStorageItem('ballState') || '{}');

    // Select all ball elements within the .ballTracker container
    const ballElements = document.querySelectorAll('.ball');

    ballElements.forEach(function (ball) {
        // Remove the 'faded' class to reset the ball
        ball.classList.remove('faded');

        // Update the ball state to false (not faded)
        ballState[ball.id] = false;
        bc.postMessage({ resetBall: ball.id });
    });

    // Save the updated state back to localStorage
    setStorageItem('ballState', JSON.stringify(ballState));

    console.log("All balls have been reset in ball tracker.");
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
            "L" + (xL - 2);
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
        if (xL === 1) {
            setStorageItem("useCustomLogo", "no");
            customLogoSetting();
        } else {
            setStorageItem("useCustomLogo2", "no");
            customLogoSetting2();
        }
        var fileInput = document.getElementById("FileUploadL" + xL);
        toggleCheckbox("customLogo" + xL, fileInput)
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
        removeAllData(INSTANCE_ID);
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

function checkForUpdate() {
    const updateStatus = document.getElementById('updateStatus');
    updateStatus.textContent = "Checking for updates...";

    fetch('https://api.github.com/repos/iainsmacleod/CueSport-Scoreboard/releases/latest')
        .then(response => {
            if (!response.ok) {
                throw new Error(`GitHub API request failed: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const latestVersion = data.tag_name.replace(/^v/, '');
            if (compareVersions(latestVersion, versionNum) > 0) {
                updateStatus.innerHTML = `Update available! Latest version: ${latestVersion}&nbsp; 
<a href="${data.html_url}" target="_blank" rel="noopener noreferrer" style="color: red;">Download Update</a>`;

            } else {
                updateStatus.textContent = "You have the latest version.";
            }
        })
        .catch(error => {
            updateStatus.textContent = "Error checking for updates. Please try again later.";
            console.error("Update check failed:", error);
        });
}

function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;
        if (part1 > part2) return 1;
        if (part1 < part2) return -1;
    }
    return 0;
}

function updateLayout() {
    // Force layout recalculation
    const tabContents = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabContents.length; i++) {
        if (tabContents[i].style.display !== "none") {
            // Only update visible tabs
            LayoutRebuilder.ForceRebuildLayoutImmediate(tabContents[i]);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('obsPassword');

    // Only add toggle event listener if password field exists
    if (toggleBtn && passwordInput) {
        toggleBtn.style.display = passwordInput.value ? 'flex' : 'none';

        toggleBtn.addEventListener('click', () => {
            if (!passwordInput.value) return; // Do nothing if no password

            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                toggleBtn.textContent = 'Hide';
            } else {
                passwordInput.type = 'password';
                toggleBtn.textContent = 'Show';
            }
        });

        // Optionally, listen to input changes to hide/show button dynamically
        passwordInput.addEventListener('input', () => {
            toggleBtn.style.display = passwordInput.value ? 'flex' : 'none';
            // Reset input type and button text when emptied
            if (!passwordInput.value) {
                passwordInput.type = 'password';
                toggleBtn.textContent = 'Show';
            }
        });
    }
});

function getObsAddress() {
    const input = document.getElementById('obsAddress');
    const address = input ? input.value.trim() : '';
    return address || 'ws://127.0.0.1:4455'; // fallback to default if empty
}

function getObsPassword() {
    const input = document.getElementById('obsPassword');
    const password = input ? input.value.trim() : '';
    return password || ''; // fallback to default if empty
}

function autoResumeReplayBuffer() {
    const autoResumeReplayBuffer = document.getElementById("autoResumeReplayBuffer").checked;
    if (autoResumeReplayBuffer) {
        // document.getElementById("autoResumeReplayBuffer").checked = true;
        setStorageItem("autoResumeReplayBuffer", "yes");
    } else {
        // document.getElementById("autoResumeReplayBuffer").checked = false;
        setStorageItem("autoResumeReplayBuffer", "no");
    }
}

async function connectToObsWebSocket() {
    if (isConnected) {
        if (isMonitoringActive) {
            await toggleReplayMonitoring();
        }
        // Disconnect
        try {
            await obs.disconnect();
            isConnected = false;
            updateConnectButton();
            console.log('Disconnected from OBS WebSocket');
        } catch (err) {
            console.error('Failed to disconnect:', err);
            alert('Failed to disconnect: ' + (err.message || err.toString()));
        }
    } else {
        // Connect
        const address = getObsAddress();
        const password = getObsPassword();

        try {
            await obs.connect(address, password); // Pass both URL and password
            isConnected = true;
            updateConnectButton();
            console.log('OBS WebSocket: Connected and authenticated');
        } catch (err) {
            console.error('Failed to connect:', err);
            alert('Failed to connect.\n\nDetails: ' + (err.message || err.toString()));
        }
    }
}

function updateConnectButton() {
    const connectBtn = document.getElementById('connectBtn');
    if (!connectBtn) return;
    if (isConnected) {
        connectBtn.textContent = 'Disconnect';
        connectBtn.style.backgroundColor = 'red';
    } else {
        connectBtn.textContent = 'Connect';
        connectBtn.style.backgroundColor = 'green';
    }
}

async function getSceneItemId(sceneName, sourceName) {
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
    const item = sceneItems.find(i => i.sourceName === sourceName);
    if (!item) throw new Error(`Source ${sourceName} not found in scene ${sceneName}`);
    return item.sceneItemId;
}

async function showSource(sceneName, sourceName) {
    const id = await getSceneItemId(sceneName, sourceName);
    await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId: id, sceneItemEnabled: true });
}

async function hideSource(sceneName, sourceName) {
    if (!sourceName || sourceName.trim() === "") {
        console.warn(`No source name provided for hiding in scene "${sceneName}". Skipping.`);
        return;
    }

    try {
        const id = await getSceneItemId(sceneName, sourceName);
        if (id === null || id === undefined) {
            console.warn(`Source "${sourceName}" not found in scene "${sceneName}".`);
            return;
        }
        await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId: id, sceneItemEnabled: false });
        console.log(`Source "${sourceName}" hidden in scene "${sceneName}".`);
    } catch (error) {
        console.error(`Failed to hide source "${sourceName}" in scene "${sceneName}":`, error);
    }
}

const settings = getReplaySettings();

// // Usage with your single scene name, for example:
// const SCENE_NAME = document.getElementById("replaySceneName").value;
// const REPLAY_VIDEO_SOURCE_NAME = document.getElementById("replayVideoSourceName").value;  // Name of the Media Source that should play the replay
// const REPLAY_INDICATOR_SOURCE_NAME = document.getElementById("replayIndicatorSourceName").value;  // Name of your Text Source in OBS


obs.on('MediaInputPlaybackEnded', async ({ inputName }) => {
    const { sceneName, videoSource, indicatorSource } = getReplaySettings();
    if (inputName === videoSource) {
        try {
            await hideSource(sceneName, indicatorSource);
            await hideSource(sceneName, videoSource); // before replay
            console.log(`MediaInputPlaybackEnded event received for ${inputName}, source hidden.`);
        } catch (error) {
            console.error('Error hiding replay source on playback end:', error);
        }
    }
    if (document.getElementById("autoResumeReplayBuffer").checked){
        toggleReplayMonitoring();
    } return;
});

async function showReplayIndicator(sceneName) {
    const textSceneItemId = await getSceneItemId(sceneName, REPLAY_TEXT_NAME);
    await obs.call('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: textSceneItemId,
        sceneItemEnabled: true,
    });
}

async function hideReplayIndicator(sceneName) {
    const textSceneItemId = await getSceneItemId(sceneName, REPLAY_TEXT_NAME);
    await obs.call('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: textSceneItemId,
        sceneItemEnabled: false,
    });
}

// When the replay is saved, OBS emits ReplayBufferSaved with the file path
obs.on('ReplayBufferSaved', async ({ savedReplayPath }) => {
    try {
        const { sceneName, videoSource, indicatorSource } = getReplaySettings();

        await showSource(sceneName, videoSource); // always show videoSource

        if (indicatorSource) {
            await showSource(sceneName, indicatorSource); // only if indicator source is set
        }

        // Restart playback to begin from the start
        await obs.call('TriggerMediaInputAction', {
            inputName: videoSource,
            mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
        });

        console.log('Replay loaded and playing:', savedReplayPath);
    } catch (error) {
        console.error('Failed to load/play replay in media source:', error);
    }
});

// OBS v5 lifecycle events
obs.on('ConnectionOpened', () => {
    console.log('OBS WebSocket: ConnectionOpened');
});

obs.on('Identified', () => {
    isObsReady = true;
    console.log('OBS WebSocket: Identified (ready for requests)');
    // setButtonsEnabled(true);
});

obs.on('ConnectionClosed', () => {
    isObsReady = false;
    console.warn('OBS WebSocket: ConnectionClosed');
    // setButtonsEnabled(false);
});

// Enable/disable the replay control buttons until ready
// function setButtonsEnabled(enabled) {
//     const ids = ['btnMonitorGame', 'btnReplayClip'];
//     ids.forEach(id => {
//         const el = document.getElementById(id);
//         if (el) el.disabled = !enabled;
//     });
// }
// setButtonsEnabled(false);

// UI helpers
function setMonitorButtonText() {
    const btn = document.getElementById('btnMonitorGame');
    if (!btn) return;
    if (isMonitoringActive) {
        btn.textContent = 'Stop Monitoring';
        btn.style.backgroundColor = 'red';  // red fill for Stop Monitoring
        btn.style.color = 'white';           // optionally set text color for contrast
    } else {
        btn.textContent = 'Resume Monitoring';
        btn.style.backgroundColor = 'green'; // green fill for Resume Monitoring
        btn.style.color = 'white';            // optionally set text color
    }
}

function setReplayButtonText() {
    const btn = document.getElementById('btnReplayClip');
    if (!btn) return;
    btn.textContent = hasSavedClip ? 'Restart Clip' : 'Instant Replay';
}

// One-time wait for ReplayBufferSaved
function waitForReplaySaved(timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const handler = ({ savedReplayPath }) => {
            if (settled) return;
            settled = true;
            obs.off('ReplayBufferSaved', handler);
            resolve(savedReplayPath);
        };

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            obs.off('ReplayBufferSaved', handler);
            reject(new Error('Timed out waiting for ReplayBufferSaved'));
        }, timeoutMs);

        obs.on('ReplayBufferSaved', (evt) => {
            clearTimeout(timer);
            handler(evt);
        });
    });
}

// Replay/Restart Clip handler
async function triggerReplayClip() {
    if (!isObsReady) {
        console.log('Failed to control OBS: OBS connection is not ready, most likely the websocket connection has not been setup.');
        alert('Failed to control OBS: OBS connection is not ready, most likely the websocket connection has not been setup.');
        return;
    }

    // If we already have a saved clip, just restart it
    if (hasSavedClip) {
        const { sceneName, videoSource, indicatorSource } = getReplaySettings();
        await showSource(sceneName, videoSource); // always show videoSource
        if (indicatorSource) {
            await showSource(sceneName, indicatorSource); // only if indicator source is set
        }

        try {
            await obs.call('TriggerMediaInputAction', {
                inputName: videoSource,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
            });
            console.log('Restarting current clip');
            return;
        } catch (error) {
            console.error('Failed to restart clip:', error);
            return;
        }
    }

    // First time: need to save a clip first
    try {
        // If monitoring is not active, we can't save a new clip
        if (!isMonitoringActive) {
            console.warn('Cannot replay: monitoring is not active and no saved clip exists.');
            alert('Cannot replay: monitoring is not active and no saved clip exists.');
            return;
        }

        // Confirm replay buffer is running
        const { outputActive } = await obs.call('GetReplayBufferStatus');
        if (!outputActive) {
            console.warn('Replay buffer is not running; cannot save replay.');
            alert('Replay buffer is not running; cannot save replay.');
            return;
        }

        // Get and preserve current settings BEFORE saving
        const { videoSource } = getReplaySettings();
        if (!videoSource) {
            console.error('Replay video source name not configured.');
            alert('Replay video source name not configured.');
            return;
        }

        let originalSettings = null;
        try {
            const currentSettings = await obs.call('GetInputSettings', {
                inputName: videoSource
            });
            originalSettings = currentSettings.inputSettings;
            console.log('Preserved original Media Source settings before save');
        } catch (error) {
            console.warn('Could not get original settings:', error);
        }

        // NOW save the replay (this might change the settings)
        const savedPathPromise = waitForReplaySaved(8000);
        await obs.call('SaveReplayBuffer');
        const savedPath = await savedPathPromise;

        // Stop monitoring
        try {
            await obs.call('StopReplayBuffer');
            isMonitoringActive = false;
            setMonitorButtonText();
        } catch (err) {
            console.error('Failed to stop replay buffer:', err);
        }

        // Restore original settings and set the new file
        await obs.call('SetInputSettings', {
            inputName: videoSource,
            inputSettings: {
                ...originalSettings,  // Restore all original settings
                local_file: savedPath,  // Override just the file path
            },
            overlay: false
        });

        await obs.call('TriggerMediaInputAction', {
            inputName: videoSource,
            mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
        });

        // Mark that we have a saved clip and update button
        hasSavedClip = true;
        setReplayButtonText();

        console.log('Replay ready and playing:', savedPath);

        // Save new replay path to history
        replayHistory.push(savedPath);

        // Keep only the last 5 entries
        if (replayHistory.length > 5) {
            replayHistory.shift(); // removes the oldest (first) entry
        }

        console.log('Updated Replay History:', replayHistory);

    } catch (error) {
        console.error('Replay Clip failed:', error);
    }
    updateReplayButtonsVisibility()
}

async function playPreviousReplay(index) {
    try {
        const { outputActive } = await obs.call('GetReplayBufferStatus');
        if (outputActive) {
            await obs.call('StopReplayBuffer');
            isMonitoringActive = false;
            setMonitorButtonText();
            console.log('Replay buffer stopped.');
        } else {
            console.log('Replay buffer already inactive, skipping stop.');
        }
    } catch (err) {
        console.error('Failed to stop replay buffer:', err);
    }

    if (index < 0 || index >= replayHistory.length) {
        console.warn('Invalid replay index');
        return;
    }

    const filePath = replayHistory[index];
    const { sceneName, videoSource, indicatorSource } = getReplaySettings();
    await showSource(sceneName, videoSource); // always show videoSource
    if (indicatorSource) {
        await showSource(sceneName, indicatorSource); // only if indicator source is set
    }

    try {
        // Preserve full input settings before modification
        const { inputSettings } = await obs.call('GetInputSettings', {
            inputName: videoSource,
        });

        // Apply old settings with new file path
        await obs.call('SetInputSettings', {
            inputName: videoSource,
            inputSettings: {
                ...inputSettings,
                local_file: filePath,
            },
            overlay: false,
        });

        await obs.call('TriggerMediaInputAction', {
            inputName: videoSource,
            mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
        });

        console.log('Replaying historic clip:', filePath);
    } catch (err) {
        console.error('Failed to play previous replay:', err);
    }
}


function updateReplayButtonsVisibility() {
    for (let i = 0; i < 5; i++) {
        const buttonId = `prvReplayClip${i + 1}`;
        const button = document.getElementById(buttonId);
        if (!button) continue;

        // Show button only if replayHistory has a clip at index i
        if (replayHistory[i]) {
            button.style.display = 'inline-block';  // or 'block' based on your layout
            button.disabled = false;                 // enable the button
        } else {
            button.style.display = 'none';          // hide the button
            button.disabled = true;                  // disable the button for safety
        }
    }
}


// Monitor toggle
async function toggleReplayMonitoring() {
    if (!isObsReady) {
        alert('Failed to initiate monitoring: OBS connection is not ready, most likely the websocket connection has not been setup.');
        return;
    }
    try {
        if (!isMonitoringActive) {
            // Resume monitoring: stop any active replay first
            const { videoSource } = getReplaySettings();
            if (hasSavedClip) {
                try {
                    await obs.call('TriggerMediaInputAction', {
                        inputName: videoSource,
                        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
                    });
                    console.log('Stopped active replay before resuming monitoring');
                } catch (err) {
                    console.warn('Failed to stop active replay:', err);
                    // Continue anyway
                }
            }

            await obs.call('StartReplayBuffer');
            isMonitoringActive = true;
            // When monitoring resumes, reset clip state
            hasSavedClip = false;
            btnReplayClip.classList.remove('noShow');
            setReplayButtonText();
        } else {
            await obs.call('StopReplayBuffer');
            isMonitoringActive = false;
            btnReplayClip.classList.add('noShow');
        }
        setMonitorButtonText();
    } catch (error) {
        console.error('Replay buffer toggle failed:', error);
    }
}