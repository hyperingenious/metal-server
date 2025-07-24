// api/v1/service/chatService.js

const { AppwriteService } = require("../appwrite/appwriteService");
const { ID, Query } = require("node-appwrite");
const {
  APPWRITE_USERS_COLLECTION_ID,
  APPWRITE_CONNECTIONS_COLLECTION_ID,
  APPWRITE_IMAGES_COLLECTION_ID,
  APPWRITE_MESSAGES_COLLECTION_ID,
  APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
} = require("../appwrite/appwriteConstants");

const MESSAGE_LIMIT = 100;

/**
 * Fetches active chats for a given user.
 * A chat is active if its status is 'chat_active' and the user is either the sender or receiver.
 * @param {string} currentUserId The ID of the currently authenticated user.
 * @returns {Promise<Array>} A list of active chat objects.
 */
const getActiveChats = async (currentUserId) => {
  const appwrite = new AppwriteService();

  // Query connections where status is 'chat_active' AND (senderId is current user OR receiverId is current user)
  const connectionsAsSenderRes = await appwrite.listDocuments(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    [
      Query.equal("senderId", currentUserId),
      Query.equal("status", "chat_active"),
    ]
  );

  const connectionsAsReceiverRes = await appwrite.listDocuments(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    [
      Query.equal("receiverId", currentUserId),
      Query.equal("status", "chat_active"),
    ]
  );

  // Combine and deduplicate connections
  const allConnections = [
    ...connectionsAsSenderRes.documents,
    ...connectionsAsReceiverRes.documents,
  ];

  const uniqueConnectionsMap = new Map();
  allConnections.forEach((conn) => uniqueConnectionsMap.set(conn.$id, conn));
  const activeConnections = Array.from(uniqueConnectionsMap.values());

  if (!activeConnections.length) {
    return [];
  }

  const chatList = [];

  for (const conn of activeConnections) {
    // Determine the partner's ID, ensuring null safety for relationship objects
    const partnerId =
      conn.senderId && conn.senderId.$id === currentUserId
        ? conn.receiverId
          ? conn.receiverId.$id
          : null
        : conn.senderId
        ? conn.senderId.$id
        : null;

    if (!partnerId) {
      console.warn(`Could not determine partner ID for connection ${conn.$id}`);
      continue;
    }

    // Fetch partner's user document for name
    let partnerUser = null;
    try {
      partnerUser = await appwrite.getDocument(
        APPWRITE_USERS_COLLECTION_ID,
        partnerId
      );
    } catch (err) {
      console.warn(
        `No user document found for partnerId ${partnerId} in chat: ${err.message}`
      );
      continue;
    }

    // Fetch partner's primary image
    let partnerPrimaryImage = null;
    try {
      const imageRes = await appwrite.listDocuments(
        APPWRITE_IMAGES_COLLECTION_ID,
        [Query.equal("user", partnerId)]
      );
      // image_1 holds the primary image URL
      partnerPrimaryImage = imageRes.documents[0]?.image_1 || null;
    } catch (err) {
      console.warn(
        `No images found for partnerId ${partnerId} in chat: ${err.message}`
      );
    }

    chatList.push({
      connectionId: conn.$id,
      partnerId: partnerId,
      partnerName: partnerUser?.name || "Unknown",
      partnerPhotoUrl: partnerPrimaryImage,
      messageCount: conn.messageCount || 0,
      dateProposalStatus: conn.dateProposalStatus || "none",
    });
  }

  return chatList;
};

/**
 * Removes (terminates) an active chat, freeing up slots for both users.
 * @param {string} currentUserId The ID of the user initiating the removal.
 * @param {string} connectionId The ID of the connection document to remove.
 * @returns {Promise<Object>} Success status.
 */
