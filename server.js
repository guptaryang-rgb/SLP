require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");

// Third Party SDKs
const { ClerkExpressWithAuth } = require("@clerk/clerk-sdk-node");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const cloudinary = require("cloudinary").v2;

// Initialize App
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware Configuration
app.use(cors());
// Increased limit for high-res game film
app.use(express.json({ limit: "500mb" })); 
app.use(ClerkExpressWithAuth());
app.use(express.static(__dirname));

// Upload Directory Setup
const UPLOAD_DIR = path.join(__dirname, 'temp_uploads');
fs.mkdir(UPLOAD_DIR, { recursive: true }).catch(console.error);

// Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Vantage Vision Database Connected"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// Cloudinary Configuration (Video Storage)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Gemini AI Configuration
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// *** AI MODEL STRATEGY ***
// We prioritize 2.5 Pro for depth, fall back to 1.5 Pro for stability
const MODEL_FALLBACK_LIST = [
    "gemini-3-pro-preview",
    "gemini-2.5-pro", 
    "gemini-1.5-pro",
    "gemini-1.5-flash"
];

// Helper: AI Execution Wrapper
async function generateWithFallback(promptParts) {
    let lastError = null;
    for (const modelName of MODEL_FALLBACK_LIST) {
        try {
            console.log(`🤖 Analyzing with ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { 
                    temperature: 0.2, // Low temperature for factual analysis
                    topP: 0.95, 
                    topK: 40, 
                    responseMimeType: "application/json" 
                }
            });
            const result = await model.generateContent({ contents: [{ role: "user", parts: promptParts }] });
            console.log(`✅ Success using ${modelName}`);
            return result; 
        } catch (error) {
            console.warn(`⚠️ ${modelName} failed. Attempting next model...`);
            lastError = error;
        }
    }
    throw new Error(`All AI models failed. Last error: ${lastError?.message}`);
}

/* ---------------- ELITE COACHING RUBRICS ---------------- */
/* These instructions guide the AI to act like a specific position coach */
const RUBRICS = {
    "team": `
    ROLE: NFL Offensive/Defensive Coordinator.
    GOAL: High-level schematic breakdown.
    1. SITUATION: Analyze Down & Distance, Field Position, and Personnel.
    2. PRE-SNAP: Identify Formational Tells, Motion leverage, and Defensive Shell (MOFO/MOFC).
    3. SCHEME: Name the specific concept (e.g., Duo, Dagger, Mesh, Cover 3 Match).
    4. POST-SNAP: Identify the 'Conflict Player' the offense is attacking.
    5. EFFICIENCY: Grade the play's success based on EPA principles.`,
    
    "qb": `
    ROLE: Elite Quarterback Coach.
    FOCUS: Biomechanics & Processing.
    1. BASE: Feet width at setup vs release.
    2. SEQUENCING: Hip rotation timing relative to arm slot.
    3. RELEASE: Release time (target <0.4s) and launch angle.
    4. EYES: Manipulation of safeties vs staring down targets.`,

    "rb": `
    ROLE: Run Game Coordinator.
    FOCUS: Vision & Pad Level.
    1. STEPS: False steps vs direct attack.
    2. VISION: Pressing the hole to manipulate LBs.
    3. PADS: Pad level at contact (Hammer vs Nail).
    4. PRO: Scanning technique in pass protection.`,

    "wr": `
    ROLE: Wide Receiver Coach.
    FOCUS: Route Tech & Releases.
    1. RELEASE: Footfire/Split release effectiveness against press.
    2. STEM: Stacking the DB and maintaining leverage.
    3. BREAK: Hip sink efficiency and step count at the break point.
    4. CATCH: Late hands technique and body positioning.`,

    "ol": `
    ROLE: Offensive Line Coach.
    FOCUS: Trench Mechanics.
    1. STANCE: Weight distribution (tipping run/pass?).
    2. FIRST STEP: Explosiveness and directionality.
    3. HANDS: Punch timing and placement (inside chest plate).
    4. ANCHOR: Ability to sit and re-set against power.`,

    "dl": `
    ROLE: Defensive Line Coach.
    FOCUS: Get-off & Hand Combat.
    1. GET-OFF: Reaction to ball movement.
    2. HANDS: Swipe/Rip/Swim move efficacy.
    3. PAD LEVEL: Low man wins leverage analysis.
    4. GAP: Maintaining gap integrity vs peeking backfield.`,

    "lb": `
    ROLE: Linebacker Coach.
    FOCUS: Read & React.
    1. READS: Recognition of Guard pulls or flow.
    2. FLOW: Scrape technique over trash.
    3. SHEDDING: Shock and shed mechanics vs blockers.
    4. DROPS: Depth and eye discipline in zone coverage.`,

    "db": `
    ROLE: Secondary Coach.
    FOCUS: Phase & Eyes.
    1. PEDAL: Smoothness of backpedal/shuffle.
    2. HIPS: Fluidity in the transition (opening the gate).
    3. EYES: Reading WR hips vs QB eyes (discipline).
    4. FINISH: Playing through the hands at the catch point.`,

    "general": `
    ROLE: Head Coach.
    FOCUS: Effort & IQ.
    Analyze motor, situational awareness, and overall execution speed.`
};

/* ---------------- DATABASE SCHEMAS ---------------- */

const PlayerProfileSchema = new mongoose.Schema({
    identifier: String, 
    position: String, 
    grade: String, 
    notes: [String], 
    weaknesses: [String], 
    last_updated: { type: Date, default: Date.now }
});

const Session = mongoose.model("Session", new mongoose.Schema({
  sessionId: String, 
  owner: String, 
  title: String, 
  type: { type: String, default: "team" }, // "team" or "self"
  sport: String,
  history: [{ role: String, text: String }],
  roster: [PlayerProfileSchema],
  createdAt: { type: Date, default: Date.now }
}));

const Clip = mongoose.model("Clip", new mongoose.Schema({
  owner: String, 
  sessionId: String, 
  sport: String, 
  title: String, 
  formation: String,
  o_formation: String, 
  d_formation: String, 
  section: { type: String, default: "Inbox" }, // For Folder Organization
  videoUrl: String, 
  publicId: String, 
  geminiFileUri: String, 
  fullData: Object, // Stores the raw JSON analysis
  chatHistory: [{ role: String, text: String }], 
  snapshots: [String],
  createdAt: { type: Date, default: Date.now }
}));

// Middleware: Authentication Checker
const requireAuth = (req, res, next) => {
  if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized access." });
  }
  next();
};

/* ---------------- API ROUTES ---------------- */

// Static Files
app.get("/", (_, res) => { res.sendFile(path.join(__dirname, "index.html")); });
app.get("/privacy.html", (_, res) => { res.sendFile(path.join(__dirname, "privacy.html")); });
app.get("/terms.html", (_, res) => { res.sendFile(path.join(__dirname, "terms.html")); });

// 1. Create New Session
app.post("/api/create-session", requireAuth, async (req, res) => {
  try {
    const session = await Session.create({
      sessionId: "sess_" + Date.now(), 
      owner: req.auth.userId, 
      title: req.body.title || "New Session",
      type: req.body.type || "self", // Default to self if not specified
      sport: "football", 
      history: [], 
      roster: []
    });
    res.json(session);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Get All Sessions (Filtered by Type)
app.get("/api/sessions", requireAuth, async (req, res) => {
  try {
    const query = { owner: req.auth.userId };
    
    // Strict Filtering: If type is provided, only return that type
    if (req.query.type) {
        query.type = req.query.type; 
    }
    
    const sessions = await Session.find(query).sort({ createdAt: -1 });
    res.json(sessions.map(s => ({ 
        id: s.sessionId, 
        title: s.title, 
        type: s.type,
        date: s.createdAt
    })));
  } catch (e) { res.json([]); }
});

// 3. Get Single Session Data
app.get("/api/session/:id", requireAuth, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.id, owner: req.auth.userId });
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ 
        history: session.history || [], 
        roster: session.roster || [],
        type: session.type 
    });
  } catch (e) { res.json({ history: [], roster: [] }); }
});

