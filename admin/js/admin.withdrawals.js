"use strict";

/* =========================================================
   11PLAY — ADMIN WITHDRAWALS MODULE
   File: admin/js/admin.withdrawals.js

   Responsibilities:
   - Load pending withdrawal requests
   - Search loaded withdrawal records
   - Load all pending withdrawals through cursor pagination
   - Display user, wallet provider, wallet number and amount
   - Approve or reject pending withdrawals
   - Keep Admin notes optional for both decisions
   - Preserve historical payment/cancellation fields as read-only
   - Refresh the queue and Dashboard summary after decisions
   - Never access Firestore directly

   Final server-authoritative workflow:

   Approval:
   pending
   → Admin sends money manually outside 11Play
   → Admin chooses Approve
   → approved
   → held balance decreases
   → total withdrawn increases
   → withdraw_success ledger + audit entry

   Rejection:
   pending
   → Admin chooses Reject
   → rejected
   → held balance decreases
   → amount returns to available balance
   → withdraw_refund ledger + audit entry

   Important:
   - Client approval does not require or submit a payment reference
   - Client approval does not require a paymentConfirmed checkbox
   - Admin note is optional for Approve and Reject
   - Submitted withdrawals cannot be user-cancelled
   - Historical paymentConfirmed, paymentConfirmedAt,
     paymentReference and cancelledAt fields are read-only here
   - Wallet mutations remain atomic in FunctionsClient/Firestore
   - Hold-ledger verification remains backend-authoritative
   - Client state never changes balances directly
========================================================= */

