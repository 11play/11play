"use strict";

/* =========================================================
   11PLAY — WITHDRAWAL CLIENT DATA MODULE
   File: js/account/firebase/withdraw.db.js

   Responsibilities:
   - Submit authenticated withdrawal requests
   - Load withdrawal history and summary
   - Load complete history through cursor-based pagination
   - Support canonical status filtering
   - Validate provider, wallet number, amount and balance
   - Reuse request IDs for safe idempotent retries
   - Refresh Wallet data after successful submission
   - Prevent stale cross-account responses
   - Never write withdrawal or wallet data directly

   Final withdrawal contract:
   - Providers: bKash, Nagad, Rocket
   - Minimum amount: ৳1000
   - Amount must be a multiple of ৳1000
   - Submit moves available balance to held balance server-side
   - Submitted requests are immutable to the user
   - User cannot cancel, edit or delete a withdrawal request
   - Admin can Approve or Reject a pending request
   - Approve: held decreases and totalWithdrawn increases
   - Reject: held decreases and available balance is refunded

   Backend functions:
   - submitWithdrawal
   - getMyWithdrawals
   - getMyWithdrawalSummary

   Compatibility API:
   - cancelWithdrawal() remains exported for older callers, but it
     always throws and performs ZERO backend / Firestore writes.

   Canonical statuses:
   - pending
   - approved
   - rejected
   - cancelled (historical read-only compatibility only)

   Important:
   The generated “Live Reward Withdrawal” section is separate
   and is not connected to this module.
========================================================= */

