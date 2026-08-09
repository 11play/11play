"use strict";

/* =========================================================
   11PLAY — PROFILE BACKEND
   File: functions/lib/profile.js

   Responsibilities:
   - Create one profile for each verified Google user
   - Synchronize Google name, email and photo
   - Generate one permanent unique referral code/link
   - Bind one valid referral during first profile creation
   - Create initial wallet, activity and referral statistics
   - Save and permanently lock the mobile number
   - Update referral eligibility and statistics atomically
   - Ensure the sole Admin profile and referral identity exist
   - Return the sole Admin profile referral link publicly
========================================================= */

const crypto =
    require("crypto");

const {
    getFirestore,
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const {
    getAuth
} = require(
    "firebase-admin/auth"
);

const {
    COLLECTIONS,
    PROFILE_STATUS,
    ACCOUNT_TYPE,
    REFERRAL,
    ACTIVITY,
    SYSTEM,
    ERROR_CODES
} = require(
    "./constants"
);

const {
    isPlainObject,
    normalizeReferralCode,
    isValidReferralCode,
    validateBangladeshMobile,
    normalizeText
} = require(
    "./validators"
);

const {
    ADMIN_EMAIL,
    assertGoogleVerifiedUser,
    createHttpsError,
    throwHttpsError
} = require(
    "./security"
);

/* =========================================================
   PROFILE SETTINGS
========================================================= */

const FALLBACK_REFERRAL_BASE_URL =
    "https://11play.github.io/11play/";

const CONFIGURED_REFERRAL_BASE_URL =
    FALLBACK_REFERRAL_BASE_URL;

const REFERRAL_CODE_ALPHABET =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const REFERRAL_CODE_CREATION_ATTEMPTS =
    20;

const PROFILE_ROLE = Object.freeze({
    ADMIN:
        "admin",

    USER:
        "user"
});

/* =========================================================
   INTERNAL ERROR
========================================================= */

class ReferralCodeCollisionError extends Error {
    constructor(code) {
        super(
            `Referral code collision: ${code}`
        );

        this.name =
            "ReferralCodeCollisionError";

        this.referralCode =
            code;
    }
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

function getRequestData(request) {
    if (
        request &&
        isPlainObject(request.data)
    ) {
        return request.data;
    }

    return {};
}

function toSafeString(value) {
    return normalizeText(value);
}

function normalizeEmail(value) {
    return toSafeString(value)
        .toLowerCase();
}

function toNonNegativeInteger(value) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
        return 0;
    }

    return Math.floor(number);
}

function getUsernameFromEmail(email) {
    const normalizedEmail =
        normalizeEmail(email);

    const atIndex =
        normalizedEmail.indexOf("@");

    if (atIndex <= 0) {
        return "";
    }

    return normalizedEmail
        .slice(0, atIndex);
}

function isAdminEmail(email) {
    return (
        normalizeEmail(email) ===
        normalizeEmail(ADMIN_EMAIL)
    );
}

function isAdminUser(authenticatedUser) {
    return isAdminEmail(
        authenticatedUser?.email
    );
}

function isActiveProfile(profile) {
    const status =
        toSafeString(
            profile?.status
        );

    /*
     * Legacy profiles may not have a status field yet.
     * An explicit suspended or blocked value is still denied.
     */

    return (
        !status ||
        status === PROFILE_STATUS.ACTIVE
    );
}

function createAuthenticatedUserFromUserRecord(
    userRecord
) {
    const providerIds =
        Array.isArray(
            userRecord?.providerData
        )
            ? userRecord.providerData
                  .map(
                      (provider) =>
                          toSafeString(
                              provider
                                  ?.providerId
                          )
                  )
                  .filter(Boolean)
            : [];

    return {
        uid:
            toSafeString(
                userRecord?.uid
            ),

        email:
            normalizeEmail(
                userRecord?.email
            ),

        displayName:
            toSafeString(
                userRecord?.displayName
            ) ||
            getUsernameFromEmail(
                userRecord?.email
            ),

        photoURL:
            toSafeString(
                userRecord?.photoURL
            ),

        emailVerified:
            userRecord
                ?.emailVerified === true,

        providerIds
    };
}

/* =========================================================
   CALLABLE RESPONSE NORMALIZATION

   Firestore Timestamp values are converted to ISO strings
   only in callable responses. Firestore documents continue
   storing native Timestamp values.
========================================================= */

function isTimestampLike(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        typeof value.toDate === "function"
    );
}

function normalizeCallableValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (isTimestampLike(value)) {
        try {
            return value
                .toDate()
                .toISOString();
        } catch {
            return null;
        }
    }

    if (value instanceof Date) {
        const milliseconds =
            value.getTime();

        return Number.isFinite(
            milliseconds
        )
            ? value.toISOString()
            : null;
    }

    if (Array.isArray(value)) {
        return value.map(
            normalizeCallableValue
        );
    }

    if (isPlainObject(value)) {
        const normalizedObject = {};

        Object.entries(value)
            .forEach(
                ([key, nestedValue]) => {
                    normalizedObject[key] =
                        normalizeCallableValue(
                            nestedValue
                        );
                }
            );

        return normalizedObject;
    }

    return value;
}

