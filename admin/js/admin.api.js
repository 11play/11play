"use strict";

/* =========================================================
   11PLAY — ADMIN DASHBOARD API CLIENT
   File: admin/js/admin.api.js

   Responsibilities:
   - Connect Admin Dashboard modules to the shared FunctionsClient
   - Use the Firebase Spark / direct-Firestore client architecture
   - Normalize client errors
   - Validate Admin operation payloads
   - Publish non-sensitive request-state events
   - Never write directly to Firestore from this file
   - Never call deployed Cloud Functions

   Security policy:
   - Sole Admin email: casinobuzzbd@gmail.com
   - Client-side Admin email checks are UI/convenience only
   - Firestore Rules + FunctionsClient remain the authority
   - No Firestore role assignment
   - No custom claims
   - No super-admin

   Final review policy:
   - Referral Approve note: optional
   - Referral Reject note: optional
   - Withdrawal Approve note: optional
   - Withdrawal Reject note: optional
   - Withdrawal approval does not accept paymentReference
   - Withdrawal approval does not accept paymentConfirmed
========================================================= */

(function initializeAdminAPI(window) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    /*
     * Compatibility metadata only.
     * No regional Cloud Functions are invoked by this module.
     */
    const REGION =
        "asia-south1";

    const SOLE_ADMIN_EMAIL =
        "casinobuzzbd@gmail.com";

    const DEFAULT_LIMIT =
        50;

    const MAXIMUM_LIMIT =
        100;

    const MAXIMUM_CURSOR_LENGTH =
        512;

    const MAXIMUM_ADMIN_NOTE_LENGTH =
        500;

    const MAXIMUM_OPERATION_ID_LENGTH =
        128;

    const PROFILE_STATUSES =
        Object.freeze([
            "active",
            "suspended",
            "blocked"
        ]);

    const WALLET_DIRECTIONS =
        Object.freeze([
            "credit",
            "debit"
        ]);

    const EVENTS =
        Object.freeze({
            REQUEST_STARTED:
                "admin-api:request-started",

            REQUEST_SUCCEEDED:
                "admin-api:request-succeeded",

            REQUEST_FAILED:
                "admin-api:request-failed",

            STATE_CHANGED:
                "admin-api:state-changed"
        });

    /*
     * Historical operation names are retained because
     * Admin modules already use these names as a stable API.
     *
     * These are NOT deployed Cloud Function names anymore.
     */

    const FUNCTION_NAMES =
        Object.freeze({
            GET_ADMIN_SESSION:
                "getAdminSession",

            GET_DASHBOARD_SUMMARY:
                "getAdminDashboardSummary",

            GET_USERS:
                "getAdminUsers",

            GET_USER_DETAILS:
                "getAdminUserDetails",

            UPDATE_USER_PROFILE:
                "updateAdminUserProfile",

            ADJUST_WALLET:
                "adjustAdminWallet",

            GET_TRANSACTIONS:
                "getAdminTransactions",

            GET_AUDIT_LOGS:
                "getAdminAuditLogs",

            GET_PENDING_REFERRALS:
                "getPendingReferrals",

            APPROVE_REFERRAL:
                "approveReferral",

            REJECT_REFERRAL:
                "rejectReferral",

            GET_PENDING_WITHDRAWALS:
                "getPendingWithdrawals",

            APPROVE_WITHDRAWAL:
                "approveWithdrawal",

            REJECT_WITHDRAWAL:
                "rejectWithdrawal"
        });

    const CLIENT_METHOD_NAMES =
        Object.freeze({
            [FUNCTION_NAMES.GET_ADMIN_SESSION]:
                "getAdminSession",

            [FUNCTION_NAMES.GET_DASHBOARD_SUMMARY]:
                "getAdminDashboardSummary",

            [FUNCTION_NAMES.GET_USERS]:
                "getAdminUsers",

            [FUNCTION_NAMES.GET_USER_DETAILS]:
                "getAdminUserDetails",

            [FUNCTION_NAMES.UPDATE_USER_PROFILE]:
                "updateAdminUserProfile",

            [FUNCTION_NAMES.ADJUST_WALLET]:
                "adjustAdminWallet",

            [FUNCTION_NAMES.GET_TRANSACTIONS]:
                "getAdminTransactions",

            [FUNCTION_NAMES.GET_AUDIT_LOGS]:
                "getAdminAuditLogs",

            [FUNCTION_NAMES.GET_PENDING_REFERRALS]:
                "getPendingReferrals",

            [FUNCTION_NAMES.APPROVE_REFERRAL]:
                "approveReferral",

            [FUNCTION_NAMES.REJECT_REFERRAL]:
                "rejectReferral",

            [FUNCTION_NAMES.GET_PENDING_WITHDRAWALS]:
                "getPendingWithdrawals",

            [FUNCTION_NAMES.APPROVE_WITHDRAWAL]:
                "approveWithdrawal",

            [FUNCTION_NAMES.REJECT_WITHDRAWAL]:
                "rejectWithdrawal"
        });

    const ALLOWED_FUNCTIONS =
        new Set(
            Object.values(
                FUNCTION_NAMES
            )
        );

    /* =====================================================
       ERROR TYPE
    ===================================================== */

    class AdminAPIError extends Error {
        constructor({
            code = "unknown",
            message =
                "The Admin operation could not be completed.",
            details = null,
            field = "",
            functionName = "",
            cause = null
        } = {}) {
            super(message);

            this.name =
                "AdminAPIError";

            this.code =
                code;

            this.details =
                details;

            this.field =
                field;

            this.functionName =
                functionName;

            if (cause) {
                this.cause =
                    cause;
            }

            Error.captureStackTrace?.(
                this,
                AdminAPIError
            );
        }
    }

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        activeRequests:
            0,

        lastFunctionName:
            "",

        lastRequestAt:
            null,

        lastSuccessAt:
            null,

        lastError:
            null
    };

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

    function normalizeEmail(value) {
        return toSafeString(
            value
        ).toLowerCase();
    }

    function toSafeLimit(
        value,
        fallback = DEFAULT_LIMIT
    ) {
        const number =
            Number(value);

        if (
            !Number.isFinite(number)
        ) {
            return fallback;
        }

        return Math.min(
            MAXIMUM_LIMIT,
            Math.max(
                1,
                Math.floor(number)
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

    function normalizeFunctionName(
        functionName
    ) {
        const normalizedName =
            toSafeString(
                functionName
            );

        if (
            !ALLOWED_FUNCTIONS.has(
                normalizedName
            )
        ) {
            throw new TypeError(
                `Unsupported Admin operation: ${
                    normalizedName ||
                    "unknown"
                }`
            );
        }

        return normalizedName;
    }

    function requireIdentifier(
        value,
        fieldName
    ) {
        const identifier =
            toSafeString(
                value
            );

        if (!identifier) {
            throw new TypeError(
                `${fieldName} is required.`
            );
        }

        if (
            identifier.length >
            1500
        ) {
            throw new TypeError(
                `${fieldName} is too long.`
            );
        }

        if (
            identifier.includes("/")
        ) {
            throw new TypeError(
                `${fieldName} is invalid.`
            );
        }

        return identifier;
    }

    function normalizePaginationCursor(
        value,
        fieldName = "cursor"
    ) {
        const cursor =
            toSafeString(
                value
            );

        if (!cursor) {
            return "";
        }

        if (
            cursor.length >
                MAXIMUM_CURSOR_LENGTH ||
            cursor === "." ||
            cursor === ".." ||
            cursor.includes("/") ||
            /^__.*__$/.test(
                cursor
            )
        ) {
            throw new TypeError(
                `${fieldName} is invalid.`
            );
        }

        return cursor;
    }

    function requireAdminNote(
        value,
        fieldName = "adminNote"
    ) {
        const note =
            toSafeString(
                value
            );

        if (!note) {
            throw new TypeError(
                `${fieldName} is required.`
            );
        }

        if (
            note.length >
            MAXIMUM_ADMIN_NOTE_LENGTH
        ) {
            throw new TypeError(
                `${fieldName} must not exceed ${MAXIMUM_ADMIN_NOTE_LENGTH} characters.`
            );
        }

        return note;
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
            MAXIMUM_ADMIN_NOTE_LENGTH
        ) {
            throw new TypeError(
                `adminNote must not exceed ${MAXIMUM_ADMIN_NOTE_LENGTH} characters.`
            );
        }

        return note;
    }

    function normalizeProfileStatus(
        value
    ) {
        const status =
            toSafeString(
                value
            ).toLowerCase();

        if (
            !PROFILE_STATUSES.includes(
                status
            )
        ) {
            throw new TypeError(
                "Profile status must be active, suspended or blocked."
            );
        }

        return status;
    }

    function normalizeWalletDirection(
        value
    ) {
        const direction =
            toSafeString(
                value
            ).toLowerCase();

        if (
            !WALLET_DIRECTIONS.includes(
                direction
            )
        ) {
            throw new TypeError(
                "Wallet direction must be credit or debit."
            );
        }

        return direction;
    }

    function normalizeMoneyAmount(
        value
    ) {
        const amount =
            Number(value);

        if (
            !Number.isSafeInteger(amount) ||
            amount < 1
        ) {
            throw new TypeError(
                "A positive whole-number wallet amount is required."
            );
        }

        return amount;
    }

    function normalizeOperationId(
        value
    ) {
        const operationId =
            toSafeString(
                value
            );

        if (
            operationId.length <
                8 ||
            operationId.length >
                MAXIMUM_OPERATION_ID_LENGTH
        ) {
            throw new TypeError(
                `operationId must contain between 8 and ${MAXIMUM_OPERATION_ID_LENGTH} characters.`
            );
        }

        if (
            !/^[A-Za-z0-9:_-]+$/.test(
                operationId
            )
        ) {
            throw new TypeError(
                "operationId contains unsupported characters."
            );
        }

        return operationId;
    }

    function unwrapClientResult(
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
            Object.keys(response)
                .length === 1
        ) {
            return response.data;
        }

        return response;
    }

    function normalizeError(
        error,
        functionName = ""
    ) {
        const rawCode =
            toSafeString(
                error?.code
            );

        const code =
            rawCode.includes("/")
                ? rawCode
                    .split("/")
                    .pop()
                : rawCode;

        const details =
            isPlainObject(
                error?.details
            )
                ? error.details
                : isPlainObject(
                    error?.data
                )
                    ? error.data
                    : null;

        const field =
            toSafeString(
                error?.field ||
                details?.field
            );

        return Object.freeze({
            code:
                code ||
                "unknown",

            message:
                toSafeString(
                    details?.message ||
                    error?.message
                ) ||
                "The Admin operation could not be completed.",

            details,

            field,

            functionName:
                toSafeString(
                    functionName
                )
        });
    }

    /* =====================================================
       STATE AND EVENTS
    ===================================================== */

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

    function getState() {
        return Object.freeze({
            initialized:
                state.initialized,

            loading:
                state.activeRequests >
                0,

            activeRequests:
                state.activeRequests,

            lastFunctionName:
                state.lastFunctionName,

            lastRequestAt:
                state.lastRequestAt,

            lastSuccessAt:
                state.lastSuccessAt,

            lastError:
                cloneValue(
                    state.lastError
                )
        });
    }

    function publishState() {
        dispatch(
            EVENTS.STATE_CHANGED,
            getState()
        );
    }

    function beginRequest(
        functionName
    ) {
        state.activeRequests +=
            1;

        state.lastFunctionName =
            functionName;

        state.lastRequestAt =
            new Date()
                .toISOString();

        state.lastError =
            null;

        dispatch(
            EVENTS.REQUEST_STARTED,
            {
                functionName,

                activeRequests:
                    state.activeRequests
            }
        );

        publishState();
    }

    function completeRequest(
        functionName
    ) {
        state.lastSuccessAt =
            new Date()
                .toISOString();

        state.lastError =
            null;

        dispatch(
            EVENTS.REQUEST_SUCCEEDED,
            {
                functionName,

                completedAt:
                    state.lastSuccessAt
            }
        );
    }

    function failRequest(
        functionName,
        error
    ) {
        const normalizedError =
            normalizeError(
                error,
                functionName
            );

        state.lastError =
            normalizedError;

        dispatch(
            EVENTS.REQUEST_FAILED,
            {
                functionName,

                error:
                    normalizedError
            }
        );

        return new AdminAPIError({
            ...normalizedError,

            cause:
                error
        });
    }

    function endRequest() {
        state.activeRequests =
            Math.max(
                0,
                state.activeRequests -
                    1
            );

        publishState();
    }

    /* =====================================================
       SHARED SPARK CLIENT
    ===================================================== */

    function requireFunctionsClient() {
        const client =
            window.FunctionsClient ||
            null;

        if (!client) {
            throw new AdminAPIError({
                code:
                    "functions-client-not-loaded",

                message:
                    "Firebase Spark Client is not loaded."
            });
        }

        return client;
    }

    async function invokeThroughFunctionsClient(
        functionName,
        payload
    ) {
        const client =
            requireFunctionsClient();

        const methodName =
            CLIENT_METHOD_NAMES[
                functionName
            ];

        /*
         * Prefer the explicit public method because
         * FunctionsClient owns all security-sensitive
         * Firestore transaction logic.
         */

        if (
            methodName &&
            typeof client[
                methodName
            ] ===
                "function"
        ) {
            return unwrapClientResult(
                await client[
                    methodName
                ](
                    payload
                )
            );
        }

        /*
         * Compatibility fallback inside FunctionsClient only.
         *
         * FunctionsClient.call() is allowed only because the
         * shared client is the Spark/direct-Firestore facade.
         *
         * There is deliberately NO firebase.functions(),
         * httpsCallable(), regional Functions instance or
         * deployed callable fallback in AdminAPI.
         */

        if (
            typeof client.call ===
                "function"
        ) {
            return unwrapClientResult(
                await client.call(
                    functionName,
                    payload
                )
            );
        }

        throw new AdminAPIError({
            code:
                "client-method-unavailable",

            message:
                `FunctionsClient method is unavailable: ${functionName}`,

            functionName
        });
    }

    /* =====================================================
       GENERIC OPERATION INVOCATION
    ===================================================== */

    async function invokeCallable(
        functionName,
        payload = {}
    ) {
        const normalizedName =
            normalizeFunctionName(
                functionName
            );

        const normalizedPayload =
            isPlainObject(payload)
                ? payload
                : {};

        if (!state.initialized) {
            init();
        }

        beginRequest(
            normalizedName
        );

        try {
            const result =
                await invokeThroughFunctionsClient(
                    normalizedName,
                    normalizedPayload
                );

            if (
                result &&
                typeof result ===
                    "object" &&
                result.success ===
                    false
            ) {
                const operationError =
                    new Error(
                        toSafeString(
                            result.message ||
                            result.error?.message
                        ) ||
                        "The Admin operation was not successful."
                    );

                operationError.code =
                    toSafeString(
                        result.code ||
                        result.error?.code
                    ) ||
                    "admin-operation-failed";

                operationError.details =
                    isPlainObject(
                        result.details
                    )
                        ? result.details
                        : isPlainObject(
                            result.error
                        )
                            ? result.error
                            : null;

                throw operationError;
            }

            completeRequest(
                normalizedName
            );

            return result;
        } catch (error) {
            if (
                error instanceof
                    AdminAPIError &&
                error.functionName ===
                    normalizedName
            ) {
                state.lastError =
                    normalizeError(
                        error,
                        normalizedName
                    );

                dispatch(
                    EVENTS.REQUEST_FAILED,
                    {
                        functionName:
                            normalizedName,

                        error:
                            state.lastError
                    }
                );

                throw error;
            }

            throw failRequest(
                normalizedName,
                error
            );
        } finally {
            endRequest();
        }
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (
            state.initialized
        ) {
            return getState();
        }

        /*
         * Fail early if the shared Spark client is missing.
         */

        requireFunctionsClient();

        state.initialized =
            true;

        publishState();

        return getState();
    }

    function destroy() {
        state.initialized =
            false;

        state.activeRequests =
            0;

        state.lastFunctionName =
            "";

        state.lastRequestAt =
            null;

        state.lastSuccessAt =
            null;

        state.lastError =
            null;

        publishState();

        return true;
    }

    /* =====================================================
       OPERATION ID
    ===================================================== */

    function createOperationId(
        prefix = "admin"
    ) {
        const normalizedPrefix =
            toSafeString(
                prefix,
                "admin"
            )
                .replace(
                    /[^A-Za-z0-9_-]/g,
                    "_"
                )
                .slice(
                    0,
                    30
                ) ||
            "admin";

        if (
            window.crypto &&
            typeof window.crypto
                .randomUUID ===
                "function"
        ) {
            return `${normalizedPrefix}_${window.crypto.randomUUID()}`;
        }

        const randomValues =
            new Uint32Array(4);

        if (
            window.crypto &&
            typeof window.crypto
                .getRandomValues ===
                "function"
        ) {
            window.crypto
                .getRandomValues(
                    randomValues
                );
        } else {
            for (
                let index = 0;
                index <
                randomValues.length;
                index += 1
            ) {
                randomValues[index] =
                    Math.floor(
                        Math.random() *
                        0xffffffff
                    );
            }
        }

        const randomPart =
            Array.from(
                randomValues
            )
                .map(
                    value =>
                        value.toString(
                            36
                        )
                )
                .join("");

        return [
            normalizedPrefix,

            Date.now()
                .toString(36),

            randomPart
        ].join("_");
    }

    function resolveOperationId(
        value,
        prefix = "admin"
    ) {
        const supplied =
            toSafeString(
                value
            );

        return normalizeOperationId(
            supplied ||
            createOperationId(
                prefix
            )
        );
    }

    function isSoleAdminEmail(email) {
        return (
            normalizeEmail(
                email
            ) ===
            SOLE_ADMIN_EMAIL
        );
    }

    /* =====================================================
       ADMIN SESSION
    ===================================================== */

    function getAdminSession() {
        return invokeCallable(
            FUNCTION_NAMES
                .GET_ADMIN_SESSION,
            {}
        );
    }

    /* =====================================================
       DASHBOARD SUMMARY
    ===================================================== */

    function getAdminDashboardSummary() {
        return invokeCallable(
            FUNCTION_NAMES
                .GET_DASHBOARD_SUMMARY,
            {}
        );
    }

    /* =====================================================
       USERS
    ===================================================== */

    function getAdminUsers(
        options = {}
    ) {
        const source =
            isPlainObject(options)
                ? options
                : {};

        const payload = {
            limit:
                toSafeLimit(
                    source.limit
                )
        };

        const status =
            toSafeString(
                source.status
            ).toLowerCase();

        if (status) {
            payload.status =
                normalizeProfileStatus(
                    status
                );
        }

        const cursor =
            normalizePaginationCursor(
                source.cursor
            );

        if (cursor) {
            payload.cursor =
                cursor;
        }

        return invokeCallable(
            FUNCTION_NAMES
                .GET_USERS,
            payload
        );
    }

    function getAdminUserDetails(
        userId,
        options = {}
    ) {
        const source =
            isPlainObject(options)
                ? options
                : {};

        return invokeCallable(
            FUNCTION_NAMES
                .GET_USER_DETAILS,
            {
                userId:
                    requireIdentifier(
                        userId,
                        "userId"
                    ),

                limit:
                    toSafeLimit(
                        source.limit
                    )
            }
        );
    }

    /*
     * Compatibility signatures:
     *
     * updateAdminUserProfile(
     *     userId,
     *     { status: "suspended" },
     *     adminNote
     * )
     *
     * updateAdminUserProfile(
     *     userId,
     *     "suspended",
     *     adminNote
     * )
     */

    function updateAdminUserProfile(
        userId,
        updates,
        adminNote = ""
    ) {
        const statusValue =
            isPlainObject(updates)
                ? updates.status
                : updates;

        const noteValue =
            adminNote ||
            (
                isPlainObject(updates)
                    ? updates.adminNote ||
                      updates.note
                    : ""
            );

        return invokeCallable(
            FUNCTION_NAMES
                .UPDATE_USER_PROFILE,
            {
                userId:
                    requireIdentifier(
                        userId,
                        "userId"
                    ),

                status:
                    normalizeProfileStatus(
                        statusValue
                    ),

                /*
                 * Profile-status changes still require a note.
                 */

                adminNote:
                    requireAdminNote(
                        noteValue
                    )
            }
        );
    }

    /* =====================================================
       WALLET ADJUSTMENT
    ===================================================== */

    function adjustAdminWallet(
        options = {}
    ) {
        const source =
            isPlainObject(options)
                ? options
                : {};

        return invokeCallable(
            FUNCTION_NAMES
                .ADJUST_WALLET,
            {
                userId:
                    requireIdentifier(
                        source.userId ||
                        source.uid,
                        "userId"
                    ),

                amount:
                    normalizeMoneyAmount(
                        source.amount
                    ),

                direction:
                    normalizeWalletDirection(
                        source.direction
                    ),

                /*
                 * Blank Operation ID is allowed by the UI.
                 * Generate a safe idempotency identifier here.
                 */

                operationId:
                    resolveOperationId(
                        source.operationId ||
                        source.requestId,
                        "wallet_adjustment"
                    ),

                /*
                 * Manual wallet adjustments remain sensitive
                 * and therefore still require an Admin note.
                 */

                adminNote:
                    requireAdminNote(
                        source.adminNote ||
                        source.note
                    )
            }
        );
    }

    /* =====================================================
       TRANSACTIONS
    ===================================================== */

    function getAdminTransactions(
        options = {}
    ) {
        const source =
            isPlainObject(options)
                ? options
                : {};

        const payload = {
            limit:
                toSafeLimit(
                    source.limit
                )
        };

        const userId =
            toSafeString(
                source.userId ||
                source.uid
            );

        const type =
            toSafeString(
                source.type
            ).toLowerCase();

        if (userId) {
            payload.userId =
                requireIdentifier(
                    userId,
                    "userId"
                );
        }

        if (type) {
            payload.type =
                type;
        }

        const cursor =
            normalizePaginationCursor(
                source.cursor
            );

        if (cursor) {
            payload.cursor =
                cursor;
        }

        return invokeCallable(
            FUNCTION_NAMES
                .GET_TRANSACTIONS,
            payload
        );
    }

    /* =====================================================
       AUDIT LOGS
    ===================================================== */

    function getAdminAuditLogs(
        options = {}
    ) {
        const source =
            isPlainObject(options)
                ? options
                : {};

        const payload = {
            limit:
                toSafeLimit(
                    source.limit
                )
        };

        const adminUid =
            toSafeString(
                source.adminUid
            );

        const action =
            toSafeString(
                source.action
            ).toLowerCase();

        if (adminUid) {
            payload.adminUid =
                requireIdentifier(
                    adminUid,
                    "adminUid"
                );
        }

        if (action) {
            payload.action =
                action;
        }

        const cursor =
            normalizePaginationCursor(
                source.cursor
            );

        if (cursor) {
            payload.cursor =
                cursor;
        }

        return invokeCallable(
            FUNCTION_NAMES
                .GET_AUDIT_LOGS,
            payload
        );
    }

    /* =====================================================
       REFERRALS
    ===================================================== */

    function getPendingReferrals(
        options = {}
    ) {
        const source =
            isPlainObject(options)
                ? options
                : {};

        const payload = {
            limit:
                toSafeLimit(
                    source.limit
                )
        };

        const cursor =
            normalizePaginationCursor(
                source.cursor
            );

        if (cursor) {
            payload.cursor =
                cursor;
        }

        return invokeCallable(
            FUNCTION_NAMES
                .GET_PENDING_REFERRALS,
            payload
        );
    }

    function approveReferral(
        referralId,
        adminNote = ""
    ) {
        return invokeCallable(
            FUNCTION_NAMES
                .APPROVE_REFERRAL,
            {
                referralId:
                    requireIdentifier(
                        referralId,
                        "referralId"
                    ),

                adminNote:
                    normalizeOptionalAdminNote(
                        adminNote
                    )
            }
        );
    }

    function rejectReferral(
        referralId,
        adminNote = ""
    ) {
        return invokeCallable(
            FUNCTION_NAMES
                .REJECT_REFERRAL,
            {
                referralId:
                    requireIdentifier(
                        referralId,
                        "referralId"
                    ),

                /*
                 * Final policy:
                 * rejection note is optional.
                 */

                adminNote:
                    normalizeOptionalAdminNote(
                        adminNote
                    )
            }
        );
    }

    /* =====================================================
       WITHDRAWALS
    ===================================================== */

    function getPendingWithdrawals(
        options = {}
    ) {
        const source =
            isPlainObject(options)
                ? options
                : {};

        const payload = {
            limit:
                toSafeLimit(
                    source.limit
                )
        };

        const cursor =
            normalizePaginationCursor(
                source.cursor
            );

        if (cursor) {
            payload.cursor =
                cursor;
        }

        return invokeCallable(
            FUNCTION_NAMES
                .GET_PENDING_WITHDRAWALS,
            payload
        );
    }

    function approveWithdrawal(
        withdrawalId,
        adminNote = ""
    ) {
        /*
         * Important:
         * paymentReference and paymentConfirmed are deliberately
         * not accepted or forwarded.
         */

        return invokeCallable(
            FUNCTION_NAMES
                .APPROVE_WITHDRAWAL,
            {
                withdrawalId:
                    requireIdentifier(
                        withdrawalId,
                        "withdrawalId"
                    ),

                adminNote:
                    normalizeOptionalAdminNote(
                        adminNote
                    )
            }
        );
    }

    function rejectWithdrawal(
        withdrawalId,
        adminNote = ""
    ) {
        /*
         * Rejecting is the server-authoritative refund path.
         * Admin note is optional.
         */

        return invokeCallable(
            FUNCTION_NAMES
                .REJECT_WITHDRAWAL,
            {
                withdrawalId:
                    requireIdentifier(
                        withdrawalId,
                        "withdrawalId"
                    ),

                adminNote:
                    normalizeOptionalAdminNote(
                        adminNote
                    )
            }
        );
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.AdminAPI =
        Object.freeze({
            init,
            destroy,
            getState,

            invoke:
                invokeCallable,

            getAdminSession,
            getAdminDashboardSummary,

            getAdminUsers,
            getAdminUserDetails,
            updateAdminUserProfile,

            adjustAdminWallet,

            getAdminTransactions,
            getAdminAuditLogs,

            getPendingReferrals,
            approveReferral,
            rejectReferral,

            getPendingWithdrawals,
            approveWithdrawal,
            rejectWithdrawal,

            /*
             * Compatibility aliases
             */

            verifySession:
                getAdminSession,

            getDashboardSummary:
                getAdminDashboardSummary,

            getUsers:
                getAdminUsers,

            getUserDetails:
                getAdminUserDetails,

            updateUserProfile:
                updateAdminUserProfile,

            adjustWallet:
                adjustAdminWallet,

            getTransactions:
                getAdminTransactions,

            getAuditLogs:
                getAdminAuditLogs,

            createOperationId,
            isSoleAdminEmail,

            AdminAPIError,

            SOLE_ADMIN_EMAIL,

            /*
             * Compatibility metadata only.
             */

            REGION,

            EVENTS,
            FUNCTION_NAMES,
            PROFILE_STATUSES,
            WALLET_DIRECTIONS
        });
})(
    window
);
