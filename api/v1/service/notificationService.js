const { APPWRITE_NOTIFICATIONS_COLLECTION_ID } = require("../appwrite/appwriteConstants");
const { AppwriteService } = require("../appwrite/appwriteService");

const createNotification = async (receiverUserId,senderUserId, type, payload) => {
  const appwrite = new AppwriteService();
  try {
    await appwrite.createDocument(APPWRITE_NOTIFICATIONS_COLLECTION_ID, {
      to: receiverUserId,
      from: senderUserId,
      type,
      payload,
      is_read: false
    });
  } catch (error) {
    console.error("Error sending invitation notification:", error.message || error);
    throw new Error("Failed to send invitation notification");
  }
};
module.exports = {createNotification}