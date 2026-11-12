# i18next browser vendor

Official **i18next 27.1.1**, MIT. The unmodified browser UMD distribution and
upstream license are checked in here so the application needs no runtime CDN,
translation service, bundler, `node_modules` or additional server dependency.

Source: https://registry.npmjs.org/i18next/-/i18next-27.1.1.tgz

Registry integrity (SHA-512):
`sha512-Qq3aJizS3RXQ30crhx9BKQLrHoa6GKpgrOJjVZ9vgj3EBxAddrmVfDNUrAMxSUimw5Jc+ld4SSZUAzf1q4nGyQ==`

Reproduce from the repository root with Node 22:

```sh
node scripts/vendor-i18next.mjs
```

The acquisition script checks the exact tarball integrity before extracting
`package/dist/umd/i18next.min.js` and `package/LICENSE`. It writes only these
vendored files and a disposable directory below `review-artifacts/`.

SHA-256:

- `i18next-27.1.1.min.js`: `4e03e74f5c4809503119380adfbbd9744bf2fb94e81ffa24a2ce31052981f9b8`
- `i18next-LICENSE`: `1cd0a2b02a6cc40ef8ee16310d13eeffdd7b5de4a562fd3ee7c921d8eb54f60a`

Install/cutover: copy this directory together with `i18n.js`, `locales/`, and
all migrated shell assets. No npm runtime/lockfile dependency change is needed.
Do not deploy a migrated importer without its locale/vendor assets. A complete
viewer/frame cutover remains a release acceptance gate; this vendor note is not
an approval to deploy partial localization.
