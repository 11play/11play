"use strict";

/* =========================================================
   11PLAY — ADMIN BACKEND
   File: functions/lib/admin.js

   Responsibilities:
   - Verify the single fixed Admin account
   - Ensure the Admin profile and referral identity exist
   - Return Admin Dashboard statistics
   - Return Profile System users and user details
   - Change only permitted user profile status
   - Adjust wallet balance securely and idempotently
   - Return wallet transactions and Admin audit records
   - Provide cursor-based pagination for large Admin lists

   Important:
   - Referral decisions are handled by referral.js
   - Withdrawal decisions are handled by withdrawal.js
   - Google identity and locked mobile fields are read-only
   - No Super Admin or Firestore Admin role exists
========================================================= */

const {
    getFirestore,
    Timestamp,
    AggregateField
} = require("firebase-admin/firestore");

const {
    COLLECTIONS,
    PROFILE_STATUS,
    REFERRAL,
    WITHDRAWAL,
    WALLET,
    ADMIN,
    ACTIVITY,
    SYSTEM,
    ERROR_CODES
} = require("./constants");

const {
    validateUid,
    validateProfileStatus: validateProfileStatusValue,
    validateMoneyAmount,
    validateAdminNote,
    validatePaginationCursor,
    validatePaginationLimit,
    validateRequestId,
    validateAdminAction,
    normalizeText,
    isPlainObject
} = require("./validators");

const {
    assertAdmin,
    createHttpsError,
    throwHttpsError
} = require("./security");

const {
    getWalletReference,
    getWalletTransactionReference,
    buildWalletTransactionId,
    applyWalletOperationInTransaction,
    normalizeDirection,
    validateDirection,
    normalizeTransactionType,
    validateTransactionType
} = require("./wallet");

const {
    ensureProfileForAuthenticatedUser
} = require("./profile");

/* =========================================================
   GENERAL HELPERS
========================================================= */

function toSafeString(value) {
    return normalizeText(value);
}

function toSafeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function toNonNegativeInteger(
    value,
    fallback = 0
) {
    const number =
        toSafeNumber(
            value,
            fallback
        );

    if (
        !Number.isSafeInteger(number) ||
        number < 0
    ) {
        return Math.max(
            0,
            Math.floor(fallback)
        );
    }

    return number;
}

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
        const result = {};

        for (
            const [
                key,
                nestedValue
            ] of Object.entries(value)
        ) {
            result[key] =
                serializeValue(
                    nestedValue
                );
        }

        return result;
    }

    return value;
}

function buildPage(
    snapshot,
    limit
) {
    const hasMore =
        snapshot.docs.length >
        limit;

    const documents =
        hasMore
            ? snapshot.docs.slice(
                0,
                limit
            )
            : snapshot.docs;

    return {
        hasMore,

        documents,

        nextCursor:
            hasMore &&
            documents.length > 0
                ? documents[
                    documents.length - 1
                ].id
                : ""
    };
}

/* =========================================================
   STATUS NORMALIZATION
========================================================= */

function normalizeProfileStatus(value) {
    const status =
        toSafeString(value)
            .toLowerCase();

    return Object
        .values(
            PROFILE_STATUS
        )
        .includes(status)
        ? status
        : "";
}

function validateProfileStatus(value) {
    return validateProfileStatusValue(
        value
    );
}

function normalizeReferralStatus(value) {
    const status =
        toSafeString(value)
            .toLowerCase();

    const legacyMap =
        Object.freeze({
            observing:
                REFERRAL
                    .STATUS
                    .PENDING,

            pending_review:
                REFERRAL
                    .STATUS
                    .QUALIFIED,

            valid:
                REFERRAL
                    .STATUS
                    .REWARDED,

            invalid:
                REFERRAL
                    .STATUS
                    .REJECTED
        });

    const normalized =
        legacyMap[status] ||
        status;

    return Object
        .values(
            REFERRAL.STATUS
        )
        .includes(normalized)
        ? normalized
        : "";
}

function normalizeWithdrawalStatus(value) {
    const status =
        toSafeString(value)
            .toLowerCase();

    const legacyMap =
        Object.freeze({
            processing:
                WITHDRAWAL
                    .STATUS
                    .PENDING,

            successful:
                WITHDRAWAL
                    .STATUS
                    .APPROVED
        });

    const normalized =
        legacyMap[status] ||
        status;

    return Object
        .values(
            WITHDRAWAL.STATUS
        )
        .includes(normalized)
        ? normalized
        : "";
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
        .doc(
            validateUid(uid)
        );
}

function getActivityReference(
    database,
    uid
) {
    return database
        .collection(
            COLLECTIONS.ACTIVITY
        )
        .doc(
            validateUid(uid)
        );
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
        .doc(
            validateUid(uid)
        );
}

function getReferralReference(
    database,
    referredUid
) {
    return database
        .collection(
            COLLECTIONS.REFERRALS
        )
        .doc(
            validateUid(
                referredUid,
                "referredUid"
            )
        );
}

function getAuditLogReference(
    database,
    auditId = ""
) {
    const collection =
        database.collection(
            COLLECTIONS.AUDIT_LOGS
        );

    return auditId
        ? collection.doc(auditId)
        : collection.doc();
}

