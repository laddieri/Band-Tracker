const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC09rVuPWT2KYig8vKILwAWFkWuvO1E7RU",
  authDomain:        "band-tracker-ae9b4.firebaseapp.com",
  projectId:         "band-tracker-ae9b4",
  storageBucket:     "band-tracker-ae9b4.firebasestorage.app",
  messagingSenderId: "686016271574",
  appId:             "1:686016271574:web:3566fc6898b54d208da577"
};

// Firebase App Check (reCAPTCHA v3) — blocks scripted/bot traffic that abuses
// the public Firebase config, protecting your daily Firestore/Auth quota.
// Leave blank to keep App Check off. To turn it on:
//   1. Firebase Console → App Check → register this web app with reCAPTCHA v3.
//   2. Paste the generated reCAPTCHA v3 *site key* below.
//   3. Roll out in "Unenforced" (monitor) mode first; enforce once traffic looks clean.
const RECAPTCHA_V3_SITE_KEY = "";

