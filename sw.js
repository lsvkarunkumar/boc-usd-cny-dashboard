self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open("bocfx-v1").then((c) =>
      c.addAll(["./","./index.html","./styles.css","./app.js","./manifest.json"])
    )
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open("bocfx-v1").then((c) => c.put(e.request, copy));
      return resp;
    }))
  );
});
