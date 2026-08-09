"use strict";

/* =========================================================
   11PLAY — REFERRAL BACKEND
   File: functions/lib/referral.js

   Responsibilities:
   - Return the current user's referral statistics
   - Return the current user's referral records
   - Return qualified referrals to the Admin
   - Verify referral eligibility
   - Approve or reject qualified referrals
   - Credit the referral reward exactly once
   - Update referral statistics atomically
   - Create reward, wallet and audit ledger records

   Referral flow:
   Google Connected
   → Pending
   → Mobile Added
   → Using Time Completed
   → Qualified
   → Admin Approval
   → Reward Credited

   Rejection flow:
   Qualified
   → Rejected
========================================================= */

const {
    getFirestore,
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const {
    COLLECTIONS,
    PROFILE_STATUS,
    REFERRAL,
    ACTIVITY,
    REWARD,
    WALLET,
    ADMIN,
    SYSTEM,
    ERROR_CODES
} = require(
    "./constants"
);

const {
    validateUid,
    validateAdminNote,
    validatePaginationCursor,
    validatePaginationLimit,
    normalizeReferralCode,
    normalizeText
} = require(
    "./validators"
);

const {
    assertGoogleVerifiedUser,
    assertAdmin,
    createHttpsError,
    throwHttpsError
} = require(
    "./security"
);

const {
    getWalletReference,
    getWalletTransactionReference,
    buildWalletTransactionId,
    applyWalletOperationInTransaction
} = require(
    "./wallet"
);

/* =========================================================
   GENERAL HELPERS
========================================================= */

function toSafeString(value) {
    return normalizeText(value);
}

function toSafeNumber(
    value,
    fallback = 0
) {
    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function toNonNegativeInteger(
    value,
    fallback = 0
) {
    return Math.max(
        0,
        Math.floor(
            toSafeNumber(
                value,
                fallback
            )
        )
    );
}

function safeMultiply(
    firstValue,
    secondValue
) {
    const result =
        toNonNegativeInteger(
            firstValue
        ) *
        toNonNegativeInteger(
            secondValue
        );

    return Number.isSafeInteger(
        result
    )
        ? result
        : Number.MAX_SAFE_INTEGER;
}

function isPlainRecord(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function isActiveProfile(profile) {
    if (!isPlainRecord(profile)) {
        return false;
    }

    const status =
        toSafeString(
            profile.status
        ).toLowerCase();

    /*
     * Legacy profiles may not yet contain a status field.
     * Any explicit non-active status is denied.
     */

    return (
        !status ||
        status === PROFILE_STATUS.ACTIVE
    );
}

/* =========================================================
   REFERRAL STATUS

   Legacy status values are normalized during migration.
========================================================= */

function normalizeReferralStatus(value) {
    const status =
        toSafeString(value)
            .toLowerCase();

    const legacyStatusMap =
        Object.freeze({
            observing:
                REFERRAL.STATUS.PENDING,

            pending_review:
                REFERRAL.STATUS.QUALIFIED,

            valid:
                REFERRAL.STATUS.REWARDED,

            invalid:
                REFERRAL.STATUS.REJECTED
        });

    const migratedStatus =
        legacyStatusMap[status] ||
        status;

    return Object
        .values(
            REFERRAL.STATUS
        )
        .includes(
            migratedStatus
        )
        ? migratedStatus
        : "";
}

function requireReferralStatus(
    value,
    fieldName = "status"
) {
    const status =
        normalizeReferralStatus(
            value
        );

    if (!status) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "A valid referral status is required.",
            {
                field:
                    fieldName
            }
        );
    }

    return status;
}

function getStoredStatusesForQuery(
    canonicalStatus
) {
    switch (canonicalStatus) {
        case REFERRAL.STATUS.CAPTURED:
            return [
                REFERRAL.STATUS.CAPTURED
            ];

        case REFERRAL.STATUS.PENDING:
            return [
                REFERRAL.STATUS.PENDING,
                "observing"
            ];

        case REFERRAL.STATUS.QUALIFIED:
            return [
                REFERRAL.STATUS.QUALIFIED,
                "pending_review"
            ];

        case REFERRAL.STATUS.APPROVED:
            return [
                REFERRAL.STATUS.APPROVED
            ];

        case REFERRAL.STATUS.REJECTED:
            return [
                REFERRAL.STATUS.REJECTED,
                "invalid"
            ];

        case REFERRAL.STATUS.REWARDED:
            return [
                REFERRAL.STATUS.REWARDED,
                "valid"
            ];

        default:
            return [];
    }
}

/* =========================================================
   FIRESTORE REFERENCES
========================================================= */

function getProfileReference(
    database,
    uid
) {
    const normalizedUid =
        validateUid(uid);

    return database
        .collection(
            COLLECTIONS.USERS
        )
        .doc(
            normalizedUid
        );
}

function getActivityReference(
    database,
    uid
) {
    const normalizedUid =
        validateUid(uid);

    return database
        .collection(
            COLLECTIONS.ACTIVITY
        )
        .doc(
            normalizedUid
        );
}

function getReferralReference(
    database,
    referralId
) {
    const normalizedReferralId =
        validateUid(
            referralId,
            "referralId"
        );

    return database
        .collection(
            COLLECTIONS.REFERRALS
        )
        .doc(
            normalizedReferralId
        );
}

function getReferralStatsReference(
    database,
    uid
) {
    const normalizedUid =
        validateUid(uid);

    return database
        .collection(
            COLLECTIONS
                .REFERRAL_STATS
        )
        .doc(
            normalizedUid
        );
}

function getRewardEventReference(
    database,
    referralId
) {
    const normalizedReferralId =
        validateUid(
            referralId,
            "referralId"
        );

    return database
        .collection(
            COLLECTIONS.REWARD_EVENTS
        )
        .doc(
            `referral_reward__${normalizedReferralId}`
        );
}

function getAuditLogReference(
    database
) {
    return database
        .collection(
            COLLECTIONS.AUDIT_LOGS
        )
        .doc();
}

/* =========================================================
   TIMESTAMP SERIALIZATION
========================================================= */

function serializeValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        typeof value.toDate ===
        "function"
    ) {
        try {
            return value
                .toDate()
                .toISOString();
        } catch {
            return null;
        }
    }

    if (Array.isArray(value)) {
        return value.map(
            serializeValue
        );
    }

    if (
        typeof value === "object"
    ) {
        const serialized = {};

        for (
            const [
                key,
                nestedValue
            ]
            of Object.entries(value)
        ) {
            serialized[key] =
                serializeValue(
                    nestedValue
                );
        }

        return serialized;
    }

    return value;
}

