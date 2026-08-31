# NadaNada 🎵

A beautiful, distraction-free native YouTube music player built for desktop using **Tauri v2** and **React**.

![NadaNada Logo](nadanada-logo.png)

---

## ✨ Features

- **🎚️ Seamless Dual-Deck Crossfading:** Studio-grade DJ crossfade transitions between songs with customizable duration (1–5s) using equal-power volume curves for continuous, gapless music.
- **✨ Endless Play (Radio Mode):** Automatically queues up matching tracks based on the vibe of your current song using native YouTube Mix algorithms.
- **📊 Trending Charts & Spotify Playlist Import:** Explore global and regional Kworb top charts or import entire Spotify playlists with a single click.
- **🎨 Dynamic Glassmorphism & Theme Studio:** Adaptive blurred album art backdrops with customizable themes (Default Glass, Deep Dark, Cyberpunk, Sunset, Forest, and more).
- **🎸 Real-Time Guitar Chords & Lyrics:** Automatically fetches and syncs live guitar chords and multi-language captions/subtitles that follow along with the track.
- **💾 Offline Library & Downloads:** Download high-quality audio directly to your local library for instant offline listening via integrated `yt-dlp`.
- **🎧 System Media Integration (SMTC):** Native desktop media controls, lock screen metadata, and keyboard media keys support across Windows, macOS, and Linux.
- **🪟 Mini Player & System Tray Docking:** Unobtrusive compact floating player mode and tray minimization to keep music playing in the background without taskbar clutter.

---

## 📥 Download

Head over to the [Releases](https://github.com/rzkmsjhr/nadanada/releases) page to download the latest native installer for your platform:
- **Windows:** `.exe` / `.msi`
- **macOS:** `.dmg` (Universal / Apple Silicon & Intel)
- **Linux:** `.deb` / `.AppImage`

---

## 🛠️ Tech Stack

- **Frontend:** React 19 + Vite
- **Styling:** Vanilla CSS (Glassmorphism Design System)
- **Icons:** Lucide React
- **Backend:** Rust + Tauri v2
- **Audio & Video Engine:** Dual-Deck IFrame Bridge & Cloudflare Worker HTTPS Proxy
- **Scraping & Charts:** Native Rust `reqwest` & `regex` (Kworb Charts, YouTube Mix)
- **Downloads:** Integrated `yt-dlp`

---

## 🚀 Running Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://rustup.rs/) (Stable)
- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/rzkmsjhr/nadanada.git
   cd nadanada
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run in development mode:**
   ```bash
   npm run tauri dev
   ```

4. **Build production binaries:**
   ```bash
   npm run tauri build
   ```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