// 4. Delete Session
app.post("/api/delete-session", requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    await Session.deleteOne({ sessionId, owner: req.auth.userId });
    
    // Clean up associated clips and Cloudinary videos
    const clips = await Clip.find({ sessionId, owner: req.auth.userId });
    for(const clip of clips) {
        if(clip.publicId) {
            await cloudinary.uploader.destroy(clip.publicId, { resource_type: "video" });
        }
    }
    await Clip.deleteMany({ sessionId, owner: req.auth.userId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// 5. Search/Get Clips for a Session
app.get("/api/search", requireAuth, async (req, res) => {
  try {
    if (!req.query.sessionId) return res.json([]);
    const query = { owner: req.auth.userId, sessionId: req.query.sessionId };
    // Sort by Section (Folder) then Date
    const clips = await Clip.find(query).sort({ section: 1, createdAt: -1 });
    res.json(clips);
  } catch (e) { res.json([]); }
});

// 6. Update Clip (Move Folder / Organize)
app.post("/api/update-clip", requireAuth, async (req, res) => {
  try {
    const { id, section } = req.body;
    await Clip.findOneAndUpdate(
        { _id: id, owner: req.auth.userId }, 
        { $set: { section: section } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Update failed" }); }
});

// 7. Manual Data Override (Edit Button)
app.post("/api/update-clip-data", requireAuth, async (req, res) => {
    try {
        const { clipId, title, summary, o_formation, d_formation } = req.body;
        const clip = await Clip.findOne({ _id: clipId, owner: req.auth.userId });
        
        if (!clip) return res.status(404).json({ error: "Clip not found" });

        // Update Top Level
        clip.title = title;
        clip.o_formation = o_formation;
        clip.d_formation = d_formation;
        clip.formation = `${o_formation} vs ${d_formation}`;

        // Update Nested JSON
        if (clip.fullData) {
            clip.fullData.title = title;
            if (clip.fullData.data) {
                clip.fullData.data.o_formation = o_formation;
                clip.fullData.data.d_formation = d_formation;
            }
            if (clip.fullData.scouting_report) {
                clip.fullData.scouting_report.summary = summary;
            }
        }
        
        await clip.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Data Update failed" }); }
});

// 8. Delete Single Clip
app.post("/api/delete-clip", requireAuth, async (req, res) => {
  try {
    const clip = await Clip.findOne({ _id: req.body.id, owner: req.auth.userId });
    if(clip && clip.publicId) {
        await cloudinary.uploader.destroy(clip.publicId, { resource_type: "video" });
    }
    await Clip.findOneAndDelete({ _id: req.body.id, owner: req.auth.userId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// 9. Save Screenshot
app.post("/api/save-snapshot", requireAuth, async (req, res) => {
  try {
    await Clip.updateOne(
        { _id: req.body.clipId, owner: req.auth.userId }, 
        { $push: { snapshots: req.body.imageData } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Save failed" }); }
});

// 10. Chat Context for Clips
app.post("/api/clip-chat", requireAuth, async (req, res) => {
  try {
    const clip = await Clip.findOne({ _id: req.body.clipId, owner: req.auth.userId });
    if (!clip || !clip.fullData) return res.json({ reply: "Analysis needed first." });

    const session = await Session.findOne({ sessionId: clip.sessionId, owner: req.auth.userId });
    const rosterContext = session ? JSON.stringify(session.roster) : "[]";
    const chatHistory = clip.chatHistory || [];
    
    // Format history for context
    const historyText = chatHistory.map(h => `${h.role.toUpperCase()}: ${h.text}`).join("\n");

    const prompt = `
    ROLE: Elite Football Coordinator.
    CONTEXT: User is asking about a specific clip. You have full game context (Roster).
    
    CLIP DATA: ${JSON.stringify(clip.fullData)}
    ROSTER/TENDENCIES: ${rosterContext}
    HISTORY: ${historyText}
    
    USER QUESTION: "${req.body.message}"
    
    INSTRUCTION: Answer specifically based on the clip data. Use **bold** for key stats or players. Keep it professional and concise.
    `;
    
    const result = await generateWithFallback([{ text: prompt }]);
    const reply = result.response.text();

    await Clip.updateOne(
        { _id: req.body.clipId }, 
        { $push: { chatHistory: { $each: [{ role: 'user', text: req.body.message }, { role: 'model', text: reply }] } } }
    );

    res.json({ reply });
  } catch (e) { res.status(500).json({ error: "Chat failed" }); }
});

/* ---- MAIN ANALYSIS ENGINE ---- */
app.post("/api/chat", requireAuth, async (req, res) => {
  const { message, sessionId, fileData, mimeType, sport, position } = req.body;
  let tempPath = null;

  try {
    // A. Text Only Chat (General Session Chat)
    if (!fileData) {
        await Session.updateOne({ sessionId }, { $push: { history: { role: 'user', text: message } } });
        const result = await generateWithFallback([{ text: `ROLE: NFL Coach. USER: ${message}` }]);
        const reply = result.response.text();
        await Session.updateOne({ sessionId }, { $push: { history: { role: 'model', text: reply } } });
        return res.json({ reply });
    }

    // B. Video Analysis Request
    const buffer = Buffer.from(fileData, "base64");
    tempPath = path.join(UPLOAD_DIR, `upload_${Date.now()}.mp4`);
    await fs.writeFile(tempPath, buffer);

    // Upload to Cloudinary (for persistence) and Gemini (for analysis)
    const [cloud, uploaded] = await Promise.all([
        cloudinary.uploader.upload(tempPath, { resource_type: "video", folder: "vantage_vision" }),
        fileManager.uploadFile(tempPath, { mimeType, displayName: "Video" })
    ]);

    // Create "Processing" Clip entry
    let savedClip = await Clip.create({
      owner: req.auth.userId, 
      sessionId, 
      sport, 
      videoUrl: cloud.secure_url, 
      publicId: cloud.public_id,
      title: "Analyzing...", 
      formation: "...", 
      section: "Inbox", 
      chatHistory: [], 
      snapshots: []
    });

    // Wait for Gemini to process video
    let file = await fileManager.getFile(uploaded.file.name);
    while (file.state === FileState.PROCESSING) {
        await new Promise(r => setTimeout(r, 2000));
        file = await fileManager.getFile(uploaded.file.name);
    }
    if (file.state === FileState.FAILED) throw new Error("Video processing failed at Google.");

    // Prepare Context
    const session = await Session.findOne({ sessionId, owner: req.auth.userId });
    const rosterContext = session.roster.map(p => `${p.identifier}: ${p.weaknesses.join(', ')}`).join('\n');
    const specificFocus = RUBRICS[position] || RUBRICS["team"];

   // --- [HYBRID PROMPT: STRICT DATA + ELITE COACHING] ---
    let systemInstruction = `
    ROLE: ${position === 'team' ? "NFL Coordinator" : "Elite Position Coach"}.
    CONTEXT: ${specificFocus}
    ROSTER: ${rosterContext}

    YOUR DUAL OBJECTIVE:
    1. THE ANALYST (Data): Extract precise coordinates for the "Field Vision" charts.
       - CLASSIFY: Play must be "Pass" (Air Attack) or "Run" (Ground Attack).
       - PASS VECTORS: Origin (Pocket/Rollout) -> Target (Deep/Short, Hash/Numbers).
       - RUN VECTORS: Origin (Mesh) -> Gap (A/B/C/D).
    
    2. THE COACH (Insight): The 'scouting_report' must be detailed and specific.
       - Do NOT just describe the play. DIAGNOSE it.
       - Explain WHY it worked/failed based on the "CONTEXT" provided above.
       - Use professional terminology (e.g., "Hi-Lo Read," "Conflict Player," "Leverage").

    OUTPUT JSON FORMAT (Strict JSON):
    { 
        "title": "Descriptive Title (e.g. '3rd & Long - Dagger vs Cover 2')", 
        "data": { 
            "o_formation": "Formation", 
            "d_formation": "Coverage Shell", 
            "situation": { "down": "1/2/3/4", "distance": "Short/Med/Long", "zone": "Red/Open" }
        }, 
        "tactical_breakdown": {
            "concept": "Scheme Name",
            "play_type": "Pass/Run",
            "yards_gained": 0,
            "pass_chart": {
                "start": "Pocket/Rollout Left/Rollout Right",
                "end": "Left Numbers/Left Hash/Middle/Right Hash/Right Numbers",
                "depth": 0, 
                "result": "Complete/Incomplete/Int"
            },
            "run_chart": {
                "gap": "A/B/C/D/Sweep",
                "direction": "Left/Right/Middle"
            }
        },
        "scouting_report": { 
            "summary": "Detailed schematic analysis applying the coaching context.", 
            "coaching_prescription": { "fix": "Technical Fix", "drill": "Specific Drill" },
            "report_card": { "overall": "Grade" }
        }
    }`;

    const prompt = [ { fileData: { mimeType, fileUri: file.uri } }, { text: systemInstruction } ];
    const result = await generateWithFallback(prompt);
    
    // Parse JSON safely
    let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    let json;
    try {
        json = JSON.parse(text);
        if (!json.data) json.data = { o_formation: "Unknown", d_formation: "Unknown" };
    } catch (e) {
        console.error("AI JSON Parse Error:", text);
        // Fallback JSON to prevent crash
        json = {
            title: "Analysis Completed",
            data: { o_formation: "N/A", d_formation: "N/A" },
            scouting_report: { summary: "Video processed, but structural data parsing failed. Review video manually." }
        };
    }

    // Update Roster if players detected
    if (json.players_detected && json.players_detected.length > 0) {
        for (const p of json.players_detected) {
            const idx = session.roster.findIndex(r => r.identifier === p.identifier);
            if (idx > -1) {
                session.roster[idx].grade = p.grade;
                session.roster[idx].notes.push(p.observation);
                if(p.weakness) session.roster[idx].weaknesses.push(p.weakness);
                session.roster[idx].last_updated = new Date();
            } else {
                session.roster.push({
                    identifier: p.identifier, position: p.position, grade: p.grade,
                    notes: [p.observation], weaknesses: p.weakness ? [p.weakness] : []
                });
            }
        }
        await session.save();
    }

    // Update Clip with Analysis
    savedClip.title = json.title || "Untitled Clip";
    savedClip.o_formation = json.data.o_formation;
    savedClip.d_formation = json.data.d_formation;
    savedClip.formation = `${json.data.o_formation} vs ${json.data.d_formation}`;
    savedClip.fullData = json;
    savedClip.geminiFileUri = file.uri;
    await savedClip.save();

    // Add to Chat History
    await Session.updateOne({ sessionId }, { $push: { history: { role: 'user', text: "Uploaded Video Analysis" } } });
    await Session.updateOne({ sessionId }, { $push: { history: { role: 'model', text: JSON.stringify(json) } } });

    // Cleanup local file
    await fs.unlink(tempPath).catch(console.error);
    
    // Return result
    res.json({ reply: JSON.stringify(json), newClip: savedClip });

  } catch (e) {
    console.error("SERVER ERROR:", e); 
    if (tempPath) await fs.unlink(tempPath).catch(console.error);
    res.status(500).json({ error: e.message || "Analysis failed." });
  }
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Vantage Vision running on http://localhost:${PORT}`));
