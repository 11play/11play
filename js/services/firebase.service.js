/* =========================================================
   11PLAY — FIREBASE PUBLIC DATA SERVICE
   File: js/services/firebase.service.js

   Responsibilities:
   - Load public website records
   - Load global site-click counters
   - Atomically increase one site's click count
   - Use the centralized Firebase configuration
   - Remain safe when script loading order changes
========================================================= */

(() => {
    "use strict";

    /* =====================================================
       FIREBASE ACCESS
    ===================================================== */

    function getFirestore() {
        const database =
            window.FirebaseConfig
                ?.firestore ||
            window.firebaseDB ||
            null;

        if (!database) {
            throw new Error(
                "Firestore is not initialized."
            );
        }

        return database;
    }

    function getFieldValue() {
        const fieldValue =
            window.firebase
                ?.firestore
                ?.FieldValue ||
            null;

        if (!fieldValue) {
            throw new Error(
                "Firestore FieldValue is not available."
            );
        }

        return fieldValue;
    }

    /* =====================================================
       GENERAL HELPERS
    ===================================================== */

    function normalizeDocumentId(
        value,
        fieldName = "documentId"
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            throw new TypeError(
                `${fieldName} is required.`
            );
        }

        const documentId =
            String(value).trim();

        if (
            !documentId ||
            documentId.length > 300 ||
            documentId.includes("/")
        ) {
            throw new TypeError(
                `${fieldName} is invalid.`
            );
        }

        return documentId;
    }

    function toNonNegativeNumber(value) {
        const number =
            Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0
        ) {
            return 0;
        }

        return number;
    }

    function mapDocuments(snapshot) {
        if (
            !snapshot ||
            !Array.isArray(
                snapshot.docs
            )
        ) {
            return [];
        }

        return snapshot.docs.map(
            (documentSnapshot) => ({
                id:
                    documentSnapshot.id,

                ...(
                    documentSnapshot.data() ||
                    {}
                )
            })
        );
    }

    async function loadOrderedCollection(
        collectionName
    ) {
        const database =
            getFirestore();

        const snapshot =
            await database
                .collection(
                    collectionName
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .get();

        return mapDocuments(
            snapshot
        );
    }

    /* =====================================================
       PUBLIC COLLECTIONS
    ===================================================== */

    async function getSites() {
        try {
            return await loadOrderedCollection(
                "sites"
            );
        } catch (error) {
            console.error(
                "[FirebaseService] Failed to load sites.",
                error
            );

            throw error;
        }
    }

    async function getNews() {
        try {
            return await loadOrderedCollection(
                "news"
            );
        } catch (error) {
            console.error(
                "[FirebaseService] Failed to load news.",
                error
            );

            throw error;
        }
    }

    async function getBanners() {
        try {
            return await loadOrderedCollection(
                "banners"
            );
        } catch (error) {
            console.error(
                "[FirebaseService] Failed to load banners.",
                error
            );

            throw error;
        }
    }

    /* =====================================================
       GLOBAL SITE CLICKS
    ===================================================== */

    async function getGlobalClicks() {
        try {
            const database =
                getFirestore();

            const snapshot =
                await database
                    .collection(
                        "siteClicks"
                    )
                    .get();

            const clicks = {};

            for (
                const documentSnapshot
                of snapshot.docs
            ) {
                const data =
                    documentSnapshot.data() ||
                    {};

                clicks[
                    documentSnapshot.id
                ] =
                    toNonNegativeNumber(
                        data.clicks
                    );
            }

            return clicks;
        } catch (error) {
            console.error(
                "[FirebaseService] Failed to load global clicks.",
                error
            );

            return {};
        }
    }

    async function incrementSiteClick(
        siteId
    ) {
        try {
            const normalizedSiteId =
                normalizeDocumentId(
                    siteId,
                    "siteId"
                );

            const database =
                getFirestore();

            const FieldValue =
                getFieldValue();

            await database
                .collection(
                    "siteClicks"
                )
                .doc(
                    normalizedSiteId
                )
                .set(
                    {
                        siteId:
                            normalizedSiteId,

                        clicks:
                            FieldValue
                                .increment(1),

                        updatedAt:
                            FieldValue
                                .serverTimestamp()
                    },
                    {
                        merge:
                            true
                    }
                );

            return true;
        } catch (error) {
            console.error(
                "[FirebaseService] Failed to update global click.",
                error
            );

            return false;
        }
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.FirebaseService =
        Object.freeze({
            getSites,
            getNews,
            getBanners,

            getGlobalClicks,
            incrementSiteClick
        });
})();