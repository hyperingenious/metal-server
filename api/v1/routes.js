// routes.js
const { verifyAppwriteJWT } = require("./middlewares/verifyClientJWT");
const { getNextBatchProfiles, getRandomProfilesSimple } = require("./service/profileService");
const { sendInvitation } = require("./service/invitationService");
const { getActiveSentInvitations } = require("./service/manageSentInvitationService");
const { getActiveReceivedInvitations, declineInvitation, acceptInvitation } = require("./service/manageIncomingRequestService");
const {
    getActiveChats,
    removeChat,
    getChatState,
    sendMessage,
    proposeDate,
    respondToDateProposal,
    getChatMessages 
} = require("./service/chatService");
const { removeSentInvitation } = require("./service/manageSentInvitationService");
const { createNotification } = require("./service/notificationService");

module.exports = (app) => {

  app.get("/api/v1", verifyAppwriteJWT, async (req, res) => {
    const user = req.user;
    res.json({
      userId: user.$id,
      user: user,
    });
  });

  app.get("/api/v1/explore/next-batch",verifyAppwriteJWT, async (req, res) => {
    try {
      const page = parseInt(req.query.page || "0");
      const userId = req.user.$id;
      const profiles = await getNextBatchProfiles(userId, page);
      res.json({ profiles });
    } catch (err) {
      console.error("Error fetching next batch:", err);
      res.status(500).json({ error: "Failed to fetch profiles" });
    }
  });

  app.get("/api/v1/profiles/random-simple", verifyAppwriteJWT, async (req, res) => {
        try {
            const currentUserId = req.user.$id;
            const limit = req.query.limit ? parseInt(req.query.limit) : 10;

            if (isNaN(limit) || limit <= 0) {
                return res.status(400).json({ error: "Invalid limit parameter. Must be a positive number." });
            }

            const profiles = await getRandomProfilesSimple(currentUserId, limit);
            res.status(200).json({ profiles });
        } catch (error) {
            console.error("Error fetching simple random profiles:", error.message);
            res.status(error.code || 500).json({ error: error.message || "Failed to fetch simple random profiles" });
        }
    });

  app.post("/api/v1/notification/invitations/send",verifyAppwriteJWT, async (req, res) => {
    const senderUserId = req.user.$id;
    const { receiverUserId } = req.body;

    if (!receiverUserId) {
      return res.status(400).json({ error: "receiverUserId is required" });
    }

    try {
      const result = await sendInvitation(senderUserId, receiverUserId);
      await createNotification(receiverUserId,senderUserId, 'invite', "You have an invitation.")
      return res.status(200).json({ message: "Invitation sent", ...result });
    } catch (err) {
      const code = err.code === 403 ? 403 : 500;
      res.status(code).json({ error: err.message });
    }
  });

  app.get('/api/v1/notification/invitations/active',verifyAppwriteJWT, async (req, res) => {
    try {
      const userId = req.user.$id;
      const invitations = await getActiveSentInvitations(userId);
      res.status(200).json({ invitations });
    } catch (error) {
      console.error('Error fetching active invitations:', error.message);
      res.status(500).json({ error: 'Failed to fetch active invitations' });
    }
  });

  app.post('/api/v1/notification/invitations/remove-sent',verifyAppwriteJWT, async (req, res) => {
  try {
    const senderUserId = req.user.$id;
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required" });
    }

    const result = await removeSentInvitation(senderUserId, connectionId);
    res.status(200).json({ message: "Invitation removed", ...result });

  } catch (err) {
    console.error("Error removing invitation:", err.message);
    res.status(500).json({ error: err.message || "Failed to remove invitation" });
  }
  });

  app.get("/api/v1/notification/invitations/received/active",verifyAppwriteJWT, async (req, res) => {
        try {
            const receiverUserId = req.user.$id;
            const invitations = await getActiveReceivedInvitations(receiverUserId);
            res.status(200).json({ invitations });
        } catch (error) {
            console.error("Error fetching received invitations:", error.message);
            res.status(500).json({ error: "Failed to fetch received invitations" });
        }
    });

  app.post("/api/v1/notification/invitations/decline",verifyAppwriteJWT, async (req, res) => {
        try {
            const receiverUserId = req.user.$id;
            const { connectionId } = req.body;

            if (!connectionId) {
                return res.status(400).json({ error: "connectionId is required" });
            }

            const result = await declineInvitation(receiverUserId, connectionId);
            res.status(200).json({ message: "Invitation declined", ...result });
        } catch (err) {
            console.error("Error declining invitation:", err.message);
            const code = err.code === 403 ? 403 : 500;
            res.status(code).json({ error: err.message || "Failed to decline invitation" });
        }
    });

  app.post("/api/v1/notification/invitations/accept",verifyAppwriteJWT, async (req, res) => {
        try {
            const receiverUserId = req.user.$id;
            const { connectionId } = req.body;

            if (!connectionId) {
                return res.status(400).json({ error: "connectionId is required" });
            }

            const result = await acceptInvitation(receiverUserId, connectionId);
            res.status(200).json({ message: "Invitation accepted", ...result });
        } catch (err) {
            console.error("Error accepting invitation:", err.message);
            const code = err.code === 403 ? 403 : 500;
            res.status(code).json({ error: err.message || "Failed to accept invitation" });
        }
    });

  // Chat Management Routes
  // Get Active Chats
  app.get("/api/v1/chats/active",verifyAppwriteJWT, async (req, res) => {
    try {
      const currentUserId = req.user.$id;
      const chats = await getActiveChats(currentUserId);
      res.status(200).json({ chats });
    } catch (error) {
      console.error("Error fetching active chats:", error.message);
      res.status(error.code || 500).json({ error: "Failed to fetch active chats" });
    }
  });

  // Remove Active Chat
  app.post("/api/v1/chats/remove",verifyAppwriteJWT, async (req, res) => {
    try {
      const currentUserId = req.user.$id;
      const { connectionId } = req.body;
      if (!connectionId) {
        return res.status(400).json({ error: "Connection ID is required." });
      }
      const result = await removeChat(currentUserId, connectionId);
      res.status(200).json({ message: "Chat removed successfully.", ...result });
    } catch (error) {
      console.error("Error removing chat:", error.message);
      res.status(error.code || 500).json({ error: error.message || "Failed to remove chat" });
    }
  });

  // Get Chat State
 app.get("/api/v1/chats/:connectionId/chat-state",verifyAppwriteJWT, async (req, res) => {
    try {
      const currentUserId = req.user.$id;
      const connectionId = req.params.connectionId;

      const chatState = await getChatState(currentUserId, connectionId);
      res.status(200).json(chatState);
    } catch (error) {
      console.error("Error fetching chat state:", error.message);
      res.status(error.code || 500).json({ error: error.message || "Failed to fetch chat state" });
    }
  });

  // Send Message
 app.post("/api/v1/chats/:connectionId/messages",verifyAppwriteJWT, async (req, res) => {
    try {
      const currentUserId = req.user.$id;
      const connectionId = req.params.connectionId;
      const { content, messageType } = req.body; // content is text string or image URL string

      if (!content || !messageType) {
        return res.status(400).json({ error: "Message content and type are required." });
      }

      if (!['text', 'image'].includes(messageType)) {
        return res.status(400).json({ error: "Invalid message type. Must be 'text' or 'image'." });
      }

      const newMessage = await sendMessage(currentUserId, connectionId, content, messageType);
      res.status(200).json({ message: "Message sent successfully", messageData: newMessage });
    } catch (error) {
      console.error("Error sending message:", error.message);
      res.status(error.code || 500).json({ error: error.message || "Failed to send message" });
    }
  });

  // Propose Date
  app.post("/api/v1/chats/:connectionId/propose-date",verifyAppwriteJWT, async (req, res) => {
    try {
      const currentUserId = req.user.$id;
      const connectionId = req.params.connectionId;
      const { date, place } = req.body; // proposalDetails: { date: string, place: string }

      if (!date || !place) {
        return res.status(400).json({ error: "Date and place are required for date proposal." });
      }

      const updatedConnection = await proposeDate(currentUserId, connectionId, { date, place });
      res.status(200).json({ message: "Date proposal sent successfully.", connection: updatedConnection });
    } catch (error) {
      console.error("Error proposing date:", error.message);
      res.status(error.code || 500).json({ error: error.message || "Failed to propose date" });
    }
  });

  // Respond to Date Proposal
 app.post("/api/v1/chats/:connectionId/respond-date",verifyAppwriteJWT, async (req, res) => {
    try {
      
      const currentUserId = req.user.$id;
      const connectionId = req.params.connectionId;
      const { responseType, newDetails } = req.body;

      if (!responseType || !['accept', 'reject', 'modify'].includes(responseType)) {
        return res.status(400).json({ error: "Invalid or missing response type. Must be 'accept', 'reject', or 'modify'." });
      }
      if (responseType === 'modify' && (!newDetails || !newDetails.date || !newDetails.place)) {
        return res.status(400).json({ error: "New date and place are required for 'modify' response." });
      }

      const updatedConnection = await respondToDateProposal(currentUserId, connectionId, responseType, newDetails);
      res.status(200).json({ message: `Date proposal ${responseType}ed successfully.`, connection: updatedConnection });
    } catch (error) {
      console.error("Error responding to date proposal:", error.message);
      res.status(error.code || 500).json({ error: error.message || "Failed to respond to date proposal" });
    }
  });

 app.get("/api/v1/chats/:connectionId/messages",verifyAppwriteJWT, async (req, res) => {
    try {
      console.log("gotten this response")
      const connectionId = req.params.connectionId;
      const messages = await getChatMessages(connectionId);
      console.log({messages})
      res.status(200).json({ messages });
    } catch (error) {
      console.error("Error fetching chat messages:", error.message);
      res.status(error.code || 500).json({ error: error.message || "Failed to fetch chat messages" });
    }
  });
};