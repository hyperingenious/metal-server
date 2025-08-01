// api/v1/appwrite/appwriteConstants.js
// This file exports all Appwrite related environment variables and other constants.

const sdk = require("node-appwrite");

const APPWRITE_CLOUD_URL = process.env.APPWRITE_CLOUD_URL;
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID;
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

// All collection IDs
const APPWRITE_REPORTS_COLLECTION_ID = process.env.APPWRITE_REPORTS_COLLECTION_ID;
const APPWRITE_BLOCKED_COLLECTION_ID = process.env.APPWRITE_BLOCKED_COLLECTION_ID;
const APPWRITE_HOBBIES_COLLECTION_ID = process.env.APPWRITE_HOBBIES_COLLECTION_ID;
const APPWRITE_PREFERENCE_COLLECTION_ID = process.env.APPWRITE_PREFERENCE_COLLECTION_ID;
const APPWRITE_HAS_SHOWN_COLLECTION_ID = process.env.APPWRITE_HAS_SHOWN_COLLECTION_ID;
const APPWRITE_MESSAGES_COLLECTION_ID = process.env.APPWRITE_MESSAGES_COLLECTION_ID;
const APPWRITE_NOTIFICATIONS_COLLECTION_ID = process.env.APPWRITE_NOTIFICATIONS_COLLECTION_ID;
const APPWRITE_BIODATA_COLLECTION_ID = process.env.APPWRITE_BIODATA_COLLECTION_ID;
const APPWRITE_LOCATION_COLLECTION_ID = process.env.APPWRITE_LOCATION_COLLECTION_ID;
const APPWRITE_IMAGES_COLLECTION_ID = process.env.APPWRITE_IMAGES_COLLECTION_ID;
const APPWRITE_CONNECTIONS_COLLECTION_ID = process.env.APPWRITE_CONNECTIONS_COLLECTION_ID;
const APPWRITE_USERS_COLLECTION_ID = process.env.APPWRITE_USERS_COLLECTION_ID;
const APPWRITE_MESSAGES_INBOX_COLLECTION_ID = process.env.APPWRITE_MESSAGES_INBOX_COLLECTION_ID
const APPWRITE_COMPLETION_STATUS_COLLECTION_ID = process.env.APPWRITE_COMPLETION_STATUS_COLLECTION_ID

// Ensure all required environment variables are set
if (!APPWRITE_CLOUD_URL || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY || !DATABASE_ID) {
    console.error("Error: Missing one or more required Appwrite environment variables. Please check .env file.");
    process.exit(1); // Exit the process if critical variables are missing
}

// Initializing the Appwrite client
const client = new sdk.Client()
    .setEndpoint(APPWRITE_CLOUD_URL)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

// Initialize Appwrite services
const databases = new sdk.Databases(client);
const account = new sdk.Account(client);

module.exports = {
    // Exporting the initialized services and query object
    databases,
    account,
    query: sdk.Query, // sdk.Query is part of the SDK, not a service instance

    // Exporting all constants for clarity and easy access
    DATABASE_ID,
    APPWRITE_REPORTS_COLLECTION_ID,
    APPWRITE_BLOCKED_COLLECTION_ID,
    APPWRITE_HOBBIES_COLLECTION_ID,
    APPWRITE_PREFERENCE_COLLECTION_ID,
    APPWRITE_HAS_SHOWN_COLLECTION_ID,
    APPWRITE_MESSAGES_COLLECTION_ID,
    APPWRITE_MESSAGES_INBOX_COLLECTION_ID,
    APPWRITE_NOTIFICATIONS_COLLECTION_ID,
    APPWRITE_BIODATA_COLLECTION_ID,
    APPWRITE_LOCATION_COLLECTION_ID,
    APPWRITE_IMAGES_COLLECTION_ID,
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    APPWRITE_USERS_COLLECTION_ID,
    APPWRITE_CLOUD_URL,
    APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY,
    APPWRITE_COMPLETION_STATUS_COLLECTION_ID
};
