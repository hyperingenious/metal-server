const { verifyAppwriteJWT } = require("./middlewares/verifyClientJWT");

module.exports = (app) => {
  app.get("/api/v1", verifyAppwriteJWT, (_, res) => {
    res.send("<h1>This the V1 of the API, and you have access to it</h1>");
  });
};
