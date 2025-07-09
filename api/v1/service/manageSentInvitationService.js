// api/v1/service/manageSentInvitationService.js

const { AppwriteService } = require('../appwrite/appwriteService');
const {
    APPWRITE_USERS_COLLECTION_ID,
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    APPWRITE_IMAGES_COLLECTION_ID,
    APPWRITE_HAS_SHOWN_COLLECTION_ID,
} = require('../appwrite/appwriteConstants');

const getActiveSentInvitations = async (userId) => {
    const appwrite = new AppwriteService();

    // Fetch all pending connections where current user is sender
    const connectionsRes = await appwrite.listDocuments(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        [
            appwrite.query.equal('senderId', userId), 
            appwrite.query.equal('status', 'pending'),
        ]
    );

    const connections = connectionsRes.documents;
    if (!connections.length) return [];

    const results = [];

    // Loop over each connection to fetch receiver's name and a primary image
    for (const conn of connections) {
        const receiverId = conn.receiverId.$id;

        // Fetch receiver's user document to get their name
        let receiverUser = null;
        try {
            receiverUser = await appwrite.getDocument(APPWRITE_USERS_COLLECTION_ID, receiverId);
        } catch (err) {
            console.warn(`No user document found for receiverId ${receiverId}: ${err.message}`);
        }

        // Fetch a primary image for this receiver, image_1 is primary
        let primaryImage = null;
        try {
            const imageRes = await appwrite.listDocuments(
                APPWRITE_IMAGES_COLLECTION_ID,
                [appwrite.query.equal('user', receiverId)]
            );
            primaryImage = imageRes.documents[0]?.image_1 || null;
        } catch (err) {
            console.warn(`No images found for receiverId ${receiverId}: ${err.message}`);
        }

        results.push({
            connectionId: conn.$id,
            receiverId: receiverId,
            name: receiverUser?.name || 'Unknown',
            primaryImage: primaryImage,
            status: conn.status,
        });
    }

    return results;
};

const removeSentInvitation = async (senderUserId, connectionId) => {
    const appwrite = new AppwriteService();

    // Fetch the connection document
    const connectionDoc = await appwrite.getDocument(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        connectionId
    );

    // Security check: Ensure the connection exists, is pending, and belongs to the sender.
    if (!connectionDoc || connectionDoc.status !== 'pending' || connectionDoc.senderId.$id !== senderUserId) { // <--- Key change
        const error = new Error("Unauthorized or invalid connection");
        error.code = 403;
        throw error;
    }

    const receiverUserId = connectionDoc.receiverId.$id;
    if (!receiverUserId) throw new Error("Receiver ID missing in connection");

    // Update connection status to 'cancelled'
    await appwrite.updateDocument(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        connectionId,
        { status: 'cancelled' }
    );

    // Decrement sender's activeSentInvitationCount
    const senderUserDoc = await appwrite.getDocument(
        APPWRITE_USERS_COLLECTION_ID,
        senderUserId
    );
    if (senderUserDoc) {
        const updatedSentCount = Math.max(0, (senderUserDoc.activeSentInvitationCount || 0) - 1);
        await appwrite.updateDocument(
            APPWRITE_USERS_COLLECTION_ID,
            senderUserId,
            { activeSentInvitationCount: updatedSentCount }
        );
    } else {
        console.warn(`Sender user document not found for ID: ${senderUserId} during remove sent invitation.`);
    }

    // Decrement receiver's activeReceivedInvitationCount
    const receiverUserDoc = await appwrite.getDocument(
        APPWRITE_USERS_COLLECTION_ID,
        receiverUserId
    );
    if (receiverUserDoc) {
        const updatedReceivedCount = Math.max(0, (receiverUserDoc.activeReceivedInvitationCount || 0) - 1);
        await appwrite.updateDocument(
            APPWRITE_USERS_COLLECTION_ID,
            receiverUserId,
            { activeReceivedInvitationCount: updatedReceivedCount }
        );
    } else {
        console.warn(`Receiver user document not found for ID: ${receiverUserId} during remove sent invitation.`);
    }

    // Update has-shown status to 'removed'
    const hasShownDocs = await appwrite.listDocuments(
        APPWRITE_HAS_SHOWN_COLLECTION_ID,
        [
            appwrite.query.equal('user', senderUserId),
            appwrite.query.equal('who', receiverUserId)
        ]
    );
    for (const doc of hasShownDocs.documents) {
        await appwrite.updateDocument(
            APPWRITE_HAS_SHOWN_COLLECTION_ID,
            doc.$id,
            { is_ignore: true, is_interested: false }
        );
    }

    return { success: true };
};

module.exports = {
    getActiveSentInvitations,
    removeSentInvitation
};