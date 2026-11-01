import { testDatabaseUrl } from "./db-url";

// Route handlers read DATABASE_URL; point them at the test database.
process.env.DATABASE_URL = testDatabaseUrl();

// Auth needs a signing key; tests never use a real one.
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
// Better Auth's base URL; test requests send this as their Origin.
process.env.APP_BASE_URL = "http://localhost";
