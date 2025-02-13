<div align="center"><table width="100%" border="0"><tr><td><div align="center"><p style="color:yellow; font-weight:bolder"><b>CueSport ScoreBoard</b></div></td><td>
<div align="center"><span style="font-size: 12px"><i>(Must be viewed @ 1920x1080)</i></span></div></td></tr><tr><td colspan="2"><div align="center"><br><b>Made for cue sport fans by a cue sport fan, based off of the <a href="https://github.com/ngholson/g4ScoreBoard/">g4scoreboard</a><br><span style="color: yellow"><br>A clean and professional solution for displaying: player names, race and wager information, scores, logos, and sponsors.</span><br><br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Includes g4scoreboard shot clock inspired by the clock used during the Mosconi Cup<a href="#matchroom-pool">*</a> and European Open<a href="#matchroom-pool">*</a></b>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<br><br><br></div></td></tr><tr><td><div align="left">Hotkey Support<br>Add you own custom logos<br>Main OBS Themes supported<br>Custom Logo Slideshow (Sponsor Logos)<br><b><i>Docks cleanly into the OBS user interface</i></b></div></td><td><div align="right"><br>View the full Wiki <a href="https://github.com/iainsmacleod/CueSport-Scoreboard/wiki">Here</a>
<br><a href="https://github.com/iainsmacleod/CueSport-Scoreboard#installation" target="_blank">ScoreBoard Installation Instructions</a><br><a href="https://github.com/ngholson/g4ScoreBoard/wiki/Installation-(Scoreboard)" target="_blank">Hotkey Installation Instructions</a><br>See <a href="https://github.com/iainsmacleod/CueSport-Scoreboard/releases" target="_blank">Releases Page</a> for most recent official release</div></td></tr></table></div><br>

<a href="https://www.buymeacoffee.com/iainmacleod" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

```

CueSport ScoreBoard is a modified version of G4ScoreBoard. The purpose of this modification was to simplify and enhance the UI/UX for users.
I have removed the Salotto logo, as I myself have not asked for permission to use - but if you choose to use it, it can be uploaded as a custom logo.
This implementation now uses 5 custom logos, 2 associated with players, and 3 for a slideshow functionality.

CueSport ScoreBoard addon for OBS Copyright 2025 Iain MacLeod

Modified version of G$Scoreboard:-
G4ScoreBoard addon for OBS Copyright 2022-2023 Norman Gholson IV
https://g4billiards.com http://www.g4creations.com
```
-------------------------------------------------------------

## Extract zip file to the folder of your choice.<br>

```
Zip contents:
{Cuesport-Scoreboard-main.zip}
|
|-[common]
|   |-[js]
|   |   |-jquery.js
|   |   |-browser_source.js
|   |   |-control_panel.js
|   |   |-browser_source_post.js
|   |   |-control_panel_post.js
|   |
|   |-[css]
|   |	|-[control_panel]
|   |	|   |-yami.css
|   | 	|   |-acri.css
|   |	|   |-dark.css
|   |	|   |-grey.css
|   |	|   |-rachni.css
|   |	|   |-light.css
|   |   |   |-required.css
|   |	|
|   |	|-[browser_source]
|   |	    |-125.css
|   |	    |-150.css
|   |       |-200.css
|   |
|   |-[images]
|   |   |-8ball_original.png
|   |   |-8ball_small.png
|   |   |-8_ball_game.png <-example of other custom logo use
|   |   |-9_ball_game.png <-example of other custom logo use
|   |   |-template.psd
|	|	|-placeholder.png
|   |
|   |-[sound]
|       |-beep2.mp3
|       |-buzz.mp3
|
|-shot_clock_display.html   
|-g4ScoreBoard_hotkeys.lua
|-browser_source.html   
|-control_panel.html
|-hotkeys.js
|-README.md
|-LICENSE

```
--------------------------------------------------------------