function normalizeProfileForResponse(
    profile,
    fallbackUid = ""
) {
    const source =
        isPlainObject(profile)
            ? profile
            : {};

    const uid =
        toSafeString(
            source.uid ||
            fallbackUid
        );

    const displayName =
        toSafeString(
            source.displayName ||
            source.name
        );

    const email =
        normalizeEmail(
            source.email
        );

    const photoURL =
        toSafeString(
            source.photoURL ||
            source.photo
        );

    const mobileNumber =
        toSafeString(
            source.mobileNumber
        );

    const registrationDate =
        source.registrationDate ||
        source.createdAt ||
        null;

    const createdAt =
        source.createdAt ||
        source.registrationDate ||
        null;

    const adminProfile =
        isAdminEmail(email);

    const normalizedProfile = {
        ...source,

        uid,

        name:
            displayName,

        displayName,

        username:
            toSafeString(
                source.username
            ) ||
            getUsernameFromEmail(
                email
            ),

        email,

        photo:
            photoURL,

        photoURL,

        googleConnected:
            source.googleConnected !==
                false,

        isGoogleConnected:
            source.isGoogleConnected !==
                false,

        accountType:
            toSafeString(
                source.accountType
            ) ||
            ACCOUNT_TYPE.GOOGLE,

        isAdmin:
            adminProfile,

        role:
            adminProfile
                ? PROFILE_ROLE.ADMIN
                : PROFILE_ROLE.USER,

        mobileNumber,

        mobileAdded:
            source.mobileAdded === true ||
            Boolean(mobileNumber),

        mobileLocked:
            source.mobileLocked === true ||
            Boolean(mobileNumber),

        referralCode:
            normalizeReferralCode(
                source.referralCode ||
                ""
            ),

        referralLink:
            toSafeString(
                source.referralLink
            ),

        referredByUid:
            toSafeString(
                source.referredByUid
            ),

        referredByCode:
            normalizeReferralCode(
                source.referredByCode ||
                ""
            ),

        registrationDate,

        createdAt,

        lastLogin:
            source.lastLogin ||
            null,

        status:
            toSafeString(
                source.status
            ) ||
            PROFILE_STATUS.ACTIVE
    };

    return normalizeCallableValue(
        normalizedProfile
    );
}

/* =========================================================
   FIRESTORE REFERENCES
========================================================= */

function getProfileReference(
    database,
    uid
) {
    return database
        .collection(
            COLLECTIONS.USERS
        )
        .doc(uid);
}

function getReferralCodeReference(
    database,
    referralCode
) {
    return database
        .collection(
            COLLECTIONS
                .REFERRAL_CODES
        )
        .doc(referralCode);
}

function getReferralReference(
    database,
    referredUid
) {
    /*
     * Document ID = referred user UID.
     * Therefore one user can have only one referrer.
     */

    return database
        .collection(
            COLLECTIONS.REFERRALS
        )
        .doc(referredUid);
}

function getReferralStatsReference(
    database,
    uid
) {
    return database
        .collection(
            COLLECTIONS
                .REFERRAL_STATS
        )
        .doc(uid);
}

function getWalletReference(
    database,
    uid
) {
    return database
        .collection(
            COLLECTIONS.WALLETS
        )
        .doc(uid);
}

function getActivityReference(
    database,
    uid
) {
    return database
        .collection(
            COLLECTIONS.ACTIVITY
        )
        .doc(uid);
}

/* =========================================================
   REFERRAL CODE
========================================================= */

function generateReferralCodeCandidate() {
    const bytes =
        crypto.randomBytes(
            REFERRAL.CODE_LENGTH
        );

    let referralCode = "";

    for (
        let index = 0;
        index < REFERRAL.CODE_LENGTH;
        index += 1
    ) {
        referralCode +=
            REFERRAL_CODE_ALPHABET[
                bytes[index] %
                REFERRAL_CODE_ALPHABET
                    .length
            ];
    }

    return referralCode;
}

function normalizeReferralBaseURL(value) {
    const candidates = [
        toSafeString(value),
        FALLBACK_REFERRAL_BASE_URL
    ];

    for (
        const candidate
        of candidates
    ) {
        if (!candidate) {
            continue;
        }

        try {
            const parsedURL =
                new URL(candidate);

            if (
                parsedURL.protocol !==
                "https:"
            ) {
                continue;
            }

            parsedURL.searchParams
                .delete(
                    REFERRAL
                        .QUERY_PARAMETER
                );

            parsedURL.hash = "";

            return parsedURL
                .toString();
        } catch {
            /*
             * Continue to the guaranteed fallback URL.
             */
        }
    }

    return FALLBACK_REFERRAL_BASE_URL;
}

function buildReferralLink(
    referralCode
) {
    const normalizedCode =
        normalizeReferralCode(
            referralCode
        );

    if (
        !isValidReferralCode(
            normalizedCode
        )
    ) {
        throw new Error(
            "A valid referral code is required to build a referral link."
        );
    }

    const baseURL =
        normalizeReferralBaseURL(
            CONFIGURED_REFERRAL_BASE_URL
        );

    const parsedURL =
        new URL(baseURL);

    parsedURL.searchParams.set(
        REFERRAL.QUERY_PARAMETER,
        normalizedCode
    );

    return parsedURL.toString();
}

function getIncomingReferralCode(
    request
) {
    const data =
        getRequestData(request);

    const referralCode =
        normalizeReferralCode(
            data.referralCode ||
            data.ref ||
            ""
        );

    if (
        !referralCode ||
        !isValidReferralCode(
            referralCode
        )
    ) {
        return "";
    }

    return referralCode;
}

/* =========================================================
   INITIAL REFERRAL STATISTICS
========================================================= */

