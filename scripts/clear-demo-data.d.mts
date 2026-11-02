/** Deletes the tickets seeded from samples/emails.json (matched by message_id) and everything hanging off them. Returns how many tickets went. */
export function clearDemoTickets(url: string): Promise<number>;
