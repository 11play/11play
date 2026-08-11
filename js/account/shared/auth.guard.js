/* =========================================================
   11PLAY — AUTHENTICATION GUARD
   File: js/account/shared/auth.guard.js

   Responsibilities:
   - Protect Profile-related private actions
   - Require Firebase authentication
   - Require a Google-connected account
   - Require the current session to be signed in with Google
   - Require a verified Google email
   - Prevent guest users from using private Profile actions
   - Provide reusable authentication checks
   - Never modify Firebase data directly

   Important:
   - This is a client-side access guard only
   - Firestore Rules remain the final database authority
========================================================= */

(() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const GOOGLE_PROVIDER_ID =
        "google.com";

    const AUTH_STATE_TIMEOUT_MS =
        5000;

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let initialized =
        false;

    let currentUser =
        null;

    let readyPromise =
        null;

    let authStateListenerBound =
        false;

    let lastStateSignature =
        "";

    /* =====================================================
       AUTH GUARD ERROR
    ===================================================== */

    class AuthGuardError extends Error {
        constructor({
            code = "auth-guard-error",
            message = "Authentication is required.",
            action = "",
            details = null
        } = {}) {
            super(message);

            this.name =
                "AuthGuardError";

            this.code =
                code;

            this.action =
                action;

            this.details =
                details;

            Error.captureStackTrace?.(
                this,
                AuthGuardError
            );
        }
    }

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function toSafeString(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .trim();
    }

    function uniqueStrings(values) {
        if (!Array.isArray(values)) {
            return [];
        }

        return Array.from(
            new Set(
                values
                    .map(toSafeString)
                    .filter(Boolean)
            )
        );
    }

    function hasOwn(
        object,
        key
    ) {
        return Boolean(
            object &&
            Object.prototype
                .hasOwnProperty
                .call(
                    object,
                    key
                )
        );
    }

    function dispatchGuardEvent(
        eventName,
        detail = {}
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

    /* =====================================================
       AUTH SERVICE RESOLUTION
    ===================================================== */

    function getAuthService() {
        return (
            window.AuthService ||
            null
        );
    }

    function resolveFirebaseAuth() {
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
            typeof window.firebase
                .auth ===
                "function"
        ) {
            try {
                return window.firebase
                    .auth();
            } catch (error) {
                console.error(
                    "[AuthGuard] Firebase Auth could not be resolved.",
                    error
                );
            }
        }

        return null;
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
            return uniqueStrings(
                user.providerIds
            );
        }

        if (
            Array.isArray(
                user.providerData
            )
        ) {
            return uniqueStrings(
                user.providerData.map(
                    (provider) =>
                        provider
                            ?.providerId ||
                        ""
                )
            );
        }

        return [];
    }

    function normalizeUser(user) {
        const uid =
            toSafeString(
                user?.uid
            );

        if (!uid) {
            return null;
        }

        const providerIds =
            getProviderIds(user);

        const signInProvider =
            toSafeString(
                user.signInProvider ||
                user
                    ?.claims
                    ?.firebase
                    ?.sign_in_provider
            );

        const isGoogleConnected =
            user.isGoogleConnected ===
                true ||
            user.googleConnected ===
                true ||
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            );

        /*
         * Google being linked is not enough.
         * The current authentication session must also
         * have been established with Google.
         */

        const isGoogleSignIn =
            user.isGoogleSignIn ===
                true ||
            signInProvider ===
                GOOGLE_PROVIDER_ID;

        return Object.freeze({
            uid,

            name:
                toSafeString(
                    user.name ||
                    user.displayName
                ),

            displayName:
                toSafeString(
                    user.displayName ||
                    user.name
                ),

            email:
                toSafeString(
                    user.email
                ).toLowerCase(),

            photo:
                toSafeString(
                    user.photo ||
                    user.photoURL
                ),

            photoURL:
                toSafeString(
                    user.photoURL ||
                    user.photo
                ),

            emailVerified:
                user.emailVerified ===
                    true,

            phoneNumber:
                toSafeString(
                    user.phoneNumber
                ),

            providerIds,

            signInProvider,

            isGoogleConnected,

            googleConnected:
                isGoogleConnected,

            isGoogleSignIn,

            accountType:
                isGoogleConnected
                    ? "google"
                    : "firebase",

            isAuthenticated:
                true
        });
    }

    async function normalizeFirebaseUser(
        firebaseUser
    ) {
        if (!firebaseUser?.uid) {
            return null;
        }

        let signInProvider =
            "";

        if (
            typeof firebaseUser
                .getIdTokenResult ===
                "function"
        ) {
            try {
                const tokenResult =
                    await firebaseUser
                        .getIdTokenResult(
                            false
                        );

                signInProvider =
                    toSafeString(
                        tokenResult
                            ?.signInProvider ||
                        tokenResult
                            ?.claims
                            ?.firebase
                            ?.sign_in_provider
                    );
            } catch (error) {
                console.warn(
                    "[AuthGuard] Firebase sign-in provider could not be verified.",
                    error
                );
            }
        }

        return normalizeUser({
            uid:
                firebaseUser.uid,

            name:
                firebaseUser.displayName,

            displayName:
                firebaseUser.displayName,

            email:
                firebaseUser.email,

            photo:
                firebaseUser.photoURL,

            photoURL:
                firebaseUser.photoURL,

            phoneNumber:
                firebaseUser.phoneNumber,

            emailVerified:
                firebaseUser
                    .emailVerified ===
                true,

            providerData:
                firebaseUser.providerData,

            signInProvider,

            isGoogleSignIn:
                signInProvider ===
                GOOGLE_PROVIDER_ID
        });
    }

    /* =====================================================
       CURRENT USER RESOLUTION
    ===================================================== */

    function readUserFromAuthService() {
        const authService =
            getAuthService();

        if (!authService) {
            return {
                available:
                    false,

                user:
                    null
            };
        }

        try {
            if (
                typeof authService
                    .getCurrentUser ===
                    "function"
            ) {
                return {
                    available:
                        true,

                    user:
                        normalizeUser(
                            authService
                                .getCurrentUser()
                        )
                };
            }

            if (
                typeof authService
                    .getUser ===
                    "function"
            ) {
                return {
                    available:
                        true,

                    user:
                        normalizeUser(
                            authService
                                .getUser()
                        )
                };
            }
        } catch (error) {
            console.warn(
                "[AuthGuard] AuthService user could not be read.",
                error
            );
        }

        return {
            available:
                true,

            user:
                null
        };
    }

    function readUserFromFirebaseSynchronously() {
        const auth =
            resolveFirebaseAuth();

        const firebaseUser =
            auth?.currentUser ||
            null;

        if (!firebaseUser) {
            return null;
        }

        /*
         * A raw Firebase user does not synchronously expose
         * the current sign-in provider. Therefore it can prove
         * authentication, but it cannot satisfy requireGoogle
         * until token metadata has been loaded.
         */

        return normalizeUser({
            uid:
                firebaseUser.uid,

            name:
                firebaseUser.displayName,

            displayName:
                firebaseUser.displayName,

            email:
                firebaseUser.email,

            photo:
                firebaseUser.photoURL,

            photoURL:
                firebaseUser.photoURL,

            phoneNumber:
                firebaseUser.phoneNumber,

            emailVerified:
                firebaseUser
                    .emailVerified ===
                true,

            providerData:
                firebaseUser.providerData,

            signInProvider:
                "",

            isGoogleSignIn:
                false
        });
    }

    function resolveCurrentUser() {
        const authServiceResult =
            readUserFromAuthService();

        if (
            authServiceResult.available
        ) {
            return authServiceResult.user;
        }

        return (
            readUserFromFirebaseSynchronously() ||
            null
        );
    }

    /* =====================================================
       STATE UPDATE
    ===================================================== */

    function createStateSignature(user) {
        if (!user) {
            return "guest";
        }

        return JSON.stringify({
            uid:
                user.uid,

            email:
                user.email,

            emailVerified:
                user.emailVerified,

            providerIds:
                user.providerIds,

            signInProvider:
                user.signInProvider,

            isGoogleConnected:
                user.isGoogleConnected,

            isGoogleSignIn:
                user.isGoogleSignIn
        });
    }

    function createState() {
        const user =
            currentUser;

        return Object.freeze({
            initialized,

            authenticated:
                Boolean(user?.uid),

            googleConnected:
                Boolean(
                    user
                        ?.isGoogleConnected
                ),

            googleSignIn:
                Boolean(
                    user
                        ?.isGoogleSignIn
                ),

            emailVerified:
                Boolean(
                    user
                        ?.emailVerified
                ),

            uid:
                user?.uid ||
                "",

            user:
                user ||
                null
        });
    }

    function updateCurrentUser(
        user,
        source = "unknown",
        options = {}
    ) {
        const normalizedUser =
            normalizeUser(user);

        const signature =
            createStateSignature(
                normalizedUser
            );

        const stateChanged =
            signature !==
            lastStateSignature;

        currentUser =
            normalizedUser;

        lastStateSignature =
            signature;

        if (
            stateChanged ||
            options.force ===
                true
        ) {
            dispatchGuardEvent(
                "auth-guard:state-changed",
                {
                    ...createState(),
                    source
                }
            );
        }

        return currentUser;
    }

    /* =====================================================
       AUTH EVENTS
    ===================================================== */

    function handleAuthStateChanged(
        event
    ) {
        const detail =
            event?.detail ||
            {};

        /*
         * An explicit null user means signed out.
         * Do not replace it with a possibly stale fallback.
         */

        const user =
            hasOwn(
                detail,
                "user"
            )
                ? detail.user
                : resolveCurrentUser();

        updateCurrentUser(
            user,
            "auth-service"
        );
    }

    function bindAuthStateListener() {
        if (
            authStateListenerBound
        ) {
            return true;
        }

        window.addEventListener(
            "auth:state-changed",
            handleAuthStateChanged
        );

        /*
         * Kept for compatibility with existing
         * Profile authentication synchronization.
         */

        window.addEventListener(
            "profile:auth-changed",
            handleAuthStateChanged
        );

        authStateListenerBound =
            true;

        return true;
    }

    function unbindAuthStateListener() {
        if (
            !authStateListenerBound
        ) {
            return true;
        }

        window.removeEventListener(
            "auth:state-changed",
            handleAuthStateChanged
        );

        window.removeEventListener(
            "profile:auth-changed",
            handleAuthStateChanged
        );

        authStateListenerBound =
            false;

        return true;
    }

    /* =====================================================
       FIREBASE AUTH FALLBACK
    ===================================================== */

    function waitForFirebaseAuthState() {
        const auth =
            resolveFirebaseAuth();

        if (!auth) {
            return Promise.resolve(
                null
            );
        }

        if (
            auth.currentUser
        ) {
            return normalizeFirebaseUser(
                auth.currentUser
            );
        }

        return new Promise(
            (resolve) => {
                let unsubscribe =
                    null;

                let timeoutId =
                    null;

                let completed =
                    false;

                const finish =
                    async (
                        firebaseUser
                    ) => {
                        if (
                            completed
                        ) {
                            return;
                        }

                        completed =
                            true;

                        if (
                            timeoutId !==
                            null
                        ) {
                            window.clearTimeout(
                                timeoutId
                            );
                        }

                        if (
                            typeof unsubscribe ===
                                "function"
                        ) {
                            unsubscribe();
                        }

                        resolve(
                            await normalizeFirebaseUser(
                                firebaseUser
                            )
                        );
                    };

                try {
                    unsubscribe =
                        auth
                            .onAuthStateChanged(
                                (
                                    firebaseUser
                                ) => {
                                    finish(
                                        firebaseUser
                                    );
                                },

                                () => {
                                    finish(
                                        null
                                    );
                                }
                            );

                    timeoutId =
                        window.setTimeout(
                            () => {
                                finish(
                                    auth.currentUser ||
                                    null
                                );
                            },
                            AUTH_STATE_TIMEOUT_MS
                        );
                } catch {
                    finish(
                        null
                    );
                }
            }
        );
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        /*
         * Returning the existing promise prevents duplicate
         * initialization and duplicate Firebase listeners.
         */

        if (
            readyPromise
        ) {
            return readyPromise;
        }

        bindAuthStateListener();

        readyPromise =
            (async () => {
                const authService =
                    getAuthService();

                if (
                    authService &&
                    typeof authService
                        .whenReady ===
                        "function"
                ) {
                    try {
                        await authService
                            .whenReady();
                    } catch (error) {
                        console.warn(
                            "[AuthGuard] AuthService initialization did not complete.",
                            error
                        );
                    }
                } else if (
                    authService &&
                    typeof authService
                        .init ===
                        "function"
                ) {
                    try {
                        await authService
                            .init();
                    } catch (error) {
                        console.warn(
                            "[AuthGuard] AuthService could not initialize.",
                            error
                        );
                    }
                }

                let user =
                    resolveCurrentUser();

                if (
                    !user &&
                    !authService
                ) {
                    user =
                        await waitForFirebaseAuthState();
                }

                initialized =
                    true;

                updateCurrentUser(
                    user,
                    "initialization",
                    {
                        force:
                            true
                    }
                );

                dispatchGuardEvent(
                    "auth-guard:ready",
                    createState()
                );

                return currentUser;
            })()
                .catch(
                    (error) => {
                        readyPromise =
                            null;

                        initialized =
                            false;

                        throw error;
                    }
                );

        return readyPromise;
    }

    function whenReady() {
        return init();
    }

    /* =====================================================
       STATE CHECKS
    ===================================================== */

    function getCurrentUser() {
        /*
         * Always accept an explicit null state from
         * AuthService. This prevents stale signed-in users
         * from remaining after logout.
         */

        const latestUser =
            resolveCurrentUser();

        currentUser =
            latestUser;

        lastStateSignature =
            createStateSignature(
                currentUser
            );

        return currentUser;
    }

    function getState() {
        getCurrentUser();

        return createState();
    }

    function isAuthenticated() {
        return Boolean(
            getCurrentUser()?.uid
        );
    }

    function isGoogleConnected() {
        return Boolean(
            getCurrentUser()
                ?.isGoogleConnected
        );
    }

    function isGoogleSignIn() {
        return Boolean(
            getCurrentUser()
                ?.isGoogleSignIn
        );
    }

    function hasVerifiedEmail() {
        return Boolean(
            getCurrentUser()
                ?.emailVerified
        );
    }

    /* =====================================================
       BLOCKED ACCESS
    ===================================================== */

    function reportBlockedAccess({
        code,
        message,
        action = "",
        reason = ""
    }) {
        const error =
            new AuthGuardError({
                code,
                message,
                action,

                details: {
                    reason
                }
            });

        const detail = {
            code,
            message,
            action,
            reason,
            error
        };

        dispatchGuardEvent(
            "auth-guard:blocked",
            detail
        );

        dispatchGuardEvent(
            "profile:login-required",
            detail
        );

        return error;
    }

    /* =====================================================
       INTERACTIVE GOOGLE LOGIN
    ===================================================== */

    async function requestGoogleLogin(
        options = {}
    ) {
        const action =
            toSafeString(
                options.action
            );

        const authService =
            getAuthService();

        if (
            !authService ||
            typeof authService
                .loginWithGoogle !==
                "function"
        ) {
            throw reportBlockedAccess({
                code:
                    "auth-service-unavailable",

                message:
                    "Google sign-in service is not available.",

                action,

                reason:
                    "auth_service_missing"
            });
        }

        dispatchGuardEvent(
            "auth-guard:login-started",
            {
                action
            }
        );

        try {
            const signedInUser =
                await authService
                    .loginWithGoogle();

            /*
             * signInWithRedirect normally does not return
             * a user because the page is navigating away.
             */

            if (
                !signedInUser &&
                !authService
                    .getCurrentUser?.()
            ) {
                return null;
            }

            const user =
                normalizeUser(
                    signedInUser
                ) ||
                resolveCurrentUser();

            updateCurrentUser(
                user,
                "interactive-login"
            );

            if (!user) {
                throw new AuthGuardError({
                    code:
                        "login-not-completed",

                    message:
                        "Google sign-in was not completed.",

                    action
                });
            }

            dispatchGuardEvent(
                "auth-guard:login-success",
                {
                    action,
                    user
                }
            );

            return user;
        } catch (error) {
            const normalizedError =
                error instanceof
                    AuthGuardError
                    ? error
                    : new AuthGuardError({
                        code:
                            error?.code ||
                            "login-failed",

                        message:
                            error?.message ||
                            "Google sign-in failed.",

                        action,

                        details:
                            error
                    });

            dispatchGuardEvent(
                "auth-guard:login-error",
                {
                    action,

                    error:
                        normalizedError
                }
            );

            throw normalizedError;
        }
    }

    /* =====================================================
       AUTHENTICATION REQUIREMENTS
    ===================================================== */

    async function requireAuthenticated(
        options = {}
    ) {
        const action =
            toSafeString(
                options.action
            );

        const interactive =
            options.interactive ===
                true;

        await init();

        let user =
            getCurrentUser();

        if (
            !user &&
            interactive
        ) {
            user =
                await requestGoogleLogin({
                    action
                });
        }

        if (!user) {
            throw reportBlockedAccess({
                code:
                    "unauthenticated",

                message:
                    "Google sign-in is required.",

                action,

                reason:
                    "not_authenticated"
            });
        }

        return user;
    }

    async function requireGoogle(
        options = {}
    ) {
        const action =
            toSafeString(
                options.action
            );

        const interactive =
            options.interactive ===
                true;

        const requireVerifiedEmail =
            options.requireVerifiedEmail !==
                false;

        let user =
            await requireAuthenticated({
                action,
                interactive
            });

        const requiresNewGoogleLogin =
            !user.isGoogleConnected ||
            !user.isGoogleSignIn;

        if (
            requiresNewGoogleLogin &&
            interactive
        ) {
            const signedInUser =
                await requestGoogleLogin({
                    action
                });

            user =
                signedInUser ||
                getCurrentUser();
        }

        if (
            !user ||
            !user.isGoogleConnected
        ) {
            throw reportBlockedAccess({
                code:
                    "google-account-required",

                message:
                    "A Google-connected account is required.",

                action,

                reason:
                    "google_not_connected"
            });
        }

        if (
            !user.isGoogleSignIn
        ) {
            throw reportBlockedAccess({
                code:
                    "google-sign-in-required",

                message:
                    "Sign in directly with Google to continue.",

                action,

                reason:
                    "current_session_not_google"
            });
        }

        if (
            requireVerifiedEmail &&
            !user.emailVerified
        ) {
            throw reportBlockedAccess({
                code:
                    "verified-email-required",

                message:
                    "A verified Google email is required.",

                action,

                reason:
                    "email_not_verified"
            });
        }

        return user;
    }

    /* =====================================================
       PROTECTED ACTION RUNNER
    ===================================================== */

    async function runProtected(
        callback,
        options = {}
    ) {
        if (
            typeof callback !==
                "function"
        ) {
            throw new AuthGuardError({
                code:
                    "invalid-callback",

                message:
                    "Protected action must be a function.",

                action:
                    toSafeString(
                        options.action
                    )
            });
        }

        const user =
            await requireGoogle({
                action:
                    toSafeString(
                        options.action
                    ),

                interactive:
                    options.interactive ===
                        true,

                requireVerifiedEmail:
                    options
                        .requireVerifiedEmail !==
                    false
            });

        return callback(
            user
        );
    }

    /* =====================================================
       PROFILE ACCESS
    ===================================================== */

    async function requireProfileAccess(
        options = {}
    ) {
        return requireGoogle({
            ...options,

            action:
                options.action ||
                "profile"
        });
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        unbindAuthStateListener();

        initialized =
            false;

        currentUser =
            null;

        readyPromise =
            null;

        lastStateSignature =
            "";

        return true;
    }

    /* =====================================================
       GLOBAL API
    ===================================================== */

    window.AuthGuard =
        Object.freeze({
            init,
            destroy,
            whenReady,

            getCurrentUser,
            getState,

            isAuthenticated,
            isGoogleConnected,
            isGoogleSignIn,
            hasVerifiedEmail,

            requireAuthenticated,
            requireGoogle,
            requireProfileAccess,

            requestGoogleLogin,
            runProtected,

            AuthGuardError,
            GOOGLE_PROVIDER_ID
        });
})();