/* =========================================================
   PRIVATE DATA MASKING
========================================================= */

function maskEmail(value) {
    const email =
        toSafeString(value)
            .toLowerCase();

    const atIndex =
        email.indexOf("@");

    if (atIndex <= 0) {
        return "";
    }

    const localPart =
        email.slice(
            0,
            atIndex
        );

    const domain =
        email.slice(
            atIndex + 1
        );

    if (!domain) {
        return "";
    }

    const visibleLocal =
        localPart.length <= 2
            ? localPart.slice(0, 1)
            : localPart.slice(0, 2);

    return `${visibleLocal}***@${domain}`;
}

function maskMobileNumber(value) {
    const mobile =
        toSafeString(value)
            .replace(
                /\D/g,
                ""
            );

    if (!mobile) {
        return "";
    }

    const visibleDigits =
        mobile.slice(-4);

    return `${"*".repeat(
        Math.max(
            0,
            mobile.length -
            visibleDigits.length
        )
    )}${visibleDigits}`;
}

/* =========================================================
   REFERRAL PROFILE NORMALIZATION
========================================================= */

function normalizeReferralProfile(
    data,
    fallbackData = {},
    uid = "",
    options = {}
) {
    const source =
        isPlainRecord(data)
            ? data
            : {};

    const fallback =
        isPlainRecord(fallbackData)
            ? fallbackData
            : {};

    const {
        includePrivateData = false
    } = options;

    const profileUid =
        toSafeString(
            source.uid ||
            source.userId ||
            source.id ||
            fallback.uid ||
            fallback.userId ||
            fallback.id ||
            uid
        );

    const displayName =
        toSafeString(
            source.displayName ||
            source.name ||
            fallback.displayName ||
            fallback.name
        );

    const email =
        toSafeString(
            source.email ||
            fallback.email
        ).toLowerCase();

    const photoURL =
        toSafeString(
            source.photoURL ||
            source.photo ||
            fallback.photoURL ||
            fallback.photo
        );

    const mobileNumber =
        toSafeString(
            source.mobileNumber ||
            source.mobile ||
            fallback.mobileNumber ||
            fallback.mobile
        );

    const providerIds =
        [
            ...(
                Array.isArray(
                    source.providerIds
                )
                    ? source.providerIds
                    : []
            ),

            ...(
                Array.isArray(
                    fallback.providerIds
                )
                    ? fallback.providerIds
                    : []
            )
        ]
            .map(
                (providerId) =>
                    toSafeString(
                        providerId
                    ).toLowerCase()
            )
            .filter(Boolean);

    return {
        uid:
            profileUid,

        userId:
            profileUid,

        name:
            displayName,

        displayName,

        username:
            toSafeString(
                source.username ||
                fallback.username
            ),

        email:
            includePrivateData
                ? email
                : maskEmail(email),

        photo:
            photoURL,

        photoURL,

        mobileNumber:
            includePrivateData
                ? mobileNumber
                : maskMobileNumber(
                    mobileNumber
                ),

        mobileLocked:
            source.mobileLocked ===
                true ||
            source.mobileNumberLocked ===
                true ||
            fallback.mobileLocked ===
                true ||
            fallback.mobileNumberLocked ===
                true,

        googleConnected:
            source.googleConnected ===
                true ||
            source.isGoogleConnected ===
                true ||
            fallback.googleConnected ===
                true ||
            fallback.isGoogleConnected ===
                true ||
            providerIds.includes(
                "google.com"
            ),

        emailVerified:
            source.emailVerified ===
                true ||
            fallback.emailVerified ===
                true,

        accountType:
            toSafeString(
                source.accountType ||
                fallback.accountType
            ).toLowerCase(),

        referralCode:
            normalizeReferralCode(
                source.referralCode ||
                fallback.referralCode
            ),

        registrationDate:
            source.registrationDate ||
            source.createdAt ||
            fallback.registrationDate ||
            fallback.createdAt ||
            null,

        status:
            toSafeString(
                source.status ||
                fallback.status
            ).toLowerCase()
    };
}

/* =========================================================
   REFERRAL RECORD NORMALIZATION
========================================================= */

