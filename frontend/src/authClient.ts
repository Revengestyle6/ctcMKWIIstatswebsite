const DEV_EMAIL_KEY = "ctc-dev-admin-email";
const FIREBASE_SESSION_HINT_KEY = "ctc-firebase-admin-session";

type FirebaseModules = {
  auth: import("firebase/auth").Auth;
  authModule: typeof import("firebase/auth");
};

let firebaseModulesPromise: Promise<FirebaseModules | null> | null = null;

function firebaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID
  );
}

async function firebaseModules(): Promise<FirebaseModules | null> {
  if (!firebaseConfigured()) return null;
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([import("firebase/app"), import("firebase/auth")]).then(
      ([appModule, authModule]) => {
        const app =
          appModule.getApps()[0] ??
          appModule.initializeApp({
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
          });
        return { auth: authModule.getAuth(app), authModule };
      }
    );
  }
  return firebaseModulesPromise;
}

export async function getAdminAuthHeaders(): Promise<Record<string, string>> {
  if (import.meta.env.VITE_ALLOW_DEV_AUTH === "true") {
    const email = localStorage.getItem(DEV_EMAIL_KEY);
    if (email) return { "X-Dev-Admin-Email": email };
  }
  if (localStorage.getItem(FIREBASE_SESSION_HINT_KEY) !== "true") return {};
  const modules = await firebaseModules();
  if (!modules) return {};
  await modules.auth.authStateReady();
  const token = await modules.auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function signInWithGoogle(): Promise<void> {
  const modules = await firebaseModules();
  if (!modules) throw new Error("Firebase sign-in is not configured for this build.");
  await modules.authModule.signInWithPopup(
    modules.auth,
    new modules.authModule.GoogleAuthProvider()
  );
  localStorage.setItem(FIREBASE_SESSION_HINT_KEY, "true");
}

export async function signOutAdmin(): Promise<void> {
  localStorage.removeItem(DEV_EMAIL_KEY);
  localStorage.removeItem(FIREBASE_SESSION_HINT_KEY);
  const modules = await firebaseModules();
  if (modules) await modules.authModule.signOut(modules.auth);
}

export function setLocalDevelopmentAdmin(email: string): void {
  if (import.meta.env.VITE_ALLOW_DEV_AUTH !== "true") {
    throw new Error("Local development authentication is disabled.");
  }
  localStorage.setItem(DEV_EMAIL_KEY, email.trim().toLowerCase());
}

export function localDevelopmentAuthEnabled(): boolean {
  return import.meta.env.VITE_ALLOW_DEV_AUTH === "true";
}