(function initializeWithdrawDB(window, document) {
    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT = 50;
    const MAXIMUM_LIMIT = 100;
    const REFRESH_COOLDOWN_MS = 10 * 1000;
    const FORCED_REFRESH_DELAY_MS = 150;
    const PENDING_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
    const PENDING_REQUEST_STORAGE_KEY = "11play.withdraw.pendingRequest";
    const DEFAULT_MINIMUM_AMOUNT = 1000;
    const WITHDRAWAL_AMOUNT_MULTIPLE = 1000;
    const GOOGLE_PROVIDER_ID = "google.com";

    const EVENT_UPDATED = "withdrawal:updated";
    const EVENT_LOADING = "withdrawal:loading";
    const EVENT_ERROR = "withdrawal:error";
    const EVENT_SUBMITTING = "withdrawal:submitting";
    const EVENT_SUBMITTED = "withdrawal:submitted";
    const EVENT_FILTER_CHANGED = "withdrawal:filter-changed";
    const EVENT_SUMMARY_UPDATED = "withdrawal:summary-updated";
    const EVENT_ACCESS_BLOCKED = "withdrawal:access-blocked";

    const WITHDRAWAL_STATUSES = Object.freeze({
        PENDING: "pending",
        APPROVED: "approved",
        REJECTED: "rejected",
        CANCELLED: "cancelled"
    });

    const WALLET_PROVIDERS = Object.freeze({
        BKASH: "bkash",
        NAGAD: "nagad",
        ROCKET: "rocket"
    });

    const WALLET_TYPES = Object.freeze({
        BKASH: "bKash",
        NAGAD: "Nagad",
        ROCKET: "Rocket"
    });

    const CANONICAL_STATUSES = Object.freeze([
        "",
        WITHDRAWAL_STATUSES.PENDING,
        WITHDRAWAL_STATUSES.APPROVED,
        WITHDRAWAL_STATUSES.REJECTED,
        /* Historical read-only status. */
        WITHDRAWAL_STATUSES.CANCELLED
    ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const listeners = new Set();

    const state = {
        initialized: false,
        loading: false,
        submitting: false,

        /* Compatibility only. Cancellation is disabled. */
        cancellingWithdrawalId: "",

        currentUser: null,
        statusFilter: "",
        limit: DEFAULT_LIMIT,
        nextCursor: "",
        hasMore: false,
        withdrawals: [],
        summary: createEmptySummary(),
        lastSubmission: null,

        /* Historical API compatibility only. Never populated by new actions. */
        lastCancellation: null,

        lastUpdatedAt: null,
        error: null
    };

    let authUnsubscribe = null;
    let readyPromise = null;
    let boundEvents = false;
    let forcedRefreshTimer = null;
    let activeRequestCount = 0;
    let dataGeneration = 0;
    let refreshRequestSequence = 0;
    let withdrawalsRequestSequence = 0;
    let summaryRequestSequence = 0;
    let submissionSequence = 0;
    let lastRefreshStartedAt = 0;

    /* =====================================================
       CUSTOM ERROR
    ===================================================== */

    class WithdrawDBError extends Error {
        constructor({
            code = "withdrawal-error",
            message = "Withdrawal operation failed.",
            details = null,
            field = ""
        } = {}) {
            super(message);

            this.name = "WithdrawDBError";
            this.code =
                toSafeString(code) ||
                "withdrawal-error";

            this.details = details;

            this.field =
                toSafeString(
                    field ||
                    details?.field
                );

            Error.captureStackTrace?.(
                this,
                WithdrawDBError
            );
        }
    }

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
            prototype === Object.prototype ||
            prototype === null
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
                    value.seconds *
                    1000
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
        if (
            error instanceof
            WithdrawDBError
        ) {
            return {
                code:
                    error.code,

                message:
                    error.message,

                field:
                    error.field,

                reason:
                    toSafeString(
                        error.details
                            ?.reason
                    ),

                details:
                    error.details
            };
        }

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
                )
                    .replace(
                        /^functions\//,
                        ""
                    )
                    .replace(
                        /^firestore\//,
                        ""
                    ) ||
                "withdrawal-error",

            message:
                toSafeString(
                    details?.message ||
                    error?.message
                ) ||
                "Withdrawal operation failed.",

            field:
                toSafeString(
                    details?.field
                ),

            reason:
                toSafeString(
                    details?.reason ||
                    details?.code
                ),

            details
        };
    }

    function unwrapCallableResult(response) {
        if (
            response &&
            typeof response === "object" &&
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
                    "withdrawal"
                ) &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "withdrawals"
                ) &&
            !Object.prototype
                .hasOwnProperty
                .call(
                    response,
                    "summary"
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
            )
                .format(value);

        return includeSymbol
            ? `৳${formatted}`
            : formatted;
    }

    /* =====================================================
       WALLET PROVIDER
    ===================================================== */

    function normalizeWalletProvider(value) {
        const provider =
            toSafeString(value)
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
                return "";
        }
    }

    function getWalletProviderLabel(value) {
        switch (
            normalizeWalletProvider(
                value
            )
        ) {
            case WALLET_PROVIDERS
                .BKASH:

                return WALLET_TYPES
                    .BKASH;

            case WALLET_PROVIDERS
                .NAGAD:

                return WALLET_TYPES
                    .NAGAD;

            case WALLET_PROVIDERS
                .ROCKET:

                return WALLET_TYPES
                    .ROCKET;

            default:
                return "";
        }
    }

    function validateWalletProvider(value) {
        const provider =
            normalizeWalletProvider(
                value
            );

        if (!provider) {
            throw new WithdrawDBError({
                code:
                    "invalid-wallet-provider",

                message:
                    "Wallet provider must be bKash, Nagad or Rocket.",

                field:
                    "provider"
            });
        }

        return provider;
    }

    /* =====================================================
       BANGLADESH WALLET NUMBER
    ===================================================== */

    function normalizeWalletNumber(value) {
        const digits =
            toSafeString(value)
                .replace(
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

        return "";
    }

    function validateWalletNumber(value) {
        const walletNumber =
            normalizeWalletNumber(
                value
            );

        if (!walletNumber) {
            throw new WithdrawDBError({
                code:
                    "invalid-wallet-number",

                message:
                    "Enter a valid Bangladesh mobile wallet number.",

                field:
                    "walletNumber"
            });
        }

        return walletNumber;
    }

    function formatWalletNumber(value) {
        const normalized =
            normalizeWalletNumber(
                value
            );

        if (!normalized) {
            return toSafeString(
                value
            );
        }

        return `0${normalized.slice(
            4
        )}`;
    }

    function maskWalletNumber(value) {
        const rawValue =
            toSafeString(value);

        if (
            rawValue.includes("*")
        ) {
            return rawValue;
        }

        const formatted =
            formatWalletNumber(
                rawValue
            )
                .replace(
                    /\D/g,
                    ""
                );

        if (!formatted) {
            return "";
        }

        return `${"*".repeat(
            Math.max(
                0,
                formatted.length -
                4
            )
        )}${formatted.slice(-4)}`;
    }

    /* =====================================================
       WITHDRAWAL STATUS
    ===================================================== */

    function normalizeStatus(value) {
        const status =
            toSafeString(value)
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        switch (status) {
            case "":
                return "";

            case "pending":
            case "processing":
                return WITHDRAWAL_STATUSES
                    .PENDING;

            case "approved":
            case "successful":
            case "success":
            case "completed":
                return WITHDRAWAL_STATUSES
                    .APPROVED;

            case "rejected":
            case "failed":
                return WITHDRAWAL_STATUSES
                    .REJECTED;

            /*
             * Historical compatibility only.
             */
            case "cancelled":
            case "canceled":
                return WITHDRAWAL_STATUSES
                    .CANCELLED;

            default:
                return "";
        }
    }

    function isSupportedStatus(value) {
        const rawStatus =
            toSafeString(value);

        return (
            !rawStatus ||
            Boolean(
                normalizeStatus(
                    rawStatus
                )
            )
        );
    }

    function getStatusLabel(status) {
        switch (
            normalizeStatus(
                status
            )
        ) {
            case WITHDRAWAL_STATUSES
                .PENDING:

                return "Pending";

            case WITHDRAWAL_STATUSES
                .APPROVED:

                return "Approved";

            case WITHDRAWAL_STATUSES
                .REJECTED:

                return "Rejected";

            case WITHDRAWAL_STATUSES
                .CANCELLED:

                return "Cancelled";

            default:
                return "";
        }
    }

    function getLegacyStatus(status) {
        switch (
            normalizeStatus(
                status
            )
        ) {
            case WITHDRAWAL_STATUSES
                .PENDING:

                return "processing";

            case WITHDRAWAL_STATUSES
                .APPROVED:

                return "successful";

            case WITHDRAWAL_STATUSES
                .REJECTED:

                return "rejected";

            case WITHDRAWAL_STATUSES
                .CANCELLED:

                return "cancelled";

            default:
                return "";
        }
    }

    /* =====================================================
       DATE FORMATTING
    ===================================================== */

    function formatDate(
        value,
        options = {}
    ) {
        const timestamp =
            serializeTimestamp(
                value
            );

        if (!timestamp) {
            return "";
        }

        const includeTime =
            options.includeTime !==
            false;

        try {
            return new Intl.DateTimeFormat(
                "en-GB",
                {
                    day:
                        "2-digit",

                    month:
                        "2-digit",

                    year:
                        "numeric",

                    timeZone:
                        "Asia/Dhaka",

                    ...(
                        includeTime
                            ? {
                                hour:
                                    "2-digit",

                                minute:
                                    "2-digit",

                                hour12:
                                    true
                            }
                            : {}
                    )
                }
            ).format(
                new Date(timestamp)
            );
        } catch {
            return "";
        }
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
                fallbackId
            );

        const status =
            normalizeStatus(
                source.status
            ) ||
            WITHDRAWAL_STATUSES
                .PENDING;

        const provider =
            normalizeWalletProvider(
                source.provider ||
                source.walletProvider ||
                source.wallet
            );

        const walletNumber =
            toSafeString(
                source.walletNumber ||
                source.number ||
                source.accountNumber
            );

        const maskedWalletNumber =
            toSafeString(
                source.maskedWalletNumber ||
                source.maskedNumber
            ) ||
            maskWalletNumber(
                walletNumber
            );

        const amount =
            toNonNegativeInteger(
                source.amount
            );

        const createdAt =
            serializeTimestamp(
                source.createdAt ||
                source.date
            );

        return {
            id:
                withdrawalId,

            withdrawalId,

            requestId:
                toSafeString(
                    source.requestId
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

            provider,

            providerLabel:
                getWalletProviderLabel(
                    provider
                ),

            walletProvider:
                provider,

            /*
             * Existing UI compatibility fields.
             */

            wallet:
                getWalletProviderLabel(
                    provider
                ),

            walletNumber,

            number:
                walletNumber,

            displayNumber:
                formatWalletNumber(
                    walletNumber
                ),

            maskedWalletNumber,

            maskedNumber:
                maskedWalletNumber,

            amount,

            amountText:
                formatMoney(
                    amount
                ),

            status,

            canonicalStatus:
                status,

            legacyStatus:
                getLegacyStatus(
                    status
                ),

            statusLabel:
                getStatusLabel(
                    status
                ),

            /*
             * Final policy:
             * submitted withdrawals are immutable to users.
             */

            canCancel:
                false,

            cancellationDisabled:
                true,

            holdTransactionId:
                toSafeString(
                    source.holdTransactionId
                ),

            completionTransactionId:
                toSafeString(
                    source
                        .completionTransactionId
                ),

            refundTransactionId:
                toSafeString(
                    source
                        .refundTransactionId
                ),

            adminNote:
                toSafeString(
                    source.adminNote ||
                    source.reviewNote
                ),

            reason:
                toSafeString(
                    source.reason ||
                    source.rejectionReason ||
                    source.cancellationReason
                ),

            reviewedBy:
                toSafeString(
                    source.reviewedBy ||
                    source.adminUid
                ),

            /*
             * Historical payment fields are read-only compatibility.
             * Current Admin approval does not require these fields.
             */

            paymentConfirmed:
                source.paymentConfirmed ===
                true,

            paymentConfirmedAt:
                serializeTimestamp(
                    source.paymentConfirmedAt
                ),

            paymentReference:
                toSafeString(
                    source.paymentReference
                ),

            createdAt,

            createdAtText:
                formatDate(
                    createdAt
                ),

            date:
                createdAt,

            dateText:
                formatDate(
                    createdAt
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
             * Historical read-only field.
             */

            cancelledAt:
                serializeTimestamp(
                    source.cancelledAt ||
                    source.canceledAt
                )
        };
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
                withdrawal =>
                    normalizeWithdrawal(
                        withdrawal,
                        withdrawal?.id
                    )
            )
            .sort(
                (
                    firstWithdrawal,
                    secondWithdrawal
                ) => {
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
            withdrawal => {
                const withdrawalId =
                    toSafeString(
                        withdrawal
                            ?.withdrawalId ||
                        withdrawal?.id
                    );

                if (
                    withdrawalId
                ) {
                    withdrawalsById
                        .set(
                            withdrawalId,
                            withdrawal
                        );
                }
            }
        );

        return normalizeWithdrawals(
            Array.from(
                withdrawalsById
                    .values()
            )
        );
    }

    function extractPaginationState(result) {
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

        const hasMore =
            source.hasMore ===
                true ||
            nestedSource.hasMore ===
                true;

        const nextCursor =
            toSafeString(
                source.nextCursor ||
                nestedSource.nextCursor
            );

        return {
            hasMore:
                hasMore &&
                Boolean(
                    nextCursor
                ),

            nextCursor:
                hasMore
                    ? nextCursor
                    : ""
        };
    }

    function upsertWithdrawal(
        withdrawal
    ) {
        if (
            !withdrawal
                ?.withdrawalId
        ) {
            return false;
        }

        const existingIndex =
            state.withdrawals
                .findIndex(
                    item =>
                        item.withdrawalId ===
                        withdrawal
                            .withdrawalId
                );

        if (
            existingIndex >=
            0
        ) {
            state.withdrawals[
                existingIndex
            ] = withdrawal;
        } else {
            state.withdrawals
                .unshift(
                    withdrawal
                );
        }

        state.withdrawals =
            normalizeWithdrawals(
                state.withdrawals
            );

        return true;
    }

    /* =====================================================
       WITHDRAWAL SUMMARY
    ===================================================== */

    function createEmptySummary() {
        return {
            total:
                0,

            pending:
                0,

            approved:
                0,

            rejected:
                0,

            /*
             * Historical read-only compatibility.
             */

            cancelled:
                0,

            totalRequestedAmount:
                0,

            totalPendingAmount:
                0,

            totalApprovedAmount:
                0,

            totalRejectedAmount:
                0,

            totalCancelledAmount:
                0,

            minimumWithdrawalAmount:
                DEFAULT_MINIMUM_AMOUNT,

            lastWithdrawal:
                null,

            /*
             * Existing UI compatibility aliases.
             */

            processing:
                0,

            successful:
                0,

            totalProcessingAmount:
                0,

            totalSuccessfulAmount:
                0
        };
    }

    function normalizeSummary(summary) {
        const source =
            isPlainObject(
                summary
            )
                ? summary
                : {};

        const pending =
            toNonNegativeInteger(
                source.pending ??
                source.processing
            );

        const approved =
            toNonNegativeInteger(
                source.approved ??
                source.successful
            );

        const rejected =
            toNonNegativeInteger(
                source.rejected
            );

        const cancelled =
            toNonNegativeInteger(
                source.cancelled ??
                source.canceled
            );

        const reconstructedTotal =
            pending +
            approved +
            rejected +
            cancelled;

        const totalPendingAmount =
            toNonNegativeInteger(
                source
                    .totalPendingAmount ??
                source
                    .totalProcessingAmount
            );

        const totalApprovedAmount =
            toNonNegativeInteger(
                source
                    .totalApprovedAmount ??
                source
                    .totalSuccessfulAmount
            );

        const totalRejectedAmount =
            toNonNegativeInteger(
                source
                    .totalRejectedAmount
            );

        const totalCancelledAmount =
            toNonNegativeInteger(
                source
                    .totalCancelledAmount ??
                source
                    .totalCanceledAmount
            );

        const calculatedRequestedAmount =
            safeAdd(
                safeAdd(
                    totalPendingAmount,
                    totalApprovedAmount
                ),

                safeAdd(
                    totalRejectedAmount,
                    totalCancelledAmount
                )
            );

        return {
            total:
                Math.max(
                    toNonNegativeInteger(
                        source.total
                    ),

                    reconstructedTotal
                ),

            pending,
            approved,
            rejected,
            cancelled,

            totalRequestedAmount:
                Math.max(
                    toNonNegativeInteger(
                        source
                            .totalRequestedAmount
                    ),

                    calculatedRequestedAmount
                ),

            totalPendingAmount,

            totalApprovedAmount,

            totalRejectedAmount,

            totalCancelledAmount,

            minimumWithdrawalAmount:
                Math.max(
                    DEFAULT_MINIMUM_AMOUNT,

                    toNonNegativeInteger(
                        source
                            .minimumWithdrawalAmount ??
                        source
                            .minimumAmount,

                        DEFAULT_MINIMUM_AMOUNT
                    )
                ),

            lastWithdrawal:
                source.lastWithdrawal
                    ? normalizeWithdrawal(
                        source
                            .lastWithdrawal,

                        source
                            .lastWithdrawal
                            ?.id
                    )
                    : null,

            processing:
                pending,

            successful:
                approved,

            totalProcessingAmount:
                totalPendingAmount,

            totalSuccessfulAmount:
                totalApprovedAmount
        };
    }

    function createSummaryFromWithdrawals(
        withdrawals
    ) {
        const summary =
            createEmptySummary();

        withdrawals.forEach(
            withdrawal => {
                const amount =
                    toNonNegativeInteger(
                        withdrawal.amount
                    );

                summary.total +=
                    1;

                summary.totalRequestedAmount =
                    safeAdd(
                        summary
                            .totalRequestedAmount,

                        amount
                    );

                switch (
                    withdrawal.status
                ) {
                    case WITHDRAWAL_STATUSES
                        .PENDING:

                        summary.pending +=
                            1;

                        summary.totalPendingAmount =
                            safeAdd(
                                summary
                                    .totalPendingAmount,

                                amount
                            );
                        break;

                    case WITHDRAWAL_STATUSES
                        .APPROVED:

                        summary.approved +=
                            1;

                        summary.totalApprovedAmount =
                            safeAdd(
                                summary
                                    .totalApprovedAmount,

                                amount
                            );
                        break;

                    case WITHDRAWAL_STATUSES
                        .REJECTED:

                        summary.rejected +=
                            1;

                        summary.totalRejectedAmount =
                            safeAdd(
                                summary
                                    .totalRejectedAmount,

                                amount
                            );
                        break;

                    case WITHDRAWAL_STATUSES
                        .CANCELLED:

                        /*
                         * Historical records only.
                         */

                        summary.cancelled +=
                            1;

                        summary.totalCancelledAmount =
                            safeAdd(
                                summary
                                    .totalCancelledAmount,

                                amount
                            );
                        break;

                    default:
                        break;
                }
            }
        );

        summary.lastWithdrawal =
            withdrawals[0] ||
            null;

        return normalizeSummary(
            summary
        );
    }

    /* =====================================================
       RESULT EXTRACTION
    ===================================================== */

    function extractWithdrawal(result) {
        if (
            isPlainObject(
                result?.withdrawal
            )
        ) {
            return result.withdrawal;
        }

        if (
            isPlainObject(result) &&
            (
                result.withdrawalId ||
                result.id
            )
        ) {
            return result;
        }

        return null;
    }

    function extractWithdrawals(result) {
        if (
            Array.isArray(
                result?.withdrawals
            )
        ) {
            return result.withdrawals;
        }

        return Array.isArray(result)
            ? result
            : [];
    }

    function extractSummary(result) {
        if (
            isPlainObject(
                result?.summary
            )
        ) {
            return result.summary;
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

        return null;
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

            submitting:
                state.submitting,

            cancellingWithdrawalId:
                state
                    .cancellingWithdrawalId,

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

            statusFilter:
                state.statusFilter,

            limit:
                state.limit,

            nextCursor:
                state.nextCursor,

            hasMore:
                state.hasMore,

            withdrawals:
                state.withdrawals,

            summary:
                state.summary,

            lastSubmission:
                state.lastSubmission,

            lastCancellation:
                state.lastCancellation,

            lastUpdatedAt:
                state.lastUpdatedAt,

            error:
                state.error
        });
    }

    function dispatchWithdrawalEvent(
        eventName,
        detail = getState()
    ) {
        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail
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
            listener => {
                try {
                    listener(
                        snapshot
                    );
                } catch (error) {
                    console.error(
                        "[WithdrawDB] Subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatchWithdrawalEvent(
            eventName,
            snapshot
        );

        return snapshot;
    }

    function updateLoadingState() {
        const loading =
            activeRequestCount >
            0;

        if (
            state.loading ===
            loading
        ) {
            return false;
        }

        state.loading =
            loading;

        dispatchWithdrawalEvent(
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
                activeRequestCount -
                1
            );

        updateLoadingState();
    }

    function setSubmitting(value) {
        const submitting =
            value ===
            true;

        if (
            state.submitting ===
            submitting
        ) {
            return false;
        }

        state.submitting =
            submitting;

        dispatchWithdrawalEvent(
            EVENT_SUBMITTING
        );

        return true;
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

    function reportAccessBlocked(
        reason
    ) {
        state.error = {
            code:
                "withdrawal-access-blocked",

            message:
                "Verified Google sign-in is required.",

            field:
                "",

            reason:
                toSafeString(
                    reason
                ),

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

        if (
            configuredAuth
        ) {
            return configuredAuth;
        }

        if (
            window.firebase &&
            typeof window.firebase
                .auth ===
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
            try {
                const user =
                    authService
                        .getCurrentUser();

                if (
                    user?.uid
                ) {
                    return user;
                }
            } catch {
                /*
                 * Continue.
                 */
            }
        }

        if (
            authService &&
            typeof authService
                .getFirebaseUser ===
                "function"
        ) {
            try {
                const user =
                    authService
                        .getFirebaseUser();

                if (
                    user?.uid
                ) {
                    return user;
                }
            } catch {
                /*
                 * Continue.
                 */
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
                    "[WithdrawDB] AuthGuard initialization did not complete.",
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
                    "[WithdrawDB] AuthService initialization did not complete.",
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
            return Array.from(
                new Set(
                    user.providerIds
                        .map(
                            toSafeString
                        )
                        .filter(
                            Boolean
                        )
                )
            );
        }

        if (
            Array.isArray(
                user?.providerData
            )
        ) {
            return Array.from(
                new Set(
                    user.providerData
                        .map(
                            provider =>
                                toSafeString(
                                    provider
                                        ?.providerId
                                )
                        )
                        .filter(
                            Boolean
                        )
                )
            );
        }

        return [];
    }

    async function requireWithdrawalUser() {
        if (
            window.AuthGuard &&
            typeof window.AuthGuard
                .requireWithdrawalAccess ===
                "function"
        ) {
            return window.AuthGuard
                .requireWithdrawalAccess({
                    action:
                        "withdrawal",

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
            throw new WithdrawDBError({
                code:
                    "unauthenticated",

                message:
                    "Google sign-in is required."
            });
        }

        const providerIds =
            getProviderIds(
                user
            );

        const googleConnected =
            user.isGoogleConnected ===
                true ||
            user.googleConnected ===
                true ||
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            );

        if (!googleConnected) {
            throw new WithdrawDBError({
                code:
                    "google-account-required",

                message:
                    "A Google-connected account is required."
            });
        }

        if (
            user.emailVerified !==
            true
        ) {
            throw new WithdrawDBError({
                code:
                    "verified-email-required",

                message:
                    "A verified Google email is required."
            });
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

        throw new WithdrawDBError({
            code:
                "google-sign-in-required",

            message:
                "Sign in directly with Google to continue."
        });
    }

    /* =====================================================
       FIREBASE SPARK CLIENT
    ===================================================== */

    function requireFunctionsClient() {
        const client =
            window.FunctionsClient ||
            null;

        if (!client) {
            throw new WithdrawDBError({
                code:
                    "functions-client-not-loaded",

                message:
                    "Firebase Spark Client is not loaded."
            });
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
            typeof client[
                methodName
            ] ===
                "function"
        ) {
            return unwrapCallableResult(
                await client[
                    methodName
                ](
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

        throw new WithdrawDBError({
            code:
                "callable-method-unavailable",

            message:
                `Client method is unavailable: ${functionName}`
        });
    }

    /* =====================================================
       AVAILABLE BALANCE
    ===================================================== */

    function getWalletState() {
        if (
            !window.WalletDB ||
            typeof window.WalletDB
                .getState !==
                "function"
        ) {
            return null;
        }

        try {
            return window.WalletDB
                .getState();
        } catch {
            return null;
        }
    }

    function getAvailableBalanceInfo(
        uid = ""
    ) {
        const walletState =
            getWalletState();

        const wallet =
            walletState?.wallet;

        const walletUid =
            toSafeString(
                wallet?.uid ||
                wallet?.userId ||
                walletState
                    ?.currentUser
                    ?.uid
            );

        if (
            !wallet ||
            !walletUid ||
            (
                uid &&
                walletUid !==
                uid
            )
        ) {
            return {
                known:
                    false,

                amount:
                    0
            };
        }

        return {
            known:
                true,

            amount:
                toNonNegativeInteger(
                    wallet
                        .availableBalance
                )
        };
    }

    function getAvailableBalance() {
        return getAvailableBalanceInfo(
            resolveCurrentUser()
                ?.uid ||
            ""
        ).amount;
    }

    function hasEnoughBalance(amount) {
        const requestedAmount =
            toNonNegativeInteger(
                amount
            );

        const balanceInfo =
            getAvailableBalanceInfo(
                resolveCurrentUser()
                    ?.uid ||
                ""
            );

        return Boolean(
            requestedAmount >
                0 &&
            balanceInfo.known &&
            balanceInfo.amount >=
                requestedAmount
        );
    }

    async function refreshWalletBalance() {
        if (
            window.WalletDB &&
            typeof window.WalletDB
                .refreshWallet ===
                "function"
        ) {
            try {
                await window.WalletDB
                    .refreshWallet({
                        notifyChange:
                            false
                    });
            } catch (error) {
                console.warn(
                    "[WithdrawDB] Wallet balance could not be refreshed before submission.",
                    error
                );
            }
        }
    }

    /* =====================================================
       SUBMISSION VALIDATION
    ===================================================== */

    function getMinimumWithdrawalAmount() {
        return Math.max(
            DEFAULT_MINIMUM_AMOUNT,

            toNonNegativeInteger(
                state.summary
                    .minimumWithdrawalAmount,

                DEFAULT_MINIMUM_AMOUNT
            )
        );
    }

    function validateSubmission(
        input,
        options = {}
    ) {
        const source =
            isPlainObject(input)
                ? input
                : {};

        const provider =
            validateWalletProvider(
                source.provider ||
                source.walletProvider ||
                source.wallet
            );

        const walletNumber =
            validateWalletNumber(
                source.walletNumber ||
                source.number ||
                source.mobileNumber
            );

        const rawAmount =
            Number(
                source.amount
            );

        if (
            !Number.isSafeInteger(
                rawAmount
            ) ||
            rawAmount <
                1
        ) {
            throw new WithdrawDBError({
                code:
                    "invalid-withdrawal-amount",

                message:
                    "Enter a positive whole-number withdrawal amount.",

                field:
                    "amount"
            });
        }

        const amount =
            rawAmount;

        const minimumAmount =
            Math.max(
                DEFAULT_MINIMUM_AMOUNT,

                toNonNegativeInteger(
                    options.minimumAmount,

                    getMinimumWithdrawalAmount()
                )
            );

        if (
            amount <
            minimumAmount
        ) {
            throw new WithdrawDBError({
                code:
                    "withdrawal-below-minimum",

                message:
                    `Minimum withdrawal amount is ${formatMoney(
                        minimumAmount
                    )}.`,

                field:
                    "amount",

                details: {
                    field:
                        "amount",

                    minimumAmount
                }
            });
        }

        if (
            amount %
                WITHDRAWAL_AMOUNT_MULTIPLE !==
            0
        ) {
            throw new WithdrawDBError({
                code:
                    "invalid-withdrawal-multiple",

                message:
                    `Withdrawal amount must be a multiple of ${formatMoney(
                        WITHDRAWAL_AMOUNT_MULTIPLE
                    )}.`,

                field:
                    "amount",

                details: {
                    field:
                        "amount",

                    amountMultiple:
                        WITHDRAWAL_AMOUNT_MULTIPLE
                }
            });
        }

        const balanceInfo =
            options.balanceInfo ||
            {
                known:
                    false,

                amount:
                    0
            };

        if (
            balanceInfo.known &&
            amount >
                balanceInfo.amount
        ) {
            throw new WithdrawDBError({
                code:
                    "insufficient-balance",

                message:
                    "Withdrawal amount exceeds the available balance.",

                field:
                    "amount",

                details: {
                    field:
                        "amount",

                    availableBalance:
                        balanceInfo.amount,

                    requestedAmount:
                        amount
                }
            });
        }

        return {
            provider,
            walletNumber,
            amount
        };
    }

    /* =====================================================
       IDEMPOTENT REQUEST ID
    ===================================================== */

    function createRandomPart() {
        if (
            window.crypto &&
            typeof window.crypto
                .getRandomValues ===
                "function"
        ) {
            const values =
                new Uint32Array(
                    4
                );

            window.crypto
                .getRandomValues(
                    values
                );

            return Array.from(
                values
            )
                .map(
                    value =>
                        value.toString(
                            36
                        )
                )
                .join("");
        }

        return (
            Math.random()
                .toString(36)
                .slice(2) +
            Math.random()
                .toString(36)
                .slice(2)
        );
    }

    function createRequestId(uid) {
        return [
            "withdraw",

            toSafeString(uid)
                .slice(
                    0,
                    12
                ),

            Date.now()
                .toString(
                    36
                ),

            createRandomPart()
                .slice(
                    0,
                    32
                )
        ].join("_");
    }

    function validateRequestId(value) {
        const requestId =
            toSafeString(
                value
            );

        if (
            !/^[A-Za-z0-9_-]{8,128}$/
                .test(
                    requestId
                )
        ) {
            throw new WithdrawDBError({
                code:
                    "invalid-request-id",

                message:
                    "Withdrawal request ID is invalid.",

                field:
                    "requestId"
            });
        }

        return requestId;
    }

    function createSubmissionSignature({
        uid,
        provider,
        walletNumber,
        amount
    }) {
        return [
            toSafeString(
                uid
            ),

            normalizeWalletProvider(
                provider
            ),

            normalizeWalletNumber(
                walletNumber
            ),

            toNonNegativeInteger(
                amount
            )
        ].join("|");
    }

    function readPendingRequest(
        uid = ""
    ) {
        try {
            const storedValue =
                window.sessionStorage
                    .getItem(
                        PENDING_REQUEST_STORAGE_KEY
                    );

            if (!storedValue) {
                return null;
            }

            const pendingRequest =
                JSON.parse(
                    storedValue
                );

            const createdAt =
                toSafeNumber(
                    pendingRequest
                        ?.createdAt
                );

            const storedUid =
                toSafeString(
                    pendingRequest
                        ?.uid
                );

            if (
                !pendingRequest
                    ?.requestId ||
                !pendingRequest
                    ?.signature ||
                !storedUid ||
                (
                    uid &&
                    storedUid !==
                    uid
                ) ||
                !createdAt ||
                Date.now() -
                    createdAt >
                    PENDING_REQUEST_MAX_AGE_MS
            ) {
                clearPendingRequest();

                return null;
            }

            return pendingRequest;
        } catch {
            clearPendingRequest();

            return null;
        }
    }

    function savePendingRequest(
        pendingRequest
    ) {
        try {
            window.sessionStorage
                .setItem(
                    PENDING_REQUEST_STORAGE_KEY,

                    JSON.stringify(
                        pendingRequest
                    )
                );

            return true;
        } catch {
            return false;
        }
    }

    function clearPendingRequest(
        requestId = ""
    ) {
        try {
            if (
                requestId
            ) {
                const currentRequest =
                    readPendingRequest();

                if (
                    currentRequest &&
                    currentRequest
                        .requestId !==
                        requestId
                ) {
                    return false;
                }
            }

            window.sessionStorage
                .removeItem(
                    PENDING_REQUEST_STORAGE_KEY
                );

            return true;
        } catch {
            return false;
        }
    }

    function resolveRequestId({
        user,
        submission,
        requestedId = ""
    }) {
        if (
            toSafeString(
                requestedId
            )
        ) {
            return validateRequestId(
                requestedId
            );
        }

        const signature =
            createSubmissionSignature({
                uid:
                    user.uid,

                ...submission
            });

        const pendingRequest =
            readPendingRequest(
                user.uid
            );

        if (
            pendingRequest &&
            pendingRequest.signature ===
                signature
        ) {
            return pendingRequest
                .requestId;
        }

        const requestId =
            validateRequestId(
                createRequestId(
                    user.uid
                )
            );

        savePendingRequest({
            uid:
                user.uid,

            requestId,

            signature,

            createdAt:
                Date.now()
        });

        return requestId;
    }

    /* =====================================================
       WITHDRAWAL ID COMPATIBILITY VALIDATOR
    ===================================================== */

    function validateWithdrawalId(value) {
        const withdrawalId =
            toSafeString(
                value
            );

        if (
            withdrawalId.length <
                8 ||
            withdrawalId.length >
                512 ||
            !/^[A-Za-z0-9_-]+$/
                .test(
                    withdrawalId
                )
        ) {
            throw new WithdrawDBError({
                code:
                    "invalid-withdrawal-id",

                message:
                    "A valid withdrawal ID is required.",

                field:
                    "withdrawalId"
            });
        }

        return withdrawalId;
    }

    /* =====================================================
       LOAD WITHDRAWAL HISTORY
    ===================================================== */

    async function refreshWithdrawals(
        options = {}
    ) {
        let user =
            null;

        try {
            user =
                await requireWithdrawalUser();
        } catch (error) {
            const normalizedError =
                normalizeError(
                    error
                );

            state.withdrawals =
                [];

            state.nextCursor =
                "";

            state.hasMore =
                false;

            if (
                normalizedError.code ===
                "unauthenticated"
            ) {
                if (
                    options.notifyChange !==
                    false
                ) {
                    notify();
                }

                return [];
            }

            reportAccessBlocked(
                normalizedError.code
            );

            throw error;
        }

        const rawStatus =
            options.status ??
            state.statusFilter;

        if (
            !isSupportedStatus(
                rawStatus
            )
        ) {
            throw new WithdrawDBError({
                code:
                    "invalid-withdrawal-status",

                message:
                    "Unsupported withdrawal status.",

                field:
                    "status"
            });
        }

        const normalizedStatus =
            normalizeStatus(
                rawStatus
            );

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.limit
            );

        const append =
            options.append ===
            true;

        if (
            append &&
            (
                !state.hasMore ||
                !state.nextCursor
            )
        ) {
            return cloneValue(
                state.withdrawals
            );
        }

        const payload = {
            limit:
                normalizedLimit
        };

        if (
            normalizedStatus
        ) {
            payload.status =
                normalizedStatus;
        }

        if (
            append
        ) {
            payload.cursor =
                state.nextCursor;
        }

        const expectedUid =
            user.uid;

        const expectedGeneration =
            dataGeneration;

        const requestId =
            ++withdrawalsRequestSequence;

        beginRequest();
        clearError();

        try {
            const result =
                await callBackend(
                    "getMyWithdrawals",
                    "getMyWithdrawals",
                    payload
                );

            if (
                requestId !==
                    withdrawalsRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return cloneValue(
                    state.withdrawals
                );
            }

            const pageWithdrawals =
                normalizeWithdrawals(
                    extractWithdrawals(
                        result
                    )
                );

            const pagination =
                extractPaginationState(
                    result
                );

            state.statusFilter =
                normalizedStatus;

            state.limit =
                normalizedLimit;

            state.withdrawals =
                append
                    ? mergeUniqueWithdrawals(
                        state.withdrawals,
                        pageWithdrawals
                    )
                    : pageWithdrawals;

            state.nextCursor =
                pagination
                    .nextCursor;

            state.hasMore =
                pagination
                    .hasMore;

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            if (
                options.notifyChange !==
                false
            ) {
                notify();
            }

            return cloneValue(
                state.withdrawals
            );
        } catch (error) {
            if (
                requestId ===
                    withdrawalsRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            endRequest();
        }
    }

    /* =====================================================
       LOAD WITHDRAWAL SUMMARY
    ===================================================== */

    async function refreshSummary(
        options = {}
    ) {
        let user =
            null;

        try {
            user =
                await requireWithdrawalUser();
        } catch (error) {
            const normalizedError =
                normalizeError(
                    error
                );

            state.summary =
                createEmptySummary();

            if (
                normalizedError.code ===
                "unauthenticated"
            ) {
                if (
                    options.notifyChange !==
                    false
                ) {
                    notify(
                        EVENT_SUMMARY_UPDATED
                    );
                }

                return cloneValue(
                    state.summary
                );
            }

            reportAccessBlocked(
                normalizedError.code
            );

            throw error;
        }

        const expectedUid =
            user.uid;

        const expectedGeneration =
            dataGeneration;

        const requestId =
            ++summaryRequestSequence;

        beginRequest();
        clearError();

        try {
            const result =
                await callBackend(
                    "getMyWithdrawalSummary",
                    "getMyWithdrawalSummary",
                    {}
                );

            if (
                requestId !==
                    summaryRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return cloneValue(
                    state.summary
                );
            }

            const summary =
                extractSummary(
                    result
                );

            state.summary =
                summary
                    ? normalizeSummary(
                        summary
                    )
                    : createSummaryFromWithdrawals(
                        state.withdrawals
                    );

            if (
                options.notifyChange !==
                false
            ) {
                notify(
                    EVENT_SUMMARY_UPDATED
                );
            }

            return cloneValue(
                state.summary
            );
        } catch (error) {
            if (
                requestId ===
                    summaryRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            endRequest();
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
                await requireWithdrawalUser();
        } catch (error) {
            const normalizedError =
                normalizeError(
                    error
                );

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

        const rawStatus =
            options.status ??
            state.statusFilter;

        if (
            !isSupportedStatus(
                rawStatus
            )
        ) {
            throw new WithdrawDBError({
                code:
                    "invalid-withdrawal-status",

                message:
                    "Unsupported withdrawal status.",

                field:
                    "status"
            });
        }

        const normalizedStatus =
            normalizeStatus(
                rawStatus
            );

        const normalizedLimit =
            toSafeLimit(
                options.limit ??
                state.limit
            );

        const statusChanged =
            normalizedStatus !==
            state.statusFilter;

        const limitChanged =
            normalizedLimit !==
            state.limit;

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
            !statusChanged &&
            !limitChanged &&
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

        const withdrawalsRequestId =
            ++withdrawalsRequestSequence;

        const summaryRequestId =
            ++summaryRequestSequence;

        lastRefreshStartedAt =
            now;

        state.currentUser =
            user;

        state.statusFilter =
            normalizedStatus;

        state.limit =
            normalizedLimit;

        clearError();
        beginRequest();

        const historyPayload = {
            limit:
                normalizedLimit
        };

        if (
            normalizedStatus
        ) {
            historyPayload.status =
                normalizedStatus;
        }

        try {
            const [
                withdrawalsResult,
                summaryResult
            ] =
                await Promise.all([
                    callBackend(
                        "getMyWithdrawals",
                        "getMyWithdrawals",
                        historyPayload
                    ),

                    callBackend(
                        "getMyWithdrawalSummary",
                        "getMyWithdrawalSummary",
                        {}
                    )
                ]);

            if (
                refreshRequestId !==
                    refreshRequestSequence ||
                withdrawalsRequestId !==
                    withdrawalsRequestSequence ||
                summaryRequestId !==
                    summaryRequestSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return getState();
            }

            state.withdrawals =
                normalizeWithdrawals(
                    extractWithdrawals(
                        withdrawalsResult
                    )
                );

            const pagination =
                extractPaginationState(
                    withdrawalsResult
                );

            state.nextCursor =
                pagination
                    .nextCursor;

            state.hasMore =
                pagination
                    .hasMore;

            const summary =
                extractSummary(
                    summaryResult
                );

            state.summary =
                summary
                    ? normalizeSummary(
                        summary
                    )
                    : createSummaryFromWithdrawals(
                        state.withdrawals
                    );

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            return getState();
        } catch (error) {
            if (
                refreshRequestId ===
                    refreshRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            endRequest();

            if (
                refreshRequestId ===
                    refreshRequestSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                const snapshot =
                    notify();

                dispatchWithdrawalEvent(
                    EVENT_SUMMARY_UPDATED,
                    snapshot
                );
            }
        }
    }

    /* =====================================================
       SUBMIT WITHDRAWAL
    ===================================================== */

    async function submitWithdrawal(
        input
    ) {
        if (
            state.submitting
        ) {
            throw new WithdrawDBError({
                code:
                    "withdrawal-submission-in-progress",

                message:
                    "A withdrawal request is already being submitted."
            });
        }

        const user =
            await requireWithdrawalUser();

        await refreshWalletBalance();

        const balanceInfo =
            getAvailableBalanceInfo(
                user.uid
            );

        const submission =
            validateSubmission(
                input,
                {
                    minimumAmount:
                        getMinimumWithdrawalAmount(),

                    balanceInfo
                }
            );

        const requestId =
            resolveRequestId({
                user,
                submission,

                requestedId:
                    input?.requestId
            });

        const expectedUid =
            user.uid;

        const expectedGeneration =
            dataGeneration;

        const submissionId =
            ++submissionSequence;

        clearError();

        setSubmitting(
            true
        );

        try {
            const result =
                await callBackend(
                    "submitWithdrawal",
                    "submitWithdrawal",
                    {
                        provider:
                            submission.provider,

                        walletNumber:
                            submission
                                .walletNumber,

                        amount:
                            submission.amount,

                        requestId
                    }
                );

            if (
                submissionId !==
                    submissionSequence ||
                expectedGeneration !==
                    dataGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return null;
            }

            const rawWithdrawal =
                extractWithdrawal(
                    result
                );

            const withdrawal =
                rawWithdrawal
                    ? normalizeWithdrawal(
                        rawWithdrawal,
                        rawWithdrawal.id
                    )
                    : null;

            clearPendingRequest(
                requestId
            );

            if (
                withdrawal
            ) {
                upsertWithdrawal(
                    withdrawal
                );
            }

            state.lastSubmission = {
                success:
                    result?.success !==
                    false,

                created:
                    result?.created ===
                    true,

                duplicate:
                    result?.duplicate ===
                        true ||
                    result?.idempotent ===
                        true,

                requestId,

                withdrawal,

                submittedAt:
                    new Date()
                        .toISOString()
            };

            clearError();

            dispatchWithdrawalEvent(
                EVENT_SUBMITTED,
                cloneValue(
                    state.lastSubmission
                )
            );

            /*
             * Server already moved:
             *
             * availableBalance -> heldBalance
             *
             * Now refresh the authoritative wallet.
             */

            window.dispatchEvent(
                new CustomEvent(
                    "wallet:refresh",
                    {
                        detail: {
                            reason:
                                "withdrawal_submitted",

                            withdrawalId:
                                withdrawal
                                    ?.withdrawalId ||
                                "",

                            requestId
                        }
                    }
                )
            );

            window.dispatchEvent(
                new CustomEvent(
                    "wallet:operation-completed",
                    {
                        detail: {
                            operation:
                                "withdrawal_hold",

                            withdrawalId:
                                withdrawal
                                    ?.withdrawalId ||
                                "",

                            requestId
                        }
                    }
                )
            );

            notify();

            await Promise.allSettled([
                refresh({
                    force:
                        true
                }),

                window.WalletDB &&
                typeof window.WalletDB
                    .refresh ===
                    "function"
                    ? window.WalletDB
                        .refresh({
                            force:
                                true
                        })
                    : Promise.resolve()
            ]);

            return cloneValue(
                state.lastSubmission
            );
        } catch (error) {
            if (
                submissionId ===
                    submissionSequence &&
                expectedGeneration ===
                    dataGeneration
            ) {
                setError(
                    error
                );
            }

            /*
             * Keep the request ID in sessionStorage.
             * Retrying the same submission remains idempotent.
             */

            throw error;
        } finally {
            if (
                submissionId ===
                    submissionSequence
            ) {
                setSubmitting(
                    false
                );
            }
        }
    }

    /* =====================================================
       CANCELLATION COMPATIBILITY — PERMANENTLY DISABLED

       Final rule:
       - Once submitted, a withdrawal cannot be cancelled,
         edited or deleted by the user.
       - Only Admin Approve / Reject changes a pending request.
       - This method performs ZERO FunctionsClient calls and
         ZERO Firestore / Wallet writes.
    ===================================================== */

    async function cancelWithdrawal() {
        throw new WithdrawDBError({
            code:
                "withdrawal-cancellation-disabled",

            message:
                "Submitted withdrawal requests cannot be cancelled, edited or deleted. Please wait for Admin approval or rejection.",

            field:
                "withdrawalId",

            details: {
                reason:
                    "user_cancellation_disabled",

                immutableAfterSubmission:
                    true
            }
        });
    }

    /* =====================================================
       STATUS FILTER
    ===================================================== */

    async function setStatusFilter(
        status,
        options = {}
    ) {
        if (
            !isSupportedStatus(
                status
            )
        ) {
            throw new WithdrawDBError({
                code:
                    "invalid-withdrawal-status",

                message:
                    "Unsupported withdrawal status.",

                field:
                    "status"
            });
        }

        const normalizedStatus =
            normalizeStatus(
                status
            );

        state.statusFilter =
            normalizedStatus;

        notify(
            EVENT_FILTER_CHANGED
        );

        return refresh({
            force:
                true,

            status:
                normalizedStatus,

            limit:
                options.limit ??
                state.limit
        });
    }

    function clearStatusFilter() {
        return setStatusFilter(
            ""
        );
    }

    /* =====================================================
       LOAD MORE
    ===================================================== */

    async function loadMore() {
        if (
            state.loading ||
            !state.hasMore ||
            !state.nextCursor
        ) {
            return getState();
        }

        await refreshWithdrawals({
            append:
                true,

            status:
                state.statusFilter,

            limit:
                state.limit,

            notifyChange:
                true
        });

        return getState();
    }

    /* =====================================================
       SUMMARY FOR UI
    ===================================================== */

    function getWithdrawalSummary() {
        const summary =
            state.summary;

        return cloneValue({
            ...summary,

            totalRequestedAmountText:
                formatMoney(
                    summary
                        .totalRequestedAmount
                ),

            totalPendingAmountText:
                formatMoney(
                    summary
                        .totalPendingAmount
                ),

            totalApprovedAmountText:
                formatMoney(
                    summary
                        .totalApprovedAmount
                ),

            totalRejectedAmountText:
                formatMoney(
                    summary
                        .totalRejectedAmount
                ),

            /*
             * Historical compatibility only.
             */

            totalCancelledAmountText:
                formatMoney(
                    summary
                        .totalCancelledAmount
                ),

            minimumWithdrawalAmountText:
                formatMoney(
                    summary
                        .minimumWithdrawalAmount
                ),

            totalProcessingAmountText:
                formatMoney(
                    summary
                        .totalProcessingAmount
                ),

            totalSuccessfulAmountText:
                formatMoney(
                    summary
                        .totalSuccessfulAmount
                )
        });
    }

    /* =====================================================
       FILTER HELPERS
    ===================================================== */

    function getWithdrawalsByStatus(
        status
    ) {
        if (
            !isSupportedStatus(
                status
            )
        ) {
            return [];
        }

        const normalizedStatus =
            normalizeStatus(
                status
            );

        if (
            !normalizedStatus
        ) {
            return cloneValue(
                state.withdrawals
            );
        }

        return cloneValue(
            state.withdrawals
                .filter(
                    withdrawal =>
                        withdrawal.status ===
                        normalizedStatus
                )
        );
    }

    function getPendingWithdrawals() {
        return getWithdrawalsByStatus(
            WITHDRAWAL_STATUSES
                .PENDING
        );
    }

    function getApprovedWithdrawals() {
        return getWithdrawalsByStatus(
            WITHDRAWAL_STATUSES
                .APPROVED
        );
    }

    function getRejectedWithdrawals() {
        return getWithdrawalsByStatus(
            WITHDRAWAL_STATUSES
                .REJECTED
        );
    }

    function getCancelledWithdrawals() {
        /*
         * Historical read-only records only.
         */

        return getWithdrawalsByStatus(
            WITHDRAWAL_STATUSES
                .CANCELLED
        );
    }

    /* =====================================================
       RESET
    ===================================================== */

    function reset(
        options = {}
    ) {
        dataGeneration +=
            1;

        refreshRequestSequence +=
            1;

        withdrawalsRequestSequence +=
            1;

        summaryRequestSequence +=
            1;

        submissionSequence +=
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

        state.submitting =
            false;

        state.cancellingWithdrawalId =
            "";

        if (
            options.preserveCurrentUser !==
            true
        ) {
            state.currentUser =
                null;
        }

        state.statusFilter =
            "";

        state.limit =
            DEFAULT_LIMIT;

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.withdrawals =
            [];

        state.summary =
            createEmptySummary();

        state.lastSubmission =
            null;

        state.lastCancellation =
            null;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        lastRefreshStartedAt =
            0;

        clearPendingRequest();
        clearForcedRefreshTimer();

        notify();

        return getState();
    }

    /* =====================================================
       AUTOMATIC REFRESH EVENTS
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
        if (
            !resolveCurrentUser()
                ?.uid
        ) {
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

    function handleWindowFocus() {
        if (
            !resolveCurrentUser()
                ?.uid ||
            state.loading ||
            state.submitting
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
            void refresh()
                .catch(
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
        if (
            boundEvents
        ) {
            return true;
        }

        boundEvents =
            true;

        /*
         * Do not listen to wallet:updated here.
         * WalletDB already listens to withdrawal operations.
         * Listening both ways would create a refresh loop.
         */

        window.addEventListener(
            "withdrawal:refresh",
            scheduleForcedRefresh
        );

        window.addEventListener(
            "withdrawal:admin-updated",
            scheduleForcedRefresh
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
        if (
            !boundEvents
        ) {
            return true;
        }

        boundEvents =
            false;

        window.removeEventListener(
            "withdrawal:refresh",
            scheduleForcedRefresh
        );

        window.removeEventListener(
            "withdrawal:admin-updated",
            scheduleForcedRefresh
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
        if (
            authUnsubscribe
        ) {
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
                firebaseUser => {
                    if (
                        firebaseUser?.uid
                    ) {
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

                error => {
                    setError(
                        error
                    );
                }
            );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (
            readyPromise
        ) {
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

                if (
                    !user?.uid
                ) {
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
            })()
                .catch(
                    error => {
                        state.initialized =
                            false;

                        readyPromise =
                            null;

                        setError(
                            error
                        );

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
                "WithdrawDB subscriber must be a function."
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

        withdrawalsRequestSequence +=
            1;

        summaryRequestSequence +=
            1;

        submissionSequence +=
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

        state.submitting =
            false;

        state.cancellingWithdrawalId =
            "";

        state.currentUser =
            null;

        state.statusFilter =
            "";

        state.limit =
            DEFAULT_LIMIT;

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.withdrawals =
            [];

        state.summary =
            createEmptySummary();

        state.lastSubmission =
            null;

        state.lastCancellation =
            null;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        clearPendingRequest();

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.WithdrawDB =
        Object.freeze({
            init,
            destroy,
            refresh,

            refreshWithdrawals,
            refreshSummary,

            submit:
                submitWithdrawal,

            submitWithdrawal,

            /*
             * Compatibility method only.
             * Always rejects and performs zero writes.
             */

            cancelWithdrawal,

            setStatusFilter,
            clearStatusFilter,
            loadMore,

            getState,
            getWithdrawalSummary,

            getWithdrawals() {
                return cloneValue(
                    state.withdrawals
                );
            },

            getSummary() {
                return cloneValue(
                    state.summary
                );
            },

            getLastSubmission() {
                return cloneValue(
                    state.lastSubmission
                );
            },

            getLastCancellation() {
                /*
                 * Always null for the current workflow.
                 */

                return cloneValue(
                    state.lastCancellation
                );
            },

            getWithdrawalsByStatus,
            getPendingWithdrawals,
            getApprovedWithdrawals,
            getRejectedWithdrawals,
            getCancelledWithdrawals,

            /*
             * Existing UI compatibility methods.
             */

            getProcessingWithdrawals:
                getPendingWithdrawals,

            getSuccessfulWithdrawals:
                getApprovedWithdrawals,

            getAvailableBalance,
            hasEnoughBalance,
            getMinimumWithdrawalAmount,

            normalizeWallet:
                normalizeWalletProvider,

            normalizeWalletProvider,
            normalizeWalletNumber,
            normalizeStatus,
            normalizeWithdrawal,
            normalizeWithdrawals,
            normalizeSummary,

            validateSubmission,
            validateWithdrawalId,

            formatMoney,
            formatDate,
            formatWalletNumber,
            maskWalletNumber,

            getWalletProviderLabel,
            getStatusLabel,
            getLegacyStatus,

            subscribe,
            reset,

            WALLET_TYPES,
            WALLET_PROVIDERS,
            WITHDRAWAL_STATUSES,
            CANONICAL_STATUSES,
            DEFAULT_MINIMUM_AMOUNT,
            WITHDRAWAL_AMOUNT_MULTIPLE,

            WithdrawDBError
        });
})(
    window,
    document
);