const removeChat = async (currentUserId, connectionId) => {
  const appwrite = new AppwriteService();

  const connectionDoc = await appwrite.getDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId
  );

  if (
    !connectionDoc ||
    connectionDoc.status !== "chat_active" ||
    (connectionDoc.senderId.$id !== currentUserId &&
      connectionDoc.receiverId.$id !== currentUserId)
  ) {
    const error = new Error(
      "Unauthorized or invalid chat connection for removal"
    );
    error.code = 403;
    throw error;
  }

  const senderUserId = connectionDoc.senderId.$id;
  const receiverUserId = connectionDoc.receiverId.$id;

  let newStatus;
  if (senderUserId === currentUserId) {
    newStatus = "chat_removed_by_sender";
  } else {
    newStatus = "chat_removed_by_receiver";
  }

  await appwrite.updateDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId,
    { status: newStatus }
  );

  // Decrement activeChatCount for both senderId and receiverId
  const senderUserDoc = await appwrite.getDocument(
    APPWRITE_USERS_COLLECTION_ID,
    senderUserId
  );
  if (senderUserDoc) {
    const updatedSenderChatCount = Math.max(
      0,
      (senderUserDoc.activeChatCount || 0) - 1
    );
    await appwrite.updateDocument(APPWRITE_USERS_COLLECTION_ID, senderUserId, {
      activeChatCount: updatedSenderChatCount,
    });
  } else {
    console.warn(
      `Sender user document not found for ID: ${senderUserId} during chat removal.`
    );
  }

  const receiverUserDoc = await appwrite.getDocument(
    APPWRITE_USERS_COLLECTION_ID,
    receiverUserId
  );
  if (receiverUserDoc) {
    const updatedReceiverChatCount = Math.max(
      0,
      (receiverUserDoc.activeChatCount || 0) - 1
    );
    await appwrite.updateDocument(
      APPWRITE_USERS_COLLECTION_ID,
      receiverUserId,
      { activeChatCount: updatedReceiverChatCount }
    );
  } else {
    console.warn(
      `Receiver user document not found for ID: ${receiverUserId} during chat removal.`
    );
  }

  return { success: true, message: "Chat removed successfully" };
};

/**
 * Fetches the current state of a specific chat connection.
 * @param {string} currentUserId The ID of the currently authenticated user.
 * @param {string} connectionId The ID of the connection document.
 * @returns {Promise<Object>} The chat state including message count, date proposal status, and partner info.
 */
const getChatState = async (currentUserId, connectionId) => {
  const appwrite = new AppwriteService();

  const connectionDoc = await appwrite.getDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId
  );

  if (
    !connectionDoc ||
    connectionDoc.status !== "chat_active" ||
    (connectionDoc.senderId.$id !== currentUserId &&
      connectionDoc.receiverId.$id !== currentUserId)
  ) {
    const error = new Error(
      "Unauthorized or invalid chat connection for state lookup"
    );
    error.code = 403;
    throw error;
  }

  const partnerId =
    connectionDoc.senderId.$id === currentUserId
      ? connectionDoc.receiverId.$id
      : connectionDoc.senderId.$id;

  let partnerUser = null;
  try {
    partnerUser = await appwrite.getDocument(
      APPWRITE_USERS_COLLECTION_ID,
      partnerId
    );
  } catch (err) {
    console.warn(
      `Partner user document not found for ID: ${partnerId} during chat state lookup.`
    );
  }

  let partnerPrimaryImage = null;
  try {
    const imageRes = await appwrite.listDocuments(
      APPWRITE_IMAGES_COLLECTION_ID,
      [Query.equal("user", partnerId)]
    );
    partnerPrimaryImage = imageRes.documents[0]?.image_1 || null; // Assuming image_1 holds primary
  } catch (err) {
    console.warn(
      `No images found for partnerId ${partnerId} during chat state lookup.`
    );
  }

  return {
    connectionId: connectionDoc.$id,
    currentMessageCount: connectionDoc.messageCount || 0,
    currentDateProposalStatus: connectionDoc.dateProposalStatus || "none",
    // Ensure date and place are null if no proposal or accepted/rejected
    dateProposalDate:
      connectionDoc.dateProposalStatus &&
      ["proposed", "modified", "accepted"].includes(
        connectionDoc.dateProposalStatus
      )
        ? connectionDoc.dateProposalDate
        : null,
    dateProposalPlace:
      connectionDoc.dateProposalStatus &&
      ["proposed", "modified", "accepted"].includes(
        connectionDoc.dateProposalStatus
      )
        ? connectionDoc.dateProposalPlace
        : null,
    dateProposalProposerId: connectionDoc.dateProposalProposerId
      ? connectionDoc.dateProposalProposerId.$id
      : null,
    dateProposalLastActionBy: connectionDoc.dateProposalLastActionBy
      ? connectionDoc.dateProposalLastActionBy.$id
      : null,
    partnerId: partnerId,
    partnerName: partnerUser?.name || "Unknown",
    partnerPhotoUrl: partnerPrimaryImage,
  };
};

