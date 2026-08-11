"use strict";

/* =========================================================
   11PLAY — ADMIN DASHBOARD API CLIENT
   File: admin/js/admin.api.js

   Responsibilities:
   - Connect Admin Dashboard modules to FunctionsClient
   - Use Firebase Spark / direct-Firestore architecture
   - Normalize Admin API errors
   - Validate Admin request payloads
   - Publish request-state events
   - Never write directly to Firestore from this file
   - Never call deployed Cloud Functions

   Current Admin scope:
   - Verify Admin session
   - Load dashboard summary
   - Load registered users
   - Load individual user details
   - Mark a user's Offer as Paid

   Security:
   - Sole Admin: casinobuzzbd@gmail.com
   - Client-side email checking is convenience only
   - Firestore Security Rules are the final authority
   - Offer Paid data is stored separately from profileUsers
   - Ordinary users cannot read or write Offer Paid data

   Removed Admin systems:
   - Referral review
   - Referral rewards
   - Wallet
   - Withdrawal
   - Transactions
   - Audit logs
   - Device binding
   - Activity tracking
========================================================= */

(function initializeAdminAPI(window) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    /*
     * Compatibility metadata only.
     * No Cloud Functions are called.
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

    const PROFILE_STATUSES =
        Object.freeze([
            "active",
            "suspended",
            "blocked"
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

    /* =====================================================
       SUPPORTED OPERATIONS
    ===================================================== */

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

            MARK_OFFER_PAID:
                "markOfferPaid"
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

            [FUNCTION_NAMES.MARK_OFFER_PAID]:
                "markOfferPaid"
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
                String(
                    code ||
                    "unknown"
                );

            this.details =
                details;

            this.field =
                String(
                    field ||
                    ""
                );

            this.functionName =
                String(
                    functionName ||
                    ""
                );

            if (
                cause
            ) {
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
            Array.isArray(
                value
            )
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

        const normalized =
            String(
                value
            )
                .normalize(
                    "NFKC"
                )
                .trim();

        return (
            normalized ||
            fallback
        );
    }

    function normalizeEmail(
        value
    ) {
        return toSafeString(
            value
        )
            .toLowerCase();
    }

    function cloneValue(
        value
    ) {
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

    function toSafeLimit(
        value,
        fallback = DEFAULT_LIMIT
    ) {
        const numericValue =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numericValue
            )
        ) {
            return fallback;
        }

        return Math.min(
            MAXIMUM_LIMIT,
            Math.max(
                1,
                Math.floor(
                    numericValue
                )
            )
        );
    }

    function requireIdentifier(
        value,
        fieldName =
            "userId"
    ) {
        const identifier =
            toSafeString(
                value
            );

        if (
            !identifier
        ) {
            throw new TypeError(
                `${fieldName} is required.`
            );
        }

        if (
            identifier.length >
                1500 ||
            identifier.includes(
                "/"
            ) ||
            identifier === "." ||
            identifier === ".."
        ) {
            throw new TypeError(
                `${fieldName} is invalid.`
            );
        }

        return identifier;
    }

    function normalizePaginationCursor(
        value,
        fieldName =
            "cursor"
    ) {
        const cursor =
            toSafeString(
                value
            );

        if (
            !cursor
        ) {
            return "";
        }

        if (
            cursor.length >
                MAXIMUM_CURSOR_LENGTH ||
            cursor === "." ||
            cursor === ".." ||
            cursor.includes(
                "/"
            ) ||
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

    function normalizeProfileStatus(
        value
    ) {
        const status =
            toSafeString(
                value
            )
                .toLowerCase();

        if (
            !status
        ) {
            return "";
        }

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
            Object.keys(
                response
            ).length ===
                1
        ) {
            return response.data;
        }

        return response;
    }

    /* =====================================================
       ERROR NORMALIZATION
    ===================================================== */

    function normalizeError(
        error,
        functionName = ""
    ) {
        const rawCode =
            toSafeString(
                error?.code
            );

        const code =
            rawCode.includes(
                "/"
            )
                ? rawCode
                    .split(
                        "/"
                    )
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

        const message =
            toSafeString(
                details?.message ||
                error?.message
            ) ||
            "The Admin operation could not be completed.";

        return Object.freeze({
            code:
                code ||
                "unknown",

            message,

            details,

            field,

            functionName:
                toSafeString(
                    functionName
                )
        });
    }

    /* =====================================================
       STATE EVENTS
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
       FUNCTIONS CLIENT
    ===================================================== */

    function requireFunctionsClient() {
        const client =
            window.FunctionsClient ||
            null;

        if (
            !client
        ) {
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
         * The explicit FunctionsClient method is preferred.
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
         * Compatibility fallback.
         *
         * FunctionsClient.call() is still direct-Firestore
         * client routing. No deployed Cloud Function is used.
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
       GENERIC INVOCATION
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
            isPlainObject(
                payload
            )
                ? payload
                : {};

        if (
            !state.initialized
        ) {
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
                            result.error
                                ?.message
                        ) ||
                        "The Admin operation was not successful."
                    );

                operationError.code =
                    toSafeString(
                        result.code ||
                        result.error
                            ?.code
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
         * Fail immediately if the shared client was not loaded.
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
       ADMIN IDENTITY
    ===================================================== */

    function isSoleAdminEmail(
        email
    ) {
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
            isPlainObject(
                options
            )
                ? options
                : {};

        const payload = {
            limit:
                toSafeLimit(
                    source.limit
                )
        };

        const status =
            normalizeProfileStatus(
                source.status
            );

        if (
            status
        ) {
            payload.status =
                status;
        }

        const cursor =
            normalizePaginationCursor(
                source.cursor
            );

        if (
            cursor
        ) {
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
            isPlainObject(
                options
            )
                ? options
                : {};

        const payload = {
            userId:
                requireIdentifier(
                    userId,
                    "userId"
                )
        };

        if (
            source.limit !==
                undefined
        ) {
            payload.limit =
                toSafeLimit(
                    source.limit
                );
        }

        return invokeCallable(
            FUNCTION_NAMES
                .GET_USER_DETAILS,
            payload
        );
    }

    /* =====================================================
       OFFER PAID

       Admin marks the Offer as paid only after the actual
       Offer has been provided to the user.

       There is intentionally no "unpaid" operation.
    ===================================================== */

    function markOfferPaid(
        userId
    ) {
        const source =
            isPlainObject(
                userId
            )
                ? userId
                : {
                    userId
                };

        const targetUserId =
            requireIdentifier(
                source.userId ||
                source.uid,
                "userId"
            );

        return invokeCallable(
            FUNCTION_NAMES
                .MARK_OFFER_PAID,
            {
                userId:
                    targetUserId
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

            /* -----------------------------
               Session
            ----------------------------- */

            getAdminSession,

            verifySession:
                getAdminSession,

            /* -----------------------------
               Dashboard
            ----------------------------- */

            getAdminDashboardSummary,

            getDashboardSummary:
                getAdminDashboardSummary,

            /* -----------------------------
               Users
            ----------------------------- */

            getAdminUsers,

            getUsers:
                getAdminUsers,

            getAdminUserDetails,

            getUserDetails:
                getAdminUserDetails,

            /* -----------------------------
               Offer
            ----------------------------- */

            markOfferPaid,

            setOfferPaid:
                markOfferPaid,

            /* -----------------------------
               Identity
            ----------------------------- */

            isSoleAdminEmail,

            /* -----------------------------
               Constants / Errors
            ----------------------------- */

            AdminAPIError,

            SOLE_ADMIN_EMAIL,

            REGION,

            EVENTS,

            FUNCTION_NAMES,

            PROFILE_STATUSES
        });
})(
    window
);