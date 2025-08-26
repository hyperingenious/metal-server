// api/v1/service/invitationService.js

const { AppwriteService } = require('../appwrite/appwriteService');
const { ID } = require('node-appwrite');
const {
    APPWRITE_USERS_COLLECTION_ID,
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    APPWRITE_HAS_SHOWN_COLLECTION_ID,
    messaging,
    FCM_PROVIDER_ID,
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
            const senderUserDoc = await appwrite.getDocument(APPWRITE_USERS_COLLECTION_ID, senderUserId);
            const senderName = senderUserDoc?.name || 'Someone';

            await messaging.createPush(
                ID.unique(),                          // messageId (valid format)
                'New Invitation!',                    // title (string, 1–256 chars)
                `${senderName} has sent you an invitation!💖`, // body
                ['global_notifications'],            // topics
                [],                                    // users (none in this case)
                [],                                    // targets (none in this case)
                {                                      // data payload
                    type: 'new_invitation',
                    senderId: senderUserId,
                    senderName: senderName,
                    receiverId: receiverUserId
                },
                undefined, // action
                undefined, // image
                undefined, // icon
                undefined, // sound
                undefined, // color
                undefined, // tag
                undefined, // badge
                false,     // draft
                undefined, // scheduledAt
                false,     // contentAvailable
                false,     // critical
                'normal'   // priority
            );

            console.log(`Push notification sent to global_notifications for new invitation.`);
        } catch (pushError) {
            console.error(`Failed to send push notification to global_notifications for invitation:`, pushError.message);
        }
        // --- PUSH NOTIFICATION TRIGGER END ---
    }

    return { success: true, visibleToReceiver: isReceiverUnderLimit };
};

module.exports = {
    sendInvitation,
};