/* =========================================================
   ADMIN SESSION
========================================================= */

async function getAdminSession(request) {
    try {
        const admin =
            await assertAdmin(
                request
            );

        const ensuredProfile =
            await ensureProfileForAuthenticatedUser({
                authenticatedUser: {
                    uid:
                        admin.uid,

                    email:
                        admin.email,

                    displayName:
                        admin.displayName,

                    photoURL:
                        admin.photoURL,

                    emailVerified:
                        true,

                    providerIds:
                        Array.isArray(
                            admin.providerIds
                        ) &&
                        admin
                            .providerIds
                            .length > 0
                            ? admin.providerIds
                            : [
                                "google.com"
                            ]
                },

                incomingReferralCode:
                    "",

                touchLastLogin:
                    true
            });

        const profile =
            ensuredProfile.profile ||
            {};

        return {
            success:
                true,

            admin:
                serializeValue({
                    uid:
                        admin.uid,

                    email:
                        admin.email,

                    displayName:
                        admin.displayName,

                    photoURL:
                        admin.photoURL,

                    role:
                        admin.role,

                    isAdmin:
                        true,

                    isSuperAdmin:
                        false,

                    authorizationSource:
                        admin
                            .authorizationSource,

                    profileCreated:
                        ensuredProfile
                            .created === true,

                    referralCode:
                        toSafeString(
                            profile.referralCode
                        ),

                    referralLink:
                        toSafeString(
                            profile.referralLink
                        )
                }),

            profile:
                serializeValue(
                    profile
                )
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Admin session could not be verified."
        );
    }
}

/* =========================================================
   ADMIN DASHBOARD SUMMARY
========================================================= */