/**
 * Sends a text or image message within a chat.
 * @param {string} currentUserId The ID of the user sending the message.
 * @param {string} connectionId The ID of the connection document.
 * @param {string} messageContent The message content (text string or image URL string).
 * @param {string} messageType The type of message ('text' or 'image').
 * @returns {Promise<Object>} The created message document.
 */
const sendMessage = async (
  currentUserId,
  connectionId,
  messageContent,
  messageType
) => {
  const appwrite = new AppwriteService();

  const connectionDoc = await appwrite.getDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId
  );

  if (
    !connectionDoc ||
    connectionDoc.status !== "chat_active" ||
    (connectionDoc.senderId.$id !== currentUserId &&
      connectionDoc.receiverId.$id !== currentUserId)
  ) {
    const error = new Error(
      "Unauthorized or invalid chat connection to send message"
    );
    error.code = 403;
    throw error;
  }

  const currentMessageCount = connectionDoc.messageCount || 0;
  if (currentMessageCount >= MESSAGE_LIMIT) {
    const error = new Error("Message limit reached for this chat.");
    error.code = 403;
    throw error;
  }

  // Prepare message data based on messageType and your schema
  const newMessageData = {
    connectionId: connectionId,
    senderId: currentUserId,
    messageType: messageType, // 'text' or 'image'
    timestamp: Date.now(),
    is_read: false,
  };

  if (messageType === "text") {
    newMessageData.message = messageContent;
    newMessageData.is_image = false;
    newMessageData.imageUrl = null;
  } else if (messageType === "image") {
    newMessageData.message = "[Image]"; // Placeholder text for image message
    newMessageData.is_image = true;
    newMessageData.imageUrl = messageContent; // messageContent is the image URL
  } else {
    const error = new Error(
      "Invalid messageType for sendMessage. Must be 'text' or 'image'."
    );
    error.code = 400;
    throw error;
  }

  const newMessage = await appwrite.createDocument(
    APPWRITE_MESSAGES_COLLECTION_ID,
    newMessageData,
    ID.unique()
  );

  // Node.js equivalent of _createChatInboxOnLoad (Appwrite JS SDK)
  const createChatInboxOnLoad = async () => {
    try {
      // List documents to check if inbox exists
      const inboxDoc = await appwrite.listDocuments(
        APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
        [Query.equal("$id", connectionId)]
      );

      if (!inboxDoc.documents || inboxDoc.documents.length === 0) {
        try {
          await appwrite.createDocument(
            APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
            { is_image: null },
            connectionId // documentId
          );
        } catch (e) {
          console.error(
            "Failed to create chat inbox:",
            e.message || e.toString()
          );
        }
      }

      await appwrite.updateDocument(
        APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
        connectionId,
        {
          message: newMessageData.message,
          senderId: newMessageData.senderId,
          messageType: newMessageData.messageType,
          is_image: newMessageData.is_image,
          imageUrl: newMessageData.imageUrl,
        }
      );
    } catch (e) {
      console.error(
        "Error in createChatInboxOnLoad:",
        e.message || e.toString()
      );
    }
  }; // <-- FIXED: closed function

  await createChatInboxOnLoad();

  // Increment messageCount in the connection document
  await appwrite.updateDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId,
    { messageCount: currentMessageCount + 1 }
  );

  return newMessage;
};

