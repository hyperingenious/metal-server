// Temporary script to update image URLs in the images collection
// Run with: node temp_update_images.js
// Delete this file after running!

require("dotenv").config();

const {
    databases,
    query,
    DATABASE_ID,
    APPWRITE_IMAGES_COLLECTION_ID,
} = require("./api/v1/appwrite/appwriteConstants");

const NEW_PROJECT_ID = "696d271a00370d723a6c";
const IMAGE_FIELDS = ["image_1", "image_2", "image_3", "image_4", "image_5", "image_6"];

/**
 * Updates a single image URL:
 * - Changes https://fra to https://sgp
 * - Updates the project ID at the end of the URL
 */
function updateImageUrl(url) {
    if (!url || typeof url !== "string") return null;

    // Only process URLs that start with https://fra
    if (!url.startsWith("https://fra")) return null;

    // Replace fra with sgp
    let updatedUrl = url.replace("https://fra", "https://sgp");

    // Replace the project ID at the end (assuming format: .../projects/{projectId}/...)
    // The project ID is typically in the path like: /v1/storage/buckets/.../files/.../view?project=XXXX
    // or it could be in the path structure
    updatedUrl = updatedUrl.replace(/project=[a-zA-Z0-9]+/, `project=${NEW_PROJECT_ID}`);

    // Also handle if project ID is in the path (e.g., /projects/oldProjectId/)
    updatedUrl = updatedUrl.replace(/\/projects\/[a-zA-Z0-9]+/, `/projects/${NEW_PROJECT_ID}`);

    return updatedUrl;
}

async function fetchAllDocuments() {
    const allDocuments = [];
    let offset = 0;
    const limit = 100; // Appwrite max limit per request

    console.log("Fetching documents from images collection...");

    while (true) {
        const response = await databases.listDocuments(
            DATABASE_ID,
            APPWRITE_IMAGES_COLLECTION_ID,
            [query.limit(limit), query.offset(offset)]
        );

        allDocuments.push(...response.documents);
        console.log(`Fetched ${allDocuments.length} documents so far...`);

        if (response.documents.length < limit) {
            break; // No more documents to fetch
        }
        offset += limit;
    }

    return allDocuments;
}

async function updateImagesCollection() {
    try {
        console.log("=".repeat(60));
        console.log("Starting image URL update script...");
        console.log("=".repeat(60));
        console.log(`Target: Change https://fra -> https://sgp`);
        console.log(`New Project ID: ${NEW_PROJECT_ID}`);
        console.log("=".repeat(60));

        // Fetch all documents
        const documents = await fetchAllDocuments();
        console.log(`\nTotal documents fetched: ${documents.length}`);

        let updatedCount = 0;
        let skippedCount = 0;

        for (const doc of documents) {
            const updates = {};
            let hasChanges = false;

            for (const field of IMAGE_FIELDS) {
                const originalUrl = doc[field];

                if (originalUrl && typeof originalUrl === "string" && originalUrl.startsWith("https://fra")) {
                    const updatedUrl = updateImageUrl(originalUrl);
                    if (updatedUrl && updatedUrl !== originalUrl) {
                        updates[field] = updatedUrl;
                        hasChanges = true;
                        console.log(`\n[${doc.$id}] ${field}:`);
                        console.log(`  FROM: ${originalUrl}`);
                        console.log(`  TO:   ${updatedUrl}`);
                    }
                }
            }

            if (hasChanges) {
                await databases.updateDocument(
                    DATABASE_ID,
                    APPWRITE_IMAGES_COLLECTION_ID,
                    doc.$id,
                    updates
                );
                updatedCount++;
                console.log(`  ✓ Updated document ${doc.$id}`);
            } else {
                skippedCount++;
            }
        }

        console.log("\n" + "=".repeat(60));
        console.log("Update complete!");
        console.log(`Documents updated: ${updatedCount}`);
        console.log(`Documents skipped (no changes needed): ${skippedCount}`);
        console.log("=".repeat(60));

    } catch (error) {
        console.error("Error updating images:", error);
        process.exit(1);
    }
}

// Run the script
updateImagesCollection();
