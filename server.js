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
/* ---------------- ELITE COACHING RUBRICS (UPDATED FROM SCRIPTURE) ---------------- */
/* These instructions guide the AI to act like a specific position coach based on the "New Scripture" protocol */
const RUBRICS = {
    "team": `
    [cite_start]ROLE: NFL Offensive/Defensive Coordinator[cite: 1].
    [cite_start]GOAL: High-level schematic breakdown[cite: 1].
    1. SITUATION:
       - Analyze Down & Distance, Field Position, and Personnel. [cite_start]Include hash location[cite: 3].
       - [cite_start]Score/time context (2-minute, 4-minute, red zone spacing)[cite: 4].
       - [cite_start]Personnel matchup (11 vs nickel, 12 vs base, dime vs empty)[cite: 4].
       - [cite_start]Self-scout tendency vs game theory breaker[cite: 5].
       - [cite_start]Win probability/EPA leverage of situation[cite: 6].
    2. PRE-SNAP:
       - [cite_start]Identify Formational Tells, Motion leverage, and Defensive Shell (MOFO/MOFC)[cite: 8].
       - [cite_start]Formation family (2x2, 3x1, Bunch, Condensed, Pistol, Under Center)[cite: 9].
       - [cite_start]Receiver splits (wide, reduced, nasty)[cite: 10].
       - [cite_start]Motion type (jet, orbit, yo-yo, return)[cite: 11].
       - [cite_start]Defensive front (Over, Under, Bear, Mint, Odd)[cite: 12].
       - [cite_start]Apex alignment and leverage declaration[cite: 13].
       - [cite_start]Safety rotation indicators and pressure disguise tells[cite: 14].
    3. SCHEME:
       - [cite_start]Name the specific concept (e.g., Duo, Dagger, Mesh, Cover 3 Match)[cite: 16].
       - [cite_start]Identify run family (Zone, Gap, Power, Counter)[cite: 17].
       - [cite_start]Identify pass structure (Hi-Low, Full-field progression, Alert)[cite: 18].
       - [cite_start]Tag RPO/Play Action elements[cite: 19].
       - [cite_start]Coverage family (Match, Spot Drop, Man-Free, Quarters variants)[cite: 20].
       - [cite_start]Identify protection scheme (Slide, Half-slide, Man, 6/7-man)[cite: 20].
    4. POST-SNAP:
       - [cite_start]Identify the 'Conflict Player' the offense is attacking[cite: 22].
       - [cite_start]Evaluate leverage gained/lost[cite: 23].
       - [cite_start]Defensive fit integrity[cite: 24].
       - [cite_start]QB eye manipulation effectiveness[cite: 25].
       - [cite_start]Identify bust vs execution win[cite: 26].
    5. EFFICIENCY:
       - [cite_start]Grade the play's success based on EPA principles[cite: 28].
       - [cite_start]Categorize as Explosive / Positive / Neutral / Negative[cite: 29].
       - [cite_start]Expected yards vs achieved yards[cite: 30].
       - [cite_start]Scheme win vs talent win vs defensive error[cite: 31].`,

    "qb": `
    [cite_start]ROLE: Elite Quarterback Coach[cite: 32].
    [cite_start]FOCUS: Biomechanics & Processing[cite: 33].
    1. BASE:
       - [cite_start]Feet width at setup vs release[cite: 35].
       - [cite_start]Platform consistency[cite: 36].
       - [cite_start]Reset speed after hitch[cite: 37].
       - [cite_start]Cleat torque generation[cite: 38].
    2. SEQUENCING:
       - [cite_start]Hip rotation timing relative to arm slot[cite: 40].
       - [cite_start]Hip-shoulder separation angle[cite: 41].
       - [cite_start]Weight transfer back hip to front toe[cite: 42, 46].
       - [cite_start]Off-platform compensation[cite: 43].
    3. RELEASE:
       - [cite_start]Release time (target <0.4s)[cite: 45].
       - [cite_start]Launch angle relative to route[cite: 47].
       - [cite_start]Release point consistency[cite: 48].
       - [cite_start]Ball RPM/spiral tightness[cite: 49].
    4. EYES:
       - [cite_start]Manipulation of safeties vs staring down targets[cite: 51].
       - [cite_start]Full-field vs half-field read[cite: 52].
       - [cite_start]Coverage ID speed[cite: 53].
       - [cite_start]Progression discipline[cite: 54].
       - [cite_start]Checkdown timing vs forced throw tendency[cite: 55].
    5. POCKET:
       - [cite_start]Climb vs drift[cite: 57].
       - [cite_start]Edge awareness[cite: 58].
       - [cite_start]Sack avoidance vs structure break[cite: 59].
       - [cite_start]Time to throw[cite: 59].
    6. ACCURACY:
       - [cite_start]Ball placement for YAC optimization[cite: 61].
       - [cite_start]Anticipation window throws[cite: 62].
       - [cite_start]Back-shoulder vs front-leverage placement[cite: 63].`,

    "rb": `
    [cite_start]ROLE: Run Game Coordinator[cite: 64].
    [cite_start]FOCUS: Vision & Pad Level[cite: 65].
    1. STEPS:
       - [cite_start]False steps vs direct attack[cite: 67].
       - [cite_start]Landmark discipline[cite: 68].
       - [cite_start]Press-to-cut timing[cite: 69].
    2. VISION:
       - [cite_start]Pressing the hole to manipulate LBs[cite: 71].
       - [cite_start]LB displacement recognition[cite: 72].
       - [cite_start]Cutback awareness[cite: 73].
       - [cite_start]Reactive vs anticipatory runner profile[cite: 74].
    3. PADS:
       - [cite_start]Pad level at contact (Hammer vs Nail)[cite: 76].
       - [cite_start]Center of gravity control[cite: 76].
       - [cite_start]Leg drive RPM[cite: 77].
    4. PRO:
       - [cite_start]Scanning technique in pass protection[cite: 79].
       - [cite_start]ID of most dangerous rusher[cite: 80].
       - [cite_start]Strike timing + anchor ability[cite: 81].
    5. EXPLOSIVENESS:
       - [cite_start]0-5 yard burst[cite: 83].
       - [cite_start]Second-level acceleration[cite: 84].
       - [cite_start]Contact balance sustainability[cite: 85].`,

    "wr": `
    [cite_start]ROLE: Wide Receiver Coach[cite: 86].
    [cite_start]FOCUS: Route Tech & Releases[cite: 87].
    1. RELEASE:
       - [cite_start]Footfire/Split release effectiveness against press[cite: 89].
       - [cite_start]Hand combat usage[cite: 90].
       - [cite_start]Release plan diversity[cite: 91].
    2. STEM:
       - [cite_start]Stacking the DB and maintaining leverage[cite: 93].
       - [cite_start]Blind-spot attack[cite: 93].
       - [cite_start]Vertical push to threaten cushion[cite: 94].
    3. BREAK:
       - [cite_start]Hip sink efficiency and step count at the break point[cite: 96].
       - [cite_start]Deceleration control[cite: 97].
       - [cite_start]Angle precision[cite: 98].
    4. CATCH:
       - [cite_start]Late hands technique and body positioning[cite: 100].
       - [cite_start]Tracking over shoulder[cite: 101].
       - [cite_start]High-point timing[cite: 102].
       - [cite_start]Sideline body control[cite: 103].
    5. SEPARATION:
       - [cite_start]Early vs late separation window[cite: 105].
       - [cite_start]YAC transition efficiency[cite: 106].`,

    "ol": `
    [cite_start]ROLE: Offensive Line Coach[cite: 107].
    [cite_start]FOCUS: Trench Mechanics[cite: 108].
    1. STANCE:
       - [cite_start]Weight distribution (tipping run/pass?)[cite: 110].
       - [cite_start]Pad height variance[cite: 111].
       - [cite_start]Hand pressure indicators[cite: 112].
    2. FIRST STEP:
       - [cite_start]Explosiveness and directionality[cite: 114].
       - [cite_start]6-inch power step vs bucket step[cite: 115].
       - [cite_start]Lateral quickness[cite: 116].
    3. HANDS:
       - [cite_start]Punch timing and placement (inside chest plate)[cite: 118].
       - [cite_start]Independent vs two-hand strike[cite: 118].
       - [cite_start]Refit frequency[cite: 119].
    4. ANCHOR:
       - [cite_start]Ability to sit and re-set against power[cite: 121].
       - [cite_start]Hip roll at contact[cite: 122].
       - [cite_start]Core stability vs bull rush[cite: 123].
    5. RUN FIT:
       - [cite_start]Combo timing[cite: 125].
       - [cite_start]Climb angle precision[cite: 126].
       - [cite_start]Finish mentality[cite: 127].`,

    "dl": `
    [cite_start]ROLE: Defensive Line Coach[cite: 128].
    [cite_start]FOCUS: Get-off & Hand Combat[cite: 129].
    1. GET-OFF:
       - [cite_start]Reaction to ball movement[cite: 131].
       - [cite_start]Stance efficiency[cite: 132].
       - [cite_start]False step presence[cite: 133].
    2. HANDS:
       - [cite_start]Swipe/Rip/Swim move efficacy[cite: 135].
       - [cite_start]Independent hand usage[cite: 136].
       - [cite_start]Counter readiness[cite: 137].
    3. PAD LEVEL:
       - [cite_start]Low man wins leverage analysis[cite: 139].
       - [cite_start]Long-arm conversion ability[cite: 140].
    4. GAP:
       - [cite_start]Maintaining gap integrity vs peeking backfield[cite: 142].
       - [cite_start]Rush lane discipline[cite: 142].
       - [cite_start]Shed timing vs run[cite: 143].`,

    "lb": `
    [cite_start]ROLE: Linebacker Coach[cite: 144].
    [cite_start]FOCUS: Read & React[cite: 145].
    1. READS:
       - [cite_start]Recognition of Guard pulls or flow[cite: 147].
       - [cite_start]Triangle read (Guard to RB)[cite: 148].
       - [cite_start]Play-action discipline[cite: 149].
    2. FLOW:
       - [cite_start]Scrape technique over trash[cite: 151].
       - [cite_start]Downhill trigger speed[cite: 152].
       - [cite_start]Pursuit angle efficiency[cite: 153].
    3. SHEDDING:
       - [cite_start]Shock and shed mechanics vs blockers[cite: 155].
       - [cite_start]Extension strength[cite: 156].
       - [cite_start]Rip-through timing[cite: 157].
    4. DROPS:
       - [cite_start]Depth and eye discipline in zone coverage[cite: 159].
       - [cite_start]Landmark precision[cite: 160].
       - [cite_start]Match rule understanding[cite: 161].`,

    "db": `
    [cite_start]ROLE: Secondary Coach (Corners & Safeties)[cite: 162, 186].
    [cite_start]FOCUS: Phase, Leverage, Range & Processing[cite: 163, 187].
    1. PEDAL & MOVEMENT:
       - [cite_start]Smoothness of backpedal/shuffle[cite: 165].
       - [cite_start]Cushion depth consistency[cite: 166].
       - [cite_start]Press-bail control[cite: 167].
       - [cite_start]Speed turn vs T-step efficiency[cite: 171].
       - [cite_start]Hip fluidity in transition (opening the gate)[cite: 170].
    2. ALIGNMENT & LEVERAGE:
       - [cite_start]Inside/out leverage discipline[cite: 179].
       - [cite_start]Boundary vs field awareness[cite: 179].
       - [cite_start]Pre-snap depth (10-12 yds MOFO) and disguise/rotation discipline[cite: 189, 191].
       - [cite_start]Red zone split adjustments[cite: 179].
    3. EYES & PROCESSING:
       - [cite_start]Reading WR hips (Man) vs QB eyes (Zone)[cite: 175, 176].
       - [cite_start]Pattern-match recognition speed[cite: 176].
       - [cite_start]Run-pass read speed and Play-action discipline[cite: 194, 196].
       - [cite_start]RPO conflict recognition[cite: 197].
    4. COVERAGE TECHNIQUE:
       - [cite_start]Ability to stay in-phase vertically[cite: 173].
       - [cite_start]Seam carry in Quarters[cite: 201].
       - [cite_start]Bracket execution and leverage integrity[cite: 201, 202].
    5. FINISH & TACKLING:
       - [cite_start]Playing through the hands at catch point[cite: 181].
       - [cite_start]Turn-and-locate timing[cite: 182].
       - [cite_start]Open-field tackling reliability and downhill angles[cite: 205, 206].
       - [cite_start]Turnover production/creation ability[cite: 183, 207].`,

    "general": `
    [cite_start]ROLE: Head Coach[cite: 209].
    [cite_start]FOCUS: Effort & IQ[cite: 210].
    - [cite_start]Analyze motor, situational awareness, and overall execution speed[cite: 211].
    - [cite_start]Pursuit effort backside[cite: 212].
    - [cite_start]Communication pre-snap[cite: 213].
    - [cite_start]Assignment discipline[cite: 214].
    - [cite_start]Alignment integrity[cite: 215].
    - [cite_start]Football IQ in high-leverage downs[cite: 216].
    - [cite_start]Tempo adaptability[cite: 217].`
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


// NEW: Schema for Playbook Concepts
const PlaySchema = new mongoose.Schema({
    owner: String,              // User ID
    playId: String,             // Unique ID (e.g., "play_12345")
    title: String,              // "Mesh Concept"
    linkedSessionId: String,    // The "Bridge" to film analysis
    elements: Array,            // The drawing data [{x, y, label, type}]
    aiAnalysis: {               // The "Brain" storage
        formation: String,      // "Trips Right"
        summary: String,        // "High-low read on the Mike LB"
        keyReads: [String]      // ["Read Corner", "Check Safety"]
    },
    createdAt: { type: Date, default: Date.now }
});

const Play = mongoose.model("Play", PlaySchema);

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

// // 7. Manual Data Override (Edit Button & Situation)
app.post("/api/update-clip-data", requireAuth, async (req, res) => {
    try {
        // ADDED: 'situation' to the destructuring
        const { clipId, title, summary, o_formation, d_formation, situation } = req.body;
        const clip = await Clip.findOne({ _id: clipId, owner: req.auth.userId });
        
        if (!clip) return res.status(404).json({ error: "Clip not found" });

        // Update Top Level
        if(title) clip.title = title;
        if(o_formation) clip.o_formation = o_formation;
        if(d_formation) clip.d_formation = d_formation;
        if(o_formation && d_formation) clip.formation = `${o_formation} vs ${d_formation}`;

        // Update Nested JSON
        if (clip.fullData) {
            if(title) clip.fullData.title = title;
            
            if (!clip.fullData.data) clip.fullData.data = {};
            
            if(o_formation) clip.fullData.data.o_formation = o_formation;
            if(d_formation) clip.fullData.data.d_formation = d_formation;

            // [FIX: SAVE SITUATION DATA]
            if (situation) {
                clip.fullData.data.situation = {
                    ...clip.fullData.data.situation, // Keep existing fields
                    ...situation // Overwrite with new edits
                };
            }

            if (clip.fullData.scouting_report && summary) {
                clip.fullData.scouting_report.summary = summary;
            }
        }
        
        await clip.save();
        res.json({ success: true });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Data Update failed" }); 
    }
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

// 11. Save a Play Design
app.post("/api/save-play", requireAuth, async (req, res) => {
    try {
        const { playId, title, elements, linkedSessionId, aiAnalysis } = req.body;
        
        // Upsert: If play exists, update it. If not, create it.
        const play = await Play.findOneAndUpdate(
            { playId, owner: req.auth.userId },
            { 
                title, 
                elements, 
                linkedSessionId,
                aiAnalysis,
                // If it's a new save, set owner. If updating, keep owner.
                $setOnInsert: { owner: req.auth.userId } 
            },
            { new: true, upsert: true } // "new" returns the updated doc, "upsert" creates if missing
        );

        res.json({ success: true, play });
    } catch (e) {
        console.error("Save Play Error:", e);
        res.status(500).json({ error: "Failed to save play." });
    }
});

// 12. Get All Plays (Library Load)
app.get("/api/get-plays", requireAuth, async (req, res) => {
    try {
        // Fetch all plays belonging to this user, newest first
        const plays = await Play.find({ owner: req.auth.userId }).sort({ createdAt: -1 });
        res.json(plays);
    } catch (e) {
        res.status(500).json({ error: "Failed to load library." });
    }
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Vantage Vision running on http://localhost:${PORT}`));