async function getAdminDashboardSummary(
    request
) {
    try {
        await assertAdmin(request);

        const database =
            getFirestore();

        const usersCollection =
            database.collection(
                COLLECTIONS.USERS
            );

        const referralsCollection =
            database.collection(
                COLLECTIONS.REFERRALS
            );

        const withdrawalsCollection =
            database.collection(
                COLLECTIONS.WITHDRAWALS
            );

        const walletsCollection =
            database.collection(
                COLLECTIONS.WALLETS
            );

        const transactionsCollection =
            database.collection(
                COLLECTIONS
                    .WALLET_TRANSACTIONS
            );

        const pendingReferralQuery =
            referralsCollection.where(
                "status",
                "in",
                [
                    REFERRAL
                        .STATUS
                        .PENDING,

                    "observing"
                ]
            );

        const qualifiedReferralQuery =
            referralsCollection.where(
                "status",
                "in",
                [
                    REFERRAL
                        .STATUS
                        .QUALIFIED,

                    "pending_review"
                ]
            );

        const rejectedReferralQuery =
            referralsCollection.where(
                "status",
                "in",
                [
                    REFERRAL
                        .STATUS
                        .REJECTED,

                    "invalid"
                ]
            );

        const rewardedReferralQuery =
            referralsCollection.where(
                "status",
                "in",
                [
                    REFERRAL
                        .STATUS
                        .REWARDED,

                    "valid"
                ]
            );

        const pendingWithdrawalQuery =
            withdrawalsCollection.where(
                "status",
                "in",
                [
                    WITHDRAWAL
                        .STATUS
                        .PENDING,

                    "processing"
                ]
            );

        const approvedWithdrawalQuery =
            withdrawalsCollection.where(
                "status",
                "in",
                [
                    WITHDRAWAL
                        .STATUS
                        .APPROVED,

                    "successful"
                ]
            );

        const rejectedWithdrawalQuery =
            withdrawalsCollection.where(
                "status",
                "==",
                WITHDRAWAL
                    .STATUS
                    .REJECTED
            );

        const cancelledWithdrawalQuery =
            withdrawalsCollection.where(
                "status",
                "==",
                WITHDRAWAL
                    .STATUS
                    .CANCELLED
            );

        const [
            usersTotalSnapshot,
            usersSuspendedSnapshot,
            usersBlockedSnapshot,

            referralsTotalSnapshot,
            referralsCapturedSnapshot,
            referralsPendingSnapshot,
            referralsQualifiedSnapshot,
            referralsApprovedSnapshot,
            referralsRejectedSnapshot,
            referralsRewardedSnapshot,
            referralsRewardAmountSnapshot,

            withdrawalsTotalSnapshot,
            withdrawalsPendingSnapshot,
            withdrawalsPendingAmountSnapshot,
            withdrawalsApprovedSnapshot,
            withdrawalsApprovedAmountSnapshot,
            withdrawalsRejectedSnapshot,
            withdrawalsRejectedAmountSnapshot,
            withdrawalsCancelledSnapshot,
            withdrawalsCancelledAmountSnapshot,

            walletsAvailableSnapshot,
            walletsHeldSnapshot,
            walletsEarnedSnapshot,
            walletsWithdrawnSnapshot,

            transactionsCountSnapshot
        ] = await Promise.all([
            usersCollection
                .count()
                .get(),

            usersCollection
                .where(
                    "status",
                    "==",
                    PROFILE_STATUS.SUSPENDED
                )
                .count()
                .get(),

            usersCollection
                .where(
                    "status",
                    "==",
                    PROFILE_STATUS.BLOCKED
                )
                .count()
                .get(),

            referralsCollection
                .count()
                .get(),

            referralsCollection
                .where(
                    "status",
                    "==",
                    REFERRAL
                        .STATUS
                        .CAPTURED
                )
                .count()
                .get(),

            pendingReferralQuery
                .count()
                .get(),

            qualifiedReferralQuery
                .count()
                .get(),

            referralsCollection
                .where(
                    "status",
                    "==",
                    REFERRAL
                        .STATUS
                        .APPROVED
                )
                .count()
                .get(),

            rejectedReferralQuery
                .count()
                .get(),

            rewardedReferralQuery
                .count()
                .get(),

            rewardedReferralQuery
                .aggregate({
                    totalReward:
                        AggregateField
                            .sum(
                                "rewardAmount"
                            )
                })
                .get(),

            withdrawalsCollection
                .count()
                .get(),

            pendingWithdrawalQuery
                .count()
                .get(),

            pendingWithdrawalQuery
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "amount"
                            )
                })
                .get(),

            approvedWithdrawalQuery
                .count()
                .get(),

            approvedWithdrawalQuery
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "amount"
                            )
                })
                .get(),

            rejectedWithdrawalQuery
                .count()
                .get(),

            rejectedWithdrawalQuery
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "amount"
                            )
                })
                .get(),

            cancelledWithdrawalQuery
                .count()
                .get(),

            cancelledWithdrawalQuery
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "amount"
                            )
                })
                .get(),

            walletsCollection
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "availableBalance"
                            )
                })
                .get(),

            walletsCollection
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "heldBalance"
                            )
                })
                .get(),

            walletsCollection
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "totalEarned"
                            )
                })
                .get(),

            walletsCollection
                .aggregate({
                    amount:
                        AggregateField
                            .sum(
                                "totalWithdrawn"
                            )
                })
                .get(),

            transactionsCollection
                .count()
                .get()
        ]);

        const usersTotal =
            toNonNegativeInteger(
                usersTotalSnapshot
                    .data()
                    ?.count
            );

        const usersSuspended =
            toNonNegativeInteger(
                usersSuspendedSnapshot
                    .data()
                    ?.count
            );

        const usersBlocked =
            toNonNegativeInteger(
                usersBlockedSnapshot
                    .data()
                    ?.count
            );

        const referralsRewarded =
            toNonNegativeInteger(
                referralsRewardedSnapshot
                    .data()
                    ?.count
            );

        const storedReferralReward =
            toNonNegativeInteger(
                referralsRewardAmountSnapshot
                    .data()
                    ?.totalReward
            );

        const minimumReferralReward =
            referralsRewarded *
            REFERRAL.REWARD_AMOUNT;

        const summary = {
            users: {
                total:
                    usersTotal,

                active:
                    Math.max(
                        0,

                        usersTotal -
                        usersSuspended -
                        usersBlocked
                    ),

                suspended:
                    usersSuspended,

                blocked:
                    usersBlocked
            },

            referrals: {
                total:
                    toNonNegativeInteger(
                        referralsTotalSnapshot
                            .data()
                            ?.count
                    ),

                captured:
                    toNonNegativeInteger(
                        referralsCapturedSnapshot
                            .data()
                            ?.count
                    ),

                pending:
                    toNonNegativeInteger(
                        referralsPendingSnapshot
                            .data()
                            ?.count
                    ),

                qualified:
                    toNonNegativeInteger(
                        referralsQualifiedSnapshot
                            .data()
                            ?.count
                    ),

                approved:
                    toNonNegativeInteger(
                        referralsApprovedSnapshot
                            .data()
                            ?.count
                    ) +
                    referralsRewarded,

                rejected:
                    toNonNegativeInteger(
                        referralsRejectedSnapshot
                            .data()
                            ?.count
                    ),

                rewarded:
                    referralsRewarded,

                totalReward:
                    Math.max(
                        storedReferralReward,
                        minimumReferralReward
                    )
            },

            withdrawals: {
                total:
                    toNonNegativeInteger(
                        withdrawalsTotalSnapshot
                            .data()
                            ?.count
                    ),

                pending:
                    toNonNegativeInteger(
                        withdrawalsPendingSnapshot
                            .data()
                            ?.count
                    ),

                approved:
                    toNonNegativeInteger(
                        withdrawalsApprovedSnapshot
                            .data()
                            ?.count
                    ),

                rejected:
                    toNonNegativeInteger(
                        withdrawalsRejectedSnapshot
                            .data()
                            ?.count
                    ),

                cancelled:
                    toNonNegativeInteger(
                        withdrawalsCancelledSnapshot
                            .data()
                            ?.count
                    ),

                pendingAmount:
                    toNonNegativeInteger(
                        withdrawalsPendingAmountSnapshot
                            .data()
                            ?.amount
                    ),

                approvedAmount:
                    toNonNegativeInteger(
                        withdrawalsApprovedAmountSnapshot
                            .data()
                            ?.amount
                    ),

                rejectedAmount:
                    toNonNegativeInteger(
                        withdrawalsRejectedAmountSnapshot
                            .data()
                            ?.amount
                    ),

                cancelledAmount:
                    toNonNegativeInteger(
                        withdrawalsCancelledAmountSnapshot
                            .data()
                            ?.amount
                    )
            },

            wallets: {
                availableBalance:
                    toNonNegativeInteger(
                        walletsAvailableSnapshot
                            .data()
                            ?.amount
                    ),

                heldBalance:
                    toNonNegativeInteger(
                        walletsHeldSnapshot
                            .data()
                            ?.amount
                    ),

                totalEarned:
                    toNonNegativeInteger(
                        walletsEarnedSnapshot
                            .data()
                            ?.amount
                    ),

                totalWithdrawn:
                    toNonNegativeInteger(
                        walletsWithdrawnSnapshot
                            .data()
                            ?.amount
                    )
            },

            transactions: {
                total:
                    toNonNegativeInteger(
                        transactionsCountSnapshot
                            .data()
                            ?.count
                    )
            }
        };

        summary.referrals.observing =
            summary.referrals.pending;

        summary.referrals.pendingReview =
            summary.referrals.qualified;

        summary.referrals.valid =
            summary.referrals.rewarded;

        summary.referrals.invalid =
            summary.referrals.rejected;

        summary.withdrawals.processing =
            summary.withdrawals.pending;

        summary.withdrawals.successful =
            summary.withdrawals.approved;

        summary.withdrawals.processingAmount =
            summary
                .withdrawals
                .pendingAmount;

        summary.withdrawals.successfulAmount =
            summary
                .withdrawals
                .approvedAmount;

        return {
            success:
                true,

            summary
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Admin Dashboard summary could not be loaded."
        );
    }
}

