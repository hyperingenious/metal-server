require("dotenv").config();
const express = require("express");
const cors = require("cors");

const router = express();
const PORT = process.env.PORT || 3000;

router.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

router.use(express.json());

require("./api/v1/routes")(router);

router.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});