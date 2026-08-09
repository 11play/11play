"use strict";

/* =========================================================
   11PLAY — WALLET CLIENT DATA MODULE
   File: js/account/firebase/wallet.db.js

   Responsibilities:
   - Load the authenticated user's wallet balances
   - Load permanent wallet transaction history
   - Load complete history through cursor-based pagination
   - Show available and held balances
   - Show total earned and total withdrawn
   - Normalize canonical wallet transaction records
   - Synchronize wallet data with ProfileService
   - Refresh after referral or withdrawal operations
   - Prevent stale cross-account responses
   - Never modify wallet balances directly

   Backend functions:
   - getMyWallet
   - getMyWalletTransactions

   Financial operations remain backend-only:
   - Referral reward credit
   - Withdrawal hold
   - Withdrawal completion
   - Withdrawal refund
   - Admin adjustment
========================================================= */

(function initializeWalletDB(
    window,
    document
) {
    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT =
        50;

    const MAXIMUM_LIMIT =
        100;

    const REFRESH_COOLDOWN_MS =
        10 * 1000;

    const FORCED_REFRESH_DELAY_MS =
        150;

    const GOOGLE_PROVIDER_ID =
        "google.com";

    const EVENT_UPDATED =
        "wallet:updated";

    const EVENT_LOADING =
        "wallet:loading";

    const EVENT_ERROR =
        "wallet:error";

    const EVENT_TRANSACTIONS_UPDATED =
        "wallet:transactions-updated";

    const EVENT_ACCESS_BLOCKED =
        "wallet:access-blocked";

    const TRANSACTION_TYPES =
        Object.freeze({
            REFERRAL_REWARD:
                "referral_reward",

            WITHDRAW_HOLD:
                "withdraw_hold",

            WITHDRAW_SUCCESS:
                "withdraw_success",

            WITHDRAW_REFUND:
                "withdraw_refund",

            ADMIN_ADJUSTMENT:
                "admin_adjustment"
        });

    const TRANSACTION_DIRECTIONS =
        Object.freeze({
            CREDIT:
                "credit",

            DEBIT:
                "debit"
        });

    const TRANSACTION_STATUSES =
        Object.freeze({
            PENDING:
                "pending",

            COMPLETED:
                "completed",

            REVERSED:
                "reversed",

            FAILED:
                "failed"
        });

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

        loadingMore:
            false,

        currentUser:
            null,

        limit:
            DEFAULT_LIMIT,

        nextCursor:
            "",

        hasMore:
            false,

        wallet:
            createEmptyWallet(),

        transactions:
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

    let forcedRefreshTimer =
        null;

    let activeRequestCount =
        0;

    let dataGeneration =
        0;

    let refreshRequestSequence =
        0;

    let walletRequestSequence =
        0;

    let transactionRequestSequence =
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

    function toMoneyInteger(
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
                Math.min(
                    Number.MAX_SAFE_INTEGER,
                    Math.floor(
                        toSafeNumber(
                            fallback,
                            0
                        )
                    )
                )
            );
        }

        return number;
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
            MAXIMUM_LIMIT,

            Math.max(
                1,

                Math.floor(
                    toSafeNumber(
                        value,
                        DEFAULT_LIMIT
                    )
                )
            )
        );
    }

    function safeAddMoney(
        firstValue,
        secondValue
    ) {
        const first =
            toMoneyInteger(
                firstValue
            );

        const second =
            toMoneyInteger(
                secondValue
            );

        const total =
            first + second;

        return Number.isSafeInteger(total)
            ? total
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
                "wallet-error",

            message:
                toSafeString(
                    error?.message ||
                    details?.message
                ) ||
                "Wallet information could not be loaded.",

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
            toMoneyInteger(
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
       TRANSACTION TYPE
    ===================================================== */

    function normalizeTransactionType(value) {
        const type =
            toSafeString(value)
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        return Object.values(
            TRANSACTION_TYPES
        ).includes(type)
            ? type
            : "";
    }

    function getTransactionTypeLabel(type) {
        switch (
            normalizeTransactionType(
                type
            )
        ) {
            case TRANSACTION_TYPES
                .REFERRAL_REWARD:

                return "Referral Reward";

            case TRANSACTION_TYPES
                .WITHDRAW_HOLD:

                return "Withdrawal Hold";

            case TRANSACTION_TYPES
                .WITHDRAW_SUCCESS:

                return "Withdrawal Completed";

            case TRANSACTION_TYPES
                .WITHDRAW_REFUND:

                return "Withdrawal Refund";

            case TRANSACTION_TYPES
                .ADMIN_ADJUSTMENT:

                return "Wallet Adjustment";

            default:
                return "Wallet Transaction";
        }
    }

    /* =====================================================
       TRANSACTION DIRECTION
    ===================================================== */

    function normalizeDirection(value) {
        const direction =
            toSafeString(value)
                .toLowerCase();

        if (
            direction ===
            TRANSACTION_DIRECTIONS.CREDIT
        ) {
            return TRANSACTION_DIRECTIONS
                .CREDIT;
        }

        if (
            direction ===
            TRANSACTION_DIRECTIONS.DEBIT
        ) {
            return TRANSACTION_DIRECTIONS
                .DEBIT;
        }

        return "";
    }

    function inferDirectionFromType(type) {
        switch (
            normalizeTransactionType(
                type
            )
        ) {
            case TRANSACTION_TYPES
                .REFERRAL_REWARD:

            case TRANSACTION_TYPES
                .WITHDRAW_REFUND:

                return TRANSACTION_DIRECTIONS
                    .CREDIT;

            case TRANSACTION_TYPES
                .WITHDRAW_HOLD:

            case TRANSACTION_TYPES
                .WITHDRAW_SUCCESS:

                return TRANSACTION_DIRECTIONS
                    .DEBIT;

            default:
                return "";
        }
    }

    function getDirectionLabel(direction) {
        const normalizedDirection =
            normalizeDirection(
                direction
            );

        if (
            normalizedDirection ===
            TRANSACTION_DIRECTIONS.CREDIT
        ) {
            return "Credit";
        }

        if (
            normalizedDirection ===
            TRANSACTION_DIRECTIONS.DEBIT
        ) {
            return "Debit";
        }

        return "";
    }

    function getSignedAmount(
        amount,
        direction
    ) {
        const normalizedAmount =
            toMoneyInteger(
                amount
            );

        return normalizeDirection(
            direction
        ) ===
            TRANSACTION_DIRECTIONS.DEBIT
            ? -normalizedAmount
            : normalizedAmount;
    }

    function formatTransactionAmount(
        amount,
        direction
    ) {
        const normalizedDirection =
            normalizeDirection(
                direction
            );

        if (!normalizedDirection) {
            return formatMoney(
                amount
            );
        }

        const sign =
            normalizedDirection ===
            TRANSACTION_DIRECTIONS.DEBIT
                ? "-"
                : "+";

        return `${sign}${formatMoney(
            amount
        )}`;
    }

    /* =====================================================
       TRANSACTION STATUS
    ===================================================== */

    function normalizeTransactionStatus(value) {
        const status =
            toSafeString(value)
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        switch (status) {
            case "pending":
                return TRANSACTION_STATUSES
                    .PENDING;

            case "completed":
            case "complete":
            case "successful":
            case "success":
                return TRANSACTION_STATUSES
                    .COMPLETED;

            case "reversed":
            case "reverse":
                return TRANSACTION_STATUSES
                    .REVERSED;

            case "failed":
            case "failure":
                return TRANSACTION_STATUSES
                    .FAILED;

            default:
                return "";
        }
    }

    function getTransactionStatusLabel(status) {
        switch (
            normalizeTransactionStatus(
                status
            )
        ) {
            case TRANSACTION_STATUSES
                .PENDING:

                return "Pending";

            case TRANSACTION_STATUSES
                .COMPLETED:

                return "Completed";

            case TRANSACTION_STATUSES
                .REVERSED:

                return "Reversed";

            case TRANSACTION_STATUSES
                .FAILED:

                return "Failed";

            default:
                return "";
        }
    }

    /* =====================================================
       EMPTY WALLET
    ===================================================== */

    function createEmptyWallet(uid = "") {
        return {
            uid:
                toSafeString(uid),

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

            revision:
                0,

            createdAt:
                null,

            updatedAt:
                null
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
                toMoneyInteger(
                    source.availableBalance
                ),

            heldBalance:
                toMoneyInteger(
                    source.heldBalance
                ),

            totalEarned:
                toMoneyInteger(
                    source.totalEarned
                ),

            totalWithdrawn:
                toMoneyInteger(
                    source.totalWithdrawn
                ),

            lastWithdrawalAmount:
                toMoneyInteger(
                    source.lastWithdrawalAmount
                ),

            lastWithdrawalAt:
                serializeTimestamp(
                    source.lastWithdrawalAt
                ),

            revision:
                toNonNegativeInteger(
                    source.revision
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

    function synchronizeProfileServiceWallet() {
        if (
            !window.ProfileService ||
            typeof window.ProfileService
                .setWallet !==
                "function"
        ) {
            return false;
        }

        try {
            window.ProfileService
                .setWallet(
                    state.wallet
                );

            return true;
        } catch (error) {
            console.warn(
                "[WalletDB] ProfileService wallet synchronization failed.",
                error
            );

            return false;
        }
    }

    /* =====================================================
       WALLET TRANSACTION NORMALIZATION
    ===================================================== */

    function normalizeTransaction(
        transaction,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(transaction)
                ? transaction
                : {};

        const type =
            normalizeTransactionType(
                source.type
            );

        const direction =
            normalizeDirection(
                source.direction
            ) ||
            inferDirectionFromType(
                type
            );

        const status =
            normalizeTransactionStatus(
                source.status
            ) ||
            TRANSACTION_STATUSES
                .COMPLETED;

        const amount =
            toMoneyInteger(
                source.amount
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

            type,

            typeLabel:
                getTransactionTypeLabel(
                    type
                ),

            direction,

            directionLabel:
                getDirectionLabel(
                    direction
                ),

            amount,

            signedAmount:
                getSignedAmount(
                    amount,
                    direction
                ),

            formattedAmount:
                formatTransactionAmount(
                    amount,
                    direction
                ),

            status,

            statusLabel:
                getTransactionStatusLabel(
                    status
                ),

            referenceId:
                toSafeString(
                    source.referenceId
                ),

            operationId:
                toSafeString(
                    source.operationId ||
                    source.requestId
                ),

            requestId:
                toSafeString(
                    source.requestId
                ),

            availableBalanceBefore:
                toMoneyInteger(
                    source.availableBalanceBefore
                ),

            availableBalanceAfter:
                toMoneyInteger(
                    source.availableBalanceAfter
                ),

            heldBalanceBefore:
                toMoneyInteger(
                    source.heldBalanceBefore
                ),

            heldBalanceAfter:
                toMoneyInteger(
                    source.heldBalanceAfter
                ),

            totalEarnedBefore:
                toMoneyInteger(
                    source.totalEarnedBefore
                ),

            totalEarnedAfter:
                toMoneyInteger(
                    source.totalEarnedAfter
                ),

            totalWithdrawnBefore:
                toMoneyInteger(
                    source.totalWithdrawnBefore
                ),

            totalWithdrawnAfter:
                toMoneyInteger(
                    source.totalWithdrawnAfter
                ),

            note:
                toSafeString(
                    source.note
                ),

            metadata:
                isPlainObject(
                    source.metadata
                )
                    ? cloneValue(
                        source.metadata
                    )
                    : {},

            adminUid:
                toSafeString(
                    source.adminUid
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

    function normalizeTransactions(transactions) {
        if (!Array.isArray(transactions)) {
            return [];
        }

        return transactions
            .map(
                (transaction) =>
                    normalizeTransaction(
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
                                firstTransaction
                                    .createdAt
                            ).getTime()
                            : 0;

                    const secondTime =
                        secondTransaction.createdAt
                            ? new Date(
                                secondTransaction
                                    .createdAt
                            ).getTime()
                            : 0;

                    if (
                        secondTime !==
                        firstTime
                    ) {
                        return secondTime -
                            firstTime;
                    }

                    return toSafeString(
                        secondTransaction
                            .transactionId ||
                        secondTransaction.id
                    ).localeCompare(
                        toSafeString(
                            firstTransaction
                                .transactionId ||
                            firstTransaction.id
                        )
                    );
                }
            );
    }

    function mergeUniqueTransactions(
        existingTransactions,
        incomingTransactions
    ) {
        const transactionsById =
            new Map();

        const transactionsWithoutId =
            [];

        [
            ...(
                Array.isArray(
                    existingTransactions
                )
                    ? existingTransactions
                    : []
            ),

            ...(
                Array.isArray(
                    incomingTransactions
                )
                    ? incomingTransactions
                    : []
            )
        ].forEach(
            (transaction) => {
                const transactionId =
                    toSafeString(
                        transaction
                            ?.transactionId ||
                        transaction?.id
                    );

                if (transactionId) {
                    transactionsById.set(
                        transactionId,
                        transaction
                    );
                } else {
                    transactionsWithoutId.push(
                        transaction
                    );
                }
            }
        );

        return normalizeTransactions([
            ...transactionsById.values(),
            ...transactionsWithoutId
        ]);
    }

    /* =====================================================
       RESULT EXTRACTION
    ===================================================== */

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

    function extractPaginationState(
        result,
        requestCursor = ""
    ) {
        const source =
            isPlainObject(result)
                ? result
                : {};

        const nestedSource =
            isPlainObject(
                source.data
            )
                ? source.data
                : {};

        const reportedHasMore =
            source.hasMore ===
                true ||
            nestedSource.hasMore ===
                true;

        const nextCursor =
            reportedHasMore
                ? toSafeString(
                    source.nextCursor ||
                    nestedSource.nextCursor
                )
                : "";

        if (
            reportedHasMore &&
            !nextCursor
        ) {
            const error =
                new Error(
                    "Wallet transaction pagination response is missing its next cursor."
                );

            error.code =
                "invalid-wallet-pagination-response";

            throw error;
        }

        const normalizedRequestCursor =
            toSafeString(
                requestCursor
            );

        if (
            reportedHasMore &&
            normalizedRequestCursor &&
            nextCursor ===
                normalizedRequestCursor
        ) {
            const error =
                new Error(
                    "Wallet transaction pagination returned the same cursor twice."
                );

            error.code =
                "repeated-wallet-pagination-cursor";

            throw error;
        }

        return {
            hasMore:
                reportedHasMore &&
                Boolean(nextCursor),

            nextCursor
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

            loadingMore:
                state.loadingMore,

            currentUser:
                state.currentUser
                    ? {
                        uid:
                            toSafeString(
                                state
                                    .currentUser
                                    .uid
                            ),

                        email:
                            toSafeString(
                                state
                                    .currentUser
                                    .email
                            )
                    }
                    : null,

            limit:
                state.limit,

            nextCursor:
                state.nextCursor,

            hasMore:
                state.hasMore,

            wallet:
                state.wallet,

            transactions:
                state.transactions,

            lastUpdatedAt:
                state.lastUpdatedAt,

            error:
                state.error
        });
    }

    function dispatchWalletEvent(
        eventName,
        snapshot =
            getState()
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
        eventName =
            EVENT_UPDATED
    ) {
        const snapshot =
            getState();

        listeners.forEach(
            (listener) => {
                try {
                    listener(
                        snapshot
                    );
                } catch (error) {
                    console.error(
                        "[WalletDB] Subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatchWalletEvent(
            eventName,
            snapshot
        );

        return snapshot;
    }

    function updateLoadingState() {
        const loading =
            activeRequestCount > 0;

        if (
            state.loading ===
            loading
        ) {
            return false;
        }

        state.loading =
            loading;

        dispatchWalletEvent(
            EVENT_LOADING
        );

        return true;
    }

    function beginRequest() {
        activeRequestCount +=
            1;

        updateLoadingState();
    }

    function endRequest() {
        activeRequestCount =
            Math.max(
                0,
                activeRequestCount - 1
            );

        updateLoadingState();
    }

    function clearError() {
        state.error =
            null;
    }

    function setError(error) {
        state.error =
            normalizeError(
                error
            );

        notify(
            EVENT_ERROR
        );

        return state.error;
    }

    function reportAccessBlocked(reason) {
        state.error = {
            code:
                "wallet-access-blocked",

            message:
                "Verified Google sign-in is required.",

            field:
                "",

            reason:
                toSafeString(reason),

            details:
                null
        };

        notify(
            EVENT_ACCESS_BLOCKED
        );

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
                return window.firebase
                    .auth();
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
                    "[WalletDB] AuthGuard initialization did not complete.",
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
                    "[WalletDB] AuthService initialization did not complete.",
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
                            provider
                                ?.providerId
                        )
                )
                .filter(Boolean);
        }

        return [];
    }

    async function requireWalletUser() {
        const authGuard =
            window.AuthGuard ||
            null;

        if (
            authGuard &&
            typeof authGuard
                .requireRewardAccess ===
                "function"
        ) {
            return authGuard
                .requireRewardAccess({
                    action:
                        "wallet",

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

    /* =====================================================
       LOAD WALLET
    ===================================================== */

    async function refreshWallet(
        options = {}
    ) {
        let user = null;

        try {
            user =
                await requireWalletUser();
        } catch (error) {
            state.wallet =
                createEmptyWallet();

            synchronizeProfileServiceWallet();

            if (
                normalizeError(error).code ===
                "unauthenticated"
            ) {
                if (
                    options.notifyChange !==
                    false
                ) {
                    notify();
                }

                return cloneValue(
                    state.wallet
                );
            }

            reportAccessBlocked(
                normalizeError(error).code
            );

            throw error;
        }

        const expectedUid =
            user.uid;

        const expectedGeneration =
            dataGeneration;

        const requestId =
            ++walletRequestSequence;

        beginRequest();
        clearError();

        try {
            const result =
                await callBackend(
                    "getMyWallet",
                    "getMyWallet",
                    {}
                );

            if (
                requestId !==
                    walletRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()?.uid !==
                    expectedUid
            ) {
                return cloneValue(
                    state.wallet
                );
            }

            state.wallet =
                normalizeWallet(
                    extractWallet(
                        result
                    ),
                    expectedUid
                );

            synchronizeProfileServiceWallet();

            if (
                options.notifyChange !==
                false
            ) {
                notify();
            }

            return cloneValue(
                state.wallet
            );
        } catch (error) {
            if (
                requestId ===
                    walletRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(error);
            }

            throw error;
        } finally {
            endRequest();
        }
    }

    /* =====================================================
       LOAD WALLET TRANSACTIONS
    ===================================================== */

    async function refreshTransactions(
        options = {}
    ) {
        let user = null;

        try {
            user =
                await requireWalletUser();
        } catch (error) {
            state.loadingMore =
                false;

            state.transactions =
                [];

            state.nextCursor =
                "";

            state.hasMore =
                false;

            if (
                normalizeError(error).code ===
                "unauthenticated"
            ) {
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
                normalizeError(error).code
            );

            throw error;
        }

        const append =
            options.append ===
                true;

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.limit
            );

        const cursor =
            append
                ? toSafeString(
                    options.cursor ??
                    state.nextCursor
                )
                : "";

        if (
            append &&
            (
                state.loading ||
                state.loadingMore ||
                !state.hasMore ||
                !cursor
            )
        ) {
            return cloneValue(
                state.transactions
            );
        }

        const payload = {
            limit:
                normalizedLimit
        };

        if (cursor) {
            payload.cursor =
                cursor;
        }

        const expectedUid =
            user.uid;

        const expectedGeneration =
            dataGeneration;

        const requestId =
            ++transactionRequestSequence;

        state.currentUser =
            user;

        state.loadingMore =
            append;

        beginRequest();
        clearError();

        try {
            const result =
                await callBackend(
                    "getMyWalletTransactions",
                    "getMyWalletTransactions",
                    payload
                );

            if (
                requestId !==
                    transactionRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()?.uid !==
                    expectedUid ||
                (
                    append &&
                    state.nextCursor !==
                        cursor
                )
            ) {
                return cloneValue(
                    state.transactions
                );
            }

            const pageTransactions =
                normalizeTransactions(
                    extractTransactions(
                        result
                    )
                );

            const pagination =
                extractPaginationState(
                    result,
                    cursor
                );

            if (!append) {
                state.limit =
                    normalizedLimit;
            }

            state.transactions =
                append
                    ? mergeUniqueTransactions(
                        state.transactions,
                        pageTransactions
                    )
                    : pageTransactions;

            state.nextCursor =
                pagination.nextCursor;

            state.hasMore =
                pagination.hasMore;

            state.loadingMore =
                false;

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            if (
                options.notifyChange !==
                false
            ) {
                notify(
                    EVENT_TRANSACTIONS_UPDATED
                );
            }

            return cloneValue(
                state.transactions
            );
        } catch (error) {
            if (
                requestId ===
                    transactionRequestSequence &&
                expectedGeneration ===
                    dataGeneration &&
                resolveCurrentUser()?.uid ===
                    expectedUid
            ) {
                state.loadingMore =
                    false;

                setError(error);
            }

            throw error;
        } finally {
            if (
                requestId ===
                    transactionRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                state.loadingMore =
                    false;
            }

            endRequest();
        }
    }

    /* =====================================================
       REFRESH COMPLETE WALLET DATA
    ===================================================== */

    async function refresh(
        options = {}
    ) {
        let user = null;

        try {
            user =
                await requireWalletUser();
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
                state.limit
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

        const refreshRequestId =
            ++refreshRequestSequence;

        const walletRequestId =
            ++walletRequestSequence;

        const transactionRequestId =
            ++transactionRequestSequence;

        lastRefreshStartedAt =
            now;

        state.currentUser =
            user;

        state.limit =
            normalizedLimit;

        state.loadingMore =
            false;

        clearError();
        beginRequest();

        try {
            const [
                walletResult,
                transactionResult
            ] = await Promise.all([
                callBackend(
                    "getMyWallet",
                    "getMyWallet",
                    {}
                ),

                callBackend(
                    "getMyWalletTransactions",
                    "getMyWalletTransactions",
                    {
                        limit:
                            normalizedLimit
                    }
                )
            ]);

            if (
                refreshRequestId !==
                    refreshRequestSequence ||
                walletRequestId !==
                    walletRequestSequence ||
                transactionRequestId !==
                    transactionRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()?.uid !==
                    expectedUid
            ) {
                return getState();
            }

            state.wallet =
                normalizeWallet(
                    extractWallet(
                        walletResult
                    ),
                    expectedUid
                );

            state.transactions =
                normalizeTransactions(
                    extractTransactions(
                        transactionResult
                    )
                );

            const pagination =
                extractPaginationState(
                    transactionResult
                );

            state.nextCursor =
                pagination.nextCursor;

            state.hasMore =
                pagination.hasMore;

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            synchronizeProfileServiceWallet();

            const snapshot =
                notify(
                    EVENT_UPDATED
                );

            dispatchWalletEvent(
                EVENT_TRANSACTIONS_UPDATED,
                snapshot
            );

            return snapshot;
        } catch (error) {
            if (
                refreshRequestId ===
                    refreshRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(error);
            }

            throw error;
        } finally {
            endRequest();
        }
    }

    /* =====================================================
       LOAD MORE TRANSACTIONS
    ===================================================== */

    async function loadMore(options = {}) {
        if (
            state.loading ||
            state.loadingMore ||
            !state.hasMore ||
            !state.nextCursor
        ) {
            return getState();
        }

        const normalizedOptions =
            isPlainObject(options)
                ? options
                : {
                    limit:
                        options
                };

        const pageLimit =
            toSafeLimit(
                normalizedOptions.limit ??
                25
            );

        await refreshTransactions({
            append:
                true,

            cursor:
                state.nextCursor,

            limit:
                pageLimit,

            notifyChange:
                normalizedOptions
                    .notifyChange !==
                    false
        });

        return getState();
    }

    /* =====================================================
       WALLET SUMMARY
    ===================================================== */

    function getWalletSummary() {
        const wallet =
            state.wallet;

        const totalBalance =
            safeAddMoney(
                wallet.availableBalance,
                wallet.heldBalance
            );

        return cloneValue({
            availableBalance:
                wallet.availableBalance,

            availableBalanceText:
                formatMoney(
                    wallet.availableBalance
                ),

            heldBalance:
                wallet.heldBalance,

            heldBalanceText:
                formatMoney(
                    wallet.heldBalance
                ),

            totalEarned:
                wallet.totalEarned,

            totalEarnedText:
                formatMoney(
                    wallet.totalEarned
                ),

            totalWithdrawn:
                wallet.totalWithdrawn,

            totalWithdrawnText:
                formatMoney(
                    wallet.totalWithdrawn
                ),

            totalBalance,

            totalBalanceText:
                formatMoney(
                    totalBalance
                ),

            lastWithdrawalAmount:
                wallet.lastWithdrawalAmount,

            lastWithdrawalAmountText:
                formatMoney(
                    wallet.lastWithdrawalAmount
                ),

            lastWithdrawalAt:
                wallet.lastWithdrawalAt
        });
    }

    /* =====================================================
       TRANSACTION FILTER HELPERS
    ===================================================== */

    function getTransactionsByType(type) {
        const normalizedType =
            normalizeTransactionType(
                type
            );

        if (!normalizedType) {
            return [];
        }

        return cloneValue(
            state.transactions.filter(
                (transaction) =>
                    transaction.type ===
                    normalizedType
            )
        );
    }

    function getTransactionsByStatus(status) {
        const normalizedStatus =
            normalizeTransactionStatus(
                status
            );

        if (!normalizedStatus) {
            return [];
        }

        return cloneValue(
            state.transactions.filter(
                (transaction) =>
                    transaction.status ===
                    normalizedStatus
            )
        );
    }

    function getCreditTransactions() {
        return cloneValue(
            state.transactions.filter(
                (transaction) =>
                    transaction.direction ===
                    TRANSACTION_DIRECTIONS
                        .CREDIT
            )
        );
    }

    function getDebitTransactions() {
        return cloneValue(
            state.transactions.filter(
                (transaction) =>
                    transaction.direction ===
                    TRANSACTION_DIRECTIONS
                        .DEBIT
            )
        );
    }

    /* =====================================================
       RESET
    ===================================================== */

    function reset(options = {}) {
        dataGeneration +=
            1;

        refreshRequestSequence +=
            1;

        walletRequestSequence +=
            1;

        transactionRequestSequence +=
            1;

        activeRequestCount =
            0;

        state.initialized =
            options.preserveInitialization ===
                true
                ? state.initialized
                : false;

        state.loading =
            false;

        state.loadingMore =
            false;

        if (
            options.preserveCurrentUser !==
            true
        ) {
            state.currentUser =
                null;
        }

        state.limit =
            DEFAULT_LIMIT;

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.wallet =
            createEmptyWallet(
                options.preserveCurrentUser ===
                    true
                    ? state.currentUser
                        ?.uid
                    : ""
            );

        state.transactions =
            [];

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        lastRefreshStartedAt =
            0;

        synchronizeProfileServiceWallet();

        notify();

        return getState();
    }

    /* =====================================================
       AUTOMATIC REFRESH
    ===================================================== */

    function clearForcedRefreshTimer() {
        if (
            forcedRefreshTimer !==
            null
        ) {
            window.clearTimeout(
                forcedRefreshTimer
            );

            forcedRefreshTimer =
                null;
        }
    }

    function scheduleForcedRefresh() {
        const user =
            resolveCurrentUser();

        if (!user?.uid) {
            return false;
        }

        clearForcedRefreshTimer();

        forcedRefreshTimer =
            window.setTimeout(
                () => {
                    forcedRefreshTimer =
                        null;

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
                },
                FORCED_REFRESH_DELAY_MS
            );

        return true;
    }

    function handleWalletRelevantUpdate() {
        scheduleForcedRefresh();
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
        clearForcedRefreshTimer();

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

        const refreshEvents = [
            "referral:approved",
            "referral:rewarded",
            "withdrawal:submitted",
            "withdrawal:cancelled",
            "withdrawal:approved",
            "withdrawal:rejected",
            "withdrawal:updated",
            "wallet:refresh",
            "wallet:operation-completed"
        ];

        refreshEvents.forEach(
            (eventName) => {
                window.addEventListener(
                    eventName,
                    handleWalletRelevantUpdate
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

        const refreshEvents = [
            "referral:approved",
            "referral:rewarded",
            "withdrawal:submitted",
            "withdrawal:cancelled",
            "withdrawal:approved",
            "withdrawal:rejected",
            "withdrawal:updated",
            "wallet:refresh",
            "wallet:operation-completed"
        ];

        refreshEvents.forEach(
            (eventName) => {
                window.removeEventListener(
                    eventName,
                    handleWalletRelevantUpdate
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
                    synchronizeProfileServiceWallet();

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
                     * Error state is already available through
                     * WalletDB.getState() and wallet:error.
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
                "WalletDB subscriber must be a function."
            );
        }

        listeners.add(
            listener
        );

        if (
            options.emitCurrent !==
                false
        ) {
            listener(
                getState()
            );
        }

        return function unsubscribe() {
            listeners.delete(
                listener
            );
        };
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        dataGeneration +=
            1;

        refreshRequestSequence +=
            1;

        walletRequestSequence +=
            1;

        transactionRequestSequence +=
            1;

        clearForcedRefreshTimer();

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

        activeRequestCount =
            0;

        readyPromise =
            null;

        state.initialized =
            false;

        state.loading =
            false;

        state.loadingMore =
            false;

        state.currentUser =
            null;

        state.limit =
            DEFAULT_LIMIT;

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.wallet =
            createEmptyWallet();

        state.transactions =
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

    window.WalletDB =
        Object.freeze({
            init,
            destroy,
            refresh,

            refreshWallet,
            refreshTransactions,
            loadMore,

            getState,
            getWalletSummary,

            getWallet() {
                return cloneValue(
                    state.wallet
                );
            },

            getTransactions() {
                return cloneValue(
                    state.transactions
                );
            },

            hasMoreTransactions() {
                return state.hasMore;
            },

            getNextCursor() {
                return state.nextCursor;
            },

            isLoadingMore() {
                return state.loadingMore;
            },

            getTransactionsByType,
            getTransactionsByStatus,
            getCreditTransactions,
            getDebitTransactions,

            getAvailableBalance() {
                return state
                    .wallet
                    .availableBalance;
            },

            getHeldBalance() {
                return state
                    .wallet
                    .heldBalance;
            },

            getTotalEarned() {
                return state
                    .wallet
                    .totalEarned;
            },

            getTotalWithdrawn() {
                return state
                    .wallet
                    .totalWithdrawn;
            },

            hasAvailableBalance(amount) {
                const normalizedAmount =
                    toMoneyInteger(
                        amount
                    );

                return (
                    normalizedAmount > 0 &&
                    state.wallet
                        .availableBalance >=
                        normalizedAmount
                );
            },

            formatMoney,
            formatTransactionAmount,

            normalizeWallet,
            normalizeTransaction,
            normalizeTransactionType,
            normalizeDirection,
            normalizeTransactionStatus,

            getTransactionTypeLabel,
            getDirectionLabel,
            getTransactionStatusLabel,

            subscribe,
            reset,

            TRANSACTION_TYPES,
            TRANSACTION_DIRECTIONS,
            TRANSACTION_STATUSES
        });
})(
    window,
    document
);