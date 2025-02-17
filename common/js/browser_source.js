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
//						functions
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////            

function postLogo() {
	if (localStorage.getItem("customLogo1") != null && localStorage.getItem("customLogo1") != "") {
		document.getElementById("customLogo1").src = localStorage.getItem("customLogo1");
	}
	if (localStorage.getItem("customLogo2") != null && localStorage.getItem("customLogo2") != "") {
		document.getElementById("customLogo2").src = localStorage.getItem("customLogo2");
	}
}

function clearWinBlink() {
	document.getElementById("player1Score").classList.remove("winBlink");
	document.getElementById("player2Score").classList.remove("winBlink");
	var gameType = localStorage.getItem("gameType");
	playWebmAnimation(gameType, '#videoContainer');
}

function sleep(milliseconds) {
	var start = new Date().getTime();
	for (var i = 0; i < 1e7; i++) {
		if ((new Date().getTime() - start) > milliseconds) {
			break;
		}
	}
}

function shotTimer(shottime) {
	countDownTime = new Date().getTime() + shottime;
	sleep(1); //fixes clock 0 glitch. 1ms wait time. allows time for countdowntime to reliably update.
	if (shottime == 61000) {
		document.getElementById("shotClockVis").classList.add("start60");
		document.getElementById("shotClockVis").classList.replace("fadeOutElm", "fadeInElm");
	} else {
		document.getElementById("shotClockVis").classList.add("startTimer");
	}
	shotClockxr = setInterval(function () {
		var now = new Date().getTime();
		var distance = countDownTime - now;
		var seconds = Math.floor((distance % (1000 * 60)) / 1000);
		document.getElementById("shotClockVis").style.background = "lime";
		document.getElementById("shotClock").style.background = "green";
		if (distance > 21000) { document.getElementById("shotClock").style.color = "white"; };
		if (distance > 5000 && distance < 21000) { document.getElementById("shotClock").style.color = "black"; };
		if (distance > 60000) { seconds = seconds + 60; };
		document.getElementById("shotClock").innerHTML = seconds + "s";
		if (distance < 31000) {
			document.getElementById("shotClockVis").classList.replace("fadeOutElm", "fadeInElm");
			document.getElementById("shotClockVis").style.background = "lime";
			document.getElementById("shotClockVis").classList.add("startTimer");
		}
		if (distance < 26000) {
			document.getElementById("shotClockVis").style.opacity = "0.7";
		}
		if (distance < 21000) {
			document.getElementById("shotClockVis").style.background = "orange";
			document.getElementById("shotClock").style.background = "orange";
		}
		if (distance < 16000) {
			document.getElementById("shotClock").style.background = "yellow";
			document.getElementById("shotClockVis").style.background = "yellow";
		}
		if (distance < 11000) {
			document.getElementById("shotClock").style.background = "tomato";
			document.getElementById("shotClockVis").style.background = "tomato";
			document.getElementById("shotClockVis").style.opacity = "1";
		}
		if (distance < 11000 && distance > 9700) { showClock(); };
		if (distance < 6000 && distance > 999) {
			document.getElementById("shotClock").classList.add("shotRed");
			document.getElementById("shotClock").style.background = "red";
			document.getElementById("shotClockVis").style.background = "red";
			document.getElementById("shotClock").style.color = "white";
		}
		if (distance < 1000) {
			clearInterval(shotClockxr);
			document.getElementById("shotClock").style.background = "red";
			document.getElementById("shotClockVis").style.background = "red";
			document.getElementById("shotClock").style.color = "white";
		}
		if (seconds == tev) {
			var ntev = seconds-- - 1;
			document.getElementById("shotClock").innerHTML = ntev + "s";
			var tev = ntev;
			console.log("dup Detected - corrected tev:" + tev);
			bcr.postMessage(tev);
		} else {
			document.getElementById("shotClock").innerHTML = seconds + "s";
			tev = seconds;
			console.log("tev:" + tev);
			bcr.postMessage(tev);
		}
	}, 1000);
}

function showClock() {
	document.getElementById("shotClock").classList.replace("fadeOutElm", "fadeInElm");
}

function hideClock() {
	document.getElementById("shotClock").classList.replace("fadeInElm", "fadeOutElm");
}

