// api/v1/service/manageIncomingRequestService.js

const { AppwriteService } = require('../appwrite/appwriteService');
const {
    APPWRITE_USERS_COLLECTION_ID,
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    APPWRITE_IMAGES_COLLECTION_ID,
    APPWRITE_HAS_SHOWN_COLLECTION_ID,
} = require('../appwrite/appwriteConstants');
const { MAX_ACTIVE_RECEIVED_INVITATIONS, MAX_ACTIVE_CHATS } = require('../constants/invitationLimits');

/**
 * Fetches active incoming invitations for a given user.
 * @param {string} receiverUserId The ID of the user receiving invitations.
 * @returns {Promise<Array>} A list of incoming invitations.
 */
const getActiveReceivedInvitations = async (receiverUserId) => {
    const appwrite = new AppwriteService();

    const connectionsRes = await appwrite.listDocuments(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        [
            appwrite.query.equal('receiverId', receiverUserId),
            appwrite.query.equal('status', 'pending'),
            appwrite.query.orderAsc('$createdAt'),
            appwrite.query.limit(MAX_ACTIVE_RECEIVED_INVITATIONS)
        ]
    );

    const connections = connectionsRes.documents;
    if (!connections.length) return [];

    const results = [];

    for (const conn of connections) {
        const senderId = conn.senderId.$id;

        let senderUser = null;
        try {
            senderUser = await appwrite.getDocument(APPWRITE_USERS_COLLECTION_ID, senderId);
        } catch (err) {
            console.warn(`No user document found for senderId ${senderId}: ${err.message}`);
        }

        let primaryImage = null;
        try {
            const imageRes = await appwrite.listDocuments(
                APPWRITE_IMAGES_COLLECTION_ID,
                [appwrite.query.equal('user', senderId)]
            );
            primaryImage = imageRes.documents[0]?.image_1 || null;
        } catch (err) {
            console.warn(`No images found for senderId ${senderId}: ${err.message}`);
        }

        results.push({
            connectionId: conn.$id,
            senderId: senderId,
            name: senderUser?.name || 'Unknown',
            primaryImage: primaryImage,
            status: conn.status,
        });
    }

    return results;
};

/**
 * Declines an incoming invitation.
 * @param {string} receiverUserId The ID of the user declining the invitation.
 * @param {string} connectionId The ID of the connection document to decline.
 * @returns {Promise<Object>} Success status.
 */
const declineInvitation = async (receiverUserId, connectionId) => {
    const appwrite = new AppwriteService();

    // Fetch the connection document
    const connectionDoc = await appwrite.getDocument(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        connectionId
    );

    // Security check: Ensure the connection exists, is pending, and belongs to the receiver
    if (!connectionDoc || connectionDoc.status !== 'pending' || connectionDoc.receiverId.$id !== receiverUserId) {
        const error = new Error("Unauthorized or invalid connection for decline");
        error.code = 403; // Forbidden
        throw error;
    }

    const senderUserId = connectionDoc.senderId.$id;
    if (!senderUserId) throw new Error("Sender ID missing in connection");

    // Change connection status to 'declined'
    await appwrite.updateDocument(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        connectionId,
        { status: 'declined' }
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
        console.warn(`Sender user document not found for ID: ${senderUserId} during decline.`);
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
        console.warn(`Receiver user document not found for ID: ${receiverUserId} during decline.`);
    }


    // Update has-shown for both senderId and receiverId to action: 'declined'.
    const hasShownSenderToReceiverDocs = await appwrite.listDocuments(
        APPWRITE_HAS_SHOWN_COLLECTION_ID,
        [
            appwrite.query.equal('user', senderUserId),
            appwrite.query.equal('who', receiverUserId),
        ]
    );
    for (const doc of hasShownSenderToReceiverDocs.documents) {
        await appwrite.updateDocument(
            APPWRITE_HAS_SHOWN_COLLECTION_ID,
            doc.$id,
            { is_ignore: true, is_interested: false }
        );
    }

    const hasShownReceiverToSenderDocs = await appwrite.listDocuments(
        APPWRITE_HAS_SHOWN_COLLECTION_ID,
        [
            appwrite.query.equal('user', receiverUserId),
            appwrite.query.equal('who', senderUserId),
        ]
    );
    for (const doc of hasShownReceiverToSenderDocs.documents) {
        await appwrite.updateDocument(
            APPWRITE_HAS_SHOWN_COLLECTION_ID,
            doc.$id,
            { is_ignore: true, is_interested: false }
        );
    }

    return { success: true };
};

