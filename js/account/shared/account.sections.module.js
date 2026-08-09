/* =========================================================
   11PLAY — SHARED ACCOUNT SECTIONS MODULE
   File: js/account/shared/account.sections.module.js

   Shared by:
   - Profile
   - Referral Statistics
   - Reward Center
   - Withdraw History
   - Referral Rules

   Referral rules:
   - Guest users use the canonical 11Play main-site URL.
   - Guest users never receive an Admin profile referral link.
   - Verified Google users use their own unique referral link.
   - ReferralDB remains the referral identity authority.
   - Existing UI/design structure remains unchanged.
========================================================= */

const AccountSectionsModule = (() => {
    "use strict";

    const CONFIG = Object.freeze({
        rewardRecordCount: 220,
        visibleRewardRows: 4,
        autoScrollInterval: 1000,
        autoScrollDuration: 420,
        manualScrollPause: 4000,

        rewardStorageKey:
            "11play.profile.liveRewards.v4",

        legacyRewardStorageKeys:
            Object.freeze([
                "11play.profile.liveRewards",
                "11play.profile.liveRewards.v2",
                "11play.profile.liveRewards.v3"
            ])
    });

    const CANONICAL_REFERRAL_BASE_URL =
        "https://11play.github.io/11play/";

    const REFERRAL_QUERY_PARAMETER =
        "ref";

    const REFERRAL_SOURCE_GUEST =
        "guest";

    const REFERRAL_SOURCE_USER =
        "user";

    const SUPPORTED_PAGES =
        Object.freeze([
            "profile",
            "referral-statistics",
            "reward-center",
            "withdraw-history",
            "referral-rules"
        ]);

    const PAGE_ALIASES =
        Object.freeze({
            referral:
                "referral-statistics",

            reward:
                "reward-center",

            withdrawal:
                "withdraw-history",

            withdraw:
                "withdraw-history",

            rules:
                "referral-rules"
        });

    const ALLOWED_REWARD_AMOUNTS =
        Object.freeze([
            1000,
            2000,
            3000,
            4000,
            5000,
            6000
        ]);

    const REWARD_DISTRIBUTION =
        Object.freeze([
            Object.freeze({
                amount:
                    1000,

                count:
                    82
            }),

            Object.freeze({
                amount:
                    2000,

                count:
                    64
            }),

            Object.freeze({
                amount:
                    3000,

                count:
                    46
            }),

            Object.freeze({
                amount:
                    4000,

                count:
                    20
            }),

            Object.freeze({
                amount:
                    5000,

                count:
                    5
            }),

            Object.freeze({
                amount:
                    6000,

                count:
                    3
            })
        ]);

    const state = {
        initialized:
            false,

        root:
            null,

        sectionsRoot:
            null,

        currentPage:
            "profile",

        referralLink:
            "",

        referralSource:
            "",

        referralOperationGeneration:
            0,

        referralRequestPromise:
            null,

        referralRequestUid:
            "",

        referralRequestMode:
            "",

        listeners:
            [],

        rewardRecords:
            [],

        rewardViewport:
            null,

        rewardList:
            null,

        rewardEventsBoundTo:
            null,

        rewardRowHeight:
            0,

        rewardCurrentIndex:
            0,

        rewardAutoScrollTimer:
            null,

        rewardResetTimer:
            null,

        rewardPauseUntil:
            0,

        rewardIsAutoScrolling:
            false,

        sectionObserver:
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

        const normalized =
            String(value)
                .normalize("NFKC")
                .trim();

        return normalized ||
            fallback;
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

    function normalizePage(page) {
        const normalized =
            normalizeString(page)
                .toLowerCase()
                .replace(
                    /[\s_]+/g,
                    "-"
                );

        const canonical =
            PAGE_ALIASES[
                normalized
            ] ||
            normalized;

        return SUPPORTED_PAGES
            .includes(
                canonical
            )
            ? canonical
            : "profile";
    }

    function normalizeReferralLink(
        value
    ) {
        const referralLink =
            normalizeString(
                value
            );

        if (!referralLink) {
            return "";
        }

        try {
            const url =
                new URL(
                    referralLink,
                    CANONICAL_REFERRAL_BASE_URL
                );

            const canonicalURL =
                new URL(
                    CANONICAL_REFERRAL_BASE_URL
                );

            if (
                url.protocol !==
                    "https:" ||
                url.origin !==
                    canonicalURL.origin ||
                url.pathname !==
                    canonicalURL.pathname
            ) {
                return "";
            }

            url.hash =
                "";

            return url.toString();
        } catch {
            return "";
        }
    }

    function normalizeReferralCode(
        value
    ) {
        return normalizeString(
            value
        )
            .toUpperCase()
            .replace(
                /[^A-HJ-NP-Z2-9]/g,
                ""
            );
    }

    function isValidReferralCode(
        value
    ) {
        return /^[A-HJ-NP-Z2-9]{8}$/
            .test(
                normalizeReferralCode(
                    value
                )
            );
    }

    function buildCanonicalReferralLink(
        referralCode
    ) {
        const normalizedCode =
            normalizeReferralCode(
                referralCode
            );

        if (
            !isValidReferralCode(
                normalizedCode
            )
        ) {
            return "";
        }

        try {
            const url =
                new URL(
                    CANONICAL_REFERRAL_BASE_URL
                );

            url.searchParams.set(
                REFERRAL_QUERY_PARAMETER,
                normalizedCode
            );

            url.hash =
                "";

            return url.toString();
        } catch {
            return "";
        }
    }

    function createGuestReferralIdentity() {
        return {
            referralCode:
                "",

            referralLink:
                CANONICAL_REFERRAL_BASE_URL,

            referralSource:
                REFERRAL_SOURCE_GUEST,

            source:
                REFERRAL_SOURCE_GUEST,

            isGuestReferral:
                true,

            isPublicAdminReferral:
                false
        };
    }

    function randomInteger(
        minimumValue,
        maximumValue
    ) {
        const minimum =
            Math.ceil(
                Number(
                    minimumValue
                ) || 0
            );

        const maximum =
            Math.floor(
                Number(
                    maximumValue
                ) || 0
            );

        if (
            maximum <=
            minimum
        ) {
            return minimum;
        }

        const range =
            maximum -
            minimum +
            1;

        if (
            window.crypto &&
            typeof window.crypto
                .getRandomValues ===
                "function"
        ) {
            const values =
                new Uint32Array(1);

            window.crypto
                .getRandomValues(
                    values
                );

            return (
                minimum +
                (
                    values[0] %
                    range
                )
            );
        }

        return (
            Math.floor(
                Math.random() *
                range
            ) +
            minimum
        );
    }

    function shuffleArray(items) {
        const shuffled =
            [...items];

        for (
            let index =
                shuffled.length -
                1;

            index > 0;

            index -= 1
        ) {
            const randomIndex =
                randomInteger(
                    0,
                    index
                );

            [
                shuffled[index],
                shuffled[
                    randomIndex
                ]
            ] = [
                shuffled[
                    randomIndex
                ],
                shuffled[index]
            ];
        }

        return shuffled;
    }

    function formatRewardAmount(
        amount
    ) {
        const numericAmount =
            Math.max(
                0,
                Math.floor(
                    Number(amount) ||
                    0
                )
            );

        return new Intl
            .NumberFormat(
                "en-BD",
                {
                    style:
                        "currency",

                    currency:
                        "BDT",

                    currencyDisplay:
                        "narrowSymbol",

                    minimumFractionDigits:
                        0,

                    maximumFractionDigits:
                        0
                }
            )
            .format(
                numericAmount
            );
    }

    function isAllowedRewardAmount(
        amount
    ) {
        const numericAmount =
            Number(amount);

        return (
            Number.isInteger(
                numericAmount
            ) &&
            ALLOWED_REWARD_AMOUNTS
                .includes(
                    numericAmount
                )
        );
    }

    /* =====================================================
       SESSION STORAGE
    ===================================================== */

    function getSessionStorage() {
        try {
            const storage =
                window
                    .sessionStorage;

            const key =
                "__11play_account_sections_test__";

            storage.setItem(
                key,
                "1"
            );

            storage.removeItem(
                key
            );

            return storage;
        } catch {
            return null;
        }
    }

    function readStoredJSON(
        key,
        fallback
    ) {
        const storage =
            getSessionStorage();

        if (!storage) {
            return fallback;
        }

        try {
            const rawValue =
                storage.getItem(
                    key
                );

            return rawValue
                ? JSON.parse(
                    rawValue
                )
                : fallback;
        } catch (error) {
            console.warn(
                `[AccountSectionsModule] Unable to read "${key}".`,
                error
            );

            return fallback;
        }
    }

    function writeStoredJSON(
        key,
        value
    ) {
        const storage =
            getSessionStorage();

        if (!storage) {
            return false;
        }

        try {
            storage.setItem(
                key,
                JSON.stringify(
                    value
                )
            );

            return true;
        } catch (error) {
            console.warn(
                `[AccountSectionsModule] Unable to save "${key}".`,
                error
            );

            return false;
        }
    }

    function removeStoredItem(key) {
        const storage =
            getSessionStorage();

        if (!storage) {
            return false;
        }

        try {
            storage.removeItem(
                key
            );

            return true;
        } catch {
            return false;
        }
    }

    /* =====================================================
       DOM AND MANAGED LISTENERS
    ===================================================== */

    function resolveRoot(root) {
        if (
            root instanceof
            HTMLElement
        ) {
            return root;
        }

        if (
            typeof root ===
                "string" &&
            root.trim()
        ) {
            return document
                .querySelector(
                    root.trim()
                );
        }

        return (
            document.getElementById(
                "app-view"
            ) ||
            document.getElementById(
                "appContent"
            ) ||
            document.getElementById(
                "mainContent"
            ) ||
            document.getElementById(
                "app"
            ) ||
            null
        );
    }

    function resolveSectionsRoot(
        root
    ) {
        if (
            !(root instanceof
                HTMLElement)
        ) {
            return null;
        }

        return root.id ===
            "accountSections"
            ? root
            : root.querySelector(
                "#accountSections"
            );
    }

    function getElement(id) {
        if (!state.sectionsRoot) {
            return null;
        }

        return state.sectionsRoot
            .querySelector(
                `#${id}`
            );
    }

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
                     * No cleanup action is required.
                     */
                }
            }
        );

        state.listeners =
            [];

        state.rewardEventsBoundTo =
            null;
    }

    /* =====================================================
       REFERRAL IDENTITY
    ===================================================== */

    function resolveAuth() {
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

                if (user?.uid) {
                    return user;
                }
            } catch {
                /*
                 * Continue to Firebase Auth.
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
                 * Continue to configured Auth.
                 */
            }
        }

        return (
            resolveAuth()
                ?.currentUser ||
            null
        );
    }

    function readReferralDBIdentity() {
        if (
            !window.ReferralDB ||
            typeof window.ReferralDB
                .getReferralIdentity !==
                "function"
        ) {
            return null;
        }

        try {
            const identity =
                window.ReferralDB
                    .getReferralIdentity();

            return isPlainObject(
                identity
            )
                ? identity
                : null;
        } catch {
            return null;
        }
    }

    function readReferralDBState() {
        if (
            !window.ReferralDB ||
            typeof window.ReferralDB
                .getState !==
                "function"
        ) {
            return null;
        }

        try {
            const referralState =
                window.ReferralDB
                    .getState();

            return isPlainObject(
                referralState
            )
                ? referralState
                : null;
        } catch {
            return null;
        }
    }

    function readCurrentProfile() {
        if (
            window.ProfileDB &&
            typeof window.ProfileDB
                .getProfile ===
                "function"
        ) {
            try {
                const profile =
                    window.ProfileDB
                        .getProfile();

                if (profile) {
                    return profile;
                }
            } catch {
                /*
                 * Continue to ProfileService.
                 */
            }
        }

        if (
            window.ProfileService &&
            typeof window.ProfileService
                .getUser ===
                "function"
        ) {
            try {
                return (
                    window.ProfileService
                        .getUser() ||
                    null
                );
            } catch {
                return null;
            }
        }

        return null;
    }

    function normalizeReferralIdentity(
        value
    ) {
        const source =
            isPlainObject(value)
                ? value
                : {};

        let referralCode =
            normalizeReferralCode(
                source.referralCode ||
                source.code
            );

        if (
            referralCode &&
            !isValidReferralCode(
                referralCode
            )
        ) {
            referralCode =
                "";
        }

        let referralLink =
            normalizeReferralLink(
                source.referralLink ||
                source.link
            );

        if (referralLink) {
            try {
                const linkCode =
                    normalizeReferralCode(
                        new URL(
                            referralLink
                        ).searchParams.get(
                            REFERRAL_QUERY_PARAMETER
                        )
                    );

                if (
                    referralCode &&
                    linkCode &&
                    referralCode !==
                        linkCode
                ) {
                    referralLink =
                        "";
                } else if (
                    !referralCode &&
                    isValidReferralCode(
                        linkCode
                    )
                ) {
                    referralCode =
                        linkCode;
                }
            } catch {
                referralLink =
                    "";
            }
        }

        if (
            !referralLink &&
            referralCode
        ) {
            referralLink =
                buildCanonicalReferralLink(
                    referralCode
                );
        }

        return {
            referralCode,
            referralLink
        };
    }

    function getIdentitySource(
        identity
    ) {
        const source =
            normalizeString(
                identity?.source ||
                identity?.referralSource ||
                (
                    identity
                        ?.isGuestReferral ===
                    true
                        ? REFERRAL_SOURCE_GUEST
                        : ""
                )
            ).toLowerCase();

        return (
            source ===
                REFERRAL_SOURCE_GUEST ||
            source ===
                REFERRAL_SOURCE_USER
        )
            ? source
            : "";
    }

    function getMatchingProfileIdentity(
        uid
    ) {
        const profile =
            readCurrentProfile();

        if (!isPlainObject(profile)) {
            return {
                referralCode:
                    "",

                referralLink:
                    ""
            };
        }

        const profileUid =
            normalizeString(
                profile.uid ||
                profile.userId
            );

        if (
            !profileUid ||
            profileUid !==
                normalizeString(uid)
        ) {
            return {
                referralCode:
                    "",

                referralLink:
                    ""
            };
        }

        return normalizeReferralIdentity(
            profile
        );
    }

    function resolveReferralIdentity() {
        const currentUser =
            resolveCurrentUser();

        const referralIdentity =
            readReferralDBIdentity() ||
            {};

        const referralState =
            readReferralDBState() ||
            {};

        const identitySource =
            getIdentitySource(
                referralIdentity
            );

        const authoritativeIdentity =
            normalizeReferralIdentity(
                referralIdentity
            );

        /* =================================================
           VERIFIED / SIGNED-IN ACCOUNT

           A signed-in user must never receive the Guest link
           as a substitute for their unique referral identity.
        ================================================= */

        if (currentUser?.uid) {
            const referralStateUid =
                normalizeString(
                    referralState
                        ?.currentUser
                        ?.uid
                );

            const stateMatchesUser =
                !referralStateUid ||
                referralStateUid ===
                    currentUser.uid;

            if (
                stateMatchesUser &&
                identitySource ===
                    REFERRAL_SOURCE_USER &&
                authoritativeIdentity
                    .referralCode &&
                authoritativeIdentity
                    .referralLink
            ) {
                return {
                    ...authoritativeIdentity,

                    referralSource:
                        REFERRAL_SOURCE_USER,

                    source:
                        REFERRAL_SOURCE_USER,

                    isGuestReferral:
                        false,

                    isPublicAdminReferral:
                        false
                };
            }

            const profileIdentity =
                getMatchingProfileIdentity(
                    currentUser.uid
                );

            return {
                ...profileIdentity,

                referralSource:
                    (
                        profileIdentity
                            .referralCode &&
                        profileIdentity
                            .referralLink
                    )
                        ? REFERRAL_SOURCE_USER
                        : "",

                source:
                    (
                        profileIdentity
                            .referralCode &&
                        profileIdentity
                            .referralLink
                    )
                        ? REFERRAL_SOURCE_USER
                        : "",

                isGuestReferral:
                    false,

                isPublicAdminReferral:
                    false
            };
        }

        /* =================================================
           GUEST

           Guest identity is always the canonical main site.
           There is no Admin referral identity.
        ================================================= */

        if (
            identitySource ===
                REFERRAL_SOURCE_GUEST &&
            authoritativeIdentity
                .referralLink
        ) {
            return {
                referralCode:
                    "",

                referralLink:
                    CANONICAL_REFERRAL_BASE_URL,

                referralSource:
                    REFERRAL_SOURCE_GUEST,

                source:
                    REFERRAL_SOURCE_GUEST,

                isGuestReferral:
                    true,

                isPublicAdminReferral:
                    false
            };
        }

        return createGuestReferralIdentity();
    }

    function isReferralSourceCompatible(
        referralSource
    ) {
        const normalizedSource =
            normalizeString(
                referralSource
            ).toLowerCase();

        return resolveCurrentUser()
            ?.uid
            ? normalizedSource ===
                REFERRAL_SOURCE_USER
            : normalizedSource ===
                REFERRAL_SOURCE_GUEST;
    }

    function invalidateReferralOperations() {
        state.referralOperationGeneration +=
            1;

        state.referralRequestPromise =
            null;

        state.referralRequestUid =
            "";

        state.referralRequestMode =
            "";

        return state
            .referralOperationGeneration;
    }

    function isReferralOperationCurrent({
        generation,
        uid,
        mode
    }) {
        if (
            !state.initialized ||
            generation !==
                state.referralOperationGeneration
        ) {
            return false;
        }

        const currentUid =
            normalizeString(
                resolveCurrentUser()
                    ?.uid
            );

        return mode ===
            REFERRAL_SOURCE_USER
            ? Boolean(
                uid &&
                currentUid ===
                    uid
            )
            : !currentUid;
    }

    function updateReferralElements(
        referralLink,
        referralSource = ""
    ) {
        const normalizedLink =
            normalizeReferralLink(
                referralLink
            );

        const normalizedSource =
            normalizeString(
                referralSource
            ).toLowerCase();

        const hasReferralLink =
            Boolean(
                normalizedLink &&
                isReferralSourceCompatible(
                    normalizedSource
                )
            );

        const visibleLink =
            hasReferralLink
                ? normalizedLink
                : "";

        const visibleSource =
            hasReferralLink
                ? normalizedSource
                : "";

        const input =
            getElement(
                "referralLink"
            );

        const copyButton =
            getElement(
                "copyReferralBtn"
            );

        const referralCard =
            getElement(
                "profileReferralCard"
            );

        if (input) {
            input.value =
                visibleLink;

            input.placeholder =
                hasReferralLink
                    ? ""
                    : "Referral link is loading...";

            input.setAttribute(
                "aria-label",
                visibleSource ===
                    REFERRAL_SOURCE_GUEST
                    ? "Main site referral link"
                    : "Your referral link"
            );
        }

        if (copyButton) {
            copyButton.disabled =
                !hasReferralLink;

            copyButton.setAttribute(
                "aria-disabled",
                String(
                    !hasReferralLink
                )
            );
        }

        if (referralCard) {
            referralCard.dataset
                .referralLinkReady =
                String(
                    hasReferralLink
                );

            referralCard.dataset
                .referralSource =
                visibleSource;
        }

        return visibleLink;
    }

    function setReferralLink(
        link,
        options = {}
    ) {
        let referralLink =
            normalizeReferralLink(
                link
            );

        let referralSource =
            normalizeString(
                options.referralSource ||
                options.source
            ).toLowerCase();

        if (
            !referralLink &&
            options.resolveIdentity !==
                false
        ) {
            const identity =
                resolveReferralIdentity();

            referralLink =
                identity.referralLink;

            referralSource =
                identity.referralSource;
        }

        if (
            !isReferralSourceCompatible(
                referralSource
            )
        ) {
            referralLink =
                "";

            referralSource =
                "";
        }

        /*
         * Guest is always normalized to the canonical main
         * website and never receives a ?ref= code.
         */
        if (
            referralSource ===
                REFERRAL_SOURCE_GUEST
        ) {
            referralLink =
                CANONICAL_REFERRAL_BASE_URL;
        }

        state.referralLink =
            referralLink;

        state.referralSource =
            referralLink
                ? referralSource
                : "";

        updateReferralElements(
            state.referralLink,
            state.referralSource
        );

        return state
            .referralLink;
    }

    function synchronizeReferralLink() {
        const identity =
            resolveReferralIdentity();

        return setReferralLink(
            identity.referralLink,
            {
                resolveIdentity:
                    false,

                referralSource:
                    identity
                        .referralSource
            }
        );
    }

    async function runReferralRequest(
        mode,
        options = {}
    ) {
        const normalizedMode =
            mode ===
                REFERRAL_SOURCE_USER
                ? REFERRAL_SOURCE_USER
                : REFERRAL_SOURCE_GUEST;

        const currentUid =
            normalizeString(
                resolveCurrentUser()
                    ?.uid
            );

        if (
            normalizedMode ===
                REFERRAL_SOURCE_USER &&
            !currentUid
        ) {
            return "";
        }

        if (
            normalizedMode ===
                REFERRAL_SOURCE_GUEST &&
            currentUid
        ) {
            return "";
        }

        if (
            state.referralRequestPromise &&
            state.referralRequestUid ===
                currentUid &&
            state.referralRequestMode ===
                normalizedMode
        ) {
            return state
                .referralRequestPromise;
        }

        const generation =
            state.referralOperationGeneration;

        const operationPromise =
            (async () => {
                const referralDB =
                    window.ReferralDB ||
                    null;

                /*
                 * Guest does not require Firestore or a profile.
                 * ReferralDB remains the preferred authority if
                 * it has already been loaded.
                 */
                if (
                    normalizedMode ===
                    REFERRAL_SOURCE_GUEST
                ) {
                    if (
                        referralDB &&
                        typeof referralDB.init ===
                            "function"
                    ) {
                        await referralDB.init();
                    }

                    if (
                        referralDB &&
                        typeof referralDB
                            .loadPublicAdminReferral ===
                            "function"
                    ) {
                        /*
                         * Compatibility method name in ReferralDB.
                         * It now returns the Guest main-site URL.
                         */
                        await referralDB
                            .loadPublicAdminReferral({
                                force:
                                    options.force ===
                                    true,

                                notifyChange:
                                    options.notifyChange !==
                                    false,

                                publishError:
                                    false,

                                throwOnError:
                                    false
                            });
                    }

                    if (
                        !isReferralOperationCurrent({
                            generation,
                            uid:
                                "",
                            mode:
                                REFERRAL_SOURCE_GUEST
                        })
                    ) {
                        return "";
                    }

                    const guestLink =
                        setReferralLink(
                            CANONICAL_REFERRAL_BASE_URL,
                            {
                                resolveIdentity:
                                    false,

                                referralSource:
                                    REFERRAL_SOURCE_GUEST
                            }
                        );

                    clearReferralStatus();

                    return guestLink;
                }

                if (!referralDB) {
                    throw new Error(
                        "ReferralDB is unavailable."
                    );
                }

                if (
                    typeof referralDB.init ===
                        "function"
                ) {
                    await referralDB.init();
                }

                if (
                    typeof referralDB
                        .refresh !==
                        "function"
                ) {
                    throw new Error(
                        "Authenticated referral refresh is unavailable."
                    );
                }

                await referralDB
                    .refresh({
                        force:
                            options.force ===
                            true
                    });

                if (
                    !isReferralOperationCurrent({
                        generation,
                        uid:
                            currentUid,
                        mode:
                            REFERRAL_SOURCE_USER
                    })
                ) {
                    return "";
                }

                const referralLink =
                    synchronizeReferralLink();

                if (!referralLink) {
                    throw new Error(
                        "Your referral link is temporarily unavailable."
                    );
                }

                clearReferralStatus();

                return referralLink;
            })();

        state.referralRequestPromise =
            operationPromise;

        state.referralRequestUid =
            currentUid;

        state.referralRequestMode =
            normalizedMode;

        try {
            return await operationPromise;
        } catch (error) {
            let recoveredLink =
                "";

            if (
                isReferralOperationCurrent({
                    generation,
                    uid:
                        currentUid,
                    mode:
                        normalizedMode
                })
            ) {
                if (
                    normalizedMode ===
                    REFERRAL_SOURCE_GUEST
                ) {
                    recoveredLink =
                        setReferralLink(
                            CANONICAL_REFERRAL_BASE_URL,
                            {
                                resolveIdentity:
                                    false,

                                referralSource:
                                    REFERRAL_SOURCE_GUEST
                            }
                        );
                } else {
                    recoveredLink =
                        synchronizeReferralLink();
                }
            }

            if (recoveredLink) {
                clearReferralStatus();

                return recoveredLink;
            }

            if (
                isReferralOperationCurrent({
                    generation,
                    uid:
                        currentUid,
                    mode:
                        normalizedMode
                }) &&
                options.publishError ===
                    true
            ) {
                setReferralStatus(
                    normalizeString(
                        error?.message,
                        "Referral link is temporarily unavailable."
                    ),
                    "error"
                );
            }

            if (
                options.throwOnError ===
                    true
            ) {
                throw error;
            }

            return "";
        } finally {
            if (
                state.referralRequestPromise ===
                    operationPromise
            ) {
                state.referralRequestPromise =
                    null;

                state.referralRequestUid =
                    "";

                state.referralRequestMode =
                    "";
            }
        }
    }

    /*
     * Compatibility method name retained for modules that still
     * call loadPublicAdminReferral().
     *
     * It no longer loads or displays an Admin referral.
     */
    async function loadPublicAdminReferral(
        options = {}
    ) {
        if (
            resolveCurrentUser()
                ?.uid
        ) {
            return runReferralRequest(
                REFERRAL_SOURCE_USER,
                options
            );
        }

        return runReferralRequest(
            REFERRAL_SOURCE_GUEST,
            options
        );
    }

    async function ensureReferralLink(
        options = {}
    ) {
        let referralLink =
            synchronizeReferralLink();

        if (referralLink) {
            return referralLink;
        }

        referralLink =
            await runReferralRequest(
                resolveCurrentUser()
                    ?.uid
                    ? REFERRAL_SOURCE_USER
                    : REFERRAL_SOURCE_GUEST,
                {
                    force:
                        options.force ===
                        true,

                    notifyChange:
                        true,

                    publishError:
                        options.publishError ===
                        true,

                    throwOnError:
                        options.throwOnError ===
                        true
                }
            );

        return referralLink;
    }

    function clearReferralLink(
        options = {}
    ) {
        invalidateReferralOperations();

        state.referralLink =
            "";

        state.referralSource =
            "";

        updateReferralElements(
            "",
            ""
        );

        clearReferralStatus();

        if (
            options.loadReferral !==
                false &&
            options.loadPublicReferral !==
                false
        ) {
            void ensureReferralLink({
                force:
                    options.force ===
                    true,

                publishError:
                    options.publishError ===
                    true,

                throwOnError:
                    false
            });
        }

        return true;
    }

    function getReferralLink() {
        const input =
            getElement(
                "referralLink"
            );

        let referralLink =
            normalizeReferralLink(
                input?.value ||
                state.referralLink
            );

        if (
            state.referralSource ===
                REFERRAL_SOURCE_GUEST &&
            !resolveCurrentUser()?.uid
        ) {
            referralLink =
                CANONICAL_REFERRAL_BASE_URL;
        }

        return isReferralSourceCompatible(
            state.referralSource
        )
            ? referralLink
            : "";
    }

    /* =====================================================
       REFERRAL STATUS AND COPY
    ===================================================== */

    function setReferralStatus(
        message,
        type = "info"
    ) {
        const status =
            getElement(
                "referralLinkStatus"
            );

        if (!status) {
            return false;
        }

        status.textContent =
            normalizeString(
                message
            );

        status.dataset
            .statusType =
            normalizeString(
                type,
                "info"
            );

        status.classList.toggle(
            "is-success",
            type === "success"
        );

        status.classList.toggle(
            "is-error",
            type === "error"
        );

        return true;
    }

    function clearReferralStatus() {
        const status =
            getElement(
                "referralLinkStatus"
            );

        if (!status) {
            return false;
        }

        status.textContent =
            "";

        delete status.dataset
            .statusType;

        status.classList.remove(
            "is-success",
            "is-error"
        );

        return true;
    }

    async function copyText(text) {
        const normalizedText =
            normalizeString(
                text
            );

        if (!normalizedText) {
            return false;
        }

        if (
            window.navigator
                .clipboard &&
            typeof window.navigator
                .clipboard
                .writeText ===
                "function" &&
            window.isSecureContext
        ) {
            await window.navigator
                .clipboard
                .writeText(
                    normalizedText
                );

            return true;
        }

        if (!document.body) {
            return false;
        }

        const temporaryInput =
            document.createElement(
                "textarea"
            );

        temporaryInput.value =
            normalizedText;

        temporaryInput.setAttribute(
            "readonly",
            ""
        );

        temporaryInput.style
            .position =
            "fixed";

        temporaryInput.style
            .left =
            "-9999px";

        temporaryInput.style
            .top =
            "0";

        temporaryInput.style
            .opacity =
            "0";

        temporaryInput.style
            .pointerEvents =
            "none";

        document.body
            .appendChild(
                temporaryInput
            );

        temporaryInput.select();

        temporaryInput
            .setSelectionRange(
                0,
                temporaryInput
                    .value
                    .length
            );

        let copied =
            false;

        try {
            copied =
                document.execCommand(
                    "copy"
                );
        } finally {
            temporaryInput.remove();
        }

        return copied;
    }

    async function copyAuthoritativeReferralLink(
        referralLink
    ) {
        const referralDB =
            window.ReferralDB;

        if (
            referralDB &&
            typeof referralDB
                .copyReferralLink ===
                "function"
        ) {
            const identity =
                resolveReferralIdentity();

            if (
                identity.referralLink ===
                    referralLink
            ) {
                const result =
                    await referralDB
                        .copyReferralLink();

                return result
                    ?.success !==
                    false;
            }
        }

        return copyText(
            referralLink
        );
    }

    async function handleReferralCopy() {
        const copyButton =
            getElement(
                "copyReferralBtn"
            );

        if (!copyButton) {
            return;
        }

        copyButton.disabled =
            true;

        copyButton.setAttribute(
            "aria-disabled",
            "true"
        );

        clearReferralStatus();

        try {
            const referralLink =
                await ensureReferralLink({
                    force:
                        true,

                    publishError:
                        true,

                    throwOnError:
                        true
                });

            if (!referralLink) {
                throw new Error(
                    "Referral link is temporarily unavailable."
                );
            }

            const copied =
                await copyAuthoritativeReferralLink(
                    referralLink
                );

            if (!copied) {
                throw new Error(
                    "Copy operation failed."
                );
            }

            setReferralStatus(
                "Referral link copied.",
                "success"
            );

            window.dispatchEvent(
                new CustomEvent(
                    "account:referral-copied",
                    {
                        detail: {
                            referralLink,

                            referralSource:
                                state
                                    .referralSource
                        }
                    }
                )
            );
        } catch (error) {
            console.error(
                "[AccountSectionsModule] Referral-link copy failed.",
                error
            );

            setReferralStatus(
                normalizeString(
                    error?.message,
                    "Referral link is temporarily unavailable."
                ),
                "error"
            );
        } finally {
            const currentLink =
                getReferralLink();

            copyButton.disabled =
                !currentLink;

            copyButton.setAttribute(
                "aria-disabled",
                String(
                    !currentLink
                )
            );
        }
    }

    function bindReferralEvents() {
        const copyButton =
            getElement(
                "copyReferralBtn"
            );

        if (!copyButton) {
            return false;
        }

        return addManagedListener(
            copyButton,
            "click",
            handleReferralCopy
        );
    }

    function handleReferralIdentityChanged() {
        if (!state.initialized) {
            return;
        }

        const referralLink =
            synchronizeReferralLink();

        if (!referralLink) {
            void ensureReferralLink({
                publishError:
                    false,

                throwOnError:
                    false
            });
        }
    }

    function handleAuthStateChanged() {
        if (!state.initialized) {
            return;
        }

        invalidateReferralOperations();

        state.referralLink =
            "";

        state.referralSource =
            "";

        updateReferralElements(
            "",
            ""
        );

        clearReferralStatus();

        void ensureReferralLink({
            force:
                true,

            publishError:
                false,

            throwOnError:
                false
        });
    }

    function handleLogout() {
        if (!state.initialized) {
            return;
        }

        invalidateReferralOperations();

        state.referralLink =
            "";

        state.referralSource =
            "";

        updateReferralElements(
            "",
            ""
        );

        clearReferralStatus();

        /*
         * Auth state changes can complete immediately after this
         * event. Resolve the Guest link on the next task.
         */
        window.setTimeout(
            () => {
                if (
                    state.initialized &&
                    !resolveCurrentUser()
                        ?.uid
                ) {
                    void ensureReferralLink({
                        force:
                            true,

                        publishError:
                            false,

                        throwOnError:
                            false
                    });
                }
            },
            0
        );
    }

    function bindReferralSynchronizationEvents() {
        const events = [
            "profile:data-changed",
            "profile:updated",
            "PROFILE_UPDATED",
            "profile:ensure-success",
            "referral:updated",
            "referral:public-link-updated",
            "profile:mobile-saved"
        ];

        events.forEach(
            eventName => {
                addManagedListener(
                    window,
                    eventName,
                    handleReferralIdentityChanged
                );
            }
        );

        addManagedListener(
            window,
            "auth:state-changed",
            handleAuthStateChanged
        );

        addManagedListener(
            window,
            "profile:auth-changed",
            handleAuthStateChanged
        );

        addManagedListener(
            window,
            "auth:signed-in",
            handleAuthStateChanged
        );

        addManagedListener(
            window,
            "auth:signed-out",
            handleLogout
        );

        addManagedListener(
            window,
            "auth:before-logout",
            handleLogout
        );

        addManagedListener(
            window,
            "profile:logout",
            handleLogout
        );
    }

    /* =====================================================
       ACCOUNT SERVICES CURRENT PAGE
    ===================================================== */

    function synchronizeCurrentPage(
        page
    ) {
        const currentPage =
            normalizePage(
                page
            );

        state.currentPage =
            currentPage;

        if (!state.sectionsRoot) {
            return false;
        }

        state.sectionsRoot.dataset
            .currentAccountPage =
            currentPage;

        const buttons =
            state.sectionsRoot
                .querySelectorAll(
                    "button[data-account-page]"
                );

        buttons.forEach(
            button => {
                const targetPage =
                    normalizePage(
                        button.dataset
                            .accountPage
                    );

                const isCurrent =
                    targetPage ===
                    currentPage;

                button.classList.toggle(
                    "is-current",
                    isCurrent
                );

                button.disabled =
                    isCurrent;

                button.setAttribute(
                    "aria-disabled",
                    String(
                        isCurrent
                    )
                );

                if (isCurrent) {
                    button.setAttribute(
                        "aria-current",
                        "page"
                    );
                } else {
                    button.removeAttribute(
                        "aria-current"
                    );
                }

                const stateLabel =
                    button.querySelector(
                        ".account-navigation-state"
                    );

                if (!stateLabel) {
                    return;
                }

                stateLabel.textContent =
                    isCurrent
                        ? "Current"
                        : "";

                if (isCurrent) {
                    stateLabel
                        .setAttribute(
                            "aria-label",
                            "Current page"
                        );

                    stateLabel
                        .removeAttribute(
                            "aria-hidden"
                        );
                } else {
                    stateLabel
                        .removeAttribute(
                            "aria-label"
                        );

                    stateLabel
                        .setAttribute(
                            "aria-hidden",
                            "true"
                        );
                }
            }
        );

        return true;
    }

    /* =====================================================
       LIVE REWARD DATA
    ===================================================== */

    function normalizeAccountNumber(
        accountNumber
    ) {
        return normalizeString(
            accountNumber
        )
            .replace(
                /\D/g,
                ""
            )
            .slice(
                0,
                11
            );
    }

    function isValidAccountNumber(
        accountNumber
    ) {
        return /^\d{11}$/.test(
            normalizeAccountNumber(
                accountNumber
            )
        );
    }

    function maskAccountNumber(
        accountNumber
    ) {
        const normalized =
            normalizeAccountNumber(
                accountNumber
            );

        return normalized.length ===
            11
            ? `*******${normalized.slice(-4)}`
            : "*******0000";
    }

    function generateRandomAccountNumber() {
        let accountNumber =
            String(
                randomInteger(
                    1,
                    9
                )
            );

        while (
            accountNumber.length <
            11
        ) {
            accountNumber +=
                String(
                    randomInteger(
                        0,
                        9
                    )
                );
        }

        return accountNumber;
    }

    function generateUniqueAccountNumber(
        usedAccountNumbers
    ) {
        let accountNumber =
            "";

        let attemptCount =
            0;

        do {
            accountNumber =
                generateRandomAccountNumber();

            attemptCount +=
                1;
        } while (
            usedAccountNumbers.has(
                accountNumber
            ) &&
            attemptCount <
                100
        );

        if (
            usedAccountNumbers.has(
                accountNumber
            )
        ) {
            accountNumber =
                String(
                    Date.now() +
                    usedAccountNumbers
                        .size
                )
                    .slice(-11)
                    .padStart(
                        11,
                        "1"
                    );
        }

        usedAccountNumbers.add(
            accountNumber
        );

        return accountNumber;
    }

    function createAmountDistribution() {
        const amounts =
            [];

        REWARD_DISTRIBUTION
            .forEach(
                ({
                    amount,
                    count
                }) => {
                    for (
                        let index = 0;
                        index < count;
                        index += 1
                    ) {
                        amounts.push(
                            amount
                        );
                    }
                }
            );

        if (
            amounts.length !==
            CONFIG.rewardRecordCount
        ) {
            console.error(
                "[AccountSectionsModule] Invalid live-reward distribution."
            );
        }

        return shuffleArray(
            amounts
        );
    }

    function generateRewardRecords() {
        const generatedAt =
            Date.now();

        const usedAccountNumbers =
            new Set();

        return createAmountDistribution()
            .map(
                (
                    amount,
                    index
                ) => ({
                    id:
                        `reward-${generatedAt}-${index}`,

                    accountNumber:
                        generateUniqueAccountNumber(
                            usedAccountNumbers
                        ),

                    status:
                        "Received",

                    amount
                })
            );
    }

    function isValidRewardRecord(
        record
    ) {
        return Boolean(
            isPlainObject(
                record
            ) &&
            isValidAccountNumber(
                record.accountNumber
            ) &&
            normalizeString(
                record.status
            ) &&
            isAllowedRewardAmount(
                record.amount
            )
        );
    }

    function hasValidRewardRecords(
        records
    ) {
        if (
            !Array.isArray(
                records
            ) ||
            records.length !==
                CONFIG
                    .rewardRecordCount ||
            !records.every(
                isValidRewardRecord
            )
        ) {
            return false;
        }

        const accountNumbers =
            records.map(
                record =>
                    normalizeAccountNumber(
                        record
                            .accountNumber
                    )
            );

        return (
            new Set(
                accountNumbers
            ).size ===
            accountNumbers.length
        );
    }

    function clearLegacyRewardCache() {
        CONFIG
            .legacyRewardStorageKeys
            .forEach(
                removeStoredItem
            );
    }

    function loadRewardRecords() {
        clearLegacyRewardCache();

        const storedRecords =
            readStoredJSON(
                CONFIG.rewardStorageKey,
                []
            );

        if (
            hasValidRewardRecords(
                storedRecords
            )
        ) {
            return storedRecords;
        }

        removeStoredItem(
            CONFIG.rewardStorageKey
        );

        const generatedRecords =
            generateRewardRecords();

        writeStoredJSON(
            CONFIG.rewardStorageKey,
            generatedRecords
        );

        return generatedRecords;
    }

    function createRewardItem(
        record,
        isLoopClone = false
    ) {
        const item =
            document.createElement(
                "div"
            );

        item.className =
            "live-reward-item";

        const maskedAccount =
            maskAccountNumber(
                record.accountNumber
            );

        if (isLoopClone) {
            item.dataset.loopClone =
                "true";

            item.setAttribute(
                "aria-hidden",
                "true"
            );
        } else {
            item.setAttribute(
                "role",
                "article"
            );

            item.setAttribute(
                "aria-label",
                `Account ending ${maskedAccount.slice(-4)} received ${formatRewardAmount(record.amount)}`
            );
        }

        const accountElement =
            document.createElement(
                "span"
            );

        accountElement.className =
            "live-reward-username";

        accountElement.textContent =
            maskedAccount;

        const statusElement =
            document.createElement(
                "span"
            );

        statusElement.className =
            "live-reward-received";

        statusElement.textContent =
            normalizeString(
                record.status,
                "Received"
            );

        const amountElement =
            document.createElement(
                "strong"
            );

        amountElement.className =
            "live-reward-amount";

        amountElement.textContent =
            formatRewardAmount(
                record.amount
            );

        item.append(
            accountElement,
            statusElement,
            amountElement
        );

        return item;
    }

    function calculateRewardRowHeight() {
        if (
            !state.rewardList ||
            !state.rewardViewport
        ) {
            return 0;
        }

        const firstItem =
            state.rewardList
                .querySelector(
                    ".live-reward-item:not([data-loop-clone])"
                );

        const measuredHeight =
            firstItem
                ?.getBoundingClientRect()
                .height ||
            0;

        state.rewardRowHeight =
            measuredHeight > 0
                ? measuredHeight
                : (
                    state
                        .rewardViewport
                        .clientHeight /
                    CONFIG
                        .visibleRewardRows
                );

        return state
            .rewardRowHeight;
    }

    function getRewardRowHeight() {
        return (
            state.rewardRowHeight ||
            calculateRewardRowHeight() ||
            64
        );
    }

    function setRewardScrollPosition(
        index
    ) {
        if (!state.rewardViewport) {
            return false;
        }

        const targetIndex =
            Math.max(
                0,
                Number(index) ||
                0
            );

        const previousBehavior =
            state.rewardViewport
                .style
                .scrollBehavior;

        state.rewardViewport
            .style
            .scrollBehavior =
            "auto";

        state.rewardViewport
            .scrollTop =
            targetIndex *
            getRewardRowHeight();

        void state.rewardViewport
            .offsetHeight;

        state.rewardViewport
            .style
            .scrollBehavior =
            previousBehavior;

        return true;
    }

    function renderLiveRewards() {
        const list =
            getElement(
                "liveRewardList"
            );

        const viewport =
            getElement(
                "liveRewardViewport"
            );

        if (
            !list ||
            !viewport
        ) {
            return false;
        }

        state.rewardList =
            list;

        state.rewardViewport =
            viewport;

        if (
            !hasValidRewardRecords(
                state.rewardRecords
            )
        ) {
            state.rewardRecords =
                loadRewardRecords();
        }

        if (
            state.rewardCurrentIndex >=
            state.rewardRecords
                .length
        ) {
            state.rewardCurrentIndex =
                0;
        }

        state.rewardCurrentIndex =
            Math.max(
                0,
                state
                    .rewardCurrentIndex
            );

        state.rewardPauseUntil =
            0;

        state.rewardIsAutoScrolling =
            false;

        state.rewardRowHeight =
            0;

        const fragment =
            document
                .createDocumentFragment();

        state.rewardRecords
            .forEach(
                record => {
                    fragment.appendChild(
                        createRewardItem(
                            record
                        )
                    );
                }
            );

        state.rewardRecords
            .slice(
                0,
                CONFIG
                    .visibleRewardRows
            )
            .forEach(
                record => {
                    fragment.appendChild(
                        createRewardItem(
                            record,
                            true
                        )
                    );
                }
            );

        list.replaceChildren(
            fragment
        );

        list.setAttribute(
            "aria-busy",
            "false"
        );

        bindRewardViewportEvents();

        const activeViewport =
            viewport;

        window.requestAnimationFrame(
            () => {
                if (
                    !state.initialized ||
                    state.rewardViewport !==
                        activeViewport ||
                    !activeViewport
                        .isConnected
                ) {
                    return;
                }

                calculateRewardRowHeight();

                setRewardScrollPosition(
                    state
                        .rewardCurrentIndex
                );

                startRewardAutoScroll();
            }
        );

        return true;
    }

    /* =====================================================
       LIVE REWARD SCROLLING
    ===================================================== */

    function pauseRewardAutoScroll() {
        state.rewardPauseUntil =
            Date.now() +
            CONFIG
                .manualScrollPause;
    }

    function resetRewardLoop() {
        if (!state.rewardViewport) {
            return;
        }

        state.rewardCurrentIndex =
            0;

        state.rewardIsAutoScrolling =
            false;

        setRewardScrollPosition(
            0
        );
    }

    function moveToNextReward() {
        if (
            !state.rewardViewport ||
            !state.rewardList ||
            !state.rewardRecords
                .length
        ) {
            return;
        }

        if (
            !state.rewardViewport
                .isConnected
        ) {
            cleanupRuntime();

            return;
        }

        if (
            document.visibilityState !==
                "visible" ||
            Date.now() <
                state.rewardPauseUntil
        ) {
            return;
        }

        const nextIndex =
            state.rewardCurrentIndex +
            1;

        state.rewardCurrentIndex =
            nextIndex;

        state.rewardIsAutoScrolling =
            true;

        state.rewardViewport
            .scrollTo({
                top:
                    nextIndex *
                    getRewardRowHeight(),

                behavior:
                    "smooth"
            });

        if (
            state.rewardResetTimer
        ) {
            window.clearTimeout(
                state.rewardResetTimer
            );
        }

        state.rewardResetTimer =
            window.setTimeout(
                () => {
                    if (
                        state
                            .rewardCurrentIndex >=
                        state
                            .rewardRecords
                            .length
                    ) {
                        resetRewardLoop();

                        return;
                    }

                    state.rewardIsAutoScrolling =
                        false;
                },
                CONFIG
                    .autoScrollDuration
            );
    }

    function startRewardAutoScroll() {
        stopRewardAutoScroll();

        state.rewardAutoScrollTimer =
            window.setInterval(
                moveToNextReward,
                CONFIG
                    .autoScrollInterval
            );

        return true;
    }

    function stopRewardAutoScroll() {
        if (
            state.rewardAutoScrollTimer
        ) {
            window.clearInterval(
                state
                    .rewardAutoScrollTimer
            );

            state.rewardAutoScrollTimer =
                null;
        }

        if (
            state.rewardResetTimer
        ) {
            window.clearTimeout(
                state.rewardResetTimer
            );

            state.rewardResetTimer =
                null;
        }

        state.rewardIsAutoScrolling =
            false;
    }

    function handleRewardManualScroll() {
        if (
            !state.rewardViewport ||
            state.rewardIsAutoScrolling ||
            !state.rewardRecords
                .length
        ) {
            return;
        }

        pauseRewardAutoScroll();

        const calculatedIndex =
            Math.round(
                state.rewardViewport
                    .scrollTop /
                getRewardRowHeight()
            );

        state.rewardCurrentIndex =
            calculatedIndex >=
                state.rewardRecords
                    .length
                ? (
                    calculatedIndex %
                    state.rewardRecords
                        .length
                )
                : Math.max(
                    0,
                    calculatedIndex
                );
    }

    function handleRewardResize() {
        if (!state.rewardViewport) {
            return;
        }

        const previousIndex =
            state.rewardCurrentIndex;

        state.rewardRowHeight =
            0;

        calculateRewardRowHeight();

        setRewardScrollPosition(
            previousIndex
        );
    }

    function bindRewardViewportEvents() {
        if (!state.rewardViewport) {
            return false;
        }

        if (
            state.rewardEventsBoundTo ===
            state.rewardViewport
        ) {
            return true;
        }

        state.rewardEventsBoundTo =
            state.rewardViewport;

        addManagedListener(
            state.rewardViewport,
            "pointerdown",
            pauseRewardAutoScroll,
            {
                passive:
                    true
            }
        );

        addManagedListener(
            state.rewardViewport,
            "touchstart",
            pauseRewardAutoScroll,
            {
                passive:
                    true
            }
        );

        addManagedListener(
            state.rewardViewport,
            "wheel",
            pauseRewardAutoScroll,
            {
                passive:
                    true
            }
        );

        addManagedListener(
            state.rewardViewport,
            "keydown",
            pauseRewardAutoScroll
        );

        addManagedListener(
            state.rewardViewport,
            "scroll",
            handleRewardManualScroll,
            {
                passive:
                    true
            }
        );

        addManagedListener(
            window,
            "resize",
            handleRewardResize,
            {
                passive:
                    true
            }
        );

        return true;
    }

    function refreshLiveRewards() {
        removeStoredItem(
            CONFIG.rewardStorageKey
        );

        CONFIG
            .legacyRewardStorageKeys
            .forEach(
                removeStoredItem
            );

        stopRewardAutoScroll();

        state.rewardRecords =
            [];

        state.rewardCurrentIndex =
            0;

        state.rewardRowHeight =
            0;

        state.rewardPauseUntil =
            0;

        return state.initialized
            ? renderLiveRewards()
            : true;
    }

    /* =====================================================
       OBSERVER, CLEANUP AND INITIALIZATION
    ===================================================== */

    function observeSectionRemoval() {
        if (
            !document.body ||
            typeof MutationObserver ===
                "undefined"
        ) {
            return false;
        }

        if (state.sectionObserver) {
            state.sectionObserver
                .disconnect();
        }

        state.sectionObserver =
            new MutationObserver(
                () => {
                    if (
                        state.sectionsRoot &&
                        !state.sectionsRoot
                            .isConnected
                    ) {
                        cleanupRuntime();
                    }
                }
            );

        state.sectionObserver
            .observe(
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

    function normalizeInitOptions(
        options
    ) {
        if (
            options instanceof
                HTMLElement ||
            typeof options ===
                "string"
        ) {
            return {
                root:
                    options
            };
        }

        return isPlainObject(
            options
        )
            ? options
            : {};
    }

    function cleanupRuntime() {
        invalidateReferralOperations();

        stopRewardAutoScroll();

        removeManagedListeners();

        if (state.sectionObserver) {
            state.sectionObserver
                .disconnect();
        }

        state.sectionObserver =
            null;

        state.initialized =
            false;

        state.root =
            null;

        state.sectionsRoot =
            null;

        state.rewardViewport =
            null;

        state.rewardList =
            null;

        state.rewardRowHeight =
            0;

        state.rewardPauseUntil =
            0;

        state.rewardIsAutoScrolling =
            false;

        state.referralLink =
            "";

        state.referralSource =
            "";

        return true;
    }

    function init(options = {}) {
        const normalizedOptions =
            normalizeInitOptions(
                options
            );

        cleanupRuntime();

        const root =
            resolveRoot(
                normalizedOptions
                    .root
            );

        if (!root) {
            console.error(
                "[AccountSectionsModule] A valid account-page root is required."
            );

            return false;
        }

        const sectionsRoot =
            resolveSectionsRoot(
                root
            );

        if (!sectionsRoot) {
            console.error(
                "[AccountSectionsModule] AccountSectionsView must be rendered before initialization."
            );

            return false;
        }

        state.root =
            root;

        state.sectionsRoot =
            sectionsRoot;

        state.currentPage =
            normalizePage(
                normalizedOptions
                    .currentPage ||
                sectionsRoot.dataset
                    .currentAccountPage
            );

        state.initialized =
            true;

        synchronizeCurrentPage(
            state.currentPage
        );

        bindReferralEvents();

        bindReferralSynchronizationEvents();

        setReferralLink(
            normalizedOptions
                .referralLink,
            {
                referralSource:
                    normalizedOptions
                        .referralSource
            }
        );

        clearReferralStatus();

        if (!getReferralLink()) {
            void ensureReferralLink({
                publishError:
                    false,

                throwOnError:
                    false
            });
        }

        renderLiveRewards();

        observeSectionRemoval();

        return true;
    }

    function destroy() {
        cleanupRuntime();

        state.referralLink =
            "";

        state.referralSource =
            "";

        return true;
    }

    function isInitialized() {
        return state.initialized;
    }

    return Object.freeze({
        init,
        destroy,
        isInitialized,

        setReferralLink,
        synchronizeReferralLink,
        ensureReferralLink,

        /*
         * Compatibility method name.
         * Guest now receives the main-site URL, never Admin referral.
         */
        loadPublicAdminReferral,

        clearReferralLink,
        getReferralLink,

        synchronizeCurrentPage,

        maskAccountNumber,
        refreshLiveRewards,

        getCurrentPage() {
            return state
                .currentPage;
        },

        getReferralSource() {
            return state
                .referralSource;
        },

        getRewardRecords() {
            return cloneValue(
                state.rewardRecords
            );
        },

        getRewardCurrentIndex() {
            return state
                .rewardCurrentIndex;
        }
    });
})();

window.AccountSectionsModule =
    AccountSectionsModule;
