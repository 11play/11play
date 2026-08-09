"use strict";

/* =========================================================
   11PLAY — ADMIN TRANSACTIONS MODULE
   File: admin/js/admin.transactions.js

   Responsibilities:
   - Load the permanent wallet ledger
   - Load permanent Admin audit logs
   - Search and filter loaded records
   - Load all records through cursor-based pagination
   - Display canonical credit/debit operations
   - Display referral, withdrawal and Admin adjustment history
   - Require an authorized Admin session before every read
   - Never access Firestore directly

   Canonical wallet transaction types:
   - referral_reward
   - withdraw_hold
   - withdraw_success
   - withdraw_refund
   - admin_adjustment

   Backend functions:
   - getAdminTransactions
   - getAdminAuditLogs
========================================================= */

(function initializeAdminTransactions(
    window,
    document
) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT =
        50;

    const MAXIMUM_LIMIT =
        100;

    const DEFAULT_VIEW =
        "transactions";

    const VIEWS =
        Object.freeze({
            TRANSACTIONS:
                "transactions",

            AUDIT_LOGS:
                "audit-logs"
        });

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

    const DIRECTIONS =
        Object.freeze({
            CREDIT:
                "credit",

            DEBIT:
                "debit"
        });

    const EVENTS =
        Object.freeze({
            UPDATED:
                "admin-transactions:updated",

            LOADING:
                "admin-transactions:loading",

            ERROR:
                "admin-transactions:error",

            VIEW_CHANGED:
                "admin-transactions:view-changed",

            TRANSACTION_SELECTED:
                "admin-transactions:transaction-selected",

            AUDIT_SELECTED:
                "admin-transactions:audit-selected"
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

        loadingTransactions:
            false,

        loadingAuditLogs:
            false,

        activeView:
            DEFAULT_VIEW,

        transactions:
            [],

        visibleTransactions:
            [],

        auditLogs:
            [],

        visibleAuditLogs:
            [],

        selectedTransaction:
            null,

        selectedAuditLog:
            null,

        searchQuery:
            "",

        typeFilter:
            "",

        directionFilter:
            "",

        auditActionFilter:
            "",

        transactionLimit:
            DEFAULT_LIMIT,

        auditLimit:
            DEFAULT_LIMIT,

        transactionTotal:
            0,

        auditTotal:
            0,

        transactionNextCursor:
            "",

        auditNextCursor:
            "",

        transactionUserId:
            "",

        auditAdminUid:
            "",

        transactionHasMore:
            false,

        auditHasMore:
            false,

        summary: {
            totalTransactions:
                0,

            totalCredits:
                0,

            totalDebits:
                0,

            creditAmount:
                0,

            debitAmount:
                0,

            netAmount:
                0
        },

        lastUpdatedAt:
            null,

        error:
            null
    };

    const elements = {
        root:
            null,

        transactionView:
            null,

        auditView:
            null,

        viewButtons:
            [],

        transactionBody:
            null,

        auditBody:
            null,

        transactionLoading:
            null,

        auditLoading:
            null,

        transactionEmpty:
            null,

        auditEmpty:
            null,

        errorState:
            null,

        errorMessage:
            null,

        searchInput:
            null,

        typeFilter:
            null,

        directionFilter:
            null,

        auditActionFilter:
            null,

        transactionTotal:
            [],

        auditTotal:
            [],

        creditAmount:
            [],

        debitAmount:
            [],

        netAmount:
            [],

        refreshButtons:
            [],

        transactionLoadMore:
            null,

        auditLoadMore:
            null,

        transactionDetails:
            null,

        auditDetails:
            null
    };

    let transactionRequestSequence =
        0;

    let auditRequestSequence =
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

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    function toInteger(
        value,
        fallback = 0
    ) {
        return Math.trunc(
            toSafeNumber(
                value,
                fallback
            )
        );
    }

    function toNonNegativeInteger(
        value,
        fallback = 0
    ) {
        return Math.max(
            0,
            toInteger(
                value,
                fallback
            )
        );
    }

    function toSafeLimit(value) {
        return Math.min(
            MAXIMUM_LIMIT,

            Math.max(
                1,
                toInteger(
                    value,
                    DEFAULT_LIMIT
                )
            )
        );
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
                // JSON fallback below.
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

    function mergeUniqueRecords(
        existingRecords,
        incomingRecords,
        keyName
    ) {
        const recordsById =
            new Map();

        [
            ...(Array.isArray(
                existingRecords
            )
                ? existingRecords
                : []),

            ...(Array.isArray(
                incomingRecords
            )
                ? incomingRecords
                : [])
        ].forEach(
            (record) => {
                const recordId =
                    toSafeString(
                        record?.[keyName] ||
                        record?.id
                    );

                if (recordId) {
                    recordsById.set(
                        recordId,
                        record
                    );
                }
            }
        );

        return Array.from(
            recordsById.values()
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
            return result.data[key];
        }

        return fallback;
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

    function serializeTimestamp(value) {
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

            const date =
                new Date(value);

            return Number.isNaN(
                date.getTime()
            )
                ? null
                : date.toISOString();
        } catch {
            return null;
        }
    }

    function normalizeError(error) {
        const rawCode =
            toSafeString(
                error?.code
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
                toSafeString(
                    error?.message
                ) ||
                "Transaction information could not be loaded.",

            details:
                error?.details ||
                error?.data ||
                null
        });
    }

    function formatMoney(value) {
        const amount =
            Math.abs(
                toInteger(value)
            );

        return `৳${new Intl.NumberFormat(
            "en-BD",
            {
                maximumFractionDigits:
                    0
            }
        ).format(amount)}`;
    }

    function formatSignedMoney(
        amount,
        direction
    ) {
        const normalizedDirection =
            normalizeDirection(
                direction
            );

        if (
            normalizedDirection ===
            DIRECTIONS.DEBIT
        ) {
            return `-${formatMoney(
                amount
            )}`;
        }

        if (
            normalizedDirection ===
            DIRECTIONS.CREDIT
        ) {
            return `+${formatMoney(
                amount
            )}`;
        }

        return formatMoney(amount);
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
                        true
                }
            ).format(
                new Date(timestamp)
            );
        } catch {
            return "—";
        }
    }

    function getAdminAPI() {
        if (!window.AdminAPI) {
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
        type = "error"
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

        const aliases = {
            referral:
                TRANSACTION_TYPES
                    .REFERRAL_REWARD,

            referral_credit:
                TRANSACTION_TYPES
                    .REFERRAL_REWARD,

            withdrawal_hold:
                TRANSACTION_TYPES
                    .WITHDRAW_HOLD,

            withdrawal_reserve:
                TRANSACTION_TYPES
                    .WITHDRAW_HOLD,

            withdrawal_complete:
                TRANSACTION_TYPES
                    .WITHDRAW_SUCCESS,

            withdrawal_success:
                TRANSACTION_TYPES
                    .WITHDRAW_SUCCESS,

            withdrawal_completed:
                TRANSACTION_TYPES
                    .WITHDRAW_SUCCESS,

            withdraw_complete:
                TRANSACTION_TYPES
                    .WITHDRAW_SUCCESS,

            withdrawal_approved:
                TRANSACTION_TYPES
                    .WITHDRAW_SUCCESS,

            withdrawal_refund:
                TRANSACTION_TYPES
                    .WITHDRAW_REFUND,

            admin_credit:
                TRANSACTION_TYPES
                    .ADMIN_ADJUSTMENT,

            admin_debit:
                TRANSACTION_TYPES
                    .ADMIN_ADJUSTMENT,

            wallet_adjustment:
                TRANSACTION_TYPES
                    .ADMIN_ADJUSTMENT
        };

        return aliases[type] ||
            type;
    }

    function getTransactionTypeLabel(value) {
        switch (
            normalizeTransactionType(
                value
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

                return "Admin Adjustment";

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
            DIRECTIONS.CREDIT
        ) {
            return DIRECTIONS.CREDIT;
        }

        if (
            direction ===
            DIRECTIONS.DEBIT
        ) {
            return DIRECTIONS.DEBIT;
        }

        return "";
    }

    function inferDirection(type) {
        switch (
            normalizeTransactionType(
                type
            )
        ) {
            case TRANSACTION_TYPES
                .REFERRAL_REWARD:

            case TRANSACTION_TYPES
                .WITHDRAW_REFUND:

                return DIRECTIONS.CREDIT;

            case TRANSACTION_TYPES
                .WITHDRAW_HOLD:

            case TRANSACTION_TYPES
                .WITHDRAW_SUCCESS:

                return DIRECTIONS.DEBIT;

            default:
                return "";
        }
    }

    function getDirectionLabel(value) {
        const direction =
            normalizeDirection(
                value
            );

        if (
            direction ===
            DIRECTIONS.CREDIT
        ) {
            return "Credit";
        }

        if (
            direction ===
            DIRECTIONS.DEBIT
        ) {
            return "Debit";
        }

        return "—";
    }

    /* =====================================================
       PROFILE NORMALIZATION
    ===================================================== */

    function normalizePhotoURL(value) {
        const photoURL =
            toSafeString(value);

        if (!photoURL) {
            return "";
        }

        try {
            const resolvedURL =
                new URL(
                    photoURL,
                    window.location.href
                );

            return [
                "https:",
                "http:"
            ].includes(
                resolvedURL.protocol
            )
                ? resolvedURL.href
                : "";
        } catch {
            return "";
        }
    }

    function normalizeProfile(
        profile,
        fallbackUid = ""
    ) {
        const source =
            isPlainObject(profile)
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
                )
        });
    }

    /* =====================================================
       BALANCE SNAPSHOT HELPERS
    ===================================================== */

    function readBalanceValue(
        source,
        directKey,
        nestedKey,
        fallback = 0
    ) {
        const beforeAfter =
            isPlainObject(source)
                ? source
                : {};

        return toNonNegativeInteger(
            beforeAfter[directKey] ??
            beforeAfter[nestedKey] ??
            fallback
        );
    }

    /* =====================================================
       TRANSACTION NORMALIZATION
    ===================================================== */

    function normalizeTransaction(
        transaction,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(transaction)
                ? transaction
                : {};

        const before =
            isPlainObject(source.before)
                ? source.before
                : {};

        const after =
            isPlainObject(source.after)
                ? source.after
                : {};

        const walletBefore =
            isPlainObject(
                source.walletBefore
            )
                ? source.walletBefore
                : before;

        const walletAfter =
            isPlainObject(
                source.walletAfter
            )
                ? source.walletAfter
                : after;

        const transactionId =
            toSafeString(
                source.transactionId ||
                source.id ||
                source.ledgerId ||
                fallbackId
            );

        const userId =
            toSafeString(
                source.userId ||
                source.uid
            );

        const type =
            normalizeTransactionType(
                source.type ||
                source.transactionType
            );

        const direction =
            normalizeDirection(
                source.direction
            ) ||
            inferDirection(type);

        const amount =
            toNonNegativeInteger(
                source.amount
            );

        const referenceId =
            toSafeString(
                source.referenceId ||
                source.referralId ||
                source.withdrawalId ||
                source.targetId
            );

        return Object.freeze({
            id:
                transactionId,

            transactionId,

            userId,

            uid:
                userId,

            userProfile:
                normalizeProfile(
                    source.userProfile ||
                    source.profile ||
                    source.user,
                    userId
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

            amountText:
                formatSignedMoney(
                    amount,
                    direction
                ),

            referenceId,

            operationId:
                toSafeString(
                    source.operationId ||
                    source.requestId
                ),

            status:
                toSafeString(
                    source.status ||
                    "completed"
                ).toLowerCase(),

            note:
                toSafeString(
                    source.adminNote ||
                    source.note ||
                    source.reason
                ),

            availableBalanceBefore:
                readBalanceValue(
                    source,
                    "availableBalanceBefore",
                    "availableBefore",
                    walletBefore
                        .availableBalance ??
                    walletBefore.available
                ),

            availableBalanceAfter:
                readBalanceValue(
                    source,
                    "availableBalanceAfter",
                    "availableAfter",
                    walletAfter
                        .availableBalance ??
                    walletAfter.available
                ),

            heldBalanceBefore:
                readBalanceValue(
                    source,
                    "heldBalanceBefore",
                    "heldBefore",
                    walletBefore
                        .heldBalance ??
                    walletBefore.held
                ),

            heldBalanceAfter:
                readBalanceValue(
                    source,
                    "heldBalanceAfter",
                    "heldAfter",
                    walletAfter
                        .heldBalance ??
                    walletAfter.held
                ),

            totalEarnedBefore:
                readBalanceValue(
                    source,
                    "totalEarnedBefore",
                    "earnedBefore",
                    walletBefore.totalEarned
                ),

            totalEarnedAfter:
                readBalanceValue(
                    source,
                    "totalEarnedAfter",
                    "earnedAfter",
                    walletAfter.totalEarned
                ),

            totalWithdrawnBefore:
                readBalanceValue(
                    source,
                    "totalWithdrawnBefore",
                    "withdrawnBefore",
                    walletBefore
                        .totalWithdrawn
                ),

            totalWithdrawnAfter:
                readBalanceValue(
                    source,
                    "totalWithdrawnAfter",
                    "withdrawnAfter",
                    walletAfter
                        .totalWithdrawn
                ),

            adminUid:
                toSafeString(
                    source.adminUid
                ),

            adminEmail:
                toSafeString(
                    source.adminEmail
                ).toLowerCase(),

            metadata:
                isPlainObject(
                    source.metadata
                )
                    ? cloneValue(
                        source.metadata
                    )
                    : {},

            createdAt:
                serializeTimestamp(
                    source.createdAt
                ),

            raw:
                cloneValue(source)
        });
    }

    function normalizeTransactions(
        transactions
    ) {
        if (
            !Array.isArray(
                transactions
            )
        ) {
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
            .filter(
                (transaction) =>
                    Boolean(
                        transaction
                            .transactionId
                    )
            )
            .sort(
                (
                    firstTransaction,
                    secondTransaction
                ) => {
                    const firstTime =
                        firstTransaction
                            .createdAt
                            ? new Date(
                                firstTransaction
                                    .createdAt
                            ).getTime()
                            : 0;

                    const secondTime =
                        secondTransaction
                            .createdAt
                            ? new Date(
                                secondTransaction
                                    .createdAt
                            ).getTime()
                            : 0;

                    return secondTime -
                        firstTime;
                }
            );
    }

    /* =====================================================
       AUDIT LOG NORMALIZATION
    ===================================================== */

    function normalizeAuditAction(value) {
        return toSafeString(value)
            .toLowerCase()
            .replace(
                /[\s-]+/g,
                "_"
            );
    }

    function getAuditActionLabel(value) {
        const action =
            normalizeAuditAction(
                value
            );

        if (!action) {
            return "Admin Action";
        }

        return action
            .split("_")
            .filter(Boolean)
            .map(
                (part) =>
                    part.charAt(0)
                        .toUpperCase() +
                    part.slice(1)
            )
            .join(" ");
    }

    function inferAuditEntityType(
        action
    ) {
        const normalizedAction =
            normalizeAuditAction(
                action
            );

        if (
            normalizedAction.startsWith(
                "referral_"
            )
        ) {
            return "referral";
        }

        if (
            normalizedAction.startsWith(
                "withdrawal_"
            )
        ) {
            return "withdrawal";
        }

        if (
            normalizedAction ===
            "wallet_adjusted"
        ) {
            return "wallet";
        }

        if (
            normalizedAction ===
            "profile_status_changed"
        ) {
            return "profile";
        }

        return "";
    }

    function buildAuditState(
        source,
        phase
    ) {
        const stateValue = {};

        const statusKey =
            phase === "before"
                ? "previousStatus"
                : "newStatus";

        const availableKey =
            phase === "before"
                ? "availableBalanceBefore"
                : "availableBalanceAfter";

        const heldKey =
            phase === "before"
                ? "heldBalanceBefore"
                : "heldBalanceAfter";

        const status =
            toSafeString(
                source[statusKey]
            );

        if (status) {
            stateValue.status =
                status;
        }

        if (
            source[availableKey] !==
                undefined &&
            source[availableKey] !==
                null
        ) {
            stateValue.availableBalance =
                toNonNegativeInteger(
                    source[availableKey]
                );
        }

        if (
            source[heldKey] !==
                undefined &&
            source[heldKey] !==
                null
        ) {
            stateValue.heldBalance =
                toNonNegativeInteger(
                    source[heldKey]
                );
        }

        return Object.keys(
            stateValue
        ).length > 0
            ? stateValue
            : null;
    }

    function normalizeAuditLog(
        auditLog,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(auditLog)
                ? auditLog
                : {};

        const auditId =
            toSafeString(
                source.auditId ||
                source.id ||
                fallbackId
            );

        const action =
            normalizeAuditAction(
                source.action
            );

        return Object.freeze({
            id:
                auditId,

            auditId,

            action,

            actionLabel:
                getAuditActionLabel(
                    action
                ),

            entityType:
                toSafeString(
                    source.entityType ||
                    source.targetType ||
                    source.resourceType ||
                    inferAuditEntityType(
                        action
                    )
                ),

            entityId:
                toSafeString(
                    source.entityId ||
                    source.targetId ||
                    source.resourceId ||
                    source.referralId ||
                    source.withdrawalId ||
                    source.transactionId ||
                    source.targetUid
                ),

            userId:
                toSafeString(
                    source.userId ||
                    source.uid ||
                    source.targetUid ||
                    source.referredUid ||
                    source.referrerUid
                ),

            adminUid:
                toSafeString(
                    source.adminUid
                ),

            adminEmail:
                toSafeString(
                    source.adminEmail
                ).toLowerCase(),

            adminNote:
                toSafeString(
                    source.adminNote ||
                    source.note ||
                    source.reason
                ),

            before:
                isPlainObject(
                    source.before
                )
                    ? cloneValue(
                        source.before
                    )
                    : buildAuditState(
                        source,
                        "before"
                    ),

            after:
                isPlainObject(
                    source.after
                )
                    ? cloneValue(
                        source.after
                    )
                    : buildAuditState(
                        source,
                        "after"
                    ),

            metadata:
                isPlainObject(
                    source.metadata
                )
                    ? cloneValue(
                        source.metadata
                    )
                    : {},

            createdAt:
                serializeTimestamp(
                    source.createdAt
                ),

            raw:
                cloneValue(source)
        });
    }

    function normalizeAuditLogs(
        auditLogs
    ) {
        if (
            !Array.isArray(
                auditLogs
            )
        ) {
            return [];
        }

        return auditLogs
            .map(
                (auditLog) =>
                    normalizeAuditLog(
                        auditLog,
                        auditLog?.id
                    )
            )
            .filter(
                (auditLog) =>
                    Boolean(
                        auditLog.auditId
                    )
            )
            .sort(
                (
                    firstAudit,
                    secondAudit
                ) => {
                    const firstTime =
                        firstAudit.createdAt
                            ? new Date(
                                firstAudit
                                    .createdAt
                            ).getTime()
                            : 0;

                    const secondTime =
                        secondAudit.createdAt
                            ? new Date(
                                secondAudit
                                    .createdAt
                            ).getTime()
                            : 0;

                    return secondTime -
                        firstTime;
                }
            );
    }

    /* =====================================================
       SUMMARY
    ===================================================== */

    function calculateSummary(
        transactions
    ) {
        const summary = {
            totalTransactions:
                transactions.length,

            totalCredits:
                0,

            totalDebits:
                0,

            creditAmount:
                0,

            debitAmount:
                0,

            netAmount:
                0
        };

        transactions.forEach(
            (transaction) => {
                if (
                    transaction.direction ===
                    DIRECTIONS.CREDIT
                ) {
                    summary.totalCredits +=
                        1;

                    summary.creditAmount +=
                        transaction.amount;
                }

                if (
                    transaction.direction ===
                    DIRECTIONS.DEBIT
                ) {
                    summary.totalDebits +=
                        1;

                    summary.debitAmount +=
                        transaction.amount;
                }
            }
        );

        summary.netAmount =
            summary.creditAmount -
            summary.debitAmount;

        return summary;
    }

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

    function updateLoadingState() {
        state.loading =
            state.loadingTransactions ||
            state.loadingAuditLogs;
    }

    function getState() {
        return cloneValue(state);
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
                    listener(snapshot);
                } catch (error) {
                    console.error(
                        "[AdminTransactions] Subscriber failed.",
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
            normalizeError(error);

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
                "[data-admin-transactions]"
            );

        elements.transactionView =
            document.querySelector(
                "[data-admin-transactions-view='transactions']"
            );

        elements.auditView =
            document.querySelector(
                "[data-admin-transactions-view='audit-logs']"
            );

        elements.viewButtons =
            queryAll(
                "[data-admin-transactions-tab]"
            );

        elements.transactionBody =
            document.querySelector(
                "[data-admin-transactions-body]"
            );

        elements.auditBody =
            document.querySelector(
                "[data-admin-audit-body]"
            );

        elements.transactionLoading =
            document.querySelector(
                "[data-admin-transactions-loading]"
            );

        elements.auditLoading =
            document.querySelector(
                "[data-admin-audit-loading]"
            );

        elements.transactionEmpty =
            document.querySelector(
                "[data-admin-transactions-empty]"
            );

        elements.auditEmpty =
            document.querySelector(
                "[data-admin-audit-empty]"
            );

        elements.errorState =
            document.querySelector(
                "[data-admin-transactions-error]"
            );

        elements.errorMessage =
            document.querySelector(
                "[data-admin-transactions-error-message]"
            );

        elements.searchInput =
            document.querySelector(
                "[data-admin-transactions-search]"
            );

        elements.typeFilter =
            document.querySelector(
                "[data-admin-transactions-type]"
            );

        elements.directionFilter =
            document.querySelector(
                "[data-admin-transactions-direction]"
            );

        elements.auditActionFilter =
            document.querySelector(
                "[data-admin-audit-action]"
            );

        elements.transactionTotal =
            queryAll(
                "[data-admin-transactions-total]"
            );

        elements.auditTotal =
            queryAll(
                "[data-admin-audit-total]"
            );

        elements.creditAmount =
            queryAll(
                "[data-admin-transactions-credit-amount]"
            );

        elements.debitAmount =
            queryAll(
                "[data-admin-transactions-debit-amount]"
            );

        elements.netAmount =
            queryAll(
                "[data-admin-transactions-net-amount]"
            );

        elements.refreshButtons =
            queryAll(
                "[data-admin-transactions-refresh]"
            );

        elements.transactionLoadMore =
            document.querySelector(
                "[data-admin-transactions-load-more]"
            );

        elements.auditLoadMore =
            document.querySelector(
                "[data-admin-audit-load-more]"
            );

        elements.transactionDetails =
            document.querySelector(
                "[data-admin-transaction-details]"
            );

        elements.auditDetails =
            document.querySelector(
                "[data-admin-audit-details]"
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
        queryAll(selector)
            .forEach(
                (element) => {
                    element.textContent =
                        toSafeString(
                            value
                        ) ||
                        "—";
                }
            );
    }

    /* =====================================================
       PROFILE IDENTITY
    ===================================================== */

    function createProfileIdentity(
        profile,
        fallbackUid
    ) {
        const displayName =
            profile.displayName ||
            profile.email ||
            fallbackUid ||
            "User";

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
                            fallbackUid ||
                            "—"
                        )}
                    </small>
                </span>
            </span>
        `;
    }

    /* =====================================================
       TRANSACTION TABLE
    ===================================================== */

    function createTransactionRow(
        transaction
    ) {
        const directionClass =
            transaction.direction ===
                DIRECTIONS.CREDIT
                ? "is-success is-credit"
                : transaction.direction ===
                    DIRECTIONS.DEBIT
                    ? "is-danger is-debit"
                    : "";

        return `
            <tr
                data-admin-transaction-row="${escapeHTML(
                    transaction.transactionId
                )}"
            >
                <td>
                    ${createProfileIdentity(
                        transaction.userProfile,
                        transaction.userId
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        transaction.typeLabel
                    )}
                </td>

                <td>
                    <span class="admin-status-badge ${directionClass}">
                        ${escapeHTML(
                            transaction.directionLabel
                        )}
                    </span>
                </td>

                <td>
                    <strong class="${directionClass}">
                        ${escapeHTML(
                            transaction.amountText
                        )}
                    </strong>
                </td>

                <td>
                    ${escapeHTML(
                        transaction.referenceId ||
                        transaction.operationId ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        formatDate(
                            transaction.createdAt
                        )
                    )}
                </td>

                <td>
                    <button
                        type="button"
                        data-admin-transaction-open="${escapeHTML(
                            transaction.transactionId
                        )}"
                    >
                        View
                    </button>
                </td>
            </tr>
        `;
    }

    function renderTransactions() {
        if (
            elements.transactionBody
        ) {
            elements.transactionBody
                .innerHTML =
                state.visibleTransactions
                    .map(
                        createTransactionRow
                    )
                    .join("");
        }

        setVisible(
            elements.transactionLoading,
            state.loadingTransactions
        );

        setVisible(
            elements.transactionEmpty,
            !state.loadingTransactions &&
            state.visibleTransactions
                .length === 0
        );

        elements.transactionTotal
            .forEach(
                (element) => {
                    element.textContent =
                        String(
                            state.transactionTotal
                        );
                }
            );

        elements.creditAmount
            .forEach(
                (element) => {
                    element.textContent =
                        formatMoney(
                            state.summary
                                .creditAmount
                        );
                }
            );

        elements.debitAmount
            .forEach(
                (element) => {
                    element.textContent =
                        formatMoney(
                            state.summary
                                .debitAmount
                        );
                }
            );

        elements.netAmount
            .forEach(
                (element) => {
                    const net =
                        state.summary
                            .netAmount;

                    element.textContent =
                        net < 0
                            ? `-${formatMoney(
                                net
                            )}`
                            : formatMoney(net);
                }
            );

        if (
            elements.transactionLoadMore
        ) {
            setVisible(
                elements.transactionLoadMore,
                state.transactionHasMore
            );

            setDisabled(
                elements.transactionLoadMore,
                state.loadingTransactions
            );
        }
    }

    /* =====================================================
       AUDIT TABLE
    ===================================================== */

    function createAuditRow(auditLog) {
        return `
            <tr
                data-admin-audit-row="${escapeHTML(
                    auditLog.auditId
                )}"
            >
                <td>
                    ${escapeHTML(
                        auditLog.actionLabel
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        auditLog.entityType ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        auditLog.entityId ||
                        auditLog.userId ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        auditLog.adminEmail ||
                        auditLog.adminUid ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        auditLog.adminNote ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        formatDate(
                            auditLog.createdAt
                        )
                    )}
                </td>

                <td>
                    <button
                        type="button"
                        data-admin-audit-open="${escapeHTML(
                            auditLog.auditId
                        )}"
                    >
                        View
                    </button>
                </td>
            </tr>
        `;
    }

    function renderAuditLogs() {
        if (
            elements.auditBody
        ) {
            elements.auditBody
                .innerHTML =
                state.visibleAuditLogs
                    .map(
                        createAuditRow
                    )
                    .join("");
        }

        setVisible(
            elements.auditLoading,
            state.loadingAuditLogs
        );

        setVisible(
            elements.auditEmpty,
            !state.loadingAuditLogs &&
            state.visibleAuditLogs
                .length === 0
        );

        elements.auditTotal
            .forEach(
                (element) => {
                    element.textContent =
                        String(
                            state.auditTotal
                        );
                }
            );

        if (
            elements.auditLoadMore
        ) {
            setVisible(
                elements.auditLoadMore,
                state.auditHasMore
            );

            setDisabled(
                elements.auditLoadMore,
                state.loadingAuditLogs
            );
        }
    }

    /* =====================================================
       VIEW RENDERING
    ===================================================== */

    function renderActiveView() {
        setVisible(
            elements.transactionView,
            state.activeView ===
                VIEWS.TRANSACTIONS
        );

        setVisible(
            elements.auditView,
            state.activeView ===
                VIEWS.AUDIT_LOGS
        );

        elements.viewButtons
            .forEach(
                (button) => {
                    const buttonView =
                        toSafeString(
                            button.dataset
                                .adminTransactionsTab
                        );

                    const active =
                        buttonView ===
                        state.activeView;

                    button.classList
                        .toggle(
                            "is-active",
                            active
                        );

                    button.setAttribute(
                        "aria-selected",
                        active
                            ? "true"
                            : "false"
                    );
                }
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
                state.error?.message ||
                "";
        }
    }

    function renderAll() {
        updateLoadingState();
        renderActiveView();
        renderTransactions();
        renderAuditLogs();
        renderError();

        elements.refreshButtons
            .forEach(
                (button) => {
                    setDisabled(
                        button,
                        state.loading
                    );
                }
            );

        elements.root?.setAttribute(
            "aria-busy",
            state.loading
                ? "true"
                : "false"
        );
    }

    /* =====================================================
       FILTERING
    ===================================================== */

    function applyTransactionFilters() {
        const query =
            state.searchQuery
                .toLowerCase();

        state.visibleTransactions =
            state.transactions.filter(
                (transaction) => {
                    if (
                        state.typeFilter &&
                        transaction.type !==
                            state.typeFilter
                    ) {
                        return false;
                    }

                    if (
                        state.directionFilter &&
                        transaction.direction !==
                            state.directionFilter
                    ) {
                        return false;
                    }

                    if (!query) {
                        return true;
                    }

                    return [
                        transaction.transactionId,
                        transaction.userId,
                        transaction.userProfile
                            .displayName,
                        transaction.userProfile
                            .email,
                        transaction.type,
                        transaction.typeLabel,
                        transaction.direction,
                        transaction.amount,
                        transaction.referenceId,
                        transaction.operationId,
                        transaction.status,
                        transaction.note,
                        transaction.adminEmail
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(query);
                }
            );

        state.summary =
            calculateSummary(
                state.visibleTransactions
            );
    }

    function applyAuditFilters() {
        const query =
            state.searchQuery
                .toLowerCase();

        state.visibleAuditLogs =
            state.auditLogs.filter(
                (auditLog) => {
                    if (
                        state.auditActionFilter &&
                        auditLog.action !==
                            state
                                .auditActionFilter
                    ) {
                        return false;
                    }

                    if (!query) {
                        return true;
                    }

                    return [
                        auditLog.auditId,
                        auditLog.action,
                        auditLog.actionLabel,
                        auditLog.entityType,
                        auditLog.entityId,
                        auditLog.userId,
                        auditLog.adminUid,
                        auditLog.adminEmail,
                        auditLog.adminNote
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(query);
                }
            );
    }

    function applyFilters() {
        applyTransactionFilters();
        applyAuditFilters();
        renderAll();

        return getState();
    }

    function setSearchQuery(value) {
        state.searchQuery =
            toSafeString(value);

        applyFilters();
        notify();

        return getState();
    }

    async function setTypeFilter(value) {
        state.typeFilter =
            normalizeTransactionType(
                value
            );

        applyTransactionFilters();
        renderTransactions();
        notify();

        return refreshTransactions({
            limit:
                state.transactionLimit,

            userId:
                state.transactionUserId
        });
    }

    function setDirectionFilter(value) {
        state.directionFilter =
            normalizeDirection(value);

        applyTransactionFilters();
        renderTransactions();
        notify();

        return getState();
    }

    async function setAuditActionFilter(value) {
        state.auditActionFilter =
            normalizeAuditAction(
                value
            );

        applyAuditFilters();
        renderAuditLogs();
        notify();

        return refreshAuditLogs({
            limit:
                state.auditLimit,

            adminUid:
                state.auditAdminUid
        });
    }

    /* =====================================================
       RESPONSE EXTRACTION
    ===================================================== */

    function extractTransactionArray(result) {
        if (
            Array.isArray(result)
        ) {
            return result;
        }

        if (
            Array.isArray(
                result?.transactions
            )
        ) {
            return result.transactions;
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
                    ?.transactions
            )
        ) {
            return result
                .data
                .transactions;
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

    function extractAuditArray(result) {
        if (
            Array.isArray(result)
        ) {
            return result;
        }

        if (
            Array.isArray(
                result?.auditLogs
            )
        ) {
            return result.auditLogs;
        }

        if (
            Array.isArray(
                result?.logs
            )
        ) {
            return result.logs;
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
                    ?.auditLogs
            )
        ) {
            return result
                .data
                .auditLogs;
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
       LOAD TRANSACTIONS
    ===================================================== */

    async function refreshTransactions(
        options = {}
    ) {
        await requireAdminAccess();

        const append =
            options.append === true;

        if (
            append &&
            (
                state.loadingTransactions ||
                !state.transactionHasMore ||
                !state.transactionNextCursor
            )
        ) {
            return getState();
        }

        const currentRequest =
            ++transactionRequestSequence;

        const limit =
            toSafeLimit(
                options.limit ||
                state.transactionLimit
            );

        const userId =
            append
                ? state.transactionUserId
                : toSafeString(
                    options.userId ||
                    options.uid
                );

        const cursor =
            append
                ? state.transactionNextCursor
                : "";

        state.loadingTransactions =
            true;

        state.transactionLimit =
            limit;

        if (!append) {
            state.transactionUserId =
                userId;

            state.transactionNextCursor =
                "";

            state.transactionHasMore =
                false;
        }

        clearError();
        renderAll();

        notify(
            EVENTS.LOADING
        );

        try {
            const payload = {
                limit
            };

            if (state.typeFilter) {
                payload.type =
                    state.typeFilter;
            }

            if (userId) {
                payload.userId =
                    userId;
            }

            if (cursor) {
                payload.cursor =
                    cursor;
            }

            const result =
                await getAdminAPI()
                    .getAdminTransactions(
                        payload
                    );

            if (
                currentRequest !==
                transactionRequestSequence
            ) {
                return getState();
            }

            const pageTransactions =
                normalizeTransactions(
                    extractTransactionArray(
                        result
                    )
                );

            state.transactions =
                append
                    ? normalizeTransactions(
                        mergeUniqueRecords(
                            state.transactions,
                            pageTransactions,
                            "transactionId"
                        )
                    )
                    : pageTransactions;

            state.transactionTotal =
                toNonNegativeInteger(
                    extractResultValue(
                        result,
                        "total",
                        extractResultValue(
                            result,
                            "count",
                            state.transactions
                                .length
                        )
                    ),
                    state.transactions
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

            state.transactionNextCursor =
                hasMore
                    ? nextCursor
                    : "";

            state.transactionHasMore =
                hasMore &&
                Boolean(nextCursor);

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();
            applyTransactionFilters();
            renderTransactions();

            return getState();
        } catch (error) {
            if (
                currentRequest ===
                transactionRequestSequence
            ) {
                setError(error);
            }

            throw error;
        } finally {
            if (
                currentRequest ===
                transactionRequestSequence
            ) {
                state.loadingTransactions =
                    false;

                renderAll();
                notify();
            }
        }
    }

    /* =====================================================
       LOAD AUDIT LOGS
    ===================================================== */

    async function refreshAuditLogs(
        options = {}
    ) {
        await requireAdminAccess();

        const append =
            options.append === true;

        if (
            append &&
            (
                state.loadingAuditLogs ||
                !state.auditHasMore ||
                !state.auditNextCursor
            )
        ) {
            return getState();
        }

        const currentRequest =
            ++auditRequestSequence;

        const limit =
            toSafeLimit(
                options.limit ||
                state.auditLimit
            );

        const adminUid =
            append
                ? state.auditAdminUid
                : toSafeString(
                    options.adminUid
                );

        const cursor =
            append
                ? state.auditNextCursor
                : "";

        state.loadingAuditLogs =
            true;

        state.auditLimit =
            limit;

        if (!append) {
            state.auditAdminUid =
                adminUid;

            state.auditNextCursor =
                "";

            state.auditHasMore =
                false;
        }

        clearError();
        renderAll();

        notify(
            EVENTS.LOADING
        );

        try {
            const payload = {
                limit
            };

            if (
                state.auditActionFilter
            ) {
                payload.action =
                    state.auditActionFilter;
            }

            if (adminUid) {
                payload.adminUid =
                    adminUid;
            }

            if (cursor) {
                payload.cursor =
                    cursor;
            }

            const result =
                await getAdminAPI()
                    .getAdminAuditLogs(
                        payload
                    );

            if (
                currentRequest !==
                auditRequestSequence
            ) {
                return getState();
            }

            const pageAuditLogs =
                normalizeAuditLogs(
                    extractAuditArray(
                        result
                    )
                );

            state.auditLogs =
                append
                    ? normalizeAuditLogs(
                        mergeUniqueRecords(
                            state.auditLogs,
                            pageAuditLogs,
                            "auditId"
                        )
                    )
                    : pageAuditLogs;

            state.auditTotal =
                toNonNegativeInteger(
                    extractResultValue(
                        result,
                        "total",
                        extractResultValue(
                            result,
                            "count",
                            state.auditLogs
                                .length
                        )
                    ),
                    state.auditLogs
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

            state.auditNextCursor =
                hasMore
                    ? nextCursor
                    : "";

            state.auditHasMore =
                hasMore &&
                Boolean(nextCursor);

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();
            applyAuditFilters();
            renderAuditLogs();

            return getState();
        } catch (error) {
            if (
                currentRequest ===
                auditRequestSequence
            ) {
                setError(error);
            }

            throw error;
        } finally {
            if (
                currentRequest ===
                auditRequestSequence
            ) {
                state.loadingAuditLogs =
                    false;

                renderAll();
                notify();
            }
        }
    }

    /* =====================================================
       LOAD BOTH DATA SETS
    ===================================================== */

    async function refresh(
        options = {}
    ) {
        const results =
            await Promise.allSettled([
                refreshTransactions({
                    limit:
                        options.transactionLimit ||
                        state.transactionLimit,

                    userId:
                        options.userId ||
                        options.uid
                }),

                refreshAuditLogs({
                    limit:
                        options.auditLimit ||
                        state.auditLimit,

                    adminUid:
                        options.adminUid
                })
            ]);

        const rejection =
            results.find(
                (result) =>
                    result.status ===
                    "rejected"
            );

        if (rejection) {
            throw rejection.reason;
        }

        return getState();
    }

    async function loadMoreTransactions() {
        if (
            state.loadingTransactions ||
            !state.transactionHasMore ||
            !state.transactionNextCursor
        ) {
            return getState();
        }

        return refreshTransactions({
            append:
                true,

            limit:
                state.transactionLimit
        });
    }

    async function loadMoreAuditLogs() {
        if (
            state.loadingAuditLogs ||
            !state.auditHasMore ||
            !state.auditNextCursor
        ) {
            return getState();
        }

        return refreshAuditLogs({
            append:
                true,

            limit:
                state.auditLimit
        });
    }

    /* =====================================================
       ACTIVE VIEW
    ===================================================== */

    function setActiveView(view) {
        const normalizedView =
            toSafeString(view);

        state.activeView =
            Object.values(
                VIEWS
            ).includes(
                normalizedView
            )
                ? normalizedView
                : DEFAULT_VIEW;

        renderActiveView();

        notify(
            EVENTS.VIEW_CHANGED
        );

        return getState();
    }

    /* =====================================================
       TRANSACTION DETAILS
    ===================================================== */

    function openTransactionDetails(
        transactionId
    ) {
        const id =
            toSafeString(
                transactionId
            );

        if (!id) {
            throw new TypeError(
                "transactionId is required."
            );
        }

        const transaction =
            state.transactions.find(
                (item) =>
                    item.transactionId ===
                    id
            );

        if (!transaction) {
            throw new Error(
                "Transaction record was not found."
            );
        }

        state.selectedTransaction =
            cloneValue(transaction);

        setVisible(
            elements.transactionDetails,
            true
        );

        setText(
            "[data-admin-transaction-detail-id]",
            transaction.transactionId
        );

        setText(
            "[data-admin-transaction-detail-user]",
            transaction.userProfile
                .displayName ||
            transaction.userId
        );

        setText(
            "[data-admin-transaction-detail-user-id]",
            transaction.userId
        );

        setText(
            "[data-admin-transaction-detail-email]",
            transaction.userProfile
                .email
        );

        setText(
            "[data-admin-transaction-detail-type]",
            transaction.typeLabel
        );

        setText(
            "[data-admin-transaction-detail-direction]",
            transaction.directionLabel
        );

        setText(
            "[data-admin-transaction-detail-amount]",
            transaction.amountText
        );

        setText(
            "[data-admin-transaction-detail-status]",
            transaction.status
        );

        setText(
            "[data-admin-transaction-detail-reference]",
            transaction.referenceId
        );

        setText(
            "[data-admin-transaction-detail-operation]",
            transaction.operationId
        );

        setText(
            "[data-admin-transaction-detail-note]",
            transaction.note
        );

        setText(
            "[data-admin-transaction-detail-admin]",
            transaction.adminEmail ||
            transaction.adminUid
        );

        setText(
            "[data-admin-transaction-detail-available-before]",
            formatMoney(
                transaction
                    .availableBalanceBefore
            )
        );

        setText(
            "[data-admin-transaction-detail-available-after]",
            formatMoney(
                transaction
                    .availableBalanceAfter
            )
        );

        setText(
            "[data-admin-transaction-detail-held-before]",
            formatMoney(
                transaction
                    .heldBalanceBefore
            )
        );

        setText(
            "[data-admin-transaction-detail-held-after]",
            formatMoney(
                transaction
                    .heldBalanceAfter
            )
        );

        setText(
            "[data-admin-transaction-detail-earned-before]",
            formatMoney(
                transaction
                    .totalEarnedBefore
            )
        );

        setText(
            "[data-admin-transaction-detail-earned-after]",
            formatMoney(
                transaction
                    .totalEarnedAfter
            )
        );

        setText(
            "[data-admin-transaction-detail-withdrawn-before]",
            formatMoney(
                transaction
                    .totalWithdrawnBefore
            )
        );

        setText(
            "[data-admin-transaction-detail-withdrawn-after]",
            formatMoney(
                transaction
                    .totalWithdrawnAfter
            )
        );

        setText(
            "[data-admin-transaction-detail-metadata]",
            stringifyObject(
                transaction.metadata
            )
        );

        setText(
            "[data-admin-transaction-detail-created]",
            formatDate(
                transaction.createdAt
            )
        );

        notify(
            EVENTS.TRANSACTION_SELECTED
        );

        return cloneValue(transaction);
    }

    function closeTransactionDetails() {
        state.selectedTransaction =
            null;

        setVisible(
            elements.transactionDetails,
            false
        );

        notify();

        return getState();
    }

    /* =====================================================
       AUDIT DETAILS
    ===================================================== */

    function stringifyObject(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return "—";
        }

        try {
            return JSON.stringify(
                value,
                null,
                2
            );
        } catch {
            return toSafeString(value) ||
                "—";
        }
    }

    function openAuditDetails(auditId) {
        const id =
            toSafeString(auditId);

        if (!id) {
            throw new TypeError(
                "auditId is required."
            );
        }

        const auditLog =
            state.auditLogs.find(
                (item) =>
                    item.auditId ===
                    id
            );

        if (!auditLog) {
            throw new Error(
                "Audit log was not found."
            );
        }

        state.selectedAuditLog =
            cloneValue(auditLog);

        setVisible(
            elements.auditDetails,
            true
        );

        setText(
            "[data-admin-audit-detail-id]",
            auditLog.auditId
        );

        setText(
            "[data-admin-audit-detail-action]",
            auditLog.actionLabel
        );

        setText(
            "[data-admin-audit-detail-entity-type]",
            auditLog.entityType
        );

        setText(
            "[data-admin-audit-detail-entity-id]",
            auditLog.entityId
        );

        setText(
            "[data-admin-audit-detail-user-id]",
            auditLog.userId
        );

        setText(
            "[data-admin-audit-detail-admin]",
            auditLog.adminEmail ||
            auditLog.adminUid
        );

        setText(
            "[data-admin-audit-detail-note]",
            auditLog.adminNote
        );

        setText(
            "[data-admin-audit-detail-before]",
            stringifyObject(
                auditLog.before
            )
        );

        setText(
            "[data-admin-audit-detail-after]",
            stringifyObject(
                auditLog.after
            )
        );

        setText(
            "[data-admin-audit-detail-metadata]",
            stringifyObject(
                auditLog.metadata
            )
        );

        setText(
            "[data-admin-audit-detail-created]",
            formatDate(
                auditLog.createdAt
            )
        );

        notify(
            EVENTS.AUDIT_SELECTED
        );

        return cloneValue(auditLog);
    }

    function closeAuditDetails() {
        state.selectedAuditLog =
            null;

        setVisible(
            elements.auditDetails,
            false
        );

        notify();

        return getState();
    }

    /* =====================================================
       DOCUMENT EVENTS
    ===================================================== */

    function handleDocumentClick(event) {
        if (
            event.defaultPrevented ||
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        const tabButton =
            event.target.closest(
                "[data-admin-transactions-tab]"
            );

        if (tabButton) {
            event.preventDefault();

            setActiveView(
                tabButton.dataset
                    .adminTransactionsTab
            );

            return;
        }

        const transactionButton =
            event.target.closest(
                "[data-admin-transaction-open]"
            );

        if (transactionButton) {
            event.preventDefault();

            try {
                openTransactionDetails(
                    transactionButton
                        .dataset
                        .adminTransactionOpen
                );
            } catch (error) {
                setError(error);

                showToast(
                    normalizeError(
                        error
                    ).message
                );
            }

            return;
        }

        const auditButton =
            event.target.closest(
                "[data-admin-audit-open]"
            );

        if (auditButton) {
            event.preventDefault();

            try {
                openAuditDetails(
                    auditButton
                        .dataset
                        .adminAuditOpen
                );
            } catch (error) {
                setError(error);

                showToast(
                    normalizeError(
                        error
                    ).message
                );
            }

            return;
        }

        if (
            event.target.closest(
                "[data-admin-transaction-details-close]"
            )
        ) {
            event.preventDefault();

            closeTransactionDetails();

            return;
        }

        if (
            event.target.closest(
                "[data-admin-audit-details-close]"
            )
        ) {
            event.preventDefault();

            closeAuditDetails();

            return;
        }

        if (
            event.target.closest(
                "[data-admin-transactions-refresh]"
            )
        ) {
            event.preventDefault();

            void refresh().catch(
                (error) => {
                    showToast(
                        normalizeError(
                            error
                        ).message
                    );
                }
            );

            return;
        }

        if (
            event.target.closest(
                "[data-admin-transactions-load-more]"
            )
        ) {
            event.preventDefault();

            void loadMoreTransactions()
                .catch(
                    (error) => {
                        showToast(
                            normalizeError(
                                error
                            ).message
                        );
                    }
                );

            return;
        }

        if (
            event.target.closest(
                "[data-admin-audit-load-more]"
            )
        ) {
            event.preventDefault();

            void loadMoreAuditLogs()
                .catch(
                    (error) => {
                        showToast(
                            normalizeError(
                                error
                            ).message
                        );
                    }
                );
        }
    }

    function handleDocumentInput(event) {
        if (
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-transactions-search]"
            )
        ) {
            setSearchQuery(
                event.target.value
            );
        }
    }

    function handleDocumentChange(event) {
        if (
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-transactions-type]"
            )
        ) {
            void setTypeFilter(
                event.target.value
            ).catch(
                (error) => {
                    showToast(
                        normalizeError(
                            error
                        ).message
                    );
                }
            );

            return;
        }

        if (
            event.target.matches(
                "[data-admin-transactions-direction]"
            )
        ) {
            setDirectionFilter(
                event.target.value
            );

            return;
        }

        if (
            event.target.matches(
                "[data-admin-audit-action]"
            )
        ) {
            void setAuditActionFilter(
                event.target.value
            ).catch(
                (error) => {
                    showToast(
                        normalizeError(
                            error
                        ).message
                    );
                }
            );
        }
    }

    function bindEvents() {
        if (controller) {
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
            "change",
            handleDocumentChange,
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
            renderAll();

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

        state.typeFilter =
            normalizeTransactionType(
                elements.typeFilter
                    ?.value
            );

        state.directionFilter =
            normalizeDirection(
                elements.directionFilter
                    ?.value
            );

        state.auditActionFilter =
            normalizeAuditAction(
                elements.auditActionFilter
                    ?.value
            );

        renderAll();

        try {
            await requireAdminAccess();
            await refresh();
        } catch (error) {
            setError(error);
        }

        return getState();
    }

    /* =====================================================
       SUBSCRIPTION
    ===================================================== */

    function subscribe(listener) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new TypeError(
                "AdminTransactions subscriber must be a function."
            );
        }

        listeners.add(listener);

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
        transactionRequestSequence +=
            1;

        auditRequestSequence +=
            1;

        controller?.abort();

        controller =
            null;

        listeners.clear();

        state.initialized =
            false;

        state.loading =
            false;

        state.loadingTransactions =
            false;

        state.loadingAuditLogs =
            false;

        state.activeView =
            DEFAULT_VIEW;

        state.transactions =
            [];

        state.visibleTransactions =
            [];

        state.auditLogs =
            [];

        state.visibleAuditLogs =
            [];

        state.selectedTransaction =
            null;

        state.selectedAuditLog =
            null;

        state.searchQuery =
            "";

        state.typeFilter =
            "";

        state.directionFilter =
            "";

        state.auditActionFilter =
            "";

        state.transactionLimit =
            DEFAULT_LIMIT;

        state.auditLimit =
            DEFAULT_LIMIT;

        state.transactionTotal =
            0;

        state.auditTotal =
            0;

        state.transactionNextCursor =
            "";

        state.auditNextCursor =
            "";

        state.transactionUserId =
            "";

        state.auditAdminUid =
            "";

        state.transactionHasMore =
            false;

        state.auditHasMore =
            false;

        state.summary = {
            totalTransactions:
                0,

            totalCredits:
                0,

            totalDebits:
                0,

            creditAmount:
                0,

            debitAmount:
                0,

            netAmount:
                0
        };

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        Object.keys(elements)
            .forEach(
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

    window.AdminTransactions =
        Object.freeze({
            init,
            destroy,

            refresh,
            refreshTransactions,
            refreshAuditLogs,

            loadMoreTransactions,
            loadMoreAuditLogs,

            setActiveView,

            setSearchQuery,
            setTypeFilter,
            setDirectionFilter,
            setAuditActionFilter,

            openTransactionDetails,
            closeTransactionDetails,

            openAuditDetails,
            closeAuditDetails,

            getState,

            getTransactions() {
                return cloneValue(
                    state.transactions
                );
            },

            getVisibleTransactions() {
                return cloneValue(
                    state
                        .visibleTransactions
                );
            },

            getAuditLogs() {
                return cloneValue(
                    state.auditLogs
                );
            },

            getVisibleAuditLogs() {
                return cloneValue(
                    state.visibleAuditLogs
                );
            },

            getSummary() {
                return cloneValue(
                    state.summary
                );
            },

            normalizeTransaction,
            normalizeTransactions,

            normalizeAuditLog,
            normalizeAuditLogs,
            normalizeAuditAction,

            normalizeTransactionType,
            normalizeDirection,

            getTransactionTypeLabel,
            getDirectionLabel,
            getAuditActionLabel,

            formatMoney,
            formatSignedMoney,
            formatDate,

            subscribe,

            EVENTS,
            VIEWS,
            TRANSACTION_TYPES,
            DIRECTIONS
        });
})(
    window,
    document
);