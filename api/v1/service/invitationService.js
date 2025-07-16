// api/v1/service/invitationService.js

const { AppwriteService } = require('../appwrite/appwriteService');
const {
  APPWRITE_USERS_COLLECTION_ID,
  APPWRITE_CONNECTIONS_COLLECTION_ID,
  APPWRITE_HAS_SHOWN_COLLECTION_ID,
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

  // Update has-shown (sender's view of receiver)
  // const senderHasShown = await appwrite.getDocumentByRelation(APPWRITE_HAS_SHOWN_COLLECTION_ID, 'user', senderUserId);
  // if (senderHasShown) {
  //   await appwrite.updateDocument(APPWRITE_HAS_SHOWN_COLLECTION_ID, senderHasShown.$id, {
  //     is_invited: true,
  //   });
  // }

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

    //TODO: Push Notification Trigger here
  }

  return { success: true, visibleToReceiver: isReceiverUnderLimit };
};



module.exports = {
  sendInvitation,
};
