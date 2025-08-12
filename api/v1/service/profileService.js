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
    APPWRITE_CONNECTIONS_COLLECTION_ID,
    APPWRITE_COMPLETION_STATUS_COLLECTION_ID,
    APPWRITE_PROMPTS_COLLECTION_ID,
    APPWRITE_LANGUAGES_COLLECTION_ID,
    APPWRITE_SETTINGS_COLLECTION_ID
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
        [Query.equal("user", userId)]
    );

    const viewedUserIds = new Set(
        viewedDocs.documents
            .map((doc) => (doc.who ? doc.who.$id : null))
            .filter(Boolean)
    );

    // Get current user preferences from preference collection
    const preference = await appwrite.getDocumentByRelation(
        APPWRITE_PREFERENCE_COLLECTION_ID,
        "user",
        userId
    );
    if (!preference) {
        console.warn(
            `Preferences not found for user: ${userId}. Returning empty profiles.`
        );
        return [];
    }

    // Fetch current user's location
    const currentUserLocationDoc = await appwrite.getDocumentByRelation(
        APPWRITE_LOCATION_COLLECTION_ID,
        "user",
        userId
    );
    if (!currentUserLocationDoc) {
        throw new Error("User location not found");
    }
    const currentUserLatitude = currentUserLocationDoc.latitude;
    const currentUserLongitude = currentUserLocationDoc.longitude;

    // Fetch potential user IDs based on distance and exclude already seen profiles
    const allOtherLocationsRes = await appwrite.listDocuments(
        APPWRITE_LOCATION_COLLECTION_ID,
        [
            Query.notEqual("user", userId),
            Query.limit(5000),
        ]
    );

    const nearbyAndUnseenUserIds = [];
    for (const loc of allOtherLocationsRes.documents) {
        if (!loc.user) continue;

        const potentialUserId = loc.user.$id;

        if (viewedUserIds.has(potentialUserId)) {
            continue;
        }

        const distance = haversine(
            currentUserLatitude,
            currentUserLongitude,
            loc.latitude,
            loc.longitude
        );

        if (!preference.max_distance_km || distance <= preference.max_distance_km) {
            nearbyAndUnseenUserIds.push(potentialUserId);
        }
    }

    if (!nearbyAndUnseenUserIds.length) return [];


    // --- CORRECTED: Add check to prevent DB call with empty array ---
    const candidateUserIdsForSettings = nearbyAndUnseenUserIds.map(id => id).filter(Boolean);
    let settingsRes = { documents: [] };
    if (candidateUserIdsForSettings.length > 0) {
        settingsRes = await appwrite.listDocuments(
            APPWRITE_SETTINGS_COLLECTION_ID,
            [Query.equal('user', candidateUserIdsForSettings), Query.limit(candidateUserIdsForSettings.length)]
        );
    }
    const settingsMap = new Map();
    settingsRes.documents.forEach(doc => {
        if (doc.user) {
            settingsMap.set(doc.user.$id, doc);
        }
    });

    // --- CORRECTED: Filter out users who are in incognito mode ---
    const nonIncognitoUserIds = nearbyAndUnseenUserIds.filter(id => {
        const settings = settingsMap.get(id);
        return !settings || !settings.isIncognito;
    });

    if (!nonIncognitoUserIds.length) return [];


    // Fetch biodata records only for the non-incognito, nearby, unseen users
    const biodataDocsRes = await appwrite.listDocuments(
        APPWRITE_BIODATA_COLLECTION_ID,
        [
            Query.equal("user", nonIncognitoUserIds),
            Query.offset(offset),
            Query.limit(PAGE_SIZE * 2),
        ]
    );
    const biodataDocs = biodataDocsRes.documents;

    const allUserIdsInBiodata = biodataDocs
        .map((bio) => (bio.user ? bio.user.$id : null))
        .filter(Boolean);

    if (allUserIdsInBiodata.length === 0) return [];


    const promptsDocsRes = await appwrite.listDocuments(
        APPWRITE_PROMPTS_COLLECTION_ID,
        [Query.equal('user', allUserIdsInBiodata), Query.limit(allUserIdsInBiodata.length)]
    );
    const promptsMap = new Map();
    promptsDocsRes.documents.forEach(doc => {
        if (doc.user) {
            const promptsArray = [];
            for (let i = 1; i <= 7; i++) {
                promptsArray.push(doc[`answer_${i}`] || null);
            }
            promptsMap.set(doc.user.$id, promptsArray);
        }
    });

    const imageDocsRes = await appwrite.listDocuments(
        APPWRITE_IMAGES_COLLECTION_ID,
        [Query.equal("user", allUserIdsInBiodata), Query.limit(PAGE_SIZE * 2)]
    );
    const imagesMap = new Map();
    imageDocsRes.documents.forEach((img) => {
        if (img.user) {
            const imageUrls = [];
            for (let i = 1; i <= 6; i++) {
                if (img[`image_${i}`]) {
                    imageUrls.push(img[`image_${i}`]);
                }
            }
            imagesMap.set(img.user.$id, imageUrls);
        }
    });

    const uniqueLanguageIds = new Set();
    biodataDocs.forEach(bio => {
        if (Array.isArray(bio.languages)) {
            bio.languages.forEach(lang => {
                if (lang && lang.$id) {
                    uniqueLanguageIds.add(lang.$id);
                }
            });
        }
    });

    const languagesMap = new Map();
    if (uniqueLanguageIds.size > 0) {
        const languagesRes = await appwrite.listDocuments(
            APPWRITE_LANGUAGES_COLLECTION_ID,
            [Query.equal('$id', Array.from(uniqueLanguageIds)), Query.limit(uniqueLanguageIds.size)]
        );
        languagesRes.documents.forEach(doc => languagesMap.set(doc.$id, doc));
    }


    const hobbiesDocsRes = await appwrite.listDocuments(
        APPWRITE_HOBBIES_COLLECTION_ID,
        [Query.limit(100)]
    );
    const hobbiesMap = new Map();
    hobbiesDocsRes.documents.forEach((hobby) => {
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
        if (
            preference.preferred_gender &&
            bio.gender !== preference.preferred_gender
        )
            continue;

        const userHobbyIds = Array.isArray(bio.hobbies)
            ? bio.hobbies.map((h) => (h ? h.$id : null)).filter(Boolean)
            : [];
        const preferredHobbyIds = Array.isArray(preference.preferred_hobbies)
            ? preference.preferred_hobbies.map(h => h ? h.$id : null).filter(Boolean)
            : [];

        const hasCommonHobbies = userHobbyIds.some(hid => preferredHobbyIds.includes(hid));
        if (preferredHobbyIds.length > 0 && !hasCommonHobbies) continue;

        const profileLanguages = Array.isArray(bio.languages)
            ? bio.languages.map(lang => (lang ? languagesMap.get(lang.$id) : null)).filter(Boolean)
            : [];

        // --- NEW: Apply isHideName check ---
        let profileName = bio.name;
        const profileSettings = settingsMap.get(currentProfileUserId);
        if (profileSettings && profileSettings.isHideName) {
            profileName = profileName ? `${profileName[0]}.` : '';
        }

        const profile = {
            userId: currentProfileUserId,
            biodata: { ...bio, name: profileName },
            location: allOtherLocationsRes.documents.find(loc => loc.user && loc.user.$id === currentProfileUserId) || null,
            images: imagesMap.get(currentProfileUserId) || [],
            hobbies: userHobbyIds.map((hid) => hobbiesMap.get(hid)).filter(Boolean),
            languages: profileLanguages,
            prompts: promptsMap.get(currentProfileUserId) || [null, null, null, null, null, null, null],
            settings: profileSettings || { isIncognito: false, isHideName: false }
        };

        filteredProfiles.push(profile);
    }

    // Update has-shown for the profiles actually sent to the client
    for (const profile of filteredProfiles) {
        const existingHasShownRes = await appwrite.listDocuments(
            APPWRITE_HAS_SHOWN_COLLECTION_ID,
            [
                Query.equal("user", userId),
                Query.equal("who", profile.userId),
            ]
        );

        if (existingHasShownRes.documents.length === 0) {
            await appwrite.createDocument(APPWRITE_HAS_SHOWN_COLLECTION_ID, {
                user: userId,
                who: profile.userId,
                is_ignore: false,
                is_interested: false,
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
        [Query.equal("user", currentUserId)]
    );
    const viewedUserIds = new Set(
        viewedDocs.documents
            .map((doc) => (doc.who ? doc.who.$id : null))
            .filter(Boolean)
    );

    // 2. Fetch current user's biodata to get their gender
    const currentUserBiodataRes = await appwrite.listDocuments(
        APPWRITE_BIODATA_COLLECTION_ID,
        [Query.equal("user", currentUserId), Query.limit(1)]
    );
    if (!currentUserBiodataRes.documents.length) {
        return [];
    }
    const currentUserGender = currentUserBiodataRes.documents[0].gender;

    // 3. Fetch all biodata documents (potential candidates), excluding current user
    const allBiodataDocsRes = await appwrite.listDocuments(
        APPWRITE_BIODATA_COLLECTION_ID,
        [
            Query.notEqual("user", currentUserId),
            Query.notEqual("gender", currentUserGender),
            Query.limit(5000),
        ]
    );

    let eligibleBiodataDocs = allBiodataDocsRes.documents.filter((bio) => {
        const userIdFromBiodata = bio.user ? bio.user.$id : null;
        return userIdFromBiodata && !viewedUserIds.has(userIdFromBiodata);
    });

    if (eligibleBiodataDocs.length === 0) {
        return [];
    }

    // --- Filter out users who already have a connection with the current user ---
    const candidateUserIds = eligibleBiodataDocs
        .map((bio) => (bio.user ? bio.user.$id : null))
        .filter(Boolean);

    if (candidateUserIds.length === 0) {
        return [];
    }

    let connectedUserIds = new Set();
    let connectionsAsSenderRes = { documents: [] };
    if (candidateUserIds.length > 0) {
        connectionsAsSenderRes = await appwrite.listDocuments(
            APPWRITE_CONNECTIONS_COLLECTION_ID, [
            Query.equal("senderId", currentUserId),
            Query.equal("receiverId", candidateUserIds),
            Query.limit(5000),
        ]);
    }
    connectionsAsSenderRes.documents.forEach((conn) => {
        if (conn.receiverId && conn.receiverId.$id) {
            connectedUserIds.add(conn.receiverId.$id);
        }
    });

    let connectionsAsReceiverRes = { documents: [] };
    if (candidateUserIds.length > 0) {
        connectionsAsReceiverRes = await appwrite.listDocuments(
            APPWRITE_CONNECTIONS_COLLECTION_ID,
            [
                Query.equal("receiverId", currentUserId),
                Query.equal("senderId", candidateUserIds),
                Query.limit(5000),
            ]
        );
    }
    connectionsAsReceiverRes.documents.forEach((conn) => {
        if (conn.senderId && conn.senderId.$id) {
            connectedUserIds.add(conn.senderId.$id);
        }
    });

    eligibleBiodataDocs = eligibleBiodataDocs.filter((bio) => {
        const userIdFromBiodata = bio.user ? bio.user.$id : null;
        return userIdFromBiodata && !connectedUserIds.has(userIdFromBiodata);
    });

    if (eligibleBiodataDocs.length === 0) {
        return [];
    }

    // --- Filter out users who do not have isAllCompleted === true in completion_status ---
    const eligibleUserIds = eligibleBiodataDocs
        .map((bio) => (bio.user ? bio.user.$id : null))
        .filter(Boolean);

    let completedUserIds = new Set();
    let completionStatusRes = { documents: [] };
    if (eligibleUserIds.length > 0) {
        completionStatusRes = await appwrite.listDocuments(
            APPWRITE_COMPLETION_STATUS_COLLECTION_ID,
            [
                Query.equal("user", eligibleUserIds),
                Query.equal("isAllCompleted", true),
                Query.limit(5000),
            ]
        );
    }
    completionStatusRes.documents.forEach((doc) => {
        if (doc.user && doc.user.$id) {
            completedUserIds.add(doc.user.$id);
        }
    });

    eligibleBiodataDocs = eligibleBiodataDocs.filter((bio) => {
        const userIdFromBiodata = bio.user ? bio.user.$id : null;
        return userIdFromBiodata && completedUserIds.has(userIdFromBiodata);
    });

    if (eligibleBiodataDocs.length === 0) {
        return [];
    }

    // --- NEW: Fetch settings for all candidate users for filtering and masking ---
    const candidateUserIdsForSettings = eligibleBiodataDocs.map(bio => bio.user.$id).filter(Boolean);
    let settingsRes = { documents: [] };
    if (candidateUserIdsForSettings.length > 0) {
        settingsRes = await appwrite.listDocuments(
            APPWRITE_SETTINGS_COLLECTION_ID,
            [Query.equal('user', candidateUserIdsForSettings), Query.limit(candidateUserIdsForSettings.length)]
        );
    }
    const settingsMap = new Map();
    settingsRes.documents.forEach(doc => {
        if (doc.user) {
            settingsMap.set(doc.user.$id, doc);
        }
    });

    // --- NEW: Filter out incognito users from the final list of eligible profiles ---
    eligibleBiodataDocs = eligibleBiodataDocs.filter(bio => {
        const userIdFromBiodata = bio.user ? bio.user.$id : null;
        const settings = settingsMap.get(userIdFromBiodata);
        return !settings || !settings.isIncognito;
    });

    if (eligibleBiodataDocs.length === 0) {
        return [];
    }

    // 4. Shuffle the remaining eligible biodata documents for randomization
    for (let i = eligibleBiodataDocs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [eligibleBiodataDocs[i], eligibleBiodataDocs[j]] = [
            eligibleBiodataDocs[j],
            eligibleBiodataDocs[i],
        ];
    }

    // 5. Select the top 'limit' candidates after shuffling
    const selectedBiodataDocs = eligibleBiodataDocs.slice(0, limit);

    if (selectedBiodataDocs.length === 0) {
        return [];
    }

    const selectedUserIds = selectedBiodataDocs
        .map((bio) => bio.user.$id)
        .filter(Boolean);

    // --- NEW: Fetch all prompts for the selected profiles ---
    const promptsDocsRes = await appwrite.listDocuments(
        APPWRITE_PROMPTS_COLLECTION_ID,
        [Query.equal('user', selectedUserIds), Query.limit(selectedUserIds.length)]
    );
    const promptsMap = new Map();
    promptsDocsRes.documents.forEach(doc => {
        if (doc.user) {
            const promptsArray = [];
            for (let i = 1; i <= 7; i++) {
                promptsArray.push(doc[`answer_${i}`] || null);
            }
            promptsMap.set(doc.user.$id, promptsArray);
        }
    });

    // --- FETCH ALL 6 IMAGES ---
    const locationDocsRes = await appwrite.listDocuments(
        APPWRITE_LOCATION_COLLECTION_ID,
        [Query.equal("user", selectedUserIds), Query.limit(limit)]
    );
    const locationsMap = new Map();
    locationDocsRes.documents.forEach((loc) => {
        if (loc.user) locationsMap.set(loc.user.$id, loc);
    });

    const imageDocsRes = await appwrite.listDocuments(
        APPWRITE_IMAGES_COLLECTION_ID,
        [Query.equal("user", selectedUserIds), Query.limit(limit)]
    );
    const imagesMap = new Map();
    imageDocsRes.documents.forEach((img) => {
        if (img.user) {
            const imageUrls = [];
            for (let i = 1; i <= 6; i++) {
                if (img[`image_${i}`]) {
                    imageUrls.push(img[`image_${i}`]);
                }
            }
            imagesMap.set(img.user.$id, imageUrls);
        }
    });

    // --- NEW: Fetch all languages for mapping ---
    const uniqueLanguageIds = new Set();
    selectedBiodataDocs.forEach(bio => {
        if (Array.isArray(bio.languages)) {
            bio.languages.forEach(lang => {
                if (lang && lang.$id) {
                    uniqueLanguageIds.add(lang.$id);
                }
            });
        }
    });

    const languagesMap = new Map();
    if (uniqueLanguageIds.size > 0) {
        const languagesRes = await appwrite.listDocuments(
            APPWRITE_LANGUAGES_COLLECTION_ID,
            [Query.equal('$id', Array.from(uniqueLanguageIds)), Query.limit(uniqueLanguageIds.size)]
        );
        languagesRes.documents.forEach(doc => languagesMap.set(doc.$id, doc));
    }


    const hobbiesDocsRes = await appwrite.listDocuments(
        APPWRITE_HOBBIES_COLLECTION_ID,
        [Query.equal("$id", selectedBiodataDocs.flatMap(bio => (Array.isArray(bio.hobbies) ? bio.hobbies.map(h => h.$id) : []))), Query.limit(1000)]
    );
    const hobbiesMap = new Map();
    hobbiesDocsRes.documents.forEach((hobby) => {
        hobbiesMap.set(hobby.$id, hobby);
    });

    // 7. Construct the final profiles in the desired format
    const profiles = [];
    for (const bio of selectedBiodataDocs) {
        const profileUserId = bio.user.$id;
        const location = locationsMap.get(profileUserId) || null;
        const userImages = imagesMap.get(profileUserId) || [];

        const userHobbyIds = Array.isArray(bio.hobbies)
            ? bio.hobbies.map((h) => (h ? h.$id : null)).filter(Boolean)
            : [];

        const profileLanguages = Array.isArray(bio.languages)
            ? bio.languages.map(lang => (lang ? languagesMap.get(lang.$id) : null)).filter(Boolean)
            : [];

        // --- NEW: Apply isHideName check ---
        let profileName = bio.name;
        const profileSettings = settingsMap.get(profileUserId);
        if (profileSettings && profileSettings.isHideName) {
            profileName = profileName ? `${profileName[0]}.` : '';
        }

        const profile = {
            userId: profileUserId,
            biodata: { ...bio, name: profileName },
            location: location,
            images: userImages,
            hobbies: userHobbyIds.map((hid) => hobbiesMap.get(hid)).filter(Boolean),
            languages: profileLanguages,
            prompts: promptsMap.get(profileUserId) || [null, null, null, null, null, null, null],
            settings: profileSettings || { isIncognito: false, isHideName: false }
        };

        profiles.push(profile);
    }

    // 8. Update has-shown for the profiles actually returned
    for (const profile of profiles) {
        const existingHasShownRes = await appwrite.listDocuments(
            APPWRITE_HAS_SHOWN_COLLECTION_ID,
            [Query.equal("user", currentUserId), Query.equal("who", profile.userId)]
        );

        if (existingHasShownRes.documents.length === 0) {
            await appwrite.createDocument(APPWRITE_HAS_SHOWN_COLLECTION_ID, {
                user: currentUserId,
                who: profile.userId,
                is_ignore: false,
                is_interested: false,
            });
        }
    }

    console.log(profiles);
    return profiles;
};

module.exports = {
    getNextBatchProfiles,
    getRandomProfilesSimple,
};


