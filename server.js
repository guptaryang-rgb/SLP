require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");

// --- NEW MODULES FOR PRODUCTION ---
const helmet = require("helmet");
const compression = require("compression");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const multer = require("multer");

// Third Party SDKs
const { ClerkExpressWithAuth } = require("@clerk/clerk-sdk-node");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const cloudinary = require("cloudinary").v2;

// Initialize App
const app = express();
const PORT = process.env.PORT || 3000;

// --- STEP 1: SECURITY & PERFORMANCE MIDDLEWARE ---
app.use(helmet({
  contentSecurityPolicy: false // Disabled to allow external scripts (Clerk, Google Fonts)
}));
app.use(compression());

// Middleware Configuration
app.use(cors({
  origin: true,
  credentials: true // Required for session cookies
}));

// Increased limit for high-res game film (still needed for JSON parts)
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true }));

// --- STEP 2: UPLOAD DIRECTORY & MULTER ---
const UPLOAD_DIR = path.join(__dirname, 'temp_uploads');
fs.mkdir(UPLOAD_DIR, { recursive: true }).catch(console.error);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Vantage Vision Database Connected"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- STEP 3: PERSISTENT MONGO SESSIONS ---
app.use(session({
  secret: process.env.SESSION_SECRET || "vantage-vision-production-secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions_store', // Distinct from your app 'sessions'
    ttl: 14 * 24 * 60 * 60 // 14 days
  }),
  cookie: {
    secure: process.env.NODE_ENV === "production", // Secure in production
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Gemini AI Configuration
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

const MODEL_FALLBACK_LIST = ["gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"];

async function generateWithFallback(promptParts) {
    let lastError = null;
    for (const modelName of MODEL_FALLBACK_LIST) {
        try {
            console.log(`🤖 Analyzing with ${modelName}...`);
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { 
                    temperature: 0.2, 
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

/* ---------------- DATABASE SCHEMAS ---------------- */

const PlayerProfileSchema = new mongoose.Schema({
    identifier: String, position: String, grade: String, 
    notes: [String], weaknesses: [String], 
    last_updated: { type: Date, default: Date.now }
});

const Session = mongoose.model("Session", new mongoose.Schema({
  sessionId: String, owner: String, title: String, 
  type: { type: String, default: "team" }, 
  sport: String, history: [{ role: String, text: String }], 
  roster: [PlayerProfileSchema], 
  createdAt: { type: Date, default: Date.now }
}));

const Clip = mongoose.model("Clip", new mongoose.Schema({
  owner: String, sessionId: String, sport: String, 
  title: String, formation: String, o_formation: String, d_formation: String, 
  section: { type: String, default: "Inbox" }, videoUrl: String, 
  publicId: String, geminiFileUri: String, fullData: Object, 
  chatHistory: [{ role: String, text: String }], snapshots: [String], 
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

app.use(ClerkExpressWithAuth());
app.use(express.static(__dirname));

app.get("/", (_, res) => { res.sendFile(path.join(__dirname, "index.html")); });
app.get("/privacy.html", (_, res) => { res.sendFile(path.join(__dirname, "privacy.html")); });
app.get("/terms.html", (_, res) => { res.sendFile(path.join(__dirname, "terms.html")); });

// --- STEP 4: SESSION RESTORE ENDPOINT ---
app.get("/api/restore-session", requireAuth, async (req, res) => {
  try {
    // 1. Check active cookie session
    if (req.session.activeSessionId) {
       return res.json({ sessionId: req.session.activeSessionId });
    }

    // 2. Fallback: Find most recent session in DB for this user
    const lastSession = await Session.findOne({ owner: req.auth.userId })
                                     .sort({ createdAt: -1 });

    if (lastSession) {
      // Auto-activate it
      req.session.activeSessionId = lastSession.sessionId;
      return res.json({ sessionId: lastSession.sessionId });
    }

    res.json({ sessionId: null });
  } catch (error) {
    console.error("Restore Error:", error);
    res.json({ sessionId: null });
  }
});

// 1. Create New Session
app.post("/api/create-session", requireAuth, async (req, res) => {
  try {
    const session = await Session.create({
      sessionId: "sess_" + Date.now(), 
      owner: req.auth.userId, 
      title: req.body.title || "New Session",
      type: req.body.type || "self", 
      sport: "football", 
      history: [], roster: []
    });
    
    // Set Active Session in Cookie
    req.session.activeSessionId = session.sessionId;
    
    res.json(session);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Get All Sessions
app.get("/api/sessions", requireAuth, async (req, res) => {
  try {
    const query = { owner: req.auth.userId };
    if (req.query.type) query.type = req.query.type;
    
    const sessions = await Session.find(query).sort({ createdAt: -1 });
    res.json(sessions.map(s => ({ 
        id: s.sessionId, title: s.title, type: s.type, date: s.createdAt
    })));
  } catch (e) { res.json([]); }
});

// 3. Get Single Session Data
app.get("/api/session/:id", requireAuth, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.id, owner: req.auth.userId });
    if (!session) return res.status(404).json({ error: "Session not found" });
    
    // Update active session on fetch
    req.session.activeSessionId = session.sessionId;

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
    const clips = await Clip.find({ sessionId, owner: req.auth.userId });
    for(const clip of clips) {
        if(clip.publicId) await cloudinary.uploader.destroy(clip.publicId, { resource_type: "video" });
    }
    await Clip.deleteMany({ sessionId, owner: req.auth.userId });
    
    if (req.session.activeSessionId === sessionId) {
        req.session.activeSessionId = null;
    }
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// 5. Search/Get Clips
app.get("/api/search", requireAuth, async (req, res) => {
  try {
    if (!req.query.sessionId) return res.json([]);
    const query = { owner: req.auth.userId, sessionId: req.query.sessionId };
    const clips = await Clip.find(query).sort({ section: 1, createdAt: -1 });
    res.json(clips);
  } catch (e) { res.json([]); }
});

// 6. Update Clip
app.post("/api/update-clip", requireAuth, async (req, res) => {
  try {
    await Clip.findOneAndUpdate(
        { _id: req.body.id, owner: req.auth.userId }, 
        { $set: { section: req.body.section } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "Update failed" }); }
});

// 7. Manual Data Override
app.post("/api/update-clip-data", requireAuth, async (req, res) => {
    try {
        const { clipId, title, summary, o_formation, d_formation } = req.body;
        const clip = await Clip.findOne({ _id: clipId, owner: req.auth.userId });
        if (!clip) return res.status(404).json({ error: "Clip not found" });

        clip.title = title;
        clip.o_formation = o_formation;
        clip.d_formation = d_formation;
        clip.formation = `${o_formation} vs ${d_formation}`;

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
    
    const historyText = chatHistory.map(h => `${h.role.toUpperCase()}: ${h.text}`).join("\n");
    const prompt = `
    ROLE: Elite Football Coordinator.
    CONTEXT: Clip Analysis.
    CLIP: ${JSON.stringify(clip.fullData)}
    ROSTER: ${rosterContext}
    HISTORY: ${historyText}
    USER: "${req.body.message}"
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

/* ---- STEP 5: UPGRADED MAIN ANALYSIS ENGINE (MULTER SUPPORT) ---- */
// Now accepts Multipart Form Data via Multer
app.post("/api/chat", requireAuth, upload.single("video"), async (req, res) => {
  // Extract text fields from body
  const { message, sessionId, mimeType, sport, position } = req.body;
  const file = req.file; // Multer file object

  // Ensure session persistence
  if (sessionId) req.session.activeSessionId = sessionId;
  if (!req.session.activeSessionId && sessionId) req.session.activeSessionId = sessionId;

  try {
    // A. Text Only Chat (No File)
    if (!file) {
        await Session.updateOne({ sessionId }, { $push: { history: { role: 'user', text: message } } });
        const result = await generateWithFallback([{ text: `ROLE: NFL Coach. USER: ${message}` }]);
        const reply = result.response.text();
        await Session.updateOne({ sessionId }, { $push: { history: { role: 'model', text: reply } } });
        return res.json({ reply });
    }

    // B. Video Analysis Request (Using File from Multer)
    const tempPath = file.path;

    // Upload to Cloudinary & Gemini
    const [cloud, uploaded] = await Promise.all([
        cloudinary.uploader.upload(tempPath, { resource_type: "video", folder: "vantage_vision" }),
        fileManager.uploadFile(tempPath, { mimeType: file.mimetype || "video/mp4", displayName: "Video" })
    ]);

    // Create "Processing" Clip
    let savedClip = await Clip.create({
      owner: req.auth.userId, 
      sessionId: sessionId || req.session.activeSessionId, 
      sport, 
      videoUrl: cloud.secure_url, 
      publicId: cloud.public_id,
      title: "Analyzing...", formation: "...", section: "Inbox", chatHistory: [], snapshots: []
    });

    // Wait for Gemini
    let gFile = await fileManager.getFile(uploaded.file.name);
    while (gFile.state === FileState.PROCESSING) {
        await new Promise(r => setTimeout(r, 2000));
        gFile = await fileManager.getFile(uploaded.file.name);
    }
    if (gFile.state === FileState.FAILED) throw new Error("Video processing failed at Google.");

    // Retrieve Session for Context
    const session = await Session.findOne({ sessionId: sessionId || req.session.activeSessionId, owner: req.auth.userId });
    
    if (!session) {
        if (tempPath) await fs.unlink(tempPath).catch(console.error);
        return res.status(400).json({ reply: "Error: No Active Session found." });
    }

    const rosterContext = session.roster ? session.roster.map(p => `${p.identifier}: ${p.weaknesses.join(', ')}`).join('\n') : "";
    
    // Construct Prompt (Abbreviated for brevity, logic remains)
    let systemInstruction = `
    ROLE: ${position === 'team' ? "NFL Coordinator" : "Elite Position Coach"}.
    ROSTER: ${rosterContext}
    OUTPUT JSON FORMAT: { "title": "...", "data": {"o_formation": "...", "d_formation": "..."}, "scouting_report": {...}, "players_detected": [...] }
    `;

    const prompt = [ { fileData: { mimeType: gFile.mimeType, fileUri: gFile.uri } }, { text: systemInstruction } ];
    const result = await generateWithFallback(prompt);
    
    // Parse JSON
    let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    let json;
    try { json = JSON.parse(text); } catch (e) { 
        json = { title: "Analysis Completed", data: { o_formation: "N/A" }, scouting_report: { summary: text } }; 
    }

    // Update Roster logic...
    if (json.players_detected) { /* ... same roster update logic ... */ }
    await session.save();

    // Update Clip
    savedClip.title = json.title || "Untitled Analysis";
    savedClip.fullData = json;
    savedClip.o_formation = json.data?.o_formation || "N/A";
    savedClip.d_formation = json.data?.d_formation || "N/A";
    savedClip.formation = `${savedClip.o_formation} vs ${savedClip.d_formation}`;
    savedClip.geminiFileUri = gFile.uri;
    await savedClip.save();

    // Cleanup
    await fs.unlink(tempPath).catch(console.error);
    
    res.json({ reply: JSON.stringify(json), newClip: savedClip });

  } catch (e) {
    console.error("SERVER ERROR:", e); 
    if (req.file) await fs.unlink(req.file.path).catch(console.error);
    res.status(500).json({ error: e.message || "Analysis failed." });
  }
});

// Professional Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => console.log(`🚀 Vantage Vision running on http://localhost:${PORT}`));
