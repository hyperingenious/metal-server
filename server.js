require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const router = express();
const PORT = process.env.PORT || 3000;
const SELF_URL = process.env.SELF_URL || `http://localhost:${PORT}`;

router.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

router.use(express.json());

require("./api/v1/routes")(router);

// Health check endpoint for self-ping
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Self-ping cron job - runs every 10 minutes to keep the server alive
cron.schedule("*/10 * * * *", async () => {
  try {
    const response = await fetch(`${SELF_URL}/health`);
    const data = await response.json();
    console.log(`[CRON] Self-ping successful at ${data.timestamp}`);
  } catch (error) {
    console.error(`[CRON] Self-ping failed:`, error.message);
  }
});

router.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Self-ping enabled: ${SELF_URL}/health (every 10 minutes)`);
});