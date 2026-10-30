/**
 * The test database URL. TEST_DATABASE_URL wins over DATABASE_URL so a developer's
 * dev database is never touched by accident. Each worktree should use its own
 * database name (e.g. postgres://sift:sift@localhost:55432/sift_test_04).
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Set TEST_DATABASE_URL (or DATABASE_URL) to a Postgres URL, e.g. postgres://sift:sift@localhost:55432/sift_test_01",
    );
  }
  return url;
}
