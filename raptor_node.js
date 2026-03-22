const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const chokidar = require("chokidar");
const fs = require("fs");
const path = require("path");

// ⚠️ IMPORTANT: Verify this is your EXACT Render URL. No slash at the end!
const CLOUD_URL = "https://vantage-vision.onrender.com";
const REPORTS_FOLDER = 'C:/COACH_OS/reports';

console.log("🦅 Booting Raptor Edge Node...");

// 1. Connect to the Cloud (Patient Handshake for Render)
const socket = io(CLOUD_URL, {
    transports: ['polling', 'websocket'], // Start with polling, then upgrade (Render prefers this)
    reconnection: true,                   // Don't give up if Render is asleep
    reconnectionAttempts: 20,             // Knock 20 times before quitting
    reconnectionDelay: 3000               // Wait 3 seconds between knocks
});

socket.on("connect", () => {
    console.log("🟢 Uplink secured to Vantage Vision Cloud!");
    socket.emit("registerRaptorNode");
});

socket.on("connect_error", (err) => {
    console.log(`⏳ Cloud is waking up or URL is wrong... (Error: ${err.message})`);
});

// 2. Listen for commands from the Cloud
socket.on("executeLocalScan", () => {
    console.log("⚡ Cloud requested a scan. Firing up Coach OS...");
    socket.emit("raptorLogUpload", "> Local Edge Node: Booting Windows PowerShell...");

    const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Unrestricted', '-File', 'C:\\COACH_OS\\run_coach_os.ps1']);

    ps.stdout.on('data', (data) => socket.emit("raptorLogUpload", data.toString()));
    ps.stderr.on('data', (data) => socket.emit("raptorLogUpload", `[ERROR] ${data.toString()}`));
});

// 3. Watch the local C:\ Drive and beam files UP to the Cloud
console.log(`👀 Radar locked on local folder: ${REPORTS_FOLDER}`);
chokidar.watch(REPORTS_FOLDER, { persistent: true, usePolling: true, interval: 1000 }).on('change', (filePath) => {
    if (filePath.endsWith('.json')) {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return;
            try {
                const jsonData = JSON.parse(data);
                console.log(`📡 Uploading ${path.basename(filePath)} to Cloud...`);
                socket.emit("raptorDataUpload", { file: path.basename(filePath), payload: jsonData });
            } catch (parseErr) {
                console.log(`⚠️ Error parsing JSON for ${path.basename(filePath)}`);
            }
        });
    }
});
