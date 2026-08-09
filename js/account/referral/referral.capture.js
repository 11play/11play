/* =========================================================
   11PLAY — REFERRAL CAPTURE
   File: js/account/referral/referral.capture.js

   Responsibilities:
   - Capture referral code before authentication
   - Read the referral code from URL query or hash
   - Strictly normalize and validate referral-code format
   - Preserve the code until profile creation
   - Provide the pending code to ProfileDB
   - Remove invalid legacy storage values
   - Remove the referral parameter from the visible URL
   - Never decide referral eligibility or rewards

   Supported URL:
   https://11play.github.io/11play/?ref=AB7K9X2P

   Canonical referral-code format:
   - Exactly 8 characters
   - Allowed: A-H, J-N, P-Z, 2-9
   - Excluded ambiguous characters: I, O, 0, 1

   Important:
   - Backend remains the final referral authority
   - Backend prevents self-referral and duplicate binding
   - Backend validates active/expired referral codes
========================================================= */

(() => {
    "use strict";

    /* =====================================================
       CONFIGURATION
    ===================================================== */

    const QUERY_PARAMETER =
        "ref";

    const REFERRAL_CODE_LENGTH =
        8;

    const REFERRAL_CODE_PATTERN =
        /^[A-HJ-NP-Z2-9]{8}$/;

    const STORAGE_KEY =
        "11play_pending_referral_code";

    const STORAGE_META_KEY =
        "11play_pending_referral_meta";

    const LEGACY_STORAGE_KEYS =
        Object.freeze([
            "11play.pending.referral.code"
        ]);

    const LEGACY_META_KEYS =
        Object.freeze([
            "11play.pending.referral.meta"
        ]);

    const DEFAULT_BASE_URL =
        "https://11play.github.io/11play/";

    /* =====================================================
       INTERNAL STATE
    ===================================================== */

    let initialized =
        false;

    let pendingCode =
        "";

    let capturedFromURL =
        false;

    let capturedAt =
        null;

    let captureSource =
        "";

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

    function createTimestamp() {
        return new Date()
            .toISOString();
    }

    function dispatchReferralEvent(
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
       STORAGE RESOLUTION
    ===================================================== */

    function canUseStorage(storage) {
        if (!storage) {
            return false;
        }

        const testKey =
            "__11play_referral_storage_test__";

        try {
            storage.setItem(
                testKey,
                "1"
            );

            storage.removeItem(
                testKey
            );

            return true;
        } catch {
            return false;
        }
    }

    function getStorage() {
        try {
            if (
                canUseStorage(
                    window.localStorage
                )
            ) {
                return window.localStorage;
            }
        } catch {
            /*
             * Continue to sessionStorage.
             */
        }

        try {
            if (
                canUseStorage(
                    window.sessionStorage
                )
            ) {
                return window.sessionStorage;
            }
        } catch {
            /*
             * Memory-only fallback is used.
             */
        }

        return null;
    }

    function removeStorageItem(
        storage,
        key
    ) {
        if (
            !storage ||
            !key
        ) {
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

    function removeLegacyStorage(
        storage
    ) {
        if (!storage) {
            return false;
        }

        for (
            const key of
            LEGACY_STORAGE_KEYS
        ) {
            removeStorageItem(
                storage,
                key
            );
        }

        for (
            const key of
            LEGACY_META_KEYS
        ) {
            removeStorageItem(
                storage,
                key
            );
        }

        return true;
    }

    /* =====================================================
       CODE NORMALIZATION AND VALIDATION
    ===================================================== */

    function normalizeCode(value) {
        return toSafeString(
            value
        )
            .toUpperCase();
    }

    function isValidCode(value) {
        const code =
            normalizeCode(
                value
            );

        return (
            code.length ===
                REFERRAL_CODE_LENGTH &&
            REFERRAL_CODE_PATTERN
                .test(
                    code
                )
        );
    }

    function validateCode(value) {
        const code =
            normalizeCode(
                value
            );

        return isValidCode(
            code
        )
            ? code
            : "";
    }

    /* =====================================================
       METADATA NORMALIZATION
    ===================================================== */

    function normalizeMetadata(value) {
        if (
            !isPlainObject(
                value
            )
        ) {
            return null;
        }

        const code =
            validateCode(
                value.code
            );

        return {
            code,

            capturedAt:
                toSafeString(
                    value.capturedAt
                ) ||
                null,

            source:
                toSafeString(
                    value.source
                ),

            schemaVersion:
                Number.isInteger(
                    Number(
                        value.schemaVersion
                    )
                )
                    ? Number(
                        value.schemaVersion
                    )
                    : 1
        };
    }

    /* =====================================================
       STORAGE READ
    ===================================================== */

    function readStorageValue(
        storage,
        key
    ) {
        if (
            !storage ||
            !key
        ) {
            return "";
        }

        try {
            return (
                storage.getItem(
                    key
                ) ||
                ""
            );
        } catch {
            return "";
        }
    }

    function findStoredCode(
        storage
    ) {
        if (!storage) {
            return {
                code:
                    "",

                key:
                    ""
            };
        }

        const canonicalRawCode =
            readStorageValue(
                storage,
                STORAGE_KEY
            );

        const canonicalCode =
            validateCode(
                canonicalRawCode
            );

        if (canonicalCode) {
            return {
                code:
                    canonicalCode,

                key:
                    STORAGE_KEY
            };
        }

        /*
         * Remove any old canonical value that does not satisfy
         * the strict A-H/J-N/P-Z/2-9 referral alphabet.
         */

        if (canonicalRawCode) {
            removeStorageItem(
                storage,
                STORAGE_KEY
            );

            removeStorageItem(
                storage,
                STORAGE_META_KEY
            );
        }

        for (
            const legacyKey of
            LEGACY_STORAGE_KEYS
        ) {
            const rawCode =
                readStorageValue(
                    storage,
                    legacyKey
                );

            const code =
                validateCode(
                    rawCode
                );

            if (code) {
                return {
                    code,

                    key:
                        legacyKey
                };
            }

            if (rawCode) {
                removeStorageItem(
                    storage,
                    legacyKey
                );
            }
        }

        return {
            code:
                "",

            key:
                ""
        };
    }

    function readStoredMetadata(
        storage = getStorage()
    ) {
        if (!storage) {
            return null;
        }

        const metadataKeys = [
            STORAGE_META_KEY,
            ...LEGACY_META_KEYS
        ];

        for (
            const key of
            metadataKeys
        ) {
            const rawMetadata =
                readStorageValue(
                    storage,
                    key
                );

            if (!rawMetadata) {
                continue;
            }

            try {
                const metadata =
                    normalizeMetadata(
                        JSON.parse(
                            rawMetadata
                        )
                    );

                if (metadata) {
                    return metadata;
                }
            } catch {
                removeStorageItem(
                    storage,
                    key
                );
            }
        }

        return null;
    }

    function readStoredCode() {
        const storage =
            getStorage();

        if (!storage) {
            return isValidCode(
                pendingCode
            )
                ? pendingCode
                : "";
        }

        const storedResult =
            findStoredCode(
                storage
            );

        if (!storedResult.code) {
            return "";
        }

        const metadata =
            readStoredMetadata(
                storage
            );

        /*
         * Migrate a still-valid legacy referral value to
         * the canonical storage keys.
         */

        if (
            storedResult.key !==
            STORAGE_KEY
        ) {
            try {
                storage.setItem(
                    STORAGE_KEY,
                    storedResult.code
                );

                storage.setItem(
                    STORAGE_META_KEY,
                    JSON.stringify({
                        code:
                            storedResult.code,

                        capturedAt:
                            metadata
                                ?.capturedAt ||
                            createTimestamp(),

                        source:
                            metadata
                                ?.source ||
                            "legacy_migration",

                        schemaVersion:
                            2
                    })
                );

                removeLegacyStorage(
                    storage
                );
            } catch (error) {
                console.warn(
                    "[ReferralCapture] Legacy referral storage could not be migrated.",
                    error
                );
            }
        }

        return storedResult.code;
    }

    /* =====================================================
       STORAGE WRITE
    ===================================================== */

    function writeStoredCode(
        referralCode,
        metadata = {}
    ) {
        const code =
            validateCode(
                referralCode
            );

        if (!code) {
            return false;
        }

        const timestamp =
            toSafeString(
                metadata.capturedAt
            ) ||
            createTimestamp();

        const source =
            toSafeString(
                metadata.source
            ) ||
            "unknown";

        pendingCode =
            code;

        capturedAt =
            timestamp;

        captureSource =
            source;

        const storage =
            getStorage();

        if (!storage) {
            return true;
        }

        try {
            storage.setItem(
                STORAGE_KEY,
                code
            );

            storage.setItem(
                STORAGE_META_KEY,
                JSON.stringify({
                    code,

                    capturedAt:
                        timestamp,

                    source,

                    schemaVersion:
                        2
                })
            );

            removeLegacyStorage(
                storage
            );

            return true;
        } catch (error) {
            console.warn(
                "[ReferralCapture] Referral code could not be stored persistently.",
                error
            );

            /*
             * The in-memory code remains available during
             * the current page session.
             */

            return true;
        }
    }

    function removeStoredCode() {
        const storage =
            getStorage();

        if (storage) {
            removeStorageItem(
                storage,
                STORAGE_KEY
            );

            removeStorageItem(
                storage,
                STORAGE_META_KEY
            );

            removeLegacyStorage(
                storage
            );
        }

        pendingCode =
            "";

        capturedAt =
            null;

        captureSource =
            "";

        capturedFromURL =
            false;

        return true;
    }

    /* =====================================================
       URL CODE READING
    ===================================================== */

    function getCodeFromSearch() {
        try {
            const searchParameters =
                new URLSearchParams(
                    window.location.search
                );

            return (
                searchParameters.get(
                    QUERY_PARAMETER
                ) ||
                ""
            );
        } catch {
            return "";
        }
    }

    function getCodeFromHash() {
        try {
            const rawHash =
                toSafeString(
                    window.location.hash
                );

            const queryIndex =
                rawHash.indexOf(
                    "?"
                );

            if (
                queryIndex <
                0
            ) {
                return "";
            }

            const queryString =
                rawHash.slice(
                    queryIndex +
                    1
                );

            const searchParameters =
                new URLSearchParams(
                    queryString
                );

            return (
                searchParameters.get(
                    QUERY_PARAMETER
                ) ||
                ""
            );
        } catch {
            return "";
        }
    }

    function getCodeFromURL() {
        return (
            getCodeFromSearch() ||
            getCodeFromHash() ||
            ""
        );
    }

    /* =====================================================
       URL CLEANUP

       Removes only the referral parameter without reloading
       the page or changing the active route.
    ===================================================== */

    function removeReferralFromURL() {
        if (
            !window.history ||
            typeof window.history
                .replaceState !==
                "function"
        ) {
            return false;
        }

        try {
            const currentURL =
                new URL(
                    window.location.href
                );

            let changed =
                false;

            if (
                currentURL
                    .searchParams
                    .has(
                        QUERY_PARAMETER
                    )
            ) {
                currentURL
                    .searchParams
                    .delete(
                        QUERY_PARAMETER
                    );

                changed =
                    true;
            }

            const rawHash =
                currentURL.hash ||
                "";

            const hashQueryIndex =
                rawHash.indexOf(
                    "?"
                );

            if (
                hashQueryIndex >=
                0
            ) {
                const hashPath =
                    rawHash.slice(
                        0,
                        hashQueryIndex
                    );

                const hashQuery =
                    rawHash.slice(
                        hashQueryIndex +
                        1
                    );

                const hashParameters =
                    new URLSearchParams(
                        hashQuery
                    );

                if (
                    hashParameters.has(
                        QUERY_PARAMETER
                    )
                ) {
                    hashParameters.delete(
                        QUERY_PARAMETER
                    );

                    const remainingQuery =
                        hashParameters
                            .toString();

                    currentURL.hash =
                        remainingQuery
                            ? `${hashPath}?${remainingQuery}`
                            : hashPath;

                    changed =
                        true;
                }
            }

            if (changed) {
                window.history
                    .replaceState(
                        window.history.state,
                        document.title,
                        currentURL
                            .toString()
                    );
            }

            return changed;
        } catch (error) {
            console.warn(
                "[ReferralCapture] Referral parameter could not be removed from the URL.",
                error
            );

            return false;
        }
    }

    /* =====================================================
       CLIENT-SIDE SELF-REFERRAL CONVENIENCE CHECK

       This is not a security decision.
       The backend / Firestore contract performs the
       authoritative self-referral validation.
    ===================================================== */

    function getCurrentUserReferralCode() {
        if (
            !window.ProfileService ||
            typeof window.ProfileService
                .getUser !==
                "function"
        ) {
            return "";
        }

        try {
            const profile =
                window.ProfileService
                    .getUser();

            return validateCode(
                profile
                    ?.referralCode
            );
        } catch {
            return "";
        }
    }

    function isOwnReferralCode(
        referralCode
    ) {
        const code =
            validateCode(
                referralCode
            );

        const ownReferralCode =
            getCurrentUserReferralCode();

        return Boolean(
            code &&
            ownReferralCode &&
            code ===
                ownReferralCode
        );
    }

    /* =====================================================
       CAPTURE OPERATIONS
    ===================================================== */

    function setPendingCode(
        referralCode,
        options = {}
    ) {
        const code =
            validateCode(
                referralCode
            );

        if (!code) {
            dispatchReferralEvent(
                "referral:capture-invalid",
                {
                    value:
                        toSafeString(
                            referralCode
                        ),

                    reason:
                        "invalid_format",

                    source:
                        toSafeString(
                            options.source
                        )
                }
            );

            return "";
        }

        if (
            isOwnReferralCode(
                code
            )
        ) {
            dispatchReferralEvent(
                "referral:capture-invalid",
                {
                    code,

                    reason:
                        "self_referral",

                    source:
                        toSafeString(
                            options.source
                        )
                }
            );

            return "";
        }

        const source =
            toSafeString(
                options.source
            ) ||
            "manual";

        const timestamp =
            toSafeString(
                options.capturedAt
            ) ||
            createTimestamp();

        const saved =
            writeStoredCode(
                code,
                {
                    source,

                    capturedAt:
                        timestamp
                }
            );

        if (!saved) {
            return "";
        }

        dispatchReferralEvent(
            "referral:capture-success",
            {
                code,

                source,

                capturedAt:
                    timestamp
            }
        );

        return code;
    }

    function captureFromURL(
        options = {}
    ) {
        const cleanURL =
            options.cleanURL !==
            false;

        const rawCode =
            getCodeFromURL();

        if (!rawCode) {
            return "";
        }

        const code =
            validateCode(
                rawCode
            );

        if (!code) {
            dispatchReferralEvent(
                "referral:capture-invalid",
                {
                    value:
                        toSafeString(
                            rawCode
                        ),

                    reason:
                        "invalid_format",

                    source:
                        "url"
                }
            );

            if (cleanURL) {
                removeReferralFromURL();
            }

            return "";
        }

        const savedCode =
            setPendingCode(
                code,
                {
                    source:
                        "url"
                }
            );

        capturedFromURL =
            Boolean(
                savedCode
            );

        if (cleanURL) {
            removeReferralFromURL();
        }

        return savedCode;
    }

    function getPendingCode() {
        if (
            pendingCode &&
            isValidCode(
                pendingCode
            )
        ) {
            return pendingCode;
        }

        const storedCode =
            readStoredCode();

        if (!storedCode) {
            pendingCode =
                "";

            return "";
        }

        const metadata =
            readStoredMetadata();

        pendingCode =
            storedCode;

        capturedAt =
            metadata
                ?.capturedAt ||
            capturedAt ||
            null;

        captureSource =
            metadata
                ?.source ||
            captureSource ||
            "";

        return pendingCode;
    }

    function clearPendingCode(
        options = {}
    ) {
        const previousCode =
            getPendingCode();

        removeStoredCode();

        dispatchReferralEvent(
            "referral:capture-cleared",
            {
                previousCode,

                reason:
                    toSafeString(
                        options.reason
                    ) ||
                    "completed"
            }
        );

        return true;
    }

    function hasPendingCode() {
        return Boolean(
            getPendingCode()
        );
    }

    /* =====================================================
       REFERRAL LINK BUILDER
    ===================================================== */

    function buildReferralLink(
        referralCode,
        baseURL = DEFAULT_BASE_URL
    ) {
        const code =
            validateCode(
                referralCode
            );

        if (!code) {
            return "";
        }

        try {
            const referralURL =
                new URL(
                    baseURL,
                    window.location.origin
                );

            referralURL
                .searchParams
                .set(
                    QUERY_PARAMETER,
                    code
                );

            referralURL.hash =
                "";

            return referralURL
                .toString();
        } catch {
            return "";
        }
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function init(
        options = {}
    ) {
        if (initialized) {
            return getPendingCode();
        }

        pendingCode =
            readStoredCode();

        const metadata =
            readStoredMetadata();

        capturedAt =
            metadata
                ?.capturedAt ||
            null;

        captureSource =
            metadata
                ?.source ||
            "";

        captureFromURL({
            cleanURL:
                options.cleanURL !==
                false
        });

        initialized =
            true;

        dispatchReferralEvent(
            "referral:capture-ready",
            {
                code:
                    getPendingCode(),

                hasPendingCode:
                    hasPendingCode(),

                source:
                    captureSource
            }
        );

        return getPendingCode();
    }

    /* =====================================================
       STATE
    ===================================================== */

    function getState() {
        return Object.freeze({
            initialized,

            pendingCode:
                getPendingCode(),

            hasPendingCode:
                hasPendingCode(),

            capturedFromURL,

            capturedAt,

            source:
                captureSource,

            queryParameter:
                QUERY_PARAMETER,

            storageKey:
                STORAGE_KEY
        });
    }

    /* =====================================================
       GLOBAL API
    ===================================================== */

    window.ReferralCapture =
        Object.freeze({
            init,

            captureFromURL,

            setPendingCode,
            getPendingCode,
            clearPendingCode,
            hasPendingCode,

            normalizeCode,
            isValidCode,

            buildReferralLink,
            removeReferralFromURL,

            getState,

            QUERY_PARAMETER,
            STORAGE_KEY,
            STORAGE_META_KEY,
            REFERRAL_CODE_LENGTH
        });
})();