function showPlayer(playerNumber) {
	document.getElementById("player"+playerNumber+"Name").classList.replace("fadeOutElm", "fadeInElm");
}

function hidePlayer(playerNumber) {
	document.getElementById("player"+playerNumber+"Name").classList.replace("fadeInElm", "fadeOutElm");
}

function showScores() {
	document.getElementById("player1Score").classList.replace("fadeOutElm", "fadeInElm");
	document.getElementById("player2Score").classList.replace("fadeOutElm", "fadeInElm");
	document.getElementById("raceInfo").classList.replace("fadeOutElm", "fadeInElm");
}

function hideScores() {
	document.getElementById("player1Score").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("player2Score").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("raceInfo").classList.replace("fadeInElm", "fadeOutElm");
}


function stopClock() {
	clearInterval(shotClockxr);
	hideClock();
	document.getElementById("shotClock").innerHTML = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
	document.getElementById("shotClock").classList.remove("shotRed");
	document.getElementById("shotClock").style.background = "";
	document.getElementById("shotClockVis").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("shotClockVis").classList.remove("startTimer");
	document.getElementById("shotClockVis").classList.remove("start60");
	document.getElementById("shotClockVis").style.background = "";
}

function add30(player) {
	countDownTime = countDownTime + 30000;
	document.getElementById("p" + player + "ExtIcon").style.background = "darkred";
	document.getElementById("shotClock").classList.remove("shotRed");
	document.getElementById("shotClock").style.background = "";
	document.getElementById("shotClockVis").classList.remove("startTimer");
	document.getElementById("shotClockVis").classList.remove("start60");
	document.getElementById("shotClockVis").style.background = "";
	document.getElementById("shotClock").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("shotClockVis").classList.replace("fadeInElm", "fadeOutElm");
	document.getElementById("p" + player + "ExtIcon").classList.add("extBlink");
	playerNumber = player;
	setTimeout("clearExtBlink(playerNumber)", 500);
}

function clearExtBlink(playerN) {
	document.getElementById("p" + playerN + "ExtIcon").classList.remove("extBlink");
	document.getElementById("p" + playerN + "ExtIcon").style.background = "darkred";

}

function extReset(player) {
	document.getElementById(player + "ExtIcon").style.background = "green";

}

function customShow() {
	document.getElementById("customLogo1").style.removeProperty('display');
	setTimeout(function () {
		if (document.getElementById("customLogo1").classList.contains("logoSlide")) {
			document.getElementById("customLogo1").classList.replace("logoSlide", "fadeOutElm");
		}
		if (document.getElementById("customLogo1").classList.contains("fade")) {
			document.getElementById("customLogo1").classList.replace("fade", "fadeOutElm");
		}
		document.getElementById("customLogo1").classList.replace("fadeOutElm", "fadeInElm");
	}, 100);
}

function customHide() {
	document.getElementById("customLogo1").classList.replace("fadeInElm", "fadeOutElm");
	setTimeout(function () { 
		document.getElementById("customLogo1").style.display = "none"; 
	}, 1000);
}		

function custom2Show() {
	document.getElementById("customLogo2").style.removeProperty('display');
	setTimeout(function () {
		if (document.getElementById("customLogo2").classList.contains("logoSlide")) {
			document.getElementById("customLogo2").classList.replace("logoSlide", "fadeOutElm");
		}
		if (document.getElementById("customLogo2").classList.contains("fade")) {
			document.getElementById("customLogo2").classList.replace("fade", "fadeOutElm");
		}
		document.getElementById("customLogo2").classList.replace("fadeOutElm", "fadeInElm");
	}, 100);
}

function custom2Hide() {
	document.getElementById("customLogo2").classList.replace("fadeInElm", "fadeOutElm");
	setTimeout(function () { 
		document.getElementById("customLogo2").style.display = "none"; 
	}, 1000);
}