function normalizeReferralRecord(
    data,
    id = "",
    options = {}
) {
    const source =
        isPlainRecord(data)
            ? data
            : {};

    const {
        includePrivateData = false,
        includeReferrerProfile = false,
        referrerProfileData = null,
        referredProfileData = null
    } = options;

    const referrerUid =
        toSafeString(
            source.referrerUid
        );

    const referredUid =
        toSafeString(
            source.referredUid
        );

    const referrerProfile =
        normalizeReferralProfile(
            referrerProfileData,
            source.referrerProfile,
            referrerUid,
            {
                includePrivateData
            }
        );

    const referredProfile =
        normalizeReferralProfile(
            referredProfileData,
            source.referredProfile,
            referredUid,
            {
                includePrivateData
            }
        );

    const requiredActiveSeconds =
        toNonNegativeInteger(
            source.requiredActiveSeconds,
            ACTIVITY
                .REQUIRED_ACTIVE_SECONDS
        ) ||
        ACTIVITY
            .REQUIRED_ACTIVE_SECONDS;

    const activeSeconds =
        Math.min(
            requiredActiveSeconds,

            toNonNegativeInteger(
                source.activeSeconds
            )
        );

    let status =
        normalizeReferralStatus(
            source.status
        ) ||
        REFERRAL.STATUS.PENDING;

    if (
        source.rewardGranted === true &&
        (
            status ===
                REFERRAL.STATUS.APPROVED ||
            status ===
                REFERRAL.STATUS.QUALIFIED
        )
    ) {
        status =
            REFERRAL.STATUS.REWARDED;
    }

    const normalizedRecord = {
        id:
            id ||
            referredUid,

        referrerUid,

        referredUid,

        referralCode:
            normalizeReferralCode(
                source.referralCode
            ),

        referredProfile,

        googleConnected:
            source.googleConnected ===
                true,

        mobileAdded:
            source.mobileAdded ===
                true,

        activeSeconds,

        requiredActiveSeconds,

        remainingActiveSeconds:
            Math.max(
                0,
                requiredActiveSeconds -
                activeSeconds
            ),

        usingTimeCompleted:
            source.usingTimeCompleted ===
                true ||
            activeSeconds >=
                requiredActiveSeconds,

        eligible:
            source.eligible ===
                true,

        status,

        rewardAmount:
            toNonNegativeInteger(
                source.rewardAmount,
                REFERRAL.REWARD_AMOUNT
            ),

        rewardGranted:
            source.rewardGranted ===
                true ||
            status ===
                REFERRAL.STATUS.REWARDED,

        rewardGrantedAt:
            source.rewardGrantedAt ||
            source.rewardedAt ||
            null,

        createdAt:
            source.createdAt ||
            null,

        capturedAt:
            source.capturedAt ||
            source.observedAt ||
            null,

        qualifiedAt:
            source.qualifiedAt ||
            source.eligibleAt ||
            null,

        reviewedAt:
            source.reviewedAt ||
            null,

        reviewedBy:
            toSafeString(
                source.reviewedBy
            ),

        approvedAt:
            source.approvedAt ||
            null,

        rejectedAt:
            source.rejectedAt ||
            null,

        rewardedAt:
            source.rewardedAt ||
            source.rewardGrantedAt ||
            null,

        adminNote:
            includePrivateData
                ? toSafeString(
                    source.adminNote
                )
                : "",

        updatedAt:
            source.updatedAt ||
            null
    };

    if (includeReferrerProfile) {
        normalizedRecord.referrerProfile =
            referrerProfile;
    }

    return serializeValue(
        normalizedRecord
    );
}

/* =========================================================
   REFERRAL STATISTICS
========================================================= */

function createEmptyReferralStats(uid) {
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
            null,

        updatedAt:
            null
    };
}

function readReferralStats(data) {
    const source =
        isPlainRecord(data)
            ? data
            : {};

    return {
        total:
            toNonNegativeInteger(
                source.total
            ),

        pending:
            toNonNegativeInteger(
                source.pending ??
                source.observing
            ),

        qualified:
            toNonNegativeInteger(
                source.qualified ??
                source.pendingReview
            ),

        approved:
            toNonNegativeInteger(
                source.approved ??
                source.valid
            ),

        rejected:
            toNonNegativeInteger(
                source.rejected ??
                source.invalid
            ),

        rewarded:
            toNonNegativeInteger(
                source.rewarded ??
                source.valid
            ),

        totalReward:
            toNonNegativeInteger(
                source.totalReward
            )
    };
}

function normalizeReferralStats(
    data,
    uid = ""
) {
    const source =
        isPlainRecord(data)
            ? data
            : {};

    const values =
        readReferralStats(
            source
        );

    return serializeValue({
        uid:
            toSafeString(
                source.uid ||
                uid
            ),

        ...values,

        awaitingCompletion:
            values.pending,

        awaitingAdminReview:
            values.qualified,

        completed:
            values.rewarded +
            values.rejected,

        createdAt:
            source.createdAt ||
            null,

        updatedAt:
            source.updatedAt ||
            null
    });
}

/* =========================================================
   ELIGIBILITY CHECK
========================================================= */