## Installation:
```
Extract the downloaded file to the directory of your choosing, 
just make sure you know where to find it again. 

OBS V27.1 and lower Configuration:
	
1. click on the Docks Menu from the top menu bar.
2. Select "Custom Browser Docks".
3. type a name (Cuesport-Scoreboard) in the "Dock Name" box.
4. input the full path to "control_panel.html" in the URL box. 
   (example: "c:\users\yourname\desktop\Cuesport-Scoreboard\control_panel.html")
5. Click "Close"
6. Select the scene you want the scoreboard to display.
7. Add a "Browser Source" -> "Create New" -> give it a name. click OK.
8. Input the full path to "browser_source.html" in the URL box.
   (example: "c:\users\yourname\desktop\Cuesport-Scoreboard\browser_source.html")
9. Set Width to 1920 and Height to 1080. 
10. click OK.

OBS V27.2 and higher Configuration:
	
1. click on the Docks Menu from the top menu bar.
2. Select "Custom Browser Docks".
3. type a name (Cuesport-Scoreboard) in the "Dock Name" box.
4. input the full path file URI to "control_panel.html" in the URL box. 
   (example: "file:///c:/users/yourname/desktop/Cuesport-Scoreboard/control_panel.html")
5. Click "Close"
6. Select the scene you want the scoreboard to display.
7. Add a "Browser Source" -> "Create New" -> give it a name. click OK.
8. Input the full path file URI to "browser_source.html" in the URL box.
   (example: "file:///c:/users/yourname/desktop/Cuesport-Scoreboard/browser_source.html")
9. Set Width to 1920 and Height to 1080. 
10. click OK.

	
To install Hotkeys:
	
1. Click on "Tools" from the top menu in OBS.
2. Select "Scripts" from the menu.
3. Click the "+" in the lower left.
4. Navigate to and select the "g4ScoreBoard_hotkeys.lua" file that came with this download.
5. Click Open.  
6. Open the "Settings" in OBS and navigate to the "Hotkeys" section.
7. The scoreboard hotkeys all have the "G4" prefix for easy identification.
```
--------------------------------------------------------------

## Notes on use:  
```
1. The race info and wager info boxes will disappear if text box is left blank when updating match info.
   (behavior is by design. if you wish to have the panels display empty,
   type "&nbsp;" (without the quotes) in the text box.)
2. The shot clock will auto display in the stream starting at 10s remaining.
3. Once a player strokes the ball click Stop Clock and then start a new 30s timer for the next shot or
   the incoming player when the cue ball fully stops moving.
4. Audible alerts will sound starting at 5s remaining. 
   (these only play locally unless picked up by microphone).
5. Players get 1 30s extension per rack. if accidently clicked you can use the P1/P2 ext reset buttons. 
6. When a player score is recorded the shot clock will stop and the player extensions are reset. 
7. Clock will display in the control_panel in obs when Shot clock is started. 
```	
---------------------------------------------------------------


## Shot Clock
If you are not familiar with the use of a shot clock in pool.
```
A shot clock is used in most professional 9 ball tournaments. shot clock play is as follows:

	1. first shot after break is a 60s shot. 
	2. if player elects to "push" the incoming player gets 60s. 
	   if player chooses to give it back to the original shooter, 
	   then that shot it is a 30s shot. 
	3. all shots thereafter are 30s shots.
	4. shot clock starts when cue ball has stopped moving.
	   and stops when player contacts cue ball with stick. 
	5. each player/team gets 1 30s extension per rack. 
	   which must be called before time expires.
									
```	   

---------------------------------------------------------------

## Add your own Logo
```
Simply click on the "Upload Custom Logo" button and choose your image.
Max file size 2.4 MB 

```
<br><br>
<a id="user-content-matchroom-pool" class="anchor" aria-hidden="true" href="#matchroom-pool"></a><div align="center"><i>*Mosconi Cup and European Open are the Copyright and or Trademark of Matchroom Pool and is in no way affiliated with CueSport Scoreboard.</i><br>
