// api/v1/service/profileService.js

const { AppwriteService } = require('../appwrite/appwriteService');
const haversine = require('../utils/haversine');
const {
    APPWRITE_HAS_SHOWN_COLLECTION_ID,
    APPWRITE_PREFERENCE_COLLECTION_ID,
    APPWRITE_LOCATION_COLLECTION_ID,
    APPWRITE_BIODATA_COLLECTION_ID,
    APPWRITE_IMAGES_COLLECTION_ID,
    APPWRITE_HOBBIES_COLLECTION_ID
} = require('../appwrite/appwriteConstants');


const PAGE_SIZE = 25;

/**
 * Fetches the next batch of user profiles for exploration based on user preferences and location.
 * @param {string} userId The ID of the current user.
 * @param {number} page The page number for pagination.
 * @returns {Promise<Array>} A list of user profiles.
 */
const getNextBatchProfiles = async (userId, page = 0) => {
    const offset = page * PAGE_SIZE;
    const appwrite = new AppwriteService();

    // Get viewed user IDs from has-shown collection
    const viewedDocs = await appwrite.listDocuments(
        APPWRITE_HAS_SHOWN_COLLECTION_ID,
        [appwrite.query.equal('user', userId)]
    );
    
    const viewedUserIds = new Set(
        viewedDocs.documents
            .map(doc => doc.who ? doc.who.$id : null)
            .filter(Boolean)
    );

    // Get current user preferences from preference collection
    const preference = await appwrite.getDocumentByRelation(
        APPWRITE_PREFERENCE_COLLECTION_ID,
        'user',
        userId
    );
    if (!preference) {
        // If user has no preferences, throw an error or return empty array.
        console.warn(`Preferences not found for user: ${userId}. Returning empty profiles.`);
        return [];
    }

    // Fetch paginated location documents. Fetch more than PAGE_SIZE to allow for filtering.
    const allLocationDocs = await appwrite.listDocuments(
        APPWRITE_LOCATION_COLLECTION_ID,
        [
            appwrite.query.limit(PAGE_SIZE * 3), // Fetch more to allow for filtering
            appwrite.query.offset(offset)
        ]
    );

    // Find current user's location among all fetched locations
    const currentUserLocation = allLocationDocs.documents.find(loc => loc.user && loc.user.$id === userId);
    if (!currentUserLocation) {
        throw new Error('User location not found');
    }


    // Filter nearby users from the fetched location documents
    const nearbyUsers = allLocationDocs.documents
        .filter(loc => {
            if (!loc.user) return false;

            const currentLocUserId = loc.user.$id;

            // Exclude the current user and users who have already been viewed
            if (currentLocUserId === userId || viewedUserIds.has(currentLocUserId)) {
                return false;
            }

            // Calculate distance and filter by max_distance_km preference
            const distance = haversine(
                currentUserLocation.latitude,
                currentUserLocation.longitude,
                loc.latitude,
                loc.longitude
            );

            return !preference.max_distance_km || distance <= preference.max_distance_km;
        })
        .map(loc => loc.user.$id);

    if (!nearbyUsers.length) return [];


    // Fetch biodata records only for the nearby, unseen users
    const biodataDocsRes = await appwrite.listDocuments(
        APPWRITE_BIODATA_COLLECTION_ID,
        [
            appwrite.query.equal('user', Array.from(nearbyUsers)),
            appwrite.query.limit(PAGE_SIZE * 2)
        ]
    );
    const biodataDocs = biodataDocsRes.documents;

    // Fetch enrichment data (images, hobbies) for all potential profiles in the batch
    // Collect all user IDs that have biodata records, with null-check
    const allUserIdsInBiodata = biodataDocs
        .map(bio => bio.user ? bio.user.$id : null)
        .filter(Boolean); // Filters out any null IDs

    // Fetch images for these users
    const imageDocsRes = await appwrite.listDocuments(
        APPWRITE_IMAGES_COLLECTION_ID,
        [appwrite.query.equal('user', allUserIdsInBiodata), appwrite.query.limit(PAGE_SIZE * 2)]
    );
    const imagesMap = new Map();
    imageDocsRes.documents.forEach(img => {
        if (img.image_1 && img.user) {
            imagesMap.set(img.user.$id, img.image_1);
        }
    });

    // Fetch all hobbies for mapping
    const hobbiesDocsRes = await appwrite.listDocuments(
        APPWRITE_HOBBIES_COLLECTION_ID,
        [appwrite.query.limit(1000)]
    );
    const hobbiesMap = new Map();
    hobbiesDocsRes.documents.forEach(hobby => {
        hobbiesMap.set(hobby.$id, hobby); 
    });


    // Final filtering and enrichment of profiles
    const filteredProfiles = [];

    for (const bio of biodataDocs) {
        if (filteredProfiles.length >= PAGE_SIZE) break; // Stop once we have enough profiles

        if (!bio.user) continue;

        // Extract the actual user ID from the biodata relationship object
        const currentProfileUserId = bio.user.$id;

        // Apply preference filters (age, gender, hobbies)
        if (bio.age < preference.min_age || bio.age > preference.max_age) continue;
        if (preference.preferred_gender && bio.gender !== preference.preferred_gender) continue;

        // Process hobbies: bio.hobbies is an array of relationship objects
        const userHobbyIds = Array.isArray(bio.hobbies)
            ? bio.hobbies.map(h => h ? h.$id : null).filter(Boolean)
            : [];
        const preferredHobbyIds = Array.isArray(preference.preferred_hobbies)
            ? preference.preferred_hobbies.map(h => h ? h.$id : null).filter(Boolean)
            : [];

        const hasCommonHobbies = userHobbyIds.some(hid => preferredHobbyIds.includes(hid));
        if (preferredHobbyIds.length > 0 && !hasCommonHobbies) continue;

        // Find location for this specific profile, add null-check for loc.user
        const location = allLocationDocs.documents.find(loc => loc.user && loc.user.$id === currentProfileUserId);
        if (!location) continue; // Skip this profile if its location is somehow missing or unlinked

        // Construct the final profile object
        const profile = {
            userId: currentProfileUserId,
            biodata: bio,
            location: location,
            primaryImage: imagesMap.get(currentProfileUserId) || null,
            hobbies: userHobbyIds.map(hid => hobbiesMap.get(hid)).filter(Boolean)
        };

        filteredProfiles.push(profile);
    }

    // Update has-shown for the profiles actually sent to the client (to mark them as seen)
    for (const profile of filteredProfiles) {
        // Check if has-shown entry already exists for this user-who pair
        const existingHasShown = await appwrite.listDocuments(APPWRITE_HAS_SHOWN_COLLECTION_ID, [
            appwrite.query.equal('user', userId), // Current user
            appwrite.query.equal('who', profile.userId) // Profile being shown
        ]);

        if (existingHasShown.documents.length === 0) {
            // Only create if it doesn't exist to avoid duplicates
            await appwrite.createDocument(APPWRITE_HAS_SHOWN_COLLECTION_ID, {
                user: userId,
                who: profile.userId,
                is_ignore: false,
                is_interested: false
            });
        }
    }

    return filteredProfiles;
};

module.exports = {
    getNextBatchProfiles
};