/* =========================================================
   ADMIN USER SUMMARY
========================================================= */

function normalizeReferralStats(
    referralStats
) {
    const source =
        isPlainObject(
            referralStats
        )
            ? referralStats
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

function createAdminUserSummary({
    profile,
    profileId,
    wallet,
    activity,
    referralStats
}) {
    const requiredActiveSeconds =
        toNonNegativeInteger(
            activity
                ?.requiredActiveSeconds,
            ACTIVITY
                .REQUIRED_ACTIVE_SECONDS
        ) ||
        ACTIVITY
            .REQUIRED_ACTIVE_SECONDS;

    const totalActiveSeconds =
        Math.min(
            requiredActiveSeconds,

            toNonNegativeInteger(
                activity
                    ?.totalActiveSeconds
            )
        );

    const referrals =
        normalizeReferralStats(
            referralStats
        );

    const normalizedWallet =
        isPlainObject(wallet)
            ? {
                availableBalance:
                    toNonNegativeInteger(
                        wallet
                            .availableBalance
                    ),

                heldBalance:
                    toNonNegativeInteger(
                        wallet
                            .heldBalance
                    ),

                totalEarned:
                    toNonNegativeInteger(
                        wallet
                            .totalEarned
                    ),

                totalWithdrawn:
                    toNonNegativeInteger(
                        wallet
                            .totalWithdrawn
                    )
            }
            : {
                availableBalance:
                    0,

                heldBalance:
                    0,

                totalEarned:
                    0,

                totalWithdrawn:
                    0
            };

    return serializeValue({
        uid:
            toSafeString(
                profile.uid ||
                profileId
            ),

        name:
            toSafeString(
                profile.displayName ||
                profile.name
            ),

        displayName:
            toSafeString(
                profile.displayName ||
                profile.name
            ),

        username:
            toSafeString(
                profile.username
            ),

        email:
            toSafeString(
                profile.email
            ),

        photoURL:
            toSafeString(
                profile.photoURL ||
                profile.photo
            ),

        accountType:
            toSafeString(
                profile.accountType
            ),

        mobileNumber:
            toSafeString(
                profile.mobileNumber
            ),

        mobileAdded:
            profile.mobileAdded ===
                true,

        mobileLocked:
            profile.mobileLocked ===
                true,

        googleConnected:
            profile.googleConnected ===
                true ||
            profile.isGoogleConnected ===
                true,

        referralCode:
            toSafeString(
                profile.referralCode
            ),

        referralLink:
            toSafeString(
                profile.referralLink
            ),

        referredByUid:
            toSafeString(
                profile.referredByUid
            ),

        referredByCode:
            toSafeString(
                profile.referredByCode
            ),

        registrationDate:
            profile.registrationDate ||
            profile.createdAt ||
            null,

        lastLogin:
            profile.lastLogin ||
            null,

        status:
            normalizeProfileStatus(
                profile.status
            ) ||
            PROFILE_STATUS.ACTIVE,

        usingTime: {
            totalActiveSeconds,

            requiredActiveSeconds,

            remainingActiveSeconds:
                Math.max(
                    0,
                    requiredActiveSeconds -
                    totalActiveSeconds
                ),

            progressPercent:
                requiredActiveSeconds > 0
                    ? Math.min(
                        100,

                        Number(
                            (
                                totalActiveSeconds /
                                requiredActiveSeconds *
                                100
                            ).toFixed(4)
                        )
                    )
                    : 100,

            completed:
                activity?.completed ===
                    true ||
                totalActiveSeconds >=
                    requiredActiveSeconds,

            completedAt:
                activity?.completedAt ||
                null
        },

        wallet:
            normalizedWallet,

        referrals: {
            ...referrals,

            observing:
                referrals.pending,

            pendingReview:
                referrals.qualified,

            valid:
                referrals.rewarded,

            invalid:
                referrals.rejected
        }
    });
}

/* =========================================================
   ADMIN: GET USERS
========================================================= */

async function getAdminUsers(request) {
    try {
        await assertAdmin(request);

        const rawStatus =
            toSafeString(
                request?.data?.status
            );

        const requestedStatus =
            rawStatus
                ? validateProfileStatus(
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
                        COLLECTIONS.USERS
                    )
                    .doc(cursor)
                    .get();

            if (!cursorSnapshot.exists) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "User pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            const cursorProfile =
                cursorSnapshot.data() ||
                {};

            const cursorStatus =
                normalizeProfileStatus(
                    cursorProfile.status
                ) ||
                PROFILE_STATUS.ACTIVE;

            if (
                requestedStatus &&
                cursorStatus !==
                    requestedStatus
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "User pagination cursor does not match the requested status.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            if (
                !cursorProfile
                    .registrationDate
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "User pagination cursor is missing its registration date.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        let baseQuery =
            database.collection(
                COLLECTIONS.USERS
            );

        if (requestedStatus) {
            baseQuery =
                baseQuery.where(
                    "status",
                    "==",
                    requestedStatus
                );
        }

        let pageQuery =
            baseQuery.orderBy(
                "registrationDate",
                "desc"
            );

        if (cursorSnapshot) {
            pageQuery =
                pageQuery.startAfter(
                    cursorSnapshot
                );
        }

        const [
            usersSnapshot,
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

        const page =
            buildPage(
                usersSnapshot,
                resultLimit
            );

        const users =
            await Promise.all(
                page.documents.map(
                    async (
                        profileSnapshot
                    ) => {
                        const uid =
                            profileSnapshot.id;

                        const [
                            walletSnapshot,
                            activitySnapshot,
                            statsSnapshot
                        ] = await Promise.all([
                            getWalletReference(
                                database,
                                uid
                            ).get(),

                            getActivityReference(
                                database,
                                uid
                            ).get(),

                            getReferralStatsReference(
                                database,
                                uid
                            ).get()
                        ]);

                        return createAdminUserSummary({
                            profile:
                                profileSnapshot.data() ||
                                {},

                            profileId:
                                uid,

                            wallet:
                                walletSnapshot.exists
                                    ? walletSnapshot.data()
                                    : {},

                            activity:
                                activitySnapshot.exists
                                    ? activitySnapshot.data()
                                    : {},

                            referralStats:
                                statsSnapshot.exists
                                    ? statsSnapshot.data()
                                    : {}
                        });
                    }
                )
            );

        return {
            success:
                true,

            count:
                users.length,

            total:
                toNonNegativeInteger(
                    totalSnapshot
                        .data()
                        ?.count
                ),

            status:
                requestedStatus,

            users,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Profile System users could not be loaded."
        );
    }
}

/* =========================================================
   ADMIN: GET ONE USER DETAILS
========================================================= */

async function getAdminUserDetails(
    request
) {
    try {
        await assertAdmin(request);

        const userId =
            validateUid(
                request?.data?.userId ||
                request?.data?.uid,
                "userId"
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

        const [
            profileSnapshot,
            walletSnapshot,
            activitySnapshot,
            statsSnapshot,
            referredBySnapshot,
            referralsSnapshot,
            withdrawalsSnapshot,
            transactionsSnapshot,
            sessionsSnapshot
        ] = await Promise.all([
            getProfileReference(
                database,
                userId
            ).get(),

            getWalletReference(
                database,
                userId
            ).get(),

            getActivityReference(
                database,
                userId
            ).get(),

            getReferralStatsReference(
                database,
                userId
            ).get(),

            getReferralReference(
                database,
                userId
            ).get(),

            database
                .collection(
                    COLLECTIONS.REFERRALS
                )
                .where(
                    "referrerUid",
                    "==",
                    userId
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    resultLimit
                )
                .get(),

            database
                .collection(
                    COLLECTIONS.WITHDRAWALS
                )
                .where(
                    "userId",
                    "==",
                    userId
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    resultLimit
                )
                .get(),

            database
                .collection(
                    COLLECTIONS
                        .WALLET_TRANSACTIONS
                )
                .where(
                    "userId",
                    "==",
                    userId
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    resultLimit
                )
                .get(),

            database
                .collection(
                    COLLECTIONS
                        .ACTIVITY_SESSIONS
                )
                .where(
                    "userId",
                    "==",
                    userId
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    resultLimit
                )
                .get()
        ]);

        if (!profileSnapshot.exists) {
            throw createHttpsError(
                ERROR_CODES.NOT_FOUND,
                "User profile was not found."
            );
        }

        const user =
            createAdminUserSummary({
                profile:
                    profileSnapshot.data() ||
                    {},

                profileId:
                    profileSnapshot.id,

                wallet:
                    walletSnapshot.exists
                        ? walletSnapshot.data()
                        : {},

                activity:
                    activitySnapshot.exists
                        ? activitySnapshot.data()
                        : {},

                referralStats:
                    statsSnapshot.exists
                        ? statsSnapshot.data()
                        : {}
            });

        const mapDocuments =
            (snapshot) =>
                snapshot.docs.map(
                    (
                        documentSnapshot
                    ) =>
                        serializeValue({
                            id:
                                documentSnapshot.id,

                            ...documentSnapshot
                                .data()
                        })
                );

        return {
            success:
                true,

            user,

            referredBy:
                referredBySnapshot.exists
                    ? serializeValue({
                        id:
                            referredBySnapshot.id,

                        ...referredBySnapshot
                            .data()
                    })
                    : null,

            referrals:
                mapDocuments(
                    referralsSnapshot
                ),

            withdrawals:
                mapDocuments(
                    withdrawalsSnapshot
                ),

            transactions:
                mapDocuments(
                    transactionsSnapshot
                ),

            activitySessions:
                mapDocuments(
                    sessionsSnapshot
                )
        };
    } catch (error) {
        throwHttpsError(
            error,
            "User details could not be loaded."
        );
    }
}

/* =========================================================
   ADMIN: CHANGE USER PROFILE STATUS
========================================================= */

async function updateAdminUserProfile(
    request
) {
    try {
        const admin =
            await assertAdmin(request);

        const userId =
            validateUid(
                request?.data?.userId ||
                request?.data?.uid,
                "userId"
            );

        const updates =
            isPlainObject(
                request?.data?.updates
            )
                ? request.data.updates
                : request?.data || {};

        const status =
            validateProfileStatus(
                updates.status
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
                        true,

                    maxLength:
                        500
                }
            );

        if (
            userId === admin.uid &&
            status !==
                PROFILE_STATUS.ACTIVE
        ) {
            throw createHttpsError(
                ERROR_CODES
                    .FAILED_PRECONDITION,

                "The only Admin account cannot suspend or block itself."
            );
        }

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const profileRef =
            getProfileReference(
                database,
                userId
            );

        const auditRef =
            getAuditLogReference(
                database
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const profileSnapshot =
                        await transaction.get(
                            profileRef
                        );

                    if (
                        !profileSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES.NOT_FOUND,
                            "User profile was not found."
                        );
                    }

                    const existingProfile =
                        profileSnapshot.data() ||
                        {};

                    const previousStatus =
                        normalizeProfileStatus(
                            existingProfile.status
                        ) ||
                        PROFILE_STATUS.ACTIVE;

                    if (
                        previousStatus === status
                    ) {
                        return {
                            updated:
                                false,

                            unchanged:
                                true,

                            userId,

                            previousStatus,

                            status,

                            auditId:
                                ""
                        };
                    }

                    transaction.set(
                        profileRef,
                        {
                            status,

                            statusChangedAt:
                                timestamp,

                            statusChangedBy:
                                admin.uid,

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

                    transaction.create(
                        auditRef,
                        {
                            auditId:
                                auditRef.id,

                            action:
                                ADMIN
                                    .ACTION
                                    .PROFILE_STATUS_CHANGED,

                            adminUid:
                                admin.uid,

                            adminEmail:
                                admin.email,

                            adminRole:
                                admin.role,

                            targetUid:
                                userId,

                            previousStatus,

                            newStatus:
                                status,

                            note:
                                adminNote,

                            createdAt:
                                timestamp,

                            schemaVersion:
                                SYSTEM
                                    .SCHEMA_VERSION
                        }
                    );

                    return {
                        updated:
                            true,

                        unchanged:
                            false,

                        userId,

                        previousStatus,

                        status,

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
            "User profile status could not be updated."
        );
    }
}

/* =========================================================
   ADMIN WALLET ADJUSTMENT HELPERS
========================================================= */

function buildAdminAdjustmentReferenceId({
    userId,
    operationId
}) {
    const referenceId =
        `${userId}_${operationId}`;

    if (
        referenceId.length > 300
    ) {
        throw createHttpsError(
            ERROR_CODES.INVALID_ARGUMENT,
            "Wallet adjustment reference is too long."
        );
    }

    return referenceId;
}

function assertExistingAdjustmentAuditMatches({
    auditSnapshot,
    userId,
    operationId,
    transactionId,
    direction,
    amount
}) {
    const audit =
        auditSnapshot.data() ||
        {};

    const matches =
        toSafeString(
            audit.action
        ) ===
            ADMIN
                .ACTION
                .WALLET_ADJUSTED &&
        toSafeString(
            audit.targetUid
        ) === userId &&
        toSafeString(
            audit.operationId
        ) === operationId &&
        toSafeString(
            audit.transactionId
        ) === transactionId &&
        toSafeString(
            audit.direction
        ) === direction &&
        Number(
            audit.amount
        ) === amount;

    if (!matches) {
        throw createHttpsError(
            ERROR_CODES.ABORTED,
            "A conflicting wallet adjustment audit record already exists."
        );
    }

    return audit;
}

/* =========================================================
   ADMIN: ADJUST USER WALLET
========================================================= */

async function adjustAdminWallet(request) {
    try {
        const admin =
            await assertAdmin(request);

        const userId =
            validateUid(
                request?.data?.userId ||
                request?.data?.uid,
                "userId"
            );

        const amount =
            validateMoneyAmount(
                request?.data?.amount,
                {
                    fieldName:
                        "amount",

                    minimum:
                        1,

                    integerOnly:
                        true
                }
            );

        const direction =
            validateDirection(
                request?.data
                    ?.direction
            );

        const operationId =
            validateRequestId(
                request?.data
                    ?.operationId ||
                request?.data
                    ?.requestId,
                "operationId"
            );

        const adminNote =
            validateAdminNote(
                request?.data
                    ?.adminNote ||
                request?.data
                    ?.note,
                {
                    required:
                        true,

                    maxLength:
                        500
                }
            );

        const database =
            getFirestore();

        const timestamp =
            Timestamp.now();

        const profileRef =
            getProfileReference(
                database,
                userId
            );

        const walletRef =
            getWalletReference(
                database,
                userId
            );

        const adjustmentReferenceId =
            buildAdminAdjustmentReferenceId({
                userId,
                operationId
            });

        const walletTransactionId =
            buildWalletTransactionId({
                type:
                    WALLET
                        .TRANSACTION_TYPE
                        .ADMIN_ADJUSTMENT,

                referenceId:
                    adjustmentReferenceId,

                operationId
            });

        const ledgerRef =
            getWalletTransactionReference(
                database,
                walletTransactionId
            );

        const auditRef =
            getAuditLogReference(
                database,
                `wallet_adjustment_${adjustmentReferenceId}`
            );

        const result =
            await database.runTransaction(
                async (transaction) => {
                    const [
                        profileSnapshot,
                        walletSnapshot,
                        ledgerSnapshot,
                        auditSnapshot
                    ] = await Promise.all([
                        transaction.get(
                            profileRef
                        ),

                        transaction.get(
                            walletRef
                        ),

                        transaction.get(
                            ledgerRef
                        ),

                        transaction.get(
                            auditRef
                        )
                    ]);

                    if (
                        !profileSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES.NOT_FOUND,
                            "User profile was not found."
                        );
                    }

                    if (
                        ledgerSnapshot.exists !==
                        auditSnapshot.exists
                    ) {
                        throw createHttpsError(
                            ERROR_CODES.ABORTED,
                            "Wallet adjustment records are inconsistent."
                        );
                    }

                    const walletResult =
                        applyWalletOperationInTransaction({
                            transaction,

                            walletRef,
                            walletSnapshot,

                            ledgerRef,
                            ledgerSnapshot,

                            userId,

                            type:
                                WALLET
                                    .TRANSACTION_TYPE
                                    .ADMIN_ADJUSTMENT,

                            direction,

                            amount,

                            referenceId:
                                adjustmentReferenceId,

                            operationId,

                            timestamp,

                            adminUid:
                                admin.uid,

                            note:
                                adminNote,

                            metadata: {
                                source:
                                    "admin_adjustment",

                                targetEmail:
                                    toSafeString(
                                        profileSnapshot
                                            .data()
                                            ?.email
                                    )
                            }
                        });

                    if (auditSnapshot.exists) {
                        assertExistingAdjustmentAuditMatches({
                            auditSnapshot,

                            userId,

                            operationId,

                            transactionId:
                                walletResult
                                    .transactionId,

                            direction,

                            amount
                        });

                        return {
                            applied:
                                false,

                            duplicate:
                                true,

                            userId,

                            operationId,

                            transactionId:
                                walletResult
                                    .transactionId,

                            auditId:
                                auditRef.id,

                            wallet:
                                walletResult.wallet
                        };
                    }

                    const auditData = {
                        auditId:
                            auditRef.id,

                        action:
                            ADMIN
                                .ACTION
                                .WALLET_ADJUSTED,

                        adminUid:
                            admin.uid,

                        adminEmail:
                            admin.email,

                        adminRole:
                            admin.role,

                        targetUid:
                            userId,

                        operationId,

                        transactionId:
                            walletResult
                                .transactionId,

                        direction,

                        amount,

                        availableBalanceBefore:
                            walletResult
                                .ledger
                                .availableBalanceBefore,

                        availableBalanceAfter:
                            walletResult
                                .ledger
                                .availableBalanceAfter,

                        heldBalanceBefore:
                            walletResult
                                .ledger
                                .heldBalanceBefore,

                        heldBalanceAfter:
                            walletResult
                                .ledger
                                .heldBalanceAfter,

                        note:
                            adminNote,

                        createdAt:
                            timestamp,

                        schemaVersion:
                            SYSTEM
                                .SCHEMA_VERSION
                    };

                    transaction.create(
                        auditRef,
                        auditData
                    );

                    return {
                        applied:
                            true,

                        duplicate:
                            false,

                        userId,

                        operationId,

                        transactionId:
                            walletResult
                                .transactionId,

                        auditId:
                            auditRef.id,

                        wallet:
                            walletResult.wallet
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
            "Wallet adjustment could not be completed."
        );
    }
}

/* =========================================================
   ADMIN: GET WALLET TRANSACTIONS
========================================================= */

async function getAdminTransactions(
    request
) {
    try {
        await assertAdmin(request);

        const rawUserId =
            toSafeString(
                request?.data?.userId ||
                request?.data?.uid
            );

        const userId =
            rawUserId
                ? validateUid(
                    rawUserId,
                    "userId"
                )
                : "";

        const rawType =
            toSafeString(
                request?.data?.type
            );

        const type =
            rawType
                ? validateTransactionType(
                    rawType
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
                            .WALLET_TRANSACTIONS
                    )
                    .doc(cursor)
                    .get();

            if (!cursorSnapshot.exists) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Wallet transaction pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            const cursorTransaction =
                cursorSnapshot.data() ||
                {};

            const cursorUserId =
                toSafeString(
                    cursorTransaction.userId ||
                    cursorTransaction.uid
                );

            const cursorType =
                normalizeTransactionType(
                    cursorTransaction.type
                );

            if (
                userId &&
                cursorUserId !==
                    userId
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Wallet transaction pagination cursor does not match the requested user.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            if (
                type &&
                cursorType !== type
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Wallet transaction pagination cursor does not match the requested type.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            if (
                !cursorTransaction
                    .createdAt
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Wallet transaction pagination cursor is missing its creation time.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        let baseQuery =
            database.collection(
                COLLECTIONS
                    .WALLET_TRANSACTIONS
            );

        if (userId) {
            baseQuery =
                baseQuery.where(
                    "userId",
                    "==",
                    userId
                );
        }

        if (type) {
            baseQuery =
                baseQuery.where(
                    "type",
                    "==",
                    type
                );
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

        const page =
            buildPage(
                snapshot,
                resultLimit
            );

        const transactions =
            page.documents.map(
                (
                    documentSnapshot
                ) =>
                    serializeValue({
                        id:
                            documentSnapshot.id,

                        ...documentSnapshot
                            .data()
                    })
            );

        return {
            success:
                true,

            count:
                transactions.length,

            total:
                toNonNegativeInteger(
                    totalSnapshot
                        .data()
                        ?.count
                ),

            userId,

            type,

            transactions,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Wallet transactions could not be loaded."
        );
    }
}

/* =========================================================
   ADMIN: GET AUDIT LOGS
========================================================= */

async function getAdminAuditLogs(
    request
) {
    try {
        await assertAdmin(request);

        const rawAdminUid =
            toSafeString(
                request?.data?.adminUid
            );

        const adminUid =
            rawAdminUid
                ? validateUid(
                    rawAdminUid,
                    "adminUid"
                )
                : "";

        const rawAction =
            toSafeString(
                request?.data?.action
            );

        const action =
            rawAction
                ? validateAdminAction(
                    rawAction
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
                        COLLECTIONS.AUDIT_LOGS
                    )
                    .doc(cursor)
                    .get();

            if (!cursorSnapshot.exists) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Admin audit pagination cursor is invalid.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            const cursorAudit =
                cursorSnapshot.data() ||
                {};

            const cursorAdminUid =
                toSafeString(
                    cursorAudit.adminUid
                );

            const cursorAction =
                toSafeString(
                    cursorAudit.action
                ).toLowerCase();

            if (
                adminUid &&
                cursorAdminUid !==
                    adminUid
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Admin audit pagination cursor does not match the requested Admin.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            if (
                action &&
                cursorAction !==
                    action
            ) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Admin audit pagination cursor does not match the requested action.",
                    {
                        field:
                            "cursor"
                    }
                );
            }

            if (!cursorAudit.createdAt) {
                throw createHttpsError(
                    ERROR_CODES
                        .INVALID_ARGUMENT,

                    "Admin audit pagination cursor is missing its creation time.",
                    {
                        field:
                            "cursor"
                    }
                );
            }
        }

        let baseQuery =
            database.collection(
                COLLECTIONS.AUDIT_LOGS
            );

        if (adminUid) {
            baseQuery =
                baseQuery.where(
                    "adminUid",
                    "==",
                    adminUid
                );
        }

        if (action) {
            baseQuery =
                baseQuery.where(
                    "action",
                    "==",
                    action
                );
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

        const page =
            buildPage(
                snapshot,
                resultLimit
            );

        const auditLogs =
            page.documents.map(
                (
                    documentSnapshot
                ) =>
                    serializeValue({
                        id:
                            documentSnapshot.id,

                        ...documentSnapshot
                            .data()
                    })
            );

        return {
            success:
                true,

            count:
                auditLogs.length,

            total:
                toNonNegativeInteger(
                    totalSnapshot
                        .data()
                        ?.count
                ),

            adminUid,

            action,

            auditLogs,

            hasMore:
                page.hasMore,

            nextCursor:
                page.nextCursor
        };
    } catch (error) {
        throwHttpsError(
            error,
            "Admin audit logs could not be loaded."
        );
    }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = Object.freeze({
    getAdminSession,
    getAdminDashboardSummary,

    getAdminUsers,
    getAdminUserDetails,

    updateAdminUserProfile,
    adjustAdminWallet,

    getAdminTransactions,
    getAdminAuditLogs,

    normalizeProfileStatus,
    validateProfileStatus,

    normalizeWalletDirection:
        normalizeDirection,

    validateWalletDirection:
        validateDirection,

    serializeValue
});