import { testDatabaseUrl } from "./db-url";

// Route handlers read DATABASE_URL; point them at the test database.
process.env.DATABASE_URL = testDatabaseUrl();
