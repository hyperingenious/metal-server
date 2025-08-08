// api/v1/service/invitationService.js

const { AppwriteService } = require('../appwrite/appwriteService');
const { ID } = require('node-appwrite'); // Import ID for unique message IDs
const {
    APPWRITE_USERS_COLLECTION_ID,
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    APPWRITE_HAS_SHOWN_COLLECTION_ID,
    messaging, // **NEW: Import messaging service**
    FCM_PROVIDER_ID, // **NEW: Import FCM Provider ID**
} = require('../appwrite/appwriteConstants');
const { MAX_ACTIVE_SENT_INVITATIONS, MAX_ACTIVE_RECEIVED_INVITATIONS } = require('../constants/invitationLimits');

const sendInvitation = async (senderUserId, receiverUserId) => {
    const appwrite = new AppwriteService();

    // Fetch Sender's Document
    const sender = await appwrite.getDocumentByRelation(APPWRITE_USERS_COLLECTION_ID, '$id', senderUserId);
    if (!sender) throw new Error('Sender not found');
    if ((sender.activeSentInvitationCount || 0) >= MAX_ACTIVE_SENT_INVITATIONS) {
        const error = new Error('Max active sent invitations reached');
        error.code = 403;
        throw error;
    }

    // Create Connection (pending)
    await appwrite.createDocument(APPWRITE_CONNECTIONS_COLLECTION_ID, {
        senderId: senderUserId,
        receiverId: receiverUserId,
        status: 'pending',
    });

    // Update sender's activeSentInvitationCount
    await appwrite.updateDocument(APPWRITE_USERS_COLLECTION_ID, sender.$id, {
        activeSentInvitationCount: (sender.activeSentInvitationCount || 0) + 1,
    });

    // Update receiver's activeReceivedInvitationCount
    const receiver = await appwrite.getDocumentByRelation(APPWRITE_USERS_COLLECTION_ID, '$id', receiverUserId);
    if (!receiver) throw new Error('Receiver not found');

    const isReceiverUnderLimit = (receiver.activeReceivedInvitationCount || 0) < MAX_ACTIVE_RECEIVED_INVITATIONS;

    if (isReceiverUnderLimit) {
        // Update counter
        await appwrite.updateDocument(APPWRITE_USERS_COLLECTION_ID, receiver.$id, {
            activeReceivedInvitationCount: (receiver.activeReceivedInvitationCount || 0) + 1,
        });

        // Add to receiver's has-shown
        await appwrite.createDocument(APPWRITE_HAS_SHOWN_COLLECTION_ID, {
            user: receiverUserId,
            who: senderUserId,
            is_ignore: false,
            is_interested: true,
        });

        // --- PUSH NOTIFICATION TRIGGER START: Invitation Received ---
        try {
            // Fetch sender's name for the notification message
            const senderUserDoc = await appwrite.getDocument(APPWRITE_USERS_COLLECTION_ID, senderUserId);
            const senderName = senderUserDoc?.name || 'Someone';

            // Send push notification to the receiver
            // Appwrite Messaging targets can be user IDs or topics.
            // A common pattern for user-specific notifications is to subscribe devices
            // to a topic named after the user's ID (e.g., `users_${receiverUserId}`).
            // Ensure your Flutter frontend registers device tokens to such a topic or directly to the user.
            await messaging.createPush(
                ID.unique(), // Unique message ID
                `users_${receiverUserId}`, // Target ID (e.g., a topic for the user)
                'New Invitation!', // Subject (title of the notification)
                `${senderName} has sent you an invitation!`, // Body (content of the notification)
                {
                    data: { // Custom data payload for your app
                        type: 'new_invitation',
                        senderId: senderUserId,
                        senderName: senderName
                    }
                },
                [FCM_PROVIDER_ID] // Specify your configured FCM provider ID
            );
            console.log(`Push notification sent to ${receiverUserId} for new invitation.`);
        } catch (pushError) {
            console.error(`Failed to send push notification to ${receiverUserId} for invitation:`, pushError.message);
            // Don't throw this error, as it shouldn't block the core invitation logic.
            // Push notifications are often "fire and forget" from the main logic's perspective.
        }
        // --- PUSH NOTIFICATION TRIGGER END ---
    }

    return { success: true, visibleToReceiver: isReceiverUnderLimit };
};

module.exports = {
    sendInvitation,
};