/**
 * Proposes a date for a chat connection.
 * @param {string} currentUserId The ID of the user proposing the date.
 * @param {string} connectionId The ID of the connection document.
 * @param {Object} proposalDetails Details of the proposal ({ date: string, place: string }).
 * @returns {Promise<Object>} The updated connection document.
 */
const proposeDate = async (currentUserId, connectionId, proposalDetails) => {
  const appwrite = new AppwriteService();

  const connectionDoc = await appwrite.getDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId
  );

  if (
    !connectionDoc ||
    connectionDoc.status !== "chat_active" ||
    (connectionDoc.senderId.$id !== currentUserId &&
      connectionDoc.receiverId.$id !== currentUserId)
  ) {
    const error = new Error(
      "Unauthorized or invalid chat connection for date proposal"
    );
    error.code = 403;
    throw error;
  }

  const currentMessageCount = connectionDoc.messageCount || 0;
  if (currentMessageCount >= MESSAGE_LIMIT) {
    const error = new Error("Message limit reached. Cannot propose date.");
    error.code = 403;
    throw error;
  }

  if (["proposed", "modified"].includes(connectionDoc.dateProposalStatus)) {
    const error = new Error(
      "There is an active date proposal already! Please respond to it or wait for a response."
    );
    error.code = 409; // Conflict
    throw error;
  }

  // Create a new message document for the proposal event
  // Format the date to a more human-readable string (e.g., "July 24, 2025 at 18:47")
  const dateObj = new Date(proposalDetails.date);
  const options = { year: "numeric", month: "long", day: "numeric" };
  const datePart = dateObj.toLocaleDateString(undefined, options);
  const timePart = dateObj.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const proposalMessageText = `Proposed a date for ${datePart} at ${timePart} at ${proposalDetails.place}.`;

  const inboxDoc = await appwrite.listDocuments(
    APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
    [Query.equal("$id", connectionId)]
  );

  if (!inboxDoc.documents || inboxDoc.documents.length === 0) {
    try {
      await appwrite.createDocument(
        APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
        { is_image: null },
        connectionId // documentId
      );
    } catch (e) {
      console.error("Failed to create chat inbox:", e.message || e.toString());
    }
  }

  await appwrite.updateDocument(
    APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
    connectionId,
    {
      message: proposalMessageText,
      senderId: currentUserId,
      messageType: "date_proposal",
      is_image: null,
      imageUrl: null,
    }
  );

  await appwrite.createDocument(
    APPWRITE_MESSAGES_COLLECTION_ID,
    {
      connectionId: connectionId,
      senderId: currentUserId,
      messageType: "date_proposal",
      message: proposalMessageText,
      timestamp: Date.now(),
      is_read: false,
      is_image: false,
      imageUrl: null,
    },
    ID.unique()
  );

  await appwrite.updateDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId,
    { messageCount: currentMessageCount + 1 }
  );

  // Update connection document with proposal details (these are stored in connections, not in messages collection)
  const updatedConnection = await appwrite.updateDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId,
    {
      dateProposalStatus: "proposed",
      dateProposalDate: proposalDetails.date,
      dateProposalPlace: proposalDetails.place,
      dateProposalProposerId: currentUserId,
      dateProposalLastActionBy: currentUserId,
    }
  );

  return updatedConnection;
};

/**
 * Responds to a date proposal (accept, reject, or modify).
 * @param {string} currentUserId The ID of the user responding.
 * @param {string} connectionId The ID of the connection document.
 * @param {string} responseType The type of response ('accept', 'reject', 'modify').
 * @param {Object} [newDetails] New date/place if responseType is 'modify'.
 * @returns {Promise<Object>} The updated connection document.
 */