/**
 * Accepts an incoming invitation.
 * @param {string} receiverUserId The ID of the user accepting the invitation.
 * @param {string} connectionId The ID of the connection document to accept.
 * @returns {Promise<Object>} Success status and visibility info.
 */
const acceptInvitation = async (receiverUserId, connectionId) => {
    const appwrite = new AppwriteService();

    // Fetch the connection document
    const connectionDoc = await appwrite.getDocument(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        connectionId
    );


    // Security check: Ensure the connection exists, is pending, and belongs to the receiver.
    if (!connectionDoc || connectionDoc.status !== 'pending' || connectionDoc.receiverId.$id !== receiverUserId) {
        const error = new Error("Unauthorized or invalid connection for accept");
        error.code = 403;
        throw error;
    }

    const senderUserId = connectionDoc.senderId.$id;
    if (!senderUserId) throw new Error("Sender ID missing in connection");

    // Fetch Receiver's activeChatCount
    const receiverUserDoc = await appwrite.getDocument(
        APPWRITE_USERS_COLLECTION_ID,
        receiverUserId
    );
    if (!receiverUserDoc) throw new Error('Receiver user document not found.');

    const receiverActiveChatCount = receiverUserDoc.activeChatCount || 0;

    // Check chat limit
    if (receiverActiveChatCount >= MAX_ACTIVE_CHATS) {
        const error = new Error(`You have ${MAX_ACTIVE_CHATS} active chats. Please remove one to accept this new match.`);
        error.code = 403;
        throw error;
    }

    // If chat limit is OK:
    // Update Connection status to 'chat_active'.
    await appwrite.updateDocument(
        APPWRITE_CONNECTIONS_COLLECTION_ID,
        connectionId,
        {
            status: 'chat_active',
            messageCount: 0,
            dateProposalStatus: 'none',
            dateProposalDate: null,
            dateProposalPlace: null,
            dateProposalProposerId: null,
            dateProposalLastActionBy: null,
        }
    );

    // Decrement activeSentInvitationCount for senderId
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
        console.warn(`Sender user document not found for ID: ${senderUserId} during accept.`);
    }

    // Decrement activeReceivedInvitationCount for receiverId
    const updatedReceivedCount = Math.max(0, (receiverUserDoc.activeReceivedInvitationCount || 0) - 1);
    await appwrite.updateDocument(
        APPWRITE_USERS_COLLECTION_ID,
        receiverUserId,
        { activeReceivedInvitationCount: updatedReceivedCount }
    );


    // Increment activeChatCount for both senderId and receiverId
    const updatedSenderChatCount = (senderUserDoc?.activeChatCount || 0) + 1;
    await appwrite.updateDocument(
        APPWRITE_USERS_COLLECTION_ID,
        senderUserId,
        { activeChatCount: updatedSenderChatCount }
    );

    const updatedReceiverChatCount = (receiverUserDoc.activeChatCount || 0) + 1;
    await appwrite.updateDocument(
        APPWRITE_USERS_COLLECTION_ID,
        receiverUserId,
        { activeChatCount: updatedReceiverChatCount }
    );

    // Updates has-shown for both senderId and receiverId to action: 'chat_active'.
    const hasShownSenderToReceiverDocs = await appwrite.listDocuments(
        APPWRITE_HAS_SHOWN_COLLECTION_ID,
        [
            appwrite.query.equal('user', senderUserId),
            appwrite.query.equal('who', receiverUserId)
        ]
    );
    for (const doc of hasShownSenderToReceiverDocs.documents) {
        await appwrite.updateDocument(
            APPWRITE_HAS_SHOWN_COLLECTION_ID,
            doc.$id,
            { is_ignore: false, is_interested: true }
        );
    }

    const hasShownReceiverToSenderDocs = await appwrite.listDocuments(
        APPWRITE_HAS_SHOWN_COLLECTION_ID,
        [
            appwrite.query.equal('user', receiverUserId),
            appwrite.query.equal('who', senderUserId)
        ]
    );
    for (const doc of hasShownReceiverToSenderDocs.documents) {
        await appwrite.updateDocument(
            APPWRITE_HAS_SHOWN_COLLECTION_ID,
            doc.$id,
            { is_ignore: false, is_interested: true }
        );
    }

    //TODO: Trigger Push Notifications

    return { success: true, newChat: true };
};

module.exports = {
    getActiveReceivedInvitations,
    declineInvitation,
    acceptInvitation,
};