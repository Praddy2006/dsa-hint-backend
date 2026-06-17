require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const hintRoutes = require("./routes/hint");

const app = express();

// Allow requests from the Chrome extension
app.use(cors({
  origin: "*", // In production you'd lock this down
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

// Routes
app.use("/auth", authRoutes);
app.use("/hint", hintRoutes);

// Health check — useful for testing the server is running
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Server running on http://localhost:${PORT}`);
});