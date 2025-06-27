const sdk = require("node-appwrite");
const {
  APPWRITE_CLOUD_URL,
  APPWRITE_PROJECT_ID,
} = require("../appwrite/appwrite");

const verifyAppwriteJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const client = new sdk.Client()
      .setEndpoint(APPWRITE_CLOUD_URL)
      .setProject(APPWRITE_PROJECT_ID)
      .setJWT(token);

    const account = new sdk.Account(client);
    const user = await account.get();

    req.user = user;
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = { verifyAppwriteJWT };
