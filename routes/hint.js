const express = require("express");
const jwt = require("jsonwebtoken");
const Groq = require("groq-sdk");
const pool = require("../db");

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Auth middleware ───────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── Struggle score calculator ─────────────────────────────────────
function calcStruggleScore(hintsRequested, wrongSubmissions, timeSpentSeconds) {
  const timeMinutes = Math.floor(timeSpentSeconds / 60);
  return (wrongSubmissions * 2) + (hintsRequested * 3) + Math.floor(timeMinutes / 10);
}

// ── POST /hint ────────────────────────────────────────────────────
router.post("/", authMiddleware, async (req, res) => {
  const { problemSlug, problemTitle, code, description, hintLevel } = req.body;
  const userId = req.user.userId;

  if (!problemSlug || !code)
    return res.status(400).json({ error: "problemSlug and code are required" });

  const level = Math.min(Math.max(parseInt(hintLevel) || 1, 1), 3);

  try {
    let [rows] = await pool.execute(
      "SELECT * FROM sessions WHERE user_id = ? AND problem_slug = ?",
      [userId, problemSlug]
    );

    let session;
    if (rows.length === 0) {
      await pool.execute(
        `INSERT INTO sessions 
         (user_id, problem_slug, problem_title, hints_requested) 
         VALUES (?, ?, ?, 1)`,
        [userId, problemSlug, problemTitle || problemSlug]
      );
      [rows] = await pool.execute(
        "SELECT * FROM sessions WHERE user_id = ? AND problem_slug = ?",
        [userId, problemSlug]
      );
      session = rows[0];
    } else {
      session = rows[0];
      await pool.execute(
        "UPDATE sessions SET hints_requested = hints_requested + 1 WHERE id = ?",
        [session.id]
      );
      session.hints_requested += 1;
    }

    const score = calcStruggleScore(
      session.hints_requested,
      session.wrong_submissions,
      session.time_spent_seconds
    );

    await pool.execute(
      `INSERT INTO problem_stats (user_id, problem_slug, struggle_score)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         struggle_score = ?,
         last_attempted = CURRENT_TIMESTAMP,
         total_attempts = total_attempts + 1`,
      [userId, problemSlug, score, score]
    );

    const hintInstructions = {
      1: `Give ONE short question (1-2 sentences) that makes the user think about 
          the inefficiency in their approach. Do not mention any algorithm or data structure by name.`,
      2: `Give a conceptual nudge (2-3 sentences). You may hint at the category of 
          solution (e.g. "a data structure that gives O(1) lookup") but do not name it explicitly.`,
      3: `Give a near-explicit hint (3-4 sentences). You may name the algorithm or 
          data structure. Do not write any code.`,
    };

    const systemPrompt = `You are a DSA tutor helping a student solve coding problems.
Your job is to give hints, never solutions. Never write code. Never give the full algorithm.
The student is asking for a level ${level} hint (1=gentle, 2=medium, 3=strong).
${hintInstructions[level]}
Keep your response concise and focused. End with encouragement.`;

    const userMessage = `Problem: ${problemTitle || problemSlug}
${description ? `Description: ${description.slice(0, 500)}` : ""}

Student's current code:
${code}

This is their level ${level} hint request. They have asked for ${session.hints_requested} hint(s) total on this problem.`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();

  } catch (err) {
    console.error(err);
    if (!res.headersSent)
      res.status(500).json({ error: "Server error" });
  }
});

// ── POST /hint/analyze ────────────────────────────────────────────
router.post("/analyze", authMiddleware, async (req, res) => {
  const { code, problemTitle, problemSlug } = req.body;
  const userId = req.user.userId;

  if (!code)
    return res.status(400).json({ error: "code is required" });

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{
        role: "user",
        content: `Analyze this code for a problem called "${problemTitle}".
Return ONLY a JSON object with these exact fields, no explanation, no markdown backticks:
{
  "currentComplexity": "time complexity of this code e.g. O(n^2)",
  "spaceComplexity": "space complexity e.g. O(n)",
  "optimalComplexity": "optimal time complexity for this problem e.g. O(n)",
  "canImprove": true or false,
  "patternTag": "the DSA pattern this problem belongs to, one of: array, string, hashmap, two-pointers, sliding-window, binary-search, linked-list, stack, queue, tree, graph, dynamic-programming, greedy, recursion, backtracking, heap, trie, math"
}

Code:
${code}`
      }],
      max_tokens: 250,
    });

    const text = response.choices[0].message.content;
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Save pattern tag to DB if we have a slug
    if (problemSlug && parsed.patternTag) {
      await pool.execute(
        `INSERT INTO problem_stats (user_id, problem_slug, pattern_tag, struggle_score)
         VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE
           pattern_tag = ?,
           last_attempted = CURRENT_TIMESTAMP`,
        [userId, problemSlug, parsed.patternTag, parsed.patternTag]
      );
    }

    res.json(parsed);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Analysis failed" });
  }
});

// ── GET /hint/stats ───────────────────────────────────────────────
router.get("/stats", authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  try {
    // All problems attempted, with stats joined
    const [problems] = await pool.execute(
      `SELECT 
        s.problem_slug,
        s.problem_title,
        s.hints_requested,
        s.wrong_submissions,
        s.solved,
        s.updated_at,
        ps.struggle_score,
        ps.pattern_tag,
        ps.total_attempts
       FROM sessions s
       LEFT JOIN problem_stats ps 
         ON s.user_id = ps.user_id AND s.problem_slug = ps.problem_slug
       WHERE s.user_id = ?
       ORDER BY s.updated_at DESC
       LIMIT 20`,
      [userId]
    );

    // Pattern breakdown — how many problems per pattern
    const patternMap = {};
    for (const p of problems) {
      if (p.pattern_tag) {
        patternMap[p.pattern_tag] = (patternMap[p.pattern_tag] || 0) + 1;
      }
    }

    // Summary numbers
    const totalHints = problems.reduce((sum, p) => sum + (p.hints_requested || 0), 0);
    const totalProblems = problems.length;
    const avgStruggle = problems.length
      ? Math.round(problems.reduce((sum, p) => sum + (p.struggle_score || 0), 0) / problems.length)
      : 0;

    res.json({
      problems,
      patternBreakdown: patternMap,
      summary: { totalProblems, totalHints, avgStruggle },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

module.exports = router;