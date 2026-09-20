// CI only: Next's font test hook avoids Google requests during fixture builds.
// Local fonts keep this synthetic build self-contained; never set the hook in
// a production deployment, where the real bundled font should be generated.
module.exports = new Proxy({}, {
  get(_target, url) {
    if (typeof url !== "string" || !url.includes("family=Instrument+Sans")) return undefined
    return "@font-face { font-family: 'Instrument Sans'; font-style: normal; font-weight: 100 900; src: local('Arial'); }"
  },
})
