"use strict";

/* =========================================================
   11PLAY — ADMIN USERS MODULE
   File: admin/js/admin.users.js

   Responsibilities:
   - Load registered users through AdminAPI
   - Search loaded users
   - Filter loaded users by account status
   - Support cursor-based pagination
   - Load complete user details
   - Show Profile information as read-only
   - Show Admin-only Offer Paid status
   - Allow Admin to mark Offer Paid
   - Never access Firestore directly

   Admin user list:
   - Name
   - Username
   - Gmail
   - Mobile
   - Registration Date
   - Last Login
   - Account Status
   - Offer Status
   - Offer Paid action

   Security:
   - User identity is read-only
   - Mobile is read-only to Admin
   - Offer Paid data comes from Admin-only collection
   - Regular users cannot access Offer Paid data
   - Once Offer Paid is marked, this UI has no Unpaid action
   - Firestore Security Rules remain the final authority

   Removed:
   - Referral management
   - Wallet adjustment
   - Withdrawal management
   - Activity tracking
   - Device binding
   - Reward management
========================================================= */

(function initializeAdminUsers(
    window,
    document
) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const DEFAULT_LIMIT =
        50;

    const MAX_LIMIT =
        100;

    const ALLOWED_STATUSES =
        Object.freeze([
            "",
            "active",
            "suspended",
            "blocked"
        ]);

    const EVENTS =
        Object.freeze({
            UPDATED:
                "admin-users:updated",

            LOADING:
                "admin-users:loading",

            ERROR:
                "admin-users:error",

            USER_SELECTED:
                "admin-users:user-selected",

            OFFER_PAID:
                "admin-users:offer-paid"
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

        loadingDetails:
            false,

        users:
            [],

        visibleUsers:
            [],

        selectedUserId:
            "",

        selectedUser:
            null,

        markingOfferPaidUserId:
            "",

        searchQuery:
            "",

        statusFilter:
            "",

        limit:
            DEFAULT_LIMIT,

        total:
            0,

        nextCursor:
            "",

        hasMore:
            false,

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

        totals:
            [],

        searchInput:
            null,

        statusFilter:
            null,

        loadMoreButton:
            null,

        refreshButtons:
            [],

        detailsPanel:
            null
    };

    let requestSequence =
        0;

    let detailSequence =
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

    function toString(
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

    function toNumber(
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
        const number =
            toNumber(
                value,
                fallback
            );

        if (
            !Number.isFinite(number)
        ) {
            return fallback;
        }

        return Math.max(
            0,
            Math.floor(number)
        );
    }

    function toLimit(value) {
        return Math.min(
            MAX_LIMIT,

            Math.max(
                1,
                Math.floor(
                    toNumber(
                        value,
                        DEFAULT_LIMIT
                    )
                )
            )
        );
    }

    function clone(value) {
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

    function normalizeEmail(value) {
        return toString(
            value
        )
            .toLowerCase();
    }

    function deriveUsername(
        explicitUsername,
        email
    ) {
        const normalizedEmail =
            normalizeEmail(
                email
            );

        if (
            normalizedEmail.includes(
                "@"
            )
        ) {
            return normalizedEmail
                .split("@")[0];
        }

        return toString(
            explicitUsername
        );
    }

    function normalizeStatus(value) {
        const status =
            toString(
                value
            )
                .toLowerCase();

        return ALLOWED_STATUSES
            .includes(status)
                ? status
                : "";
    }

    function getStatusLabel(status) {
        switch (
            normalizeStatus(status)
        ) {
            case "suspended":
                return "Suspended";

            case "blocked":
                return "Blocked";

            case "active":
            default:
                return "Active";
        }
    }

    function requireUserId(value) {
        const userId =
            toString(
                value
            );

        if (
            !userId
        ) {
            throw new TypeError(
                "userId is required."
            );
        }

        if (
            userId.length >
                1500 ||
            userId.includes("/") ||
            userId === "." ||
            userId === ".."
        ) {
            throw new TypeError(
                "userId is invalid."
            );
        }

        return userId;
    }

    function serializeTimestamp(value) {
        if (
            !value
        ) {
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
                new Date(
                    value
                );

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

    function formatDate(value) {
        const timestamp =
            serializeTimestamp(
                value
            );

        if (
            !timestamp
        ) {
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
                new Date(
                    timestamp
                )
            );
        } catch {
            return "—";
        }
    }

    function normalizePhotoURL(value) {
        const photoURL =
            toString(
                value
            );

        if (
            !photoURL
        ) {
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

    function escapeHTML(value) {
        return toString(
            value
        )
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

    function normalizeError(error) {
        const rawCode =
            toString(
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
                toString(
                    error?.message
                ) ||
                "User operation could not be completed.",

            details:
                error?.details ||
                error?.data ||
                null
        });
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

        return getAdminAPI()
            .getAdminSession();
    }

    /* =====================================================
       RESULT EXTRACTION
    ===================================================== */

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

    /* =====================================================
       OFFER STATUS NORMALIZATION
    ===================================================== */

    function normalizeOfferStatus(
        source,
        profile
    ) {
        const offerSource =
            isPlainObject(
                source.offerStatus
            )
                ? source.offerStatus
                : isPlainObject(
                    source.profileOfferStatus
                )
                    ? source.profileOfferStatus
                    : isPlainObject(
                        source.offer
                    )
                        ? source.offer
                        : isPlainObject(
                            profile.offerStatus
                        )
                            ? profile.offerStatus
                            : {};

        const offerPaid =
            source.offerPaid ===
                true ||
            profile.offerPaid ===
                true ||
            offerSource.offerPaid ===
                true ||
            offerSource.paid ===
                true;

        return {
            offerPaid,

            status:
                offerPaid
                    ? "paid"
                    : "unpaid",

            label:
                offerPaid
                    ? "PAID"
                    : "UNPAID",

            offerPaidAt:
                serializeTimestamp(
                    source.offerPaidAt ||
                    profile.offerPaidAt ||
                    offerSource.offerPaidAt ||
                    offerSource.paidAt
                ),

            offerPaidByUid:
                toString(
                    source.offerPaidByUid ||
                    profile.offerPaidByUid ||
                    offerSource.offerPaidByUid ||
                    offerSource.paidByUid
                ),

            offerPaidByEmail:
                normalizeEmail(
                    source.offerPaidByEmail ||
                    profile.offerPaidByEmail ||
                    offerSource.offerPaidByEmail ||
                    offerSource.paidByEmail
                )
        };
    }

    /* =====================================================
       USER NORMALIZATION
    ===================================================== */

    function normalizeUser(
        user,
        fallbackId = ""
    ) {
        const source =
            isPlainObject(
                user
            )
                ? user
                : {};

        const profile =
            isPlainObject(
                source.profile
            )
                ? source.profile
                : source;

        const uid =
            toString(
                profile.uid ||
                profile.userId ||
                source.uid ||
                source.userId ||
                profile.id ||
                source.id ||
                fallbackId
            );

        const email =
            normalizeEmail(
                profile.email ||
                source.email
            );

        const username =
            deriveUsername(
                profile.username ||
                source.username,
                email
            );

        const displayName =
            toString(
                profile.displayName ||
                profile.name ||
                source.displayName ||
                source.name ||
                username
            );

        const status =
            normalizeStatus(
                profile.status ||
                source.status
            ) ||
            "active";

        const offer =
            normalizeOfferStatus(
                source,
                profile
            );

        return {
            id:
                uid,

            uid,

            name:
                displayName,

            displayName,

            username,

            email,

            photoURL:
                normalizePhotoURL(
                    profile.photoURL ||
                    profile.photo ||
                    source.photoURL ||
                    source.photo
                ),

            mobileNumber:
                toString(
                    profile.mobileNumber ||
                    source.mobileNumber ||
                    profile.mobile ||
                    source.mobile
                ),

            registrationDate:
                serializeTimestamp(
                    profile.registrationDate ||
                    source.registrationDate ||
                    profile.createdAt ||
                    source.createdAt
                ),

            lastLogin:
                serializeTimestamp(
                    profile.lastLogin ||
                    source.lastLogin ||
                    profile.lastLoginAt ||
                    source.lastLoginAt
                ),

            lastLoginAt:
                serializeTimestamp(
                    profile.lastLoginAt ||
                    source.lastLoginAt ||
                    profile.lastLogin ||
                    source.lastLogin
                ),

            status,

            statusLabel:
                getStatusLabel(
                    status
                ),

            offerPaid:
                offer.offerPaid,

            offerStatus:
                offer.status,

            offerStatusLabel:
                offer.label,

            offerPaidAt:
                offer.offerPaidAt,

            offerPaidByUid:
                offer.offerPaidByUid,

            offerPaidByEmail:
                offer.offerPaidByEmail,

            raw:
                clone(
                    source
                )
        };
    }

    function normalizeUsers(users) {
        return Array.isArray(
            users
        )
            ? users.map(
                user =>
                    normalizeUser(
                        user,
                        user?.id ||
                        user?.uid
                    )
            )
            : [];
    }

    function mergeUniqueUsers(
        existingUsers,
        incomingUsers
    ) {
        const usersById =
            new Map();

        [
            ...(Array.isArray(
                existingUsers
            )
                ? existingUsers
                : []),

            ...(Array.isArray(
                incomingUsers
            )
                ? incomingUsers
                : [])
        ].forEach(
            user => {
                const userId =
                    toString(
                        user?.uid ||
                        user?.id
                    );

                if (
                    userId
                ) {
                    usersById.set(
                        userId,
                        user
                    );
                }
            }
        );

        return Array.from(
            usersById.values()
        );
    }

    /* =====================================================
       STATE / EVENTS
    ===================================================== */

    function getState() {
        return clone(
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
                        clone(
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
            listener => {
                try {
                    listener(
                        snapshot
                    );
                } catch (error) {
                    console.error(
                        "[AdminUsers] Subscriber failed.",
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
                "[data-admin-users]"
            );

        elements.tableBody =
            document.querySelector(
                "[data-admin-users-body]"
            );

        elements.loadingState =
            document.querySelector(
                "[data-admin-users-loading]"
            );

        elements.emptyState =
            document.querySelector(
                "[data-admin-users-empty]"
            );

        elements.errorState =
            document.querySelector(
                "[data-admin-users-error]"
            );

        elements.errorMessage =
            document.querySelector(
                "[data-admin-users-error-message]"
            );

        elements.totals =
            queryAll(
                "[data-admin-users-total]"
            );

        elements.searchInput =
            document.querySelector(
                "[data-admin-users-search]"
            );

        elements.statusFilter =
            document.querySelector(
                "[data-admin-users-status]"
            );

        elements.loadMoreButton =
            document.querySelector(
                "[data-admin-users-load-more]"
            );

        elements.refreshButtons =
            queryAll(
                "[data-admin-users-refresh]"
            );

        elements.detailsPanel =
            document.querySelector(
                "[data-admin-user-details]"
            );
    }

    function setVisible(
        element,
        visible
    ) {
        if (
            !element
        ) {
            return;
        }

        element.hidden =
            visible !==
            true;

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
        if (
            !element
        ) {
            return;
        }

        element.disabled =
            disabled ===
            true;

        element.setAttribute(
            "aria-disabled",
            disabled
                ? "true"
                : "false"
        );
    }

    function showToast(
        message,
        type =
            "success"
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
       USERS TABLE
    ===================================================== */

    function createUserRow(user) {
        const safePhotoURL =
            normalizePhotoURL(
                user.photoURL
            );

        const avatar =
            safePhotoURL
                ? `
                    <img
                        src="${escapeHTML(
                            safePhotoURL
                        )}"
                        alt="${escapeHTML(
                            user.displayName ||
                            "User"
                        )}"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                    >
                `
                : `
                    <span aria-hidden="true">
                        ${escapeHTML(
                            (
                                user.displayName ||
                                user.username ||
                                user.email ||
                                "U"
                            )
                                .charAt(0)
                                .toUpperCase()
                        )}
                    </span>
                `;

        const markingPaid =
            state
                .markingOfferPaidUserId ===
            user.uid;

        const offerAction =
            user.offerPaid
                ? `
                    <span
                        class="admin-status-badge is-paid"
                    >
                        PAID
                    </span>
                `
                : `
                    <button
                        type="button"
                        data-admin-user-offer-paid="${escapeHTML(
                            user.uid
                        )}"
                        ${markingPaid
                            ? "disabled"
                            : ""}
                    >
                        ${markingPaid
                            ? "Saving..."
                            : "Offer Paid"}
                    </button>
                `;

        return `
            <tr
                data-admin-user-row="${escapeHTML(
                    user.uid
                )}"
            >
                <td>
                    <button
                        type="button"
                        class="admin-user-identity"
                        data-admin-user-open="${escapeHTML(
                            user.uid
                        )}"
                    >
                        <span class="admin-user-avatar">
                            ${avatar}
                        </span>

                        <span class="admin-user-text">
                            <strong>
                                ${escapeHTML(
                                    user.displayName ||
                                    "Unnamed User"
                                )}
                            </strong>
                        </span>
                    </button>
                </td>

                <td>
                    ${escapeHTML(
                        user.username ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        user.email ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        user.mobileNumber ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        formatDate(
                            user.registrationDate
                        )
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        formatDate(
                            user.lastLoginAt
                        )
                    )}
                </td>

                <td>
                    <span
                        class="admin-status-badge is-${escapeHTML(
                            user.status
                        )}"
                    >
                        ${escapeHTML(
                            user.statusLabel
                        )}
                    </span>
                </td>

                <td>
                    <span
                        class="admin-status-badge ${
                            user.offerPaid
                                ? "is-paid"
                                : "is-unpaid"
                        }"
                    >
                        ${escapeHTML(
                            user.offerStatusLabel
                        )}
                    </span>
                </td>

                <td>
                    ${offerAction}

                    <button
                        type="button"
                        data-admin-user-open="${escapeHTML(
                            user.uid
                        )}"
                    >
                        View
                    </button>
                </td>
            </tr>
        `;
    }

    function renderUsers() {
        if (
            elements.tableBody
        ) {
            elements.tableBody
                .innerHTML =
                state.visibleUsers
                    .map(
                        createUserRow
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
            state.visibleUsers
                .length ===
                0
        );

        elements.totals
            .forEach(
                element => {
                    element.textContent =
                        String(
                            state.total
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
                state.loading
            );
        }

        elements.refreshButtons
            .forEach(
                button => {
                    setDisabled(
                        button,
                        state.loading
                    );
                }
            );

        elements.root
            ?.setAttribute(
                "aria-busy",
                state.loading
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
       DETAILS
    ===================================================== */

    function setText(
        selector,
        value
    ) {
        queryAll(
            selector
        ).forEach(
            element => {
                element.textContent =
                    toString(
                        value
                    ) ||
                    "—";
            }
        );
    }

    function renderSelectedUser() {
        const user =
            state.selectedUser;

        setVisible(
            elements.detailsPanel,
            Boolean(
                user
            )
        );

        elements.detailsPanel
            ?.setAttribute(
                "aria-busy",
                state.loadingDetails
                    ? "true"
                    : "false"
            );

        if (
            !user
        ) {
            return;
        }

        setText(
            "[data-admin-user-detail-name]",
            user.displayName
        );

        setText(
            "[data-admin-user-detail-username]",
            user.username
        );

        setText(
            "[data-admin-user-detail-email]",
            user.email
        );

        setText(
            "[data-admin-user-detail-uid]",
            user.uid
        );

        setText(
            "[data-admin-user-detail-mobile]",
            user.mobileNumber
        );

        setText(
            "[data-admin-user-detail-registration]",
            formatDate(
                user.registrationDate
            )
        );

        setText(
            "[data-admin-user-detail-last-login]",
            formatDate(
                user.lastLoginAt
            )
        );

        setText(
            "[data-admin-user-detail-status]",
            user.statusLabel
        );

        setText(
            "[data-admin-user-detail-offer-status]",
            user.offerStatusLabel
        );

        setText(
            "[data-admin-user-detail-offer-paid-at]",
            formatDate(
                user.offerPaidAt
            )
        );

        setText(
            "[data-admin-user-detail-offer-paid-by]",
            user.offerPaidByEmail ||
            user.offerPaidByUid
        );

        queryAll(
            "[data-admin-user-detail-photo]"
        ).forEach(
            element => {
                if (
                    element.tagName !==
                        "IMG"
                ) {
                    return;
                }

                if (
                    user.photoURL
                ) {
                    element.src =
                        user.photoURL;

                    element.referrerPolicy =
                        "no-referrer";
                } else {
                    element.removeAttribute(
                        "src"
                    );
                }

                element.alt =
                    user.displayName ||
                    "User";
            }
        );

        queryAll(
            "[data-admin-user-detail-offer-paid-action]"
        ).forEach(
            button => {
                button.dataset
                    .adminUserOfferPaid =
                    user.uid;

                button.textContent =
                    user.offerPaid
                        ? "PAID"
                        : (
                            state
                                .markingOfferPaidUserId ===
                            user.uid
                                ? "Saving..."
                                : "Offer Paid"
                        );

                setDisabled(
                    button,
                    user.offerPaid ||
                    state
                        .markingOfferPaidUserId ===
                        user.uid
                );
            }
        );
    }

    /* =====================================================
       FILTERS
    ===================================================== */

    function applyFilters() {
        const searchQuery =
            state.searchQuery
                .toLowerCase();

        const statusFilter =
            state.statusFilter;

        state.visibleUsers =
            state.users.filter(
                user => {
                    if (
                        statusFilter &&
                        user.status !==
                            statusFilter
                    ) {
                        return false;
                    }

                    if (
                        !searchQuery
                    ) {
                        return true;
                    }

                    return [
                        user.uid,
                        user.displayName,
                        user.username,
                        user.email,
                        user.mobileNumber,
                        user.status,
                        user.offerStatusLabel
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(
                            searchQuery
                        );
                }
            );

        renderUsers();

        return clone(
            state.visibleUsers
        );
    }

    function setSearchQuery(value) {
        state.searchQuery =
            toString(
                value
            );

        applyFilters();
        notify();

        return getState();
    }

    function setStatusFilter(value) {
        state.statusFilter =
            normalizeStatus(
                value
            );

        applyFilters();
        notify();

        return getState();
    }

    /* =====================================================
       LOAD USERS
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
            toLimit(
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

        if (
            !append
        ) {
            state.nextCursor =
                "";

            state.hasMore =
                false;
        }

        clearError();

        renderUsers();
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

            /*
             * Status filtering is intentionally done in this
             * module after loading.
             *
             * This keeps the Firestore query simple and avoids
             * requiring a composite status/date index.
             */

            const result =
                await getAdminAPI()
                    .getAdminUsers(
                        payload
                    );

            if (
                currentRequest !==
                    requestSequence
            ) {
                return getState();
            }

            const resultUsers =
                extractResultValue(
                    result,
                    "users",
                    extractResultValue(
                        result,
                        "items",
                        Array.isArray(
                            result?.data
                        )
                            ? result.data
                            : []
                    )
                );

            const pageUsers =
                normalizeUsers(
                    resultUsers
                );

            state.users =
                append
                    ? mergeUniqueUsers(
                        state.users,
                        pageUsers
                    )
                    : pageUsers;

            state.total =
                toInteger(
                    extractResultValue(
                        result,
                        "total",
                        extractResultValue(
                            result,
                            "count",
                            state.users.length
                        )
                    ),
                    state.users.length
                );

            const nextCursor =
                toString(
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
                ) ===
                true;

            state.nextCursor =
                hasMore
                    ? nextCursor
                    : "";

            state.hasMore =
                hasMore &&
                Boolean(
                    nextCursor
                );

            state.lastUpdatedAt =
                new Date()
                    .toISOString();

            clearError();

            applyFilters();
            renderError();

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

                renderUsers();
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
       USER DETAILS
    ===================================================== */

    async function openUserDetails(
        userId
    ) {
        await requireAdminAccess();

        const uid =
            requireUserId(
                userId
            );

        const currentRequest =
            ++detailSequence;

        state.selectedUserId =
            uid;

        state.loadingDetails =
            true;

        clearError();

        const cachedUser =
            state.users.find(
                user =>
                    user.uid ===
                    uid
            );

        if (
            cachedUser
        ) {
            state.selectedUser =
                clone(
                    cachedUser
                );

            renderSelectedUser();

            notify(
                EVENTS.USER_SELECTED
            );
        }

        try {
            const result =
                await getAdminAPI()
                    .getAdminUserDetails(
                        uid
                    );

            if (
                currentRequest !==
                    detailSequence
            ) {
                return null;
            }

            const root =
                result?.data &&
                isPlainObject(
                    result.data
                )
                    ? result.data
                    : result;

            const profile =
                root?.user ||
                root?.profile ||
                {};

            const normalizedSource = {
                ...(
                    isPlainObject(
                        profile
                    )
                        ? profile
                        : {}
                ),

                profile:
                    isPlainObject(
                        profile
                    )
                        ? profile
                        : {},

                offerStatus:
                    root?.offerStatus ||
                    root?.profileOfferStatus ||
                    root?.offer ||
                    profile?.offerStatus,

                offerPaid:
                    root?.offerPaid,

                offerPaidAt:
                    root?.offerPaidAt,

                offerPaidByUid:
                    root?.offerPaidByUid,

                offerPaidByEmail:
                    root?.offerPaidByEmail
            };

            state.selectedUser =
                normalizeUser(
                    normalizedSource,
                    uid
                );

            state.selectedUser
                .rawDetails =
                clone(
                    result
                );

            renderSelectedUser();

            notify(
                EVENTS.USER_SELECTED
            );

            return clone(
                state.selectedUser
            );
        } catch (error) {
            if (
                currentRequest ===
                    detailSequence
            ) {
                setError(
                    error
                );
            }

            throw error;
        } finally {
            if (
                currentRequest ===
                    detailSequence
            ) {
                state.loadingDetails =
                    false;

                renderSelectedUser();
                notify();
            }
        }
    }

    function closeUserDetails() {
        detailSequence +=
            1;

        state.selectedUserId =
            "";

        state.selectedUser =
            null;

        state.loadingDetails =
            false;

        renderSelectedUser();
        notify();

        return getState();
    }

    /* =====================================================
       OFFER PAID
    ===================================================== */

    async function markOfferPaid(
        userId
    ) {
        await requireAdminAccess();

        const uid =
            requireUserId(
                userId ||
                state.selectedUserId
            );

        if (
            state.markingOfferPaidUserId
        ) {
            throw new Error(
                "Another Offer Paid operation is already in progress."
            );
        }

        const existingUser =
            state.users.find(
                user =>
                    user.uid ===
                    uid
            ) ||
            (
                state.selectedUser
                    ?.uid ===
                uid
                    ? state.selectedUser
                    : null
            );

        if (
            existingUser
                ?.offerPaid ===
                true
        ) {
            return {
                success:
                    true,

                alreadyPaid:
                    true,

                userId:
                    uid
            };
        }

        state.markingOfferPaidUserId =
            uid;

        clearError();

        renderUsers();
        renderSelectedUser();
        notify();

        try {
            const result =
                await getAdminAPI()
                    .markOfferPaid(
                        uid
                    );

            /*
             * Update local state immediately.
             */

            state.users =
                state.users.map(
                    user =>
                        user.uid ===
                        uid
                            ? {
                                ...user,

                                offerPaid:
                                    true,

                                offerStatus:
                                    "paid",

                                offerStatusLabel:
                                    "PAID"
                            }
                            : user
                );

            if (
                state.selectedUser
                    ?.uid ===
                uid
            ) {
                state.selectedUser = {
                    ...state.selectedUser,

                    offerPaid:
                        true,

                    offerStatus:
                        "paid",

                    offerStatusLabel:
                        "PAID"
                };
            }

            applyFilters();
            renderSelectedUser();

            const detail = {
                userId:
                    uid,

                result,

                message:
                    "Offer marked as PAID."
            };

            dispatch(
                EVENTS.OFFER_PAID,
                detail
            );

            showToast(
                detail.message
            );

            /*
             * Refresh authoritative Admin data afterward.
             */

            await refresh({
                limit:
                    state.limit
            });

            if (
                state.selectedUserId ===
                uid
            ) {
                await openUserDetails(
                    uid
                );
            }

            return result;
        } catch (error) {
            setError(
                error
            );

            throw error;
        } finally {
            state.markingOfferPaidUserId =
                "";

            renderUsers();
            renderSelectedUser();
            notify();
        }
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

        const offerPaidButton =
            event.target.closest(
                "[data-admin-user-offer-paid]"
            );

        if (
            offerPaidButton
        ) {
            event.preventDefault();

            const uid =
                offerPaidButton.dataset
                    .adminUserOfferPaid;

            void markOfferPaid(
                uid
            ).catch(
                error => {
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

        const openButton =
            event.target.closest(
                "[data-admin-user-open]"
            );

        if (
            openButton
        ) {
            event.preventDefault();

            void openUserDetails(
                openButton.dataset
                    .adminUserOpen
            ).catch(
                error => {
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
                "[data-admin-user-details-close]"
            )
        ) {
            event.preventDefault();

            closeUserDetails();

            return;
        }

        if (
            event.target.closest(
                "[data-admin-users-refresh]"
            )
        ) {
            event.preventDefault();

            void refresh()
                .catch(
                    error => {
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
                "[data-admin-users-load-more]"
            )
        ) {
            event.preventDefault();

            void loadMore()
                .catch(
                    error => {
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

    function handleDocumentInput(event) {
        if (
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        if (
            event.target.matches(
                "[data-admin-users-search]"
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
                "[data-admin-users-status]"
            )
        ) {
            setStatusFilter(
                event.target.value
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

            applyFilters();
            renderSelectedUser();
            renderError();

            return getState();
        }

        state.initialized =
            true;

        cacheElements();
        bindEvents();

        state.searchQuery =
            toString(
                elements.searchInput
                    ?.value
            );

        state.statusFilter =
            normalizeStatus(
                elements.statusFilter
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

    function subscribe(listener) {
        if (
            typeof listener !==
                "function"
        ) {
            throw new TypeError(
                "AdminUsers subscriber must be a function."
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

        detailSequence +=
            1;

        controller?.abort();

        controller =
            null;

        listeners.clear();

        state.initialized =
            false;

        state.loading =
            false;

        state.loadingDetails =
            false;

        state.users =
            [];

        state.visibleUsers =
            [];

        state.selectedUserId =
            "";

        state.selectedUser =
            null;

        state.markingOfferPaidUserId =
            "";

        state.searchQuery =
            "";

        state.statusFilter =
            "";

        state.limit =
            DEFAULT_LIMIT;

        state.total =
            0;

        state.nextCursor =
            "";

        state.hasMore =
            false;

        state.lastUpdatedAt =
            null;

        state.error =
            null;

        Object.keys(
            elements
        ).forEach(
            key => {
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

    window.AdminUsers =
        Object.freeze({
            init,
            destroy,

            refresh,
            loadMore,

            setSearchQuery,
            setStatusFilter,

            openUserDetails,
            closeUserDetails,

            markOfferPaid,

            getState,

            getUsers() {
                return clone(
                    state.users
                );
            },

            getVisibleUsers() {
                return clone(
                    state.visibleUsers
                );
            },

            getSelectedUser() {
                return clone(
                    state.selectedUser
                );
            },

            normalizeUser,
            normalizeUsers,
            normalizeStatus,
            getStatusLabel,

            formatDate,

            subscribe,

            EVENTS,
            ALLOWED_STATUSES
        });
})(
    window,
    document
);