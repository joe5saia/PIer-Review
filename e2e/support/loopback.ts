// Only loaded by the live-client scenario. Never contact a hosted model or wiki.
const localFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const local = new URL(process.env.PECIA_URL ?? "");
  if (local.hostname !== "127.0.0.1") {
    throw new Error("Test double must run on loopback");
  }
  if (url.origin === local.origin) {
    return localFetch(req);
  }
  if (url.origin === "https://api.openai.com") {
    return localFetch(new Request(new URL(url.pathname, local), req));
  }
  throw new Error(`Unexpected outbound origin: ${url.origin}`);
};
