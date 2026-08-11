/* =========================================================
   11PLAY — AUTH SERVICE
   File: js/services/auth.service.js

   Responsibilities:
   - Initialize Firebase Authentication
   - Handle Google popup and redirect sign-in
   - Handle logout
   - Observe authentication-state changes
   - Expose the current authenticated user
   - Synchronize safe authentication data with ProfileService
   - Receive Profile page login/logout events
   - Notify the application when authentication changes

   Current account scope:
   - Google authentication
   - Name
   - Username
   - Email
   - Profile photo
   - Registration date
   - Last login
   - Account type
   - Mobile number / mobile lock state

   Important:
   - Profile-owned fields are not generated here
   - Mobile data is not written here
   - lastLogin is not written here
   - Signed-out state clears the previous user's private data
   - Guest identity may be provided by ProfileService
   - Referral, reward, wallet, withdrawal, activity and
     device-binding state are not synchronized here
========================================================= */

const AuthService = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const GOOGLE_PROVIDER_ID =
        "google.com";

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let authInstance =
        null;

    let currentUser =
        null;

    let authUnsubscribe =
        null;

    let authReadyPromise =
        null;

    let redirectResultPromise =
        null;

    let isInitialized =
        false;

    let uiEventsBound =
        false;

    let lastStateSignature =
        "";

    /* =====================================================
       FIREBASE RESOLUTION
    ===================================================== */

    function getFirebaseNamespace() {
        return (
            window.firebase ||
            null
        );
    }

    function resolveAuthInstance() {
        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        if (configuredAuth) {
            return configuredAuth;
        }

        const firebaseNamespace =
            getFirebaseNamespace();

        if (
            firebaseNamespace &&
            typeof firebaseNamespace.auth ===
                "function"
        ) {
            try {
                return firebaseNamespace
                    .auth();
            } catch (error) {
                console.error(
                    "[AuthService] Firebase Auth instance could not be resolved.",
                    error
                );
            }
        }

        return null;
    }

    function createGoogleProvider() {
        const firebaseNamespace =
            getFirebaseNamespace();

        const ProviderConstructor =
            firebaseNamespace
                ?.auth
                ?.GoogleAuthProvider;

        if (
            typeof ProviderConstructor !==
                "function"
        ) {
            throw new Error(
                "Firebase Google Auth provider is not available."
            );
        }

        const provider =
            new ProviderConstructor();

        provider.setCustomParameters({
            prompt:
                "select_account"
        });

        provider.addScope(
            "profile"
        );

        provider.addScope(
            "email"
        );

        return provider;
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
            .normalize("NFKC")
            .trim();
    }

    function uniqueStrings(values) {
        if (
            !Array.isArray(values)
        ) {
            return [];
        }

        return Array.from(
            new Set(
                values
                    .map(
                        toSafeString
                    )
                    .filter(
                        Boolean
                    )
            )
        );
    }

    function normalizeEmail(value) {
        return toSafeString(
            value
        )
            .toLowerCase();
    }

    function deriveUsername(
        explicitUsername,
        email,
        fallback = ""
    ) {
        const username =
            toSafeString(
                explicitUsername
            )
                .replace(
                    /^@+/,
                    ""
                )
                .replace(
                    /\s+/g,
                    ""
                );

        if (username) {
            return username;
        }

        const normalizedEmail =
            normalizeEmail(
                email
            );

        const separatorIndex =
            normalizedEmail
                .indexOf("@");

        if (
            separatorIndex >
                0
        ) {
            return normalizedEmail
                .slice(
                    0,
                    separatorIndex
                );
        }

        return toSafeString(
            fallback
        );
    }

    /* =====================================================
       SAFE PROFILE PROJECTION

       AuthService never copies arbitrary ProfileService
       properties into authentication state.

       This prevents retired account systems from being
       carried forward through a generic object spread.
    ===================================================== */

    function projectExistingProfile(
        profile
    ) {
        const source =
            profile &&
            typeof profile ===
                "object"
                ? profile
                : {};

        const mobileNumber =
            toSafeString(
                source.mobileNumber ||
                source.mobile
            );

        return {
            uid:
                toSafeString(
                    source.uid
                ),

            name:
                toSafeString(
                    source.name ||
                    source.displayName
                ),

            displayName:
                toSafeString(
                    source.displayName ||
                    source.name
                ),

            username:
                toSafeString(
                    source.username
                ),

            email:
                normalizeEmail(
                    source.email
                ),

            photo:
                toSafeString(
                    source.photo ||
                    source.photoURL
                ),

            photoURL:
                toSafeString(
                    source.photoURL ||
                    source.photo
                ),

            emailVerified:
                source.emailVerified ===
                    true,

            phoneNumber:
                toSafeString(
                    source.phoneNumber
                ),

            providerIds:
                uniqueStrings(
                    source.providerIds
                ),

            signInProvider:
                toSafeString(
                    source.signInProvider
                ),

            isGoogleConnected:
                source.isGoogleConnected ===
                    true ||
                source.googleConnected ===
                    true,

            googleConnected:
                source.googleConnected ===
                    true ||
                source.isGoogleConnected ===
                    true,

            isGoogleSignIn:
                source.isGoogleSignIn ===
                    true,

            accountType:
                toSafeString(
                    source.accountType
                ),

            isAuthenticated:
                source.isAuthenticated ===
                    true ||
                source.authenticated ===
                    true,

            authenticated:
                source.authenticated ===
                    true ||
                source.isAuthenticated ===
                    true,

            mobileNumber,

            mobileAdded:
                source.mobileAdded ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            mobileLocked:
                source.mobileLocked ===
                    true ||
                source.isMobileLocked ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            isMobileLocked:
                source.isMobileLocked ===
                    true ||
                source.mobileLocked ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            registrationDate:
                source.registrationDate ||
                source.createdAt ||
                null,

            createdAt:
                source.createdAt ||
                source.registrationDate ||
                null,

            lastLogin:
                source.lastLogin ||
                source.lastLoginAt ||
                null,

            lastLoginAt:
                source.lastLoginAt ||
                source.lastLogin ||
                null,

            status:
                toSafeString(
                    source.status
                )
        };
    }

    /* =====================================================
       GUEST PROFILE
    ===================================================== */

    function createFallbackGuestProfile() {
        return {
            uid:
                "",

            guestId:
                "",

            name:
                "Guest User",

            displayName:
                "Guest User",

            username:
                "",

            email:
                "",

            photo:
                "",

            photoURL:
                "",

            emailVerified:
                false,

            phoneNumber:
                "",

            providerIds:
                [],

            signInProvider:
                "",

            isGoogleConnected:
                false,

            isGoogleSignIn:
                false,

            googleConnected:
                false,

            accountType:
                "guest",

            isAuthenticated:
                false,

            authenticated:
                false,

            mobileNumber:
                "",

            mobileAdded:
                false,

            mobileLocked:
                false,

            isMobileLocked:
                false,

            registrationDate:
                null,

            createdAt:
                null,

            lastLogin:
                null,

            lastLoginAt:
                null,

            status:
                ""
        };
    }

    function sanitizeGuestProfile(
        profile
    ) {
        const source =
            profile &&
            typeof profile ===
                "object"
                ? profile
                : {};

        const username =
            toSafeString(
                source.username
            );

        const guestId =
            toSafeString(
                source.guestId
            );

        return {
            ...createFallbackGuestProfile(),

            guestId,

            name:
                "Guest User",

            displayName:
                "Guest User",

            username,

            accountType:
                "guest",

            isAuthenticated:
                false,

            authenticated:
                false
        };
    }

    /*
     * Resolve the Guest profile dynamically because
     * AuthService may initialize before ProfileService.
     */

    function createGuestProfile() {
        if (
            window.ProfileService &&
            typeof window
                .ProfileService
                .createGuestProfile ===
                "function"
        ) {
            try {
                return sanitizeGuestProfile(
                    window.ProfileService
                        .createGuestProfile()
                );
            } catch (error) {
                console.warn(
                    "[AuthService] Guest profile could not be created by ProfileService.",
                    error
                );
            }
        }

        return createFallbackGuestProfile();
    }

    /* =====================================================
       FIREBASE USER NORMALIZATION
    ===================================================== */

    async function getTokenMetadata(
        firebaseUser
    ) {
        if (
            !firebaseUser ||
            typeof firebaseUser
                .getIdTokenResult !==
                "function"
        ) {
            return {
                signInProvider:
                    "",

                tokenIssuedAt:
                    ""
            };
        }

        try {
            const tokenResult =
                await firebaseUser
                    .getIdTokenResult(
                        false
                    );

            return {
                signInProvider:
                    toSafeString(
                        tokenResult
                            ?.signInProvider ||
                        tokenResult
                            ?.claims
                            ?.firebase
                            ?.sign_in_provider
                    ),

                tokenIssuedAt:
                    toSafeString(
                        tokenResult
                            ?.issuedAtTime
                    )
            };
        } catch (error) {
            console.warn(
                "[AuthService] Sign-in provider metadata could not be loaded.",
                error
            );

            return {
                signInProvider:
                    "",

                tokenIssuedAt:
                    ""
            };
        }
    }

    async function normalizeFirebaseUser(
        firebaseUser
    ) {
        if (!firebaseUser?.uid) {
            return null;
        }

        const providerIds =
            uniqueStrings(
                Array.isArray(
                    firebaseUser.providerData
                )
                    ? firebaseUser
                        .providerData
                        .map(
                            provider =>
                                provider
                                    ?.providerId ||
                                ""
                        )
                    : []
            );

        const tokenMetadata =
            await getTokenMetadata(
                firebaseUser
            );

        const isGoogleConnected =
            providerIds.includes(
                GOOGLE_PROVIDER_ID
            );

        const isGoogleSignIn =
            tokenMetadata
                .signInProvider ===
            GOOGLE_PROVIDER_ID;

        return Object.freeze({
            uid:
                toSafeString(
                    firebaseUser.uid
                ),

            name:
                toSafeString(
                    firebaseUser
                        .displayName
                ),

            displayName:
                toSafeString(
                    firebaseUser
                        .displayName
                ),

            email:
                normalizeEmail(
                    firebaseUser.email
                ),

            photo:
                toSafeString(
                    firebaseUser.photoURL
                ),

            photoURL:
                toSafeString(
                    firebaseUser.photoURL
                ),

            emailVerified:
                firebaseUser
                    .emailVerified ===
                true,

            phoneNumber:
                toSafeString(
                    firebaseUser
                        .phoneNumber
                ),

            providerIds,

            signInProvider:
                tokenMetadata
                    .signInProvider,

            tokenIssuedAt:
                tokenMetadata
                    .tokenIssuedAt,

            isGoogleConnected,

            googleConnected:
                isGoogleConnected,

            isGoogleSignIn,

            accountType:
                isGoogleConnected
                    ? "google"
                    : "firebase",

            isAuthenticated:
                true,

            authenticated:
                true
        });
    }

    /* =====================================================
       APPLICATION EVENTS
    ===================================================== */

    function dispatchAuthEvent(
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

    function createStateSignature(
        user
    ) {
        if (!user) {
            return "guest";
        }

        return JSON.stringify({
            uid:
                user.uid,

            email:
                user.email,

            displayName:
                user.displayName,

            photoURL:
                user.photoURL,

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

    function notifyAuthStateChanged(
        force = false
    ) {
        const signature =
            createStateSignature(
                currentUser
            );

        if (
            !force &&
            signature ===
                lastStateSignature
        ) {
            return false;
        }

        lastStateSignature =
            signature;

        const detail = {
            user:
                currentUser,

            authenticated:
                Boolean(
                    currentUser?.uid
                ),

            googleConnected:
                Boolean(
                    currentUser
                        ?.isGoogleConnected
                ),

            googleSignIn:
                Boolean(
                    currentUser
                        ?.isGoogleSignIn
                ),

            emailVerified:
                Boolean(
                    currentUser
                        ?.emailVerified
                )
        };

        dispatchAuthEvent(
            "auth:state-changed",
            detail
        );

        dispatchAuthEvent(
            "profile:auth-changed",
            detail
        );

        return true;
    }

    /* =====================================================
       PROFILE SERVICE SYNCHRONIZATION
    ===================================================== */

    function getExistingProfileData() {
        if (
            !window.ProfileService ||
            typeof window
                .ProfileService
                .getUser !==
                "function"
        ) {
            return {};
        }

        try {
            return (
                window.ProfileService
                    .getUser() ||
                {}
            );
        } catch (error) {
            console.warn(
                "[AuthService] Existing ProfileService data could not be read.",
                error
            );

            return {};
        }
    }

    function setProfileServiceUser(
        profile
    ) {
        if (
            !window.ProfileService ||
            typeof window
                .ProfileService
                .setUser !==
                "function"
        ) {
            return false;
        }

        try {
            window.ProfileService
                .setUser(
                    profile
                );

            return true;
        } catch (error) {
            console.error(
                "[AuthService] ProfileService synchronization failed.",
                error
            );

            return false;
        }
    }

    function synchronizeSignedInProfile(
        user
    ) {
        if (!user?.uid) {
            return false;
        }

        const existingProfile =
            projectExistingProfile(
                getExistingProfileData()
            );

        const sameUser =
            existingProfile.uid ===
            user.uid;

        /*
         * Preserve only approved Profile fields for the same
         * Firebase UID. No arbitrary object spread is used.
         */

        const preserved =
            sameUser
                ? {
                    mobileNumber:
                        existingProfile
                            .mobileNumber,

                    mobileAdded:
                        existingProfile
                            .mobileAdded,

                    mobileLocked:
                        existingProfile
                            .mobileLocked,

                    isMobileLocked:
                        existingProfile
                            .isMobileLocked,

                    registrationDate:
                        existingProfile
                            .registrationDate,

                    createdAt:
                        existingProfile
                            .createdAt,

                    lastLogin:
                        existingProfile
                            .lastLogin,

                    lastLoginAt:
                        existingProfile
                            .lastLoginAt,

                    status:
                        existingProfile
                            .status
                }
                : {
                    mobileNumber:
                        "",

                    mobileAdded:
                        false,

                    mobileLocked:
                        false,

                    isMobileLocked:
                        false,

                    registrationDate:
                        null,

                    createdAt:
                        null,

                    lastLogin:
                        null,

                    lastLoginAt:
                        null,

                    status:
                        ""
                };

        const username =
            deriveUsername(
                sameUser
                    ? existingProfile
                        .username
                    : "",
                user.email,
                "user"
            );

        return setProfileServiceUser({
            uid:
                user.uid,

            guestId:
                "",

            name:
                user.name,

            displayName:
                user.displayName,

            username,

            email:
                user.email,

            photo:
                user.photo,

            photoURL:
                user.photoURL,

            emailVerified:
                user.emailVerified,

            phoneNumber:
                user.phoneNumber,

            providerIds:
                [
                    ...user.providerIds
                ],

            signInProvider:
                user.signInProvider,

            googleConnected:
                user.isGoogleConnected,

            isGoogleConnected:
                user.isGoogleConnected,

            isGoogleSignIn:
                user.isGoogleSignIn,

            accountType:
                user.accountType,

            isAuthenticated:
                true,

            authenticated:
                true,

            ...preserved
        });
    }

    function synchronizeSignedOutProfile() {
        /*
         * Any authenticated user's private Profile state is
         * replaced with a clean Guest projection.
         */

        return setProfileServiceUser(
            createGuestProfile()
        );
    }

    /* =====================================================
       AUTH STATE HANDLING
    ===================================================== */

    async function applyFirebaseUser(
        firebaseUser
    ) {
        const previousUser =
            currentUser;

        const previousUid =
            previousUser?.uid ||
            "";

        if (firebaseUser) {
            const normalizedUser =
                await normalizeFirebaseUser(
                    firebaseUser
                );

            if (
                !normalizedUser?.uid
            ) {
                throw new Error(
                    "Authenticated Firebase user has no UID."
                );
            }

            currentUser =
                normalizedUser;

            synchronizeSignedInProfile(
                currentUser
            );

            if (
                previousUid !==
                currentUser.uid
            ) {
                console.info(
                    "[AuthService] User authenticated:",
                    currentUser.uid
                );

                dispatchAuthEvent(
                    "auth:signed-in",
                    {
                        user:
                            currentUser
                    }
                );
            }

            if (
                !currentUser
                    .isGoogleConnected ||
                !currentUser
                    .isGoogleSignIn
            ) {
                dispatchAuthEvent(
                    "auth:google-required",
                    {
                        user:
                            currentUser
                    }
                );
            }
        } else {
            currentUser =
                null;

            synchronizeSignedOutProfile();

            if (previousUid) {
                console.info(
                    "[AuthService] User signed out."
                );

                dispatchAuthEvent(
                    "auth:signed-out",
                    {
                        previousUser
                    }
                );
            }
        }

        notifyAuthStateChanged();

        return currentUser;
    }

    function handleAuthStateError(
        error
    ) {
        console.error(
            "[AuthService] Authentication-state listener failed.",
            error
        );

        dispatchAuthEvent(
            "auth:error",
            {
                action:
                    "auth-state",

                error
            }
        );
    }

    /* =====================================================
       PROFILE PAGE EVENTS
    ===================================================== */

    async function handleProfileGoogleSignIn() {
        await loginWithGoogle();
    }

    async function handleProfileLogout() {
        await logout();
    }

    function bindProfileEvents() {
        if (
            uiEventsBound
        ) {
            return true;
        }

        window.addEventListener(
            "profile:google-sign-in",
            handleProfileGoogleSignIn
        );

        window.addEventListener(
            "profile:logout",
            handleProfileLogout
        );

        uiEventsBound =
            true;

        return true;
    }

    function unbindProfileEvents() {
        if (
            !uiEventsBound
        ) {
            return true;
        }

        window.removeEventListener(
            "profile:google-sign-in",
            handleProfileGoogleSignIn
        );

        window.removeEventListener(
            "profile:logout",
            handleProfileLogout
        );

        uiEventsBound =
            false;

        return true;
    }

    /* =====================================================
       REDIRECT RESULT
    ===================================================== */

    function consumeRedirectResult() {
        if (
            redirectResultPromise
        ) {
            return redirectResultPromise;
        }

        if (
            !authInstance ||
            typeof authInstance
                .getRedirectResult !==
                "function"
        ) {
            redirectResultPromise =
                Promise.resolve(
                    null
                );

            return redirectResultPromise;
        }

        redirectResultPromise =
            authInstance
                .getRedirectResult()
                .then(
                    async result => {
                        if (
                            !result?.user
                        ) {
                            return null;
                        }

                        const user =
                            await applyFirebaseUser(
                                result.user
                            );

                        dispatchAuthEvent(
                            "auth:google-login-success",
                            {
                                user,

                                method:
                                    "redirect"
                            }
                        );

                        return user;
                    }
                )
                .catch(
                    error => {
                        console.error(
                            "[AuthService] Google redirect result failed.",
                            error
                        );

                        dispatchAuthEvent(
                            "auth:google-login-error",
                            {
                                error,

                                method:
                                    "redirect"
                            }
                        );

                        return null;
                    }
                );

        return redirectResultPromise;
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init() {
        if (
            authReadyPromise
        ) {
            return authReadyPromise;
        }

        authInstance =
            resolveAuthInstance();

        if (
            !authInstance
        ) {
            const error =
                new Error(
                    "Firebase Authentication is not available."
                );

            console.error(
                "[AuthService]",
                error.message
            );

            return Promise.reject(
                error
            );
        }

        bindProfileEvents();

        authReadyPromise =
            new Promise(
                (
                    resolve,
                    reject
                ) => {
                    let initialStateResolved =
                        false;

                    try {
                        authUnsubscribe =
                            authInstance
                                .onAuthStateChanged(
                                    async firebaseUser => {
                                        try {
                                            const user =
                                                await applyFirebaseUser(
                                                    firebaseUser
                                                );

                                            if (
                                                !initialStateResolved
                                            ) {
                                                initialStateResolved =
                                                    true;

                                                resolve(
                                                    user
                                                );
                                            }
                                        } catch (error) {
                                            handleAuthStateError(
                                                error
                                            );

                                            if (
                                                !initialStateResolved
                                            ) {
                                                initialStateResolved =
                                                    true;

                                                reject(
                                                    error
                                                );
                                            }
                                        }
                                    },

                                    error => {
                                        handleAuthStateError(
                                            error
                                        );

                                        if (
                                            !initialStateResolved
                                        ) {
                                            initialStateResolved =
                                                true;

                                            reject(
                                                error
                                            );
                                        }
                                    }
                                );

                        isInitialized =
                            true;

                        void consumeRedirectResult();
                    } catch (error) {
                        authReadyPromise =
                            null;

                        isInitialized =
                            false;

                        reject(
                            error
                        );
                    }
                }
            );

        return authReadyPromise;
    }

    /* =====================================================
       GOOGLE LOGIN
    ===================================================== */

    async function loginWithGoogle() {
        try {
            await init();

            const provider =
                createGoogleProvider();

            const result =
                await authInstance
                    .signInWithPopup(
                        provider
                    );

            if (
                !result?.user
            ) {
                throw new Error(
                    "Google did not return an authenticated user."
                );
            }

            const user =
                await applyFirebaseUser(
                    result.user
                );

            dispatchAuthEvent(
                "auth:google-login-success",
                {
                    user,

                    method:
                        "popup"
                }
            );

            return user;
        } catch (error) {
            const redirectErrorCodes =
                new Set([
                    "auth/popup-blocked",
                    "auth/operation-not-supported-in-this-environment",
                    "auth/web-storage-unsupported"
                ]);

            if (
                redirectErrorCodes.has(
                    error?.code
                ) &&
                authInstance
            ) {
                try {
                    await authInstance
                        .signInWithRedirect(
                            createGoogleProvider()
                        );

                    return null;
                } catch (
                    redirectError
                ) {
                    console.error(
                        "[AuthService] Google redirect login failed.",
                        redirectError
                    );

                    dispatchAuthEvent(
                        "auth:google-login-error",
                        {
                            error:
                                redirectError,

                            method:
                                "redirect"
                        }
                    );

                    return null;
                }
            }

            console.error(
                "[AuthService] Google login failed.",
                error
            );

            dispatchAuthEvent(
                "auth:google-login-error",
                {
                    error,

                    method:
                        "popup"
                }
            );

            return null;
        }
    }

    /* =====================================================
       LOGOUT
    ===================================================== */

    async function logout() {
        try {
            await init();

            dispatchAuthEvent(
                "auth:before-logout",
                {
                    user:
                        currentUser
                }
            );

            await authInstance
                .signOut();

            /*
             * onAuthStateChanged normally applies this state.
             * Applying it here also keeps logout deterministic
             * if listener delivery is delayed.
             */

            await applyFirebaseUser(
                null
            );

            dispatchAuthEvent(
                "auth:logout-success"
            );

            return true;
        } catch (error) {
            console.error(
                "[AuthService] Logout failed.",
                error
            );

            dispatchAuthEvent(
                "auth:logout-error",
                {
                    error
                }
            );

            return false;
        }
    }

    /* =====================================================
       USER ACCESS
    ===================================================== */

    function getUser() {
        return currentUser;
    }

    function getCurrentUser() {
        return currentUser;
    }

    function getFirebaseUser() {
        return (
            authInstance
                ?.currentUser ||
            null
        );
    }

    function isLoggedIn() {
        return Boolean(
            currentUser?.uid
        );
    }

    function isGoogleConnected() {
        return Boolean(
            currentUser
                ?.isGoogleConnected
        );
    }

    function isGoogleSignIn() {
        return Boolean(
            currentUser
                ?.isGoogleSignIn
        );
    }

    function isEmailVerified() {
        return Boolean(
            currentUser
                ?.emailVerified
        );
    }

    function whenReady() {
        return init();
    }

    /* =====================================================
       TOKEN ACCESS
    ===================================================== */

    async function getIdToken(
        forceRefresh = false
    ) {
        try {
            await init();

            const firebaseUser =
                getFirebaseUser();

            if (
                !firebaseUser ||
                typeof firebaseUser
                    .getIdToken !==
                    "function"
            ) {
                return "";
            }

            return await firebaseUser
                .getIdToken(
                    Boolean(
                        forceRefresh
                    )
                );
        } catch (error) {
            console.error(
                "[AuthService] Firebase ID token could not be retrieved.",
                error
            );

            return "";
        }
    }

    /* =====================================================
       CLEANUP
    ===================================================== */

    function destroy() {
        if (
            typeof authUnsubscribe ===
                "function"
        ) {
            try {
                authUnsubscribe();
            } catch {
                /*
                 * No additional cleanup required.
                 */
            }
        }

        authUnsubscribe =
            null;

        unbindProfileEvents();

        authInstance =
            null;

        currentUser =
            null;

        authReadyPromise =
            null;

        redirectResultPromise =
            null;

        isInitialized =
            false;

        lastStateSignature =
            "";

        return true;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,

        loginWithGoogle,
        logout,

        getUser,
        getCurrentUser,
        getFirebaseUser,

        isLoggedIn,
        isGoogleConnected,
        isGoogleSignIn,
        isEmailVerified,

        getIdToken,
        whenReady,

        isInitialized() {
            return isInitialized;
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.AuthService =
    AuthService;