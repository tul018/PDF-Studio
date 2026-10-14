# PDF Studio 0.2: professional tools and integrations

## Where to find the features

The toolbar adds **Tools**, **Connector**, **Live**, **Engine** and **Updates**. Tools opens the professional actions. Generated documents open as new tabs or use Save As; batch actions write copies. Review redaction marks before saving. Redaction rasterizes affected pages to remove the covered source content; sanitization rasterizes every page into a fresh PDF.

| Phase | Implemented | Boundaries |
|---|---|---|
| 2 | Signed Tauri updater, manual check, opt-in automatic check, progress, release configuration helper | Hosting and signing credentials intentionally unconfigured; no deployed update feed |
| 3 | Pixel comparison; literal/phone/ID search redaction; hidden-information removal; comments/replies/resolution; text and checkbox fields; headers/footers/Bates; bookmarks; calibrated distance/area; Word/Excel; batch stamp/compress/protect | Flat bookmarks; numeric form placement; Word/Excel are extracted text, not layout/table reconstruction; sanitization removes searchable text too |
| 4 | Local paired MCP connector with 26 tools, document reads and individually approved edits | Configure it in Claude yourself using the snippet below; it does not read/control the Claude VS Code panel |
| 5 | Offline QR detection and generation; optional PDF.js hardware acceleration; encrypted Yjs live annotation/form/page changes, editor/viewer invitations, local undo | Relay must run separately; no public deployment, cursor presence, voice/chat or durable rooms; 12 MB input limit; no measured GPU speedup claim |
| 6 | Local RSA P12/PFX signatures; editable native annotations with appearance streams; incremental revisions; standard-font text-operator editing; image-only PDF/A-2b | No timestamp/LTV or trust verification UI; no arbitrary embedded-font editing; incremental saving excludes destructive operations, encrypted/signed sources and changed source/page structure; archival export discards searchable text |

## Automatic updates

This build makes no update request because hosting is unconfigured. For a future release set `PDF_STUDIO_UPDATE_URL` to an HTTPS Tauri update endpoint and `PDF_STUDIO_UPDATE_PUBLIC_KEY` to the public signing key; run `npm run updates:prepare`. Build with `VITE_UPDATES_CONFIGURED=1` and `npm run app:build -- --config src-tauri/updater.release.json`. Supply `TAURI_SIGNING_PRIVATE_KEY` and its password through the release environment only. Never ship a private-repository access token inside the app. The release workflow accepts the endpoint/public key as repository variables and the signing key/password as secrets. It uploads installer/signature artifacts; feed hosting and publication remain separate.

## Claude connector

Requires Node.js and this checkout's npm dependencies. Create a long random token (for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). In your Claude client's MCP configuration, add:

```json
{
  "mcpServers": {
    "pdf-studio": {
      "command": "node",
      "args": ["C:\\Users\\tultw\\Projects\\PDF-viewer\\connector\\server.mjs"],
      "env": { "PDF_STUDIO_PAIRING_TOKEN": "REPLACE_WITH_RANDOM_TOKEN" }
    }
  }
}
```

Start/restart that MCP connection in Claude, then open **Connector** in PDF Studio and enter the same token. Claude can read the open PDF while paired. Editing/navigation/printing/saving actions ask for **Allow once** in PDF Studio. Save uses Save As. Click Connector again to disconnect. Only one client pairs at a time. The server binds loopback, checks origins and uses constant-time token comparison. Alternatively use `PDF_STUDIO_PAIRING_FILE` for a local token file. Do not commit tokens. The installer does not bundle or auto-start Node.

Tool examples: “Read page 1”, “Find every occurrence of invoice”, “Show page 3”, “Add a comment on page 2”, “Fill the Customer field”, “Mark this rectangle for redaction”, “Save an extracted copy of pages 2 and 4”. Reads of existing source text do not automatically include unsaved annotation text; use annotation listing or page images for those.

## Live collaboration (no server, no Cloudflare)

Open a PDF and choose **Live → Host current PDF**. Your PDF Studio becomes the meeting point (a relay built into the app, `src-tauri/src/relay.rs`); nothing to install or run. Send the editor or view-only invitation (e.g. by LINE). The other person chooses **Live → Join session** and pastes it; their app tries your PC's network addresses, which the invitation carries.

- **Same network** (shop Wi-Fi, office): works directly. The first time you host, Windows asks whether PDF Studio may accept connections: allow **Private networks**.
- **Different places**: install the free **Tailscale** app on both PCs (same Tailscale account or a shared device); the host's Tailscale address is in the invitation, so joining works the same way. No server, no Cloudflare, no cost.
- Updates are encrypted end to end (AES-GCM); the key is only in the invitation, so treat invitations like a password to the document. Only the host's PC can start sessions; at most 10 people; sessions end when the host stops or after 4 hours. Save a local PDF to keep the work.
- The host's PDF Studio must stay open. The browser build (development) still uses `npm run collaboration` as its relay.

## Engine and technical boundaries

Native annotations and incremental save default off. Native appearance streams preserve rendering while allowing compatible readers to edit annotations. Redaction/whiteout use flattened page output. Incremental saves preserve the original bytes, so old values remain recoverable; use sanitization for removing hidden information. Signed sources are not eligible for incremental rewriting. Any subsequent full edit/save of a signed file can invalidate its signature.

Existing-text editing replaces matching printable ASCII runs in standard Helvetica/Times/Courier content streams, including literal/hex strings and text arrays. It cannot reshape fonts, reflow paragraphs, search across separate text runs, edit Form XObjects or handle arbitrary embedded-font encodings. Unsupported content is left unchanged.

Certificate signing accepts a local RSA key/certificate in P12/PFX format, creates a detached SHA-256 PKCS#7 signature, and includes the certificate chain. The password/private key is not transmitted or saved. Certificate trust/revocation is not established by this app. There is no timestamp authority integration or LTV. `node-forge` is used for local key parsing/signing; its current dependency audit reports an RSA **verification** advisory. Production does not use its verification API; regression verification uses Node's native crypto.

Archive export creates a fresh image-only PDF/A-2b with XMP identification and an sRGB output intent. A generated regression fixture passes **veraPDF 1.30.3, flavour 2b**. This validates the tested output, not every possible input. Validate important deliverables independently. The bundled compact sRGB profile is from [Compact ICC Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles), distributed under CC0; license is in `public/color/LICENSE`.

## Verification

`npm test` covers PDF structure, text extraction, incremental byte preservation, native appearances, actual content replacement, cryptographic signatures and existing regression cases. Playwright professional/connection tests cover the visible tools, DOCX/XLSX contents, QR detection, redaction, archive metadata, paired MCP approval and two-client live synchronization/undo. Run `npm run e2e` for the complete browser suite. `cargo test --manifest-path src-tauri/Cargo.toml` checks native file handling; `npm run app:build` produces Windows NSIS/MSI installers. Desktop installer execution and iOS device behavior require separate native-device validation.