function evaluateReferralEligibility(
    referral
) {
    const source =
        isPlainRecord(referral)
            ? referral
            : {};

    const requiredActiveSeconds =
        toNonNegativeInteger(
            source.requiredActiveSeconds,
            ACTIVITY
                .REQUIRED_ACTIVE_SECONDS
        ) ||
        ACTIVITY
            .REQUIRED_ACTIVE_SECONDS;

    const activeSeconds =
        toNonNegativeInteger(
            source.activeSeconds
        );

    const googleConnected =
        source.googleConnected ===
            true;

    const mobileAdded =
        source.mobileAdded ===
            true;

    const usingTimeCompleted =
        source.usingTimeCompleted ===
            true &&
        activeSeconds >=
            requiredActiveSeconds;

    const eligible =
        googleConnected &&
        mobileAdded &&
        usingTimeCompleted;

    const missingRequirements = [];

    if (!googleConnected) {
        missingRequirements.push(
            "google_connected"
        );
    }

    if (!mobileAdded) {
        missingRequirements.push(
            "mobile_added"
        );
    }

    if (!usingTimeCompleted) {
        missingRequirements.push(
            "using_time_completed"
        );
    }

    return Object.freeze({
        eligible,

        googleConnected,

        mobileAdded,

        usingTimeCompleted,

        activeSeconds,

        requiredActiveSeconds,

        missingRequirements
    });
}

/* =========================================================
   USER: GET REFERRAL STATISTICS
========================================================= */

async function getMyReferralStats(
    request
) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const database =
            getFirestore();

        const snapshot =
            await getReferralStatsReference(
                database,
                authenticatedUser.uid
            ).get();

        const stats =
            snapshot.exists
                ? normalizeReferralStats(
                    snapshot.data(),
                    authenticatedUser.uid
                )
                : createEmptyReferralStats(
                    authenticatedUser.uid
                );

        return {
            success:
                true,

            stats
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Referral statistics could not be loaded."
        );
    }
}

/* =========================================================
   USER: GET REFERRAL RECORDS
========================================================= */