const respondToDateProposal = async ( currentUserId, connectionId, responseType, newDetails = {}
) => {
  const appwrite = new AppwriteService();

  const connectionDoc = await appwrite.getDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId
  );

  if (
    !connectionDoc ||
    connectionDoc.status !== "chat_active" ||
    (connectionDoc.senderId.$id !== currentUserId &&
      connectionDoc.receiverId.$id !== currentUserId)
  ) {
    const error = new Error(
      "Unauthorized or invalid chat connection for date response"
    );
    error.code = 403;
    throw error;
  }

  if (!["proposed", "modified"].includes(connectionDoc.dateProposalStatus)) {
    const error = new Error("No active proposal to respond to.");
    error.code = 400;
    throw error;
  }

  if (
    connectionDoc.dateProposalLastActionBy &&
    connectionDoc.dateProposalLastActionBy.$id === currentUserId
  ) {
    const error = new Error("You cannot respond to your own last action.");
    error.code = 403;
    throw error;
  }

  const currentMessageCount = connectionDoc.messageCount || 0;
  if (currentMessageCount >= MESSAGE_LIMIT) {
    const error = new Error(
      "Message limit reached. Cannot respond to date proposal."
    );
    error.code = 403;
    throw error;
  }

  let updateData = {};
  let responseMessageText = "";

  switch (responseType) {
    case "accept":
      updateData = {
        dateProposalStatus: "accepted",
        dateProposalLastActionBy: currentUserId,
      };
      responseMessageText = "Accepted the date proposal!";
      // TODO: Trigger push notification for date confirmation
      console.log(
        `Push Notification: Date confirmed between ${connectionDoc.senderId.$id} and ${connectionDoc.receiverId.$id}!`
      );
      break;
    case "reject":
      updateData = {
        dateProposalStatus: "rejected",
        dateProposalDate: null,
        dateProposalPlace: null,
        dateProposalProposerId: null, // Clear proposer as proposal is rejected
        dateProposalLastActionBy: currentUserId,
      };
      responseMessageText = "Rejected the date proposal.";
      break;
    case "modify":
      if (!newDetails.date || !newDetails.place) {
        const error = new Error(
          "New date and place are required for modifying a proposal."
        );
        error.code = 400;
        throw error;
      }
      updateData = {
        dateProposalStatus: "modified",
        dateProposalDate: newDetails.date,
        dateProposalPlace: newDetails.place,
        // dateProposalProposerId remains the original proposer
        dateProposalLastActionBy: currentUserId,
      };
      responseMessageText = `Modified the date proposal to ${newDetails.date} at ${newDetails.place}.`;
      break;
    default: {
      const error = new Error("Invalid response type.");
      error.code = 400;
      throw error;
    }
  }

  // Create a new message document for the response event
  await appwrite.createDocument(
    APPWRITE_MESSAGES_COLLECTION_ID,
    {
      connectionId: connectionId,
      senderId: currentUserId,
      messageType: "date_response",
      message: responseMessageText,
      timestamp: Date.now(),
      is_read: false,
      is_image: false,
      imageUrl: null,
    },
    ID.unique()
  );

  await appwrite.updateDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId,
    { messageCount: currentMessageCount + 1 }
  );

  // Update connection document with response details
  const updatedConnection = await appwrite.updateDocument(
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    connectionId,
    updateData
  );

  return updatedConnection;
};

// Function to fetch all messages for a given connection
const getChatMessages = async (connectionId) => {
  const appwrite = new AppwriteService();
  // Order by timestamp to get messages in chronological order
  const messages = await appwrite.listDocuments(
    APPWRITE_MESSAGES_COLLECTION_ID,
    [
      Query.equal("connectionId", connectionId),
      Query.orderAsc("timestamp"), // Use timestamp for ordering
      Query.limit(200), // Only fetch up to the message limit
    ]
  );

  console.log(messages.total);

  return messages.documents;
};

module.exports = {
  getActiveChats,
  removeChat,
  getChatState,
  sendMessage,
  proposeDate,
  respondToDateProposal,
  getChatMessages,
};
