/* =========================================================
   11PLAY — FIREBASE CONFIGURATION
   File: js/config/firebase.config.js

   Firebase Project:
   web11-one

   Production Architecture:
   - GitHub Pages static hosting
   - Firebase Authentication
   - Cloud Firestore
   - Firebase Spark plan
   - No deployed Cloud Functions
   - No Firebase Storage usage

   Compatibility:
   - functionsRegion metadata is retained for older modules
   - functions / firebaseFunctions remain null intentionally
========================================================= */

(() => {
    "use strict";

    const FIREBASE_PROJECT_ID =
        "web11-one";

    /*
     * Compatibility metadata only.
     * No Firebase Functions instance is initialized.
     */

    const FUNCTIONS_REGION =
        "asia-south1";

    const firebaseConfig =
        Object.freeze({
            apiKey:
                "AIzaSyAdaZGQA8t2LgzRdKzHvSe72y0_vfn1kwA",

            authDomain:
                "web11-one.firebaseapp.com",

            projectId:
                FIREBASE_PROJECT_ID,

            storageBucket:
                "web11-one.firebasestorage.app",

            messagingSenderId:
                "88725708371",

            appId:
                "1:88725708371:web:dfd08ca43262017708f0a6",

            measurementId:
                "G-70Z75SEEQP"
        });

    /* =====================================================
       FIREBASE SDK CHECK
    ===================================================== */

    if (
        typeof window.firebase ===
        "undefined"
    ) {
        console.error(
            "[FirebaseConfig] Firebase SDK is not loaded."
        );

        return;
    }

    /* =====================================================
       FIREBASE APP INITIALIZATION
    ===================================================== */

    let firebaseApp = null;

    try {
        const existingApps =
            Array.isArray(
                window.firebase.apps
            )
                ? window.firebase.apps
                : [];

        if (existingApps.length > 0) {
            firebaseApp =
                window.firebase.app();

            const existingProjectId =
                firebaseApp?.options
                    ?.projectId ||
                "";

            if (
                existingProjectId &&
                existingProjectId !==
                    FIREBASE_PROJECT_ID
            ) {
                throw new Error(
                    `The existing Firebase app belongs to a different project: ${existingProjectId}`
                );
            }
        } else {
            firebaseApp =
                window.firebase
                    .initializeApp(
                        firebaseConfig
                    );
        }
    } catch (error) {
        console.error(
            "[FirebaseConfig] Firebase initialization failed.",
            error
        );

        return;
    }

    /* =====================================================
       REQUIRED FIREBASE SERVICES
    ===================================================== */

    let firebaseAuth = null;
    let firebaseFirestore = null;

    try {
        if (
            firebaseApp &&
            typeof firebaseApp.auth ===
                "function"
        ) {
            firebaseAuth =
                firebaseApp.auth();
        } else if (
            typeof window.firebase.auth ===
                "function"
        ) {
            firebaseAuth =
                window.firebase.auth(
                    firebaseApp
                );
        } else {
            console.error(
                "[FirebaseConfig] Firebase Auth SDK is not loaded."
            );
        }
    } catch (error) {
        console.error(
            "[FirebaseConfig] Firebase Auth initialization failed.",
            error
        );
    }

    try {
        if (
            firebaseApp &&
            typeof firebaseApp.firestore ===
                "function"
        ) {
            firebaseFirestore =
                firebaseApp.firestore();
        } else if (
            typeof window.firebase
                .firestore ===
                "function"
        ) {
            firebaseFirestore =
                window.firebase.firestore(
                    firebaseApp
                );
        } else {
            console.error(
                "[FirebaseConfig] Firestore SDK is not loaded."
            );
        }
    } catch (error) {
        console.error(
            "[FirebaseConfig] Firestore initialization failed.",
            error
        );
    }

    /* =====================================================
       FIRESTORE CLIENT SETTINGS
    ===================================================== */

    if (firebaseFirestore) {
        try {
            /*
             * Ignore undefined properties rather than sending
             * accidental undefined values into Firestore writes.
             * This does not weaken Security Rules validation.
             */

            firebaseFirestore.settings({
                ignoreUndefinedProperties:
                    true
            });
        } catch (error) {
            /*
             * Firestore may already have started if another
             * module initialized it first. In that case we keep
             * the existing instance rather than breaking startup.
             */

            const message =
                String(
                    error?.message ||
                    ""
                ).toLowerCase();

            const alreadyStarted =
                message.includes(
                    "settings"
                ) &&
                (
                    message.includes(
                        "already"
                    ) ||
                    message.includes(
                        "before"
                    )
                );

            if (!alreadyStarted) {
                console.warn(
                    "[FirebaseConfig] Firestore client settings could not be applied.",
                    error
                );
            }
        }
    }

    /* =====================================================
       FUNCTIONS COMPATIBILITY
    ===================================================== */

    /*
     * 11Play does not deploy or call Firebase Cloud Functions
     * in the Spark-only architecture. The FunctionsClient name
     * remains elsewhere as a compatibility wrapper over direct
     * Auth/Firestore operations.
     */

    const firebaseFunctions =
        null;

    /* =====================================================
       PUBLIC CONFIGURATION API
    ===================================================== */

    const publicConfiguration =
        Object.freeze({
            config:
                firebaseConfig,

            app:
                firebaseApp,

            auth:
                firebaseAuth,

            firestore:
                firebaseFirestore,

            functions:
                firebaseFunctions,

            projectId:
                FIREBASE_PROJECT_ID,

            functionsRegion:
                FUNCTIONS_REGION,

            architecture:
                "spark-firestore-direct",

            usesCloudFunctions:
                false,

            usesFirebaseStorage:
                false,

            isReady() {
                return Boolean(
                    firebaseApp &&
                    firebaseAuth &&
                    firebaseFirestore
                );
            },

            isAuthReady() {
                return Boolean(
                    firebaseApp &&
                    firebaseAuth
                );
            },

            isFirestoreReady() {
                return Boolean(
                    firebaseApp &&
                    firebaseFirestore
                );
            },

            /*
             * Compatibility method retained for older code.
             * It intentionally returns false because no Cloud
             * Functions service is used in production.
             */

            isFunctionsReady() {
                return false;
            }
        });

    window.FirebaseConfig =
        publicConfiguration;

    /*
     * Compatibility aliases for existing project files.
     */

    window.firebaseApp =
        firebaseApp;

    window.firebaseAuth =
        firebaseAuth;

    window.firebaseDB =
        firebaseFirestore;

    window.firebaseFunctions =
        firebaseFunctions;

    console.info(
        "[FirebaseConfig] Firebase initialized:",
        {
            projectId:
                FIREBASE_PROJECT_ID,

            architecture:
                publicConfiguration
                    .architecture,

            authReady:
                publicConfiguration
                    .isAuthReady(),

            firestoreReady:
                publicConfiguration
                    .isFirestoreReady(),

            functionsEnabled:
                publicConfiguration
                    .usesCloudFunctions,

            ready:
                publicConfiguration
                    .isReady()
        }
    );
})();