function toggleActivePlayer(activePlayer) {
    if (activePlayer === true || activePlayer === null) {
		console.log(`Show player 1`);
        document.getElementById("player1Image").classList.replace("fadeOutElm", "fadeInElm");
        document.getElementById("player2Image").classList.replace("fadeInElm", "fadeOutElm");
    } else if (activePlayer === false) {
		console.log(`Show player 2`);
        document.getElementById("player1Image").classList.replace("fadeInElm", "fadeOutElm");
        document.getElementById("player2Image").classList.replace("fadeOutElm", "fadeInElm");
    }else {
        console.log(`No valid player selected`); // Log if no valid player
		console.log(typeof activePlayer);
    }
}

function showSlides() {
	let slides = document.getElementsByClassName("logoSlide");
	let loadedSlides = []; // Array to hold loaded slides

	// Hide all slides initially
	for (let i = 0; i < slides.length; i++) {
		slides[i].style.display = "none";
	}

	// Check which logos are loaded and add to loadedSlides
	if (localStorage.getItem("customLogo3") && localStorage.getItem("customLogo3").startsWith("data")) loadedSlides.push(slides[0]); // Assuming customLogo3 is the first slide
	if (localStorage.getItem("customLogo4") && localStorage.getItem("customLogo4").startsWith("data")) loadedSlides.push(slides[1]); // Assuming customLogo4 is the second slide
	if (localStorage.getItem("customLogo5") && localStorage.getItem("customLogo5").startsWith("data")) loadedSlides.push(slides[2]); // Assuming customLogo5 is the third slide

	// Increment slide index and reset if it exceeds loaded slides
	slideIndex++;
	console.log("Number of slides found:", loadedSlides.length); // Debug line

	if (slideIndex > loadedSlides.length) { slideIndex = 1; } // Reset index if it exceeds loaded slides

	// Show only the loaded slide
	if (loadedSlides.length > 0) {
		loadedSlides[slideIndex - 1].style.display = "block"; // Show the current slide
	}

	// Change image every 20 seconds
	setTimeout(showSlides, 20000); 
}

function styleChange(n) {
	if (n == 1) {
		document.styleSheets[0].disabled = false;
		document.styleSheets[1].disabled = true;
		document.styleSheets[2].disabled = true;
	}
	if (n == 2) {
		document.styleSheets[0].disabled = true;
		document.styleSheets[1].disabled = false;
		document.styleSheets[2].disabled = true;
	}
	if (n == 3) {
		document.styleSheets[0].disabled = true;
		document.styleSheets[1].disabled = true;
		document.styleSheets[2].disabled = false;
	}
}

function playWebmAnimation(gameType, containerSelector = '#videoContainer') {
	// Determine which video URL to use based on the gameType value.
    let videoUrl;
    switch (gameType) {
        case 'game1':
            videoUrl = './common/video/defaultanimation.webm';
            break;
		case 'game2':
            videoUrl = './common/video/8ballwin.webm';
            break;
        case 'game3':
            videoUrl = './common/video/9ballwin.webm';
            break;
        case 'game4':
            videoUrl = './common/video/10ballwin.webm';
            break;
        // Add more cases as needed
        default:
            videoUrl = './common/video/defaultanimation.webm';
            break;
    }

    // Get the container element where the video will be appended.
    const container = document.querySelector(containerSelector);
    if (!container) {
        console.warn("Container not found for selector: " + containerSelector);
        return;
    }
    
	// Optionally, give the container a high z-index and proper positioning
    container.style.position = 'absolute';  // or fixed/absolute, depending on your layout
    container.style.zIndex = '4';         // Ensure the container is over other content

    // Create and configure the video element.
    const video = document.createElement('video');
    video.src = videoUrl;
    video.autoplay = true;
    video.playsInline = true;  // Helps with mobile devices.
    video.muted = true;        // Muted is often required for autoplay.

	// Ensure the video element itself has a transparent background
	// video.style.backgroundColor = 'transparent';
    
    // Add a CSS class so you can style the video through required.css.
    video.classList.add('webm-animation');
    
    // Append the video element to the specified container.
    container.appendChild(video);
    
    // Remove the video element once the animation has finished playing.
    video.addEventListener('ended', () => {
        container.removeChild(video);
    });
    
    // (Optional) Allow early removal on click.
    video.addEventListener('click', () => {
        container.removeChild(video);
    });
    
    // Return the video element for further manipulation if needed.
    return video;
}