(function initializeAdminWithdrawals(window, document) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT =
        50;

    const MAXIMUM_LIMIT =
        100;

    const PENDING_STATUS =
        "pending";

    const CANONICAL_STATUSES =
        Object.freeze([
            "pending",
            "approved",
            "rejected",
            "cancelled"
        ]);

    const WALLET_PROVIDERS =
        Object.freeze({
            BKASH:
                "bkash",

            NAGAD:
                "nagad",

            ROCKET:
                "rocket"
        });

    const WALLET_PROVIDER_LABELS =
        Object.freeze({
            [WALLET_PROVIDERS.BKASH]:
                "bKash",

            [WALLET_PROVIDERS.NAGAD]:
                "Nagad",

            [WALLET_PROVIDERS.ROCKET]:
                "Rocket"
        });

    /*
     * Historical public compatibility only.
     * These constants are no longer approval requirements.
     */

    const PAYMENT_REFERENCE_MIN_LENGTH =
        4;

    const PAYMENT_REFERENCE_MAX_LENGTH =
        80;

    const EVENTS =
        Object.freeze({
            UPDATED:
                "admin-withdrawals:updated",

            LOADING:
                "admin-withdrawals:loading",

            ERROR:
                "admin-withdrawals:error",

            SELECTED:
                "admin-withdrawals:selected",

            ACTION_STARTED:
                "admin-withdrawals:action-started",

            ACTION_COMPLETED:
                "admin-withdrawals:action-completed",

            WITHDRAWAL_UPDATED:
                "admin:withdrawal-updated"
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

        actionInProgress:
            false,

        actionWithdrawalId:
            "",

        actionType:
            "",

        withdrawals:
            [],

        visibleWithdrawals:
            [],

        selectedWithdrawalId:
            "",

        selectedWithdrawal:
            null,

        searchQuery:
            "",

        limit:
            DEFAULT_LIMIT,

        total:
            0,

        nextCursor:
            "",

        hasMore:
            false,

        pendingAmount:
            0,

        lastUpdatedAt:
            null,

        error:
            null
    };

    const elements = {
        root:
            null,

        tableBody:
            null,

        loadingState:
            null,

        emptyState:
            null,

        errorState:
            null,

        errorMessage:
            null,

        searchInput:
            null,

        totalElements:
            [],

        pendingAmountElements:
            [],

        refreshButtons:
            [],

        loadMoreButton:
            null,

        detailsPanel:
            null,

        approveForm:
            null,

        rejectForm:
            null
    };

    let requestSequence =
        0;

    let selectionSequence =
        0;

    let controller =
        null;

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function isPlainObject(value) {
        if (
            !value ||
            typeof value !==
                "object" ||
            Array.isArray(value)
        ) {
            return false;
        }

        const prototype =
            Object.getPrototypeOf(
                value
            );

        return (
            prototype ===
                Object.prototype ||
            prototype ===
                null
        );
    }

    function toSafeString(
        value,
        fallback = ""
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return fallback;
        }

        const normalizedValue =
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalizedValue ||
            fallback
        );
    }

    function toSafeNumber(
        value,
        fallback = 0
    ) {
        const number =
            Number(value);

        return Number.isFinite(
            number
        )
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
            !Number.isSafeInteger(
                number
            ) ||
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

    function safeAdd(
        firstValue,
        secondValue
    ) {
        const total =
            toNonNegativeInteger(
                firstValue
            ) +
            toNonNegativeInteger(
                secondValue
            );

        return Number.isSafeInteger(
            total
        )
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

        if (
            typeof window
                .structuredClone ===
                "function"
        ) {
            try {
                return window
                    .structuredClone(
                        value
                    );
            } catch {
                /*
                 * JSON fallback below.
                 */
            }
        }

        try {
            return JSON.parse(
                JSON.stringify(
                    value
                )
            );
        } catch {
            return value;
        }
    }

    function serializeTimestamp(
        value
    ) {
        if (!value) {
            return null;
        }

        try {
            if (
                typeof value.toDate ===
                    "function"
            ) {
                return value
                    .toDate()
                    .toISOString();
            }

            if (
                typeof value.toMillis ===
                    "function"
            ) {
                return new Date(
                    value.toMillis()
                ).toISOString();
            }

            if (
                typeof value ===
                    "object" &&
                typeof value.seconds ===
                    "number"
            ) {
                const nanoseconds =
                    typeof value.nanoseconds ===
                        "number"
                        ? value.nanoseconds
                        : 0;

                return new Date(
                    value.seconds *
                        1000 +
                    Math.floor(
                        nanoseconds /
                        1000000
                    )
                ).toISOString();
            }

            const parsedDate =
                new Date(value);

            return Number.isNaN(
                parsedDate.getTime()
            )
                ? null
                : parsedDate
                    .toISOString();
        } catch {
            return null;
        }
    }

    function normalizeError(
        error
    ) {
        const rawCode =
            toSafeString(
                error?.code
            );

        const detailsMessage =
            toSafeString(
                error?.details
                    ?.message ||
                error?.details
                    ?.error
                    ?.message ||
                error?.data
                    ?.message
            );

        return Object.freeze({
            code:
                rawCode.includes("/")
                    ? rawCode
                        .split("/")
                        .pop()
                    : rawCode ||
                      "unknown",

            message:
                detailsMessage ||
                toSafeString(
                    error?.message
                ) ||
                "Withdrawal operation could not be completed.",

            details:
                error?.details ||
                error?.data ||
                null
        });
    }

    function escapeHTML(value) {
        return toSafeString(value)
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }

    function normalizePhotoURL(
        value
    ) {
        const photoURL =
            toSafeString(
                value
            );

        if (!photoURL) {
            return "";
        }

        try {
            const resolvedURL =
                new URL(
                    photoURL,
                    window.location.href
                );

            return resolvedURL
                .protocol ===
                "https:"
                ? resolvedURL.href
                : "";
        } catch {
            return "";
        }
    }

    function requireWithdrawalId(
        value
    ) {
        const withdrawalId =
            toSafeString(
                value
            );

        if (!withdrawalId) {
            throw new TypeError(
                "withdrawalId is required."
            );
        }

        if (
            withdrawalId.length <
                8 ||
            withdrawalId.length >
                512 ||
            !/^[A-Za-z0-9_-]+$/.test(
                withdrawalId
            )
        ) {
            throw new TypeError(
                "withdrawalId is invalid."
            );
        }

        return withdrawalId;
    }

    function normalizeOptionalAdminNote(
        value
    ) {
        const note =
            toSafeString(
                value
            );

        if (
            note.length >
            500
        ) {
            throw new TypeError(
                "Admin note must not exceed 500 characters."
            );
        }

        return note;
    }

    /*
     * Historical compatibility helpers only.
     * Approval no longer validates or submits these values.
     */

    function normalizePaymentReference(
        value
    ) {
        return toSafeString(
            value
        ).replace(
            /\s+/g,
            " "
        );
    }

    function normalizePaymentConfirmed(
        value
    ) {
        if (
            value === true ||
            value === 1
        ) {
            return true;
        }

        const normalized =
            toSafeString(
                value
            ).toLowerCase();

        return [
            "true",
            "1",
            "yes",
            "on",
            "confirmed"
        ].includes(
            normalized
        );
    }

    function formatMoney(value) {
        const amount =
            toNonNegativeInteger(
                value
            );

        return `৳${new Intl.NumberFormat(
            "en-BD",
            {
                maximumFractionDigits:
                    0
            }
        ).format(
            amount
        )}`;
    }

    function formatDate(value) {
        const timestamp =
            serializeTimestamp(
                value
            );

        if (!timestamp) {
            return "—";
        }

        try {
            return new Intl.DateTimeFormat(
                "en-GB",
                {
                    day:
                        "2-digit",

                    month:
                        "short",

                    year:
                        "numeric",

                    hour:
                        "2-digit",

                    minute:
                        "2-digit",

                    hour12:
                        true,

                    timeZone:
                        "Asia/Dhaka"
                }
            ).format(
                new Date(
                    timestamp
                )
            );
        } catch {
            return "—";
        }
    }

    function getAdminAPI() {
        if (
            !window.AdminAPI
        ) {
            throw new Error(
                "AdminAPI is not available."
            );
        }

        return window.AdminAPI;
    }

    async function requireAdminAccess() {
        const adminAuth =
            window.AdminAuth;

        if (
            adminAuth &&
            typeof adminAuth
                .requireAdmin ===
                "function"
        ) {
            return adminAuth
                .requireAdmin();
        }

        return null;
    }

    function showToast(
        message,
        type = "success"
    ) {
        if (
            typeof window.AdminApp
                ?.showToast ===
                "function"
        ) {
            window.AdminApp
                .showToast(
                    message,
                    {
                        type
                    }
                );
        }
    }

    async function refreshDashboardSummary() {
        const adminApp =
            window.AdminApp;

        const refreshMethod =
            adminApp
                ?.refreshDashboardSummary ||
            adminApp
                ?.refreshSummary ||
            adminApp
                ?.refreshDashboard;

        if (
            typeof refreshMethod !==
                "function"
        ) {
            return null;
        }

        try {
            return await refreshMethod
                .call(
                    adminApp
                );
        } catch (error) {
            console.warn(
                "[AdminWithdrawals] Dashboard summary refresh failed.",
                error
            );

            return null;
        }
    }

    /* =====================================================
       ADMIN REVIEW CLIENT
    ===================================================== */

    async function callApproveWithdrawal(
        payload
    ) {
        const adminAPI =
            getAdminAPI();

        if (
            typeof adminAPI
                .approveWithdrawal !==
                "function"
        ) {
            throw new Error(
                "Withdrawal approval service is unavailable."
            );
        }

        return adminAPI
            .approveWithdrawal(
                payload.withdrawalId,
                payload.adminNote
            );
    }

    async function callRejectWithdrawal(
        payload
    ) {
        const adminAPI =
            getAdminAPI();

        if (
            typeof adminAPI
                .rejectWithdrawal !==
                "function"
        ) {
            throw new Error(
                "Withdrawal rejection service is unavailable."
            );
        }

        return adminAPI
            .rejectWithdrawal(
                payload.withdrawalId,
                payload.adminNote
            );
    }

    /* =====================================================
       WALLET PROVIDER
    ===================================================== */

    function normalizeWalletProvider(
        value
    ) {
        const provider =
            toSafeString(
                value
            )
                .toLowerCase()
                .replace(
                    /[\s_-]+/g,
                    ""
                );

        switch (provider) {
            case "bkash":
                return WALLET_PROVIDERS
                    .BKASH;

            case "nagad":
                return WALLET_PROVIDERS
                    .NAGAD;

            case "rocket":
                return WALLET_PROVIDERS
                    .ROCKET;

            default:
                return toSafeString(
                    value
                ).toLowerCase();
        }
    }

    function getWalletProviderLabel(
        value
    ) {
        const provider =
            normalizeWalletProvider(
                value
            );

        return (
            WALLET_PROVIDER_LABELS[
                provider
            ] ||
            toSafeString(
                value
            ) ||
            "—"
        );
    }

    /* =====================================================
       WALLET NUMBER
    ===================================================== */

    function normalizeWalletNumber(
        value
    ) {
        const rawValue =
            toSafeString(
                value
            );

        const digits =
            rawValue.replace(
                /\D/g,
                ""
            );

        if (
            /^8801[3-9]\d{8}$/.test(
                digits
            )
        ) {
            return `+${digits}`;
        }

        if (
            /^01[3-9]\d{8}$/.test(
                digits
            )
        ) {
            return `+88${digits}`;
        }

        if (
            /^1[3-9]\d{8}$/.test(
                digits
            )
        ) {
            return `+880${digits}`;
        }

        return rawValue;
    }

    function formatWalletNumber(
        value
    ) {
        const normalized =
            normalizeWalletNumber(
                value
            );

        if (
            /^\+8801[3-9]\d{8}$/.test(
                normalized
            )
        ) {
            return `0${normalized.slice(
                4
            )}`;
        }

        return (
            normalized ||
            "—"
        );
    }

    function maskWalletNumber(
        value
    ) {
        const rawValue =
            toSafeString(
                value
            );

        if (
            rawValue.includes("*")
        ) {
            return rawValue;
        }

        const digits =
            formatWalletNumber(
                value
            ).replace(
                /\D/g,
                ""
            );

        if (!digits) {
            return "—";
        }

        if (
            digits.length <=
            4
        ) {
            return digits;
        }

        return `${"*".repeat(
            digits.length -
            4
        )}${digits.slice(-4)}`;
    }

    /* =====================================================
       CANONICAL STATUS
    ===================================================== */

    function normalizeStatus(value) {
        const status =
            toSafeString(
                value
            )
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        const aliases = {
            processing:
                "pending",

            submitted:
                "pending",

            requested:
                "pending",

            successful:
                "approved",

            success:
                "approved",

            completed:
                "approved",

            paid:
                "approved",

            failed:
                "rejected",

            error:
                "rejected",

            declined:
                "rejected",

            canceled:
                "cancelled"
        };

        const canonicalStatus =
            aliases[status] ||
            status;

        return CANONICAL_STATUSES
            .includes(
                canonicalStatus
            )
                ? canonicalStatus
                : "";
    }

    function getStatusLabel(value) {
        switch (
            normalizeStatus(
                value
            )
        ) {
            case "approved":
                return "Approved";

            case "rejected":
                return "Rejected";

            case "cancelled":
                return "Cancelled";

            case "pending":
            default:
                return "Pending";
        }
    }

    /* =====================================================
       PROFILE NORMALIZATION
    ===================================================== */

    function normalizeProfile(
        profile,
        fallbackUid = ""
    ) {
        const source =
            isPlainObject(
                profile
            )
                ? profile
                : {};

        return Object.freeze({
            uid:
                toSafeString(
                    source.uid ||
                    source.userId ||
                    source.id ||
                    fallbackUid
                ),

            displayName:
                toSafeString(
                    source.displayName ||
                    source.name
                ),

            name:
                toSafeString(
                    source.name ||
                    source.displayName
                ),

            email:
                toSafeString(
                    source.email
                ).toLowerCase(),

            photoURL:
                normalizePhotoURL(
                    source.photoURL ||
                    source.photo
                ),

            mobileNumber:
                toSafeString(
                    source.mobileNumber ||
                    source.mobile
                ),

            referralCode:
                toSafeString(
                    source.referralCode
                ).toUpperCase()
        });
    }

    /* =====================================================
       WITHDRAWAL NORMALIZATION
    ===================================================== */

    function normalizeWithdrawal(
        withdrawal,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(
                withdrawal
            )
                ? withdrawal
                : {};

        const withdrawalId =
            toSafeString(
                source.withdrawalId ||
                source.id ||
                source.documentId ||
                fallbackId
            );

        const requestId =
            toSafeString(
                source.requestId
            );

        const userId =
            toSafeString(
                source.userId ||
                source.uid
            );

        const walletProvider =
            normalizeWalletProvider(
                source.provider ||
                source.walletProvider ||
                source.wallet ||
                source.walletType ||
                source.method
            );

        const walletNumber =
            normalizeWalletNumber(
                source.walletNumber ||
                source.number ||
                source.accountNumber
            );

        const status =
            normalizeStatus(
                source.status
            ) ||
            PENDING_STATUS;

        const amount =
            toNonNegativeInteger(
                source.amount
            );

        const userProfile =
            normalizeProfile(
                source.userProfile ||
                source.profile ||
                source.user,
                userId
            );

        /*
         * Historical frozen fields.
         * New Admin decisions never write or depend on them.
         */

        const paymentReference =
            normalizePaymentReference(
                source.paymentReference ||
                source.paymentTransactionId ||
                source.payoutReference ||
                source.externalReference
            );

        const paymentConfirmed =
            source.paymentConfirmed ===
            true;

        return Object.freeze({
            id:
                withdrawalId,

            withdrawalId,

            transactionId:
                toSafeString(
                    source.transactionId
                ),

            requestId,

            userId,

            uid:
                userId,

            provider:
                walletProvider,

            walletProvider,

            wallet:
                getWalletProviderLabel(
                    walletProvider
                ),

            walletNumber,

            number:
                walletNumber,

            displayNumber:
                formatWalletNumber(
                    walletNumber
                ),

            maskedNumber:
                toSafeString(
                    source.maskedNumber ||
                    source.maskedWalletNumber
                ) ||
                maskWalletNumber(
                    walletNumber
                ),

            amount,

            amountText:
                formatMoney(
                    amount
                ),

            status,

            statusLabel:
                getStatusLabel(
                    status
                ),

            reviewable:
                status ===
                PENDING_STATUS,

            userProfile,

            holdTransactionId:
                toSafeString(
                    source.holdTransactionId ||
                    source.holdLedgerId
                ),

            completionTransactionId:
                toSafeString(
                    source
                        .completionTransactionId ||
                    source
                        .completeTransactionId
                ),

            refundTransactionId:
                toSafeString(
                    source.refundTransactionId
                ),

            /*
             * Historical compatibility only.
             */

            paymentReference,

            paymentConfirmed,

            paymentConfirmedAt:
                serializeTimestamp(
                    source.paymentConfirmedAt
                ),

            createdAt:
                serializeTimestamp(
                    source.createdAt ||
                    source.requestedAt ||
                    source.date
                ),

            updatedAt:
                serializeTimestamp(
                    source.updatedAt
                ),

            reviewedAt:
                serializeTimestamp(
                    source.reviewedAt
                ),

            approvedAt:
                serializeTimestamp(
                    source.approvedAt
                ),

            rejectedAt:
                serializeTimestamp(
                    source.rejectedAt
                ),

            /*
             * Historical frozen field.
             */

            cancelledAt:
                serializeTimestamp(
                    source.cancelledAt ||
                    source.canceledAt
                ),

            reviewedBy:
                toSafeString(
                    source.reviewedBy ||
                    source.adminUid
                ),

            adminNote:
                toSafeString(
                    source.adminNote ||
                    source.reviewNote ||
                    source.reason
                ),

            raw:
                cloneValue(
                    source
                )
        });
    }

    function compareWithdrawalsNewestFirst(
        firstWithdrawal,
        secondWithdrawal
    ) {
        const firstTime =
            firstWithdrawal
                .createdAt
                ? new Date(
                    firstWithdrawal
                        .createdAt
                ).getTime()
                : 0;

        const secondTime =
            secondWithdrawal
                .createdAt
                ? new Date(
                    secondWithdrawal
                        .createdAt
                ).getTime()
                : 0;

        return (
            secondTime -
            firstTime
        );
    }

    function normalizeWithdrawals(
        withdrawals
    ) {
        if (
            !Array.isArray(
                withdrawals
            )
        ) {
            return [];
        }

        return withdrawals
            .map(
                (withdrawal) =>
                    normalizeWithdrawal(
                        withdrawal,
                        withdrawal?.id
                    )
            )
            .filter(
                (withdrawal) =>
                    Boolean(
                        withdrawal
                            .withdrawalId
                    )
            )
            .sort(
                compareWithdrawalsNewestFirst
            );
    }

    function mergeUniqueWithdrawals(
        existingWithdrawals,
        incomingWithdrawals
    ) {
        const withdrawalsById =
            new Map();

        [
            ...(
                Array.isArray(
                    existingWithdrawals
                )
                    ? existingWithdrawals
                    : []
            ),

            ...(
                Array.isArray(
                    incomingWithdrawals
                )
                    ? incomingWithdrawals
                    : []
            )
        ].forEach(
            (withdrawal) => {
                const withdrawalId =
                    toSafeString(
                        withdrawal
                            ?.withdrawalId ||
                        withdrawal
                            ?.id
                    );

                if (
                    withdrawalId
                ) {
                    withdrawalsById.set(
                        withdrawalId,
                        withdrawal
                    );
                }
            }
        );

        return Array.from(
            withdrawalsById.values()
        ).sort(
            compareWithdrawalsNewestFirst
        );
    }

    function extractResultValue(
        result,
        key,
        fallback = null
    ) {
        if (
            result &&
            typeof result ===
                "object" &&
            Object.prototype
                .hasOwnProperty
                .call(
                    result,
                    key
                )
        ) {
            return result[key];
        }

        if (
            result?.data &&
            typeof result.data ===
                "object" &&
            Object.prototype
                .hasOwnProperty
                .call(
                    result.data,
                    key
                )
        ) {
            return result
                .data[
                    key
                ];
        }

        return fallback;
    }

    function extractWithdrawalArray(
        result
    ) {
        if (
            Array.isArray(
                result
            )
        ) {
            return result;
        }

        if (
            Array.isArray(
                result?.withdrawals
            )
        ) {
            return result
                .withdrawals;
        }

        if (
            Array.isArray(
                result?.items
            )
        ) {
            return result.items;
        }

        if (
            Array.isArray(
                result?.data
            )
        ) {
            return result.data;
        }

        if (
            Array.isArray(
                result?.data
                    ?.withdrawals
            )
        ) {
            return result
                .data
                .withdrawals;
        }

        if (
            Array.isArray(
                result?.data
                    ?.items
            )
        ) {
            return result
                .data
                .items;
        }

        return [];
    }

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

    function getState() {
        return cloneValue(
            state
        );
    }

    function dispatch(
        eventName,
        detail = {}
    ) {
        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail:
                        cloneValue(
                            detail
                        )
                }
            )
        );
    }

    function notify(
        eventName =
            EVENTS.UPDATED
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
                        "[AdminWithdrawals] Subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatch(
            eventName,
            snapshot
        );
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

        renderError();

        notify(
            EVENTS.ERROR
        );
    }

    /* =====================================================
       DOM CACHE
    ===================================================== */

    function queryAll(selector) {
        return Array.from(
            document.querySelectorAll(
                selector
            )
        );
    }

    function cacheElements() {
        elements.root =
            document.querySelector(
                "[data-admin-withdrawals]"
            );

        elements.tableBody =
            document.querySelector(
                "[data-admin-withdrawals-body]"
            );

        elements.loadingState =
            document.querySelector(
                "[data-admin-withdrawals-loading]"
            );

        elements.emptyState =
            document.querySelector(
                "[data-admin-withdrawals-empty]"
            );

        elements.errorState =
            document.querySelector(
                "[data-admin-withdrawals-error]"
            );

        elements.errorMessage =
            document.querySelector(
                "[data-admin-withdrawals-error-message]"
            );

        elements.searchInput =
            document.querySelector(
                "[data-admin-withdrawals-search]"
            );

        elements.totalElements =
            queryAll(
                "[data-admin-withdrawals-total]"
            );

        elements.pendingAmountElements =
            queryAll(
                "[data-admin-withdrawals-pending-amount]"
            );

        elements.refreshButtons =
            queryAll(
                "[data-admin-withdrawals-refresh]"
            );

        elements.loadMoreButton =
            document.querySelector(
                "[data-admin-withdrawals-load-more]"
            );

        elements.detailsPanel =
            document.querySelector(
                "[data-admin-withdrawal-details]"
            );

        elements.approveForm =
            document.querySelector(
                "[data-admin-withdrawal-approve-form]"
            );

        elements.rejectForm =
            document.querySelector(
                "[data-admin-withdrawal-reject-form]"
            );
    }

    function setVisible(
        element,
        visible
    ) {
        if (!element) {
            return;
        }

        element.hidden =
            visible !== true;

        element.setAttribute(
            "aria-hidden",
            visible
                ? "false"
                : "true"
        );
    }

    function setDisabled(
        element,
        disabled
    ) {
        if (!element) {
            return;
        }

        element.disabled =
            disabled === true;

        element.setAttribute(
            "aria-busy",
            disabled
                ? "true"
                : "false"
        );
    }

    function setText(
        selector,
        value
    ) {
        queryAll(
            selector
        ).forEach(
            (element) => {
                element.textContent =
                    toSafeString(
                        value
                    ) ||
                    "—";
            }
        );
    }

    function setFormValue(
        form,
        fieldName,
        value
    ) {
        const field =
            form?.elements
                ?.namedItem(
                    fieldName
                );

        if (!field) {
            return;
        }

        field.value =
            toSafeString(
                value
            );
    }

    function resetReviewForms(
        withdrawal = null
    ) {
        if (
            elements.approveForm
        ) {
            elements.approveForm
                .reset();

            setFormValue(
                elements.approveForm,
                "withdrawalId",
                withdrawal
                    ?.withdrawalId ||
                ""
            );
        }

        if (
            elements.rejectForm
        ) {
            elements.rejectForm
                .reset();

            setFormValue(
                elements.rejectForm,
                "withdrawalId",
                withdrawal
                    ?.withdrawalId ||
                ""
            );
        }
    }

    /* =====================================================
       TABLE RENDERING
    ===================================================== */

    function createProfileIdentity(
        profile,
        fallbackText =
            "User"
    ) {
        const displayName =
            profile.displayName ||
            profile.email ||
            fallbackText;

        const safePhotoURL =
            normalizePhotoURL(
                profile.photoURL
            );

        const avatar =
            safePhotoURL
                ? `
                    <img
                        src="${escapeHTML(
                            safePhotoURL
                        )}"
                        alt="${escapeHTML(
                            displayName
                        )}"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                    >
                `
                : `
                    <span aria-hidden="true">
                        ${escapeHTML(
                            displayName
                                .charAt(0)
                                .toUpperCase() ||
                            "U"
                        )}
                    </span>
                `;

        return `
            <span class="admin-user-identity">
                <span class="admin-user-avatar">
                    ${avatar}
                </span>

                <span class="admin-user-text">
                    <strong>
                        ${escapeHTML(
                            displayName
                        )}
                    </strong>

                    <small>
                        ${escapeHTML(
                            profile.email ||
                            profile.uid ||
                            "—"
                        )}
                    </small>
                </span>
            </span>
        `;
    }

    function createWithdrawalRow(
        withdrawal
    ) {
        const actionRunning =
            state.actionInProgress &&
            state.actionWithdrawalId ===
                withdrawal
                    .withdrawalId;

        const approveLabel =
            actionRunning &&
            state.actionType ===
                "approve"
                ? "Approving..."
                : "Approve";

        return `
            <tr
                data-admin-withdrawal-row="${escapeHTML(
                    withdrawal
                        .withdrawalId
                )}"
            >
                <td>
                    ${createProfileIdentity(
                        withdrawal
                            .userProfile,
                        "User"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        withdrawal.wallet
                    )}
                </td>

                <td>
                    <span>
                        ${escapeHTML(
                            withdrawal
                                .maskedNumber ||
                            "—"
                        )}
                    </span>
                </td>

                <td>
                    <strong>
                        ${escapeHTML(
                            withdrawal
                                .amountText
                        )}
                    </strong>
                </td>

                <td>
                    <span
                        class="admin-status-badge is-${escapeHTML(
                            withdrawal
                                .status
                        )}"
                    >
                        ${escapeHTML(
                            withdrawal
                                .statusLabel
                        )}
                    </span>
                </td>

                <td>
                    ${escapeHTML(
                        formatDate(
                            withdrawal
                                .createdAt
                        )
                    )}
                </td>

                <td>
                    <div class="admin-table-actions">
                        <button
                            type="button"
                            data-admin-withdrawal-open="${escapeHTML(
                                withdrawal
                                    .withdrawalId
                            )}"
                            ${
                                actionRunning
                                    ? "disabled"
                                    : ""
                            }
                        >
                            View
                        </button>

                        <button
                            type="button"
                            data-admin-withdrawal-approve="${escapeHTML(
                                withdrawal
                                    .withdrawalId
                            )}"
                            ${
                                (
                                    actionRunning ||
                                    !withdrawal
                                        .reviewable
                                )
                                    ? "disabled"
                                    : ""
                            }
                        >
                            ${approveLabel}
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function renderWithdrawals() {
        if (
            elements.tableBody
        ) {
            elements.tableBody
                .innerHTML =
                state
                    .visibleWithdrawals
                    .map(
                        createWithdrawalRow
                    )
                    .join("");
        }

        setVisible(
            elements.loadingState,
            state.loading
        );

        setVisible(
            elements.emptyState,
            !state.loading &&
            state
                .visibleWithdrawals
                .length ===
                0
        );

        elements.totalElements
            .forEach(
                (element) => {
                    element.textContent =
                        String(
                            state.total
                        );
                }
            );

        elements.pendingAmountElements
            .forEach(
                (element) => {
                    element.textContent =
                        formatMoney(
                            state
                                .pendingAmount
                        );
                }
            );

        elements.refreshButtons
            .forEach(
                (button) => {
                    setDisabled(
                        button,
                        state.loading ||
                        state
                            .actionInProgress
                    );
                }
            );

        if (
            elements.loadMoreButton
        ) {
            setVisible(
                elements.loadMoreButton,
                state.hasMore
            );

            setDisabled(
                elements.loadMoreButton,
                state.loading ||
                state
                    .actionInProgress
            );
        }

        elements.root
            ?.setAttribute(
                "aria-busy",
                (
                    state.loading ||
                    state.actionInProgress
                )
                    ? "true"
                    : "false"
            );
    }

    function renderError() {
        setVisible(
            elements.errorState,
            Boolean(
                state.error
            )
        );

        if (
            elements.errorMessage
        ) {
            elements.errorMessage
                .textContent =
                state.error
                    ?.message ||
                "";
        }
    }

    /* =====================================================
       SELECTED WITHDRAWAL DETAILS
    ===================================================== */

    function updateDetailPhoto(
        profile
    ) {
        queryAll(
            "[data-admin-withdrawal-detail-user-photo]"
        ).forEach(
            (element) => {
                if (
                    element.tagName !==
                    "IMG"
                ) {
                    return;
                }

                if (
                    profile.photoURL
                ) {
                    element.src =
                        profile.photoURL;

                    element
                        .referrerPolicy =
                        "no-referrer";
                } else {
                    element
                        .removeAttribute(
                            "src"
                        );
                }

                element.alt =
                    profile.displayName ||
                    "User";
            }
        );
    }

    function renderSelectedWithdrawal() {
        const withdrawal =
            state
                .selectedWithdrawal;

        setVisible(
            elements.detailsPanel,
            Boolean(
                withdrawal
            )
        );

        if (!withdrawal) {
            return;
        }

        setText(
            "[data-admin-withdrawal-detail-id]",
            withdrawal
                .withdrawalId
        );

        setText(
            "[data-admin-withdrawal-detail-user-name]",
            withdrawal
                .userProfile
                .displayName
        );

        setText(
            "[data-admin-withdrawal-detail-user-email]",
            withdrawal
                .userProfile
                .email
        );

        setText(
            "[data-admin-withdrawal-detail-user-mobile]",
            withdrawal
                .userProfile
                .mobileNumber
        );

        setText(
            "[data-admin-withdrawal-detail-user-uid]",
            withdrawal
                .userId
        );

        setText(
            "[data-admin-withdrawal-detail-wallet]",
            withdrawal
                .wallet
        );

        setText(
            "[data-admin-withdrawal-detail-provider]",
            withdrawal
                .wallet
        );

        setText(
            "[data-admin-withdrawal-detail-number]",
            withdrawal
                .displayNumber
        );

        setText(
            "[data-admin-withdrawal-detail-masked-number]",
            withdrawal
                .maskedNumber
        );

        setText(
            "[data-admin-withdrawal-detail-amount]",
            withdrawal
                .amountText
        );

        setText(
            "[data-admin-withdrawal-detail-status]",
            withdrawal
                .statusLabel
        );

        setText(
            "[data-admin-withdrawal-detail-created]",
            formatDate(
                withdrawal
                    .createdAt
            )
        );

        setText(
            "[data-admin-withdrawal-detail-updated]",
            formatDate(
                withdrawal
                    .updatedAt
            )
        );

        setText(
            "[data-admin-withdrawal-detail-request-id]",
            withdrawal
                .requestId
        );

        setText(
            "[data-admin-withdrawal-detail-hold-transaction]",
            withdrawal
                .holdTransactionId
        );

        setText(
            "[data-admin-withdrawal-detail-completion-transaction]",
            withdrawal
                .completionTransactionId
        );

        setText(
            "[data-admin-withdrawal-detail-refund-transaction]",
            withdrawal
                .refundTransactionId
        );

        /*
         * Historical compatibility selectors only.
         * New approvals never depend on these fields.
         */

        setText(
            "[data-admin-withdrawal-detail-payment-confirmed]",
            withdrawal
                .paymentConfirmed
                ? "Yes"
                : "No"
        );

        setText(
            "[data-admin-withdrawal-detail-payment-reference]",
            withdrawal
                .paymentReference
        );

        setText(
            "[data-admin-withdrawal-detail-admin-note]",
            withdrawal
                .adminNote
        );

        updateDetailPhoto(
            withdrawal
                .userProfile
        );

        setFormValue(
            elements.approveForm,
            "withdrawalId",
            withdrawal
                .withdrawalId
        );

        setFormValue(
            elements.rejectForm,
            "withdrawalId",
            withdrawal
                .withdrawalId
        );

        const approveButton =
            elements.approveForm
                ?.querySelector(
                    "[type='submit']"
                );

        const rejectButton =
            elements.rejectForm
                ?.querySelector(
                    "[type='submit']"
                );

        setDisabled(
            approveButton,
            state.actionInProgress ||
            !withdrawal
                .reviewable
        );

        setDisabled(
            rejectButton,
            state.actionInProgress ||
            !withdrawal
                .reviewable
        );
    }

    /* =====================================================
       SEARCH
    ===================================================== */

    function applySearch() {
        const query =
            state.searchQuery
                .toLowerCase();

        state.visibleWithdrawals =
            state.withdrawals
                .filter(
                    (withdrawal) => {
                        if (!query) {
                            return true;
                        }

                        return [
                            withdrawal
                                .withdrawalId,

                            withdrawal
                                .requestId,

                            withdrawal
                                .transactionId,

                            withdrawal
                                .userId,

                            withdrawal
                                .userProfile
                                .displayName,

                            withdrawal
                                .userProfile
                                .email,

                            withdrawal
                                .userProfile
                                .mobileNumber,

                            withdrawal
                                .provider,

                            withdrawal
                                .wallet,

                            withdrawal
                                .walletNumber,

                            withdrawal
                                .displayNumber,

                            withdrawal
                                .maskedNumber,

                            withdrawal
                                .amount,

                            withdrawal
                                .status,

                            withdrawal
                                .adminNote,

                            /*
                             * Historical search compatibility.
                             */

                            withdrawal
                                .paymentReference
                        ]
                            .join(" ")
                            .toLowerCase()
                            .includes(
                                query
                            );
                    }
                );

        renderWithdrawals();

        return cloneValue(
            state
                .visibleWithdrawals
        );
    }

    function setSearchQuery(
        value
    ) {
        state.searchQuery =
            toSafeString(
                value
            );

        applySearch();

        notify();

        return getState();
    }

    /* =====================================================
       LOAD PENDING WITHDRAWALS
    ===================================================== */

    async function refresh(
        options = {}
    ) {
        await requireAdminAccess();

        const append =
            options.append ===
            true;

        if (
            append &&
            (
                state.loading ||
                !state.hasMore ||
                !state.nextCursor
            )
        ) {
            return getState();
        }

        const currentRequest =
            ++requestSequence;

        const requestedLimit =
            toSafeLimit(
                options.limit ||
                state.limit
            );

        const cursor =
            append
                ? state.nextCursor
                : "";

        state.loading =
            true;

        state.limit =
            requestedLimit;

        if (!append) {
            state.nextCursor =
                "";

            state.hasMore =
                false;
        }

        clearError();

        renderWithdrawals();

        renderError();

        notify(
            EVENTS.LOADING
        );

        try {
            const payload = {
                limit:
                    requestedLimit
            };

            if (
                cursor
            ) {
                payload.cursor =
                    cursor;
            }

            const result =
                await getAdminAPI()
                    .getPendingWithdrawals(
                        payload
                    );

            if (
                currentRequest !==
                requestSequence
            ) {
                return getState();
            }

            /*
             * The Admin review queue is pending-only.
             * Server query remains authoritative; this filter
             * prevents historical records from becoming actions.
             */

            const pageWithdrawals =
                normalizeWithdrawals(
                    extractWithdrawalArray(
                        result
                    )
                ).filter(
                    (withdrawal) =>
                        withdrawal.status ===
                        PENDING_STATUS
                );

            state.withdrawals =
                append
                    ? mergeUniqueWithdrawals(
                        state.withdrawals,
                        pageWithdrawals
                    ).filter(
                        (withdrawal) =>
                            withdrawal
                                .status ===
                            PENDING_STATUS
                    )
                    : pageWithdrawals;

            const reportedTotal =
                extractResultValue(
                    result,
                    "total",
                    null
                );

            state.total =
                reportedTotal ===
                    null ||
                reportedTotal ===
                    undefined
                    ? state.withdrawals
                        .length
                    : toNonNegativeInteger(
                        reportedTotal,
                        state.withdrawals
                            .length
                    );

            const nextCursor =
                toSafeString(
                    extractResultValue(
                        result,
                        "nextCursor",
                        ""
                    )
                );

            const hasMore =
                extractResultValue(
                    result,
                    "hasMore",
                    false
                ) === true;

            state.nextCursor =
                hasMore
                    ? nextCursor
                    : "";

            state.hasMore =
                hasMore &&
                Boolean(
                    nextCursor
                );

            const loadedPendingAmount =
                state.withdrawals
                    .reduce(
                        (
                            total,
                            withdrawal
                        ) =>
                            safeAdd(
                                total,
                                withdrawal
                                    .amount
                            ),
                        0
                    );

            const reportedPendingAmount =
                extractResultValue(
                    result,
                    "pendingAmount",
                    extractResultValue(
                        result,
                        "totalPendingAmount",
                        null
                    )
                );

            state.pendingAmount =
                reportedPendingAmount ===
                    null ||
                reportedPendingAmount ===
                    undefined
                    ? loadedPendingAmount
                    : toNonNegativeInteger(
                        reportedPendingAmount,
                        loadedPendingAmount
                    );

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            applySearch();

            renderError();

            if (
                state
                    .selectedWithdrawalId
            ) {
                const refreshedSelected =
                    state.withdrawals
                        .find(
                            (withdrawal) =>
                                withdrawal
                                    .withdrawalId ===
                                state
                                    .selectedWithdrawalId
                        );

                if (
                    refreshedSelected
                ) {
                    state.selectedWithdrawal =
                        cloneValue(
                            refreshedSelected
                        );

                    renderSelectedWithdrawal();
                } else if (
                    !append
                ) {
                    closeWithdrawalDetails();
                }
            }

            return getState();
        } catch (error) {
            if (
                currentRequest ===
                requestSequence
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            if (
                currentRequest ===
                requestSequence
            ) {
                state.loading =
                    false;

                renderWithdrawals();

                notify();
            }
        }
    }

    async function loadMore() {
        if (
            state.loading ||
            !state.hasMore ||
            !state.nextCursor
        ) {
            return getState();
        }

        return refresh({
            append:
                true,

            limit:
                state.limit
        });
    }

    /* =====================================================
       WITHDRAWAL DETAILS
    ===================================================== */

    function openWithdrawalDetails(
        withdrawalId
    ) {
        const id =
            requireWithdrawalId(
                withdrawalId
            );

        selectionSequence +=
            1;

        const withdrawal =
            state.withdrawals
                .find(
                    (item) =>
                        item.withdrawalId ===
                        id
                );

        if (!withdrawal) {
            throw new Error(
                "Withdrawal record was not found."
            );
        }

        state.selectedWithdrawalId =
            id;

        state.selectedWithdrawal =
            cloneValue(
                withdrawal
            );

        resetReviewForms(
            withdrawal
        );

        renderSelectedWithdrawal();

        notify(
            EVENTS.SELECTED
        );

        return cloneValue(
            state
                .selectedWithdrawal
        );
    }

    function closeWithdrawalDetails() {
        selectionSequence +=
            1;

        state.selectedWithdrawalId =
            "";

        state.selectedWithdrawal =
            null;

        resetReviewForms();

        renderSelectedWithdrawal();

        notify();

        return getState();
    }

    /* =====================================================
       ACTION STATE
    ===================================================== */

    function startAction(
        withdrawalId,
        actionType
    ) {
        if (
            state.actionInProgress
        ) {
            throw new Error(
                "Another withdrawal review is already in progress."
            );
        }

        state.actionInProgress =
            true;

        state.actionWithdrawalId =
            withdrawalId;

        state.actionType =
            actionType;

        clearError();

        renderWithdrawals();

        renderSelectedWithdrawal();

        notify(
            EVENTS.ACTION_STARTED
        );
    }

    function finishAction() {
        state.actionInProgress =
            false;

        state.actionWithdrawalId =
            "";

        state.actionType =
            "";

        renderWithdrawals();

        renderSelectedWithdrawal();

        notify(
            EVENTS.ACTION_COMPLETED
        );
    }

    function getLoadedWithdrawal(
        withdrawalId
    ) {
        return (
            state.withdrawals
                .find(
                    (item) =>
                        item.withdrawalId ===
                        withdrawalId
                ) ||
            null
        );
    }

    function ensureReviewableWithdrawal(
        withdrawalId
    ) {
        const withdrawal =
            getLoadedWithdrawal(
                withdrawalId
            );

        if (!withdrawal) {
            throw new Error(
                "Pending withdrawal record was not found in the current Admin queue."
            );
        }

        if (
            !withdrawal
                .reviewable
        ) {
            throw new Error(
                "Only a pending withdrawal can be reviewed."
            );
        }

        return withdrawal;
    }

    /* =====================================================
       APPROVE WITHDRAWAL
    ===================================================== */

    async function approveWithdrawal(
        withdrawalId,
        adminNote = ""
    ) {
        await requireAdminAccess();

        const id =
            requireWithdrawalId(
                withdrawalId ||
                state
                    .selectedWithdrawalId
            );

        const withdrawal =
            ensureReviewableWithdrawal(
                id
            );

        const note =
            isPlainObject(
                adminNote
            )
                ? normalizeOptionalAdminNote(
                    adminNote
                        .adminNote ||
                    adminNote
                        .note
                )
                : normalizeOptionalAdminNote(
                    adminNote
                );

        startAction(
            id,
            "approve"
        );

        try {
            /*
             * AdminAPI → FunctionsClient is responsible for
             * transactionally revalidating:
             *
             * - record still exists and is pending
             * - held balance is sufficient
             * - hold transaction/reference is valid
             * - operation was not already finalized
             * - held decreases exactly once
             * - totalWithdrawn increases exactly once
             * - withdraw_success ledger + audit are created
             *
             * No payment reference/confirmation field is sent.
             */

            const result =
                await callApproveWithdrawal({
                    withdrawalId:
                        id,

                    adminNote:
                        note
                });

            const approvedAmount =
                toNonNegativeInteger(
                    result?.amount ??
                    result?.withdrawal
                        ?.amount ??
                    result?.data
                        ?.amount ??
                    result?.data
                        ?.withdrawal
                        ?.amount ??
                    withdrawal
                        .amount
                );

            closeWithdrawalDetails();

            await refresh({
                limit:
                    state.limit
            });

            const detail = {
                withdrawalId:
                    id,

                status:
                    "approved",

                amount:
                    approvedAmount,

                result,

                message:
                    "Withdrawal approved successfully. Held balance and total withdrawn were updated by the secure wallet transaction."
            };

            dispatch(
                EVENTS
                    .WITHDRAWAL_UPDATED,
                detail
            );

            await refreshDashboardSummary();

            showToast(
                detail.message
            );

            return result;
        } catch (error) {
            setError(
                error
            );

            showToast(
                normalizeError(
                    error
                ).message,
                "error"
            );

            throw error;
        } finally {
            finishAction();
        }
    }

    /* =====================================================
       REJECT WITHDRAWAL
    ===================================================== */

    async function rejectWithdrawal(
        withdrawalId,
        adminNote = ""
    ) {
        await requireAdminAccess();

        const id =
            requireWithdrawalId(
                withdrawalId ||
                state
                    .selectedWithdrawalId
            );

        const withdrawal =
            ensureReviewableWithdrawal(
                id
            );

        /*
         * Final policy:
         * Rejection note is optional.
         */

        const note =
            isPlainObject(
                adminNote
            )
                ? normalizeOptionalAdminNote(
                    adminNote
                        .adminNote ||
                    adminNote
                        .note
                )
                : normalizeOptionalAdminNote(
                    adminNote
                );

        startAction(
            id,
            "reject"
        );

        try {
            /*
             * Backend revalidates pending state and performs
             * held → available refund atomically exactly once.
             *
             * Historical paymentConfirmed/paymentReference do
             * not control the current rejection decision.
             */

            const result =
                await callRejectWithdrawal({
                    withdrawalId:
                        id,

                    adminNote:
                        note
                });

            const refundedAmount =
                toNonNegativeInteger(
                    result?.amount ??
                    result?.withdrawal
                        ?.amount ??
                    result?.data
                        ?.amount ??
                    result?.data
                        ?.withdrawal
                        ?.amount ??
                    withdrawal
                        .amount
                );

            closeWithdrawalDetails();

            await refresh({
                limit:
                    state.limit
            });

            const detail = {
                withdrawalId:
                    id,

                status:
                    "rejected",

                amount:
                    refundedAmount,

                result,

                message:
                    "Withdrawal rejected successfully. The held amount was returned to Available Balance."
            };

            dispatch(
                EVENTS
                    .WITHDRAWAL_UPDATED,
                detail
            );

            await refreshDashboardSummary();

            showToast(
                detail.message
            );

            return result;
        } catch (error) {
            setError(
                error
            );

            showToast(
                normalizeError(
                    error
                ).message,
                "error"
            );

            throw error;
        } finally {
            finishAction();
        }
    }

    /* =====================================================
       FORM HELPERS
    ===================================================== */

    function getFormValue(
        formData,
        fieldName
    ) {
        return toSafeString(
            formData.get(
                fieldName
            )
        );
    }

    async function handleApproveSubmit(
        event
    ) {
        event.preventDefault();

        const form =
            event.target.closest(
                "[data-admin-withdrawal-approve-form]"
            );

        if (!form) {
            return;
        }

        const formData =
            new FormData(
                form
            );

        const submitButton =
            form.querySelector(
                "[type='submit']"
            );

        setDisabled(
            submitButton,
            true
        );

        try {
            await approveWithdrawal(
                getFormValue(
                    formData,
                    "withdrawalId"
                ) ||
                state
                    .selectedWithdrawalId,

                getFormValue(
                    formData,
                    "adminNote"
                )
            );

            form.reset();
        } catch {
            /*
             * Error already published/displayed.
             */
        } finally {
            setDisabled(
                submitButton,
                false
            );
        }
    }

    async function handleRejectSubmit(
        event
    ) {
        event.preventDefault();

        const form =
            event.target.closest(
                "[data-admin-withdrawal-reject-form]"
            );

        if (!form) {
            return;
        }

        const formData =
            new FormData(
                form
            );

        const submitButton =
            form.querySelector(
                "[type='submit']"
            );

        setDisabled(
            submitButton,
            true
        );

        try {
            await rejectWithdrawal(
                getFormValue(
                    formData,
                    "withdrawalId"
                ) ||
                state
                    .selectedWithdrawalId,

                getFormValue(
                    formData,
                    "adminNote"
                )
            );

            form.reset();
        } catch {
            /*
             * Error already published/displayed.
             */
        } finally {
            setDisabled(
                submitButton,
                false
            );
        }
    }

    /* =====================================================
       INLINE NOTE COMPATIBILITY
    ===================================================== */

    function escapeSelectorValue(
        value
    ) {
        if (
            window.CSS &&
            typeof window.CSS
                .escape ===
                "function"
        ) {
            return window.CSS
                .escape(
                    value
                );
        }

        return value.replace(
            /["\\]/g,
            "\\$&"
        );
    }

    function readInlineAdminNote(
        withdrawalId
    ) {
        const escapedId =
            escapeSelectorValue(
                withdrawalId
            );

        const field =
            document.querySelector(
                `[data-admin-withdrawal-note="${escapedId}"]`
            );

        return toSafeString(
            field?.value
        );
    }

    /* =====================================================
       DOCUMENT EVENTS
    ===================================================== */

    function handleDocumentClick(event) {
        if (
            event.defaultPrevented ||
            !(
                event.target instanceof
                Element
            )
        ) {
            return;
        }

        const openButton =
            event.target.closest(
                "[data-admin-withdrawal-open]"
            );

        if (
            openButton
        ) {
            event.preventDefault();

            try {
                openWithdrawalDetails(
                    openButton
                        .dataset
                        .adminWithdrawalOpen
                );
            } catch (error) {
                setError(
                    error
                );

                showToast(
                    normalizeError(
                        error
                    ).message,
                    "error"
                );
            }

            return;
        }

        const approveButton =
            event.target.closest(
                "[data-admin-withdrawal-approve]"
            );

        if (
            approveButton
        ) {
            event.preventDefault();

            const withdrawalId =
                approveButton
                    .dataset
                    .adminWithdrawalApprove;

            try {
                openWithdrawalDetails(
                    withdrawalId
                );
            } catch (error) {
                setError(
                    error
                );

                showToast(
                    normalizeError(
                        error
                    ).message,
                    "error"
                );
            }

            return;
        }

        const rejectButton =
            event.target.closest(
                "[data-admin-withdrawal-reject]"
            );

        if (
            rejectButton
        ) {
            event.preventDefault();

            const withdrawalId =
                rejectButton
                    .dataset
                    .adminWithdrawalReject;

            const note =
                readInlineAdminNote(
                    withdrawalId
                );

            void rejectWithdrawal(
                withdrawalId,
                note
            ).catch(
                () => {
                    /*
                     * Error already displayed.
                     */
                }
            );

            return;
        }

        if (
            event.target.closest(
                "[data-admin-withdrawal-details-close]"
            )
        ) {
            event.preventDefault();

            closeWithdrawalDetails();

            return;
        }

        if (
            event.target.closest(
                "[data-admin-withdrawals-refresh]"
            )
        ) {
            event.preventDefault();

            void refresh()
                .catch(
                    (error) => {
                        showToast(
                            normalizeError(
                                error
                            ).message,
                            "error"
                        );
                    }
                );

            return;
        }

        if (
            event.target.closest(
                "[data-admin-withdrawals-load-more]"
            )
        ) {
            event.preventDefault();

            void loadMore()
                .catch(
                    (error) => {
                        showToast(
                            normalizeError(
                                error
                            ).message,
                            "error"
                        );
                    }
                );
        }
    }

    function handleDocumentInput(
        event
    ) {
        if (
            !(
                event.target instanceof
                Element
            )
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-withdrawals-search]"
            )
        ) {
            setSearchQuery(
                event.target
                    .value
            );
        }
    }

    function handleDocumentSubmit(
        event
    ) {
        if (
            !(
                event.target instanceof
                Element
            )
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-withdrawal-approve-form]"
            )
        ) {
            void handleApproveSubmit(
                event
            );

            return;
        }

        if (
            event.target.matches(
                "[data-admin-withdrawal-reject-form]"
            )
        ) {
            void handleRejectSubmit(
                event
            );
        }
    }

    function bindEvents() {
        if (
            controller
        ) {
            return true;
        }

        controller =
            new AbortController();

        const signal =
            controller.signal;

        document.addEventListener(
            "click",
            handleDocumentClick,
            {
                signal
            }
        );

        document.addEventListener(
            "input",
            handleDocumentInput,
            {
                signal
            }
        );

        document.addEventListener(
            "submit",
            handleDocumentSubmit,
            {
                signal
            }
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    async function init() {
        if (
            state.initialized
        ) {
            cacheElements();

            renderWithdrawals();

            renderSelectedWithdrawal();

            return getState();
        }

        state.initialized =
            true;

        cacheElements();

        bindEvents();

        state.searchQuery =
            toSafeString(
                elements.searchInput
                    ?.value
            );

        try {
            await requireAdminAccess();

            await refresh();
        } catch (error) {
            setError(
                error
            );
        }

        return getState();
    }

    /* =====================================================
       SUBSCRIPTION
    ===================================================== */

    function subscribe(
        listener
    ) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new TypeError(
                "AdminWithdrawals subscriber must be a function."
            );
        }

        listeners.add(
            listener
        );

        listener(
            getState()
        );

        return function unsubscribe() {
            listeners.delete(
                listener
            );
        };
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        requestSequence +=
            1;

        selectionSequence +=
            1;

        controller?.abort();

        controller =
            null;

        listeners.clear();

        state.initialized =
            false;

        state.loading =
            false;

        state.actionInProgress =
            false;

        state.actionWithdrawalId =
            "";

        state.actionType =
            "";

        state.withdrawals =
            [];

        state.visibleWithdrawals =
            [];

        state.selectedWithdrawalId =
            "";

        state.selectedWithdrawal =
            null;

        state.searchQuery =
            "";

        state.limit =
            DEFAULT_LIMIT;

        state.total =
            0;

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.pendingAmount =
            0;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        Object.keys(
            elements
        ).forEach(
            (key) => {
                elements[key] =
                    Array.isArray(
                        elements[key]
                    )
                        ? []
                        : null;
            }
        );

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.AdminWithdrawals =
        Object.freeze({
            init,
            destroy,

            refresh,
            loadMore,

            setSearchQuery,

            openWithdrawalDetails,
            closeWithdrawalDetails,

            approveWithdrawal,
            rejectWithdrawal,

            getState,

            getWithdrawals() {
                return cloneValue(
                    state.withdrawals
                );
            },

            getVisibleWithdrawals() {
                return cloneValue(
                    state
                        .visibleWithdrawals
                );
            },

            getSelectedWithdrawal() {
                return cloneValue(
                    state
                        .selectedWithdrawal
                );
            },

            getPendingAmount() {
                return state
                    .pendingAmount;
            },

            normalizeWithdrawal,
            normalizeWithdrawals,
            normalizeProfile,

            normalizeWallet:
                normalizeWalletProvider,

            normalizeWalletProvider,

            getWalletProviderLabel,

            normalizeWalletNumber,
            formatWalletNumber,
            maskWalletNumber,

            /*
             * Historical compatibility exports only.
             * They are not current approval requirements.
             */

            normalizePaymentReference,
            normalizePaymentConfirmed,

            normalizeStatus,
            getStatusLabel,

            formatMoney,
            formatDate,

            subscribe,

            EVENTS,
            WALLET_PROVIDERS,
            CANONICAL_STATUSES,
            PENDING_STATUS,

            /*
             * Historical compatibility constants only.
             */

            PAYMENT_REFERENCE_MIN_LENGTH,
            PAYMENT_REFERENCE_MAX_LENGTH
        });
})(
    window,
    document
);