"use strict";

/* =========================================================
   11PLAY — PROFILE MODULE
   File: js/account/profile/profile.module.js

   Responsibilities:
   - Initialize the Profile page runtime
   - Display Guest and verified Google-user states
   - Initialize ProfileDB
   - Synchronize Firestore-authoritative Profile data
   - Submit one-time mobile numbers through ProfileDB
   - Handle Google sign-in and logout
   - Subscribe to Profile data changes
   - Clean up only Profile-page listeners and UI runtime

   Profile scope:
   - Profile photo
   - Username
   - Name
   - Registration Date
   - Mobile
   - Gmail
   - Last Login
   - Account Type

   Important:
   - No private profile data is stored in localStorage
   - No referral system exists here
   - No reward system exists here
   - No activity/statistics system exists here
   - No wallet/withdrawal system exists here
   - No direct Firestore write occurs here
   - ProfileDB and AuthService remain app-level services
========================================================= */

const ProfileModule = (() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const LEGACY_STORAGE_KEYS =
        Object.freeze([
            "11play.profile.data",
            "11play.profile.activeUsingTime",
            "profile_user",
            "profile_start_time"
        ]);

    const AUTH_EVENTS =
        Object.freeze([
            "auth:state-changed",
            "profile:auth-changed",
            "auth:signed-in",
            "auth:signed-out",
            "profile:logout"
        ]);

    const PROFILE_REFRESH_EVENTS =
        Object.freeze([
            "profile:data-changed",
            "profile:mobile-saved"
        ]);

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    const state = {
        initialized:
            false,

        page:
            null,

        listeners:
            [],

        profileUnsubscribe:
            null,

        pageObserver:
            null,

        readyPromise:
            null,

        currentProfile:
            createGuestProfile(),

        currentUid:
            "",

        lifecycleGeneration:
            0,

        authGeneration:
            0,

        activeAuthUid:
            "",

        activeAuthPromise:
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

        const normalizedValue =
            String(value)
                .normalize("NFKC")
                .trim();

        return (
            normalizedValue ||
            fallback
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
                JSON.stringify(
                    value
                )
            );
        } catch {
            return value;
        }
    }

    function firstDefined(
        ...values
    ) {
        for (
            const value of values
        ) {
            if (
                value !== undefined &&
                value !== null &&
                value !== ""
            ) {
                return value;
            }
        }

        return undefined;
    }

    /* =====================================================
       GUEST PROFILE
    ===================================================== */

    function createGuestProfile() {
        return {
            isAuthenticated:
                false,

            authenticated:
                false,

            uid:
                "",

            displayName:
                "Guest User",

            username:
                "11guest-xxxxxx",

            email:
                "",

            photoURL:
                "",

            mobileNumber:
                "",

            isMobileLocked:
                false,

            mobileAdded:
                false,

            mobileLocked:
                false,

            registrationDate:
                null,

            accountType:
                "guest",

            lastLogin:
                null
        };
    }

    /* =====================================================
       LEGACY STORAGE CLEANUP
    ===================================================== */

    function removeLegacyStorage() {
        try {
            LEGACY_STORAGE_KEYS.forEach(
                storageKey => {
                    window.localStorage
                        ?.removeItem(
                            storageKey
                        );
                }
            );
        } catch {
            /*
             * Storage may be unavailable.
             */
        }

        return true;
    }

    /* =====================================================
       MANAGED EVENT LISTENERS
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
                    element
                        .removeEventListener(
                            eventName,
                            handler,
                            options
                        );
                } catch {
                    /*
                     * No additional cleanup required.
                     */
                }
            }
        );

        state.listeners =
            [];

        return true;
    }

    /* =====================================================
       AUTH USER
    ===================================================== */

    function resolveAuthUser() {
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
                const currentUser =
                    authService
                        .getCurrentUser();

                if (
                    currentUser?.uid
                ) {
                    return currentUser;
                }
            } catch {
                /*
                 * Continue to Firebase user.
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
                const firebaseUser =
                    authService
                        .getFirebaseUser();

                if (
                    firebaseUser?.uid
                ) {
                    return firebaseUser;
                }
            } catch {
                /*
                 * Continue to configured Auth.
                 */
            }
        }

        const configuredAuth =
            window.FirebaseConfig
                ?.auth ||
            window.firebaseAuth ||
            null;

        return (
            configuredAuth
                ?.currentUser ||
            null
        );
    }

    async function waitForAuthReady() {
        const authService =
            window.AuthService ||
            null;

        if (
            authService &&
            typeof authService
                .init ===
                "function"
        ) {
            try {
                await authService
                    .init();
            } catch {
                /*
                 * whenReady may still resolve.
                 */
            }
        }

        if (
            authService &&
            typeof authService
                .whenReady ===
                "function"
        ) {
            try {
                await authService
                    .whenReady();
            } catch {
                /*
                 * Guest UI remains available.
                 */
            }
        }

        return resolveAuthUser();
    }

    function extractEventUser(event) {
        const detail =
            event?.detail;

        if (
            detail?.user?.uid
        ) {
            return detail.user;
        }

        if (
            detail?.profile?.uid
        ) {
            return detail.profile;
        }

        if (
            detail?.uid
        ) {
            return detail;
        }

        return resolveAuthUser();
    }

    /* =====================================================
       PROFILE DATA EXTRACTION
    ===================================================== */

    function extractProfile(value) {
        if (!value) {
            return null;
        }

        if (
            isPlainObject(
                value.profile
            )
        ) {
            return value.profile;
        }

        if (
            isPlainObject(
                value.data?.profile
            )
        ) {
            return value.data.profile;
        }

        if (
            isPlainObject(
                value.user
            ) &&
            value.user.uid
        ) {
            return value.user;
        }

        if (
            isPlainObject(value) &&
            (
                value.uid ||
                value.userId ||
                value.email ||
                value.mobileNumber ||
                value.mobile
            )
        ) {
            return value;
        }

        return null;
    }

    function readProfileDBProfile() {
        const profileDB =
            window.ProfileDB;

        if (!profileDB) {
            return null;
        }

        const methods = [
            "getProfile",
            "getUser",
            "getCurrentUser"
        ];

        for (
            const methodName of
                methods
        ) {
            if (
                typeof profileDB[
                    methodName
                ] !==
                    "function"
            ) {
                continue;
            }

            try {
                const profile =
                    profileDB[
                        methodName
                    ]();

                if (profile) {
                    return profile;
                }
            } catch {
                /*
                 * Continue to next source.
                 */
            }
        }

        return null;
    }

    function readProfileServiceProfile() {
        const profileService =
            window.ProfileService;

        if (
            !profileService ||
            typeof profileService
                .getUser !==
                "function"
        ) {
            return null;
        }

        try {
            return (
                profileService
                    .getUser() ||
                null
            );
        } catch {
            return null;
        }
    }

    function readCurrentProfile() {
        return (
            readProfileDBProfile() ||
            readProfileServiceProfile() ||
            null
        );
    }

    /* =====================================================
       PROFILE AUTHENTICATION STATE
    ===================================================== */

    function isAuthenticatedProfile(
        profile,
        authUser =
            resolveAuthUser()
    ) {
        const profileUid =
            normalizeString(
                profile?.uid ||
                profile?.userId
            );

        const authUid =
            normalizeString(
                authUser?.uid
            );

        if (
            profile
                ?.isAuthenticated ===
                    true ||
            profile
                ?.authenticated ===
                    true
        ) {
            return Boolean(
                profileUid ||
                authUid
            );
        }

        return Boolean(
            profileUid &&
            authUid &&
            profileUid ===
                authUid
        );
    }

    /* =====================================================
       UI PROFILE CREATION
    ===================================================== */

    function buildUIProfile(
        profileCandidate,
        authUser =
            resolveAuthUser()
    ) {
        const profile =
            extractProfile(
                profileCandidate
            ) ||
            (
                isPlainObject(
                    profileCandidate
                )
                    ? profileCandidate
                    : {}
            );

        const authUid =
            normalizeString(
                authUser?.uid
            );

        const profileUid =
            normalizeString(
                profile.uid ||
                profile.userId
            );

        if (
            profileUid &&
            authUid &&
            profileUid !==
                authUid
        ) {
            return createGuestProfile();
        }

        const authenticated =
            isAuthenticatedProfile(
                profile,
                authUser
            );

        const uid =
            profileUid ||
            authUid;

        if (
            !authenticated ||
            !uid
        ) {
            return createGuestProfile();
        }

        const authMetadata =
            authUser?.metadata ||
            {};

        const mobileNumber =
            normalizeString(
                profile.mobileNumber ||
                profile.mobile
            );

        const mobileLocked =
            profile.isMobileLocked ===
                true ||
            profile.mobileLocked ===
                true ||
            Boolean(
                mobileNumber
            );

        return {
            ...profile,

            isAuthenticated:
                true,

            authenticated:
                true,

            uid,

            displayName:
                normalizeString(
                    profile.displayName ||
                    profile.name ||
                    authUser?.displayName,
                    "Google User"
                ),

            email:
                normalizeString(
                    profile.email ||
                    authUser?.email
                )
                    .toLowerCase(),

            photoURL:
                normalizeString(
                    profile.photoURL ||
                    profile.photo ||
                    authUser?.photoURL
                ),

            mobileNumber,

            isMobileLocked:
                mobileLocked,

            mobileAdded:
                profile.mobileAdded ===
                    true ||
                Boolean(
                    mobileNumber
                ),

            mobileLocked,

            registrationDate:
                firstDefined(
                    profile.registrationDate,
                    profile.createdAt,
                    authMetadata.creationTime
                ) ||
                null,

            accountType:
                normalizeString(
                    profile.accountType,
                    "google"
                ),

            lastLogin:
                firstDefined(
                    profile.lastLogin,
                    profile.lastLoginAt,
                    authMetadata.lastSignInTime,
                    profile.registrationDate,
                    profile.createdAt
                ) ||
                null
        };
    }

    /* =====================================================
       PROFILE UI
    ===================================================== */

    function initializeProfileUI(
        profile
    ) {
        if (
            !window.ProfileUI ||
            typeof window.ProfileUI
                .initialize !==
                "function"
        ) {
            console.error(
                "[ProfileModule] ProfileUI is unavailable."
            );

            return false;
        }

        const initialized =
            window.ProfileUI
                .initialize({
                    root:
                        state.page,

                    profile,

                    onSignIn:
                        signInWithGoogle,

                    onLogout:
                        logout,

                    onSaveMobile:
                        saveMobileNumber
                });

        return (
            initialized !==
            false
        );
    }

    function renderProfile(profile) {
        if (
            !state.initialized ||
            !state.page ||
            !state.page.isConnected
        ) {
            return false;
        }

        const normalizedProfile =
            buildUIProfile(
                profile
            );

        state.currentProfile =
            normalizedProfile;

        state.currentUid =
            normalizeString(
                normalizedProfile.uid
            );

        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .render ===
                "function"
        ) {
            window.ProfileUI
                .render(
                    normalizedProfile
                );
        }

        return normalizedProfile;
    }

    function renderGuestState() {
        const guestProfile =
            createGuestProfile();

        state.currentUid =
            "";

        state.currentProfile =
            guestProfile;

        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .renderGuest ===
                "function"
        ) {
            window.ProfileUI
                .renderGuest(
                    guestProfile
                );
        } else if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .render ===
                "function"
        ) {
            window.ProfileUI
                .render(
                    guestProfile
                );
        }

        return guestProfile;
    }

    /* =====================================================
       AUTH ACTIONS
    ===================================================== */

    async function signInWithGoogle() {
        const authService =
            window.AuthService;

        if (
            !authService ||
            typeof authService
                .loginWithGoogle !==
                "function"
        ) {
            throw new Error(
                "Google sign-in service is unavailable."
            );
        }

        return authService
            .loginWithGoogle();
    }

    async function logout() {
        const authService =
            window.AuthService;

        if (
            !authService ||
            typeof authService
                .logout !==
                "function"
        ) {
            throw new Error(
                "Logout service is unavailable."
            );
        }

        return authService
            .logout();
    }

    /* =====================================================
       MOBILE NUMBER
    ===================================================== */

    async function saveMobileNumber(
        mobileNumber
    ) {
        const profileDB =
            window.ProfileDB;

        if (
            !profileDB ||
            typeof profileDB
                .saveMobileNumber !==
                "function"
        ) {
            throw new Error(
                "Profile mobile service is unavailable."
            );
        }

        const authUser =
            resolveAuthUser();

        if (!authUser?.uid) {
            throw new Error(
                "Sign in with Google before saving a mobile number."
            );
        }

        const result =
            await profileDB
                .saveMobileNumber(
                    mobileNumber
                );

        const returnedProfile =
            extractProfile(
                result
            );

        if (returnedProfile) {
            renderProfile(
                returnedProfile
            );
        } else {
            await refreshProfile();
        }

        window.dispatchEvent(
            new CustomEvent(
                "profile:mobile-saved",
                {
                    detail: {
                        uid:
                            authUser.uid
                    }
                }
            )
        );

        return result;
    }

    /* =====================================================
       PROFILE SUBSCRIPTION
    ===================================================== */

    function handleProfileSubscription(
        payload
    ) {
        if (
            !state.initialized
        ) {
            return;
        }

        const profile =
            extractProfile(
                payload
            ) ||
            readCurrentProfile();

        if (!profile) {
            return;
        }

        const authUid =
            normalizeString(
                resolveAuthUser()
                    ?.uid
            );

        const profileUid =
            normalizeString(
                profile.uid ||
                profile.userId
            );

        if (
            authUid &&
            profileUid &&
            authUid !==
                profileUid
        ) {
            return;
        }

        renderProfile(
            profile
        );
    }

    function bindServiceSubscriptions() {
        const profileDB =
            window.ProfileDB;

        if (
            !state.profileUnsubscribe &&
            profileDB &&
            typeof profileDB
                .subscribe ===
                "function"
        ) {
            try {
                state.profileUnsubscribe =
                    profileDB
                        .subscribe(
                            handleProfileSubscription
                        );
            } catch {
                state.profileUnsubscribe =
                    null;
            }
        }

        return true;
    }

    function unbindServiceSubscriptions() {
        if (
            typeof state
                .profileUnsubscribe ===
                "function"
        ) {
            try {
                state.profileUnsubscribe();
            } catch {
                /*
                 * No additional cleanup required.
                 */
            }
        }

        state.profileUnsubscribe =
            null;

        return true;
    }

    /* =====================================================
       PROFILE DB INITIALIZATION
    ===================================================== */

    async function initializeProfileDB() {
        const profileDB =
            window.ProfileDB;

        if (!profileDB) {
            throw new Error(
                "ProfileDB is unavailable."
            );
        }

        if (
            typeof profileDB
                .init ===
                "function"
        ) {
            await profileDB
                .init();
        }

        if (
            typeof profileDB
                .whenReady ===
                "function"
        ) {
            await profileDB
                .whenReady();
        }

        return profileDB;
    }

    /* =====================================================
       OPERATION GUARD
    ===================================================== */

    function isCurrentOperation(
        lifecycleGeneration,
        authGeneration,
        expectedUid = ""
    ) {
        if (
            !state.initialized ||
            lifecycleGeneration !==
                state.lifecycleGeneration ||
            authGeneration !==
                state.authGeneration
        ) {
            return false;
        }

        if (
            expectedUid &&
            resolveAuthUser()?.uid !==
                expectedUid
        ) {
            return false;
        }

        return true;
    }

    /* =====================================================
       AUTHENTICATED USER INITIALIZATION
    ===================================================== */

    async function initializeAuthenticatedUser(
        user
    ) {
        const uid =
            normalizeString(
                user?.uid
            );

        if (!uid) {
            renderGuestState();

            return false;
        }

        if (
            state.activeAuthPromise &&
            state.activeAuthUid ===
                uid
        ) {
            return state
                .activeAuthPromise;
        }

        const lifecycleGeneration =
            state.lifecycleGeneration;

        const authGeneration =
            ++state.authGeneration;

        state.activeAuthUid =
            uid;

        state.currentUid =
            uid;

        /*
         * Render trusted Firebase Authentication
         * fields immediately.
         */

        renderProfile({
            uid,

            isAuthenticated:
                true,

            authenticated:
                true,

            displayName:
                user.displayName,

            email:
                user.email,

            photoURL:
                user.photoURL,

            registrationDate:
                user.metadata
                    ?.creationTime ||
                null,

            lastLogin:
                user.metadata
                    ?.lastSignInTime ||
                null,

            accountType:
                "google"
        });

        let authPromise =
            null;

        authPromise =
            (async () => {
                try {
                    const profileDB =
                        await initializeProfileDB();

                    if (
                        !isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        )
                    ) {
                        return false;
                    }

                    let ensuredProfile =
                        null;

                    if (
                        typeof profileDB
                            .ensureProfile ===
                            "function"
                    ) {
                        const ensureResult =
                            await profileDB
                                .ensureProfile();

                        ensuredProfile =
                            extractProfile(
                                ensureResult
                            );
                    }

                    if (
                        !isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        )
                    ) {
                        return false;
                    }

                    if (
                        ensuredProfile
                    ) {
                        renderProfile(
                            ensuredProfile
                        );
                    }

                    let refreshResult =
                        null;

                    if (
                        typeof profileDB
                            .refresh ===
                            "function"
                    ) {
                        refreshResult =
                            await profileDB
                                .refresh();
                    }

                    if (
                        !isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        )
                    ) {
                        return false;
                    }

                    const refreshedProfile =
                        extractProfile(
                            refreshResult
                        ) ||
                        readCurrentProfile();

                    if (
                        refreshedProfile
                    ) {
                        renderProfile(
                            refreshedProfile
                        );
                    }

                    return true;
                } catch (error) {
                    if (
                        isCurrentOperation(
                            lifecycleGeneration,
                            authGeneration,
                            uid
                        ) &&
                        window.ProfileUI &&
                        typeof window.ProfileUI
                            .showStatus ===
                            "function"
                    ) {
                        window.ProfileUI
                            .showStatus(
                                normalizeString(
                                    error?.message,
                                    "Profile information could not be loaded."
                                ),
                                "error",
                                6000
                            );
                    }

                    return false;
                } finally {
                    if (
                        state.activeAuthPromise ===
                        authPromise
                    ) {
                        state.activeAuthPromise =
                            null;

                        state.activeAuthUid =
                            "";
                    }
                }
            })();

        state.activeAuthPromise =
            authPromise;

        state.readyPromise =
            authPromise;

        return authPromise;
    }

    /* =====================================================
       AUTH SYNCHRONIZATION
    ===================================================== */

    function synchronizeAuthState(
        user
    ) {
        const currentUser =
            user?.uid
                ? user
                : resolveAuthUser();

        if (!currentUser?.uid) {
            state.authGeneration +=
                1;

            state.activeAuthUid =
                "";

            state.activeAuthPromise =
                null;

            renderGuestState();

            return Promise.resolve(
                false
            );
        }

        return initializeAuthenticatedUser(
            currentUser
        );
    }

    function handleAuthEvent(
        event
    ) {
        if (
            !state.initialized
        ) {
            return;
        }

        const user =
            extractEventUser(
                event
            );

        void synchronizeAuthState(
            user
        );
    }

    function handleProfileRefreshEvent() {
        if (
            !state.initialized
        ) {
            return;
        }

        const profile =
            readCurrentProfile();

        if (profile) {
            renderProfile(
                profile
            );

            return;
        }

        if (
            !resolveAuthUser()?.uid
        ) {
            renderGuestState();
        }
    }

    function bindBrowserEvents() {
        AUTH_EVENTS.forEach(
            eventName => {
                addManagedListener(
                    window,
                    eventName,
                    handleAuthEvent
                );
            }
        );

        PROFILE_REFRESH_EVENTS.forEach(
            eventName => {
                addManagedListener(
                    window,
                    eventName,
                    handleProfileRefreshEvent
                );
            }
        );

        return true;
    }

    /* =====================================================
       MANUAL PROFILE REFRESH
    ===================================================== */

    async function refreshProfile() {
        const user =
            resolveAuthUser();

        if (!user?.uid) {
            renderGuestState();

            return cloneValue(
                state.currentProfile
            );
        }

        const profileDB =
            await initializeProfileDB();

        let refreshResult =
            null;

        if (
            typeof profileDB
                .refresh ===
                "function"
        ) {
            refreshResult =
                await profileDB
                    .refresh();
        }

        const profile =
            extractProfile(
                refreshResult
            ) ||
            readCurrentProfile();

        if (profile) {
            renderProfile(
                profile
            );
        } else {
            renderProfile({
                uid:
                    user.uid,

                isAuthenticated:
                    true,

                authenticated:
                    true,

                displayName:
                    user.displayName,

                email:
                    user.email,

                photoURL:
                    user.photoURL,

                registrationDate:
                    user.metadata
                        ?.creationTime ||
                    null,

                lastLogin:
                    user.metadata
                        ?.lastSignInTime ||
                    null,

                accountType:
                    "google"
            });
        }

        return cloneValue(
            state.currentProfile
        );
    }

    /* =====================================================
       PAGE REMOVAL OBSERVER
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
                        state.lifecycleGeneration !==
                            observedGeneration ||
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

    function init() {
        destroy();

        const page =
            document.getElementById(
                "profilePage"
            );

        if (!page) {
            console.error(
                "[ProfileModule] ProfileView must be rendered before ProfileModule.init()."
            );

            return false;
        }

        /*
         * Remove old local Profile/activity remnants.
         * Current Profile data remains Firebase-authoritative.
         */

        removeLegacyStorage();

        state.lifecycleGeneration +=
            1;

        const lifecycleGeneration =
            state.lifecycleGeneration;

        state.page =
            page;

        state.initialized =
            true;

        const initialAuthUser =
            resolveAuthUser();

        const initialProfile =
            buildUIProfile(
                readCurrentProfile(),
                initialAuthUser
            );

        state.currentProfile =
            initialProfile;

        state.currentUid =
            normalizeString(
                initialProfile.uid
            );

        if (
            !initializeProfileUI(
                initialProfile
            )
        ) {
            destroy();

            return false;
        }

        bindServiceSubscriptions();
        bindBrowserEvents();
        observePageRemoval();

        state.readyPromise =
            (async () => {
                const user =
                    await waitForAuthReady();

                if (
                    !state.initialized ||
                    lifecycleGeneration !==
                        state.lifecycleGeneration
                ) {
                    return false;
                }

                return synchronizeAuthState(
                    user
                );
            })()
                .catch(
                    error => {
                        if (
                            state.initialized &&
                            lifecycleGeneration ===
                                state.lifecycleGeneration &&
                            window.ProfileUI &&
                            typeof window.ProfileUI
                                .showStatus ===
                                "function"
                        ) {
                            window.ProfileUI
                                .showStatus(
                                    normalizeString(
                                        error?.message,
                                        "Profile initialization failed."
                                    ),
                                    "error",
                                    6000
                                );
                        }

                        return false;
                    }
                );

        return true;
    }

    function whenReady() {
        return (
            state.readyPromise ||
            Promise.resolve(
                state.initialized
            )
        );
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    function destroy() {
        state.lifecycleGeneration +=
            1;

        state.authGeneration +=
            1;

        state.activeAuthUid =
            "";

        state.activeAuthPromise =
            null;

        state.readyPromise =
            null;

        removeManagedListeners();
        unbindServiceSubscriptions();

        if (
            state.pageObserver
        ) {
            state.pageObserver
                .disconnect();

            state.pageObserver =
                null;
        }

        if (
            window.ProfileUI &&
            typeof window.ProfileUI
                .destroy ===
                "function" &&
            (
                typeof window.ProfileUI
                    .isInitialized !==
                    "function" ||
                window.ProfileUI
                    .isInitialized()
            )
        ) {
            window.ProfileUI
                .destroy();
        }

        state.initialized =
            false;

        state.page =
            null;

        state.currentUid =
            "";

        state.currentProfile =
            createGuestProfile();

        return true;
    }

    function isInitialized() {
        return state.initialized;
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    return Object.freeze({
        init,
        destroy,
        whenReady,
        isInitialized,

        refresh:
            refreshProfile,

        refreshProfile,
        saveMobileNumber,

        getCurrentProfile() {
            return cloneValue(
                state.currentProfile
            );
        },

        getCurrentUid() {
            return state.currentUid;
        }
    });
})();

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.ProfileModule =
    ProfileModule;