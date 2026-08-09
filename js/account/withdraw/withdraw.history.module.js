"use strict";

/* =========================================================
   11PLAY — WITHDRAW HISTORY MODULE
   File: js/account/withdraw/withdraw.history.module.js

   Responsibilities:
   - Initialize the Withdrawal History page
   - Read server-authoritative records from WithdrawDB
   - Render canonical withdrawal statuses and masked wallet numbers
   - Display Admin notes and rejection reasons
   - Keep submitted withdrawals read-only for users
   - Load complete history through cursor pagination
   - Render guest, loading, empty and error states
   - Initialize Shared Account Sections
   - Prevent stale cross-account updates
   - Clean up page-specific listeners and subscriptions

   Final withdrawal workflow:
   - User submits a withdrawal request
   - Submitted request cannot be cancelled, edited or deleted by user
   - Admin can Approve or Reject a pending request
   - Rejected requests are refunded server-side

   Canonical statuses:
   - pending
   - approved
   - rejected
   - cancelled (historical read-only compatibility only)

   Important:
   - No withdrawal data is stored locally
   - No balance is modified on the client
   - No direct Firestore operation occurs here
   - No user cancellation write occurs here
   - Main Router owns account-page navigation
========================================================= */

const WithdrawHistoryModule = (() => {
    "use strict";

    const PAGE_ID = "withdrawHistoryPage";
    const CURRENT_PAGE = "withdraw-history";

    const WITHDRAWAL_STATUSES = Object.freeze({
        PENDING: "pending",
        APPROVED: "approved",
        REJECTED: "rejected",
        CANCELLED: "cancelled"
    });

    const AUTH_EVENTS = Object.freeze([
        "auth:state-changed",
        "profile:auth-changed",
        "auth:signed-in",
        "auth:signed-out",
        "profile:logout"
    ]);

    const WITHDRAWAL_EVENTS = Object.freeze([
        "withdrawal:updated",
        "withdrawal:submitted",
        "withdrawal:summary-updated",
        "withdrawal:admin-updated",
        "reward:withdrawal-submitted"
    ]);

    const state = {
        initialized: false,
        page: null,
        elements: {},
        currentUid: "",
        records: [],
        loading: false,
        loadingMore: false,
        hasMore: false,
        nextCursor: "",
        error: null,
        lastUpdatedAt: null,
        refreshPromise: null,
        withdrawUnsubscribe: null,
        listeners: [],
        pageObserver: null,
        sharedMount: null,
        sharedSectionsInitialized: false,
        lifecycleGeneration: 0
    };

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

    function normalizeString(
        value,
        fallback = ""
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return fallback;
        }

        const normalized =
            String(value)
                .normalize("NFKC")
                .trim();

        return normalized ||
            fallback;
    }

    function toNonNegativeInteger(
        value,
        fallback = 0
    ) {
        const number =
            Math.floor(
                Number(value)
            );

        if (
            Number.isSafeInteger(number) &&
            number >= 0
        ) {
            return number;
        }

        const fallbackNumber =
            Math.floor(
                Number(fallback)
            );

        return (
            Number.isSafeInteger(
                fallbackNumber
            ) &&
            fallbackNumber >= 0
                ? fallbackNumber
                : 0
        );
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

    function normalizeError(error) {
        const details =
            isPlainObject(
                error?.details
            )
                ? error.details
                : null;

        return {
            code:
                normalizeString(
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
                "withdraw-history-error",

            message:
                normalizeString(
                    details?.message ||
                    error?.message,
                    "Unable to load withdrawal history."
                ),

            field:
                normalizeString(
                    details?.field ||
                    error?.field
                ),

            reason:
                normalizeString(
                    details?.reason ||
                    details?.code
                ),

            details
        };
    }

    function createCancellationDisabledError() {
        const error =
            new Error(
                "Submitted withdrawal requests cannot be cancelled, edited or deleted. Please wait for Admin approval or rejection."
            );

        error.code =
            "withdrawal-cancellation-disabled";

        error.details = {
            reason:
                "user_cancellation_disabled",

            immutableAfterSubmission:
                true
        };

        return error;
    }

    function formatNumber(value) {
        return new Intl.NumberFormat(
            "en-BD",
            {
                maximumFractionDigits:
                    0
            }
        ).format(
            toNonNegativeInteger(value)
        );
    }

    function formatAmount(value) {
        return `৳${formatNumber(value)}`;
    }

    /* =====================================================
       DATE HANDLING
    ===================================================== */

    function resolveDate(value) {
        if (!value) {
            return null;
        }

        if (value instanceof Date) {
            return Number.isNaN(
                value.getTime()
            )
                ? null
                : value;
        }

        if (
            typeof value?.toDate ===
            "function"
        ) {
            try {
                const date =
                    value.toDate();

                return Number.isNaN(
                    date.getTime()
                )
                    ? null
                    : date;
            } catch {
                return null;
            }
        }

        if (
            typeof value?.toMillis ===
            "function"
        ) {
            try {
                const date =
                    new Date(
                        value.toMillis()
                    );

                return Number.isNaN(
                    date.getTime()
                )
                    ? null
                    : date;
            } catch {
                return null;
            }
        }

        if (
            isPlainObject(value) &&
            typeof value.seconds ===
            "number"
        ) {
            const date =
                new Date(
                    value.seconds *
                    1000
                );

            return Number.isNaN(
                date.getTime()
            )
                ? null
                : date;
        }

        if (
            isPlainObject(value) &&
            typeof value._seconds ===
            "number"
        ) {
            const date =
                new Date(
                    value._seconds *
                    1000
                );

            return Number.isNaN(
                date.getTime()
            )
                ? null
                : date;
        }

        const date =
            new Date(value);

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }

    function serializeDate(value) {
        return (
            resolveDate(value)
                ?.toISOString() ||
            null
        );
    }

    function getDateTimestamp(value) {
        return (
            resolveDate(value)
                ?.getTime() ||
            0
        );
    }

    function formatDate(value) {
        const date =
            resolveDate(value);

        if (!date) {
            return "—";
        }

        try {
            return new Intl.DateTimeFormat(
                "en-BD",
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
            ).format(date);
        } catch {
            return date
                .toLocaleString();
        }
    }

    /* =====================================================
       PAGE
    ===================================================== */

    function resolvePage(target) {
        if (
            target instanceof HTMLElement &&
            target.id === PAGE_ID
        ) {
            return target;
        }

        if (
            target instanceof HTMLElement
        ) {
            return target.querySelector(
                `#${PAGE_ID}`
            );
        }

        if (
            typeof target === "string" &&
            target.trim()
        ) {
            const matched =
                document.querySelector(
                    target.trim()
                );

            if (
                matched?.id ===
                PAGE_ID
            ) {
                return matched;
            }

            return (
                matched
                    ?.querySelector(
                        `#${PAGE_ID}`
                    ) ||
                null
            );
        }

        return document.getElementById(
            PAGE_ID
        );
    }

    function collectElements() {
        if (!state.page) {
            return false;
        }

        state.elements = {
            card:
                state.page.querySelector(
                    "#withdrawHistoryCard"
                ),

            refreshState:
                state.page.querySelector(
                    "#withdrawHistoryRefreshState"
                ),

            recordCount:
                state.page.querySelector(
                    "#withdrawHistoryRecordCount"
                ),

            loadingState:
                state.page.querySelector(
                    "#withdrawHistoryLoadingState"
                ),

            guestState:
                state.page.querySelector(
                    "#withdrawHistoryGuestState"
                ),

            tableField:
                state.page.querySelector(
                    "#withdrawHistoryTableField"
                ),

            tableBody:
                state.page.querySelector(
                    "#withdrawHistoryTableBody"
                ),

            loadMoreField:
                state.page.querySelector(
                    "#withdrawHistoryLoadMoreField"
                ),

            loadMoreButton:
                state.page.querySelector(
                    "#withdrawHistoryLoadMoreButton"
                ),

            emptyState:
                state.page.querySelector(
                    "#withdrawHistoryEmptyState"
                ),

            pageStatus:
                state.page.querySelector(
                    "#withdrawHistoryPageStatus"
                ),

            accountSectionsMount:
                state.page.querySelector(
                    "#accountSectionsMount"
                )
        };

        return true;
    }

    /* =====================================================
       MANAGED LISTENERS
    ===================================================== */

    function addManagedListener(
        element,
        eventName,
        handler,
        options
    ) {
        if (
            !element ||
            typeof element
                .addEventListener !==
                "function"
        ) {
            return false;
        }

        element.addEventListener(
            eventName,
            handler,
            options
        );

        state.listeners.push({
            element,
            eventName,
            handler,
            options
        });

        return true;
    }

    function removeManagedListeners() {
        state.listeners.forEach(
            ({
                element,
                eventName,
                handler,
                options
            }) => {
                try {
                    element.removeEventListener(
                        eventName,
                        handler,
                        options
                    );
                } catch {
                    /*
                     * Nothing else to clean up.
                     */
                }
            }
        );

        state.listeners =
            [];
    }

    /* =====================================================
       AUTHENTICATION
    ===================================================== */

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

                if (user?.uid) {
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

                if (user?.uid) {
                    return user;
                }
            } catch {
                /*
                 * Continue.
                 */
            }
        }

        return (
            window.FirebaseConfig
                ?.auth
                ?.currentUser ||
            window.firebaseAuth
                ?.currentUser ||
            null
        );
    }

    function getProviderIds(user) {
        const providerIds =
            [];

        if (
            Array.isArray(
                user?.providerIds
            )
        ) {
            providerIds.push(
                ...user.providerIds
            );
        }

        if (
            Array.isArray(
                user?.providerData
            )
        ) {
            user.providerData
                .forEach(
                    provider => {
                        if (
                            provider
                                ?.providerId
                        ) {
                            providerIds.push(
                                provider
                                    .providerId
                            );
                        }
                    }
                );
        }

        return [
            ...new Set(
                providerIds
                    .map(
                        value =>
                            normalizeString(
                                value
                            )
                                .toLowerCase()
                    )
                    .filter(Boolean)
            )
        ];
    }

    function isVerifiedGoogleUser(user) {
        if (!user?.uid) {
            return false;
        }

        const providerIds =
            getProviderIds(user);

        const signInProvider =
            normalizeString(
                user.signInProvider
            )
                .toLowerCase();

        const googleSession =
            user.isGoogleSignIn ===
                true ||
            signInProvider ===
                "google.com" ||
            providerIds.includes(
                "google.com"
            );

        const verifiedEmail =
            user.emailVerified ===
                true ||
            user.isEmailVerified ===
                true;

        return (
            googleSession &&
            verifiedEmail
        );
    }

    function extractEventUser(event) {
        if (
            event?.type ===
                "auth:signed-out" ||
            event?.type ===
                "profile:logout"
        ) {
            return null;
        }

        return (
            event?.detail?.user ||
            event?.detail?.profile ||
            (
                event?.detail?.uid
                    ? event.detail
                    : null
            ) ||
            resolveCurrentUser()
        );
    }

    /* =====================================================
       WALLET PROVIDER / NUMBER
    ===================================================== */

    function normalizeWallet(value) {
        const provider =
            normalizeString(value)
                .toLowerCase()
                .replace(
                    /[\s_-]+/g,
                    ""
                );

        const providerMap = {
            bkash:
                "bKash",

            বিকাশ:
                "bKash",

            nagad:
                "Nagad",

            নগদ:
                "Nagad",

            rocket:
                "Rocket",

            রকেট:
                "Rocket"
        };

        return (
            providerMap[provider] ||
            "Unknown"
        );
    }

    function maskAccountNumber(value) {
        const source =
            normalizeString(value);

        if (!source) {
            return "*******0000";
        }

        if (
            /^[*★xX•]{3,}.{4}$/
                .test(source)
        ) {
            return source;
        }

        const digits =
            source.replace(
                /\D/g,
                ""
            );

        const maskSource =
            digits ||
            source.replace(
                /\s+/g,
                ""
            );

        const visiblePart =
            maskSource
                .slice(-4)
                .padStart(
                    4,
                    "0"
                );

        return `*******${visiblePart}`;
    }

    /* =====================================================
       STATUS
    ===================================================== */

    function normalizeStatus(value) {
        const status =
            normalizeString(
                value,
                WITHDRAWAL_STATUSES
                    .PENDING
            )
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );

        switch (status) {
            case "approved":
            case "successful":
            case "success":
            case "completed":
            case "complete":
            case "paid":
            case "received":
                return WITHDRAWAL_STATUSES
                    .APPROVED;

            case "rejected":
            case "failed":
            case "declined":
            case "invalid":
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
                return WITHDRAWAL_STATUSES
                    .PENDING;
        }
    }

    function getStatusConfiguration(
        status
    ) {
        const configurations = {
            pending: {
                label:
                    "Pending",

                indicator:
                    "🟡",

                className:
                    "is-pending is-processing"
            },

            approved: {
                label:
                    "Approved",

                indicator:
                    "🟢",

                className:
                    "is-approved is-success is-completed"
            },

            rejected: {
                label:
                    "Rejected",

                indicator:
                    "🔴",

                className:
                    "is-rejected"
            },

            cancelled: {
                label:
                    "Cancelled",

                indicator:
                    "⚪",

                className:
                    "is-cancelled"
            }
        };

        return configurations[
            normalizeStatus(status)
        ];
    }

    /* =====================================================
       RECORD NORMALIZATION
    ===================================================== */

    function resolveAdminNote(source) {
        return normalizeString(
            source.adminNote ||
            source.adminReason ||
            source.rejectionReason ||
            source.reason ||
            source.note ||
            source.review?.note ||
            source.review?.reason
        );
    }

    function resolveDetails(
        status,
        adminNote
    ) {
        if (adminNote) {
            return adminNote;
        }

        switch (status) {
            case WITHDRAWAL_STATUSES
                .APPROVED:

                return "Withdrawal approved.";

            case WITHDRAWAL_STATUSES
                .REJECTED:

                return "Withdrawal rejected. Reserved balance was refunded.";

            case WITHDRAWAL_STATUSES
                .CANCELLED:

                return "Historical cancelled withdrawal.";

            default:
                return "Awaiting Admin review.";
        }
    }

    function normalizeRecord(
        record,
        index = 0
    ) {
        const source =
            isPlainObject(record)
                ? record
                : {};

        const status =
            normalizeStatus(
                source.status ||
                source.withdrawalStatus ||
                source.withdrawStatus ||
                source.state
            );

        const createdAt =
            source.createdAt ||
            source.requestedAt ||
            source.submittedAt ||
            source.date ||
            source.timestamp ||
            null;

        const adminNote =
            resolveAdminNote(
                source
            );

        const id =
            normalizeString(
                source.id ||
                source.withdrawalId ||
                source.withdrawId ||
                source.requestId ||
                source.transactionId ||
                `${index}`
            );

        const providerSource =
            source.provider ||
            source.walletProvider ||
            source.wallet ||
            source.walletType ||
            source.method ||
            source.paymentMethod;

        const numberSource =
            source.maskedWalletNumber ||
            source.maskedNumber ||
            source.walletNumber ||
            source.number ||
            source.accountNumber ||
            source.account;

        return {
            id,

            uid:
                normalizeString(
                    source.uid ||
                    source.userId
                ),

            provider:
                normalizeString(
                    providerSource
                )
                    .toLowerCase(),

            wallet:
                normalizeWallet(
                    providerSource
                ),

            walletNumber:
                normalizeString(
                    source.walletNumber ||
                    source.number ||
                    source.accountNumber ||
                    source.account ||
                    source.mobile ||
                    source.phone
                ),

            maskedWalletNumber:
                maskAccountNumber(
                    numberSource
                ),

            amount:
                toNonNegativeInteger(
                    source.amount ??
                    source.withdrawAmount ??
                    source.transactionAmount
                ),

            status,

            adminNote,

            details:
                resolveDetails(
                    status,
                    adminNote
                ),

            createdAt:
                serializeDate(
                    createdAt
                ),

            createdAtText:
                formatDate(
                    createdAt
                ),

            updatedAt:
                serializeDate(
                    source.updatedAt
                ),

            reviewedAt:
                serializeDate(
                    source.reviewedAt
                ),

            approvedAt:
                serializeDate(
                    source.approvedAt ||
                    source.completedAt
                ),

            rejectedAt:
                serializeDate(
                    source.rejectedAt
                ),

            /*
             * Historical compatibility only.
             */

            cancelledAt:
                serializeDate(
                    source.cancelledAt ||
                    source.canceledAt
                ),

            paymentConfirmed:
                source.paymentConfirmed ===
                true,

            paymentConfirmedAt:
                serializeDate(
                    source.paymentConfirmedAt
                ),

            paymentReference:
                normalizeString(
                    source.paymentReference
                ),

            /*
             * Final policy:
             * user cannot cancel/edit/delete.
             */

            canCancel:
                false,

            cancellationDisabled:
                true
        };
    }

    function extractRecordCollection(
        payload
    ) {
        if (Array.isArray(payload)) {
            return payload;
        }

        if (!isPlainObject(payload)) {
            return [];
        }

        const candidates = [
            payload.withdrawals,
            payload.items,
            payload.history,
            payload.records,
            payload.list,
            payload.data?.withdrawals,
            payload.data?.items,
            payload.data?.history
        ];

        return (
            candidates.find(
                Array.isArray
            ) ||
            []
        );
    }

    function normalizeRecordCollection(
        payload
    ) {
        return extractRecordCollection(
            payload
        )
            .map(
                (record, index) =>
                    normalizeRecord(
                        record,
                        index
                    )
            )
            .sort(
                (
                    firstRecord,
                    secondRecord
                ) =>
                    getDateTimestamp(
                        secondRecord.createdAt
                    ) -
                    getDateTimestamp(
                        firstRecord.createdAt
                    )
            );
    }

    /* =====================================================
       WITHDRAWDB STATE
    ===================================================== */

    function readWithdrawDBState() {
        if (
            !window.WithdrawDB ||
            typeof window.WithdrawDB
                .getState !==
                "function"
        ) {
            return null;
        }

        try {
            const withdrawState =
                window.WithdrawDB
                    .getState();

            return isPlainObject(
                withdrawState
            )
                ? withdrawState
                : null;
        } catch {
            return null;
        }
    }

    function stateBelongsToUser(
        source,
        expectedUid
    ) {
        if (!expectedUid) {
            return false;
        }

        const sourceUid =
            normalizeString(
                source
                    ?.currentUser
                    ?.uid ||
                source?.uid ||
                source?.summary?.uid ||
                source
                    ?.withdrawals
                    ?.[0]
                    ?.uid ||
                source
                    ?.withdrawals
                    ?.[0]
                    ?.userId
            );

        return (
            !sourceUid ||
            sourceUid ===
                expectedUid
        );
    }

    /* =====================================================
       STATUS BADGE
    ===================================================== */

    function createStatusBadge(status) {
        const config =
            getStatusConfiguration(
                status
            );

        const badge =
            document.createElement(
                "span"
            );

        badge.className =
            `withdraw-status-badge ${config.className}`;

        badge.dataset.status =
            normalizeStatus(status);

        badge.setAttribute(
            "aria-label",
            `Status: ${config.label}`
        );

        const indicator =
            document.createElement(
                "span"
            );

        indicator.className =
            "withdraw-status-indicator";

        indicator.setAttribute(
            "aria-hidden",
            "true"
        );

        indicator.textContent =
            config.indicator;

        const label =
            document.createElement(
                "span"
            );

        label.className =
            "withdraw-status-label";

        label.textContent =
            config.label;

        badge.append(
            indicator,
            label
        );

        return badge;
    }

    /* =====================================================
       TABLE
    ===================================================== */

    function createTextCell(
        tag,
        className,
        text
    ) {
        const cell =
            document.createElement(
                "td"
            );

        const element =
            document.createElement(
                tag
            );

        element.className =
            className;

        element.textContent =
            text;

        cell.appendChild(
            element
        );

        return cell;
    }

    function createHistoryRow(record) {
        const row =
            document.createElement(
                "tr"
            );

        row.className =
            `withdraw-history-row withdraw-history-row-${record.status}`;

        row.dataset.withdrawId =
            record.id;

        const dateCell =
            createTextCell(
                "span",
                "withdraw-history-date",
                record.createdAtText ||
                "—"
            );

        const walletCell =
            createTextCell(
                "span",
                "withdraw-history-wallet withdraw-history-method",
                record.wallet
            );

        const numberCell =
            createTextCell(
                "span",
                "withdraw-history-number withdraw-history-account",
                record.maskedWalletNumber
            );

        const amountCell =
            createTextCell(
                "strong",
                "withdraw-history-amount",
                formatAmount(
                    record.amount
                )
            );

        const statusCell =
            document.createElement(
                "td"
            );

        statusCell.appendChild(
            createStatusBadge(
                record.status
            )
        );

        const detailsCell =
            createTextCell(
                "span",
                "withdraw-history-details",
                record.details
            );

        /*
         * Action column retained for markup compatibility.
         * There is deliberately no Cancel/Edit/Delete button.
         */

        const actionCell =
            document.createElement(
                "td"
            );

        actionCell.className =
            "withdraw-history-action";

        const unavailable =
            document.createElement(
                "span"
            );

        unavailable.className =
            "withdraw-history-action-unavailable";

        unavailable.textContent =
            "—";

        unavailable.setAttribute(
            "aria-label",
            "No user action available"
        );

        actionCell.appendChild(
            unavailable
        );

        row.append(
            dateCell,
            walletCell,
            numberCell,
            amountCell,
            statusCell,
            detailsCell,
            actionCell
        );

        return row;
    }

    /* =====================================================
       CONTENT STATES
    ===================================================== */

    function updateLoadMoreControl() {
        const field =
            state.elements
                .loadMoreField;

        const button =
            state.elements
                .loadMoreButton;

        const visible =
            Boolean(
                field &&
                button &&
                state.records.length >
                    0 &&
                state.hasMore &&
                state.nextCursor &&
                !state.loading &&
                isVerifiedGoogleUser(
                    resolveCurrentUser()
                )
            );

        if (field) {
            field.hidden =
                !visible;
        }

        if (button) {
            const disabled =
                !visible ||
                state.loadingMore;

            button.disabled =
                disabled;

            button.textContent =
                state.loadingMore
                    ? "Loading More..."
                    : "Load More Withdrawals";

            button.setAttribute(
                "aria-busy",
                String(
                    state.loadingMore
                )
            );

            button.setAttribute(
                "aria-disabled",
                String(disabled)
            );
        }

        return visible;
    }

    function hideContentStates() {
        [
            state.elements
                .loadingState,

            state.elements
                .guestState,

            state.elements
                .tableField,

            state.elements
                .emptyState,

            state.elements
                .loadMoreField
        ].forEach(
            element => {
                if (element) {
                    element.hidden =
                        true;
                }
            }
        );
    }

    function showLoadingState() {
        hideContentStates();

        if (
            state.elements
                .loadingState
        ) {
            state.elements
                .loadingState
                .hidden =
                false;
        }
    }

    function showGuestState() {
        hideContentStates();

        if (
            state.elements
                .guestState
        ) {
            state.elements
                .guestState
                .hidden =
                false;
        }
    }

    function showEmptyState() {
        hideContentStates();

        if (
            state.elements
                .emptyState
        ) {
            state.elements
                .emptyState
                .hidden =
                false;
        }
    }

    function showTableState() {
        hideContentStates();

        if (
            state.elements
                .tableField
        ) {
            state.elements
                .tableField
                .hidden =
                false;
        }

        updateLoadMoreControl();
    }

    function updateRecordCount() {
        const count =
            state.records.length;

        if (
            state.elements
                .recordCount
        ) {
            state.elements
                .recordCount
                .textContent =
                formatNumber(count);

            state.elements
                .recordCount
                .setAttribute(
                    "aria-label",
                    `${count} withdrawal records`
                );
        }

        return count;
    }

    function renderRows(records) {
        const tableBody =
            state.elements
                .tableBody;

        if (!tableBody) {
            return false;
        }

        tableBody.replaceChildren();

        updateRecordCount();

        if (!records.length) {
            showEmptyState();

            return true;
        }

        const fragment =
            document.createDocumentFragment();

        records.forEach(
            record => {
                fragment.appendChild(
                    createHistoryRow(
                        record
                    )
                );
            }
        );

        tableBody.appendChild(
            fragment
        );

        showTableState();

        return true;
    }

    /* =====================================================
       LOADING / STATUS
    ===================================================== */

    function setLoading(value) {
        state.loading =
            value === true;

        if (state.page) {
            state.page.classList.toggle(
                "is-loading",
                state.loading
            );

            state.page.setAttribute(
                "aria-busy",
                String(
                    state.loading
                )
            );
        }

        if (
            state.elements.card
        ) {
            state.elements.card
                .setAttribute(
                    "aria-busy",
                    String(
                        state.loading
                    )
                );
        }

        if (
            state.elements
                .refreshState
        ) {
            state.elements
                .refreshState
                .textContent =
                state.loading
                    ? "Refreshing..."
                    : "";
        }

        if (state.loading) {
            showLoadingState();
        } else {
            updateLoadMoreControl();
        }

        return true;
    }

    function clearPageStatus() {
        const status =
            state.elements
                .pageStatus;

        if (!status) {
            return false;
        }

        status.hidden =
            true;

        status.textContent =
            "";

        delete status.dataset
            .statusType;

        status.classList.remove(
            "is-success",
            "is-error",
            "is-info"
        );

        return true;
    }

    function showPageStatus(
        message,
        type = "info"
    ) {
        const status =
            state.elements
                .pageStatus;

        if (!status) {
            return false;
        }

        const normalizedMessage =
            normalizeString(
                message
            );

        const normalizedType =
            [
                "success",
                "error",
                "info"
            ].includes(type)
                ? type
                : "info";

        status.textContent =
            normalizedMessage;

        status.hidden =
            !normalizedMessage;

        status.dataset.statusType =
            normalizedType;

        status.classList.toggle(
            "is-success",
            normalizedType ===
                "success"
        );

        status.classList.toggle(
            "is-error",
            normalizedType ===
                "error"
        );

        status.classList.toggle(
            "is-info",
            normalizedType ===
                "info"
        );

        return true;
    }

    /* =====================================================
       DATA
    ===================================================== */

    function renderGuestData() {
        state.currentUid =
            "";

        state.records =
            [];

        state.loadingMore =
            false;

        state.hasMore =
            false;

        state.nextCursor =
            "";

        state.error =
            null;

        state.lastUpdatedAt =
            null;

        updateRecordCount();
        setLoading(false);
        clearPageStatus();
        showGuestState();

        if (state.page) {
            state.page.dataset
                .accountState =
                "guest";
        }

        return true;
    }

    function setData(payload) {
        if (
            !state.initialized ||
            !state.page
        ) {
            return false;
        }

        const currentUser =
            resolveCurrentUser();

        if (
            !isVerifiedGoogleUser(
                currentUser
            )
        ) {
            return renderGuestData();
        }

        const payloadUid =
            normalizeString(
                payload
                    ?.currentUser
                    ?.uid ||
                payload
                    ?.summary
                    ?.uid ||
                payload?.uid ||
                payload
                    ?.withdrawals
                    ?.[0]
                    ?.uid ||
                payload
                    ?.withdrawals
                    ?.[0]
                    ?.userId
            );

        if (
            payloadUid &&
            payloadUid !==
                currentUser.uid
        ) {
            return false;
        }

        state.currentUid =
            currentUser.uid;

        state.records =
            normalizeRecordCollection(
                payload
            );

        const nextCursor =
            normalizeString(
                payload?.nextCursor ||
                payload
                    ?.data
                    ?.nextCursor
            );

        state.nextCursor =
            nextCursor;

        state.hasMore =
            Boolean(
                nextCursor &&
                (
                    payload?.hasMore ===
                        true ||
                    payload
                        ?.data
                        ?.hasMore ===
                        true
                )
            );

        state.error =
            null;

        state.lastUpdatedAt =
            new Date()
                .toISOString();

        renderRows(
            state.records
        );

        setLoading(false);
        clearPageStatus();

        state.page.dataset
            .accountState =
            "google";

        return true;
    }

    function handleDataError(error) {
        state.error =
            normalizeError(
                error
            );

        state.loadingMore =
            false;

        setLoading(false);

        showPageStatus(
            state.error.message,
            "error"
        );

        if (
            !isVerifiedGoogleUser(
                resolveCurrentUser()
            )
        ) {
            showGuestState();
        } else if (
            state.records.length
        ) {
            renderRows(
                state.records
            );
        } else {
            showEmptyState();
        }

        return state.error;
    }

    /* =====================================================
       WITHDRAWDB SUBSCRIPTION
    ===================================================== */

    function subscribeToWithdrawDB() {
        if (
            state.withdrawUnsubscribe ||
            !window.WithdrawDB ||
            typeof window.WithdrawDB
                .subscribe !==
                "function"
        ) {
            return false;
        }

        try {
            const unsubscribe =
                window.WithdrawDB
                    .subscribe(
                        withdrawState => {
                            if (
                                !state.initialized
                            ) {
                                return;
                            }

                            if (
                                withdrawState
                                    ?.loading ===
                                    true &&
                                !state.loadingMore
                            ) {
                                setLoading(true);

                                return;
                            }

                            if (
                                withdrawState
                                    ?.error
                            ) {
                                handleDataError(
                                    withdrawState
                                        .error
                                );

                                return;
                            }

                            if (
                                stateBelongsToUser(
                                    withdrawState,
                                    resolveCurrentUser()
                                        ?.uid
                                )
                            ) {
                                setData(
                                    withdrawState
                                );
                            }
                        }
                    );

            state.withdrawUnsubscribe =
                typeof unsubscribe ===
                    "function"
                    ? unsubscribe
                    : null;

            return true;
        } catch {
            state.withdrawUnsubscribe =
                null;

            return false;
        }
    }

    function unsubscribeFromWithdrawDB() {
        if (
            typeof state
                .withdrawUnsubscribe ===
                "function"
        ) {
            try {
                state.withdrawUnsubscribe();
            } catch {
                /*
                 * Nothing else to clean up.
                 */
            }
        }

        state.withdrawUnsubscribe =
            null;

        return true;
    }

    /* =====================================================
       CANCELLATION COMPATIBILITY — DISABLED

       No WithdrawDB call.
       No FunctionsClient call.
       No WalletDB refresh.
       No Firestore write.
    ===================================================== */

    async function cancelWithdrawal() {
        const error =
            createCancellationDisabledError();

        showPageStatus(
            error.message,
            "error"
        );

        throw error;
    }

    /* =====================================================
       WITHDRAWDB INIT
    ===================================================== */

    async function initializeWithdrawDB() {
        const withdrawDB =
            window.WithdrawDB;

        if (!withdrawDB) {
            throw new Error(
                "WithdrawDB is unavailable."
            );
        }

        if (
            typeof withdrawDB.init ===
                "function"
        ) {
            await withdrawDB.init();
        }

        return withdrawDB;
    }

    /* =====================================================
       PAGINATION
    ===================================================== */

    async function loadMore() {
        if (
            !state.initialized ||
            !state.page ||
            state.loading ||
            state.loadingMore ||
            !state.hasMore ||
            !state.nextCursor
        ) {
            return getState();
        }

        const currentUser =
            resolveCurrentUser();

        if (
            !isVerifiedGoogleUser(
                currentUser
            )
        ) {
            renderGuestData();

            return getState();
        }

        const expectedUid =
            currentUser.uid;

        const expectedGeneration =
            state.lifecycleGeneration;

        state.loadingMore =
            true;

        clearPageStatus();
        updateLoadMoreControl();

        try {
            const withdrawDB =
                await initializeWithdrawDB();

            if (
                typeof withdrawDB
                    .loadMore !==
                    "function"
            ) {
                throw new Error(
                    "Withdrawal history pagination is unavailable."
                );
            }

            const result =
                await withdrawDB
                    .loadMore();

            if (
                !state.initialized ||
                expectedGeneration !==
                    state.lifecycleGeneration ||
                resolveCurrentUser()
                    ?.uid !==
                    expectedUid
            ) {
                return getState();
            }

            const withdrawState =
                isPlainObject(result)
                    ? result
                    : readWithdrawDBState();

            if (
                withdrawState &&
                stateBelongsToUser(
                    withdrawState,
                    expectedUid
                )
            ) {
                setData(
                    withdrawState
                );
            }

            return getState();
        } catch (error) {
            if (
                state.initialized &&
                expectedGeneration ===
                    state.lifecycleGeneration
            ) {
                handleDataError(
                    error
                );
            }

            return getState();
        } finally {
            if (
                state.initialized &&
                expectedGeneration ===
                    state.lifecycleGeneration
            ) {
                state.loadingMore =
                    false;

                updateLoadMoreControl();
            }
        }
    }

    function handleLoadMoreClick(event) {
        event.preventDefault();

        void loadMore();
    }

    /* =====================================================
       AUTH / WITHDRAWAL EVENTS
    ===================================================== */

    function handleAuthEvent(event) {
        if (!state.initialized) {
            return;
        }

        const user =
            extractEventUser(event);

        if (
            !isVerifiedGoogleUser(
                user
            )
        ) {
            renderGuestData();

            if (
                window.AccountSectionsModule &&
                typeof window
                    .AccountSectionsModule
                    .clearReferralLink ===
                    "function"
            ) {
                window.AccountSectionsModule
                    .clearReferralLink();
            }

            return;
        }

        void refresh({
            force:
                true
        });
    }

    function handleWithdrawalEvent() {
        if (!state.initialized) {
            return;
        }

        const currentUid =
            resolveCurrentUser()
                ?.uid ||
            "";

        const withdrawState =
            readWithdrawDBState();

        if (
            withdrawState &&
            stateBelongsToUser(
                withdrawState,
                currentUid
            )
        ) {
            if (
                withdrawState.loading ===
                    true &&
                !state.loadingMore
            ) {
                setLoading(true);

                return;
            }

            setData(
                withdrawState
            );

            return;
        }

        void refresh({
            force:
                true
        });
    }

    function bindBrowserEvents() {
        addManagedListener(
            state.elements
                .loadMoreButton,
            "click",
            handleLoadMoreClick
        );

        AUTH_EVENTS.forEach(
            eventName => {
                addManagedListener(
                    window,
                    eventName,
                    handleAuthEvent
                );
            }
        );

        WITHDRAWAL_EVENTS.forEach(
            eventName => {
                addManagedListener(
                    window,
                    eventName,
                    handleWithdrawalEvent
                );
            }
        );

        return true;
    }

    /* =====================================================
       SHARED ACCOUNT SECTIONS
    ===================================================== */

    function getReferralIdentity() {
        if (
            window.ReferralDB &&
            typeof window.ReferralDB
                .getReferralIdentity ===
                "function"
        ) {
            try {
                return (
                    window.ReferralDB
                        .getReferralIdentity() ||
                    {}
                );
            } catch {
                return {};
            }
        }

        return {};
    }

    function initializeSharedSections() {
        const mount =
            state.elements
                .accountSectionsMount;

        if (!mount) {
            return false;
        }

        if (
            !window.AccountSectionsView ||
            typeof window
                .AccountSectionsView
                .render !==
                "function"
        ) {
            return false;
        }

        const referralIdentity =
            getReferralIdentity();

        const rendered =
            window.AccountSectionsView
                .render(
                    mount,
                    {
                        currentPage:
                            CURRENT_PAGE,

                        referralLink:
                            normalizeString(
                                referralIdentity
                                    .referralLink
                            )
                    }
                );

        if (rendered === false) {
            return false;
        }

        if (
            !window.AccountSectionsModule ||
            typeof window
                .AccountSectionsModule
                .init !==
                "function"
        ) {
            return false;
        }

        const initialized =
            window.AccountSectionsModule
                .init({
                    root:
                        mount,

                    currentPage:
                        CURRENT_PAGE,

                    referralLink:
                        normalizeString(
                            referralIdentity
                                .referralLink
                        )
                });

        state.sharedMount =
            mount;

        state.sharedSectionsInitialized =
            initialized !==
            false;

        return state
            .sharedSectionsInitialized;
    }

    function destroySharedSections() {
        if (
            !state.sharedSectionsInitialized
        ) {
            return true;
        }

        const sharedModule =
            window.AccountSectionsModule;

        if (
            sharedModule &&
            typeof sharedModule
                .destroy ===
                "function"
        ) {
            const currentPage =
                typeof sharedModule
                    .getCurrentPage ===
                    "function"
                    ? sharedModule
                        .getCurrentPage()
                    : CURRENT_PAGE;

            if (
                currentPage ===
                CURRENT_PAGE
            ) {
                sharedModule.destroy();
            }
        }

        state.sharedSectionsInitialized =
            false;

        state.sharedMount =
            null;

        return true;
    }

    /* =====================================================
       REFRESH
    ===================================================== */

    function refresh(options = {}) {
        if (state.refreshPromise) {
            return state.refreshPromise;
        }

        const currentUser =
            resolveCurrentUser();

        if (
            !isVerifiedGoogleUser(
                currentUser
            )
        ) {
            renderGuestData();

            return Promise.resolve(
                getState()
            );
        }

        const expectedUid =
            currentUser.uid;

        const expectedGeneration =
            state.lifecycleGeneration;

        state.currentUid =
            expectedUid;

        state.refreshPromise =
            (async () => {
                setLoading(true);
                clearPageStatus();

                try {
                    const withdrawDB =
                        await initializeWithdrawDB();

                    if (
                        !state.initialized ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid
                    ) {
                        return getState();
                    }

                    let result =
                        null;

                    if (
                        typeof withdrawDB
                            .refresh ===
                            "function"
                    ) {
                        result =
                            await withdrawDB
                                .refresh({
                                    force:
                                        options.force ===
                                        true
                                });
                    }

                    if (
                        !state.initialized ||
                        expectedGeneration !==
                            state.lifecycleGeneration ||
                        resolveCurrentUser()
                            ?.uid !==
                            expectedUid
                    ) {
                        return getState();
                    }

                    const withdrawState =
                        isPlainObject(result)
                            ? result
                            : readWithdrawDBState();

                    if (
                        withdrawState &&
                        stateBelongsToUser(
                            withdrawState,
                            expectedUid
                        )
                    ) {
                        setData(
                            withdrawState
                        );
                    } else {
                        setData({
                            currentUser: {
                                uid:
                                    expectedUid
                            },

                            withdrawals:
                                []
                        });
                    }

                    return getState();
                } catch (error) {
                    if (
                        state.initialized &&
                        expectedGeneration ===
                            state.lifecycleGeneration
                    ) {
                        handleDataError(
                            error
                        );
                    }

                    return getState();
                } finally {
                    state.refreshPromise =
                        null;
                }
            })();

        return state.refreshPromise;
    }

    /* =====================================================
       PAGE REMOVAL
    ===================================================== */

    function observePageRemoval() {
        if (
            !document.body ||
            typeof MutationObserver ===
                "undefined"
        ) {
            return false;
        }

        const observedPage =
            state.page;

        const observedGeneration =
            state.lifecycleGeneration;

        state.pageObserver =
            new MutationObserver(
                () => {
                    if (
                        observedGeneration !==
                            state.lifecycleGeneration ||
                        !observedPage ||
                        observedPage.isConnected
                    ) {
                        return;
                    }

                    destroy();
                }
            );

        state.pageObserver.observe(
            document.body,
            {
                childList:
                    true,

                subtree:
                    true
            }
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function normalizeInitArguments(
        target,
        options
    ) {
        if (
            isPlainObject(target) &&
            !(target instanceof HTMLElement)
        ) {
            return {
                target:
                    target.root,

                options:
                    target
            };
        }

        return {
            target,

            options:
                isPlainObject(options)
                    ? options
                    : {}
        };
    }

    async function init(
        target,
        options = {}
    ) {
        destroy();

        const args =
            normalizeInitArguments(
                target,
                options
            );

        let page =
            resolvePage(
                args.target
            );

        if (
            !page &&
            window.WithdrawHistoryView &&
            typeof window
                .WithdrawHistoryView
                .render ===
                "function"
        ) {
            const renderedPage =
                window.WithdrawHistoryView
                    .render(
                        args.target
                    );

            page =
                renderedPage instanceof
                    HTMLElement
                    ? renderedPage
                    : resolvePage(
                        args.target
                    );
        }

        if (!page) {
            console.error(
                "[WithdrawHistoryModule] Withdrawal History page was not found."
            );

            return false;
        }

        state.lifecycleGeneration +=
            1;

        const currentGeneration =
            state.lifecycleGeneration;

        state.page =
            page;

        state.initialized =
            true;

        collectElements();
        bindBrowserEvents();
        observePageRemoval();

        if (
            !initializeSharedSections()
        ) {
            console.error(
                "[WithdrawHistoryModule] Shared Account Sections initialization failed."
            );
        }

        const currentUser =
            resolveCurrentUser();

        if (
            !isVerifiedGoogleUser(
                currentUser
            )
        ) {
            renderGuestData();

            return true;
        }

        state.currentUid =
            currentUser.uid;

        setLoading(true);

        try {
            await initializeWithdrawDB();

            if (
                !state.initialized ||
                currentGeneration !==
                    state.lifecycleGeneration
            ) {
                return false;
            }

            subscribeToWithdrawDB();

            const currentState =
                readWithdrawDBState();

            if (
                currentState &&
                stateBelongsToUser(
                    currentState,
                    currentUser.uid
                )
            ) {
                setData(
                    currentState
                );
            }

            await refresh({
                force:
                    args.options.force ===
                    true
            });
        } catch (error) {
            if (
                state.initialized &&
                currentGeneration ===
                    state.lifecycleGeneration
            ) {
                handleDataError(
                    error
                );
            }
        }

        return true;
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        state.refreshPromise =
            null;

        unsubscribeFromWithdrawDB();
        removeManagedListeners();

        if (
            state.pageObserver
        ) {
            state.pageObserver
                .disconnect();

            state.pageObserver =
                null;
        }

        destroySharedSections();

        state.initialized =
            false;

        state.page =
            null;

        state.elements =
            {};

        state.currentUid =
            "";

        state.records =
            [];

        state.loading =
            false;

        state.loadingMore =
            false;

        state.hasMore =
            false;

        state.nextCursor =
            "";

        state.error =
            null;

        state.lastUpdatedAt =
            null;

        return true;
    }

    /* =====================================================
       PUBLIC STATE
    ===================================================== */

    function getState() {
        return Object.freeze(
            cloneValue({
                initialized:
                    state.initialized,

                loading:
                    state.loading,

                loadingMore:
                    state.loadingMore,

                hasMore:
                    state.hasMore,

                nextCursor:
                    state.nextCursor,

                currentUid:
                    state.currentUid,

                records:
                    state.records,

                total:
                    state.records.length,

                error:
                    state.error,

                lastUpdatedAt:
                    state.lastUpdatedAt,

                /*
                 * Compatibility alias.
                 * Always empty because cancellation is disabled.
                 */

                cancellingIds:
                    []
            })
        );
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,

        initialize:
            init,

        destroy,
        refresh,
        loadMore,
        setData,
        getState,

        /*
         * Compatibility API only.
         * Always throws and performs zero writes.
         */

        cancelWithdrawal,

        maskAccountNumber,
        normalizeWallet,
        normalizeStatus,
        normalizeRecord,
        normalizeRecordCollection,

        formatDate,
        formatAmount,

        isInitialized() {
            return state.initialized;
        },

        WITHDRAWAL_STATUSES
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.WithdrawHistoryModule =
    WithdrawHistoryModule;
