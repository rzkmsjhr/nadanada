# NadaNada 🎵

A beautiful, distraction-free YouTube music player built natively for your desktop using Tauri v2 and React. 

![NadaNada Logo](nadanada-logo.png)

## ✨ Features

- **Endless Play (Radio Mode):** Hit the infinity icon and NadaNada will automatically queue up the perfect songs that match the vibe of your current track, directly utilizing native YouTube Mix algorithms.
- **Premium Glassmorphism UI:** A sleek, semi-transparent design with dynamic blurred background album art that adapts to whatever you're listening to.
- **Native Audio Visualizer:** Real-time audio spectrum visualization that physically listens to your system's output and reacts instantly to the music.
- **Library Management:** Easily create, name, and save your custom queues directly to your local library. Everything is saved instantly to local storage.
- **System Tray Docking:** Minimize the app straight to your system tray to keep the music playing invisibly in the background without cluttering your taskbar.
- **Cross-Platform:** Available for Windows, macOS, and Linux.

## 📥 Download

Head over to the [Releases](../../releases) page to download the latest native installer for your operating system (Windows `.exe`/`.msi`, macOS `.dmg`, or Linux `.deb`/`.AppImage`).

## 🛠️ Tech Stack

- **Frontend:** React + Vite
- **Styling:** Vanilla CSS (Custom Glassmorphism Design System)
- **Icons:** Lucide React
- **Backend:** Rust + Tauri v2
- **Audio Capture:** `cpal` (Rust native loopback capture)
- **Scraping:** `reqwest` & `regex` (Native Rust YouTube scraping)

## 🚀 Running Locally

If you'd like to build the project from source or run it in development mode:

### Prerequisites
- Node.js (v20+)
- Rust (Stable)
- Tauri v2 prerequisites installed for your OS.

### Getting Started
1. Clone the repository:
   ```bash
   git clone https://github.com/rzkmsjhr/nadanada.git
   cd nadanada
   ```
2. Install frontend dependencies:
   ```bash
   npm install
   ```
3. Run the development server (this will automatically compile the Rust backend):
   ```bash
   npm run tauri dev
   ```
4. Build the production application:
   ```bash
   npm run tauri build
   ```

## ⚠️ Notes for macOS Users
Because of strict Apple privacy protections, macOS does not allow applications to capture system audio output natively. While the music player, endless radio, and UI will work flawlessly on macOS, the **Audio Visualizer** requires a virtual loopback driver (like [BlackHole](https://existential.audio/blackhole/)) to function on Mac devices.

## 📄 License
MIT
