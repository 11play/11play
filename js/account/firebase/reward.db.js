"use strict";

/* =========================================================
   11PLAY — REWARD CLIENT DATA MODULE
   File: js/account/firebase/reward.db.js

   Responsibilities:
   - Aggregate canonical referral statistics and wallet data
   - Load referral-reward ledger transactions
   - Expose Reward Center summary data
   - Preserve compatibility with existing Reward UI fields
   - Refresh after referral or wallet changes
   - Prevent stale cross-account responses
   - Never create, approve, or credit rewards from the client

   Backend authority:
   - getMyReferralStats
   - getMyWallet
   - getMyWalletTransactions
   - approveReferral (Admin only)

   Reward rule:
   One rewarded referral = ৳1000
========================================================= */

(function initializeRewardDB(
    window,
    document
) {
    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const REWARD_PER_REFERRAL =
        1000;

    const DEFAULT_TRANSACTION_LIMIT =
        100;

    const MAXIMUM_TRANSACTION_LIMIT =
        100;

    const REFRESH_COOLDOWN_MS =
        10 * 1000;

    const LINKED_SYNC_DELAY_MS =
        100;

    const GOOGLE_PROVIDER_ID =
        "google.com";

    const REFERRAL_REWARD_TYPE =
        "referral_reward";

    const EVENT_UPDATED =
        "reward:updated";

    const EVENT_LOADING =
        "reward:loading";

    const EVENT_ERROR =
        "reward:error";

    const EVENT_TRANSACTIONS_UPDATED =
        "reward:transactions-updated";

    const EVENT_ACCESS_BLOCKED =
        "reward:access-blocked";

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const listeners =
        new Set();

    const state = {
        initialized:
            false,

        loading:
            false,

        currentUser:
            null,

        transactionLimit:
            DEFAULT_TRANSACTION_LIMIT,

        summary:
            createEmptySummary(),

        rewardTransactions:
            [],

        lastUpdatedAt:
            null,

        error:
            null
    };

    let authUnsubscribe =
        null;

    let readyPromise =
        null;

    let boundEvents =
        false;

    let linkedSyncTimer =
        null;

    let requestSequence =
        0;

    let transactionRequestSequence =
        0;

    let dataGeneration =
        0;

    let lastRefreshStartedAt =
        0;

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function isPlainObject(value) {
        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            return false;
        }

        const prototype =
            Object.getPrototypeOf(value);

        return (
            prototype ===
                Object.prototype ||
            prototype ===
                null
        );
    }

    function toSafeString(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .normalize("NFKC")
            .trim();
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
        const number =
            Math.floor(
                toSafeNumber(
                    value,
                    fallback
                )
            );

        if (
            !Number.isSafeInteger(number) ||
            number < 0
        ) {
            return Math.max(
                0,
                Math.floor(
                    toSafeNumber(
                        fallback,
                        0
                    )
                )
            );
        }

        return number;
    }

    function toSafeLimit(value) {
        return Math.min(
            MAXIMUM_TRANSACTION_LIMIT,

            Math.max(
                1,

                Math.floor(
                    toSafeNumber(
                        value,
                        DEFAULT_TRANSACTION_LIMIT
                    )
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

        return Number.isSafeInteger(result)
            ? result
            : Number.MAX_SAFE_INTEGER;
    }

    function safeAdd(
        firstValue,
        secondValue
    ) {
        const result =
            toNonNegativeInteger(
                firstValue
            ) +
            toNonNegativeInteger(
                secondValue
            );

        return Number.isSafeInteger(result)
            ? result
            : Number.MAX_SAFE_INTEGER;
    }

    function cloneValue(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        try {
            return JSON.parse(
                JSON.stringify(value)
            );
        } catch {
            return value;
        }
    }

    function serializeTimestamp(value) {
        if (!value) {
            return null;
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

        if (
            typeof value.toMillis ===
            "function"
        ) {
            try {
                return new Date(
                    value.toMillis()
                ).toISOString();
            } catch {
                return null;
            }
        }

        if (
            isPlainObject(value) &&
            typeof value.seconds ===
                "number"
        ) {
            try {
                return new Date(
                    value.seconds * 1000
                ).toISOString();
            } catch {
                return null;
            }
        }

        const parsedDate =
            new Date(value);

        return Number.isNaN(
            parsedDate.getTime()
        )
            ? null
            : parsedDate.toISOString();
    }

    function normalizeError(error) {
        const details =
            isPlainObject(
                error?.details
            )
                ? error.details
                : null;

        return {
            code:
                toSafeString(
                    error?.code
                ).replace(
                    /^functions\//,
                    ""
                ) ||
                "reward-error",

            message:
                toSafeString(
                    error?.message ||
                    details?.message
                ) ||
                "Reward information could not be loaded.",

            field:
                toSafeString(
                    details?.field
                ),

            reason:
                toSafeString(
                    details?.reason
                ),

            details
        };
    }

    function unwrapCallableResult(
        response
    ) {
        if (
            response &&
            typeof response ===
                "object" &&
            Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "data"
                ) &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "stats"
                ) &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "wallet"
                ) &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "transactions"
                )
        ) {
            return response.data;
        }

        return response;
    }

    /* =====================================================
       MONEY FORMATTING
    ===================================================== */

    function formatMoney(
        amount,
        options = {}
    ) {
        const includeSymbol =
            options.includeSymbol !==
            false;

        const includeDecimals =
            options.includeDecimals ===
            true;

        const value =
            toNonNegativeInteger(
                amount
            );

        const formatted =
            new Intl.NumberFormat(
                "en-BD",
                {
                    minimumFractionDigits:
                        includeDecimals
                            ? 2
                            : 0,

                    maximumFractionDigits:
                        includeDecimals
                            ? 2
                            : 0
                }
            ).format(value);

        return includeSymbol
            ? `৳${formatted}`
            : formatted;
    }

    /* =====================================================
       REFERRAL STATISTICS NORMALIZATION
    ===================================================== */

    function normalizeReferralStats(
        stats,
        uid = ""
    ) {
        const source =
            isPlainObject(stats)
                ? stats
                : {};

        const pending =
            toNonNegativeInteger(
                source.pending ??
                source.observing
            );

        const qualified =
            toNonNegativeInteger(
                source.qualified ??
                source.pendingReview
            );

        const approved =
            toNonNegativeInteger(
                source.approved
            );

        const rejected =
            toNonNegativeInteger(
                source.rejected ??
                source.invalid
            );

        const rewarded =
            toNonNegativeInteger(
                source.rewarded ??
                source.valid
            );

        const reconstructedTotal =
            pending +
            qualified +
            rejected +
            rewarded;

        const totalRewardProvided =
            Object.prototype
                .hasOwnProperty
                .call(
                    source,
                    "totalReward"
                );

        return {
            uid:
                toSafeString(
                    source.uid ||
                    uid
                ),

            total:
                toNonNegativeInteger(
                    source.total,
                    reconstructedTotal
                ),

            pending,
            qualified,
            approved,
            rejected,
            rewarded,

            totalReward:
                toNonNegativeInteger(
                    source.totalReward
                ),

            totalRewardProvided,

            createdAt:
                serializeTimestamp(
                    source.createdAt
                ),

            updatedAt:
                serializeTimestamp(
                    source.updatedAt
                )
        };
    }

    /* =====================================================
       WALLET NORMALIZATION
    ===================================================== */

    function normalizeWallet(
        wallet,
        uid = ""
    ) {
        const source =
            isPlainObject(wallet)
                ? wallet
                : {};

        return {
            uid:
                toSafeString(
                    source.uid ||
                    source.userId ||
                    uid
                ),

            availableBalance:
                toNonNegativeInteger(
                    source.availableBalance
                ),

            heldBalance:
                toNonNegativeInteger(
                    source.heldBalance
                ),

            totalEarned:
                toNonNegativeInteger(
                    source.totalEarned
                ),

            totalWithdrawn:
                toNonNegativeInteger(
                    source.totalWithdrawn
                ),

            revision:
                toNonNegativeInteger(
                    source.revision
                ),

            updatedAt:
                serializeTimestamp(
                    source.updatedAt
                )
        };
    }

    /* =====================================================
       REWARD TRANSACTION NORMALIZATION
    ===================================================== */

    function normalizeTransactionType(value) {
        return toSafeString(value)
            .toLowerCase()
            .replace(
                /[\s-]+/g,
                "_"
            );
    }

    function normalizeTransactionStatus(value) {
        const status =
            toSafeString(value)
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        switch (status) {
            case "completed":
            case "complete":
            case "successful":
            case "success":
                return "completed";

            case "pending":
                return "pending";

            case "reversed":
            case "reverse":
                return "reversed";

            case "failed":
            case "failure":
                return "failed";

            default:
                return "completed";
        }
    }

    function normalizeRewardTransaction(
        transaction,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(transaction)
                ? transaction
                : {};

        const metadata =
            isPlainObject(
                source.metadata
            )
                ? source.metadata
                : {};

        const amount =
            toNonNegativeInteger(
                source.amount
            );

        const status =
            normalizeTransactionStatus(
                source.status
            );

        return {
            id:
                toSafeString(
                    source.id ||
                    source.transactionId ||
                    fallbackId
                ),

            transactionId:
                toSafeString(
                    source.transactionId ||
                    source.id ||
                    fallbackId
                ),

            userId:
                toSafeString(
                    source.userId ||
                    source.uid
                ),

            uid:
                toSafeString(
                    source.uid ||
                    source.userId
                ),

            type:
                REFERRAL_REWARD_TYPE,

            direction:
                "credit",

            amount,

            formattedAmount:
                `+${formatMoney(amount)}`,

            status,

            referenceId:
                toSafeString(
                    source.referenceId
                ),

            operationId:
                toSafeString(
                    source.operationId ||
                    source.requestId
                ),

            referralId:
                toSafeString(
                    metadata.referralId ||
                    metadata.referredUid ||
                    source.referenceId
                ),

            referredUid:
                toSafeString(
                    metadata.referredUid
                ),

            referralCode:
                toSafeString(
                    metadata.referralCode
                ).toUpperCase(),

            source:
                toSafeString(
                    metadata.source
                ),

            availableBalanceBefore:
                toNonNegativeInteger(
                    source.availableBalanceBefore
                ),

            availableBalanceAfter:
                toNonNegativeInteger(
                    source.availableBalanceAfter
                ),

            totalEarnedBefore:
                toNonNegativeInteger(
                    source.totalEarnedBefore
                ),

            totalEarnedAfter:
                toNonNegativeInteger(
                    source.totalEarnedAfter
                ),

            adminUid:
                toSafeString(
                    source.adminUid
                ),

            note:
                toSafeString(
                    source.note
                ),

            createdAt:
                serializeTimestamp(
                    source.createdAt
                ),

            updatedAt:
                serializeTimestamp(
                    source.updatedAt
                )
        };
    }

    function normalizeRewardTransactions(
        transactions
    ) {
        if (!Array.isArray(transactions)) {
            return [];
        }

        return transactions
            .filter(
                (transaction) =>
                    normalizeTransactionType(
                        transaction?.type
                    ) ===
                    REFERRAL_REWARD_TYPE
            )
            .map(
                (transaction) =>
                    normalizeRewardTransaction(
                        transaction,
                        transaction?.id
                    )
            )
            .sort(
                (
                    firstTransaction,
                    secondTransaction
                ) => {
                    const firstTime =
                        firstTransaction.createdAt
                            ? new Date(
                                firstTransaction.createdAt
                            ).getTime()
                            : 0;

                    const secondTime =
                        secondTransaction.createdAt
                            ? new Date(
                                secondTransaction.createdAt
                            ).getTime()
                            : 0;

                    return secondTime -
                        firstTime;
                }
            );
    }

    function calculateLoadedLedgerRewardTotal(
        transactions
    ) {
        return transactions.reduce(
            (
                total,
                transaction
            ) => {
                if (
                    transaction.status !==
                    "completed"
                ) {
                    return total;
                }

                return safeAdd(
                    total,
                    transaction.amount
                );
            },
            0
        );
    }

    /* =====================================================
       EMPTY AND AGGREGATED SUMMARY
    ===================================================== */

    function createEmptySummary(
        uid = ""
    ) {
        return {
            uid:
                toSafeString(uid),

            rewardPerReferral:
                REWARD_PER_REFERRAL,

            totalReferrals:
                0,

            pendingReferrals:
                0,

            qualifiedReferrals:
                0,

            approvedReferrals:
                0,

            rejectedReferrals:
                0,

            rewardedReferrals:
                0,

            creditedReward:
                0,

            pendingPotentialReward:
                0,

            qualifiedPotentialReward:
                0,

            uncreditedPotentialReward:
                0,

            loadedLedgerRewardTotal:
                0,

            loadedRewardTransactionCount:
                0,

            availableBalance:
                0,

            heldBalance:
                0,

            totalEarned:
                0,

            totalWithdrawn:
                0,

            referralCode:
                "",

            referralLink:
                "",

            /*
             * Existing Reward UI compatibility aliases.
             */

            rewardPerValidReferral:
                REWARD_PER_REFERRAL,

            observingReferrals:
                0,

            pendingReviewReferrals:
                0,

            validReferrals:
                0,

            invalidReferrals:
                0,

            approvedReward:
                0,

            pendingReviewReward:
                0,

            observingPotentialReward:
                0,

            ledgerRewardTotal:
                0
        };
    }

    function createRewardSummary({
        uid = "",
        stats = {},
        wallet = {},
        transactions = [],
        referralCode = "",
        referralLink = ""
    } = {}) {
        const normalizedStats =
            normalizeReferralStats(
                stats,
                uid
            );

        const normalizedWallet =
            normalizeWallet(
                wallet,
                uid
            );

        const rewardTransactions =
            normalizeRewardTransactions(
                transactions
            );

        const loadedLedgerRewardTotal =
            calculateLoadedLedgerRewardTotal(
                rewardTransactions
            );

        const creditedReward =
            normalizedStats
                .totalRewardProvided
                ? normalizedStats
                    .totalReward
                : loadedLedgerRewardTotal;

        const pendingPotentialReward =
            safeMultiply(
                normalizedStats.pending,
                REWARD_PER_REFERRAL
            );

        const qualifiedPotentialReward =
            safeMultiply(
                normalizedStats.qualified,
                REWARD_PER_REFERRAL
            );

        const uncreditedPotentialReward =
            safeAdd(
                pendingPotentialReward,
                qualifiedPotentialReward
            );

        return {
            uid:
                toSafeString(
                    uid ||
                    normalizedStats.uid ||
                    normalizedWallet.uid
                ),

            rewardPerReferral:
                REWARD_PER_REFERRAL,

            totalReferrals:
                normalizedStats.total,

            pendingReferrals:
                normalizedStats.pending,

            qualifiedReferrals:
                normalizedStats.qualified,

            approvedReferrals:
                normalizedStats.approved,

            rejectedReferrals:
                normalizedStats.rejected,

            rewardedReferrals:
                normalizedStats.rewarded,

            creditedReward,

            pendingPotentialReward,

            qualifiedPotentialReward,

            uncreditedPotentialReward,

            loadedLedgerRewardTotal,

            loadedRewardTransactionCount:
                rewardTransactions.length,

            availableBalance:
                normalizedWallet
                    .availableBalance,

            heldBalance:
                normalizedWallet
                    .heldBalance,

            totalEarned:
                normalizedWallet
                    .totalEarned,

            totalWithdrawn:
                normalizedWallet
                    .totalWithdrawn,

            referralCode:
                toSafeString(
                    referralCode
                ).toUpperCase(),

            referralLink:
                toSafeString(
                    referralLink
                ),

            /*
             * Existing Reward UI compatibility aliases.
             */

            rewardPerValidReferral:
                REWARD_PER_REFERRAL,

            observingReferrals:
                normalizedStats.pending,

            pendingReviewReferrals:
                normalizedStats.qualified,

            validReferrals:
                normalizedStats.rewarded,

            invalidReferrals:
                normalizedStats.rejected,

            approvedReward:
                creditedReward,

            pendingReviewReward:
                qualifiedPotentialReward,

            observingPotentialReward:
                pendingPotentialReward,

            ledgerRewardTotal:
                loadedLedgerRewardTotal
        };
    }

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

    function getState() {
        return cloneValue({
            initialized:
                state.initialized,

            loading:
                state.loading,

            currentUser:
                state.currentUser
                    ? {
                        uid:
                            toSafeString(
                                state.currentUser.uid
                            ),

                        email:
                            toSafeString(
                                state.currentUser.email
                            )
                    }
                    : null,

            transactionLimit:
                state.transactionLimit,

            summary:
                state.summary,

            rewardTransactions:
                state.rewardTransactions,

            lastUpdatedAt:
                state.lastUpdatedAt,

            error:
                state.error
        });
    }

    function dispatchRewardEvent(
        eventName,
        snapshot = getState()
    ) {
        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail:
                        snapshot
                }
            )
        );
    }

    function notify(
        eventName = EVENT_UPDATED
    ) {
        const snapshot =
            getState();

        listeners.forEach(
            (listener) => {
                try {
                    listener(snapshot);
                } catch (error) {
                    console.error(
                        "[RewardDB] Subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatchRewardEvent(
            eventName,
            snapshot
        );

        return snapshot;
    }

    function setLoading(value) {
        const loading =
            value === true;

        if (
            state.loading ===
            loading
        ) {
            return false;
        }

        state.loading =
            loading;

        dispatchRewardEvent(
            EVENT_LOADING
        );

        return true;
    }

    function clearError() {
        state.error =
            null;
    }

    function setError(error) {
        state.error =
            normalizeError(error);

        notify(EVENT_ERROR);

        return state.error;
    }

    function reportAccessBlocked(reason) {
        state.error = {
            code:
                "reward-access-blocked",

            message:
                "Verified Google sign-in is required.",

            field:
                "",

            reason:
                toSafeString(reason),

            details:
                null
        };

        notify(EVENT_ACCESS_BLOCKED);

        return getState();
    }

    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    function resolveAuth() {
        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        if (configuredAuth) {
            return configuredAuth;
        }

        if (
            window.firebase &&
            typeof window.firebase.auth ===
                "function"
        ) {
            try {
                return window.firebase.auth();
            } catch {
                return null;
            }
        }

        return null;
    }

    function resolveCurrentUser() {
        const authService =
            window.AuthService ||
            null;

        if (
            authService &&
            typeof authService
                .getCurrentUser ===
                "function"
        ) {
            const user =
                authService
                    .getCurrentUser();

            if (user?.uid) {
                return user;
            }
        }

        if (
            authService &&
            typeof authService
                .getFirebaseUser ===
                "function"
        ) {
            const user =
                authService
                    .getFirebaseUser();

            if (user?.uid) {
                return user;
            }
        }

        return (
            resolveAuth()
                ?.currentUser ||
            null
        );
    }

    async function waitForAuthReady() {
        if (
            window.AuthGuard &&
            typeof window.AuthGuard
                .whenReady ===
                "function"
        ) {
            try {
                await window.AuthGuard
                    .whenReady();
            } catch (error) {
                console.warn(
                    "[RewardDB] AuthGuard initialization did not complete.",
                    error
                );
            }
        } else if (
            window.AuthService &&
            typeof window.AuthService
                .whenReady ===
                "function"
        ) {
            try {
                await window.AuthService
                    .whenReady();
            } catch (error) {
                console.warn(
                    "[RewardDB] AuthService initialization did not complete.",
                    error
                );
            }
        }

        return resolveCurrentUser();
    }

    function getProviderIds(user) {
        if (
            Array.isArray(
                user?.providerIds
            )
        ) {
            return user.providerIds
                .map(toSafeString)
                .filter(Boolean);
        }

        if (
            Array.isArray(
                user?.providerData
            )
        ) {
            return user.providerData
                .map(
                    (provider) =>
                        toSafeString(
                            provider?.providerId
                        )
                )
                .filter(Boolean);
        }

        return [];
    }

    async function requireRewardUser() {
        if (
            window.AuthGuard &&
            typeof window.AuthGuard
                .requireRewardAccess ===
                "function"
        ) {
            return window.AuthGuard
                .requireRewardAccess({
                    action:
                        "reward",

                    interactive:
                        false,

                    requireVerifiedEmail:
                        true
                });
        }

        await waitForAuthReady();

        const user =
            resolveCurrentUser();

        if (!user?.uid) {
            const error =
                new Error(
                    "Google sign-in is required."
                );

            error.code =
                "unauthenticated";

            throw error;
        }

        const providerIds =
            getProviderIds(user);

        const googleConnected =
            user.isGoogleConnected ===
                true ||
            user.googleConnected ===
                true ||
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            );

        if (!googleConnected) {
            const error =
                new Error(
                    "A Google-connected account is required."
                );

            error.code =
                "google-account-required";

            throw error;
        }

        if (
            user.emailVerified !==
            true
        ) {
            const error =
                new Error(
                    "A verified Google email is required."
                );

            error.code =
                "verified-email-required";

            throw error;
        }

        if (
            user.isGoogleSignIn ===
                true ||
            user.signInProvider ===
                GOOGLE_PROVIDER_ID
        ) {
            return user;
        }

        const firebaseUser =
            resolveAuth()
                ?.currentUser ||
            null;

        if (
            firebaseUser?.uid ===
                user.uid &&
            typeof firebaseUser
                .getIdTokenResult ===
                "function"
        ) {
            const tokenResult =
                await firebaseUser
                    .getIdTokenResult(
                        false
                    );

            const signInProvider =
                toSafeString(
                    tokenResult
                        ?.signInProvider ||
                    tokenResult
                        ?.claims
                        ?.firebase
                        ?.sign_in_provider
                );

            if (
                signInProvider ===
                GOOGLE_PROVIDER_ID
            ) {
                return user;
            }
        }

        const error =
            new Error(
                "Sign in directly with Google to continue."
            );

        error.code =
            "google-sign-in-required";

        throw error;
    }

    /* =====================================================
       CLOUD FUNCTIONS CLIENT
    ===================================================== */

    function requireFunctionsClient() {
        const client =
            window.FunctionsClient ||
            null;

        if (!client) {
            const error =
                new Error(
                    "Firebase Functions Client is not loaded."
                );

            error.code =
                "functions-client-not-loaded";

            throw error;
        }

        return client;
    }

    async function callBackend(
        methodName,
        functionName,
        payload = {}
    ) {
        const client =
            requireFunctionsClient();

        if (
            typeof client[methodName] ===
                "function"
        ) {
            return unwrapCallableResult(
                await client[methodName](
                    payload
                )
            );
        }

        if (
            typeof client.call ===
                "function"
        ) {
            return unwrapCallableResult(
                await client.call(
                    functionName,
                    payload
                )
            );
        }

        const error =
            new Error(
                `Callable client method is unavailable: ${functionName}`
            );

        error.code =
            "callable-method-unavailable";

        throw error;
    }

    function extractStats(result) {
        if (
            isPlainObject(
                result?.stats
            )
        ) {
            return result.stats;
        }

        if (
            isPlainObject(result) &&
            (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        result,
                        "total"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        result,
                        "pending"
                    )
            )
        ) {
            return result;
        }

        return {};
    }

    function extractWallet(result) {
        if (
            isPlainObject(
                result?.wallet
            )
        ) {
            return result.wallet;
        }

        if (
            isPlainObject(result) &&
            (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        result,
                        "availableBalance"
                    ) ||
                Object.prototype
                    .hasOwnProperty
                    .call(
                        result,
                        "heldBalance"
                    )
            )
        ) {
            return result;
        }

        return {};
    }

    function extractTransactions(result) {
        if (
            Array.isArray(
                result?.transactions
            )
        ) {
            return result.transactions;
        }

        if (Array.isArray(result)) {
            return result;
        }

        return [];
    }

    /* =====================================================
       LINKED MODULE ACCESS
    ===================================================== */

    function readReferralState() {
        if (
            window.ReferralDB &&
            typeof window.ReferralDB
                .getState ===
                "function"
        ) {
            try {
                return window.ReferralDB
                    .getState();
            } catch {
                return null;
            }
        }

        return null;
    }

    function readWalletState() {
        if (
            window.WalletDB &&
            typeof window.WalletDB
                .getState ===
                "function"
        ) {
            try {
                return window.WalletDB
                    .getState();
            } catch {
                return null;
            }
        }

        return null;
    }

    function readReferralIdentity() {
        if (
            window.ReferralDB &&
            typeof window.ReferralDB
                .getReferralIdentity ===
                "function"
        ) {
            try {
                return window.ReferralDB
                    .getReferralIdentity();
            } catch {
                // Continue to profile state.
            }
        }

        let profile =
            null;

        if (
            window.ProfileDB &&
            typeof window.ProfileDB
                .getProfile ===
                "function"
        ) {
            try {
                profile =
                    window.ProfileDB
                        .getProfile();
            } catch {
                profile =
                    null;
            }
        }

        if (
            !profile &&
            window.ProfileService &&
            typeof window.ProfileService
                .getUser ===
                "function"
        ) {
            try {
                profile =
                    window.ProfileService
                        .getUser();
            } catch {
                profile =
                    null;
            }
        }

        const referralCode =
            toSafeString(
                profile?.referralCode
            ).toUpperCase();

        let referralLink =
            toSafeString(
                profile?.referralLink
            );

        if (
            !referralLink &&
            referralCode &&
            window.ReferralCapture &&
            typeof window.ReferralCapture
                .buildReferralLink ===
                "function"
        ) {
            referralLink =
                window.ReferralCapture
                    .buildReferralLink(
                        referralCode
                    );
        }

        return {
            referralCode,
            referralLink
        };
    }

    async function loadReferralStats() {
        if (
            window.ReferralDB &&
            typeof window.ReferralDB
                .refreshStats ===
                "function"
        ) {
            await window.ReferralDB
                .refreshStats({
                    notifyChange:
                        false
                });

            if (
                typeof window.ReferralDB
                    .getStats ===
                    "function"
            ) {
                return window.ReferralDB
                    .getStats();
            }

            return readReferralState()
                ?.stats ||
                {};
        }

        const result =
            await callBackend(
                "getMyReferralStats",
                "getMyReferralStats",
                {}
            );

        return extractStats(result);
    }

    async function loadWallet() {
        if (
            window.WalletDB &&
            typeof window.WalletDB
                .refreshWallet ===
                "function"
        ) {
            await window.WalletDB
                .refreshWallet({
                    notifyChange:
                        false
                });

            if (
                typeof window.WalletDB
                    .getWallet ===
                    "function"
            ) {
                return window.WalletDB
                    .getWallet();
            }

            return readWalletState()
                ?.wallet ||
                {};
        }

        const result =
            await callBackend(
                "getMyWallet",
                "getMyWallet",
                {}
            );

        return extractWallet(result);
    }

    async function loadRewardTransactions(
        limit
    ) {
        const result =
            await callBackend(
                "getMyWalletTransactions",
                "getMyWalletTransactions",
                {
                    limit:
                        toSafeLimit(limit),

                    type:
                        REFERRAL_REWARD_TYPE
                }
            );

        return normalizeRewardTransactions(
            extractTransactions(result)
        );
    }

    /* =====================================================
       SYNCHRONIZE FROM LINKED MODULES
    ===================================================== */

    function synchronizeFromModules(
        options = {}
    ) {
        const user =
            resolveCurrentUser();

        if (!user?.uid) {
            return getState();
        }

        const referralState =
            readReferralState();

        const walletState =
            readWalletState();

        const referralUid =
            toSafeString(
                referralState
                    ?.currentUser
                    ?.uid ||
                referralState
                    ?.stats
                    ?.uid
            );

        const walletUid =
            toSafeString(
                walletState
                    ?.currentUser
                    ?.uid ||
                walletState
                    ?.wallet
                    ?.uid
            );

        if (
            referralUid &&
            referralUid !== user.uid
        ) {
            return getState();
        }

        if (
            walletUid &&
            walletUid !== user.uid
        ) {
            return getState();
        }

        const identity =
            readReferralIdentity();

        state.currentUser =
            user;

        state.summary =
            createRewardSummary({
                uid:
                    user.uid,

                stats:
                    referralState
                        ?.stats ||
                    {},

                wallet:
                    walletState
                        ?.wallet ||
                    {},

                transactions:
                    state.rewardTransactions,

                referralCode:
                    identity.referralCode,

                referralLink:
                    identity.referralLink
            });

        if (
            options.updateTimestamp !==
            false
        ) {
            state.lastUpdatedAt =
                new Date()
                    .toISOString();
        }

        clearError();

        if (
            options.notifyChange !==
            false
        ) {
            notify();
        }

        return getState();
    }

    /* =====================================================
       REFRESH REWARD TRANSACTIONS ONLY
    ===================================================== */

    async function refreshTransactions(
        options = {}
    ) {
        let user =
            null;

        try {
            user =
                await requireRewardUser();
        } catch (error) {
            const normalizedError =
                normalizeError(error);

            if (
                normalizedError.code ===
                "unauthenticated"
            ) {
                state.rewardTransactions =
                    [];

                if (
                    options.notifyChange !==
                    false
                ) {
                    notify(
                        EVENT_TRANSACTIONS_UPDATED
                    );
                }

                return [];
            }

            reportAccessBlocked(
                normalizedError.code
            );

            throw error;
        }

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.transactionLimit
            );

        const expectedUid =
            user.uid;

        const expectedGeneration =
            dataGeneration;

        const requestId =
            ++transactionRequestSequence;

        try {
            const transactions =
                await loadRewardTransactions(
                    normalizedLimit
                );

            if (
                requestId !==
                    transactionRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()?.uid !==
                    expectedUid
            ) {
                return cloneValue(
                    state.rewardTransactions
                );
            }

            state.transactionLimit =
                normalizedLimit;

            state.rewardTransactions =
                transactions;

            synchronizeFromModules({
                notifyChange:
                    false,

                updateTimestamp:
                    true
            });

            if (
                options.notifyChange !==
                false
            ) {
                notify(
                    EVENT_TRANSACTIONS_UPDATED
                );
            }

            return cloneValue(
                state.rewardTransactions
            );
        } catch (error) {
            if (
                requestId ===
                    transactionRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(error);
            }

            throw error;
        }
    }

    /* =====================================================
       COMPLETE REFRESH
    ===================================================== */

    async function refresh(
        options = {}
    ) {
        let user =
            null;

        try {
            user =
                await requireRewardUser();
        } catch (error) {
            const normalizedError =
                normalizeError(error);

            if (
                normalizedError.code ===
                "unauthenticated"
            ) {
                reset({
                    preserveInitialization:
                        true
                });

                return getState();
            }

            reset({
                preserveInitialization:
                    true,

                preserveCurrentUser:
                    true
            });

            return reportAccessBlocked(
                normalizedError.code
            );
        }

        const force =
            options.force ===
            true;

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.transactionLimit
            );

        const now =
            Date.now();

        if (
            !force &&
            state.loading
        ) {
            return getState();
        }

        if (
            !force &&
            state.lastUpdatedAt &&
            now -
                lastRefreshStartedAt <
                REFRESH_COOLDOWN_MS
        ) {
            return getState();
        }

        const expectedUid =
            user.uid;

        const expectedGeneration =
            dataGeneration;

        const requestId =
            ++requestSequence;

        const transactionRequestId =
            ++transactionRequestSequence;

        lastRefreshStartedAt =
            now;

        state.currentUser =
            user;

        state.transactionLimit =
            normalizedLimit;

        clearError();
        setLoading(true);

        try {
            const [
                stats,
                wallet,
                transactions
            ] = await Promise.all([
                loadReferralStats(),
                loadWallet(),
                loadRewardTransactions(
                    normalizedLimit
                )
            ]);

            if (
                requestId !==
                    requestSequence ||
                transactionRequestId !==
                    transactionRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()?.uid !==
                    expectedUid
            ) {
                return getState();
            }

            const identity =
                readReferralIdentity();

            state.rewardTransactions =
                transactions;

            state.summary =
                createRewardSummary({
                    uid:
                        expectedUid,

                    stats,
                    wallet,
                    transactions,

                    referralCode:
                        identity.referralCode,

                    referralLink:
                        identity.referralLink
                });

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            return getState();
        } catch (error) {
            if (
                requestId ===
                    requestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(error);
            }

            throw error;
        } finally {
            if (
                requestId ===
                    requestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setLoading(false);

                const snapshot =
                    notify();

                dispatchRewardEvent(
                    EVENT_TRANSACTIONS_UPDATED,
                    snapshot
                );
            }
        }
    }

    /* =====================================================
       FORMATTED REWARD SUMMARY
    ===================================================== */

    function getRewardSummary() {
        const summary =
            state.summary;

        return cloneValue({
            ...summary,

            creditedRewardText:
                formatMoney(
                    summary.creditedReward
                ),

            pendingPotentialRewardText:
                formatMoney(
                    summary.pendingPotentialReward
                ),

            qualifiedPotentialRewardText:
                formatMoney(
                    summary.qualifiedPotentialReward
                ),

            uncreditedPotentialRewardText:
                formatMoney(
                    summary.uncreditedPotentialReward
                ),

            loadedLedgerRewardTotalText:
                formatMoney(
                    summary.loadedLedgerRewardTotal
                ),

            availableBalanceText:
                formatMoney(
                    summary.availableBalance
                ),

            heldBalanceText:
                formatMoney(
                    summary.heldBalance
                ),

            totalEarnedText:
                formatMoney(
                    summary.totalEarned
                ),

            totalWithdrawnText:
                formatMoney(
                    summary.totalWithdrawn
                ),

            rewardPerReferralText:
                formatMoney(
                    summary.rewardPerReferral
                ),

            /*
             * Existing Reward UI compatibility aliases.
             */

            approvedRewardText:
                formatMoney(
                    summary.approvedReward
                ),

            pendingReviewRewardText:
                formatMoney(
                    summary.pendingReviewReward
                ),

            observingPotentialRewardText:
                formatMoney(
                    summary.observingPotentialReward
                ),

            ledgerRewardTotalText:
                formatMoney(
                    summary.ledgerRewardTotal
                ),

            rewardPerValidReferralText:
                formatMoney(
                    summary.rewardPerValidReferral
                )
        });
    }

    /* =====================================================
       RESET
    ===================================================== */

    function reset(
        options = {}
    ) {
        dataGeneration +=
            1;

        requestSequence +=
            1;

        transactionRequestSequence +=
            1;

        state.initialized =
            options.preserveInitialization ===
                true
                ? state.initialized
                : false;

        state.loading =
            false;

        if (
            options.preserveCurrentUser !==
            true
        ) {
            state.currentUser =
                null;
        }

        state.transactionLimit =
            DEFAULT_TRANSACTION_LIMIT;

        state.summary =
            createEmptySummary(
                options.preserveCurrentUser ===
                    true
                    ? state.currentUser
                        ?.uid
                    : ""
            );

        state.rewardTransactions =
            [];

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        lastRefreshStartedAt =
            0;

        clearLinkedSyncTimer();

        notify();

        return getState();
    }

    /* =====================================================
       AUTOMATIC UPDATE EVENTS
    ===================================================== */

    function clearLinkedSyncTimer() {
        if (
            linkedSyncTimer !==
            null
        ) {
            window.clearTimeout(
                linkedSyncTimer
            );

            linkedSyncTimer =
                null;
        }
    }

    function scheduleLinkedModuleSync() {
        if (
            state.loading ||
            !resolveCurrentUser()?.uid
        ) {
            return false;
        }

        clearLinkedSyncTimer();

        linkedSyncTimer =
            window.setTimeout(
                () => {
                    linkedSyncTimer =
                        null;

                    synchronizeFromModules({
                        notifyChange:
                            true,

                        updateTimestamp:
                            true
                    });
                },
                LINKED_SYNC_DELAY_MS
            );

        return true;
    }

    function handleRewardRefresh() {
        const user =
            resolveCurrentUser();

        if (!user?.uid) {
            return;
        }

        void refresh({
            force:
                true
        }).catch(
            () => {
                /*
                 * Error state is already published.
                 */
            }
        );
    }

    function handleWindowFocus() {
        const user =
            resolveCurrentUser();

        if (
            !user?.uid ||
            state.loading
        ) {
            return;
        }

        const lastUpdatedMilliseconds =
            state.lastUpdatedAt
                ? new Date(
                    state.lastUpdatedAt
                ).getTime()
                : 0;

        if (
            !lastUpdatedMilliseconds ||
            Date.now() -
                lastUpdatedMilliseconds >=
                REFRESH_COOLDOWN_MS
        ) {
            void refresh().catch(
                () => {
                    /*
                     * Error state is already published.
                     */
                }
            );
        }
    }

    function handleVisibilityChange() {
        if (
            document.visibilityState ===
            "visible"
        ) {
            handleWindowFocus();
        }
    }

    function handleLogout() {
        reset({
            preserveInitialization:
                true
        });
    }

    function bindBrowserEvents() {
        if (boundEvents) {
            return true;
        }

        boundEvents =
            true;

        const linkedDataEvents = [
            "wallet:updated",
            "wallet:transactions-updated",
            "referral:updated"
        ];

        linkedDataEvents.forEach(
            (eventName) => {
                window.addEventListener(
                    eventName,
                    scheduleLinkedModuleSync
                );
            }
        );

        const backendRefreshEvents = [
            "referral:approved",
            "referral:rewarded",
            "wallet:operation-completed",
            "reward:refresh"
        ];

        backendRefreshEvents.forEach(
            (eventName) => {
                window.addEventListener(
                    eventName,
                    handleRewardRefresh
                );
            }
        );

        window.addEventListener(
            "auth:before-logout",
            handleLogout
        );

        window.addEventListener(
            "profile:logout",
            handleLogout
        );

        window.addEventListener(
            "focus",
            handleWindowFocus
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        return true;
    }

    function unbindBrowserEvents() {
        if (!boundEvents) {
            return true;
        }

        boundEvents =
            false;

        const linkedDataEvents = [
            "wallet:updated",
            "wallet:transactions-updated",
            "referral:updated"
        ];

        linkedDataEvents.forEach(
            (eventName) => {
                window.removeEventListener(
                    eventName,
                    scheduleLinkedModuleSync
                );
            }
        );

        const backendRefreshEvents = [
            "referral:approved",
            "referral:rewarded",
            "wallet:operation-completed",
            "reward:refresh"
        ];

        backendRefreshEvents.forEach(
            (eventName) => {
                window.removeEventListener(
                    eventName,
                    handleRewardRefresh
                );
            }
        );

        window.removeEventListener(
            "auth:before-logout",
            handleLogout
        );

        window.removeEventListener(
            "profile:logout",
            handleLogout
        );

        window.removeEventListener(
            "focus",
            handleWindowFocus
        );

        document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        return true;
    }

    /* =====================================================
       AUTH STATE LISTENER
    ===================================================== */

    function bindAuthState() {
        if (authUnsubscribe) {
            return true;
        }

        const auth =
            resolveAuth();

        if (
            !auth ||
            typeof auth
                .onAuthStateChanged !==
                "function"
        ) {
            return false;
        }

        authUnsubscribe =
            auth.onAuthStateChanged(
                (firebaseUser) => {
                    if (firebaseUser?.uid) {
                        const previousUid =
                            state.currentUser
                                ?.uid ||
                            "";

                        if (
                            previousUid &&
                            previousUid !==
                                firebaseUser.uid
                        ) {
                            reset({
                                preserveInitialization:
                                    true
                            });
                        }

                        state.currentUser =
                            firebaseUser;

                        void refresh({
                            force:
                                true
                        }).catch(
                            () => {
                                /*
                                 * Error state is already published.
                                 */
                            }
                        );

                        return;
                    }

                    handleLogout();
                },

                (error) => {
                    setError(error);
                }
            );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (readyPromise) {
            return readyPromise;
        }

        readyPromise =
            (async () => {
                bindBrowserEvents();
                bindAuthState();

                const user =
                    await waitForAuthReady();

                state.initialized =
                    true;

                if (!user?.uid) {
                    notify();

                    return getState();
                }

                state.currentUser =
                    user;

                try {
                    await refresh({
                        force:
                            true
                    });
                } catch {
                    /*
                     * Error state is already published.
                     */
                }

                return getState();
            })().catch(
                (error) => {
                    state.initialized =
                        false;

                    readyPromise =
                        null;

                    setError(error);

                    throw error;
                }
            );

        return readyPromise;
    }

    /* =====================================================
       SUBSCRIPTION
    ===================================================== */

    function subscribe(
        listener,
        options = {}
    ) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new TypeError(
                "RewardDB subscriber must be a function."
            );
        }

        listeners.add(listener);

        if (
            options.emitCurrent !==
            false
        ) {
            listener(getState());
        }

        return function unsubscribe() {
            listeners.delete(listener);
        };
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        dataGeneration +=
            1;

        requestSequence +=
            1;

        transactionRequestSequence +=
            1;

        clearLinkedSyncTimer();

        if (
            typeof authUnsubscribe ===
                "function"
        ) {
            authUnsubscribe();
        }

        authUnsubscribe =
            null;

        unbindBrowserEvents();

        listeners.clear();

        readyPromise =
            null;

        state.initialized =
            false;

        state.loading =
            false;

        state.currentUser =
            null;

        state.transactionLimit =
            DEFAULT_TRANSACTION_LIMIT;

        state.summary =
            createEmptySummary();

        state.rewardTransactions =
            [];

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.RewardDB =
        Object.freeze({
            init,
            destroy,
            refresh,
            refreshTransactions,

            synchronizeFromModules,

            getState,
            getRewardSummary,

            getSummary() {
                return cloneValue(
                    state.summary
                );
            },

            getRewardTransactions() {
                return cloneValue(
                    state.rewardTransactions
                );
            },

            getCreditedReward() {
                return state.summary
                    .creditedReward;
            },

            getApprovedReward() {
                return state.summary
                    .approvedReward;
            },

            getPendingReviewReward() {
                return state.summary
                    .pendingReviewReward;
            },

            getAvailableBalance() {
                return state.summary
                    .availableBalance;
            },

            getRewardPerReferral() {
                return REWARD_PER_REFERRAL;
            },

            getRewardPerValidReferral() {
                return REWARD_PER_REFERRAL;
            },

            formatMoney,

            normalizeReferralStats,
            normalizeRewardTransaction,
            normalizeRewardTransactions,
            createRewardSummary,

            subscribe,
            reset,

            REWARD_PER_REFERRAL,

            REWARD_PER_VALID_REFERRAL:
                REWARD_PER_REFERRAL,

            REFERRAL_REWARD_TYPE
        });
})(
    window,
    document
);