function createInitialReferralStats(
    uid,
    timestamp
) {
    return {
        uid,

        total:
            0,

        pending:
            0,

        qualified:
            0,

        approved:
            0,

        rejected:
            0,

        rewarded:
            0,

        totalReward:
            0,

        createdAt:
            timestamp,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

function readReferralStats(
    snapshot
) {
    if (!snapshot?.exists) {
        return {
            total:
                0,

            pending:
                0,

            qualified:
                0,

            approved:
                0,

            rejected:
                0,

            rewarded:
                0,

            totalReward:
                0
        };
    }

    const existing =
        snapshot.data() || {};

    /*
     * Old field names are read for safe migration.
     */

    return {
        total:
            toNonNegativeInteger(
                existing.total
            ),

        pending:
            toNonNegativeInteger(
                existing.pending ??
                existing.observing
            ),

        qualified:
            toNonNegativeInteger(
                existing.qualified ??
                existing.pendingReview
            ),

        approved:
            toNonNegativeInteger(
                existing.approved ??
                existing.valid
            ),

        rejected:
            toNonNegativeInteger(
                existing.rejected ??
                existing.invalid
            ),

        rewarded:
            toNonNegativeInteger(
                existing.rewarded ??
                existing.valid
            ),

        totalReward:
            toNonNegativeInteger(
                existing.totalReward
            )
    };
}

function createStatsForNewReferral({
    uid,
    snapshot,
    timestamp
}) {
    const current =
        readReferralStats(
            snapshot
        );

    const update = {
        uid,

        total:
            current.total + 1,

        pending:
            current.pending + 1,

        qualified:
            current.qualified,

        approved:
            current.approved,

        rejected:
            current.rejected,

        rewarded:
            current.rewarded,

        totalReward:
            current.totalReward,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };

    if (!snapshot.exists) {
        update.createdAt =
            timestamp;
    }

    return update;
}

function createStatsForQualifiedReferral({
    uid,
    snapshot,
    timestamp
}) {
    const current =
        readReferralStats(
            snapshot
        );

    const update = {
        uid,

        total:
            Math.max(
                current.total,
                1
            ),

        pending:
            Math.max(
                current.pending - 1,
                0
            ),

        qualified:
            current.qualified + 1,

        approved:
            current.approved,

        rejected:
            current.rejected,

        rewarded:
            current.rewarded,

        totalReward:
            current.totalReward,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };

    if (!snapshot.exists) {
        update.createdAt =
            timestamp;
    }

    return update;
}

/* =========================================================
   INITIAL WALLET
========================================================= */

function createInitialWallet(
    uid,
    timestamp
) {
    return {
        uid,

        availableBalance:
            0,

        heldBalance:
            0,

        totalEarned:
            0,

        totalWithdrawn:
            0,

        lastWithdrawalAmount:
            0,

        lastWithdrawalAt:
            null,

        createdAt:
            timestamp,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   INITIAL ACTIVITY
========================================================= */

function createInitialActivity(
    uid,
    timestamp
) {
    return {
        uid,

        totalActiveSeconds:
            0,

        requiredActiveSeconds:
            ACTIVITY
                .REQUIRED_ACTIVE_SECONDS,

        requiredActiveDays:
            ACTIVITY
                .REQUIRED_ACTIVE_DAYS,

        completed:
            false,

        currentSessionId:
            null,

        currentSessionStartedAt:
            null,

        lastHeartbeatAt:
            null,

        completedAt:
            null,

        createdAt:
            timestamp,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   NEW PROFILE DATA
========================================================= */

function createNewProfileData({
    authenticatedUser,
    referralCode,
    referralLink,
    referredByUid = "",
    referredByCode = "",
    timestamp,
    touchLastLogin = true
}) {
    const username =
        getUsernameFromEmail(
            authenticatedUser.email
        );

    const adminProfile =
        isAdminUser(
            authenticatedUser
        );

    return {
        uid:
            authenticatedUser.uid,

        name:
            authenticatedUser
                .displayName,

        displayName:
            authenticatedUser
                .displayName,

        username,

        email:
            authenticatedUser.email,

        photo:
            authenticatedUser
                .photoURL,

        photoURL:
            authenticatedUser
                .photoURL,

        emailVerified:
            authenticatedUser
                .emailVerified,

        providerIds:
            Array.from(
                authenticatedUser
                    .providerIds || []
            ),

        googleConnected:
            true,

        isGoogleConnected:
            true,

        accountType:
            ACCOUNT_TYPE.GOOGLE,

        isAdmin:
            adminProfile,

        role:
            adminProfile
                ? PROFILE_ROLE.ADMIN
                : PROFILE_ROLE.USER,

        mobileNumber:
            "",

        mobileAdded:
            false,

        mobileLocked:
            false,

        referralCode,

        referralLink,

        referredByUid:
            adminProfile
                ? ""
                : referredByUid || "",

        referredByCode:
            adminProfile
                ? ""
                : referredByCode || "",

        registrationDate:
            timestamp,

        createdAt:
            timestamp,

        lastLogin:
            touchLastLogin
                ? timestamp
                : null,

        updatedAt:
            timestamp,

        status:
            PROFILE_STATUS.ACTIVE,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   EXISTING PROFILE SYNCHRONIZATION
========================================================= */

function createProfileSyncData(
    authenticatedUser,
    timestamp,
    existingProfile = {},
    touchLastLogin = true
) {
    const existing =
        isPlainObject(
            existingProfile
        )
            ? existingProfile
            : {};

    const displayName =
        toSafeString(
            authenticatedUser
                .displayName ||
            existing.displayName ||
            existing.name
        );

    const photoURL =
        toSafeString(
            authenticatedUser
                .photoURL ||
            existing.photoURL ||
            existing.photo
        );

    const mobileNumber =
        toSafeString(
            existing.mobileNumber
        );

    const registrationDate =
        existing.registrationDate ||
        existing.createdAt ||
        timestamp;

    const createdAt =
        existing.createdAt ||
        existing.registrationDate ||
        timestamp;

    const adminProfile =
        isAdminUser(
            authenticatedUser
        );

    return {
        uid:
            authenticatedUser.uid,

        name:
            displayName,

        displayName,

        username:
            getUsernameFromEmail(
                authenticatedUser.email
            ),

        email:
            authenticatedUser.email,

        photo:
            photoURL,

        photoURL,

        emailVerified:
            authenticatedUser
                .emailVerified,

        providerIds:
            Array.from(
                authenticatedUser
                    .providerIds || []
            ),

        googleConnected:
            true,

        isGoogleConnected:
            true,

        accountType:
            ACCOUNT_TYPE.GOOGLE,

        isAdmin:
            adminProfile,

        role:
            adminProfile
                ? PROFILE_ROLE.ADMIN
                : PROFILE_ROLE.USER,

        mobileNumber,

        mobileAdded:
            Boolean(mobileNumber),

        mobileLocked:
            Boolean(mobileNumber),

        registrationDate,

        createdAt,

        status:
            toSafeString(
                existing.status
            ) ||
            PROFILE_STATUS.ACTIVE,

        lastLogin:
            touchLastLogin
                ? timestamp
                : existing.lastLogin ||
                  null,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   REFERRAL RECORD
========================================================= */

function createInitialReferralRecord({
    referrerUid,
    referredUser,
    referralCode,
    timestamp
}) {
    return {
        referrerUid,

        referredUid:
            referredUser.uid,

        referralCode,

        referredProfile: {
            uid:
                referredUser.uid,

            name:
                referredUser
                    .displayName,

            displayName:
                referredUser
                    .displayName,

            username:
                getUsernameFromEmail(
                    referredUser.email
                ),

            email:
                referredUser.email,

            photo:
                referredUser
                    .photoURL,

            photoURL:
                referredUser
                    .photoURL,

            mobileNumber:
                "",

            registrationDate:
                timestamp
        },

        googleConnected:
            true,

        mobileAdded:
            false,

        activeSeconds:
            0,

        requiredActiveSeconds:
            ACTIVITY
                .REQUIRED_ACTIVE_SECONDS,

        usingTimeCompleted:
            false,

        eligible:
            false,

        status:
            REFERRAL.STATUS.PENDING,

        rewardAmount:
            REFERRAL.REWARD_AMOUNT,

        rewardGranted:
            false,

        rewardGrantedAt:
            null,

        createdAt:
            timestamp,

        capturedAt:
            timestamp,

        qualifiedAt:
            null,

        reviewedAt:
            null,

        reviewedBy:
            null,

        approvedAt:
            null,

        rejectedAt:
            null,

        rewardedAt:
            null,

        adminNote:
            "",

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   REFERRAL STATUS HELPERS
========================================================= */

function canBecomeQualified(status) {
    return [
        REFERRAL.STATUS.CAPTURED,
        REFERRAL.STATUS.PENDING,

        /*
         * Legacy value supported during migration.
         */

        "observing"
    ].includes(
        toSafeString(status)
    );
}

/* =========================================================
   PROFILE TRANSACTION
========================================================= */

async function runEnsureProfileTransaction({
    database,
    authenticatedUser,
    candidateReferralCode,
    incomingReferralCode,
    touchLastLogin = true
}) {
    const uid =
        authenticatedUser.uid;

    const timestamp =
        Timestamp.now();

    const adminProfile =
        isAdminUser(
            authenticatedUser
        );

    const referralCodeToCapture =
        adminProfile
            ? ""
            : incomingReferralCode;

    const profileRef =
        getProfileReference(
            database,
            uid
        );

    const walletRef =
        getWalletReference(
            database,
            uid
        );

    const userStatsRef =
        getReferralStatsReference(
            database,
            uid
        );

    const activityRef =
        getActivityReference(
            database,
            uid
        );

    const ownReferralRef =
        getReferralReference(
            database,
            uid
        );

    return database.runTransaction(
        async (transaction) => {
            /*
             * All reads must complete before any write.
             */

            const profileSnapshot =
                await transaction.get(
                    profileRef
                );

            const walletSnapshot =
                await transaction.get(
                    walletRef
                );

            const userStatsSnapshot =
                await transaction.get(
                    userStatsRef
                );

            const activitySnapshot =
                await transaction.get(
                    activityRef
                );

            const ownReferralSnapshot =
                await transaction.get(
                    ownReferralRef
                );

            const existingProfile =
                profileSnapshot.exists
                    ? profileSnapshot.data() ||
                      {}
                    : null;

            /*
             * Preserve a valid existing referral code.
             * Generate a new one only when missing, invalid,
             * or owned by another profile.
             */

            const existingReferralCode =
                normalizeReferralCode(
                    existingProfile
                        ?.referralCode ||
                    ""
                );

            let profileReferralCode =
                isValidReferralCode(
                    existingReferralCode
                )
                    ? existingReferralCode
                    : candidateReferralCode;

            let referralCodeIndexRef =
                getReferralCodeReference(
                    database,
                    profileReferralCode
                );

            let referralCodeIndexSnapshot =
                await transaction.get(
                    referralCodeIndexRef
                );

            if (
                referralCodeIndexSnapshot
                    .exists
            ) {
                const indexedOwnerUid =
                    toSafeString(
                        referralCodeIndexSnapshot
                            .data()
                            ?.ownerUid
                    );

                if (
                    indexedOwnerUid !== uid
                ) {
                    if (
                        profileReferralCode ===
                        candidateReferralCode
                    ) {
                        throw new ReferralCodeCollisionError(
                            profileReferralCode
                        );
                    }

                    profileReferralCode =
                        candidateReferralCode;

                    referralCodeIndexRef =
                        getReferralCodeReference(
                            database,
                            profileReferralCode
                        );

                    referralCodeIndexSnapshot =
                        await transaction.get(
                            referralCodeIndexRef
                        );

                    if (
                        referralCodeIndexSnapshot
                            .exists
                    ) {
                        throw new ReferralCodeCollisionError(
                            profileReferralCode
                        );
                    }
                }
            }

            const profileReferralLink =
                buildReferralLink(
                    profileReferralCode
                );

            /*
             * Referral binding is allowed only on the first
             * profile creation. The sole Admin profile can
             * never be registered as somebody else's referral.
             */

            let incomingReferrerUid =
                "";

            let incomingReferralIndexRef =
                null;

            let incomingReferralIndexSnapshot =
                null;

            let incomingReferrerProfileRef =
                null;

            let incomingReferrerProfileSnapshot =
                null;

            let incomingReferrerStatsRef =
                null;

            let incomingReferrerStatsSnapshot =
                null;

            if (
                !adminProfile &&
                !profileSnapshot.exists &&
                !ownReferralSnapshot.exists &&
                referralCodeToCapture
            ) {
                incomingReferralIndexRef =
                    getReferralCodeReference(
                        database,
                        referralCodeToCapture
                    );

                incomingReferralIndexSnapshot =
                    await transaction.get(
                        incomingReferralIndexRef
                    );

                const referralIndexData =
                    incomingReferralIndexSnapshot
                        .exists
                        ? incomingReferralIndexSnapshot
                              .data() || {}
                        : {};

                const indexIsActive =
                    referralIndexData
                        .active !== false;

                const possibleReferrerUid =
                    toSafeString(
                        referralIndexData
                            .ownerUid
                    );

                if (
                    indexIsActive &&
                    possibleReferrerUid &&
                    possibleReferrerUid !== uid
                ) {
                    incomingReferrerProfileRef =
                        getProfileReference(
                            database,
                            possibleReferrerUid
                        );

                    incomingReferrerStatsRef =
                        getReferralStatsReference(
                            database,
                            possibleReferrerUid
                        );

                    incomingReferrerProfileSnapshot =
                        await transaction.get(
                            incomingReferrerProfileRef
                        );

                    incomingReferrerStatsSnapshot =
                        await transaction.get(
                            incomingReferrerStatsRef
                        );

                    const referrerProfile =
                        incomingReferrerProfileSnapshot
                            .exists
                            ? incomingReferrerProfileSnapshot
                                  .data() || {}
                            : null;

                    if (
                        referrerProfile &&
                        isActiveProfile(
                            referrerProfile
                        )
                    ) {
                        incomingReferrerUid =
                            possibleReferrerUid;
                    }
                }
            }

            const referralAccepted =
                Boolean(
                    incomingReferrerUid &&
                    incomingReferrerStatsRef &&
                    incomingReferrerStatsSnapshot &&
                    !ownReferralSnapshot.exists
                );

            /*
             * Profile write.
             */

            if (!profileSnapshot.exists) {
                transaction.create(
                    profileRef,
                    createNewProfileData({
                        authenticatedUser,

                        referralCode:
                            profileReferralCode,

                        referralLink:
                            profileReferralLink,

                        referredByUid:
                            referralAccepted
                                ? incomingReferrerUid
                                : "",

                        referredByCode:
                            referralAccepted
                                ? referralCodeToCapture
                                : "",

                        timestamp,
                        touchLastLogin
                    })
                );
            } else {
                const syncData =
                    createProfileSyncData(
                        authenticatedUser,
                        timestamp,
                        existingProfile,
                        touchLastLogin
                    );

                syncData.referralCode =
                    profileReferralCode;

                syncData.referralLink =
                    profileReferralLink;

                /*
                 * Repair referral ownership fields for
                 * migrated profiles when a referral record
                 * already exists. The Admin is never bound.
                 */

                if (adminProfile) {
                    syncData.referredByUid =
                        "";

                    syncData.referredByCode =
                        "";
                } else if (
                    ownReferralSnapshot.exists
                ) {
                    const ownReferral =
                        ownReferralSnapshot
                            .data() || {};

                    if (
                        !toSafeString(
                            existingProfile
                                .referredByUid
                        )
                    ) {
                        syncData.referredByUid =
                            toSafeString(
                                ownReferral
                                    .referrerUid
                            );
                    }

                    if (
                        !toSafeString(
                            existingProfile
                                .referredByCode
                        )
                    ) {
                        syncData.referredByCode =
                            normalizeReferralCode(
                                ownReferral
                                    .referralCode ||
                                ""
                            );
                    }
                }

                transaction.set(
                    profileRef,
                    syncData,
                    {
                        merge:
                            true
                    }
                );
            }

            /*
             * Permanent referral-code index.
             */

            if (
                !referralCodeIndexSnapshot
                    .exists
            ) {
                transaction.create(
                    referralCodeIndexRef,
                    {
                        code:
                            profileReferralCode,

                        ownerUid:
                            uid,

                        active:
                            true,

                        createdAt:
                            timestamp,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    }
                );
            } else {
                transaction.set(
                    referralCodeIndexRef,
                    {
                        code:
                            profileReferralCode,

                        ownerUid:
                            uid,

                        active:
                            true,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    },
                    {
                        merge:
                            true
                    }
                );
            }

            /*
             * Initial private account documents.
             */

            if (!walletSnapshot.exists) {
                transaction.create(
                    walletRef,
                    createInitialWallet(
                        uid,
                        timestamp
                    )
                );
            }

            if (!userStatsSnapshot.exists) {
                transaction.create(
                    userStatsRef,
                    createInitialReferralStats(
                        uid,
                        timestamp
                    )
                );
            }

            if (!activitySnapshot.exists) {
                transaction.create(
                    activityRef,
                    createInitialActivity(
                        uid,
                        timestamp
                    )
                );
            }

            /*
             * Create the first referral relationship.
             */

            if (referralAccepted) {
                transaction.create(
                    ownReferralRef,
                    createInitialReferralRecord({
                        referrerUid:
                            incomingReferrerUid,

                        referredUser:
                            authenticatedUser,

                        referralCode:
                            referralCodeToCapture,

                        timestamp
                    })
                );

                transaction.set(
                    incomingReferrerStatsRef,
                    createStatsForNewReferral({
                        uid:
                            incomingReferrerUid,

                        snapshot:
                            incomingReferrerStatsSnapshot,

                        timestamp
                    }),
                    {
                        merge:
                            true
                    }
                );
            } else if (
                !adminProfile &&
                ownReferralSnapshot.exists &&
                profileSnapshot.exists
            ) {
                /*
                 * Keep denormalized referral-list profile
                 * information synchronized.
                 */

                transaction.set(
                    ownReferralRef,
                    {
                        "referredProfile.name":
                            authenticatedUser
                                .displayName,

                        "referredProfile.displayName":
                            authenticatedUser
                                .displayName,

                        "referredProfile.username":
                            getUsernameFromEmail(
                                authenticatedUser
                                    .email
                            ),

                        "referredProfile.email":
                            authenticatedUser
                                .email,

                        "referredProfile.photo":
                            authenticatedUser
                                .photoURL,

                        "referredProfile.photoURL":
                            authenticatedUser
                                .photoURL,

                        googleConnected:
                            true,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    },
                    {
                        merge:
                            true
                    }
                );
            }

            const ownReferralData =
                ownReferralSnapshot.exists
                    ? ownReferralSnapshot.data() ||
                      {}
                    : {};

            return {
                created:
                    !profileSnapshot.exists,

                uid,

                isAdmin:
                    adminProfile,

                referralCode:
                    profileReferralCode,

                referralLink:
                    profileReferralLink,

                referralAccepted,

                referredByUid:
                    adminProfile
                        ? ""
                        : referralAccepted
                            ? incomingReferrerUid
                            : toSafeString(
                                  existingProfile
                                      ?.referredByUid ||
                                  ownReferralData
                                      .referrerUid ||
                                  ""
                              ),

                referredByCode:
                    adminProfile
                        ? ""
                        : referralAccepted
                            ? referralCodeToCapture
                            : normalizeReferralCode(
                                  existingProfile
                                      ?.referredByCode ||
                                  ownReferralData
                                      .referralCode ||
                                  ""
                              )
            };
        }
    );
}

/* =========================================================
   TRUSTED PROFILE ENSURE HELPER

   Used by callable profile creation and by the Admin backend.
   The helper is idempotent and repairs missing profile,
   referral-code index, wallet, activity and statistics docs.
========================================================= */

async function ensureProfileForAuthenticatedUser({
    authenticatedUser,
    incomingReferralCode = "",
    touchLastLogin = true
}) {
    const database =
        getFirestore();

    const normalizedIncomingReferralCode =
        isAdminUser(authenticatedUser)
            ? ""
            : normalizeReferralCode(
                  incomingReferralCode
              );

    const validIncomingReferralCode =
        isValidReferralCode(
            normalizedIncomingReferralCode
        )
            ? normalizedIncomingReferralCode
            : "";

    for (
        let attempt = 1;
        attempt <=
            REFERRAL_CODE_CREATION_ATTEMPTS;
        attempt += 1
    ) {
        const candidateReferralCode =
            generateReferralCodeCandidate();

        try {
            const result =
                await runEnsureProfileTransaction({
                    database,

                    authenticatedUser,

                    candidateReferralCode,

                    incomingReferralCode:
                        validIncomingReferralCode,

                    touchLastLogin
                });

            const profileSnapshot =
                await getProfileReference(
                    database,
                    authenticatedUser.uid
                ).get();

            if (!profileSnapshot.exists) {
                throw createHttpsError(
                    ERROR_CODES.INTERNAL,
                    "The synchronized profile could not be loaded."
                );
            }

            return {
                ...result,

                profile:
                    normalizeProfileForResponse(
                        profileSnapshot.data(),
                        authenticatedUser.uid
                    )
            };
        } catch (error) {
            if (
                error instanceof
                ReferralCodeCollisionError
            ) {
                continue;
            }

            throw error;
        }
    }

    throw createHttpsError(
        ERROR_CODES.INTERNAL,
        "A unique referral code could not be generated."
    );
}

/* =========================================================
   ENSURE PROFILE
========================================================= */

async function ensureProfile(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const result =
            await ensureProfileForAuthenticatedUser({
                authenticatedUser,

                incomingReferralCode:
                    getIncomingReferralCode(
                        request
                    )
            });

        console.info(
            "[Profile] Profile synchronized:",
            {
                uid:
                    authenticatedUser.uid,

                isAdmin:
                    result.isAdmin,

                created:
                    result.created,

                referralAccepted:
                    result
                        .referralAccepted
            }
        );

        return {
            success:
                true,

            created:
                result.created,

            referralAccepted:
                result.referralAccepted,

            profile:
                result.profile
        };
    } catch (error) {
        throwHttpsError(
            error,
            "The user profile could not be created."
        );
    }
}

/* =========================================================
   GET CURRENT PROFILE
========================================================= */

async function getMyProfile(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const database =
            getFirestore();

        const profileSnapshot =
            await getProfileReference(
                database,
                authenticatedUser.uid
            ).get();

        if (!profileSnapshot.exists) {
            throw createHttpsError(
                ERROR_CODES.NOT_FOUND,
                "The user profile does not exist."
            );
        }

        return {
            success:
                true,

            profile:
                normalizeProfileForResponse(
                    profileSnapshot.data(),
                    authenticatedUser.uid
                )
        };
    } catch (error) {
        throwHttpsError(
            error,
            "The user profile could not be loaded."
        );
    }
}

/* =========================================================
   GET PUBLIC ADMIN REFERRAL

   This callable function is intentionally public.
   It returns only the sole Admin profile's permanent
   referral code and referral link.

   If the verified Admin Auth account exists but its profile
   or referral index is missing, this function repairs them
   idempotently before returning the public link.

   It never returns:
   - Admin UID
   - Admin email
   - Name or photo
   - Wallet, activity or referral statistics
========================================================= */

async function getPublicAdminReferral() {
    try {
        const database =
            getFirestore();

        let adminUserRecord =
            null;

        try {
            adminUserRecord =
                await getAuth()
                    .getUserByEmail(
                        ADMIN_EMAIL
                    );
        } catch (error) {
            if (
                error?.code ===
                    "auth/user-not-found" ||
                error?.code ===
                    "auth/invalid-email"
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .FAILED_PRECONDITION,

                    "The Admin referral profile is not ready yet."
                );
            }

            throw error;
        }

        const hasGoogleProvider =
            Array.isArray(
                adminUserRecord
                    .providerData
            ) &&
            adminUserRecord
                .providerData
                .some(
                    (provider) =>
                        provider
                            ?.providerId ===
                        "google.com"
                );

        const adminAccountIsValid =
            adminUserRecord.disabled !==
                true &&
            adminUserRecord.emailVerified ===
                true &&
            hasGoogleProvider &&
            isAdminEmail(
                adminUserRecord.email
            );

        if (!adminAccountIsValid) {
            throw createHttpsError(
                ERROR_CODES
                    .FAILED_PRECONDITION,

                "The Admin referral profile is not ready yet."
            );
        }

        const authenticatedAdmin =
            createAuthenticatedUserFromUserRecord(
                adminUserRecord
            );

        let profileSnapshot =
            await getProfileReference(
                database,
                adminUserRecord.uid
            ).get();

        let profile =
            profileSnapshot.exists
                ? profileSnapshot.data() ||
                  {}
                : {};

        let referralCode =
            normalizeReferralCode(
                profile.referralCode ||
                ""
            );

        let referralCodeSnapshot =
            isValidReferralCode(
                referralCode
            )
                ? await getReferralCodeReference(
                      database,
                      referralCode
                  ).get()
                : null;

        let referralCodeData =
            referralCodeSnapshot?.exists
                ? referralCodeSnapshot
                      .data() || {}
                : null;

        let referralCodeIsValid =
            Boolean(
                referralCodeData &&
                referralCodeData
                    .active !== false &&
                toSafeString(
                    referralCodeData
                        .ownerUid
                ) ===
                    adminUserRecord.uid
            );

        const adminProfileNeedsRepair =
            !profileSnapshot.exists ||
            !isActiveProfile(profile) ||
            !isValidReferralCode(
                referralCode
            ) ||
            !referralCodeIsValid ||
            profile.isAdmin !== true ||
            toSafeString(
                profile.role
            ) !== PROFILE_ROLE.ADMIN;

        if (adminProfileNeedsRepair) {
            const ensuredAdmin =
                await ensureProfileForAuthenticatedUser({
                    authenticatedUser:
                        authenticatedAdmin,

                    incomingReferralCode:
                        "",

                    touchLastLogin:
                        false
                });

            profile =
                ensuredAdmin.profile || {};

            referralCode =
                normalizeReferralCode(
                    profile.referralCode ||
                    ""
                );

            referralCodeSnapshot =
                isValidReferralCode(
                    referralCode
                )
                    ? await getReferralCodeReference(
                          database,
                          referralCode
                      ).get()
                    : null;

            referralCodeData =
                referralCodeSnapshot?.exists
                    ? referralCodeSnapshot
                          .data() || {}
                    : null;

            referralCodeIsValid =
                Boolean(
                    referralCodeData &&
                    referralCodeData
                        .active !== false &&
                    toSafeString(
                        referralCodeData
                            .ownerUid
                    ) ===
                        adminUserRecord.uid
                );
        }

        if (!isActiveProfile(profile)) {
            throw createHttpsError(
                ERROR_CODES
                    .FAILED_PRECONDITION,

                "The Admin referral profile is currently unavailable."
            );
        }

        if (
            !isValidReferralCode(
                referralCode
            )
        ) {
            throw createHttpsError(
                ERROR_CODES
                    .FAILED_PRECONDITION,

                "The Admin referral link has not been created yet."
            );
        }

        if (!referralCodeIsValid) {
            throw createHttpsError(
                ERROR_CODES
                    .FAILED_PRECONDITION,

                "The Admin referral link is not available yet."
            );
        }

        const referralLink =
            buildReferralLink(
                referralCode
            );

        return {
            success:
                true,

            referralCode,
            referralLink
        };
    } catch (error) {
        throwHttpsError(
            error,
            "The Admin referral link could not be loaded."
        );
    }
}

/* =========================================================
   SAVE MOBILE NUMBER ONCE
========================================================= */

async function saveMobileNumber(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const data =
            getRequestData(request);

        const mobileNumber =
            validateBangladeshMobile(
                data.mobileNumber ||
                data.mobile ||
                data.number
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const profileRef =
            getProfileReference(
                database,
                authenticatedUser.uid
            );

        const referralRef =
            getReferralReference(
                database,
                authenticatedUser.uid
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    /*
                     * Complete all reads before writes.
                     */

                    const profileSnapshot =
                        await transaction.get(
                            profileRef
                        );

                    const referralSnapshot =
                        await transaction.get(
                            referralRef
                        );

                    if (
                        !profileSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Create the user profile before adding a mobile number."
                        );
                    }

                    const profile =
                        profileSnapshot.data() ||
                        {};

                    if (
                        !isActiveProfile(
                            profile
                        )
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .PERMISSION_DENIED,

                            "This profile cannot currently be updated."
                        );
                    }

                    const referral =
                        referralSnapshot.exists
                            ? referralSnapshot.data() ||
                              {}
                            : null;

                    const referrerUid =
                        toSafeString(
                            referral
                                ?.referrerUid
                        );

                    const referrerStatsRef =
                        referrerUid
                            ? getReferralStatsReference(
                                  database,
                                  referrerUid
                              )
                            : null;

                    const referrerStatsSnapshot =
                        referrerStatsRef
                            ? await transaction.get(
                                  referrerStatsRef
                              )
                            : null;

                    const existingMobile =
                        toSafeString(
                            profile.mobileNumber
                        );

                    const mobileLocked =
                        profile.mobileLocked ===
                            true;

                    /*
                     * Repeating the same number is idempotent.
                     */

                    if (
                        mobileLocked ||
                        existingMobile
                    ) {
                        if (
                            existingMobile ===
                            mobileNumber
                        ) {
                            return {
                                saved:
                                    false,

                                alreadySaved:
                                    true,

                                mobileNumber:
                                    existingMobile,

                                referralQualified:
                                    referral
                                        ?.status ===
                                    REFERRAL.STATUS
                                        .QUALIFIED
                            };
                        }

                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "The mobile number has already been saved and cannot be changed."
                        );
                    }

                    const referralStatus =
                        toSafeString(
                            referral?.status
                        );

                    const shouldQualifyReferral =
                        Boolean(
                            referral &&
                            referral
                                .usingTimeCompleted ===
                                true &&
                            canBecomeQualified(
                                referralStatus
                            )
                        );

                    transaction.update(
                        profileRef,
                        {
                            mobileNumber,

                            mobileAdded:
                                true,

                            mobileLocked:
                                true,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SYSTEM
                                    .SCHEMA_VERSION
                        }
                    );

                    if (referral) {
                        const referralUpdate = {
                            mobileAdded:
                                true,

                            "referredProfile.mobileNumber":
                                mobileNumber,

                            updatedAt:
                                timestamp,

                            schemaVersion:
                                SYSTEM
                                    .SCHEMA_VERSION
                        };

                        if (
                            shouldQualifyReferral
                        ) {
                            referralUpdate.status =
                                REFERRAL.STATUS
                                    .QUALIFIED;

                            referralUpdate.eligible =
                                true;

                            referralUpdate.qualifiedAt =
                                timestamp;
                        }

                        transaction.update(
                            referralRef,
                            referralUpdate
                        );

                        if (
                            shouldQualifyReferral &&
                            referrerStatsRef
                        ) {
                            transaction.set(
                                referrerStatsRef,
                                createStatsForQualifiedReferral({
                                    uid:
                                        referrerUid,

                                    snapshot:
                                        referrerStatsSnapshot,

                                    timestamp
                                }),
                                {
                                    merge:
                                        true
                                }
                            );
                        }
                    }

                    return {
                        saved:
                            true,

                        alreadySaved:
                            false,

                        mobileNumber,

                        referralQualified:
                            shouldQualifyReferral
                    };
                }
            );

        const updatedProfileSnapshot =
            await profileRef.get();

        if (!updatedProfileSnapshot.exists) {
            throw createHttpsError(
                ERROR_CODES.INTERNAL,
                "The updated profile could not be loaded."
            );
        }

        return {
            success:
                true,

            ...result,

            profile:
                normalizeProfileForResponse(
                    updatedProfileSnapshot.data(),
                    authenticatedUser.uid
                )
        };
    } catch (error) {
        throwHttpsError(
            error,
            "The mobile number could not be saved."
        );
    }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    ensureProfile,
    ensureProfileForAuthenticatedUser,
    getMyProfile,
    getPublicAdminReferral,
    saveMobileNumber,

    normalizeProfileForResponse,
    generateReferralCodeCandidate,
    buildReferralLink
});