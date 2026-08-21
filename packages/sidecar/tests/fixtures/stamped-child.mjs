process.on("SIGTERM", () => {
  // The convergence test deliberately exercises the exact-stamp force fallback.
});

setInterval(() => undefined, 60_000);
