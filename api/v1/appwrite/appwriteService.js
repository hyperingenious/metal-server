// api/v1/appwrite/appwriteService.js
// This file contains the AppwriteService class for interacting with Appwrite.

const { databases, query, DATABASE_ID } = require('./appwriteConstants');

class AppwriteService {
    constructor() {
        this.databases = databases;
        this.query = query;
        this.databaseId = DATABASE_ID;
    }

    /**
     * Fetch a single document from a collection using its document ID.
     * @param {string} collectionId The ID of the collection.
     * @param {string} documentId The ID of the document to fetch.
     * @returns {Promise<Object>} The fetched document.
     */
    async getDocument(collectionId, documentId) {
        try {
            return await this.databases.getDocument(this.databaseId, collectionId, documentId);
        } catch (error) {
            console.error(`Error fetching document ${documentId} from collection ${collectionId}:`, error);
            throw error;
        }
    }

    /**
     * Lists documents from a specified collection.
     * @param {string} collectionId The ID of the collection to list documents from.
     * @param {Array} queries An array of query objects
     * @returns {Promise<Object>} A promise that resolves to the list of documents.
     */
    async listDocuments(collectionId, queries = []) {
        try {
            return await this.databases.listDocuments(this.databaseId, collectionId, queries);
        } catch (error) {
            console.error(`Error listing documents in collection ${collectionId}:`, error);
            throw error;
        }
    }

    /**
     * Gets a single document based on a relation key and user ID.
     * Useful for fetching user-specific data from related collections.
     * @param {string} collectionId The ID of the collection to search in.
     * @param {string} relationKey The attribute key that holds the relation (e.g., 'userId').
     * @param {string} userId The ID of the user to match against the relationKey.
     * @returns {Promise<Object|null>} A promise that resolves to the document or null if not found.
     */
    async getDocumentByRelation(collectionId, relationKey, userId) {
        try {
            const res = await this.listDocuments(collectionId, [this.query.equal(relationKey, userId)]);
            return res.documents.length ? res.documents[0] : null;
        } catch (error) {
            console.error(`Error getting document by relation in collection ${collectionId}:`, error);
            throw error;
        }
    }

    /**
     * Creates a new document in a specified collection.
     * @param {string} collectionId The ID of the collection to create the document in.
     * @param {Object} data The data for the new document.
     * @param {string} documentId The document ID to use. If not provided, Appwrite will generate one (or use 'unique()').
     * @returns {Promise<Object>} A promise that resolves to the created document.
     */
    async createDocument(collectionId, data, documentId = 'unique()') {
        try {
            return await this.databases.createDocument(this.databaseId, collectionId, documentId, data);
        } catch (error) {
            console.error(`Error creating document in collection ${collectionId}:`, error);
            throw error;
        }
    }

    /**
     * Updates an existing document in a specified collection.
     * @param {string} collectionId The ID of the collection where the document resides.
     * @param {string} documentId The ID of the document to update.
     * @param {Object} data The new data to update the document with (partial updates are supported).
     * @returns {Promise<Object>} A promise that resolves to the updated document.
     */
    async updateDocument(collectionId, documentId, data) {
        try {
            return await this.databases.updateDocument(this.databaseId, collectionId, documentId, data);
        } catch (error) {
            console.error(`Error updating document ${documentId} in collection ${collectionId}:`, error);
            throw error;
        }
    }

    /**
     * Deletes a document from a specified collection.
     * @param {string} collectionId The ID of the collection.
     * @param {string} documentId The ID of the document to delete.
     * @returns {Promise<Object>} A promise that resolves when the document is deleted.
     */
    async deleteDocument(collectionId, documentId) {
        try {
            return await this.databases.deleteDocument(this.databaseId, collectionId, documentId);
        } catch (error) {
            console.error(`Error deleting document ${documentId} from collection ${collectionId}:`, error);
            throw error;
        }
    }
}

module.exports = {
    AppwriteService,
};
