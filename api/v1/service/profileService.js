// api/v1/service/profileService.js

const { AppwriteService } = require('../appwrite/appwriteService');
const haversine = require('../utils/haversine');
const { Query } = require('node-appwrite');
const {
    APPWRITE_HAS_SHOWN_COLLECTION_ID,
    APPWRITE_PREFERENCE_COLLECTION_ID,
    APPWRITE_LOCATION_COLLECTION_ID,
    APPWRITE_BIODATA_COLLECTION_ID,
    APPWRITE_IMAGES_COLLECTION_ID,
    APPWRITE_HOBBIES_COLLECTION_ID,
    APPWRITE_USERS_COLLECTION_ID
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

    // Fetch current user's location
    const currentUserLocationDoc = await appwrite.getDocumentByRelation(
        APPWRITE_LOCATION_COLLECTION_ID,
        'user',
        userId
    );
    if (!currentUserLocationDoc) {
        throw new Error('User location not found');
    }
    const currentUserLatitude = currentUserLocationDoc.latitude;
    const currentUserLongitude = currentUserLocationDoc.longitude;


    // Fetch potential user IDs based on distance and exclude already seen profiles
    // We fetch ALL location documents (minus current user and viewed) and filter by distance.
    const allOtherLocationsRes = await appwrite.listDocuments(
        APPWRITE_LOCATION_COLLECTION_ID,
        [
            Query.notEqual('user', userId), // Exclude current user's location
            Query.limit(5000) // A large limit, adjust based on expected number of total users.
                              // This fetches all potential candidates to filter by distance and has_shown.
        ]
    );

    const nearbyAndUnseenUserIds = [];
    for (const loc of allOtherLocationsRes.documents) {
        if (!loc.user) continue;

        const potentialUserId = loc.user.$id;

        // Skip if already viewed by the current user
        if (viewedUserIds.has(potentialUserId)) {
            continue;
        }

        // Calculate distance
        const distance = haversine(
            currentUserLatitude,
            currentUserLongitude,
            loc.latitude,
            loc.longitude
        );

        // Filter by max_distance_km preference
        if (!preference.max_distance_km || distance <= preference.max_distance_km) {
            nearbyAndUnseenUserIds.push(potentialUserId);
        }
    }

    if (!nearbyAndUnseenUserIds.length) return [];


    // Fetch biodata records only for the nearby, unseen users, applying pagination offset
    // and limiting to slightly more than PAGE_SIZE to ensure enough candidates after hobby/age/gender filtering
    const biodataDocsRes = await appwrite.listDocuments(
        APPWRITE_BIODATA_COLLECTION_ID,
        [
            Query.equal('user', nearbyAndUnseenUserIds), // Query only among eligible users
            Query.offset(offset),
            Query.limit(PAGE_SIZE * 2) // Fetch more to allow for further filtering
        ]
    );
    const biodataDocs = biodataDocsRes.documents;

    // Collect all user IDs that have biodata records for enrichment
    const allUserIdsInBiodata = biodataDocs
        .map(bio => bio.user ? bio.user.$id : null)
        .filter(Boolean); // Filters out any null IDs

    // If no biodata documents are found for the filtered users, return empty
    if (allUserIdsInBiodata.length === 0) return [];

    // Fetch images for these users
    const imageDocsRes = await appwrite.listDocuments(
        APPWRITE_IMAGES_COLLECTION_ID,
        [Query.equal('user', allUserIdsInBiodata), Query.limit(PAGE_SIZE * 2)]
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
        [Query.limit(100)] 
    );
    const hobbiesMap = new Map();
    hobbiesDocsRes.documents.forEach(hobby => {
        hobbiesMap.set(hobby.$id, hobby);
    });


    // Final filtering and enrichment of profiles based on preferences
    const filteredProfiles = [];

    for (const bio of biodataDocs) {
        if (filteredProfiles.length >= PAGE_SIZE) break;

        if (!bio.user) continue;

        const currentProfileUserId = bio.user.$id;

        // Apply age, gender preferences
        if (bio.age < preference.min_age || bio.age > preference.max_age) continue;
        if (preference.preferred_gender && bio.gender !== preference.preferred_gender) continue;

        // Process hobbies: bio.hobbies is an array of relationship objects
        const userHobbyIds = Array.isArray(bio.hobbies)
            ? bio.hobbies.map(h => h ? h.$id : null).filter(Boolean)
            : [];
        const preferredHobbyIds = Array.isArray(preference.preferred_hobbies)
            ? preference.preferred_hobbies.map(h => h ? h.$id : null).filter(Boolean)
            : [];

        // If preferred hobbies are specified, ensure there's at least one common hobby
        const hasCommonHobbies = userHobbyIds.some(hid => preferredHobbyIds.includes(hid));
        if (preferredHobbyIds.length > 0 && !hasCommonHobbies) continue;

        // Construct the final profile object
        const profile = {
            userId: currentProfileUserId,
            biodata: bio,
            primaryImage: imagesMap.get(currentProfileUserId) || null,
            hobbies: userHobbyIds.map(hid => hobbiesMap.get(hid)).filter(Boolean)
        };

        filteredProfiles.push(profile);
    }

    // Update has-shown for the profiles actually sent to the client
    for (const profile of filteredProfiles) {
        // Query to check if has-shown entry already exists for this user-who pair
        const existingHasShownRes = await appwrite.listDocuments(APPWRITE_HAS_SHOWN_COLLECTION_ID, [
            Query.equal('user', userId), // Current user
            Query.equal('who', profile.userId) // Profile being shown
        ]);

        if (existingHasShownRes.documents.length === 0) {
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

/**
 * Fetches a batch of random user profiles. It includes comprehensive profile data
 * (biodata, location, images, hobbies) and updates the has_shown collection,
 * but DOES NOT apply user preferences for filtering.
 *
 * @param {string} currentUserId The ID of the currently authenticated user (to exclude themselves).
 * @param {number} limit The maximum number of random profiles to return (default: PAGE_SIZE).
 * @returns {Promise<Array>} A list of random user profiles.
 */
const getRandomProfilesSimple = async (currentUserId, limit = PAGE_SIZE) => {
    const appwrite = new AppwriteService();

    // 1. Get viewed user IDs from has-shown collection (still exclude seen profiles)
    const viewedDocs = await appwrite.listDocuments(
        APPWRITE_HAS_SHOWN_COLLECTION_ID,
        [Query.equal('user', currentUserId)]
    );
    const viewedUserIds = new Set(
        viewedDocs.documents
            .map(doc => doc.who ? doc.who.$id : null)
            .filter(Boolean)
    );

    // 2. Fetch all biodata documents (potential candidates), excluding current user and viewed users.
    // Fetch a sufficiently large number to allow for effective randomization.
    const allBiodataDocsRes = await appwrite.listDocuments(
        APPWRITE_BIODATA_COLLECTION_ID,
        [
            Query.notEqual('user', currentUserId), // Exclude the current user
            Query.limit(5000) // Adjust this limit based on your expected total user count.
                             // This is where performance can be an issue with millions of users.
        ]
    );

    let eligibleBiodataDocs = allBiodataDocsRes.documents.filter(bio => {
        const userIdFromBiodata = bio.user ? bio.user.$id : null;
        // Exclude users who are already in the 'viewedUserIds' set
        return userIdFromBiodata && !viewedUserIds.has(userIdFromBiodata);
    });

    // If no eligible profiles, return empty
    if (eligibleBiodataDocs.length === 0) {
        return [];
    }

    // 3. Shuffle the eligible biodata documents for randomization (Fisher-Yates)
    for (let i = eligibleBiodataDocs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [eligibleBiodataDocs[i], eligibleBiodataDocs[j]] = [eligibleBiodataDocs[j], eligibleBiodataDocs[i]];
    }

    // 4. Select the top 'limit' candidates after shuffling
    const selectedBiodataDocs = eligibleBiodataDocs.slice(0, limit);

    // If after slicing, we still have no selected profiles, return empty
    if (selectedBiodataDocs.length === 0) {
        return [];
    }

    const selectedUserIds = selectedBiodataDocs.map(bio => bio.user.$id).filter(Boolean);

    // 5. Fetch all enrichment data for the 'selectedUserIds'
    // Fetch locations for selected users
    const locationDocsRes = await appwrite.listDocuments(
        APPWRITE_LOCATION_COLLECTION_ID,
        [Query.equal('user', selectedUserIds), Query.limit(limit)]
    );
    const locationsMap = new Map();
    locationDocsRes.documents.forEach(loc => {
        if (loc.user) locationsMap.set(loc.user.$id, loc);
    });

    // Fetch images for selected users
    const imageDocsRes = await appwrite.listDocuments(
        APPWRITE_IMAGES_COLLECTION_ID,
        [Query.equal('user', selectedUserIds), Query.limit(limit)]
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
        [Query.limit(100)]
    );
    const hobbiesMap = new Map();
    hobbiesDocsRes.documents.forEach(hobby => {
        hobbiesMap.set(hobby.$id, hobby);
    });

    // 6. Construct the final profiles in the desired format
    const profiles = [];
    for (const bio of selectedBiodataDocs) {
        const profileUserId = bio.user.$id;
        const location = locationsMap.get(profileUserId) || null;
        const primaryImage = imagesMap.get(profileUserId) || null;

        // Process hobbies similar to getNextBatchProfiles
        const userHobbyIds = Array.isArray(bio.hobbies)
            ? bio.hobbies.map(h => h ? h.$id : null).filter(Boolean)
            : [];

        profiles.push({
            userId: profileUserId,
            biodata: bio,
            location: location,
            primaryImage: primaryImage,
            hobbies: userHobbyIds.map(hid => hobbiesMap.get(hid)).filter(Boolean)
        });
    }

    // 7. Update has_shown for the profiles actually returned
    for (const profile of profiles) {
        const existingHasShownRes = await appwrite.listDocuments(APPWRITE_HAS_SHOWN_COLLECTION_ID, [
            Query.equal('user', currentUserId),
            Query.equal('who', profile.userId)
        ]);

        if (existingHasShownRes.documents.length === 0) {
            await appwrite.createDocument(APPWRITE_HAS_SHOWN_COLLECTION_ID, {
                user: currentUserId,
                who: profile.userId,
                is_ignore: false,
                is_interested: false
            });
        }
    }

    return profiles;
};

module.exports = {
    getNextBatchProfiles, // Keep the existing function
    getRandomProfilesSimple // Add the new function
};