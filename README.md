# CueSport Scoreboard

<div align="center">

**A professional scoreboard overlay for OBS Studio designed for cue sports**

Made for cue sport fans by a cue sport fan, based on the [g4scoreboard](https://github.com/ngholson/g4ScoreBoard/)

A clean and professional solution for displaying: player names, race and game information, scores, logos, and sponsors.

Includes a shot clock inspired by the clock used during the Mosconi Cup* and European Open*

*Must be viewed at 1920x1080 resolution*

</div>

---

## Table of Contents

- [Acknowledgement](#acknowledgement)
- [Overview](#overview)
- [Features](#features)
  - [Game Setup Tab](#game-setup-tab)
  - [Controls Tab](#controls-tab)
  - [Images Tab](#images-tab)
  - [Replay/Share Tab](#replayshare-tab)
  - [General Settings Tab](#general-settings-tab)
- [Feature Usage](#feature-usage)
  - [Replay Controls](#replay-controls)
  - [Stream Sharing & Promotion](#stream-sharing--promotion)
- [Installation](#installation)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
- [Hotkey Installation](#hotkey-installation)
- [Usage Notes](#usage-notes)
- [Shot Clock Information](#shot-clock-information)
- [Adding Custom Logos](#adding-custom-logos)

---

## Acknowledgement

**CueSport ScoreBoard** is a modified version of **G4ScoreBoard** by Norman Gholson IV.

**CueSport ScoreBoard addon for OBS** Copyright 2025 Iain MacLeod

**Modified version of G4ScoreBoard:**
- G4ScoreBoard addon for OBS Copyright 2022-2023 Norman Gholson IV
- https://g4billiards.com | http://www.g4creations.com

The purpose of this modification was to simplify and enhance the UI/UX for users. The Salotto logo has been removed from the default implementation, but can be uploaded as a custom logo if desired. This implementation now uses 5 custom logo slots: 2 associated with players, and 3 for slideshow functionality.

---

## Overview

CueSport Scoreboard is a comprehensive OBS Studio overlay system designed specifically for cue sports streaming. It provides real-time score tracking, player information, shot clock functionality, instant replay capabilities, and stream sharing features. The overlay integrates seamlessly into OBS Studio as a custom browser dock and browser source, providing a professional broadcast experience.

**Key Capabilities:**
- Real-time score tracking and player management
- Shot clock with extension support
- Ball tracking for various game types
- Instant replay system with clip management
- Stream promotion and sharing via WebSocket
- Custom logo support (player logos and sponsor slideshow)
- Multiple game type support (8-Ball, 9-Ball, 10-Ball, Straight, Bank, One Pocket, Custom)
- Hotkey support for quick control
- Multiple OBS theme support

---

## Features

### Game Setup Tab

The **Game Setup** tab is where you configure the basic match information and player details.

**Game Details:**
- **Race Info**: Enter the race-to number (e.g., "Race to 7")
- **Game/Other Info**: Additional match information or wager details
- **Update Info**: Button to apply game details to the overlay

**Player/Team Details:**
- **Player/Team 1 & 2 Names**: Enter player or team names (max 20 characters)
- **Player/Team 1 & 2 Colors**: Select colors for each player/team from a dropdown menu
- **Update Names**: Button to apply player names and colors
- **Swap Colors**: Quickly swap player colors
- **Clear Game**: Reset all game information

### Controls Tab

The **Controls** tab provides all the interactive controls for managing scores, players, and game flow.

**Score Controls:**
- Increment/decrement buttons for Player 1 and Player 2 scores
- Direct score input fields (0-999)
- **Reset Scores**: Reset both players' scores to zero
- **Push Scores**: Manually update scores after direct input

**Player and Ball Controls:**
- **Breaking Player Toggle**: Switch between Player 1 and Player 2 as the breaking player
- **Player 1 Chosen Ball**: Radio buttons for Red/Lows/Solids, Yellow/Highs/Stripes, or Open Table
- **Ball Tracker**: Visual ball tracking system (enabled in General Settings)

**Replay Controls:**
- **Monitor Game**: Start/stop monitoring the game for replay capability
- **Instant Replay**: Save and replay the last X seconds (X = OBS Maximum Replay Time)
- **Clip Buttons (1-5)**: Access up to 5 previously saved replay clips
- **Delete Clip**: Remove saved clip paths (note: does not delete the actual video file)

**Clock Controls:**
- **30s Shot Clock**: Start a 30-second shot clock
- **60s Shot Clock**: Start a 60-second shot clock
- **Stop Clock**: Stop the current shot clock
- **Show Clock**: Manually display the shot clock on stream
- **Extension Controls**: 
  - P1's Extension / P2's Extension: Add 30 seconds to the current player's shot clock
  - Reset Extensions: Reset both players' extension usage

### Images Tab

The **Images** tab manages all logo and image uploads for the overlay.

**Slideshow Images:**
- **Custom/Sponsor Slideshow**: Toggle checkbox to enable/disable slideshow
- **L1, L2, L3**: Upload buttons for three slideshow images
- Images will cycle automatically when slideshow is enabled

**Player Images:**
- **Player 1 Logo**: Upload and toggle custom logo for Player 1
- **Player 2 Logo**: Upload and toggle custom logo for Player 2
- Click on logo labels to rename them
- Logos should be square for best display

**Logo Settings:**
- Maximum upload size: 2.4MB
- Supported formats: PNG, JPEG, SVG, BMP
- Player/Team logos should be square format

### Replay/Share Tab

The **Replay/Share** tab configures instant replay functionality and stream sharing features.

**Enable Sharing and Replay Settings:**
- **WebSocket Toggle**: Enable/disable OBS WebSocket connection
- **Settings Button (⚙)**: Configure WebSocket address and password
  - Default address: `ws://127.0.0.1:4455`
  - Password: Enter your OBS WebSocket password (if configured)

**Stream Promotion:**
- **Stream Promotion Toggle**: Enable/disable sharing your game data to [https://cuesports.macleod.systems](https://cuesports.macleod.systems)
- **Settings Button (⚙)**: Configure your stream URL
  - Enter your streaming platform URL (e.g., `https://www.twitch.tv/yourchannel`)
- **Note**: Stream promotion requires OBS to be actively streaming

**Replay Source Settings:**
- **Media Source Name** (Required): Name of the Media Source in OBS that will display replays
- **Indicator Source Name** (Optional): Name of an indicator source to show when replay is active
- **Auto-resume Monitoring**: Automatically resume replay monitoring after playing a clip
- **Update Sources**: Save source configuration

### General Settings Tab

The **General Settings** tab contains all customization and configuration options.

**UI Settings:**
- **OBS Theme**: Select from Default, Classic, Acri, Grey, Light, or Rachni themes
- **Overlay Scaling**: Adjust overlay size (40-100%)
- **Game Type**: Select game type (8-Ball, 9-Ball, 10-Ball, Straight, Bank, One Pocket, Custom)
- **Overlay Opacity**: Adjust transparency (0-100%)

**Feature Settings:**
- **Player 1**: Toggle Player 1 display on/off
- **Player 2**: Toggle Player 2 display on/off
- **Show Scores**: Toggle score display
- **Shot Clock**: Enable/disable shot clock feature
- **Breaker Indicator**: Enable/disable breaking player indicator
- **Win Animation**: Enable/disable win animation

**Ball Settings:**
- **Ball Tracker**: Enable/disable ball tracking visualization
- **Vertical Ball Tracker**: Toggle horizontal/vertical ball tracker orientation
- **Ball Set Toggle**: Enable/disable ball set selection (Red/Yellow, Solids/Stripes, etc.)
- **Ball Type**: Select ball style
  - World (Small/Big, Lows/Highs, Solids/Stripes)
  - International (Red/Yellow)
  - Unity Balls

**Version Check:**
- **Check for Update**: Verify if a newer version is available

**Local Data Settings:**
- **Clear Instance Data**: Clear data for current OBS instance
- **Clear All Data**: Clear all stored data (use with caution)

---

## Feature Usage

### Replay Controls

The instant replay system allows you to capture and replay key moments during your stream.

**Prerequisites:**
1. OBS Replay Buffer must be enabled and configured:
   - Go to **Edit → Settings → Video**
   - Configure **Maximum Replay Time** (recommended: 30-60 seconds)
   - Start Replay Buffer when streaming

2. WebSocket must be configured:
   - Go to **Tools → WebSocket Server Settings** in OBS
   - Enable WebSocket server
   - Note the port (default: 4455) and set a password if desired
   - Configure in **Replay/Share** tab → WebSocket Settings

3. Replay sources must be configured:
   - Create a **Media Source** in OBS for replay playback
   - Optionally create an indicator source (text/image) to show when replay is active
   - Enter source names in **Replay/Share** tab → Replay Source Settings

**Using Instant Replay:**
1. Click **Monitor Game** to start monitoring (button turns green)
2. During gameplay, click **Instant Replay** to:
   - Save the last X seconds (where X = Maximum Replay Time)
   - Automatically load and play the saved clip
   - Stop monitoring (button returns to normal state)
3. The saved clip is added to your clip history (up to 5 clips)
4. Click **Clip 1-5** buttons to replay any previously saved clip
5. Click the **×** button on a clip to remove it from history

**Important Notes:**
- Replay monitoring must be active before saving a new clip
- The replay buffer must be running in OBS
- Delete clip only removes the saved path; video files are not automatically deleted
- Remember to periodically clean up replay video files from your OBS replay buffer directory

### Stream Sharing & Promotion

The stream sharing feature allows you to share your game data to a public directory at [https://cuesports.macleod.systems](https://cuesports.macleod.systems), making it easy for viewers to find and watch your stream.

**Setup:**
1. Enable **Stream Promotion** toggle in the **Replay/Share** tab
2. Click the settings button (⚙) to configure:
   - Enter your stream URL (e.g., `https://www.twitch.tv/yourchannel`)
   - Save settings
3. Ensure OBS is actively streaming
4. The system will automatically:
   - Generate a unique API key (stored locally)
   - Connect to the sharing server
   - Send real-time game state updates (player names, scores, game type, etc.)
   - Display your stream in the public directory

**How It Works:**
- Game data is sent via WebSocket to the sharing server
- Your stream appears in the public directory with current match information
- Viewers can see live scores and match details
- Data updates automatically as you change scores or game information
- Connection requires OBS to be actively streaming

**Privacy & Control:**
- Each installation generates a unique API key
- You can disable sharing at any time via the toggle
- API keys can be blocked by administrators if needed
- Only game state data is shared (no video/audio)

---

## Installation

### Windows

1. **Extract the downloaded ZIP file** to a directory of your choice (remember the location)

2. **OBS V27.1 and lower:**
   - Click **Docks** from the top menu bar
   - Select **Custom Browser Docks**
   - Type a name (e.g., "CueSport-Scoreboard") in the "Dock Name" box
   - Input the full path to `control_panel.html` in the URL box
     - Example: `C:\Users\YourName\Desktop\CueSport-Scoreboard\control_panel.html`
   - Click **Close**
   - Select the scene where you want the scoreboard to display
   - Add a **Browser Source** → **Create New** → give it a name → click **OK**
   - Input the full path to `browser_source.html` in the URL box
     - Example: `C:\Users\YourName\Desktop\CueSport-Scoreboard\browser_source.html`
   - Set Width to **1920** and Height to **1080**
   - Click **OK**

3. **OBS V27.2 and higher:**
   - Click **Docks** from the top menu bar
   - Select **Custom Browser Docks**
   - Type a name (e.g., "CueSport-Scoreboard") in the "Dock Name" box
   - Input the full path file URI to `control_panel.html` in the URL box
     - Example: `file:///C:/Users/YourName/Desktop/CueSport-Scoreboard/control_panel.html`
   - Click **Close**
   - Select the scene where you want the scoreboard to display
   - Add a **Browser Source** → **Create New** → give it a name → click **OK**
   - Input the full path file URI to `browser_source.html` in the URL box
     - Example: `file:///C:/Users/YourName/Desktop/CueSport-Scoreboard/browser_source.html`
   - Set Width to **1920** and Height to **1080**
   - Click **OK**

### macOS

**Important Note for Mac Users:** OBS may automatically add `https://` to local file paths. To resolve this, you need to serve the directory with a local web server.

1. **Extract the downloaded ZIP file** to a directory of your choice

2. **Start a local web server:**
   - Open **Terminal**
   - Navigate to the directory where you extracted the files:
     ```bash
     cd /path/to/CueSport-Scoreboard
     ```
   - Start a local HTTP server:
     ```bash
     python3 -m http.server 8000
     ```
   - Keep Terminal open while using OBS (the server must be running)

3. **Configure OBS:**
   - Click **Docks** from the top menu bar
   - Select **Custom Browser Docks**
   - Type a name (e.g., "CueSport-Scoreboard") in the "Dock Name" box
   - Input the URL:
     ```
     http://localhost:8000/control_panel.html
     ```
   - Click **Close**
   - Select the scene where you want the scoreboard to display
   - Add a **Browser Source** → **Create New** → give it a name → click **OK**
   - Input the URL:
     ```
     http://localhost:8000/browser_source.html
     ```
   - Set Width to **1920** and Height to **1080**
   - Click **OK**

**Alternative:** If you prefer not to use a local server, you can use the `file://` protocol, but you may need to adjust OBS settings if it adds `https://` automatically.

### Linux

1. **Extract the downloaded ZIP file** to a directory of your choice

2. **Option A - Using file:// protocol (OBS V27.2+):**
   - Click **Docks** from the top menu bar
   - Select **Custom Browser Docks**
   - Type a name (e.g., "CueSport-Scoreboard") in the "Dock Name" box
   - Input the full path file URI to `control_panel.html` in the URL box
     - Example: `file:///home/username/Desktop/CueSport-Scoreboard/control_panel.html`
   - Click **Close**
   - Select the scene where you want the scoreboard to display
   - Add a **Browser Source** → **Create New** → give it a name → click **OK**
   - Input the full path file URI to `browser_source.html` in the URL box
     - Example: `file:///home/username/Desktop/CueSport-Scoreboard/browser_source.html`
   - Set Width to **1920** and Height to **1080**
   - Click **OK**

3. **Option B - Using local web server (if file:// doesn't work):**
   - Open a terminal
   - Navigate to the directory:
     ```bash
     cd /path/to/CueSport-Scoreboard
     ```
   - Start a local HTTP server:
     ```bash
     python3 -m http.server 8000
     ```
   - Use `http://localhost:8000/control_panel.html` and `http://localhost:8000/browser_source.html` in OBS
   - Keep the terminal open while using OBS

---

## Hotkey Installation

To enable hotkey support for quick scoreboard control:

1. Click **Tools** from the top menu in OBS
2. Select **Scripts** from the menu
3. Click the **+** button in the lower left
4. Navigate to and select the `g4ScoreBoard_hotkeys.lua` file from the extracted folder
5. Click **Open**
6. Open **Settings** in OBS and navigate to the **Hotkeys** section
7. All scoreboard hotkeys have the **"G4"** prefix for easy identification

**Available Hotkeys:**
- Player 1 Score Up/Down
- Player 2 Score Up/Down
- Reset Scores
- Player 1/2 Extensions
- 30s/60s Shot Clock
- Stop Clock
- Swap Colors
- Player Toggle

---

## Usage Notes

1. **Race Info and Game Info**: These boxes will disappear if left blank when updating match info. 

2. **Shot Clock Display**: The shot clock automatically displays on stream starting at 10 seconds remaining.

3. **Shot Clock Usage**: 
   - Once a player strokes the ball, click **Stop Clock**
   - Start a new 30s timer for the next shot or incoming player when the cue ball fully stops moving

4. **Audible Alerts**: Shot clock alerts sound starting at 5 seconds remaining (these only play locally unless picked up by microphone).

5. **Extensions**: Players get 1 thirty-second extension per rack. If accidentally clicked, use the **P1/P2 Ext Reset** buttons.

6. **Score Recording**: When a player score is recorded, the shot clock stops and player extensions are reset.

7. **Control Panel Display**: The clock will display in the control panel in OBS when the shot clock is started.

---

## Shot Clock Information

If you are not familiar with the use of a shot clock in pool:

A shot clock is used in most professional 9-ball tournaments. Shot clock play follows these rules:

1. **First shot after break** is a 60-second shot
2. **Push option**: If a player elects to "push," the incoming player gets 60 seconds. If the player chooses to give it back to the original shooter, then that shot is a 30-second shot
3. **All subsequent shots** are 30-second shots
4. **Shot clock starts** when the cue ball has stopped moving
5. **Shot clock stops** when the player contacts the cue ball with the stick
6. **Extensions**: Each player/team gets 1 thirty-second extension per rack, which must be called before time expires

---

## Adding Custom Logos

To add your own custom logos:

1. Navigate to the **Images** tab in the control panel
2. Click **Upload Player 1 Logo** or **Upload Player 2 Logo** for player logos
3. Click **L1**, **L2**, or **L3** buttons for slideshow logos
4. Select your image file
5. **Maximum file size**: 2.4 MB
6. **Supported formats**: PNG, JPEG, SVG, BMP
7. **Recommended**: Square format for player logos (best display results)

Player logos can be toggled on/off using the checkbox next to each logo. Slideshow logos will cycle automatically when the slideshow is enabled.

---

## Support

- **Wiki**: [GitHub Wiki](https://github.com/iainsmacleod/CueSport-Scoreboard/wiki)
- **Releases**: [Releases Page](https://github.com/iainsmacleod/CueSport-Scoreboard/releases)
- **Support the Developer**: [Ko-fi](https://ko-fi.com/iainsmacleod)

---

<div align="center">

*Mosconi Cup and European Open are the Copyright and/or Trademark of Matchroom Pool and are in no way affiliated with CueSport Scoreboard.*

</div>
