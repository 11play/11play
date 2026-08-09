"use strict";

/* =========================================================
   11PLAY — ADMIN AUTHENTICATION CLIENT
   File: admin/js/admin.auth.js

   Responsibilities:
   - Protect direct /admin/ access
   - Show Google Sign-In when signed out
   - Permit exactly one verified Google account
   - Verify the current sign-in provider from the ID token
   - Verify Admin authorization through getAdminSession
   - Block and redirect unauthorized accounts
   - Support Admin logout
   - Publish authentication state events

   Sole Admin:
   casinobuzzbd@gmail.com

   Security:
   - No separate Admin password
   - No Super Admin
   - No custom claims
   - No Firestore Admin assignment
   - Backend security remains the final authority
========================================================= */

(function initializeAdminAuth(
    window,
    document
) {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const SOLE_ADMIN_EMAIL =
        "casinobuzzbd@gmail.com";

    const GOOGLE_PROVIDER_ID =
        "google.com";

    const ACCESS_DENIED_REDIRECT_DELAY_MS =
        1800;

    const EVENTS =
        Object.freeze({
            STATE_CHANGED:
                "admin-auth:state-changed",

            READY:
                "admin-auth:ready",

            SIGNED_OUT:
                "admin-auth:signed-out",

            CHECKING:
                "admin-auth:checking",

            AUTHORIZED:
                "admin-auth:authorized",

            ACCESS_DENIED:
                "admin-auth:access-denied",

            LOGIN_STARTED:
                "admin-auth:login-started",

            LOGIN_SUCCESS:
                "admin-auth:login-success",

            LOGIN_ERROR:
                "admin-auth:login-error",

            LOGOUT_STARTED:
                "admin-auth:logout-started",

            LOGOUT_COMPLETED:
                "admin-auth:logout-completed",

            REDIRECTING:
                "admin-auth:redirecting",

            ERROR:
                "admin-auth:error"
        });

    const STATUS =
        Object.freeze({
            IDLE:
                "idle",

            CHECKING:
                "checking",

            SIGNED_OUT:
                "signed_out",

            AUTHORIZED:
                "authorized",

            ACCESS_DENIED:
                "access_denied",

            ERROR:
                "error"
        });

    /* =====================================================
       ERROR TYPE
    ===================================================== */

    class AdminAuthError extends Error {
        constructor({
            code = "unknown",
            message =
                "Admin authentication failed.",
            details = null,
            cause = null
        } = {}) {
            super(message);

            this.name =
                "AdminAuthError";

            this.code =
                code;

            this.details =
                details;

            if (cause) {
                this.cause =
                    cause;
            }
        }
    }

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const listeners =
        new Set();

    const state = {
        initialized:
            false,

        ready:
            false,

        loading:
            false,

        loginInProgress:
            false,

        logoutInProgress:
            false,

        status:
            STATUS.IDLE,

        firebaseUser:
            null,

        admin:
            null,

        authorized:
            false,

        accessDenied:
            false,

        accessDeniedReason:
            "",

        redirecting:
            false,

        lastVerifiedAt:
            null,

        error:
            null
    };

    let authInstance =
        null;

    let authUnsubscribe =
        null;

    let browserController =
        null;

    let initPromise =
        null;

    let readyResolver =
        null;

    let loginPromise =
        null;

    let logoutPromise =
        null;

    let redirectTimer =
        null;

    let lifecycleGeneration =
        0;

    let authStateGeneration =
        0;

    let verificationGeneration =
        0;

    let verificationPromise =
        null;

    let verificationPromiseGeneration =
        0;

    let verificationUid =
        "";

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

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

    function normalizeError(error) {
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

        return Object.freeze({
            code:
                code ||
                "unknown",

            message:
                toSafeString(
                    error?.message
                ) ||
                "Admin authentication failed.",

            details:
                error?.details ||
                error?.data ||
                null
        });
    }

    function createAuthError(
        error,
        fallbackCode = "unknown"
    ) {
        if (
            error instanceof
            AdminAuthError
        ) {
            return error;
        }

        const normalizedError =
            normalizeError(
                error
            );

        return new AdminAuthError({
            code:
                normalizedError.code ||
                fallbackCode,

            message:
                normalizedError.message,

            details:
                normalizedError.details,

            cause:
                error
        });
    }

    function isPermissionError(error) {
        const normalizedError =
            normalizeError(
                error
            );

        const code =
            normalizedError.code
                .toLowerCase();

        const message =
            normalizedError.message
                .toLowerCase();

        return (
            code ===
                "permission-denied" ||
            code ===
                "permission_denied" ||
            message.includes(
                "permission denied"
            ) ||
            message.includes(
                "admin permission"
            ) ||
            message.includes(
                "not authorized"
            )
        );
    }

    function isPopupCancellation(error) {
        const code =
            normalizeError(
                error
            ).code;

        return [
            "popup-closed-by-user",
            "cancelled-popup-request"
        ].includes(code);
    }

    /* =====================================================
       USER NORMALIZATION
    ===================================================== */

    function getProviderIds(user) {
        if (!user) {
            return [];
        }

        if (
            Array.isArray(
                user.providerIds
            )
        ) {
            return user.providerIds
                .map(
                    (providerId) =>
                        toSafeString(
                            providerId
                        )
                )
                .filter(Boolean);
        }

        if (
            Array.isArray(
                user.providerData
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

    function normalizeSignInProvider(
        value
    ) {
        return toSafeString(
            value
        ).toLowerCase();
    }

    function normalizeFirebaseUser(
        user,
        signInProvider = ""
    ) {
        if (!user?.uid) {
            return null;
        }

        const providerIds =
            getProviderIds(
                user
            );

        const normalizedSignInProvider =
            normalizeSignInProvider(
                signInProvider ||
                user.signInProvider
            );

        return Object.freeze({
            uid:
                toSafeString(
                    user.uid
                ),

            email:
                normalizeEmail(
                    user.email
                ),

            displayName:
                toSafeString(
                    user.displayName ||
                    user.name
                ),

            photoURL:
                toSafeString(
                    user.photoURL ||
                    user.photo
                ),

            emailVerified:
                user.emailVerified ===
                    true,

            providerIds,

            signInProvider:
                normalizedSignInProvider,

            isGoogleConnected:
                providerIds.includes(
                    GOOGLE_PROVIDER_ID
                ),

            isGoogleSignIn:
                normalizedSignInProvider ===
                GOOGLE_PROVIDER_ID
        });
    }

    async function getTokenContext(
        firebaseUser
    ) {
        if (
            !firebaseUser ||
            typeof firebaseUser
                .getIdTokenResult !==
                "function"
        ) {
            throw new AdminAuthError({
                code:
                    "token-verification-unavailable",

                message:
                    "The current Google sign-in session could not be verified."
            });
        }

        const tokenResult =
            await firebaseUser
                .getIdTokenResult(
                    false
                );

        const signInProvider =
            normalizeSignInProvider(
                tokenResult
                    ?.signInProvider ||
                tokenResult
                    ?.claims
                    ?.firebase
                    ?.sign_in_provider
            );

        return Object.freeze({
            signInProvider,

            issuedAtTime:
                toSafeString(
                    tokenResult
                        ?.issuedAtTime
                ),

            expirationTime:
                toSafeString(
                    tokenResult
                        ?.expirationTime
                )
        });
    }

    function normalizeBackendAdmin(
        result
    ) {
        const source =
            result?.admin ||
            result?.session?.admin ||
            result?.session ||
            result ||
            {};

        const role =
            toSafeString(
                source.role
            ).toLowerCase();

        return Object.freeze({
            uid:
                toSafeString(
                    source.uid
                ),

            email:
                normalizeEmail(
                    source.email
                ),

            displayName:
                toSafeString(
                    source.displayName ||
                    source.name
                ),

            photoURL:
                toSafeString(
                    source.photoURL ||
                    source.photo
                ),

            role:
                role === "admin"
                    ? "admin"
                    : "",

            isAdmin:
                source.isAdmin ===
                    true ||
                role ===
                    "admin",

            isSuperAdmin:
                source.isSuperAdmin ===
                    true,

            authorizationSource:
                toSafeString(
                    source
                        .authorizationSource
                )
        });
    }

    /* =====================================================
       EVENTS AND STATE
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
        return cloneValue({
            initialized:
                state.initialized,

            ready:
                state.ready,

            loading:
                state.loading,

            loginInProgress:
                state.loginInProgress,

            logoutInProgress:
                state.logoutInProgress,

            status:
                state.status,

            firebaseUser:
                state.firebaseUser,

            admin:
                state.admin,

            authorized:
                state.authorized,

            accessDenied:
                state.accessDenied,

            accessDeniedReason:
                state.accessDeniedReason,

            redirecting:
                state.redirecting,

            lastVerifiedAt:
                state.lastVerifiedAt,

            error:
                state.error
        });
    }

    function notify(
        eventName =
            EVENTS.STATE_CHANGED
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
                        "[AdminAuth] Subscriber failed.",
                        error
                    );
                }
            }
        );

        dispatch(
            eventName,
            snapshot
        );

        if (
            eventName !==
            EVENTS.STATE_CHANGED
        ) {
            dispatch(
                EVENTS.STATE_CHANGED,
                snapshot
            );
        }
    }

    function clearError() {
        state.error =
            null;
    }

    function setErrorState(
        error,
        eventName = EVENTS.ERROR
    ) {
        state.error =
            normalizeError(
                error
            );

        state.loading =
            false;

        state.authorized =
            false;

        state.admin =
            null;

        state.status =
            STATUS.ERROR;

        notify(
            eventName
        );
    }

    function resetAuthorizationState() {
        state.admin =
            null;

        state.authorized =
            false;

        state.accessDenied =
            false;

        state.accessDeniedReason =
            "";

        state.redirecting =
            false;

        state.lastVerifiedAt =
            null;

        clearError();
    }

    function setSignedOutState(
        eventName = EVENTS.SIGNED_OUT
    ) {
        resetAuthorizationState();

        state.firebaseUser =
            null;

        state.loading =
            false;

        state.status =
            STATUS.SIGNED_OUT;

        notify(
            eventName
        );

        return getState();
    }

    function markReady() {
        if (state.ready) {
            return getState();
        }

        state.ready =
            true;

        const snapshot =
            getState();

        notify(
            EVENTS.READY
        );

        if (
            typeof readyResolver ===
            "function"
        ) {
            readyResolver(
                snapshot
            );

            readyResolver =
                null;
        }

        return snapshot;
    }

    /* =====================================================
       FIREBASE AUTH RESOLUTION
    ===================================================== */

    function resolveFirebaseAuth() {
        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth;

        if (configuredAuth) {
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
            } catch (error) {
                console.error(
                    "[AdminAuth] Firebase Auth resolution failed.",
                    error
                );
            }
        }

        return null;
    }

    function resolveCurrentFirebaseUser() {
        const auth =
            authInstance ||
            resolveFirebaseAuth();

        return (
            auth?.currentUser ||
            null
        );
    }

    function resolveRawFirebaseUser(
        user
    ) {
        if (
            user &&
            typeof user.getIdTokenResult ===
                "function"
        ) {
            return user;
        }

        const currentUser =
            resolveCurrentFirebaseUser();

        if (
            currentUser?.uid &&
            (
                !user?.uid ||
                currentUser.uid ===
                    user.uid
            )
        ) {
            return currentUser;
        }

        return null;
    }

    /* =====================================================
       ADMIN API RESOLUTION
    ===================================================== */

    function resolveAdminAPI() {
        const api =
            window.AdminAPI;

        if (!api) {
            throw new AdminAuthError({
                code:
                    "admin-api-unavailable",

                message:
                    "Admin API client is not available."
            });
        }

        if (
            typeof api.init ===
            "function"
        ) {
            api.init();
        }

        return api;
    }

    async function verifyThroughBackend() {
        const api =
            resolveAdminAPI();

        if (
            typeof api.getAdminSession ===
            "function"
        ) {
            return api
                .getAdminSession();
        }

        if (
            typeof api.verifySession ===
            "function"
        ) {
            return api
                .verifySession();
        }

        throw new AdminAuthError({
            code:
                "admin-session-function-unavailable",

            message:
                "Admin session verification is unavailable."
        });
    }

    /* =====================================================
       MAIN SITE REDIRECTION
    ===================================================== */

    function getMainSiteURL() {
        const configuredURL =
            toSafeString(
                document
                    .documentElement
                    ?.dataset
                    ?.mainSiteUrl
            );

        try {
            const destination =
                new URL(
                    configuredURL ||
                    "../",
                    window.location.href
                );

            if (
                ![
                    "http:",
                    "https:"
                ].includes(
                    destination.protocol
                )
            ) {
                throw new Error(
                    "Unsupported redirect protocol."
                );
            }

            return destination.href;
        } catch {
            return new URL(
                "../",
                window.location.href
            ).href;
        }
    }

    function clearRedirectTimer() {
        if (!redirectTimer) {
            return;
        }

        window.clearTimeout(
            redirectTimer
        );

        redirectTimer =
            null;
    }

    function redirectToMainSite(
        options = {}
    ) {
        const delay =
            Math.max(
                0,
                Number(
                    options.delay
                ) ||
                0
            );

        const reason =
            toSafeString(
                options.reason,
                "access_denied"
            );

        clearRedirectTimer();

        const destination =
            getMainSiteURL();

        const performRedirect =
            () => {
                redirectTimer =
                    null;

                state.redirecting =
                    true;

                if (
                    !state
                        .accessDeniedReason
                ) {
                    state.accessDeniedReason =
                        reason;
                }

                notify(
                    EVENTS.REDIRECTING
                );

                window.location.replace(
                    destination
                );
            };

        if (delay > 0) {
            redirectTimer =
                window.setTimeout(
                    performRedirect,
                    delay
                );
        } else {
            performRedirect();
        }

        return destination;
    }

    /* =====================================================
       ACCESS DENIED
    ===================================================== */

    function denyAccess(
        reason,
        options = {}
    ) {
        const redirect =
            options.redirect !==
            false;

        const redirectDelay =
            Number.isFinite(
                Number(
                    options.redirectDelay
                )
            )
                ? Math.max(
                    0,
                    Number(
                        options
                            .redirectDelay
                    )
                )
                : ACCESS_DENIED_REDIRECT_DELAY_MS;

        const normalizedReason =
            toSafeString(
                reason,
                "not_authorized"
            );

        state.loading =
            false;

        state.status =
            STATUS.ACCESS_DENIED;

        state.admin =
            null;

        state.authorized =
            false;

        state.accessDenied =
            true;

        state.accessDeniedReason =
            normalizedReason;

        state.redirecting =
            false;

        state.lastVerifiedAt =
            null;

        state.error =
            Object.freeze({
                code:
                    "permission-denied",

                message:
                    "Access Denied. This Google account is not authorized for the Admin Dashboard.",

                details: {
                    reason:
                        normalizedReason
                }
            });

        notify(
            EVENTS.ACCESS_DENIED
        );

        if (redirect) {
            redirectToMainSite({
                delay:
                    redirectDelay,

                reason:
                    normalizedReason
            });
        }

        return getState();
    }

    /* =====================================================
       ADMIN ACCOUNT CHECKS
    ===================================================== */

    function isSoleAdminEmail(email) {
        return (
            normalizeEmail(
                email
            ) ===
            SOLE_ADMIN_EMAIL
        );
    }

    function isGoogleAccount(user) {
        return getProviderIds(
            user
        ).includes(
            GOOGLE_PROVIDER_ID
        );
    }

    function isVerifiedAdminCandidate(
        user
    ) {
        if (!user?.uid) {
            return false;
        }

        const currentStateUser =
            state.firebaseUser?.uid ===
                user.uid
                ? state.firebaseUser
                : null;

        const normalizedUser =
            normalizeFirebaseUser(
                user,
                currentStateUser
                    ?.signInProvider ||
                user.signInProvider
            );

        return Boolean(
            normalizedUser &&
            normalizedUser.email ===
                SOLE_ADMIN_EMAIL &&
            normalizedUser
                .emailVerified ===
                true &&
            normalizedUser
                .isGoogleConnected ===
                true &&
            normalizedUser
                .isGoogleSignIn ===
                true
        );
    }

    /* =====================================================
       ADMIN SESSION VERIFICATION
    ===================================================== */

    async function verifyAdminSession(
        user = null,
        options = {}
    ) {
        const redirectOnDenied =
            options.redirectOnDenied !==
            false;

        const firebaseUser =
            resolveRawFirebaseUser(
                user
            );

        if (!firebaseUser?.uid) {
            return setSignedOutState();
        }

        if (
            verificationPromise &&
            verificationUid ===
                firebaseUser.uid &&
            verificationPromiseGeneration ===
                verificationGeneration
        ) {
            return verificationPromise;
        }

        const currentLifecycle =
            lifecycleGeneration;

        const currentVerification =
            ++verificationGeneration;

        verificationPromiseGeneration =
            currentVerification;

        verificationUid =
            firebaseUser.uid;

        verificationPromise =
            (async () => {
                clearRedirectTimer();
                resetAuthorizationState();

                state.loading =
                    true;

                state.status =
                    STATUS.CHECKING;

                notify(
                    EVENTS.CHECKING
                );

                try {
                    const tokenContext =
                        await getTokenContext(
                            firebaseUser
                        );

                    if (
                        currentLifecycle !==
                            lifecycleGeneration ||
                        currentVerification !==
                            verificationGeneration
                    ) {
                        return getState();
                    }

                    const normalizedUser =
                        normalizeFirebaseUser(
                            firebaseUser,
                            tokenContext
                                .signInProvider
                        );

                    state.firebaseUser =
                        normalizedUser;

                    if (
                        normalizedUser.email !==
                        SOLE_ADMIN_EMAIL
                    ) {
                        return denyAccess(
                            "email_not_authorized",
                            {
                                redirect:
                                    redirectOnDenied
                            }
                        );
                    }

                    if (
                        !normalizedUser
                            .isGoogleConnected
                    ) {
                        return denyAccess(
                            "google_provider_required",
                            {
                                redirect:
                                    redirectOnDenied
                            }
                        );
                    }

                    if (
                        !normalizedUser
                            .emailVerified
                    ) {
                        return denyAccess(
                            "verified_email_required",
                            {
                                redirect:
                                    redirectOnDenied
                            }
                        );
                    }

                    if (
                        !normalizedUser
                            .isGoogleSignIn
                    ) {
                        return denyAccess(
                            "current_google_sign_in_required",
                            {
                                redirect:
                                    redirectOnDenied
                            }
                        );
                    }

                    const result =
                        await verifyThroughBackend();

                    if (
                        currentLifecycle !==
                            lifecycleGeneration ||
                        currentVerification !==
                            verificationGeneration
                    ) {
                        return getState();
                    }

                    const admin =
                        normalizeBackendAdmin(
                            result
                        );

                    const backendAuthorized =
                        admin.isAdmin ===
                            true &&
                        admin.isSuperAdmin ===
                            false &&
                        admin.role ===
                            "admin" &&
                        admin.email ===
                            SOLE_ADMIN_EMAIL &&
                        admin.uid ===
                            normalizedUser.uid;

                    if (!backendAuthorized) {
                        return denyAccess(
                            "backend_authorization_failed",
                            {
                                redirect:
                                    redirectOnDenied
                            }
                        );
                    }

                    state.loading =
                        false;

                    state.status =
                        STATUS.AUTHORIZED;

                    state.firebaseUser =
                        normalizedUser;

                    state.admin =
                        admin;

                    state.authorized =
                        true;

                    state.accessDenied =
                        false;

                    state.accessDeniedReason =
                        "";

                    state.redirecting =
                        false;

                    state.lastVerifiedAt =
                        new Date()
                            .toISOString();

                    clearError();

                    notify(
                        EVENTS.AUTHORIZED
                    );

                    return getState();
                } catch (error) {
                    if (
                        currentLifecycle !==
                            lifecycleGeneration ||
                        currentVerification !==
                            verificationGeneration
                    ) {
                        return getState();
                    }

                    if (
                        isPermissionError(
                            error
                        )
                    ) {
                        return denyAccess(
                            "backend_permission_denied",
                            {
                                redirect:
                                    redirectOnDenied
                            }
                        );
                    }

                    const authError =
                        createAuthError(
                            error
                        );

                    setErrorState(
                        authError
                    );

                    throw authError;
                }
            })()
                .finally(
                    () => {
                        if (
                            verificationPromiseGeneration ===
                                currentVerification
                        ) {
                            verificationPromise =
                                null;

                            verificationPromiseGeneration =
                                0;

                            verificationUid =
                                "";
                        }
                    }
                );

        return verificationPromise;
    }

    /* =====================================================
       GOOGLE LOGIN
    ===================================================== */

    async function loginThroughAuthService() {
        const authService =
            window.AuthService;

        if (
            !authService ||
            typeof authService
                .loginWithGoogle !==
                "function"
        ) {
            return {
                handled:
                    false,

                result:
                    null
            };
        }

        return {
            handled:
                true,

            result:
                await authService
                    .loginWithGoogle()
        };
    }

    function createGoogleProvider() {
        if (
            !window.firebase ||
            !window.firebase.auth ||
            typeof window.firebase
                .auth
                .GoogleAuthProvider !==
                "function"
        ) {
            throw new AdminAuthError({
                code:
                    "google-provider-unavailable",

                message:
                    "Google authentication provider is not available."
            });
        }

        const provider =
            new window.firebase
                .auth
                .GoogleAuthProvider();

        provider.addScope(
            "email"
        );

        provider.addScope(
            "profile"
        );

        provider.setCustomParameters({
            prompt:
                "select_account"
        });

        return provider;
    }

    async function loginThroughFirebase() {
        const auth =
            authInstance ||
            resolveFirebaseAuth();

        if (!auth) {
            throw new AdminAuthError({
                code:
                    "auth-unavailable",

                message:
                    "Firebase Authentication is not available."
            });
        }

        const provider =
            createGoogleProvider();

        if (
            typeof auth
                .signInWithPopup ===
                "function"
        ) {
            try {
                const credential =
                    await auth
                        .signInWithPopup(
                            provider
                        );

                return (
                    credential?.user ||
                    auth.currentUser ||
                    null
                );
            } catch (error) {
                const code =
                    normalizeError(
                        error
                    ).code;

                const redirectFallbackCodes = [
                    "popup-blocked",
                    "operation-not-supported-in-this-environment",
                    "web-storage-unsupported"
                ];

                if (
                    !redirectFallbackCodes
                        .includes(code) ||
                    typeof auth
                        .signInWithRedirect !==
                        "function"
                ) {
                    throw error;
                }
            }
        }

        if (
            typeof auth
                .signInWithRedirect ===
                "function"
        ) {
            await auth
                .signInWithRedirect(
                    provider
                );

            return null;
        }

        throw new AdminAuthError({
            code:
                "google-sign-in-unavailable",

            message:
                "Google Sign-In is not supported by this Firebase Auth instance."
        });
    }

    function login() {
        if (loginPromise) {
            return loginPromise;
        }

        loginPromise =
            (async () => {
                clearRedirectTimer();

                state.loginInProgress =
                    true;

                state.loading =
                    true;

                state.status =
                    STATUS.CHECKING;

                state.accessDenied =
                    false;

                state.accessDeniedReason =
                    "";

                state.redirecting =
                    false;

                clearError();

                notify(
                    EVENTS.LOGIN_STARTED
                );

                try {
                    const serviceLogin =
                        await loginThroughAuthService();

                    let firebaseUser =
                        resolveCurrentFirebaseUser();

                    if (
                        !serviceLogin.handled
                    ) {
                        firebaseUser =
                            await loginThroughFirebase();
                    }

                    firebaseUser =
                        resolveRawFirebaseUser(
                            firebaseUser ||
                            serviceLogin.result
                        );

                    if (!firebaseUser?.uid) {
                        /*
                         * Redirect-based login may navigate away
                         * before returning a Firebase user.
                         */

                        return getState();
                    }

                    const result =
                        await verifyAdminSession(
                            firebaseUser,
                            {
                                redirectOnDenied:
                                    true
                            }
                        );

                    if (result.authorized) {
                        notify(
                            EVENTS.LOGIN_SUCCESS
                        );
                    }

                    return result;
                } catch (error) {
                    const authError =
                        createAuthError(
                            error
                        );

                    state.loading =
                        false;

                    state.authorized =
                        false;

                    state.admin =
                        null;

                    state.status =
                        STATUS.SIGNED_OUT;

                    state.error =
                        normalizeError(
                            authError
                        );

                    if (
                        isPopupCancellation(
                            authError
                        )
                    ) {
                        state.error = {
                            ...state.error,

                            message:
                                "Google Sign-In was cancelled."
                        };
                    }

                    notify(
                        EVENTS.LOGIN_ERROR
                    );

                    throw authError;
                } finally {
                    state.loginInProgress =
                        false;

                    if (
                        state.status !==
                        STATUS.CHECKING
                    ) {
                        state.loading =
                            false;
                    }

                    notify();
                }
            })()
                .finally(
                    () => {
                        loginPromise =
                            null;
                    }
                );

        return loginPromise;
    }

    /* =====================================================
       LOGOUT
    ===================================================== */

    function logout() {
        if (logoutPromise) {
            return logoutPromise;
        }

        logoutPromise =
            (async () => {
                clearRedirectTimer();

                state.logoutInProgress =
                    true;

                state.loading =
                    true;

                notify(
                    EVENTS.LOGOUT_STARTED
                );

                try {
                    verificationGeneration +=
                        1;

                    authStateGeneration +=
                        1;

                    const authService =
                        window.AuthService;

                    if (
                        authService &&
                        typeof authService
                            .logout ===
                            "function"
                    ) {
                        await authService
                            .logout();
                    } else {
                        const auth =
                            authInstance ||
                            resolveFirebaseAuth();

                        if (
                            auth &&
                            typeof auth.signOut ===
                                "function"
                        ) {
                            await auth.signOut();
                        }
                    }

                    setSignedOutState(
                        EVENTS.LOGOUT_COMPLETED
                    );

                    return getState();
                } catch (error) {
                    const authError =
                        createAuthError(
                            error
                        );

                    setErrorState(
                        authError
                    );

                    throw authError;
                } finally {
                    state.logoutInProgress =
                        false;

                    notify();
                }
            })()
                .finally(
                    () => {
                        logoutPromise =
                            null;
                    }
                );

        return logoutPromise;
    }

    /* =====================================================
       AUTH STATE LISTENER
    ===================================================== */

    async function processAuthState(
        firebaseUser
    ) {
        const currentLifecycle =
            lifecycleGeneration;

        const currentAuthState =
            ++authStateGeneration;

        try {
            if (!firebaseUser?.uid) {
                verificationGeneration +=
                    1;

                clearRedirectTimer();

                setSignedOutState();

                return getState();
            }

            const result =
                await verifyAdminSession(
                    firebaseUser,
                    {
                        redirectOnDenied:
                            true
                    }
                );

            if (
                currentLifecycle !==
                    lifecycleGeneration ||
                currentAuthState !==
                    authStateGeneration
            ) {
                return getState();
            }

            return result;
        } catch (error) {
            if (
                currentLifecycle !==
                    lifecycleGeneration ||
                currentAuthState !==
                    authStateGeneration
            ) {
                return getState();
            }

            console.error(
                "[AdminAuth] Session verification failed.",
                error
            );

            return getState();
        } finally {
            if (
                currentLifecycle ===
                    lifecycleGeneration &&
                currentAuthState ===
                    authStateGeneration
            ) {
                markReady();
            }
        }
    }

    function bindAuthStateListener() {
        if (authUnsubscribe) {
            return true;
        }

        authInstance =
            resolveFirebaseAuth();

        if (
            !authInstance ||
            typeof authInstance
                .onAuthStateChanged !==
                "function"
        ) {
            throw new AdminAuthError({
                code:
                    "auth-listener-unavailable",

                message:
                    "Firebase Authentication state listener is not available."
            });
        }

        authUnsubscribe =
            authInstance
                .onAuthStateChanged(
                    (firebaseUser) => {
                        void processAuthState(
                            firebaseUser
                        );
                    },

                    (error) => {
                        setErrorState(
                            error
                        );

                        markReady();
                    }
                );

        return true;
    }

    /* =====================================================
       DOM ACTIONS
    ===================================================== */

    function handleDocumentClick(event) {
        if (
            event.defaultPrevented ||
            !(event.target instanceof
                Element)
        ) {
            return;
        }

        const loginButton =
            event.target.closest(
                "[data-admin-google-login]"
            );

        if (loginButton) {
            event.preventDefault();

            void login().catch(
                (error) => {
                    console.error(
                        "[AdminAuth] Google Sign-In failed.",
                        error
                    );
                }
            );

            return;
        }

        const logoutButton =
            event.target.closest(
                "[data-admin-logout]"
            );

        if (logoutButton) {
            event.preventDefault();

            void logout().catch(
                (error) => {
                    console.error(
                        "[AdminAuth] Logout failed.",
                        error
                    );
                }
            );
        }
    }

    function handleLoginRequest() {
        void login().catch(
            (error) => {
                console.error(
                    "[AdminAuth] Login request failed.",
                    error
                );
            }
        );
    }

    function handleLogoutRequest() {
        void logout().catch(
            (error) => {
                console.error(
                    "[AdminAuth] Logout request failed.",
                    error
                );
            }
        );
    }

    function bindBrowserEvents() {
        if (browserController) {
            return true;
        }

        browserController =
            new AbortController();

        const signal =
            browserController.signal;

        document.addEventListener(
            "click",
            handleDocumentClick,
            {
                signal
            }
        );

        window.addEventListener(
            "admin:google-sign-in",
            handleLoginRequest,
            {
                signal
            }
        );

        window.addEventListener(
            "admin:logout",
            handleLogoutRequest,
            {
                signal
            }
        );

        return true;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (initPromise) {
            return initPromise;
        }

        lifecycleGeneration +=
            1;

        state.initialized =
            true;

        state.ready =
            false;

        state.loading =
            true;

        state.status =
            STATUS.CHECKING;

        clearError();

        notify(
            EVENTS.CHECKING
        );

        initPromise =
            new Promise(
                (resolve) => {
                    readyResolver =
                        resolve;

                    try {
                        resolveAdminAPI();

                        authInstance =
                            resolveFirebaseAuth();

                        if (!authInstance) {
                            throw new AdminAuthError({
                                code:
                                    "auth-unavailable",

                                message:
                                    "Firebase Authentication is not available on the Admin page."
                            });
                        }

                        bindBrowserEvents();
                        bindAuthStateListener();
                    } catch (error) {
                        setErrorState(
                            error
                        );

                        markReady();
                    }
                }
            );

        return initPromise;
    }

    function whenReady() {
        return init();
    }

    /* =====================================================
       ACCESS HELPERS
    ===================================================== */

    async function requireAdmin() {
        await init();

        if (
            state.authorized &&
            state.admin
        ) {
            return cloneValue(
                state.admin
            );
        }

        const currentUser =
            resolveCurrentFirebaseUser();

        if (!currentUser?.uid) {
            throw new AdminAuthError({
                code:
                    "unauthenticated",

                message:
                    "Admin Google Sign-In is required."
            });
        }

        const result =
            await verifyAdminSession(
                currentUser,
                {
                    redirectOnDenied:
                        true
                }
            );

        if (
            !result.authorized ||
            !state.admin
        ) {
            throw new AdminAuthError({
                code:
                    "permission-denied",

                message:
                    "Admin access is not authorized."
            });
        }

        return cloneValue(
            state.admin
        );
    }

    function isAuthorized() {
        return (
            state.authorized ===
            true
        );
    }

    function isSignedIn() {
        return Boolean(
            state.firebaseUser?.uid
        );
    }

    function getAdmin() {
        return cloneValue(
            state.admin
        );
    }

    function getFirebaseUser() {
        return cloneValue(
            state.firebaseUser
        );
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
                "AdminAuth subscriber must be a function."
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
       CLEANUP
    ===================================================== */

    function destroy() {
        lifecycleGeneration +=
            1;

        authStateGeneration +=
            1;

        verificationGeneration +=
            1;

        clearRedirectTimer();

        if (
            typeof authUnsubscribe ===
            "function"
        ) {
            authUnsubscribe();
        }

        authUnsubscribe =
            null;

        browserController?.abort();

        browserController =
            null;

        listeners.clear();

        readyResolver =
            null;

        initPromise =
            null;

        loginPromise =
            null;

        logoutPromise =
            null;

        verificationPromise =
            null;

        verificationPromiseGeneration =
            0;

        verificationUid =
            "";

        authInstance =
            null;

        state.initialized =
            false;

        state.ready =
            false;

        state.loading =
            false;

        state.loginInProgress =
            false;

        state.logoutInProgress =
            false;

        state.status =
            STATUS.IDLE;

        state.firebaseUser =
            null;

        resetAuthorizationState();

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.AdminAuth =
        Object.freeze({
            init,
            whenReady,
            destroy,

            login,
            logout,

            verifyAdminSession,
            requireAdmin,

            isAuthorized,
            isSignedIn,
            isSoleAdminEmail,
            isGoogleAccount,
            isVerifiedAdminCandidate,

            getState,
            getAdmin,
            getFirebaseUser,

            getMainSiteURL,
            redirectToMainSite,

            subscribe,

            AdminAuthError,

            SOLE_ADMIN_EMAIL,
            GOOGLE_PROVIDER_ID,
            STATUS,
            EVENTS
        });
})(
    window,
    document
);