async function getMyReferrals(request) {
    try {
        const authenticatedUser =
            assertGoogleVerifiedUser(
                request
            );

        const rawStatus =
            toSafeString(
                request?.data?.status
            );

        const requestedStatus =
            rawStatus
                ? requireReferralStatus(
                    rawStatus
                )
                : "";

        const cursor =
            validatePaginationCursor(
                request?.data?.cursor
            );

        const resultLimit =
            validatePaginationLimit(
                request?.data?.limit,
                {
                    defaultValue:
                        50,

                    minimum:
                        1,

                    maximum:
                        100
                }
            );

        const database =
            getFirestore();

        let cursorSnapshot =
            null;

        if (cursor) {
            cursorSnapshot =
                await database
                    .collection(
                        COLLECTIONS
                            .REFERRALS
                    )
                    .doc(cursor)
                    .get();

            const cursorReferral =
                cursorSnapshot.exists
                    ? cursorSnapshot.data() ||
                      {}
                    : {};

            const cursorBelongsToUser =
                toSafeString(
                    cursorReferral
                        .referrerUid
                ) ===
                authenticatedUser.uid;

            const cursorMatchesStatus =
                !requestedStatus ||
                normalizeReferralStatus(
                    cursorReferral.status
                ) === requestedStatus;

            if (
                !cursorSnapshot.exists ||
                !cursorBelongsToUser ||
                !cursorMatchesStatus
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,
                    "Referral pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        let baseQuery =
            database
                .collection(
                    COLLECTIONS
                        .REFERRALS
                )
                .where(
                    "referrerUid",
                    "==",
                    authenticatedUser.uid
                );

        if (requestedStatus) {
            const storedStatuses =
                getStoredStatusesForQuery(
                    requestedStatus
                );

            if (
                storedStatuses.length ===
                1
            ) {
                baseQuery =
                    baseQuery.where(
                        "status",
                        "==",
                        storedStatuses[0]
                    );
            } else {
                baseQuery =
                    baseQuery.where(
                        "status",
                        "in",
                        storedStatuses
                    );
            }
        }

        let pageQuery =
            baseQuery.orderBy(
                "createdAt",
                "desc"
            );

        if (cursorSnapshot) {
            pageQuery =
                pageQuery.startAfter(
                    cursorSnapshot
                );
        }

        const snapshot =
            await pageQuery
                .limit(
                    resultLimit + 1
                )
                .get();

        const hasMore =
            snapshot.docs.length >
                resultLimit;

        const pageDocuments =
            hasMore
                ? snapshot.docs.slice(
                    0,
                    resultLimit
                )
                : snapshot.docs;

        const referrals =
            pageDocuments.map(
                (documentSnapshot) =>
                    normalizeReferralRecord(
                        documentSnapshot.data(),
                        documentSnapshot.id,
                        {
                            includePrivateData:
                                false
                        }
                    )
            );

        return {
            success:
                true,

            count:
                referrals.length,

            status:
                requestedStatus,

            referrals,

            hasMore,

            nextCursor:
                hasMore &&
                pageDocuments.length > 0
                    ? pageDocuments[
                        pageDocuments.length - 1
                    ].id
                    : ""
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Referral records could not be loaded."
        );
    }
}

/* =========================================================
   ADMIN: GET QUALIFIED REFERRALS

   Legacy pending_review records are included temporarily.
========================================================= */

async function getPendingReferrals(
    request
) {
    try {
        await assertAdmin(request);

        const cursor =
            validatePaginationCursor(
                request?.data?.cursor
            );

        const resultLimit =
            validatePaginationLimit(
                request?.data?.limit,
                {
                    defaultValue:
                        50,

                    minimum:
                        1,

                    maximum:
                        100
                }
            );

        const database =
            getFirestore();

        let cursorSnapshot =
            null;

        if (cursor) {
            cursorSnapshot =
                await database
                    .collection(
                        COLLECTIONS
                            .REFERRALS
                    )
                    .doc(cursor)
                    .get();

            const cursorStatus =
                cursorSnapshot.exists
                    ? normalizeReferralStatus(
                        cursorSnapshot
                            .data()
                            ?.status
                    )
                    : "";

            if (
                !cursorSnapshot.exists ||
                cursorStatus !==
                    REFERRAL
                        .STATUS
                        .QUALIFIED
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,
                    "Qualified referral pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        const storedStatuses =
            getStoredStatusesForQuery(
                REFERRAL
                    .STATUS
                    .QUALIFIED
            );

        const baseQuery =
            database
                .collection(
                    COLLECTIONS
                        .REFERRALS
                )
                .where(
                    "status",
                    "in",
                    storedStatuses
                );

        let pageQuery =
            baseQuery.orderBy(
                "createdAt",
                "desc"
            );

        if (cursorSnapshot) {
            pageQuery =
                pageQuery.startAfter(
                    cursorSnapshot
                );
        }

        const [
            snapshot,
            totalSnapshot
        ] = await Promise.all([
            pageQuery
                .limit(
                    resultLimit + 1
                )
                .get(),

            baseQuery
                .count()
                .get()
        ]);

        const hasMore =
            snapshot.docs.length >
                resultLimit;

        const pageDocuments =
            hasMore
                ? snapshot.docs.slice(
                    0,
                    resultLimit
                )
                : snapshot.docs;

        const referralRows =
            pageDocuments.map(
                (documentSnapshot) => {
                    const referral =
                        documentSnapshot.data() ||
                        {};

                    return {
                        id:
                            documentSnapshot.id,

                        referral,

                        referrerUid:
                            toSafeString(
                                referral.referrerUid
                            ),

                        referredUid:
                            toSafeString(
                                referral.referredUid ||
                                documentSnapshot.id
                            )
                    };
                }
            );

        const profileUids =
            new Set();

        referralRows.forEach(
            (row) => {
                [
                    row.referrerUid,
                    row.referredUid
                ].forEach(
                    (uid) => {
                        try {
                            profileUids.add(
                                validateUid(uid)
                            );
                        } catch {
                            /*
                             * A malformed legacy identity does not
                             * prevent the remaining queue from loading.
                             */
                        }
                    }
                );
            }
        );

        const profileReferences =
            Array.from(
                profileUids
            ).map(
                (uid) =>
                    getProfileReference(
                        database,
                        uid
                    )
            );

        const profileSnapshots =
            profileReferences.length > 0
                ? await database.getAll(
                    ...profileReferences
                )
                : [];

        const profilesByUid =
            new Map(
                profileSnapshots.map(
                    (profileSnapshot) => [
                        profileSnapshot.id,

                        profileSnapshot.exists
                            ? profileSnapshot.data() ||
                              {}
                            : {}
                    ]
                )
            );

        const referrals =
            referralRows.map(
                (row) =>
                    normalizeReferralRecord(
                        row.referral,
                        row.id,
                        {
                            includePrivateData:
                                true,

                            includeReferrerProfile:
                                true,

                            referrerProfileData:
                                profilesByUid.get(
                                    row.referrerUid
                                ) ||
                                null,

                            referredProfileData:
                                profilesByUid.get(
                                    row.referredUid
                                ) ||
                                null
                        }
                    )
            );

        const total =
            toNonNegativeInteger(
                totalSnapshot
                    .data()
                    ?.count
            );

        return {
            success:
                true,

            count:
                referrals.length,

            total,

            pendingRewardAmount:
                safeMultiply(
                    total,
                    REFERRAL
                        .REWARD_AMOUNT
                ),

            referrals,

            hasMore,

            nextCursor:
                hasMore &&
                pageDocuments.length > 0
                    ? pageDocuments[
                        pageDocuments.length - 1
                    ].id
                    : ""
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Qualified referral records could not be loaded."
        );
    }
}

/* =========================================================
   STATISTICS AFTER ADMIN REVIEW
========================================================= */

function createReviewedStats({
    statsSnapshot,
    referrerUid,
    previousStatus,
    approved,
    rewardAmount,
    timestamp
}) {
    const existingData =
        statsSnapshot.exists
            ? statsSnapshot.data() ||
              {}
            : {};

    const current =
        readReferralStats(
            existingData
        );

    const update = {
        uid:
            referrerUid,

        total:
            Math.max(
                current.total,
                1
            ),

        pending:
            current.pending,

        qualified:
            Math.max(
                current.qualified - 1,
                0
            ),

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

    if (!statsSnapshot.exists) {
        update.createdAt =
            timestamp;
    }

    if (approved) {
        if (
            previousStatus !==
            REFERRAL.STATUS.APPROVED
        ) {
            update.approved =
                current.approved + 1;
        }

        update.rewarded =
            current.rewarded + 1;

        update.totalReward =
            current.totalReward +
            rewardAmount;
    } else {
        update.rejected =
            current.rejected + 1;
    }

    return update;
}

/* =========================================================
   REWARD EVENT
========================================================= */

function createReferralRewardEvent({
    rewardEventId,
    referralId,
    referral,
    referrerUid,
    admin,
    rewardAmount,
    walletTransactionId,
    timestamp
}) {
    return {
        rewardEventId,

        type:
            REWARD.TYPE.REFERRAL,

        status:
            REWARD.STATUS.CREDITED,

        userId:
            referrerUid,

        uid:
            referrerUid,

        referralId,

        referredUid:
            toSafeString(
                referral.referredUid
            ),

        referralCode:
            normalizeReferralCode(
                referral.referralCode
            ),

        amount:
            rewardAmount,

        walletTransactionId,

        approvedBy:
            admin.uid,

        approvedByEmail:
            admin.email,

        approvedAt:
            timestamp,

        creditedAt:
            timestamp,

        createdAt:
            timestamp,

        updatedAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   AUDIT LOG
========================================================= */

function createReferralAuditLog({
    auditId,
    referralId,
    referral,
    admin,
    approved,
    previousStatus,
    finalStatus,
    rewardAmount,
    note,
    walletTransactionId,
    timestamp
}) {
    return {
        auditId,

        action:
            approved
                ? ADMIN.ACTION
                    .REFERRAL_APPROVED
                : ADMIN.ACTION
                    .REFERRAL_REJECTED,

        adminUid:
            admin.uid,

        adminEmail:
            admin.email,

        adminRole:
            admin.role,

        targetUid:
            toSafeString(
                referral.referredUid
            ),

        referrerUid:
            toSafeString(
                referral.referrerUid
            ),

        referralId,

        previousStatus,

        newStatus:
            finalStatus,

        rewardAmount:
            approved
                ? rewardAmount
                : 0,

        walletTransactionId:
            approved
                ? walletTransactionId
                : "",

        note,

        createdAt:
            timestamp,

        schemaVersion:
            SYSTEM.SCHEMA_VERSION
    };
}

/* =========================================================
   ADMIN REVIEW TRANSACTION
========================================================= */

async function reviewReferral(
    request,
    decision
) {
    try {
        const admin =
            await assertAdmin(request);

        const approved =
            decision ===
            REFERRAL.STATUS.APPROVED;

        const rejected =
            decision ===
            REFERRAL.STATUS.REJECTED;

        if (
            !approved &&
            !rejected
        ) {
            throw createHttpsError(
                ERROR_CODES.INVALID_ARGUMENT,
                "Referral review decision is invalid."
            );
        }

        const referralId =
            validateUid(
                request?.data
                    ?.referralId ||
                request?.data
                    ?.referredUid,

                "referralId"
            );

        const adminNote =
            validateAdminNote(
                request?.data
                    ?.adminNote ||
                request?.data
                    ?.note ||
                "",
                {
                    required:
                        rejected,

                    maxLength:
                        500
                }
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const referralRef =
            getReferralReference(
                database,
                referralId
            );

        const auditRef =
            getAuditLogReference(
                database
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const referralSnapshot =
                        await transaction.get(
                            referralRef
                        );

                    if (
                        !referralSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES.NOT_FOUND,
                            "Referral record was not found."
                        );
                    }

                    const referral =
                        referralSnapshot.data() ||
                        {};

                    const currentStatus =
                        normalizeReferralStatus(
                            referral.status
                        );

                    if (
                        approved &&
                        (
                            currentStatus ===
                                REFERRAL.STATUS
                                    .REWARDED ||
                            referral
                                .rewardGranted ===
                                true
                        )
                    ) {
                        return {
                            reviewed:
                                false,

                            alreadyReviewed:
                                true,

                            referralId,

                            status:
                                REFERRAL.STATUS
                                    .REWARDED,

                            rewardGranted:
                                true
                        };
                    }

                    if (
                        rejected &&
                        currentStatus ===
                            REFERRAL.STATUS
                                .REJECTED
                    ) {
                        return {
                            reviewed:
                                false,

                            alreadyReviewed:
                                true,

                            referralId,

                            status:
                                REFERRAL.STATUS
                                    .REJECTED,

                            rewardGranted:
                                false
                        };
                    }

                    if (
                        currentStatus ===
                            REFERRAL.STATUS
                                .REWARDED ||
                        currentStatus ===
                            REFERRAL.STATUS
                                .REJECTED
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "This referral has already received a final decision."
                        );
                    }

                    const approvalAllowed =
                        approved &&
                        (
                            currentStatus ===
                                REFERRAL.STATUS
                                    .QUALIFIED ||
                            currentStatus ===
                                REFERRAL.STATUS
                                    .APPROVED
                        );

                    const rejectionAllowed =
                        rejected &&
                        currentStatus ===
                            REFERRAL.STATUS
                                .QUALIFIED;

                    if (
                        !approvalAllowed &&
                        !rejectionAllowed
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "This referral is not ready for Admin review."
                        );
                    }

                    const referrerUid =
                        validateUid(
                            referral.referrerUid,
                            "referrerUid"
                        );

                    const referredUid =
                        validateUid(
                            referral.referredUid ||
                            referralId,
                            "referredUid"
                        );

                    if (
                        referredUid !==
                            referralId ||
                        referredUid ===
                            referrerUid
                    ) {
                        throw createHttpsError(
                            ERROR_CODES
                                .FAILED_PRECONDITION,

                            "Referral identity data is inconsistent."
                        );
                    }

                    const statsRef =
                        getReferralStatsReference(
                            database,
                            referrerUid
                        );

                    let referrerProfileRef =
                        null;

                    let referredProfileRef =
                        null;

                    let referredActivityRef =
                        null;

                    let referrerProfileSnapshot =
                        null;

                    let referredProfileSnapshot =
                        null;

                    let referredActivitySnapshot =
                        null;

                    if (approved) {
                        referrerProfileRef =
                            getProfileReference(
                                database,
                                referrerUid
                            );

                        referredProfileRef =
                            getProfileReference(
                                database,
                                referredUid
                            );

                        referredActivityRef =
                            getActivityReference(
                                database,
                                referredUid
                            );
                    }

                    const statsSnapshot =
                        await transaction.get(
                            statsRef
                        );

                    if (approved) {
                        [
                            referrerProfileSnapshot,
                            referredProfileSnapshot,
                            referredActivitySnapshot
                        ] = await Promise.all([
                            transaction.get(
                                referrerProfileRef
                            ),

                            transaction.get(
                                referredProfileRef
                            ),

                            transaction.get(
                                referredActivityRef
                            )
                        ]);
                    }

                    let currentEligibility =
                        null;

                    if (approved) {
                        if (
                            !referrerProfileSnapshot.exists ||
                            !referredProfileSnapshot.exists ||
                            !referredActivitySnapshot.exists
                        ) {
                            throw createHttpsError(
                                ERROR_CODES
                                    .FAILED_PRECONDITION,

                                "Current referral account or activity data is incomplete."
                            );
                        }

                        const referrerProfile =
                            referrerProfileSnapshot.data() ||
                            {};

                        const referredProfile =
                            referredProfileSnapshot.data() ||
                            {};

                        const referredActivity =
                            referredActivitySnapshot.data() ||
                            {};

                        const activeSeconds =
                            toNonNegativeInteger(
                                referredActivity
                                    .totalActiveSeconds
                            );

                        const providerIds =
                            Array.isArray(
                                referredProfile
                                    .providerIds
                            )
                                ? referredProfile
                                    .providerIds
                                    .map(
                                        toSafeString
                                    )
                                : [];

                        const googleConnected =
                            referredProfile
                                .emailVerified ===
                                true &&
                            (
                                referredProfile
                                    .googleConnected ===
                                    true ||
                                referredProfile
                                    .isGoogleConnected ===
                                    true ||
                                providerIds.includes(
                                    "google.com"
                                )
                            );

                        const mobileAdded =
                            Boolean(
                                toSafeString(
                                    referredProfile
                                        .mobileNumber
                                )
                            );

                        const usingTimeCompleted =
                            activeSeconds >=
                                ACTIVITY
                                    .REQUIRED_ACTIVE_SECONDS;

                        currentEligibility =
                            evaluateReferralEligibility({
                                googleConnected,

                                mobileAdded,

                                activeSeconds,

                                requiredActiveSeconds:
                                    ACTIVITY
                                        .REQUIRED_ACTIVE_SECONDS,

                                usingTimeCompleted
                            });

                        const missingRequirements =
                            [
                                ...currentEligibility
                                    .missingRequirements
                            ];

                        if (
                            !isActiveProfile(
                                referrerProfile
                            )
                        ) {
                            missingRequirements.push(
                                "referrer_profile_active"
                            );
                        }

                        if (
                            !isActiveProfile(
                                referredProfile
                            )
                        ) {
                            missingRequirements.push(
                                "referred_profile_active"
                            );
                        }

                        if (
                            !currentEligibility
                                .eligible ||
                            missingRequirements.length >
                                0
                        ) {
                            throw createHttpsError(
                                ERROR_CODES
                                    .FAILED_PRECONDITION,

                                "Referral requirements are incomplete or an account is not active.",
                                {
                                    missingRequirements:
                                        Array.from(
                                            new Set(
                                                missingRequirements
                                            )
                                        ),

                                    activeSeconds:
                                        currentEligibility
                                            .activeSeconds,

                                    requiredActiveSeconds:
                                        currentEligibility
                                            .requiredActiveSeconds
                                }
                            );
                        }
                    }

                    const rewardAmount =
                        REFERRAL
                            .REWARD_AMOUNT;

                    let walletResult =
                        null;

                    let walletTransactionId =
                        "";

                    let walletRef =
                        null;

                    let walletSnapshot =
                        null;

                    let ledgerRef =
                        null;

                    let ledgerSnapshot =
                        null;

                    let rewardEventRef =
                        null;

                    let rewardEventSnapshot =
                        null;

                    if (approved) {
                        walletRef =
                            getWalletReference(
                                database,
                                referrerUid
                            );

                        walletTransactionId =
                            buildWalletTransactionId({
                                type:
                                    WALLET
                                        .TRANSACTION_TYPE
                                        .REFERRAL_REWARD,

                                referenceId:
                                    referralId
                            });

                        ledgerRef =
                            getWalletTransactionReference(
                                database,
                                walletTransactionId
                            );

                        rewardEventRef =
                            getRewardEventReference(
                                database,
                                referralId
                            );

                        [
                            walletSnapshot,
                            ledgerSnapshot,
                            rewardEventSnapshot
                        ] = await Promise.all([
                            transaction.get(
                                walletRef
                            ),

                            transaction.get(
                                ledgerRef
                            ),

                            transaction.get(
                                rewardEventRef
                            )
                        ]);

                        if (
                            ledgerSnapshot.exists ||
                            rewardEventSnapshot.exists
                        ) {
                            throw createHttpsError(
                                ERROR_CODES
                                    .FAILED_PRECONDITION,

                                "The referral reward has already been processed."
                            );
                        }
                    }

                    /*
                     * All transaction reads are complete.
                     */

                    if (approved) {
                        walletResult =
                            applyWalletOperationInTransaction({
                                transaction,

                                walletRef,
                                walletSnapshot,

                                ledgerRef,
                                ledgerSnapshot,

                                userId:
                                    referrerUid,

                                type:
                                    WALLET
                                        .TRANSACTION_TYPE
                                        .REFERRAL_REWARD,

                                direction:
                                    WALLET
                                        .TRANSACTION_DIRECTION
                                        .CREDIT,

                                amount:
                                    rewardAmount,

                                referenceId:
                                    referralId,

                                timestamp,

                                adminUid:
                                    admin.uid,

                                note:
                                    adminNote,

                                metadata: {
                                    source:
                                        "referral_approval",

                                    referredUid:
                                        referredUid,

                                    referralCode:
                                        normalizeReferralCode(
                                            referral
                                                .referralCode
                                        )
                                }
                            });

                        transaction.create(
                            rewardEventRef,
                            createReferralRewardEvent({
                                rewardEventId:
                                    rewardEventRef.id,

                                referralId,

                                referral,

                                referrerUid,

                                admin,

                                rewardAmount,

                                walletTransactionId,

                                timestamp
                            })
                        );
                    }

                    const finalStatus =
                        approved
                            ? REFERRAL
                                .STATUS
                                .REWARDED
                            : REFERRAL
                                .STATUS
                                .REJECTED;

                    const referralUpdate = {
                        status:
                            finalStatus,

                        reviewedAt:
                            timestamp,

                        reviewedBy:
                            admin.uid,

                        adminNote,

                        updatedAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    };

                    if (approved) {
                        referralUpdate.googleConnected =
                            currentEligibility
                                .googleConnected;

                        referralUpdate.mobileAdded =
                            currentEligibility
                                .mobileAdded;

                        referralUpdate.activeSeconds =
                            currentEligibility
                                .activeSeconds;

                        referralUpdate.requiredActiveSeconds =
                            ACTIVITY
                                .REQUIRED_ACTIVE_SECONDS;

                        referralUpdate.usingTimeCompleted =
                            currentEligibility
                                .usingTimeCompleted;

                        referralUpdate.eligible =
                            true;

                        referralUpdate.approvedAt =
                            referral.approvedAt ||
                            timestamp;

                        referralUpdate.rejectedAt =
                            null;

                        referralUpdate.rewardAmount =
                            rewardAmount;

                        referralUpdate.rewardGranted =
                            true;

                        referralUpdate.rewardGrantedAt =
                            timestamp;

                        referralUpdate.rewardedAt =
                            timestamp;

                        referralUpdate.walletTransactionId =
                            walletTransactionId;
                    } else {
                        referralUpdate.rejectedAt =
                            timestamp;

                        referralUpdate.approvedAt =
                            null;

                        referralUpdate.rewardGranted =
                            false;

                        referralUpdate.rewardGrantedAt =
                            null;

                        referralUpdate.rewardedAt =
                            null;

                        referralUpdate.walletTransactionId =
                            "";
                    }

                    transaction.set(
                        referralRef,
                        referralUpdate,
                        {
                            merge:
                                true
                        }
                    );

                    transaction.set(
                        statsRef,
                        createReviewedStats({
                            statsSnapshot,

                            referrerUid,

                            previousStatus:
                                currentStatus,

                            approved,

                            rewardAmount,

                            timestamp
                        }),
                        {
                            merge:
                                true
                        }
                    );

                    transaction.create(
                        auditRef,
                        createReferralAuditLog({
                            auditId:
                                auditRef.id,

                            referralId,

                            referral,

                            admin,

                            approved,

                            previousStatus:
                                currentStatus,

                            finalStatus,

                            rewardAmount,

                            note:
                                adminNote,

                            walletTransactionId,

                            timestamp
                        })
                    );

                    return {
                        reviewed:
                            true,

                        alreadyReviewed:
                            false,

                        referralId,

                        referrerUid,

                        referredUid,

                        status:
                            finalStatus,

                        rewardAmount:
                            approved
                                ? rewardAmount
                                : 0,

                        rewardGranted:
                            approved,

                        wallet:
                            walletResult
                                ?.wallet ||
                            null,

                        walletTransactionId:
                            approved
                                ? walletTransactionId
                                : "",

                        auditId:
                            auditRef.id
                    };
                }
            );

        return {
            success:
                true,

            ...serializeValue(
                result
            )
        };
    } catch (error) {
        throwHttpsError(
            error,

            decision ===
            REFERRAL.STATUS.APPROVED
                ? "The referral could not be approved."
                : "The referral could not be rejected."
        );
    }
}

/* =========================================================
   ADMIN: APPROVE REFERRAL
========================================================= */

async function approveReferral(request) {
    return reviewReferral(
        request,
        REFERRAL.STATUS.APPROVED
    );
}

/* =========================================================
   ADMIN: REJECT REFERRAL
========================================================= */

async function rejectReferral(request) {
    return reviewReferral(
        request,
        REFERRAL.STATUS.REJECTED
    );
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    getReferralReference,
    getReferralStatsReference,

    normalizeReferralStatus,
    requireReferralStatus,

    normalizeReferralRecord,
    normalizeReferralStats,
    evaluateReferralEligibility,

    getMyReferralStats,
    getMyReferrals,

    getPendingReferrals,
    approveReferral,
    rejectReferral
});